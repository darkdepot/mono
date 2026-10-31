import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
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
test('Codex completion on the final allowed iteration passes',async t=>{
 const request=setup(t,'codex');request.maxTurns=1;
 const complete=await runScenario(request);
 assert.equal(complete.status,'passed',JSON.stringify(complete));
 assert.equal(complete.replies[0].received,true);assert.equal(complete.check.status,'passed');
});
test('Codex unfinished scenario still fails on the final allowed iteration',async t=>{
 const unfinished=setup(t,'codex','free');unfinished.maxTurns=1;
 unfinished.scenario.freeQuestions=[{contains:'Какой цвет предпочитаешь?'}];
 const cut=await runScenario(unfinished);
 assert.equal(cut.status,'failed',JSON.stringify(cut));assert.equal(cut.reason,'scenario turn limit reached');
 assert.equal(cut.replies.length,0);
});
test('Codex exited leader cannot extend the scenario timeout by holding pipes',async t=>{
 const request=setup(t,'codex');request.timeoutMs=500;
 const cli=path.join(request.cwd,'held-pipes.mjs');
 fs.writeFileSync(cli,`import {spawn} from 'node:child_process';if(process.argv[2]==='plugin')process.exit(0);const child=spawn(process.execPath,['-e','setTimeout(()=>{},1500)'],{stdio:['ignore',process.stdout,process.stderr]});process.stdout.write(JSON.stringify({type:'test_child',pid:child.pid})+'\\n');process.exit(0);`);
 request.binary={command:process.execPath,args:[cli]};
 const realKill=process.kill.bind(process);t.mock.method(process,'kill',(pid,signal)=>signal==='SIGTERM'?true:realKill(pid,signal));
 const started=performance.now(),r=await runScenario(request),elapsed=performance.now()-started;
 assert.equal(r.status,'failed',JSON.stringify(r));assert.equal(r.reason,'Codex process failed: host timeout');
 assert.ok(elapsed<1000,`500ms budget plus 500ms grace exceeded: ${elapsed}ms`);
});
for(const host of ['claude','codex']){
 test(`${host}: one call drives read proof, window, reply and successful trace`,async t=>{
  const request=setup(t,host);const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies.length,1);assert.equal(r.check.windows[0].status,'passed');assert.ok(fs.existsSync(r.trace));
  const sent=fs.readFileSync(r.sent,'utf8');assert.match(sent,/Recommended/);
  if(host==='claude')assert.match(sent,/updatedInput/);else{assert.match(sent,/send_user_message_question_reply/);assert.match(fs.readFileSync(path.join(request.outputDir,'codex-home/config.toml'),'utf8'),/\[mcp_servers.linear\]\nurl = "https:\/\/mcp.linear.app\/mcp"\nenabled = false/);}
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
 assert.deepEqual(codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'audit',input:'await tools[name]({})'}),[]);
 assert.equal(toolViolation('Bash',{command:'cat fixture-with-linear.app'}, {allowedTools:['Bash']},true),null);
});

for(const host of ['claude','codex'])test(`${host}: all six scenario policies and explicit free question use the child transport`,async t=>{
 for(const policy of [{mode:'recommended'},{mode:'label',label:'Утвердить, продолжу позже'},{mode:'correction',text:'Поправь описание.'},{mode:'empty'},{mode:'refuse',text:'Не буду отвечать на этот вопрос.'},{mode:'discuss'}]){
  const request=setup(t,host);request.scenario.windows=[policy];const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies[0].policy,policy.mode);assert.equal(r.replies[0].received,true);if(host==='claude'&&policy.mode==='refuse'){assert.equal(r.replies[0].refused,true);assert.match(fs.readFileSync(r.trace,'utf8'),/Отказ принят/);};
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
test('command contents are not a permission policy',()=>{
 for(const code of ['text(await tools.exec_command({cmd: command}));','await tools.exec_command({...options,cmd: `pwd`})']){
  const call=codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'x',input:code})[0];assert.equal(call.name,'exec_command');assert.equal(toolViolation(call.name,call.input,{},true),null);
 }
});
test('exec foreign MCP names remain red while dynamic host lookup is a note',()=>{
 const calls=codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'x',input:'const t=tools; await t.mcp__linear__save_project({}); text(ALL_TOOLS);'});
 assert.ok(calls.some(c=>toolViolation(c.name,c.input,{},true)?.includes('outside test')));
 assert.doesNotThrow(()=>codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'x',input:'const t=globalThis["to"+"ols"]; text(t);'}));
});
test('a monotest write without prior proof is denied even if listed in the scenario',()=>{
 assert.match(toolViolation('mcp__monotest__save_project',{}, {allowedTools:['mcp__monotest__save_project']},false),/before workspace confirmation/);
});
test('computed command strings remain host data',()=>{
 for(const code of ['await tools.exec_command({cmd: "pwd" + "; uname -a"})','await tools.exec_command({cmd: "pwd", cmd: "uname -a"})'])assert.equal(codexToolCalls({type:'custom_tool_call',name:'exec',call_id:'x',input:code})[0].name,'exec_command');
});
test('a Claude child result cannot fail the parent stage or start its waiting state',async t=>{
 const request=setup(t,'claude','child');const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));
});
for(const host of ['claude','codex'])test(`${host}: sending a reply without observing delivery is not green`,async t=>{
 const r=await runScenario(setup(t,host,'unanswered'));assert.equal(r.status,'unverified',JSON.stringify(r));
});

