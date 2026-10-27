import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { publishPhase } from './delivery-state.mjs';

function report(root) {
  const head = 'b'.repeat(40);
  return { issue: 'MONO-993', stage: 'mono-deliver', attempt: 1, packVersion: 'test', surfaceRevision: 4,
    phase: 'code', sequence: 1, kind: 'phase', head, phase_result: 'implemented-needs-preflight',
    summary: 'Справка исправлена. Передаю на проверку перед PR.', not_built: [], not_verified: [],
    criteria: [{ criterion: 'Справка называет действующую команду', done: true, outcome: 'confirmed',
      proof: 'Характеристика: вызов команды с --help', result: 'Команда завершилась с кодом 0', head,
      worktree_fingerprint: 'c'.repeat(64) }],
    linear_mutations_pending: [], capsule: { phase: 'code', head, open_queue: [], decisions: [], writable_roots: [root] } };
}

const cases = [
  ['missing criteria', r => { delete r.criteria; }],
  ['empty criteria', r => { r.criteria = []; }],
  ['known broken behavior', r => { r.criteria[0].outcome = 'broken'; }],
  ['unfinished criterion', r => { r.criteria[0].done = false; r.criteria[0].outcome = 'unverified';
    r.not_verified = [{ what: r.criteria[0].criterion, why: 'Не сделано', risk: 'Старая команда' }]; }],
  ['nonboolean done', r => { r.criteria[0].done = 'true'; }],
  ['unknown outcome', r => { r.criteria[0].outcome = 'pass'; }],
  ['missing proof', r => { delete r.criteria[0].proof; }],
  ['missing observed result', r => { delete r.criteria[0].result; }],
  ['stale confirmed head', r => { r.criteria[0].head = 'a'.repeat(40); }],
  ['missing worktree fingerprint', r => { delete r.criteria[0].worktree_fingerprint; }],
  ['missing summary', r => { delete r.summary; }],
  ['missing not_built', r => { delete r.not_built; }],
  ['missing not_verified', r => { delete r.not_verified; }],
  ['unexplained unverified criterion', r => { r.criteria[0].outcome = 'unverified'; }],
];
for (const [name, mutate] of cases) test(`implementation-publication refuses ${name} before writing`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-code-report-'));
  try {
    const candidate = report(root); mutate(candidate);
    const output = path.join(root, 'reports/MONO-993-phase-code.json');
    assert.throws(() => publishPhase(candidate, output), /implementation report/);
    assert.equal(fs.existsSync(output), false);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'preserve previous report bytes\n');
    assert.throws(() => publishPhase(candidate, output), /implementation report/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'preserve previous report bytes\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('implementation-publication accepts complete confirmed and explicitly unverified work through CLI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-code-report-'));
  try {
    for (const outcome of ['confirmed', 'unverified']) {
      const candidate = report(root); candidate.criteria[0].outcome = outcome;
      if (outcome === 'unverified') candidate.not_verified = [{ what: candidate.criteria[0].criterion,
        why: 'Нет доступа к установленному приложению', risk: 'Справка может расходиться с установленной версией' }];
      const input = path.join(root, `${outcome}.json`), output = path.join(root, outcome, 'reports/MONO-993-phase-code.json');
      fs.writeFileSync(input, JSON.stringify(candidate));
      const result = spawnSync(process.execPath, ['scripts/delivery-state.mjs', 'publish', '--report', input, '--output', output], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(fs.readFileSync(output)).criteria, candidate.criteria);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('implementation-publication keeps broken and unfinished work visible as blocked, never confirmed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-code-report-'));
  try {
    for (const outcome of ['broken', 'unverified']) {
      const candidate = report(root); candidate.phase_result = 'blocked'; candidate.criteria[0].outcome = outcome;
      candidate.criteria[0].done = false;
      if (outcome === 'unverified') candidate.not_verified = [{ what: candidate.criteria[0].criterion, why: 'Не сделано', risk: 'Критерий не выполнен' }];
      assert.equal(publishPhase(candidate, path.join(root, outcome, 'reports/MONO-993-phase-code.json')).phase_result, 'blocked');
    }
    const candidate = report(root); candidate.phase_result = 'blocked'; candidate.criteria[0].done = false;
    assert.throws(() => publishPhase(candidate, path.join(root, 'invalid.json')), /implementation report/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
