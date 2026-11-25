// Review findings on the first version of the weekly pass (PR review of
// MONO-478), one test each.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makePackRepo } from "../fixtures/pack.mjs";
import { PROJECT, TEAM, addPathHintSession, addSignalSources, eventKey, fakeLinear, writeChangelog } from "../fixtures/review.mjs";
import { BOUNDARY, IDS, NOW, OLD, at, buildWorld } from "../fixtures/sessions.mjs";
import { TagIndex } from "./lib.mjs";
import { guardText } from "./publish.mjs";
import { selectFindings } from "./review.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "session-audit.mjs");
const ME = IDS.audit;
const CONFIG = JSON.parse(fs.readFileSync(path.join(path.dirname(CLI), "..", "config.json"), "utf8"));

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "session-audit-fixes-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function world(t, { personal = {}, changelog = null, registry = null } = {}) {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  if (changelog) writeChangelog(repo, changelog);
  const built = buildWorld(root, { repo });
  addSignalSources(built);
  addPathHintSession(built);
  const data = path.join(root, "data");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, "config.json"), JSON.stringify({ projectId: PROJECT, triageTeam: TEAM, ...personal }));
  if (registry) fs.writeFileSync(path.join(data, "findings.json"), JSON.stringify({ findings: registry }));
  const env = { PATH: process.env.PATH, HOME: built.home, SESSION_AUDIT_HOME: data, SESSION_AUDIT_REPO: repo };
  return { root, repo, data, env, ...built };
}

function run(env, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
  return { status: result.status, out: parse(result.stdout), err: parse(result.stderr), stderr: result.stderr };
}

