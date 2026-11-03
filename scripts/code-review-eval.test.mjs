import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateReviewDataset, verifyDatasetBundle, runReviewEvaluation, scoreReviewEvaluation, scoreCheckerProbes, compareReviewEvaluations } from './code-review-eval.mjs';
import { digest } from './runtime.mjs';
const packRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataset=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/cases.json'),'utf8'));
test('frozen cases distinguish historical slots, later fixes, clean controls and repaired gold',()=>{
 const result=validateReviewDataset(dataset);assert.equal(result.late,12);assert.equal(result.cases,16);assert.equal(result.eligibleLate,11);assert.equal(result.eligibleExtended,15);assert.equal(result.clean,3);
 assert.equal(dataset.cases.find(item=>item.id==='41').eligible,false);assert.equal(dataset.cases.find(item=>item.id==='17').eligible,true);
 assert.deepEqual(dataset.laterIntroduced.map(item=>item.id),['67','70','71']);
 for(const field of ['base','head','contractMode']){const broken=structuredClone(dataset);broken.tasks[0][field]='';assert.throws(()=>validateReviewDataset(broken));}
 const broken=structuredClone(dataset);broken.cases[0].trigger='';assert.throws(()=>validateReviewDataset(broken));
});
test('recall reports each run and partial separately, union is additional, failed runs remain',()=>{
 const finding={key:'a'}, record={outcome:'not-converged',findings:[finding],costs:[],failures:[]};
 const runs=[1,2,3].map(repeat=>({id:`run-${repeat}`,repeat,task:'MONO-81',caseId:'MONO-81',record:repeat===3?{...record,outcome:'not-reviewed',findings:[],failures:[{reason:'timeout'}]}:record}));
 const evaluation={datasetDigest:digest(dataset),runs};
 const grades=[{runId:'run-1',key:'a',match:'strict',caseId:'18',judge:'independent',evidence:'Same file and unbounded JSON substitution mechanism.'},
 {runId:'run-2',key:'a',match:'partial',caseId:'19',judge:'independent',evidence:'Different field of the same schema failure class; not a strict match.'}];
 const result=scoreReviewEvaluation(dataset,evaluation,grades);assert.equal(result.rows.length,3);assert.equal(result.rows[0].late12.found,1);assert.equal(result.rows[1].late12.found,0);assert.equal(result.rows[1].partial,1);
 assert.equal(result.rows[0].falsePositives,0);
 const clean=scoreReviewEvaluation(dataset,{...evaluation,runs:[{...runs[0],id:'clean-run',caseId:'MONO-81-clean'}]},[{runId:'clean-run',key:'a',match:'false-positive',judge:'independent',evidence:'Documentation-only control; claimed bug is absent.'}]);assert.equal(clean.rows[0].cleanFalseAlarms,1);
 assert.deepEqual(result.unionAdditionalOnly,['18']);assert.equal(result.rows[2].outcome,'not-reviewed');assert.equal(result.rows[2].failures.length,1);assert.ok(result.enhancements.length);
 assert.throws(()=>scoreReviewEvaluation(dataset,evaluation,[{...grades[0],judge:''}]),/judgment/);assert.throws(()=>scoreReviewEvaluation(dataset,{...evaluation,runs:[]},[]),/empty evaluation/);
 assert.throws(()=>scoreReviewEvaluation(dataset,{...evaluation,runs:[...runs,runs[0]]},grades),/duplicate run/);
});
test('checker calibration blocks dangerous false rejections/removal, and counts false merges separately',()=>{
 const gold=[{key:'a',outcome:'confirmed',danger:true,weight:'P2',mergeKey:'cause-a'},{key:'b',outcome:'confirmed',danger:false,weight:'P3',mergeKey:'cause-b'}];
 const verdicts=[{key:'a',outcome:'rejected',danger:false,weight:'P3',mergeKey:'same'},{key:'b',outcome:'confirmed',danger:false,weight:'P3',mergeKey:'same'}];
 const result=scoreCheckerProbes(gold,verdicts);assert.equal(result.releaseBlocked,true);assert.equal(result.falseRejections,1);assert.equal(result.dangerRemoved,1);assert.deepEqual(result.falseMerges,[['a','b']]);assert.equal(result.falseMergeCount,1);assert.equal(result.weightMismatches,1);assert.equal(result.rows[0].weightMismatch,true);
 assert.equal(scoreCheckerProbes(gold,[]).completed,false);assert.throws(()=>scoreCheckerProbes([],[]),/gold/);assert.throws(()=>scoreCheckerProbes(gold,[{key:'unknown'}]),/unknown/);
 assert.equal(scoreCheckerProbes(gold,gold).releaseBlocked,false);
});
test('historical checker replies retain disagreements and independent batches, not declared new-role passes',()=>{
 const archive=JSON.parse(fs.readFileSync(path.join(packRoot,'evals/code-review/historical-checker.json'),'utf8'));
 assert.equal(archive.batches.length,6);assert.equal(archive.batches.filter(batch=>batch.source==='checker').flatMap(batch=>batch.responses).length,60);
 assert.match(archive.provenance,/no measurement/i);assert.ok(archive.batches.some(batch=>batch.responses.some(reply=>reply.outcome==='rejected')));
});
async function evaluationFixture(t){
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'mono-eval-control-'));t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
 const repo=path.join(scratch,'source');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.email','fixture@example.test');git('config','user.name','Fixture');
 fs.mkdirSync(path.join(repo,'scripts'));fs.writeFileSync(path.join(repo,'contract.md'),'Frozen contract.\n');fs.writeFileSync(path.join(repo,'scripts/input.mjs'),'before\n');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 fs.writeFileSync(path.join(repo,'scripts/input.mjs'),'after\n');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
 const clone=structuredClone(dataset);for(const task of clone.tasks){task.base=base;task.head=head;task.contract='Review this fixture.';task.contractSource={file:'contract.md',blob:git('rev-parse','HEAD:contract.md'),sha256:'e89cccb393b3c86034ca185f91b4e0d287316774fb7c825088ce48144547a6125'};git('tag',`dataset/${task.id}-head`);}
 // The hash is independently computed from the actual contract bytes, not the implementation's object digest.
 const {createHash}=await import('node:crypto');for(const task of clone.tasks)task.contractSource.sha256=createHash('sha256').update('Frozen contract.\n').digest('hex');
 for(const item of clone.cases){item.file='scripts/input.mjs';item.anchor='after';}
 git('checkout','-q','--detach',base);
 const content='# Clean control\n\nDocumentation only.\n';fs.writeFileSync(path.join(repo,'CODE_REVIEW_EVAL_CONTROL.md'),content);git('add','.');const cleanTree=git('write-tree');
 const cleanHead=execFileSync('git',['commit-tree',cleanTree,'-p',base,'-m','Code review clean document control'],{cwd:repo,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Evaluation Fixture',GIT_AUTHOR_EMAIL:'fixture@example.test',GIT_AUTHOR_DATE:'2026-11-01T00:00:00Z',GIT_COMMITTER_NAME:'Evaluation Fixture',GIT_COMMITTER_EMAIL:'fixture@example.test',GIT_COMMITTER_DATE:'2026-11-01T00:00:00Z'}}).trim();
 for(const control of clone.cleanControls){control.base=base;control.head=cleanHead;control.contract='Add this documentation control.';control.content=content;control.file='CODE_REVIEW_EVAL_CONTROL.md';}
 const bundle=path.join(scratch,'heads.bundle');git('bundle','create',bundle,'--all');assert.equal(verifyDatasetBundle(clone,bundle).modelCalls,0);
 return {clone,bundle};
}
test('bundle evaluation validates exact source bytes and uses the shared circle for all 3 repeats and clean controls',async t=>{
 const {clone,bundle}=await evaluationFixture(t);
 let calls=0;const evaluation=await runReviewEvaluation({dataset:clone,bundle,runId:'recorded-control',packRoot},{runRole:async request=>{calls++;const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);assert.equal(context.contract,context.files.includes('CODE_REVIEW_EVAL_CONTROL.md')?'Add this documentation control.':'Frozen contract.\n');return {response:{completed:true,reviewedFiles:['scripts/input.mjs','CODE_REVIEW_EVAL_CONTROL.md'],findings:[]}};}});
 assert.equal(evaluation.runs.length,18);assert.equal(calls,36);assert.equal(evaluation.runs.filter(run=>run.caseId.endsWith('-clean')).length,9);assert.ok(evaluation.runs.every(run=>run.record.outcome==='clean'));
 clone.tasks[0].contractSource.sha256='0'.repeat(64);assert.throws(()=>verifyDatasetBundle(clone,bundle),/contract bytes/);
});

