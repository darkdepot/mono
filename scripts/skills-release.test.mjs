import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkTrace} from './skills-trace.mjs';
import {runScenario} from './skills-run.mjs';
const root=process.cwd(),samples='evals/scenarios/probe/samples';
const expected={id:'approval',decision:'описание',advice:'Research',reason:'риск',summary:['Дальше:','Что']};
test('production window checker catches 0.38.1 thinking-only and preserves the fixed control',()=>{
 for(const [name,status] of [['trace-defect-v0.38.1-approval','failed'],['trace-control-v0.41.0-approval','passed']]){
  const result=checkTrace({host:'claude',trace:`${samples}/claude/${name}.json`,testedVersion:name.includes('defect')?'0.38.1':'0.41.0',expectedWindows:[expected],excerpt:true});
  assert.equal(result.status,status,JSON.stringify(result));
  if(status==='failed')assert(result.windows.some(w=>w.issues.some(issue=>/visible|thinking/.test(issue))),JSON.stringify(result));
 }
});
test('production legacy mode rejects missing window rather than accepting a textual substitute',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-window-missing-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const trace=path.join(dir,'trace.jsonl');fs.writeFileSync(trace,JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Что\nДальше: Research\nУтверждаем?'}]}})+'\n'+JSON.stringify({type:'result',subtype:'success'})+'\n');
 const result=checkTrace({host:'claude',trace,testedVersion:'0.38.1',expectedWindows:[expected]});
 assert.equal(result.status,'failed');assert(result.checks.some(c=>c.id==='expected-windows'&&c.status==='failed'),JSON.stringify(result));
});
for(const version of ['0.43.0','0.45.0'])test(`production ${version} keeps the window ban even with a legacy scenario`,()=>{
 const result=checkTrace({host:'claude',trace:`${samples}/claude/trace-control-v0.41.0-approval.json`,testedVersion:version,expectedWindows:[expected],excerpt:true});
 assert.equal(result.status,'failed');assert.match(result.reason,/window|окн/);
});
for(const host of ['claude','codex'])test(`production ${host} legacy adapter delivers a real native window answer`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-window-driver-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const packRoot=path.join(dir,'pack');fs.mkdirSync(packRoot);fs.writeFileSync(path.join(packRoot,'VERSION'),'0.42.0\n');
 for(const name of ['references','scripts'])fs.symlinkSync(path.join(root,name),path.join(packRoot,name));
 const authFile=path.join(dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const r=await runScenario({host,cwd:dir,packRoot,authFile,outputDir:path.join(dir,'out'),timeoutMs:10000,idleMs:10,maxTurns:64,binary:{command:process.execPath,args:[path.join(root,'scripts/test-fixtures/skills-host.mjs'),'ok',root]},mcpServers:{monotest:{url:'https://example.test/mcp'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},scenario:{prompt:'Run stage',brief:'Владелец предпочитает синий.',allowedTools:['*'],windows:[{mode:'recommended'}],expectedWindows:[{...expected,reason:host==='codex'?'чтобы проверить':'риск'}]}});
 assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies[0].received,true);assert.equal(r.testedVersion,'0.42.0');
 assert.match(fs.readFileSync(r.sent,'utf8'),host==='claude'?/updatedInput/:/send_user_message_question_reply/);
});

