import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildManifest } from './review-bench.mjs';
import { digest as receiptDigest } from './runtime.mjs';
import configuredRoutes from './review-bench-routes.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-bench-test-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const repo = path.join(root,'repo'), evidenceRoot = path.join(root,'evidence');
  fs.mkdirSync(repo); fs.mkdirSync(path.join(evidenceRoot,'history'),{recursive:true});
  fs.mkdirSync(path.join(evidenceRoot,'datasets'));
  const git = (...args) => execFileSync('git',args,{cwd:repo,encoding:'utf8',env:{PATH:process.env.PATH,HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
  git('init','-q'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.test');
  fs.writeFileSync(path.join(repo,'code.txt'),'before\n'); git('add','.'); git('commit','-qm','base'); const base=git('rev-parse','HEAD');
  fs.writeFileSync(path.join(repo,'code.txt'),'after\n'); git('commit','-qam','head'); const head=git('rev-parse','HEAD');
  const helper=path.join(root,'helper'); fs.writeFileSync(helper,'#!/usr/bin/env node\n');
  const dataset=path.join(evidenceRoot,'datasets','TEST-1-review-scope.v1.md'); fs.writeFileSync(dataset,'Task context before review.\n');
  fs.writeFileSync(dataset+'.sha256',sha(fs.readFileSync(dataset))+'\n');
  const receipt={runId:'first',head,base,risk:'risky',helper,helperDigest:receiptDigest(fs.readFileSync(helper,'utf8')),route:{model:'model-incumbent',effort:'high'},reviewDataset:{archive:dataset,version:1,digest:sha(fs.readFileSync(dataset))}};
  const save=(name,r)=>fs.writeFileSync(path.join(evidenceRoot,'history',name+'.json'),JSON.stringify({receipt:r}));
  save('first',receipt); fs.writeFileSync(path.join(evidenceRoot,head+'.json'),JSON.stringify({receipt}));
  return {root,repo,evidenceRoot,helper,receipt,save,git};
}

test('freeze recoverable inputs, deduplicate receipt/history, explain exclusions', t => {
  const f=fixture(t); f.save('missing',{...f.receipt,runId:'missing',reviewDataset:null});
  const before=fs.readFileSync(path.join(f.evidenceRoot,f.receipt.head+'.json'));
  const m=buildManifest(f);
  assert.equal(m.cases.length,1); assert.equal(m.excluded.length,1);
  assert.match(m.excluded[0].reason,/dataset/);
  assert.equal(m.cases[0].cluster,'TEST-1');
  assert.equal(m.cases[0].datasetDigest,f.receipt.reviewDataset.digest);
  assert.equal(m.cases[0].head,f.receipt.head);
  assert.equal(m.cases[0].helperVersion,f.receipt.helperDigest);
  assert.equal(m.cases[0].evidenceDigests.helper,sha(fs.readFileSync(f.helper)));
  assert.notEqual(m.cases[0].helperVersion,m.cases[0].evidenceDigests.helper);
  assert.equal(m.toolSettings.tools,false); assert.equal(m.toolSettings.webSearch,false);
  assert.deepEqual(buildManifest(f),m);
  assert.deepEqual(fs.readFileSync(path.join(f.evidenceRoot,f.receipt.head+'.json')),before);
});

test('configured routes contain only subscription logins for the approved Claude and Codex selectors',()=>{
  assert.deepEqual(configuredRoutes.map(route=>route.id),['incumbent','sonnet-high','sol-high','sol-medium','astra-high','terra-high']);
  assert.deepEqual(configuredRoutes.map(route=>[route.engine,route.effort]),[
    ['claude','high'],['claude','high'],['codex','high'],['codex','medium'],['codex','high'],['codex','high'],
  ]);
  assert.equal(configuredRoutes.filter(route=>route.baseline).map(route=>route.id).join(','),'incumbent');
  for(const route of configuredRoutes) {
    assert.deepEqual(route.credentialEnv,[]);
    assert.deepEqual(route.environment,{});
    assert.equal('toVerify' in route.eligibility,false);
    assert.deepEqual(route.eligibility.subscriptionLogin.cli,route.engine);
    assert.equal(route.eligibility.subscriptionLogin.statusCommand,route.engine==='claude'?'claude auth status':'codex login status');
  }
});

import { freezeManifest, admitRoutes, runBench, scoreBench, reportBench } from './review-bench.mjs';
function fake(t,observation='Needs triage') {
  const f=fixture(t),log=path.join(f.root,'calls.jsonl');
  fs.writeFileSync(f.helper,`#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1],dry=args.includes('--dry-run');
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({dry,args,ambientLeaked:!!process.env.UNRELATED_SECRET})+'\\n');
if(process.env.UNRELATED_SECRET) process.exit(9);
for(const line of ['autoreview target: branch','engine: '+get('--engine'),'model: '+get('--model'),'thinking: '+get('--thinking'),'tools: '+(args.includes('--no-tools')?'off':'on'),'web_search: '+(args.includes('--no-web-search')?'off':'on'),'inputs: OK','bundle: constructible','prompt: OK','engine check: fixture OK']) console.log(line);
if(dry) process.exit(0);
console.log(process.env.ANTHROPIC_AUTH_TOKEN);
console.log('claude usage: input_tokens=10 cache_read_input_tokens=2 cache_creation_input_tokens=0 output_tokens=5');
const findings=fs.readFileSync('code.txt','utf8')==='after\\n'?[{priority:1,title:'Known defect',body:'Found by '+get('--model')+' '+process.env.ANTHROPIC_AUTH_TOKEN},{priority:2,title:'New observation',body:${JSON.stringify(observation)}}]:[];
const status=findings.length?'findings':'scoped-clean',exit=findings.length?1:0;
fs.writeFileSync(get('--json-output'),JSON.stringify({findings,overall_correctness:findings.length?'patch is incorrect':'patch is correct'}));
fs.writeFileSync(get('--status-output'),JSON.stringify({schema_version:1,engine:get('--engine'),status,exit_code:exit,report_produced:true,timed_out:false,reason:null}));
process.exit(exit);
`);
  f.receipt.helperDigest=receiptDigest(fs.readFileSync(f.helper,'utf8'));f.save('first',f.receipt);fs.writeFileSync(path.join(f.evidenceRoot,f.receipt.head+'.json'),JSON.stringify({receipt:f.receipt}));
  fs.writeFileSync(path.join(f.repo,'code.txt'),'fixed\n');f.git('commit','-qam','fix');
  f.save('fix',{...f.receipt,runId:'fix',head:f.git('rev-parse','HEAD')});
  const inventory=buildManifest(f);
  const plan={repeats:1,maxCalls:20,timeoutSec:2,stopRule:'No retry; stop at call or per-call time limit.',minimums:{families:2,clean:1,pairs:1,heldoutFamilies:1,P0:1,P1:1,P2:1},cases:inventory.cases.map(c=>({id:c.id,partition:'development',kind:c.head===f.receipt.head?'defect':'fix',pair:'pair-1',gold:c.head===f.receipt.head?[{id:'g1',severity:'P1',evidence:'Known defective change'}]:[]}))};
  const good={id:'route-alpha',engine:'claude',model:'model-alpha',effort:'high',provider:{id:'provider-alpha',endpoint:'https://provider.example/anthropic'},credentialEnv:['BENCH_CREDENTIAL'],environment:{ANTHROPIC_AUTH_TOKEN:'BENCH_CREDENTIAL'},eligibility:{billingChannelAllowed:true,source:'fixture billing permission'}};
  const secret=crypto.randomBytes(24).toString('hex');
  return {...f,log,plan,good,routes:[good],env:{BENCH_CREDENTIAL:secret,UNRELATED_SECRET:'ambient-must-not-reach-helper'},secret};
}
const subscriptionLogin = cli => ({cli,statusCommand:`${cli} login status`,checkedAt:'2026-09-24T00:23:45Z',by:'fixture-orchestrator'});
function subscriptionRoute(id,engine='claude') {
  return {id,engine,model:engine==='codex'?'model-codex':'model-claude',effort:'high',provider:{id:engine==='codex'?'openai':'anthropic'},credentialEnv:[],environment:{},eligibility:{billingChannelAllowed:true,source:'fixture subscription login',subscriptionLogin:subscriptionLogin(engine)}};
}
function treeBytes(root) {
  let result='';for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const p=path.join(root,entry.name);if(entry.isDirectory()&&entry.name!=='.git')result+=treeBytes(p);else if(entry.isFile())result+=fs.readFileSync(p).toString();
  }return result;
}

test('admission rejects forbidden billing, missing keys and tools-on controls with zero helper calls',async t=>{
  const f=fake(t),manifest=buildManifest(f);
  const routes=[{...f.good,id:'billing',eligibility:{billingChannelAllowed:false,source:'not allowed'}},{...f.good,id:'missing',credentialEnv:['MISSING_KEY'],environment:{ANTHROPIC_AUTH_TOKEN:'MISSING_KEY'}},{...f.good,id:'codex',engine:'codex'}];
  const a=await admitRoutes({manifest,repo:f.repo,routes,env:f.env});
  assert.ok(a.every(a=>!a.admitted&&a.providerCalls===0));assert.deepEqual(a[1].missingVariables,['MISSING_KEY']);
  assert.equal(fs.existsSync(f.log),false);
});

test('subscription admission follows the plan tools protocol and preserves login evidence',async t=>{
  const f=fake(t),claude=subscriptionRoute('claude-subscription'),codex=subscriptionRoute('codex-subscription','codex');
  const missingEvidence={...claude,id:'missing-evidence',eligibility:{billingChannelAllowed:true,source:'fixture subscription login'}};
  const mismatchedClaude={...claude,id:'mismatched-claude',eligibility:{...claude.eligibility,subscriptionLogin:subscriptionLogin('codex')}};
  const mismatchedCodex={...codex,id:'mismatched-codex',eligibility:{...codex.eligibility,subscriptionLogin:subscriptionLogin('claude')}};
  const missingKey={...f.good,id:'missing-key',credentialEnv:['MISSING_KEY'],environment:{ANTHROPIC_AUTH_TOKEN:'MISSING_KEY'}};
  const pi={id:'pi-subscription',engine:'pi',model:'model-pi',effort:'high',provider:{id:'openai'},credentialEnv:[],environment:{},eligibility:{billingChannelAllowed:true,source:'fixture Pi subscription login',subscriptionLogin:subscriptionLogin('codex')}};
  const onManifest=buildManifest({...f,plan:{...f.plan,tools:'on'}});
  const on=await admitRoutes({manifest:onManifest,repo:f.repo,routes:[claude,codex,missingEvidence,mismatchedClaude,mismatchedCodex,missingKey,pi],env:f.env});
  assert.equal(on[0].admitted,true);
  assert.deepEqual(on[0].subscriptionLogin,claude.eligibility.subscriptionLogin);
  assert.equal(on[1].admitted,true);
  assert.deepEqual(on[1].subscriptionLogin,codex.eligibility.subscriptionLogin);
  assert.ok(on[2].reasons.includes('subscription login evidence required'));
  assert.ok(on[3].reasons.includes('subscription login evidence required'));
  assert.ok(on[4].reasons.includes('subscription login evidence required'));
  assert.deepEqual(on[5].missingVariables,['MISSING_KEY']);
  assert.ok(on[6].reasons.includes('helper forces tools off for pi'));
  const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);
  const codexCalls=calls.filter(call=>call.args.includes('model-codex'));
  assert.ok(codexCalls.length>0);
  assert.ok(codexCalls.every(call=>call.args.includes('--no-web-search')&&!call.args.includes('--no-tools')&&!call.args.includes('--codex-config')));

  const offManifest=buildManifest({...f,plan:{...f.plan,tools:'off'}});
  const off=await admitRoutes({manifest:offManifest,repo:f.repo,routes:[codex,pi],env:f.env});
  assert.equal(off[0].admitted,false);
  assert.ok(off[0].reasons.includes('helper rejects tools-off for Codex'));
  assert.equal(off[1].admitted,true);
});

test('run dry-run reads an unfrozen plan and rejects a plan override for a frozen manifest',t=>{
  const f=fake(t),route=subscriptionRoute('codex-subscription','codex');
  const planFile=path.join(f.root,'tools-on-plan.json'),routesFile=path.join(f.root,'routes.json');
  fs.writeFileSync(planFile,JSON.stringify({...f.plan,tools:'on'}));
  fs.writeFileSync(routesFile,JSON.stringify([route]));
  const script=new URL('./review-bench.mjs',import.meta.url).pathname;
  const dry=spawnSync(process.execPath,[script,'run','--dry-run','--evidence-root',f.evidenceRoot,'--repo',f.repo,'--plan',planFile,'--routes',routesFile],{encoding:'utf8'});
  assert.equal(dry.status,0,dry.stderr);
  const result=JSON.parse(dry.stdout);
  assert.equal(result.manifest.tools,'on');
  assert.equal(result.admissions[0].admitted,true);
  assert.equal(result.providerCalls,0);

  freezeManifest({...f,runId:'frozen-plan',plan:{...f.plan,tools:'off'},routes:[route]});
  const override=spawnSync(process.execPath,[script,'run','--dry-run','--evidence-root',f.evidenceRoot,'--repo',f.repo,'--run-id','frozen-plan','--plan',planFile,'--routes',routesFile],{encoding:'utf8'});
  assert.notEqual(override.status,0);
  assert.match(override.stderr,/frozen manifest supplies the plan; --plan cannot override it/);
});

test('frozen run, blind gold scoring and feasibility report preserve archives and redact keys',async t=>{
  const f=fake(t),archiveBefore=treeBytes(f.evidenceRoot);
  const manifest=freezeManifest({...f,runId:'run-1',plan:null}); // inventory cannot run without a declared sample
  await assert.rejects(runBench({...f,manifest,routes:[f.good],runId:'run-1'}),/sample/);
  const frozen=freezeManifest({...f,runId:'run-2',plan:f.plan});
  const run=await runBench({...f,manifest:frozen,routes:[f.good],runId:'run-2'});
  assert.equal(run.calls,2);assert.equal(run.samples.filter(s=>s.status==='findings').length,1);
  const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(c=>!c.dry).length,2);assert.ok(calls.every(c=>!c.ambientLeaked&&c.args.includes('--no-web-search')&&c.args.includes('--no-tools')));
  const dir=path.join(f.evidenceRoot,'bench','run-2'),blind=fs.readFileSync(path.join(dir,'blind.json'),'utf8');
  for(const identity of [f.good.id,f.good.model,f.good.provider.id,f.secret,'production','engine'])assert.equal(blind.includes(identity),false,identity);
  assert.equal(treeBytes(f.root).includes(f.secret),false);
  const sample=run.samples.find(s=>s.findings.length);
  const adjudications={entries:[{sampleId:sample.sampleId,findingIndex:0,outcome:'match',goldId:'g1',reviewers:['grader-a'],evidence:'matches the defect trigger'},{sampleId:sample.sampleId,findingIndex:1,outcome:'false-positive',novelTriage:true,wasDisputed:true,reviewers:['grader-a','grader-b'],evidence:'cross-checked source behavior'}]};
  const score=scoreBench({manifest:frozen,run,adjudications}),report=reportBench({manifest:frozen,run,score});
  assert.equal(report.outcome,'feasibility-only');assert.equal(report.qualityRecommendation,null);
  assert.deepEqual(report.summaries[0].recall.P1,{detected:1,total:1,rate:1});
  assert.equal(report.summaries[0].precision.rate,0.5);
  assert.equal(report.summaries[0].usage.denominator,2);
  assert.equal(report.summaries[0].usage.measured,2);
  fs.rmSync(path.join(f.evidenceRoot,'bench'),{recursive:true});assert.equal(treeBytes(f.evidenceRoot),archiveBefore);
});

