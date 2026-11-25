// Fixes after the first live pass (MONO-480): the report as a team document,
// tester loads of orchestrators, products of worktrees, the pass budget,
// opened sessions apart from signals, event keys in the digest and the
// opening brief. Every session here is invented.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PACK, loadBody, makePackRepo } from "../fixtures/pack.mjs";
import { PROJECT, TEAM, addPathHintSession, addSignalSources, fakeLinear } from "../fixtures/review.mjs";
import { BOUNDARY, IDS, NOW, at, buildWorld, claude, codex, execCmd, jsonl } from "../fixtures/sessions.mjs";
import { checkReadBack, marker, openedBreakdown, renderReport } from "./publish.mjs";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(SCRIPTS);
const CLI = path.join(SCRIPTS, "session-audit.mjs");
const ME = IDS.audit;

const LIVE = {
  orchestrator: "a1111111-1111-4111-8111-111111111111",
  orchestratorAgent: "a00000000000000a1",
  inRepo: "a2222222-1111-4111-8111-111111111111",
  claudeTree: "a2222222-2222-4111-8111-111111111111",
  homeTree: "a2222222-3333-4111-8111-111111111111",
  codexTree: "a2222222-4444-4111-8111-111111111111",
  gone: "a2222222-5555-4111-8111-111111111111",
};

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "session-audit-live-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function world(t, { personal = { reportTeam: TEAM, triageTeam: TEAM }, extra = null } = {}) {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  const built = buildWorld(root, { repo });
  addSignalSources(built);
  addPathHintSession(built);
  if (extra) extra(built);
  const data = path.join(root, "data");
  fs.mkdirSync(data, { recursive: true });
  if (personal) fs.writeFileSync(path.join(data, "config.json"), JSON.stringify(personal));
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

