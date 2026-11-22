// MONO-463: fixture children (detached fake CLIs, collectors) must not outlive their test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { test } from 'node:test';
import { guardScratch, ownerWatchdog, processTableAvailable, reapScratch, scratchProcesses } from './test-fixtures/fixture-processes.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (check()) return true; await sleep(50); }
  return check();
}
const noPs = processTableAvailable() ? false : 'process table unavailable (sandbox); the stub watchdog still applies';
const helper = new URL('./test-fixtures/fixture-processes.mjs', import.meta.url).href;

// An owner process models a test file: it writes a detached long-lived stub the
// way the delivery fixtures do, launches it, reports the stub PID and waits.
function startOwner(scratch, watchdog, janitor = false) {
  const owner = `import fs from 'node:fs';import {spawn} from 'node:child_process';import {ownerWatchdog,guardScratch} from ${JSON.stringify(helper)};
if(${janitor})guardScratch(${JSON.stringify(scratch)});
const stub=${JSON.stringify(path.join(scratch, 'bin/codex'))};fs.mkdirSync(${JSON.stringify(path.join(scratch, 'bin'))},{recursive:true});
const mate=${JSON.stringify(path.join(scratch, 'mate.pid'))};
const body=${watchdog}?ownerWatchdog():"const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync("+JSON.stringify(mate)+",String(c.pid));";
fs.writeFileSync(stub,'#!'+process.execPath+'\\n'+body+'\\nsetInterval(()=>{},1000);\\n',{mode:0o700});
const child=spawn(stub,['exec','--json'],{detached:true,stdio:'ignore'});child.unref();
child.once('spawn',()=>console.log(child.pid));setInterval(()=>{},1000);`;
  const process_ = spawn(process.execPath, ['--input-type=module', '-e', owner], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let out = '';
    process_.stdout.on('data', chunk => { out += chunk; if (out.includes('\n')) resolve({ owner: process_, stub: Number(out.trim()) }); });
    process_.once('exit', code => reject(new Error(`owner exited early: ${code}`)));
  });
}

test('a stub with the owner watchdog exits when its test process is SIGKILLed', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-fixture-watchdog-'));
  try {
    const { owner, stub } = await startOwner(scratch, true);
    assert.ok(alive(stub));
    owner.kill('SIGKILL');
    assert.ok(await until(() => !alive(stub)), 'the stub outlived its killed owner');
    if (!noPs) assert.deepEqual(scratchProcesses(scratch), []);
  } finally { await reapScratch(scratch, { graceMs: 0 }); fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('reapScratch finds and kills only processes of its scratch directory, with their group', { skip: noPs }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-fixture-reap-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-fixture-other-'));
  let bystander;
  try {
    // Without the watchdog the stub survives its killed owner: this is the leak.
    const { owner, stub } = await startOwner(scratch, false);
    owner.kill('SIGKILL');
    await sleep(300);
    assert.ok(alive(stub), 'fixture precondition: an unguarded detached stub survives');
    // The stub's own child shares its group, but its command line does not name the scratch dir.
    const matePid = path.join(scratch, 'mate.pid');
    assert.ok(await until(() => fs.existsSync(matePid) && fs.readFileSync(matePid, 'utf8') !== ''));
    const mate = Number(fs.readFileSync(matePid, 'utf8')); assert.ok(alive(mate));
    // A process of another directory is never touched.
    const elsewhere = path.join(other, 'bystander.js'); fs.writeFileSync(elsewhere, 'setInterval(()=>{},1000);');
    bystander = spawn(process.execPath, [elsewhere], { detached: true, stdio: 'ignore' }); bystander.unref();
    assert.deepEqual(scratchProcesses(scratch).map(row => row.pid), [stub]);
    const leaked = await reapScratch(scratch, { graceMs: 200 });
    assert.deepEqual(leaked.map(row => row.pid), [stub]);
    assert.ok(await until(() => !alive(stub) && !alive(mate)), 'the stub and its group are gone');
    assert.ok(alive(bystander.pid), 'a process of another directory stays alive');
    assert.deepEqual(await reapScratch(scratch, { graceMs: 0 }), [], 'nothing left after reaping');
  } finally {
    if (bystander?.pid) { try { process.kill(bystander.pid, 'SIGKILL'); } catch { /* exited */ } }
    await reapScratch(scratch, { graceMs: 0 });
    fs.rmSync(scratch, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true });
  }
});

test('the scratch janitor reaps an unguarded stub and the directory when its test is SIGKILLed', { skip: noPs }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-fixture-janitor-'));
  try {
    const { owner, stub } = await startOwner(scratch, false, true);
    const matePid = path.join(scratch, 'mate.pid');
    assert.ok(await until(() => fs.existsSync(matePid) && fs.readFileSync(matePid, 'utf8') !== ''));
    const mate = Number(fs.readFileSync(matePid, 'utf8'));
    owner.kill('SIGKILL');
    assert.ok(await until(() => !alive(stub) && !alive(mate) && !fs.existsSync(scratch)), 'the janitor left the stub or the directory');
  } finally { await reapScratch(scratch, { graceMs: 0 }); fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('the scratch janitor exits on its own once the test removes the directory', { skip: noPs }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-fixture-janitor-done-'));
  const janitor = guardScratch(scratch);
  try {
    assert.ok(alive(janitor.pid));
    assert.doesNotMatch(execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(janitor.pid)], { encoding: 'utf8' }), new RegExp(path.basename(scratch)),
      'the janitor command line never names the directory it guards');
    fs.rmSync(scratch, { recursive: true, force: true });
    assert.ok(await until(() => !alive(janitor.pid)), 'the janitor outlived its directory');
  } finally { try { process.kill(janitor.pid, 'SIGKILL'); } catch { /* exited */ } fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('only a distinctive directory inside the temp root may be matched', () => {
  for (const dir of [os.tmpdir(), fs.realpathSync(os.tmpdir()), '/tmp', '/private/tmp', '/', path.join(os.tmpdir(), 'short'), path.join(os.homedir(), 'mono-fixture-elsewhere'), path.join(os.tmpdir(), '..', 'mono-fixture-escape')])
    assert.throws(() => scratchProcesses(dir), /vague scratch path/, dir);
  assert.doesNotThrow(() => scratchProcesses(path.join(os.tmpdir(), 'mono-fixture-inside')));
});

test('ownerWatchdog and guardScratch refuse an owner PID that would address a process group or everything', () => {
  for (const pid of [0, 1, -1, 1.5, '42']) {
    assert.throws(() => ownerWatchdog(pid), /invalid owner pid/);
    assert.throws(() => guardScratch(os.tmpdir() + '/mono-fixture-never', { ownerPid: pid }), /invalid owner pid/);
  }
  assert.match(ownerWatchdog(4242), /process\.kill\(4242,0\)/);
});
