import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicJson, canonical, digest, readJson, identity, withLock, baseModelConfig, validateLanding, processStart } from "../runtime.mjs";
import { validatePhase, confirmQueue, confirmationPath, validateConfirmation } from "../delivery-state.mjs";

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
  if (base.release !== undefined && typeof base.release !== "boolean") throw new Error("release pin must be boolean");
  if (amendment.release !== undefined && amendment.release !== (base.release ?? false)) throw new Error("release pin is immutable");
  return { ...base, ...amendment, pinsVersion: version };
}

// Consumes sealed ship evidence, never the open-PR gate: that PR may be merged.
export function landedShip(root, entry) {
  const files = [path.join(root, "reports", `${entry.issue}-phase-ship.json`),
    path.join(entry.worktree, ".orchestrator", `${entry.issue}-phase-ship.json`)].filter(file => fs.existsSync(file));
  if (files.length !== 1) throw new Error("ship report absent or in both locations");
  const { report } = correlatedPhase(root, files[0]);
  if (report.issue !== entry.issue || report.attempt !== entry.attempt || report.phase !== "ship" || report.status !== "green")
    throw new Error("ship report is not green for this attempt");
  validateConfirmation(report, readJson(confirmationPath(report, root)));
  const certificate = report.certificate;
  if (typeof certificate !== "string" || certificate.split("mono-ship green certificate").length !== 2)
    throw new Error("one green ship certificate required");
  const field = name => {
    const values = certificate.split("\n").filter(line => line.startsWith(`${name}: `)).map(line => line.slice(name.length + 2).trim());
    if (values.length !== 1) throw new Error(`ship certificate ${name} missing or ambiguous`);
    return values[0];
  };
  if (field("Ship") !== "green" || field("Issue(s)") !== entry.issue || field("Head SHA") !== report.head)
    throw new Error("ship certificate issue/head mismatch");
  const urls = [...field("PR").matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)(?=$|[\s)])/g)];
  if (urls.length !== 1) throw new Error("ship certificate must identify one GitHub repository/PR URL");
  const pins = effectivePins(entry);
  const branch = pins.baseRef?.replace(/^refs\/remotes\//, "").replace(/^origin\//, "").replace(/^refs\/heads\//, "");
  if (!branch || branch.startsWith("-") || /[\s~^:?*\[\\]/.test(branch)) throw new Error("landing branch unavailable in pins");
  return { repo: urls[0][1], pr: Number(urls[0][2]), head: report.head, branch };
}

export function landingRecords(root) {
  const pending = path.join(root, "landing/pending-install.json"), installed = path.join(root, "landing/installed");
  const records = fs.existsSync(pending) ? readJson(pending) : [];
  if (!Array.isArray(records)) throw new Error("invalid pending installation records");
  for (const file of fs.existsSync(installed) ? fs.readdirSync(installed).filter(name => name.endsWith(".json")) : []) {
    const batch = readJson(path.join(installed, file));
    if (!Array.isArray(batch.records)) throw new Error("invalid installed batch records");
    records.push(...batch.records);
  }
  return records;
}

export function attemptState(root, entry) {
  const active = reason => ({ issue: entry?.issue, attempt: entry?.attempt, state: "active", reason });
  try {
    if (!identity(entry) || entry.stage !== "mono-deliver") return active("attempt identity unavailable");
    effectivePins(entry);
    if (!Number.isInteger(entry.pid) || entry.pid <= 0 || !entry.thread_id) return active("unfinished start or suspended attempt");
    let stopped = false;
    try { process.kill(entry.pid, 0); }
    catch (error) { if (error.code === "ESRCH") stopped = true; else return active("process state unreadable"); }
    if (!stopped) {
      const start = processStart(entry.pid);
      if (!start || !entry.procStart) return active("process start unavailable");
      if (start === entry.procStart) return active("worker process is live");
    }
    const ship = landedShip(root, entry);
    const landed = landingRecords(root).filter(record => record.issue === entry.issue && record.attempt === entry.attempt);
    if (landed.length !== 1 || ["repo", "pr", "head"].some(key => landed[0][key] !== ship[key]) ||
        !/^[a-f0-9]{40}$/.test(landed[0].mergeSha ?? "") || !Number.isFinite(Date.parse(landed[0].mergedAt)))
      return active("matching landing record absent, malformed or ambiguous");
    return { issue: entry.issue, attempt: entry.attempt, state: "landed", reason: "matching landing recorded and worker stopped" };
  } catch (error) { return active(error.message); }
}

export function collectionPinsBinding(entry, version = entry.pinsVersion ?? 0) {
  const file = version ? path.join(path.dirname(entry.pins.file), `pins.v${version}.json`) : entry.pins.file;
  return { file, digest: sha256File(file) };
}
export function collectionPinMismatch(request, pins) {
  for (const key of ["product", "root", "worktree", "skillsRoot", "baseRef", "evidenceRoot", "modelRoutes", "verification", "risk", "critical", "reviewDataset", "reviewDatasetVersion", "workerWritableRoots"]) {
    const fallback = key === "reviewDatasetVersion" ? 0 : null;
    if (canonical(request[key] ?? fallback) !== canonical(pins[key] ?? fallback)) return { field: key, expected: pins[key] ?? fallback };
  }
  return null;
}
const requestMismatch = (field, expected) => { throw new Error(`collection request mismatch: ${field}; expected ${canonical(expected)}`); };

// Gate-side admission comparison: reads the registry/dispatch/admission only.
// No launch lock, admission record or worker phase is created here.
export function checkCollectionRequest(request) {
  const root = request.pins?.file ? path.dirname(path.dirname(path.dirname(request.pins.file))) : request.root;
  const registryFile = path.join(root, "workers.json");
  if (!fs.existsSync(registryFile) && !request.pins) return null;
  const registered = readJson(registryFile);
  const named = request.pins?.file && /^([A-Z][A-Z0-9]*-\d+)-a([1-9][0-9]*)$/u.exec(path.basename(path.dirname(request.pins.file)));
  const entries = named ? [registered[named[1]]].filter(entry => entry?.attempt === Number(named[2])) :
    Object.values(registered).filter(entry => entry.worktree === request.worktree && entry.stage === "mono-deliver");
  if (entries.length !== 1) {
    requestMismatch("registry", "one registered attempt for worktree");
  }
  const entry = registryEntry(root, entries[0].issue, entries[0].attempt);
  if (!entry.pins && !request.pins) return null;
  const launch = effectivePins({ ...entry, pinsVersion: 0 });
  if (!request.pins && /^[a-f0-9]{40}$/.test(launch.base ?? "") &&
      validateLanding(baseModelConfig(request.worktree, launch.base))?.serialPaths !== undefined)
    throw new Error("landing policy requires pinned dispatch");
  const u13 = Object.hasOwn(launch, "reviewDatasetDigest");
  if (!u13 && !request.pins) return null;
  if (!/^preflight-collect:[a-f0-9]{40}:[1-9][0-9]*$/u.test(request.collectionId ?? "")) requestMismatch("collectionId", "preflight-collect:<head>:<n>");
  const admissionFile = path.join(attemptDirectory(root, entry), "admissions", `${request.collectionId}.json`);
  const admission = fs.existsSync(admissionFile) ? readJson(admissionFile) : null;
  const version = admission?.pinsVersion ?? entry.pinsVersion ?? 0;
  const pins = effectivePins({ ...entry, pinsVersion: version });
  if (admission && (admission.collectionId !== request.collectionId || admission.manifestDigest !== digest(pins))) requestMismatch("admission", "registered manifest for collectionId");
  const expected = collectionPinsBinding(entry, version);
  if (expected.file !== path.join(root, "dispatch", `${entry.issue}-a${entry.attempt}`, version ? `pins.v${version}.json` : "pins.json")) requestMismatch("pins.file", "registered dispatch pins file");
  if (!request.pins) requestMismatch("pins", expected);
  if (request.pins.file !== expected.file) requestMismatch("pins.file", expected.file);
  if (canonical(request.pins) !== canonical(expected)) requestMismatch("pins.digest", expected.digest);
  if (u13 && !Object.hasOwn(request, "reviewDatasetVersion")) requestMismatch("reviewDatasetVersion", pins.reviewDatasetVersion);
  const mismatch = collectionPinMismatch(request, pins);
  if (mismatch) requestMismatch(mismatch.field, mismatch.expected);
  if (u13 && pins.reviewDataset === null && Object.hasOwn(request, "reviewDataset")) requestMismatch("reviewDataset", "omitted");
  if (u13 && (pins.reviewDataset ? sha256File(pins.reviewDataset) : null) !== pins.reviewDatasetDigest) requestMismatch("reviewDatasetDigest", pins.reviewDatasetDigest);
  if (request.collect !== false && request.collect !== true) requestMismatch("collect", false);
  return pins;
}

// This exported seam is also the collector's admission transaction (MONO-96).
// Both callers and amend serialize on launch.lock; callers must not nest it.
export class CollectionAdmissionRefusal extends Error {}
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
      if (prior.collectionId !== write.id || prior.reportDigest !== reportDigest) throw new CollectionAdmissionRefusal("conflicting collection admission");
      admitted.push(prior); continue;
    }
    const request = write.payload.request;
    const bound = Object.hasOwn(readJson(entry.pins.file), "reviewDatasetDigest") || request.pins;
    if (bound) {
      const name = path.basename(request.pins?.file ?? "");
      const match = /^pins\.v([1-9][0-9]*)\.json$/u.exec(name);
      const version = name === "pins.json" ? 0 : match ? Number(match[1]) : null;
      if (version !== pins.pinsVersion) throw new CollectionAdmissionRefusal(`new collection request uses stale pinsVersion; expected ${collectionPinsBinding(entry).file}`);
    } else if ((report.pinsVersion ?? 0) !== pins.pinsVersion) throw new CollectionAdmissionRefusal("new collection request uses stale pinsVersion");
    const mismatch = collectionPinMismatch(request, pins);
    if (mismatch) throw new CollectionAdmissionRefusal(`collection pin mismatch: ${mismatch.field}`);
    if (bound) {
      if (canonical(request.pins) !== canonical(collectionPinsBinding(entry))) throw new CollectionAdmissionRefusal("collection pin mismatch: pins");
      if (!Object.hasOwn(request, "reviewDatasetVersion")) throw new CollectionAdmissionRefusal("collection pin mismatch: reviewDatasetVersion");
    }
    if (request.collect !== false || request.head !== report.head || canonical(report.capsule.writable_roots) !== canonical(pins.workerWritableRoots))
      throw new CollectionAdmissionRefusal("collection head/grants/collect mismatch");
    const record = { collectionId: write.id, reportDigest, pinsVersion: pins.pinsVersion, manifestDigest: digest(pins) };
    atomicJson(file, record); admitted.push(record);
  }
  return admitted;
}

