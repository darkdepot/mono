// MONO-507: a machine-wide limit on heavy work (review roles, host verification) shared by every orchestrator on the host.
// A slot is a file slot-N holding its owner's pid, process start and a token. It is claimed only by an exclusive create
// (a hard link of a fully written file, so a reader never sees it half written). A slot whose owner is gone (dead pid,
// a pid reused by another process, or this process's own released claim) is reclaimed by renaming it to a unique
// tombstone: only one renamer gets the file, and a renamer that got a live claim puts it back.
// Slots are released when the work ends, on process exit and on SIGINT/SIGTERM (after the slot's stop action, which
// ends work the slot covers, such as a detached host-verification group). A waiting claimant rejects on those signals.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { processStartEpoch } from './runtime.mjs';

export const HOST_SLOTS_DEFAULT = 2;
export const SLOT_POLL_MS = 2000;
const UNWRITABLE = new Set(['EACCES', 'EPERM', 'EROFS']);

export function hostSlotsDir(env = process.env) {
  if (env.MONO_HOST_SLOTS_DIR) return env.MONO_HOST_SLOTS_DIR;
  return path.join(env.MONO_WORKFLOW_STATE_ROOT || path.join(os.homedir(), '.mono-agent-workflow'), 'host-slots');
}
export function hostSlotCount(env = process.env) {
  const value = Number(env.MONO_HOST_SLOTS);
  return Number.isSafeInteger(value) && value > 0 ? value : HOST_SLOTS_DEFAULT;
}
// Inside the worker's Codex sandbox the state root is read-only: there the work runs without a slot.
const inWorkerSandbox = (env = process.env) => !!env.CODEX_SANDBOX;

let ownStart;
const myStart = () => ownStart === undefined ? (ownStart = processStartEpoch(process.pid)) : ownStart;
// null: no file (free). { garbage: true }: empty or unreadable JSON (a dead claim). { held: true }: the file exists but
// cannot be read now (EACCES, EMFILE, ...): treated as held, never evicted.
export function readOwner(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (error) { return error.code === 'ENOENT' ? null : { held: true }; }
  try { const owner = JSON.parse(raw); return owner && typeof owner === 'object' ? owner : { garbage: true }; } catch { return { garbage: true }; }
}
// Held map: file -> { token, stop }. Released claims of this process are tokens no longer in it.
const held = new Map();
// A pid that answers (EPERM included) is alive unless its recorded start (UTC epoch) differs: then the pid was reused.
// This process's own claim is alive only while it still holds that token.
export function ownerAlive(owner) {
  if (owner?.held) return true;
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) return false;
  if (owner.pid === process.pid) return [...held.values()].some(entry => entry.token === owner.token);
  try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') return false; }
  if (Number.isFinite(owner.procStart)) { const now = processStartEpoch(owner.pid); if (now !== null && now !== owner.procStart) return false; }
  return true;
}

function unlinkOwned(file, token) {
  // Retried: a slot left behind by a failed unlink is reclaimed anyway (its token is no longer held).
  for (let tries = 0; tries < 3; tries++) {
    try { if (readOwner(file)?.token !== token) return; fs.unlinkSync(file); return; }
    catch (error) { if (error.code === 'ENOENT') return; }
  }
}
function releaseAll() {
  for (const [file, entry] of held) {
    try { entry.stop?.(); } catch {}
    held.delete(file); unlinkOwned(file, entry.token);
  }
}
// Waiting claimants: rejected (interrupted) on a stopping signal, so a queued role never launches after Ctrl-C.
const waiters = new Set();
function onSignal(signal) {
  releaseAll();
  for (const waiter of waiters) waiter(Object.assign(new Error(`host slot wait interrupted by ${signal}`), { interrupted: true }));
  waiters.clear(); unhook();
  // Nothing else handles the signal: keep its default effect (the process stops).
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true; process.on('exit', releaseAll); process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
}
function unhook() {
  if (!hooked || held.size || waiters.size) return;
  hooked = false; process.removeListener('exit', releaseAll); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
}

// Time this process spent with at least one claimant waiting; a gate's stuck ceiling does not count it.
let waitTotal = 0, waitSince = 0, waiting = 0;
export function slotWaitMs() { return waitTotal + (waiting ? Date.now() - waitSince : 0); }
globalThis.monoHostSlotWaitMs = slotWaitMs;
function waitFile() {
  const file = process.env.MONO_HOST_SLOTS_WAIT_FILE;
  if (file) try { fs.writeFileSync(file, JSON.stringify({ waitMs: slotWaitMs() })); } catch {}
}

