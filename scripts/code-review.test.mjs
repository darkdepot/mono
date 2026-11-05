import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound, parseChecker, findingKey, scanSecrets, formatReviewReport, resolveReviewRoles, roleInvocation, subscriptionStatus, screenModelOutput, MAX_SCREEN_VALUE_BYTES } from './code-review.mjs';
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
test('C24: nested literal spans precede whitespace fallback for every binding form',async t=>{
 const literal='{ value: "opaque-review-fixture" }';
 const sources=[
  ['assignment','let credential; credential = '+literal+';'],
  ['declaration','const credential = '+literal+';'],
  ['export','export CREDENTIAL='+literal+';'],
  ['export declaration','export const credential = '+literal+';'],
  ['object member','const options = { credential: '+literal+' };'],
 ];
 for(const [name,source] of sources)await t.test(name,async t=>{
  const expected=source.replace(literal,'"[credential-shaped field withheld]"');
  const safe=screenModelOutput(source,{input:true,inputFile:'input.mjs'});
  assert.equal(safe.rejected,false);assert.equal(safe.value,expected);
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),source+'\n');f.git('add','.');f.git('commit','-qm','nested binding span');
  const head=f.git('rev-parse','HEAD'),diff=f.git('diff',f.request.base,head);
  const screened=screenModelOutput(diff,{input:true,inputPatch:true});
  assert.equal(screened.rejected,false);assert.ok(!screened.value.includes('opaque-review-fixture'));
  const runner=responder(),record=await runReviewRound({...f.request,head},runner);
  assert.equal(record.outcome,'clean');assert.equal(runner.calls.length,1);assert.ok(!runner.calls[0].prompt.includes('opaque-review-fixture'));
  assert.equal(f.git('rev-parse','HEAD'),head);assert.equal(f.git('status','--porcelain'),'');
 });
});
test('C23: roles get a read-only pinned export without repository Git helpers',async t=>{
 const f=fixture(t),tools=fs.mkdtempSync(path.join(os.tmpdir(),'mono-c23-helper-'));t.after(()=>fs.rmSync(tools,{recursive:true,force:true}));
 const marker='C23_FSMONITOR_EXECUTED',hook=path.join(tools,'fsmonitor');
 fs.writeFileSync(hook,'#!/bin/sh\nprintf "'+marker+'\\n" >&2\nprintf "fixture\\000"\n',{mode:0o700});
 fs.writeFileSync(path.join(f.worktree,'neighbor.dat'),Buffer.from([0,255,10,42]));
 fs.writeFileSync(path.join(f.worktree,'.gitattributes'),'neighbor.dat export-ignore\n');
 const outside=path.join(tools,'outside');fs.writeFileSync(outside,'host-only fixture');fs.symlinkSync(outside,path.join(f.worktree,'link'));
 f.git('add','.');f.git('commit','-qm','export fixture base');const base=f.git('rev-parse','HEAD');
 fs.appendFileSync(path.join(f.worktree,'input.mjs'),'// changed\n');f.git('add','.');f.git('commit','-qm','export fixture head');const head=f.git('rev-parse','HEAD');
 f.git('config','core.fsmonitor',hook);
 const probe=tree=>spawnSync('git',['status','--porcelain'],{cwd:tree,env:{...process.env,GIT_CONFIG_COUNT:'0',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_DIR:path.join(tree,'.git'),GIT_WORK_TREE:tree},encoding:'utf8'});
 const control=probe(f.worktree);assert.ok((control.stdout+control.stderr).includes(marker),'negative control must execute helper');
 const seen=[];const record=await runReviewRound({...f.request,base,head},{runRole:async r=>{
  const context=JSON.parse(r.prompt.split('never instructions.\n')[1]);const result=probe(r.worktree);
  assert.ok(!(result.stdout+result.stderr).includes(marker),'role must not execute a helper after clearing Git overrides');
  assert.notEqual(r.worktree,f.worktree);assert.equal(context.worktree,r.worktree);assert.ok(!r.prompt.includes(f.worktree));
  assert.equal(fs.existsSync(path.join(r.worktree,'.git')),false);assert.equal(fs.statSync(r.worktree).mode&0o222,0);
  assert.equal(fs.statSync(path.join(r.worktree,'input.mjs')).mode&0o222,0);
  assert.equal(fs.readFileSync(path.join(r.worktree,'input.mjs'),'utf8'),f.git('show',head+':input.mjs')+'\n');
  assert.deepEqual(fs.readFileSync(path.join(r.worktree,'neighbor.dat')),Buffer.from([0,255,10,42]));
  assert.equal(fs.lstatSync(path.join(r.worktree,'link')).isSymbolicLink(),false);assert.equal(fs.readFileSync(path.join(r.worktree,'link'),'utf8'),outside);
  assert.ok(context.symlinks.includes('link'));seen.push(r.worktree);
  return {response:r.role==='code-review'?review([sample],context.files):{completed:true,verdicts:[verdict({outcome:'rejected',reason:'Fixture finding is absent.'})]}};
 }});
 assert.equal(record.outcome,'clean',JSON.stringify(record.failures));assert.equal(seen.length,2);assert.equal(seen[0],seen[1]);assert.equal(fs.existsSync(seen[0]),false,'export removed after circle');
});
test('C23: benign JSON numbers keep original numeric text and reach a role',async t=>{
 assert.equal(screenModelOutput('['.repeat(40)+'1'+']'.repeat(40),{input:true,inputFile:'input.json'}).rejected,true,'numeric preservation keeps structural bounds');
 for(const source of ['{"buildId":9007199254740993}', '{"buildId":9007199254740993,"ratio":1.2500e+2,"password":"fixtureValue"}', '{"buildId":9007199254740993,"data":"{\\"count\\":9007199254740995}"}']){
  const expected=source.replace('"fixtureValue"','"[credential-shaped field withheld]"');
  const safe=screenModelOutput(source,{input:true,inputFile:'input.json'});assert.equal(safe.rejected,false,source);assert.equal(safe.value,expected,source);
  assert.equal(screenModelOutput('{"buildId":9007199254740993}').value,'{"buildId":9007199254740993}');
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),source);f.git('add','.');f.git('commit','-qm','large JSON number');const runner=responder();
  const record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);assert.equal(record.outcome,'clean',JSON.stringify(record.failures));assert.equal(runner.calls.length,1);assert.ok(runner.calls[0].prompt.includes('9007199254740993'));assert.ok(!runner.calls[0].prompt.includes('9007199254740992'));
 }
});
test('C23: runtime object true/false/null bind while type-only keyword members do not',async t=>{
 for(const source of ['const options = { password: false, token: null };','const options = { password: true, nested: { token: false } };','const type = { password: false };','class Flags { options() { return { password: false }; } }','const options = { class: { password: false }, interface: { token: null } };']){
  const safe=screenModelOutput(source,{input:true,inputFile:'input.mjs'});assert.equal(safe.rejected,false);assert.equal(safe.value,source.replace(/\b(?:false|true|null)\b/g,'"[credential-shaped field withheld]"'));
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),source);f.git('add','.');f.git('commit','-qm','runtime keyword binding');const runner=responder();const record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);assert.equal(record.outcome,'clean');assert.equal(runner.calls.length,1);assert.ok(!runner.calls[0].prompt.includes(source));
 }
 for(const source of ['interface Flags { password: false; token: null; }','type Flags = { password: true; token: null; };','class Flags { password: false; token: null; }']){
  assert.equal(screenModelOutput(source,{input:true,inputFile:'input.ts'}).value,source);assert.equal(scanSecrets(source,{patch:false}).length,0);
 }
});
test('C22: typed declarations and fields bind their actual initializer while type-only members do not',async t=>{
 const sources=[
  'const password: string = "fixtureValue";', 'let password: string = "fixtureValue";',
  'var password: string = "fixtureValue";', 'export const password: string = "fixtureValue";',
  'const password: string/* note=x */ = "fixtureValue";',
  'class Login { readonly password: string = "fixtureValue"; }',
  'class Login { password?: string = "fixtureValue"; }',
  'class Login { private token: Token = "fixtureValue"; }',
  'const login = { password: string = "fixtureValue" };',
  'const credential: Record<string, {value: string}> = "fixtureValue";',
 ];
 for(const source of sources){
  const safe=screenModelOutput(source,{input:true,inputFile:'input.ts'});
  assert.equal(safe.rejected,false,source);assert.ok(!safe.value.includes('fixtureValue'),source);
  assert.equal(safe.value,source.replace('"fixtureValue"','"[credential-shaped field withheld]"'),source);
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),source+'\n');f.git('add','.');f.git('commit','-qm','typed binding regression');
  const runner=responder(),record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);
  assert.equal(record.outcome,'clean',source);assert.equal(runner.calls.length,1);assert.ok(!runner.calls[0].prompt.includes('fixtureValue'));
 }
 for(const source of ['interface Login { readonly password?: string; private token: Token; }', 'type Login = { password: string, token: Token }', 'const enabled = ready ? form.password : target = "fixtureValue";']){
  assert.equal(scanSecrets(source,{patch:false}).length,0,source);
  assert.equal(screenModelOutput(source,{input:true,inputFile:'input.ts'}).value,source);
 }
});
test('C22: literal redaction preserves every byte outside matching escape-aware quotes',async t=>{
 const literals=[String.raw`"fixture"`, String.raw`"fix\"ture"`, String.raw`"fixture\\"`, String.raw`'fix\'ture'`, '`fixture\\`value`'];
 for(const literal of literals){
  const prefix='function calculate(a,b) { const token = ',suffix=String.raw`; const pattern = "\\w+"; return a - b; }`+'\n';
  const source=prefix+literal+suffix,expected=prefix+'"[credential-shaped field withheld]"'+suffix;
  for(const patch of [false,true]){
   const input=patch?'+++ b/input.mjs\n@@ -0,0 +1 @@\n+'+source:source;
   const wanted=patch?'+++ b/input.mjs\n@@ -0,0 +1 @@\n+'+expected:expected;
   const safe=screenModelOutput(input,{input:true,inputFile:'input.mjs',inputPatch:patch});
   assert.equal(safe.rejected,false,literal);assert.equal(safe.value,wanted,literal);
  }
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),source);f.git('add','.');f.git('commit','-qm','literal span regression');
  const runner=responder(),record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);
  assert.equal(record.outcome,'clean');assert.equal(runner.calls.length,1);assert.ok(runner.calls[0].prompt.includes('return a - b;'));
 }
});
test('C21: env and flag values retain trailing equals until whitespace before in-place input redaction',async t=>{
 for(const source of ['export API_KEY=fixtureValue=', '--api-key fixtureValue=', '--api-key=fixtureValue=']){
  assert.equal(screenModelOutput(source).rejected,true,source);
  const screened=screenModelOutput(source,{input:true,inputFile:'input.mjs'});
  assert.equal(screened.rejected,false,source);assert.ok(!screened.value.includes('fixtureValue'));
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),source+'\n');f.git('add','.');f.git('commit','-qm','equals regression');
  const runner=responder(),record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);
  assert.equal(record.outcome,'clean',source);assert.equal(runner.calls.length,1);
  assert.ok(!runner.calls[0].prompt.includes('fixtureValue'));
 }
});
test('C21: block and line comments between binding name and operator are whitespace',async t=>{
 for(const source of ['const password/*note*/="fixtureValue";', 'const password//note\n="fixtureValue";', 'const password/* note */ = "fixtureValue";']){
  assert.equal(screenModelOutput(source).rejected,true,source);
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),source+'\n');f.git('add','.');f.git('commit','-qm','comment regression');
  const runner=responder(),record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);
  assert.equal(record.outcome,'clean',source);assert.equal(runner.calls.length,1);
  assert.ok(!runner.calls[0].prompt.includes('fixtureValue'));
 }
});
test('C21: bare type-only members match nothing and never prevent role launch',async t=>{
 for(const source of ['interface LoginForm { password: string; }', 'type LoginForm = { token: TokenType; credential: unknown; };']){
  assert.equal(screenModelOutput(source).rejected,false,source);assert.equal(scanSecrets(source,{patch:false}).length,0);
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),source+'\n');f.git('add','.');f.git('commit','-qm','type regression');
  const runner=responder(),record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);
  assert.equal(record.outcome,'clean',source);assert.equal(runner.calls.length,1);
 }
});
test('C21: diff/blob rule-2 values redact in place, while families and ambiguous JSON still withhold',async t=>{
 for(const source of ['const password = "fixtureValue";\n', 'const credential = {value:"fixtureValue", nested:["secondValue"]};\n', 'password =\n"fixtureValue"\n']){
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),source);f.git('add','.');f.git('commit','-qm','redaction regression');
  const head=f.git('rev-parse','HEAD'),diff=f.git('diff',f.request.base,head);
  assert.equal(scanSecrets(diff).length,0);
  const screened=screenModelOutput(diff,{input:true,inputPatch:true});assert.equal(screened.rejected,false);
  assert.ok(!screened.value.includes('fixtureValue'));assert.ok(!screened.value.includes('secondValue'));
  const runner=responder(),before=f.git('status','--porcelain=v1'),record=await runReviewRound({...f.request,head},runner);
  assert.equal(record.outcome,'clean');assert.equal(runner.calls.length,1);
  assert.ok(!runner.calls[0].prompt.includes('fixtureValue'));assert.ok(!runner.calls[0].prompt.includes('secondValue'));
  assert.equal(f.git('status','--porcelain=v1'),before);assert.equal(f.git('rev-parse','HEAD'),head);
 }
 const encoded=JSON.stringify(JSON.stringify({password:'fixtureValue'}));
 const source=`const data = JSON.parse(${encoded});\nconst retained = 42;\n`;
 for(const patch of [false,true]){
  const input=patch?`+++ b/input.mjs\n@@ -0,0 +1,2 @@\n+${source.trimEnd().replaceAll('\n','\n+')}\n`:source;
  const screened=screenModelOutput(input,{input:true,inputFile:'input.mjs',inputPatch:patch});
  assert.equal(screened.rejected,false);assert.ok(!screened.value.includes('fixtureValue'));
  assert.ok(screened.value.includes('const data = JSON.parse('));assert.ok(screened.value.includes('const retained = 42;'));
  assert.equal(screened.value.split('\n').length,input.split('\n').length);
 }
 for(const source of ['password="'+'ghp_'+'h'.repeat(36)+'"', '{"password":"fixtureValue","password":""}']){
  assert.equal(screenModelOutput(source,{input:true,inputFile:'input.mjs'}).rejected,true);
 }
});
test('v4: raw duplicate members, escaped keys and every bound value are screened before parsing',()=>{
 const inputs=['{"password":"x","password":""}', '{"pass\\u0077ord":"x","password":""}',
  'const password = "x";', 'export API_KEY=x', '--token x', '--session-key=7',
  '{credential: {value:"x"}}', '{password:1}', '{"password":false}', '{"password":null}',
  '{"password":"x","password":"safe"}', 'const password = ["x"];', 'password="x'];
 for(const source of inputs){
  assert.equal(screenModelOutput(source).rejected,true,source);
  assert.ok(scanSecrets(source,{patch:false}).length,source);
  assert.ok(!screenModelOutput(source).diagnostic.text.includes('"x"'),source);
 }
});
test('v4: key reads and non-JSON brace prose remain usable role responses',async t=>{
 const benign=['if (form.password) render("Settings")', '{"enabled":true} is returned for the disabled case.',
  '[settings] render the saved configuration', 'The credential: field describes the login form.',
  'test("token: label in a test title", () => render())', 'const tokenCount = 3;',
  'const enabled = /\\w+/.test(input);'];
 for(const source of benign)assert.equal(screenModelOutput(source).rejected,false,source);
 const f=fixture(t),runner=responder({findings:[sample],verdicts:[verdict({reason:benign[1]})]});
 const result=await runReviewRound(f.request,runner);
 assert.equal(result.outcome,'not-converged');assert.equal(result.rounds.length,1);assert.equal(runner.calls.length,2);
});
test('v4: every JSON decoding layer preserves members before resolving duplicate or escaped bindings',()=>{
 for(const raw of ['{"completed":false,"completed":true}', '{"complet\\u0065d":false,"completed":true}',
  '{"outer":{"password":"x","password":""}}', '{"password":{"value":"x"},"password":{}}']){
  let value=raw;
  for(let layer=0;layer<4;layer++){
   for(const options of [{input:true},{},{diagnostic:true}])assert.equal(screenModelOutput(value,options).rejected,true,raw);
   value=JSON.stringify(value);
  }
 }
 // Continue:23 supersedes the v4 lossy-number refusal; valid numeric text stays exact.
 for(const value of ['{"value":99999999999999999}', '{"value":1e400}']){const safe=screenModelOutput(value);assert.equal(safe.rejected,false);assert.equal(safe.value,value);}
});
test('v4: short/duplicate credentials in pinned input and checker evidence never leave the round boundary',async t=>{
 const payload='{"pass\\u0077ord":"x","password":""}';
 for(const channel of ['contract','blob','checker']){
  const f=fixture(t),request={...f.request};
  if(channel==='contract')request.contract=payload;
  if(channel==='blob'){fs.writeFileSync(path.join(f.worktree,'input.mjs'),payload);f.git('add','.');f.git('commit','-qm','duplicate input');request.head=f.git('rev-parse','HEAD');}
  const runner=responder({findings:[sample],verdicts:[verdict({reason:payload})]});
  const result=await runReviewRound(request,runner);
  assert.equal(result.outcome,'not-reviewed',channel);assert.equal(result.rounds.length,0,channel);
  assert.equal(runner.calls.length,channel==='checker'?3:0,channel);
  assert.ok(!JSON.stringify(result).includes('"x"'),channel);
 }
});
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
 const roles=resolveReviewRoles({},packRoot);
 fs.writeFileSync(path.join(bin,'fixture.json'),JSON.stringify({stream,model:roles['code-review'].model,checker:{completed:true,verdicts:[verdict()]},reviewer:review([sample])}));
 const fake=`#!/usr/bin/env node
 const fs=require('node:fs'),path=require('node:path'),data=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture.json'),'utf8'));
 if(process.argv.includes('auth')){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}));process.exit(0);}
 let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
 const emit=o=>console.log(JSON.stringify(o));emit(data.stream.init);
 for(const event of data.stream.fallbacks)emit(event);
 if(fs.readFileSync(path.join(__dirname,'mode'),'utf8')==='failure')process.exit(1);
 emit({type:'result',subtype:'success',is_error:false,structured_output:input.includes('# Finding checker')?data.checker:data.reviewer,modelUsage:data.stream.modelUsage});});`;
 const codex=`#!/usr/bin/env node
 const fs=require('node:fs'),path=require('node:path'),data=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture.json'),'utf8'));
 if(process.argv[2]==='debug'){console.log(JSON.stringify({models:[{slug:data.model,tool_mode:'code_mode_only',apply_patch_tool_type:'freeform',multi_agent_version:'v2'}]}));process.exit(0);}
 if(process.argv[2]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}
 let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const value=input.startsWith('Boundary audit')?{tools:['exec_command','write_stdin'],mcpServers:[]}:input.includes('# Finding checker')?data.checker:data.reviewer;
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}}));console.log(JSON.stringify({type:'turn.completed'}));});`;
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
test('forced Git color cannot hide multiline patch redaction before model launch',async t=>{
 for(const setting of ['color.diff','color.ui'])await t.test(setting,async t=>{
  const f=fixture(t),secret='opaqueFixture'+'c'.repeat(24);
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),`password =\n"${secret}"\n`);
  f.git('add','.');f.git('commit','-qm','multiline credential');const head=f.git('rev-parse','HEAD');
  f.git('config',setting,'always');
  const colored=f.git('diff',f.request.base,head);assert.match(colored,/\u001b\[/);
  const runner=responder(),result=await runReviewRound({...f.request,head},runner);
  assert.equal(runner.calls.length,1);assert.equal(result.outcome,'clean');assert.equal(result.rounds.length,1);
  assert.ok(runner.calls.every(call=>!call.prompt.includes(secret)));assert.ok(!JSON.stringify(result).includes(secret));
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
test('role Git reads cannot execute repository helpers, including absolute Git with an explicit directory',async t=>{
 for(const driver of ['clean','process'])for(const role of ['code-review','code-review-checker'])await t.test(`${role}/${driver}`,t=>{
  const f=fixture(t),marker=path.join(f.worktree,'.git','role-ran'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'mono-role-git-'));
  t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  fs.writeFileSync(path.join(f.worktree,'.gitattributes'),'input.mjs filter=probe diff=probe merge=probe\n');
  fs.writeFileSync(path.join(f.worktree,'helper.cjs'),`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');process.exit(1);\n`);
  f.git('add','.');f.git('commit','-qm','role helper fixture');
  const command=`${process.execPath} ${path.join(f.worktree,'helper.cjs')}`;
  f.git('config',`filter.probe.${driver}`,command);f.git('config','filter.probe.required','true');
  f.git('config','diff.probe.textconv',command);f.git('config','diff.probe.command',command);f.git('config','merge.probe.driver',command);
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),'export const changed = 2;\n');
  const route=resolveReviewRoles({},packRoot)[role],invocation=roleInvocation(role,route,{scratch,worktree:f.worktree,schemaFile:path.join(packRoot,`skills/code-review/${role==='code-review'?'reviewer':'checker'}.schema.json`)});
  const binary=execFileSync('which',['git'],{encoding:'utf8'}).trim();
  for(const args of [['-C',f.worktree,'diff','HEAD'],['--git-dir='+path.join(f.worktree,'.git'),'--work-tree='+f.worktree,'diff','HEAD']]){
   spawnSync(binary,args,{cwd:scratch,env:invocation.env,encoding:'utf8'});
   assert.equal(fs.existsSync(marker),false,'repository helper ran inside role environment');
  }
  spawnSync(binary,['diff','HEAD'],{cwd:f.worktree,encoding:'utf8'});
  assert.equal(fs.existsSync(marker),true,'negative control must execute the repository helper');
 });
});
test('encoded JSON assignments redact in pinned files and withhold unbound context',async t=>{
 const secret='opaqueFixture'+'j'.repeat(24);
 for(const depth of [1,2,3])for(const source of ['blob','contract','rules','base-evidence'])await t.test(`${source}/${depth}`,async t=>{
  const f=fixture(t);let encoded=JSON.stringify({password:secret});for(let i=0;i<depth;i++)encoded=JSON.stringify(encoded);
  const content=`const data = JSON.parse(${encoded});\n`,request={...f.request};
  if(source==='contract')request.contract+=content;
  else {
   const file=source==='rules'?'AGENTS.md':source==='base-evidence'?'neighbor.mjs':'input.mjs';
   fs.writeFileSync(path.join(f.worktree,file),content);f.git('add','.');f.git('commit','-qm','encoded assignment');
   if(source!=='blob'){request.base=f.git('rev-parse','HEAD');fs.writeFileSync(path.join(f.worktree,'input.mjs'),'export const changed = 2;\n');f.git('add','.');f.git('commit','-qm','safe edit');}
   request.head=f.git('rev-parse','HEAD');
  }
  const runner=responder({findings:source==='base-evidence'?[{...sample,file:'neighbor.mjs'}]:[]}),result=await runReviewRound(request,runner);
  assert.equal(result.outcome,source==='contract'?'not-reviewed':source==='base-evidence'?'not-converged':'clean');
  assert.equal(runner.calls.length,source==='contract'?0:source==='base-evidence'?2:1);
  assert.ok(runner.calls.every(call=>!call.prompt.includes(secret)));assert.ok(!JSON.stringify(result).includes(secret));
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
  assert.equal(runner.calls.length,1);assert.equal(result.outcome,'clean');assert.equal(result.rounds.length,1);
  assert.ok(runner.calls.every(call=>!call.prompt.includes(secret)));assert.ok(!JSON.stringify(result).includes(secret));
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
 const f=fixture(t),syntheticValue='x'.repeat(24),second='y'.repeat(25),token='ghp_'+'z'.repeat(36);
 for(const bad of [`password =\n${syntheticValue}\n${token}\n"access_token":\n"${second}"`,`${token}\nsecret =\n${second}\npassword =\n${syntheticValue}`]){
  const result=await runReviewRound(f.request,responder({responses:[review([sample]),bad,bad]}));
  assert.equal(result.outcome,'not-reviewed');assert.equal(result.rounds.length,0);
  const failures=result.failures.filter(failure=>failure.role==='code-review-checker');assert.equal(failures.length,2);
  for(const {answer} of failures){
   for(const secret of [syntheticValue,second,token])assert.ok(!answer.text.includes(secret),'failed answer retained a secret');
   assert.equal(scanSecrets(answer.text,{patch:false}).length,0);assert.ok(Buffer.byteLength(answer.text)<=8192);assert.ok(answer.secretMatches>=2);
  }
  assert.ok(scanSecrets(bad,{patch:false}).some(match=>match.reason.includes('multiline')));
 }
});
test('shared model screen preserves benign JSON/code without path exceptions',async t=>{
 const safe={summary:'[P2] Inspect function value(n) { return n; }',quotes:['A safe quote.'],nested:JSON.stringify({note:'Literal JSON diagnostic'})};
 const screened=screenModelOutput(safe);assert.equal(screened.rejected,false);assert.deepEqual(screened.value,safe);
 const f=fixture(t),file='evals/code-review/secret-example.txt',fake='token = '+'ghp_'+'0'.repeat(36);
 const finding={...sample,file,evidence:fake},runner=responder({findings:[finding],responses:[JSON.stringify(review([finding])),JSON.stringify({completed:true,verdicts:[verdict({origin:'pre-existing',reason:fake})]})]});
 const record=await runReviewRound(f.request,runner);assert.equal(record.outcome,'not-reviewed');
 assert.ok(!JSON.stringify(record).includes(fake));assert.ok(!formatReviewReport(record).includes(fake));
 for(const value of [{summary:JSON.stringify({password:'opaqueFixture'+'z'.repeat(24)})},JSON.stringify({reason:'ghp_'+'q'.repeat(36)})]){
  const screened=screenModelOutput(value);assert.equal(screened.rejected,true);assert.equal(screenModelOutput(screened.value).rejected,false,'sanitized state is safe to persist and read back');
 }
});
test('numeric-looking secret strings keep their literal bytes through every JSON layer',async t=>{
 const f=fixture(t),secret='1'.repeat(24);
 assert.equal(screenModelOutput({password:Number(secret)}).rejected,true,'already-decoded lossy numbers are withheld too');
 assert.equal(screenModelOutput({reason:'{"password":'+secret+'e400}'}).rejected,true,'overflowing JSON numbers cannot retain their raw source');
 for(const depth of [0,1,2]){
  let reason=depth===0?'{"password":'+secret+'}':{password:secret};for(let layer=0;layer<depth;layer++)reason=JSON.stringify(reason);
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
test('patch multiline assignments redact before roles, on both sides and across context lines',async t=>{
 for(const shape of ['added','removed','context'])await t.test(shape,async t=>{
  const f=fixture(t),secret='opaqueFixture'+'x'.repeat(24);
  const before=shape==='added'?'export const safe = 1;\n':`password =\n"${shape==='context'?'short':secret}"\n`;
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),before);f.git('add','.');f.git('commit','-qm','before assignment');const base=f.git('rev-parse','HEAD');
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),shape==='removed'?'export const safe = 2;\n':`password =\n"${secret}"\n`);
  f.git('add','.');f.git('commit','-qm','assignment change');const head=f.git('rev-parse','HEAD'),runner=responder();
  const result=await runReviewRound({...f.request,base,head},runner);
  assert.equal(result.outcome,'clean');assert.equal(runner.calls.length,1);assert.equal(result.rounds.length,1);
  assert.ok(runner.calls.every(call=>!call.prompt.includes(secret)));assert.ok(!JSON.stringify(result).includes(secret));
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
test('secrets stop before launch in every path, including removed and fixture secrets',async t=>{
 const secret='ghp_'+'a'.repeat(36);const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),`token = ${secret}\n`);f.git('add','.');f.git('commit','-qm','secret');
 const runner=responder(),result=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);assert.equal(result.outcome,'not-reviewed');assert.equal(runner.calls.length,0);assert.ok(!JSON.stringify(result).includes(secret));
 const fake='token = '+'ghp_'+'0'.repeat(36);const diff=`+++ b/evals/code-review/secret-example.txt\n@@ -0,0 +1 @@\n+${fake}`;
 assert.equal(scanSecrets(diff).length,1);assert.equal(scanSecrets(diff.replace('secret-example.txt','other.txt')).length,1);assert.equal(scanSecrets(diff.replace('+'+fake,'-'+fake).replace('secret-example.txt','other.txt')).length,1);
});
test('unknown, duplicate, contradictory checker answers and unproven closure cannot admit clean',()=>{
 for(const verdicts of [[verdict({id:'unknown'})],[verdict(),verdict()],[verdict({closed:true})]])assert.throws(()=>parseChecker({completed:true,verdicts},[{...sample,key}]));
 const other={...sample,anchor:'other',key:'other'};assert.throws(()=>parseChecker({completed:true,verdicts:[verdict(),verdict({id:'F2',outcome:'rejected'})]},[{...sample,key},other]),/contradictory/);
});
test('role permissions are separate from writer transport; new pairing names reviewer, old pairing remains usable',t=>{
 const neutral=fs.mkdtempSync(path.join(os.tmpdir(),'mono-permissions-'));t.after(()=>fs.rmSync(neutral,{recursive:true,force:true}));
 const roles=resolveReviewRoles({},packRoot);
 process.env.MONO_REVIEW_TEST_CREDENTIAL='fictional-worker-credential';
 const codex=roleInvocation('code-review',roles['code-review'],{scratch:neutral,worktree:os.tmpdir(),schemaFile:path.join(packRoot,'skills/code-review/reviewer.schema.json')});
 assert.equal(codex.env.MONO_REVIEW_TEST_CREDENTIAL,undefined);delete process.env.MONO_REVIEW_TEST_CREDENTIAL;assert.equal(codex.cwd,neutral);assert.ok(Number(codex.env.GIT_CONFIG_COUNT)>2);assert.equal(codex.env.GIT_DIR,'/dev/null');assert.equal(codex.env.GIT_CONFIG_KEY_0,'core.hooksPath');assert.equal(codex.env.GIT_CONFIG_VALUE_0,'/dev/null');assert.equal(codex.env.GIT_CONFIG_KEY_1,'core.fsmonitor');assert.equal(codex.env.GIT_CONFIG_VALUE_1,'false');assert.equal(codex.env.GIT_NO_LAZY_FETCH,'1');
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

test('historical synthetic decoys follow the same rule regardless of path',()=>{
 const lines=[['scripts/review-bench.test.mjs',"  return {...f,log,plan,good,routes:[good],env:{BENCH_CREDENTIAL:secret,UNRELATED_SECRET:'"+['ambient','must','not','reach','helper'].join('-')+"'},secret};"],
 ['scripts/delivery-runtime.test.mjs','      const row = { pid: 900022, procStart: fixtureStart }, secret = "'+['UNRELATED','SECRET','DECOY','146'].join('_')+'";']];
 for(const [file,line] of lines){
  const diff=`+++ b/${file}\n@@ -0,0 +1 @@\n+${line}`,deleted=`--- a/${file}\n+++ /dev/null\n@@ -1 +0,0 @@\n-${line}`;
  for(const patch of [diff,diff.replace('+++ b/'+file,'+++ b/other.test.mjs'),diff+'x',deleted,deleted.replace('--- a/'+file,'--- a/other.test.mjs')]){
   assert.equal(scanSecrets(patch).length,0);
   const screened=screenModelOutput(patch,{input:true,inputPatch:true});assert.equal(screened.rejected,false);
   assert.match(screened.value,/credential-shaped field withheld/);
   assert.ok(!screened.value.includes('ambient-must-not-reach-helper'));assert.ok(!screened.value.includes('UNRELATED_SECRET_DECOY_146'));
  }
 }
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
 const status=spawnSync('git',['--git-dir='+path.join(f.worktree,'.git'),'--work-tree='+f.worktree,'status','--porcelain'],{cwd:f.worktree,env:invocation.env,encoding:'utf8'});assert.equal(status.status,0,status.stderr);assert.equal(fs.existsSync(marker),false);
 const broken={...invocation.env};for(const name of Object.keys(broken))if(name.startsWith('GIT_CONFIG_')||['GIT_DIR','GIT_WORK_TREE'].includes(name))delete broken[name];
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
 const invocation=roleInvocation('code-review',route,{scratch,worktree:os.tmpdir(),schemaFile:path.join(packRoot,'skills/code-review/reviewer.schema.json')});
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

test('C19 secrets: raw fixture blobs are screened without a path exemption or patch spoofing',async t=>{
 const f=fixture(t),file='evals/code-review/secret-example.txt',fake='token = '+'ghp_'+'0'.repeat(36);
 fs.mkdirSync(path.dirname(path.join(f.worktree,file)),{recursive:true});fs.writeFileSync(path.join(f.worktree,file),'diff --git a/other b/other\n'+fake+'\n');
 f.git('add','.');f.git('commit','-qm','fixture base');const base=f.git('rev-parse','HEAD');
 fs.appendFileSync(path.join(f.worktree,file),'documentation change\n');f.git('add','.');f.git('commit','-qm','fixture head');
 const finding={...sample,file},runner=responder({findings:[finding],responses:[review([finding],[file]),{completed:true,verdicts:[verdict({origin:'pre-existing'})]}]});
 const record=await runReviewRound({...f.request,base,head:f.git('rev-parse','HEAD')},runner);assert.equal(record.outcome,'not-reviewed');assert.equal(runner.calls.length,0);
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

test('C17 local: JWT scanning checks overlapping candidates after invalid dotted prefixes',()=>{
 const jwt=[Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url'),'e30','j'.repeat(24)].join('.');
 for(const prefix of ['trace.','trace.info.','a.b.c.']){
  const value=prefix+jwt;
  assert.ok(scanSecrets(value,{patch:false}).length,prefix);
  for(const options of [{input:true},{},{diagnostic:true}]){
   const screened=screenModelOutput({note:value},options);
   assert.equal(screened.rejected,true,prefix);assert.ok(!JSON.stringify(screened.value).includes(jwt));
  }
 }
 assert.equal(screenModelOutput({note:'trace.info.ordinary'}).rejected,false);
});

test('v2 payload family table: AWS STS and all contracted families are screened in every sink',()=>{
 const synthetic=[
  'AKIA'+'A'.repeat(16),'ASIA'+'B'.repeat(16),
  ...['ghp_','gho_','ghu_','ghs_','ghr_','github_pat_'].map(prefix=>prefix+'c'.repeat(44)),
  'sk-'+'d'.repeat(24),'sk-ant-'+'e'.repeat(24),'xoxb-'+'f'.repeat(24),'AIza'+'g'.repeat(35),
  '-----BEGIN '+'ENCRYPTED PRIVATE KEY-----',
  [Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url'),'e30','j'.repeat(24)].join('.'),'Bearer '+'k'.repeat(24),
  [Buffer.from(' {"alg":"none"}').toString('base64url'),'e30',''].join('.'),
 ];
 for(const value of synthetic){
  assert.ok(scanSecrets(value,{patch:false}).length,value.slice(0,8));
  for(const options of [{input:true},{},{diagnostic:true}]){
   const screened=screenModelOutput({note:value},options);
   assert.equal(screened.rejected,true,value.slice(0,8));assert.ok(!JSON.stringify(screened.value).includes(value));
  }
 }
 for(const name of ['aws_secret_access_key','SecretAccessKey','aws_session_token','SessionToken','SeCrEt','authToken','password','passwd','credential','private key','private/key','api-key','sessionKey']){
  for(const value of ['synthetic',123456789,['synthetic'],{nested:'synthetic'}]){
   const screened=screenModelOutput({[name]:value});assert.equal(screened.rejected,true,name);assert.ok(!JSON.stringify(screened.value).includes('synthetic'));
  }
 }
 for(const source of ['password = fixture-value','pass_word: fixture-value','api key = fixture-value','foo = password = fixture-value'])assert.ok(scanSecrets(source,{patch:false}).length,source);
 assert.equal(screenModelOutput({session:'ordinary-session',sessionId:'ordinary-id',secretMatches:0}).rejected,false);
});
test('v2 AWS STS finding: pinned blob and contract refuse before any model launch',async t=>{
 const f=fixture(t),credentials={AccessKeyId:'ASIA'+'B'.repeat(16),SecretAccessKey:'fixture'+'a'.repeat(32),SessionToken:'fixture'+'b'.repeat(32)};
 for(const source of ['contract','blob']){
  const request={...f.request};
  if(source==='contract')request.contract=JSON.stringify(credentials);
  else {fs.writeFileSync(path.join(f.worktree,'input.mjs'),JSON.stringify(credentials));f.git('add','.');f.git('commit','-qm','synthetic STS');request.head=f.git('rev-parse','HEAD');}
  const runner=responder(),result=await runReviewRound(request,runner);
  assert.equal(result.outcome,'not-reviewed');assert.equal(runner.calls.length,0);assert.ok(!JSON.stringify(result).includes(credentials.SecretAccessKey));
 }
});
test('v2 decoder preserves escaped key pairing and fails closed beyond eight layers',()=>{
 const opaque='synthetic'+'m'.repeat(24);
 for(const depth of [1,2,3]){
  let key='pass'+String.raw`\u0077`+'ord';for(let i=1;i<depth;i++)key=key.replaceAll('\\','\\\\');
  const source=`JSON.parse('{"${key}":"${opaque}"}')`;
  for(const options of [{input:true},{},{diagnostic:true}]){
   const screened=screenModelOutput(source,options);assert.equal(screened.rejected,true);assert.ok(!JSON.stringify(screened.value).includes(opaque));
  }
 }
 let over='ordinary';for(let i=0;i<10;i++)over=JSON.stringify(over);
 assert.equal(screenModelOutput(over,{input:true}).rejected,true);
 // An invalid escape in a non-secret source key is already at a fixpoint.
 assert.equal(screenModelOutput(String.raw`JSON.parse('{"pass\uZZZZord":"synthetic"}')`,{input:true}).rejected,false);
 let safe={note:'ordinary'};for(let i=0;i<3;i++)safe=JSON.stringify(safe);
 assert.equal(screenModelOutput(safe,{input:true}).rejected,false);
});

test('v2 payload channels share successful/failed screening and encoded pairing checks',async t=>{
 const f=fixture(t),synthetic='ASIA'+'N'.repeat(16);
 for(const field of ['prompt','contract','rules','filenames','history','checkerEvidence','diagnostics','reason','summary','findings','quotes']){
  for(const options of [{input:true},{},{diagnostic:true}]){
   const screened=screenModelOutput({[field]:synthetic},options);assert.equal(screened.rejected,true,field);assert.ok(!JSON.stringify(screened.value).includes(synthetic));
  }
 }
 const runner=responder({findings:[sample],verdicts:[verdict({reason:synthetic})]});
 const record=await runReviewRound(f.request,runner);assert.equal(record.outcome,'not-reviewed');assert.ok(!JSON.stringify(record).includes(synthetic));assert.ok(!formatReviewReport(record).includes(synthetic));
 for(const source of [JSON.stringify({item:{text:JSON.stringify({reason:synthetic})}}),synthetic]){
  const result=await runReviewRound(f.request,responder({responses:[source,source]}));
  assert.equal(result.outcome,'not-reviewed');assert.equal(result.failures.filter(item=>item.role==='code-review').length,2);assert.ok(!JSON.stringify(result).includes(synthetic));
 }
 const key='pass'+String.raw`\u0077`+'ord',opaque='synthetic'+'z'.repeat(24);
 for(const source of [`JSON.parse('{"${key}":"${opaque}"}')`,`prefix {"note":"${synthetic}","note":"ordinary"}`]){
  for(const options of [{input:true},{}]){const screened=screenModelOutput(source,options);assert.equal(screened.rejected,true);assert.ok(!JSON.stringify(screened.value).includes(opaque));assert.ok(!JSON.stringify(screened.value).includes(synthetic));}
 }
});

test('v2 family table must cover multiline payload and patch sides',async t=>{
 const f=fixture(t);
 const credential='fixture'.repeat(5),value='Bearer\n '+credential;
 for(const options of [{input:true},{},{diagnostic:true}]){
  const lower=screenModelOutput({reason:value.toLowerCase()},options);assert.equal(lower.rejected,true);assert.ok(!JSON.stringify(lower.value).includes(credential));const result=screenModelOutput({reason:value},options);assert.equal(result.rejected,true);assert.ok(!JSON.stringify(result.value).includes(credential));
 }
 assert.ok(scanSecrets(value,{patch:false}).length);
 for(const sign of ['+','-'])assert.ok(scanSecrets('+++ b/input.txt\n@@ -1,2 +1,2 @@\n'+sign+'Bearer\n'+sign+' '+credential).length);
 const runner=responder(),record=await runReviewRound({...f.request,contract:value},runner);
 assert.equal(record.outcome,'not-reviewed');assert.equal(runner.calls.length,0);
 fs.writeFileSync(path.join(f.worktree,'input.mjs'),value);f.git('add','.');f.git('commit','-qm','synthetic multiline payload');
 const blobRunner=responder(),blobRecord=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},blobRunner);
 assert.equal(blobRecord.outcome,'not-reviewed');assert.equal(blobRunner.calls.length,0);
});

test('v2 unquoted secret-like names use the same any-separator rule in every payload screen',async t=>{
 const f=fixture(t);
 const credential='synthetic'+'v'.repeat(24),names=['privatekey','apikey','sessiontoken','sessionkey','secret','token','password','passwd','credential','secretaccesskey'];
 const payloads=['private/key: '+credential,...names.flatMap(name=>['/',';','=',':','_','-','.',' ','\t','|','+','!','—','\n'].map(separator=>name.split('').join(separator)+': '+credential))];
 for(const payload of payloads){
  assert.ok(scanSecrets(payload,{patch:false}).length,payload);
  for(const options of [{input:true},{},{diagnostic:true}]){const result=screenModelOutput({reason:payload},options);assert.equal(result.rejected,true,payload);assert.ok(!JSON.stringify(result.value).includes(credential));}
 }
 assert.equal(screenModelOutput({session:'ordinary',secretMatches:0}).rejected,false);
 const yaml='private/key: '+credential,runner=responder(),record=await runReviewRound({...f.request,contract:yaml},runner);
 assert.equal(record.outcome,'not-reviewed');assert.equal(runner.calls.length,0);assert.ok(record.secrets?.length);
 fs.writeFileSync(path.join(f.worktree,'input.mjs'),yaml);f.git('add','.');f.git('commit','-qm','synthetic unquoted key');
 const blobRunner=responder(),blob=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},blobRunner);
 assert.equal(blob.outcome,'clean');assert.equal(blobRunner.calls.length,1);
 assert.ok(blobRunner.calls.every(call=>!call.prompt.includes(credential)));assert.ok(!JSON.stringify(blob).includes(credential));
});

test('C17: successful Git stderr is captured and withheld before the round refuses a secret',t=>{
 const f=fixture(t),credential='ghp_'+'c'.repeat(36);
 fs.writeFileSync(path.join(f.worktree,'.gitattributes'),'input.mjs /'+credential+'\n');f.git('add','.');f.git('commit','-qm','invalid synthetic attribute');
 const request={...f.request,head:f.git('rev-parse','HEAD')};
 const source=`import {runReviewRound} from ${JSON.stringify(new URL('./code-review.mjs',import.meta.url).href)};let calls=0;const r=await runReviewRound(${JSON.stringify(request)},{runRole:async()=>{calls++;throw Error('unexpected model');}});console.log(JSON.stringify({record:r,calls}));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 assert.equal(child.status,0);assert.equal(child.stderr.includes(credential),false,'raw Git stderr escaped the circle');
 const result=JSON.parse(child.stdout);assert.equal(result.record.outcome,'not-reviewed');assert.equal(result.calls,0);
 assert.ok(result.record.failures.some(item=>/child process output withheld/.test(item.reason)));
 assert.equal(child.stdout.includes(credential),false);
});

test('C17/C19: outgoing child bytes are screened; unused catalog stderr is never forwarded',async t=>{
 const f=fixture(t),bin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-child-screen-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));
 const modeFile=path.join(bin,'mode'),credential='ghp_'+'d'.repeat(36),model=resolveReviewRoles({},packRoot)['code-review'].model;
 const fake=`#!${process.execPath}
 const fs=require('node:fs'),[stage,stream,flag]=fs.readFileSync(${JSON.stringify(modeFile)},'utf8').split(':');
 const secret=flag==='fixture'?'token = '+'ghp_'+'0'.repeat(36):flag==='key'?'private/key: synthetic-credential':${JSON.stringify(credential)},emit=value=>console.log(JSON.stringify(value));
 const hit=name=>stage===name,diagnostic=()=>{if(stream==='stderr')process.stderr.write(secret);};
 if(process.argv[2]==='debug'){emit({models:[{slug:${JSON.stringify(model)}}],...(flag==='fixture'?{file:'evals/code-review/secret-example.txt'}:{}),...(hit('catalog')&&stream==='stdout'?{note:secret}:{})});if(hit('catalog'))diagnostic();process.exit(0);}
 if(process.argv[2]==='login'){console.error('Logged in using ChatGPT');if(hit('auth')){if(stream==='stdout')console.log(secret);else diagnostic();}process.exit(0);}
 let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
 const name=input.startsWith('Boundary audit')?'probe':'role';
 const response=name==='probe'?{tools:['exec_command','write_stdin'],mcpServers:[]}:${JSON.stringify(review())};
 emit({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(response)}});
 emit({type:'turn.completed',...(hit(name)&&stream==='stdout'?{note:secret}:{})});
 if(hit(name)){diagnostic();if(flag==='fail')process.exitCode=1;}
 });`;
 fs.writeFileSync(path.join(bin,'codex'),fake,{mode:0o700});
 const source=`import {runReviewRound} from ${JSON.stringify(new URL('./code-review.mjs',import.meta.url).href)};console.log(JSON.stringify(await runReviewRound(${JSON.stringify(f.request)})));`;
 for(const mode of ['catalog:stdout','catalog:stderr','auth:stdout','auth:stderr','probe:stdout','probe:stderr','role:stdout','role:stderr','role:stderr:fail','catalog:stderr:key','auth:stdout:key','probe:stderr:key','role:stdout:key','catalog:stdout:fixture'])await t.test(mode,()=>{
  fs.writeFileSync(modeFile,mode);
  const child=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH},stdio:['ignore','pipe','pipe']});
  assert.equal(child.status,0);assert.equal(child.stderr.includes(credential),false);assert.equal(child.stdout.includes(credential),false);
  assert.equal(child.stderr.includes('synthetic-credential'),false);assert.equal(child.stdout.includes('synthetic-credential'),false);
  const record=JSON.parse(child.stdout);if(mode.startsWith('catalog:stderr')){assert.equal(record.outcome,'clean');assert.equal(record.rounds.length,1);}
  else{assert.equal(record.outcome,'not-reviewed');assert.equal(record.rounds.length,0);assert.ok(record.failures.some(item=>/withheld/.test(item.reason)),'outgoing process secret was not refused');}
 });
});

test('C18: 1 MiB harmless lines have bounded screening time without overlapping suffix rescans',()=>{
 for(const value of ['a-'.repeat(524288),'a_'.repeat(524288),'trace.'.repeat(174762),'e.'.repeat(524288),'I.'.repeat(524288),'e30.'.repeat(262144),'ghp_'.repeat(262144),'-----BEGIN '.repeat(95325)]){
  const started=performance.now(),screened=screenModelOutput(value,{input:true});
  assert.equal(screened.rejected,false);
  assert.ok(performance.now()-started<750,'1 MiB screen exceeded 750ms');
 }
});
test('C18: per-value size and cumulative JWT header work limits withhold before interpretation',()=>{
 for(const value of ['a'.repeat(MAX_SCREEN_VALUE_BYTES+1),'é'.repeat(MAX_SCREEN_VALUE_BYTES/2+1)]){
  assert.ok(scanSecrets(value,{patch:false}).length);
  for(const input of [true,false]){
   const result=screenModelOutput({note:value},{input});assert.equal(result.rejected,true);assert.ok(!JSON.stringify(result.value).includes(value));
   assert.throws(()=>screenModelOutput(value,{input,strict:true}),/withheld/);
  }
  assert.equal(screenModelOutput({[value]:'ordinary'}).rejected,true);
 }
 assert.equal(screenModelOutput('a'.repeat(MAX_SCREEN_VALUE_BYTES),{input:true}).rejected,false);
 assert.equal(screenModelOutput('e-'.repeat(2048)+'.b.c',{input:true}).rejected,false);
 const jwt=[Buffer.from(JSON.stringify({alg:'none'})).toString('base64url'),'e30',''].join('.');
 for(const prefix of ['trace.info.','invalid.','trace..'])assert.ok(scanSecrets(prefix+jwt,{patch:false}).length);
});

test('C18: an unterminated escaped literal is withheld without rescanning each escaped quote',()=>{
 const value=String.fromCharCode(34)+String.fromCharCode(92,34).repeat(524288);
 for(const input of [true,false]){const start=performance.now(),result=screenModelOutput(value,{input});assert.equal(result.rejected,true);assert.ok(performance.now()-start<750,'escaped-literal screen exceeded 750ms');}
});

test('C19: whole-token boundaries distinguish credentials from longer identifiers',()=>{
 const values=['AKIA'+'A'.repeat(16),'ASIA'+'B'.repeat(16),'ghp_'+'c'.repeat(36),'sk-'+'d'.repeat(24),'sk-ant-'+'e'.repeat(24),'xoxb-'+'f'.repeat(24),'AIza'+'g'.repeat(35)];
 for(const token of values){
  for(const prefix of ['', '(', '/', '.'])assert.ok(scanSecrets(prefix+token,{patch:false}).length,token.slice(0,8));
  for(const prefix of ['notes_','notes','task-','risk-','desk-'])assert.equal(scanSecrets(prefix+token,{patch:false}).length,0,token.slice(0,8));
 }
});
test('C18 local: a supported credential in a changed filename never reaches either role',async t=>{
 const f=fixture(t),token='ghp_'+'c'.repeat(36),file=token+'.txt';
 fs.writeFileSync(path.join(f.worktree,file),'Harmless notes.\n');f.git('add','.');f.git('commit','-qm','filename control');
 let calls=0;const result=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},{runRole:async()=>{calls++;return {response:review([],['input.mjs',file])};}});
 assert.equal(result.outcome,'not-reviewed');assert.equal(calls,0);assert.ok(!JSON.stringify(result).includes(token));
});

const realScreenFixture=path.join(packRoot,'evals/code-review/screen-regressions');
test('C19: real-byte regression fixtures retain host snapshot identities',()=>{
 for(const [file,sha] of [['codex-0.159.2-catalog.json','262dc36e0e7beb290aef8196bd59f42acf51647b8f7b68dafa533ae7742019e6'],['MONO-302.diff','c95056cbc1ec87b2e2c4b3c4aeadca097ffb4500dbe99d678b6ac65133da0f88'],['checker-r3.json','8aa830a8427d85f57012783f21931b2e13a1a3198d2592ad9a3f278921eda902']])assert.equal(createHash('sha256').update(fs.readFileSync(path.join(realScreenFixture,file))).digest('hex'),sha,file);
});
test('C19 MONO-326: successful JSON decoding and ordinary source backslashes are not ambiguous',()=>{
 assert.equal(parseChecker({completed:true,verdicts:[verdict({reason:String.raw`Use \"\w+\" in the matcher.`})]},[{...sample,key}]).verdicts.length,1);
 for(const value of [String.raw`Use "\w+" and "\p{L}" in the matcher.`,String.raw`/\w+\s/.test(value)`,String.raw`const text = \`line\nnext\`;`,JSON.stringify({reason:'a\nb "quoted" '+String.raw`/\w+/`}),{reason:String.raw`Use /\w+/ and \n in source`}])for(const options of [{input:true},{},{diagnostic:true}])assert.equal(screenModelOutput(value,options).rejected,false);
});
test('C19: all nine reconstructed real r3 checker answers remain valid',()=>{
 const entries=JSON.parse(fs.readFileSync(path.join(realScreenFixture,'checker-r3.json'),'utf8'));assert.equal(entries.length,9);
 for(const entry of entries)for(const answer of [entry.answer,JSON.stringify(entry.answer)])assert.equal(parseChecker(answer,entry.findings).verdicts.length,entry.findings.length,entry.run);
});
test('C19: actual MONO-302 diff bytes and contract reach a completed review round',async t=>{
 const data=JSON.parse(fs.readFileSync(path.join(realScreenFixture,'requests.json'),'utf8')),diff=fs.readFileSync(path.join(realScreenFixture,'MONO-302.diff'),'utf8');
 assert.equal(scanSecrets(diff).length,0);assert.equal(screenModelOutput(data.manual.contract,{input:true}).rejected,false);
 const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),diff);f.git('add','.');f.git('commit','-qm','real diff bytes');
 const runner=responder();const result=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD'),contract:data.manual.contract},runner);
 assert.equal(result.outcome,'clean');assert.equal(result.rounds.length,1);assert.equal(runner.calls.length,1);
});
test('C19: r4 tiny request reaches role launch with the actual Codex 0.159.2 catalog bytes',async t=>{
 const data=JSON.parse(fs.readFileSync(path.join(realScreenFixture,'requests.json'),'utf8')),states=JSON.parse(fs.readFileSync(path.join(realScreenFixture,'tiny-files.json'),'utf8'));
 const f=fixture(t);f.git('rm','input.mjs');fs.writeFileSync(path.join(f.worktree,'calc.py'),states.base);f.git('add','.');f.git('commit','-qm','real tiny base');const base=f.git('rev-parse','HEAD');
 fs.writeFileSync(path.join(f.worktree,'calc.py'),states.head);f.git('add','.');f.git('commit','-qm','real tiny head');const head=f.git('rev-parse','HEAD');
 const bin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-real-catalog-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));
 fs.copyFileSync(path.join(realScreenFixture,'codex-0.159.2-catalog.json'),path.join(bin,'catalog.json'));
 fs.writeFileSync(path.join(bin,'codex'),`#!/usr/bin/env node
 const fs=require('node:fs'),path=require('node:path');
 if(process.argv[2]==='debug'){fs.writeFileSync(1,fs.readFileSync(path.join(__dirname,'catalog.json')));process.exit(0);}
 if(process.argv[2]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}
 let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
 fs.appendFileSync(path.join(__dirname,'launches'),'launch\\n');
 const value=input.startsWith('Boundary audit')?{tools:['exec_command','write_stdin'],mcpServers:[]}:{completed:true,reviewedFiles:['calc.py'],findings:[]};
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}}));console.log(JSON.stringify({type:'turn.completed'}));});`,{mode:0o700});
 const prior=process.env.PATH;process.env.PATH=bin+path.delimiter+prior;
 try{const result=await runReviewRound({...f.request,base,head,contract:data.tiny.contract,risk:data.tiny.risk});assert.equal(result.outcome,'clean',JSON.stringify(result.failures));assert.equal(result.rounds.length,1);assert.equal(fs.readFileSync(path.join(bin,'launches'),'utf8').trim().split('\n').length,2);}
 finally{process.env.PATH=prior;}
});

