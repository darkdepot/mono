import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makePackRepo } from "../fixtures/pack.mjs";
import { BOUNDARY, IDS, NOW, at, buildWorld, unknownRecordWorld } from "../fixtures/sessions.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "session-audit.mjs");
const AUDIT_SESSION = IDS.audit;

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "session-audit-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function world(t, { personal = { runPrefixes: ["~/stands"] }, state = null } = {}) {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  const built = buildWorld(root, { repo });
  const data = path.join(root, "data");
  fs.mkdirSync(data, { recursive: true });
  if (personal) fs.writeFileSync(path.join(data, "config.json"), JSON.stringify(personal));
  if (state) fs.writeFileSync(path.join(data, "state.json"), JSON.stringify(state));
  const env = { PATH: process.env.PATH, HOME: built.home, SESSION_AUDIT_HOME: data, SESSION_AUDIT_REPO: repo };
  return { root, repo, data, env, ...built };
}

function run(env, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
  return { status: result.status, out: parse(result.stdout), err: parse(result.stderr), stdout: result.stdout, stderr: result.stderr };
}

function collectOk(env, extra = []) {
  const result = run(env, ["collect", "--session", AUDIT_SESSION, "--now", NOW, ...extra]);
  assert.equal(result.status, 0, result.stderr);
  return result.out;
}

function readMap(data, passUuid) {
  return JSON.parse(fs.readFileSync(path.join(data, "runs", passUuid, "map.json"), "utf8"));
}

function byId(map, id) {
  return map.sessions.find((session) => session.ids.includes(id));
}

function listFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child); else found.push(path.relative(dir, child));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found.sort();
}

test("collect counts every real Mono session once with product, kind, run mark, versions and links", (t) => {
  const w = world(t);
  const result = collectOk(w.env);
  const map = readMap(w.data, result.passUuid);
  const ids = map.sessions.map((session) => session.id).sort();
  assert.deepEqual(ids, [
    IDS.owner, IDS.orchestrator, IDS.readsBoth, IDS.readsNone, IDS.qaRun, IDS.worker, IDS.childWorker,
    IDS.codexOwner, IDS.codexFork, IDS.codexBatched, IDS.reviewer, `agent-${IDS.stageAgent}`,
  ].sort());

  const owner = byId(map, IDS.owner);
  assert.deepEqual(owner.ids.sort(), [IDS.owner, IDS.ownerResume].sort(), "resume file joins its session");
  assert.equal(owner.files.length, 2);
  assert.equal(owner.product, "alpha");
  assert.equal(owner.kind, "owner");
  assert.equal(owner.run.marked, false);
  assert.equal(owner.loads.length, 1, "quoted load lines and tool outputs are not loads");
  assert.deepEqual(owner.loads[0].version, { status: "confirmed", tags: ["v0.1.0"], range: "v0.1.0" }, "cache path says 0.2.0, the text is 0.1.0");
  assert.equal(owner.linkStatus, "none");

  const orchestrator = byId(map, IDS.orchestrator);
  assert.equal(orchestrator.kind, "orchestrator");
  assert.deepEqual(orchestrator.loads[0].version.tags, ["v0.2.0"], "the guide read leaves only the matching tag");

  assert.deepEqual(byId(map, IDS.readsBoth).loads[0].version, { status: "confirmed", tags: ["v0.1.0", "v0.2.0"], range: "v0.1.0..v0.2.0" });
  assert.deepEqual(byId(map, IDS.readsNone).loads[0].version, { status: "unconfirmed", pathHint: null });

  const agent = byId(map, `agent-${IDS.stageAgent}`);
  assert.equal(agent.kind, "stage-agent");
  assert.deepEqual(agent.links.parent, { id: IDS.orchestrator, via: "subagent-meta" });
  assert.deepEqual(agent.links.stages, ["implement"]);

  const qa = byId(map, IDS.qaRun);
  assert.equal(qa.kind, "worker");
  assert.equal(qa.profile, ".claude-second");
  assert.equal(qa.run.marked, true);
  assert.deepEqual(qa.run.reasons.sort(), ["prefix:~/stands", "qa-load"]);

  const worker = byId(map, IDS.worker);
  assert.equal(worker.kind, "worker");
  assert.deepEqual(worker.links.orchestrator, { product: "alpha", via: "alpha/ledger.md" });
  assert.equal(worker.links.task, "ALPHA-12");
  assert.equal(worker.product, "alpha");
  assert.equal(worker.loads[0].version.range, "v0.2.0", "a cat inside a batched JSON output narrows; rg -n does not");

  const child = byId(map, IDS.childWorker);
  assert.deepEqual(child.links.parent, { id: IDS.owner, via: "parent-output" });
  assert.equal(child.loads[0].partial, true);
  assert.deepEqual(child.loads[0].version.tags, ["v0.1.0"], "a partial read gives the tags its lines fit");

  const reviewer = byId(map, IDS.reviewer);
  assert.equal(reviewer.kind, "review");
  assert.equal(reviewer.linkStatus, "none");
  assert.equal(reviewer.links.orchestrator, null);
  assert.deepEqual(reviewer.loads.map((load) => [load.partial, load.version.range]), [[false, "v0.2.0"], [true, "v0.2.0"]], "sed by pattern is a partial read");

  const batched = byId(map, IDS.codexBatched);
  assert.equal(batched.loads[0].skill, "orchestrate", "interpolated path found by its lines");
  assert.equal(batched.loads[0].partial, true);

  const fork = byId(map, IDS.codexFork);
  assert.equal(fork.newEvents, 2, "copies of the parent are not new");
  assert.equal(fork.forkCopiesSkipped, 4);
  assert.deepEqual(fork.links.parent, { id: IDS.codexOwner, via: "codex-fork" });

  assert.equal(map.counters.excluded.audit, 2, "audit session and its subagent");
  assert.equal(map.counters.excluded.noMonoLoad, 3, "foreign skill, no load, short reads");
  for (const id of [IDS.audit, IDS.foreign, IDS.noLoad, IDS.shortReads, `agent-${IDS.auditAgent}`]) {
    assert.equal(byId(map, id), undefined, `${id} must not be in the map`);
  }
});

