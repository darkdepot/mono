import './test-fixtures/host-slots-isolation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireHostSlot, hostSlotsDir, hostSlotCount, HOST_SLOTS_DEFAULT } from './host-slots.mjs';
import { runReviewRound } from './code-review.mjs';
import { installReviewClis } from './test-fixtures/review-clis.mjs';

// MONO-507: a machine-wide limit on heavy work shared by every orchestrator on the host.
const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-slots-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const pending = (promise, ms) => Promise.race([promise.then(() => 'resolved'), new Promise(resolve => setTimeout(() => resolve('pending'), ms))]);

test('slot directory and count: the state root by default, both overridable', () => {
  assert.equal(hostSlotsDir({ MONO_WORKFLOW_STATE_ROOT: '/state' }), '/state/host-slots');
  assert.equal(hostSlotsDir({}), path.join(os.homedir(), '.mono-agent-workflow', 'host-slots'));
  assert.equal(hostSlotsDir({ MONO_HOST_SLOTS_DIR: '/x', MONO_WORKFLOW_STATE_ROOT: '/state' }), '/x');
  assert.equal(hostSlotCount({}), HOST_SLOTS_DEFAULT);
  assert.equal(HOST_SLOTS_DEFAULT, 2);
  assert.equal(hostSlotCount({ MONO_HOST_SLOTS: '3' }), 3);
  assert.equal(hostSlotCount({ MONO_HOST_SLOTS: 'zero' }), HOST_SLOTS_DEFAULT);
});

test('a third claimant waits while two slots are held and takes the one released', async t => {
  const dir = scratch(t), options = { dir, count: 2, pollMs: 10 };
  const first = await acquireHostSlot(options), second = await acquireHostSlot(options);
  assert.deepEqual([first.slot, second.slot], [1, 2]);
  const third = acquireHostSlot(options);
  assert.equal(await pending(third, 150), 'pending', 'no third slot while two are held');
  first.release();
  const got = await third;
  assert.equal(got.slot, 1);
  assert.ok(got.waitedMs >= 100, 'the wait is reported');
  second.release(); got.release();
  assert.deepEqual(fs.readdirSync(dir), [], 'released slots leave nothing behind');
});

test('a dead or reused pid frees its slot on the next acquire', async t => {
  const dir = scratch(t), options = { dir, count: 2, pollMs: 10 };
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(path.join(dir, 'slot-1'), JSON.stringify({ pid: dead, token: 'gone' }));
  // A live pid that started at another time is a reused pid: the owner is gone.
  fs.writeFileSync(path.join(dir, 'slot-2'), JSON.stringify({ pid: process.pid, procStart: 'Mon Jan  1 00:00:00 2001', token: 'reused' }));
  const a = await acquireHostSlot(options), b = await acquireHostSlot(options);
  assert.deepEqual([a.slot, b.slot, a.waitedMs < 1000], [1, 2, true]);
  assert.equal(await pending(acquireHostSlot(options), 100), 'pending', 'live owners are never reclaimed');
  a.release(); b.release();
});

test('a process stopped by SIGTERM releases its slot and still stops', async t => {
  const dir = scratch(t);
  const code = `import(${JSON.stringify(path.join(packRoot, 'scripts/host-slots.mjs'))}).then(async ({ acquireHostSlot }) => {
    await acquireHostSlot({ dir: ${JSON.stringify(dir)}, count: 1 }); console.log('held'); setInterval(() => {}, 1000); });`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(resolve => child.stdout.on('data', data => { if (String(data).includes('held')) resolve(); }));
  assert.ok(fs.existsSync(path.join(dir, 'slot-1')));
  const exit = new Promise(resolve => child.once('exit', (status, signal) => resolve(signal)));
  child.kill('SIGTERM');
  assert.equal(await exit, 'SIGTERM');
  assert.equal(fs.existsSync(path.join(dir, 'slot-1')), false);
});

test('a review role waits for a slot outside its time limit and is reviewed, not timed out', async t => {
  const worktree = scratch(t), dir = scratch(t), bin = scratch(t);
  const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
  fs.writeFileSync(path.join(worktree, 'input.mjs'), 'export function value(n) { return 0; }\n'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(worktree, 'input.mjs'), 'export function value(n) { return n; }\n'); git('add', '.'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD');
  installReviewClis(bin, { packRoot });
  const saved = { PATH: process.env.PATH, MONO_HOST_SLOTS_DIR: process.env.MONO_HOST_SLOTS_DIR, MONO_HOST_SLOTS: process.env.MONO_HOST_SLOTS };
  t.after(() => Object.assign(process.env, saved));
  Object.assign(process.env, { PATH: `${bin}${path.delimiter}${saved.PATH}`, MONO_HOST_SLOTS_DIR: dir, MONO_HOST_SLOTS: '2' });
  // Both slots held by another orchestrator for longer than the role's limit (600 s scaled to 600 ms).
  const holders = [await acquireHostSlot({ dir, count: 2 }), await acquireHostSlot({ dir, count: 2 })];
  const released = setTimeout(() => holders.forEach(holder => holder.release()), 1500);
  t.after(() => clearTimeout(released));
  const started = Date.now();
  const record = await runReviewRound({ worktree, head, base, contract: 'Return only nonnegative numbers.', packRoot }, { ensureLogin: async () => ({ status: 'fresh' }), secondMs: 1 });
  assert.ok(Date.now() - started >= 1400, 'the round waited for the slots');
  assert.notEqual(record.outcome, 'not-reviewed', JSON.stringify(record.failures));
  assert.deepEqual(record.failures.filter(failure => failure.role), [], 'no role failed on the wait');
  assert.deepEqual(fs.readdirSync(dir), [], 'the roles released their slots');
});
