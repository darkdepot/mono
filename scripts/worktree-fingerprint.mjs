#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  for (const name of files) hash.update(name + '\0' + createHash('sha256')
    .update(fs.readFileSync(path.join(repo, name))).digest('hex') + '\0');
  return hash.digest('hex');
}

if (isMain(import.meta.url)) {
  try {
    const args = flags(process.argv.slice(2));
    const repo = path.resolve(args.worktree ?? '.');
    console.log(worktreeFingerprint(repo, path.resolve(args['delivery-root'] ?? path.join(repo, '.orchestrator'))));
  } catch (error) { console.error(`worktree-fingerprint: ${error.message}`); process.exitCode = 1; }
}
