import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { resolvedLocation } from "../runtime.mjs";
import { readJsonLines } from "./journal.mjs";
import { zeroUsage, addUsage, finalizeUsage } from "../token-usage.mjs";

const tools = Object.freeze(["Bash", "Read", "Edit", "Write", "NotebookEdit", "Glob", "Grep"]);
const networkPolicy = Object.freeze({ Bash: "sandbox-allowlist", WebFetch: "deny", WebSearch: "deny" });
const environmentKeys = ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM"];
const githubDomains = Object.freeze(["github.com", "api.github.com", "uploads.github.com", "raw.githubusercontent.com"]);
const temporaryName = () => process.platform === "win32" ? "claude" : "claude-" + process.getuid();
const maximumTemporaryPathBytes = 44;

function validateGrants(roots) {
  if (roots.some(root => /[*?\[\]]/.test(root)))
    throw new Error("Claude sandbox paths cannot contain glob characters; use literal pinned paths and retry");
}

function temporaryDirectory(roots) {
  // The observed Unix backend switches Bash to a system-temp fallback above
  // 44 bytes. Refuse when no granted root avoids that implicit expansion.
  const candidates = roots.filter(root => process.platform === "win32" || Buffer.byteLength(path.join(root, temporaryName())) <= maximumTemporaryPathBytes);
  candidates.sort((a, b) => a.length - b.length);
  if (!candidates.length) throw new Error("Claude requires a short pinned temporary directory; grant a short scratch path and retry");
  return candidates[0];
}

function validateRoute(route) {
  if (route?.engine !== "claude" || route.provider?.id !== "anthropic" ||
      route.provider.endpoint !== null || route.credentialEnv !== null)
    throw new Error("claude-cli requires the native Anthropic subscription route without endpoint or credentialEnv; repair worker-claude on BASE");
}

function assertStopped(entry) {
  const group = entry.processGroup ?? entry.pid;
  if (!Number.isSafeInteger(group) || group <= 0) throw new Error("Claude process group missing; reconcile the previous worker before resume");
  try { process.kill(-group, 0); }
  catch (error) { if (error.code === "ESRCH") return; throw error; }
  throw new Error("Claude worker process group is still live; stop the previous worker and its commands before resume");
}

function environment(route, source = process.env, { githubToken, githubConfigDir, timeoutSec = 1800, tempDir } = {}) {
  validateRoute(route);
  const env = Object.fromEntries(environmentKeys.filter(key => typeof source[key] === "string").map(key => [key, source[key]]));
  env.USER ||= os.userInfo().username;
  if (tempDir) {
    env.TMPDIR = tempDir;
    env.CLAUDE_CODE_TMPDIR = tempDir;
  }
  env.BASH_MAX_TIMEOUT_MS = String((timeoutSec + 600) * 1000);
  env.BASH_DEFAULT_TIMEOUT_MS = env.BASH_MAX_TIMEOUT_MS;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  env.CLAUDE_CODE_DISABLE_CLAUDE_AI_MCP = "1";
  if (githubToken) env.GH_TOKEN = githubToken;
  if (githubConfigDir) env.GH_CONFIG_DIR = githubConfigDir;
  return env;
}

function githubCredentialPaths(source = process.env, cwd = process.cwd()) {
  // gh may keep its token in hosts.yml rather than the system credential store.
  // Protect every applicable config source, including a symlinked token file.
  const directories = [path.resolve(cwd, source.HOME || os.homedir(), ".config/gh")];
  if (source.GH_CONFIG_DIR) directories.push(path.resolve(cwd, source.GH_CONFIG_DIR));
  if (source.XDG_CONFIG_HOME) directories.push(path.resolve(cwd, source.XDG_CONFIG_HOME, "gh"));
  if (process.platform === "win32" && source.AppData) directories.push(path.resolve(cwd, source.AppData, "GitHub CLI"));
  const paths = [...new Set(directories.flatMap(directory => [directory, path.join(directory, "hosts.yml")])
    .flatMap(value => [value, resolvedLocation(value)]))];
  validateGrants(paths);
  return paths;
}

