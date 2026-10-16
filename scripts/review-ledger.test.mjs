import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';

const head='a'.repeat(40), base='b'.repeat(40), collectionId=`preflight-collect:${head}:1`;
const report={findings:[],overall_correctness:'patch is correct'};
const status={schema_version:1,status:'scoped-clean',engine:'claude',report_produced:true,exit_code:0,timed_out:false};
const receipt=()=>({head,base,collectionId,runId:'run-1',route:{model:'opus',effort:'high'},helperDigest:'c'.repeat(64),reviewDataset:{version:1,digest:'d'.repeat(64)},review:{exitCode:0,output:'bundle: 1 bytes; review passes: 1\n',json:report,status},loop:{iterations:1}});
const source=(type,data,ref=type)=>({type,ref,attempt:1,data});
async function api(){const m=await import('./review-ledger.mjs').catch(()=>({}));assert.equal(typeof m.buildReviewLedger,'function');return m;}

test('internal pass outcomes: clean and findings remain visible in the ledger',async()=>{
 const {buildReviewLedger}=await api();
 const sources=['clean','findings'].map((result,i)=>source('ledger',{kind:'internal-pass',id:`pass-${i}`,head,result},result));
 sources.push(source('ledger',{kind:'internal-pass',id:'legacy',head,status:'findings'},'legacy-status'));
 sources.push(source('ledger',{kind:'internal-pass',id:'unknown',head},'unknown'));
 const events=buildReviewLedger({issue:'MONO-998',sources}).attempts[0].events;
 assert.deepEqual(events.map(e=>e.status),['scoped-clean','findings','findings','unknown']);
 assert.ok(events.every(e=>e.kind==='internal-pass'));
});

test('one collection and invocation seen in history receipt and report are counted once',async()=>{
 const {buildReviewLedger,summarizeLedger}=await api();
 const r=receipt();
 const ledger=buildReviewLedger({issue:'MONO-998',sources:[source('history',{receipt:r}),source('receipt',{receipt:r}),source('report',{issue:'MONO-998',attempt:1,linear_mutations_pending:[{operation:'preflight-collect',payload:{request:{head,collectionId}}}]})]});
 const summary=summarizeLedger(ledger); assert.equal(summary.collections,1);assert.equal(summary.invocations,1);assert.equal(summary.confirmedPasses,1);assert.equal(summary.announcedPasses,1);
 const events=ledger.attempts[0].events;assert.equal(events.find(e=>e.kind==='collection-request').sources.length,3);
 assert.equal(events.find(e=>e.kind==='helper-invocation').reproducibility.complete,true);
 assert.equal(events.find(e=>e.kind==='helper-invocation').launchCause,'unknown');
});

test('conflicting receipts are unresolved instead of being summed or guessed',async()=>{
 const {buildReviewLedger,summarizeLedger}=await api();const r=receipt(),other={...receipt(),runId:'run-2'};
 const l=buildReviewLedger({issue:'MONO-998',sources:[source('history',{receipt:r},'one'),source('receipt',{receipt:other},'two')]});
 assert.ok(l.attempts[0].unresolvedCoverage.length); assert.equal(summarizeLedger(l).invocations,0);
});

test('causes require explicit evidence, self-check also requires content identity; certification is independent',async()=>{
 const {buildReviewLedger,summarizeLedger}=await api();
 const causes=['fix','head-change','retry','final-request','self-check','unknown'];
 const sources=causes.map((cause,i)=>source('ledger',{kind:'helper-invocation',ordinal:i+1,head,launchCause:cause,causeEvidence:'review decision',contentDigest:cause==='self-check'?'same':null,previousContentDigest:cause==='self-check'?'same':null,certificationRole:i===3?'certified':'none'},String(i)));
 sources.push(source('ledger',{kind:'helper-invocation',ordinal:7,head,launchCause:'self-check',causeEvidence:'same head alone'}));
 const l=buildReviewLedger({issue:'MONO-998',sources});const s=summarizeLedger(l);
 assert.deepEqual(s.causes,{fix:1,'head-change':1,retry:1,'final-request':1,'self-check':1,unknown:2});
 assert.equal(l.attempts[0].events.find(e=>e.certificationRole==='certified').launchCause,'final-request');
 assert.equal(l.attempts[0].events[0].reproducibility.complete,false);
});