test("map.json fields are fixed for the next task", (t) => {
  const w = world(t);
  const result = collectOk(w.env);
  const map = readMap(w.data, result.passUuid);
  assert.deepEqual(Object.keys(map).sort(), ["counters", "passUuid", "queueLength", "schema", "sessions", "sources", "startedAt", "tags", "window"].sort());
  assert.deepEqual(Object.keys(map.window).sort(), ["end", "start"]);
  assert.deepEqual(Object.keys(map.sessions[0]).sort(), [
    "cwd", "files", "firstNewEvent", "forkCopiesSkipped", "forkedFrom", "host", "id", "ids", "kind", "lastNewEvent",
    "linkStatus", "links", "loads", "newEvents", "product", "profile", "run",
  ].sort());
  assert.deepEqual(Object.keys(map.sessions[0].links).sort(), ["orchestrator", "parent", "stages", "task"]);
  assert.deepEqual(Object.keys(map.sessions[0].loads[0]).sort(), ["at", "partial", "path", "skill", "version"]);
  assert.deepEqual(Object.keys(map.counters).sort(), ["byHost", "byKind", "byProduct", "byVersion", "excluded", "newEvents", "sessions", "sources"].sort());
  assert.deepEqual(Object.keys(map.sources).sort(), ["ledger", "reports"]);

  assert.equal(map.sources.ledger.length, 2, "two ledger lines in the window, the old one outside");
  assert.ok(map.sources.ledger.every((line) => line.path.endsWith(path.join("alpha", "ledger.md")) && Number.isInteger(line.line)));
  assert.deepEqual(map.sources.reports.map((report) => [report.kind, path.basename(report.path)]), [["phase-report", "ALPHA-12-implementation.json"]], "archive and old receipts are skipped");
  assert.equal(map.counters.byProduct.alpha, 10);
  assert.deepEqual(map.counters.byKind, { owner: 5, review: 2, orchestrator: 2, "stage-agent": 1, worker: 2 });
  assert.deepEqual(map.counters.byVersion, { "v0.1.0": 2, "v0.2.0": 5, "v0.1.0..v0.2.0": 4, unconfirmed: 1 });
  assert.equal(map.counters.byVersion.unconfirmed, 1);
  assert.equal(map.counters.sources.ledger, 2);
});

