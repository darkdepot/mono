import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound, parseChecker, findingKey, scanSecrets, formatReviewReport, resolveReviewRoles, roleInvocation, subscriptionStatus } from './code-review.mjs';
import { requiredPairings, validateModels } from './runtime.mjs';
const packRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sample={class:'missing-validation',file:'input.mjs',anchor:'return value',line:1,title:'Invalid input is accepted',trigger:'value is negative',evidence:'input.mjs returns value without validation'};
const transcripts=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/recorded-responses.json'),'utf8'));
const key=findingKey(sample);
const verdict=(extra={})=>({id:'F1',outcome:'confirmed',weight:'P2',danger:false,dangerCase:null,dangerReason:'This diagnostic-only path has no data, security or gate effects.',origin:'introduced',mergeKey:key,outOfContract:false,riskRaised:false,reason:'Negative values pass through the changed public function.',closed:false,newEvidence:false,...extra});
const review=(findings=[],reviewedFiles=['input.mjs'])=>({...transcripts.clean,findings,reviewedFiles});
function fixture(t) {
 const worktree=fs.mkdtempSync(path.join(os.tmpdir(),'mono-circle-test-')); t.after(()=>fs.rmSync(worktree,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:worktree,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.email','fixture@example.test');git('config','user.name','Fixture');
 fs.writeFileSync(path.join(worktree,'input.mjs'),'export function value(n) { return 0; }\n');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 fs.writeFileSync(path.join(worktree,'input.mjs'),'export function value(n) { return n; }\n');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
 const request={worktree,head,base,contract:'Return only nonnegative numbers. Manual review; no Linear writes.',packRoot};
 return {worktree,git,request};
}
function responder({findings=[],verdicts=[verdict()],responses=[]}={}) {
 const calls=[];
 return {calls,runRole:async request=>{calls.push(request);const response=responses.length?responses.shift():request.role==='code-review'?review(findings):{completed:true,verdicts};
  return {response,elapsedMs:10,usage:{input_tokens:12,output_tokens:8}};}};
}
test('AE1: completed covered clean first round stops without checker and prints an owner report',async t=>{
 const f=fixture(t),runner=responder();const record=await runReviewRound(f.request,runner);
 assert.equal(record.outcome,'clean');assert.equal(record.rounds.length,1);assert.equal(runner.calls.length,1);
 for(const field of ['Проверено:','Найдено:','Осталось:','Можно идти дальше'])assert.ok(formatReviewReport(record).includes(field));
 assert.equal(record.round.costs[0].usage.input_tokens,12);
});
test('AE4: two unreadable reviewer responses consume no round, never clean',async t=>{
 const runner=responder({responses:[...transcripts.unreadable]});const record=await runReviewRound(fixture(t).request,runner);
 assert.equal(record.outcome,'not-reviewed');assert.equal(record.rounds.length,0);assert.equal(runner.calls.length,2);assert.ok(record.failures.length>=2);
});
test('one malformed checker response retries once, missing response fails whole batch',async t=>{
 const f=fixture(t);let r=responder({responses:[review([sample]),'{', {completed:true,verdicts:[verdict()]}]});
 assert.equal((await runReviewRound(f.request,r)).outcome,'not-converged');assert.equal(r.calls.length,3);
 r=responder({responses:[review([sample]),{completed:true,verdicts:[]},{completed:true,verdicts:[]}]});
 const result=await runReviewRound(f.request,r);assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);
});
test('incomplete coverage gets one focused pass then not-reviewed',async t=>{
 const runner=responder({responses:[review([],[]),review([],[])]});const result=await runReviewRound(fixture(t).request,runner);
 assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);assert.equal(runner.calls.length,2);assert.match(runner.calls[1].prompt,/focusFiles/);
});
test('risky first round adds an ordinary pass and unions stable keys before one checker',async t=>{
 const runner=responder({findings:[sample]});const f=fixture(t);const result=await runReviewRound({...f.request,risk:'risky'},runner);
 assert.equal(result.findings.length,1);assert.equal(runner.calls.filter(c=>c.role==='code-review').length,2);assert.equal(runner.calls.filter(c=>c.role==='code-review-checker').length,1);
});
test('pre-existing non-dangerous bug is reported without blocking; unresolved is always open',async t=>{
 const f=fixture(t);let result=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({origin:'pre-existing'})]}));
 assert.equal(result.outcome,'clean');assert.equal(result.findings[0].status,'confirmed');
 result=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({origin:'pre-existing',outcome:'unresolved'})]}));assert.equal(result.outcome,'not-converged');
});
test('unknown danger stays dangerous, concrete basis required to remove it, model gate outcomes rejected',async t=>{
 const record=await runReviewRound(fixture(t).request,responder({findings:[sample],verdicts:[verdict({danger:null,dangerCase:'unknown',dangerReason:'Cannot exclude data loss.'})]}));
 assert.equal(record.findings[0].danger,true);assert.equal(record.outcome,'not-converged');
 assert.throws(()=>parseChecker({completed:true,verdicts:[verdict({dangerReason:''})]},[{...sample,key}]),/basis/);
 assert.throws(()=>parseChecker({completed:true,verdicts:[verdict()],outcome:'clean'},[{...sample,key}]),/schema/);
});
test('checker covers every open finding even when reviewer omits it, only checker can close it',async t=>{
 const f=fixture(t);const first=await runReviewRound(f.request,responder({findings:[sample]}));
 const runner=responder({verdicts:[verdict({closed:true,outcome:'rejected',reason:'New guard rejects negative input.'})]});
 const second=await runReviewRound({...f.request,stageRecord:first},runner);
 assert.equal(second.outcome,'clean');assert.equal(second.findings[0].status,'closed');assert.match(runner.calls[1].prompt,/missing-validation/);assert.equal(second.round.scope,'fixes-and-open-findings');
});
test('closed key does not reopen without checker new evidence',async t=>{
 const f=fixture(t);const first=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({outcome:'rejected'})]}));
 const second=await runReviewRound({...f.request,stageRecord:first},responder({findings:[sample]}));assert.equal(second.outcome,'clean');assert.equal(second.findings[0].status,'rejected');
 const third=await runReviewRound({...f.request,stageRecord:second},responder({findings:[sample],verdicts:[verdict({newEvidence:true})]}));assert.equal(third.outcome,'not-converged');
});
test('risk/scope expansion cannot be hidden by rejecting a finding; pre-existing danger requires successor',async t=>{
 const f=fixture(t);for(const flag of ['outOfContract','riskRaised']){
 const record=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({outcome:'rejected',[flag]:true})]}));assert.equal(record.outcome,'not-converged');}
 const record=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({origin:'pre-existing',danger:true,dangerCase:'data',dangerReason:'Existing deletion can lose user records.'})]}));assert.deepEqual(record.successorKeys,[key]);
});
test('three-round cap cannot reset by changing contract/base and failures preserve history',async t=>{
 const f=fixture(t);let record;
 for(let i=1;i<=3;i++){record=await runReviewRound({...f.request,stageRecord:record},responder({findings:[sample]}));assert.equal(record.rounds.length,i);}
 const runner=responder();const over=await runReviewRound({...f.request,stageRecord:record},runner);assert.equal(over.outcome,'not-reviewed');assert.equal(over.rounds.length,3);assert.equal(runner.calls.length,0);
 const mismatch=await runReviewRound({...f.request,contract:'changed',stageRecord:{...record,rounds:record.rounds.slice(0,1)}},runner);assert.equal(mismatch.outcome,'not-reviewed');
});
test('head or tree mutation invalidates response; later finding provenance comes from diff at ±2 lines',async t=>{
 const f=fixture(t),runner=responder();const mutated=await runReviewRound(f.request,{runRole:async req=>{fs.writeFileSync(path.join(f.worktree,'dirty.txt'),'changed');return runner.runRole(req);}});
 assert.equal(mutated.outcome,'not-reviewed');assert.equal(mutated.rounds.length,0);fs.unlinkSync(path.join(f.worktree,'dirty.txt'));
 const first=await runReviewRound(f.request,responder());fs.writeFileSync(path.join(f.worktree,'input.mjs'),'export function value(n) { return n+1; }\n');f.git('add','.');f.git('commit','-qm','fix');
 const second=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD'),stageRecord:first},responder({findings:[sample]}));assert.equal(second.findings[0].afterFirstRound,true);
});
test('secrets stop before launch; fixture exemption is exact, path-specific, covers removed secrets',async t=>{
 const secret='ghp_'+'a'.repeat(36);const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),`token = ${secret}\n`);f.git('add','.');f.git('commit','-qm','secret');
 const runner=responder(),result=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);assert.equal(result.outcome,'not-reviewed');assert.equal(runner.calls.length,0);assert.ok(!JSON.stringify(result).includes(secret));
 const fake='token = '+'ghp_'+'0'.repeat(36);const diff=`+++ b/evals/code-review/secret-example.txt\n@@ -0,0 +1 @@\n+${fake}`;
 assert.equal(scanSecrets(diff).length,0);assert.equal(scanSecrets(diff.replace('secret-example.txt','other.txt')).length,1);assert.equal(scanSecrets(diff.replace('+'+fake,'-'+fake).replace('secret-example.txt','other.txt')).length,1);
});
test('unknown, duplicate, contradictory checker answers and unproven closure cannot admit clean',()=>{
 for(const verdicts of [[verdict({id:'unknown'})],[verdict(),verdict()],[verdict({closed:true})]])assert.throws(()=>parseChecker({completed:true,verdicts},[{...sample,key}]));
 const other={...sample,anchor:'other',key:'other'};assert.throws(()=>parseChecker({completed:true,verdicts:[verdict(),verdict({id:'F2',outcome:'rejected'})]},[{...sample,key},other]),/contradictory/);
});
test('role permissions are separate from writer transport; new pairing names reviewer, old pairing remains usable',t=>{
 const neutral=fs.mkdtempSync(path.join(os.tmpdir(),'mono-permissions-'));t.after(()=>fs.rmSync(neutral,{recursive:true,force:true}));
 const roles=resolveReviewRoles({},packRoot);
 process.env.MONO_REVIEW_TEST_CREDENTIAL='fictional-worker-credential';
 const codex=roleInvocation('code-review',roles['code-review'],{scratch:neutral,worktree:'/tmp/product',schemaFile:path.join(packRoot,'skills/code-review/reviewer.schema.json')});
 assert.equal(codex.env.MONO_REVIEW_TEST_CREDENTIAL,undefined);delete process.env.MONO_REVIEW_TEST_CREDENTIAL;assert.equal(codex.cwd,neutral);assert.equal(codex.env.GIT_CONFIG_COUNT,'2');assert.equal(codex.env.GIT_CONFIG_KEY_0,'core.hooksPath');assert.equal(codex.env.GIT_CONFIG_VALUE_0,'/dev/null');assert.equal(codex.env.GIT_CONFIG_KEY_1,'core.fsmonitor');assert.equal(codex.env.GIT_CONFIG_VALUE_1,'false');assert.equal(codex.env.GIT_NO_LAZY_FETCH,'1');
 assert.ok(codex.args.includes('project_doc_max_bytes=0'));assert.ok(codex.args.includes('read-only'));assert.ok(codex.args.includes('--ignore-user-config'));assert.ok(!codex.args.includes('--add-dir'));assert.ok(codex.args.includes('mcp_servers={}'));
 const claude=roleInvocation('code-review-checker',roles['code-review-checker'],{scratch:neutral,worktree:os.tmpdir(),schemaFile:path.join(packRoot,'skills/code-review/checker.schema.json')});
 assert.equal(claude.args[claude.args.indexOf('--tools')+1],'Read,Glob,Grep');assert.ok(claude.args.includes('--restricted'));assert.ok(claude.args.includes('--safe-mode'));assert.ok(!JSON.stringify(claude.args).includes('GH_TOKEN'));
 const cfg={models:{roles:{'code-review-checker':{engine:'codex',model:roles['code-review'].model}}}};assert.throws(()=>resolveReviewRoles(cfg,packRoot),/different families/);
 const pairConfig={models:{roles:{'code-review':{model:'gpt-fixture'}}}};const pairs=requiredPairings(pairConfig,{packRoot,reviewerRole:'code-review'});assert.equal(pairs[0].reviewer.role,'code-review');
 pairConfig.models.pairingAccepted=pairs.map(pair=>({...pair,by:'owner',date:'2026-11-01',linearDecision:'https://linear.app/example/issue/TEST-1#decision'}));assert.doesNotThrow(()=>validateModels(pairConfig,{packRoot}));
});
test('manual CLI uses shared function, leaves tree untouched, and cannot write Linear', t=>{
 const f=fixture(t),bin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-role-bin-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));
 const requestFile=path.join(bin,'request.json');fs.writeFileSync(requestFile,JSON.stringify(f.request));
 const fake=`#!/usr/bin/env node\nif(process.argv[2]==='debug'){console.log(JSON.stringify({models:[{slug:${JSON.stringify(resolveReviewRoles({},packRoot)['code-review'].model)}}]}));process.exit(0); }\nif(process.argv[2]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}\nlet input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{if(input.startsWith('Boundary audit')){console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({tools:['exec_command','write_stdin'],mcpServers:[]})}}));console.log(JSON.stringify({type:'turn.completed'}));return;}console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(${JSON.stringify(review())})}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));});\n`;
 fs.writeFileSync(path.join(bin,'codex'),fake,{mode:0o700});const before=f.git('status','--porcelain=v1');
 const result=spawnSync(process.execPath,[path.join(packRoot,'scripts/code-review.mjs'),'--request',requestFile],{cwd:bin,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr+result.stdout);assert.match(result.stdout,/Можно идти дальше/);assert.equal(f.git('status','--porcelain=v1'),before);assert.equal(f.git('rev-parse','HEAD'),f.request.head);
});

