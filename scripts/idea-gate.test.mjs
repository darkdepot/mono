import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { IDEA_GATE_DEFAULT_SINCE, ideaFingerprint, checkIdea } from './idea-gate.mjs';
import { digest } from './runtime.mjs';

const fixture = name => {
  const sample = JSON.parse(fs.readFileSync(new URL(`./fixtures/idea-gate/${name.replace('.md', '.json')}`, import.meta.url), 'utf8'));
  assert.equal(crypto.createHash('sha256').update(sample.markdown).digest('hex'), sample.sha256);
  return sample.markdown;
};
const idea = (what = 'Описание') => `## Что\n\n${what}\n\n## Зачем\n\nПроблема\n\n## Образ результата\n\nРезультат\n\n## Неизвестные\n\n1. Важный вопрос\n`;

test('fingerprint hashes canonical UTF-8 bytes and normalizes the live Linear round trip', () => {
  const canonical = idea().trim();
  assert.equal(ideaFingerprint(idea()), crypto.createHash('sha256').update(canonical).digest('hex'));
  const sent = fixture('linear-roundtrip-sent.md');
  const readback = fixture('linear-roundtrip-readback.md');
  const wrap = sample => idea(sample.replace('## Проба сериализации\n', ''));
  assert.equal(ideaFingerprint(wrap(sent)), ideaFingerprint(wrap(readback)));
  assert.notEqual(ideaFingerprint(idea('`a\\_b`')), ideaFingerprint(idea('`a_b`')));
});

const projectId = '59c079b6-fc26-40a6-ba19-9467674fa637';
const otherId = '11111111-1111-1111-1111-111111111111';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const record = (snapshot = idea(), id = 'idea-1', createdAt = '2026-10-17T01:00:00Z', project = projectId) => ({
  id, createdAt,
  body: `Одобрено владельцем.\n\n\`\`\`text\nmono-idea: approved project=${project} sha256=${ideaFingerprint(snapshot)}\n\`\`\`\n\n\`\`\`\`mono-idea-snapshot\n${snapshot}\`\`\`\``,
});
function input() {
  return { mode: 'approved', since: '2026-10-17',
    project: { id: projectId, createdAt: '2026-10-17T00:00:00Z', status: 'Discovery', body: idea(), language: 'ru' },
    records: { complete: true, comments: [record()] } };
}
function expectCode(options, code) {
  const result = checkIdea(options);
  assert.equal(result.code, code, JSON.stringify(options));
  assert.equal(result.ok, ['pass', 'legacy-before-cutoff', 'legacy-migrate', 'issue-only'].includes(code));
  assert.equal(result.digest, digest({ projectId: result.projectId, recordId: result.recordId, fingerprint: result.fingerprint, code }));
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'code', 'projectId', 'recordId', 'fingerprint', 'digest'].sort());
  return result;
}

test('approved validates record/project identity and chooses the newest correct record', () => {
  const options = input();
  const result = expectCode(options, 'pass');
  assert.equal(result.recordId, 'idea-1');
  assert.equal(result.fingerprint, ideaFingerprint(idea()));
  options.records.comments.push(record(idea('Новее'), 'idea-2', '2026-10-18T00:00:00Z'));
  options.records.comments.push({ ...record(), id: 'corrupt', createdAt: '2026-10-19T00:00:00Z', body: record().body.replace(/sha256=[a-f0-9]+/, `sha256=${'0'.repeat(64)}`) });
  assert.equal(expectCode(options, 'pass').recordId, 'idea-2');
  options.records.comments = [record(idea(), 'foreign', undefined, otherId)];
  expectCode(options, 'other-project');
  options.records.comments = [record()];
  options.issueContext = { issueId: 'issue-1', issueKey: 'MONO-170', projectId: otherId };
  expectCode(options, 'other-project');
  delete options.issueContext;
  options.records.comments = [{ ...record(), body: record().body.replace(/sha256=[a-f0-9]+/, `sha256=${'0'.repeat(64)}`) }];
  expectCode(options, 'bad-record');
  options.records.comments = [];
  expectCode(options, 'no-record');
});

