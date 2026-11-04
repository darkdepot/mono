#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditRows, parentTurns } from './skills-audit.mjs';
import { RecordDump } from './skills-dump.mjs';
import { readJsonLines } from './transports/journal.mjs';
import { hostProcess } from './skills-process.mjs';
import { stageDriverTool, permittedStages } from './skills-stage-driver.mjs';
import { textReply, validateReplies, isOwnerWindow, checkStageResponse } from './skills-owner.mjs';
import { checkTrace, completedTrace, codexTerminals } from './skills-trace.mjs';
import { traceRows } from './skills-probe.mjs';
import { mcpConfig, privateCodexHome, toolViolation, workspaceReadCall, workspaceReadCode, MissingEvidence, isWrite } from './skills-boundary.mjs';

const userMessage = text => ({type:'user',message:{role:'user',content:[{type:'text',text}]},parent_tool_use_id:null,session_id:''});
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
function childEnv(home){const env={...process.env};delete env.ANTHROPIC_API_KEY;delete env.ANTHROPIC_AUTH_TOKEN;delete env.OPENAI_API_KEY;if(home)env.CODEX_HOME=home;return env;}
function modelArgs(request){return request.model?['--model',request.model]:[];}
function codexCommon(request){return ['--json','--disable','apps','--disable','remote_plugin','--skip-git-repo-check','-c','approval_policy="never"','-c','sandbox_mode="workspace-write"','-c','sandbox_workspace_write.network_access=true',...(request.writableRoots?.length?['-c',`sandbox_workspace_write.writable_roots=${JSON.stringify(request.writableRoots)}`]:[]),...modelArgs(request)];}
const targetsAnswered=(request,replies)=>replies.length===request.scenario.expectedReplies.length;
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
function requestToolViolation(request,name,input,confirmed) {
  if(isOwnerWindow(name))return 'stage called a window in text scenario';
  return (request.recordDump&&!name.startsWith('mcp__')&&!['exec'].includes(name)?'fixed dump does not permit host commands':null) ?? toolViolation(name,input,request.scenario,confirmed) ?? (request.readOnlyDump && name.startsWith('mcp__') &&
    (!name.startsWith('mcp__monotest__') || isWrite(name)) ? 'record dump permits monotest reads only' : null);
}
function validate(request){
  if(!['claude','codex'].includes(request.host)||!path.isAbsolute(request.outputDir??'')||!path.isAbsolute(request.cwd??'')||!path.isAbsolute(request.packRoot??''))throw new Error('host and absolute outputDir/cwd/packRoot required');
  if(!request.scenario?.prompt?.trim()||(request.scenario.allowedTools!==undefined&&request.scenario.allowedTools!=='*'&&!Array.isArray(request.scenario.allowedTools)))throw new Error('scenario prompt and allowedTools required');
  if(request.scenario.expectedWindows?.length||request.scenario.windows?.length)throw new Error('window scenarios are retired; expectedReplies required');
  if(!request.readOnlyDump)validateReplies(request.scenario.expectedReplies);
  const proof=request.workspaceProof;
  if(!/^mcp__monotest__\w+$/.test(proof?.tool??'')||!Array.isArray(proof.path)||proof.equals==null||isWrite(proof.tool))throw new Error('explicit monotest read proof required');
  mcpConfig(request.mcpServers);
  if(request.readOnlyDump && (Object.keys(request.mcpServers).some(k=>k!=='monotest') || request.scenario.expectedReplies?.length))throw new Error('read-only dump requires only monotest and no windows');
  if(request.recordDump&&(!request.readOnlyDump||request.recordDump.dumpDir!==path.join(request.outputDir,'dump')))throw new Error('fixed dump directory must be outputDir/dump');
  if(request.writableRoots!==undefined&&(!Array.isArray(request.writableRoots)||request.writableRoots.some(dir=>!path.isAbsolute(dir))))throw new Error('absolute writableRoots required');
  for(const key of ['timeoutMs','idleMs'])if(request[key]!==undefined&&(!Number.isFinite(request[key])||request[key]<=0))throw new Error(`invalid ${key}`);
  if(request.seed){
    const seed=request.seed;
    if(!seed.prompt?.trim()||!path.isAbsolute(seed.projectFile??'')||fs.existsSync(seed.projectFile)||!seed.projectName)throw new Error('fresh seed prompt/projectFile/projectName required');
    if(seed.expectedStage&&(!path.isAbsolute(seed.dumpDir??'')||fs.existsSync(seed.dumpDir)||!path.isAbsolute(seed.configFile??'')))throw new Error('fresh route dump and config paths required');
  }
}