function ok(env, args) {
  const result = run(env, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
  return result.out;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const file = (w, id) => path.join(w.projectDir, `${id}.jsonl`);
const measured = (value, kind = "ledger") => ({ value, mark: "measured", source: { kind, ref: "fixture" } });
const unknown = { value: null, mark: "unknown" };

function save(w, passUuid, name, value) {
  const target = path.join(w.data, "runs", passUuid, "inbox", name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value));
  return target;
}

function finding(w, id, extra = {}) {
  return {
    id, kind: "broken", scope: "pack", stage: "review",
    pointer: { session: IDS.owner, event: eventKey(file(w, IDS.owner), "Continuing after the boundary."), ts: at(BOUNDARY, 31) },
    quote: "Continuing after the boundary.",
    mechanism: `The review moved on early (${id}).`,
    proposal: "Make the first review step a check that the request was read.",
    latest: { file: "skills/review/SKILL.md", text: "Step 1: read the artifact named in the request" },
    cost: { stops: measured(1), interventions: measured(0), extraRounds: unknown, minutes: unknown },
    ...extra,
  };
}

function workerPointer(w) {
  const day = path.join(w.home, ".codex", "sessions", "2026", "11", "22");
  const name = fs.readdirSync(day).find((entry) => entry.includes(IDS.worker));
  const lines = fs.readFileSync(path.join(day, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  return { session: IDS.worker, event: lines.find((line) => JSON.stringify(line).includes("Implemented.")).payload.id };
}

function analyse(w, passUuid, findings, linear = null, now = NOW) {
  ok(w.env, ["signals", "--session", ME, "--now", now]);
  ok(w.env, ["check", save(w, passUuid, `f-${Date.now()}-${Math.random()}.json`, findings), "--session", ME, "--now", now]);
  const args = ["register", "--session", ME, "--now", now];
  if (linear) args.push("--linear", save(w, passUuid, `linear-${Math.random()}.json`, linear));
  const registered = ok(w.env, args);
  const selected = ok(w.env, ["select", "--session", ME, "--now", now]);
  return { registered, selected };
}

function apply(w, passUuid, linear, now = NOW) {
  for (;;) {
    const next = ok(w.env, ["op", "next", "--session", ME, "--now", now]);
    if (next.done) return;
    assert.equal(next.next, "send", JSON.stringify(next));
    const sent = ok(w.env, ["op", "sent", next.key, "--session", ME, "--now", now]);
    const answer = linear.call(sent.call, now);
    ok(w.env, ["op", "confirm", next.key, "--response", save(w, passUuid, `a-${next.key}-${Math.random()}.json`, answer), "--session", ME, "--now", now]);
  }
}

function registryEntry(id, issue, stage, extra = {}) {
  return { id, mechanism: `Invented mechanism of ${id}.`, proposal: "An invented proposal.", features: { stage, kind: "broken" }, kind: "broken", scope: "pack", stage, issue, outcome: "triage", status: "confirmed", encounters: [{ pass: "01d00000-0000-4000-8000-000000000000", session: "s-old", versions: ["v0.1.0"] }], ...extra };
}

// ---------------------------------------------------------------- P1 guard

test("guard: e-mails, tokens, long secrets, short stored quotes and links with query or other paths are refused", () => {
  const passUuid = "c0000000-0000-4000-8000-000000000001";
  const privateSet = { sequences: new Set(), quotes: ["Yes", "Ship it now"] };
  const check = (text) => guardText(text, { passUuid, pointers: [], config: CONFIG, privateSet }).join(" | ");
  assert.equal(check("F-c0000000-0000-4000-8000-000000000002 · этап review · https://linear.app/team/issue/MONO-3 · https://github.com/someone/mono/pull/4"), "");
  assert.match(check("write to someone@example.invalid"), /e-mail/);
  assert.match(check("token: abc123def"), /credential assignment/);
  assert.match(check("ghp_abcdefghijklmnopqrstuvwxyz0123"), /GitHub token/);
  assert.match(check("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4"), /JSON web token/);
  assert.match(check("key 0123456789abcdef0123456789abcdef01"), /long hex/);
  assert.match(check("blob Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MGFiY2RlZg"), /long base64/);
  assert.match(check("the owner said yes then"), /stored finding quote/, "a one-word quote counts");
  assert.match(check("then: ship it now, please"), /stored finding quote/);
  assert.match(check("https://linear.app/team/issue/MONO-3?token=abc"), /link outside/);
  assert.match(check("https://linear.app/team/issue/MONO-3#secret"), /link outside/);
  assert.match(check("https://linear.app/team/settings/api"), /link outside/);
  assert.match(check("https://github.com/someone/other-repo"), /link outside/);
});

// ---------------------------------------------------------------- P1 stage

test("stage: an unknown stage is stored and published as the generic one", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const { registered } = analyse(w, passUuid, [finding(w, "prod", { scope: "product", stage: "secret-module-of-a-product" })]);
  assert.equal(registered.findings[0].stage, "other");
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const report = readJson(path.join(w.data, "runs", passUuid, "plan.json")).ops[0].body;
  assert.ok(!report.includes("secret-module"));
  assert.match(report, /этап другой/);
});

// ---------------------------------------------------------------- P2 stale plan

test("commit refuses a confirmed plan built before the last register and select", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  analyse(w, passUuid, [finding(w, "one")]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  apply(w, passUuid, linear);
  analyse(w, passUuid, [finding(w, "two", { mechanism: "The review restarted without a reason." })]);
  const refused = run(w.env, ["commit", "--session", ME, "--now", NOW]);
  assert.equal(refused.status, 2);
  assert.match(refused.err.error, /run plan again/);
  assert.equal(readJson(path.join(w.data, "state.json")).boundary, null);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  apply(w, passUuid, linear);
  assert.equal(linear.issues.length, 2);
  ok(w.env, ["commit", "--session", ME, "--now", NOW]);
});

// ---------------------------------------------------------------- P2 duplicate

test("a Duplicate whose main issue comes back with a uuid id resolves to the team key for fixed_in", (t) => {
  const registry = [registryEntry("F-dddddddd-0000-4000-8000-000000000001", "MONO-905", "implement")];
  const w = world(t, { changelog: { "0.2.0": ["MONO-908"] }, registry });
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const linear = [
    { id: "MONO-905", status: "Duplicate", statusType: "canceled", duplicateOf: "aaaa0000-0000-4000-8000-0000000000aa" },
    { id: "aaaa0000-0000-4000-8000-0000000000aa", identifier: "MONO-908", status: "Done", statusType: "completed" },
  ];
  const { registered } = analyse(w, passUuid, [{ ...finding(w, "dup", { sameAs: registry[0].id }), stage: "implement", pointer: workerPointer(w), quote: "Implemented." }], linear);
  assert.equal(registered.findings[0].outcome, "returned");
  assert.equal(registered.findings[0].linear.issue, "MONO-908");
  assert.equal(registered.findings[0].fixedIn, "v0.2.0");
});

// ---------------------------------------------------------------- P2 returns

test("a returned finding over the limit stays queued with its issue and is reopened next pass; already-changed beats returned", (t) => {
  const registry = [
    registryEntry("F-eeeeeeee-0000-4000-8000-000000000001", "MONO-911", "implement"),
    registryEntry("F-eeeeeeee-0000-4000-8000-000000000002", "MONO-912", "implement"),
    registryEntry("F-eeeeeeee-0000-4000-8000-000000000003", "MONO-913", "review"),
  ];
  const w = world(t, { personal: { triageLimit: 1 }, changelog: { "0.1.0": ["MONO-911", "MONO-912", "MONO-913"] }, registry });
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const issues = ["MONO-911", "MONO-912", "MONO-913"].map((id) => ({ id, identifier: id, status: "Done", statusType: "completed" }));
  const worker = (id, sameAs, stops) => ({ ...finding(w, id, { sameAs, cost: { stops: measured(stops), interventions: measured(0), extraRounds: unknown, minutes: unknown } }), stage: "implement", pointer: workerPointer(w), quote: "Implemented." });
  const changed = finding(w, "changed", { sameAs: registry[2].id, rule: { file: "skills/review/SKILL.md", text: "Step 9: suggest one fix per finding" }, changed: { file: "skills/review/SKILL.md", text: "Step 9: suggest at most two fixes per finding" } });
  const { registered, selected } = analyse(w, passUuid, [worker("r1", registry[0].id, 2), worker("r2", registry[1].id, 1), changed], issues);
  const byProposal = Object.fromEntries(registered.findings.map((one) => [one.proposals[0], one]));
  assert.equal(byProposal.changed.outcome, "returned");
  assert.deepEqual(selected.rows.find((row) => row.id === registry[2].id), { id: registry[2].id, row: "already-changed" }, "already changed is a row, not a reopen");
  assert.deepEqual(selected.triage.map((entry) => [entry.id, entry.action]), [[registry[0].id, "reopen"]]);
  assert.deepEqual(selected.queued.map((entry) => [entry.id, entry.action]), [[registry[1].id, "reopen"]]);
  const linear = fakeLinear();
  for (const issue of issues) linear.seedIssue({ ...issue });
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  apply(w, passUuid, linear);
  ok(w.env, ["commit", "--session", ME, "--now", NOW]);
  const saved = readJson(path.join(w.data, "findings.json")).findings.find((entry) => entry.id === registry[1].id);
  assert.equal(saved.outcome, "queued");
  assert.equal(saved.queuedAction, "reopen");
  assert.equal(saved.issue, "MONO-912");

  const later = at(NOW, 24 * 60);
  const next = ok(w.env, ["collect", "--session", ME, "--now", later]).passUuid;
  ok(w.env, ["signals", "--session", ME, "--now", later]);
  assert.equal(run(w.env, ["register", "--session", ME, "--now", later]).status, 2, "a queued reopen needs a fresh Linear read");
  ok(w.env, ["register", "--linear", save(w, next, "linear-again.json", [{ id: "MONO-912", identifier: "MONO-912", status: "Done", statusType: "completed" }]), "--session", ME, "--now", later]);
  const carried = ok(w.env, ["select", "--session", ME, "--now", later]);
  assert.deepEqual(carried.triage.map((entry) => [entry.id, entry.action, entry.carried]), [[registry[1].id, "reopen", true]]);
  ok(w.env, ["plan", "--session", ME, "--now", later]);
  const ops = readJson(path.join(w.data, "runs", next, "plan.json")).ops;
  assert.ok(ops.some((op) => op.type === "update-issue" && op.target === "MONO-912"));
});

// ---------------------------------------------------------------- P2 carried recheck

test("a carried queued finding is checked again against the last release before it competes", (t) => {
  const root = scratch(t);
  const index = new TagIndex(makePackRepo(path.join(root, "pack-repo")));
  const base = { scope: "pack", status: "confirmed", proposal: "x", sessionsTotal: 2, outcome: "queued", issue: null, cost: { stops: { value: 1, mark: "measured" }, interventions: { value: 0, mark: "measured" }, extraRounds: { value: null, mark: "unknown" }, minutes: { value: null, mark: "unknown" } } };
  const registry = { findings: [
    { ...base, id: "F-1", latest: { tag: "v0.1.0", canHappen: true, alreadyChanged: false }, places: { rule: { file: "skills/review/SKILL.md", text: "Step 9: suggest one fix per finding" }, latest: { file: "skills/review/SKILL.md", text: "Step 9: suggest one fix per finding" }, changed: { file: "skills/review/SKILL.md", text: "Step 9: suggest at most two fixes per finding" } } },
    { ...base, id: "F-2", latest: { tag: "v0.1.0", canHappen: true, alreadyChanged: false }, places: { rule: null, latest: { file: "references/guide.md", text: "Guide closing line for the first release." }, changed: null } },
    { ...base, id: "F-3", latest: { tag: "v0.1.0", canHappen: true, alreadyChanged: false }, places: { rule: null, latest: { file: "references/guide.md", text: "Guide rule 1 of the invented pack." }, changed: null } },
  ] };
  const result = selectFindings([], registry, "p", 5, index);
  assert.deepEqual(result.rows.map((row) => [row.id, row.row]), [["F-1", "already-changed"], ["F-2", "report-only"]]);
  assert.deepEqual(result.triage.map((entry) => entry.id), ["F-3"]);
  assert.equal(result.triage[0].latest.tag, "v0.2.0");
});

// ---------------------------------------------------------------- P2 confirmed members only

test("members waiting for the owner add no sessions, versions or cost to a confirmed finding", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const zero = { stops: measured(0), interventions: measured(0), extraRounds: unknown, minutes: unknown };
  const { registered, selected } = analyse(w, passUuid, [
    finding(w, "kept", { cost: zero }),
    { ...finding(w, "waiting", { sameAs: "kept", screen: true, cost: { stops: measured(3), interventions: measured(2), extraRounds: unknown, minutes: unknown } }), stage: "implement", pointer: workerPointer(w), quote: "Implemented." },
  ]);
  const one = registered.findings[0];
  assert.equal(one.sessionsTotal, 1);
  assert.deepEqual(one.versions.tags, ["v0.1.0"]);
  assert.equal(one.cost.stops.value, 0);
  assert.deepEqual(one.pending.waiting, ["waiting"]);
  assert.equal(selected.triage.length, 0, "the waiting member cannot lift it over the threshold");
});

// ---------------------------------------------------------------- bot review

test("resuming a plan adds no report update when only the revision text differs", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  analyse(w, passUuid, [finding(w, "one"), finding(w, "screen", { screen: true, mechanism: "A status on screen looked wrong." })]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  apply(w, passUuid, linear);
  ok(w.env, ["confirm", "screen", "--yes", "--session", ME, "--now", NOW]);
  ok(w.env, ["register", "--session", ME, "--now", NOW]);
  ok(w.env, ["select", "--session", ME, "--now", NOW]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  apply(w, passUuid, linear);
  const before = readJson(path.join(w.data, "runs", passUuid, "plan.json")).ops.length;
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const after = readJson(path.join(w.data, "runs", passUuid, "plan.json")).ops;
  assert.equal(after.length, before);
  assert.equal(after.filter((op) => op.type === "update-document").length, 1);
});

test("a planned op is refreshed or removed when its finding changes before it is sent", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const { registered } = analyse(w, passUuid, [finding(w, "one"), finding(w, "two", { mechanism: "The review restarted without a reason." })]);
  const twoId = registered.findings.find((one) => one.proposals.includes("two")).id;
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  // "two" fails its re-check; "one" gets a new proposal text.
  analyse(w, passUuid, [finding(w, "two", { quote: "Never said." }), finding(w, "one", { proposal: "Check the request before step one." })]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const ops = readJson(path.join(w.data, "runs", passUuid, "plan.json")).ops;
  assert.ok(!ops.some((op) => op.finding === twoId), "the dropped finding's planned op is gone");
  const oneOp = ops.find((op) => op.type === "create-issue");
  assert.match(oneOp.body, /Check the request before step one\./);
  const selection = readJson(path.join(w.data, "runs", passUuid, "selection.json"));
  assert.ok(!selection.triage.some((entry) => entry.id === twoId));
});

test("check takes the event time from the file, not from the pointer", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  ok(w.env, ["check", save(w, passUuid, "f.json", [finding(w, "one", { pointer: { session: IDS.owner, event: eventKey(file(w, IDS.owner), "Continuing after the boundary."), ts: OLD } })]), "--session", ME, "--now", NOW]);
  const stored = readJson(path.join(w.data, "runs", passUuid, "checked", "one.json"));
  assert.equal(stored.pointer.ts, at(BOUNDARY, 31));
  assert.deepEqual(stored.version.tags, ["v0.1.0"], "the load before the event, though the given time is before any load");
});

test("confirm checks the target of an update and the saved words and links", (t) => {
  const registry = [registryEntry("F-ffffffff-0000-4000-8000-000000000001", "MONO-921", "implement")];
  const w = world(t, { changelog: { "0.1.0": ["MONO-921"] }, registry });
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  analyse(w, passUuid, [
    { ...finding(w, "ret", { sameAs: registry[0].id }), stage: "implement", pointer: workerPointer(w), quote: "Implemented." },
    finding(w, "new"),
  ], [{ id: "MONO-921", status: "Done", statusType: "completed" }]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  linear.seedIssue({ id: "MONO-921", identifier: "MONO-921", status: "Done", statusType: "completed" });
  linear.seedIssue({ id: "MONO-999", identifier: "MONO-999", status: "Triage", statusType: "triage" });
  for (;;) {
    const next = ok(w.env, ["op", "next", "--session", ME, "--now", NOW]);
    if (next.done) break;
    const sent = ok(w.env, ["op", "sent", next.key, "--session", ME, "--now", NOW]);
    const answer = linear.call(sent.call, NOW);
    if (sent.call.tool === "save_issue" && sent.call.args.id) {
      const wrong = run(w.env, ["op", "confirm", next.key, "--response", save(w, passUuid, "wrong.json", { id: "MONO-999", identifier: "MONO-999", statusType: "triage" }), "--session", ME, "--now", NOW]);
      assert.equal(wrong.status, 2, "another issue in Triage does not confirm the update");
    }
    if (sent.call.tool === "save_issue" && !sent.call.args.id) {
      const altered = { ...answer, description: answer.description.replace("Make the first review step", "Something else") };
      const refused = run(w.env, ["op", "confirm", next.key, "--response", save(w, passUuid, "altered.json", altered), "--session", ME, "--now", NOW]);
      assert.equal(refused.status, 2, "a marker with other words does not confirm");
    }
    ok(w.env, ["op", "confirm", next.key, "--response", save(w, passUuid, `ok-${next.key}.json`, answer), "--session", ME, "--now", NOW]);
  }
});

test("only sessions opened in the pass count toward a confirmed fix", (t) => {
  const registry = [registryEntry("F-abababab-0000-4000-8000-000000000001", "MONO-931", "implement", { outcome: "returned", fixedIn: "v0.1.0" })];
  const w = world(t, { registry });
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  analyse(w, passUuid, [finding(w, "one")]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  apply(w, passUuid, fakeLinear());
  ok(w.env, ["commit", "--session", ME, "--now", NOW]);
  const entry = readJson(path.join(w.data, "findings.json")).findings.find((one) => one.id === registry[0].id);
  assert.deepEqual(entry.cleanSessions, [], "implement sessions in the map but never opened do not count");

  const later = at(NOW, 24 * 60);
  const w2 = world(t, { registry });
  const pass2 = ok(w2.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const signals = ok(w2.env, ["signals", "--session", ME, "--now", NOW]);
  const workerSignal = signals.signals.find((signal) => signal.session === IDS.worker);
  ok(w2.env, ["opened", workerSignal.id, "--session", ME, "--now", NOW]);
  analyse(w2, pass2, [finding(w2, "one")]);
  ok(w2.env, ["plan", "--session", ME, "--now", NOW]);
  apply(w2, pass2, fakeLinear());
  ok(w2.env, ["commit", "--session", ME, "--now", later]);
  const entry2 = readJson(path.join(w2.data, "findings.json")).findings.find((one) => one.id === registry[0].id);
  assert.deepEqual(entry2.cleanSessions, [IDS.worker]);
});

// ---------------------------------------------------------------- review round 2

test("guard: credentials in quoted JSON keys are refused", () => {
  const privateSet = { sequences: new Set(), quotes: [] };
  const check = (text) => guardText(text, { passUuid: "c0000000-0000-4000-8000-000000000001", pointers: [], config: CONFIG, privateSet }).join(" | ");
  assert.match(check('{"password":"short-secret"}'), /credential assignment/);
  assert.match(check("{'token': 'abc123def456'}"), /credential assignment/);
});

test("a create confirm needs the server id and issue key; reconcile applies the same checks", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  analyse(w, passUuid, [finding(w, "one")]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  const report = ok(w.env, ["op", "sent", "report", "--session", ME, "--now", NOW]);
  const doc = linear.call(report.call, NOW);
  const { id: _id, ...noId } = doc;
  assert.equal(run(w.env, ["op", "confirm", "report", "--response", save(w, passUuid, "noid.json", noId), "--session", ME, "--now", NOW]).status, 2, "no id, no confirmation");
  ok(w.env, ["op", "confirm", "report", "--response", save(w, passUuid, "doc.json", doc), "--session", ME, "--now", NOW]);
  const next = ok(w.env, ["op", "next", "--session", ME, "--now", NOW]);
  const sent = ok(w.env, ["op", "sent", next.key, "--session", ME, "--now", NOW]);
  const issue = linear.call(sent.call, NOW);
  const { identifier: _k, ...noKey } = { ...issue, id: "aaaa0000-0000-4000-8000-0000000000bb" };
  assert.equal(run(w.env, ["op", "confirm", next.key, "--response", save(w, passUuid, "nokey.json", noKey), "--session", ME, "--now", NOW]).status, 2, "no issue key, no confirmation");
  ok(w.env, ["op", "lost", next.key, "--session", ME, "--now", NOW]);
  // Marker and text match, but the issue is not in Triage: not this operation.
  const outside = ok(w.env, ["op", "reconcile", next.key, "--listing", save(w, passUuid, "backlog.json", [{ ...issue, statusType: "backlog" }]), "--session", ME, "--now", NOW]);
  assert.equal(outside.found, false);
  const found = ok(w.env, ["op", "reconcile", next.key, "--listing", save(w, passUuid, "triage.json", [issue]), "--session", ME, "--now", at(NOW, 2)]);
  assert.equal(found.status, "confirmed");
});

test("a Duplicate reopened through its main issue keeps the main key in the registry", (t) => {
  const registry = [registryEntry("F-dddddddd-0000-4000-8000-000000000002", "MONO-905", "implement")];
  const w = world(t, { changelog: { "0.2.0": ["MONO-908"] }, registry });
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const linearAnswers = [
    { id: "MONO-905", status: "Duplicate", statusType: "canceled", duplicateOf: "aaaa0000-0000-4000-8000-0000000000aa" },
    { id: "aaaa0000-0000-4000-8000-0000000000aa", identifier: "MONO-908", status: "Done", statusType: "completed" },
  ];
  analyse(w, passUuid, [{ ...finding(w, "dup", { sameAs: registry[0].id }), stage: "implement", pointer: workerPointer(w), quote: "Implemented." }], linearAnswers);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  linear.seedIssue({ id: "MONO-908", identifier: "MONO-908", status: "Done", statusType: "completed" });
  apply(w, passUuid, linear);
  ok(w.env, ["commit", "--session", ME, "--now", NOW]);
  assert.equal(readJson(path.join(w.data, "findings.json")).findings[0].issue, "MONO-908");
});

test("rechecking a finding with the documented {session, event} pointer is not another place", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const pointer = { session: IDS.owner, event: eventKey(file(w, IDS.owner), "Continuing after the boundary.") };
  ok(w.env, ["check", save(w, passUuid, "a.json", [finding(w, "one", { pointer })]), "--session", ME, "--now", NOW]);
  ok(w.env, ["check", save(w, passUuid, "b.json", [finding(w, "one", { pointer, proposal: "Another proposal." })]), "--session", ME, "--now", NOW]);
});

test("a carried finding already sent keeps its entry when a new finding outranks it", (t) => {
  const carried = {
    ...registryEntry("F-cccccccc-0000-4000-8000-000000000001", null, "review"),
    outcome: "queued", sessionsTotal: 2, versions: { tags: ["v0.2.0"], range: "v0.2.0" },
    latest: { tag: "v0.2.0", canHappen: true, alreadyChanged: false },
    cost: { stops: measured(1), interventions: measured(0), extraRounds: unknown, minutes: unknown },
    pointer: "runs/01d00000-0000-4000-8000-000000000000/F-cccccccc-0000-4000-8000-000000000001",
  };
  const w = world(t, { personal: { triageLimit: 1 }, registry: [carried] });
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const first = analyse(w, passUuid, []);
  assert.deepEqual(first.selected.triage.map((entry) => [entry.id, entry.carried]), [[carried.id, true]]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  ok(w.env, ["op", "sent", carried.id, "--session", ME, "--now", NOW]);
  const second = analyse(w, passUuid, [finding(w, "big", { cost: { stops: measured(5), interventions: measured(0), extraRounds: unknown, minutes: unknown } })]);
  assert.equal(second.selected.triage[0].id, carried.id);
  assert.equal(second.selected.triage[0].carried, true, "the kept entry is the original one");
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
});

test("earlier encounters that were never confirmed do not count toward two sessions", (t) => {
  const zero = { stops: measured(0), interventions: measured(0), extraRounds: unknown, minutes: unknown };
  const sessionsTotal = (confirmed) => {
    const registry = [{ ...registryEntry(`F-99999999-0000-4000-8000-00000000000${confirmed ? 1 : 2}`, null, "review"), outcome: "report", encounters: [{ pass: "01d00000-0000-4000-8000-000000000000", session: "s-old", versions: ["v0.1.0"], confirmed }] }];
    const w = world(t, { registry });
    const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
    return analyse(w, passUuid, [finding(w, "again", { sameAs: registry[0].id, cost: zero })]).registered.findings[0].sessionsTotal;
  };
  assert.equal(sessionsTotal(false), 1);
  assert.equal(sessionsTotal(true), 2);
});

// ---------------------------------------------------------------- review round 3

test("a later sameAs wins over the id cached by an earlier register, unless that id was already sent", (t) => {
  const registry = [registryEntry("F-12121212-0000-4000-8000-000000000001", null, "review", { outcome: "report" })];
  const w = world(t, { registry });
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const first = analyse(w, passUuid, [finding(w, "late")]);
  assert.notEqual(first.registered.findings[0].id, registry[0].id);
  const second = analyse(w, passUuid, [finding(w, "late", { sameAs: registry[0].id })]);
  assert.deepEqual(second.registered.findings.map((one) => one.id), [registry[0].id], "the corrected link wins, no second finding");

  const w2 = world(t, { registry });
  const pass2 = ok(w2.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const newId = analyse(w2, pass2, [finding(w2, "late")]).registered.findings[0].id;
  ok(w2.env, ["plan", "--session", ME, "--now", NOW]);
  ok(w2.env, ["op", "sent", newId, "--session", ME, "--now", NOW]);
  ok(w2.env, ["check", save(w2, pass2, "relink.json", [finding(w2, "late", { sameAs: registry[0].id })]), "--session", ME, "--now", NOW]);
  const refused = run(w2.env, ["register", "--session", ME, "--now", NOW]);
  assert.equal(refused.status, 2);
  assert.match(refused.err.error, /already sent to Linear/);
});

test("a finding dropped after its issue was sent keeps its stored entry; plan and commit go on", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const id = analyse(w, passUuid, [finding(w, "gone")]).registered.findings[0].id;
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  const sent = ok(w.env, ["op", "sent", id, "--session", ME, "--now", NOW]);
  const issue = linear.call(sent.call, NOW);
  analyse(w, passUuid, [finding(w, "gone", { quote: "Never said." })]);
  const selection = readJson(path.join(w.data, "runs", passUuid, "selection.json"));
  assert.deepEqual(selection.triage, [{ id, action: "create", stored: true }]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  ok(w.env, ["op", "confirm", id, "--response", save(w, passUuid, "issue.json", issue), "--session", ME, "--now", NOW]);
  apply(w, passUuid, linear);
  ok(w.env, ["commit", "--session", ME, "--now", NOW]);
  assert.equal(readJson(path.join(w.data, "findings.json")).findings.find((one) => one.id === id).issue, issue.identifier);
});

test("a queued reopen is read again: a cancel by the owner wins, a Duplicate goes to its main issue", (t) => {
  const queued = (id, issue) => registryEntry(id, issue, "review", { outcome: "queued", queuedAction: "reopen", sessionsTotal: 2, versions: { tags: ["v0.2.0"], range: "v0.2.0" }, latest: { tag: "v0.2.0", canHappen: true, alreadyChanged: false }, cost: { stops: measured(1), interventions: measured(0), extraRounds: unknown, minutes: unknown }, pointer: `runs/01d00000-0000-4000-8000-000000000000/${id}` });
  const registry = [queued("F-34343434-0000-4000-8000-000000000001", "MONO-941"), queued("F-34343434-0000-4000-8000-000000000002", "MONO-942")];
  const w = world(t, { registry });
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const { selected } = analyse(w, passUuid, [], [
    { id: "MONO-941", status: "Canceled", statusType: "canceled" },
    { id: "MONO-942", status: "Duplicate", statusType: "canceled", duplicateOf: "MONO-943" },
    { id: "MONO-943", identifier: "MONO-943", status: "Done", statusType: "completed" },
  ]);
  assert.deepEqual(selected.rows.map((row) => [row.id, row.row]), [[registry[0].id, "rejected"]], "no reopen of a canceled issue");
  assert.deepEqual(selected.triage.map((entry) => [entry.id, entry.action]), [[registry[1].id, "reopen"]]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const ops = readJson(path.join(w.data, "runs", passUuid, "plan.json")).ops;
  assert.deepEqual(ops.filter((op) => op.type === "update-issue").map((op) => op.target), ["MONO-943"]);
});

test("queued findings alone start a pass when nothing else is new", (t) => {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const data = path.join(root, "data");
  fs.mkdirSync(data);
  const env = { PATH: process.env.PATH, HOME: home, SESSION_AUDIT_HOME: data, SESSION_AUDIT_REPO: repo };
  assert.equal(ok(env, ["collect", "--session", ME, "--now", NOW]).nothingNew, true);
  fs.writeFileSync(path.join(data, "findings.json"), JSON.stringify({ findings: [registryEntry("F-56565656-0000-4000-8000-000000000001", null, "review", { outcome: "queued" })] }));
  const started = ok(env, ["collect", "--session", ME, "--now", NOW]);
  assert.equal(started.nothingNew, undefined);
  assert.ok(started.passUuid);
});