test('new findings remain unresolved until triage; disputed false positives need another grader',async t=>{
  const f=fake(t),manifest=freezeManifest({...f,runId:'score',plan:f.plan}),run=await runBench({...f,manifest,runId:'score',routes:[f.good]});
  const sample=run.samples.find(s=>s.findings.length),entry={sampleId:sample.sampleId,findingIndex:0,outcome:'false-positive',reviewers:['grader'],evidence:'claim'};
  assert.throws(()=>scoreBench({manifest,run,adjudications:{entries:[entry]}}),/triaged/);
  assert.throws(()=>scoreBench({manifest,run,adjudications:{entries:[{...entry,novelTriage:true,wasDisputed:true}]}}),/cross-check/);
  const score=scoreBench({manifest,run,adjudications:{entries:[]}});
  assert.equal(score.scores.reduce((n,s)=>n+s.unresolved,0),2);
});

test('frozen bytes and cluster partitions reject drift; writes refuse aliases and reused run ids',t=>{
  const f=fake(t);
  const invalid=structuredClone(f.plan);invalid.cases[1].partition='heldout';
  assert.throws(()=>buildManifest({...f,plan:invalid}),/cluster/);
  assert.throws(()=>freezeManifest({...f,runId:'../history'}),/run id/);
  freezeManifest({...f,runId:'once'});
  assert.throws(()=>freezeManifest({...f,runId:'once'}),/exist/);
  fs.symlinkSync(path.join(f.evidenceRoot,'history'),path.join(f.evidenceRoot,'bench','alias'));
  assert.throws(()=>freezeManifest({...f,runId:'alias'}),/exist/);
  fs.appendFileSync(f.helper,'// changed\n');
  const drift=buildManifest({...f,plan:null});assert.equal(drift.cases.length,0);assert.ok(drift.excluded.every(e=>/helper version/.test(e.reason)));
});

