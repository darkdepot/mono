import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runScenario, runPersona, runClaude, runCodex } from './skills-run.mjs';
import { privateCodexHome, codexToolCalls, toolViolation, MissingEvidence } from './skills-boundary.mjs';
import { nativeProof } from './skills-proof.mjs';
// Synthetic native linkage around the recorded payload cuts.
function workspaceEvidence(output,proof){
 const call={type:'function_call',call_id:'read',name:'exec'},result={type:'function_call_output',call_id:'read',output};
 const status=nativeProof({host:'codex',kind:'workspace',call,result,proof}).status;
 return status==='unverified'?'missing':status;
}
const repo=process.cwd();
function setup(t,host,mode='ok'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skills-run-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const authFile=path.join(dir,'auth.json');fs.writeFileSync(authFile,'{}');
 return {host,cwd:dir,packRoot:repo,outputDir:path.join(dir,'out'),authFile,timeoutMs:2000,idleMs:10,binary:{command:process.execPath,args:[path.join(repo,'scripts/test-fixtures/skills-host.mjs'),mode,repo]},mcpServers:{monotest:{url:'https://example.test/mcp'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},scenario:{prompt:'Run stage',brief:'Владелец предпочитает синий.',allowedTools:['mcp__monotest__get_workspace','mcp__monotest__save_project'],windows:[{mode:'recommended'}],expectedWindows:[{id:'approval',decision:'описание',advice:'Research',reason:host==='codex'?'чтобы проверить':'риск',summary:['Что','Дальше:']}]}};
}
for(const host of ['claude','codex']){
 test(`${host}: one call drives read proof, window, reply and successful trace`,async t=>{
  const request=setup(t,host);const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies.length,1);assert.equal(r.check.windows[0].status,'passed');assert.ok(fs.existsSync(r.trace));
  const sent=fs.readFileSync(r.sent,'utf8');assert.match(sent,/Recommended/);
  if(host==='claude')assert.match(sent,/updatedInput/);else{assert.match(sent,/send_user_message_question_reply/);assert.match(fs.readFileSync(path.join(request.outputDir,'codex-home/config.toml'),'utf8'),/\[mcp_servers.linear\]\nenabled = false/);}
 });
 for(const mode of ['missing','linear','crash','timeout','cut','wrong-space'])test(`${host}: ${mode} cannot produce passed`,async t=>{
  const request=setup(t,host,mode);if(mode==='timeout')request.timeoutMs=100;
  const r=await runScenario(request);assert.notEqual(r.status,'passed',JSON.stringify(r));
  if(mode==='missing')assert.equal(r.status,'failed');
  if(mode==='linear'&&host==='claude'){const sent=fs.readFileSync(r.sent,'utf8');assert.match(sent,/"behavior":"deny"/);assert.match(sent,/outside test servers/);}
 });
 test(`${host}: persona is a single same-host call and tool output is rejected`,async t=>{
  for(const mode of ['ok','persona-tool']){
   const request=setup(t,host,mode);fs.mkdirSync(request.outputDir);
   if(mode==='ok'){assert.equal(await runPersona(request,'Какой цвет предпочитаешь?',0),'Предпочитаю синий.');const prompt=fs.readFileSync(path.join(request.outputDir,'persona-0/sent.jsonl'),'utf8');assert.equal(prompt,'');}
   else await assert.rejects(()=>runPersona(request,'Какой цвет предпочитаешь?',0),/persona not verified/);
  }
 });
}
for(const mode of ['window-not-accepted','window-error','window-missing-result','window-unlinked-result','window-schema-rejected','window-unknown-result','window-unknown-retry'])test(`Codex ${mode}: no answer without successful native window result`,async t=>{
 const request=setup(t,'codex',mode),r=await runScenario(request);
 assert.equal(r.status,'unverified',JSON.stringify(r));assert.equal(r.replies.length,0);assert.equal(r.check.windows[0].status,'unverified');
 const calls=fs.readFileSync(path.join(request.cwd,'invocations.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.args[0]==='exec');assert.equal(calls.length,2,'confirmation and stage only, no resume answer');
});
test('Codex late tools and read-only confirmation violation stop before sending stage answers',async t=>{
 for(const mode of ['late-tool','write-before-proof']){const r=await runScenario(setup(t,'codex',mode));assert.equal(r.status,'failed');assert.equal(r.replies.length,0);}
});
test('Codex home refuses reuse and foreign servers; exec audit sees actual tool names, not URL text',t=>{
 const request=setup(t,'codex');const home=path.join(request.cwd,'private');privateCodexHome(home,request.authFile,request.mcpServers);assert.throws(()=>privateCodexHome(home,request.authFile,request.mcpServers));assert.throws(()=>privateCodexHome(path.join(request.cwd,'bad'),request.authFile,{linear:{url:'https://example.test'}}));
 assert.equal(codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'x',input:'text(await tools.mcp__monotest__get_workspace({}));'})[0].name,'mcp__monotest__get_workspace');
 assert.throws(()=>codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'audit',input:'await tools[name]({})'}));
 assert.equal(toolViolation('Bash',{command:'cat fixture-with-linear.app'}, {allowedTools:['Bash'],allowedCommands:['cat fixture-with-linear.app']},true),null);
});

