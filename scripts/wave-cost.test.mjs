import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { canonical } from './runtime.mjs';

function measure(events) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-127-cost-'));
  try {
    fs.mkdirSync(path.join(root, 'logs'));
    fs.writeFileSync(path.join(root, 'logs/MONO-999-mono-deliver-a1.jsonl'),
      events.map(event => JSON.stringify(event)).join('\n') + '\n');
    const output = execFileSync(process.execPath, ['scripts/wave-cost.mjs', 'MONO-999', '--root', root], { encoding: 'utf8' });
    return { result: JSON.parse(output.slice(0, output.lastIndexOf('\nЦена волны'))), output };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('attempt log without usage is unavailable and the wave total is incomplete (AE17)', () => {
  const { result, output } = measure([{ type: 'thread.started', thread_id: 'fixture' }]);
  assert.equal(result.worker.complete, false);
  assert.match(result.worker.attempts[0].usage_status, /^unavailable:/);
  assert.equal(result.worker.attempts[0].usage, null);
  assert.equal(result.worker.usage, null);
  assert.equal(result.measurable_total, null);
  assert.notEqual(result.measurable_total_status, 'measured');
  assert.match(output, /итог неполный/);
});

test('attempt interrupted before final usage is incomplete (AE9)', () => {
  for (const priorUsage of [[], [{ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 2 } }]]) {
    const { result, output } = measure([
      { type: 'thread.started', thread_id: 'fixture' }, ...priorUsage,
      { type: 'turn.started' },
      { type: 'item.started', item: { id: 'work', type: 'command_execution', command: 'node scripts/verify.mjs' } },
    ]);
    assert.equal(result.worker.complete, false);
    assert.match(result.worker.attempts[0].usage_status, /^incomplete:/);
    assert.notEqual(result.measurable_total_status, 'measured');
    assert.equal(result.worker.usage?.input_tokens ?? null, priorUsage.length ? 10 : null);
    assert.match(output, /итог неполный/);
  }
});

test('an explicitly measured zero stays measured', () => {
  const { result } = measure([{ type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } }]);
  assert.equal(result.worker.usage_status, 'measured');
  assert.equal(result.worker.usage.non_overlapping_total_tokens, 0);
});

test('a resumed completed turn does not erase missing usage from an interrupted turn', () => {
  const { result } = measure([
    { type: 'thread.started', thread_id: 'fixture' },
    { type: 'turn.started' },
    { type: 'thread.started', thread_id: 'fixture' },
    { type: 'turn.started' },
    { type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 1 } },
  ]);
  assert.equal(result.worker.usage.input_tokens, 5);
  assert.match(result.worker.attempts[0].usage_status, /^incomplete:/);
  assert.equal(result.worker.complete, false);
  assert.notEqual(result.measurable_total_status, 'measured');
});

test('a log whose counters never decrease carries thread totals and is counted once', () => {
  const turn = (input, cached, output) => ({ type: 'turn.completed', usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } });
  const { result } = measure([
    { type: 'thread.started', thread_id: 'fixture' }, turn(100, 90, 10),
    { type: 'thread.started', thread_id: 'fixture' }, turn(250, 220, 25),
    { type: 'thread.started', thread_id: 'fixture' }, turn(400, 350, 40),
  ]);
  assert.equal(result.worker.attempts[0].counting, 'thread-total');
  assert.equal(result.worker.usage.input_tokens, 400);
  assert.equal(result.worker.usage.non_overlapping_total_tokens, 440);
  assert.equal(result.worker.usage_status, 'measured');
});

test('a log that reports each run separately is still summed', () => {
  const turn = (input, cached, output) => ({ type: 'turn.completed', usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } });
  const { result } = measure([turn(100, 90, 10), turn(500, 450, 30), turn(40, 30, 5)]);
  assert.equal(result.worker.attempts[0].counting, 'per-turn');
  assert.equal(result.worker.usage.input_tokens, 640);
  assert.equal(result.worker.usage.non_overlapping_total_tokens, 685);
});

function measureWithReceipts(envelopes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-378-cost-'));
  try {
    const evidence = path.join(root, 'evidence'), key = crypto.randomBytes(32);
    fs.mkdirSync(path.join(root, 'logs')); fs.mkdirSync(path.join(evidence, 'history'), { recursive: true });
    fs.writeFileSync(path.join(root, 'logs/MONO-999-mono-deliver-a1.jsonl'),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 } }) + '\n');
    fs.writeFileSync(path.join(evidence, 'receipt.key'), key);
    const pins = (issue, name = 'pins.json') => ({ file: path.join(root, 'dispatch', `${issue}-a1`, name), digest: 'd'.repeat(64) });
    for (const [index, make] of envelopes.entries()) {
      const { forged, ...receipt } = make(pins);
      const signature = crypto.createHmac('sha256', forged ? crypto.randomBytes(32) : key).update(canonical(receipt)).digest('hex');
      fs.writeFileSync(path.join(evidence, 'history', `${receipt.runId ?? index}.json`), JSON.stringify({ receipt, signature }));
    }
    const output = execFileSync(process.execPath, ['scripts/wave-cost.mjs', 'MONO-999', '--root', root, '--evidence-root', evidence], { encoding: 'utf8' });
    return { result: JSON.parse(output.slice(0, output.lastIndexOf('\nЦена волны'))), line: output.slice(output.lastIndexOf('\nЦена волны') + 1).trim() };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const codexUsage = { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 50, reasoning_output_tokens: 10 };
