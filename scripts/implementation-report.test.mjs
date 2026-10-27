import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { captureCriteria, publishPhase } from './delivery-state.mjs';

const approvedIssue = path.resolve('scripts/fixtures/implementation-approved-issue.md');
function capture(root, source = approvedIssue) {
  return captureCriteria({ root, issue: 'MONO-993', attempt: 1, issueFile: source });
}

function report(root, source = approvedIssue) {
  capture(root, source);
  const head = 'b'.repeat(40);
  return { issue: 'MONO-993', stage: 'mono-deliver', attempt: 1, packVersion: 'test', surfaceRevision: 4,
    phase: 'code', sequence: 1, kind: 'phase', head, phase_result: 'implemented-needs-preflight',
    summary: 'Справка исправлена. Передаю на проверку перед PR.', not_built: [], not_verified: [],
    criteria: ['Справка называет действующую команду', 'Список содержит все команды', 'Ошибочная команда объясняет исправление'].map(criterion => ({ criterion, done: true, outcome: 'confirmed',
      proof: 'Характеристика: вызов команды с --help', result: 'Команда завершилась с кодом 0', head,
      worktree_fingerprint: 'c'.repeat(64) })),
    linear_mutations_pending: [], capsule: { phase: 'code', head, open_queue: [], decisions: [], writable_roots: [root] } };
}

