// Reading Claude Code and Codex session files into normalized items.
// Files are only read; unknown record kinds are collected as problems so the
// caller fails loudly with every place named.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readRecords, readJson, isFile } from "./lib.mjs";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function hashKey(value) {
  return `h-${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

export function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (typeof block === "string") return block;
    if (block && typeof block.text === "string") return block.text;
    if (block && block.type === "tool_result") return blockText(block.content);
    return "";
  }).join("\n");
}

// ---------------------------------------------------------------- Claude

// Claude file location: <projects>/<project>/<id>.jsonl, or a subagent at
// <projects>/<project>/<parent id>/subagents/agent-<id>.jsonl with its
// agent-<id>.meta.json next to it.
export function claudeFileIdentity(file) {
  const base = path.basename(file, ".jsonl");
  const dir = path.dirname(file);
  if (path.basename(dir) === "subagents") {
    const parentId = path.basename(path.dirname(dir));
    const agentId = base.replace(/^agent-/, "");
    const metaFile = path.join(dir, `${base}.meta.json`);
    let meta = null;
    if (isFile(metaFile)) {
      try { meta = readJson(metaFile); } catch { meta = null; }
    }
    return { fileId: base, subagent: { parentId, agentId, metaFile: isFile(metaFile) ? metaFile : null, meta } };
  }
  return { fileId: base, subagent: null };
}

export function* claudeItems(file, problems, config, tails = null) {
  const known = new Set(config.claude.knownRecordTypes);
  for (const { record, lineNo, offset } of readRecords(file, problems, tails)) {
    const type = record.type;
    if (!known.has(type)) {
      problems.push({ file, line: lineNo, kind: `unknown Claude record type ${JSON.stringify(type ?? null)}` });
      continue;
    }
    if (type !== "user" && type !== "assistant") continue;
    const base = {
      key: record.uuid || `${hashKey(record)}@${offset}`,
      ts: record.timestamp || null,
      line: lineNo,
      offset,
      sessionId: record.sessionId || null,
      cwd: record.cwd || null,
      entrypoint: record.entrypoint || null,
    };
    yield { kind: "event", role: type, ...base };
    const content = record.message?.content;
    if (type === "user") {
      if (record.isMeta) {
        yield { kind: "meta-text", ...base, text: blockText(content) };
        continue;
      }
      if (typeof content === "string") {
        yield { kind: "user-text", ...base, text: content };
        continue;
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === "text") yield { kind: "user-text", ...base, text: block.text || "" };
        else if (block?.type === "tool_result") {
          yield { kind: "tool-result", ...base, toolUseId: block.tool_use_id, text: blockText(block.content), toolUseResult: record.toolUseResult ?? null };
        }
      }
      continue;
    }
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type === "text") yield { kind: "assistant-text", ...base, text: block.text || "" };
      else if (block?.type === "tool_use") yield { kind: "tool-use", ...base, id: block.id, name: block.name, input: block.input ?? {} };
    }
    if (record.message?.id && record.message?.usage) {
      yield { kind: "usage", ...base, messageId: record.message.id, usage: record.message.usage };
    }
  }
}

// ---------------------------------------------------------------- Codex

export function codexFileId(file) {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file);
  return match ? match[1] : path.basename(file, ".jsonl");
}

function codexContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
}

export function codexOutputText(output) {
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed.output === "string") return parsed.output;
    } catch { /* plain text */ }
    return output;
  }
  if (Array.isArray(output)) return output.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  if (output && typeof output.output === "string") return output.output;
  return "";
}

export function* codexItems(file, problems, config, tails = null) {
  const known = new Set(config.codex.knownRecordTypes);
  let sawMeta = false;
  for (const { record, lineNo, offset } of readRecords(file, problems, tails)) {
    const type = record.type;
    if (!known.has(type)) {
      problems.push({ file, line: lineNo, kind: `unknown Codex record type ${JSON.stringify(type ?? null)}` });
      continue;
    }
    const payload = record.payload || {};
    if (type === "session_meta") {
      // A fork copies the parent's meta after its own; only the first is ours.
      if (!sawMeta) {
        sawMeta = true;
        yield {
          kind: "session",
          id: payload.id || payload.session_id || codexFileId(file),
          forkedFrom: payload.forked_from_id || null,
          originator: payload.originator || null,
          source: payload.source ?? null,
          cwd: payload.cwd || null,
          ts: record.timestamp || payload.timestamp || null,
        };
      }
      continue;
    }
    if (type === "turn_context" && payload.cwd) {
      yield { kind: "cwd", cwd: payload.cwd, ts: record.timestamp || null };
      continue;
    }
    if (type !== "response_item") continue;
    // Identity: the item id, else content with time and position, so a repeated
    // message stays a separate event. copyKey (id or content) only finds the
    // parent's items copied into a fork.
    const copyKey = payload.id || hashKey(payload);
    const key = payload.id || `${copyKey}@${record.timestamp || ""}#${record.ordinal ?? lineNo}`;
    const base = { key, copyKey, ts: record.timestamp || null, line: lineNo, offset };
    yield { kind: "event", role: payload.type, ...base };
    if (payload.type === "message") {
      const text = codexContentText(payload.content);
      if (payload.role === "user") yield { kind: "user-text", ...base, text };
      else if (payload.role === "assistant") yield { kind: "assistant-text", ...base, text };
    } else if (payload.type === "custom_tool_call" || payload.type === "function_call") {
      yield { kind: "tool-use", ...base, id: payload.call_id, name: payload.name, input: payload.input ?? payload.arguments ?? "" };
    } else if (payload.type === "custom_tool_call_output" || payload.type === "function_call_output") {
      yield { kind: "tool-result", ...base, toolUseId: payload.call_id, text: codexOutputText(payload.output) };
    }
  }
}

