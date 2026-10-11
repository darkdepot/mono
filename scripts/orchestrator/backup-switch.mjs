import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { atomicJson, readJson, baseModelConfig, canonical, digest, processTable, resolveRole, resolvedLocation, syncDir, withLock, flags, isMain } from "../runtime.mjs";
import { effectivePins } from "./command-state.mjs";

const transports = ["codex-cli", "claude-cli"];
const reasons = ["subscription-exhausted", "provider-refusal-after-recovery"];
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const recordFile = (root, issue, attempt) => path.join(root, "attempt-records", `${issue}-a${attempt}.json`);
const switchFile = (root, issue) => path.join(root, "backup-switches", `${issue}.json`);

export const backupProcessBaseline = () => processTable().filter(row => !row.state.startsWith("Z"))
  .map(({ pid, procStart }) => ({ pid, procStart }));

function requireProcessOwnership(root, previous, live) {
  const baseline = previous.entry.processBaseline;
  if (!Array.isArray(baseline) || !baseline.length || baseline.some(row => !Number.isSafeInteger(row.pid) || row.pid <= 0 || !row.procStart))
    throw new Error("previous launch process baseline missing; reconcile process ownership before switching");
  const identity = row => `${row.pid}:${row.procStart}`;
  const allowed = new Set(baseline.map(identity));
  const observer = live.find(row => row.pid === process.pid);
  if (!observer) throw new Error("process observer identity unavailable; reconcile before switching");
  let ancestor = observer;
  const ancestors = new Set();
  while (ancestor && !ancestors.has(ancestor.pid)) {
    ancestors.add(ancestor.pid); allowed.add(identity(ancestor));
    ancestor = live.find(row => row.pid === ancestor.ppid);
  }
  const roots = [{ pid: process.pid, group: null }];
  for (const entry of Object.values(readJson(path.join(root, "workers.json")))) {
    if (entry.issue === previous.entry.issue || entry.stage !== "mono-deliver" || entry.worktree === previous.entry.worktree) continue;
    const row = live.find(row => row.pid === entry.pid && row.procStart === entry.procStart && row.group === entry.pid);
    if (row) roots.push({ pid: row.pid, group: row.group });
  }
  for (const tree of roots) {
    const selected = new Set([tree.pid]);
    let added;
    do {
      added = false;
      for (const row of live) if (!selected.has(row.pid) && (selected.has(row.ppid) || (tree.group !== null && row.group === tree.group))) {
        selected.add(row.pid); added = true;
      }
    } while (added);
    for (const row of live) if (selected.has(row.pid)) allowed.add(identity(row));
  }
  const unknown = live.filter(row => !allowed.has(identity(row)));
  if (unknown.length) throw new Error(`unattributed processes after previous launch: ${unknown.map(row => row.pid).join(", ")}; reconcile ownership before switching`);
}

