#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hostProcess } from './skills-process.mjs';
import { windowReply, personaPrompt, claudeReplyDelivered } from './skills-owner.mjs';
import { checkTrace, codexItems, codexWindows, visible, completedTrace } from './skills-trace.mjs';
import { traceRows } from './skills-probe.mjs';
import { mcpConfig, privateCodexHome, toolViolation, workspaceEvidence, workspaceReadCall, workspaceReadCode, MissingEvidence, codexToolCalls, isWrite } from './skills-boundary.mjs';

const userMessage = text => ({type:'user',message:{role:'user',content:[{type:'text',text}]},parent_tool_use_id:null,session_id:''});
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const ownerText = event => (event.message?.content??[]).filter?.(b=>b.type==='text').map(b=>b.text).join('\n')??'';
function childEnv(home){const env={...process.env};delete env.ANTHROPIC_API_KEY;delete env.ANTHROPIC_AUTH_TOKEN;delete env.OPENAI_API_KEY;if(home)env.CODEX_HOME=home;return env;}
function modelArgs(request){return request.model?['--model',request.model]:[];}
function codexCommon(request){return ['--json','--disable','apps','--disable','remote_plugin','--skip-git-repo-check','-c','approval_policy="never"','-c','sandbox_mode="workspace-write"','-c','sandbox_workspace_write.network_access=true',...modelArgs(request)];}
function validate(request){
  if(!['claude','codex'].includes(request.host)||!path.isAbsolute(request.outputDir??'')||!path.isAbsolute(request.cwd??'')||!path.isAbsolute(request.packRoot??''))throw new Error('host and absolute outputDir/cwd/packRoot required');
  if(!request.scenario?.prompt?.trim()||!request.scenario.expectedWindows?.length||!Array.isArray(request.scenario.allowedTools)||!request.scenario.windows?.length)throw new Error('scenario prompt, expectedWindows, allowedTools and policies required');
  const proof=request.workspaceProof;
  if(!/^mcp__monotest__\w+$/.test(proof?.tool??'')||!Array.isArray(proof.path)||proof.equals==null||!request.scenario.allowedTools.includes(proof.tool)||isWrite(proof.tool))throw new Error('explicit monotest read proof required');
  mcpConfig(request.mcpServers);
  for(const key of ['timeoutMs','idleMs'])if(request[key]!==undefined&&(!Number.isFinite(request[key])||request[key]<=0))throw new Error(`invalid ${key}`);
}

export async function runPersona(request,lastMessage,index){
  const prompt=personaPrompt(request.scenario.brief,lastMessage);
  const dir=path.join(request.outputDir,`persona-${index}`);fs.mkdirSync(dir);
  const trace=path.join(dir,'trace.jsonl'),sent=path.join(dir,'sent.jsonl');fs.writeFileSync(trace,'');fs.writeFileSync(sent,'');
  let answer='',tool=false;
  let args,env=childEnv();
  if(request.host==='claude')args=['-p','--verbose','--output-format','stream-json','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands',...modelArgs(request),prompt];
  else{
    const home=path.join(dir,'home');fs.mkdirSync(home);fs.symlinkSync(request.authFile,path.join(home,'auth.json'));fs.writeFileSync(path.join(home,'config.toml'),'[mcp_servers.linear]\nenabled = false\n');env=childEnv(home);
    args=['exec',...codexCommon(request),'--ignore-user-config','--disable','plugins','--disable','shell_tool','--disable','multi_agent','--disable','code_mode_host','--disable','browser_use','--disable','computer_use','--disable','image_generation','--disable','view_image','--disable','sleep_tool','-c','web_search="disabled"','-s','read-only',prompt];
  }
  const result=await hostProcess({binary:request.binary??{command:request.host==='claude'?'claude':'codex'},args,cwd:dir,env,trace,sent,stderr:path.join(dir,'stderr.log'),timeoutMs:request.timeoutMs??1_200_000,
    onEvent:e=>{if(request.host==='claude'){if((e.message?.content??[]).some?.(b=>b.type==='tool_use'))tool=true;if(e.type==='assistant')answer=ownerText(e)||answer;}
      else{if(e.type==='item.completed'&&e.item?.type==='agent_message')answer=e.item.text;if(e.type.startsWith('item.')&&e.item?.type&&!['agent_message','reasoning'].includes(e.item.type))tool=true;}}});
  const last=traceRows(trace).rows.at(-1)?.value;
  const complete=request.host==='claude'?last?.type==='result'&&last.subtype==='success'&&!last.is_error:last?.type==='turn.completed';
  if(result.code!==0||result.failure||tool||!visible(answer)||!complete)throw new Error(`persona not verified without tools: ${result.failure??(tool?'tool call observed':'missing successful answer')}`);
  return answer;
}

