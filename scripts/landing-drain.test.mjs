import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { test } from "node:test";
import { atomicJson, digest, processStart, withLock } from "./runtime.mjs";
import * as state from "./orchestrator/command-state.mjs";
import { checkSpawnAvailability, resumeWorker } from "./orchestrator/launch.mjs";
import { updateBlockers } from './verify-pack-state.mjs';

const script = path.resolve("scripts/orchestrator/landing-drain.mjs");
test('plugin update checks all products, including paused attempts, without changing registries', t => {
  const f = fixture(t), folder = path.join(f.scratch, 'plugin');
  fs.mkdirSync(folder); f.entry.packRoot = folder;
  atomicJson(f.pending, [f.record]); f.registry();
  const foreign = path.join(f.scratch, 'other-product'); fs.mkdirSync(foreign);
  const active = { ...f.entry, issue: 'MONO-902', pid: process.pid, pins: undefined, procStart: null };
  const paused = { ...active, issue: 'MONO-903', pid: null, packRoot: path.join(folder, 'older') };
  const unrelated = { ...active, issue: 'MONO-904', packRoot: path.join(f.scratch, 'elsewhere') };
  atomicJson(path.join(foreign, 'workers.json'), { active, paused, unrelated });
  const files = [path.join(f.root, 'workers.json'), path.join(foreign, 'workers.json')];
  const before = files.map(file => fs.readFileSync(file));
  const result = spawnSync(process.execPath, [path.resolve('scripts/verify-pack-state.mjs'), 'before-update', '--folder', folder, '--products-root', f.scratch], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /other-product\/MONO-902/); assert.match(result.stderr, /other-product\/MONO-903/);
  assert.doesNotMatch(result.stderr, /MONO-901|MONO-904/);
  files.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index]));
});
function fixture(t, commandScript = script) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-drain-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, "root"), repo = path.join(scratch, "repo"), bin = path.join(scratch, "bin");
  for (const dir of [root, repo, bin]) fs.mkdirSync(dir);
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, DRAIN_MOCK: path.join(scratch, "github.json"),
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  // macOS worker sandbox denies ps. Substitute that OS boundary while real
  // process.kill, file locks, Git repositories and report confirmation run.
  fs.writeFileSync(path.join(bin, "ps"), '#!/usr/bin/env node\nconsole.log(process.argv.includes("-axo") ? `${process.ppid} 1 ${process.ppid} S fixture start` : "fixture start");\n');
  fs.chmodSync(path.join(bin, "ps"), 0o755);
  const git = (...args) => { const r = spawnSync("git", args, { cwd: repo, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git("init", "-b", "main"); git("remote", "add", "origin", "https://github.com/owner/repo.git");
  fs.writeFileSync(path.join(repo, "first"), "first"); git("add", "."); git("commit", "-m", "merged"); const mergeSha = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(repo, "second"), "second"); git("add", "."); git("commit", "-m", "tip"); const tip = git("rev-parse", "HEAD");
  const head = "a".repeat(40), issue = "MONO-901", config = path.join(repo, "config.json");
  atomicJson(config, { landing: { install: "wave-drain", validation: { check: "validate", timeoutSec: 1800 } } });
  const pinsFile = path.join(root, `dispatch/${issue}-a1/pins.json`);
  atomicJson(pinsFile, { baseRef: "origin/main", worktree: repo, release: true });
  const entry = { issue, attempt: 1, stage: "mono-deliver", worktree: repo, pid: 99999999, procStart: "old process", thread_id: "thread",
    packVersion: "fixture", sourceCommit: mergeSha, surfaceRevision: 4, spawned_at: "2020-01-01T00:00:00Z",
    pins: { file: pinsFile, digest: state.sha256File(pinsFile) }, pinsVersion: 0 };
  const reportFile = path.join(root, `reports/${issue}-phase-ship.json`);
  const report = { ...entry, phase: "ship", sequence: 1, kind: "phase", head, status: "green", publishedAt: new Date().toISOString(),
    certificate: `mono-ship green certificate\nShip: green\nIssue(s): ${issue}\nPR: https://github.com/owner/repo/pull/901\nHead SHA: ${head}\n`,
    linear_mutations_pending: [], capsule: { phase: "ship", head, decisions: [], open_queue: [], writable_roots: [repo] } };
  const confirmFile = path.join(root, `confirmations/${issue}-phase-ship-a1-s1.confirmed.json`);
  const publish = () => { atomicJson(reportFile, report); atomicJson(confirmFile, { report, issue, attempt: 1, phase: "ship", sequence: 1, status: "confirmed", reportDigest: digest(report), results: [] }); };
  const workers = { [issue]: entry }, registry = () => atomicJson(path.join(root, "workers.json"), workers);
  registry(); publish(); atomicJson(path.join(root, "control.json"), { state: "active", halt: false });
  const record = { repo: "owner/repo", issue, attempt: 1, pr: 901, head, mergeSha, mergedAt: "2026-10-01T00:00:00Z", guard: { code: 0, outcome: "pass" } };
  const pending = path.join(root, "landing/pending-install.json");
  const mock = { pr: { number: 901, merged: true, state: "closed", merged_at: record.mergedAt, merge_commit_sha: mergeSha, head: { sha: head }, base: { ref: "main", repo: { full_name: "owner/repo" } } }, tip, conclusion: "success" };
  const github = () => atomicJson(env.DRAIN_MOCK, mock); github();
  fs.writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node
const fs = require('node:fs'), m = JSON.parse(fs.readFileSync(process.env.DRAIN_MOCK)), e = process.argv[3];
if (e.startsWith('repos/owner/repo/pulls/')) console.log(JSON.stringify(m.prs?.[e.split('/')[4]] ?? m.pr));
else if (e === 'repos/owner/repo/branches/main') console.log(JSON.stringify({name:'main',commit:{sha:m.tip}}));
else if (e.startsWith('repos/owner/repo/commits/') && e.endsWith('/check-runs?filter=all&per_page=100&page=1')) console.log(JSON.stringify({total_count:1,check_runs:[{id:1,name:'validate',head_sha:e.split('/')[4],status:'completed',conclusion:m.conclusion,completed_at:'2026-10-01T00:00:00Z'}]}));
else { console.error('unexpected GitHub endpoint: '+e); process.exit(71); }
`); fs.chmodSync(path.join(bin, "gh"), 0o755);
  const args = (command, more = []) => [commandScript, command, "--root", root, "--config", config, "--json", ...more];
  const run = (command, more = []) => spawnSync(process.execPath, args(command, more), { cwd: repo, env, encoding: "utf8" });
  return { scratch, root, repo, env, git, tip, mergeSha, head, issue, entry, workers, registry, report, reportFile, confirmFile, publish, record, pending, mock, github, run, args, config };
}

function prFieldFixture(t, value) {
  const f = fixture(t);
  f.report.certificate = f.report.certificate.replace("PR: https://github.com/owner/repo/pull/901", `PR: ${value}`);
  f.record.pr = f.mock.pr.number = 121;
  f.publish(); f.github();
  return f;
}

function assertRecordRefused(f, args, reason, pr = "121") {
  atomicJson(f.pending, [{ ...f.record, issue: "MONO-900", pr: 900 }]);
  const ledger = path.join(f.root, "ledger.md"); fs.writeFileSync(ledger, "existing ledger\n");
  const before = [fs.readFileSync(f.pending), fs.readFileSync(ledger)];
  const r = f.run("record", ["--issue", f.issue, "--attempt", "1", "--pr", pr, ...args]);
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, reason);
  assert.deepEqual(fs.readFileSync(f.pending), before[0], "refusal preserves pending records byte for byte");
  assert.deepEqual(fs.readFileSync(ledger), before[1], "refusal preserves the ledger byte for byte");
  assert.doesNotMatch(fs.readFileSync(ledger, "utf8"), / LANDED /);
}

const acceptedPrFields = [
  ["bare-number", "121"],
  ["hash-number", "#121"],
  ["URL", "https://github.com/owner/repo/pull/121"],
  ["number-and-URL", "121 https://github.com/owner/repo/pull/121"],
  ["slash-separated", "121 / https://github.com/owner/repo/pull/121"],
  ["Markdown-link", "[#121](https://github.com/owner/repo/pull/121)"],
  ["comma-separated", "121, https://github.com/owner/repo/pull/121"]
];
for (const [name, value] of acceptedPrFields) {
  test(`landing MONO-116 ${name} certificate records one PR`, t => {
    const f = prFieldFixture(t, value);
    const r = f.run("record", ["--issue", f.issue, "--attempt", "1", "--pr", "121"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [record] = JSON.parse(fs.readFileSync(f.pending));
    assert.equal(record.repo, "owner/repo"); assert.equal(record.pr, 121); assert.equal(record.head, f.head);
    assert.equal(fs.readFileSync(path.join(f.root, "ledger.md"), "utf8").split(" LANDED ").length, 2);
    assert.equal(f.run("status").status, 0, "accepted certificate also classifies a stopped attempt as landed");
  });
  for (const scenario of ["different-pr-same-head", "wrong-head", "another-attempt", "foreign-repo", "wrong-branch"]) {
    test(`landing MONO-116 ${name} certificate rejects ${scenario} without writes`, t => {
      const f = prFieldFixture(t, value); let pr = "121";
      if (scenario === "different-pr-same-head") {
        pr = "122"; f.mock.prs = { 122: { ...f.mock.pr, number: 122 } };
      }
      if (scenario === "wrong-head") f.mock.pr.head.sha = "b".repeat(40);
      if (scenario === "another-attempt") f.report.attempt = 2;
      if (scenario === "foreign-repo") f.mock.pr.base.repo.full_name = "other/repo";
      if (scenario === "wrong-branch") f.mock.pr.base.ref = "other";
      f.publish(); f.github();
      assertRecordRefused(f, [], scenario === "different-pr-same-head" ? /PR does not match confirmed ship certificate/ : /mismatch|registry-correlated/, pr);
    });
  }
}

for (const [name, value, reason] of [
  ["number-URL-disagreement", "121 https://github.com/owner/repo/pull/122", /PR numbers mismatch/],
  ["different-URL-repositories", "https://github.com/owner/repo/pull/121 https://github.com/other/repo/pull/121", /URL repositories mismatch/],
  ["foreign-URL-repository", "https://github.com/other/repo/pull/121", /repository mismatch/],
  ["unrelated-text", "121 https://github.com/owner/repo/pull/121 extra", /PR must contain only/],
  ["empty", "", /PR requires/],
  ["different-bare-numbers", "121 / #122", /PR numbers mismatch/],
  ["different-URL-numbers", "https://github.com/owner/repo/pull/121 https://github.com/owner/repo/pull/122", /PR numbers mismatch/],
  ["missing-component-separator", "121#121", /PR must contain only/],
  ["unsafe-number", "9007199254740992", /invalid.*PR number/],
  ["separators-only", " / , []() ", /PR requires/]
]) {
  test(`landing MONO-116 rejects ${name} PR field without writes`, t => {
    const f = prFieldFixture(t, value); assertRecordRefused(f, [], reason);
  });
}

test("landing U7 attempt state: conservative order and stopped landed identity", t => {
  const f = fixture(t);
  const priorPath = process.env.PATH; process.env.PATH = f.env.PATH; t.after(() => { process.env.PATH = priorPath; });
  assert.equal(typeof state.attemptState, "function", "shared attempt classification is required");
  const classify = () => state.attemptState(f.root, f.entry);
  assert.equal(classify().state, "active", "stopped without landing is active");
  atomicJson(f.pending, [f.record]); assert.equal(classify().state, "landed");
  f.entry.pid = process.pid; f.entry.procStart = processStart(process.pid); assert.equal(classify().state, "active", "live pid wins over landing");
  f.entry.procStart = "different start"; assert.equal(classify().state, "landed", "reused pid is stopped");
  f.entry.pid = null; assert.equal(classify().state, "active", "unfinished start is active");
  f.entry.pid = 99999999;
  f.report.attempt = 2; f.publish(); assert.equal(classify().state, "active", "foreign report is active");
  fs.writeFileSync(f.reportFile, "unreadable JSON"); assert.equal(classify().state, "active");
  f.report.attempt = 1; f.publish(); fs.unlinkSync(f.confirmFile); assert.equal(classify().state, "active", "unconfirmed certificate is active");
  f.publish(); const mergeSha = f.record.mergeSha; f.record.mergeSha = "invalid"; atomicJson(f.pending, [f.record]);
  assert.equal(classify().state, "active", "malformed landing is uncertain"); f.record.mergeSha = mergeSha;
  f.publish(); f.record.attempt = 2; atomicJson(f.pending, [f.record]); assert.equal(classify().state, "active", "another attempt's landing cannot release this one");
  f.record.attempt = 1; atomicJson(f.pending, [f.record]); f.entry.pins = null; assert.equal(classify().state, "active", "missing pins is active");
});

test("landing U7 release slot is released only by stopped landed attempts", t => {
  const f = fixture(t), file = path.join(f.root, "next-pins.json"); atomicJson(file, { release: true });
  const request = { root: f.root, issue: "MONO-902", pins: { file, digest: state.sha256File(file) }, config: {} };
  assert.throws(() => checkSpawnAvailability(request), /release.*MONO-901/);
  atomicJson(f.pending, [f.record]);
  assert.doesNotThrow(() => checkSpawnAvailability(request));
  f.entry.pid = process.pid; f.entry.procStart = processStart(process.pid); f.registry(); assert.throws(() => checkSpawnAvailability(request), /release.*MONO-901/);
});

test("landing U7 record authenticates merged PR and preserves first guard outcome", t => {
  const f = fixture(t), args = ["--issue", f.issue, "--attempt", "1", "--pr", "901"];
  f.mock.conclusion = "failure"; f.github();
  let r = f.run("record", args); assert.equal(r.status, 0, r.stdout + r.stderr);
  const records = JSON.parse(fs.readFileSync(f.pending)); assert.equal(records.length, 1); assert.equal(records[0].guard.code, 1);
  f.mock.conclusion = "success"; f.github(); r = f.run("record", args); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.pending)), records, "identical record is immutable");
  assert.equal(fs.readFileSync(path.join(f.root, "ledger.md"), "utf8").split(" LANDED ").length, 2);
  f.mock.pr.merge_commit_sha = f.tip; f.github(); r = f.run("record", args); assert.equal(r.status, 1); assert.match(r.stderr, /conflict/);
});

for (const scenario of ["foreign-repo", "different-pr-same-head", "wrong-branch", "wrong-head", "not-merged", "unconfirmed", "foreign-certificate"]) {
  test(`landing U7 record rejects ${scenario}`, t => {
    const f = fixture(t); let pr = "901";
    if (scenario === "foreign-repo") f.mock.pr.base.repo.full_name = "other/repo";
    if (scenario === "different-pr-same-head") pr = "902";
    if (scenario === "wrong-branch") f.mock.pr.base.ref = "other";
    if (scenario === "wrong-head") f.mock.pr.head.sha = "b".repeat(40);
    if (scenario === "not-merged") f.mock.pr.merged = false;
    if (scenario === "unconfirmed") fs.unlinkSync(f.confirmFile);
    if (scenario === "foreign-certificate") { f.report.certificate = f.report.certificate.replace(f.issue, "MONO-902"); f.publish(); }
    f.github(); const r = f.run("record", ["--issue", f.issue, "--attempt", "1", "--pr", pr]);
    assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /mismatch|certificate|ENOENT/); assert.equal(fs.existsSync(f.pending), false);
  });
}

test("landing U7 numeric certificate records the right PR in the request repository", t => {
  const f = fixture(t);
  f.report.certificate = f.report.certificate.replace("https://github.com/owner/repo/pull/901", "901"); f.publish();
  const r = f.run("record", ["--issue", f.issue, "--attempt", "1", "--pr", "901"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [record] = JSON.parse(fs.readFileSync(f.pending)), { guard, ...identity } = record;
  const { guard: expectedGuard, ...expectedIdentity } = f.record;
  assert.deepEqual(identity, expectedIdentity); assert.equal(guard.code, expectedGuard.code);
  assert.equal(f.run("status").status, 0, "numeric certificate also classifies the stopped attempt as landed");
  atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
  const verified = f.run("verify", ["--install-sha", f.tip]); assert.equal(verified.status, 0, verified.stdout + verified.stderr);
});

for (const scenario of ["different-pr-same-head", "wrong-head", "another-attempt", "wrong-branch", "foreign-repo"]) {
  test(`landing U7 numeric certificate rejects ${scenario}`, t => {
    const f = fixture(t); let pr = "901";
    f.report.certificate = f.report.certificate.replace("https://github.com/owner/repo/pull/901", "901");
    if (scenario === "different-pr-same-head") pr = "902";
    if (scenario === "wrong-head") f.mock.pr.head.sha = "b".repeat(40);
    if (scenario === "another-attempt") f.report.attempt = 2;
    if (scenario === "wrong-branch") f.mock.pr.base.ref = "other";
    if (scenario === "foreign-repo") f.mock.pr.base.repo.full_name = "other/repo";
    f.publish(); f.github();
    const r = f.run("record", ["--issue", f.issue, "--attempt", "1", "--pr", pr]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /mismatch|certificate|registry-correlated/); assert.equal(fs.existsSync(f.pending), false);
  });
}

test("landing U7 URL certificate must name the explicit record repository", t => {
  const f = fixture(t);
  const r = f.run("record", ["--repo", "other/repo", "--issue", f.issue, "--attempt", "1", "--pr", "901"]);
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /repository.*mismatch/);
  assert.equal(fs.existsSync(f.pending), false);
});

test("landing U7 numeric certificate binds to an explicit repository with a fork origin", t => {
  const f = fixture(t); f.git("remote", "set-url", "origin", "git@github.com:fork/repo.git");
  f.report.certificate = f.report.certificate.replace("https://github.com/owner/repo/pull/901", "901"); f.publish();
  const r = f.run("record", ["--repo", "owner/repo", "--issue", f.issue, "--attempt", "1", "--pr", "901"]);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(JSON.parse(fs.readFileSync(f.pending))[0].repo, "owner/repo");
});

test("landing U7 status lists every active attempt and excludes stopped landed", t => {
  const f = fixture(t); atomicJson(f.pending, [f.record]);
  let r = f.run("status"); assert.equal(r.status, 0, r.stdout + r.stderr);
  f.entry.pid = process.pid; f.entry.procStart = "fixture start"; f.registry();
  f.workers["MONO-902"] = { ...f.entry, issue: "MONO-902", pid: null }; f.registry();
  r = f.run("status"); assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).blockers.map(row => row.issue), ["MONO-901", "MONO-902"]);
  assert.ok(JSON.parse(r.stdout).blockers.every(row => row.reason));
});

for (const scenario of ["no-halt", "active", "red-tip", "non-ancestor", "checkout-mismatch", "github-tip-mismatch"]) {
  test(`landing U7 verify rejects ${scenario} without moving records`, t => {
    const f = fixture(t); atomicJson(f.pending, [f.record]);
    atomicJson(path.join(f.root, "control.json"), { state: "active", halt: scenario !== "no-halt" });
    if (scenario === "active") { f.entry.pid = null; f.registry(); }
    if (scenario === "red-tip") { f.mock.conclusion = "failure"; f.github(); }
    if (scenario === "non-ancestor") {
      f.git("checkout", "--orphan", "other"); f.git("rm", "-rf", "."); fs.writeFileSync(path.join(f.repo, "other"), "other"); f.git("add", "other"); f.git("commit", "-m", "other root");
      f.mock.tip = f.git("rev-parse", "HEAD"); f.github();
    }
    if (scenario === "checkout-mismatch") f.git("checkout", "--detach", f.mergeSha);
    const installSha = scenario === "github-tip-mismatch" ? f.mergeSha : f.mock.tip;
    const r = f.run("verify", ["--install-sha", installSha]);
    assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /halt|active|check|ancestor|checkout|GitHub/);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.pending)), [f.record]);
    assert.equal(fs.existsSync(path.join(f.root, `landing/batch-${installSha}.json`)), false);
  });
}

test("landing U7 verify freezes per-task proof; failed install and close interruption recover", t => {
  const f = fixture(t); atomicJson(f.pending, [f.record]); atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
  let r = f.run("verify", ["--install-sha", f.tip]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).proofs, [{ issue: f.issue, attempt: 1, pr: 901, mergeSha: f.mergeSha, installSha: f.tip }]);
  const batchFile = path.join(f.root, `landing/batch-${f.tip}.json`), original = fs.readFileSync(batchFile, "utf8");
  r = f.run("verify", ["--install-sha", f.tip]); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(fs.readFileSync(batchFile, "utf8"), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.pending)), [f.record], "installation is outside this script; failure retains records");
  atomicJson(path.join(f.root, "control.json"), { state: "active", halt: false });
  assert.doesNotThrow(() => checkSpawnAvailability({ root: f.root, issue: "MONO-902", config: {} }), "fix-forward can launch after unhalt");
  fs.writeFileSync(path.join(f.repo, "repair"), "repair"); f.git("add", "repair"); f.git("commit", "-m", "repair"); f.mock.tip = f.git("rev-parse", "HEAD"); f.github();
  atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
  r = f.run("verify", ["--install-sha", f.mock.tip]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).proofs[0].mergeSha, f.mergeSha, "new T includes earlier failed installation");
  // Simulate loss after installed archive is durable but before pending removal.
  const batch = JSON.parse(fs.readFileSync(path.join(f.root, `landing/batch-${f.mock.tip}.json`)));
  const installed = path.join(f.root, `landing/installed/${f.mock.tip}.json`);
  atomicJson(installed, { ...batch, evidence: "installed roots checked" });
  r = f.run("close", ["--install-sha", f.mock.tip, "--evidence", "installed roots checked"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.pending)), []);
  r = f.run("close", ["--install-sha", f.mock.tip, "--evidence", "installed roots checked"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(f.root, "ledger.md"), "utf8").split(" DRAIN-CLOSE ").length, 2);
  r = f.run("record", ["--issue", f.issue, "--attempt", "1", "--pr", "901"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.pending)), [], "already installed replay is never requeued");
});

for (const transition of ["spawn", "resume"]) test(`landing U7 verify waits for ${transition} pid publication under launch.lock`, async t => {
  const f = fixture(t); f.entry.pid = null; f.registry(); atomicJson(f.pending, [f.record]);
  let child, completed = false, stdout = "", stderr = "";
  await withLock(path.join(f.root, "launch.lock"), async () => {
    atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
    child = spawn(process.execPath, f.args("verify", ["--install-sha", f.tip]), { cwd: f.repo, env: f.env });
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    child.on("exit", () => { completed = true; });
    await new Promise(resolve => setTimeout(resolve, 350)); assert.equal(completed, false, "verify must wait for launch.lock");
    f.entry.pid = process.pid; f.entry.procStart = "fixture start"; f.registry();
  });
  const code = await new Promise(resolve => child.on("close", resolve)); assert.equal(code, 1, stdout + stderr); assert.match(stderr, /active.*MONO-901|MONO-901.*active/);
});

test("landing U7 halt rejects both spawn and resume; per-merge and absent block are inert", async t => {
  const f = fixture(t); atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
  assert.throws(() => checkSpawnAvailability({ root: f.root, issue: "MONO-902", config: {} }), /halt/);
  await assert.rejects(resumeWorker({ root: f.root, issue: f.issue }), /halt/);
  for (const config of [{ landing: { install: "per-merge" } }, {}]) {
    atomicJson(f.config, config);
    for (const command of ["record", "status", "verify", "close"]) {
      const r = f.run(command); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(JSON.parse(r.stdout).outcome, "not configured");
    }
    assert.equal(fs.existsSync(f.pending), false);
  }
});

test("landing U7 concurrent records retain both landings; landed tasks do not block each other", async t => {
  const f = fixture(t), second = { ...f.entry, issue: "MONO-902" }, report = { ...f.report, issue: "MONO-902",
    certificate: f.report.certificate.replaceAll("MONO-901", "MONO-902").replace("/pull/901", "/pull/902") };
  f.workers[second.issue] = second; f.registry();
  atomicJson(path.join(f.root, "reports/MONO-902-phase-ship.json"), report);
  atomicJson(path.join(f.root, "confirmations/MONO-902-phase-ship-a1-s1.confirmed.json"), { report, issue: second.issue, attempt: 1, phase: "ship", sequence: 1, status: "confirmed", reportDigest: digest(report), results: [] });
  f.mock.prs = { 901: f.mock.pr, 902: { ...f.mock.pr, number: 902 } }; f.github();
  const run = (issue, pr) => new Promise(resolve => {
    const child = spawn(process.execPath, f.args("record", ["--issue", issue, "--attempt", "1", "--pr", pr]), { cwd: f.repo, env: f.env });
    let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; }); child.on("close", code => resolve({ code, output }));
  });
  for (const r of await Promise.all([run(f.issue, "901"), run(second.issue, "902")])) assert.equal(r.code, 0, r.output);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.pending)).map(row => row.issue).sort(), ["MONO-901", "MONO-902"]);
  assert.equal(f.run("status").status, 0);
  atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
  const verified = f.run("verify", ["--install-sha", f.tip]); assert.equal(verified.status, 0, verified.stdout + verified.stderr); assert.equal(JSON.parse(verified.stdout).proofs.length, 2);
});

test("landing U7 fixed batch composition refuses changed records and close requires proof", t => {
  const f = fixture(t); atomicJson(f.pending, [f.record]); atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
  let r = f.run("close", ["--install-sha", f.tip, "--evidence", "checked"]); assert.equal(r.status, 1); assert.match(r.stderr, /ENOENT/);
  r = f.run("verify", ["--install-sha", f.tip]); assert.equal(r.status, 0, r.stdout + r.stderr);
  f.record.guard.code = 1; atomicJson(f.pending, [f.record]);
  r = f.run("verify", ["--install-sha", f.tip]); assert.equal(r.status, 1); assert.match(r.stderr, /composition/);
  r = f.run("close", ["--install-sha", f.tip, "--evidence", "checked"]); assert.equal(r.status, 1); assert.match(r.stderr, /changed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.pending)), [f.record]);
});

test("landing U7 journal event words inside evidence cannot corrupt record replay", t => {
  const f = fixture(t); atomicJson(f.pending, [f.record]); atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
  let r = f.run("verify", ["--install-sha", f.tip]); assert.equal(r.status, 0, r.stdout + r.stderr);
  r = f.run("close", ["--install-sha", f.tip, "--evidence", "installed LANDED evidence"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  r = f.run("record", ["--issue", f.issue, "--attempt", "1", "--pr", "901"]); assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("landing U7 record preserves dispatch-before-launch lock order during thread publication", async t => {
  const f = fixture(t); let child, output = "", completion, failure;
  try {
    await withLock(path.join(f.root, "dispatch.lock"), async () => {
      child = spawn(process.execPath, f.args("record", ["--issue", f.issue, "--attempt", "1", "--pr", "901"]), { cwd: f.repo, env: f.env });
      child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
      completion = new Promise(resolve => child.on("close", resolve));
      await new Promise(resolve => setTimeout(resolve, 400));
      // Real dispatch holds dispatch.lock while waitForThread reacquires
      // launch.lock. A record must not hold launch while waiting for dispatch.
      await withLock(path.join(f.root, "launch.lock"), () => {});
    });
  } catch (error) { failure = error; }
  assert.equal(await completion, 0, output);
  if (failure) throw failure;
});

test("landing U7 status waits for a resumed landed worker's new pid", async t => {
  const f = fixture(t); atomicJson(f.pending, [f.record]); let completion, completed = false, output = "", failure;
  try {
    await withLock(path.join(f.root, "launch.lock"), async () => {
      const child = spawn(process.execPath, f.args("status"), { cwd: f.repo, env: f.env });
      child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
      completion = new Promise(resolve => child.on("close", code => { completed = true; resolve(code); }));
      await new Promise(resolve => setTimeout(resolve, 400)); assert.equal(completed, false, "status cannot observe an old landed pid during resume");
      f.entry.pid = process.pid; f.entry.procStart = "fixture start"; f.registry();
    });
  } catch (error) { failure = error; }
  const code = await completion;
  if (failure) throw failure;
  assert.equal(code, 2, output); assert.equal(JSON.parse(output).blockers[0].issue, f.issue);
});

test("landing U7 default status output names blocking attempts and reasons", t => {
  const f = fixture(t); f.entry.pid = null; f.registry();
  const r = spawnSync(process.execPath, f.args("status").filter(arg => arg !== "--json"), { cwd: f.repo, env: f.env, encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stdout, /MONO-901/); assert.match(r.stdout, /unfinished start/);
});

test("landing U7 default verify output includes per-task installation evidence", t => {
  const f = fixture(t); atomicJson(f.pending, [f.record]); atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
  const r = spawnSync(process.execPath, f.args("verify", ["--install-sha", f.tip]).filter(arg => arg !== "--json"), { cwd: f.repo, env: f.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /MONO-901/); assert.ok(r.stdout.includes(f.mergeSha)); assert.ok(r.stdout.includes(f.tip)); assert.match(r.stdout, /installSha/);
});

test("landing U7 resuming a landed release cannot bypass another active release", async t => {
  const f = fixture(t), priorPath = process.env.PATH; process.env.PATH = f.env.PATH;
  t.after(() => { process.env.PATH = priorPath; });
  const skills = path.join(f.scratch, "skills"); fs.mkdirSync(skills); fs.mkdirSync(path.join(f.scratch, "evidence"));
  f.entry.lock = path.join(skills, "pack.json"); atomicJson(f.entry.lock, f.entry);
  f.entry.model_launch = { model_parameter: "fixture", effort_parameter: "high" }; f.entry.model_policy = { role: "worker-default" };
  f.entry.log = path.join(f.root, "logs/fixture.jsonl"); fs.mkdirSync(path.dirname(f.entry.log)); fs.writeFileSync(f.entry.log, "");
  f.entry.capsule = f.report.capsule;
  f.entry.writable_roots = [f.repo, path.join(f.repo, ".git"), path.join(f.root, "reports")].sort(); f.entry.workerWritableRoots = f.entry.writable_roots;
  f.entry.evidenceRoot = path.join(f.scratch, "evidence"); f.registry(); atomicJson(f.pending, [f.record]);
  assert.equal(state.attemptState(f.root, f.entry).state, "landed");
  f.workers["MONO-902"] = { ...f.entry, issue: "MONO-902", pid: process.pid, procStart: "fixture start" }; f.registry();
  const prompt = path.join(f.scratch, "resume.md"); fs.writeFileSync(prompt, "fixture resume");
  const bin = path.join(f.scratch, "bin/codex"); fs.writeFileSync(bin, '#!/usr/bin/env node\nsetInterval(()=>{},1000);\n'); fs.chmodSync(bin, 0o755);
  let launched; t.after(() => { if (launched?.pid) process.kill(launched.pid, "SIGTERM"); });
  await assert.rejects(async () => { launched = await resumeWorker({ root: f.root, issue: f.issue, resumeFile: prompt }); }, /release.*MONO-902/);
  delete f.workers["MONO-902"]; f.registry();
  launched = await resumeWorker({ root: f.root, issue: f.issue, resumeFile: prompt }); assert.ok(launched.pid > 0); process.kill(launched.pid, 0);
});

test("landing U7 installed layout runs record, status, verify and close outside source checkout", t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-drain-install-")); t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const skills = path.join(scratch, "skills"), installed = path.join(skills, ".mono-agent-workflow/scripts/orchestrator/landing-drain.mjs");
  const install = spawnSync(process.execPath, ["scripts/install-local.mjs", "--skills-root", skills], { encoding: "utf8",
    env: { ...process.env, MONO_WORKFLOW_STATE_ROOT: path.join(scratch, "state"), MONO_WORKFLOW_KNOWN_ROOTS: skills } });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  assert.equal(fs.existsSync(installed), true, "installer must register drain and its imports");
  const f = fixture(t, installed);
  let r = f.run("record", ["--issue", f.issue, "--attempt", "1", "--pr", "901"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(f.run("status").status, 0);
  atomicJson(path.join(f.root, "control.json"), { state: "active", halt: true });
  r = f.run("verify", ["--install-sha", f.tip]); assert.equal(r.status, 0, r.stdout + r.stderr);
  r = f.run("close", ["--install-sha", f.tip, "--evidence", "all roots checked"]); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.pending)), []);
});
