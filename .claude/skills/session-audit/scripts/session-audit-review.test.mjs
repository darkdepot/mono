// The weekly analysis and the writes of a pass (MONO-478): signals, checks,
// registry outcomes, Triage selection, the write plan with lost answers,
// the commit and the summary. Linear answers come from a fake workspace.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makePackRepo } from "../fixtures/pack.mjs";
import { PROJECT, REVIEW_IDS, TEAM, addPathHintSession, addSignalSources, eventKey, fakeLinear, writeChangelog } from "../fixtures/review.mjs";
import { BOUNDARY, IDS, NOW, at, buildWorld } from "../fixtures/sessions.mjs";
import { guardText } from "./publish.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "session-audit.mjs");
const ME = IDS.audit;
const OTHER = "88888888-2222-4111-8111-111111111111";

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "session-audit-review-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function world(t, { personal = { projectId: PROJECT, triageTeam: TEAM }, changelog = null, registry = null } = {}) {
  const root = scratch(t);
  const repo = makePackRepo(path.join(root, "pack-repo"));
  if (changelog) writeChangelog(repo, changelog);
  const built = buildWorld(root, { repo });
  const sources = addSignalSources(built);
  addPathHintSession(built);
  const data = path.join(root, "data");
  fs.mkdirSync(data, { recursive: true });
  if (personal) fs.writeFileSync(path.join(data, "config.json"), JSON.stringify(personal));
  if (registry) fs.writeFileSync(path.join(data, "findings.json"), JSON.stringify({ findings: registry }));
  const env = { PATH: process.env.PATH, HOME: built.home, SESSION_AUDIT_HOME: data, SESSION_AUDIT_REPO: repo };
  return { root, repo, data, env, sources, ...built };
}

function run(env, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
  return { status: result.status, out: parse(result.stdout), err: parse(result.stderr), stderr: result.stderr, stdout: result.stdout };
}