for(const host of ['claude','codex'])test(`${host}: all six scenario policies and explicit free question use the child transport`,async t=>{
 for(const policy of [{mode:'recommended'},{mode:'label',label:'Утвердить, продолжу позже'},{mode:'correction',text:'Поправь описание.'},{mode:'empty'},{mode:'refuse',text:'Не буду отвечать на этот вопрос.'},{mode:'discuss'}]){
  const request=setup(t,host);request.scenario.windows=[policy];const r=await runScenario(request);assert.equal(r.status,host==='claude'&&policy.mode==='refuse'?'unverified':'passed',JSON.stringify(r));assert.equal(r.replies[0].policy,policy.mode);
 }
 const request=setup(t,host,'free');request.scenario.freeQuestions=[{contains:'Какой цвет предпочитаешь?'}];const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.ok(fs.existsSync(path.join(request.outputDir,'persona-0/trace.jsonl')));assert.ok(!fs.existsSync(path.join(request.outputDir,'persona-1')));
});
test('actual child invocation retains isolation flags, plugin copy and no-tools persona constraints',async t=>{
 for(const host of ['claude','codex']){
  const request=setup(t,host);assert.equal((await runScenario(request)).status,'passed');
  const rows=fs.readFileSync(path.join(request.cwd,'invocations.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const args=rows.at(-1).args;
  if(host==='claude'){
   for(const flag of ['--permission-prompt-tool=stdio','--strict-mcp-config','--plugin-dir','--setting-sources'])assert.ok(args.includes(flag));assert.equal(args[args.indexOf('--plugin-dir')+1],repo);assert.match(args[args.indexOf('--settings')+1],/mono@mono-marketplace.*false/);
  }else{
   assert.deepEqual(args.slice(0,2),['exec','resume']);assert.ok(args.includes('apps'));const first=rows.find(r=>r.args[0]==='exec');assert.equal(first.args[first.args.indexOf('-s')+1],'read-only');assert.notEqual(rows.at(-1).home,process.env.CODEX_HOME);
  }
  await runPersona(request,'Какой цвет предпочитаешь?',9);
  const p=JSON.parse(fs.readFileSync(path.join(request.outputDir,'persona-9/invocations.jsonl'),'utf8'));
  if(host==='claude')assert.equal(p.args[p.args.indexOf('--tools')+1],'');else for(const flag of ['--ignore-user-config','plugins','shell_tool','multi_agent','read-only'])assert.ok(p.args.includes(flag));
  assert.match(p.args.at(-1),/Владелец предпочитает синий/);assert.match(p.args.at(-1),/Какой цвет предпочитаешь/);
 }
});
test('literal commands inside Codex exec are authorized exactly; dynamic or omitted commands fail closed',()=>{
 const call=codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'x',input:'text(await tools.exec_command({"cmd": "pwd", "max_output_tokens": 100}));'})[0];
 assert.equal(call.input.cmd,'pwd');assert.equal(toolViolation(call.name,call.input,{allowedTools:['exec_command'],allowedCommands:['pwd']},true),null);
 assert.match(toolViolation(call.name,call.input,{allowedTools:['exec_command'],allowedCommands:['ls']},true),/command/);
 for(const code of ['await tools.exec_command({cmd: command})','await tools.exec_command({...options,cmd: "pwd"})'])assert.throws(()=>codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'audit',input:code}));
});
test('Codex exec aliases cannot hide a foreign call beside a legitimate read',()=>{
 for(const code of ['const t=tools; await t.mcp__linear__save_project({}); text(await tools.mcp__monotest__get_workspace({}));','const t=globalThis["to"+"ols"]; text(await tools.mcp__monotest__get_workspace({}));'])assert.throws(()=>codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'audit',input:code}));
});
test('a monotest write without prior proof is denied even if listed in the scenario',()=>{
 assert.match(toolViolation('mcp__monotest__save_project',{}, {allowedTools:['mcp__monotest__save_project']},false),/before workspace confirmation/);
});
test('computed and overwritten Codex commands are not authorized as their first literal',()=>{
 for(const code of ['await tools.exec_command({cmd: "pwd" + "; uname -a"})','await tools.exec_command({cmd: "pwd", cmd: "uname -a"})']){
  let rejected=false;try{const call=codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'audit',input:code})[0];rejected=Boolean(toolViolation(call.name,call.input,{allowedTools:['exec_command'],allowedCommands:['pwd']},true));}catch{rejected=true;}
  assert.equal(rejected,true,code);
 }
});
test('a Claude child result cannot fail the parent stage or start its waiting state',async t=>{
 const request=setup(t,'claude','child');const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));
});
for(const host of ['claude','codex'])test(`${host}: sending a reply without observing delivery is not green`,async t=>{
 const r=await runScenario(setup(t,host,'unanswered'));assert.equal(r.status,'unverified',JSON.stringify(r));
});

