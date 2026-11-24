// Shared pieces of the session-audit project skill: config, data root guard,
// state files, line reading and pack tag matching. Node built-ins only.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class AuditError extends Error {
  constructor(message, details = {}, exitCode = 2) {
    super(message);
    this.details = details;
    this.exitCode = exitCode;
  }
}

export function homeDir(env = process.env) {
  return env.HOME || os.homedir();
}

// "~" and "~/.claude*" style patterns: a single trailing "*" in one path
// segment matches existing directory names with that prefix.
export function expandPath(pattern, env = process.env) {
  const home = homeDir(env);
  let value = pattern === "~" ? home : pattern.startsWith("~/") ? path.join(home, pattern.slice(2)) : pattern;
  const segments = value.split("/");
  let results = [segments[0] === "" ? "/" : segments[0]];
  for (const segment of segments.slice(1)) {
    if (!segment) continue;
    const next = [];
    for (const base of results) {
      if (segment.includes("*")) {
        const prefix = segment.slice(0, segment.indexOf("*"));
        const suffix = segment.slice(segment.indexOf("*") + 1);
        let names = [];
        try { names = fs.readdirSync(base); } catch { names = []; }
        for (const name of names.sort()) {
          if (name.startsWith(prefix) && name.endsWith(suffix) && isDirectory(path.join(base, name))) next.push(path.join(base, name));
        }
      } else {
        next.push(path.join(base, segment));
      }
    }
    results = next;
  }
  return results;
}

export function isDirectory(candidate) {
  try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
}

export function isFile(candidate) {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}

function exists(candidate) {
  try { fs.lstatSync(candidate); return true; } catch { return false; }
}

// The existing part of a path with the file system's own letter case.
function canonical(dir) {
  try { return fs.realpathSync.native(dir); } catch { return dir; }
}

// Resolve every symlink on the path, including a link whose target does not
// exist yet, and the real letter case of existing parts (a case-insensitive
// file system accepts ".CLAUDE" for ".claude"); the missing tail stays literal.
export function realpathDeep(candidate, depth = 0) {
  const parts = path.resolve(candidate).split(path.sep).filter(Boolean);
  let current = path.sep;
  for (let i = 0; i < parts.length; i += 1) {
    const next = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(next); } catch { return path.join(canonical(current), ...parts.slice(i)); }
    if (stat.isSymbolicLink() && depth < 40) {
      const target = path.resolve(current, fs.readlinkSync(next));
      return realpathDeep(path.join(target, ...parts.slice(i + 1)), depth + 1);
    }
    current = next;
  }
  return canonical(current);
}

// ---------------------------------------------------------------- safe writes

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

// Session ids, pass uuids and file names that become path segments.
export function checkName(value, what = "name") {
  if (typeof value !== "string" || !SAFE_NAME.test(value) || value.includes("..")) {
    throw new AuditError(`${what} is not a safe id: ${JSON.stringify(value)}`);
  }
  return value;
}

// A directory under the data root, created one level at a time; every level
// must be a real directory (no symlink) whose resolved path stays the same.
export function safeDir(root, segments, { create = true } = {}) {
  let current = root;
  const check = (dir) => {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new AuditError(`refusing to write through ${dir}: not a plain directory`);
    if (canonical(dir) !== dir) throw new AuditError(`refusing to write through ${dir}: resolves elsewhere`);
  };
  if (!exists(root)) {
    if (!create) return null;
    fs.mkdirSync(root, { recursive: true });
  }
  check(root);
  for (const segment of segments) {
    checkName(segment, "path segment");
    current = path.join(current, segment);
    if (!exists(current)) {
      if (!create) return null;
      fs.mkdirSync(current);
    }
    check(current);
  }
  return current;
}

export function safeFile(root, segments) {
  const name = checkName(segments.at(-1), "file name");
  const dir = safeDir(root, segments.slice(0, -1));
  const file = path.join(dir, name);
  if (exists(file) && !fs.lstatSync(file).isFile()) throw new AuditError(`refusing to write ${file}: not a plain file`);
  return file;
}

export function safeRemoveDir(root, segments) {
  const dir = safeDir(root, segments, { create: false });
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- lock

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

// One command at a time changes the data root: an exclusive lock file with
// the holder's pid; a lock of a dead process is taken over.
export function withLock(root, sessionId, action) {
  const file = safeFile(root, ["lock"]);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, sessionId, at: new Date().toISOString() }));
      fs.closeSync(fd);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt > 0) throw error.code === "EEXIST" ? new AuditError("another session-audit command holds the lock", { lock: file }, 3) : error;
      let holder = null;
      try { holder = readJson(file); } catch { holder = null; }
      // A lock still being written (no pid yet) is held unless it is old.
      let age = 0;
      try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { age = 0; }
      const fresh = !holder && age < 60_000;
      if (fresh || (Number.isInteger(holder?.pid) && alive(holder.pid))) {
        throw new AuditError("another session-audit command is running", { holderPid: holder?.pid ?? null, holderSession: holder?.sessionId ?? null }, 3);
      }
      fs.rmSync(file, { force: true });
    }
  }
  try {
    return action();
  } finally {
    try {
      if (readJson(file).pid === process.pid) fs.rmSync(file, { force: true });
    } catch { /* already gone */ }
  }
}

