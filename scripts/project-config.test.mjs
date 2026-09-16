import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as runtime from './runtime.mjs';

const risks = ['tiny', 'standard', 'deep', 'risky', 'riskyCritical'];
const reviewer = (engine = 'claude') => ({ engine, model: 'example-reviewer',
  effortByRisk: Object.fromEntries(risks.map(risk => [risk, engine === 'kimi' ? 'on' : 'high'])),
  provider: { id: engine === 'pi' ? 'openai' : 'example', endpoint: 'https://models.example.invalid/v1', credentialEnv: 'REVIEW_CREDENTIAL' } });
function accepted(config) {
  config.models.pairingAccepted = runtime.requiredPairings(config).map(pair => ({ ...pair,
    linearDecision: 'https://linear.app/example/issue/TEST-1#comment-decision', by: 'owner', date: '2026-09-16' }));
  return config;
}
test('models schema rejects unknown roles, engines, efforts, transports and secret fields', () => {
  assert.equal(typeof runtime.resolveRole, 'function');
  assert.doesNotThrow(() => runtime.validateModels({}));
  for (const field of ['apiKey', 'token', 'secret', 'credentialEnv']) assert.throws(() => runtime.validateModels({ models: { roles: {}, [field]: 'forbidden-field' } }), /credential|fields/);

  for (const roles of [[], { unknown: reviewer() }, { orchestrator: reviewer() }, { 'second-voice-alt': reviewer() },
    { autoreview: { ...reviewer(), engine: null } }, { autoreview: { ...reviewer(), model: null } }, { autoreview: { ...reviewer(), engine: '', transport: 'claude' } }, { autoreview: { ...reviewer(), engine: 'amp' } }, { autoreview: { ...reviewer(), effort: 'high' } },
    { autoreview: { ...reviewer(), effortByRisk: { ...reviewer().effortByRisk, tiny: 'unknown' } } },
    { 'worker-default': { engine: 'claude', model: 'example', effort: 'high' } },
    { 'worker-claude': { engine: 'codex', model: 'example', effort: 'high' } },
    { 'second-voice': { engine: 'claude', model: 'example', effort: 'high' } },
    { autoreview: { ...reviewer(), apiKey: 'forbidden-field' } },
    { autoreview: { ...reviewer(), provider: { ...reviewer().provider, key: 'forbidden-field' } } },
    { autoreview: { ...reviewer(), provider: { ...reviewer().provider, credentialEnv: 'not a variable' } } },
    { autoreview: { ...reviewer(), provider: { ...reviewer().provider, endpoint: 'https://user:password@example.invalid' } } },
  ]) assert.throws(() => runtime.validateModels({ models: { roles } }), /models|role|engine|effort|provider|transport/i);
});
test('pairing acceptance binds all route fields, risks and a Linear decision', () => {
  const config = { models: { roles: { autoreview: reviewer() } } };
  assert.throws(() => runtime.validateModels(config), /pair.*worker-default.*autoreview/i);
  accepted(config);
  assert.doesNotThrow(() => runtime.validateModels(config));
  for (const mutate of [
    c => c.models.roles.autoreview.model += '-changed',
    c => c.models.roles.autoreview.provider.endpoint += '/changed',
    c => c.models.roles.autoreview.provider.id = 'different-provider',
    c => c.models.roles.autoreview.provider.credentialEnv = 'ANOTHER_CREDENTIAL',
    c => c.models.roles.autoreview.effortByRisk.tiny = 'low',
    c => c.models.pairingAccepted[0].riskClasses.pop(),
    c => c.models.pairingAccepted[0].linearDecision = '',
    c => c.models.roles['worker-default'] = { engine: 'codex', model: 'example-worker', effort: 'high' },
  ]) { const changed = structuredClone(config); mutate(changed); assert.throws(() => runtime.validateModels(changed), /pair|linearDecision/i); }
  const reordered = { models: { pairingAccepted: config.models.pairingAccepted, roles: config.models.roles } };
  assert.notEqual(JSON.stringify(config), JSON.stringify(reordered));
  assert.equal(runtime.resolveRole('autoreview', config).fingerprint, runtime.resolveRole('autoreview', reordered).fingerprint);
  for (const engine of ['claude', 'kimi', 'pi', 'codex']) {
    const c = accepted({ models: { roles: { autoreview: reviewer(engine) } } });
    assert.equal(runtime.resolveRole('autoreview', c).engine, engine);
  }
});
test('provider endpoints reject credential-shaped path segments before route persistence', () => {
  const config = accepted({ models: { roles: { autoreview: reviewer() } } });
  for (const pathname of ['/v1/sk-placeholder', '/v1/%73%6b%2dplaceholder', '/v1/route%2Fsk-placeholder']) {
    const changed = structuredClone(config);
    changed.models.roles.autoreview.provider.endpoint = 'https://models.example.invalid' + pathname;
    assert.throws(() => runtime.requiredPairings(changed), /endpoint.*credential/i);
  }
  assert.doesNotThrow(() => runtime.validateModels(config));
});
test('CLI check enforces pair refusal and acceptance on real config files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-role-config-'));
  try {
    const config = JSON.parse(fs.readFileSync('.agents/mono-workflow.config.json'));
    config.models = { roles: { autoreview: reviewer() } };
    fs.mkdirSync(path.join(root, '.agents'));
    const file = path.join(root, '.agents/mono-workflow.config.json');
    const check = () => spawnSync(process.execPath, ['scripts/project-config.mjs', '--repo', root, '--check'], { encoding: 'utf8' });
    fs.writeFileSync(file, JSON.stringify(config));
    let result = check(); assert.equal(result.status, 1); assert.match(result.stderr, /pair.*worker-default.*autoreview/i);
    fs.writeFileSync(file, JSON.stringify(accepted(config)));
    result = check(); assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('non-model token settings remain valid through CLI and BASE role resolution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-model-scan-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  try {
    git('init', '-b', 'main');
    fs.mkdirSync(path.join(root, '.agents'));
    const file = path.join(root, '.agents/mono-workflow.config.json');
    const config = JSON.parse(fs.readFileSync('.agents/mono-workflow.config.json'));
    config.orchestration.maxTokens = 512000;
    config.deploy = { tokenEnv: 'DEPLOY_TOKEN' };
    const check = () => spawnSync(process.execPath, ['scripts/project-config.mjs', '--repo', root, '--check'], { encoding: 'utf8' });
    for (const models of [undefined, { roles: {} }]) {
      if (models === undefined) delete config.models; else config.models = models;
      fs.writeFileSync(file, JSON.stringify(config));
      const result = check(); assert.equal(result.status, 0, result.stderr);
      const role = runtime.resolveRole('autoreview', config);
      git('add', '.'); git('commit', '-m', 'non-model token settings');
      const pins = runtime.resolveModelRoutes(root, git('rev-parse', 'HEAD'), 'worker-default');
      assert.deepEqual(pins.roles.autoreview, role);
    }
    config.models = { roles: { autoreview: reviewer() } }; accepted(config);
    config.models.roles.autoreview.provider.apiKey = String(Math.random());
    fs.writeFileSync(file, JSON.stringify(config));
    const result = check(); assert.equal(result.status, 1); assert.match(result.stderr, /credential|fields/i);
    assert.throws(() => runtime.resolveRole('autoreview', config), /credential|fields/i);
    git('add', '.'); git('commit', '-m', 'invalid model credential field');
    assert.throws(() => runtime.resolveModelRoutes(root, git('rev-parse', 'HEAD'), 'worker-default'), /credential|fields/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
