#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const UPSTREAM_REPO = "darkdepot/mono";
const LOCKFILE_NAME = ".mono-agent-workflow.lock.json";
const LEGACY_LOCKFILE_NAME = ".linear-agent-workflow.lock.json";
const GENERATED_MARKER = "Installed by Mono Agent Workflow";
const LEGACY_GENERATED_MARKER = "Installed from darkdepot/linear-agent-workflow";
const SURFACE_REVISION = 3;

// Pack-private shared directory at the skills root (a sibling of LOCKFILE_NAME).
// It holds workflow runtime scripts the installed skills invoke at delivery time
// — including the issue-only resolver and orchestration heartbeat watcher. It is
// hidden (leading dot) so it is never mistaken for an installed `mono-*` skill
// directory by discovery or stale-cleanup, which scan for `mono-` prefixes.
const RUNTIME_DIR = ".mono-agent-workflow";
const LEGACY_RUNTIME_DIR = ".linear-agent-workflow";
const RUNTIME_SCRIPTS_SUBDIR = "scripts";
const INSTALL_LOCK_NAME = "install.lock";
const INSTALL_LOCK_PROTOCOL_FILE = "protocol.json";
const INSTALL_LOCK_PROTOCOL = "token-claims-v1";
const INSTALL_LOCK_TOKEN_PATTERN = /^[A-Za-z0-9-]{1,128}$/;
// Upstream scripts/ files published into
// <skills-root>/.mono-agent-workflow/scripts/. They import only Node built-ins,
// so there are no sibling-script dependencies; add future runtime dependencies
// here so the whole executable pack contract is installed together.
const RUNTIME_SCRIPTS = [
  "resolve-issue-context.mjs",
  "verify-pack-state.mjs",
  "watch-workers.mjs",
];

function usage() {
  console.error(
    "Usage: node scripts/install-local.mjs [--all-roots | --skills-root /path/to/skills] [--check | --breaking] [--remove-stale]"
  );
  console.error("");
  console.error(`Default mode is --all-roots: discover every installed skills root (a directory holding ${LOCKFILE_NAME})`);
  console.error("among the known roots (~/.codex/skills, ~/.claude/skills, roots recorded in discovered lockfiles,");
  console.error("or the MONO_WORKFLOW_KNOWN_ROOTS override) and sync/check each of them in one run.");
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    check: false,
    breaking: false,
    removeStale: false,
    allRoots: false,
    skillsRoot: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skills-root") {
      args.skillsRoot = argv[++index] || "";
      if (!args.skillsRoot) usage();
    } else if (arg === "--all-roots") {
      args.allRoots = true;
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--breaking") {
      args.breaking = true;
    } else if (arg === "--remove-stale") {
      args.removeStale = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }

  if (args.allRoots && args.skillsRoot) {
    console.error("--all-roots cannot be combined with --skills-root; pass one root selection mode.");
    process.exit(2);
  }
  if (args.check && args.removeStale) {
    console.error("--remove-stale has no effect in --check mode; run without --check to sync and remove stale skills.");
    process.exit(2);
  }
  if (args.breaking && args.check) {
    console.error("--breaking cannot be combined with --check; breaking mode performs its own post-check.");
    process.exit(2);
  }
  if (args.skillsRoot) {
    args.skillsRoot = path.resolve(args.skillsRoot);
  } else {
    args.allRoots = true;
  }
  return args;
}

function knownRootCandidates() {
  const envValue =
    process.env.MONO_WORKFLOW_KNOWN_ROOTS ??
    process.env.LINEAR_WORKFLOW_KNOWN_ROOTS;
  if (envValue !== undefined) {
    return envValue
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry) => path.resolve(entry));
  }
  return [
    path.join(os.homedir(), ".codex", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
  ];
}

function discoverInstalledRoots(candidates) {
  const queue = [...candidates];
  const seen = new Set();
  const installed = [];

  while (queue.length > 0) {
    const candidate = path.resolve(queue.shift());
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const lockPath = [LOCKFILE_NAME, LEGACY_LOCKFILE_NAME]
      .map((name) => path.join(candidate, name))
      .find((candidatePath) => fs.existsSync(candidatePath));
    if (!lockPath) continue;
    installed.push(candidate);
    const lock = readLock(lockPath);
    if (typeof lock?.skillsRoot === "string" && lock.skillsRoot) {
      queue.push(lock.skillsRoot);
    }
  }

  return installed;
}

function installedRootVersion(skillsRoot) {
  const lock =
    readLock(path.join(skillsRoot, LOCKFILE_NAME)) ??
    readLock(path.join(skillsRoot, LEGACY_LOCKFILE_NAME));
  return lock?.packVersion || lock?.upstreamVersion || "unknown";
}

function resolveTargetRoots(args) {
  if (!args.allRoots) return [args.skillsRoot];

  const candidates = knownRootCandidates();
  const installed = discoverInstalledRoots(candidates);

  if (installed.length > 0) {
    console.log(`Discovered ${installed.length} installed skills root(s):`);
    for (const skillsRoot of installed) {
      console.log(`- ${skillsRoot} (version ${installedRootVersion(skillsRoot)})`);
    }
    return installed;
  }

  if (args.check) {
    console.error(`No installed skills roots found (checked: ${candidates.join(", ") || "none"}).`);
    console.error("Run node scripts/install-local.mjs first, or pass --skills-root.");
    process.exit(1);
  }

  if (candidates.length === 0) {
    console.error("No known skills roots to install into; pass --skills-root.");
    process.exit(2);
  }
  console.log(`No installed skills roots found; installing into default root ${candidates[0]}`);
  return [candidates[0]];
}

