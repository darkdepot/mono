import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { codexPackage } from './codex-package.mjs';

function packageFixture(t, { symlink = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-codex-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), data);
  };
  git('init', '-q');
  git('config', 'user.name', 'Packaging fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  write('VERSION', '1.2.3\n');
  write('CHANGELOG.md', '## [1.2.3]\n\nFixture release.\n');
  for (const host of ['codex', 'claude']) write(`.${host}-plugin/plugin.json`, JSON.stringify({
    name: 'mono', version: '1.2.3', hooks: './hooks/hooks.json',
  }));
  write('.agents/plugins/marketplace.json', JSON.stringify({
    name: 'mono-marketplace',
    plugins: [{ name: 'mono', source: { source: 'local', path: './' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Coding' }],
  }));
  write('hooks/hooks.json', JSON.stringify({ hooks: Object.fromEntries(['PreToolUse', 'Stop', 'UserPromptSubmit'].map(event => [event,
    [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/noop.mjs"' }] }],
  ])) }));
  write('scripts/noop.mjs', 'process.exit(0);\n');
  fs.chmodSync(path.join(root, 'scripts/noop.mjs'), 0o755);
  if (symlink) fs.symlinkSync('scripts/noop.mjs', path.join(root, 'noop-link'));
  git('add', '.'); git('commit', '-qm', 'Source release'); git('tag', 'v1.2.3');
  return { root, git, write };
}

test('Codex payload is the exact released tree, preserving executable modes', t => {
  const { root, git, write } = packageFixture(t);
  const before = git('rev-parse', 'HEAD');
  write('untracked-secret', 'never ship working tree files');
  write('VERSION', 'dirty working tree');
  const built = codexPackage(root, 'v1.2.3', { writeTag: true });
  assert.equal(git('rev-parse', `${built.distributionCommit}:plugins/mono`), git('rev-parse', 'v1.2.3^{tree}'));
  assert.match(git('ls-tree', built.distributionCommit, 'plugins/mono/scripts/noop.mjs'), /^100755 blob/);
  const catalog = JSON.parse(git('show', `${built.distributionCommit}:.agents/plugins/marketplace.json`));
  assert.equal(catalog.plugins[0].source.path, './plugins/mono');
  assert.deepEqual(JSON.parse(git('show', `${built.distributionCommit}:release.json`)), {
    schemaVersion: 1, sourceTag: 'v1.2.3', sourceCommit: built.sourceCommit, sourceTree: built.sourceTree,
  });
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(git('rev-parse', 'v1.2.3'), before);
  assert.equal(fs.readFileSync(path.join(root, 'VERSION'), 'utf8'), 'dirty working tree');
});

test('Codex distribution is deterministic across clones and repeated tag creation', t => {
  const { root, git } = packageFixture(t);
  const first = codexPackage(root, 'v1.2.3', { writeTag: true });
  git('config', 'i18n.commitEncoding', 'ISO-8859-1');
  git('config', 'commit.gpgSign', 'true');
  assert.deepEqual(codexPackage(root, 'v1.2.3', { writeTag: true }), first);
  const clone = path.join(root, 'second-clone');
  git('clone', '-q', '--no-local', root, clone);
  fs.appendFileSync(path.join(clone, '.git/logs/HEAD'), '\nDifferent installation metadata\n');
  assert.deepEqual(codexPackage(clone, 'v1.2.3'), first);
});

test('Codex packaging refuses tag collisions without changing either release ref', t => {
  const { root, git } = packageFixture(t);
  git('tag', 'codex-v1.2.3');
  const before = git('show-ref', '--tags');
  assert.throws(() => codexPackage(root, 'v1.2.3', { writeTag: true }), /refusing to replace/);
  assert.equal(git('show-ref', '--tags'), before);
});

test('Codex packaging refuses symlinks instead of allowing the host to drop payload files', t => {
  const { root } = packageFixture(t, { symlink: true });
  assert.throws(() => codexPackage(root, 'v1.2.3'), /must not contain symlinks/);
});

test('Codex packaging refuses missing tags, version mismatches and submodules', t => {
  const { root, git, write } = packageFixture(t);
  assert.throws(() => codexPackage(root, 'missing'), /not an existing version tag/);
  git('tag', 'v9.0.0');
  assert.throws(() => codexPackage(root, 'v9.0.0'), /tag\/version mismatch/);
  git('update-index', '--add', '--cacheinfo', `160000,${git('rev-parse', 'HEAD')},nested`);
  write('VERSION', '1.2.4\n');
  write('CHANGELOG.md', '## [1.2.4]\n\nFixture release.\n');
  for (const host of ['codex', 'claude']) write(`.${host}-plugin/plugin.json`, JSON.stringify({ name: 'mono', version: '1.2.4' }));
  git('add', 'VERSION', 'CHANGELOG.md', '.codex-plugin', '.claude-plugin');
  git('commit', '-qm', 'Submodule release'); git('tag', 'v1.2.4');
  assert.throws(() => codexPackage(root, 'v1.2.4'), /must not contain submodules/);
});

// CI pins the official CLI; local runs opt in with MONO_CODEX_BIN. All writes,
// including test trust, stay in this fixture's private profile. No turn starts.
test('real Codex migrates legacy installs and preserves trust on same-version reinstall', {
  skip: !process.env.MONO_CODEX_BIN,
  timeout: 60000,
}, async t => {
  const { root, git, write } = packageFixture(t);
  const home = path.join(root, 'private-codex-home');
  fs.mkdirSync(home);
  const gitConfig = path.join(root, 'private-gitconfig');
  fs.writeFileSync(gitConfig, `[url "${pathToFileURL(root).href}"]\n\tinsteadOf = https://example.invalid/mono-packaging.git\n`);
  const env = { ...process.env, CODEX_HOME: home, GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const bin = process.env.MONO_CODEX_BIN;
  const cli = (...args) => execFileSync(bin, args, { cwd: root, env, encoding: 'utf8', timeout: 15000, stdio: 'pipe' });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const child = spawn(bin, ['app-server', '--stdio'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    let stderr = '', settled = false;
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    const timer = setTimeout(() => finish(new Error(`Codex RPC timeout: ${method}\n${stderr}`)), 10000);
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); lines.close(); child.kill();
      error ? reject(error) : resolve(result);
    };
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', error => finish(error));
    child.on('exit', code => { if (!settled) finish(new Error(`Codex exited ${code}: ${stderr}`)); });
    lines.on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.error) return finish(new Error(JSON.stringify(message.error)));
        if (message.id === 1) {
          send({ method: 'initialized', params: {} }); send({ id: 2, method, params });
        } else if (message.id === 2) finish(null, message.result);
      } catch (error) { finish(error); }
    });
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'mono_packaging_test', version: '1' }, capabilities: { experimentalApi: true },
    } });
  });
  const hooks = async () => {
    const result = await rpc('hooks/list', { cwds: [root] });
    assert.deepEqual(result.data[0].errors, []);
    assert.deepEqual(result.data[0].warnings, []);
    assert.equal(result.data[0].hooks.length, 3);
    return result.data[0].hooks;
  };
  const install = tag => {
    cli('plugin', 'marketplace', 'add', 'https://example.invalid/mono-packaging.git', '--ref', tag, '--json');
    return JSON.parse(cli('plugin', 'add', 'mono@mono-marketplace', '--json')).installedPath;
  };
  const packageTag = codexPackage(root, 'v1.2.3', { writeTag: true }).distributionTag;
  const legacyPath = install('v1.2.3');
  assert.equal(fs.existsSync(path.join(legacyPath, '.git')), true);
  const legacy = await hooks();
  await rpc('config/batchWrite', {
    edits: [{ keyPath: 'hooks.state', mergeStrategy: 'upsert',
      value: Object.fromEntries(legacy.map(hook => [hook.key, { trusted_hash: hook.currentHash }])) }],
    reloadUserConfig: true,
  });
  assert.ok((await hooks()).every(hook => hook.trustStatus === 'trusted'));
  cli('plugin', 'marketplace', 'remove', 'mono-marketplace', '--json');
  const firstPath = install(packageTag);
  assert.equal(firstPath, legacyPath);
  assert.equal(fs.existsSync(path.join(firstPath, '.git')), false);
  const installedFiles = [];
  const inspect = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) inspect(path.join(directory, entry.name), relative + '/');
      else installedFiles.push(relative);
    }
  };
  inspect(firstPath);
  assert.deepEqual(installedFiles.sort(), git('ls-tree', '-r', '--name-only', 'v1.2.3').split('\n').sort());
  assert.ok(fs.statSync(path.join(firstPath, 'scripts/noop.mjs')).mode & 0o111);
  const first = await hooks();
  assert.ok(first.every(hook => hook.trustStatus === 'modified'));
  assert.notDeepEqual(first.map(hook => hook.currentHash), legacy.map(hook => hook.currentHash));
  await rpc('config/batchWrite', {
    edits: [{ keyPath: 'hooks.state', mergeStrategy: 'upsert',
      value: Object.fromEntries(first.map(hook => [hook.key, { trusted_hash: hook.currentHash }])) }],
    reloadUserConfig: true,
  });
  assert.ok((await hooks()).every(hook => hook.trustStatus === 'trusted'));

  cli('plugin', 'marketplace', 'remove', 'mono-marketplace', '--json');
  const secondPath = install(packageTag);
  assert.equal(secondPath, firstPath);
  assert.equal(fs.existsSync(path.join(secondPath, '.git')), false);
  const second = await hooks();
  assert.deepEqual(second.map(hook => hook.currentHash), first.map(hook => hook.currentHash));
  assert.ok(second.every(hook => hook.trustStatus === 'trusted'));

  // A real changed release must still revoke the previous package's trust.
  write('VERSION', '1.2.4\n'); write('CHANGELOG.md', '## [1.2.4]\n\nChanged hook.\n');
  write('scripts/noop.mjs', 'process.exitCode = 0;\n');
  for (const host of ['codex', 'claude']) {
    const file = `.${host}-plugin/plugin.json`;
    const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    write(file, JSON.stringify({ ...manifest, version: '1.2.4' }));
  }
  git('add', 'VERSION', 'CHANGELOG.md', 'scripts/noop.mjs', '.codex-plugin', '.claude-plugin');
  git('commit', '-qm', 'Changed release'); git('tag', 'v1.2.4');
  const changedTag = codexPackage(root, 'v1.2.4', { writeTag: true }).distributionTag;
  cli('plugin', 'marketplace', 'remove', 'mono-marketplace', '--json');
  install(changedTag);
  const changed = await hooks();
  assert.ok(changed.every(hook => hook.trustStatus === 'modified'));
  assert.notDeepEqual(changed.map(hook => hook.currentHash), first.map(hook => hook.currentHash));
});
