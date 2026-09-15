#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { atomicJson, canonical, digest, readJson, flags, identity, isMain, deliveryConfig, withLock, resolvedLocation, validateEvidenceGrants } from "./runtime.mjs";

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

export function startGate(request) {
  requireThat(identity(request), "missing pack identity");
  const output = execFileSync(process.execPath, [path.join(scriptDir, "verify-pack-state.mjs"), "identity", "--lock", request.lock,
    "--pack-version", request.packVersion, "--source-commit", request.sourceCommit, "--surface-revision", String(request.surfaceRevision)], { encoding: "utf8" });
  requireThat(output.trim() === "pack-state: identity verified", "pack identity not verified");
  requireThat(git(request.worktree, "branch", "--show-current") === request.branch && !["main", "master", ""].includes(request.branch), "wrong delivery branch");
  const base = git(request.worktree, "rev-parse", "--verify", `${request.base}^{commit}`);
  requireThat(git(request.worktree, "merge-base", "HEAD", base) === base, "branch does not contain dispatched base");
  cleanTree(request.worktree);
  return "pack identity, branch base and clean tree verified";
}

export function reviewRoute(skillsRoot, risk, critical) {
  const dir = path.join(skillsRoot, "mono-preflight/references");
  const policy = fs.readFileSync(path.join(dir, "model-policy.md"), "utf8");
  const model = policy.split("\n").find(line => /^\| `autoreview` \|/.test(line))?.match(/^\| `autoreview` \| `([^`]+)`/u)?.[1];
  const routing = fs.readFileSync(path.join(dir, "autoreview-routing.md"), "utf8");
  const line = routing.split("\n").find(line => critical
    ? line.startsWith("| `risky` with critical escalation |")
    : line.startsWith(`| \`${risk}\` |`));
  const effort = line?.match(/\| `(low|medium|high|xhigh)` \|/)?.[1];
  requireThat(model && effort && (!critical || risk === "risky"), "unresolved final risk route");
  return { model, effort };
}

export function validatePreflight(receipt, head, base, route) {
  requireThat(receipt?.head === head && receipt.base === base, "missing or stale autoreview artifact/head/base");
  requireThat(canonical(receipt.route) === canonical(route), "autoreview artifact has wrong policy route");
  requireThat(receipt.verification?.exitCode === 0, "local verification failed or missing");
  requireThat(receipt.review?.exitCode === 0, "autoreview failed or incomplete");
  const output = receipt.review.output ?? "";
  validateReviewLines(output, route);
  requireThat(!receipt.review.retentionError, "autoreview output retention failed");
  requireThat(receipt.loop?.iterations > 0 && receipt.loop.disposition === "clean" && Array.isArray(receipt.loop.residualFindings) && receipt.loop.residualFindings.length === 0, "autoreview loop incomplete or residual findings remain");
  if (receipt.review.json) {
    const report = receipt.review.json;
    requireThat(report.overall_correctness === "patch is correct" && Array.isArray(report.findings) && report.findings.length === 0 &&
      (report.priority_filtered_findings ?? []).every(finding => finding.priority === "P3") &&
      ["missing_required_findings", "scope_rejected_findings", "attribution_rejected_findings"].every(key => !report[key]?.length), "autoreview structured result is not complete and clean");
  }
  return "local verification and tool autoreview verified on head";
}

