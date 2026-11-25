import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { atomicJson } from './runtime.mjs';
import { checkSpawnAvailability } from './orchestrator/launch.mjs';
import { capRaisesFile, ATTEMPT_CAP_CEILING } from './orchestrator/command-state.mjs';

// MONO-490: a task's attempt cap is raised only through a recorded host step, never by a local config.
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'orchestrator/attempt-cap.mjs');
const ISSUE = 'MONO-900';

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
const delivery = cap => ({ orchestration: { delivery: cap === undefined ? {} : { attemptCap: cap } } });
// The cap's base comes from the product config committed on its base branch (origin/main), like model routes.
function fixture({ used = 3, cap = 3, issues = { [ISSUE]: used } } = {}) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-attempt-cap-')));
  const root = path.join(scratch, 'root'), repo = path.join(scratch, 'repo'), origin = path.join(scratch, 'origin.git');
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  atomicJson(path.join(root, 'control.json'), { state: 'active' });
  atomicJson(path.join(root, 'workers.json'), {});
  atomicJson(path.join(root, 'attempts.json'), issues);
  const config = path.join(repo, '.agents/mono-workflow.config.json');
  atomicJson(config, delivery(cap));
  const git = (...args) => { const r = spawnSync('git', args, { cwd: repo, env: gitEnv, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base');
  spawnSync('git', ['init', '-q', '--bare', origin], { env: gitEnv }); git('remote', 'add', 'origin', origin); git('push', '-q', 'origin', 'main');
  let base = git('rev-parse', 'HEAD');
  // A local edit of the config file, never committed: it must not change the cap.
  const local = value => atomicJson(config, delivery(value));
  // A new commit on main changes the BASE cap for spawn and raise alike.
  const commitBase = value => { local(value); git('commit', '-q', '-am', `cap ${value}`); git('push', '-q', 'origin', 'main'); base = git('rev-parse', 'HEAD'); };
  const raise = (...args) => spawnSync(process.execPath, [script, 'raise', '--root', root, '--config', config, ...args], { encoding: 'utf8', env: gitEnv });
  const spawnCheck = (issue = ISSUE) => checkSpawnAvailability({ root, issue, config, worktree: repo, base });
  const setUsed = (n, issue = ISSUE) => {
    const attempts = JSON.parse(fs.readFileSync(path.join(root, 'attempts.json'), 'utf8'));
    atomicJson(path.join(root, 'attempts.json'), { ...attempts, [issue]: n });
  };
  const records = () => fs.existsSync(capRaisesFile(root)) ? JSON.parse(fs.readFileSync(capRaisesFile(root), 'utf8')) : null;
  const bytes = () => fs.existsSync(capRaisesFile(root)) ? fs.readFileSync(capRaisesFile(root), 'utf8') : null;
  return { root, config, local, commitBase, raise, spawnCheck, setUsed, records, bytes, cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }) };
}
const ok = r => { assert.equal(r.status, 0, r.stderr + r.stdout); return JSON.parse(r.stdout); };
const refused = (r, pattern) => { assert.notEqual(r.status, 0, r.stdout); assert.match(r.stderr, pattern); };

test('a raise of +1 with a reason allows exactly one more attempt', () => {
  const f = fixture();
  try {
    assert.throws(() => f.spawnCheck(), /attempt cap reached: 3 of 3 used \(base 3, raises 0\).*attempt-cap\.mjs raise/);
    const result = ok(f.raise('--issue', ISSUE, '--reason', 'review found a fixable bug after round 3'));
    assert.equal(result.cap, 4); assert.equal(result.raise.number, 1);
    const [record] = f.records()[ISSUE];
    assert.deepEqual(Object.keys(record).sort(), ['cap', 'number', 'reason', 'recordedAt']);
    assert.equal(record.cap, 4);
    assert.equal(record.reason, 'review found a fixable bug after round 3');
    assert.equal(new Date(record.recordedAt).toISOString(), record.recordedAt);
    assert.equal(f.spawnCheck().used, 3);
    f.setUsed(4);
    assert.throws(() => f.spawnCheck(), /attempt cap reached: 4 of 4 used \(base 3, raises 1\)/);
    // The record is shown where the orchestrator reads attempt state.
    const shown = ok(spawnSync(process.execPath, [script, 'show', '--root', f.root, '--config', f.config, '--issue', ISSUE], { encoding: 'utf8' }));
    assert.deepEqual({ ...shown, raises: shown.raises.length }, { issue: ISSUE, used: 4, baseCap: 3, cap: 4, ceiling: ATTEMPT_CAP_CEILING, exhausted: true, raises: 1, warnings: [] });
  } finally { f.cleanup(); }
});

test('a raise is refused and writes nothing while the cap is not exhausted', () => {
  const f = fixture({ used: 2 });
  try {
    refused(f.raise('--issue', ISSUE, '--reason', 'just in case'), /not exhausted: 2 of 3 used/);
    assert.equal(f.bytes(), null);
    refused(f.raise('--issue', 'MONO-901', '--reason', 'never dispatched'), /not exhausted: 0 of 3 used/);
    assert.equal(f.bytes(), null);
  } finally { f.cleanup(); }
});

