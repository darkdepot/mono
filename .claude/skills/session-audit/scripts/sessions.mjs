// Session discovery: files of both hosts, real Mono loads with versions,
// resume and fork copies, kinds, products and links.

import fs from "node:fs";
import path from "node:path";

import {
  AuditError, expandPath, isDirectory, isInside, parseClaudeLoad, pathVersionHint, isMonoPackRoot,
  splitLines, versionField, realpathDeep,
} from "./lib.mjs";
import {
  claudeFileIdentity, claudeItems, claudeReadContent, codexFileId, codexItems, commandCalls,
  fileReads, outputSegments, uuidsIn,
} from "./records.mjs";

const AUDIT_DIR = /(^|\/)\.claude\/skills\/session-audit$/;
const AUDIT_FILE = /(^|\/)\.claude\/skills\/session-audit\/SKILL\.md$/;

function walk(dir, visit) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(child, visit);
    else if (entry.isFile()) visit(child);
  }
}

function mtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

export function codexRoots(config, env) {
  const roots = config.roots.codex.flatMap((pattern) => expandPath(pattern, env));
  for (const home of config.standCodexHomes || []) {
    for (const dir of expandPath(home, env)) roots.push(path.join(dir, "sessions"), path.join(dir, "archived_sessions"));
  }
  return [...new Set(roots)].filter(isDirectory);
}

export function claudeProjectRoots(config, env) {
  return [...new Set(config.roots.claude.flatMap((pattern) => expandPath(pattern, env)))].filter(isDirectory);
}

