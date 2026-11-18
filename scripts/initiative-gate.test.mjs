import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const samples = new URL('./fixtures/initiative-gate/', import.meta.url);
const hash = text => createHash('sha256').update(text).digest('hex');
const raw = name => JSON.parse(fs.readFileSync(new URL(name, samples), 'utf8'));
// Independent expected read-back bodies: issue/project tags become their stable IDs.
// The link title is significant; only the URL's angle brackets are serialization.
const brief = 'Тестовая инициатива для пробы записи (18754a6a-f035-4808-b77c-ef632740ad9e). Будет отменена.\n\n## Цель\n\nПроверить запись в инициативу.';
const decision = '## Карта проектов\n\n* К1. Проект один; ценность: проба; зависит от: нет\n  Есть проект: [ТЕСТ Mono: проект карты К1](https://linear.app/darkdepot/project/test-mono-proekt-karty-k1-f205c01efd11)\n* К2. Проект два; ценность: проба; зависит от: К1\n\n```text\nзабор в документе\n```';
const linkBrief = 'Тестовая инициатива для образца ссылок. Будет отменена.\n\n## Цель\n\nПроект голым идентификатором: db8f0260-fcfc-4218-8a87-9595769b0190\n\nЗадача голым идентификатором: 18754a6a-f035-4808-b77c-ef632740ad9e';
const linkDecision = '## Карта проектов\n\n* К1. Проект один; ценность: образец; зависит от: нет\n  Есть проект: db8f0260-fcfc-4218-8a87-9595769b0190\n* К2. Проект два; ценность: образец; зависит от: К1\n\nЗадача: 18754a6a-f035-4808-b77c-ef632740ad9e\n\nСсылка с названием: [ТЕСТ Mono: проект карты К1](https://linear.app/darkdepot/project/test-mono-proekt-karty-k1-f205c01efd11)';

