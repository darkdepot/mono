#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { atomicJson, canonical, withLock, isMain } from './runtime.mjs';
import { parseReviewUsage } from './gate.mjs';
import { readJournal, validateJournal } from './decisions.mjs';

const causes = ['fix','head-change','retry','final-request','self-check','unknown'];
const statuses = ['scoped-clean','findings','filtered','incorrect','incomplete','reviewer_unavailable','withheld','unknown'];
const kinds = ['collection-request','helper-invocation','internal-pass'];
const issuePattern = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const alias = source => ({type:source.type,ref:source.ref});
const uniqueSources = sources => [...new Map(sources.map(s=>[canonical(s),s])).values()];
function decoded(value) { if(typeof value !== 'string') return value; try{return JSON.parse(value);}catch{return null;} }
function walk(value, visit, pointer = '') {
  value = decoded(value); if (!value || typeof value !== 'object') return;
  visit(value,pointer);
  for (const [key,child] of Object.entries(value)) if (child && (typeof child === 'object' || key === 'notes')) walk(child,visit,`${pointer}/${key}`);
}
function launchCause(data) {
  if (!causes.includes(data.launchCause) || !data.causeEvidence) return 'unknown';
  if (data.launchCause === 'self-check' && (!data.contentDigest || data.contentDigest !== data.previousContentDigest)) return 'unknown';
  return data.launchCause;
}
function reproducibility(data) {
  const inputs = {version:data.datasetVersion ?? data.reviewDataset?.version ?? null,digest:data.datasetDigest ?? data.reviewDataset?.digest ?? null,
    head:data.head ?? null,base:data.base ?? null,route:data.route ?? null,helperDigest:data.helperDigest ?? null};
  const complete=Number.isSafeInteger(inputs.version)&&inputs.version>0&&/^[a-f0-9]{64}$/.test(inputs.digest??'')&&/^[a-f0-9]{64}$/.test(inputs.helperDigest??'')&&
    /^[a-f0-9]{40}$/.test(inputs.head??'')&&/^[a-f0-9]{40}$/.test(inputs.base??'')&&Boolean(inputs.route?.model&&inputs.route?.effort);
  return {complete,...inputs};
}
function event(kind,key,data,sources) {
  const route = data.route ? {engine:data.route.engine ?? 'claude',model:data.route.model ?? null,effort:data.route.effort ?? null,provider:data.route.provider ?? 'unknown'} : null;
  return {id:`${data.attempt}:${kind}:${key}`,kind,sources:uniqueSources(sources),parent:data.parent ?? null,stage:data.stage ?? null,
    head:data.head ?? null,base:data.base ?? null,route,threshold:data.threshold ?? null,datasetVersion:data.datasetVersion ?? data.reviewDataset?.version ?? null,
    status:statuses.includes(data.status)?data.status:'unknown',reason:data.reason ?? null,findings:data.findings ?? null,announcedPasses:data.announcedPasses ?? null,confirmedPasses:data.confirmedPasses ?? null,
    launchCause:launchCause(data),certificationRole:['none','certified','superseded'].includes(data.certificationRole)?data.certificationRole:'none',
    startedAt:data.startedAt ?? null,endedAt:data.endedAt ?? null,usage:data.usage ?? null,usageReason:data.usageReason ?? 'usage unavailable in sources',
    reproducibility:reproducibility(data)};
}
function validReport(report) {
  return report && ['patch is correct','patch is incorrect'].includes(report.overall_correctness) && Array.isArray(report.findings) &&
    report.findings.every(f=>f && (['P0','P1','P2','P3'].includes(f.priority) || [0,1,2,3].includes(f.priority)));
}
function reviewFacts(review = {}) {
  const report=review.json, status=review.status;
  const validated=status?.schema_version===1 && status.report_produced===true && status.exit_code===review.exitCode && validReport(report);
  const passes=validated ? (Array.isArray(report.pass_reports) && report.pass_reports.length ? report.pass_reports.map(p=>p.report) : [report]) : null;
  const confirmed=passes && passes.every(validReport) ? passes.length : null;
  const announcements=[...(review.output ?? '').matchAll(/^(?:bundle: [0-9]+ bytes; )?review passes: ([0-9]+)$/gm)];
  return {status:statuses.includes(status?.status)?status.status:'unknown',findings:validated?report.findings.length:null,
    announcedPasses:announcements.length===1?Number(announcements[0][1]):null,confirmedPasses:confirmed,
    ...(review.usage ? {usage:review.usage,usageReason:review.usageReason ?? null} : parseReviewUsage(review.output ?? '',status?.engine ?? 'claude'))};
}

