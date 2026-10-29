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

test('only stage labels and terminal status types remove tasks from final detection', t => {
  const f = fixture(t); f.save(); f.state.tasks[f.issue].project = 'project';
  const project = f.state.projects.project = { issues: [
    { issue: f.issue, head: f.head, statusType: 'started', labels: [] },
    { issue: 'EXAMPLE-2', head: 'c'.repeat(40), statusType: 'unstarted', labels: [] },
    { issue: 'EXAMPLE-3', statusType: 'started', labels: ['Этап'] }
  ] };
  f.saveState(); assert.equal(qaDeliveryState(f.input).state, 'passed', 'two unfinished implementation tasks need task QA only');
  project.issues[1].statusType = 'unknown'; f.saveState();
  assert.equal(qaDeliveryState(f.input).state, 'passed', 'unknown status stays unfinished');
  project.issues[1].statusType = 'completed'; f.saveState();
  assert.equal(qaDeliveryState(f.input).state, 'waiting', 'last unfinished implementation requires project QA');
});

test('held predecessor and final bug successor both require the successor project certificate', t => {
  const f = fixture(t), next = 'EXAMPLE-2', nextHead = 'c'.repeat(40);
  f.save(); f.save('task', next, nextHead);
  f.state.tasks[f.issue].project = 'project'; f.state.tasks[next] = { project: 'project', head: nextHead };
  const project = f.state.projects.project = { finalIssue: next, heldIssues: [f.issue, next], issues: [
    { issue: f.issue, head: f.head, statusType: 'started', labels: [] },
    { issue: next, head: nextHead, statusType: 'started', labels: [] }
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
  project.issues[0].head = 'd'.repeat(40); f.state.tasks[f.issue].head = 'd'.repeat(40); f.saveState();
  assert.match(qaDeliveryState(nextInput).reason, /build changed/);
});
