import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A plugin is the repository tree. Copy only pack files into an isolated fixture.
export function copyPluginFixture(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const name of ['scripts', 'skills', 'references', 'templates', 'AGENTS.md', 'README.md', 'VERSION'])
    fs.cpSync(path.join(source, name), path.join(root, name), { recursive: true });
}

// Launch fixtures provide a live observer identity without a background monitor.
// Restricted test hosts may deny ps; only those fixtures install a metadata stub.
export function writeWatcherFixture(root, env = process.env) {
  let procStart;
  try { procStart = execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch {}
  if (!procStart) {
    procStart = 'fixture-watcher-start';
    const bin = path.join(root, 'watcher-bin'); fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'ps'), `#!${process.execPath}\nconsole.log(${JSON.stringify(procStart)});\n`, { mode: 0o700 });
    env.PATH = bin + path.delimiter + env.PATH;
  }
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'watcher.json'), JSON.stringify({ pid: process.pid, procStart, packVersion: 'fixture',
    startedAt: new Date().toISOString(), beatAt: new Date().toISOString(), intervalSec: 3600 }));
}
