import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runDeploy, performIntent, afterShip } from './deploy.mjs';
import { affected } from './deploy-config.mjs';
import { composeBody } from './ship-pr.mjs';
import { digest } from './runtime.mjs';

const H = 'a'.repeat(40), M = 'b'.repeat(40), F = 'c'.repeat(40), FM = 'd'.repeat(40), OLD = 'e'.repeat(40);
const T = Date.parse('2026-11-15T10:00:00Z');
const vercelFixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/vercel/${name}.json`, import.meta.url))).response;
const threadsFixture = JSON.parse(fs.readFileSync(new URL('./fixtures/claude-pr-replies/attempt-2/session-out/07-threads-after.json', import.meta.url)));
const web = { kind: 'vercel', paths: ['src/**'], domain: 'probe.vercel.app', team: 'team_probe', check: 'node health.mjs' };
const cert = (head, issue = 'MONO-423') => `mono-ship green certificate\nShip: green\nIssue(s): ${issue}\nHead SHA: ${head}\nPR: https://github.com/test/product/pull/1`;
const connection = nodes => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
function fixture(t, targets = [web]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-deploy-test-'));
  const file = path.join(root, 'fake.json'), config = path.join(root, 'config.json');
  const baseline = { ...vercelFixture('06-domain-read-before-rollback'), id: 'old', url: 'old.vercel.app', projectId: 'prj_probe', meta: { githubCommitSha: OLD }, gitSource: { sha: OLD } };
  const fresh = { ...vercelFixture('11-new-deploy-ready-staged'), id: 'new', url: 'new.vercel.app', projectId: 'prj_probe', readySubstate: 'PROMOTED', createdAt: T, meta: { githubCommitSha: M }, gitSource: { sha: M } };
  const project = { ...vercelFixture('05-project-before-rollback'), id: 'prj_probe', name: 'probe', link: { repoId: 123, productionBranch: 'main' }, latestDeployments: [], targets: { production: baseline } };
  const initial = { clock: T, head: H, merge: M, merged: false, files: [{ filename: 'src/a.js', patch: '+hello' }], comments: [{ body: `<!-- mono:ship --> ${H}`, created_at: new Date(T - 1000).toISOString() }], reviewComments: [], reviews: [], checks: [{ __typename: 'CheckRun', name: 'validate', status: 'COMPLETED', conclusion: 'SUCCESS', checkSuite: { commit: { oid: H } } }], threads: [], domain: baseline, deployments: { old: baseline, new: fresh }, project, main: M, comparisons: {}, calls: [], health: 0, local: { copyCommit: OLD, processCommit: OLD, startedAt: T - 10000, installing: false, restoring: false }, saved: OLD };
  fs.writeFileSync(file, JSON.stringify(initial));
  fs.writeFileSync(config, JSON.stringify({ projectName: 'Проба', deploy: { targets }, qa: { mode: 'terminal', install: [], start: 'true', ready: { command: 'true', identity: 'copy' }, data: { source: 'synthetic', description: 'fixture' }, forbiddenActions: ['no real writes'], beforeMerge: false } }));
  const fake = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const file = process.env.MONO_DEPLOY_FIXTURE, s = JSON.parse(fs.readFileSync(file));
const a = process.argv.slice(2), name=path.basename(process.argv[1]);
s.calls.push([name,...a]);
const write=()=>fs.writeFileSync(file,JSON.stringify(s));
const send=v=>{write(); console.log(JSON.stringify(v)); process.exit(0);};
const fail=m=>{write(); console.error(m); process.exit(1);};
const conn=nodes=>({nodes,pageInfo:{hasNextPage:false,endCursor:null}});
if(name==='gh') {
 if(a[0]==='pr' && a[1]==='merge') { if(a.includes('--auto') || !a.includes('--squash') || a.at(-1)!==s.head) fail('unsafe merge'); s.merged=true; send({}); }
 const endpoint=a.find(x=>x.startsWith('repos/'));
 if(a[1]==='graphql') {
  if(s.advanceOnSnapshot&&!s.advanced){s.clock+=600001;s.advanced=true;}
  const q=a.find(x=>x.startsWith('query='));
  if(q.includes('reviewThreads')) send({data:{repository:{pullRequest:{reviewThreads:conn(s.threads)}}}});
  if(q.includes('node(id:')) {const id=a.find(x=>x.startsWith('id=')).slice(3); send({data:{node:{comments:conn(s.threads.find(t=>t.id===id).comments)}}});}
  if(q.includes('statusCheckRollup')) send({data:{repository:{object:{statusCheckRollup:{contexts:conn(s.checks)}}}}});
  send({data:{repository:{pullRequest:{headRefOid:s.head,state:s.merged?'MERGED':'OPEN',mergeStateStatus:s.mergeState||'CLEAN',mergeable:'MERGEABLE',baseRefName:'main',baseRefOid:s.main,baseRef:null}}}});
 }
 if(a[1]==='user') send({login:'owner'});
 if(endpoint?.includes('/rules/')) send([]);
 if(endpoint?.endsWith('/reviews')) send([s.reviews]);
 if(endpoint?.endsWith('/comments')) send([endpoint.includes('/issues/')?s.comments:s.reviewComments]);
 if(endpoint?.endsWith('/files')) send([s.files]);
 if(endpoint?.endsWith('/commits/main')) send({sha:s.main});
 if(endpoint?.includes('/commits/v')) send({sha:s.tags?.[endpoint.split('/').at(-1)]||'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'});
 if(endpoint?.includes('/compare/')) { const pair=endpoint.split('/compare/')[1]; send(s.comparisons[pair]||{status:pair.split('...')[0]===pair.split('...')[1]?'identical':'behind',files:[]}); }
 if(endpoint?.includes('/check-runs')) send({total_count:1,check_runs:[{id:1,name:'validate',head_sha:s.main,status:'completed',conclusion:s.landingRed?'failure':'success',completed_at:new Date(s.clock).toISOString()}]});
 if(endpoint?.endsWith('/pulls/1')) send({number:1,head:{sha:s.head},base:{ref:'main',repo:{full_name:'test/product'}},state:s.merged?'closed':'open',merged:s.merged,mergeable_state:s.mergeState==='BLOCKED'?'blocked':'clean',merged_at:s.merged?new Date(s.clock- (s.mergeAge||0)).toISOString():null,merge_commit_sha:s.merge});
 fail('unexpected gh '+JSON.stringify(a));
}
if(name==='vercel') {
 if(a[0]==='rollback'||a[0]==='promote') { if(s.actionUnknown) send({}); s.domain=s.deployments[a[1]]; s.project.autoAssignCustomDomains=a[0]==='promote'; s.project.targets.production=s.domain; send({}); }
 const endpoint=a[1];
 if(endpoint==='/v13/deployments' && a.includes('POST')) { s.retryBody=JSON.parse(fs.readFileSync(a[a.indexOf('--input')+1])); const d={...s.deployments.new,id:'repeated',createdAt:s.clock,readyState:s.repeatState||'READY'}; s.deployments.repeated=d; s.project.latestDeployments=[d]; if(s.repeatDomain) s.domain=d; send(d); }
 if(endpoint.startsWith('/v9/projects/')) {if(s.flagSequence?.length) s.project.autoAssignCustomDomains=s.flagSequence.shift(); send(s.project);}
 if(endpoint.includes('/v13/deployments/probe.vercel.app')) {if(s.unread)fail('login expired'); send(s.domain);}
 if(endpoint.includes('/v13/deployments/second.vercel.app')) send(s.secondDomain);
 const id=endpoint.split('/').at(-1); if(s.deployments[id]) send(s.deployments[id]);
 fail('unexpected vercel '+JSON.stringify(a));
}
`;
  for (const name of ['gh', 'vercel']) { fs.writeFileSync(path.join(root, name), fake); fs.chmodSync(path.join(root, name), 0o755); }
  fs.writeFileSync(path.join(root, 'health.mjs'), `import fs from 'node:fs';const p=process.env.MONO_DEPLOY_FIXTURE,s=JSON.parse(fs.readFileSync(p));s.calls.push(['health',...process.argv.slice(2)]);fs.writeFileSync(p,JSON.stringify(s));process.exit(s.rejectHealthArgs&&process.argv.length>2?1:(s.healthByCommit?.[s.local.processCommit]??s.health));`);
  fs.writeFileSync(path.join(root, 'local.mjs'), `import fs from 'node:fs';const p=process.env.MONO_DEPLOY_FIXTURE,s=JSON.parse(fs.readFileSync(p)),[verb,sha]=process.argv.slice(2);s.calls.push(['local',verb,sha]);if(verb==='status'){console.log(JSON.stringify(s.local));}else if(!s.localUnknown){if(verb==='install')s.saved=s.local.processCommit;s.local={copyCommit:sha,processCommit:sha,startedAt:s.clock,installing:false,restoring:false};}fs.writeFileSync(p,JSON.stringify(s));`);
  const env = { PATH: process.env.PATH, MONO_DEPLOY_FIXTURE: process.env.MONO_DEPLOY_FIXTURE };
  process.env.PATH = root + path.delimiter + env.PATH; process.env.MONO_DEPLOY_FIXTURE = file;
  t.after(() => { for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value; fs.rmSync(root, { recursive: true, force: true }); });
  const read = () => JSON.parse(fs.readFileSync(file));
  const mutate = fn => { const state = read(); fn(state); fs.writeFileSync(file, JSON.stringify(state)); };
  const request = { root, worktree: root, config, repo: 'test/product', issue: 'MONO-423', head: H, certificate: cert(H) };
  const runFile = head => path.join(root, 'landing/deploy', `${head??request.head}.json`);
  const savedRun = () => JSON.parse(fs.readFileSync(runFile()));
  const editRun = fn => { const r=savedRun();fn(r);fs.writeFileSync(runFile(),JSON.stringify(r)); };
  const call = (command, extra={}) => runDeploy(command, {...request,target:0,...extra}, { now: () => read().clock, sleep: async ms => mutate(s => {s.clock += ms;}) });
  const prove = async () => { await call('merge'); mutate(s=>{s.domain=s.deployments.new;s.project.latestDeployments=[s.deployments.new];}); return call('prove'); };
  const check = (kind,result='green',id='new',surface='browser',attempt=1,extra={}) => call('check',{kind,result,id,surface,attempt,url:surface==='domain'?'https://probe.vercel.app':`https://${id}.vercel.app`,...extra});
  const badNew = async () => { mutate(s=>s.healthByCommit={}); mutate(s=>s.health=1); await prove(); mutate(s=>s.health=0); for (const attempt of [1,2]) await check('quick','red','new','browser',attempt); await check('quick','green','old'); };
  const rbFile=()=>path.join(root,'landing/rollback',`${digest(targets[0]).slice(0,16)}.json`);
  const repair = async () => {
    await badNew(); await call('rollback',{repairIssue:'MONO-424'}); await call('outcome');
    request.head=F;request.issue='MONO-424';request.certificate=cert(F,'MONO-424');
    mutate(s=>{s.head=F;s.merge=FM;s.main=FM;s.merged=false;s.checks[0].checkSuite.commit.oid=F;s.comments=[{body:`<!-- mono:ship --> ${F}`,created_at:new Date(s.clock).toISOString()}];s.deployments.fix={...s.deployments.new,id:'fix',url:'fix.vercel.app',meta:{githubCommitSha:FM},gitSource:{sha:FM},readySubstate:'STAGED'};s.project.latestDeployments=[s.deployments.fix];});
    await call('merge',{fix:'MONO-424'}); await call('prove');
  };
  return {root,file,config,request,read,mutate,call,prove,check,badNew,repair,savedRun,editRun,rbFile};
}

