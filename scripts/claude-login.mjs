// Claude CLI subscription login freshness.
// The login lasts about eight hours and only a Claude CLI run on the host, outside
// any worker sandbox, can refresh it, and only once it has expired or nearly so.
// This module reads nothing but the login's expiry time (the secret itself is never
// returned, printed, logged or stored), and when the login expires within ten
// minutes it starts one short `claude -p` on the host and reads the expiry again.
import os from 'node:os';
import { spawn } from 'node:child_process';

export const LOGIN_MARGIN_MS = 10 * 60 * 1000;
export const LOGIN_REFRESH_TIMEOUT_MS = 60 * 1000;
export const LOGIN_KEEPALIVE_MS = 5 * 60 * 1000;
export const LOGIN_FAILURE_REASON = 'вход Claude истёк или не найден';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const READ_TIMEOUT_MS = 10 * 1000;

// Tests and fixtures never read the real keychain or start the real CLI:
// under `node --test`, or with MONO_CLAUDE_LOGIN_CHECK=off, the defaults do nothing.
export function loginCheckDisabled(env = process.env) {
  return env.MONO_CLAUDE_LOGIN_CHECK === 'off' || !!env.NODE_TEST_CONTEXT;
}
// Inside the worker's Codex sandbox the keychain and ~/.claude are read-only: reading works, refreshing cannot.
export const inWorkerSandbox = (env = process.env) => !!env.CODEX_SANDBOX;

// Only the expiry leaves this function; a parse error message (which may quote the input) never does.
export function expiryFromCredential(raw) {
  try {
    const value = JSON.parse(raw)?.claudeAiOauth?.expiresAt;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

// Default reader: macOS keychain entry of the subscription login, expiry only.
export function readClaudeLoginExpiry({ env = process.env, platform = process.platform } = {}) {
  if (loginCheckDisabled(env)) return Promise.resolve({ unknown: 'check disabled' });
  if (platform !== 'darwin') return Promise.resolve({ unknown: 'no macOS keychain' });
  // A custom config directory keeps its login under another keychain entry.
  if (env.CLAUDE_CONFIG_DIR) return Promise.resolve({ unknown: 'custom Claude config directory' });
  return new Promise(resolve => {
    let child;
    try { child = spawn('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { resolve({ unknown: 'keychain unreadable' }); return; }
    const chunks = [];
    let size = 0, done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); chunks.length = 0; resolve(value); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish({ unknown: 'keychain read timed out' }); }, READ_TIMEOUT_MS);
    child.stdout.on('data', data => { size += data.length; if (size <= 1024 * 1024) chunks.push(data); });
    child.once('error', () => finish({ unknown: 'keychain unreadable' }));
    child.once('close', code => {
      if (code === 44) return finish({ unknown: 'no Claude login entry' });
      if (code !== 0) return finish({ unknown: 'keychain unreadable' });
      const expiresAt = expiryFromCredential(Buffer.concat(chunks).toString('utf8'));
      finish(expiresAt ? { expiresAt } : { unknown: 'login entry has no expiry' });
    });
  });
}

// The refresh run sees only what the CLI needs to find the login: never a provider key,
// which would switch it away from the subscription. Claude CLI looks the login up by USER.
export function refreshEnvironment(source = process.env) {
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME']
    .filter(name => source[name] !== undefined).map(name => [name, source[name]]));
  if (!env.USER) { try { env.USER = os.userInfo().username; } catch {} }
  if (!env.LOGNAME && env.USER) env.LOGNAME = env.USER;
  return env;
}
export const REFRESH_ARGS = ['-p', '--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--tools', '', '--disable-slash-commands', '--no-session-persistence', 'Reply with the single word OK.'];

// Default refresh: one short CLI run, closed stdin, output discarded, 60 s limit.
export function runClaudeRefresh({ env = process.env, timeoutMs = LOGIN_REFRESH_TIMEOUT_MS } = {}) {
  if (loginCheckDisabled(env)) return Promise.resolve({ skipped: true });
  return new Promise(resolve => {
    let child, timedOut = false;
    try { child = spawn('claude', REFRESH_ARGS, { cwd: os.tmpdir(), env: refreshEnvironment(env), stdio: ['ignore', 'ignore', 'ignore'], detached: true }); }
    catch { resolve({ code: null, error: 'claude could not start' }); return; }
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); resolve({ code: null, error: 'claude could not start' }); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, timedOut }); });
  });
}