function save(w, passUuid, name, value) {
  const file = path.join(w.data, "runs", passUuid, "inbox", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const touch = (file) => fs.utimesSync(file, new Date(NOW), new Date(NOW));
const byId = (map, id) => map.sessions.find((session) => session.ids.includes(id));

// `[time #key] kind: text` lines of a digest whose text contains the needle.
function digestKey(text, needle) {
  const line = text.split("\n").find((candidate) => candidate.includes(needle));
  assert.ok(line, `no digest line with ${needle}`);
  const match = /^\[(\S+) (#\S+)\] /.exec(line);
  assert.ok(match, `digest line without a key: ${line}`);
  return match[2];
}

function finding(id, pointer, quote, extra = {}) {
  return {
    id, kind: "time-loss", scope: "pack", stage: "review", pointer, quote,
    mechanism: "The step waited for an answer it did not need.",
    proposal: "Let the step go on and ask at the end.",
    cost: { stops: { value: 0, mark: "estimate" }, interventions: { value: 0, mark: "estimate" }, extraRounds: { value: null, mark: "unknown" }, minutes: { value: 5, mark: "estimate" } },
    ...extra,
  };
}

function prepare(w) {
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const signals = ok(w.env, ["signals", "--session", ME, "--now", NOW]);
  const owner = ok(w.env, ["extract", IDS.owner, "--session", ME]);
  const text = fs.readFileSync(owner.chunks[0].file, "utf8");
  const key = digestKey(text, "Continuing after the boundary.");
  ok(w.env, ["check", save(w, passUuid, "f.json", [finding("one", { session: IDS.owner, event: key }, "Continuing after the boundary.")]), "--session", ME, "--now", NOW]);
  ok(w.env, ["register", "--session", ME, "--now", NOW]);
  ok(w.env, ["select", "--session", ME, "--now", NOW]);
  return { passUuid, signals };
}

// ---------------------------------------------------------------- AC1

test("AC1: the report is a document of the report team; confirm and reconcile check that team", (t) => {
  const w = world(t);
  const { passUuid } = prepare(w);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const next = ok(w.env, ["op", "next", "--session", ME, "--now", NOW]);
  assert.equal(next.key, "report");
  assert.deepEqual(Object.keys(next.call.args).sort(), ["content", "team", "title"], "a team document, no project");
  assert.equal(next.call.args.team, TEAM);
  const sent = ok(w.env, ["op", "sent", "report", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  const doc = linear.call(sent.call, NOW);
  assert.deepEqual(doc.team.name, TEAM);

  const refuse = (name, answer, pattern) => {
    const result = run(w.env, ["op", "confirm", "report", "--response", save(w, passUuid, name, answer), "--session", ME, "--now", NOW]);
    assert.equal(result.status, 2, name);
    assert.match(result.err.problems.join(" "), pattern, name);
  };
  refuse("other-team.json", { ...doc, team: { id: "team-x", name: "Another team" } }, /not Fixture team/);
  refuse("no-team.json", { ...doc, team: undefined }, /names no team/);
  refuse("in-project.json", { ...doc, project: { id: PROJECT } }, /in a project/);
  // A flat answer (team name and id fields) is the same team.
  const flat = { ...doc, team: TEAM, teamId: "team-1" };
  ok(w.env, ["op", "confirm", "report", "--response", save(w, passUuid, "flat.json", flat), "--session", ME, "--now", NOW]);

  // Reconcile after a lost answer: a listing of the team, a copy in another team does not count.
  const w2 = world(t);
  const pass2 = prepare(w2).passUuid;
  ok(w2.env, ["plan", "--session", ME, "--now", NOW]);
  const lost = ok(w2.env, ["op", "sent", "report", "--session", ME, "--now", NOW]);
  const linear2 = fakeLinear();
  const written = linear2.call(lost.call, NOW);
  const hint = ok(w2.env, ["op", "lost", "report", "--session", ME, "--now", NOW]);
  assert.match(hint.list, /list_documents of team Fixture team/);
  const elsewhere = ok(w2.env, ["op", "reconcile", "report", "--listing", save(w2, pass2, "elsewhere.json", { documents: [{ ...written, team: { id: "t9", name: "Another team" } }] }), "--session", ME, "--now", NOW]);
  assert.equal(elsewhere.found, false);
  const found = ok(w2.env, ["op", "reconcile", "report", "--listing", save(w2, pass2, "team.json", { documents: [written] }), "--session", ME, "--now", at(NOW, 2)]);
  assert.equal(found.status, "confirmed");
});

test("AC1: a planned report of an older project config moves to the team; the project stays a fallback", (t) => {
  const w = world(t, { personal: { projectId: PROJECT, triageTeam: TEAM } });
  prepare(w);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const planFile = path.join(w.data, "runs", readJson(path.join(w.data, "state.json")).pending.uuid, "plan.json");
  assert.equal(readJson(planFile).ops[0].project, PROJECT);
  const fallback = ok(w.env, ["op", "next", "--session", ME, "--now", NOW]);
  assert.deepEqual(Object.keys(fallback.call.args).sort(), ["content", "project", "title"]);

  fs.writeFileSync(path.join(w.data, "config.json"), JSON.stringify({ reportTeam: TEAM, projectId: PROJECT, triageTeam: TEAM }));
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const report = readJson(planFile).ops[0];
  assert.equal(report.team, TEAM);
  assert.equal(report.project, undefined, "the team wins over the project");
  assert.equal(readJson(planFile).reportTeam, TEAM);
  const moved = ok(w.env, ["op", "next", "--session", ME, "--now", NOW]);
  assert.equal(moved.call.args.team, TEAM);
  assert.equal(moved.call.args.project, undefined);
});

test("AC1: an update of the report is confirmed only while the report stays in its team (live get_document shape)", () => {
  const passUuid = "p0000000-0000-4000-8000-000000000001";
  const body = `Отчёт недели.\n\n\`\`\`session-audit\n${marker(passUuid, "report.1")}\n\`\`\``;
  const current = { ops: [{ key: "report", type: "create-document", team: "Mono", status: "confirmed", result: { id: "doc-1" } }] };
  const update = { key: "report.1", type: "update-document", target: "doc-1", title: "Разбор сессий: 25.11.2026", body, marker: marker(passUuid, "report.1") };
  // Exactly what get_document answered for a team document on 25.11.2026.
  const live = {
    id: "doc-1", title: "Разбор сессий: 25.11.2026", content: body, url: "https://linear.app/fixture/document/doc-1",
    createdAt: "2026-11-25T03:00:00.000Z", updatedAt: "2026-11-25T03:10:00.000Z",
    project: null, initiative: null, team: { id: "5042d156-0000-4000-8000-000000000000", name: "Mono" }, issue: null,
  };
  assert.deepEqual(checkReadBack(update, live, current), []);
  assert.match(checkReadBack(update, { ...live, project: { id: "p-1", name: "Some project" } }, current).join(" "), /in a project/);
  assert.match(checkReadBack(update, { ...live, team: { id: "t-2", name: "Other" } }, current).join(" "), /not Mono/);
  const create = { ...update, key: "report", type: "create-document", team: "Mono", body: body.replace("report.1", "report"), marker: marker(passUuid, "report") };
  // list_documents with fields: the same parent fields per document.
  const listed = { id: "doc-1", title: live.title, content: create.body, team: { id: live.team.id, name: "Mono" }, project: null, createdAt: live.createdAt };
  assert.deepEqual(checkReadBack(create, listed, current), []);
});

// ---------------------------------------------------------------- AC2

function addOrchestratorWithTester(built) {
  const c = claude(LIVE.orchestrator, built.alpha);
  const file = path.join(built.projectDir, `${LIVE.orchestrator}.jsonl`);
  jsonl(file, [
    c.user(at(BOUNDARY, 700), "Drive the product."),
    c.load(at(BOUNDARY, 701), path.join(built.clone, "skills", "orchestrate"), loadBody("v0.2.0", "orchestrate")),
    c.load(at(BOUNDARY, 702), path.join(built.clone, "skills", "qa"), loadBody("v0.2.0", "qa")),
    c.say(at(BOUNDARY, 703), "Tester passed, merging."),
  ]);
  touch(file);
  const agentDir = path.join(built.projectDir, LIVE.orchestrator, "subagents");
  const a = claude(LIVE.orchestrator, built.alpha);
  const agentFile = path.join(agentDir, `agent-${LIVE.orchestratorAgent}.jsonl`);
  jsonl(agentFile, [
    { ...a.user(at(BOUNDARY, 704), "Test the change."), isSidechain: true, agentId: LIVE.orchestratorAgent },
    { ...a.load(at(BOUNDARY, 705), path.join(built.clone, "skills", "qa"), loadBody("v0.2.0", "qa")), agentId: LIVE.orchestratorAgent },
    { ...a.say(at(BOUNDARY, 706), "Checked."), agentId: LIVE.orchestratorAgent },
  ]);
  fs.writeFileSync(path.join(agentDir, `agent-${LIVE.orchestratorAgent}.meta.json`), JSON.stringify({ agentType: "general-purpose", description: "tester" }));
  touch(agentFile);
}

test("AC2: an orchestrator that loads the tester is not a test run; tester sessions stay marked", (t) => {
  const w = world(t, { extra: addOrchestratorWithTester });
  const result = ok(w.env, ["collect", "--session", ME, "--now", NOW]);
  const map = readJson(result.map);
  const orchestrator = byId(map, LIVE.orchestrator);
  assert.equal(orchestrator.kind, "orchestrator");
  assert.deepEqual(orchestrator.links.stages.sort(), ["orchestrate", "qa"]);
  assert.deepEqual(orchestrator.run, { marked: false, reasons: [] });
  const tester = byId(map, `agent-${LIVE.orchestratorAgent}`);
  assert.deepEqual(tester.run, { marked: true, reasons: ["qa-load"] }, "the tester helper of the orchestrator is a run");
  assert.ok(byId(map, IDS.qaRun).run.reasons.includes("qa-load"), "a headless tester run stays marked");
});

// ---------------------------------------------------------------- AC3

function addWorktreeSessions(built) {
  const { home, clone, projectDir } = built;
  const repo = path.join(home, "work", "beta");
  fs.mkdirSync(path.join(repo, ".git", "worktrees"), { recursive: true });
  const linked = (dir, name, relative = false) => {
    fs.mkdirSync(dir, { recursive: true });
    const gitdir = path.join(repo, ".git", "worktrees", name);
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".git"), `gitdir: ${relative ? path.relative(dir, gitdir) : gitdir}\n`);
    return dir;
  };
  const claudeTree = linked(path.join(repo, ".claude", "worktrees", "agent-feature-1a2b3c"), "agent-feature-1a2b3c", true);
  const homeTree = linked(path.join(home, "Worktrees", "beta-design-audit-546630"), "beta-design-audit-546630");
  const codexTree = linked(path.join(home, ".codex", "worktrees", "9f8e", "beta"), "beta-9f8e");
  const sessions = [
    [LIVE.inRepo, repo], [LIVE.claudeTree, path.join(claudeTree, "src")], [LIVE.homeTree, homeTree], [LIVE.gone, path.join(home, "gone", "beta-old-tree")],
  ];
  for (const [id, cwd] of sessions) {
    const c = claude(id, cwd);
    const file = path.join(projectDir, `${id}.jsonl`);
    jsonl(file, [
      c.user(at(BOUNDARY, 720), "Implement the invented change."),
      c.load(at(BOUNDARY, 721), path.join(clone, "skills", "implement"), loadBody("v0.2.0", "implement")),
      c.say(at(BOUNDARY, 722), "Done."),
    ]);
    touch(file);
  }
  const x = codex(LIVE.codexTree, { cwd: codexTree, originator: "Codex Desktop", source: "vscode" });
  const file = path.join(home, ".codex", "sessions", "2026", "11", "23", `rollout-2026-11-23T10-00-00-${LIVE.codexTree}.jsonl`);
  jsonl(file, [
    ...x.meta(at(BOUNDARY, 730)),
    x.user(at(BOUNDARY, 731), "Implement the invented change."),
    x.exec(at(BOUNDARY, 732), "call_x1", execCmd(`cat '${path.join(clone, "skills", "implement", "SKILL.md")}'`)),
    x.output(at(BOUNDARY, 732), "call_x1", [PACK["v0.2.0"]["skills/implement/SKILL.md"]]),
  ]);
  touch(file);
}

test("AC3: sessions in worktrees of one repository give one product", (t) => {
  const w = world(t, { extra: addWorktreeSessions });
  const map = readJson(ok(w.env, ["collect", "--session", ME, "--now", NOW]).map);
  for (const id of [LIVE.inRepo, LIVE.claudeTree, LIVE.homeTree, LIVE.codexTree]) {
    assert.equal(byId(map, id)?.product, "beta", id);
  }
  assert.equal(byId(map, LIVE.gone).product, "beta-old-tree", "a folder that is gone keeps the folder rule");
  assert.equal(byId(map, IDS.worker).product, "alpha");
  assert.ok(map.counters.byProduct.beta >= 4);
});

// ---------------------------------------------------------------- AC5

test("AC5: the report and the summary count opened sessions apart from opened signals", (t) => {
  const map = {
    window: { start: BOUNDARY, end: NOW },
    counters: { sessions: 6, byProduct: { alpha: 6 }, byKind: { orchestrator: 6 }, byVersion: {} },
    sessions: ["s1", "s2", "s3", "s4"].map((id) => ({ id, ids: [id], product: "alpha", kind: "orchestrator", loads: [] })),
  };
  const signals = {
    order: ["g1", "g2", "g3", "g4", "g5", "g6"],
    signals: [...["g1", "g2", "g3", "g4", "g5"].map((id) => ({ id, session: "s1" })), { id: "g6", session: null }],
  };
  const opened = { signals: signals.order, sessions: ["s2", "s3", "s4"] };
  const breakdown = openedBreakdown(map, signals, opened);
  assert.equal(breakdown.sessions, 4);
  assert.equal(breakdown.signalSessions, 1);
  assert.equal(breakdown.sampleSessions, 3);
  const text = renderReport({ passUuid: "p", map, findings: [], selection: { triage: [], queued: [], rows: [] }, signals, opened, checks: { dropped: [] } });
  assert.match(text, /открыто сессий 4 \(по сигналам 1, выборка 3\)\. Сигналы: всего 6, открыто 6, неоткрытых 0\./);

  const w = world(t);
  const { passUuid, signals: live } = prepare(w);
  const linked = live.signals.filter((signal) => signal.session);
  ok(w.env, ["opened", ...live.order, ...live.random.map((entry) => entry.session), "--session", ME, "--now", NOW]);
  const summary = ok(w.env, ["summary", "--session", ME, "--now", NOW]);
  const sessions = new Set([...linked.map((signal) => signal.session), ...live.random.map((entry) => entry.session)]).size;
  assert.equal(summary.sessions.opened, sessions);
  assert.equal(summary.signals.opened, live.order.length);
  assert.notEqual(summary.sessions.opened, live.order.length + live.random.length, "signals are not sessions");
  assert.match(summary.text, new RegExp(`открыл ${sessions} сесси\\S* и ${live.order.length} сигнал`));
  assert.ok(passUuid);
});

// ---------------------------------------------------------------- AC6

test("AC6: every digest line carries its event key and check takes a pointer copied from it", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const ownerText = fs.readFileSync(ok(w.env, ["extract", IDS.owner, "--session", ME]).chunks[0].file, "utf8");
  const events = ownerText.split("## events\n\n")[1].split("\n").filter((line) => /^\[(\d{4}-|part )/.test(line));
  assert.ok(events.length > 3);
  for (const line of events) assert.match(line, /^\[\S+ #\S+\] [a-z-]+: /, line);
  const workerText = fs.readFileSync(ok(w.env, ["extract", IDS.worker, "--session", ME]).chunks[0].file, "utf8");
  const claudeKey = digestKey(ownerText, "Continuing after the boundary.");
  const codexKey = digestKey(workerText, "Implement task ALPHA-12.");
  const checked = ok(w.env, ["check", save(w, passUuid, "pointers.json", [
    finding("claude-hash", { session: IDS.owner, event: claudeKey }, "Continuing after the boundary."),
    finding("codex-bare", { session: IDS.worker, event: codexKey.slice(1) }, "Implement task ALPHA-12.", { stage: "implement" }),
  ]), "--session", ME, "--now", NOW]);
  assert.deepEqual(checked.results.map((result) => [result.id, result.status]), [["claude-hash", "kept"], ["codex-bare", "kept"]]);
  assert.equal(checked.results[0].pointer.event, claudeKey.slice(1), "the stored pointer has no #");
});

// ---------------------------------------------------------------- AC7

test("AC7: SKILL.md routes the mandatory layer and the brief; the brief is generic and asks for Russian", () => {
  const skill = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  const brief = fs.readFileSync(path.join(SKILL, "references", "opening-brief.md"), "utf8");
  assert.ok(skill.includes("references/opening-brief.md"));
  assert.ok(skill.includes("reportTeam"));
  assert.match(skill, /`signals`/);
  assert.match(skill, /`op sent`/);
  assert.match(brief, /по-русски/);
  assert.match(brief, /#/);
  for (const pattern of [/\/Users\//, /~\//, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, /\bZeni\b/, /\bv\d+\.\d+\.\d+\b/]) {
    assert.doesNotMatch(brief, pattern);
  }
});

// ---------------------------------------------------------------- review round 1

test("AC6: an extra signal bounded by digest keys gets the times of those events", (t) => {
  const w = world(t);
  const passUuid = ok(w.env, ["collect", "--session", ME, "--now", NOW]).passUuid;
  const text = fs.readFileSync(ok(w.env, ["extract", IDS.owner, "--session", ME]).chunks[0].file, "utf8");
  const from = digestKey(text, "Continuing after the boundary.");
  const to = digestKey(text, "Which page next?");
  const extra = save(w, passUuid, "extra.json", [{ session: IDS.owner, from, to: to.slice(1), reason: "intervention" }]);
  const result = ok(w.env, ["signals", "--extra", extra, "--session", ME, "--now", NOW]);
  const signal = result.signals.find((candidate) => candidate.session === IDS.owner && candidate.reasons.includes("intervention"));
  assert.deepEqual(signal.range.first, { key: from.slice(1), ts: at(BOUNDARY, 31) });
  assert.deepEqual(signal.range.last, { key: to.slice(1), ts: at(BOUNDARY, 32) });
  const bad = run(w.env, ["signals", "--extra", save(w, passUuid, "bad.json", [{ session: IDS.owner, from: "#no-such-event" }]), "--session", ME, "--now", NOW]);
  assert.equal(bad.status, 2);
  assert.match(bad.err.error, /neither a time nor an event/);
});

test("AC4: after several takeovers the budget counts every holder of the pass", (t) => {
  const A = "c1111111-1111-4111-8111-111111111111";
  const B = "c2222222-2222-4111-8111-111111111111";
  const C = "c3333333-3333-4111-8111-111111111111";
  const usage = { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 900, output_tokens: 4 };
  const w = world(t, {
    extra: (built) => {
      for (const [id, minute] of [[A, 1], [B, 3], [C, 5]]) {
        const c = claude(id, built.alpha);
        const file = path.join(built.projectDir, `${id}.jsonl`);
        jsonl(file, [c.say(at(NOW, minute), "working", `msg_${id.slice(0, 8)}`, usage)]);
        const later = new Date(Date.parse(NOW) + 10 * 60000);
        fs.utimesSync(file, later, later);
      }
    },
  });
  ok(w.env, ["collect", "--session", A, "--now", NOW]);
  ok(w.env, ["collect", "--session", B, "--now", at(NOW, 2), "--take-over"]);
  ok(w.env, ["collect", "--session", C, "--now", at(NOW, 4), "--take-over"]);
  assert.deepEqual(readJson(path.join(w.data, "state.json")).pending.holders, [A, B, C]);
  const opened = ok(w.env, ["opened", "--session", C, "--now", at(NOW, 6)]);
  assert.equal(opened.budget.tokens.used, 3 * (1 + 2 + 4), "A, B and C each spent 7 without cache reads");
  assert.equal(opened.budget.tokens.cacheReadApart, 3 * 900);
});
