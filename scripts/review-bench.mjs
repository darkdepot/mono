#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { canonical, digest as receiptDigest, isMain } from './runtime.mjs';
import { parseReviewUsage } from './gate.mjs';
import defaultRoutes from './review-bench-routes.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const need = (ok, message) => { if (!ok) throw new Error(message); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const oid = value => typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value);
const name = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value);
const readJSON = file => JSON.parse(fs.readFileSync(file,'utf8'));
const environmentNames = ['PATH','HOME','TMPDIR','LANG','LC_ALL','SystemRoot','PATHEXT'];
function baseEnvironment() {
  const env = {};
  for (const key of environmentNames) if (process.env[key]) env[key]=process.env[key];
  return {...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'};
}
function git(repo, ...args) {
  try { return execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd:repo,env:baseEnvironment(),maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']}); }
  catch { throw new Error('Git input unavailable or unsupported'); }
}
function regular(file) { need(fs.lstatSync(file).isFile(),'input must be a regular file'); return fs.readFileSync(file); }
function within(root,file) { const rel=path.relative(fs.realpathSync(root),fs.realpathSync(file)); return rel!=='' && !rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel); }
function credentialValues(routes,env=process.env) {
  return [...new Set(routes.flatMap(route=>(route.credentialEnv??[]).map(key=>env[key])).filter(value=>typeof value==='string'&&value.length>0))];
}
function redact(value,secrets=[]) {
  if(typeof value==='string') {
    for(const secret of secrets) for(const form of [secret,Buffer.from(secret).toString('base64')]) value=value.split(form).join('[REDACTED]');
    return value;
  }
  if(Array.isArray(value)) return value.map(item=>redact(item,secrets));
  if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[redact(key,secrets),redact(item,secrets)]));
  return value;
}
function noSecrets(bytes,secrets) { for(const value of secrets) need(!bytes.toString().includes(value),'input contains a credential value'); }
function seal(value) { return {...value,digest:hash(canonical(value))}; }
function verifySeal(value) { const {digest,...body}=value; need(sha(digest)&&hash(canonical(body))===digest,'frozen artifact digest mismatch'); }
function evidence(repo,base,head) {
  need(oid(head)&&oid(base),'invalid code version');
  const objects=fs.realpathSync(path.resolve(repo,git(repo,'rev-parse','--git-path','objects').toString().trim()));
  need(!/[\r\n]/.test(objects),'unsupported object directory path');
  const format=git(repo,'rev-parse','--show-object-format').toString().trim();
  const view=fs.mkdtempSync(path.join(os.tmpdir(),'mono-bench-objects-'));
  try {
    // Borrow only objects, never the source checkout's diff config or attributes.
    git(view,'init','--quiet','--bare','--object-format='+format);
    fs.writeFileSync(path.join(view,'objects','info','alternates'),objects+'\n');
    need(git(view,'rev-parse',`${head}^{commit}`).toString().trim()===head,'head unavailable');
    need(git(view,'merge-base',base,head).toString().trim()===base,'base is not the pinned merge-base');
    need(!git(view,'ls-tree','-r',head).toString().split('\n').some(line=>line.startsWith('160000 ')),'submodule input is not reproducible');
    return {diff:hash(git(view,'diff','--no-ext-diff','--no-textconv','--binary','--full-index',base,head)),tree:git(view,'rev-parse',`${head}^{tree}`).toString().trim()};
  } finally {fs.rmSync(view,{recursive:true,force:true});}
}

