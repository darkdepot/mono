import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound, runRemarkCheck, remarkDigest, prRemarkFindings, parseReviewer, parseChecker, findingKey, formatReviewReport, resolveReviewRoles, roleInvocation, subscriptionStatus, reviewGit, MAX_ANSWER_BYTES } from './code-review.mjs';
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
// Authored control-flow fixture, not live danger gold. C33 removes this label to test legacy unknowns.
const sample={danger:false,class:'missing-validation',file:'input.mjs',anchor:'return value',line:1,title:'Invalid input is accepted',trigger:'value is negative',evidence:'input.mjs returns value without validation'};
const transcripts=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/recorded-responses.json'),'utf8'));
const dangerControls=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/round2-checker-regressions.json'),'utf8'));
const key=findingKey(sample);
test('C52: malformed CLI request diagnostics never echo input or launch roles',async t=>{
 const f=fixture(t),bin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-c52-json-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));const value='probeC52',launched=path.join(bin,'launched'),requestFile=path.join(bin,'request.json');
 for(const engine of ['codex','claude'])fs.writeFileSync(path.join(bin,engine),`#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(launched)},'unexpected launch\\n');process.exit(91);\n`,{mode:0o700});
 const source=JSON.stringify({...f.request,contract:{['pass'+'word']:[value]}}).replace(JSON.stringify(value)+']',JSON.stringify(value)+',]');fs.writeFileSync(requestFile,source);
 const cases=[['manual report','code-review.mjs',['--request',requestFile],'review request JSON unreadable'],['manual JSON','code-review.mjs',['--request',requestFile,'--json'],'review request JSON unreadable'],['evaluation request','code-review-eval.mjs',['--request',requestFile],'review evaluation JSON input unreadable'],['evaluation dataset','code-review-eval.mjs',['--validate',requestFile,'--bundle',path.join(bin,'unused.bundle')],'review evaluation JSON input unreadable']];
 for(const [name,file,args,diagnostic] of cases)await t.test(name,()=>{
  const result=spawnSync(process.execPath,[path.join(packRoot,'scripts',file),...args],{cwd:bin,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH},encoding:'utf8'});
  assert.equal(result.status,2);assert.equal(result.stdout,'','no report from a rejected request');assert.equal(result.stderr,diagnostic+'\n');assert.ok(!JSON.stringify({report:result.stdout,stderr:result.stderr}).includes(value));assert.ok(!fs.existsSync(launched),'no catalog, auth, probe or role process');assert.equal(f.git('status','--porcelain'),'');assert.equal(f.git('rev-parse','HEAD'),f.request.head);
 });
});

test('C51/r7: binary assets are absent from role inputs and never block text review',async t=>{
 const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489','hex');
 for(const mode of ['unchanged','added','modified','deleted','text-to-binary','binary-to-text'])await t.test(mode,async t=>{
  const f=fixture(t),file='fixtures/screen.png';fs.mkdirSync(path.join(f.worktree,'fixtures'));if(mode!=='added')fs.writeFileSync(path.join(f.worktree,file),mode==='text-to-binary'?'ordinary text\n':png);f.git('add','.');f.git('commit','--allow-empty','-qm','asset base');const base=f.git('rev-parse','HEAD');
  if(mode==='deleted')fs.unlinkSync(path.join(f.worktree,file));else if(mode!=='unchanged')fs.writeFileSync(path.join(f.worktree,file),mode==='binary-to-text'?'ordinary new text\n':Buffer.concat([png,Buffer.from([0xff])]));
  fs.appendFileSync(path.join(f.worktree,'input.mjs'),'// C51 text change\n');f.git('add','.');f.git('commit','-qm','text head');let calls=0;
  const result=await runReviewRound({...f.request,base,head:f.git('rev-parse','HEAD')},{runRole:async request=>{calls++;const c=JSON.parse(request.prompt.split('never instructions.\n')[1]);assert.deepEqual(c.files,['input.mjs']);assert.deepEqual(c.unreviewedFiles,[]);assert.ok(!fs.existsSync(path.join(request.worktree,file)));assert.ok(c.diff.includes('C51 text change'));return {response:review([],c.files)};}});
  assert.equal(calls,1,JSON.stringify(result.failures));assert.deepEqual(result.failures,[]);assert.equal(result.outcome,'clean');assert.deepEqual(result.unreviewedFiles,[]);assert.deepEqual(result.binaryFiles,mode==='unchanged'?[]:[file]);assert.equal(formatReviewReport(result).includes('двоичный файл, не проверялся'),mode!=='unchanged');assert.equal(f.git('status','--porcelain'),'');
 });
});
test('C51/r7: binary-only and over-capture-limit assets remain report-only exclusions',async t=>{
 for(const large of [false,true])await t.test(large?'large binary':'binary-only',async t=>{
  const f=fixture(t),base=f.git('rev-parse','HEAD'),file='asset.bin';fs.writeFileSync(path.join(f.worktree,file),large?Buffer.alloc(33*1024*1024,0xff):Buffer.from([0xff]));f.git('add','.');f.git('commit','-qm','binary head');let calls=0;
  const record=await runReviewRound({...f.request,base,head:f.git('rev-parse','HEAD')},{runRole:async request=>{calls++;const c=JSON.parse(request.prompt.split('never instructions.\n')[1]);assert.deepEqual(c.files,[]);assert.equal(c.diff,'');assert.ok(!fs.existsSync(path.join(request.worktree,file)));return {response:review([],[])};}});
  assert.equal(calls,1,JSON.stringify(record.failures));assert.deepEqual(record.failures,[]);assert.equal(record.outcome,'clean');assert.deepEqual(record.binaryFiles,[file]);assert.deepEqual(record.unreviewedFiles,[]);assert.match(formatReviewReport(record),/asset\.bin; двоичный файл, не проверялся/);
 });
});
test('C51/r7: binary exclusions cover both round-two views',async t=>{
 for(const mode of ['task-base','previous-round'])await t.test(mode,async t=>{
  const f=fixture(t),file='asset.bin',value='export const C51_BINARY_TRANSITION = 1;\n';fs.writeFileSync(path.join(f.worktree,file),mode==='task-base'?Buffer.from([0xff]):value);f.git('add','.');f.git('commit','-qm','asset base');const base=f.git('rev-parse','HEAD');
  fs.writeFileSync(path.join(f.worktree,file),mode==='task-base'?value:Buffer.from([0xff]));fs.appendFileSync(path.join(f.worktree,'input.mjs'),'// first text edit\n');f.git('add','.');f.git('commit','-qm','first round');const first=await runReviewRound({...f.request,base,head:f.git('rev-parse','HEAD')},responder({findings:[sample]}));assert.equal(first.outcome,'not-converged',JSON.stringify(first.failures));
  fs.writeFileSync(path.join(f.worktree,file),value+'// second asset edit\n');fs.appendFileSync(path.join(f.worktree,'input.mjs'),'// second text edit\n');f.git('add','.');f.git('commit','-qm','second round');const roles=[];
  const record=await runReviewRound({...f.request,base,head:f.git('rev-parse','HEAD'),stageRecord:first},{runRole:async request=>{roles.push(request.role);const c=JSON.parse(request.prompt.split('never instructions.\n')[1]);assert.ok(!request.prompt.includes('C51_BINARY_TRANSITION'));assert.deepEqual(c.files,['input.mjs']);assert.ok(!fs.existsSync(path.join(request.worktree,file)));return {response:request.role==='code-review'?review([],c.files):{completed:true,verdicts:[verdict()]}};}});
  assert.deepEqual(roles,['code-review','code-review-checker']);assert.deepEqual(record.failures,[]);assert.equal(record.outcome,'not-converged');assert.deepEqual(record.binaryFiles,[file]);assert.deepEqual(record.unreviewedFiles,[]);
 });
});
test('C51/r7: unreadable role answers keep the existing single retry and measured costs',async t=>{
 const f=fixture(t);
 assert.throws(()=>parseReviewer(' '.repeat(MAX_ANSWER_BYTES+1)),/size limit/);assert.throws(()=>parseReviewer('[]'),/object required/);
 for(const bad of ['{"completed":true,"verdicts":[',{completed:true,verdicts:[]},{completed:true,verdicts:[],extra:'field'}]){
  const runner=responder({responses:[review([sample]),bad,bad]}),record=await runReviewRound(f.request,runner);
  assert.equal(record.outcome,'not-reviewed');assert.equal(record.rounds.length,0);assert.equal(runner.calls.length,3);const failed=record.costs.filter(cost=>cost.role==='code-review-checker');assert.equal(failed.length,2);assert.ok(failed.every(cost=>cost.usage.input_tokens===12));assert.equal(record.failures.filter(failure=>failure.role==='code-review-checker').length,2);
 }
});
const hostR6=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/host-r6-regressions.json'),'utf8'));
test('C50: scope and risk are the OR over all rounds before reopening shortcuts and cannot be cleared by rejection',async t=>{
 for(const flag of ['outOfContract','riskRaised'])for(const outcome of ['confirmed','rejected','unresolved'])await t.test(`${flag}/${outcome}`,async t=>{
  const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({outcome:'rejected'})]}));assert.equal(first.outcome,'clean');
  const second=await runReviewRound({...f.request,stageRecord:first},responder({findings:[sample],verdicts:[verdict({outcome,[flag]:true,newEvidence:false})]}));assert.equal(second.findings[0][flag],true);assert.equal(second.outcome,'not-converged');
  const third=await runReviewRound({...f.request,stageRecord:second},responder({findings:[sample],verdicts:[verdict({outcome:'rejected',closed:true,newEvidence:true,[flag]:false})]}));assert.equal(third.findings[0][flag],true);assert.equal(third.outcome,'not-converged');assert.equal(third.findings[0].dangerMaximum,false);
 });
});

