#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { atomicJson, readJson, digest, canonical, withLock, isMain, validateEvidenceGrants } from "../runtime.mjs";
import { registryEntry, effectivePins, correlatedPhase, expandedWrite, attemptDirectory, admitUnderLock, commandFlags, allowedFlags, sha256File, validateReportBarriers } from "./command-state.mjs";
import { consumeAck } from "./consume-gate-ack.mjs";
import { recordObservation, sessionContext, reconcile } from "./linear-adapter.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const run = (script, args, options = {}) => {
  try { return execFileSync(process.execPath, [path.join(directory, script), ...args], { encoding: "utf8", ...options }); }
  catch (error) { throw new Error([error.stdout, error.stderr, error.message].filter(Boolean).join("\n")); }
};

function validatedAck(root, issue, attempt, outcome) {
  const entry = registryEntry(root, issue, attempt);
  if (path.basename(entry.log) !== `${issue}-mono-deliver-a${attempt}.jsonl`) throw new Error("ack log not registry-correlated");
  const file = path.join(root, "consumed", `${issue}-gate-ack-a${attempt}.json`);
  const prior = fs.existsSync(file) ? readJson(file) : null;
  const candidates = [path.join(root, "reports", `${issue}-gate-ack-a${attempt}.json`), path.join(entry.worktree, ".orchestrator", `${issue}-gate-ack-a${attempt}.json`)].filter(name => fs.existsSync(name));
  if (candidates.length > 1 || (!prior && candidates.length !== 1)) throw new Error("ack absent or in both locations");
  if (candidates.some(name => fs.statSync(name).mtimeMs > Date.now())) throw new Error("future-dated ack");
  const ack = candidates.length ? readJson(candidates[0]) : prior.ack;
  const gates = prior?.gates ?? entry.gates;
  if (ack.issue !== issue || ack.phase !== "gate" || !Array.isArray(gates) || !gates.length || new Set(gates).size !== gates.length ||
      !Array.isArray(ack.gates) || !ack.gates.length || new Set(ack.gates.map(gate => gate.gate)).size !== ack.gates.length ||
      ack.gates.some(gate => !gates.includes(gate.gate) || !["pass", "blocked"].includes(gate.status) || !gate.evidence?.trim())) throw new Error("invalid ack identity/gate coverage");
  const passed = ack.status === "gates-passed" && ack.gates.length === gates.length && ack.gates.every(gate => gate.status === "pass");
  const blocked = ack.status === "blocked" && ack.gates.some(gate => gate.status === "blocked");
  outcome ??= passed ? "applied" : "blocked";
  if (!["applied", "blocked", "rejected"].includes(outcome) || (!passed && !blocked) || (outcome === "applied" && !passed) || (outcome === "blocked" && !blocked)) throw new Error("ack outcome mismatch");
  if (!Array.isArray(entry.lifecycle_moves)) throw new Error("registry lifecycle moves missing");
  if (prior && (prior.issue !== issue || prior.attempt !== attempt || prior.outcome !== outcome || prior.ackDigest !== digest(ack) ||
      canonical(prior.ack) !== canonical(ack) || (outcome === "applied" && (!Array.isArray(prior.readback) || prior.readback.length !== entry.lifecycle_moves.length ||
      prior.readback.some((readback, i) => readback.moveDigest !== digest(entry.lifecycle_moves[i]) || !readback.evidence))))) throw new Error("contradictory ack consumption");
  return { entry, ack, prior, outcome };
}