test('a successful exit without compatibility checks excludes the route without paid calls',async t=>{
  const f=fake(t);
  fs.writeFileSync(f.helper,'#!/usr/bin/env node\nconsole.log("not a validated preflight");\n');
  const changed={...f.receipt,helperDigest:receiptDigest(fs.readFileSync(f.helper,'utf8'))};f.save('first',changed);f.save('fix',{...changed,runId:'fix'});
  fs.writeFileSync(path.join(f.evidenceRoot,f.receipt.head+'.json'),JSON.stringify({receipt:changed}));
  const manifest=buildManifest({...f,plan:null}),admissions=await admitRoutes({...f,manifest,routes:[f.good]});
  assert.equal(admissions[0].admitted,false);assert.equal(admissions[0].compatibilityPreflight,'failed');assert.equal(admissions[0].providerCalls,0);
});

test('timeouts and predeclared call stops remain in recall and operational denominators',async t=>{
  const f=fake(t);
  const original=fs.readFileSync(f.helper,'utf8');fs.writeFileSync(f.helper,original.replace("if(dry) process.exit(0);","if(dry) process.exit(0);\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000);"));
  const helperDigest=receiptDigest(fs.readFileSync(f.helper,'utf8'));
  for(const file of [path.join(f.evidenceRoot,f.receipt.head+'.json'),...fs.readdirSync(path.join(f.evidenceRoot,'history')).map(n=>path.join(f.evidenceRoot,'history',n))]) {
    const envelope=JSON.parse(fs.readFileSync(file));envelope.receipt.helperDigest=helperDigest;fs.writeFileSync(file,JSON.stringify(envelope));
  }
  const manifest=freezeManifest({...f,runId:'timeout',plan:{...f.plan,timeoutSec:0.1,maxCalls:1}}),run=await runBench({...f,manifest,runId:'timeout',routes:[f.good]});
  assert.equal(run.calls,1);assert.equal(run.samples.filter(s=>s.status==='timeout').length,1);assert.equal(run.samples.filter(s=>s.status==='not-run').length,1);
  const score=scoreBench({manifest,run,adjudications:{entries:[]}}),report=reportBench({manifest,run,score});
  assert.equal(report.summaries[0].planned,2);assert.equal(report.summaries[0].completed,0);assert.equal(report.summaries[0].recall.P1.total,1);assert.equal(report.summaries[0].recall.P1.detected,0);
});

