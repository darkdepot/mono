import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { atomicJson, readJson, identity, requireCompatiblePack, syncDir, withLock, deliveryConfig, canonical, resolvedLocation, validateEvidenceGrants, digest, resolveModelRoutes, baseModelConfig, processStart, packLayout, runtimePackRoot } from "../runtime.mjs";
import { startGate } from "../gate.mjs";
import crypto from "node:crypto";
import os from "node:os";
import { workerTransport } from "../worker-transport.mjs";
import { effectivePins, attemptState } from "./command-state.mjs";

function releasePin(request) {
  if (!request.pins) return false;
  const bytes = fs.readFileSync(request.pins.file);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== request.pins.digest) throw new Error("dispatch pins digest mismatch");
  const release = JSON.parse(bytes).release;
  if (release !== undefined && typeof release !== "boolean") throw new Error("release pin must be boolean");
  return release ?? false;
}

export function guard(root, resume = false) {
  const control = readJson(path.join(root, "control.json"));
  if (control.halt !== undefined && typeof control.halt !== "boolean") throw new Error("control.halt must be boolean");
  if (control.halt === true) throw new Error("halt: new spawns and resumes are disabled; running workers are untouched");
  if (control.state !== "active" && !(resume && control.state === "draining")) throw new Error(`control state ${control.state} refuses ${resume ? "resume" : "spawn"}`);
}
function checkRequest(request) {
  if (!path.isAbsolute(request.root ?? "") || !/^[A-Z][A-Z0-9]*-\d+$/.test(request.issue)) throw new Error("root/issue required");
}
function deliveryLaunch(request, transport) {
  const handshake = request.handshake ?? "resume", profile = request.profile ?? "full";
  if (!transport.handshakeModes.includes(handshake)) throw new Error(transport.transport + " requires handshake " + transport.handshakeModes.join(" or "));
  if (!["short", "full"].includes(profile)) throw new Error("invalid profile");
  if (profile === "short" && (!["tiny", "standard"].includes(request.risk) || request.critical !== null ||
      request.afk !== true || request.openDecisions !== 0)) throw new Error("short requires tiny/standard, critical null, afk true and openDecisions 0");
  if (request.pinsVersion !== undefined && request.pinsVersion !== 0) throw new Error("launch pinsVersion must be 0");
  const pins = request.pins ?? null;
  if (pins !== null && (!path.isAbsolute(pins.file ?? "") || !/^[a-f0-9]{64}$/.test(pins.digest ?? "") ||
      crypto.createHash("sha256").update(fs.readFileSync(pins.file)).digest("hex") !== pins.digest)) throw new Error("dispatch pins digest mismatch");
  if (pins === null && (handshake === "wait" || profile === "short")) throw new Error("dispatch pins required for wait/short");
  return { handshake, profile, pins, pinsVersion: 0 };
}
function selectedTransport(request) {
  const config = baseModelConfig(request.worktree, request.base);
  const transport = config.orchestration?.transport ?? 'codex-cli';
  if (request.transport !== undefined && request.transport !== transport) throw new Error('request transport conflicts with immutable BASE config');
  const implementation = workerTransport(transport);
  if (!implementation?.workerRoles.includes(request.role)) throw new Error('unsupported worker role/transport for managed launch');
  return implementation;
}
export function resolveWorkerPins(request) {
  const transport = selectedTransport(request);
  const modelRoutes = resolveModelRoutes(request.worktree, request.base, request.role, { packRoot: request.packRoot });
  transport.validateRoute?.(modelRoutes.roles[request.role]);
  if (request.modelRoutes && canonical(request.modelRoutes) !== canonical(modelRoutes)) throw new Error('dispatch model route fingerprint mismatch');
  return modelRoutes;
}

export function workerEnvironment(route, source = process.env) {
  return workerTransport("codex-cli").environment(route, source);
}