test('native command fields cannot authorize an alias instead of the executed command',()=>{
 const scenario={allowedTools:['exec_command','Bash'],allowedCommands:['pwd']};
 assert.equal(toolViolation('exec_command',{cmd:'pwd'},scenario,true),null);
 assert.equal(toolViolation('Bash',{command:'pwd'},scenario,true),null);
 for(const [name,input] of [['exec_command',{cmd:'uname -a',command:'pwd'}],['exec_command',{command:'pwd'}],['Bash',{cmd:'pwd'}],['Bash',{command:'uname -a',cmd:'pwd'}]])assert.ok(toolViolation(name,input,scenario,true),JSON.stringify({name,input}));
});
for(const host of ['claude','codex'])test(`${host}: absent, unlinked or errored workspace evidence is unverified before stage`,async t=>{
 for(const mode of ['missing-proof-result','unlinked-proof','errored-proof']){
  const request=setup(t,host,mode),r=await runScenario(request);
  assert.equal(r.status,'unverified',JSON.stringify(r));assert.equal(r.confirmed,false);assert.equal(r.replies.length,0);
  assert.ok(!fs.readFileSync(r.sent,'utf8').includes('Run stage'));
 }
});
test('Codex comments and strings cannot pretend to execute the workspace read',async t=>{
 for(const mode of ['comment-proof','string-proof','conflicting-proof-fields']){
  const request=setup(t,'codex',mode),r=await runScenario(request);
  assert.equal(r.status,'unverified',JSON.stringify(r));assert.equal(r.confirmed,false);
  const execs=fs.readFileSync(path.join(request.cwd,'invocations.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.args[0]==='exec');assert.equal(execs.length,1);
 }
});
test('Codex custom exec read and its matching native output preserve the passing control',async t=>{
 const r=await runScenario(setup(t,'codex','custom-proof'));assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.confirmed,true);
});
test('Codex Unicode exec escapes and unknown native item kinds are unverified beside the passing control',async t=>{
 for(const mode of ['custom-proof','unicode-exec','native-web-search','unknown-native-item']){
  const r=await runScenario(setup(t,'codex',mode));assert.equal(r.status,mode==='custom-proof'?'passed':'unverified',JSON.stringify(r));
 }
 for(const source of [String.raw`await \u{74}ools.exec_command({"cmd":"uname -a"}); await tools.exec_command({"cmd":"pwd"});`,String.raw`await tools.exec_command({"cmd":"p\u0077d"});`])assert.throws(()=>codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'escaped',input:source}),MissingEvidence);
 for(const type of ['web_search_call','computer_call','future_call','future_item'])assert.throws(()=>codexToolCalls({type}),MissingEvidence);
 for(const type of ['message','reasoning','function_call_output','custom_tool_call_output'])assert.deepEqual(codexToolCalls({type}),[]);
});
test('Codex later allowed workspace reads do not repeat the closed first-read form',async t=>{
 const r=await runScenario(setup(t,'codex','later-read'));assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.confirmed,true);
});
test('native input_text probe cut decodes successfully and every error unwrap remains missing',async t=>{
 const sample=JSON.parse(fs.readFileSync(path.join(repo,'evals/scenarios/probe/samples/codex/workspace-input-text.json')));
 const expected=JSON.stringify({id:'workspace-test',name:'Test Space',url:'https://example.test/workspace'});
 assert.equal(workspaceEvidence(sample.output,{path:['result','value','content',0,'text'],equals:expected}),'confirmed');
 const proof={path:['name'],equals:'Test Space'},value={name:'Test Space'};
 assert.equal(workspaceEvidence([{type:'input_text',text:JSON.stringify(value)}],proof),'confirmed');
 for(const wrap of [v=>({structuredContent:v}),v=>({content:JSON.stringify(v)}),v=>({content:[{type:'text',text:JSON.stringify(v)}]}),v=>[{type:'input_text',text:JSON.stringify(v)}]]){
  assert.equal(workspaceEvidence(wrap(value),proof),'confirmed');
  for(const error of [{isError:true,structuredContent:value},{isError:true,content:[{type:'text',text:JSON.stringify(value)}]},{is_error:true,content:JSON.stringify(value)}])assert.equal(workspaceEvidence(JSON.stringify(wrap(error)),proof),'missing');
 }
 for(const mode of ['native-input-text','nested-error-proof']){const r=await runScenario(setup(t,'codex',mode));assert.equal(r.status,mode==='native-input-text'?'passed':'unverified',JSON.stringify(r));}
});
test('native workspace proof rejects an error on every path ancestor and preserves its passing control',async t=>{
 const sample=JSON.parse(fs.readFileSync(path.join(repo,'evals/scenarios/probe/samples/codex/workspace-input-text.json')));
 const proof={path:['result','value','content',0,'text'],equals:JSON.stringify({id:'workspace-test',name:'Test Space',url:'https://example.test/workspace'})};
 const value=JSON.parse(sample.output[0].text);
 const wrappers=[v=>[{type:'input_text',text:JSON.stringify(v)}],v=>({structuredContent:v}),v=>({content:JSON.stringify(v)}),v=>({content:[{type:'text',text:JSON.stringify(v)}]})];
 for(const wrap of wrappers){
  assert.equal(workspaceEvidence(wrap(value),proof),'confirmed');
  for(const path of [[],['result'],['result','value'],['result','value','content',0]])for(const flag of ['isError','is_error']){
   const errored=structuredClone(value);let ancestor=errored;for(const key of path)ancestor=ancestor[key];ancestor[flag]=true;
   assert.equal(workspaceEvidence(wrap(errored),proof),'missing',JSON.stringify({path,flag}));
  }
 }
 const leaf={isError:true};assert.equal(workspaceEvidence({leaf},{path:['leaf'],equals:leaf}),'missing');
 for(const mode of ['native-probe-proof','native-probe-error']){
  const request=setup(t,'codex',mode);request.workspaceProof={...request.workspaceProof,...proof};
  const r=await runScenario(request);assert.equal(r.status,mode==='native-probe-proof'?'passed':'unverified',JSON.stringify(r));
  if(mode==='native-probe-error'){assert.equal(r.confirmed,false);assert.equal(r.replies.length,0);}
 }
});
test('Claude failed or different answer receipts remain unverified next to the successful control',async t=>{
 for(const mode of ['ok','error-answer','wrong-answer']){
  const r=await runScenario(setup(t,'claude',mode));assert.equal(r.status,mode==='ok'?'passed':'unverified',JSON.stringify(r));assert.equal(r.replies[0].received,mode==='ok');
 }
 const request=setup(t,'claude','wrong-refusal');request.scenario.windows=[{mode:'refuse',text:'Не буду отвечать на этот вопрос.'}];assert.equal((await runScenario(request)).status,'unverified');
});

