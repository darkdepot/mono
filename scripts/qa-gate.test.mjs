import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { qaDeliveryState, qaRecipeSource, requireQaPassed } from './qa-gate.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-qa-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const issue = 'EXAMPLE-1', head = 'a'.repeat(40), base = 'b'.repeat(40);
  const config = { projectName: 'Example', qa: { mode: 'terminal', install: [], start: 'node --version',
    ready: { command: 'git rev-parse HEAD', identity: 'copy SHA' },
    data: { source: 'local-fixtures', description: 'scratch' }, forbiddenActions: ['external writes'] } };
  const ship = (key, sha) => `mono-ship green certificate\nShip: green\nIssue(s): ${key}\nHead SHA: ${sha}\nPR: #1`;
  const input = { root, config, issue, head, shipCertificate: ship(issue, head) };
  const state = { tasks: { [issue]: { head, project: null } }, projects: {} };
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  const saveState = () => write(path.join(root, 'qa/state.json'), state);
  const save = (scope = 'task', key = issue, sha = head, build) => {
    const dir = path.join(root, 'qa', key, sha); fs.mkdirSync(dir, { recursive: true });
    const evidence = path.join(dir, 'session.cast'); fs.writeFileSync(evidence, 'scratch recording');
    const expected = { scope, issue: key, project: 'project', head: sha, base, kind: 'behavior', mode: 'ship',
      recipeSource: 'config', evidenceRoot: path.join(root, 'qa'), expectedItems: ['C1'], taskCriteria: ['C1'], build,
      shipCertificate: ship(key, sha) };
    const cert = { ...expected, gateEligible: true, verdict: 'passed',
      items: [{ id: 'C1', source: 'task', expectation: 'Observable behavior', outcome: 'passed', evidence: [evidence] }] };
    const report = { certificate: 'mono-qa certificate\n' + JSON.stringify(cert) };
    write(path.join(dir, scope + '-expected.json'), expected); write(path.join(dir, scope + '-report.json'), report);
    return { expected, cert, report, dir, flush: () => {
      write(path.join(dir, scope + '-expected.json'), expected);
      write(path.join(dir, scope + '-report.json'), { certificate: 'mono-qa certificate\n' + JSON.stringify(cert) });
    } };
  };
  return { root, state, input, save, saveState, issue, head, config };
}

test('only config or an explicit product registry record enables QA', () => {
  assert.equal(qaRecipeSource({ projectName: 'Mono Agent Workflow' }), 'registry');
  for (const config of [{}, { projectName: 'Example Ledger' }, { workflows: { qa: 'mono:qa' }, qaAuth: 'owner-session' }]) {
    assert.equal(qaRecipeSource(config), null);
    assert.equal(qaDeliveryState({ config }).state, 'not-connected');
  }
  assert.throws(() => qaRecipeSource({ qa: null }), /qa/);
});

test('current host state is mandatory and cannot be replaced by certificate fields', t => {
  const f = fixture(t); f.save();
  assert.equal(qaDeliveryState(f.input).state, 'waiting');
  f.saveState(); assert.equal(qaDeliveryState(f.input).state, 'passed');
  f.state.tasks[f.issue].head = 'c'.repeat(40); f.saveState();
  assert.equal(qaDeliveryState(f.input).state, 'failed');
  assert.throws(() => requireQaPassed(f.input), /current task\/head/);
});

test('independent expectations prevent a short certificate from skipping behavior', t => {
  const f = fixture(t); f.saveState(); const saved = f.save();
  saved.cert.kind = 'no-behavior'; saved.cert.reason = 'Only text'; delete saved.cert.items; saved.flush();
  assert.match(qaDeliveryState(f.input).reason, /kind mismatch/);
});

