import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { copyPluginFixture } from './plugin-fixture.mjs';
import { ideaDispatchFixture } from './fixtures/idea-dispatch.mjs';
import { atomicJson } from './runtime.mjs';
import { createHash } from 'node:crypto';
process.env.MONO_CODEX_PROBE_BIN ??= new URL('./test-fixtures/fake-codex-linear.mjs', import.meta.url).pathname; // MONO-509 Linear path probe

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const pass = r => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout.trim(); };
const pulse = root => atomicJson(path.join(root, 'watcher.json'), {
  pid: process.pid, procStart: 'fixture-start', packVersion: fs.readFileSync(path.join(checkout, 'VERSION'), 'utf8').trim(),
  startedAt: new Date().toISOString(), beatAt: new Date().toISOString(), intervalSec: 30,
});
async function stopped(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  for (let n = 0; n < 200; n++) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return; throw e; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`fixture process ${pid} did not exit`);
}
function fixture() {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-watcher-')));
  const root = path.join(scratch, 'root'), pack = path.join(scratch, 'pack'), repo = path.join(scratch, 'repo');
  const bin = path.join(scratch, 'bin'), snapshot = path.join(scratch, 'snapshot'), issue = 'MONO-999';
  const evidence = path.join(scratch, 'evidence'), config = path.join(repo, '.agents/mono-workflow.config.json');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const run = (command, args, cwd = repo) => spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const call = (script, ...args) => run(process.execPath, [path.join(pack, 'scripts', script), ...args]);
  for (const dir of [repo, bin, path.join(root, 'reports')]) fs.mkdirSync(dir, { recursive: true });
  copyPluginFixture(pack);
  put(path.join(bin, 'codex'), '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"watcher-fixture"}));setInterval(()=>{},1000);\n');
  fs.chmodSync(path.join(bin, 'codex'), 0o700);
  put(path.join(bin, 'ps'), `#!${process.execPath}\nconsole.log('fixture-start');\n`); fs.chmodSync(path.join(bin, 'ps'), 0o700);
  const policy = read(path.join(checkout, '.agents/mono-workflow.config.json'));
  policy.orchestration.transport = 'codex-cli';
  policy.ideaGate = { since: '2026-10-17' };
  policy.orchestration.dispatch = { product: 'watcher-fixture', evidenceRoot: evidence, openDecisions: 0, lifecycle_moves: [], verification: { command: 'node', args: ['scripts/verify.mjs'] } };
  atomicJson(config, policy); put(path.join(repo, '.gitignore'), '.worktrees/\n.orchestrator/\n');
  pass(run('git', ['init', '-b', 'main']));
  pass(run('git', ['add', '.'])); pass(run('git', ['commit', '-m', 'base']));
  const origin = path.join(scratch, 'origin.git'); pass(run('git', ['init', '--bare', origin]));
  pass(run('git', ['remote', 'add', 'origin', origin])); pass(run('git', ['push', 'origin', 'main']));
  atomicJson(path.join(root, 'control.json'), { state: 'active' }); atomicJson(path.join(root, 'workers.json'), {});
  put(path.join(snapshot, `issue-${issue}.md`), '# Watcher fixture\n# Что сделать\nWatch.\n# Готовность агента\nAFK\n# Как проверить\nWatch.\n# Ключевые контракты\nNo lost events.\nРиск: risky\n');
  for (const name of ['approval', 'project-brief', 'prd', 'tech-spec']) put(path.join(snapshot, name + '.md'), 'Approved fixture\n');
  ideaDispatchFixture(snapshot, issue);
  const writable = path.join(scratch, 'writable.json'); atomicJson(writable, []);
  const args = ['--issue', issue, '--root', root, '--config', config, '--snapshot', snapshot, '--skills-root', pack, '--worker-writable-roots', writable];
  const dispatch = (...extra) => call('orchestrator/dispatch.mjs', ...args, ...extra);
  const entry = () => read(path.join(root, 'workers.json'))[issue];
  const retire = async () => { const e = entry(); if (e?.pid) await stopped(e.pid); atomicJson(path.join(root, 'workers.json'), {}); };
  const cleanup = async () => { await retire(); fs.rmSync(scratch, { recursive: true, force: true }); };
  return { scratch, root, pack, repo, evidence, config, issue, run, call, dispatch, entry, retire, cleanup, env };
}

