import fs from 'node:fs';
import path from 'node:path';
import { isMain, runtimePackRoot } from './runtime.mjs';
import { isRussianStage } from './russian-stages.mjs';

export function resolveSkillPath(root, file, named) {
  if (named.startsWith('<корень>/') && isRussianStage(file)) return path.resolve(root, named.slice('<корень>/'.length));
  if (named.startsWith('<pack-root>/')) return path.resolve(root, named.slice('<pack-root>/'.length));
  const skill = /^skills\/[^/]+\//.exec(file)?.[0];
  if (skill && named.startsWith('references/') && (isRussianStage(file) || fs.existsSync(path.join(root, skill, 'references'))))
    return path.resolve(root, skill, named);
  return path.resolve(root, named);
}

function checkWindowHooks(root, manifest, file) {
  // Claude auto-discovers hooks/hooks.json; Codex declares its hooks in the manifest.
  const declared = manifest.hooks ?? (file.startsWith('.claude-plugin/') ? './hooks/hooks.json' : null);
  const hooks = typeof declared === 'string' && declared === './hooks/hooks.json'
    ? JSON.parse(fs.readFileSync(path.join(root, declared), 'utf8')).hooks : declared;
  if (!hooks || JSON.stringify(Object.keys(hooks).sort()) !== JSON.stringify(['PreToolUse', 'Stop', 'UserPromptSubmit']))
    return [`${file}: window hooks must register only PreToolUse, Stop and UserPromptSubmit`];
  const failures = [];
  for (const event of ['PreToolUse', 'Stop', 'UserPromptSubmit']) {
    const entries = hooks[event];
    const entry = Array.isArray(entries) && entries.length === 1 ? entries[0] : null;
    const command = entry?.hooks?.length === 1 ? entry.hooks[0] : null;
    if (command?.type !== 'command' || command.command !== 'node "${CLAUDE_PLUGIN_ROOT}/scripts/window-guard.mjs"')
      failures.push(`${file}: ${event} must run window-guard through \${CLAUDE_PLUGIN_ROOT}`);
    if (event === 'PreToolUse') {
      try {
        const matcher = new RegExp(entry?.matcher ?? '');
        if (!['Bash', 'AskUserQuestion', 'request_user_input', 'request_user_input_async'].every(name => matcher.test(name)) ||
            ['Agent', 'Task', 'Read', 'other_request_user_input', 'request_user_input_other'].some(name => matcher.test(name)))
          failures.push(`${file}: PreToolUse must match Bash and both hosts' window tools only`);
      } catch { failures.push(`${file}: invalid window hook matcher`); }
    } else if (entry?.matcher) failures.push(`${file}: ${event} must be unconditional`);
  }
  if (!fs.existsSync(path.join(root, 'scripts/window-guard.mjs'))) failures.push(`${file}: missing window-guard script`);
  return failures;
}

export function checkPlugin(root) {
  const failures = [], version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  for (const file of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      if (manifest.version !== version) failures.push(`${file}: version must equal VERSION (${version})`);
      if (manifest.name !== 'mono') failures.push(`${file}: name must be mono`);
      failures.push(...checkWindowHooks(root, manifest, file));
      const skills = Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills ?? './skills/'];
      if (!skills.length || skills.some(directory => typeof directory !== 'string' || !directory.startsWith('./') ||
          path.resolve(root, directory) !== path.resolve(root, 'skills') || !fs.statSync(path.resolve(root, directory)).isDirectory()))
        failures.push(`${file}: skills must resolve to the pack skills directory`);
    } catch (error) { failures.push(`${file}: ${error.message}`); }
  }
  if (fs.existsSync(path.join(root, 'plugin.json'))) failures.push('root plugin.json is forbidden');
  for (const skill of fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const file = `skills/${skill.name}/SKILL.md`, text = fs.readFileSync(path.join(root, file), 'utf8');
    const paths = new Set([...text.matchAll(/(?<![\w/.-])((?:<(?:корень|pack-root)>\/)?(?:skills|references|templates|scripts)\/[\w./-]+\.(?:md|mjs|json))(?![\w.-])/g)].map(match => match[1]));
    for (const named of paths) {
      const resolved = resolveSkillPath(root, file, named);
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
