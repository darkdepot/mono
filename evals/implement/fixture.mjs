import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const scenarios = JSON.parse(fs.readFileSync(path.join(here, 'scenarios.json')));
const good = `export function createNote(notes, title) {
  if (!title.trim()) throw new Error('Empty title');
  return { notes: [...notes, title], count: notes.length + 1 };
}\n`;
const broken = `export function createNote(notes, title) {
  return { notes: [...notes, title], count: 0 };
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
export function treeFingerprint(repo) {
  const hash = createHash('sha256');
  hash.update(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: repo }));
  const files = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8' })
    .split('\0').filter(Boolean).filter(name => !['report.json', 'evidence.jsonl', 'evidence-before.json'].includes(name)).sort();
  for (const name of files) hash.update(name + '\0' + createHash('sha256').update(fs.readFileSync(path.join(repo, name))).digest('hex') + '\0');
  return hash.digest('hex');
}
export function createFixture(id) {
  const scenario = scenarios.find(item => item.id === id);
  if (!scenario) throw new Error('Unknown implement scenario: ' + id);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `mono-implement-${id}-`));
  const write = (name, text) => fs.writeFileSync(path.join(repo, name), text);
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  write('notes.mjs', ['ae1-tiny', 'ae3-stale', 'screen', 's3-owner'].includes(id) ? good : broken);
  if (id === 'ae4-forgotten') write('notes.mjs', good.replace('notes.length + 1', '0'));
  write('notes.test.mjs', regression);
  write('help.md', '# Notes\n\nList notes: notes ls\n');
  write('screen.html', '<!doctype html><html lang="ru"><title>Заметки</title><main><h1>Заметки</h1><ul></ul></main></html>\n');
  write('.gitignore', 'report.json\nevidence.jsonl\n');
  const issueBody = `# Цель PR\n${scenario.criteria.join('; ')}\n\n# Что сделать\nТолько согласованное поведение учебных заметок.\n\n# Критерии приемки\n${scenario.criteria.map(c => `- ${c}`).join('\n')}\n\n# Как проверить\n- node --test notes.test.mjs\n\n# Что не входит\n- Новые сервисы, PR, выкладка\n\n# Ревью-гейт\nРиск: standard. Ревью: ready, блокирующих находок нет.\n`;
  write('issue.md', issueBody);
  // Use the real resolver's whole-body emitter, never a guessed scope hash.
  const resolver = path.join(here, '../../scripts/resolve-issue-context.mjs');
  const fingerprint = execFileSync(process.execPath, [resolver, '--issue', path.join(repo, 'issue.md'), '--emit-fingerprint'], { encoding: 'utf8' }).trim();
  const projectless = id === 'projectless';
  write('marker.md', `mono-issue-only marker\nMarker version: 1\nScope fingerprint: ${fingerprint}\nAcceptance IDs: ${scenario.criteria.map((_,i)=>`AC${i+1}`).join(', ')}\nRisk class: standard\nApproval: ${fingerprint} (approved by owner 2026-10-27)\n`);
  write('config.json', JSON.stringify({ issueOnlyLane: { enabled: true, ownerPrincipal: 'fixture-owner' } }, null, 2));
  let seam = JSON.parse(execFileSync(process.execPath, [resolver, '--issue', path.join(repo, 'issue.md')], { encoding: 'utf8' }));
  if (projectless) seam = JSON.parse(execFileSync(process.execPath, [resolver, '--issue', path.join(repo,'issue.md'), '--marker',path.join(repo,'marker.md'), '--config',path.join(repo,'config.json'), '--label','issue-only', '--approval-verified',fingerprint], { encoding: 'utf8' }));
  write('fixture-context.json', JSON.stringify({ fixture: true, scenario: id, status: scenario.status,
    issue: { key: 'TRAIN-1', body: issueBody, projectId: projectless ? null : 'fixture-project', status: 'Backlog' },
    seam, verified_label: projectless ? 'issue-only' : null, approval: { author: 'fixture-owner', fingerprint, status: 'approved', start: true },
    review: { status: 'ready', findings: [] }, design: id === 'screen' ? { mockup: null, taste: 'Простой текст, без карточек и новых кнопок' } : null,
    predecessor: id === 'u6-missing-promised' ? { report: { summary: 'Добавлена normalizeTitle' }, merged: true } : null,
    boundary: 'Offline fixture data only; transcript/read-backs are scenario evidence, not live Linear proof.' }, null, 2));
  // Preserve provider response examples as reading inputs, without calling Linear.
  fs.cpSync(path.join(here, '../../scripts/fixtures/idea-gate/probe/codex'), path.join(repo, 'linear-response-examples'), { recursive: true });
  git(['init', '-q']); git(['add', '.']); git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Teaching repository baseline']);
  if (id === 'ae3-stale') {
    const result = spawnSync(process.execPath, ['--test','notes.test.mjs'], { cwd: repo, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) });
    if (result.status !== 0) throw new Error('Stale-proof setup did not actually pass: ' + result.stdout + result.stderr);
    const fingerprint = treeFingerprint(repo);
    write('evidence-before.json', JSON.stringify({ head: git(['rev-parse','HEAD']), worktree_fingerprint: fingerprint, command: 'node --test notes.test.mjs', exit: result.status, output: result.stdout }, null, 2));
    if (treeFingerprint(repo) !== fingerprint) throw new Error('Evidence-only writes changed the code fingerprint');
    write('notes.mjs', broken);
  }
  return repo;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(createFixture(process.argv[2]));
}
