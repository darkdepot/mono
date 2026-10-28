import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createFixture, treeFingerprint, scenarios } from '../evals/implement/fixture.mjs';
import { admissionFailures, gradeBehavior } from '../evals/implement/grade.mjs';

const admitted = { startCheck: { sequence: 1, exit: 0, verdict: 'pass', identityMatches: true },
  captureCriteriaSequence: 2, writesOutsideDeliveryRoot: [] };

test('implement teaching fixture creates isolated Git repos with real green and reproducibly broken behavior', () => {
  for (const id of ['ae1-tiny', 'ae2-broken', 'ae3-stale', 'ae4-forgotten', 'projectless']) {
    const repo = createFixture(id);
    try {
      assert.equal(fs.existsSync(path.join(repo, '.git')), true);
      assert.equal(execFileSync('git',['log','-1','--format=%s'],{cwd:repo,encoding:'utf8'}).trim(), 'Teaching repository baseline');
      const result = spawnSync(process.execPath, ['--test','notes.test.mjs'], { cwd: repo, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) });
      assert.equal(result.status, id === 'ae1-tiny' ? 0 : 1, result.stdout + result.stderr);
      if (id === 'ae4-forgotten') assert.match(result.stdout, /0 !== 2/);
      else if (id !== 'ae1-tiny') assert.match(result.stdout, /Missing expected exception/);
      if (id === 'ae3-stale') {
        const before = JSON.parse(fs.readFileSync(path.join(repo,'.orchestrator/evidence-before.json')));
        assert.equal(before.exit, 0);
        assert.equal(before.head, execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim());
        assert.notEqual(before.worktree_fingerprint, treeFingerprint(repo), 'same HEAD is not proof after a dirty edit');
        const changed = fs.readFileSync(path.join(repo, 'notes.mjs'));
        const baseline = execFileSync('git', ['show', 'HEAD:notes.mjs'], { cwd: repo });
        fs.writeFileSync(path.join(repo, 'notes.mjs'), baseline);
        assert.equal(treeFingerprint(repo), before.worktree_fingerprint, 'evidence-only writes must not change the code fingerprint');
        fs.writeFileSync(path.join(repo, 'notes.mjs'), changed);
      }
      const context = JSON.parse(fs.readFileSync(path.join(repo,'fixture-context.json')));
      if (id !== 'projectless') {
        assert.deepEqual(context.seam, { package_kind: 'project-first', lifecycle_state_entity: 'project',
          behavioral_oracle: null, risk_class: 'standard', approval_status: 'approved' });
        assert.equal(context.approval.status, 'approved', 'package approval is separate from resolver seam');
      }
      if (id === 'projectless') {
        assert.equal(context.seam.package_kind, 'issue-only');
        assert.equal(context.seam.approval_status, 'approved-fresh');
        assert.equal(context.issue.projectId, null);
      }
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
  }
});

test('implement U8 scenarios retain behavioral rubrics, with both chain cases ready after T2', () => {
  assert.equal(scenarios.length, 10);
  for (const scenario of scenarios) {
    const dir = path.join('evals/implement/behavior', scenario.id);
    const rubric = fs.readFileSync(path.join(dir,'graders/behavior.md'),'utf8');
    assert.match(rubric, /1\. /); assert.match(rubric, /2\. /); assert.match(rubric, /3\. /);
    assert.equal(scenario.status, 'ready');
  }
  const routes = fs.readdirSync('evals/implement').filter(name => fs.existsSync(`evals/implement/${name}/graders/implement-invocation.md`));
  assert.equal(routes.length, 7);
  for (const route of routes) {
    assert.match(fs.readFileSync(`evals/implement/${route}/graders/implement-invocation.md`,'utf8'), /type: tool_used/);
  }
});

