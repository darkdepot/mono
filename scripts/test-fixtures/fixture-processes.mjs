// Fixture children must not outlive their test. Worker and collector launches are
// detached on purpose (their own process group), so a killed or failed test leaves
// them with ppid 1. Three guards:
// - ownerWatchdog: pasted into a long-lived stub, it exits once the owning test
//   process is gone, its own file was removed, or a lifetime cap passes;
// - reapScratch: after the test, finds every process whose command line names the
//   test's unique scratch directory and kills only those (by PID or own group);
// - guardScratch: a detached janitor that runs that reaping when the test process
//   dies without reaching its finally (SIGKILL, an interrupted verification).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

// CommonJS snippet for a stub body. The owner PID is baked into the text because
// worker launches pass the stub an allowlisted environment.
export function ownerWatchdog(ownerPid = process.pid, lifetimeMs = 15 * 60_000) {
  if (!Number.isInteger(ownerPid) || ownerPid <= 1) throw new Error(`invalid owner pid: ${ownerPid}`);
  return `{const __fs=require('node:fs'),__end=Date.now()+${lifetimeMs};` +
    `setInterval(()=>{let gone=false;try{process.kill(${ownerPid},0);}catch(e){gone=e.code==='ESRCH';}` +
    `if(gone||!__fs.existsSync(__filename)||Date.now()>__end)process.exit(0);},200).unref();}`;
}

const variants = dir => {
  const names = new Set([dir]);
  try { names.add(fs.realpathSync(dir)); } catch { /* already removed */ }
  for (const name of [...names]) {
    if (name.startsWith('/private/')) names.add(name.slice('/private'.length));
    else if (name.startsWith('/var/') || name.startsWith('/tmp/')) names.add('/private' + name);
  }
  return [...names];
};

const plain = name => path.resolve(name).replace(/^\/private(?=\/)/, '');
const tmpRoots = () => { const roots = new Set([plain(os.tmpdir())]); try { roots.add(plain(fs.realpathSync(os.tmpdir()))); } catch { /* none */ } return [...roots]; };
// Only a directory strictly inside the temp root, with its own distinctive name,
// may be matched: a vague path would reach other sessions' processes.
function assertScratch(dir) {
  const ok = typeof dir === 'string' && path.basename(dir).length >= 8 && tmpRoots().some(root => {
    const rel = path.relative(root, plain(dir)); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!ok) throw new Error(`refusing a vague scratch path: ${dir}`);
}

// Processes of this scratch directory, excluding the test process itself; null
// when the process table is unavailable (a sandbox without ps, or a fake ps).
export function scratchProcesses(dir) {
  assertScratch(dir);
  const names = variants(dir);
  let output;
  try { output = execFileSync('ps', ['-axww', '-o', 'pid=,pgid=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); }
  catch { return null; }
  const rows = output.split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map(([, pid, pgid, command]) => ({ pid: Number(pid), pgid: Number(pgid), command }));
  if (!rows.some(row => row.pid === process.pid)) return null; // a real table always lists us
  return rows.filter(row => row.pid !== process.pid && names.some(name => row.command.includes(name)));
}
export const processTableAvailable = () => scratchProcesses(path.join(os.tmpdir(), 'mono-fixture-probe')) !== null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Waits up to graceMs for the scratch processes to exit on their own, then kills
// the survivors (a group leader with its whole group) and returns what survived
// the grace period. An empty array means the test cleaned up after itself.
export async function reapScratch(dir, { graceMs = 5000 } = {}) {
  const deadline = Date.now() + graceMs;
  let survivors = scratchProcesses(dir);
  if (survivors === null) return []; // unobservable: the stub watchdog is the guard here
  while (survivors.length && Date.now() < deadline) { await sleep(100); survivors = scratchProcesses(dir) ?? []; }
  for (const { pid, pgid } of survivors) {
    if (!Number.isInteger(pid) || pid <= 1) continue;
    try { process.kill(pgid === pid ? -pid : pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const killDeadline = Date.now() + 5000;
  while ((scratchProcesses(dir) ?? []).length && Date.now() < killDeadline) await sleep(50);
  return survivors;
}

// Starts the janitor for one scratch directory. It exits on its own once the
// directory is removed (the normal finally path); if the owner test process dies
// first, it reaps the directory's processes and removes the directory. Without a
// process table it does not start (returns null). The path
// travels by environment so the janitor's command line never names the directory.
export function guardScratch(dir, { ownerPid = process.pid, lifetimeMs = 60 * 60_000 } = {}) {
  if (!Number.isInteger(ownerPid) || ownerPid <= 1) throw new Error(`invalid owner pid: ${ownerPid}`);
  if (scratchProcesses(dir) === null) return null; // validates the path; no reaping without ps
  const code = `import fs from 'node:fs';import {reapScratch} from ${JSON.stringify(import.meta.url)};
const dir=process.env.MONO_FIXTURE_SCRATCH,owner=${ownerPid},end=Date.now()+${lifetimeMs};
const gone=()=>{try{process.kill(owner,0);return false;}catch(e){return e.code==='ESRCH';}};
const timer=setInterval(async()=>{
  if(!fs.existsSync(dir)||Date.now()>end){clearInterval(timer);return;}
  if(!gone())return;
  clearInterval(timer);await reapScratch(dir,{graceMs:0});fs.rmSync(dir,{recursive:true,force:true});
},250);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code],
    { detached: true, stdio: 'ignore', env: { ...process.env, MONO_FIXTURE_SCRATCH: dir } });
  child.unref();
  return child;
}
