#!/usr/bin/env node
// The connector remains the writer. This adapter only reconciles observations
// supplied by the orchestrator during the current report session.
import fs from "node:fs";
import path from "node:path";
import { readJson, digest, atomicJson, isMain, withLock } from "../runtime.mjs";
import { correlatedPhase, expandedWrite, attemptDirectory, commandFlags } from "./command-state.mjs";

export function sessionContext(root, reportFile, sessionId) {
  if (!/^[a-f0-9-]{36}$/u.test(sessionId ?? "")) throw new Error("current MONO_ACCEPT_SESSION required");
  const { report } = correlatedPhase(root, reportFile), reportDigest = digest(report);
  const sessions = path.join(attemptDirectory(root, report), "sessions");
  const active = readJson(path.join(sessions, `current-${reportDigest}.json`));
  const session = readJson(path.join(sessions, sessionId, "session.json"));
  if (active.sessionId !== sessionId || active.reportDigest !== reportDigest || session.sessionId !== sessionId || session.reportDigest !== reportDigest)
    throw new Error("stale reconciliation session/report");
  const opened = Date.parse(session.openedAt);
  if (!Number.isFinite(opened) || opened < Date.parse(report.publishedAt) || opened > Date.now()) throw new Error("invalid session opening time");
  return { report, reportDigest, session, directory: path.join(sessions, sessionId) };
}

function validateObservation(observation, context, write) {
  if (observation.sessionId !== context.session.sessionId || observation.writeId !== write.id ||
      observation.reportDigest !== context.reportDigest || observation.writeDigest !== digest(write)) throw new Error("observation session/report/write digest mismatch");
  const time = Date.parse(observation.observedAt);
  if (!Number.isFinite(time) || time < Date.parse(context.report.publishedAt) || time < Date.parse(context.session.openedAt) || time > Date.now())
    throw new Error("observation older than report/session or future-dated");
  if (!["present", "missing"].includes(observation.state) || !observation.evidence || (observation.state === "missing" && observation.absent !== true))
    throw new Error("observation must contain read-back evidence; missing requires explicit absent=true");
}

export async function recordObservation(root, reportFile, sessionId, id, observation) {
  const initial = sessionContext(root, reportFile, sessionId);
  return withLock(path.join(attemptDirectory(root, initial.report), "session.lock"), () => {
    const context = sessionContext(root, reportFile, sessionId);
    const queued = context.report.capsule.open_queue.find(write => write.id === id);
    if (!queued) throw new Error("observation write is not in report queue");
    const write = expandedWrite(queued, context.report);
    validateObservation(observation, context, write);
    atomicJson(path.join(context.directory, `${digest(id)}.json`), observation);
    return observation;
  });
}

export function reconcile(input, { root, reportFile, sessionId }) {
  const unknown = evidence => ({ state: "unknown", evidence });
  try {
    const context = sessionContext(root, reportFile, sessionId);
    if (input.action !== "reconcile" || input.issue !== context.report.issue || input.attempt !== context.report.attempt ||
        input.idempotencyKey !== `${input.issue}:${input.write?.id}`) return unknown("adapter request not report-correlated");
    const queued = context.report.capsule.open_queue.find(write => write.id === input.write?.id);
    if (!queued || digest(expandedWrite(queued, context.report)) !== digest(input.write)) return unknown("desired write differs from report");
    const file = path.join(context.directory, `${digest(input.write.id)}.json`);
    if (!fs.existsSync(file)) return unknown("no current-session observation; reread through the Linear connector");
    const observation = readJson(file);
    validateObservation(observation, context, input.write);
    return { state: observation.state, evidence: observation.evidence };
  } catch (error) { return unknown(error.message); }
}

if (isMain(import.meta.url)) {
  try {
    const args = commandFlags(process.argv.slice(2));
    if (args.help) console.log("Usage: linear-adapter.mjs [--root DIR]\nstdin/stdout: delivery-state.mjs adapter contract unchanged. Root: --root or MONO_ACCEPT_ROOT; MONO_ACCEPT_SESSION and MONO_ACCEPT_REPORT bind the current session. apply prints a connector instruction on stderr and returns no result. accept report --observe records fresh present/missing read-backs; missing requires absent:true.");
    else {
      if (Object.keys(args).some(key => key !== "root")) throw new Error("unknown adapter argument");
      const input = JSON.parse(fs.readFileSync(0, "utf8"));
      if (input.action === "apply") console.error(`Apply ${input.write?.id ?? "write"} through the Linear connector, then submit a fresh session observation. Printed instructions are not success.`);
      else if (input.action === "reconcile") process.stdout.write(JSON.stringify(reconcile(input, { root: args.root ?? process.env.MONO_ACCEPT_ROOT,
        reportFile: process.env.MONO_ACCEPT_REPORT, sessionId: process.env.MONO_ACCEPT_SESSION })));
      else throw new Error("unknown adapter action");
    }
  } catch (error) { console.error(`linear-adapter: ${error.message}`); process.exitCode = 1; }
}