// ---------------------------------------------------------------- commands

function unquote(literal) {
  const quote = literal[0];
  const body = literal.slice(1, -1);
  if (quote === "\"") {
    try { return JSON.parse(literal); } catch { /* fall through */ }
  }
  return body.replace(/\\(.)/g, (_match, char) => (char === "n" ? "\n" : char === "t" ? "\t" : char));
}

const LITERAL = "(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)";

// Shell commands inside a Codex tool call with their working folder: JS
// `cmd:` literals of the exec tool (workdir from the same object), JSON
// arguments of exec_command/shell, or the raw input.
export function commandCalls(input) {
  if (input && typeof input === "object") {
    const workdir = typeof input.workdir === "string" ? input.workdir : typeof input.cwd === "string" ? input.cwd : null;
    if (typeof input.cmd === "string") return [{ cmd: input.cmd, workdir }];
    if (Array.isArray(input.command)) return [{ cmd: input.command.join(" "), workdir }];
    if (typeof input.command === "string") return [{ cmd: input.command, workdir }];
    return [];
  }
  const text = String(input || "");
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return commandCalls(parsed);
  } catch { /* not JSON */ }
  const found = [];
  for (const match of text.matchAll(new RegExp(`\\bcmd"?\\s*:\\s*${LITERAL}`, "g"))) {
    const open = text.lastIndexOf("{", match.index);
    const close = text.indexOf("}", match.index + match[0].length);
    const object = text.slice(open === -1 ? match.index : open, close === -1 ? text.length : close);
    const workdir = new RegExp(`\\bworkdir"?\\s*:\\s*${LITERAL}`).exec(object);
    found.push({ cmd: unquote(match[1]), workdir: workdir ? unquote(workdir[1]) : null });
  }
  return found.length ? found : [{ cmd: text, workdir: null }];
}

export function commandStrings(input) {
  return commandCalls(input).map((call) => call.cmd);
}

