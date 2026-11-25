// Review rounds: the worker writes a round request file into its mailbox; the
// collector, started at attempt launch, admits it into a host-owned ledger and
// records one terminal result bound to that request (collectionId and digest).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicJson, canonical, digest, readJson, lockTreeDead, syncDir, processTable, REVIEW_PRODUCER } from "./runtime.mjs";

export const TERMINAL = ["done", "refused", "failed"];
export const roundRequestName = (issue, attempt) => `${issue}-round-a${attempt}.json`;
export const roundsDirectory = (root, issue, attempt) => path.join(root, "consumed", `${issue}-a${attempt}`, "rounds");
export const collectorLock = (root, issue, attempt) => path.join(root, "reports", `${issue}-collector-a${attempt}.lock`);
export const requestDigest = request => digest({ ...request, collect: false });
// Host verification (pinned hostVerification): the marker exists while the collection's host run may still
// write; a receipt for that collection is untrusted until the gate removes it after its evidence check.
// The marker holds the run's process group and the evidence snapshot taken before it started, so the
// gate (normal end) and collector recovery (gate died mid-run) settle the same way.
export const hostRunMarker = (evidenceRoot, collectionId) =>
  path.join(evidenceRoot, "verification", `${collectionId.replace(/[^A-Za-z0-9.-]+/g, "-")}.running`);
// The clean checkout of the request's committed head that the host run executes in (a repository of its own, never
// the worker's working copy). Derived like the marker, so recovery never removes a path read from a file.
export const hostRunCheckout = (evidenceRoot, collectionId) => hostRunMarker(evidenceRoot, collectionId).replace(/\.running$/, ".checkout");
export const removeHostCheckout = (evidenceRoot, collectionId) => fs.rmSync(hostRunCheckout(evidenceRoot, collectionId), { recursive: true, force: true });
export function quarantineEvidence(evidenceRoot, file) {
  const target = path.join(evidenceRoot, "quarantine", `${Date.now()}-${path.basename(file)}`);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(file, target);
}
const attemptOf = (receiptPins, pinsFile) => typeof receiptPins === "string" && path.dirname(receiptPins) === path.dirname(pinsFile);
// Receipts a host run could plant or edit: history (append-only for every attempt) and the head receipts.
// While the run is going only this attempt's collection writes receipts bound to its pins, so a changed
// history file, or a new or changed receipt bound to these pins, means the run touched the evidence.
// Head receipts of other attempts may be replaced legitimately meanwhile and are not judged.
// MONO-481: host screen check results (screen-check/) are judged whole: only the host writes them and never during
// a host run (qa.mjs screen-check refuses while one is going), so any change there is the run's and is put back.
export function evidenceSnapshot(evidenceRoot, pinsFile) {
  const files = [];
  for (const directory of [evidenceRoot, path.join(evidenceRoot, "history"), path.join(evidenceRoot, "screen-check")]) {
    if (!fs.existsSync(directory)) continue;
    const screen = directory.endsWith(`${path.sep}screen-check`);
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".json"))) {
      const file = path.join(directory, name);
      let bytes; try { if (!fs.lstatSync(file).isFile()) continue; bytes = fs.readFileSync(file); } catch { continue; }
      let ours = false; try { ours = attemptOf(JSON.parse(bytes).receipt?.pins?.file, pinsFile); } catch {}
      files.push([file, { hash: crypto.createHash("sha256").update(bytes).digest("hex"), ours, history: directory !== evidenceRoot,
        ...(screen ? { screen } : {}), ...(ours || screen ? { bytes: bytes.toString("base64") } : {}) }]);
    }
  }
  return files;
}
// Puts this attempt's earlier receipts and every screen check result back, quarantines new ones; returns what changed.
export function evidenceTouched(snapshot, evidenceRoot, pinsFile) {
  const before = new Map(snapshot), after = new Map(evidenceSnapshot(evidenceRoot, pinsFile)), touched = [];
  for (const [file, old] of before) {
    const now = after.get(file);
    if (now?.hash === old.hash || (!old.history && !now?.ours)) continue;
    touched.push(path.relative(evidenceRoot, file));
    if (old.ours || old.screen) { fs.rmSync(file, { force: true, recursive: true }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(old.bytes, "base64"), { flag: "wx" }); }
    else if (now?.ours) quarantineEvidence(evidenceRoot, file);
  }
  for (const [file, now] of after) {
    if (before.has(file) || !(now.ours || now.screen)) continue;
    touched.push(path.relative(evidenceRoot, file)); quarantineEvidence(evidenceRoot, file);
  }
  return touched.length ? `evidence changed during host verification: ${touched.join(", ")}` : null;
}
// Kills the run's group until telemetry shows no live member; returns an error text otherwise. A group id can
// be reused only after the group is gone: a live leader with another start identity means ours already ended,
// and members whose original leader exited still carry our id and are ours.
export async function stopHostGroup(group, procStart = null) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let members;
    try { members = processTable().filter(row => row.group === group && !row.state.startsWith("Z")); }
    catch (error) { return `verification descendants unverified: ${error.message}`; }
    const leader = members.find(row => row.pid === group);
    if (!members.length || (procStart && leader && leader.procStart !== procStart)) return null;
    try { process.kill(-group, "SIGKILL"); } catch (error) { if (!["ESRCH", "EPERM"].includes(error.code)) return `verification group not stopped: ${error.message}`; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return "verification descendants still live after SIGKILL";
}
// Collector recovery after a gate that died during its host run: stop the group (or refuse while it may live),
// remove the head checkout, settle the evidence against the stored snapshot, quarantine anything left for this
// collection, drop the marker.
export async function recoverHostRun(evidenceRoot, collectionId, pinsFile) {
  if (!fs.existsSync(hostRunMarker(evidenceRoot, collectionId))) return null;
  // The gate snapshots the resolved evidence root: a request path through a symlink must compare the same files.
  evidenceRoot = fs.realpathSync(evidenceRoot);
  const marker = hostRunMarker(evidenceRoot, collectionId);
  const state = readJson(marker);
  // A marker without a group was written before the run was released: nothing ran.
  if (state.group !== null) {
    // The gate registers a group only with its start identity; without one no group is ever signalled.
    const failure = Number.isInteger(state.group) && state.group > 0 && state.procStart ? await stopHostGroup(state.group, state.procStart) : "verification group without a start identity";
    if (failure) throw new Error(`host verification group of ${collectionId} not confirmed stopped: ${failure}`);
  }
  removeHostCheckout(evidenceRoot, collectionId);
  const touched = evidenceTouched(state.snapshot ?? [], evidenceRoot, pinsFile);
  for (const directory of [evidenceRoot, path.join(evidenceRoot, "history")]) if (fs.existsSync(directory))
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".json"))) {
      let id = null; try { id = readJson(path.join(directory, name)).receipt?.collectionId; } catch {}
      if (id === collectionId) quarantineEvidence(evidenceRoot, path.join(directory, name));
    }
  fs.rmSync(marker, { force: true });
  return touched ?? "host run interrupted";
}

