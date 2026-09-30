#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { flags, readJson, atomicJson, withLock, digest, syncDir, durableDirectory, isMain, processStart } from "../runtime.mjs";
import { correlatedDeliveryReport } from "../delivery-state.mjs";

function waitingWriter(entry, issue, attempt) {
  if (entry.handshake !== "wait" || !entry.thread_id || !entry.procStart || !Number.isInteger(entry.pid) || entry.pid <= 0) return false;
  try { process.kill(entry.pid, 0); } catch (error) { if (error.code !== "EPERM") return false; }
  if (processStart(entry.pid) !== entry.procStart) return false;
  let currentThread = null;
  const outstanding = new Set();
  try {
    for (const line of fs.readFileSync(entry.log, "utf8").split("\n")) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "thread.started") { currentThread = event.thread_id; outstanding.clear(); continue; }
      if (currentThread !== entry.thread_id) continue;
      const item = event.item;
      if (event.type === "item.completed") outstanding.delete(item?.id);
      if (event.type !== "item.started" || item?.type !== "command_execution" || typeof item.id !== "string" || !item.id) continue;
      const command = item.command ?? "";
      const flag = name => [...command.matchAll(new RegExp(`--${name}\\s+["']?([A-Za-z0-9-]+)(?=[\\s"']|$)`, "g"))].map(match => match[1]);
      const issues = flag("issue"), attempts = flag("attempt");
      if (/delivery-state\.mjs["']?\s+wait-ack(?=\s|$)/.test(command) &&
          issues.length === 1 && issues[0] === issue && attempts.length === 1 && attempts[0] === String(attempt)) outstanding.add(item.id);
    }
  } catch { return false; }
  return currentThread === entry.thread_id && outstanding.size > 0;
}

