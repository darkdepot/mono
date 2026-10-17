#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packLayout, runtimePackRoot } from './runtime.mjs';
import { resolveSkillPath } from './validate-plugin.mjs';

// Validator ceiling for the union, in bytes. Tokens are only bytes / 4.
export const READ_BUDGET_MAX_BYTES = 99_882;
export const DELIVERY_SKILLS = ["deliver", "implement", "preflight", "ship"];

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
  return [...text.matchAll(/(?<![A-Za-z0-9_<:/.-])((?:<корень>\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.md)(?![A-Za-z0-9_-]|\.[A-Za-z0-9])/g)]
    .filter((match) => list || match[1].includes("/") || match[1] === "AGENTS.md" || /(?:read|load|consult|follow|use|apply)\s+[`(]?$/i.test(text.slice(0, match.index)))
    .map((match) => match[1]);
}

// Reading tiers are a union. Inline reading instructions are also edges;
// conditions are never evaluated. Non-reading mentions and code examples
// (output paths, sample artifacts) are not reading instructions.
export function readingPaths(text, { includeConditional = true } = {}) {
  const source = withoutFences(text);
  const result = new Set();
  let tier = null, started = false;
  const paragraphs = [];
  for (const line of source.split("\n")) {
    const label = /^(?:#{1,6}\s+)?(Read (?:first|now|when)\b|Прочитай сразу|Прочитай, когда)/.exec(line);
    if (label) {
      tier = /^(?:Read when|Прочитай, когда)$/.test(label[1]) ? 'conditional' : 'mandatory';
      started = false;
      if (includeConditional || tier === 'mandatory') for (const file of namedPaths(line, true)) result.add(file);
      continue;
    }
    if (!line.trim()) { paragraphs.push(line); continue; }
    if (tier && (/^\s*(?:[-*+] |\d+[.)] )/.test(line) || (started && /^\s+/.test(line)))) {
      started = true;
      if (includeConditional || tier === 'mandatory') for (const file of namedPaths(line, true)) result.add(file);
      continue;
    }
    tier = null; started = false;
    paragraphs.push(line);
  }
  for (const paragraph of paragraphs.join("\n").split(/(?<=[.!?])\s+|\n\s*\n|\n(?=\s*(?:[-*+] |\d+[.)] |\|))/)) {
    if (/\b(?:read|re-read|load|consult|follow|use|apply|render|recover|resolve)\b/i.test(paragraph.replace(/`[^`]*`/g, ""))) {
      for (const file of namedPaths(paragraph)) result.add(file);
    }
    // Role links always resolve a policy input, including inside tables.
    for (const match of paragraph.matchAll(/\[role:[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/g)) result.add(match[1]);
  }
  return [...result];
}

export function measureReadBudget(root, { skills = DELIVERY_SKILLS, includeConditional = true } = {}) {
  root = fs.realpathSync(root);
  const layout = packLayout(root);
  const fileFor = name => layout.file(name);
  const normalize = (reference, from) => {
    if (/^mono-[^/]+\/SKILL\.md$/.test(reference)) reference = `skills/${reference}`;
    if (reference.startsWith('<корень>/') || (/^skills\/[^/]+\//.test(from) && reference.startsWith('references/')))
      reference = path.relative(root, resolveSkillPath(root, from, reference)).split(path.sep).join('/');
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
      return canonical;
    }
    throw new Error(`${from}: reading input escapes corpus: ${reference}`);
  };
  const entries = new Map();
  const queue = skills.map((skill) => [`skills/${skill}/SKILL.md`, "stage root"]);
  for (let index = 0; index < queue.length; index++) {
    const [name, from] = queue[index];
    if (entries.has(name)) { entries.get(name).read_by.add(from); continue; }
    const data = fs.readFileSync(fileFor(name));
    entries.set(name, { path: name, bytes: data.length, read_by: new Set([from]) });
    for (const ref of readingPaths(data.toString("utf8"), { includeConditional })) {
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
    let root = runtimePackRoot();
    let json = false;
    let skills = DELIVERY_SKILLS, includeConditional = true;
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === "--root" && process.argv[i + 1]) root = path.resolve(process.argv[++i]);
      else if (arg === "--json") json = true;
      else if (arg === "--skill" && /^[a-z][a-z-]*$/.test(process.argv[i + 1] ?? "")) skills = [process.argv[++i]];
      else if (arg === "--mandatory") includeConditional = false;
      else if (arg === "--help" || arg === "-h") {
        console.log("Usage: node scripts/read-budget.mjs [--root <pack-root>] [--skill <name>] [--mandatory] [--json]");
        process.exit(0);
      } else throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    const result = measureReadBudget(root, { skills, includeConditional });
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