test('launch-watcher-required', async t => {
  const f = fixture();
  try {
    // Dispatch prepares the request even when the shared launch boundary refuses it.
    const absent = f.dispatch(); assert.notEqual(absent.status, 0); assert.match(absent.stderr, /watcher-required:.*watch-workers\.mjs/);
    const requestFile = path.join(f.root, 'dispatch', `${f.issue}-a1`, 'spawn.json');
    pass(f.call('orchestrator/spawn.mjs', '--pins', requestFile));
    for (const [name, change] of [
      ['missing', () => fs.rmSync(path.join(f.root, 'watcher.json'))],
      ['stale', p => { p.beatAt = new Date(Date.now() - 91_000).toISOString(); }],
      ['future', p => { p.beatAt = new Date(Date.now() + 60_000).toISOString(); }],
      ['dead', p => { p.pid = 2147483647; }],
      ['reused', p => { p.procStart = 'another process incarnation'; }],
    ]) await t.test(name, () => {
      for (const launch of [() => f.dispatch(), () => f.call('orchestrator/spawn.mjs', '--request', requestFile)]) {
        pulse(f.root); const p = read(path.join(f.root, 'watcher.json')); change(p);
        if (name !== 'missing') atomicJson(path.join(f.root, 'watcher.json'), p);
        const r = launch(); assert.notEqual(r.status, 0); assert.match(r.stderr, /watcher-required:/);
        assert.deepEqual(read(path.join(f.root, 'workers.json')), {});
        assert.equal(fs.existsSync(path.join(f.root, 'attempts.json')), false);
      }
    });
    pulse(f.root); pass(f.dispatch());
    // MONO-457: BASE hostVerification (Mono's own config) is pinned for the attempt and adds the dispatch block.
    const launched = path.join(f.root, 'dispatch', `${f.issue}-a1`);
    assert.equal(read(path.join(launched, 'pins.json')).hostVerification, true);
    // MONO-481: no mockup in the snapshot and no recipe switch: the attempt is not pinned with screenCheck.
    assert.equal(Object.hasOwn(read(path.join(launched, 'pins.json')), 'screenCheck'), false);
    assert.match(fs.readFileSync(path.join(launched, 'dispatch.md'), 'utf8'), /## Проверка на хосте\n\nPinned `hostVerification: true`/);
    const entry = f.entry(); await stopped(entry.pid);
    const resumeFile = path.join(f.scratch, 'resume.md'); put(resumeFile, 'Continue the same issue.');
    const resumeRequest = path.join(f.scratch, 'resume.json'); atomicJson(resumeRequest, { root: f.root, issue: f.issue, resumeFile });
    for (const name of ['missing', 'stale', 'future', 'dead', 'reused']) await t.test(`resume-${name}`, () => {
      pulse(f.root); const p = read(path.join(f.root, 'watcher.json'));
      if (name === 'missing') fs.unlinkSync(path.join(f.root, 'watcher.json'));
      else { if (name === 'stale') p.beatAt = new Date(Date.now() - 91_000).toISOString();
        if (name === 'future') p.beatAt = new Date(Date.now() + 60_000).toISOString();
        if (name === 'dead') p.pid = 2147483647; if (name === 'reused') p.procStart = 'reused'; atomicJson(path.join(f.root, 'watcher.json'), p); }
      const before = fs.readFileSync(path.join(f.root, 'workers.json'));
      const r = f.call('orchestrator/resume.mjs', '--request', resumeRequest);
      assert.notEqual(r.status, 0); assert.match(r.stderr, /watcher-required:/);
      assert.deepEqual(fs.readFileSync(path.join(f.root, 'workers.json')), before);
      assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1);
    });
    pulse(f.root); pass(f.call('orchestrator/resume.mjs', '--request', resumeRequest));
    assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1);
  } finally { await f.cleanup(); }
});

