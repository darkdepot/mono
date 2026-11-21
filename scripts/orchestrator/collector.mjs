#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { atomicJson, canonical, digest, readJson, isMain, withLock, reclaimLock, lockTreeDead, processStart, resolvedLocation, validateEvidenceGrants, packLayout, deliveryConfig, REVIEW_PRODUCER } from "../runtime.mjs";
import { commandFlags, allowedFlags, registryEntry, admitCollection, CollectionAdmissionRefusal } from "./command-state.mjs";
import { readLedger, inFlight, admissionFor, recordResult, roundRequestName, collectorLock, requestDigest } from "../review-rounds.mjs";

const lockPath = ({ root, issue, attempt }) => collectorLock(root, issue, attempt);
const logPath = ({ root, issue, attempt }) => path.join(root, "reports", `${issue}-collector-a${attempt}.log`);
const noted = new Map();
function log(options, text) { fs.appendFileSync(logPath(options), `${new Date().toISOString()} ${text}\n`); }
// Repeated attention for the same subject is logged once per collector process.
function attention(options, subject, text) {
  if (noted.get(subject) === text) return;
  noted.set(subject, text); log(options, `attention: ${text}`);
}
// The receipt is trusted because evidenceRoot is outside every worker grant (launch and gate check it);
// it is a regular file named by its runId in history and bound to the admitted request.
function verifyReceipt(file, request) {
  const envelope = readJson(file), receipt = envelope.receipt;
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() ||
      receipt?.producer !== REVIEW_PRODUCER || !/^[a-f0-9-]{36}$/.test(receipt.runId ?? "") ||
      fs.realpathSync(file) !== path.join(fs.realpathSync(request.evidenceRoot), "history", `${receipt.runId}.json`)) throw new Error("invalid history receipt");
  const expected = { ...(request.packRoot ? { packRoot: request.packRoot } : {}), collectionId: request.collectionId, head: request.head, product: request.product, skillsRoot: request.skillsRoot,
    ...(request.pins ? { pins: request.pins } : {}),
    root: fs.realpathSync(request.root), worktree: fs.realpathSync(request.worktree), evidenceRoot: fs.realpathSync(request.evidenceRoot),
    risk: request.risk, critical: request.critical, workerWritableRoots: request.workerWritableRoots.map(resolvedLocation).sort(),
    modelRoutes: request.modelRoutes ?? null };
  for (const [name, value] of Object.entries(expected)) if (canonical(receipt[name] ?? null) !== canonical(value)) throw new Error(`receipt binding mismatch: ${name}`);
  if (canonical({ command: receipt.verification?.command, args: receipt.verification?.args }) !== canonical(request.verification)) throw new Error("receipt binding mismatch: verification");
  return envelope;
}
function historyReceipt(request) {
  const history = path.join(request.evidenceRoot, "history");
  const matches = fs.existsSync(history) ? fs.readdirSync(history).filter(name => name.endsWith(".json")).map(name => path.join(history, name))
    .filter(file => readJson(file).receipt?.collectionId === request.collectionId) : [];
  if (matches.length > 1) throw new Error("multiple history receipts for collectionId");
  return matches.length ? { file: matches[0], envelope: verifyReceipt(matches[0], request) } : null;
}
// A live or unverified gate keeps its round in flight: it may still write a receipt.
class GateAlive extends Error {}
// Not a collection window: a safety ceiling for a gate stuck outside the reviewer time limits
// (for example a blocking Git read). Past it the gate group is stopped and the round fails.
export const GATE_STUCK_MS = 2 * 60 * 60 * 1000;
async function stopGate(gate) {
  const signal = name => {
    try { process.kill(-gate.processGroup, name); }
    catch (error) { if (error.code !== 'ESRCH' && !lockTreeDead(gate)) throw error; }
  };
  for (const name of ['SIGTERM', 'SIGKILL']) {
    try { if (lockTreeDead(gate)) return; } catch {} // Unknown telemetry still requires termination.
    signal(name);
    const until = Date.now() + 2000;
    do {
      try { if (lockTreeDead(gate)) return; }
      catch {} // Still escalate to KILL; unavailable telemetry never authorizes retry.
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < until);
  }
  throw new GateAlive('gate descendants live/unverified; retry refused');
}
async function runGate(options, request, heldLock = null, startedFile = null) {
  const file = path.join(options.root, "reports", `${options.issue}-collector-a${options.attempt}-request.json`);
  atomicJson(file, request);
  const script = packLayout(request.packRoot ?? request.skillsRoot).script("gate.mjs");
  // Release the isolated gate only after its incarnation is durably registered.
  // Parent death before release closes stdin, so no unregistered gate can run.
  // Each reviewer role has its own time limit, so a hung CLI ends the gate.
  const runner = `let token=""; for await (const chunk of process.stdin) token += chunk;
if (token !== "go\\n") process.exit(1);
process.argv = ${JSON.stringify([process.execPath, script, "preflight", "--request", file])};
try { await import(${JSON.stringify(pathToFileURL(script).href)}); }
catch (error) { console.error(error); process.exitCode = 1; }`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", runner], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const locks = [lockPath(options), heldLock].filter(Boolean);
  child.stdin.on("error", () => {}); // Child exit may close the release pipe.
  let gate;
  try {
    const procStart = processStart(child.pid);
    if (!procStart) throw new Error("gate process incarnation unavailable");
    gate = { pid: child.pid, procStart, processGroup: child.pid };
    if (startedFile) atomicJson(startedFile, { ...readJson(startedFile), gate });
    for (const lock of locks) {
      if (!fs.existsSync(lock)) { if (lock === heldLock) throw new Error("held head lock disappeared"); continue; }
      const holder = readJson(lock);
      if (holder.pid !== process.pid) throw new Error(`operation locked: ${lock}; foreign holder`);
      atomicJson(lock, { ...holder, gate });
    }
    child.stdin.end("go\n");
  } catch (error) {
    child.stdin.destroy(); child.kill();
    throw new GateAlive(`gate registration unverified; retry refused: ${error.message}`);
  }
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-64 * 1024); fs.appendFileSync(logPath(options), data); });
  // Wait for the leader to exit, not for its pipes to close: a descendant may hold them open.
  const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  let stuck = false, ceiling;
  await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("exit", resolve);
    ceiling = setTimeout(() => { stuck = true; resolve(); }, options.gateStuckMs ?? GATE_STUCK_MS);
  });
  clearTimeout(ceiling);
  if (stuck) await stopGate(gate);
  const settle = ms => Promise.race([closed.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), ms))]);
  const drained = await settle(2000);
  // A finished leader can leave children surviving independently.
  // Keep the group recorded until telemetry proves the whole group dead.
  let dead = false;
  try { dead = lockTreeDead(gate); } catch {} // Force teardown if telemetry is unavailable.
  if (!dead) await stopGate(gate);
  if (!drained) await settle(2000);
  child.stdout.destroy(); child.stderr.destroy();
  for (const lock of locks) if (fs.existsSync(lock)) {
    const holder = readJson(lock);
    if (holder.pid === process.pid && holder.gate?.pid === child.pid) { delete holder.gate; atomicJson(lock, holder); }
  }
  if (stuck) throw new Error("gate stuck past the safety ceiling; its process group was stopped");
  const answer = output.split("\n").reverse().find(line => /^gate preflight: (pass|fail): .+/.test(line));
  if (!answer) throw new Error("gate terminated without an answer; retain history for reconciliation");
  return answer;
}
async function collection(options, entry, admission) {
  const request = admission.request;
  const evidenceRoot = validateEvidenceGrants(request.evidenceRoot, [request.root, request.worktree, ...request.workerWritableRoots, ...entry.workerWritableRoots]);
  const headLock = path.join(evidenceRoot, `${request.head}.collect.lock`);
  const retries = entry.collectionRetries ?? deliveryConfig().collectionRetries;
  const started = path.join(options.root, "consumed", `${options.issue}-a${options.attempt}`, "collections", `${admission.collectionId}.json`);
  let found = historyReceipt(request);
  while (!found) {
    const prior = fs.existsSync(started) ? readJson(started) : null;
    if (prior && prior.requestDigest !== admission.requestDigest) throw new Error("collection retry admission mismatch");
    if (prior?.gate) {
      let dead;
      try { dead = lockTreeDead(prior.gate); } catch (error) { throw new GateAlive(`previous gate telemetry unavailable; retry refused: ${error.message}`); }
      // A gate left by a dead collector is stopped once it passes the same safety ceiling.
      if (!dead && Date.now() - Date.parse(prior.startedAt) > (options.gateStuckMs ?? GATE_STUCK_MS)) { await stopGate(prior.gate); dead = true; }
      if (!dead) throw new GateAlive('previous gate descendants live/unverified; retry refused');
    }
    // Count before release so a collector crash cannot refill retries, even before gate registration.
    const launches = prior?.launches ?? (prior ? 1 : 0);
    if (launches >= retries + 1) throw new Error('collection retries exhausted without a receipt');
    if (fs.existsSync(headLock)) reclaimLock(headLock);
    atomicJson(started, { collectionId: admission.collectionId, requestDigest: admission.requestDigest, launches: launches + 1, startedAt: new Date().toISOString() });
    log(options, `collection ${admission.collectionId} launch ${launches + 1}`);
    try { await runGate(options, { ...request, collect: true }, null, started); }
    catch (error) {
      log(options, `collection ${admission.collectionId} launch ${launches + 1}: ${error.message}`);
      if (error instanceof GateAlive) throw error;
      const active = readJson(started).gate;
      let dead = true;
      try { dead = !active || lockTreeDead(active); } catch { dead = false; }
      if (!dead) throw new GateAlive('gate descendants live/unverified; retry refused');
    }
    found = historyReceipt(request);
  }
  const gate = await withLock(headLock, async () => {
    // History wins, even if another run replaced the mutable head receipt.
    atomicJson(path.join(evidenceRoot, `${request.head}.json`), found.envelope);
    try { return await runGate(options, { ...request, collect: false }, headLock); }
    catch (error) { if (error instanceof GateAlive) throw error; throw new Error(`receipt reconciliation failed: ${error.message}`); }
  }, { reclaim: true });
  log(options, `reconciled ${admission.collectionId} from ${found.file}`);
  return { receipt: found.file, receiptDigest: digest(found.envelope), gate };
}
async function runRound(options, entry, admission) {
  if (admission.refusal !== null && admission.refusal !== undefined) {
    recordResult(options.root, options.issue, options.attempt, admission, { status: "refused", reason: admission.refusal });
    log(options, `round ${admission.ordinal} ${admission.collectionId}: refused: ${admission.refusal}`);
    return;
  }
  try {
    const evidence = await collection(options, entry, admission);
    recordResult(options.root, options.issue, options.attempt, admission, { status: "done", ...evidence });
    log(options, `round ${admission.ordinal} ${admission.collectionId}: done`);
  } catch (error) {
    if (error instanceof GateAlive) { attention(options, admission.collectionId, error.message); return; }
    recordResult(options.root, options.issue, options.attempt, admission, { status: "failed", reason: error.message });
    log(options, `round ${admission.ordinal} ${admission.collectionId}: failed: ${error.message}`);
  }
}
// One pass: finish an admitted round first, then admit the worker's current round request.
export async function collectOnce(options) {
  const entry = registryEntry(options.root, options.issue, options.attempt);
  const open = inFlight(readLedger(options.root, options.issue, options.attempt));
  if (open.length) return runRound(options, entry, open[0].admission);
  const name = roundRequestName(options.issue, options.attempt);
  const files = [path.join(options.root, "reports", name), path.join(entry.worktree, ".orchestrator", name)].filter(file => fs.existsSync(file));
  if (!files.length) return;
  let round;
  try {
    const rounds = files.map(file => readJson(file));
    if (rounds.some(other => canonical(other) !== canonical(rounds[0]))) throw new Error("round request differs between mailboxes; keep one");
    round = rounds[0];
    if (round?.issue !== options.issue || round.attempt !== options.attempt) throw new Error("round request names another issue or attempt");
  } catch (error) { attention(options, "request", error.message); return; }
  const known = admissionFor(readLedger(options.root, options.issue, options.attempt), round.request?.collectionId);
  if (known) {
    if (known.admission.requestDigest !== requestDigest(round.request)) attention(options, "request", `collectionId ${round.request.collectionId} already admitted for another request`);
    return;
  }
  let admitted;
  try { admitted = await admitCollection(options.root, round, path.dirname(files[0])); }
  catch (error) {
    if (!(error instanceof CollectionAdmissionRefusal) && !/invalid round request/.test(error.message)) throw error;
    attention(options, "request", error.message); return;
  }
  log(options, `admitted round ${admitted.admission.ordinal} ${admitted.admission.collectionId}`);
  return runRound(options, entry, admitted.admission);
}
export async function collectorStart(options) {
  registryEntry(options.root, options.issue, options.attempt);
  const lock = lockPath(options);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  if (fs.existsSync(lock)) {
    if (!lockTreeDead(readJson(lock))) throw new Error("collector locked: holder or gate descendants live/unverified");
    reclaimLock(lock);
  }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "start", "--root", options.root, "--issue", options.issue, "--attempt", String(options.attempt), "--foreground"],
    { detached: true, stdio: "ignore" });
  const holder = await awaitCollectorReady(child, lock);
  child.unref();
  return holder;
}
// Attempt launch and resume: a running collector stays, a stopped or stale one starts.
export async function ensureCollector(options) {
  const status = collectorStatus(options);
  return status.status === "running-or-unverified" ? status : collectorStart(options);
}
export async function awaitCollectorReady(child, lock, timeoutMs = 5000) {
  let exited = false, failure;
  const closed = new Promise(resolve => {
    child.once("error", error => { failure = error; exited = true; resolve(); });
    child.once("close", () => { exited = true; resolve(); });
  });
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !exited) {
      if (fs.existsSync(lock)) {
        try { const holder = readJson(lock); if (holder.pid === child.pid && holder.ready === true) return holder; }
        catch (error) { if (!(error instanceof SyntaxError) && error.code !== "ENOENT") throw error; }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw failure ?? new Error("collector did not acquire attempt lock; inspect collector log");
  } catch (error) {
    if (!exited) child.kill("SIGTERM");
    await closed;
    throw error;
  }
}
export function collectorStatus(options) {
  registryEntry(options.root, options.issue, options.attempt);
  const lock = lockPath(options);
  if (!fs.existsSync(lock)) return { status: "stopped" };
  const holder = readJson(lock);
  return { status: lockTreeDead(holder) ? "stale" : "running-or-unverified", ...holder };
}
export function collectorStop(options) {
  const status = collectorStatus(options);
  if (status.status === "stopped") return status;
  if (status.status === "stale") { reclaimLock(lockPath(options)); return { status: "stopped" }; }
  if (!status.procStart || processStart(status.pid) !== status.procStart) throw new Error("collector incarnation not verified; refusing signal");
  process.kill(status.pid, "SIGTERM");
  return { status: "stopping", pid: status.pid };
}
if (isMain(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2), args = commandFlags(rest, ["foreground"]);
    allowedFlags(args, ["root", "issue", "attempt", "foreground"]);
    if (command === "--help" || args.help) console.log("Usage: collector.mjs start|stop|status --root DIR --issue KEY --attempt N\nOrchestrator side, outside worker sandboxes. Attempt launch and resume start it; start here only restarts a stopped collector. It waits for the worker's round request reports/KEY-round-aN.json, admits it into consumed/KEY-aN/rounds/ (a new collectionId only after every earlier round has a result; the same collectionId never with another request) and records one result per round: done, refused or failed. Recovery uses receipt history and dead isolated process trees; unknown/live locks refuse. It exits when the attempt leaves the registry.");
    else {
      const options = { root: args.root, issue: args.issue, attempt: Number(args.attempt) };
      if (command === "start" && args.foreground) {
        registryEntry(options.root, options.issue, options.attempt);
        let stopping = false;
        process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });
        await withLock(lockPath(options), async () => {
          const holder = readJson(lockPath(options));
          if (!holder.procStart || holder.processGroup !== process.pid) throw new Error("collector isolated process incarnation unavailable");
          atomicJson(lockPath(options), { ...holder, ready: true });
          log(options, "started");
          while (!stopping) {
            try { await collectOnce(options); }
            catch (error) {
              // A retired or replaced attempt ends this collector.
              if (/request not registry-correlated|no such file.*workers\.json/.test(error.message)) break;
              attention(options, "loop", error.message);
            }
            if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
          }
          log(options, "stopped");
        });
      } else if (command === "start") console.log(JSON.stringify(await collectorStart(options)));
      else if (command === "stop") console.log(JSON.stringify(collectorStop(options)));
      else if (command === "status") console.log(JSON.stringify(collectorStatus(options)));
      else throw new Error(`unknown command ${command}`);
    }
  } catch (error) { console.error(`collector: ${error.message}`); process.exitCode = 1; }
}
