// collect, extract and cost: the three commands of the weekly map.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { addUsage, finalizeUsage, zeroUsage } from "../../../../scripts/token-usage.mjs";
import {
  AuditError, appendRunLog, assertOwner, guardDataRoot, defaultDataRoot, isDirectory, isFile, isoNow, loadConfig,
  monoRepo, orchestratorRoot, readJson, readLines, readQueue, readState, TagIndex, writeJsonAtomic, writeState,
} from "./lib.mjs";
import { claudeItems, codexItems, commandStrings } from "./records.mjs";
import {
  claudeProjectRoots, describeSessions, failOnProblems, forkParentKeys, listClaudeFiles, loadAllSessions,
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

// U13 mandatory layer: ledger lines, phase and candidate reports, review
// receipts and tester reports whose own time is in the window.
export function collectSources(orchRoot, window, config) {
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

export function buildMap({ config, env, repo, window, passUuid, startedAt, dataRoot }) {
  const index = new TagIndex(repo);
  const problems = [];
  const { sessions, forkParentKeys } = loadAllSessions({ config, env, index, window, problems });
  failOnProblems(problems);
  const orchRoot = orchestratorRoot(env);
  const { sessions: described, excluded } = describeSessions({ sessions, window, config, env, orchRoot, forkParentKeys });
  const sources = collectSources(orchRoot, window, config);
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
    queueLength,
  };
}

export function collect({ env = process.env, sessionId, now, takeOver = false } = {}) {
  if (!sessionId) throw new AuditError("collect needs --session <id of the calling session>");
  const { dataRoot, repo, config } = setup(env);
  const at = isoNow(now);
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
  } else if (takeOver) {
    throw new AuditError("--take-over given but there is no unfinished pass");
  }
  const window = pass
    ? { start: pass.windowStart, end: pass.windowEnd }
    : { start: state.boundary || new Date(Date.parse(at) - config.firstPassDays * 86400000).toISOString(), end: at };
  const passUuid = pass ? pass.uuid : crypto.randomUUID();
  const startedAt = pass ? pass.startedAt : at;
  const map = buildMap({ config, env, repo, window, passUuid, startedAt, dataRoot });
  const sourceCount = map.sources.ledger.length + map.sources.reports.length;
  if (!pass && map.sessions.length === 0 && sourceCount === 0 && map.queueLength === 0) {
    return { nothingNew: true, window, written: false };
  }
  if (!pass) {
    pass = { uuid: passUuid, windowStart: window.start, windowEnd: window.end, startedAt, sessionId };
    writeState(dataRoot, { ...state, boundary: state.boundary ?? null, pending: pass });
    appendRunLog(dataRoot, passUuid, `${at} start by ${sessionId} window ${window.start}..${window.end}`);
  } else {
    appendRunLog(dataRoot, passUuid, `${at} collect again by ${sessionId}`);
  }
  const mapFile = path.join(dataRoot, "runs", passUuid, "map.json");
  writeJsonAtomic(mapFile, map);
  return {
    passUuid,
    resumed,
    window,
    map: mapFile,
    sessions: map.sessions.length,
    newEvents: map.counters.newEvents,
    sources: { ledger: map.sources.ledger.length, reports: map.sources.reports.length },
    queueLength: map.queueLength,
    counters: map.counters,
  };
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

function codexToolNames(input) {
  return [...String(typeof input === "string" ? input : JSON.stringify(input)).matchAll(/tools\.([A-Za-z0-9_]+)\s*\(/g)].map((match) => match[1]);
}

// U5 digest items of a session, in order, deduplicated by event key.
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
  for (const file of sessionEntry.files) {
    const host = sessionEntry.host;
    const items = host === "claude" ? claudeItems(file, problems, config) : codexItems(file, problems, config);
    const pending = new Map();
    let duplicate = false;
    for (const item of items) {
      if (item.kind === "event") {
        duplicate = seen.has(item.key);
        seen.add(item.key);
        continue;
      }
      if (duplicate || !("key" in item)) continue;
      const base = { key: item.key, ts: item.ts };
      if (item.kind === "user-text") {
        const text = item.text || "";
        const reply = /<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/.exec(text);
        if (reply) {
          let parsed = [];
          try { parsed = JSON.parse(reply[1]); } catch { parsed = []; }
          for (const answer of Array.isArray(parsed) ? parsed : []) {
            entries.push({ ...base, kind: "question", text: `${answer.question}\n  answer (answered): ${answer.answer}` });
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
        if (name === "AskUserQuestion") {
          const questions = (item.input?.questions || []).map((question) => `${question.question} [options: ${(question.options || []).map((option) => option.label).join("; ")}]`);
          pending.set(item.id, { type: "question", base, text: questions.join("\n") });
          continue;
        }
        const kind = opKind(name);
        if (kind) entries.push({ ...base, kind: "op", text: `${kind}: ${name}` });
        if (host === "codex") {
          for (const tool of codexToolNames(item.input)) {
            const toolKind = opKind(tool);
            if (toolKind) entries.push({ ...base, kind: "op", text: `${toolKind}: ${tool}` });
          }
          const asked = /request_user_input_async\s*\(([\s\S]{0,4000})/.exec(String(item.input || ""));
          if (asked) entries.push({ ...base, kind: "question", text: `asked: ${asked[1]}` });
          // A later loaded skill of the session is shown by its load entry.
          const load = (mapSession?.loads || []).find((candidate) => candidate.at === item.ts);
          if (load) entries.push({ ...base, kind: "load", text: `${load.skill} ${load.version.status === "confirmed" ? load.version.range : "unconfirmed"}` });
        }
        const commands = host === "claude" ? (name === "Bash" ? [String(item.input?.command || "")] : []) : commandStrings(item.input);
        const call = commands.find((command) => secondModel.test(command));
        if (call) pending.set(item.id, { type: "second-model", base, text: call });
      } else if (item.kind === "tool-result") {
        const open = pending.get(item.toolUseId);
        if (!open) continue;
        pending.delete(item.toolUseId);
        if (open.type === "question") {
          const { status, answer } = questionAnswer(item);
          entries.push({ ...open.base, kind: "question", text: `${open.text}\n  answer (${status}): ${answer}` });
        } else {
          entries.push({ ...open.base, kind: "second-model", text: `${open.text}\n--- output ---\n${clip(item.text || "", config.extract.secondModelBytes)}` });
        }
      }
    }
  }
  failOnProblems(problems);
  entries.forEach((entry, order) => { entry.order = order; });
  entries.sort((a, b) => (Date.parse(a.ts) - Date.parse(b.ts)) || (a.order - b.order));
  return entries;
}

export function renderEntry(entry) {
  return `[${entry.ts}] ${entry.kind}: ${entry.text}\n`;
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

// Pieces of the selected entries: one when small, else by stage loads with a
// hard size cap inside a long stage.
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
    for (const item of group) {
      let line = renderEntry(item.entry);
      if (byteLength(line) > chunkBytes) line = `${clip(line, chunkBytes - 64)}\n`;
      if (size + byteLength(line) > chunkBytes && current.length) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push({ ...item, line });
      size += byteLength(line);
    }
    if (current.length) chunks.push(current);
  }
  return chunks.map((items) => ({
    items,
    body: items.map((item) => item.line).join(""),
    context: contextFor(entries, items[0].index, config.extract.contextBytes),
  }));
}

export function readMap(dataRoot, passUuid) {
  const file = path.join(dataRoot, "runs", passUuid, "map.json");
  if (!isFile(file)) throw new AuditError(`no map for pass ${passUuid}: run collect first`);
  return readJson(file);
}

export function extract({ env = process.env, sessionId, target, from, to } = {}) {
  if (!sessionId) throw new AuditError("extract needs --session <id of the calling session>");
  if (!target) throw new AuditError("extract needs the id of a session of the map");
  const { dataRoot, config } = setup(env);
  const state = readState(dataRoot);
  if (!state.pending) throw new AuditError("no unfinished pass: run collect first");
  assertOwner(state, sessionId);
  const map = readMap(dataRoot, state.pending.uuid);
  const mapSession = map.sessions.find((session) => session.id === target || session.ids.includes(target));
  if (!mapSession) throw new AuditError(`session ${target} is not in the map of pass ${state.pending.uuid}`);
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
    const copies = forkCopyKeys(mapSession, config, env);
    const start = Date.parse(window.start);
    const end = Date.parse(window.end);
    selected = (entry) => Date.parse(entry.ts) > start && Date.parse(entry.ts) <= end && !copies.has(entry.key);
    range = { window };
  }
  const chunks = chunkEntries(entries, selected, config);
  const dir = path.join(dataRoot, "runs", state.pending.uuid, "extract", mapSession.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const written = chunks.map((chunk, i) => {
    const file = path.join(dir, `chunk-${String(i + 1).padStart(2, "0")}.md`);
    const text = `# session ${mapSession.id} chunk ${i + 1}/${chunks.length}\n\n## context (already read, not new)\n\n${chunk.context}\n## events\n\n${chunk.body}`;
    fs.writeFileSync(file, text);
    return {
      file,
      bytes: byteLength(chunk.body),
      contextBytes: byteLength(chunk.context),
      entries: chunk.items.length,
      first: { key: chunk.items[0].entry.key, ts: chunk.items[0].entry.ts },
      last: { key: chunk.items.at(-1).entry.key, ts: chunk.items.at(-1).entry.ts },
    };
  });
  appendRunLog(dataRoot, state.pending.uuid, `${isoNow()} extract ${mapSession.id} chunks ${written.length}`);
  return { passUuid: state.pending.uuid, session: mapSession.id, range, chunks: written };
}

// Keys copied from the parent of a Codex fork are not new events.
function forkCopyKeys(mapSession, config, env) {
  if (!mapSession.forkedFrom) return new Set();
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
export function cost({ env = process.env, passUuid, ids = [] } = {}) {
  const { dataRoot, config } = setup(env);
  if (!passUuid && !ids.length) throw new AuditError("cost needs --pass <uuid> or session ids");
  const all = listClaudeFiles(config, env);
  const topLevel = all.filter((entry) => path.basename(path.dirname(entry.file)) !== "subagents");
  let sessionIds = [...ids];
  if (passUuid) {
    let since = 0;
    const mapFile = path.join(dataRoot, "runs", passUuid, "map.json");
    if (isFile(mapFile)) since = Date.parse(readJson(mapFile).startedAt) || 0;
    for (const entry of topLevel) {
      let modified = 0;
      try { modified = fs.statSync(entry.file).mtimeMs; } catch { continue; }
      if (modified < since) continue;
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
    tokens: usage.non_overlapping_total_tokens,
    cacheReadTokens: usage.cached_input_tokens,
  };
}
