import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkResearch, lintResearchDraft, RESEARCH_GATE_DEFAULT_SINCE } from './idea-gate.mjs';
import { ideaDispatchFixture, ideaProjectId } from './fixtures/idea-dispatch.mjs';

const projectId = 'c45ee7dc-3226-4401-854d-a82944949601';
const otherId = '11111111-1111-1111-1111-111111111111';
const fence = record => '```mono-research\n' + JSON.stringify(record) + '\n```';
const record = () => ({ project: projectId, outcome: 'ready', reason: '', interface: false });
function input() {
  return { ideaVerdict: { ok: true, code: 'pass' }, project: { id: projectId },
    issueContext: { projectId }, since: '2026-10-17', approval: { createdAt: '2026-10-17T00:00:00Z' },
    approvalBody: 'Approved: https://linear.app/document/research-1',
    document: { id: 'research-1', url: 'https://linear.app/document/research-1', title: 'Исследование', projectId,
      body: 'Произвольная проза.\n' + fence(record()) } };
}
function expectCode(options, code) {
  const result = checkResearch(options);
  assert.deepEqual(result, { ok: ['pass', 'not-required', 'issue-only', 'legacy-before-cutoff'].includes(code), code,
    documentId: options.document?.id ?? null });
}

test('research checks only the referenced document fence and permits extra fields', () => {
  expectCode(input(), 'pass');
  const options = input();
  options.approvalBody = 'Одобрено research-1';
  options.document.body = 'Проза без полей и разделов.\n```json\n{}\n```\n' + fence(record());
  expectCode(options, 'pass');
  const live = fs.readFileSync(new URL('./fixtures/research-gate/linear-readback-fence.txt', import.meta.url), 'utf8');
  options.document.body = 'Изменённая проза\n```mono-research\n' + live + '\n```';
  expectCode(options, 'pass');
  assert.equal(JSON.parse(live).project, projectId);
});

test('approval references cannot match a different document through an id or URL prefix', () => {
  for (const approvalBody of ['research-10', 'prefix-research-1', 'research-1-extra', 'research-1_suffix',
    'https://linear.app/document/research-10', 'https://linear.app/document/research-1-extra'])
    expectCode({ ...input(), approvalBody }, 'research-not-referenced');
  const options = input(); options.document.id = 'separate-id';
  for (const suffix of ['0', '/other', '?other=1', '#other', '.extra'])
    expectCode({ ...options, approvalBody: options.document.url + suffix }, 'research-not-referenced');
  for (const approvalBody of ['[Исследование](https://linear.app/document/research-1)',
    '<document id="separate-id" href="https://linear.app/document/research-1">Исследование</document>',
    'Одобрено https://linear.app/document/research-1.']) expectCode({ ...options, approvalBody }, 'pass');
});

test('research has closed refusal codes for reference, fence, identity, outcome and reason', () => {
  for (const [change, code] of [
    [o => { o.approvalBody = 'Одобрено без ссылки'; }, 'research-not-referenced'],
    [o => { delete o.document; }, 'research-missing'],
    [o => { o.document.body = '{}'; }, 'research-bad-record'],
    [o => { o.document.body += '\n' + fence(record()); }, 'research-bad-record'],
    [o => { o.document.body = '```mono-research\n{bad}\n```'; }, 'research-bad-record'],
    [o => { o.document.body = '```mono-research\n{}'; }, 'research-bad-record'],
    [o => { const r = record(); delete r.project; o.document.body = fence(r); }, 'research-bad-record'],
    [o => { o.document.projectId = otherId; }, 'research-other-project'],
    [o => { o.document.body = fence({ ...record(), project: otherId }); }, 'research-other-project'],
    [o => { o.document.body = fence({ ...record(), project: 'not-a-uuid' }); }, 'research-bad-record'],
    [o => { o.document.body = fence({ ...record(), outcome: 'unknown' }); }, 'research-bad-record'],
    ...['hold', 'not-required'].flatMap(outcome => [undefined, null, '', '  ', 1].map(reason =>
      [o => { o.document.body = fence({ ...record(), outcome, reason }); }, 'research-bad-record'])),
    [o => { o.ideaVerdict = { ok: false, code: 'no-record' }; }, 'read-failed'],
  ]) { const options = input(); change(options); expectCode(options, code); }
  for (const outcome of ['hold', 'not-required']) {
    const options = input(); options.document.body = fence({ ...record(), outcome, reason: 'Достаточная причина' });
    expectCode(options, outcome === 'hold' ? 'pass' : 'not-required');
  }
});

