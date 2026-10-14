import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJson,canonical,digest,readJson} from './runtime.mjs';
import {recordDecision,decisionDigest} from './decisions.mjs';
import {reserveReviewCollection,syncLocalPasses,reviewChain} from './review-cap.mjs';
import {classFixture,classSeal} from './class-fixtures.mjs';
import {declineFixture} from './decline-fixtures.mjs';

const seal=entry=>({...entry,recordDigest:decisionDigest(entry)});
async function fixture(run) {
  const evidenceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mono-review-cap-'));
  const key=Buffer.alloc(32,9),worktree=path.join(evidenceRoot,'repo'),issue='MONO-999';
  fs.writeFileSync(path.join(evidenceRoot,'receipt.key'),key);
  const receipt=r=>atomicJson(path.join(evidenceRoot,'history',r.runId+'.json'),{receipt:r,signature:crypto.createHmac('sha256',key).update(canonical(r)).digest('hex')});
  const report=(attempt=1,head='d'.repeat(40),owner=issue,passes=[])=>({issue:owner,attempt,head,capsule:{local_passes:passes}});
  const reserve=(r,n)=>reserveReviewCollection({evidenceRoot,worktree,report:r,reportDigest:digest(r),collectionId:`preflight-collect:${r.head}:${n}`});
  const continuation=async(stop,collectionId,extra={})=>{
    const now=new Date().toISOString(),entry=seal({type:'continue',id:'continue-1',supersedes:null,stopId:stop.id,collectionId,
      localPasses:1,externalCollections:1,nextStep:'Fix one bounded class',checkpoint:'Fixtures plus one external review',approvedBy:'orchestrator',approvedAt:now,recordedAt:now,...extra});
    await recordDecision({evidenceRoot,issue,entry});return entry;
  };
  try {await run({evidenceRoot,worktree,issue,receipt,report,reserve,continuation});}
  finally {fs.rmSync(evidenceRoot,{recursive:true,force:true});}
}
test('cap chain: head, attempt and authorized successor keep both counters; unauthorized successor fails',async()=>{
  await fixture(async f=>{
    for(const r of classFixture().receipts)f.receipt(r);
    const first=await f.reserve(f.report(),3);assert.equal(first.refused,true);
    assert.equal((await f.reserve(f.report(2,'e'.repeat(40)),1)).refused,true);
    const id=`preflight-collect:${'f'.repeat(40)}:1`;
    const decision=await f.continuation(first.stop,id,{successorIssue:'MONO-1000'});
    const now=new Date().toISOString(),link=seal({type:'successor',id:'s-1',originalIssue:f.issue,
      decision:{id:decision.id,digest:digest(decision)},approvedBy:'orchestrator',approvedAt:now,recordedAt:now});
    await recordDecision({evidenceRoot:f.evidenceRoot,issue:'MONO-1000',entry:link});
    const successor=f.report(1,'f'.repeat(40),'MONO-1000');
    assert.equal((await f.reserve(successor,1)).stopId,first.stop.id);
    assert.equal((await f.reserve(successor,2)).refused,true);
    assert.equal(readJson(path.join(f.evidenceRoot,'reviews',`${f.issue}-counters.json`)).external.length,2);
    await recordDecision({evidenceRoot:f.evidenceRoot,issue:'MONO-1001',entry:link});
    assert.throws(()=>reviewChain(f.evidenceRoot,'MONO-1001'),/orchestrator decision/);
  });
});
test('local cap: stable pass IDs survive head/attempt changes and bound continuation before and after external review',async()=>{
  for(const external of [false,true])await fixture(async f=>{
    if(external)f.receipt(classFixture().receipts[0]);
    const passes=[{id:'local-1',head:'a'.repeat(40)},{id:'local-2',head:'b'.repeat(40)}],r=f.report(1,'c'.repeat(40),f.issue,passes);
    const synced=syncLocalPasses({evidenceRoot:f.evidenceRoot,worktree:f.worktree,report:r});
    assert.equal(synced.state.local.length,2);assert.equal(synced.state.stops.length,1);
    syncLocalPasses({evidenceRoot:f.evidenceRoot,worktree:f.worktree,report:r});
    const next=f.report(2,'d'.repeat(40),f.issue,[{id:'local-3',head:'d'.repeat(40)}]);
    const id=`preflight-collect:${next.head}:1`;
    await f.continuation(synced.state.stops[0],id);
    assert.equal((await f.reserve(next,1)).decisionId,'continue-1');
    const fourth=f.report(2,'e'.repeat(40),f.issue,[{id:'local-4',head:'e'.repeat(40)}]);
    assert.equal((await f.reserve(fourth,2)).refused,true);
    assert.equal(readJson(synced.file).local.length,4);
  });
});
test('external cap counts blocking findings after valid declines and re-counts a revoked decline',async()=>{
  await fixture(async f=>{
    const x=declineFixture();
    x.receipt.worktree=f.worktree;f.receipt(x.receipt);
    // A changed receipt cannot reuse the old decline.
    let result=syncLocalPasses({evidenceRoot:f.evidenceRoot,worktree:f.worktree,report:f.report()});
    assert.equal(result.state.external.length,1);
    const {findingIdentity}=await import('./decisions.mjs');
    const entry=classSeal({...x.entry,receipt:{collectionId:x.receipt.collectionId,runId:x.receipt.runId,digest:digest(x.receipt)},finding:findingIdentity(x.receipt,0)});
    await recordDecision({evidenceRoot:f.evidenceRoot,issue:f.issue,entry});
    result=syncLocalPasses({evidenceRoot:f.evidenceRoot,worktree:f.worktree,report:f.report()});assert.equal(result.state.external.length,0);
    const now=new Date().toISOString();await recordDecision({evidenceRoot:f.evidenceRoot,issue:f.issue,entry:seal({type:'decline-revoke',id:'revoke-1',forId:entry.id,
      declineDigest:entry.recordDigest,reason:'New reproduction',evidence:{citation:'Reachable defect'},evidenceDigest:digest({citation:'Reachable defect'}),
      approvedBy:'orchestrator',approvedAt:now,recordedAt:now})});
    result=syncLocalPasses({evidenceRoot:f.evidenceRoot,worktree:f.worktree,report:f.report()});assert.equal(result.state.external.length,1);
  });
});
