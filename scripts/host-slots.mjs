// MONO-507: a machine-wide limit on heavy work (review roles, host verification) shared by every orchestrator on the host.
// A slot is a file slot-N holding its owner's pid; it is taken by an exclusive create under a short directory lock.
// A slot whose owner is gone (dead pid, or a pid reused by another process) is reclaimed on the next acquire.
// Slots are released when the work ends, on process exit and on SIGINT/SIGTERM.
// A host where the directory cannot be written (a worker sandbox) runs without a slot rather than failing the work.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { processStart } from './runtime.mjs';

export const HOST_SLOTS_DEFAULT = 2;
export const SLOT_POLL_MS = 2000;
const LOCK_STALE_MS = 30_000;
const UNWRITABLE = new Set(['EACCES', 'EPERM', 'EROFS']);

export function hostSlotsDir(env = process.env) {
  if (env.MONO_HOST_SLOTS_DIR) return env.MONO_HOST_SLOTS_DIR;
  return path.join(env.MONO_WORKFLOW_STATE_ROOT || path.join(os.homedir(), '.mono-agent-workflow'), 'host-slots');
}
export function hostSlotCount(env = process.env) {
  const value = Number(env.MONO_HOST_SLOTS);
  return Number.isSafeInteger(value) && value > 0 ? value : HOST_SLOTS_DEFAULT;
}

let ownStart;
const myStart = () => ownStart === undefined ? (ownStart = processStart(process.pid)) : ownStart;
const readOwner = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { return error.code === 'ENOENT' ? null : {}; } };
// A pid that answers (EPERM included) is alive unless its recorded start differs: then the pid was reused.
export function ownerAlive(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) return false;
  try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') return false; }
  if (owner.procStart) { const now = processStart(owner.pid); if (now && now !== owner.procStart) return false; }
  return true;
}

// Slots this process holds: released together on exit or a stopping signal.
const held = new Map();
function releaseAll() { for (const [file, token] of held) { held.delete(file); unlinkOwned(file, token); } }
function onSignal(signal) {
  releaseAll(); unhook();
  // Nothing else handles the signal: keep its default effect (the process stops).
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true; process.on('exit', releaseAll); process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
}
function unhook() {
  if (!hooked) return;
  hooked = false; process.removeListener('exit', releaseAll); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
}
function unlinkOwned(file, token) {
  try { if (readOwner(file)?.token === token) fs.unlinkSync(file); } catch {}
}

// The directory lock serializes scan, reclaim and create, so two waiters never both reclaim one dead slot.
function lock(dir) {
  const file = path.join(dir, '.lock'), token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, procStart: myStart(), token }), { flag: 'wx', mode: 0o600 }); return () => unlinkOwned(file, token); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = readOwner(file);
      let age = 0; try { age = Date.now() - fs.statSync(file).mtimeMs; } catch {}
      if (owner === null || (owner?.pid !== undefined && !ownerAlive(owner)) || age > LOCK_STALE_MS) { try { fs.unlinkSync(file); } catch {} continue; }
      return null;
    }
  }
  return null;
}
function tryTake(dir, count, label) {
  const unlock = lock(dir);
  if (!unlock) return null;
  try {
    for (let n = 1; n <= count; n++) {
      const file = path.join(dir, `slot-${n}`), owner = readOwner(file);
      if (owner !== null && ownerAlive(owner)) continue;
      if (owner !== null) fs.rmSync(file, { force: true });
      const token = crypto.randomUUID();
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, procStart: myStart(), token, label, at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
      return { file, token, slot: n };
    }
    return null;
  } finally { unlock(); }
}

// Waits for a free slot and returns { slot, waitedMs, release }. The wait has no limit: heavy work queues, never fails.
// slot is null when the directory cannot be written: the work runs without a slot.
export async function acquireHostSlot({ label = 'work', dir = hostSlotsDir(), count = hostSlotCount(), pollMs = SLOT_POLL_MS } = {}) {
  const started = Date.now();
  const free = { slot: null, waitedMs: 0, release: () => {} };
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (error) { if (UNWRITABLE.has(error.code)) return free; throw error; }
  for (;;) {
    let taken;
    try { taken = tryTake(dir, count, label); } catch (error) { if (UNWRITABLE.has(error.code)) return free; throw error; }
    if (taken) {
      held.set(taken.file, taken.token); hook();
      let done = false;
      const release = () => { if (done) return; done = true; held.delete(taken.file); unlinkOwned(taken.file, taken.token); if (!held.size) unhook(); };
      return { slot: taken.slot, waitedMs: Date.now() - started, release };
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
// Runs work inside a slot: the slot is taken before work starts (its timers included) and released when it ends.
export async function withHostSlot(options, work) {
  const slot = await acquireHostSlot(options);
  try { return await work(slot); } finally { slot.release(); }
}
