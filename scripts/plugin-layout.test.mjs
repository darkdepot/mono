import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { packLayout, identity } from './runtime.mjs';
import { checkPlugin } from './validate-plugin.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('plugin layout shares the repository paths and reads identity without a lock', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-plugin-layout-')));
  try {
    fs.writeFileSync(path.join(root, 'VERSION'), '0.22.0\n');
    const layout = packLayout(root);
    assert.deepEqual(layout.identity(), { packVersion: '0.22.0', surfaceRevision: 4 });
    assert.equal(layout.skill('mono-deliver'), path.join(root, 'skills/mono-deliver/SKILL.md'));
    assert.equal(layout.template('orchestrator-dispatch.md'), path.join(root, 'templates/orchestrator-dispatch.md'));
    assert.equal(layout.policyDirectory, path.join(root, 'references'));
    assert.equal(layout.script('gate.mjs'), path.join(root, 'scripts/gate.mjs'));
    assert.equal(identity(layout.identity()), true);
    assert.equal(identity({ ...layout.identity(), sourceCommit: null }), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('legacy layout preserves installed paths and lock identity', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-legacy-layout-')));
  try {
    const expected = { packVersion: '0.22.0', sourceCommit: 'a'.repeat(40), surfaceRevision: 4 };
    fs.writeFileSync(path.join(root, '.mono-agent-workflow.lock.json'), JSON.stringify(expected));
    const layout = packLayout(root);
    assert.deepEqual(layout.identity(), expected);
    assert.equal(layout.skill('mono-deliver'), path.join(root, 'mono-deliver/SKILL.md'));
    assert.equal(layout.template('orchestrator-dispatch.md'), path.join(root, 'mono-orchestrate/templates/orchestrator-dispatch.md'));
    assert.equal(layout.policyDirectory, path.join(root, 'mono-implement/references'));
    assert.equal(layout.script('gate.mjs'), path.join(root, '.mono-agent-workflow/scripts/gate.mjs'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('missing task pack folder requires a new attempt', () => {
  assert.throws(() => packLayout(path.join(os.tmpdir(), 'mono-plugin-folder-absent')), /pack.*missing.*new attempt/);
});

test('legacy installation rewrites pack script paths in skills and shared references', () => {
  const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-plugin-legacy-text-')), skills = path.join(root, 'skills');
  const env = { ...process.env, MONO_WORKFLOW_STATE_ROOT: path.join(root, 'state'), MONO_WORKFLOW_KNOWN_ROOTS: skills };
  try {
    for (const extra of [[], ['--check']]) {
      const result = spawnSync(process.execPath, ['scripts/install-local.mjs', '--skills-root', skills, ...extra], { cwd: checkout, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    const issue = fs.readFileSync(path.join(skills, 'mono-issue/SKILL.md'), 'utf8');
    assert.ok(issue.includes('node ../.mono-agent-workflow/scripts/resolve-issue-context.mjs'));
    const contract = fs.readFileSync(path.join(skills, 'mono-deliver/references/worker-contract.md'), 'utf8');
    assert.ok(contract.includes("node '<skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity"));
    const orchestration = fs.readFileSync(path.join(skills, 'mono-orchestrate/references/orchestration.md'), 'utf8');
    for (const name of ['spawn', 'resume']) {
      const operand = orchestration.match(new RegExp(`node '([^']+/orchestrator/${name}\\.mjs)'`))?.[1];
      assert.ok(operand, `installed ${name} command has an explicit root`);
      const script = operand.replace('<skills-root>', skills);
      assert.ok(path.isAbsolute(script));
      const result = spawnSync(process.execPath, [script, '--help'], { cwd: os.tmpdir(), env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage:/);
    }
    for (const skill of ['mono-deploy', 'mono-orchestrate']) {
      const text = fs.readFileSync(path.join(skills, skill, 'SKILL.md'), 'utf8');
      const operand = text.match(/node '([^']+\/wave-cost\.mjs)'/)?.[1];
      assert.ok(operand, `installed ${skill} cost command has an explicit root`);
      assert.ok(fs.statSync(operand.replace('<skills-root>', skills)).isFile());
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('plugin checks reject version drift, a root manifest and any missing skill file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-plugin-checks-'));
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); };
  try {
    write('VERSION', '0.22.0\n');
    const valid = { name: 'mono', version: '0.22.0', skills: './skills/' };
    for (const tool of ['claude', 'codex']) write(`.${tool}-plugin/plugin.json`, JSON.stringify(valid));
    write('skills/fixture/SKILL.md', 'Read `references/shared.md` and run `scripts/worker.mjs`.');
    write('references/shared.md', 'shared'); write('scripts/worker.mjs', '');
    assert.deepEqual(checkPlugin(root), []);
    for (const tool of ['claude', 'codex']) {
      write(`.${tool}-plugin/plugin.json`, JSON.stringify({ ...valid, version: '0.23.0' }));
      assert.match(checkPlugin(root).join('\n'), /version must equal VERSION/);
      write(`.${tool}-plugin/plugin.json`, JSON.stringify({ ...valid, name: undefined }));
      assert.match(checkPlugin(root).join('\n'), /name must be mono/);
      write(`.${tool}-plugin/plugin.json`, JSON.stringify({ ...valid, skills: './absent/' }));
      assert.match(checkPlugin(root).join('\n'), /skills must resolve to the pack skills directory/);
      write(`.${tool}-plugin/plugin.json`, JSON.stringify(valid));
    }
    write('plugin.json', '{}'); assert.match(checkPlugin(root).join('\n'), /root plugin.json is forbidden/);
    fs.unlinkSync(path.join(root, 'plugin.json'));
    for (const file of ['references/shared.md', 'scripts/worker.mjs']) {
      fs.unlinkSync(path.join(root, file)); assert.match(checkPlugin(root).join('\n'), /missing pack file/); write(file, '');
    }
    write('skills/fixture/SKILL.md', 'Invoke scripts/not-present.mjs without backticks.');
    assert.match(checkPlugin(root).join('\n'), /missing pack file scripts\/not-present.mjs/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('dispatch pins the plugin script folder and refuses resume when that folder disappears', async () => {
  const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-plugin-dispatch-')));
  const pack = path.join(scratch, 'plugin'), repo = path.join(scratch, 'product'), root = path.join(scratch, 'state');
  const helper = path.join(scratch, 'external-skills'), bin = path.join(scratch, 'bin'), temp = path.join(scratch, 'temp');
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const run = (command, args, cwd = repo) => { const r = spawnSync(command, args, { cwd, env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout.trim(); };
  let pid;
  try {
    for (const folder of [pack, repo, root, helper, bin, temp]) fs.mkdirSync(folder, { recursive: true });
    for (const folder of ['scripts', 'references', 'templates', 'skills']) fs.cpSync(path.join(checkout, folder), path.join(pack, folder), { recursive: true });
    fs.copyFileSync(path.join(checkout, 'VERSION'), path.join(pack, 'VERSION'));
    write(path.join(bin, 'codex'), '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"fixture"}));setInterval(()=>{},1000);\n');
    write(path.join(bin, 'ps'), '#!/usr/bin/env node\nconsole.log("fixture-start");\n');
    for (const tool of ['codex', 'ps']) fs.chmodSync(path.join(bin, tool), 0o700);
    run('git', ['init', '-b', 'main']); run('git', ['init', '--bare', path.join(scratch, 'origin.git')]); run('git', ['remote', 'add', 'origin', path.join(scratch, 'origin.git')]);
    const config = path.join(repo, '.agents/mono-workflow.config.json');
    write(config, { projectName: 'Fixture', orchestration: { transport: 'codex-cli', dispatch: { product: 'fixture', evidenceRoot: path.join(scratch, 'evidence'), openDecisions: 0, verification: { command: 'node', args: ['verify.mjs'] }, lifecycle_moves: [] } } });
    write(path.join(repo, '.gitignore'), '.worktrees/\n'); run('git', ['add', '.']); run('git', ['commit', '-m', 'fixture']); run('git', ['push', 'origin', 'main']);
    write(path.join(root, 'control.json'), { state: 'active', halt: false }); write(path.join(root, 'workers.json'), {});
    const snapshot = path.join(scratch, 'snapshot');
    write(path.join(snapshot, 'issue-MONO-999.md'), '# Fixture\n# Что сделать\nPlugin dispatch\n# Готовность агента\nAFK\n# Как проверить\nRun verification\n# Ключевые контракты\nKeep roots\nРиск: risky\n');
    for (const file of ['approval.md', 'project-brief.md', 'prd.md', 'tech-spec.md']) write(path.join(snapshot, file), 'Approved fixture');
    const writable = path.join(scratch, 'writable.json'); write(writable, [temp]);
    const launched = JSON.parse(run(process.execPath, [path.join(pack, 'scripts/orchestrator/dispatch.mjs'), '--issue', 'MONO-999', '--root', root, '--config', config, '--snapshot', snapshot, '--skills-root', helper, '--worker-writable-roots', writable])); pid = launched.pid;
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'workers.json')))['MONO-999'];
    assert.equal(saved.packRoot, pack); assert.equal(saved.skillsRoot, helper); assert.equal(saved.sourceCommit, undefined);
    const pins = JSON.parse(fs.readFileSync(launched.pins.file)); assert.equal(pins.packRoot, pack); assert.equal(pins.surfaceRevision, 4);
    const rendered = fs.readFileSync(launched.dispatchFile, 'utf8'); assert.ok(rendered.includes(path.join(pack, 'skills/mono-deliver/SKILL.md')));
    assert.ok(rendered.includes(`--pack-root '${pack}'`)); assert.ok(!rendered.includes('--source-commit'));
    const spawnRequest = JSON.parse(fs.readFileSync(launched.spawnFile));
    for (const [folder, reason] of [[pack, /packRoot must be outside/], [helper, /installed skillsRoot must be outside/]]) {
      const guarded = { ...spawnRequest, issue: 'MONO-997', writable_roots: [temp, folder], workerWritableRoots: [...spawnRequest.workerWritableRoots, folder].sort() };
      const file = path.join(scratch, 'guarded.json'); write(file, guarded);
      const result = spawnSync(process.execPath, [path.join(pack, 'scripts/orchestrator/spawn.mjs'), '--request', file], { cwd: repo, env, encoding: 'utf8' });
      assert.equal(result.status, 1); assert.match(result.stderr, reason);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'workers.json')))['MONO-997'], undefined);
    }
    process.kill(pid, 'SIGTERM'); await new Promise(resolve => setTimeout(resolve, 100)); pid = null;
    saved.pid = null; write(path.join(root, 'workers.json'), { 'MONO-999': saved });
    const resume = path.join(scratch, 'resume.md'); write(resume, 'Resume');
    fs.renameSync(pack, pack + '-removed');
    const request = path.join(scratch, 'resume.json'); write(request, { root, issue: 'MONO-999', resumeFile: resume });
    const refusal = spawnSync(process.execPath, [path.join(checkout, 'scripts/orchestrator/resume.mjs'), '--request', request], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(refusal.status, 1); assert.match(refusal.stderr, /pack folder missing:.*start a new attempt/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'workers.json')))['MONO-999'], saved);
  } finally {
    if (pid) { try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