export async function runClaude(request){
  const dump=request.recordDump?new RecordDump(request.recordDump):null;let dumpStart=0;
  const trace=path.join(request.outputDir,'trace.jsonl'),sent=path.join(request.outputDir,'sent.jsonl');fs.writeFileSync(trace,'');fs.writeFileSync(sent,'');
  const config=path.join(request.outputDir,'mcp.json');fs.writeFileSync(config,JSON.stringify(mcpConfig(request.mcpServers)));
  const toolPolicy=request.scenario.allowedTools??'*';
  const allowed=toolPolicy.includes('*')?null:toolPolicy.filter(n=>!n.startsWith('mcp__'));
  const args=[...(request.writableRoots?.length?['--add-dir',...request.writableRoots]:[]),'-p','--verbose','--input-format','stream-json','--output-format','stream-json','--replay-user-messages','--permission-prompt-tool=stdio','--strict-mcp-config','--mcp-config',config,'--plugin-dir',request.packRoot,'--setting-sources','','--settings',JSON.stringify({enabledPlugins:{'mono@mono-marketplace':false}}),...(allowed?['--tools',allowed.join(',')]:[]),...modelArgs(request)];
  const calls=new Map(),replies=[],seenRequests=new Set();let confirmed=false,phase='confirm',seedEndLine,stageStartLine,waiting=false,violation=null,evidenceMissing=null,endLine,seedRoute,hostFailure=false;
  const beginTurn=()=>{waiting=false;};
  const deny=(e,message,c)=>c.send({type:'control_response',response:{subtype:'success',request_id:e.request_id,response:{behavior:'deny',message}}});
  const fail=(reason,c)=>{violation=reason;c.stop(reason);};
  const missing=(reason,c)=>{evidenceMissing=reason;c.stop(reason);};
  const processResult=await hostProcess({binary:request.binary??{command:'claude'},args,cwd:request.cwd,env:childEnv(),trace,sent,stderr:path.join(request.outputDir,'stderr.log'),timeoutMs:request.timeoutMs??3_600_000,idleMs:request.idleMs??240_000,
    input:userMessage(`Только чтение: вызови ${request.workspaceProof.tool}, покажи пространство. Ничего не записывай; затем остановись.`),
    onEvent:(e,c,line)=>{
      let audit;try{audit=auditRows('claude',[{value:e,line:0}]);}catch(error){return missing(error.message,c);}
      if(e.type==='system'&&e.subtype==='init'&&!e.parent_tool_use_id)beginTurn();
      if(e.type==='assistant'){
        if(!e.parent_tool_use_id&&(e.message?.content??[]).some(b=>['text','thinking','tool_use'].includes(b.type))){waiting=false;}
        for(const b of e.message?.content??[])if(b.type==='tool_use'){
          if(isOwnerWindow(b.name))return fail('stage called a window in text scenario',c);
          if(!e.parent_tool_use_id)calls.set(b.id,{event:e,block:b});
          {const reason=requestToolViolation(request,b.name,b.input,confirmed)??(phase==='confirm'&&isWrite(b.name)?'write during workspace confirmation':null);if(reason)return fail(reason,c);}
        }
      }
      if(phase==='stage'&&e.type==='user'&&!e.parent_tool_use_id){
        const proof=audit.proof({kind:'text-message',result:e}),reply=replies.at(-1);
        if(proof.status==='confirmed'&&reply&&!reply.received){
          if(proof.value!==reply.reply)return fail('actual owner reply differs from sent text',c);
          reply.received=true;
        }
      }
      if(e.type==='user'&&!e.parent_tool_use_id&&Array.isArray(e.message?.content))for(const b of e.message.content){
        if(b.type==='tool_result'){
          const call=calls.get(b.tool_use_id);
          const kind=call?.block.name===request.workspaceProof.tool?'workspace':null;
          if(kind){
            const evidence=audit.proof({kind,call:call?.event,result:e,callId:b.tool_use_id,proof:request.workspaceProof});
            if(evidence.status==='unverified')return missing(`successful ${kind} result missing`,c);
            if(evidence.status==='mismatch')return fail('monotest workspace read did not match proof',c);
            if(kind==='workspace')confirmed=true;
          }
        }
      }
      if(e.type==='control_request'&&e.request?.subtype==='can_use_tool'){
        if(seenRequests.has(e.request_id))return;seenRequests.add(e.request_id);
        const {tool_name:name,input}=e.request;
          const reason=requestToolViolation(request,name,input,confirmed)??(phase==='confirm'&&isWrite(name)?'write during workspace confirmation':null);
          if(reason){deny(e,reason,c);return fail(reason,c);}
          waiting=false;c.send({type:'control_response',response:{subtype:'success',request_id:e.request_id,response:{behavior:'allow',updatedInput:input}}});
      }
      if(e.type==='result'&&!e.parent_tool_use_id){
        if(audit.proof({kind:'terminal',result:e}).status!=='confirmed')return missing('successful Claude terminal result missing',c);
        if(phase==='confirm'){
          if(!confirmed)return missing('workspace not confirmed before stage',c);
          phase=request.seed?'seed':'stage';stageStartLine=line;dumpStart=line;beginTurn();c.send(userMessage(dump?dump.prompt():request.seed?.prompt??request.scenario.prompt));
        }else if(phase==='seed'){
          try{seedRoute=checkSeedRoute(request);}catch(error){return error instanceof MissingEvidence?missing(error.message,c):fail(error.message,c);}
          seedEndLine=line;stageStartLine=line;phase='stage';beginTurn();c.send(userMessage(request.scenario.prompt));
        }else if(dump){
          try{dump.consume('claude',traceRows(trace,'claude').rows.filter(r=>r.line>dumpStart));}catch(error){hostFailure=Boolean(error.hostFailure);return error instanceof MissingEvidence?missing(error.message,c):fail(error.message,c);}
          dumpStart=line;if(dump.done){waiting=true;endLine=line;c.complete();}else{beginTurn();c.send(userMessage(dump.prompt()));}
        }else if(request.readOnlyDump){
          waiting=true;endLine=line;c.complete();
        }else{
          if(replies.some(r=>!r.received))return missing('text reply not observed in native trace',c);
          const stageTurns=parentTurns('claude',traceRows(trace,'claude').rows).filter(t=>t.line>stageStartLine);
          if(stageTurns.length!==replies.length+1)return fail('unexpected stage turn without scenario policy',c);
          if(targetsAnswered(request,replies)){
            const turn=stageTurns.at(-1);
            if(!turn||turn.terminalLine!==line)return missing('final stage response missing',c);
            try{checkStageResponse(request.scenario.expectedReplies.at(-1),turn.text);}catch(error){return fail(error.message,c);}
            waiting=true;c.complete();
          }
          else {
            const turn=stageTurns.at(-1);
            if(!turn||turn.terminalLine!==line)return missing('final stage message missing before text reply',c);
            let reply;try{reply=textReply(request.scenario,turn.text,replies.length);}catch(error){return fail(error.message,c);}
            replies.push({index:replies.length,id:request.scenario.expectedReplies[replies.length].id,kind:'text',reply,question:turn.text,shownLine:turn.line,target:true,received:false});
            beginTurn();c.send(userMessage(reply));
          }
        }
      }else if(waiting)c.idle();
    },onIdle:c=>c.end()});
  if(!waiting&&!violation&&!evidenceMissing&&processResult.code===0&&!processResult.failure)evidenceMissing='fresh Claude parent terminal missing after last sent continuation';
  return finishRun(request,{trace,sent,replies,confirmed,seedRoute,seedEndLine,stageStartLine,...(dump?{dumpComplete:dump.done,dumpFiles:dump.files}:{}),process:processResult,violation,evidenceMissing,hostFailure,endLine,boundary:'Claude denies unlisted tools before permission; user/global instructions and customizations may still load.'});
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
  const dump=request.recordDump?new RecordDump(request.recordDump):null;
  const home=path.join(request.outputDir,'codex-home');privateCodexHome(home,request.authFile,request.mcpServers);
  const env=childEnv(home),binary=request.binary??{command:'codex'};
  for(const args of [['plugin','marketplace','add',request.packRoot],['plugin','add','mono@mono-marketplace']]){
    const result=spawnSync(binary.command,[...(binary.args??[]),...args],{cwd:request.cwd,env,encoding:'utf8',timeout:request.timeoutMs??3_600_000,maxBuffer:16*1024*1024});
    fs.appendFileSync(path.join(request.outputDir,'setup.log'),(result.stdout??'')+(result.stderr??''));
    if(result.status!==0||result.error){if(request.readOnlyDump)throw Object.assign(new MissingEvidence('Codex local pack setup failed'),{hostFailure:true});throw new Error('Codex local pack setup failed');}
  }
  let thread=null,rollout=null,confirmed=false,violation=null,seenLines=0,endLine,seedRoute,seedEndLine,stageStartLine;
  const replies=[],auditedTraces=new Set(),deadline=Date.now()+(request.timeoutMs??3_600_000),proofCalls=new Map();
  const stdout=path.join(request.outputDir,'stdout.jsonl'),sent=path.join(request.outputDir,'sent.jsonl');fs.writeFileSync(stdout,'');fs.writeFileSync(sent,'');
  let processResult;
  const turn=async(prompt,confirm=false,replyRecord=null)=>{
    let hostError;
    const args=thread?['exec','resume',...codexCommon(request),thread,prompt]:['exec',...codexCommon(request),'-s','read-only','-C',request.cwd,prompt];
    processResult=await hostProcess({binary,args,cwd:request.cwd,env,trace:stdout,sent,stderr:path.join(request.outputDir,'stderr.log'),timeoutMs:Math.max(1,deadline-Date.now()),onEvent:(e,c)=>{if(e.type==='error'&&typeof e.message==='string')hostError=e.message;if(e.type==='thread.started'){if(thread&&thread!==e.thread_id)throw new Error('thread changed');thread=e.thread_id;}}});
    if(processResult.code!==0||processResult.failure){
      const reason=`Codex process failed: ${hostError??processResult.failure??processResult.code}`;
      if(request.readOnlyDump)throw Object.assign(new MissingEvidence(reason),{hostFailure:true});
      throw new Error(reason);
    }
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
        const reason=requestToolViolation(request,call.name,call.input,confirmed)??(confirm&&isWrite(call.name)?'write during workspace confirmation':null);
        if(reason){violation=`${file}:${call.line}: ${reason}`;throw new Error(violation);}
      }
    }
    if(replyRecord){
      replyRecord.received=fresh.some(r=>{
        const proof=audit.proof({kind:'text-message',result:r.value});
        return proof.status==='confirmed'&&proof.role==='user'&&proof.value===prompt;
      });
      if(!replyRecord.received)throw new MissingEvidence('text reply not observed in resumed rollout');
    }
    let retryError;
    for(const r of fresh){
      const e=r.value,p=e.payload;
      if(e.type!=='response_item')continue;
      for(const call of audit.calls.filter(call=>call.line===r.line)){
        const reason=requestToolViolation(request,call.name,call.input,confirmed)??(confirm&&isWrite(call.name)?'write during workspace confirmation':null);
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
    if(retryError)throw retryError;
    return fresh;
  };
  try{
    const confirmationPrompt=`Только чтение: вызови ${request.workspaceProof.tool} и покажи пространство. Через exec выполни дословно, без добавлений: ${workspaceReadCode(request.workspaceProof)} Не имитируй результат. Ничего не записывай, затем остановись.`;
    let confirmationRows;
    for(let attempt=0;attempt<2;attempt++){try{confirmationRows=await turn(confirmationPrompt,true);break;}catch(error){if(!error.retryWorkspace||attempt===1)throw error;proofCalls.clear();}}
    if(!confirmed)throw new MissingEvidence('workspace not confirmed before stage');
    if(request.seed){
      const seeded=await turn(request.seed.prompt);
      seedRoute=checkSeedRoute(request);seedEndLine=codexTerminals(seeded).at(-1)?.line;
    }
    if(dump){
      while(!dump.done){const rows=await turn(dump.prompt());dump.consume('codex',rows);}
      return finishRun(request,{trace:rollout,sent,replies,confirmed,auditedTraces:[...auditedTraces],process:processResult,violation,dumpComplete:dump.done,dumpFiles:dump.files});
    }
    stageStartLine=request.seed?seedEndLine:codexTerminals(confirmationRows).at(-1)?.line;
    let rows=await turn(request.scenario.prompt);
    if(request.readOnlyDump)return finishRun(request,{trace:rollout,sent,replies,confirmed,auditedTraces:[...auditedTraces],process:processResult,violation});
    for(let n=0;n<(request.maxTurns??request.scenario.expectedReplies.length+1);n++){
      if(endLine)break;
      {
        const stageTurns=parentTurns('codex',rows);
        if(stageTurns.length!==1)throw new Error('unexpected stage turn without scenario policy');
        if(targetsAnswered(request,replies)){
          const response=stageTurns[0];
          if(!response)throw new MissingEvidence('final stage response missing');
          checkStageResponse(request.scenario.expectedReplies.at(-1),response.text);
          return finishRun(request,{trace:rollout,sent,replies,confirmed,seedRoute,seedEndLine,stageStartLine,auditedTraces:[...auditedTraces],process:processResult,violation});
        }
        const turnMessage=stageTurns[0];
        if(!turnMessage)throw new MissingEvidence('final stage message missing before text reply');
        const reply=textReply(request.scenario,turnMessage.text,replies.length);
        const record={index:replies.length,id:request.scenario.expectedReplies[replies.length].id,kind:'text',reply,question:turnMessage.text,shownLine:turnMessage.line,target:true,received:false};
        replies.push(record);fs.appendFileSync(sent,JSON.stringify({thread,prompt:reply})+'\n');
        rows=await turn(reply,false,record);continue;
      }
    }
    throw new Error('scenario turn limit reached');
  }catch(error){
    if(request.readOnlyDump){
      for(const file of rolloutFiles(home))auditedTraces.add(file);
      if(!rollout&&thread)try{rollout=rolloutFor(home,thread);}catch{}
    }
    return finishRun(request,{hostFailure:Boolean(error.hostFailure),trace:rollout??stdout,sent,replies,confirmed,seedRoute,seedEndLine,stageStartLine,auditedTraces:[...auditedTraces],process:processResult,violation:error instanceof MissingEvidence?null:violation??error.message,evidenceMissing:error instanceof MissingEvidence?error.message:null,boundary:'Codex cannot refuse MCP calls before execution; rollout audit failed.'});
  }
}