// Simple pipelines of a command string, with the files they name. Relative
// paths are resolved against the folder the command ran in (never against the
// auditor's own folder); without one they are skipped.
export function fileReads(command, cwd = null) {
  const reads = [];
  for (const pipeline of command.split(/\n|;|&&|\|\|/)) {
    const trimmed = pipeline.trim();
    if (!trimmed) continue;
    // Only commands that print file lines are reads; rg, grep, nl, wc are not.
    if (!/^(?:cat|sed|head|tail)\s/.test(trimmed)) continue;
    const full = /^cat\s/.test(trimmed) && !trimmed.includes("|");
    for (const match of trimmed.matchAll(/(?:^|[\s'"`=(])((?:\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|[^\s'"`;|&()$]*)\/[^\s'"`;|&()]*\.md)\b/g)) {
      const named = match[1];
      const interpolated = named.includes("$");
      let filePath = named;
      if (!interpolated && !path.isAbsolute(named)) {
        if (!cwd || !path.isAbsolute(cwd) || named.startsWith("~")) continue;
        filePath = path.resolve(cwd, named);
      }
      reads.push({ path: filePath, interpolated, full, pipeline: trimmed });
    }
  }
  return reads;
}

// Several JSON values written one after another on one line, as a batched
// exec prints them; null when the text is not such a sequence.
export function parseJsonSequence(text) {
  const values = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; continue; }
    if (char === "{" || char === "[") { if (depth === 0) start = i; depth += 1; continue; }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth < 0) return null;
      if (depth === 0) {
        try { values.push(JSON.parse(text.slice(start, i + 1))); } catch { return null; }
      }
      continue;
    }
    if (depth === 0 && !/\s/.test(char)) return null;
  }
  return depth === 0 && values.length ? values : null;
}

// Output text of a Codex call split into the outputs of single commands.
export function outputSegments(text) {
  let body = String(text || "").replace(/^Script completed\nWall time[^\n]*\nOutput:\n/, "");
  const segments = [];
  const raw = [];
  const strings = (value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length < 50_000_000) {
        try { strings(JSON.parse(trimmed)); return; } catch { /* plain string */ }
      }
      segments.push(value);
    } else if (Array.isArray(value)) value.forEach(strings);
    else if (value && typeof value === "object") Object.values(value).forEach(strings);
  };
  // JSON wrappers are unpacked only when every line is JSON; otherwise the
  // output is one plain text (a file may itself hold JSON lines).
  const lines = body.split("\n").filter((line) => line.trim());
  const parsed = lines.map((line) => parseJsonSequence(line.trim()));
  if (lines.length && parsed.every(Boolean)) parsed.forEach((values) => values.forEach(strings));
  else raw.push(body);
  if (raw.join("").trim()) segments.push(raw.join("\n"));
  return segments.map((segment) => {
    const match = /^Warning: truncated output \(original token count: \d+\)\nTotal output lines: \d+\n\n/.exec(segment);
    return match ? { text: segment.slice(match[0].length), truncated: true } : { text: segment, truncated: false };
  });
}

export function uuidsIn(text) {
  return new Set((String(text || "").match(UUID_PATTERN) || []).map((id) => id.toLowerCase()));
}

// Read tool results of Claude: raw content with line numbers removed.
export function claudeReadContent(item) {
  const file = item.toolUseResult?.file;
  if (file && typeof file.content === "string") {
    return { text: file.content, startLine: file.startLine || 1, numLines: file.numLines ?? null, totalLines: file.totalLines ?? null };
  }
  const lines = [];
  let startLine = null;
  for (const line of String(item.text || "").split("\n")) {
    if (line.startsWith("<system-reminder>")) break;
    const match = /^\s*(\d+)(?:\t|→)(.*)$/.exec(line);
    if (!match) continue;
    if (startLine === null) startLine = Number(match[1]);
    lines.push(match[2]);
  }
  return { text: lines.join("\n"), startLine: startLine || 1, numLines: lines.length, totalLines: null };
}

export function existsFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
