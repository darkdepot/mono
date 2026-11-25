// collect, extract and cost: the three commands of the weekly map.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { addUsage, finalizeUsage, zeroUsage } from "../../../../scripts/token-usage.mjs";
import {
  AuditError, appendRunLog, assertFence, assertOwner, checkName, guardDataRoot, defaultDataRoot, isDirectory, isFile,
  isoNow, loadConfig, monoRepo, orchestratorRoot, readJson, readLines, readQueue, readState, safeFile, safeRemoveDir,
  stateRoot, TagIndex, withLock, writeJsonAtomic, writeState,
} from "./lib.mjs";
import { claudeItems, codexItems, commandStrings } from "./records.mjs";
import {
  claudeProjectRoots, describeSessions, failOnProblems, forkParentKeys, isForkCopy, listClaudeFiles, loadAllSessions,
} from "./sessions.mjs";

export const MAP_SCHEMA = 1;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g;

export function setup(env = process.env) {
  const dataRoot = defaultDataRoot(env);
  const repo = monoRepo(env);
  const config = loadConfig(dataRoot);
  const guarded = guardDataRoot(dataRoot, { config, env, repo });
  return { dataRoot: guarded, repo, config };
}

// ---------------------------------------------------------------- sources

function inWindowMs(time, window) {
  return Number.isFinite(time) && time > Date.parse(window.start) && time <= Date.parse(window.end);
}

function walkFiles(dir, visit) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(child, visit);
    else if (entry.isFile()) visit(child);
  }
}

// Review receipts live under an evidence root, not in the orchestrator
// folder: <state root>/evidence/<product> by default, or the evidenceRoot a
// dispatch record names. A receipt is history/<run>.json with {receipt}
// whose recordedAt is its time.
export function evidenceRoots(orchRoot, product, env, config) {
  const roots = new Set([path.join(stateRoot(env), "evidence", product)]);
  const skip = new RegExp(config.sourceSkipPattern);
  const productDir = path.join(orchRoot, product);
  walkFiles(path.join(productDir, "dispatch"), (file) => {
    if (skip.test(path.relative(productDir, file)) || !file.endsWith(".json")) return;
    let text;
    try {
      if (fs.statSync(file).size > 16 << 20) return;
      text = fs.readFileSync(file, "utf8");
    } catch { return; }
    for (const match of text.matchAll(/"evidenceRoot"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
      try {
        const value = JSON.parse(match[1]);
        if (path.isAbsolute(value)) roots.add(path.normalize(value));
      } catch { /* not a string */ }
    }
  });
  return [...roots].sort();
}

export function collectReceipts(orchRoot, product, window, env, config) {
  const receipts = [];
  for (const root of evidenceRoots(orchRoot, product, env, config)) {
    const history = path.join(root, "history");
    let names = [];
    try { names = fs.readdirSync(history).filter((name) => name.endsWith(".json")).sort(); } catch { continue; }
    for (const name of names) {
      const file = path.join(history, name);
      let recordedAt;
      try {
        if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 16 << 20) continue;
        recordedAt = readJson(file).receipt?.recordedAt;
      } catch { continue; }
      const time = Date.parse(recordedAt);
      if (inWindowMs(time, window)) receipts.push({ kind: "review-receipt", product, path: file, ts: new Date(time).toISOString() });
    }
  }
  return receipts;
}

