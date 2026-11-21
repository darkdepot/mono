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
import { confirmQueue, validateConfirmation, publishPhase, waitForConfirmation, confirmationPath, classifyQueue, validatePhase, requiresConfirmation } from "./delivery-state.mjs";
import { canonical, digest, REVIEW_PRODUCER } from "./runtime.mjs";
import { consumeAck } from "./orchestrator/consume-gate-ack.mjs";

function collectionFixture(root) {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-evidence-'));
  fs.writeFileSync(path.join(evidenceRoot, 'receipt.key'), Buffer.alloc(32, 5));
  fs.mkdirSync(path.join(evidenceRoot, 'history'));
  const write = (head, n = 1) => {
    const collectionId = `preflight-collect:${head}:${n}`;
    return { id: collectionId, operation: 'preflight-collect', target: head,
      payload: { request: { collectionId, evidenceRoot, root, worktree: path.join(root, 'worktree'), workerWritableRoots: [] } } };
  };
  const evidence = item => {
    const receipt = { runId: crypto.randomUUID(), producer: REVIEW_PRODUCER, collectionId: item.id, head: item.target, evidenceRoot: fs.realpathSync(evidenceRoot) };
    const envelope = { receipt, signature: crypto.createHmac('sha256', Buffer.alloc(32, 5)).update(canonical(receipt)).digest('hex') };
    const file = path.join(evidenceRoot, 'history', `${receipt.runId}.json`);
    fs.writeFileSync(file, JSON.stringify(envelope));
    return { receipt: file, receiptDigest: digest(envelope), gate: 'gate preflight: pass: fixture' };
  };
  const adapter = (action, item) => ({ state: 'present', evidence: evidence(item) });
  return { write, adapter, close: () => fs.rmSync(evidenceRoot, { recursive: true, force: true }) };
}

