#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditRows } from './skills-audit.mjs';
import { readJsonLines } from './transports/journal.mjs';
import { hostProcess } from './skills-process.mjs';
import { windowReply, personaPrompt, windowPolicy, roleWindows, targetReplyCount } from './skills-owner.mjs';
import { checkTrace, codexItems, codexWindows, visible, completedTrace, codexTerminals } from './skills-trace.mjs';
import { traceRows } from './skills-probe.mjs';
import { mcpConfig, privateCodexHome, toolViolation, workspaceReadCall, workspaceReadCode, MissingEvidence, isWrite } from './skills-boundary.mjs';

const userMessage = text => ({type:'user',message:{role:'user',content:[{type:'text',text}]},parent_tool_use_id:null,session_id:''});
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const ownerText = event => (event.message?.content??[]).filter?.(b=>b.type==='text').map(b=>b.text).join('\n')??'';
function childEnv(home){const env={...process.env};delete env.ANTHROPIC_API_KEY;delete env.ANTHROPIC_AUTH_TOKEN;delete env.OPENAI_API_KEY;if(home)env.CODEX_HOME=home;return env;}
function modelArgs(request){return request.model?['--model',request.model]:[];}
function codexCommon(request){return ['--json','--disable','apps','--disable','remote_plugin','--skip-git-repo-check','-c','approval_policy="never"','-c','sandbox_mode="workspace-write"','-c','sandbox_workspace_write.network_access=true',...modelArgs(request)];}
const targetsAnswered=(request,replies)=>targetReplyCount(replies)===request.scenario.expectedWindows.length;
export function checkSeedRoute(request){
  const seed=request.seed;let raw;
  try{raw=fs.readFileSync(seed.projectFile,'utf8');}catch(error){
    if(error.code==='ENOENT')throw new MissingEvidence('seed not completed');
    throw error;
  }
  const project=JSON.parse(raw);
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(project.id??'')||project.name!==seed.projectName||!project.url?.startsWith('https://linear.app/monotest/'))throw new Error('seed project read-back mismatch');
  if(!seed.expectedStage)return {project};
  const run=spawnSync(process.execPath,[path.join(request.packRoot,'scripts/idea-gate.mjs'),'route','--mode','fresh','--dump',seed.dumpDir,'--config',seed.configFile],{cwd:request.cwd,encoding:'utf8',timeout:30_000});
  let route;try{route=JSON.parse(run.stdout.trim().split('\n').at(-1));}catch{route=null;}
  const result={project,route,expectedStage:seed.expectedStage,exitCode:run.status};
  fs.writeFileSync(path.join(request.outputDir,'seed-route.json'),JSON.stringify(result,null,2)+'\n');
  if(run.status!==0||!route?.ok||route.next!==seed.expectedStage||route.projectId!==project.id)throw new Error(`seed route mismatch: expected ${seed.expectedStage}, observed ${route?.next??'invalid dump'}`);
  return result;
}
function validate(request){
  if(!['claude','codex'].includes(request.host)||!path.isAbsolute(request.outputDir??'')||!path.isAbsolute(request.cwd??'')||!path.isAbsolute(request.packRoot??''))throw new Error('host and absolute outputDir/cwd/packRoot required');
  if(!request.scenario?.prompt?.trim()||!request.scenario.expectedWindows?.length||(request.scenario.allowedTools!==undefined&&request.scenario.allowedTools!=='*'&&!Array.isArray(request.scenario.allowedTools))||!request.scenario.windows?.length)throw new Error('scenario prompt, expectedWindows, allowedTools and policies required');
  const proof=request.workspaceProof;
  if(!/^mcp__monotest__\w+$/.test(proof?.tool??'')||!Array.isArray(proof.path)||proof.equals==null||isWrite(proof.tool))throw new Error('explicit monotest read proof required');
  mcpConfig(request.mcpServers);
  for(const key of ['timeoutMs','idleMs'])if(request[key]!==undefined&&(!Number.isFinite(request[key])||request[key]<=0))throw new Error(`invalid ${key}`);
  if(roleWindows(request.scenario.expectedWindows)&&request.scenario.expectedWindows.some(w=>!['approval','transition'].includes(w.role)))throw new Error('every expected target needs its role');
  if(request.seed){
    const seed=request.seed;
    if(!seed.prompt?.trim()||!path.isAbsolute(seed.projectFile??'')||fs.existsSync(seed.projectFile)||!seed.projectName)throw new Error('fresh seed prompt/projectFile/projectName required');
    if(seed.expectedStage&&(!path.isAbsolute(seed.dumpDir??'')||fs.existsSync(seed.dumpDir)||!path.isAbsolute(seed.configFile??'')))throw new Error('fresh route dump and config paths required');
  }
}

