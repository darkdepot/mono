// Review rounds: the worker writes a round request file into its mailbox; the
// collector, started at attempt launch, admits it into a host-owned ledger and
// records one terminal result bound to that request (collectionId and digest).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicJson, canonical, digest, readJson, lockTreeDead, syncDir, processTable, withLockSync, REVIEW_PRODUCER } from "./runtime.mjs";

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
// MONO-502: the review gate reads history receipts of earlier attempts of the same issue (their record carries over),
// so in history any receipt of the issue is judged and kept like this attempt's own.
const issueOf = file => /^([A-Z][A-Z0-9]*-[1-9][0-9]*)-a[1-9][0-9]*$/.exec(path.basename(path.dirname(file)))?.[1];
const issueOfAttempt = (receiptPins, pinsFile) => typeof receiptPins === "string" && path.dirname(path.dirname(receiptPins)) === path.dirname(path.dirname(pinsFile)) &&
  !!issueOf(pinsFile) && issueOf(receiptPins) === issueOf(pinsFile);
// Receipts a host run could plant or edit: history (append-only for every attempt) and the head receipts.
// While the run is going only this attempt's collection writes receipts bound to its pins, so a changed
// history file, or a new or changed receipt bound to these pins, means the run touched the evidence.
// Head receipts of other attempts may be replaced legitimately meanwhile and are not judged.
// MONO-483: the attempt's host-owned control files beside the launch pins (task-changes.json, review-retries.json)
// are judged too: the run has host rights, and a planted task change or review retry would steer the review gate.
const CONTROL_FILES = ["task-changes.json", "review-retries.json"];
// Control files whose entries a refused startup may void during the run: each is restored under its own lock.
const VOIDABLE = { "review-retries.json": "review-retries.lock" };
// MONO-482 review: the run's host rights reach every attempt of the root, so the control files of every attempt
// directory under dispatch/ are judged (a later attempt's directory created during the run too), not only its own.
const attemptDirectories = pinsFile => {
  const own = path.dirname(pinsFile), dispatch = path.dirname(own);
  let names = [];
  try { names = fs.readdirSync(dispatch); } catch {}
  const dirs = names.map(name => path.join(dispatch, name)).filter(dir => { try { return fs.lstatSync(dir).isDirectory(); } catch { return false; } });
  return [...new Set([own, ...dirs])].sort();
};
const controlLabel = (file, pinsFile) => path.dirname(file) === path.dirname(pinsFile) ? path.basename(file) : `${path.basename(path.dirname(file))}/${path.basename(file)}`;
export function evidenceSnapshot(evidenceRoot, pinsFile) {
  const files = [];
  for (const directory of attemptDirectories(pinsFile)) for (const name of CONTROL_FILES) {
    const file = path.join(directory, name);
    let bytes; try { if (!fs.lstatSync(file).isFile()) { files.push([file, { hash: "irregular", ours: true, history: false, control: true }]); continue; } bytes = fs.readFileSync(file); } catch { continue; }
    files.push([file, { hash: crypto.createHash("sha256").update(bytes).digest("hex"), ours: true, history: false, control: true, bytes: bytes.toString("base64") }]);
  }
  files.push(...reviewGroupsSnapshot(evidenceRoot, pinsFile));
  for (const directory of [evidenceRoot, path.join(evidenceRoot, "history")]) {
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".json"))) {
      const file = path.join(directory, name);
      let bytes; try { if (!fs.lstatSync(file).isFile()) continue; bytes = fs.readFileSync(file); } catch { continue; }
      let ours = false;
      try { const pins = JSON.parse(bytes).receipt?.pins?.file; ours = attemptOf(pins, pinsFile) || (directory === path.join(evidenceRoot, "history") && issueOfAttempt(pins, pinsFile)); } catch {}
      files.push([file, { hash: crypto.createHash("sha256").update(bytes).digest("hex"), ours, history: directory === path.join(evidenceRoot, "history"),
        ...(ours ? { bytes: bytes.toString("base64") } : {}) }]);
    }
  }
  return files;
}
// The snapshot of review-retries.json goes back under its own lock, but a void the current file
// carries for the same entry is kept: a void only narrows what an entry may do (a refused startup may void it during the host run).
function restoreVoidable(file, bytes) {
  withLockSync(path.join(path.dirname(file), VOIDABLE[path.basename(file)]), () => {
    const old = JSON.parse(Buffer.from(bytes, "base64").toString("utf8"));
    let current = []; try { current = fs.lstatSync(file).isFile() ? JSON.parse(fs.readFileSync(file, "utf8")) : []; } catch {}
    const voided = new Map((Array.isArray(current) ? current : []).filter(item => typeof item?.void === "string").map(item => [`${item.number}@${item.recordedAt}`, item.void]));
    const restored = Array.isArray(old) ? old.map(item => voided.has(`${item?.number}@${item?.recordedAt}`) && item.void === undefined ? { ...item, void: voided.get(`${item.number}@${item.recordedAt}`) } : item) : old;
    fs.rmSync(file, { recursive: true, force: true });
    // Byte for byte when no void had to be kept.
    if (canonical(restored) === canonical(old)) fs.writeFileSync(file, Buffer.from(bytes, "base64"), { flag: "wx" }); else atomicJson(file, restored);
  });
}
// Puts this attempt's earlier receipts back and quarantines new ones bound to it; returns what changed.
export function evidenceTouched(snapshot, evidenceRoot, pinsFile) {
  const before = new Map(snapshot), after = new Map(evidenceSnapshot(evidenceRoot, pinsFile)), touched = [];
  // MONO-494 review: saved review groups of every attempt are discarded on any change, never put back: a missing cache
  // only costs a rerun, a planted one would pass unreviewed work. This attempt's (or an irregular entry) is touched evidence.
  const label = file => path.relative(evidenceRoot, file);
  for (const [file, old] of before) {
    if (!old.cache) continue;
    const now = after.get(file);
    if (now?.hash === old.hash && old.hash !== "irregular") continue;
    fs.rmSync(file, { recursive: true, force: true });
    if (old.ours || now?.ours || old.hash === "irregular" || now?.hash === "irregular" || !now) touched.push(label(file));
  }
  for (const [file, now] of after) {
    if (!now.cache || before.has(file)) continue;
    fs.rmSync(file, { recursive: true, force: true });
    if (now.ours || now.hash === "irregular") touched.push(label(file));
  }
  for (const [file, old] of before) {
    if (old.cache) continue;
    const now = after.get(file);
    if (now?.hash === old.hash || (!old.history && !old.control && !now?.ours)) continue;
    touched.push(old.control ? controlLabel(file, pinsFile) : path.relative(evidenceRoot, file));
    if (old.control && VOIDABLE[path.basename(file)] && old.bytes !== undefined) restoreVoidable(file, old.bytes);
    else if (old.ours && old.bytes !== undefined) { fs.rmSync(file, { recursive: true, force: true }); fs.writeFileSync(file, Buffer.from(old.bytes, "base64"), { flag: "wx" }); }
    else if (old.control) fs.rmSync(file, { recursive: true, force: true });
    else if (now?.ours) quarantineEvidence(evidenceRoot, file);
  }
  for (const [file, now] of after) {
    if (now.cache || before.has(file) || !now.ours) continue;
    // A control file created during the run is moved aside into the evidence quarantine.
    touched.push(now.control ? controlLabel(file, pinsFile) : path.relative(evidenceRoot, file));
    if (now.control && now.bytes === undefined) fs.rmSync(file, { recursive: true, force: true }); else quarantineEvidence(evidenceRoot, file);
  }
  return touched.length ? `evidence changed during host verification: ${touched.join(", ")}` : null;
}
// MONO-482 review: the marker and its snapshot are written under the root's launch.lock, the lock every resume that
// writes a control file holds from its check to its write; such a resume refuses while any host run of the root is
// running or unrecovered, so a legitimate grant, retry or task change is never taken for a planted one.
// At most one host run per orchestrator root: while another marker is open or unrecovered the run is refused
// (EHOSTRUN) before its snapshot, so no snapshot ever holds another run's plant and no settlement can put one back.
export class HostRunBusy extends Error { constructor(message) { super(message); this.code = "EHOSTRUN"; } }
export function openHostRun(evidenceRoot, collectionId, pinsFile, options) {
  const marker = hostRunMarker(evidenceRoot, collectionId), root = path.dirname(path.dirname(path.dirname(pinsFile)));
  return withLockSync(path.join(root, "launch.lock"), () => {
    settleRetiredHostRunsSync(root);
    const open = hostRunsInProgress(root);
    if (open.length) throw new HostRunBusy(`host verification ${path.basename(open[0], ".running")} is running or unrecovered in this orchestrator root; ` +
      "nothing ran and no round is spent, request this head again after it ends");
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    atomicJson(marker, { collectionId, pinsFile, group: null, startedAt: new Date().toISOString(), snapshot: evidenceSnapshot(evidenceRoot, pinsFile) });
    return marker;
  }, options);
}
// A marker is recovered by its attempt's collector (recoverHostRun once its gate is dead). An attempt no longer in the
// registry has no collector left: the next opening settles its marker here, under launch.lock. Only a marker that names
// its pins file and whose run never registered a group, or whose group has ended, is settled; anything else stays busy.
export function settleRetiredHostRunsSync(root) {
  let registry = {};
  try { registry = readJson(path.join(root, "workers.json")); } catch { return; }
  for (const marker of hostRunsInProgress(root)) {
    let state; try { state = readJson(marker); } catch { continue; }
    const named = typeof state.pinsFile === "string" && /^([A-Z][A-Z0-9]*-\d+)-a([1-9][0-9]*)$/u.exec(path.basename(path.dirname(state.pinsFile)));
    if (!named || path.dirname(path.dirname(path.dirname(state.pinsFile))) !== root || registry[named[1]]?.attempt === Number(named[2])) continue;
    if (state.group !== null) {
      // Like stopHostGroup: a live leader with another start identity means the run's group ended and its id was reused.
      let live = true;
      try {
        const members = processTable().filter(row => row.group === state.group && !row.state.startsWith("Z")), leader = members.find(row => row.pid === state.group);
        live = members.length > 0 && !(state.procStart && leader && leader.procStart !== state.procStart);
      } catch { continue; }
      if (live) continue;
    }
    const evidenceRoot = path.dirname(path.dirname(marker));
    removeHostCheckout(evidenceRoot, state.collectionId);
    evidenceTouched(state.snapshot ?? [], evidenceRoot, state.pinsFile);
    fs.rmSync(marker, { force: true });
  }
}
// The host-run markers of every attempt of the root (each attempt's pinned evidence root).
export function hostRunsInProgress(root) {
  const dispatch = path.join(root, "dispatch"), roots = new Set(), markers = [];
  for (const name of fs.existsSync(dispatch) ? fs.readdirSync(dispatch) : []) {
    try { const evidenceRoot = readJson(path.join(dispatch, name, "pins.json")).evidenceRoot; if (typeof evidenceRoot === "string" && path.isAbsolute(evidenceRoot)) roots.add(evidenceRoot); } catch {}
  }
  for (const evidenceRoot of roots) {
    const directory = path.join(evidenceRoot, "verification");
    for (const name of fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith(".running")).sort() : []) markers.push(path.join(directory, name));
  }
  return markers;
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
export async function recoverHostRun(evidenceRoot, collectionId, pinsFile, { afterStop } = {}) {
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
  afterStop?.();
  // MONO-482 review: every settlement of a marker (the gate's own end, this recovery, a retired attempt's) holds the
  // root's launch.lock and re-reads the marker: one settled meanwhile is never settled again from a stale snapshot.
  return settleUnderLock(hostRunRoot(pinsFile), marker, current => {
    if (canonical(current) !== canonical(state)) return null;
    removeHostCheckout(evidenceRoot, collectionId);
    const touched = evidenceTouched(state.snapshot ?? [], evidenceRoot, pinsFile);
    for (const directory of [evidenceRoot, path.join(evidenceRoot, "history")]) if (fs.existsSync(directory))
      for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".json"))) {
        let id = null; try { id = readJson(path.join(directory, name)).receipt?.collectionId; } catch {}
        if (id === collectionId) quarantineEvidence(evidenceRoot, path.join(directory, name));
      }
    fs.rmSync(marker, { force: true });
    return touched ?? "host run interrupted";
  });
}
const hostRunRoot = pinsFile => path.dirname(path.dirname(path.dirname(pinsFile)));
// Runs action(marker state) under the root's launch.lock only while the marker still exists; null when it is gone.
function settleUnderLock(root, marker, action) {
  return withLockSync(path.join(root, "launch.lock"), () => {
    let current; try { current = readJson(marker); } catch { return null; }
    return action(current);
  });
}
// The gate's own end of its host run: under launch.lock, while its marker still exists, put back touched evidence,
// let the caller re-read what it decides from (with the run's single slot still held), then drop the marker unless
// a group may still live. {gone: true} when the marker was settled by someone else.
export function settleHostRun(evidenceRoot, collectionId, pinsFile, { keepMarker = false, reread } = {}) {
  const marker = hostRunMarker(evidenceRoot, collectionId);
  return settleUnderLock(hostRunRoot(pinsFile), marker, state => {
    const touched = evidenceTouched(state.snapshot ?? [], evidenceRoot, pinsFile);
    const read = reread?.();
    if (!keepMarker) fs.rmSync(marker, { force: true });
    return { touched, read };
  }) ?? { gone: true };
}

