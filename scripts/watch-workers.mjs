#!/usr/bin/env node

// External heartbeat for `mono-orchestrate` (references/orchestration.md,
// "## Heartbeat"). Watches one orchestrator mailbox root and prints one
// stable line per worker liveness event to stdout:
//
//   <ISO time> EVENT:<stall|dead|spawn-fail|report|gate-ack|idle> <ISSUE-KEY|-> <detail>
//
// Checks per scan (log checks apply only to Issues present in workers.json,
// the active registry; logs of retired Issues are history and are skipped
// silently):
//   (a) age of the last event of each logs/<ISSUE-KEY>-<stage>[-aN].jsonl
//       (file mtime) against --stall-sec -> stall;
//   (b) workers.json entries without a live log file -> dead;
//   (c) a non-empty log with no valid JSON events -> spawn-fail,
//       immediately, without waiting for any age threshold; a non-JSON
//       first line followed by valid events is contamination and warns once;
//   (d) a log that stopped growing with no writer process evidence
//       (registry pid gone, or silent for 2x the stall threshold) -> dead.
// Stall and dead (both branches) are suppressed when a mailbox report for
// the same issue+stage shows the stage completed: report at least as fresh
// as the log's last event, or within one stall threshold behind it (the CLI
// appends its final shutdown events to the log just after the worker writes
// the report), and never older than the log file's creation time (a prior
// attempt's report proves nothing about a retry's writer). A fresh
// `gates-passed` gate-ack suppresses them on the same predicate: the gate
// pause of the two-phase dispatch handshake is a contracted wait, so the
// worker's exited process is its expected state there, not death.
//
// Report and gate-ack events apply only to codex-cli workers with a
// correlated A5 identity and use file mtime+size as the in-process version
// key. Idle follows the A5 retirement contract: registry entries remain
// active until deploy closeout removes them; control active/draining never
// retires a remaining entry.
//
// Read-only by contract: no LLM calls, no writes anywhere — it reads
// logs/*.jsonl, reports/*.json, workers.json, and control.json, and emits to
// stdout only (diagnostics go to stderr). Zero dependencies: node:fs/path/process.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_STALL_SEC = 120;
const MIN_STALL_SEC = 90;
const DEFAULT_REPEAT_SEC = 300;
const DEFAULT_INTERVAL_SEC = 15;
const DEFAULT_IDLE_SEC = 300;
const LOG_READ_BYTES = 4096;
const DETAIL_SNIPPET_LENGTH = 80;
// A gate-ack is a handful of gate entries; anything larger is not one, and the
// bound keeps a worker-controlled path from feeding the watcher unbounded data.
const GATE_ACK_MAX_BYTES = 64 * 1024;

// <ISSUE-KEY>-<stage>.jsonl or <ISSUE-KEY>-<stage>-a<attempt>.jsonl,
// where <stage> itself may contain hyphens (e.g. mono-implement).
const LOG_NAME_PATTERN = /^([A-Za-z][A-Za-z0-9]*-\d+)-(.+?)(?:-a(\d+))?\.jsonl$/;

function usage(exitCode = 2) {
  console.error("Usage: node scripts/watch-workers.mjs --root <orchestrator-root> [options]");
  console.error("");
  console.error("Watch an orchestrator mailbox root (logs/, reports/, workers.json) and");
  console.error("print one line per worker liveness event to stdout:");
  console.error("  <ISO time> EVENT:<stall|dead|spawn-fail|report|gate-ack|idle> <ISSUE-KEY|-> <detail>");
  console.error("");
  console.error("Options:");
  console.error("  --root <dir>        Orchestrator root, e.g. ~/.mono-agent-workflow/orchestrator/<product> (required)");
  console.error(`  --stall-sec <n>     Stall threshold in seconds (default ${DEFAULT_STALL_SEC}, minimum ${MIN_STALL_SEC})`);
  console.error(`  --repeat-sec <n>    Do not repeat the same event more often than this (default ${DEFAULT_REPEAT_SEC})`);
  console.error(`  --interval-sec <n>  Scan interval in seconds (default ${DEFAULT_INTERVAL_SEC})`);
  console.error(`  --idle-sec <n>      Emit idle after no active workers for this long (default ${DEFAULT_IDLE_SEC})`);
  console.error("  --once              Run a single scan and exit");
  console.error("  --help, -h          Show this help and exit");
  process.exit(exitCode);
}

