#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const PHASE_USAGE_NOTE = "по фазам недоступно";

function usage(exitCode = 2) {
  console.error(
    "Usage: node wave-cost.mjs <ISSUE-KEY> [--root <orchestrator-root>] [--orchestrator-transcript <jsonl>]"
  );
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { issue: "", root: "", orchestratorTranscript: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      args.root = argv[(index += 1)] || "";
      if (!args.root) usage();
    } else if (arg === "--orchestrator-transcript") {
      args.orchestratorTranscript = argv[(index += 1)] || "";
      if (!args.orchestratorTranscript) usage();
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else if (arg.startsWith("-")) {
      console.error(`Unknown argument: ${arg}`);
      usage();
    } else if (!args.issue) {
      args.issue = arg;
    } else {
      usage();
    }
  }
  if (!/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(args.issue)) {
    console.error("ISSUE-KEY must look like MONO-72");
    usage();
  }
  return args;
}

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function hasIssueLogs(candidate, issue) {
  const logsDir = path.join(candidate, "logs");
  if (!isDirectory(logsDir)) return false;
  return fs.readdirSync(logsDir).some((name) => name.startsWith(`${issue}-`) && name.endsWith(".jsonl"));
}

function resolveRoot(explicitRoot, issue) {
  if (explicitRoot) {
    const resolved = path.resolve(explicitRoot);
    if (!hasIssueLogs(resolved, issue)) {
      throw new Error(`orchestrator root has no logs for ${issue}: ${resolved}`);
    }
    return resolved;
  }

  const cwd = process.cwd();
  if (hasIssueLogs(cwd, issue)) return cwd;

  const stateRoot = path.resolve(
    process.env.MONO_WORKFLOW_STATE_ROOT || path.join(os.homedir(), ".mono-agent-workflow")
  );
  const productsRoot = path.join(stateRoot, "orchestrator");
  const candidates = isDirectory(productsRoot)
    ? fs
        .readdirSync(productsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(productsRoot, entry.name))
        .filter((candidate) => hasIssueLogs(candidate, issue))
    : [];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new Error(`no orchestrator root contains logs for ${issue}; pass --root`);
  }
  throw new Error(`more than one orchestrator root contains ${issue}; pass --root: ${candidates.join(", ")}`);
}

function unavailable(reason) {
  return `unavailable: ${reason}`;
}

function containsIssueKey(value, issue) {
  const escaped = issue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9])${escaped}(?![A-Z0-9])`, "i").test(String(value));
}

function issueKeysIn(value, issue) {
  const prefix = issue.slice(0, issue.lastIndexOf("-"));
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(^|[^A-Z0-9])(${escapedPrefix}-[1-9][0-9]*)(?![A-Z0-9])`,
    "g"
  );
  return new Set([...String(value).matchAll(pattern)].map((match) => match[2]));
}

function safeJsonLines(filename) {
  const events = [];
  const errors = [];
  const text = fs.readFileSync(filename, "utf8");
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      events.push({ value: JSON.parse(line), line: index + 1 });
    } catch (error) {
      errors.push(`line ${index + 1}: ${error.message}`);
    }
  }
  return { events, errors };
}

function zeroUsage() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

function normalizedUsage(raw, source, errors) {
  const required = ["input_tokens", "cached_input_tokens", "output_tokens"];
  for (const field of required) {
    if (!Number.isSafeInteger(raw?.[field]) || raw[field] < 0) {
      errors.push(`${source}: missing or invalid ${field}`);
      return null;
    }
  }
  const usage = zeroUsage();
  for (const field of Object.keys(usage)) {
    const value = raw[field] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0) {
      errors.push(`${source}: invalid ${field}`);
      return null;
    }
    usage[field] = value;
  }
  if (usage.cached_input_tokens > usage.input_tokens) {
    errors.push(`${source}: cached_input_tokens exceeds input_tokens`);
    return null;
  }
  if (usage.reasoning_output_tokens > usage.output_tokens) {
    errors.push(`${source}: reasoning_output_tokens exceeds output_tokens`);
    return null;
  }
  return usage;
}

