import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJson, canonical, digest, readJson} from './runtime.mjs';
import {readJournal, currentEntries, acceptedDeclines} from './decisions.mjs';
import {withholdCollection} from './review-ledger.mjs';

// Called under the orchestrator launch lock. Workers only report local passes;
// signed history, links, counters, stops and reservations belong to evidence.
export function reviewChain(evidenceRoot,issue) {
  const journal=readJournal({evidenceRoot,issue});
  const link=journal.entries.find(e=>e.type==='successor'),originalIssue=link?.originalIssue??issue;
  const original=link?readJournal({evidenceRoot,issue:originalIssue}):journal;
  if(original.entries.some(e=>e.type==='successor'))throw new Error('successor must reference the original Issue');
  const validateLink=(child,relation)=>{
    const decision=original.entries.find(e=>e.id===relation.decision.id);
    const authorized=decision?.type==='continue'&&decision.successorIssue===child ||
      decision?.type==='class-decision'&&decision.outcome==='limit'&&
      decision.successor.match(/\/issue\/([A-Z][A-Z0-9]*-[1-9][0-9]*)(?:\/|$)/)?.[1]===child;
    if(!authorized||digest(decision)!==relation.decision.digest)throw new Error('successor requires original orchestrator decision');
  };
  if(link)validateLink(issue,link);
  const journals=new Map([[originalIssue,original]]),directory=path.join(evidenceRoot,'decisions');
  for(const name of fs.existsSync(directory)?fs.readdirSync(directory).filter(n=>/^[A-Z][A-Z0-9]*-[1-9][0-9]*\.json$/.test(n)):[]) {
    const child=name.slice(0,-5);
    if(child===originalIssue)continue;
    const candidate=child===issue?journal:readJournal({evidenceRoot,issue:child});
    const relation=candidate.entries.find(e=>e.type==='successor'&&e.originalIssue===originalIssue);
    if(relation){validateLink(child,relation);journals.set(child,candidate);}
  }
  return {originalIssue,journals};
}
export function capDecisionDigest(evidenceRoot,issue) {
  const chain=reviewChain(evidenceRoot,issue);
  return digest([...chain.journals].map(([key,journal])=>[key,currentEntries(journal)]));
}
function blocking(receipt,journal) {
  const report=receipt.review?.json;
  if(!report)return false;
  const actionable=f=>['P0','P1','P2',0,1,2].includes(f?.priority);
  if(['missing_required_findings','scope_rejected_findings','attribution_rejected_findings'].some(k=>report[k]?.length)||
    report.priority_filtered_findings?.some(actionable))return true;
  return (report.findings??[]).some((finding,index)=>{
    if(!actionable(finding))return false;
    try {acceptedDeclines(receipt,journal,[index]);return false;}catch{return true;}
  });
}
function counters(evidenceRoot,chain,worktree) {
  const file=path.join(evidenceRoot,'reviews',`${chain.originalIssue}-counters.json`);
  const state=fs.existsSync(file)?readJson(file):{originalIssue:chain.originalIssue,external:[],local:[],stops:[],permits:{}};
  if(state.originalIssue!==chain.originalIssue||!Array.isArray(state.local)||!Array.isArray(state.stops)||!state.permits)throw new Error('invalid review counters');
  const external=[],history=path.join(evidenceRoot,'history');
  let key;
  for(const name of fs.existsSync(history)?fs.readdirSync(history).filter(n=>n.endsWith('.json')):[]) {
    const envelope=readJson(path.join(history,name)),receipt=envelope.receipt;
    const pinned=/^([A-Z][A-Z0-9]*-[1-9][0-9]*)-a[1-9][0-9]*$/.exec(path.basename(path.dirname(receipt?.pins?.file??'')))?.[1];
    const owner=receipt?.issue??pinned??(receipt?.worktree===worktree?chain.currentIssue:null);
    if(!chain.journals.has(owner))continue;
    key??=fs.readFileSync(path.join(evidenceRoot,'receipt.key'));
    if(key.length!==32||envelope.signature!==crypto.createHmac('sha256',key).update(canonical(receipt)).digest('hex'))throw new Error('cap history signature mismatch');
    if(blocking(receipt,chain.journals.get(owner)))external.push({issue:owner,runId:receipt.runId,digest:digest(receipt)});
  }
  state.external=[...new Map(external.map(r=>[r.runId,r])).values()].sort((a,b)=>a.runId.localeCompare(b.runId));
  return {file,state};
}
export function syncLocalPasses({evidenceRoot,report,worktree}) {
  const chain={...reviewChain(evidenceRoot,report.issue),currentIssue:report.issue},result=counters(evidenceRoot,chain,worktree);
  const prior=fs.existsSync(result.file)?digest(readJson(result.file)):null;
  const passes=report.capsule.local_passes??[];
  if(!Array.isArray(passes))throw new Error('local_passes must be an array');
  for(const pass of passes) {
    if(!/^[A-Za-z0-9:._-]{1,128}$/.test(pass.id??'')||!/^[a-f0-9]{40}$/.test(pass.head??''))throw new Error('local pass id/head required');
    const event={kind:'internal-pass',issue:report.issue,attempt:report.attempt,id:pass.id,head:pass.head};
    const previous=result.state.local.find(p=>p.issue===event.issue&&p.attempt===event.attempt&&p.id===event.id);
    if(previous&&canonical(previous)!==canonical(event))throw new Error('local pass identity changed');
    if(!previous)result.state.local.push(event);
  }
  const grants=[...chain.journals.values()].flatMap(j=>currentEntries(j).filter(e=>e.type==='continue'));
  const localCeiling=Math.max(2,...grants.flatMap(e=>{
    const stop=result.state.stops.find(s=>s.id===e.stopId);
    return stop&&Date.parse(e.approvedAt)>=Date.parse(stop.recordedAt)&&Date.parse(e.recordedAt)<=Date.now()?[stop.local+e.localPasses]:[];
  }));
  if(result.state.local.length>=localCeiling) {
    const id=digest({originalIssue:chain.originalIssue,external:result.state.external,local:result.state.local});
    if(!result.state.stops.some(s=>s.id===id))result.state.stops.push({id,external:result.state.external.length,local:result.state.local.length,recordedAt:new Date().toISOString()});
    const file=path.join(evidenceRoot,'reviews',`${report.issue}-cap-stops.json`),records=fs.existsSync(file)?readJson(file):[];
    if(!records.some(r=>r.stop.id===id&&r.local))atomicJson(file,[...records,{kind:'cap-stop',local:true,
      attempt:report.attempt,collectionId:`local-cap:${id}`,reason:'needs-decision',recordedBy:'orchestrator',stop:result.state.stops.find(s=>s.id===id)}]);
  }
  if(prior!==digest(result.state))atomicJson(result.file,result.state);
  return {...result,chain};
}
export async function reserveReviewCollection({evidenceRoot,report,worktree,collectionId,reportDigest}) {
  const {file,state,chain}=syncLocalPasses({evidenceRoot,report,worktree});
  // Reservation replay survives an interrupted write of the admission file.
  const replay=Object.values(state.permits).flatMap(p=>p.reservations).find(r=>r.collectionId===collectionId);
  if(replay) {
    if(replay.issue!==report.issue||replay.attempt!==report.attempt||replay.reportDigest!==reportDigest)throw new Error('conflicting cap reservation');
    return replay;
  }
  if(state.external.length<2&&state.local.length<=2)return null;
  const stopId=digest({originalIssue:state.originalIssue,external:state.external,local:state.local});
  // A still-open allowance remains bound to its initial stop, not a fresh head.
  const entries=[...chain.journals.values()].flatMap(j=>currentEntries(j).filter(e=>e.type==='continue'));
  if(new Set(entries.map(e=>e.stopId)).size!==entries.length)throw new Error('conflicting chain continuations');
  const decision=entries.find(e=>{
    const stopped=state.stops.find(s=>s.id===e.stopId),permit=state.permits[e.stopId];
    return stopped&&Date.parse(e.approvedAt)>=Date.parse(stopped.recordedAt)&&Date.parse(e.recordedAt)<=Date.now()&&
      (permit?permit.collectionId===e.collectionId:e.collectionId===collectionId)&&
      (permit?.reservations.length??0)<e.externalCollections&&state.local.length<=stopped.local+e.localPasses;
  });
  if(!decision) {
    let stop=state.stops.find(s=>s.id===stopId);
    if(!stop){stop={id:stopId,external:state.external.length,local:state.local.length,recordedAt:new Date().toISOString()};state.stops.push(stop);}
    atomicJson(file,state);
    const stopsFile=path.join(evidenceRoot,'reviews',`${report.issue}-cap-stops.json`),records=fs.existsSync(stopsFile)?readJson(stopsFile):[];
    if(!records.some(r=>r.attempt===report.attempt&&r.collectionId===collectionId))atomicJson(stopsFile,[...records,
      {kind:'cap-stop',attempt:report.attempt,collectionId,reason:'needs-decision',recordedBy:'orchestrator',stop}]);
    const withheld=path.join(evidenceRoot,'reviews',`${report.issue}-withheld.json`);
    if(!(fs.existsSync(withheld)?readJson(withheld):[]).some(r=>r.attempt===report.attempt&&r.collectionId===collectionId))
      await withholdCollection({evidenceRoot,issue:report.issue,record:{attempt:report.attempt,collectionId,reason:'needs-decision: review cap',recordedBy:'orchestrator'}});
    return {refused:true,stop};
  }
  const permit=state.permits[decision.stopId]??={collectionId:decision.collectionId,reservations:[]};
  const reservation={issue:report.issue,attempt:report.attempt,collectionId,reportDigest,decisionId:decision.id,decisionDigest:decision.recordDigest,stopId:decision.stopId};
  permit.reservations.push(reservation);
  atomicJson(file,state);
  return reservation;
}
