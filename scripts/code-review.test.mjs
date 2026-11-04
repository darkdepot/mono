import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound, parseChecker, findingKey, scanSecrets, formatReviewReport, resolveReviewRoles, roleInvocation, subscriptionStatus, screenModelOutput } from './code-review.mjs';
import { requiredPairings, validateModels } from './runtime.mjs';
import { scoreCheckerProbes } from './code-review-eval.mjs';
const packRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let catalogBin, originalPath;
before(()=>{
 catalogBin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-recorded-catalog-'));originalPath=process.env.PATH;
 const model=resolveReviewRoles({},packRoot)['code-review'].model;
 fs.writeFileSync(path.join(catalogBin,'codex'),`#!${process.execPath}\nif(process.argv.slice(2).join(' ')!=='debug models --bundled')process.exit(98);console.log(JSON.stringify({models:[{slug:${JSON.stringify(model)},tool_mode:'code_mode_only',apply_patch_tool_type:'freeform',multi_agent_version:'v2'}]}));\n`,{mode:0o700});
 process.env.PATH=catalogBin+path.delimiter+originalPath;
});
after(()=>{process.env.PATH=originalPath;fs.rmSync(catalogBin,{recursive:true,force:true});});
const sample={class:'missing-validation',file:'input.mjs',anchor:'return value',line:1,title:'Invalid input is accepted',trigger:'value is negative',evidence:'input.mjs returns value without validation'};
const transcripts=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/recorded-responses.json'),'utf8'));
const dangerControls=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/round2-checker-regressions.json'),'utf8'));
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
test('C1: checker instructions forbid visible damage and downstream safeguards as danger exemptions within 4 KiB',()=>{
 const prompt=fs.readFileSync(path.join(packRoot,'skills/code-review/checker.md'),'utf8');
 assert.ok(Buffer.byteLength(prompt)<=4096);
 for(const rule of ['visibility','inspectability','recognizable placeholder','downstream fail-closed','each R7 category'])assert.ok(prompt.includes(rule),rule);
});
test('C1: four recorded danger-removal shapes fail calibration; corrected controls block successors and report danger',async t=>{
 assert.deepEqual(dangerControls.cases.map(item=>item.goldCase),['23','18','18','40']);
 for(const item of dangerControls.cases)await t.test(item.id,async t=>{
  const key=findingKey(item.finding),parse=value=>parseChecker({completed:true,verdicts:[value]},[{...item.finding,key}]).verdicts[0];
  const expected=parse(item.correctedControl),observed=parse(item.observedVerdict);
  const gold=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/cases.json'),'utf8')).cases.find(gold=>gold.id===item.goldCase);
  assert.equal(expected.dangerCase,gold.dangerCase);
  assert.equal(scoreCheckerProbes([expected],[observed]).releaseBlocked,true);
  assert.equal(scoreCheckerProbes([expected],[expected]).releaseBlocked,false);
  const f=fixture(t);let record;
  for(let i=0;i<3;i++)record=await runReviewRound({...f.request,stageRecord:record},responder({findings:[item.finding],verdicts:[item.correctedControl]}));
  assert.equal(record.rounds.length,3);assert.equal(record.outcome,'not-converged');assert.deepEqual(record.successorKeys,[]);
  assert.equal(record.findings[0].danger,true);assert.equal(record.findings[0].dangerCase,expected.dangerCase);
  assert.match(formatReviewReport(record),/опасность/);assert.ok(!formatReviewReport(record).includes('неопасное'));
 });
});
test('C3: native Claude streams retain init, fallback and modelUsage identities for either role and failures',async t=>{
 const f=fixture(t),bin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-served-models-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));
 const stream=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/round2-model-stream.json'),'utf8'));
 const modeFile=path.join(bin,'mode');fs.writeFileSync(modeFile,'success');
 const fake=`#!${process.execPath}
 const fs=require('node:fs');if(process.argv.includes('auth')){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}));process.exit(0);}
 let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
 const emit=o=>console.log(JSON.stringify(o));emit(${JSON.stringify(stream.init)});
 for(const event of ${JSON.stringify(stream.fallbacks)})emit(event);
 if(fs.readFileSync(${JSON.stringify(modeFile)},'utf8')==='failure')process.exit(1);
 emit({type:'result',subtype:'success',is_error:false,structured_output:input.includes('# Finding checker')?${JSON.stringify({completed:true,verdicts:[verdict()]})}:${JSON.stringify(review([sample]))},modelUsage:${JSON.stringify(stream.modelUsage)}});});`;
 const roles=resolveReviewRoles({},packRoot);
 const codex=`#!${process.execPath}\nif(process.argv[2]==='debug'){console.log(JSON.stringify({models:[{slug:${JSON.stringify(roles['code-review'].model)},tool_mode:'code_mode_only',apply_patch_tool_type:'freeform',multi_agent_version:'v2'}]}));process.exit(0);}if(process.argv[2]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const value=input.startsWith('Boundary audit')?{tools:['exec_command','write_stdin'],mcpServers:[]}:input.includes('# Finding checker')?${JSON.stringify({completed:true,verdicts:[verdict()]})}:${JSON.stringify(review([sample]))};console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}}));console.log(JSON.stringify({type:'turn.completed'}));});`;
 fs.writeFileSync(path.join(bin,'claude'),fake,{mode:0o700});fs.writeFileSync(path.join(bin,'codex'),codex,{mode:0o700});
 const prior=process.env.PATH;process.env.PATH=bin+path.delimiter+prior;
 const config={models:{roles:{'code-review':{engine:'claude',model:roles['code-review-checker'].model},'code-review-checker':{engine:'codex',model:roles['code-review'].model}}}};
 const producer=requiredPairings(config,{packRoot,reviewerRole:'code-review'});config.models.pairingAccepted=producer.map(pair=>({...pair,by:'owner',date:'2026-11-04',linearDecision:'https://linear.app/example/issue/TEST-1#decision'}));
 try{
  for(const cfg of [{},config])for(const mode of ['success','failure']){fs.writeFileSync(modeFile,mode);
   const record=await runReviewRound({...f.request,config:cfg});const boundary=record.costs.find(cost=>cost.role===(cfg===config?'code-review':'code-review-checker')).boundary;
   assert.deepEqual(boundary.servedModels,mode==='failure'?stream.expectedBeforeResult:stream.expectedAfterResult);
   assert.ok(boundary.modelObservations.some(item=>item.source==='init'));
   assert.ok(boundary.modelObservations.some(item=>item.source==='fallback.fallback_model'));
   if(mode==='success')assert.ok(boundary.modelObservations.some(item=>item.source==='modelUsage.canonicalModel'));
   for(const model of boundary.servedModels)assert.ok(formatReviewReport(record).includes(model));
   assert.equal(record.outcome,mode==='failure'?'not-reviewed':'not-converged');
  }
 }finally{process.env.PATH=prior;}
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
test('host Git reads never execute external diff or textconv helpers, including rounds two and three provenance',async t=>{
 for(const driver of ['external','textconv'])await t.test(driver,async t=>{
  const f=fixture(t),tools=fs.mkdtempSync(path.join(os.tmpdir(),'mono-host-git-'));
  t.after(()=>fs.rmSync(tools,{recursive:true,force:true}));
  const marker=path.join(f.worktree,'unexpected-helper-write'),helper=path.join(tools,'helper');
  fs.writeFileSync(helper,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'called');\n`,{mode:0o700});
  if(driver==='textconv'){
   fs.writeFileSync(path.join(f.worktree,'.git/info/attributes'),'input.mjs diff=probe\n');
   f.git('config','diff.probe.textconv',helper);
  }else f.git('config','diff.external',helper);
  // Positive control: this repository really has an executable diff driver.
  f.git('diff',f.request.base,f.request.head,'--','input.mjs');assert.ok(fs.existsSync(marker));fs.unlinkSync(marker);
  let record=await runReviewRound(f.request,responder());assert.equal(record.outcome,'clean');
  for(const round of [2,3]){
   fs.appendFileSync(path.join(f.worktree,'input.mjs'),`// round ${round}\n`);f.git('add','.');f.git('commit','-qm',`head ${round}`);
   const finding={...sample,anchor:`round ${round}`,line:round};
   const verdicts=[...record.findings,finding].map((item,index)=>verdict({id:`F${index+1}`,origin:'pre-existing',mergeKey:findingKey(item)}));
   const runner=responder({findings:[finding],verdicts});
   record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD'),stageRecord:record},runner);
   assert.equal(record.outcome,'clean');assert.equal(record.rounds.length,round);
   assert.equal(fs.existsSync(marker),false,`${driver} ran on host in round ${round}`);
   assert.equal(f.git('status','--porcelain=v1'),'');
  }
 });
});
test('forced Git color cannot hide multiline patch secrets before model launch',async t=>{
 for(const setting of ['color.diff','color.ui'])await t.test(setting,async t=>{
  const f=fixture(t),secret='opaqueFixture'+'c'.repeat(24);
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),`password =\n"${secret}"\n`);
  f.git('add','.');f.git('commit','-qm','multiline credential');const head=f.git('rev-parse','HEAD');
  f.git('config',setting,'always');
  const colored=f.git('diff',f.request.base,head);assert.match(colored,/\u001b\[/);
  const runner=responder(),result=await runReviewRound({...f.request,head},runner);
  assert.equal(runner.calls.length,0);assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);
  assert.ok(result.secrets.length);assert.ok(!JSON.stringify(result).includes(secret));
 });
});
test('host Git isolation disables content filters and drivers before every worktree read',async t=>{
 for(const driver of ['clean','process'])for(const late of [false,true])await t.test(`${driver}/${late?'during':'before'}`,async t=>{
  const f=fixture(t),marker=path.join(f.worktree,'.git','host-ran');
  fs.writeFileSync(path.join(f.worktree,'.gitattributes'),'input.mjs filter=probe diff=probe merge=probe\n');
  fs.writeFileSync(path.join(f.worktree,'witness.txt'),'original tracked bytes\n');
  fs.writeFileSync(path.join(f.worktree,'helper.cjs'),`const fs=require('node:fs');fs.writeFileSync('.git/host-ran','executed');fs.writeFileSync('witness.txt','host changed tracked bytes');${driver==='process'?'process.exit(1);':"process.stdout.write(fs.readFileSync(0));"}\n`);
  f.git('add','.');f.git('commit','-qm','tracked filter helper');const head=f.git('rev-parse','HEAD');
  const command=`${process.execPath} helper.cjs`;
  fs.writeFileSync(path.join(f.worktree,'.git','included-config'),`[filter "probe"]\n ${driver} = ${command}\n required = true\n[diff "probe"]\n command = ${command}\n textconv = ${command}\n[merge "probe"]\n driver = ${command}\n`);
  const configure=()=>{f.git('config','include.path','included-config');const time=new Date(Date.now()+5000);fs.utimesSync(path.join(f.worktree,'input.mjs'),time,time);};
  if(!late)configure();
  const runner=responder({responses:[review([],['input.mjs','.gitattributes','witness.txt','helper.cjs'])]});
  const result=await runReviewRound({...f.request,head},{runRole:async request=>{const answer=await runner.runRole(request);if(late)configure();return answer;}});
  assert.equal(fs.existsSync(marker),false,'repository helper executed on the host');
  assert.equal(fs.readFileSync(path.join(f.worktree,'witness.txt'),'utf8'),'original tracked bytes\n');
  assert.equal(result.outcome,'clean');assert.equal(runner.calls.length,1);
 });
});
test('host Git isolation refuses helper names that cannot be represented by a config override',async t=>{
 const f=fixture(t),marker=path.join(f.worktree,'.git','host-ran');
 fs.writeFileSync(path.join(f.worktree,'.gitattributes'),'input.mjs filter=probe=hidden\n');
 fs.writeFileSync(path.join(f.worktree,'helper.cjs'),"require('node:fs').writeFileSync('.git/host-ran','executed');process.stdout.write(require('node:fs').readFileSync(0));\n");
 f.git('add','.');f.git('commit','-qm','ambiguous helper name');const head=f.git('rev-parse','HEAD');
 f.git('config','filter.probe=hidden.clean',`${process.execPath} helper.cjs`);
 const time=new Date(Date.now()+5000);fs.utimesSync(path.join(f.worktree,'input.mjs'),time,time);
 const runner=responder(),result=await runReviewRound({...f.request,head},runner);
 assert.equal(fs.existsSync(marker),false);assert.equal(result.outcome,'not-reviewed');assert.equal(runner.calls.length,0);
 assert.match(result.failures.at(-1).reason,/unsupported Git helper name/);
});
test('host Git isolation screens both pinned blobs even when attributes hide their diff',async t=>{
 for(const attribute of ['-diff','binary','diff=hidden'])for(const side of ['added','removed'])await t.test(`${attribute}/${side}`,async t=>{
  const f=fixture(t),secret='opaqueFixture'+'b'.repeat(24),credential=`password =\n"${secret}"\n`,safe='export const safe = 1;\n';
  fs.writeFileSync(path.join(f.worktree,'.gitattributes'),`input.mjs ${attribute}\n`);
  f.git('config','diff.hidden.binary','true');
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),side==='removed'?credential:safe);f.git('add','.');f.git('commit','-qm','before hidden diff');const base=f.git('rev-parse','HEAD');
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),side==='added'?credential:safe);f.git('add','.');f.git('commit','-qm','after hidden diff');const head=f.git('rev-parse','HEAD');
  assert.ok(!f.git('diff',base,head).includes(secret),'positive control must suppress the text');
  const runner=responder(),result=await runReviewRound({...f.request,base,head},runner);
  assert.equal(runner.calls.length,0);assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);
  assert.ok(result.secrets.length);assert.ok(!JSON.stringify(result).includes(secret));
 });
});
test('host Git isolation refuses opaque blob bytes before a role can read them',async t=>{
 for(const bytes of [Buffer.from([0,65,66]),Buffer.from([0xff,0xfe,65])])await t.test(bytes.toString('hex'),async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),bytes);f.git('add','.');f.git('commit','-qm','opaque blob');
  const runner=responder(),result=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);
  assert.equal(result.outcome,'not-reviewed');assert.equal(runner.calls.length,0);assert.equal(result.rounds.length,0);
 });
});
test('host Git isolation refuses index hints initially and if introduced during a round',async t=>{
 for(const flag of ['--assume-unchanged','--skip-worktree'])for(const late of [false,true])await t.test(`${flag}/${late?'during':'before'}`,async t=>{
  const f=fixture(t),runner=responder(),hide=()=>{f.git('update-index',flag,'input.mjs');fs.writeFileSync(path.join(f.worktree,'input.mjs'),'export function value(n) { return 0; }\n');};
  if(!late){hide();assert.equal(f.git('status','--porcelain'),'');assert.equal(f.git('diff','HEAD'),'');}
  const result=await runReviewRound(f.request,{runRole:async request=>{const answer=await runner.runRole(request);if(late)hide();return answer;}});
  assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);assert.equal(runner.calls.length,late?1:0);
 });
});
test('failed answers redact multiline assignments even alongside other secrets, before retention',async t=>{
 const f=fixture(t),password='x'.repeat(24),second='y'.repeat(25),token='ghp_'+'z'.repeat(36);
 for(const bad of [`password =\n${password}\n${token}\n"access_token":\n"${second}"`,`${token}\nsecret =\n${second}\npassword =\n${password}`]){
  const result=await runReviewRound(f.request,responder({responses:[review([sample]),bad,bad]}));
  assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);
  const failures=result.failures.filter(failure=>failure.role==='code-review-checker');assert.equal(failures.length,2);
  for(const {answer} of failures){
   for(const secret of [password,second,token])assert.ok(!answer.text.includes(secret),'failed answer retained a secret');
   assert.equal(scanSecrets(answer.text,{patch:false}).length,0);assert.ok(Buffer.byteLength(answer.text)<=8192);assert.ok(answer.secretMatches>=2);
  }
  assert.ok(scanSecrets(bad,{patch:false}).some(match=>match.reason.includes('multiline')));
 }
});
test('shared model screen preserves benign JSON/code and exact fixture exceptions without retaining values',async t=>{
 const safe={summary:'[P2] Inspect function value(n) { return n; }',quotes:['A safe quote.'],nested:JSON.stringify({note:'Literal JSON diagnostic'})};
 const screened=screenModelOutput(safe);assert.equal(screened.rejected,false);assert.deepEqual(screened.value,safe);
 const f=fixture(t),file='evals/code-review/secret-example.txt',fake='token = '+'ghp_'+'0'.repeat(36);
 const finding={...sample,file,evidence:fake},runner=responder({findings:[finding],responses:[JSON.stringify(review([finding])),JSON.stringify({completed:true,verdicts:[verdict({origin:'pre-existing',reason:fake})]})]});
 const record=await runReviewRound(f.request,runner);assert.equal(record.outcome,'clean');assert.equal(runner.calls.length,2);
 assert.ok(!JSON.stringify(record).includes(fake));assert.ok(!formatReviewReport(record).includes(fake));
 for(const value of [{summary:JSON.stringify({password:'opaqueFixture'+'z'.repeat(24)})},JSON.stringify({reason:'ghp_'+'q'.repeat(36)})]){
  const screened=screenModelOutput(value);assert.equal(screened.rejected,true);assert.equal(screenModelOutput(screened.value).rejected,false,'sanitized state is safe to persist and read back');
 }
});
test('numeric-looking secret strings keep their literal bytes through every JSON layer',async t=>{
 const f=fixture(t),secret='1'.repeat(24);
 for(const depth of [0,1,2]){
  let reason={password:secret};for(let layer=0;layer<depth;layer++)reason=JSON.stringify(reason);
  const runner=responder({findings:[sample],verdicts:[verdict({reason:typeof reason==='string'?reason:JSON.stringify(reason)})]});
  const record=await runReviewRound(f.request,runner);
  assert.equal(record.outcome,'not-reviewed');assert.equal(record.rounds.length,0);assert.ok(!JSON.stringify(record).includes(secret));
 }
});
test('all model output is screened before successful fields, metadata or derived reports escape',async t=>{
 const f=fixture(t),secret='opaqueFixture'+'v'.repeat(24),encoded=JSON.stringify(JSON.stringify({password:secret}));
 const cases=[
  ...['class','file','anchor','title','trigger','evidence','key'].map(field=>({role:'code-review',field})),
  ...['id','outcome','weight','dangerCase','origin','reason','dangerReason','mergeKey'].map(field=>({role:'code-review-checker',field})),
  ...['summary','quotes','findings','arbitraryFutureField'].map(field=>({role:'code-review-checker',field,extra:true})),
  ...['usage','boundary'].map(field=>({role:'code-review-checker',field,metadata:true})),
  {role:'code-review',field:'reviewedFiles',inventory:true},{role:'code-review-checker',field:'property-name',property:true},
 ];
 for(const item of cases)await t.test(`${item.role}/${item.field}`,async()=>{
  const prompts=[];
  const result=await runReviewRound(f.request,{runRole:async request=>{
   prompts.push(request.prompt);let response=request.role==='code-review'?review([{...sample}]):{completed:true,verdicts:[verdict()]};
   const result={response,usage:{input_tokens:1},boundary:{servedModels:['safe-model']}};
   if(request.role===item.role){
    if(item.inventory)response.reviewedFiles=[encoded];
    else if(item.property)response['ghp_'+'v'.repeat(36)]=encoded;
    else if(item.metadata)result[item.field]={summary:encoded,quotes:[encoded]};
    else if(item.extra)response[item.field]={quotes:[encoded]};
    else (item.role==='code-review'?response.findings[0]:response.verdicts[0])[item.field]=encoded;
   }
   return result;
  }});
  assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);
  assert.ok(!JSON.stringify(result).includes(secret),'model output escaped into returned state');
  assert.ok(!formatReviewReport(result).includes(secret),'model output escaped into rendered report');
  assert.ok(prompts.every(prompt=>!prompt.includes(secret)),'model output escaped into another role prompt');
 });
});
test('all model output is screened on failed fields and legacy records before reports or new launches',async t=>{
 const f=fixture(t),secret='ghp_'+'w'.repeat(36);
 for(const field of ['message','rawAnswer','boundary'])await t.test(`failed/${field}`,async()=>{
  const result=await runReviewRound(f.request,{runRole:async()=>{throw Object.assign(new Error(field==='message'?secret:'transport failed'),{[field]:field==='boundary'?{model:secret,summary:secret,quotes:[secret]}:secret});}});
  assert.equal(result.outcome,'not-reviewed');assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!formatReviewReport(result).includes(secret));
 });
 for(const field of ['summary','quotes','findings','costs','failures'])await t.test(`legacy/${field}`,async()=>{
  const record={rounds:[],findings:[],failures:[],summary:'safe',quotes:[],costs:[],outcome:'clean'};
  if(field==='findings')record.findings=[{...sample,key,status:'confirmed',weight:'P2',reason:secret}];
  else if(field==='costs')record.costs=[{role:secret,boundary:{servedModels:[secret]}}];
  else if(field==='failures')record.failures=[{reason:secret,answer:{text:secret}}];
  else record[field]=field==='quotes'?[secret]:secret;
  assert.ok(!formatReviewReport(record).includes(secret),'legacy record bypassed report screening');
  const runner=responder(),result=await runReviewRound({...f.request,stageRecord:record},runner);
  assert.equal(result.outcome,'not-reviewed');assert.equal(runner.calls.length,0);assert.ok(!JSON.stringify(result).includes(secret));
 });
});
test('patch multiline assignments stop before any role, on both sides and across context lines',async t=>{
 for(const shape of ['added','removed','context'])await t.test(shape,async t=>{
  const f=fixture(t),secret='opaqueFixture'+'x'.repeat(24);
  const before=shape==='added'?'export const safe = 1;\n':`password =\n"${shape==='context'?'short':secret}"\n`;
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),before);f.git('add','.');f.git('commit','-qm','before assignment');const base=f.git('rev-parse','HEAD');
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),shape==='removed'?'export const safe = 2;\n':`password =\n"${secret}"\n`);
  f.git('add','.');f.git('commit','-qm','assignment change');const head=f.git('rev-parse','HEAD'),runner=responder();
  const result=await runReviewRound({...f.request,base,head},runner);
  assert.equal(result.outcome,'not-reviewed');assert.equal(runner.calls.length,0);assert.equal(result.rounds.length,0);
  assert.ok(result.secrets.length);assert.ok(!JSON.stringify(result).includes(secret));
 });
});
test('failed transport answers decode JSONL and object fields before redaction, withholding malformed envelopes',async t=>{
 const f=fixture(t),secret='opaqueFixture'+'z'.repeat(24),assignment=`password =\n"${secret}"`;
 const bad=[
  JSON.stringify({type:'assistant',message:{content:[{type:'text',text:assignment}]}})+'\n',
  JSON.stringify({type:'thread.started',thread_id:'fixture'})+'\n'+JSON.stringify({type:'item.completed',item:{type:'agent_message',text:assignment}})+'\n',
  'diagnostic prefix\n'+JSON.stringify({type:'result',result:`"access_token": "${secret}"`}),
  {completed:false,diagnostic:{password:secret}},
  '{"type":"assistant","text":"password = \\"'+secret,
  JSON.stringify({message:{content:assignment}},null,2).slice(0,-1),
 ];
 for(const rawAnswer of bad){
  const result=await runReviewRound(f.request,{runRole:async()=>{throw Object.assign(new Error('role failed (1)'),{rawAnswer});}});
  const failures=result.failures.filter(failure=>failure.answer);assert.equal(failures.length,2);
  assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);
  for(const {answer} of failures){assert.ok(!answer.text.includes(secret),'decoded secret survived retention');assert.ok(Buffer.byteLength(answer.text)<=8192);}
 }
 const safe=JSON.stringify({type:'assistant',message:{content:[{text:'Safe diagnostic for the operator'}]}})+'\n';
 const result=await runReviewRound(f.request,{runRole:async()=>{throw Object.assign(new Error('role failed (1)'),{rawAnswer:safe});}});
 assert.match(result.failures[0].answer.text,/Safe diagnostic for the operator/);
});
test('failed answers decode every embedded JSON string layer before retaining either attempt',async t=>{
 const f=fixture(t),secret='opaqueFixture'+'q'.repeat(24);
 for(const depth of [1,2,3])await t.test(`encoding layers ${depth}`,async()=>{
  let text=JSON.stringify({completed:true,findings:[{evidence:`password = "${secret}"`,note:'Safe decoded diagnostic'}]});
  for(let layer=1;layer<depth;layer++)text=JSON.stringify({item:{text:JSON.stringify({text})}});
  const rawAnswer=JSON.stringify({type:'thread.started'})+'\n'+JSON.stringify({type:'item.completed',item:{type:'agent_message',text}})+'\n';
  let attempts=0;
  const result=await runReviewRound(f.request,{runRole:async()=>{attempts++;throw Object.assign(new Error('transport failed'),{rawAnswer});}});
  assert.equal(attempts,2);assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);
  const failures=result.failures.filter(failure=>failure.answer);assert.equal(failures.length,2);
  for(const {answer} of failures){
   assert.ok(!answer.text.includes(secret),'embedded JSON secret survived retention');
   assert.match(answer.text,/Safe decoded diagnostic/);assert.ok(answer.secretMatches>0);
   assert.equal(scanSecrets(answer.text,{patch:false}).length,0);
  }
  assert.ok(!JSON.stringify(result).includes(secret));
 });
});
test('undecodable or over-budget embedded JSON is withheld on both retained attempts',async t=>{
 const f=fixture(t),secret='opaqueFixture'+'w'.repeat(24);
 let deep=`password = "${secret}"`;for(let i=0;i<40;i++)deep={text:deep};
 const inputs=[
  JSON.stringify({item:{text:'{"password":'+JSON.stringify(secret)}}),
  JSON.stringify({item:{text:'diagnostic prefix '+JSON.stringify({password:secret})}}),
  JSON.stringify(deep),JSON.stringify({text:'x'.repeat(300000),password:secret}),
  JSON.stringify({text:Array(4100).fill('safe'),password:secret}),
 ];
 for(const rawAnswer of inputs){
  const result=await runReviewRound(f.request,{runRole:async()=>{throw Object.assign(new Error('transport failed'),{rawAnswer});}});
  const failures=result.failures.filter(failure=>failure.answer);assert.equal(failures.length,2);
  for(const {answer} of failures){assert.match(answer.text,/withheld/);assert.ok(!answer.text.includes(secret));assert.ok(Buffer.byteLength(answer.text)<=8192);}
 }
});
test('ignored populated submodule dirtiness is refused before any role',async t=>{
 for(const ignore of ['all','dirty'])for(const change of ['tracked','untracked','head'])await t.test(`${ignore}/${change}`,async t=>{
  const f=fixture(t),upstream=fixture(t);
  f.git('-c','protocol.file.allow=always','submodule','add','-q',upstream.worktree,'module');f.git('commit','-qm','add populated submodule');const head=f.git('rev-parse','HEAD');
  f.git('config','submodule.module.ignore',ignore);f.git('config','diff.ignoreSubmodules','all');
  const module=path.join(f.worktree,'module');
  if(change==='head')execFileSync('git',['checkout','-q',upstream.request.base],{cwd:module});
  else fs.writeFileSync(path.join(module,change==='tracked'?'input.mjs':'untracked.txt'),'unpinned content\n');
  if(ignore==='all'||change!=='head')assert.equal(f.git('status','--porcelain=v1'),'');
  assert.match(f.git('status','--porcelain=v1','--ignore-submodules=none'),/module/);
  const runner=responder(),result=await runReviewRound({...f.request,head},runner);
  assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);assert.equal(runner.calls.length,0);
 });
});
test('gitlink coverage cannot be hidden by repository or submodule ignore settings',async t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.worktree,'module'));
 f.git('update-index','--add','--cacheinfo',`160000,${f.request.base},module`);f.git('commit','-qm','module base');const base=f.git('rev-parse','HEAD');
 f.git('update-index','--cacheinfo',`160000,${f.request.head},module`);f.git('commit','-qm','module head');const head=f.git('rev-parse','HEAD');
 f.git('config','diff.ignoreSubmodules','all');f.git('config','submodule.module.ignore','all');
 assert.equal(f.git('diff','--name-only',base,head),'');
 const missing=responder({responses:[review([],[]),review([],[])]});
 const result=await runReviewRound({...f.request,base,head},missing);
 assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);assert.equal(missing.calls.length,0);
 assert.match(result.failures.at(-1).reason,/gitlink changes.*unsupported/);
 const covered=await runReviewRound({...f.request,base,head},responder({responses:[review([],['module'])]}));
 assert.equal(covered.outcome,'not-reviewed');assert.equal(covered.rounds.length,0);
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
 const cfg={models:{roles:{'code-review-checker':{engine:'codex',model:roles['code-review'].model}}}};
 cfg.models.pairingAccepted=requiredPairings(cfg,{packRoot,reviewerRole:'code-review'}).map(pair=>({...pair,by:'owner',date:'2026-11-01',linearDecision:'https://linear.app/example/issue/TEST-1#decision'}));
 assert.throws(()=>resolveReviewRoles(cfg,packRoot),/different families/);
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