// Synthetic mutations of native controls; no refusal/error shape is claimed observed.
test('shared proof gate: every consumer rejects the same synthetic envelope errors',async t=>{
 for(const host of ['claude','codex'])for(const consumer of ['workspace','command','answer','window'])for(const shape of host==='codex'&&consumer==='workspace'?['function','custom']:['function'])for(const flag of ['isError','is_error'])for(const layer of ['outer','native']){
  const request=setup(t,host,`proof-${consumer}-${shape}-${flag}-${layer}`);
  request.scenario.allowedTools.push('Bash','exec_command');request.scenario.allowedCommands=['pwd'];
  const r=await runScenario(request);assert.equal(r.status,'unverified',JSON.stringify({host,consumer,shape,flag,layer,r}));
 }
});

test('linked successful command controls remain green through the shared gate',async t=>{
 for(const host of ['claude','codex'])for(const mode of host==='codex'?['command-ok','custom-command-ok']:['command-ok']){
  const request=setup(t,host,mode);request.scenario.allowedTools.push('Bash','exec_command');request.scenario.allowedCommands=['pwd'];
  const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));
 }
});

test('Codex missing final proof is unverified rather than a violation',async t=>{
 const r=await runScenario(setup(t,'codex','cut'));
 assert.equal(r.status,'unverified',JSON.stringify(r));assert.equal(r.violation,null);assert.match(r.evidenceMissing,/incomplete/);
});

