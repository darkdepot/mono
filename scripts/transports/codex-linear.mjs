import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// MONO-509: which Linear a codex-cli worker writes through, decided before the attempt is registered.
// mcp: the user's `linear` MCP server (enabled, logged in): grants go to it and built-in apps stay off (MONO-460).
// app: else Codex's built-in Linear app connector, found in Codex's apps tool cache with both write tools: apps stay on
// and only those two tools are pre-approved. Neither: the launch refuses and no attempt is spent.
// MONO_CODEX_PROBE_BIN replaces the `codex` used for the probe (fixtures); CODEX_HOME locates config.toml and the cache.
export const LINEAR_APP_WRITE_TOOLS = Object.freeze(["linear.save_comment", "linear.save_issue"]);
const CONNECTOR_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PROBE_TIMEOUT_MS = 20_000;

function probe(bin, args, env) {
  try {
    return { ok: true, stdout: execFileSync(bin, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: PROBE_TIMEOUT_MS }) };
  } catch (error) { return { ok: false, error: String(error.stderr || error.message).trim().split("\n")[0] }; }
}
// Dotted TOML keys with quoted parts ("linear.save_comment" stays one part).
function keyParts(text) {
  const parts = [];
  for (const match of text.matchAll(/\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(?:\.|$)/g))
    parts.push(match[1] ?? match[2] ?? match[3]);
  return parts;
}
// The boolean settings of config.toml as dotted-path → value; enough to see what disables an app or its tools.
export function configBooleans(text) {
  const values = new Map();
  let table = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[\[?(.+?)\]\]?$/);
    if (header) { table = keyParts(header[1]); continue; }
    const pair = line.match(/^(.+?)\s*=\s*(true|false)$/);
    if (pair) values.set([...table, ...keyParts(pair[1])].join("\u0000"), pair[2] === "true");
  }
  return values;
}
function linearConnectors(codexHome) {
  const directory = path.join(codexHome, "cache", "codex_apps_tools"), found = new Map();
  let files = [];
  try { files = fs.readdirSync(directory).filter(name => name.endsWith(".json")).sort(); } catch { return found; }
  for (const name of files) {
    let tools; try { tools = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")).tools; } catch { continue; }
    for (const item of Array.isArray(tools) ? tools : []) {
      if (item?.connector_name !== "Linear" || typeof item.connector_id !== "string" || typeof item.tool?.name !== "string") continue;
      if (!found.has(item.connector_id)) found.set(item.connector_id, new Set());
      found.get(item.connector_id).add(item.tool.name);
    }
  }
  return found;
}
function mcpState(bin, env) {
  const listed = probe(bin, ["mcp", "list", "--json"], env);
  if (!listed.ok) return { error: `codex mcp list failed: ${listed.error}` };
  let servers; try { servers = JSON.parse(listed.stdout); } catch { return { error: "codex mcp list returned no JSON" }; }
  const server = Array.isArray(servers) ? servers.find(item => item?.name === "linear") : null;
  if (!server) return { usable: false, absent: true };
  if (server.enabled === false) return { usable: false, disabled: `mcp_servers.linear is disabled${server.disabled_reason ? ` (${server.disabled_reason})` : ""}` };
  if (server.auth_status === "not_logged_in") return { usable: false, unauthorized: true };
  return { usable: true };
}
function appState(bin, env, codexHome) {
  const connectors = linearConnectors(codexHome);
  if (!connectors.size) return { usable: false, absent: true };
  const complete = [...connectors].filter(([, tools]) => LINEAR_APP_WRITE_TOOLS.every(tool => tools.has(tool))).map(([id]) => id);
  if (!complete.length) return { usable: false, absent: true };
  if (complete.length > 1) return { usable: false, absent: true, note: `several Linear app connectors in the cache (${complete.join(", ")})` };
  const id = complete[0];
  if (!CONNECTOR_ID.test(id)) return { usable: false, absent: true, note: `unexpected Linear connector id ${JSON.stringify(id)}` };
  const features = probe(bin, ["features", "list"], env);
  if (!features.ok) return { error: `codex features list failed: ${features.error}` };
  const apps = features.stdout.split("\n").map(line => line.trim().split(/\s+/)).find(cells => cells[0] === "apps");
  if (!apps || apps.at(-1) !== "true") return { usable: false, disabled: "features.apps is off while the Linear app connector is present" };
  let config = new Map();
  try { config = configBooleans(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8")); } catch {}
  const get = (...parts) => config.get(parts.join("\u0000"));
  for (const app of [id, "_default"]) {
    if (get("apps", app, "enabled") === false) return { usable: false, disabled: `apps.${app}.enabled = false` };
    if (get("apps", app, "destructive_enabled") === false) return { usable: false, disabled: `apps.${app}.destructive_enabled = false (save_comment and save_issue are destructive)` };
  }
  for (const tool of LINEAR_APP_WRITE_TOOLS) {
    const own = get("apps", id, "tools", tool, "enabled");
    if (own === false) return { usable: false, disabled: `apps.${id}.tools."${tool}".enabled = false` };
    if (own !== true && (get("apps", id, "default_tools_enabled") === false || get("apps", "_default", "default_tools_enabled") === false))
      return { usable: false, disabled: `default_tools_enabled = false leaves ${tool} off` };
  }
  return { usable: true, connectorId: id };
}

// The Linear write path for a launch or resume. `recorded` (the path a running attempt launched with) is kept: a resume
// never switches paths and refuses when its own path is gone. Throws "linear-unavailable: ..." when there is no usable path.
export function resolveLinearPath({ env = process.env, recorded = null } = {}) {
  const bin = env.MONO_CODEX_PROBE_BIN || "codex";
  const codexHome = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const probeEnv = { ...env }; delete probeEnv.MONO_ATTEMPT; delete probeEnv.MONO_CODEX_PROBE_BIN;
  const mcp = mcpState(bin, probeEnv);
  if (mcp.error) throw new Error(`linear-unavailable: cannot read the Codex Linear setup: ${mcp.error}`);
  // The app is looked at only when the MCP server cannot serve (or the attempt launched through the app).
  const app = (recorded ? recorded.kind === "app" : !mcp.usable) ? appState(bin, probeEnv, codexHome) : null;
  if (app?.error) throw new Error(`linear-unavailable: cannot read the Codex Linear setup: ${app.error}`);
  if (recorded) {
    if (recorded.kind === "mcp" && mcp.usable) return { kind: "mcp" };
    if (recorded.kind === "app" && app.usable && app.connectorId === recorded.connectorId) return { kind: "app", connectorId: app.connectorId };
    throw new Error(`linear-unavailable: this attempt writes Linear through the ${recorded.kind === "mcp" ? "linear MCP server" : `Linear app ${recorded.connectorId}`}, ` +
      `which is no longer usable${refusalTail(mcp, app ?? {})}; restore it and resume, or start a new attempt`);
  }
  if (mcp.usable) return { kind: "mcp" };
  if (app.usable) return { kind: "app", connectorId: app.connectorId };
  const disabled = [mcp.disabled, app.disabled].filter(Boolean);
  if (disabled.length) throw new Error(`linear-unavailable: Linear writes disabled by Codex config: ${disabled.join("; ")}`);
  if (mcp.unauthorized) throw new Error("linear-unavailable: Linear not authorized: the linear MCP server is not logged in (codex mcp login linear) and there is no built-in Linear app");
  throw new Error(`linear-unavailable: no Linear connection in Codex: neither a linear MCP server nor the built-in Linear app with save_comment and save_issue${app.note ? ` (${app.note})` : ""}`);
}
function refusalTail(mcp, app) {
  const why = [mcp.disabled, mcp.unauthorized && "the linear MCP server is not logged in", mcp.absent && "no linear MCP server",
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
