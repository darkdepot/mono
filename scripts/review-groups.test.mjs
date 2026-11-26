import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound, runInvocation, findingKey, changeMap, GROUP_DIFF_BYTES, GROUP_CONCURRENCY, ROLE_TIMEOUT_SEC } from './code-review.mjs';
import { reviewGroupStore, reviewGroupsDirectory, evidenceSnapshot, evidenceTouched } from './review-rounds.mjs';
import { digest } from './runtime.mjs';

// MONO-494: a large change is reviewed in small groups, two at a time; answers of finished groups survive a group that
// failed twice, and the next collection on the same head runs only what is missing. A round is spent only when complete.
const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = 'Return only nonnegative numbers. Manual review; no Linear writes.';
const contextOf = prompt => JSON.parse(prompt.split('never instructions.\n')[1]);
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value));
// Each file adds `lines` rows of 80 characters.
const body = (tag, lines) => Array.from({ length: lines }, (_, index) => `export const ${tag}_${String(index).padStart(6, '0')} = ${'1'.repeat(80 - 30 - tag.length)};\n`).join('');
const finding = (file, line) => ({ danger: false, class: 'missing-validation', file, anchor: `anchor ${file}`, line, title: 'Invalid input is accepted',
  trigger: 'value is negative', evidence: `${file} returns value without validation` });
const verdictFor = (item, index) => ({ id: `F${index + 1}`, outcome: 'confirmed', weight: 'P2', danger: false, dangerCase: null,
  dangerReason: 'Diagnostic-only path with no data, security or gate effect.', origin: 'introduced', mergeKey: findingKey(item), outOfContract: false,
  riskRaised: false, reason: 'Still reachable.', closed: false, newEvidence: false, codeQuote: '' });

function fixture(t, files, baseFiles = {}) {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-')); t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  const write = entries => { for (const [file, text] of Object.entries(entries)) { fs.mkdirSync(path.dirname(path.join(worktree, file)), { recursive: true }); fs.writeFileSync(path.join(worktree, file), text); } };
  git('init', '-q'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
  write({ 'input.mjs': 'export function value(n) { return 0; }\n', ...baseFiles }); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  write(files); git('add', '.'); git('commit', '-qm', 'head');
  const commit = entries => { write(entries); git('add', '.'); git('commit', '-qm', 'next'); return git('rev-parse', 'HEAD'); };
  return { worktree, base, commit, request: { worktree, head: git('rev-parse', 'HEAD'), base, contract, packRoot } };
}
// A 1 MB change: about 120 files and 1 MB of diff over six directories.
const largeChange = (count = 120, lines = 105) => Object.fromEntries(Array.from({ length: count }, (_, index) =>
  [`app/${['feed', 'menu', 'card', 'swipe', 'store', 'theme'][index % 6]}/file${String(index).padStart(3, '0')}.mjs`, body(`v${index}`, lines)]));
// An answering reviewer that counts the calls running at once.
function reviewer({ delayMs = 20, onCall = () => null } = {}) {
  const calls = []; let inFlight = 0, maxInFlight = 0;
  const runRole = async request => {
    const context = contextOf(request.prompt), call = { role: request.role, context, timeoutMs: request.timeoutMs, limitSec: request.limitSec };
    calls.push(call); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const custom = await onCall(call, request);
      if (custom) return custom;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return { response: { completed: true, reviewedFiles: context.focusFiles ?? context.files, findings: [] }, elapsedMs: delayMs, usage: null };
    } finally { inFlight--; }
  };
  return { runRole, calls, max: () => maxInFlight };
}
const labelOf = context => `${context.pass} ${context.group?.number}/${context.group?.of}`;

