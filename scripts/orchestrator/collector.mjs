#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { atomicJson, canonical, digest, readJson, isMain, withLock, reclaimLock, lockTreeDead, processStart, resolvedLocation, validateEvidenceGrants } from "../runtime.mjs";
import { confirmQueue, confirmationPath, validateConfirmation } from "../delivery-state.mjs";
import { commandFlags, allowedFlags, registryEntry, correlatedPhase, validateReportBarriers, admitCollection, effectivePins, sha256File } from "./command-state.mjs";

const lockPath = ({ root, issue, attempt }) => path.join(root, "reports", `${issue}-collector-a${attempt}.lock`);
const logPath = ({ root, issue, attempt }) => path.join(root, "reports", `${issue}-collector-a${attempt}.log`);
function log(options, text) { fs.appendFileSync(logPath(options), `${new Date().toISOString()} ${text}\n`); }
function verifyReceipt(file, request) {
  const envelope = readJson(file), receipt = envelope.receipt;
  const key = fs.readFileSync(path.join(request.evidenceRoot, "receipt.key"));
  const signature = crypto.createHmac("sha256", key).update(canonical(receipt)).digest("hex");
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || key.length !== 32 || envelope.signature !== signature ||
      receipt?.producer !== "gate-autoreview-v2" || !/^[a-f0-9-]{36}$/.test(receipt.runId ?? "") ||
      fs.realpathSync(file) !== path.join(fs.realpathSync(request.evidenceRoot), "history", `${receipt.runId}.json`)) throw new Error("invalid signed history receipt");
  const expected = { collectionId: request.collectionId, head: request.head, product: request.product, skillsRoot: request.skillsRoot,
    ...(request.pins ? { pins: request.pins } : {}),
    root: fs.realpathSync(request.root), worktree: fs.realpathSync(request.worktree), evidenceRoot: fs.realpathSync(request.evidenceRoot),
    risk: request.risk, critical: request.critical, workerWritableRoots: request.workerWritableRoots.map(resolvedLocation).sort(),
    modelRoutes: request.modelRoutes ?? null };
  for (const [name, value] of Object.entries(expected)) if (canonical(receipt[name] ?? null) !== canonical(value)) throw new Error(`receipt binding mismatch: ${name}`);
  if (canonical({ command: receipt.verification?.command, args: receipt.verification?.args }) !== canonical(request.verification)) throw new Error("receipt binding mismatch: verification");
  // Admission binds the request version; gate archive numbering is independent.
  if (request.reviewDataset) {
    if (receipt.reviewDataset?.source !== request.reviewDataset || receipt.reviewDataset.digest !== sha256File(request.reviewDataset) ||
        receipt.reviewDataset.copy !== `.orchestrator/review-dataset-${receipt.reviewDataset.digest.slice(0, 8)}.md`) throw new Error("receipt binding mismatch: reviewDataset");
  } else if (receipt.reviewDataset !== null) throw new Error("receipt binding mismatch: reviewDataset");
  return envelope;
}
function historyReceipt(request) {
  const history = path.join(request.evidenceRoot, "history");
  const matches = fs.existsSync(history) ? fs.readdirSync(history).filter(name => name.endsWith(".json")).map(name => path.join(history, name))
    .filter(file => readJson(file).receipt?.collectionId === request.collectionId) : [];
  if (matches.length > 1) throw new Error("multiple history receipts for collectionId");
  return matches.length ? { file: matches[0], envelope: verifyReceipt(matches[0], request) } : null;
}
async function runGate(options, request, heldLock = null) {
  const file = path.join(options.root, "reports", `${options.issue}-collector-a${options.attempt}-request.json`);
  atomicJson(file, request);
  const script = path.join(request.skillsRoot, ".mono-agent-workflow", "scripts", "gate.mjs");
  // Release the isolated gate only after its incarnation is durably registered.
  // Parent death before release closes stdin, so no unregistered gate can run.
  const runner = `let token=""; for await (const chunk of process.stdin) token += chunk;
if (token !== "go\\n") process.exit(1);
process.argv = ${JSON.stringify([process.execPath, script, "preflight", "--request", file])};
await import(${JSON.stringify(pathToFileURL(script).href)});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", runner], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const locks = [lockPath(options), heldLock].filter(Boolean);
  child.stdin.on("error", () => {}); // Child exit may close the release pipe.
  try {
    const procStart = processStart(child.pid);
    if (!procStart) throw new Error("gate process incarnation unavailable");
    for (const lock of locks) {
      if (!fs.existsSync(lock)) { if (lock === heldLock) throw new Error("held head lock disappeared"); continue; }
      const holder = readJson(lock);
      if (holder.pid !== process.pid) throw new Error(`operation locked: ${lock}; foreign holder`);
      atomicJson(lock, { ...holder, gate: { pid: child.pid, procStart, processGroup: child.pid } });
    }
    child.stdin.end("go\n");
  } catch (error) { child.stdin.destroy(); child.kill(); throw error; }
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-64 * 1024); fs.appendFileSync(logPath(options), data); });
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  for (const lock of locks) if (fs.existsSync(lock)) {
    const holder = readJson(lock);
    if (holder.pid === process.pid && holder.gate?.pid === child.pid) { delete holder.gate; atomicJson(lock, holder); }
  }
  const answer = output.split("\n").reverse().find(line => /^gate preflight: (pass|fail): .+/.test(line));
  if (!answer) throw new Error("gate terminated without an answer; retain history for reconciliation");
  return answer;
}
async function collection(options, report, write, entry, admission) {
  const pins = effectivePins({ ...entry, pinsVersion: admission.pinsVersion });
  if (digest(pins) !== admission.manifestDigest || digest(report) !== admission.reportDigest) throw new Error("collection admission manifest mismatch");
  const request = write.payload.request;
  const evidenceRoot = validateEvidenceGrants(request.evidenceRoot, [request.root, request.worktree, ...request.workerWritableRoots, ...report.capsule.writable_roots]);
  const headLock = path.join(evidenceRoot, `${write.target}.collect.lock`);
  let found = historyReceipt(request);
  if (!found) {
    const started = path.join(options.root, "consumed", `${report.issue}-a${report.attempt}`, "collections", `${write.id}.json`);
    if (fs.existsSync(started)) throw new Error("collection started without a history receipt; orchestrator reconciliation required");
    if (fs.existsSync(headLock)) reclaimLock(headLock);
    atomicJson(started, { ...admission, startedAt: new Date().toISOString() });
    await runGate(options, { ...request, collect: true });
    found = historyReceipt(request);
    if (!found) throw new Error("collection produced no signed history receipt; reconcile before retry");
  }
  const gate = await withLock(headLock, async () => {
    // History wins, even if another run replaced the mutable head receipt.
    atomicJson(path.join(evidenceRoot, `${write.target}.json`), found.envelope);
    return runGate(options, { ...request, collect: false }, headLock);
  }, { reclaim: true });
  log(options, `reconciled ${write.id} from ${found.file}`);
  return { receipt: found.file, receiptDigest: digest(found.envelope), gate };
}
export async function collectOnce(options) {
  const entry = registryEntry(options.root, options.issue, options.attempt);
  for (const phase of ["code", "preflight", "ship"]) {
    const name = `${options.issue}-phase-${phase}.json`;
    const files = [path.join(options.root, "reports", name), path.join(entry.worktree, ".orchestrator", name)].filter(file => fs.existsSync(file));
    if (!files.length) continue;
    const { report } = correlatedPhase(options.root, files[0]);
    if (report.capsule.open_queue.some(write => write.operation !== "preflight-collect")) continue;
    if (report.capsule.open_queue.length && (report.phase !== "preflight" || report.kind !== "confirmation-request" || report.capsule.open_queue.length !== 1))
      throw new Error("collection requires a single preflight confirmation-request");
    const confirmation = confirmationPath(report, options.root);
    if (fs.existsSync(confirmation)) { validateConfirmation(report, readJson(confirmation)); continue; }
    await validateReportBarriers(options.root, report, path.dirname(files[0]));
    const admissions = report.capsule.open_queue.length ? await admitCollection(options.root, report) : [], evidence = new Map();
    for (const write of report.capsule.open_queue) evidence.set(write.id, await collection(options, report, write, entry, admissions.find(item => item.collectionId === write.id)));
    await confirmQueue(report, options.root, (_action, write) => ({ state: "present", evidence: evidence.get(write.id) }), path.dirname(files[0]));
    log(options, `confirmed ${phase} sequence ${report.sequence}: ${report.capsule.open_queue.length} writes`);
  }
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
    if (command === "--help" || args.help) console.log("Usage: collector.mjs start|stop|status --root DIR --issue KEY --attempt N\nOrchestrator only, outside worker sandboxes. Empty and collection-only phase queues auto-confirm; connector writes stay manual. Recovery uses signed history and dead isolated process trees; unknown/live locks refuse.");
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
            try { await collectOnce(options); } catch (error) { log(options, `attention: ${error.message}`); }
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