// Claude: <projects>/<project>/<id>.jsonl and <projects>/<project>/<id>/subagents/agent-*.jsonl.
export function listClaudeFiles(config, env) {
  const files = [];
  for (const projects of claudeProjectRoots(config, env)) {
    const profile = path.basename(path.dirname(projects));
    let projectDirs = [];
    try { projectDirs = fs.readdirSync(projects, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch { continue; }
    for (const project of projectDirs) {
      const projectDir = path.join(projects, project.name);
      let entries = [];
      try { entries = fs.readdirSync(projectDir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push({ file: path.join(projectDir, entry.name), profile, projects });
        if (entry.isDirectory()) {
          const subagents = path.join(projectDir, entry.name, "subagents");
          let names = [];
          try { names = fs.readdirSync(subagents); } catch { names = []; }
          for (const name of names) {
            if (/^agent-.+\.jsonl$/.test(name)) files.push({ file: path.join(subagents, name), profile, projects });
          }
        }
      }
    }
  }
  return files;
}

export function listCodexFiles(config, env) {
  const files = [];
  for (const root of codexRoots(config, env)) {
    const home = path.dirname(root);
    walk(root, (file) => { if (file.endsWith(".jsonl")) files.push({ file, home, root }); });
  }
  return files;
}

// ---------------------------------------------------------------- one file

function claudeLoad(item, index) {
  const load = parseClaudeLoad(item.text);
  if (!load) return null;
  const audit = AUDIT_DIR.test(load.baseDir);
  const match = /^(.*)\/skills\/([^/]+)$/.exec(load.baseDir);
  if (!match) return audit ? { audit: true, mono: false, ts: item.ts, key: item.key } : null;
  const [, root, skill] = match;
  const packRoot = isMonoPackRoot(root);
  const tags = audit ? [] : index.loadTags(skill, load.body);
  return {
    ts: item.ts, key: item.key, skill, root, baseDir: load.baseDir, tags, packRoot, audit,
    mono: !audit && (tags.length > 0 || packRoot), partial: false, via: "claude-load", pathHint: pathVersionHint(load.baseDir),
  };
}

// Each read of a Codex call is matched only against outputs whose whole text
// is its file (cat) or one contiguous range of it (partial). An output that
// fits more than one read is ambiguous and given to none; a read that fits
// more than one output with different tags is ambiguous too.
function assignOutputs(index, reads, segments) {
  const matches = reads.map((read) => segments.map((segment) => {
    let best = null;
    for (const rel of read.rels) {
      const whole = read.full && !segment.truncated;
      const result = index.sliceTags(rel, segment.text, { whole, truncated: segment.truncated });
      if (result.tags.length && (!best || result.matchedLines > best.matchedLines)) best = { ...result, rel, whole };
    }
    return best;
  }));
  return reads.map((read, r) => {
    const own = [];
    segments.forEach((_segment, s) => {
      if (!matches[r][s]) return;
      const claimants = reads.filter((_other, o) => matches[o][s]).length;
      if (claimants === 1) own.push(matches[r][s]);
    });
    if (!own.length) return null;
    const first = JSON.stringify(own[0].tags);
    if (own.some((match) => JSON.stringify(match.tags) !== first || match.rel !== own[0].rel)) return null;
    return own.reduce((a, b) => (b.matchedLines > a.matchedLines ? b : a));
  });
}

function codexReads(use, result, index, roots, cwd) {
  const loads = [];
  const stageReads = [];
  const calls = commandCalls(use.input);
  const reads = calls.flatMap(({ cmd, workdir }, callIndex) => {
    const folder = workdir ? (path.isAbsolute(workdir) ? workdir : cwd ? path.resolve(cwd, workdir) : null) : cwd;
    return fileReads(cmd, folder).map((read) => ({ ...read, callIndex }));
  });
  if (!reads.length) return { loads, stageReads };
  const segments = outputSegments(result.text);
  // The output of a read is known when results come one per call (and the
  // call has this read only), or when one call with one read printed one text.
  const readsInCall = (callIndex) => reads.filter((read) => read.callIndex === callIndex).length;
  const ownSegment = (read) => {
    if (readsInCall(read.callIndex) !== 1) return null;
    if (segments.byCall && segments.length === calls.length) return segments[read.callIndex];
    if (calls.length === 1 && segments.length === 1) return segments[0];
    return null;
  };
  const skillNames = new Set(index.skillNames());
  const planned = [];
  for (const read of reads) {
    if (AUDIT_FILE.test(read.path)) {
      loads.push({ ts: use.ts, key: use.key, audit: true, mono: false, skill: "session-audit", via: "codex-read" });
      continue;
    }
    const skillMatch = /^(.*)\/skills\/([^/]+)\/SKILL\.md$/.exec(read.path);
    if (skillMatch && !read.interpolated) {
      const [, root, skill] = skillMatch;
      const packRoot = isMonoPackRoot(root);
      if (!skillNames.has(skill) && !packRoot) continue;
      planned.push({ ...read, type: "skill", root, skill, packRoot, rels: [`skills/${skill}/SKILL.md`] });
    } else if (read.interpolated && /\/SKILL\.md$/.test(read.path)) {
      planned.push({ ...read, type: "interpolated", rels: [...skillNames].map((name) => `skills/${name}/SKILL.md`) });
    } else {
      for (const root of roots) {
        if (read.path.startsWith(`${root}/`)) planned.push({ ...read, type: "stage", root, rels: [read.path.slice(root.length + 1)] });
      }
    }
  }
  // Attributable reads are matched against their own output only; a mismatch
  // there is evidence (no tag fits). The rest share outputs by fit.
  const direct = planned.map((read) => {
    const segment = ownSegment(read);
    if (!segment) return undefined;
    let best = null;
    for (const rel of read.rels) {
      const whole = read.full && !segment.truncated;
      const found = index.sliceTags(rel, segment.text, { whole, truncated: segment.truncated });
      if (found.tags.length && (!best || found.matchedLines > best.matchedLines)) best = { ...found, rel, whole };
    }
    return best ?? { tags: [], matchedLines: 0, rel: read.rels[0], whole: false, contradiction: true, truncated: segment.truncated };
  });
  const shared = assignOutputs(index, planned.filter((_read, i) => direct[i] === undefined), segments);
  let next = 0;
  const assigned = planned.map((_read, i) => (direct[i] === undefined ? shared[next++] : direct[i]));
  planned.forEach((read, i) => {
    const match = assigned[i];
    if (read.type === "skill") {
      // A cat whose output was cut is partial; a full one that equals no tag stays full.
      const partial = !read.full || (match && !match.contradiction ? !match.whole : match?.contradiction ? Boolean(match.truncated) : segments.some((segment) => segment.truncated));
      const tags = match ? match.tags : [];
      const matchedLines = match ? match.matchedLines : 0;
      const mono = read.packRoot || (!partial && tags.length > 0) || (partial && matchedLines >= 10);
      loads.push({ ts: use.ts, key: use.key, skill: read.skill, root: read.root, baseDir: `${read.root}/skills/${read.skill}`, tags: mono ? tags : [], packRoot: read.packRoot, audit: false, mono, partial, matchedLines, via: "codex-read", pathHint: pathVersionHint(`${read.root}/skills/`) });
      if (mono) roots.add(read.root);
    } else if (read.type === "interpolated") {
      if (match && match.matchedLines >= 10) {
        const skill = /^skills\/([^/]+)\//.exec(match.rel)[1];
        loads.push({ ts: use.ts, key: use.key, skill, root: null, baseDir: null, tags: match.tags, packRoot: false, audit: false, mono: true, partial: true, matchedLines: match.matchedLines, via: "codex-read", pathHint: null });
      }
    } else if (match) {
      // Includes an attributable mismatch: tags [] makes the version unconfirmed.
      stageReads.push({ ts: use.ts, key: use.key, root: read.root, rel: read.rels[0], tags: match.tags });
    }
  });
  return { loads, stageReads };
}

export function parseFile(entry, host, index, config, problems) {
  const info = {
    path: entry.file, host, events: [], loads: [], stageReads: [], outputIds: new Set(), cwd: null, tails: [], metaTs: null,
    entrypoint: null, originator: null, source: null, forkedFrom: null, parentThread: null,
    profile: host === "claude" ? entry.profile : null, home: host === "codex" ? entry.home : null,
    subagent: null, fileId: null, recordSessionIds: new Set(),
  };
  const uses = new Map();
  const roots = new Set();
  if (host === "claude") {
    const identity = claudeFileIdentity(entry.file);
    info.fileId = identity.fileId;
    info.subagent = identity.subagent;
    for (const item of claudeItems(entry.file, problems, config, info.tails)) {
      if (item.kind === "event") {
        info.events.push({ key: item.key, copyKey: item.key, ts: item.ts, file: entry.file, offset: item.offset });
        if (item.cwd && !info.cwd) info.cwd = item.cwd;
        if (item.entrypoint && !info.entrypoint) info.entrypoint = item.entrypoint;
        if (item.sessionId) info.recordSessionIds.add(item.sessionId);
      } else if (item.kind === "meta-text") {
        const load = claudeLoad(item, index);
        if (load) {
          info.loads.push(load);
          if (load.mono && load.root) roots.add(load.root);
        }
      } else if (item.kind === "tool-use" && item.name === "Read") {
        uses.set(item.id, item);
      } else if (item.kind === "tool-result") {
        for (const id of uuidsIn(item.text)) info.outputIds.add(id);
        const use = uses.get(item.toolUseId);
        if (!use) continue;
        const filePath = use.input?.file_path || "";
        for (const root of roots) {
          if (!filePath.startsWith(`${root}/`) || !filePath.endsWith(".md")) continue;
          const content = claudeReadContent(item);
          const whole = !use.input.offset && !use.input.limit && (content.totalLines === null || content.numLines === content.totalLines);
          const rel = filePath.slice(root.length + 1);
          const result = index.positionedTags(rel, splitLines(content.text), content.startLine, whole);
          info.stageReads.push({ ts: use.ts, key: use.key, root, rel, tags: result.tags });
        }
      }
    }
  } else {
    info.fileId = codexFileId(entry.file);
    let currentCwd = null;
    for (const item of codexItems(entry.file, problems, config, info.tails)) {
      if (item.kind === "session") {
        info.fileId = item.id;
        info.metaTs = item.ts;
        currentCwd = item.cwd;
        info.forkedFrom = item.forkedFrom;
        info.originator = item.originator;
        info.source = item.source;
        info.cwd = item.cwd;
        info.parentThread = item.source?.subagent?.thread_spawn?.parent_thread_id || null;
      } else if (item.kind === "cwd") {
        if (!info.cwd) info.cwd = item.cwd;
        currentCwd = item.cwd;
      } else if (item.kind === "event") {
        info.events.push({ key: item.key, copyKey: item.copyKey, ts: item.ts, file: entry.file, offset: item.offset });
      } else if (item.kind === "tool-use") {
        uses.set(item.id, item);
      } else if (item.kind === "tool-result") {
        for (const id of uuidsIn(item.text)) info.outputIds.add(id);
        const use = uses.get(item.toolUseId);
        if (!use) continue;
        const found = codexReads(use, item, index, roots, currentCwd || info.cwd);
        info.loads.push(...found.loads);
        info.stageReads.push(...found.stageReads);
      }
    }
  }
  const times = info.events.map((event) => Date.parse(event.ts)).filter(Number.isFinite);
  info.firstTs = times.length ? Math.min(...times) : null;
  info.lastTs = times.length ? Math.max(...times) : null;
  return info;
}

export function failOnProblems(problems) {
  if (!problems.length) return;
  const shown = problems.slice(0, 50).map((problem) => `${problem.file}:${problem.line}: ${problem.kind}`);
  throw new AuditError(`unknown session records (${problems.length}); add the kind to config.json only after reading it`, { problems: shown });
}

// ---------------------------------------------------------------- sessions

function inWindow(ts, window) {
  const time = Date.parse(ts);
  return Number.isFinite(time) && time > Date.parse(window.start) && time <= Date.parse(window.end);
}

export function codexIdIndex(config, env) {
  const map = new Map();
  for (const entry of listCodexFiles(config, env)) {
    const id = codexFileId(entry.file);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(entry);
  }
  return map;
}

// Group files into sessions: Claude files that share event uuids are one
// session (resume copies), Codex files with the same id are one session.
export function groupSessions(infos) {
  const parent = new Map();
  const find = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const sorted = [...infos].sort((a, b) => (a.firstTs ?? Infinity) - (b.firstTs ?? Infinity));
  const nameOf = (info) => `${info.host}:${info.subagent ? `${info.subagent.parentId}/` : ""}${info.fileId}`;
  for (const info of sorted) parent.set(nameOf(info), nameOf(info));
  const owner = new Map();
  for (const info of sorted) {
    const name = nameOf(info);
    if (info.host === "codex") {
      const key = `codex-id:${info.fileId}`;
      if (owner.has(key)) union(name, owner.get(key)); else owner.set(key, name);
      continue;
    }
    if (info.subagent) continue;
    for (const event of info.events) {
      const key = `claude-uuid:${event.key}`;
      if (owner.has(key)) union(name, owner.get(key)); else owner.set(key, name);
    }
  }
  const groups = new Map();
  for (const info of sorted) {
    const root = find(nameOf(info));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(info);
  }
  return [...groups.values()].map((files) => {
    const first = files[0];
    const seen = new Set();
    const events = [];
    for (const info of files) {
      for (const event of info.events) {
        if (seen.has(event.key)) continue;
        seen.add(event.key);
        events.push({ ...event, file: info.path });
      }
    }
    events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    // Resume copies repeat loads and reads under the same event key.
    const once = (list) => {
      const keys = new Set();
      return list.filter((item) => {
        const key = `${item.key}|${item.skill || ""}|${item.root || ""}|${item.rel || ""}`;
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      });
    };
    const loads = once(files.flatMap((info) => info.loads)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const stageReads = once(files.flatMap((info) => info.stageReads)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const outputIds = new Set(files.flatMap((info) => [...info.outputIds]));
    return {
      id: first.subagent ? `agent-${first.subagent.agentId}` : first.fileId,
      ids: [...new Set(files.map((info) => (info.subagent ? `agent-${info.subagent.agentId}` : info.fileId)))],
      host: first.host,
      profile: first.profile,
      home: first.home,
      files: files.map((info) => info.path),
      cwd: files.map((info) => info.cwd).find(Boolean) || null,
      entrypoint: files.map((info) => info.entrypoint).find(Boolean) || null,
      originator: first.originator,
      source: first.source,
      forkedFrom: first.forkedFrom,
      forkTime: first.metaTs,
      parentThread: first.parentThread,
      subagent: first.subagent,
      recordSessionIds: new Set(files.flatMap((info) => [...info.recordSessionIds])),
      tails: files.flatMap((info) => info.tails),
      events, loads, stageReads, outputIds,
    };
  });
}

// Version of each load: tags of the load intersected with tags of every file
// of the same pack root read after it and before the next load.
export function loadVersions(session) {
  const loads = session.loads.filter((load) => load.mono);
  return loads.map((load, i) => {
    const next = loads[i + 1];
    let tags = [...(load.tags || [])];
    for (const read of session.stageReads) {
      if (read.root !== load.root) continue;
      const time = Date.parse(read.ts);
      if (time < Date.parse(load.ts)) continue;
      if (next && time >= Date.parse(next.ts)) continue;
      tags = tags.filter((tag) => read.tags.includes(tag));
    }
    return {
      skill: load.skill,
      at: load.ts,
      path: load.baseDir,
      partial: Boolean(load.partial),
      version: versionField(tags, load.pathHint),
    };
  });
}

export function productOf(cwd) {
  if (!cwd) return "unknown";
  const repo = cwd.replace(/\/\.worktrees\/[^/]+(?:\/.*)?$/, "").replace(/\/\.claude\/worktrees\/[^/]+(?:\/.*)?$/, "");
  for (let dir = repo; ; dir = path.dirname(dir)) {
    try { if (fs.lstatSync(path.join(dir, ".git"))) return path.basename(dir); } catch { /* keep walking */ }
    if (path.dirname(dir) === dir) break;
  }
  return path.basename(repo) || "unknown";
}

export function taskOf(cwd) {
  const match = /\/\.worktrees\/([A-Z][A-Z0-9]*-\d+)(?:\/|$)/.exec(cwd || "");
  return match ? match[1] : null;
}

function isHeadless(session, config) {
  if (session.host === "claude") return config.kinds.claudeHeadlessEntrypoints.includes(session.entrypoint);
  return config.kinds.codexHeadlessOriginators.includes(session.originator) || session.source === "exec";
}

export function kindOf(session, skills, config) {
  const review = skills.some((skill) => config.kinds.reviewSkills.includes(skill));
  const subagent = Boolean(session.subagent) || Boolean(session.parentThread);
  if (subagent) return review ? "review" : "stage-agent";
  if (isHeadless(session, config)) return review ? "review" : "worker";
  return skills.some((skill) => config.kinds.orchestratorSkills.includes(skill)) ? "orchestrator" : "owner";
}

function runMark(session, skills, config, env) {
  const reasons = [];
  if (skills.some((skill) => config.runSkills.includes(skill))) reasons.push("qa-load");
  const places = [session.cwd, session.home].filter(Boolean).map((place) => realpathDeep(place));
  for (const prefix of config.runPrefixes || []) {
    for (const dir of expandPath(prefix, env)) {
      const real = realpathDeep(dir);
      if (places.some((place) => isInside(place, real))) reasons.push(`prefix:${prefix}`);
    }
  }
  for (const home of config.standCodexHomes || []) {
    for (const dir of expandPath(home, env)) {
      if (session.home && isInside(realpathDeep(session.home), realpathDeep(dir))) reasons.push(`stand-home:${home}`);
    }
  }
  return { marked: reasons.length > 0, reasons: [...new Set(reasons)] };
}

// Worker ids found in orchestrator records (ledger, attempts, dispatch, reports).
export function orchestratorMentions(orchRoot, ids, config) {
  const found = new Map();
  if (!ids.length || !isDirectory(orchRoot)) return found;
  const skip = new RegExp(config.sourceSkipPattern);
  for (const product of fs.readdirSync(orchRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const productDir = path.join(orchRoot, product.name);
    const files = [];
    for (const name of config.linkFiles) {
      const target = path.join(productDir, name);
      if (isDirectory(target)) walk(target, (file) => files.push(file));
      else files.push(target);
    }
    for (const file of files) {
      const relative = path.relative(productDir, file);
      if (skip.test(relative)) continue;
      let text;
      try {
        if (fs.statSync(file).size > 16 << 20) continue;
        text = fs.readFileSync(file, "utf8");
      } catch { continue; }
      for (const id of ids) {
        if (!text.includes(id)) continue;
        if (!found.has(id)) found.set(id, new Map());
        if (!found.get(id).has(product.name)) found.get(id).set(product.name, path.join(product.name, relative));
      }
    }
  }
  return found;
}

// A fork copies its parent's items at the moment of forking: an item counts as
// a copy when its content (copyKey) is the parent's and its time is within the
// copy burst after the fork's own start; later repeats stay new.
const FORK_COPY_MS = 5000;
export function isForkCopy(session, event, parentKeys) {
  if (!session.forkedFrom || !parentKeys || !parentKeys.has(event.copyKey)) return false;
  const forkTime = Date.parse(session.forkTime);
  return !Number.isFinite(forkTime) || Date.parse(event.ts) <= forkTime + FORK_COPY_MS;
}

// The headless child whose id is printed in exactly one other session's output.
function outputParent(session, sessions) {
  const parents = sessions.filter((other) => other !== session && session.ids.some((id) => other.outputIds.has(id.toLowerCase())));
  return parents.length === 1 ? parents[0] : null;
}

export function describeSessions({ sessions, window, config, env, orchRoot, forkParentKeys, revisit = new Set() }) {
  const excluded = { noMonoLoad: 0, audit: 0, configured: 0, noNewEvents: 0 };
  const auditIds = new Set();
  for (const session of sessions) {
    if (session.loads.some((load) => load.audit)) session.ids.forEach((id) => auditIds.add(id));
  }
  // Subagents, Codex children and headless runs started by an audit session
  // (linked as below) are part of it, to any depth.
  for (let changed = true; changed;) {
    changed = false;
    for (const session of sessions) {
      if (session.ids.some((id) => auditIds.has(id))) continue;
      let parentId = session.subagent?.parentId || session.parentThread || session.forkedFrom || null;
      if (!parentId && isHeadless(session, config)) parentId = outputParent(session, sessions)?.id ?? null;
      const parent = parentId ? sessions.find((other) => other.ids.includes(parentId)) : null;
      if (parentId && (auditIds.has(parentId) || parent?.ids.some((id) => auditIds.has(id)))) {
        session.ids.forEach((id) => auditIds.add(id));
        changed = true;
      }
    }
  }
  const configured = new Set(config.excludedSessions || []);
  const kept = [];
  for (const session of sessions) {
    const parentKeys = session.forkedFrom ? forkParentKeys.get(session.forkedFrom) : null;
    const end = Date.parse(window.end);
    // Events of a record that was still being written at the last pass are
    // read now whatever their own time.
    const revisited = (event) => revisit.has(`${event.file}|${event.offset}`) && Date.parse(event.ts) <= end;
    const fresh = session.events.filter((event) => (inWindow(event.ts, window) || revisited(event)) && !isForkCopy(session, event, parentKeys));
    session.newEvents = fresh;
    session.revisitKeys = session.events.filter(revisited).map((event) => event.key);
    session.forkCopies = session.events.filter((event) => isForkCopy(session, event, parentKeys)).length;
    if (session.ids.some((id) => auditIds.has(id))) { if (fresh.length) excluded.audit += 1; continue; }
    if (session.ids.some((id) => configured.has(id))) { if (fresh.length) excluded.configured += 1; continue; }
    if (!session.loads.some((load) => load.mono)) { if (fresh.length) excluded.noMonoLoad += 1; continue; }
    if (!fresh.length) { excluded.noNewEvents += 1; continue; }
    kept.push(session);
  }
  const headlessIds = kept.filter((session) => isHeadless(session, config)).flatMap((session) => session.ids);
  const mentions = orchestratorMentions(orchRoot, headlessIds, config);
  const described = kept.map((session) => {
    const loads = loadVersions(session);
    const skills = [...new Set(loads.map((load) => load.skill))];
    const kind = kindOf(session, skills, config);
    let parent = null;
    if (session.subagent) {
      const ok = session.recordSessionIds.has(session.subagent.parentId) && session.subagent.metaFile;
      parent = ok ? { id: session.subagent.parentId, via: "subagent-meta" } : null;
    } else if (session.parentThread) {
      parent = { id: session.parentThread, via: "codex-thread-spawn" };
    } else if (session.forkedFrom) {
      parent = { id: session.forkedFrom, via: "codex-fork" };
    } else if (isHeadless(session, config)) {
      const found = outputParent(session, sessions);
      if (found) parent = { id: found.id, via: "parent-output" };
    }
    let orchestrator = null;
    if (isHeadless(session, config)) {
      const products = new Map();
      for (const id of session.ids) for (const [product, file] of mentions.get(id) || []) products.set(product, file);
      if (products.size === 1) {
        const [[product, file]] = [...products];
        orchestrator = { product, via: file };
      }
    }
    const task = taskOf(session.cwd);
    const product = orchestrator ? orchestrator.product : productOf(session.cwd);
    return {
      id: session.id,
      ids: session.ids,
      host: session.host,
      profile: session.host === "claude" ? session.profile : session.home,
      files: session.files,
      cwd: session.cwd,
      product,
      kind,
      run: runMark(session, skills, config, env),
      loads,
      links: { parent, orchestrator, task, stages: skills },
      linkStatus: parent || orchestrator || task ? "linked" : "none",
      newEvents: session.newEvents.length,
      forkedFrom: session.forkedFrom,
      forkTime: session.forkTime,
      forkCopiesSkipped: session.forkCopies,
      revisitKeys: session.revisitKeys,
      firstNewEvent: { key: session.newEvents[0].key, ts: session.newEvents[0].ts },
      lastNewEvent: { key: session.newEvents.at(-1).key, ts: session.newEvents.at(-1).ts },
    };
  });
  return { sessions: described, excluded };
}

export function loadAllSessions({ config, env, index, window, problems }) {
  const since = Date.parse(window.start);
  const claudeFiles = listClaudeFiles(config, env).filter((entry) => mtime(entry.file) > since);
  const codexFiles = listCodexFiles(config, env).filter((entry) => mtime(entry.file) > since);
  const infos = [
    ...claudeFiles.map((entry) => parseFile(entry, "claude", index, config, problems)),
    ...codexFiles.map((entry) => parseFile(entry, "codex", index, config, problems)),
  ];
  const sessions = groupSessions(infos);
  const parentKeys = new Map();
  const idIndex = codexIdIndex(config, env);
  for (const session of sessions) {
    if (!session.forkedFrom || parentKeys.has(session.forkedFrom)) continue;
    parentKeys.set(session.forkedFrom, forkParentKeys(session.forkedFrom, config, env, index, problems, idIndex));
  }
  const tails = sessions.flatMap((session) => session.tails.map(({ file, offset, line }) => ({ session: session.id, file, offset, line })));
  return { sessions, forkParentKeys: parentKeys, tails };
}

// Event keys of a fork's parent, found by id in every Codex root regardless of file time.
export function forkParentKeys(parentId, config, env, index, problems, idIndex = codexIdIndex(config, env)) {
  const keys = new Set();
  for (const entry of idIndex.get(parentId) || []) {
    const info = parseFile(entry, "codex", index, config, problems);
    info.events.forEach((event) => keys.add(event.copyKey));
  }
  return keys;
}

export function findSession(sessions, id) {
  return sessions.find((session) => session.ids.includes(id) || session.id === id) || null;
}
