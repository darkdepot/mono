import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createFixture, treeFingerprint, scenarios } from '../evals/implement/fixture.mjs';

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
        const before = JSON.parse(fs.readFileSync(path.join(repo,'evidence-before.json')));
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
          behavioral_oracle: null, risk_class: null, approval_status: 'absent' });
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

test('implement U8 scenarios retain behavioral rubrics, with chain cases explicitly pending T2', () => {
  assert.equal(scenarios.length, 10);
  for (const scenario of scenarios) {
    const dir = path.join('evals/implement/behavior', scenario.id);
    const rubric = fs.readFileSync(path.join(dir,'graders/behavior.md'),'utf8');
    assert.match(rubric, /1\. /); assert.match(rubric, /2\. /); assert.match(rubric, /3\. /);
    assert.equal(scenario.status, scenario.id.startsWith('u6-') ? 'pending-T2' : 'ready');
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
  const fresh = { checks: [{exit:0,head,worktree_fingerprint,afterLastRelevantEdit:true}] };
  const forgotten = base('ae4-forgotten'); forgotten.criteria.pop();
  assert.equal(gradeBehavior('ae4-forgotten',forgotten,fresh).status,'FAIL');
  assert.equal(gradeBehavior('ae3-stale',base('ae3-stale'),{checks:[{exit:0,head,worktree_fingerprint,afterLastRelevantEdit:false}]}).status,'FAIL');
  assert.equal(gradeBehavior('ae3-stale',base('ae3-stale'),fresh).status,'PASS');
  const broken = base('ae2-broken'); broken.criteria[0].outcome='unverified';
  assert.equal(gradeBehavior('ae2-broken',broken,{checks:[{exit:1,targetDefectObserved:true}]}).status,'FAIL');
  broken.phase_result='blocked';broken.criteria[0].outcome='broken';
  assert.equal(gradeBehavior('ae2-broken',broken,{checks:[{exit:1,targetDefectObserved:true}]}).status,'PASS');
  assert.equal(gradeBehavior('u6-missing-report',{},{}).status,'pending-T2');
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