const claudeUsage = { input_tokens: 10, cache_creation_input_tokens: 30, cache_read_input_tokens: 60, output_tokens: 5 };
const cost = (role, engine, usage) => ({ role, engine, model: `${engine}-model`, family: engine, attempt: 1, elapsedMs: 5, usage });
const round = (number, head, costs) => ({ number, head: head.repeat(40), base: 'b'.repeat(40), costs });
const receipt = (runId, pins, head, review) => ({ producer: 'gate-review-v3', recordedAt: `2026-11-11T00:00:0${runId.slice(1)}Z`, runId, pins, head: head.repeat(40), base: 'b'.repeat(40), review });

test('review cost comes from signed gate receipts and counts every round once', () => {
  const first = round(1, '1', [cost('reviewer', 'codex', codexUsage), cost('checker', 'claude', claudeUsage)]);
  const second = round(2, '2', [cost('reviewer', 'codex', codexUsage), { ...cost('checker', 'claude', null), failure: true }]);
  const record = rounds => ({ schemaVersion: 1, contractDigest: 'c'.repeat(64), rounds, round: rounds.at(-1) });
  const failed = [cost('reviewer', 'codex', codexUsage)];
  const { result, line } = measureWithReceipts([
    pins => receipt('r1', pins('MONO-999'), '1', { outcome: 'findings', spent: true, round: 1, record: record([first]) }),
    pins => receipt('r2', pins('MONO-999'), '2', { outcome: 'clean', spent: true, round: 2, record: record([first, second]) }),
    pins => receipt('r3', pins('MONO-999'), '2', { outcome: 'clean', spent: false, reusedFrom: 'r2', round: 2, record: record([first, second]) }),
    pins => receipt('r4', pins('MONO-999'), '3', { outcome: 'not-reviewed', spent: false, round: null, record: null, costs: failed, failures: [{ reason: 'offline', costs: failed }] }),
    pins => receipt('r5', pins('MONO-999', 'pins.v1.json'), '2', { outcome: 'clean', spent: true, round: 1, record: record([round(1, '2', [cost('reviewer', 'claude', claudeUsage)])]) }),
    pins => ({ ...receipt('r6', pins('MONO-999'), '4', { outcome: 'clean', spent: true, round: 3, record: record([round(3, '4', [cost('reviewer', 'codex', { ...codexUsage, input_tokens: 9_000_000 })])]) }), forged: true }),
    pins => receipt('r7', pins('MONO-9999'), '5', { outcome: 'clean', spent: true, round: 1, record: record([round(1, '5', [cost('reviewer', 'codex', codexUsage)])]) }),
    pins => ({ ...receipt('r8', pins('MONO-999'), '6', { outcome: 'clean', spent: true, round: 1, record: record([round(1, '6', [cost('reviewer', 'codex', codexUsage)])]) }), producer: 'gate-review-v2' }),
  ]);
  assert.deepEqual(result.autoreview.receipts, { receipts: 5, rounds: 3, not_reviewed: 1, calls: 6, measured_calls: 5 });
  assert.deepEqual(result.autoreview.usage, { input_tokens: 3200, cached_input_tokens: 1320, cache_write_input_tokens: 60, output_tokens: 160,
    reasoning_output_tokens: 30, uncached_input_tokens: 1880, non_overlapping_total_tokens: 3360 });
  assert.equal(result.measurable_total.input_tokens, 3210);
  assert.match(line, /исполнитель 11, авто-ревью: кругов 3 \(не состоялось: 1\), 3 тыс\. токенов \(измерено 5 из 6 вызовов\), оркестратор/);
  assert.doesNotMatch(line, /проходов авто-ревью|unavailable:/);
});

test('receipts without usage are unavailable, and an Issue without receipts keeps the helper-log wording', () => {
  const silent = measureWithReceipts([pins => receipt('r1', pins('MONO-999'), '1', { outcome: 'clean', spent: true, round: 1,
    record: { contractDigest: 'c'.repeat(64), rounds: [round(1, '1', [cost('reviewer', 'codex', null)])] } })]);
  assert.match(silent.result.autoreview.usage, /^unavailable: review receipts carry no token usage/);
  assert.match(silent.line, /авто-ревью: кругов 1, н\/д \(в квитанциях нет учёта\), оркестратор/);
  const legacy = measureWithReceipts([pins => receipt('r1', pins('MONO-9999'), '1', { outcome: 'clean', spent: true, round: 1,
    record: { contractDigest: 'c'.repeat(64), rounds: [round(1, '1', [cost('reviewer', 'codex', codexUsage)])] } })]);
  assert.equal(legacy.result.autoreview.receipts, undefined);
  assert.match(legacy.result.autoreview.usage, /^unavailable: autoreview helper output does not report token usage/);
  assert.match(legacy.line, /авто-ревью н\/д \(помощник не сообщает учёт\).*проходов авто-ревью н\/д \(вывод помощника не найден\)/);
});