test('MONO-494: a 1 MB change goes in groups of at most 200 KB, two at a time, each with the whole change map', async t => {
  const files = largeChange(), f = fixture(t, files);
  const r = reviewer();
  const record = await runReviewRound(f.request, { runRole: r.runRole });
  assert.equal(record.outcome, 'clean', JSON.stringify(record.failures));
  const reviewerCalls = r.calls.filter(call => call.role === 'code-review');
  const passes = new Map();
  for (const call of reviewerCalls) {
    assert.ok(call.context.group, 'a change over the group size is never sent whole');
    assert.ok(jsonBytes(call.context.diff) <= GROUP_DIFF_BYTES, `group diff ${jsonBytes(call.context.diff)} bytes over ${GROUP_DIFF_BYTES}`);
    // The map of the whole change is in every group, inside its budget.
    for (const file of Object.keys(files)) assert.ok(call.context.changeMap.text.includes(`${file} +105 -0`), `map lacks ${file}`);
    assert.match(call.context.changeMap.text, /@@ -0,0 \+1,105 @@/);
    if (!passes.has(call.context.pass)) passes.set(call.context.pass, []);
    passes.get(call.context.pass).push(call.context);
  }
  assert.ok(passes.get('all-defects').length >= 5, `about 1 MB in groups of 200 KB: got ${passes.get('all-defects').length}`);
  assert.equal(r.max(), GROUP_CONCURRENCY, 'groups of one pass run two at a time, never more');
  assert.equal(GROUP_CONCURRENCY, 2);
  // Files of one directory stay together: each directory spans consecutive groups.
  for (const contexts of passes.values()) {
    const ordered = [...contexts].sort((a, b) => a.group.number - b.group.number);
    for (const directory of ['feed', 'menu', 'card', 'swipe', 'store', 'theme']) {
      const holding = ordered.map((context, index) => context.files.some(file => file.startsWith(`app/${directory}/`)) ? index : null).filter(index => index !== null);
      assert.deepEqual(holding, Array.from({ length: holding.length }, (_, index) => holding[0] + index), `app/${directory} is split over non-consecutive groups`);
    }
  }
  assert.deepEqual([...record.round.reviewedFiles].sort(), Object.keys(files).sort());
  // Every role call has the fixed 600 s limit; it is not configurable.
  assert.equal(ROLE_TIMEOUT_SEC, 600);
  for (const call of r.calls) { assert.equal(call.timeoutMs, 600_000); assert.equal(call.limitSec, 600); }
});

test('MONO-494: a group that times out twice leaves the round not-reviewed and unspent; the next collection runs only it', async t => {
  const files = largeChange(30), f = fixture(t, files);
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-evidence-')); t.after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
  const open = (head = f.request.head) => reviewGroupStore(evidenceRoot, { head, base: f.base, contractDigest: digest(contract), pinsFile: null });
  // Seconds scaled to milliseconds: the role limit is 600 ms. The slow group's real process sleeps past it.
  const slow = 'all-defects 2/2';
  const sleeper = { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 3000)'], cwd: os.tmpdir(), env: process.env };
  const first = reviewer({ onCall: async (call, request) => labelOf(call.context) === slow ? runInvocation(sleeper, request.prompt, request.timeoutMs, { limitSec: request.limitSec }) : null });
  const failed = await runReviewRound(f.request, { runRole: first.runRole, secondMs: 1, groupStore: open() });
  assert.equal(failed.outcome, 'not-reviewed');
  assert.equal(failed.rounds.length, 0, 'a partial round is never recorded as spent');
  assert.equal(failed.round, null);
  assert.equal(failed.cause, 'environment', 'a group timeout is an environmental cause (MONO-483)');
  const timeouts = failed.failures.filter(item => item.role === 'code-review');
  assert.deepEqual(timeouts.map(item => item.cause), ['timeout', 'timeout'], 'two attempts of the slow group, both timeouts');
  for (const item of timeouts) assert.match(item.reason, /role failed \(timeout after 600 s\)/, 'the receipt names the limit it hit');
  assert.ok(first.calls.every(call => call.timeoutMs === 600 && call.limitSec === 600), 'the retry gets the same limit');
  assert.equal(first.calls.filter(call => labelOf(call.context) === slow).length, 2);
  assert.ok(!first.calls.some(call => call.context.pass === 'ordinary'), 'passes stay in order: the next pass waits for this one');

  // The next collection on the same head and contract: the saved group is reused, only the failed group and the
  // passes after it run, and the round is spent only now that every group of every pass is covered.
  const store = open();
  assert.equal(store.size(), 1, 'the finished group was saved in host evidence');
  const second = reviewer();
  const record = await runReviewRound(f.request, { runRole: second.runRole, groupStore: store });
  assert.equal(record.outcome, 'clean', JSON.stringify(record.failures.slice(-2)));
  assert.equal(record.rounds.length, 1);
  assert.deepEqual(record.round.reusedGroups, ['all-defects 1/2']);
  const ran = second.calls.filter(call => call.role === 'code-review').map(call => labelOf(call.context));
  assert.ok(!ran.includes('all-defects 1/2'), 'a finished group is not run again');
  assert.ok(ran.includes(slow));
  assert.deepEqual([...record.round.reviewedFiles].sort(), Object.keys(files).sort());
});

