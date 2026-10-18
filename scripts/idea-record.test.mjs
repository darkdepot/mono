import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkIdea, ideaFingerprint, lintNotes, RESEARCH_GATE_DEFAULT_SINCE } from './idea-gate.mjs';
import { resolveRole } from './runtime.mjs';

test('Research cutoff starts on the first full UTC day after release 0.33.0', () => {
  assert.equal(RESEARCH_GATE_DEFAULT_SINCE, '2026-10-19');
});

const projectId = '59c079b6-fc26-40a6-ba19-9467674fa637';
const otherId = '11111111-1111-1111-1111-111111111111';
const cli = args => spawnSync(process.execPath, ['scripts/idea-gate.mjs', ...args], { encoding: 'utf8' });
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function sandbox(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-idea-record-'));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function write(root, file, value) {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  return target;
}
function saveRequests(root, source) {
  const calls = json(new URL('calls.json', source));
  for (const n of [1, 2, 3]) {
    const args = calls.find(call => call.file === `list_comments.limit4.page-${n}.json`).arguments;
    write(root, `dump/comments-${n}.request.json`, Object.hasOwn(args, 'cursor') ? { cursor: args.cursor } : {});
  }
}
function setup(root, host, language = 'Russian') {
  const source = new URL(`./fixtures/idea-gate/probe/${host}/`, import.meta.url);
  const project = json(new URL('get_project.json', source));
  const pages = [1, 2, 3].map(n => json(new URL(`list_comments.limit4.page-${n}.json`, source)));
  const existing = pages.flatMap(page => page.comments).find(c => c.body.includes('mono-idea: approved'));
  assert.ok(existing, 'live probe has an approval record');
  let draft = existing.body.split('```mono-idea-snapshot\n')[1].split('\n```')[0];
  if (language === 'English') for (const [ru, en] of [['Что', 'What'], ['Зачем', 'Why'], ['Образ результата', 'Target outcome'], ['Неизвестные', 'Unknowns']]) draft = draft.replace(`## ${ru}\n`, `## ${en}\n`);
  write(root, 'draft.md', draft);
  write(root, 'config.json', { languages: { linear: language } });
  write(root, 'notes.md', 'Ссылка разведчика: https://example.com/fact\n\n## Что входит\nСтарый раздел');
  const args = ['record', '--draft', path.join(root, 'draft.md'), '--config', path.join(root, 'config.json'), '--out', root];
  let result = cli(args); assert.equal(result.status, 0, result.stdout + result.stderr);
  result = cli([...args, '--project', projectId, '--notes', path.join(root, 'notes.md')]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const body = fs.readFileSync(path.join(root, 'body.md'), 'utf8');
  const comment = fs.readFileSync(path.join(root, 'comment.md'), 'utf8');
  project.description = body;
  // Keep live metadata, including updatedAt before createdAt. Replace only content
  // for the generated-record round trip; raw probe files remain byte-for-byte.
  pages[0].comments[0].body = comment;
  write(root, 'dump/project.json', project);
  pages.forEach((page, i) => write(root, `dump/comments-${i + 1}.json`, page));
  saveRequests(root, source);
  return { project, pages, draft, body, comment, args,
    verify: ['verify', '--project', projectId, '--dump', path.join(root, 'dump'), '--expect', path.join(root, 'comment.md'), '--config', path.join(root, 'config.json')] };
}
function verify(args, code) {
  const result = cli(args), lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 2, result.stdout + result.stderr);
  const verdict = JSON.parse(lines[1]);
  assert.equal(verdict.code, code, result.stdout + result.stderr);
  assert.equal(result.status, code === 'pass' ? 0 : 1, result.stdout + result.stderr);
  assert.match(lines[0], code === 'pass' ? /^Готово$/ : code === 'stale' ? /^Нужно новое «да»: / : /^Стоп: /);
  return verdict;
}
for (const host of ['claude-code', 'codex']) {
  test(`${host}: record body and comment round trip through complete live-shaped pages`, () => sandbox(root => {
    const s = setup(root, host);
    assert.equal((s.body.match(/^## /gm) ?? []).length, 3);
    assert.ok(s.comment.includes(s.draft));
    assert.ok(s.comment.indexOf('## Что входит') > s.comment.indexOf('\n```\n\n## Заметки'));
    const result = verify(s.verify, 'pass');
    assert.equal(result.recordId, s.pages[0].comments[0].id);
    assert.equal(result.fingerprint, ideaFingerprint(s.draft));
    assert.equal(checkIdea({ mode: 'fresh', project: { id: projectId, createdAt: s.project.createdAt, status: s.project.status.name, body: s.body, language: 'ru' }, records: { complete: true, comments: [{ ...s.pages[0].comments[0] }] } }).code, 'pass');
    const command = cli([...s.args, '--project', projectId]);
    assert.equal(command.status, 0, command.stdout + command.stderr);
    const withoutNotes = fs.readFileSync(path.join(root, 'comment.md'), 'utf8');
    assert.match(withoutNotes, new RegExp(`sha256=${result.fingerprint}`));
  }));
  test(`${host}: incomplete, duplicate, unordered and malformed pages stop`, () => sandbox(root => {
    const s = setup(root, host);
    fs.unlinkSync(path.join(root, 'dump/comments-2.json')); verify(s.verify, 'read-failed');
    write(root, 'dump/comments-2.json', s.pages[1]);
    fs.unlinkSync(path.join(root, 'dump/comments-3.json')); verify(s.verify, 'read-failed');
    write(root, 'dump/comments-3.json', s.pages[2]);
    for (const mutate of [
      pages => { pages[0].cursor = 'wrong'; },
      pages => { pages[2].cursor = 'unexpected'; },
      pages => { pages[0].hasNextPage = false; delete pages[0].cursor; },
      pages => { pages[1].comments[0] = pages[0].comments[0]; },
      pages => { pages[1].comments.reverse(); },
      pages => { delete pages[1].comments[0].createdAt; },
    ]) {
      const pages = structuredClone(s.pages); mutate(pages);
      pages.forEach((page, i) => write(root, `dump/comments-${i + 1}.json`, page));
      verify(s.verify, 'read-failed');
    }
  }));
  test(`${host}: skipped middle page and invalid request cursors stop`, () => sandbox(root => {
    const s = setup(root, host);
    verify(s.verify, 'pass');
    for (const request of [{ cursor: 'unexpected' }, { cursor: null }, { extra: true }]) {
      write(root, 'dump/comments-1.request.json', request); verify(s.verify, 'read-failed');
    }
    write(root, 'dump/comments-1.request.json', {});
    const second = json(path.join(root, 'dump/comments-2.request.json'));
    for (const request of [{}, { cursor: 'wrong' }, { ...second, extra: true }]) {
      write(root, 'dump/comments-2.request.json', request); verify(s.verify, 'read-failed');
    }
    fs.unlinkSync(path.join(root, 'dump/comments-2.request.json')); verify(s.verify, 'read-failed');
    // Keep page 3's actual request when renumbering: its cursor proves page 2 was skipped.
    write(root, 'dump/comments-2.json', s.pages[2]);
    fs.renameSync(path.join(root, 'dump/comments-3.request.json'), path.join(root, 'dump/comments-2.request.json'));
    fs.unlinkSync(path.join(root, 'dump/comments-3.json'));
    verify(s.verify, 'read-failed');
  }));
  test(`${host}: exact expected comment, project UUID and changed body`, () => sandbox(root => {
    const s = setup(root, host);
    s.project.uuid = otherId; write(root, 'dump/project.json', s.project); verify(s.verify, 'other-project');
    s.project.uuid = projectId; write(root, 'dump/project.json', s.project);
    write(root, 'comment.md', s.comment.replace('Ссылка разведчика:', 'Изменённая ссылка:')); verify(s.verify, 'no-record');
    write(root, 'comment.md', s.comment);
    s.project.description += '\nChanged outcome'; write(root, 'dump/project.json', s.project); verify(s.verify, 'stale');
    s.project.description = s.body; write(root, 'dump/project.json', s.project);
    const foreign = s.comment.replace(`project=${projectId}`, `project=${otherId}`);
    write(root, 'comment.md', foreign); s.pages[0].comments[0].body = foreign;
    write(root, 'dump/comments-1.json', s.pages[0]); verify(s.verify, 'other-project');
  }));
  test(`${host}: record and verify tolerate only trailing line endings`, () => sandbox(root => {
    const s = setup(root, host);
    write(root, 'notes.md', 'Ссылка разведчика: https://example.com/fact\n\n');
    const recorded = cli([...s.args, '--project', projectId, '--notes', path.join(root, 'notes.md')]);
    assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
    const comment = fs.readFileSync(path.join(root, 'comment.md'), 'utf8');
    s.pages[0].comments[0].body = comment.replace(/[\r\n]+$/, '');
    write(root, 'dump/comments-1.json', s.pages[0]);
    verify(s.verify, 'pass');
    assert.ok(!/[\r\n]$/.test(comment), 'record emits no trailing line ending');
    for (const expectedSuffix of ['', '\n', '\n\n', '\r\n', '\r\n\r\n']) {
      for (const savedSuffix of ['', '\n', '\n\n', '\r\n', '\r\n\r\n']) {
        write(root, 'comment.md', comment + expectedSuffix);
        s.pages[0].comments[0].body = comment + savedSuffix;
        write(root, 'dump/comments-1.json', s.pages[0]);
        verify(s.verify, 'pass');
      }
    }
    write(root, 'comment.md', comment);
    for (const changed of [comment.replace('Ссылка разведчика:', 'Изменённая ссылка:'),
      comment.replace('\n\n', '\n'), comment.replace('\n', '\r\n'), ' ' + comment, comment + ' ', comment + '\n \n']) {
      s.pages[0].comments[0].body = changed;
      write(root, 'dump/comments-1.json', s.pages[0]);
      verify(s.verify, 'no-record');
    }
    const noNotes = cli([...s.args, '--project', projectId]);
    assert.equal(noNotes.status, 0, noNotes.stdout + noNotes.stderr);
    assert.ok(!/[\r\n]$/.test(fs.readFileSync(path.join(root, 'comment.md'), 'utf8')));
  }));
  test(`${host}: old approval without notes, single page and English headings`, () => sandbox(root => {
    const s = setup(root, host, 'English');
    const noNotes = s.comment.split('\n## Заметки')[0];
    write(root, 'comment.md', noNotes);
    const single = { comments: s.pages.flatMap(p => p.comments), hasNextPage: false };
    single.comments[0].body = noNotes;
    write(root, 'dump/comments-1.json', single);
    for (const n of [2, 3]) for (const suffix of ['.json', '.request.json']) fs.unlinkSync(path.join(root, `dump/comments-${n}${suffix}`));
    verify(s.verify, 'pass');
    assert.match(s.body, /^## What\n/);
    // An unrelated later record must never stand in for the expected one.
    single.comments[1].body = noNotes;
    single.comments[0].body = 'Unrelated comment';
    write(root, 'dump/comments-1.json', single);
    assert.equal(verify(s.verify, 'pass').recordId, single.comments[1].id);
    single.comments[1].body = noNotes + '\nnotes changed';
    write(root, 'dump/comments-1.json', single); verify(s.verify, 'no-record');
  }));
}
test('helper uses host scout defaults and role overrides without changing idea-helper', () => sandbox(root => {
  for (const [host, model, effort] of [['claude-code', 'sonnet', 'medium'], ['codex', ['gpt', '6', 'luna'].join('-'), 'high']]) {
    const result = cli(['helper', '--host', host]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).model, model); assert.equal(JSON.parse(result.stdout).effort, effort);
    const old = resolveRole('idea-helper', {}, { host, packRoot: process.cwd() });
    const cfg = write(root, 'config.json', { models: { roles: { scout: { model: 'custom-scout', effort: 'low' } } } });
    const overridden = cli(['helper', '--host', host, '--config', cfg]);
    assert.equal(overridden.status, 0, overridden.stdout + overridden.stderr);
    assert.equal(JSON.parse(overridden.stdout).model, 'custom-scout'); assert.equal(JSON.parse(overridden.stdout).effort, 'low');
    const { fingerprint, ...before } = old;
    const { fingerprint: afterFingerprint, ...after } = resolveRole('idea-helper', json(cfg), { host, packRoot: process.cwd() });
    assert.deepEqual(after, before);
  }
  assert.equal(cli(['helper', '--host', 'unknown']).status, 1);
}));

for (const [host, manifestHash] of [['claude-code', '520f041db7335c3c3e1fb222c4d9760365809751d5fbede149e7e32c645d4c64'], ['codex', '8ad08c5fea40cce9f696b87df4a284e116e2e7b2ed93c0d496f31f7720bcc0d8']]) {
  test(`${host}: captured probe bytes retain the approved manifest`, () => {
    const directory = new URL(`./fixtures/idea-gate/probe/${host}/`, import.meta.url);
    const manifest = fs.readFileSync(new URL('MANIFEST.sha256', directory));
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(manifest), manifestHash);
    for (const line of manifest.toString().trim().split('\n')) {
      const [, expected, file] = /^(\w{64})  (.+)$/.exec(line);
      assert.equal(hash(fs.readFileSync(new URL(file, directory))), expected, file);
    }
  });
  test(`${host}: unmodified raw connector responses verify their exact existing record`, () => sandbox(root => {
    const source = new URL(`./fixtures/idea-gate/probe/${host}/`, import.meta.url);
    const pages = [1, 2, 3].map(n => json(new URL(`list_comments.limit4.page-${n}.json`, source)));
    const expected = pages.flatMap(p => p.comments).find(c => c.body.includes('mono-idea: approved'));
    fs.mkdirSync(path.join(root, 'dump'));
    fs.copyFileSync(new URL('get_project.json', source), path.join(root, 'dump/project.json'));
    for (const n of [1, 2, 3]) fs.copyFileSync(new URL(`list_comments.limit4.page-${n}.json`, source), path.join(root, `dump/comments-${n}.json`));
    saveRequests(root, source);
    write(root, 'expect.md', expected.body); write(root, 'config.json', { languages: { linear: 'Russian' } });
    assert.equal(verify(['verify', '--project', projectId, '--dump', path.join(root, 'dump'), '--expect', path.join(root, 'expect.md'), '--config', path.join(root, 'config.json')], 'pass').recordId, expected.id);
  }));
}

test('record refuses unrecognized sections and text outside sections before writing', () => sandbox(root => {
  const draft = '## Что\nWhat\n\n## Зачем\nWhy\n\n## Образ результата\nOutcome\n\n## Неизвестные\nQuestion';
  write(root, 'config.json', { languages: { linear: 'Russian' } });
  for (const [i, invalid] of [draft + '\n\n## Другое\nApproved extra text', draft + '\n\n  ## Другое\nExtra', draft + '\n\n##', 'Approved preamble\n\n' + draft, '```txt\nPreamble\n```\n' + draft].entries()) {
    write(root, 'draft.md', invalid);
    const out = path.join(root, `out-${i}`);
    const result = cli(['record', '--draft', path.join(root, 'draft.md'), '--project', projectId, '--config', path.join(root, 'config.json'), '--out', out]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^Стоп: /);
    assert.equal(JSON.parse(result.stdout.trim().split('\n')[1]).code, 'unsupported-format');
    assert.equal(fs.existsSync(path.join(out, 'body.md')), false);
    assert.equal(fs.existsSync(path.join(out, 'comment.md')), false);
  }
}));

test('record retains literal fence whitespace and configured custom headings', () => sandbox(root => {
  const config = { languages: { linear: 'Other' }, ideaGate: { headings: { what: 'A', why: 'B', outcome: 'C', unknowns: 'D' } } };
  const draft = '## A\n\n```txt\nvalue  \n```  \n\n## B\n\nWhy\n\n## C\n\nOutcome\n\n## D\n\nQuestion';
  write(root, 'config.json', config); write(root, 'draft.md', draft);
  const result = cli(['record', '--draft', path.join(root, 'draft.md'), '--project', projectId, '--config', path.join(root, 'config.json'), '--out', root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const body = fs.readFileSync(path.join(root, 'body.md'), 'utf8');
  const comment = fs.readFileSync(path.join(root, 'comment.md'), 'utf8');
  assert.equal(checkIdea({ mode: 'fresh', headings: config.ideaGate.headings, project: { id: projectId, createdAt: '2026-10-17T00:00:00Z', status: 'Idea', language: 'Other', body }, records: { complete: true, comments: [{ id: 'expected', createdAt: '2026-10-17T01:00:00Z', body: comment }] } }).code, 'pass');
  assert.ok(body.includes('```  \n'));
  write(root, 'config.json', { languages: { linear: 'Other' } });
  assert.equal(cli(['record', '--draft', path.join(root, 'draft.md'), '--config', path.join(root, 'config.json'), '--out', root]).status, 1);
}));

function checkDump(root, code, extra = [], expectedProject = projectId) {
  const result = cli(['check', '--mode', 'fresh', '--dump', path.join(root, 'dump'), '--config', path.join(root, 'config.json'), ...extra]);
  const lines = result.stdout.trim().split('\n');
  const ok = ['pass', 'legacy-migrate'].includes(code);
  assert.equal(result.status, ok ? 0 : 1, result.stdout + result.stderr);
  assert.equal(lines[0], `idea-gate: ${ok ? 'pass' : 'fail'}: ${code} project=${expectedProject}`);
  assert.equal(lines.length, ok ? 2 : 1, result.stdout);
  return ok ? JSON.parse(lines[1]) : null;
}
for (const host of ['claude-code', 'codex']) {
  for (const language of ['Russian', 'English']) {
    test(`${host} check --dump: ${language}, complete pages, pass/stale/legacy-migrate/no-record`, () => sandbox(root => {
      const s = setup(root, host, language);
      const before = fs.readFileSync(path.join(root, 'dump/comments-1.json'));
      assert.equal(checkDump(root, 'pass').recordId, s.pages[0].comments[0].id);
      assert.deepEqual(fs.readFileSync(path.join(root, 'dump/comments-1.json')), before);
      write(root, 'dump/project.json', { ...s.project, description: s.body.replace(/## (Что|What)\n/, '$&\nChanged\n') });
      checkDump(root, 'stale');
      const noRecords = s.pages.map(page => ({ ...page, comments: page.comments.map(c => ({ ...c, body: 'Ordinary comment' })) }));
      noRecords.forEach((page, i) => write(root, `dump/comments-${i + 1}.json`, page));
      write(root, 'dump/project.json', { ...s.project, createdAt: '2026-10-19T00:00:00Z' });
      checkDump(root, 'no-record');
      write(root, 'dump/project.json', { ...s.project, createdAt: '2026-10-16T00:00:00Z' });
      checkDump(root, 'legacy-migrate');
    }));
  }
  test(`${host} check --dump: partial pages, invalid cursor and malformed pages refuse`, () => sandbox(root => {
    const s = setup(root, host);
    for (const n of [2, 3]) {
      const file = path.join(root, `dump/comments-${n}.json`);
      fs.unlinkSync(file); checkDump(root, 'read-failed'); write(root, `dump/comments-${n}.json`, s.pages[n - 1]);
    }
    const request = json(path.join(root, 'dump/comments-2.request.json'));
    write(root, 'dump/comments-2.request.json', { cursor: 'wrong' }); checkDump(root, 'read-failed');
    write(root, 'dump/comments-2.request.json', request);
    for (const mutate of [
      pages => { pages[0].cursor = 'wrong'; },
      pages => { pages[2].cursor = 'unexpected'; },
      pages => { pages[0].hasNextPage = false; delete pages[0].cursor; },
      pages => { pages[1].comments[0] = pages[0].comments[0]; },
      pages => { pages[1].comments.reverse(); },
    ]) {
      const pages = structuredClone(s.pages); mutate(pages);
      pages.forEach((page, i) => write(root, `dump/comments-${i + 1}.json`, page));
      checkDump(root, 'read-failed');
    }
    s.pages.forEach((page, i) => write(root, `dump/comments-${i + 1}.json`, page));
    checkDump(root, 'read-failed', ['--mode', 'approved'], null);
    checkDump(root, 'read-failed', ['--snapshot', root], null);
  }));
}


test('check --dump accepts one complete page and refuses non-fresh modes or missing config', () => sandbox(root => {
  const s = setup(root, 'codex');
  const single = { comments: s.pages.flatMap(page => page.comments), hasNextPage: false };
  write(root, 'dump/comments-1.json', single);
  for (const n of [2, 3]) for (const suffix of ['.json', '.request.json']) fs.unlinkSync(path.join(root, `dump/comments-${n}${suffix}`));
  checkDump(root, 'pass');
  const args = ['check', '--dump', path.join(root, 'dump'), '--config', path.join(root, 'config.json')];
  for (const mode of ['approved', 'unsafe']) {
    const result = cli([...args, '--mode', mode]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trim(), `idea-gate: fail: read-failed project=${projectId}`);
  }
  const missingConfig = cli(['check', '--mode', 'fresh', '--dump', path.join(root, 'dump')]);
  assert.equal(missingConfig.status, 1);
  assert.equal(missingConfig.stdout.trim(), `idea-gate: fail: read-failed project=${projectId}`);
}));

const script = path.join(import.meta.dirname, 'idea-gate.mjs');
const runIn = (cwd, args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
function productRepo(root, remote = 'git@github.com:acme/app.git') {
  const repo = path.join(root, 'product');
  write(repo, '.git/config', `[remote "origin"]\n\turl = ${remote}\n`);
  write(repo, 'src/a.go', 'package a\n');
  return repo;
}
const ideaDraft = '## Что\nWhat\n\n## Зачем\nWhy\n\n## Образ результата\nOutcome\n\n## Неизвестные\nQuestion';

test('record --notes without --project lints notes before the yes and writes no comment', () => sandbox(root => {
  const repo = productRepo(root);
  write(root, 'config.json', { languages: { linear: 'Russian' } }); write(root, 'draft.md', ideaDraft);
  write(root, 'notes.md', [
    'Факт — https://github.com/acme/app/blob/main/src/a.go#L3.',
    'Нет файла: https://github.com/acme/app/blob/main/src/b.go',
    'Чужой репозиторий: https://github.com/other/x/blob/main/zzz.go',
    'Закреплено коммитом: https://github.com/acme/app/blob/abc1234/old.go',
    'Код: `src/a.go:12`, `src/c.ts`, `issueOnlyLane.enabled`',
  ].join('\n'));
  const out = path.join(root, 'out');
  const result = runIn(path.join(repo, 'src'), ['record', '--draft', path.join(root, 'draft.md'), '--notes', path.join(root, 'notes.md'), '--config', path.join(root, 'config.json'), '--out', out]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.deepEqual(output.warnings, [
    { line: 1, kind: 'long-dash' },
    { line: 2, kind: 'missing-path', path: 'src/b.go' },
    { line: 5, kind: 'missing-path', path: 'src/c.ts' },
  ]);
  assert.equal(output.comment, undefined);
  assert.ok(fs.existsSync(path.join(out, 'body.md')));
  assert.equal(fs.existsSync(path.join(out, 'comment.md')), false);
}));

test('record --notes warnings never change the comment and stay absent when notes are clean', () => sandbox(root => {
  const repo = productRepo(root);
  write(root, 'config.json', { languages: { linear: 'Russian' } }); write(root, 'draft.md', ideaDraft);
  const args = notes => ['record', '--draft', path.join(root, 'draft.md'), '--project', projectId, '--notes', write(root, 'notes.md', notes), '--config', path.join(root, 'config.json'), '--out', root];
  let result = runIn(repo, args('Факт: https://github.com/acme/app/blob/main/src/a.go'));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).warnings, undefined);
  const dirty = 'Старый текст проекта — как был';
  result = runIn(repo, args(dirty));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()).warnings, [{ line: 1, kind: 'long-dash' }]);
  assert.ok(fs.readFileSync(path.join(root, 'comment.md'), 'utf8').endsWith(dirty));
  // Outside any checkout only the long dash is reported: paths cannot be resolved.
  assert.deepEqual(lintNotes('Нет файла: `src/zzz.go` \u2014 старое', null), [{ line: 1, kind: 'long-dash' }]);
}));

test('record --notes checks blob links on the named branch and reports unchecked paths outside a checkout', t => sandbox(root => {
  const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  const repo = path.join(root, 'product');
  fs.mkdirSync(repo, { recursive: true });
  if (git(repo, 'init', '-q').status !== 0) return t.skip('git is unavailable');
  git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/app.git');
  write(repo, 'src/a.go', 'package a\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  git(repo, 'checkout', '-qb', 'feature/x');
  write(repo, 'src/only.go', 'package a\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'feature');
  git(repo, 'checkout', '-q', 'main');
  write(repo, 'src/local.go', 'package a\n');
  write(root, 'config.json', { languages: { linear: 'Russian' } }); write(root, 'draft.md', ideaDraft);
  const notes = write(root, 'notes.md', [
    'Есть: https://github.com/acme/app/blob/main/src/a.go',
    'Ветка со слешем: https://github.com/acme/app/blob/feature/x/src/only.go',
    'Только в рабочей копии: https://github.com/acme/app/blob/main/src/local.go',
    'Нет на main: https://github.com/acme/app/blob/main/src/only.go',
    'Код: `src/local.go`',
  ].join('\n'));
  const args = ['record', '--draft', path.join(root, 'draft.md'), '--notes', notes, '--config', path.join(root, 'config.json'), '--out', path.join(root, 'out')];
  let result = runIn(repo, args);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  let output = JSON.parse(result.stdout.trim());
  assert.deepEqual(output.warnings, [
    { line: 3, kind: 'missing-path', path: 'src/local.go' },
    { line: 4, kind: 'missing-path', path: 'src/only.go' },
  ]);
  assert.equal(output.paths, undefined);
  // Outside any checkout the paths cannot be checked, and the answer says so.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-idea-outside-'));
  try {
    if (repositoryLike(outside)) return t.skip('temporary directory is inside a checkout');
    result = runIn(outside, args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    output = JSON.parse(result.stdout.trim());
    assert.equal(output.paths, 'unchecked');
    assert.equal(output.warnings, undefined);
    result = runIn(outside, [...args.slice(0, 4), write(root, 'plain.md', 'Факт без путей: https://example.com/fact'), ...args.slice(5)]);
    assert.equal(JSON.parse(result.stdout.trim()).paths, undefined);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
}));

function repositoryLike(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

for (const host of ['claude-code', 'codex']) {
  test(`${host}: verify accepts non-record comments without body; check --dump does not`, () => sandbox(root => {
    const s = setup(root, host);
    const elided = s.pages.map((page, i) => ({ ...page, comments: page.comments.map((comment, j) => {
      if (i === 0 && j === 0) return comment;
      const { body, ...rest } = comment; return rest;
    }) }));
    elided.forEach((page, i) => write(root, `dump/comments-${i + 1}.json`, page));
    assert.equal(verify(s.verify, 'pass').recordId, s.pages[0].comments[0].id);
    const missingRecord = elided.map((page, i) => i === 0 ? { ...page, comments: page.comments.map((comment, j) => {
      if (j) return comment; const { body, ...rest } = comment; return rest;
    }) } : page);
    write(root, 'dump/comments-1.json', missingRecord[0]);
    verify(s.verify, 'no-record');
    write(root, 'dump/comments-1.json', { ...elided[0], comments: elided[0].comments.map((comment, j) => j === 1 ? { ...comment, body: 7 } : comment) });
    verify(s.verify, 'read-failed');
    write(root, 'dump/comments-1.json', elided[0]);
    checkDump(root, 'read-failed');
  }));
}
