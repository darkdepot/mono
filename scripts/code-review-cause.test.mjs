import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound, runInvocation, roleFailureCause, INFRA_PAUSE_SEC } from './code-review.mjs';
import { installReviewClis } from './test-fixtures/review-clis.mjs';
import { streamFailureCause, infraCause, workerDeathCause } from './runtime.mjs';

// MONO-483: every failed role attempt names its cause, and the round names the host load and a sleep.
// Role processes are small node scripts; clocks and host load are injected.
const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const transcripts = JSON.parse(fs.readFileSync(path.join(packRoot, 'evals/code-review/recorded-responses.json'), 'utf8'));
const review = () => ({ ...transcripts.clean, findings: [], reviewedFiles: ['input.mjs'] });
function fixture(t) {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-cause-review-')); t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
  fs.writeFileSync(path.join(worktree, 'input.mjs'), 'export function value(n) { return 0; }\n'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(worktree, 'input.mjs'), 'export function value(n) { return n; }\n'); git('add', '.'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD');
  return { worktree, head, base, contract: 'Return only nonnegative numbers.', packRoot };
}
const node = (code, cwd = os.tmpdir()) => ({ command: process.execPath, args: ['-e', code], cwd, env: { PATH: process.env.PATH } });
const failure = (invocation, timeoutMs = 10_000) => runInvocation(invocation, '', timeoutMs).then(() => assert.fail('the role should fail'), error => error);

test('role process failures: the timer is a timeout, the output limit is not, a DNS error is the network', async () => {
  const timedOut = await failure(node('setTimeout(() => {}, 60000)'), 300);
  assert.match(timedOut.message, /^role failed \(timeout after 0.3 s\); no response admitted$/, "MONO-494: a timeout names the limit it hit");
  assert.deepEqual([timedOut.timedOut, timedOut.outputLimit, timedOut.processFailure], [true, false, true]);
  assert.equal(roleFailureCause(timedOut), 'timeout');

  const flooded = await failure(node('const chunk = "x".repeat(1 << 20); for (let i = 0; i < 18; i++) process.stdout.write(chunk); setTimeout(() => {}, 60000)'));
  assert.match(flooded.message, /^role failed \(output limit\); no response admitted$/);
  assert.deepEqual([flooded.timedOut, flooded.outputLimit], [false, true]);
  assert.equal(roleFailureCause(flooded), 'other', 'an output limit is not the environment');
  assert.equal(roleFailureCause(flooded, { slept: true }), 'other', 'an output limit stays with the work across a host sleep');

  for (const sign of ['error: Could not resolve host: api.openai.com', 'getaddrinfo ENOTFOUND chatgpt.com',
    'stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)', 'read ECONNRESET']) {
    const offline = await failure(node(`console.error(${JSON.stringify(sign)}); process.exit(1)`));
    assert.equal(roleFailureCause(offline), 'network', sign);
  }
  const plain = await failure(node('console.error("model refused the request"); process.exit(1)'));
  assert.equal(roleFailureCause(plain), 'other', 'a plain exit is not the network');
  assert.equal(roleFailureCause({ codexLoginMissing: true }), 'login', 'a logged-out Codex is a login cause');
});

test('a round names each failed attempt\'s cause, the host load and a sleep; only an all-environment round is environmental', async t => {
  const f = fixture(t);
  // Wall and monotonic clocks: a jump of the wall clock alone is the host sleeping.
  const clock = (sleepAt = null) => { let wall = 0, mono = 0, calls = 0; return { wall: () => { calls++; if (sleepAt !== null && calls === sleepAt) wall += 120_000; return wall += 10; }, mono: () => mono += 10 }; };
  const loads = () => { let n = 0; return () => ({ load1: [3, 98.5][Math.min(n++, 1)], cpus: 12 }); };
  const processError = extra => Object.assign(new Error('role failed (1); no response admitted'), { processFailure: true, exceeded: false, ...extra });
  const round = (runRole, options = {}) => runReviewRound(f, { runRole, ensureLogin: async () => ({ status: 'fresh' }), clock: clock(), load: loads(), ...options });
  const causes = record => record.failures.filter(item => item.role).map(item => item.cause);

  const timeouts = await round(async () => { throw processError({ timedOut: true, exceeded: true, message: 'role failed (timeout); no response admitted' }); });
  assert.deepEqual([timeouts.outcome, timeouts.cause, causes(timeouts)], ['not-reviewed', 'environment', ['timeout', 'timeout']]);
  assert.deepEqual(timeouts.host, { start: { load1: 3, cpus: 12 }, end: { load1: 98.5, cpus: 12 }, slept: false });

  // The wall clock jumps by two minutes during the first attempt: that failure is the host sleeping, and the round knows it slept.
  // The second attempt then runs out of time on the woken, loaded host.
  let attempts = 0;
  const slept = await round(async () => { throw ++attempts === 1 ? processError() : processError({ timedOut: true, exceeded: true }); }, { clock: clock(3) });
  assert.deepEqual([slept.cause, causes(slept), slept.host.slept], ['environment', ['host-slept', 'timeout'], true]);
  const awake = await round(async () => { throw processError(); });
  assert.deepEqual([awake.cause, causes(awake), awake.host.slept], ['review', ['other', 'other'], false], 'the same exit without a sleep stays with the work');

  const network = await round(async () => { throw processError({ network: true }); });
  assert.deepEqual([network.cause, causes(network)], ['environment', ['network', 'network']]);

  // A login still failing after its one refresh.
  const login = await round(async () => { throw Object.assign(new Error('вход Claude истёк или не найден: role failed (1)'), { loginFailure: true }); });
  assert.deepEqual([login.cause, causes(login)], ['environment', ['login', 'login']]);

  // A malformed answer is the work's own: answered, then not parseable.
  const malformed = await round(async () => ({ response: { completed: 'nope' }, elapsedMs: 1, usage: null }));
  assert.deepEqual([malformed.cause, causes(malformed)], ['review', ['other', 'other']]);

  let calls = 0;
  const mixed = await round(async () => { calls++; throw calls === 1 ? processError({ timedOut: true, exceeded: true }) : new Error('Codex structured output missing'); });
  assert.deepEqual([mixed.cause, causes(mixed)], ['review', ['timeout', 'other']], 'one cause in the work keeps the round with the work');

  // A round that stops on its own checks (not on a role) is never environmental.
  const blank = await runReviewRound({ ...f, contract: '' }, { runRole: async () => assert.fail('no role'), clock: clock(), load: loads() });
  assert.deepEqual([blank.outcome, blank.cause], ['not-reviewed', 'review']);

  const clean = await round(async () => ({ response: review(), elapsedMs: 1, usage: null }));
  assert.deepEqual([clean.outcome, clean.host.end.load1, Object.hasOwn(clean, 'cause')], ['clean', 98.5, false], 'a completed round carries the host facts too');
});

// MONO-504: an overloaded model or a rate limit is the environment: no round is spent and the second attempt waits first.
test('an overloaded model or a rate limit is an environmental cause, read only from error events', async t => {
  const capacity = 'Selected model is at capacity. Please try a different model.';
  const events = list => list.map(event => JSON.stringify(event)).join('\n');
  const failed = await failure(node(`console.log(${JSON.stringify(events([{ type: 'error', message: capacity }, { type: 'turn.failed', error: { message: capacity } }]))}); process.exit(1)`));
  assert.equal(roleFailureCause(failed), 'capacity', 'a failed turn on an overloaded model');
  const limited = await failure(node('console.error("unexpected status 429 Too Many Requests"); process.exit(1)'));
  assert.equal(roleFailureCause(limited), 'rate-limit', 'a 429 on the CLI error stream');
  const innocent = await failure(node('console.error("line 429: overloaded constructor; 529 files"); process.exit(1)'));
  assert.equal(roleFailureCause(innocent), 'other', 'a bare number or word on stderr is not a status');
  // The model's own text about capacity is not an error event.
  const spoken = await failure(node(`console.log(${JSON.stringify(events([{ type: 'item.completed', item: { type: 'agent_message', text: 'the server is at capacity (529)' } }]))}); process.exit(1)`));
  assert.equal(roleFailureCause(spoken), 'other', 'the answer text never names an environmental cause');
  assert.equal(streamFailureCause(events([{ type: 'result', is_error: true, api_error_status: 529, result: 'API Error' }])), 'capacity', 'a Claude result on 529');
  assert.equal(streamFailureCause(events([{ type: 'error', message: capacity }, { type: 'turn.completed' }])), null, 'a recovered turn did not end on the error');
  // A number in prose is not a status; a tool's own limit is not the model's; a resumed worker or a broken tail ends the failure.
  assert.equal(streamFailureCause(events([{ type: 'error', message: 'unexpected status 400 Bad Request: requested 529 tokens' }])), null, 'a bare 529 in prose');
  assert.equal(infraCause('rate limit exceeded for file search'), null, 'a tool-level rate limit');
  assert.equal(infraCause('unexpected status 529 Overloaded'), 'capacity', 'an HTTP 529 status');
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-death-')), 'worker.jsonl');
  t.after(() => fs.rmSync(path.dirname(log), { recursive: true, force: true }));
  for (const [tail, why] of [[{ type: 'mono.worker-instance' }, 'a later worker instance'], ['{"type":"item.comp', 'a malformed tail']]) {
    fs.writeFileSync(log, events([{ type: 'turn.failed', error: { message: capacity } }]) + '\n' + (typeof tail === 'string' ? tail : JSON.stringify(tail)) + '\n');
    assert.equal(workerDeathCause(log), 'other', why);
  }
  fs.writeFileSync(log, events([{ type: 'mono.worker-instance' }, { type: 'turn.failed', error: { message: capacity } }]) + '\n');
  assert.equal(workerDeathCause(log), 'capacity', 'a failure after the latest worker instance');
  assert.equal(roleFailureCause({ infra: 'capacity' }, { answered: true }), 'other', 'an answered role stays with the work');

  const f = fixture(t), pauses = [];
  const clock = () => { let wall = 0, mono = 0; return { wall: () => wall += 10, mono: () => mono += 10 }; };
  const processError = extra => Object.assign(new Error('role failed (1); no response admitted'), { processFailure: true, exceeded: false, ...extra });
  const busy = await runReviewRound(f, { runRole: async () => { throw processError({ infra: 'capacity' }); }, ensureLogin: async () => ({ status: 'fresh' }),
    clock: clock(), load: () => ({ load1: 1, cpus: 12 }), pause: async ms => { pauses.push(ms); } });
  assert.deepEqual([busy.outcome, busy.cause, busy.failures.filter(item => item.role).map(item => item.cause)], ['not-reviewed', 'environment', ['capacity', 'capacity']]);
  assert.deepEqual(pauses, [INFRA_PAUSE_SEC * 1000], 'the second attempt waits once before it runs');
});

test('a Codex role that exits cleanly on a failed turn of an overloaded model is the environment, no round spent', async t => {
  const f = fixture(t), bin = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-cause-bin-')), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; fs.rmSync(bin, { recursive: true, force: true }); });
  installReviewClis(bin, { packRoot, failRole: 'capacity' });
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  const record = await runReviewRound(f, { ensureLogin: async () => ({ status: 'fresh' }), secondMs: 1 });
  assert.deepEqual([record.outcome, record.cause, record.failures.filter(item => item.role).map(item => item.cause)], ['not-reviewed', 'environment', ['capacity', 'capacity']]);
});