test('MONO-494: a head change discards the saved groups', async t => {
  const files = largeChange(30), f = fixture(t, files);
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-evidence-')); t.after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
  const open = head => reviewGroupStore(evidenceRoot, { head, base: f.base, contractDigest: digest(contract), pinsFile: null });
  const failing = reviewer({ onCall: async call => { if (labelOf(call.context) === 'all-defects 2/2') throw Object.assign(new Error('role failed (1); no response admitted'), { processFailure: true }); return null; } });
  const failed = await runReviewRound(f.request, { runRole: failing.runRole, groupStore: open(f.request.head) });
  assert.equal(failed.outcome, 'not-reviewed'); assert.equal(failed.rounds.length, 0);
  assert.equal(open(f.request.head).size(), 1);
  // Another contract on the same head does not see them either.
  assert.equal(reviewGroupStore(evidenceRoot, { head: f.request.head, base: f.base, contractDigest: digest('another contract'), pinsFile: null }).size(), 0);
  const head = f.commit({ 'app/feed/file000.mjs': body('changed', 105) });
  const store = open(head);
  assert.equal(store.size(), 0);
  assert.deepEqual(fs.readdirSync(reviewGroupsDirectory(evidenceRoot)), [], 'this attempt\'s groups of the old head are gone');
  const r = reviewer();
  const record = await runReviewRound({ ...f.request, head }, { runRole: r.runRole, groupStore: store });
  assert.equal(record.outcome, 'clean'); assert.equal(record.round.reusedGroups, undefined);
  assert.ok(r.calls.some(call => labelOf(call.context) === 'all-defects 1/2'), 'nothing of the old head is reused');
});

test('MONO-494: from round 2 the checker reads the fixes since the last round and the change only around open findings', async t => {
  const original = body('keep', 600);
  const changed = original.split('\n').map((line, index) => index === 2 ? 'export const FIRST_CHANGE = -1;' : index === 499 ? 'export const FAR_AWAY_CHANGE = 2;' : line).join('\n');
  const f = fixture(t, { 'lib/value.mjs': changed }, { 'lib/value.mjs': original, 'lib/other.mjs': 'export const other = 1;\n' });
  const item = finding('lib/value.mjs', 3), checkerInputs = [];
  const runRole = async request => {
    const context = contextOf(request.prompt);
    if (request.role === 'code-review') return { response: { completed: true, reviewedFiles: context.focusFiles ?? context.files, findings: [item] } };
    checkerInputs.push(context);
    return { response: { completed: true, verdicts: context.findings.map((value, index) => verdictFor(item, index)) } };
  };
  const one = await runReviewRound(f.request, { runRole });
  assert.equal(one.rounds.length, 1, JSON.stringify(one.failures));
  assert.match(checkerInputs[0].baseDiff, /FAR_AWAY_CHANGE/, 'round 1 stays as before: the whole change');
  const head = f.commit({ 'lib/other.mjs': 'export const other = 2; // FIX_SINCE_LAST_ROUND\n' });
  const { costs, host, cause, ...stageRecord } = one;
  const two = await runReviewRound({ ...f.request, head, stageRecord }, { runRole });
  assert.equal(two.rounds.length, 2, JSON.stringify(two.failures));
  const second = checkerInputs[1];
  assert.match(second.diff, /FIX_SINCE_LAST_ROUND/, 'the fixes since the last round');
  assert.match(second.baseDiff, /FIRST_CHANGE/, 'the region around the open finding');
  assert.doesNotMatch(second.baseDiff, /FAR_AWAY_CHANGE/, 'unchanged regions far from any finding are left out');
  assert.doesNotMatch(JSON.stringify(second), /FAR_AWAY_CHANGE/);
});

