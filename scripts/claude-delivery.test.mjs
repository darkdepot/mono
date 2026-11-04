import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { workerTransport } from "./worker-transport.mjs";
import { correlatedDeliveryReport, publishPhase, confirmQueue, waitForConfirmation, confirmationPath } from "./delivery-state.mjs";

// Event shapes come from the documented discovery. Real confirmation waits and
// collection remain the orchestrator's closeout probe. Synthetic logs below are
// separate from the recorded MONO-322 PR probe at the end of this file.
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

test('watch-phase-regress selects the current confirmation wait by publishedAt, then sequence', () => withFixture(f => {
  const now = new Date().toISOString();
  put(path.join(f.root, 'workers.json'), { [f.entry.issue]: { ...f.entry, confirmationTimeoutSec: 1800 } });
  const shipFile = path.join(f.root, 'reports', `${f.entry.issue}-phase-ship.json`);
  const code = { ...f.report, publishedAt: now, sequence: 3 };
  put(f.reportFile, code);
  f.journal(JSON.parse(JSON.stringify(f.events).replaceAll('-s1.confirmed.json', '-s3.confirmed.json')));
  for (const publishedAt of [new Date(Date.now() - 2_000_000).toISOString(), now]) {
    put(shipFile, { ...code, phase: 'ship', sequence: 2, publishedAt, capsule: { ...code.capsule, phase: 'ship' } });
    const stale = new Date(Date.now() - 181_000); fs.utimesSync(f.entry.log, stale, stale);
    const result = f.watch();
    assert.ok(!result.includes('EVENT:stall') && !result.includes('EVENT:dead'), result);
    assert.ok(result.includes('phase code sequence 3') && result.includes('phase ship sequence 2'), result);
  }
}));

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
  put(path.join(f.root, "workers.json"), { [f.entry.issue]: { ...f.entry, confirmationTimeoutSec: 1200, collectionTimeoutSec: 1000 } });
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

test("Claude monitoring reuses the read position and handles partial, replaced and truncated logs", () => withFixture(f => {
  f.journal([...f.events, ...Array.from({ length: 1000 }, () => ({ type: "tool_progress", session_id: f.entry.thread_id,
    tool_use_id: "fixture-call", elapsed_time_seconds: 30, text: "progress".repeat(100) }))]);
  assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation)?.callId, "fixture-call");
  const read = fs.readSync, whole = fs.readFileSync;
  let bytes = 0;
  fs.readSync = (...args) => { const count = read(...args); bytes += count; return count; };
  fs.readFileSync = (file, ...args) => { assert.notEqual(file, f.entry.log, "monitoring must not reread the whole journal"); return whole(file, ...args); };
  try {
    assert.equal(transport.turnState(f.entry), null);
    assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation)?.callId, "fixture-call");
    assert.ok(bytes <= 128, "unchanged monitoring reads only the cache boundary");
    const result = JSON.stringify({ type: "result", session_id: f.entry.thread_id, is_error: false });
    fs.appendFileSync(f.entry.log, result.slice(0, 40));
    assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation), null);
    fs.appendFileSync(f.entry.log, result.slice(40) + "\n");
    assert.equal(transport.turnState(f.entry)?.status, "completed");
    assert.ok(bytes < 1024, "appending a result must not rescan historical progress");
  } finally { fs.readSync = read; fs.readFileSync = whole; }
  fs.unlinkSync(f.entry.log);
  f.journal([{ ...f.instance, pid: 42 }, f.init, f.call]);
  assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation), null);
  f.journal(f.events);
  assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation)?.callId, "fixture-call");
  f.journal([f.instance]);
  assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation), null);
}));

test("Claude monitoring evicts retired journals and rebuilds their current-instance proof on reuse", () => withFixture(f => {
  assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation)?.callId, "fixture-call");
  for (let index = 0; index < 100; index++) {
    const log = path.join(f.root, "logs", `retired-${index}.jsonl`);
    fs.copyFileSync(f.entry.log, log);
    assert.equal(transport.waitingPhase({ ...f.entry, log }, f.reportFile, f.confirmation)?.callId, "fixture-call");
  }
  const read = fs.readSync; let bytes = 0;
  fs.readSync = (...args) => { const count = read(...args); bytes += count; return count; };
  try {
    assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation)?.callId, "fixture-call");
    assert.ok(bytes >= fs.statSync(f.entry.log).size, "retired log must be reloaded after eviction");
    bytes = 0;
    assert.equal(transport.waitingPhase(f.entry, f.reportFile, f.confirmation)?.callId, "fixture-call");
    assert.ok(bytes <= 128, "reused log is cached again");
  } finally { fs.readSync = read; }
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