// U13 mandatory layer: ledger lines, phase and candidate reports, review
// receipts and tester reports whose own time is in the window.
export function collectSources(orchRoot, window, config, env = process.env) {
  const sources = { ledger: [], reports: [] };
  if (!isDirectory(orchRoot)) return sources;
  const skip = new RegExp(config.sourceSkipPattern);
  for (const product of fs.readdirSync(orchRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const productDir = path.join(orchRoot, product);
    const ledger = path.join(productDir, "ledger.md");
    if (isFile(ledger)) {
      for (const { text, lineNo } of readLines(ledger)) {
        const stamps = text.match(ISO);
        if (!stamps) continue;
        const time = Date.parse(stamps[0]);
        if (inWindowMs(time, window)) sources.ledger.push({ product, path: ledger, line: lineNo, ts: new Date(time).toISOString() });
      }
    }
    for (const source of config.sources) {
      walkFiles(path.join(productDir, source.dir), (file) => {
        const relative = path.relative(productDir, file);
        if (skip.test(relative) || !/\.(json|jsonl|md|txt)$/.test(file)) return;
        let text;
        try {
          if (fs.statSync(file).size > 16 << 20) return;
          text = fs.readFileSync(file, "utf8");
        } catch { return; }
        const times = (text.match(ISO) || []).map((stamp) => Date.parse(stamp)).filter(Number.isFinite);
        if (!times.length) return;
        const time = Math.max(...times);
        if (inWindowMs(time, window)) sources.reports.push({ kind: source.kind, product, path: file, ts: new Date(time).toISOString() });
      });
    }
    sources.reports.push(...collectReceipts(orchRoot, product, window, env, config));
  }
  return sources;
}

// ---------------------------------------------------------------- counters

function count(map, key) {
  map[key] = (map[key] || 0) + 1;
}

export function counters(sessions, sources, excluded) {
  const byProduct = {}, byKind = {}, byVersion = {}, byHost = {}, bySourceKind = {};
  let newEvents = 0;
  for (const session of sessions) {
    count(byProduct, session.product);
    count(byKind, session.kind);
    count(byHost, session.host);
    newEvents += session.newEvents;
    const keys = new Set(session.loads.map((load) => (load.version.status === "confirmed" ? load.version.range : "unconfirmed")));
    for (const key of keys) count(byVersion, key);
  }
  bySourceKind.ledger = sources.ledger.length;
  for (const report of sources.reports) count(bySourceKind, report.kind);
  return { sessions: sessions.length, newEvents, byProduct, byKind, byVersion, byHost, sources: bySourceKind, excluded };
}

// ---------------------------------------------------------------- collect

function lastEventTime(file) {
  let last = null;
  for (const { text } of readLines(file)) {
    const match = /"timestamp"\s*:\s*"([^"]+)"/.exec(text);
    if (match && Number.isFinite(Date.parse(match[1]))) last = Math.max(last ?? 0, Date.parse(match[1]));
  }
  return last;
}

// Minutes since the last event of a session, by its records, not file time.
export function silentMinutes(sessionId, config, env, now) {
  let last = null;
  for (const projects of claudeProjectRoots(config, env)) {
    let projectDirs = [];
    try { projectDirs = fs.readdirSync(projects); } catch { continue; }
    for (const project of projectDirs) {
      const file = path.join(projects, project, `${sessionId}.jsonl`);
      if (!isFile(file)) continue;
      const time = lastEventTime(file);
      if (time !== null) last = Math.max(last ?? 0, time);
    }
  }
  return last === null ? null : Math.floor((Date.parse(now) - last) / 60000);
}

export function buildMap({ config, env, repo, window, passUuid, startedAt, dataRoot, revisitTails = [] }) {
  const index = new TagIndex(repo);
  const problems = [];
  const { sessions, forkParentKeys, tails } = loadAllSessions({ config, env, index, window, problems });
  failOnProblems(problems);
  const orchRoot = orchestratorRoot(env);
  const revisit = new Set(revisitTails.map((tail) => `${tail.file}|${tail.offset}`));
  const { sessions: described, excluded } = describeSessions({ sessions, window, config, env, orchRoot, forkParentKeys, revisit });
  const sources = collectSources(orchRoot, window, config, env);
  const queueLength = readQueue(dataRoot).length;
  return {
    schema: MAP_SCHEMA,
    passUuid,
    startedAt,
    window,
    tags: index.tags,
    sessions: described,
    sources,
    counters: counters(described, sources, excluded),
    deferredTails: tails,
    queueLength,
  };
}

