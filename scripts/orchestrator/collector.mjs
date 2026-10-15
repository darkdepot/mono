#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { atomicJson, canonical, digest, readJson, isMain, withLock, reclaimLock, lockTreeDead, processStart, resolvedLocation, validateEvidenceGrants, packLayout, deliveryConfig } from "../runtime.mjs";
import { confirmQueue, confirmationPath, validateConfirmation, classifyQueue } from "../delivery-state.mjs";
import { commandFlags, allowedFlags, registryEntry, correlatedPhase, validateReportBarriers, admitCollection, CollectionAdmissionRefusal, effectivePins, sha256File, collectionDecisionDigest, recheckCollection, attemptDirectory } from "./command-state.mjs";
import { sessionContext, reconcile } from './linear-adapter.mjs';
import {syncLocalPasses,withholdReviewCap} from '../review-cap.mjs';

const lockPath = ({ root, issue, attempt }) => path.join(root, "reports", `${issue}-collector-a${attempt}.lock`);
const logPath = ({ root, issue, attempt }) => path.join(root, "reports", `${issue}-collector-a${attempt}.log`);
const attentionPath = ({ root, issue, attempt }) => path.join(root, "reports", `${issue}-collect-attention-a${attempt}.json`);
function log(options, text) { fs.appendFileSync(logPath(options), `${new Date().toISOString()} ${text}\n`); }
function verifyReceipt(file, request) {
  const envelope = readJson(file), receipt = envelope.receipt;
  const key = fs.readFileSync(path.join(request.evidenceRoot, "receipt.key"));
  const signature = crypto.createHmac("sha256", key).update(canonical(receipt)).digest("hex");
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || key.length !== 32 || envelope.signature !== signature ||
      receipt?.producer !== "gate-autoreview-v2" || !/^[a-f0-9-]{36}$/.test(receipt.runId ?? "") ||
      fs.realpathSync(file) !== path.join(fs.realpathSync(request.evidenceRoot), "history", `${receipt.runId}.json`)) throw new Error("invalid signed history receipt");
  const expected = { ...(request.packRoot ? { packRoot: request.packRoot } : {}), collectionId: request.collectionId, head: request.head, product: request.product, skillsRoot: request.skillsRoot,
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
class CollectionTimeout extends Error {}
class CollectionSessionPending extends Error {}
export function collectionBudget(entry, report) {
  const defaults = deliveryConfig();
  const deadline = Date.parse(report.publishedAt) + (entry.confirmationTimeoutSec ?? defaults.confirmationTimeoutSec) * 1000;
  const timeoutMs = (entry.collectionTimeoutSec ?? defaults.collectionTimeoutSec) * 1000;
  const retries = entry.collectionRetries ?? defaults.collectionRetries;
  const remaining = () => deadline - Date.now();
  const beforeLaunch = (collect = true) => {
    if (!Number.isFinite(deadline) || remaining() < (collect ? timeoutMs + 30_000 : 30_000))
      throw new CollectionTimeout('timed-out: insufficient collection budget for launch, teardown, reconciliation and confirmation');
  };
  const beforeConfirm = () => {
    if (remaining() < 5000) throw new CollectionTimeout('timed-out: insufficient collection budget for confirmation');
  };
  return { deadline, timeoutMs, retries, beforeLaunch, beforeConfirm, runLimit: collect => collect ? timeoutMs : Math.min(timeoutMs, remaining() - 10_000) };
}
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
  throw new CollectionTimeout('timed-out: gate descendants live/unverified; retry refused');
}
async function runGate(options, request, budget, heldLock = null, startedFile = null) {
  budget.beforeLaunch(request.collect);
  const runDeadline = Date.now() + budget.runLimit(request.collect);
  const file = path.join(options.root, "reports", `${options.issue}-collector-a${options.attempt}-request.json`);
  atomicJson(file, request);
  const script = packLayout(request.packRoot ?? request.skillsRoot).script("gate.mjs");
  // Release the isolated gate only after its incarnation is durably registered.
  // Parent death before release closes stdin, so no unregistered gate can run.
  const runner = `let token=""; for await (const chunk of process.stdin) token += chunk;
if (token !== "go\\n") process.exit(1);
const killGroup = () => { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); } };
const watchdog = setTimeout(killGroup, Math.max(1, ${Math.min(runDeadline + 2000, budget.deadline - 5000)} - Date.now()));
process.on('SIGTERM', () => {}); // Survive TERM grace until descendants exit or the watchdog kills the group.
process.argv = ${JSON.stringify([process.execPath, script, "preflight", "--request", file])};
try { await import(${JSON.stringify(pathToFileURL(script).href)}); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  try {
    const {processTable} = await import(${JSON.stringify(new URL('../runtime.mjs', import.meta.url).href)});
    if (!processTable().some(row => row.group === process.pid && row.pid !== process.pid && !row.state.startsWith('Z'))) clearTimeout(watchdog);
  } catch {} // Retain the watchdog when descendant telemetry is unavailable.
}`;
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
    throw new CollectionTimeout(`timed-out: gate registration unverified; retry refused: ${error.message}`);
  }
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-64 * 1024); fs.appendFileSync(logPath(options), data); });
  let timer;
  const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  let timedOut;
  try {
    timedOut = await Promise.race([closed.then(() => false), new Promise(resolve => { timer = setTimeout(() => resolve(true), Math.max(1, runDeadline - Date.now())); })]);
  } finally { clearTimeout(timer); }
  // A closed leader can leave children holding pipes or surviving independently.
  // Keep the group recorded until telemetry proves the whole group dead.
  try {
    let dead = false;
    try { dead = lockTreeDead(gate); } catch {} // Force teardown if telemetry is unavailable.
    if (timedOut || !dead) await stopGate(gate);
  }
  catch (error) { throw new CollectionTimeout(`timed-out: gate descendants live/unverified; retry refused: ${error.message}`); }
  // Group death is the proof; inherited pipes must not extend the run deadline.
  child.stdout.destroy(); child.stderr.destroy();
  try {
    await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new CollectionTimeout('timed-out: gate close unverified; retry refused')), 1000); })]);
  } finally { clearTimeout(timer); }
  for (const lock of locks) if (fs.existsSync(lock)) {
    const holder = readJson(lock);
    if (holder.pid === process.pid && holder.gate?.pid === child.pid) { delete holder.gate; atomicJson(lock, holder); }
  }
  if (timedOut) throw new Error("gate run timed out without completion");
  const answer = output.split("\n").reverse().find(line => /^gate preflight: (pass|fail): .+/.test(line));
  if (!answer) throw new Error("gate terminated without an answer; retain history for reconciliation");
  return answer;
}
async function collection(options, report, write, entry, admission, authorize) {
  authorize();
  const pins = effectivePins({ ...entry, pinsVersion: admission.pinsVersion });
  if (digest(pins) !== admission.manifestDigest || digest(report) !== admission.reportDigest) throw new Error("collection admission manifest mismatch");
  const request = write.payload.request;
  const evidenceRoot = validateEvidenceGrants(request.evidenceRoot, [request.root, request.worktree, ...request.workerWritableRoots, ...report.capsule.writable_roots]);
  const headLock = path.join(evidenceRoot, `${write.target}.collect.lock`);
  const budget = collectionBudget(entry, report);
  const started = path.join(attemptDirectory(options.root, report), "collections", `${write.id}.json`);
  let found = historyReceipt(request);
  while (!found) {
    found = historyReceipt(request);
    if (found) break;
    const prior = fs.existsSync(started) ? readJson(started) : null;
    if (prior && (prior.reportDigest !== admission.reportDigest || prior.manifestDigest !== admission.manifestDigest))
      throw new Error("collection retry admission mismatch");
    if (prior?.gate && !lockTreeDead(prior.gate))
      throw new CollectionTimeout('timed-out: previous gate descendants live/unverified; retry refused');
    // Legacy starts already consumed one launch. Count before release so a
    // collector crash cannot refill retries, even before gate registration.
    const launches = prior?.launches ?? (prior ? 1 : 0);
    if (launches >= budget.retries + 1) throw new CollectionTimeout('timed-out: collection retries exhausted without signed receipt');
    await recheckCollection(options.root, report, admission);
    found = historyReceipt(request);
    if (found) break;
    authorize();
    budget.beforeLaunch();
    if (fs.existsSync(headLock)) reclaimLock(headLock);
    atomicJson(started, { ...admission, launches: launches + 1, startedAt: new Date().toISOString() });
    log(options, `collection ${write.id} launch ${launches + 1}; deadline ${new Date(budget.deadline).toISOString()}`);
    try { await runGate(options, { ...request, collect: true }, budget, null, started); }
    catch (error) {
      log(options, `collection ${write.id} launch ${launches + 1}: ${error.message}`);
      if (error instanceof CollectionTimeout) throw error;
      const active = readJson(started).gate;
      if (active && !lockTreeDead(active)) throw new CollectionTimeout('timed-out: gate descendants live/unverified; retry refused');
    }
    found = historyReceipt(request);
  }
  const gate = await withLock(headLock, async () => {
    authorize();
    budget.beforeLaunch(false);
    // History wins, even if another run replaced the mutable head receipt.
    atomicJson(path.join(evidenceRoot, `${write.target}.json`), found.envelope);
    try { return await runGate(options, { ...request, collect: false }, budget, headLock); }
    catch (error) { throw new CollectionTimeout(`timed-out: receipt reconciliation failed: ${error.message}`); }
  }, { reclaim: true });
  budget.beforeConfirm();
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
    const local=report.phase==='preflight'||report.capsule.local_passes?.length?await withLock(path.join(options.root,'launch.lock'),()=>
      syncLocalPasses({evidenceRoot:effectivePins(entry).evidenceRoot,report})):null;
    const queue = classifyQueue(report, options.root), collectWrite = queue.collection;
    if (queue.connectors.length && !collectWrite) continue;
    const connectorSession = () => {
      if (!queue.connectors.length) return null;
      try {
        const active = readJson(path.join(attemptDirectory(options.root, report), 'sessions', `current-${digest(report)}.json`));
        const context = sessionContext(options.root, files[0], active.sessionId);
        const present = queue.connectors.every(write => reconcile({ action: 'reconcile', issue: report.issue, attempt: report.attempt,
          idempotencyKey: `${report.issue}:${write.id}`, write }, { root: options.root, reportFile: files[0], sessionId: context.session.sessionId }).state === 'present');
        return present ? context.session.sessionId : null;
      } catch { return null; } // Missing, closed or replaced sessions grant no collection permission.
    };
    const sessionId = connectorSession();
    if (queue.connectors.length && !sessionId) continue;
    const confirmation = confirmationPath(report, options.root);
    if (fs.existsSync(confirmation)) { validateConfirmation(report, readJson(confirmation)); continue; }
    const attentionFile = attentionPath(options);
    const attention = collectWrite && fs.existsSync(attentionFile) ? readJson(attentionFile) : null;
    const reportDigest = digest(report), pinsVersion = entry.pinsVersion ?? 0;
    const decisionDigest=collectWrite?collectionDecisionDigest(entry):null;
    if (collectWrite && attention?.reportDigest === reportDigest && attention.pinsVersion === pinsVersion && attention.decisionDigest === decisionDigest) {
      const lateReceipt = attention.reason.startsWith('timed-out:') && collectionBudget(entry, report).deadline - Date.now() >= 30_000 &&
        historyReceipt(collectWrite.payload.request);
      if (!lateReceipt) continue;
    }
    await validateReportBarriers(options.root, report, path.dirname(files[0]));
    let admissions = [];
    if (collectWrite) {
      try {
        if(local?.localStop&&!local.continued) {
          const refused=await withLock(path.join(options.root,'launch.lock'),()=>{
            const current=syncLocalPasses({evidenceRoot:effectivePins(entry).evidenceRoot,report});
            return current.localStop&&!current.continued?withholdReviewCap({...current,evidenceRoot:effectivePins(entry).evidenceRoot,report,
              collectionId:collectWrite.id,stop:current.localStop}):null;
          });
          if(refused)throw new CollectionAdmissionRefusal('needs-decision: review cap');
        }
        admissions = await admitCollection(options.root, report);
      }
      catch (error) {
        if (!(error instanceof CollectionAdmissionRefusal)) throw error;
        atomicJson(attentionFile, { reportDigest, collectionId: collectWrite.id, reason: error.message, pinsVersion, decisionDigest:collectionDecisionDigest(entry), at: new Date().toISOString() });
        log(options, `attention: ${error.message}`);
        continue;
      }
      // A current preflight admission also replaces attention for an older report.
      if (attention && fs.existsSync(attentionFile) && digest(readJson(attentionFile)) === digest(attention)) fs.unlinkSync(attentionFile);
    }
    try {
      const authorize = () => {
        if (queue.connectors.length && connectorSession() !== sessionId) throw new CollectionSessionPending();
      };
      const evidence = collectWrite ? await collection(options, report, collectWrite, entry,
        admissions.find(item => item.collectionId === collectWrite.id), authorize) : null;
      const confirm = async () => {
        if (queue.connectors.length && connectorSession() !== sessionId) return false;
        if (collectWrite) collectionBudget(entry, report).beforeConfirm();
        await confirmQueue(report, options.root, (action, write) => {
          if (action !== 'reconcile') throw new Error('collector never applies connector writes');
          if (collectWrite) collectionBudget(entry, report).beforeConfirm();
          if (write.id === collectWrite?.id) return { state: 'present', evidence };
          return reconcile({ action, issue: report.issue, attempt: report.attempt, idempotencyKey: `${report.issue}:${write.id}`, write },
            { root: options.root, reportFile: files[0], sessionId });
        }, path.dirname(files[0]), collectWrite ? collectionBudget(entry, report).deadline : Infinity);
        return true;
      };
      const confirmed = queue.connectors.length
        ? await withLock(path.join(attemptDirectory(options.root, report), 'session.lock'), confirm) : await confirm();
      if (!confirmed) continue;
    } catch (error) {
      if (error instanceof CollectionSessionPending) continue;
      if (!(error instanceof CollectionTimeout) && !(error instanceof CollectionAdmissionRefusal) && !error.message.startsWith('timed-out:')) throw error;
      atomicJson(attentionFile, { reportDigest, collectionId: collectWrite.id, reason: error.message, pinsVersion,
        decisionDigest: collectionDecisionDigest(entry), at: new Date().toISOString() });
      log(options, `attention: ${error.message}`);
      continue;
    }
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