test('withheld demand executes no helper and retries retain separate collection ids',async()=>{
 const {buildReviewLedger,summarizeLedger}=await api();const r=receipt();
 const l=buildReviewLedger({issue:'MONO-998',sources:[source('history',{receipt:r}),source('history',{receipt:{...r,runId:'retry',collectionId:`preflight-collect:${head}:2`}}),source('ledger',{kind:'collection-request',collectionId:'denied',head,status:'withheld'})]});
 const s=summarizeLedger(l);assert.equal(s.collections,3);assert.equal(s.withheld,1);assert.equal(s.invocations,2);
});

test('adjudication writes evidence and links in scratch without altering receipts',async()=>{
 const {adjudicate}=await api();const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-adjudicate-'));
 try {
  const record={eventId:'1:helper-invocation:1',origin:'incomplete-fix',evidence:'fixture proof',links:['D1'],progress:'fixed',recordedBy:'orchestrator'};
  const file=await adjudicate({evidenceRoot:root,issue:'MONO-998',record});assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),[record]);
  const replacement={...record,links:['D2']};
  await adjudicate({evidenceRoot:root,issue:'MONO-998',record:replacement});
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),[replacement]);
  await assert.rejects(adjudicate({evidenceRoot:root,issue:'MONO-998',record:{...record,evidence:''}}),/evidence/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('status and output aliases correlate by explicit ordinal and head; missing head stays unresolved',async()=>{
 const {buildReviewLedger,summarizeLedger}=await api();
 const invocation={kind:'helper-invocation',ordinal:1,head};
 const sources=[source('stream',invocation,'launch'),source('stream',{...invocation,review:{output:'review passes: 1\n',json:report,status,exitCode:0}},'stream'),source('report',{issue:'MONO-998',...invocation,review:{json:report,status,exitCode:0}},'status')];
 let l=buildReviewLedger({issue:'MONO-998',sources});assert.equal(summarizeLedger(l).invocations,1);assert.equal(l.attempts[0].events[0].sources.length,3);assert.equal(summarizeLedger(l).confirmedPasses,1);assert.equal(summarizeLedger(l).announcedPasses,1);
 sources[2].data.head=null;l=buildReviewLedger({issue:'MONO-998',sources});assert.ok(l.attempts[0].unresolvedCoverage.length);assert.equal(summarizeLedger(l).invocations,0);
});

test('history without collection id correlates through runId and attempt',async()=>{
 const {buildReviewLedger,summarizeLedger}=await api();const r=receipt(),historical=receipt();delete historical.collectionId;
 const l=buildReviewLedger({issue:'MONO-998',sources:[source('receipt',{receipt:r}),source('history',{receipt:historical})]});
 assert.equal(summarizeLedger(l).collections,1);assert.equal(summarizeLedger(l).invocations,1);
});

test('reproducibility requires usable version digest head base route and helper digest',async()=>{
 const {buildReviewLedger}=await api();
 for(const change of [r=>r.route={},r=>r.reviewDataset.version=0,r=>r.reviewDataset.digest='',r=>r.helperDigest='',r=>r.base=null]) {
  const r=receipt();change(r);const l=buildReviewLedger({issue:'MONO-998',sources:[source('receipt',{receipt:r})]});
  assert.equal(l.attempts[0].events.find(e=>e.kind==='helper-invocation').reproducibility.complete,false);
 }
});

test('stream reading counts executions once across resumes and joins explicit sidecars',async()=>{
 const {readLedgerSources,buildReviewLedger,summarizeLedger}=await api();const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-stream-'));
 try {
  const issue='MONO-998',statusFile=path.join(root,'status.json'),reportFile=path.join(root,'report.json');fs.writeFileSync(statusFile,JSON.stringify(status));fs.writeFileSync(reportFile,JSON.stringify(report));fs.mkdirSync(path.join(root,'logs'));
  const command=`/bin/zsh -lc '/fixture/autoreview --mode local --engine claude --model opus --thinking high --max-priority P2 --status-output ${statusFile} --json-output ${reportFile}'`;
  const item={id:'item_1',type:'command_execution',command,head,exit_code:0,aggregated_output:'autoreview target: local\nengine: claude\nmodel: opus\nthinking: high\nreview passes: 1\n'};
  const events=[{type:'thread.started',thread_id:'one'},{type:'item.started',item},{type:'item.completed',item},{type:'thread.started',thread_id:'one'},{type:'item.completed',item:{...item,id:'item_2',command:'cat helper-output.txt'}}];
  fs.writeFileSync(path.join(root,'logs',`${issue}-mono-deliver-a1.jsonl`),events.map(v=>JSON.stringify(v)).join('\n'));
  const l=buildReviewLedger({issue,sources:await readLedgerSources({issue,root,evidenceRoot:path.join(root,'evidence')})});
  assert.equal(summarizeLedger(l).invocations,1);assert.equal(summarizeLedger(l).confirmedPasses,1);
  assert.equal(l.attempts[0].events.find(e=>e.kind==='helper-invocation').sources.length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a stream runId aliases the already counted collection helper',async()=>{
 const {buildReviewLedger,summarizeLedger}=await api();const r=receipt();
 const l=buildReviewLedger({issue:'MONO-998',sources:[source('history',{receipt:r}),source('stream',{kind:'helper-invocation',runId:r.runId,head},'stream')]});
 assert.equal(summarizeLedger(l).invocations,1);assert.equal(l.attempts[0].events.find(e=>e.kind==='helper-invocation').sources.length,2);
});

test('decline events preserve finding identity and add no review executions',async()=>{
  const {buildReviewLedger,summarizeLedger}=await api();
  const {declineFixture}=await import('./decline-fixtures.mjs'),f=declineFixture();
  const l=buildReviewLedger({issue:'MONO-999',sources:[source('receipt',{receipt:f.receipt}),source('journal',f.journal,'decisions')]});
  const event=l.attempts[0].events.find(e=>e.kind==='decline');
  assert.equal(event.findingId,f.entry.finding.id);assert.equal(event.basis,'refutation');assert.equal(event.approvedBy,'orchestrator');
  assert.equal(summarizeLedger(l).declines,1);assert.equal(summarizeLedger(l).invocations,1);
});

import {classFixture,classSeal} from './class-fixtures.mjs';
test('recorded class and explicit key repeats require a current decision after the latest receipt; a new class proceeds',async()=>{
  const {buildReviewLedger,decideReview}=await api();
  for(const sameKey of [false,true]) {
    const f=classFixture({sameKey}),ledger=buildReviewLedger({issue:'MONO-999',sources:f.receipts.map(r=>source('history',{receipt:r},r.runId))});
    const decide=journal=>decideReview({ledger,records:f.records,journal,attempt:1});
    let result=decide(f.journal);
    assert.equal(result.classStop.required,true);assert.deepEqual(result.classStop.findingKeys,sameKey?['same-key']:[]);
    assert.deepEqual(result.classStop.classIds,sameKey?[]:[f.entry.id]);
    for(const outcome of ['fix-class','limit']) {
      result=decide({...f.journal,entries:[...f.journal.entries,...(outcome==='limit'?[f.boundary]:[]),f.decision(outcome)]});
      assert.equal(result.classStop.required,false);assert.deepEqual(result.classStop.decisions,['cd-001']);
    }
    result=decide({...f.journal,entries:[...f.journal.entries,f.decision('fix-class',{approvedAt:'2026-10-14T01:01:30Z',recordedAt:'2026-10-14T01:01:30Z'})]});
    assert.equal(result.classStop.required,true);
  }
  const f=classFixture(),ledger=buildReviewLedger({issue:'MONO-999',sources:f.receipts.map(r=>source('history',{receipt:r},r.runId))});
  const onlyNew={...f.entry,findingIds:[f.entry.findingIds[1]]};
  assert.equal(decideReview({ledger,records:[],journal:{issue:'MONO-999',entries:[classSeal(onlyNew)]},attempt:1}).classStop.required,false);
});


test('resumed withheld demand retains its stop and counts one actual reviewer execution',async()=>{
  const {buildReviewLedger,summarizeLedger}=await api(),f=classFixture(),r=f.receipts[1];
  const ledger=buildReviewLedger({issue:'MONO-999',sources:[
    source('ledger',{kind:'collection-request',collectionId:r.collectionId,status:'withheld'}),
    source('ledger',{kind:'class-stop',collectionId:r.collectionId,reason:'needs-decision'}),source('history',{receipt:r})]});
  const summary=summarizeLedger(ledger);
  assert.equal(summary.collections,1);assert.equal(summary.withheld,1);assert.equal(summary.classStops,1);assert.equal(summary.invocations,1);
  assert.equal(ledger.attempts[0].events.find(e=>e.kind==='class-stop').status,'withheld');
  assert.equal(ledger.attempts[0].events.find(e=>e.kind==='collection-request').status,'findings');
});

test('class stops share the withheld writer lock and preserve requests after contention',async()=>{
 const {recordClassStop,withholdCollection}=await api();
 const {withLock}=await import('./runtime.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-class-stop-lock-'));
 const issue='MONO-998',file=path.join(root,'reviews',`${issue}-withheld.json`);
 const stop={evidenceRoot:root,issue,attempt:1,collectionId:'stopped',stop:{required:true}};
 try {
  await withLock(file+'.lock',async()=>{
   await assert.rejects(async()=>recordClassStop(stop),/operation locked/);
   assert.equal(fs.existsSync(file),false);
  });
  await withholdCollection({evidenceRoot:root,issue,record:{attempt:1,collectionId:'other',reason:'manual stop',recordedBy:'orchestrator'}});
  await recordClassStop(stop);await recordClassStop(stop);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).map(r=>r.collectionId),['other','stopped']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('invalid issue keys are rejected before evidence access by every ledger entry point', async t => {
 const {readLedgerSources,buildReviewLedger,adjudicate,withholdCollection,recordClassStop}=await api();
 const invalid=['MONO-.*','MONO-0','MONO-01','mono-1','1MONO-1','MONO-1/../../other','MONO-1|OTHER-2','MONO-1\nOTHER-2',''];
 const methods=['existsSync','readFileSync','readdirSync','realpathSync','lstatSync','mkdirSync','openSync'];
 const calls=[];
 for(const name of methods)t.mock.method(fs,name,()=>{calls.push(name);throw new Error('evidence accessed');});
 for(const issue of invalid) {
  const options={issue,root:'/unused',evidenceRoot:'/unused'};
  assert.throws(()=>buildReviewLedger({...options,sources:[]}),/invalid issue/);
  for(const operation of [readLedgerSources,adjudicate,withholdCollection,recordClassStop])
   await assert.rejects(operation(options),operation===withholdCollection?/withheld requires issue/:/invalid issue/,`${operation.name}: ${issue}`);
 }
 assert.deepEqual(calls,[]);
});

test('valid issue keys retain receipt dataset matching', async () => {
 const {readLedgerSources}=await api();
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-ledger-keys-'));
 try {
  fs.mkdirSync(path.join(root,'history'));
  for(const issue of ['A-1','A0-10','MONO-999']) {
   const file=path.join(root,'history','receipt.json');
   fs.writeFileSync(file,JSON.stringify({reviewDataset:{source:`/dataset/${issue}-review-scope.v2.md`}}));
   assert.equal((await readLedgerSources({issue,root,evidenceRoot:root})).filter(s=>s.type==='history').length,1);
   fs.writeFileSync(file,JSON.stringify({reviewDataset:{source:`/dataset/${issue}0-review-scope.v2.md`}}));
   assert.equal((await readLedgerSources({issue,root,evidenceRoot:root})).filter(s=>s.type==='history').length,0);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('ledger CLI rejects invalid keys before reading records or evidence', () => {
 for(const command of ['build','print','adjudicate','decide','withhold']) {
  assert.throws(()=>execFileSync(process.execPath,['scripts/review-ledger.mjs',command,'--issue','MONO-.*','--root','/unused','--evidence-root','/unused','--record','/missing-record'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}),error=>error.status===1 && error.stderr.includes('valid --issue required') && !error.stderr.includes('ENOENT'));
 }
});
