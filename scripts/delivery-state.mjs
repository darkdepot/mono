#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { atomicJson, canonical, digest, readJson, identity, isMain, flags, withLock, deliveryConfig, validateEvidenceGrants } from "./runtime.mjs";

import { validateEntry } from "./decisions.mjs";

export const PHASES = ["code", "preflight", "ship"];
export const PARKED_REASONS = ["blocked", "needs-decision", "needs-human", "drift-candidate", "timed-out", "scope-drift-needs-handoff", "write-unconfirmed", "evidence-limit"];
export function correlatedDeliveryReport(report, stat, entry, logStat, stallSec = 120) {
  return entry?.transport === "codex-cli" && entry.stage === "mono-deliver" && identity(entry) && identity(report) &&
    report.issue === entry.issue && report.stage === entry.stage && report.attempt === entry.attempt &&
    ["packVersion", "sourceCommit", "surfaceRevision"].every(field => report[field] === entry[field]) &&
    ["green", "parked"].includes(report.status) && (report.status !== "parked" ||
      (PARKED_REASONS.includes(report.reason) && typeof report.text === "string" && report.text.trim().length > 0)) &&
    stat.isFile() && logStat.isFile() && stat.mtimeMs >= logStat.birthtimeMs &&
    stat.mtimeMs >= logStat.mtimeMs - stallSec * 1000 && stat.mtimeMs <= Date.now() + 5000;
}
function validateCollectionEvidence(write, evidence, report) {
  if (write.operation !== "preflight-collect") return;
  const request = write.payload.request;
  const root = validateEvidenceGrants(request.evidenceRoot,
    [request.worktree, request.root, ...request.workerWritableRoots, ...report.capsule.writable_roots]);
  if (!path.isAbsolute(evidence?.receipt ?? "") || !/^[a-f0-9]{64}$/.test(evidence.receiptDigest ?? "") ||
      !/^gate preflight: (pass|fail): .+/.test(evidence.gate ?? "")) throw new Error("immutable collection evidence required");
  const envelope = readJson(evidence.receipt), receipt = envelope.receipt;
  if (!/^[a-f0-9-]{36}$/.test(receipt?.runId ?? "") ||
      fs.realpathSync(evidence.receipt) !== path.join(root, "history", `${receipt.runId}.json`) ||
      digest(envelope) !== evidence.receiptDigest || receipt.producer !== "gate-autoreview-v2" ||
      receipt.collectionId !== write.id || receipt.head !== write.target || receipt.evidenceRoot !== root)
    throw new Error("collection evidence does not identify this immutable receipt");
  const key = fs.readFileSync(path.join(root, "receipt.key"));
  const signature = crypto.createHmac("sha256", key).update(canonical(receipt)).digest("hex");
  if (key.length !== 32 || envelope.signature !== signature) throw new Error("collection receipt authentication failed");
}
export function validatePhase(report) {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(report?.issue) || report.stage !== "mono-deliver" || !identity(report) ||
      !Number.isInteger(report.attempt) || report.attempt < 1 || !Number.isInteger(report.sequence) || report.sequence < 1 ||
      !PHASES.includes(report.phase) || !["phase", "confirmation-request"].includes(report.kind) || !/^[a-f0-9]{40}$/.test(report.head)) throw new Error("invalid phase identity");
  const capsule = report.capsule;
  if (capsule?.phase !== report.phase || capsule.head !== report.head || !Array.isArray(capsule.decisions) || !Array.isArray(capsule.open_queue) ||
      !Array.isArray(capsule.writable_roots) || !capsule.writable_roots.length || capsule.writable_roots.some(root => !path.isAbsolute(root))) throw new Error("invalid state capsule");
  if (!Array.isArray(report.linear_mutations_pending) || canonical(report.linear_mutations_pending) !== canonical(capsule.open_queue)) throw new Error("full write queue differs from capsule");
  const ids = new Set();
  for (const write of capsule.open_queue) {
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(write.id) || ids.has(write.id) ||
        typeof write.operation !== "string" || !write.operation || typeof write.target !== "string" || !write.target || !Object.hasOwn(write, "payload")) throw new Error("invalid or duplicate write");
    if (write.operation === "preflight-collect" && (write.id !== write.payload?.request?.collectionId ||
        write.target !== report.head || !new RegExp(`^preflight-collect:${report.head}:[1-9][0-9]*$`).test(write.id))) throw new Error("invalid collection write ID/head");
    ids.add(write.id);
  }
  validatePilotFields(report);
  return report;
}
// Proposal validation is structural. Only the orchestrator can accept a disposition
// or progress claim; confirmation continues to bind the entire unchanged report.
function validatePilotFields(report) {
  const text = value => typeof value === "string" && value.trim().length > 0;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const reference = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value);
  const ids = new Set(), decisions = new Map();
  for (const [field, type] of [["review_dispositions", "decision"], ["behaviour_matrices", "matrix"]]) {
    if (report[field] === undefined) continue;
    if (!Array.isArray(report[field])) throw new Error(`${field} must be an array`);
    for (const entry of report[field]) {
      validateEntry(entry);
      if (entry.type !== type || ids.has(entry.id)) throw new Error(`invalid or duplicate ${field} entry`);
      ids.add(entry.id);
      if (type === "decision") {
        if (!reference(entry.eventId)) throw new Error("disposition eventId reference required");
        decisions.set(entry.id, entry);
      } else {
        if (!Array.isArray(entry.decisionIds) || !entry.decisionIds.length || new Set(entry.decisionIds).size !== entry.decisionIds.length ||
            entry.decisionIds.some(id => !decisions.has(id) || decisions.get(id).findingKey !== entry.invariant))
          throw new Error("matrix decisionIds must reference dispositions for its invariant in this report");
      }
    }
  }
  for (const entry of decisions.values()) {
    if (entry.supersedes === entry.id || (decisions.has(entry.supersedes) && decisions.get(entry.supersedes).findingKey !== entry.findingKey))
      throw new Error("invalid disposition supersedes reference");
  }
  if (report.checkpoint !== undefined && (!object(report.checkpoint) ||
      !["confirmedDefects", "evidence", "failedFixes", "nextExperiment", "stopCondition"].every(k => text(report.checkpoint[k]))))
    throw new Error("checkpoint requires all five answers");
  const claim = report.progress_claim;
  if (claim !== undefined && (!object(claim) || !["fixed", "evidence", "new-cause", "none"].includes(claim.progress) || !text(claim.evidence) ||
      !Array.isArray(claim.eventIds) || !claim.eventIds.length || claim.eventIds.some(id => !reference(id)) || new Set(claim.eventIds).size !== claim.eventIds.length))
    throw new Error("progress_claim requires progress, evidence and eventIds references");
}
export function confirmationPath(report, root) {
  return path.join(root, "confirmations", `${report.issue}-phase-${report.phase}-a${report.attempt}-s${report.sequence}.confirmed.json`);
}
export function validateConfirmation(report, confirmation) {
  validatePhase(report);
  if (confirmation?.issue !== report.issue || confirmation.attempt !== report.attempt || confirmation.phase !== report.phase ||
      confirmation.sequence !== report.sequence || confirmation.reportDigest !== digest(report) || confirmation.status !== "confirmed" ||
      !Array.isArray(confirmation.results) || confirmation.results.length !== report.capsule.open_queue.length) throw new Error("confirmation does not cover this report");
  for (const [index, write] of report.capsule.open_queue.entries()) {
    const result = confirmation.results[index];
    if (result.id !== write.id || result.writeDigest !== digest(resolveWrite(write, report)) || result.state !== "present" || !result.evidence) throw new Error("confirmation has an unverified write");
    validateCollectionEvidence(write, result.evidence, report);
  }
  return true;
}
function requirePredecessors(report, root, reportsDir, action) {
  const sameAttempt = candidate => candidate.issue === report.issue && candidate.attempt === report.attempt &&
    ["packVersion", "sourceCommit", "surfaceRevision"].every(field => candidate[field] === report[field]);
  function confirmed(phase, sequence, published) {
    const label = `phase ${phase} sequence ${sequence}`;
    const file = confirmationPath({ ...report, phase, sequence }, root);
    if (!fs.existsSync(file)) throw new Error(`${label} is not confirmed; wait for it before ${action} ${report.phase}`);
    const ack = readJson(file), predecessor = validatePhase(ack.report);
    if (!sameAttempt(predecessor) || predecessor.phase !== phase || predecessor.sequence !== sequence ||
        (published && canonical(published) !== canonical(predecessor))) throw new Error(`${label} confirmation does not match its published report/attempt`);
    validateConfirmation(predecessor, ack);
  }
  for (const phase of PHASES.slice(0, PHASES.indexOf(report.phase))) {
    const name = `${report.issue}-phase-${phase}.json`;
    const candidates = [...new Set([path.join(root, "reports", name), path.join(reportsDir, name),
      ...report.capsule.writable_roots.map(grant => path.join(grant, ".orchestrator", name))])]
      .filter(file => fs.existsSync(file)).map(file => validatePhase(readJson(file)));
    if (!candidates.length) throw new Error(`phase ${phase} report is missing; publish and confirm it before ${action} ${report.phase}`);
    const latest = candidates[0];
    if (!sameAttempt(latest) || latest.phase !== phase || candidates.some(other => canonical(other) !== canonical(latest)))
      throw new Error(`phase ${phase} report is foreign or conflicts between mailboxes; reconcile before ${action} ${report.phase}`);
    for (let sequence = 1; sequence <= latest.sequence; sequence++) confirmed(phase, sequence, sequence === latest.sequence ? latest : null);
  }
  for (let sequence = 1; sequence < report.sequence; sequence++) confirmed(report.phase, sequence);
}
export function publishPhase(report, output, previousConfirmation, root = previousConfirmation
  ? path.dirname(path.dirname(previousConfirmation)) : path.dirname(path.dirname(output))) {
  validatePhase(report);
  requirePredecessors(report, root, path.dirname(output), "publishing");
  const content = value => { const { publishedAt, ...rest } = value; return rest; };
  if (fs.existsSync(output)) {
    const previous = validatePhase(readJson(output));
    if (canonical(content(previous)) === canonical(content(report))) return previous;
    const ackPath = previousConfirmation ?? confirmationPath(previous, root);
    if (!fs.existsSync(ackPath)) throw new Error("previous phase report is unconfirmed");
    validateConfirmation(previous, readJson(ackPath));
    if (report.attempt !== previous.attempt || report.sequence <= previous.sequence) throw new Error("phase report sequence must advance in the same attempt; archive reconciled old attempts first");
  }
  const published = { ...report, publishedAt: new Date().toISOString() };
  atomicJson(output, published);
  return published;
}
function resolveWrite(write, report) {
  function resolve(value) {
    if (value === "append #/certificate") {
      if (typeof report.certificate !== "string" || !report.certificate.trim()) throw new Error("certificate pointer has no certificate");
      return report.certificate;
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
    return value;
  }
  return resolve(write);
}
export async function confirmQueue(report, root, adapter, reportsDir = path.join(root, "reports")) {
  validatePhase(report);
  const dir = path.join(root, "consumed", `${report.issue}-a${report.attempt}`);
  return withLock(path.join(dir, "queue.lock"), async () => {
    requirePredecessors(report, root, reportsDir, "confirming");
    const results = [];
    for (const queuedWrite of report.capsule.open_queue) {
      const write = resolveWrite(queuedWrite, report);
      const file = path.join(dir, `${write.id}.json`);
      const hash = digest(write);
      const prior = fs.existsSync(file) ? readJson(file) : null;
      if (prior && (prior.writeDigest !== hash || prior.issue !== report.issue || prior.attempt !== report.attempt)) throw new Error(`write ${write.id} changed within attempt`);
      // Reconcile even a durable success: a lost response or deleted Linear object
      // must not turn a local receipt into proof of the current remote state.
      let observed = await adapter("reconcile", write, report);
      if (observed?.state === "missing") {
        atomicJson(file, { issue: report.issue, attempt: report.attempt, id: write.id, writeDigest: hash, state: "applying" });
        await adapter("apply", write, report);
        observed = await adapter("reconcile", write, report);
      }
      if (observed?.state !== "present" || !observed.evidence) throw new Error(`write ${write.id} not confirmed by Linear read-back`);
      validateCollectionEvidence(write, observed.evidence, report);
      const result = { issue: report.issue, attempt: report.attempt, id: write.id, writeDigest: hash, state: "present", evidence: observed.evidence };
      atomicJson(file, result); results.push(result);
    }
    requirePredecessors(report, root, reportsDir, "confirming");
    const confirmation = { report, issue: report.issue, attempt: report.attempt, phase: report.phase, sequence: report.sequence,
      reportDigest: digest(report), status: "confirmed", results };
    atomicJson(confirmationPath(report, root), confirmation);
    return confirmation;
  });
}
export async function waitForConfirmation(report, file, timeoutSec, pollSec = 1) {
  validatePhase(report);
  validateEvidenceGrants(file, report.capsule.writable_roots, "confirmation path");
  const started = Date.parse(report.publishedAt);
  if (!Number.isFinite(started) || started > Date.now()) throw new Error("invalid barrier publication time");
  const deadline = started + timeoutSec * 1000;
  while (true) {
    if (fs.existsSync(file)) { validateConfirmation(report, readJson(file)); return; }
    if (Date.now() >= deadline) throw new Error("write-unconfirmed: запись не подтверждена");
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollSec * 1000, deadline - Date.now())));
  }
}
if (isMain(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2); const args = flags(rest);
    if (command === "--help" || args.help) console.log("Usage: delivery-state.mjs publish --report <file> --output <file> [--confirmation <previous ack>] [--root <orchestrator root>] | confirm --report <file> --root <dir> --adapter <executable> [--config <file>] | wait --report <file> --confirmation <file> [--config <file>]\nPhase: {issue,stage:'mono-deliver',attempt,packVersion,sourceCommit,surfaceRevision,phase:'code|preflight|ship',sequence,kind:'phase|confirmation-request',head,linear_mutations_pending:[{id,operation,target,payload}],capsule:{phase,head,open_queue:[same writes],decisions:[],writable_roots:[dispatch grants]}}. publish adds publishedAt, so resumed waits retain the original deadline. Publish/confirm require all earlier sequence confirmations and the latest earlier phase reports for this attempt. Confirmations retain their report snapshot. Fallback publish supplies --root explicitly (or the previous standard mailbox confirmation); confirm reads predecessor reports from the current report directory and the root mailbox, refusing conflicting copies. The exact payload string append #/certificate expands to report.certificate before hashing/applying; changed certificate needs a new write ID. Adapter stdin: {action:'reconcile|apply',issue,attempt,idempotencyKey,write}; reconcile returns {state:'present|missing|unknown',evidence}; present needs evidence, missing must be positively observed. IDs persist across retries; results bind the current attempt.");
    else {
      const report = validatePhase(readJson(args.report));
      if (command === "publish") publishPhase(report, args.output, args.confirmation, args.root);
      else if (command === "confirm") {
        if (!path.isAbsolute(args.adapter ?? "")) throw new Error("absolute orchestrator-owned Linear adapter required");
        const config = deliveryConfig(args.config);
        await confirmQueue(report, args.root, (action, write) => {
          const output = execFileSync(args.adapter, [], {
          input: JSON.stringify({ action, issue: report.issue, attempt: report.attempt, idempotencyKey: `${report.issue}:${write.id}`, write }),
          encoding: "utf8", timeout: Math.ceil(config.confirmationTimeoutSec * 1000), maxBuffer: 8 * 1024 * 1024,
          });
          return action === "reconcile" ? JSON.parse(output) : undefined;
        }, path.dirname(args.report));
      } else if (command === "wait") {
        const config = deliveryConfig(args.config);
        await waitForConfirmation(report, args.confirmation, config.confirmationTimeoutSec, config.pollSec);
      } else throw new Error(`unknown command ${command}`);
      console.log(`delivery-state ${command}: pass`);
    }
  } catch (error) { console.error(`delivery-state: ${error.message}`); process.exitCode = 1; }
}