// MONO-481 pinned screenCheck: before the attempt's first spent review round the host compares the screens of
// exactly the requested committed head with the approved mockups (mono:qa given-version) and writes the result
// here, in evidenceRoot, outside every worker grant. Only the host writes it (`qa.mjs screen-check`).
export const SCREEN_OUTCOMES = ["passed", "mismatches"];
export const screenCheckFile = (evidenceRoot, head) => path.join(evidenceRoot, "screen-check", `${head}.json`);
// The approved mockup lives in the attempt's dispatch snapshot (design.json and design/*.png beside the pins), not in
// the commit: its digest binds a result to the images it was checked against.
export function screenDesignDigest(pinsFile) {
  const snapshot = path.join(path.dirname(pinsFile), "snapshot"), hash = crypto.createHash("sha256");
  const manifest = path.join(snapshot, "design.json"), images = path.join(snapshot, "design");
  hash.update(fs.existsSync(manifest) ? fs.readFileSync(manifest) : "no design.json").update("\0");
  for (const name of fs.existsSync(images) ? fs.readdirSync(images).sort() : [])
    hash.update(name).update("\0").update(fs.readFileSync(path.join(images, name))).update("\0");
  return hash.digest("hex");
}
const attemptNumber = pinsFile => Number(/-a([1-9][0-9]*)$/.exec(path.basename(path.dirname(pinsFile)))?.[1] ?? NaN);
// The result is bound to the attempt (its launch pins file and digest, attempt number) and to the approved design
// digest: it counts for that attempt and those images only.
export function writeScreenCheck(evidenceRoot, head, outcome, report, pins) {
  if (!/^[a-f0-9]{40}$/.test(head ?? "")) throw new Error("screen check: head must be a full commit SHA");
  if (!SCREEN_OUTCOMES.includes(outcome)) throw new Error(`screen check: outcome must be ${SCREEN_OUTCOMES.join(" or ")}`);
  if (typeof report !== "string" || !report.trim() || /[\r\n]/.test(report)) throw new Error("screen check: report must name the check report on one line");
  if (!path.isAbsolute(pins?.file ?? "") || !/^[a-f0-9]{64}$/.test(pins?.digest ?? "")) throw new Error("screen check: launch pins binding {file, digest} required");
  // A host run judges every change in screen-check/ as its own and puts it back: never write during one.
  const runs = path.join(evidenceRoot, "verification");
  if (fs.existsSync(runs) && fs.readdirSync(runs).some(name => name.endsWith(".running")))
    throw new Error("screen check: a host verification is running in this evidence root; write the result after it ends");
  const file = screenCheckFile(evidenceRoot, head);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  atomicJson(file, { head, outcome, report, pins: { file: pins.file, digest: pins.digest }, attempt: attemptNumber(pins.file),
    design: screenDesignDigest(pins.file), recordedAt: new Date().toISOString() });
  return file;
}
// The collector's note that a round waits for the host's screen check, in the host-owned ledger (outside worker
// grants); the watcher reports it as EVENT:screen-check until the collector removes it.
export const screenCheckRequestFile = (root, issue, attempt) => path.join(root, "consumed", `${issue}-a${attempt}`, "screen-check-request.json");
// Completed (spent) review rounds of this attempt in the receipt history; unreadable files are not rounds.
export function spentRounds(evidenceRoot, pinsFile) {
  const history = path.join(evidenceRoot, "history");
  if (!fs.existsSync(history)) return 0;
  return fs.readdirSync(history).filter(name => name.endsWith(".json")).filter(name => {
    try {
      const file = path.join(history, name), stat = fs.lstatSync(file);
      const receipt = stat.isFile() && !stat.isSymbolicLink() ? readJson(file).receipt : null;
      return receipt?.producer === REVIEW_PRODUCER && attemptOf(receipt.pins?.file, pinsFile) && receipt.review?.spent === true;
    } catch { return false; }
  }).length;
}
// What holds the attempt's first round: null when it may run, otherwise {state: waiting|mismatches, reason}.
// A result that is not a regular file, is unreadable, names another head, another attempt or other launch pins, or
// was checked against other approved images counts as no result.
export function readScreenCheck(evidenceRoot, head, binding) {
  try {
    const file = screenCheckFile(evidenceRoot, head), stat = fs.lstatSync(file);
    const result = stat.isFile() && !stat.isSymbolicLink() ? readJson(file) : null;
    return result?.head === head && SCREEN_OUTCOMES.includes(result.outcome) && typeof binding?.file === "string" &&
      result.pins?.file === binding.file && result.pins?.digest === binding.digest && result.attempt === attemptNumber(binding.file) &&
      result.design === screenDesignDigest(binding.file) ? result : null;
  } catch { return null; }
}
export function screenCheckHold({ pins, binding, spent, evidenceRoot, head }) {
  if (pins?.screenCheck !== true || spent > 0) return null;
  const result = readScreenCheck(evidenceRoot, head, binding);
  if (!result)
    return { state: "waiting", reason: "screen check on the host has no result for this head yet; no round spent, request this head again after a few minutes" };
  if (result.outcome === "mismatches")
    return { state: "mismatches", reason: `screen check on the host found mismatches with the mockup on this head (report ${String(result.report ?? "").replace(/\s+/g, " ").slice(0, 500)}); ` +
      "fix them from the task change and request the new head; no round spent" };
  return null;
}

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
  // Publish the complete admission exclusively: a crash never leaves an empty ledger entry.
  const temporary = `${file}.${process.pid}.tmp`, fd = fs.openSync(temporary, "w", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(admission, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temporary, file); } finally { fs.unlinkSync(temporary); }
  syncDir(path.dirname(file));
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
