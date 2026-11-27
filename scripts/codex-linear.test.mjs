import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { atomicJson } from './runtime.mjs';
import { codexCli, linearArgs } from './transports/codex-cli.mjs';
import { resolveLinearPath, configParseDeath, configBooleans } from './transports/codex-linear.mjs';
import { checkSpawnAvailability } from './orchestrator/launch.mjs';
import { uncountedReason, attemptCapState } from './orchestrator/command-state.mjs';

// MONO-509: a codex-cli worker writes Linear through the user's `linear` MCP server or, without one, Codex's built-in
// Linear app; neither refuses before the attempt exists, and Codex dying on its config before a thread is not counted.
const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, 'test-fixtures/fake-codex-linear.mjs');
const APP = 'asdk_app_69a089a326dc8191b32a3f2553f5be2c';
const APP_GRANT = `apps.${APP}.tools={"linear.save_comment"={approval_mode="approve"},"linear.save_issue"={approval_mode="approve"}}`;
const MCP_GRANTS = ['mcp_servers.linear.tools.save_comment.approval_mode="approve"', 'mcp_servers.linear.tools.save_issue.approval_mode="approve"'];

function home({ tools = ['linear.save_comment', 'linear.save_issue', 'linear.get_issue'], id = APP, config = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-codex-linear-'));
  if (tools) atomicJson(path.join(dir, 'cache/codex_apps_tools/fixture.json'), { tools: [
    ...tools.map(name => ({ connector_id: id, connector_name: 'Linear', tool: { name } })),
    { connector_id: 'connector_other', connector_name: 'Other', tool: { name: 'other.save_comment' } }] });
  fs.writeFileSync(path.join(dir, 'config.toml'), config);
  return dir;
}
const resolve = (spec, codexHome, recorded) => resolveLinearPath({ recorded,
  env: { ...process.env, MONO_CODEX_PROBE_BIN: fake, MONO_FAKE_CODEX_LINEAR: JSON.stringify(spec), CODEX_HOME: codexHome } });

test('the MCP path keeps the MONO-449 grants with apps off; the app path keeps apps on with one inline grant', () => {
  assert.deepEqual(linearArgs({ kind: 'mcp' }), ['--disable', 'apps', '-c', MCP_GRANTS[0], '-c', MCP_GRANTS[1]]);
  assert.deepEqual(linearArgs(undefined), linearArgs({ kind: 'mcp' }), 'an older entry launched on the MCP path');
  assert.deepEqual(linearArgs({ kind: 'app', connectorId: APP }), ['-c', APP_GRANT]);
  const entry = { worktree: '/w', thread_id: 't', network_access: true, model_launch: { model_parameter: 'm', effort_parameter: 'medium' } };
  const mcp = codexCli.invocation({ ...entry, linearPath: { kind: 'mcp' } }, { reportsDir: '/r', roots: ['/w'], prompt: 'p', resume: false }).args;
  assert.deepEqual(mcp.slice(0, 8), ['exec', '--json', '--cd', '/w', '--add-dir', '/r', '--disable', 'apps']);
  assert.deepEqual(mcp.slice(-5), ['-c', MCP_GRANTS[0], '-c', MCP_GRANTS[1], 'p']);
  for (const resume of [false, true]) {
    const app = codexCli.invocation({ ...entry, linearPath: { kind: 'app', connectorId: APP } }, { reportsDir: '/r', roots: ['/w'], prompt: 'p', resume }).args;
    assert.ok(!app.includes('--disable'));
    assert.ok(!app.some(arg => arg.startsWith('mcp_servers.')));
    assert.deepEqual(app.slice(-3), ['-c', APP_GRANT, 'p']);
  }
  assert.equal(codexCli.environment(null, { MONO_CODEX_PROBE_BIN: fake, KEEP: '1' }).MONO_CODEX_PROBE_BIN, undefined, 'the probe override never reaches the worker');
});

test('the resolver prefers a logged-in linear server, else the cached Linear app, else refuses by cause', () => {
  const full = home(), none = home({ tools: null }), partial = home({ tools: ['linear.save_comment'] });
  try {
    assert.deepEqual(resolve({ mcp: 'ok' }, full), { kind: 'mcp' });
    assert.deepEqual(resolve({ mcp: 'absent' }, full), { kind: 'app', connectorId: APP });
    assert.deepEqual(resolve({ mcp: 'not_logged_in' }, full), { kind: 'app', connectorId: APP });
    assert.throws(() => resolve({ mcp: 'absent' }, none), /^Error: linear-unavailable: no Linear connection/);
    assert.throws(() => resolve({ mcp: 'absent' }, partial), /no Linear connection/, 'both write tools are required');
    assert.throws(() => resolve({ mcp: 'not_logged_in' }, none), /Linear not authorized: the linear MCP server is not logged in/);
    assert.throws(() => resolve({ mcp: 'absent', apps: false }, full), /Linear writes disabled by Codex config: features\.apps is off/);
    assert.throws(() => resolve({ mcp: 'disabled' }, none), /Linear writes disabled by Codex config: mcp_servers\.linear is disabled/);
    assert.throws(() => resolveLinearPath({ env: { ...process.env, MONO_CODEX_PROBE_BIN: path.join(none, 'missing'), CODEX_HOME: none } }),
      /linear-unavailable: cannot read the Codex Linear setup/);
  } finally { for (const dir of [full, none, partial]) fs.rmSync(dir, { recursive: true, force: true }); }
});

test('config that turns the Linear app or its write tools off refuses the app path', () => {
  const cases = [
    [`[apps.${APP}]\nenabled = false\n`, `apps.${APP}.enabled = false`],
    [`[apps.${APP}.tools."linear.save_comment"]\nenabled = false # off\n`, `apps.${APP}.tools."linear.save_comment".enabled = false`],
    [`[apps.${APP}]\ndestructive_enabled = false\n`, `apps.${APP}.destructive_enabled = false`],
    [`[apps._default]\ndefault_tools_enabled = false\n`, 'default_tools_enabled = false leaves linear.save_comment off'],
  ];
  for (const [config, reason] of cases) {
    const dir = home({ config });
    try { assert.throws(() => resolve({ mcp: 'absent' }, dir), error => error.message.includes(`disabled by Codex config: ${reason}`), config); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const allowed = home({ config: `[apps.${APP}]\ndefault_tools_enabled = false\n[apps.${APP}.tools."linear.save_comment"]\nenabled = true\n[apps.${APP}.tools."linear.save_issue"]\nenabled = true\n` });
  try { assert.deepEqual(resolve({ mcp: 'absent' }, allowed), { kind: 'app', connectorId: APP }); }
  finally { fs.rmSync(allowed, { recursive: true, force: true }); }
  assert.equal(configBooleans('[apps."a.b".tools."x.y"]\nenabled=false\n').get(['apps', 'a.b', 'tools', 'x.y', 'enabled'].join('\u0000')), false);
});

test('a resume keeps the path it launched with and refuses when that path is gone', () => {
  const full = home(), none = home({ tools: null });
  try {
    assert.deepEqual(resolve({ mcp: 'ok' }, full, { kind: 'app', connectorId: APP }), { kind: 'app', connectorId: APP }, 'never switches to the server');
    assert.deepEqual(resolve({ mcp: 'ok' }, none, { kind: 'mcp' }), { kind: 'mcp' });
    assert.throws(() => resolve({ mcp: 'absent' }, full, { kind: 'mcp' }), /this attempt writes Linear through the linear MCP server, which is no longer usable \(no linear MCP server\)/);
    assert.throws(() => resolve({ mcp: 'ok' }, none, { kind: 'app', connectorId: APP }), /through the Linear app asdk_app_.*no longer usable/);
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