test('Claude recorded native window and successful JSON stdout pass end to end',async t=>{
 for(const mode of ['recorded-window','command-json']){
  const request=setup(t,'claude',mode);request.scenario.allowedTools.push('Bash');request.scenario.allowedCommands=['pwd'];
  const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies[0].received,true);
 }
});
test('Codex error-marked terminal proof is unverified for either native flag',async t=>{
 for(const mode of ['terminal-isError','terminal-is_error']){
  const r=await runScenario(setup(t,'codex',mode));assert.equal(r.status,'unverified',JSON.stringify(r));assert.equal(r.violation,null);assert.match(r.evidenceMissing,/incomplete/);
 }
});

// Same completed child traces enter every public behavioral reader. Unsupported
// forms are synthetic perturbations; the known control stays beside them.
test('online and offline entry points agree on the same native traces in both hosts',async t=>{
 const {checkTrace,codexWindows,codexItems,completedTrace}=await import('./skills-trace.mjs');
 const {traceRows,claudeWindows,probeClaude}=await import('./skills-probe.mjs');
 const {auditRows}=await import('./skills-audit.mjs');
 const observations=[];
 const verdict=fn=>{try{const v=fn();return typeof v==='boolean'?(v?'passed':'unverified'):Array.isArray(v)?v.some(w=>w.status==='unverified')?'unverified':v.some(w=>w.status==='failed')?'failed':'passed':v.status??'passed';}catch{return 'unverified';}};
 for(const host of ['claude','codex'])for(const mode of host==='codex'?['ok','unknown-native-item','unicode-exec']:['ok','unknown-native-item','unknown-native-block']){
  const request=setup(t,host,mode),online=await runScenario(request),trace=online.trace;
  const rows=(await import('./transports/journal.mjs')).readJsonLines(trace).events,expected=mode==='ok'?'passed':'unverified';
  const directRequest=setup(t,host,mode);fs.mkdirSync(directRequest.outputDir);
  const direct=await (host==='codex'?runCodex:runClaude)(directRequest);
  assert.deepEqual((await import('./transports/journal.mjs')).readJsonLines(direct.trace).events.map(r=>r.value),rows.map(r=>r.value),'direct driver and wrapper must receive identical trace contents');
  const paths={auditRows:verdict(()=>auditRows(host,rows)),runScenario:online.status,[host==='codex'?'runCodex':'runClaude']:direct.status,checkTrace:verdict(()=>checkTrace({host,trace,expectedWindows:request.scenario.expectedWindows})),traceRows:verdict(()=>traceRows(trace,host)),completedTrace:verdict(()=>completedTrace(host,rows))};
  if(host==='codex'){paths.codexWindows=verdict(()=>codexWindows(rows,trace));paths.codexItems=verdict(()=>codexItems(rows));}
  else{paths.claudeWindows=verdict(()=>claudeWindows(rows,trace));paths.probeClaude=verdict(()=>probeClaude(trace));}
  observations.push({host,mode,paths,expected:Object.fromEntries(Object.keys(paths).map(k=>[k,expected]))});
 }
 for(const host of ['claude','codex'])for(const mode of ['ok','persona-unknown']){
  const request=setup(t,host,mode);fs.mkdirSync(request.outputDir);
  let status='passed';try{await runPersona(request,'Какой цвет предпочитаешь?',0);}catch{status='unverified';}
  const trace=path.join(request.outputDir,'persona-0/trace.jsonl'),rows=(await import('./transports/journal.mjs')).readJsonLines(trace).events;
  const options={stdout:host==='codex'},paths={auditRows:verdict(()=>auditRows(host,rows,options)),runPersona:status,traceRows:verdict(()=>traceRows(trace,host,options)),completedTrace:verdict(()=>completedTrace(host,rows,options))};
  const expected=mode==='ok'?'passed':'unverified';observations.push({host,mode,paths,expected:Object.fromEntries(Object.keys(paths).map(k=>[k,expected]))});
 }
 assert.deepEqual(observations.map(r=>({...r,paths:r.expected})),observations);
});

