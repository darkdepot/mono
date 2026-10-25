#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseNotes } from './release-notes.mjs';

// Wrap the released tree instead of cloning it as the plugin root. Codex copies
// the selected subdirectory, leaving clone metadata outside its hook fingerprint.
export function codexPackage(repo, sourceTag, { writeTag = false } = {}) {
  const git = (args, options = {}) => execFileSync('git', args, {
    cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options,
  }).trim();
  releaseNotes(repo, sourceTag); // Validate immutable tag data; never run tag code.
  const sourceCommit = git(['rev-parse', `refs/tags/${sourceTag}^{commit}`]);
  const sourceTree = git(['rev-parse', `${sourceCommit}^{tree}`]);
  for (const file of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    if (JSON.parse(git(['show', `${sourceCommit}:${file}`])).name !== 'mono')
      throw new Error(`${file}: expected plugin name mono`);
  }
  const entries = git(['ls-tree', '-r', sourceTree]).split('\n');
  if (entries.some(line => line.startsWith('160000 ')))
    throw new Error('plugin release must not contain submodules');
  if (entries.some(line => line.startsWith('120000 ')))
    throw new Error('plugin release must not contain symlinks: Codex omits them when installing a subdirectory');

  const blob = value => git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value, null, 2) + '\n' });
  const tree = entries => git(['mktree'], {
    input: entries.map(([mode, type, oid, name]) => `${mode} ${type} ${oid}\t${name}\n`).join(''),
  });
  const catalog = blob({
    name: 'mono-marketplace',
    interface: { displayName: 'Mono' },
    plugins: [{
      name: 'mono', source: { source: 'local', path: './plugins/mono' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Coding',
    }],
  });
  const catalogTree = tree([['100644', 'blob', catalog, 'marketplace.json']]);
  const agentsTree = tree([['040000', 'tree', catalogTree, 'plugins']]);
  const pluginsTree = tree([['040000', 'tree', sourceTree, 'mono']]);
  const provenance = blob({ schemaVersion: 1, sourceTag, sourceCommit, sourceTree });
  const rootTree = tree([
    ['040000', 'tree', agentsTree, '.agents'],
    ['040000', 'tree', pluginsTree, 'plugins'],
    ['100644', 'blob', provenance, 'release.json'],
  ]);
  const date = `${git(['show', '-s', '--format=%ct', sourceCommit])} +0000`;
  const distributionTag = `codex-${sourceTag}`;
  const distributionCommit = git(['-c', 'commit.gpgSign=false', '-c', 'i18n.commitEncoding=UTF-8',
    'commit-tree', rootTree, '-p', sourceCommit], {
    input: `Package Mono ${sourceTag} for Codex\n\nSource: ${sourceCommit}\n`,
    env: { ...process.env,
      GIT_AUTHOR_NAME: 'Mono Release', GIT_AUTHOR_EMAIL: 'release@runmono.ai',
      GIT_COMMITTER_NAME: 'Mono Release', GIT_COMMITTER_EMAIL: 'release@runmono.ai',
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    },
  });
  if (writeTag) {
    const ref = `refs/tags/${distributionTag}`;
    let existing;
    try { existing = git(['rev-parse', '--verify', ref]); } catch { /* New release. */ }
    if (existing && existing !== distributionCommit)
      throw new Error(`refusing to replace existing ${distributionTag}: ${existing}`);
    if (!existing) git(['update-ref', ref, distributionCommit, '0'.repeat(sourceCommit.length)]);
  }
  return { sourceTag, sourceCommit, sourceTree, distributionTag, distributionCommit };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = { repo: process.cwd() };
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === '--write-tag') options.writeTag = true;
      else if (['--repo', '--tag'].includes(arg) && process.argv[i + 1]) options[arg.slice(2)] = process.argv[++i];
      else throw new Error('Usage: codex-package.mjs [--repo DIR] --tag v<VERSION> [--write-tag]');
    }
    if (!options.tag) throw new Error('--tag is required');
    console.log(JSON.stringify(codexPackage(options.repo, options.tag, options), null, 2));
  } catch (error) {
    console.error(`codex-package: ${error.message}`);
    process.exitCode = 1;
  }
}
