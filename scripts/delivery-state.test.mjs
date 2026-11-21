import { copyPluginFixture } from './plugin-fixture.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import crypto from "node:crypto";
import { publishPhase, validatePhase } from "./delivery-state.mjs";
import { admitRound, recordResult } from "./review-rounds.mjs";
import { canonical, digest, REVIEW_PRODUCER } from "./runtime.mjs";
import { consumeAck } from "./orchestrator/consume-gate-ack.mjs";

test('no-write-queue: queued writes and confirmation-request reports are refused; reports never wait', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-not-queued-'));
  const file = path.join(root, 'reports/MONO-161-phase-code.json');
  const head = 'a'.repeat(40);
  const candidate = { issue: 'MONO-161', stage: 'mono-deliver', attempt: 1, packVersion: 'test', surfaceRevision: 6,
    phase: 'code', sequence: 1, kind: 'phase', head,
    capsule: { phase: 'code', head, decisions: [], writable_roots: [path.join(root, 'reports')] } };
  try {
    const collectionId = `preflight-collect:${head}:1`;
    for (const write of [{ id: 'comment', operation: 'comment', target: 'MONO-161', payload: { body: 'x' } },
      { id: collectionId, operation: 'preflight-collect', target: head, payload: { request: { collectionId } } }]) {
      const queued = structuredClone(candidate); queued.capsule.open_queue = queued.linear_mutations_pending = [write];
      assert.throws(() => validatePhase(queued), /queued writes no longer exist/);
      assert.throws(() => publishPhase(queued, file), /queued writes no longer exist/);
      assert.equal(fs.existsSync(file), false);
    }
    assert.throws(() => validatePhase({ ...candidate, kind: 'confirmation-request' }), /invalid phase identity/);
    assert.doesNotThrow(() => validatePhase({ ...candidate, linear_mutations_pending: [], capsule: { ...candidate.capsule, open_queue: [] } }),
      'empty legacy queue fields stay readable');
    publishPhase(candidate, file);
    assert.equal(publishPhase({ ...candidate, sequence: 2 }, file).sequence, 2, 'the next report needs no confirmation');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("phase chain: earlier phases are required; no report waits for a confirmation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-phase-order-"));
  const reports = path.join(root, "reports"), worktree = path.join(root, "worktree");
  const file = phase => path.join(reports, `MONO-75-phase-${phase}.json`);
  const head = "b".repeat(40);
  const candidate = (phase, sequence = 1) => ({ issue: "MONO-75", stage: "mono-deliver", attempt: 1, packVersion: "test",
    sourceCommit: "a".repeat(40), surfaceRevision: 6, phase, sequence, kind: "phase", head,
    capsule: { phase, head, decisions: [], writable_roots: [reports, worktree] } });
  try {
    assert.throws(() => publishPhase(candidate("preflight"), file("preflight")), /phase code report is missing/);
    publishPhase(candidate("code"), file("code"));
    publishPhase(candidate("code", 2), file("code"));
    publishPhase(candidate("preflight", 1), file("preflight"));
    publishPhase(candidate("preflight", 2), file("preflight"));
    assert.throws(() => publishPhase(candidate("preflight", 1), file("preflight")), /sequence must advance/);
    publishPhase(candidate("ship"), file("ship"));
    assert.equal(fs.existsSync(path.join(root, "confirmations")), false);
    const fallback = path.join(worktree, ".orchestrator", "MONO-75-phase-code.json");
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    fs.copyFileSync(file("code"), fallback);
    fs.writeFileSync(fallback, JSON.stringify({ ...JSON.parse(fs.readFileSync(fallback, "utf8")), sequence: 3 }));
    assert.throws(() => publishPhase(candidate("ship", 2), file("ship")), /phase code report is foreign or conflicts between mailboxes/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("blocked ack requires current pack identity, parked reason and log freshness", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-blocked-ack-"));
  const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  try {
    const issue = "MONO-999", log = path.join(root, "logs", `${issue}-mono-deliver-a1.jsonl`);
    put(log, { type: "thread.started", thread_id: "fixture" });
    const entry = { issue, stage: "mono-deliver", transport: "codex-cli", attempt: 1, log, worktree: path.join(root, "repo"),
      packVersion: "test", sourceCommit: "a".repeat(40), surfaceRevision: 4, gates: ["identity"] };
    put(path.join(root, "workers.json"), { [issue]: entry });
    const ackFile = path.join(root, "reports", `${issue}-gate-ack-a1.json`);
    put(ackFile, { issue, phase: "gate", status: "blocked", gates: [{ gate: "identity", status: "blocked", evidence: "fixture" }] });
    const reportFile = path.join(root, "reports", `${issue}-mono-deliver.json`);
    const report = { issue, stage: "mono-deliver", attempt: 1, packVersion: "test", sourceCommit: entry.sourceCommit,
      surfaceRevision: 4, status: "parked", reason: "blocked", text: "identity failed" };
    const request = { root, issue, attempt: 1, outcome: "blocked" };
    for (const change of [{ packVersion: "foreign" }, { sourceCommit: "b".repeat(40) }, { surfaceRevision: 3 },
      { stage: "mono-ship" }, { attempt: 2 }, { reason: "invented" }, { text: " " }]) {
      put(reportFile, { ...report, ...change });
      await assert.rejects(consumeAck(request), /correlated blocked report/);
      assert.ok(fs.existsSync(ackFile));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "workers.json")))[issue].gates, entry.gates);
    }
    put(reportFile, report);
    const old = new Date(fs.statSync(log).birthtimeMs - 1000); fs.utimesSync(reportFile, old, old);
    await assert.rejects(consumeAck(request), /correlated blocked report/);
    put(reportFile, report);
    const later = new Date(Date.now() + 150_000); fs.utimesSync(log, later, later);
    await assert.rejects(consumeAck(request), /correlated blocked report/);
    const now = new Date(); fs.utimesSync(log, now, now); put(reportFile, report);
    await consumeAck(request);
    assert.ok(fs.existsSync(ackFile.replace(/\.json$/, ".blocked.json")));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "workers.json")))[issue].gates, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('wait-ack binds consumption to own ack, attempt and every dispatched move', async () => {
  const { waitForGateAck } = await import('./delivery-state.mjs');
  const { digest } = await import('./runtime.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-wait-ack-'));
  const issue = 'MONO-993', attempt = 1;
  const ack = path.join(root, 'reports', `${issue}-gate-ack-a1.json`);
  const consumed = path.join(root, 'consumed', `${issue}-gate-ack-a1.json`);
  const moves = [{ entity: 'issue', key: issue, from: 'Backlog', to: 'In Progress' }];
  const own = { issue, phase: 'gate', status: 'gates-passed', gates: [{ gate: 'identity', status: 'pass', evidence: 'fixture' }] };
  const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  const record = { issue, attempt, outcome: 'applied', ack: own, ackDigest: digest(own), readback: [{ moveDigest: digest(moves[0]), evidence: { state: 'In Progress' } }] };
  const request = { root, issue, attempt, ack, moves, config: { orchestration: { delivery: { ackWaitSec: 2, pollSec: 0.01 } } } };
  try {
    put(ack, own);
    for (const change of [{ issue: 'MONO-994' }, { attempt: 2 }, { ackDigest: '0'.repeat(64) }, { readback: [] }, { readback: [{ moveDigest: '0'.repeat(64), evidence: 'foreign' }] }]) {
      put(consumed, { ...record, ...change });
      await assert.rejects(waitForGateAck(request), /consumption|read-back/);
    }
    for (const outcome of ['blocked', 'rejected']) {
      put(consumed, { ...record, outcome });
      await assert.rejects(waitForGateAck(request), new RegExp(`gate-ack ${outcome}`));
    }
    const rejected = ack.replace(/\.json$/, '.rejected.json');
    fs.renameSync(ack, rejected);
    await assert.rejects(waitForGateAck(request), /gate-ack rejected/, 'an early rejection retains its recorded outcome');
    put(consumed, { ...record, outcome: 'rejected', ackDigest: '0'.repeat(64) });
    await assert.rejects(waitForGateAck(request), /identity\/digest mismatch/, 'the rejected tombstone does not bypass identity');
    fs.renameSync(rejected, ack);
    put(consumed, record);
    assert.deepEqual(await waitForGateAck(request), record);
    const tombstone = ack.replace(/\.json$/, '.applied.json');
    fs.renameSync(ack, tombstone);
    assert.deepEqual(await waitForGateAck(request), record, 'consumption can rename ack before initialization');
    fs.renameSync(tombstone, ack);
    fs.unlinkSync(consumed);
    const futureRecord = setTimeout(() => put(consumed, record), 20);
    assert.deepEqual(await waitForGateAck(request), record);
    clearTimeout(futureRecord);
    fs.unlinkSync(consumed);
    const before = Date.now();
    const past = new Date(before - 1900); fs.utimesSync(ack, past, past);
    fs.renameSync(ack, tombstone);
    await assert.rejects(waitForGateAck(request), /write-unconfirmed/);
    assert.ok(Date.now() - before < 700, 'deadline uses ack mtime, not invocation time');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('wait-ack reads a recorded outcome before declaring expiry after a delayed poll', async () => {
  const { waitForGateAck } = await import('./delivery-state.mjs');
  const { digest } = await import('./runtime.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-wait-ack-delayed-poll-'));
  const issue = 'MONO-993', attempt = 1;
  const ack = path.join(root, 'reports', `${issue}-gate-ack-a1.json`);
  const consumed = path.join(root, 'consumed', `${issue}-gate-ack-a1.json`);
  const own = { issue, phase: 'gate', status: 'gates-passed', gates: [{ gate: 'identity', status: 'pass', evidence: 'fixture' }] };
  const record = { issue, attempt, outcome: 'applied', ackDigest: digest(own), readback: [] };
  fs.mkdirSync(path.dirname(ack), { recursive: true });
  fs.mkdirSync(path.dirname(consumed), { recursive: true });
  fs.writeFileSync(ack, JSON.stringify(own));
  const deadline = fs.statSync(ack).mtimeMs + 200;
  const publisher = setTimeout(() => {
    fs.writeFileSync(consumed, JSON.stringify(record));
    // Model an event-loop delay after publication but before the polling continuation.
    while (Date.now() < deadline + 50) {}
  }, 10);
  try {
    const request = { root, issue, attempt, ack, moves: [], config: { orchestration: { delivery: { ackWaitSec: 0.2, pollSec: 0.03 } } } };
    assert.deepEqual(await waitForGateAck(request), record);
    fs.writeFileSync(consumed, JSON.stringify({ ...record, attempt: 2 }));
    await assert.rejects(waitForGateAck(request), /identity\/digest mismatch/, 'an expired poll still validates the record');
    fs.unlinkSync(consumed);
    await assert.rejects(waitForGateAck(request), /write-unconfirmed/, 'expiry still fails when no record exists');
  } finally { clearTimeout(publisher); fs.rmSync(root, { recursive: true, force: true }); }
});

test('delivery configuration shares stall and ack clocks and rejects incompatible windows', async () => {
  const { deliveryConfig } = await import('./runtime.mjs');
  assert.equal(deliveryConfig().stallSec, 120);
  assert.equal(deliveryConfig().ackWaitSec, 420);
  assert.doesNotThrow(() => deliveryConfig({ orchestration: { delivery: { stallSec: 90, ackWaitSec: 350, pollSec: 10 } } }));
  assert.throws(() => deliveryConfig({ orchestration: { delivery: { stallSec: 90, ackWaitSec: 351, pollSec: 10 } } }), /ackWaitSec.*stallSec/);
  for (const [field, value] of [['stallSec', 0], ['ackWaitSec', -1], ['ackWaitSec', Infinity]])
    assert.throws(() => deliveryConfig({ orchestration: { delivery: { [field]: value } } }), /invalid/);
  // MONO-457: host verification is off unless the product opts in with a boolean.
  assert.equal(deliveryConfig().hostVerification, false);
  assert.equal(deliveryConfig({ orchestration: { delivery: { hostVerification: true } } }).hostVerification, true);
  for (const value of ['true', 1, {}]) assert.throws(() => deliveryConfig({ orchestration: { delivery: { hostVerification: value } } }), /hostVerification must be true or false/);
});

test('pre-rename stage fixture: queued certificate comments are refused and the code comment is printed for the worker', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-short-certificate-'));
  const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ready = JSON.parse(fs.readFileSync(path.join(checkout, 'scripts/fixtures/short-ready-report.json'), 'utf8'));
  assert.equal(ready.stage, 'mono-deliver');
  const reports = path.join(root, 'reports');
  ready.capsule.writable_roots = [reports]; ready.capsule.open_queue = ready.linear_mutations_pending;
  ready.kind = 'phase';
  const code = JSON.parse(fs.readFileSync(path.join(checkout, 'scripts/fixtures/short-code-report.json'), 'utf8'));
  code.capsule.writable_roots = [reports];
  try {
    const { captureCriteria } = await import("./delivery-state.mjs");
    const issueFile = path.join(root, "issue-start-read.md");
    fs.writeFileSync(issueFile, "# Критерии приемки\nГотово, когда:\n* Справка называет действующую команду\n");
    captureCriteria({ root, issue: code.issue, attempt: code.attempt, issueFile });
    const codeFile = path.join(reports, 'MONO-993-phase-code.json');
    const publishedCode = publishPhase(code, codeFile);
    assert.equal(publishedCode.capsule.open_queue?.length ?? 0, 0, 'the code exit publishes no queue; the worker posts its comment');
    const printed = spawnSync(process.execPath, [path.join(checkout, 'scripts/delivery-state.mjs'), 'comment', '--report', codeFile], { encoding: 'utf8' });
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /\nНе проверено\n/);
    assert.doesNotMatch(printed.stdout, /delivery-state comment: pass/);
    assert.throws(() => publishPhase(ready, path.join(reports, 'MONO-993-phase-preflight.json')), /queued writes no longer exist/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('scratch wait-ack CLI scenario refuses foreign digest, accepts own read-backs and expires', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-wait-cli-'));
  const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const skills = path.join(root, 'skills'), state = path.join(root, 'state');
  const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  const env = { ...process.env, };
  const run = args => spawnSync(process.execPath, args, { cwd: checkout, env, encoding: 'utf8' });
  try {
    copyPluginFixture(skills);
    const issue = 'MONO-993', ack = path.join(state, 'reports', `${issue}-gate-ack-a1.json`), config = path.join(root, 'config.json'), moves = path.join(root, 'moves.json');
    const own = { issue, phase: 'gate', status: 'gates-passed', gates: [{ gate: 'identity', status: 'pass', evidence: 'fixture' }] };
    put(ack, own); put(moves, []); put(config, { orchestration: { delivery: { ackWaitSec: 0.3, pollSec: 0.01 } } });
    const consumed = path.join(state, 'consumed', `${issue}-gate-ack-a1.json`);
    const command = [path.join(skills, 'scripts/delivery-state.mjs'), 'wait-ack', '--root', state, '--issue', issue, '--attempt', '1', '--ack', ack, '--moves', moves, '--config', config];
    const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
    const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
    put(consumed, { issue, attempt: 1, outcome: 'applied', ackDigest: '0'.repeat(64), readback: [] });
    const forged = run(command); assert.notEqual(forged.status, 0); assert.match(forged.stderr, /digest mismatch/);
    put(ack, own); put(consumed, { issue, attempt: 1, outcome: 'applied', ackDigest: digest(own), readback: [] });
    const applied = run(command); assert.equal(applied.status, 0, applied.stderr); assert.match(applied.stdout, /wait-ack: pass/);
    fs.unlinkSync(consumed); put(ack, own);
    const expired = run(command); assert.notEqual(expired.status, 0); assert.match(expired.stderr, /write-unconfirmed/);
    put(config, { orchestration: { delivery: { stallSec: 90, ackWaitSec: 351, pollSec: 10 } } });
    const invalid = run(command); assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /ackWaitSec.*stallSec/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ship-green-certificate: publication and landing share issue/head/PR validation', async () => {
  const { landedShip } = await import('./orchestrator/command-state.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-ship-certificate-'));
  const head = 'a'.repeat(40), issue = 'MONO-162';
  const entry = { issue, attempt: 1, stage: 'mono-deliver', packVersion: 'test', surfaceRevision: 4,
    worktree: root, config: path.join(root, 'config.json'), spawned_at: new Date(Date.now() - 1000).toISOString(), pinsVersion: 0 };
  fs.writeFileSync(entry.config, JSON.stringify({}));
  const file = phase => path.join(root, 'reports', `${issue}-phase-${phase}.json`);
  const candidate = phase => ({ ...entry, phase, sequence: 1, kind: 'phase', head,
    linear_mutations_pending: [], capsule: { phase, head, open_queue: [], decisions: [], writable_roots: [root] } });
  const certificate = `mono-ship green certificate\nShip: green\nIssue(s): ${issue}\nHead SHA: ${head}\nPR: https://github.com/owner/repo/pull/162\n`;
  try {
    for (const phase of ['code', 'preflight']) publishPhase(candidate(phase), file(phase));
    for (const invalid of [null, ' ', 'arbitrary text', certificate.replace(head, 'b'.repeat(40)),
      certificate.replace(issue, 'MONO-999'), certificate.replace('/pull/162', '/pull/162 #163')]) {
      assert.throws(() => publishPhase({ ...candidate('ship'), status: 'green', certificate: invalid }, file('ship')), /certificate/);
      assert.equal(fs.existsSync(file('ship')), false);
    }
    const report = publishPhase({ ...candidate('ship'), status: 'green', certificate }, file('ship'));
    const pinsFile = path.join(root, 'dispatch', `${issue}-a1`, 'pins.json');
    fs.mkdirSync(path.dirname(pinsFile), { recursive: true }); fs.writeFileSync(pinsFile, JSON.stringify({ baseRef: 'origin/main' }));
    entry.pins = { file: pinsFile, digest: createHash('sha256').update(fs.readFileSync(pinsFile)).digest('hex') };
    fs.writeFileSync(path.join(root, 'workers.json'), JSON.stringify({ [issue]: entry }));
    assert.equal(fs.existsSync(path.join(root, 'confirmations')), false, 'a green ship report lands without any confirmation');
    const code = fs.readFileSync(file('code')); fs.unlinkSync(file('code'));
    assert.throws(() => landedShip(root, entry), /phase code report is missing/, 'landing still requires the phase chain');
    fs.writeFileSync(file('code'), code);
    const admission = admitRound(root, issue, 1, { collectionId: `preflight-collect:${head}:1`, head, root });
    assert.throws(() => landedShip(root, entry), /review round preflight-collect:.*:1 has no result yet; landing waits/, 'an admitted round in flight blocks landing, even if the worker overwrote its request');
    recordResult(root, issue, 1, admission, { status: 'refused', reason: 'fixture' });
    assert.deepEqual(landedShip(root, entry), { repo: 'owner/repo', pr: 162, head, branch: 'main' }, 'a refused round is terminal and never blocks landing forever');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
