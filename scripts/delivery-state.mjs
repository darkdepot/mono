#!/usr/bin/env node
import fs from "node:fs";
import { validateShipCertificate } from "./ship-certificate.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { atomicJson, canonical, digest, readJson, identity, IDENTITY_FIELDS, isMain, flags, withLock, deliveryConfig, validateEvidenceGrants } from "./runtime.mjs";

import { validateEntry } from "./decisions.mjs";

import { workerTransport } from "./worker-transport.mjs";

import { captureCriteria, requireApprovedCriteria, preCaptureStop } from "./delivery-criteria.mjs";
import { implementationComment, implementationExit, deferredImplementation, literalImplementationComment } from './implementation-comment.mjs';
export { captureCriteria } from "./delivery-criteria.mjs";

export const PHASES = ["code", "preflight", "ship"];
export function requiresConfirmation(report) {
  validatePhase(report);
  return !deferredImplementation(report);
}
export const PARKED_REASONS = ["blocked", "needs-decision", "needs-human", "drift-candidate", "timed-out", "scope-drift-needs-handoff", "write-unconfirmed", "evidence-limit"];
export function correlatedDeliveryReport(report, stat, entry, logStat, stallSec = 120) {
  return workerTransport(entry?.transport)?.correlatesReports === true && entry.stage === "mono-deliver" && identity(entry) && identity(report) &&
    report.issue === entry.issue && report.stage === entry.stage && report.attempt === entry.attempt &&
    IDENTITY_FIELDS.every(field => report[field] === entry[field]) &&
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
  // Unknown writes remain barriers; only the exact generated report can defer.
  if (report.phase === "code" && report.phase_result !== undefined && report.phase_result !== "in-progress")
    validateImplementationReport(report);
  return report;
}
function validateImplementationReport(report) {
  const text = value => typeof value === "string" && value.trim().length > 0;
  const error = detail => { throw new Error(`invalid implementation report: ${detail}`); };
  if (!["implemented-needs-preflight", "blocked", "scope-drift-needs-handoff", "needs-human"].includes(report.phase_result))
    error("unknown phase_result");
  if (!text(report.summary) || !Array.isArray(report.not_built) || !Array.isArray(report.not_verified) ||
      !Array.isArray(report.criteria) || (!report.criteria.length && !preCaptureStop(report))) error("summary, criteria, not_built and not_verified required");
  if (report.pre_capture_stop && !preCaptureStop(report)) error("invalid pre-capture refusal");
  if (report.not_built.some(entry => !text(entry?.what) || !text(entry?.reason)) ||
      report.not_verified.some(entry => !text(entry?.what) || !text(entry?.why) || !text(entry?.risk)))
    error("incomplete exclusions or verification gaps");
  const criteria = new Set();
  for (const item of report.criteria) {
    if (!text(item?.criterion) || criteria.has(item.criterion) || typeof item.done !== "boolean" ||
        !["confirmed", "unverified", "broken"].includes(item.outcome) || !text(item.proof) || !text(item.result) ||
        !/^[a-f0-9]{40}$/.test(item.head ?? "") || !/^[a-f0-9]{64}$/.test(item.worktree_fingerprint ?? ""))
      error("invalid or duplicate criterion/evidence");
    criteria.add(item.criterion);
    if (item.outcome === "confirmed" && (!item.done || item.head !== report.head)) error("unfinished or stale confirmed criterion");
    if (item.outcome === "unverified" && !report.not_verified.some(entry => entry.what === item.criterion))
      error("unverified criterion needs what/why/risk");
    if (report.phase_result === "implemented-needs-preflight" && (!item.done || item.outcome === "broken"))
      error("broken or unfinished work must be blocked");
  }
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
    if (result.issue !== report.issue || result.attempt !== report.attempt || result.id !== write.id ||
        result.writeDigest !== digest(resolveWrite(write, report)) || result.state !== "present" || !result.evidence) throw new Error("confirmation has an unverified write");
    validateCollectionEvidence(write, result.evidence, report);
  }
  return true;
}
export function requirePredecessors(report, root, reportsDir, action) {
  const sameAttempt = candidate => candidate.issue === report.issue && candidate.attempt === report.attempt &&
    IDENTITY_FIELDS.every(field => candidate[field] === report[field]);
  function confirmed(phase, sequence, published) {
    const label = `phase ${phase} sequence ${sequence}`;
    const file = confirmationPath({ ...report, phase, sequence }, root);
    if (!fs.existsSync(file)) {
      if (phase === 'code' && deferredProof(report, sequence, published, root)) return;
      throw new Error(`${label} is not confirmed; wait for it before ${action} ${report.phase}`);
    }
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
function codeHistory(root, report, directory = path.join(root, 'reports')) {
  return path.join(directory, `${report.issue}-phase-code-a${report.attempt}-s${report.sequence}.json`);
}
function codeReference(report) { return { sequence: report.sequence, reportDigest: digest(report) }; }
function deferredSnapshots(context, root) {
  return (context.capsule.deferred_reports ?? []).map(ref => {
    if (!Number.isInteger(ref.sequence) || ref.sequence < 1 || !/^[a-f0-9]{64}$/.test(ref.reportDigest ?? ''))
      throw new Error('invalid deferred code report fingerprint');
    const identity = { ...context, sequence: ref.sequence };
    const files = [...new Set([codeHistory(root, identity), ...context.capsule.writable_roots.map(grant =>
      codeHistory(root, identity, path.join(grant, '.orchestrator')))])].filter(file => fs.existsSync(file));
    if (!files.length) throw new Error('deferred code report snapshot missing');
    const prior = validatePhase(readJson(files[0]));
    if (files.some(file => digest(readJson(file)) !== ref.reportDigest)) throw new Error('conflicting deferred code report fingerprints');
    if (digest(prior) !== ref.reportDigest) throw new Error('deferred code report fingerprint mismatch');
    if (prior.issue !== context.issue || prior.attempt !== context.attempt || prior.phase !== 'code' ||
        prior.sequence !== ref.sequence || IDENTITY_FIELDS.some(key => prior[key] !== context[key]) || !deferredImplementation(prior))
      throw new Error('only the complete implemented code report may defer');
    return prior;
  });
}
function deferredProof(report, sequence, published, root) {
  const contexts = [...(['code', 'preflight'].includes(report.phase) ? [report] : []),
    ...verifiedConfirmations(report, root).map(ack => ack.report)];
  for (const context of contexts) {
    const snapshots = deferredSnapshots(context, root), prior = snapshots.find(r => r.sequence === sequence);
    if (!prior) continue;
    if (published && digest(prior) !== digest(published)) throw new Error('published code report fingerprint mismatch');
    const write = implementationComment(prior);
    const covering = [context, ...snapshots].filter(r => implementationExit(r) &&
      (implementationComment(r).id === write.id || r.superseded_reports?.includes(write.id)));
    if (covering.some(r => context.capsule.open_queue.some(w => canonical(w) === canonical(implementationComment(r))))) return true;
  }
  return false;
}
function latestCode(report, root, reportsDir) {
  const name = `${report.issue}-phase-code.json`;
  const files = [...new Set([path.join(root, 'reports', name), path.join(reportsDir, name),
    ...report.capsule.writable_roots.map(grant => path.join(grant, '.orchestrator', name))])].filter(file => fs.existsSync(file));
  if (!files.length) return null;
  const code = validatePhase(readJson(files[0]));
  if (files.some(file => canonical(readJson(file)) !== canonical(code))) throw new Error('conflicting code mailboxes');
  if (code.issue !== report.issue || code.attempt !== report.attempt || IDENTITY_FIELDS.some(key => code[key] !== report[key]))
    throw new Error('foreign code report attempt/identity');
  return code;
}
function preparePublication(input, previous, root, reportsDir) {
  const report = structuredClone(input);
  if (implementationExit(report)) {
    report.capsule.deferred_reports = previous?.capsule.deferred_reports ?? [];
    // An identical retry retains its original supersession list and publication.
    report.superseded_reports = previous?.superseded_reports ?? [];
    let write = implementationComment(report);
    if (previous && implementationExit(previous)) {
      const old = implementationComment(previous);
      if (write.id !== old.id) report.superseded_reports = [...new Set([...report.superseded_reports, old.id])];
      report.capsule.deferred_reports = previous.capsule.deferred_reports ?? [];
      if (deferredImplementation(previous) && report.sequence > previous.sequence) report.capsule.deferred_reports = [...report.capsule.deferred_reports, codeReference(previous)]
        .filter((ref, index, all) => all.findIndex(r => r.sequence === ref.sequence) === index);
      report.capsule.open_queue = report.capsule.open_queue.filter(w => canonical(w) !== canonical(old));
    }
    write = implementationComment(report);
    const superseded = new Set(report.superseded_reports);
    report.capsule.open_queue = report.capsule.open_queue.filter(w => canonical(w) !== canonical(write) &&
      !(superseded.has(w.id) && literalImplementationComment(w) && canonical(w) === canonical({
        id: w.id, operation: 'comment', target: report.issue, payload: { body: w.payload.body },
      })));
    report.capsule.open_queue.push(write);
  } else if (report.phase === 'preflight') {
    const code = latestCode(report, root, reportsDir);
    if (code && deferredImplementation(code)) {
      const write = implementationComment(code);
      const already = verifiedConfirmations(report, root).some(ack => ack.results.some(r => r.id === write.id && r.writeDigest === digest(write)));
      const prepared = previous?.issue === report.issue && previous.phase === report.phase && previous.attempt === report.attempt &&
        previous.sequence === report.sequence && previous.head === report.head &&
        previous.capsule.open_queue.some(w => canonical(w) === canonical(write));
      if ((!already || prepared) && !report.capsule.open_queue.some(w => canonical(w) === canonical(write))) report.capsule.open_queue.unshift(write);
      report.capsule.deferred_reports = [...(code.capsule.deferred_reports ?? []), codeReference(code)];
    }
  }
  report.linear_mutations_pending = report.capsule.open_queue;
  return report;
}
function verifiedConfirmations(report, root) {
  const dir = path.join(root, "confirmations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => PHASES.some(phase =>
    name.startsWith(`${report.issue}-phase-${phase}-a${report.attempt}-s`) && name.endsWith('.confirmed.json')))
    .map(name => {
      const ack = readJson(path.join(dir, name)), prior = validatePhase(ack.report);
      if (prior.issue !== report.issue || prior.attempt !== report.attempt || IDENTITY_FIELDS.some(key => prior[key] !== report[key]))
        throw new Error('previous confirmation attempt/identity mismatch');
      validateConfirmation(prior, ack);
      return ack;
    }).filter(ack => ack.report.phase !== report.phase || ack.report.sequence <= report.sequence);
}
// Only a verified whole-report confirmation can carry evidence. Durable write
// results and unfinished session observations retain identity checks, not proof.
export function classifyQueue(report, root) {
  validatePhase(report);
  const confirmed = new Map();
  for (const ack of verifiedConfirmations(report, root)) for (const result of ack.results) {
    if (confirmed.has(result.id) && confirmed.get(result.id).result.writeDigest !== result.writeDigest)
      throw new Error(`write ${result.id} changed within attempt`);
    confirmed.set(result.id, { result, reportDigest: ack.reportDigest });
  }
  const carried = new Map(), connectors = [], collections = [];
  for (const queued of report.capsule.open_queue) {
    const write = resolveWrite(queued, report), hash = digest(write), prior = confirmed.get(write.id);
    const file = path.join(root, 'consumed', `${report.issue}-a${report.attempt}`, `${write.id}.json`);
    const durable = fs.existsSync(file) ? readJson(file) : null;
    if ((prior && prior.result.writeDigest !== hash) || (durable &&
        (durable.writeDigest !== hash || durable.issue !== report.issue || durable.attempt !== report.attempt)))
      throw new Error(`write ${write.id} changed within attempt`);
    if (prior && write.operation === 'preflight-collect' && prior.reportDigest !== digest(report))
      throw new Error('нужен новый идентификатор сбора: collection proof belongs to another reportDigest');
    if (prior) carried.set(write.id, prior.result);
    else (write.operation === 'preflight-collect' ? collections : connectors).push(write);
  }
  if (collections.length > 1 || (collections.length && (report.phase !== 'preflight' || report.kind !== 'confirmation-request')))
    throw new Error('collection requires a single preflight confirmation-request');
  return { carried, connectors, collection: collections[0] ?? null };
}
export function publishPhase(report, output, previousConfirmation, root = previousConfirmation
  ? path.dirname(path.dirname(previousConfirmation)) : path.dirname(path.dirname(output))) {
  validatePhase(report);
  if (report.phase === 'code' && report.pre_capture_stop?.kind === 'capture-refused') {
    const history = codeHistory(root, report, path.dirname(output));
    const saved = fs.existsSync(history) ? readJson(history) : null;
    // Only exact replay may reuse source evidence; a new publication observes the actual source.
    if (!saved || canonical(saved) !== canonical(report)) {
      report = structuredClone(report);
      delete report.pre_capture_stop.source_text;
      const refusal = preCaptureStop(report);
      if (refusal) report.pre_capture_stop.source_text = refusal.source_text;
      validatePhase(report);
    }
  }
  if (implementationExit(report)) requireApprovedCriteria(report, root);
  const previous = fs.existsSync(output) ? validatePhase(readJson(output)) : null;
  report = preparePublication(report, previous, root, path.dirname(output));
  validatePhase(report);
  if (report.phase === "code" && report.phase_result !== undefined && report.phase_result !== "in-progress")
    requireApprovedCriteria(report, root);
  if (report.phase === "ship" && report.kind === "phase" && report.status === "green") validateShipCertificate(report);
  const content = value => { const { publishedAt, ...rest } = value; return rest; };
  const identical = previous && canonical(content(previous)) === canonical(content(report));
  let published = { ...report, publishedAt: new Date().toISOString() };
  if (!identical) {
    const used = verifiedConfirmations(published, root).map(ack => ack.report);
    if (previous?.issue === report.issue && previous.attempt === report.attempt) used.push(previous);
    for (const write of report.capsule.open_queue.filter(write => write.operation === 'preflight-collect')) {
      if (used.some(prior => prior.capsule.open_queue.some(item => item.operation === 'preflight-collect' &&
          item.payload.request.collectionId === write.payload.request.collectionId)))
        throw new Error('нужен новый идентификатор сбора: collectionId already used with another reportDigest');
    }
  }
  requirePredecessors(report, root, path.dirname(output), "publishing");
  if (fs.existsSync(output)) {
    if (identical) return previous;
    const ackPath = previousConfirmation ?? confirmationPath(previous, root);
    if (!fs.existsSync(ackPath)) {
      if (!deferredImplementation(previous) || !deferredProof(report, previous.sequence, previous, root))
        throw new Error("previous phase report is unconfirmed");
    } else validateConfirmation(previous, readJson(ackPath));
    if (report.attempt !== previous.attempt || report.sequence <= previous.sequence) throw new Error("phase report sequence must advance in the same attempt; archive reconciled old attempts first");
  }
  if (implementationExit(published)) {
    const history = codeHistory(root, published, path.dirname(output));
    if (fs.existsSync(history)) {
      const saved = readJson(history);
      if (canonical(content(saved)) !== canonical(content(published))) throw new Error('immutable code report fingerprint mismatch');
      published = saved;
    } else atomicJson(history, published);
  }
  atomicJson(output, published);
  return published;
}
export function resolveWrite(write, report) {
  if (literalImplementationComment(write)) return write;
  function resolve(value) {
    if (typeof value === "string" && value.includes("append #/certificate")) {
      if (typeof report.certificate !== "string" || !report.certificate.trim()) throw new Error("certificate pointer has no certificate");
      if (value.split("append #/certificate").length !== 2) throw new Error("certificate pointer must occur once");
      return value.replace("append #/certificate", () => report.certificate);
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
    return value;
  }
  return resolve(write);
}
export async function confirmQueue(report, root, adapter, reportsDir = path.join(root, "reports"), deadline = Infinity) {
  validatePhase(report);
  const inTime = () => { if (Date.now() >= deadline) throw new Error("timed-out: collection confirmation deadline expired"); };
  const dir = path.join(root, "consumed", `${report.issue}-a${report.attempt}`);
  return withLock(path.join(dir, "queue.lock"), async () => {
    requirePredecessors(report, root, reportsDir, "confirming");
    const { carried } = classifyQueue(report, root);
    const results = [];
    for (const queuedWrite of report.capsule.open_queue) {
      if (carried.has(queuedWrite.id)) { inTime(); results.push(carried.get(queuedWrite.id)); continue; }
      const write = resolveWrite(queuedWrite, report);
      const file = path.join(dir, `${write.id}.json`);
      const hash = digest(write);
      const prior = fs.existsSync(file) ? readJson(file) : null;
      if (prior && (prior.writeDigest !== hash || prior.issue !== report.issue || prior.attempt !== report.attempt)) throw new Error(`write ${write.id} changed within attempt`);
      // Reconcile even a durable success: a lost response or deleted Linear object
      // must not turn a local receipt into proof of the current remote state.
      inTime();
      let observed = await adapter("reconcile", write, report);
      inTime();
      if (observed?.state === "missing") {
        atomicJson(file, { issue: report.issue, attempt: report.attempt, id: write.id, writeDigest: hash, state: "applying" });
        await adapter("apply", write, report);
        inTime();
        observed = await adapter("reconcile", write, report);
      }
      inTime();
      if (observed?.state !== "present" || !observed.evidence) throw new Error(`write ${write.id} not confirmed by Linear read-back`);
      validateCollectionEvidence(write, observed.evidence, report);
      const result = { issue: report.issue, attempt: report.attempt, id: write.id, writeDigest: hash, state: "present", evidence: observed.evidence };
      atomicJson(file, result); results.push(result);
    }
    requirePredecessors(report, root, reportsDir, "confirming");
    const confirmation = { report, issue: report.issue, attempt: report.attempt, phase: report.phase, sequence: report.sequence,
      reportDigest: digest(report), status: "confirmed", results };
    inTime();
    atomicJson(confirmationPath(report, root), confirmation);
    return confirmation;
  });
}
export async function waitForConfirmation(report, file, timeoutSec, pollSec = 1) {
  validatePhase(report);
  if (!requiresConfirmation(report)) return;
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
export async function waitForGateAck({ root, issue, attempt, ack, moves, config }) {
  if (!path.isAbsolute(root ?? "") || !path.isAbsolute(ack ?? "") ||
      !/^[A-Z][A-Z0-9]*-\d+$/.test(issue) || !Number.isInteger(attempt) || attempt < 1 || !Array.isArray(moves))
    throw new Error("invalid gate-ack wait request");
  let fd;
  const candidates = [ack, ack.replace(/\.json$/, ".applied.json"), ack.replace(/\.json$/, ".rejected.json")];
  for (const candidate of candidates) {
    try { fd = fs.openSync(candidate, "r"); break; }
    catch (error) { if (error.code !== "ENOENT" || candidate === candidates.at(-1)) throw error; }
  }
  let own, ackMtime;
  try { own = JSON.parse(fs.readFileSync(fd, "utf8")); ackMtime = fs.fstatSync(fd).mtimeMs; }
  finally { fs.closeSync(fd); }
  const ackDigest = digest(own);
  if (own.issue !== issue || own.phase !== "gate" || own.status !== "gates-passed") throw new Error("invalid own gate-ack");
  const { ackWaitSec, pollSec } = deliveryConfig(config);
  const deadline = ackMtime + ackWaitSec * 1000;
  const file = path.join(root, "consumed", `${issue}-gate-ack-a${attempt}.json`);
  while (true) {
    if (fs.existsSync(file)) {
      const record = readJson(file);
      if (record.issue !== issue || record.attempt !== attempt || record.ackDigest !== ackDigest)
        throw new Error("gate-ack consumption identity/digest mismatch");
      if (["blocked", "rejected"].includes(record.outcome)) throw new Error(`gate-ack ${record.outcome}`);
      if (record.outcome !== "applied") throw new Error("invalid gate-ack consumption outcome");
      if (!Array.isArray(record.readback) || record.readback.length !== moves.length ||
          record.readback.some((entry, index) => entry?.moveDigest !== digest(moves[index]) || !entry.evidence))
        throw new Error("lifecycle read-back incomplete");
      return record;
    }
    if (Date.now() >= deadline) throw new Error("write-unconfirmed: gate-ack consumption not confirmed");
    await new Promise(resolve => setTimeout(resolve, Math.min(pollSec * 1000, deadline - Date.now())));
  }
}
if (isMain(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2); const args = flags(rest);
    if (command === "--help" || args.help) console.log("Usage: delivery-state.mjs capture-criteria --issue <KEY> --attempt <N> --issue-file <approved Issue read> --root <delivery root> | publish --report <file> --output <file> [--confirmation <previous ack>] [--root <orchestrator root>] | wait-ack --root <root> --issue <KEY> --attempt <N> --ack <path> --moves <json-file> [--config <file>] | confirm --report <file> --root <dir> --adapter <executable> [--config <file>] | wait --report <file> --confirmation <file> [--config <file>]\nPhase: {issue,stage:'mono-deliver',attempt,packVersion,sourceCommit,surfaceRevision,phase:'code|preflight|ship',sequence,kind:'phase|confirmation-request',head,linear_mutations_pending:[{id,operation,target,payload}],capsule:{phase,head,open_queue:[same writes],decisions:[],writable_roots:[dispatch grants]}}. publish adds publishedAt, so resumed waits retain the original deadline. Publish/confirm require all earlier sequence confirmations and the latest earlier phase reports for this attempt. Confirmations retain their report snapshot. Fallback publish supplies --root explicitly (or the previous standard mailbox confirmation); confirm reads predecessor reports from the current report directory and the root mailbox, refusing conflicting copies. A single append #/certificate pointer within a payload string expands to report.certificate before hashing/applying; changed certificate needs a new write ID. Adapter stdin: {action:'reconcile|apply',issue,attempt,idempotencyKey,write}; reconcile returns {state:'present|missing|unknown',evidence}; present needs evidence, missing must be positively observed. IDs persist across retries; results bind the current attempt.");
    else if (command === "capture-criteria") {
      const captured = captureCriteria({ root: args.root, issue: args.issue, attempt: Number(args.attempt), issueFile: args["issue-file"] });
      console.log(JSON.stringify(captured));
      console.log("delivery-state capture-criteria: pass");
    } else if (command === "wait-ack") {
      const record = await waitForGateAck({ root: args.root, issue: args.issue, attempt: Number(args.attempt),
        ack: args.ack, moves: readJson(args.moves), config: args.config });
      console.log(JSON.stringify(record));
      console.log("delivery-state wait-ack: pass");
    } else {
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
