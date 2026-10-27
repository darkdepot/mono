import { copyPluginFixture } from './plugin-fixture.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { confirmQueue, validateConfirmation, publishPhase, waitForConfirmation, confirmationPath, classifyQueue } from "./delivery-state.mjs";
import { consumeAck } from "./orchestrator/consume-gate-ack.mjs";

test('queue-carried-confirmed: only whole same-attempt confirmations authorize reuse without apply', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-carried-'));
  const file = path.join(root, 'reports/MONO-161-phase-code.json');
  const write = { id: 'comment', operation: 'comment', target: 'MONO-161', payload: 'once' };
  const candidate = { issue: 'MONO-161', stage: 'mono-deliver', attempt: 1, packVersion: 'test', surfaceRevision: 4,
    phase: 'code', sequence: 1, kind: 'phase', head: 'a'.repeat(40), linear_mutations_pending: [write],
    capsule: { phase: 'code', head: 'a'.repeat(40), decisions: [], writable_roots: [path.join(root, 'reports')], open_queue: [write] } };
  try {
    const first = publishPhase(candidate, file);
    const confirmation = await confirmQueue(first, root, () => ({ state: 'present', evidence: 'verified comment' }));
    const reopened = await confirmQueue(first, root, () => { throw new Error('confirmed report reached adapter again'); });
    assert.deepEqual(reopened.results, confirmation.results, 'a confirmed report retry also skips its writes');
    const next = publishPhase({ ...candidate, sequence: 2 }, file);
    const ack = await confirmQueue(next, root, () => { throw new Error('carried write reached adapter'); });
    assert.equal(validateConfirmation(next, ack), true);
    assert.deepEqual(ack.results, confirmation.results);
    const changed = structuredClone(next);
    changed.capsule.open_queue[0].payload = 'changed'; changed.linear_mutations_pending = changed.capsule.open_queue;
    await assert.rejects(confirmQueue(changed, root, () => {}), /changed within attempt/);
    fs.unlinkSync(path.join(root, 'consumed/MONO-161-a1/comment.json'));
    assert.throws(() => classifyQueue(changed, root), /changed within attempt/, 'confirmation identity survives a missing per-write result');
    assert.throws(() => validateConfirmation(first, { ...confirmation, results: [{ ...confirmation.results[0], attempt: 2 }] }), /unverified write/);
    assert.equal(classifyQueue({ ...candidate, attempt: 2 }, root).carried.size, 0, 'other attempts do not inherit proof');
    const firstAck = confirmationPath(first, root), nextAck = confirmationPath(next, root);
    fs.unlinkSync(nextAck); fs.unlinkSync(firstAck);
    assert.equal(classifyQueue(candidate, root).carried.size, 0, 'a durable present result without whole confirmation is not proof');
    fs.writeFileSync(firstAck, JSON.stringify({ ...confirmation, results: [] }));
    assert.throws(() => classifyQueue(next, root), /confirmation/, 'incomplete confirmation is not proof');
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

test("both publication and confirmation enforce the complete phase and sequence chain", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-phase-order-"));
  const reports = path.join(root, "reports"), worktree = path.join(root, "worktree");
  const file = phase => path.join(reports, `MONO-75-phase-${phase}.json`);
  const candidate = (phase, sequence = 1, kind = "phase") => {
    const queue = [{ id: `${phase}-${sequence}`, operation: "comment", target: "issue", payload: phase }];
    return { issue: "MONO-75", stage: "mono-deliver", attempt: 1, packVersion: "test", sourceCommit: "a".repeat(40), surfaceRevision: 4,
      phase, sequence, kind, head: "b".repeat(40), linear_mutations_pending: queue,
      capsule: { phase, head: "b".repeat(40), decisions: [], writable_roots: [reports, worktree], open_queue: queue } };
  };
  const applied = new Set(); let calls = 0;
  const adapter = async (action, write) => {
    calls++;
    if (action === "apply") { applied.add(write.id); return; }
    return applied.has(write.id) ? { state: "present", evidence: write.id } : { state: "missing" };
  };
  try {
    assert.throws(() => publishPhase(candidate("preflight"), file("preflight")), /phase code report is missing/);
    let code = publishPhase(candidate("code"), file("code"));
    await confirmQueue(code, root, adapter);
    code = publishPhase(candidate("code", 2), file("code"));
    assert.throws(() => publishPhase(candidate("preflight"), file("preflight")),
      /phase code sequence 2 is not confirmed; wait for it before publishing preflight/);
    const before = calls;
    await assert.rejects(confirmQueue(candidate("preflight"), root, adapter), /phase code sequence 2 is not confirmed/);
    await assert.rejects(confirmQueue(candidate("code", 3, "confirmation-request"), root, adapter), /phase code sequence 2 is not confirmed/);
    assert.equal(calls, before, "no adapter call before all predecessors are confirmed");
    await confirmQueue(code, root, adapter);
    let ready = publishPhase(candidate("preflight", 1, "confirmation-request"), file("preflight"));
    await confirmQueue(ready, root, adapter);
    ready = publishPhase(candidate("preflight", 2), file("preflight"));
    const ship = { ...candidate("ship"), publishedAt: new Date().toISOString() };
    fs.writeFileSync(file("ship"), JSON.stringify(ship)); // Bypass publish as a careless worker could.
    const beforeShip = calls;
    await assert.rejects(confirmQueue(ship, root, adapter), /phase preflight sequence 2 is not confirmed/);
    assert.equal(calls, beforeShip);
    await confirmQueue(ready, root, adapter);
    publishPhase(ship, file("ship"));
    const ack = await confirmQueue(ship, root, adapter);
    assert.equal(validateConfirmation(ship, ack), true);
    const firstCodeAck = confirmationPath(candidate("code"), root), saved = fs.readFileSync(firstCodeAck);
    fs.unlinkSync(firstCodeAck);
    await assert.rejects(confirmQueue(ship, root, adapter), /phase code sequence 1 is not confirmed/);
    assert.throws(() => publishPhase(candidate("ship", 2), file("ship")), /phase code sequence 1 is not confirmed/);
    fs.writeFileSync(firstCodeAck, saved);
    const recovered = await confirmQueue(ship, root, adapter);
    assert.equal(validateConfirmation(ship, recovered), true);
    assert.equal(applied.size, 5);
    const fallback = path.join(worktree, ".orchestrator", "MONO-75-phase-code.json");
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    fs.renameSync(file("code"), fallback);
    assert.equal(validateConfirmation(ship, await confirmQueue(ship, root, adapter)), true);
    const nextReady = publishPhase(candidate("preflight", 3), file("preflight"));
    await confirmQueue(nextReady, root, adapter);
    const fallbackCode = publishPhase(candidate("code", 3), fallback, undefined, root);
    const beforeFallback = calls;
    assert.throws(() => publishPhase(candidate("ship", 2), file("ship")), /phase code sequence 3 is not confirmed/);
    await assert.rejects(confirmQueue(candidate("ship", 2), root, adapter), /phase code sequence 3 is not confirmed/);
    assert.equal(calls, beforeFallback);
    await confirmQueue(fallbackCode, root, adapter, path.dirname(fallback));
    const nextShip = publishPhase(candidate("ship", 2), file("ship"));
    assert.equal(validateConfirmation(nextShip, await confirmQueue(nextShip, root, adapter)), true);

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

test("lost confirmation and partial application recover without duplicates", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-barrier-"));
  let report = { issue: "MONO-75", stage: "mono-deliver", attempt: 1,
    packVersion: "test", sourceCommit: "a".repeat(40), surfaceRevision: 4,
    phase: "code", sequence: 1, kind: "phase", head: "b".repeat(40),
    capsule: { phase: "code", head: "b".repeat(40), decisions: [], writable_roots: [path.join(root, "reports"), path.join(root, "worktree")], open_queue: [
      { id: "start", operation: "comment", target: "issue", payload: "start" },
      { id: "ready", operation: "comment", target: "issue", payload: "ready" },
    ] } };
  report.linear_mutations_pending = report.capsule.open_queue;
  const applied = new Map(); let writes = 0, breakAfterWrite = true;
  const adapter = async (action, write) => {
    if (action === "reconcile") return applied.has(write.id)
      ? { state: "present", evidence: applied.get(write.id) } : { state: "missing" };
    writes++; applied.set(write.id, `linear:${write.id}`);
    if (breakAfterWrite) { breakAfterWrite = false; throw new Error("lost response after write"); }
    return { state: "present", evidence: applied.get(write.id) };
  };
  try {
    const target = path.join(root, "reports/MONO-75-phase-code.json");
    report = publishPhase(report, target);
    const adapterFile = path.join(root, "slow-adapter"), adapterConfig = path.join(root, "config.json");
    fs.writeFileSync(adapterFile, `if(!process.argv[1]){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);console.log(JSON.stringify({state:'present',evidence:'already-applied'}));process.exit();}\n`);
    const confirmCLI = (stateRoot = path.join(root, "cli-state")) => spawnSync(process.execPath, [fileURLToPath(new URL("./delivery-state.mjs", import.meta.url)),
      "confirm", "--report", target, "--root", stateRoot, "--adapter", process.execPath, "--config", adapterConfig], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: '--require ' + JSON.stringify(adapterFile) } });
    fs.writeFileSync(adapterConfig, JSON.stringify({ orchestration: { delivery: { confirmationTimeoutSec: 0.03, collectionTimeoutSec: 0.01 } } }));
    assert.equal(confirmCLI().status, 1);
    fs.writeFileSync(adapterConfig, JSON.stringify({ orchestration: { delivery: { confirmationTimeoutSec: 10, collectionTimeoutSec: 1 } } }));
    const confirmedCLI = confirmCLI(); assert.equal(confirmedCLI.status, 0, confirmedCLI.stderr);
    const remoteFile = path.join(root, "remote.json");
    fs.writeFileSync(adapterFile, `if(!process.argv[1]){
const fs=require('node:fs'),p=JSON.parse(fs.readFileSync(0,'utf8')),file=${JSON.stringify(remoteFile)};
const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
if(p.action==='apply'){state[p.write.id]=(state[p.write.id]||0)+1;fs.writeFileSync(file,JSON.stringify(state));}
else console.log(JSON.stringify(state[p.write.id]?{state:'present',evidence:p.write.id}:{state:'missing'}));
process.exit();}
`);
    const silentState = path.join(root, "silent-cli-state");
    const silent = confirmCLI(silentState); assert.equal(silent.status, 0, silent.stderr);
    assert.equal(confirmCLI(silentState).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(remoteFile, "utf8")), { start: 1, ready: 1 });
    await assert.rejects(waitForConfirmation({ ...report, publishedAt: new Date(Date.now() - 2000).toISOString() }, path.join(root, "absent.json"), 1), /write-unconfirmed/);
    assert.throws(() => publishPhase({ ...report, sequence: 2 }, target), /is not confirmed/);
    await assert.rejects(confirmQueue(report, root, adapter), /lost response/);
    const confirmation = await confirmQueue(report, root, adapter);
    const planted = path.join(root, "reports", "forged-confirmation.json");
    fs.writeFileSync(planted, JSON.stringify(confirmation));
    await assert.rejects(waitForConfirmation(report, planted, 1), /confirmation path must be outside/);
    await assert.rejects(waitForConfirmation({ ...report, capsule: { ...report.capsule, writable_roots: [root] } },
      path.join(root, "confirmations/MONO-75-phase-code-a1-s1.confirmed.json"), 1), /confirmation path must be outside/);
    await waitForConfirmation(report, path.join(root, "confirmations/MONO-75-phase-code-a1-s1.confirmed.json"), 1);
    assert.equal(writes, 2);
    assert.equal(validateConfirmation(report, confirmation), true);
    await confirmQueue(report, root, adapter);
    assert.equal(writes, 2);
    const fallback = path.join(root, "worktree/.orchestrator/MONO-75-phase-code.json");
    fs.mkdirSync(path.dirname(fallback), { recursive: true }); fs.writeFileSync(fallback, JSON.stringify(report));
    const candidate = { ...report, sequence: 2, certificate: "ready on head", capsule: { ...report.capsule,
      open_queue: [{ id: "certificate", operation: "comment", target: "issue", payload: "append #/certificate" }] } };
    candidate.linear_mutations_pending = candidate.capsule.open_queue;
    const next = publishPhase(candidate, fallback, path.join(root, "confirmations/MONO-75-phase-code-a1-s1.confirmed.json"));
    let certificateWrite;
    await confirmQueue(next, root, async (action, write) => {
      if (action === "apply") { certificateWrite = write; return; }
      return certificateWrite ? { state: "present", evidence: "certificate-comment" } : { state: "missing" };
    });
    assert.equal(certificateWrite.payload, "ready on head");
    await assert.rejects(confirmQueue({ ...next, certificate: "different" }, root, adapter), /changed/);
    assert.throws(() => validateConfirmation({ ...report, attempt: 2 }, confirmation), /confirmation/);
    assert.throws(() => validateConfirmation(report, { ...confirmation, results: [] }), /confirmation/);
    const changed = structuredClone(report); changed.capsule.open_queue[0].payload = "changed";
    changed.linear_mutations_pending = changed.capsule.open_queue;
    await assert.rejects(confirmQueue(changed, root, adapter), /changed/);
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
});

test('pre-rename stage and certificate fixture confirms and expands without changing machine core', async () => {
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
    const publishedCode = publishPhase(code, path.join(reports, 'MONO-993-phase-code.json'));
    const codeConfirmation = await confirmQueue(publishedCode, root, () => { throw new Error('empty queue never calls adapter'); });
    assert.deepEqual(codeConfirmation.results, []);
    assert.equal(validateConfirmation(publishedCode, codeConfirmation), true);
    const publishedReady = publishPhase(ready, path.join(reports, 'MONO-993-phase-preflight.json'));
    let applied;
    const confirmation = await confirmQueue(publishedReady, root, (action, write) => {
      if (action === 'apply') { applied = write; return; }
      return applied ? { state: 'present', evidence: 'fixture comment read-back' } : { state: 'missing' };
    });
    const body = applied.payload.body;
    assert.match(body, /^Начал реализацию/);
    assert.ok(body.includes('Autoreview loop: 0 local passes + 1 collection'));
    assert.equal(body.split('```\n')[1].split('\n```')[0], ready.certificate);
    assert.ok(ready.certificate.startsWith('mono-preflight certificate\nPreflight: ready\n'));
    assert.equal(body.split('mono-preflight certificate').length, 2);
    assert.equal(validateConfirmation(publishedReady, confirmation), true);
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
    worktree: root, spawned_at: new Date(Date.now() - 1000).toISOString(), pinsVersion: 0 };
  const file = phase => path.join(root, 'reports', `${issue}-phase-${phase}.json`);
  const candidate = phase => ({ ...entry, phase, sequence: 1, kind: 'phase', head,
    linear_mutations_pending: [], capsule: { phase, head, open_queue: [], decisions: [], writable_roots: [root] } });
  const certificate = `mono-ship green certificate\nShip: green\nIssue(s): ${issue}\nHead SHA: ${head}\nPR: https://github.com/owner/repo/pull/162\n`;
  try {
    for (const phase of ['code', 'preflight']) await confirmQueue(publishPhase(candidate(phase), file(phase)), root, () => {});
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
    assert.throws(() => landedShip(root, entry), /ENOENT/);
    await confirmQueue(report, root, () => {});
    assert.deepEqual(landedShip(root, entry), { repo: 'owner/repo', pr: 162, head, branch: 'main' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
