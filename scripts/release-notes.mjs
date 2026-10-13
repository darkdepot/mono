#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function extractReleaseNotes(changelog, version) {
  if (!versionPattern.test(version)) throw new Error(`invalid release version: ${version}`);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(line => line === `## [${version}]` || line.startsWith(`## [${version}] - `));
  if (start < 0) throw new Error(`missing changelog section: ${version}`);
  const next = lines.findIndex((line, index) => index > start && /^## \[[^\]]+\]/.test(line));
  const body = lines.slice(start + 1, next < 0 ? undefined : next)
    .filter(line => !/^\[\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\]:\s/.test(line));
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body.at(-1).trim()) body.pop();
  if (!body.length) throw new Error(`empty changelog section: ${version}`);
  return body.join("\n") + "\n";
}

export function releaseNotes(repo, tag) {
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const ref = `refs/tags/${tag}`;
  let commit;
  try {
    git("check-ref-format", ref);
    commit = git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();
  } catch {
    throw new Error(`not an existing version tag: ${tag}`);
  }
  const read = file => {
    try { return git("show", `${commit}:${file}`); }
    catch { throw new Error(`missing release file: ${file}`); }
  };
  const version = read("VERSION").trim();
  if (!versionPattern.test(version)) throw new Error(`invalid release version: ${version}`);
  if (tag !== `v${version}`) throw new Error(`tag/version mismatch: ${tag} vs ${version}`);
  for (const file of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    if (JSON.parse(read(file)).version !== version) throw new Error(`${file} version mismatch`);
  }
  return extractReleaseNotes(read("CHANGELOG.md"), version);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = { repo: process.cwd() };
    for (let i = 2; i < process.argv.length; i++) {
      const flag = process.argv[i];
      if (!["--repo", "--tag"].includes(flag) || !process.argv[i + 1]) throw new Error("Usage: release-notes.mjs [--repo DIR] --tag TAG");
      args[flag.slice(2)] = process.argv[++i];
    }
    if (!args.tag) throw new Error("Usage: release-notes.mjs [--repo DIR] --tag TAG");
    process.stdout.write(releaseNotes(args.repo, args.tag));
  } catch (error) {
    console.error(`release-notes: ${error.message}`);
    process.exitCode = 1;
  }
}