function ok(env, args) {
  const result = run(env, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
  return result.out;
}

function pass(w, now = NOW) {
  return ok(w.env, ["collect", "--session", ME, "--now", now]).passUuid;
}

// Files the session saves under the pass folder (subagent results, Linear answers).
function save(w, passUuid, name, value) {
  const file = path.join(w.data, "runs", passUuid, "inbox", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function file(w, id) {
  return path.join(w.projectDir, `${id}.jsonl`);
}

const measured = (value, kind = "ledger") => ({ value, mark: "measured", source: { kind, ref: "fixture" } });
const estimate = (value) => ({ value, mark: "estimate" });
const unknown = { value: null, mark: "unknown" };

// A valid pack finding in the owner session; fields can be overridden.
function ownerFinding(w, id, extra = {}) {
  return {
    id,
    kind: "broken",
    scope: "pack",
    stage: "review",
    pointer: { session: IDS.owner, event: eventKey(file(w, IDS.owner), "Continuing after the boundary."), ts: at(BOUNDARY, 31) },
    quote: "Continuing after the boundary.",
    mechanism: "The review step went on without reading the request first.",
    proposal: "Make the first review step a check that the request was read.",
    latest: { file: "skills/review/SKILL.md", text: "Step 1: read the artifact named in the request" },
    cost: { stops: measured(1), interventions: measured(0), extraRounds: unknown, minutes: estimate(15) },
    ...extra,
  };
}

// Drives every planned operation through the fake Linear, as the session
// does with MCP: next, sent, the call, the saved answer, confirm.
function applyPlan(w, passUuid, linear, { stopAfter = Infinity, now = NOW } = {}) {
  let done = 0;
  for (;;) {
    const next = ok(w.env, ["op", "next", "--session", ME, "--now", now]);
    if (next.done) return { done: true };
    if (next.next !== "send") return next;
    if (done >= stopAfter) return { stoppedAt: next.key };
    const sent = ok(w.env, ["op", "sent", next.key, "--session", ME, "--now", now]);
    const answer = linear.call(sent.call, now);
    ok(w.env, ["op", "confirm", next.key, "--response", save(w, passUuid, `answer-${next.key}.json`, answer), "--session", ME, "--now", now]);
    done += 1;
  }
}

function analyse(w, passUuid, findings, { linear = null } = {}) {
  ok(w.env, ["signals", "--session", ME, "--now", NOW]);
  const checked = ok(w.env, ["check", save(w, passUuid, "findings.json", findings), "--session", ME, "--now", NOW]);
  const args = ["register", "--session", ME, "--now", NOW];
  if (linear) args.push("--linear", save(w, passUuid, "linear.json", linear));
  const registered = ok(w.env, args);
  const selected = ok(w.env, ["select", "--session", ME, "--now", NOW]);
  return { checked, registered, selected };
}

// ---------------------------------------------------------------- signals

test("signals: linked by a written id only, ordered by cost, three random sessions of different kinds, queue with ranges", (t) => {
  const w = world(t);
  const passUuid = pass(w);
  const result = ok(w.env, ["signals", "--session", ME, "--now", NOW]);
  const bySource = (needle) => result.signals.filter((signal) => String(signal.source.path).includes(needle) || String(signal.source.line).includes(needle));
  const parked = result.signals.find((signal) => signal.reasons.includes("stop") && signal.source.kind === "ledger");
  assert.equal(parked.session, IDS.worker, "the ledger line names the worker id");
  assert.deepEqual(parked.range.first.key !== undefined, true);
  const attempt = result.signals.find((signal) => signal.reasons.includes("attempt") && signal.source.kind === "ledger");
  assert.equal(attempt.session, null, "no id in the line: «без связи»");
  assert.equal(attempt.cost.attempt, 2);
  const intervention = result.signals.find((signal) => signal.reasons.includes("intervention"));
  assert.equal(intervention.session, null);
  const receipt = result.signals.find((signal) => signal.source.kind === "review-receipt");
  assert.deepEqual(receipt.reasons, ["not-converged"]);
  const long = result.signals.find((signal) => signal.reasons.includes("long-phase"));
  assert.equal(long.session, IDS.codexOwner);
  assert.equal(long.cost.length, 60);
  assert.equal(bySource("ALPHA-23").length, 1, "blocked phase with attempt 2 is one signal");
  assert.deepEqual(bySource("ALPHA-23")[0].reasons.sort(), ["attempt", "blocked"]);
  assert.equal(bySource("ALPHA-20").length + bySource("ALPHA-21").length, 0, "ordinary phases give no signal");
  assert.deepEqual(bySource("ALPHA-24").map((signal) => signal.reasons), [["qa-failed"]], "the verdict is read from the mono-qa certificate");
  assert.equal(bySource("ALPHA-25").length, 0, "a passed tester report gives no signal");

  // Order: stops first (linked worker before unlinked by tie-break), then
  // the intervention, then extra rounds, attempt, length.
  const order = result.signals.map((signal) => signal.reasons.join("+"));
  const firstNonStop = order.findIndex((reasons) => !/stop|blocked|qa-failed/.test(reasons));
  assert.ok(order.slice(0, firstNonStop).every((reasons) => /stop|blocked|qa-failed/.test(reasons)));
  assert.equal(order[firstNonStop], "intervention");
  assert.equal(order[firstNonStop + 1], "not-converged");

  assert.equal(result.random.length, 3);
  assert.equal(new Set(result.random.map((entry) => entry.kind)).size, 3, "different kinds");
  assert.ok(result.random.every((entry) => entry.session !== IDS.worker && entry.session !== IDS.codexOwner), "sample is from sessions without signals");
  const again = ok(w.env, ["signals", "--session", ME, "--now", NOW]);
  assert.deepEqual(again.random, result.random, "seeded by the pass uuid");
  assert.deepEqual(again.order, result.order, "a rerun does not duplicate");

  const queue = readJson(path.join(w.data, "queue.json"));
  assert.equal(queue.signals.length, result.signals.length);
  const queuedWorker = queue.signals.find((signal) => signal.session === IDS.worker);
  assert.ok(queuedWorker.range.first.ts && queuedWorker.range.last.ts, "queue keeps the event range");
  assert.ok(queuedWorker.sessionRef.files.length, "and what is needed to open it later");

  const budget = ok(w.env, ["opened", parked.id, result.random[0].session, "--session", ME, "--now", at(NOW, 10)]);
  assert.deepEqual(budget.opened.signals, [parked.id]);
  assert.deepEqual(budget.opened.sessions, [result.random[0].session]);
  assert.equal(budget.budget.minutes.used, 10);
  assert.equal(budget.budget.exhausted, false);
  const late = ok(w.env, ["opened", "--session", ME, "--now", at(NOW, 91)]);
  assert.equal(late.budget.exhausted, true, "past the minutes budget the pass is spent");
  assert.ok(late.unopened.length === result.signals.length - 1);
  assert.equal(run(w.env, ["opened", "S-unknown", "--session", ME, "--now", NOW]).status, 2);
  assert.equal(passUuid, budget.passUuid);
});

// ---------------------------------------------------------------- check

test("check: evidence in the source event or ledger line, rule places per tag, guesses, versions by path, screen findings", (t) => {
  const w = world(t);
  const passUuid = pass(w);
  const ledgerLine = readJson(path.join(w.data, "runs", passUuid, "map.json")).sources.ledger.find((line) => fs.readFileSync(line.path, "utf8").split("\n")[line.line - 1].includes("owner stopped"));
  const findings = [
    ownerFinding(w, "kept-rule", { rule: { file: "skills/review/SKILL.md", text: "Step 9: suggest one fix per finding" } }),
    ownerFinding(w, "no-quote", { quote: "A sentence that was never said." }),
    ownerFinding(w, "wrong-event", { pointer: { session: IDS.owner, event: eventKey(file(w, IDS.owner), "Please continue. Earlier it said") } }),
    {
      ...ownerFinding(w, "unlinked"), kind: "intervention", stage: "orchestrate",
      pointer: { source: ledgerLine.path, line: ledgerLine.line, ts: ledgerLine.ts }, quote: "owner stopped ALPHA-15",
    },
    { ...ownerFinding(w, "unlinked-bad"), kind: "intervention", pointer: { source: ledgerLine.path, line: ledgerLine.line }, quote: "owner approved everything" },
    {
      ...ownerFinding(w, "rule-missing"), stage: "implement",
      pointer: { session: IDS.readsBoth, event: eventKey(file(w, IDS.readsBoth), "\"toolu_r2\",\"name\":\"Read\""), ts: at(BOUNDARY, 101) },
      quote: "guide.md", rule: { file: "references/guide.md", text: "Guide closing line for the first release." },
    },
    {
      ...ownerFinding(w, "guess"), kind: "guess", stage: "implement",
      pointer: { session: IDS.readsBoth, event: eventKey(file(w, IDS.readsBoth), "\"toolu_r2\",\"name\":\"Read\""), ts: at(BOUNDARY, 101) },
      quote: "guide.md", rule: { file: "skills/implement/SKILL.md", text: "Always ask the owner before every step." },
    },
    {
      ...ownerFinding(w, "guess-exists"), kind: "guess",
      rule: { file: "skills/review/SKILL.md", text: "check every claim against its source" },
    },
    {
      ...ownerFinding(w, "no-version-rule"), stage: "implement",
      pointer: { session: IDS.readsNone, event: eventKey(file(w, IDS.readsNone), "\"toolu_r3\",\"name\":\"Read\"") }, quote: "guide.md",
      rule: { file: "references/guide.md", text: "Guide rule 1 of the invented pack." },
    },
    {
      ...ownerFinding(w, "no-version-time"), kind: "time-loss", stage: "implement",
      pointer: { session: IDS.readsNone, event: eventKey(file(w, IDS.readsNone), "\"toolu_r3\",\"name\":\"Read\"") }, quote: "guide.md",
    },
    {
      ...ownerFinding(w, "by-path"), stage: "implement",
      pointer: { session: REVIEW_IDS.byPath, event: eventKey(file(w, REVIEW_IDS.byPath), "The invented change is done.") }, quote: "The invented change is done.",
      rule: { file: "skills/implement/SKILL.md", text: "implement action number 3 of the invented flow" },
    },
    ownerFinding(w, "screen", { screen: true }),
    ownerFinding(w, "cost-marks", { cost: { stops: { value: 2, mark: "measured" }, interventions: measured(1, "receipt"), extraRounds: estimate(1), minutes: unknown } }),
  ];
  const result = ok(w.env, ["check", save(w, passUuid, "proposals.json", findings), "--session", ME, "--now", NOW]);
  const by = Object.fromEntries(result.results.map((entry) => [entry.id, entry]));
  assert.equal(by["kept-rule"].status, "kept");
  assert.deepEqual(by["kept-rule"].version.tags, ["v0.1.0"]);
  assert.equal(by["kept-rule"].latest.canHappen, true);
  assert.equal(by["no-quote"].reason, "no-evidence");
  assert.equal(by["wrong-event"].reason, "no-evidence", "the quote must be in the named event");
  assert.equal(by.unlinked.status, "kept", "«без связи» is checked against the ledger line");
  assert.equal(by.unlinked.session, null);
  assert.equal(by["unlinked-bad"].reason, "no-evidence");
  assert.equal(by["rule-missing"].reason, "rule-not-found", "the rule must be in every tag of v0.1.0..v0.2.0");
  assert.equal(by.guess.status, "kept");
  assert.equal(by["guess-exists"].reason, "rule-exists");
  assert.equal(by["no-version-rule"].reason, "no-version");
  assert.equal(by["no-version-time"].status, "kept");
  assert.equal(by["no-version-time"].version.status, "unknown");
  assert.equal(by["by-path"].status, "kept");
  assert.deepEqual(by["by-path"].version, { status: "by-path", tags: ["v0.2.0"], range: "v0.2.0", byPath: true });
  assert.equal(by.screen.status, "needs-owner");
  assert.deepEqual(by["cost-marks"].cost.stops, { value: 2, mark: "estimate" }, "measured without a source is an estimate");
  assert.equal(by["cost-marks"].cost.interventions.mark, "measured");
  assert.equal(by["cost-marks"].cost.minutes.mark, "unknown");
  assert.equal(result.dropped, 6);
  assert.ok(!JSON.stringify(result).includes("Continuing after the boundary."), "quotes stay in the files");
  const stored = readJson(path.join(w.data, "runs", passUuid, "checked", "kept-rule.json"));
  assert.equal(stored.quote, "Continuing after the boundary.");

  const outside = path.join(w.root, "outside.json");
  fs.writeFileSync(outside, JSON.stringify(findings[0]));
  assert.equal(run(w.env, ["check", outside, "--session", ME, "--now", NOW]).status, 2, "inputs only from the pass folder");
  const recheck = ok(w.env, ["check", save(w, passUuid, "recheck.json", [ownerFinding(w, "kept-rule", { quote: "Not said at all." })]), "--session", ME, "--now", NOW]);
  assert.equal(recheck.results[0].reason, "no-evidence");
  assert.equal(fs.existsSync(path.join(w.data, "runs", passUuid, "checked", "kept-rule.json")), false, "a failed re-check removes the kept version");
  const reused = { ...findings[3], id: "screen" };
  assert.equal(run(w.env, ["check", save(w, passUuid, "reused.json", [reused]), "--session", ME, "--now", NOW]).status, 2, "an id used for another place is refused");
  assert.equal(run(w.env, ["check", save(w, passUuid, "twice.json", [findings[0], findings[0]]), "--session", ME, "--now", NOW]).status, 2);
  const longText = ownerFinding(w, "too-long", { proposal: "x".repeat(301) });
  assert.equal(run(w.env, ["check", save(w, passUuid, "long.json", longText), "--session", ME, "--now", NOW]).status, 2);
});

// ---------------------------------------------------------------- registry

const OLD_PASS = "0ld00000-0000-4000-8000-000000000000".replace("0ld", "01d");

function registryEntry(id, issue, stage) {
  return { id, mechanism: `Invented mechanism of ${id}.`, features: { stage, kind: "broken" }, kind: "broken", scope: "pack", stage, issue, outcome: "triage", encounters: [{ pass: OLD_PASS, session: "s-old", versions: ["v0.1.0"] }] };
}

test("AE2: returned after fixed_in goes to Triage, before it is a repeat, a rejected one keeps its decision", (t) => {
  const registry = [
    registryEntry("F-aaaaaaaa-0000-4000-8000-000000000001", "MONO-901", "implement"),
    registryEntry("F-aaaaaaaa-0000-4000-8000-000000000002", "MONO-902", "review"),
    registryEntry("F-aaaaaaaa-0000-4000-8000-000000000003", "MONO-903", "implement"),
    registryEntry("F-aaaaaaaa-0000-4000-8000-000000000004", "MONO-904", "review"),
    registryEntry("F-aaaaaaaa-0000-4000-8000-000000000005", "MONO-905", "review"),
    registryEntry("F-aaaaaaaa-0000-4000-8000-000000000006", "MONO-906", "review"),
  ];
  const w = world(t, { changelog: { "0.2.0": ["MONO-901", "MONO-902", "MONO-903"] }, registry });
  const passUuid = pass(w);
  const workerEvent = { session: IDS.worker, event: null };
  const workerFile = fs.readdirSync(path.join(w.home, ".codex", "sessions", "2026", "11", "22")).find((name) => name.includes(IDS.worker));
  const workerLines = fs.readFileSync(path.join(w.home, ".codex", "sessions", "2026", "11", "22", workerFile), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  workerEvent.event = workerLines.find((line) => JSON.stringify(line).includes("Implemented.")).payload.id;
  const readsBothEvent = { session: IDS.readsBoth, event: eventKey(file(w, IDS.readsBoth), "\"toolu_r2\",\"name\":\"Read\"") };
  const base = (id, sameAs, pointer, quote, stage) => ({ ...ownerFinding(w, id), stage, sameAs, pointer, quote });
  const findings = [
    base("returned", registry[0].id, workerEvent, "Implemented.", "implement"),
    base("before", registry[1].id, ownerFinding(w, "x").pointer, "Continuing after the boundary.", "review"),
    base("crossing", registry[2].id, readsBothEvent, "guide.md", "implement"),
    base("rejected", registry[3].id, ownerFinding(w, "x").pointer, "Continuing after the boundary.", "review"),
    base("open-dup", registry[4].id, ownerFinding(w, "x").pointer, "Continuing after the boundary.", "review"),
    base("done-unknown", registry[5].id, ownerFinding(w, "x").pointer, "Continuing after the boundary.", "review"),
  ];
  const linear = [
    { id: "MONO-901", status: "Done", statusType: "completed", url: "https://linear.app/fixture/issue/MONO-901" },
    { id: "MONO-902", status: "Done", statusType: "completed" },
    { id: "MONO-903", status: "Done", statusType: "completed" },
    { id: "MONO-904", status: "Canceled", statusType: "canceled", mechanismRemoved: true, url: "https://linear.app/fixture/issue/MONO-904" },
    { id: "MONO-905", status: "Duplicate", statusType: "canceled", duplicateOf: "MONO-907" },
    { id: "MONO-907", status: "Todo", statusType: "unstarted" },
    { id: "MONO-906", status: "Done", statusType: "completed" },
  ];
  const { registered, selected } = analyse(w, passUuid, findings, { linear });
  const outcome = Object.fromEntries(registered.findings.map((finding) => [finding.proposals[0], finding]));
  assert.equal(outcome.returned.outcome, "returned");
  assert.equal(outcome.returned.fixedIn, "v0.2.0");
  assert.equal(outcome.before.outcome, "repeat-before-fix");
  assert.equal(outcome.crossing.outcome, "repeat-version-ambiguous");
  assert.equal(outcome.rejected.outcome, "rejected");
  assert.equal(outcome["open-dup"].outcome, "repeat-open", "a Duplicate follows its main issue");
  assert.equal(outcome["open-dup"].linear.issue, "MONO-907");
  assert.equal(outcome["done-unknown"].outcome, "repeat-fix-unknown");
  assert.deepEqual(selected.triage.map((entry) => [entry.id, entry.action]), [[registry[0].id, "reopen"]]);

  const linearWs = fakeLinear();
  linearWs.seedIssue({ id: "MONO-901", identifier: "MONO-901", status: "Done", statusType: "completed", description: "old" });
  const planned = ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const ops = planned.ops.map((op) => [op.key, op.type]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(ops, [
    [`${registry[0].id}.comment`, "create-comment"],
    [`${registry[0].id}.triage`, "update-issue"],
    [`${registry[4].id}.comment`, "create-comment"],
    [`${registry[5].id}.comment`, "create-comment"],
    ["report", "create-document"],
  ], "no op touches the rejected, the repeat before the fix or the ambiguous one");
  const plan = readJson(path.join(w.data, "runs", passUuid, "plan.json"));
  const report = plan.ops[0].body;
  assert.match(report, /Отклонённые раньше\n.*MONO-904 https:\/\/linear\.app\/fixture\/issue\/MONO-904.*прежнее решение: Canceled, снято вместе с механизмом/);
  assert.match(report, /Повторы до исправления\n/);
  assert.match(report, /Повторы, версия неоднозначна\n/);
  assert.equal(plan.ops.find((op) => op.key === `${registry[4].id}.comment`).target, "MONO-907", "the repeat of a Duplicate is noted on its main issue");
  linearWs.seedIssue({ id: "MONO-907", identifier: "MONO-907", status: "Todo", statusType: "unstarted" });
  linearWs.seedIssue({ id: "MONO-906", identifier: "MONO-906", status: "Done", statusType: "completed" });
  assert.deepEqual(applyPlan(w, passUuid, linearWs), { done: true });
  assert.equal(linearWs.issues.find((issue) => issue.id === "MONO-901").statusType, "triage", "returned goes back to Triage");
  assert.equal(linearWs.issues.filter((issue) => issue.createdAt === NOW).length, 0, "no new issue for a repeat");
  const committed = ok(w.env, ["commit", "--session", ME, "--now", NOW]);
  assert.equal(committed.committed, true);
  const saved = readJson(path.join(w.data, "findings.json")).findings;
  assert.equal(saved.find((entry) => entry.id === registry[0].id).outcome, "returned");
  assert.equal(saved.find((entry) => entry.id === registry[3].id).issue, "MONO-904", "the rejected issue is kept as it was");
});

// ---------------------------------------------------------------- AE3 and selection

test("AE3 and R4: one guess in two sessions with marked cost, different mechanisms of one rule stay apart, five to Triage, the rest queued", (t) => {
  const w = world(t);
  const passUuid = pass(w);
  const reviewer = (id, extra) => ownerFinding(w, id, extra);
  const guessRule = { file: "skills/review/SKILL.md", text: "Always confirm the plan with the owner before reviewing." };
  const guessCost = { stops: unknown, interventions: measured(0), extraRounds: measured(1, "receipt"), minutes: estimate(20) };
  const readsBothPointer = { session: IDS.readsBoth, event: eventKey(file(w, IDS.readsBoth), "\"toolu_r2\",\"name\":\"Read\""), ts: at(BOUNDARY, 101) };
  const findings = [
    reviewer("guess-1", { kind: "guess", rule: guessRule, cost: guessCost, mechanism: "The stage followed an owner-confirmation rule that the pack does not have." }),
    { ...reviewer("guess-2", { kind: "guess", rule: guessRule, sameAs: "guess-1", cost: { stops: unknown, interventions: measured(0), extraRounds: measured(0, "receipt"), minutes: unknown } }), stage: "implement", pointer: readsBothPointer, quote: "guide.md" },
    reviewer("same-rule-other", { cost: { stops: measured(0), interventions: measured(0), extraRounds: unknown, minutes: unknown }, rule: { file: "skills/review/SKILL.md", text: "Step 9: suggest one fix per finding" }, mechanism: "The review listed three fixes for one finding." }),
    reviewer("same-rule-third", { cost: { stops: measured(0), interventions: measured(0), extraRounds: unknown, minutes: unknown }, rule: { file: "skills/review/SKILL.md", text: "Step 9: suggest one fix per finding" }, mechanism: "The review gave a fix without naming the finding place." }),
    reviewer("stop-2", { mechanism: "The review stopped twice on a missing artifact name.", cost: { stops: measured(2), interventions: measured(0), extraRounds: unknown, minutes: unknown } }),
    reviewer("intervene", { mechanism: "The owner had to restate the review scope.", cost: { stops: measured(0), interventions: measured(1), extraRounds: unknown, minutes: estimate(5) } }),
    reviewer("minutes-only", { mechanism: "The review reread the same page for a long time.", cost: { stops: measured(1), interventions: unknown, extraRounds: unknown, minutes: estimate(90) } }),
    reviewer("stop-1-known", { mechanism: "The review waited on a missing report.", cost: { stops: measured(1), interventions: measured(0), extraRounds: unknown, minutes: unknown } }),
    reviewer("product", { scope: "product", mechanism: "Something inside the product broke." }),
    reviewer("changed", { rule: { file: "skills/review/SKILL.md", text: "Step 9: suggest one fix per finding" }, changed: { file: "skills/review/SKILL.md", text: "Step 9: suggest at most two fixes per finding" }, mechanism: "The review limited fixes in a way the pack later changed." }),
    reviewer("screen", { screen: true, mechanism: "The owner saw a wrong status on the screen." }),
  ];
  const { registered, selected } = analyse(w, passUuid, findings);
  const byProposal = Object.fromEntries(registered.findings.flatMap((finding) => finding.proposals.map((proposal) => [proposal, finding])));
  const guess = byProposal["guess-1"];
  assert.equal(byProposal["guess-2"].id, guess.id, "the same invented rule in two sessions is one finding");
  assert.equal(guess.kind, "guess");
  assert.equal(guess.sessionsTotal, 2);
  assert.deepEqual(guess.cost, {
    stops: { value: null, mark: "unknown" },
    interventions: { value: 0, mark: "measured" },
    extraRounds: { value: 1, mark: "measured" },
    minutes: { value: 20, mark: "estimate" },
  });
  assert.notEqual(byProposal["same-rule-other"].id, byProposal["same-rule-third"].id, "different mistakes of one rule are different findings");

  const order = selected.triage.map((entry) => Object.keys(byProposal).find((key) => byProposal[key].id === entry.id));
  // stops 2 > stops 1 (interventions known 0 before unknown) > stops 1 unknown
  // interventions > interventions 1 > guess (rounds 1); the rest are queued.
  assert.deepEqual(order, ["stop-2", "stop-1-known", "minutes-only", "intervene", "guess-1"]);
  assert.equal(selected.triage.length, 5);
  const queuedNames = selected.queued.map((entry) => Object.keys(byProposal).find((key) => byProposal[key].id === entry.id));
  assert.deepEqual(queuedNames.sort(), [], "two single-session findings without stop or intervention are not worth Triage");
  const rows = Object.fromEntries(selected.rows.map((row) => [Object.keys(byProposal).find((key) => byProposal[key].id === row.id), row.row]));
  assert.equal(rows.product, "product");
  assert.equal(rows.changed, "already-changed");
  assert.equal(rows.screen, "needs-owner");
  assert.equal(rows["same-rule-other"], "report-only");

  // A sixth worthy finding: queued now, competes again in the next pass.
  const extra = reviewer("stop-3", { mechanism: "The review stopped on a missing source note.", cost: { stops: measured(1), interventions: measured(0), extraRounds: unknown, minutes: estimate(1) } });
  ok(w.env, ["check", save(w, passUuid, "more.json", [extra]), "--session", ME, "--now", NOW]);
  const registered2 = ok(w.env, ["register", "--session", ME, "--now", NOW]);
  const again = ok(w.env, ["select", "--session", ME, "--now", NOW]);
  assert.equal(again.triage.length, 5);
  const queuedId = again.queued.map((entry) => entry.id);
  assert.equal(queuedId.length, 1);
  const stillGuess = registered2.findings.find((finding) => finding.id === guess.id);
  assert.equal(stillGuess.id, guess.id, "ids stay the same on a rerun");

  const linear = fakeLinear();
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const plan = readJson(path.join(w.data, "runs", passUuid, "plan.json"));
  assert.equal(plan.ops.filter((op) => op.type === "create-issue").length, 5, "at most five issues per pass");
  const report = plan.ops[0].body;
  assert.match(report, /\nВ очередь\n/);
  assert.match(report, /\nО продукте\nF-[0-9a-f-]+ · этап review · вид сломалось или нарушено правило\n/, "product rows carry only kind and stage");
  assert.ok(!report.includes("Something inside the product broke."));
  assert.match(report, /\nНужно подтверждение владельца\n/);
  assert.match(report, /\nУже изменено\n/);
  assert.deepEqual(applyPlan(w, passUuid, linear), { done: true });
  assert.ok(linear.issues.every((issue) => issue.statusType === "triage" && issue.team === TEAM));
  const summary = ok(w.env, ["summary", "--session", ME, "--now", at(NOW, 30)]);
  assert.equal(summary.confirm.length, 1);
  assert.match(summary.text, /От тебя: подтвердить 1 находку про экран/);

  // The owner confirms the screen finding in the same session: the plan grows.
  const screenProposal = "screen";
  ok(w.env, ["confirm", screenProposal, "--yes", "--session", ME, "--now", NOW]);
  ok(w.env, ["register", "--session", ME, "--now", NOW]);
  ok(w.env, ["select", "--session", ME, "--now", NOW]);
  const reselected = readJson(path.join(w.data, "runs", passUuid, "selection.json"));
  const triageIds = reselected.triage.map((entry) => entry.id);
  assert.ok(reselected.queued.every((entry) => !triageIds.includes(entry.id)), "Triage and queue do not overlap");
  const grown = ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  assert.ok(grown.ops.some((op) => op.type === "update-document"), "the report is updated with the owner's answer");
  assert.equal(grown.ops.filter((op) => op.type === "create-issue").length, 5, "the cap still holds");
  assert.deepEqual(applyPlan(w, passUuid, linear), { done: true });
  assert.equal(linear.documents.length, 1, "one report per pass");
  const committed = ok(w.env, ["commit", "--session", ME, "--now", at(NOW, 40)]);
  const registry = readJson(path.join(w.data, "findings.json")).findings;
  const queued = registry.filter((entry) => entry.outcome === "queued");
  assert.ok(queued.length >= 1);
  assert.ok(committed.summary.findings.queued.length >= 1);

  // Next pass: the queued finding competes again without a new case.
  const later = at(NOW, 24 * 60);
  const next = ok(w.env, ["collect", "--session", ME, "--now", later]);
  assert.notEqual(next.passUuid, passUuid);
  ok(w.env, ["signals", "--session", ME, "--now", later]);
  ok(w.env, ["register", "--session", ME, "--now", later]);
  const carried = ok(w.env, ["select", "--session", ME, "--now", later]);
  assert.ok(carried.triage.some((entry) => entry.carried && queued.some((q) => q.id === entry.id)), "a queued finding is picked in the next pass");
});

// ---------------------------------------------------------------- guard

test("the publish check refuses quotes, paths, other teams' keys and foreign links", (t) => {
  const w = world(t);
  const passUuid = pass(w);
  ok(w.env, ["extract", IDS.owner, "--session", ME]);
  const config = JSON.parse(fs.readFileSync(path.join(path.dirname(CLI), "..", "config.json"), "utf8"));
  const privateSet = { sequences: new Set(["please continue earlier it said base directory for"]), quotes: ["Continuing after the boundary."] };
  const pointer = `runs/${passUuid}/F-1`;
  const check = (text) => guardText(text, { passUuid, pointers: [pointer], config, privateSet });
  assert.deepEqual(check(`F-1 · этап review · указатель ${pointer} · задача MONO-12 https://linear.app/x/issue/MONO-12`), []);
  assert.match(check("Please continue. Earlier it said: Base directory for this skill").join(), /match a session digest/);
  assert.match(check("He wrote continuing after the boundary. here").join(), /stored finding quote/);
  assert.match(check(`see ${path.join(w.home, "work", "alpha")}`).join(), /path other than the pointer/);
  assert.match(check("see ~/notes for more").join(), /home or drive path/);
  assert.match(check("blocked by ALPHA-12").join(), /issue key of another team: ALPHA-12/);
  assert.match(check("see https://example.com/page").join(), /link outside Linear and mono/);
  assert.match(check("> quoted words").join(), /quoted block/);
  assert.match(check("see https://linear.app/x/issue/ALPHA-7").join(), /issue key of another team: ALPHA-7/);

  // A mechanism with a path or a key of another team stops the plan.
  const leaky = ownerFinding(w, "leaky", { mechanism: "The stage read references/guide.md twice for ALPHA-12." });
  analyse(w, passUuid, [leaky]);
  const refused = run(w.env, ["plan", "--session", ME, "--now", NOW]);
  assert.equal(refused.status, 2);
  assert.match(refused.err.error, /publish check/);
  assert.equal(fs.existsSync(path.join(w.data, "runs", passUuid, "plan.json")), false);

  // A quote that slips into the proposal is caught by the digest overlap.
  const quoting = ownerFinding(w, "leaky", { mechanism: "The stage moved on.", proposal: "Owner said: Please continue. Earlier it said: Base directory for this skill." });
  ok(w.env, ["check", save(w, passUuid, "quoting.json", [quoting]), "--session", ME, "--now", NOW]);
  ok(w.env, ["register", "--session", ME, "--now", NOW]);
  ok(w.env, ["select", "--session", ME, "--now", NOW]);
  const quoted = run(w.env, ["plan", "--session", ME, "--now", NOW]);
  assert.equal(quoted.status, 2);
  assert.match(JSON.stringify(quoted.err.refused), /session digest/);
});

test("without project and team in the personal config nothing is planned", (t) => {
  const w = world(t, { personal: { runPrefixes: [] } });
  const passUuid = pass(w);
  analyse(w, passUuid, [ownerFinding(w, "one")]);
  const result = run(w.env, ["plan", "--session", ME, "--now", NOW]);
  assert.equal(result.status, 2);
  assert.match(result.err.error, /reportTeam \(or the older projectId\) and triageTeam/);
});

// ---------------------------------------------------------------- AE4

test("AE4: after a crash the same plan continues, lost answers are reconciled by marker, the boundary waits for every write", (t) => {
  const w = world(t);
  // A record still being written (no newline yet) becomes a deferred tail.
  const ownerFile = file(w, IDS.owner);
  fs.appendFileSync(ownerFile, JSON.stringify({ type: "user", uuid: "f2000000-0000-4000-8000-000000000001", timestamp: at(NOW, -1), sessionId: IDS.owner, message: { role: "user", content: "half" } }).slice(0, 40));
  fs.utimesSync(ownerFile, new Date(NOW), new Date(NOW));
  const passUuid = pass(w);
  const findings = [
    ownerFinding(w, "a", { mechanism: "The review skipped the claim list.", cost: { stops: measured(2), interventions: measured(0), extraRounds: unknown, minutes: unknown } }),
    ownerFinding(w, "b", { mechanism: "The review rated risk before checking sources.", cost: { stops: measured(1), interventions: measured(0), extraRounds: unknown, minutes: unknown } }),
    ownerFinding(w, "c", { mechanism: "The review returned the report to the wrong caller.", cost: { stops: measured(1), interventions: unknown, extraRounds: unknown, minutes: unknown } }),
  ];
  analyse(w, passUuid, findings);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  // The report and one issue are written, then the session dies.
  assert.deepEqual(applyPlan(w, passUuid, linear, { stopAfter: 2 }).stoppedAt !== undefined, true);
  const third = ok(w.env, ["op", "next", "--session", ME, "--now", NOW]);
  const sent = ok(w.env, ["op", "sent", third.key, "--session", ME, "--now", NOW]);
  linear.call(sent.call, NOW); // Linear wrote it; the answer never came back.

  const refused = run(w.env, ["commit", "--session", ME, "--now", NOW]);
  assert.equal(refused.status, 2, "not every write is confirmed");
  assert.equal(readJson(path.join(w.data, "state.json")).boundary, null, "the boundary did not move");
  assert.equal(readJson(path.join(w.data, "state.json")).pending.uuid, passUuid);

  // Restart: collect resumes the same pass, the plan is the same plan.
  const resumed = ok(w.env, ["collect", "--session", ME, "--now", at(NOW, 5)]);
  assert.equal(resumed.passUuid, passUuid);
  const before = readJson(path.join(w.data, "runs", passUuid, "plan.json"));
  ok(w.env, ["plan", "--session", ME, "--now", at(NOW, 5)]);
  const after = readJson(path.join(w.data, "runs", passUuid, "plan.json"));
  assert.deepEqual(after.ops.map((op) => [op.key, op.status, op.result?.id ?? null]), before.ops.map((op) => [op.key, op.status, op.result?.id ?? null]));

  const next = ok(w.env, ["op", "next", "--session", ME, "--now", at(NOW, 5)]);
  assert.equal(next.next, "reconcile", "a sent operation without confirmation is not created again");
  assert.equal(run(w.env, ["op", "sent", third.key, "--session", ME, "--now", at(NOW, 5)]).status, 2, "no new create before the reconcile");
  // Linear search is empty for a while: the listing does not show it yet.
  const empty = ok(w.env, ["op", "reconcile", third.key, "--listing", save(w, passUuid, "empty.json", []), "--session", ME, "--now", at(NOW, 5)]);
  assert.equal(empty.found, false);
  const tooSoon = run(w.env, ["op", "reconcile", third.key, "--listing", save(w, passUuid, "empty.json", []), "--session", ME, "--now", at(NOW, 5.5)]);
  assert.equal(tooSoon.status, 2, "the next check waits a minute");
  const listing = save(w, passUuid, "issues.json", linear.issues);
  const found = ok(w.env, ["op", "reconcile", third.key, "--listing", listing, "--session", ME, "--now", at(NOW, 6.5)]);
  assert.equal(found.status, "confirmed");
  assert.equal(applyPlan(w, passUuid, linear, { now: at(NOW, 7) }).done, true);
  assert.equal(linear.issues.length, 3, "no duplicates");
  assert.equal(linear.documents.length, 1, "the report is the same");

  const other = run(w.env, ["commit", "--session", OTHER, "--now", at(NOW, 8)]);
  assert.equal(other.status, 3, "only the holder of the pass commits");
  const state0 = readJson(path.join(w.data, "state.json"));
  const committed = ok(w.env, ["commit", "--session", ME, "--now", at(NOW, 8)]);
  const state = readJson(path.join(w.data, "state.json"));
  assert.equal(state.pending, null);
  assert.equal(state.boundary, state0.pending.windowEnd);
  assert.ok(state0.pending.deferredTails.length >= 1, "the fixture has a tail");
  assert.deepEqual(state.deferredTails, state0.pending.deferredTails, "deferred tails of the pass carry over");
  assert.equal(committed.summary.report.url, linear.documents[0].url);
});

test("lost answers for a document and a comment on an old issue are found by listing; three misses stop with the marker", (t) => {
  const registry = [registryEntry("F-bbbbbbbb-0000-4000-8000-000000000001", "MONO-950", "review")];
  const w = world(t, { registry });
  const passUuid = pass(w);
  const findings = [ownerFinding(w, "repeat", { sameAs: registry[0].id })];
  analyse(w, passUuid, findings, { linear: [{ id: "MONO-950", status: "In Progress", statusType: "started" }] });
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  linear.seedIssue({ id: "MONO-950", identifier: "MONO-950", status: "In Progress", statusType: "started", createdAt: "2026-09-01T00:00:00.000Z" });
  linear.seedComment("MONO-950", "an older comment");

  const doc = ok(w.env, ["op", "next", "--session", ME, "--now", NOW]);
  assert.equal(doc.key, "report");
  const docSent = ok(w.env, ["op", "sent", "report", "--session", ME, "--now", NOW]);
  linear.call(docSent.call, NOW);
  ok(w.env, ["op", "lost", "report", "--session", ME, "--now", NOW]);
  const docFound = ok(w.env, ["op", "reconcile", "report", "--listing", save(w, passUuid, "docs.json", linear.documents), "--session", ME, "--now", NOW]);
  assert.equal(docFound.status, "confirmed");

  const comment = ok(w.env, ["op", "next", "--session", ME, "--now", NOW]);
  assert.equal(comment.call.tool, "save_comment");
  const commentSent = ok(w.env, ["op", "sent", comment.key, "--session", ME, "--now", NOW]);
  linear.call(commentSent.call, NOW);
  ok(w.env, ["op", "lost", comment.key, "--session", ME, "--now", NOW]);
  // Every comment of the old issue is read, whatever the issue's age.
  const commentFound = ok(w.env, ["op", "reconcile", comment.key, "--listing", save(w, passUuid, "comments.json", linear.commentsOf("MONO-950")), "--session", ME, "--now", NOW]);
  assert.equal(commentFound.status, "confirmed");
  assert.equal(linear.comments.length, 2);
  assert.match(linear.comments[1].body, new RegExp(`Проход ${passUuid}`));

  // Another pass where the object never shows up: three checks, then stop.
  const w2 = world(t);
  const pass2 = pass(w2);
  analyse(w2, pass2, [ownerFinding(w2, "one")]);
  ok(w2.env, ["plan", "--session", ME, "--now", NOW]);
  ok(w2.env, ["op", "sent", "report", "--session", ME, "--now", NOW]);
  ok(w2.env, ["op", "lost", "report", "--session", ME, "--now", NOW]);
  const bare = run(w2.env, ["op", "reconcile", "report", "--listing", save(w2, pass2, "bare.json", [{ id: "doc-x", title: "t" }]), "--session", ME, "--now", NOW]);
  assert.equal(bare.status, 2, "a listing without texts is refused and not counted");
  const empty = save(w2, pass2, "empty.json", []);
  ok(w2.env, ["op", "reconcile", "report", "--listing", empty, "--session", ME, "--now", at(NOW, 1)]);
  ok(w2.env, ["op", "reconcile", "report", "--listing", empty, "--session", ME, "--now", at(NOW, 2)]);
  const stuck = run(w2.env, ["op", "reconcile", "report", "--listing", empty, "--session", ME, "--now", at(NOW, 3)]);
  assert.equal(stuck.status, 2);
  assert.equal(stuck.err.marker, `session-audit op=${pass2}/report`);
  assert.equal(run(w2.env, ["op", "next", "--session", ME, "--now", at(NOW, 4)]).status, 2, "stopped until the owner decides");
  assert.equal(run(w2.env, ["commit", "--session", ME, "--now", at(NOW, 4)]).status, 2);
  assert.equal(readJson(path.join(w2.data, "state.json")).pending.uuid, pass2);
  assert.equal(run(w2.env, ["op", "resume", "report", "--session", ME, "--now", at(NOW, 4)]).status, 2, "resume needs the owner's words");
  ok(w2.env, ["op", "resume", "report", "--owner-said", "--session", ME, "--now", at(NOW, 4)]);
});

// ---------------------------------------------------------------- queue across passes

test("a queued signal opens its own range after the boundary moved; an empty run writes nothing", (t) => {
  const w = world(t);
  const passUuid = pass(w);
  const result = ok(w.env, ["signals", "--session", ME, "--now", NOW]);
  const workerSignal = result.signals.find((signal) => signal.session === IDS.worker);
  const opened = result.signals.find((signal) => signal.session === null);
  ok(w.env, ["opened", opened.id, "--session", ME, "--now", NOW]);
  analyse(w, passUuid, [ownerFinding(w, "one")]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  assert.equal(applyPlan(w, passUuid, fakeLinear()).done, true);
  ok(w.env, ["commit", "--session", ME, "--now", NOW]);
  const queue = readJson(path.join(w.data, "queue.json")).signals;
  assert.ok(!queue.some((signal) => signal.id === opened.id), "the opened signal left the queue");
  assert.ok(queue.some((signal) => signal.id === workerSignal.id), "the unopened signal stays in the queue");

  // Next run: no new session events, the queue is not empty.
  const later = at(NOW, 24 * 60);
  const next = ok(w.env, ["collect", "--session", ME, "--now", later]);
  assert.equal(next.sessions, 0);
  assert.equal(next.queueLength, queue.length);
  const extract = ok(w.env, ["extract", IDS.worker, "--session", ME, "--from", workerSignal.range.first.ts, "--to", workerSignal.range.last.ts]);
  const text = fs.readFileSync(extract.chunks[0].file, "utf8");
  assert.ok(text.includes("Implement task ALPHA-12."), "the queued range is opened though the session has no new events");
  const missingRange = run(w.env, ["extract", IDS.worker, "--session", ME]);
  assert.equal(missingRange.status, 2);

  // Clear the queue in this pass, then a run without new events writes nothing.
  const all = ok(w.env, ["signals", "--session", ME, "--now", later]);
  ok(w.env, ["opened", ...all.order, "--session", ME, "--now", later]);
  ok(w.env, ["check", save(w, next.passUuid, "none.json", []), "--session", ME, "--now", later]);
  ok(w.env, ["register", "--session", ME, "--now", later]);
  ok(w.env, ["select", "--session", ME, "--now", later]);
  ok(w.env, ["plan", "--session", ME, "--now", later]);
  assert.equal(applyPlan(w, next.passUuid, fakeLinear(), { now: later }).done, true);
  ok(w.env, ["commit", "--session", ME, "--now", later]);
  assert.deepEqual(readJson(path.join(w.data, "queue.json")).signals, []);
  const snapshot = fs.readdirSync(w.data).sort();
  const runsBefore = fs.readdirSync(path.join(w.data, "runs")).sort();
  const empty = ok(w.env, ["collect", "--session", ME, "--now", at(later, 60)]);
  assert.equal(empty.nothingNew, true);
  assert.deepEqual(fs.readdirSync(w.data).sort(), snapshot);
  assert.deepEqual(fs.readdirSync(path.join(w.data, "runs")).sort(), runsBefore);
});

// ---------------------------------------------------------------- summary

test("the summary names sessions and versions, new, repeats, returns, Triage, what to confirm, time, tokens, queue and the report", (t) => {
  const w = world(t);
  const passUuid = pass(w);
  analyse(w, passUuid, [ownerFinding(w, "one"), ownerFinding(w, "screen", { screen: true, mechanism: "A status shown on screen looked wrong." })]);
  ok(w.env, ["plan", "--session", ME, "--now", NOW]);
  const linear = fakeLinear();
  applyPlan(w, passUuid, linear);
  const committed = ok(w.env, ["commit", "--session", ME, "--now", at(NOW, 50)]);
  const s = committed.summary;
  assert.deepEqual(Object.keys(s).sort(), ["confirm", "dropped", "findings", "passUuid", "queueLength", "report", "sessions", "signals", "text", "time", "tokens", "triage", "window"].sort());
  assert.equal(s.sessions.counted, readJson(path.join(w.data, "runs", passUuid, "map.json")).counters.sessions);
  assert.ok(s.sessions.byVersion["v0.2.0"] >= 1);
  assert.equal(s.findings.new.length, 2);
  assert.deepEqual(Object.keys(s.sessions.openedBy).sort(), ["byKind", "byProduct", "byVersion", "sampleSessions", "sessions", "signalSessions"]);
  assert.equal(s.time.minutes, 50);
  assert.equal(typeof s.tokens.tokens, "number");
  assert.equal(s.report.url, linear.documents[0].url);
  assert.equal(s.confirm.length, 1);
  assert.match(s.text, /Учёл \d+ сессий/);
  assert.match(s.text, /От тебя: подтвердить 1 находку/);
  assert.match(s.text, /Отчёт: https:\/\/linear\.app\//);
  assert.deepEqual(ok(w.env, ["summary"]), s, "the last summary is kept on disk");
  // Nothing private in what went to Linear.
  const published = JSON.stringify([linear.documents, linear.issues, linear.comments]);
  assert.ok(!published.includes("Continuing after the boundary."));
  assert.ok(!published.includes(w.home));
});