// MONO-481 pinned screenCheck: before the attempt's first spent review round the host compares the screens of
// exactly the requested committed head with the approved mockups (mono:qa given-version) and writes the result
// into the attempt's host-owned ledger, consumed/KEY-aN/screen-check/<head>.json: outside every worker grant and
// outside the evidence root a host verification run is judged on. Only the host writes it (`qa.mjs screen-check`).
export const SCREEN_OUTCOMES = ["passed", "mismatches"];
// The ledger directory resolved under the real orchestrator root; a symlink anywhere below it is refused.
function screenCheckDir(pinsFile, create = false) {
  const attemptDir = path.basename(path.dirname(pinsFile));
  if (!/^[A-Z][A-Z0-9]*-\d+-a[1-9][0-9]*$/.test(attemptDir) || path.basename(path.dirname(path.dirname(pinsFile))) !== "dispatch")
    throw new Error("screen check: pins must be the registered <root>/dispatch/KEY-aN/pins.json");
  let dir = fs.realpathSync(path.dirname(path.dirname(path.dirname(pinsFile))));
  for (const part of ["consumed", attemptDir, "screen-check"]) {
    dir = path.join(dir, part);
    let stat = null; try { stat = fs.lstatSync(dir); } catch {}
    if (!stat) { if (!create) return null; fs.mkdirSync(dir, { mode: 0o700 }); stat = fs.lstatSync(dir); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`screen check: symlink or non-directory in the result path: ${dir}`);
  }
  return dir;
}
export const screenCheckFile = (pinsFile, head, create = false) => { const dir = screenCheckDir(pinsFile, create); return dir && path.join(dir, `${head}.json`); };
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
export function writeScreenCheck(head, outcome, report, pins) {
  if (!/^[a-f0-9]{40}$/.test(head ?? "")) throw new Error("screen check: head must be a full commit SHA");
  if (!SCREEN_OUTCOMES.includes(outcome)) throw new Error(`screen check: outcome must be ${SCREEN_OUTCOMES.join(" or ")}`);
  if (typeof report !== "string" || !report.trim() || /[\r\n]/.test(report)) throw new Error("screen check: report must name the check report on one line");
  if (!path.isAbsolute(pins?.file ?? "") || !/^[a-f0-9]{64}$/.test(pins?.digest ?? "")) throw new Error("screen check: launch pins binding {file, digest} required");
  const file = screenCheckFile(pins.file, head, true);
  try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`screen check: symlink in the result path: ${file}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
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
// was checked against other approved images counts as no result. Read fresh at every decision, never cached.
export function readScreenCheck(head, binding) {
  try {
    const file = screenCheckFile(binding.file, head), stat = file ? fs.lstatSync(file) : null;
    if (!stat) return null;
    const result = stat.isFile() && !stat.isSymbolicLink() ? readJson(file) : null;
    return result?.head === head && SCREEN_OUTCOMES.includes(result.outcome) && typeof binding?.file === "string" &&
      result.pins?.file === binding.file && result.pins?.digest === binding.digest && result.attempt === attemptNumber(binding.file) &&
      result.design === screenDesignDigest(binding.file) ? result : null;
  } catch { return null; }
}
export function screenCheckHold({ pins, binding, spent, head }) {
  if (pins?.screenCheck !== true || spent > 0) return null;
  const result = readScreenCheck(head, binding);
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

// MONO-494: answers of review groups that finished in a collection whose round did not finish (another group failed
// twice). One file per head in the host's evidence root, outside every worker grant, bound to the head, the base, the
// task contract and the attempt's launch pins. The next collection on the same binding reuses them, so only missing
// groups run again; any other binding starts empty, and opening it drops this attempt's files for other heads. The
// round is spent only when every group of every pass is covered; the gate then clears the file.
export const reviewGroupsDirectory = evidenceRoot => path.join(evidenceRoot, "review-groups");
const lstat = file => { try { return fs.lstatSync(file); } catch { return null; } };
// Every attempt's saved groups (MONO-482 style, like the control files of every attempt): the directory and each file
// must be regular, never a symlink; an irregular entry is recorded so a host run that swaps one in is caught.
function reviewGroupsSnapshot(evidenceRoot, pinsFile) {
  const directory = reviewGroupsDirectory(evidenceRoot), stat = lstat(directory);
  if (!stat) return [];
  if (!stat.isDirectory() || stat.isSymbolicLink()) return [[directory, { hash: "irregular", ours: true, cache: true }]];
  return fs.readdirSync(directory).map(name => {
    const file = path.join(directory, name), entry = lstat(file);
    if (!entry?.isFile()) return [file, { hash: "irregular", ours: true, cache: true }];
    const bytes = fs.readFileSync(file);
    let ours = false; try { ours = attemptOf(JSON.parse(bytes).pinsFile, pinsFile); } catch {}
    return [file, { hash: crypto.createHash("sha256").update(bytes).digest("hex"), ours, cache: true }];
  });
}
// MONO-494 review: host verification runs worker code with host rights, which could plant saved answers anywhere the
// host can write. Instead of guarding the cache against it, reuse is off whenever host verification is in play: this
// attempt's pins or any attempt of the orchestrator root (every registry entry's pins file and every dispatch pins
// file), read under the root's launch.lock. Anything unreadable counts as on. Isolating host verification is MONO-489.
export function hostVerificationInRoot(root, pins = null) {
  if (pins?.hostVerification === true) return true;
  if (!root) return false;
  try {
    return withLockSync(path.join(root, "launch.lock"), () => {
      const files = new Set(), registry = path.join(root, "workers.json"), dispatch = path.join(root, "dispatch");
      if (fs.existsSync(registry)) for (const entry of Object.values(readJson(registry) ?? {})) if (typeof entry?.pins?.file === "string") files.add(entry.pins.file);
      for (const name of fs.existsSync(dispatch) ? fs.readdirSync(dispatch) : []) files.add(path.join(dispatch, name, "pins.json"));
      return [...files].some(file => fs.existsSync(file) && readJson(file)?.hostVerification === true);
    });
  } catch { return true; }
}
export function reviewGroupStore(evidenceRoot, { head, base, contractDigest, pinsFile = null }, { root = null, pins = null } = {}) {
  if (!/^[a-f0-9]{40}$/.test(head ?? "") || !/^[a-f0-9]{40}$/.test(base ?? "") || typeof contractDigest !== "string") throw new Error("review group store needs head, base and contract digest");
  const directory = reviewGroupsDirectory(evidenceRoot), file = path.join(directory, `${head}.json`);
  const binding = { head, base, contractDigest, pinsFile };
  const stat = lstat(directory);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const name of fs.readdirSync(directory).filter(name => name !== `${head}.json`)) {
    const other = path.join(directory, name);
    try { if (!lstat(other)?.isFile() || (readJson(other).pinsFile ?? null) === pinsFile) fs.rmSync(other, { recursive: true, force: true }); } catch { fs.rmSync(other, { recursive: true, force: true }); }
  }
  const own = lstat(file);
  if (own && !own.isFile()) fs.rmSync(file, { recursive: true, force: true });
  // Checked at opening and again right before every read and write: an attempt with host verification dispatched later
  // never makes an earlier saved file trusted.
  const reuse = () => !hostVerificationInRoot(root, pins);
  let saved = {};
  try {
    const value = own?.isFile() && reuse() ? readJson(file) : null;
    if (value && canonical({ head: value.head, base: value.base, contractDigest: value.contractDigest, pinsFile: value.pinsFile ?? null }) === canonical(binding) &&
        value.entries && typeof value.entries === "object" && !Array.isArray(value.entries)) saved = value.entries;
  } catch { saved = {}; }
  const entries = { ...saved };
  return {
    get: key => Object.hasOwn(entries, key) && reuse() ? entries[key] : undefined,
    put: (key, entry) => { if (!reuse()) return; entries[key] = entry; atomicJson(file, { ...binding, entries }); },
    clear: () => fs.rmSync(file, { force: true }),
    size: () => Object.keys(entries).length,
    file,
  };
}