function helperPartitioning(bytes) {
  const declarations=[...bytes.toString('utf8').matchAll(/^MAX_REVIEW_PROMPT_BYTES[ \t]*=[^\r\n]*$/gm)];
  const literal=declarations.length===1?declarations[0][0].match(/^MAX_REVIEW_PROMPT_BYTES[ \t]*=[ \t]*([1-9][0-9]*(?:_[0-9]+)*)[ \t]*(?:#[^\r\n]*)?$/)?.[1]:null;
  const budget=literal?Number(literal.replaceAll('_','')):null;
  const known=Number.isSafeInteger(budget)&&budget>0;
  return {algorithm:'pinned-helper-defaults',maxPromptBytes:known?budget:'unknown',reason:known?null:'frozen helper has no unique supported positive-integer budget declaration'};
}
const toolsProtocol = plan => plan?.tools??'off';

export function buildManifest({evidenceRoot,repo,helper,plan=null,routes=defaultRoutes,env=process.env,orchestratorRoot=null}) {
  need(evidenceRoot&&repo,'evidence root and repository required');
  const credentials=credentialValues(routes,env);
  const sources=[];
  for(const directory of [evidenceRoot,path.join(evidenceRoot,'history')]) if(fs.existsSync(directory)) {
    for(const entry of fs.readdirSync(directory).sort()) if(entry.endsWith('.json')) sources.push(path.join(directory,entry));
  }
  const cases=[],excluded=[],helpers={},seen=new Map();
  for(const file of sources) {
    const source=path.relative(evidenceRoot,file);
    try {
      const bytes=regular(file),receipt=JSON.parse(bytes).receipt;
      need(receipt&&receipt.head,'not a review receipt');
      const identity=receipt.runId??hash(bytes);
      if(seen.has(identity)) { need(seen.get(identity)===hash(canonical(receipt)),'conflicting receipt copies'); continue; }
      seen.set(identity,hash(canonical(receipt)));
      const d=receipt.reviewDataset;
      need(Number.isSafeInteger(d?.version)&&d.version>0&&sha(d.digest)&&d.archive,'archived dataset version unavailable');
      need(within(path.join(evidenceRoot,'datasets'),d.archive),'dataset archive outside datasets');
      const dataset=regular(d.archive);
      need(hash(dataset)===d.digest&&regular(d.archive+'.sha256').toString().trim()===d.digest,'dataset digest mismatch');
      const cluster=path.basename(d.archive).match(/^([A-Z][A-Z0-9]*-[1-9][0-9]*)-review-scope\.v[1-9][0-9]*\.md$/)?.[1];
      need(cluster,'dataset cluster unavailable');
      const helperFile=receipt.helperArchive??helper??receipt.helper;
      need(helperFile&&sha(receipt.helperDigest),'helper copy unavailable');
      const helperBytes=regular(helperFile);
      need(receiptDigest(helperBytes.toString('utf8'))===receipt.helperDigest,'helper version unavailable');
      noSecrets(dataset,credentials); noSecrets(helperBytes,credentials);
      need(receipt.route?.model&&receipt.route?.effort,'production route unavailable');
      const digests=evidence(repo,receipt.base,receipt.head);
      const caseId='case-'+hash(identity).slice(0,16);
      const selection=plan?.cases?.find(item=>item.id===caseId);
      helpers[receipt.helperDigest]={version:receipt.helperDigest,byteDigest:hash(helperBytes),bytes:helperBytes.toString('base64')};
      cases.push({id:caseId,cluster,head:receipt.head,base:receipt.base,risk:receipt.risk??'unknown',datasetVersion:d.version,datasetDigest:d.digest,dataset:dataset.toString('base64'),helperVersion:receipt.helperDigest,helperArchive:receipt.helperDigest,
        evidenceDigests:{...digests,receipt:hash(bytes),dataset:d.digest,helper:hash(helperBytes)},source,
        partitioning:helperPartitioning(helperBytes),
        productionRoute:{engine:receipt.route.engine??'claude',model:receipt.route.model,effort:receipt.route.effort},
        selection:selection??null});
    } catch(error) { excluded.push({source,reason:redact(error.message,credentials)}); }
  }
  cases.sort((a,b)=>a.id.localeCompare(b.id));
  if(plan) validatePlan(plan,cases);
  return seal({schemaVersion:1,orchestratorRoot:orchestratorRoot?fs.realpathSync(orchestratorRoot):null,toolSettings:{webSearch:false,tools:toolsProtocol(plan)==='on'},cases,helpers,excluded,plan,routes,
    clusters:[...new Set(cases.map(c=>c.cluster))].sort(),feasibility:plan?'sample declared; quality depends on coverage and adjudication':'archive inventory only; sample and gold not yet frozen'});
}
function validatePlan(plan,cases) {
  need(plan&&Array.isArray(plan.cases)&&plan.cases.length>0,'sample cases required');
  need(['off','on'].includes(toolsProtocol(plan)),'plan tools must be off or on');
  need(Number.isSafeInteger(plan.repeats)&&plan.repeats>=1&&plan.repeats<=20,'invalid repeats');
  need(Number.isSafeInteger(plan.maxCalls)&&plan.maxCalls>0,'call stop rule required');
  need(Number.isFinite(plan.timeoutSec)&&plan.timeoutSec>0&&plan.timeoutSec<=3600,'timeout stop rule required');
  need(typeof plan.stopRule==='string'&&plan.stopRule.length>0,'stop rule description required');
  need(plan.minimums&&Number.isSafeInteger(plan.minimums.families)&&plan.minimums.families>=2,'independent family target required');
  for(const key of ['clean','pairs','heldoutFamilies','P0','P1','P2']) need(Number.isSafeInteger(plan.minimums[key])&&plan.minimums[key]>=1,'sample minimums must cover clean, pairs, heldout and each severity');
  const clusters=new Map(),selected=new Set();
  for(const item of plan.cases) {
    const c=cases.find(c=>c.id===item.id); need(c&&!selected.has(item.id),'unknown or duplicate selected case'); selected.add(item.id);
    need(['development','heldout'].includes(item.partition),'partition required');
    need(['defect','fix','clean'].includes(item.kind),'case kind required');
    need(!clusters.has(c.cluster)||clusters.get(c.cluster)===item.partition,'task cluster crosses heldout boundary'); clusters.set(c.cluster,item.partition);
    need(Array.isArray(item.gold),'gold list required');
    const ids=new Set(); for(const g of item.gold) { need(id(g.id)&&!ids.has(g.id)&&['P0','P1','P2'].includes(g.severity)&&typeof g.evidence==='string'&&g.evidence.length>0,'invalid gold defect'); ids.add(g.id); }
    need(item.kind==='defect'?item.gold.length>0:item.gold.length===0,'gold inconsistent with case kind');
    if(item.kind!=='clean') need(id(item.pair),'defect/fix pair required');
    else need(item.pair==null,'clean cases cannot belong to a defect/fix pair');
  }
  for(const item of plan.cases.filter(i=>i.kind!=='clean')) {
    const members=plan.cases.filter(i=>i.pair===item.pair);
    const other=members.find(i=>i.kind===(item.kind==='defect'?'fix':'defect'));
    need(members.length===2&&other&&cases.find(c=>c.id===item.id).cluster===cases.find(c=>c.id===other.id).cluster,'pair must contain exactly one defect and one fix from one cluster');
  }
}
function runDirectory(evidenceRoot,runId,create=false) {
  need(id(runId),'invalid run id');
  const root=fs.realpathSync(evidenceRoot),bench=path.join(root,'bench');
  if(!fs.existsSync(bench)) { need(create,'bench run unavailable'); fs.mkdirSync(bench,{mode:0o700}); }
  need(fs.lstatSync(bench).isDirectory()&&!fs.lstatSync(bench).isSymbolicLink(),'bench must be a real directory');
  const dir=path.join(bench,runId);
  if(create) fs.mkdirSync(dir,{mode:0o700});
  need(fs.lstatSync(dir).isDirectory()&&!fs.lstatSync(dir).isSymbolicLink(),'run must be a real directory');
  return dir;
}
function write(dir,file,value,credentials=[]) { const bytes=JSON.stringify(redact(value,credentials),null,2)+'\n'; fs.writeFileSync(path.join(dir,file),bytes,{flag:'wx',mode:0o600}); }
export function freezeManifest(options) {
  const manifest=buildManifest(options),dir=runDirectory(options.evidenceRoot,options.runId,true);
  write(dir,'manifest.json',manifest,credentialValues(manifest.routes,options.env)); return manifest;
}

function subscriptionLoginEvidence(route) {
  const evidence=route?.eligibility?.subscriptionLogin;
  if(!evidence||!['claude','codex','grok'].includes(evidence.cli)) return null;
  if(route.engine==='pi'?!['claude','codex'].includes(evidence.cli):evidence.cli!==route.engine) return null;
  if(typeof evidence.statusCommand!=='string'||!evidence.statusCommand.trim()||/[\r\n]/.test(evidence.statusCommand)) return null;
  if(typeof evidence.checkedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(evidence.checkedAt)||!Number.isFinite(Date.parse(evidence.checkedAt))) return null;
  if(typeof evidence.by!=='string'||!evidence.by.trim()) return null;
  return evidence;
}
function routeCheck(route,env,tools='off') {
  const reasons=[],missing=[];
  if(!route||!id(route.id)||!['claude','pi','codex','grok'].includes(route.engine)||!id(route.model)||!['low','medium','high','xhigh','max'].includes(route.effort)) reasons.push('invalid route schema');
  if(!route?.provider||!id(route.provider.id)||route.eligibility?.billingChannelAllowed!==true||typeof route.eligibility?.source!=='string'||!route.eligibility.source.trim()) reasons.push('billing channel not admitted with a source');
  if(route?.eligibility?.toVerify) reasons.push('provider compatibility or billing requires verification');
  if(route?.engine==='codex'&&tools==='off') reasons.push('helper rejects tools-off for Codex');
  if(route?.engine==='pi'&&tools==='on') reasons.push('helper forces tools off for pi');
  if(route?.engine==='grok'&&tools==='on') reasons.push('helper forces tools off for grok');
  const subscriptionLogin=subscriptionLoginEvidence(route);
  if(route?.engine==='grok') {
    if((route.credentialEnv?.length??0)>0||(route.environment&&typeof route.environment==='object'&&!Array.isArray(route.environment)&&Object.keys(route.environment).length>0)) reasons.push('grok routes accept subscription login only');
    if(!subscriptionLogin) reasons.push('subscription login evidence required');
  }
  if(!Array.isArray(route?.credentialEnv)||!route.credentialEnv.every(name)) reasons.push('invalid credential variable names');
  else if(route.credentialEnv.length===0) {
    if(route.engine!=='grok'&&!subscriptionLogin) reasons.push('subscription login evidence required');
  } else for(const variable of route.credentialEnv) if(!env[variable]) missing.push(variable);
  if(!route?.environment||typeof route.environment!=='object'||Array.isArray(route.environment)) reasons.push('environment mapping required');
  else for(const [target,source] of Object.entries(route.environment)) {
    if(!name(target)||!name(source)||!route.credentialEnv?.includes(source)||!['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','XAI_API_KEY','GEMINI_API_KEY','MINIMAX_API_KEY'].includes(target)) reasons.push('environment must map allowed target names to declared credentials');
  }
  const targets=Object.keys(route?.environment??{});
  if(route?.engine==='claude'&&targets.some(k=>!['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'].includes(k))) reasons.push('credential target incompatible with Claude');
  if(route?.engine==='pi'&&(route?.provider?.endpoint||targets.some(k=>!['XAI_API_KEY','GEMINI_API_KEY','MINIMAX_API_KEY'].includes(k)))) reasons.push('credential target or endpoint incompatible with Pi');
  if(route?.credentialEnv?.some(k=>!Object.values(route.environment??{}).includes(k))) reasons.push('declared credential is not mapped to helper');
  if(route?.engine==='claude'&&route?.provider?.id!=='anthropic'&&(!route?.provider?.endpoint||targets.length!==1)) reasons.push('external Claude provider requires an endpoint and one credential mapping');
  if(route?.provider?.endpoint) {
    try {const u=new URL(route.provider.endpoint);need(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash,'bad endpoint');} catch { reasons.push('invalid provider endpoint'); }
  }
  if(missing.length) reasons.push('missing credentials');
  return {routeId:route?.id??'invalid',admitted:false,reasons:[...new Set(reasons)],missingVariables:missing,subscriptionLogin:route?.eligibility?.subscriptionLogin??null,compatibilityPreflight:'not-run',providerCalls:0};
}
function routeEnvironment(route,env) {
  const result=baseEnvironment();
  for(const [target,source] of Object.entries(route.environment)) result[target]=env[source];
  if(route.provider.endpoint) result.ANTHROPIC_BASE_URL=route.provider.endpoint;
  return result;
}
function argumentsFor(c,route,{protocol='common',tools='off'}={}) {
  const args=['--mode','branch','--base',c.base,'--engine',route.engine,'--model',route.model,'--thinking',route.effort,'--max-priority','P2','--dataset','.orchestrator/review-dataset-'+c.datasetDigest.slice(0,8)+'.md','--stream-engine-output'];
  if(protocol==='common') {
    args.push('--no-web-search');
    if(tools==='off') args.push('--no-tools');
  }
  return args;
}
async function invoke(helper,args,cwd,env,timeoutSec) {
  return await new Promise(resolve=>{
    let output='',timedOut=false,overflow=false;
    const child=spawn(helper,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    const stop=()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
    const timer=setTimeout(()=>{timedOut=true;stop();},timeoutSec*1000);
    const collect=chunk=>{if(Buffer.byteLength(output)+chunk.length>8*1024*1024){overflow=true;stop();}else output+=chunk.toString();};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',()=>{clearTimeout(timer);resolve({exitCode:null,output:'helper launch failed',timedOut:false,overflow:false});});
    child.on('close',exitCode=>{clearTimeout(timer);resolve({exitCode,output,timedOut,overflow});});
  });
}
async function withCase(manifest,c,repo,fn) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mono-review-bench-'));
  try {
    const copy=path.join(temp,'repo'),helper=path.join(temp,'autoreview');
    need(hash(Buffer.from(c.dataset,'base64'))===c.datasetDigest,'frozen dataset mismatch');
    const helperBytes=Buffer.from(manifest.helpers[c.helperArchive].bytes,'base64');
    need(receiptDigest(helperBytes.toString('utf8'))===c.helperVersion&&hash(helperBytes)===c.evidenceDigests.helper&&hash(helperBytes)===manifest.helpers[c.helperArchive].byteDigest,'frozen helper mismatch');
    need(canonical(evidence(repo,c.base,c.head))===canonical({diff:c.evidenceDigests.diff,tree:c.evidenceDigests.tree}),'code evidence changed');
    fs.mkdirSync(copy);
    git(copy,'init','--quiet');
    git(copy,'-c','protocol.version=2','fetch','--quiet','--no-tags',path.resolve(repo),c.head,c.base);
    git(copy,'checkout','--quiet','--detach',c.head);
    need(canonical(evidence(copy,c.base,c.head))===canonical({diff:c.evidenceDigests.diff,tree:c.evidenceDigests.tree}),'copied code differs');
    fs.mkdirSync(path.join(copy,'.orchestrator'),{recursive:true});
    const dataset=path.join(copy,'.orchestrator','review-dataset-'+c.datasetDigest.slice(0,8)+'.md');
    fs.writeFileSync(dataset,Buffer.from(c.dataset,'base64'),{flag:'wx'});
    fs.writeFileSync(helper,helperBytes,{mode:0o700});
    return await fn({copy,helper,temp,dataset});
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
}
function compatible(result,c,route,{protocol='common',tools='off'}={}) {
  const lines=result.output.split(/\r?\n/);
  const production=protocol==='production';
  return result.exitCode===0&&!result.timedOut&&!result.overflow&&[
    'autoreview target: branch',`engine: ${route.engine}`,`model: ${route.model}`,`thinking: ${route.effort}`,
    `tools: ${production?'on':tools}`,`web_search: ${production?'on':'off'}`,'inputs: OK','bundle: constructible','prompt: OK'
  ].every(line=>lines.filter(l=>l===line).length===1)&&lines.some(l=>l.startsWith('engine check: ')&&l.endsWith(' OK'));
}
export async function admitRoutes({manifest,repo,routes,env=process.env}) {
  verifySeal(manifest); need(Array.isArray(routes)&&new Set(routes.map(r=>r.id)).size===routes.length,'duplicate or invalid routes');
  const tools=toolsProtocol(manifest.plan);
  const admissions=[];
  for(const route of routes) {
    const record=routeCheck(route,env,tools);
    if(!record.reasons.length) {
      if(!manifest.cases.length) record.reasons.push('no reproducible case for compatibility preflight');
      else {
        record.compatibilityPreflight='passed';
        for(const c of manifest.cases) {
          try {
            const settings={protocol:'common',tools};
            const result=await withCase(manifest,c,repo,async({copy,helper})=>invoke(helper,[...argumentsFor(c,route,settings),'--dry-run'],copy,routeEnvironment(route,env),60));
            if(!compatible(result,c,route,settings)) {record.compatibilityPreflight='failed';record.reasons.push('helper dry-run failed schema/model/effort/isolation/input checks');break;}
          } catch {record.compatibilityPreflight='failed';record.reasons.push('compatibility input unavailable');break;}
        }
      }
    }
    record.admitted=record.reasons.length===0; admissions.push(record);
  }
  return admissions;
}

function blindFinding(finding,routes) {
  const value={priority:finding.priority,title:finding.title??'',body:finding.body??'',code_location:finding.code_location??null};
  const identities=routes.flatMap(r=>[r.id,r.model,r.provider?.id,r.provider?.endpoint]).filter(v=>typeof v==='string'&&v.length).sort((a,b)=>b.length-a.length);
  const pattern=identities.length?new RegExp('\\[(?:route|REDACTED)\\]|(?<![\\p{L}\\p{N}_])(?:'+identities.map(identity=>identity.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?![\\p{L}\\p{N}_])','giu'):null;
  function hide(item) {
    if(typeof item==='string') return pattern?item.replace(pattern,match=>/^\[(?:route|REDACTED)\]$/i.test(match)?match:'[route]'):item;
    if(Array.isArray(item)) return item.map(hide);
    if(item&&typeof item==='object') return Object.fromEntries(Object.entries(item).map(([key,child])=>[key,hide(child)]));
    return item;
  }
  return {...value,title:hide(value.title),body:hide(value.body),code_location:hide(value.code_location)};
}
function selectedCases(manifest) { return manifest.cases.filter(c=>manifest.plan.cases.some(item=>item.id===c.id)); }
export async function runBench({manifest,repo,routes,evidenceRoot,runId,env=process.env}) {
  verifySeal(manifest);validatePlan(manifest.plan,manifest.cases);
  need(canonical(routes)===canonical(manifest.routes),'run differs from frozen routes');
  const dir=runDirectory(evidenceRoot,runId),stored=readJSON(path.join(dir,'manifest.json'));
  need(stored.digest===manifest.digest,'run manifest differs');
  need(!fs.existsSync(path.join(dir,'run.json'))&&!fs.existsSync(path.join(dir,'started.json')),'run already started; use a new run id');
  write(dir,'started.json',{manifestDigest:manifest.digest,startedAt:new Date().toISOString()});
  const admissions=await admitRoutes({manifest,repo,routes,env});
  const mapping=routes.map(r=>({anonymousId:crypto.randomUUID(),productionAnonymousId:crypto.randomUUID(),route:r}));
  const credentials=credentialValues(routes,env);
  write(dir,'routes.private.json',mapping,credentials);
  const samples=[],blind=[],cases=selectedCases(manifest);
  const commonTools=toolsProtocol(manifest.plan);
  let calls=0;
  for(const [index,mapped] of mapping.entries()) {
    if(!admissions[index].admitted) continue;
    for(const protocol of mapped.route.baseline?['common','production']:['common']) {
      for(const c of cases) for(let repeat=1;repeat<=manifest.plan.repeats;repeat++) {
        const sample={sampleId:crypto.randomUUID(),anonymousRoute:protocol==='production'?mapped.productionAnonymousId:mapped.anonymousId,caseId:c.id,repeat,protocol,status:'not-run',reason:null,elapsedMs:0,usage:null,usageReason:'not called',providerCalls:0,findings:[]};
        if(calls>=manifest.plan.maxCalls) sample.reason='predeclared call limit reached';
        else if(protocol==='production'&&canonical(c.productionRoute)!==canonical({engine:mapped.route.engine,model:mapped.route.model,effort:mapped.route.effort})) sample.reason='production route differs from archived route';
        else {
          const start=Date.now();
          try {
            await withCase(manifest,c,repo,async({copy,helper,temp,dataset})=>{
              const settings={protocol,tools:commonTools};
              const args=argumentsFor(c,mapped.route,settings),childEnv=routeEnvironment(mapped.route,env);
              // Repeat admission on these exact inputs/settings before the paid invocation.
              const preflight=await invoke(helper,[...args,'--dry-run'],copy,childEnv,60);
              if(!compatible(preflight,c,mapped.route,settings)) {sample.reason='exact-run compatibility preflight failed';return;}
              const output=path.join(temp,'report.json'),status=path.join(temp,'status.json');
              calls++;sample.providerCalls=1;
              const result=await invoke(helper,[...args,'--json-output',output,'--status-output',status],copy,childEnv,manifest.plan.timeoutSec);
              sample.exitCode=result.exitCode;
              sample.timedOut=result.timedOut;
              Object.assign(sample,parseReviewUsage(result.output,mapped.route.engine));
              let report=null,sidecar=null;
              try {report=readJSON(output);sidecar=readJSON(status);} catch {}
              const completed=sidecar?.schema_version===1&&sidecar.engine===mapped.route.engine&&sidecar.exit_code===result.exitCode&&sidecar.report_produced===true&&sidecar.timed_out===false&&
                ['scoped-clean','findings','filtered','incorrect','incomplete'].includes(sidecar.status)&&Array.isArray(report?.findings)&&report.findings.every(f=>['P0','P1','P2','P3',0,1,2,3].includes(f.priority));
              if(hash(regular(dataset))!==c.datasetDigest) {sample.status='failed';sample.reason='dataset changed';}
              else if(result.timedOut||sidecar?.timed_out) {sample.status='timeout';sample.reason='helper deadline';}
              else if(result.overflow) {sample.status='failed';sample.reason='output limit exceeded';}
              else if(!completed) {sample.status='failed';sample.reason='missing or invalid helper result';}
              else {sample.status=sidecar.status;sample.findings=report.findings.map(f=>blindFinding(redact(f,credentials),routes));}
              sample.helperStatus=sidecar?{status:sidecar.status,report_produced:sidecar.report_produced,reason:sidecar.reason}:null;
            });
          } catch {sample.status='failed';sample.reason='input preparation or helper failure';}
          sample.elapsedMs=Date.now()-start;
        }
        samples.push(redact(sample,credentials));
        blind.push({sampleId:sample.sampleId,anonymousRoute:sample.anonymousRoute,caseId:sample.caseId,repeat,status:sample.status,findings:sample.findings});
        // Durable progress keeps interrupted/failed runs in the operational denominator.
        write(dir,`sample-${sample.sampleId}.json`,samples.at(-1));
      }
    }
  }
  const run=seal({schemaVersion:1,manifestDigest:manifest.digest,admissions,samples,calls,endedAt:new Date().toISOString()});
  write(dir,'run.json',run,credentials);
  for(let i=blind.length-1;i>0;i--) {const j=crypto.randomInt(i+1);[blind[i],blind[j]]=[blind[j],blind[i]];}
  write(dir,'blind.json',{schemaVersion:1,manifestDigest:manifest.digest,samples:blind},credentials);
  return run;
}

export function scoreBench({manifest,run,adjudications}) {
  verifySeal(manifest);verifySeal(run);need(run.manifestDigest===manifest.digest,'scoring manifest mismatch');
  need(Array.isArray(adjudications?.entries),'adjudication entries required');
  const keys=new Set();
  for(const entry of adjudications.entries) {
    const sample=run.samples.find(s=>s.sampleId===entry.sampleId);
    need(sample&&Number.isSafeInteger(entry.findingIndex)&&sample.findings[entry.findingIndex],'unknown finding');
    const key=entry.sampleId+':'+entry.findingIndex;need(!keys.has(key),'duplicate adjudication');keys.add(key);
    need(['match','false-positive','novel','disputed','duplicate'].includes(entry.outcome),'unknown adjudication outcome');
    need(typeof entry.evidence==='string'&&entry.evidence.length>0&&Array.isArray(entry.reviewers)&&entry.reviewers.length>0,'adjudication evidence and grader required');
    if(entry.wasDisputed||entry.outcome==='disputed') need(new Set(entry.reviewers).size>=2,'disputed finding requires cross-check');
    if(entry.outcome==='false-positive') need(entry.novelTriage===true,'novel findings must be triaged before false-positive classification');
  }
  const scores=[];
  for(const sample of run.samples) {
    const gold=manifest.plan.cases.find(c=>c.id===sample.caseId).gold;
    const matched=new Set(),counts={truePositive:0,falsePositive:0,novel:0,disputed:0,unresolved:0,duplicates:0};
    sample.findings.forEach((finding,index)=>{
      const entry=adjudications.entries.find(e=>e.sampleId===sample.sampleId&&e.findingIndex===index);
      if(!entry) {counts.unresolved++;return;}
      if(entry.outcome==='match') {
        need(gold.some(g=>g.id===entry.goldId),'matched gold does not belong to case');
        if(matched.has(entry.goldId)) counts.duplicates++; else {matched.add(entry.goldId);counts.truePositive++;}
      } else if(entry.outcome==='false-positive') counts.falsePositive++;
      else if(entry.outcome==='duplicate') counts.duplicates++;
      else counts[entry.outcome]++;
    });
    scores.push({sampleId:sample.sampleId,...counts,recall:Object.fromEntries(['P0','P1','P2'].map(priority=>{
      const defects=gold.filter(g=>g.severity===priority);return [priority,{detected:defects.filter(g=>matched.has(g.id)).length,total:defects.length}];
    }))});
  }
  return seal({schemaVersion:1,manifestDigest:manifest.digest,runDigest:run.digest,adjudicationsDigest:hash(canonical(adjudications)),scores});
}
export function reportBench({manifest,run,score}) {
  verifySeal(manifest);verifySeal(run);verifySeal(score);
  need(score.runDigest===run.digest&&score.manifestDigest===manifest.digest&&run.manifestDigest===manifest.digest,'report inputs mismatch');
  const selected=manifest.plan.cases,lookup=new Map(manifest.cases.map(c=>[c.id,c]));
  const coverage={families:new Set(selected.map(c=>lookup.get(c.id).cluster)).size,clean:selected.filter(c=>c.kind==='clean').length,pairs:new Set(selected.filter(c=>c.kind==='defect').map(c=>c.pair)).size,
    heldoutFamilies:new Set(selected.filter(c=>c.partition==='heldout').map(c=>lookup.get(c.id).cluster)).size,
    ...Object.fromEntries(['P0','P1','P2'].map(p=>[p,selected.flatMap(c=>c.gold).filter(g=>g.severity===p).length]))};
  const gaps=Object.entries(manifest.plan.minimums).filter(([key,min])=>(coverage[key]??0)<min).map(([key,min])=>({criterion:key,required:min,actual:coverage[key]??0}));
  const summaries=[];
  for(const anonymousRoute of new Set(run.samples.map(s=>s.anonymousRoute))) for(const protocol of ['common','production']) for(const partition of ['development','heldout']) {
    const samples=run.samples.filter(s=>s.anonymousRoute===anonymousRoute&&s.protocol===protocol&&selected.find(c=>c.id===s.caseId).partition===partition);
    if(!samples.length) continue;
    const scores=samples.map(s=>score.scores.find(x=>x.sampleId===s.sampleId));
    const sum=field=>scores.reduce((n,s)=>n+s[field],0);
    const completed=samples.filter(s=>['scoped-clean','findings','filtered','incorrect'].includes(s.status));
    const pairs=selected.filter(c=>c.kind==='defect'&&c.partition===partition).flatMap(defect=>{
      const fix=selected.find(c=>c.kind==='fix'&&c.pair===defect.pair);
      return Array.from({length:manifest.plan.repeats},(_,index)=>{
        const repeat=index+1,defectSample=samples.find(s=>s.caseId===defect.id&&s.repeat===repeat),fixSample=samples.find(s=>s.caseId===fix.id&&s.repeat===repeat);
        const defectScore=scores.find(s=>s.sampleId===defectSample?.sampleId),fixScore=scores.find(s=>s.sampleId===fixSample?.sampleId);
        const evaluated=completed.includes(defectSample)&&completed.includes(fixSample)&&[defectScore,fixScore].every(s=>s&&s.unresolved+s.novel+s.disputed===0);
        return {pairId:defect.pair,repeat,defectSampleId:defectSample?.sampleId??null,fixSampleId:fixSample?.sampleId??null,status:evaluated?'evaluated':'unresolved',
          missedDefects:evaluated?Object.values(defectScore.recall).reduce((n,r)=>n+r.total-r.detected,0):null,falseAlarmsOnFix:evaluated?fixScore.falsePositive:null};
      });
    });
    summaries.push({anonymousRoute,protocol,partition,planned:samples.length,called:samples.reduce((n,s)=>n+s.providerCalls,0),completed:completed.length,
      failures:samples.filter(s=>s.status==='failed').length,timeouts:samples.filter(s=>s.status==='timeout').length,notRun:samples.filter(s=>s.status==='not-run').length,
      unresolvedOutcomes:samples.length-completed.length+sum('unresolved')+sum('novel')+sum('disputed'),
      recall:Object.fromEntries(['P0','P1','P2'].map(p=>{const detected=scores.reduce((n,s)=>n+s.recall[p].detected,0),total=scores.reduce((n,s)=>n+s.recall[p].total,0);return [p,{detected,total,rate:total?detected/total:null}];})),
      precision:{truePositive:sum('truePositive'),falsePositive:sum('falsePositive'),rate:sum('truePositive')+sum('falsePositive')?sum('truePositive')/(sum('truePositive')+sum('falsePositive')):null},
      regressions:{falseAlarmsOnFix:samples.filter(s=>selected.find(c=>c.id===s.caseId).kind==='fix').reduce((n,s)=>n+score.scores.find(x=>x.sampleId===s.sampleId).falsePositive,0),novelFindings:sum('novel'),pairedMisses:pairs.filter(p=>p.status==='evaluated'&&p.missedDefects>0).length,pairedRegressions:pairs.filter(p=>p.status==='evaluated'&&p.falseAlarmsOnFix>0).length,pairedPlanned:pairs.length,pairedEvaluated:pairs.filter(p=>p.status==='evaluated').length,pairedUnresolved:pairs.filter(p=>p.status==='unresolved').length,pairs},
      elapsedMs:samples.reduce((n,s)=>n+s.elapsedMs,0),usage:{measured:samples.filter(s=>s.usage).length,denominator:samples.reduce((n,s)=>n+s.providerCalls,0),samples:samples.map(s=>({sampleId:s.sampleId,usage:s.usage,reason:s.usageReason}))}});
  }
  const protocolGroups={common:summaries.filter(summary=>summary.protocol==='common'),production:summaries.filter(summary=>summary.protocol==='production')};
  return {schemaVersion:1,manifestDigest:manifest.digest,runDigest:run.digest,coverage,gaps,
    casesByRisk: Object.fromEntries([...new Set(selected.map(c=>lookup.get(c.id).risk))].map(risk=>[risk,selected.filter(c=>lookup.get(c.id).risk===risk).map(c=>({caseId:c.id,cluster:lookup.get(c.id).cluster,kind:c.kind,partition:c.partition}))])),excludedCases:manifest.excluded,excludedRoutes:run.admissions.filter(a=>!a.admitted),summaries,
    admissions:run.admissions,protocolGroups,
    harnessDifferences:{common:{...manifest.toolSettings,limits:'Claude disables WebSearch and WebFetch; Codex cache search cannot be disabled.'},production:{webSearch:true,tools:true},comparison:'Report production separately; changes may be caused by tools, engine, provider or model. No attribution to model alone.'},
    outcome:gaps.length?'feasibility-only':'keep-incumbent',qualityRecommendation:null,
    interpretation:'Small samples can reject a candidate, not establish equivalence. Keep the incumbent until a separate recorded decision; unknown and failed outcomes never certify quality.'};
}

function summary(manifest) {
  return {digest:manifest.digest,tools:toolsProtocol(manifest.plan),cases:manifest.cases.map(({id,cluster,head,base,datasetVersion,helperVersion})=>({id,cluster,head,base,datasetVersion,helperVersion})),clusters:manifest.clusters,excluded:manifest.excluded,feasibility:manifest.feasibility};
}
let cliCredentials=credentialValues(defaultRoutes);
async function main(argv) {
  const command=argv.shift(),options={};
  for(let i=0;i<argv.length;i++) {
    const arg=argv[i];need(['--evidence-root','--repo','--root','--run-id','--manifest','--routes','--plan','--helper','--adjudications','--dry-run','--help'].includes(arg),'unknown argument');
    options[arg.slice(2)]=['--dry-run','--help'].includes(arg)?true:argv[++i];
  }
  if(command==='--help'||options.help) { console.log('review-bench.mjs manifest|run|score|report --evidence-root DIR --repo DIR [--root ORCHESTRATOR_DIR] [--run-id ID] [--manifest FILE] [--routes FILE.json|FILE.mjs] [--plan FILE] [--helper FILE] [--adjudications FILE] [--dry-run]\nmanifest --dry-run inventories only; run --dry-run performs offline helper admission only. Non-dry commands write exclusively under evidence-root/bench/run-id. A new run id is required after interruption.');return; }
  const evidenceRoot=options['evidence-root'],repo=options.repo??process.cwd(),runId=options['run-id'];
  const loadManifest=()=>options.manifest?readJSON(options.manifest):readJSON(path.join(runDirectory(evidenceRoot,runId),'manifest.json'));
  if(command==='manifest') {
    const routes=options.routes?(options.routes.endsWith('.mjs')?(await import(pathToFileURL(path.resolve(options.routes)))).default:readJSON(options.routes)):defaultRoutes;
    cliCredentials=credentialValues(routes);
    const args={evidenceRoot,repo,runId,orchestratorRoot:options.root,helper:options.helper,plan:options.plan?readJSON(options.plan):null,routes};
    console.log(JSON.stringify(summary(options['dry-run']?buildManifest(args):freezeManifest(args)),null,2));return;
  }
  if(command==='run') {
    const frozen=Boolean(options.manifest||runId);
    need(!(frozen&&options.plan),'frozen manifest supplies the plan; --plan cannot override it');
    need(options['dry-run']||frozen,'a frozen manifest and run id are required for a live run');
    const requestedRoutes=options.routes?(options.routes.endsWith('.mjs')?(await import(pathToFileURL(path.resolve(options.routes)))).default:readJSON(options.routes)):null;
    const manifest=frozen?loadManifest():buildManifest({evidenceRoot,repo,orchestratorRoot:options.root,helper:options.helper,plan:options.plan?readJSON(options.plan):null,routes:requestedRoutes??defaultRoutes});
    const routes=requestedRoutes??manifest.routes;
    if(frozen) need(canonical(routes)===canonical(manifest.routes),'run differs from frozen routes');
    cliCredentials=credentialValues(routes);
    if(options['dry-run']) console.log(JSON.stringify({manifest:summary(manifest),admissions:await admitRoutes({manifest,repo,routes}),providerCalls:0},null,2));
    else {const run=await runBench({manifest,repo,routes,evidenceRoot,runId});console.log(JSON.stringify({calls:run.calls,samples:run.samples.length,admissions:run.admissions},null,2));}return;
  }
  need(!options['dry-run'],'dry-run supported only for manifest and run');
  const dir=runDirectory(evidenceRoot,runId),manifest=loadManifest(),run=readJSON(path.join(dir,'run.json'));
  cliCredentials=credentialValues(manifest.routes);
  if(command==='score') {const score=scoreBench({manifest,run,adjudications:readJSON(options.adjudications)});write(dir,'score.json',score,cliCredentials);console.log('Blind scoring saved.');return;}
  if(command==='report') {const report=reportBench({manifest,run,score:readJSON(path.join(dir,'score.json'))});write(dir,'report.json',report,cliCredentials);console.log(JSON.stringify(redact(report,cliCredentials),null,2));return;}
  throw new Error('unknown command');
}
if(isMain(import.meta.url)) main(process.argv.slice(2)).catch(error=>{console.error('review-bench: '+redact(error.message,cliCredentials));process.exitCode=1;});
