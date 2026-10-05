import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvedLocation } from "../runtime.mjs";

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

function environment(route, source = process.env, { githubToken, timeoutSec = 1800, tempDir } = {}) {
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
  return env;
}

function prepare(route, { cwd, timeoutSec, tempDir }) {
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
  return { githubToken, auth: { requested: "subscription", observed: auth.authMethod, positive: true } };
}

function settings(roots, protectedPaths) {
  validateGrants([...roots, ...protectedPaths]);
  // Edit rules govern every built-in file writer, including Write and NotebookEdit.
  const pattern = value => "/" + value.replace(/[\\*?[\]]/g, "\\$&") + "/**";
  const fallbacks = [path.join("/tmp", temporaryName()), path.join(os.tmpdir(), temporaryName()),
    "/tmp/claude", "/private/tmp/claude", path.join(os.homedir(), ".npm/_logs"),
    path.join(os.homedir(), ".claude/debug")].map(resolvedLocation);
  const denied = [...new Set([...protectedPaths, ...fallbacks.filter(directory =>
    !roots.some(root => directory === root || directory.startsWith(root + path.sep)))])];
  return {
    permissions: {
      defaultMode: "dontAsk",
      disableBypassPermissionsMode: "disable",
      allow: roots.map(root => "Edit(" + pattern(root) + ")"),
      deny: ["WebFetch", "WebSearch", ...denied.map(root => "Edit(" + pattern(root) + ")")],
    },
    sandbox: {
      enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
      filesystem: { allowWrite: roots, denyWrite: denied },
      credentials: { envVars: [{ name: "GH_TOKEN", mode: "mask", injectHosts: githubDomains }] },
      network: { allowedDomains: githubDomains, tlsTerminate: {},
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
  return state.identity && state.response;
}

export const claudeCli = Object.freeze({
  transport: "claude-cli", workerRoles: Object.freeze(["worker-claude"]), complexRole: null,
  handshakeModes: Object.freeze(["resume"]), correlatesReports: false, logLiveness: false,
  journalRunner: "scripts/transports/claude-runner.mjs",
  startupTimeoutMs: 120_000,
  validateRoute, validateGrants, temporaryDirectory, environment, prepare, settings, invocation, startIdentity, startupEvent,
});