function fixture(run, links = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-initiative-gate-'));
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  const change = (name, mutate) => { const value = read(name); mutate(value); write(name, value); };
  const initiative = raw(links ? 'probe-u1-links/02-readback-initiative.json' : 'probe-u1/17-get-initiative-full.json');
  const doc = raw(links ? 'probe-u1-links/04-readback-document.json' : 'probe-u1/09-readback-document.json');
  const comments = raw('probe-u1/11-readback-list-comments.json');
  // The live probe deliberately wrote placeholder hashes. Bind the test copy to
  // the independently written golden text, without rewriting the captured bytes.
  comments.comments[0].body = comments.comments[0].body
    .replace(/initiative=[\w-]+/, `initiative=${initiative.uuid}`)
    .replace(/decision=[\w-]+/, `decision=${doc.id}`)
    .replace(/brief-sha256=[a-f0-9]{64}/, `brief-sha256=${hash(links ? linkBrief : brief)}`)
    .replace(/decision-sha256=[a-f0-9]{64}/, `decision-sha256=${hash(links ? linkDecision : decision)}`);
  write('initiative.json', initiative);
  write('decision.json', doc);
  write('comments-1.json', comments);
  write('comments-1.request.json', {});
  write('config.json', {});
  const check = expected => {
    const result = spawnSync(process.execPath, ['scripts/idea-gate.mjs', 'initiative', '--mode', 'fresh', '--dump', root, '--config', path.join(root, 'config.json')], { encoding: 'utf8' });
    const lines = result.stdout.trim().split('\n');
    assert.equal(result.status, expected === 'pass' ? 0 : 1, result.stdout + result.stderr);
    assert.equal(lines.length, 2, result.stdout + result.stderr);
    assert.equal(JSON.parse(lines[1]).code, expected, result.stdout);
    assert.match(lines[0], expected === 'pass' ? /^Готово$/ : /^Стоп: /);
    return JSON.parse(lines[1]);
  };
  try { run({ root, read, write, change, check }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('initiative owner approval binds read-back bodies, ignoring entity updatedAt and approval prose', () => fixture(({ change, check }) => {
  const result = check('pass');
  assert.equal(result.recordId, 'c6879994-01d9-45f1-891d-08f17eeea6ee');
  assert.equal(result.initiativeId, 'fad88837-9c4c-41ef-b3a8-9ec9321cdbca');
  change('initiative.json', d => { d.updatedAt = '2030-01-01T00:00:00Z'; });
  change('decision.json', d => { d.updatedAt = '2030-01-01T00:00:00Z'; });
  change('comments-1.json', p => { p.comments[0].body = p.comments[0].body.replace('нажал «Проба».', 'ответил «Да»'); });
  check('pass');
}));

test('initiative fixture bytes retain the anonymized raw responses and their manifest', () => {
  for (const line of fs.readFileSync(new URL('MANIFEST.sha256', samples), 'utf8').trim().split('\n')) {
    const [expected, name] = line.split('  ');
    const bytes = fs.readFileSync(new URL(name, samples));
    assert.equal(hash(bytes), expected, name);
    assert.doesNotMatch(bytes.toString(), /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    const inspect = value => {
      if (Array.isArray(value)) return value.forEach(inspect);
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (['owner', 'creator', 'updatedBy', 'author'].includes(key) && child) {
          assert.equal(child.id, '<user-id>');
          assert.equal(child.name, '<owner>');
          if (child.email) assert.equal(child.email, '<email>');
        }
        inspect(child);
      }
    };
    inspect(JSON.parse(bytes));
  }
  const sent = raw('probe-u1/10-create-comment.json');
  const readBack = raw('probe-u1/11-readback-list-comments.json').comments[0];
  assert.equal(sent.body, readBack.body);
  assert.ok(Date.parse(readBack.updatedAt) < Date.parse(readBack.createdAt));
});

test('missing initiative approval is no-record, while placeholder probe hashes are stale', () => fixture(({ change, write, check }) => {
  write('comments-1.json', raw('probe-u1/11-readback-list-comments.json'));
  check('stale-brief');
  change('comments-1.json', p => { p.comments = []; });
  check('no-record');
}));

test('changed initiative description and changed decision stop independently', () => fixture(({ read, write, change, check }) => {
  const original = read('initiative.json');
  change('initiative.json', d => { d.description += '\nДругая цель.'; });
  check('stale-brief');
  write('initiative.json', original);
  change('decision.json', d => { d.content += '\nДругой выбор модели.'; });
  check('stale-decision');
}));

test('appending Заведён preserves approval, for get_document and list_documents responses', () => fixture(({ write, check }) => {
  write('decision.json', raw('probe-u1/16-readback-document-after-patch.json'));
  check('pass');
  write('decision.json', raw('probe-u1/18-list-documents-initiative.json'));
  check('pass');
}));

test('self-closing project/issue tags and paired tags share stable identity across renames', () => fixture(({ read, write, change, check }) => {
  const result = check('pass');
  assert.equal(result.briefSha256, hash(linkBrief));
  assert.equal(result.decisionSha256, hash(linkDecision));
  change('decision.json', d => {
    d.content = d.content.replace(/<project id="([^"]+)" label="([^"]+)" href="([^"]+)" \/>/g,
      '<project href="$3" id="$1">Переименованный проект</project>');
  });
  change('initiative.json', d => {
    d.description = d.description.replace(/label="[^"]+"/g, 'label="Новое название"')
      .replace(/href="[^"]+"/g, 'href="https://linear.app/changed-slug"');
  });
  check('pass');
  const original = read('decision.json');
  change('decision.json', d => { d.content = d.content
    .replace('id="db8f0260-fcfc-4218-8a87-9595769b0190"', 'id="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"'); });
  check('stale-decision');
  write('decision.json', original);
  change('decision.json', d => { d.content = d.content.replace('Ссылка с названием:', 'Иная ссылка:'); });
  check('stale-decision');
}, true));

test('list markers, link angles, trailing whitespace and repeated blank lines are serialization', () => fixture(({ change, check }) => {
  change('decision.json', d => {
    d.content = d.content.replace(/^\* /gm, '- ').replace(/\]\(<([^>]+)>\)/g, ']($1)')
      .replace(/\n\n/g, '\n\n\n\n').split('\n').map(line => line + ' \t').join('\r\n');
  });
  check('pass');
}));