export function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// ---------------------------------------------------------------- config

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function sharedConfig() {
  return readJson(path.join(SKILL_DIR, "config.json"));
}

// The personal config.json of the data root overrides shared keys one by one.
export function loadConfig(dataRoot) {
  const shared = sharedConfig();
  const personalFile = path.join(dataRoot, "config.json");
  if (!isFile(personalFile)) return { ...shared, personal: false };
  let personal;
  try { personal = readJson(personalFile); } catch (error) {
    throw new AuditError(`personal config is not valid JSON: ${personalFile}: ${error.message}`);
  }
  return { ...shared, ...personal, personal: true };
}

// ---------------------------------------------------------------- data root

export function stateRoot(env = process.env) {
  return env.MONO_WORKFLOW_STATE_ROOT || path.join(homeDir(env), ".mono-agent-workflow");
}

export function defaultDataRoot(env = process.env) {
  if (env.SESSION_AUDIT_HOME) return path.resolve(env.SESSION_AUDIT_HOME);
  return path.join(stateRoot(env), "orchestrator", "mono-agent-workflow", "session-audit");
}

export function orchestratorRoot(env = process.env) {
  return path.join(stateRoot(env), "orchestrator");
}

export function monoRepo(env = process.env) {
  if (env.SESSION_AUDIT_REPO) return path.resolve(env.SESSION_AUDIT_REPO);
  try {
    return execFileSync("git", ["-C", SKILL_DIR, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new AuditError(`cannot find the mono repository above ${SKILL_DIR}; set SESSION_AUDIT_REPO`);
  }
}

function monoManifest(dir) {
  for (const manifest of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    try {
      if (readJson(path.join(dir, manifest)).name === "mono") return true;
    } catch { /* absent or unreadable */ }
  }
  return false;
}

// U1: the data root must not sit inside a git checkout, the mono repository
// or a place where the pack is installed (checked after resolving symlinks).
export function guardDataRoot(dataRoot, { config, env = process.env, repo } = {}) {
  const resolved = realpathDeep(dataRoot);
  const reasons = [];
  for (let dir = resolved; ; dir = path.dirname(dir)) {
    if (exists(path.join(dir, ".git"))) reasons.push(`inside a git checkout: ${dir}`);
    if (monoManifest(dir)) reasons.push(`inside an installed Mono pack: ${dir}`);
    if (path.dirname(dir) === dir) break;
  }
  if (repo) {
    const repoReal = realpathDeep(repo);
    if (isInside(resolved, repoReal)) reasons.push(`inside the mono repository: ${repoReal}`);
  }
  for (const pattern of config?.packInstallDirs || []) {
    for (const dir of expandPath(pattern, env)) {
      const real = realpathDeep(dir);
      if (isInside(resolved, real)) reasons.push(`inside a pack install directory: ${real}`);
    }
  }
  if (reasons.length) {
    throw new AuditError(`data root refused: ${resolved}`, { dataRoot: resolved, reasons: [...new Set(reasons)] });
  }
  return resolved;
}

// ---------------------------------------------------------------- state

export function writeJsonAtomic(root, segments, value) {
  const file = safeFile(root, segments);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temp, file);
  return file;
}

export function readState(dataRoot) {
  const file = path.join(dataRoot, "state.json");
  if (!isFile(file)) return { boundary: null, pending: null };
  const state = readJson(file);
  return { boundary: state.boundary ?? null, pending: state.pending ?? null, ...state };
}

export function writeState(dataRoot, state) {
  writeJsonAtomic(dataRoot, ["state.json"], state);
}

// Writes of a pass happen only while state.json still names this pass and
// this session as its holder (checked under the lock, right before writing).
export function assertFence(dataRoot, passUuid, sessionId) {
  const state = readState(dataRoot);
  if (!state.pending || state.pending.uuid !== passUuid || state.pending.sessionId !== sessionId) {
    throw new AuditError("the pass changed hands; nothing written", {
      passUuid, callerSession: sessionId,
      currentPass: state.pending?.uuid ?? null, holderSession: state.pending?.sessionId ?? null,
    }, 3);
  }
}

export function readQueue(dataRoot) {
  const file = path.join(dataRoot, "queue.json");
  if (!isFile(file)) return [];
  const queue = readJson(file);
  return Array.isArray(queue) ? queue : Array.isArray(queue.signals) ? queue.signals : [];
}

export function appendRunLog(dataRoot, passUuid, line) {
  const file = safeFile(dataRoot, ["runs", passUuid, "log"]);
  fs.appendFileSync(file, `${line}\n`);
}

// Only the session that holds the unfinished pass may continue it.
export function assertOwner(state, sessionId) {
  if (state.pending && state.pending.sessionId !== sessionId) {
    throw new AuditError("not the owner of the unfinished pass", {
      passUuid: state.pending.uuid,
      holderSession: state.pending.sessionId,
      callerSession: sessionId,
    }, 3);
  }
}

// ---------------------------------------------------------------- lines

// Streams a JSONL file line by line. The last line without a newline may be
// a record still being written and is reported as such, not parsed as broken.
export function* readLines(file) {
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1 << 22);
  let rest = Buffer.alloc(0);
  let lineNo = 0;
  let base = 0; // file offset of chunk[0]
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const chunk = rest.length ? Buffer.concat([rest, buffer.subarray(0, count)]) : buffer.subarray(0, count);
      let start = 0;
      let index;
      while ((index = chunk.indexOf(10, start)) !== -1) {
        lineNo += 1;
        yield { text: chunk.toString("utf8", start, index), lineNo, offset: base + start, complete: true };
        start = index + 1;
      }
      base += start;
      rest = Buffer.from(chunk.subarray(start));
    }
    if (rest.length) {
      lineNo += 1;
      yield { text: rest.toString("utf8"), lineNo, offset: base, complete: false };
    }
  } finally {
    fs.closeSync(fd);
  }
}