export async function runClaude(request){
  const trace=path.join(request.outputDir,'trace.jsonl'),sent=path.join(request.outputDir,'sent.jsonl');fs.writeFileSync(trace,'');fs.writeFileSync(sent,'');
  const config=path.join(request.outputDir,'mcp.json');fs.writeFileSync(config,JSON.stringify(mcpConfig(request.mcpServers)));
  const allowed=request.scenario.allowedTools.filter(n=>!n.startsWith('mcp__'));if(!allowed.includes('AskUserQuestion'))allowed.push('AskUserQuestion');
  const args=['-p','--verbose','--input-format','stream-json','--output-format','stream-json','--permission-prompt-tool=stdio','--strict-mcp-config','--mcp-config',config,'--plugin-dir',request.packRoot,'--setting-sources','','--settings',JSON.stringify({enabledPlugins:{'mono@mono-marketplace':false}}),'--tools',allowed.join(','),...modelArgs(request)];
  const calls=new Map(),receipts=new Map(),replies=[],seenRequests=new Set(),pendingWindows=[];let confirmed=false,phase='confirm',lastMessage='',freeIndex=0,waiting=false,violation=null,evidenceMissing=null;
  const deny=(e,message,c)=>c.send({type:'control_response',response:{subtype:'success',request_id:e.request_id,response:{behavior:'deny',message}}});
  const fail=(reason,c)=>{violation=reason;c.stop(reason);};
  const missing=(reason,c)=>{evidenceMissing=reason;c.stop(reason);};
  const processResult=await hostProcess({binary:request.binary??{command:'claude'},args,cwd:request.cwd,env:childEnv(),trace,sent,stderr:path.join(request.outputDir,'stderr.log'),timeoutMs:request.timeoutMs??1_200_000,idleMs:request.idleMs??240_000,
    input:userMessage(`Только чтение: вызови ${request.workspaceProof.tool}, покажи пространство. Ничего не записывай; затем остановись.`),
    onEvent:(e,c)=>{
      if(e.type==='assistant'){
        if(!e.parent_tool_use_id){waiting=false;lastMessage=ownerText(e)||lastMessage;}
        for(const b of e.message?.content??[])if(b.type==='tool_use'){
          if(!e.parent_tool_use_id)calls.set(b.id,b.name);
          if(b.name==='AskUserQuestion'&&!e.parent_tool_use_id)pendingWindows.push(b.id);
          if(b.name!=='AskUserQuestion'){const reason=toolViolation(b.name,b.input,request.scenario,confirmed);if(reason)return fail(reason,c);}
        }
      }
      if(e.type==='user'&&!e.parent_tool_use_id&&Array.isArray(e.message?.content))for(const b of e.message.content){
        if(b.type==='tool_result'){
          const reply=replies.find(r=>r.callId===b.tool_use_id);
          if(reply){
            if(!claudeReplyDelivered(b,receipts.get(reply.callId)))return missing('successful window reply delivery not established',c);
            reply.received=true;
          }
        }
        if(b.type==='tool_result'&&calls.get(b.tool_use_id)===request.workspaceProof.tool){
          const evidence=workspaceEvidence(b,request.workspaceProof);
          if(evidence==='missing')return missing('successful workspace read result missing',c);
          if(evidence==='mismatch')return fail('monotest workspace read did not match proof',c);
          confirmed=true;
        }
      }
      if(e.type==='control_request'&&e.request?.subtype==='can_use_tool'){
        if(seenRequests.has(e.request_id))return;seenRequests.add(e.request_id);
        const {tool_name:name,input}=e.request;
        if(name==='AskUserQuestion'){
          if(phase!=='stage'){deny(e,'workspace confirmation first',c);return fail('window before stage',c);}
          const policy=request.scenario.windows[replies.length];
          if(!policy){deny(e,'scenario window policy missing',c);return fail('unexpected window',c);}
          const callId=pendingWindows.shift();
          if(!callId){deny(e,'window tool use missing from trace',c);return fail('unobserved window request',c);}
          const reply=windowReply('claude',input,policy,e.request_id);
          receipts.set(callId,reply);c.send(reply);replies.push({index:replies.length,requestId:e.request_id,callId,policy:policy.mode,replySent:true,received:false});
        }else{
          const reason=toolViolation(name,input,request.scenario,confirmed)??(phase==='confirm'&&name!==request.workspaceProof.tool?'non-read tool during workspace confirmation':null);
          if(reason){deny(e,reason,c);return fail(reason,c);}
          c.send({type:'control_response',response:{subtype:'success',request_id:e.request_id,response:{behavior:'allow',updatedInput:input}}});
        }
      }
      if(e.type==='result'&&!e.parent_tool_use_id){
        if(e.is_error||e.subtype!=='success')return fail('Claude result failed',c);
        if(phase==='confirm'){
          if(!confirmed)return missing('workspace not confirmed before stage',c);
          phase='stage';lastMessage='';c.send(userMessage(request.scenario.prompt));
        }else{waiting=true;c.idle();}
      }else if(waiting)c.idle();
    },
    onIdle:async c=>{
      const free=request.scenario.freeQuestions?.[freeIndex];
      if(free&&lastMessage.includes(free.contains)){
        waiting=false;const answer=await runPersona(request,lastMessage,freeIndex++);c.send(userMessage(answer));
      }else c.end();
    }});
  return {trace,sent,replies,confirmed,process:processResult,violation,evidenceMissing,boundary:'Claude denies unlisted tools before permission; user/global instructions and customizations may still load.'};
}