test('an amended contract judges scope and risk objections again; same contract keeps them',async t=>{
 for(const flag of ['outOfContract','riskRaised'])await t.test(flag,async t=>{
  const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({outcome:'rejected',[flag]:true})]}));assert.equal(first.outcome,'not-converged');
  const approved=responder({findings:[],verdicts:[verdict({outcome:'rejected',closed:true,[flag]:false})]});
  const amended=await runReviewRound({...f.request,contract:'changed',stageRecord:first},approved);
  assert.match(approved.calls.at(-1).prompt,/missing-validation/,'the objection goes back to the checker');
  assert.deepEqual([amended.findings[0][flag],amended.outcome],[false,'clean'],'the amendment approved the disputed work');
  const kept=await runReviewRound({...f.request,contract:'changed',stageRecord:first},responder({findings:[],verdicts:[verdict({outcome:'rejected',closed:true,[flag]:true})]}));
  assert.deepEqual([kept.findings[0][flag],kept.outcome],[true,'not-converged'],'a raised objection stands');
  const same=await runReviewRound({...f.request,stageRecord:first},responder({findings:[],verdicts:[verdict({outcome:'rejected',closed:true,[flag]:false})]}));
  assert.deepEqual([same.findings[0][flag],same.outcome],[true,'not-converged'],'without an amendment the flag is sticky');
 });
});

