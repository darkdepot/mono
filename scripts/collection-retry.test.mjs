import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryConfig } from './runtime.mjs';
import { collectionBudget } from './orchestrator/collector.mjs';

const config = delivery => ({ orchestration: { delivery } });
test('retry-old-config-1200: defaults fit current windows; an old attempt cannot launch without budget', () => {
  const defaults = deliveryConfig();
  assert.equal(defaults.collectionRetries, 1);
  assert.equal(defaults.collectionTimeoutSec, 4500);
  assert.ok(defaults.collectionTimeoutSec < defaults.confirmationTimeoutSec);
  assert.ok(defaults.confirmationTimeoutSec < defaults.evidenceLimitSec);
  assert.throws(() => deliveryConfig(config({ confirmationTimeoutSec: 1200 })), /collectionTimeoutSec.*confirmationTimeoutSec/);
  const old = collectionBudget({ confirmationTimeoutSec: 1200 }, { publishedAt: new Date().toISOString() });
  assert.throws(() => old.beforeLaunch(), /timed-out.*budget/);
  for (const collectionTimeoutSec of [1200, 1201])
    assert.throws(() => deliveryConfig(config({ confirmationTimeoutSec: 1200, collectionTimeoutSec })), /collectionTimeoutSec.*confirmationTimeoutSec/);
  for (const collectionRetries of [-1, 0.5, Infinity])
    assert.throws(() => deliveryConfig(config({ collectionRetries })), /collectionRetries/);
  assert.equal(deliveryConfig(config({ collectionRetries: 0 })).collectionRetries, 0);
});
test('retry-late-start: deadline is publication plus registry timeout, never invocation time', () => {
  const now = Date.now(), publishedAt = new Date(now - 1190_000).toISOString();
  const budget = collectionBudget({ confirmationTimeoutSec: 1200 }, { publishedAt });
  assert.equal(budget.deadline, Date.parse(publishedAt) + 1200_000);
  assert.throws(() => budget.beforeLaunch(), /timed-out.*budget/);
  assert.equal(collectionBudget({ confirmationTimeoutSec: 1800, collectionTimeoutSec: 123, collectionRetries: 0 }, { publishedAt }).timeoutMs, 123_000);
});

test('retry-slow-confirmation: late reconciliation cannot publish confirmation', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { publishPhase, confirmQueue } = await import('./delivery-state.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-confirm-budget-'));
  const head = 'a'.repeat(40), id = `preflight-collect:${head}:1`;
  const queue = [{ id, operation: 'preflight-collect', target: head, payload: { request: { collectionId: id } } }];
  const report = { issue: 'MONO-999', stage: 'mono-deliver', attempt: 1, packVersion: 'fixture', surfaceRevision: 6,
    phase: 'code', sequence: 1, kind: 'phase', head, linear_mutations_pending: [],
    capsule: { phase: 'code', head, open_queue: [], decisions: [], writable_roots: [path.join(root, 'reports')] } };
  try {
    publishPhase(report, path.join(root, 'reports/MONO-999-phase-code.json'));
    const published = publishPhase({ ...report, phase: 'preflight', kind: 'confirmation-request', linear_mutations_pending: queue,
      capsule: { ...report.capsule, phase: 'preflight', open_queue: queue } }, path.join(root, 'reports/MONO-999-phase-preflight.json'));
    await assert.rejects(confirmQueue(published, root, async () => {
      await new Promise(resolve => setTimeout(resolve, 40)); return { state: 'missing' };
    }, path.join(root, 'reports'), Date.now() + 10), /timed-out.*confirmation/);
    assert.equal(fs.existsSync(path.join(root, 'confirmations/MONO-999-phase-preflight-a1-s1.confirmed.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