const verdictLines = new Set([
  "autoreview clean: no accepted/actionable findings reported",
  "autoreview filtered: no findings at the requested priority; not a correctness certificate",
  "autoreview scoped-clean: no accepted/actionable findings in the selected Git scope and priority",
]);
function validateReviewLines(output, route) {
  const lines = output.split("\n");
  const fields = lines.filter(line => /^(?:autoreview target|engine|model|thinking):/.test(line)).flatMap(line => line.split(" | "));
  for (const [key, expected] of Object.entries({ "autoreview target": "branch", engine: "claude", model: route.model, thinking: route.effort })) {
    const values = fields.filter(line => line.startsWith(`${key}:`));
    requireThat(values.length === 1 && values[0] === `${key}: ${expected}`, "autoreview output route/scope incomplete or ambiguous");
  }
  requireThat(lines.filter(line => /^autoreview (?:clean|filtered|scoped-clean|findings|incorrect|incomplete):/.test(line)).length === 1 &&
    lines.some(line => verdictLines.has(line)), "autoreview clean result missing or ambiguous");
  const overall = lines.filter(line => line.startsWith("overall:"));
  requireThat(overall.length === 1 && /^overall: patch is correct \(/.test(overall[0]), "autoreview correctness result missing or ambiguous");
}
export function validReviewInvocation(actual, fixed) {
  return canonical(actual) === canonical(fixed) || canonical(actual) === canonical([...fixed, "--stream-engine-output"]);
}

// Keep semantic lines separately from diagnostics; a saturated semantic budget
// refuses the result instead of silently dropping evidence used by validation.
export function captureOutput({ tailBytes = 8192, retainedBytes = 1024 * 1024 } = {}) {
  let pending = "", tail = "", kept = "", retentionError = null, discarding = false;
  const requiredPrefix = /^(autoreview target:|engine:|model:|thinking:|overall:|autoreview (?:clean|filtered|scoped-clean|findings|incorrect|incomplete):|(?:claude|codex) usage:|mono-boundary-denied:)/;
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
export function parseReviewUsage(output, engine) {
  const lines = output.split("\n").filter(line => /^(claude|codex) usage:/.test(line));
  const missing = reason => ({ usage: null, usageReason: reason });
  if (!lines.length) return missing("helper output does not report token usage");
  const fields = engine === "claude" ? ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"] : ["input_tokens", "cached_input_tokens", "output_tokens"];
  if (!["claude", "codex"].includes(engine)) return missing("unsupported usage engine");
  const samples = [];
  for (const line of lines) {
    if (!line.startsWith(`${engine} usage: `)) return missing("ambiguous usage engine");
    const raw = {};
    for (const token of line.slice(`${engine} usage: `.length).split(/\s+/)) {
      const match = /^([a-z_]+)=([0-9]+(?:\.[0-9]+)?)$/.exec(token);
      if (!match || Object.hasOwn(raw, match[1])) return missing("invalid or ambiguous usage counters");
      raw[match[1]] = Number(match[2]);
    }
    if (fields.some(key => !Number.isSafeInteger(raw[key]) || raw[key] < 0) || (engine === "codex" && raw.cached_input_tokens > raw.input_tokens)) return missing("missing or invalid usage counters");
    samples.push(raw);
  }
  const sum = key => samples.reduce((total, raw) => total + raw[key], 0);
  const normalized = { input: sum("input_tokens"), cacheRead: sum(fields[1]), cacheWrite: engine === "claude" ? sum(fields[2]) : null, output: sum("output_tokens") };
  if (Object.values(normalized).some(value => value !== null && !Number.isSafeInteger(value))) return missing("usage counter overflow");
  return { usage: { engine, raw: samples.length === 1 ? samples[0] : { samples }, normalized }, usageReason: null };
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
export async function runSandboxed(command, args, repo, evidenceRoot, { env = process.env, reviewArtifacts = false } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-sandbox-temp-"));
  try {
  const roots = [...new Set([repo, tempRoot].map(resolvedLocation))];
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
  if (request.collect !== true) return (await verifyPreflight(request)).reason;
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
async function verifyPreflight(request, live = null) {
  if (live) {
    requireThat(request.head === live.head, "preflight request does not match live PR head");
    requireThat(/^[a-f0-9]{40}$/.test(live.baseRefOid ?? ""), "live PR base unavailable");
  }
  requireThat(typeof request.collect === "boolean", "explicit collect mode required (worker: false; orchestrator: true)");
  requireThat(typeof request.product === "string" && request.product.trim(), "dispatch product required");
  requireThat(new RegExp(`^preflight-collect:${request.head}:[1-9][0-9]*$`).test(request.collectionId ?? ""), "collectionId must be preflight-collect:<head>:<n>");
  requireThat(path.isAbsolute(request.skillsRoot ?? ""), "absolute installed skillsRoot required");
  requireThat(Array.isArray(request.workerWritableRoots), "dispatch workerWritableRoots required");
  requireThat(request.verification && Object.keys(request.verification).sort().join(",") === "args,command" &&
    typeof request.verification.command === "string" && request.verification.command.trim() &&
    Array.isArray(request.verification.args) && request.verification.args.every(arg => typeof arg === "string"),
    "verification must contain only command and string-array args");
  requireThat(request.critical === null || (typeof request.critical === "string" && request.critical.trim()), "dispatch critical must be null or an escalation reason");
  requireThat(/^[a-f0-9]{40}$/.test(request.head), "dispatch head required");
  const evidenceRoot = preflightEvidenceRoot(request);
  const repo = fs.realpathSync(request.worktree);
  cleanTree(repo);
  const head = git(repo, "rev-parse", "HEAD");
  requireThat(head === request.head, "head differs from collection/verification request");
  const baseTip = reviewBaseTip(repo, request.baseRef, live?.baseRefOid);
  const base = git(repo, "merge-base", head, baseTip);
  const receiptFile = path.join(evidenceRoot, `${head}.json`);
  const dataset = reviewDatasetBinding(request, evidenceRoot);
  const binding = { ...dataset, product: request.product, collectionId: request.collectionId, skillsRoot: request.skillsRoot, risk: request.risk,
    critical: request.critical, root: fs.realpathSync(request.root), worktree: repo, evidenceRoot,
    workerWritableRoots: request.workerWritableRoots.map(resolvedLocation).sort() };
  let receipt;
  if (request.collect === false) {
    regularEvidence(receiptFile); regularEvidence(path.join(evidenceRoot, "receipt.key"));
    const envelope = readJson(receiptFile);
    requireThat(envelope.signature === sign(evidenceKey(evidenceRoot, false), envelope.receipt), "hand-made or modified autoreview artifact");
    receipt = envelope.receipt;
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
  const route = reviewRoute(request.skillsRoot, request.risk, request.critical);
  const helper = fs.realpathSync(path.join(request.skillsRoot, "autoreview/scripts/autoreview"));
  validateEvidenceGrants(request.skillsRoot, [repo], "installed skillsRoot");
  validateEvidenceGrants(helper, [repo], "autoreview helper real path");
  const helperDigest = digest(fs.readFileSync(helper, "utf8"));
  const invocation = ["--mode", "branch", "--base", base, "--engine", "claude", "--model", route.model, "--thinking", route.effort, "--max-priority", "P2"];
  if (dataset.reviewDataset) invocation.push("--dataset", dataset.reviewDataset.copy);
  const unchanged = () => {
    requireThat(canonical(reviewDatasetBinding(request, evidenceRoot)) === canonical(dataset), "review dataset changed during collection/verification");
    cleanTree(repo);
    requireThat(git(repo, "rev-parse", "HEAD") === head && git(repo, "merge-base", head, live?.baseRefOid ?? request.baseRef) === base,
      "head or base changed during verification");
  };
  if (request.collect === true) {
    const archive = dataset.reviewDataset ? await archiveReviewDataset(dataset.reviewDataset.source, evidenceRoot) : null;
    if (archive) requireThat(archive.digest === dataset.reviewDataset.digest, "review dataset changed before archive");
    const verification = await runSandboxed(request.verification.command, request.verification.args, repo, evidenceRoot);
    let review = { exitCode: null, output: "", json: null, status: null };
    const consistency = { passed: true, error: null };
    const checkConsistency = () => {
      try { unchanged(); } catch (error) { consistency.passed = false; consistency.error ??= error.message; }
    };
    checkConsistency();
    if (verification.exitCode === 0 && consistency.passed) {
      const env = safeGitEnv();
      for (const key of ["AUTOREVIEW_FALLBACK_MODEL", "AUTOREVIEW_CLAUDE_FALLBACK_MODEL"]) delete env[key];
      const copy = dataset.reviewDataset ? path.join(repo, dataset.reviewDataset.copy) : null;
      const checkCopy = () => {
        if (copy) requireThat(fileDigest(copy) === dataset.reviewDataset.digest, "review dataset copy digest differs from source");
      };
      try {
        if (copy) {
          fs.mkdirSync(path.dirname(copy), { recursive: true });
          fs.copyFileSync(dataset.reviewDataset.source, copy);
        }
        checkCopy();
        review = await runSandboxed(helper, [...invocation, "--stream-engine-output"], repo, evidenceRoot, { env, reviewArtifacts: true });
        checkCopy();
      } catch (error) {
        consistency.passed = false; consistency.error ??= error.message;
      } finally {
        if (copy) { try { fs.unlinkSync(copy); } catch {} }
      }
    }
    requireThat(digest(fs.readFileSync(helper, "utf8")) === helperDigest, "autoreview helper changed during collection");
    checkConsistency();
    Object.assign(review, parseReviewUsage(review.output, "claude"));
    receipt = { producer: "gate-autoreview-v2", ...binding, runId: crypto.randomUUID(), head, base, route, helper, helperDigest, invocation: [...invocation, "--stream-engine-output"],
      verification, review, consistency, loop: { iterations: review.exitCode === null ? 0 : 1, disposition: review.exitCode === 0 && consistency.passed ? "clean" : "failed", residualFindings: review.json?.findings ?? ["missing structured report"] } };
    if (archive) receipt.reviewDataset = { ...receipt.reviewDataset, ...archive };
    if (fs.existsSync(path.join(evidenceRoot, "receipt.key"))) regularEvidence(path.join(evidenceRoot, "receipt.key"));
    const key = evidenceKey(evidenceRoot, true);
    atomicJson(path.join(evidenceRoot, "history", `${receipt.runId}.json`), { receipt, signature: sign(key, receipt) });
    atomicJson(receiptFile, { receipt, signature: sign(key, receipt) });
  }
  requireThat(receipt.producer === "gate-autoreview-v2" && receipt.helper === helper && receipt.helperDigest === helperDigest &&
    validReviewInvocation(receipt.invocation, invocation), "autoreview artifact provenance/command mismatch");
  requireThat(receipt.consistency?.passed === true && receipt.consistency.error === null, "collection consistency failed or missing");
  requireThat(receipt.verification.exitCode === 0, "local verification failed or missing");
  requireThat(receipt.verification.sandbox?.mode === "workspace-write" && receipt.verification.sandbox.probed === true, "verification sandbox proof missing");
  requireThat(receipt.review.sandbox?.mode === "workspace-write" && receipt.review.sandbox.probed === true, "autoreview sandbox proof missing");
  requireThat(receipt.review.exitCode === 0, "autoreview failed or incomplete");
  requireThat(receipt.review.json && receipt.review.status?.schema_version === 1 && receipt.review.status.exit_code === 0 &&
    receipt.review.status.engine === "claude" && ["clean", "scoped-clean", "filtered"].includes(receipt.review.status.status) &&
    receipt.review.status.report_produced === true && receipt.review.status.timed_out === false, "incomplete or non-clean helper output/status artifact");
  unchanged();
  const reason = validatePreflight(receipt, head, base, route);
  return { reason, receipt: { path: receiptFile, runId: receipt.runId, digest: digest(receipt) } };
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
export async function shipGate(request) {
  const config = deliveryConfig(request.config);
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
      const now = Date.now(); const state = { ...advanceEvidence(previous, { ...snapshot, preflightReceipt: proof.receipt, judgment, policy: request.policy ?? {} }, now), scope, preflightReceipt: proof.receipt, rules: snapshot.rules };
      atomicJson(request.stateFile, state); previous = state;
      requireThat(now - state.startedAt < config.evidenceLimitSec * 1000, "evidence-limit: предел доказательств");
      evaluateShip(snapshot, judgment, request.policy);
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
start request: {worktree, branch, base, lock, packVersion, sourceCommit, surfaceRevision}
preflight request: {product,collectionId,root,worktree,head,skillsRoot,risk,critical,baseRef,evidenceRoot,workerWritableRoots:[],reviewDataset?,collect,verification:{command,args}}
  risk is the final approved/diff risk; critical is a concrete escalation reason or null.
  Pin every request field from dispatch. Orchestrator only: collect:true, outside worker sandboxes.
  Worker only: collect:false, reads <evidenceRoot>/<head>.json without creating files.
  Use ~/.mono-agent-workflow/evidence/<product>/ outside EVERY worker-writable root,
  including worktree, orchestrator root and additional workerWritableRoots. Pin that list in dispatch.
  Collection grants only the worktree and one private temp directory; workerWritableRoots only excludes evidenceRoot.
  Run verification AND the installed helper there with evidence-write denial probes, independent of command exit codes.
  Optional reviewDataset: absolute source under evidenceRoot; bind receipt reviewDataset:{source,digest,copy}.
  Copy to .orchestrator/review-dataset-<digest8>.md for repo-relative --dataset; check digest before/after helper and remove the copy.
  Review uses policy flags/P2; filtered P3 findings are advisory; preserve failed receipts/history. Sandbox failure fails closed.
  The sandbox write boundary is the trust anchor; the key may be readable but receipts are not worker-writable.
ship request: {preflight:<complete preflight collect:false request>, repo:"owner/repo", number:123, attempt:1, stateFile:"/absolute/file", judgmentFile:"/absolute/file", config:"/project/.agents/mono-workflow.config.json", watch:true, policy:{requiredChecks:[],nonBlockingChecks:[{name,reason}],botChecks:["Greptile Review"],botUnavailable:null}}
  Refresh remote-tracking baseRef; bind receipts to head/merge-base, not the moving base tip.
  Ship uses the live PR base tip for merge-base; require that sealed proof before judgment and record its path.
  policy exceptions must come from the repository's accepted policy, never worker convenience.
  judgment: {head,preShipReview:"выполнено",readinessCheck:"пройдена",documentation:"выполнен на этой голове|без изменений|намеренно недоступен",documentationReason,closures:[{threadId,replyId}],botRemarks:[{id,commentDigest,outcome:"fixed|rejected|deferred|informational",evidence}]}
  Compute commentDigest with exported botRemarkDigest(comment) on each latest readShipSnapshot bot comment; re-inspect any edited comment.
  config.orchestration.delivery: confirmationTimeoutSec=900, quietSec=120,
  evidenceLimitSec=2400, pollSec=10, attemptCap=3. Positive seconds/counts only.
  Never delete stateFile to reset a deadline. Start a new attempt only through orchestrator recovery.`);
    else {
      requireThat(["start", "preflight", "ship"].includes(name), "unknown gate");
      const request = readJson(args.request);
      const reason = name === "start" ? startGate(request) : name === "preflight" ? await preflightGate(request) : await shipGate(request);
      console.log(`gate ${name}: pass: ${reason}`);
    }
  } catch (error) { console.log(`gate ${name}: fail: ${error.message.replace(/\s+/g, " ")}`); process.exitCode = 1; }
}
