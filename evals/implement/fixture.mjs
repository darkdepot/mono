import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { worktreeFingerprint } from '../../scripts/worktree-fingerprint.mjs';
import { ideaFingerprint } from '../../scripts/idea-gate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const scenarios = JSON.parse(fs.readFileSync(path.join(here, 'scenarios.json')));
const good = `export function createNote(notes, title) {
  if (!title.trim()) throw new Error('Empty title');
  return { notes: [...notes, title], count: notes.length + 1 };
}\n`;
const broken = `export function createNote(notes, title) {
  return { notes: [...notes, title], count: notes.length + 1 };
}\n`;
const regression = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNote } from './notes.mjs';
test('rejects empty names instead of silently adding an empty note', () => {
  const notes = ['Existing'];
  assert.throws(() => createNote(notes, '  '), /Empty title/);
  assert.deepEqual(notes, ['Existing']);
});
test('adds a note without losing existing notes', () => {
  assert.deepEqual(createNote(['Existing'], 'New').notes, ['Existing', 'New']);
});
test('increments the count when a note is added', () => {
  assert.equal(createNote(['Existing'], 'New').count, 2);
});\n`;
export const treeFingerprint = worktreeFingerprint;
export function createFixture(id) {
  const scenario = scenarios.find(item => item.id === id);
  if (!scenario) throw new Error('Unknown implement scenario: ' + id);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `mono-implement-${id}-`));
  const write = (name, text) => fs.writeFileSync(path.join(repo, name), text);
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  write('notes.mjs', ['ae2-broken', 's3-technical', 'projectless'].includes(id) ? broken : good);
  if (id === 'ae4-forgotten') write('notes.mjs', good.replace('notes.length + 1', '0'));
  write('notes.test.mjs', regression);
  write('help.md', '# Notes\n\nList notes: notes ls\n');
  write('screen.html', '<!doctype html><html lang="ru"><title>Заметки</title><main><h1>Заметки</h1><ul></ul></main></html>\n');
  const narrow = ["node --test --test-name-pattern='rejects empty' notes.test.mjs", "node --test --test-name-pattern='adds a note' notes.test.mjs"];
  const verification = id === 'ae4-forgotten' ? narrow : ['node --test notes.test.mjs'];
  const issueBody = `# Цель PR\n${scenario.criteria.join('; ')}\n\n# Что сделать\nТолько согласованное поведение учебных заметок.\n\n# Критерии приемки\nГотово, когда:\n${scenario.criteria.map(c => `- ${c}`).join('\n')}\n\n# Как проверить\n${verification.map(command => '- ' + command).join('\n')}\n\n# Что не входит\n- Новые сервисы, PR, выкладка\n\n# Ревью-гейт\nРиск: standard. Ревью: ready, блокирующих находок нет.\n`;
  write('issue.md', issueBody);
  // Use the real resolver's whole-body emitter, never a guessed scope hash.
  const resolver = path.join(here, '../../scripts/resolve-issue-context.mjs');
  const fingerprint = execFileSync(process.execPath, [resolver, '--issue', path.join(repo, 'issue.md'), '--emit-fingerprint'], { encoding: 'utf8' }).trim();
  const projectless = id === 'projectless';
  if (projectless) {
    write('marker.md', `mono-issue-only marker\nMarker version: 1\nScope fingerprint: ${fingerprint}\nAcceptance IDs: ${scenario.criteria.map((_,i)=>`AC${i+1}`).join(', ')}\nRisk class: standard\nApproval: ${fingerprint} (approved by owner 2026-10-27)\n`);
    write('config.json', JSON.stringify({ issueOnlyLane: { enabled: true, ownerPrincipal: 'fixture-owner' } }, null, 2));
  }
  let seam = JSON.parse(execFileSync(process.execPath, [resolver, '--issue', path.join(repo, 'issue.md')], { encoding: 'utf8' }));
  if (projectless) seam = JSON.parse(execFileSync(process.execPath, [resolver, '--issue', path.join(repo,'issue.md'), '--marker',path.join(repo,'marker.md'), '--config',path.join(repo,'config.json'), '--label','issue-only', '--approval-verified',fingerprint], { encoding: 'utf8' }));
  const projectId = projectless ? null : '11111111-1111-4111-8111-111111111111';
  const issueId = '22222222-2222-4222-8222-222222222222';
  const packageId = '33333333-3333-4333-8333-333333333333';
  const chained = id.startsWith('u6-');
  const packageIssues = chained ? 'T0:TRAIN-0,T1:TRAIN-1' : 'T1:TRAIN-1';
  const packageBody = `## Кратко\nУчебные заметки: ${scenario.criteria.join('; ')}.\n\n## Решения\nТолько критерии задачи; новые сервисы, PR и выкладка не входят. Дизайн не требуется; экран использует текстовое правило вкуса.\n\n## Задачи\n${chained ? 'T0: TRAIN-0 — предыдущая задача, влита\n' : ''}T1: TRAIN-1 — ${scenario.criteria.join('; ')}${chained ? '; зависит от T0' : ''}\n`;
  const packageHash = createHash('sha256').update(packageBody).digest('hex');
  if (!projectless) seam = { ...seam, risk_class: 'standard', approval_status: 'approved' };
  const issue = { id: issueId, key: 'TRAIN-1', body: issueBody, projectId, status: projectless ? 'Backlog' : 'In Progress' };
  const approvalBody = projectless ? `Владелец утвердил TRAIN-1: ${fingerprint}`
    : `mono-package: start project=${projectId} record=${packageId} sha256=${packageHash} issues=${packageIssues} by=owner\napproval_status=approved\nУчебный пакет и задача утверждены; проект в Delivery.`;
  write('fixture-context.json', JSON.stringify({ fixture: true, scenario: id, status: scenario.status,
    issue, project: projectless ? null : { id: projectId, name: 'Учебные заметки', status: 'Delivery' },
    package: projectless ? null : { recordId: packageId, sha256: packageHash, status: 'approved', body: packageBody,
      prd: 'start-snapshot/prd.md', spec: 'start-snapshot/tech-spec.md' },
    seam, verified_label: projectless ? 'issue-only' : null, approval: { author: 'fixture-owner', issue: 'TRAIN-1', projectId, fingerprint, status: 'approved', start: true, body: approvalBody },
    start_snapshot: 'start-snapshot', gate_config: projectless ? 'config.json' : 'start-snapshot/gate-config.json',
    delivery_root: '.orchestrator', linear_adapter: 'node linear-adapter.mjs read|start TRAIN-1',
    review: { status: 'ready', findings: [] }, design: id === 'screen' ? { mockup: null, taste: 'Простой текст, без карточек и новых кнопок' } : null,
    predecessor: id.startsWith('u6-') ? { issue: 'TRAIN-0', relation: 'Blocked by', samePackage: true,
      report: id === 'u6-missing-promised' ? { summary: 'Добавлена normalizeTitle', criteria: [{ criterion: 'Экспортирована normalizeTitle', done: true, outcome: 'confirmed' }] } : null } : null,
    boundary: 'Offline fixture data only; transcript/read-backs are scenario evidence, not live Linear proof.' }, null, 2));
  fs.mkdirSync(path.join(repo, 'start-snapshot/idea'), { recursive: true });
  const json = (file, value) => write(file, JSON.stringify(value, null, 2) + '\n');
  json('start-snapshot/issue-context.json', { issueId, issueKey: 'TRAIN-1', projectId });
  write('start-snapshot/issue-TRAIN-1.md', issueBody);
  if (projectless) json('start-snapshot/issue-only.json', { seam, fingerprint, marker: { kind: 'issue-only' },
    label: { id: 'fixture-label', name: 'issue-only' }, ownerApproval: { id: 'fixture-approval', body: approvalBody },
    config: { enabled: true, ownerPrincipal: 'fixture-owner' } });
  else {
    const idea = '## Что\nУчебные заметки\n\n## Зачем\nПроверить разработку\n\n## Образ результата\nЧестный отчёт\n\n## Неизвестные\n1. Нет\n';
    const approved = { id: 'fixture-start', createdAt: '2026-10-27T02:00:00Z', body: approvalBody };
    json('start-snapshot/idea/project.json', { id: projectId, createdAt: '2026-10-27T00:00:00Z', status: 'Delivery', body: idea, language: 'ru' });
    json('start-snapshot/idea/idea-records.json', { complete: true, comments: [
      { id: 'fixture-idea', createdAt: '2026-10-27T01:00:00Z', body: `mono-idea: approved project=${projectId} sha256=${ideaFingerprint(idea)}\n\n\`\`\`mono-idea-snapshot\n${idea}\`\`\`` }, approved] });
    json('start-snapshot/approval.json', { commentId: approved.id, createdAt: approved.createdAt,
      bodySha256: createHash('sha256').update(approvalBody).digest('hex') });
    write('start-snapshot/approval.md', approvalBody);
    write('start-snapshot/project.md', '# Учебные заметки\n\nСтатус: Delivery. Разработка согласованного поведения заметок.\n');
    write('start-snapshot/prd.md', `# PRD: учебные заметки\n\nТолько поведение задачи TRAIN-1: ${scenario.criteria.join('; ')}.\nВладелец утвердил этот объём. QA и выпуск не входят.\n`);
    write('start-snapshot/tech-spec.md', `# Запись пакета\n\nmono-package: recorded project=${projectId} version=1 sha256=${packageHash}\n\n${packageBody}`);
    json('start-snapshot/gate-config.json', { languages: { linear: 'Russian' } });
  }
  fs.copyFileSync(path.join(here, 'linear-adapter.mjs'), path.join(repo, 'linear-adapter.mjs'));
  fs.mkdirSync(path.join(repo, 'linear-response-examples'));
  json('linear-response-examples/issue.json', { id: issueId, identifier: issue.key, description: issueBody,
    state: { name: issue.status }, project: projectless ? null : { id: projectId, name: 'Учебные заметки' } });
  if (!projectless) json('linear-response-examples/project.json', { id: projectId, name: 'Учебные заметки', status: { name: 'Delivery' } });
  git(['init', '-q', '--initial-branch=main']); git(['add', '.']); git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Teaching repository baseline']);
  if (id.startsWith('u6-')) {
    const context = JSON.parse(fs.readFileSync(path.join(repo, 'fixture-context.json')));
    context.predecessor.mergeCommit = git(['rev-parse', 'HEAD']);
    write('fixture-context.json', JSON.stringify(context, null, 2));
    git(['add', 'fixture-context.json']);
    git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Supply verified predecessor commit']);
  }
  if (id === 'ae3-stale') {
    const result = spawnSync(process.execPath, ['--test','notes.test.mjs'], { cwd: repo, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) });
    if (result.status !== 0) throw new Error('Stale-proof setup did not actually pass: ' + result.stdout + result.stderr);
    const fingerprint = treeFingerprint(repo);
    fs.mkdirSync(path.join(repo, '.orchestrator'), { recursive: true });
    write('.orchestrator/evidence-before.json', JSON.stringify({ head: git(['rev-parse','HEAD']), worktree_fingerprint: fingerprint, command: 'node --test notes.test.mjs', exit: result.status, output: result.stdout }, null, 2));
    if (treeFingerprint(repo) !== fingerprint) throw new Error('Evidence-only writes changed the code fingerprint');
    write('notes.mjs', broken);
  }
  return repo;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(createFixture(process.argv[2]));
}