test('production baseline is separate and its identity and tools are not disclosed to the grader',async t=>{
  const f=fake(t),baseline={...subscriptionRoute('incumbent'),model:'model-incumbent',baseline:true};
  const manifest=freezeManifest({...f,runId:'baseline',routes:[baseline]}),run=await runBench({...f,manifest,runId:'baseline',routes:[baseline]});
  assert.equal(run.calls,4);
  const common=run.samples.find(s=>s.protocol==='common'),production=run.samples.find(s=>s.protocol==='production');
  assert.notEqual(common.anonymousRoute,production.anonymousRoute);
  const blind=JSON.parse(fs.readFileSync(path.join(f.evidenceRoot,'bench','baseline','blind.json')));
  assert.ok(blind.samples.every(s=>!('protocol' in s)));
  const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).filter(c=>!c.dry);
  assert.equal(calls.filter(c=>c.args.includes('--no-tools')).length,2);assert.equal(calls.filter(c=>!c.args.includes('--no-web-search')).length,2);
  const score=scoreBench({manifest,run,adjudications:{entries:[]}}),report=reportBench({manifest,run,score});
  assert.deepEqual(Object.keys(report.protocolGroups),['common','production']);
  assert.equal(report.protocolGroups.common.length,1);
  assert.equal(report.protocolGroups.production.length,1);
  assert.ok(report.protocolGroups.common.every(group=>group.protocol==='common'));
  assert.ok(report.protocolGroups.production.every(group=>group.protocol==='production'));
  const grouped=[...report.protocolGroups.common,...report.protocolGroups.production];
  assert.equal(grouped.length,report.summaries.length);
  assert.equal(new Set(grouped).size,grouped.length);
  assert.deepEqual(report.admissions[0].subscriptionLogin,baseline.eligibility.subscriptionLogin);
});