test('Claude silent Bash calls defer stalls until every matching result arrives', () => withFixture(f => {
  put(path.join(f.root, 'workers.json'), { [f.entry.issue]: f.entry });
  const command = id => ({ ...f.call, message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command: 'node scripts/verify.mjs' } }] } });
  const result = id => ({ type: 'user', session_id: f.entry.thread_id, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] } });
  const watch = events => {
    f.journal([f.instance, f.init, ...events]);
    const quiet = new Date(Date.now() - 400_000); fs.utimesSync(f.entry.log, quiet, quiet);
    return f.watch();
  };
  assert.doesNotMatch(watch([command('one')]), /EVENT:(stall|dead)/);
  assert.doesNotMatch(watch([command('one'), command('two'), result('one')]), /EVENT:(stall|dead)/);
  assert.match(watch([command('one'), result('one')]), /EVENT:stall/);
  assert.match(watch([command('one'), { ...f.instance, pid: 42 }]), /EVENT:stall/);
  assert.match(watch([]), /EVENT:stall/);
}));

const probeRoot = new URL("./fixtures/claude-pr-replies/", import.meta.url);
const probeJson = name => JSON.parse(fs.readFileSync(new URL(name, probeRoot), "utf8"));
const probeSession = attempt => {
  const log = new URL(`attempt-${attempt}/MONO-322-mono-deliver-a${attempt}.jsonl`, probeRoot);
  const parsed = transport.readLog(log);
  assert.deepEqual(parsed.errors, []);
  const events = parsed.events.map(event => event.value);
  const instance = events.find(event => event.type === "mono.worker-instance");
  const entry = { ...probeJson(`attempt-${attempt}/launch/entry.json`), ...instance, log };
  return { entry, events };
};

test("recorded Claude PR probe preserves raw inputs and passes transport startup identity", () => {
  const manifest = probeJson("provenance.json");
  assert.equal(manifest.claudeCodeVersion, "2.1.316");
  assert.equal(manifest.packVersion, "0.42.0");
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(new URL(file.path, probeRoot));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
    if (file.sourceSha256) {
      assert.match(file.normalization, /one leading LF only/);
      assert.equal(bytes[0], 123, "journal starts with a JSON object, not an empty line");
      assert.equal(createHash("sha256").update(Buffer.concat([Buffer.from("\n"), bytes])).digest("hex"), file.sourceSha256);
    }
  }
  for (const attempt of [1, 2]) {
    const { entry, events } = probeSession(attempt), state = {};
    for (const event of events) transport.startupEvent(event, entry, state);
    assert.ok(state.response && state.procStart);
    assert.equal(state.identity.permissionMode, "dontAsk");
    const settings = probeJson(`attempt-${attempt}/launch/settings.json`);
    assert.deepEqual(settings.permissions.allow.filter(rule => rule.startsWith("Bash(")), ["Bash(gh api:*)"]);
    assert.equal(settings.sandbox.network.strictAllowlist, true);
    assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
    assert.deepEqual(settings.sandbox.network.allowedDomains, ["github.com", "api.github.com", "uploads.github.com", "raw.githubusercontent.com"]);
    const args = probeJson(`attempt-${attempt}/launch/invocation.json`).args;
    assert.equal(args[args.indexOf("--setting-sources") + 1], "");
    assert.ok(args.includes("--strict-mcp-config"));
    assert.equal(args[args.indexOf("--mcp-config") + 1], '{"mcpServers":{}}');
    const init = events.find(event => event.type === "system" && event.subtype === "init");
    assert.throws(() => transport.startupEvent({ ...init, permissionMode: "bypassPermissions" }, entry, {}), /permission mode/);
  }
});

test("recorded PR reply is submitted, resolved and independently read back; bot mention persists", () => {
  const line = probeJson("attempt-2/session-out/01-line-comment.json");
  const reply = probeJson("attempt-2/session-out/02-reply.json");
  const reread = probeJson("attempt-2/session-out/03-reply-verify.json");
  const review = probeJson("attempt-2/session-out/04-review-state.json");
  assert.equal(reply.in_reply_to_id, line.id);
  assert.equal(reread.id, reply.id);
  assert.equal(reply.pull_request_review_id, review.id);
  assert.equal(review.state, "COMMENTED");
  assert.ok(review.submitted_at);
  const before = probeJson("attempt-2/session-out/05-threads-before.json").data.repository.pullRequest.reviewThreads.nodes[0];
  const resolved = probeJson("attempt-2/session-out/06-resolve.json").data.resolveReviewThread.thread;
  const after = probeJson("attempt-2/session-out/07-threads-after.json").data.repository.pullRequest.reviewThreads.nodes[0];
  const host = probeJson("host-reread/graphql-review-threads.json").data.repository.pullRequest.reviewThreads.nodes[0];
  assert.equal(before.isResolved, false);
  for (const thread of [resolved, after, host]) {
    assert.equal(thread.id, before.id);
    assert.equal(thread.isResolved, true);
  }
  assert.equal(host.comments.nodes.find(comment => comment.databaseId === reply.id).pullRequestReview.state, "COMMENTED");
  assert.equal(probeJson("attempt-2/session-out/08-bot-comment.json").body, "@greptileai review");
  const closed = probeJson("host-reread/pull-244-after-close.json");
  assert.equal(closed.number, 244);
  assert.equal(closed.state, "closed");
  assert.equal(closed.merged, false);
  assert.equal(closed.merged_at, null);
});