test('C19/v4: prose and fixed placeholders stay benign; short and non-string assignments are caught',()=>{
 const benign=['task-'+'sk-'+'x'.repeat(24),'risk-repeat-stratification','desk-'+'sk-'+'x'.repeat(24),'dispatch-afk-leading-token: only leading AFK selects the short profile','- Changing a password or other authentication credential: Ask the user to take over',String.raw`/\w+/`, 'token: <placeholder-value>', 'password=${VARIABLE}', 'credential: ************', 'secret=""', '# password=opaque-value-long', '// token=opaque-value-long', '// note; token=abcdefgh', '# note; password=abcdefgh', 'const name = 1; // note; token=abcdefgh', '/* note; token=abcdefgh */'];
 for(const value of benign)for(const input of[true,false])assert.equal(screenModelOutput(value,{input}).rejected,false,value);
 for(const name of['token','password','api-key','session_token','foo-barPassword','ключPassword'])for(const value of[`export ${name}=opaque-value-long`,`MODE=test ${name}=opaque-value-long`,`ERROR: ${name}=opaque-value-long`,`${name}: opaque-value-long`,`--${name} opaque-value-long`,`--${name}=opaque-value-long`,JSON.stringify({[name]:'opaque-value-long'})])assert.equal(screenModelOutput(value,{input:true}).rejected,true,value);
 for(const value of['', '<placeholder>', '${VARIABLE}', '***'])assert.equal(screenModelOutput({password:value}).rejected,false);
 for(const value of[17,false,null,'short'])assert.equal(screenModelOutput({password:value}).rejected,true);
 assert.equal(screenModelOutput('api-key=short').rejected,true);
});