test('C2 cancellation: interrupted row stays scored and no later repeat starts',async t=>{
 const {clone,bundle}=await evaluationFixture(t);let calls=0;const progress=[];
 const evaluation=await runReviewEvaluation({dataset:clone,bundle,runId:'interrupted-fixture',packRoot},{onProgress:event=>progress.push(event),runRole:async()=>{calls++;throw Object.assign(Error('interrupted fixture'),{interrupted:true});}});
 assert.equal(calls,1);assert.equal(evaluation.runs.length,1);assert.equal(evaluation.interrupted,true);
 assert.equal(evaluation.runs[0].record.interrupted,true);assert.equal(evaluation.runs[0].record.outcome,'not-reviewed');
 assert.equal(progress.filter(event=>event.type==='started').length,1);assert.equal(progress.filter(event=>event.type==='result').length,1);
 const score=scoreReviewEvaluation(clone,evaluation,[]);assert.equal(score.rows.length,1);assert.equal(score.rows[0].late12.found,0);
 assert.equal(score.rows[0].late12.total,clone.cases.filter(item=>item.task===clone.tasks[0].id&&item.eligible&&item.subset==='late12').length);
 assert.equal(score.rows[0].outcome,'not-reviewed');assert.ok(score.rows[0].failures.length);
});