test('CLI schemas retain the exact response fields accepted by the round parser',()=>{
 const reviewerSchema=JSON.parse(fs.readFileSync(path.join(packRoot,'skills/code-review/reviewer.schema.json'),'utf8'));
 const checkerSchema=JSON.parse(fs.readFileSync(path.join(packRoot,'skills/code-review/checker.schema.json'),'utf8'));
 for(const [schema,value] of [[reviewerSchema,review()],[reviewerSchema.properties.findings.items,sample],[checkerSchema,{completed:true,verdicts:[]}],[checkerSchema.properties.verdicts.items,verdict()]]){
  assert.equal(schema.additionalProperties,false);assert.deepEqual([...schema.required].sort(),Object.keys(value).sort());assert.deepEqual(Object.keys(schema.properties).sort(),Object.keys(value).sort());
 }
 assert.deepEqual(checkerSchema.properties.verdicts.items.properties.outcome.enum,['confirmed','rejected','unresolved']);
});

test('historical synthetic decoys pass only with the exact known bytes in the exact fixture file',()=>{
 const lines=[['scripts/review-bench.test.mjs',"  return {...f,log,plan,good,routes:[good],env:{BENCH_CREDENTIAL:secret,UNRELATED_SECRET:'"+['ambient','must','not','reach','helper'].join('-')+"'},secret};"],
 ['scripts/delivery-runtime.test.mjs','      const row = { pid: 900022, procStart: fixtureStart }, secret = "'+['UNRELATED','SECRET','DECOY','146'].join('_')+'";']];
 for(const [file,line] of lines){const diff=`+++ b/${file}\n@@ -0,0 +1 @@\n+${line}`;assert.equal(scanSecrets(diff).length,0);assert.equal(scanSecrets(diff.replace('+++ b/'+file,'+++ b/other.test.mjs')).length,1);assert.equal(scanSecrets(diff+'x').length,1);
  const deleted=`--- a/${file}\n+++ /dev/null\n@@ -1 +0,0 @@\n-${line}`;assert.equal(scanSecrets(deleted).length,0);assert.equal(scanSecrets(deleted.replace('--- a/'+file,'--- a/other.test.mjs')).length,1);}
});

