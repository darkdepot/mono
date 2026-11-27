import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// MONO-509: which Linear a codex-cli worker writes through, decided before the attempt is registered.
// mcp: the user's `linear` MCP server (enabled, authorized): grants go to it and built-in apps stay off (MONO-460).
// app: else Codex's built-in Linear app connector, found in Codex's apps tool cache with both write tools: apps stay on
// and only those two tools are pre-approved. Neither: the launch refuses and no attempt is spent.
// MONO_CODEX_PROBE_BIN replaces the `codex` used for the probe (fixtures); CODEX_HOME locates config.toml and the cache.
export const LINEAR_APP_WRITE_TOOLS = Object.freeze(["linear.save_comment", "linear.save_issue"]);
const DEFAULT_TITLES = Object.freeze({ "linear.save_comment": "Save comment", "linear.save_issue": "Save issue" });
// Authorized: OAuth login, a bearer token, or a server that needs no auth (stdio). Anything else is not authorized.
const AUTHORIZED = new Set(["o_auth", "bearer_token", "unsupported"]);
const CONNECTOR_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PROBE_TIMEOUT_MS = 20_000;

function probe(bin, args, env, cwd) {
  try {
    return { ok: true, stdout: execFileSync(bin, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: PROBE_TIMEOUT_MS }) };
  } catch (error) { return { ok: false, error: String(error.stderr || error.message).trim().split("\n")[0] }; }
}

