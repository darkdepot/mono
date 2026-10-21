import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-tech-gate-'));
  fs.cpSync(new URL('./fixtures/tech-gate/valid/', import.meta.url), root, { recursive: true });
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  const change = (name, mutate) => { const value = read(name); mutate(value); write(name, value); };
  const check = code => {
    const result = spawnSync(process.execPath, ['scripts/idea-gate.mjs', 'tech', '--mode', 'fresh', '--dump', root], { encoding: 'utf8' });
    const lines = result.stdout.trim().split('\n');
    assert.equal(result.status, code === 'pass' ? 0 : 1, result.stdout + result.stderr);
    assert.equal(lines.length, 2, result.stdout + result.stderr);
    assert.equal(JSON.parse(lines[1]).code, code, result.stdout);
    assert.match(lines[0], code === 'pass' ? /^Готово$/ : /^Стоп: /);
    return JSON.parse(lines[1]);
  };
  try { run({ root, read, write, change, check }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('tech approval binds raw documents and the approved page, not spec updatedAt', () => fixture(({ change, check }) => {
  const result = check('pass');
  assert.equal(result.recordId, 'tech-record');
  change('tech-spec.json', d => { d.updatedAt = '2026-10-22T00:00:00Z'; });
  check('pass');
  change('comments-1.json', p => { p.comments[0].body = p.comments[0].body.replace('by=owner', 'by=orchestrator') + '\nОркестратор: проще для первого использования.'; });
  check('pass');
}));

test('changed PRD or latest PRD approval invalidates tech approval', () => fixture(({ read, write, change, check }) => {
  const prd = read('prd.json');
  change('prd.json', d => { d.updatedAt = '2026-10-21T04:00:00.000Z'; });
  check('stale-prd');
  write('prd.json', prd);
  change('comments-1.json', p => { p.comments[1].body = p.comments[1].body.replace('01:00:00', '04:00:00'); });
  check('stale-prd');
}));

test('changed spec body invalidates approval and absent record is distinct', () => fixture(({ change, check }) => {
  change('tech-spec.json', d => { d.content += '\nДругой контракт.'; });
  check('stale-spec');
  change('comments-1.json', p => { p.comments.shift(); });
  check('no-record');
}));

test('legacy PRD without next and next=handoff still consume an existing tech record', () => fixture(({ change, check }) => {
  change('comments-1.json', p => { p.comments[1].body = p.comments[1].body.replace(' next=tech-evaluation', ''); });
  check('pass');
  change('comments-1.json', p => { p.comments[1].body = p.comments[1].body.replace('by=owner', 'by=owner next=handoff'); });
  check('pass');
}));

test('bad fields, duplicate fields, wrong identities and damaged page fail closed', () => {
  for (const mutate of [
    p => { p.comments[0].body = p.comments[0].body.replace('by=owner', 'by=worker'); },
    p => { p.comments[0].body = p.comments[0].body.replace('by=owner', 'by=owner by=owner'); },
    p => { p.comments[0].body = p.comments[0].body.replace('prd-updatedAt=', 'unexpected='); },
    p => { p.comments[0].body = p.comments[0].body.replace('Строим: одно', 'Строим: другое'); },
    p => { p.comments[0].body = p.comments[0].body.replace('project=11111111', 'project=aaaaaaaa'); },
    p => { p.comments[1].body = p.comments[1].body.replace('next=tech-evaluation', 'next=unknown'); },
  ]) fixture(({ change, check }) => { change('comments-1.json', mutate); check('bad-record'); });
});

test('all comment pages and their actual request cursors are required', () => fixture(({ read, write, change, check, root }) => {
  const page = read('comments-1.json');
  write('comments-1.json', { comments: page.comments.slice(0, 1), hasNextPage: true, cursor: 'tech-record' });
  write('comments-2.request.json', { cursor: 'tech-record' });
  write('comments-2.json', { comments: page.comments.slice(1), hasNextPage: false });
  check('pass');
  change('comments-2.request.json', p => { p.cursor = 'wrong'; });
  check('bad-record');
  fs.unlinkSync(path.join(root, 'comments-2.json'));
  check('bad-record');
}));

test('latest created approval wins even when an old comment was edited later', () => fixture(({ change, check }) => {
  change('comments-1.json', p => {
    const older = structuredClone(p.comments[0]);
    older.id = 'old-tech'; older.createdAt = '2026-10-21T02:00:00.000Z'; older.updatedAt = '2026-10-22T00:00:00.000Z';
    older.body = older.body.replace('by=owner', 'by=invalid');
    p.comments.unshift(older);
  });
  check('pass');
  change('comments-1.json', p => { p.comments[1].body = p.comments[1].body.replace('by=owner', 'by=invalid'); });
  check('bad-record');
}));

test('page and prose mentions are not approval records', () => fixture(({ change, check }) => {
  change('comments-1.json', p => {
    const tech = p.comments[0];
    const page = tech.body.split('```mono-tech-page\n')[1].split('```')[0];
    const revised = page + 'Маркер mono-prd: approved нужен в правилах.\n';
    const hash = createHash('sha256').update(revised).digest('hex');
    tech.body = tech.body.replace(page, revised).replace(/page-sha256=[a-f0-9]{64}/, `page-sha256=${hash}`);
    p.comments.unshift({ id: 'status', createdAt: '2026-10-21T04:00:00.000Z', updatedAt: '2026-10-21T04:00:00.000Z',
      body: 'Проверена запись `mono-tech: approved`; старый путь без `mono-prd: approved`.\n```json\nнезакрытая заметка' });
  });
  check('pass');
}));

test('a newer malformed approval fence is not replaced by the older valid record', () => fixture(({ change, check }) => {
  change('comments-1.json', p => {
    p.comments.unshift({ id: 'broken', createdAt: '2026-10-21T04:00:00.000Z', updatedAt: '2026-10-21T04:00:00.000Z',
      body: '```text\nmono-tech: approved project=broken' });
  });
  check('bad-record');
}));

for (const kind of ['mono-tech: approved', 'mono-prd: approved']) {
  for (const [name, expected, mutate] of [
    ['leading blank line', 'pass', comment => { comment.body = comment.body.replace('```text\n', '```text\n\n'); }],
    ['trailing whitespace', 'pass', comment => { comment.body = comment.body.replace('\n```', ' \t\n```'); }],
    ['surrounding text', 'pass', comment => {
      comment.body = 'Before the record.\n\n' + comment.body.replace('```text\n', '```text\nContext.\n\n')
        .replace('\n```', '\n\nEnd of context.\n```') + '\nAfter the record.';
    }],
    ['two records in one fence', 'bad-record', comment => {
      const line = comment.body.split('\n').find(line => line.startsWith(kind));
      comment.body = comment.body.replace(line, line + '\n' + line);
    }],
    ['two record fences in one comment', 'bad-record', comment => {
      comment.body += '\n' + comment.body.slice(0, comment.body.indexOf('\n```') + 4);
    }],
    ['newer invalid plus older valid', 'bad-record', (comment, page) => {
      const newer = structuredClone(comment);
      newer.id = 'new-invalid'; newer.createdAt = newer.updatedAt = '2026-10-21T04:00:00.000Z';
      newer.body = newer.body.replace('```text\n', '```text\n\n').replace('by=owner', 'by=invalid');
      page.comments.push(newer);
    }],
    ['newer invalid status plus older valid', 'bad-record', (comment, page) => {
      const newer = structuredClone(comment);
      newer.id = 'new-invalid-status'; newer.createdAt = newer.updatedAt = '2026-10-21T04:00:00.000Z';
      newer.body = newer.body.replace(': approved ', ': rejected ');
      page.comments.push(newer);
    }],
    ['newer unfenced marker plus older valid', 'bad-record', (comment, page) => {
      const newer = structuredClone(comment);
      newer.id = 'new-unfenced'; newer.createdAt = newer.updatedAt = '2026-10-21T04:00:00.000Z';
      newer.body = newer.body.replace('```text\n', '').replace('\n```', '');
      page.comments.push(newer);
    }],
    ['newer wrong fence plus older valid', 'bad-record', (comment, page) => {
      const newer = structuredClone(comment);
      newer.id = 'new-wrong-fence'; newer.createdAt = newer.updatedAt = '2026-10-21T04:00:00.000Z';
      newer.body = newer.body.replace('```text\n', '```json\n');
      page.comments.push(newer);
    }],
    ['newer valid plus older invalid', 'pass', (comment, page) => {
      const newer = structuredClone(comment);
      newer.id = 'new-valid'; newer.createdAt = newer.updatedAt = '2026-10-21T04:00:00.000Z';
      comment.body = comment.body.replace('by=owner', 'by=invalid');
      page.comments.push(newer);
    }],
    ['comment edited later', 'pass', (comment, page) => {
      const older = structuredClone(comment);
      older.id = 'edited-old-invalid'; older.createdAt = '2026-10-21T00:00:00.000Z'; older.updatedAt = '2026-10-21T05:00:00.000Z';
      older.body = older.body.replace('by=owner', 'by=invalid');
      page.comments.push(older);
    }],
  ]) test(`${kind}: ${name}`, () => fixture(({ change, check }) => {
    change('comments-1.json', page => {
      mutate(page.comments.find(comment => comment.body.includes(kind)), page);
      page.comments.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    });
    const result = check(expected);
    if (kind === 'mono-tech: approved' && name === 'newer valid plus older invalid') assert.equal(result.recordId, 'new-valid');
    if (kind === 'mono-tech: approved' && name === 'comment edited later') assert.equal(result.recordId, 'tech-record');
  }));
}