function expandHome(value) {
  if (value === "~" || value.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) return value;
    return path.join(home, value.slice(1));
  }
  return value;
}

function parsePositiveInt(flag, value) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== String(value).trim()) {
    console.error(`${flag} requires a positive integer, got: ${value}`);
    usage();
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    root: null,
    stallSec: DEFAULT_STALL_SEC,
    repeatSec: DEFAULT_REPEAT_SEC,
    intervalSec: DEFAULT_INTERVAL_SEC,
    idleSec: DEFAULT_IDLE_SEC,
    once: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      args.root = argv[(index += 1)];
    } else if (arg === "--stall-sec") {
      args.stallSec = parsePositiveInt(arg, argv[(index += 1)]);
    } else if (arg === "--repeat-sec") {
      args.repeatSec = parsePositiveInt(arg, argv[(index += 1)]);
    } else if (arg === "--interval-sec") {
      args.intervalSec = parsePositiveInt(arg, argv[(index += 1)]);
    } else if (arg === "--idle-sec") {
      args.idleSec = parsePositiveInt(arg, argv[(index += 1)]);
    } else if (arg === "--once") {
      args.once = true;
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }
  if (!args.root) {
    console.error("--root is required (pass the orchestrator root explicitly).");
    usage();
  }
  if (args.stallSec < MIN_STALL_SEC) {
    console.error(`--stall-sec must be at least ${MIN_STALL_SEC} (got ${args.stallSec}); lower values misread normal turn gaps as stalls.`);
    process.exit(2);
  }
  args.root = path.resolve(expandHome(args.root));
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
  console.error(`Orchestrator root is not a directory: ${args.root}`);
  process.exit(2);
}

const emittedAt = new Map();
const emittedReportVersions = new Map();
const emittedGateAckVersions = new Map();
const warnedOnce = new Set();
let lastEventAtMs = null;

function warnOnce(message) {
  if (warnedOnce.has(message)) return;
  warnedOnce.add(message);
  console.error(`watch-workers: ${message}`);
}

function emitEvent(event, issueKey, detail, dedupKey, nowMs) {
  const last = emittedAt.get(dedupKey);
  if (last !== undefined && nowMs - last < args.repeatSec * 1000) return;
  emittedAt.set(dedupKey, nowMs);
  lastEventAtMs = nowMs;
  console.log(`${new Date(nowMs).toISOString()} EVENT:${event} ${issueKey} ${detail}`);
}

function truncateForDetail(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > DETAIL_SNIPPET_LENGTH ? `${flat.slice(0, DETAIL_SNIPPET_LENGTH)}...` : flat;
}

function isJsonEventLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function inspectLog(filePath) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, "r");
  } catch {
    return { firstLine: null, hasJsonEvent: false };
  }
  try {
    const buffer = Buffer.alloc(LOG_READ_BYTES);
    let pending = "";
    let firstLine = null;
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, LOG_READ_BYTES, null);
      pending += buffer.toString("utf8", 0, bytesRead);
      let newlineIndex;
      while ((newlineIndex = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        if (firstLine === null) firstLine = line;
        if (isJsonEventLine(line)) return { firstLine, hasJsonEvent: true };
      }
    } while (bytesRead > 0);

    if (pending.length > 0) {
      if (firstLine === null) firstLine = pending;
      if (isJsonEventLine(pending)) return { firstLine, hasJsonEvent: true };
    }
    return { firstLine, hasJsonEvent: false };
  } finally {
    fs.closeSync(descriptor);
  }
}

function loadRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) {
    return { entries: {}, mtimeMs: null, valid: false };
  }
  try {
    const stat = fs.statSync(registryPath);
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { entries: parsed, mtimeMs: stat.mtimeMs, valid: true };
    }
    warnOnce(`workers.json is not an object map: ${registryPath}`);
  } catch {
    warnOnce(`workers.json could not be parsed: ${registryPath}`);
  }
  return { entries: {}, mtimeMs: null, valid: false };
}

function loadControlState(controlPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(controlPath, "utf8"));
    if (["active", "draining", "idle"].includes(parsed?.state)) return parsed.state;
    warnOnce(`control.json state is not active, draining, or idle: ${controlPath}`);
  } catch {
    warnOnce(`control.json could not be parsed: ${controlPath}`);
  }
  return null;
}