test('MONO-291 a two-question non-target legacy window receives both recommended answers',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-two-questions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const packRoot=path.join(dir,'pack');fs.mkdirSync(packRoot);fs.writeFileSync(path.join(packRoot,'VERSION'),'0.42.0\n');
 for(const name of ['references','scripts'])fs.symlinkSync(path.join(root,name),path.join(packRoot,name));
 const r=await runScenario({host:'claude',cwd:dir,packRoot,outputDir:path.join(dir,'out'),timeoutMs:10000,idleMs:10,maxTurns:64,binary:{command:process.execPath,args:[path.join(root,'scripts/test-fixtures/skills-role-host.mjs'),'roles-twoquestions',root]},mcpServers:{monotest:{url:'test'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},scenario:{prompt:'Run roles',brief:'Источник из source.',allowedTools:['*'],windows:[{mode:'label',label:'Утвердить, продолжу позже'}],expectedWindows:[{id:'approve',role:'approval',decision:'Утвержд',advice:'Совет',reason:'Research',summary:['Что']}]}});
 assert.equal(r.status,'passed',JSON.stringify(r));
 const reply=fs.readFileSync(r.sent,'utf8').trim().split('\n').map(JSON.parse).find(r=>r.response?.response?.updatedInput?.questions?.length===2);
 assert.equal(Object.keys(reply.response.response.updatedInput.answers).length,2);
 assert(Object.values(reply.response.response.updatedInput.answers).every(answer=>answer.endsWith(' (Recommended)')));
});