function addUsage(target, usage) {
  for (const field of Object.keys(target)) target[field] += usage[field];
}

function finalizeUsage(usage) {
  return {
    ...usage,
    uncached_input_tokens: usage.input_tokens - usage.cached_input_tokens,
    non_overlapping_total_tokens: usage.input_tokens + usage.output_tokens,
  };
}

function attemptLogFiles(root, issue) {
  const logsDir = path.join(root, "logs");
  const escapedIssue = issue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedIssue}-(.+)-a([1-9][0-9]*)\\.jsonl$`);
  const seen = new Set();
  const logs = [];
  for (const name of fs.readdirSync(logsDir).sort()) {
    const match = pattern.exec(name);
    if (!match) continue;
    const filename = path.join(logsDir, name);
    const canonical = fs.realpathSync(filename);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    logs.push({ filename, canonical, name, stage: match[1], attempt: Number(match[2]) });
  }
  return logs;
}

function stringsIn(value, collected = []) {
  if (typeof value === "string") collected.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, collected);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) stringsIn(item, collected);
  }
  return collected;
}

function looksLikeInstalledPackFile(filename) {
  const normalized = filename.split(path.sep).join("/");
  return /\/(?:\.codex|\.claude)\/skills\/mono-[^/]+\/(?:SKILL\.md|AGENTS\.md|references\/[^/]+\.md|templates\/[^/]+\.md)$/.test(
    normalized
  );
}

function candidatePaths(text) {
  const expanded = text.replace(/~(?=\/)/g, os.homedir());
  const matches = expanded.match(/\/[A-Za-z0-9_@%+=:,./-]+/g) || [];
  return matches.map((candidate) => candidate.replace(/[:),\]}]+$/, ""));
}

function isReadEvent(event) {
  const item = event?.item ?? event;
  const readIdentifiers = [item?.type, item?.name, item?.tool_name, item?.tool].map((value) =>
    String(value || "").replace(/[.-]/g, "_")
  );
  if (readIdentifiers.some((value) => /^(?:read|read_file|file_read|readfile)$/i.test(value))) {
    return true;
  }
  if (item?.type !== "command_execution") return false;
  return /(?:^|[^A-Za-z0-9_-])(?:cat|head|tail|sed|rg|grep)(?:\s|$)/.test(
    String(item.command || "")
  );
}

function readInputs(event) {
  const item = event?.item ?? event;
  if (item?.type === "command_execution") return [String(item.command || "")];
  return stringsIn(item?.arguments ?? item?.input ?? item);
}

function collectPackReading(logResults) {
  const readCounts = new Map();
  for (const log of logResults) {
    for (const { value } of log.events) {
      if (!isReadEvent(value)) continue;
      const pathsInCommand = new Set();
      for (const text of readInputs(value)) {
        for (const candidate of candidatePaths(text)) {
          if (!looksLikeInstalledPackFile(candidate)) continue;
          let canonical;
          try {
            canonical = fs.realpathSync(candidate);
            if (!fs.statSync(canonical).isFile()) continue;
          } catch {
            continue;
          }
          pathsInCommand.add(canonical);
        }
      }
      for (const canonical of pathsInCommand) {
        readCounts.set(canonical, (readCounts.get(canonical) || 0) + 1);
      }
    }
  }
  const files = [...readCounts.entries()]
    .map(([filename, readCount]) => ({
      path: filename,
      bytes: fs.statSync(filename).size,
      approx_tokens: Math.ceil(fs.statSync(filename).size / 4),
      read_commands: readCount,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  return {
    method: "unique installed Mono skill/reference/template files named by logged read commands; repeated commands are reported but bytes are counted once",
    files,
    total_bytes: totalBytes,
    approx_tokens: Math.ceil(totalBytes / 4),
  };
}

function collectWorker(root, logs) {
  const total = zeroUsage();
  const oldRule = zeroUsage();
  const errors = [];
  let turns = 0;
  const attempts = [];
  const logResults = [];

  for (const log of logs) {
    const parsed = safeJsonLines(log.filename);
    const attemptUsage = zeroUsage();
    let lastUsage = null;
    let attemptTurns = 0;
    for (const event of parsed.events) {
      if (event.value?.type !== "turn.completed") continue;
      const usage = normalizedUsage(
        event.value.usage,
        `${log.name}:${event.line}`,
        errors
      );
      if (!usage) continue;
      addUsage(total, usage);
      addUsage(attemptUsage, usage);
      lastUsage = usage;
      turns += 1;
      attemptTurns += 1;
    }
    if (lastUsage) addUsage(oldRule, lastUsage);
    errors.push(...parsed.errors.map((error) => `${log.name}:${error}`));
    attempts.push({
      log: path.relative(root, log.filename),
      stage: log.stage,
      attempt: log.attempt,
      turns: attemptTurns,
      usage: finalizeUsage(attemptUsage),
    });
    logResults.push({ ...log, ...parsed });
  }

  const complete = errors.length === 0;
  return {
    worker: {
      subtotal_kind: "diagnostic worker subtotal; not the full PR cost",
      attempt_count: logs.length,
      turns,
      usage: finalizeUsage(total),
      usage_status: complete
        ? "measured"
        : unavailable("worker logs contain malformed JSON or invalid turn usage"),
      attempts,
      complete,
      errors,
    },
    oldRule: finalizeUsage(oldRule),
    logResults,
  };
}

function loadJsonReports(root, issue) {
  const reports = [];
  for (const directory of ["reports", "consumed"]) {
    const absoluteDir = path.join(root, directory);
    if (!isDirectory(absoluteDir)) continue;
    for (const name of fs.readdirSync(absoluteDir)) {
      if (!name.startsWith(`${issue}-`) || !name.endsWith(".json")) continue;
      const filename = path.join(absoluteDir, name);
      try {
        const value = JSON.parse(fs.readFileSync(filename, "utf8"));
        reports.push({ filename, directory, name, value, mtimeMs: fs.statSync(filename).mtimeMs });
      } catch {
        // A malformed report cannot become evidence; other sources remain usable.
      }
    }
  }
  return reports;
}

function latestStageReport(reports, stage, issue) {
  return reports
    .filter((report) => report.value?.issue === issue && report.value?.stage === stage)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0] ?? null;
}

function collectAutoreview(logResults) {
  let passes = 0;
  let outputs = 0;
  const helperUsage = zeroUsage();
  let usageEvents = 0;
  for (const log of logResults) {
    for (const { value } of log.events) {
      const item = value?.item;
      if (value?.type !== "item.completed" || item?.type !== "command_execution") continue;
      const output = String(item.aggregated_output || "");
      if (!output.includes("autoreview target:") || !output.includes("review passes:")) continue;
      outputs += 1;
      const passMatch = /review passes:\s*([0-9]+)/.exec(output);
      if (passMatch) passes += Number(passMatch[1]);
      for (const line of output.split("\n")) {
        const usageMatch = /autoreview usage:\s*input=([0-9]+)\s+cached=([0-9]+)\s+output=([0-9]+)/i.exec(line);
        if (!usageMatch) continue;
        addUsage(helperUsage, {
          input_tokens: Number(usageMatch[1]),
          cached_input_tokens: Number(usageMatch[2]),
          cache_write_input_tokens: 0,
          output_tokens: Number(usageMatch[3]),
          reasoning_output_tokens: 0,
        });
        usageEvents += 1;
      }
    }
  }
  return {
    passes: outputs > 0 ? passes : unavailable("no autoreview helper output found in worker logs"),
    usage:
      usageEvents > 0
        ? finalizeUsage(helperUsage)
        : unavailable("autoreview helper output does not report token usage"),
  };
}

function parseTranscriptUsage(filename, issue) {
  if (!filename) return unavailable("orchestrator session transcript path was not provided");
  const resolved = path.resolve(filename);
  if (!fs.existsSync(resolved)) return unavailable(`orchestrator transcript does not exist: ${resolved}`);
  const parsed = safeJsonLines(resolved);
  const total = zeroUsage();
  const errors = [...parsed.errors];
  let turnIssueKeys = new Set();
  let ambiguousTurns = 0;
  let turns = 0;
  for (const { value, line } of parsed.events) {
    const eventIssueKeys = issueKeysIn(JSON.stringify(value), issue);
    if (value?.type === "turn.started") turnIssueKeys = eventIssueKeys;
    else for (const key of eventIssueKeys) turnIssueKeys.add(key);
    if (value?.type !== "turn.completed") continue;
    const belongsToIssue = turnIssueKeys.has(issue.toUpperCase());
    const isAmbiguous = belongsToIssue && turnIssueKeys.size > 1;
    turnIssueKeys = new Set();
    if (!belongsToIssue) continue;
    if (isAmbiguous) {
      ambiguousTurns += 1;
      continue;
    }
    const usage = normalizedUsage(value.usage, `${path.basename(resolved)}:${line}`, errors);
    if (!usage) continue;
    addUsage(total, usage);
    turns += 1;
  }
  if (ambiguousTurns > 0) {
    return unavailable(`orchestrator transcript has a multi-Issue turn mentioning ${issue}`);
  }
  if (turns === 0) return unavailable(`no orchestrator turns mentioning ${issue} found in transcript`);
  return { transcript: resolved, turns, usage: finalizeUsage(total), complete: errors.length === 0, errors };
}

function ledgerEntryIssue(line) {
  const legacy = /^-\s+\d{2}:\d{2}\s+\(\d{2}\.\d{2}\)\s+([A-Z][A-Z0-9]*-[1-9][0-9]*)\b/.exec(line);
  if (legacy) return legacy[1];
  const iso = /^-\s+\d{4}-\d{2}-\d{2}T\S+\s+([A-Z][A-Z0-9]*-[1-9][0-9]*)\b/.exec(line);
  return iso?.[1] ?? null;
}

function ledgerEntries(root, issue) {
  const filename = path.join(root, "ledger.md");
  if (!fs.existsSync(filename)) return { filename, entries: [], allIssueLines: [] };
  let sectionYear = new Date().getUTCFullYear();
  const entries = [];
  const allIssueLines = [];
  for (const [index, line] of fs.readFileSync(filename, "utf8").split("\n").entries()) {
    const heading = /^##\s+(\d{4})-/.exec(line);
    if (heading) sectionYear = Number(heading[1]);
    if (ledgerEntryIssue(line) !== issue) continue;
    allIssueLines.push(line);
    let timestamp = null;
    const legacy = /^-\s+(\d{2}):(\d{2})\s+\((\d{2})\.(\d{2})\)/.exec(line);
    const iso = /^-\s+(\d{4}-\d{2}-\d{2}T\S+)/.exec(line);
    if (legacy) {
      timestamp = new Date(
        Date.UTC(sectionYear, Number(legacy[4]) - 1, Number(legacy[3]), Number(legacy[1]), Number(legacy[2]))
      );
    } else if (iso) {
      const parsed = new Date(iso[1]);
      if (!Number.isNaN(parsed.getTime())) timestamp = parsed;
    }
    entries.push({ line: index + 1, text: line, timestamp });
  }
  return { filename, entries, allIssueLines };
}

function explicitReportTimestamp(report, names) {
  if (!report) return null;
  const queue = [report.value];
  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (names.includes(key) && typeof child === "string") {
        const parsed = new Date(child);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return null;
}

function duration(start, end, missingReason) {
  if (!start || !end) return unavailable(missingReason);
  const milliseconds = end.getTime() - start.getTime();
  if (milliseconds < 0) return unavailable("recorded timestamps are non-monotonic");
  return {
    milliseconds,
    seconds: Math.round(milliseconds / 1000),
    human: formatDuration(milliseconds),
  };
}

function firstByTimestamp(entries, timestampOf = (entry) => entry.timestamp) {
  return entries
    .filter((entry) => timestampOf(entry))
    .sort((left, right) => timestampOf(left).getTime() - timestampOf(right).getTime())[0] ?? null;
}

function lastByTimestamp(entries) {
  return entries
    .filter((entry) => entry.timestamp)
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())[0] ?? null;
}

function dispatchAnchor(entry) {
  const match = /thread\.started\s*≈\s*(\d{4}-\d{2}-\d{2}T\S+)/i.exec(entry.text);
  if (match) {
    const parsed = new Date(match[1]);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return entry.timestamp;
}

function collectIntervals(ledger, reports, issue) {
  const dispatchEntries = ledger.entries.filter((entry) =>
    /\bDISPATCHED\b|GATE-PHASE SPAWN/i.test(entry.text)
  );
  const isoDispatchEntries = dispatchEntries.filter((entry) =>
    /^-\s+\d{4}-\d{2}-\d{2}T\S+/.test(entry.text)
  );
  const dispatchEntry = firstByTimestamp(
    isoDispatchEntries.length > 0 ? isoDispatchEntries : dispatchEntries,
    dispatchAnchor
  );
  const greenEntry = lastByTimestamp(
    ledger.entries.filter((entry) => /\bSHIP GREEN\b|mono-ship[^\n]*\bgreen\b/i.test(entry.text))
  );
  const mergeEntry = lastByTimestamp(
    ledger.entries.filter((entry) => /MERGED AND DEPLOYED|landed\/deployed|\bMERGED\b/i.test(entry.text))
  );
  const implementReport = latestStageReport(reports, "mono-implement", issue);
  const shipReport = latestStageReport(reports, "mono-ship", issue);
  const reportDispatchAt = explicitReportTimestamp(implementReport, [
    "dispatch_at",
    "dispatched_at",
    "started_at",
  ]);
  const reportGreenAt = explicitReportTimestamp(shipReport, ["green_at", "completed_at", "reported_at"]);
  const reportMergeAt = explicitReportTimestamp(shipReport, ["merged_at", "merge_at"]);
  const dispatchAt = reportDispatchAt ?? (dispatchEntry ? dispatchAnchor(dispatchEntry) : null);
  const greenAt = reportGreenAt ?? greenEntry?.timestamp ?? null;
  const mergeAt = reportMergeAt ?? mergeEntry?.timestamp ?? null;

  return {
    event_definitions: {
      start: "dispatch recorded for the Issue",
      green_pr: "mono-ship green recorded for the Issue",
      merge: "merge recorded for the Issue",
    },
    sources: {
      dispatch: reportDispatchAt
        ? implementReport.filename
        : dispatchEntry?.timestamp
          ? `ledger.md:${dispatchEntry.line}`
          : unavailable("dispatch event not found"),
      green_pr: reportGreenAt
        ? shipReport.filename
        : greenEntry?.timestamp
          ? `ledger.md:${greenEntry.line}`
          : unavailable("green PR event not found"),
      merge: reportMergeAt
        ? shipReport.filename
        : mergeEntry?.timestamp
          ? `ledger.md:${mergeEntry.line}`
          : unavailable("merge event not found"),
    },
    dispatch_to_green_pr: duration(dispatchAt, greenAt, "dispatch or green PR event not found"),
    dispatch_to_merge: duration(dispatchAt, mergeAt, "dispatch or merge event not found; parked runs have no merge duration"),
  };
}

function collectModel(root, issue, logResults) {
  const registryPath = path.join(root, "workers.json");
  if (fs.existsSync(registryPath)) {
    try {
      const entry = JSON.parse(fs.readFileSync(registryPath, "utf8"))[issue];
      const model = entry?.model_policy?.model ?? entry?.model ?? entry?.model_launch?.model_parameter;
      const effort = entry?.model_policy?.effort ?? entry?.effort ?? entry?.model_launch?.effort_parameter;
      if (model || effort) {
        return {
          model: model ?? unavailable("registry entry has no model"),
          effort: effort ?? unavailable("registry entry has no effort"),
          source: "workers.json",
        };
      }
    } catch {
      // Fall through to log metadata.
    }
  }
  for (const log of logResults) {
    for (const { value } of log.events) {
      if (value?.type !== "thread.started") continue;
      const model = value.model ?? value.usage?.model;
      const effort = value.effort ?? value.model_reasoning_effort ?? value.usage?.effort;
      if (model || effort) {
        return {
          model: model ?? unavailable("thread.started metadata has no model"),
          effort: effort ?? unavailable("thread.started metadata has no effort"),
          source: log.name,
        };
      }
    }
  }
  return {
    model: unavailable("registry entry was retired and logs carry no model metadata"),
    effort: unavailable("registry entry was retired and logs carry no effort metadata"),
    source: unavailable("no registry or log metadata"),
  };
}

function collectReviewRounds(shipReport) {
  const direct = shipReport?.value?.review_rounds;
  if (Number.isSafeInteger(direct) && direct >= 0) return direct;
  if (
    direct &&
    typeof direct === "object" &&
    Number.isSafeInteger(direct.novel_resolver_rounds) &&
    direct.novel_resolver_rounds >= 0
  ) {
    return direct.novel_resolver_rounds;
  }

  const candidates = stringsIn({
    notes: shipReport?.value?.notes,
    test_result: shipReport?.value?.tests?.result,
  });
  for (const candidate of candidates) {
    const match =
      /review rounds\s*[:=]\s*([0-9]+)/i.exec(candidate) ??
      /novel_resolver_rounds["'`]?\s*[:=]\s*([0-9]+)/i.exec(candidate);
    if (match) return Number(match[1]);
  }
  return unavailable("ship report does not report review rounds");
}