for (const label of ['A > B', 'A /> B', "A id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' > B"]) {
  test(`quoted tag boundary preserves the whole decision: ${label}`, () => fixture(({ read, change, check }) => {
    const first = 'db8f0260-fcfc-4218-8a87-9595769b0190';
    const second = '689d16af-3131-4680-81bb-62de0155ffb2';
    const body = `<project label="${label}" id="${first}" />\nЦенность: согласованная.\n<project id="${second}">Проект два</project>`;
    const expected = `${first}\nЦенность: согласованная.\n${second}`;
    change('decision.json', d => { d.content = body; });
    change('comments-1.json', p => { p.comments[0].body = p.comments[0].body.replace(/decision-sha256=[a-f0-9]{64}/, `decision-sha256=${hash(expected)}`); });
    check('pass');
    change('decision.json', d => { d.content = d.content.replace(`label="${label}"`, 'label="Новое имя > без изменения проекта"'); });
    check('pass');
    change('decision.json', d => { d.content = d.content.replace('согласованная.', 'другая.'); });
    check('stale-decision');
    change('decision.json', d => { d.content = d.content.replace('другая.', 'согласованная.').replace(second, 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'); });
    check('stale-decision');
    // A hash produced by the old swallowed-span bug cannot authorize this body.
    change('comments-1.json', p => { p.comments[0].body = p.comments[0].body.replace(/decision-sha256=[a-f0-9]{64}/, `decision-sha256=${hash(first)}`); });
    check('stale-decision');
    assert.ok(read('decision.json').content.includes('Ценность: согласованная.'));
  }));
}

for (const title of ['Решение [v2]', 'Решение \\[v2\\]']) {
  test(`link destination normalizes with a bracketed title: ${title}`, () => fixture(({ change, check }) => {
    const previous = 'ТЕСТ Mono: проект карты К1';
    const expected = decision.replace(`[${previous}]`, `[${title}]`);
    change('decision.json', d => { d.content = d.content.replace(`[${previous}]`, `[${title}]`); });
    change('comments-1.json', p => { p.comments[0].body = p.comments[0].body.replace(/decision-sha256=[a-f0-9]{64}/, `decision-sha256=${hash(expected)}`); });
    check('pass');
    change('decision.json', d => { d.content = d.content.replace('](<https:', '](https:').replace('f205c01efd11>)', 'f205c01efd11)'); });
    check('pass');
    change('decision.json', d => { d.content = d.content.replace('f205c01efd11)', 'other-project)'); });
    check('stale-decision');
  }));
}

for (const [name, mutate] of [
  ['orchestrator approval', c => { c.body = c.body.replace('by=owner', 'by=orchestrator'); }],
  ['unknown author role', c => { c.body = c.body.replace('by=owner', 'by=worker'); }],
  ['duplicate field', c => { c.body = c.body.replace('by=owner', 'by=owner by=owner'); }],
  ['missing field', c => { c.body = c.body.replace(/ decision=[\w-]+/, ''); }],
  ['unknown field', c => { c.body = c.body.replace('by=owner', 'by=owner extra=1'); }],
  ['bad hash', c => { c.body = c.body.replace(/brief-sha256=[a-f0-9]{64}/, 'brief-sha256=broken'); }],
  ['foreign initiative', c => { c.body = c.body.replace(/initiative=[\w-]+/, 'initiative=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'); }],
  ['wrong fence', c => { c.body = c.body.replace('```text', '```json'); }],
  ['tech page fence', c => { c.body = c.body.replace('```text', '```mono-tech-page'); }],
  ['unclosed fence', c => { c.body = c.body.replace('\n```\n', '\n'); }],
  ['unfenced record', c => { c.body = c.body.replaceAll('```text\n', '').replaceAll('\n```', ''); }],
  ['record not first in fence', c => { c.body = c.body.replace('```text\n', '```text\nКонтекст\n'); }],
  ['two records', c => { c.body += '\n' + c.body; }],
  ['rejected status', c => { c.body = c.body.replace(': approved ', ': rejected '); }],
]) test(`initiative refuses ${name}`, () => fixture(({ change, check }) => {
  change('comments-1.json', p => { mutate(p.comments[0]); });
  check('bad-record');
}));

test('latest initiative record is by createdAt, even when the older invalid record was edited later', () => fixture(({ change, check }) => {
  change('comments-1.json', p => {
    const older = structuredClone(p.comments[0]);
    older.id = 'old-invalid'; older.createdAt = '2026-10-27T00:00:00Z'; older.updatedAt = '2026-10-29T00:00:00Z';
    older.body = older.body.replace('by=owner', 'by=orchestrator');
    p.comments.unshift(older);
  });
  check('pass');
  change('comments-1.json', p => {
    const newest = structuredClone(p.comments[1]);
    newest.id = 'new-invalid'; newest.createdAt = '2026-10-30T00:00:00Z'; newest.updatedAt = '2026-10-30T00:00:00Z';
    newest.body = newest.body.replace('by=owner', 'by=orchestrator');
    p.comments.unshift(newest);
  });
  check('bad-record');
}));

test('a newer broken fence or unfenced record cannot fall back to old approval', () => {
  for (const body of ['```text\nmono-initiative: approved initiative=broken', 'mono-initiative: approved initiative=broken', '```json\nmono-initiative: approved initiative=broken\n```']) {
    fixture(({ change, check }) => {
      change('comments-1.json', p => {
        p.comments.unshift({ id: 'newer', createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z', body });
      });
      check('bad-record');
    });
  }
});

test('a newer corrected owner record wins over an invalid old one', () => fixture(({ change, check }) => {
  change('comments-1.json', p => {
    const newer = structuredClone(p.comments[0]);
    newer.id = 'new-valid'; newer.createdAt = newer.updatedAt = '2026-10-29T00:00:00Z';
    p.comments[0].body = p.comments[0].body.replace('by=owner', 'by=orchestrator');
    p.comments.unshift(newer);
  });
  assert.equal(check('pass').recordId, 'new-valid');
}));

test('all initiative comment pages require matching actual cursors', () => fixture(({ read, write, change, check, root }) => {
  const page = read('comments-1.json');
  page.hasNextPage = true; page.cursor = page.comments.at(-1).id;
  write('comments-1.json', page);
  write('comments-2.json', { comments: [], hasNextPage: false });
  write('comments-2.request.json', { cursor: page.cursor });
  check('pass');
  change('comments-2.request.json', r => { r.cursor = 'foreign-cursor'; });
  check('bad-record');
  fs.unlinkSync(path.join(root, 'comments-2.json'));
  check('bad-record');
}));

test('missing or foreign initiative/document inputs and malformed comment dates fail closed', () => {
  for (const [name, mutate] of [
    ['initiative.json', d => { d.status = { name: 'Planned' }; }],
    ['initiative.json', d => { delete d.uuid; }],
    ['initiative.json', d => { delete d.description; }],
    ['decision.json', d => { d.initiative.id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'; }],
    ['decision.json', d => { delete d.content; }],
    ['comments-1.json', d => { d.comments[0].createdAt = 'bad-date'; }],
    ['comments-1.json', d => { delete d.comments[0].body; }],
  ]) fixture(({ change, check }) => { change(name, mutate); check('bad-record'); });
});
