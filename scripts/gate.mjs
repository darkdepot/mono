#!/usr/bin/env node
export { parseReviewUsage } from './review-usage.mjs';
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { atomicJson, canonical, digest, readJson, flags, identity, isMain, deliveryConfig, shipBotChecks, withLock, resolvedLocation, validateEvidenceGrants, resolveRole, baseModelConfig, validateLanding, changedPaths, packLayout, REVIEW_PRODUCER } from "./runtime.mjs";
import { checkCollectionRequest, pinnedShipPolicy, verifyIdeaArtifact, effectivePins, collectionPinsBinding, sha256File } from "./orchestrator/command-state.mjs";

import { runReviewRound } from './code-review.mjs';

export { reviewEnvironment } from "./model-environment.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const safeGitArgs = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat", "-c", "advice.graftFileDeprecated=false"];
function safeGitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_GRAFT_FILE: "/dev/null", GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" });
  return env;
}
function fetchGitEnv() {
  const env = safeGitEnv();
  for (const key of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM",
    "GIT_ASKPASS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT"]) {
    delete env[key];
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // Compatibility hint only: collection authority is checked independently.
  if (process.env.MONO_WORKER_JOURNAL_IDENTITY && process.env.GIT_CONFIG_PARAMETERS !== undefined)
    env.GIT_CONFIG_PARAMETERS = process.env.GIT_CONFIG_PARAMETERS;
  return env;
}
function rejectSubmodules(cwd, env) {
  const reason = "submodules unsupported by the collector (executable-filter inspection covers the superproject only)";
  requireThat(!fs.existsSync(path.join(cwd, ".gitmodules")), reason);
  // Inspect gitlinks as index data, without entering submodules or running status.
  const entries = execFileSync("git", [...safeGitArgs, "ls-files", "--stage", "-z"], { cwd, env, encoding: "utf8" });
  requireThat(!entries.split("\0").some(entry => entry.startsWith("160000 ")), reason);
}
function rejectExecutableFilters(cwd, env = safeGitEnv()) {
  const result = spawnSync("git", [...safeGitArgs, "config", "--null", "--get-regexp", "^filter\\..*\\.(clean|smudge|process)$"], { cwd, env, encoding: "utf8" });
  requireThat([0, 1].includes(result.status), "cannot inspect repository Git filter configuration");
  requireThat(!result.stdout.split("\0").some(item => item.slice(item.indexOf("\n") + 1).trim()),
    "repository Git filters require a trusted isolation policy before privileged gate/review reads");
}
function statusIgnoreArgs(cwd, env) {
  const read = (scope, configEnv) => {
    const result = spawnSync("git", [...safeGitArgs, "config", ...scope, "--includes", "--path", "--null", "--get", "core.excludesFile"],
      { cwd, env: configEnv, encoding: "utf8" });
    requireThat([0, 1].includes(result.status), "cannot read Git excludesFile configuration");
    return result.status === 0 ? result.stdout.replace(/\0$/, "") : null;
  };
  // Preserve repository precedence; only read the global fallback as data.
  if (read([], env) !== null) return [];
  const globalEnv = { ...env }; delete globalEnv.GIT_CONFIG_GLOBAL;
  if (process.env.GIT_CONFIG_GLOBAL !== undefined) globalEnv.GIT_CONFIG_GLOBAL = process.env.GIT_CONFIG_GLOBAL;
  const excludes = read(["--global"], globalEnv);
  return excludes === null ? [] : ["-c", `core.excludesFile=${excludes}`];
}
const git = (cwd, ...args) => {
  const env = safeGitEnv(); rejectSubmodules(cwd, env); rejectExecutableFilters(cwd, env);
  const fetching = args[0] === "fetch";
  try {
    return execFileSync("git", [...safeGitArgs, ...(args[0] === "status" ? statusIgnoreArgs(cwd, env) : []), ...args],
      { cwd, env: fetching ? fetchGitEnv() : env, encoding: "utf8", ...(fetching ? { timeout: 60_000 } : {}) }).trim();
  } catch (error) {
    if (fetching) throw new ShipPending(`base fetch failed (${error.code ?? error.status ?? "unknown"}); check remote access and credentials`);
    throw error;
  }
};
const requireThat = (truth, reason) => { if (!truth) throw new Error(reason); };
class ShipPending extends Error {}
const cleanTree = (cwd) => requireThat(git(cwd, "status", "--porcelain", "--untracked-files=all") === "", "working tree is dirty");

export function startGate(request, { beforeSpawn = false } = {}) {
  requireThat(identity(request), "missing pack identity");
  if (request.attempt !== undefined) {
    requireThat(path.isAbsolute(request.root ?? '') && /^[A-Z][A-Z0-9]*-\d+$/.test(request.issue) &&
      Number.isInteger(request.attempt) && request.attempt > 0, 'invalid startup dispatch binding');
    const file = path.join(request.root, 'dispatch', `${request.issue}-a${request.attempt}`, 'pins.json');
    requireThat(request.pins?.file === file && sha256File(file) === request.pins.digest, 'stale dispatch pins');
    const registry = readJson(path.join(request.root, 'workers.json')), entry = registry[request.issue];
    const attemptsFile = path.join(request.root, 'attempts.json');
    const used = fs.existsSync(attemptsFile) ? readJson(attemptsFile)[request.issue] ?? 0 : 0;
    let pins;
    if (beforeSpawn) {
      requireThat(used + 1 === request.attempt && (!entry || entry.attempt < request.attempt), 'stale dispatch attempt');
      pins = readJson(file);
    } else {
      requireThat(used === request.attempt && entry?.attempt === request.attempt && entry.stage === 'mono-deliver' &&
        entry.worktree === request.worktree && entry.branch === request.branch && identity(entry) &&
        ['packVersion', 'sourceCommit', 'surfaceRevision'].every(key => canonical(entry[key] ?? null) === canonical(request[key] ?? null)), 'stale dispatch attempt');
      requireThat(canonical(collectionPinsBinding(entry)) === canonical(request.pins), 'stale dispatch pins');
      pins = effectivePins(entry);
    }
    for (const key of ['worktree', 'branch', 'base', 'packRoot', 'packVersion', 'sourceCommit', 'surfaceRevision', 'risk', 'critical'])
      requireThat(canonical(request[key] ?? null) === canonical(pins[key] ?? null), `stale dispatch field: ${key}`);
  }
  const output = execFileSync(process.execPath, [path.join(scriptDir, "verify-pack-state.mjs"), "identity",
    "--pack-root", request.packRoot,
    "--pack-version", request.packVersion, ...(request.sourceCommit ? ["--source-commit", request.sourceCommit] : []), "--surface-revision", String(request.surfaceRevision)], { encoding: "utf8" });
  requireThat(output.trim() === "pack-state: identity verified", "pack identity not verified");
  requireThat(git(request.worktree, "branch", "--show-current") === request.branch && !["main", "master", ""].includes(request.branch), "wrong delivery branch");
  const base = git(request.worktree, "rev-parse", "--verify", `${request.base}^{commit}`);
  requireThat(git(request.worktree, "merge-base", "HEAD", base) === base, "branch does not contain dispatched base");
  cleanTree(request.worktree);
  return "pack identity, branch base and clean tree verified";
}

