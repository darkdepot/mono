import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { startGate } from './gate.mjs';
import { atomicJson, packLayout } from './runtime.mjs';
import { sha256File } from './orchestrator/command-state.mjs';

test('startup refuses a stale attempt even with identical branch/base/pack, and rejects amended pins', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-start-binding-'));
  try {
    const root = path.join(scratch, 'control'), worktree = path.join(scratch, 'repo'); fs.mkdirSync(worktree);
    const git = (...args) => execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'task'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'base');
    const layout = packLayout(path.resolve('.'));
    const file = path.join(root, 'dispatch/MONO-993-a1/pins.json');
    const pins = { worktree, branch: 'task', base: git('rev-parse', 'HEAD'), packRoot: layout.root, ...layout.identity(), risk: 'risky', critical: null };
    atomicJson(file, pins);
    const binding = { file, digest: sha256File(file) }, request = { ...pins, root, issue: 'MONO-993', attempt: 1, pins: binding };
    atomicJson(path.join(root, 'workers.json'), {});
    assert.doesNotThrow(() => startGate(request, { beforeSpawn: true }));
    assert.throws(() => startGate(request), /stale dispatch attempt/, 'an unregistered worker cannot use the pre-spawn allowance');
    const entry = { ...request, stage: 'mono-deliver', pinsVersion: 0 };
    const idea = { path: 'fixture' };
    atomicJson(file, { ...pins, idea }); request.pins.digest = binding.digest = sha256File(file);
    atomicJson(path.join(root, 'workers.json'), { [request.issue]: entry });
    atomicJson(path.join(root, 'attempts.json'), { [request.issue]: 1 });
    assert.doesNotThrow(() => startGate(request));
    atomicJson(path.join(root, 'workers.json'), { [request.issue]: { ...entry, attempt: 2 } });
    atomicJson(path.join(root, 'attempts.json'), { [request.issue]: 2 });
    assert.throws(() => startGate(request), /stale dispatch attempt/);
    assert.throws(() => startGate(request, { beforeSpawn: true }), /stale dispatch attempt/);
    atomicJson(path.join(root, 'workers.json'), { [request.issue]: { ...entry, pinsVersion: 1 } });
    atomicJson(path.join(root, 'attempts.json'), { [request.issue]: 1 });
    atomicJson(path.join(path.dirname(file), 'pins.v1.json'), { pinsVersion: 1, risk: 'risky' });
    assert.throws(() => startGate(request), /stale dispatch pins/);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
