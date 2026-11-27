import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { atomicJson, REVIEW_PRODUCER } from './runtime.mjs';
import { checkSpawnAvailability } from './orchestrator/launch.mjs';
import { uncountedFile } from './orchestrator/command-state.mjs';
import { QA_MARKER } from './qa-certificate.mjs';
import { validatePreflight } from './gate.mjs';

// MONO-505: at most 3 counted attempts per task, no raise; a new attempt needs progress, and after a stalled pass a
// critical defect or a changed approach.
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'orchestrator/attempt-cap.mjs');
const ISSUE = 'MONO-900';
const CHANGED = { changed: true, reason: 'split the parser from the writer' };

function fixture(used = 1) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-attempt-cap-')));
  const root = path.join(scratch, 'root'), evidence = path.join(scratch, 'evidence');
  fs.mkdirSync(path.join(evidence, 'history'), { recursive: true });
  atomicJson(path.join(root, 'control.json'), { state: 'active' });
  atomicJson(path.join(root, 'workers.json'), {});
  atomicJson(path.join(root, 'attempts.json'), { [ISSUE]: used });
  let clock = Date.parse('2026-11-27T00:00:00.000Z'), runs = 0;
  const pinsOf = attempt => path.join(root, 'dispatch', `${ISSUE}-a${attempt}`, 'pins.json');
  // One review round of an attempt: open findings as [key, weight]; an empty list is a clean round.
  const round = (attempt, open, extra = {}) => {
    if (!fs.existsSync(pinsOf(attempt))) atomicJson(pinsOf(attempt), { evidenceRoot: evidence });
    const findings = open.map(([key, weight]) => ({ key, weight, status: 'confirmed', file: 'a.mjs', line: 1, title: key }));
    atomicJson(path.join(evidence, 'history', `run-${++runs}.json`), { receipt: { producer: REVIEW_PRODUCER, pins: { file: pinsOf(attempt) },
      recordedAt: new Date(clock += 60_000).toISOString(), review: { outcome: open.length ? 'not-converged' : 'clean', spent: true, record: { findings } }, ...extra } });
  };
  // One QA pass at a head, in the real report format (certificate after its marker line): blocking bugs as item ids.
  const qa = (head, blocking, verdict = blocking.length ? 'failed' : 'passed') => {
    const file = path.join(root, 'qa', ISSUE, head, 'task-report.json');
    atomicJson(file, { certificate: `${QA_MARKER}\n${JSON.stringify({ scope: 'task', issue: ISSUE, head, verdict,
      bugs: blocking.map((item, n) => ({ id: `B${n}`, class: 'blocking', why: 'acceptance', item, summary: item })) })}` });
    const at = new Date(clock += 60_000); fs.utimesSync(file, at, at);
  };
  const spawnCheck = (extra = {}) => checkSpawnAvailability({ root, issue: ISSUE, ...extra });
  const setUsed = n => atomicJson(path.join(root, 'attempts.json'), { [ISSUE]: n });
  return { root, round, qa, spawnCheck, setUsed, cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }) };
}

test('there is no raise: the 4th counted attempt is refused with the exits, a changed approach does not lift it', () => {
  const f = fixture(2);
  try {
    assert.equal(f.spawnCheck().used, 2);
    f.setUsed(3);
    for (const extra of [{}, { approach: CHANGED }])
      assert.throws(() => f.spawnCheck(extra), /attempt limit reached: 3 of 3 counted attempts used; there is no raise; pick an exit yourself, record it with «Решил сам:».*park the task$/);
    const raise = spawnSync(process.execPath, [script, 'raise', '--root', f.root, '--issue', ISSUE, '--reason', 'r'], { encoding: 'utf8' });
    assert.notEqual(raise.status, 0); assert.match(raise.stderr, /Usage: attempt-cap\.mjs show/);
    // An attempt-cap-raises.json of an older pack is ignored.
    atomicJson(path.join(f.root, 'attempt-cap-raises.json'), { [ISSUE]: [{ number: 1, reason: 'r', recordedAt: new Date().toISOString(), cap: 9, ownerWords: 'да' }] });
    assert.throws(() => f.spawnCheck(), /attempt limit reached: 3 of 3/);
    const shown = spawnSync(process.execPath, [script, 'show', '--root', f.root, '--issue', ISSUE], { encoding: 'utf8' });
    assert.equal(shown.status, 0, shown.stderr);
    assert.deepEqual(JSON.parse(shown.stdout), { issue: ISSUE, used: 3, counted: 3, uncounted: 0, limit: 3, exhausted: true });
  } finally { f.cleanup(); }
});