export function reviewRoute(skillsRoot, risk, critical, config = {}) {
  const resolved = resolveRole('autoreview', config, { skillsRoot });
  const effort = resolved.effortByRisk[critical ? 'riskyCritical' : risk];
  requireThat(effort && (!critical || risk === 'risky'), 'unresolved final risk route');
  const { effortByRisk, ...route } = resolved;
  return { ...route, effort };
}
export function pinnedReviewRoute(request, base) {
  const pins = request.modelRoutes;
  const config = baseModelConfig(request.worktree, pins?.base ?? base);
  if (pins) {
    requireThat(git(request.worktree, 'merge-base', base, pins.base) === pins.base, 'model route base is not an ancestor of the review base');
    requireThat(pins.configDigest === digest(config) && pins.roles?.autoreview, 'model route config fingerprint mismatch');
    for (const [role, route] of Object.entries(pins.roles)) requireThat(canonical(route) === canonical(resolveRole(role, config, { packRoot: request.packRoot, skillsRoot: request.skillsRoot })), `model route fingerprint mismatch: ${role}`);
  } else requireThat(config.models === undefined, 'modelRoutes launch pins required for product model overrides');
  return reviewRoute(request.packRoot ?? request.skillsRoot, request.risk, request.critical, config);
}
export const ROUND_LIMIT = 3;
const ACCEPTED = ['clean', 'clean-with-successors'];
const findingLine = finding => `${finding.weight} ${finding.file}:${finding.line} ${finding.title}`;
const leftover = record => (record?.findings ?? []).filter(finding => !['closed', 'rejected'].includes(finding.status));
// Rounds are counted per pins file from signed receipts; nothing else keeps a counter.
// receipts: signature-verified history, any producer or issue. reuse: a completed round on this exact head.
export function reviewHistory(receipts, { pins, head, base, contractDigest }) {
  const mine = receipts.filter(receipt => receipt?.producer === REVIEW_PRODUCER && receipt.pins?.file === pins.file && receipt.review)
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
  const completed = mine.filter(receipt => receipt.review.spent === true);
  const same = receipt => receipt.base === base && receipt.review.contractDigest === contractDigest;
  const onHead = mine.filter(receipt => receipt.head === head && receipt.review.outcome !== 'refused');
  let notReviewed = 0;
  for (let index = onHead.length - 1; index >= 0 && onHead[index].review.outcome === 'not-reviewed'; index--) notReviewed++;
  return { spent: completed.length, notReviewed, reuse: completed.findLast(receipt => receipt.head === head && same(receipt)) ?? null,
    record: completed.findLast(same)?.review.record ?? null };
}
// Before the last round open findings mean "fix and ask again". On the last round
// harmless leftovers become successor candidates; anything else stays not-converged.
export function roundOutcome(record, last) {
  const open = leftover(record);
  const stands = !last || !open.length || open.some(finding => finding.danger !== false || finding.outcome === 'unresolved') ||
    record.findings.some(finding => finding.outOfContract || finding.riskRaised);
  if (record.outcome !== 'not-converged' || stands) return { outcome: record.outcome, successors: [] };
  return { outcome: 'clean-with-successors', successors: open.map(finding => ({ key: finding.key, line: findingLine(finding), origin: finding.origin })) };
}
function reviewRefusal(review) {
  if (review.outcome === 'refused') return review.reason;
  if (review.outcome === 'not-reviewed') return review.repeated
    ? `blocked: not-reviewed twice in a row on this head: ${review.reason}`
    : `not-reviewed: ${review.reason}; no round spent, request this head once more`;
  const open = leftover(review.record).map(findingLine), round = `round ${review.round} of ${ROUND_LIMIT}`;
  const list = `${open.length} open: ${open.slice(0, 20).join('; ')}`;
  return review.round === ROUND_LIMIT ? `needs-decision: review not-converged after ${round}; ${list}`
    : `review not-converged (${round}); fix and request the next round; ${list}`;
}
export function validatePreflight(receipt, head, base) {
  requireThat(receipt?.producer === REVIEW_PRODUCER && receipt.review, "missing review receipt or old receipt format; request a new collection");
  requireThat(receipt.head === head && receipt.base === base, "missing or stale review receipt/head/base");
  requireThat(ACCEPTED.includes(receipt.review.outcome), reviewRefusal(receipt.review));
  requireThat(receipt.consistency?.passed === true && receipt.consistency.error === null, `collection consistency failed or missing: ${receipt.consistency?.error ?? "no record"}`);
  requireThat(receipt.verification?.exitCode === 0, "needs-decision: verification failed on the reviewed head");
  requireThat(receipt.verification.sandbox?.mode === "workspace-write" && receipt.verification.sandbox.probed === true, "verification sandbox proof missing");
  const successors = receipt.review.successors ?? [];
  return `review ${receipt.review.outcome} (round ${receipt.review.round} of ${ROUND_LIMIT}) and verification verified on head` +
    (successors.length ? `; successor candidates: ${successors.map(item => item.line).join('; ')}` : '');
}