test('watch-phase-regress', async () => {
  const f = fixture(); let watcher;
  try {
    pulse(f.root); pass(f.dispatch()); const entry = f.entry();
    const head = pass(f.run('git', ['rev-parse', 'HEAD'], entry.worktree));
    const report = (phase, sequence, publishedAt) => ({ ...entry, phase, sequence, kind: 'phase', head, publishedAt,
      linear_mutations_pending: [], capsule: { phase, head, open_queue: [], decisions: [], writable_roots: entry.workerWritableRoots } });
    const phaseFile = phase => path.join(f.root, 'reports', `${f.issue}-phase-${phase}.json`);
    atomicJson(phaseFile('ship'), report('ship', 2, new Date(Date.now() - 5000).toISOString()));
    let output = ''; watcher = spawn(process.execPath, [path.join(f.pack, 'scripts/watch-workers.mjs'), '--root', f.root, '--interval-sec', '1'], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
    watcher.stdout.on('data', b => { output += b; });
    const until = async predicate => { const end = Date.now() + 15000; while (!predicate() && Date.now() < end) await new Promise(r => setTimeout(r, 25)); assert.ok(predicate(), output); };
    await until(() => output.includes('phase ship sequence 2'));
    atomicJson(phaseFile('code'), report('code', 3, new Date().toISOString()));
    await until(() => output.includes('phase code sequence 3'));
    atomicJson(phaseFile('preflight'), report('preflight', 7, new Date().toISOString()));
    await until(() => output.includes('phase preflight sequence 7'));
    const heartbeat = read(path.join(f.root, 'watcher.json'));
    assert.equal(heartbeat.pid, watcher.pid); assert.equal(heartbeat.procStart, 'fixture-start');
    assert.equal(heartbeat.intervalSec, 1); assert.ok(heartbeat.packVersion); assert.ok(Date.parse(heartbeat.startedAt));
    await until(() => read(path.join(f.root, 'watcher.json')).beatAt !== heartbeat.beatAt);
    assert.equal(output.split('\n').filter(line => line.includes('EVENT:phase ')).length, 3, 'unchanged scans do not repeat phase events');
    const publishedAt = new Date().toISOString();
    atomicJson(phaseFile('code'), report('code', 4, publishedAt));
    atomicJson(phaseFile('preflight'), report('preflight', 8, publishedAt));
    await until(() => output.includes('phase code sequence 4') && output.includes('phase preflight sequence 8'));
  } finally { if (watcher) await stopped(watcher.pid); await f.cleanup(); }
});

test('watch-phase-regress one-shot scan preserves the live observer pulse', async () => {
  const f = fixture(); let watcher;
  try {
    watcher = spawn(process.execPath, [path.join(f.pack, 'scripts/watch-workers.mjs'), '--root', f.root, '--interval-sec', '30'],
      { env: f.env, stdio: 'ignore' });
    const file = path.join(f.root, 'watcher.json'), deadline = Date.now() + 10000;
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    const before = fs.readFileSync(file);
    assert.equal(read(file).pid, watcher.pid);
    pass(f.call('watch-workers.mjs', '--root', f.root, '--once'));
    assert.deepEqual(fs.readFileSync(file), before, 'one-shot observation must preserve the persistent watcher identity and pulse');
  } finally { if (watcher) await stopped(watcher.pid); await f.cleanup(); }
});

test('launch-watcher-required through task-change resume: a refused resume records no task change', async t => {
  for (const name of ['missing', 'stale', 'future', 'dead', 'reused']) await t.test(name, async () => {
    const f = fixture();
    try {
      pulse(f.root); pass(f.dispatch()); const entry = f.entry(); await stopped(entry.pid);
      const file = path.join(f.root, 'watcher.json'), p = read(file);
      if (name === 'missing') fs.unlinkSync(file);
      else {
        if (name === 'stale') p.beatAt = new Date(Date.now() - 91_000).toISOString();
        if (name === 'future') p.beatAt = new Date(Date.now() + 60_000).toISOString();
        if (name === 'dead') p.pid = 2147483647;
        if (name === 'reused') p.procStart = 'another incarnation';
        atomicJson(file, p);
      }
      const url = `https://linear.app/fixture/issue/${f.issue}/x#comment-1`;
      const resumeFile = path.join(f.scratch, 'task-change.md'); put(resumeFile, `Изменение задачи: ${url}\n`);
      const request = path.join(f.scratch, 'task-change.json'); atomicJson(request, { root: f.root, issue: f.issue, resumeFile, taskChange: url });
      const changes = path.join(f.root, 'dispatch', `${f.issue}-a1`, 'task-changes.json');
      const r = f.call('orchestrator/resume.mjs', '--request', request);
      assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /watcher-required:/);
      assert.equal(f.entry().pid, entry.pid); assert.equal(f.entry().last_resume, undefined);
      assert.equal(fs.existsSync(changes), false, 'an undelivered task change is not recorded');
      pulse(f.root); pass(f.call('orchestrator/resume.mjs', '--request', request));
      assert.deepEqual(read(changes).map(change => change.url), [url]);
      assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1, 'restoring the watcher resumes the same attempt');
    } finally { await f.cleanup(); }
  });
});

