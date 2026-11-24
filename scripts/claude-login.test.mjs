import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureClaudeLogin, expiryFromCredential, claudeLoginFailure, loginKeepalive, loginCheckDisabled, readClaudeLoginExpiry,
  runClaudeRefresh, refreshEnvironment, REFRESH_ARGS, LOGIN_MARGIN_MS } from './claude-login.mjs';

// No test touches the real keychain or the real CLI: the reader and the refresh run are injected.
const NOW = 1_800_000_000_000;
const clock = () => NOW;
function fakeLogin(expiries) {
  const calls = { reads: 0, refreshes: 0 };
  return { calls, readExpiry: async () => { const value = expiries[Math.min(calls.reads++, expiries.length - 1)]; return typeof value === 'number' ? { expiresAt: value } : value; },
    runRefresh: async () => { calls.refreshes++; return { code: 0, timedOut: false }; } };
}

test('a fresh login is left alone: no refresh run', async () => {
  const login = fakeLogin([NOW + 60 * 60 * 1000]);
  const result = await ensureClaudeLogin({ ...login, now: clock, env: {} });
  assert.equal(result.status, 'fresh'); assert.equal(login.calls.refreshes, 0); assert.equal(login.calls.reads, 1);
});

test('an expired or soon-expiring login is refreshed on the host and read again', async () => {
  for (const before of [NOW - 1000, NOW + LOGIN_MARGIN_MS - 1000]) {
    const login = fakeLogin([before, NOW + 8 * 60 * 60 * 1000]);
    const result = await ensureClaudeLogin({ ...login, now: clock, env: {} });
    assert.equal(result.status, 'refreshed'); assert.equal(login.calls.refreshes, 1); assert.equal(login.calls.reads, 2);
  }
});

test('a refresh that leaves the login expired fails with a reason; one still valid stays fresh', async () => {
  const stale = fakeLogin([NOW - 1000, NOW - 1000]);
  stale.runRefresh = async () => { stale.calls.refreshes++; return { code: 1, timedOut: false }; };
  const failed = await ensureClaudeLogin({ ...stale, now: clock, env: {} });
  assert.equal(failed.status, 'failed'); assert.match(failed.reason, /refresh run exit 1; login still expired/);
  const timed = fakeLogin([NOW - 1000, NOW - 1000]);
  timed.runRefresh = async () => ({ code: null, timedOut: true });
  assert.match((await ensureClaudeLogin({ ...timed, now: clock, env: {} })).reason, /timed out/);
  const early = fakeLogin([NOW + 5 * 60 * 1000, NOW + 5 * 60 * 1000]);
  const kept = await ensureClaudeLogin({ ...early, now: clock, env: {} });
  assert.equal(kept.status, 'fresh'); assert.match(kept.reason, /not renewed early/);
  const gone = fakeLogin([NOW - 1000, { unknown: 'no Claude login entry' }]);
  assert.match((await ensureClaudeLogin({ ...gone, now: clock, env: {} })).reason, /no Claude login entry/);
});

test('unknown when the expiry cannot be read: nothing is started', async () => {
  const login = fakeLogin([{ unknown: 'no macOS keychain' }]);
  const result = await ensureClaudeLogin({ ...login, now: clock, env: {} });
  assert.deepEqual([result.status, result.reason, login.calls.refreshes], ['unknown', 'no macOS keychain', 0]);
  const broken = await ensureClaudeLogin({ readExpiry: async () => { throw new Error('boom'); }, runRefresh: async () => ({}), now: clock, env: {} });
  assert.equal(broken.status, 'failed', 'the check never throws');
});

test('inside the worker sandbox the login is only read, never refreshed', async () => {
  const login = fakeLogin([NOW - 1000]);
  const result = await ensureClaudeLogin({ ...login, now: clock, env: { CODEX_SANDBOX: 'seatbelt' } });
  assert.equal(result.status, 'failed'); assert.match(result.reason, /only on the host/); assert.equal(login.calls.refreshes, 0);
  const soon = fakeLogin([NOW + 60 * 1000]);
  assert.equal((await ensureClaudeLogin({ ...soon, now: clock, env: { CODEX_SANDBOX: 'seatbelt' } })).status, 'fresh');
});

test('force refreshes a login whose expiry still looks valid', async () => {
  const login = fakeLogin([NOW + 60 * 60 * 1000, NOW + 8 * 60 * 60 * 1000]);
  const result = await ensureClaudeLogin({ ...login, force: true, now: clock, env: {} });
  assert.equal(result.status, 'refreshed'); assert.equal(login.calls.refreshes, 1);
});