// A minimal TOML reader for config.toml: dotted keys (quoted parts stay whole), strings, booleans, numbers, simple
// arrays and inline tables, flattened to path → value. A value it cannot read is recorded under its path as UNREADABLE.
const UNREADABLE = Symbol("unreadable");
function keyParts(text) {
  const parts = [];
  for (const match of String(text).matchAll(/\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(?:\.|$)/g))
    parts.push(match[1] ?? match[2] ?? match[3]);
  return parts;
}
function readValue(text, at) {
  const skip = () => { while (/\s/.test(text[at] ?? "")) at++; };
  skip();
  const rest = text.slice(at);
  let match;
  if ((match = rest.match(/^"((?:[^"\\]|\\.)*)"/))) return { value: match[1], at: at + match[0].length };
  if ((match = rest.match(/^'([^']*)'/))) return { value: match[1], at: at + match[0].length };
  if ((match = rest.match(/^(true|false)(?![A-Za-z0-9_-])/))) return { value: match[1] === "true", at: at + match[0].length };
  if ((match = rest.match(/^[+-]?[0-9][0-9_.eE+-]*/))) return { value: Number(match[0].replaceAll("_", "")), at: at + match[0].length };
  if (text[at] === "[") {
    const items = []; at++;
    for (;;) {
      skip();
      if (text[at] === "]") return { value: items, at: at + 1 };
      const item = readValue(text, at); if (!item) return null;
      items.push(item.value); at = item.at; skip();
      if (text[at] === ",") at++; else if (text[at] !== "]") return null;
    }
  }
  if (text[at] === "{") {
    const table = []; at++;
    for (;;) {
      skip();
      if (text[at] === "}") return { value: { table }, at: at + 1 };
      const key = text.slice(at).match(/^((?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)(?:\s*\.\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+))*)\s*=/);
      if (!key) return null;
      const item = readValue(text, at + key[0].length); if (!item) return null;
      table.push([keyParts(key[1]), item.value]); at = item.at; skip();
      if (text[at] === ",") at++; else if (text[at] !== "}") return null;
    }
  }
  return null;
}
function flatten(values, prefix, value) {
  if (value && typeof value === "object" && Array.isArray(value.table)) for (const [key, item] of value.table) flatten(values, [...prefix, ...key], item);
  else values.set(prefix.join("\u0000"), value);
}
export function configValues(text) {
  const values = new Map();
  let table = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[\[?(.+?)\]\]?\s*(?:#.*)?$/);
    if (header) { table = keyParts(header[1]); continue; }
    const pair = line.match(/^((?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)(?:\s*\.\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+))*)\s*=(.*)$/);
    if (!pair) { values.set([...table, "?"].join("\u0000"), UNREADABLE); continue; }
    const key = [...table, ...keyParts(pair[1])], read = readValue(pair[2], 0);
    if (!read || !/^\s*(?:#.*)?$/.test(pair[2].slice(read.at))) values.set(key.join("\u0000"), UNREADABLE);
    else flatten(values, key, read.value);
  }
  return values;
}

// Only the most recently written cache file is the active identity's; both write tools must be in that one file.
function linearConnectors(codexHome) {
  const directory = path.join(codexHome, "cache", "codex_apps_tools"), found = new Map();
  let newest = null;
  try {
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".json"))) {
      const mtime = fs.statSync(path.join(directory, name)).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { name, mtime };
    }
  } catch { return found; }
  if (!newest) return found;
  let tools; try { tools = JSON.parse(fs.readFileSync(path.join(directory, newest.name), "utf8")).tools; } catch { return found; }
  for (const item of Array.isArray(tools) ? tools : []) {
    if (item?.connector_name !== "Linear" || typeof item.connector_id !== "string" || typeof item.tool?.name !== "string") continue;
    if (!found.has(item.connector_id)) found.set(item.connector_id, new Map());
    found.get(item.connector_id).set(item.tool.name, typeof item.tool.title === "string" ? item.tool.title : null);
  }
  return found;
}
function mcpState(bin, env, cwd) {
  const listed = probe(bin, ["mcp", "list", "--json"], env, cwd);
  if (!listed.ok) return { error: `codex mcp list failed: ${listed.error}` };
  let servers; try { servers = JSON.parse(listed.stdout); } catch { return { error: "codex mcp list returned no JSON" }; }
  const server = Array.isArray(servers) ? servers.find(item => item?.name === "linear") : null;
  if (!server) return { usable: false, absent: true, present: false };
  if (server.enabled === false) return { usable: false, present: true, disabled: `mcp_servers.linear is disabled${server.disabled_reason ? ` (${server.disabled_reason})` : ""}` };
  if (!AUTHORIZED.has(server.auth_status)) return { usable: false, present: true, unauthorized: String(server.auth_status ?? "unknown") };
  return { usable: true, present: true };
}
function appState(bin, env, cwd, codexHome) {
  const connectors = linearConnectors(codexHome);
  const complete = [...connectors].filter(([, tools]) => LINEAR_APP_WRITE_TOOLS.every(tool => tools.has(tool))).map(([id]) => id);
  if (!complete.length) return { usable: false, absent: true };
  if (complete.length > 1) return { usable: false, absent: true, note: `several Linear app connectors in the cache (${complete.join(", ")})` };
  const id = complete[0];
  if (!CONNECTOR_ID.test(id)) return { usable: false, absent: true, note: `unexpected Linear connector id ${JSON.stringify(id)}` };
  const features = probe(bin, ["features", "list"], env, cwd);
  if (!features.ok) return { error: `codex features list failed: ${features.error}` };
  const apps = features.stdout.split("\n").map(line => line.trim().split(/\s+/)).find(cells => cells[0] === "apps");
  if (!apps || apps.at(-1) !== "true") return { usable: false, disabled: "features.apps is off while the Linear app connector is present" };
  let config = new Map();
  try { config = configValues(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8")); } catch {}
  for (const [key, value] of config)
    if (value === UNREADABLE && key.split("\u0000")[0] === "apps") return { usable: false, disabled: `config.toml has an apps setting Mono cannot read (${key.replaceAll("\u0000", ".")})` };
  const get = (...parts) => config.get(parts.join("\u0000"));
  // A per-app setting wins over apps._default, in both directions.
  const setting = name => get("apps", id, name) ?? get("apps", "_default", name);
  if (setting("enabled") === false) return { usable: false, disabled: `apps.${get("apps", id, "enabled") === false ? id : "_default"}.enabled = false turns the Linear app off` };
  if (setting("destructive_enabled") === false) return { usable: false, disabled: "destructive_enabled = false (save_comment and save_issue are destructive)" };
  if (setting("open_world_enabled") === false) return { usable: false, disabled: "open_world_enabled = false turns off the Linear app's write tools" };
  const tools = connectors.get(id);
  for (const tool of LINEAR_APP_WRITE_TOOLS) {
    const keys = [...new Set([tool, tools.get(tool) ?? DEFAULT_TITLES[tool], DEFAULT_TITLES[tool]])];
    const own = keys.map(key => get("apps", id, "tools", key, "enabled")).find(value => value !== undefined);
    if (own === false) return { usable: false, disabled: `apps.${id}.tools."${keys.find(key => get("apps", id, "tools", key, "enabled") === false)}".enabled = false` };
    if (own !== true && setting("default_tools_enabled") === false) return { usable: false, disabled: `default_tools_enabled = false leaves ${tool} off` };
  }
  return { usable: true, connectorId: id };
}

// The Linear write path for a launch or resume, probed as the worker would run (cwd = its worktree). `recorded` (the path
// a running attempt launched with) is kept: a resume never switches paths and refuses when its own path is gone.
// An app path notes whether a linear MCP server exists, so the worker turns it off. Throws "linear-unavailable: ...".
export function resolveLinearPath({ env = process.env, recorded = null, cwd = process.cwd() } = {}) {
  const bin = env.MONO_CODEX_PROBE_BIN || "codex";
  const codexHome = env.CODEX_HOME ? path.resolve(cwd, env.CODEX_HOME) : path.join(os.homedir(), ".codex");
  const probeEnv = { ...env }; delete probeEnv.MONO_ATTEMPT; delete probeEnv.MONO_CODEX_PROBE_BIN;
  const mcp = mcpState(bin, probeEnv, cwd);
  if (mcp.error) throw new Error(`linear-unavailable: cannot read the Codex Linear setup: ${mcp.error}`);
  // The app is looked at only when the MCP server cannot serve (or the attempt launched through the app).
  const app = (recorded ? recorded.kind === "app" : !mcp.usable) ? appState(bin, probeEnv, cwd, codexHome) : null;
  if (app?.error) throw new Error(`linear-unavailable: cannot read the Codex Linear setup: ${app.error}`);
  const appPath = () => ({ kind: "app", connectorId: app.connectorId, ...(mcp.present ? { mcpServerPresent: true } : {}) });
  if (recorded) {
    if (recorded.kind !== "app" && mcp.usable) return { kind: "mcp" };
    if (recorded.kind === "app" && app.usable && app.connectorId === recorded.connectorId) return appPath();
    throw new Error(`linear-unavailable: this attempt writes Linear through the ${recorded.kind === "app" ? `Linear app ${recorded.connectorId}` : "linear MCP server"}, ` +
      `which is no longer usable${refusalTail(mcp, app ?? {})}; restore it and resume, or start a new attempt`);
  }
  if (mcp.usable) return { kind: "mcp" };
  if (app.usable) return appPath();
  const disabled = [mcp.disabled, app.disabled].filter(Boolean);
  if (disabled.length) throw new Error(`linear-unavailable: Linear writes disabled by Codex config: ${disabled.join("; ")}`);
  if (mcp.unauthorized) throw new Error(`linear-unavailable: Linear not authorized: the linear MCP server reports auth ${mcp.unauthorized} (codex mcp login linear) and there is no built-in Linear app`);
  throw new Error(`linear-unavailable: no Linear connection in Codex: neither a linear MCP server nor the built-in Linear app with save_comment and save_issue${app.note ? ` (${app.note})` : ""}`);
}
function refusalTail(mcp, app) {
  const why = [mcp.disabled, mcp.unauthorized && `the linear MCP server reports auth ${mcp.unauthorized}`, mcp.absent && "no linear MCP server",
    app.disabled, app.note].filter(Boolean);
  return why.length ? ` (${why.join("; ")})` : "";
}

// Codex died parsing its config before any thread: the launch environment, not the work (MONO-509).
export function configParseDeath(log) {
  try {
    const stderr = fs.readFileSync(log.replace(/\.jsonl$/, ".stderr.log"), "utf8");
    if (!/Error loading config\.toml/.test(stderr)) return false;
    return !fs.readFileSync(log, "utf8").split("\n").some(line => { try { return JSON.parse(line).type === "thread.started"; } catch { return false; } });
  } catch { return false; }
}