function claimOne(file, label) {
  const token = crypto.randomUUID(), temp = `${file}.${token}.new`;
  fs.writeFileSync(temp, JSON.stringify({ pid: process.pid, procStart: myStart(), token, label, at: new Date().toISOString() }), { mode: 0o600 });
  try { fs.linkSync(temp, file); return token; }
  catch (error) { if (error.code === 'EEXIST') return null; throw error; }
  finally { try { fs.unlinkSync(temp); } catch {} }
}
// Moves a dead claim aside. Only one renamer gets a given file; one that got a live claim (it changed since it was
// read) puts it back with an exclusive link and leaves the slot to its owner.
function reclaim(file, seen) {
  const tomb = `${file}.dead-${crypto.randomUUID()}`;
  try { fs.renameSync(file, tomb); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const moved = readOwner(tomb);
  if (moved?.token !== seen?.token || (moved?.token === undefined && !moved?.garbage)) { try { fs.linkSync(tomb, file); } catch {} }
  try { fs.unlinkSync(tomb); } catch {}
}
function tryTake(dir, count, label) {
  for (let n = 1; n <= count; n++) {
    const file = path.join(dir, `slot-${n}`);
    let token = claimOne(file, label);
    if (!token) {
      const owner = readOwner(file);
      if (owner === null || ownerAlive(owner)) continue;
      reclaim(file, owner);
      token = claimOne(file, label);
    }
    if (token) return { file, token, slot: n };
  }
  return null;
}

let warned = false;
function warnOnce(error) {
  if (warned) return;
  warned = true;
  process.stderr.write(`mono host slots: ${error.code ?? 'error'} on ${error.path ?? 'the slot directory'}; running without the host limit\n`);
}
// Waits for a free slot and returns { slot, waitedMs, release, setStop }. The wait has no limit: heavy work queues,
// never fails. A stopping signal (or `signal` aborting) rejects the wait with error.interrupted. slot is null when the
// directory cannot be written: silently in the worker sandbox, otherwise with one stderr line.
export async function acquireHostSlot({ label = 'work', dir = hostSlotsDir(), count = hostSlotCount(), pollMs = SLOT_POLL_MS, signal } = {}) {
  const started = Date.now();
  const free = { slot: null, waitedMs: 0, release: () => {}, setStop: () => {} };
  const unwritable = error => {
    if (!UNWRITABLE.has(error.code)) throw error;
    if (!(inWorkerSandbox() && error.code !== 'EACCES')) warnOnce(error);
    return free;
  };
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (error) { return unwritable(error); }
  let counted = false;
  try {
    for (;;) {
      if (signal?.aborted) throw Object.assign(new Error('host slot wait aborted'), { interrupted: true });
      let taken;
      try { taken = tryTake(dir, count, label); } catch (error) { return unwritable(error); }
      if (taken) {
        const entry = { token: taken.token, stop: null };
        held.set(taken.file, entry); hook();
        let done = false;
        const release = () => { if (done) return; done = true; if (held.get(taken.file) === entry) held.delete(taken.file); unlinkOwned(taken.file, taken.token); unhook(); };
        return { slot: taken.slot, waitedMs: Date.now() - started, release, setStop: stop => { entry.stop = stop; } };
      }
      if (!counted) { counted = true; if (!waiting++) waitSince = Date.now(); }
      waitFile();
      await new Promise((resolve, reject) => {
        let timer;
        const wake = error => { clearTimeout(timer); waiters.delete(wake); signal?.removeEventListener('abort', onAbort); error ? reject(error) : resolve(); };
        const onAbort = () => wake(Object.assign(new Error('host slot wait aborted'), { interrupted: true }));
        timer = setTimeout(() => wake(), pollMs);
        waiters.add(wake); hook(); signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  } finally {
    if (counted && !--waiting) waitTotal += Date.now() - waitSince;
    if (counted) waitFile();
    unhook();
  }
}
// Runs work inside a slot: the slot is taken before work starts (its timers included) and released when it ends.
export async function withHostSlot(options, work) {
  const slot = await acquireHostSlot(options);
  try { return await work(slot); } finally { slot.release(); }
}
