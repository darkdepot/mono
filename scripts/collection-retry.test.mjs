import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryConfig } from './runtime.mjs';

const config = delivery => ({ orchestration: { delivery } });
test('collection-windows-removed: old window keys are ignored; only the retry allowance stays', () => {
  const defaults = deliveryConfig();
  assert.equal(defaults.collectionRetries, 1);
  for (const key of ['confirmationTimeoutSec', 'collectionTimeoutSec']) assert.equal(Object.hasOwn(defaults, key), false);
  assert.doesNotThrow(() => deliveryConfig(config({ confirmationTimeoutSec: 1200, collectionTimeoutSec: 1201 })),
    'an older product config with the removed windows still loads');
  for (const collectionRetries of [-1, 0.5, Infinity])
    assert.throws(() => deliveryConfig(config({ collectionRetries })), /collectionRetries/);
  assert.equal(deliveryConfig(config({ collectionRetries: 0 })).collectionRetries, 0);
});