// U11: registry evidence decides state; the pending file only records preparation
// and the conservative launch boundary. Replay never reads mutable caller inputs.
export function amendmentState(entry, record) {
  const completed = Object.values(entry.completed_amendments ?? {}).find(value => value.pinsVersion === record.pinsVersion) ??
    (entry.last_amendment?.pinsVersion === record.pinsVersion ? entry.last_amendment : null);
  if (completed) return { state: "registered", completion: completed, resumed: completed.resumeResult };
  const resumed = entry.last_resume;
  if (resumed && canonical(resumed) !== canonical(record.previousResume) && resumed.pid === entry.pid &&
      resumed.thread_id === record.threadId && entry.thread_id === record.threadId && Number.isInteger(resumed.pid) && resumed.pid > 0 &&
      Number.isFinite(Date.parse(resumed.registeredAt)) && Date.parse(resumed.registeredAt) >= Date.parse(record.preparedAt) &&
      Date.parse(resumed.registeredAt) <= Date.now())
    return { state: "delivered", resumed: { pid: resumed.pid, thread_id: resumed.thread_id, procStart: entry.procStart } };
  return { state: "prepared", resumed: null };
}

export function amendmentChange(args, inputs, supplied) {
  const reviewDataset = args["review-dataset"] ?? inputs.reviewDataset ?? null;
  return { risk: args.risk ?? inputs.risk, critical: args.critical ?? inputs.critical,
    reviewDataset,
    reviewDatasetVersion: !reviewDataset && (inputs.reviewDatasetVersion ?? 0) === 0 && Object.hasOwn(inputs, "reviewDatasetDigest") ? 0 : Number(args["review-dataset-version"] ?? inputs.reviewDatasetVersion ?? 0),
    workerWritableRoots: supplied.roots ?? inputs.workerWritableRoots, text: args.text,
    fullSnapshot: args["full-snapshot"] ? { digest: digest(supplied.documents) } :
      (inputs.fullSnapshot ? { digest: inputs.fullSnapshot.digest } : null) };
}

