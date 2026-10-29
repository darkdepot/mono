#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { flags, isMain } from './runtime.mjs';

export function worktreeFingerprint(repo = process.cwd(), deliveryRoot = path.join(repo, '.orchestrator')) {
  const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 128 * 1024 * 1024 });
  repo = fs.realpathSync(git(['rev-parse', '--show-toplevel']).toString().trim());
  let ancestor = path.resolve(deliveryRoot);
  const missing = [];
  while (!fs.existsSync(ancestor)) { missing.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const relative = path.relative(repo, path.join(fs.realpathSync(ancestor), ...missing)).split(path.sep).join('/');
  if (!relative) throw new Error('delivery-root cannot be the whole worktree');
  const inside = relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative);
  const paths = inside ? ['--', '.', `:(top,exclude,literal)${relative}`] : [];
  const hash = createHash('sha256').update(git(['diff', '--binary', 'HEAD', ...paths]));
  const files = git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0')
    .filter(name => name && !(inside && (name === relative || name.startsWith(relative + '/')))).sort();
  for (const name of files) {
    const file = path.join(repo, name);
    try {
      const stat = fs.lstatSync(file);
      let value;
      if (stat.isDirectory()) {
        const nested = args => spawnSync('git', ['--git-dir', path.join(file, '.git'), ...args], { encoding: 'utf8' });
        const head = nested(['rev-parse', '--verify', '--quiet', 'HEAD']);
        let sha;
        if (head.status === 0) sha = head.stdout.trim();
        else {
          if (head.status !== 1) throw new Error(head.error?.message || head.stderr.trim() || 'cannot read nested HEAD');
          const ref = nested(['symbolic-ref', '--quiet', 'HEAD']);
          if (ref.status !== 0) throw new Error(ref.error?.message || ref.stderr.trim() || 'cannot read unborn HEAD reference');
          const branch = nested(['show-ref', '--verify', '--quiet', ref.stdout.trim()]);
          if (branch.status !== 1) throw new Error(branch.error?.message || branch.stderr.trim() || 'nested HEAD is not an unborn branch');
          sha = 'none';
        }
        value = 'gitlink:' + sha;
      } else {
        if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('unsupported entry type');
        const content = stat.isSymbolicLink() ? fs.readlinkSync(file, { encoding: 'buffer' }) : fs.readFileSync(file);
        value = createHash('sha256').update(content).digest('hex');
      }
      hash.update(name + '\0' + value + '\0');
    } catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  return hash.digest('hex');
}

if (isMain(import.meta.url)) {
  try {
    const args = flags(process.argv.slice(2));
    const repo = path.resolve(args.worktree ?? '.');
    console.log(worktreeFingerprint(repo, path.resolve(args['delivery-root'] ?? path.join(repo, '.orchestrator'))));
  } catch (error) { console.error(`worktree-fingerprint: ${error.message}`); process.exitCode = 1; }
}