test('host command argument fields do not gate execution',()=>{
 for(const name of ['exec_command','Bash'])for(const input of [{cmd:'pwd'},{command:'pwd'},{cmd:'any',command:'any'}])assert.equal(toolViolation(name,input,{},true),null);
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
test('Codex escaped exec and host item kinds are information beside the control',async t=>{
 for(const mode of ['custom-proof','unicode-exec','native-web-search','unknown-native-item'])assert.equal((await runScenario(setup(t,'codex',mode))).status,'passed');
 for(const type of ['web_search_call','computer_call','future_call','future_item'])assert.deepEqual(codexToolCalls({type}),[]);
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
 for(const host of ['claude','codex'])for(const consumer of ['workspace','answer','window'])for(const shape of host==='codex'&&consumer==='workspace'?['function','custom']:['function'])for(const flag of ['isError','is_error'])for(const layer of ['outer','native']){
  const request=setup(t,host,`proof-${consumer}-${shape}-${flag}-${layer}`);
  request.scenario.allowedTools.push('Bash','exec_command');
  const r=await runScenario(request);assert.equal(r.status,'unverified',JSON.stringify({host,consumer,shape,flag,layer,r}));
 }
});

test('linked successful command controls remain green through the shared gate',async t=>{
 for(const host of ['claude','codex'])for(const mode of host==='codex'?['command-ok','custom-command-ok']:['command-ok']){
  const request=setup(t,host,mode);request.scenario.allowedTools.push('Bash','exec_command');
  const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));
 }
});

test('Codex missing final proof is unverified rather than a violation',async t=>{
 const r=await runScenario(setup(t,'codex','cut'));
 assert.equal(r.status,'unverified',JSON.stringify(r));assert.equal(r.violation,null);assert.match(r.evidenceMissing,/incomplete/);
});

