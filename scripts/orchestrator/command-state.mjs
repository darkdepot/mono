import fs from "node:fs";
import { validateShipCertificate } from "../ship-certificate.mjs";
import { qaDeliveryState, requireQaPassed } from '../qa-gate.mjs';
import path from "node:path";
import crypto from "node:crypto";
import { atomicJson, canonical, digest, readJson, identity, IDENTITY_FIELDS, withLock, shipBotChecks, baseModelConfig, processStart } from "../runtime.mjs";
import { validatePhase, requirePredecessors } from "../delivery-state.mjs";
import { readLedger, inFlight, admissionFor, admitRound, requestDigest, validRoundRequest } from "../review-rounds.mjs";
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

// Launch pins are immutable: a task change is a Linear comment plus resume, a risk or grant change a new attempt.
export function effectivePins(entry) {
  if (!entry.pins || sha256File(entry.pins.file) !== entry.pins.digest) throw new Error("launch pins digest mismatch");
  if ((entry.pinsVersion ?? 0) !== 0) throw new Error("amended attempt from an older pack: pins versions no longer exist; start a new attempt on the same branch");
  const base = readJson(entry.pins.file);
  if (base.release !== undefined && typeof base.release !== "boolean") throw new Error("release pin must be boolean");
  // The first release containing the machine idea gate is 0.32.0. Compare the
  // launch identity, never the current pack/config, to finish older attempts.
  const versionParts = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(base.packVersion ?? entry.packVersion ?? '');
  if (!base.idea && versionParts && (Number(versionParts[1]) > 0 || Number(versionParts[2]) >= 32)) throw new Error('idea pin required for this pack version');
  return base;
}

// Consumes sealed ship evidence, never the open-PR gate: that PR may be merged.
export function confirmedShip(root, entry) {
  const files = [path.join(root, "reports", `${entry.issue}-phase-ship.json`),
    path.join(entry.worktree, ".orchestrator", `${entry.issue}-phase-ship.json`)].filter(file => fs.existsSync(file));
  if (files.length !== 1) throw new Error("ship report absent or in both locations");
  const { report } = correlatedPhase(root, files[0]);
  if (report.issue !== entry.issue || report.attempt !== entry.attempt || report.phase !== "ship" || report.status !== "green")
    throw new Error("ship report is not green for this attempt");
  // The phase chain still holds: earlier reports of this attempt exist.
  requirePredecessors(report, root, path.dirname(files[0]), "landing");
  // Host-owned round ledger: every admitted review round has a terminal result (done, refused or failed).
  const open = inFlight(readLedger(root, entry.issue, entry.attempt));
  if (open.length) throw new Error(`review round ${open[0].admission.collectionId} has no result yet; landing waits for every admitted round`);
  validateShipCertificate(report);
  return { report };
}

function qaConfig(root, entry, provided) {
  let file = entry.config;
  if (file === undefined && entry.pins) {
    const launchFile = path.join(path.dirname(entry.pins.file), 'spawn.json');
    if (fs.existsSync(launchFile)) {
      const launch = readJson(launchFile);
      if (launch.root !== root || launch.issue !== entry.issue || launch.attempt !== entry.attempt ||
          launch.worktree !== entry.worktree || canonical(launch.pins) !== canonical(entry.pins))
        throw new Error('QA: host configuration launch identity mismatch');
      file = launch.config;
    }
  }
  if (file === undefined && provided !== undefined) return provided;
  if (!path.isAbsolute(file ?? '')) throw new Error('QA: trusted host configuration unavailable');
  const current = readJson(file);
  if (provided !== undefined && canonical(current) !== canonical(provided)) throw new Error('QA: host configuration mismatch');
  return current;
}