test('production Codex legacy driver answers a defective async window and keeps failed',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-defective-window-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const packRoot=path.join(dir,'pack');fs.mkdirSync(packRoot);fs.writeFileSync(path.join(packRoot,'VERSION'),'0.38.1\n');
 for(const name of ['references','scripts'])fs.symlinkSync(path.join(root,name),path.join(packRoot,name));
 const authFile=path.join(dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const r=await runScenario({host:'codex',cwd:dir,packRoot,authFile,outputDir:path.join(dir,'out'),timeoutMs:10000,idleMs:10,maxTurns:64,binary:{command:process.execPath,args:[path.join(root,'scripts/test-fixtures/skills-role-host.mjs'),'roles-thinking',root]},mcpServers:{monotest:{url:'test'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},scenario:{prompt:'Run roles',brief:'Источник из source.',allowedTools:['*'],windows:[{mode:'label',label:'Утвердить, продолжу позже'}],expectedWindows:[{id:'approve',role:'approval',decision:'Утвержд',advice:'Совет',reason:'Research',summary:[]}]}});
 assert.equal(r.status,'failed',JSON.stringify(r));assert(r.replies.some(reply=>reply.target&&reply.received),'defect still requires a real owner answer');
 assert(r.check.windows.some(w=>w.status==='failed'&&w.issues.some(issue=>/async summary/.test(issue))));
});

const hostRegressions=JSON.parse(fs.readFileSync('evals/scenarios/probe/samples/host-regressions.json','utf8'));
async function backgroundRun(t,omitContinuation=false) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-background-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const plan=path.join(dir,'plan.json');fs.writeFileSync(plan,JSON.stringify({background:hostRegressions.claudeBackground,omitContinuation,messages:['Что: колонка Источник.\nУтверждаем и начинаем Research?','Утверждение записал.']}));
 return runScenario({host:'claude',cwd:dir,packRoot:root,outputDir:path.join(dir,'out'),timeoutMs:omitContinuation?500:5000,idleMs:5,
  binary:{command:process.execPath,args:[path.join(root,'scripts/test-fixtures/skills-text-host.mjs'),'plan','--plan',plan]},
  mcpServers:{monotest:{url:'test'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},
  scenario:{prompt:'Run text',allowedTools:['*'],expectedReplies:[{id:'idea',stage:'idea',role:'approval',summary:['Что:'],question:'Утверждаем и начинаем Research?',reply:'принимаю',intent:'agree',asksStart:true,outcome:{approval:true,startNext:true},response:['Утверждение записал.']}]}});
}
test('D1 Claude waits through the saved background result, then answers the fresh full summary',async t=>{
 const r=await backgroundRun(t);assert.equal(r.status,'passed',JSON.stringify(r));
 assert.equal(r.replies.length,1);assert.equal(r.replies[0].received,true);
 assert(!r.replies[0].question.includes('Разведка идёт'));
});
test('D1 pending scouts without a new completed parent summary never receive owner consent',async t=>{
 const r=await backgroundRun(t,true);assert.notEqual(r.status,'passed');assert.equal(r.replies.length,0);
 assert.match(r.process.failure,/timeout/);
});
import {windowReply,windowPolicy,textReply} from './skills-owner.mjs';
test('D4 markerless saved choice accepts a scenario label rather than inventing a recommended option',()=>{
 const input=hostRegressions.markerlessChoice,label=input.questions[0].options[0];
 const scenario={windows:[{mode:'label',label}],expectedWindows:[{id:'choice',role:'choice'}]};
 const plan=windowPolicy(scenario,input.questions,[]);
 assert.equal(plan.target,true);assert.equal(plan.policy.mode,'label');
 assert.match(windowReply('codex',input,plan.policy,'choice'),/Колонка/);
 assert.throws(()=>windowReply('codex',input,{mode:'label',label:'other'},'choice'),/unavailable/);
 assert.throws(()=>windowReply('codex',input,{mode:'recommended'},'choice'),/unavailable/);
});
import {codexWindows} from './skills-trace.mjs';
test('D5 saved 0.38.1 commentary summary cannot be replaced by a short final message, without anchors',()=>{
 const rows=hostRegressions.codexAsync.map((value,i)=>({value,line:i+1}));
 const bad=codexWindows(rows,'saved',{phase:'card'})[0];
 assert.equal(bad.executionConfirmed,true);assert.equal(bad.status,'failed');assert.match(bad.reason,/summary.*final/);
 const fixed=structuredClone(rows);fixed[3].value.payload.content=structuredClone(fixed[0].value.payload.content);
 assert.equal(codexWindows(fixed,'fixed',{phase:'card'})[0].status,'passed');
});
test('N1 a consent question in the last message survives a following service paragraph',()=>{
 const expected={id:'idea',stage:'idea',role:'approval',summary:['Что:'],question:'Утверждаешь это описание?',reply:'принимаю',intent:'agree',asksStart:false,outcome:{approval:true,startNext:false},response:['Записал.']};
 const message='Что: колонка источника.\n\nУтверждаешь это описание?\n\n'+hostRegressions.afterQuestion;
 assert.equal(textReply({expectedReplies:[expected]},message,0),'принимаю');
 assert.throws(()=>textReply({expectedReplies:[expected]},message+'\nДелаем другое?',0),/question/);
});

import {parentTurns,completedTrace} from './skills-audit.mjs';
test('D1 native completion notifications without a fresh terminal do not certify the old progress text',()=>{
 const rows=hostRegressions.claudeBackground.map((value,i)=>({value,line:i+1}));
 assert.equal(parentTurns('claude',rows).length,0);assert.equal(completedTrace('claude',rows),false);
 rows.push({line:rows.length+1,value:{type:'system',subtype:'background_tasks_changed',tasks:[]}});
 assert.equal(completedTrace('claude',rows),false);
});
test('N1 the checker binds the actual question inside the final message, still rejects later calls',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-question-tail-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const expected={id:'idea',stage:'idea',role:'approval',summary:['Что:'],question:'Утверждаешь это описание?',reply:'принимаю',intent:'agree',asksStart:false,outcome:{approval:true,startNext:false},response:['Записал.']};
 const rows=[{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Что: колонка источника.\nУтверждаешь это описание?\n\n'+hostRegressions.afterQuestion}]}},{type:'event_msg',payload:{type:'task_complete'}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'принимаю'}]}},{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Записал.'}]}},{type:'event_msg',payload:{type:'task_complete'}}];
 const trace=path.join(dir,'trace.jsonl'),check=()=>{fs.writeFileSync(trace,rows.map(JSON.stringify).join('\n')+'\n');return checkTrace({host:'codex',trace,testedVersion:'0.45.0',expectedReplies:[expected]});};
 const good=check();assert.equal(good.status,'passed',JSON.stringify(good));assert.equal(good.exchanges[0].question,expected.question);
 rows.splice(1,0,{type:'response_item',payload:{type:'function_call',name:'mcp__monotest__get_workspace',call_id:'late',arguments:'{}'}});
 assert.equal(check().status,'failed');
});