test('review-retry resume: recorded beside the launch pins, dropped when the launch is refused, exclusive with a task change (MONO-483)', async () => {
  const f = fixture();
  try {
    pulse(f.root); pass(f.dispatch()); const entry = f.entry(); await stopped(entry.pid);
    const attempt = path.join(f.root, 'dispatch', `${f.issue}-a1`), retries = path.join(attempt, 'review-retries.json');
    const resumeFile = path.join(f.scratch, 'review-retry.md'); put(resumeFile, 'The network is back; request the same head again.\n');
    const request = path.join(f.scratch, 'review-retry.json'), resume = body => { atomicJson(request, body); return f.call('orchestrator/resume.mjs', '--request', request); };
    const url = `https://linear.app/fixture/issue/${f.issue}/x#comment-1`;
    let r = resume({ root: f.root, issue: f.issue, resumeFile, reviewRetry: true, taskChange: url });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /reviewRetry and taskChange are exclusive/);
    r = resume({ root: f.root, issue: f.issue, resumeFile, reviewRetry: 'yes' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /reviewRetry must be true/);
    // A refused launch (here: no live watcher) delivers nothing and records no retry.
    fs.unlinkSync(path.join(f.root, 'watcher.json'));
    r = resume({ root: f.root, issue: f.issue, resumeFile, reviewRetry: true });
    assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /watcher-required:/);
    assert.equal(fs.existsSync(retries), false, 'an undelivered retry is not recorded');
    // A spawn that fails after the retry was recorded drops exactly that retry.
    pulse(f.root);
    const launch = path.join(f.pack, 'scripts/orchestrator/launch.mjs'), source = fs.readFileSync(launch, 'utf8'), spawnLine = 'child = spawn(command, args, options);';
    assert.ok(source.includes(spawnLine));
    put(launch, source.replace(spawnLine, `throw new Error('fixture spawn refused'); ${spawnLine}`));
    r = resume({ root: f.root, issue: f.issue, resumeFile, reviewRetry: true });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /fixture spawn refused/);
    assert.deepEqual(read(retries), [], 'a refused spawn drops the retry it recorded');
    put(launch, source);
    pass(resume({ root: f.root, issue: f.issue, resumeFile, reviewRetry: true }));
    assert.deepEqual(read(retries).map(retry => retry.number), [1]);
    assert.ok(!f.entry().workerWritableRoots.some(root => attempt === root || attempt.startsWith(root + path.sep)), 'the retry file is outside every worker grant');
    assert.equal(fs.existsSync(path.join(attempt, 'task-changes.json')), false, 'a review retry is not a task change');
    assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1, 'the same attempt resumes');
  } finally { await f.cleanup(); }
});

