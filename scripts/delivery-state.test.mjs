import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { confirmQueue, validateConfirmation, publishPhase, waitForConfirmation, confirmationPath } from "./delivery-state.mjs";
import { consumeAck } from "./orchestrator/consume-gate-ack.mjs";

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
    fs.writeFileSync(adapterFile, `#!/usr/bin/env node\nsetTimeout(()=>console.log(JSON.stringify({state:'present',evidence:'already-applied'})),150);\n`);
    fs.chmodSync(adapterFile, 0o700);
    const confirmCLI = (stateRoot = path.join(root, "cli-state")) => spawnSync(process.execPath, [fileURLToPath(new URL("./delivery-state.mjs", import.meta.url)),
      "confirm", "--report", target, "--root", stateRoot, "--adapter", adapterFile, "--config", adapterConfig], { encoding: "utf8" });
    fs.writeFileSync(adapterConfig, JSON.stringify({ orchestration: { delivery: { confirmationTimeoutSec: 0.03 } } }));
    assert.equal(confirmCLI().status, 1);
    fs.writeFileSync(adapterConfig, JSON.stringify({ orchestration: { delivery: { confirmationTimeoutSec: 2 } } }));
    const confirmedCLI = confirmCLI(); assert.equal(confirmedCLI.status, 0, confirmedCLI.stderr);
    const remoteFile = path.join(root, "remote.json");
    fs.writeFileSync(adapterFile, `#!/usr/bin/env node
const fs=require('node:fs'),p=JSON.parse(fs.readFileSync(0,'utf8')),file=${JSON.stringify(remoteFile)};
const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
if(p.action==='apply'){state[p.write.id]=(state[p.write.id]||0)+1;fs.writeFileSync(file,JSON.stringify(state));}
else console.log(JSON.stringify(state[p.write.id]?{state:'present',evidence:p.write.id}:{state:'missing'}));
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