export async function acceptAck(args, print = value => console.log(JSON.stringify(value))) {
  allowedFlags(args, ["issue", "attempt", "root", "readback", "outcome"]);
  const { root, issue } = args, attempt = Number(args.attempt);
  const action = await withLock(path.join(root, "launch.lock"), () => {
    // No plan is exposed before the ack and prior consumption are validated.
    const context = validatedAck(root, issue, attempt, args.outcome);
    if (context.prior) return { outcome: context.outcome, readback: context.prior.readback };
    if (context.outcome !== "applied") return { outcome: context.outcome, readback: [] };
    const planFile = path.join(root, "consumed", `${issue}-a${attempt}`, "ack-plan.json");
    if (!args.readback) {
      const fields = { issue, attempt, ackDigest: digest(context.ack), plannedAt: new Date().toISOString(),
        moves: context.entry.lifecycle_moves.map(move => ({ moveDigest: digest(move), ...move })) };
      const plan = { ...fields, planDigest: digest(fields) };
      atomicJson(planFile, plan); print(plan); return null;
    }
    if (!fs.existsSync(planFile)) throw new Error("readback requires a printed plan");
    const plan = readJson(planFile), { planDigest, ...fields } = plan, observation = readJson(args.readback);
    if (digest(fields) !== planDigest || observation.planDigest !== planDigest || plan.ackDigest !== digest(context.ack) || plan.issue !== issue || plan.attempt !== attempt ||
        canonical(plan.moves) !== canonical(context.entry.lifecycle_moves.map(move => ({ moveDigest: digest(move), ...move })))) throw new Error("readback planDigest/ack/moves mismatch");
    const time = Date.parse(plan.plannedAt);
    if (!Number.isFinite(time) || time > Date.now() || !Array.isArray(observation.readback) || observation.readback.length !== plan.moves.length ||
      observation.readback.some((readback, i) => readback.moveDigest !== plan.moves[i].moveDigest || !readback.evidence ||
        !Number.isFinite(Date.parse(readback.observedAt)) || Date.parse(readback.observedAt) < time || Date.parse(readback.observedAt) > Date.now())) throw new Error("readback incomplete or older than printed plan");
    return { outcome: context.outcome, readback: observation.readback };
  });
  if (!action) return { planned: true };
  const result = await consumeAck({ root, issue, attempt, ...action }); print(result); return result;
}

export async function acceptReport(args, print = value => console.log(JSON.stringify(value))) {
  allowedFlags(args, ["report", "root", "config", "session", "observe"]);
  const reportFile = path.resolve(args.report), root = args.root;
  let context;
  if (!args.session) {
    if (args.observe?.length) throw new Error("--observe requires the opened --session");
    await withLock(path.join(root, "launch.lock"), async () => {
      const { report } = correlatedPhase(root, reportFile);
      await validateReportBarriers(root, report, path.dirname(reportFile));
      admitUnderLock(root, report);
      const dir = attemptDirectory(root, report);
      await withLock(path.join(dir, "session.lock"), () => {
        const reportDigest = digest(report), sessions = path.join(dir, "sessions"), activeFile = path.join(sessions, `current-${reportDigest}.json`);
        if (fs.existsSync(activeFile)) print({ reread: report.capsule.open_queue.map(write => ({ id: write.id, target: write.target,
          instruction: write.operation === "comment" ? "Find the existing comment by marker/idempotency key before any republication." : "Read the desired effect through its source before retrying." })) });
        const session = { sessionId: crypto.randomUUID(), openedAt: new Date().toISOString(), reportDigest };
        atomicJson(path.join(sessions, session.sessionId, "session.json"), session); atomicJson(activeFile, session);
        context = sessionContext(root, reportFile, session.sessionId);
        print({ session, writes: report.capsule.open_queue.map(write => expandedWrite(write, report)) });
      });
    });
  } else context = sessionContext(root, reportFile, args.session);
  for (const value of args.observe ?? []) {
    const separator = value.indexOf("=");
    if (separator < 1) throw new Error("--observe expects writeId=JSON (or writeId=@file)");
    const id = value.slice(0, separator), encoded = value.slice(separator + 1);
    const observation = encoded.startsWith("@") ? readJson(encoded.slice(1)) : JSON.parse(encoded);
    await recordObservation(root, reportFile, context.session.sessionId, id, observation);
  }
  // Reopening a session and confirming it share session.lock. No old session can
  // create a confirmation while a new session invalidates its observations.
  return withLock(path.join(attemptDirectory(root, context.report), "session.lock"), () => {
    context = sessionContext(root, reportFile, context.session.sessionId);
    const complete = context.report.capsule.open_queue.every(queued => {
      const write = expandedWrite(queued, context.report);
      return reconcile({ action: "reconcile", issue: context.report.issue, attempt: context.report.attempt, idempotencyKey: `${context.report.issue}:${write.id}`, write },
        { root, reportFile, sessionId: context.session.sessionId }).state === "present";
    });
    if (!complete) return { session: context.session, status: "observations-pending" };
    run("../delivery-state.mjs", ["confirm", "--report", reportFile, "--root", root, "--adapter", path.join(directory, "linear-adapter.mjs"), ...(args.config ? ["--config", args.config] : [])],
      { env: { ...process.env, MONO_ACCEPT_ROOT: root, MONO_ACCEPT_REPORT: reportFile, MONO_ACCEPT_SESSION: context.session.sessionId } });
    const result = { session: context.session, status: "confirmed" }; print(result); return result;
  });
}