export async function runPersona(request,lastMessage,index){
  const prompt=personaPrompt(request.scenario.brief,lastMessage);
  const dir=path.join(request.outputDir,`persona-${index}`);fs.mkdirSync(dir);
  const trace=path.join(dir,'trace.jsonl'),sent=path.join(dir,'sent.jsonl');fs.writeFileSync(trace,'');fs.writeFileSync(sent,'');

  let args,env=childEnv();
  if(request.host==='claude')args=['-p','--verbose','--output-format','stream-json','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands',...modelArgs(request),prompt];
  else{
    const home=path.join(dir,'home');fs.mkdirSync(home);fs.symlinkSync(request.authFile,path.join(home,'auth.json'));fs.writeFileSync(path.join(home,'config.toml'),'[mcp_servers.linear]\nurl = "https://mcp.linear.app/mcp"\nenabled = false\n');env=childEnv(home);
    args=['exec',...codexCommon(request),'--ignore-user-config','--disable','plugins','--disable','shell_tool','--disable','multi_agent','--disable','code_mode_host','--disable','browser_use','--disable','computer_use','--disable','image_generation','--disable','view_image','--disable','sleep_tool','-c','web_search="disabled"','-s','read-only',prompt];
  }
  const result=await hostProcess({binary:request.binary??{command:request.host==='claude'?'claude':'codex'},args,cwd:dir,env,trace,sent,stderr:path.join(dir,'stderr.log'),timeoutMs:request.timeoutMs??3_600_000,
    onEvent:()=>{}});
  let rows;try{rows=traceRows(trace,request.host,{stdout:request.host==='codex'}).rows;}catch(error){throw new MissingEvidence(`persona not verified without tools: ${error.message}`);}
  const audit=auditRows(request.host,rows,{stdout:request.host==='codex'});
  const last=rows.filter(r=>request.host==='claude'?r.value.type==='assistant'&&!r.value.parent_tool_use_id:r.value.type==='item.completed'&&r.value.item?.type==='agent_message').at(-1)?.value;
  const proof=audit.proof({kind:'persona',result:last});
  const answer=proof.value;
  const complete=completedTrace(request.host,rows,{stdout:request.host==='codex'});
  if(result.code!==0||result.failure||audit.calls.length||proof.status!=='confirmed'||!visible(answer)||!complete)throw new MissingEvidence(`persona not verified without tools: ${result.failure??'missing successful answer or tool observed'}`);
  return answer;
}