test("AE1: after the previous boundary only new events count, resume copies are not new", (t) => {
  const w = world(t, { state: { boundary: BOUNDARY, pending: null } });
  const result = collectOk(w.env);
  assert.deepEqual(result.window, { start: BOUNDARY, end: NOW });
  const owner = byId(readMap(w.data, result.passUuid), IDS.owner);
  // After the boundary: 13 owner events plus 2 new events of the resume file.
  assert.equal(owner.newEvents, 15);
  assert.equal(owner.firstNewEvent.ts, at(BOUNDARY, 30));

  const extract = run(w.env, ["extract", IDS.owner, "--session", AUDIT_SESSION]);
  assert.equal(extract.status, 0, extract.stderr);
  assert.equal(extract.out.chunks.length, 1);
  const text = fs.readFileSync(extract.out.chunks[0].file, "utf8");
  const [context, events] = text.split("## events");
  assert.ok(!events.includes("Reading the page before the boundary"), "read before the boundary");
  assert.ok(context.includes("review v0.1.0"), "context carries the last stage load");
  assert.ok(context.includes("Start the review of the invented page."), "context carries earlier owner words");
  assert.equal((events.match(/Continuing after the boundary\./g) || []).length, 1, "resume copy is not repeated");
  assert.ok(events.includes("Resumed: finish page two."));

  const first = run({ ...w.env, SESSION_AUDIT_HOME: path.join(w.root, "data-first") }, ["collect", "--session", AUDIT_SESSION, "--now", NOW]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.out.window.start, "2026-11-18T12:00:00.000Z", "first pass covers 7 days");
  assert.equal(byId(readMap(path.join(w.root, "data-first"), first.out.passUuid), IDS.owner).newEvents, 18);
});

test("extract gives the U5 digest: owner words, questions, ops by name, second model output capped", (t) => {
  const w = world(t);
  const passUuid = collectOk(w.env).passUuid;
  const result = run(w.env, ["extract", IDS.owner, "--session", AUDIT_SESSION]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.out.passUuid, passUuid);
  const text = fs.readFileSync(result.out.chunks[0].file, "utf8");
  assert.ok(text.includes("owner: Please continue. Earlier it said: Base directory for this skill"), "owner words verbatim");
  assert.ok(text.includes("Which page next? [options: Page two; Page three]"));
  assert.ok(text.includes("answer (answered): {\"Which page next?\":\"Page two\"}"));
  assert.ok(text.includes("answer (no-answer-sent-message)"));
  assert.ok(text.includes("op: plan: TodoWrite"));
  assert.ok(!text.includes("secret plan text"), "plan content stays out");
  assert.ok(!text.includes("grep -r"), "other tool calls stay out");
  assert.ok(!text.includes("background job done"), "notifications stay out");
  assert.ok(text.includes("second-model: codex exec --skip-git-repo-check 'review page two'"));
  assert.ok(text.includes("child says: page two is fine"));
  assert.ok(text.includes("[… cut at 20480 bytes"), "second model output capped at 20 KB");
  assert.ok(text.includes("load: review v0.1.0"));

  const codex = run(w.env, ["extract", IDS.codexBatched, "--session", AUDIT_SESSION]);
  assert.equal(codex.status, 0, codex.stderr);
  const codexText = fs.readFileSync(codex.out.chunks[0].file, "utf8");
  assert.ok(codexText.includes("question: Which plan?\n  answer (answered): The short one"));
  assert.ok(codexText.includes("load: orchestrate v0.1.0..v0.2.0"));

  const fork = run(w.env, ["extract", IDS.codexFork, "--session", AUDIT_SESSION]);
  const forkText = fs.readFileSync(fork.out.chunks[0].file, "utf8").split("## events")[1];
  assert.ok(forkText.includes("In the fork: try another wording."));
  assert.ok(!forkText.includes("Review page four."), "fork copies are not new");

  const range = run(w.env, ["extract", IDS.owner, "--session", AUDIT_SESSION, "--from", at(BOUNDARY, 38), "--to", at(BOUNDARY, 39)]);
  assert.equal(range.status, 0, range.stderr);
  const rangeText = fs.readFileSync(range.out.chunks[0].file, "utf8").split("## events")[1];
  assert.ok(rangeText.includes("Ship it?"));
  assert.ok(!rangeText.includes("Which page next?"), "an explicit range from the queue limits the digest");
});

