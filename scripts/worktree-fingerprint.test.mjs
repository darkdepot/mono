import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { worktreeFingerprint } from './worktree-fingerprint.mjs';

test('fingerprint-delivery-root excludes only tracked and untracked delivery paths', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-fingerprint-'));
  const git = args => execFileSync('git', args, { cwd: repo });
  const write = (file, text) => fs.writeFileSync(path.join(repo, file), text);
  try {
    git(['init', '-q']); fs.mkdirSync(path.join(repo, '.orchestrator'));
    write('code.mjs', 'export const count = 1;\n'); write('.orchestrator/tracked', 'old\n');
    write('.gitignore', 'ignored\n'); git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base']);
    const empty = createHash('sha256').digest('hex');
    assert.equal(worktreeFingerprint(repo), empty);
    write('.orchestrator/tracked', 'new\n'); write('.orchestrator/report.json', '{}');
    write('ignored', 'ignored');
    assert.equal(worktreeFingerprint(repo), empty);
    write('code.mjs', 'export const count = 2;\n');
    const diff = git(['diff', '--binary', 'HEAD', '--', '.', ':(top,exclude,literal).orchestrator']);
    assert.equal(worktreeFingerprint(repo), createHash('sha256').update(diff).digest('hex'));
    const changed = worktreeFingerprint(repo);
    write('report.json', 'outside delivery-root is code evidence too');
    assert.notEqual(worktreeFingerprint(repo), changed);
    write('a space', 'binary\0bytes');
    const expected = createHash('sha256').update(diff);
    for (const file of ['a space', 'report.json']) expected.update(file + '\0' + createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex') + '\0');
    assert.equal(worktreeFingerprint(repo), expected.digest('hex'));
    assert.notEqual(worktreeFingerprint(repo, path.join(repo, 'elsewhere')), worktreeFingerprint(repo));
    assert.equal(worktreeFingerprint(repo, path.join(repo, '.orchestrator')), worktreeFingerprint(repo));
    assert.notEqual(worktreeFingerprint(repo, path.join(repo, '.orchestrator/tracked')), worktreeFingerprint(repo));
    assert.notEqual(worktreeFingerprint(repo, os.tmpdir()), worktreeFingerprint(repo));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

for (const [name, before, after] of [
  ['tracked-delivery', "inside ? ['--', '.', `:(top,exclude,literal)${relative}`] : []", '[]'],
  ['untracked-delivery', "!(inside && (name === relative || name.startsWith(relative + '/')))", 'true'],
  ['untracked-code', "for (const name of files) hash.update", 'for (const name of []) hash.update'],
]) test(`fingerprint deliberate-break ${name} makes the consumer regression red`, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-fingerprint-mutation-'));
  try {
    fs.cpSync(path.resolve('scripts'),path.join(root,'scripts'),{recursive:true});
    const file=path.join(root,'scripts/worktree-fingerprint.mjs'),source=fs.readFileSync(file,'utf8');
    assert.ok(source.includes(before),name);fs.writeFileSync(file,source.replace(before,after));
    const run=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^fingerprint-delivery-root','scripts/worktree-fingerprint.test.mjs'],
      {cwd:root,encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='NODE_TEST_CONTEXT'))});
    assert.equal(run.status,1,run.stdout+run.stderr);assert.match(run.stdout,/not ok/);
    assert.doesNotMatch(run.stdout+run.stderr,/ERR_MODULE_NOT_FOUND|SyntaxError/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
