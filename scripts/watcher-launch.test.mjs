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
import { versionDataset, recordDecision, readJournal, acceptedDeclines } from './decisions.mjs';
import { archiveReviewDataset } from './gate.mjs';
import { declineFixture, seal, sha } from './decline-fixtures.mjs';

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
  policy.orchestration.transport = 'codex-cli'; delete policy.orchestration.backupTransport;
  policy.ideaGate = { since: '2026-10-17' };
  policy.orchestration.delivery.attemptCap = 10;
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

test('launch-watcher-required through amendment resume', async t => {
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
      const r = f.call('orchestrator/accept.mjs', 'amend', '--root', f.root, '--issue', f.issue, '--attempt', '1', '--text', 'Resume the approved scope.');
      assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /watcher-required:/);
      assert.equal(f.entry().pid, entry.pid); assert.equal(f.entry().last_resume, undefined);
      assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1);
      const pending = path.join(f.root, 'dispatch', `${f.issue}-a1`, 'amendment.pending.json');
      assert.equal(read(pending).launchMayHaveStartedAt, undefined, 'observer refusal happens before possible-launch bookkeeping');
      pulse(f.root);
      const retried = f.call('orchestrator/accept.mjs', 'amend', '--root', f.root, '--issue', f.issue, '--attempt', '1', '--text', 'Resume the approved scope.');
      pass(retried);
      assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1, 'restoring the watcher resumes the same attempt');
    } finally { await f.cleanup(); }
  });
});

test('dispatch-default-dataset', async () => {
  const f = fixture();
  try {
    pulse(f.root); const launched = JSON.parse(pass(f.dispatch()));
    const pins = read(launched.pins.file), archive = pins.reviewDataset;
    assert.equal(pins.reviewDatasetVersion, 1); assert.equal(fs.existsSync(f.evidence), true);
    const bytes = fs.readFileSync(archive), digest = fs.readFileSync(archive + '.sha256');
    assert.equal(digest.toString().trim(), pins.reviewDatasetDigest);
    // The gate archives the dispatch pin as v1; a receipt on that first dataset
    // can use the existing decision-linked decline path without relaxing it.
    const binding = await archiveReviewDataset(archive, f.evidence);
    assert.equal(binding.version, 1); assert.equal(binding.digest, pins.reviewDatasetDigest);
    const decline = declineFixture({ basis: 'boundary' }), receipt = { ...decline.receipt, reviewDataset: binding };
    await recordDecision({ evidenceRoot: f.evidence, issue: f.issue, entry: decline.boundary });
    const { recordDigest, ...entry } = decline.entry;
    const receiptDigest = sha(receipt), findingDigest = sha(receipt.review.json.findings[0]);
    const linked = seal({ ...entry, receipt: { ...entry.receipt, digest: receiptDigest }, datasetVersion: pins.reviewDatasetVersion,
      finding: { id: `${receiptDigest}:0:${findingDigest}`, index: 0, digest: findingDigest } });
    await recordDecision({ evidenceRoot: f.evidence, issue: f.issue, entry: linked });
    assert.equal(acceptedDeclines(receipt, readJournal({ evidenceRoot: f.evidence, issue: f.issue }))[0].decisionId, linked.id);
    // Clear only the fixture's journal so the default source remains byte-identical.
    fs.unlinkSync(path.join(f.evidence, 'decisions', `${f.issue}.json`));
    const stat = fs.statSync(archive); await f.retire();
    pulse(f.root); pass(f.dispatch()); assert.deepEqual(fs.readFileSync(archive), bytes); assert.equal(fs.statSync(archive).mtimeMs, stat.mtimeMs);
    await f.retire();
    // A changed default source must select existing history without rewriting it.
    const issueFile = path.join(f.scratch, 'snapshot', `issue-${f.issue}.md`);
    put(issueFile, fs.readFileSync(issueFile, 'utf8').replace('Watcher fixture', 'Changed title'));
    pulse(f.root); const third = JSON.parse(pass(f.dispatch()));
    assert.equal(read(third.pins.file).reviewDataset, archive); assert.deepEqual(fs.readFileSync(archive + '.sha256'), digest);
    await f.retire();
    const source = path.join(f.scratch, 'new-scope.md'); put(source, '# Expanded review scope\n');
    const latest = await versionDataset({ evidenceRoot: f.evidence, issue: f.issue, source });
    assert.equal(latest.version, 2);
    const latestBytes = fs.readFileSync(latest.archive), latestDigest = fs.readFileSync(latest.archive + '.sha256');
    pulse(f.root); const newer = JSON.parse(pass(f.dispatch()));
    assert.equal(read(newer.pins.file).reviewDataset, latest.archive); assert.equal(read(newer.pins.file).reviewDatasetVersion, 2);
    assert.deepEqual(fs.readFileSync(archive), bytes); assert.deepEqual(fs.readFileSync(latest.archive), latestBytes);
    assert.deepEqual(fs.readFileSync(latest.archive + '.sha256'), latestDigest);
    await f.retire();
    const explicit = path.join(f.evidence, 'explicit.md'); put(explicit, '# Explicit source\n');
    pulse(f.root); const fourth = JSON.parse(pass(f.dispatch('--review-dataset', explicit, '--review-dataset-version', '9')));
    assert.equal(read(fourth.pins.file).reviewDataset, explicit); assert.equal(read(fourth.pins.file).reviewDatasetVersion, 9);
    assert.equal(fs.readFileSync(explicit, 'utf8'), '# Explicit source\n');
  } finally { await f.cleanup(); }
});

