// Review findings on the first version, one test each.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { EDGE, LONG_OWNER, buildEdgeWorld } from "../fixtures/edge.mjs";
import { makePackRepo } from "../fixtures/pack.mjs";
import { BOUNDARY, IDS, NOW, at, buildWorld } from "../fixtures/sessions.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "session-audit.mjs");
const AUDITOR = "b0000000-1111-4111-8111-111111111111";

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "session-audit-edge-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setupWorld(t, build, { state = null } = {}) {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  const built = build(root, { repo });
  const data = path.join(root, "data");
  fs.mkdirSync(data, { recursive: true });
  if (state) fs.writeFileSync(path.join(data, "state.json"), JSON.stringify(typeof state === "function" ? state(built) : state));
  const env = { PATH: process.env.PATH, HOME: built.home, SESSION_AUDIT_HOME: data, SESSION_AUDIT_REPO: repo };
  return { root, repo, data, env, ...built };
}

function run(env, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
  return { status: result.status, out: parse(result.stdout), err: parse(result.stderr), stderr: result.stderr };
}

function runAsync(env, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function collect(w, session = AUDITOR) {
  const result = run(w.env, ["collect", "--session", session, "--now", NOW]);
  assert.equal(result.status, 0, result.stderr);
  return { ...result.out, mapData: JSON.parse(fs.readFileSync(result.out.map, "utf8")) };
}

const byId = (map, id) => map.sessions.find((session) => session.ids.includes(id));
const extractText = (w, id, session = AUDITOR) => {
  const result = run(w.env, ["extract", id, "--session", session]);
  assert.equal(result.status, 0, result.stderr);
  return result.out.chunks.map((chunk) => fs.readFileSync(chunk.file, "utf8"));
};
const eventsOnly = (texts) => texts.map((text) => text.split("## events")[1]).join("");

test("ids with path syntax are refused before any path is built", (t) => {
  const w = setupWorld(t, buildWorld);
  for (const args of [
    ["collect", "--session", "../escape", "--now", NOW],
    ["extract", "../../outside", "--session", AUDITOR],
    ["extract", IDS.owner, "--session", "a/b"],
    ["cost", "../x"],
  ]) {
    const result = run(w.env, args);
    assert.equal(result.status, 2, args.join(" "));
    assert.match(result.err.error, /not a safe id/);
  }
  assert.deepEqual(fs.readdirSync(w.data), []);
});

test("a symlink inside the data root is never written through or deleted through", (t) => {
  const w = setupWorld(t, buildWorld);
  const pass = collect(w).passUuid;
  const outside = path.join(w.root, "outside");
  fs.mkdirSync(path.join(outside, IDS.owner), { recursive: true });
  fs.writeFileSync(path.join(outside, IDS.owner, "keep.txt"), "keep");
  fs.symlinkSync(outside, path.join(w.data, "runs", pass, "extract"));
  const result = run(w.env, ["extract", IDS.owner, "--session", AUDITOR]);
  assert.equal(result.status, 2);
  assert.match(result.err.error, /not a plain directory/);
  assert.equal(fs.readFileSync(path.join(outside, IDS.owner, "keep.txt"), "utf8"), "keep");
});

test("two collectors at once create one pass; a live lock refuses, a dead one is taken", async (t) => {
  const w = setupWorld(t, buildWorld);
  const other = "b0000000-2222-4111-8111-111111111111";
  const [first, second] = await Promise.all([
    runAsync(w.env, ["collect", "--session", AUDITOR, "--now", NOW]),
    runAsync(w.env, ["collect", "--session", other, "--now", NOW]),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [0, 3], `${first.stderr}\n${second.stderr}`);
  const winner = first.status === 0 ? AUDITOR : other;
  const state = JSON.parse(fs.readFileSync(path.join(w.data, "state.json"), "utf8"));
  assert.equal(state.pending.sessionId, winner);
  assert.equal(fs.readdirSync(path.join(w.data, "runs")).length, 1, "one pass only");
  assert.equal(fs.existsSync(path.join(w.data, "lock")), false, "lock released");

  fs.writeFileSync(path.join(w.data, "lock"), JSON.stringify({ pid: process.pid, sessionId: "someone" }));
  const locked = run(w.env, ["collect", "--session", winner, "--now", NOW]);
  assert.equal(locked.status, 3);
  assert.equal(locked.err.holderPid, process.pid);

  const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid;
  fs.writeFileSync(path.join(w.data, "lock"), JSON.stringify({ pid: dead, sessionId: "gone" }));
  const taken = run(w.env, ["collect", "--session", winner, "--now", NOW]);
  assert.equal(taken.status, 0, taken.stderr);
});

test("a case alias of a pack install directory is refused", (t) => {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  if (!fs.existsSync(path.join(home, ".CLAUDE", "plugins"))) {
    t.skip("file system is case-sensitive");
    return;
  }
  const env = { PATH: process.env.PATH, HOME: home, SESSION_AUDIT_HOME: path.join(home, ".CLAUDE", "plugins", "audit"), SESSION_AUDIT_REPO: repo };
  const result = run(env, ["collect", "--session", AUDITOR, "--now", NOW]);
  assert.equal(result.status, 2);
  assert.ok(result.err.reasons.some((reason) => /pack install directory/.test(reason)), result.stderr);
});

test("repeated Codex items without ids stay separate events", (t) => {
  const w = setupWorld(t, buildEdgeWorld, { state: { boundary: BOUNDARY, pending: null } });
  const map = collect(w).mapData;
  const repeat = byId(map, EDGE.repeat);
  assert.equal(repeat.newEvents, 1, "the later «continue» is new");
  const text = eventsOnly(extractText(w, EDGE.repeat));
  assert.equal((text.match(/owner: continue/g) || []).length, 1);
});

test("answers and outputs after the boundary are new; open questions show as unanswered", (t) => {
  const w = setupWorld(t, buildEdgeWorld, { state: { boundary: BOUNDARY, pending: null } });
  collect(w);
  const texts = extractText(w, EDGE.questions);
  const events = eventsOnly(texts);
  assert.ok(events.includes(`[${at(BOUNDARY, 5)}] answer: Keep the old title? [options: Keep; Change]\n  answer (answered): {"Keep the old title?":"Change"}`));
  assert.ok(events.includes("question: Publish now? [options: Yes; Later]\n  status: unanswered"));
  assert.ok(events.includes(`[${at(BOUNDARY, 7)}] second-model: claude -p 'second look'`));
  assert.ok(events.includes("second look: fine"));
});

test("an entry above 200 KB continues over chunks without losing text", (t) => {
  const w = setupWorld(t, buildEdgeWorld, { state: { boundary: BOUNDARY, pending: null } });
  collect(w);
  const result = run(w.env, ["extract", EDGE.questions, "--session", AUDITOR]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.out.chunks.length >= 2);
  for (const chunk of result.out.chunks) assert.ok(chunk.bytes <= 204800, `${chunk.bytes}`);
  const joined = result.out.chunks.map((chunk) => fs.readFileSync(chunk.file, "utf8").split("## events\n\n")[1])
    .join("").replace(/\[part \d+\/\d+\] /g, "").replace(/\n(?=word|END)/g, "");
  assert.ok(joined.includes("END-OF-OWNER-NOTE"));
  assert.equal((joined.match(/word /g) || []).length, (LONG_OWNER.match(/word /g) || []).length);
});

test("native Codex question tools keep questions, options and the reply", (t) => {
  const w = setupWorld(t, buildEdgeWorld);
  collect(w);
  const text = eventsOnly(extractText(w, EDGE.nativeQuestion));
  assert.ok(text.includes("question: Which colour? [options: Blue; Green]\n  status: answered"));
  assert.ok(text.includes("answer: Which colour? [options: Blue; Green]\n  answer (answered): Green"));
});

test("reads: contradicting partial, batched foreign beside Mono, relative path, changed full file", (t) => {
  const w = setupWorld(t, buildEdgeWorld);
  const map = collect(w).mapData;
  assert.equal(byId(map, EDGE.contradict), undefined, "a slice with a contradicting line is not a Mono read");

  const batched = byId(map, EDGE.batched);
  assert.equal(batched.loads.length, 1, "the foreign head is not a load");
  assert.equal(batched.loads[0].path, path.join(w.clone, "skills", "review"));
  assert.equal(batched.loads[0].version.range, "v0.2.0", "results one per call go to their own read");

  assert.equal(byId(map, EDGE.stageMismatch).loads[0].version.status, "unconfirmed", "a stage read that fits no tag invalidates the version");
  assert.equal(byId(map, EDGE.batchedMismatch).loads[0].version.status, "unconfirmed", "the same inside a batch");

  const relative = byId(map, EDGE.relative);
  assert.equal(relative.loads[0].path, path.join(w.clone, "skills", "implement"), "resolved against the session folder");
  assert.equal(relative.loads[0].version.range, "v0.1.0..v0.2.0");

  const changed = byId(map, EDGE.changedFull);
  assert.equal(changed.loads[0].partial, false);
  assert.equal(changed.loads[0].version.status, "unconfirmed", "a full read with an added line equals no tag");
});

test("the synchronous Codex question tool keeps its answer from the output", (t) => {
  const w = setupWorld(t, buildEdgeWorld);
  collect(w);
  const text = eventsOnly(extractText(w, EDGE.syncQuestion));
  assert.ok(text.includes("question: Which day? [options: Monday; Tuesday]\n  status: answered"));
  assert.ok(text.includes(`[${at(BOUNDARY, 22)}] answer: Which day? [options: Monday; Tuesday]\n  answer (answered): Tuesday`));
});

test("a hard-linked log is not appended to", (t) => {
  const w = setupWorld(t, buildWorld);
  const pass = collect(w).passUuid;
  const outside = path.join(w.root, "outside.log");
  fs.writeFileSync(outside, "outside\n");
  const log = path.join(w.data, "runs", pass, "log");
  fs.rmSync(log);
  fs.linkSync(outside, log);
  const result = run(w.env, ["collect", "--session", AUDITOR, "--now", NOW]);
  assert.equal(result.status, 2);
  assert.match(result.err.error, /hard-linked/);
  assert.equal(fs.readFileSync(outside, "utf8"), "outside\n");
});

test("several contenders for a dead holder's lock: one pass, the winner's lock is never removed by another", async (t) => {
  const w = setupWorld(t, buildWorld);
  const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid;
  fs.writeFileSync(path.join(w.data, "lock"), JSON.stringify({ pid: dead, sessionId: "gone", token: "old" }));
  const sessions = [0, 1, 2, 3].map((i) => `b0000000-333${i}-4111-8111-111111111111`);
  const results = await Promise.all(sessions.map((session) => runAsync(w.env, ["collect", "--session", session, "--now", NOW])));
  assert.equal(results.filter((result) => result.status === 0).length, 1, results.map((result) => result.stderr).join("\n"));
  assert.ok(results.every((result) => result.status === 0 || result.status === 3));
  assert.equal(fs.readdirSync(path.join(w.data, "runs")).length, 1);
  assert.deepEqual(fs.readdirSync(w.data).filter((name) => name.startsWith("lock")), [], "no lock or tombstone left");
});

test("a codex exec child of the audit is part of the audit", (t) => {
  const w = setupWorld(t, buildEdgeWorld);
  const map = collect(w).mapData;
  assert.equal(byId(map, EDGE.auditChild), undefined);
  assert.equal(map.counters.excluded.audit, 2);
});

test("a cut last record is deferred and read as new in the next pass", (t) => {
  const w = setupWorld(t, buildEdgeWorld);
  const first = collect(w);
  assert.ok(first.mapData.deferredTails.some((tail) => tail.file === w.tailFile));
  const state = JSON.parse(fs.readFileSync(path.join(w.data, "state.json"), "utf8"));
  assert.deepEqual(state.pending.deferredTails, first.mapData.deferredTails, "kept with the pass for the boundary move");

  const next = setupWorld(t, buildEdgeWorld, {
    state: (built) => ({ boundary: BOUNDARY, pending: null, deferredTails: [{ file: built.revisitFile, offset: built.revisitOffset }] }),
  });
  const map = collect(next).mapData;
  const revisit = byId(map, EDGE.revisit);
  assert.equal(revisit.newEvents, 1, "the record finished before the boundary is still read");
  assert.equal(revisit.revisitKeys.length, 1);
  assert.ok(eventsOnly(extractText(next, EDGE.revisit)).includes("Finished just before the boundary."));
});

test("review receipts come from evidence roots by recordedAt", (t) => {
  const w = setupWorld(t, buildEdgeWorld);
  const map = collect(w).mapData;
  const receipts = map.sources.reports.filter((report) => report.kind === "review-receipt");
  assert.deepEqual(receipts.map((receipt) => [path.basename(receipt.path), receipt.ts]).sort(), [
    ["run-1.json", at(BOUNDARY, 90)],
    ["run-2.json", at(BOUNDARY, 95)],
  ]);
  assert.ok(receipts.some((receipt) => receipt.path.startsWith(w.elsewhere)), "root named by a dispatch record");
});
