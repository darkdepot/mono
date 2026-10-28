import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyPluginFixture } from './plugin-fixture.mjs';
import { expandedWrite } from './orchestrator/command-state.mjs';
import { captureCriteria, publishPhase, confirmQueue, validateConfirmation, waitForConfirmation,
  requiresConfirmation, confirmationPath } from './delivery-state.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-code-boundary-'));
  captureCriteria({ root, issue: 'MONO-993', attempt: 1, issueFile: path.resolve('scripts/fixtures/implementation-approved-issue.md') });
  const head = 'b'.repeat(40), reports = path.join(root, 'reports');
  const file = phase => path.join(reports, `MONO-993-phase-${phase}.json`);
  const code = { issue: 'MONO-993', stage: 'mono-deliver', attempt: 1, packVersion: 'test', surfaceRevision: 5,
    phase: 'code', sequence: 1, kind: 'phase', head, phase_result: 'implemented-needs-preflight',
    summary: 'Команды справки исправлены.', not_built: [], not_verified: [],
    criteria: ['Справка называет действующую команду', 'Список содержит все команды', 'Ошибочная команда объясняет исправление'].map(criterion => ({
      criterion, done: true, outcome: 'confirmed', proof: 'Вызов CLI', result: 'Код 0 и действующая команда', head, worktree_fingerprint: 'c'.repeat(64) })),
    linear_mutations_pending: [], capsule: { phase: 'code', head, decisions: ['Старт: утверждённый пакет, допуск проверен.'],
      open_queue: [], writable_roots: [reports] } };
  const preflight = () => ({ ...code, phase: 'preflight', phase_result: 'ready',
    capsule: { ...code.capsule, phase: 'preflight' } });
  return { root, file, code, preflight, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('code boundary: only the exact complete implemented report comment skips waiting', () => {
  const f = fixture();
  try {
    const code = publishPhase(f.code, f.file('code'));
    assert.equal(code.capsule.open_queue.length, 1);
    assert.equal(requiresConfirmation(code), false);
    assert.match(code.capsule.open_queue[0].payload.body, /Старт/);
    for (const mutate of [
      r => { r.capsule.open_queue[0].payload.body = 'not the report'; },
      r => { r.capsule.open_queue[0].operation = 'unknown'; },
      r => { r.capsule.open_queue[0].target = 'MONO-994'; },
      r => { r.capsule.open_queue = []; },
      r => { r.capsule.open_queue.push({ id: 'unknown', operation: 'anything', target: r.issue, payload: {} }); },
      r => { r.phase_result = 'blocked'; },
    ]) {
      const changed = structuredClone(code); mutate(changed); changed.linear_mutations_pending = changed.capsule.open_queue;
      assert.equal(requiresConfirmation(changed), true);
    }
  } finally { f.close(); }
});
test('code boundary: pending report is carried into the confirmed Preflight queue with its fingerprint', async () => {
  const f = fixture();
  try {
    const code = publishPhase(f.code, f.file('code'));
    const ready = publishPhase(f.preflight(), f.file('preflight'));
    assert.deepEqual(ready.capsule.open_queue, code.capsule.open_queue);
    assert.equal(requiresConfirmation(ready), true);
    const seen = [];
    const ack = await confirmQueue(ready, f.root, (action, write) => {
      seen.push(write.payload.body); return { state: 'present', evidence: 'Linear read-back' };
    });
    assert.equal(validateConfirmation(ready, ack), true);
    assert.equal(seen.length, 1);
    const ship = { ...f.preflight(), phase: 'ship', capsule: { ...f.code.capsule, phase: 'ship' } };
    const shipped = publishPhase(ship, f.file('ship'));
    await confirmQueue(shipped, f.root, () => ({ state: 'present', evidence: 'ship read-back' }));
    const saved = fs.readFileSync(f.file('code'));
    fs.writeFileSync(f.file('code'), JSON.stringify({ ...code, text: 'tampered' }));
    assert.throws(() => publishPhase({ ...ship, sequence: 2 }, f.file('ship')), /digest|fingerprint|отпечаток/);
    fs.writeFileSync(f.file('code'), saved);
  } finally { f.close(); }
});
test('code boundary: report revisions replace the pending comment, marking an applied old report stale', async () => {
  for (const applied of [false, true]) {
    const f = fixture();
    try {
      const first = publishPhase(f.code, f.file('code'));
      if (applied) await confirmQueue(first, f.root, () => ({ state: 'present', evidence: 'old comment read back' }));
      const revised = publishPhase({ ...f.code, sequence: 2, summary: 'Справка и объяснение ошибки исправлены.' }, f.file('code'));
      assert.notEqual(revised.capsule.open_queue[0].id, first.capsule.open_queue[0].id);
      assert.match(revised.capsule.open_queue[0].payload.body, /устарел/);
      const ready = publishPhase(f.preflight(), f.file('preflight'));
      assert.deepEqual(ready.capsule.open_queue, revised.capsule.open_queue);
      await confirmQueue(ready, f.root, () => ({ state: 'present', evidence: 'new comment read back' }));
      const retry = publishPhase({ ...f.code, sequence: 2, summary: 'Справка и объяснение ошибки исправлены.' }, f.file('code'));
      assert.deepEqual(retry, revised, 'lost publication response does not create another revision');
    } finally { f.close(); }
  }
});
test('code boundary: stopped report is published in full, waits in its own queue and times out', async () => {
  const f = fixture();
  try {
    const report = publishPhase({ ...f.code, phase_result: 'blocked' }, f.file('code'));
    assert.equal(requiresConfirmation(report), true);
    const body = report.capsule.open_queue[0].payload.body;
    for (const section of ['Не проверено', 'Найдена поломка', 'Доказательства']) assert.ok(body.includes(section));
    await assert.rejects(waitForConfirmation({ ...report, publishedAt: new Date(Date.now() - 2000).toISOString() },
      confirmationPath(report, f.root), 1), /write-unconfirmed/);
    assert.throws(() => publishPhase(f.preflight(), f.file('preflight')), /not confirmed/);
    await confirmQueue(report, f.root, (_, write) => { assert.equal(write.payload.body, body); return { state: 'present', evidence: 'full stop read back' }; });
  } finally { f.close(); }
});
test('code boundary: stopping after a pending result replaces it and still waits for the full stopped report', async () => {
  const f = fixture();
  try {
    const first = publishPhase(f.code, f.file('code'));
    const stop = publishPhase({ ...f.code, sequence: 2, phase_result: 'blocked', summary: 'Работа остановлена: найдено противоречие.' }, f.file('code'));
    assert.equal(requiresConfirmation(stop), true);
    assert.ok(stop.superseded_reports.includes(first.capsule.open_queue[0].id));
    assert.throws(() => publishPhase(f.preflight(), f.file('preflight')), /not confirmed/);
    await confirmQueue(stop, f.root, () => ({ state: 'present', evidence: 'stop read back' }));
  } finally { f.close(); }
});
test('code boundary: recovery after immutable snapshot publication preserves the original report and deadline', () => {
  const f = fixture();
  try {
    const first = publishPhase(f.code, f.file('code'));
    fs.unlinkSync(f.file('code'));
    assert.deepEqual(publishPhase(f.code, f.file('code')), first);
  } finally { f.close(); }
});
test('code boundary: a stop with unchanged summary still gets a distinct full report and question', () => {
  const f = fixture();
  try {
    const first = publishPhase(f.code, f.file('code'));
    const stop = publishPhase({ ...f.code, sequence: 2, phase_result: 'blocked', reason: 'blocked', question: 'Как устранить противоречие?',
      recommendation: 'Вернуть пакет в Handoff.' }, f.file('code'));
    assert.notEqual(first.capsule.open_queue[0].id, stop.capsule.open_queue[0].id);
    assert.match(stop.capsule.open_queue[0].payload.body, /phase_result=blocked; reason=blocked/);
    assert.match(stop.capsule.open_queue[0].payload.body, /Вопрос: Как устранить противоречие/);
  } finally { f.close(); }
});
test('code boundary: report prose containing the certificate directive remains literal through both consumers', async () => {
  const f = fixture();
  try {
    const code = publishPhase({ ...f.code, summary: 'В справке описана команда append #/certificate.' }, f.file('code'));
    const ready = publishPhase(f.preflight(), f.file('preflight'));
    const write = code.capsule.open_queue[0];
    assert.deepEqual(expandedWrite(write, ready), write);
    await confirmQueue(ready, f.root, (_, observed) => {
      assert.deepEqual(observed, write); return { state: 'present', evidence: 'literal body read back' };
    });
  } finally { f.close(); }
});
test('code boundary: fallback publication keeps its immutable snapshot in the writable fallback mailbox', async () => {
  const f = fixture();
  try {
    const worktree = path.join(f.root, 'worktree'), fallback = path.join(worktree, '.orchestrator');
    f.code.capsule.writable_roots.push(worktree);
    const code = publishPhase(f.code, path.join(fallback, 'MONO-993-phase-code.json'), undefined, f.root);
    assert.equal(fs.readdirSync(path.join(f.root, 'reports')).some(name => name.includes('-phase-code-')), false);
    assert.ok(fs.existsSync(path.join(fallback, 'MONO-993-phase-code-a1-s1.json')));
    const ready = publishPhase(f.preflight(), f.file('preflight'));
    assert.deepEqual(ready.capsule.open_queue, code.capsule.open_queue);
    await confirmQueue(ready, f.root, () => ({ state: 'present', evidence: 'fallback report read back' }));
  } finally { f.close(); }
});
for (const [name, file, before, after, regression] of [
  ['unknown-write allowlist bypass', 'scripts/implementation-comment.mjs',
    'queue.length === 1 && canonical(queue[0]) === canonical(implementationComment(report))', 'queue.length === 1',
    'code boundary: only the exact complete implemented report comment skips waiting'],
  ['removed code fingerprint comparison', 'scripts/delivery-state.mjs',
    "if (published && digest(prior) !== digest(published)) throw new Error('published code report fingerprint mismatch');", '',
    'code boundary: pending report is carried into the confirmed Preflight queue with its fingerprint'],
  ['dropped pending report carry', 'scripts/delivery-state.mjs',
    'report.capsule.open_queue.unshift(write)', 'void write',
    'code boundary: pending report is carried into the confirmed Preflight queue with its fingerprint'],
]) test(`code boundary deliberate breakage catches ${name}`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-boundary-mutation-'));
  try {
    copyPluginFixture(root);
    const source = path.join(root, file), text = fs.readFileSync(source, 'utf8');
    assert.ok(text.includes(before)); fs.writeFileSync(source, text.replace(before, after));
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=^${regression}$`, 'scripts/code-confirmation.test.mjs'],
      { cwd: root, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /not ok 1/);
    assert.doesNotMatch(result.stdout + result.stderr, /SyntaxError|ERR_MODULE_NOT_FOUND/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