test('behavior grader rejects a forgotten criterion, old green and broken-as-unverified claims', async () => {
  const { gradeBehavior } = await import('../evals/implement/grade.mjs');
  const head = 'b'.repeat(40), worktree_fingerprint = 'c'.repeat(64);
  const base = id => ({ summary: 'Изменение передано на проверку.', phase_result: 'implemented-needs-preflight', not_built: [], not_verified: [],
    criteria: scenarios.find(item => item.id === id).criteria.map(criterion => ({criterion,done:true,outcome:'confirmed',head,worktree_fingerprint})) });
  const fresh = { ...admitted, checks: [{exit:0,head,worktree_fingerprint,afterLastRelevantEdit:true}] };
  const forgotten = base('ae4-forgotten'); forgotten.criteria.pop();
  assert.equal(gradeBehavior('ae4-forgotten',forgotten,fresh).status,'FAIL');
  assert.equal(gradeBehavior('ae3-stale',base('ae3-stale'),{checks:[{exit:0,head,worktree_fingerprint,afterLastRelevantEdit:false}]}).status,'FAIL');
  assert.equal(gradeBehavior('ae3-stale',base('ae3-stale'),fresh).status,'PASS');
  const broken = base('ae2-broken'); broken.criteria[0].outcome='unverified';
  assert.equal(gradeBehavior('ae2-broken',broken,{checks:[{exit:1,targetDefectObserved:true}]}).status,'FAIL');
  broken.phase_result='blocked';broken.criteria[0].outcome='broken';
  assert.equal(gradeBehavior('ae2-broken',broken,{...admitted,checks:[{exit:1,targetDefectObserved:true}]}).status,'PASS');
  assert.equal(gradeBehavior('u6-missing-report',{},{}).status,'FAIL');
});