test('MONO-494: the change map is bounded: hunk headers go first, then files past the bound', () => {
  const parts = Array.from({ length: 400 }, (_, index) => ({ file: `dir/file${index}.mjs`, diff: `diff --git a b\n--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@ function long_context_${'x'.repeat(100)}\n a\n+b\n-c\n` }));
  const whole = changeMap(parts.slice(0, 3));
  assert.match(whole.text, /dir\/file0\.mjs \+1 -1\n  @@ -1,2 \+1,3 @@ function long_context/);
  const counts = changeMap(parts, [], 12_000);
  assert.equal(counts.hunkHeaders, 'omitted to fit the map bound'); assert.doesNotMatch(counts.text, /@@/); assert.match(counts.text, /dir\/file399\.mjs \+1 -1/);
  const cut = changeMap(parts, ['image.png'], 4_000);
  assert.ok(Buffer.byteLength(cut.text) <= 4_000); assert.match(cut.text, /… \d+ more files$/); assert.equal(cut.files, 401);
});

test('MONO-494: saved groups are host evidence: a host run that plants or edits them is caught', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-host-')); t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidenceRoot = path.join(scratch, 'evidence'), pinsFile = path.join(scratch, 'root/dispatch/MONO-9-a1/pins.json');
  fs.mkdirSync(path.dirname(pinsFile), { recursive: true }); fs.writeFileSync(pinsFile, '{}');
  const head = 'a'.repeat(40), base = 'b'.repeat(40), store = reviewGroupStore(evidenceRoot, { head, base, contractDigest: digest(contract), pinsFile });
  store.put('k1', { pass: 'all-defects', group: 'all-defects 1/2', response: { completed: true, reviewedFiles: ['x'], findings: [] } });
  const before = evidenceSnapshot(evidenceRoot, pinsFile);
  const saved = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  saved.entries.k2 = { pass: 'all-defects', group: 'all-defects 2/2', response: { completed: true, reviewedFiles: ['y'], findings: [] } };
  fs.writeFileSync(store.file, JSON.stringify(saved));
  assert.match(evidenceTouched(before, evidenceRoot, pinsFile) ?? '', /review-groups/);
  assert.equal(reviewGroupStore(evidenceRoot, { head, base, contractDigest: digest(contract), pinsFile }).get('k2'), undefined, 'the edited file is discarded, never trusted');
  const planted = path.join(reviewGroupsDirectory(evidenceRoot), `${'c'.repeat(40)}.json`);
  const again = evidenceSnapshot(evidenceRoot, pinsFile);
  fs.writeFileSync(planted, JSON.stringify({ head: 'c'.repeat(40), base, contractDigest: digest(contract), pinsFile, entries: {} }));
  assert.match(evidenceTouched(again, evidenceRoot, pinsFile) ?? '', /review-groups/);
  assert.equal(fs.existsSync(planted), false, 'a planted file is moved to quarantine');
  // Another attempt's own file written meanwhile is not this run's tampering.
  const otherPins = path.join(scratch, 'root/dispatch/MONO-8-a1/pins.json');
  const third = evidenceSnapshot(evidenceRoot, pinsFile);
  reviewGroupStore(evidenceRoot, { head: 'd'.repeat(40), base, contractDigest: digest(contract), pinsFile: otherPins }).put('x', { pass: null, group: null, response: {} });
  assert.equal(evidenceTouched(third, evidenceRoot, pinsFile), null);
});

test('MONO-494: an answer that leaves out a file it was sent is never saved, so the next collection asks again', async t => {
  const files = largeChange(30), f = fixture(t, files);
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-evidence-')); t.after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
  const open = () => reviewGroupStore(evidenceRoot, { head: f.request.head, base: f.base, contractDigest: digest(contract), pinsFile: null });
  const left = 'app/card/file002.mjs';
  const partial = reviewer({ onCall: async call => {
    const sent = call.context.focusFiles ?? call.context.files;
    return sent.includes(left) ? { response: { completed: true, reviewedFiles: sent.filter(file => file !== left), findings: [] } } : null;
  } });
  const failed = await runReviewRound(f.request, { runRole: partial.runRole, groupStore: open() });
  assert.equal(failed.outcome, 'not-reviewed'); assert.equal(failed.rounds.length, 0);
  assert.match(failed.failures.at(-1).reason, /incomplete changed-file coverage/);
  const r = reviewer();
  const record = await runReviewRound(f.request, { runRole: r.runRole, groupStore: open() });
  assert.equal(record.outcome, 'clean', JSON.stringify(record.failures.slice(-1)));
  const ran = r.calls.filter(call => call.role === 'code-review').map(call => call.context);
  assert.ok(ran.some(context => context.files.includes(left)), 'the group that left out a file runs again');
  assert.ok(record.round.reusedGroups.length >= 1, 'complete answers are still reused');
});