test('incumbent comparison refuses changed contracts or unmatched repeats',()=>{
 const run={id:'candidate:1',caseId:'control',repeat:1,head:'a',base:'b',contractDigest:'c'};const candidate={datasetDigest:'d',runs:[run]};
 const baseline={datasetDigest:'d',runs:[{...run,id:'baseline:1'}]};assert.equal(compareReviewEvaluations(candidate,baseline)[0].baseline,'baseline:1');
 assert.throws(()=>compareReviewEvaluations(candidate,{...baseline,runs:[{...run,head:'other'}]}),/inputs differ/);
 assert.throws(()=>compareReviewEvaluations(candidate,{...baseline,runs:[]}),/denominator/);assert.throws(()=>compareReviewEvaluations({...candidate,runs:[]},{...baseline,runs:[]}),/empty comparison/);
});

test('D5: dataset version changes and evaluation receives only the exact pinned contract blob',()=>{
 assert.ok(dataset.version>=2);
 for(const task of dataset.tasks)assert.equal(task.contractMode,'pinned-blob');
});
test('D6: disputed danger is scored without a danger veto, partial consequence and nominal slots stay visible',()=>{
 for(const id of ['156','80']){const item=dataset.cases.find(item=>item.id===id);assert.equal(item.dangerStatus,'disputed');assert.match(item.reclassification.evidence,/\.mjs:/);}
 assert.equal(dataset.cases.find(item=>item.id==='21').consequenceStatus,'partial');
 const gold=[{key:'156',outcome:'confirmed',weight:'P2',danger:true,dangerStatus:'disputed',mergeKey:'156'},{key:'real',outcome:'confirmed',weight:'P2',danger:true,mergeKey:'real'}];
 const verdicts=gold.map(item=>({...item,outcome:'rejected',danger:false}));
 const result=scoreCheckerProbes(gold,verdicts);assert.equal(result.rows[0].unsafe,false);assert.equal(result.rows[0].dangerDisputed,true);assert.equal(result.rows[0].falseRejection,true);assert.equal(result.rows[1].unsafe,true);assert.equal(result.releaseBlocked,true);
 assert.equal(scoreCheckerProbes(gold.slice(0,1),verdicts.slice(0,1)).releaseBlocked,false);
 assert.equal(validateReviewDataset(dataset).eligibleLate,11);assert.equal(validateReviewDataset(dataset).eligibleExtended,15);
});