test('launch-watcher-required after launch preparation and before amendment resume', async t => {
  for (const mode of ['spawn', 'resume', 'amend']) await t.test(mode, async () => {
    const f = fixture();
    try {
      pulse(f.root);
      if (mode !== 'spawn') { pass(f.dispatch()); await stopped(f.entry().pid); }
      const launch = path.join(f.pack, 'scripts/orchestrator/launch.mjs'), source = fs.readFileSync(launch, 'utf8');
      const resume = path.join(f.pack, 'scripts/orchestrator/resume.mjs'), resumeSource = fs.readFileSync(resume, 'utf8');
      const anchor = mode === 'spawn' ? 'const gates = request.gates ?? [];' : 'const updated = { ...entry, capsule:';
      if (mode === 'amend') {
        const prefix = `import fs from 'node:fs';\nconst input=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--request')+1]));fs.unlinkSync(input.root+'/watcher.json');\n`;
        put(resume, prefix + resumeSource.replace(/^#![^\n]*\n/u, ''));
      } else {
        assert.ok(source.includes(anchor));
        put(launch, source.replace(anchor, `fs.unlinkSync(path.join(request.root, 'watcher.json')); ${anchor}`));
      }
      const resumeFile = path.join(f.scratch, 'race-resume.md'); put(resumeFile, 'Continue.');
      const request = path.join(f.scratch, 'race-resume.json'); atomicJson(request, { root: f.root, issue: f.issue, resumeFile });
      const run = () => mode === 'spawn' ? f.dispatch() : mode === 'resume' ? f.call('orchestrator/resume.mjs', '--request', request) :
        f.call('orchestrator/accept.mjs', 'amend', '--root', f.root, '--issue', f.issue, '--attempt', '1', '--text', 'Retry watcher race.');
      const refused = run(); assert.notEqual(refused.status, 0); assert.match(refused.stdout + refused.stderr, /watcher-required:/);
      if (mode === 'spawn') {
        assert.deepEqual(read(path.join(f.root, 'workers.json')), {});
        assert.equal(fs.existsSync(path.join(f.root, 'attempts.json')), false);
      } else {
        assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1);
        assert.equal(f.entry().last_resume, undefined);
      }
      if (mode === 'amend') {
        const pending = path.join(f.root, 'dispatch', `${f.issue}-a1`, 'amendment.pending.json');
        assert.equal(read(pending).launchMayHaveStartedAt, undefined);
        put(resume, resumeSource);
      }
      put(launch, source); pulse(f.root); pass(run());
      assert.equal(read(path.join(f.root, 'attempts.json'))[f.issue], 1);
    } finally { await f.cleanup(); }
  });
});

test('dispatch-default-dataset with sparse immutable history', async () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.evidence); const source = path.join(f.evidence, `${f.issue}-review-scope.v9.md`);
    put(source, '# Explicit historical scope\n');
    const prior = await archiveReviewDataset(source, f.evidence);
    const bytes = fs.readFileSync(prior.archive), digest = fs.readFileSync(prior.archive + '.sha256');
    pulse(f.root); const result = JSON.parse(pass(f.dispatch())), pins = read(result.pins.file);
    assert.equal(pins.reviewDataset, prior.archive); assert.equal(pins.reviewDatasetVersion, 9);
    assert.equal(pins.reviewDatasetDigest, prior.digest);
    assert.equal(fs.existsSync(path.join(f.evidence, 'datasets', `${f.issue}-review-scope.v1.md`)), false);
    assert.deepEqual(fs.readFileSync(prior.archive), bytes); assert.deepEqual(fs.readFileSync(prior.archive + '.sha256'), digest);
  } finally { await f.cleanup(); }
});