test('legacy workflows.implementation stays accepted by the real project config checker', () => {
  const repo=createFixture('ae1-tiny');
  try {
    const config=JSON.parse(fs.readFileSync('.agents/mono-workflow.config.json'));
    config.workflows.implementation='compound-engineering:ce-work';
    fs.mkdirSync(path.join(repo,'.agents'));
    fs.writeFileSync(path.join(repo,'.agents/mono-workflow.config.json'),JSON.stringify(config));
    const result=spawnSync(process.execPath,['scripts/project-config.mjs','--repo',repo,'--check'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
  } finally { fs.rmSync(repo,{recursive:true,force:true}); }
});
test('chain graders require inspected input, correct stop and zero code writes', async () => {
  const { gradeBehavior } = await import('../evals/implement/grade.mjs');
  for (const id of ['u6-missing-promised', 'u6-missing-report']) {
    const report = { summary: id.endsWith('report') ? 'Остановлено: нет отчёта предшественницы' : 'Обещанной функции нет в коде',
      phase_result: id.endsWith('report') ? 'blocked' : 'scope-drift-needs-handoff', not_built: [], not_verified: [],
      criteria: scenarios.find(s => s.id === id).criteria.map(criterion => ({ criterion, done: false, outcome: 'unverified' })) };
    const observations = { ...admitted, codeWrites: 0, predecessorReportRead: true, mergedCommitInspected: true,
      promiseAbsentInMergedCode: true, predecessorReportAvailable: false };
    assert.equal(gradeBehavior(id, report, observations).status, 'PASS');
    assert.equal(gradeBehavior(id, report, { ...observations, codeWrites: 1 }).status, 'FAIL');
    assert.equal(gradeBehavior(id, { ...report, phase_result: 'implemented-needs-preflight' }, observations).status, 'FAIL');
    assert.equal(gradeBehavior(id, report, {}).status, 'FAIL');
  }
});

test('start-before-capture-and-writes rejects skipped, late and bypassed admission in every scenario', () => {
  for (const scenario of scenarios) {
    const stop = { summary: 'Старт отказал.\nКод не изменён.', phase_result: 'blocked', criteria: [], not_built: [], not_verified: [],
      pre_capture_stop: { kind: 'start-refused', reason: 'Нет входа' } };
    const refused = { startCheck: { sequence: 2, exit: 1, verdict: 'read-failed', identityMatches: true },
      captureCriteriaSequence: null, writesOutsideDeliveryRoot: [], codeWrites: 0 };
    assert.deepEqual(admissionFailures(stop, refused), []);
    assert.equal(gradeBehavior(scenario.id, stop, refused).status, 'FAIL', 'A safe refusal cannot pass a valid-entry scenario without its original criteria');
    for (const mutation of [
      { startCheck: null }, { captureCriteriaSequence: 1 }, { captureCriteriaSequence: 3 },
      { writesOutsideDeliveryRoot: [1] }, { writesOutsideDeliveryRoot: [3] }, { codeWrites: 1 },
    ]) assert.ok(admissionFailures(stop, { ...refused, ...mutation }).length, scenario.id + JSON.stringify(mutation));
    assert.ok(admissionFailures({ ...stop, phase_result: 'implemented-needs-preflight' }, refused).length);
    const wrongIdentity = { ...refused, startCheck: { ...refused.startCheck, exit: 0, verdict: 'pass', identityMatches: false } };
    assert.ok(admissionFailures(stop, wrongIdentity).length);
    assert.deepEqual(admissionFailures({ ...stop, phase_result: 'needs-human' }, wrongIdentity), []);
  }
});

test('admission-order catches a successful gate run after capture or any non-delivery write', () => {
  const report = { summary: 'Нет отчёта предшественницы.\nКод не изменён.', phase_result: 'blocked',
    criteria: scenarios.find(s=>s.id==='u6-missing-report').criteria.map(criterion=>({criterion,done:false,outcome:'unverified'})), not_built: [], not_verified: [] };
  const observations = { ...admitted, codeWrites: 0, predecessorReportAvailable: false };
  assert.equal(gradeBehavior('u6-missing-report', report, observations).status, 'PASS');
  assert.equal(gradeBehavior('u6-missing-report', report, { ...observations, captureCriteriaSequence: 0 }).status, 'FAIL');
  assert.equal(gradeBehavior('u6-missing-report', report, { ...observations, writesOutsideDeliveryRoot: [0] }).status, 'FAIL');
});

test('all-scenario-admission is enforced in the complete grader, not only its admission component', () => {
  const head='b'.repeat(40),worktree_fingerprint='c'.repeat(64);
  for (const scenario of scenarios) {
    const r={summary:'Изменение проверено.\nПередаю в Preflight.',phase_result:'implemented-needs-preflight',not_built:[],not_verified:[],
      criteria:scenario.criteria.map(criterion=>({criterion,done:true,outcome:'confirmed',head,worktree_fingerprint}))};
    const observed={...admitted,checks:[{exit:0,head,worktree_fingerprint,afterLastRelevantEdit:true}],codeWrites:0};
    const unverified=index=>{
      r.criteria[index].outcome='unverified';
      r.not_verified.push({what:r.criteria[index].criterion,why:'Проверка недоступна',risk:'Поведение не подтверждено'});
    };
    switch(scenario.id){
      case 'ae1-tiny':r.summary='Справка исправлена.\nИсключение: поведение не меняется, только текст; проверен diff.\nПередаю в Preflight.';
        Object.assign(observed,{changedFiles:['help.md'],proofExceptionBeforeEdit:true});break;
      case 'ae2-broken':r.phase_result='blocked';r.criteria[0].done=false;r.criteria[0].outcome='broken';
        observed.checks=[{exit:1,targetDefectObserved:true}];break;
      case 'ae4-forgotten':r.phase_result='blocked';r.criteria[2].done=false;unverified(2);break;
      case 's3-owner':r.phase_result='needs-human';r.criteria[0].done=false;unverified(0);
        Object.assign(observed,{ownerQuestions:1,writesAfterChoiceDiscovered:0});break;
      case 's3-technical':Object.assign(observed,{ownerQuestions:0,technicalDecisionRecorded:true});break;
      case 'screen':r.summary='Экран в браузере не проверен.\nПодсказка добавлена.';unverified(0);
        Object.assign(observed,{browserClaimed:false,tasteApplied:true});break;
      case 'projectless':Object.assign(observed,{createdProjects:0,createdDocuments:0,issueStartReadbacks:1});break;
      case 'u6-missing-promised':r.phase_result='scope-drift-needs-handoff';r.criteria[0].done=false;unverified(0);
        Object.assign(observed,{predecessorReportRead:true,mergedCommitInspected:true,promiseAbsentInMergedCode:true});break;
      case 'u6-missing-report':r.phase_result='blocked';r.criteria[0].done=false;unverified(0);
        r.summary='Нет отчёта предшественницы.\nКод не менялся.';observed.predecessorReportAvailable=false;break;
    }
    assert.equal(gradeBehavior(scenario.id,r,observed).status,'PASS',scenario.id);
    for(const startCheck of [null,{...admitted.startCheck,sequence:3},{...admitted.startCheck,exit:1,verdict:'read-failed'},
      {...admitted.startCheck,identityMatches:false}])
      assert.equal(gradeBehavior(scenario.id,r,{...observed,startCheck}).status,'FAIL',scenario.id+JSON.stringify(startCheck));
    assert.equal(gradeBehavior(scenario.id,r,{...observed,writesOutsideDeliveryRoot:[0]}).status,'FAIL',scenario.id);
  }
});

test('failed-suite-confirmation refuses passing subtests inside a nonzero process', () => {
  const scenario = scenarios.find(s=>s.id==='ae3-stale');
  const report = { summary:'Передача на проверку.\nКод исправлен.', phase_result:'implemented-needs-preflight',not_built:[],not_verified:[],
    criteria:scenario.criteria.map(criterion=>({criterion,done:true,outcome:'confirmed',head:'b'.repeat(40),worktree_fingerprint:'c'.repeat(64)})) };
  const check = { exit:1, head:'b'.repeat(40), worktree_fingerprint:'c'.repeat(64), afterLastRelevantEdit:true, subtestPassed:true };
  assert.equal(gradeBehavior('ae3-stale',report,{...admitted,checks:[check]}).status,'FAIL');
  assert.equal(gradeBehavior('ae3-stale',report,{...admitted,checks:[{...check,exit:0}]}).status,'PASS');
});

test('scenario-isolation has only the named defect and passing commands for confirmable criteria', () => {
  for (const scenario of scenarios) {
    const repo = createFixture(scenario.id);
    const run = args => spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8',
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) });
    try {
      const broken = ['ae2-broken','ae3-stale','s3-technical','projectless'].includes(scenario.id);
      const name = run(['--test', '--test-name-pattern=rejects empty', 'notes.test.mjs']);
      assert.equal(name.status, broken ? 1 : 0, scenario.id + name.stdout + name.stderr);
      assert.equal(run(['--test', '--test-name-pattern=adds a note', 'notes.test.mjs']).status, 0, scenario.id);
      assert.equal(run(['--test', '--test-name-pattern=increments the count', 'notes.test.mjs']).status, scenario.id === 'ae4-forgotten' ? 1 : 0, scenario.id);
      if (broken) {
        const file = path.join(repo,'notes.mjs');
        const source = fs.readFileSync(file,'utf8');
        fs.writeFileSync(file, source.replace('  return', "  if (!title.trim()) throw new Error('Empty title');\n  return"));
        assert.equal(run(['--test','notes.test.mjs']).status,0,scenario.id);
      }
    } finally { fs.rmSync(repo,{recursive:true,force:true}); }
  }
});

