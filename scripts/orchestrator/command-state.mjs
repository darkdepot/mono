import fs from "node:fs";
import { validateShipCertificate } from "../ship-certificate.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicJson, canonical, digest, readJson, identity, IDENTITY_FIELDS, withLock, shipBotChecks, baseModelConfig, validateLanding, processStart } from "../runtime.mjs";
import { readJournal, currentEntries } from '../decisions.mjs';
import { buildReviewLedger, repeatedClasses, recordClassStop } from '../review-ledger.mjs';
import { capDecisionDigest, reserveReviewCollection, validateCapAdmission } from '../review-cap.mjs';
import { validatePhase, requirePredecessors, classifyQueue, confirmationPath, validateConfirmation, resolveWrite } from "../delivery-state.mjs";
import { checkIdea, IDEA_GATE_DEFAULT_SINCE } from '../idea-gate.mjs';

export function dispatchIdea(directory, config, issue, lane = null) {
  let project = null;
  const refuse = code => { throw new Error(`idea-gate: fail: ${code} project=${project?.id ?? null}`); };
  try {
    const since = config.ideaGate?.since ?? IDEA_GATE_DEFAULT_SINCE;
    if (lane) {
      const result = checkIdea({ mode: 'approved', since, issueOnlySeam: lane.seam });
      if (!result.ok) refuse(result.code);
      return result;
    }
    project = readJson(path.join(directory, 'idea/project.json'));
    const records = readJson(path.join(directory, 'idea/idea-records.json'));
    const approval = { ...readJson(path.join(directory, 'approval.json')), body: fs.readFileSync(path.join(directory, 'approval.md'), 'utf8') };
    const issueContext = readJson(path.join(directory, 'issue-context.json'));
    if (typeof issueContext.issueId !== 'string' || !issueContext.issueId || issueContext.issueKey !== issue) refuse('read-failed');
    if (approval.bodySha256 !== sha256File(path.join(directory, 'approval.md'))) refuse('read-failed');
    const result = checkIdea({ mode: 'approved', project, records, approval, issueContext, since, headings: config.ideaGate?.headings });
    if (!result.ok) refuse(result.code);
    const statuses = [...approval.body.matchAll(/\bapproval_status\s*=\s*([\w-]+)/gu)].map(match => match[1]);
    if (statuses.length ? statuses.length !== 1 || statuses[0] !== 'approved' :
      !(Number.isFinite(Date.parse(approval.createdAt)) && Date.parse(approval.createdAt) < Date.parse(since))) refuse('read-failed');
    if (!statuses.length || result.code === 'legacy-before-cutoff') console.error(`idea-gate: pass: legacy-before-cutoff project=${project.id}`);
    return result;
  } catch (error) {
    if (error.message.startsWith('idea-gate: fail:')) throw error;
    refuse('read-failed');
  }
}

// Canonical contents, including all saved idea files, are distinct from the
// semantic checkIdea digest: approved intentionally tolerates later body edits.
export function ideaArtifactDigest(directory) {
  const files = {};
  const read = name => {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('idea artifact must not contain symbolic links');
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(file).sort()) read(`${name}/${child}`);
    } else {
      if (!stat.isFile()) throw new Error('idea artifact must contain regular files');
      files[name] = name.endsWith('.json') ? readJson(file) : fs.readFileSync(file, 'utf8');
    }
  };
  for (const name of ['idea', 'approval.md', ...(fs.existsSync(path.join(directory, 'issue-only.json')) ?
    ['issue-only.json'] : ['approval.json', 'issue-context.json'])]) read(name);
  return digest(files);
}

export function ideaBinding(directory, result) {
  return { path: directory, projectId: result.projectId, recordId: result.recordId, fingerprint: result.fingerprint,
    digest: result.digest, artifactDigest: ideaArtifactDigest(directory), verdict: result.code };
}