export function buildReviewLedger({issue,sources}) {
  if(!issuePattern.test(issue)) throw new Error('invalid issue');
  const attempts=new Map(),collections=new Map(),locals=[];
  const runCollections=new Map();
  for(const source of sources) {
    if(!['receipt','history'].includes(source.type))continue;
    const r=source.data.receipt??source.data;
    if(r.runId&&r.collectionId){const key=`${source.attempt??r.attempt??1}:${r.runId}`;if(!runCollections.has(key))runCollections.set(key,new Set());runCollections.get(key).add(r.collectionId);}
  }
  const attemptState=attempt=>{if(!attempts.has(attempt)) attempts.set(attempt,{attempt,events:[],unresolvedCoverage:[]});return attempts.get(attempt);};
  const unresolved=(attempt,reason,refs)=>attemptState(attempt).unresolvedCoverage.push({reason,sources:uniqueSources(refs)});
  const addCollection=(source,data,receipt=null)=>{
    const attempt=source.attempt ?? data.attempt ?? 1;
    const linked=runCollections.get(`${attempt}:${data.runId}`);
    if(linked?.size>1){unresolved(attempt,'runId refers to multiple collections',[alias(source)]);return;}
    const key=data.collectionId ?? (linked?.size===1?[...linked][0]:data.runId);
    if(!key){unresolved(attempt,'collection identity unavailable',[alias(source)]);return;}
    const id=`${attempt}:${key}`;
    if(!collections.has(id)) collections.set(id,{key,attempt,claims:[],receipts:[],sources:[]});
    const group=collections.get(id);group.sources.push(alias(source));group.claims.push(data);if(receipt)group.receipts.push(receipt);
  };
  for(const source of sources) {
    const attempt=source.attempt ?? 1;attemptState(attempt);
    if(source.type==='unresolved') {unresolved(attempt,source.data.reason,[{type:'stream',ref:source.ref}]);continue;}
    if(['history','receipt'].includes(source.type)) {
      const receipt=source.data.receipt ?? source.data;
      addCollection(source,receipt,receipt);
    } else if(source.type==='report') {
      const data=source.data;if(data.issue!==issue)continue;
      if(data.kind==='helper-invocation'){locals.push({source,data:{...data,attempt}});continue;}
      const seen=new Set();
      walk(data,(value,pointer)=>{
        const request=value.operation==='preflight-collect'?value.payload?.request:
          value.collectionId && (typeof value.collect==='boolean'||value.kind==='collection-request')?value:null;
        if(request && !seen.has(request.collectionId)) {seen.add(request.collectionId);addCollection({...source,ref:source.ref+"#"+pointer},request);}
      });
    } else if(source.type==='ledger' || source.type==='stream') {
      const data=source.data;
      if(data.kind==='collection-request')addCollection(source,data);
      else if(data.kind==='helper-invocation')locals.push({source,data:{...data,attempt}});
      else unresolved(attempt,'unrecognized event kind',[alias(source)]);
    }
  }
  for(const group of collections.values()) {
    const {key,attempt}=group;
    const runs=new Set(group.receipts.map(r=>r.runId).filter(Boolean));
    const heads=new Set(group.claims.map(r=>r.head).filter(Boolean));
    const receipts=[...new Map(group.receipts.map(r=>[canonical({...r,collectionId:key}),r])).values()];
    const conflict=runs.size>1 || heads.size>1 || receipts.length>1;
    const data={...group.claims[0],...group.receipts[0],attempt};
    const collection=event('collection-request',key,data,group.sources);attemptState(attempt).events.push(collection);
    if(conflict){unresolved(attempt,'ambiguous collection/history/receipt correlation; invocation count withheld',group.sources);continue;}
    if(collection.status==='withheld') continue;
    const receipt=group.receipts[0];
    if(!receipt){unresolved(attempt,'collection has no execution receipt',group.sources);continue;}
    const review=receipt.review;
    if(!review || (review.exitCode===null && !review.status && !review.output))continue;
    const facts=reviewFacts(review);collection.status=facts.status;
    const invocation=event('helper-invocation',key,{...data,...facts,parent:collection.id,threshold:receipt.invocation?.[receipt.invocation.indexOf('--max-priority')+1] ?? null},group.sources);
    attemptState(attempt).events.push(invocation);
    addPasses(invocation,attemptState(attempt));
  }
  // Sidecar/stream aliases require the same observed ordinal AND head. Missing
  // identity is reported, never joined using a filename, time window or cause.
  const localGroups=new Map();
  for(const {source,data} of locals) {
    const linked=runCollections.get(`${data.attempt}:${data.runId}`);
    if(linked?.size>1){unresolved(data.attempt,'helper runId is ambiguous',[alias(source)]);continue;}
    const key=data.collectionId ?? (linked?.size===1?[...linked][0]:data.runId) ?? data.ordinal;
    data.canonicalKey=key;
    if(key===undefined || key===null){unresolved(data.attempt,'helper invocation ordinal unavailable',[alias(source)]);continue;}
    const id=`${data.attempt}:${key}`;
    if(!localGroups.has(id))localGroups.set(id,[]);
    localGroups.get(id).push({source,data});
  }
  for(const group of localGroups.values()) {
    const first=group[0].data,state=attemptState(first.attempt),refs=group.map(g=>alias(g.source));
    const key=first.canonicalKey;
    const existing=state.events.find(e=>e.kind==='helper-invocation' && e.id===`${first.attempt}:helper-invocation:${key}`);
    const heads=new Set(group.map(g=>g.data.head).filter(Boolean));
    if(group.length>1 && (heads.size!==1 || group.some(g=>!g.data.head))) {unresolved(first.attempt,'ambiguous invocation/stream/status head correlation',refs);continue;}
    if(existing) {
      if(first.head && existing.head===first.head)existing.sources=uniqueSources([...existing.sources,...refs]);
      else unresolved(first.attempt,'stream/receipt head correlation unavailable',refs);
      continue;
    }
    const data=Object.assign({},...group.map(g=>g.data));
    const reviewEntries=group.map(g=>g.data.review).filter(Boolean);
    let conflict=false;
    for(const field of ['base','route','threshold','contentDigest']) {
      const values=group.map(g=>g.data[field]).filter(v=>v!==null&&v!==undefined);
      if(new Set(values.map(canonical)).size>1)conflict=true;
    }
    for(const field of ['json','status','exitCode']) {
      const values=reviewEntries.map(r=>r[field]).filter(v=>v!==null&&v!==undefined);
      if(new Set(values.map(canonical)).size>1)conflict=true;
    }
    if(conflict){unresolved(first.attempt,'conflicting invocation aliases',refs);continue;}
    if(reviewEntries.length)data.review=Object.assign({},...reviewEntries.map(r=>Object.fromEntries(Object.entries(r).filter(([,v])=>v!==null&&v!==undefined))));
    const invocation=event('helper-invocation',key,{...data,...(data.review?reviewFacts(data.review):{})},refs);
    state.events.push(invocation);addPasses(invocation,state);
  }
  return {issue,attempts:[...attempts.values()].sort((a,b)=>a.attempt-b.attempt)};
}
function addPasses(invocation,state) {
  for(let index=0;index<(invocation.confirmedPasses ?? 0);index++) {
    state.events.push({...invocation,id:`${invocation.id.replace(':helper-invocation:',':internal-pass:')}:${index+1}`,kind:'internal-pass',parent:invocation.id,
      usage:null,usageReason:'usage belongs to invocation',announcedPasses:null,confirmedPasses:null});
  }
}
export function summarizeLedger(ledger) {
  const events=ledger.attempts.flatMap(a=>a.events),collections=events.filter(e=>e.kind==='collection-request'),invocations=events.filter(e=>e.kind==='helper-invocation');
  const summary={collections:collections.length,withheld:collections.filter(e=>e.status==='withheld').length,invocations:invocations.length,
    causes:Object.fromEntries(causes.map(c=>[c,invocations.filter(e=>e.launchCause===c).length])),
    announcedPasses:invocations.some(e=>e.announcedPasses!==null)?invocations.reduce((n,e)=>n+(e.announcedPasses??0),0):null,
    confirmedPasses:invocations.some(e=>e.confirmedPasses!==null)?invocations.reduce((n,e)=>n+(e.confirmedPasses??0),0):null,
    measured:0,providers:{},missingUsage:{},unresolvedCoverage:ledger.attempts.reduce((n,a)=>n+a.unresolvedCoverage.length,0)};
  for(const e of invocations) {
    const n=e.usage?.normalized;
    if(!n || !nonnegative(n.input)||!nonnegative(n.cacheRead)||!nonnegative(n.output)||(n.cacheWrite!==null&&!nonnegative(n.cacheWrite))) {
      const reason=e.usageReason ?? 'usage unavailable in sources';summary.missingUsage[reason]=(summary.missingUsage[reason]??0)+1;continue;
    }
    const provider=typeof e.route?.provider==='string'?e.route.provider:e.route?.provider?.id ?? 'unknown';
    const key=`${e.usage.engine}/${provider}`;
    summary.providers[key]??={input:0,cacheRead:0,cacheWrite:e.usage.engine==='codex'?null:0,output:0,measured:0};
    const total=summary.providers[key];for(const field of ['input','cacheRead','cacheWrite','output'])if(n[field]!==null)total[field]+=n[field];
    total.measured++;summary.measured++;
  }
  return summary;
}