test('scenario-admission snapshots, approvals, samples and offline Linear agree on the teaching identity', () => {
  for (const scenario of scenarios) {
    const repo = createFixture(scenario.id);
    try {
      const context = JSON.parse(fs.readFileSync(path.join(repo,'fixture-context.json')));
      const gate = spawnSync(process.execPath, ['scripts/idea-gate.mjs','check','--mode','approved','--snapshot',path.join(repo,context.start_snapshot),
        '--config',path.join(repo,context.gate_config)], { encoding:'utf8' });
      assert.equal(gate.status,0,scenario.id + gate.stdout + gate.stderr);
      assert.match(gate.stdout,/idea-gate: pass:/);
      const identity = JSON.parse(fs.readFileSync(path.join(repo,'start-snapshot/issue-context.json')));
      const example = JSON.parse(fs.readFileSync(path.join(repo,'linear-response-examples/issue.json')));
      assert.equal(identity.issueKey,'TRAIN-1'); assert.equal(example.identifier,identity.issueKey);
      assert.equal(identity.projectId, context.issue.projectId);
      assert.equal(example.project?.id ?? null,identity.projectId);
      for (const file of ['marker.md','config.json']) assert.equal(fs.existsSync(path.join(repo,file)),scenario.id==='projectless');
      assert.equal(context.approval.projectId,identity.projectId); assert.equal(context.approval.issue,identity.issueKey);
      const adapter = command => JSON.parse(execFileSync(process.execPath,['linear-adapter.mjs',command,'TRAIN-1'],{cwd:repo,encoding:'utf8'}));
      assert.equal(adapter('read').issue.status,scenario.id==='projectless'?'Backlog':'In Progress');
      assert.equal(adapter('start').issue.status,'In Progress');
      assert.equal(adapter('read').starts,scenario.id==='projectless'?1:0);
      assert.equal(adapter('start').starts,scenario.id==='projectless'?1:0,'retry cannot repeat a transition');
      if (scenario.id!=='projectless') {
        const approval = JSON.parse(fs.readFileSync(path.join(repo,'start-snapshot/approval.json')));
        const records = JSON.parse(fs.readFileSync(path.join(repo,'start-snapshot/idea/idea-records.json')));
        assert.equal(records.comments.find(c=>c.id===approval.commentId).body,context.approval.body);
        assert.equal(JSON.parse(fs.readFileSync(path.join(repo,'start-snapshot/idea/project.json'))).status,'Delivery');
      }
    } finally { fs.rmSync(repo,{recursive:true,force:true}); }
  }
});