export function landedShip(root, entry, repo, config) {
  const { report } = confirmedShip(root, entry);
  const { repo: certificateRepo, pr } = validateShipCertificate(report, repo);
  repo = certificateRepo;
  if (!repo) throw new Error("numeric ship certificate requires the record repository");
  const pins = effectivePins(entry);
  const branch = pins.baseRef?.replace(/^refs\/remotes\//, "").replace(/^origin\//, "").replace(/^refs\/heads\//, "");
  if (!branch || branch.startsWith("-") || /[\s~^:?*\[\\]/.test(branch)) throw new Error("landing branch unavailable in pins");
  requireQaPassed({ root, config: qaConfig(root, entry, config), issue: entry.issue, head: report.head, shipCertificate: report.certificate });
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

export function attemptState(root, entry, config) {
  let qa;
  const active = reason => ({ issue: entry?.issue, attempt: entry?.attempt, state: "active", reason, ...(qa ? { qa } : {}) });
  try {
    if (!identity(entry) || entry.stage !== "mono-deliver") return active("attempt identity unavailable");
    effectivePins(entry);
    config = qaConfig(root, entry, config);
    const shipFile = path.join(root, 'reports', `${entry.issue}-phase-ship.json`);
    const fallback = path.join(entry.worktree, '.orchestrator', `${entry.issue}-phase-ship.json`);
    if (fs.existsSync(shipFile) || fs.existsSync(fallback)) {
      const { report } = confirmedShip(root, entry);
      qa = qaDeliveryState({ root, config, issue: entry.issue, head: report.head, shipCertificate: report.certificate });
      if (!['passed', 'not-connected'].includes(qa.state)) return active(qa.reason);
    }
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
    const ship = landedShip(root, entry, landed[0].repo, config);
    if (["repo", "pr", "head"].some(key => landed[0][key] !== ship[key]) ||
        !/^[a-f0-9]{40}$/.test(landed[0].mergeSha ?? "") || !Number.isFinite(Date.parse(landed[0].mergedAt)))
      return active("matching landing record absent, malformed or ambiguous");
    return { issue: entry.issue, attempt: entry.attempt, state: "landed", reason: "matching landing recorded and worker stopped", ...(qa ? { qa } : {}) };
  } catch (error) { return active(error.message); }
}

export function collectionPinsBinding(entry) {
  return { file: entry.pins.file, digest: sha256File(entry.pins.file) };
}
export function collectionPinMismatch(request, pins) {
  for (const key of ["product", "root", "worktree", "packRoot", "skillsRoot", "baseRef", "evidenceRoot", "modelRoutes", "verification", "risk", "critical", "workerWritableRoots", "idea"]) {
    if (canonical(request[key] ?? null) !== canonical(pins[key] ?? null)) return { field: key, expected: pins[key] ?? null };
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
  if (!/^[a-f0-9]{40}$/.test(request.head??'') || !new RegExp(`^preflight-collect:${request.head}:[1-9][0-9]*$`,'u').test(request.collectionId ?? "")) requestMismatch("collectionId", "preflight-collect:<head>:<n>");
  const admission = admissionFor(readLedger(root, entry.issue, entry.attempt), request.collectionId)?.admission ?? null;
  const pins = effectivePins(entry);
  if (admission && admission.requestDigest !== requestDigest(request)) requestMismatch("admission", "the admitted round request for collectionId");
  const expected = collectionPinsBinding(entry);
  if (expected.file !== path.join(root, "dispatch", `${entry.issue}-a${entry.attempt}`, "pins.json")) requestMismatch("pins.file", "registered dispatch pins file");
  if (!request.pins) requestMismatch("pins", expected);
  if (request.pins.file !== expected.file) requestMismatch("pins.file", expected.file);
  if (canonical(request.pins) !== canonical(expected)) requestMismatch("pins.digest", expected.digest);
  const mismatch = collectionPinMismatch(request, pins);
  if (mismatch) requestMismatch(mismatch.field, mismatch.expected);
  if (request.collect !== false && request.collect !== true) requestMismatch("collect", false);
  if(request.collect===true) {
    if(!admission)requestMismatch('admission','collector admission of the round request before collection');
    if(collectionExecuted(pins,request.collectionId))
      throw new Error('collection already executed; reconcile the same request with collect:false');
  }
  return pins;
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
  return { botChecks: shipBotChecks(config), botUnavailable: null };
}
function collectionExecuted(pins,collectionId) {
  const history=path.join(pins.evidenceRoot,'history');
  return (fs.existsSync(history)?fs.readdirSync(history).filter(n=>n.endsWith('.json')):[])
    .some(name=>readJson(path.join(history,name)).receipt?.collectionId===collectionId);
}

// The collector's admission transaction, serialized on launch.lock. A round request is
// admitted into the host-owned ledger only when it matches the launch pins and every
// earlier round has a terminal result; a refused request still gets its terminal result.
export class CollectionAdmissionRefusal extends Error {}
export async function admitCollection(root, round, reportsDir = path.join(root, "reports")) {
  return withLock(path.join(root, "launch.lock"), () => admitUnderLock(root, round, reportsDir));
}
export function admitUnderLock(root, round, reportsDir = path.join(root, "reports")) {
  validRoundRequest(round);
  const entry = registryEntry(root, round.issue, round.attempt), request = round.request;
  if (fs.realpathSync(request.root) !== fs.realpathSync(root)) throw new CollectionAdmissionRefusal("round request root differs from the orchestrator root");
  const ledger = readLedger(root, entry.issue, entry.attempt), prior = admissionFor(ledger, request.collectionId);
  if (prior) {
    if (prior.admission.requestDigest !== requestDigest(request)) throw new CollectionAdmissionRefusal(`collectionId ${request.collectionId} already admitted for another request`);
    return { admission: prior.admission, refusal: null };
  }
  if (inFlight(ledger).length) throw new CollectionAdmissionRefusal(`round ${inFlight(ledger)[0].admission.collectionId} has no result yet`);
  const pins = effectivePins(entry);
  let refusal = null;
  try {
    // The code report of this attempt precedes its review round.
    requirePredecessors({ ...Object.fromEntries(IDENTITY_FIELDS.map(key => [key, entry[key]])), issue: entry.issue, attempt: entry.attempt,
      phase: "preflight", capsule: { writable_roots: entry.workerWritableRoots } }, root, reportsDir, "requesting a review round for");
    if (canonical(request.pins ?? null) !== canonical(collectionPinsBinding(entry))) throw new Error("collection pin mismatch: pins");
    const mismatch = collectionPinMismatch(request, pins);
    if (mismatch) throw new Error(`collection pin mismatch: ${mismatch.field}`);
  } catch (error) { refusal = error.message; }
  // The refusal is part of the admission: a collector restart records it, never runs the request.
  const admission = admitRound(root, entry.issue, entry.attempt, request, { manifestDigest: digest(pins), refusal });
  return { admission, refusal };
}

// A task change is an «Изменение задачи» comment on the Issue plus resume of the same session
// with its link. Resume records the delivered text append-only beside the launch pins, so the
// review round reads it with the Issue; pins, risk and grants never change within an attempt.
const taskChangesFile = pinsDirectory => path.join(pinsDirectory, "task-changes.json");
const LINEAR_URL = /^https:\/\/linear\.app\/\S+$/u;
export function taskChanges(pinsDirectory) {
  const file = taskChangesFile(pinsDirectory);
  if (!fs.existsSync(file)) return [];
  const changes = readJson(file);
  if (!Array.isArray(changes) || changes.some((change, index) => change?.number !== index + 1 ||
      !LINEAR_URL.test(change.url ?? "") || typeof change.text !== "string" || !change.text.trim()))
    throw new Error("invalid task-changes.json");
  return changes;
}
// A proven refused spawn delivered nothing: drop exactly the change it recorded.
export function dropTaskChange(pinsDirectory, change) {
  const changes = taskChanges(pinsDirectory);
  if (canonical(changes.at(-1) ?? null) === canonical(change)) atomicJson(taskChangesFile(pinsDirectory), changes.slice(0, -1));
}
export function recordTaskChange(pinsDirectory, url, text) {
  if (!LINEAR_URL.test(url ?? "") || !text.includes(url))
    throw new Error("taskChange must be the Linear URL of the «Изменение задачи» comment, quoted in the resume file");
  const changes = taskChanges(pinsDirectory);
  const change = { number: changes.length + 1, url, text, recordedAt: new Date().toISOString() };
  atomicJson(taskChangesFile(pinsDirectory), [...changes, change]);
  return change;
}