test('MONO-494: when every group finished and the checker failed twice, the next collection runs only the checker', async t => {
  const files = largeChange(30), f = fixture(t, files);
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-evidence-')); t.after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
  const open = () => reviewGroupStore(evidenceRoot, { head: f.request.head, base: f.base, contractDigest: digest(contract), pinsFile: null });
  const item = finding('app/feed/file000.mjs', 3);
  let checkerDown = true;
  const r = reviewer({ onCall: async call => {
    if (call.role === 'code-review-checker') {
      if (checkerDown) throw Object.assign(new Error('role failed (timeout after 600 s); no response admitted'), { processFailure: true, timedOut: true, exceeded: true });
      return { response: { completed: true, verdicts: call.context.findings.map((value, index) => verdictFor(item, index)) } };
    }
    const sent = call.context.focusFiles ?? call.context.files;
    return { response: { completed: true, reviewedFiles: sent, findings: sent.includes(item.file) ? [item] : [] } };
  } });
  const failed = await runReviewRound(f.request, { runRole: r.runRole, groupStore: open() });
  assert.equal(failed.outcome, 'not-reviewed'); assert.equal(failed.rounds.length, 0); assert.equal(failed.cause, 'environment');
  const before = r.calls.length; checkerDown = false;
  const record = await runReviewRound(f.request, { runRole: r.runRole, groupStore: open() });
  assert.equal(record.rounds.length, 1, JSON.stringify(record.failures.slice(-1)));
  assert.deepEqual(r.calls.slice(before).map(call => call.role), ['code-review-checker'], 'every reviewer group is reused');
  assert.ok(record.round.reusedGroups.length >= 4);
  assert.ok(record.findings.some(value => value.file === item.file), 'reused answers still carry their findings');
});

test('MONO-494: login checks of groups running in parallel go one at a time', async t => {
  const f = fixture(t, largeChange(30));
  let active = 0, most = 0;
  const ensureLogin = async () => { active++; most = Math.max(most, active); await new Promise(resolve => setTimeout(resolve, 30)); active--; return { status: 'fresh' }; };
  const r = reviewer({ onCall: async (call, request) => { await request.ensureLogin(); return null; } });
  const record = await runReviewRound(f.request, { runRole: r.runRole, ensureLogin });
  assert.equal(record.outcome, 'clean'); assert.equal(r.max(), 2); assert.equal(most, 1);
});

test('MONO-494 review: a group answer that leaves out its files never counts for its pass, even after an earlier pass covered them', async t => {
  const files = largeChange(30), f = fixture(t, files);
  // All-defects covers everything; every ordinary-pass answer claims completion with nothing reviewed.
  const r = reviewer({ onCall: async call => call.context.instruction ? { response: { completed: true, reviewedFiles: [], findings: [] } } : null });
  const record = await runReviewRound(f.request, { runRole: r.runRole });
  assert.notEqual(record.outcome, 'clean');
  assert.equal(record.outcome, 'not-reviewed'); assert.equal(record.rounds.length, 0, 'never a spent round');
  // The same hole on a change sent whole: a risky round's ordinary pass answers with no files.
  const small = fixture(t, { 'lib/a.mjs': 'export const a = 1;\n' });
  const whole = reviewer({ onCall: async call => call.context.instruction ? { response: { completed: true, reviewedFiles: [], findings: [] } } : null });
  const second = await runReviewRound({ ...small.request, risk: 'risky' }, { runRole: whole.runRole });
  assert.equal(second.outcome, 'not-reviewed'); assert.equal(second.rounds.length, 0);
});

