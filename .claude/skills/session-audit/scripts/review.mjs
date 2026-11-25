// The weekly analysis of a pass: signals and the open order (U4), opening
// budget, finding checks (U6), the findings registry with Linear outcomes
// (U7) and the Triage selection (U8). Scripts never call Linear: Linear
// answers come as files the session saved from its MCP calls.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  AuditError, appendRunLog, assertFence, assertOwner, checkName, compareTags, isFile, isInside, isoNow, readJson,
  readLines, readQueue, readState, safeFile, TagIndex, withLock, writeJsonAtomic,
} from "./lib.mjs";
import { claudeItems, codexItems } from "./records.mjs";
import { cost, readMap, setup } from "./commands.mjs";

export const METRICS = ["stops", "interventions", "extraRounds", "minutes"];
export const SIGNAL_METRICS = ["stops", "interventions", "extraRounds", "attempt", "length"];
export const KINDS = ["broken", "intervention", "guess", "time-loss", "simplify"];
export const SCOPES = ["pack", "product", "host"];
const MARKS = ["measured", "estimate", "unknown"];
const MEASURED_SOURCES = ["ledger", "receipt", "wave-cost"];
const TEXT_LIMIT = 300;
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------- pass context

// Every command of a pass: the data root guard, the lock, an unfinished pass
// held by the calling session, and writes fenced by that holder.
export function withPass({ env = process.env, sessionId, now } = {}, action) {
  if (!sessionId) throw new AuditError("this command needs --session <id of the calling session>");
  checkName(sessionId, "session id");
  const { dataRoot, repo, config } = setup(env);
  const at = isoNow(now);
  return withLock(dataRoot, sessionId, () => {
    const state = readState(dataRoot);
    if (!state.pending) throw new AuditError("no unfinished pass: run collect first");
    assertOwner(state, sessionId);
    const passUuid = checkName(state.pending.uuid, "pass uuid");
    const write = (segments, value) => {
      assertFence(dataRoot, passUuid, sessionId);
      return writeJsonAtomic(dataRoot, segments, value);
    };
    const log = (line) => {
      assertFence(dataRoot, passUuid, sessionId);
      appendRunLog(dataRoot, passUuid, `${at} ${line}`);
    };
    return action({ env, dataRoot, repo, config, state, passUuid, sessionId, at, write, log, map: readMap(dataRoot, passUuid) });
  });
}

export function runFile(dataRoot, passUuid, name, fallback) {
  const file = path.join(dataRoot, "runs", passUuid, name);
  return isFile(file) ? readJson(file) : fallback;
}

// A file the session saved (subagent result, Linear answer) must lie inside
// this pass folder of the data root: quotes never leave the owner's disk.
export function passInput(dataRoot, passUuid, file, what) {
  if (!file) throw new AuditError(`${what}: a file is needed`);
  const resolved = fs.realpathSync(path.resolve(file));
  if (!isInside(resolved, path.join(dataRoot, "runs", passUuid))) {
    throw new AuditError(`${what} must be a file inside runs/${passUuid}/ of the data root: ${resolved}`);
  }
  return readJson(resolved);
}

// ---------------------------------------------------------------- comparators

// One value of a metric: {value, known}. Unknown counts as zero and sorts
// after a known equal value.
function metricKey(entry) {
  if (entry === null || entry === undefined) return { value: 0, known: false };
  if (typeof entry === "number") return { value: entry, known: true };
  const known = entry.mark ? entry.mark !== "unknown" && entry.value !== null && entry.value !== undefined : entry.value !== null && entry.value !== undefined;
  return { value: known ? Number(entry.value) || 0 : 0, known };
}

export function compareBy(metrics) {
  return (left, right) => {
    for (const metric of metrics) {
      const a = metricKey(left.cost?.[metric]);
      const b = metricKey(right.cost?.[metric]);
      if (a.value !== b.value) return b.value - a.value;
      if (a.known !== b.known) return a.known ? -1 : 1;
    }
    return String(left.tieBreak ?? left.id).localeCompare(String(right.tieBreak ?? right.id));
  };
}

// Signals: stop, intervention, extra rounds, attempt, length (U4).
export const compareSignals = compareBy(SIGNAL_METRICS);
// Triage: stops and interventions first, then extra rounds and minutes (R4).
export const compareTriage = compareBy(METRICS);

// ---------------------------------------------------------------- signals

function sessionIdIndex(map) {
  const index = new Map();
  for (const session of map.sessions) for (const id of [session.id, ...session.ids]) index.set(id.toLowerCase(), session.id);
  return index;
}