test('only the expiry leaves the credential parser', () => {
  const secret = 'sk-ant-fixture-not-a-token';
  assert.equal(expiryFromCredential(JSON.stringify({ claudeAiOauth: { accessToken: secret, refreshToken: secret, expiresAt: NOW } })), NOW);
  for (const raw of [`{"claudeAiOauth":{"accessToken":"${secret}"`, JSON.stringify({ claudeAiOauth: { accessToken: secret } }), '', 'null'])
    assert.equal(expiryFromCredential(raw), null);
});

test('defaults stay off under tests and the off switch; the refresh run carries USER and no provider key', async () => {
  assert.equal(loginCheckDisabled({ NODE_TEST_CONTEXT: 'child-v8' }), true);
  assert.equal(loginCheckDisabled({ MONO_CLAUDE_LOGIN_CHECK: 'off' }), true);
  assert.equal(loginCheckDisabled({}), false);
  assert.deepEqual(await readClaudeLoginExpiry({ env: process.env, platform: 'darwin' }), { unknown: 'check disabled' });
  assert.deepEqual(await runClaudeRefresh({ env: process.env }), { skipped: true });
  assert.deepEqual(await readClaudeLoginExpiry({ env: {}, platform: 'linux' }), { unknown: 'no macOS keychain' });
  assert.deepEqual(await readClaudeLoginExpiry({ env: { CLAUDE_CONFIG_DIR: '/x' }, platform: 'darwin' }), { unknown: 'custom Claude config directory' });
  const env = refreshEnvironment({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't' });
  assert.ok(env.USER && env.LOGNAME, 'USER is always set'); assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.deepEqual(refreshEnvironment({ USER: 'owner' }), { USER: 'owner', LOGNAME: 'owner' });
  assert.equal(REFRESH_ARGS[0], '-p');
});

test('login failure signs come from CLI errors, never from the model answer', () => {
  const event = value => JSON.stringify(value);
  assert.equal(claudeLoginFailure({ stderr: 'OAuth access token has expired' }), true);
  assert.equal(claudeLoginFailure({ stdout: 'Not logged in · Please run /login' }), true);
  assert.equal(claudeLoginFailure({ stdout: event({ type: 'result', is_error: true, result: 'Failed to authenticate. API Error: 401 {"type":"authentication_error"}' }) }), true);
  assert.equal(claudeLoginFailure({ stdout: event({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Invalid API key' }] } }) }), true);
  assert.equal(claudeLoginFailure({ stdout: event({ type: 'assistant', message: { content: [{ type: 'text', text: 'The handler returns 401 when the token has expired' }] } }) }), false);
  assert.equal(claudeLoginFailure({ stdout: event({ type: 'result', is_error: false, result: 'HTTP 401 handling reviewed' }) }), false);
  assert.equal(claudeLoginFailure({ stdout: event({ type: 'result', is_error: true, result: 'Overloaded' }), stderr: '' }), false);
});

test('the watcher keeps the login fresh every five minutes only while a worker is registered', async () => {
  let time = NOW, checks = 0; const reports = [];
  const keepalive = loginKeepalive({ ensure: async () => { checks++; return { status: 'refreshed' }; }, now: () => time, report: result => reports.push(result.status) });
  assert.equal(keepalive.tick(false), null, 'no worker, no check'); assert.equal(checks, 0);
  await keepalive.tick(true); assert.equal(checks, 1);
  time += 60 * 1000; assert.equal(keepalive.tick(true), null, 'not again within five minutes');
  time += 4 * 60 * 1000; await keepalive.tick(true); assert.equal(checks, 2);
  time += 10 * 60 * 1000; assert.equal(keepalive.tick(false), null); assert.equal(checks, 2);
  assert.deepEqual(reports, ['refreshed', 'refreshed']);
  let release; const slow = loginKeepalive({ ensure: () => new Promise(resolve => { release = resolve; }), now: () => time, intervalMs: 0 });
  const first = slow.tick(true); assert.equal(slow.tick(true), null, 'one check at a time');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release({ status: 'fresh' }); await first;
  const crashing = loginKeepalive({ ensure: async () => { throw new Error('boom'); }, now: () => time, report: () => { throw new Error('report boom'); } });
  assert.equal((await crashing.tick(true)).status, 'failed', 'a failing check never throws into the watcher');
});