function command(cwd, commandName, args) {
  try {
    return execFileSync(commandName, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`${commandName} ${args.join(" ")} failed in ${cwd}: ${detail}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readVersion(root) {
  const versionPath = path.join(root, "VERSION");
  if (!fs.existsSync(versionPath)) return "";
  return fs.readFileSync(versionPath, "utf8").trim();
}

function listSourceSkills(root) {
  return fs
    .readdirSync(path.join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mono-"))
    .map((entry) => entry.name)
    .sort();
}

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        files.push(path.relative(rootDir, entryPath));
      }
    }
  }
  walk(rootDir);
  return files.sort();
}

function directoryManifest(rootDir) {
  return listFilesRecursive(rootDir).map((relativePath) => ({
    path: relativePath,
    sha256: sha256(fs.readFileSync(path.join(rootDir, relativePath))),
  }));
}

function copyDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function installedSkillBody(sourceText, commit, dirty) {
  const marker = dirty ? `${commit} dirty` : commit;
  const metadata = `<!-- ${GENERATED_MARKER} @ ${marker}. Do not edit manually. -->`;
  let body = sourceText.replace(/`skills\/(mono-[^`]+\/SKILL\.md)`/g, "`../$1`");

  const lines = body.split("\n");
  const h1Index = lines.findIndex((line) => line.startsWith("# "));
  if (h1Index >= 0) {
    lines.splice(
      h1Index + 1,
      0,
      "",
      "Installed local note: read the active project's `.agents/mono-workflow.config.json` when present for Linear team, language, artifact roots, and workflow policy. Shared `references/` and `templates/` are copied into this skill directory."
    );
    body = lines.join("\n");
  }

  const trimmedBody = body.trimEnd();
  const frontmatter = trimmedBody.match(/^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/);
  if (frontmatter) {
    return `${frontmatter[1].trimEnd()}\n\n${metadata}\n${frontmatter[2].trimStart().trimEnd()}\n`;
  }

  return `${metadata}\n${trimmedBody}\n`;
}

// The pack-private runtime scripts to publish into
// <skills-root>/.mono-agent-workflow/scripts/. `relativePath` is skills-root
// relative (the lockfile and --check key); `destPath` is the absolute install
// target; `sourcePath` is the upstream file copied verbatim.
function plannedRuntimeScripts(root, skillsRoot) {
  return RUNTIME_SCRIPTS.map((name) => {
    const sourcePath = path.join(root, "scripts", name);
    const relativePath = path.join(RUNTIME_DIR, RUNTIME_SCRIPTS_SUBDIR, name);
    return {
      name,
      sourcePath,
      destPath: path.join(skillsRoot, relativePath),
      relativePath,
      sha256: sha256(fs.readFileSync(sourcePath)),
    };
  });
}

// The lockfile shape for the runtime scripts: skills-root-relative path + hash,
// so sync() records and check() compares the same canonical structure.
function runtimeScriptsManifest(plan) {
  return plan.runtimeScripts.map((script) => ({ path: script.relativePath, sha256: script.sha256 }));
}

function plannedInstall(root, skillsRoot, commit, dirty) {
  const skills = listSourceSkills(root);
  const files = [];

  for (const skill of skills) {
    const sourcePath = path.join(root, "skills", skill, "SKILL.md");
    const skillDir = path.join(skillsRoot, skill);
    const body = installedSkillBody(fs.readFileSync(sourcePath, "utf8"), commit, dirty);
    files.push({
      name: skill,
      dir: skillDir,
      skillPath: path.join(skillDir, "SKILL.md"),
      body,
      sha256: sha256(body),
    });
  }

  return {
    skills,
    files,
    assets: {
      agents: sha256(fs.readFileSync(path.join(root, "AGENTS.md"))),
      references: directoryManifest(path.join(root, "references")),
      templates: directoryManifest(path.join(root, "templates")),
    },
    runtimeScripts: plannedRuntimeScripts(root, skillsRoot),
    lockPath: path.join(skillsRoot, LOCKFILE_NAME),
  };
}

function compareCopiedAssets(installedDir, label, expectedAssets, failures) {
  if (!fs.existsSync(installedDir)) {
    failures.push(`Missing copied ${label}`);
    return;
  }

  const installedFiles = listFilesRecursive(installedDir);
  const expectedSet = new Set(expectedAssets.map((asset) => asset.path));
  const installedSet = new Set(installedFiles);

  for (const asset of expectedAssets) {
    const installedPath = path.join(installedDir, asset.path);
    if (!installedSet.has(asset.path)) {
      failures.push(`Missing copied ${label} file: ${asset.path}`);
      continue;
    }
    if (sha256(fs.readFileSync(installedPath)) !== asset.sha256) {
      failures.push(`Copied ${label} file is stale or edited: ${asset.path}`);
    }
  }

  for (const relativePath of installedFiles) {
    if (!expectedSet.has(relativePath)) {
      failures.push(`Unexpected copied ${label} file: ${relativePath}`);
    }
  }
}

function readLock(lockPath, failures = []) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch (error) {
    failures.push(`Lockfile is corrupted: ${lockPath} (${error.message})`);
    return null;
  }
}

function isGeneratedWorkflowSkillDir(skillDir) {
  const skillPath = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillPath)) return false;
  const body = fs.readFileSync(skillPath, "utf8");
  return body.includes(GENERATED_MARKER) || body.includes(LEGACY_GENERATED_MARKER);
}

function generatedStaleWorkflowDirs(skillsRoot, expectedSkills) {
  if (!fs.existsSync(skillsRoot)) return [];
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name.startsWith("mono-") || entry.name.startsWith("linear-")) &&
        !expectedSkills.has(entry.name) &&
        isGeneratedWorkflowSkillDir(path.join(skillsRoot, entry.name))
    )
    .map((entry) => entry.name)
    .sort();
}