// MONO-512: there is no extra round; resume refuses extraRound like any other unknown field. A resume that writes a
// control file still waits for this attempt's round in flight and for every host verification run of the root.
test('resume without an extra round: extraRound refused, control-file writes wait for rounds and host runs (MONO-512)', async () => {
  const f = fixture();
  try {
    pulse(f.root); pass(f.dispatch()); const entry = f.entry(); await stopped(entry.pid);
    const attempt = path.join(f.root, 'dispatch', `${f.issue}-a1`), pinsFile = path.join(attempt, 'pins.json'), pins = read(pinsFile);
    const resumeFile = path.join(f.scratch, 'resume.md'); put(resumeFile, 'Fix the last finding and request the next round.\n');
    const request = path.join(f.scratch, 'resume.json'), resume = body => { atomicJson(request, body); return f.call('orchestrator/resume.mjs', '--request', request); };
    const registryBefore = () => fs.readFileSync(path.join(f.root, 'workers.json'), 'utf8');
    const refused = (body, line) => {
      const before = registryBefore(), r = resume({ root: f.root, issue: f.issue, resumeFile, ...body });
      assert.notEqual(r.status, 0); assert.match(r.stderr, line);
      assert.equal(registryBefore(), before, 'a refusal leaves the registry as it was');
      for (const file of ['task-changes.json', 'review-retries.json', 'extra-round.json']) assert.equal(fs.existsSync(path.join(attempt, file)), false, `a refusal writes no ${file}`);
    };
    const url = `https://linear.app/fixture/issue/${f.issue}/x#comment-1`;
    refused({ extraRound: { reason: 'one more round' } }, /resume takes only root, issue, resumeFile, taskChange and reviewRetry; extraRound/);
    const { admitRound, recordResult, hostRunMarker, evidenceSnapshot } = await import('./review-rounds.mjs');
    const tip = 'c'.repeat(40), admission = admitRound(f.root, f.issue, 1, { root: f.root, head: tip, collect: false, collectionId: `preflight-collect:${tip}:1` });
    refused({ reviewRetry: true }, /review round preflight-collect:c+:1 has no result yet/);
    recordResult(f.root, f.issue, 1, admission, { status: 'done' });
    const marker = hostRunMarker(pins.evidenceRoot, `preflight-collect:${tip}:2`);
    put(marker, JSON.stringify({ collectionId: `preflight-collect:${tip}:2`, group: null, snapshot: evidenceSnapshot(pins.evidenceRoot, pinsFile) }));
    refused({ taskChange: url }, /host verification .* is running or unrecovered/);
    refused({ reviewRetry: true }, /host verification .* is running or unrecovered/);
    fs.rmSync(marker);
  } finally { await f.cleanup(); }
});

test('dispatch creates only active launch pins', async () => {
  const f = fixture();
  try {
    pulse(f.root); const launched = JSON.parse(pass(f.dispatch()));
    const pins = read(launched.pins.file);
    assert.equal(pins.worktree, path.join(f.repo, '.worktrees', f.issue));
    assert.equal(fs.existsSync(path.join(f.evidence, 'datasets')), false);
  } finally { await f.cleanup(); }
});

test('launch-watcher-required after launch preparation and before resume', async t => {
  for (const mode of ['spawn', 'resume']) await t.test(mode, async () => {
    const f = fixture();
    try {
      pulse(f.root);
      if (mode !== 'spawn') { pass(f.dispatch()); await stopped(f.entry().pid); }
      const launch = path.join(f.pack, 'scripts/orchestrator/launch.mjs'), source = fs.readFileSync(launch, 'utf8');
      const anchor = mode === 'spawn' ? 'const gates = request.gates ?? [];' : 'const updated = { ...entry, ...(linearPath';
      assert.ok(source.includes(anchor));
      put(launch, source.replace(anchor, `fs.unlinkSync(path.join(request.root, 'watcher.json')); ${anchor}`));
      const resumeFile = path.join(f.scratch, 'race-resume.md'); put(resumeFile, 'Continue.');
      const request = path.join(f.scratch, 'race-resume.json'); atomicJson(request, { root: f.root, issue: f.issue, resumeFile });
      const run = () => mode === 'spawn' ? f.dispatch() : f.call('orchestrator/resume.mjs', '--request', request);
      const refused = run(); assert.notEqual(refused.status, 0); assert.match(refused.stdout + refused.stderr, /watcher-required:/);
      if (mode === 'spawn') {
        assert.deepEqual(read(path.join(f.root, 'workers.json')), {});
        assert.equal(fs.existsSync(path.join(f.root, 'attempts.json')), false);
      } else {
        assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1);
        assert.equal(f.entry().last_resume, undefined);
      }
      put(launch, source); pulse(f.root); pass(run());
      assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1);
    } finally { await f.cleanup(); }
  });
});

test('AC4 dispatch preserves existing evidence archives', async () => {
  const f = fixture();
  try {
    const archive = path.join(f.evidence, 'datasets', `${f.issue}-scope.v9.md`);
    put(archive, '# Historical scope\n');
    const bytes = fs.readFileSync(archive), hash = createHash('sha256').update(bytes).digest('hex');
    put(archive + '.sha256', hash + '\n');
    pulse(f.root); pass(f.dispatch());
    assert.deepEqual(fs.readFileSync(archive), bytes); assert.equal(fs.readFileSync(archive + '.sha256', 'utf8').trim(), hash);
  } finally { await f.cleanup(); }
});