test('research release cutoff uses approval UTC timestamp strictly before 2026-10-19', () => {
  const options = input(); delete options.document;
  assert.equal(RESEARCH_GATE_DEFAULT_SINCE, '2026-10-19');
  delete options.since;
  options.approval.createdAt = '2026-10-18T23:59:59.999Z'; expectCode(options, 'legacy-before-cutoff');
  options.approval.createdAt = '2026-10-19T00:00:00Z'; expectCode(options, 'research-missing');
  options.approval.createdAt = '2026-10-19T01:00:00+02:00'; expectCode(options, 'legacy-before-cutoff');
  options.approval.createdAt = '2026-10-19T02:00:00+02:00'; expectCode(options, 'research-missing');
  options.approval.createdAt = '2026-10-19T00:00:00.001Z'; expectCode(options, 'research-missing');
  expectCode({ ...options, since: '2026-10-20' }, 'legacy-before-cutoff');
  for (const since of [null, '2026-02-30', '', '2026-10-17T00:00:00Z']) expectCode({ ...options, since }, 'bad-since');
  expectCode({ ...options, approval: { createdAt: 'bad' } }, 'read-failed');
});

test('only an idea issue-only verdict with no Project can exempt research', () => {
  expectCode({ ideaVerdict: { ok: true, code: 'issue-only' }, issueContext: { projectId: null } }, 'issue-only');
  const options = input(); options.ideaVerdict.code = 'issue-only';
  expectCode(options, 'research-other-project');
  expectCode({ ...options, project: undefined }, 'research-other-project');
});

