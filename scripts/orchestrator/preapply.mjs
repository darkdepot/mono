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
          const boundary = unit.children.find(next => next.start > node.start && next.type === "item" && next.column <= node.column && !/^[ \t]*[-*] `[^`]+`[ \t]*$/u.test(source(specTree, next)));
          candidates.push({ ...node, end: boundary?.start ?? unit.end });
        }
      }
      document = specTree;
    } else candidates = [];
    if (issueCandidates.length) throw new Error("Project-first preapply belongs to the covered Tech Spec unit");
  }
  if (!candidates.length) return null;
  if (candidates.length !== 1) throw new Error("multiple preapply manifest candidates");
  const candidate = candidates[0];
  if (issueOnly && (candidate.level !== 1 || source(document, candidate) !== "# Предприменение")) throw new Error("preapply requires # Предприменение");
  const blocks = [...walk(document.root)].filter(node => node.start > candidate.start && node.start < candidate.end);
  const fences = new Map(blocks.filter(node => node.type === "fence").map(node => [node.start, node]));
  const lines = document.lines;
  let cursor = candidate.start + 1;
  const skipEmpty = () => { while (cursor < candidate.end && lines[cursor] === "") cursor++; };
  skipEmpty();
  if (lines[cursor++]?.trim() !== "| path | sha256 |") throw new Error("preapply requires path/sha256 table");
  if (!/^\s*\|\s*-+\s*\|\s*-+\s*\|\s*$/u.test(lines[cursor++] ?? "")) throw new Error("preapply requires table separator");
  const entries = new Map();
  while (cursor < candidate.end && lines[cursor].trim().startsWith("|")) {
    const row = /^\s*\|\s*([^|]+?)\s*\|\s*([a-f0-9]{64})\s*\|\s*$/u.exec(lines[cursor++]);
    if (!row || entries.has(row[1])) throw new Error("invalid or duplicate preapply path/sha256 row");
    entries.set(row[1], { path: row[1], sha256: row[2] });
  }
  if (!entries.size) throw new Error("empty preapply path table");
  while (cursor < candidate.end) {
    skipEmpty(); if (cursor >= candidate.end) break;
    if (/^[ \t]+(?:`{3,}|~{3,})/u.test(lines[cursor])) throw new Error("preapply fence must start at column 0 (no indentation)");
    const item = /^[ \t]*[-*] `([^`]+)`[ \t]*$/u.exec(lines[cursor++]);
    if (!item) throw new Error("preapply fence without path or unexpected manifest block");
    const entry = entries.get(item[1]);
    if (!entry || entry.bytes !== undefined) throw new Error("preapply path missing from table or repeated");
    const fence = fences.get(cursor);
    if (/^[ \t]+(?:`{3,}|~{3,})/u.test(lines[cursor] ?? "")) throw new Error("preapply fence must start at column 0 (no indentation)");
    if (!fence?.closed || fence.end > candidate.end || !/^(?:`{3,}|~{3,})text$/u.test(lines[cursor] ?? "")) throw new Error("preapply path without closed text fence");
    if (!/^(?:`{3,}|~{3,})[ \t]*$/u.test(lines[fence.end - 1])) throw new Error("preapply closing fence must start at column 0 (no indentation)");
    entry.bytes = lines.slice(cursor + 1, fence.end - 1).join("\n") + "\n";
    if (hash(entry.bytes) !== entry.sha256) throw new Error(`preapply sha256 mismatch: ${entry.path}`);
    cursor = fence.end;
  }
  for (const entry of entries.values()) if (entry.bytes === undefined) throw new Error(`preapply path without fence: ${entry.path}`);
  const content = lines.slice(candidate.start + 1, candidate.end).join("\n");
  const materialized = "# Предприменение\n" + content + (content.endsWith("\n") ? "" : "\n");
  return { entries: [...entries.values()], materialized };
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
  if (identical) {
    for (const sha of git("log", "--format=%H", "--fixed-strings", `--grep=${title}`).trim().split("\n").filter(Boolean)) {
      if (git("log", "-1", "--format=%s", sha).trim() !== title) continue;
      const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).trim().split("\n").sort();
      if (!files.length || files.some(file => !names.has(file))) continue;
      if (manifest.entries.every(entry => hash(execFileSync("git", ["show", `${sha}:${entry.path}`], { cwd: worktree })) === entry.sha256)) return { commit: sha, created: false, files: manifest.entries.map(({ path, sha256 }) => ({ path, sha256 })) };
    }
    throw new Error("preapply identical bytes have no matching orchestrator commit");
  }
  for (const entry of manifest.entries) { const file = path.join(worktree, entry.path); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, entry.bytes, "utf8"); }
  git("add", "--", ...manifest.entries.map(entry => entry.path));
  git("commit", "-m", title);
  return { commit: git("rev-parse", "HEAD").trim(), created: true, files: manifest.entries.map(({ path, sha256 }) => ({ path, sha256 })) };
}
