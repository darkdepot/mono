import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const unique = values => new Set(values).size === values.length;
const fail = message => { throw new Error(`skills catalog: ${message}`); };

export function catalogFile(root, relative) {
  if (!text(relative) || path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '..' || p === '.')) fail(`invalid path ${relative}`);
  const file = path.resolve(root, relative);
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) fail(`path escapes catalog: ${relative}`);
  return file;
}

export function loadCatalog(indexFile) {
  indexFile = fs.realpathSync(indexFile);
  const root = path.dirname(indexFile), files = new Map();
  const read = file => { const bytes = fs.readFileSync(file); files.set(file, bytes); return bytes.toString('utf8'); };
  const index = JSON.parse(read(indexFile));
  if (index.schemaVersion !== 1 || !text(index.productName) || !text(index.skillPrefix) || !Array.isArray(index.sharedFiles) || !index.sharedFiles.every(text) || !unique(index.sharedFiles) ||
      !Array.isArray(index.stages) || !index.stages.length || !unique(index.stages.map(s => s.id))) fail('invalid index');
  const stages = new Map(index.stages.map(s => [s.id, s]));
  const scenarios = new Map();
  read(catalogFile(root,index.paperGuard));
  for (const stage of index.stages) {
    if (stage.chainSeed) JSON.parse(read(catalogFile(root,stage.chainSeed)));
    if (!/^[a-z][a-z-]*$/.test(stage.id) || !text(stage.name) || !Array.isArray(stage.files) || !stage.files.every(text) || !unique(stage.files) ||
        !index.sharedFiles.every(f => stage.files.includes(f)) || !Array.isArray(stage.neighbors) || !unique(stage.neighbors) ||
        stage.neighbors.some(id => id === stage.id || !stages.has(id)) || !Array.isArray(stage.scenarios) ||
        !Number.isInteger(stage.minimum) || stage.minimum < 1 || stage.scenarios.length < stage.minimum || !unique(stage.scenarios)) fail(`invalid stage ${stage.id}`);
    for (const relative of stage.scenarios) {
      const file = catalogFile(root, relative), scenario = JSON.parse(read(file));
      const key = `${stage.id}/${scenario.id}`;
      if (!/^[a-z][a-z0-9-]*$/.test(scenario.id) || scenario.stage !== stage.id || scenarios.has(key) ||
          relative !== `${stage.id}/${scenario.id}/scenario.json` ||
          !text(scenario.prompt) || !text(scenario.brief) || !Object.hasOwn(scenario, 'seed') ||
          !Array.isArray(scenario.expectedRecords) || !scenario.expectedRecords.length || scenario.expectedRecords.some(r => !r || (!text(r.type) && !text(r.forbidden))) ||
          !['main','correction','refuse','empty','discuss'].includes(scenario.kind)) fail(`invalid scenario ${relative}`);
      if (scenario.seed !== null) {
        const seed = JSON.parse(read(catalogFile(root, scenario.seed)));
        if (seed.schemaVersion !== 1 || !text(seed.ideaDraft) || !Array.isArray(seed.steps) || !seed.steps.length || !seed.steps.every(text) || !Array.isArray(seed.documents)) fail(`invalid seed ${key}`);
      }
      if (!read(catalogFile(root, path.posix.join(path.posix.dirname(relative), 'rubric.md'))).trim()) fail(`missing rubric ${key}`);
      if (scenario.next !== null && !stages.has(scenario.next)) fail(`unknown next ${key}`);
      for (const host of ['claude','codex']) {
        const flow = scenario.hosts?.[host];
        if (!flow || !Array.isArray(flow.windows) || !flow.windows.length || flow.windows.length !== flow.expectedWindows?.length ||
            !unique(flow.expectedWindows.map(w => w.id)) || flow.expectedWindows.some(w => !text(w.id) ||
              ['decision','advice','reason'].some(k => !text(w[k])) || !Array.isArray(w.summary) || !w.summary.length || !w.summary.every(text)) ||
            flow.windows.some(w => !['recommended','label','correction','empty','refuse','discuss'].includes(w.mode) ||
              (['correction','refuse'].includes(w.mode) && !text(w.text)) || (w.mode === 'label' && !text(w.label))) ||
            !Array.isArray(flow.freeQuestions) || flow.freeQuestions.some(q => !text(q.contains))) fail(`invalid ${host} windows ${key}`);
      }
      scenarios.set(key, { ...scenario, file, relative });
    }
    if (!scenarios.has(`${stage.id}/${stage.main}`) || scenarios.get(`${stage.id}/${stage.main}`).kind !== 'main' ||
        !Array.isArray(stage.chain) || !stage.chain.includes(stage.id) || !unique(stage.chain) ||
        stage.chain.some(id => id !== stage.id && !stage.neighbors.includes(id))) fail(`invalid main/chain ${stage.id}`);
    if (stage.chain.length > 3 || stage.chain.indexOf(stage.id) > 1 || stage.chain.length - stage.chain.indexOf(stage.id) > 2) fail(`chain is not short ${stage.id}`);
  }
  const digest = sha256([...files].sort(([a],[b]) => a.localeCompare(b)).map(([file, bytes]) =>
    `${path.relative(root,file)}\0${sha256(bytes)}\0`).join(''));
  return { indexFile, root, index, stages, scenarios, files, digest };
}