test('a raise is refused and writes nothing without a reason', () => {
  const f = fixture();
  try {
    refused(f.raise('--issue', ISSUE), /non-empty --reason/);
    refused(f.raise('--issue', ISSUE, '--reason', '   '), /non-empty --reason/);
    assert.equal(f.bytes(), null);
    assert.throws(() => f.spawnCheck(), /attempt cap reached/);
  } finally { f.cleanup(); }
});

test('above the ceiling of 6 a raise needs the owner\'s words', () => {
  const f = fixture();
  try {
    for (const used of [3, 4, 5]) { f.setUsed(used); ok(f.raise('--issue', ISSUE, '--reason', `fix ${used}`)); }
    f.setUsed(6);
    assert.throws(() => f.spawnCheck(), /attempt cap reached: 6 of 6/);
    const before = f.bytes();
    refused(f.raise('--issue', ISSUE, '--reason', 'one more'), /above the ceiling of 6.*--owner-words/);
    refused(f.raise('--issue', ISSUE, '--reason', 'one more', '--owner-words', '  '), /above the ceiling of 6.*--owner-words/);
    assert.equal(f.bytes(), before);
    const words = 'Давай ещё одну попытку на MONO-900, последнюю.';
    const result = ok(f.raise('--issue', ISSUE, '--reason', 'one more', '--owner-words', words));
    assert.equal(result.cap, 7); assert.equal(f.records()[ISSUE][3].ownerWords, words);
    assert.equal(f.spawnCheck().used, 6);
    // The config field stays the base: a base already at the ceiling makes every raise need the owner's words.
    const g = fixture({ cap: 6, used: 6 });
    try {
      refused(g.raise('--issue', ISSUE, '--reason', 'r'), /above the ceiling of 6/);
      ok(g.raise('--issue', ISSUE, '--reason', 'r', '--owner-words', 'да, ещё одну'));
    } finally { g.cleanup(); }
  } finally { f.cleanup(); }
});

test('a hand-edited record cannot lift the cap', () => {
  const f = fixture({ used: 6, cap: 6 });
  try {
    const at = new Date().toISOString();
    atomicJson(capRaisesFile(f.root), { [ISSUE]: [{ number: 1, reason: 'r', recordedAt: at, cap: 7 }] });
    assert.throws(() => f.spawnCheck(), /invalid attempt-cap-raises\.json: raise 1 of MONO-900 lifts the cap to 7 above 6 without owner words/);
    refused(f.raise('--issue', ISSUE, '--reason', 'r', '--owner-words', 'w'), /lifts the cap to 7 above 6 without owner words/);
    for (const bad of [
      { [ISSUE]: [{ number: 2, reason: 'r', recordedAt: at, cap: 4 }] },
      { [ISSUE]: [{ number: 1, reason: '', recordedAt: at, cap: 4 }] },
      { [ISSUE]: [{ number: 1, reason: 'r', recordedAt: 'yesterday', cap: 4 }] },
      { [ISSUE]: [{ number: 1, reason: 'r', recordedAt: at }] },
      { [ISSUE]: [{ number: 1, reason: 'r', recordedAt: at, cap: 4, extra: true }] },
      { [ISSUE]: [{ number: 1, reason: 'r', recordedAt: at, cap: 4 }, { number: 2, reason: 'r', recordedAt: at, cap: 4 }] },
      { [ISSUE]: [{ number: 1, reason: 'r', recordedAt: at, cap: 9, ownerWords: ' ' }] },
      { 'MONO-901': [{ number: 1, reason: 'r', recordedAt: at, cap: 8 }] },
      { 'not-an-issue': [] },
      [],
    ]) {
      atomicJson(capRaisesFile(f.root), bad);
      assert.throws(() => f.spawnCheck(), /invalid attempt-cap-raises\.json/);
      refused(f.raise('--issue', ISSUE, '--reason', 'r', '--owner-words', 'w'), /invalid attempt-cap-raises\.json/);
    }
  } finally { f.cleanup(); }
});

test('the record lives in the orchestrator root, outside the worker mailbox', () => {
  const f = fixture();
  try {
    const file = capRaisesFile(f.root);
    assert.equal(path.dirname(file), f.root);
    assert.equal(path.basename(file), 'attempt-cap-raises.json');
    assert.ok(!file.startsWith(path.join(f.root, 'reports') + path.sep));
  } finally { f.cleanup(); }
});