// Keep semantic lines separately from diagnostics; a saturated semantic budget
// refuses the result instead of silently dropping evidence used by validation.
export function captureOutput({ tailBytes = 8192, retainedBytes = 1024 * 1024 } = {}) {
  let pending = "", tail = "", kept = "", retentionError = null, discarding = false;
  const requiredPrefix = /^(autoreview target:|engine:|model:|thinking:|overall:|autoreview (?:chunked )?(?:clean|filtered|scoped-clean|findings|incorrect|incomplete):|(?:claude|codex) usage:|mono-boundary-denied:)/;
  const requiredLine = line => requiredPrefix.test(line);
  const consume = line => {
    if (requiredLine(line) || /^(?:bundle: [0-9]+ bytes; )?review passes: [0-9]+$/.test(line)) {
      if (Buffer.byteLength(kept) + Buffer.byteLength(line) + 1 > retainedBytes) retentionError = "semantic output retention limit exceeded";
      else kept += line + "\n";
    } else tail = (tail + line + "\n").slice(-tailBytes);
  };
  return {
    write(chunk) {
      for (const segment of String(chunk).split(/(?<=\n)/)) {
        if (!discarding) pending += segment;
        else tail = (tail + segment).slice(-tailBytes);
        if (Buffer.byteLength(pending) > retainedBytes) {
          if (requiredLine(pending)) retentionError = "output line retention limit exceeded";
          else tail = (tail + pending).slice(-tailBytes);
          pending = ""; discarding = true;
        }
        if (segment.endsWith("\n")) {
          if (!discarding) consume(pending.replace(/\r?\n$/, ""));
          pending = ""; discarding = false;
        }
      }
    },
    finish() {
      if (pending) consume(pending);
      pending = "";
      return { output: kept, diagnosticTail: tail, retentionError };
    },
  };
}
export async function runCaptured(command, args, cwd, env = process.env) {
  return new Promise(resolve => {
    const out = captureOutput(), err = captureOutput();
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let error = null;
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => out.write(chunk)); child.stderr.on("data", chunk => err.write(chunk));
    child.on("error", cause => { error = cause.message; });
    child.on("close", exitCode => {
      const stdout = out.finish(), stderr = err.finish();
      resolve({ command, args, exitCode, output: stdout.output + stderr.output,
        diagnosticTail: (stdout.diagnosticTail + stderr.diagnosticTail).slice(-8192),
        retentionError: stdout.retentionError ?? stderr.retentionError, error });
    });
  });
}
export function sandboxWriteRoots(sandbox) {
  const profile = sandbox.args[sandbox.args.indexOf("-c") + 1];
  return [...profile.matchAll(/("(?:\\.|[^"\\])*")="write"/gu)].map(match => JSON.parse(match[1]));
}
export async function runSandboxed(command, args, repo, evidenceRoot, {
  env = process.env, reviewArtifacts = false, protectedPaths = {}, verificationWritableRoots = [], workerWritableRoots = []
} = {}) {
  const isolatedReview = process.platform === "darwin" && reviewArtifacts;
  const excluded = [...Object.values(protectedPaths), evidenceRoot, repo, ...verificationWritableRoots, ...workerWritableRoots];
  let tempRoot;
  if (isolatedReview) {
    const directory = path.join(os.homedir(), ".mono-agent-workflow", "review-tmp", `mono-review-${crypto.randomUUID()}`);
    validateEvidenceGrants(directory, excluded, "collection private review directory");
    // A dangling ancestor symlink must refuse, rather than be treated as a new directory.
    let ancestor = path.dirname(directory);
    for (;;) {
      try { fs.lstatSync(ancestor); break; }
      catch (error) { if (error.code !== "ENOENT") throw error; ancestor = path.dirname(ancestor); }
    }
    try { fs.realpathSync(ancestor); }
    catch (error) { throw new Error(`collection private review directory canonical resolution failed: ${error.code}`); }
    fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
    fs.mkdirSync(directory, { mode: 0o700 });
    tempRoot = directory;
  } else tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-sandbox-temp-"));
  try {
  if (isolatedReview) {
    tempRoot = fs.realpathSync(tempRoot);
    validateEvidenceGrants(tempRoot, excluded, "collection private review directory");
  }
  const roots = [...new Set([repo, tempRoot].map(resolvedLocation))];
  if (process.platform === "darwin" && !reviewArtifacts) {
    let darwinTemp = null;
    try {
      const result = spawnSync("getconf", ["DARWIN_USER_TEMP_DIR"], { env, encoding: "utf8" });
      if (result.status === 0 && path.isAbsolute(result.stdout.trim())) darwinTemp = fs.realpathSync(result.stdout.trim());
    } catch {} // Unavailable system temp root retains the existing grants.
    if (darwinTemp) {
      for (const [label, location] of Object.entries({ ...protectedPaths, evidenceRoot }))
        validateEvidenceGrants(darwinTemp, [location], `collection Darwin temporary write grant (${label})`);
      if (!roots.includes(darwinTemp)) roots.push(darwinTemp);
    }
  }
  validateEvidenceGrants(evidenceRoot, roots);
  const probe = path.join(evidenceRoot, `.write-boundary-${crypto.randomUUID()}`);
  const probeMarker = `mono-boundary-denied:${crypto.randomUUID()}`;
  const jsonFile = path.join(tempRoot, "review.json"), statusFile = path.join(tempRoot, "status.json");
  if (reviewArtifacts) args = [...args, "--json-output", jsonFile, "--status-output", statusFile];
  const launcher = `const fs=require('node:fs'),cp=require('node:child_process');
const p=JSON.parse(process.argv[1]);let denied=false;
try{fs.writeFileSync(p.probe,'boundary-probe',{flag:'wx'});fs.unlinkSync(p.probe);}
catch(e){if(['EACCES','EPERM','EROFS'].includes(e.code))denied=true;else throw e;}
if(!denied){console.error('verification sandbox permits evidence writes');process.exit(73);}
console.log(p.probeMarker);
process.env.MONO_DELIVERY_SANDBOX='1';
const r=cp.spawnSync(p.command,p.args,{stdio:'inherit'});
if(r.error)console.error(r.error.message);process.exit(r.status===null?1:r.status);`;
  const filesystem = ['":root"="read"', ...roots.map(root => `${JSON.stringify(root)}="write"`)].join(",");
  const profile = `permissions.mono-collector={filesystem={${filesystem}},network={enabled=true}}`;
  const sandboxArgs = ["sandbox", "-C", repo, "-P", "mono-collector", "-c", profile,
    "--", process.execPath, "-e", launcher, JSON.stringify({ probe, probeMarker, command, args })];
  const result = await runCaptured("codex", sandboxArgs, repo, { ...env, TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot });
  return { ...result, command, args, output: result.output + (reviewArtifacts ? "" : "\n" + result.diagnosticTail),
    ...(reviewArtifacts ? { json: fs.existsSync(jsonFile) ? readJson(jsonFile) : null,
      status: fs.existsSync(statusFile) ? readJson(statusFile) : null } : {}),
    sandbox: { command: "codex", args: sandboxArgs, mode: "workspace-write", tempRoot,
      probed: result.output.split("\n").includes(probeMarker) } };
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
}
function evidenceKey(directory, create) {
  const file = path.join(directory, "receipt.key");
  if (create && !fs.existsSync(file)) {
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(fd, crypto.randomBytes(32)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  const key = fs.readFileSync(file);
  requireThat(key.length === 32, "invalid tool receipt key"); return key;
}
const sign = (key, value) => crypto.createHmac("sha256", key).update(canonical(value)).digest("hex");
const ROUND_LIMIT_REACHED = `review round limit reached (${ROUND_LIMIT} of ${ROUND_LIMIT} on this pins file); narrow the contract, split or change approach`;
const NOT_REVIEWED_TWICE = "not-reviewed twice in a row on this head; check that both review CLIs are logged in";
// Other issues' and older receipts share this folder: only this pins file is read further;
// unreadable or unsigned files are skipped, never counted.
function signedHistory(evidenceRoot, pinsFile) {
  const history = path.join(evidenceRoot, "history");
  if (!fs.existsSync(history) || !fs.existsSync(path.join(evidenceRoot, "receipt.key"))) return [];
  const key = evidenceKey(evidenceRoot, false);
  return fs.readdirSync(history).filter(name => name.endsWith(".json")).flatMap(name => {
    try {
      const envelope = readJson(path.join(history, name));
      return envelope.receipt?.pins?.file === pinsFile && envelope.signature === sign(key, envelope.receipt) ? [envelope.receipt] : [];
    } catch { return []; }
  });
}

function preflightEvidenceRoot(request) {
  const evidenceRoot = validateEvidenceGrants(request.evidenceRoot, [request.worktree, request.root, ...(request.workerWritableRoots ?? [])]);
  if (request.collect === true) fs.mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  requireThat(fs.realpathSync(evidenceRoot) === evidenceRoot, "evidence root changed during resolution");
  return evidenceRoot;
}
function regularEvidence(file) {
  requireThat(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), "evidence file must be a regular file in evidenceRoot");
}
const fileDigest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function reviewDatasetBinding(request, evidenceRoot) {
  if (request.reviewDataset === undefined) return { reviewDataset: null };
  const file = request.reviewDataset;
  requireThat(typeof file === "string" && path.isAbsolute(file), "reviewDataset must be an absolute path under evidenceRoot");
  requireThat(fs.realpathSync(file).startsWith(evidenceRoot + path.sep), "reviewDataset must be under evidenceRoot");
  regularEvidence(file);
  const digest = fileDigest(file);
  return { reviewDataset: { source: file, digest, copy: `.orchestrator/review-dataset-${digest.slice(0, 8)}.md` } };
}
function publishImmutable(file, data) {
  const staging = fs.mkdtempSync(path.join(path.dirname(file), ".dataset-stage-"));
  const staged = path.join(staging, "content");
  try {
    const fd = fs.openSync(staged, "wx", 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // Linking a completed file publishes it without replacing an existing version.
    fs.linkSync(staged, file);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
export async function archiveReviewDataset(source, evidenceRoot) {
  regularEvidence(source);
  const name = path.basename(source);
  const match = /^(.+?)(?:\.v([1-9][0-9]*))?\.md$/.exec(name);
  requireThat(match && /^[A-Za-z0-9_-]+$/.test(match[1]), "invalid dataset archive name");
  const directory = path.join(fs.realpathSync(evidenceRoot), "datasets");
  fs.mkdirSync(directory, { recursive: true });
  requireThat(fs.realpathSync(directory) === directory, "dataset archive directory must not be a symlink");
  return withLock(path.join(directory, `${match[1]}.archive.lock`), () => {
    const bytes = fs.readFileSync(source), hash = crypto.createHash("sha256").update(bytes).digest("hex");
    let highest = 0, existing = null;
    for (const file of fs.readdirSync(directory).sort()) {
      if (!file.startsWith(`${match[1]}.v`) || !file.endsWith(".md")) continue;
      const version = Number(file.slice(match[1].length + 2, -3));
      if (!Number.isSafeInteger(version) || version < 1) continue;
      const archive = path.join(directory, file); regularEvidence(archive);
      const digest = fileDigest(archive);
      if (!fs.existsSync(archive + ".sha256")) {
        requireThat(digest === hash, "orphan dataset archive differs from source; digest recovery refused");
        publishImmutable(archive + ".sha256", digest + "\n");
      }
      regularEvidence(archive + ".sha256");
      requireThat(fs.readFileSync(archive + ".sha256", "utf8").trim() === digest, "immutable dataset archive digest mismatch");
      highest = Math.max(highest, version);
      if (digest === hash && (!match[2] || version === Number(match[2]))) existing = { version, digest, archive };
      if (match[2] && version === Number(match[2])) requireThat(digest === hash, "immutable dataset version cannot be overwritten");
    }
    if (existing) return existing;
    const version = match[2] ? Number(match[2]) : highest + 1;
    const archive = path.join(directory, `${match[1]}.v${version}.md`);
    publishImmutable(archive, bytes);
    publishImmutable(archive + ".sha256", hash + "\n");
    return { version, digest: hash, archive };
  });
}
export async function preflightGate(request) {
  if (request.collect !== true) {
    const proof = await verifyPreflight(request, null, true);
    return proof.publishRequest ? proof : proof.reason;
  }
  requireThat(/^[a-f0-9]{40}$/.test(request.head), "dispatch head required");
  const root = preflightEvidenceRoot(request);
  return withLock(path.join(root, `${request.head}.collect.lock`), async () => (await verifyPreflight(request)).reason);
}
function reviewBaseTip(repo, baseRef, liveTip) {
  const ref = git(repo, "rev-parse", "--symbolic-full-name", baseRef);
  if (ref.startsWith("refs/remotes/")) {
    const remote = git(repo, "remote").split("\n").sort((a, b) => b.length - a.length)
      .find(name => name && ref.startsWith(`refs/remotes/${name}/`));
    requireThat(remote, "review base remote unavailable");
    const branch = ref.slice(`refs/remotes/${remote}/`.length);
    git(repo, "fetch", "--no-tags", "--no-recurse-submodules", remote, `+refs/heads/${branch}:${ref}`);
    if (liveTip) {
      try { git(repo, "rev-parse", "--verify", `${liveTip}^{commit}`); }
      catch {
        git(repo, "fetch", "--no-tags", "--no-recurse-submodules", remote, liveTip);
      }
    }
  }
  return git(repo, "rev-parse", "--verify", `${liveTip ?? baseRef}^{commit}`);
}
async function verifyPreflight(request, live = null, allowPending = false) {
  const pins = checkCollectionRequest(request);
  if (live) {
    requireThat(request.head === live.head, "preflight request does not match live PR head");
    requireThat(/^[a-f0-9]{40}$/.test(live.baseRefOid ?? ""), "live PR base unavailable");
  }
  requireThat(typeof request.collect === "boolean", "explicit collect mode required (worker: false; orchestrator: true)");
  requireThat(typeof request.product === "string" && request.product.trim(), "dispatch product required");
  requireThat(new RegExp(`^preflight-collect:${request.head}:[1-9][0-9]*$`).test(request.collectionId ?? ""), "collectionId must be preflight-collect:<head>:<n>");
  requireThat(path.isAbsolute(request.skillsRoot ?? ""), "absolute installed skillsRoot required");
  requireThat(Array.isArray(request.workerWritableRoots), "dispatch workerWritableRoots required");
  if (request.packRoot) packLayout(request.packRoot);
  requireThat(request.verification && Object.keys(request.verification).sort().join(",") === "args,command" &&
    typeof request.verification.command === "string" && request.verification.command.trim() &&
    Array.isArray(request.verification.args) && request.verification.args.every(arg => typeof arg === "string"),
    "verification must contain only command and string-array args");
  requireThat(request.critical === null || (typeof request.critical === "string" && request.critical.trim()), "dispatch critical must be null or an escalation reason");
  requireThat(/^[a-f0-9]{40}$/.test(request.head), "dispatch head required");
  const evidenceRoot = preflightEvidenceRoot(request);
  validateEvidenceGrants(request.packRoot ?? request.skillsRoot, request.workerWritableRoots, 'packRoot');
  validateEvidenceGrants(request.skillsRoot, request.workerWritableRoots, 'autoreview skillsRoot');
  const repo = fs.realpathSync(request.worktree);
  cleanTree(repo);
  const head = git(repo, "rev-parse", "HEAD");
  if (pins && head !== request.head) throw new Error(`collection request mismatch: head; expected ${canonical(head)}`);
  if (pins && !new RegExp(`^preflight-collect:${head}:[1-9][0-9]*$`).test(request.collectionId ?? ""))
    throw new Error(`collection request mismatch: collectionId; expected ${canonical(`preflight-collect:${head}:<n>`)}`);
  requireThat(head === request.head, "head differs from collection/verification request");
  const baseTip = reviewBaseTip(repo, request.baseRef, live?.baseRefOid);
  const base = git(repo, "merge-base", head, baseTip);
  const policyBase = pins?.base ?? base;
  const landing = validateLanding(baseModelConfig(repo, policyBase));
  if (landing?.serialPaths !== undefined) {
    requireThat(pins && request.pins, "landing policy requires pinned dispatch");
    requireThat(git(repo, "merge-base", base, policyBase) === policyBase, "landing policy base is not an ancestor of the review base");
    if (pins.release !== true) {
      const touched = changedPaths(repo, base, head).find(file => landing.serialPaths.some(serial =>
        serial.endsWith("/") ? file.startsWith(serial) : file === serial));
      const action = landing.changelog ? `write ${landing.changelog.fragmentDir.replace(/\/$/, "")}/<KEY>.md or dispatch a release task` : "dispatch a release task";
      requireThat(!touched, `serial path touched: ${touched}; landing.serialPaths on ${policyBase}; ${action}`);
    }
  }
  const pinnedIssue = request.pins ? /^([A-Z][A-Z0-9]*-[1-9][0-9]*)-a[1-9][0-9]*$/.exec(path.basename(path.dirname(request.pins.file)))?.[1] : null;
  if (request.issue !== undefined) requireThat(/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(request.issue) &&
    (!pinnedIssue || request.issue === pinnedIssue), "explicit Issue must match the pinned attempt");
  const idea = pins?.idea ? verifyIdeaArtifact(pins.idea, pinnedIssue ?? request.issue) : null;
  const receiptFile = path.join(evidenceRoot, `${head}.json`);
  const dataset = reviewDatasetBinding(request, evidenceRoot);
  const binding = { ...dataset, ...(idea ? { idea } : {}), ...(request.issue !== undefined ? { issue: request.issue } : {}), ...(request.packRoot ? { packRoot: request.packRoot } : {}), ...(request.pins ? { pins: request.pins } : {}), ...(request.modelRoutes ? { modelRoutes: request.modelRoutes } : {}), product: request.product, collectionId: request.collectionId, skillsRoot: request.skillsRoot, risk: request.risk,
    critical: request.critical, root: fs.realpathSync(request.root), worktree: repo, evidenceRoot,
    workerWritableRoots: request.workerWritableRoots.map(resolvedLocation).sort() };
  // The task contract is the dispatch snapshot of the Issue (snapshot.vN after a full-snapshot amendment).
  // Read with this attempt's signed history only when a round may be requested or run.
  let contract = null, contractDigest = null;
  const priorRounds = () => {
    if (!pins || !request.pins) return null;
    const file = path.join(pins.fullSnapshot?.directory ?? path.join(path.dirname(request.pins.file), "snapshot"), `issue-${pinnedIssue}.md`);
    if (!pinnedIssue || !fs.existsSync(file)) return null;
    contract = fs.readFileSync(file, "utf8"); contractDigest = digest(contract);
    return reviewHistory(signedHistory(evidenceRoot, request.pins.file), { pins: request.pins, head, base, contractDigest });
  };
  let receipt, verifiedReceiptFile = receiptFile;
  if (request.collect === false) {
    const readSigned = file => {
      regularEvidence(file); regularEvidence(path.join(evidenceRoot, "receipt.key"));
      const envelope = readJson(file);
      requireThat(envelope.signature === sign(evidenceKey(evidenceRoot, false), envelope.receipt), "hand-made or modified review receipt");
      return envelope.receipt;
    };
    if (!pins) receipt = readSigned(receiptFile);
    else if (fs.existsSync(receiptFile)) receipt = readSigned(receiptFile);
    if (pins && receipt?.collectionId !== request.collectionId) {
      const history = path.join(evidenceRoot, "history");
      const matches = fs.existsSync(history) ? fs.readdirSync(history).filter(name => name.endsWith(".json"))
        .map(name => path.join(history, name)).filter(file => readJson(file).receipt?.collectionId === request.collectionId) : [];
      requireThat(matches.length <= 1, "multiple history receipts for collectionId");
      if (matches.length) { verifiedReceiptFile = matches[0]; receipt = readSigned(verifiedReceiptFile); }
      else receipt = null;
    }
    if (!receipt) {
      requireThat(allowPending, "missing or stale review receipt/head/base");
      // Refuse here, before the worker publishes a request that could only be refused.
      const prior = priorRounds();
      if (prior && !prior.reuse) {
        requireThat(prior.notReviewed < 2, `blocked: ${NOT_REVIEWED_TWICE}`);
        requireThat(prior.spent < ROUND_LIMIT, `needs-decision: ${ROUND_LIMIT_REACHED}`);
      }
      return { publishRequest: { ...request, collect: false } };
    }
    if (!request.pins && receipt.pins) throw new Error(`collection request mismatch: pins; expected ${canonical(receipt.pins)}`);
    requireThat(canonical(receipt.idea ?? null) === canonical(idea), 'receipt idea differs from dispatch pins');
    for (const [key, value] of Object.entries(binding)) {
      const actual = key === "reviewDataset" && receipt[key] ? { source: receipt[key].source, digest: receipt[key].digest, copy: receipt[key].copy } : receipt[key];
      requireThat(canonical(actual) === canonical(value), `receipt ${key} differs from dispatch request`);
    }
    if (receipt.reviewDataset?.version) {
      const archived = receipt.reviewDataset;
      requireThat(Number.isSafeInteger(archived.version) && archived.version > 0 && typeof archived.archive === "string" &&
        path.basename(archived.archive).endsWith(`.v${archived.version}.md`) && fs.realpathSync(archived.archive).startsWith(fs.realpathSync(evidenceRoot) + path.sep), "dataset archive outside evidence root or invalid version");
      regularEvidence(archived.archive); regularEvidence(archived.archive + ".sha256");
      requireThat(fileDigest(archived.archive) === archived.digest && fs.readFileSync(archived.archive + ".sha256", "utf8").trim() === archived.digest, "dataset archive digest mismatch");
    }
    requireThat(canonical({ command: receipt.verification?.command, args: receipt.verification?.args }) === canonical(request.verification), "receipt verification differs from dispatch request");
  }
  pinnedReviewRoute(request, base);
  validateEvidenceGrants(request.skillsRoot, [repo], "installed skillsRoot");
  const unchanged = () => {
    if (idea) verifyIdeaArtifact(idea, pinnedIssue ?? request.issue);
    requireThat(canonical(reviewDatasetBinding(request, evidenceRoot)) === canonical(dataset), "review dataset changed during collection/verification");
    cleanTree(repo);
    requireThat(git(repo, "rev-parse", "HEAD") === head && git(repo, "merge-base", head, live?.baseRefOid ?? request.baseRef) === base,
      "head or base changed during verification");
  };
  if (request.collect === true) {
    const recordedAt = new Date().toISOString();
    const protectedPaths = { "orchestrator root": request.root, skillsRoot: request.skillsRoot, packRoot: request.packRoot ?? request.skillsRoot };
    const archive = dataset.reviewDataset ? await archiveReviewDataset(dataset.reviewDataset.source, evidenceRoot) : null;
    if (archive) requireThat(archive.digest === dataset.reviewDataset.digest, "review dataset changed before archive");
    const prior = priorRounds();
    requireThat(prior, "review contract missing in the pinned dispatch snapshot (issue-<KEY>.md)");
    const consistency = { passed: true, error: null };
    const checkConsistency = () => {
      try { unchanged(); } catch (error) { consistency.passed = false; consistency.error ??= error.message; }
    };
    // Review first: a round is spent only by a completed round on a new head.
    let review;
    const refuse = reason => ({ outcome: 'refused', spent: false, round: null, reason, successors: [], record: null });
    if (prior.reuse) review = { ...prior.reuse.review, spent: false, reusedFrom: prior.reuse.runId };
    else if (prior.notReviewed >= 2) review = refuse(`blocked: ${NOT_REVIEWED_TWICE}`);
    else if (prior.spent >= ROUND_LIMIT) review = refuse(`needs-decision: ${ROUND_LIMIT_REACHED}`);
    else {
      const record = await runReviewRound({ worktree: repo, head, base, contract, risk: request.critical ? 'riskyCritical' : request.risk,
        config: baseModelConfig(repo, request.modelRoutes?.base ?? base), packRoot: path.resolve(scriptDir, '..'), ...(prior.record ? { stageRecord: prior.record } : {}) });
      const { costs, ...stageRecord } = record;
      review = record.outcome === 'not-reviewed'
        ? { outcome: 'not-reviewed', spent: false, round: null, repeated: prior.notReviewed > 0, reason: record.failures.at(-1)?.reason ?? `no readable text for ${record.unreviewedFiles.join(', ') || 'the review'}`,
          successors: [], record: null, failures: record.failures.slice(-6), costs }
        : { ...roundOutcome(record, prior.spent + 1 === ROUND_LIMIT), spent: true, round: prior.spent + 1, record: stageRecord };
    }
    review.contractDigest = contractDigest;
    checkConsistency();
    let verification = null;
    if (ACCEPTED.includes(review.outcome) && consistency.passed) {
      // A launch refusal is recorded, not thrown: the completed round must still be signed.
      try {
        verification = await runSandboxed(request.verification.command, request.verification.args, repo, evidenceRoot, { protectedPaths });
        checkConsistency();
        if (verification.exitCode !== 0 && verification.sandbox?.mode === 'workspace-write' && verification.sandbox.probed === true && consistency.passed) {
          const first = verification;
          verification = await runSandboxed(request.verification.command, request.verification.args, repo, evidenceRoot, { protectedPaths });
          verification.output = `Verification run 1 (exit ${first.exitCode}):\n${first.output}\nVerification run 2 (exit ${verification.exitCode}):\n${verification.output}`;
          // A successful rerun cannot attest an unprobed boundary.
          verification.sandbox.probed = first.sandbox.probed && verification.sandbox.probed;
          checkConsistency();
        }
      } catch (error) { consistency.passed = false; consistency.error ??= error.message; }
    }
    receipt = { producer: REVIEW_PRODUCER, recordedAt, ...binding, runId: crypto.randomUUID(), head, base, review,
      verification: verification ?? { command: request.verification.command, args: request.verification.args, exitCode: null }, consistency };
    if (archive) receipt.reviewDataset = { ...receipt.reviewDataset, ...archive };
    if (fs.existsSync(path.join(evidenceRoot, "receipt.key"))) regularEvidence(path.join(evidenceRoot, "receipt.key"));
    const key = evidenceKey(evidenceRoot, true);
    atomicJson(path.join(evidenceRoot, "history", `${receipt.runId}.json`), { receipt, signature: sign(key, receipt) });
    atomicJson(receiptFile, { receipt, signature: sign(key, receipt) });
  }
  const reason = validatePreflight(receipt, head, base);
  unchanged();
  return { reason, receipt: { path: verifiedReceiptFile, runId: receipt.runId, digest: digest(receipt) } };
}

export function readShipSnapshot(repo, number, deadline = Infinity) {
  const gh = (...args) => {
    const remaining = deadline - Date.now();
    requireThat(remaining > 0, "evidence-limit: предел доказательств");
    try {
      return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: Math.max(1, Math.min(60_000, remaining)) }));
    } catch (error) {
      requireThat(Date.now() < deadline, "evidence-limit: предел доказательств");
      let response;
      try { response = JSON.parse(error.stdout?.toString() ?? ""); } catch {}
      const status = Number(response?.status ?? error.stderr?.toString().match(/HTTP (\d{3})/)?.[1]) || null;
      const failure = new ShipPending(`GitHub read unavailable${status ? ` (HTTP ${status})` : ""}: ${response?.message ?? error.message}`);
      failure.httpStatus = status;
      throw failure;
    }
  };
  function graphql(query, variables) {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(variables)) if (value !== null) args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
    const data = gh(...args);
    if (data.errors) throw new ShipPending("GitHub GraphQL response incomplete");
    return data.data;
  }
  function pages(query, variables, select) {
    const nodes = []; let after = null;
    do {
      const connection = select(graphql(query, { ...variables, after }));
      requireThat(Array.isArray(connection?.nodes) && typeof connection.pageInfo?.hasNextPage === "boolean", "incomplete GitHub pagination");
      nodes.push(...connection.nodes);
      const next = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      requireThat(!connection.pageInfo.hasNextPage || (next && next !== after), "invalid GitHub pagination cursor"); after = next;
    } while (after);
    return nodes;
  }
  requireThat(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) && Number.isInteger(number) && number > 0, "repo and PR required");
  const [owner, name] = repo.split("/"); const variables = { owner, name, number };
  const pr = graphql('query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid state mergeStateStatus mergeable baseRefName baseRefOid baseRef{branchProtectionRule{requiredStatusCheckContexts}}}}}', variables).repository.pullRequest;
  requireThat(pr?.headRefOid, "PR not found");
  const head = pr.headRefOid;
  requireThat(pr.baseRefName, "PR base branch unavailable");
  let rules = [], rulesEvidence;
  try {
    rules = gh("api", `repos/${repo}/rules/branches/${pr.baseRefName.split("/").map(encodeURIComponent).join("/")}`);
    if (!Array.isArray(rules)) throw new ShipPending("branch rules response incomplete");
    rulesEvidence = { available: true, reason: null };
  } catch (error) {
    if (![403, 404].includes(error.httpStatus)) throw error;
    rulesEvidence = { available: false, reason: `rules unavailable on this plan/visibility (HTTP ${error.httpStatus})` };
  }
  const requiredChecks = [...new Set([
    ...(pr.baseRef?.branchProtectionRule?.requiredStatusCheckContexts ?? []),
    ...rules.filter(rule => rule.type === "required_status_checks").flatMap(rule => {
      requireThat(Array.isArray(rule.parameters?.required_status_checks), "required status rule incomplete");
      return rule.parameters.required_status_checks.map(check => check.context);
    }),
  ])];
  requireThat(requiredChecks.every(name => typeof name === "string" && name.trim()), "invalid required checks");
  const checks = pages('query($owner:String!,$name:String!,$head:GitObjectID!,$after:String){repository(owner:$owner,name:$name){object(oid:$head){... on Commit{statusCheckRollup{contexts(first:100,after:$after){nodes{__typename ... on CheckRun{name status conclusion startedAt completedAt checkSuite{commit{oid}}} ... on StatusContext{context state createdAt targetUrl}} pageInfo{hasNextPage endCursor}}}}}}}',
    { owner, name, head }, d => d.repository.object.statusCheckRollup?.contexts ?? { nodes: [], pageInfo: { hasNextPage: false } })
    .map(check => ({ ...check, head: check.__typename === "CheckRun" ? check.checkSuite?.commit?.oid : head }));
  const threads = pages('query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$after){nodes{id isResolved isOutdated} pageInfo{hasNextPage endCursor}}}}}', variables, d => d.repository.pullRequest.reviewThreads);
  for (const thread of threads) {
    thread.comments = pages('query($id:ID!,$after:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$after){nodes{id body publishedAt author{login} pullRequestReview{state}} pageInfo{hasNextPage endCursor}}}}}', { id: thread.id }, d => d.node.comments);
  }
  const viewer = gh("api", "user").login;
  const reviews = gh("api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/reviews`).flat();
  const comments = gh("api", "--paginate", "--slurp", `repos/${repo}/issues/${number}/comments`).flat();
  const botComments = [...comments, ...reviews].filter(comment => (comment.user?.type === "Bot" || /greptile|devin/i.test(comment.user?.login ?? "")) && comment.body?.trim())
    .map(comment => ({ id: comment.node_id, body: comment.body, updatedAt: comment.updated_at ?? comment.submitted_at }));
  const final = graphql('query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid state mergeStateStatus mergeable baseRefName baseRefOid baseRef{branchProtectionRule{requiredStatusCheckContexts}}}}}', variables).repository.pullRequest;
  requireThat(final.headRefOid === head && final.baseRefName === pr.baseRefName && final.baseRefOid === pr.baseRefOid && canonical(final.baseRef) === canonical(pr.baseRef), "head/base policy changed during GitHub read");
  return { ...final, head, rules: rulesEvidence, requiredChecks, checks, threads, viewer, reviews, botComments };
}

export function botRemarkDigest(comment) { return digest({ body: comment.body, updatedAt: comment.updatedAt ?? null }); }
export function evaluateShip(snapshot, judgment, policy = {}) {
  const s = snapshot;
  requireThat(s.state === "OPEN", "PR is not open");
  requireThat(judgment?.head === s.head, "judgment missing or stale");
  requireThat(judgment.preShipReview === "выполнено", "mandatory pre-ship review not performed");
  requireThat(judgment.readinessCheck === "пройдена", "readiness check not passed");
  requireThat(["выполнен на этой голове", "без изменений", "намеренно недоступен"].includes(judgment.documentation), "documentation outcome missing or invalid");
  requireThat(judgment.documentation !== "намеренно недоступен" || judgment.documentationReason?.trim(), "documentation unavailability requires a reason");
  requireThat(Array.isArray(s.checks), "check evidence unavailable");
  let pendingReason = s.checks.length ? null : "checks not created on head";
  const pending = reason => { pendingReason ??= reason; };
  const successful = new Set(), botSuccessful = new Set(), pendingChecks = new Set();
  let acceptedFailure = false;
  for (const check of s.checks) {
    const name = check.name ?? check.context;
    requireThat(check.head === s.head, `check ${name} belongs to an old head`);
    const pass = check.__typename === "CheckRun"
      ? check.status === "COMPLETED" && ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.conclusion)
      : check.__typename === "StatusContext" && check.state === "SUCCESS";
    const nonBlocking = policy.nonBlockingChecks?.find(item => item.name === name && item.reason?.trim());
    const terminal = check.__typename === "CheckRun" ? check.status === "COMPLETED" : ["SUCCESS", "FAILURE", "ERROR"].includes(check.state);
    const awaiting = check.__typename === "CheckRun"
      ? ["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"].includes(check.status)
      : check.__typename === "StatusContext" && ["PENDING", "EXPECTED"].includes(check.state);
    requireThat(pass || (nonBlocking && terminal) || awaiting, `check ${name} not green or accepted non-blocking`);
    if (awaiting) { pendingChecks.add(name); pending(`check ${name} pending on head`); }
    if (!pass && nonBlocking && terminal) acceptedFailure = true;
    if (pass) successful.add(name);
    if (pass && (check.__typename === "StatusContext" || check.conclusion === "SUCCESS")) botSuccessful.add(name);
  }
  for (const name of [...(s.requiredChecks ?? []), ...(policy.requiredChecks ?? [])]) {
    if (!s.checks.some(c => (c.name ?? c.context) === name) || pendingChecks.has(name)) pending(`required check ${name} absent or pending`);
    else requireThat(successful.has(name), `required check ${name} not successful`);
  }
  if (!policy.botUnavailable?.trim()) for (const name of policy.botChecks ?? ["Greptile Review"]) {
    if (!s.checks.some(c => (c.name ?? c.context) === name) || pendingChecks.has(name)) pending(`bot ${name} pending on head`);
    else requireThat(botSuccessful.has(name), `bot ${name} not completed on head`);
  }
  requireThat(s.viewer && Array.isArray(s.reviews), "own review state unavailable");
  requireThat(!s.reviews.some(review => review.state === "PENDING" && review.user?.login === s.viewer), "unpublished own PENDING review");
  const decisions = new Map();
  for (const review of [...s.reviews].sort((a, b) =>
    (Date.parse(a.submitted_at) || 0) - (Date.parse(b.submitted_at) || 0) || a.id - b.id)) {
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) continue;
    requireThat(review.user?.login && Number.isInteger(review.id), "review decision identity unavailable");
    decisions.set(review.user.login, review.state);
  }
  for (const [reviewer, decision] of decisions) requireThat(decision !== "CHANGES_REQUESTED", `outstanding changes requested by ${reviewer}`);
  requireThat(Array.isArray(s.threads) && Array.isArray(judgment.closures), "review thread/reply evidence missing");
  for (const thread of s.threads) {
    requireThat(thread.isResolved === true, `unresolved thread ${thread.id}`);
    const closure = judgment.closures.find(item => item.threadId === thread.id);
    const reply = thread.comments?.find(comment => comment.id === closure?.replyId);
    requireThat(reply && thread.comments.indexOf(reply) > 0 && reply.publishedAt && reply.body?.trim() &&
      reply.pullRequestReview?.state !== "PENDING", `closure reply for ${thread.id} is not published`);
  }
  requireThat(Array.isArray(s.botComments) && Array.isArray(judgment.botRemarks), "outside-thread bot remarks not inspected");
  for (const comment of s.botComments) {
    const disposition = judgment.botRemarks.find(item => item.id === comment.id);
    requireThat(disposition && ["fixed", "rejected", "deferred", "informational"].includes(disposition.outcome) && disposition.evidence?.trim(), `unaddressed bot remark ${comment.id}`);
    requireThat(disposition.commentDigest === botRemarkDigest(comment), `bot remark ${comment.id} changed since disposition`);
  }
  requireThat(s.mergeable !== "CONFLICTING" && !["DIRTY", "BEHIND", "DRAFT", "HAS_HOOKS"].includes(s.mergeStateStatus), "merge state is not clean");
  if (pendingReason && ["CLEAN", "UNSTABLE", "BLOCKED", "UNKNOWN"].includes(s.mergeStateStatus) &&
    ["MERGEABLE", "UNKNOWN"].includes(s.mergeable)) throw new ShipPending(pendingReason);
  if (s.mergeable === "UNKNOWN" || s.mergeStateStatus === "UNKNOWN") throw new ShipPending("mergeability pending (UNKNOWN)");
  requireThat(s.mergeable === "MERGEABLE" && (s.mergeStateStatus === "CLEAN" ||
    (s.mergeStateStatus === "UNSTABLE" && acceptedFailure)), "merge state is not clean");
  return "all ship conditions satisfied";
}
export function advanceEvidence(previous, snapshot, now) {
  const fingerprint = digest(snapshot);
  requireThat(!previous || (Number.isFinite(previous.startedAt) && previous.startedAt <= now && Number.isFinite(previous.lastEventAt) && previous.lastEventAt <= now), "invalid evidence clock");
  return { head: snapshot.head, fingerprint, startedAt: previous?.startedAt ?? now,
    lastEventAt: previous?.head === snapshot.head && previous.fingerprint === fingerprint ? previous.lastEventAt : now };
}
export function validateShipBotPolicy(policy = {}, trusted) {
  if (Object.hasOwn(policy, "botChecks")) requireThat(canonical(policy.botChecks) === canonical(trusted.botChecks), "worker botChecks differs from required bot policy");
  if (policy.botUnavailable != null && policy.botUnavailable !== "")
    requireThat(policy.botUnavailable === trusted.botUnavailable, "worker botUnavailable requires the current attempt orchestrator decision");
  return { ...policy, ...trusted };
}
export async function shipGate(request) {
  const config = deliveryConfig(request.config);
  requireThat(request.preflight?.collect === false, "ship requires preflight collect:false request");
  const trusted = pinnedShipPolicy(request.preflight) ?? {
    botChecks: shipBotChecks(baseModelConfig(request.preflight.worktree, request.preflight.modelRoutes?.base ??
      git(request.preflight.worktree, "merge-base", request.preflight.head, request.preflight.baseRef))), botUnavailable: null };
  const policy = validateShipBotPolicy(request.policy, trusted);
  requireThat(path.isAbsolute(request.stateFile ?? ""), "absolute evidence state file required");
  const scope = { repo: request.repo, number: request.number, attempt: request.attempt };
  requireThat(Number.isInteger(scope.attempt) && scope.attempt > 0, "attempt required");
  let previous = fs.existsSync(request.stateFile) ? readJson(request.stateFile) : null;
  requireThat(!previous || canonical(previous.scope) === canonical(scope), "evidence state belongs to another PR/attempt");
  if (!previous) {
    previous = { scope, head: null, startedAt: Date.now(), lastEventAt: Date.now(), fingerprint: null };
    atomicJson(request.stateFile, previous);
  }
  const deadline = previous.startedAt + config.evidenceLimitSec * 1000;
  while (true) {
    requireThat(Date.now() < deadline, "evidence-limit: предел доказательств");
    try {
      const snapshot = readShipSnapshot(request.repo, request.number, deadline);
      requireThat(request.preflight?.collect === false, "ship requires preflight collect:false request");
      const proof = await verifyPreflight(request.preflight, snapshot);
      const judgment = readJson(request.judgmentFile);
      const now = Date.now(); const state = { ...advanceEvidence(previous, { ...snapshot, preflightReceipt: proof.receipt, judgment, policy }, now), scope, preflightReceipt: proof.receipt, rules: snapshot.rules };
      atomicJson(request.stateFile, state); previous = state;
      requireThat(now - state.startedAt < config.evidenceLimitSec * 1000, "evidence-limit: предел доказательств");
      evaluateShip(snapshot, judgment, policy);
      if (now - state.lastEventAt >= config.quietSec * 1000) return `current-head evidence complete and quiet period passed; preflight receipt: ${proof.receipt.path}`;
      requireThat(request.watch === true, "current-head evidence quiet period pending");
    } catch (error) {
      if (!(error instanceof ShipPending) || request.watch !== true) throw error;
      previous = { ...previous, lastEventAt: Date.now(), pendingReason: error.message };
      atomicJson(request.stateFile, previous);
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(config.pollSec * 1000, 30_000, deadline - Date.now()))));
  }
}
if (isMain(import.meta.url)) {
  const [name, ...rest] = process.argv.slice(2);
  try {
    const args = flags(rest);
    if (name === "--help" || args.help) console.log(`Usage: gate.mjs start|preflight|ship --request <json>
start request: {worktree, branch, base, packRoot, skillsRoot, packVersion, sourceCommit, surfaceRevision}
  Generated dispatch adds {root,issue,attempt,risk,critical,pins:{file,digest}}; start verifies the active registered attempt and current pins before code.
  The orchestrator's locked pre-launch invocation uses --before-spawn true for the next unregistered attempt; worker invocation omits it.
preflight request: {product,collectionId,root,worktree,head,issue?,skillsRoot,risk,critical,baseRef,evidenceRoot,workerWritableRoots:[],reviewDataset?,reviewDatasetVersion?,pins?:{file,digest},modelRoutes?,collect,verification:{command,args}}
  modelRoutes pins immutable base/configDigest/roles from resolveModelRoutes; overrides require pins.
  risk is the final approved/diff risk; critical is a concrete escalation reason or null.
  Pin every request field from dispatch. Orchestrator only: collect:true, outside worker sandboxes.
  Worker only: collect:false, reads <evidenceRoot>/<head>.json without creating files.
  U13 attempts require registered pins and reviewDatasetVersion (0 without a dataset; omit reviewDataset).
  Pending worker collection exits 2 with publishRequest; publish exactly that request. Pass exits 0; refusal exits 1.
  Use ~/.mono-agent-workflow/evidence/<product>/ outside EVERY worker-writable root,
  including worktree, orchestrator root and additional workerWritableRoots. Pin that list in dispatch.
  Verification grants the worktree and one private temp directory per invocation, on macOS also the validated Darwin user temp root when available. workerWritableRoots never becomes collector grants.
  collect:true runs the read-only review round first (reviewer and checker from different model families, both CLIs logged in by subscription),
  then verification with evidence-write denial probes only after clean or clean-with-successors; one signed gate-review-v3 receipt per collectionId.
  At most three completed rounds per pins file, counted from signed history; the same head reuses its round; not-reviewed spends nothing.
  Refusals are signed too: fix and request the next round, or park on a needs-decision:/blocked: line. Sandbox failure fails closed.
  The sandbox write boundary is the trust anchor; the key may be readable but receipts are not worker-writable.
ship request: {preflight:<complete preflight collect:false request>, repo:"owner/repo", number:123, attempt:1, stateFile:"/absolute/file", judgmentFile:"/absolute/file", config:"/project/.agents/mono-workflow.config.json", watch:true, policy:{requiredChecks:[],nonBlockingChecks:[{name,reason}],botChecks:["Greptile Review"],botUnavailable:null}}
  Refresh remote-tracking baseRef; bind receipts to head/merge-base, not the moving base tip.
  Ship uses the live PR base tip for merge-base; require that sealed proof before judgment and record its path.
  Required bots come from immutable attempt pins (orchestration.ship.botChecks, default Greptile Review).
  Worker botChecks must match; botUnavailable requires accept.mjs amend --bot-unavailable for this task attempt.
  Other policy exceptions must come from the repository's accepted policy, never worker convenience.
  judgment: {head,preShipReview:"выполнено",readinessCheck:"пройдена",documentation:"выполнен на этой голове|без изменений|намеренно недоступен",documentationReason,closures:[{threadId,replyId}],botRemarks:[{id,commentDigest,outcome:"fixed|rejected|deferred|informational",evidence}]}
  Compute commentDigest with exported botRemarkDigest(comment) on each latest readShipSnapshot bot comment; re-inspect any edited comment.
  config.orchestration.delivery: confirmationTimeoutSec=1800, quietSec=120,
  evidenceLimitSec=2400, pollSec=10, attemptCap=3. Positive seconds/counts only.
  Never delete stateFile to reset a deadline. An orchestrator ship-fix amendment names the next ship-gate attempt;
  use a new stateFile for the new head, preserve the old file, and keep the same task attempt. No ship-gate attempt cap.`);
    else {
      requireThat(["start", "preflight", "ship"].includes(name), "unknown gate");
      const request = readJson(args.request);
      const reason = name === "start" ? startGate(request, { beforeSpawn: args['before-spawn'] === 'true' }) : name === "preflight" ? await preflightGate(request) : await shipGate(request);
      if (name === "preflight" && reason.publishRequest) {
        console.log(`gate preflight: pending: ${reason.publishRequest.collectionId}`);
        console.log(JSON.stringify(reason)); process.exitCode = 2;
      } else console.log(`gate ${name}: pass: ${reason}`);
    }
  } catch (error) { console.log(`gate ${name}: fail: ${error.message.replace(/\s+/g, " ")}`); process.exitCode = 1; }
}