const exists = file => { try { fs.lstatSync(file); return true; } catch { return false; } };
test('MONO-494 review: a saved-groups file or directory replaced by a symlink is never read and counts as touched', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-link-')); t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidenceRoot = path.join(scratch, 'evidence'), pinsFile = path.join(scratch, 'root/dispatch/MONO-9-a1/pins.json');
  fs.mkdirSync(path.dirname(pinsFile), { recursive: true }); fs.writeFileSync(pinsFile, '{}');
  const head = 'a'.repeat(40), base = 'b'.repeat(40), binding = { head, base, contractDigest: digest(contract), pinsFile };
  const store = reviewGroupStore(evidenceRoot, binding);
  store.put('k1', { pass: 'all-defects', group: 'all-defects 1/2', response: { completed: true, reviewedFiles: ['x'], findings: [] } });
  const before = evidenceSnapshot(evidenceRoot, pinsFile);
  const edited = path.join(scratch, 'edited.json'), saved = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  saved.entries.k2 = { pass: 'all-defects', group: 'all-defects 2/2', response: { completed: true, reviewedFiles: ['y'], findings: [] } };
  fs.writeFileSync(edited, JSON.stringify(saved)); fs.rmSync(store.file); fs.symlinkSync(edited, store.file);
  // Read before any settlement: the link is not followed.
  assert.equal(reviewGroupStore(evidenceRoot, binding).get('k2'), undefined, 'a symlinked cache is not read');
  fs.rmSync(store.file, { force: true }); fs.symlinkSync(edited, store.file);
  assert.match(evidenceTouched(before, evidenceRoot, pinsFile) ?? '', /review-groups/, 'a cache that became irregular is touched evidence');
  assert.equal(exists(store.file), false, 'and is discarded');
  // A cache that disappears during the run is touched too.
  reviewGroupStore(evidenceRoot, binding).put('k1', { pass: null, group: null, response: {} });
  const again = evidenceSnapshot(evidenceRoot, pinsFile); fs.rmSync(store.file);
  assert.match(evidenceTouched(again, evidenceRoot, pinsFile) ?? '', /review-groups/);
  // The directory itself replaced by a symlink to a planted copy.
  const plantedDir = path.join(scratch, 'planted'); fs.mkdirSync(plantedDir);
  fs.writeFileSync(path.join(plantedDir, `${head}.json`), JSON.stringify(saved));
  const third = evidenceSnapshot(evidenceRoot, pinsFile);
  fs.rmSync(reviewGroupsDirectory(evidenceRoot), { recursive: true }); fs.symlinkSync(plantedDir, reviewGroupsDirectory(evidenceRoot));
  assert.equal(reviewGroupStore(evidenceRoot, binding).get('k2'), undefined, 'a symlinked directory is not read');
  assert.ok(fs.lstatSync(reviewGroupsDirectory(evidenceRoot)).isDirectory());
  fs.rmSync(reviewGroupsDirectory(evidenceRoot), { recursive: true }); fs.symlinkSync(plantedDir, reviewGroupsDirectory(evidenceRoot));
  assert.match(evidenceTouched(third, evidenceRoot, pinsFile) ?? '', /review-groups/);
  assert.equal(exists(reviewGroupsDirectory(evidenceRoot)), false, 'the linked directory is removed');
});

test('MONO-494 review: a host run of attempt A that edits attempt B\'s saved groups is discarded; B never replays it', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-cross-')); t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidenceRoot = path.join(scratch, 'evidence'), pinsA = path.join(scratch, 'root/dispatch/MONO-1-a1/pins.json'), pinsB = path.join(scratch, 'root/dispatch/MONO-2-a1/pins.json');
  for (const file of [pinsA, pinsB]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}'); }
  const bindingB = { head: 'e'.repeat(40), base: 'b'.repeat(40), contractDigest: digest(contract), pinsFile: pinsB }, rootB = { root: path.join(scratch, 'root'), pins: {} };
  const storeB = reviewGroupStore(evidenceRoot, bindingB, rootB);
  storeB.put('k1', { pass: 'all-defects', group: 'all-defects 1/2', response: { completed: true, reviewedFiles: ['x'], findings: [] } });
  const before = evidenceSnapshot(evidenceRoot, pinsA);
  // A has host verification (its run is open now): B trusts no saved group while such an attempt is in the root.
  fs.writeFileSync(pinsA, JSON.stringify({ hostVerification: true }));
  const saved = JSON.parse(fs.readFileSync(storeB.file, 'utf8'));
  saved.entries.k2 = { pass: 'all-defects', group: 'all-defects 2/2', response: { completed: true, reviewedFiles: ['y'], findings: [] } };
  fs.writeFileSync(storeB.file, JSON.stringify(saved));
  assert.equal(reviewGroupStore(evidenceRoot, bindingB, rootB).get('k2'), undefined, 'no saved group is trusted while an attempt of the root has host verification');
  // A's settlement: B's changed cache is discarded, neither restored nor kept.
  evidenceTouched(before, evidenceRoot, pinsA);
  fs.writeFileSync(pinsA, '{}');
  assert.equal(exists(storeB.file), false);
  const reopened = reviewGroupStore(evidenceRoot, bindingB, rootB);
  assert.equal(reopened.get('k2'), undefined); assert.equal(reopened.size(), 0);
});

