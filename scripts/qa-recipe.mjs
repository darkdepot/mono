import fs from 'node:fs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

export function validateQaConfig(qa, config = {}) {
  const need = (ok, message) => { if (!ok) throw new Error(`qa: ${message}`); };
  need(object(qa), 'must be an object');
  need(Object.keys(qa).every(key => ['mode', 'install', 'start', 'ready', 'data', 'forbiddenActions'].includes(key)), 'unknown field');
  need(['web', 'terminal', 'mobile'].includes(qa.mode), 'mode must be web, terminal or mobile');
  need(Array.isArray(qa.install) && qa.install.every(text), 'install must be an array of commands (empty when no installation is needed)');
  need(text(qa.start), 'start is required');
  if (qa.mode !== 'terminal') need(qa.start.includes('$QA_PORT') || qa.start.includes('${QA_PORT}'), 'start must use the assigned $QA_PORT');
  need(object(qa.ready) && Object.keys(qa.ready).every(key => ['command', 'identity'].includes(key))
    && text(qa.ready.command) && text(qa.ready.identity), 'ready requires command and copy identity proof');
  need(object(qa.data) && Object.keys(qa.data).every(key => ['source', 'description'].includes(key))
    && ['read-only', 'synthetic', 'qaAuth', 'local-fixtures'].includes(qa.data.source) && text(qa.data.description), 'data requires source and description');
  if (qa.data.source === 'qaAuth') need(['cookie-import', 'test-account', 'owner-session'].includes(config.qaAuth), 'data source qaAuth requires qaAuth policy');
  need(Array.isArray(qa.forbiddenActions) && qa.forbiddenActions.length > 0 && qa.forbiddenActions.every(text), 'forbiddenActions must list external action restrictions');
  return qa;
}

// Assignment recipes may be prose from a host probe; never execute them here.
export function readQaRecipeFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0) throw new Error('qa: recipe file must be a nonempty readable file');
  const recipe = fs.readFileSync(file, 'utf8');
  if (!recipe.trim()) throw new Error('qa: recipe file is empty');
  return recipe;
}