export function collect({ env = process.env, sessionId, now, takeOver = false } = {}) {
  if (!sessionId) throw new AuditError("collect needs --session <id of the calling session>");
  checkName(sessionId, "session id");
  const { dataRoot, repo, config } = setup(env);
  const at = isoNow(now);
  // The whole run holds the lock: two collectors cannot both see no pass and
  // both start one, and a former holder cannot write after a takeover.
  return withLock(dataRoot, sessionId, () => {
    const state = readState(dataRoot);
    let pass = state.pending;
    let resumed = false;
    if (pass) {
      if (pass.sessionId !== sessionId) {
        if (!takeOver) {
          throw new AuditError("an unfinished pass is held by another session; ask the owner to close it and say «забери проход»", {
            passUuid: pass.uuid,
            window: { start: pass.windowStart, end: pass.windowEnd },
            holderSession: pass.sessionId,
            silentMinutes: silentMinutes(pass.sessionId, config, env, at),
          }, 3);
        }
        const previous = pass.sessionId;
        pass = { ...pass, sessionId, takenOverAt: at, takenOverFrom: previous };
        writeState(dataRoot, { ...state, pending: pass });
        appendRunLog(dataRoot, pass.uuid, `${at} takeover from ${previous} by ${sessionId} on the owner's words`);
      }
      resumed = true;
    }
    const window = pass
      ? { start: pass.windowStart, end: pass.windowEnd }
      : { start: state.boundary || new Date(Date.parse(at) - config.firstPassDays * 86400000).toISOString(), end: at };
    const passUuid = pass ? pass.uuid : crypto.randomUUID();
    const startedAt = pass ? pass.startedAt : at;
    const revisitTails = Array.isArray(state.deferredTails) ? state.deferredTails : [];
    const map = buildMap({ config, env, repo, window, passUuid, startedAt, dataRoot, revisitTails });
    const sourceCount = map.sources.ledger.length + map.sources.reports.length;
    if (!pass && map.sessions.length === 0 && sourceCount === 0 && map.queueLength === 0 && !queuedFindings(dataRoot)) {
      return { nothingNew: true, window, written: false, deferredTails: map.deferredTails.length };
    }
    if (!pass) {
      // Compare-and-write: still no pass when the new one is written.
      if (readState(dataRoot).pending) throw new AuditError("a pass appeared while collecting; run collect again", {}, 3);
      pass = { uuid: passUuid, windowStart: window.start, windowEnd: window.end, startedAt, sessionId, deferredTails: map.deferredTails };
      writeState(dataRoot, { ...state, boundary: state.boundary ?? null, pending: pass });
      appendRunLog(dataRoot, passUuid, `${at} start by ${sessionId} window ${window.start}..${window.end}`);
    } else {
      assertFence(dataRoot, passUuid, sessionId);
      writeState(dataRoot, { ...readState(dataRoot), pending: { ...pass, deferredTails: map.deferredTails } });
      appendRunLog(dataRoot, passUuid, `${at} collect again by ${sessionId}`);
    }
    assertFence(dataRoot, passUuid, sessionId);
    const mapFile = writeJsonAtomic(dataRoot, ["runs", passUuid, "map.json"], map);
    return {
      passUuid,
      resumed,
      window,
      map: mapFile,
      sessions: map.sessions.length,
      newEvents: map.counters.newEvents,
      sources: { ledger: map.sources.ledger.length, reports: map.sources.reports.length },
      deferredTails: map.deferredTails.length,
      queueLength: map.queueLength,
      counters: map.counters,
    };
  }, { takeOver, now: at });
}

// Findings of the registry waiting in the Triage queue start a pass alone.
function queuedFindings(dataRoot) {
  const file = path.join(dataRoot, "findings.json");
  if (!isFile(file)) return 0;
  try {
    return (readJson(file).findings || []).filter((finding) => finding.outcome === "queued").length;
  } catch { return 0; }
}

// ---------------------------------------------------------------- extract

function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

function clip(text, limit) {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= limit) return text;
  return `${buffer.subarray(0, limit).toString("utf8").replace(/�+$/, "")}\n[… cut at ${limit} bytes of ${buffer.length}]`;
}

