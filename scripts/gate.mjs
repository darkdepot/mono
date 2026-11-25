#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { atomicJson, canonical, digest, readJson, flags, identity, isMain, processStart, deliveryConfig, shipBotChecks, withLock, resolvedLocation, validateEvidenceGrants, resolveRole, baseModelConfig, validateLanding, changedPaths, packLayout, REVIEW_PRODUCER, REVIEW_ROUND_ROLES } from "./runtime.mjs";
import { checkCollectionRequest, pinnedShipPolicy, verifyIdeaArtifact, effectivePins, collectionPinsBinding, sha256File, taskChanges, reviewRetries, extraRounds } from "./orchestrator/command-state.mjs";

import { runReviewRound, prRemarkFindings, STRICT_DANGER } from './code-review.mjs';
import { hostRunMarker, hostRunCheckout, removeHostCheckout, openHostRun, settleHostRun, stopHostGroup, screenCheckHold, readScreenCheck } from './review-rounds.mjs';

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

// Launch pins bind the review round roles (code-review, code-review-checker); an attempt launched by an
// older pack pinned the legacy reviewer route instead and stays valid. Every pinned role must still resolve
// to its fingerprint on the pinned BASE config.
export function verifyModelPins(request, base) {
  const pins = request.modelRoutes;
  const config = baseModelConfig(request.worktree, pins?.base ?? base);
  if (pins) {
    requireThat(git(request.worktree, 'merge-base', base, pins.base) === pins.base, 'model route base is not an ancestor of the review base');
    const reviewer = REVIEW_ROUND_ROLES.every(role => pins.roles?.[role]) || pins.roles?.autoreview;
    requireThat(pins.configDigest === digest(config) && reviewer, 'model route config fingerprint mismatch');
    for (const [role, route] of Object.entries(pins.roles)) requireThat(canonical(route) === canonical(resolveRole(role, config, { packRoot: request.packRoot, skillsRoot: request.skillsRoot })), `model route fingerprint mismatch: ${role}`);
  } else requireThat(config.models === undefined, 'modelRoutes launch pins required for product model overrides');
  requireThat(['tiny', 'standard', 'deep', 'risky'].includes(request.risk) && (!request.critical || request.risk === 'risky'), 'unresolved final risk route');
}
export const ROUND_LIMIT = 3;
// The pinned risk sets the rounds: the strict path (risky) up to ROUND_LIMIT; the fast path one round,
// after which the worker fixes, runs the full verification and the gate accepts that head on its word.
export const roundLimit = risk => risk === 'risky' ? ROUND_LIMIT : 1;
const ACCEPTED = ['clean', 'clean-with-successors'];
const findingLine = finding => `${finding.weight} ${finding.file}:${finding.line} ${finding.title}`;
// The worker fixes from this line alone: it may not be able to read the receipt.
const clip = (text, limit) => { const flat = String(text ?? '').replace(/\s+/g, ' ').trim(); return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat; };
const openLine = finding => `${findingLine(finding)} (when: ${clip(finding.trigger, 200) || 'n/a'}; why: ${clip(finding.reason, 300) || 'n/a'})`;
const leftover = record => (record?.findings ?? []).filter(finding => !['closed', 'rejected'].includes(finding.status));
// MONO-491: the reviewer may report one defect twice (two keys, different class wording); the checker names one common
// cause and fix with mergeKey. Open findings it merged in one batch (same key on the same checked head) count once;
// a record without a key is its own item. Only open members form the item, so a closed one never closes an open one;
// it shows its heaviest open member (P0 first). Decisions about what may leave the rounds still read every member.
const weightRank = finding => /^P[0-3]$/.test(finding.weight) ? Number(finding.weight[1]) : -1;
const mergeGroup = (finding, index) => typeof finding.mergeKey === 'string' && finding.mergeKey && typeof finding.lastCheckedHead === 'string'
  ? `merge\0${finding.lastCheckedHead}\0${finding.mergeKey}` : `own\0${index}`;
const openItems = findings => {
  const groups = new Map();
  findings.forEach((finding, index) => { const id = mergeGroup(finding, index); groups.set(id, [...(groups.get(id) ?? []), finding]); });
  return [...groups.values()].map(members => ({ ...members.reduce((top, item) => weightRank(item) < weightRank(top) ? item : top), members }));
};
const openDefects = record => openItems(leftover(record));
// Rounds are counted per task attempt from receipt history; a task change continues the record. The strict path
// keeps the count; the fast path has one round per contract (onContract: rounds on the current one).
// receipts: history in evidenceRoot, any producer or issue. reuse: a completed round on this exact head.
const sameAttempt = (file, pinsFile) => typeof file === 'string' && path.dirname(file) === path.dirname(pinsFile);
// MONO-483: a not-reviewed receipt names its cause; an old one without it counts as the work's own.
const notReviewedCause = receipt => receipt.review.cause === 'environment' ? 'environment' : 'review';
export function reviewHistory(receipts, { pins, head, base, contractDigest, retries = [], now = new Date().toISOString() }) {
  const mine = receipts.filter(receipt => receipt?.producer === REVIEW_PRODUCER && sameAttempt(receipt.pins?.file, pins.file) && receipt.review)
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
  const completed = mine.filter(receipt => receipt.review.spent === true);
  const same = receipt => receipt.base === base && receipt.review.contractDigest === contractDigest;
  // A not-reviewed streak belongs to one contract: a task change after restoring the CLIs may try again.
  const onHead = mine.filter(receipt => receipt.head === head && receipt.pins.file === pins.file && receipt.review.outcome !== 'refused' &&
    receipt.review.contractDigest === contractDigest);
  let start = onHead.length;
  while (start > 0 && onHead[start - 1].review.outcome === 'not-reviewed') start--;
  // MONO-483: a review retry (resume with reviewRetry, recorded on the host) cuts the streak where it was recorded,
  // only when everything before it in the streak failed on the environment. It never accepts a head or spends a round.
  let streak = onHead.slice(start);
  // A retry dated later than now (the collection judging it) is no delivered resume: it never counts.
  // A retry voided after a refused startup never counts either.
  retries = retries.filter(retry => typeof retry?.recordedAt === 'string' && retry.recordedAt <= now && retry.void === undefined);
  for (let index = streak.length - 1; index >= 0; index--) {
    const after = streak[index].recordedAt, next = streak[index + 1]?.recordedAt;
    const cut = retries.some(retry => String(retry.recordedAt) > String(after) && (next === undefined || String(retry.recordedAt) < String(next)));
    if (cut && streak.slice(0, index + 1).every(receipt => notReviewedCause(receipt) === 'environment')) { streak = streak.slice(index + 1); break; }
  }
  const causes = streak.flatMap(receipt => (receipt.review.failures ?? []).filter(failure => failure?.role && failure.cause).map(failure => failure.cause));
  return { spent: completed.length, onContract: completed.filter(receipt => receipt.review.contractDigest === contractDigest).length, notReviewed: streak.length,
    notReviewedCause: streak.length ? (streak.every(receipt => notReviewedCause(receipt) === 'environment') ? 'environment' : 'review') : null,
    notReviewedCauses: [...new Set(causes)],
    reuse: completed.findLast(receipt => receipt.head === head && same(receipt)) ?? null,
    record: completed.findLast(receipt => receipt.base === base)?.review.record ?? null };
}
// MONO-482: one extra round per attempt on the strict path. The orchestrator asks for it with resume extraRound
// {reason} once the attempt's rounds are spent; resume records it in extra-round.json beside the launch pins (host-only,
// outside every worker grant), bound to the attempt's last spent receipt. Open findings are the last round's leftovers
// except the successor candidates of an accepted round; a raised risk or out-of-contract work (open or closed) and an
// open owner remark on the PR never qualify.
const spentReceipts = (receipts, pinsFile) => receipts.filter(receipt => receipt?.producer === REVIEW_PRODUCER && sameAttempt(receipt.pins?.file, pinsFile) &&
  receipt.review?.spent === true).sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
