import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkTrace as textTrace } from './skills-trace.mjs';
import { checkTrace as windowTrace } from './test-fixtures/legacy-window-trace.mjs';
const checkTrace=request=>request.expectedReplies?textTrace(request):windowTrace(request);
const expected = {id:'approval',decision:'описание',advice:'Research',reason:'риск',summary:['Дальше:','Что']};
const base='evals/scenarios/probe/samples';
function scratch(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'skills-trace-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return (events)=>{const p=path.join(d,'trace.jsonl');fs.writeFileSync(p,events.map(e=>JSON.stringify(e)).join('\n')+'\n');return p;};}
// The recorded cut omitted IDs; restore a synthetic matching pair for linkage tests.
const codexRows=()=>JSON.parse(fs.readFileSync(`${base}/codex/trace-control-v0.41.0-async-order.json`)).items.map((payload)=>({type:'response_item',payload:{...payload,...(payload.type.startsWith('function_call')?{call_id:'synthetic-window'}:{})}}));
const codexExpected={id:'approval',decision:'описание',advice:'Research',reason:'чтобы проверить',summary:['Что','Дальше:']};
for(const reverse of [false,true])test(`continue7 a known window failure dominates missing native proof in either order (${reverse})`,t=>{
 const failed=codexRows(),unknown=codexRows();
 failed.at(-1).payload.phase='commentary';unknown[1].payload.output='{}';
 unknown.forEach(r=>{if(r.payload.call_id)r.payload.call_id='uncertain-window';});
 const boundary={type:'event_msg',payload:{type:'task_complete'}};
 const rows=(reverse?[unknown,failed]:[failed,unknown]).flatMap(part=>[...part,boundary]);
 const checked=textTrace({host:'codex',testedVersion:'0.42.0',trace:scratch(t)(rows),expectedWindows:[codexExpected],excerpt:true});
 assert.equal(checked.status,'failed',JSON.stringify(checked));
 assert.ok(checked.windows.some(w=>w.status==='failed'));assert.ok(checked.windows.some(w=>w.status==='unverified'));
});
test('Codex recorded accepted:true result establishes successful window execution',t=>{
 const r=checkTrace({host:'codex',trace:scratch(t)(codexRows()),expectedWindows:[codexExpected],excerpt:true});
 assert.equal(r.status,'passed');
});
for(const [name,mutate] of [
 ['accepted:false',r=>r[1].payload.output='{"accepted":false}'],
 ['error output',r=>r[1].payload.output='Synthetic error output'],
 ['missing result',r=>r.splice(1,1)],
 ['unlinked result',r=>r[1].payload.call_id='different-call'],
 ['schema rejection',r=>{const args=JSON.parse(r[0].payload.arguments);args.unexpected=true;r[0].payload.arguments=JSON.stringify(args);r[1].payload.output='Synthetic schema rejection';}],
 ['unknown result',r=>r[1].payload.output='{"accepted":true,"unknown":true}'],
 ['error envelope',r=>r[1].payload.isError=true],
 ['wrong output kind',r=>r[1].payload.type='custom_tool_call_output'],
 ['duplicate result',r=>r.splice(2,0,structuredClone(r[1]))],
 ['result before call',r=>r.unshift(r.splice(1,1)[0])],
 ['result after turn boundary',r=>{const output=r.splice(1,1)[0];r.push({type:'event_msg',payload:{type:'task_complete'}},output);}]
])test(`Codex ${name} is unverified beside the recorded success control`,t=>{
 const rows=codexRows();mutate(rows);
 const r=checkTrace({host:'codex',trace:scratch(t)(rows),expectedWindows:[codexExpected],excerpt:true});
 assert.equal(r.status,'unverified',JSON.stringify(r));assert.equal(r.windows[0].status,'unverified');assert.equal(r.windows[0].executionConfirmed,false);
});
test('unconfirmed Codex attempts do not count as real windows or consume the scenario slot',t=>{
 for(const accepted of [false,true]){
  const rows=codexRows(),retry=structuredClone(rows.slice(0,2));
  rows[1].payload.output='{"accepted":false}';retry.forEach(r=>r.payload.call_id='retry-window');retry[1].payload.output=JSON.stringify({accepted});rows.splice(2,0,...retry);
  const r=checkTrace({host:'codex',trace:scratch(t)(rows),expectedWindows:[codexExpected],excerpt:true});
  assert.equal(r.status,'unverified',JSON.stringify(r));assert.equal(r.windows.filter(w=>w.executionConfirmed).length,accepted?1:0);
 }
});
test('known thinking-only defect fails at 228 and current Claude control is green',()=>{
  for(const [name,status] of [['trace-defect-v0.38.1-approval','failed'],['trace-control-v0.41.0-approval','passed']]){
    const r=checkTrace({host:'claude',trace:`${base}/claude/${name}.json`,expectedWindows:[expected],excerpt:true});
    assert.equal(r.status,status,JSON.stringify(r));if(status==='failed')assert.match(r.windows[0].evidence,/:228$/);
  }
});
test('Codex async summary must be final, after window and last before turn completion',t=>{
 const write=scratch(t),rows=codexRows();
 const check=r=>checkTrace({host:'codex',trace:write(r),expectedWindows:[codexExpected],excerpt:true});
 assert.equal(check(rows).status,'passed');
 rows.at(-1).payload.phase='commentary';assert.equal(check(rows).status,'failed');
 rows.at(-1).payload.phase='final_answer';rows.push({type:'response_item',payload:{type:'function_call',name:'mcp__monotest__get_workspace',arguments:'{}',call_id:'late'}});
 const bad=check(rows);assert.equal(bad.status,'failed');assert.match(bad.windows[0].issues.join(' '),/last|послед/);
});
test('missing expected window and text replacement fail, not unverified',t=>{
 const write=scratch(t);
 for(const host of ['claude','codex']){
  const rows=host==='claude'?[{type:'assistant',message:{content:[{type:'text',text:'Утверждаем? Ответь текстом.'}]}}]:codexRows().slice(-1);
  const r=checkTrace({host,trace:write(rows),expectedWindows:[expected],excerpt:true});
  assert.equal(r.status,'failed');assert.match(r.checks.find(c=>c.status==='failed').evidence,/:\d+$/);
 }
});
test('window card checks content anchors, recommendation, consequences and option cap independently',t=>{
 const write=scratch(t);
 const mutations=[q=>q.title='Продолжаем?',q=>q.options.reverse(),q=>q.options.push('Четвёртый'),q=>q.title=q.title.split('\n')[0],q=>q.options[0]='Утвердить (Recommended)'];
 for(const mutate of mutations){const rows=codexRows();const q=JSON.parse(rows[0].payload.arguments);mutate(q.questions[0]);rows[0].payload.arguments=JSON.stringify(q);
 const r=checkTrace({host:'codex',trace:write(rows),expectedWindows:[codexExpected],excerpt:true});assert.equal(r.status,'failed',JSON.stringify(q));}
});
test('corrupt and cut traces never pass; complete runtime trace needs successful terminal event',t=>{
 const write=scratch(t);for(const host of ['claude','codex']){
 const r=checkTrace({host,trace:write(host==='codex'?codexRows():[]),expectedWindows:[host==='codex'?codexExpected:expected]});assert.equal(r.status,host==='codex'?'unverified':'failed');
 }
 const p=write(codexRows());fs.appendFileSync(p,'{"bad":');assert.equal(checkTrace({host:'codex',trace:p,expectedWindows:[codexExpected],excerpt:true}).status,'unverified');
});
test('changing rule source requires matching checker update',t=>{
 const write=scratch(t),root=path.dirname(write([]));fs.mkdirSync(path.join(root,'references'));fs.writeFileSync(path.join(root,'references/owner-dialog.md'),'changed rules');
 assert.equal(checkTrace({host:'codex',trace:write(codexRows()),expectedWindows:[codexExpected],rulesRoot:root,excerpt:true}).status,'unverified');
});
test('usage metadata after Codex completion does not create a false incomplete trace',t=>{
 const write=scratch(t),rows=codexRows();
 const answer=JSON.parse(fs.readFileSync(`${base}/codex/recommended.json`)).answerAsUserMessage;
 rows.push({type:'response_item',payload:{type:'message',role:'user',content:answer}},{type:'event_msg',payload:{type:'task_complete'}},{type:'event_msg',payload:{type:'token_count',info:{}}});
 assert.equal(checkTrace({host:'codex',trace:write(rows),expectedWindows:[codexExpected]}).status,'passed');
 rows.push({type:'event_msg',payload:{type:'task_started'}});assert.equal(checkTrace({host:'codex',trace:write(rows),expectedWindows:[codexExpected]}).status,'unverified');
});
test('Claude summary anchors cannot be borrowed from an earlier API message',t=>{
 const write=scratch(t),sample=JSON.parse(fs.readFileSync(`${base}/claude/trace-control-v0.41.0-approval.json`));
 const summary=sample.events.find(r=>r.line===138).event,window=sample.events.find(r=>r.line===139).event;
 summary.message.id='earlier-message';window.message.content.unshift({type:'text',text:'Коротко.'});
 assert.equal(checkTrace({host:'claude',trace:write([summary,window]),expectedWindows:[expected],excerpt:true}).status,'failed');
});
for(const differentChild of [false,true])test(`Claude parent summary survives distinct window message ID; different child text=${differentChild}`,t=>{
 const rows=structuredClone(JSON.parse(fs.readFileSync('scripts/test-fixtures/skills-claude-child-approval.json')).events);
 if(!differentChild)rows[1].message.content[0].text=rows[0].message.content[0].text;
 const questions=rows[2].message.content[0].input.questions,answer='Утвердить, продолжу позже';
 rows.push({type:'control_request',request_id:'permission',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions}}},
  {type:'user',tool_use_result:{questions,answers:{[questions[0].question]:answer}},message:{content:[{type:'tool_result',tool_use_id:'window',content:`Your questions have been answered: "${questions[0].question}"="${answer}". You can now continue with these answers in mind.`}]}},
  {type:'result',subtype:'success'});
 const write=scratch(t),check=()=>textTrace({host:'claude',trace:write(rows),testedVersion:'0.42.0',expectedWindows:[{id:'idea-approval',role:'approval',decision:'Утвержд',advice:'Совет',reason:'Research',summary:['Что','Зачем','Дальше']}]});
 assert.notEqual(rows[0].message.id,rows[2].message.id);
 assert.equal(check().status,'passed',JSON.stringify(check()));
 const parent=rows.shift();
 assert.equal(check().status,'failed','hidden scout cannot supply the owner summary');rows.unshift(parent);
 const short={type:'assistant',message:{id:'new-parent',content:[{type:'text',text:'Коротко.'}]}};
 rows.splice(2,0,short);assert.equal(check().status,'failed','new parent text replaces the old presentation');rows.splice(2,1);
 rows.splice(2,0,{type:'assistant',message:{id:'service',content:[{type:'tool_use',id:'read',name:'Read',input:{file_path:'fixture'}}]}});
 assert.equal(check().status,'failed','parent service work invalidates the summary');
});
test('Claude service call inside the same content array cannot sit between summary and window',t=>{
 const write=scratch(t),sample=JSON.parse(fs.readFileSync(`${base}/claude/trace-control-v0.41.0-approval.json`));
 const summary=sample.events.find(r=>r.line===138).event,window=sample.events.find(r=>r.line===139).event;
 const event={type:'assistant',message:{id:'combined',content:[...summary.message.content,{type:'tool_use',id:'read',name:'Read',input:{file_path:'fixture'}},...window.message.content]}};
 assert.equal(checkTrace({host:'claude',trace:write([event]),expectedWindows:[expected],excerpt:true}).status,'failed');
 event.message.content.splice(1,1);assert.equal(checkTrace({host:'claude',trace:write([event]),expectedWindows:[expected],excerpt:true}).status,'passed');
});
test('a late child result cannot replace the successful parent terminal event',t=>{
 const write=scratch(t),sample=JSON.parse(fs.readFileSync(`${base}/claude/trace-control-v0.41.0-approval.json`));
 const rows=sample.events.map(r=>r.event);rows.push({type:'result',subtype:'success'},{type:'result',subtype:'error_during_execution',is_error:true,parent_tool_use_id:'child'});
 assert.equal(checkTrace({host:'claude',trace:write(rows),expectedWindows:[expected]}).status,'passed');
});