test('Claude recorded native window and successful JSON stdout pass end to end',async t=>{
 for(const mode of ['recorded-window','command-json']){
  const request=setup(t,'claude',mode);request.scenario.allowedTools.push('Bash');
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
  const rows=(await import('./transports/journal.mjs')).readJsonLines(trace).events,expected='passed';
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
  const expected='passed';observations.push({host,mode,paths,expected:Object.fromEntries(Object.keys(paths).map(k=>[k,expected]))});
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

// Synthetic execution-phase regressions; d-004 applies because these drive the
// public runScenario verdict, not a standalone checker on a hand-built trace.
test('Codex confirmation window cannot stand in for the missing scenario window',async t=>{
 const request=setup(t,'codex','confirmation-window'),r=await runScenario(request);
 assert.equal(r.status,'failed',JSON.stringify(r));assert.equal(r.replies.length,0);
 assert.ok(!fs.readFileSync(r.sent,'utf8').includes('Run stage'));
});

// One execution lifecycle table for both hosts. Cuts and subprocesses are
// synthetic; their positive native envelopes remain the recorded known forms.
for(const host of ['claude','codex'])for(const control of [
 {send:'stage',positive:'ok',negative:'stage-no-result'},
 {send:'free window reply',positive:'ok',negative:'reply-no-result',policy:{mode:'correction',text:'Поправь описание.'}},
 {send:'persona before window',positive:'free',negative:'free-no-result',persona:true},
 {send:'persona after window',positive:'free-after-window',negative:'free-after-window-empty',persona:true},
])test(`${host}: fresh parent completion after ${control.send}`,async t=>{
 for(const [mode,expected] of [[control.positive,'passed'],[control.negative,'unverified']]){
  const request=setup(t,host,mode);
  if(control.policy)request.scenario.windows=[control.policy];
  if(control.persona){request.scenario.freeQuestions=[{contains:'Какой цвет предпочитаешь?'}];request.scenario.stopAfterExpectedWindows=false;}
  const r=await runScenario(request);assert.equal(r.status,expected,JSON.stringify(r));
  if(control.send==='persona after window'){assert.equal(r.replies.length,1);assert.equal(r.replies[0].received,true);}
 }
});

// Synthetic continuation tails around the same host forms; only public driver
// outcomes are asserted, preserving the d-004 standalone-checker boundary.
test('Claude new parent init requires its own result, while child init and information retain completion',async t=>{
 for(const [mode,expected] of [['parent-init-complete','passed'],['parent-init-cut','unverified'],['child-init','passed'],['informational','passed']]){
  const request=setup(t,'claude',mode);request.scenario.stopAfterExpectedWindows=false;
  const r=await runScenario(request);assert.equal(r.status,expected,JSON.stringify(r));assert.equal(r.replies.length,1);
 }
});
for(const host of ['claude','codex'])test(`${host}: persona consumes its question and requires a fresh matching continuation`,async t=>{
 for(const [mode,count] of [['free-after-window',1],['free-after-window-tools',1],['free-after-window-fresh-question',2]]){
  const request=setup(t,host,mode);request.scenario.stopAfterExpectedWindows=false;
  request.scenario.freeQuestions=[{contains:'Какой цвет предпочитаешь?'},{contains:'цвет'}];
  const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));
  assert.equal(fs.readdirSync(request.outputDir).filter(n=>/^persona-/.test(n)).length,count,`${host}/${mode}: unsolicited persona reply`);
  const personas=fs.readFileSync(path.join(request.cwd,'invocations.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(v=>v.args.at(-1)==='Предпочитаю синий.');
  if(host==='codex')assert.equal(personas.length,count);
  else{const sent=fs.readFileSync(r.sent,'utf8').trim().split('\n').map(JSON.parse);assert.equal(sent.filter(v=>v.type==='user'&&v.message.content.some(b=>b.text==='Предпочитаю синий.')).length,count);}
 }
});

for(const [mode,expected] of [['namespaced-allowed','passed'],['namespaced-proof','passed'],['namespaced-early','failed'],['namespaced-foreign','failed']])test(`Codex direct MCP namespace preserves write/server boundary (${mode})`,async t=>{
  const request=setup(t,'codex',mode);delete request.scenario.allowedTools;
  const r=await runScenario(request);assert.equal(r.status,expected,JSON.stringify(r));
  if(expected==='failed'){assert.equal(r.replies.length,0);const calls=fs.readFileSync(path.join(request.cwd,'invocations.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.filter(c=>c.args[0]==='exec').length,1);}
});
test('Codex native MCP identity is namespace plus name, without changing host exec parsing',()=>{
 for(const type of ['function_call','custom_tool_call']){
  const field=type==='function_call'?'arguments':'input';
  const call={type,namespace:'mcp__linear__',name:'exec',call_id:'identity',[field]:'{}'};
  assert.equal(codexToolCalls(call)[0].name,'mcp__linear__exec');
 }
 assert.equal(codexToolCalls({type:'function_call',namespace:'functions',name:'exec',call_id:'host',arguments:'text(await tools.mcp__monotest__get_workspace({}));'})[0].name,'mcp__monotest__get_workspace');
});

test('Claude informational prefixes keep their ordinary window',t=>{
 for(const mode of ['unknown-native-item','unknown-native-block']){
  const request=setup(t,'claude',mode),input=[{type:'user'},{type:'user'}].map(JSON.stringify).join('\n')+'\n';
  const child=spawnSync(request.binary.command,request.binary.args,{cwd:request.cwd,input,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  const events=child.stdout.trim().split('\n').map(JSON.parse);assert.equal(events.filter(e=>e.type==='control_request').length,1);
 }
});
// d006: recorded information is open; actions/proofs remain bounded.
for(const host of ['claude','codex'])test(`${host}: d006 information and default host tools do not reject a stage`,async t=>{
 const request=setup(t,host,'informational');delete request.scenario.allowedTools;
 const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));
 if(host==='codex')assert.ok(r.notes.some(n=>n.includes('web_search_call')));
});
for(const host of ['claude','codex'])for(const mode of ['stop-next-stage','stop-cut-next-stage'])test(`${host}: d006 stop at last answered window terminal before following stage (${mode})`,async t=>{
 const request=setup(t,host,mode);request.timeoutMs=1000;const r=await runScenario(request);
 assert.equal(r.status,'passed',JSON.stringify(r));assert.ok(r.endLine);assert.equal(r.process.failure,null);
});
for(const mode of ['native-status-proof','read-start-race','read-start-race-twice'])test(`Codex d006 ${mode}`,async t=>{
 const request=setup(t,'codex',mode);const r=await runScenario(request);assert.equal(r.status,mode.endsWith('-twice')?'unverified':'passed',JSON.stringify(r));
 const calls=fs.readFileSync(path.join(request.cwd,'invocations.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(e=>e.args[0]==='exec');
 assert.equal(calls.length,mode==='native-status-proof'?3:mode.endsWith('-twice')?2:4);
});
for(const [tail,status,reason] of [['foreign','failed',/outside test/],['write','failed',/before workspace confirmation/],['window','failed',/window during workspace confirmation/],['cut','unverified',/incomplete/],['terminal-error','unverified',/incomplete/]])test(`Codex startup retry audits first turn tail: ${tail}`,async t=>{
 const request=setup(t,'codex',`read-start-race-${tail}`),r=await runScenario(request);
 assert.equal(r.status,status,JSON.stringify(r));assert.match(r.reason,reason);assert.equal(r.confirmed,false);assert.equal(r.replies.length,0);
 const calls=fs.readFileSync(path.join(request.cwd,'invocations.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(e=>e.args[0]==='exec');
 assert.equal(calls.length,1,'no retry or stage after unsafe/incomplete first turn');
});
test('d006 test home has disabled Linear transport and test server approval',t=>{
 const r=setup(t,'codex');privateCodexHome(path.join(r.cwd,'private'),r.authFile,r.mcpServers);const config=fs.readFileSync(path.join(r.cwd,'private/config.toml'),'utf8');
 assert.match(config,/url = "https:\/\/mcp.linear.app\/mcp"\nenabled = false/);assert.match(config,/default_tools_approval_mode = "approve"/);
});
test('d006 exec names only: literal spelling and commands are information, foreign MCP remains red',()=>{
 for(const code of ['text(await tools.exec_command({cmd: "test\\n", ...options}));', 'text(ALL_TOOLS.filter(x=>x.name));', 'const name = `read`; text(await tools[name]({}));'])assert.doesNotThrow(()=>codexToolCalls({type:'custom_tool_call',call_id:'x',name:'exec',input:code}));
 assert.equal(toolViolation('Bash',{command:'any command'}, {},true),null);assert.equal(toolViolation('mcp__monotest__new_tool',{}, {allowedTools:[]},true),null);
 assert.match(toolViolation('mcp__linear__save_project',{}, {allowedTools:'*'},true),/outside test/);
});
for(const [host,mode,expected] of [['claude','claude','failed'],['claude','claude-fixed','passed'],['codex','codex','passed']])test(`${host}: d006 full real event shape through public runScenario (${mode})`,async t=>{
 const request=setup(t,host);request.timeoutMs=5000;request.binary.args=[path.join(repo,'scripts/test-fixtures/skills-live-host.mjs'),mode,repo];delete request.scenario.allowedTools;
 request.scenario.windows=host==='claude'?[{mode:'recommended'},{mode:'discuss'}]:[{mode:'recommended'}];
 request.scenario.expectedWindows=(host==='claude'?['first','thinking']:['first']).map(id=>({id,decision:'описание',advice:'Research',reason:'риск',summary:['Что:','Дальше:']}));
 const r=await runScenario(request);assert.equal(r.status,expected,JSON.stringify(r));assert.ok(!r.check.checks.some(c=>c.status==='unverified'),JSON.stringify(r));
 if(host==='claude'){const {checkTrace}=await import('./skills-trace.mjs');const full=checkTrace({host,trace:r.trace,expectedWindows:request.scenario.expectedWindows});assert.equal(full.status,expected);assert.ok(!full.checks.some(c=>c.status==='unverified'));}
 if(mode==='claude'){assert.equal(r.check.windows[1].line,198);assert.equal(r.check.windows[1].status,'failed');assert.match(r.check.windows[1].reason,/thinking/);}
});

for(const host of ['claude','codex'])test(`${host}: d006 explicit stop never masks a real nonzero process exit`,async t=>{
 const r=await runScenario(setup(t,host,'terminal-crash'));assert.notEqual(r.status,'passed',JSON.stringify(r));
});

test('d006 early MCP writes stay closed across both test servers',()=>{
 for(const name of ['mcp__monotest__save_project','mcp__monotest__set_status','mcp__paper__write_html']){assert.match(toolViolation(name,{}, {},false),/before workspace confirmation/);assert.equal(toolViolation(name,{}, {},true),null);}
});

for(const mode of ['child-foreign-direct','child-foreign-exec','child-foreign-native','grandchild-foreign-native','late-child-foreign-native','child-early-write'])test(`Codex all-rollout MCP boundary: ${mode}`,async t=>{
 const r=await runScenario(setup(t,'codex',mode));assert.equal(r.status,'failed',JSON.stringify(r));assert.match(r.reason,/rollout-child.*jsonl:\d+: (MCP outside test servers|write before workspace confirmation)/);
});
for(const mode of ['child-allowed','child-window','child-window-main-missing'])test(`Codex parent evidence stays separate from ${mode}`,async t=>{
 const request=setup(t,'codex',mode);request.mcpServers.paper={url:'https://paper.example.test/mcp'};request.scenario.allowedTools.push('mcp__paper__get_document');
 const r=await runScenario(request);assert.equal(r.status,mode.endsWith('-missing')?'failed':'passed',JSON.stringify(r));assert.equal(r.replies.length,mode.endsWith('-missing')?0:1);assert.equal(r.auditedTraces.length,2);
});

// continue19: observed multi-question/optionless payloads, synthetic stage tails.
for(const host of ['claude','codex'])test(`${host}: exact recommended label works beside normalized label`,async t=>{
 for(const label of ['Утвердить и начать Research','Утвердить и начать Research (Recommended)']){
  const request=setup(t,host);request.scenario.windows=[{mode:'label',label}];
  const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies[0].received,true);
 }
});
for(const [mode,status] of [['turn-id-match','passed'],['turn-id-stale','unverified'],['turn-id-stale-before-current','passed']])test(`Codex completion binds active turn: ${mode}`,async t=>{
 const request=setup(t,'codex',mode),r=await runScenario(request);assert.equal(r.status,status,JSON.stringify(r));
 if(mode==='turn-id-stale-before-current'){
  const row=fs.readFileSync(r.trace,'utf8').trim().split('\n').map(JSON.parse)[r.endLine-1];
  const start=fs.readFileSync(r.trace,'utf8').trim().split('\n').map(JSON.parse).slice(0,r.endLine).findLast(e=>e.payload?.type==='task_started');
  assert.equal(row.payload.turn_id,start.payload.turn_id);
 }
});
test('Claude multi-question window delivers every policy, retaining the one-question conversation violation',async t=>{
 for(const policy of [{mode:'recommended'},{mode:'label',label:'Зелёный'},{mode:'correction',text:'Синий, но светлее'},{mode:'empty'},{mode:'refuse',text:'Не буду отвечать на этот вопрос.'},{mode:'discuss'}]){
  const request=setup(t,'claude','two-questions');request.scenario.windows=[policy];
  const r=await runScenario(request);assert.equal(r.replies[0]?.received,true,JSON.stringify(r));assert.equal(r.status,'failed');assert.ok(r.check.windows[0].issues.includes('one question at a time'));
  const sent=fs.readFileSync(r.sent,'utf8').trim().split('\n').map(JSON.parse).find(e=>e.type==='control_response').response.response;
  if(policy.mode!=='refuse')assert.equal(Object.keys(sent.updatedInput.answers).length,2);
 }
});
for(const policy of [{mode:'correction',text:'Предпочитаю синий.'},{mode:'empty'},{mode:'refuse',text:'Не буду отвечать.'}])test(`Codex optionless question accepts text policy: ${policy.mode}`,async t=>{
 const request=setup(t,'codex','free-window');request.scenario.windows=[policy];const r=await runScenario(request);
 assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies[0].received,true);assert.equal(r.check.windows[0].executionConfirmed,true);
});
for(const mode of ['recommended','label','discuss'])test(`Codex optionless question reports scenario mismatch: ${mode}`,async t=>{
 const request=setup(t,'codex','free-window');request.scenario.windows=[{mode,label:'Зелёный'}];const r=await runScenario(request);
 assert.equal(r.status,'failed',JSON.stringify(r));assert.match(r.reason,/scenario choice unavailable/);assert.equal(r.replies.length,0);
});
