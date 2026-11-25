// MONO-492: the inherited answer kind and same-session continuation on fake hosts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validateReplies, inheritedTurn } from './skills-owner.mjs';
import { probeText } from './skills-probe.mjs';
import { runScenario } from './skills-run.mjs';

const repo=process.cwd(),host=path.join(repo,'scripts/test-fixtures/skills-text-host.mjs');
const question='Что: колонка Источник.\nУтверждаем и начинаем Handoff?';
const agree={id:'approval',stage:'tech-evaluation',role:'approval',asksStart:true,summary:['Что:'],question:'Утверждаем и начинаем Handoff?',reply:'принимаю',intent:'agree',outcome:{approval:true,startNext:true},response:['Утверждение записал.']};
const inherited=(extra={})=>({id:'forward',stage:'handoff',role:'transition',asksStart:false,summary:['Пакет:'],intent:'inherited',outcome:{approval:false,startNext:false},response:['Пакет: три задачи. Старт записан по согласию наперёд.'],...extra});
const shown='Пакет: три задачи. Старт записан по согласию наперёд.';
const anchoredInherited={...inherited(),response:{anchors:[['Старт записан']],forbidden:[],question:false},presentation:['inline'],driverStart:null};

test('inherited: declared step validates; malformed declarations fail',()=>{
 assert.doesNotThrow(()=>validateReplies([inherited()]));
 assert.doesNotThrow(()=>validateReplies([anchoredInherited]));
 for(const [label,steps,pattern] of [
  ['driver reply',[inherited({reply:'да'})],/inherited step/],
  ['question',[inherited({question:'Начинаем?'})],/inherited step/],
  ['asks start',[inherited({asksStart:true})],/inherited step/],
  ['not last',[inherited(),{...agree,stage:'handoff',role:'transition',intent:'start',id:'later',outcome:{approval:false,startNext:true}}],/last expected step/],
  ['orchestrator',[inherited({by:'orchestrator',reason:'x'})],/belongs to the owner/],
  ['approval outcome',[inherited({outcome:{approval:true,startNext:false}})],/outcome/],
  ['anchored start without permission',[{...anchoredInherited,outcome:{approval:false,startNext:true}}],/outcome/],
  ['anchored question policy',[{...anchoredInherited,response:{anchors:['Старт'],question:true}}],/question=false/],
 ])assert.throws(()=>validateReplies(steps),pattern,label);
 assert.doesNotThrow(()=>inheritedTurn(inherited(),shown));
 assert.throws(()=>inheritedTurn(inherited(),shown+'\nНачинаем?'),/asked the owner/);
 assert.throws(()=>inheritedTurn(inherited(),'Готово.'),/summary/);
});

function trace(t,hostName,messages){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-inherited-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const a=text=>hostName==='claude'?{type:'assistant',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}};
 const u=text=>hostName==='claude'?{type:'user',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}};
 const end=hostName==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 const events=messages.flatMap(([role,text])=>role==='a'?[a(text),end]:[u(text)]);
 const file=path.join(dir,'trace.jsonl');fs.writeFileSync(file,events.map(JSON.stringify).join('\n')+'\n');return file;
}
for(const hostName of ['claude','codex'])test(`${hostName}: probe accepts a declared inherited turn; an undeclared skip fails as before`,t=>{
 const file=trace(t,hostName,[['a',shown]]);
 const passed=probeText({host:hostName,trace:file,expectedReplies:[inherited()]});
 assert.equal(passed.status,'passed',passed.reason);assert.equal(passed.exchanges[0].inherited,true);assert.equal(passed.exchanges[0].replyLine,undefined);
 // Same completed turn against an ordinary question step: today's error, unchanged.
 const undeclared=probeText({host:hostName,trace:file,expectedReplies:[{...agree,stage:'handoff',role:'transition',intent:'start',summary:['Пакет:'],question:'Начинаем?',outcome:{approval:false,startNext:true},response:['x']}]});
 assert.equal(undeclared.status,'failed');assert.equal(undeclared.reason,'last stage question missing');
 const asked=probeText({host:hostName,trace:trace(t,hostName,[['a',shown+'\nНачинаем работу?']]),expectedReplies:[inherited()]});
 assert.equal(asked.status,'failed');assert.equal(asked.reason,'inherited step asked the owner');
 const answered=probeText({host:hostName,trace:trace(t,hostName,[['a',shown],['u','да'],['a','Ок.']]),expectedReplies:[inherited()]});
 assert.equal(answered.status,'failed','an owner exchange after an inherited step has no policy');
});