function finishRun(request,run){
  if(request.readOnlyDump){
    let reason=run.violation??run.evidenceMissing??run.process?.failure??(request.recordDump&&!run.dumpComplete?'fixed dump incomplete':null);
    let complete=false;
    try{
      const {rows}=traceRows(run.trace,request.host);
      complete=completedTrace(request.host,rows);
      for(const call of auditRows(request.host,rows).calls){
        if(call.name.startsWith('mcp__')&&(!call.name.startsWith('mcp__monotest__')||isWrite(call.name)))reason??='record dump permits monotest reads only';
      }
    }catch(error){reason=error.message;}
    const status=run.violation?'failed':reason||!run.confirmed||!complete||run.process?.code!==0?'unverified':'passed';
    return {host:request.host,...run,status,hostFailure:Boolean(!run.violation&&(run.hostFailure||run.process&&(run.process.failure||run.process.code!==0))),reason:reason??(!complete?'incomplete dump trace':null)};
  }
  const check=checkTrace({host:request.host,trace:run.trace,expectedReplies:request.scenario.expectedReplies,rulesRoot:request.rulesRoot,endLine:run.endLine,stageStartLine:run.stageStartLine,sent:run.sent});
  let notes=[];try{const {rows}=traceRows(run.trace,request.host,{endLine:run.endLine});notes=auditRows(request.host,rows).notes;}catch{}
  const failure=run.violation??(run.evidenceMissing?null:run.process?.failure??(run.process?.code!==0?'host process failed':null));
  const allReplied=targetsAnswered(request,run.replies)&&run.replies.every(r=>r.received)&&check.exchanges?.length===request.scenario.expectedReplies.length;
  const status=failure?'failed':run.evidenceMissing?'unverified':check.status!=='passed'?check.status:allReplied?'passed':'unverified';
  return {host:request.host,status,...run,check,notes,reason:failure??run.evidenceMissing??(!allReplied?'not every expected text reply was observed':null),conversation:{status:'unverified',rubric:'references/qa-skills.md#рубрика-разговора'}};
}