const effectiveGrants = grants => (grants ?? []).filter(grant => grant?.void === undefined);
export function extraRoundRefusal(receipts, { pins, risk, grants = [] }) {
  const refuse = refusal => ({ refusal, receipt: null });
  if (risk !== 'risky') return refuse("the extra round is for the strict path (risky) only; the fast path finishes on the worker's full verification");
  const spent = spentReceipts(receipts, pins.file);
  if (effectiveGrants(grants).length || spent.length > ROUND_LIMIT) return refuse('one extra round per attempt and this attempt already has it; split the Issue or change approach in a new attempt');
  if (spent.length < ROUND_LIMIT) return refuse(`rounds left (${spent.length} of ${ROUND_LIMIT} spent); request the next round without extraRound`);
  const last = spent.at(-1), findings = last.review.record?.findings ?? [];
  if (findings.some(finding => finding.outOfContract || finding.riskRaised)) return refuse("the last round raised the risk or found work outside the contract; that is the orchestrator's decision, not an extra round");
  const successors = ACCEPTED.includes(last.review.outcome) ? new Set((last.review.successors ?? []).flatMap(item => item.keys ?? [item.key])) : new Set();
  const open = openDefects(last.review.record).filter(item => !item.members.every(finding => successors.has(finding.key)));
  if (open.some(item => item.members.some(finding => finding.class === 'pr-remark' && finding.source === 'owner'))) return refuse('an owner remark on the PR is open; do it or ask the owner');
  if (open.length > 1) return refuse(`${open.length} findings open; the extra round is for at most one`);
  return { refusal: null, receipt: last.runId };
}
// The gate counts a grant only bound to this attempt's ROUND_LIMIT-th spent receipt, delivered before the judging
// collection and not voided by a refused startup; a new attempt has its own pins directory and no grant.
export function extraRoundGranted(receipts, { pins, grants = [], now = new Date().toISOString() }) {
  const bound = spentReceipts(receipts, pins.file)[ROUND_LIMIT - 1];
  return !!bound && effectiveGrants(grants).some(grant => typeof grant.recordedAt === 'string' && grant.recordedAt <= now && grant.receipt === bound.runId);
}
// The host-side check before resume records the grant: reads the attempt's pins, receipts and grants.
export function extraRoundCheck(pinsFile) {
  const pins = readJson(pinsFile);
  const { refusal, receipt } = extraRoundRefusal(receiptHistory(pins.evidenceRoot, pinsFile), { pins: { file: pinsFile }, risk: pins.risk, grants: extraRounds(path.dirname(pinsFile)) });
  if (refusal) throw new Error(`extraRound refused: ${refusal}`);
  return { receipt };
}
// What may leave the rounds as a successor candidate instead of blocking the PR:
// - an older defect the task did not introduce (any round); on the strict path only a harmless one;
// - a minor (P3) leftover once the first fixes are in (round 2 on), unless it is about data, security or a gate letting work through;
// - on the last round also any leftover both roles call harmless.
// Everything else open means "fix and ask again", and on the last round stays not-converged.
export function roundOutcome(record, round, strict = false) {
  const open = leftover(record), settled = finding => finding.outcome !== 'unresolved';
  const harmful = finding => finding.danger !== false && (finding.weight !== 'P3' || STRICT_DANGER.includes(finding.dangerCase));
  const older = finding => finding.origin === 'pre-existing' && settled(finding) && !(strict && harmful(finding));
  const minor = finding => round > 1 && finding.weight === 'P3' && !STRICT_DANGER.includes(finding.dangerCase);
  // An older dangerous defect is filed after merge, not left to choice, unless it is a minor one outside the strict cases.
  const mustFile = finding => older(finding) && harmful(finding);
  const harmless = finding => round >= ROUND_LIMIT && finding.danger === false && settled(finding);
  // An owner's instruction on the PR is done in the round or asked about; it never becomes a successor.
  const ownerRemark = finding => finding.class === 'pr-remark' && finding.source === 'owner';
  const stands = !open.length || record.findings.some(finding => finding.outOfContract || finding.riskRaised) || open.some(ownerRemark) ||
    !open.every(finding => older(finding) || minor(finding) || harmless(finding));
  // A clean round may still carry older harmless defects: they are listed, never dropped.
  if (!['not-converged', 'clean'].includes(record.outcome) || stands) return { outcome: record.outcome, successors: [] };
  return { outcome: 'clean-with-successors', successors: openItems(open).map(item => ({ key: item.key, origin: item.origin,
    ...(item.members.length > 1 ? { keys: item.members.map(finding => finding.key) } : {}),
    line: `${item.members.some(mustFile) ? 'must-file ' : ''}${findingLine(item)}` })) };
}
function reviewRefusal(review, host = false, risk = undefined) {
  if (review.outcome === 'refused') return review.reason;
  if (review.outcome === 'not-reviewed') return review.repeated
    ? `blocked: ${notReviewedTwice(review.streakCause ?? review.cause, review.causes)}: ${review.reason}`
    : `not-reviewed: ${review.reason}; no round spent, request this head once more`;
  // The collector reads the last 64 KiB of gate output: keep the line inside it and say what was left out.
  const limit = review.limit ?? ROUND_LIMIT;
  const all = openDefects(review.record).map(openLine), round = roundText(review.round, limit), open = [];
  for (const line of all) { if (open.join('; ').length + line.length > 40000) break; open.push(line); }
  const list = `${all.length} open: ${open.join('; ')}${open.length < all.length ? `; ${all.length - open.length} more in the next round` : ''}`;
  if (review.round < limit) return `review not-converged (${round}); fix and request the next round; ${list}`;
  if (!strictPath(risk, limit)) return `review not-converged (${round}); ${host ? HOST_FAST_FIX : FAST_FIX}; ${list}`;
  return limit > ROUND_LIMIT ? `needs-decision: review not-converged after round ${review.round} of ${limit} (extra round used); ${list}`
    : `needs-decision: review not-converged after ${round}; ${list}; ${EXTRA_HINT}`;
}
// MONO-482: strictness comes from the pinned risk (older receipts without it: from their limit, the fast path has one round).
const strictPath = (risk, limit) => risk === undefined ? limit >= ROUND_LIMIT : risk === 'risky';
const roundText = (round, limit) => `round ${round} of ${limit}${round > ROUND_LIMIT ? ', extra' : ''}`;
const EXTRA_HINT = 'the orchestrator may resume with extraRound for one extra round in this attempt if at most one finding is open and none raised the risk, ' +
  'left the contract or is an open owner remark on the PR; otherwise split the Issue or change approach in a new attempt';
const FAST_FIX = 'fix, run the full verification on the final head and request it with workerVerification {head, exitCode: 0}';
const HOST_FAST_FIX = 'fix and request the final head; the collection runs the full verification on the host';
// The worker cannot rerun a check that needs the host (process table): it fixes from this line and the log.
const hostFailure = verification => `verification failed on this head on the host (exit ${verification.exitCode}); fix and request again, ` +
  `the same head too for a flaky run; log ${verification.log}${verification.tail ? `; tail: ${clip(verification.tail.slice(-2000), 2000)}` : ''}`;