test('PR remarks enter the round as open findings; a fix closes only when the checker verifies it on the new head',async t=>{
 const f=fixture(t),older=f.request.base,remark=(extra={})=>({id:'PRRT_1',source:'bot',file:'input.mjs',line:1,title:'Negative input passes',body:'value(-1) returns -1',urgent:false,head:older,...extra});
 const [seeded]=prRemarkFindings([remark()]);
 const fixed=await runReviewRound({...f.request,remarks:[remark()]},responder({verdicts:[verdict({outcome:'rejected',closed:true,reason:'The new guard rejects negative input.'})]}));
 assert.deepEqual([fixed.outcome,fixed.findings[0].key,fixed.findings[0].status],['clean',seeded.key,'closed'],'a verified fix closes the bot remark');
 const dismissed=await runReviewRound({...f.request,remarks:[remark()]},responder({verdicts:[verdict({outcome:'rejected',closed:false})]}));
 assert.equal(dismissed.outcome,'not-converged','a remark sent as fixed is not dismissed in the round; that is the read-only pass\'s job');
 const runner=responder({verdicts:[verdict()]}),open=await runReviewRound({...f.request,remarks:[remark()]},runner);
 assert.equal(open.outcome,'not-converged','an unfixed remark keeps the round open');
 assert.match(runner.calls[0].prompt,/value\(-1\) returns -1/,'the reviewer sees the remark among open findings');
 const urgent=await runReviewRound({...f.request,remarks:[remark({urgent:true,head:f.request.head})]},responder({verdicts:[verdict({outcome:'rejected',danger:false,dangerCase:null})]}));
 assert.equal(urgent.outcome,'not-converged','a P0/P1 remark is not dismissed without a verified fix');
 const urgentFixed=await runReviewRound({...f.request,remarks:[remark({urgent:true})]},responder({verdicts:[verdict({outcome:'rejected',closed:true,danger:true,dangerCase:'gate-bypass',dangerReason:'Stale work passed the gate.'})]}));
 assert.equal(urgentFixed.outcome,'clean','a P0/P1 remark closes with a verified fix on the new head');
 const reported=await runReviewRound({...f.request,remarks:[remark()]},responder({findings:[{class:'pr-remark',file:'input.mjs',anchor:'bot PRRT_1',line:1,title:'still there',trigger:'value is negative',evidence:'input.mjs returns n'}],verdicts:[verdict({outcome:'rejected',closed:true})]}));
 assert.equal(reported.outcome,'not-converged','the reviewer reporting the same remark again keeps it open');
 const edited=await runReviewRound({...f.request,stageRecord:fixed,remarks:[remark({body:'value(-2) still returns -2'})]},runner);
 assert.match(runner.calls.at(-1).prompt,/value\(-2\) still returns -2/,'a changed remark reaches the round with its new text');
 for(const bad of [{...remark(),id:'bad id'},{...remark(),source:'chat'},{...remark(),file:'../x'},{...remark(),head:'x'},{...remark(),extra:1}])assert.throws(()=>prRemarkFindings([bad]));
 assert.throws(()=>prRemarkFindings([remark(),remark()]),/repeated/);
});
test('remark check: a fresh read-only pass on the checker engine confirms or sends back each decision without a code change',async t=>{
 const f=fixture(t),remarks=[{id:'B1',source:'bot',title:'Summary',body:'Greptile summary',urgent:false,head:f.request.head,decision:'informational',evidence:'No change requested.'},
  {id:'T2',source:'bot',title:'Rename',body:'Rename value',urgent:true,head:f.request.head,decision:'rejected',evidence:'Public name.'}];
 const calls=[];const runRole=async request=>{calls.push(request);return {response:{completed:true,verdicts:[{id:'B1',verdict:'confirmed',reason:'summary only'},{id:'T2',verdict:'needs-fix',reason:'name misleads'}]},elapsedMs:5,usage:null};};
 const result=await runRemarkCheck({worktree:f.worktree,head:f.request.head,base:f.request.base,remarks,packRoot},{runRole});
 assert.equal(calls.length,1);assert.equal(calls[0].role,'remark-check');assert.equal(calls[0].route.engine,resolveReviewRoles({},packRoot)['code-review-checker'].engine);
 assert.match(calls[0].prompt,/^# PR remark check/);assert.match(calls[0].prompt,/Greptile summary/);
 assert.deepEqual(result.verdicts.map(v=>v.verdict),['confirmed','needs-fix']);assert.deepEqual(result.remarks,remarks.map(remark=>({id:remark.id,digest:remarkDigest(remark),decision:remark.decision})));assert.equal(result.head,f.request.head);
 await assert.rejects(runRemarkCheck({worktree:f.worktree,head:f.request.head,base:f.request.base,remarks,packRoot},{runRole:async()=>({response:{completed:true,verdicts:[{id:'B1',verdict:'confirmed',reason:'r'}]}})}),/remark without verdict/);
 await assert.rejects(runRemarkCheck({worktree:f.worktree,head:f.request.head,base:f.request.base,remarks:[{...remarks[0],decision:'fixed'}],packRoot},{runRole}),/invalid remark decision/);
 await assert.rejects(runRemarkCheck({worktree:f.worktree,head:f.request.head,base:f.request.base,remarks:[{...remarks[1],decision:'deferred'}],packRoot},{runRole}),/urgent remark cannot be deferred/);
 await assert.rejects(runRemarkCheck({worktree:f.worktree,head:f.request.head,base:f.request.base,remarks:[{...remarks[0],source:'owner'}],packRoot},{runRole}),/invalid remark decision/,'an owner instruction is never declined by the pass');
 fs.writeFileSync(path.join(f.worktree,'dirty.txt'),'x');await assert.rejects(runRemarkCheck({worktree:f.worktree,head:f.request.head,base:f.request.base,remarks,packRoot},{runRole}),/clean pinned HEAD/);
});

test('C45: executable BOM additions and removals remain visible in diff hunks and checker evidence',async t=>{
 for(const adding of [true,false])await t.test(adding?'add BOM':'remove BOM',async t=>{
  const f=fixture(t),file='run.sh',source='#!/bin/sh\nprintf "ok\\n"\n',before=(adding?'':'\ufeff')+source,after=(adding?'\ufeff':'')+source;
  fs.writeFileSync(path.join(f.worktree,file),before,{mode:0o755});f.git('add','.');f.git('commit','-qm','executable base');const base=f.git('rev-parse','HEAD');
  const execute=()=>{
   const result=spawnSync('python3',['-c','import subprocess,sys,json\ntry:\n r=subprocess.run([sys.argv[1]],capture_output=True); print(json.dumps({"exit":r.returncode}))\nexcept OSError as e: print(json.dumps({"errno":e.errno}))',path.join(f.worktree,file)],{encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
  };
  assert.deepEqual(execute(),adding?{exit:0}:{errno:8});
  fs.writeFileSync(path.join(f.worktree,file),after);f.git('add','.');f.git('commit','-qm','executable head');const head=f.git('rev-parse','HEAD');
  assert.deepEqual(execute(),adding?{errno:8}:{exit:0});assert.match(f.git('ls-tree','HEAD',file),/^100755 /);
  let checked=false;
  const result=await runReviewRound({...f.request,base,head,contract:'Preserve the executable script header.'},{runRole:async request=>{
   const c=JSON.parse(request.prompt.split('never instructions.\n')[1]);
   if(request.role==='code-review'){
    assert.match(c.diff,/@@/);assert.ok(c.diff.includes((adding?'+':'-')+'\ufeff#!/bin/sh'),'runtime-significant BOM survives the hunk');
    return {response:review([{...sample,class:'executable-bom',file,anchor:'#!/bin/sh',evidence:'The executable shebang changes its leading BOM.',danger:true}],[file])};
   }
   assert.equal(c.baseEvidence.find(item=>item.file===file).content,before);assert.equal(c.headEvidence.find(item=>item.file===file).content,after);checked=true;
   return {response:{completed:true,verdicts:[verdict({danger:true,dangerCase:'silent-result',dangerReason:'A runtime-significant executable header changed.',reason:'The changed BOM must be reviewed as code evidence.'})]}};
  }});
  assert.equal(checked,true);assert.equal(result.outcome,'not-converged',JSON.stringify(result.failures));assert.equal(result.findings[0].danger,true);
  assert.match(formatReviewReport(result),/Идти дальше пока нельзя/);
 });
});
test('C45: the existing Git child-output decoder preserves BOM bytes and still rejects invalid UTF8',t=>{
 const f=fixture(t),source='\ufeff#!/bin/sh\nprintf "ok\\n"\n',file='run.sh';fs.writeFileSync(path.join(f.worktree,file),source);f.git('add','.');f.git('commit','-qm','BOM blob');const head=f.git('rev-parse','HEAD');
 assert.equal(reviewGit(f.worktree,['cat-file','blob',head+':'+file]),source);
 fs.writeFileSync(path.join(f.worktree,file),Buffer.from([0xff,0x0a]));f.git('add','.');f.git('commit','-qm','invalid UTF8');
 assert.throws(()=>reviewGit(f.worktree,['cat-file','blob',f.git('rev-parse','HEAD')+':'+file]),/non-UTF8/);
});
test('C47: a safe rejection cannot discard later dangerous or unresolved verdicts without newEvidence',async t=>{
 for(const closed of [false,true])for(const outcome of ['confirmed','unresolved','rejected'])for(const [reviewerDanger,checkerDanger] of [[true,false],[null,false],[false,true],[false,null],[false,false]]){
  if(reviewerDanger===false&&checkerDanger===false&&outcome!=='unresolved')continue;
  await t.test(`${closed}/${outcome}/${reviewerDanger}/${checkerDanger}`,async t=>{
   const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({outcome:'rejected',closed})]}));
   assert.equal(first.outcome,'clean');
   const second=await runReviewRound({...f.request,stageRecord:JSON.parse(JSON.stringify(first))},responder({findings:[{...sample,danger:reviewerDanger}],verdicts:[verdict({outcome,danger:checkerDanger,dangerCase:checkerDanger===false?null:'unknown',newEvidence:false})]}));
   assert.equal(second.outcome,'not-converged',JSON.stringify(second.failures));
   assert.equal(second.findings[0].status,outcome==='rejected'?'unresolved':outcome);assert.equal(second.findings[0].closed,false);
   assert.equal(second.findings[0].danger,reviewerDanger!==false||checkerDanger!==false);
   assert.match(formatReviewReport(second),/Идти дальше пока нельзя/);
  });
 }
});
test('C47: maximum danger survives serialized rounds, weaker later flags and original-origin changes',async t=>{
 for(const [initial,later,maximum] of [[null,false,null],[null,true,true],[true,null,true],[true,false,true]])await t.test(`${initial}/${later}`,async t=>{
  const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[{...sample,danger:initial}],verdicts:[verdict({danger:false,origin:'contract'})]}));
  assert.equal(first.outcome,'not-converged');assert.equal(first.findings[0].dangerMaximum,initial);
  const second=await runReviewRound({...f.request,stageRecord:JSON.parse(JSON.stringify(first))},responder({findings:[{...sample,danger:later}],verdicts:[verdict({danger:false,origin:'pre-existing',outcome:'rejected',closed:true})]}));
  assert.equal(second.outcome,'not-converged');assert.equal(second.findings[0].dangerMaximum,maximum);assert.equal(second.findings[0].danger,true);assert.equal(second.findings[0].origin,'contract');assert.equal(second.findings[0].status,'unresolved');
  const third=await runReviewRound({...f.request,stageRecord:JSON.parse(JSON.stringify(second))},responder({verdicts:[verdict({outcome:'rejected',closed:true})]}));
  assert.equal(third.outcome,'not-converged');assert.equal(third.findings[0].dangerMaximum,maximum);assert.equal(third.findings[0].status,'unresolved');assert.deepEqual(third.successorKeys,[]);
 });
});
test('C47: dangerous legacy closures are rechecked even without reviewer rediscovery',async t=>{
 const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[{...sample,danger:true}],verdicts:[verdict({danger:true,dangerCase:'security'})]}));
 const legacy=JSON.parse(JSON.stringify(first));delete legacy.findings[0].dangerMaximum;Object.assign(legacy.findings[0],{status:'rejected',outcome:'rejected',closed:true});
 const runner=responder({verdicts:[verdict({outcome:'rejected',closed:true})]}),next=await runReviewRound({...f.request,stageRecord:legacy},runner);
 assert.equal(runner.calls.length,2,'legacy dangerous key still needs a checker answer');assert.equal(next.outcome,'not-converged');assert.equal(next.findings[0].danger,true);assert.equal(next.findings[0].status,'unresolved');
});
test('C47: all reviewer passes contribute to the maximum before a checker rejection',async t=>{
 for(const danger of [true,null])await t.test(String(danger),async t=>{
  const f=fixture(t);let pass=0;
  const result=await runReviewRound({...f.request,risk:'risky'},{runRole:async request=>({response:request.role==='code-review'?review([{...sample,danger:pass++===0?danger:false}]):{completed:true,verdicts:[verdict({outcome:'rejected'})]}})});
  assert.equal(pass,2);assert.equal(result.outcome,'not-converged');assert.equal(result.findings[0].dangerMaximum,danger);assert.equal(result.findings[0].status,'unresolved');
 });
});
test('C47: host r6 probes stay disputed after a previous safe rejection of the same key',async t=>{
 for(const probe of hostR6.probes)await t.test(probe.runId,async t=>{
  const f=fixture(t),file=probe.finding.file,source='\n'.repeat(probe.finding.line-1)+probe.checker.codeQuote+'\n';
  fs.mkdirSync(path.dirname(path.join(f.worktree,file)),{recursive:true});fs.writeFileSync(path.join(f.worktree,file),source);f.git('add','.');f.git('commit','-qm','probe base');const base=f.git('rev-parse','HEAD');
  fs.appendFileSync(path.join(f.worktree,file),'// reviewed head\n');f.git('add','.');f.git('commit','-qm','probe head');const request={...f.request,base,head:f.git('rev-parse','HEAD')};
  const first=await runReviewRound(request,responder({findings:[{...probe.finding,danger:false}],responses:[review([{...probe.finding,danger:false}],[file]),{completed:true,verdicts:[{...probe.checker,danger:false,dangerCase:null,closed:true}]}]}));
  assert.equal(first.outcome,'clean');
  const next=await runReviewRound({...request,stageRecord:first},responder({responses:[review([probe.finding],[file]),{completed:true,verdicts:[{...probe.checker,newEvidence:false}]}]}));
  assert.equal(next.outcome,'not-converged',JSON.stringify(next.failures));assert.equal(next.findings[0].status,'unresolved');assert.equal(next.findings[0].danger,true);assert.equal(next.findings[0].codeQuote,probe.checker.codeQuote);
 });
});