export async function runScenario(request){
  let run,created=false;
  try{
    validate(request);
    if(!request.readOnlyDump&&request.scenario.expectedReplies.some(r=>r.driverStart)) {
      if(request.mcpServers.stage_driver)throw new Error('stage driver server is owned by the driver');
      const allowed=[...new Set(request.scenario.expectedReplies.flatMap(permittedStages))];
      request={...request,mcpServers:{...request.mcpServers,stage_driver:{command:process.execPath,args:[path.join(request.packRoot,'scripts/skills-stage-driver.mjs'),JSON.stringify(allowed)]}}};
    }
    fs.mkdirSync(request.outputDir);created=true; // a run never overwrites another run
    run=request.host==='claude'?await runClaude(request):await runCodex(request);
    fs.writeFileSync(path.join(request.outputDir,'result.json'),JSON.stringify(run,null,2)+'\n');return run;
  }catch(error){
    const result={host:request.host,status:'unverified',reason:error.message,...(error.hostFailure?{hostFailure:true}:{}),...(run?{run}:{})};
    if(created&&!fs.existsSync(path.join(request.outputDir,'result.json')))fs.writeFileSync(path.join(request.outputDir,'result.json'),JSON.stringify(result,null,2)+'\n');return result;
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));if(typeof request.scenario==='string')request.scenario=JSON.parse(fs.readFileSync(request.scenario,'utf8'));const r=await runScenario(request);console.log(JSON.stringify(r,null,2));process.exitCode=r.status==='passed'?0:r.status==='failed'?1:2;}
  catch(error){console.error(error.message);process.exitCode=2;}
}
