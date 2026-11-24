// Session discovery: files of both hosts, real Mono loads with versions,
// resume and fork copies, kinds, products and links.

import fs from "node:fs";
import path from "node:path";

import {
  AuditError, expandPath, isDirectory, isInside, parseClaudeLoad, pathVersionHint, isMonoPackRoot,
  splitLines, versionField, realpathDeep,
} from "./lib.mjs";
import {
  claudeFileIdentity, claudeItems, claudeReadContent, codexFileId, codexItems, commandStrings,
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

function bestSegment(index, relCandidates, segments, wantWhole) {
  let best = { tags: [], matchedLines: 0, rel: relCandidates[0] || null, whole: false };
  for (const segment of segments) {
    for (const rel of relCandidates) {
      const whole = wantWhole && !segment.truncated;
      const result = index.runTags(rel, segment.text, whole);
      const score = result.tags.length ? result.matchedLines + (whole ? 1e6 : 0) : -1;
      const bestScore = best.tags.length ? best.matchedLines + (best.whole ? 1e6 : 0) : -1;
      if (score > bestScore) best = { ...result, rel, whole };
    }
  }
  return best;
}

function codexReads(use, result, index, roots) {
  const loads = [];
  const stageReads = [];
  const reads = commandStrings(use.input).flatMap(fileReads);
  if (!reads.length) return { loads, stageReads };
  const segments = outputSegments(result.text);
  const skillNames = new Set(index.skillNames());
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
      const wantWhole = read.full;
      const best = bestSegment(index, [`skills/${skill}/SKILL.md`], segments, wantWhole);
      const partial = !(wantWhole && best.whole);
      const tags = !partial || best.matchedLines > 0 ? best.tags : [];
      const mono = packRoot || (!partial && tags.length > 0) || (partial && best.matchedLines >= 10);
      loads.push({ ts: use.ts, key: use.key, skill, root, baseDir: `${root}/skills/${skill}`, tags: mono ? tags : [], packRoot, audit: false, mono, partial, matchedLines: best.matchedLines, via: "codex-read", pathHint: pathVersionHint(root + "/skills/") });
      if (mono) roots.add(root);
      continue;
    }
    if (read.interpolated && /\/SKILL\.md$/.test(read.path)) {
      const candidates = [...skillNames].map((name) => `skills/${name}/SKILL.md`);
      const best = bestSegment(index, candidates, segments, false);
      if (best.matchedLines >= 10) {
        const skill = /^skills\/([^/]+)\//.exec(best.rel)[1];
        loads.push({ ts: use.ts, key: use.key, skill, root: null, baseDir: null, tags: best.tags, packRoot: false, audit: false, mono: true, partial: true, matchedLines: best.matchedLines, via: "codex-read", pathHint: null });
      }
      continue;
    }
    for (const root of roots) {
      if (!read.path.startsWith(`${root}/`)) continue;
      const rel = read.path.slice(root.length + 1);
      const best = bestSegment(index, [rel], segments, read.full);
      // A full read that equals no tag is evidence; a partial read whose lines
      // are not in the output at all (output not printed) is not.
      if (!best.tags.length && !read.full) continue;
      stageReads.push({ ts: use.ts, key: use.key, root, rel, tags: best.tags });
    }
  }
  return { loads, stageReads };
}

export function parseFile(entry, host, index, config, problems) {
  const info = {
    path: entry.file, host, events: [], loads: [], stageReads: [], outputIds: new Set(), cwd: null,
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
    for (const item of claudeItems(entry.file, problems, config)) {
      if (item.kind === "event") {
        info.events.push({ key: item.key, ts: item.ts });
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
    for (const item of codexItems(entry.file, problems, config)) {
      if (item.kind === "session") {
        info.fileId = item.id;
        info.forkedFrom = item.forkedFrom;
        info.originator = item.originator;
        info.source = item.source;
        info.cwd = item.cwd;
        info.parentThread = item.source?.subagent?.thread_spawn?.parent_thread_id || null;
      } else if (item.kind === "cwd") {
        if (!info.cwd) info.cwd = item.cwd;
      } else if (item.kind === "event") {
        info.events.push({ key: item.key, ts: item.ts });
      } else if (item.kind === "tool-use") {
        uses.set(item.id, item);
      } else if (item.kind === "tool-result") {
        for (const id of uuidsIn(item.text)) info.outputIds.add(id);
        const use = uses.get(item.toolUseId);
        if (!use) continue;
        const found = codexReads(use, item, index, roots);
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
        const key = `${item.key}|${item.skill || ""}|${item.rel || ""}`;
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
      parentThread: first.parentThread,
      subagent: first.subagent,
      recordSessionIds: new Set(files.flatMap((info) => [...info.recordSessionIds])),
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

export function describeSessions({ sessions, window, config, env, orchRoot, forkParentKeys }) {
  const excluded = { noMonoLoad: 0, audit: 0, configured: 0, noNewEvents: 0 };
  const auditIds = new Set();
  for (const session of sessions) {
    if (session.loads.some((load) => load.audit)) session.ids.forEach((id) => auditIds.add(id));
  }
  // Subagents and Codex children of an audit session are part of it.
  for (const session of sessions) {
    const parentId = session.subagent?.parentId || session.parentThread;
    if (parentId && auditIds.has(parentId)) session.ids.forEach((id) => auditIds.add(id));
  }
  const configured = new Set(config.excludedSessions || []);
  const kept = [];
  for (const session of sessions) {
    const copies = session.forkedFrom ? forkParentKeys.get(session.forkedFrom) || new Set() : new Set();
    const fresh = session.events.filter((event) => inWindow(event.ts, window) && !copies.has(event.key));
    session.newEvents = fresh;
    session.forkCopies = session.events.filter((event) => copies.has(event.key)).length;
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
      const parents = sessions.filter((other) => other !== session && session.ids.some((id) => other.outputIds.has(id.toLowerCase())));
      if (parents.length === 1) parent = { id: parents[0].id, via: "parent-output" };
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
      forkCopiesSkipped: session.forkCopies,
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
  return { sessions, forkParentKeys: parentKeys };
}

// Event keys of a fork's parent, found by id in every Codex root regardless of file time.
export function forkParentKeys(parentId, config, env, index, problems, idIndex = codexIdIndex(config, env)) {
  const keys = new Set();
  for (const entry of idIndex.get(parentId) || []) {
    const info = parseFile(entry, "codex", index, config, problems);
    info.events.forEach((event) => keys.add(event.key));
  }
  return keys;
}

export function findSession(sessions, id) {
  return sessions.find((session) => session.ids.includes(id) || session.id === id) || null;
}
