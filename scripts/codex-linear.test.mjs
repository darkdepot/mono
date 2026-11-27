import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { atomicJson } from './runtime.mjs';
import { codexCli, linearArgs } from './transports/codex-cli.mjs';
import { resolveLinearPath, configParseDeath, configValues } from './transports/codex-linear.mjs';
import { checkSpawnAvailability } from './orchestrator/launch.mjs';
import { uncountedReason, attemptCapState } from './orchestrator/command-state.mjs';

// MONO-509: a codex-cli worker writes Linear through the user's `linear` MCP server or, without one, Codex's built-in
// Linear app; neither refuses before the attempt exists, and Codex dying on its config before a thread is not counted.
const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, 'test-fixtures/fake-codex-linear.mjs');
const APP = 'asdk_app_69a089a326dc8191b32a3f2553f5be2c';
const APP_GRANT = `apps.${APP}.tools={"linear.save_comment"={approval_mode="approve"},"linear.save_issue"={approval_mode="approve"}}`;
const APP_ARGS = ['-c', `apps.${APP}.default_tools_approval_mode="auto"`, '-c', APP_GRANT];
const MCP_GRANTS = ['mcp_servers.linear.tools.save_comment.approval_mode="approve"', 'mcp_servers.linear.tools.save_issue.approval_mode="approve"'];

const linearCache = (dir, name, tools, id = APP) => atomicJson(path.join(dir, 'cache/codex_apps_tools', name), { tools: [
  ...tools.map(tool => ({ connector_id: id, connector_name: 'Linear', tool: typeof tool === 'string' ? { name: tool } : tool })),
  { connector_id: 'connector_other', connector_name: 'Other', tool: { name: 'other.save_comment' } }] });