export function recordBackupSwitch(root, record) {
  atomicJson(switchFile(root, record.issue), record);
  const fd = fs.openSync(path.join(root, "ledger.md"), "a", 0o600);
  try { fs.writeSync(fd, `- ${new Date().toISOString()} BACKUP_SWITCH ${record.issue} a${record.previousAttempt} -> a${record.attempt}: ${JSON.stringify(record)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDir(root);
}

export function configuredBackup(config) {
  const settings = config.orchestration ?? {};
  if (!Object.hasOwn(settings, "backupTransport")) return null;
  if (!transports.includes(settings.backupTransport)) throw new Error("orchestration.backupTransport must be codex-cli or claude-cli");
  const primary = settings.transport ?? "codex-cli";
  if (!transports.includes(primary)) throw new Error("orchestration.backupTransport requires a managed CLI primary transport");
  if (primary === settings.backupTransport) throw new Error("orchestration.backupTransport must differ from the primary transport");
  return settings.backupTransport;
}

// Keep stopped-attempt identity after ordinary registry retirement. Process
// groups also retain visibility of commands orphaned by a stopped wrapper.
export function recordAttempt(root, entry) {
  const file = recordFile(root, entry.issue, entry.attempt);
  if (!fs.existsSync(file) && (!entry.modelRoutes?.base || !configuredBackup(baseModelConfig(entry.worktree, entry.modelRoutes.base)))) return;
  const previous = fs.existsSync(file) ? readJson(file) : {};
  const processes = previous.processes ?? [];
  if (entry.pid && !processes.some(row => row.pid === entry.pid && row.procStart === entry.procStart))
    processes.push({ pid: entry.pid, procStart: entry.procStart, processGroup: entry.processGroup ?? entry.pid });
  atomicJson(file, { ...previous, entry, processes });
}

// Freeze process creation before retaining the tree used by ordinary forced
// termination. Keep its identities outside worker grants across resumes.
export async function stopBackupProcessTree(root, issue) {
  if (!path.isAbsolute(root ?? "") || !/^[A-Z][A-Z0-9]*-\d+$/.test(issue)) throw new Error("absolute root and issue required");
  return withLock(path.join(root, "launch.lock"), async () => {
    const entry = readJson(path.join(root, "workers.json"))[issue];
    if (!entry?.pid || !entry.procStart) throw new Error("capture the primary process tree before stopping or retiring it");
    recordAttempt(root, entry);
    const file = recordFile(root, issue, entry.attempt), previous = readJson(file);
    if (previous.retirement?.pending === true) throw new Error("incomplete prior stop; reconcile the retained process observations before retrying");
    const table = () => processTable().filter(row => !row.state.startsWith("Z"));
    let live = table();
    const retained = previous.retirement ?? { capturedWriters: [], processes: [] };
    if (!live.some(row => row.pid === entry.pid && row.procStart === entry.procStart && row.group === entry.pid)) {
      const processes = [...previous.processes, ...retained.processes];
      if (processes.some(old => live.some(row => (row.pid === old.pid && row.procStart === old.procStart) || row.group === old.processGroup)))
        throw new Error("previous worker or descendants still live; reconcile before recording a stopped tree");
      for (const group of new Set(processes.map(row => row.processGroup))) {
        try { process.kill(-group, 0); }
        catch (error) { if (error.code === "ESRCH") continue; throw error; }
        throw new Error("previous worker process group still live; reconcile before recording a stopped tree");
      }
      requireProcessOwnership(root, previous, live);
      const retirement = { capturedAt: new Date().toISOString(), capturedWriters: previous.processes, processes,
        quiesced: true, stopRequested: true, pending: false, proof: "already-stopped" };
      atomicJson(file, { ...previous, retirement });
      return { file, retirement };
    }
    const observer = live.find(row => row.pid === process.pid);
    if (!observer) throw new Error("process observer identity unavailable; reconcile before stopping");
    const writers = [];
    for (const writer of previous.processes) {
      const row = live.find(row => row.pid === writer.pid && row.procStart === writer.procStart);
      if (row && row.group === writer.processGroup) writers.push(row);
      else if (!retained.quiesced || !retained.stopRequested || !retained.capturedWriters.some(old => old.pid === writer.pid && old.procStart === writer.procStart))
        throw new Error("previous process incarnation has no retained tree capture; reconcile before switching");
    }
    const groups = new Set(), seen = new Map();
    const select = rows => {
      const selected = new Set(writers.map(row => row.pid));
      for (const old of retained.processes) if (rows.some(row => row.pid === old.pid && row.procStart === old.procStart)) selected.add(old.pid);
      let added;
      do {
        added = false;
        for (const row of rows) if (!selected.has(row.pid) && (selected.has(row.ppid) || groups.has(row.group))) {
          selected.add(row.pid); added = true;
        }
      } while (added);
      return rows.filter(row => selected.has(row.pid));
    };
    const freeze = rows => {
      let added = false;
      for (const row of rows) {
        if (row.group === observer.group || row.pid === process.pid) throw new Error("stop must run outside the worker process tree");
        if (groups.has(row.group)) continue;
        if (!rows.some(leader => leader.pid === row.group) && !retained.processes.some(old => old.processGroup === row.group && rows.some(current => current.pid === old.pid && current.procStart === old.procStart)))
          throw new Error("descendant process group ownership unknown; reconcile before stopping");
        process.kill(-row.group, "SIGSTOP"); groups.add(row.group); added = true;
      }
      return added;
    };
    for (const row of select(live)) seen.set(row.pid, row);
    atomicJson(file, { ...previous, retirement: { ...retained, quiesced: false, stopRequested: false, pending: true,
      observed: [...seen.values()], startedAt: new Date().toISOString() } });
    freeze(writers);
    const deadline = Date.now() + 5000;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 25));
      live = table();
      if ([...seen.values()].some(old => !live.some(row => row.pid === old.pid && row.procStart === old.procStart)))
        throw new Error("process disappeared before tree quiescence; reconcile missing descendants");
      const selected = select(live);
      for (const row of selected) seen.set(row.pid, row);
      const added = freeze(selected);
      if (!added && [...seen.values()].every(row => row.state.startsWith("T"))) break;
      if (Date.now() >= deadline) throw new Error("process tree quiescence unverified; reconcile the retained stopped processes");
    }
    const captured = [...seen.values()].map(row => ({ pid: row.pid, ppid: row.ppid, procStart: row.procStart, processGroup: row.group }));
    const processes = [...retained.processes];
    for (const row of captured) if (!processes.some(old => old.pid === row.pid && old.procStart === row.procStart)) processes.push(row);
    const retirement = { capturedAt: new Date().toISOString(), capturedWriters: previous.processes, processes, quiesced: true, stopRequested: false, pending: true };
    atomicJson(file, { ...previous, retirement });
    const depth = row => {
      if (writers.some(writer => writer.pid === row.pid)) return 0;
      let count = 1, parent = seen.get(row.ppid);
      const visited = new Set([row.pid]);
      while (parent && !visited.has(parent.pid)) { visited.add(parent.pid); count++; parent = seen.get(parent.ppid); }
      return count;
    };
    const kill = pid => { try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } };
    for (const row of [...seen.values()].sort((a, b) => depth(b) - depth(a))) kill(row.pid);
    retirement.stopRequested = true;
    retirement.pending = false;
    atomicJson(file, { ...previous, retirement });
    return { file, retirement };
  });
}

function previousAttempt(request, input) {
  if (input.issue !== request.issue || !Number.isSafeInteger(input.previousAttempt) || input.previousAttempt < 1)
    throw new Error("backup switch requires matching issue and previousAttempt");
  const file = recordFile(request.root, request.issue, input.previousAttempt);
  if (!fs.existsSync(file)) throw new Error("previous attempt record missing; reconcile the retained attempt before switching");
  const previous = readJson(file), entry = previous.entry;
  if (entry?.issue !== request.issue || entry.attempt !== input.previousAttempt || entry.stage !== "mono-deliver" ||
      entry.worktree !== request.worktree || entry.branch !== request.branch || !entry.pins)
    throw new Error("previous attempt identity/worktree/pins mismatch");
  const pins = effectivePins(entry), config = baseModelConfig(entry.worktree, pins.base);
  if (entry.modelRoutes?.base !== pins.base || entry.modelRoutes.configDigest !== digest(config) ||
      canonical(entry.modelRoutes) !== canonical(pins.modelRoutes)) throw new Error("previous attempt model pins mismatch");
  if (entry.transport !== (config.orchestration?.transport ?? "codex-cli"))
    throw new Error("previous attempt must use its BASE primary transport");
  return { ...previous, pins, config };
}

const routeIdentity = ({ fingerprint, ...route }) => route;
export function resolveBackupSwitch(request) {
  if (request.backupSwitch === undefined) return null;
  const input = request.backupSwitch;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("backup switch record must be an object");
  if (!reasons.includes(input.reason)) throw new Error("backup switch reason must be subscription-exhausted or provider-refusal-after-recovery");
  if (input.training !== undefined && typeof input.training !== "boolean") throw new Error("backup switch training must be boolean");
  const previous = previousAttempt(request, input);
  const backup = configuredBackup(previous.config);
  if (!backup) throw new Error("backup transport not configured on previous BASE");
  if (input.backupTransport !== backup) throw new Error("backup switch transport differs from previous BASE mandate");
  const nextConfig = baseModelConfig(request.worktree, request.base);
  if (configuredBackup(nextConfig) !== backup || (nextConfig.orchestration?.transport ?? "codex-cli") !== previous.entry.transport)
    throw new Error("backup transport/primary changed on new BASE");
  const oldReviewer = resolveRole("autoreview", previous.config, { packRoot: previous.entry.packRoot });
  const newReviewer = resolveRole("autoreview", nextConfig, { packRoot: request.packRoot });
  if (canonical(oldReviewer) !== canonical(previous.entry.modelRoutes.roles.autoreview) ||
      canonical(routeIdentity(oldReviewer)) !== canonical(routeIdentity(newReviewer))) throw new Error("reviewer route changed between attempt bases");
  if (!path.isAbsolute(input.evidenceFile ?? "") || !fs.existsSync(input.evidenceFile)) throw new Error("backup switch requires an evidence file");
  const evidence = fs.readFileSync(input.evidenceFile), excerpt = evidence.toString("utf8").trim();
  const journal = path.join(request.root, "logs", `${request.issue}-mono-deliver-a${input.previousAttempt}.jsonl`);
  const journalBytes = previous.entry.log === journal && excerpt ? fs.readFileSync(journal) : null;
  if (!journalBytes?.toString("utf8").includes(excerpt))
    throw new Error("backup switch evidence must be a nonempty excerpt of the previous attempt journal");
  if (input.reason === "provider-refusal-after-recovery") {
    const recovery = previous.entry.last_resume;
    if (!recovery || recovery.thread_id !== previous.entry.thread_id || !Number.isSafeInteger(recovery.logOffset) ||
        !journalBytes.subarray(recovery.logOffset).toString("utf8").includes(excerpt))
      throw new Error("provider refusal requires recorded recovery and evidence after recovery on the same worker");
  }
  const record = { issue: request.issue, previousAttempt: input.previousAttempt, attempt: input.previousAttempt + 1,
    previousTransport: previous.entry.transport, backupTransport: backup, previousBase: previous.pins.base, base: request.base,
    reason: input.reason, evidenceFile: resolvedLocation(input.evidenceFile), evidenceDigest: sha256(evidence), journal,
    training: input.training ?? false };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(record, key) || canonical(key === "evidenceFile" ? resolvedLocation(value) : value) !== canonical(record[key]))
      throw new Error(`backup switch record mismatch: ${key}`);
  }
  return record;
}

export function validateBackupLaunch(request, used, roots) {
  if (fs.existsSync(switchFile(request.root, request.issue))) throw new Error("issue already switched; automatic return or a second switch is forbidden");
  const record = resolveBackupSwitch(request);
  if (!record) return null;
  if (used !== record.previousAttempt) throw new Error("backup switch must follow the latest counted attempt");
  const previous = previousAttempt(request, record);
  const processes = previous.processes;
  if (!Array.isArray(processes) || !processes.length || processes.some(row => !Number.isSafeInteger(row.pid) || row.pid <= 0 ||
      !row.procStart || row.processGroup !== row.pid)) throw new Error("previous worker process identity incomplete; reconcile before switching");
  const live = processTable().filter(row => !row.state.startsWith("Z"));
  if (processes.some(old => live.some(row => (row.pid === old.pid && row.procStart === old.procStart) || row.group === old.processGroup)))
    throw new Error("previous worker or descendants still live; backup switch refused");
  const capture = previous.retirement;
  if (!capture?.capturedAt || capture.quiesced !== true || capture.stopRequested !== true || capture.pending !== false || !Array.isArray(capture.processes) || !Array.isArray(capture.capturedWriters) ||
      processes.some(writer => !capture.capturedWriters.some(old => old.pid === writer.pid && old.procStart === writer.procStart)) ||
      capture.processes.some(row => !Number.isSafeInteger(row.pid) || row.pid <= 0 || !row.procStart || !Number.isSafeInteger(row.processGroup) || row.processGroup <= 0) ||
      processes.some(writer => !capture.processes.some(old => old.pid === writer.pid && old.procStart === writer.procStart)))
    throw new Error("previous process tree capture missing or incomplete; reconcile before switching");
  if (capture.processes.some(old => live.some(row => row.pid === old.pid && row.procStart === old.procStart)))
    throw new Error("previous worker or descendants still live; backup switch refused");
  for (const group of new Set([...processes, ...capture.processes].map(row => row.processGroup))) {
    try { process.kill(-group, 0); }
    catch (error) { if (error.code === "ESRCH") continue; throw error; }
    throw new Error("previous worker process group still live; backup switch refused");
  }
  requireProcessOwnership(request.root, previous, live);
  if (previous.entry.thread_id) {
    const commands = execFileSync("ps", ["-axo", "command="], { encoding: "utf8" });
    if (commands.split("\n").some(command => command.split(/\s+/).includes(previous.entry.thread_id)))
      throw new Error("previous worker thread still live; backup switch refused");
  }
  if (roots.some(root => !previous.entry.workerWritableRoots?.some(old => root === resolvedLocation(old) || root.startsWith(resolvedLocation(old) + path.sep))))
    throw new Error("backup switch must not expand previous worker write grants");
  if (!request.pins || canonical(effectivePins({ ...request, pinsVersion: 0 }).backupSwitch) !== canonical(record))
    throw new Error("backup switch record missing or changed in new attempt pins");
  if (roots.some(root => record.evidenceFile === root || record.evidenceFile.startsWith(root + path.sep)))
    throw new Error("backup switch evidence must remain outside worker write grants");
  return record;
}

if (isMain(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2), args = flags(rest);
    if (command !== "stop") throw new Error("Usage: backup-switch.mjs stop --root DIR --issue KEY (quiesce, capture and force-stop before registry retirement)");
    console.log(JSON.stringify(await stopBackupProcessTree(args.root, args.issue)));
  } catch (error) { console.error(`backup-switch: ${error.message}`); process.exitCode = 1; }
}