export async function consumeAck({ root, issue, attempt, outcome, readback, stallSec = 120 }) {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(issue) || !Number.isInteger(attempt) || attempt < 1 || !["applied", "blocked", "rejected"].includes(outcome)) throw new Error("invalid consumption request");
  return withLock(path.join(root, "launch.lock"), async () => {
    const registryFile = path.join(root, "workers.json"), registry = readJson(registryFile), entry = registry[issue];
    if (!entry || entry.stage !== "mono-deliver" || entry.attempt !== attempt || path.basename(entry.log) !== `${issue}-mono-deliver-a${attempt}.jsonl`) throw new Error("ack attempt not registry-correlated");
    const recordFile = path.join(root, "consumed", `${issue}-gate-ack-a${attempt}.json`);
    durableDirectory(path.dirname(recordFile)); syncDir(root); syncDir(path.dirname(recordFile));
    const prior = fs.existsSync(recordFile) ? readJson(recordFile) : null;
    if (prior && prior.outcome !== outcome) throw new Error("contradictory ack consumption");
    const candidates = [path.join(root, "reports", `${issue}-gate-ack-a${attempt}.json`), path.join(entry.worktree, ".orchestrator", `${issue}-gate-ack-a${attempt}.json`)];
    const present = candidates.filter(file => fs.existsSync(file));
    if (present.length > 1 || (!prior && present.length !== 1)) throw new Error("ack absent or in both locations");
    if (present.some(file => fs.statSync(file).mtimeMs > Date.now() + 5000)) throw new Error("future-dated ack");
    const ack = present.length ? readJson(present[0]) : prior.ack;
    if (prior && prior.ackDigest !== digest(ack)) throw new Error("ack changed after consumption");
    const gates = prior?.gates ?? entry.gates;
    if (outcome !== "rejected" && (!Array.isArray(gates) || !gates.length || new Set(gates).size !== gates.length || gates.some(g => typeof g !== "string" || !g.trim()))) throw new Error("invalid registry gates");
    if (ack.issue !== issue || ack.phase !== "gate") throw new Error("ack identity mismatch");
    if (outcome !== "rejected" && (!Array.isArray(ack.gates) || !ack.gates.length ||
        ack.gates.some(g => !gates.includes(g.gate) || !["pass", "blocked"].includes(g.status) || !g.evidence?.trim()) ||
        new Set(ack.gates.map(g => g.gate)).size !== ack.gates.length)) throw new Error("invalid ack gates");
    const passed = ack.status === "gates-passed" && ack.gates?.length === gates?.length && ack.gates?.every(g => g.status === "pass");
    const blocked = ack.status === "blocked" && ack.gates?.some(g => g.status === "blocked");
    if (outcome !== "rejected" && ((!passed && !blocked) || (outcome === "applied" && !passed) || (outcome === "blocked" && !blocked))) throw new Error("ack outcome mismatch");
    if (outcome === "applied" && !prior) {
      const resumed = entry.thread_id && entry.pid && entry.last_resume?.pid === entry.pid && entry.last_resume.thread_id === entry.thread_id &&
        entry.last_resume.gateAckDigest === digest(ack) && Number.isFinite(Date.parse(entry.last_resume.registeredAt));
      if (entry.handshake === "wait" && !resumed) {
        if (!waitingWriter(entry, issue, attempt)) throw new Error("waiting writer not verified");
      } else {
      if (!entry.thread_id || !entry.pid || entry.last_resume?.pid !== entry.pid || entry.last_resume.thread_id !== entry.thread_id ||
          entry.last_resume.gateAckDigest !== digest(ack) || !Number.isFinite(Date.parse(entry.last_resume.registeredAt)))
        throw new Error("resumed writer registration for this ack required before consumption");
      }
      if (!Array.isArray(entry.lifecycle_moves) || !Array.isArray(readback) || readback.length !== entry.lifecycle_moves.length ||
          readback.some((r, i) => r.moveDigest !== digest(entry.lifecycle_moves[i]) || !r.evidence)) throw new Error("lifecycle read-back incomplete");
      if (entry.handshake === "wait" && !resumed) {
        if (entry.last_wait && (entry.last_wait.pid !== entry.pid || entry.last_wait.procStart !== entry.procStart ||
            entry.last_wait.thread_id !== entry.thread_id || entry.last_wait.gateAckDigest !== digest(ack) ||
            !Number.isFinite(Date.parse(entry.last_wait.consumedAt)) || Date.parse(entry.last_wait.consumedAt) > Date.now()))
          throw new Error("waiting writer not verified");
        entry.last_wait ??= { pid: entry.pid, procStart: entry.procStart, thread_id: entry.thread_id,
          gateAckDigest: digest(ack), consumedAt: new Date().toISOString() };
        atomicJson(registryFile, registry);
      }
    }
    if (outcome === "blocked" && !prior) {
      const reports = [path.join(root, "reports", `${issue}-mono-deliver.json`), path.join(entry.worktree, ".orchestrator", `${issue}-mono-deliver.json`)].filter(file => fs.existsSync(file));
      if (reports.length !== 1) throw new Error("blocked report absent or in both locations");
      const report = readJson(reports[0]);
      if (!Number.isFinite(stallSec) || stallSec < 90 || report.status !== "parked" || entry.issue !== issue ||
          !correlatedDeliveryReport(report, fs.statSync(reports[0]), entry, fs.statSync(entry.log), stallSec))
        throw new Error("correlated blocked report required before consumption");
    }
    const record = prior ?? { issue, attempt, outcome, gates, ack, ackDigest: digest(ack), readback };
    atomicJson(recordFile, record);
    for (const file of present) { fs.renameSync(file, file.replace(/\.json$/, `.${outcome}.json`)); syncDir(path.dirname(file)); }
    delete entry.gates; atomicJson(registryFile, registry);
    return { issue, attempt, outcome };
  });
}
if (isMain(import.meta.url)) {
  try {
    const args = flags(process.argv.slice(2));
    if (args.help) console.log("Usage: consume-gate-ack.mjs --request <json>\nRequest: {root,issue,attempt,outcome,readback:[{moveDigest,evidence}]}\nOutcome applied|blocked|rejected. Optional stallSec matches watcher freshness (default 120, minimum 90). Applied requires one read-back per lifecycle_moves entry (SHA-256 canonical sorted-key JSON digest), after resumed writer registration or verification of a live wait-mode incarnation with an outstanding delivery-state.mjs wait-ack command. Wait persists last_wait once before the private record/tombstone. Blocked requires correlated parked report; rejected never authorizes lifecycle application. Private record is durable before ack rename and registry cleanup.");
    else console.log(JSON.stringify(await consumeAck(readJson(args.request))));
  } catch (error) { console.error(`consume-gate-ack: ${error.message}`); process.exitCode = 1; }
}