function deliveredAmendment(entry, pending) {
  const resumed = entry.last_resume;
  if (!resumed || canonical(resumed) === canonical(pending.previousResume) || resumed.pid !== entry.pid ||
      resumed.thread_id !== pending.threadId || entry.thread_id !== pending.threadId ||
      !Number.isInteger(resumed.pid) || resumed.pid < 1 || !Number.isFinite(Date.parse(resumed.registeredAt)) ||
      Date.parse(resumed.registeredAt) < Date.parse(pending.preparedAt) || Date.parse(resumed.registeredAt) > Date.now()) return null;
  return { pid: resumed.pid, thread_id: resumed.thread_id, procStart: entry.procStart };
}

export async function acceptAmend(args) {
  allowedFlags(args, ["root", "issue", "attempt", "risk", "critical", "review-dataset", "review-dataset-version", "worker-writable-roots", "text", "full-snapshot", "snapshot", "preapply"]);
  if (args.preapply) throw new Error("--preapply belongs to I4 and is not implemented");
  if (!args.text?.trim()) throw new Error("--text with the snapshot amendment and recovery instructions required");
  const root = args.root, issue = args.issue, attempt = Number(args.attempt);
  // Serialize complete amendments while resume takes launch.lock itself.
  return withLock(path.join(root, "amend.lock"), async () => {
    const prepared = await withLock(path.join(root, "launch.lock"), () => {
      const entry = registryEntry(root, issue, attempt), current = effectivePins(entry);
      const rank = ["tiny", "standard", "deep", "risky"], risk = args.risk ?? current.risk, critical = args.critical ?? current.critical;
      if (!rank.includes(risk) || rank.indexOf(risk) < rank.indexOf(current.risk) || (current.critical && critical !== current.critical) || (critical !== null && (risk !== "risky" || !critical.trim()))) throw new Error("risk/critical amendments may only escalate; existing critical reason is retained");
      if (current.profile === "short" && ["deep", "risky"].includes(risk) && current.packageKind !== "issue-only" && !args["full-snapshot"] && !current.fullSnapshot)
        throw new Error("short risk escalation requires --full-snapshot");
      const reviewDataset = args["review-dataset"] ?? current.reviewDataset;
      const reviewDatasetVersion = Number(args["review-dataset-version"] ?? current.reviewDatasetVersion ?? 0);
      if (!Number.isInteger(reviewDatasetVersion) || reviewDatasetVersion < (current.reviewDatasetVersion ?? 0) || (reviewDataset !== current.reviewDataset && reviewDatasetVersion <= (current.reviewDatasetVersion ?? 0))) throw new Error("dataset change requires a newer version");
      if (reviewDataset && (!path.isAbsolute(reviewDataset) || !fs.statSync(reviewDataset).isFile())) throw new Error("absolute readable review dataset required");
      const workerWritableRoots = args["worker-writable-roots"] ? readJson(args["worker-writable-roots"]) : current.workerWritableRoots;
      if (!Array.isArray(workerWritableRoots) || workerWritableRoots.some(value => !path.isAbsolute(value)) || new Set(workerWritableRoots).size !== workerWritableRoots.length ||
          current.workerWritableRoots.some(value => !workerWritableRoots.includes(value))) throw new Error("amendment must contain complete effective grants including all existing roots");
      validateEvidenceGrants(current.evidenceRoot, [root, ...workerWritableRoots]); validateEvidenceGrants(current.skillsRoot, workerWritableRoots, "installed skillsRoot");
      validateEvidenceGrants(path.join(current.skillsRoot, "autoreview/scripts/autoreview"), workerWritableRoots, "autoreview helper real path");
      const controlRoot = fs.realpathSync(root), mailbox = path.join(controlRoot, "reports");
      for (const grant of workerWritableRoots.map(value => fs.realpathSync(value))) {
        const overlaps = grant === controlRoot || controlRoot.startsWith(grant + path.sep) || grant.startsWith(controlRoot + path.sep);
        if (overlaps && grant !== mailbox && !grant.startsWith(mailbox + path.sep)) throw new Error("only reports may be worker-writable within orchestrator root");
      }
      if (args["full-snapshot"] && !path.isAbsolute(args.snapshot ?? "")) throw new Error("--full-snapshot requires --snapshot DIR containing complete documents");
      // Capture the entire amendment before deciding whether a version is reusable.
      // Same directory/arguments with changed document bytes are a new amendment.
      const snapshotRoot = args["full-snapshot"] ? args.snapshot : current.fullSnapshot?.directory;
      const documents = snapshotRoot ? Object.fromEntries(
        [`issue-${issue}.md`, "approval.md", ...(current.packageKind === "issue-only" ? ["issue-only.json"] : ["project-brief.md", "prd.md", "tech-spec.md"])].map(name =>
          [name, fs.readFileSync(path.join(snapshotRoot, name), "utf8")])) : null;
      if (documents && !args["full-snapshot"] && digest(documents) !== current.fullSnapshot.digest) throw new Error("registered full snapshot content changed");
      const output = path.dirname(entry.pins.file), change = { risk, critical, reviewDataset: reviewDataset ?? null, reviewDatasetVersion, workerWritableRoots, text: args.text,
        fullSnapshot: documents ? { digest: digest(documents) } : null };
      const pendingFile = path.join(output, "amendment.pending.json"), changeDigest = digest(change);
      let previousLaunchGrants = { workerWritableRoots: entry.workerWritableRoots, writable_roots: entry.writable_roots,
        capsuleRoots: entry.capsule.writable_roots, network_access: entry.network_access };
      if (fs.existsSync(pendingFile)) {
        const pending = readJson(pendingFile);
        if (pending.issue !== issue || pending.attempt !== attempt || pending.launchPinsDigest !== entry.pins.digest ||
            pending.threadId !== entry.thread_id || !Number.isInteger(pending.pinsVersion) ||
            !Number.isFinite(Date.parse(pending.preparedAt)) || Date.parse(pending.preparedAt) > Date.now() ||
            pending.pinsFile !== path.join(output, `pins.v${pending.pinsVersion}.json`) ||
            pending.resumeFile !== path.join(output, `resume.v${pending.pinsVersion}.md`) ||
            pending.resumeRequest !== path.join(output, `resume.v${pending.pinsVersion}.json`)) throw new Error("pending amendment identity mismatch");
        const resumed = deliveredAmendment(entry, pending);
        if (resumed || pending.changeDigest === changeDigest) {
          if (pending.changeDigest !== changeDigest) throw new Error("delivered pending amendment requires an identical retry before a new amendment");
          const alreadyRegistered = current.pinsVersion === pending.pinsVersion && entry.last_amendment?.changeDigest === changeDigest;
          if (current.pinsVersion !== pending.currentVersion && !alreadyRegistered) throw new Error("pending amendment pinsVersion conflict");
          for (const [file, hash] of [[pending.pinsFile, pending.pinsDigest], [pending.resumeFile, pending.resumeDigest], [pending.resumeRequest, pending.requestDigest]]) {
            if (sha256File(file) !== hash) throw new Error("pending amendment content changed");
          }
          if (alreadyRegistered && !resumed) throw new Error("pending amendment has no correlated registered resume");
          return { ...pending, pendingFile, currentVersion: current.pinsVersion, resumed };
        }
        if (canonical(entry.last_resume ?? null) !== canonical(pending.previousResume)) throw new Error("pending amendment resume changed; reconcile before replacement");
        if (pending.currentVersion !== current.pinsVersion) throw new Error("pending amendment pinsVersion conflict");
        previousLaunchGrants = pending.previousLaunchGrants;
      }
      const completed = entry.completed_amendments?.[changeDigest] ??
        (entry.last_amendment?.changeDigest === changeDigest ? entry.last_amendment : null);
      if (completed) {
        if (completed.changeDigest !== changeDigest || !Number.isInteger(completed.pinsVersion) ||
            completed.pinsVersion < 1 || completed.pinsVersion > current.pinsVersion || !completed.resumeResult ||
            (completed.pinsVersion === current.pinsVersion && canonical(completed.registeredResume) !== canonical(entry.last_resume)) ||
            completed.resumeResult.pid !== completed.registeredResume?.pid ||
            completed.registeredResume?.thread_id !== entry.thread_id || completed.resumeResult.thread_id !== entry.thread_id ||
            completed.resumeFile !== path.join(output, `resume.v${completed.pinsVersion}.md`) ||
            completed.resumeRequest !== path.join(output, `resume.v${completed.pinsVersion}.json`)) throw new Error("completed amendment recovery evidence mismatch");
        for (const [file, hash] of [[path.join(output, `pins.v${completed.pinsVersion}.json`), completed.pinsDigest],
          [completed.resumeFile, completed.resumeDigest], [completed.resumeRequest, completed.requestDigest]]) {
          if (sha256File(file) !== hash) throw new Error("completed amendment content changed");
        }
        return { pinsVersion: completed.pinsVersion, pinsFile: path.join(output, `pins.v${completed.pinsVersion}.json`),
          resumeFile: completed.resumeFile, resumeRequest: completed.resumeRequest, resumed: completed.resumeResult, completed: true };
      }
      let version = current.pinsVersion + 1;
      const file = path.join(output, `pins.v${version}.json`), resumeFile = path.join(output, `resume.v${version}.md`), resumeRequest = path.join(output, `resume.v${version}.json`);
      let text = args.text;
      let fullSnapshot = current.fullSnapshot ?? null;
      if (documents) {
        const target = path.join(output, `snapshot.v${version}`); fs.mkdirSync(target, { recursive: true });
        for (const [name, body] of Object.entries(documents)) {
          fs.writeFileSync(path.join(target, name), body);
          text += `\n\n## ${name}\n${body}`;
        }
        fullSnapshot = { directory: target, digest: digest(documents) };
      }
      atomicJson(file, { pinsVersion: version, risk, critical, reviewDataset: reviewDataset ?? null, reviewDatasetVersion, workerWritableRoots, fullSnapshot });
      text += `\n\n## Effective attempt pins\npinsVersion: ${version}\npins file: ${file}\nSHA-256: ${sha256File(file)}\n${JSON.stringify({ ...current, ...readJson(file) }, null, 2)}\nPreserve the full queue and wait for its confirmation before advancing. Risk determines required local review even when the immutable launch profile was short.`;
      fs.writeFileSync(resumeFile, text + "\n");
      const previousRoots = new Set(previousLaunchGrants.workerWritableRoots.map(value => fs.realpathSync(value)));
      const extraWritable = workerWritableRoots.filter(value => !previousRoots.has(fs.realpathSync(value)));
      atomicJson(resumeRequest, { root, issue, resumeFile, extraWritable, workerWritableRoots });
      const pending = { issue, attempt, launchPinsDigest: entry.pins.digest, threadId: entry.thread_id,
        preparedAt: new Date().toISOString(), previousResume: entry.last_resume ?? null, pinsVersion: version,
        previousLaunchGrants,
        pinsFile: file, resumeFile, resumeRequest, currentVersion: current.pinsVersion, changeDigest,
        pinsDigest: sha256File(file), resumeDigest: sha256File(resumeFile), requestDigest: sha256File(resumeRequest) };
      atomicJson(pendingFile, pending);
      return { ...pending, pendingFile, resumed: null };
    });
    if (prepared.completed) return { pinsVersion: prepared.pinsVersion, pinsFile: prepared.pinsFile,
      resumeFile: prepared.resumeFile, resumeRequest: prepared.resumeRequest, ...prepared.resumed };
    let resumed = prepared.resumed;
    if (!resumed) {
      try { resumed = JSON.parse(run("resume.mjs", ["--request", prepared.resumeRequest])); }
      catch (error) {
        try {
          await withLock(path.join(root, "launch.lock"), () => {
            const entry = registryEntry(root, issue, attempt);
            // A registered delivery must recover forward. Before any delivery,
            // resume's provisional grant update can safely be rolled back.
            if (deliveredAmendment(entry, prepared)) return;
            if (canonical(entry.last_resume ?? null) !== canonical(prepared.previousResume) ||
                effectivePins(entry).pinsVersion !== prepared.currentVersion) throw new Error("resume state changed; reconcile grants before retrying");
            const prior = prepared.previousLaunchGrants, present = { workerWritableRoots: entry.workerWritableRoots,
              writable_roots: entry.writable_roots, capsuleRoots: entry.capsule.writable_roots, network_access: entry.network_access };
            if (canonical(present) === canonical(prior)) return;
            const registryFile = path.join(root, "workers.json"), registry = readJson(registryFile);
            Object.assign(registry[issue], { workerWritableRoots: prior.workerWritableRoots,
              writable_roots: prior.writable_roots, network_access: prior.network_access });
            registry[issue].capsule.writable_roots = prior.capsuleRoots;
            atomicJson(registryFile, registry);
          });
        } catch (rollback) { throw new Error(`${error.message}\nGrant reconciliation failed: ${rollback.message}`); }
        throw error;
      }
    }
    await withLock(path.join(root, "launch.lock"), () => {
      const entry = registryEntry(root, issue, attempt);
      if (effectivePins(entry).pinsVersion !== prepared.currentVersion) throw new Error("effective pins changed during resume");
      if (canonical(deliveredAmendment(entry, prepared)) !== canonical(resumed)) throw new Error("registered resume differs from amendment delivery");
      const registryFile = path.join(root, "workers.json"), registry = readJson(registryFile);
      registry[issue].pinsVersion = prepared.pinsVersion;
      const completion = { changeDigest: prepared.changeDigest, pinsVersion: prepared.pinsVersion,
        resumeFile: prepared.resumeFile, resumeRequest: prepared.resumeRequest, pinsDigest: prepared.pinsDigest,
        resumeDigest: prepared.resumeDigest, requestDigest: prepared.requestDigest,
        registeredResume: entry.last_resume, resumeResult: resumed };
      registry[issue].completed_amendments = { ...entry.completed_amendments,
        ...(entry.last_amendment ? { [entry.last_amendment.changeDigest]: entry.last_amendment } : {}),
        [prepared.changeDigest]: completion };
      registry[issue].last_amendment = completion;
      atomicJson(registryFile, registry);
      fs.unlinkSync(prepared.pendingFile);
    });
    return { pinsVersion: prepared.pinsVersion, pinsFile: prepared.pinsFile,
      resumeFile: prepared.resumeFile, resumeRequest: prepared.resumeRequest, ...resumed };
  });
}