test('route identities are frozen before calls and incompatible credential targets get zero invocations',async t=>{
  const f=fake(t),manifest=freezeManifest({...f,runId:'route-freeze',routes:[f.good]});
  assert.deepEqual(manifest.routes,[f.good]);
  await assert.rejects(runBench({...f,manifest,runId:'route-freeze',routes:[{...f.good,model:'different-model'}]}),/frozen routes/);
  const bad={...f.good,environment:{XAI_API_KEY:'BENCH_CREDENTIAL'}};
  const admissions=await admitRoutes({...f,manifest,routes:[bad]});
  assert.equal(admissions[0].admitted,false);assert.equal(fs.existsSync(f.log),false);
});

test('declared numeric credentials redact strings while preserving numeric fields',async t=>{
  const f=fake(t),numeric=crypto.randomInt(100_000_000,1_000_000_000);
  f.env.BENCH_CREDENTIAL=String(numeric);
  f.plan.maxCalls=numeric;
  const manifest=freezeManifest({...f,runId:'numeric-setting'});
  const dir=path.join(f.evidenceRoot,'bench','numeric-setting');
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
  assert.ok(saved.plan.maxCalls===numeric,'numeric call budget must remain a number');
  assert.equal(manifest.cases.length,2);
  const run=await runBench({...f,manifest,runId:'numeric-setting',routes:[f.good]});
  assert.equal(run.calls,2);
  const persisted=JSON.parse(fs.readFileSync(path.join(dir,'run.json')));
  assert.equal(persisted.samples.find(s=>s.status==='findings').findings[0].body,'Found by [route] [REDACTED]');
  function checkStrings(value) {
    if(typeof value==='string') assert.ok(!value.includes(f.env.BENCH_CREDENTIAL),'declared credential must be redacted from strings');
    else if(value&&typeof value==='object') for(const [key,item] of Object.entries(value)) {checkStrings(key);checkStrings(item);}
  }
  checkStrings(saved);checkStrings(persisted);
});