// These scenarios reuse recorded startup/tool envelopes. Bare denial was not
// observed live; its command/result are synthetic and never overwrite the archive.
const probeWrite = events => events.flatMap(event => event.message?.content ?? [])
  .find(item => item.type === "tool_use" && item.name === "Bash" &&
    item.input.command.startsWith("gh api -X POST repos/darkdepot/mono/pulls/244/comments -f body="));
const deniedProbe = () => {
  const { entry, events } = probeSession(1);
  const denial = events.find(event => event.type === "system" && event.subtype === "permission_denied");
  const call = events.find(event => event.message?.content?.some(item => item.id === denial.tool_use_id));
  const result = events.find(event => event.type === "result");
  return { entry, startup: events.slice(0, events.indexOf(call)).filter(event =>
    event.type.startsWith("mono.") || event.subtype === "init"), call, denial, result };
};
const watchProbe = (f, entry, events) => {
  const log = path.join(f.root, "logs", `${entry.issue}-mono-deliver-a1.jsonl`);
  put(log, events.map(event => JSON.stringify(event)).join("\n") + "\n");
  fs.unlinkSync(f.entry.log);
  put(path.join(f.root, "workers.json"), { [entry.issue]: { ...f.entry, ...entry, log } });
  const observed = f.watch();
  assert.doesNotMatch(observed, /non-JSON contamination/);
  return observed;
};

test("worker contract links the versioned Claude PR probe archive", () => {
  const contract = fs.readFileSync(new URL("../references/worker-contract.md", import.meta.url), "utf8");
  const section = contract.split("## Claude PR probe\n")[1]?.split("\n## ")[0];
  assert.ok(section, "probe section exists");
  const manifest = probeJson("provenance.json");
  for (const value of ["scripts/fixtures/claude-pr-replies/", manifest.claudeCodeVersion, manifest.packVersion]) {
    assert.ok(section.includes(value), `probe section references ${value}`);
  }
});

test("synthetic denied bare gh api write stops with reason, never a green delivery", () => withFixture(f => {
  const { entry, startup, call, denial, result } = deniedProbe();
  const command = probeWrite(probeSession(2).events).input.command;
  assert.match(command, /^gh api -X POST /);
  assert.doesNotMatch(command, /&&|;|\||>|^cd /);
  call.message.content = call.message.content.filter(item => item.id === denial.tool_use_id);
  call.message.content[0].input.command = command;
  result.permission_denials[0].tool_input.command = command;
  result.result = "Стоп: нет права публиковать ответы. Отдельный gh api -X POST запрещён; запрос не отправлен.";
  assert.equal(denial.decision_reason_type, "mode");
  assert.equal(result.is_error, false, "CLI success is not delivery success");
  assert.match(result.result, /нет права публиковать ответы/);
  assert.doesNotMatch(result.result, /Ship: green|mono-ship green certificate/);
  assert.equal(result.permission_denials[0].tool_use_id, denial.tool_use_id);
  const observed = watchProbe(f, entry, [...startup, call, denial, result]);
  assert.match(observed, /EVENT:completed-without-report/);
  assert.doesNotMatch(observed, /EVENT:report/);
}));

test("compound denial alone is a call-form problem; the same bare write succeeds", () => {
  const { call, denial } = deniedProbe();
  const denied = call.message.content.find(item => item.id === denial.tool_use_id).input.command;
  assert.match(denied, /^cd .*&& gh api -X POST/);
  const { events } = probeSession(2), retry = probeWrite(events);
  // The second recorded session repeats the exact write, removing only shell
  // composition. Its observed success refutes the historical no-right conclusion.
  assert.equal(denied.slice(denied.indexOf("gh api"), denied.indexOf(" > ")), retry.input.command);
  const response = events.flatMap(event => event.message?.content ?? [])
    .find(item => item.type === "tool_result" && item.tool_use_id === retry.id);
  assert.ok(response && !response.is_error);
  assert.equal(probeJson("attempt-2/session-out/01-line-comment.json").body, "MONO-322 probe: line comment from claude-cli worker");
  const result = events.find(event => event.type === "result");
  assert.doesNotMatch(result.result, /нет права публиковать ответы/);
  assert.equal(probeJson("attempt-2/session-out/04-review-state.json").state, "COMMENTED");
});
