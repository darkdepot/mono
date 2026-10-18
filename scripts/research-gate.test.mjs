import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkResearch, RESEARCH_GATE_DEFAULT_SINCE } from './idea-gate.mjs';
import { ideaDispatchFixture } from './fixtures/idea-dispatch.mjs';

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

test('research cutoff uses approval UTC timestamp strictly before since and sleeps by default', () => {
  const options = input(); delete options.document;
  options.approval.createdAt = '2026-10-16T23:59:59.999Z'; expectCode(options, 'legacy-before-cutoff');
  options.approval.createdAt = '2026-10-17T00:00:00Z'; expectCode(options, 'research-missing');
  options.approval.createdAt = '2026-10-17T01:00:00+02:00'; expectCode(options, 'legacy-before-cutoff');
  options.approval.createdAt = '2026-10-17T00:00:00Z';
  assert.equal(RESEARCH_GATE_DEFAULT_SINCE, '2099-12-31');
  delete options.since; expectCode(options, 'legacy-before-cutoff');
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
