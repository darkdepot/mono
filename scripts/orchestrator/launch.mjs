import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { atomicJson, readJson, identity, syncDir, withLock, deliveryConfig, canonical, resolvedLocation, validateEvidenceGrants, digest } from "../runtime.mjs";
import { startGate } from "../gate.mjs";

export function guard(root, resume = false) {
  const control = readJson(path.join(root, "control.json"));
  if (control.halt !== undefined && typeof control.halt !== "boolean") throw new Error("control.halt must be boolean");
  if (control.halt === true) throw new Error("halt: new spawns and resumes are disabled; running workers are untouched");
  if (control.state !== "active" && !(resume && control.state === "draining")) throw new Error(`control state ${control.state} refuses ${resume ? "resume" : "spawn"}`);
}
function checkRequest(request) {
  if (!path.isAbsolute(request.root ?? "") || !/^[A-Z][A-Z0-9]*-\d+$/.test(request.issue)) throw new Error("root/issue required");
}
function policyRow(skillsRoot, role) {
  if (!["worker-default", "worker-complex"].includes(role)) throw new Error("invalid Codex worker role");
  const text = fs.readFileSync(path.join(skillsRoot, "mono-implement/references/model-policy.md"), "utf8");
  const line = text.split("\n").find(line => line.startsWith(`| \`${role}\` |`));
  const cells = line?.split("|").slice(1, 4).map(cell => cell.trim().replaceAll("`", ""));
  if (!cells || cells.length !== 3) throw new Error("worker policy row unavailable");
  return { role: cells[0], model: cells[1], effort: cells[2] };
}
function appendLog(file, event) {
  const fd = fs.openSync(file, "a", 0o600);
  try { fs.writeSync(fd, JSON.stringify(event) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(path.dirname(file));
}
function effectiveGrants(entry, root, extraWritable = [], pins = entry.workerWritableRoots) {
  if (!Array.isArray(extraWritable) || !Array.isArray(pins)) throw new Error("complete dispatch workerWritableRoots required");
  const normalize = values => [...new Set(values.map(resolvedLocation))].sort();
  const roots = normalize([entry.worktree, path.join(root, "reports"), ...entry.writable_roots, ...extraWritable]);
  validateEvidenceGrants(entry.evidenceRoot, roots);
  const controlRoot = resolvedLocation(root), mailbox = resolvedLocation(path.join(root, "reports"));
  for (const grant of roots) {
    const overlaps = grant === controlRoot || controlRoot.startsWith(grant + path.sep) || grant.startsWith(controlRoot + path.sep);
    if (overlaps && grant !== mailbox && !grant.startsWith(mailbox + path.sep)) throw new Error("only reports may be worker-writable within orchestrator root");
  }
  const skills = path.dirname(entry.lock);
  validateEvidenceGrants(skills, roots, "installed skillsRoot");
  validateEvidenceGrants(path.join(skills, "autoreview/scripts/autoreview"), roots, "autoreview helper real path");
  if (canonical(roots) !== canonical(normalize(pins))) throw new Error("effective write grants differ from dispatch workerWritableRoots");
  return roots;
}
async function launchCodex(root, entry, prompt, resume) {
  const registryPath = path.join(root, "workers.json");
  const readRegistry = () => readJson(registryPath);
  const model = entry.model_launch.model_parameter, effort = entry.model_launch.effort_parameter;
  const roots = effectiveGrants(entry, root);
  let gateAckDigest = null;
  if (resume && entry.gates?.length) {
    const candidates = [path.join(root, "reports", `${entry.issue}-gate-ack-a${entry.attempt}.json`),
      path.join(entry.worktree, ".orchestrator", `${entry.issue}-gate-ack-a${entry.attempt}.json`)].filter(file => fs.existsSync(file));
    if (candidates.length > 1) throw new Error("gate ack present in both locations");
    if (candidates.length === 1) gateAckDigest = digest(readJson(candidates[0]));
  }
  const args = resume ? ["exec", "resume", entry.thread_id, "--json"] : ["exec", "--json", "--cd", entry.worktree];
  if (!resume) args.push("--add-dir", path.join(root, "reports"));
  args.push("-c", `model=${JSON.stringify(model)}`, "-c", `model_reasoning_effort=${JSON.stringify(effort)}`,
    "-c", 'sandbox_mode="workspace-write"', "-c", `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`,
    "-c", `sandbox_workspace_write.network_access=${entry.network_access === true}`, prompt);
  guard(root, resume);
  const stdout = fs.openSync(entry.log, "a"), stderr = fs.openSync(entry.log.replace(/\.jsonl$/, ".stderr.log"), "a", 0o600);
  let child;
  try {
    child = spawn("codex", args, { cwd: entry.worktree, detached: true, stdio: ["ignore", stdout, stderr] });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  child.unref();
  const registry = readRegistry();
  registry[entry.issue].pid = child.pid; registry[entry.issue].last_activity_at = new Date().toISOString();
  if (resume) registry[entry.issue].last_resume = { pid: child.pid, thread_id: entry.thread_id,
    registeredAt: registry[entry.issue].last_activity_at, gateAckDigest };
  atomicJson(registryPath, registry);
  return { pid: child.pid, thread_id: entry.thread_id };
}
async function waitForThread(root, entry, pid) {
  const registryPath = path.join(root, "workers.json");
  const deadline = Date.now() + 120_000;
  let offset = 0, pending = Buffer.alloc(0), threadId = null;
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
      if (event.type === "thread.started" && typeof event.thread_id === "string" && event.thread_id) threadId = event.thread_id;
    }
    if (threadId) {
      try {
        return await withLock(path.join(root, "launch.lock"), () => {
          const current = readJson(registryPath), writer = current[entry.issue];
          if (!writer || writer.attempt !== entry.attempt || writer.pid !== pid ||
              (writer.thread_id && writer.thread_id !== threadId)) throw new Error("startup writer changed before thread registration");
          writer.thread_id = threadId; atomicJson(registryPath, current);
          return { pid, thread_id: threadId };
        });
      } catch (error) { if (error.code !== "ELOCKED") throw error; }
    }
    try { process.kill(pid, 0); } catch { throw new Error(`spawn-fail: process ${pid} exited before thread.started; attempt retained`); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`spawn-fail: no thread.started within 120 seconds; inspect retained attempt and pid ${pid}`);
}
export async function spawnWorker(request) {
  checkRequest(request); guard(request.root);
  const launched = await withLock(path.join(request.root, "launch.lock"), async () => {
    guard(request.root);
    const file = path.join(request.root, "workers.json"), registry = readJson(file);
    if (registry[request.issue]) throw new Error("Issue already registered; reconcile and retire before another attempt");
    const attemptsFile = path.join(request.root, "attempts.json");
    const attempts = fs.existsSync(attemptsFile) ? readJson(attemptsFile) : {};
    const used = attempts[request.issue] ?? 0;
    if (!Number.isInteger(used) || used < 0) throw new Error("invalid attempt registry");
    if (used >= deliveryConfig(request.config).attemptCap) throw new Error("attempt cap reached");
    startGate(request);
    if (!path.isAbsolute(request.dispatchFile ?? "")) throw new Error("absolute dispatch file required");
    const prompt = fs.readFileSync(request.dispatchFile, "utf8");
    const model_policy = policyRow(path.dirname(request.lock), request.role);
    if (request.role === "worker-complex" && !request.modelReason?.trim()) throw new Error("complex worker selection requires a recorded reason");
    if (!Array.isArray(request.writable_roots) || request.writable_roots.some(p => !path.isAbsolute(p))) throw new Error("explicit writable roots required");
    fs.mkdirSync(path.join(request.root, "reports"), { recursive: true });
    const roots = effectiveGrants(request, request.root);
    const gates = request.gates ?? [];
    if (!Array.isArray(gates) || gates.some(g => typeof g !== "string" || !g.trim()) || new Set(gates).size !== gates.length) throw new Error("invalid dispatched gate list");
    if (!Array.isArray(request.lifecycle_moves) || (request.lifecycle_moves.length > 0 && gates.length === 0)) throw new Error("lifecycle moves require startup gates");
    const attempt = used + 1;
    const log = path.join(request.root, "logs", `${request.issue}-mono-deliver-a${attempt}.jsonl`);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const fd = fs.openSync(log, "wx", 0o600); fs.fsyncSync(fd); fs.closeSync(fd); syncDir(path.dirname(log));
    const model_launch = { case: "codex-cli", model_parameter: model_policy.model, effort_parameter: model_policy.effort,
      effort_source: "explicit", actual_model: null, evidence: "requested command parameters" };
    const entry = { issue: request.issue, transport: "codex-cli", stage: "mono-deliver", attempt,
      thread_id: null, pid: null, worktree: request.worktree, branch: request.branch, product_name: request.product_name,
      packVersion: request.packVersion, sourceCommit: request.sourceCommit, surfaceRevision: request.surfaceRevision,
      lock: request.lock, spawned_at: new Date().toISOString(), last_activity_at: null, log,
      model_policy, model_launch, model: model_policy.model, effort: model_policy.effort,
      writable_roots: roots, workerWritableRoots: roots, evidenceRoot: resolvedLocation(request.evidenceRoot), network_access: true, lifecycle_moves: request.lifecycle_moves,
      confirmationTimeoutSec: deliveryConfig(request.config).confirmationTimeoutSec,
      capsule: { phase: "code", head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: request.worktree, encoding: "utf8" }).trim(),
        open_queue: [], decisions: [], writable_roots: roots } };
    if (gates.length) entry.gates = gates;
    attempts[request.issue] = attempt; atomicJson(attemptsFile, attempts);
    registry[request.issue] = entry; atomicJson(file, registry);
    appendLog(log, { type: "mono.launch", timestamp: entry.spawned_at, issue: entry.issue, attempt, model_policy, model_launch,
      model: entry.model, effort: entry.effort });
    return { entry, ...await launchCodex(request.root, entry, prompt, false) };
  });
  return { attempt: launched.entry.attempt, ...await waitForThread(request.root, launched.entry, launched.pid) };
}
export async function resumeWorker(request) {
  checkRequest(request); guard(request.root, true);
  return withLock(path.join(request.root, "launch.lock"), async () => {
    guard(request.root, true);
    const entry = readJson(path.join(request.root, "workers.json"))[request.issue];
    if (!entry || !identity(entry) || !entry.thread_id || entry.stage !== "mono-deliver") throw new Error("no resumable delivery thread");
    if (entry.pid) {
      try { process.kill(entry.pid, 0); throw new Error("worker process is still live; resume refused"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    if (!entry.model_launch?.model_parameter || !entry.model_launch?.effort_parameter) throw new Error("missing launch pins; never backfill a resume from current policy");
    const installed = readJson(entry.lock);
    if (["packVersion", "sourceCommit", "surfaceRevision"].some(key => installed[key] !== entry[key])) throw new Error("pack identity changed; resume refused");
    const prompt = fs.readFileSync(request.resumeFile, "utf8");
    if (request.network_access !== undefined && typeof request.network_access !== "boolean") throw new Error("network_access override must be boolean");
    const roots = effectiveGrants(entry, request.root, request.extraWritable ?? [], request.workerWritableRoots ?? entry.workerWritableRoots);
    const updated = { ...entry, capsule: { ...entry.capsule, writable_roots: roots }, writable_roots: roots, workerWritableRoots: roots, network_access: request.network_access ?? entry.network_access };
    const registry = readJson(path.join(request.root, "workers.json")); registry[request.issue] = updated;
    atomicJson(path.join(request.root, "workers.json"), registry);
    return launchCodex(request.root, updated, prompt, true);
  });
}