test('fresh compares three live sections plus recorded unknowns; approved allows later edits', () => {
  const options = { ...input(), mode: 'fresh' };
  options.project.body = idea().split('## Неизвестные')[0] + '## Что входит\n\nИсследование';
  expectCode(options, 'pass');
  options.project.body += '\nДополнение границы';
  expectCode(options, 'pass');
  options.project.body = options.project.body.replace('Проблема', 'Другая проблема');
  expectCode(options, 'stale');
  expectCode({ ...options, mode: 'approved' }, 'pass');
  assert.notEqual(ideaFingerprint(idea()), ideaFingerprint(idea().replace('Важный вопрос', 'Новый вопрос')));
});

test('cutoff requires both dates strictly before since and an approval bound to a project comment', () => {
  const options = input();
  options.project.createdAt = '2026-10-16T00:00:00Z';
  options.records.comments = [];
  let result = expectCode({ ...options, mode: 'fresh' }, 'legacy-migrate');
  assert.equal(result.recordId, null); assert.equal(result.fingerprint, null);
  expectCode(options, 'no-record');
  const approvalComment = { id: 'approval-1', createdAt: '2026-10-16T23:59:59Z', body: 'Пакет одобрен' };
  options.records.comments.push(approvalComment);
  options.approval = { commentId: approvalComment.id, createdAt: approvalComment.createdAt, bodySha256: hash(approvalComment.body), body: approvalComment.body };
  result = expectCode(options, 'legacy-before-cutoff');
  assert.equal(result.recordId, null); assert.equal(result.fingerprint, null);
  for (const status of ['Idea', 'Delivery', 'Completed']) { options.project.status = status; expectCode(options, 'legacy-before-cutoff'); }
  options.project.createdAt = '2026-10-17T00:00:00Z'; expectCode(options, 'no-record');
  expectCode({ ...options, mode: 'fresh' }, 'no-record');
  options.project.createdAt = '2026-10-16T00:00:00Z';
  options.approval.createdAt = approvalComment.createdAt = '2026-10-17T00:00:00Z'; expectCode(options, 'no-record');
  options.approval.commentId = 'foreign-approval'; expectCode(options, 'other-project');
  expectCode({ ...options, mode: 'fresh' }, 'other-project');
});

test('malformed input and incomplete pagination fail closed with closed codes', () => {
  const cases = [
    [o => { o.records.complete = false; }, 'read-failed'],
    [o => { delete o.records.complete; }, 'read-failed'],
    [o => { o.records.comments[0].createdAt = '2026-02-30T01:00:00Z'; }, 'read-failed'],
    [o => { o.project.createdAt = '2026-10-17T24:00:00Z'; }, 'read-failed'],
    [o => { o.since = '2026-02-30'; }, 'bad-since'],
    [o => { o.since = null; }, 'bad-since'],
    [o => { o.since = '2026-10-17T00:00:00Z'; }, 'bad-since'],
    [o => { o.mode = 'unsafe'; }, 'read-failed'],
    [o => { o.project.language = 'fr'; }, 'read-failed'],
  ];
  for (const [mutate, code] of cases) { const options = input(); mutate(options); expectCode(options, code); }
});

test('issue-only accepts only the resolver seam with approved-fresh', () => {
  const seam = { package_kind: 'issue-only', lifecycle_state_entity: 'issue', behavioral_oracle: {}, risk_class: 'standard', approval_status: 'approved-fresh' };
  const result = expectCode({ mode: 'approved', since: '2026-10-17', issueOnlySeam: seam }, 'issue-only');
  assert.equal(result.projectId, null); assert.equal(result.recordId, null); assert.equal(result.fingerprint, null);
  for (const approval_status of ['approved', 'stale', 'pending', null]) expectCode({ ...input(), project: null, issueOnlySeam: { ...seam, approval_status } }, 'no-record');
  expectCode({ ...input(), project: null, issueOnlySeam: { ...seam, package_kind: 'project-first' } }, 'no-record');
});

