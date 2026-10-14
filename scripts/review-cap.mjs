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
  const file=path.join(evidenceRoot,'reviews',`${chain.originalIssue}-counters.json`);
  return digest({journals:[...chain.journals].map(([key,journal])=>[key,currentEntries(journal)]),counters:fs.existsSync(file)?readJson(file):null});
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
function counters(evidenceRoot,chain) {
  const file=path.join(evidenceRoot,'reviews',`${chain.originalIssue}-counters.json`);
  const state=fs.existsSync(file)?readJson(file):{originalIssue:chain.originalIssue,external:[],local:[],stops:[],permits:{},pending:[]};
  state.pending??=[];
  if(state.originalIssue!==chain.originalIssue||!Array.isArray(state.external)||!Array.isArray(state.local)||!Array.isArray(state.stops)||!state.permits||!Array.isArray(state.pending))throw new Error('invalid review counters');
  const external=[],completed=new Set(),history=path.join(evidenceRoot,'history');
  let key;
  for(const name of fs.existsSync(history)?fs.readdirSync(history).filter(n=>n.endsWith('.json')):[]) {
    const envelope=readJson(path.join(history,name)),receipt=envelope.receipt;
    const pinned=/^([A-Z][A-Z0-9]*-[1-9][0-9]*)-a[1-9][0-9]*$/.exec(path.basename(path.dirname(receipt?.pins?.file??'')))?.[1];
    const owner=receipt?.issue??pinned;
    if(!chain.journals.has(owner))continue;
    key??=fs.readFileSync(path.join(evidenceRoot,'receipt.key'));
    if(key.length!==32||envelope.signature!==crypto.createHmac('sha256',key).update(canonical(receipt)).digest('hex'))throw new Error('cap history signature mismatch');
    completed.add(receipt.collectionId);
    if(blocking(receipt,chain.journals.get(owner)))external.push({issue:owner,runId:receipt.runId,digest:digest(receipt)});
  }
  state.external=[...new Map(external.map(r=>[r.runId,r])).values()].sort((a,b)=>a.runId.localeCompare(b.runId));
  state.pending=state.pending.filter(r=>!completed.has(r.collectionId));
  return {file,state,completed};
}
function continuations(chain,state) {
  const entries=[...chain.journals.values()].flatMap(j=>currentEntries(j).filter(e=>e.type==='continue'));
  if(new Set(entries.map(e=>e.stopId)).size!==entries.length)throw new Error('conflicting chain continuations');
  return entries.filter(e=>{
    const stop=state.stops.find(s=>s.id===e.stopId);
    return stop&&Date.parse(e.approvedAt)>=Date.parse(stop.recordedAt)&&Date.parse(e.recordedAt)<=Date.now();
  });
}
export function syncLocalPasses({evidenceRoot,report}) {
  const chain=reviewChain(evidenceRoot,report.issue),result=counters(evidenceRoot,chain);
  const prior=fs.existsSync(result.file)?digest(readJson(result.file)):null;
  const passes=report.capsule.local_passes??[];
  if(!Array.isArray(passes))throw new Error('local_passes must be an array');
  for(const pass of passes) {
    if(!/^[A-Za-z0-9:._-]{1,128}$/.test(pass.id??'')||!/^[a-f0-9]{40}$/.test(pass.head??'')||!['clean','findings'].includes(pass.result??'findings'))throw new Error('local pass id/head/result required');
    const event={kind:'internal-pass',issue:report.issue,attempt:report.attempt,id:pass.id,head:pass.head,result:pass.result??'findings'};
    const previous=result.state.local.find(p=>p.issue===event.issue&&p.attempt===event.attempt&&p.id===event.id);
    if(previous&&canonical({...previous,result:previous.result??'findings'})!==canonical(event))throw new Error('local pass identity changed');
    if(!previous)result.state.local.push(event);
  }
  const grants=continuations(chain,result.state);
  const localCeiling=Math.max(2,...grants.map(e=>result.state.stops.find(s=>s.id===e.stopId).local+e.localPasses));
  if(result.state.local.length>localCeiling || result.state.local.length>=localCeiling&&result.state.local.at(-1)?.result!=='clean') {
    const id=digest({originalIssue:chain.originalIssue,external:result.state.external,local:result.state.local});
    if(!result.state.stops.some(s=>s.id===id))result.state.stops.push({id,external:result.state.external.length,local:result.state.local.length,recordedAt:new Date().toISOString()});
    result.state.stops.find(s=>s.id===id).localCap=true;
    const file=path.join(evidenceRoot,'reviews',`${report.issue}-cap-stops.json`),records=fs.existsSync(file)?readJson(file):[];
    if(!records.some(r=>r.stop.id===id&&r.local))atomicJson(file,[...records,{kind:'cap-stop',local:true,
      attempt:report.attempt,collectionId:`local-cap:${id}`,reason:'needs-decision',recordedBy:'orchestrator',stop:result.state.stops.find(s=>s.id===id)}]);
  }
  if(prior!==digest(result.state))atomicJson(result.file,result.state);
  const localStop=result.state.stops.filter(s=>s.localCap).at(-1)??null;
  return {...result,chain,localStop,continued:!!localStop&&grants.some(e=>e.stopId===localStop.id)};
}
export async function withholdReviewCap({evidenceRoot,report,state,file,collectionId,stop}) {
  if(!stop) {
    const id=digest({originalIssue:state.originalIssue,external:state.external,local:state.local,pending:state.pending});
    stop=state.stops.find(s=>s.id===id);
    if(!stop){stop={id,external:state.external.length,local:state.local.length,recordedAt:new Date().toISOString()};state.stops.push(stop);}
  }
  atomicJson(file,state);
  const stopsFile=path.join(evidenceRoot,'reviews',`${report.issue}-cap-stops.json`),records=fs.existsSync(stopsFile)?readJson(stopsFile):[];
  if(!records.some(r=>r.attempt===report.attempt&&r.collectionId===collectionId))atomicJson(stopsFile,[...records,
    {kind:'cap-stop',attempt:report.attempt,collectionId,reason:'needs-decision',recordedBy:'orchestrator',stop}]);
  const withheld=path.join(evidenceRoot,'reviews',`${report.issue}-withheld.json`);
  if(!(fs.existsSync(withheld)?readJson(withheld):[]).some(r=>r.attempt===report.attempt&&r.collectionId===collectionId))
    await withholdCollection({evidenceRoot,issue:report.issue,record:{attempt:report.attempt,collectionId,reason:'needs-decision: review cap',recordedBy:'orchestrator'}});
  return {refused:true,stop};
}
// Read-only gate comparison; the admission transaction owns all reservations.
export function validateCapAdmission({evidenceRoot,issue,cap}) {
  const chain=reviewChain(evidenceRoot,issue),{state,completed}=counters(evidenceRoot,chain);
  if(completed.has(cap?.collectionId))return;
  if(!cap||!state.pending.some(r=>canonical(r)===canonical(cap)))throw new Error('review cap admission reservation missing');
  const localStop=state.stops.filter(s=>s.localCap).at(-1);
  if(cap.free) {
    if(localStop||state.local.length>2||state.external.length+state.pending.length>2)throw new Error('needs-decision: review cap');
  } else {
    const permit=state.permits[cap.stopId],decision=continuations(chain,state).find(e=>e.stopId===cap.stopId);
    if(!decision||localStop&&localStop.id!==cap.stopId||permit?.collectionId!==decision.collectionId||
      permit.reservations.length>decision.externalCollections||state.local.length>state.stops.find(s=>s.id===cap.stopId).local+decision.localPasses)throw new Error('needs-decision: review cap');
  }
}
export async function reserveReviewCollection({evidenceRoot,report,collectionId,reportDigest}) {
  const synced=syncLocalPasses({evidenceRoot,report}),{file,state,chain,localStop}=synced;
  // Reservation replay survives an interrupted write of the admission file.
  const replay=state.pending.find(r=>r.collectionId===collectionId)??Object.values(state.permits).flatMap(p=>p.reservations).find(r=>r.collectionId===collectionId);
  if(replay) {
    if(replay.issue!==report.issue||replay.attempt!==report.attempt||replay.reportDigest!==reportDigest)throw new Error('conflicting cap reservation');
    try {validateCapAdmission({evidenceRoot,issue:report.issue,cap:replay});return replay;}
    catch(error) {
      if(error.message!=='needs-decision: review cap')throw error;
      if(!replay.free)return withholdReviewCap({...synced,evidenceRoot,report,collectionId,stop:localStop??state.stops.find(s=>s.id===replay.stopId)});
    }
    // A stopped free reservation can be promoted only by its bound continuation.

  }
  const reservation={issue:report.issue,attempt:report.attempt,collectionId,reportDigest};
  if(state.external.length+state.pending.length<2&&state.local.length<=2&&!localStop) {
    reservation.free=true;state.pending.push(reservation);atomicJson(file,state);return reservation;
  }
  const decision=continuations(chain,state).find(e=>{
    const stopped=state.stops.find(s=>s.id===e.stopId),permit=state.permits[e.stopId];
    return (!localStop||e.stopId===localStop.id)&&(permit?permit.collectionId===e.collectionId:e.collectionId===collectionId)&&
      (permit?.reservations.length??0)<e.externalCollections&&state.local.length<=stopped.local+e.localPasses;
  });
  if(!decision)return withholdReviewCap({...synced,evidenceRoot,report,collectionId,stop:localStop});
  const permit=state.permits[decision.stopId]??={collectionId:decision.collectionId,reservations:[]};
  Object.assign(reservation,{decisionId:decision.id,decisionDigest:decision.recordDigest,stopId:decision.stopId});
  permit.reservations.push(reservation);state.pending=state.pending.filter(r=>r.collectionId!==collectionId);state.pending.push(reservation);
  atomicJson(file,state);return reservation;
}
