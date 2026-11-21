// Review rounds: the worker writes a round request file into its mailbox; the
// collector, started at attempt launch, admits it into a host-owned ledger and
// records one terminal result bound to that request (collectionId and digest).
import fs from "node:fs";
import path from "node:path";
import { atomicJson, canonical, digest, readJson, lockTreeDead } from "./runtime.mjs";

export const TERMINAL = ["done", "refused", "failed"];
export const roundRequestName = (issue, attempt) => `${issue}-round-a${attempt}.json`;
export const roundsDirectory = (root, issue, attempt) => path.join(root, "consumed", `${issue}-a${attempt}`, "rounds");
export const collectorLock = (root, issue, attempt) => path.join(root, "reports", `${issue}-collector-a${attempt}.lock`);
export const requestDigest = request => digest({ ...request, collect: false });

export function validRoundRequest(round) {
  const request = round?.request;
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(round?.issue ?? "") || !Number.isInteger(round.attempt) || round.attempt < 1 ||
      !request || typeof request !== "object" || request.collect !== false || !/^[a-f0-9]{40}$/.test(request.head ?? "") ||
      !new RegExp(`^preflight-collect:${request.head}:[1-9][0-9]*$`).test(request.collectionId ?? "") || !path.isAbsolute(request.root ?? ""))
    throw new Error("invalid round request: {issue, attempt, request: gate publishRequest with collect:false}");
  return round;
}

// The ledger is append-only: ordinals 1..n, each admission followed by at most one result.
export function readLedger(root, issue, attempt) {
  const directory = roundsDirectory(root, issue, attempt);
  const names = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  const admissions = names.filter(name => /^[1-9][0-9]*\.json$/.test(name)).map(name => readJson(path.join(directory, name)))
    .sort((a, b) => a.ordinal - b.ordinal);
  admissions.forEach((admission, index) => {
    if (admission.ordinal !== index + 1) throw new Error("round ledger ordinals are not contiguous");
  });
  return admissions.map(admission => {
    const file = path.join(directory, `${admission.ordinal}.result.json`);
    const result = fs.existsSync(file) ? readJson(file) : null;
    if (result && (result.ordinal !== admission.ordinal || result.collectionId !== admission.collectionId ||
        result.requestDigest !== admission.requestDigest || !TERMINAL.includes(result.status))) throw new Error(`round ${admission.ordinal} result does not match its admission`);
    return { admission, result };
  });
}
export const inFlight = ledger => ledger.filter(item => !item.result);
export function admissionFor(ledger, collectionId) {
  return ledger.find(item => item.admission.collectionId === collectionId) ?? null;
}

// A new collectionId is admitted only after every earlier round has a terminal result;
// the same collectionId with another request is never admitted again.
export function admitRound(root, issue, attempt, request, extra = {}) {
  const ledger = readLedger(root, issue, attempt), hash = requestDigest(request);
  const prior = admissionFor(ledger, request.collectionId);
  if (prior) {
    if (prior.admission.requestDigest !== hash) throw new Error(`collectionId ${request.collectionId} already admitted for another request; use a new collectionId`);
    return prior.admission;
  }
  const open = inFlight(ledger);
  if (open.length) throw new Error(`round ${open[0].admission.ordinal} (${open[0].admission.collectionId}) has no result yet`);
  const admission = { ordinal: ledger.length + 1, collectionId: request.collectionId, requestDigest: hash,
    request: { ...request, collect: false }, admittedAt: new Date().toISOString(), ...extra };
  const file = path.join(roundsDirectory(root, issue, attempt), `${admission.ordinal}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "wx", 0o600); fs.closeSync(fd);
  atomicJson(file, admission);
  return admission;
}
export function recordResult(root, issue, attempt, admission, outcome) {
  if (!TERMINAL.includes(outcome.status)) throw new Error("round result status must be done, refused or failed");
  const file = path.join(roundsDirectory(root, issue, attempt), `${admission.ordinal}.result.json`);
  if (fs.existsSync(file)) return readJson(file);
  const result = { ordinal: admission.ordinal, collectionId: admission.collectionId, requestDigest: admission.requestDigest,
    ...outcome, recordedAt: new Date().toISOString() };
  atomicJson(file, result);
  return result;
}

export function collectorAlive(root, issue, attempt) {
  const file = collectorLock(root, issue, attempt);
  try { return fs.existsSync(file) && !lockTreeDead(readJson(file)); } catch { return true; } // Unknown telemetry is not death.
}

// Worker side: wait until the collector records the result of exactly this request.
// The collector starts with the attempt just after the worker; a missing collector
// stops the wait only once the request is older than the start grace.
export const COLLECTOR_START_GRACE_MS = 60_000;
export async function waitForRound(roundFile, pollMs = 2000) {
  const round = validRoundRequest(readJson(roundFile)), request = round.request, hash = requestDigest(request);
  if (path.basename(roundFile) !== roundRequestName(round.issue, round.attempt)) throw new Error("round request file name must be KEY-round-aN.json");
  while (true) {
    const found = admissionFor(readLedger(request.root, round.issue, round.attempt), request.collectionId);
    if (found && found.admission.requestDigest !== hash) throw new Error(`collectionId ${request.collectionId} already admitted for another request; use a new collectionId`);
    if (found?.result) {
      if (canonical(readJson(roundFile)) !== canonical(round)) throw new Error("round request changed while waiting");
      return found.result;
    }
    if (!collectorAlive(request.root, round.issue, round.attempt) && Date.now() - fs.statSync(roundFile).mtimeMs > COLLECTOR_START_GRACE_MS) throw new Error("blocked: collector not running for this attempt; the orchestrator restarts it with collector.mjs start");
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