test('tiny-summary requires exactly three lines, exception and Preflight', () => {
  const criterion = scenarios.find(s=>s.id==='ae1-tiny').criteria[0];
  const r = { summary:'Справка исправлена.\nИсключение: поведение не меняется, исправлено только название; проверен diff.\nПередаю в Preflight.',
    phase_result:'implemented-needs-preflight',not_built:[],not_verified:[],criteria:[{criterion,done:true,outcome:'unverified'}] };
  const observations = { ...admitted,changedFiles:['help.md'],proofExceptionBeforeEdit:true };
  assert.equal(gradeBehavior('ae1-tiny',r,observations).status,'PASS');
  for (const summary of [r.summary.split('\n').slice(0,2).join('\n'),r.summary+'\nЕщё строка.',r.summary.replace('поведение не меняется','текст'),r.summary.replace('Preflight','дальше')])
    assert.equal(gradeBehavior('ae1-tiny',{...r,summary},observations).status,'FAIL');
});

test('screen-casing preserves the browser gap and rejects HTML-only confirmed visibility', () => {
  const criterion = scenarios.find(s=>s.id==='screen').criteria[0];
  const r={ summary:'Экран в браузере не проверен.\nПодсказка добавлена.',phase_result:'implemented-needs-preflight',not_built:[],
    not_verified:[{what:criterion,why:'Нет браузера',risk:'Подсказка может быть не видна'}],criteria:[{criterion,done:true,outcome:'unverified'}] };
  const observations={...admitted,browserClaimed:false,tasteApplied:true};
  assert.equal(gradeBehavior('screen',r,observations).status,'PASS');
  assert.equal(gradeBehavior('screen',{...r,criteria:[{...r.criteria[0],outcome:'confirmed',head:'b'.repeat(40),worktree_fingerprint:'c'.repeat(64)}]},
    {...observations,checks:[{exit:0,head:'b'.repeat(40),worktree_fingerprint:'c'.repeat(64),afterLastRelevantEdit:true}]}).status,'FAIL');
  assert.equal(gradeBehavior('screen',{...r,not_verified:[{...r.not_verified[0],what:'Visual look'}]},observations).status,'FAIL');
});

test('grader-delivery-root reads report and chronology there and computes the helper fingerprint', () => {
  const repo=createFixture('s3-technical');
  try {
    const deliveryRoot=path.join(repo,'.orchestrator');fs.mkdirSync(deliveryRoot);
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
    const fp=treeFingerprint(repo);
    const r={summary:'Проверка добавлена.\nПередаю в Preflight.',phase_result:'implemented-needs-preflight',not_built:[],not_verified:[],
      criteria:scenarios.find(s=>s.id==='s3-technical').criteria.map(criterion=>({criterion,done:true,outcome:'confirmed',head,worktree_fingerprint:fp}))};
    const observations={...admitted,worktree:repo,ownerQuestions:0,technicalDecisionRecorded:true,
      checks:[{exit:0,head,worktree_fingerprint:fp,afterLastRelevantEdit:true}]};
    const report=path.join(deliveryRoot,'report.json'), observed=path.join(deliveryRoot,'observations.json');
    fs.writeFileSync(report,JSON.stringify(r));fs.writeFileSync(observed,JSON.stringify(observations));
    fs.writeFileSync(path.join(deliveryRoot,'evidence.jsonl'),JSON.stringify({event:'check',exit:0})+'\n');
    const grade=()=>spawnSync(process.execPath,['evals/implement/grade.mjs','s3-technical',report,observed],{encoding:'utf8'});
    assert.equal(grade().status,0,grade().stdout);
    fs.writeFileSync(path.join(repo,'untracked.mjs'),'export const surprise = true;');
    assert.equal(grade().status,1);
    fs.unlinkSync(path.join(repo,'untracked.mjs'));fs.unlinkSync(path.join(deliveryRoot,'evidence.jsonl'));
    assert.equal(grade().status,1,'missing chronology cannot pass');
  } finally {fs.rmSync(repo,{recursive:true,force:true});}
});