// "alive" / "dead" when the registry records a writer pid, "unknown" otherwise.
function writerPidState(registryEntry) {
  const pid = registryEntry && Number.isInteger(registryEntry.pid) ? registryEntry.pid : null;
  if (!pid || pid <= 0) return "unknown";
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return error.code === "EPERM" ? "alive" : "dead";
  }
}

function collectLatestLogs(logsDir) {
  let names = [];
  try {
    names = fs.readdirSync(logsDir);
  } catch {
    warnOnce(`logs directory not found yet: ${logsDir}`);
    return new Map();
  }

  const latestByIssue = new Map();
  for (const name of names) {
    const match = name.match(LOG_NAME_PATTERN);
    if (!match) continue;
    const filePath = path.join(logsDir, name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const log = { issue: match[1], stage: match[2], attempt: match[3] ? Number(match[3]) : null, name, filePath, stat };
    const current = latestByIssue.get(log.issue);
    if (!current || stat.mtimeMs > current.stat.mtimeMs) latestByIssue.set(log.issue, log);
  }
  return latestByIssue;
}

function reportStatFor(reportsDir, log) {
  const reportPath = path.join(reportsDir, `${log.issue}-${log.stage}.json`);
  try {
    return fs.statSync(reportPath);
  } catch {
    return null;
  }
}

// The freshness predicate every intentional-stop artefact shares. A report or
// a gate-ack proves something about THIS log's writer only when it is at
// least as new as the log file's creation (a prior attempt's file proves
// nothing about a retry) and no more than one stall threshold behind the
// log's last event (the CLI appends its shutdown tail just after the worker
// writes the file).
function isFreshForLog(stat, log) {
  return (
    stat.mtimeMs >= log.stat.birthtimeMs &&
    stat.mtimeMs >= log.stat.mtimeMs - args.stallSec * 1000
  );
}

// Gate-ack of the two-phase dispatch handshake (references/orchestration.md,
// "## Two-Phase Dispatch Handshake"): the worker passed its start gates and
// stopped, waiting for the orchestrator to apply the dispatch's lifecycle
// moves and resume it. Its shape is deliberately minimal and carries no pack
// identity, so it is correlated through the registry entry and the log it
// belongs to, never through fields of its own.
//
// The ack is the only evidence the gates ran, and it suppresses liveness
// events, so it is validated whole and fails closed: a non-empty `gates` array
// of well-formed entries, and `gates-passed` only when every entry passed. An
// ack claiming `gates-passed` over a blocked gate is self-contradictory and is
// treated as no ack at all. Coverage of the dispatch's gate LIST is the
// orchestrator's check, not the watcher's — only the orchestrator knows which
// gates it dispatched.
//
// Lifecycle: the orchestrator consumes the ack by renaming it — to
// `<ISSUE-KEY>-gate-ack.applied.json` once the worker is resumed AND its new
// writer registered, or to `<ISSUE-KEY>-gate-ack.rejected.json` when the ack
// fails its gate-list coverage check. Either rename is what re-arms stall/dead,
// since the resumed worker appends to the same stage log and a retained ack
// would keep suppressing them. Renaming any earlier than the registration is
// its own defect: the gate-phase pid is already gone, so an unsuppressed window
// would report a healthy resume as dead (references/orchestration.md, step 5).
function isGateEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    typeof entry.gate === "string" &&
    entry.gate.length > 0 &&
    (entry.status === "pass" || entry.status === "blocked") &&
    typeof entry.evidence === "string" &&
    entry.evidence.length > 0
  );
}

function readGateAckAt(ackPath, log) {
  // Open ONCE and decide everything from that descriptor — never check a
  // pathname and then reopen it. The fallback ack path lives inside the
  // worker's own worktree, so it is worker-controlled: between a path-based
  // check and a path-based read, the file can be swapped for a symlink, FIFO,
  // or device (TOCTOU). This watcher is synchronous and single-threaded, so
  // opening a FIFO would block it forever and a device such as /dev/zero would
  // read without bound — either one silently ends ALL liveness monitoring for
  // every worker, which is the exact opposite of what an ack is for.
  //
  // O_NOFOLLOW refuses a symlink at open time; O_NONBLOCK keeps a FIFO from
  // blocking the open itself. Type and size then come from fstat on the
  // descriptor already held, and the read never resolves the path again.
  let fd;
  try {
    fd = fs.openSync(ackPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > GATE_ACK_MAX_BYTES) return null;

    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      let bytesRead;
      try {
        bytesRead = fs.readSync(fd, buffer, offset, stat.size - offset, offset);
      } catch {
        return null;
      }
      if (bytesRead <= 0) break;
      offset += bytesRead;
    }

    let ack;
    try {
      ack = JSON.parse(buffer.subarray(0, offset).toString("utf8"));
    } catch {
      return null;
    }
    if (ack?.issue !== log.issue || ack.phase !== "gate") return null;
    if (ack.status !== "gates-passed" && ack.status !== "blocked") return null;
    if (!Array.isArray(ack.gates) || ack.gates.length === 0) return null;
    if (!ack.gates.every(isGateEntry)) return null;
    // Gate names are unique. A repeated name can otherwise stand in for an
    // omitted one under any coverage check that counts entries rather than
    // comparing the set, and this artifact authorizes lifecycle mutations.
    const gateNames = ack.gates.map((entry) => entry.gate);
    if (new Set(gateNames).size !== gateNames.length) return null;
    if (ack.status === "gates-passed" && !ack.gates.every((entry) => entry.status === "pass")) return null;
    return { ackPath, stat, status: ack.status };
  } finally {
    fs.closeSync(fd);
  }
}