// The failing lines (test runner and verify summaries) say more than the last lines of a parallel run.
const failureLines = text => text.split("\n").filter(line => /^\s*(FAIL\b|not ok\b|✖)|AssertionError|Error:/.test(line)).join("\n");
// Pinned hostVerification: the product's full verification needs the host (for example the process table),
// so the collection runs it on the committed head outside the worker sandbox, before the review round.
// It runs worker-authored code with host rights: the owner opts in per product. The run gets a clean checkout of
// exactly the request's head (a fresh repository beside the marker, outside every worker grant, reading objects
// from the worker repository but none of its configuration, hooks, filters or sparse patterns; only committed
// files, so untracked inputs such as node_modules are the command's own job), its own process group and a
// private temporary directory; the worker's working copy never feeds the result. The marker (review-rounds.mjs) holds the evidence snapshot and,
// before the command is released, the group: a receipt of that collection is not trusted while it exists,
// the group is stopped as a whole and the evidence settled when the command exits (here) or after a gate
// that died mid-run (collector recovery).
// Inherited Git routing would point the command's Git back at the worker repository whatever its directory.
const GIT_ROUTING = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_PREFIX"];
export async function runHostVerification({ command, args }, repo, head, evidenceRoot, collectionId, pinsFile) {
  const marker = hostRunMarker(evidenceRoot, collectionId), log = marker.replace(/\.running$/, ".log"), checkout = hostRunCheckout(evidenceRoot, collectionId);
  // MONO-482 review: one host run per orchestrator root; another open run refuses this one before anything runs.
  try { openHostRun(evidenceRoot, collectionId, pinsFile); }
  catch (error) { if (error.code === "EHOSTRUN") return { command, args, host: true, head, exitCode: null, busy: error.message }; throw error; }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-host-verify-"));
  const fd = fs.openSync(log, "w", 0o644);
  const startedAt = Date.now();
  // The checkout goes only once nothing of the run can still use it; otherwise recovery removes it after the group stop.
  let stopped = false;
  // The wrapper leads the group and runs the command only after "go": the group is durable in the marker first,
  // and a gate that dies before that closes stdin, so nothing unregistered runs.
  // Fixed code: the command arrives as data in argv, never inside the code.
  const wrapper = `(async()=>{let token="";for await(const chunk of process.stdin)token+=chunk;if(token!=="go\\n")process.exit(1);
const [command,...args]=JSON.parse(process.argv[1]);
const r=require("node:child_process").spawnSync(command,args,{stdio:["ignore","inherit","inherit"]});
if(r.error)console.error(r.error.message);process.exit(r.status??(r.signal?128:1));})()`;
  try {
    // The marker exists before the checkout, so a gate that dies here leaves it to collector recovery.
    try {
      removeHostCheckout(evidenceRoot, collectionId);
      const objects = path.resolve(repo, git(repo, "rev-parse", "--git-common-dir"), "objects");
      fs.mkdirSync(checkout, { recursive: true });
      execFileSync("git", [...safeGitArgs, "init", "--quiet", "--template="], { cwd: checkout, env: safeGitEnv(), stdio: "ignore" });
      fs.writeFileSync(path.join(checkout, ".git/objects/info/alternates"), objects + "\n");
      git(checkout, "-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", head);
      requireThat(git(checkout, "rev-parse", "HEAD") === head && git(checkout, "status", "--porcelain", "--untracked-files=all") === "", "the checkout is not the clean head");
    } catch (cause) {
      const error = `clean checkout of the head failed: ${cause.message}`;
      fs.writeSync(fd, error + "\n"); stopped = true;
      return { command, args, host: true, head, exitCode: 1, error, durationMs: Date.now() - startedAt, log, tail: error };
    }
    let group = null, registered = null;
    const { exitCode, error } = await new Promise(resolve => {
      const child = spawn(process.execPath, ["--input-type=commonjs", "-e", wrapper, JSON.stringify([command, ...args])], { cwd: checkout, detached: true, stdio: ["pipe", fd, fd],
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !GIT_ROUTING.includes(key))), TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot } });
      child.stdin.on("error", () => {});
      child.once("error", cause => resolve({ exitCode: null, error: cause.message }));
      child.once("exit", (code, signal) => resolve({ exitCode: code ?? (signal ? 128 : null), error: signal ? `signal ${signal}` : null }));
      try {
        group = child.pid; const procStart = processStart(group);
        if (!procStart) throw new Error("verification group incarnation unavailable");
        atomicJson(marker, { ...readJson(marker), group, procStart });
        registered = true; child.stdin.end("go\n");
      } catch (cause) { child.stdin.destroy(); registered = cause.message; }
    });
    fs.closeSync(fd);
    // Descendants left by the command could still write evidence: the whole group ends before the evidence check.
    const descendants = group ? await stopHostGroup(group) : null;
    stopped = !descendants;
    const text = fs.readFileSync(log, "utf8");
    return { command, args, host: true, head, exitCode: registered === true ? exitCode ?? 1 : 1, ...(error ? { error } : {}),
      ...(registered !== true ? { error: `verification group registration failed: ${registered}` } : {}), ...(descendants ? { descendants } : {}),
      durationMs: Date.now() - startedAt, log, tail: (failureLines(text) || text).slice(-4000) };
  } finally {
    try { fs.closeSync(fd); } catch {}
    if (stopped) removeHostCheckout(evidenceRoot, collectionId);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
export function validatePreflight(receipt, head, base) {
  requireThat(receipt?.producer === REVIEW_PRODUCER && receipt.review, "missing review receipt or old receipt format; request a new collection");
  requireThat(receipt.head === head && receipt.base === base, "missing or stale review receipt/head/base");
  // MONO-481: the worker cannot read the host ledger; the round's line carries the host's screen check of this head.
  const screen = receipt.screenCheck?.head === head ? `; screen check on the host passed on this head (report ${receipt.screenCheck.report})` : '';
  requireThat(ACCEPTED.includes(receipt.review.outcome), reviewRefusal(receipt.review, receipt.verification?.host === true, receipt.risk) + screen);
  requireThat(receipt.consistency?.passed === true && receipt.consistency.error === null, `collection consistency failed or missing: ${receipt.consistency?.error ?? "no record"}`);
  // Host verification (pinned hostVerification): the collection ran the full verification of this head outside the sandbox.
  // Otherwise the collection does not verify (exitCode null): only the worker's full verification of this head, exit 0, passes it.
  // Older receipts keep their own sandbox verification.
  const host = receipt.verification?.host === true;
  if (host) {
    requireThat(receipt.verification.exitCode === 0, hostFailure(receipt.verification));
    // Bound to the SHA its clean checkout held; MONO-457 receipts without it need a new collection.
    requireThat(receipt.verification.head === head, "host verification is not bound to this head: request a new collection");
  }
  else if (receipt.verification?.exitCode === null) requireThat(receipt.workerVerification?.head === head && receipt.workerVerification.exitCode === 0,
    "worker verification missing on this head: run the full verification and request with workerVerification {head, exitCode: 0}");
  else {
    requireThat(receipt.verification?.exitCode === 0, "needs-decision: verification failed on the reviewed head");
    requireThat(receipt.verification.sandbox?.mode === "workspace-write" && receipt.verification.sandbox.probed === true, "verification sandbox proof missing");
  }
  const successors = receipt.review.successors ?? [], worker = receipt.review.workerVerification;
  requireThat(!worker || (worker.head === head && worker.exitCode === 0), "worker verification is not on this head");
  const fixes = receipt.review.hostVerified ? ', fixes after it confirmed by the full verification on the host,' : worker ? ', fixes after it confirmed by the worker\'s full verification,' : '';
  return `review ${receipt.review.outcome} (${roundText(receipt.review.round, receipt.review.limit ?? ROUND_LIMIT)})${fixes} and ${host ? 'host ' : ''}verification verified on head` +
    (successors.length ? `; successor candidates: ${successors.map(item => item.line).join('; ')}` : '') + screen;
}

const ROUND_LIMIT_REACHED = `review round limit reached (${ROUND_LIMIT} of ${ROUND_LIMIT} on this task attempt); split the Issue or change approach in a new attempt`;
// Fast path: the spent round needs the worker's full verification on the final head instead of another round.
// MONO-482: the strict path's line after round 3 names the extra round; after the extra round it says it is used.
const limitRefusal = (limit, host = false, strict = limit >= ROUND_LIMIT) => !strict
  ? (limit >= ROUND_LIMIT ? `needs-decision: ${ROUND_LIMIT_REACHED}` : `review round spent (1 of 1 on this task attempt); ${host ? HOST_FAST_FIX : FAST_FIX}`)
  : limit > ROUND_LIMIT ? `needs-decision: review round limit reached (${limit} of ${limit} on this task attempt, extra round used); split the Issue or change approach in a new attempt`
  : `needs-decision: review round limit reached (${ROUND_LIMIT} of ${ROUND_LIMIT} on this task attempt); ${EXTRA_HINT}`;
// MONO-483: the refusal names the cause and the next step. The environment (a role timeout, a sleeping host, the network,
// a login still failing after its refresh) is restored and retried without a task change; the work's own cause needs one.
const notReviewedTwice = (cause, causes = []) => cause === 'environment'
  ? `not-reviewed twice in a row on this head (environment${causes.length ? `: ${causes.join(', ')}` : ''}); restore the environment (host awake, load down, network, CLI login) and resume the worker with reviewRetry, without a task change`
  : "not-reviewed twice in a row on this head (review); check that both review CLIs are logged in, then resume with a task change";
const blockedTwice = prior => `blocked: ${notReviewedTwice(prior.notReviewedCause, prior.notReviewedCauses)}`;
// Other issues' and older receipts share this folder: only this attempt's pins files are read further;
// unreadable or irregular files are skipped, never counted. No worker grant reaches evidenceRoot.
function receiptHistory(evidenceRoot, pinsFile) {
  const history = path.join(evidenceRoot, "history");
  if (!fs.existsSync(history)) return [];
  return fs.readdirSync(history).filter(name => name.endsWith(".json")).flatMap(name => {
    try {
      regularEvidence(path.join(history, name));
      const envelope = readJson(path.join(history, name));
      return sameAttempt(envelope.receipt?.pins?.file, pinsFile) ? [envelope.receipt] : [];
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
// Shared review inputs for Preflight; HEAD remains usable on a dirty tree.
export function reviewContext(request, pins, liveTip = null) {
  const repo = fs.realpathSync(request.worktree), head = git(repo, "rev-parse", "HEAD");
  const base = git(repo, "merge-base", head, reviewBaseTip(repo, request.baseRef, liveTip));
  return { head, base, ...attemptContext(request, pins, head, base) };
}
// The attempt's contract (with its task changes) and round history (with review retries and the extra round): every
// decision taken from a control file beside the pins. A collection with a host run reads it again once its run opened.
function attemptContext(request, pins, head, base) {
  let contract = null, contractDigest = null;
  if (!pins || !request.pins) return { contract, contractDigest, history: null };
  const pinnedIssue = /^([A-Z][A-Z0-9]*-[1-9][0-9]*)-a[1-9][0-9]*$/.exec(path.basename(path.dirname(request.pins.file)))?.[1];
  const file = path.join(pins.fullSnapshot?.directory ?? path.join(path.dirname(request.pins.file), "snapshot"), `issue-${pinnedIssue}.md`);
  if (!pinnedIssue || !fs.existsSync(file)) return { contract, contractDigest, history: null };
  contract = fs.readFileSync(file, "utf8");
  // Delivered task changes («Изменение задачи» comment plus resume) narrow or correct the task:
  // the reviewer reads them with the Issue. Resume records them append-only beside the launch pins.
  for (const change of taskChanges(path.dirname(request.pins.file)))
    contract += `\n\n## Изменение задачи ${change.number} (${change.url})\n${change.text}`;
  contractDigest = digest(contract);
  // Review retries live beside the launch pins too, outside every worker grant; they never enter the contract.
  const receipts = receiptHistory(request.evidenceRoot, request.pins.file), now = new Date().toISOString();
  const history = reviewHistory(receipts, { pins: request.pins, head, base, contractDigest, retries: reviewRetries(path.dirname(request.pins.file)), now });
  // MONO-482: the extra round granted by resume lives beside the launch pins too; it raises only the strict path's limit.
  history.extra = extraRoundGranted(receipts, { pins: request.pins, grants: extraRounds(path.dirname(request.pins.file)), now });
  return { contract, contractDigest, history };
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
  // Remarks on the draft PR (bot, CI, owner) the worker fixed: open findings of this round, recorded in the receipt.
  if (request.prRemarks !== undefined) prRemarkFindings(request.prRemarks);
  // MONO-482: strictness comes from the pinned risk; the attempt's extra round (read with the history below) raises the strict limit by one.
  const workerCheck = request.workerVerification, strict = request.risk === 'risky';
  let limit = roundLimit(request.risk);
  requireThat(workerCheck === undefined || (Object.keys(workerCheck ?? {}).sort().join(",") === "exitCode,head" && /^[a-f0-9]{40}$/.test(workerCheck.head) &&
    Number.isInteger(workerCheck.exitCode)), "workerVerification must be {head, exitCode} of the worker's full verification run");
  const workerVerified = workerCheck?.head === request.head && workerCheck.exitCode === 0;
  // Strict path: up to ROUND_LIMIT rounds per attempt, task changes included. Fast path: one round per contract,
  // so a delivered task change («Изменение задачи») gets one round of its own even on an unchanged head;
  // the stage record holds ROUND_LIMIT rounds, so a fast-path task change after them needs a new attempt.
  const roundsUsed = prior => strict ? prior.spent : prior.onContract;
  // The stage record holds ROUND_LIMIT rounds, one more with the strict path's extra round.
  const roundOpen = prior => roundsUsed(prior) < limit && prior.spent < Math.max(limit, ROUND_LIMIT);
  const hostVerify = pins?.hostVerification === true;
  const closedRefusal = prior => strict || prior.onContract ? limitRefusal(limit, hostVerify, strict) : limitRefusal(ROUND_LIMIT, false, false);
  const evidenceRoot = preflightEvidenceRoot(request);
  validateEvidenceGrants(request.packRoot ?? request.skillsRoot, request.workerWritableRoots, 'packRoot');
  validateEvidenceGrants(request.skillsRoot, request.workerWritableRoots, 'installed skillsRoot');
  const repo = fs.realpathSync(request.worktree);
  cleanTree(repo);
  let { head, base, contract, contractDigest, history } = reviewContext(request, pins, live?.baseRefOid);
  if (strict && history?.extra) limit = ROUND_LIMIT + 1;
  if (pins && head !== request.head) throw new Error(`collection request mismatch: head; expected ${canonical(head)}`);
  if (pins && !new RegExp(`^preflight-collect:${head}:[1-9][0-9]*$`).test(request.collectionId ?? ""))
    throw new Error(`collection request mismatch: collectionId; expected ${canonical(`preflight-collect:${head}:<n>`)}`);
  requireThat(head === request.head, "head differs from collection/verification request");
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
  const binding = { ...(idea ? { idea } : {}), ...(workerCheck ? { workerVerification: workerCheck } : {}), ...(request.issue !== undefined ? { issue: request.issue } : {}), ...(request.packRoot ? { packRoot: request.packRoot } : {}), ...(request.pins ? { pins: request.pins } : {}), ...(request.modelRoutes ? { modelRoutes: request.modelRoutes } : {}), ...(request.prRemarks?.length ? { prRemarks: request.prRemarks } : {}), product: request.product, collectionId: request.collectionId, skillsRoot: request.skillsRoot, risk: request.risk,
    critical: request.critical, root: fs.realpathSync(request.root), worktree: repo, evidenceRoot,
    workerWritableRoots: request.workerWritableRoots.map(resolvedLocation).sort() };
  let receipt, verifiedReceiptFile = receiptFile;
  if (request.collect === false) {
    // evidenceRoot is outside every worker grant (checked above), so its regular files are the receipts.
    const readReceipt = file => {
      regularEvidence(file); const read = readJson(file).receipt;
      requireThat(!fs.existsSync(hostRunMarker(evidenceRoot, read?.collectionId ?? "")), "host verification of this collection did not finish; request a new collection");
      return read;
    };
    if (!pins) receipt = readReceipt(receiptFile);
    else if (fs.existsSync(receiptFile)) receipt = readReceipt(receiptFile);
    if (pins && receipt?.collectionId !== request.collectionId) {
      const history = path.join(evidenceRoot, "history");
      const matches = fs.existsSync(history) ? fs.readdirSync(history).filter(name => name.endsWith(".json"))
        .map(name => path.join(history, name)).filter(file => readJson(file).receipt?.collectionId === request.collectionId) : [];
      requireThat(matches.length <= 1, "multiple history receipts for collectionId");
      if (matches.length) { verifiedReceiptFile = matches[0]; receipt = readReceipt(verifiedReceiptFile); }
      else receipt = null;
    }
    if (!receipt) {
      requireThat(allowPending, "missing or stale review receipt/head/base");
      // Refuse here, before the worker publishes a request that could only be refused.
      const prior = history;
      if (prior && !prior.reuse) {
        requireThat(prior.notReviewed < 2, blockedTwice(prior));
        // With host verification the collection itself verifies the fixed head.
        requireThat(roundOpen(prior) || workerFixed(prior, hostVerify || workerVerified), closedRefusal(prior));
      }
      return { publishRequest: { ...request, collect: false } };
    }
    if (!request.pins && receipt.pins) throw new Error(`collection request mismatch: pins; expected ${canonical(receipt.pins)}`);
    requireThat(canonical(receipt.idea ?? null) === canonical(idea), 'receipt idea differs from dispatch pins');
    requireThat(canonical(receipt.prRemarks ?? null) === canonical(request.prRemarks?.length ? request.prRemarks : null), 'receipt prRemarks differ from the request');
    requireThat(canonical(receipt.workerVerification ?? null) === canonical(workerCheck ?? null), 'receipt workerVerification differs from the request');
    for (const [key, value] of Object.entries(binding)) {
      requireThat(canonical(receipt[key]) === canonical(value), `receipt ${key} differs from dispatch request`);
    }
    requireThat(canonical({ command: receipt.verification?.command, args: receipt.verification?.args }) === canonical(request.verification), "receipt verification differs from dispatch request");
    // A delivered task change («Изменение задачи») changes the reviewed contract: an earlier round no longer counts.
    requireThat(!contractDigest || !receipt.review?.contractDigest || receipt.review.contractDigest === contractDigest,
      "the task changed after this review round («Изменение задачи»); request a new round on this head");
  }
  verifyModelPins(request, base);
  validateEvidenceGrants(request.skillsRoot, [repo], "installed skillsRoot");
  // Fast path after its round on this contract: accepted on the worker's full verification (exit 0) of this head; what the
  // round left for a decision (out of contract, raised risk) never passes on the worker's word.
  function workerFixed(prior, verified = workerVerified) {
    if (strict || prior.onContract < 1 || !verified) return null;
    // The attempt's last completed round, on any base: a newer base does not clear its blockers or successors.
    const last = receiptHistory(request.evidenceRoot, request.pins.file).filter(receipt => receipt.producer === REVIEW_PRODUCER && receipt.review?.spent === true)
      .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt))).at(-1)?.review ?? null;
    if (last?.record?.findings?.some(finding => finding.outOfContract || finding.riskRaised))
      return { outcome: 'refused', spent: false, round: null, successors: [], record: null,
        reason: 'needs-decision: the review round found work outside the task or a higher risk; the worker\'s verification does not settle it' };
    // Older defects the worker need not fix stay listed (must-file ones too) for filing after merge.
    const successors = last?.successors?.length ? last.successors : last?.record
      ? roundOutcome({ outcome: 'clean', findings: leftover(last.record).filter(finding => finding.origin === 'pre-existing') }, last.round).successors : [];
    return { outcome: successors.length ? 'clean-with-successors' : 'clean', spent: false, round: prior.onContract, successors,
      record: last?.record ?? null, ...(hostVerify ? { hostVerified: true } : { workerVerification: workerCheck }) };
  }
  const unchanged = () => {
    if (idea) verifyIdeaArtifact(idea, pinnedIssue ?? request.issue);
    cleanTree(repo);
    requireThat(git(repo, "rev-parse", "HEAD") === head && git(repo, "merge-base", head, live?.baseRefOid ?? request.baseRef) === base,
      "head or base changed during verification");
  };
  if (request.collect === true) {
    const recordedAt = new Date().toISOString();
    let prior = history;
    requireThat(prior, "review contract missing in the pinned dispatch snapshot (issue-<KEY>.md)");
    const consistency = { passed: true, error: null };
    const checkConsistency = () => {
      try { unchanged(); } catch (error) { consistency.passed = false; consistency.error ??= error.message; }
    };
    // A round is spent only by a completed round on a new head.
    let review;
    const refuse = reason => ({ outcome: 'refused', spent: false, round: null, reason, successors: [], record: null });
    // Host verification runs first, on every collection (a same-head retry reruns it): a red head spends no
    // round and no reviewer call, and the refusal never counts toward not-reviewed.
    // New PR remarks on the same head are not covered by the stored round: they need a round of their own.
    const remarkReuse = () => { if (prior.reuse && canonical(prior.reuse.prRemarks ?? null) !== canonical(request.prRemarks?.length ? request.prRemarks : null)) prior.reuse = null; };
    remarkReuse();
    let verification = { command: request.verification.command, args: request.verification.args, exitCode: null };
    // MONO-481 pinned screenCheck: until the attempt's first spent round the round waits for the host's screen check of
    // this head. Waiting and mismatches are refusals: no round, no reviewer, no host run, never a not-reviewed.
    const hold = () => screenCheckHold({ pins, binding: request.pins, spent: prior.spent, head });
    let screen = hold();
    // Skipped only where the answer is the blocked refusal anyway (not-reviewed twice, no stored round to reuse).
    if (hostVerify && !screen && (prior.reuse || prior.notReviewed < 2)) {
      verification = await runHostVerification(request.verification, repo, head, evidenceRoot, request.collectionId, request.pins.file);
    }
    if (hostVerify && verification.busy === undefined && verification.host === true) {
      // Settled under launch.lock while the marker still exists: touched evidence is put back or quarantined, then the
      // contract and history are read again with the root's only host-run slot still held (MONO-482 review: no decision
      // from a control file read before this run opened); a group that may still live keeps the marker.
      const settled = settleHostRun(evidenceRoot, request.collectionId, request.pins.file, { keepMarker: !!verification.descendants,
        reread: () => { try { return { value: attemptContext(request, pins, head, base) }; } catch (error) { return { error: error.message }; } } });
      const touched = settled.gone ? 'host verification was settled by recovery before this collection ended' : settled.touched ?? verification.descendants ?? settled.read.error ?? null;
      if (touched) { consistency.passed = false; consistency.error = touched; }
      else {
        ({ contract, contractDigest, history } = settled.read.value); prior = history; remarkReuse();
        limit = roundLimit(request.risk) + (strict && history?.extra ? 1 : 0);
      }
      checkConsistency();
    }
    // Re-validated fresh after any host run, right before the round: a run that changed the approved design (or the
    // result) leaves the round waiting. The receipt names the result this decision read.
    screen ??= hold();
    const passedScreen = !screen && pins?.screenCheck === true && prior.spent === 0 ? readScreenCheck(head, request.pins) : null;
    if (verification.busy !== undefined) review = refuse(verification.busy);
    else if (!consistency.passed) review = refuse(`collection consistency failed: ${consistency.error}`);
    else if (screen) review = refuse(screen.reason);
    else if (hostVerify && verification.host !== true) review = refuse(blockedTwice(prior));
    else if (verification.host && verification.exitCode !== 0) review = refuse(hostFailure(verification));
    else if (prior.reuse) review = { ...prior.reuse.review, ...roundOutcome(prior.reuse.review.record, prior.reuse.review.round, strict), spent: false, reusedFrom: prior.reuse.runId };
    else if (prior.notReviewed >= 2) review = refuse(blockedTwice(prior));
    else if (!roundOpen(prior)) review = workerFixed(prior, hostVerify ? verification.exitCode === 0 : workerVerified) ?? refuse(closedRefusal(prior));
    else {
      const record = await runReviewRound({ worktree: repo, head, base, contract, risk: request.critical ? 'riskyCritical' : request.risk,
        config: baseModelConfig(repo, request.modelRoutes?.base ?? base), packRoot: path.resolve(scriptDir, '..'), roundLimit: Math.max(limit, ROUND_LIMIT), ...(prior.record ? { stageRecord: prior.record } : {}),
        ...(request.prRemarks?.length ? { remarks: request.prRemarks } : {}) });
      const { costs, host, cause: _cause, ...stageRecord } = record;
      // MONO-483: environment only when every failed role attempt of the round failed on the environment and every file was read.
      const cause = record.cause === 'environment' && !record.unreviewedFiles?.length ? 'environment' : 'review';
      const repeated = prior.notReviewed > 0, number = (record.rounds?.length ?? 0) + 1;
      const roleCauses = record.failures.filter(failure => failure.head === head && failure.round === number && failure.role && failure.cause).map(failure => failure.cause);
      review = record.outcome === 'not-reviewed'
        ? { outcome: 'not-reviewed', spent: false, round: null, repeated, cause, reason: record.failures.at(-1)?.reason ?? `no readable text for ${record.unreviewedFiles.join(', ') || 'the review'}`,
          // The refusal line of a second one names the streak's cause: environment only when the whole streak is.
          ...(repeated ? { streakCause: prior.notReviewedCause === 'environment' && cause === 'environment' ? 'environment' : 'review',
            causes: [...new Set([...prior.notReviewedCauses, ...roleCauses])] } : {}),
          successors: [], record: null, failures: record.failures.slice(-6), costs, ...(host ? { host } : {}) }
        : { ...roundOutcome(record, roundsUsed(prior) + 1, strict), spent: true, round: roundsUsed(prior) + 1, record: stageRecord, ...(host ? { host } : {}) };
    }
    review.contractDigest = contractDigest; review.limit = limit;
    checkConsistency();
    receipt = { producer: REVIEW_PRODUCER, recordedAt, ...binding, runId: crypto.randomUUID(), head, base, review,
      // Without host verification the worker runs the full verification; the collection records the pinned command unrun.
      verification, consistency };
    // The screen check this round waited for, named in the round's line (validatePreflight).
    if (passedScreen?.outcome === 'passed') receipt.screenCheck = { head, report: passedScreen.report };
    atomicJson(path.join(evidenceRoot, "history", `${receipt.runId}.json`), { receipt });
    atomicJson(receiptFile, { receipt });
  }
  const reason = validatePreflight(receipt, head, base);
  // The pin, not the receipt, decides the verification: a pinned attempt passes only on the collection's host run.
  requireThat(!hostVerify || receipt.verification?.host === true, "host verification missing on this head: request a new collection");
  unchanged();
  return { reason, receipt: { path: verifiedReceiptFile, runId: receipt.runId, digest: digest(receipt) } };
}

export function readShipSnapshot(repo, number, deadline = Infinity, botSince = null) {
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
  const pr = graphql('query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid createdAt state mergeStateStatus mergeable baseRefName baseRefOid baseRef{branchProtectionRule{requiredStatusCheckContexts}}}}}', variables).repository.pullRequest;
  requireThat(pr?.headRefOid, "PR not found");
  const head = pr.headRefOid;
  if (botSince === 0 && Number.isFinite(Date.parse(pr.createdAt))) botSince = Date.parse(pr.createdAt);
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
  function checksFor(head) {
    let headStartedAt;
    const checks = pages('query($owner:String!,$name:String!,$head:GitObjectID!,$after:String){repository(owner:$owner,name:$name){object(oid:$head){... on Commit{committedDate statusCheckRollup{contexts(first:100,after:$after){nodes{__typename ... on CheckRun{name status conclusion startedAt completedAt checkSuite{commit{oid} app{slug}}} ... on StatusContext{context state createdAt targetUrl creator{__typename login}}} pageInfo{hasNextPage endCursor}}}}}}}',
      { owner, name, head }, d => { headStartedAt = d.repository.object.committedDate; return d.repository.object.statusCheckRollup?.contexts ?? { nodes: [], pageInfo: { hasNextPage: false } }; })
      .map(check => ({ ...check, head: check.__typename === "CheckRun" ? check.checkSuite?.commit?.oid : head }));
    return { head, headStartedAt, checks };
  }
  const { checks, headStartedAt } = checksFor(head);
  // Recover green heads already pushed during Preflight; launch pins are immutable.
  const ciHistory = botSince === null ? [] : gh('api', '--paginate', '--slurp', `repos/${repo}/pulls/${number}/commits`).flat()
    .filter(commit => commit.sha !== head).map(commit => checksFor(commit.sha));
  const threads = pages('query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$after){nodes{id isResolved isOutdated} pageInfo{hasNextPage endCursor}}}}}', variables, d => d.repository.pullRequest.reviewThreads);
  for (const thread of threads) {
    thread.comments = pages('query($id:ID!,$after:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$after){nodes{id body publishedAt author{login} pullRequestReview{state}} pageInfo{hasNextPage endCursor}}}}}', { id: thread.id }, d => d.node.comments);
  }
  const viewer = gh("api", "user").login;
  const reviews = gh("api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/reviews`).flat();
  const comments = gh("api", "--paginate", "--slurp", `repos/${repo}/issues/${number}/comments`).flat();
  const botComments = [...comments, ...reviews].filter(comment => (comment.user?.type === "Bot" || isReviewBot(comment.user)) && comment.body?.trim())
    .map(comment => ({ id: comment.node_id, body: comment.body, user: comment.user, reviewBot: isReviewBot(comment.user), head: comment.commit_id, createdAt: comment.created_at ?? comment.submitted_at, updatedAt: comment.updated_at ?? comment.submitted_at }));
  const final = graphql('query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid createdAt state mergeStateStatus mergeable baseRefName baseRefOid baseRef{branchProtectionRule{requiredStatusCheckContexts}}}}}', variables).repository.pullRequest;
  requireThat(final.headRefOid === head && final.baseRefName === pr.baseRefName && final.baseRefOid === pr.baseRefOid && canonical(final.baseRef) === canonical(pr.baseRef), "head/base policy changed during GitHub read");
  return { ...final, head, headStartedAt, ciHistory, botSince, rules: rulesEvidence, requiredChecks, checks, threads, viewer, reviews, botComments };
}

// CheckRun authors come from their app; a StatusContext (commit status) names its author in creator.
// Only a Bot creator counts, so a person who posts a status never lends a review bot identity.
const reviewBotLogin = check => {
  const login = check.__typename === 'StatusContext'
    ? (check.creator?.__typename === 'Bot' ? check.creator.login : null) : check.checkSuite?.app?.slug;
  return login ? (login.endsWith('[bot]') ? login : `${login}[bot]`) : null;
};
export const isReviewBot = (user, names = ['Greptile Review', 'Devin Review'], checks = []) =>
  (names.includes('Greptile Review') && ['greptile-apps[bot]', 'greptile[bot]'].includes(user?.login)) ||
  (names.includes('Devin Review') && ['devin-ai-integration[bot]', 'devin-ai[bot]'].includes(user?.login)) ||
  (user?.login !== 'github-actions[bot]' && checks.some(check => names.includes(check.name ?? check.context) &&
    reviewBotLogin(check) === user?.login));
export const isBotCheck = (name, snapshot, policy) => [...(policy.botChecks ?? []), 'Greptile Review', 'Devin Review'].includes(name) &&
  ![...(snapshot.requiredChecks ?? []), ...(policy.requiredChecks ?? [])].includes(name);
const greenCheck = check => check.__typename === 'CheckRun'
  ? check.status === 'COMPLETED' && check.conclusion === 'SUCCESS'
  : check.__typename === 'StatusContext' && check.state === 'SUCCESS';
export function advanceBotWait(previous, snapshot, policy, now) {
  requireThat(!previous || ((previous.startedAt === null || (Number.isFinite(previous.startedAt) && previous.startedAt <= now)) &&
    [null, 'ответил', 'молчал', 'нет'].includes(previous.outcome)), 'invalid bot clock');
  const state = previous ? { ...previous } : { startedAt: null, outcome: null };
  const names = policy.botChecks ?? ['Greptile Review'];
  if (!names.length) return { ...state, outcome: 'нет' };
  if (state.outcome) return state;
  const required = [...new Set([...(snapshot.requiredChecks ?? []), ...(policy.requiredChecks ?? [])])];
  const candidates = [snapshot, ...(snapshot.ciHistory ?? [])].filter(candidate => candidate === snapshot ||
    Date.parse(candidate.headStartedAt) >= (snapshot.botSince ?? 0) || candidate.checks.some(check =>
      Date.parse(check.completedAt ?? check.createdAt ?? check.startedAt) >= (snapshot.botSince ?? 0)));
  if (state.startedAt === null) {
    const greens = candidates.flatMap(candidate => {
      const ci = candidate.checks.filter(check => !isBotCheck(check.name ?? check.context, snapshot, policy));
      const mandatory = required.length ? candidate.checks.filter(check => required.includes(check.name ?? check.context)) : ci;
      if (!mandatory.length || !mandatory.every(check => check.head === candidate.head && greenCheck(check)) ||
        !required.every(name => mandatory.some(check => (check.name ?? check.context) === name))) return [];
      const completed = mandatory.map(check => Date.parse(check.completedAt ?? check.createdAt));
      const time = completed.every(time => Number.isFinite(time) && time <= now) ? Math.max(...completed) : candidate === snapshot ? now : null;
      return time !== null && (candidate === snapshot || time >= (snapshot.botSince ?? 0)) ? [time] : [];
    });
    if (greens.length) state.startedAt = Math.min(...greens);
  }
  const deadline = state.startedAt === null ? Infinity : state.startedAt + 30 * 60_000;
  const checks = candidates.flatMap(candidate => candidate.checks);
  const heads = new Set(candidates.map(candidate => candidate.head));
  const commits = candidates.map(candidate => Date.parse(candidate.headStartedAt)).filter(Number.isFinite);
  const since = snapshot.botSince ?? 0;
  const replySince = Math.max(since, commits.length ? Math.min(...commits) : Infinity);
  // Every reply source honours the attempt boundary: a reply before botSince belongs to an earlier attempt.
  const inWindow = time => time >= since && time <= deadline;
  const replied = names.every(name => checks.some(check => (check.name ?? check.context) === name &&
    heads.has(check.head) && greenCheck(check) && inWindow(Date.parse(check.completedAt ?? check.createdAt) || now)) ||
    snapshot.botComments?.some(item => (item.user ? isReviewBot(item.user, [name], checks) : names.length === 1 && item.reviewBot !== false) &&
      (heads.has(item.head) || (!item.head && Date.parse(item.createdAt) >= replySince)) &&
      inWindow(Date.parse(item.createdAt ?? item.updatedAt))) ||
    snapshot.reviews?.some(item => isReviewBot(item.user, [name], checks) &&
      ['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED'].includes(item.state) && heads.has(item.commit_id) &&
      inWindow(Date.parse(item.submitted_at))));
  if (replied) state.outcome = 'ответил';
  else if (now >= deadline || policy.botUnavailable?.trim()) state.outcome = 'молчал';
  return state;
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
  let acceptedFailure = false, excludedBotFailure = false;
  for (const check of s.checks) {
    const name = check.name ?? check.context;
    if ((policy.botOutcome || policy.botUnavailable?.trim()) && isBotCheck(name, s, policy)) {
      excludedBotFailure ||= !greenCheck(check); continue;
    }
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
    if (awaiting) { pendingChecks.add(name); if (!isBotCheck(name, s, policy)) pending(`check ${name} pending on head`); }
    if (!pass && nonBlocking && terminal) acceptedFailure = true;
    if (pass) successful.add(name);
    if (pass && (check.__typename === "StatusContext" || check.conclusion === "SUCCESS")) botSuccessful.add(name);
  }
  for (const name of [...(s.requiredChecks ?? []), ...(policy.requiredChecks ?? [])]) {
    if (!s.checks.some(c => (c.name ?? c.context) === name) || pendingChecks.has(name)) pending(`required check ${name} absent or pending`);
    else requireThat(successful.has(name), `required check ${name} not successful`);
  }
  if (!policy.botOutcome && !policy.botUnavailable?.trim()) for (const name of policy.botChecks ?? ["Greptile Review"]) {
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
    ["MERGEABLE", "UNKNOWN"].includes(s.mergeable)) throw Object.assign(new ShipPending(pendingReason), { botWaiting: pendingReason.startsWith("bot ") });
  if (s.mergeable === "UNKNOWN" || s.mergeStateStatus === "UNKNOWN") throw new ShipPending("mergeability pending (UNKNOWN)");
  requireThat(s.mergeable === "MERGEABLE" && (s.mergeStateStatus === "CLEAN" ||
    (s.mergeStateStatus === "UNSTABLE" && (acceptedFailure || excludedBotFailure))), "merge state is not clean");
  return "all ship conditions satisfied";
}
export function advanceEvidence(previous, snapshot, now) {
  const fingerprint = digest(snapshot);
  requireThat(!previous || (Number.isFinite(previous.startedAt) && previous.startedAt <= now && Number.isFinite(previous.lastEventAt) && previous.lastEventAt <= now), "invalid evidence clock");
  return { head: snapshot.head, fingerprint, startedAt: previous?.startedAt ?? now,
    lastEventAt: previous?.head === snapshot.head && previous.fingerprint === fingerprint ? previous.lastEventAt : now };
}
export function validateShipBotPolicy(policy = {}, trusted) {
  requireThat(!Object.hasOwn(policy, "botOutcome"), "worker botOutcome cannot bypass the bot clock");
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
  // This task-level Ship state survives new per-head gate state files and task changes.
  const botFile = request.preflight.pins?.file
    ? path.join(path.dirname(path.dirname(path.dirname(request.preflight.pins.file))), 'reports', `${path.basename(path.dirname(request.preflight.pins.file))}-ship-bot.json`)
    : path.join(path.dirname(request.stateFile), `ship-bot-${request.repo.replace("/", "-")}-${request.number}.json`);
  const botScope = { repo: request.repo, number: request.number };
  let bot = fs.existsSync(botFile) ? readJson(botFile) : null;
  requireThat(!bot || canonical(bot.scope) === canonical(botScope), 'bot state belongs to another PR/attempt');
  const evidenceDeadline = previous.startedAt + config.evidenceLimitSec * 1000;
  // A restart after pure bot waiting still gets one bounded final read/quiet pause.
  const recoveryDeadline = bot?.startedAt != null && Date.now() >= bot.startedAt + 30 * 60_000 &&
    previous.pendingReason?.startsWith('bot ') ? Date.now() + config.quietSec * 1000 + 30_000 : 0;
  const botLimit = () => bot.startedAt + 30 * 60_000 + (config.quietSec + config.pollSec) * 1000;
  let botDeadline = Math.max(previous.botDeadline ?? 0, bot?.startedAt != null && !bot.outcome ? botLimit() : 0);
  const deadlineFor = () => Math.max(evidenceDeadline, recoveryDeadline, botDeadline);
  let deadline = deadlineFor();
  while (true) {
    requireThat(Date.now() < deadline, "evidence-limit: предел доказательств");
    try {
      const since = request.preflight.pins?.file
        ? fs.statSync(path.join(path.dirname(request.preflight.pins.file), 'pins.json')).mtimeMs : 0;
      const snapshot = readShipSnapshot(request.repo, request.number, deadline, !bot?.outcome ? since : null);
      requireThat(request.preflight?.collect === false, "ship requires preflight collect:false request");
      const proof = await verifyPreflight(request.preflight, snapshot);
      const judgment = readJson(request.judgmentFile);
      const now = Date.now();
      bot = { ...advanceBotWait(bot, snapshot, policy, now), scope: botScope };
      atomicJson(botFile, bot);
      if (bot.startedAt != null && !bot.outcome) botDeadline = Math.max(botDeadline, botLimit());
      deadline = deadlineFor();
      const state = { ...advanceEvidence(previous, { ...snapshot, preflightReceipt: proof.receipt, judgment, policy }, now), scope, preflightReceipt: proof.receipt, rules: snapshot.rules, bot, botDeadline };
      atomicJson(request.stateFile, state); previous = state;
      requireThat(now < deadline, "evidence-limit: предел доказательств");
      evaluateShip(snapshot, judgment, { ...policy, botOutcome: bot.outcome });
      // A green bot check from before this attempt is not a reply: keep waiting until the window settles it.
      if (!bot.outcome) throw Object.assign(new ShipPending('bot reply not seen in this attempt'), { botWaiting: true });
      if (now - state.lastEventAt >= config.quietSec * 1000) return `current-head evidence complete and quiet period passed; Бот: ${bot.outcome}; preflight receipt: ${proof.receipt.path}`;
      requireThat(request.watch === true, "current-head evidence quiet period pending");
    } catch (error) {
      if (!(error instanceof ShipPending) || request.watch !== true) throw error;
      previous = { ...previous, lastEventAt: error.botWaiting ? previous.lastEventAt : Date.now(), pendingReason: error.message };
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
preflight request: {product,collectionId,root,worktree,head,issue?,skillsRoot,risk,critical,baseRef,evidenceRoot,workerWritableRoots:[],pins?:{file,digest},modelRoutes?,prRemarks?:[{id,source:bot|ci|owner,file,line,title,body,urgent,head}],workerVerification?:{head,exitCode},collect,verification:{command,args}}
  prRemarks: remarks from the draft PR the worker fixed (scripts/ship-pr.mjs remarks); they enter the round as open findings and close only when the checker verifies the fix.
  modelRoutes pins immutable base/configDigest/roles from resolveModelRoutes; overrides require pins.
  risk is the final approved/diff risk; critical is a concrete escalation reason or null.
  Pin every request field from dispatch. Orchestrator only: collect:true, outside worker sandboxes.
  Worker only: collect:false, reads <evidenceRoot>/<head>.json without creating files.
  Registered attempts require their dispatch pins in every collection request.
  Pending worker collection exits 2 with publishRequest; write exactly that request as the round request (delivery-state.mjs wait-round). Pass exits 0; refusal exits 1.
  Use ~/.mono-agent-workflow/evidence/<product>/ outside EVERY worker-writable root,
  including worktree, orchestrator root and additional workerWritableRoots. Pin that list in dispatch.
  workerVerification: the worker's own run of the pinned full verification on this head; a receipt passes only with exitCode 0 on its head.
  collect:true runs the read-only review round first (reviewer and checker from different model families, both CLIs logged in by subscription),
  and records verification unrun (exitCode null); one gate-review-v3 receipt per collectionId.
  Pinned hostVerification (BASE orchestration.delivery.hostVerification): collect:true first runs the pinned verification in a clean checkout of the head
  outside the worker sandbox (log in <evidenceRoot>/verification/); exit 0 passes in place of workerVerification, a red head spends no round.
  Rounds per task attempt from the pinned risk (risky 3 with task changes counted, plus one extra round granted by resume extraRound and recorded in extra-round.json beside the pins; else 1 per contract: a task change gets one round), counted from receipt history; rounds after the first review only the fixes and open findings; the same head reuses its round; not-reviewed spends nothing.
  not-reviewed names review.cause: environment (every failed role attempt timed out, met a sleeping host, the network or a login still failing after its refresh)
  or review (anything else, and older receipts); with host load at the start and end of the round and a sleep flag. Twice in a row on a head is blocked:
  environment -> restore it and resume the worker with reviewRetry (no task change, no round, same contract); review -> resume with a task change.
  Refusals are receipts too: fix and request the next round, or park on a needs-decision:/blocked: line.
  The sandbox write boundary is the trust anchor: evidenceRoot is outside every worker grant, so receipts are not worker-writable.
ship request: {preflight:<complete preflight collect:false request>, repo:"owner/repo", number:123, attempt:1, stateFile:"/absolute/file", judgmentFile:"/absolute/file", config:"/project/.agents/mono-workflow.config.json", watch:true, policy:{requiredChecks:[],nonBlockingChecks:[{name,reason}],botChecks:["Greptile Review"],botUnavailable:null}}
  Refresh remote-tracking baseRef; bind receipts to head/merge-base, not the moving base tip.
  Ship uses the live PR base tip for merge-base; require that sealed proof before judgment and record its path.
  Required bots come from immutable attempt pins (orchestration.ship.botChecks, default Greptile Review).
  Worker botChecks must match; botUnavailable stays null: the bot wait ends 30 minutes after the first green required CI.
  Other policy exceptions must come from the repository's accepted policy, never worker convenience.
  judgment: {head,preShipReview:"выполнено",readinessCheck:"пройдена",documentation:"выполнен на этой голове|без изменений|намеренно недоступен",documentationReason,closures:[{threadId,replyId}],botRemarks:[{id,commentDigest,outcome:"fixed|rejected|deferred|informational",evidence}]}
  Compute commentDigest with exported botRemarkDigest(comment) on each latest readShipSnapshot bot comment; re-inspect any edited comment.
  config.orchestration.delivery: quietSec=120,
  evidenceLimitSec=7200, pollSec=10, attemptCap=3 (the base, read from the config committed at BASE, at most 6; one task gets more only through orchestrator/attempt-cap.mjs raise). Positive seconds/counts only.
  Never delete stateFile to reset a deadline. A ship fix (in the same worker session, or after a task change) names the next ship-gate attempt;
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