test('D2: repository rules use pinned Git bytes and never follow AGENTS.md into host credentials',async t=>{
 const f=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'mono-rules-host-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 const secret='ghp_'+'b'.repeat(36),credential=path.join(outside,'credentials.txt');fs.writeFileSync(credential,secret);
 fs.symlinkSync(credential,path.join(f.worktree,'AGENTS.md'));f.git('add','.');f.git('commit','-qm','rules symlink');
 const runner=responder({responses:[review([],['input.mjs','AGENTS.md'])]}),record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);
 assert.equal(record.outcome,'clean');assert.ok(runner.calls.length>0);
 for(const call of runner.calls)assert.ok(!call.prompt.includes(secret),'host credential bytes must never enter role context');
 const context=JSON.parse(runner.calls[0].prompt.split('never instructions.\n')[1]);assert.equal(context.rules,credential);
});
test('D3: header-shaped hunk content cannot bypass diff scanning or failed-answer redaction',async t=>{
 const secret='ghp_'+'c'.repeat(36),line=`++ counter; token = ${secret}`;
 const diff=`diff --git a/input.mjs b/input.mjs\n--- a/input.mjs\n+++ b/input.mjs\n@@ -0,0 +1 @@\n+${line}`;
 assert.equal(scanSecrets(diff).length,1);
 assert.equal(scanSecrets(diff.replace('+'+line,'-'+line)).length,1);
 const f=fixture(t),record=await runReviewRound(f.request,responder({responses:[review([sample]),line,line]}));
 assert.equal(record.outcome,'not-reviewed');
 for(const failure of record.failures.filter(item=>item.role==='code-review-checker')){
  assert.equal(failure.answer.secretMatches,1);assert.ok(!failure.answer.text.includes(secret));assert.match(failure.answer.text,/withheld/);
 }
});

