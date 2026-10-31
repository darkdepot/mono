import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runScenario, runPersona } from './skills-run.mjs';
import { privateCodexHome, codexToolCalls, toolViolation } from './skills-boundary.mjs';
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
  const request=setup(t,host);request.scenario.windows=[policy];const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies[0].policy,policy.mode);
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
test('Claude failed or different answer receipts remain unverified next to the successful control',async t=>{
 for(const mode of ['ok','error-answer','wrong-answer']){
  const r=await runScenario(setup(t,'claude',mode));assert.equal(r.status,mode==='ok'?'passed':'unverified',JSON.stringify(r));assert.equal(r.replies[0].received,mode==='ok');
 }
 const request=setup(t,'claude','wrong-refusal');request.scenario.windows=[{mode:'refuse',text:'Не буду отвечать на этот вопрос.'}];assert.equal((await runScenario(request)).status,'unverified');
});
