import fs from 'node:fs';
import path from 'node:path';
import { isMain, runtimePackRoot } from './runtime.mjs';

export function checkPlugin(root) {
  const failures = [], version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  for (const file of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      if (manifest.version !== version) failures.push(`${file}: version must equal VERSION (${version})`);
      if (manifest.name !== 'mono') failures.push(`${file}: name must be mono`);
      const skills = Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills ?? './skills/'];
      if (!skills.length || skills.some(directory => typeof directory !== 'string' || !directory.startsWith('./') ||
          path.resolve(root, directory) !== path.resolve(root, 'skills') || !fs.statSync(path.resolve(root, directory)).isDirectory()))
        failures.push(`${file}: skills must resolve to the pack skills directory`);
    } catch (error) { failures.push(`${file}: ${error.message}`); }
  }
  if (fs.existsSync(path.join(root, 'plugin.json'))) failures.push('root plugin.json is forbidden');
  for (const skill of fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const file = `skills/${skill.name}/SKILL.md`, text = fs.readFileSync(path.join(root, file), 'utf8');
    const paths = new Set([...text.matchAll(/(?<![\w/.-])((?:skills|references|templates|scripts)\/[\w./-]+\.(?:md|mjs|json))(?![\w.-])/g)].map(match => match[1]));
    for (const named of paths) {
      const resolved = path.resolve(root, named);
      if (!resolved.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
        failures.push(`${file}: missing pack file ${named}`);
    }
  }
  return failures;
}

if (isMain(import.meta.url)) {
  const failures = checkPlugin(runtimePackRoot());
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('Plugin manifests and skill paths verified.');
}