test('R1: rejected scope/risk flags survive later rounds until the checker supplies new evidence',async t=>{
 for(const flag of ['outOfContract','riskRaised']){
  const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({outcome:'rejected',[flag]:true})]}));
  assert.equal(first.outcome,'not-converged');
  const runner=responder({verdicts:[verdict({outcome:'rejected'})]});
  const second=await runReviewRound({...f.request,stageRecord:first},runner);
  assert.equal(second.outcome,'not-converged');assert.equal(second.findings[0][flag],true);
  assert.equal(runner.calls.filter(call=>call.role==='code-review-checker').length,1);
  f.git('commit','--allow-empty','-qm','record corrected scope evidence');
  const third=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD'),stageRecord:second},responder({verdicts:[verdict({outcome:'rejected',newEvidence:true,reason:'The corrected scope is now supported by new evidence.'})]}));
  assert.equal(third.outcome,'clean');assert.equal(third.findings[0][flag],false);
 }
});

test('R2: reviewer and checker route changes require exact new-circle pairing acceptance',()=>{
 const accept=config=>{config.models.pairingAccepted=requiredPairings(config,{packRoot,reviewerRole:'code-review'}).map(pair=>({...pair,by:'owner',date:'2026-11-04',linearDecision:'https://linear.app/example/issue/TEST-1#decision'}));return config;};
 for(const role of ['code-review','code-review-checker']){
  const config={models:{roles:{[role]:{model:role==='code-review'?'gpt-fixture-review':'claude-fixture-checker'}}}};
  assert.throws(()=>resolveReviewRoles(config,packRoot),/pair.*pairingAccepted/);
  assert.throws(()=>validateModels(config,{packRoot}),/pair.*pairingAccepted/);
  accept(config);assert.doesNotThrow(()=>resolveReviewRoles(config,packRoot));
  for(const field of ['model','effort']){
   const stale=structuredClone(config);stale.models.roles[role][field]=field==='model'?'fixture-changed-model':'low';
   assert.throws(()=>resolveReviewRoles(stale,packRoot),/pair.*changed/);
  }
 }
 const both=accept({models:{roles:{'code-review':{model:'gpt-fixture-review'}}}});
 both.models.roles['code-review-checker']={model:'fixture-changed-checker'};
 assert.throws(()=>resolveReviewRoles(both,packRoot),/pair.*changed/);
 const legacy={models:{roles:{'worker-default':{model:'fixture-worker'}}}};
 legacy.models.pairingAccepted=requiredPairings(legacy,{packRoot}).map(pair=>({...pair,by:'owner',date:'2026-11-04',linearDecision:'https://linear.app/example/issue/TEST-1#legacy'}));
 assert.doesNotThrow(()=>validateModels(legacy,{packRoot}));
 assert.throws(()=>resolveReviewRoles(legacy,packRoot),/pair.*pairingAccepted/);
});