function skipUser(text, config) {
  const trimmed = text.trimStart();
  return !trimmed || config.extract.skipUserPrefixes.some((prefix) => trimmed.startsWith(prefix));
}

function questionAnswer(item) {
  const text = String(item.text || "");
  const answers = item.toolUseResult?.answers;
  if (text.includes("User did not answer this question")) return { status: "no-answer-sent-message", answer: clip(text, 2048) };
  if (answers && typeof answers === "object") return { status: "answered", answer: JSON.stringify(answers) };
  if (/The user answered/.test(text) || /User has answered/.test(text)) return { status: "answered", answer: clip(text, 2048) };
  return { status: "unknown", answer: clip(text, 2048) };
}

// Output of the synchronous Codex question tool: answers as JSON
// (`answers` list or map, or a list of {answer}), else plain text; empty
// means no answer.
export function codexAnswer(text) {
  const raw = String(text || "").trim();
  if (!raw) return { status: "no-answer", answer: "" };
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const answers = parsed?.answers ?? (Array.isArray(parsed) ? parsed : null);
  if (Array.isArray(answers)) {
    const list = answers.map((item) => (typeof item === "string" ? item : item?.answer ?? item?.text ?? "")).filter((item) => String(item).trim());
    return list.length ? { status: "answered", answer: list.join("; ") } : { status: "no-answer", answer: "" };
  }
  if (answers && typeof answers === "object") {
    const values = Object.values(answers).map((value) => (typeof value === "string" ? value : value?.answer ?? JSON.stringify(value)));
    return values.length ? { status: "answered", answer: values.join("; ") } : { status: "no-answer", answer: "" };
  }
  return { status: "answered", answer: clip(raw, 2048) };
}