for(const host of ['claude','codex'])test(`${host}: text approval binds a completed final message and the actual reply`,t=>{
 const write=scratch(t),question='Утверждаем и начинаем Research?',message='Что: версия.\n'+question;
 const expectedReplies=[{id:'idea',stage:'idea',role:'approval',asksStart:true,summary:['Что:'],question,reply:'принимаю',intent:'agree',outcome:{approval:true,startNext:true},response:['Утверждение записал.']}];
 const assistant=text=>host==='claude'?{type:'assistant',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}};
 const user=text=>host==='claude'?{type:'user',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}};
 const terminal=host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 const rows=[assistant(message),terminal,user('принимаю'),assistant('Утверждение записал.'),terminal];
 const check=()=>checkTrace({host,trace:write(rows),expectedReplies});
 assert.equal(check().status,'passed',JSON.stringify(check()));
 rows[2]=user('другой ответ');assert.equal(check().status,'failed');rows[2]=user('принимаю');
 rows[0]=assistant('Другой вопрос?');assert.notEqual(check().status,'passed');
});

for(const host of ['claude','codex'])test(`${host}: text scenarios reject any window attempt and repeated stage endings`,t=>{
 const write=scratch(t),question='Утверждаем?',expected={id:'idea',stage:'idea',role:'approval',asksStart:false,summary:['Версия'],question,reply:'принимаю',intent:'agree',outcome:{approval:true,startNext:false},response:['Записал.']};
 const assistant=text=>host==='claude'?{type:'assistant',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}};
 const user=text=>host==='claude'?{type:'user',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}};
 const terminal=host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 const rows=[assistant('Версия Idea.\n'+question),terminal,user('принимаю'),assistant('Версия Discovery.\n'+question),terminal,user('принимаю'),assistant('Записал.'),terminal];
 const expectedReplies=[{...expected,response:undefined},{...expected,id:'discovery',stage:'discovery'}];
 const check=()=>checkTrace({host,trace:write(rows),expectedReplies});
 assert.match(check().reason,/identical endings/);assert.equal(check().status,'failed');
 expectedReplies[1].question='Принимаем PRD?';rows[3]=assistant('Версия Discovery.\nПринимаем PRD?');assert.equal(check().status,'passed');
 for(const name of host==='claude'?['AskUserQuestion']:['request_user_input','request_user_input_async']){
  const call=host==='claude'?{type:'assistant',message:{content:[{type:'tool_use',id:'window',name,input:{questions:[]}}]}}:{type:'response_item',payload:{type:'function_call',name,call_id:'window',arguments:'{"questions":[]}'}};
  rows.splice(0,0,call);assert.equal(check().status,'failed');assert.match(check().reason,/called a window/);rows.shift();
 }
});