// The mailbox path and the sandbox fallback the protocol permits under the
// worker's own worktree. An ack the watcher cannot see reads as a dead worker,
// which would send the healing ladder against a contracted wait.
//
// The ack file is numbered by ATTEMPT, exactly as the attempt logs are and for
// the same stated reason. Timestamps cannot tell overlapping writers apart: a
// superseded attempt that is still alive can write after its successor's log
// was born, and its ack would then look fresh for that successor. Since a retry
// carries the same gate names, no set-equality check downstream would notice
// either — the orchestrator would apply lifecycle moves and resume a worker on
// gates that worker never ran, which is the one thing this protocol exists to
// prevent. The attempt number in the path is what makes an ack belong to the
// writer that produced it.
//
// Both locations are evaluated and the CURRENT candidate wins: a structurally
// valid mailbox ack left over from an earlier write must not shadow the fresh
// fallback ack of the worker actually paused right now.
function readGateAck(reportsDir, log, registryEntry) {
  // No attempt number means no attempt identity to bind to. Logs are numbered
  // from -a1 by contract, so this is a malformed or legacy log; failing closed
  // costs only a suppression the handshake never promised for it.
  if (!Number.isInteger(log.attempt)) return null;
  const ackName = `${log.issue}-gate-ack-a${log.attempt}.json`;
  const worktree =
    typeof registryEntry?.worktree === "string" ? path.resolve(expandHome(registryEntry.worktree)) : null;
  const candidates = [
    path.join(reportsDir, ackName),
    ...(worktree === null ? [] : [path.join(worktree, ".orchestrator", ackName)]),
  ]
    .map((ackPath) => readGateAckAt(ackPath, log))
    .filter((candidate) => candidate !== null);
  if (candidates.length === 0) return null;
  const fresh = candidates.filter((candidate) => isFreshForLog(candidate.stat, log));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pool.reduce((best, candidate) => (candidate.stat.mtimeMs > best.stat.mtimeMs ? candidate : best));
}

function hasPackIdentity(value) {
  return (
    typeof value?.packVersion === "string" &&
    value.packVersion.length > 0 &&
    typeof value.sourceCommit === "string" &&
    /^[0-9a-f]{40}$/.test(value.sourceCommit) &&
    Number.isInteger(value.surfaceRevision) &&
    value.surfaceRevision > 0
  );
}

// Shared correlation surface for the two delivery events: only a codex-cli
// worker whose registry entry names this exact log, this stage, and a full
// A5 identity can produce a `report` or a `gate-ack`.
function isCorrelatedDeliveryLog(log, registryEntry) {
  // Desktop and fallback transports deliberately have no JSONL correlation
  // surface. Their deliveries remain under the orchestrator's polling
  // contract.
  if (registryEntry?.transport !== "codex-cli") return false;
  if (registryEntry.stage !== log.stage) return false;
  const registryLogPath =
    typeof registryEntry.log === "string" ? path.resolve(expandHome(registryEntry.log)) : null;
  return registryLogPath === log.filePath && hasPackIdentity(registryEntry);
}

// The handshake exists only where a dispatch can carry a lifecycle move, and
// that is the implement stage: preflight and ship advances carry none and have
// no gate phase at all (references/orchestration.md). An ack sitting beside any
// other stage's log is spurious, and must neither deliver nor suppress.
const GATE_PHASE_STAGE = "mono-implement";