function codexToolNames(input) {
  return [...String(typeof input === "string" ? input : JSON.stringify(input)).matchAll(/tools\.([A-Za-z0-9_]+)\s*\(/g)].map((match) => match[1]);
}

function parseArgs(input) {
  if (input && typeof input === "object") return input;
  try { return JSON.parse(String(input || "")); } catch { return null; }
}

// Questions of a native question tool: Claude AskUserQuestion input or Codex
// request_user_input_async JSON arguments.
export function questionText(args) {
  const list = Array.isArray(args?.questions) ? args.questions : args?.question ? [args] : [];
  return list.map((question) => {
    const text = question.title ?? question.question ?? question.prompt ?? question.text ?? "";
    const options = (question.options || []).map((option) => (typeof option === "string" ? option : option?.label ?? option?.text ?? "")).filter(Boolean);
    return options.length ? `${text} [options: ${options.join("; ")}]` : text;
  }).join("\n");
}

const QUESTION_TOOLS = new Set(["AskUserQuestion", "request_user_input_async", "request_user_input"]);

// U5 digest items of a session, in order, deduplicated by event key. A
// question is shown when asked (status unanswered, updated on reply) and its
// reply is a separate item with the reply's own time; a second-model call is
// shown with its output at the time of the output. Calls still open at the
// end of the files are shown with the request.
export function digestItems(sessionEntry, mapSession, config) {
  const entries = [];
  const seen = new Set();
  const loadsByTime = new Map((mapSession?.loads || []).map((load) => [`${load.at}|${load.skill}`, load]));
  const interactive = ["owner", "orchestrator"].includes(mapSession?.kind);
  const writePattern = new RegExp(config.extract.writeToolPattern);
  const secondModel = new RegExp(config.extract.secondModelPattern);
  const opKind = (name) => {
    if (config.extract.planTools.includes(name)) return "plan";
    if (config.extract.helperTools.includes(name)) return "helper";
    if (writePattern.test(name)) return "write";
    return null;
  };
  const problems = [];
  const pending = new Map(); // call id -> open call, across files
  const askQuestion = (id, base, text, tool = "") => {
    const entry = { ...base, kind: "question", text: `${text}\n  status: unanswered`, question: text };
    entries.push(entry);
    pending.set(id, { type: "question", base, text, entry, tool });
  };
  for (const file of sessionEntry.files) {
    const host = sessionEntry.host;
    const items = host === "claude" ? claudeItems(file, problems, config) : codexItems(file, problems, config);
    let duplicate = false;
    for (const item of items) {
      if (item.kind === "event") {
        duplicate = seen.has(item.key);
        seen.add(item.key);
        continue;
      }
      if (duplicate || !("key" in item)) continue;
      const base = { key: item.key, ts: item.ts, copyKey: item.copyKey ?? item.key };
      if (item.kind === "user-text") {
        const text = item.text || "";
        const reply = /<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/.exec(text);
        if (reply) {
          let parsed = [];
          try { parsed = JSON.parse(reply[1]); } catch { parsed = []; }
          for (const answer of Array.isArray(parsed) ? parsed : []) {
            let callId = null;
            try { callId = JSON.parse(answer.questionItemId)?.[1] ?? null; } catch { callId = null; }
            const open = callId ? pending.get(callId) : null;
            if (open) {
              open.entry.text = `${open.text}\n  status: answered`;
              pending.delete(callId);
            }
            entries.push({ ...base, kind: "answer", text: `${open ? open.text : answer.question}\n  answer (answered): ${answer.answer}` });
          }
          continue;
        }
        if (skipUser(text, config)) continue;
        entries.push({ ...base, kind: interactive ? "owner" : "prompt", text });
      } else if (item.kind === "meta-text") {
        const match = /^Base directory for this skill: [^\n]*\/skills\/([^/\n]+)\n/.exec(item.text || "");
        if (!match) continue;
        const load = loadsByTime.get(`${item.ts}|${match[1]}`);
        const version = load ? (load.version.status === "confirmed" ? load.version.range : "unconfirmed") : "not a Mono load";
        entries.push({ ...base, kind: "load", text: `${match[1]} ${version}` });
      } else if (item.kind === "assistant-text") {
        if (item.text && item.text.trim()) entries.push({ ...base, kind: "assistant", text: item.text });
      } else if (item.kind === "tool-use") {
        const name = item.name || "";
        if (QUESTION_TOOLS.has(name)) {
          askQuestion(item.id, base, questionText(parseArgs(item.input)), name);
          continue;
        }
        const kind = opKind(name);
        if (kind) entries.push({ ...base, kind: "op", text: `${kind}: ${name}` });
        if (host === "codex") {
          for (const tool of codexToolNames(item.input)) {
            const toolKind = opKind(tool);
            if (toolKind) entries.push({ ...base, kind: "op", text: `${toolKind}: ${tool}` });
          }
          const asked = /request_user_input_async\s*\(([\s\S]{0,4000})/.exec(typeof item.input === "string" ? item.input : "");
          if (asked) askQuestion(item.id, base, `asked: ${asked[1]}`);
          const load = (mapSession?.loads || []).find((candidate) => candidate.at === item.ts);
          if (load) entries.push({ ...base, kind: "load", text: `${load.skill} ${load.version.status === "confirmed" ? load.version.range : "unconfirmed"}` });
        }
        const commands = host === "claude" ? (name === "Bash" ? [String(item.input?.command || "")] : []) : commandStrings(item.input);
        const call = commands.find((command) => secondModel.test(command));
        if (call) pending.set(item.id, { type: "second-model", base, text: call });
      } else if (item.kind === "tool-result") {
        const open = pending.get(item.toolUseId);
        if (!open) continue;
        if (open.type === "question") {
          // A Codex async question returns at once; its answer comes as a reply
          // message. The synchronous tool returns the answers in its output.
          if (host === "codex" && open.tool !== "request_user_input") continue;
          pending.delete(item.toolUseId);
          const { status, answer } = host === "codex" ? codexAnswer(item.text) : questionAnswer(item);
          open.entry.text = `${open.text}\n  status: ${status}`;
          entries.push({ ...base, kind: "answer", text: `${open.text}\n  answer (${status}): ${answer}` });
        } else {
          pending.delete(item.toolUseId);
          entries.push({ ...base, kind: "second-model", text: `${open.text}\n--- output ---\n${clip(item.text || "", config.extract.secondModelBytes)}` });
        }
      }
    }
  }
  for (const open of pending.values()) {
    if (open.type === "second-model") entries.push({ ...open.base, kind: "second-model", text: `${open.text}\n--- output ---\n(no output in the files yet)` });
  }
  failOnProblems(problems);
  entries.forEach((entry, order) => { entry.order = order; });
  entries.sort((a, b) => (Date.parse(a.ts) - Date.parse(b.ts)) || (a.order - b.order));
  return entries;
}

// `[time #key] kind: text`: the key is the event of the line (Claude record
// uuid or Codex item id), the `event` of a finding pointer without the "#".
export function renderEntry(entry) {
  return `[${entry.ts} #${entry.key}] ${entry.kind}: ${entry.text}\n`;
}

function contextFor(entries, startIndex, limit) {
  const before = entries.slice(0, startIndex);
  const lastLoad = [...before].reverse().find((entry) => entry.kind === "load");
  const owners = before.filter((entry) => entry.kind === "owner" || entry.kind === "prompt");
  const picked = [];
  let size = lastLoad ? byteLength(renderEntry(lastLoad)) : 0;
  for (const entry of [...owners].reverse()) {
    const line = renderEntry(entry);
    if (size + byteLength(line) > limit) break;
    size += byteLength(line);
    picked.unshift(entry);
  }
  const lines = [lastLoad, ...picked].filter(Boolean).sort((a, b) => a.order - b.order).map(renderEntry).join("");
  return clip(lines, limit);
}

// Byte-size pieces of a text, cut on UTF-8 character boundaries.
export function splitBytes(text, limit) {
  const buffer = Buffer.from(text, "utf8");
  const pieces = [];
  let start = 0;
  while (start < buffer.length) {
    let end = Math.min(start + limit, buffer.length);
    while (end < buffer.length && end > start && (buffer[end] & 0xc0) === 0x80) end -= 1;
    pieces.push(buffer.subarray(start, end).toString("utf8"));
    start = end;
  }
  return pieces;
}

// Pieces of the selected entries: one when small, else by stage loads with a
// hard size cap inside a long stage. An entry above the cap continues over
// several pieces; nothing is dropped.
export function chunkEntries(entries, selected, config) {
  const chunkBytes = config.extract.chunkBytes;
  const picked = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => selected(entry));
  const total = picked.reduce((sum, { entry }) => sum + byteLength(renderEntry(entry)), 0);
  const groups = [];
  if (total <= chunkBytes) {
    if (picked.length) groups.push(picked);
  } else {
    let current = [];
    for (const item of picked) {
      if (item.entry.kind === "load" && current.length) { groups.push(current); current = []; }
      current.push(item);
    }
    if (current.length) groups.push(current);
  }
  const chunks = [];
  for (const group of groups) {
    let current = [];
    let size = 0;
    const flush = () => { if (current.length) chunks.push(current); current = []; size = 0; };
    for (const item of group) {
      const line = renderEntry(item.entry);
      const lines = [];
      if (byteLength(line) <= chunkBytes) lines.push(line);
      else {
        // Every piece names its event, so a pointer can be taken from any of them.
        const tag = `#${item.entry.key}`;
        const pieces = splitBytes(line, chunkBytes - 64 - byteLength(tag));
        pieces.forEach((piece, i) => lines.push(`[part ${i + 1}/${pieces.length} ${tag}] ${piece}${piece.endsWith("\n") ? "" : "\n"}`));
      }
      for (const text of lines) {
        if (size + byteLength(text) > chunkBytes) flush();
        current.push({ ...item, line: text });
        size += byteLength(text);
      }
    }
    flush();
  }
  return chunks.map((items) => ({
    items,
    body: items.map((item) => item.line).join(""),
    context: contextFor(entries, items[0].index, config.extract.contextBytes),
  }));
}

export function readMap(dataRoot, passUuid) {
  const file = path.join(dataRoot, "runs", checkName(passUuid, "pass uuid"), "map.json");
  if (!isFile(file)) throw new AuditError(`no map for pass ${passUuid}: run collect first`);
  return readJson(file);
}

export function extract({ env = process.env, sessionId, target, from, to } = {}) {
  if (!sessionId) throw new AuditError("extract needs --session <id of the calling session>");
  if (!target) throw new AuditError("extract needs the id of a session of the map");
  checkName(sessionId, "session id");
  checkName(target, "session id");
  const { dataRoot, config } = setup(env);
  return withLock(dataRoot, sessionId, () => {
    const state = readState(dataRoot);
    if (!state.pending) throw new AuditError("no unfinished pass: run collect first");
    assertOwner(state, sessionId);
    const passUuid = checkName(state.pending.uuid, "pass uuid");
    const map = readMap(dataRoot, passUuid);
    let mapSession = map.sessions.find((session) => session.id === target || session.ids.includes(target));
    if (!mapSession) {
      // A queued signal of an earlier pass: its session may have no new
      // events now and so is not in this map; the queue keeps what is needed
      // to open its own range.
      const queued = readQueue(dataRoot).find((signal) => signal.sessionRef && (signal.sessionRef.id === target || signal.sessionRef.ids.includes(target)));
      if (!queued) throw new AuditError(`session ${target} is not in the map of pass ${passUuid}`);
      if (!from && !to) throw new AuditError(`session ${target} comes from the queue: give its range with --from and --to`, { range: queued.range });
      mapSession = queued.sessionRef;
    }
    checkName(mapSession.id, "session id");
    const entries = digestItems(mapSession, mapSession, config);
    const window = map.window;
    let selected;
    let range;
    if (from || to) {
      const position = (value, fallback) => {
        if (!value) return fallback;
        const byKey = entries.findIndex((entry) => entry.key === value);
        if (byKey !== -1) return Date.parse(entries[byKey].ts);
        const time = Date.parse(value);
        if (!Number.isFinite(time)) throw new AuditError(`range bound is neither an event of the session nor a time: ${value}`);
        return time;
      };
      const start = position(from, -Infinity);
      const end = position(to, Infinity);
      selected = (entry) => Date.parse(entry.ts) >= start && Date.parse(entry.ts) <= end;
      range = { from: from || null, to: to || null };
    } else {
      const parentKeys = forkCopyKeys(mapSession, config, env);
      const fork = { forkedFrom: mapSession.forkedFrom, forkTime: mapSession.forkTime };
      const start = Date.parse(window.start);
      const end = Date.parse(window.end);
      const revisit = new Set(mapSession.revisitKeys || []);
      selected = (entry) => ((Date.parse(entry.ts) > start && Date.parse(entry.ts) <= end) || revisit.has(entry.key))
        && !isForkCopy(fork, entry, parentKeys);
      range = { window };
    }
    const chunks = chunkEntries(entries, selected, config);
    assertFence(dataRoot, passUuid, sessionId);
    safeRemoveDir(dataRoot, ["runs", passUuid, "extract", mapSession.id]);
    const written = chunks.map((chunk, i) => {
      const file = safeFile(dataRoot, ["runs", passUuid, "extract", mapSession.id, `chunk-${String(i + 1).padStart(2, "0")}.md`]);
      const text = `# session ${mapSession.id} chunk ${i + 1}/${chunks.length}\n\n## context (already read, not new)\n\n${chunk.context}\n## events\n\n${chunk.body}`;
      fs.writeFileSync(file, text, { flag: "wx" });
      return {
        file,
        bytes: byteLength(chunk.body),
        contextBytes: byteLength(chunk.context),
        entries: chunk.items.length,
        first: { key: chunk.items[0].entry.key, ts: chunk.items[0].entry.ts },
        last: { key: chunk.items.at(-1).entry.key, ts: chunk.items.at(-1).entry.ts },
      };
    });
    appendRunLog(dataRoot, passUuid, `${isoNow()} extract ${mapSession.id} chunks ${written.length}`);
    return { passUuid, session: mapSession.id, range, chunks: written };
  });
}

// Content keys of the parent of a Codex fork, to find its copied items.
function forkCopyKeys(mapSession, config, env) {
  if (!mapSession.forkedFrom) return null;
  const index = new TagIndex(monoRepo(env));
  const problems = [];
  const keys = forkParentKeys(mapSession.forkedFrom, config, env, index, problems);
  failOnProblems(problems);
  return keys;
}

// ---------------------------------------------------------------- cost

function fileHas(file, needle) {
  for (const { text } of readLines(file)) if (text.includes(needle)) return true;
  return false;
}

function usageTotal(usage) {
  return (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.output_tokens || 0);
}

// U10: usage of Claude sessions of the pass (found by the pass uuid in their
// text, or given ids) and their subagents, each message.id counted once.
// With a pass (or `since`) only records from the pass start count.
// `budgetTokens` is `tokens` without cache reads: what the opening budget spends.
export function cost({ env = process.env, passUuid, ids = [], since = null } = {}) {
  const { dataRoot, config } = setup(env);
  if (!passUuid && !ids.length) throw new AuditError("cost needs --pass <uuid> or session ids");
  if (passUuid) checkName(passUuid, "pass uuid");
  ids.forEach((id) => checkName(id, "session id"));
  const all = listClaudeFiles(config, env);
  const topLevel = all.filter((entry) => path.basename(path.dirname(entry.file)) !== "subagents");
  let sessionIds = [...ids].filter(Boolean);
  let from = since ? Date.parse(since) : null;
  if (since && !Number.isFinite(from)) throw new AuditError(`not a time: ${since}`);
  if (passUuid) {
    const mapFile = path.join(dataRoot, "runs", passUuid, "map.json");
    if (from === null && isFile(mapFile)) from = Date.parse(readJson(mapFile).startedAt) || null;
    for (const entry of topLevel) {
      let modified = 0;
      try { modified = fs.statSync(entry.file).mtimeMs; } catch { continue; }
      if (modified < (from ?? 0)) continue;
      if (fileHas(entry.file, passUuid)) sessionIds.push(path.basename(entry.file, ".jsonl"));
    }
  }
  sessionIds = [...new Set(sessionIds)];
  const files = [];
  for (const entry of topLevel) {
    const id = path.basename(entry.file, ".jsonl");
    if (!sessionIds.includes(id)) continue;
    files.push(entry.file);
    const subagents = path.join(path.dirname(entry.file), id, "subagents");
    let names = [];
    try { names = fs.readdirSync(subagents); } catch { names = []; }
    for (const name of names.sort()) if (/^agent-.+\.jsonl$/.test(name)) files.push(path.join(subagents, name));
  }
  const unique = [...new Set(files.map((file) => fs.realpathSync(file)))];
  const best = new Map();
  const problems = [];
  for (const file of unique) {
    for (const item of claudeItems(file, problems, config)) {
      if (item.kind !== "usage") continue;
      if (from !== null && !(Date.parse(item.ts) >= from)) continue;
      const previous = best.get(item.messageId);
      if (!previous || usageTotal(item.usage) > usageTotal(previous)) best.set(item.messageId, item.usage);
    }
  }
  failOnProblems(problems);
  const total = zeroUsage();
  for (const usage of best.values()) {
    addUsage(total, {
      input_tokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
      cached_input_tokens: usage.cache_read_input_tokens || 0,
      cache_write_input_tokens: usage.cache_creation_input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      reasoning_output_tokens: 0,
    });
  }
  const usage = finalizeUsage(total);
  return {
    passUuid: passUuid || null,
    sessions: sessionIds,
    files: unique,
    messages: best.size,
    usage,
    since: from === null ? null : new Date(from).toISOString(),
    tokens: usage.non_overlapping_total_tokens,
    cacheReadTokens: usage.cached_input_tokens,
    budgetTokens: usage.non_overlapping_total_tokens - usage.cached_input_tokens,
  };
}