test('the same approach after a non-converged review or a failed QA is refused; a changed approach or a critical defect passes', () => {
  const f = fixture();
  try {
    f.round(1, [['k1', 'P2']]);
    assert.throws(() => f.spawnCheck(), /same approach refused: the last review did not converge without a critical defect;.*--approach-changed/);
    assert.equal(f.spawnCheck({ approach: CHANGED }).used, 1);
    for (const approach of [{ changed: true, reason: ' ' }, { changed: true, reason: 'two\nlines' }, { changed: 'yes', reason: 'r' }, { changed: true }])
      assert.throws(() => f.spawnCheck({ approach }), /approach must be \{changed: true, reason\}/);
    f.round(1, [['k1', 'P1']]);
    assert.equal(f.spawnCheck().used, 1, 'a P1 finding is a critical defect');
    f.round(1, []);
    f.qa('a'.repeat(40), []);
    assert.equal(f.spawnCheck().used, 1, 'nothing stalled');
  } finally { f.cleanup(); }
  const g = fixture();
  try {
    g.round(1, []);
    g.qa('b'.repeat(40), [], 'unverified');
    assert.throws(() => g.spawnCheck(), /same approach refused: the last QA pass failed without a critical defect/);
    g.qa('c'.repeat(40), ['item-1']);
    assert.equal(g.spawnCheck().used, 1, 'a blocking QA bug is a critical defect');
  } finally { g.cleanup(); }
  const h = fixture();
  try {
    h.round(1, [['k1', 'P2']]); h.qa('d'.repeat(40), []);
    assert.equal(h.spawnCheck().used, 1, 'a passed QA after the review leaves no stalled pass');
  } finally { h.cleanup(); }
});

test('the progress breaker trips on blockers that do not decrease, a blocker back twice or an oversized change', () => {
  const f = fixture();
  try {
    f.round(1, [['k1', 'P1'], ['k2', 'P1']]); f.round(1, [['k3', 'P1']]); f.qa('a'.repeat(40), ['item-1']);
    assert.equal(f.spawnCheck().used, 1, '2, 1, 2: one decrease');
    f.round(1, [['k3', 'P0']]);
    assert.throws(() => f.spawnCheck(), /no progress: open blockers did not decrease over the last two passes \(1, 2, 2\); pick an exit yourself.*move the open findings to successor issues; or park the task; or change the approach/);
    assert.equal(f.spawnCheck({ approach: CHANGED }).used, 1);
  } finally { f.cleanup(); }
  const g = fixture();
  try {
    g.round(1, [['k1', 'P1'], ['k2', 'P1'], ['k3', 'P1']]); g.round(1, [['k1', 'P1'], ['k2', 'P1']]); g.round(1, [['k1', 'P1']]);
    assert.throws(() => g.spawnCheck(), new RegExp('no progress: blocker k1 came back twice'));
  } finally { g.cleanup(); }
  const h = fixture();
  try {
    h.round(1, [], { size: { lines: 900, files: 10, taskChanges: 0, oversized: true } });
    assert.throws(() => h.spawnCheck(), /no progress: the change is oversized/);
  } finally { h.cleanup(); }
});

test('the review line says oversized: merge what is done and split the rest, never a block', () => {
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const receipt = size => ({ producer: REVIEW_PRODUCER, head, base, risk: 'standard', review: { outcome: 'clean', round: 1, limit: 1, successors: [] },
    consistency: { passed: true, error: null }, verification: { exitCode: null }, workerVerification: { head, exitCode: 0 }, size });
  assert.doesNotMatch(validatePreflight(receipt({ lines: 400, files: 25, taskChanges: 2, oversized: false }), head, base), /oversized/);
  assert.match(validatePreflight(receipt({ lines: 700, files: 12, taskChanges: 3, oversized: true }), head, base),
    /^review clean .*; oversized: 700 lines, 12 files, 3 task changes \(budget about 400 lines or 25 files, at most two task changes\); merge what is done and split the rest$/);
});

// MONO-504: an attempt after an environmental death or a pack surface change does not count and skips the progress checks.
test('an attempt after a death by an overloaded model or a pack surface change is uncounted; a death of its own counts', () => {
  const f = fixture(3);
  try {
    const capacity = 'Selected model is at capacity. Please try a different model.';
    const log = attempt => path.join(f.root, 'logs', `${ISSUE}-mono-deliver-a${attempt}.jsonl`);
    const writeLog = (attempt, events) => { fs.mkdirSync(path.dirname(log(attempt)), { recursive: true });
      fs.writeFileSync(log(attempt), events.map(event => JSON.stringify(event)).join('\n') + '\n'); };
    f.round(3, [['k1', 'P2']]);
    writeLog(3, [{ type: 'mono.launch', attempt: 3 }, { type: 'turn.started' }, { type: 'error', message: capacity }, { type: 'turn.failed', error: { message: capacity } }]);
    const free = f.spawnCheck();
    assert.equal(free.uncounted, 'environment: attempt 3 died of capacity', 'neither the limit nor the same-approach rule stops the attempt after an environmental death');
    assert.equal(free.cap.counted, 3);

    // Launch records it beside attempts.json; that attempt then never counts.
    atomicJson(uncountedFile(f.root), { [ISSUE]: [{ attempt: 4, reason: free.uncounted, recordedAt: new Date().toISOString() }] });
    f.setUsed(4);
    writeLog(4, [{ type: 'turn.started' }, { type: 'error', message: capacity }, { type: 'turn.completed' }, { type: 'turn.started' }]);
    assert.throws(() => f.spawnCheck(), /attempt limit reached: 3 of 3 counted attempts used \(1 uncounted\)/, 'a death of its own after a recovered error counts');

    // The pack surface changed since attempt 4's dispatch: the next attempt is uncounted too.
    atomicJson(path.join(f.root, 'dispatch', `${ISSUE}-a4`, 'pins.json'), { surfaceRevision: 5 });
    assert.equal(f.spawnCheck({ surfaceRevision: 6 }).uncounted, 'pack change: attempt 4 ran surface 5, this one 6');
    assert.throws(() => f.spawnCheck({ surfaceRevision: 5 }), /attempt limit reached/, 'the same surface counts');
  } finally { f.cleanup(); }
});
