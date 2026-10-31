import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkTrace } from './skills-trace.mjs';
const expected = {id:'approval',decision:'описание',advice:'Research',reason:'риск',summary:['Дальше:','Что']};
const base='evals/scenarios/probe/samples';
function scratch(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'skills-trace-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return (events)=>{const p=path.join(d,'trace.jsonl');fs.writeFileSync(p,events.map(e=>JSON.stringify(e)).join('\n')+'\n');return p;};}
const codexRows=()=>JSON.parse(fs.readFileSync(`${base}/codex/trace-control-v0.41.0-async-order.json`)).items.map((payload)=>({type:'response_item',payload:{...payload,...(payload.type==='function_call'?{call_id:'synthetic-window'}:{})}}));
const codexExpected={id:'approval',decision:'описание',advice:'Research',reason:'чтобы проверить',summary:['Что','Дальше:']};
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
 rows.at(-1).payload.phase='final_answer';rows.push({type:'response_item',payload:{type:'function_call',name:'exec',arguments:'{}',call_id:'late'}});
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
 const write=scratch(t),rows=codexRows();rows.push({type:'event_msg',payload:{type:'task_complete'}},{type:'event_msg',payload:{type:'token_count',info:{}}});
 assert.equal(checkTrace({host:'codex',trace:write(rows),expectedWindows:[codexExpected]}).status,'passed');
 rows.push({type:'event_msg',payload:{type:'task_started'}});assert.equal(checkTrace({host:'codex',trace:write(rows),expectedWindows:[codexExpected]}).status,'unverified');
});
test('Claude summary anchors cannot be borrowed from an earlier API message',t=>{
 const write=scratch(t),sample=JSON.parse(fs.readFileSync(`${base}/claude/trace-control-v0.41.0-approval.json`));
 const summary=sample.events.find(r=>r.line===138).event,window=sample.events.find(r=>r.line===139).event;
 summary.message.id='earlier-message';window.message.content.unshift({type:'text',text:'Коротко.'});
 assert.equal(checkTrace({host:'claude',trace:write([summary,window]),expectedWindows:[expected],excerpt:true}).status,'failed');
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