function appendLog(file, event) {
  const fd = fs.openSync(file, "a", 0o600);
  try { fs.writeSync(fd, JSON.stringify(event) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(path.dirname(file));
}
function effectiveGrants(entry, root, extraWritable = [], pins = entry.workerWritableRoots) {
  if (!Array.isArray(extraWritable) || !Array.isArray(pins)) throw new Error("complete dispatch workerWritableRoots required");
  const gitDirs = [["--absolute-git-dir"], ["--path-format=absolute", "--git-common-dir"]].map(args => {
    const directory = worktreeGit(entry.worktree, args);
    if (!path.isAbsolute(directory)) throw new Error("Git directory must be absolute");
    return fs.realpathSync(directory);
  });
  const normalize = values => [...new Set(values.map(resolvedLocation))].sort();
  const roots = normalize([entry.worktree, path.join(root, "reports"), ...gitDirs, ...entry.writable_roots, ...extraWritable]);
  validateEvidenceGrants(entry.evidenceRoot, roots);
  const controlRoot = resolvedLocation(root), mailbox = resolvedLocation(path.join(root, "reports"));
  for (const grant of roots) {
    const overlaps = grant === controlRoot || controlRoot.startsWith(grant + path.sep) || grant.startsWith(controlRoot + path.sep);
    if (overlaps && grant !== mailbox && !grant.startsWith(mailbox + path.sep)) throw new Error("only reports may be worker-writable within orchestrator root");
  }
  const packRoot = entry.packRoot;
  const skills = entry.skillsRoot;
  validateEvidenceGrants(packRoot, roots, packRoot !== skills ? "packRoot" : "installed skillsRoot");
  validateEvidenceGrants(skills, roots, "installed skillsRoot");
  validateEvidenceGrants(path.join(skills, "autoreview/scripts/autoreview"), roots, "autoreview helper real path");
  if (canonical(roots) !== canonical(normalize(pins))) throw new Error("effective write grants differ from dispatch workerWritableRoots");
  if (entry.transport === "claude-cli" &&
      canonical(roots) !== canonical(normalize(entry.pins ? effectivePins(entry).workerWritableRoots : entry.workerWritableRoots)))
    throw new Error("effective write grants differ from immutable attempt pins");
  workerTransport(entry.transport)?.validateGrants?.(roots);
  return roots;
}
function worktreeGit(worktree, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" });
  try {
    return execFileSync("git", ["rev-parse", ...args], { cwd: worktree, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    throw new Error(`Cannot read worktree Git ${args.join(" ")}: ${error.message}`);
  }
}
function managedSettings(entry, root, roots, transport) {
  if (!transport.settings) return;
  const directory = path.join(root, "managed-settings");
  validateEvidenceGrants(directory, roots, "managed settings");
  entry.settingsFile = path.join(directory, entry.issue + "-a" + entry.attempt + ".json");
  const protectedPaths = [entry.packRoot, entry.skillsRoot, entry.evidenceRoot,
    path.join(os.homedir(), ".claude"), path.join(os.homedir(), ".claude.json"),
    ...fs.readdirSync(root).filter(name => name !== "reports").map(name => path.join(root, name)), directory];
  atomicJson(entry.settingsFile, transport.settings(roots, [...new Set(protectedPaths.map(resolvedLocation))], entry.githubCredentialPaths));
}
function temporaryDirectory(transport, entry, roots) {
  return transport.temporaryDirectory?.(roots) ?? roots.find(root => root === resolvedLocation(os.tmpdir())) ?? entry.worktree;
}
async function launchTransport(root, entry, prompt, resume, prepared) {
  const registryPath = path.join(root, "workers.json");
  const readRegistry = () => readJson(registryPath);
  const roots = effectiveGrants(entry, root);
  let gateAckDigest = null;
  if (resume && entry.gates?.length) {
    const candidates = [path.join(root, "reports", `${entry.issue}-gate-ack-a${entry.attempt}.json`),
      path.join(entry.worktree, ".orchestrator", `${entry.issue}-gate-ack-a${entry.attempt}.json`)].filter(file => fs.existsSync(file));
    if (candidates.length > 1) throw new Error("gate ack present in both locations");
    if (candidates.length === 1) gateAckDigest = digest(readJson(candidates[0]));
  }
  const transport = workerTransport(entry.transport) ?? workerTransport("codex-cli");
  managedSettings(entry, root, roots, transport);
  const invocation = transport.invocation(entry, { reportsDir: path.join(root, "reports"), roots, prompt, resume });
  guard(root, resume);
  const logOffset = fs.statSync(entry.log).size;
  const piped = invocation.stdin !== undefined;
  const stdout = piped ? null : fs.openSync(entry.log, "a"), stderr = piped ? null : fs.openSync(entry.log.replace(/\.jsonl$/, ".stderr.log"), "a", 0o600);
  let child;
  try {
    const command = piped ? process.execPath : invocation.command;
    const args = piped ? [path.join(entry.packRoot, transport.journalRunner), entry.log,
      entry.log.replace(/\.jsonl$/, ".stderr.log"), invocation.command, ...invocation.args] : invocation.args;
    child = spawn(command, args, { cwd: entry.worktree, detached: true,
      stdio: piped ? ["pipe", "ignore", "ignore"] : ["ignore", stdout, stderr],
      env: transport.environment(entry.modelRoutes?.roles[entry.model_policy.role], process.env,
        { ...prepared, timeoutSec: entry.confirmationTimeoutSec, tempDir: temporaryDirectory(transport, entry, roots) }) });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    if (piped) {
      child.stdin.on("error", error => { if (error.code !== "EPIPE") child.kill("SIGTERM"); });
      child.stdin.end(invocation.stdin);
    }
  } finally { if (stdout !== null) fs.closeSync(stdout); if (stderr !== null) fs.closeSync(stderr); }
  child.unref();
  const registry = readRegistry();
  registry[entry.issue].pid = child.pid; registry[entry.issue].last_activity_at = new Date().toISOString();
  if (transport.assertStopped) registry[entry.issue].processGroup = child.pid;
  const procStart = processStart(child.pid);
  if (resume) registry[entry.issue].procStart = procStart;
  if (resume) registry[entry.issue].last_resume = { pid: child.pid, thread_id: entry.thread_id,
    registeredAt: registry[entry.issue].last_activity_at, gateAckDigest };
  atomicJson(registryPath, registry);
  return { pid: child.pid, thread_id: entry.thread_id, procStart, logOffset };
}
async function waitForThread(root, entry, pid, launchedStart, logOffset = 0) {
  const registryPath = path.join(root, "workers.json");
  const transport = workerTransport(entry.transport);
  const deadline = Date.now() + (transport.startupTimeoutMs ?? 120_000);
  let offset = transport.startupEvent ? logOffset : 0, pending = Buffer.alloc(0), threadId = null;
  const state = {};
  while (Date.now() < deadline) {
    const fd = fs.openSync(entry.log, "r"); const buffer = Buffer.alloc(1024 * 1024); let size;
    try {
      if (fs.fstatSync(fd).size < offset) { offset = 0; pending = Buffer.alloc(0); }
      size = fs.readSync(fd, buffer, 0, buffer.length, offset); offset += size;
    } finally { fs.closeSync(fd); }
    pending = Buffer.concat([pending, buffer.subarray(0, size)]);
    let newline;
    while ((newline = pending.indexOf(10)) !== -1) {
      const line = pending.subarray(0, newline).toString("utf8"); pending = pending.subarray(newline + 1);
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (transport.startupEvent) {
        try { if (transport.startupEvent(event, entry, state)) threadId = state.identity.thread_id; }
        catch (error) { error.observedIdentity = state.identity; throw error; }
      } else {
        const observed = transport.startIdentity(event);
        if (observed) threadId = observed.thread_id;
      }
    }
    if (threadId) {
      try {
        return await withLock(path.join(root, "launch.lock"), () => {
          const current = readJson(registryPath), writer = current[entry.issue];
          if (!writer || writer.attempt !== entry.attempt || writer.pid !== pid ||
              (writer.thread_id && writer.thread_id !== threadId)) throw new Error("startup writer changed before thread registration");
          const currentStart = processStart(pid);
          if (launchedStart && currentStart && currentStart !== launchedStart) throw new Error("startup writer process changed before thread registration");
          writer.thread_id = threadId; writer.procStart = currentStart ?? launchedStart;
          if (transport.startupEvent) {
            writer.model_launch.actual_model = state.identity.model;
            writer.model_launch.evidence = "claude-cli init identity and first successful assistant response";
            writer.startup = { status: "ready", identity: state.identity, first_response: true };
          }
          if (writer.handshake === "wait" && !writer.procStart) throw new Error("waiting writer process start unavailable");
          atomicJson(registryPath, current);
          return { pid, thread_id: threadId };
        });
      } catch (error) { if (error.code !== "ELOCKED") throw error; }
    }
    try { process.kill(pid, 0); } catch {
      if (transport.startupEvent) throw new Error(state.identity ? "Claude startup missing first successful response; inspect retained logs and retry"
        : "Claude startup missing identity; inspect retained logs and retry");
      throw new Error("spawn-fail: process " + pid + " exited before thread.started; attempt retained");
    }
    await new Promise(resolve => setTimeout(resolve, transport.startupEvent ? 50 : 1000));
  }
  throw new Error(transport.startupEvent ? state.identity
    ? "Claude startup missing first successful response in startup window; inspect retained logs and retry"
    : "Claude startup missing identity in startup window; inspect retained logs and retry"
    : "spawn-fail: no thread.started within 120 seconds; inspect retained attempt and pid " + pid);
}
async function confirmStartup(root, entry, launched) {
  try { return await waitForThread(root, entry, launched.pid, launched.procStart, launched.logOffset); }
  catch (error) {
    if (workerTransport(entry.transport)?.startupEvent) {
      try { process.kill(launched.pid, "SIGTERM"); } catch (cause) { if (cause.code !== "ESRCH") throw cause; }
      await withLock(path.join(root, "launch.lock"), () => {
        const file = path.join(root, "workers.json"), registry = readJson(file);
        if (registry[entry.issue]?.attempt === entry.attempt && registry[entry.issue].pid === launched.pid) {
          registry[entry.issue].startup = { status: "refused", reason: error.message, identity: error.observedIdentity ?? null };
          registry[entry.issue].model_launch.actual_model = error.observedIdentity?.model ?? null;
          atomicJson(file, registry);
        }
      });
    }
    throw error;
  }
}
function checkReleaseAvailability(root, registry, issue) {
  const existing = Object.values(registry).find(entry => entry.issue !== issue && entry.pins &&
    effectivePins(entry).release === true && attemptState(root, entry).state === "active");
  if (existing) throw new Error(`release task already registered: ${existing.issue}; retire it before another release`);
}
export function checkSpawnAvailability(request) {
  guard(request.root);
  const file = path.join(request.root, "workers.json"), registry = readJson(file);
  if (registry[request.issue]) throw new Error("Issue already registered; reconcile and retire before another attempt");
  if (releasePin(request)) checkReleaseAvailability(request.root, registry, request.issue);
  const attemptsFile = path.join(request.root, "attempts.json");
  const attempts = fs.existsSync(attemptsFile) ? readJson(attemptsFile) : {};
  const used = attempts[request.issue] ?? 0;
  if (!Number.isInteger(used) || used < 0) throw new Error("invalid attempt registry");
  if (used >= deliveryConfig(request.config).attemptCap) throw new Error("attempt cap reached");
  return { file, registry, attemptsFile, attempts, used };
}
export async function spawnWorker(request, preparation = {}) {
  checkRequest(request);
  const transport = selectedTransport(request);
  const launch = deliveryLaunch(request, transport);
  const modelRoutes = resolveWorkerPins(request);
  guard(request.root);
  const launched = await withLock(path.join(request.root, "launch.lock"), async () => {
    const { file, registry, attemptsFile, attempts, used } = checkSpawnAvailability(request);
    try {
      await preparation.beforeStart?.();
      startGate(request);
      if (!path.isAbsolute(request.dispatchFile ?? "")) throw new Error("absolute dispatch file required");
      const prompt = fs.readFileSync(request.dispatchFile, "utf8");
      const model_policy = { role: request.role, ...modelRoutes.roles[request.role] };
      if (request.role === "worker-complex" && !request.modelReason?.trim()) throw new Error("complex worker selection requires a recorded reason");
      if (!Array.isArray(request.writable_roots) || request.writable_roots.some(p => !path.isAbsolute(p))) throw new Error("explicit writable roots required");
      fs.mkdirSync(path.join(request.root, "reports"), { recursive: true });
      const roots = effectiveGrants(request, request.root);
      let prepared;
      try {
        prepared = transport.prepare?.(model_policy, { cwd: request.worktree,
          timeoutSec: deliveryConfig(request.config).confirmationTimeoutSec,
          roots, tempDir: temporaryDirectory(transport, request, roots) });
      } catch (error) {
        atomicJson(path.join(request.root, "launch-refusals", request.issue + "-a" + (used + 1) + ".json"),
          { issue: request.issue, status: "refused", action: error.message, attempt_registered: false });
        throw error;
      }
      const gates = request.gates ?? [];
      if (!Array.isArray(gates) || gates.some(g => typeof g !== "string" || !g.trim()) || new Set(gates).size !== gates.length) throw new Error("invalid dispatched gate list");
      if (!Array.isArray(request.lifecycle_moves) || (request.lifecycle_moves.length > 0 && gates.length === 0)) throw new Error("lifecycle moves require startup gates");
      const attempt = used + 1;
      const log = path.join(request.root, "logs", `${request.issue}-mono-deliver-a${attempt}.jsonl`);
      fs.mkdirSync(path.dirname(log), { recursive: true });
      const fd = fs.openSync(log, "wx", 0o600); fs.fsyncSync(fd); fs.closeSync(fd); syncDir(path.dirname(log));
      const model_launch = { case: transport.transport, model_parameter: model_policy.model, effort_parameter: model_policy.effort,
        effort_source: "explicit", actual_model: null, evidence: "requested command parameters" };
      if (prepared) Object.assign(model_launch, { effort_source: "requested", effort_observed: null,
        auth_requested: prepared.auth.requested, auth_observed: prepared.auth.observed, auth_confirmed: prepared.auth.positive });
      const entry = { issue: request.issue, transport: transport.transport, stage: "mono-deliver", attempt, ...launch,
        thread_id: transport.startupEvent ? crypto.randomUUID() : null, pid: null, worktree: request.worktree, branch: request.branch, product_name: request.product_name,
        packVersion: request.packVersion, sourceCommit: request.sourceCommit, surfaceRevision: request.surfaceRevision,
        packRoot: request.packRoot,
        skillsRoot: request.skillsRoot, spawned_at: new Date().toISOString(), last_activity_at: null, log,
        modelRoutes, model_policy, model_launch, model: model_policy.model, effort: model_policy.effort,
        writable_roots: roots, workerWritableRoots: roots, evidenceRoot: resolvedLocation(request.evidenceRoot), network_access: true, lifecycle_moves: request.lifecycle_moves,
        confirmationTimeoutSec: deliveryConfig(request.config).confirmationTimeoutSec,
        capsule: { phase: "code", head: worktreeGit(request.worktree, ["HEAD"]),
          open_queue: [], decisions: [], writable_roots: roots } };
      if (gates.length) entry.gates = gates;
      if (prepared?.credentialPaths) entry.githubCredentialPaths = prepared.credentialPaths;
      if (prepared?.githubConfigDir) entry.githubConfigDir = prepared.githubConfigDir;
      managedSettings(entry, request.root, roots, transport);
      attempts[request.issue] = attempt; atomicJson(attemptsFile, attempts);
      registry[request.issue] = entry; atomicJson(file, registry);
      appendLog(log, { type: "mono.launch", timestamp: entry.spawned_at, issue: entry.issue, attempt, modelRoutes, model_policy, model_launch,
        model: entry.model, effort: entry.effort });
      return { entry, ...await launchTransport(request.root, entry, prompt, false, prepared) };
    } catch (error) {
      await preparation.onRefusal?.();
      throw error;
    }
  });
  return { attempt: launched.entry.attempt, ...await confirmStartup(request.root, launched.entry, launched) };
}
export async function resumeWorker(request) {
  checkRequest(request); guard(request.root, true);
  const launched = await withLock(path.join(request.root, "launch.lock"), async () => {
    guard(request.root, true);
    const entry = readJson(path.join(request.root, "workers.json"))[request.issue];
    if (!entry || !identity(entry) || !entry.thread_id || entry.stage !== "mono-deliver") throw new Error("no resumable delivery thread");
    if (entry.pid) {
      try { process.kill(entry.pid, 0); throw new Error("worker process is still live; resume refused"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    if (entry.pins && effectivePins(entry).release === true)
      checkReleaseAvailability(request.root, readJson(path.join(request.root, "workers.json")), entry.issue);
    if (!entry.model_launch?.model_parameter || !entry.model_launch?.effort_parameter) throw new Error("missing launch pins; never backfill a resume from current policy");
    packLayout(entry.packRoot);
    const installed = packLayout(runtimePackRoot()).identity();
    requireCompatiblePack(installed, entry);
    const prompt = fs.readFileSync(request.resumeFile, "utf8");
    if (request.network_access !== undefined && typeof request.network_access !== "boolean") throw new Error("network_access override must be boolean");
    const roots = effectiveGrants(entry, request.root, request.extraWritable ?? [], request.workerWritableRoots ?? entry.workerWritableRoots);
    const transport = workerTransport(entry.transport) ?? workerTransport("codex-cli");
    transport.assertStopped?.(entry);
    if (transport.startupEvent && !transport.workerRoles.includes(entry.model_policy.role)) throw new Error("registered worker role/transport mismatch");
    if (transport.prepare && !path.isAbsolute(entry.githubConfigDir ?? ""))
      throw new Error("GitHub private configuration directory missing; reconcile the pinned attempt before resume");
    transport.validateRoute?.(entry.modelRoutes?.roles[entry.model_policy.role]);
    const prepared = transport.prepare?.(entry.modelRoutes.roles[entry.model_policy.role], { cwd: entry.worktree,
      timeoutSec: entry.confirmationTimeoutSec, roots, tempDir: temporaryDirectory(transport, entry, roots),
      githubConfigDir: entry.githubConfigDir, previousCredentialPaths: entry.githubCredentialPaths });
    const updated = { ...entry, capsule: { ...entry.capsule, writable_roots: roots }, writable_roots: roots, workerWritableRoots: roots, network_access: request.network_access ?? entry.network_access };
    if (prepared?.credentialPaths) updated.githubCredentialPaths = [...new Set([...(entry.githubCredentialPaths ?? []), ...prepared.credentialPaths])];
    const registry = readJson(path.join(request.root, "workers.json")); registry[request.issue] = updated;
    atomicJson(path.join(request.root, "workers.json"), registry);
    return { entry: updated, ...await launchTransport(request.root, updated, prompt, true, prepared) };
  });
  if (workerTransport(launched.entry.transport)?.startupEvent) return confirmStartup(request.root, launched.entry, launched);
  return { pid: launched.pid, thread_id: launched.thread_id, procStart: launched.procStart };
}