test('partitioning budgets come from each frozen helper declaration or remain unknown',t=>{
  const f=fixture(t);
  const declarations=['MAX_REVIEW_PROMPT_BYTES = 128_000','MAX_REVIEW_PROMPT_BYTES = 256_000','# no budget declaration','MAX_REVIEW_PROMPT_BYTES = choose_budget()'];
  declarations.forEach((declaration,index)=>{
    const helper=path.join(f.root,'archived-helper-'+index);
    fs.writeFileSync(helper,'#!/usr/bin/env python3\n'+declaration+'\n');
    f.save('helper-'+index,{...f.receipt,runId:'helper-'+index,helperArchive:helper,helperDigest:receiptDigest(fs.readFileSync(helper,'utf8'))});
  });
  const manifest=buildManifest(f);
  for(const [index,expected] of [128000,256000,'unknown','unknown'].entries()) {
    const c=manifest.cases.find(c=>c.source==='history/helper-'+index+'.json');
    assert.equal(c.partitioning.maxPromptBytes,expected);
    if(expected==='unknown') assert.match(c.partitioning.reason,/declaration/);
    else assert.equal(c.partitioning.reason,null);
  }
});

test('excluded malformed routes and short identities cannot discard completed findings',async t=>{
  for(const variant of ['missing-provider','missing-id','n','u','valid','duplicate']) await t.test(variant,async t=>{
    const f=fake(t);
    const routes=variant==='duplicate'?[f.good,{...f.good}]:variant==='valid'?[f.good]:variant==='missing-id'?[f.good,{...f.good,id:undefined}]:variant==='missing-provider'?[f.good,{...f.good,id:'excluded',provider:undefined}]:[{...f.good,id:variant}];
    const manifest=freezeManifest({...f,routes,runId:variant});
    if(variant==='duplicate') {
      await assert.rejects(runBench({...f,manifest,routes,runId:variant}),/duplicate/);
      assert.equal(fs.existsSync(f.log),false);return;
    }
    const run=await runBench({...f,manifest,routes,runId:variant});
    assert.equal(run.calls,2);
    assert.equal(run.samples.filter(s=>s.status==='findings').length,1);
    assert.equal(run.samples.filter(s=>s.status==='scoped-clean').length,1);
    const findings=run.samples.find(s=>s.status==='findings').findings;
    assert.deepEqual(findings.map(f=>f.priority),[1,2]);
    assert.deepEqual(Object.keys(findings[0]),['priority','title','body','code_location']);
    assert.equal(findings[0].body.includes(f.good.model),false);
    assert.deepEqual(findings.map(f=>f.title),['Known defect','New observation']);
    assert.equal(findings[0].body,'Found by [route] [REDACTED]');
    assert.equal(findings[1].body,'Needs triage');
    if(variant==='missing-provider'||variant==='missing-id') {
      assert.equal(run.admissions[1].admitted,false);
      assert.equal(run.admissions[1].providerCalls,0);
    }
    assert.equal(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).filter(c=>!c.dry).length,2);
  });
});