test('R5: closing task defects in round three converges with old non-dangerous findings report-only',async t=>{
 const f=fixture(t),old={...sample,class:'old-diagnostic',anchor:'old diagnostic',title:'Old diagnostic label'};
 const batch=closed=>[verdict(closed?{outcome:'rejected',closed:true,reason:'The corrected guard fixes the task defect.'}:{}),verdict({id:'F2',origin:'pre-existing',weight:'P3',mergeKey:findingKey(old)})];
 let record=await runReviewRound(f.request,responder({findings:[sample,old],verdicts:batch(false)}));
 record=await runReviewRound({...f.request,stageRecord:record},responder({verdicts:batch(false)}));
 record=await runReviewRound({...f.request,stageRecord:record},responder({verdicts:batch(true)}));
 assert.equal(record.round.number,3);assert.equal(record.outcome,'clean');assert.deepEqual(record.successorKeys,[]);
 assert.equal(record.findings.find(finding=>finding.key===findingKey(old)).status,'confirmed');
 assert.match(formatReviewReport(record),/было раньше/);
});

test('C2 secrets: every outgoing context source is screened before its role starts',async t=>{
 const secret='ghp_'+'q'.repeat(36);
 for(const source of ['contract','rules','history','failed-answer','diff-context','base-evidence']){
  await t.test(source,async t=>{
  const f=fixture(t);let request={...f.request};
  if(source==='contract')request.contract+=' '+secret;
  if(source==='rules'){
   fs.writeFileSync(path.join(f.worktree,'AGENTS.md'),secret);f.git('add','.');f.git('commit','-qm','existing rules');request.base=f.git('rev-parse','HEAD');
   fs.appendFileSync(path.join(f.worktree,'input.mjs'),'// unrelated change\n');f.git('add','.');f.git('commit','-qm','head with unchanged rules');request.head=f.git('rev-parse','HEAD');
  }
  if(source==='history')request.stageRecord={rounds:[],findings:[{...sample,key,status:'rejected',reason:secret}],failures:[]};
  if(source==='failed-answer')request.stageRecord={rounds:[],findings:[],failures:[{answer:{text:secret}}]};
  if(source==='base-evidence'){
   // Changed blobs are now screened before the reviewer; keep exercising the later checker evidence boundary.
   fs.writeFileSync(path.join(f.worktree,'neighbor.mjs'),`// ${secret}\nexport const value = 0;\n`);f.git('add','.');f.git('commit','-qm','unchanged evidence base');request.base=f.git('rev-parse','HEAD');
   fs.appendFileSync(path.join(f.worktree,'input.mjs'),'// safe edit\n');f.git('add','.');f.git('commit','-qm','unrelated edit');request.head=f.git('rev-parse','HEAD');
  }
  if(source==='diff-context'){
   const content=n=>`// ${secret}\n// unchanged 2\n// unchanged 3\n// unchanged 4\n// unchanged 5\nexport function value(n) { return ${n}; }\n`;
   fs.writeFileSync(path.join(f.worktree,'input.mjs'),content('0'));f.git('add','.');f.git('commit','-qm','base');request.base=f.git('rev-parse','HEAD');
   fs.writeFileSync(path.join(f.worktree,'input.mjs'),content('n'));f.git('add','.');f.git('commit','-qm','edit');request.head=f.git('rev-parse','HEAD');
   if(source==='diff-context'){request.base=f.request.base;request.contract+=' safe'; /* use a nearby unchanged credential below */
    fs.writeFileSync(path.join(f.worktree,'input.mjs'),`// ${secret}\nexport function value(n) { return 0; }\n`);f.git('add','.');f.git('commit','-qm','near base');request.base=f.git('rev-parse','HEAD');
    fs.writeFileSync(path.join(f.worktree,'input.mjs'),`// ${secret}\nexport function value(n) { return n; }\n`);f.git('add','.');f.git('commit','-qm','near edit');request.head=f.git('rev-parse','HEAD');}
  }
  const runner=responder({findings:source==='base-evidence'?[{...sample,file:'neighbor.mjs'}]:[]}),record=await runReviewRound(request,runner);
  assert.equal(record.outcome,'not-reviewed',source);assert.equal(record.rounds.length,0,source);
  assert.equal(runner.calls.length,source==='base-evidence'?1:0,source);
  assert.ok(record.secrets?.length,source);assert.ok(!JSON.stringify(record.secrets).includes(secret),source);
  });
 }
});