if (isMain(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2), args = commandFlags(argv, ["full-snapshot", "preapply"], ["observe"]);
    if (command === "--help" || args.help) console.log("Usage: accept.mjs ack --root DIR --issue KEY --attempt N [--outcome applied|blocked|rejected] [--readback FILE]\naccept.mjs report --root DIR --report FILE [--config FILE] [--session UUID --observe 'writeId=JSON']\nObservation: {sessionId,writeId,reportDigest,writeDigest,observedAt,state:'present|missing',evidence,absent?:true}; repeat --observe for multiple writes; @file is supported. Without --session open a new session, invalidate prior observations and print expanded writes (reread first on retry).\naccept.mjs amend --root DIR --issue KEY --attempt N --text TEXT [--risk CLASS] [--critical TEXT] [--review-dataset FILE --review-dataset-version N] [--worker-writable-roots JSON] [--full-snapshot --snapshot DIR]\nAdmission files: consumed/KEY-aN/admissions/collectionId.json; launch.lock serializes admissions and amendments. --preapply refuses (I4). No script writes to Linear.");
    else if (command === "ack") await acceptAck(args);
    else if (command === "report") await acceptReport(args);
    else if (command === "amend") console.log(JSON.stringify(await acceptAmend(args)));
    else throw new Error("expected ack, report or amend");
  } catch (error) { console.error(`accept: ${error.message}`); process.exitCode = 1; }
}