// The one map session whose id is written in the text; none or several
// leave the signal «без связи» (U4: no linking by product or time).
function linkedSession(text, ids) {
  const found = new Set();
  const lower = String(text).toLowerCase();
  for (const [id, sessionId] of ids) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(id, from);
      if (at === -1) break;
      const before = lower[at - 1];
      const after = lower[at + id.length];
      if (!/[0-9a-z]/.test(before || "") && !/[0-9a-z]/.test(after || "")) found.add(sessionId);
      from = at + 1;
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

function signalId(source, session, reason) {
  return `S-${crypto.createHash("sha256").update(JSON.stringify([source.path, source.line ?? null, session ?? null, reason])).digest("hex").slice(0, 16)}`;
}

function sessionMinutes(session) {
  if (!session?.firstNewEvent || !session?.lastNewEvent) return null;
  return Math.max(0, Math.round((Date.parse(session.lastNewEvent.ts) - Date.parse(session.firstNewEvent.ts)) / 60000));
}

function sessionRef(session) {
  return session ? { id: session.id, ids: session.ids, host: session.host, files: session.files, kind: session.kind, product: session.product, loads: session.loads } : null;
}

function makeSignal({ map, source, session, reasons, cost: metrics, ts, passUuid }) {
  const mapSession = session ? map.sessions.find((candidate) => candidate.id === session) : null;
  const length = metrics.length ?? sessionMinutes(mapSession);
  return {
    id: signalId(source, session, reasons.join(",")),
    reasons,
    session: session || null,
    sessionRef: sessionRef(mapSession),
    product: source.product ?? mapSession?.product ?? null,
    range: mapSession ? { first: mapSession.firstNewEvent, last: mapSession.lastNewEvent } : null,
    source,
    ts,
    cost: {
      stops: metrics.stops ?? null,
      interventions: metrics.interventions ?? null,
      extraRounds: metrics.extraRounds ?? null,
      attempt: metrics.attempt ?? null,
      length: length ?? null,
    },
    firstPass: passUuid,
  };
}

function ledgerSignal(text, patterns) {
  const metrics = {};
  const reasons = [];
  if (new RegExp(patterns.stops, "i").test(text)) { metrics.stops = 1; reasons.push("stop"); }
  if (new RegExp(patterns.interventions, "i").test(text)) { metrics.interventions = 1; reasons.push("intervention"); }
  if (new RegExp(patterns.extraRounds, "i").test(text)) { metrics.extraRounds = 1; reasons.push("not-converged"); }
  const attempt = new RegExp(patterns.attempt, "i").exec(text);
  if (attempt) { metrics.attempt = Number(attempt[1]); reasons.push("attempt"); }
  return reasons.length ? { metrics, reasons } : null;
}

function readReport(file) {
  try {
    if (fs.statSync(file).size > 16 << 20) return null;
    const text = fs.readFileSync(file, "utf8");
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { text, json };
  } catch { return null; }
}

// Verdict of a tester report: the JSON after the `mono-qa certificate` line
// of its `certificate` string (scripts/qa-certificate.mjs).
export function qaVerdict(json) {
  const raw = json?.certificate;
  if (typeof raw !== "string" || !raw.startsWith("mono-qa certificate\n")) return null;
  try {
    const verdict = JSON.parse(raw.slice("mono-qa certificate".length).trim())?.verdict;
    return typeof verdict === "string" ? verdict : null;
  } catch { return null; }
}

// Ledger times of `<KEY> DISPATCHED` / `DISPATCHED <KEY>` lines, per product and issue.
function dispatchTimes(map, ledgerTexts) {
  const times = new Map();
  for (const line of map.sources.ledger) {
    const text = ledgerTexts.get(line.path)?.get(line.line) || "";
    const match = /\b([A-Z][A-Z0-9]*-\d+)\s+DISPATCHED\b|\bDISPATCHED:?\s+([A-Z][A-Z0-9]*-\d+)\b/.exec(text);
    if (!match) continue;
    const key = `${line.product}|${match[1] || match[2]}`;
    if (!times.has(key)) times.set(key, []);
    times.get(key).push(Date.parse(line.ts));
  }
  for (const list of times.values()) list.sort((a, b) => a - b);
  return times;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Mechanical signals of the mandatory layer of the map, each linked to a map
// session only by an id written in its source.
export function sourceSignals(map, config, passUuid) {
  const ids = sessionIdIndex(map);
  const rules = config.signals;
  const signals = [];
  const ledgerTexts = new Map();
  for (const line of map.sources.ledger) {
    if (!ledgerTexts.has(line.path)) {
      const lines = new Map();
      try { for (const { text, lineNo } of readLines(line.path)) lines.set(lineNo, text); } catch { /* gone */ }
      ledgerTexts.set(line.path, lines);
    }
    const text = ledgerTexts.get(line.path).get(line.line) || "";
    const found = ledgerSignal(text, rules.ledgerPatterns);
    if (!found) continue;
    signals.push(makeSignal({ map, passUuid, source: { kind: "ledger", product: line.product, path: line.path, line: line.line }, session: linkedSession(text, ids), reasons: found.reasons, cost: found.metrics, ts: line.ts }));
  }
  const phases = [];
  for (const report of map.sources.reports) {
    const read = readReport(report.path);
    if (!read) continue;
    const json = read.json;
    const metrics = {};
    const reasons = [];
    if (report.kind === "review-receipt") {
      if (json?.receipt?.review?.outcome === "not-converged") { metrics.extraRounds = 1; reasons.push("not-converged"); }
    } else if (report.kind === "qa-report") {
      const verdict = qaVerdict(json);
      if (verdict && rules.qaFailValues.includes(verdict.toLowerCase())) { metrics.stops = 1; reasons.push("qa-failed"); }
    } else {
      if (rules.stopPhaseResults.includes(json?.phase_result)) { metrics.stops = 1; reasons.push(String(json.phase_result)); }
      if (Number.isInteger(json?.attempt) && json.attempt >= 2) { metrics.attempt = json.attempt; reasons.push("attempt"); }
      if (json?.issue && json?.publishedAt) phases.push({ report, json, text: read.text });
    }
    if (!reasons.length) continue;
    signals.push(makeSignal({ map, passUuid, source: { kind: report.kind, product: report.product, path: report.path }, session: linkedSession(read.text, ids), reasons, cost: metrics, ts: report.ts }));
  }
  // Long phase: longer than two medians of phases of the same stage in the
  // window and not shorter than 30 minutes. A phase lasts from the previous
  // phase report of the same issue and attempt (publishedAt, by sequence),
  // or for the first one from the issue's DISPATCHED ledger line.
  const dispatched = dispatchTimes(map, ledgerTexts);
  const byAttempt = new Map();
  for (const phase of phases) {
    const key = `${phase.report.product}|${phase.json.issue}|${phase.json.attempt ?? 1}`;
    if (!byAttempt.has(key)) byAttempt.set(key, []);
    byAttempt.get(key).push(phase);
  }
  for (const [key, list] of byAttempt) {
    list.sort((a, b) => (a.json.sequence ?? 0) - (b.json.sequence ?? 0) || Date.parse(a.json.publishedAt) - Date.parse(b.json.publishedAt));
    const [product, issue] = key.split("|");
    list.forEach((phase, i) => {
      const end = Date.parse(phase.json.publishedAt);
      const start = i > 0 ? Date.parse(list[i - 1].json.publishedAt) : (dispatched.get(`${product}|${issue}`) || []).filter((time) => time < end).at(-1);
      phase.minutes = Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60000 : null;
    });
  }
  const byStage = new Map();
  for (const phase of phases.filter((one) => one.minutes !== null)) {
    const key = `${phase.json.stage ?? ""}|${phase.json.phase ?? ""}`;
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key).push(phase);
  }
  for (const group of byStage.values()) {
    const middle = median(group.map((phase) => phase.minutes));
    for (const phase of group) {
      if (phase.minutes > rules.longPhaseFactor * middle && phase.minutes >= rules.longPhaseMinutes) {
        signals.push(makeSignal({ map, passUuid, source: { kind: phase.report.kind, product: phase.report.product, path: phase.report.path }, session: linkedSession(phase.text, ids), reasons: ["long-phase"], cost: { length: Math.round(phase.minutes) }, ts: phase.report.ts }));
      }
    }
  }
  return signals;
}

// Signals the session found while reading the mandatory layer (owner
// interventions in owner words): session of the map and an event range.
function extraSignals(list, map, passUuid) {
  return (Array.isArray(list) ? list : list?.signals || []).map((entry) => {
    const session = map.sessions.find((candidate) => candidate.id === entry.session || candidate.ids.includes(entry.session));
    if (!session) throw new AuditError(`extra signal names a session outside the map: ${entry.session}`);
    const reason = entry.reason || "intervention";
    const range = entry.from || entry.to
      ? { first: { key: null, ts: isoNow(entry.from || session.firstNewEvent.ts) }, last: { key: null, ts: isoNow(entry.to || session.lastNewEvent.ts) } }
      : { first: session.firstNewEvent, last: session.lastNewEvent };
    const signal = makeSignal({
      map, passUuid, session: session.id, reasons: [reason],
      source: { kind: "owner-words", product: session.product, path: `session:${session.id}`, line: range.first.ts },
      cost: { stops: entry.stops ?? null, interventions: reason === "intervention" ? 1 : entry.interventions ?? null },
      ts: range.first.ts,
    });
    signal.range = range;
    return signal;
  });
}

// Seeded by the pass uuid: the same pass picks the same sample on resume.
function seededShuffle(items, seed) {
  const score = (item) => crypto.createHash("sha256").update(`${seed}|${item.id}`).digest("hex");
  return [...items].sort((a, b) => score(a).localeCompare(score(b)));
}

export function randomSessions(map, excluded, count, seed) {
  const pool = seededShuffle(map.sessions.filter((session) => !excluded.has(session.id)), seed);
  const picked = [];
  const kinds = new Set();
  for (const session of pool) {
    if (picked.length >= count) break;
    if (!kinds.has(session.kind)) { picked.push(session); kinds.add(session.kind); }
  }
  for (const session of pool) {
    if (picked.length >= count) break;
    if (!picked.includes(session)) picked.push(session);
  }
  return picked.map((session) => ({ session: session.id, kind: session.kind, product: session.product, range: { first: session.firstNewEvent, last: session.lastNewEvent } }));
}

export function signals(options = {}) {
  return withPass(options, ({ dataRoot, config, passUuid, map, write, log }) => {
    const extra = options.extra ? extraSignals(passInput(dataRoot, passUuid, options.extra, "--extra"), map, passUuid) : [];
    const fresh = [...sourceSignals(map, config, passUuid), ...extra];
    const queued = readQueue(dataRoot);
    const all = new Map();
    for (const signal of queued) all.set(signal.id, signal);
    for (const signal of fresh) {
      if (all.has(signal.id)) continue;
      all.set(signal.id, signal);
    }
    const list = [...all.values()].map((signal) => ({ ...signal, tieBreak: `${signal.ts}|${signal.id}` })).sort(compareSignals).map(({ tieBreak, ...signal }) => signal);
    const signalled = new Set(list.map((signal) => signal.session).filter(Boolean));
    const random = randomSessions(map, signalled, config.randomSessions, passUuid);
    const opened = runFile(dataRoot, passUuid, "opened.json", { signals: [], sessions: [] });
    const result = {
      passUuid,
      budget: config.budget,
      order: list.map((signal) => signal.id),
      signals: list,
      random,
      unlinked: list.filter((signal) => !signal.session).length,
      opened,
    };
    write(["runs", passUuid, "signals.json"], result);
    write(["queue.json"], { signals: list });
    log(`signals ${list.length} (new ${fresh.length}, queued ${queued.length}) random ${random.length}`);
    return { ...result, signals: list.map(({ sessionRef: _ref, ...signal }) => signal) };
  });
}

// Spend of the pass itself: the session holding it (and the one it was taken
// over from) with their subagents, records from the pass start only, cache
// reads apart and not in the budget.
export function passSpend(env, pending) {
  const ids = [...new Set([pending.sessionId, pending.takenOverFrom].filter(Boolean))];
  const spent = cost({ env, ids, since: pending.startedAt });
  return { tokens: spent.budgetTokens, cacheReadTokens: spent.cacheReadTokens };
}

// Marks signals or sample sessions as opened and reports what is left of the
// opening budget (minutes since the pass start, tokens the pass spent).
export function opened(options = {}) {
  return withPass(options, ({ env, dataRoot, config, passUuid, state, at, write, log }) => {
    const record = runFile(dataRoot, passUuid, "opened.json", { signals: [], sessions: [] });
    const known = runFile(dataRoot, passUuid, "signals.json", null);
    if (!known && (options.ids || []).length) throw new AuditError("run signals before marking anything opened");
    for (const id of options.ids || []) {
      if (known.order.includes(id)) { if (!record.signals.includes(id)) record.signals.push(id); }
      else if (known.random.some((entry) => entry.session === id)) { if (!record.sessions.includes(id)) record.sessions.push(id); }
      else throw new AuditError(`not a signal or sample session of this pass: ${id}`);
    }
    if ((options.ids || []).length) {
      write(["runs", passUuid, "opened.json"], record);
      log(`opened ${options.ids.join(" ")}`);
    }
    const minutes = Math.max(0, Math.round((Date.parse(at) - Date.parse(state.pending.startedAt)) / 60000));
    const spent = passSpend(env, state.pending);
    const budget = config.budget;
    return {
      passUuid,
      opened: record,
      budget: {
        minutes: { used: minutes, limit: budget.minutes, left: budget.minutes - minutes },
        tokens: { used: spent.tokens, limit: budget.tokens, left: budget.tokens - spent.tokens, cacheReadApart: spent.cacheReadTokens },
        exhausted: minutes >= budget.minutes || spent.tokens >= budget.tokens,
      },
      unopened: (known?.order || []).filter((id) => !record.signals.includes(id)),
    };
  });
}

// ---------------------------------------------------------------- check

export function normalizeSpace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLoose(text) {
  return normalizeSpace(text).toLowerCase();
}

function sessionOfPass(dataRoot, map, id) {
  const inMap = map.sessions.find((session) => session.id === id || session.ids.includes(id));
  if (inMap) return inMap;
  const queued = readQueue(dataRoot).find((signal) => signal.sessionRef && (signal.sessionRef.id === id || signal.sessionRef.ids.includes(id)));
  return queued ? queued.sessionRef : null;
}

// Texts of one event (by key) of a session file of either host.
export function eventTexts(session, key, config) {
  const texts = [];
  const problems = [];
  let ts = null;
  for (const file of session.files) {
    const items = session.host === "claude" ? claudeItems(file, problems, config) : codexItems(file, problems, config);
    for (const item of items) {
      if (item.key !== key) continue;
      ts = ts || item.ts || null;
      if (typeof item.text === "string") texts.push(item.text);
      if (item.input !== undefined) texts.push(typeof item.input === "string" ? item.input : JSON.stringify(item.input));
      if (item.kind === "event") texts.push("");
    }
  }
  texts.ts = ts;
  return texts;
}

function quoteIn(texts, quote) {
  const wanted = normalizeSpace(quote);
  return wanted.length > 0 && texts.some((text) => normalizeSpace(text).includes(wanted));
}

function sourceText(dataRoot, map, pointer) {
  const listed = map.sources.ledger.some((line) => line.path === pointer.source && line.line === pointer.line)
    || map.sources.reports.some((report) => report.path === pointer.source)
    || readQueue(dataRoot).some((signal) => signal.source?.path === pointer.source && (signal.source.line ?? null) === (pointer.line ?? null));
  if (!listed) return null;
  if (Number.isInteger(pointer.line)) {
    for (const { text, lineNo } of readLines(pointer.source)) if (lineNo === pointer.line) return [text];
    return [];
  }
  const read = readReport(pointer.source);
  return read ? [read.text] : [];
}

function loadFor(session, stage, ts) {
  const loads = (session?.loads || []).filter((load) => !stage || load.skill === stage);
  const before = loads.filter((load) => !ts || Date.parse(load.at) <= Date.parse(ts));
  return before.at(-1) || loads[0] || null;
}

// Tags of the finding: the stage load's confirmed tags, else the tag of the
// path hint («версия по пути»), else none.
function findingVersion(session, stage, ts, index) {
  const load = loadFor(session, stage, ts);
  if (load?.version?.status === "confirmed") return { status: "confirmed", tags: load.version.tags, range: load.version.range, byPath: false };
  const hint = load?.version?.pathHint;
  if (hint && index.tags.includes(hint)) return { status: "by-path", tags: [hint], range: hint, byPath: true };
  return { status: "unknown", tags: [], range: null, byPath: false };
}

function packTexts(index, tag) {
  return [...index.tree(tag).keys()].filter((file) => /^(skills|references|templates)\/.+\.md$/.test(file)).map((file) => index.file(tag, file));
}

function placeIn(index, tag, place) {
  const text = index.file(tag, place.file);
  return text !== null && normalizeLoose(text).includes(normalizeLoose(place.text));
}

function checkCost(raw = {}) {
  const result = {};
  const notes = [];
  for (const metric of METRICS) {
    const entry = raw[metric];
    if (!entry || entry.mark === "unknown" || entry.value === null || entry.value === undefined) {
      result[metric] = { value: null, mark: "unknown" };
      continue;
    }
    if (!MARKS.includes(entry.mark)) throw new AuditError(`cost.${metric}.mark must be one of ${MARKS.join(", ")}`);
    const value = Number(entry.value);
    if (!Number.isFinite(value) || value < 0) throw new AuditError(`cost.${metric}.value must be a number`);
    if (entry.mark === "measured" && !MEASURED_SOURCES.includes(entry.source?.kind)) {
      notes.push(`${metric}: measured needs a ledger, receipt or wave-cost source; kept as estimate`);
      result[metric] = { value, mark: "estimate" };
      continue;
    }
    result[metric] = entry.mark === "measured" ? { value, mark: "measured", source: { kind: entry.source.kind, ref: String(entry.source.ref ?? "") } } : { value, mark: entry.mark };
  }
  return { cost: result, notes };
}

function validateProposal(proposal) {
  const problems = [];
  if (typeof proposal.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(proposal.id)) problems.push("id must be a plain name");
  if (!KINDS.includes(proposal.kind)) problems.push(`kind must be one of ${KINDS.join(", ")}`);
  if (!SCOPES.includes(proposal.scope)) problems.push(`scope must be one of ${SCOPES.join(", ")}`);
  if (typeof proposal.stage !== "string" || !proposal.stage) problems.push("stage is needed");
  if (!proposal.pointer || typeof proposal.pointer !== "object") problems.push("pointer is needed");
  if (typeof proposal.quote !== "string" || !proposal.quote.trim()) problems.push("quote is needed");
  else if (proposal.quote.trim().split("\n").length > 2) problems.push("quote is at most two lines");
  if (typeof proposal.mechanism !== "string" || !proposal.mechanism.trim()) problems.push("mechanism is needed");
  else if (normalizeSpace(proposal.mechanism).length > TEXT_LIMIT) problems.push(`mechanism is at most ${TEXT_LIMIT} characters`);
  if (proposal.proposal !== undefined && normalizeSpace(proposal.proposal).length > TEXT_LIMIT) problems.push(`proposal is at most ${TEXT_LIMIT} characters`);
  if (proposal.kind === "guess" && !proposal.rule?.text) problems.push("a guess names the rule it relied on");
  for (const field of ["rule", "latest", "changed"]) {
    const place = proposal[field];
    if (place && (typeof place.file !== "string" || typeof place.text !== "string" || !place.text.trim())) problems.push(`${field} needs file and text`);
  }
  if (problems.length) throw new AuditError(`finding ${proposal.id ?? "?"} is malformed`, { problems });
}

// U6: evidence in the source, the rule place in every tag of the range (or
// in none for a guess), version handling and cost marks.
export const OTHER_STAGE = "other";

// A stage is kept and published only as a skill name of the pack; anything
// else becomes the generic «other».
export function knownStage(stage, stages) {
  return typeof stage === "string" && stages.has(stage) ? stage : OTHER_STAGE;
}

// A pointer event copied from a digest line keeps its "#" (`[time #key]`).
export function digestPointer(pointer) {
  if (!pointer || typeof pointer !== "object" || typeof pointer.event !== "string") return pointer;
  return { ...pointer, event: pointer.event.trim().replace(/^#/, "") };
}

export function checkProposal(input, { dataRoot, map, config, index, stages = new Set(index.skillNames()) }) {
  const raw = input && typeof input === "object" ? { ...input, pointer: digestPointer(input.pointer) } : input;
  validateProposal(raw);
  const proposal = { ...raw, stage: knownStage(raw.stage, stages) };
  const drop = (reason, extra = {}) => ({ status: "dropped", id: proposal.id, kind: proposal.kind, stage: proposal.stage, reason, ...extra });
  const pointer = proposal.pointer;
  let session = null;
  let texts;
  if (pointer.source) {
    texts = sourceText(dataRoot, map, pointer);
    if (texts === null) return drop("source-not-in-pass");
  } else {
    session = sessionOfPass(dataRoot, map, pointer.session);
    if (!session) return drop("session-not-in-pass");
    texts = eventTexts(session, pointer.event, config);
    if (!texts.length) return drop("event-not-found");
  }
  if (!quoteIn(texts, proposal.quote)) return drop("no-evidence");
  // The version is that of the stage load before the event itself, by the
  // event's own time in the file, not a time the subagent supplied.
  const eventTs = session ? texts.ts : null;
  const version = session ? findingVersion(session, proposal.stage, eventTs, index) : { status: "unknown", tags: [], range: null, byPath: false };
  const needsRule = proposal.kind === "guess" || (proposal.kind === "broken" && proposal.rule);
  if (needsRule && !version.tags.length) return drop("no-version");
  if (proposal.kind === "broken" && proposal.rule) {
    const missing = version.tags.filter((tag) => !placeIn(index, tag, proposal.rule));
    if (missing.length) return drop("rule-not-found", { tags: missing });
  }
  if (proposal.kind === "guess") {
    const wanted = normalizeLoose(proposal.rule.text);
    const present = version.tags.filter((tag) => packTexts(index, tag).some((text) => normalizeLoose(text).includes(wanted)));
    if (present.length) return drop("rule-exists", { tags: present });
  }
  const latestTag = index.tags.at(-1) || null;
  const latest = proposal.latest && latestTag ? placeIn(index, latestTag, proposal.latest) : false;
  const changed = Boolean(proposal.changed && latestTag && placeIn(index, latestTag, proposal.changed)
    && !(proposal.rule && placeIn(index, latestTag, proposal.rule)));
  const { cost: checkedCost, notes } = checkCost(proposal.cost);
  return {
    status: proposal.screen ? "needs-owner" : "kept",
    id: proposal.id,
    kind: proposal.kind,
    scope: proposal.scope,
    stage: proposal.stage,
    session: session?.id ?? null,
    product: session?.product ?? null,
    pointer: { ...pointer, ...(session ? { ts: eventTs } : {}) },
    quote: proposal.quote,
    mechanism: normalizeSpace(proposal.mechanism),
    proposal: normalizeSpace(proposal.proposal || ""),
    rule: proposal.rule || null,
    places: { latest: proposal.latest || null, changed: proposal.changed || null },
    version,
    latest: { tag: latestTag, canHappen: latest, alreadyChanged: changed },
    cost: checkedCost,
    costNotes: notes,
    sameAs: proposal.sameAs || null,
    features: { stage: proposal.stage, kind: proposal.kind, rule: proposal.rule?.text ? normalizeLoose(proposal.rule.text).slice(0, 120) : null, ...(proposal.features || {}) },
  };
}

export function check(options = {}) {
  return withPass(options, ({ dataRoot, repo, config, passUuid, map, write, log }) => {
    const input = passInput(dataRoot, passUuid, options.file, "check");
    const proposals = (Array.isArray(input) ? input : input.findings || [input])
      .map((proposal) => (proposal && typeof proposal === "object" ? { ...proposal, pointer: digestPointer(proposal.pointer) } : proposal));
    const index = new TagIndex(repo);
    const stages = new Set(index.skillNames());
    const checks = runFile(dataRoot, passUuid, "checks.json", { kept: [], dropped: [] });
    const ids = proposals.map((proposal) => proposal?.id);
    if (new Set(ids).size !== ids.length) throw new AuditError("finding ids repeat inside one file; give every finding its own id");
    for (const proposal of proposals) {
      const earlier = typeof proposal?.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(proposal.id)
        ? runFile(dataRoot, passUuid, path.join("checked", `${proposal.id}.json`), null) : null;
      const place = (pointer) => JSON.stringify(pointer?.source ? [pointer.source, pointer.line ?? null] : [pointer?.session ?? null, pointer?.event ?? null]);
      if (earlier && place(earlier.pointer) !== place(proposal.pointer)) {
        throw new AuditError(`finding id ${proposal.id} is already used for another place in this pass; give it a new id`);
      }
    }
    const results = proposals.map((proposal) => {
      const result = checkProposal(proposal, { dataRoot, map, config, index, stages });
      checks.kept = checks.kept.filter((id) => id !== result.id);
      checks.dropped = checks.dropped.filter((entry) => entry.id !== result.id);
      if (result.status === "dropped") {
        checks.dropped.push({ id: result.id, kind: result.kind, stage: result.stage, reason: result.reason });
        // A re-check that fails removes the earlier kept version.
        assertFence(dataRoot, passUuid, options.sessionId);
        fs.rmSync(safeFile(dataRoot, ["runs", passUuid, "checked", `${result.id}.json`]), { force: true });
      }
      else {
        checks.kept.push(result.id);
        write(["runs", passUuid, "checked", `${result.id}.json`], result);
      }
      return result;
    });
    write(["runs", passUuid, "checks.json"], checks);
    log(`check ${results.map((result) => `${result.id}:${result.status}`).join(" ")}`);
    return {
      passUuid,
      results: results.map(({ quote: _quote, ...result }) => result),
      kept: checks.kept.length,
      dropped: checks.dropped.length,
    };
  });
}

// The owner's answer about a finding that depends on the screen.
export function confirm(options = {}) {
  return withPass(options, ({ dataRoot, passUuid, write, log }) => {
    const id = checkName(options.target, "finding id");
    const checked = runFile(dataRoot, passUuid, path.join("checked", `${id}.json`), null);
    if (!checked) throw new AuditError(`no checked finding ${id} in this pass`);
    if (checked.status !== "needs-owner" && checked.status !== "owner-declined") throw new AuditError(`finding ${id} does not wait for the owner (${checked.status})`);
    if (options.answer !== "yes" && options.answer !== "no") throw new AuditError("confirm needs --yes or --no");
    checked.status = options.answer === "yes" ? "kept" : "owner-declined";
    checked.ownerConfirmed = options.answer === "yes";
    write(["runs", passUuid, "checked", `${id}.json`], checked);
    log(`owner ${options.answer} on ${id}`);
    return { passUuid, finding: id, status: checked.status };
  });
}

// ---------------------------------------------------------------- registry

export function readRegistry(dataRoot) {
  const file = path.join(dataRoot, "findings.json");
  if (!isFile(file)) return { findings: [] };
  const registry = readJson(file);
  return { findings: Array.isArray(registry.findings) ? registry.findings : [] };
}

function checkedFindings(dataRoot, passUuid) {
  const dir = path.join(dataRoot, "runs", passUuid, "checked");
  let names = [];
  try { names = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort(); } catch { names = []; }
  return names.map((name) => readJson(path.join(dir, name)));
}

// Candidates of the registry for a mechanism, by features only; the model
// compares mechanisms and names the id (U7). Never merged automatically.
export function candidates(options = {}) {
  return withPass(options, ({ dataRoot }) => {
    const registry = readRegistry(dataRoot);
    const wanted = { stage: options.stage || null, kind: options.kind || null, rule: options.rule ? normalizeLoose(options.rule) : null };
    const found = registry.findings.filter((finding) => {
      const features = finding.features || {};
      const sameRule = Boolean(wanted.rule && features.rule && (features.rule.includes(wanted.rule) || wanted.rule.includes(features.rule)));
      const sameStageKind = (!wanted.stage || features.stage === wanted.stage) && (!wanted.kind || features.kind === wanted.kind);
      return sameRule || ((wanted.stage || wanted.kind) && sameStageKind);
    });
    return { candidates: found.map(({ id, mechanism, features, issue, outcome, fixedIn }) => ({ id, mechanism, features, issue, outcome, fixedIn })) };
  });
}

// fixed_in: the release whose CHANGELOG section holds the fragment of the
// fixing issue (`<!-- fragment: KEY sha256:… -->`). [Unreleased] is not one.
export function fixedInIndex(repo) {
  const file = path.join(repo, "CHANGELOG.md");
  const index = new Map();
  if (!isFile(file)) return index;
  let version = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const heading = /^## \[(\d+\.\d+\.\d+)\]/.exec(line);
    if (heading) { version = `v${heading[1]}`; continue; }
    if (/^## /.test(line)) { version = null; continue; }
    const fragment = /<!--\s*fragment:\s*([A-Z][A-Z0-9]*-\d+)\b/.exec(line);
    if (fragment && version && !index.has(fragment[1])) index.set(fragment[1], version);
  }
  return index;
}

// Linear answers saved by the session: get_issue responses (id or
// identifier, status, statusType), plus `duplicateOf` for a Duplicate and
// `mechanismRemoved` for a cancel «снято вместе с механизмом».
function linearIndex(input) {
  const list = Array.isArray(input) ? input : input?.issues || [];
  const index = new Map();
  for (const issue of list) {
    for (const key of [issue.id, issue.identifier, issue.uuid].filter(Boolean)) index.set(key, issue);
  }
  return index;
}

function linearState(issueId, issues, seen = new Set()) {
  const issue = issues.get(issueId);
  if (!issue) throw new AuditError(`the Linear status of ${issueId} is needed: save its get_issue answer and pass it with --linear`, { issue: issueId });
  const duplicate = issue.duplicateOf || (/^duplicate$/i.test(issue.status || "") ? issue.duplicateOf : null);
  if (/^duplicate$/i.test(issue.status || "")) {
    if (!duplicate) throw new AuditError(`${issueId} is a Duplicate: add duplicateOf with the main issue to the Linear answer`, { issue: issueId });
    if (seen.has(duplicate)) throw new AuditError(`duplicate loop at ${issueId}`);
    seen.add(issueId);
    return { ...linearState(duplicate, issues, seen), via: issueId };
  }
  // The canonical name is the team key (MONO-…), which CHANGELOG fragments
  // use; a uuid id is kept apart.
  const KEY = /^[A-Z][A-Z0-9]*-\d+$/;
  const canonical = [issue.identifier, issue.id, issueId].find((value) => KEY.test(String(value || ""))) || issue.id || issueId;
  const base = { issue: canonical, uuid: issue.uuid || (KEY.test(String(issue.id)) ? null : issue.id) || null, url: issue.url ?? null, status: issue.status };
  const type = issue.statusType;
  if (type === "canceled") return { state: "rejected", ...base, mechanismRemoved: Boolean(issue.mechanismRemoved) };
  if (type === "completed") return { state: "done", ...base };
  return { state: "open", ...base };
}

function versionPlace(tags, fixedIn) {
  if (!tags.length) return "unknown";
  const below = tags.filter((tag) => compareTags(tag, fixedIn) < 0).length;
  if (below === 0) return "at-or-after";
  if (below === tags.length) return "before";
  return "crossing";
}

function mergeMetric(entries) {
  const known = entries.filter((entry) => entry.mark !== "unknown");
  if (!known.length) return { value: null, mark: "unknown" };
  const value = known.reduce((sum, entry) => sum + entry.value, 0);
  const mark = known.length === entries.length && known.every((entry) => entry.mark === "measured") ? "measured" : "estimate";
  return { value, mark };
}

function mergeCost(costs) {
  return Object.fromEntries(METRICS.map((metric) => [metric, mergeMetric(costs.map((one) => one[metric] || { value: null, mark: "unknown" }))]));
}

// U7 outcomes of one finding of this pass against its registry entry.
function outcomeOf(entry, tags, issues, fixedIn) {
  if (!entry) return { outcome: "new" };
  if (!entry.issue) return { outcome: entry.outcome === "queued" ? "queued-again" : "repeat-report" };
  const linear = linearState(entry.issue, issues);
  if (linear.state === "rejected") return { outcome: "rejected", linear };
  if (linear.state === "open") return { outcome: "repeat-open", linear };
  const version = fixedIn.get(linear.issue) || null;
  if (!version) return { outcome: "repeat-fix-unknown", linear };
  const place = versionPlace(tags, version);
  if (place === "at-or-after") return { outcome: "returned", linear, fixedIn: version };
  if (place === "before") return { outcome: "repeat-before-fix", linear, fixedIn: version };
  return { outcome: "repeat-version-ambiguous", linear, fixedIn: version };
}

export function register(options = {}) {
  return withPass(options, ({ dataRoot, repo, passUuid, write, log }) => {
    const issues = linearIndex(options.linear ? passInput(dataRoot, passUuid, options.linear, "--linear") : []);
    const registry = readRegistry(dataRoot);
    const byId = new Map(registry.findings.map((finding) => [finding.id, finding]));
    const previous = runFile(dataRoot, passUuid, "findings.json", { assigned: {}, findings: [] });
    const assigned = { ...previous.assigned };
    const checked = checkedFindings(dataRoot, passUuid);
    const byProposal = new Map(checked.map((finding) => [finding.id, finding]));
    // Ids: kept from an earlier run of this pass, else the registry id the
    // model named, else the id of the proposal it named, else a new F-<uuid>.
    const plan = runFile(dataRoot, passUuid, "plan.json", null);
    const sentCreates = new Set((plan?.ops || []).filter((op) => op.type === "create-issue" && op.status !== "planned").map((op) => op.finding));
    const resolve = (finding, trail = new Set()) => {
      const cached = assigned[finding.id];
      if (cached && !finding.sameAs) return cached;
      let id;
      if (finding.sameAs && /^F-/.test(finding.sameAs)) {
        if (!byId.has(finding.sameAs)) throw new AuditError(`${finding.id} names ${finding.sameAs}, which is not in the registry`);
        id = finding.sameAs;
      } else if (finding.sameAs) {
        const other = byProposal.get(finding.sameAs);
        if (!other || trail.has(finding.sameAs)) throw new AuditError(`${finding.id} names ${finding.sameAs}, which is not a checked finding of this pass`);
        trail.add(finding.id);
        id = resolve(other, trail);
      } else {
        id = `F-${crypto.randomUUID()}`;
      }
      if (cached && cached !== id && sentCreates.has(cached)) {
        throw new AuditError(`${finding.id} was already sent to Linear as ${cached}; it cannot be joined to ${id} in this pass. Remove the sameAs or reconcile ${cached} first`, { finding: finding.id, sent: cached, sameAs: id });
      }
      assigned[finding.id] = id;
      return id;
    };
    const groups = new Map();
    for (const finding of checked) {
      const id = resolve(finding);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(finding);
    }
    const fixedIn = fixedInIndex(repo);
    const findings = [];
    for (const [id, members] of groups) {
      const confirmed = members.filter((member) => member.status === "kept");
      const waiting = members.filter((member) => member.status === "needs-owner");
      const declined = members.filter((member) => member.status === "owner-declined");
      // Versions, sessions, cost and outcome come from confirmed members only;
      // members waiting for the owner or declined are kept apart.
      const basis = confirmed.length ? confirmed : waiting.length ? waiting : members;
      const head = basis[0];
      const entry = byId.get(id) || null;
      const tags = [...new Set(basis.flatMap((member) => member.version.tags))].sort(compareTags);
      const versionUnknown = basis.some((member) => !member.version.tags.length);
      const outcome = outcomeOf(entry, versionUnknown ? [] : tags, issues, fixedIn);
      const sessions = [...new Set(basis.map((member) => member.session).filter(Boolean))];
      const priorSessions = new Set((entry?.encounters || []).filter((encounter) => encounter.pass !== passUuid && encounter.confirmed !== false).map((encounter) => encounter.session).filter(Boolean));
      findings.push({
        id,
        proposals: members.map((member) => member.id),
        status: confirmed.length ? "confirmed" : waiting.length ? "needs-owner" : "owner-declined",
        kind: head.kind,
        scope: head.scope,
        stage: head.stage,
        mechanism: head.mechanism,
        proposal: head.proposal,
        features: head.features,
        pending: { waiting: confirmed.length ? waiting.map((member) => member.id) : [], declined: declined.map((member) => member.id) },
        places: { rule: head.rule || null, latest: head.places?.latest || null, changed: head.places?.changed || null },
        versions: { tags, range: tags.length ? (tags.length === 1 ? tags[0] : `${tags[0]}..${tags.at(-1)}`) : null, unknown: versionUnknown, byPath: basis.some((member) => member.version.byPath) },
        sessions,
        sessionsTotal: new Set([...priorSessions, ...sessions]).size,
        products: [...new Set(basis.map((member) => member.product).filter(Boolean))],
        cost: mergeCost(basis.map((member) => member.cost)),
        latest: {
          tag: head.latest.tag,
          canHappen: basis.some((member) => member.latest.canHappen),
          alreadyChanged: basis.every((member) => member.latest.alreadyChanged),
        },
        issue: entry?.issue ?? null,
        ...outcome,
        pointer: `runs/${passUuid}/${id}`,
      });
    }
    for (const finding of findings) {
      write(["runs", passUuid, finding.id, "finding.json"], { ...finding, members: groups.get(finding.id) });
    }
    // Queued returns of earlier passes: their issue is read again now; an
    // owner's cancel or a Duplicate since then wins over the reopen.
    const carriedLinear = {};
    for (const entry of registry.findings) {
      if (entry.outcome === "queued" && entry.queuedAction === "reopen" && entry.issue && !groups.has(entry.id)) carriedLinear[entry.id] = linearState(entry.issue, issues);
    }
    const result = { passUuid, assigned, findings, carriedLinear };
    write(["runs", passUuid, "findings.json"], result);
    log(`register ${findings.map((finding) => `${finding.id}:${finding.outcome}`).join(" ")}`);
    return result;
  });
}

// ---------------------------------------------------------------- selection

function eligibleForTriage(finding) {
  const c = finding.cost;
  const worth = finding.sessionsTotal >= 2 || (c.interventions.value || 0) > 0 || (c.stops.value || 0) > 0;
  return finding.scope === "pack" && finding.status === "confirmed" && Boolean(finding.proposal) && finding.latest.canHappen && !finding.latest.alreadyChanged && worth;
}

// U8: rows only for product/host, already changed and waiting findings;
// Triage for worthy pack findings and returned ones, at most five by cost;
// the rest «в очереди». Queued findings of earlier passes compete again
// without a new case.
// Places of a carried finding read again in the last release (U8): it may
// have changed since the pass that queued it.
export function recheckLatest(entry, index) {
  const tag = index?.tags?.at(-1) || null;
  if (!tag || !entry.places || entry.latest?.tag === tag) return entry.latest;
  const has = (place) => Boolean(place && index.file(tag, place.file) !== null && normalizeLoose(index.file(tag, place.file)).includes(normalizeLoose(place.text)));
  return { tag, canHappen: has(entry.places.latest), alreadyChanged: has(entry.places.changed) && !has(entry.places.rule) };
}

export function selectFindings(findings, registry, passUuid, limit, index = null, carriedLinear = {}) {
  const rows = [];
  const triage = [];
  const seen = new Set(findings.map((finding) => finding.id));
  for (const finding of findings) {
    if (finding.scope !== "pack") { rows.push({ id: finding.id, row: finding.scope }); continue; }
    if (finding.status === "needs-owner") { rows.push({ id: finding.id, row: "needs-owner" }); continue; }
    if (finding.status === "owner-declined") { rows.push({ id: finding.id, row: "owner-declined" }); continue; }
    if (finding.latest.alreadyChanged && finding.outcome !== "rejected") { rows.push({ id: finding.id, row: "already-changed" }); continue; }
    if (finding.outcome === "returned") { triage.push({ ...finding, action: "reopen" }); continue; }
    if (["repeat-open", "repeat-fix-unknown"].includes(finding.outcome)) { rows.push({ id: finding.id, row: finding.outcome, comment: true }); continue; }
    if (["rejected", "repeat-before-fix", "repeat-version-ambiguous"].includes(finding.outcome)) { rows.push({ id: finding.id, row: finding.outcome }); continue; }
    if (eligibleForTriage(finding)) triage.push({ ...finding, action: "create" });
    else rows.push({ id: finding.id, row: "report-only" });
  }
  for (const entry of registry.findings) {
    if (entry.outcome !== "queued" || seen.has(entry.id)) continue;
    // A queued return keeps its issue and is reopened; others are created.
    const action = entry.queuedAction === "reopen" && entry.issue ? "reopen" : entry.issue ? null : "create";
    if (!action) continue;
    let linear = null;
    if (action === "reopen") {
      linear = carriedLinear[entry.id];
      if (!linear) throw new AuditError(`the Linear status of ${entry.issue} is needed before ${entry.id} is reopened: run register with its get_issue answer`, { issue: entry.issue });
      if (linear.state === "rejected") { rows.push({ id: entry.id, row: "rejected", carried: true, linear }); continue; }
      if (linear.state === "open") { rows.push({ id: entry.id, row: "repeat-open", carried: true, linear }); continue; }
    }
    const latest = recheckLatest(entry, index);
    const carried = { ...entry, latest, carried: true, action, ...(linear ? { linear } : {}) };
    if (latest?.alreadyChanged) { rows.push({ id: entry.id, row: "already-changed", carried: true }); continue; }
    if (action === "create" && !eligibleForTriage(carried)) { rows.push({ id: entry.id, row: "report-only", carried: true }); continue; }
    triage.push(carried);
  }
  const ordered = triage.map((finding) => ({ ...finding, tieBreak: finding.id })).sort(compareTriage);
  const brief = (finding) => ({ id: finding.id, action: finding.action, carried: Boolean(finding.carried), ...(finding.carried ? { latest: finding.latest, ...(finding.linear ? { linear: finding.linear } : {}) } : {}) });
  const chosen = ordered.slice(0, limit).map(brief);
  const queued = ordered.slice(limit).map(brief);
  return { passUuid, limit, triage: chosen, queued, rows };
}

export function select(options = {}) {
  return withPass(options, ({ dataRoot, repo, config, passUuid, write, log }) => {
    const pass = runFile(dataRoot, passUuid, "findings.json", null);
    if (!pass) throw new AuditError("run register before select");
    const plan = runFile(dataRoot, passUuid, "plan.json", null);
    const result = selectFindings(pass.findings, readRegistry(dataRoot), passUuid, config.triageLimit, new TagIndex(repo), pass.carriedLinear || {});
    const order = [...result.triage, ...result.queued].map((entry) => entry.id);
    if (plan) {
      // Triage ops that may have reached Linear (sent or later) keep their
      // place; ops still only planned are chosen again from scratch.
      const planned = [...new Set(plan.ops.filter((op) => (op.type === "create-issue" || op.type === "update-issue") && op.status !== "planned").map((op) => op.finding))];
      const keep = result.triage.filter((entry) => planned.includes(entry.id));
      const rest = [...result.triage, ...result.queued].filter((entry) => !planned.includes(entry.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      const free = Math.max(0, config.triageLimit - planned.length);
      const all = [...result.triage, ...result.queued];
      // A finding dropped after its operation was sent stays, from its stored
      // finding file, so the plan can carry the operation as it is.
      const stored = (id) => {
        if (!runFile(dataRoot, passUuid, path.join(id, "finding.json"), null)) throw new AuditError(`operation for ${id} was sent but its finding file is missing`);
        const op = plan.ops.find((candidate) => candidate.finding === id && (candidate.type === "create-issue" || candidate.type === "update-issue"));
        return { id, action: op.type === "update-issue" ? "reopen" : "create", stored: true };
      };
      result.triage = [...planned.map((id) => keep.find((entry) => entry.id === id) || all.find((entry) => entry.id === id) || stored(id)), ...rest.slice(0, free)];
      result.queued = rest.slice(free);
    }
    write(["runs", passUuid, "selection.json"], result);
    log(`select triage ${result.triage.length} queued ${result.queued.length} rows ${result.rows.length}`);
    return result;
  });
}

export function isUuidish(value) {
  return UUIDISH.test(String(value));
}
