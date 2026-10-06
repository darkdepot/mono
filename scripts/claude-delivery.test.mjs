import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { workerTransport } from "./worker-transport.mjs";
import { correlatedDeliveryReport, publishPhase, confirmQueue, waitForConfirmation, confirmationPath } from "./delivery-state.mjs";

// Event shapes come from the documented discovery. Real confirmation waits and
// collection remain the orchestrator's closeout probe; these are synthetic logs.
// No model is invoked. Every executable fixture uses a private, closed PATH.
const transport = workerTransport("claude-cli");
const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};
const withFixture = async run => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-claude-delivery-"));
  try {
    const issue = "MONO-999", log = path.join(root, "logs", `${issue}-mono-deliver-a1.jsonl`);
    const entry = { issue, stage: "mono-deliver", transport: "claude-cli", attempt: 1, log,
      packVersion: "test", sourceCommit: "a".repeat(40), surfaceRevision: 4,
      packRoot: "/fixture/pack",
      worktree: path.join(root, "repo"), thread_id: "fixture-session", pid: process.pid, procStart: "fixture-start" };
    const reportFile = path.join(root, "reports", `${issue}-phase-code.json`);
    const report = { ...entry, phase: "code", head: "b".repeat(40), sequence: 1, kind: "phase",
      status: "implemented-needs-preflight", linear_mutations_pending: [],
      capsule: { phase: "code", head: "b".repeat(40), decisions: [], open_queue: [], writable_roots: [path.dirname(reportFile), entry.worktree] } };
    const confirmation = confirmationPath(report, root);
    const instance = { type: "mono.worker-instance", issue, attempt: 1, thread_id: entry.thread_id, pid: entry.pid, procStart: entry.procStart };
    const init = { type: "system", subtype: "init", session_id: entry.thread_id, model: "fixture-model" };
    const call = { type: "assistant", session_id: entry.thread_id, message: { content: [{ type: "tool_use", id: "fixture-call", name: "Bash",
      input: { command: `node '/fixture/pack/scripts/delivery-state.mjs' wait --report '${reportFile}' --confirmation '${confirmation}' --config '/fixture/config.json'` } }] } };
    const events = [instance, init, call];
    const journal = values => put(log, values.map(value => JSON.stringify(value)).join("\n") + "\n");
    const bin = path.join(root, "bin");
    put(path.join(bin, "ps"), '#!/usr/bin/env node\nconsole.log("fixture-start");\n');
    fs.chmodSync(path.join(bin, "ps"), 0o700);
    fs.symlinkSync(process.execPath, path.join(bin, "node"));
    put(path.join(root, "control.json"), { state: "active" });
    const env = { ...process.env, PATH: bin };
    const watch = () => execFileSync(process.execPath, ["scripts/watch-workers.mjs", "--root", root, "--once"], { env, encoding: "utf8" });
    journal(events);
    await run({ root, entry, report, reportFile, confirmation, instance, init, call, events, journal, watch, env });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
};

test("Claude foreground phase wait binds session, attempt, process instance and call ID", () => withFixture(f => {
  assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation)?.callId, "fixture-call");
  for (const change of [{ thread_id: "other" }, { attempt: 2 }, { pid: 42 }, { procStart: "other" }]) {
    assert.equal(transport.waitingPhase({ ...f.entry, ...change }, f.reportFile, f.confirmation), null);
  }
  for (const ending of [
    { type: "user", session_id: f.entry.thread_id, message: { content: [{ type: "tool_result", tool_use_id: "fixture-call", content: "released" }] } },
    { type: "system", subtype: "permission_denied", session_id: f.entry.thread_id, tool_use_id: "fixture-call" },
    { type: "result", session_id: f.entry.thread_id, is_error: false },
    { ...f.instance, pid: 42, procStart: "old-process" },
  ]) {
    f.journal([...f.events, ending]);
    assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation), null);
  }
  f.journal([f.instance, f.init, { ...f.call, session_id: "other" }]);
  assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation), null);
  f.journal([f.instance, f.init, { ...f.call, message: { content: [{ ...f.call.message.content[0], input: { command: f.call.message.content[0].input.command + " &" } }] } }]);
  assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation), null);
  for (const input of [{ ...f.call.message.content[0].input, run_in_background: true },
    { command: f.call.message.content[0].input.command.replace("/fixture/pack/", "/foreign/pack/") }]) {
    f.journal([f.instance, f.init, { ...f.call, message: { content: [{ ...f.call.message.content[0], input }] } }]);
    assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation), null);
  }
}));

