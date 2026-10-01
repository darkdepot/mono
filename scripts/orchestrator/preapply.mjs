import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseDocument, extractSnapshot } from "./snapshot.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function* walk(node) { yield node; for (const child of node.children ?? []) yield* walk(child); }
const source = (document, node) => document.lines[node.start];
const marker = (document, node) => node.type === "item" && /^[ \t]*[-*] Предприменение:[ \t]*$/u.test(source(document, node));

// Locate only source-backed blocks. Fence contents never become candidates.
export function preapplyManifest(issue, prd, spec, issueOnly) {
  const issueTree = parseDocument(issue);
  const issueCandidates = [...walk(issueTree.root)].filter(node => node.type === "heading" && node.title === "Предприменение");
  let document = issueTree, candidates = issueCandidates;
  if (!issueOnly) {
    const specTree = parseDocument(spec);
    const markers = [...walk(specTree.root)].filter(node => marker(specTree, node));
    if (markers.length) {
      const selected = new Set(extractSnapshot(issue, prd, spec).ids);
      candidates = [];
      for (const unit of [...walk(specTree.root)].filter(node => node.type === "list" && /^U\d/u.test(node.id ?? "") && selected.has(node.id))) {
        for (const node of unit.children.filter(node => marker(specTree, node))) {
          if (node.column <= unit.column) throw new Error("preapply must be nested inside its implementation unit");
          const boundary = unit.children.find(next => next.start > node.start && next.type === "item" && next.column <= node.column && !/^[ \t]*[-*] `/u.test(source(specTree, next)));
          candidates.push({ ...node, end: boundary?.start ?? unit.end });
        }
      }
      document = specTree;
    } else candidates = [];
  }
  if (!candidates.length) {
    if (issueCandidates.length) throw new Error("Project-first preapply belongs to the covered Tech Spec unit");
    return null;
  }
  if (candidates.length !== 1) throw new Error("multiple preapply manifest candidates");
  const candidate = candidates[0];
  if (issueOnly && (candidate.level !== 1 || source(document, candidate) !== "# Предприменение")) throw new Error("preapply requires # Предприменение");
  const blocks = [...walk(document.root)].filter(node => node.start > candidate.start && node.start < candidate.end);
  const fences = new Map(blocks.filter(node => node.type === "fence").map(node => [node.start, node]));
  const lines = document.lines;
  let cursor = candidate.start + 1;
  const skipEmpty = () => { while (cursor < candidate.end && /^[ \t]*$/u.test(lines[cursor])) cursor++; };
  const entries = new Map();
  while (cursor < candidate.end) {
    skipEmpty(); if (cursor >= candidate.end) break;
    if (/^[ \t]+(?:`{3,}|~{3,})/u.test(lines[cursor])) throw new Error("preapply fence must start at column 0 (no indentation)");
    const line = lines[cursor++];
    const item = /^[ \t]*[-*] `([^`]+)` sha256 `([a-f0-9]{64})`[ \t]*$/u.exec(line);
    if (!item) throw new Error("invalid preapply path/sha256 item or fence without path");
    if (entries.has(item[1])) throw new Error("invalid or duplicate preapply path/sha256 item");
    const entry = { path: item[1], sha256: item[2] };
    entries.set(entry.path, entry);
    skipEmpty();
    const fence = fences.get(cursor);
    if (/^[ \t]+(?:`{3,}|~{3,})/u.test(lines[cursor] ?? "")) throw new Error("preapply fence must start at column 0 (no indentation)");
    if (!fence?.closed || fence.end > candidate.end || !/^(?:`{3,}|~{3,})text$/u.test(lines[cursor] ?? "")) throw new Error("preapply path without closed text fence");
    if (!/^(?:`{3,}|~{3,})[ \t]*$/u.test(lines[fence.end - 1])) throw new Error("preapply closing fence must start at column 0 (no indentation)");
    entry.bytes = lines.slice(cursor + 1, fence.end - 1).join("\n") + "\n";
    if (hash(entry.bytes) !== entry.sha256) throw new Error(`preapply sha256 mismatch: ${entry.path}`);
    cursor = fence.end;
  }
  if (!entries.size) throw new Error("empty preapply path list");
  const content = lines.slice(candidate.start + 1, candidate.end).join("\n");
  const materialized = "# Предприменение\n" + content + (content.endsWith("\n") ? "" : "\n");
  const alreadyMaterialized = !issueOnly && issueCandidates.length > 0;
  if (alreadyMaterialized && preapplyManifest(issue, null, null, true).materialized !== materialized) throw new Error("materialized preapply differs from the covered Tech Spec manifest");
  return { entries: [...entries.values()], materialized, alreadyMaterialized };
}