function removeStaleFromPreviousLock(lock, expectedSkills, skillsRoot) {
  if (!lock) return;
  for (const skill of lock.installedSkills || []) {
    if (!skill.name || expectedSkills.has(skill.name)) continue;
    const skillDir = path.join(skillsRoot, skill.name);
    if (isGeneratedWorkflowSkillDir(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
  }
}

function removeGeneratedStaleWorkflowDirs(skillsRoot, expectedSkills) {
  if (!fs.existsSync(skillsRoot)) return;
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      (!entry.name.startsWith("mono-") && !entry.name.startsWith("linear-"))
    ) {
      continue;
    }
    if (expectedSkills.has(entry.name)) continue;
    const skillDir = path.join(skillsRoot, entry.name);
    if (isGeneratedWorkflowSkillDir(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
  }
}

function sync(
  root,
  skillsRoot,
  commit,
  dirty,
  version,
  removeStale,
  { manifestSkillsRoot = skillsRoot, log = true } = {}
) {
  fs.mkdirSync(skillsRoot, { recursive: true });
  const plan = plannedInstall(root, skillsRoot, commit, dirty);
  const expectedSkills = new Set(plan.skills);
  const legacyLockPath = path.join(skillsRoot, LEGACY_LOCKFILE_NAME);
  const previousLock = readLock(plan.lockPath) ?? readLock(legacyLockPath);

  removeStaleFromPreviousLock(previousLock, expectedSkills, skillsRoot);
  if (removeStale) removeGeneratedStaleWorkflowDirs(skillsRoot, expectedSkills);

  const manifestSkills = [];
  for (const file of plan.files) {
    fs.rmSync(file.dir, { recursive: true, force: true });
    fs.mkdirSync(file.dir, { recursive: true });
    fs.writeFileSync(file.skillPath, file.body);
    fs.copyFileSync(path.join(root, "AGENTS.md"), path.join(file.dir, "AGENTS.md"));
    copyDirectory(path.join(root, "references"), path.join(file.dir, "references"));
    copyDirectory(path.join(root, "templates"), path.join(file.dir, "templates"));
    manifestSkills.push({
      name: file.name,
      path: path.relative(skillsRoot, file.skillPath),
      sha256: file.sha256,
    });
  }

  // Publish the pack-private runtime scripts into
  // <skills-root>/.mono-agent-workflow/scripts/, the
  // canonical location the installed skills invoke at delivery time. The whole
  // .mono-agent-workflow/ directory is installer-owned and fully rewritten each
  // sync, so a removed upstream script — or any file planted anywhere under it —
  // leaves no copy behind. (The lockfile sits beside this directory, not inside
  // it, so it is untouched.)
  const packDir = path.join(skillsRoot, RUNTIME_DIR);
  const runtimeDir = path.join(packDir, RUNTIME_SCRIPTS_SUBDIR);
  fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  for (const script of plan.runtimeScripts) {
    fs.copyFileSync(script.sourcePath, script.destPath);
  }

  const manifest = {
    schemaVersion: 3,
    packVersion: version,
    sourceCommit: commit,
    surfaceRevision: SURFACE_REVISION,
    upstreamRepo: UPSTREAM_REPO,
    upstreamVersion: version,
    upstreamCommit: commit,
    upstreamDirty: dirty,
    installedAt: new Date().toISOString(),
    skillsRoot: manifestSkillsRoot,
    assets: plan.assets,
    runtimeScripts: runtimeScriptsManifest(plan),
    installedSkills: manifestSkills,
  };
  fs.writeFileSync(plan.lockPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.rmSync(legacyLockPath, { force: true });
  fs.rmSync(path.join(skillsRoot, LEGACY_RUNTIME_DIR), { recursive: true, force: true });

  if (log) {
    console.log(`Installed ${manifestSkills.length} Mono workflow skills into ${skillsRoot} (version ${version || "unknown"})`);
  }
}

function check(root, skillsRoot, commit, dirty, version) {
  const failures = [];
  const plan = plannedInstall(root, skillsRoot, commit, dirty);
  const lock = readLock(plan.lockPath, failures);
  const expectedSkills = new Set(plan.skills);

  for (const staleName of generatedStaleWorkflowDirs(skillsRoot, expectedSkills)) {
    failures.push(`Unexpected generated workflow skill directory: ${staleName}`);
  }

  for (const file of plan.files) {
    if (!fs.existsSync(file.skillPath)) {
      failures.push(`Missing installed skill: ${path.relative(skillsRoot, file.skillPath)}`);
      continue;
    }
    const text = fs.readFileSync(file.skillPath, "utf8");
    if (text !== file.body) {
      failures.push(`Installed skill is stale or edited: ${path.relative(skillsRoot, file.skillPath)}`);
    }
    const agentsPath = path.join(file.dir, "AGENTS.md");
    if (!fs.existsSync(agentsPath)) {
      failures.push(`Missing copied AGENTS.md for ${file.name}`);
    } else if (sha256(fs.readFileSync(agentsPath)) !== plan.assets.agents) {
      failures.push(`Copied AGENTS.md is stale or edited for ${file.name}`);
    }
    compareCopiedAssets(path.join(file.dir, "references"), `references for ${file.name}`, plan.assets.references, failures);
    compareCopiedAssets(path.join(file.dir, "templates"), `templates for ${file.name}`, plan.assets.templates, failures);
  }

  // The pack-private runtime scripts must be installed, current, and free of
  // extras, so installed workflows find every executable at its canonical path
  // in every synced root. The extra-file scan walks the WHOLE
  // .mono-agent-workflow/ root (not just scripts/), so a file planted one level
  // up — e.g. .mono-agent-workflow/evil.mjs — is flagged too. The lockfile
  // lives beside this root, not inside it, so nothing here should exist outside
  // the expected runtime-script set.
  const packDir = path.join(skillsRoot, RUNTIME_DIR);
  const expectedRuntime = new Set(plan.runtimeScripts.map((script) => script.relativePath));
  for (const script of plan.runtimeScripts) {
    if (!fs.existsSync(script.destPath)) {
      failures.push(`Missing installed runtime script: ${script.relativePath}`);
      continue;
    }
    if (sha256(fs.readFileSync(script.destPath)) !== script.sha256) {
      failures.push(`Installed runtime script is stale or edited: ${script.relativePath}`);
    }
  }
  for (const relativePath of listFilesRecursive(packDir)) {
    const rooted = path.join(RUNTIME_DIR, relativePath);
    if (!expectedRuntime.has(rooted)) {
      failures.push(`Unexpected installed runtime script: ${rooted}`);
    }
  }

  if (!lock) {
    failures.push(`Missing lockfile: ${path.relative(skillsRoot, plan.lockPath)}`);
  } else {
    if (lock.schemaVersion !== 3) failures.push("Lockfile schemaVersion must be 3");
    if (lock.packVersion !== version) {
      failures.push(`Lockfile packVersion is ${lock.packVersion || "unknown"} but pack is ${version || "unknown"}`);
    }
    if (lock.sourceCommit !== commit) failures.push("Lockfile sourceCommit mismatch");
    if (lock.surfaceRevision !== SURFACE_REVISION) {
      failures.push(`Lockfile surfaceRevision is ${lock.surfaceRevision ?? "missing"} but pack is ${SURFACE_REVISION}`);
    }
    if (lock.upstreamVersion !== version) {
      failures.push(`Lockfile upstreamVersion is ${lock.upstreamVersion || "unknown"} but upstream is ${version || "unknown"}`);
    }
    if (lock.upstreamRepo !== UPSTREAM_REPO) failures.push("Lockfile upstreamRepo mismatch");
    if (lock.upstreamCommit !== commit) failures.push("Lockfile upstreamCommit mismatch");
    if (lock.upstreamDirty !== dirty) failures.push("Lockfile upstreamDirty mismatch");
    if (JSON.stringify(lock.assets || {}) !== JSON.stringify(plan.assets)) {
      failures.push("Lockfile copied asset hashes mismatch");
    }
    if (JSON.stringify(lock.runtimeScripts || []) !== JSON.stringify(runtimeScriptsManifest(plan))) {
      failures.push("Lockfile runtime script hashes mismatch");
    }
    const lockEntries = Array.isArray(lock.installedSkills) ? lock.installedSkills : [];
    if (!Array.isArray(lock.installedSkills)) {
      failures.push("Lockfile installedSkills must be an array");
    }
    const seenLockSkills = new Set();
    for (const locked of lockEntries) {
      if (!locked || typeof locked !== "object" || typeof locked.name !== "string") {
        failures.push("Lockfile has malformed installed skill entry");
        continue;
      }
      if (seenLockSkills.has(locked.name)) {
        failures.push(`Lockfile has duplicate skill entry: ${locked.name}`);
      }
      seenLockSkills.add(locked.name);
      if (!expectedSkills.has(locked.name)) {
        failures.push(`Lockfile has unexpected skill entry: ${locked.name}`);
      }
    }
    const lockedSkills = new Map(
      lockEntries
        .filter((skill) => skill && typeof skill === "object" && typeof skill.name === "string")
        .map((skill) => [skill.name, skill])
    );
    for (const file of plan.files) {
      const locked = lockedSkills.get(file.name);
      if (!locked) {
        failures.push(`Lockfile missing skill: ${file.name}`);
        continue;
      }
      if (locked.path !== path.relative(skillsRoot, file.skillPath)) {
        failures.push(`Lockfile path mismatch for ${file.name}`);
      }
      if (locked.sha256 !== file.sha256) {
        failures.push(`Lockfile sha256 mismatch for ${file.name}`);
      }
    }
  }

  return failures;
}

function workflowStateRoot() {
  return path.resolve(
    process.env.MONO_WORKFLOW_STATE_ROOT || path.join(os.homedir(), ".mono-agent-workflow")
  );
}

function assertBreakingPlatformSupported() {
  if (process.platform === "win32" || process.env.MONO_WORKFLOW_TEST_FORCE_WINDOWS === "1") {
    throw new Error(
      "--breaking is not supported on Windows: the orchestrator-tree exclusion requires POSIX directory rename and permission semantics; no install state was changed"
    );
  }
}

function pathExists(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readInstallLockEntry(entryPath) {
  try {
    const entry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
    if (
      !entry ||
      typeof entry !== "object" ||
      !Number.isInteger(entry.pid) ||
      typeof entry.token !== "string" ||
      !INSTALL_LOCK_TOKEN_PATTERN.test(entry.token)
    ) {
      throw new Error("expected pid and token");
    }
    return entry;
  } catch (error) {
    throw new Error(`breaking install lock entry is unreadable at ${entryPath}: ${error.message}`);
  }
}

function compareInstallLockTokens(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function readInstallLockClaim(entryPath) {
  const claim = readInstallLockEntry(entryPath);
  if (!Number.isInteger(claim.sequence) || claim.sequence < 1) {
    throw new Error(`breaking install claim has invalid sequence at ${entryPath}`);
  }
  return claim;
}

function blockingInstallLockError(lockPath, owner) {
  if (processIsAlive(owner.pid)) {
    return new Error(
      `breaking install lock is held by active process ${owner.pid} at ${lockPath}`
    );
  }
  return new Error(
    `stale breaking install lock requires manual removal after inspection: ${lockPath} (recorded pid ${owner.pid ?? "missing"})`
  );
}

function installLockReleaseError(message, ownershipCertain = false) {
  const error = new Error(message);
  error.installLockOwnershipCertain = ownershipCertain;
  return error;
}

function acquireGlobalInstallLock(stateRoot) {
  fs.mkdirSync(stateRoot, { recursive: true });
  const lockPath = path.join(stateRoot, INSTALL_LOCK_NAME);
  const token = crypto.randomUUID();
  const choosingPath = path.join(lockPath, `choosing-${token}.json`);
  const claimPath = path.join(lockPath, `claim-${token}.json`);
  const protocolPath = path.join(lockPath, INSTALL_LOCK_PROTOCOL_FILE);
  const basePayload = {
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
    sourceRoot: root,
  };

  let createdContainer = false;
  try {
    fs.mkdirSync(lockPath);
    createdContainer = true;
    fs.writeFileSync(
      protocolPath,
      `${JSON.stringify({ protocol: INSTALL_LOCK_PROTOCOL }, null, 2)}\n`,
      { flag: "wx" }
    );
  } catch (error) {
    if (error.code !== "EEXIST" || createdContainer) throw error;
    if (!pathExists(protocolPath)) {
      const legacyOwnerPath = path.join(lockPath, "owner.json");
      if (pathExists(legacyOwnerPath)) {
        throw blockingInstallLockError(lockPath, readInstallLockEntry(legacyOwnerPath));
      }
      throw new Error(
        `breaking install lock exists without ${INSTALL_LOCK_PROTOCOL_FILE} at ${lockPath}; incomplete or legacy lock requires manual inspection and removal`
      );
    }
    let protocol;
    try {
      protocol = JSON.parse(fs.readFileSync(protocolPath, "utf8"));
    } catch (readError) {
      throw new Error(`breaking install lock protocol is unreadable at ${protocolPath}: ${readError.message}`);
    }
    if (protocol?.protocol !== INSTALL_LOCK_PROTOCOL) {
      throw new Error(`unsupported breaking install lock protocol at ${protocolPath}`);
    }
  }

  try {
    fs.writeFileSync(choosingPath, `${JSON.stringify(basePayload, null, 2)}\n`, { flag: "wx" });

    const initialEntries = fs
      .readdirSync(lockPath)
      .filter(
        (name) =>
          name !== path.basename(choosingPath) && name !== INSTALL_LOCK_PROTOCOL_FILE
      );
    const legacyOwner = initialEntries.find((name) => name === "owner.json");
    if (legacyOwner) {
      throw blockingInstallLockError(
        lockPath,
        readInstallLockEntry(path.join(lockPath, legacyOwner))
      );
    }
    const unexpected = initialEntries.filter(
      (name) => !/^claim-.+\.json$/.test(name) && !/^choosing-.+\.json$/.test(name)
    );
    if (unexpected.length > 0) {
      throw new Error(
        `breaking install lock exists but has unexpected entries at ${lockPath}: ${unexpected.join(", ")}`
      );
    }

    const existingClaims = initialEntries
      .filter((name) => /^claim-.+\.json$/.test(name))
      .map((name) => readInstallLockClaim(path.join(lockPath, name)));
    const sequence = existingClaims.reduce(
      (maximum, claim) => Math.max(maximum, Number.isInteger(claim.sequence) ? claim.sequence : 0),
      0
    ) + 1;
    const claimPayload = { ...basePayload, sequence };
    fs.writeFileSync(claimPath, `${JSON.stringify(claimPayload, null, 2)}\n`, { flag: "wx" });
    fs.unlinkSync(choosingPath);

    const choosingEntries = fs
      .readdirSync(lockPath)
      .filter((name) => /^choosing-.+\.json$/.test(name));
    if (choosingEntries.length > 0) {
      throw blockingInstallLockError(
        lockPath,
        readInstallLockEntry(path.join(lockPath, choosingEntries.sort()[0]))
      );
    }

    const claims = fs
      .readdirSync(lockPath)
      .filter((name) => /^claim-.+\.json$/.test(name))
      .map((name) => readInstallLockClaim(path.join(lockPath, name)))
      .sort(
        (left, right) =>
          left.sequence - right.sequence || compareInstallLockTokens(left.token, right.token)
      );
    const winner = claims[0];
    if (!winner) throw new Error(`install lock claim disappeared during acquisition: ${claimPath}`);
    if (winner.token !== token) throw blockingInstallLockError(lockPath, winner);

    return { lockPath, claimPath, token, sequence };
  } catch (error) {
    const cleanupFailures = [];
    for (const ownedPath of [choosingPath, claimPath]) {
      try {
        fs.unlinkSync(ownedPath);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          cleanupFailures.push(`${ownedPath}: ${cleanupError.message}`);
        }
      }
    }
    if (cleanupFailures.length > 0) {
      throw new Error(`${error.message}; cannot remove owned lock entries: ${cleanupFailures.join("; ")}`);
    }
    throw error;
  }
}

function releaseGlobalInstallLock(lock) {
  if (!lock) throw installLockReleaseError("cannot release an install lock without ownership metadata");
  let current;
  try {
    current = readInstallLockClaim(lock.claimPath);
  } catch (error) {
    throw installLockReleaseError(error.message);
  }
  if (process.env.MONO_WORKFLOW_TEST_FAIL_INSTALL_LOCK_RELEASE === "1") {
    throw installLockReleaseError(
      `injected install lock release failure for ${lock.claimPath}`,
      true
    );
  }
  if (process.env.MONO_WORKFLOW_TEST_REPLACE_LOCK_CONTAINER_BEFORE_RELEASE === "1") {
    const displacedPath = `${lock.lockPath}.displaced-${lock.token}`;
    fs.renameSync(lock.lockPath, displacedPath);
    fs.mkdirSync(lock.lockPath);
    fs.writeFileSync(
      path.join(lock.lockPath, INSTALL_LOCK_PROTOCOL_FILE),
      `${JSON.stringify({ protocol: INSTALL_LOCK_PROTOCOL }, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(lock.lockPath, "claim-newer-owner.json"),
      `${JSON.stringify({
        pid: process.pid,
        token: "test-token-placeholder",
        sequence: 1,
        startedAt: new Date().toISOString(),
      }, null, 2)}\n`
    );
  }
  if (current.token !== lock.token) {
    throw installLockReleaseError(`install lock ownership changed before release: ${lock.claimPath}`);
  }
  if (current.sequence !== lock.sequence) {
    throw installLockReleaseError(`install lock sequence changed before release: ${lock.claimPath}`);
  }
  try {
    fs.unlinkSync(lock.claimPath);
  } catch (error) {
    throw installLockReleaseError(`cannot remove owned install lock claim ${lock.claimPath}: ${error.message}`);
  }
  return null;
}

function productOrchestratorRoots(orchestratorRoot) {
  if (!fs.existsSync(orchestratorRoot)) return [];
  return fs
    .readdirSync(orchestratorRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(orchestratorRoot, entry.name))
    .sort();
}

function prepareOrchestratorTreeClaim(stateRoot, token) {
  const canonicalPath = path.join(stateRoot, "orchestrator");
  const backupPath = path.join(stateRoot, `.orchestrator.install-backup-${token}`);
  const claimPath = path.join(stateRoot, `.orchestrator.install-claim-${token}`);
  const existed = pathExists(canonicalPath);

  return {
    canonicalPath,
    backupPath: existed ? backupPath : null,
    claimPath,
    existed,
    claimCreated: false,
    originalMoved: false,
    canonicalClaimed: false,
    restored: false,
  };
}

function claimOrchestratorTree(claim) {
  fs.mkdirSync(claim.claimPath);
  claim.claimCreated = true;
  fs.chmodSync(claim.claimPath, 0o000);
  if (claim.existed) {
    fs.renameSync(claim.canonicalPath, claim.backupPath);
    claim.originalMoved = true;
  }
  if (process.env.MONO_WORKFLOW_TEST_FAIL_DURING_QUIESCENCE_CLAIM === "1") {
    throw new Error(`Injected failure while claiming orchestrator root ${claim.canonicalPath}`);
  }
  if (process.env.MONO_WORKFLOW_TEST_FAIL_DURING_QUIESCENCE_CLAIM === "recreate") {
    fs.mkdirSync(claim.canonicalPath);
    throw new Error(
      `Injected concurrent orchestrator-root recreation while claiming ${claim.canonicalPath}`
    );
  }
  fs.renameSync(claim.claimPath, claim.canonicalPath);
  claim.canonicalClaimed = true;
}

function restoreOrchestratorTreeClaim(claim) {
  if (process.env.MONO_WORKFLOW_TEST_FAIL_QUIESCENCE_RESTORE === "1") {
    throw new Error(`Injected quiescence restore failure for ${claim.canonicalPath}`);
  }
  if (claim.canonicalClaimed) {
    if (!pathExists(claim.canonicalPath) || !fs.lstatSync(claim.canonicalPath).isDirectory()) {
      throw new Error(`orchestrator claim was lost at ${claim.canonicalPath}`);
    }
    fs.chmodSync(claim.canonicalPath, 0o300);
    if (claim.existed) {
      fs.renameSync(claim.backupPath, claim.canonicalPath);
    } else {
      fs.rmdirSync(claim.canonicalPath);
    }
  } else {
    if (claim.claimCreated && pathExists(claim.claimPath)) {
      fs.chmodSync(claim.claimPath, 0o700);
      fs.rmdirSync(claim.claimPath);
    }
    if (claim.originalMoved) {
      if (pathExists(claim.canonicalPath)) {
        throw new Error(
          `cannot restore orchestrator backup because ${claim.canonicalPath} was recreated; original retained at ${claim.backupPath}`
        );
      }
      fs.renameSync(claim.backupPath, claim.canonicalPath);
    }
  }
  claim.restored = true;
}

function verifyBreakingQuiescence(root, productRoots) {
  const verifier = path.join(root, "scripts", "verify-pack-state.mjs");
  for (const productRoot of productRoots) {
    try {
      execFileSync(process.execPath, [verifier, "quiescence", "--root", productRoot], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const detail = error.stderr?.toString().trim() || error.message;
      throw new Error(`breaking install blocked by orchestrator root ${productRoot}: ${detail}`);
    }
  }
}

function readLockStrict(lockPath) {
  if (!pathExists(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch (error) {
    throw new Error(`Lockfile is corrupted: ${lockPath} (${error.message})`);
  }
}

function writableAncestor(targetPath) {
  let current = path.resolve(targetPath);
  while (!pathExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function missingDirectoryChain(targetPath) {
  const missing = [];
  let current = path.resolve(targetPath);
  while (!pathExists(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return missing;
}

function removeCreatedDirectories(directories) {
  for (const directory of directories) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
    }
  }
}

function preflightBreakingRoot(root, skillsRoot, commit, dirty) {
  if (pathExists(skillsRoot) && !fs.lstatSync(skillsRoot).isDirectory()) {
    throw new Error(`Skills root is not a directory: ${skillsRoot}`);
  }
  fs.accessSync(writableAncestor(skillsRoot), fs.constants.W_OK);

  const plan = plannedInstall(root, skillsRoot, commit, dirty);
  const currentLock = readLockStrict(plan.lockPath);
  const legacyLock = readLockStrict(path.join(skillsRoot, LEGACY_LOCKFILE_NAME));
  const previousLock = currentLock ?? legacyLock;

  const expectedSkills = new Set(plan.skills);
  const previousEntries = previousLock?.installedSkills;
  if (previousEntries !== undefined && !Array.isArray(previousEntries)) {
    throw new Error("Previous lockfile installedSkills must be an array");
  }
  const previousSkillNames = new Set();
  for (const entry of previousEntries || []) {
    const name = entry?.name;
    if (
      typeof name !== "string" ||
      !/^(?:mono|linear)-[a-z0-9][a-z0-9-]*$/.test(name)
    ) {
      throw new Error(
        `Previous lockfile installed skill name must be a safe direct child: ${JSON.stringify(name)}`
      );
    }
    previousSkillNames.add(name);
  }
  const generatedStale = generatedStaleWorkflowDirs(skillsRoot, expectedSkills);
  const retiredFromPreviousLock = new Set(
    generatedStale.filter((name) => previousSkillNames.has(name))
  );
  const unexpectedGenerated = generatedStale.filter(
    (name) => !retiredFromPreviousLock.has(name)
  );
  if (unexpectedGenerated.length > 0) {
    throw new Error(
      `Unexpected generated workflow skill directories are not owned by the previous lock: ${unexpectedGenerated.join(", ")}`
    );
  }
  const managedEntries = new Set([
    ...plan.skills,
    RUNTIME_DIR,
    LOCKFILE_NAME,
    LEGACY_RUNTIME_DIR,
    LEGACY_LOCKFILE_NAME,
    ...retiredFromPreviousLock,
  ]);
  return {
    skillsRoot,
    createdDirectories: missingDirectoryChain(skillsRoot),
    managedEntries: [...managedEntries].sort(),
    stagedEntries: [...plan.skills, RUNTIME_DIR, LOCKFILE_NAME],
  };
}

function stageBreakingRoot(root, preflight, commit, dirty, version, rootIndex) {
  const parent = path.dirname(preflight.skillsRoot);
  fs.mkdirSync(parent, { recursive: true });
  const transactionRoot = fs.mkdtempSync(
    path.join(parent, ".mono-agent-workflow-install-")
  );
  const stageRoot = path.join(transactionRoot, "stage");
  const backupRoot = path.join(transactionRoot, "backup");
  try {
    if (Number(process.env.MONO_WORKFLOW_TEST_FAIL_DURING_STAGE_ROOT || 0) === rootIndex) {
      throw new Error(`Injected breaking install staging failure at root ${rootIndex}`);
    }
    sync(root, stageRoot, commit, dirty, version, true, {
      manifestSkillsRoot: preflight.skillsRoot,
      log: false,
    });
    return {
      ...preflight,
      rootIndex,
      transactionRoot,
      stageRoot,
      backupRoot,
      backedUpEntries: [],
      installedEntries: [],
      mutated: false,
      rollbackFailed: false,
      rolledBack: false,
    };
  } catch (error) {
    fs.rmSync(transactionRoot, { recursive: true, force: true });
    removeCreatedDirectories(preflight.createdDirectories);
    throw error;
  }
}

function commitBreakingRoot(transaction) {
  transaction.mutated = true;
  fs.mkdirSync(transaction.skillsRoot, { recursive: true });

  for (const relativePath of transaction.managedEntries) {
    const installedPath = path.join(transaction.skillsRoot, relativePath);
    if (!pathExists(installedPath)) continue;
    const backupPath = path.join(transaction.backupRoot, relativePath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.renameSync(installedPath, backupPath);
    transaction.backedUpEntries.push(relativePath);
  }

  for (const relativePath of transaction.stagedEntries) {
    const stagedPath = path.join(transaction.stageRoot, relativePath);
    if (!pathExists(stagedPath)) {
      throw new Error(`Breaking install staging is missing ${relativePath}`);
    }
    const installedPath = path.join(transaction.skillsRoot, relativePath);
    fs.mkdirSync(path.dirname(installedPath), { recursive: true });
    fs.renameSync(stagedPath, installedPath);
    transaction.installedEntries.push(relativePath);
  }
}

function rollbackBreakingRoot(transaction) {
  if (
    Number(process.env.MONO_WORKFLOW_TEST_FAIL_ROLLBACK_ROOT || 0) ===
    transaction.rootIndex
  ) {
    throw new Error(`Injected breaking install rollback failure at root ${transaction.rootIndex}`);
  }
  for (const relativePath of [...transaction.installedEntries].reverse()) {
    fs.rmSync(path.join(transaction.skillsRoot, relativePath), {
      recursive: true,
      force: true,
    });
  }
  for (const relativePath of [...transaction.backedUpEntries].reverse()) {
    const backupPath = path.join(transaction.backupRoot, relativePath);
    const installedPath = path.join(transaction.skillsRoot, relativePath);
    fs.mkdirSync(path.dirname(installedPath), { recursive: true });
    fs.renameSync(backupPath, installedPath);
  }
  transaction.rolledBack = true;
}

function rollbackBreakingRoots(transactions) {
  const rollbackFailures = [];
  for (const transaction of [...transactions].reverse()) {
    if (!transaction.mutated || transaction.rolledBack) continue;
    try {
      rollbackBreakingRoot(transaction);
    } catch (rollbackError) {
      transaction.rollbackFailed = true;
      rollbackFailures.push(
        `${transaction.skillsRoot}: ${rollbackError.message}; backup retained at ${transaction.transactionRoot}`
      );
    }
  }
  return rollbackFailures;
}

function cleanupBreakingRoot(transaction) {
  if (transaction?.transactionRoot) {
    fs.rmSync(transaction.transactionRoot, { recursive: true, force: true });
  }
}

function probeQuiescenceClaim(claim) {
  if (process.env.MONO_WORKFLOW_TEST_PROBE_QUIESCENCE_CLAIM !== "1") return;
  const probeRoot = path.join(claim.canonicalPath, "new-product");
  let blocked = false;
  try {
    fs.mkdirSync(probeRoot);
  } catch {
    blocked = true;
  }
  if (!blocked || !fs.lstatSync(claim.canonicalPath).isDirectory()) {
    throw new Error(`quiescence claim did not exclude new orchestrator roots at ${claim.canonicalPath}`);
  }
  console.log("Quiescence claim probe passed");
}

function breakingSync(root, args, commit, dirty, version) {
  assertBreakingPlatformSupported();
  const stateRoot = workflowStateRoot();
  const installLock = acquireGlobalInstallLock(stateRoot);
  const transactions = [];
  let orchestratorClaim = null;
  let failure = null;
  let recoveryRequired = false;
  try {
    const targetRoots = resolveTargetRoots(args);
    const canonicalOrchestratorRoot = path.join(stateRoot, "orchestrator");
    const productRoots = productOrchestratorRoots(canonicalOrchestratorRoot);
    verifyBreakingQuiescence(root, productRoots);
    if (process.env.MONO_WORKFLOW_TEST_ACTIVATE_AFTER_QUIESCENCE_SCAN === "1") {
      const racedProductRoot = productRoots[0] ?? path.join(canonicalOrchestratorRoot, "raced-product");
      fs.mkdirSync(racedProductRoot, { recursive: true });
      fs.writeFileSync(path.join(racedProductRoot, "control.json"), '{"state":"active"}\n');
      if (!pathExists(path.join(racedProductRoot, "workers.json"))) {
        fs.writeFileSync(path.join(racedProductRoot, "workers.json"), "{}\n");
      }
    }
    orchestratorClaim = prepareOrchestratorTreeClaim(stateRoot, installLock.token);
    claimOrchestratorTree(orchestratorClaim);
    const frozenProductRoots = orchestratorClaim.existed
      ? productOrchestratorRoots(orchestratorClaim.backupPath)
      : [];
    verifyBreakingQuiescence(root, frozenProductRoots);
    probeQuiescenceClaim(orchestratorClaim);

    // Every root is inspected before staging or target mutation begins.
    const preflights = targetRoots.map((skillsRoot) =>
      preflightBreakingRoot(root, skillsRoot, commit, dirty)
    );
    for (let index = 0; index < preflights.length; index += 1) {
      transactions.push(
        stageBreakingRoot(root, preflights[index], commit, dirty, version, index + 1)
      );
    }

    const failAfterRoot = Number(process.env.MONO_WORKFLOW_TEST_FAIL_AFTER_ROOT || 0);
    for (let index = 0; index < transactions.length; index += 1) {
      commitBreakingRoot(transactions[index]);
      if (failAfterRoot === index + 1) {
        throw new Error(`Injected breaking install failure after root ${index + 1}`);
      }
    }

    for (const transaction of transactions) {
      const failures = check(root, transaction.skillsRoot, commit, dirty, version);
      if (failures.length > 0) {
        throw new Error(
          `Breaking install post-check failed for ${transaction.skillsRoot}:\n- ${failures.join("\n- ")}`
        );
      }
    }

    restoreOrchestratorTreeClaim(orchestratorClaim);

  } catch (error) {
    const rollbackFailures = rollbackBreakingRoots(transactions);
    if (rollbackFailures.length > 0) {
      recoveryRequired = true;
      failure = new Error(`${error.message}\nBreaking install rollback failed:\n- ${rollbackFailures.join("\n- ")}`);
    } else {
      failure = error;
    }
  } finally {
    if (orchestratorClaim && !orchestratorClaim.restored) {
      try {
        restoreOrchestratorTreeClaim(orchestratorClaim);
      } catch (restoreError) {
        recoveryRequired = true;
        const detail = `Quiescence restore failed:\n- ${restoreError.message}`;
        failure = failure ? new Error(`${failure.message}\n${detail}`) : new Error(detail);
      }
    }

    if (!recoveryRequired) {
      try {
        releaseGlobalInstallLock(installLock);
      } catch (releaseError) {
        const ownershipCertain = releaseError.installLockOwnershipCertain === true;
        const rollbackFailures = ownershipCertain ? rollbackBreakingRoots(transactions) : [];
        recoveryRequired = true;
        let detail = `Install lock release failed:\n- ${releaseError.message}`;
        if (!ownershipCertain) {
          detail += "\n- lock ownership is uncertain; installed roots were left consistent and recovery data was retained without an unsafe rollback";
        }
        if (rollbackFailures.length > 0) {
          detail += `\nBreaking install rollback failed:\n- ${rollbackFailures.join("\n- ")}`;
        }
        failure = failure ? new Error(`${failure.message}\n${detail}`) : new Error(detail);
      }
    }

    if (!recoveryRequired) {
      for (const transaction of transactions) {
        if (transaction.rollbackFailed) continue;
        let cleaned = false;
        try {
          cleanupBreakingRoot(transaction);
          cleaned = true;
        } catch (cleanupError) {
          console.error(
            `Warning: could not remove breaking install transaction data at ${transaction.transactionRoot}: ${cleanupError.message}`
          );
        }
        if (cleaned && (!transaction.mutated || transaction.rolledBack)) {
          try {
            removeCreatedDirectories(transaction.createdDirectories);
          } catch (cleanupError) {
            const detail = `could not restore created-directory absence for ${transaction.skillsRoot}: ${cleanupError.message}`;
            failure = failure ? new Error(`${failure.message}\n${detail}`) : new Error(detail);
          }
        }
      }
    }
  }

  if (failure) throw failure;
  for (const transaction of transactions) {
    console.log(`Breaking install committed for ${transaction.skillsRoot} (version ${version || "unknown"})`);
  }
}

const args = parseArgs(process.argv.slice(2));
const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");

let commit = "";
let dirty = false;
try {
  commit = command(root, "git", ["rev-parse", "HEAD"]);
  dirty = command(root, "git", ["status", "--short"]).length > 0;
} catch (error) {
  console.error(`Upstream must be a git checkout: ${root}`);
  console.error(error.message);
  process.exit(1);
}

const version = readVersion(root);

if (args.check) {
  const targetRoots = resolveTargetRoots(args);
  let failed = false;
  for (const skillsRoot of targetRoots) {
    const failures = check(root, skillsRoot, commit, dirty, version);
    if (failures.length > 0) {
      failed = true;
      console.error(`Mono workflow local install check failed for ${skillsRoot}:`);
      for (const failure of failures) console.error(`- ${failure}`);
    } else {
      console.log(`Mono workflow local install check passed for ${skillsRoot} (version ${installedRootVersion(skillsRoot)})`);
    }
  }
  process.exit(failed ? 1 : 0);
} else if (args.breaking) {
  try {
    breakingSync(root, args, commit, dirty, version);
  } catch (error) {
    console.error(`Breaking install failed: ${error.message}`);
    process.exit(1);
  }
} else {
  const installLock = acquireGlobalInstallLock(workflowStateRoot());
  try {
    const targetRoots = resolveTargetRoots(args);
    for (const skillsRoot of targetRoots) {
      sync(root, skillsRoot, commit, dirty, version, args.removeStale);
    }
  } finally {
    try {
      releaseGlobalInstallLock(installLock);
    } catch (releaseError) {
      console.error(`Install lock release failed: ${releaseError.message}`);
      process.exitCode = 1;
    }
  }
}