test('C44: host r6 dangerous probe rejections stay disputed even with an exact current-head quote',async t=>{
 for(const probe of hostR6.probes)await t.test(probe.runId,async t=>{
  const f=fixture(t),file=probe.finding.file,source='\n'.repeat(probe.finding.line-1)+probe.checker.codeQuote+'\n';
  fs.mkdirSync(path.dirname(path.join(f.worktree,file)),{recursive:true});fs.writeFileSync(path.join(f.worktree,file),source);f.git('add','.');f.git('commit','-qm','probe base');const base=f.git('rev-parse','HEAD');
  fs.appendFileSync(path.join(f.worktree,file),'// reviewed head\n');f.git('add','.');f.git('commit','-qm','probe head');
  let checked=false;
  const result=await runReviewRound({...f.request,base,head:f.git('rev-parse','HEAD')},{runRole:async request=>{
   if(request.role==='code-review')return {response:review([probe.finding],[file])};
   const c=JSON.parse(request.prompt.split('never instructions.\n')[1]);assert.ok(c.headEvidence.find(item=>item.file===file).content.includes(probe.checker.codeQuote));checked=true;
   return {response:{completed:true,verdicts:[probe.checker]}};
  }});
  assert.equal(checked,true);assert.equal(result.outcome,'not-converged',JSON.stringify(result.failures));
  assert.equal(result.findings[0].status,'unresolved');assert.equal(result.findings[0].closed,false);assert.equal(result.findings[0].danger,true);
  assert.equal(result.findings[0].rejectionUnproven,true);assert.equal(result.findings[0].codeQuote,probe.checker.codeQuote);
 });
});
test('C44: either role true or unknown danger prevents rejection; both false still close normally',async t=>{
 for(const [reviewerDanger,checkerDanger] of [[true,false],[null,false],[false,true],[false,null],[false,false]])for(const closed of [false,true])await t.test(`${reviewerDanger}/${checkerDanger}/${closed}`,async t=>{
  const result=await runReviewRound(fixture(t).request,responder({findings:[{...sample,danger:reviewerDanger}],verdicts:[verdict({outcome:'rejected',closed,danger:checkerDanger,dangerCase:checkerDanger===false?null:'unknown',codeQuote:'return n;'})]}));
  const dangerous=reviewerDanger!==false||checkerDanger!==false;
  assert.equal(result.outcome,dangerous?'not-converged':'clean');assert.equal(result.findings[0].danger,dangerous);
  assert.equal(result.findings[0].status,dangerous?'unresolved':closed?'closed':'rejected');assert.equal(result.findings[0].closed,!dangerous&&closed);
 });
});
test('C44: the pinned file export preserves BOM and source escape bytes',async t=>{
 const f=fixture(t),source='\ufeffexport const re = /\\n/;\n',file='notes.mjs';
 fs.writeFileSync(path.join(f.worktree,file),source);f.git('add','.');f.git('commit','-qm','BOM base');const base=f.git('rev-parse','HEAD');
 fs.appendFileSync(path.join(f.worktree,file),'// safe addition\n');f.git('add','.');f.git('commit','-qm','BOM head');let observed;
 const result=await runReviewRound({...f.request,base,head:f.git('rev-parse','HEAD')},{runRole:async request=>{observed=fs.readFileSync(path.join(request.worktree,file));return {response:review([],[file])};}});
 assert.deepEqual(observed,Buffer.from(source+'// safe addition\n'));assert.equal(result.outcome,'clean');
});
test('C43: reopening a closed or rejected dangerous finding preserves its danger and original origin',async t=>{
 for(const [closed,origin] of [[true,'introduced'],[false,'contract']])await t.test(closed?'closed':'rejected',async t=>{
  const f=fixture(t),dangerous={...sample,danger:true};
  const first=await runReviewRound(f.request,responder({findings:[dangerous],verdicts:[verdict({danger:true,dangerCase:'silent-result',dangerReason:'Negative input silently breaks the result contract.',origin})]}));
  const second=await runReviewRound({...f.request,stageRecord:first},responder({verdicts:[verdict({outcome:'rejected',closed,codeQuote:'export function value(n) { return n; }'})]}));
  assert.equal(second.findings[0].status,'unresolved');assert.equal(second.findings[0].closed,false);assert.equal(second.findings[0].danger,true);
  // Replay a historical pre-C44 closure/rejection to preserve C43's legacy reopening boundary.
  const legacy={...second,findings:second.findings.map(item=>({...item,status:closed?'closed':'rejected',outcome:'rejected',closed}))};
  for(const outcome of ['confirmed','rejected']){
   const third=await runReviewRound({...f.request,stageRecord:legacy},responder({findings:[sample],verdicts:[verdict({outcome,newEvidence:true,origin:'pre-existing'})]}));
   assert.equal(third.findings[0].danger,true,'saved danger cannot be removed when the same key returns');
   assert.equal(third.findings[0].origin,origin,'saved dangerous provenance cannot be changed by reopening');
   assert.equal(third.findings[0].status,outcome==='confirmed'?'confirmed':'unresolved','dangerous rejection stays disputed even after a legacy closure');
   assert.equal(third.outcome,'not-converged');assert.equal(third.rounds.length,3);
  }
 });
});
test('C35/C44: pinned deletion is recorded and closes a dangerous or unmarked finding once the reviewer stops reporting it',async t=>{
 for(const fromBase of [true,false])for(const danger of [true,undefined])await t.test(String(fromBase)+'/'+String(danger),async t=>{
  const f=fixture(t),file=fromBase?'input.mjs':'added.mjs';
  if(!fromBase){fs.writeFileSync(path.join(f.worktree,file),'export const ordinary = 1;\n');f.git('add','.');f.git('commit','-qm','introduce affected file');}
  const finding={...sample,file};if(danger===undefined)delete finding.danger;else finding.danger=danger;
  const first=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},{runRole:async request=>{
   const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);return {response:request.role==='code-review'?review([finding],context.files):{completed:true,verdicts:[verdict()]}};
  }});assert.equal(first.outcome,'not-converged',JSON.stringify(first.failures));
  fs.unlinkSync(path.join(f.worktree,file));f.git('add','.');f.git('commit','-qm','delete affected file');const head=f.git('rev-parse','HEAD');
  const result=await runReviewRound({...f.request,head,stageRecord:first},{runRole:async request=>{
   const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);return {response:request.role==='code-review'?review([],context.files):{completed:true,verdicts:[verdict({outcome:'rejected',closed:true,reason:'The affected file was deleted.'})]}};
  }});
  assert.equal(result.outcome,'clean',JSON.stringify(result.failures));assert.equal(result.findings[0].status,'closed');assert.equal(result.findings[0].closed,true);assert.equal(result.findings[0].danger,true);
  assert.deepEqual(result.findings[0].deletionEvidence,{before:fromBase?f.request.base:first.round.head,head});
  fs.writeFileSync(path.join(f.worktree,'other.mjs'),'export const other = 1;\n');f.git('add','.');f.git('commit','-qm','later unrelated change');
  const later=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD'),stageRecord:result},{runRole:async request=>{
   const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);return {response:request.role==='code-review'?review([],context.files):{completed:true,verdicts:[verdict({outcome:'rejected',closed:true,reason:'The affected file stays deleted.'})]}};
  }});
  assert.equal(later.outcome,'clean',JSON.stringify(later.failures));assert.equal(later.findings[0].status,'closed','an agreed fix stays closed after its file left the diff');
 });
});
test('an established data, security or gate-bypass case survives a later uncertain verdict',async t=>{
 const f=fixture(t),finding={...sample,danger:true};
 const roles=verdicts=>({runRole:async request=>{const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);
  return {response:request.role==='code-review'?review([finding],context.files):{completed:true,verdicts}};}});
 const first=await runReviewRound(f.request,roles([verdict({weight:'P3',danger:true,dangerCase:'data',dangerReason:'Retained records are overwritten.'})]));
 assert.equal(first.findings[0].dangerCase,'data');
 fs.appendFileSync(path.join(f.worktree,'input.mjs'),'// later\n');f.git('add','.');f.git('commit','-qm','later');
 const second=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD'),stageRecord:first},roles([verdict({weight:'P3',outcome:'unresolved',danger:null,dangerCase:'unknown',dangerReason:'Cannot exclude the earlier effect.'})]));
 assert.equal(second.findings[0].dangerCase,'data','the strict case is not downgraded to unknown');assert.equal(second.findings[0].status,'unresolved');
});
test('a dangerous finding closes only by an agreed fix on a later head and then stays closed',async t=>{
 const f=fixture(t),finding={...sample,danger:true},danger={danger:true,dangerCase:'silent-result',dangerReason:'Wrong values reach callers.'};
 const roles=(findings,verdicts)=>({runRole:async request=>{const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);
  return {response:request.role==='code-review'?review(findings,context.files):{completed:true,verdicts}};}});
 const commit=text=>{fs.appendFileSync(path.join(f.worktree,'input.mjs'),text);f.git('add','.');f.git('commit','-qm',text.trim());return f.git('rev-parse','HEAD');};
 const closing=[verdict({...danger,outcome:'rejected',closed:true,reason:'The new guard rejects the input.'})];
 const first=await runReviewRound(f.request,roles([finding],[verdict(danger)]));
 assert.equal(first.outcome,'not-converged');assert.equal(first.findings[0].danger,true);
 let head=commit('// guard\n');
 const disputed=await runReviewRound({...f.request,head,stageRecord:first},roles([finding],closing));
 assert.equal(disputed.findings[0].status,'unresolved','the reviewer still reports it');assert.equal(disputed.outcome,'not-converged');
 const second=await runReviewRound({...f.request,head,stageRecord:first},roles([],closing));
 assert.equal(second.findings[0].status,'closed','checker verified the fix and the reviewer stopped reporting it');assert.equal(second.outcome,'clean');assert.equal(second.findings[0].danger,true);
 head=commit('// later\n');
 const third=await runReviewRound({...f.request,head,stageRecord:second},roles([],closing));
 assert.equal(third.round.number,3);assert.equal(third.findings[0].status,'closed','it stays closed');assert.equal(third.outcome,'clean');
 const reopened=await runReviewRound({...f.request,head,stageRecord:second},roles([finding],closing));
 assert.equal(reopened.findings[0].status,'unresolved','a new report reopens it');assert.equal(reopened.outcome,'not-converged');
});
test('C58: present unavailable files cannot become deletion evidence or close an open finding',async t=>{
 for(const state of ['binary','directory'])await t.test(state,async t=>{
  const f=fixture(t),file='input.mjs';
  const first=await runReviewRound(f.request,responder({findings:[sample]}));
  assert.equal(first.outcome,'not-converged');assert.equal(first.findings[0].danger,false);
  if(state==='directory'){fs.unlinkSync(path.join(f.worktree,file));fs.mkdirSync(path.join(f.worktree,file));fs.writeFileSync(path.join(f.worktree,file,'ordinary.txt'),'ordinary content\n');}
  else fs.writeFileSync(path.join(f.worktree,file),Buffer.from([0,255]));
  f.git('add','.');f.git('commit','-qm','C58 present unavailable path');const head=f.git('rev-parse','HEAD');
  assert.ok(f.git('ls-tree',head,'--',file).includes(file));let checkerCalls=0,headEvidence;
  const result=await runReviewRound({...f.request,head,stageRecord:first},{runRole:async request=>{
   const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);
   if(request.role==='code-review')return {response:review([],context.files)};
   checkerCalls++;headEvidence=context.headEvidence.find(item=>item.file===file);
   return {response:{completed:true,verdicts:[verdict({outcome:'rejected',closed:true,reason:'The file was deleted.'})]}};
  }});
  assert.equal(headEvidence?.deletionEvidence,undefined);
  assert.equal(result.outcome,'not-reviewed',JSON.stringify(result.failures));assert.deepEqual(result.failures,[]);assert.deepEqual(result.unreviewedFiles,[file]);assert.match(formatReviewReport(result),/Не проверено: файлы input\.mjs/);
  assert.ok(!['closed','rejected'].includes(result.findings[0].status));assert.notEqual(result.findings[0].closed,true);
  assert.equal(result.findings[0].deletionEvidence,undefined);
  assert.equal(checkerCalls,1);
 });
});
test('C58: a genuinely absent head path still records pinned deletion evidence',async t=>{
 const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[sample]}));
 fs.unlinkSync(path.join(f.worktree,'input.mjs'));f.git('add','.');f.git('commit','-qm','C58 real deletion');const head=f.git('rev-parse','HEAD');let checkerCalls=0;
 const result=await runReviewRound({...f.request,head,stageRecord:first},{runRole:async request=>{
  const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);
  if(request.role==='code-review')return {response:review([],context.files)};
  checkerCalls++;assert.deepEqual(context.headEvidence[0].deletionEvidence,{before:f.request.base,head});
  return {response:{completed:true,verdicts:[verdict({outcome:'rejected',closed:true,reason:'The file was deleted.'})]}};
 }});
 assert.equal(checkerCalls,1);assert.equal(result.outcome,'clean');assert.equal(result.findings[0].status,'closed');
 assert.deepEqual(result.findings[0].deletionEvidence,{before:f.request.base,head});
});
test('C35: a never-existing file is not verified deletion evidence',async t=>{
 const result=await runReviewRound(fixture(t).request,responder({findings:[{...sample,file:'absent.mjs',danger:true}],verdicts:[verdict({outcome:'rejected',closed:true})]}));
 assert.equal(result.outcome,'not-converged');assert.equal(result.findings[0].status,'unresolved');
});
test('C33: earlier reviewer danger survives another pass and a later round',async t=>{
 const f=fixture(t);let pass=0;
 const first=await runReviewRound({...f.request,risk:'risky'},{runRole:async request=>({response:request.role==='code-review'?review([{...sample,danger:++pass===1}]):{completed:true,verdicts:[verdict()]}})});
 assert.equal(pass,2);assert.equal(first.findings[0].danger,true);
 const second=await runReviewRound({...f.request,stageRecord:first},responder({findings:[sample]}));assert.equal(second.findings[0].danger,true);assert.equal(second.outcome,'not-converged');
});
test('C33: reviewer/checker danger is a fail-safe union, including unmarked findings',async t=>{
 for(const [reviewerDanger,checkerDanger,expected] of [[true,false,true],[false,true,true],[null,false,true],[undefined,false,true],[false,false,false]])await t.test(String(reviewerDanger)+'/'+checkerDanger,async t=>{
  const finding={...sample};if(reviewerDanger===undefined)delete finding.danger;else finding.danger=reviewerDanger;
  const result=await runReviewRound(fixture(t).request,responder({findings:[finding],verdicts:[verdict({danger:checkerDanger,dangerCase:checkerDanger?'security':null,dangerReason:'Synthetic diagnostic route.'})]}));
  assert.equal(result.outcome,'not-converged',JSON.stringify(result.failures));assert.equal(result.findings[0].danger,expected);if(expected)assert.notEqual(result.findings[0].dangerCase,null);
 });
});
test('C33/C44: dangerous or unmarked rejection remains disputed regardless of a head quote',async t=>{
 for(const danger of [true,undefined])for(const codeQuote of [undefined,'return 0;','return n;'])await t.test(String(danger)+'/'+String(codeQuote),async t=>{
  const finding={...sample};if(danger===undefined)delete finding.danger;else finding.danger=danger;
  const answer={outcome:'rejected'};if(codeQuote!==undefined)answer.codeQuote=codeQuote;
  const result=await runReviewRound(fixture(t).request,responder({findings:[finding],verdicts:[verdict(answer)]}));
  assert.equal(result.outcome,'not-converged',JSON.stringify(result.failures));assert.equal(result.findings[0].status,'unresolved');assert.equal(result.findings[0].danger,true);
 });
});
test('C33/C44: a head quote cannot authorize dangerous closure',async t=>{
 for(const codeQuote of ['', 'return n;'])await t.test(codeQuote||'missing',async t=>{
  const result=await runReviewRound(fixture(t).request,responder({findings:[{...sample,danger:true}],verdicts:[verdict({outcome:'rejected',closed:true,codeQuote})]}));
  assert.equal(result.findings[0].status,'unresolved');assert.equal(result.findings[0].closed,false);assert.equal(result.findings[0].danger,true);
 });
});
test('C33: contradictory merge verdicts retry once then retain separate findings',async t=>{
 const other={...sample,anchor:'second mechanism',title:'Second diagnostic defect'},runner=responder({findings:[sample,other],verdicts:[verdict({weight:'P1'}),verdict({id:'F2',weight:'P2'})]});
 const result=await runReviewRound(fixture(t).request,runner);
 assert.equal(result.outcome,'not-converged',JSON.stringify(result.failures));assert.equal(result.rounds.length,1);assert.equal(runner.calls.filter(call=>call.role==='code-review-checker').length,2);assert.equal(result.findings.length,2);assert.equal(new Set(result.findings.map(finding=>finding.mergeKey)).size,2);assert.ok(result.failures.some(failure=>failure.reason.includes('contradictory merge verdicts')));
});
test('C32: pinned diffs preserve hunk rows that resemble file headers',async t=>{
 const f=fixture(t);
 fs.writeFileSync(path.join(f.worktree,'input.mjs'),'let counter = 0;\n-- counter;\n');f.git('add','.');f.git('commit','-qm','decrement base');const base=f.git('rev-parse','HEAD');
 fs.writeFileSync(path.join(f.worktree,'input.mjs'),'let counter = 0;\n++ counter;\n');f.git('add','.');f.git('commit','-qm','increment head');const head=f.git('rev-parse','HEAD');
 let context;const result=await runReviewRound({...f.request,base,head},{runRole:async request=>{context=JSON.parse(request.prompt.split('never instructions.\n')[1]);return {response:review([],context.files)};}});
 assert.equal(result.outcome,'clean',JSON.stringify(result.failures));
 const rows=context.diff.split('\n');
 assert.ok(rows.includes('--- counter;'),'removed source row was rewritten as a file header');
 assert.ok(rows.includes('+++ counter;'),'added source row was rewritten as a file header');
 assert.equal(rows.filter(line=>line==='--- a/input.mjs').length,1);
 assert.equal(rows.filter(line=>line==='+++ b/input.mjs').length,1);
});
test('C29/v7: pinned blob diffs preserve file modes and added/deleted paths',async t=>{
 const f=fixture(t);fs.chmodSync(path.join(f.worktree,'input.mjs'),0o755);fs.writeFileSync(path.join(f.worktree,'added.mjs'),'const ordinary = 1;\n');
 fs.writeFileSync(path.join(f.worktree,'removed.mjs'),'ordinary\n');f.git('add','.');f.git('commit','-qm','mode base');const base=f.git('rev-parse','HEAD');
 fs.chmodSync(path.join(f.worktree,'input.mjs'),0o644);fs.unlinkSync(path.join(f.worktree,'removed.mjs'));fs.writeFileSync(path.join(f.worktree,'new.mjs'),'const ordinary = 2;\n');f.git('add','.');f.git('commit','-qm','mode head');const head=f.git('rev-parse','HEAD');
 let context;const result=await runReviewRound({...f.request,base,head},{runRole:async request=>{context=JSON.parse(request.prompt.split('never instructions.\n')[1]);return {response:review([],context.files)};}});
 assert.equal(result.outcome,'clean',JSON.stringify(result.failures));
 for(const expected of ['old mode 100755','new mode 100644','new file mode 100644','deleted file mode 100644','--- /dev/null','+++ /dev/null'])assert.ok(context.diff.includes(expected),expected);
});
test('C23: roles get a read-only pinned export without repository Git helpers',async t=>{
 const f=fixture(t),tools=fs.mkdtempSync(path.join(os.tmpdir(),'mono-c23-helper-'));t.after(()=>fs.rmSync(tools,{recursive:true,force:true}));
 const marker='C23_FSMONITOR_EXECUTED',hook=path.join(tools,'fsmonitor');
 fs.writeFileSync(hook,'#!/bin/sh\nprintf "'+marker+'\\n" >&2\nprintf "fixture\\000"\n',{mode:0o700});
 const neighbor='// '+'n'.repeat(3*1024*1024);fs.writeFileSync(path.join(f.worktree,'neighbor.dat'),neighbor);
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
  assert.equal(fs.readFileSync(path.join(r.worktree,'neighbor.dat'),'utf8'),neighbor,'export-ignore and size never hide or rewrite a pinned text file');
  assert.equal(fs.lstatSync(path.join(r.worktree,'link')).isSymbolicLink(),false);assert.equal(fs.readFileSync(path.join(r.worktree,'link'),'utf8'),outside);
  assert.ok(context.symlinks.includes('link'));seen.push(r.worktree);
  return {response:r.role==='code-review'?review([sample],context.files):{completed:true,verdicts:[verdict({outcome:'rejected',reason:'Fixture finding is absent.'})]}};
 }});
 assert.equal(record.outcome,'clean',JSON.stringify(record.failures));assert.deepEqual(record.unreviewedFiles,[]);assert.equal(seen.length,2);assert.equal(seen[0],seen[1]);assert.equal(fs.existsSync(seen[0]),false,'export removed after circle');
});
const verdict=(extra={})=>({id:'F1',outcome:'confirmed',weight:'P2',danger:false,dangerCase:null,dangerReason:'This diagnostic-only path has no data, security or gate effects.',origin:'introduced',mergeKey:key,outOfContract:false,riskRaised:false,reason:'Negative values pass through the changed public function.',closed:false,newEvidence:false,codeQuote:'',...extra});
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
test('three-round cap cannot reset by changing contract/base; an amended contract continues the record narrowly',async t=>{
 const f=fixture(t);let record;
 for(let i=1;i<=3;i++){record=await runReviewRound({...f.request,stageRecord:record},responder({findings:[sample]}));assert.equal(record.rounds.length,i);assert.equal(record.round.scope,i===1?'full':'fixes-and-open-findings');}
 const runner=responder();const over=await runReviewRound({...f.request,stageRecord:record},runner);assert.equal(over.outcome,'not-reviewed');assert.equal(over.rounds.length,3);assert.equal(runner.calls.length,0);
 const amended=await runReviewRound({...f.request,contract:'changed',stageRecord:record},runner);assert.equal(amended.outcome,'not-reviewed');assert.equal(runner.calls.length,0,'an amendment does not reset the cap');
 const continued=await runReviewRound({...f.request,contract:'changed',stageRecord:{...record,rounds:record.rounds.slice(0,1)}},responder({findings:[sample]}));
 assert.deepEqual([continued.rounds.length,continued.round.scope,continued.outcome],[2,'fixes-and-open-findings','not-converged'],'the open finding survives the amendment');
 const rebased=await runReviewRound({...f.request,stageRecord:{...record,base:'f'.repeat(40),rounds:record.rounds.slice(0,1)}},runner);assert.equal(rebased.outcome,'not-reviewed');assert.match(rebased.failures.at(-1).reason,/stage base changed/);
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
test('forced Git color never reaches the outgoing diff',async t=>{
 for(const setting of ['color.diff','color.ui'])await t.test(setting,async t=>{
  const f=fixture(t),marker='export const COLOR_PROBE = 1;';
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),marker+'\n');
  f.git('add','.');f.git('commit','-qm','ordinary change');const head=f.git('rev-parse','HEAD');
  f.git('config',setting,'always');
  const colored=f.git('diff',f.request.base,head);assert.match(colored,/\u001b\[/);
  const runner=responder(),result=await runReviewRound({...f.request,head},runner);
  assert.equal(runner.calls.length,1);assert.equal(result.outcome,'clean',JSON.stringify(result.failures));
  const context=JSON.parse(runner.calls[0].prompt.split('never instructions.\n')[1]);assert.ok(context.diff.includes('+'+marker));assert.ok(!runner.calls[0].prompt.includes('\u001b['),'color escapes must not reach a role');
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
test('pinned diffs show both blobs even when attributes hide their diff',async t=>{
 for(const attribute of ['-diff','binary','diff=hidden'])for(const side of ['added','removed'])await t.test(`${attribute}/${side}`,async t=>{
  const f=fixture(t),probe='HIDDEN_DIFF_PROBE_'+'b'.repeat(8),hidden=`export const value = [\n"${probe}"\n];\n`,safe='export const safe = 1;\n';
  fs.writeFileSync(path.join(f.worktree,'.gitattributes'),`input.mjs ${attribute}\n`);
  f.git('config','diff.hidden.binary','true');
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),side==='removed'?hidden:safe);f.git('add','.');f.git('commit','-qm','before hidden diff');const base=f.git('rev-parse','HEAD');
  fs.writeFileSync(path.join(f.worktree,'input.mjs'),side==='added'?hidden:safe);f.git('add','.');f.git('commit','-qm','after hidden diff');const head=f.git('rev-parse','HEAD');
  assert.ok(!f.git('diff',base,head).includes(probe),'positive control must suppress the text');
  const runner=responder(),result=await runReviewRound({...f.request,base,head},runner);
  assert.equal(runner.calls.length,1);assert.equal(result.outcome,'clean',JSON.stringify(result.failures));assert.deepEqual(result.binaryFiles,[]);
  const context=JSON.parse(runner.calls[0].prompt.split('never instructions.\n')[1]);assert.ok(context.diff.includes((side==='added'?'+':'-')+'"'+probe+'"'),'the change must be visible despite the attribute');
 });
});
test('host Git isolation excludes binary bytes before a role can read them',async t=>{
 for(const bytes of [Buffer.from([0,65,66]),Buffer.from([0xff,0xfe,65])])await t.test(bytes.toString('hex'),async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.worktree,'input.mjs'),bytes);f.git('add','.');f.git('commit','-qm','opaque blob');
  const runner={calls:[],runRole:async request=>{runner.calls.push(request);assert.ok(!fs.existsSync(path.join(request.worktree,'input.mjs')));return {response:review([],[])};}},result=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')},runner);
  assert.equal(result.outcome,'clean');assert.equal(runner.calls.length,1);assert.equal(result.rounds.length,1);assert.deepEqual(result.unreviewedFiles,[]);assert.deepEqual(result.binaryFiles,['input.mjs']);
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
test('D3: realistic ordinal checker batch maps stable identities and keeps every failed answer capped',async t=>{
 const f=fixture(t),second={...sample,anchor:'return n',title:'Missing upper bound',trigger:'n exceeds supported range'};
 const make=(id,extra={})=>{const {id:ignored,...fields}=verdict(extra);return {id,...fields};};
 const response={completed:true,verdicts:[make('F2',{mergeKey:'upper-bound'}),make('F1',{mergeKey:'nonnegative'})]};
 const runner=responder({responses:[review([sample,second]),response]});
 const record=await runReviewRound(f.request,runner);
 assert.equal(record.outcome,'not-converged');assert.deepEqual(record.round.findingKeys,[findingKey(second),key]);
 const context=JSON.parse(runner.calls[1].prompt.split('never instructions.\n')[1]);assert.deepEqual(context.findings.map(f=>f.id),['F1','F2']);assert.ok(context.findings.every(f=>!Object.hasOwn(f,'key')));
 for(const ids of [['F1','F1'],['F1','F3'],['F1']])assert.throws(()=>parseChecker({completed:true,verdicts:ids.map(id=>make(id))},[{...sample,key},{...second,key:findingKey(second)}]));
 const bad='unreadable answer\n'+'x'.repeat(20000);
 const failed=await runReviewRound(f.request,responder({responses:[review([sample]),bad,bad]}));
 const attempts=failed.failures.filter(f=>f.role==='code-review-checker');assert.equal(attempts.length,2);
 for(const failure of attempts){assert.ok(failure.answer);assert.ok(Buffer.byteLength(failure.answer.text)<=8192);assert.equal(failure.answer.truncated,true);assert.ok(failure.answer.text.startsWith('unreadable answer\n'));assert.equal(failure.reason,'unreadable role JSON');}
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
test('R1: rejected scope/risk flags remain structural even after new checker evidence',async t=>{
 for(const flag of ['outOfContract','riskRaised']){
  const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({outcome:'rejected',[flag]:true})]}));
  assert.equal(first.outcome,'not-converged');
  const runner=responder({verdicts:[verdict({outcome:'rejected'})]});
  const second=await runReviewRound({...f.request,stageRecord:first},runner);
  assert.equal(second.outcome,'not-converged');assert.equal(second.findings[0][flag],true);
  assert.equal(runner.calls.filter(call=>call.role==='code-review-checker').length,1);
  f.git('commit','--allow-empty','-qm','record corrected scope evidence');
  const third=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD'),stageRecord:second},responder({verdicts:[verdict({outcome:'rejected',newEvidence:true,reason:'The corrected scope is now supported by new evidence.'})]}));
  assert.equal(third.outcome,'not-converged');assert.equal(third.findings[0][flag],true);
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

test('C2 flags: confirmed scope/risk cannot disappear in later rounds even with new evidence',async t=>{
 for(const flag of ['outOfContract','riskRaised']){
  const f=fixture(t),first=await runReviewRound(f.request,responder({findings:[sample],verdicts:[verdict({origin:'pre-existing',[flag]:true})]}));
  const second=await runReviewRound({...f.request,stageRecord:first},responder({verdicts:[verdict({origin:'pre-existing'})]}));
  assert.equal(second.outcome,'not-converged');assert.equal(second.findings[0][flag],true);
  const third=await runReviewRound({...f.request,stageRecord:second},responder({verdicts:[verdict({origin:'pre-existing',newEvidence:true,reason:'New code evidence resolves the earlier scope/risk concern.'})]}));
  assert.equal(third.outcome,'not-converged');assert.equal(third.findings[0][flag],true);
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

test('C39: a successful Git warning on stderr does not cancel an ordinary round',t=>{
 const f=fixture(t),attribute='not-a-valid-attribute-name';
 fs.writeFileSync(path.join(f.worktree,'.gitattributes'),'input.mjs /'+attribute+'\n');f.git('add','.');f.git('commit','-qm','invalid synthetic attribute');
 const request={...f.request,head:f.git('rev-parse','HEAD')};
 const source=`import {runReviewRound} from ${JSON.stringify(new URL('./code-review.mjs',import.meta.url).href)};let calls=0;const r=await runReviewRound(${JSON.stringify(request)},{runRole:async()=>{calls++;return {response:${JSON.stringify(review([],['input.mjs','.gitattributes']))}};}});console.log(JSON.stringify({record:r,calls}));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'','captured Git stderr is not forwarded');
 const result=JSON.parse(child.stdout);assert.equal(result.record.outcome,'clean',JSON.stringify(result.record.failures));assert.equal(result.calls,1);
});

test('C59: native role stdout and stderr decode complete UTF-8 bytes before parsing',async t=>{
 const f=fixture(t),file='ж漢😀.mjs';
 fs.writeFileSync(path.join(f.worktree,file),'export const available = true;\n');f.git('add','.');f.git('commit','-qm','C59 unicode path');
 const bin=fs.mkdtempSync(path.join(os.tmpdir(),'mono-utf8-stream-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));
 const roles=resolveReviewRoles({},packRoot),modeFile=path.join(bin,'mode');
 fs.writeFileSync(path.join(bin,'data.json'),JSON.stringify({model:roles['code-review'].model,reviewer:review([sample],['input.mjs',file]),checker:{completed:true,verdicts:[verdict({reason:'Negative input still passes. Evidence: ж漢😀.mjs.'})]}}));
 const fake=`#!${process.execPath}
 const fs=require('node:fs'),path=require('node:path'),engine=path.basename(process.argv[1]),data=JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
 if(process.argv[2]==='debug'){const mode=fs.readFileSync(path.join(__dirname,'mode'),'utf8');if(mode.startsWith('catalog-'))(mode.includes('stdout')?process.stdout:process.stderr).write(Buffer.from([0xff]));console.log(JSON.stringify({models:[{slug:data.model,tool_mode:'code_mode_only',apply_patch_tool_type:'freeform',multi_agent_version:'v2'}]}));process.exit(0);}
 if(process.argv[2]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}
 if(process.argv.includes('auth')){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}));process.exit(0);}
 let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',async()=>{
  if(input.startsWith('Boundary audit')){console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({tools:['exec_command','write_stdin'],mcpServers:[]})}}));console.log(JSON.stringify({type:'turn.completed'}));return;}
  const mode=fs.readFileSync(path.join(__dirname,'mode'),'utf8'),bad=mode.startsWith(engine+'-');
  const response=engine==='codex'?[{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(data.reviewer)}},{type:'turn.completed'}]:[{type:'system',subtype:'init',tools:['Read','Glob','Grep','StructuredOutput'],mcp_servers:[]},{type:'result',subtype:'success',is_error:false,structured_output:data.checker}];
  const out=Buffer.from(response.map(x=>JSON.stringify(x)).join('\\n')+'\\n'),err=Buffer.from('ordinary diagnostic ж漢😀');
  for(const [stream,bytes] of [[process.stdout,out],[process.stderr,err]]){
   const split=Number(mode.split(':')[1]??1),at=bytes.indexOf(Buffer.from('ж'))+split;
   if(bad&&mode.includes(stream===process.stdout?'stdout':'stderr')){stream.write(Buffer.from([0xff]));}
   stream.write(bytes.subarray(0,at));await new Promise(resolve=>setTimeout(resolve,25));stream.write(bytes.subarray(at));
  }
 });`;
 for(const engine of ['codex','claude'])fs.writeFileSync(path.join(bin,engine),fake,{mode:0o700});
 const prior=process.env.PATH;process.env.PATH=bin+path.delimiter+prior;
 try{
  for(const mode of ['valid:1','valid:3','valid:6','codex-stdout:1','codex-stderr:1','claude-stdout:1','claude-stderr:1','catalog-stdout','catalog-stderr'])await t.test(mode,async()=>{
   fs.writeFileSync(modeFile,mode);const record=await runReviewRound({...f.request,head:f.git('rev-parse','HEAD')});
   if(mode.startsWith('valid')){
    assert.equal(record.outcome,'not-converged');assert.ok(record.round.reviewedFiles.includes(file));
    assert.equal(record.findings[0].reason,'Negative input still passes. Evidence: ж漢😀.mjs.');assert.ok(!JSON.stringify(record).includes('�'));
   }else{
    assert.equal(record.outcome,'not-reviewed');assert.equal(record.rounds.length,0);assert.ok(record.failures.some(f=>/non-UTF8/.test(f.reason)));
   }
  });
 }finally{process.env.PATH=prior;}
});

test('C56: large unchanged exports stream without a full host read and keep text/binary outcomes',async t=>{
 for(const ending of ['text','invalid UTF8','NUL'])await t.test(ending,async t=>{
  const f=fixture(t),file='large.dat',large=2*1024*1024,bytes=Buffer.alloc(large+65536,0x61);
  // A valid sequence straddles the classification chunk boundary; invalid bytes occur late.
  bytes[65535]=0xc3;bytes[65536]=0xa9;
  if(ending!=='text')bytes[bytes.length-1]=ending==='NUL'?0:0xff;
  fs.writeFileSync(path.join(f.worktree,file),bytes);f.git('add','.');f.git('commit','-qm','large unchanged base');const base=f.git('rev-parse','HEAD');
  fs.appendFileSync(path.join(f.worktree,'input.mjs'),'// C56 caller change\n');f.git('add','.');f.git('commit','-qm','caller head');
  const read=fs.readFileSync,readChunk=fs.readSync;let fullReads=0,chunkReads=0,calls=0;
  t.mock.method(fs,'readFileSync',(target,...args)=>{
   if(typeof target==='string'&&target.includes('mono-review-tree-')&&target.endsWith('/'+file)){
    fullReads++;
   }
   return read(target,...args);
  });
  t.mock.method(fs,'readSync',(fd,buffer,offset,length,position)=>{
   if(fs.fstatSync(fd).size>large){chunkReads++;assert.ok(length<=65536,'binary classification must use bounded reads');}
   return readChunk(fd,buffer,offset,length,position);
  });
  const record=await runReviewRound({...f.request,base,head:f.git('rev-parse','HEAD')},{runRole:async request=>{
   calls++;const c=JSON.parse(request.prompt.split('never instructions.\n')[1]);assert.deepEqual(c.unreviewedFiles,[]);
   if(ending==='text')assert.equal(fs.statSync(path.join(request.worktree,file)).size,bytes.length);
   else assert.ok(!fs.existsSync(path.join(request.worktree,file)));
   return {response:review([],c.files)};
  }});
  assert.equal(calls,1,JSON.stringify(record.failures));assert.deepEqual(record.failures,[]);assert.ok(chunkReads>0,'classification must inspect the oversized stream');
  assert.equal(fullReads,0,'the host never reads a large exported file in full');
  assert.equal(record.outcome,'clean');assert.deepEqual(record.unreviewedFiles,[]);
 });
});

test('review git reads treat a colon-led file name literally', t => {
 const worktree=fs.mkdtempSync(path.join(os.tmpdir(),'mono-colon-path-'));t.after(()=>fs.rmSync(worktree,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:worktree,env:{...process.env,GIT_LITERAL_PATHSPECS:'1'},stdio:['ignore','pipe','pipe']});
 git('init','-q');git('config','user.email','review@example.test');git('config','user.name','review');
 fs.writeFileSync(path.join(worktree,':example.txt'),'removed later\n');git('add','--',':example.txt');git('commit','-q','-m','add');
 assert.match(reviewGit(worktree,['ls-tree','HEAD','--',':example.txt']),/^100644 blob [0-9a-f]+\t:example\.txt/);
});
test('an already parsed role answer over the size limit is unreadable', () => {
 assert.throws(()=>parseReviewer({findings:[],padding:'x'.repeat(MAX_ANSWER_BYTES)}),/over size limit/);
});