test('MONO-494 review: saved groups are neither written nor read when this attempt or any attempt of the root has host verification', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-hostv-')); t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'root'), evidenceRoot = path.join(scratch, 'evidence');
  const pinsAt = (key, pins) => { const file = path.join(root, `dispatch/${key}-a1/pins.json`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(pins)); return file; };
  fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'workers.json'), '{}');
  const answer = { pass: 'all-defects', group: 'all-defects 1/2', response: { completed: true, reviewedFiles: ['x'], findings: [] } };
  const binding = pinsFile => ({ head: 'a'.repeat(40), base: 'b'.repeat(40), contractDigest: digest(contract), pinsFile });

  // Off everywhere: reuse works.
  const own = pinsAt('MONO-1', { risk: 'standard' }), plain = { root, pins: { risk: 'standard' } };
  reviewGroupStore(evidenceRoot, binding(own), plain).put('k1', answer);
  assert.deepEqual(reviewGroupStore(evidenceRoot, binding(own), plain).get('k1'), answer);

  // This attempt has host verification: nothing is read, nothing is written.
  const ownHost = { root, pins: { risk: 'standard', hostVerification: true } };
  assert.equal(reviewGroupStore(evidenceRoot, binding(own), ownHost).get('k1'), undefined);
  const head2 = { ...binding(null), head: 'c'.repeat(40) };
  reviewGroupStore(evidenceRoot, head2, ownHost).put('k2', answer);
  assert.equal(exists(path.join(reviewGroupsDirectory(evidenceRoot), `${'c'.repeat(40)}.json`)), false, 'no file is written');

  // Another attempt of the root gets host verification after the file was saved: the saved answer is not trusted any more,
  // re-checked right before the read even on a store opened earlier.
  const opened = reviewGroupStore(evidenceRoot, binding(own), plain);
  pinsAt('MONO-2', { risk: 'standard', hostVerification: true });
  assert.equal(opened.get('k1'), undefined, 'checked again right before use');
  assert.equal(reviewGroupStore(evidenceRoot, binding(own), plain).get('k1'), undefined);
  opened.put('k3', answer);
  assert.equal(JSON.parse(fs.readFileSync(path.join(reviewGroupsDirectory(evidenceRoot), `${'a'.repeat(40)}.json`), 'utf8')).entries.k3, undefined, 'nothing new is saved');
  fs.rmSync(path.join(root, 'dispatch/MONO-2-a1'), { recursive: true });

  // A registered attempt whose pins file lives elsewhere counts too.
  const outside = path.join(scratch, 'elsewhere/pins.json'); fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, JSON.stringify({ hostVerification: true }));
  fs.writeFileSync(path.join(root, 'workers.json'), JSON.stringify({ 'MONO-3': { issue: 'MONO-3', attempt: 1, pins: { file: outside, digest: 'x' } } }));
  assert.equal(reviewGroupStore(evidenceRoot, binding(own), plain).get('k1'), undefined);
  fs.writeFileSync(path.join(root, 'workers.json'), '{}');
  assert.deepEqual(reviewGroupStore(evidenceRoot, binding(own), plain).get('k1'), answer, 'reuse is back once no attempt has it');
});

test('MONO-494 review: a round under host verification reviews every group every time', async t => {
  const files = largeChange(30), f = fixture(t, files);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-groups-hostv-round-')); t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'root'), evidenceRoot = path.join(scratch, 'evidence');
  fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'workers.json'), '{}');
  const open = () => reviewGroupStore(evidenceRoot, { head: f.request.head, base: f.base, contractDigest: digest(contract), pinsFile: null }, { root, pins: { hostVerification: true } });
  const failing = reviewer({ onCall: async call => { if (labelOf(call.context) === 'all-defects 2/2') throw Object.assign(new Error('role failed (1); no response admitted'), { processFailure: true }); return null; } });
  assert.equal((await runReviewRound(f.request, { runRole: failing.runRole, groupStore: open() })).outcome, 'not-reviewed');
  const r = reviewer();
  const record = await runReviewRound(f.request, { runRole: r.runRole, groupStore: open() });
  assert.equal(record.outcome, 'clean'); assert.equal(record.round.reusedGroups, undefined);
  assert.ok(r.calls.some(call => labelOf(call.context) === 'all-defects 1/2'), 'the finished group runs again');
});
