#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Validator ceiling for the union, in bytes. Tokens are only bytes / 4.
export const READ_BUDGET_MAX_BYTES = 99_882;
export const DELIVERY_SKILLS = ["mono-deliver", "mono-implement", "mono-preflight", "mono-ship"];

function withoutFences(text) {
  let fence = null;
  return text.split(/\r?\n/).map((line) => {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line);
    if (delimiter) {
      if (!fence) fence = delimiter[1][0];
      else if (fence === delimiter[1][0]) fence = null;
      return "";
    }
    return fence ? "" : line;
  }).join("\n");
}

function namedPaths(text, list = false) {
  // Reading prose may name a path in backticks, a link, or plain text.
  return [...text.matchAll(/(?<![A-Za-z0-9_<:/.-])((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.md)(?![A-Za-z0-9_-]|\.[A-Za-z0-9])/g)]
    .filter((match) => list || match[1].includes("/") || match[1] === "AGENTS.md" || /(?:read|load|consult|follow|use|apply)\s+[`(]?$/i.test(text.slice(0, match.index)))
    .map((match) => match[1]);
}

// Reading tiers are a union. Inline reading instructions are also edges;
// conditions are never evaluated. Non-reading mentions and code examples
// (output paths, sample artifacts) are not reading instructions.
export function readingPaths(text) {
  const source = withoutFences(text);
  const result = new Set();
  let readingList = false, started = false;
  for (const line of source.split("\n")) {
    if (/^(?:#{1,6}\s+)?Read (?:first|now|when)\b/.test(line)) {
      readingList = true; started = false;
      for (const file of namedPaths(line, true)) result.add(file);
      continue;
    }
    if (!readingList || !line.trim()) continue;
    if (/^\s*(?:[-*+] |\d+[.)] )/.test(line) || (started && /^\s+/.test(line))) {
      started = true;
      for (const file of namedPaths(line, true)) result.add(file);
    } else readingList = false;
  }
  for (const paragraph of source.split(/(?<=[.!?])\s+|\n\s*\n|\n(?=\s*(?:[-*+] |\d+[.)] |\|))/)) {
    if (/\b(?:read|re-read|load|consult|follow|use|apply|render|recover|resolve)\b/i.test(paragraph.replace(/`[^`]*`/g, ""))) {
      for (const file of namedPaths(paragraph)) result.add(file);
    }
    // Role links always resolve a policy input, including inside tables.
    for (const match of paragraph.matchAll(/\[role:[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/g)) result.add(match[1]);
  }
  return [...result];
}

export function measureReadBudget(root) {
  root = fs.realpathSync(root);
  const installed = !fs.existsSync(path.join(root, "skills/mono-implement/SKILL.md"));
  const fileFor = (name) => path.join(root, installed
    ? name.startsWith("skills/") ? name.slice(7) : `mono-implement/${name}`
    : name);
  const normalize = (reference, from) => {
    if (/^mono-[^/]+\/SKILL\.md$/.test(reference)) reference = `skills/${reference}`;
    if (/^(?:https?:|\/)/.test(reference) || /[<>*]/.test(reference)) return null;
    const names = /^(?:AGENTS\.md|skills\/|references\/|templates\/|docs\/|plans\/|examples\/)/.test(reference)
      ? [reference] : [path.posix.normalize(path.posix.join(path.posix.dirname(from), reference))];
    for (const name of names.map((value) => path.posix.normalize(value))) {
      if (name.startsWith("../")) continue;
      const absolute = fileFor(name);
      if (!fs.existsSync(absolute)) throw new Error(`${from}: missing reading input ${reference} (${name})`);
      const actual = fs.realpathSync(absolute);
      if (actual !== root && !actual.startsWith(root + path.sep)) throw new Error(`${from}: reading input escapes root: ${reference}`);
      const canonical = path.relative(root, actual).split(path.sep).join("/");
      if (!installed) return canonical;
      if (canonical.endsWith("/SKILL.md")) return `skills/${canonical}`;
      return canonical.replace(/^mono-implement\//, "");
    }
    throw new Error(`${from}: reading input escapes corpus: ${reference}`);
  };
  const entries = new Map();
  const queue = DELIVERY_SKILLS.map((skill) => [`skills/${skill}/SKILL.md`, "delivery root"]);
  for (let index = 0; index < queue.length; index++) {
    const [name, from] = queue[index];
    if (entries.has(name)) { entries.get(name).read_by.add(from); continue; }
    const data = fs.readFileSync(fileFor(name));
    entries.set(name, { path: name, bytes: data.length, read_by: new Set([from]) });
    for (const ref of readingPaths(data.toString("utf8"))) {
      const next = normalize(ref, name);
      if (next) queue.push([next, name]);
    }
  }
  const files = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => ({ ...entry, approximate_tokens: entry.bytes / 4, read_by: [...entry.read_by].sort() }));
  const bytes = files.reduce((total, entry) => total + entry.bytes, 0);
  return { files, bytes, approximate_tokens: bytes / 4, ceiling_bytes: READ_BUDGET_MAX_BYTES, within_ceiling: bytes <= READ_BUDGET_MAX_BYTES };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(self)) {
  try {
    let root = path.resolve(path.dirname(self), "..");
    if (path.basename(root) === ".mono-agent-workflow") root = path.dirname(root);
    let json = false;
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === "--root" && process.argv[i + 1]) root = path.resolve(process.argv[++i]);
      else if (arg === "--json") json = true;
      else if (arg === "--help" || arg === "-h") {
        console.log("Usage: node scripts/read-budget.mjs [--root <checkout-or-installed-skills-root>] [--json]");
        process.exit(0);
      } else throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    const result = measureReadBudget(root);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const entry of result.files) console.log(`${entry.bytes}\t${entry.approximate_tokens}\t${entry.path}`);
      console.log(`Read budget: ${result.bytes} bytes / ~${result.approximate_tokens} tokens; ${result.files.length} files; ceiling ${result.ceiling_bytes} bytes; ${result.within_ceiling ? "PASS" : "FAIL"}`);
    }
    process.exitCode = result.within_ceiling ? 0 : 1;
  } catch (error) {
    console.error(`Read budget: ${error.message}`);
    process.exitCode = 1;
  }
}