for (const [name, before, after, pattern] of [
  ['admission-integration', 'const failures = admissionFailures(report, observations);', 'const failures = [];', '^all-scenario-admission'],
  ['refused-gate', "capture === null && writes?.length === 0 && observations.codeWrites === 0", 'true', '^start-before-capture-and-writes'],
  ['foreign-identity', "need(report.phase_result === 'needs-human', 'Foreign Issue or Project requires needs-human');", 'void 0;', '^start-before-capture-and-writes'],
  ['start-order', 'capture > start?.sequence', 'true', '^admission-order'],
  ['failed-suite', 'check.exit === 0', 'true', '^failed-suite-confirmation'],
  ['tiny-lines', 'report.summary?.trim().split(/\\r?\\n/u).length === 3', 'true', '^tiny-summary'],
  ['screen-case', "report.summary?.toLocaleLowerCase('ru').includes('экран в браузере не проверен')", "report.summary?.includes('экран в браузере не проверен')", '^screen-casing'],
  ['chain-case', "report.summary?.toLocaleLowerCase('ru').includes('нет отчёта предшественницы')", "report.summary?.includes('нет отчёта предшественницы')", '^admission-order'],
  ['screen-gap', "need(criteria[0]?.outcome === 'unverified', 'Visible screen criterion without browser verification stays unverified');", 'void 0;', '^screen-casing'],
  ['shared-fingerprint', 'criterion.worktree_fingerprint === worktreeFingerprint(observations.worktree, observations.deliveryRoot)', 'true', '^grader-delivery-root'],
]) test(`grader deliberate-break ${name} makes the named regression red`, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-grader-mutation-'));
  try {
    for(const dir of ['scripts','evals'])fs.cpSync(path.resolve(dir),path.join(root,dir),{recursive:true});
    const file=path.join(root,'evals/implement/grade.mjs'),source=fs.readFileSync(file,'utf8');
    assert.ok(source.includes(before),name);fs.writeFileSync(file,source.replace(before,after));
    const run=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+pattern,'scripts/implement-evals.test.mjs'],
      {cwd:root,encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='NODE_TEST_CONTEXT'))});
    assert.equal(run.status,1,run.stdout+run.stderr);assert.match(run.stdout,/not ok/);
    assert.doesNotMatch(run.stdout+run.stderr,/ERR_MODULE_NOT_FOUND|SyntaxError/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

for (const [name, target, before, after, pattern] of [
  ['extra-counter-defect', 'fixture.mjs',
    'const broken = `export function createNote(notes, title) {\n  return { notes: [...notes, title], count: notes.length + 1 };',
    'const broken = `export function createNote(notes, title) {\n  return { notes: [...notes, title], count: 0 };', '^scenario-isolation'],
  ['foreign-start-project', 'fixture.mjs',
    "json('start-snapshot/issue-context.json', { issueId, issueKey: 'TRAIN-1', projectId });",
    "json('start-snapshot/issue-context.json', { issueId, issueKey: 'TRAIN-1', projectId: '44444444-4444-4444-8444-444444444444' });", '^scenario-admission'],
  ['foreign-linear-sample', 'fixture.mjs', 'identifier: issue.key', "identifier: 'FOREIGN-1'", '^scenario-admission'],
  ['project-markers', 'fixture.mjs', 'if (projectless) {', 'if (true) {', '^scenario-admission'],
  ['repeated-linear-start', 'linear-adapter.mjs', "command === 'start' && state.issue.status !== 'In Progress'", "command === 'start'", '^scenario-admission'],
  ['fixture-shared-fingerprint', 'fixture.mjs', 'export const treeFingerprint = worktreeFingerprint;',
    "export const treeFingerprint = repo => createHash('sha256').update(fs.readFileSync(path.join(repo, 'notes.mjs'))).digest('hex');", '^grader-delivery-root'],
]) test(`harness deliberate-break ${name} makes the named consumer regression red`, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-harness-mutation-'));
  try {
    for(const dir of ['scripts','evals'])fs.cpSync(path.resolve(dir),path.join(root,dir),{recursive:true});
    const file=path.join(root,'evals/implement',target),source=fs.readFileSync(file,'utf8');
    assert.ok(source.includes(before),name);fs.writeFileSync(file,source.replace(before,after));
    const run=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+pattern,'scripts/implement-evals.test.mjs'],
      {cwd:root,encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='NODE_TEST_CONTEXT'))});
    assert.equal(run.status,1,run.stdout+run.stderr);assert.match(run.stdout,/not ok/);
    assert.doesNotMatch(run.stdout+run.stderr,/ERR_MODULE_NOT_FOUND|SyntaxError/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