test('paths select root files, nested files, renamed previous paths and exclude sibling prefixes', () => {
  assert.equal(affected(web,['src/a/b.js']),true);assert.equal(affected(web,['src-other/a']),false);
  assert.equal(affected({paths:['**/*.js']},['a.js']),true);assert.equal(affected({paths:['*.json']},['a/package.json']),false);
});
for(const [name,change,pattern] of [
  ['foreign head',s=>s.head=F,/head changed/],['pending check',s=>s.checks[0].status='IN_PROGRESS',/checks/],['red check',s=>s.checks[0].conclusion='FAILURE',/checks/],['unresolved thread',s=>s.threads=[{id:'thread',isResolved:false,comments:[]}],/unresolved/],['remark after Ship',s=>s.comments.push({body:'fix this',created_at:new Date(T+1).toISOString()}),/new remarks/],['edited remark after Ship',s=>s.comments.push({body:'fix this',created_at:new Date(T-9000).toISOString(),updated_at:new Date(T+1).toISOString()}),/new remarks/],['blocked merge state',s=>s.mergeState='BLOCKED',/merge state/]
]) test(`merge refuses ${name} without calling merge`, async t=>{ const f=fixture(t);f.mutate(change);await assert.rejects(f.call('merge'),pattern);assert.equal(f.read().calls.some(c=>c[1]==='pr'&&c[2]==='merge'),false); });
test('merge invokes exact squash head gate, ignores empty commit statuses, and resumes already merged PR',async t=>{
 const f=fixture(t);await f.call('merge');await f.call('merge');assert.equal(f.read().calls.filter(c=>c[1]==='pr'&&c[2]==='merge').length,1);assert.deepEqual(f.read().calls.find(c=>c[1]==='pr'&&c[2]==='merge'),['gh','pr','merge','1','--repo','test/product','--squash','--match-head-commit',H]);assert.equal(f.savedRun().targets[0].baseline.id,'old');
});
test('latest Ship marker on this head admits resolved replies and ignores earlier remarks',async t=>{
 const f=fixture(t);f.mutate(s=>{s.comments=[{body:`<!-- mono:ship --> ${H}`,created_at:new Date(T-3000).toISOString()},{body:'earlier',created_at:new Date(T-2000).toISOString()},{body:`<!-- mono:ship --> ${H}`,created_at:new Date(T-1000).toISOString()}];s.threads=[{id:'x',isResolved:true,comments:[{id:'reply'}]}];s.reviewComments=[{node_id:'reply',body:'fixed',updated_at:new Date(T+100).toISOString()}];});await f.call('merge');
});
test('no deploy block refuses; QA beforeMerge without proof refuses',async t=>{
 const f=fixture(t);const cfg=JSON.parse(fs.readFileSync(f.config));delete cfg.deploy;fs.writeFileSync(f.config,JSON.stringify(cfg));await assert.rejects(f.call('merge'),/deploy:/);cfg.deploy={targets:[web]};cfg.qa.beforeMerge=true;fs.writeFileSync(f.config,JSON.stringify(cfg));await assert.rejects(f.call('merge'),/QA:/);
});
for(const scenario of ['drop migration','no browser','stale browser','different browser deployment'])test(`night waits without merge: ${scenario}`,async t=>{
 const f=fixture(t);if(scenario==='drop migration')f.mutate(s=>s.files=[{filename:'migrations/one.sql',patch:'+DROP TABLE users;'}]);
 const mark=scenario==='stale browser'?{id:'old',at:T-600001}:scenario==='different browser deployment'?{id:'new',at:T}:{id:'old',at:T};
 const r=await f.call('merge',{afk:true,...(scenario==='no browser'?{}:{browserReady:mark})});assert.equal(r.state,'waiting-morning');assert.equal(f.read().merged,false);
});
test('night with fresh signed-in browser mark merges; transient project flag settles, persistent mismatch refuses',async t=>{
 const f=fixture(t);f.mutate(s=>s.flagSequence=[false,false,true]);await f.call('merge',{afk:true,browserReady:{id:'old',at:T}});assert.equal(f.savedRun().targets[0].browserReady.id,'old');
});
test('persistent Vercel rollback mismatch blocks merge after bounded 30s',async t=>{
 const f=fixture(t);f.mutate(s=>s.project.autoAssignCustomDomains=false);await assert.rejects(f.call('merge'),/disagree/);assert.equal(f.read().merged,false);assert.equal(f.read().clock,T+30000);
});
test('proof uses alias version; unreadable domain outcome contains no deployment claim',async t=>{
 const f=fixture(t);await f.call('merge');f.mutate(s=>s.unread=true);const p=await f.call('prove');assert.equal(p.versionProven,false);const out=await f.call('outcome');assert.equal(out.targets[0].versionProven,false);assert.doesNotMatch(out.targets[0].reason,/выкатили/);assert.equal(out.projectUpdateAllowed,false);
});
test('AE2 missing build repeats exactly once with numeric repoId; old alias after deadline fails',async t=>{
 const f=fixture(t);await f.call('merge');const r=await f.call('prove');assert.equal(r.outcome,'выкатка упала, прод на старой версии');assert.equal(f.read().calls.filter(c=>c[0]==='vercel'&&c.includes('POST')).length,1);assert.deepEqual(f.read().retryBody,{name:'probe',project:'prj_probe',target:'production',gitSource:{type:'github',repoId:123,ref:'main',sha:M}});assert.equal((await f.call('outcome')).outcome,r.outcome);
});
test('new main changes inside paths prevent retry over new work; outside paths permit repeat',async t=>{
 const f=fixture(t);await f.call('merge');f.mutate(s=>{s.main=F;s.comparisons[`${M}...${F}`]={status:'ahead',files:[{filename:'src/new.js'}]};});assert.equal((await f.call('prove')).state,'stopped');assert.equal(f.read().calls.filter(c=>c.includes('POST')).length,0);
});
test('proof accepts descendant deployment but never an unrelated commit',async t=>{
 const f=fixture(t);await f.call('merge');f.mutate(s=>{s.domain={...s.deployments.new,meta:{githubCommitSha:F}};s.comparisons[`${M}...${F}`]={status:'ahead',files:[{filename:'stamp'}]};});assert.equal((await f.call('prove')).state,'proven');
});
test('AE1 old browser failure never triggers rollback; known breakage gets followup',async t=>{
 const f=fixture(t);await f.prove();f.mutate(s=>s.health=1);await f.call('prove');await f.check('quick','red','new','browser',1);await f.check('quick','red','new','browser',2);await f.check('quick','red','old');await assert.rejects(f.call('rollback'),/red twice/);await f.check('scenario');const out=await f.call('outcome');assert.match(out.targets[0].reason,/известная/);assert.ok(out.followups.length);assert.equal(f.read().calls.some(c=>c[1]==='rollback'),false);
});
test('S19 explicit U5 exception retains domain red, follows up discrepancy, forbids verified outcome',async t=>{
 const f=fixture(t);f.mutate(s=>s.health=1);await f.prove();await f.check('quick');await f.check('scenario');const out=await f.call('outcome');assert.equal(out.outcome,'выкатили, не проверено');assert.match(out.targets[0].reason,/по домену красная, по адресу сборки зелёная/);assert.ok(f.savedRun().targets[0].checks.some(c=>c.surface==='domain'&&c.result==='red'));assert.equal(out.followups[0].kind,'discrepancy');
});
test('browser unavailable leaves run open, refuses rollback and return, Stop gives truthful action and resumes same check',async t=>{
 const f=fixture(t);await f.prove();const r=await f.check('quick','unavailable','old','browser',1,{reason:'no signed-in browser',who:'owner'});assert.equal(r.outcome,null);assert.match(r.lines[1],/Сделал: не откатывал/);assert.equal((await f.call('rollback')).state,'stopped');assert.equal((await f.call('outcome')).open,true);assert.equal(f.savedRun().closedAt,undefined);f.mutate(s=>s.clock++);await f.check('quick','green','old');assert.equal(f.savedRun().stop,undefined);
});
test('rollback requires red twice on own URL, uses saved baseline, records rollback and health',async t=>{
 const f=fixture(t);await f.badNew();f.mutate(s=>{s.project.lastRollbackTarget='wrong';});const r=await f.call('rollback',{repairIssue:'MONO-424'});assert.equal(r.outcome,'откатили');assert.equal(JSON.parse(fs.readFileSync(f.rbFile())).rollback.id,'old');assert.equal(f.read().domain.id,'old');assert.equal((await f.call('outcome')).outcome,'откатили');
});
test('AE3 repair STAGED is checked before promote, waits production check then archives rollback',async t=>{
 const f=fixture(t);await f.repair();await assert.rejects(f.call('return'),/own URL/);await f.check('quick','green','fix');await f.check('scenario','green','fix');assert.equal((await f.call('return')).state,'awaiting-prod-check');assert.ok(fs.existsSync(f.rbFile()));await assert.rejects(f.call('return'),/awaits production/);await f.check('scenario','green','fix','domain');assert.equal((await f.call('return')).state,'returned');assert.equal(fs.existsSync(f.rbFile()),false);assert.ok(fs.readdirSync(path.join(f.root,'landing/rollback/archive')).length);assert.equal((await f.call('outcome')).outcome,'выкатили и проверили');
});
test('AE3 one red after promote cancels return without repeating check; further return stays stopped',async t=>{
 const f=fixture(t);await f.repair();await f.check('quick','green','fix');await f.check('scenario','green','fix');await f.call('return');await f.check('scenario','red','fix','domain');const r=await f.call('return');assert.equal(r.state,'stopped');assert.equal(f.read().domain.id,'old');assert.equal((await f.call('return')).state,'stopped');assert.equal(f.read().calls.filter(c=>c[1]==='promote').length,1);
});
test('different repair head is never merged',async t=>{
 const f=fixture(t);await f.repair();f.request.head='f'.repeat(40);f.request.certificate=cert(f.request.head,'MONO-424');f.mutate(s=>{s.head=f.request.head;s.merged=false;});await assert.rejects(f.call('merge',{fix:'MONO-424'}),/another deploy run|another PR\/head/);
});
test('AE4 unavailable scenario names checker; multiple targets worst first; no affected target closes without outcome',async t=>{
 const f=fixture(t,[web,{kind:'none',paths:['src/**'],reason:'мобильное Deploy пока не смотрит'},{kind:'pack'}]);await f.prove();await f.check('quick');await f.check('scenario','unavailable','new','browser',1,{reason:'needs live call',who:'owner before 2026-11-16',browserAvailable:true});const r=await f.call('outcome');assert.equal(r.outcome,'выкатили, не проверено');assert.match(r.targets.find(t=>t.target===0).reason,/owner/);assert.equal(r.targets.at(-1).outcome,'влито, ждёт выпуска');
});
test('PR without targets closes with no outcome or project update',async t=>{
 const f=fixture(t);f.mutate(s=>s.files=[{filename:'docs/a.md'}]);await f.call('merge');const r=await f.call('outcome');assert.equal(r.outcome,null);assert.equal(r.noTargets,true);assert.equal(r.projectUpdateAllowed,false);assert.ok(f.savedRun().closedAt);
});
test('manual pack PR without registry attempt never invokes landing-drain record',async t=>{
 const f=fixture(t,[{kind:'pack'}]);await f.call('merge');const r=await f.call('outcome');assert.equal(r.outcome,'влито, ждёт выпуска');assert.equal(f.read().calls.some(c=>c.includes('record')),false);
});
for(const verb of ['repeat','rollback','promote','install','restore'])for(const fact of ['occurred','not-executed','unknown'])test(`U7 pending ${verb}: ${fact}`,async()=>{
 let time=T,executed=0,saved=0;const state={intents:{x:{action:verb,target:'destination',at:T}}};let happened=fact==='occurred';
 const execute=async()=>{executed++;happened=true;};const observe=async()=>happened?{state:'occurred',value:{confirmed:true}}:{state:fact};
 const call=()=>performIntent({state,key:'x',action:verb,target:'destination',persist:()=>saved++,observe,execute,now:()=>time,sleep:async ms=>time+=ms,deadline:T+40000});
 if(fact==='unknown')await assert.rejects(call(),/Stop without repeating/);else assert.deepEqual(await call(),{confirmed:true});assert.equal(executed,fact==='not-executed'?1:0);assert.ok(saved||fact==='unknown');
});
test('local install proves running process; red health restores; repair installs and archives rollback',async t=>{
 const local={kind:'local',command:'node local.mjs',check:'node health.mjs'};const f=fixture(t,[local]);await f.call('merge');f.mutate(s=>s.healthByCommit={[M]:1,[OLD]:0});assert.equal((await f.call('local',{repairIssue:'MONO-424'})).outcome,'откатили');assert.equal(f.read().local.processCommit,OLD);await f.call('outcome');
 f.request.head=F;f.request.issue='MONO-424';f.request.certificate=cert(F,'MONO-424');f.mutate(s=>{s.head=F;s.merge=FM;s.main=FM;s.merged=false;s.health=0;s.checks[0].checkSuite.commit.oid=F;s.comments=[{body:`<!-- mono:ship --> ${F}`,created_at:new Date(s.clock).toISOString()}];});await f.call('merge',{fix:'MONO-424'});assert.equal((await f.call('local')).state,'awaiting-local-scenario');assert.equal(fs.existsSync(f.rbFile()),true);await f.check('scenario','green',FM,'local');assert.equal((await f.call('local')).state,'proven');assert.equal(f.read().local.processCommit,FM);assert.equal(fs.existsSync(f.rbFile()),false);
});