export function verifyIdeaArtifact(idea, issue) {
  if (!path.isAbsolute(idea?.path ?? '')) throw new Error('absolute saved idea path required');
  const config = readJson(path.join(idea.path, 'idea/gate-config.json'));
  const lane = fs.existsSync(path.join(idea.path, 'issue-only.json')) ? readJson(path.join(idea.path, 'issue-only.json')) : null;
  const result = dispatchIdea(idea.path, config, issue, lane);
  const selected = result.recordId ? readJson(path.join(idea.path, 'idea/idea-records.json')).comments.find(comment => comment.id === result.recordId) : null;
  if (canonical(selected) !== canonical(readJson(path.join(idea.path, 'idea/selected-record.json')))) throw new Error('saved idea selected record differs');
  if (canonical(ideaBinding(idea.path, result)) !== canonical(idea)) throw new Error('saved idea artifact differs from pins');
  return idea;
}

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
  if (IDENTITY_FIELDS.some(key => entry[key] !== report[key])) throw new Error("phase pack identity mismatch");
  const published = Date.parse(report.publishedAt);
  if (!Number.isFinite(published) || published > Date.now() || published < Date.parse(entry.spawned_at)) throw new Error("phase publication time invalid");
  return { report, entry };
}

export function expandedWrite(write, report) {
  return resolveWrite(write, report);
}

// Validate the full queue without adapter calls or confirmation side effects.
export async function validateReportBarriers(root, report, reportsDir) {
  requirePredecessors(report, root, reportsDir, "confirming");
  const dir = attemptDirectory(root, report);
  await withLock(path.join(dir, "queue.lock"), () => classifyQueue(report, root));
}

export function effectivePins(entry) {
  if (!entry.pins || sha256File(entry.pins.file) !== entry.pins.digest) throw new Error("launch pins digest mismatch");
  const base = readJson(entry.pins.file), version = entry.pinsVersion ?? 0;
  if (!Number.isInteger(version) || version < 0) throw new Error("invalid pinsVersion");
  const amendment = version ? readJson(path.join(path.dirname(entry.pins.file), `pins.v${version}.json`)) : {};
  if (version && amendment.pinsVersion !== version) throw new Error("amendment version mismatch");
  if (base.release !== undefined && typeof base.release !== "boolean") throw new Error("release pin must be boolean");
  if (amendment.release !== undefined && amendment.release !== (base.release ?? false)) throw new Error("release pin is immutable");
  if (Object.hasOwn(amendment, 'idea') && canonical(amendment.idea) !== canonical(base.idea)) throw new Error('idea pin is immutable; new idea requires a new attempt');
  // The first release containing the machine idea gate is 0.32.0. Compare the
  // launch identity, never the current pack/config, to finish older attempts.
  const versionParts = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(base.packVersion ?? entry.packVersion ?? '');
  if (!base.idea && versionParts && (Number(versionParts[1]) > 0 || Number(versionParts[2]) >= 32)) throw new Error('idea pin required for this pack version');
  return { ...base, ...amendment, pinsVersion: version };
}