function jsonFile(file) {return JSON.parse(fs.readFileSync(file,'utf8'));}
function files(directory,recursive=false) {
  if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isFile()?[path.join(directory,e.name)]:recursive&&e.isDirectory()?files(path.join(directory,e.name),true):[]).sort();
}
function belongs(receipt,issue) {
  return receipt.issue===issue || path.basename(receipt.worktree ?? '')===issue || new RegExp(`^${issue}-review-scope(?:\\.v[0-9]+)?\\.md$`).test(path.basename(receipt.reviewDataset?.source ?? ''));
}
// Recognize explicit shell helper calls and Python argv launches, not excerpts
// of helper source, read-back commands or files that merely contain a command.
function helperLaunch(command, knownCommands) {
  if(!command || /\bcat\s*>|\.write_text\([^\n]*(?:scripts\/gate|SKILL)/.test(command))return false;
  const python=/subprocess\.(?:run|Popen)\(\s*(?:args|cmd)\b/.test(command) && /(?:args|cmd)\s*=\s*\[[^\n]*\/autoreview['"]\s*,\s*['"]--mode['"]/.test(command);
  const shell=/(?:^|\n|&&|;)\s*['"]?[^\s'"]*\/autoreview['"]?\s+--mode\s+(?:local|branch|commit)/.test(command.replace(/^\/bin\/\w+ -lc ['"]/,''));
  const copied=/cmd\s*=\s*\[s\.replace\(['"]([^'"]+)['"],['"]([^'"]+)['"]\) for s in json\.loads\(\((\w+)\/['"]([^'"]+)\.command\.json['"]\)\.read_text\(\)\)\]/.exec(command);
  const pointer=command.match(/['"]([^'"]*preflight-root\.json)['"]/ )?.[1];
  const clone=copied && pointer && copied[1]===copied[4] && knownCommands.has(`${pointer}:${copied[4]}`) && /subprocess\.(?:run|Popen)\(cmd,/.test(command);
  if(python || clone) {
    const n=command.match(/(?:^|[;\n])n=([0-9]+)/)?.[1];
    const name=command.match(/(?:^|[;\n])name=['"]([^'"]+)['"]/)?.[1] ?? (n?`local-${n}`:command.match(/['"](local-[0-9]+)\.command\.json['"]/)?.[1]);
    if(pointer&&name)knownCommands.add(`${pointer}:${name}`);
  }
  return python || shell || clone;
}
export async function readLedgerSources({issue,root,evidenceRoot}) {
  const sources=[];
  const withheldFile=path.join(evidenceRoot,'reviews',`${issue}-withheld.json`);
  if(fs.existsSync(withheldFile))for(const data of jsonFile(withheldFile))sources.push({type:'ledger',ref:withheldFile,attempt:data.attempt,data});
  for(const file of [...files(path.join(root,'consumed'),true),...files(path.join(root,'reports'),true)]) {
    if(!file.endsWith('.json')||!path.basename(file).startsWith(issue+'-'))continue;
    try{const data=jsonFile(file);if(data.issue===issue)sources.push({type:'report',ref:file,attempt:data.attempt??1,data});}catch{sources.push({type:'unresolved',ref:file,attempt:1,data:{reason:'malformed report'}});}
  }
  const collectionAttempts=new Map();
  for(const source of sources)if(source.type==='report')walk(source.data,value=>{
    if(value.collectionId){if(!collectionAttempts.has(value.collectionId))collectionAttempts.set(value.collectionId,new Set());collectionAttempts.get(value.collectionId).add(source.attempt);}
  });
  for(const file of [...files(path.join(evidenceRoot,'history')),...files(evidenceRoot)]) {
    if(!file.endsWith('.json'))continue;
    try{const data=jsonFile(file),r=data.receipt??data;if(belongs(r,issue)){
      const observed=collectionAttempts.get(r.collectionId);
      if(observed?.size>1){sources.push({type:'unresolved',ref:file,attempt:r.attempt??1,data:{reason:'receipt collection belongs to multiple attempts'}});continue;}
      sources.push({type:path.basename(path.dirname(file))==='history'?'history':'receipt',ref:file,attempt:r.attempt??(observed?.size===1?[...observed][0]:1),data});
    }}catch{/* Unrelated evidence cannot be attributed to this Issue. */}
  }
  const ordinals=new Map(),knownCommands=new Set();
  for(const file of files(path.join(root,'logs'))) {
    if(!path.basename(file).startsWith(issue+'-')||!file.endsWith('.jsonl'))continue;
    const attempt=Number(path.basename(file).match(/-a([0-9]+)\.jsonl$/)?.[1]??1);
    let line=0,thread='initial',session=0;const items=new Map();
    for await(const text of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})) {
      line++;let value;try{value=JSON.parse(text);}catch{sources.push({type:'unresolved',ref:`${file}:${line}`,attempt,data:{reason:'malformed stream line'}});continue;}
      if(value.type==='thread.started')thread=`${value.thread_id??'unknown'}:${++session}`;
      const item=value.item;
      if(!['item.started','item.completed'].includes(value.type)||item?.type!=='command_execution')continue;
      const itemKey=`${thread}:${item.id}`;
      items.set(itemKey,{item,line});
    }
    for(const {item,line} of items.values()) {
      const ref=`${file}:${line}`,output=item.aggregated_output??'';
      if(helperLaunch(item.command,knownCommands)) {
        const ordinal=(ordinals.get(attempt)??0)+1;ordinals.set(attempt,ordinal);
        const header=key=>output.match(new RegExp(`^${key}: (.+)$`,'m'))?.[1]??null;
        const option = key => {
          const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          return item.command.match(new RegExp(`['"]${escaped}['"]\\s*,\\s*['"]([^'"]+)['"]`))?.[1] ?? item.command.match(new RegExp(`${escaped}\\s+['"]?([^\\s'"]+)`))?.[1] ?? null;
        };
        const engine=header('engine')??option('--engine'),model=header('model')??option('--model'),effort=header('thinking')??option('--thinking');
        sources.push({type:'stream',ref,attempt,data:{kind:'helper-invocation',ordinal,head:item.head??null,stage:path.basename(file).match(/-(mono-[a-z]+)-a/)?.[1]??null,
          route:engine?{engine,model,effort,provider:'unknown'}:null,threshold:option('--max-priority'),review:{output,exitCode:item.exit_code,json:item.review?.json??null,status:item.review?.status??null}}});
        const statusFile=option('--status-output'),reportFile=option('--json-output');
        if(item.head && statusFile && reportFile && path.isAbsolute(statusFile) && path.isAbsolute(reportFile)) {
          try {
            const status=jsonFile(statusFile),json=jsonFile(reportFile);
            if(status.schema_version!==1||!validReport(json))throw new Error('unvalidated sidecar/report');
            sources.push({type:'report',ref:`${statusFile}#${ordinal}@${item.head}`,attempt,data:{issue,kind:'helper-invocation',ordinal,head:item.head,
              review:{status,json,exitCode:status.exit_code}}});
          }catch{sources.push({type:'unresolved',ref,attempt,data:{reason:'explicit helper sidecar or report unavailable or invalid'}});}
        }
        if(!item.head)sources.push({type:'unresolved',ref,attempt,data:{reason:'local launch has no observed head; later output/status cannot be joined by guess'}});
      } else if(/^autoreview target:/m.test(output) && !/\b(?:cat|sed|rg)\b/.test(item.command??'')) {
        sources.push({type:'unresolved',ref,attempt,data:{reason:'helper output read-back lacks an unambiguous invocation ordinal and head; not counted again'}});
      }
    }
  }
  return sources;
}
export async function adjudicate({evidenceRoot,issue,record}) {
  if(!issuePattern.test(issue))throw new Error('invalid issue');
  if(!record || !record.eventId || !['original','incomplete-fix','fix-regression','scope-decision','preparation-failure','provider-retry','undeterminable'].includes(record.origin)||
    typeof record.evidence!=='string'||!record.evidence.trim()||!Array.isArray(record.links)||record.links.some(v=>typeof v!=='string'||!v)||
    !['fixed','evidence','new-cause','none',null].includes(record.progress)||typeof record.recordedBy!=='string'||!record.recordedBy.trim())throw new Error('adjudication requires event, origin, evidence, links, progress and recordedBy');
  const file=path.join(evidenceRoot,'reviews',`${issue}-adjudications.json`);fs.mkdirSync(path.dirname(file),{recursive:true});
  return withLock(file+'.lock',()=>{const records=fs.existsSync(file)?jsonFile(file):[];if(!Array.isArray(records))throw new Error('invalid adjudication records');
    const clean=Object.fromEntries(['eventId','origin','evidence','links','progress','recordedBy'].map(k=>[k,record[k]]));
    if(!records.some(r=>canonical(r)===canonical(clean)))atomicJson(file,[...records,clean]);return file;});
}
export function decideReview({ledger,records,journal,attempt}) {
  validateJournal(journal);
  if(journal.issue!==ledger.issue)throw new Error('journal issue mismatch');
  if(!Array.isArray(records)||!Number.isSafeInteger(attempt)||attempt<1)throw new Error('records and positive attempt required');
  const state=ledger.attempts.find(a=>a.attempt===attempt);
  if(!state)throw new Error('attempt absent from ledger');
  const events=new Map(state.events.map(e=>[e.id,e])), decisions=new Map(journal.entries.filter(e=>e.type==='decision').map(e=>[e.id,e]));
  const rounds=new Map(), unresolved=[];
  for(const record of records) {
    const event=events.get(record.eventId);
    if(!event)continue;
    if(!Array.isArray(record.links)||!['fixed','evidence','new-cause','none',null].includes(record.progress))throw new Error('invalid adjudication record');
    // An internal pass and its enclosing helper/collection are one review round.
    let round=event;
    const visited=new Set();
    while(round.parent && events.has(round.parent)) {
      if(visited.has(round.id))throw new Error('cyclic ledger parents');
      visited.add(round.id);round=events.get(round.parent);
    }
    let item=rounds.get(round.id);
    if(!item){item={eventIds:[],keys:new Set(),progress:null};rounds.set(round.id,item);}
    if(!item.eventIds.includes(event.id))item.eventIds.push(event.id);
    item.progress=record.progress;
    if(event.status==='findings' && Number.isSafeInteger(event.findings) && event.findings>0) {
      for(const link of record.links) {
        const decision=decisions.get(link);
        if(decision)item.keys.add(decision.findingKey);
        else unresolved.push({eventId:event.id,link});
      }
    }
  }
  const counts=new Map();
  for(const round of rounds.values())for(const key of round.keys)counts.set(key,(counts.get(key)??0)+1);
  const recent=[...rounds.values()].slice(-2);
  return {issue:ledger.issue,attempt,matrixFindingKeys:[...counts].filter(([,n])=>n>=2).map(([key])=>key).sort(),
    checkpointRequired:recent.length===2 && recent.every(r=>r.progress==='none'),
    rounds:[...rounds].map(([id,r])=>({id,eventIds:r.eventIds,progress:r.progress})),unresolvedLinks:unresolved};
}
export async function withholdCollection({evidenceRoot,issue,record}) {
  if(!issuePattern.test(issue)||!record||!Number.isSafeInteger(record.attempt)||record.attempt<1||
    typeof record.collectionId!=='string'||!record.collectionId.trim()||typeof record.reason!=='string'||!record.reason.trim()||
    typeof record.recordedBy!=='string'||!record.recordedBy.trim())throw new Error('withheld requires issue, attempt, collectionId, reason and recordedBy');
  const file=path.join(evidenceRoot,'reviews',`${issue}-withheld.json`);
  return withLock(file+'.lock',()=>{
    const records=fs.existsSync(file)?jsonFile(file):[];
    if(!Array.isArray(records))throw new Error('invalid withheld records');
    const clean=Object.fromEntries(['attempt','collectionId','reason','recordedBy'].map(key=>[key,record[key]]));
    const next={...clean,kind:'collection-request',status:'withheld'};
    const previous=records.find(r=>r.attempt===record.attempt&&r.collectionId===record.collectionId);
    if(previous && canonical(previous)!==canonical(next))throw new Error('withheld request payload changed');
    if(!previous)atomicJson(file,[...records,next]);
    return file;
  });
}
export function printLedger(ledger) {
  const summary=summarizeLedger(ledger);
  const lines=[`Review ledger ${ledger.issue}`,'| Attempt | Collections | Withheld | Invocations | Announced passes | Confirmed passes |','| --- | ---: | ---: | ---: | ---: | ---: |'];
  for(const attempt of ledger.attempts){const s=summarizeLedger({attempts:[attempt]});lines.push(`| ${attempt.attempt} | ${s.collections} | ${s.withheld} | ${s.invocations} | ${s.announcedPasses??'unknown'} | ${s.confirmedPasses??'unknown'} |`);}
  lines.push(`Causes: ${Object.entries(summary.causes).map(([k,v])=>`${k}=${v}`).join(', ')}`,`Usage: measured ${summary.measured} of ${summary.invocations}`,`Unresolved coverage: ${summary.unresolvedCoverage}`);
  for(const a of ledger.attempts)for(const gap of a.unresolvedCoverage)lines.push(`- attempt ${a.attempt}: ${gap.reason} (${gap.sources.map(s=>s.ref).join(', ')})`);
  return lines.join('\n');
}
async function main() {
  const argv=process.argv.slice(2),command=argv.shift(),options={};
  if(command==='--help'||argv.includes('--help')){console.log('Usage: review-ledger.mjs build|print|adjudicate|decide|withhold --issue KEY [--root DIR] [--evidence-root DIR] [--out DIR] [--record JSON_FILE] [--attempt N]');return;}
  for(let i=0;i<argv.length;i+=2){if(!['--issue','--root','--evidence-root','--out','--record','--attempt'].includes(argv[i])||!argv[i+1])throw new Error('invalid arguments');options[argv[i].slice(2)]=argv[i+1];}
  const issue=options.issue;if(!issuePattern.test(issue??''))throw new Error('valid --issue required');
  const state=process.env.MONO_WORKFLOW_STATE_ROOT??path.join(os.homedir(),'.mono-agent-workflow');
  const root=path.resolve(options.root??path.join(state,'orchestrator','mono-agent-workflow'));
  const evidenceRoot=path.resolve(options['evidence-root']??path.join(state,'evidence',path.basename(root)));
  if(command==='decide') {
    const ledger=jsonFile(path.join(evidenceRoot,'reviews',`${issue}.json`));
    if(ledger.issue!==issue)throw new Error('ledger issue mismatch');
    const recordsFile=path.join(evidenceRoot,'reviews',`${issue}-adjudications.json`);
    const records=fs.existsSync(recordsFile)?jsonFile(recordsFile):[];
    console.log(JSON.stringify(decideReview({ledger,records,journal:readJournal({evidenceRoot,issue}),attempt:Number(options.attempt)}),null,2));return;
  }
  if(command==='withhold'){if(!options.record)throw new Error('--record required');console.log(await withholdCollection({evidenceRoot,issue,record:jsonFile(options.record)}));return;}
  if(command==='adjudicate'){if(!options.record)throw new Error('--record required');console.log(await adjudicate({evidenceRoot,issue,record:jsonFile(options.record)}));return;}
  if(!['build','print'].includes(command))throw new Error('expected build, print or adjudicate');
  const ledger=buildReviewLedger({issue,sources:await readLedgerSources({issue,root,evidenceRoot})});
  const adjudicationFile=path.join(evidenceRoot,'reviews',`${issue}-adjudications.json`);
  if(fs.existsSync(adjudicationFile))ledger.adjudications=jsonFile(adjudicationFile);
  if(command==='build'||options.out){const file=path.join(options.out??path.join(evidenceRoot,'reviews'),`${issue}.json`);atomicJson(file,ledger);console.log(`Ledger: ${file}`);}
  console.log(printLedger(ledger));
}
if(isMain(import.meta.url))main().catch(error=>{console.error(`review-ledger: ${error.message}`);process.exitCode=1;});
