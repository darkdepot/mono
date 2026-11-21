#!/usr/bin/env node
import fs from "node:fs";
import { validateShipCertificate } from "./ship-certificate.mjs";
import { qaDeliveryState } from './qa-gate.mjs';
export { qaDeliveryState } from './qa-gate.mjs';
import path from "node:path";
import { atomicJson, canonical, digest, readJson, identity, IDENTITY_FIELDS, isMain, flags, deliveryConfig } from "./runtime.mjs";
import { waitForRound } from "./review-rounds.mjs";

import { workerTransport } from "./worker-transport.mjs";

import { captureCriteria, requireApprovedCriteria, preCaptureStop } from "./delivery-criteria.mjs";
import { implementationComment, implementationExit } from './implementation-comment.mjs';
export { captureCriteria } from "./delivery-criteria.mjs";

export const PHASES = ["code", "preflight", "ship"];
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
export function validatePhase(report) {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(report?.issue) || report.stage !== "mono-deliver" || !identity(report) ||
      !Number.isInteger(report.attempt) || report.attempt < 1 || !Number.isInteger(report.sequence) || report.sequence < 1 ||
      !PHASES.includes(report.phase) || report.kind !== "phase" || !/^[a-f0-9]{40}$/.test(report.head)) throw new Error("invalid phase identity");
  const capsule = report.capsule;
  if (capsule?.phase !== report.phase || capsule.head !== report.head || !Array.isArray(capsule.decisions) ||
      !Array.isArray(capsule.writable_roots) || !capsule.writable_roots.length || capsule.writable_roots.some(root => !path.isAbsolute(root))) throw new Error("invalid state capsule");
  // No write queue: the worker writes Linear itself and requests a review round with a round file.
  for (const queued of [report.linear_mutations_pending, capsule.open_queue])
    if (queued !== undefined && !(Array.isArray(queued) && !queued.length))
      throw new Error("queued writes no longer exist: write Linear through Linear MCP and request a review round with KEY-round-aN.json");
  refuseDecisionEntries(report);
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
// The review decision journal and its pilot are gone; nothing reads these fields.
function refuseDecisionEntries(report) {
  for (const field of ["review_dispositions", "behaviour_matrices", "checkpoint", "progress_claim"])
    if (report[field] !== undefined && !(Array.isArray(report[field]) && !report[field].length))
      throw new Error(`${field}: decision entries no longer exist; remove the field from the report`);
}
// Earlier phases must exist for this attempt; only the latest earlier-phase report is checked here.
export function requirePredecessors(report, root, reportsDir, action) {
  const sameAttempt = candidate => candidate.issue === report.issue && candidate.attempt === report.attempt &&
    IDENTITY_FIELDS.every(field => candidate[field] === report[field]);
  for (const phase of PHASES.slice(0, PHASES.indexOf(report.phase))) {
    const name = `${report.issue}-phase-${phase}.json`;
    const candidates = [...new Set([path.join(root, "reports", name), path.join(reportsDir, name),
      ...report.capsule.writable_roots.map(grant => path.join(grant, ".orchestrator", name))])]
      .filter(file => fs.existsSync(file)).map(file => validatePhase(readJson(file)));
    if (!candidates.length) throw new Error(`phase ${phase} report is missing; publish it before ${action} ${report.phase}`);
    const latest = candidates[0];
    if (!sameAttempt(latest) || latest.phase !== phase || candidates.some(other => canonical(other) !== canonical(latest)))
      throw new Error(`phase ${phase} report is foreign or conflicts between mailboxes; reconcile before ${action} ${report.phase}`);
  }
}
function codeHistory(root, report, directory = path.join(root, 'reports')) {
  return path.join(directory, `${report.issue}-phase-code-a${report.attempt}-s${report.sequence}.json`);
}
export function publishPhase(report, output, root = path.dirname(path.dirname(output))) {
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
  if (report.phase === "code" && report.phase_result !== undefined && report.phase_result !== "in-progress")
    requireApprovedCriteria(report, root);
  const previous = fs.existsSync(output) ? validatePhase(readJson(output)) : null;
  if (report.phase === "ship" && report.kind === "phase" && report.status === "green") validateShipCertificate(report);
  const content = value => { const { publishedAt, ...rest } = value; return rest; };
  const identical = previous && canonical(content(previous)) === canonical(content(report));
  let published = { ...report, publishedAt: new Date().toISOString() };
  requirePredecessors(report, root, path.dirname(output), "publishing");
  if (fs.existsSync(output)) {
    if (identical) return previous;
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
    if (command === "--help" || args.help) console.log("Usage: delivery-state.mjs capture-criteria --issue <KEY> --attempt <N> --issue-file <approved Issue read> --root <delivery root> | publish --report <file> --output <file> [--root <orchestrator root>] | comment --report <published code report> | wait-ack --root <root> --issue <KEY> --attempt <N> --ack <path> --moves <json-file> [--config <file>] | wait-round --request <KEY-round-aN.json>\nPhase: {issue,stage:'mono-deliver',attempt,packVersion,sourceCommit,surfaceRevision,phase:'code|preflight|ship',sequence,kind:'phase',head,capsule:{phase,head,decisions:[],writable_roots:[dispatch grants]}}. The worker writes Linear comments and statuses through Linear MCP and reads them back; there is no write queue. A review round: write {issue,attempt,request:<gate publishRequest>} to reports/KEY-round-aN.json, then wait-round prints the collector's result bound to that request (collectionId and digest) and exits 0 when the round ran; rerun gate preflight collect:false. Publish requires the latest earlier phase reports of this attempt. comment prints the Russian implementation comment body of a published code report for the worker to post verbatim.");
    else if (command === 'qa-status') {
      const report = readJson(args.report);
      if (['stage', 'phase', 'attempt', 'sequence', 'capsule'].some(key => Object.hasOwn(report, key))) validatePhase(report);
      validateShipCertificate(report);
      const qa = qaDeliveryState({ root: args.root, config: readJson(args.config), issue: report.issue,
        head: report.head, shipCertificate: report.certificate });
      console.log(JSON.stringify(qa));
      process.exitCode = qa.state === 'waiting' ? 2 : qa.state === 'failed' ? 1 : 0;
    } else if (command === "capture-criteria") {
      const captured = captureCriteria({ root: args.root, issue: args.issue, attempt: Number(args.attempt), issueFile: args["issue-file"] });
      console.log(JSON.stringify(captured));
      console.log("delivery-state capture-criteria: pass");
    } else if (command === "wait-ack") {
      const record = await waitForGateAck({ root: args.root, issue: args.issue, attempt: Number(args.attempt),
        ack: args.ack, moves: readJson(args.moves), config: args.config });
      console.log(JSON.stringify(record));
      console.log("delivery-state wait-ack: pass");
    } else if (command === "wait-round") {
      const result = await waitForRound(args.request);
      console.log(JSON.stringify(result));
      if (result.status !== "done") throw new Error(`review round ${result.status}: ${result.reason ?? "see the collector log"}`);
      console.log("delivery-state wait-round: pass");
    } else {
      const report = validatePhase(readJson(args.report));
      if (command === "publish") publishPhase(report, args.output, args.root);
      else if (command === "comment") {
        if (!implementationExit(report)) throw new Error("comment requires a code exit report");
        process.stdout.write(implementationComment(report).payload.body + "\n");
      } else throw new Error(`unknown command ${command}`);
      if (command !== "comment") console.log(`delivery-state ${command}: pass`);
    }
  } catch (error) { console.error(`delivery-state: ${error.message}`); process.exitCode = 1; }
}
