import fs from "node:fs";
import path from "node:path";
import { reviewEnvironment } from "../model-environment.mjs";
import { zeroUsage, addUsage, finalizeUsage } from "../token-usage.mjs";

const unavailable = reason => `unavailable: ${reason}`;

function environment(route, source = process.env) {
  const env = { ...source };
  if (route?.credentialEnv || route?.provider.endpoint) {
    for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY']) delete env[key];
    const credential = route.credentialEnv ? { [route.credentialEnv]: source[route.credentialEnv] } : {};
    Object.assign(env, reviewEnvironment(route, credential));
  }
  return env;
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

function issueKeysIn(value, issue) {
  const prefix = issue.slice(0, issue.lastIndexOf("-"));
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(^|[^A-Z0-9])(${escapedPrefix}-[1-9][0-9]*)(?![A-Z0-9])`,
    "g"
  );
  return new Set([...String(value).matchAll(pattern)].map((match) => match[2]));
}

function stringsIn(value, collected = []) {
  if (typeof value === "string") collected.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, collected);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) stringsIn(item, collected);
  }
  return collected;
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

function startIdentity(event) {
  if (event.type !== "thread.started" || typeof event.thread_id !== "string" || !event.thread_id) return null;
  return { thread_id: event.thread_id };
}

function invocation(entry, { reportsDir, roots, prompt, resume }) {
  const model = entry.model_launch.model_parameter, effort = entry.model_launch.effort_parameter;
  const args = resume ? ["exec", "resume", entry.thread_id, "--json"] : ["exec", "--json", "--cd", entry.worktree];
  if (!resume) args.push("--add-dir", reportsDir);
  args.push("-c", `model=${JSON.stringify(model)}`, "-c", `model_reasoning_effort=${JSON.stringify(effort)}`,
    "-c", 'sandbox_mode="workspace-write"', "-c", `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`,
    "-c", `sandbox_workspace_write.network_access=${entry.network_access === true}`, prompt);
  return { command: "codex", args };
}

function waitingCommand(entry, issue, attempt) {
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

function attemptUsage(parsed, source) {
  const usage = zeroUsage(), errors = [];
  let turns = 0, lastUsage = null, unfinished = false, interrupted = false;
  for (const { value, line } of parsed.events) {
    if (["thread.started", "turn.started"].includes(value?.type) && unfinished) interrupted = true;
    if (value?.type === "turn.failed") interrupted = true;
    if (["turn.started", "turn.failed", "item.started", "error"].includes(value?.type)) unfinished = true;
    if (value?.type !== "turn.completed") continue;
    unfinished = false;
    const measured = normalizedUsage(value.usage, `${source}:${line}`, errors);
    if (!measured) continue;
    addUsage(usage, measured);
    lastUsage = measured;
    turns += 1;
  }
  errors.push(...parsed.errors.map(error => `${source}:${error}`));
  const status = errors.length ? unavailable("worker logs contain malformed JSON or invalid turn usage")
    : unfinished || interrupted ? "incomplete: attempt interrupted before final usage"
    : turns === 0 ? unavailable("worker log contains no usage events") : "measured";
  return { usage: turns ? finalizeUsage(usage) : null, lastUsage, turns, status, complete: status === "measured", errors };
}

function transcriptUsage(parsed, issue, resolved) {
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

function modelMetadata(value, source) {
  if (!["thread.started", "mono.launch"].includes(value?.type)) return null;
  const model = value.model ?? value.usage?.model;
  const effort = value.effort ?? value.model_reasoning_effort ?? value.usage?.effort;
  if (model || effort) {
    return {
      model: model ?? unavailable("thread.started metadata has no model"),
      effort: effort ?? unavailable("thread.started metadata has no effort"),
      source,
    };
  }
  return null;
}

export const codexCli = Object.freeze({
  transport: "codex-cli",
  workerRoles: Object.freeze(["worker-default", "worker-complex"]),
  complexRole: "worker-complex",
  handshakeModes: Object.freeze(["wait", "resume"]),
  correlatesReports: true,
  logLiveness: true,
  environment,
  invocation,
  startIdentity,
  waitingCommand,
  activityTime: stat => stat.mtimeMs,
  readLog: safeJsonLines,
  attemptUsage,
  transcriptUsage,
  modelMetadata,
  readingInputs: event => isReadEvent(event) ? readInputs(event) : null,
  commandOutput: event => event?.type === "item.completed" && event.item?.type === "command_execution"
    ? String(event.item.aggregated_output || "") : null,
});