test('landing red tip requires explicit corrective authorization and still checks merge SHA',async t=>{
 const f=fixture(t,[{kind:'pack'}]);const cfg=JSON.parse(fs.readFileSync(f.config));cfg.landing={validation:{check:'validate',timeoutSec:1}};fs.writeFileSync(f.config,JSON.stringify(cfg));f.mutate(s=>s.landingRed=true);await assert.rejects(f.call('merge'),/landing tip is red/);assert.equal(f.read().merged,false);const guard=path.join(f.root,'landing/guard',`${M}.json`),record=JSON.parse(fs.readFileSync(guard));record.corrective={issue:'MONO-423',reason:'repair',redSha:M};fs.writeFileSync(guard,JSON.stringify(record));assert.equal((await f.call('merge')).state,'waiting-validation');assert.equal(f.read().merged,true);assert.equal((await f.call('outcome')).outcome,null);assert.equal(f.read().calls.some(c=>c.includes('record')),false);f.mutate(s=>s.landingRed=false);await f.call('merge');assert.equal((await f.call('outcome')).outcome,'влито, ждёт выпуска');
});
test('status contexts must succeed, old-head checks refuse, finished neutral/skipped are accepted',async t=>{
 const f=fixture(t);f.mutate(s=>s.checks.push({__typename:'StatusContext',context:'legacy',state:'PENDING'}));await assert.rejects(f.call('merge'),/checks/);f.mutate(s=>{s.checks[1].state='SUCCESS';s.checks[0].checkSuite.commit.oid=F;});await assert.rejects(f.call('merge'),/checks/);f.mutate(s=>{s.checks[0].checkSuite.commit.oid=H;s.checks[0].conclusion='NEUTRAL';});await f.call('merge');
});
test('new attempt cannot enter product on rollback without recorded repair',async t=>{
 const f=fixture(t);await f.badNew();await f.call('rollback',{repairIssue:'MONO-424'});await f.call('outcome');f.request.head=F;f.request.certificate=cert(F);f.mutate(s=>{s.head=F;s.merged=false;});await assert.rejects(f.call('merge'),/product on rollback/);
});
test('repair absence after one repeat stops until morning on rollback',async t=>{
 const f=fixture(t);await f.repair();f.editRun(run=>{delete run.targets[0].proof;});f.mutate(s=>{s.project.latestDeployments=[];});const r=await f.call('prove');assert.equal(r.state,'stopped');assert.equal(r.outcome,null);assert.equal(f.read().domain.id,'old');assert.ok(fs.existsSync(f.rbFile()));assert.equal(f.read().calls.filter(c=>c.includes('POST')).length,1);
});
test('return refuses unavailable own-url check and keeps repair open',async t=>{
 const f=fixture(t);await f.repair();await f.check('quick','unavailable','fix','browser',1,{reason:'browser disconnected',who:'owner'});const r=await f.call('return');assert.equal(r.state,'stopped');assert.equal(r.outcome,null);assert.match(r.lines[1],/сборку починки/);assert.equal(f.read().calls.some(c=>c[1]==='promote'),false);assert.equal(f.savedRun().closedAt,undefined);
});
for(const fact of ['occurred','not-executed','unknown'])test(`U7 real fake Vercel repeat: ${fact==='not-executed'?'summary absence stays unknown':fact}`,async t=>{
 const f=fixture(t);await f.call('merge');f.editRun(run=>{run.intents[`${run.targets[0].key}:retry`]={action:'repeat',target:M,at:T-20000};});
 if(fact!=='not-executed')f.mutate(s=>{s.project.latestDeployments=[{...s.deployments.new,readyState:fact==='unknown'?'BUILDING':'READY'}];s.deployments.new.readyState=fact==='unknown'?'BUILDING':'READY';if(fact==='occurred')s.domain=s.deployments.new;});
 const r=await f.call('prove');assert.equal(f.read().calls.filter(c=>c.includes('POST')).length,0);assert.equal(r.state,fact==='occurred'?'proven':'stopped');
});
for(const fact of ['occurred','unknown'])test(`U7 web rollback interrupted ${fact} never repeats without positive non-execution proof`,async t=>{
 const f=fixture(t);await f.badNew();f.editRun(run=>{run.intents[`${run.targets[0].key}:rollback`]={action:'rollback',target:'old',at:T};});f.mutate(s=>{if(fact==='occurred'){s.domain=s.deployments.old;s.project.autoAssignCustomDomains=false;}});const r=await f.call('rollback',{repairIssue:'MONO-424'});assert.equal(r.state,fact==='occurred'?'rolled-back':'stopped');assert.equal(f.read().calls.filter(c=>c[1]==='rollback').length,0);
});
for(const fact of ['occurred','not-executed','unknown'])test(`U7 actual local pending install ${fact}`,async t=>{
 const f=fixture(t,[{kind:'local',command:'node local.mjs',check:'node health.mjs'}]);await f.call('merge');f.editRun(run=>{run.targets[0].baseline={...f.read().local,id:OLD};run.intents[`${run.targets[0].key}:install`]={action:'install',target:M,at:T};});f.mutate(s=>{if(fact==='occurred')s.local={copyCommit:M,processCommit:M,startedAt:T,installing:false,restoring:false};if(fact==='unknown'){s.local.installing=true;s.localUnknown=true;}});const r=await f.call('local');assert.equal(r.state,fact==='unknown'?'stopped':'proven');assert.equal(f.read().calls.filter(c=>c[0]==='local'&&c[1]==='install').length,fact==='not-executed'?1:0);
});
for(const installed of ['installed','rolled-back','waiting','stopped'])test(`pack result ${installed} translates without inventing outcome`,async t=>{
 const f=fixture(t,[{kind:'pack'}]);await f.call('merge');f.mutate(s=>s.tags={'v0.2.0':M});const r=await f.call('outcome',{packResult:{outcome:installed,places:[{place:'test-profile',verified:true,expected:'0.2.0',actual:'0.2.0'}],holders:installed==='waiting'?[{pid:123,reason:'active'}]:[]}});assert.equal(r.outcome,installed==='installed'?'выкатили и проверили':installed==='rolled-back'?'откатили':null);assert.equal(!!f.savedRun().closedAt,!['waiting','stopped'].includes(installed));
});
test('CLI request surface returns JSON and does not merge when block is missing', t=>{
 const f=fixture(t);fs.writeFileSync(f.config,JSON.stringify({projectName:'test'}));const input=path.join(f.root,'request.json');fs.writeFileSync(input,JSON.stringify(f.request));const result=spawnSync(process.execPath,['scripts/deploy.mjs','merge','--request',input],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/deploy:/);assert.equal(f.read().calls.length,0);
});
for(const fact of ['occurred','not-executed','unknown'])test(`U7 actual local pending restore ${fact}`,async t=>{
 const f=fixture(t,[{kind:'local',command:'node local.mjs',check:'node health.mjs'}]);await f.call('merge');
 const before={copyCommit:M,processCommit:M,startedAt:T,installing:false,restoring:false};
 f.editRun(run=>{const target=run.targets[0];target.baseline={...f.read().local,id:OLD};target.proof={...before,id:M};target.restoreFrom=before;run.intents[`${target.key}:restore`]={action:'restore',target:OLD,at:T};});
 f.mutate(s=>{s.local=fact==='occurred'?{...before,copyCommit:OLD,processCommit:OLD}:before;if(fact==='unknown'){s.local.restoring=true;s.localUnknown=true;}});
 const r=await f.call('local',{repairIssue:'MONO-424'});assert.equal(r.state,fact==='unknown'?'stopped':'rolled-back');assert.equal(f.read().calls.filter(c=>c[0]==='local'&&c[1]==='restore').length,fact==='not-executed'?1:0);assert.equal(f.read().calls.filter(c=>c[0]==='local'&&c[1]==='install').length,0);
});
test('one browser failure never authorizes rollback',async t=>{
 const f=fixture(t);f.mutate(s=>s.health=1);await f.prove();f.mutate(s=>s.health=0);await f.check('quick','red','new');await f.check('quick','green','old');await assert.rejects(f.call('rollback'),/red twice/);assert.equal(f.read().calls.some(c=>c[1]==='rollback'),false);
});
test('new local files with old running process do not prove installation',async t=>{
 const f=fixture(t,[{kind:'local',command:'node local.mjs',check:'node health.mjs'}]);await f.call('merge');f.editRun(run=>{run.targets[0].baseline={...f.read().local,id:OLD};run.intents[`${run.targets[0].key}:install`]={action:'install',target:M,at:T};});f.mutate(s=>{s.local.copyCommit=M;s.local.startedAt=T;s.localUnknown=true;});const r=await f.call('local');assert.equal(r.state,'stopped');assert.equal(r.outcome,null);assert.equal(f.read().calls.filter(c=>c[0]==='local'&&c[1]==='install').length,0);
});
test('fixtures preserve recorded GitHub resolved thread and published COMMENTED review shapes',()=>{
 const thread=threadsFixture.data.repository.pullRequest.reviewThreads.nodes[0];const review=JSON.parse(fs.readFileSync(new URL('./fixtures/claude-pr-replies/attempt-2/session-out/04-review-state.json',import.meta.url)));
 const comment={node_id:String(thread.comments.nodes[1].databaseId),body:'reply',updated_at:new Date(T+2000).toISOString()};
 const snapshot={reviews:[review],threads:[{id:thread.id,isResolved:thread.isResolved,comments:thread.comments.nodes.map(c=>({id:String(c.databaseId)}))}]};
 assert.equal(afterShip({snapshot,issueComments:[{body:`<!-- mono:ship --> ${H}`,created_at:new Date(T).toISOString()}],reviewComments:[comment],pr:{}},H).length,0);
 snapshot.threads[0].isResolved=false;assert.throws(()=>afterShip({snapshot,issueComments:[{body:`<!-- mono:ship --> ${H}`,created_at:new Date(T).toISOString()}],reviewComments:[comment],pr:{}},H),/unresolved/);
});
test('repair cannot close as deployed before domain return and production checks',async t=>{
 const f=fixture(t);await f.repair();await f.check('quick','green','fix');await f.check('scenario','green','fix');assert.equal((await f.call('outcome')).open,true);await f.call('return');await f.check('scenario','green','fix','domain');await f.call('return');assert.equal((await f.call('outcome')).outcome,'выкатили и проверили');
});
test('outcome waits for a scenario result or explicit unavailable reason and checker',async t=>{
 const f=fixture(t);await f.prove();await assert.rejects(f.call('outcome'),/scenario result/);assert.equal(f.savedRun().closedAt,undefined);await f.check('quick');await f.check('scenario','unavailable','new','browser',1,{reason:'real data requires owner',who:'owner by 2026-11-16',browserAvailable:true});assert.equal((await f.call('outcome')).outcome,'выкатили, не проверено');
});
test('unaffected documentation PR cannot bypass a product rollback',async t=>{
 const f=fixture(t);await f.badNew();await f.call('rollback',{repairIssue:'MONO-424'});await f.call('outcome');f.request.head=F;f.request.certificate=cert(F);f.mutate(s=>{s.head=F;s.merged=false;s.files=[{filename:'docs/a.md'}];});await assert.rejects(f.call('merge'),/product on rollback/);
});

