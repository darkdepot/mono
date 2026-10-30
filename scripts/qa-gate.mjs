import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQaCertificate } from './qa-certificate.mjs';
import { validateQaConfig } from './qa-recipe.mjs';

const registry = fileURLToPath(new URL('../references/qa-recipes.md', import.meta.url));
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
const need = (ok, message) => { if (!ok) throw new Error(`QA: ${message}`); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function qaRecipeSource(config) {
  if (Object.hasOwn(config, 'qa')) { validateQaConfig(config.qa, config); return 'config'; }
  const name = config.projectName;
  return typeof name === 'string' && name.trim() && !/[\r\n<>]/.test(name)
    && fs.readFileSync(registry, 'utf8').split('\n').includes(`<!-- mono-qa product: ${name} -->`) ? 'registry' : null;
}

// This host-owned state is refreshed from Linear/GitHub before merge and install.
// Expectations are saved before QA; certificates cannot choose their own inputs.
export function qaDeliveryState({ root, config, issue, head, shipCertificate }) {
  let connected = false;
  try {
    const recipeSource = qaRecipeSource(config);
    if (!recipeSource) return { state: 'not-connected', reason: 'тестировщик не подключён' };
    connected = true;
    const state = read(path.join(root, 'qa/state.json')), task = state.tasks?.[issue];
    need(task && task.head === head && sha(head), 'current task/head missing from host state');
    need(task.project === null || (typeof task.project === 'string' && task.project.trim()), 'task project must be explicit');
    let project, build, final;
    if (task.project !== null) {
      project = state.projects?.[task.project];
      need(Array.isArray(project?.issues) && project.issues.length > 0, 'current project issues required');
      need(project.issues.every(row => typeof row.issue === 'string' && row.issue.trim()
        && typeof row.statusType === 'string' && Array.isArray(row.labels)
        && row.labels.every(label => typeof label === 'string')), 'project issue status/labels required');
      need(new Set(project.issues.map(row => row.issue)).size === project.issues.length, 'duplicate project issue');
      const implementation = project.issues.filter(row => !row.labels.includes('Этап'));
      const current = implementation.find(row => row.issue === issue);
      need(current?.head === head, 'current project task/head mismatch');
      const eligible = implementation.filter(row => !['canceled', 'duplicate'].includes(row.statusType));
      need(eligible.some(row => row.issue === issue), 'current implementation is canceled or duplicate');
      need(eligible.every(row => row.mergedAt === null || (typeof row.mergedAt === 'string'
        && Number.isFinite(Date.parse(row.mergedAt)))), 'current project merge progress required');
      const unmerged = eligible.filter(row => row.mergedAt === null);
      const held = project.heldIssues ?? [];
      need(Array.isArray(held) && new Set(held).size === held.length && held.every(key => eligible.some(row => row.issue === key)), 'invalid held issues');
      final = held.length ? held.at(-1) : unmerged.length === 1 ? unmerged[0].issue : null;
      if (!held.length && unmerged.length === 0) {
        const latest = Math.max(...eligible.map(row => Date.parse(row.mergedAt)));
        const last = eligible.filter(row => Date.parse(row.mergedAt) === latest);
        need(last.length === 1, 'latest project landing is ambiguous');
        final = last[0].issue;
      }
      if (held.includes(issue) || final === issue) {
        need(typeof final === 'string', 'final issue required');
        const target = implementation.find(row => row.issue === final);
        need(target && sha(target.head), 'final issue/head missing');
        need(state.tasks?.[final]?.head === target.head && state.tasks[final].project === task.project, 'final task state mismatch');
        build = eligible.map(({ issue, head }) => ({ issue, head }));
        need(build.every(row => sha(row.head)), 'project build head missing');
        final = target;
      } else final = null;
    }
    const check = (scope, target, overrides) => {
      const dir = path.join(root, 'qa', target.issue, target.head);
      const expected = { ...read(path.join(dir, `${scope}-expected.json`)), ...overrides,
        issue: target.issue, head: target.head, scope, mode: 'ship', recipeSource };
      const cert = validateQaCertificate(read(path.join(dir, `${scope}-report.json`)), expected);
      need(cert.gateEligible, `${scope} certificate cannot open gates`);
      need(cert.verdict === 'passed', `${scope} QA ${cert.verdict}`);
    };
    check('task', { issue, head }, { shipCertificate });
    if (final) {
      check('project', final, { project: task.project, build,
        ...(final.issue === issue ? { shipCertificate } : {}) });
    }
    return { state: 'passed', reason: final ? 'task and project QA passed' : 'task QA passed' };
  } catch (error) {
    return { state: error.code === 'ENOENT' ? 'waiting' : 'failed', reason: `QA: ${error.message}`, connected };
  }
}

export function requireQaPassed(input) {
  const qa = qaDeliveryState(input);
  need(['passed', 'not-connected'].includes(qa.state), `${qa.state}: ${qa.reason}`);
  return qa;
}