function formatTokenCount(value) {
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value / 1_000_000)} млн`;
  }
  if (value >= 1_000) {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(
      Math.round(value / 1_000)
    )} тыс.`;
  }
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDuration(milliseconds) {
  const minutes = Math.round(milliseconds / 60000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours} ч ${remainder} мин` : `${remainder} мин`;
}

function shortUnavailable(value) {
  const reason = String(value).replace(/^unavailable:\s*/, "").toLowerCase();
  if (reason.includes("autoreview helper output does not report token usage")) {
    return "н/д (помощник не сообщает учёт)";
  }
  if (reason.includes("no autoreview helper output")) return "н/д (вывод помощника не найден)";
  if (reason.includes("transcript path was not provided")) return "н/д (транскрипт не передан)";
  if (reason.includes("transcript does not exist")) return "н/д (транскрипт не найден)";
  if (reason.includes("no orchestrator turns")) return "н/д (ходы задачи не найдены)";
  if (reason.includes("multi-issue turn")) return "н/д (ход затрагивает несколько задач)";
  if (reason.includes("worker logs contain malformed json or invalid turn usage")) {
    return "н/д (неполные данные в логах)";
  }
  if (reason.includes("ship report does not report review rounds")) {
    return "н/д (отчёт не содержит число)";
  }
  if (reason.includes("non-monotonic")) return "н/д (время записано несогласованно)";
  if (reason.includes("event not found")) return "н/д (событие не записано)";
  if (reason.includes("registry entry was retired")) return "н/д (запись реестра снята)";
  if (reason.includes("registry entry has no") || reason.includes("metadata has no")) {
    return "н/д (метаданные не записаны)";
  }
  return "н/д (данные недоступны)";
}

function compactComponent(value) {
  if (typeof value === "string") return shortUnavailable(value);
  return formatTokenCount(value.non_overlapping_total_tokens);
}

function compactDuration(value) {
  return typeof value === "string" ? shortUnavailable(value) : value.human;
}

function compactModel(model) {
  const modelMissing = typeof model.model === "string" && model.model.startsWith("unavailable:");
  const effortMissing = typeof model.effort === "string" && model.effort.startsWith("unavailable:");
  if (modelMissing && effortMissing) return shortUnavailable(model.model);
  const modelValue = modelMissing ? shortUnavailable(model.model) : model.model;
  const effortValue = effortMissing ? shortUnavailable(model.effort) : model.effort;
  return `${modelValue}/${effortValue}`;
}

function russianLine(result) {
  const totalIsMeasured = result.measurable_total_status === "measured";
  const measured = totalIsMeasured
    ? formatTokenCount(result.measurable_total.non_overlapping_total_tokens)
    : shortUnavailable(result.measurable_total_status);
  const measuredInput = formatTokenCount(result.measurable_total.input_tokens);
  const measuredOutput = formatTokenCount(result.measurable_total.output_tokens);
  const cachedPercent =
    result.measurable_total.input_tokens === 0
      ? 0
      : Math.round(
          (result.measurable_total.cached_input_tokens / result.measurable_total.input_tokens) * 100
        );
  const worker =
    result.worker.usage_status === "measured"
      ? formatTokenCount(result.worker.usage.non_overlapping_total_tokens)
      : shortUnavailable(result.worker.usage_status);
  const autoreview = compactComponent(result.autoreview.usage);
  const orchestrator = compactComponent(
    typeof result.orchestrator.usage === "string"
      ? result.orchestrator.usage
      : result.orchestrator.usage.usage
  );
  const green = compactDuration(result.intervals.dispatch_to_green_pr);
  const merge = compactDuration(result.intervals.dispatch_to_merge);
  const rounds =
    typeof result.review_rounds === "string"
      ? shortUnavailable(result.review_rounds)
      : String(result.review_rounds);
  const model = compactModel(result.model);
  const measuredClause = totalIsMeasured
    ? `${measured} токенов измеримо (вход ${measuredInput}, из кэша ${cachedPercent}%, выход ${measuredOutput})`
    : measured;
  return `Цена волны ${result.issue}: ${measuredClause}; исполнитель ${worker}, авто-ревью ${autoreview}, оркестратор ${orchestrator}; чтение пака ~${formatTokenCount(result.pack_reading.approx_tokens)} токенов; до зелёного PR ${green}, до слияния ${merge}; круги ревью ${rounds}; модель/усилие ${model}; ${PHASE_USAGE_NOTE}.`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolveRoot(args.root, args.issue);
  const logs = attemptLogFiles(root, args.issue);
  if (logs.length === 0) throw new Error(`no attempt logs found for ${args.issue}`);
  const { worker, oldRule, logResults } = collectWorker(root, logs);
  const reports = loadJsonReports(root, args.issue);
  const ledger = ledgerEntries(root, args.issue);
  const autoreview = collectAutoreview(logResults);
  const orchestratorUsage = parseTranscriptUsage(args.orchestratorTranscript, args.issue);
  const orchestrator = {
    ledger_entries: ledger.allIssueLines.length,
    usage: orchestratorUsage,
  };
  const measuredUsage = zeroUsage();
  addUsage(measuredUsage, worker.usage);
  if (typeof autoreview.usage !== "string") addUsage(measuredUsage, autoreview.usage);
  if (typeof orchestratorUsage !== "string") addUsage(measuredUsage, orchestratorUsage.usage);
  const shipReport = latestStageReport(reports, "mono-ship", args.issue);
  const reviewRounds = collectReviewRounds(shipReport);
  const result = {
    schema_version: 1,
    issue: args.issue,
    orchestrator_root: root,
    accounting: {
      rule: "sum every turn.completed usage from every stage and attempt log exactly once; cached input remains a subset of input and is not added again",
      attempt_logs: logs.map((log) => path.relative(root, log.filename)),
    },
    worker,
    accounting_comparison: {
      old_last_event_rule: oldRule,
      corrected_all_turns: worker.usage,
      input_delta_tokens: worker.usage.input_tokens - oldRule.input_tokens,
      explanation:
        "The retired hand-count rule kept only the last turn.completed event of each attempt. These logs report per-turn, not cumulative, usage, so the corrected sum is larger whenever an attempt has more than one completed turn.",
    },
    autoreview,
    orchestrator,
    measurable_total: finalizeUsage(measuredUsage),
    measurable_total_status: worker.complete
      ? "measured"
      : unavailable("worker logs contain malformed JSON or invalid turn usage"),
    pack_reading: collectPackReading(logResults),
    intervals: collectIntervals(ledger, reports, args.issue),
    review_rounds: reviewRounds,
    model: collectModel(root, args.issue, logResults),
    phase_usage_note: PHASE_USAGE_NOTE,
  };
  console.log(JSON.stringify(result, null, 2));
  console.log(russianLine(result));
}

try {
  main();
} catch (error) {
  console.error(`wave-cost: ${error.message}`);
  process.exit(1);
}
