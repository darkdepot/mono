import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-route-gate-'));
  fs.cpSync(new URL('./fixtures/tech-gate/valid/', import.meta.url), root, { recursive: true });
  const change = mutate => {
    const file = path.join(root, 'comments-1.json'), page = JSON.parse(fs.readFileSync(file));
    mutate(page); fs.writeFileSync(file, JSON.stringify(page));
  };
  const check = (command, code) => {
    const r = spawnSync(process.execPath, ['scripts/idea-gate.mjs', command, '--mode', 'fresh', '--dump', root], { encoding: 'utf8' });
    assert.equal(r.status, code === 'pass' ? 0 : 1, r.stdout + r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 2, r.stdout + r.stderr);
    const result = JSON.parse(lines[1]);
    assert.equal(result.code, code, r.stdout);
    assert.match(lines[0], code === 'pass' ? /^Готово$/ : /^Стоп: /);
    return result;
  };
  try { run({ root, change, check }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('route preserves the recorded legacy path, with or without next', () => fixture(({ change, check }) => {
  assert.deepEqual(check('route', 'pass').requiredRecords, ['tech']);
  change(p => { p.comments.shift(); p.comments[0].body = p.comments[0].body.replace(' next=tech-evaluation', ''); });
  assert.deepEqual(check('route', 'pass').requiredRecords, []);
  change(p => { p.comments[0].body = p.comments[0].body.replace('by=owner', 'by=owner next=handoff'); });
  assert.deepEqual(check('route', 'pass').requiredRecords, []);
}));

test('tech validates an unknown PRD route before returning no-record', () => fixture(({ change, check }) => {
  change(p => { p.comments.shift(); p.comments[0].body = p.comments[0].body.replace('next=tech-evaluation', 'next=unknown'); });
  check('tech', 'bad-record');
  assert.equal(check('route', 'bad-record').stage, 'mono:discovery');
}));

test('damaged tech remains blocked at its writer and never hides an upstream fault', () => fixture(({ change, check }) => {
  change(p => { p.comments[0].body = p.comments[0].body.replace('Строим: одно', 'Строим: другое'); });
  for (const command of ['route', 'tech'])
    assert.equal(check(command, 'bad-record').stage, 'mono:tech-evaluation');
  change(p => { p.comments[1].body = p.comments[1].body.replace('next=tech-evaluation', 'next=handoff'); });
  for (const command of ['route', 'tech'])
    assert.equal(check(command, 'bad-record').stage, 'mono:tech-evaluation');
  change(p => { p.comments[1].body = p.comments[1].body.replace('next=handoff', 'next=unknown'); });
  for (const command of ['route', 'tech'])
    assert.equal(check(command, 'bad-record').stage, 'mono:discovery');
}));

for (const [name, mutate, stage] of [
  ['PRD design field', p => { p.comments[1].body = p.comments[1].body.replace('by=owner', 'by=owner design=not-needed'); }, 'mono:discovery'],
  ['PRD next design', p => { p.comments[1].body = p.comments[1].body.replace('next=tech-evaluation', 'next=design'); }, 'mono:discovery'],
  ['design approval', p => { p.comments.unshift({ id:'design', createdAt:'2026-10-21T04:00:00.000Z', updatedAt:'2026-10-21T04:00:00.000Z', body:'```text\nmono-design: approved project=broken\n```' }); }, 'mono:design'],
  ['tech design field', p => { p.comments[0].body = p.comments[0].body.replace('by=owner', 'by=owner design=none'); }, 'mono:tech-evaluation'],
]) test(`dormant route rejects ${name} through every gate`, () => fixture(({ change, check }) => {
  change(mutate);
  for(const command of ['route', 'tech', 'design']) assert.equal(check(command, 'bad-record').stage, stage);
}));