// Regression cases from the first admitted review round.
test('review: normal browser scenario and quick check complete proven web delivery',async t=>{
 const f=fixture(t);await f.prove();await f.check('quick');await f.check('scenario');assert.equal((await f.call('outcome')).outcome,'выкатили и проверили');
});
test('review: an installed old pack release cannot prove the current merge',async t=>{
 const f=fixture(t,[{kind:'pack'}]);await f.call('merge');await assert.rejects(f.call('outcome',{packResult:{outcome:'installed',sha:OLD,tag:'v0.1.0',places:[{verified:true,expected:'0.1.0',actual:'0.1.0'}]}}),/contain|merge|release/);assert.equal(f.savedRun().closedAt,undefined);
});
test('review: fix parameter cannot impersonate the recorded repair Issue',async t=>{
 const f=fixture(t);await f.badNew();await f.call('rollback',{repairIssue:'MONO-424'});await f.call('outcome');f.request.issue='MONO-425';f.request.head=F;f.request.certificate=cert(F,'MONO-425');f.mutate(s=>{s.head=F;s.merge=FM;s.main=FM;s.merged=false;s.checks[0].checkSuite.commit.oid=F;s.comments=[{body:`<!-- mono:ship --> ${F}`,created_at:new Date(s.clock).toISOString()}];});await assert.rejects(f.call('merge',{fix:'MONO-424'}),/recorded repair|repair Issue/);
});
test('review: repair Issue can be bound after rollback and closed original run',async t=>{
 const f=fixture(t);await f.badNew();await f.call('rollback');await f.call('outcome');assert.equal((await f.call('rollback',{repairIssue:'MONO-424'})).state,'repair-bound');assert.equal(JSON.parse(fs.readFileSync(f.rbFile())).issue,'MONO-424');assert.equal(f.read().calls.filter(c=>c[1]==='rollback').length,1);
});
test('review: production return has no second scenario attempt to hide red',async t=>{
 const f=fixture(t);await f.repair();await f.check('quick','green','fix');await f.check('scenario','green','fix');await f.call('return');await f.check('scenario','red','fix','domain');await assert.rejects(f.check('scenario','green','fix','domain',2),/no repeat/);assert.equal((await f.call('return')).state,'stopped');assert.equal(f.read().domain.id,'old');
});
test('review: Ship boundary includes marked PR body and marked review replies',()=>{
 const at=offset=>new Date(T+offset).toISOString();const snapshot={reviews:[],threads:[]};
 assert.deepEqual(afterShip({snapshot,issueComments:[],reviewComments:[],pr:{body:composeBody({author:'Ship body',head:H,publishedAt:at(0)}),updated_at:at(10)}},H),[]);
 const comments=[{body:'old remark',created_at:at(-10)},{body:'new remark',created_at:at(10)}];
 assert.equal(afterShip({snapshot,issueComments:comments,reviewComments:[],pr:{body:composeBody({author:'Ship body',head:H,publishedAt:at(0)}),updated_at:at(10)}},H).length,1);
 assert.deepEqual(afterShip({snapshot,issueComments:[{body:`<!-- mono:ship --> ${H}`,created_at:at(-100)},comments[0]],reviewComments:[{body:`<!-- mono:ship --> ${H}`,updated_at:at(0)}],pr:{}},H),[]);
});
test('review: successful proof clears stale stop and failure',async t=>{
 const f=fixture(t);await f.call('merge');f.mutate(s=>{s.main=F;s.comparisons[`${M}...${F}`]={status:'ahead',files:[{filename:'src/new.js'}]};});assert.equal((await f.call('prove')).state,'stopped');f.editRun(r=>r.targets[0].failed=true);f.mutate(s=>s.domain=s.deployments.new);await f.call('prove');await f.check('quick');await f.check('scenario');assert.equal((await f.call('outcome')).outcome,'выкатили и проверили');
});
test('review: renamed main path prevents replaying old code',async t=>{
 const f=fixture(t);await f.call('merge');f.mutate(s=>{s.main=F;s.comparisons[`${M}...${F}`]={status:'ahead',files:[{filename:'archive/a.js',previous_filename:'src/a.js'}]};});assert.equal((await f.call('prove')).state,'stopped');assert.equal(f.read().calls.filter(c=>c.includes('POST')).length,0);
});
test('review: unreadable domain invalidates old proof for project update',async t=>{
 const f=fixture(t);await f.prove();f.mutate(s=>s.unread=true);await f.call('prove');const r=await f.call('outcome');assert.equal(r.targets[0].versionProven,false);assert.equal(r.projectUpdateAllowed,false);
});
test('review: discrepancy still requires a task scenario or explicit unavailable result',async t=>{
 const f=fixture(t);f.mutate(s=>s.health=1);await f.prove();await f.check('quick');await assert.rejects(f.call('outcome'),/scenario/);assert.equal(f.savedRun().closedAt,undefined);
});
test('review: STAGED repair is not described as production in browser Stop',async t=>{
 const f=fixture(t);await f.repair();const r=await f.check('quick','unavailable','fix','browser',1,{reason:'browser lost',who:'owner'});assert.match(r.lines[1],/прод сейчас на прошлой версии/);
});
test('review: local scenario repeated red restores the saved running version',async t=>{
 const f=fixture(t,[{kind:'local',command:'node local.mjs',check:'node health.mjs'}]);await f.call('merge');await f.call('local');for(const attempt of [1,2])await f.check('scenario','red',M,'local',attempt);assert.equal((await f.call('local',{repairIssue:'MONO-424'})).state,'rolled-back');assert.equal(f.read().local.processCommit,OLD);
});
test('review: unavailable real-data scenario with available browser is unverified, not a missing-browser Stop',async t=>{
 const f=fixture(t);await f.prove();await f.check('quick');await f.check('scenario','unavailable','new','browser',1,{reason:'real data needs owner',who:'owner by 2026-11-16',browserAvailable:true});assert.equal((await f.call('outcome')).outcome,'выкатили, не проверено');
});
test('review: two affected web targets accept two fresh browser marks',async t=>{
 const f=fixture(t,[web,{...web,domain:'second.vercel.app'}]);f.mutate(s=>{s.secondDomain={...s.domain,id:'old2',url:'old2.vercel.app'};s.deployments.old2=s.secondDomain;});assert.equal((await f.call('merge',{afk:true,browserReady:[{target:0,id:'old',at:T},{target:1,id:'old2',at:T}]})).state,'merged');
});
test('review: local target also waits for landing validation of its exact merge commit',async t=>{
 const f=fixture(t,[{kind:'local',command:'node local.mjs',check:'node health.mjs'}]);const c=JSON.parse(fs.readFileSync(f.config));c.landing={validation:{check:'validate',timeoutSec:1}};fs.writeFileSync(f.config,JSON.stringify(c));await f.call('merge');assert.ok(f.savedRun().landing);assert.ok(f.read().calls.some(call=>call.some(arg=>arg.includes(`/commits/${M}/check-runs`))));
});
test('review: local repair retains rollback until its scenario and restores on repeated red',async t=>{
 const f=fixture(t,[{kind:'local',command:'node local.mjs',check:'node health.mjs'}]);await f.call('merge');f.mutate(s=>s.healthByCommit={[M]:1,[OLD]:0});await f.call('local',{repairIssue:'MONO-424'});await f.call('outcome');f.request.head=F;f.request.issue='MONO-424';f.request.certificate=cert(F,'MONO-424');f.mutate(s=>{s.head=F;s.merge=FM;s.main=FM;s.merged=false;s.checks[0].checkSuite.commit.oid=F;s.comments=[{body:`<!-- mono:ship --> ${F}`,created_at:new Date(s.clock).toISOString()}];});await f.call('merge',{fix:'MONO-424'});assert.equal((await f.call('local')).state,'awaiting-local-scenario');assert.ok(fs.existsSync(f.rbFile()));await f.check('scenario','red',FM,'local',1);assert.equal((await f.call('local')).state,'awaiting-local-scenario-repeat');await f.check('scenario','red',FM,'local',2);assert.equal((await f.call('local')).state,'stopped');assert.equal(f.read().local.processCommit,OLD);assert.ok(fs.existsSync(f.rbFile()));
});
test('U4 literal: missing original build permits immediate one repeat',async t=>{
 const f=fixture(t);await f.call('merge');await f.call('prove');const run=f.savedRun();assert.equal(run.intents[`${run.targets[0].key}:retry`].at,run.mergedAt);
});
test('local check contract: health command does not receive an empty deployment URL',async t=>{
 const f=fixture(t,[{kind:'local',command:'node local.mjs',check:'node health.mjs'}]);f.mutate(s=>s.rejectHealthArgs=true);await f.call('merge');assert.equal((await f.call('local')).state,'proven');
});
test('review: red domain task scenario remains unverified when own URL turns green',async t=>{
 const f=fixture(t);await f.prove();await f.check('scenario','red','new','domain');await f.check('quick');await f.check('scenario');const r=await f.call('outcome');assert.equal(r.outcome,'выкатили, не проверено');assert.equal(r.followups[0].kind,'discrepancy');assert.ok(f.savedRun().targets[0].checks.some(c=>c.surface==='domain'&&c.kind==='scenario'&&c.result==='red'));
});