test('concurrent raises lose no update', async () => {
  const issues = Object.fromEntries(['MONO-910', 'MONO-911', 'MONO-912', 'MONO-913', 'MONO-914'].map(issue => [issue, 3]));
  const f = fixture({ issues });
  const run = (issue, reason) => new Promise(resolve => {
    const child = spawn(process.execPath, [script, 'raise', '--root', f.root, '--config', f.config, '--issue', issue, '--reason', reason]);
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stderr }));
  });
  try {
    // Different issues share one file: every raise lands.
    const spread = await Promise.all(Object.keys(issues).map(issue => run(issue, `raise ${issue}`)));
    assert.deepEqual(spread.map(r => r.status), [0, 0, 0, 0, 0], spread.map(r => r.stderr).join('\n'));
    assert.deepEqual(Object.keys(f.records()).sort(), Object.keys(issues));
    for (const issue of Object.keys(issues)) assert.deepEqual(f.records()[issue].map(r => r.reason), [`raise ${issue}`]);
    // The same exhausted issue raised five times at once: exactly one raise lands, the rest see the new cap.
    for (const issue of Object.keys(issues)) f.setUsed(4, issue);
    const same = await Promise.all([1, 2, 3, 4, 5].map(n => run('MONO-910', `race ${n}`)));
    assert.equal(same.filter(r => r.status === 0).length, 1, same.map(r => r.stderr).join('\n'));
    for (const r of same.filter(r => r.status !== 0)) assert.match(r.stderr, /not exhausted: 4 of 5 used/);
    assert.equal(f.records()['MONO-910'].length, 2);
  } finally { f.cleanup(); }
});

test('a later BASE change keeps raises that were valid when recorded', () => {
  const f = fixture({ cap: 3, used: 3 });
  try {
    for (const used of [3, 4, 5]) { f.setUsed(used); ok(f.raise('--issue', ISSUE, '--reason', `fix ${used}`)); }
    assert.deepEqual(f.records()[ISSUE].map(r => r.cap), [4, 5, 6]);
    f.setUsed(5);
    f.commitBase(4);
    // The third raise produced cap 6 under base 3; base 4 does not re-judge it as 7: attempt 6 is allowed.
    const state = f.spawnCheck();
    assert.equal(state.used, 5); assert.equal(state.cap.baseCap, 4); assert.equal(state.cap.cap, 6);
    f.setUsed(6);
    assert.throws(() => f.spawnCheck(), /attempt cap reached: 6 of 6 used \(base 4, raises 3\)/);
    // The next raise goes from 6 to 7 and needs the owner's words.
    refused(f.raise('--issue', ISSUE, '--reason', 'r'), /would go to 7 attempts, above the ceiling of 6/);
    assert.equal(ok(f.raise('--issue', ISSUE, '--reason', 'r', '--owner-words', 'да, седьмую')).cap, 7);
    // A BASE above the last raise wins: the effective cap never falls below the base.
    f.commitBase(6); f.setUsed(6);
    assert.equal(f.spawnCheck().cap.cap, 7);
  } finally { f.cleanup(); }
});

test('a committed base above the ceiling counts as 6', () => {
  const f = fixture({ cap: 100, used: 6 });
  try {
    assert.throws(() => f.spawnCheck(), /attempt cap reached: 6 of 6 used \(base 6, raises 0\)/);
    const shown = f.raise('--issue', ISSUE, '--reason', 'r');
    refused(shown, /above the ceiling of 6/);
    assert.match(shown.stderr, /warning: BASE attemptCap 100 is above the ceiling of 6 and counts as 6/);
    assert.equal(f.bytes(), null);
    f.setUsed(5);
    const state = f.spawnCheck();
    assert.equal(state.used, 5); assert.equal(state.cap.baseCap, 6);
    assert.ok(state.cap.warnings.some(w => /BASE attemptCap 100 is above the ceiling/.test(w)));
  } finally { f.cleanup(); }
});

test('a fractional BASE cap is refused before anything is written', () => {
  const f = fixture({ cap: 3.5, used: 4 });
  try {
    refused(f.raise('--issue', ISSUE, '--reason', 'r'), /BASE attemptCap must be a whole number, got 3.5/);
    assert.equal(f.bytes(), null);
    assert.throws(() => f.spawnCheck(), /BASE attemptCap must be a whole number/);
  } finally { f.cleanup(); }
});

test('a local --config with a higher cap than BASE grants no attempt', () => {
  const f = fixture({ cap: 3, used: 3 });
  try {
    f.local(10);
    assert.throws(() => f.spawnCheck(), /attempt cap reached: 3 of 3 used \(base 3, raises 0\)/);
    const shown = spawnSync(process.execPath, [script, 'show', '--root', f.root, '--config', f.config, '--issue', ISSUE], { encoding: 'utf8' });
    const state = ok(shown);
    assert.equal(state.baseCap, 3); assert.equal(state.cap, 3); assert.equal(state.exhausted, true);
    assert.match(shown.stderr, /warning: --config attemptCap 10 differs from BASE attemptCap 3 and is ignored/);
    // A raise still goes through the recorded step and counts from the BASE cap.
    assert.equal(ok(f.raise('--issue', ISSUE, '--reason', 'r')).cap, 4);
  } finally { f.cleanup(); }
});

test('without attemptCap in the committed config the pack default of 3 stays', () => {
  const f = fixture({ cap: undefined, used: 2 });
  try {
    const state = f.spawnCheck();
    assert.equal(state.cap.baseCap, 3); assert.deepEqual(state.cap.warnings, []);
    f.setUsed(3);
    assert.throws(() => f.spawnCheck(), /attempt cap reached: 3 of 3 used \(base 3, raises 0\)/);
  } finally { f.cleanup(); }
});
