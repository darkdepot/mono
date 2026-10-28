import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { copyChainSnapshot } from './orchestrator/chain-snapshot.mjs';

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-chain-'));
  const source = path.join(root, 'source'), target = path.join(root, 'snapshot'), key = 'MONO-991';
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'merged predecessor');
  const base = git('rev-parse', 'HEAD'), approval = 'mono-package: start issues=T1:MONO-991,T2:MONO-993';
  fs.mkdirSync(target);
  write(path.join(source, 'issue-context.json'), { issueKey: 'MONO-993', blockedBy: [key, 'OTHER-1'] });
  const directory = path.join(source, 'predecessors', key);
  write(path.join(directory, 'merge.json'), { issue: key, mergeCommit: base, head: 'a'.repeat(40) });
  write(path.join(directory, 'code-report.json'), { issue: key, phase: 'code', phase_result: 'implemented-needs-preflight', head: 'a'.repeat(40), criteria: [{ criterion: 'Команда работает' }] });
  const copy = () => copyChainSnapshot(source, target, 'MONO-993', approval, root, base);
  try { run({ root, source, target, directory, key, base, write, copy }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('chain dispatch copies both final report and verified merged commit, only within the package', () => fixture(f => {
  const result = f.copy();
  assert.deepEqual(result.predecessors.map(p => [p.issue, p.mergeCommit, p.legacy]), [[f.key, f.base, false]]);
  assert.ok(fs.existsSync(path.join(f.target, 'predecessors', f.key, 'code-report.json')), 'the copied predecessor report must exist');
  assert.deepEqual(fs.readFileSync(path.join(f.target, 'predecessors', f.key, 'code-report.json')), fs.readFileSync(path.join(f.directory, 'code-report.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.target, 'predecessors', f.key, 'merge.json'))).mergeCommit, f.base);
  assert.equal(fs.existsSync(path.join(f.target, 'predecessors/OTHER-1')), false);
}));
test('chain dispatch accepts an old report as input without a promised criteria list', () => fixture(f => {
  fs.unlinkSync(path.join(f.directory, 'code-report.json'));
  f.write(path.join(f.directory, 'code-report.md'), 'Код написан. Передан в Preflight.');
  assert.equal(f.copy().predecessors[0].legacy, true);
  assert.match(fs.readFileSync(path.join(f.target, 'predecessors', f.key, 'code-report.md'), 'utf8'), /Код написан/);
}));
test('chain dispatch supplies no predecessor files without a package predecessor', () => fixture(f => {
  f.write(path.join(f.source, 'issue-context.json'), { blockedBy: ['OTHER-1'] });
  assert.equal(f.copy(), null); assert.deepEqual(fs.readdirSync(f.target), []);
}));
test('chain dispatch accepts legacy JSON without a criteria or phase field', () => fixture(f => {
  f.write(path.join(f.directory, 'code-report.json'), { issue: f.key, stage: 'mono-implement', status: 'implemented-needs-preflight' });
  assert.equal(f.copy().predecessors[0].legacy, true);
}));
test('a project Issue without a declared package gets no chain input for an external blocker', () => fixture(f => {
  f.write(path.join(f.source, 'issue-context.json'), { blockedBy: ['OTHER-1'] });
  assert.equal(copyChainSnapshot(f.source, f.target, 'MONO-993', 'Approved project Issue', f.root, f.base), null);
  assert.deepEqual(fs.readdirSync(f.target), []);
}));
test('chain dispatch blocks missing reports and commits outside main', () => fixture(f => {
  fs.unlinkSync(path.join(f.directory, 'code-report.json'));
  assert.throws(f.copy, /blocked: нет отчёта предшественницы/);
  f.write(path.join(f.directory, 'code-report.md'), 'Старый отчёт');
  f.write(path.join(f.directory, 'merge.json'), { issue: f.key, mergeCommit: 'a'.repeat(40) });
  assert.throws(f.copy, /not on dispatch main/);
  assert.deepEqual(fs.readdirSync(f.target), []);
}));

test('chain dispatch accepts an earlier code head when Preflight commits advance the merged head', () => fixture(f => {
  const git = (...args) => execFileSync('git', ['-C', f.root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Preflight commit and review fix');
  const merged = git('rev-parse', 'HEAD');
  f.write(path.join(f.directory, 'merge.json'), { issue: f.key, mergeCommit: merged, head: merged });
  f.write(path.join(f.directory, 'code-report.json'), { issue: f.key, phase: 'code', phase_result: 'implemented-needs-preflight', head: f.base, criteria: [{ criterion: 'Команда работает' }] });
  const result = copyChainSnapshot(f.source, f.target, 'MONO-993', 'mono-package: start issues=T1:MONO-991,T2:MONO-993', f.root, merged);
  assert.equal(result.predecessors[0].mergeCommit, merged);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.target, 'predecessors', f.key, 'code-report.json'))).head, f.base);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.target, 'predecessors', f.key, 'merge.json'))).head, merged);
}));
