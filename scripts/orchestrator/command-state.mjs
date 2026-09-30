import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicJson, canonical, digest, readJson, identity, withLock } from "../runtime.mjs";
import { validatePhase, confirmQueue } from "../delivery-state.mjs";

export const sha256File = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export function commandFlags(argv, booleans = [], repeat = []) {
  const args = {};
  for (let n = 0; n < argv.length; n++) {
    const token = argv[n];
    if (!token.startsWith("--")) throw new Error(`invalid argument ${token}`);
    const key = token.slice(2);
    if (Object.hasOwn(args, key) && !repeat.includes(key)) throw new Error(`duplicate argument ${token}`);
    const value = booleans.includes(key) || key === "help" ? true : argv[++n];
    if (value === undefined || (typeof value === "string" && value.startsWith("--"))) throw new Error(`missing value ${token}`);
    if (repeat.includes(key)) (args[key] ??= []).push(value); else args[key] = value;
  }
  return args;
}
export function allowedFlags(args, names) {
  for (const key of Object.keys(args)) if (![...names, "help"].includes(key)) throw new Error(`unknown argument --${key}`);
}
export function registryEntry(root, issue, attempt) {
  if (!path.isAbsolute(root ?? "") || !/^[A-Z][A-Z0-9]*-\d+$/.test(issue) || !Number.isInteger(attempt) || attempt < 1)
    throw new Error("absolute root, issue and positive attempt required");
  const entry = readJson(path.join(root, "workers.json"))[issue];
  if (!entry || entry.issue !== issue || entry.attempt !== attempt || entry.stage !== "mono-deliver" || !identity(entry))
    throw new Error("request not registry-correlated");
  return entry;
}
export function attemptDirectory(root, report) { return path.join(root, "consumed", `${report.issue}-a${report.attempt}`); }

export function correlatedPhase(root, file) {
  const report = validatePhase(readJson(file));
  const entry = registryEntry(root, report.issue, report.attempt);
  const candidates = [path.join(root, "reports", `${report.issue}-phase-${report.phase}.json`),
    path.join(entry.worktree, ".orchestrator", `${report.issue}-phase-${report.phase}.json`)].filter(name => fs.existsSync(name));
  if (candidates.length !== 1 || fs.realpathSync(file) !== fs.realpathSync(candidates[0])) throw new Error("phase report absent, misplaced or in both locations");
  if (["packVersion", "sourceCommit", "surfaceRevision"].some(key => entry[key] !== report[key])) throw new Error("phase pack identity mismatch");
  const published = Date.parse(report.publishedAt);
  if (!Number.isFinite(published) || published > Date.now() || published < Date.parse(entry.spawned_at)) throw new Error("phase publication time invalid");
  return { report, entry };
}

export function expandedWrite(write, report) {
  const expand = value => {
    if (typeof value === "string" && value.includes("append #/certificate")) {
      if (!report.certificate?.trim() || value.split("append #/certificate").length !== 2) throw new Error("invalid certificate pointer");
      return value.replace("append #/certificate", () => report.certificate);
    }
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
    return value;
  };
  return expand(write);
}

// Reuse the phase owner's existing barrier validation without duplicating its
// predecessor rules. Nonempty queues stop at the adapter boundary, before any
// result or external write. Empty queues are checked by the real confirmation
// after session setup: probing confirmQueue on them would publish a confirmation.
export async function validateReportBarriers(root, report, reportsDir) {
  if (!report.capsule.open_queue.length) return;
  const stopBeforeAdapter = Symbol("validated report barriers");
  try { await confirmQueue(report, root, () => { throw stopBeforeAdapter; }, reportsDir); }
  catch (error) { if (error !== stopBeforeAdapter) throw error; }
  // The adapter boundary stops at the first write. Check the remaining durable
  // identities before any connector instructions can expose the full queue.
  const dir = attemptDirectory(root, report);
  await withLock(path.join(dir, "queue.lock"), () => {
    for (const queued of report.capsule.open_queue) {
      const write = expandedWrite(queued, report), file = path.join(dir, `${write.id}.json`);
      if (!fs.existsSync(file)) continue;
      const prior = readJson(file);
      if (prior.writeDigest !== digest(write) || prior.issue !== report.issue || prior.attempt !== report.attempt)
        throw new Error(`write ${write.id} changed within attempt`);
    }
  });
}

export function effectivePins(entry) {
  if (!entry.pins || sha256File(entry.pins.file) !== entry.pins.digest) throw new Error("launch pins digest mismatch");
  const base = readJson(entry.pins.file), version = entry.pinsVersion ?? 0;
  if (!Number.isInteger(version) || version < 0) throw new Error("invalid pinsVersion");
  const amendment = version ? readJson(path.join(path.dirname(entry.pins.file), `pins.v${version}.json`)) : {};
  if (version && amendment.pinsVersion !== version) throw new Error("amendment version mismatch");
  return { ...base, ...amendment, pinsVersion: version };
}

// This exported seam is also the collector's admission transaction (MONO-96).
// Both callers and amend serialize on launch.lock; callers must not nest it.
export async function admitCollection(root, report) {
  return withLock(path.join(root, "launch.lock"), () => admitUnderLock(root, report));
}
export function admitUnderLock(root, report) {
  validatePhase(report);
  const entry = registryEntry(root, report.issue, report.attempt);
  const pins = effectivePins(entry), admitted = [];
  for (const write of report.capsule.open_queue.filter(item => item.operation === "preflight-collect")) {
    const file = path.join(attemptDirectory(root, report), "admissions", `${write.id}.json`);
    const reportDigest = digest(report);
    if (fs.existsSync(file)) {
      const prior = readJson(file);
      if (prior.collectionId !== write.id || prior.reportDigest !== reportDigest) throw new Error("conflicting collection admission");
      admitted.push(prior); continue;
    }
    if ((report.pinsVersion ?? 0) !== pins.pinsVersion) throw new Error("new collection request uses stale pinsVersion");
    const request = write.payload.request;
    for (const key of ["product", "root", "worktree", "skillsRoot", "baseRef", "evidenceRoot", "modelRoutes", "verification", "risk", "critical", "reviewDataset", "reviewDatasetVersion", "workerWritableRoots"]) {
      const defaultValue = key === "reviewDatasetVersion" ? 0 : null;
      if (canonical(request[key] ?? defaultValue) !== canonical(pins[key] ?? defaultValue)) throw new Error(`collection pin mismatch: ${key}`);
    }
    if (request.collect !== false || request.head !== report.head || canonical(report.capsule.writable_roots) !== canonical(pins.workerWritableRoots))
      throw new Error("collection head/grants/collect mismatch");
    const record = { collectionId: write.id, reportDigest, pinsVersion: pins.pinsVersion, manifestDigest: digest(pins) };
    atomicJson(file, record); admitted.push(record);
  }
  return admitted;
}