for(const host of ['claude','codex'])test(`${host}: late service work and a cut continuation cannot reuse an earlier text offer`,t=>{
 const write=scratch(t),question='Утверждаем?',expectedReplies=[{id:'idea',stage:'idea',role:'approval',asksStart:false,summary:['Версия'],question,reply:'принимаю',intent:'agree',outcome:{approval:true,startNext:false},response:['Записал.']}];
 const assistant=text=>host==='claude'?{type:'assistant',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}};
 const user=text=>host==='claude'?{type:'user',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}};
 const terminal=host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 const rows=[assistant('Версия\n'+question),terminal,user('принимаю'),assistant('Записал.'),terminal];
 const check=()=>checkTrace({host,trace:write(rows),expectedReplies});assert.equal(check().status,'passed');
 rows.push(assistant('Ещё служебная работа.'));assert.equal(check().status,'unverified');rows.pop();
 rows.splice(1,0,host==='claude'?{type:'assistant',message:{content:[{type:'tool_use',id:'service',name:'Read',input:{file_path:'/scratch/example'}}]}}:{type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'service',arguments:'{"cmd":"pwd"}'}});
 assert.notEqual(check().status,'passed');
});

const liveContext=JSON.parse(fs.readFileSync(new URL('./test-fixtures/skills-host-context-regressions.json',import.meta.url)));
for(const syntheticReply of [false,true])test(`continue8 saved Claude Skill body is never an owner reply (${syntheticReply})`,t=>{
 const rows=structuredClone(liveContext.synthetic.events),expected=JSON.parse(fs.readFileSync('evals/scenarios/idea/approve/scenario.json')).hosts.claude.expectedReplies;
 if(syntheticReply){rows[7].message.content[0].text=expected[0].reply;rows.splice(3,1);}
 const checked=textTrace({host:'claude',testedVersion:'0.45.0',trace:scratch(t)(rows),expectedReplies:expected});
 assert.equal(checked.status,syntheticReply?'failed':'passed',JSON.stringify(checked));
});
for(const role of ['developer','system'])test(`continue8 saved Codex resumed ${role} context preserves actual owner reply`,t=>{
 const rows=structuredClone(liveContext.context.events);rows.find(r=>r.payload?.role==='developer').payload.role=role;
 const expected=JSON.parse(fs.readFileSync('evals/scenarios/idea/defer/scenario.json')).hosts.codex.expectedReplies;
 const checked=textTrace({host:'codex',testedVersion:'0.45.0',trace:scratch(t)(rows),expectedReplies:expected});
 assert.equal(checked.status,'passed',JSON.stringify(checked));assert.equal(checked.exchanges[0].reply,expected[0].reply);
});
for(const sample of liveContext.controls)test(`continue8 saved ${sample.id} service commentary is not a stranded presentation`,t=>{
 const checked=textTrace({host:'codex',testedVersion:'0.42.0',trace:scratch(t)(sample.events),expectedWindows:sample.expectedWindows,phase:'excerpt'});
 assert.equal(checked.status,'passed',JSON.stringify(checked));
 const broken=structuredClone(sample.events),summary=broken.findLast(e=>e.payload?.role==='assistant'&&e.payload.phase==='final_answer').payload.content[0].text;
 broken.find(e=>e.payload?.role==='assistant').payload.content[0].text=summary;
 broken.findLast(e=>e.payload?.role==='assistant'&&e.payload.phase==='final_answer').payload.content[0].text='Короткое подтверждение.';
 const bad=textTrace({host:'codex',testedVersion:'0.42.0',trace:scratch(t)(broken),expectedWindows:sample.expectedWindows,phase:'excerpt'});
 assert.equal(bad.status,'failed');assert.match(bad.windows[0].issues.join(';'),/async summary must be final and last/);
});
for(const stage of ['idea','discovery','design','tech-evaluation','handoff'])for(const host of ['claude','codex'])test(`continue8 ${stage}/${host} clarification uses stems without accepting consent`,async()=>{
 const {checkStageResponse}=await import('./skills-owner.mjs'),expected=JSON.parse(fs.readFileSync(`evals/scenarios/${stage}/empty/scenario.json`)).hosts[host].expectedReplies[0];
 assert.doesNotThrow(()=>checkStageResponse(expected,liveContext.emptyResponse));
 assert.throws(()=>checkStageResponse(expected,'Изменение принято. Начинаю следующий этап.'));
});
for(const sample of liveContext.controls)test(`continue8 ${sample.id} unanchored D5 cannot hide a stranded summary behind service text`,t=>{
 const rows=structuredClone(sample.events),final=rows.findLast(r=>r.payload?.role==='assistant'&&r.payload.phase==='final_answer'),full=final.payload.content[0].text;
 rows.find(r=>r.payload?.role==='assistant').payload.content[0].text=full;
 const service={type:'response_item',payload:{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'Продолжим после согласия.'}]}};
 rows.splice(rows.findIndex(r=>r.payload?.name==='request_user_input_async'),0,service);final.payload.content[0].text='Продолжим после согласия.';
 const checked=textTrace({host:'codex',testedVersion:'0.42.0',trace:scratch(t)(rows),expectedWindows:sample.expectedWindows.map(e=>({...e,role:'approval',summary:[]})),phase:'excerpt'});
 assert.equal(checked.status,'failed',JSON.stringify(checked));assert.match(checked.windows[0].issues.join(';'),/async summary must be final and last/);
});