// Consumes sealed ship evidence, never the open-PR gate: that PR may be merged.
export function landedShip(root, entry, repo) {
  const files = [path.join(root, "reports", `${entry.issue}-phase-ship.json`),
    path.join(entry.worktree, ".orchestrator", `${entry.issue}-phase-ship.json`)].filter(file => fs.existsSync(file));
  if (files.length !== 1) throw new Error("ship report absent or in both locations");
  const { report } = correlatedPhase(root, files[0]);
  if (report.issue !== entry.issue || report.attempt !== entry.attempt || report.phase !== "ship" || report.status !== "green")
    throw new Error("ship report is not green for this attempt");
  validateConfirmation(report, readJson(confirmationPath(report, root)));
  const { repo: certificateRepo, pr } = validateShipCertificate(report, repo);
  repo = certificateRepo;
  if (!repo) throw new Error("numeric ship certificate requires the record repository");
  const pins = effectivePins(entry);
  const branch = pins.baseRef?.replace(/^refs\/remotes\//, "").replace(/^origin\//, "").replace(/^refs\/heads\//, "");
  if (!branch || branch.startsWith("-") || /[\s~^:?*\[\\]/.test(branch)) throw new Error("landing branch unavailable in pins");
  return { repo, pr, head: report.head, branch };
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
    const landed = landingRecords(root).filter(record => record.issue === entry.issue && record.attempt === entry.attempt);
    if (landed.length !== 1) return active("matching landing record absent, malformed or ambiguous");
    const ship = landedShip(root, entry, landed[0].repo);
    if (["repo", "pr", "head"].some(key => landed[0][key] !== ship[key]) ||
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
  for (const key of ["product", "root", "worktree", "packRoot", "skillsRoot", "baseRef", "evidenceRoot", "modelRoutes", "verification", "risk", "critical", "reviewDataset", "reviewDatasetVersion", "workerWritableRoots", "idea"]) {
    const fallback = key === "reviewDatasetVersion" ? 0 : null;
    if (canonical(request[key] ?? fallback) !== canonical(pins[key] ?? fallback)) return { field: key, expected: pins[key] ?? fallback };
  }
  return null;
}
const requestMismatch = (field, expected) => { throw new Error(`collection request mismatch: ${field}; expected ${canonical(expected)}`); };

// Gate-side admission comparison: reads registry/dispatch/admission/history.
// No launch lock, admission record or worker phase is created here.
export function checkCollectionRequest(request) {
  const root = request.pins?.file ? path.dirname(path.dirname(path.dirname(request.pins.file))) : request.root;
  const registryFile = path.join(root, "workers.json");
  if (!fs.existsSync(registryFile) && !request.pins) {
    if(request.collect===true)requestMismatch('admission','registered orchestrator admission before collection');
    return null;
  }
  const registered = readJson(registryFile);
  const named = request.pins?.file && /^([A-Z][A-Z0-9]*-\d+)-a([1-9][0-9]*)$/u.exec(path.basename(path.dirname(request.pins.file)));
  const entries = named ? [registered[named[1]]].filter(entry => entry?.attempt === Number(named[2])) :
    Object.values(registered).filter(entry => entry.worktree === request.worktree && entry.stage === "mono-deliver");
  if (entries.length !== 1) {
    requestMismatch("registry", "one registered attempt for worktree");
  }
  const entry = registryEntry(root, entries[0].issue, entries[0].attempt);
  if (!entry.pins && !request.pins) {
    if(request.collect===true)requestMismatch('admission','registered pins and orchestrator admission before collection');
    return null;
  }
  const launch = effectivePins({ ...entry, pinsVersion: 0 });
  if (!request.pins && /^[a-f0-9]{40}$/.test(launch.base ?? "") &&
      validateLanding(baseModelConfig(request.worktree, launch.base))?.serialPaths !== undefined)
    throw new Error("landing policy requires pinned dispatch");
  const u13 = Object.hasOwn(launch, "reviewDatasetDigest");
  const legacy=!u13&&!request.pins;
  if (legacy) {
    if(request.collect===true)requestMismatch('admission','pinned dispatch request before collection');
    return null;
  }
  if (!/^[a-f0-9]{40}$/.test(request.head??'') || !new RegExp(`^preflight-collect:${request.head}:[1-9][0-9]*$`,'u').test(request.collectionId ?? "")) requestMismatch("collectionId", "preflight-collect:<head>:<n>");
  const admissionFile = path.join(attemptDirectory(root, entry), "admissions", `${request.collectionId}.json`);
  const admission = fs.existsSync(admissionFile) ? readJson(admissionFile) : null;
  const version = admission?.pinsVersion ?? entry.pinsVersion ?? 0;
  const pins = effectivePins({ ...entry, pinsVersion: version });
  if (admission && (admission.collectionId !== request.collectionId || admission.manifestDigest !== digest(pins))) requestMismatch("admission", "registered manifest for collectionId");
  if(!legacy) {
    const expected = collectionPinsBinding(entry, version);
    if (expected.file !== path.join(root, "dispatch", `${entry.issue}-a${entry.attempt}`, version ? `pins.v${version}.json` : "pins.json")) requestMismatch("pins.file", "registered dispatch pins file");
    if (!request.pins) requestMismatch("pins", expected);
    if (request.pins.file !== expected.file) requestMismatch("pins.file", expected.file);
    if (canonical(request.pins) !== canonical(expected)) requestMismatch("pins.digest", expected.digest);
  }
  if (u13 && !Object.hasOwn(request, "reviewDatasetVersion")) requestMismatch("reviewDatasetVersion", pins.reviewDatasetVersion);
  const mismatch = collectionPinMismatch(request, pins);
  if (mismatch) requestMismatch(mismatch.field, mismatch.expected);
  if (u13 && pins.reviewDataset === null && Object.hasOwn(request, "reviewDataset")) requestMismatch("reviewDataset", "omitted");
  if (u13 && (pins.reviewDataset ? sha256File(pins.reviewDataset) : null) !== pins.reviewDatasetDigest) requestMismatch("reviewDatasetDigest", pins.reviewDatasetDigest);
  if (request.collect !== false && request.collect !== true) requestMismatch("collect", false);
  if(request.collect===true) {
    if(!admission)requestMismatch('admission','orchestrator admission before collection');
    if(collectionExecuted(pins,request.collectionId))
      throw new Error('collection already executed; reconcile the same request with collect:false');
    if(collectionClassStop(entry,pins).required)throw new Error('needs-decision: repeated review class');
    validateCapAdmission({evidenceRoot:pins.evidenceRoot,issue:entry.issue,cap:admission.cap});
  }
  return legacy?null:pins;
}
// Read current attempt decisions even when preflight recovers an older admission.
export function pinnedShipPolicy(request) {
  if (!checkCollectionRequest(request)) return null;
  const root = request.pins?.file ? path.dirname(path.dirname(path.dirname(request.pins.file))) : request.root;
  const entries = Object.values(readJson(path.join(root, "workers.json"))).filter(entry => entry.worktree === request.worktree && entry.stage === "mono-deliver");
  if (entries.length !== 1) throw new Error("ship policy requires one registered attempt");
  const entry = registryEntry(root, entries[0].issue, entries[0].attempt), pins = effectivePins(entry);
  const config = pins.shipBotChecks === undefined ? (pins.base ? baseModelConfig(request.worktree, pins.base) : {}) :
    { orchestration: { ship: { botChecks: pins.shipBotChecks } } };
  const botChecks = shipBotChecks(config);
  const decision = pins.botUnavailable;
  if (decision != null && (decision.issue !== entry.issue || decision.attempt !== entry.attempt ||
      typeof decision.reason !== "string" || !decision.reason.trim())) throw new Error("bot unavailability decision belongs to another attempt or is invalid");
  return { botChecks, botUnavailable: decision?.reason ?? null };
}
function collectionExecuted(pins,collectionId) {
  const history=path.join(pins.evidenceRoot,'history');
  return (fs.existsSync(history)?fs.readdirSync(history).filter(n=>n.endsWith('.json')):[])
    .some(name=>readJson(path.join(history,name)).receipt?.collectionId===collectionId);
}

export function collectionDecisionDigest(entry) {
  const pins=effectivePins(entry),journal=readJournal({evidenceRoot:pins.evidenceRoot,issue:entry.issue});
  const file=path.join(pins.evidenceRoot,'reviews',`${entry.issue}-adjudications.json`);
  return digest({entries:currentEntries(journal).filter(e=>['class','class-decision','decision'].includes(e.type)),
    cap:capDecisionDigest(pins.evidenceRoot,entry.issue),records:fs.existsSync(file)?readJson(file):[]});
}
function collectionClassStop(entry,pins) {
  const journal=readJournal({evidenceRoot:pins.evidenceRoot,issue:entry.issue});
  const file=path.join(pins.evidenceRoot,'reviews',`${entry.issue}-adjudications.json`);
  const records=fs.existsSync(file)?readJson(file):[],history=path.join(pins.evidenceRoot,'history'),sources=[];
  const worktree=fs.realpathSync(pins.worktree);
  let receiptKey;
  for(const name of fs.existsSync(history)?fs.readdirSync(history).filter(n=>n.endsWith('.json')):[]) {
    const envelope=readJson(path.join(history,name)),receipt=envelope.receipt;
    const pinned=/^([A-Z][A-Z0-9]*-\d+)-a([1-9][0-9]*)$/.exec(path.basename(path.dirname(receipt?.pins?.file??'')));
    if(!receipt||(receipt.issue!==entry.issue&&pinned?.[1]!==entry.issue&&receipt.worktree!==worktree))continue;
    receiptKey??=fs.readFileSync(path.join(pins.evidenceRoot,'receipt.key'));
    if(receiptKey.length!==32||envelope.signature!==crypto.createHmac('sha256',receiptKey).update(canonical(receipt)).digest('hex'))
      throw new Error('class admission history signature mismatch');
    sources.push({type:'history',ref:name,attempt:receipt.attempt??(pinned?Number(pinned[2]):entry.attempt),data:envelope});
  }
  return repeatedClasses({ledger:buildReviewLedger({issue:entry.issue,sources}),records,journal});
}

// Retries reuse the admission; never reserve another review allowance.
export async function recheckCollection(root, report, admission) {
  return withLock(path.join(root, "launch.lock"), () => {
    const entry = registryEntry(root, report.issue, report.attempt);
    const pins = effectivePins({ ...entry, pinsVersion: admission.pinsVersion });
    if (collectionExecuted(pins, admission.collectionId)) return;
    if (collectionClassStop(entry, pins).required)
      throw new CollectionAdmissionRefusal('needs-decision: repeated review class');
    try { validateCapAdmission({ evidenceRoot: pins.evidenceRoot, issue: report.issue, cap: admission.cap }); }
    catch (error) {
      if (error.message === 'needs-decision: review cap') throw new CollectionAdmissionRefusal(error.message);
      throw error;
    }
  });
}

// This exported seam is also the collector's admission transaction (MONO-96).
// Both callers and amend serialize on launch.lock; callers must not nest it.
export class CollectionAdmissionRefusal extends Error {}
export async function admitCollection(root, report) {
  return withLock(path.join(root, "launch.lock"), () => admitUnderLock(root, report));
}
export async function admitUnderLock(root, report) {
  validatePhase(report);
  const entry = registryEntry(root, report.issue, report.attempt);
  const pins = effectivePins(entry), admitted = [];
  for (const write of report.capsule.open_queue.filter(item => item.operation === "preflight-collect")) {
    const file = path.join(attemptDirectory(root, report), "admissions", `${write.id}.json`);
    const reportDigest = digest(report);
    if (fs.existsSync(file)) {
      const prior = readJson(file);
      if (prior.collectionId !== write.id || prior.reportDigest !== reportDigest) throw new CollectionAdmissionRefusal("conflicting collection admission");
      if(!collectionExecuted(pins,write.id)&&collectionClassStop(entry,pins).required)
        throw new CollectionAdmissionRefusal('needs-decision: repeated review class');
      try {validateCapAdmission({evidenceRoot:pins.evidenceRoot,issue:report.issue,cap:prior.cap});}
      catch(error) {
        if(error.message!=='needs-decision: review cap')throw error;
        const cap=await reserveReviewCollection({evidenceRoot:pins.evidenceRoot,report,collectionId:write.id,reportDigest});
        if(cap.refused)throw new CollectionAdmissionRefusal('needs-decision: review cap');
        prior.cap=cap;atomicJson(file,prior);
      }
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
    const stop=collectionClassStop(entry,pins);
    if(stop.required) {
      await recordClassStop({evidenceRoot:pins.evidenceRoot,issue:report.issue,attempt:report.attempt,collectionId:write.id,stop});
      throw new CollectionAdmissionRefusal('needs-decision: repeated review class');
    }
    const cap=await reserveReviewCollection({evidenceRoot:pins.evidenceRoot,report,worktree:fs.realpathSync(pins.worktree),collectionId:write.id,reportDigest});
    if(cap?.refused)throw new CollectionAdmissionRefusal('needs-decision: review cap');
    const record = { collectionId: write.id, reportDigest, pinsVersion: pins.pinsVersion, manifestDigest: digest(pins),...(cap?{cap}: {}) };
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
    ...(args["bot-unavailable"] !== undefined || inputs.botUnavailable !== undefined ? { botUnavailable:
      args["bot-unavailable"] === undefined ? inputs.botUnavailable :
        { issue: args.issue, attempt: Number(args.attempt), reason: args["bot-unavailable"] } } : {}),
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
