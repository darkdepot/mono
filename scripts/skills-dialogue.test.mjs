import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from './skills-catalog.mjs';

const stages=['idea','research','discovery','design','tech-evaluation','handoff'];
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.md')?[path.join(dir,e.name)]:[]);
test('all six active stage contracts replace window labels with conversation',()=>{
 const corpus=[...stages.flatMap(s=>files(`skills/${s}`)), 'references/owner-dialog.md','references/orchestration.md','templates/stage-agent.md'];
 for(const file of corpus) assert.doesNotMatch(read(file),/«(?:Утвердить[^»]*|Начать[^»]*|Ещё обсудить)»|(?:вызови|открой|доступный)\s+`?(?:AskUserQuestion|request_user_input)/,file);
 const dialogue=read('references/owner-dialog.md');
 assert.match(dialogue,/Владелец: ответил/);assert.match(dialogue,/Поправка:/);
 assert.match(dialogue,/shown\.md/);assert.match(dialogue,/approved\.md/);
});
test('the shipped catalog uses predetermined word replies for every stage and host',()=>{
 const catalog=loadCatalog(new URL('../evals/scenarios/index.json',import.meta.url));
 for(const scenario of catalog.scenarios.values())for(const host of ['claude','codex']){
  const flow=scenario.hosts[host];assert.ok(flow.expectedReplies?.length,`${scenario.stage}/${scenario.id}/${host}`);
  assert.equal(flow.windows,undefined);assert.equal(flow.expectedWindows,undefined);
  for(const r of flow.expectedReplies){assert.equal(r.stage,scenario.stage);if(['research','handoff'].includes(r.stage))assert.equal(r.outcome.approval,false);if(r.stage==='design')assert.equal(r.outcome.startNext,false);}
 }
});

// Constructed native host conversations exercise the actual catalog and driver.
// They prove transport/policy behavior, not live model compliance or app visibility.
import os from 'node:os';
import { runScenario } from './skills-run.mjs';
import { probeText } from './skills-probe.mjs';
const shippedCatalog=loadCatalog(new URL('../evals/scenarios/index.json',import.meta.url));
for(const host of ['claude','codex'])for(const scenario of shippedCatalog.scenarios.values())test(`${host}: shipped ${scenario.stage}/${scenario.id} word scenario runs without a window`,async t=>{
 const stage=scenario.stage;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-stage-dialogue-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const flow=scenario.hosts[host];
 const base=JSON.parse(read('evals/scenarios/probe/text/stage-messages.json')).stages[stage];
 let messages=[...base];
 if(scenario.id==='empty')messages=[base[0],'Что смущает?'];
 if(scenario.id==='discuss')messages=[base[0],'Исследование закрыло неизвестные; в Discovery выберем решение.'];
 if(scenario.id==='defer')messages=[base[0].replace('Принимаем эту идею?','Принимаем эту идею и начинаем Research?'),'Утверждение записал, Research начнём позже.'];
 if(scenario.id==='correction'){
  if(['design','handoff'].includes(stage))messages=[base[0],base[0].replace('Источник','Источник перед именем, новая версия'),base[1]];
  else{const at=base[0].lastIndexOf('\n');messages=[base[0].slice(0,at)+'\nФильтр и сортировку не добавляем.'+base[0].slice(at),'Экспорт добавлен к исключениям. '+base[1]];}
 }
 if(scenario.kind==='main'&&['idea','discovery','tech-evaluation'].includes(stage)){
  const questions={idea:'Принимаем эту идею и начинаем Research?',discovery:'Утверждаем PRD и начинаем Design?', 'tech-evaluation':'Принимаем решение и начинаем Handoff?'};
  const lines=messages[0].split('\n');lines[lines.length-1]=questions[stage];messages[0]=lines.join('\n');
 }
 const plan=path.join(dir,'plan.json');fs.writeFileSync(plan,JSON.stringify({messages}));
 const authFile=path.join(dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const result=await runScenario({host,cwd:dir,packRoot:process.cwd(),outputDir:path.join(dir,'run'),authFile,timeoutMs:10000,idleMs:10,
  binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-text-host.mjs'),'plan','--plan',plan]},
  mcpServers:{monotest:{url:'https://example.test/mcp'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},
  scenario:{prompt:'Run text',allowedTools:['*'],...flow}});
 assert.equal(result.status,'passed',JSON.stringify(result));
 assert.deepEqual(result.replies.map(r=>r.reply),flow.expectedReplies.map(r=>r.reply));assert(result.replies.every(r=>r.received));
 assert.equal(result.check.windows.length,0);
 assert.equal(probeText({host,trace:result.trace,expectedReplies:flow.expectedReplies,stageStartLine:result.stageStartLine}).status,'passed');
});

test('catalog questions cannot be a wildcard that accepts an unrelated question',async()=>{
 const {validateReplies,textReply}=await import('./skills-owner.mjs');
 const r={id:'idea',stage:'idea',role:'approval',summary:['Версия'],question:'Принимаем эту идею?',reply:'принимаю',intent:'agree',asksStart:false,outcome:{approval:true,startNext:false},response:['Записал.']};
 assert.throws(()=>validateReplies([{...r,question:'?'}]),/question/);
 assert.throws(()=>textReply({expectedReplies:[r]},'Версия\nКакой источник показываем?',0),/question/);
});
