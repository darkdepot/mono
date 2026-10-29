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

test('fingerprint-untracked-symlinks hashes Git link contents, including directory and dangling targets', () => {
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),'mono-fingerprint-links-'));
  const git=args=>execFileSync('git',args,{cwd:repo});
  try {
    git(['init','-q']);fs.writeFileSync(path.join(repo,'code'),'base');git(['add','.']);
    git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base']);
    for(const [name,target] of [['directory-link','.git'],['file-link','code'],['missing-link','absent']])
      fs.symlinkSync(target,path.join(repo,name));
    const expected=createHash('sha256');
    for(const [name,target] of [['directory-link','.git'],['file-link','code'],['missing-link','absent']])
      expected.update(name+'\0'+createHash('sha256').update(target).digest('hex')+'\0');
    const before=worktreeFingerprint(repo);
    assert.equal(before,expected.digest('hex'));
    fs.unlinkSync(path.join(repo,'missing-link'));fs.symlinkSync('other-absent',path.join(repo,'missing-link'));
    assert.notEqual(worktreeFingerprint(repo),before,'changing a link target changes the Git content');
  } finally {fs.rmSync(repo,{recursive:true,force:true});}
});

function nestedFixture(run) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-fingerprint-nested-'));
  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const commit = cwd => git(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  try {
    git(repo, ['init', '-q']); commit(repo);
    const nested = path.join(repo, 'nested'); fs.mkdirSync(nested); git(nested, ['init', '-q']);
    run({ repo, nested, git, commit });
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
}

const gitlinkDigest = sha => createHash('sha256').update('nested/\0gitlink:' + sha + '\0').digest('hex');

test('fingerprint-nested-committed uses full gitlink HEAD, sorted with files, and ignores nested dirty contents', () => {
  nestedFixture(({repo, nested, git, commit}) => {
    fs.writeFileSync(path.join(nested, 'input'), 'first'); git(nested, ['add', '.']); commit(nested);
    const sha = git(nested, ['rev-parse', 'HEAD']);
    assert.equal(git(repo, ['ls-files', '--others', '--exclude-standard']), 'nested/');
    assert.equal(worktreeFingerprint(repo), gitlinkDigest(sha));
    fs.writeFileSync(path.join(nested, 'input'), 'dirty'); fs.writeFileSync(path.join(nested, 'extra'), 'untracked');
    assert.equal(worktreeFingerprint(repo), gitlinkDigest(sha));
    const expected = createHash('sha256');
    fs.writeFileSync(path.join(repo, 'a file'), 'a'); fs.writeFileSync(path.join(repo, 'z file'), 'z');
    expected.update('a file\0' + createHash('sha256').update('a').digest('hex') + '\0');
    expected.update('nested/\0gitlink:' + sha + '\0');
    expected.update('z file\0' + createHash('sha256').update('z').digest('hex') + '\0');
    assert.equal(worktreeFingerprint(repo), expected.digest('hex'));
  });
});

test('fingerprint-nested-unborn uses gitlink:none before the first commit', () => {
  nestedFixture(({repo, nested, git}) => {
    fs.writeFileSync(path.join(nested, 'input'), 'not committed');
    assert.equal(git(repo, ['ls-files', '--others', '--exclude-standard']), 'nested/');
    assert.equal(worktreeFingerprint(repo), gitlinkDigest('none'));
  });
});

test('fingerprint-nested-moved-head changes when the nested repository commits', () => {
  nestedFixture(({repo, nested, git, commit}) => {
    commit(nested); const first = worktreeFingerprint(repo);
    assert.equal(first, gitlinkDigest(git(nested, ['rev-parse', 'HEAD'])));
    commit(nested); const next = worktreeFingerprint(repo);
    assert.notEqual(next, first);
    assert.equal(next, gitlinkDigest(git(nested, ['rev-parse', 'HEAD'])));
  });
});

test('fingerprint-unreadable-entry refuses unreadable files with path and reason', () => {
  nestedFixture(({repo}) => {
    fs.writeFileSync(path.join(repo, 'unreadable-file'), 'secret'); fs.chmodSync(path.join(repo, 'unreadable-file'), 0);
    const run = spawnSync(process.execPath, [path.resolve('scripts/worktree-fingerprint.mjs'), '--worktree', repo], {encoding: 'utf8', timeout: 10000});
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr, /unreadable-file: EACCES/);
    assert.equal(run.stdout, '');
  });
});

for (const [name, before, after, pattern='^fingerprint-delivery-root'] of [
  ['tracked-delivery', "inside ? ['--', '.', `:(top,exclude,literal)${relative}`] : []", '[]'],
  ['untracked-delivery', "!(inside && (name === relative || name.startsWith(relative + '/')))", 'true'],
  ['untracked-code', 'for (const name of files)', 'for (const name of [])'],
  ['nested-committed', "value = 'gitlink:' + sha", "value = 'gitlink:none'", '^fingerprint-nested-committed'],
  ['nested-unborn', "sha = 'none'", "throw new Error('unborn rejected')", '^fingerprint-nested-unborn'],
  ['nested-moved-head', "sha = head.stdout.trim()", "sha = nested(['rev-list', '--max-parents=0', 'HEAD']).stdout.trim()", '^fingerprint-nested-moved-head'],
  ['unreadable-entry', "catch (error) { throw new Error(`${name}: ${error.message}`); }", "catch (error) { continue; }", '^fingerprint-unreadable-entry'],
  ['symlink-content', "stat.isSymbolicLink() ? fs.readlinkSync(file, { encoding: 'buffer' }) : fs.readFileSync(file)",
    'fs.readFileSync(file)', '^fingerprint-untracked-symlinks'],
]) test(`fingerprint deliberate-break ${name} makes the consumer regression red`, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-fingerprint-mutation-'));
  try {
    fs.cpSync(path.resolve('scripts'),path.join(root,'scripts'),{recursive:true});
    const file=path.join(root,'scripts/worktree-fingerprint.mjs'),source=fs.readFileSync(file,'utf8');
    assert.ok(source.includes(before),name);fs.writeFileSync(file,source.replace(before,after));
    const run=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+pattern,'scripts/worktree-fingerprint.test.mjs'],
      {cwd:root,encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='NODE_TEST_CONTEXT'))});
    assert.equal(run.status,1,run.stdout+run.stderr);assert.match(run.stdout,/not ok/);
    assert.doesNotMatch(run.stdout+run.stderr,/ERR_MODULE_NOT_FOUND|SyntaxError/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