// A last line without its newline is a record still being written: it is not
// read now but reported in `tails` (file and byte offset), so the next pass can
// take it as new even if its own time is before the boundary.
export function* readRecords(file, problems, tails = null) {
  for (const { text, lineNo, offset, complete } of readLines(file)) {
    if (!text.trim()) continue;
    if (!complete) {
      if (tails) tails.push({ file, offset, line: lineNo });
      continue;
    }
    let record;
    try { record = JSON.parse(text); } catch {
      problems.push({ file, line: lineNo, kind: "unparsable line" });
      continue;
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      problems.push({ file, line: lineNo, kind: "not an object" });
      continue;
    }
    yield { record, lineNo, offset };
  }
}

// ---------------------------------------------------------------- tags

const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

export function compareTags(left, right) {
  const a = TAG_PATTERN.exec(left).slice(1).map(Number);
  const b = TAG_PATTERN.exec(right).slice(1).map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function stripFrontmatter(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return match ? text.slice(match[0].length) : text;
}

function frontmatterLineCount(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return match ? match[0].split("\n").length - 1 : 0;
}

export function normalizeSkillBody(text) {
  return stripFrontmatter(text).replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "");
}

// Live form of a Claude load: first line "Base directory for this skill: …",
// one empty line, the SKILL.md body without frontmatter, and arguments of the
// invocation appended as "\n\nARGUMENTS: …".
export function parseClaudeLoad(text) {
  const match = /^Base directory for this skill: ([^\n]+)\n/.exec(text);
  if (!match) return null;
  let body = text.slice(match[0].length);
  if (body.startsWith("\n")) body = body.slice(1);
  body = body.replace(/\n\nARGUMENTS: [\s\S]*$/, "");
  return { baseDir: match[1].trim(), body };
}

export function splitLines(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.map((line) => line.replace(/\s+$/, ""));
}

// Longest run of consecutive `read` lines equal to consecutive `file` lines.
export function longestRun(readLines, fileLines) {
  const positions = new Map();
  fileLines.forEach((line, index) => {
    if (!positions.has(line)) positions.set(line, []);
    positions.get(line).push(index);
  });
  let previous = new Map();
  let best = { length: 0, readEnd: -1, fileEnd: -1 };
  for (let i = 0; i < readLines.length; i += 1) {
    const current = new Map();
    for (const j of positions.get(readLines[i]) || []) {
      const length = (previous.get(j - 1) || 0) + 1;
      current.set(j, length);
      if (length > best.length) best = { length, readEnd: i, fileEnd: j };
    }
    previous = current;
  }
  return best;
}