export function preapplyMandate(config) {
  const preapply = config.orchestration?.preapply;
  if (preapply === undefined) return null;
  if (!preapply || typeof preapply !== "object" || Array.isArray(preapply) || (preapply.mandate !== undefined && typeof preapply.mandate !== "string")) throw new Error("orchestration.preapply.mandate must be a URL string");
  const mandate = preapply.mandate?.trim();
  if (!mandate) return null;
  let url;
  try { url = new URL(mandate); } catch { throw new Error("orchestration.preapply.mandate must be a comment URL"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || /\s/u.test(mandate)) throw new Error("orchestration.preapply.mandate must be a comment URL");
  return mandate;
}

export function applyPreapply(worktree, issue, manifest) {
  const git = (...args) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: worktree, encoding: "utf8" });
  if (git("status", "--porcelain", "--untracked-files=all").trim()) throw new Error("preapply working tree is dirty");
  const names = new Set(manifest.entries.map(entry => entry.path));
  for (const entry of manifest.entries) {
    const parts = entry.path.split("/");
    if (parts[0] !== ".agents" || parts.length < 2 || parts.some(part => !part || part === "." || part === "..") || /[\\\x00-\x1f\x7f]/u.test(entry.path)) throw new Error(`invalid preapply path: ${entry.path}`);
    if (parts.slice(1).some((_, index) => names.has(parts.slice(0, index + 1).join("/")))) throw new Error(`preapply file used as a parent: ${entry.path}`);
    let current = worktree;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== "ENOENT") throw error; continue; }
      if (stat.isSymbolicLink()) throw new Error(`preapply symbolic link: ${entry.path}`);
      if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) throw new Error(`preapply path is not a regular file: ${entry.path}`);
    }
  }
  const title = `${issue}: pre-applied .agents changes (orchestrator)`;
  const identical = manifest.entries.every(entry => fs.existsSync(path.join(worktree, entry.path)) && hash(fs.readFileSync(path.join(worktree, entry.path))) === entry.sha256);
  const headMatches = identical && manifest.entries.every(entry => {
    try { return hash(execFileSync("git", ["show", `HEAD:${entry.path}`], { cwd: worktree, stdio: ["ignore", "pipe", "pipe"] })) === entry.sha256; }
    catch (error) { if (error.status !== 128) throw error; return false; }
  });
  if (headMatches) {
    for (const sha of git("log", "--format=%H", "--fixed-strings", `--grep=${title}`).trim().split("\n").filter(Boolean)) {
      if (git("log", "-1", "--format=%s", sha).trim() !== title) continue;
      const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "-z", sha).split("\0").filter(Boolean).sort();
      if (!files.length || files.some(file => !names.has(file))) continue;
      if (manifest.entries.every(entry => hash(execFileSync("git", ["show", `${sha}:${entry.path}`], { cwd: worktree })) === entry.sha256)) return { commit: sha, created: false, files: manifest.entries.map(({ path, sha256 }) => ({ path, sha256 })) };
    }
    throw new Error("preapply identical bytes have no matching orchestrator commit");
  }
  const originals = manifest.entries.map(entry => ({ ...entry,
    original: fs.existsSync(path.join(worktree, entry.path)) ? fs.readFileSync(path.join(worktree, entry.path)) : null,
    mode: fs.existsSync(path.join(worktree, entry.path)) ? fs.statSync(path.join(worktree, entry.path)).mode & 0o777 : null }));
  const createdDirectories = new Set();
  const restoreFiles = () => {
    for (const entry of originals) {
      const file = path.join(worktree, entry.path);
      if (entry.original === null) fs.rmSync(file, { force: true });
      else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, entry.original); fs.chmodSync(file, entry.mode); }
    }
    for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) if (fs.existsSync(directory)) fs.rmdirSync(directory);
  };
  try {
    for (const entry of originals) {
      const file = path.join(worktree, entry.path);
      let directory = path.dirname(file);
      while (directory !== worktree && !fs.existsSync(directory)) { createdDirectories.add(directory); directory = path.dirname(directory); }
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, entry.bytes, "utf8");
    }
    git("--literal-pathspecs", "add", "--force", "--", ...names);
    for (const entry of originals) {
      const blob = execFileSync("git", ["show", `:${entry.path}`], { cwd: worktree });
      if (hash(blob) !== entry.sha256) throw new Error(`preapply staged blob sha256 mismatch: ${entry.path}`);
    }
    git("commit", "-m", title);
  } catch (error) {
    git("--literal-pathspecs", "reset", "--", ...names);
    restoreFiles();
    throw error;
  }
  return { commit: git("rev-parse", "HEAD").trim(), created: true, restoreFiles, files: manifest.entries.map(({ path, sha256 }) => ({ path, sha256 })) };
}