test('landing progress selects the last PR despite lifecycle status and stale final hint', t => {
  const f = fixture(t); f.save(); f.state.tasks[f.issue].project = 'project';
  const project = f.state.projects.project = { issues: [
    { issue: f.issue, head: f.head, statusType: 'started', mergedAt: null, labels: [] },
    { issue: 'EXAMPLE-2', head: 'c'.repeat(40), statusType: 'unstarted', mergedAt: null, labels: [] },
    { issue: 'EXAMPLE-3', statusType: 'started', labels: ['Этап'] }
  ] };
  f.saveState(); assert.equal(qaDeliveryState(f.input).state, 'passed', 'two unfinished implementation tasks need task QA only');
  project.issues[1].statusType = 'unknown'; f.saveState();
  assert.equal(qaDeliveryState(f.input).state, 'passed', 'unknown status stays unfinished');
  project.issues[1].mergedAt = '2026-10-01T00:00:00Z';
  project.finalIssue = 'EXAMPLE-2'; f.saveState();
  assert.equal(qaDeliveryState(f.input).state, 'waiting', 'last unmerged PR requires project QA even with stale final hint');
  const build = project.issues.filter(row => !row.labels.includes('Этап')).map(({ issue, head }) => ({ issue, head }));
  f.save('project', f.issue, f.head, build);
  assert.equal(qaDeliveryState(f.input).state, 'passed');
  project.issues[0].mergedAt = '2026-10-02T00:00:00Z'; f.saveState();
  assert.equal(qaDeliveryState(f.input).state, 'passed', 'wave install retains project QA after all PRs merge');
  fs.unlinkSync(path.join(f.root, 'qa', f.issue, f.head, 'project-report.json'));
  assert.equal(qaDeliveryState(f.input).state, 'waiting', 'wave cannot install with task QA only');
  delete project.issues[1].mergedAt; f.saveState();
  assert.equal(qaDeliveryState(f.input).state, 'failed', 'lifecycle status cannot substitute for missing merge progress');
});

test('held predecessor and final bug successor both require the successor project certificate', t => {
  const f = fixture(t), next = 'EXAMPLE-2', nextHead = 'c'.repeat(40);
  f.save(); f.save('task', next, nextHead);
  f.state.tasks[f.issue].project = 'project'; f.state.tasks[next] = { project: 'project', head: nextHead };
  const project = f.state.projects.project = { finalIssue: next, heldIssues: [f.issue, next], issues: [
    { issue: f.issue, head: f.head, statusType: 'started', mergedAt: null, labels: [] },
    { issue: next, head: nextHead, statusType: 'started', mergedAt: null, labels: [] }
  ] };
  f.saveState(); assert.equal(qaDeliveryState(f.input).state, 'waiting');
  const build = project.issues.map(({ issue, head }) => ({ issue, head }));
  f.save('project', next, nextHead, build);
  assert.equal(qaDeliveryState(f.input).state, 'passed');
  const nextInput = { ...f.input, issue: next, head: nextHead,
    shipCertificate: `mono-ship green certificate\nShip: green\nIssue(s): ${next}\nHead SHA: ${nextHead}\nPR: #2` };
  assert.equal(qaDeliveryState(nextInput).state, 'passed');
  project.issues[0].statusType = 'completed'; f.saveState();
  assert.equal(qaDeliveryState(f.input).state, 'passed', 'merging held predecessor does not alter source-head composition');
  project.issues[1].statusType = 'completed'; f.saveState();
  assert.equal(qaDeliveryState(nextInput).state, 'passed', 'persisted final hold survives terminal statuses until install');
  project.issues[0].mergedAt = '2026-10-01T00:00:00Z';
  project.issues[1].mergedAt = '2026-10-02T00:00:00Z';
  delete project.finalIssue; f.saveState();
  assert.equal(qaDeliveryState(f.input).state, 'passed', 'held dependency order retains successor without saved final hint');
  project.issues[0].head = 'd'.repeat(40); f.state.tasks[f.issue].head = 'd'.repeat(40); f.saveState();
  assert.match(qaDeliveryState(nextInput).reason, /build changed/);
});