test("Claude watcher recognizes bounded foreground waits, expiry, progress and completion without report", () => withFixture(f => {
  const report = publishPhase(f.report, f.reportFile);
  put(path.join(f.root, "workers.json"), { [f.entry.issue]: { ...f.entry, confirmationTimeoutSec: 1200 } });
  const silence = () => { const past = new Date(Date.now() - 150_000); fs.utimesSync(f.entry.log, past, past); };
  silence();
  assert.doesNotMatch(f.watch(), /EVENT:(stall|dead)/);
  f.journal([...f.events, { ...f.instance, pid: 42 }]); silence();
  assert.match(f.watch(), /EVENT:stall/);
  f.journal(f.events); silence();
  put(f.reportFile, { ...report, publishedAt: new Date(Date.now() - 1_300_000).toISOString() });
  assert.match(f.watch(), /EVENT:stall/);
  f.journal([...f.events, { type: "tool_progress", session_id: f.entry.thread_id, tool_use_id: "fixture-call", elapsed_time_seconds: 30 }]);
  assert.doesNotMatch(f.watch(), /EVENT:(stall|dead)/);
  fs.unlinkSync(f.reportFile);
  f.journal([...f.events, { type: "result", session_id: f.entry.thread_id, is_error: false }]);
  assert.match(f.watch(), /EVENT:completed-without-report/);
  f.journal([...f.events, { type: "result", session_id: f.entry.thread_id, is_error: true }]);
  assert.match(f.watch(), /EVENT:failed/);
}));

test("historical malformed output does not invalidate current-instance wait or completion", () => withFixture(f => {
  const values = [{ ...f.instance, pid: 42 }, f.init];
  f.journal(values);
  fs.appendFileSync(f.entry.log, 'historical incomplete output\n' + f.events.map(event => JSON.stringify(event)).join("\n") + "\n");
  assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation)?.callId, "fixture-call");
  fs.appendFileSync(f.entry.log, JSON.stringify({ type: "result", session_id: f.entry.thread_id, is_error: false }) + "\n");
  assert.equal(transport.turnState(f.entry)?.status, "completed");
  fs.appendFileSync(f.entry.log, 'current incomplete output\n');
  assert.equal(transport.turnState(f.entry), null);
}));

test("Claude terminal report correlation rejects foreign attempt and pack", () => withFixture(f => {
  const file = path.join(f.root, "reports", `${f.entry.issue}-mono-deliver.json`);
  const report = { ...f.report, status: "parked", reason: "blocked", text: "fixture stop" };
  put(file, report);
  const stat = fs.statSync(file), logStat = fs.statSync(f.entry.log);
  assert.equal(correlatedDeliveryReport(report, stat, f.entry, logStat), true);
  for (const change of [{ attempt: 2 }, { issue: "MONO-998" }, { packVersion: "foreign" }, { status: "ready" }])
    assert.equal(correlatedDeliveryReport({ ...report, ...change }, stat, f.entry, logStat), false);
  put(path.join(f.root, "workers.json"), { [f.entry.issue]: f.entry });
  assert.match(f.watch(), /EVENT:report/);
  assert.doesNotMatch(f.watch(), /EVENT:completed-without-report/);
}));