function home({ tools = ['linear.save_comment', 'linear.save_issue', 'linear.get_issue'], id = APP, config = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-codex-linear-'));
  if (tools) linearCache(dir, 'fixture.json', tools, id);
  fs.writeFileSync(path.join(dir, 'config.toml'), config);
  return dir;
}
const resolve = (spec, codexHome, recorded, cwd) => resolveLinearPath({ recorded, cwd,
  env: { ...process.env, MONO_CODEX_PROBE_BIN: fake, MONO_FAKE_CODEX_LINEAR: JSON.stringify(spec), CODEX_HOME: codexHome } });
const appPath = (extra = {}) => ({ kind: 'app', connectorId: APP, ...extra });

test('the MCP path keeps the MONO-449 grants with apps off; the app path keeps apps on, approves two tools, asks for the rest', () => {
  assert.deepEqual(linearArgs({ kind: 'mcp' }), ['--disable', 'apps', '-c', MCP_GRANTS[0], '-c', MCP_GRANTS[1]]);
  assert.deepEqual(linearArgs(undefined), linearArgs({ kind: 'mcp' }), 'an older entry launched on the MCP path');
  assert.deepEqual(linearArgs(appPath()), APP_ARGS);
  assert.deepEqual(linearArgs(appPath({ mcpServerPresent: true })), [...APP_ARGS, '-c', 'mcp_servers.linear.enabled=false'], 'an existing server is turned off');
  const entry = { worktree: '/w', thread_id: 't', network_access: true, model_launch: { model_parameter: 'm', effort_parameter: 'medium' } };
  const mcp = codexCli.invocation({ ...entry, linearPath: { kind: 'mcp' } }, { reportsDir: '/r', roots: ['/w'], prompt: 'p', resume: false }).args;
  assert.deepEqual(mcp.slice(0, 8), ['exec', '--json', '--cd', '/w', '--add-dir', '/r', '--disable', 'apps']);
  assert.deepEqual(mcp.slice(-5), ['-c', MCP_GRANTS[0], '-c', MCP_GRANTS[1], 'p']);
  for (const resume of [false, true]) {
    const app = codexCli.invocation({ ...entry, linearPath: appPath() }, { reportsDir: '/r', roots: ['/w'], prompt: 'p', resume }).args;
    assert.ok(!app.includes('--disable'));
    assert.ok(!app.some(arg => arg.startsWith('mcp_servers.')));
    assert.deepEqual(app.slice(-5), [...APP_ARGS, 'p']);
  }
  assert.equal(codexCli.environment(null, { MONO_CODEX_PROBE_BIN: fake, KEEP: '1' }).MONO_CODEX_PROBE_BIN, undefined, 'the probe override never reaches the worker');
});

test('the resolver prefers an authorized linear server, else the cached Linear app, else refuses by cause', () => {
  const full = home(), none = home({ tools: null }), partial = home({ tools: ['linear.save_comment'] });
  try {
    for (const auth of ['ok', 'bearer_token', 'unsupported']) assert.deepEqual(resolve({ mcp: auth }, full), { kind: 'mcp' }, auth);
    assert.deepEqual(resolve({ mcp: 'absent' }, full), appPath());
    for (const auth of ['not_logged_in', 'unknown']) {
      assert.deepEqual(resolve({ mcp: auth }, full), appPath({ mcpServerPresent: true }), `${auth} falls through to the app`);
      assert.throws(() => resolve({ mcp: auth }, none), new RegExp(`Linear not authorized: the linear MCP server reports auth ${auth}`));
    }
    assert.throws(() => resolve({ mcp: 'absent' }, none), /^Error: linear-unavailable: no Linear connection/);
    assert.throws(() => resolve({ mcp: 'absent' }, partial), /no Linear connection/, 'both write tools are required');
    assert.throws(() => resolve({ mcp: 'absent', apps: false }, full), /Linear writes disabled by Codex config: features\.apps is off/);
    assert.throws(() => resolve({ mcp: 'disabled' }, none), /Linear writes disabled by Codex config: mcp_servers\.linear is disabled/);
    assert.throws(() => resolveLinearPath({ env: { ...process.env, MONO_CODEX_PROBE_BIN: path.join(none, 'missing'), CODEX_HOME: none } }),
      /linear-unavailable: cannot read the Codex Linear setup/);
  } finally { for (const dir of [full, none, partial]) fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the probe runs in the worker worktree and resolves a relative CODEX_HOME there', () => {
  const worktree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-codex-cwd-'))), cwdFile = path.join(worktree, 'cwd.log');
  try {
    linearCache(path.join(worktree, 'codex'), 'fixture.json', ['linear.save_comment', 'linear.save_issue']);
    assert.deepEqual(resolve({ mcp: 'absent', cwdFile }, 'codex', null, worktree), appPath());
    assert.deepEqual([...new Set(fs.readFileSync(cwdFile, 'utf8').trim().split('\n'))], [worktree]);
  } finally { fs.rmSync(worktree, { recursive: true, force: true }); }
});

test('only the newest apps cache file counts, and it must hold both write tools', () => {
  const dir = home({ tools: null }), cache = path.join(dir, 'cache/codex_apps_tools');
  const age = (name, seconds) => { const at = new Date(Date.now() - seconds * 1000); fs.utimesSync(path.join(cache, name), at, at); };
  try {
    linearCache(dir, 'other-identity.json', ['linear.save_comment', 'linear.save_issue']);
    linearCache(dir, 'active.json', ['linear.save_comment']);
    age('other-identity.json', 600); age('active.json', 10);
    assert.throws(() => resolve({ mcp: 'absent' }, dir), /no Linear connection/, 'no union across identities');
    age('other-identity.json', 5);
    assert.deepEqual(resolve({ mcp: 'absent' }, dir), appPath());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('config that turns the Linear app or its write tools off refuses the app path', () => {
  const cases = [
    [`[apps.${APP}]\nenabled = false\n`, `apps.${APP}.enabled = false`],
    [`[apps._default]\nenabled = false\n`, 'apps._default.enabled = false'],
    [`[apps._default]\nenabled = true\n[apps.${APP}]\nenabled = false\n`, `apps.${APP}.enabled = false`],
    [`apps._default = { enabled = false }\n`, 'apps._default.enabled = false'],
    [`[apps]\n_default = { enabled = false, default_tools_approval_mode = "approve" }\n`, 'apps._default.enabled = false'],
    [`apps._default = { enabled = false\n`, 'config.toml has an apps setting Mono cannot read (apps._default)'],
    [`[apps.${APP}.tools."linear.save_comment"]\nenabled = false # off\n`, `apps.${APP}.tools."linear.save_comment".enabled = false`],
    [`[apps.${APP}.tools."Save comment"]\nenabled = false\n`, `apps.${APP}.tools."Save comment".enabled = false`],
    [`[apps.${APP}]\ntools = { "Save issue" = { enabled = false } }\n`, `apps.${APP}.tools."Save issue".enabled = false`],
    [`[apps.${APP}]\ndestructive_enabled = false\n`, 'destructive_enabled = false'],
    [`[apps.${APP}]\nopen_world_enabled = false\n`, 'open_world_enabled = false'],
    [`[apps._default]\nopen_world_enabled = false\n`, 'open_world_enabled = false'],
    [`[apps._default]\ndefault_tools_enabled = false\n`, 'default_tools_enabled = false leaves linear.save_comment off'],
  ];
  for (const [config, reason] of cases) {
    const dir = home({ config });
    try { assert.throws(() => resolve({ mcp: 'absent' }, dir), error => error.message.includes(`disabled by Codex config: ${reason}`), config); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  for (const config of [
    `[apps.${APP}]\ndefault_tools_enabled = false\n[apps.${APP}.tools."linear.save_comment"]\nenabled = true\n[apps.${APP}.tools."linear.save_issue"]\nenabled = true\n`,
    `[apps._default]\nenabled = false\ndefault_tools_approval_mode = "approve"\n[apps.${APP}]\nenabled = true\n`,
    `[apps._default]\nopen_world_enabled = false\n[apps.${APP}]\nopen_world_enabled = true\n`]) {
    const allowed = home({ config });
    try { assert.deepEqual(resolve({ mcp: 'absent' }, allowed), appPath(), config); }
    finally { fs.rmSync(allowed, { recursive: true, force: true }); }
  }
  // A title the cache gives the tool is honored too.
  const titled = home({ tools: [{ name: 'linear.save_comment', title: 'Comment on issue' }, 'linear.save_issue'], config: `[apps.${APP}.tools."Comment on issue"]\nenabled = false\n` });
  try { assert.throws(() => resolve({ mcp: 'absent' }, titled), /tools\."Comment on issue"\.enabled = false/); }
  finally { fs.rmSync(titled, { recursive: true, force: true }); }
  assert.equal(configValues('[apps."a.b".tools."x.y"]\nenabled=false\n').get(['apps', 'a.b', 'tools', 'x.y', 'enabled'].join('\u0000')), false);
});

test('a resume keeps the path it launched with, never moves an MCP attempt to the app, and refuses when its path is gone', () => {
  const full = home(), none = home({ tools: null });
  try {
    assert.deepEqual(resolve({ mcp: 'ok' }, full, appPath()), appPath({ mcpServerPresent: true }), 'never switches to the server, turns it off');
    assert.deepEqual(resolve({ mcp: 'absent' }, full, appPath()), appPath(), 'no server, no server key');
    assert.deepEqual(resolve({ mcp: 'ok' }, none, { kind: 'mcp' }), { kind: 'mcp' });
    assert.throws(() => resolve({ mcp: 'absent' }, full, { kind: 'mcp' }), /this attempt writes Linear through the linear MCP server, which is no longer usable \(no linear MCP server\)/);
    assert.throws(() => resolve({ mcp: 'not_logged_in' }, full, { kind: 'mcp' }), /linear MCP server, which is no longer usable \(the linear MCP server reports auth not_logged_in\)/);
    assert.throws(() => resolve({ mcp: 'ok' }, none, appPath()), /through the Linear app asdk_app_.*no longer usable/);
  } finally { for (const dir of [full, none]) fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Codex dying on config.toml before thread.started does not count the attempt; after a thread it does', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-config-death-')));
  const root = path.join(scratch, 'root'), issue = 'MONO-901', log = path.join(root, 'logs', `${issue}-mono-deliver-a1.jsonl`);
  try {
    atomicJson(path.join(root, 'control.json'), { state: 'active' }); atomicJson(path.join(root, 'workers.json'), {});
    atomicJson(path.join(root, 'attempts.json'), { [issue]: 1 });
    fs.mkdirSync(path.dirname(log), { recursive: true }); fs.writeFileSync(log, JSON.stringify({ type: 'mono.launch', issue, attempt: 1 }) + '\n');
    fs.writeFileSync(log.replace(/\.jsonl$/, '.stderr.log'), 'Error loading config.toml: invalid transport in `mcp_servers.linear`\n');
    assert.equal(configParseDeath(log), true);
    const reason = uncountedReason(root, issue, 1);
    assert.equal(reason, 'environment: attempt 1 died loading Codex config.toml before thread.started');
    assert.equal(checkSpawnAvailability({ root, issue }).uncounted, reason, 'the next attempt (2) is marked uncounted at launch');
    atomicJson(path.join(root, 'attempts-uncounted.json'), { [issue]: [{ attempt: 2, reason, recordedAt: new Date().toISOString() }] });
    atomicJson(path.join(root, 'attempts.json'), { [issue]: 2 });
    assert.deepEqual([attemptCapState(root, issue).counted, attemptCapState(root, issue).uncounted], [1, 1]);
    fs.appendFileSync(log, JSON.stringify({ type: 'thread.started', thread_id: 't' }) + '\n');
    assert.equal(configParseDeath(log), false, 'a worker that started did real work');
    assert.equal(uncountedReason(root, issue, 1), null);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