function githubConfiguration(roots, tempDir, credentialPaths, existing) {
  let directory = existing;
  const allowed = value => roots.some(root => value === root || value.startsWith(root + path.sep));
  const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
  try {
    const parent = resolvedLocation(directory ? path.dirname(directory) : tempDir);
    if (!allowed(parent) || credentialPaths.some(value => parent === value || parent.startsWith(value + path.sep)))
      throw new Error("ungranted configuration parent");
    if (!directory) directory = fs.mkdtempSync(path.join(parent, "mono-gh-"));
    const actual = resolvedLocation(directory);
    if (!allowed(actual) || credentialPaths.some(value => overlaps(actual, value))) throw new Error("credential source overlap");
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (process.getuid && stat.uid !== process.getuid())) throw new Error("configuration directory is not private");
    fs.chmodSync(directory, 0o700);
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    return actual;
  } catch { throw new Error("GitHub private configuration directory unavailable within pinned grants; repair the attempt configuration path and retry"); }
}

function prepare(route, { cwd, timeoutSec, tempDir, roots, githubConfigDir, previousCredentialPaths = [] }) {
  const credentialPaths = [...new Set([...previousCredentialPaths, ...githubCredentialPaths(process.env, cwd)])];
  githubConfigDir = githubConfiguration(roots, tempDir, credentialPaths, githubConfigDir);
  const env = environment(route, process.env, { timeoutSec, tempDir });
  // Claude appends this directory and implicitly permits sandbox writes there.
  // Prepare it before launch so an unusable path cannot trigger an outside fallback.
  const temporary = path.join(tempDir, temporaryName());
  try {
    fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
    const base = fs.realpathSync(tempDir), actual = fs.realpathSync(temporary);
    if (!actual.startsWith(base + path.sep)) throw new Error("temporary directory escapes grants");
    fs.accessSync(temporary, fs.constants.W_OK | fs.constants.X_OK);
  } catch { throw new Error("Claude internal temporary directory unavailable within pinned grants; repair the granted temporary path and retry"); }
  let auth;
  try {
    auth = JSON.parse(execFileSync("claude", ["--setting-sources", "", "auth", "status", "--json"],
      { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("claude-cli unavailable; install Claude Code and retry (no version check)");
    throw new Error("Claude subscription login not confirmed; run claude auth login and retry");
  }
  if (auth.loggedIn !== true || auth.authMethod !== "claude.ai" || auth.apiProvider !== "firstParty" ||
      !["pro", "max", "team", "enterprise"].includes(auth.subscriptionType))
    throw new Error("Claude subscription login not confirmed; run claude auth login with a subscription and retry");
  let githubToken;
  try {
    githubToken = execFileSync("gh", ["auth", "token", "--hostname", "github.com"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
  } catch { throw new Error("GitHub login unavailable outside the worker sandbox; run gh auth login and retry"); }
  if (!githubToken) throw new Error("GitHub login unavailable; run gh auth login and retry");
  return { githubToken, githubConfigDir, credentialPaths, auth: { requested: "subscription", observed: auth.authMethod, positive: true } };
}

function settings(roots, protectedPaths, credentialPaths) {
  if (!Array.isArray(credentialPaths) || !credentialPaths.length)
    throw new Error("GitHub credential source protections missing; prepare subscription launch again");
  validateGrants([...roots, ...protectedPaths, ...credentialPaths]);
  // Edit rules govern every built-in file writer, including Write and NotebookEdit.
  const absolute = value => "/" + value.replace(/[\\*?[\]]/g, "\\$&");
  const pattern = value => absolute(value) + "/**";
  const fallbacks = [path.join("/tmp", temporaryName()), path.join(os.tmpdir(), temporaryName()),
    "/tmp/claude", "/private/tmp/claude", path.join(os.homedir(), ".npm/_logs"),
    path.join(os.homedir(), ".claude/debug")].map(resolvedLocation);
  const denied = [...new Set([...protectedPaths, ...credentialPaths, ...fallbacks.filter(directory =>
    !roots.some(root => directory === root || directory.startsWith(root + path.sep)))])];
  return {
    permissions: {
      defaultMode: "dontAsk",
      disableBypassPermissionsMode: "disable",
      allow: roots.map(root => "Edit(" + pattern(root) + ")"),
      deny: ["WebFetch", "WebSearch", ...denied.map(root => "Edit(" + pattern(root) + ")"),
        ...credentialPaths.flatMap(value => ["Read(" + absolute(value) + ")", "Read(" + pattern(value) + ")",
          "Edit(" + absolute(value) + ")"])],
    },
    sandbox: {
      enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
      filesystem: { allowWrite: roots, denyWrite: denied, denyRead: credentialPaths },
      network: { allowedDomains: githubDomains,
        strictAllowlist: true, allowAllUnixSockets: false, allowUnixSockets: [], allowLocalBinding: false,
        allowMachLookup: ["com.apple.trustd", "com.apple.trustd.agent"] },
    },
    disableAllHooks: true,
    disableClaudeAiConnectors: true,
    enableAllProjectMcpServers: false,
    enabledPlugins: {},
  };
}

function invocation(entry, { prompt, resume }) {
  const args = ["--print", "--verbose", "--output-format", "stream-json", "--input-format", "text",
    resume ? "--resume" : "--session-id", entry.thread_id,
    "--model", entry.model_launch.model_parameter, "--effort", entry.model_launch.effort_parameter,
    "--permission-mode", "dontAsk", "--settings", entry.settingsFile, "--setting-sources", "",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-chrome",
    "--tools", tools.join(","), "--disallowedTools", "WebFetch,WebSearch"];
  return { command: "claude", args, stdin: prompt };
}

function startIdentity(event) {
  if (event?.type !== "system" || event.subtype !== "init") return null;
  return { thread_id: event.session_id, model: event.model, permissionMode: event.permissionMode,
    apiKeySource: event.apiKeySource, mcp_servers: event.mcp_servers, tools: event.tools };
}
function startupEvent(event, entry, state) {
  if (event?.type === "mono.worker-instance") {
    const mismatch = ["issue", "attempt", "thread_id", "pid"].filter(key => event[key] !== entry[key]);
    if (typeof event.procStart !== "string" || !event.procStart) mismatch.push("procStart");
    if (mismatch.length) throw new Error("Claude journal process identity differs from the launch (" + mismatch.join(", ") + "); inspect retained attempt");
    state.procStart = event.procStart;
  }
  const identity = startIdentity(event);
  if (identity) {
    state.identity = identity;
    if (identity.thread_id !== entry.thread_id) throw new Error("Claude startup session differs from pinned session; inspect retained attempt and retry");
    if (identity.model !== entry.model_launch.model_parameter) throw new Error("Claude startup model differs from requested model; repair the model route and retry");
    if (identity.permissionMode !== "dontAsk") throw new Error("Claude startup permission mode not dontAsk; inspect managed settings");
    if (identity.apiKeySource !== "none") throw new Error("Claude startup is not the confirmed subscription route; run claude auth login");
    if (!Array.isArray(identity.mcp_servers) || identity.mcp_servers.length)
      throw new Error("Claude startup connectors are not empty; inspect strict MCP configuration");
    if (!Array.isArray(identity.tools) || tools.some(tool => !identity.tools.includes(tool)) || identity.tools.some(tool => !tools.includes(tool) ||
        (Object.hasOwn(networkPolicy, tool) && networkPolicy[tool] !== "sandbox-allowlist")))
      throw new Error("Claude startup tool has no permitted network policy; inspect the managed tool list");
  }
  if (event?.type === "result" && event.is_error === true)
    throw new Error("Claude startup response failed; inspect retained logs and run claude auth login if login failed");
  if (event?.type === "assistant" && event.session_id === entry.thread_id && state.identity &&
      event.message?.model === entry.model_launch.model_parameter && event.is_error !== true &&
      !event.error && !event.message.error && Array.isArray(event.message.content) && event.message.content.length)
    state.response = true;
  return state.identity && state.response && state.procStart;
}

const currentLogs = new Map();
const currentLogLimit = 64;

function reduceCurrent(state, event) {
  if (event?.type === "mono.worker-instance") {
    state.instance = event; state.invalid = false; state.calls.clear(); state.result = null; return;
  }
  if (event?.session_id && event.session_id !== state.instance?.thread_id) return;
  if (event?.type === "result" || (event?.type === "system" && event.subtype === "init")) {
    state.calls.clear(); state.result = event.type === "result" ? event : null;
  }
  if (event?.type === "system" && event.subtype === "permission_denied") {
    if (event.tool_use_id) state.calls.delete(event.tool_use_id); else state.calls.clear();
  }
  for (const item of event?.message?.content ?? []) {
    if (item.type === "tool_result") state.calls.delete(item.tool_use_id);
    if (event.type === "assistant" && event.session_id === state.instance?.thread_id && item.type === "tool_use" &&
        item.name === "Bash" && typeof item.id === "string" && item.id) state.calls.set(item.id, item.input);
  }
}

function currentState(entry) {
  let fd;
  try {
    fd = fs.openSync(entry.log, "r");
    const stat = fs.fstatSync(fd);
    let state = currentLogs.get(entry.log);
    // Verify the consumed boundary as well as inode/size: truncation followed
    // by regrowth must not reuse outstanding calls from the replaced content.
    const boundary = state && Buffer.alloc(state.boundary.length);
    const intact = state && stat.size >= state.offset &&
      fs.readSync(fd, boundary, 0, boundary.length, state.offset - boundary.length) === boundary.length && boundary.equals(state.boundary);
    if (!state || state.dev !== stat.dev || state.ino !== stat.ino || !intact) {
      state = { dev: stat.dev, ino: stat.ino, offset: 0, boundary: Buffer.alloc(0), pending: "",
        decoder: new StringDecoder("utf8"), instance: null, invalid: false, calls: new Map(), result: null };
    }
    currentLogs.delete(entry.log);
    currentLogs.set(entry.log, state);
    while (currentLogs.size > currentLogLimit) currentLogs.delete(currentLogs.keys().next().value);
    const buffer = Buffer.alloc(64 * 1024);
    while (state.offset < stat.size) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - state.offset), state.offset);
      if (!count) break;
      state.offset += count;
      state.boundary = Buffer.from(Buffer.concat([state.boundary, buffer.subarray(0, count)]).subarray(-64));
      state.pending += state.decoder.write(buffer.subarray(0, count));
      let newline;
      while ((newline = state.pending.indexOf("\n")) >= 0) {
        const line = state.pending.slice(0, newline); state.pending = state.pending.slice(newline + 1);
        if (!line.trim()) continue;
        try { reduceCurrent(state, JSON.parse(line)); } catch { state.invalid = true; }
      }
    }
    const instance = state.instance;
    if (state.invalid || state.pending.trim() || state.decoder.lastNeed || state.offset !== stat.size || !instance ||
        ["issue", "attempt", "thread_id", "pid", "procStart"].some(key => instance[key] !== entry[key]) ||
        !entry.thread_id || !entry.procStart || !Number.isInteger(entry.pid)) return null;
    return state;
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function waitingPhase(entry, reportFile, confirmationFile) {
  const calls = new Map();
  for (const [id, input] of currentState(entry)?.calls ?? []) {
    const command = input?.command;
    // Plain foreground invocation only. Shell control operators, substitutions
    // and wrapper commands cannot prove that this call blocks the worker.
    if (input?.run_in_background === true || typeof command !== "string" || /[;&|`\n\r$<>]/.test(command)) continue;
    const tokens = command.match(/'[^']*'|"[^"]*"|[^\s'"]+/g)?.map(token => token.replace(/^(['"])(.*)\1$/, "$2")) ?? [];
    if (tokens[0] !== "node" || !entry.packRoot || tokens[1] !== path.join(entry.packRoot, "scripts/delivery-state.mjs") || tokens[2] !== "wait") continue;
    const flags = new Map(); let valid = true;
    for (let i = 3; i < tokens.length; i += 2) {
      if (!["--report", "--confirmation", "--config"].includes(tokens[i]) || !tokens[i + 1] || flags.has(tokens[i])) { valid = false; break; }
      flags.set(tokens[i], tokens[i + 1]);
    }
    if (valid && flags.get("--report") === reportFile && flags.get("--confirmation") === confirmationFile)
      calls.set(id, { callId: id, issue: entry.issue, attempt: entry.attempt,
        thread_id: entry.thread_id, pid: entry.pid, procStart: entry.procStart });
  }
  return [...calls.values()].at(-1) ?? null;
}

function turnState(entry) {
  const result = currentState(entry)?.result;
  if (result?.session_id !== entry.thread_id) return null;
  return result ? { status: result.is_error === true ? "failed" : "completed", session: entry.thread_id } : null;
}

function attemptUsage(parsed, source) {
  const total = zeroUsage(), errors = [...parsed.errors];
  let turns = 0, lastUsage = null, unfinished = false, interrupted = false, awaitingInit = false;
  for (const { value, line } of parsed.events) {
    if (value.type === "mono.worker-instance") {
      if (unfinished) interrupted = true;
      unfinished = true; awaitingInit = true;
    }
    if (value.type === "system" && value.subtype === "init") {
      if (unfinished && !awaitingInit) interrupted = true;
      unfinished = true; awaitingInit = false;
    }
    if (["assistant", "user", "tool_progress"].includes(value.type)) unfinished = true;
    if (value.type !== "result") continue;
    unfinished = false; awaitingInit = false;
    const raw = value.usage;
    if (["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"].some(key =>
      !Number.isSafeInteger(raw?.[key]) || raw[key] < 0)) {
      errors.push(`${source}:${line}: missing or invalid result usage`); continue;
    }
    // Execution crashes can zero every counter; budget errors omit the response
    // crossing the cap. Neither result proves complete usage, even after resume.
    if (["error_during_execution", "error_max_budget_usd"].includes(value.subtype)) {
      interrupted = true;
      if (Object.values(raw).every(count => count === 0)) continue;
    }
    const usage = { ...zeroUsage(), input_tokens: raw.input_tokens + raw.cache_creation_input_tokens + raw.cache_read_input_tokens,
      cached_input_tokens: raw.cache_read_input_tokens, cache_write_input_tokens: raw.cache_creation_input_tokens, output_tokens: raw.output_tokens };
    if (!Number.isSafeInteger(usage.input_tokens)) { errors.push(`${source}:${line}: invalid input total`); continue; }
    addUsage(total, usage); lastUsage = usage; turns++;
  }
  const status = errors.length ? "unavailable: worker logs contain malformed JSON or invalid turn usage"
    : unfinished || interrupted ? "incomplete: attempt contains interrupted or incomplete turn usage"
    : turns ? "measured" : "unavailable: worker log contains no usage events";
  return { usage: turns ? finalizeUsage(total) : null, lastUsage, turns, status, complete: status === "measured", errors };
}

function readingInputs(event) {
  if (event.type !== "assistant") return null;
  const inputs = [];
  for (const item of event.message?.content ?? []) {
    if (item.type !== "tool_use") continue;
    if (["Read", "Glob", "Grep"].includes(item.name)) inputs.push(...Object.values(item.input ?? {}).filter(value => typeof value === "string"));
    if (item.name === "Bash" && /(?:^|\s)(?:cat|head|tail|sed|rg|grep)(?:\s|$)/.test(item.input?.command ?? "")) inputs.push(item.input.command);
  }
  return inputs.length ? inputs : null;
}

function commandOutput(event) {
  if (event.type !== "user") return null;
  const results = (event.message?.content ?? []).filter(item => item.type === "tool_result");
  return results.length ? results.map(item => typeof item.content === "string" ? item.content
    : (item.content ?? []).map(block => block.text ?? "").join("\n")).join("\n") : null;
}

export const claudeCli = Object.freeze({
  transport: "claude-cli", workerRoles: Object.freeze(["worker-claude"]), complexRole: null,
  handshakeModes: Object.freeze(["resume"]), correlatesReports: true, logLiveness: true,
  deliveryDifferences: Object.freeze(["Start acknowledgement stops the worker; the orchestrator applies/read-backs moves and resumes the same session.",
    "Pre-PR review uses external collection on committed heads only; no in-worker review pass."]),
  waitingPhase, turnState, activityTime: stat => stat.mtimeMs, readLog: readJsonLines, attemptUsage, readingInputs, commandOutput,
  modelMetadata: (event, source) => event.type === "mono.launch" ? { model: event.model, effort: event.effort, source }
    : startIdentity(event) ? { model: event.model, effort: "unavailable: effort is requested, not observed", source } : null,
  journalRunner: "scripts/transports/claude-runner.mjs",
  startupTimeoutMs: 120_000,
  validateRoute, assertStopped, validateGrants, temporaryDirectory, githubCredentialPaths, environment, prepare, settings, invocation, startIdentity, startupEvent,
});