test("phase wait releases only whole confirmation, rejects stale/partial, expires and does not duplicate writes", () => withFixture(async f => {
  const queue = [{ id: "start", operation: "comment", target: f.entry.issue, payload: "fixture" }];
  const report = publishPhase({ ...f.report, linear_mutations_pending: queue, capsule: { ...f.report.capsule, open_queue: queue } }, f.reportFile);
  let applied = false, writes = 0;
  const adapter = async action => action === "apply" ? (applied = true, writes++, undefined)
    : applied ? { state: "present", evidence: "fixture-readback" } : { state: "missing" };
  const waiting = waitForConfirmation(report, f.confirmation, 2, 0.01);
  await confirmQueue(report, f.root, adapter);
  await waiting;
  await confirmQueue(report, f.root, adapter);
  assert.equal(writes, 1);
  const ack = JSON.parse(fs.readFileSync(f.confirmation));
  for (const change of [{ sequence: 2 }, { results: [] }, { attempt: 2 }]) {
    put(f.confirmation, { ...ack, ...change });
    await assert.rejects(waitForConfirmation(report, f.confirmation, 1), /confirmation/);
  }
  fs.unlinkSync(f.confirmation);
  await assert.rejects(waitForConfirmation({ ...report, publishedAt: new Date(Date.now() - 2000).toISOString() }, f.confirmation, 1), /write-unconfirmed/);
}));

test("Claude result usage sums resumed turns, normalizes caches and keeps missing/interrupted data incomplete", () => withFixture(f => {
  const result = { type: "result", session_id: f.entry.thread_id, is_error: false,
    usage: { input_tokens: 10, cache_creation_input_tokens: 3, cache_read_input_tokens: 7, output_tokens: 5 } };
  const measure = values => { f.journal(values); return transport.attemptUsage(transport.readLog(f.entry.log), "fixture"); };
  const complete = measure([...f.events, result, { ...f.instance, pid: 42 }, f.init, result]);
  assert.equal(complete.status, "measured");
  assert.equal(complete.turns, 2);
  assert.equal(complete.usage.input_tokens, 40);
  assert.equal(complete.usage.cached_input_tokens, 14);
  assert.equal(complete.usage.cache_write_input_tokens, 6);
  assert.equal(complete.usage.non_overlapping_total_tokens, 50);
  assert.match(measure([]).status, /^unavailable:/);
  assert.match(measure(f.events).status, /^incomplete:/);
  assert.match(measure([...f.events, result, { ...f.instance, pid: 42 }]).status, /^incomplete:/);
  assert.match(measure([...f.events, { ...f.instance, pid: 42 }, f.init, result]).status, /^incomplete:/);
  assert.match(measure([f.init, { ...result, usage: undefined }]).status, /^unavailable:/);
  // Documented crash results can zero usage after tokens were consumed. This
  // fixture is a contract case, not an observed live crash in discovery.
  const crash = { ...result, subtype: "error_during_execution", is_error: true,
    usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } };
  const crashed = measure([...f.events, crash]);
  assert.match(crashed.status, /^incomplete:/);
  assert.equal(crashed.usage, null);
  const recovered = measure([...f.events, result, { ...f.instance, pid: 42 }, f.init, crash,
    { ...f.instance, pid: 43 }, f.init, result]);
  assert.match(recovered.status, /^incomplete:/);
  assert.equal(recovered.complete, false);
  assert.equal(recovered.usage.input_tokens, 40);
  assert.match(measure([...f.events, { ...result, subtype: "error_max_budget_usd", is_error: true }]).status, /^incomplete:/);
  f.journal([{ type: "mono.launch", model_launch: { case: "claude-cli" } }, ...f.events, result]);
  const output = execFileSync(process.execPath, ["scripts/wave-cost.mjs", f.entry.issue, "--root", f.root], { env: f.env, encoding: "utf8" });
  const wave = JSON.parse(output.slice(0, output.lastIndexOf("\nЦена волны")));
  assert.equal(wave.worker.usage.input_tokens, 20);
  assert.equal(wave.worker.usage_status, "measured");
}));