function snapshot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-research-'));
  const write = (name, value) => {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const cli = (config = true) => spawnSync(process.execPath, ['scripts/idea-gate.mjs', 'research', '--snapshot', root,
    ...(config ? ['--config', path.join(root, 'config.json')] : [])], { encoding: 'utf8' });
  try { run({ root, write, cli }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('release CLI requires research on and after the default cutoff without a researchGate override', () => snapshot(({ root, write, cli }) => {
  const prepare = createdAt => ideaDispatchFixture(root, 'MONO-178', i => {
    i.approval.createdAt = createdAt; i.body += '\nhttps://linear.app/document/research-1';
  });
  const check = (code, ok) => {
    const result = cli(false);
    assert.equal(result.status, ok ? 0 : 1, result.stderr + result.stdout);
    assert.equal(result.stdout.trim(), `research-gate: ${ok ? 'pass' : 'fail'}: ${code} project=${ideaProjectId}`);
  };
  prepare('2026-10-18T23:59:59.999Z'); check('legacy-before-cutoff', true);
  prepare('2026-10-19T00:00:00Z'); check('research-missing', false);
  prepare('2026-10-19T12:00:00Z'); check('research-missing', false);
  const { body, ...metadata } = input().document;
  metadata.projectId = ideaProjectId;
  write('research/document.json', metadata);
  write('research/document.md', body.replaceAll(projectId, metadata.projectId)); check('pass', true);
  write('research/document.md', fence({ ...record(), project: metadata.projectId, outcome: 'not-required', reason: 'Обратимая правка текста' }));
  check('not-required', true);
}));
test('research CLI emits one line, reads only the named document and fails closed on read errors', () => snapshot(({ root, write, cli }) => {
  ideaDispatchFixture(root, 'MONO-175', i => { i.project.id = projectId; i.context.projectId = projectId;
    i.records.comments[0].body = i.records.comments[0].body.replaceAll('59c079b6-fc26-40a6-ba19-9467674fa637', projectId);
    i.body += '\nhttps://linear.app/document/research-1'; i.approval.createdAt = '2026-10-17T00:00:00Z'; });
  write('config.json', { ideaGate: { since: '2026-10-17' }, researchGate: { since: '2026-10-17' } });
  const options = input(), { body, ...metadata } = options.document;
  write('research/document.json', metadata); write('research/document.md', body);
  const check = (code, ok = false, configured = true) => {
    const result = cli(configured); assert.equal(result.status, ok ? 0 : 1, result.stderr + result.stdout);
    assert.equal(result.stdout.trim(), `research-gate: ${ok ? 'pass' : 'fail'}: ${code} project=${projectId}`);
  };
  check('pass', true);
  write('research/unrelated-document.md', fence({ outcome: 'invalid' })); check('pass', true);
  write('research/document.md', 'No fence'); check('research-bad-record');
  fs.unlinkSync(path.join(root, 'research/document.md')); check('read-failed');
  fs.unlinkSync(path.join(root, 'research/document.json')); check('research-missing');
  check('legacy-before-cutoff', true, false);
  write('config.json', { researchGate: { since: null } }); check('bad-since');
}));
test('CLI rejects a planted issue-only marker on a Project snapshot', () => snapshot(({ root, write, cli }) => {
  ideaDispatchFixture(root);
  write('issue-only.json', { seam: { package_kind: 'issue-only', lifecycle_state_entity: 'issue', approval_status: 'approved-fresh' } });
  write('config.json', { researchGate: { since: '2026-10-17' } });
  const result = cli(); assert.equal(result.status, 1); assert.match(result.stdout, /fail: read-failed project=/);
}));
test('CLI exempts projectless and pre-cutoff snapshots without reading research', () => snapshot(({ root, write, cli }) => {
  write('issue-only.json', { seam: { package_kind: 'issue-only', lifecycle_state_entity: 'issue', approval_status: 'approved-fresh' } });
  write('config.json', { researchGate: { since: '2026-10-17' } });
  fs.mkdirSync(path.join(root, 'research')); write('research/document.json', 'invalid JSON');
  let result = cli(); assert.equal(result.status, 0, result.stdout); assert.equal(result.stdout.trim(), 'research-gate: pass: issue-only project=null');
  fs.unlinkSync(path.join(root, 'issue-only.json'));
  ideaDispatchFixture(root);
  result = cli(); assert.equal(result.status, 0, result.stdout); assert.match(result.stdout, /pass: legacy-before-cutoff/);
}));

const draftFixture = name => fs.readFileSync(new URL(`./fixtures/research-draft/${name}`, import.meta.url), 'utf8');
const kinds = result => result.findings.map(finding => finding.kind);
const draftProject = projectId;

test('research-draft passes the rewritten Handoff document and its Linear read-back form', () => {
  const good = draftFixture('good.md');
  const result = lintResearchDraft(good, { project: draftProject });
  assert.deepEqual(result.findings, []);
  assert.ok(result.measures.body <= 1000 && result.measures.summary <= 150 && result.measures.sources === 25);
  // Linear rewrites list markers and escapes brackets; neither may add findings.
  const readBack = good.replace(/^- /gm, '* ').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  assert.deepEqual(lintResearchDraft(readBack, { project: draftProject }).findings, []);
  assert.deepEqual(kinds(lintResearchDraft(good, { project: otherId })), ['other-project']);
  // Linear read-back wraps project mentions in chips; markup is not reader text.
  const chip = '<project id="11111111-1111-1111-1111-111111111111" href="https://linear.app/example/project/x">';
  const chipped = readBack.replace(/«Оркестратор без присмотра»/g, `${chip}Оркестратор без присмотра</project>`);
  assert.notEqual(chipped, readBack);
  assert.deepEqual(lintResearchDraft(chipped, { project: draftProject }).findings, []);
  // A bare project link in a source line becomes a chip with the project's long name.
  const longChip = `${chip}Этап Handoff: тимлид сверяет готовое и режет на задачи, длинное имя проекта из многих слов</project>`;
  const linked = readBack.replace(/https:\/\/linear\.app\/example\/project\/[^\s,]+/g, longChip);
  assert.notEqual(linked, readBack);
  assert.deepEqual(lintResearchDraft(linked, { project: draftProject }).findings, []);
});

test('research-draft reports the 0.34.0 live document problems by kind', () => {
  const result = lintResearchDraft(draftFixture('live-0.34.0-excerpt.md'));
  for (const kind of ['lead-metadata', 'lead-words', 'summary-words', 'fact-code-in-text', 'paragraph-words', 'fact-not-cited'])
    assert.ok(kinds(result).includes(kind), kind);
  assert.equal(result.ok, false);
});

test('research-draft enforces dash, table, nested list, headings and source limits', () => {
  const good = draftFixture('good.md');
  const cases = {
    'long-dash': good.replace('Готово 19.10.2026.', 'Готово — 19.10.2026.'),
    table: good.replace('## Кратко\n', '## Кратко\n\n| а | б |\n|---|---|\n'),
    'nested-list': good.replace('- Интерфейс: нет.', '- Интерфейс: нет.\n  - вложенный пункт'),
    'heading-words': good.replace('### 2. ', '### 2. Очень длинный заголовок находки из многих слов, который никто не дочитает до конца, '),
    'source-words': good.replace('- Ф24. ', '- Ф24. ' + 'слово '.repeat(46)),
    'advice-missing': good.replace('**Совет: делать.**', 'Делать.'),
    'fact-unknown': good.replace('Откуда: Ф23, Ф24.', 'Откуда: Ф23, Ф24, Ф99.'),
    'fact-not-cited': good.replace('Откуда: Ф13, Ф20–Ф22.', 'Откуда: Ф13, Ф20, Ф21.'),
    'fact-code-in-text': good.replace('Готово 19.10.2026.', 'Готово 19.10.2026, см. Ф3.'),
    'short-date': good.replace('Готово 19.10.2026.', 'Готово 19.10.'),
  };
  for (const [kind, text] of Object.entries(cases)) assert.ok(kinds(lintResearchDraft(text)).includes(kind), kind);
});

test('research-draft requires exactly one valid final top-level mono-research block', () => {
  const good = draftFixture('good.md');
  const block = good.slice(good.indexOf('```mono-research'));
  assert.ok(kinds(lintResearchDraft(good.replace(block, ''))).includes('block-count'));
  assert.ok(kinds(lintResearchDraft(good + '\n' + block)).includes('block-count'));
  assert.ok(kinds(lintResearchDraft(good.replace(block, block + '\nХвост после блока.'))).includes('block-not-last'));
  assert.ok(kinds(lintResearchDraft(good.replace(block, block.replace(/^/gm, '  ')))).includes('block-indented'));
  assert.ok(kinds(lintResearchDraft(good.replace('"outcome": "ready"', '"outcome": "hold"'))).includes('bad-record'));
  assert.deepEqual(kinds(lintResearchDraft(good.replace(block, block.replace('```mono-research', '````mono-research').replace(/```\n?$/, '````\n')))), []);
});

test('research-draft requires all four machine fields with valid types', () => {
  const good = draftFixture('good.md');
  const block = good.slice(good.indexOf('```mono-research'));
  const valid = { project: projectId, outcome: 'ready', reason: null, interface: false };
  const check = value => lintResearchDraft(good.replace(block, fence(value)));
  for (const key of Object.keys(valid)) {
    const missing = { ...valid }; delete missing[key];
    assert.ok(kinds(check(missing)).includes('bad-record'), `missing ${key}`);
  }
  for (const value of [null, 'false', 0, {}, []])
    assert.ok(kinds(check({ ...valid, interface: value })).includes('bad-record'), `interface ${JSON.stringify(value)}`);
  for (const value of [false, 0, {}, []])
    assert.ok(kinds(check({ ...valid, reason: value })).includes('bad-record'), `reason ${JSON.stringify(value)}`);
  for (const outcome of ['ready', 'hold', 'not-required']) {
    const value = { ...valid, outcome, reason: outcome === 'ready' ? null : 'A concrete reason', interface: true };
    assert.deepEqual(check(value).findings, []);
    if (outcome !== 'ready') for (const reason of [null, '', '  '])
      assert.ok(kinds(check({ ...value, reason })).includes('bad-record'), `${outcome} reason ${JSON.stringify(reason)}`);
  }
});

test('research-draft rejects raw invalid records without Markdown repair', () => {
  for (const name of ['escaped-invalid-json.md', 'missing-field.md', 'markdown-escaped-value.md']) {
    const draft = draftFixture(name);
    for (const text of [draft, draft.replace(/\n/g, '\r\n')]) {
      const result = lintResearchDraft(text, { language: 'en' });
      assert.equal(result.ok, false, name);
      assert.ok(kinds(result).includes('bad-record'), name);
    }
  }
});

test('research-draft preserves valid literal Markdown escapes inside JSON', () => {
  const draft = 'Research is not required: a reversible copy edit. 20.10.2026.\n\n' +
    fence({ project: projectId, outcome: 'not-required', reason: String.raw`\[pending\] \*literal\*`, interface: false });
  assert.deepEqual(lintResearchDraft(draft, { language: 'en' }).findings, []);
  assert.deepEqual(lintResearchDraft(draft.replace(/\n/g, '\r\n'), { language: 'en' }).findings, []);
});

test('research-draft accepts a one-line not-required document and English markers', () => {
  const notRequired = 'Исследование не требуется: правка текста одной кнопки, вернуть можно одной правкой. 19.10.2026.\n\n' +
    fence({ project: projectId, outcome: 'not-required', reason: 'обратимо', interface: false });
  assert.deepEqual(lintResearchDraft(notRequired).findings, []);
  const english = 'Research for the decision on reminders. Ready 19.10.2026.\n\n## Summary\n\nClients read messengers.\n\n' +
    '**Advice: build.** Messengers win.\n\nFrom: F1.\n\n## Sources\n\n- F1. Survey: messengers win. https://example.com, 01.10.2026.\n\n' +
    fence({ project: projectId, outcome: 'ready', reason: null, interface: false });
  assert.deepEqual(lintResearchDraft(english, { language: 'en' }).findings, []);
  assert.ok(kinds(lintResearchDraft(english)).includes('advice-missing'));
});

test('research-draft CLI prints JSON and exits 1 only on findings or read errors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-draft-'));
  try {
    const run = args => spawnSync(process.execPath, ['scripts/idea-gate.mjs', 'research-draft', ...args], { encoding: 'utf8' });
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ languages: { linear: 'Russian' } }));
    let result = run(['--draft', fileURLToPathSafe('good.md'), '--config', path.join(root, 'config.json')]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
    result = run(['--draft', fileURLToPathSafe('live-0.34.0-excerpt.md')]);
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).ok, false);
    fs.writeFileSync(path.join(root, 'en.json'), JSON.stringify({ languages: { linear: 'en' } }));
    fs.writeFileSync(path.join(root, 'en.md'), 'Research for the decision on reminders. Ready 19.10.2026.\n\n## Summary\n\nClients read messengers.\n\n' +
      '**Advice: build.** Messengers win.\n\nFrom: F1.\n\n## Sources\n\n- F1. Survey: messengers win. https://example.com, 01.10.2026.\n\n' +
      fence({ project: projectId, outcome: 'ready', reason: null, interface: false }));
    result = run(['--draft', path.join(root, 'en.md'), '--config', path.join(root, 'en.json')]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    result = run(['--draft', path.join(root, 'missing.md')]);
    assert.equal(result.status, 1); assert.deepEqual(JSON.parse(result.stdout).findings, [{ kind: 'read-failed' }]);
    result = run(['--draft']);
    assert.equal(result.status, 1); assert.deepEqual(JSON.parse(result.stdout).findings, [{ kind: 'read-failed' }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function fileURLToPathSafe(name) { return fileURLToPath(new URL(`./fixtures/research-draft/${name}`, import.meta.url)); }
