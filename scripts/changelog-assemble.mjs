#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateLanding, resolvedLocation, syncDir } from "./runtime.mjs";

function argumentsFor(argv) {
  const args = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--check" && !args.check) args.check = true;
    else if (["--worktree", "--config"].includes(flag) && !args[flag.slice(2)] && argv[i + 1] && !argv[i + 1].startsWith("--")) args[flag.slice(2)] = argv[++i];
    else throw new Error(`invalid argument: ${flag}`);
  }
  if (!args.worktree || !args.config) throw new Error("Usage: changelog-assemble.mjs --worktree DIR --config FILE [--check]");
  return args;
}

function inside(worktree, relative) {
  const file = path.resolve(worktree, relative);
  const real = resolvedLocation(file);
  if (!real.startsWith(worktree + path.sep)) throw new Error(`path outside worktree: ${relative}`);
  return file;
}

function regularBytes(file) {
  if (!fs.lstatSync(file).isFile()) throw new Error(`not a regular file: ${file}`);
  return fs.readFileSync(file);
}

function replaceAtomic(target, bytes) {
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, "wx", fs.statSync(target).mode & 0o777);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, target);
    syncDir(path.dirname(target));
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function assemble(args) {
  const config = JSON.parse(fs.readFileSync(path.resolve(args.config), "utf8"));
  const policy = validateLanding(config)?.changelog;
  if (!policy) { console.log("changelog: not configured"); return; }
  const worktree = fs.realpathSync(path.resolve(args.worktree));
  const target = inside(worktree, policy.target), dir = inside(worktree, policy.fragmentDir);
  const realTarget = resolvedLocation(target), realDir = resolvedLocation(dir);
  if (realTarget.startsWith(realDir + path.sep) || realTarget === realDir) throw new Error("changelog target must be outside fragmentDir");
  const decode = bytes => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const original = regularBytes(target), text = decode(original);
  const escaped = policy.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^${escaped}(\\r?\\n|$)`, "m").exec(text);
  if (!heading) throw new Error(`missing heading: ${policy.heading}`);
  const markers = new Map();
  for (const match of text.matchAll(/^<!-- fragment: ([A-Z][A-Z0-9]*-\d+) sha256:([a-f0-9]{64}) -->\r?$/gm)) {
    const hashes = markers.get(match[1]) ?? new Set(); hashes.add(match[2]); markers.set(match[1], hashes);
  }
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith(".md")) : [];
  const fragments = names.map(name => {
    const key = name.slice(0, -3), match = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(key);
    if (!match) throw new Error(`invalid fragment key: ${name}`);
    const file = inside(worktree, path.join(policy.fragmentDir, name)), bytes = regularBytes(file), body = decode(bytes);
    if (!body.trim()) throw new Error(`empty fragment: ${key}`);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex"), known = markers.get(key);
    if (known && (known.size !== 1 || !known.has(digest))) throw new Error(`fragment digest mismatch: ${key}`);
    return { key, prefix: match[1], number: BigInt(match[2]), file, body, digest, collected: !!known };
  }).sort((a, b) => a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : a.number < b.number ? -1 : a.number > b.number ? 1 : a.key.localeCompare(b.key));
  const newline = heading[1] || "\n";
  const additions = fragments.filter(f => !f.collected).map(f =>
    `<!-- fragment: ${f.key} sha256:${f.digest} -->${newline}${f.body}${f.body.endsWith("\n") ? "" : newline}`).join(newline);
  const offset = heading.index + heading[0].length;
  const result = additions ? text.slice(0, offset) + (heading[1] ? "" : newline) + newline + additions + text.slice(offset) : text;
  if (args.check) { process.stdout.write(result); return; }
  if (additions) replaceAtomic(target, Buffer.from(result));
  for (const fragment of fragments) fs.unlinkSync(fragment.file);
  if (fragments.length) syncDir(dir);
  console.log(`changelog: assembled ${fragments.filter(f => !f.collected).length}; removed ${fragments.length}`);
}

try { assemble(argumentsFor(process.argv.slice(2))); }
catch (error) { console.error(`changelog: ${error.message}`); process.exitCode = 1; }
