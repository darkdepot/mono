import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

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