const cases = [
  ['missing criteria', r => { delete r.criteria; }],
  ['empty criteria', r => { r.criteria = []; }],
  ['known broken behavior', r => { r.criteria[0].outcome = 'broken'; }],
  ['unfinished criterion', r => { r.criteria[0].done = false; r.criteria[0].outcome = 'unverified';
    r.not_verified = [{ what: r.criteria[0].criterion, why: 'Не сделано', risk: 'Старая команда' }]; }],
  ['nonboolean done', r => { r.criteria[0].done = 'true'; }],
  ['unknown outcome', r => { r.criteria[0].outcome = 'pass'; }],
  ['missing proof', r => { delete r.criteria[0].proof; }],
  ['missing observed result', r => { delete r.criteria[0].result; }],
  ['stale confirmed head', r => { r.criteria[0].head = 'a'.repeat(40); }],
  ['missing worktree fingerprint', r => { delete r.criteria[0].worktree_fingerprint; }],
  ['missing summary', r => { delete r.summary; }],
  ['missing not_built', r => { delete r.not_built; }],
  ['missing not_verified', r => { delete r.not_verified; }],
  ['unexplained unverified criterion', r => { r.criteria[0].outcome = 'unverified'; }],
];
for (const [name, mutate] of cases) test(`implementation-publication refuses ${name} before writing`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-code-report-'));
  try {
    const candidate = report(root); mutate(candidate);
    const output = path.join(root, 'reports/MONO-993-phase-code.json');
    assert.throws(() => publishPhase(candidate, output, undefined, root), /implementation report/);
    assert.equal(fs.existsSync(output), false);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, 'preserve previous report bytes\n');
    assert.throws(() => publishPhase(candidate, output, undefined, root), /implementation report/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'preserve previous report bytes\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('implementation-publication accepts complete confirmed and explicitly unverified work through CLI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-code-report-'));
  try {
    for (const outcome of ['confirmed', 'unverified']) {
      const candidate = report(root); candidate.criteria[0].outcome = outcome;
      if (outcome === 'unverified') candidate.not_verified = [{ what: candidate.criteria[0].criterion,
        why: 'Нет доступа к установленному приложению', risk: 'Справка может расходиться с установленной версией' }];
      const input = path.join(root, `${outcome}.json`), output = path.join(root, outcome, 'reports/MONO-993-phase-code.json');
      fs.writeFileSync(input, JSON.stringify(candidate));
      const result = spawnSync(process.execPath, ['scripts/delivery-state.mjs', 'publish', '--report', input, '--output', output, '--root', root], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(fs.readFileSync(output)).criteria, candidate.criteria);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('implementation-publication keeps broken and unfinished work visible as blocked, never confirmed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-code-report-'));
  try {
    for (const outcome of ['broken', 'unverified']) {
      const candidate = report(root); candidate.phase_result = 'blocked'; candidate.criteria[0].outcome = outcome;
      candidate.criteria[0].done = false;
      if (outcome === 'unverified') candidate.not_verified = [{ what: candidate.criteria[0].criterion, why: 'Не сделано', risk: 'Критерий не выполнен' }];
      assert.equal(publishPhase(candidate, path.join(root, outcome, 'reports/MONO-993-phase-code.json'), undefined, root).phase_result, 'blocked');
    }
    const candidate = report(root); candidate.phase_result = 'blocked'; candidate.criteria[0].done = false;
    assert.throws(() => publishPhase(candidate, path.join(root, 'invalid.json'), undefined, root), /implementation report/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const [name, mutate] of [
  ['omitted approved criterion', r => r.criteria.splice(1, 1)],
  ['extra criterion', r => r.criteria.push({ ...r.criteria[0], criterion: 'Непросимый новый экран' })],
  ['reordered criteria', r => r.criteria.reverse()],
  ['reworded criterion', r => { r.criteria[0].criterion = 'Справка примерно верна'; }],
]) test(`approved-list publication refuses ${name} before any write`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-approved-list-'));
  try {
    const candidate = report(root); mutate(candidate);
    const output = path.join(root, 'reports/MONO-993-phase-code.json');
    assert.throws(() => publishPhase(candidate, output), /approved criteria/);
    assert.equal(fs.existsSync(output), false);
    fs.writeFileSync(output, 'preserve previous bytes');
    assert.throws(() => publishPhase(candidate, output), /approved criteria/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'preserve previous bytes');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('approved-list publication accepts the exact list and whitespace-only changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-approved-list-'));
  try {
    for (const whitespace of [false, true]) {
      const candidate = report(root);
      if (whitespace) candidate.criteria[1].criterion = '  Список  содержит\nвсе команды  ';
      assert.deepEqual(publishPhase(candidate, path.join(root, `reports/exact-${whitespace}.json`)).criteria, candidate.criteria);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('approved-list publication refuses missing state instead of trusting a report-supplied list', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-approved-list-'));
  try {
    const candidate = report(root);
    fs.unlinkSync(path.join(root, 'reports/MONO-993-criteria-a1.json'));
    candidate.approved_criteria = candidate.criteria.map(x => x.criterion);
    assert.throws(() => publishPhase(candidate, path.join(root, 'reports/out.json')), /approved criteria/);
    assert.equal(fs.existsSync(path.join(root, 'reports/out.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('approved-list capture freezes dispatch and standalone Issue-start sources', () => {
  for (const lane of ['snapshot/issue-MONO-993.md', 'issue-start-read.md']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-approved-source-'));
    try {
      const source = path.join(root, lane);
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.copyFileSync(approvedIssue, source);
      const cli = spawnSync(process.execPath, ['scripts/delivery-state.mjs', 'capture-criteria', '--issue', 'MONO-993', '--attempt', '1', '--issue-file', source, '--root', root], { encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr);
      const state = JSON.parse(cli.stdout.split('\n')[0]), file = path.join(root, 'reports/MONO-993-criteria-a1.json');
      const bytes = fs.readFileSync(file);
      assert.deepEqual(state.criteria, ['Справка называет действующую команду', 'Список содержит все команды', 'Ошибочная команда объясняет исправление']);
      assert.deepEqual(capture(root, source), state);
      fs.appendFileSync(source, '\nEdited after start\n');
      assert.throws(() => capture(root, source), /immutable/);
      assert.deepEqual(fs.readFileSync(file), bytes);
      const alternate = path.join(root, 'other.md'); fs.copyFileSync(approvedIssue, alternate);
      assert.throws(() => capture(root, alternate), /immutable/);
      assert.deepEqual(fs.readFileSync(file), bytes);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('approved-list deliberate breakage makes the omission regression red', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-approved-mutation-'));
  try {
    fs.cpSync(path.resolve('scripts'), path.join(root, 'scripts'), { recursive: true });
    const file = path.join(root, 'scripts/delivery-criteria.mjs');
    const source = fs.readFileSync(file, 'utf8');
    const comparison = "  if (reported.length !== state.criteria.length || reported.some((criterion, index) => criterion !== state.criteria[index]))\n    fail('report must contain the full ordered approved criteria list');";
    assert.ok(source.includes(comparison), 'mutation must target the actual comparison');
    fs.writeFileSync(file, source.replace(comparison, '  // Deliberate scratch breakage: skip the approved-list comparison.'));
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=approved-list publication refuses omitted approved criterion', 'scripts/implementation-report.test.mjs'], {
      cwd: root, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /Missing expected exception/);
    assert.match(result.stdout, /not ok.*omitted approved criterion/);
    assert.doesNotMatch(result.stdout + result.stderr, /ERR_MODULE_NOT_FOUND|SyntaxError/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const style of ['numbered-dot', 'numbered-parenthesis-indented']) test(`approved-list capture and publication accept ${style} Issue criteria`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-numbered-criteria-'));
  try {
    let body = fs.readFileSync('scripts/fixtures/implementation-numbered-issue.md', 'utf8');
    if (style === 'numbered-parenthesis-indented') body = body.replace(/^(\d+)\. /gm, '   $1) ');
    const source = path.join(root, 'issue-start.md'); fs.writeFileSync(source, body);
    const expected = ['AC1: Пустое имя отклоняется', 'AC2: Список сохраняет прежние заметки', 'AC3: Число заметок обновляется'];
    const candidate = report(root, source);
    assert.deepEqual(capture(root, source).criteria, expected);
    candidate.criteria = expected.map(criterion => ({ ...candidate.criteria[0], criterion }));
    assert.deepEqual(publishPhase(candidate, path.join(root, 'reports/out.json')).criteria.map(c=>c.criterion), expected);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('approved-list capture keeps nested and wrapped text within its parent criterion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-criteria-continuation-'));
  try {
    const source = path.join(root, 'issue-start.md');
    fs.writeFileSync(source, '# Критерии приемки\nГотово, когда:\n1. AC1: Первое условие\n   продолжается\n   * Деталь первого\n2. AC2: Второе условие\n');
    assert.deepEqual(capture(root, source).criteria, ['AC1: Первое условие продолжается * Деталь первого', 'AC2: Второе условие']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const style of ['English list', 'English numbered']) test(`approved-list canonical capture accepts ${style}`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-english-criteria-'));
  try {
    let body = fs.readFileSync('scripts/fixtures/implementation-english-issue.md', 'utf8');
    if (style === 'English numbered') { let n = 0; body = body.replace(/^- /gm, () => `${++n}. `); }
    const source = path.join(root, 'issue-start.md'); fs.writeFileSync(source, body);
    const cli = spawnSync(process.execPath, ['scripts/delivery-state.mjs', 'capture-criteria', '--issue', 'MONO-993', '--attempt', '1', '--issue-file', source, '--root', root], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const expected = ['AC1: Empty names are rejected', 'AC2: Existing notes are retained', 'AC3: The note count updates'];
    assert.deepEqual(JSON.parse(cli.stdout.split('\n')[0]).criteria, expected);
    const candidate = report(root, source);
    candidate.criteria = expected.map(criterion => ({ ...candidate.criteria[0], criterion }));
    assert.deepEqual(publishPhase(candidate, path.join(root, 'reports/out.json')).criteria.map(c => c.criterion), expected);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const name of ['missing-criteria', 'ambiguous-criteria', 'unsupported-language']) test(`approved-list canonical capture refuses ${name} before any write`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-canonical-refusal-'));
  try {
    const source = path.resolve(`scripts/fixtures/implementation-${name}-issue.md`);
    const cli = spawnSync(process.execPath, ['scripts/delivery-state.mjs', 'capture-criteria', '--issue', 'MONO-993', '--attempt', '1', '--issue-file', source, '--root', root], { encoding: 'utf8' });
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    assert.match(cli.stderr, /blocked/);
    for (const label of ['# Критерии приемки', 'Готово, когда:', '# Acceptance criteria', 'Done when:']) assert.ok(cli.stderr.includes(label), cli.stderr);
    assert.deepEqual(fs.readdirSync(root), [], 'refusal must precede even creation of delivery state directory');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('approved-list deliberate removal of English support makes the English regression red', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-english-mutation-'));
  try {
    fs.cpSync(path.resolve('scripts'), path.join(root, 'scripts'), { recursive: true });
    const file = path.join(root, 'scripts/delivery-criteria.mjs');
    const source = fs.readFileSync(file, 'utf8'), english = "  ['Acceptance criteria', 'Done when:'],\n";
    assert.ok(source.includes(english), 'mutation must target the English label pair');
    fs.writeFileSync(file, source.replace(english, ''));
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^approved-list canonical capture accepts English list$', 'scripts/implementation-report.test.mjs'], {
      cwd: root, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /not ok.*canonical capture accepts English list/);
    assert.match(result.stdout, /approved criteria/);
    assert.doesNotMatch(result.stdout + result.stderr, /ERR_MODULE_NOT_FOUND|SyntaxError/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
