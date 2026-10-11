import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { atomicJson, readJson, baseModelConfig, canonical, digest, processTable, resolveRole, resolvedLocation, syncDir } from "../runtime.mjs";
import { effectivePins } from "./command-state.mjs";

const transports = ["codex-cli", "claude-cli"];
const reasons = ["subscription-exhausted", "provider-refusal-after-recovery"];
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const recordFile = (root, issue, attempt) => path.join(root, "attempt-records", `${issue}-a${attempt}.json`);
const switchFile = (root, issue) => path.join(root, "backup-switches", `${issue}.json`);

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
  const processes = fs.existsSync(file) ? readJson(file).processes : [];
  if (entry.pid && !processes.some(row => row.pid === entry.pid && row.procStart === entry.procStart))
    processes.push({ pid: entry.pid, procStart: entry.procStart, processGroup: entry.processGroup ?? entry.pid });
  atomicJson(file, { entry, processes });
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
  for (const old of processes) {
    try { process.kill(-old.processGroup, 0); }
    catch (error) { if (error.code === "ESRCH") continue; throw error; }
    throw new Error("previous worker process group still live; backup switch refused");
  }
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