function rolloutFor(home,thread){
  const walk=d=>fs.existsSync(d)?fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]):[];
  const found=walk(path.join(home,'sessions')).filter(f=>path.basename(f).startsWith('rollout-')&&f.endsWith('.jsonl')&&f.includes(thread));
  if(found.length!==1)throw new Error('unique session rollout not found');return found[0];
}
async function quiet(file,idleMs,deadline){
  let mtime=fs.statSync(file).mtimeMs,stable=Date.now();
  while(Date.now()-stable<idleMs){if(Date.now()>=deadline)throw new Error('rollout silence timeout');await pause(Math.min(100,idleMs));const now=fs.statSync(file).mtimeMs;if(now!==mtime){mtime=now;stable=Date.now();}}
}
export async function runCodex(request){
  const home=path.join(request.outputDir,'codex-home');privateCodexHome(home,request.authFile,request.mcpServers);
  const env=childEnv(home),binary=request.binary??{command:'codex'};
  for(const args of [['plugin','marketplace','add',request.packRoot],['plugin','add','mono@mono-marketplace']]){
    const result=spawnSync(binary.command,[...(binary.args??[]),...args],{cwd:request.cwd,env,encoding:'utf8',timeout:request.timeoutMs??1_200_000,maxBuffer:16*1024*1024});
    fs.appendFileSync(path.join(request.outputDir,'setup.log'),(result.stdout??'')+(result.stderr??''));
    if(result.status!==0||result.error)throw new Error('Codex local pack setup failed');
  }
  let thread=null,rollout=null,confirmed=false,violation=null,seenLines=0,freeIndex=0;
  const replies=[],seen=new Set(),deadline=Date.now()+(request.timeoutMs??1_200_000),readCalls=new Map();
  const stdout=path.join(request.outputDir,'stdout.jsonl'),sent=path.join(request.outputDir,'sent.jsonl');fs.writeFileSync(stdout,'');fs.writeFileSync(sent,'');
  let processResult;
  const turn=async(prompt,confirm=false,replyRecord=null)=>{
    const args=thread?['exec','resume',...codexCommon(request),thread,prompt]:['exec',...codexCommon(request),'-s','read-only','-C',request.cwd,prompt];
    processResult=await hostProcess({binary,args,cwd:request.cwd,env,trace:stdout,sent,stderr:path.join(request.outputDir,'stderr.log'),timeoutMs:Math.max(1,deadline-Date.now()),onEvent:e=>{if(e.type==='thread.started'){if(thread&&thread!==e.thread_id)throw new Error('thread changed');thread=e.thread_id;}}});
    if(processResult.code!==0||processResult.failure)throw new Error(`Codex process failed: ${processResult.failure??processResult.code}`);
    if(!thread)throw new Error('Codex thread id missing');rollout=rolloutFor(home,thread);
    await quiet(rollout,request.idleMs??1000,deadline);
    const {rows}=traceRows(rollout);
    const fresh=rows.filter(r=>r.line>seenLines);seenLines=rows.at(-1)?.line??0;
    if(replyRecord){
      replyRecord.received=fresh.some(r=>r.value.type==='response_item'&&r.value.payload?.type==='message'&&r.value.payload.role==='user'&&(r.value.payload.content??[]).some(b=>b.type==='input_text'&&b.text===prompt));
      if(!replyRecord.received)throw new MissingEvidence('window reply not observed in resumed rollout');
    }
    for(const r of fresh){
      const e=r.value,p=e.payload;
      if(e.type!=='response_item')continue;
      for(const call of codexToolCalls(p)){
        if(call.name==='request_user_input_async')continue;
        const reason=toolViolation(call.name,call.input,request.scenario,confirmed)??(confirm&&call.name!==request.workspaceProof.tool?'non-read tool during workspace confirmation':null);
        if(reason){violation=`${rollout}:${r.line}: ${reason}`;throw new Error(violation);}
        if(confirm&&call.name===request.workspaceProof.tool){
          if(!workspaceReadCall(p,request.workspaceProof))throw new MissingEvidence(`${rollout}:${r.line}: exec does not establish an executed workspace read`);
          if(readCalls.has(call.callId))throw new MissingEvidence('duplicate workspace read call id');
          readCalls.set(call.callId,p.type==='custom_tool_call'?'custom_tool_call_output':'function_call_output');
        }
      }
      if(p&&readCalls.has(p.call_id)&&readCalls.get(p.call_id)===p.type){
        readCalls.delete(p.call_id);
        const evidence=workspaceEvidence(p.output,request.workspaceProof);
        if(evidence==='missing')throw new MissingEvidence(`${rollout}:${r.line}: successful workspace read result missing`);
        if(evidence==='mismatch')throw new Error('monotest workspace read did not match proof');
        confirmed=true;
      }
    }
    if(!completedTrace('codex', rows))throw new Error('Codex rollout incomplete');
    return rows;
  };
  try{
    await turn(`Только чтение: вызови ${request.workspaceProof.tool} и покажи пространство. Через exec выполни дословно, без добавлений: ${workspaceReadCode(request.workspaceProof)} Не имитируй результат. Ничего не записывай, затем остановись.`,true);
    if(!confirmed)throw new MissingEvidence('workspace not confirmed before stage');
    let rows=await turn(request.scenario.prompt+'\nДля аудита передавай аргументы tools.exec_command полным JSON-объектом с двойными кавычками. Не используй вычисляемые команды или spread.');
    for(let n=0;n<(request.maxTurns??32);n++){
      const windows=codexWindows(rows,rollout).filter(w=>!seen.has(w.callId));
      if(windows.length){
        const uncertain=windows.find(w=>!w.executionConfirmed);
        if(uncertain)throw new MissingEvidence(`${uncertain.evidence}: ${uncertain.reason}`);
        if(windows.length!==1)throw new Error('multiple unanswered windows in one turn');
        const window=windows[0],policy=request.scenario.windows[replies.length];
        const checked=checkTrace({host:'codex',trace:rollout,expectedWindows:request.scenario.expectedWindows.slice(0,replies.length+1),rulesRoot:request.rulesRoot});
        if(checked.status!=='passed')throw new Error('window/summary check failed before reply');
        const reply=windowReply('codex',{questions:window.questions},policy,window.callId);
        fs.appendFileSync(sent,JSON.stringify({thread,prompt:reply})+'\n');
        seen.add(window.callId);replies.push({index:replies.length,callId:window.callId,policy:policy.mode,replySent:true,received:false,...(['empty','refuse'].includes(policy.mode)?{note:'Codex CLI form observed; app empty/refusal form not observed'}:{})});
        rows=await turn(reply,false,replies.at(-1));continue;
      }
      const last=codexItems(rows).filter(r=>r.item?.type==='message'&&r.item.role==='assistant').at(-1)?.item;
      const lastMessage=(last?.content??[]).filter(b=>b.type==='output_text').map(b=>b.text).join('\n');
      const free=request.scenario.freeQuestions?.[freeIndex];
      if(free&&lastMessage.includes(free.contains)){rows=await turn(await runPersona(request,lastMessage,freeIndex++));continue;}
      return {trace:rollout,sent,replies,confirmed,process:processResult,violation,boundary:'Codex has no pre-execution refusal: private home, disabled linear/apps, first read-only turn and post-turn direct-call audit. A violation may already have executed; report failed.'};
    }
    throw new Error('scenario turn limit reached');
  }catch(error){
    return {trace:rollout??stdout,sent,replies,confirmed,process:processResult,violation:error instanceof MissingEvidence?null:violation??error.message,evidenceMissing:error instanceof MissingEvidence?error.message:null,boundary:'Codex cannot refuse MCP calls before execution; rollout audit failed.'};
  }
}