export async function runClaude(request){
  const trace=path.join(request.outputDir,'trace.jsonl'),sent=path.join(request.outputDir,'sent.jsonl');fs.writeFileSync(trace,'');fs.writeFileSync(sent,'');
  const config=path.join(request.outputDir,'mcp.json');fs.writeFileSync(config,JSON.stringify(mcpConfig(request.mcpServers)));
  const toolPolicy=request.scenario.allowedTools??'*';
  const allowed=toolPolicy.includes('*')?null:toolPolicy.filter(n=>!n.startsWith('mcp__'));if(allowed&&!allowed.includes('AskUserQuestion'))allowed.push('AskUserQuestion');
  const args=['-p','--verbose','--input-format','stream-json','--output-format','stream-json','--permission-prompt-tool=stdio','--strict-mcp-config','--mcp-config',config,'--plugin-dir',request.packRoot,'--setting-sources','','--settings',JSON.stringify({enabledPlugins:{'mono@mono-marketplace':false}}),...(allowed?['--tools',allowed.join(',')]:[]),...modelArgs(request)];
  const calls=new Map(),receipts=new Map(),replies=[],freeReplies=[],seenRequests=new Set(),pendingWindows=[];let confirmed=false,phase='confirm',lastMessage='',freeIndex=0,waiting=false,violation=null,evidenceMissing=null,endLine,seedRoute;
  const personaTasks=new Set(),deadline=Date.now()+(request.timeoutMs??3_600_000);let lastFreeQuestion;
  const persona=question=>{
    const task=runPersona({...request,timeoutMs:Math.max(1,deadline-Date.now())},question,freeIndex++);
    personaTasks.add(task);task.then(()=>personaTasks.delete(task),()=>personaTasks.delete(task));return task;
  };
  const beginTurn=()=>{waiting=false;lastMessage='';};
  const deny=(e,message,c)=>c.send({type:'control_response',response:{subtype:'success',request_id:e.request_id,response:{behavior:'deny',message}}});
  const fail=(reason,c)=>{violation=reason;c.stop(reason);};
  const missing=(reason,c)=>{evidenceMissing=reason;c.stop(reason);};
  const processResult=await hostProcess({binary:request.binary??{command:'claude'},args,cwd:request.cwd,env:childEnv(),trace,sent,stderr:path.join(request.outputDir,'stderr.log'),timeoutMs:request.timeoutMs??3_600_000,idleMs:request.idleMs??240_000,
    input:userMessage(`Только чтение: вызови ${request.workspaceProof.tool}, покажи пространство. Ничего не записывай; затем остановись.`),
    onEvent:(e,c,line)=>{
      let audit;try{audit=auditRows('claude',[{value:e,line:0}]);}catch(error){return missing(error.message,c);}
      if(e.type==='system'&&e.subtype==='init'&&!e.parent_tool_use_id)beginTurn();
      if(e.type==='assistant'){
        if(!e.parent_tool_use_id&&(e.message?.content??[]).some(b=>['text','thinking','tool_use'].includes(b.type))){waiting=false;lastMessage=ownerText(e)||lastMessage;}
        for(const b of e.message?.content??[])if(b.type==='tool_use'){
          if(!e.parent_tool_use_id)calls.set(b.id,{event:e,block:b});
          if(b.name==='AskUserQuestion'&&!e.parent_tool_use_id)pendingWindows.push(b.id);
          if(b.name!=='AskUserQuestion'){const reason=toolViolation(b.name,b.input,request.scenario,confirmed)??(phase==='confirm'&&isWrite(b.name)?'write during workspace confirmation':null);if(reason)return fail(reason,c);}
        }
      }
      if(e.type==='user'&&!e.parent_tool_use_id&&Array.isArray(e.message?.content))for(const b of e.message.content){
        if(b.type==='tool_result'){
          const call=calls.get(b.tool_use_id),reply=replies.find(r=>r.callId===b.tool_use_id);
          const kind=reply?'answer':call?.block.name===request.workspaceProof.tool?'workspace':null;
          if(kind){
            const evidence=audit.proof({kind,call:call?.event,result:e,callId:b.tool_use_id,proof:request.workspaceProof,reply:receipts.get(b.tool_use_id)});
            if(evidence.status==='unverified')return missing(`successful ${kind} result missing`,c);
            if(evidence.status==='mismatch')return fail('monotest workspace read did not match proof',c);
            if(kind==='workspace')confirmed=true;
            if(reply){reply.received=true;if(evidence.refused)reply.refused=true;}
          }
        }
      }
      if(e.type==='control_request'&&e.request?.subtype==='can_use_tool'){
        if(seenRequests.has(e.request_id))return;seenRequests.add(e.request_id);
        const {tool_name:name,input}=e.request;
        if(name==='AskUserQuestion'){
          if(phase!=='stage'){deny(e,'workspace confirmation first',c);return fail('window before stage',c);}
          let plan;try{plan=windowPolicy(request.scenario,input.questions,replies);}catch(error){deny(e,error.message,c);return fail(error.message,c);}
          const callId=pendingWindows.shift();
          if(!callId){deny(e,'window tool use missing from trace',c);return fail('unobserved window request',c);}
          if(audit.proof({kind:'window',call:calls.get(callId)?.event,result:e,callId}).status!=='confirmed')return missing('native window acceptance missing',c);
          const answer=text=>{
            const reply=windowReply('claude',input,{...plan.policy,...(text!==undefined?{text}:{})},e.request_id);
            receipts.set(callId,reply);lastFreeQuestion=undefined;beginTurn();c.send(reply);replies.push({index:replies.length,requestId:e.request_id,callId,target:plan.target,role:plan.role,policy:plan.policyName,replySent:true,received:false});
          };
          if(plan.free?.length){
            const question=plan.free.map(q=>q.question).join('\n');
            persona(question).then(answer).catch(error=>missing(error.message,c));
          }else answer();
        }else{
          const reason=toolViolation(name,input,request.scenario,confirmed)??(phase==='confirm'&&isWrite(name)?'write during workspace confirmation':null);
          if(reason){deny(e,reason,c);return fail(reason,c);}
          waiting=false;c.send({type:'control_response',response:{subtype:'success',request_id:e.request_id,response:{behavior:'allow',updatedInput:input}}});
        }
      }
      if(e.type==='result'&&!e.parent_tool_use_id){
        if(audit.proof({kind:'terminal',result:e}).status!=='confirmed')return missing('successful Claude terminal result missing',c);
        if(phase==='confirm'){
          if(!confirmed)return missing('workspace not confirmed before stage',c);
          phase=request.seed?'seed':'stage';beginTurn();c.send(userMessage(request.seed?.prompt??request.scenario.prompt));
        }else if(phase==='seed'){
          try{seedRoute=checkSeedRoute(request);}catch(error){return error instanceof MissingEvidence?missing(error.message,c):fail(error.message,c);}
          phase='stage';beginTurn();c.send(userMessage(request.scenario.prompt));
        }else{waiting=true;if(request.scenario.stopAfterExpectedWindows!==false&&targetsAnswered(request,replies)&&replies.every(r=>r.received)&&!pendingWindows.length&&!(roleWindows(request.scenario.expectedWindows)&&lastMessage.includes('?'))){endLine=line;c.complete();}else c.idle();}
      }else if(waiting)c.idle();
    },
    onIdle:async c=>{
      const free=request.scenario.freeQuestions?.[freeIndex];
      if((free&&lastMessage.includes(free.contains))||(roleWindows(request.scenario.expectedWindows)&&lastMessage.includes('?'))){
        const question=lastMessage;
        if(roleWindows(request.scenario.expectedWindows)&&lastFreeQuestion===question)return fail('repeated free question without progress',c);
        lastFreeQuestion=question;beginTurn();try{const answer=await persona(question);beginTurn();c.send(userMessage(answer));freeReplies.push({question,answer,policy:'persona'});}catch(error){if(error instanceof MissingEvidence)return missing(error.message,c);throw error;}
      }else c.end();
    }});
  await Promise.allSettled([...personaTasks]);
  if(!waiting&&!violation&&!evidenceMissing&&processResult.code===0&&!processResult.failure)evidenceMissing='fresh Claude parent terminal missing after last sent continuation';
  return finishRun(request,{trace,sent,replies,freeReplies,confirmed,seedRoute,process:processResult,violation,evidenceMissing,endLine,boundary:'Claude denies unlisted tools before permission; user/global instructions and customizations may still load.'});
}