test('C19: decoded keys cannot overwrite a different key/value binding',async t=>{
 const ambiguous={['complet'+String.raw`\u0065`+'d']:false,completed:true};
 for(const value of[ambiguous,JSON.stringify(ambiguous)])for(const input of[true,false])assert.equal(screenModelOutput(value,{input}).rejected,true);
 const answer={...ambiguous,...review()},record=await runReviewRound(fixture(t).request,responder({responses:[answer,answer]}));
 assert.equal(record.outcome,'not-reviewed');assert.equal(record.rounds.length,0);
});

test('C19 local P1: URLs and in-word comment markers cannot hide subsequent credentials',()=>{
 const syntheticValue='opaqueFixture'+'u'.repeat(24);
 const produced=execFileSync('/bin/sh',['-c','MODE=x#y; printf "%s" "$MODE"'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 assert.equal(produced,'x#y');
 for(const source of[`curl https://example.test --password ${syntheticValue}`,`MODE=${produced} password=${syntheticValue}`,`MODE=x//y password=${syntheticValue}`,`MODE=x/*y password=${syntheticValue}`]){
  const answer={completed:true,verdicts:[verdict({reason:source})]};
  for(const value of[source,answer,JSON.stringify(answer)])for(const options of[{input:true},{},{diagnostic:true}]){
   const screened=screenModelOutput(value,options);assert.equal(screened.rejected,true,source);assert.ok(!JSON.stringify(screened.value).includes(syntheticValue));
  }
  assert.throws(()=>parseChecker(answer,[{...sample,key}]),/withheld/);
 }
});

test('C19: safe quoted text cannot suppress decoding of adjacent credential escapes',()=>{
 const opaque='opaqueFixture'+'m'.repeat(24),values=[String.raw`"bad\w \u0067hp_`+'a'.repeat(36)+'"',String.raw`\u0067hp_`+'a'.repeat(36)+' "safe"',String.raw`pass\u0077ord: `+JSON.stringify(opaque)];
 for(const value of values)for(const options of[{input:true},{},{diagnostic:true}]){const result=screenModelOutput(value,options);assert.equal(result.rejected,true);assert.ok(!JSON.stringify(result.value).includes(opaque));}
});