test("extract splits a long session by stage loads with a 200 KB cap and 20 KB context", (t) => {
  const w = world(t);
  const long = "y".repeat(60_000);
  const file = path.join(w.projectDir, `${IDS.readsBoth}.jsonl`);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const template = lines[0];
  const extra = [];
  let minute = 110;
  const record = (fields) => ({ ...template, uuid: `f0000000-0000-4000-8000-${String(minute).padStart(12, "0")}`, timestamp: at(BOUNDARY, minute++), ...fields });
  for (let i = 0; i < 3; i += 1) extra.push(record({ type: "user", isMeta: undefined, message: { role: "user", content: `owner note ${i} ${"z".repeat(9000)}` } }));
  for (let i = 0; i < 5; i += 1) extra.push(record({ type: "assistant", message: { id: `msg_long_${i}`, role: "assistant", content: [{ type: "text", text: long }] } }));
  extra.push(record({ ...template, isMeta: true, message: template.message }));
  for (let i = 0; i < 2; i += 1) extra.push(record({ type: "assistant", message: { id: `msg_long_b${i}`, role: "assistant", content: [{ type: "text", text: long }] } }));
  fs.appendFileSync(file, extra.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  fs.utimesSync(file, new Date(NOW), new Date(NOW));
  collectOk(w.env);
  const result = run(w.env, ["extract", IDS.readsBoth, "--session", AUDIT_SESSION]);
  assert.equal(result.status, 0, result.stderr);
  const chunks = result.out.chunks;
  assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.bytes <= 204800, `chunk ${chunk.bytes} bytes`);
    assert.ok(chunk.contextBytes <= 20480 + 64, `context ${chunk.contextBytes} bytes`);
  }
  const last = fs.readFileSync(chunks.at(-1).file, "utf8");
  assert.ok(last.split("## events")[0].includes("load: implement"), "a later chunk starts with its stage load in context");
});