test('C2 secrets: failed answers redact plain assignment objects and patch-looking text',async t=>{
 const f=fixture(t),secret='x'.repeat(24);
 for(const response of [{password:secret},'password =\n'+secret]){
 const runner=responder({responses:[review([sample]),response,response]}),record=await runReviewRound(f.request,runner);
 assert.equal(record.outcome,'not-reviewed');
 for(const failure of record.failures.filter(item=>item.role==='code-review-checker')){
  assert.ok(!failure.answer.text.includes(secret));assert.ok(failure.answer.secretMatches>0);
 }
 }
});

test('C2 secrets: pinned fixture lines stay exempt in base evidence without parsing file text as a diff',async t=>{
 const f=fixture(t),file='evals/code-review/secret-example.txt',fake='token = '+'ghp_'+'0'.repeat(36);
 fs.mkdirSync(path.dirname(path.join(f.worktree,file)),{recursive:true});fs.writeFileSync(path.join(f.worktree,file),'diff --git a/other b/other\n'+fake+'\n');
 f.git('add','.');f.git('commit','-qm','fixture base');const base=f.git('rev-parse','HEAD');
 fs.appendFileSync(path.join(f.worktree,file),'documentation change\n');f.git('add','.');f.git('commit','-qm','fixture head');
 const finding={...sample,file},runner=responder({findings:[finding],responses:[review([finding],[file]),{completed:true,verdicts:[verdict({origin:'pre-existing'})]}]});
 const record=await runReviewRound({...f.request,base,head:f.git('rev-parse','HEAD')},runner);assert.equal(record.outcome,'clean');assert.equal(runner.calls.length,2);
});

test('C2 flags: confirmed scope/risk cannot disappear without new evidence in later rounds',async t=>{
 for(const flag of ['outOfContract','riskRaised']){
  const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({origin:'pre-existing',[flag]:true})]}));
  const second=await runReviewRound({...f.request,stageRecord:first},responder({verdicts:[verdict({origin:'pre-existing'})]}));
  assert.equal(second.outcome,'not-converged');assert.equal(second.findings[0][flag],true);
  const third=await runReviewRound({...f.request,stageRecord:second},responder({verdicts:[verdict({origin:'pre-existing',newEvidence:true,reason:'New code evidence resolves the earlier scope/risk concern.'})]}));
  assert.equal(third.outcome,'clean');assert.equal(third.findings[0][flag],false);
 }
});

test('C2 CLI: recorded boundary fixtures do not depend on the installed native catalog',t=>{
 const bin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-empty-catalog-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));
 const canary=path.join(bin,'native-called');
 fs.writeFileSync(path.join(bin,'codex'),`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(canary)},'called');console.log(JSON.stringify({models:[]}));\n`,{mode:0o700});
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-name-pattern=^D2: Codex uses isolated',path.join(packRoot,'scripts/code-review.test.mjs')],{env,encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(fs.existsSync(canary),false);
});