function rolloutFiles(home){
  const walk=d=>fs.existsSync(d)?fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]):[];
  return walk(path.join(home,'sessions')).filter(f=>path.basename(f).startsWith('rollout-')&&f.endsWith('.jsonl'));
}
function rolloutFor(home,thread){
  const found=rolloutFiles(home).filter(f=>f.includes(thread));
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
    const result=spawnSync(binary.command,[...(binary.args??[]),...args],{cwd:request.cwd,env,encoding:'utf8',timeout:request.timeoutMs??3_600_000,maxBuffer:16*1024*1024});
    fs.appendFileSync(path.join(request.outputDir,'setup.log'),(result.stdout??'')+(result.stderr??''));
    if(result.status!==0||result.error)throw new Error('Codex local pack setup failed');
  }
  let thread=null,rollout=null,confirmed=false,violation=null,seenLines=0,freeIndex=0,endLine,seedRoute,cardCheck,lastFreeQuestion;
  const replies=[],freeReplies=[],seen=new Set(),auditedTraces=new Set(),deadline=Date.now()+(request.timeoutMs??3_600_000),proofCalls=new Map();
  const stdout=path.join(request.outputDir,'stdout.jsonl'),sent=path.join(request.outputDir,'sent.jsonl');fs.writeFileSync(stdout,'');fs.writeFileSync(sent,'');
  let processResult;
  const turn=async(prompt,confirm=false,replyRecord=null)=>{
    const args=thread?['exec','resume',...codexCommon(request),thread,prompt]:['exec',...codexCommon(request),'-s','read-only','-C',request.cwd,prompt];
    processResult=await hostProcess({binary,args,cwd:request.cwd,env,trace:stdout,sent,stderr:path.join(request.outputDir,'stderr.log'),timeoutMs:Math.max(1,deadline-Date.now()),onEvent:(e,c)=>{if(e.type==='thread.started'){if(thread&&thread!==e.thread_id)throw new Error('thread changed');thread=e.thread_id;}if(replyRecord&&request.scenario.stopAfterExpectedWindows!==false&&targetsAnswered(request,replies)&&e.type==='turn.completed')c.complete();}});
    if(processResult.code!==0||processResult.failure)throw new Error(`Codex process failed: ${processResult.failure??processResult.code}`);
    if(!thread)throw new Error('Codex thread id missing');rollout=rolloutFor(home,thread);
    await quiet(rollout,processResult.completed?Math.min(request.idleMs??1000,100):request.idleMs??1000,deadline);
    if(processResult.completed){const terminal=codexTerminals(readJsonLines(rollout).events.filter(r=>r.line>seenLines))[0];if(!terminal)throw new MissingEvidence('last answered continuation terminal missing');endLine=terminal.line;}
    const {rows}=traceRows(rollout,'codex',{endLine});
    const fresh=rows.filter(r=>r.line>seenLines);seenLines=rows.at(-1)?.line??0;
    const audit=auditRows('codex',fresh);
    for(const file of rolloutFiles(home)){
      const auditRowsForFile=file===rollout?fresh:traceRows(file,'codex').rows;
      auditedTraces.add(file);
      for(const call of auditRows('codex',auditRowsForFile).calls.filter(c=>c.name.startsWith('mcp__'))){
        const reason=toolViolation(call.name,call.input,request.scenario,confirmed)??(confirm&&isWrite(call.name)?'write during workspace confirmation':null);
        if(reason){violation=`${file}:${call.line}: ${reason}`;throw new Error(violation);}
      }
    }
    if(replyRecord){
      replyRecord.received=fresh.some(r=>audit.proof({kind:'answer',call:replyRecord.nativeCall,result:r.value,callId:replyRecord.callId,prompt}).status==='confirmed');
      if(!replyRecord.received)throw new MissingEvidence('window reply not observed in resumed rollout');
    }
    let retryError;
    for(const r of fresh){
      const e=r.value,p=e.payload;
      if(e.type!=='response_item')continue;
      for(const call of audit.calls.filter(call=>call.line===r.line)){
        if(call.name==='request_user_input_async'){
          if(confirm){violation=`${rollout}:${r.line}: window during workspace confirmation`;throw new Error(violation);}
          continue;
        }
        const reason=toolViolation(call.name,call.input,request.scenario,confirmed)??(confirm&&isWrite(call.name)?'write during workspace confirmation':null);
        if(reason){violation=`${rollout}:${r.line}: ${reason}`;throw new Error(violation);}
        if(confirm&&call.name===request.workspaceProof.tool){
          if(!workspaceReadCall(p,request.workspaceProof))throw new MissingEvidence(`${rollout}:${r.line}: exec does not establish an executed workspace read`);
          if(proofCalls.has(call.callId))throw new MissingEvidence('duplicate workspace read call id');
          proofCalls.set(call.callId,{kind:'workspace',call:e});
        }
      }
      if(p&&proofCalls.has(p.call_id)&&['function_call_output','custom_tool_call_output'].includes(p.type)){
        const pending=proofCalls.get(p.call_id);
        const evidence=audit.proof({kind:pending.kind,call:pending.call,result:e,proof:request.workspaceProof});
        if(evidence.status==='unverified'){
          const error=new MissingEvidence(`${rollout}:${r.line}: successful ${pending.kind} result missing`);
          if(!confirm||!JSON.stringify(p.output).includes(`TypeError: tools.${request.workspaceProof.tool} is not a function`))throw error;
          error.retryWorkspace=true;retryError=error;proofCalls.delete(p.call_id);continue;
        }
        if(evidence.status==='mismatch')throw new Error('monotest workspace read did not match proof');
        if(pending.kind==='workspace')confirmed=true;
        proofCalls.delete(p.call_id);
      }
    }
    if(proofCalls.size)throw new MissingEvidence('linked native result missing');
    if(!completedTrace('codex', fresh))throw new MissingEvidence('Codex current continuation incomplete');
    if(endLine&&roleWindows(request.scenario.expectedWindows)&&codexWindows(fresh,rollout,{phase:'card'}).some(w=>!seen.has(w.callId)))endLine=undefined;
    if(retryError)throw retryError;
    return fresh;
  };
  try{
    const confirmationPrompt=`Только чтение: вызови ${request.workspaceProof.tool} и покажи пространство. Через exec выполни дословно, без добавлений: ${workspaceReadCode(request.workspaceProof)} Не имитируй результат. Ничего не записывай, затем остановись.`;
    let confirmationRows;
    for(let attempt=0;attempt<2;attempt++){try{confirmationRows=await turn(confirmationPrompt,true);break;}catch(error){if(!error.retryWorkspace||attempt===1)throw error;proofCalls.clear();}}
    if(!confirmed)throw new MissingEvidence('workspace not confirmed before stage');
    let scenarioStart=confirmationRows.at(-1)?.line??0;
    if(request.seed){
      const seeded=await turn(request.seed.prompt);
      if(codexWindows(seeded,rollout,{phase:'card'}).length)throw new Error('window during seed preparation');
      seedRoute=checkSeedRoute(request);scenarioStart=seeded.at(-1)?.line??scenarioStart;
    }
    let rows=await turn(request.scenario.prompt);
    for(let n=0;n<(request.maxTurns??(roleWindows(request.scenario.expectedWindows)?128:32));n++){
      if(endLine)break;
      const windows=codexWindows(rows.filter(r=>r.line>scenarioStart),rollout,{phase:'card'}).filter(w=>!seen.has(w.callId));
      if(windows.length){
        const uncertain=windows.find(w=>!w.executionConfirmed);
        if(uncertain)throw new MissingEvidence(`${uncertain.evidence}: ${uncertain.reason}`);
        if(windows.length!==1)throw new Error('multiple unanswered windows in one turn');
        const window=windows[0],plan=windowPolicy(request.scenario,window.questions,replies);
        const checked=checkTrace({host:'codex',trace:rollout,expectedWindows:roleWindows(request.scenario.expectedWindows)?request.scenario.expectedWindows:request.scenario.expectedWindows.slice(0,replies.length+1),rulesRoot:request.rulesRoot,phase:'card'});
        if(checked.status!=='passed'){cardCheck=checked;throw new Error('window/summary check failed before reply');}
        const policy={...plan.policy};if(plan.free?.length)policy.text=await runPersona(request,plan.free.map(q=>q.title).join('\n'),freeIndex++);
        const reply=windowReply('codex',{questions:window.questions},policy,window.callId);
        fs.appendFileSync(sent,JSON.stringify({thread,prompt:reply})+'\n');
        lastFreeQuestion=undefined;seen.add(window.callId);replies.push({index:replies.length,callId:window.callId,target:plan.target,role:plan.role,policy:plan.policyName,replySent:true,received:false,nativeCall:rows.find(r=>r.value.payload?.call_id===window.callId)?.value,...(['empty','refuse'].includes(policy.mode)?{note:'Codex CLI form observed; app empty/refusal form not observed'}:{})});
        rows=await turn(reply,false,replies.at(-1));continue;
      }
      const last=codexItems(rows).filter(r=>r.item?.type==='message'&&r.item.role==='assistant').at(-1)?.item;
      const lastMessage=(last?.content??[]).filter(b=>b.type==='output_text').map(b=>b.text).join('\n');
      const free=request.scenario.freeQuestions?.[freeIndex];
      if((free&&lastMessage.includes(free.contains))||(roleWindows(request.scenario.expectedWindows)&&lastMessage.includes('?'))){
        if(roleWindows(request.scenario.expectedWindows)&&lastFreeQuestion===lastMessage)throw new Error('repeated free question without progress');
        lastFreeQuestion=lastMessage;const answer=await runPersona(request,lastMessage,freeIndex++);rows=await turn(answer);freeReplies.push({question:lastMessage,answer,policy:'persona'});continue;
      }
      return finishRun(request,{trace:rollout,sent,replies,freeReplies,confirmed,seedRoute,auditedTraces:[...auditedTraces],process:processResult,violation,boundary:'Codex has no pre-execution refusal: private home, disabled linear/apps, first read-only turn and post-turn direct-call audit. A violation may already have executed; report failed.'});
    }
    if(endLine)return finishRun(request,{trace:rollout,sent,replies,freeReplies,confirmed,seedRoute,auditedTraces:[...auditedTraces],process:processResult,violation,endLine,boundary:'Scenario ended at the terminal after its last expected answer.'});
    throw new Error('scenario turn limit reached');
  }catch(error){
    return finishRun(request,{trace:rollout??stdout,sent,replies,freeReplies,confirmed,seedRoute,cardCheck,auditedTraces:[...auditedTraces],process:processResult,violation:error instanceof MissingEvidence?null:violation??error.message,evidenceMissing:error instanceof MissingEvidence?error.message:null,boundary:'Codex cannot refuse MCP calls before execution; rollout audit failed.'});
  }
}