export function amendmentDocuments(directory, issue, packageKind) {
  return Object.fromEntries([`issue-${issue}.md`, "approval.md", ...(packageKind === "issue-only" ?
    ["issue-only.json"] : ["project-brief.md", "prd.md", "tech-spec.md"])].map(name => [name, fs.readFileSync(path.join(directory, name), "utf8")]));
}

export function validateAmendment(entry, record) {
  const output = path.dirname(entry.pins.file), version = record.pinsVersion;
  if (record.issue !== entry.issue || record.attempt !== entry.attempt || record.launchPinsDigest !== entry.pins.digest ||
      record.threadId !== entry.thread_id || !Number.isInteger(version) || version < 1 ||
      !Number.isFinite(Date.parse(record.preparedAt)) || Date.parse(record.preparedAt) > Date.now() ||
      record.pinsFile !== path.join(output, `pins.v${version}.json`) ||
      record.resumeFile !== path.join(output, `resume.v${version}.md`) ||
      record.resumeRequest !== path.join(output, `resume.v${version}.json`) ||
      !record.effectiveInputs || !record.change || digest(record.change) !== record.changeDigest)
    throw new Error("amendment recovery evidence mismatch");
  const label = amendmentState(entry, record).state === "registered" ? "completed" : "pending";
  for (const [file, hash] of [[record.pinsFile, record.pinsDigest], [record.resumeFile, record.resumeDigest], [record.resumeRequest, record.requestDigest]]) {
    if (sha256File(file) !== hash) throw new Error(`${label} amendment content changed`);
  }
  const pins = readJson(record.pinsFile);
  if (pins.pinsVersion !== version) throw new Error("amendment version mismatch");
  if (pins.fullSnapshot && (pins.fullSnapshot.directory !== path.join(output, `snapshot.v${version}`) ||
      digest(amendmentDocuments(pins.fullSnapshot.directory, entry.issue, record.effectiveInputs.packageKind)) !== pins.fullSnapshot.digest))
    throw new Error(`${label} amendment snapshot content changed`);
  const state = amendmentState(entry, record);
  if (state.state === "registered" && (canonical(state.completion) !== canonical(record) ||
      version > (entry.pinsVersion ?? 0) || state.resumed?.pid !== record.registeredResume?.pid ||
      state.resumed?.thread_id !== record.threadId || record.registeredResume?.thread_id !== record.threadId))
    throw new Error("completed amendment recovery evidence mismatch");
  return state;
}

export function restoreAmendmentGrants(root, entry, record) {
  if (record.launchMayHaveStartedAt || amendmentState(entry, record).state !== "prepared" ||
      canonical(entry.last_resume ?? null) !== canonical(record.previousResume) || (entry.pinsVersion ?? 0) !== record.currentVersion)
    throw new Error("delivery not proven absent; preserve amendment evidence");
  const registryFile = path.join(root, "workers.json"), registry = readJson(registryFile), prior = record.previousLaunchGrants;
  Object.assign(registry[entry.issue], { workerWritableRoots: prior.workerWritableRoots,
    writable_roots: prior.writable_roots, network_access: prior.network_access });
  registry[entry.issue].capsule.writable_roots = prior.capsuleRoots;
  if (canonical(registry[entry.issue]) !== canonical(entry)) atomicJson(registryFile, registry);
}