test("an unfinished pass: same session resumes it, another session stops, the owner's words hand it over", (t) => {
  const w = world(t);
  const first = collectOk(w.env);
  const again = collectOk(w.env);
  assert.equal(again.passUuid, first.passUuid);
  assert.equal(again.resumed, true);
  assert.deepEqual(again.window, first.window);

  // The holder's file shows its last event 30 minutes before now.
  const holderFile = path.join(w.projectDir, `${AUDIT_SESSION}.jsonl`);
  const lines = fs.readFileSync(holderFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  lines.push({ ...lines.at(-1), uuid: "f1000000-0000-4000-8000-000000000001", timestamp: at(NOW, -30) });
  fs.writeFileSync(holderFile, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

  const other = "88888888-1111-4111-8111-111111111111";
  const stopped = run(w.env, ["collect", "--session", other, "--now", NOW]);
  assert.equal(stopped.status, 3);
  assert.equal(stopped.err.passUuid, first.passUuid);
  assert.equal(stopped.err.holderSession, AUDIT_SESSION);
  assert.equal(stopped.err.silentMinutes, 30);

  const refused = run(w.env, ["extract", IDS.owner, "--session", other]);
  assert.equal(refused.status, 3, "a session that does not hold the pass is refused");
  assert.match(refused.err.error, /not the owner/);

  const taken = run(w.env, ["collect", "--session", other, "--now", NOW, "--take-over"]);
  assert.equal(taken.status, 0, taken.stderr);
  assert.equal(taken.out.passUuid, first.passUuid);
  const state = JSON.parse(fs.readFileSync(path.join(w.data, "state.json"), "utf8"));
  assert.equal(state.pending.sessionId, other);
  assert.equal(state.pending.takenOverFrom, AUDIT_SESSION);
  const log = fs.readFileSync(path.join(w.data, "runs", first.passUuid, "log"), "utf8");
  assert.match(log, new RegExp(`takeover from ${AUDIT_SESSION} by ${other}`));
  const formerOwner = run(w.env, ["extract", IDS.owner, "--session", AUDIT_SESSION]);
  assert.equal(formerOwner.status, 3, "the former holder is now refused");
});

test("no new events and an empty queue: nothing is written", (t) => {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const data = path.join(root, "data");
  const env = { PATH: process.env.PATH, HOME: home, SESSION_AUDIT_HOME: data, SESSION_AUDIT_REPO: repo };
  const result = run(env, ["collect", "--session", AUDIT_SESSION, "--now", NOW]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.out.nothingNew, true);
  assert.deepEqual(listFiles(data), []);
});

test("an unknown record stops collect loudly with file and line", (t) => {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  const { home, file } = unknownRecordWorld(root);
  const env = { PATH: process.env.PATH, HOME: home, SESSION_AUDIT_HOME: path.join(root, "data"), SESSION_AUDIT_REPO: repo };
  const result = run(env, ["collect", "--session", AUDIT_SESSION, "--now", NOW]);
  assert.equal(result.status, 2);
  assert.match(result.err.error, /unknown session records \(1\)/);
  assert.deepEqual(result.err.problems, [`${file}:2: unknown Claude record type "mystery-record"`]);
  assert.deepEqual(listFiles(path.join(root, "data")), []);
});

test("the data root may not sit in a git checkout, the mono repo or a pack install, even through a symlink", (t) => {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  const checkout = path.join(root, "some-checkout");
  fs.mkdirSync(path.join(checkout, ".git"), { recursive: true });
  fs.symlinkSync(path.join(checkout, "inner"), path.join(root, "link-to-checkout"));
  const cases = [
    [path.join(checkout, "audit"), /inside a git checkout/],
    [path.join(root, "link-to-checkout", "audit"), /inside a git checkout/],
    [path.join(repo, "data"), /inside the mono repository|inside a git checkout/],
    [path.join(home, ".claude", "plugins", "audit"), /inside a pack install directory/],
  ];
  for (const [dataRoot, reason] of cases) {
    const env = { PATH: process.env.PATH, HOME: home, SESSION_AUDIT_HOME: dataRoot, SESSION_AUDIT_REPO: repo };
    const result = run(env, ["collect", "--session", AUDIT_SESSION, "--now", NOW]);
    assert.equal(result.status, 2, dataRoot);
    assert.match(result.err.error, /data root refused/);
    assert.ok(result.err.reasons.some((text) => reason.test(text)), `${dataRoot}: ${result.err.reasons}`);
    assert.equal(fs.existsSync(path.join(dataRoot, "state.json")), false);
  }
});

test("collect only reads session files and the pack", (t) => {
  const w = world(t);
  const snapshot = (files) => files.map((file) => [file, fs.readFileSync(file, "utf8"), fs.statSync(file).mtimeMs]);
  const before = snapshot(w.files);
  const packBefore = listFiles(w.clone);
  collectOk(w.env);
  run(w.env, ["extract", IDS.owner, "--session", AUDIT_SESSION]);
  assert.deepEqual(snapshot(w.files), before);
  assert.deepEqual(listFiles(w.clone), packBefore);
  const written = listFiles(w.data).filter((file) => file !== "config.json");
  assert.ok(written.length > 0 && written.every((file) => file === "state.json" || file.startsWith("runs/")), written.join(", "));
});

test("cost adds a session and its subagents once per message id; a pass is found by its uuid", (t) => {
  const w = world(t);
  const id = IDS.orchestrator;
  const usage = { input_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 5, output_tokens: 7 };
  const file = path.join(w.projectDir, `${id}.jsonl`);
  const template = JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]);
  const say = (uuid, msgId, use) => ({ ...template, type: "assistant", uuid, isMeta: undefined, message: { id: msgId, role: "assistant", content: [{ type: "text", text: "t" }], usage: use } });
  const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  fs.appendFileSync(file, [say("c1", "msg_cost_a", usage), say("c2", "msg_cost_a", usage), say("c3", "msg_cost_a", zero), say("c4", "msg_cost_b", usage)].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const result = run(w.env, ["cost", id]);
  assert.equal(result.status, 0, result.stderr);
  // Messages of the file: 2 tool uses (1 each in and out), the subagent's say,
  // and the two cost messages above.
  assert.deepEqual(result.out.sessions, [id]);
  assert.equal(result.out.files.length, 2, "session and its subagent");
  assert.equal(result.out.messages, 5);
  const agentUsage = { input: 10 + 100 + 1000, cacheRead: 1000, output: 50 };
  const expectedInput = 2 * 1 + 2 * (2 + 3 + 5) + agentUsage.input;
  const expectedOutput = 2 * 1 + 2 * 7 + agentUsage.output;
  assert.equal(result.out.usage.input_tokens, expectedInput);
  assert.equal(result.out.usage.output_tokens, expectedOutput);
  assert.equal(result.out.tokens, expectedInput + expectedOutput);
  assert.equal(result.out.cacheReadTokens, 2 * 5 + agentUsage.cacheRead);

  const passUuid = collectOk(w.env).passUuid;
  const auditFile = path.join(w.projectDir, `${AUDIT_SESSION}.jsonl`);
  const auditTemplate = JSON.parse(fs.readFileSync(auditFile, "utf8").split("\n")[0]);
  fs.appendFileSync(auditFile, `${JSON.stringify({ ...auditTemplate, type: "user", uuid: "c9", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: `passUuid ${passUuid}` }] } })}\n`);
  const later = new Date(Date.parse(NOW) + 60000);
  fs.utimesSync(auditFile, later, later);
  const pass = run(w.env, ["cost", "--pass", passUuid]);
  assert.equal(pass.status, 0, pass.stderr);
  assert.deepEqual(pass.out.sessions, [AUDIT_SESSION]);
  assert.equal(pass.out.files.length, 2, "the pass session and its subagent");
  assert.equal(pass.out.messages, 2, "the pass session's say and its subagent's say");
});