const describeRun = run => run?.timedOut ? 'refresh run timed out' : run?.error ? run.error : run?.skipped ? 'refresh run skipped' : `refresh run exit ${run?.code ?? 'unknown'}`;

// fresh | refreshed | failed | unknown, with a reason. Never throws.
// force: the CLI reported an expired login although the expiry still looks valid.
export async function ensureClaudeLogin({ force = false, env = process.env, now = Date.now,
  readExpiry = () => readClaudeLoginExpiry({ env }), runRefresh = () => runClaudeRefresh({ env }) } = {}) {
  try {
    const before = await readExpiry();
    if (!Number.isFinite(before?.expiresAt)) return { status: 'unknown', reason: before?.unknown ?? 'expiry unreadable' };
    if (!force && before.expiresAt - now() > LOGIN_MARGIN_MS) return { status: 'fresh', expiresAt: before.expiresAt };
    if (inWorkerSandbox(env)) return before.expiresAt > now()
      ? { status: 'fresh', expiresAt: before.expiresAt, reason: 'expires soon; it refreshes on the host' }
      : { status: 'failed', expiresAt: before.expiresAt, reason: 'expired; it refreshes only on the host, outside the worker sandbox' };
    const run = await runRefresh();
    const after = await readExpiry();
    if (!Number.isFinite(after?.expiresAt)) return { status: 'failed', reason: `${describeRun(run)}; login unreadable afterwards (${after?.unknown ?? 'expiry unreadable'})` };
    if (after.expiresAt > before.expiresAt) return { status: 'refreshed', expiresAt: after.expiresAt };
    // The CLI refreshes only an expired or nearly expired login; one still valid is not a failure.
    if (after.expiresAt > now()) return { status: 'fresh', expiresAt: after.expiresAt, reason: `still valid; ${describeRun(run)}, not renewed early` };
    return { status: 'failed', expiresAt: after.expiresAt, reason: `${describeRun(run)}; login still expired` };
  } catch { return { status: 'failed', reason: 'login check error' }; }
}

// Signs of an expired or missing login in a failed Claude role: stderr, plain lines,
// and the CLI's own error events. The model's answer text is never scanned, so a
// reviewed diff about HTTP 401 does not count.
const LOGIN_SIGNS = /\b401\b|authentication_error|authentication_failed|OAuth (?:access )?token (?:has )?expired|token has expired|Not logged in|Please run \/login|Invalid bearer token/i;
export function claudeLoginFailure({ stdout = '', stderr = '' } = {}) {
  const texts = [String(stderr)];
  for (const line of String(stdout).split('\n')) {
    let event; try { event = JSON.parse(line); } catch { texts.push(line); continue; }
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'result' && event.is_error === true) texts.push(String(event.result ?? ''), String(event.error ?? ''));
    if (event.type === 'assistant' && event.error) texts.push(String(event.error),
      ...(Array.isArray(event.message?.content) ? event.message.content.map(part => String(part?.text ?? '')) : []));
  }
  return texts.some(value => LOGIN_SIGNS.test(value));
}

// The watcher's keepalive: at most once per interval, only while a worker is registered,
// one check at a time; a check never throws into the watcher.
export function loginKeepalive({ ensure = () => ensureClaudeLogin(), intervalMs = LOGIN_KEEPALIVE_MS, now = Date.now, report = () => {} } = {}) {
  let lastAt = -Infinity, running = null;
  return {
    tick(hasWorkers) {
      if (!hasWorkers || running || now() - lastAt < intervalMs) return null;
      lastAt = now();
      const tell = result => { try { report(result); } catch {} return result; };
      running = Promise.resolve().then(() => ensure()).then(tell, () => tell({ status: 'failed', reason: 'login check error' }))
        .finally(() => { running = null; });
      return running;
    },
  };
}