function isCorrelatedGateAckLog(log, registryEntry) {
  return log.stage === GATE_PHASE_STAGE && isCorrelatedDeliveryLog(log, registryEntry);
}

function checkGateAck(log, gateAck, nowMs) {
  if (gateAck === null || !isFreshForLog(gateAck.stat, log)) return;

  const version = `${gateAck.stat.mtimeMs}:${gateAck.stat.size}`;
  if (emittedGateAckVersions.get(gateAck.ackPath) === version) return;
  emittedGateAckVersions.set(gateAck.ackPath, version);
  emitEvent(
    "gate-ack",
    log.issue,
    `gate-ack ${path.basename(gateAck.ackPath)} status ${gateAck.status} is fresh and registry-correlated (version ${version})`,
    `gate-ack:${gateAck.ackPath}:${version}`,
    nowMs
  );
}

function checkReport(log, reportsDir, registryEntry, nowMs) {
  if (!isCorrelatedDeliveryLog(log, registryEntry)) return;

  const reportPath = path.join(reportsDir, `${log.issue}-${log.stage}.json`);
  let reportStat;
  let report;
  try {
    reportStat = fs.statSync(reportPath);
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch {
    return;
  }
  if (!reportStat.isFile()) return;

  // This is intentionally the exact v2 freshness predicate. Requiring the
  // report to be as new as the log would create false negatives when Codex
  // appends shutdown-tail events after the worker writes its report.
  if (!isFreshForLog(reportStat, log)) return;

  if (report?.issue !== log.issue || report?.stage !== log.stage || !hasPackIdentity(report)) return;
  for (const field of ["packVersion", "sourceCommit", "surfaceRevision"]) {
    if (report[field] !== registryEntry[field]) return;
  }

  const version = `${reportStat.mtimeMs}:${reportStat.size}`;
  if (emittedReportVersions.get(reportPath) === version) return;
  emittedReportVersions.set(reportPath, version);
  emitEvent(
    "report",
    log.issue,
    `report ${path.basename(reportPath)} is fresh and identity-matched (version ${version})`,
    `report:${reportPath}:${version}`,
    nowMs
  );
}

function checkLog(log, gateAck, reportsDir, registry, nowMs) {
  const { firstLine, hasJsonEvent } = inspectLog(log.filePath);
  if (firstLine !== null && !hasJsonEvent) {
    // A non-empty log with no JSON events means the spawn command failed
    // before Codex started a thread; report it immediately.
    emitEvent(
      "spawn-fail",
      log.issue,
      `log has no JSON events; first line: "${truncateForDetail(firstLine)}" (${log.name})`,
      `spawn-fail:${log.name}`,
      nowMs
    );
    return;
  }
  if (firstLine !== null && !isJsonEventLine(firstLine)) {
    warnOnce(
      `non-JSON contamination before valid JSON events in ${log.name}: "${truncateForDetail(firstLine)}"`
    );
  }

  const ageSec = Math.round((nowMs - log.stat.mtimeMs) / 1000);
  if (ageSec < args.stallSec) return;

  // A worker that exited normally leaves a mailbox report for this stage —
  // at least as fresh as the log's last event, or within one stall threshold
  // behind it (the CLI appends its final shutdown events to the log just
  // after the worker writes the report). That is the normal advance signal,
  // not a liveness event, so it suppresses stall and both dead branches: a
  // completed worker's exited pid is its normal terminal state, not death.
  // The birthtime guard keeps a prior attempt's report from masking a fresh
  // retry log: a report older than this log file's creation belongs to an
  // earlier attempt and proves nothing about this writer.
  const reportStat = reportStatFor(reportsDir, log);
  if (reportStat !== null && isFreshForLog(reportStat, log)) return;

  // The gate pause of the two-phase dispatch handshake is a contracted wait,
  // not a death: a fresh `gates-passed` gate-ack means this worker stopped on
  // purpose and is waiting for the orchestrator to apply the dispatch's
  // lifecycle moves and resume it. A `blocked` ack suppresses nothing — that
  // path also writes the ordinary stage report, which the check above already
  // honours. The suppression ends when the orchestrator consumes the ack at
  // resume time; a retained ack cannot be told apart from a live pause here,
  // which is why that rename is a protocol obligation and not a nicety.
  //
  // `gateAck` is the scan's single ack snapshot, already registry-correlated by
  // the caller — one read shared with checkGateAck, so a consumption landing
  // between two reads can never make one scan emit `gate-ack` and `dead` for
  // the same worker. Suppression demands the SAME correlation delivery does: an
  // ack that cannot be delivered — foreign stage, foreign log, incomplete
  // identity, non-Codex entry — must not be able to silence liveness either, or
  // an untrustworthy registry entry would leave its worker both unreported and
  // unhealable.
  if (gateAck !== null && gateAck.status === "gates-passed" && isFreshForLog(gateAck.stat, log)) return;

  const pidState = writerPidState(registry[log.issue]);
  if (pidState === "dead") {
    emitEvent(
      "dead",
      log.issue,
      `log ${log.name} silent for ${ageSec}s and writer pid ${registry[log.issue].pid} is gone`,
      `dead:${log.name}`,
      nowMs
    );
  } else if (pidState !== "alive" && ageSec >= args.stallSec * 2) {
    emitEvent(
      "dead",
      log.issue,
      `log ${log.name} silent for ${ageSec}s (over 2x stall threshold ${args.stallSec}s) with no writer evidence`,
      `dead:${log.name}`,
      nowMs
    );
  } else {
    emitEvent(
      "stall",
      log.issue,
      `log ${log.name} last event ${ageSec}s ago (stall threshold ${args.stallSec}s)`,
      `stall:${log.name}`,
      nowMs
    );
  }
}

function checkRegistry(registry, nowMs) {
  for (const [issueKey, entry] of Object.entries(registry)) {
    // Log-based liveness only applies to codex-cli workers: desktop and
    // fallback transports have no JSONL log by design and are monitored
    // through their own runtime signals.
    if (entry?.transport && entry.transport !== "codex-cli") continue;
    const logPath = entry && typeof entry.log === "string" ? path.resolve(expandHome(entry.log)) : null;
    if (!logPath || !fs.existsSync(logPath)) {
      emitEvent(
        "dead",
        issueKey,
        `workers.json entry (stage ${entry?.stage ?? "unknown"}) has no live log file`,
        `dead:registry:${issueKey}`,
        nowMs
      );
    }
  }
}

function checkIdle(registrySnapshot, controlState, nowMs) {
  if (!registrySnapshot.valid || Object.keys(registrySnapshot.entries).length !== 0) return;
  const idleSinceMs = Math.max(registrySnapshot.mtimeMs ?? 0, lastEventAtMs ?? 0);
  if (nowMs - idleSinceMs < args.idleSec * 1000) return;
  emitEvent(
    "idle",
    "-",
    `registry has no active workers for ${Math.round((nowMs - idleSinceMs) / 1000)}s (idle threshold ${args.idleSec}s; control ${controlState ?? "unknown"})`,
    "idle:root",
    nowMs
  );
}

function scan() {
  const nowMs = Date.now();
  const registrySnapshot = loadRegistry(path.join(args.root, "workers.json"));
  const registry = registrySnapshot.entries;
  const controlState = loadControlState(path.join(args.root, "control.json"));
  const latestLogs = collectLatestLogs(path.join(args.root, "logs"));
  const reportsDir = path.join(args.root, "reports");
  for (const log of latestLogs.values()) {
    // The watcher observes the active registry, not the directory's history:
    // only Issues present in workers.json are live workers. Logs whose
    // ISSUE-KEY has no registry entry belong to retired Issues and are
    // skipped silently instead of flooding EVENT:dead on every scan.
    if (!Object.prototype.hasOwnProperty.call(registry, log.issue)) continue;
    const registryEntry = registry[log.issue];
    // One ack snapshot per log per scan, read once and shared: the delivery
    // check and the liveness check must never disagree about whether this
    // worker is in its gate pause.
    const gateAck = isCorrelatedGateAckLog(log, registryEntry)
      ? readGateAck(reportsDir, log, registryEntry)
      : null;
    checkGateAck(log, gateAck, nowMs);
    checkReport(log, reportsDir, registryEntry, nowMs);
    checkLog(log, gateAck, reportsDir, registry, nowMs);
  }
  checkRegistry(registry, nowMs);
  checkIdle(registrySnapshot, controlState, nowMs);
}

console.error(
  `watch-workers: root=${args.root} stall-sec=${args.stallSec} repeat-sec=${args.repeatSec} interval-sec=${args.intervalSec} idle-sec=${args.idleSec}${args.once ? " once" : ""}`
);

scan();
if (!args.once) {
  setInterval(scan, args.intervalSec * 1000);
}