test('blind text preserves words and placeholders while hiding complete identity tokens',async t=>{
  const states=[
    ['whole-token','route-alpha','route-alpha found it','[route] found it'],
    ['substring','n','Known findings remain unchanged','Known findings remain unchanged'],
    ['prior-placeholder','route','[route] route [REDACTED]','[route] [route] [REDACTED]'],
    ['single-character','n','n: Known defect','[route]: Known defect'],
    ['absent','route-alpha','A finding without attribution','A finding without attribution'],
  ];
  for(const [state,id,observation,expected] of states) await t.test(state,async t=>{
    const f=fake(t,observation),routes=[{...f.good,id}];
    const manifest=freezeManifest({...f,routes,runId:state});
    await runBench({...f,manifest,routes,runId:state});
    const blind=JSON.parse(fs.readFileSync(path.join(f.evidenceRoot,'bench',state,'blind.json')));
    const findings=blind.samples.find(s=>s.status==='findings').findings;
    assert.equal(findings[1].body,expected);
    assert.equal(findings[0].body,'Found by [route] [REDACTED]');
    assert.equal(findings[0].title,'Known defect');
  });
});


test('pinned protocol fetches historical OIDs while protocol zero rejects them',async t=>{
  const f=fake(t),realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();
  const env={PATH:process.env.PATH,HOME:f.root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull};
  const sourceConfig=spawnSync(realGit,['config','--get-regexp','^uploadpack[.]allow'],{cwd:f.repo,env,encoding:'utf8'});
  assert.equal(sourceConfig.status,1); // Source keeps default upload-pack settings.
  const tips=execFileSync(realGit,['show-ref'],{cwd:f.repo,env,encoding:'utf8'});
  assert.equal(tips.includes(f.receipt.head),false);assert.equal(tips.includes(f.receipt.base),false);
  for(const protocol of [0,2]) {
    const copy=path.join(f.root,'protocol-'+protocol);fs.mkdirSync(copy);
    execFileSync(realGit,['init','--quiet'],{cwd:copy,env});
    const result=spawnSync(realGit,['-c','protocol.version='+protocol,'fetch','--quiet','--no-tags',f.repo,f.receipt.head,f.receipt.base],{cwd:copy,env,encoding:'utf8'});
    if(protocol===0) {assert.notEqual(result.status,0);assert.match(result.stderr,/unadvertised object/);}
    else {
      assert.equal(result.status,0);
      execFileSync(realGit,['checkout','--quiet','--detach',f.receipt.head],{cwd:copy,env});
      assert.equal(execFileSync(realGit,['rev-parse','HEAD'],{cwd:copy,env,encoding:'utf8'}).trim(),f.receipt.head);
      assert.equal(execFileSync(realGit,['merge-base',f.receipt.base,f.receipt.head],{cwd:copy,env,encoding:'utf8'}).trim(),f.receipt.base);
    }
  }
  // Force a v0 host default; the real bench fetch must override it explicitly.
  const bin=path.join(f.root,'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'git'),`#!/usr/bin/env node
const result=require('node:child_process').spawnSync(${JSON.stringify(realGit)},['-c','protocol.version=0',...process.argv.slice(2)],{stdio:'inherit'});
process.exit(result.status??1);
`,{mode:0o700});
  const previousPath=process.env.PATH;process.env.PATH=bin+path.delimiter+previousPath;
  try {
    const manifest=freezeManifest({...f,runId:'pinned-protocol'});
    const run=await runBench({...f,manifest,runId:'pinned-protocol',routes:[f.good]});
    assert.equal(run.calls,2);
    assert.equal(run.samples.filter(s=>s.status==='findings').length,1);
    assert.equal(run.samples.filter(s=>s.status==='scoped-clean').length,1);
  } finally {process.env.PATH=previousPath;}
});

test('local diff formatting and attributes cannot change frozen evidence or replay',async t=>{
  const f=fake(t),original=buildManifest(f);
  for(const [key,value] of Object.entries({'diff.context':'0','diff.algorithm':'histogram','diff.noprefix':'true','diff.mnemonicPrefix':'true','diff.indentHeuristic':'false','diff.custom.xfuncname':'.*'})) f.git('config',key,value);
  fs.writeFileSync(path.join(f.repo,'.git','info','attributes'),'code.txt diff=custom\n');
  const manifest=freezeManifest({...f,runId:'local-config'});
  assert.deepEqual(manifest.cases.map(c=>c.evidenceDigests),original.cases.map(c=>c.evidenceDigests));
  const run=await runBench({...f,manifest,runId:'local-config',routes:[f.good]});
  assert.equal(run.calls,2);
  assert.equal(run.samples.filter(s=>s.status==='findings').length,1);
});

test('OS environment allowlist excludes undeclared process credentials from helper children',async t=>{
  const previous=process.env.UNRELATED_SECRET;
  const marker=crypto.randomBytes(24).toString('hex');process.env.UNRELATED_SECRET=marker;
  t.after(()=>{if(previous===undefined)delete process.env.UNRELATED_SECRET;else process.env.UNRELATED_SECRET=previous;});
  const f=fake(t),manifest=freezeManifest({...f,runId:'host-environment'});
  const run=await runBench({...f,manifest,runId:'host-environment',routes:[f.good]});
  assert.equal(run.calls,2);
  const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.every(c=>!c.ambientLeaked),'undeclared host variable reached a helper');
  assert.ok(!treeBytes(f.root).includes(marker),'undeclared host credential reached a file');
});

test('a clean case cannot substitute for either member of a defect-fix pair',t=>{
  const f=fake(t);
  for(const kind of ['defect','fix']) {
    const plan=structuredClone(f.plan),item=plan.cases.find(c=>c.kind===kind);
    item.kind='clean';item.gold=[];
    assert.throws(()=>buildManifest({...f,plan}),/pair/);
  }
  assert.doesNotThrow(()=>buildManifest(f));
});

test('disputed outcome requires independent reviewers without relying on an optional flag',async t=>{
  const f=fake(t),manifest=freezeManifest({...f,runId:'dispute'}),run=await runBench({...f,manifest,runId:'dispute'});
  const sample=run.samples.find(s=>s.findings.length);
  const entry={sampleId:sample.sampleId,findingIndex:0,outcome:'disputed',reviewers:['grader-a'],evidence:'Disagreement is unresolved'};
  assert.throws(()=>scoreBench({manifest,run,adjudications:{entries:[entry]}}),/cross-check/);
  assert.throws(()=>scoreBench({manifest,run,adjudications:{entries:[{...entry,reviewers:['grader-a','grader-a']}]}}),/cross-check/);
  const score=scoreBench({manifest,run,adjudications:{entries:[{...entry,reviewers:['grader-a','grader-b']}]}});
  assert.equal(score.scores.find(s=>s.sampleId===sample.sampleId).disputed,1);
});

test('pair metrics join defect and fix samples by pair and repeat and retain incomplete pairs',async t=>{
  const f=fake(t);f.plan.repeats=2;
  f.plan.cases.find(c=>c.kind==='defect').gold.push({id:'g2',severity:'P2',evidence:'Another independent defect'});
  const manifest=freezeManifest({...f,runId:'pair-metrics'}),run=await runBench({...f,manifest,runId:'pair-metrics'});
  const entries=run.samples.flatMap(s=>s.findings.map((_,findingIndex)=>({sampleId:s.sampleId,findingIndex,outcome:'false-positive',novelTriage:true,reviewers:['grader-a'],evidence:'Different trigger from both gold defects'})));
  const score=scoreBench({manifest,run,adjudications:{entries}}),report=reportBench({manifest,run,score});
  const metric=report.summaries[0].regressions;
  assert.equal(metric.pairedMisses,2); // Two pair/repeat observations, not four missing gold defects.
  assert.equal(metric.pairedPlanned,2);assert.equal(metric.pairedEvaluated,2);assert.equal(metric.pairedUnresolved,0);
  assert.deepEqual(metric.pairs.map(p=>p.repeat),[1,2]);assert.ok(metric.pairs.every(p=>p.pairId==='pair-1'&&p.defectSampleId&&p.fixSampleId&&p.missedDefects===2));
  const {digest,...changed}=structuredClone(run),fixId=f.plan.cases.find(c=>c.kind==='fix').id;
  changed.samples.find(s=>s.caseId===fixId&&s.repeat===1).status='failed';
  const incomplete={...changed,digest:receiptDigest(changed)};
  const unresolved=reportBench({manifest,run:incomplete,score:scoreBench({manifest,run:incomplete,adjudications:{entries}})}).summaries[0].regressions;
  assert.equal(unresolved.pairedPlanned,2);assert.equal(unresolved.pairedEvaluated,1);assert.equal(unresolved.pairedUnresolved,1);assert.equal(unresolved.pairedMisses,1);
});
