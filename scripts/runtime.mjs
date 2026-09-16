import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export function resolvedLocation(file) {
  if (!path.isAbsolute(file ?? "")) throw new Error("absolute evidence/root/worktree paths required");
  if (fs.existsSync(file)) return fs.realpathSync(file);
  return path.join(resolvedLocation(path.dirname(file)), path.basename(file));
}
export function validateEvidenceGrants(evidencePath, roots, label = "evidenceRoot") {
  const evidenceRoot = resolvedLocation(evidencePath);
  const prefix = value => value.endsWith(path.sep) ? value : value + path.sep;
  if (roots.map(resolvedLocation).some(root => evidenceRoot === root || evidenceRoot.startsWith(prefix(root)) || root.startsWith(prefix(evidenceRoot))))
    throw new Error(`${label} must be outside worktree, orchestrator root and worker-writable roots (no overlapping grants)`);
  return evidenceRoot;
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");
export function durableDirectory(dir) {
  if (fs.existsSync(dir)) return;
  const parent = path.dirname(dir);
  durableDirectory(parent);
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  syncDir(parent);
}
export function syncDir(dir) {
  const fd = fs.openSync(dir, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function atomicJson(file, value) {
  durableDirectory(path.dirname(file));
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file); syncDir(path.dirname(file));
}
export async function withLock(file, action) {
  durableDirectory(path.dirname(file));
  let fd;
  try { fd = fs.openSync(file, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let holder, live = false;
    try {
      holder = readJson(file).pid;
      if (Number.isInteger(holder) && holder > 0) {
        try { process.kill(holder, 0); live = true; } catch (cause) { live = cause.code === "EPERM"; }
      }
    } catch {}
    const locked = new Error(`operation locked: ${file}; ${live ? `live holder ${holder}, retry after completion; do not remove its lock` : "holder not confirmed live; establish process state and reconcile before any lock removal"}`);
    locked.code = "ELOCKED"; throw locked;
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); fs.fsyncSync(fd);
  try { return await action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); syncDir(path.dirname(file)); }
}
export function flags(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!key.startsWith("--") || Object.hasOwn(result, key.slice(2))) throw new Error(`invalid argument ${key}`);
    if (key === "--help") { result.help = true; continue; }
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`missing value ${key}`);
    result[key.slice(2)] = args[++i];
  }
  return result;
}
export function identity(value) {
  return typeof value?.packVersion === "string" && value.packVersion.length > 0 && /^[a-f0-9]{40}$/.test(value.sourceCommit) && Number.isInteger(value.surfaceRevision) && value.surfaceRevision > 0;
}
export const isMain = (url) => process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url));
export function positive(value, fallback, name) {
  value = value ?? fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid ${name}`);
  return value;
}
export function deliveryConfig(file) {
  const config = file ? readJson(file)?.orchestration?.delivery ?? {} : {};
  return {
    confirmationTimeoutSec: positive(config.confirmationTimeoutSec, 900, "confirmationTimeoutSec"),
    quietSec: positive(config.quietSec, 120, "quietSec"),
    evidenceLimitSec: positive(config.evidenceLimitSec, 2400, "evidenceLimitSec"),
    pollSec: positive(config.pollSec, 10, "pollSec"),
    attemptCap: positive(config.attemptCap, 3, "attemptCap"),
  };
}

export const ROLE_ENGINES = {
  orchestrator: ['claude'], 'second-voice': ['codex'], 'second-voice-alt': ['claude'],
  'worker-default': ['codex'], 'worker-complex': ['codex'], 'worker-claude': ['claude'],
  autoreview: ['claude', 'kimi', 'pi', 'codex'],
};
export const RISK_KEYS = ['tiny', 'standard', 'deep', 'risky', 'riskyCritical'];
const NATIVE_PROVIDERS = { claude: 'anthropic', codex: 'openai', kimi: 'moonshot', pi: 'openai' };
const EFFORTS = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'], codex: ['low', 'medium', 'high', 'xhigh', 'max'],
  kimi: ['on', 'off'], pi: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
};
const need = (condition, message) => { if (!condition) throw new Error(`models: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed, label) {
  need(object(value), `${label} must be an object`);
  need(Object.keys(value).every(key => allowed.includes(key)), `${label} has unsupported fields (credential values are forbidden)`);
}
function token(value, label) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/:\[\]-]{0,199}$/.test(value) && !/^sk[-_]/i.test(value), `${label} must be a non-secret identifier`);
}
function policyDirectory(skillsRoot) {
  if (skillsRoot) return path.join(skillsRoot, 'mono-implement/references');
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const source = path.join(dir, '../references');
  return fs.existsSync(path.join(source, 'model-policy.md')) ? source : path.join(dir, '../../mono-implement/references');
}
export function roleDefaults(skillsRoot) {
  const directory = policyDirectory(skillsRoot);
  const policy = fs.readFileSync(path.join(directory, 'model-policy.md'), 'utf8');
  const defaults = {};
  for (const [role, engines] of Object.entries(ROLE_ENGINES)) {
    const row = policy.split('\n').find(line => line.startsWith(`| \`${role}\` |`));
    const cells = row?.split('|').slice(1, 4).map(cell => cell.trim().replaceAll('`', ''));
    need(cells?.length === 3, `policy role unavailable: ${role}`);
    defaults[role] = { engine: engines[0], model: cells[1], effort: role === 'orchestrator' ? null : cells[2],
      provider: { id: engines[0] === 'claude' ? 'anthropic' : 'openai', endpoint: null }, credentialEnv: null };
  }
  const routing = fs.readFileSync(path.join(directory, 'autoreview-routing.md'), 'utf8');
  const effortByRisk = {};
  for (const risk of RISK_KEYS) {
    const prefix = risk === 'riskyCritical' ? '| `risky` with critical escalation |' : `| \`${risk}\` |`;
    const effort = routing.split('\n').find(line => line.startsWith(prefix))?.match(/\| `(low|medium|high|xhigh|max)` \|/)?.[1];
    need(effort, `policy risk unavailable: ${risk}`); effortByRisk[risk] = effort;
  }
  delete defaults.autoreview.effort; defaults.autoreview.effortByRisk = effortByRisk;
  return defaults;
}
function providerFor(value, engine, role) {
  fields(value, ['id', 'endpoint', 'credentialEnv'], `${role}.provider`);
  token(value.id, `${role}.provider.id`);
  need(Object.hasOwn(value, 'endpoint') && Object.hasOwn(value, 'credentialEnv'), `${role}.provider requires endpoint and credentialEnv (null for native auth)`);
  if (value.endpoint !== null) {
    let url; try { url = new URL(value.endpoint); } catch {}
    need(typeof value.endpoint === 'string' && url?.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
      `${role}.provider.endpoint must be a credential-free HTTPS URL`);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch {}
    need(pathname !== undefined && pathname.split('/').every(segment => !/^sk[-_]/i.test(segment)),
      `${role}.provider.endpoint must not contain credential-shaped path segments`);
  }
  need(value.credentialEnv === null || (typeof value.credentialEnv === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value.credentialEnv)), `${role}.provider.credentialEnv must be a variable name`);
  if (engine === 'pi') {
    need(['openai', 'xai', 'google', 'minimax'].includes(value.id), `${role}: unsupported pi provider`);
    need(value.id === 'openai' || value.endpoint === null, `${role}: pi provider endpoint override unsupported`);
  }
  const native = NATIVE_PROVIDERS[engine];
  if (value.id !== native || value.endpoint !== null) need(value.credentialEnv !== null, `${role}: external provider requires credentialEnv`);
  if (['claude', 'codex', 'kimi'].includes(engine) && value.id !== native) need(value.endpoint !== null, `${role}: external provider requires endpoint`);
  return { provider: { id: value.id, endpoint: value.endpoint }, credentialEnv: value.credentialEnv };
}
function checkCredentialFields(value, location = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const at = location ? location + '.' + key : key;
    if (/api.?key|token|secret|password|credential|authorization/i.test(key)) {
      const declared = key === 'credentialEnv' && /^(?:models\.roles\.[^.]+\.provider|models\.pairingAccepted\.\d+\.(?:producer|reviewer))$/.test(location);
      need(declared && (entry === null || (typeof entry === 'string' && /^[A-Z][A-Z0-9_]*$/.test(entry))), 'credential values/fields forbidden at ' + at);
    }
    checkCredentialFields(entry, at);
  }
}
function modelState(config, skillsRoot) {
  need(object(config), 'config must be an object');
  const defaults = roleDefaults(skillsRoot), roles = structuredClone(defaults);
  if (config.models === undefined) return { defaults, roles, records: [] };
  checkCredentialFields(config.models, 'models');
  fields(config.models, ['roles', 'pairingAccepted'], 'models');
  fields(config.models.roles, Object.keys(ROLE_ENGINES), 'roles');
  for (const [role, override] of Object.entries(config.models.roles)) {
    need(!['orchestrator', 'second-voice-alt'].includes(role), `role ${role} cannot be overridden`);
    fields(override, ['engine', 'transport', 'model', 'effort', 'effortByRisk', 'provider'], role);
    need(Object.values(override).every(value => value !== null), `${role}: null override field`);
    need(!(Object.hasOwn(override, 'engine') && Object.hasOwn(override, 'transport')), `${role}: choose engine or transport`);
    const transportEngine = { 'codex-cli': 'codex', 'claude-code-desktop': 'claude', fallback: 'claude', codex: 'codex', claude: 'claude', kimi: 'kimi', pi: 'pi' };
    const engine = override.transport === undefined ? override.engine ?? defaults[role].engine : transportEngine[override.transport];
    need(ROLE_ENGINES[role].includes(engine), `${role}: unsupported engine/transport`);
    need(engine === defaults[role].engine || typeof override.model === 'string', `${role}: changing engine requires model`);
    const model = override.model ?? defaults[role].model; token(model, `${role}.model`);
    const route = { engine, model };
    if (role === 'autoreview') {
      need(override.effort === undefined, `${role}: use effortByRisk`);
      const efforts = override.effortByRisk ?? (engine === defaults[role].engine ? defaults[role].effortByRisk : null);
      fields(efforts, RISK_KEYS, `${role}.effortByRisk`);
      need(RISK_KEYS.every(risk => EFFORTS[engine].includes(efforts[risk])), `${role}: unsupported effort or missing risk escalation`);
      route.effortByRisk = { ...efforts };
    } else {
      need(override.effortByRisk === undefined, `${role}: effortByRisk is reviewer-only`);
      route.effort = override.effort ?? defaults[role].effort;
      need(EFFORTS[engine].includes(route.effort), `${role}: unsupported effort`);
    }
    const native = NATIVE_PROVIDERS[engine];
    Object.assign(route, providerFor(override.provider ?? { id: native, endpoint: null, credentialEnv: null }, engine, role));
    if (engine === 'pi') {
      need(!route.model.includes('/') || route.model.startsWith(route.provider.id + '/'), `${role}: pi model/provider mismatch`);
      if (!route.model.includes('/')) route.model = route.provider.id + '/' + route.model;
    }
    if (role === 'second-voice') need(route.provider.id === 'openai' && route.provider.endpoint === null, `${role}: cross-vendor rule requires native Codex for the Claude orchestrator`);
    roles[role] = route;
  }
  const records = config.models.pairingAccepted ?? [];
  need(Array.isArray(records), 'pairingAccepted must be an array');
  return { defaults, roles, records };
}
function pairFor(role, roles) {
  return { producer: { role, ...roles[role] }, reviewer: { ...roles.autoreview }, riskClasses: [...RISK_KEYS] };
}
function changedPairs(state) {
  return ['worker-default', 'worker-complex', 'worker-claude'].filter(role =>
    canonical(pairFor(role, state.roles)) !== canonical(pairFor(role, state.defaults))).map(role => pairFor(role, state.roles));
}
export function requiredPairings(config, { skillsRoot } = {}) {
  return changedPairs(modelState(config, skillsRoot));
}
export function validateModels(config, { skillsRoot } = {}) {
  const state = modelState(config, skillsRoot);
  for (const record of state.records) {
    fields(record, ['producer', 'reviewer', 'riskClasses', 'linearDecision', 'by', 'date'], 'pairingAccepted record');
    need(typeof record.linearDecision === 'string' && /^https:\/\/linear\.app\/[^\s]+/.test(record.linearDecision), 'pairingAccepted.linearDecision must reference a Linear decision');
    need(typeof record.by === 'string' && record.by.trim() && typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(record.date) && Number.isFinite(Date.parse(record.date)), 'pairingAccepted by/date required');
    const role = record.producer?.role;
    need(['worker-default', 'worker-complex', 'worker-claude'].includes(role), 'pairingAccepted producer role invalid');
    const actual = { producer: record.producer, reviewer: record.reviewer, riskClasses: record.riskClasses };
    need(canonical(actual) === canonical(pairFor(role, state.roles)), `pair ${role} -> autoreview changed; renew its bound acceptance`);
  }
  for (const pair of changedPairs(state)) need(state.records.some(record =>
    canonical({ producer: record.producer, reviewer: record.reviewer, riskClasses: record.riskClasses }) === canonical(pair)),
  `pair ${pair.producer.role} -> autoreview requires bound pairingAccepted and linearDecision`);
  return state.roles;
}
export function resolveRole(role, config = {}, options = {}) {
  const roles = validateModels(config, options);
  need(Object.hasOwn(roles, role), `unknown role ${role}`);
  const route = roles[role];
  return { ...route, fingerprint: digest({ route, configDigest: digest(config) }) };
}
export function baseModelConfig(worktree, base) {
  need(/^[a-f0-9]{40}$/.test(base), 'immutable base commit required');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null', GIT_NO_LAZY_FETCH: '1' });
  const git = args => execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'advice.graftFileDeprecated=false', ...args], { cwd: worktree, env, encoding: 'utf8' });
  const file = '.agents/mono-workflow.config.json';
  if (!git(['ls-tree', base, '--', file]).trim()) return {};
  return JSON.parse(git(['show', `${base}:${file}`]));
}
export function resolveModelRoutes(worktree, base, role, options = {}) {
  const config = baseModelConfig(worktree, base);
  need(['worker-default', 'worker-complex', 'worker-claude', 'second-voice'].includes(role), 'unsupported launch role');
  return { base, configDigest: digest(config), roles: Object.fromEntries([...new Set([role, 'autoreview'])].map(name => [name, resolveRole(name, config, options)])) };
}

if (isMain(import.meta.url)) {
  try {
    const args = flags(process.argv.slice(2));
    if (args.help) console.log('Usage: runtime.mjs --role <launch-role> --worktree <repo> --base <commit> [--skills-root <root>] (print modelRoutes; no launch)');
    else console.log(JSON.stringify(resolveModelRoutes(args.worktree, args.base, args.role, { skillsRoot: args['skills-root'] }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