export async function runScenario(request){
  let run,created=false;
  try{
    validate(request);fs.mkdirSync(request.outputDir);created=true; // a run never overwrites another run
    run=request.host==='claude'?await runClaude(request):await runCodex(request);
    const check=checkTrace({host:request.host,trace:run.trace,expectedWindows:request.scenario.expectedWindows,rulesRoot:request.rulesRoot});
    const failure=run.violation??(run.evidenceMissing?null:run.process?.failure??(run.process?.code!==0?'host process failed':null));
    const allReplied=run.replies.length===request.scenario.expectedWindows.length&&run.replies.every(r=>r.received);
    const status=failure?'failed':run.evidenceMissing?'unverified':check.status!=='passed'?check.status:allReplied?'passed':'unverified';
    const result={host:request.host,status,...run,check,reason:failure??run.evidenceMissing??(!allReplied?'not every expected window was answered':null),conversation:{status:'unverified',rubric:'references/qa-skills.md#рубрика-разговора'}};
    fs.writeFileSync(path.join(request.outputDir,'result.json'),JSON.stringify(result,null,2)+'\n');return result;
  }catch(error){
    const result={host:request.host,status:'unverified',reason:error.message,...(run?{run}:{})};
    if(created&&!fs.existsSync(path.join(request.outputDir,'result.json')))fs.writeFileSync(path.join(request.outputDir,'result.json'),JSON.stringify(result,null,2)+'\n');return result;
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));if(typeof request.scenario==='string')request.scenario=JSON.parse(fs.readFileSync(request.scenario,'utf8'));const r=await runScenario(request);console.log(JSON.stringify(r,null,2));process.exitCode=r.status==='passed'?0:r.status==='failed'?1:2;}
  catch(error){console.error(error.message);process.exitCode=2;}
}