function setup(t,hostName,plan,mode='agree'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-continuation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const authFile=path.join(dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const planFile=path.join(dir,'plan.json');fs.writeFileSync(planFile,JSON.stringify({messages:plan}));
 return {dir,request:{host:hostName,cwd:dir,packRoot:repo,outputDir:path.join(dir,'out'),authFile,timeoutMs:4000,idleMs:10,binary:{command:process.execPath,args:[host,mode,'--plan',planFile]},
  mcpServers:{monotest:{url:'https://example.test/mcp'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},
  scenario:{prompt:'Run text',brief:'Synthetic continuation.',allowedTools:['*'],expectedReplies:[agree]}}};
}
const sentLines=file=>fs.readFileSync(file,'utf8').split('\n').filter(Boolean).length;

for(const hostName of ['claude','codex']){
 test(`${hostName}: declared inherited step passes with nothing sent; asking anyway fails before any reply`,async t=>{
  const {request}=setup(t,hostName,[shown]);request.scenario.expectedReplies=[inherited()];
  const result=await runScenario(request);
  assert.equal(result.status,'passed',JSON.stringify(result.reason));
  assert.deepEqual(result.replies.map(r=>[r.kind,r.received,r.reply]),[['inherited',true,null]]);
  assert.equal(sentLines(result.sent),hostName==='claude'?2:0,'only the workspace and stage prompts; no driver answer');
  const asking=setup(t,hostName,[shown+'\nНачинаем?']).request;asking.scenario.expectedReplies=[inherited()];
  const failed=await runScenario(asking);
  assert.equal(failed.status,'failed');assert.match(failed.reason,/inherited step asked the owner/);assert.equal(failed.replies.length,0);
  // The shown summary without a question, against an ordinary step: a skipped question, failed as today.
  const undeclared=setup(t,hostName,[shown]).request;undeclared.scenario.expectedReplies=[{...agree,summary:['Пакет:']}];
  const skip=await runScenario(undeclared);
  assert.equal(skip.status,'failed');assert.match(skip.reason,/last stage question/);assert.equal(skip.replies.length,0);
 });

 test(`${hostName}: next stage continues in the same conversation with an inherited step`,async t=>{
  const first=setup(t,hostName,hostName==='codex'?[question,'Утверждение записал.',shown]:[question,'Утверждение записал.']);
  const one=await runScenario(first.request);
  assert.equal(one.status,'passed',JSON.stringify(one.reason));assert.equal(one.session.host,hostName);
  const secondPlan=path.join(first.dir,'plan-2.json');fs.writeFileSync(secondPlan,JSON.stringify({messages:[shown]}));
  const second={...first.request,outputDir:path.join(first.dir,'out-2'),continueSession:one.session,binary:{command:process.execPath,args:[host,'agree','--plan',hostName==='codex'?path.join(first.dir,'plan.json'):secondPlan]},
   scenario:{...first.request.scenario,prompt:'Начни handoff',expectedReplies:[inherited()]}};
  const two=await runScenario(second);
  assert.equal(two.status,'passed',JSON.stringify(two.reason));
  assert.deepEqual(two.session,one.session,'same host conversation');
  assert.equal(two.replies[0].kind,'inherited');
  const evidence=fs.readFileSync(two.trace,'utf8');
  assert.doesNotMatch(evidence,/Утверждаем и начинаем Handoff/,'the continued stage evidence holds only its own turns');
  assert.doesNotMatch(evidence,/get_workspace/,'no second workspace confirmation inside the same conversation');
  if(hostName==='codex'){
   assert.equal(fs.existsSync(path.join(second.outputDir,'setup.log')),false,'no second plugin setup');
   assert.deepEqual(two.auditedTraces,[two.trace],'the earlier stage rollout is not this stage evidence');
  }else assert.equal(sentLines(two.sent),1,'the stage prompt only');
  const wrongHost=await runScenario({...second,outputDir:path.join(first.dir,'out-3'),continueSession:{...one.session,host:hostName==='claude'?'codex':'claude'}});
  assert.notEqual(wrongHost.status,'passed');assert.match(wrongHost.reason,/same host/);
 });
}
test('claude: a resumed session that changes its id fails',async t=>{
 const {request,dir}=setup(t,'claude',[shown],'fork');request.scenario.expectedReplies=[inherited()];
 const result=await runScenario({...request,continueSession:{host:'claude',id:'parent-session'}});
 assert.equal(result.status,'failed');assert.match(result.reason,/session changed/);
 assert.ok(fs.existsSync(dir));
});

// Owner interjection: a real owner message at a defined point, without a stage question.
const correction='Поправка: колонку назови «Откуда».';
const interject=(extra={})=>({id:'owner-correction',stage:'tech-evaluation',role:'clarification',asksStart:false,summary:['Пакет:'],intent:'interject',reply:correction,outcome:{approval:false,startNext:false},...extra});
const afterCorrection={...agree,id:'after-correction',summary:['Откуда']};
const asksAgain='Что: колонка Откуда.\nУтверждаем и начинаем Handoff?';
test('interject: declared owner message validates; malformed declarations fail',()=>{
 assert.doesNotThrow(()=>validateReplies([interject(),afterCorrection]));
 for(const [label,steps,pattern] of [
  ['last',[interject()],/later step/],
  ['question',[interject({question:'Что?'}),afterCorrection],/owner interjection/],
  ['no text',[interject({reply:''}),afterCorrection],/owner interjection/],
  ['approves',[interject({outcome:{approval:true,startNext:false}}),afterCorrection],/approves and starts nothing/],
  ['orchestrator',[interject({by:'orchestrator',reason:'x'}),afterCorrection],/belongs to the owner/],
 ])assert.throws(()=>validateReplies(steps),pattern,label);
});
for(const hostName of ['claude','codex'])test(`${hostName}: probe binds the owner interjection and the stage question that answers it`,t=>{
 const ok=probeText({host:hostName,trace:trace(t,hostName,[['a',shown],['u',correction],['a',asksAgain],['u','принимаю'],['a','Утверждение записал.']]),expectedReplies:[interject(),afterCorrection]});
 assert.equal(ok.status,'passed',ok.reason);assert.equal(ok.exchanges[0].reply,correction);assert.equal(ok.exchanges[0].question,null);
 const asked=probeText({host:hostName,trace:trace(t,hostName,[['a',shown+'\nНачинаем?'],['u',correction],['a',asksAgain],['u','принимаю'],['a','Утверждение записал.']]),expectedReplies:[interject(),afterCorrection]});
 assert.equal(asked.status,'failed');assert.equal(asked.reason,'stage asked before the owner interjection');
 const other=probeText({host:hostName,trace:trace(t,hostName,[['a',shown],['u','Другие слова'],['a',asksAgain],['u','принимаю'],['a','Утверждение записал.']]),expectedReplies:[interject(),afterCorrection]});
 assert.equal(other.status,'failed');
});
for(const hostName of ['claude','codex'])test(`${hostName}: owner correction injected into a continued conversation is a real owner message`,async t=>{
 const first=setup(t,hostName,hostName==='codex'?[question,'Утверждение записал.',shown,asksAgain,'Утверждение записал.']:[question,'Утверждение записал.']);
 const one=await runScenario(first.request);assert.equal(one.status,'passed',JSON.stringify(one.reason));
 const secondPlan=path.join(first.dir,'plan-2.json');fs.writeFileSync(secondPlan,JSON.stringify({messages:[shown,asksAgain,'Утверждение записал.']}));
 const second={...first.request,outputDir:path.join(first.dir,'out-2'),continueSession:one.session,binary:{command:process.execPath,args:[host,'agree','--plan',hostName==='codex'?path.join(first.dir,'plan.json'):secondPlan]},
  scenario:{...first.request.scenario,prompt:'Начни tech-evaluation',expectedReplies:[interject(),afterCorrection]}};
 const two=await runScenario(second);
 assert.equal(two.status,'passed',JSON.stringify(two.reason));assert.deepEqual(two.session,one.session);
 assert.deepEqual(two.replies.map(r=>r.reply),[correction,'принимаю']);
 assert.ok(fs.readFileSync(two.sent,'utf8').includes(JSON.stringify(correction).slice(1,-1)),'the owner text is sent verbatim, without a service marker');
 assert.deepEqual(two.check.exchanges.map(e=>e.reply),[correction,'принимаю']);
});
