import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { captureCriteria, publishPhase } from './delivery-state.mjs';

test('criteria-relative-root resolves from the working copy before persisting', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-relative-root-'));
  try {
    const cli = spawnSync(process.execPath, [path.resolve('scripts/delivery-state.mjs'), 'capture-criteria',
      '--issue', 'MONO-993', '--attempt', '1', '--issue-file', path.resolve('scripts/fixtures/implementation-approved-issue.md'), '--root', '.orchestrator'],
    { cwd: root, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(fs.existsSync(path.join(root, '.orchestrator/reports/MONO-993-criteria-a1.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
for (const [name, options, message] of [
  ['root', { root: '' }, /delivery root/],
  ['issue', { issue: '../MONO-993' }, /issue key/],
  ['attempt', { attempt: 0 }, /attempt number/],
]) test(`criteria-invalid-${name} explains the actual identity refusal`, () => {
  assert.throws(() => captureCriteria({ root: os.tmpdir(), issue: 'MONO-993', attempt: 1,
    issueFile: path.resolve('scripts/fixtures/implementation-approved-issue.md'), ...options }), message);
});

for (const [name, file, before, after, pattern] of [
  ['relative-root', 'delivery-criteria.mjs', 'root = path.resolve(root);', "if (!path.isAbsolute(root)) fail('absolute root required'); root = path.resolve(root);", '^criteria-relative-root'],
  ['root-diagnostic', 'delivery-criteria.mjs', "fail('delivery root must name a directory')", "fail('delivery identity required')", '^criteria-invalid-root'],
  ['issue-diagnostic', 'delivery-criteria.mjs', "fail('invalid issue key')", "fail('delivery identity required')", '^criteria-invalid-issue'],
  ['attempt-diagnostic', 'delivery-criteria.mjs', "fail('attempt number must be a positive integer')", "fail('delivery identity required')", '^criteria-invalid-attempt'],
  ['capture-refusal-publication', 'delivery-criteria.mjs', 'const stop = report.pre_capture_stop;', 'return null; const stop = report.pre_capture_stop;', '^stop-after-capture-refusal-'],
  ['start-refusal-publication', 'delivery-criteria.mjs', 'const stop = report.pre_capture_stop;', 'return null; const stop = report.pre_capture_stop;', '^stop-after-start-refusal'],
  ['completed-without-capture', 'delivery-criteria.mjs', "fail('missing immutable delivery-start capture');", 'return;', '^work-without-capture'],
]) test(`implementation deliberate-break ${name} makes the named regression red`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-implementation-mutation-'));
  try {
    fs.cpSync(path.resolve('scripts'), path.join(root,'scripts'),{recursive:true});
    const target=path.join(root,'scripts',file), source=fs.readFileSync(target,'utf8');
    assert.ok(source.includes(before),name);fs.writeFileSync(target,source.replace(before,after));
    const run=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+pattern,'scripts/implementation-report.test.mjs'],
      {cwd:root,encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='NODE_TEST_CONTEXT'))});
    assert.equal(run.status,1,run.stdout+run.stderr);assert.match(run.stdout,/not ok/);
    assert.doesNotMatch(run.stdout+run.stderr,/ERR_MODULE_NOT_FOUND|SyntaxError/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

const approvedIssue = path.resolve('scripts/fixtures/implementation-approved-issue.md');

function preCaptureReport(root, stop) {
  const r = report(root);
  fs.unlinkSync(path.join(root, 'reports/MONO-993-criteria-a1.json'));
  return { ...r, phase_result: 'blocked', criteria: [], pre_capture_stop: stop };
}
for (const fixture of ['missing-criteria', 'ambiguous-criteria', 'unsupported-language'])
  test(`stop-after-capture-refusal-${fixture} publishes actual refusal with no invented criteria`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-pre-capture-'));
    try {
      const source = path.resolve(`scripts/fixtures/implementation-${fixture}-issue.md`);
      assert.throws(() => capture(root, source), /blocked/);
      const r = preCaptureReport(root, { kind: 'capture-refused', issue_file: source,
        command: 'node scripts/delivery-state.mjs capture-criteria ...', exit: 1, reason: 'Захват отказал: неоднозначный или отсутствующий раздел' });
      const out = publishPhase(r, path.join(root, 'reports/stop.json'));
      assert.deepEqual(out.criteria, []);
      const body = out.linear_mutations_pending[0].payload.body;
      assert.match(body, /# Критерии приемки/); assert.match(body, /Готово, когда:/);
      assert.match(body, /Захват отказал/);
      if (fixture === 'ambiguous-criteria') assert.doesNotMatch(body, /Недостающие метки/);
      else assert.match(body, /Недостающие метки/);
      assert.equal(out.phase_result, 'blocked');
      assert.throws(() => publishPhase({ ...r, phase_result: 'implemented-needs-preflight' }, path.join(root, 'reports/bad.json')), /implementation report/);
      assert.throws(() => publishPhase({ ...r, phase_result: 'needs-human' }, path.join(root, 'reports/bad.json')), /implementation report/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

test('stop-after-start-refusal publishes blocked or integrity stop before capture', () => {
  for (const status of ['blocked', 'needs-human']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-start-refused-'));
    try {
      const r = preCaptureReport(root, { kind: 'start-refused', command: 'node scripts/idea-gate.mjs check --mode approved ...',
        exit: 1, verdict: 'read-failed', reason: 'Проверка старта отказала' });
      r.phase_result = status;
      const out = publishPhase(r, path.join(root, 'reports/stop.json'));
      assert.deepEqual(out.criteria, []);
      assert.match(out.linear_mutations_pending[0].payload.body, /Проверка старта отказала/);
      assert.match(out.linear_mutations_pending[0].payload.body, /# Критерии приемки/);
      assert.doesNotMatch(out.linear_mutations_pending[0].payload.body, /Недостающие метки/);
      assert.throws(() => publishPhase({ ...r, kind: 'confirmation-request' }, path.join(root, 'reports/bad.json')), /implementation report/);
      assert.throws(() => publishPhase({ ...r, pre_capture_stop: { ...r.pre_capture_stop, exit: 0, verdict: 'pass' } }, path.join(root, 'bad.json')), /implementation report/);
      const incomplete = { ...r, pre_capture_stop: { ...r.pre_capture_stop } }; delete incomplete.pre_capture_stop.verdict;
      assert.throws(() => publishPhase(incomplete, path.join(root, 'bad.json')), /implementation report/);
      capture(root);
      assert.throws(() => publishPhase(r, path.join(root, 'reports/bad.json')), /cannot replace an existing approved list/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('work-without-capture still refuses completed and ordinary stopped reports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-no-capture-'));
  try {
    const r = report(root);
    fs.unlinkSync(path.join(root, 'reports/MONO-993-criteria-a1.json'));
    for (const phase_result of ['implemented-needs-preflight', 'blocked', 'needs-human', 'scope-drift-needs-handoff'])
      assert.throws(() => publishPhase({ ...r, phase_result }, path.join(root, 'out.json')), /missing immutable/);
    const stop = preCaptureReport(root, { kind: 'capture-refused', issue_file: approvedIssue,
      command: 'capture-criteria', exit: 1, reason: 'Pretend refusal of valid input' });
    assert.throws(() => publishPhase(stop, path.join(root, 'stop.json')), /implementation report/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ambiguous-heading-level reports refusal without inventing missing labels', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-refusal-labels-'));
  try {
    const source=path.join(root,'ambiguous.md');
    fs.writeFileSync(source,fs.readFileSync('scripts/fixtures/implementation-ambiguous-criteria-issue.md','utf8')
      .replace('# Критерии приемки','## Критерии приемки ##'));
    assert.throws(()=>capture(root,source),/duplicate acceptance section/);
    const r=preCaptureReport(root,{kind:'capture-refused',issue_file:source,command:'capture-criteria',exit:1,reason:'Неоднозначный раздел'});
    const out=publishPhase(r,path.join(root,'reports/out.json'));
    assert.doesNotMatch(out.linear_mutations_pending[0].payload.body,/Недостающие метки/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
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
      const caseRoot = path.join(root, outcome);
      const candidate = report(caseRoot); candidate.criteria[0].outcome = outcome;
      if (outcome === 'unverified') candidate.not_verified = [{ what: candidate.criteria[0].criterion,
        why: 'Нет доступа к установленному приложению', risk: 'Справка может расходиться с установленной версией' }];
      const input = path.join(root, `${outcome}.json`), output = path.join(root, outcome, 'reports/MONO-993-phase-code.json');
      fs.writeFileSync(input, JSON.stringify(candidate));
      const result = spawnSync(process.execPath, ['scripts/delivery-state.mjs', 'publish', '--report', input, '--output', output, '--root', caseRoot], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(fs.readFileSync(output)).criteria, candidate.criteria);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('implementation-publication keeps broken and unfinished work visible as blocked, never confirmed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-code-report-'));
  try {
    for (const outcome of ['broken', 'unverified']) {
      const caseRoot = path.join(root, outcome);
      const candidate = report(caseRoot); candidate.phase_result = 'blocked'; candidate.criteria[0].outcome = outcome;
      candidate.criteria[0].done = false;
      if (outcome === 'unverified') candidate.not_verified = [{ what: candidate.criteria[0].criterion, why: 'Не сделано', risk: 'Критерий не выполнен' }];
      assert.equal(publishPhase(candidate, path.join(caseRoot, 'reports/MONO-993-phase-code.json'), undefined, caseRoot).phase_result, 'blocked');
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
      const caseRoot = path.join(root, String(whitespace));
      const candidate = report(caseRoot);
      if (whitespace) candidate.criteria[1].criterion = '  Список  содержит\nвсе команды  ';
      assert.deepEqual(publishPhase(candidate, path.join(caseRoot, 'reports/exact.json')).criteria, candidate.criteria);
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