test('linear-writes-not-queued: comments and statuses are refused; only a collection request waits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-not-queued-'));
  const file = path.join(root, 'reports/MONO-161-phase-code.json');
  const head = 'a'.repeat(40);
  const candidate = { issue: 'MONO-161', stage: 'mono-deliver', attempt: 1, packVersion: 'test', surfaceRevision: 6,
    phase: 'code', sequence: 1, kind: 'phase', head, linear_mutations_pending: [],
    capsule: { phase: 'code', head, decisions: [], writable_roots: [path.join(root, 'reports')], open_queue: [] } };
  try {
    for (const write of [{ id: 'comment', operation: 'comment', target: 'MONO-161', payload: { body: 'x' } },
      { id: 'status', operation: 'status', target: 'MONO-161', payload: 'In Review' }]) {
      const queued = structuredClone(candidate); queued.capsule.open_queue = queued.linear_mutations_pending = [write];
      assert.throws(() => validatePhase(queued), /Linear writes are not queued; the worker writes comments and statuses through Linear MCP/);
      assert.throws(() => publishPhase(queued, file), /not queued/);
      assert.equal(fs.existsSync(file), false);
    }
    const code = publishPhase(candidate, file);
    assert.equal(requiresConfirmation(code), false, 'an empty report never waits for the orchestrator');
    await waitForConfirmation(code, path.join(root, 'confirmations/absent.json'), 0.01);
    assert.equal(publishPhase({ ...candidate, sequence: 2 }, file).sequence, 2, 'the next report needs no confirmation');
    const collections = collectionFixture(root);
    try {
      const write = collections.write(head);
      const request = { ...candidate, phase: 'preflight', kind: 'confirmation-request', linear_mutations_pending: [write],
        capsule: { ...candidate.capsule, phase: 'preflight', open_queue: [write] } };
      assert.equal(requiresConfirmation(request), true);
      assert.throws(() => classifyQueue({ ...request, kind: 'phase' }, root), /single preflight confirmation-request/);
    } finally { collections.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('collection-id-reuse: publication refuses changed reports immediately and preserves the prior bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-collection-id-'));
  const file = phase => path.join(root, 'reports', `MONO-161-phase-${phase}.json`);
  const candidate = { issue: 'MONO-161', stage: 'mono-deliver', attempt: 1, packVersion: 'test', surfaceRevision: 4,
    phase: 'code', sequence: 1, kind: 'phase', head: 'a'.repeat(40), linear_mutations_pending: [],
    capsule: { phase: 'code', head: 'a'.repeat(40), decisions: [], writable_roots: [path.join(root, 'reports')], open_queue: [] } };
  try {
    const code = publishPhase(candidate, file('code')); await confirmQueue(code, root, () => {});
    const id = `preflight-collect:${candidate.head}:1`;
    const queue = [{ id, operation: 'preflight-collect', target: candidate.head, payload: { request: { collectionId: id } } }];
    const preflight = { ...candidate, phase: 'preflight', kind: 'confirmation-request', linear_mutations_pending: queue,
      capsule: { ...candidate.capsule, phase: 'preflight', open_queue: queue } };
    const published = publishPhase(preflight, file('preflight'));
    const bytes = fs.readFileSync(file('preflight'), 'utf8');
    assert.deepEqual(publishPhase(preflight, file('preflight')), published, 'lost response preserves publication');
    for (const change of [{ sequence: 2 }, { text: 'changed' }]) {
      assert.throws(() => publishPhase({ ...preflight, ...change }, file('preflight')), /нужен новый идентификатор сбора/);
      assert.equal(fs.readFileSync(file('preflight'), 'utf8'), bytes);
    }
    const two = structuredClone(preflight);
    const second = structuredClone(queue[0]); second.id = second.payload.request.collectionId = `preflight-collect:${candidate.head}:2`;
    two.capsule.open_queue.push(second); two.linear_mutations_pending = two.capsule.open_queue;
    assert.throws(() => classifyQueue(two, root), /single preflight/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("phase chain: earlier phases are required and a collection request is confirmed before the next publication", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-phase-order-"));
  const reports = path.join(root, "reports"), worktree = path.join(root, "worktree");
  const file = phase => path.join(reports, `MONO-75-phase-${phase}.json`);
  const head = "b".repeat(40), collections = collectionFixture(root);
  const candidate = (phase, sequence = 1, kind = "phase", queue = []) => ({ issue: "MONO-75", stage: "mono-deliver", attempt: 1, packVersion: "test",
    sourceCommit: "a".repeat(40), surfaceRevision: 6, phase, sequence, kind, head, linear_mutations_pending: queue,
    capsule: { phase, head, decisions: [], writable_roots: [reports, worktree], open_queue: queue } });
  try {
    assert.throws(() => publishPhase(candidate("preflight"), file("preflight")), /phase code report is missing/);
    publishPhase(candidate("code"), file("code"));
    publishPhase(candidate("code", 2), file("code"));
    const request = publishPhase(candidate("preflight", 1, "confirmation-request", [collections.write(head)]), file("preflight"));
    assert.throws(() => publishPhase(candidate("preflight", 2), file("preflight")), /previous phase report is unconfirmed/);
    const ship = { ...candidate("ship"), publishedAt: new Date().toISOString() };
    await assert.rejects(confirmQueue(ship, root, collections.adapter), /phase preflight sequence 1 is not confirmed/);
    assert.throws(() => publishPhase(candidate("ship"), file("ship")), /phase preflight sequence 1 is not confirmed/);
    const ack = await confirmQueue(request, root, collections.adapter);
    assert.equal(validateConfirmation(request, ack), true);
    await waitForConfirmation(request, confirmationPath(request, root), 1);
    publishPhase(candidate("preflight", 2), file("preflight"));
    const published = publishPhase(candidate("ship"), file("ship"));
    assert.equal(requiresConfirmation(published), false);
    const fallback = path.join(worktree, ".orchestrator", "MONO-75-phase-code.json");
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    fs.copyFileSync(file("code"), fallback);
    fs.writeFileSync(fallback, JSON.stringify({ ...JSON.parse(fs.readFileSync(fallback, "utf8")), sequence: 3 }));
    assert.throws(() => publishPhase(candidate("ship", 2), file("ship")), /phase code report is foreign or conflicts between mailboxes/);
  } finally { collections.close(); fs.rmSync(root, { recursive: true, force: true }); }
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

test("collection confirmation: wait deadline, planted paths and changed writes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-barrier-"));
  const head = "b".repeat(40), collections = collectionFixture(root), reports = path.join(root, "reports");
  const queue = [collections.write(head)];
  const base = { issue: "MONO-75", stage: "mono-deliver", attempt: 1, packVersion: "test", sourceCommit: "a".repeat(40), surfaceRevision: 6,
    phase: "code", sequence: 1, kind: "phase", head, linear_mutations_pending: [],
    capsule: { phase: "code", head, decisions: [], writable_roots: [reports, path.join(root, "worktree")], open_queue: [] } };
  try {
    publishPhase(base, path.join(reports, "MONO-75-phase-code.json"));
    const report = publishPhase({ ...base, phase: "preflight", kind: "confirmation-request", linear_mutations_pending: queue,
      capsule: { ...base.capsule, phase: "preflight", open_queue: queue } }, path.join(reports, "MONO-75-phase-preflight.json"));
    await assert.rejects(waitForConfirmation({ ...report, publishedAt: new Date(Date.now() - 2000).toISOString() }, path.join(root, "absent.json"), 1), /write-unconfirmed/);
    await assert.rejects(confirmQueue(report, root, () => ({ state: "missing" })), /not confirmed by its collection receipt/);
    const confirmation = await confirmQueue(report, root, collections.adapter);
    const planted = path.join(reports, "forged-confirmation.json");
    fs.writeFileSync(planted, JSON.stringify(confirmation));
    await assert.rejects(waitForConfirmation(report, planted, 1), /confirmation path must be outside/);
    await waitForConfirmation(report, confirmationPath(report, root), 1);
    assert.equal(validateConfirmation(report, confirmation), true);
    const again = await confirmQueue(report, root, () => { throw new Error("confirmed collection reached the adapter again"); });
    assert.deepEqual(again.results, confirmation.results);
    assert.throws(() => validateConfirmation({ ...report, attempt: 2 }, confirmation), /confirmation/);
    assert.throws(() => validateConfirmation(report, { ...confirmation, results: [] }), /confirmation/);
    const changed = structuredClone(report); changed.capsule.open_queue[0].payload.request.worktree = root;
    changed.linear_mutations_pending = changed.capsule.open_queue;
    assert.throws(() => classifyQueue(changed, root), /changed within attempt/);
  } finally { collections.close(); fs.rmSync(root, { recursive: true, force: true }); }
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
});

test('pre-rename stage fixture: queued certificate comments are refused and the code comment is printed for the worker', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-short-certificate-'));
  const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ready = JSON.parse(fs.readFileSync(path.join(checkout, 'scripts/fixtures/short-ready-report.json'), 'utf8'));
  assert.equal(ready.stage, 'mono-deliver');
  const reports = path.join(root, 'reports');
  ready.capsule.writable_roots = [reports]; ready.capsule.open_queue = ready.linear_mutations_pending;
  const code = JSON.parse(fs.readFileSync(path.join(checkout, 'scripts/fixtures/short-code-report.json'), 'utf8'));
  code.capsule.writable_roots = [reports];
  try {
    const { captureCriteria } = await import("./delivery-state.mjs");
    const issueFile = path.join(root, "issue-start-read.md");
    fs.writeFileSync(issueFile, "# Критерии приемки\nГотово, когда:\n* Справка называет действующую команду\n");
    captureCriteria({ root, issue: code.issue, attempt: code.attempt, issueFile });
    const codeFile = path.join(reports, 'MONO-993-phase-code.json');
    const publishedCode = publishPhase(code, codeFile);
    assert.equal(publishedCode.capsule.open_queue.length, 0, 'the code exit publishes no queue; the worker posts its comment');
    const printed = spawnSync(process.execPath, [path.join(checkout, 'scripts/delivery-state.mjs'), 'comment', '--report', codeFile], { encoding: 'utf8' });
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /\nНе проверено\n/);
    assert.doesNotMatch(printed.stdout, /delivery-state comment: pass/);
    assert.throws(() => publishPhase(ready, path.join(reports, 'MONO-993-phase-preflight.json')), /Linear writes are not queued/);
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
    assert.deepEqual(landedShip(root, entry), { repo: 'owner/repo', pr: 162, head, branch: 'main' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