function finishRun(request,run){
  const check=checkTrace({host:request.host,trace:run.trace,expectedWindows:request.scenario.expectedWindows,rulesRoot:request.rulesRoot,endLine:run.endLine,sent:run.sent});
  let notes=[];try{const {rows}=traceRows(run.trace,request.host,{endLine:run.endLine});notes=auditRows(request.host,rows).notes;}catch{}
  const failure=run.violation??(run.evidenceMissing?null:run.process?.failure??(run.process?.code!==0?'host process failed':null));
  const allReplied=targetsAnswered(request,run.replies)&&run.replies.every(r=>r.received)&&check.windows.every(w=>run.replies.some(r=>r.callId===w.callId&&r.received));
  const status=failure?'failed':run.evidenceMissing?'unverified':check.status!=='passed'?check.status:allReplied?'passed':'unverified';
  return {host:request.host,status,...run,check,notes,reason:failure??run.evidenceMissing??(!allReplied?'not every expected window was answered':null),conversation:{status:'unverified',rubric:'references/qa-skills.md#рубрика-разговора'}};
}

export async function runScenario(request){
  let run,created=false;
  try{
    validate(request);fs.mkdirSync(request.outputDir);created=true; // a run never overwrites another run
    run=request.host==='claude'?await runClaude(request):await runCodex(request);
    fs.writeFileSync(path.join(request.outputDir,'result.json'),JSON.stringify(run,null,2)+'\n');return run;
  }catch(error){
    const result={host:request.host,status:'unverified',reason:error.message,...(run?{run}:{})};
    if(created&&!fs.existsSync(path.join(request.outputDir,'result.json')))fs.writeFileSync(path.join(request.outputDir,'result.json'),JSON.stringify(result,null,2)+'\n');return result;
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));if(typeof request.scenario==='string')request.scenario=JSON.parse(fs.readFileSync(request.scenario,'utf8'));const r=await runScenario(request);console.log(JSON.stringify(r,null,2));process.exitCode=r.status==='passed'?0:r.status==='failed'?1:2;}
  catch(error){console.error(error.message);process.exitCode=2;}
}