test('round3: a domain-only scenario cannot claim verified web delivery',async t=>{
 const f=fixture(t);await f.prove();await f.check('scenario','green','new','domain');await assert.rejects(f.call('outcome'),/own URL|browser/);assert.equal(f.savedRun().closedAt,undefined);
});
test('round3: failed merge validation blocks local install before any command',async t=>{
 const f=fixture(t,[{kind:'local',command:'node local.mjs',check:'node health.mjs'}]);const c=JSON.parse(fs.readFileSync(f.config));c.landing={validation:{check:'validate',timeoutSec:1}};fs.writeFileSync(f.config,JSON.stringify(c));await f.call('merge');f.mutate(s=>s.landingRed=true);await f.call('merge');const count=f.read().calls.filter(call=>call[0]==='local').length;assert.equal((await f.call('local')).state,'waiting-validation');assert.equal(f.read().calls.filter(call=>call[0]==='local').length,count);
});
test('round3: restored browser with unavailable owner data clears only browser Stop',async t=>{
 const f=fixture(t);await f.prove();await f.check('quick');await f.check('scenario','unavailable','new','browser',1,{reason:'browser absent',who:'owner'});await f.check('scenario','unavailable','new','browser',1,{reason:'owner data needed',who:'owner by tomorrow',browserAvailable:true});assert.equal(f.savedRun().stop,undefined);assert.equal((await f.call('outcome')).outcome,'выкатили, не проверено');
});
test('round3: PR activity timestamp cannot hide comments after actual Ship body publication',()=>{
 const at=n=>new Date(T+n).toISOString();const data={snapshot:{reviews:[],threads:[]},issueComments:[{body:'new owner concern',created_at:at(100)}],reviewComments:[],pr:{body:`<!-- mono:ship -->\n<!-- mono:ship body head=${H} published=${at(0)} -->\nbody\n<!-- /mono:ship body -->`,updated_at:at(100)}};
 assert.equal(afterShip(data,H).length,1);data.issueComments[0]={body:'edited concern',created_at:at(-100),updated_at:at(100)};assert.equal(afterShip(data,H).length,1);
});
test('round3: browser readiness is fresh at the actual merge after slow GitHub reads',async t=>{
 const f=fixture(t);f.mutate(s=>s.advanceOnSnapshot=true);const r=await f.call('merge',{afk:true,browserReady:{id:'old',at:T}});assert.equal(r.state,'waiting-morning');assert.equal(f.read().merged,false);
});