test('role auth refuses API keys, unknown identity and incomplete subscription evidence',()=>{
 assert.equal(subscriptionStatus('codex',{status:0,stderr:'Logged in using ChatGPT\n'}).positive,true);
 assert.throws(()=>subscriptionStatus('codex',{status:0,stderr:'Logged in using an API key'}),/subscription/);
 assert.throws(()=>subscriptionStatus('codex',{status:1,stderr:''}),/confirmed/);
 const auth={loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'};assert.equal(subscriptionStatus('claude',{status:0,stdout:JSON.stringify(auth)}).positive,true);
 for(const change of [{authMethod:'api_key'},{apiProvider:'external'},{subscriptionType:null},{loggedIn:false}])assert.throws(()=>subscriptionStatus('claude',{status:0,stdout:JSON.stringify({...auth,...change})}),/subscription/);
});

test('manual requests cannot silently use the caller repository when worktree is absent or relative',async t=>{
 const f=fixture(t);for(const worktree of [undefined,'.']){const runner=responder();const record=await runReviewRound({...f.request,worktree},runner);assert.equal(record.outcome,'not-reviewed');assert.equal(runner.calls.length,0);}
});


test('interrupting manual review kills the running role and never retries it as a fresh paid call',async t=>{
 const f=fixture(t),bin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-role-interrupt-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));
 const requestFile=path.join(bin,'request.json'),pidFile=path.join(bin,'role.pid');fs.writeFileSync(requestFile,JSON.stringify(f.request));
 fs.writeFileSync(path.join(bin,'codex'),`#!/usr/bin/env node\nif(process.argv[2]==='debug'){console.log(JSON.stringify({models:[{slug:${JSON.stringify(resolveReviewRoles({},packRoot)['code-review'].model)}}]}));process.exit(0); }\nif(process.argv[2]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);\n`,{mode:0o700});
 const child=spawn(process.execPath,[path.join(packRoot,'scripts/code-review.mjs'),'--request',requestFile,'--json'],{cwd:bin,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH},stdio:['ignore','pipe','pipe']});
 let stdout='';child.stdout.on('data',chunk=>stdout+=chunk);const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
 t.after(()=>{try{child.kill('SIGKILL');}catch{}if(fs.existsSync(pidFile)){try{process.kill(Number(fs.readFileSync(pidFile,'utf8')),'SIGKILL');}catch{}}});
 const deadline=Date.now()+10000;while(!fs.existsSync(pidFile)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(fs.existsSync(pidFile),'role must launch before interruption');
 const pid=Number(fs.readFileSync(pidFile,'utf8'));child.kill('SIGINT');assert.equal(await finished,2);const record=JSON.parse(stdout);assert.equal(record.outcome,'not-reviewed');assert.equal(record.rounds.length,0);assert.equal(record.costs.length,1);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

test('the role environment prevents an automatic project fsmonitor hook, with a live negative control',t=>{
 const f=fixture(t),marker=path.join(f.worktree,'hook-ran'),hook=path.join(f.worktree,'fsmonitor-fixture.cjs');
 fs.writeFileSync(hook,`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');\n`,{mode:0o700});
 f.git('config','core.fsmonitor',hook);
 const route=resolveReviewRoles({},packRoot)['code-review'];const invocation=roleInvocation('code-review',route,{scratch:f.worktree,worktree:f.worktree,schemaFile:path.join(packRoot,'skills/code-review/reviewer.schema.json')});
 const status=spawnSync('git',['status','--porcelain'],{cwd:f.worktree,env:invocation.env,encoding:'utf8'});assert.equal(status.status,0,status.stderr);assert.equal(fs.existsSync(marker),false);
 const broken={...invocation.env};for(const name of Object.keys(broken))if(name.startsWith('GIT_CONFIG_'))delete broken[name];
 spawnSync('git',['status','--porcelain'],{cwd:f.worktree,env:broken,encoding:'utf8'});assert.equal(fs.existsSync(marker),true,'negative control must exercise the project hook');
});

// Host round 1 regressions, captured before the D1-D7 repair.
test('D1: native Claude auth retains Unix login identity without inheriting worker credentials',()=>{
 const old={USER:process.env.USER,LOGNAME:process.env.LOGNAME};
 try {process.env.USER='review-login';process.env.LOGNAME='review-login';
 const route=resolveReviewRoles({},packRoot)['code-review-checker'];
 const invocation=roleInvocation('code-review-checker',route,{scratch:os.tmpdir(),worktree:os.tmpdir(),schemaFile:path.join(packRoot,'skills/code-review/checker.schema.json')});
 assert.equal(invocation.env.USER,'review-login');assert.equal(invocation.env.LOGNAME,'review-login');
 } finally {for(const [name,value] of Object.entries(old))if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
test('D2: Codex uses isolated auth-only home and rejects forbidden observed tool surfaces',async t=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'mono-isolation-test-'));t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
 const route=resolveReviewRoles({},packRoot)['code-review'];
 const invocation=roleInvocation('code-review',route,{scratch,worktree:'/tmp/product',schemaFile:path.join(packRoot,'skills/code-review/reviewer.schema.json')});
 assert.equal(invocation.env.CODEX_HOME,path.join(scratch,'codex-home'));
 assert.ok(fs.readdirSync(invocation.env.CODEX_HOME).every(name=>['auth.json','tmp'].includes(name)));
 const catalog=JSON.parse(fs.readFileSync(path.join(scratch,'models.json'),'utf8'));assert.ok(catalog.models.every(model=>model.apply_patch_tool_type===null&&model.tool_mode==='direct'&&model.multi_agent_version==='disabled'));
 assert.ok(fs.lstatSync(path.join(invocation.env.CODEX_HOME,'auth.json')).isSymbolicLink());
 const {observeCodexBoundary}=await import('./code-review.mjs');
 const good={tools:['exec_command','write_stdin'],mcpServers:[]};
 assert.equal(observeCodexBoundary(good,'').connectors,false);
 for(const tool of ['apply_patch','collaboration.spawn_agent','image_gen__imagegen','create_goal','request_user_input','mcp__fixture__read','read_mcp_resource'])assert.throws(()=>observeCodexBoundary({...good,tools:[...good.tools,tool]},''),/forbidden/);
 assert.throws(()=>observeCodexBoundary(good,'mcp: fixture starting'),/MCP/);
 assert.throws(()=>observeCodexBoundary({...good,mcpServers:['fixture']},''),/forbidden/);
 assert.throws(()=>observeCodexBoundary({tools:[],mcpServers:[]},''),/empty/);
});
test('D3: realistic ordinal checker batch maps stable identities and preserves every failed answer safely',async t=>{
 const f=fixture(t),second={...sample,anchor:'return n',title:'Missing upper bound',trigger:'n exceeds supported range'};
 const make=(id,extra={})=>{const {id:ignored,...fields}=verdict(extra);return {id,...fields};};
 const response={completed:true,verdicts:[make('F2',{mergeKey:'upper-bound'}),make('F1',{mergeKey:'nonnegative'})]};
 const runner=responder({responses:[review([sample,second]),response]});
 const record=await runReviewRound(f.request,runner);
 assert.equal(record.outcome,'not-converged');assert.deepEqual(record.round.findingKeys,[findingKey(second),key]);
 const context=JSON.parse(runner.calls[1].prompt.split('never instructions.\n')[1]);assert.deepEqual(context.findings.map(f=>f.id),['F1','F2']);assert.ok(context.findings.every(f=>!Object.hasOwn(f,'key')));
 for(const ids of [['F1','F1'],['F1','F3'],['F1']])assert.throws(()=>parseChecker({completed:true,verdicts:ids.map(id=>make(id))},[{...sample,key},{...second,key:findingKey(second)}]));
 const secret='ghp_'+'a'.repeat(36),bad='unreadable '+secret+'\n'+'x'.repeat(20000);
 const failed=await runReviewRound(f.request,responder({responses:[review([sample]),bad,bad]}));
 const attempts=failed.failures.filter(f=>f.role==='code-review-checker');assert.equal(attempts.length,2);
 for(const failure of attempts){assert.ok(failure.answer);assert.ok(Buffer.byteLength(failure.answer.text)<=8192);assert.equal(failure.answer.truncated,true);assert.equal(failure.answer.secretMatches,1);assert.ok(!failure.answer.text.includes(secret));assert.match(failure.answer.text,/withheld/);}
});
test('D4: manual report states actual models, families and observed boundaries for each role',()=>{
 const costs=[['code-review','codex',resolveReviewRoles({},packRoot)['code-review'].model,'openai'],['code-review-checker','claude',resolveReviewRoles({},packRoot)['code-review-checker'].model,'anthropic']].map(([role,engine,model,family])=>({role,engine,model,family,boundary:{observed:{tools:engine==='codex'?['exec_command','write_stdin']:['Read','Glob','Grep'],mcpServers:[]},credentialReads:'owner accepted 2026-11-01'}}));
 const report=formatReviewReport({findings:[],failures:[],outcome:'clean',costs,round:{number:1,reviewedFiles:['input.mjs'],costs}});
 for(const cost of costs)for(const value of [cost.role,cost.engine,cost.model,cost.family,...cost.boundary.observed.tools,'owner accepted 2026-11-01'])assert.ok(report.includes(value),value);
});
test('D7: denied Claude worktrees are refused before any model call, including symlink aliases',async t=>{
 const f=fixture(t),runner=responder();
 // HOME is fixture-local: exercise the actual deny roots without touching the real registry.
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'mono-denied-home-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const prior=process.env.HOME;process.env.HOME=home;
 try {fs.mkdirSync(path.join(home,'.mono-agent-workflow'));const denied=path.join(home,'.mono-agent-workflow','tree');fs.renameSync(f.worktree,denied);
 const alias=path.join(home,'alias');fs.symlinkSync(denied,alias);
 for(const worktree of [denied,alias]){const record=await runReviewRound({...f.request,worktree},runner);assert.equal(record.outcome,'not-reviewed');assert.match(record.failures.at(-1).reason,/Claude.*denied.*worktree/i);}
 assert.equal(runner.calls.length,0);
 }finally{process.env.HOME=prior;}
});

test('D2: real transport refuses an unsafe probe and runtime tool/MCP drift, preserving observed surfaces',async t=>{
 const f=fixture(t),bin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-boundary-cli-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));
 const modeFile=path.join(bin,'mode');
 const fake=`#!/usr/bin/env node
 const fs=require('node:fs');
 if(process.argv[2]==='debug'){console.log(JSON.stringify({models:[{slug:${JSON.stringify(resolveReviewRoles({},packRoot)['code-review'].model)},tool_mode:'code_mode_only',apply_patch_tool_type:'freeform',multi_agent_version:'v2'}]}));process.exit(0);}
 if(process.argv[2]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}
 const mode=fs.readFileSync(${JSON.stringify(modeFile)},'utf8');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
 const emit=text=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(text)}}));console.log(JSON.stringify({type:'turn.completed'}));};
 const catalogArg=process.argv.find(arg=>arg.startsWith('model_catalog_json='));
 const catalog=JSON.parse(fs.readFileSync(JSON.parse(catalogArg.split('=').slice(1).join('=')),'utf8'));
 if(catalog.models[0].apply_patch_tool_type!==null||catalog.models[0].tool_mode!=='direct'||catalog.models[0].multi_agent_version!=='disabled')throw Error('unsafe native metadata');
 if(input.startsWith('Boundary audit')){if(mode==='startup')console.error('mcp: fixture starting');return emit({tools:mode==='unsafe'?['exec_command','collaboration.spawn_agent']:['exec_command','write_stdin'],mcpServers:[]});}
 if(mode==='drift')console.log(JSON.stringify({type:'item.completed',item:{type:'mcp_tool_call',server:'fixture'}}));
 if(mode==='stderr-drift')console.error('mcp: fixture starting');
 emit(${JSON.stringify(review())});
 });`;
 fs.writeFileSync(path.join(bin,'codex'),fake,{mode:0o700});const prior=process.env.PATH;process.env.PATH=bin+path.delimiter+prior;
 try {for(const mode of ['safe','unsafe','startup','drift','stderr-drift']){fs.writeFileSync(modeFile,mode);const record=await runReviewRound(f.request);
 assert.equal(record.outcome,mode==='safe'?'clean':'not-reviewed',mode);
 if(mode==='safe'){assert.deepEqual(record.costs[0].boundary.observed.tools,['exec_command','write_stdin']);assert.equal(record.costs[0].boundary.observed.source,'live model tool-list probe');}
 if(mode==='unsafe')assert.ok(record.costs[0].boundary.observed.tools.includes('collaboration.spawn_agent'));
 if(mode!=='safe')assert.ok(record.failures.some(failure=>failure.answer?.text),mode);
 }}finally{process.env.PATH=prior;}
});