test('section failures are closed codes; headings inside fences are literal; inline code is opaque', () => {
  for (const [body, code] of [
    [idea().replace('## Зачем', '## Почему'), 'missing-heading'],
    [idea() + '\n## Что\nПовтор', 'duplicate-heading'],
    [idea('- пункт\n  - вложенный'), 'unsupported-format'],
    [idea('| Имя | Значение |\n| --- | --- |\n| а | б |'), 'unsupported-format'],
  ]) {
    assert.throws(() => ideaFingerprint(body), { code });
    const options = { ...input(), mode: 'fresh' }; options.project.body = body;
    expectCode(options, code);
  }
  const body = idea('```md\n## Зачем\n- literal\\*  \n```');
  assert.doesNotThrow(() => ideaFingerprint(body));
  assert.notEqual(ideaFingerprint(body), ideaFingerprint(body.replace('literal\\*', 'literal*')));
  assert.notEqual(ideaFingerprint(idea('``a`\\*b``')), ideaFingerprint(idea('``a`*b``')));
  assert.equal(ideaFingerprint(idea('a\\_b \\# \\> \\* \\[x\\]')), ideaFingerprint(idea('a_b # > * [x]')));
});

test('live comment bytes remain untouched and its complete four-section snapshot is extracted', () => {
  const body = fixture('linear-comment-record-sent-and-readback.md');
  const snapshot = body.split('```mono-idea-snapshot\n')[1].replace(/\n```\s*$/, '');
  const fingerprint = ideaFingerprint(snapshot);
  const options = { ...input(), mode: 'fresh' };
  const comment = { ...record(), body: body.replace('00000000-0000-0000-0000-000000000000', projectId).replace('0'.repeat(64), fingerprint) };
  const bytes = Buffer.from(comment.body);
  options.records.comments = [comment];
  options.project.body = snapshot.split('## Неизвестные')[0];
  expectCode(options, 'pass');
  assert.deepEqual(Buffer.from(comment.body), bytes);
  options.records.comments[0].body += '\n```mono-idea-snapshot\nduplicate\n```';
  expectCode(options, 'bad-record');
});

function cli(args) { return spawnSync(process.execPath, ['scripts/idea-gate.mjs', ...args], { encoding: 'utf8' }); }
function tempSnapshot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-idea-'));
  try { return run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function writeJson(root, name, value) {
  const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
test('release cutoff is dormant and preserves strict cutoff boundaries', () => {
  assert.equal(IDEA_GATE_DEFAULT_SINCE, '2099-12-31');
  const options = input();
  delete options.since;
  const comment = { id: 'approval-release', createdAt: '2026-10-17T23:59:59Z', body: 'Пакет одобрен' };
  options.records.comments = [comment];
  options.approval = { commentId: comment.id, createdAt: comment.createdAt, bodySha256: hash(comment.body), body: comment.body };
  expectCode(options, 'legacy-before-cutoff');
  options.approval.createdAt = comment.createdAt = '2099-12-31T00:00:00Z';
  expectCode(options, 'no-record');
  options.approval.createdAt = comment.createdAt = '2026-10-17T23:59:59Z';
  options.project.createdAt = '2099-12-31T00:00:00Z';
  expectCode(options, 'no-record');
});

test('default approved mode accepts a new project without an idea record', () => {
  const options = input();
  delete options.since;
  options.project.createdAt = '2026-10-19T00:00:00Z';
  const comment = { id: 'approval-dormant', createdAt: '2026-10-19T01:00:00Z', body: 'approval_status=approved' };
  options.records.comments = [comment];
  options.approval = { commentId: comment.id, createdAt: comment.createdAt, bodySha256: hash(comment.body), body: comment.body };
  options.issueContext = { issueId: 'issue-1', issueKey: 'MONO-173', projectId };
  const result = expectCode(options, 'legacy-before-cutoff');
  assert.equal(result.recordId, null);
  assert.equal(result.fingerprint, null);
  expectCode({ ...options, mode: 'fresh' }, 'legacy-migrate');
  expectCode({ ...options, since: '2026-10-18' }, 'no-record');
});

test('CLI fresh needs only project and complete comments; default cutoff works and read errors fail closed', () => tempSnapshot(root => {
  const options = input();
  writeJson(root, 'idea/project.json', options.project);
  writeJson(root, 'idea/idea-records.json', options.records);
  writeJson(root, 'config.json', { ideaGate: { since: options.since } });
  const args = ['check', '--mode', 'fresh', '--snapshot', root, '--config', path.join(root, 'config.json')];
  let result = cli(args);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines[0], `idea-gate: pass: pass project=${projectId}`);
  assert.equal(JSON.parse(lines[1]).recordId, 'idea-1');
  const defaults = cli(args.slice(0, -2));
  assert.equal(defaults.status, 0, defaults.stdout + defaults.stderr);
  assert.equal(JSON.parse(defaults.stdout.trim().split('\n')[1]).code, 'pass');
  writeJson(root, 'idea/idea-records.json', { complete: true, comments: [] });
  assert.equal(JSON.parse(cli(args.slice(0, -2)).stdout.trim().split('\n')[1]).code, 'legacy-migrate');
  assert.equal(cli(args).stdout.trim(), `idea-gate: fail: no-record project=${projectId}`);
  fs.unlinkSync(path.join(root, 'idea/idea-records.json'));
  result = cli(args); assert.equal(result.status, 1); assert.match(result.stdout, /fail: read-failed/);
}));

test('CLI fingerprint and configured custom headings use the same canonical text', () => tempSnapshot(root => {
  const headings = { what: 'A', why: 'B', outcome: 'C', unknowns: 'D' };
  const english = idea().replace('Что', 'What').replace('Зачем', 'Why').replace('Образ результата', 'Target outcome').replace('Неизвестные', 'Unknowns');
  const body = idea().replace('Что', 'A').replace('Зачем', 'B').replace('Образ результата', 'C').replace('Неизвестные', 'D');
  assert.match(ideaFingerprint(english, 'en'), /^[a-f0-9]{64}$/);
  const file = path.join(root, 'idea.md'); fs.writeFileSync(file, idea());
  const result = cli(['fingerprint', '--snapshot', file]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout.trim().split('\n')[1]).fingerprint, ideaFingerprint(idea()));
  const options = input();
  options.project.language = 'custom'; options.project.body = body;
  const comment = record(); comment.body = comment.body.replace(idea(), body).replace(ideaFingerprint(idea()), ideaFingerprint(body, headings));
  writeJson(root, 'idea/project.json', options.project); writeJson(root, 'idea/idea-records.json', { complete: true, comments: [comment] });
  writeJson(root, 'config.json', { ideaGate: { since: options.since, headings } });
  const custom = cli(['check', '--mode', 'fresh', '--snapshot', root, '--config', path.join(root, 'config.json')]);
  assert.equal(custom.status, 0, custom.stdout + custom.stderr);
}));

test('CLI config loading rejects empty or whitespace-padded heading names', () => tempSnapshot(root => {
  const options = input();
  writeJson(root, 'idea/project.json', options.project);
  writeJson(root, 'idea/idea-records.json', options.records);
  const file = path.join(root, 'idea.md'); fs.writeFileSync(file, idea());
  for (const what of [' What', 'What ', '', ' ', '\tWhat', 'What\t']) {
    writeJson(root, 'config.json', { ideaGate: { since: options.since,
      headings: { what, why: 'Why', outcome: 'Target outcome', unknowns: 'Unknowns' } } });
    for (const args of [
      ['check', '--mode', 'fresh', '--snapshot', root],
      ['fingerprint', '--snapshot', file],
    ]) {
      const result = cli([...args, '--config', path.join(root, 'config.json')]);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(result.stdout.trim(), `idea-gate: fail: read-failed project=${args[0] === 'check' ? projectId : null}`);
    }
  }
}));

test('complete snapshot examples pass through CLI and exported API with the same verdicts', () => {
  for (const [name, code] of [['project', 'pass'], ['legacy', 'legacy-before-cutoff'], ['issue-only', 'issue-only']]) {
    const root = path.join(import.meta.dirname, 'fixtures/idea-gate', name);
    const result = cli(['check', '--mode', 'approved', '--snapshot', root, '--config', path.join(root, 'config.json')]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const actual = JSON.parse(result.stdout.trim().split('\n')[1]);
    assert.equal(actual.code, code);
    const json = name => JSON.parse(fs.readFileSync(path.join(root, name)));
    const options = { mode: 'approved', since: '2026-10-17' };
    if (name === 'issue-only') options.issueOnlySeam = json('issue-only.json').seam;
    else Object.assign(options, { project: json('idea/project.json'), records: json('idea/idea-records.json'),
      approval: { ...json('approval.json'), body: fs.readFileSync(path.join(root, 'approval.md'), 'utf8') }, issueContext: json('issue-context.json') });
    assert.deepEqual(actual, expectCode(options, code));
  }
});

test('multiline inline code in an idea section refuses unsupported-format (d-004)', () => {
  for (const code of ['`first\n\\* second  \nlast`', '`first\n- \nlast`', '`first\n+ \nlast`', '``first\nlast``']) {
    const body = idea(code);
    assert.throws(() => ideaFingerprint(body), { code: 'unsupported-format' });
    const options = { ...input(), mode: 'fresh' }; options.project.body = body;
    expectCode(options, 'unsupported-format');
  }
});

test('editing single-line inline code changes its literal fingerprint', () => {
  const body = idea('`first \\* second  `');
  assert.notEqual(ideaFingerprint(body), ideaFingerprint(body.replace('\\* second', '* second')));
  assert.notEqual(ideaFingerprint(body), ideaFingerprint(body.replace('second  ', 'second')));
  assert.equal(ideaFingerprint(idea('\\`ordinary \\* text')), ideaFingerprint(idea('\\`ordinary * text')));
});

test('blank lines inside list items disappear while separate prose paragraphs remain separate', () => {
  assert.equal(ideaFingerprint(idea('- first\n\n  continued\n\n+ second')), ideaFingerprint(idea('* first\n  continued\n* second')));
  assert.notEqual(ideaFingerprint(idea('first\n\nsecond')), ideaFingerprint(idea('first\nsecond')));
});

test('package approval hashes bind both snapshot file bytes and project comment bytes', () => {
  const options = input(), body = 'Пакет одобрен';
  options.records.comments.push({ id: 'approval', createdAt: '2026-10-16T00:00:00Z', body });
  options.approval = { commentId: 'approval', createdAt: '2026-10-16T00:00:00Z', bodySha256: hash(body), body };
  expectCode(options, 'pass');
  options.approval.body += '\n'; expectCode(options, 'read-failed');
  options.approval.body = body; options.records.comments.at(-1).body += '\n'; expectCode(options, 'read-failed');
});

test('inline backtick runs cannot open fences; prohibited Markdown variants fail closed', () => {
  const inline = idea('```a`b```');
  assert.notEqual(ideaFingerprint(inline), ideaFingerprint(inline.replace('a`b', 'a`c')));
  for (const text of ['| H |\n| --- |\n| x |', '- parent\n \t- child']) {
    assert.throws(() => ideaFingerprint(idea(text)), { code: 'unsupported-format' });
    const options = { ...input(), mode: 'fresh' }; options.project.body = idea(text);
    expectCode(options, 'unsupported-format');
  }
});

test('a nested list is rejected before multiline inline-code matching', () => {
  const body = idea('- `parent\n  - child`');
  assert.throws(() => ideaFingerprint(body), { code: 'unsupported-format' });
  const options = { ...input(), mode: 'fresh' }; options.project.body = body;
  expectCode(options, 'unsupported-format');
});

test('inline code followed by a prose hyphen does not create list indentation', () => {
  const body = idea('`--flag` - optional');
  assert.match(ideaFingerprint(body), /^[a-f0-9]{64}$/);
  const options = { ...input(), mode: 'fresh' };
  options.project.body = body; options.records.comments = [record(body)];
  expectCode(options, 'pass');
});