// Synthetic proof gaps, beside the identical recorded-payload passing control.
// Compare finished traces only with finished readers, and card/excerpt with the
// same explicit phase; raw loaders and terminal predicates certify neither.
test('shared equality table distinguishes finished full traces, excerpt probes and pre-answer cards',async t=>{
 const {checkTrace,codexWindows}=await import('./skills-trace.mjs');
 const {traceRows,claudeWindows,probeClaude}=await import('./skills-probe.mjs');
 for(const host of ['claude','codex'])for(const mode of host==='claude'?['ok','missing-permission','unlinked-permission','errored-permission','unanswered']:['ok','window-missing-result','window-unlinked-result','window-error','unanswered']){
  const request=setup(t,host,mode),online=await runScenario(request),trace=online.trace;
  const rows=traceRows(trace,host).rows;
  const helper=host==='claude'?claudeWindows:codexWindows;
  const status=windows=>windows.some(w=>w.status==='unverified')?'unverified':windows.some(w=>w.status==='failed')?'failed':'passed';
  const expected=mode==='ok'?'passed':'unverified';
  const directRequest=setup(t,host,mode);fs.mkdirSync(directRequest.outputDir);
  const direct=await (host==='claude'?runClaude:runCodex)(directRequest);
  assert.deepEqual(traceRows(direct.trace,host).rows.map(r=>r.value),rows.map(r=>r.value),'same full trace for direct driver and wrapper');
  const paths={online:online.status,direct:direct.status,helper:status(helper(rows,trace)),check:checkTrace({host,trace,expectedWindows:request.scenario.expectedWindows}).status};
  if(host==='claude')paths.probe=probeClaude(trace).status;
  assert.deepEqual(paths,Object.fromEntries(Object.keys(paths).map(k=>[k,expected])),`${host}/${mode}: full`);
  for(const phase of ['excerpt','card']){
   const narrow=mode==='ok'||mode==='unanswered'||(phase==='excerpt'&&host==='claude'&&mode==='missing-permission')?'passed':'unverified';
   const checked=checkTrace({host,trace,expectedWindows:request.scenario.expectedWindows,...(phase==='excerpt'?{excerpt:true}:{phase})});
   assert.equal(checked.status,narrow,`${host}/${mode}: ${phase} checker`);
   assert.equal(status(helper(rows,trace,{phase})),narrow,`${host}/${mode}: ${phase} helper`);
   if(host==='claude')assert.equal(probeClaude(trace,{phase}).status,narrow,`${host}/${mode}: ${phase} probe`);
   if(phase==='excerpt'){
    const cut=path.join(request.cwd,'explicit-excerpt.json');
    fs.writeFileSync(cut,JSON.stringify({events:rows.map(r=>({line:r.line,event:r.value}))}));
    assert.equal(checkTrace({host,trace:cut,expectedWindows:request.scenario.expectedWindows,excerpt:true}).status,narrow,`${host}/${mode}: explicit excerpt input`);
    if(host==='claude')assert.equal(probeClaude(cut).status,narrow,`${host}/${mode}: excerpt probe input`);
   }
  }
 }
});

test('persona model answers also use the shared native proof gate in both hosts',async t=>{
 for(const host of ['claude','codex']){
  const request=setup(t,host,'persona-error');fs.mkdirSync(request.outputDir);
  await assert.rejects(()=>runPersona(request,'Какой цвет предпочитаешь?',0),/persona not verified/);
 }
});