for (const held of [true, false]) {
  test(`${held ? 'held successor' : 'fresh final'} selection after successor terminal status`, t => {
    const f = fixture(t), next = 'EXAMPLE-2', nextHead = 'c'.repeat(40);
    f.save(); f.save('task', next, nextHead);
    f.state.tasks[f.issue].project = 'project'; f.state.tasks[next] = { project: 'project', head: nextHead };
    const project = f.state.projects.project = { finalIssue: next, heldIssues: held ? [f.issue, next] : [], issues: [
      { issue: f.issue, head: f.head, statusType: 'started', mergedAt: null, labels: [] },
      { issue: next, head: nextHead, statusType: 'completed', mergedAt: '2026-10-01T00:00:00Z', labels: [] }
    ] };
    f.save('project', next, nextHead, project.issues.map(({ issue, head }) => ({ issue, head })));
    f.saveState();
    assert.equal(qaDeliveryState(f.input).state, 'waiting', 'sole unmerged task supersedes a merged held successor');
    f.save('project', f.issue, f.head, project.issues.map(({ issue, head }) => ({ issue, head })));
    assert.equal(qaDeliveryState(f.input).state, 'passed');
    project.issues.push({ issue: 'EXAMPLE-3', head: 'd'.repeat(40), statusType: 'completed',
      mergedAt: '2026-09-30T00:00:00Z', labels: [] }); f.saveState();
    assert.match(qaDeliveryState(f.input).reason, /build changed/);
  });
}

const finalCases = [
  { name: 'sole unmerged without a hold', unmerged: [2], held: [], final: 2 },
  { name: 'merged held chain cannot hide a new sole unmerged PR', unmerged: [2], held: [0, 1], final: 2 },
  { name: 'sole unmerged overrides a merged last held successor', unmerged: [0], held: [0, 1], final: 0 },
  { name: 'all merged retain the last held successor', unmerged: [], held: [0, 1], final: 1 },
  { name: 'all merged without hold use latest merge', unmerged: [], held: [], final: 2 },
  { name: 'multiple unmerged entirely in hold use last held', unmerged: [0, 1], held: [0, 1], final: 1 },
  { name: 'multiple unmerged entirely in hold retain a merged last held', unmerged: [0, 1], held: [0, 1, 2], final: 2 },
  { name: 'multiple unmerged with a new PR conflict with hold', unmerged: [1, 2], held: [0, 1], conflict: true },
  { name: 'multiple unmerged without hold need task QA only', unmerged: [1, 2], held: [] }
];

for (const scenario of finalCases) {
  test(`final selection: ${scenario.name}`, t => {
    const f = fixture(t);
    const rows = [0, 1, 2].map(i => ({ issue: `EXAMPLE-${i + 1}`, head: String.fromCharCode(97 + i).repeat(40),
      statusType: 'started', labels: [], mergedAt: scenario.unmerged.includes(i) ? null : `2026-10-0${i + 1}T00:00:00Z` }));
    const project = f.state.projects.project = { heldIssues: scenario.held.map(i => rows[i].issue),
      finalIssue: rows[0].issue, issues: [...rows,
        { issue: 'EXAMPLE-STAGE', statusType: 'started', labels: ['Этап'] },
        { issue: 'EXAMPLE-CANCELED', statusType: 'canceled', labels: [] },
        { issue: 'EXAMPLE-DUPLICATE', statusType: 'duplicate', labels: [] }] };
    for (const row of rows) {
      f.state.tasks[row.issue] = { head: row.head, project: 'project' };
      f.save('task', row.issue, row.head);
    }
    f.saveState();
    const target = rows[scenario.final ?? scenario.unmerged[0]];
    const input = { ...f.input, issue: target.issue, head: target.head,
      shipCertificate: `mono-ship green certificate\nShip: green\nIssue(s): ${target.issue}\nHead SHA: ${target.head}\nPR: #1` };
    const initial = qaDeliveryState(input);
    if (scenario.conflict) {
      assert.equal(initial.state, 'failed');
      assert.match(initial.reason, /held chain conflicts with unmerged work/);
      return;
    }
    if (scenario.final === undefined) {
      assert.equal(initial.state, 'passed');
      assert.equal(initial.reason, 'task QA passed');
      return;
    }
    assert.equal(initial.state, 'waiting', 'task certificate alone cannot authorize the final PR or install');
    const build = rows.map(({ issue, head }) => ({ issue, head }));
    f.save('project', target.issue, target.head, build.slice(0, 2));
    assert.match(qaDeliveryState(input).reason, /build changed/, 'new eligible issue invalidates the prior composition');
    f.save('project', target.issue, target.head, build);
    assert.equal(qaDeliveryState(input).state, 'passed');
    assert.equal(qaDeliveryState(input).reason, 'task and project QA passed');
  });
}