export class TagIndex {
  constructor(repo) {
    this.repo = repo;
    this.trees = new Map();
    this.blobs = new Map();
    let output = "";
    try {
      output = execFileSync("git", ["-C", repo, "tag", "--list", "v*"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      throw new AuditError(`cannot list tags of ${repo}`);
    }
    this.tags = output.split("\n").map((tag) => tag.trim()).filter((tag) => TAG_PATTERN.test(tag)).sort(compareTags);
  }

  tree(tag) {
    if (!this.trees.has(tag)) {
      const map = new Map();
      const output = execFileSync("git", ["-C", this.repo, "ls-tree", "-r", "--full-tree", tag], { encoding: "utf8", maxBuffer: 64 << 20 });
      for (const line of output.split("\n")) {
        const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
        if (match) map.set(match[2], match[1]);
      }
      this.trees.set(tag, map);
    }
    return this.trees.get(tag);
  }

  file(tag, relative) {
    const blob = this.tree(tag).get(relative);
    if (!blob) return null;
    if (!this.blobs.has(blob)) {
      this.blobs.set(blob, execFileSync("git", ["-C", this.repo, "cat-file", "blob", blob], { encoding: "utf8", maxBuffer: 64 << 20 }));
    }
    return this.blobs.get(blob);
  }

  skillNames() {
    const names = new Set();
    for (const tag of this.tags) {
      for (const relative of this.tree(tag).keys()) {
        const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(relative);
        if (match) names.add(match[1]);
      }
    }
    return [...names];
  }

  // Tags whose skills/<name>/SKILL.md equals the loaded body after normalization.
  loadTags(name, body) {
    const wanted = normalizeSkillBody(body);
    return this.tags.filter((tag) => {
      const text = this.file(tag, `skills/${name}/SKILL.md`);
      return text !== null && normalizeSkillBody(text) === wanted;
    });
  }

  // A read with known position (Claude Read): lines start at startLine (1-based).
  positionedTags(relative, lines, startLine, whole) {
    const wanted = lines.map((line) => line.replace(/\s+$/, ""));
    while (wanted.length && wanted[wanted.length - 1] === "") wanted.pop();
    const tags = this.tags.filter((tag) => {
      const text = this.file(tag, relative);
      if (text === null) return false;
      const fileLines = splitLines(text);
      if (whole) return fileLines.length === wanted.length && fileLines.every((line, i) => line === wanted[i]);
      const slice = fileLines.slice(startLine - 1, startLine - 1 + wanted.length);
      return slice.length === wanted.length && slice.every((line, i) => line === wanted[i]);
    });
    return { tags, matchedLines: nonEmptyBody(relative, wanted, startLine, this, tags) };
  }

  // A read without known position (Codex output of one command). The whole
  // observed text must equal the tag file (`whole`) or one contiguous range
  // of it; a cut output loses its last, possibly partial line first.
  sliceTags(relative, readText, { whole = false, truncated = false } = {}) {
    const lines = splitLines(readText);
    if (truncated && lines.length) lines.pop();
    while (lines.length && lines[0] === "") lines.shift();
    if (!lines.length) return { tags: [], matchedLines: 0 };
    const tags = [];
    let position = -1;
    for (const tag of this.tags) {
      const text = this.file(tag, relative);
      if (text === null) continue;
      const fileLines = splitLines(text);
      let at = -1;
      if (whole) {
        if (fileLines.length === lines.length && fileLines.every((line, i) => line === lines[i])) at = 0;
      } else {
        for (let j = 0; j + lines.length <= fileLines.length && at === -1; j += 1) {
          if (fileLines[j] === lines[0] && lines.every((line, i) => fileLines[j + i] === line)) at = j;
        }
      }
      if (at === -1) continue;
      if (!tags.length) position = at;
      tags.push(tag);
    }
    return { tags, matchedLines: tags.length ? nonEmptyBody(relative, lines, position + 1, this, tags) : 0 };
  }
}

function nonEmptyBody(relative, lines, startLine, index, tags) {
  if (!tags.length) return 0;
  const skip = frontmatterLineCount(index.file(tags[0], relative));
  let count = 0;
  lines.forEach((line, i) => {
    if (startLine - 1 + i >= skip && line.trim()) count += 1;
  });
  return count;
}

export function versionField(tags, pathHint) {
  if (tags && tags.length) {
    return { status: "confirmed", tags, range: tags.length === 1 ? tags[0] : `${tags[0]}..${tags[tags.length - 1]}` };
  }
  return { status: "unconfirmed", pathHint: pathHint || null };
}

export function pathVersionHint(dir) {
  const match = /\/(\d+\.\d+\.\d+)\/skills\//.exec(`${dir}/`) || /\/(\d+\.\d+\.\d+)\/?$/.exec(dir);
  return match ? `v${match[1]}` : null;
}

// U2: a pack root is a directory with a Mono plugin manifest or a pack cache path.
export function isMonoPackRoot(dir) {
  if (/\/mono-marketplace\/mono\/\d+\.\d+\.\d+$/.test(dir)) return true;
  return monoManifest(dir);
}

export function isoNow(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new AuditError(`not a time: ${value}`);
  return date.toISOString();
}
