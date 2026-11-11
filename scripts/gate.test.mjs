import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateShip, validatePreflight, advanceEvidence, botRemarkDigest, reviewHistory, roundOutcome } from "./gate.mjs";
import { REVIEW_PRODUCER, digest } from "./runtime.mjs";
import { installReviewClis, setReview, reviewCalls, reviewFinding, reviewVerdict } from "./test-fixtures/review-clis.mjs";
import { ideaDispatchFixture } from './fixtures/idea-dispatch.mjs';
import { ideaBinding } from './orchestrator/command-state.mjs';
import { checkIdea } from './idea-gate.mjs';

const head = "a".repeat(40);
const sample = () => ({ head, state: "OPEN", mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", viewer: "worker",
  checks: [ { __typename: "CheckRun", name: "validate", status: "COMPLETED", conclusion: "SUCCESS", head },
    { __typename: "StatusContext", context: "Devin Review", state: "SUCCESS", head },
    { __typename: "CheckRun", name: "Greptile Review", status: "COMPLETED", conclusion: "SUCCESS", head } ],
  reviews: [], threads: [], botComments: [] });
const judgment = () => ({ head, preShipReview: "выполнено", readinessCheck: "пройдена", documentation: "без изменений", closures: [], botRemarks: [] });
test("outstanding requested changes block without inline threads or branch protection", () => {
  const s = sample();
  s.reviews = [{ id: 1, state: "CHANGES_REQUESTED", user: { login: "reviewer" }, commit_id: "old-head" }];
  assert.throws(() => evaluateShip(s, judgment()), /outstanding changes requested/);
  s.reviews.push({ id: 2, state: "COMMENTED", user: { login: "reviewer" } });
  assert.throws(() => evaluateShip(s, judgment()), /outstanding changes requested/);
  s.reviews.push({ id: 3, state: "APPROVED", user: { login: "other" } });
  assert.throws(() => evaluateShip(s, judgment()), /outstanding changes requested/);
  s.reviews.unshift({ id: 4, state: "APPROVED", user: { login: "reviewer" } });
  assert.doesNotThrow(() => evaluateShip(s, judgment()));
  s.reviews = [{ id: 1, state: "DISMISSED", user: { login: "reviewer" } }];
  assert.doesNotThrow(() => evaluateShip(s, judgment()));
  s.reviews = [
    { id: 1, state: "CHANGES_REQUESTED", user: { login: "reviewer" }, submitted_at: "2026-09-15T01:00:00Z" },
    { id: 2, state: "APPROVED", user: { login: "reviewer" }, submitted_at: "2026-09-15T00:00:00Z" },
  ];
  assert.throws(() => evaluateShip(s, judgment()), /outstanding changes requested/, "a draft created earlier can be submitted later");
});
test("ship requires every existing green condition and per-field judgment", () => {
  assert.equal(evaluateShip(sample(), judgment()), "all ship conditions satisfied");
  const failures = [
    ["empty checks", s => s.checks = []], ["red CI", s => s.checks[0].conclusion = "FAILURE"],
    ["old bot", s => s.checks[2].head = "b".repeat(40)], ["unresolved thread", s => s.threads = [{ id: "T", isResolved: false }]],
    ["unpublished reply", s => s.threads = [{ id: "T", isResolved: true, comments: [] }]],
    ["outside remark", s => s.botComments = [{ id: "C", body: "fix this" }]],
    ["pending own review", s => s.reviews = [{ state: "PENDING", user: { login: "worker" } }]],
    ["unknown merge", s => s.mergeStateStatus = "UNKNOWN"], ["closed PR", s => s.state = "CLOSED"],
    ["bot pending", s => s.checks[2].status = "IN_PROGRESS"],
    ["required check not created", s => s.requiredChecks = ["delayed-required-check"]],
  ];
  for (const [name, mutate] of failures) { const s = sample(); mutate(s); assert.throws(() => evaluateShip(s, judgment()), undefined, name); }
  for (const field of ["preShipReview", "readinessCheck", "documentation"]) {
    for (const value of [undefined, "not configured", "skipped"]) { const j = judgment(); j[field] = value; assert.throws(() => evaluateShip(sample(), j), undefined, field); }
  }
  const s = sample(), j = judgment();
  s.threads = [{ id: "T", isResolved: true, comments: [{ id: "R", author: { login: "worker" }, body: "Fixed in commit", publishedAt: "2026-09-14T00:00:00Z", pullRequestReview: { state: "COMMENTED" } }] }];
  j.closures = [{ threadId: "T", replyId: "R" }];
  const reply = s.threads[0].comments[0];
  s.threads[0].comments.unshift({ ...reply, id: "F", body: "original finding", author: { login: "reviewer" } });
  assert.throws(() => evaluateShip(s, { ...j, closures: [{ threadId: "T", replyId: "F" }] }), /closure reply .* not published/);
  s.botComments = [{ id: "C", body: "fix this" }]; j.botRemarks = [{ id: "C", commentDigest: botRemarkDigest(s.botComments[0]), outcome: "fixed", evidence: "commit" }];
  assert.doesNotThrow(() => evaluateShip(s, j));
  s.botComments[0].body = "new uninspected remarks";
  assert.throws(() => evaluateShip(s, j), /changed since disposition/);
  j.botRemarks[0].commentDigest = botRemarkDigest(s.botComments[0]);
  assert.doesNotThrow(() => evaluateShip(s, j));
  reply.author.login = "human-reviewer";
  assert.doesNotThrow(() => evaluateShip(s, j));
  reply.pullRequestReview.state = "PENDING";
  assert.throws(() => evaluateShip(s, j), /closure reply .* not published/);
  reply.pullRequestReview.state = "COMMENTED";
  for (const conclusion of ["SKIPPED", "NEUTRAL"]) {
    const ci = sample(); ci.checks[0].conclusion = conclusion; ci.requiredChecks = ["validate"];
    assert.doesNotThrow(() => evaluateShip(ci, judgment()));
    ci.checks[2].conclusion = conclusion;
    assert.throws(() => evaluateShip(ci, judgment()), /bot .* not completed/);
  }
  const unstable = sample(); unstable.mergeStateStatus = "UNSTABLE";
  assert.throws(() => evaluateShip(unstable, judgment()), /merge state is not clean/);
  const required = sample(); required.requiredChecks = ["validate"]; required.checks[0].conclusion = "FAILURE";
  assert.throws(() => evaluateShip(required, judgment(), { nonBlockingChecks: [{ name: "validate", reason: "not allowed to override GitHub requirements" }] }), /required check/);
});
test("UNSTABLE permits only accepted terminal failures and waits for pending checks", () => {
  const policy = { nonBlockingChecks: [{ name: "optional", reason: "repository policy accepts this check as advisory" }] };
  for (const red of [
    { __typename: "CheckRun", name: "optional", status: "COMPLETED", conclusion: "FAILURE", head },
    { __typename: "StatusContext", context: "optional", state: "ERROR", head },
  ]) {
    const s = sample(); s.mergeStateStatus = "UNSTABLE"; s.checks.push(red);
    assert.equal(evaluateShip(s, judgment(), policy), "all ship conditions satisfied");
    assert.throws(() => evaluateShip(s, judgment()), /check optional not green or accepted non-blocking/);
    assert.throws(() => evaluateShip(s, judgment(), { nonBlockingChecks: [{ name: "optional", reason: " " }] }), /check optional not green/);
    s.requiredChecks = ["optional"];
    assert.throws(() => evaluateShip(s, judgment(), policy), /required check optional not successful/);
    delete s.requiredChecks;
    for (const state of ["BLOCKED", "DIRTY", "BEHIND", "DRAFT", "HAS_HOOKS"]) {
      s.mergeStateStatus = state;
      assert.throws(() => evaluateShip(s, judgment(), policy), error => error.constructor.name !== "ShipPending" && /merge state is not clean/.test(error.message));
    }
    s.mergeStateStatus = "UNSTABLE"; s.checks[0].status = "IN_PROGRESS"; s.checks[0].conclusion = null;
    assert.throws(() => evaluateShip(s, judgment(), policy), error => error.constructor.name === "ShipPending");
    s.mergeable = "UNKNOWN";
    assert.throws(() => evaluateShip(s, judgment(), policy), error => error.constructor.name === "ShipPending");
  }
});
test("pending checks defer transient merge states but never terminal failures", () => {
  const isPending = error => error.constructor.name === "ShipPending";
  const isTerminal = error => !isPending(error);
  for (const state of ["BLOCKED", "UNKNOWN"]) {
    for (const status of ["QUEUED", "IN_PROGRESS", "missing", "empty"]) {
      const s = sample(); s.requiredChecks = ["validate"]; s.mergeStateStatus = state;
      s.mergeable = state === "UNKNOWN" ? "UNKNOWN" : "MERGEABLE";
      if (status === "empty") s.checks = [];
      else if (status === "missing") s.checks.shift();
      else { s.checks[0].status = status; s.checks[0].conclusion = null; }
      assert.throws(() => evaluateShip(s, judgment()), isPending);
    }
    const complete = sample(); complete.mergeStateStatus = state;
    assert.throws(() => evaluateShip(complete, judgment()), state === "UNKNOWN" ? isPending : isTerminal);
  }
  for (const unknown of [{ mergeable: "UNKNOWN" }, { mergeStateStatus: "UNKNOWN" }, { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }]) {
    const s = { ...sample(), ...unknown };
    assert.throws(() => evaluateShip(s, judgment()), error => isPending(error) && /mergeability pending/.test(error.message));
    s.checks[0].conclusion = "FAILURE";
    assert.throws(() => evaluateShip(s, judgment()), isTerminal);
  }
  for (const state of ["DIRTY", "BEHIND", "DRAFT", "HAS_HOOKS"]) {
    const s = sample(); s.mergeStateStatus = state; s.mergeable = "UNKNOWN"; s.checks[0].status = "IN_PROGRESS";
    assert.throws(() => evaluateShip(s, judgment()), isTerminal);
  }
  const red = sample(); red.mergeStateStatus = "BLOCKED"; red.checks[0].conclusion = "FAILURE"; red.checks[2].status = "IN_PROGRESS";
  assert.throws(() => evaluateShip(red, judgment()), error => isTerminal(error) && /check validate not green/.test(error.message));
  red.state = "CLOSED";
  assert.throws(() => evaluateShip(red, judgment()), error => isTerminal(error) && /PR is not open/.test(error.message));
});
test("head changes reset evidence; new events reset quiet time; deadline survives", () => {
  const s = sample();
  let state = advanceEvidence(null, s, 1000);
  assert.equal(advanceEvidence(state, s, 2000).lastEventAt, 1000);
  s.head = "b".repeat(40); state = advanceEvidence(state, s, 3000);
  assert.equal(state.lastEventAt, 3000); assert.equal(state.startedAt, 1000);
  s.reviews.push({ id: 1 }); assert.equal(advanceEvidence(state, s, 4000).lastEventAt, 4000);
});
const reviewed = (extra = {}) => ({ key: 'k1', weight: 'P2', file: 'a.mjs', line: 3, title: 'Leftover', status: 'confirmed', outcome: 'confirmed', danger: false, origin: 'introduced', outOfContract: false, riskRaised: false, ...extra });
test("review outcome mapping: what leaves the rounds as a successor candidate", () => {
  const record = (outcome, findings = []) => ({ outcome, findings });
  const minor = (extra = {}) => reviewed({ weight: 'P3', danger: true, dangerCase: 'silent-result', ...extra });
  for (const [name, input, last, expected] of [
    ['clean stays clean', record('clean'), 3, 'clean'],
    ['a clean round lists its older harmless defects', record('clean', [reviewed({ origin: 'pre-existing' })]), 1, 'clean-with-successors'],
    ['open findings before the last round', record('not-converged', [reviewed()]), 2, 'not-converged'],
    ['harmless leftovers on the last round', record('not-converged', [reviewed(), reviewed({ key: 'k2', status: 'closed' })]), 3, 'clean-with-successors'],
    ['dangerous', record('not-converged', [reviewed({ danger: true })]), 3, 'not-converged'],
    ['unresolved', record('not-converged', [reviewed({ outcome: 'unresolved', status: 'unresolved' })]), 3, 'not-converged'],
    ['out of contract', record('not-converged', [reviewed({ outOfContract: true })]), 3, 'not-converged'],
    ['risk raised on a closed finding', record('not-converged', [reviewed(), reviewed({ key: 'k2', status: 'closed', riskRaised: true })]), 3, 'not-converged'],
    ['nothing left open', record('not-converged', [reviewed({ status: 'closed', outOfContract: true })]), 3, 'not-converged'],
    ['not reviewed', record('not-reviewed', [reviewed()]), 3, 'not-reviewed'],
    ['minor leftovers are fixed in round one', record('not-converged', [minor()]), 1, 'not-converged'],
    ['minor leftovers pass from round two, dangerous or unresolved', record('not-converged', [minor({ outcome: 'unresolved', status: 'unresolved', dangerCase: 'unknown' })]), 2, 'clean-with-successors'],
    ['a minor leftover about data never passes', record('not-converged', [minor({ dangerCase: 'data' })]), 3, 'not-converged'],
    ['a minor leftover about a gate bypass never passes', record('not-converged', [minor({ dangerCase: 'gate-bypass' })]), 2, 'not-converged'],
    ['a minor leftover does not carry a serious one', record('not-converged', [minor(), reviewed({ key: 'k2', danger: true })]), 2, 'not-converged'],
    ['an older dangerous defect is a successor in any round', record('not-converged', [reviewed({ origin: 'pre-existing', danger: true, dangerCase: 'data' })]), 1, 'clean-with-successors'],
    ['an older unresolved defect still blocks', record('not-converged', [reviewed({ origin: 'pre-existing', outcome: 'unresolved', status: 'unresolved' })]), 3, 'not-converged'],
  ]) {
    const result = roundOutcome(input, last);
    assert.equal(result.outcome, expected, name);
    assert.deepEqual(result.successors.map(item => item.key), expected === 'clean-with-successors' ? ['k1'] : [], name);
  }
});
test("review refusal and successor lines: an older dangerous defect must be filed, a long list stays readable by the collector", () => {
  const older = roundOutcome({ outcome: 'not-converged', findings: [reviewed({ origin: 'pre-existing', danger: true, dangerCase: 'data' })] }, 1);
  assert.deepEqual(older.successors.map(item => item.line), ['must-file P2 a.mjs:3 Leftover']);
  assert.equal(roundOutcome({ outcome: 'clean', findings: [reviewed({ origin: 'pre-existing' })] }, 1).successors[0].line, 'P2 a.mjs:3 Leftover');
  assert.equal(roundOutcome({ outcome: 'not-converged', findings: [reviewed({ origin: 'pre-existing', weight: 'P3', danger: true, dangerCase: 'silent-result' })] }, 1).successors[0].line, 'P3 a.mjs:3 Leftover', 'a minor older defect is a candidate');
  const many = Array.from({ length: 200 }, (_, index) => reviewed({ key: `k${index}`, trigger: 't'.repeat(300), reason: 'r'.repeat(400) }));
  const head = "a".repeat(40), base = "b".repeat(40);
  const receipt = { producer: REVIEW_PRODUCER, head, base, consistency: { passed: true, error: null }, verification: { exitCode: null },
    review: { outcome: 'not-converged', round: 1, successors: [], record: { findings: many } } };
  assert.throws(() => validatePreflight(receipt, head, base), error => error.message.length < 48000 && /^review not-converged \(round 1 of 3\); fix and request the next round; 200 open: /.test(error.message) && / more in the next round$/.test(error.message));
});
test("review rounds are counted per pins file from signed history", () => {
  const pins = { file: '/root/dispatch/MONO-1-a1/pins.json', digest: 'd' }, base = 'b'.repeat(40), contractDigest = 'c'.repeat(64);
  const heads = ['1', '2', '3', '4'].map(digit => digit.repeat(40));
  let clock = 0;
  const receipt = (at, outcome, extra = {}) => ({ producer: REVIEW_PRODUCER, recordedAt: new Date(Date.UTC(2026, 10, 10, 0, clock++)).toISOString(), runId: `run-${clock}`, pins, head: at, base,
    ...extra, review: { outcome, spent: !['not-reviewed', 'refused'].includes(outcome), contractDigest, record: { run: clock }, ...extra.review } });
  const read = (receipts, at = heads[0], other = {}) => reviewHistory(receipts, { pins, head: at, base, contractDigest, ...other });
  assert.deepEqual(read([]), { spent: 0, notReviewed: 0, reuse: null, record: null });
  const three = [receipt(heads[0], 'not-converged'), receipt(heads[1], 'not-converged'), receipt(heads[2], 'clean-with-successors')];
  assert.equal(read(three, heads[3]).spent, 3, 'a fourth head finds the limit spent');
  assert.equal(read(three, heads[3]).reuse, null);
  assert.equal(read(three, heads[2]).reuse, three[2], 'the same head reuses its stored round');
  assert.deepEqual(read(three, heads[3]).record, three[2].review.record, 'the next round continues the latest record');
  const reused = receipt(heads[0], 'not-converged', { review: { spent: false, reusedFrom: 'run-1' } });
  assert.equal(read([three[0], reused]).spent, 1, 'a reused round spends nothing');
  const failed = [receipt(heads[0], 'not-reviewed'), receipt(heads[1], 'not-reviewed'), receipt(heads[0], 'not-reviewed')];
  assert.deepEqual([read(failed).spent, read(failed).notReviewed, read(failed, heads[1]).notReviewed], [0, 2, 1], 'not-reviewed spends nothing and counts in a row per head');
  assert.equal(read([...failed, receipt(heads[0], 'clean')]).notReviewed, 0);
  assert.equal(read([...failed, receipt(heads[0], 'refused')]).notReviewed, 2, 'a refusal is not a review attempt');
  const amended = { file: '/root/dispatch/MONO-1-a1/pins.v1.json', digest: 'e' };
  assert.deepEqual(reviewHistory(three, { pins: amended, head: heads[2], base, contractDigest }), { spent: 0, notReviewed: 0, reuse: null, record: null }, 'a new pins version opens a fresh three');
  for (const changed of [{ base: 'e'.repeat(40) }, { contractDigest: 'f'.repeat(64) }])
    assert.deepEqual(read(three.slice(0, 2), heads[1], changed), { spent: 2, notReviewed: 0, reuse: null, record: null }, 'a new base or contract starts a fresh record and keeps the count');
  const foreign = [{ ...three[0], producer: 'gate-autoreview-v2' }, { ...three[1], pins: { file: '/root/dispatch/MONO-2-a1/pins.json', digest: 'd' } }, { producer: REVIEW_PRODUCER, pins }, null];
  assert.equal(read(foreign).spent, 0, 'old receipts and other tasks are never counted');
});
test("preflight accepts only a v3 receipt with an accepted review, exact head/base and proven verification", () => {
  const base = "b".repeat(40);
  const receipt = (extra = {}) => ({ producer: REVIEW_PRODUCER, head, base, consistency: { passed: true, error: null },
    verification: { exitCode: 0, sandbox: { mode: "workspace-write", probed: true } }, ...extra,
    review: { outcome: 'clean', round: 1, successors: [], record: { findings: [reviewed()] }, ...extra.review } });
  assert.match(validatePreflight(receipt(), head, base), /^review clean \(round 1 of 3\) and verification verified on head$/);
  assert.match(validatePreflight(receipt({ review: { outcome: 'clean-with-successors', round: 3, successors: [{ key: 'k1', line: 'P2 a.mjs:3 Leftover' }] } }), head, base),
    /^review clean-with-successors \(round 3 of 3\).*successor candidates: P2 a\.mjs:3 Leftover$/);
  assert.throws(() => validatePreflight(null, head, base), /old receipt format/u);
  for (const [extra, refusal] of [
    [{ producer: 'gate-autoreview-v2' }, /old receipt format/],
    [{ head: "c".repeat(40) }, /stale review receipt/], [{ base: "c".repeat(40) }, /stale review receipt/],
    [{ review: { outcome: 'not-converged' } }, /^review not-converged \(round 1 of 3\); fix and request the next round; 1 open: P2 a\.mjs:3 Leftover \(when: /],
    [{ review: { outcome: 'not-converged', round: 3 } }, /^needs-decision: review not-converged after round 3 of 3; 1 open/],
    [{ review: { outcome: 'not-reviewed', round: null, reason: 'role failed' } }, /^not-reviewed: role failed; no round spent, request this head once more$/],
    [{ review: { outcome: 'not-reviewed', round: null, reason: 'role failed', repeated: true } }, /^blocked: not-reviewed twice in a row on this head: role failed$/],
    [{ review: { outcome: 'refused', round: null, reason: 'needs-decision: review round limit reached' } }, /^needs-decision: review round limit reached$/],
    [{ verification: { exitCode: 1, sandbox: { mode: "workspace-write", probed: true } } }, /^needs-decision: verification failed/],
    [{ verification: { exitCode: null } }, /^needs-decision: verification failed/],
    [{ verification: { exitCode: 0, sandbox: { mode: "workspace-write", probed: false } } }, /sandbox proof missing/],
    [{ consistency: { passed: false, error: 'head or base changed during verification' } }, /consistency failed or missing: head or base changed/],
  ]) assert.throws(() => validatePreflight(receipt(extra), head, base), { message: refusal });
});

test("stream retention preserves validation lines and usage beyond the diagnostic tail", async () => {
  const gate = await import('./gate.mjs');
  assert.equal(typeof gate.captureOutput, 'function');
  const capture = gate.captureOutput({ tailBytes: 64 });
  const header = 'autoreview target: branch\nengine: claude\nmodel: policy-model\nthinking: high\n';
  for (const part of [header.slice(0, 15), header.slice(15), 'noise\n'.repeat(10000),
    'claude usage: input_tokens=10 cache_read_input_tokens=20 cache_creation_input_tokens=30 output_tokens=4 cost_usd=0.100000\n',
    'autoreview scoped-clean: no accepted/actionable findings in the selected Git scope and priority\noverall: patch is correct (0.9)\n']) capture.write(part);
  const result = capture.finish();
  assert.ok(result.output.includes(header));
  assert.ok(result.output.includes('claude usage: input_tokens=10 cache_read_input_tokens=20'));
  assert.ok(result.output.length < 2000);
});

test("dataset archives reuse identical bytes and refuse an explicit version overwrite", async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { archiveReviewDataset } = await import('./gate.mjs');
  assert.equal(typeof archiveReviewDataset,'function');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-dataset-'));
  try {
    const source=path.join(root,'datasets/MONO-998-review-scope.md'); fs.mkdirSync(path.dirname(source)); fs.writeFileSync(source,'first');
    const a=await archiveReviewDataset(source,root); assert.equal(a.version,1);
    assert.equal(fs.readFileSync(a.archive,'utf8'),'first'); assert.equal(fs.readFileSync(a.archive+'.sha256','utf8').trim(),a.digest);
    assert.deepEqual(await archiveReviewDataset(source,root),a);
    fs.writeFileSync(source,'second'); const b=await archiveReviewDataset(source,root); assert.equal(b.version,2);
    fs.writeFileSync(b.archive,'tampered'); await assert.rejects(archiveReviewDataset(source,root),/immutable|digest/);
    assert.equal(fs.readFileSync(a.archive,'utf8'),'first');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('oversized diagnostic lines do not invalidate complete review evidence', async () => {
  const {captureOutput}=await import('./gate.mjs');
  const capture=captureOutput({tailBytes:64});
  capture.write('diagnostic: '+ 'x'.repeat(2*1024*1024));capture.write('\n');
  capture.write('autoreview target: branch\nengine: claude\nmodel: policy-model\nthinking: high\nautoreview clean: no accepted/actionable findings reported\noverall: patch is correct (0.9)\n');
  const result=capture.finish();assert.equal(result.retentionError,null);assert.ok(result.diagnosticTail.length<=64);
  const consumed=captureOutput();consumed.write('model: '+'x'.repeat(2*1024*1024)+'\n');assert.ok(consumed.finish().retentionError);
});

test('the collection lock remains held until its asynchronous action settles', async () => {
  const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
  const {withLock}=await import('./runtime.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-async-lock-')),file=path.join(root,'collection.lock');
  let release;const barrier=new Promise(resolve=>{release=resolve;});
  try {
    const running=withLock(file,async()=>{await barrier;return 'done';});
    assert.equal(fs.existsSync(file),true);
    await assert.rejects(withLock(file,()=>{throw new Error('second action must not run');}),error=>error.code==='ELOCKED');
    release();assert.equal(await running,'done');assert.equal(fs.existsSync(file),false);
  }finally{release();fs.rmSync(root,{recursive:true,force:true});}
});

test('streamed commands receive EOF on stdin instead of hanging the collection', async () => {
  const {runCaptured}=await import('./gate.mjs');
  const result=await runCaptured(process.execPath,['-e',"const timer=setTimeout(()=>process.exit(9),500);process.stdin.resume();process.stdin.on('end',()=>{clearTimeout(timer);process.exit(0)});"],process.cwd());
  assert.equal(result.exitCode,0);
});

test('streamed JSON quoting helper syntax does not become helper evidence', async () => {
  const {captureOutput}=await import('./gate.mjs');
  const capture=captureOutput({tailBytes:64});
  const header='autoreview target: branch | engine: claude | model: policy-model | thinking: high';
  capture.write(header+'\n');
  capture.write(JSON.stringify({tool_result:header+'; review passes: 999'})+'\n');
  capture.write(JSON.stringify({tool_result:'x'.repeat(2*1024*1024)+' | engine: quoted'})+'\n');
  capture.write('bundle: 42 bytes; review passes: 1\nautoreview clean: no accepted/actionable findings reported\noverall: patch is correct (0.9)\n');
  const result=capture.finish();
  assert.equal(result.retentionError,null);
  assert.equal((result.output.match(/review passes:/g)||[]).length,1);
});

test("dataset archive recovers a missing digest only for identical source bytes", async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { archiveReviewDataset } = await import('./gate.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-dataset-recovery-'));
  try {
    const source = path.join(root, 'MONO-998-review-scope.md');
    const archive = path.join(root, 'datasets', 'MONO-998-review-scope.v1.md');
    fs.mkdirSync(path.dirname(archive)); fs.writeFileSync(source, 'complete dataset'); fs.writeFileSync(archive, 'complete dataset');
    const result = await archiveReviewDataset(source, root);
    assert.equal(result.version, 1); assert.equal(fs.readFileSync(archive + '.sha256', 'utf8').trim(), result.digest);
    assert.equal(fs.readFileSync(archive, 'utf8'), 'complete dataset');
    fs.unlinkSync(archive + '.sha256'); fs.writeFileSync(source, 'different dataset');
    await assert.rejects(archiveReviewDataset(source, root), /orphan|digest/);
    assert.equal(fs.existsSync(archive + '.sha256'), false);
    assert.equal(fs.readFileSync(archive, 'utf8'), 'complete dataset');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('review environment is built from the route', async () => {
  const { reviewEnvironment } = await import('./gate.mjs');
  assert.equal(typeof reviewEnvironment, 'function');
  const secret = String(Math.random());
  const ambient = { PATH: '/bin', HOME: '/fixture', REVIEW_CREDENTIAL: secret,
    ANTHROPIC_AUTH_TOKEN: 'external', ANTHROPIC_BASE_URL: 'https://external.invalid',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'external', OPENAI_API_KEY: 'external', XAI_API_KEY: 'external',
    KIMI_BASE_URL: 'https://external.invalid', AWS_PROFILE: 'external', GOOGLE_APPLICATION_CREDENTIALS: '/external',
    AUTOREVIEW_FALLBACK_MODEL: 'external', CLAUDE_CODE_USE_BEDROCK: '1' };
  for (const [engine, id, target, endpointKey, effort] of [
    ['claude', 'example', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'high'],
    ['kimi', 'moonshot', 'KIMI_API_KEY', 'KIMI_BASE_URL', 'on'],
    ['pi', 'openai', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'high'],
    ['codex', 'openai', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'high'],
  ]) {
    const route = {engine,model:'example',effort,provider:{id,endpoint:'https://route.invalid/v1'},credentialEnv:'REVIEW_CREDENTIAL',fingerprint:'f'.repeat(64)};
    const env = reviewEnvironment(route, ambient);
    assert.equal(env[target], secret); assert.equal(env[endpointKey], route.provider.endpoint);
    assert.equal(env.REVIEW_CREDENTIAL, undefined);
    for (const key of Object.keys(ambient).filter(key=>!['PATH','HOME',target,endpointKey].includes(key))) assert.equal(env[key],undefined,key);
    assert.throws(()=>reviewEnvironment(route,{}),/credential.*REVIEW_CREDENTIAL/i);
  }
});

test("named collection fixtures through the gate CLI", async t => {
  const fs = await import("node:fs"), path = await import("node:path"), os = await import("node:os"), crypto = await import("node:crypto");
  const { spawnSync } = await import("node:child_process");
  const { atomicJson, canonical, digest, resolvedLocation } = await import("./runtime.mjs");
  const { sha256File } = await import("./orchestrator/command-state.mjs");
  const files = fs.readdirSync("scripts/fixtures").filter(name => /^(collection-u13|collection-idea|collector-temp|collection-verify|collection-review)-.*\.json$/u.test(name));
  for (const name of files) await t.test(name, async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join("scripts/fixtures", name), "utf8"));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-u13-cli-"));
    try {
      const repo = path.join(scratch, "repo"), root = path.join(scratch, "orchestrator"), evidence = path.join(scratch, "evidence"), skills = path.join(scratch, "skills"), bin = path.join(scratch, "bin"), darwinTemp = path.join(scratch, "darwin-temp");
      for (const dir of [repo, root, evidence, skills, bin, darwinTemp]) fs.mkdirSync(dir);
      const sandboxLog = path.join(scratch, "sandbox.log"), getconfLog = path.join(scratch, "getconf.log");
      const env = { ...process.env, HOME: path.join(scratch, "home"), PATH: `${bin}:${process.env.PATH}`, MONO_FIXTURE_DARWIN_TEMP: darwinTemp,
        MONO_FIXTURE_SANDBOX_LOG: sandboxLog, MONO_FIXTURE_GETCONF_LOG: getconfLog };
      const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
      // All portable collectors, including U13, use a disjoint controlled root.
      const getconf = path.join(bin, "getconf");
      write(getconf, `#!/usr/bin/env node
if(process.argv[2]!=='DARWIN_USER_TEMP_DIR')process.exit(72);
require('node:fs').appendFileSync(process.env.MONO_FIXTURE_GETCONF_LOG,'getconf\\n');
if(${JSON.stringify(fixture.unavailable)}==='command-failed')process.exit(1);
console.log(process.env.MONO_FIXTURE_DARWIN_TEMP);
`); fs.chmodSync(getconf, 0o700);
      const preload = path.join(scratch, "platform.cjs");
      if (fixture.platform) write(preload, `Object.defineProperty(process,'platform',{value:${JSON.stringify(fixture.platform)}});`);
      const git = (...args) => { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
      write(path.join(repo, ".gitignore"), ".orchestrator/\n");
      git("init", "-b", "delivery"); git("add", ".gitignore"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
      const head = git("rev-parse", "HEAD"), dataset = path.join(evidence, "datasets/fixture.md");
      write(dataset, "Approved U13 decisions.\n");
      for (const policy of ["model-policy.md", "autoreview-routing.md"]) write(path.join(skills, "references", policy), fs.readFileSync(path.join("references", policy), "utf8"));
      let pack = null;
      if (fixture.protected === "packRoot") {
        pack = path.join(scratch, "pack"); fs.mkdirSync(pack);
        fs.cpSync(path.join(skills, "references"), path.join(pack, "references"), { recursive: true });
      }
      const protectedPaths = { evidenceRoot: evidence, "orchestrator root": root, skillsRoot: skills,
        packRoot: pack ?? skills };
      if (fixture.protected) {
        const target = protectedPaths[fixture.protected];
        env.MONO_FIXTURE_DARWIN_TEMP = fixture.relationship === "contains" ? path.dirname(target)
          : fixture.relationship === "inside" ? path.join(target, "darwin-temp") : target;
        if (fixture.relationship === "inside") fs.mkdirSync(env.MONO_FIXTURE_DARWIN_TEMP);
      }
      if (fixture.darwinSymlink) {
        const link = path.join(scratch, "darwin-link"); fs.symlinkSync(darwinTemp, link);
        env.MONO_FIXTURE_DARWIN_TEMP = link;
      }
      if (fixture.unavailable === "empty") env.MONO_FIXTURE_DARWIN_TEMP = "";
      if (fixture.unavailable === "missing-path") env.MONO_FIXTURE_DARWIN_TEMP = path.join(scratch, "absent");
      if (fixture.unavailable === "relative") env.MONO_FIXTURE_DARWIN_TEMP = "relative-temp";
      if (fixture.privateInsideDarwin) Object.assign(env, { TMPDIR: darwinTemp, TMP: darwinTemp, TEMP: darwinTemp });
      const boundary = path.join(scratch, "boundary.cjs");
      write(boundary, `
const fs=require('node:fs'),path=require('node:path'),write=fs.writeFileSync;
const grants=JSON.parse(process.env.MONO_FIXTURE_GRANTS);
fs.writeFileSync=function(file,...args){
  const target=path.join(fs.realpathSync(path.dirname(path.resolve(file))),path.basename(file));
  if(!grants.some(root=>target===root||target.startsWith(root+path.sep))){const e=new Error('fixture write grant denial');e.code='EPERM';throw e;}
  return write.call(this,file,...args);
};
`);
      // Model the outside collector launcher; the actual gate still runs the review
      // roles (fake CLIs), the write-denial probe, verification, signing and history writes.
      installReviewClis(bin, { codexStub: `
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),a=process.argv.slice(2);
const command=a.slice(a.indexOf('--')+1),p=JSON.parse(command.at(-1));
fs.appendFileSync(process.env.MONO_FIXTURE_SANDBOX_LOG,'sandbox\\n');
if(${JSON.stringify(fixture.sandboxFailure)})process.exit(73);
const protectedRoot=path.dirname(p.probe);fs.chmodSync(protectedRoot,0o500);let r;
const profile=a[a.indexOf('-c')+1],grants=[...profile.matchAll(/("(?:\\\\.|[^"\\\\])*")="write"/g)].map(m=>JSON.parse(m[1]));
const env={...process.env,MONO_FIXTURE_GRANTS:JSON.stringify(grants),NODE_OPTIONS:'--require '+JSON.stringify(${JSON.stringify(boundary)})};
try{r=cp.spawnSync(command[0],command.slice(1),{stdio:'inherit',env});}finally{fs.chmodSync(protectedRoot,0o700);}
process.exit(r.status===null?1:r.status);` });
      const pinsFile = path.join(root, "dispatch/MONO-999-a1/pins.json");
      write(path.join(path.dirname(pinsFile), "snapshot/issue-MONO-999.md"), "# MONO-999\n\nFixture task contract.\n");
      const pins = { product: "fixture", root, worktree: repo, skillsRoot: skills, baseRef: "HEAD", evidenceRoot: evidence,
        risk: "standard", critical: null, verification: { command: process.execPath, args: ["-e", "process.exit(0)"] }, workerWritableRoots: [repo],
        reviewDataset: dataset, reviewDatasetVersion: 1, reviewDatasetDigest: sha256File(dataset) };
      if (pack) pins.packRoot = pack;
      if (fixture.mode.startsWith("temp-")) pins.verification.args = ["-e", `
const assert=require('node:assert/strict'),path=require('node:path');
assert.equal(process.env.TMPDIR,process.env.TMP);assert.equal(process.env.TMPDIR,process.env.TEMP);
assert.ok(path.basename(process.env.TMPDIR).startsWith('mono-sandbox-temp-'));
`];
      if (fixture.mode === "review-rounds") {
        git("branch", "review-base"); pins.baseRef = "review-base";
        pins.verification.args = ["-e", `const fs=require('node:fs');fs.mkdirSync('.orchestrator',{recursive:true});fs.writeFileSync('.orchestrator/verify-saw',fs.readFileSync(${JSON.stringify(path.join(bin, "review.log"))},'utf8'))`];
      }
      if (fixture.mode.startsWith('verify-')) pins.verification.args = ['-e', `
const fs=require('node:fs'),p='.orchestrator/verify-count';fs.mkdirSync('.orchestrator',{recursive:true});
const n=fs.existsSync(p)?Number(fs.readFileSync(p,'utf8'))+1:1;fs.writeFileSync(p,String(n));console.log('project verification '+n);
if(${JSON.stringify(fixture.changeHead)})require('node:child_process').execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','changed']);
process.exit(n<=${fixture.failRuns ?? 0}?1:0);
`];
      if (fixture.mode.startsWith('idea-')) {
        pins.packVersion = fixture.mode === 'idea-old-no-pin' ? '0.31.1' : '0.32.0';
        if (!fixture.mode.endsWith('no-pin')) {
          const directory = path.join(path.dirname(pinsFile), 'snapshot');
          const input = ideaDispatchFixture(directory);
          atomicJson(path.join(directory, 'idea/gate-config.json'), { ideaGate: { since: '2026-10-17' } });
          const lane = fixture.mode === 'idea-issue-only' ? JSON.parse(fs.readFileSync('scripts/fixtures/idea-gate/issue-only/issue-only.json')) : null;
          if (lane) {
            atomicJson(path.join(directory, 'issue-only.json'), lane);
            for (const name of ['idea/project.json', 'idea/idea-records.json', 'approval.json', 'issue-context.json']) fs.unlinkSync(path.join(directory, name));
          }
          atomicJson(path.join(directory, 'idea/selected-record.json'), lane ? null : input.records.comments[0]);
          pins.idea = ideaBinding(directory, checkIdea(lane ? { mode: 'approved', since: '2026-10-17', issueOnlySeam: lane.seam } :
            { mode: 'approved', project: input.project, records: input.records,
              approval: { ...input.approval, body: input.body }, issueContext: input.context, since: '2026-10-17' }));
        }
      }
      atomicJson(pinsFile, pins);
      const binding = { file: pinsFile, digest: sha256File(pinsFile) };
      const entry = { issue: "MONO-999", attempt: 1, stage: "mono-deliver", worktree: repo,
        packVersion: "fixture", sourceCommit: "b".repeat(40), surfaceRevision: 4, pins: binding, pinsVersion: 0 };
      const registryFile = path.join(root, "workers.json");
      const register = () => atomicJson(registryFile, { "MONO-999": entry }); register();
      let request = { ...pins, head, collect: false, collectionId: `preflight-collect:${head}:1`, pins: binding }; delete request.reviewDatasetDigest;
      const file = path.join(scratch, "request.json"), receiptFile = path.join(evidence, `${head}.json`);
      const call = value => { atomicJson(file, value); return spawnSync(process.execPath, [...(fixture.platform ? ["--require", preload] : []), "scripts/gate.mjs", "preflight", "--request", file], { env, encoding: "utf8" }); };
      const admit = async value => {
        if(!fs.existsSync(registryFile))return;
        const {admitCollection}=await import('./orchestrator/command-state.mjs');
        const request={...value,collect:false},queue=[{id:request.collectionId,operation:'preflight-collect',target:request.head,payload:{request}}];
        return admitCollection(root,{...entry,phase:'preflight',kind:'confirmation-request',sequence:1,head:request.head,
          linear_mutations_pending:queue,capsule:{phase:'preflight',head:request.head,decisions:[],open_queue:queue,writable_roots:request.workerWritableRoots}});
      };
      const collect = async (value, expected = 0) => { await admit(value); const r = call({ ...value, collect: true }); assert.equal(r.status, expected, r.stdout + r.stderr); return JSON.parse(fs.readFileSync(receiptFile, "utf8")); };
      const seal = envelope => { envelope.signature = crypto.createHmac("sha256", fs.readFileSync(path.join(evidence, "receipt.key"))).update(canonical(envelope.receipt)).digest("hex"); atomicJson(receiptFile, envelope); };
      if (fixture.mode.startsWith('idea-')) {
        if (fixture.mode === 'idea-new-no-pin') {
          const result = call(request); assert.equal(result.status, 1); assert.match(result.stdout, /idea pin required/u);
          assert.equal(fs.existsSync(receiptFile), false); return;
        }
        if (fixture.mode === 'idea-request-mismatch') {
          delete request.idea; const result = call(request); assert.equal(result.status, 1); assert.match(result.stdout, /mismatch: idea/u); return;
        }
        if (fixture.mode === 'idea-tamper-before-collect') {
          const projectFile = path.join(pins.idea.path, 'idea/project.json'), project = JSON.parse(fs.readFileSync(projectFile));
          project.status = 'Delivery'; atomicJson(projectFile, project);
          await admit(request); const result = call({ ...request, collect: true });
          assert.equal(result.status, 1); assert.match(result.stdout, /idea artifact/u);
          assert.equal(fs.existsSync(receiptFile), false); assert.equal(fs.existsSync(sandboxLog), false); return;
        }
        const envelope = await collect(request);
        if (fixture.mode !== 'idea-old-no-pin') assert.deepEqual(envelope.receipt.idea, pins.idea, 'signed receipt binds the saved idea');
        else assert.equal(Object.hasOwn(envelope.receipt, 'idea'), false, 'old attempt remains field-free');
        if (fixture.mode === 'idea-missing-receipt') { delete envelope.receipt.idea; seal(envelope); }
        if (fixture.mode === 'idea-other-project-receipt') { envelope.receipt.idea.projectId = '11111111-1111-1111-1111-111111111111'; seal(envelope); }
        if (fixture.mode === 'idea-tamper') {
          const projectFile = path.join(pins.idea.path, 'idea/project.json'), project = JSON.parse(fs.readFileSync(projectFile));
          project.status = 'Delivery'; project.body += '\n## Additional section\nLater change.\n';
          atomicJson(projectFile, project);
          assert.equal(checkIdea({ mode: 'approved', project, records: JSON.parse(fs.readFileSync(path.join(pins.idea.path, 'idea/idea-records.json'))), since: '2026-10-17' }).code, 'pass');
        }
        const result = call(request), rejected = ['idea-tamper', 'idea-missing-receipt', 'idea-other-project-receipt'].includes(fixture.mode);
        assert.equal(result.status, rejected ? 1 : 0, result.stdout + result.stderr);
        if (rejected) assert.match(result.stdout, /idea/u);
        // Ship must perform the same artifact/receipt check before judgment.
        if (rejected) {
          const gh = path.join(bin, 'gh');
          write(gh, `#!/usr/bin/env node
const a=process.argv.slice(2),empty={nodes:[],pageInfo:{hasNextPage:false}};
const pr={headRefOid:${JSON.stringify(head)},baseRefOid:${JSON.stringify(head)},baseRefName:'delivery',state:'OPEN',mergeStateStatus:'CLEAN',mergeable:'MERGEABLE',reviewThreads:empty};
console.log(JSON.stringify(a.includes('graphql')?{data:{repository:{pullRequest:pr,object:{statusCheckRollup:{contexts:empty}}}}}:a.includes('user')?{login:'fixture'}:[]));
`);
          fs.chmodSync(gh, 0o700);
          const judgmentFile = path.join(scratch, 'judgment.json'); atomicJson(judgmentFile, { ...judgment(), head });
          atomicJson(file, { preflight: request, repo: 'fixture/repo', number: 1, attempt: 1, stateFile: path.join(scratch, 'ship.json'), judgmentFile, watch: false });
          const shipped = spawnSync(process.execPath, ['scripts/gate.mjs', 'ship', '--request', file], { env, encoding: 'utf8' });
          assert.equal(shipped.status, 1, shipped.stdout + shipped.stderr); assert.match(shipped.stdout, /idea/u);
        }
        return;
      }
      if (fixture.mode === 'review-rounds') {
        // One task through the whole path: findings, fix, ship read, the last round, the limit, an amendment and a role that cannot run.
        const author = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'], base = head;
        const commit = text => { fs.appendFileSync(path.join(repo, 'input.mjs'), text); git('add', 'input.mjs'); git(...author, 'commit', '-m', text.trim()); return git('rev-parse', 'HEAD'); };
        const at = (tip, n = 1, pinned = binding) => ({ ...request, head: tip, collectionId: `preflight-collect:${tip}:${n}`, pins: pinned });
        const stored = tip => path.join(evidence, `${tip}.json`);
        const round = async (value, status, line) => {
          await admit(value);
          for (const result of [call({ ...value, collect: true }), call(value)]) { assert.equal(result.status, status, result.stdout + result.stderr); assert.match(result.stdout, line); }
          return JSON.parse(fs.readFileSync(stored(value.head), 'utf8')).receipt;
        };
        const leftover = text => [reviewFinding('input.mjs', { anchor: text, title: text })], closing = reviewVerdict({ outcome: 'rejected', closed: true });
        setReview(bin, { findings: leftover('First leftover') });
        const first = commit('export const one = 1;\n');
        let receipt = await round(at(first), 1, /fail: review not-converged \(round 1 of 3\); fix and request the next round; 1 open: P2 input\.mjs:1 First leftover/);
        assert.deepEqual([receipt.producer, receipt.review.spent, receipt.verification.exitCode, receipt.base], [REVIEW_PRODUCER, true, null, base]);
        const verifySaw = path.join(repo, '.orchestrator/verify-saw');
        assert.deepEqual([reviewCalls(bin), fs.existsSync(verifySaw)], [['reviewer', 'checker'], false], 'no verification before an acceptable review');
        receipt = await round(at(first, 2), 1, /review not-converged \(round 1 of 3\)/);
        assert.equal(receipt.review.spent, false); assert.ok(receipt.review.reusedFrom); assert.equal(reviewCalls(bin).length, 2, 'the same head reuses its round');
        setReview(bin, { findings: [], verdict: closing });
        const second = commit('export const two = 2;\n');
        receipt = await round(at(second), 0, /pass: review clean \(round 2 of 3\) and verification verified on head/);
        assert.equal(fs.readFileSync(verifySaw, 'utf8'), 'reviewer\nchecker\nreviewer\nchecker\n', 'verification starts only after the review round has finished');
        const gh = path.join(bin, 'gh');
        write(gh, `#!/usr/bin/env node
const a=process.argv.slice(2),empty={nodes:[],pageInfo:{hasNextPage:false}};
const pr={headRefOid:${JSON.stringify(second)},baseRefOid:${JSON.stringify(base)},baseRefName:'delivery',state:'OPEN',mergeStateStatus:'CLEAN',mergeable:'MERGEABLE',reviewThreads:empty};
console.log(JSON.stringify(a.includes('graphql')?{data:{repository:{pullRequest:pr,object:{statusCheckRollup:{contexts:empty}}}}}:a.includes('user')?{login:'fixture'}:[]));
`); fs.chmodSync(gh, 0o700);
        const judgmentFile = path.join(scratch, 'judgment.json'), stateFile = path.join(scratch, 'ship.json'); atomicJson(judgmentFile, { ...judgment(), head: second });
        const ship = () => { atomicJson(file, { preflight: at(second), repo: 'fixture/repo', number: 1, attempt: 1, stateFile, judgmentFile, watch: false });
          return spawnSync(process.execPath, ['scripts/gate.mjs', 'ship', '--request', file], { env, encoding: 'utf8' }); };
        let shipped = ship(); assert.match(shipped.stdout, /fail: checks not created on head/, shipped.stdout + shipped.stderr);
        assert.equal(JSON.parse(fs.readFileSync(stateFile)).preflightReceipt.runId, receipt.runId, 'ship read the signed review receipt');
        const sealed = fs.readFileSync(stored(second)), old = JSON.parse(sealed); old.receipt.producer = 'gate-autoreview-v2';
        old.signature = crypto.createHmac("sha256", fs.readFileSync(path.join(evidence, "receipt.key"))).update(canonical(old.receipt)).digest("hex"); atomicJson(stored(second), old);
        for (const refused of [ship(), call(at(second))]) { assert.equal(refused.status, 1); assert.match(refused.stdout, /old receipt format/); }
        fs.writeFileSync(stored(second), sealed);
        setReview(bin, { findings: leftover('Second leftover'), verdict: reviewVerdict() });
        const third = commit('export const three = 3;\n');
        receipt = await round(at(third), 0, /pass: review clean-with-successors \(round 3 of 3\).*successor candidates: P2 input\.mjs:1 Second leftover/);
        assert.deepEqual(receipt.review.successors.map(item => item.line), ['P2 input.mjs:1 Second leftover']);
        const fourth = commit('export const four = 4;\n'), calls = reviewCalls(bin).length, limit = /^gate preflight: fail: needs-decision: review round limit reached \(3 of 3 on this pins file\)/;
        const unpublished = call(at(fourth)); assert.equal(unpublished.status, 1, 'refused before the worker publishes'); assert.match(unpublished.stdout, limit);
        receipt = await round(at(fourth), 1, limit);
        assert.equal(receipt.review.outcome, 'refused'); assert.equal(reviewCalls(bin).length, calls, 'a fourth round is never launched');
        const amended = path.join(path.dirname(pinsFile), 'pins.v1.json'), resnapshot = path.join(path.dirname(pinsFile), 'snapshot.v1');
        write(path.join(resnapshot, 'issue-MONO-999.md'), '# MONO-999\n\nNarrowed fixture contract.\n');
        atomicJson(amended, { pinsVersion: 1, fullSnapshot: { directory: resnapshot } });
        const resumeFile = path.join(path.dirname(pinsFile), 'resume.v1.md'); write(resumeFile, 'Narrow: only input.mjs.\n\n## Effective attempt pins\npinsVersion: 1\n');
        write(path.join(path.dirname(pinsFile), 'resume.v0.md'), 'A prepared amendment that was never delivered.\n');
        entry.completed_amendments = { 1: { pinsVersion: 1, resumeFile, change: { text: 'Narrow: only input.mjs.\n\n## issue-only note\nKept.' } } };
        entry.pinsVersion = 1; register();
        const next = { file: amended, digest: sha256File(amended) }, launchContract = receipt.review.contractDigest;
        receipt = await round(at(fourth, 2, next), 1, /review not-converged \(round 1 of 3\)/);
        assert.equal(receipt.review.record.rounds.length, 1, 'a new pins version opens a fresh three');
        assert.notEqual(receipt.review.contractDigest, launchContract, 'a full-snapshot amendment supplies the reviewed contract');
        assert.equal(receipt.review.contractDigest, digest('# MONO-999\n\nNarrowed fixture contract.\n\n\n## Orchestrator amendment 1\nNarrow: only input.mjs.\n\n## issue-only note\nKept.'), 'the reviewer reads the amendment text with the Issue');
        setReview(bin, { loggedOut: 'codex' });
        const fifth = commit('export const five = 5;\n');
        receipt = await round(at(fifth, 1, next), 1, /fail: not-reviewed: .*no round spent, request this head once more/);
        assert.deepEqual([receipt.review.spent, receipt.review.record], [false, null]);
        await round(at(fifth, 2, next), 1, /fail: blocked: not-reviewed twice in a row on this head/);
        const blocked = call(at(fifth, 3, next)); assert.equal(blocked.status, 1); assert.match(blocked.stdout, /fail: blocked: not-reviewed twice in a row/);
        setReview(bin, { loggedOut: null, findings: [], verdict: closing });
        await round(at(commit('export const six = 6;\n'), 1, next), 0, /pass: review clean \(round 2 of 3\)/);
        return;
      }
      let expectedField = null, expectedValue = null, expectedStatus = 2;
      if (fixture.mode === "mismatch") { expectedField = fixture.field; expectedValue = pins[fixture.field]; if (fixture.omit) delete request[fixture.field]; else request[fixture.field] = fixture.value; }
      if (fixture.mode === "pins-digest") { request.pins = { ...binding, digest: "0".repeat(64) }; expectedField = "pins.digest"; expectedValue = binding.digest; }
      if (fixture.mode === "dataset-tamper") { write(dataset, "Changed decisions.\n"); expectedField = "reviewDatasetDigest"; expectedValue = pins.reviewDatasetDigest; }
      if (fixture.mode === "no-pins") { delete request.pins; expectedField = "pins"; expectedValue = binding; }
      if (["amended", "admitted"].includes(fixture.mode)) {
        if (fixture.mode === "admitted") { await collect(request); expectedStatus = 0; }
        if (fixture.mode === "admitted") atomicJson(path.join(root, "consumed/MONO-999-a1/admissions", `${request.collectionId}.json`),
          { collectionId: request.collectionId, reportDigest: "f".repeat(64), pinsVersion: 0, manifestDigest: digest({ ...pins, pinsVersion: 0 }) });
        const amendment = path.join(path.dirname(pinsFile), "pins.v1.json"); atomicJson(amendment, { pinsVersion: 1, reviewDatasetVersion: 2, reviewDatasetDigest: pins.reviewDatasetDigest });
        entry.pinsVersion = 1; register();
        if (fixture.mode === "amended") { expectedField = "pins.file"; expectedValue = amendment; }
      }
      if (fixture.mode === "no-dataset") {
        pins.reviewDataset = null; pins.reviewDatasetVersion = 0; pins.reviewDatasetDigest = null; atomicJson(pinsFile, pins);
        binding.digest = sha256File(pinsFile); register(); request = { ...request, reviewDatasetVersion: 0, pins: binding }; delete request.reviewDataset;
        if (fixture.omitVersion) { delete request.reviewDatasetVersion; expectedField = "reviewDatasetVersion"; expectedValue = 0; }
      }
      if (fixture.mode === "other-head") {
        const envelope = await collect(request); envelope.receipt.collectionId = `preflight-collect:${head}:2`; seal(envelope);
        request.collectionId = `preflight-collect:${head}:3`;
      }
      if (fixture.mode.startsWith('verify-')) { expectedStatus = fixture.failRuns > 1 || fixture.sandboxFailure || fixture.changeHead ? 1 : 0; request.collect = true; }
      if (fixture.mode === "collect") { expectedStatus = 0; request.collect = true; }
      if (fixture.mode.startsWith("temp-")) { expectedStatus = fixture.protected ? 1 : 0; request.collect = true; }
      if (fixture.mode === "legacy") {
        delete pins.reviewDatasetDigest; atomicJson(pinsFile, pins); binding.digest = sha256File(pinsFile); register(); delete request.pins;
        const envelope = await collect({...request,pins:binding}); delete envelope.receipt.pins; delete envelope.receipt.idea; seal(envelope); expectedStatus = 0;
      }
      if (fixture.mode === "receipt-pins") {
        const envelope = await collect(request); envelope.receipt.pins.digest = "0".repeat(64); seal(envelope); expectedStatus = 1;
      }
      if (fixture.mode === "history") {
        const envelope = await collect(request); envelope.receipt.collectionId = `preflight-collect:${head}:2`; seal(envelope); expectedStatus = 0;
      }
      if (fixture.mode === "unregistered-receipt") {
        await collect(request); fs.unlinkSync(registryFile); delete request.pins; expectedField = "pins"; expectedValue = binding;
      }
      if (fixture.mode === "unmatched-no-pins") {
        entry.worktree = path.join(scratch, "another-worktree"); register(); delete request.pins;
        expectedField = "registry"; expectedValue = "one registered attempt for worktree";
      }
      if (fixture.unregistered) fs.unlinkSync(registryFile);
      if(request.collect===true)await admit(request);
      const registryBefore = fs.existsSync(registryFile) ? fs.readFileSync(registryFile) : null, receiptBefore = fs.existsSync(receiptFile) ? fs.readFileSync(receiptFile) : null;
      const result = call(request);
      if (expectedField) { expectedStatus = 1; assert.equal(result.stdout.trim(), `gate preflight: fail: collection request mismatch: ${expectedField}; expected ${canonical(expectedValue)}`); }
      assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
      assert.deepEqual(fs.existsSync(registryFile) ? fs.readFileSync(registryFile) : null, registryBefore, "gate never writes the registry");
      assert.equal(fs.existsSync(path.join(root, "reports/MONO-999-phase-preflight.json")), false);
      if (fixture.mode.startsWith('verify-')) {
        const envelope = JSON.parse(fs.readFileSync(receiptFile)), receipt = envelope.receipt;
        const history = path.join(evidence, 'history', receipt.runId + '.json');
        assert.deepEqual(JSON.parse(fs.readFileSync(history)), envelope);
        assert.equal(envelope.signature, crypto.createHmac('sha256', fs.readFileSync(path.join(evidence, 'receipt.key'))).update(canonical(receipt)).digest('hex'));
        const retried = !fixture.sandboxFailure && !fixture.changeHead;
        assert.equal(fs.existsSync(path.join(repo, '.orchestrator/verify-count')) ? Number(fs.readFileSync(path.join(repo, '.orchestrator/verify-count'))) : 0, fixture.sandboxFailure ? 0 : retried ? 2 : 1);
        assert.deepEqual(reviewCalls(bin), ['reviewer'], 'the review round runs once, before verification');
        if (retried) {
          assert.match(receipt.verification.output, /Verification run 1 \(exit 1\):[\s\S]*project verification 1[\s\S]*Verification run 2/);
          assert.equal(receipt.verification.exitCode, fixture.failRuns > 1 ? 1 : 0);
        }
        if (!fixture.changeHead) {
          write(path.join(root, 'reports/collector.log'), 'edited ordinary log');
          const bytes = fs.readFileSync(history), reread = call({ ...request, collect: false });
          assert.equal(reread.status, expectedStatus, reread.stdout + reread.stderr);
          assert.deepEqual(fs.readFileSync(history), bytes, 'signed output survives a fresh gate process and ordinary log edits');
        }
        // The cost report reads the round exactly as the gate signed it.
        write(path.join(root, 'logs/MONO-999-mono-deliver-a1.jsonl'), JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }) + '\n');
        const cost = spawnSync(process.execPath, ['scripts/wave-cost.mjs', 'MONO-999', '--root', root, '--evidence-root', evidence], { encoding: 'utf8' });
        assert.deepEqual(JSON.parse(cost.stdout.split('\nЦена волны')[0]).autoreview.receipts, { receipts: 1, rounds: 1, not_reviewed: 0, calls: 1, measured_calls: 0 }, cost.stderr);
        return;
      }
      if (expectedStatus === 2) {
        assert.deepEqual(result.stdout.trim().split("\n"), [`gate preflight: pending: ${request.collectionId}`, JSON.stringify({ publishRequest: request })]);
        if (receiptBefore) assert.deepEqual(fs.readFileSync(receiptFile), receiptBefore);
        else assert.equal(fs.existsSync(receiptFile), false);
      }
      if (fixture.mode === "receipt-pins") assert.match(result.stdout, /receipt pins differs from dispatch request/u);
      if (fixture.mode.startsWith('verify-')) { expectedStatus = fixture.failRuns > 1 || fixture.sandboxFailure || fixture.changeHead ? 1 : 0; request.collect = true; }
      if (fixture.mode === "collect") {
        const envelope = JSON.parse(fs.readFileSync(receiptFile, "utf8")); assert.deepEqual(envelope.receipt.pins, binding);
        assert.equal(fs.existsSync(path.join(evidence, "history", `${envelope.receipt.runId}.json`)), true);
        const verified = call({ ...request, collect: false }); assert.equal(verified.status, 0, verified.stdout);
      }
      if (fixture.protected) {
        assert.ok(result.stdout.includes(`collection Darwin temporary write grant (${fixture.protected})`), result.stdout);
        assert.match(result.stdout, /no overlapping grants/u);
        assert.equal(fs.existsSync(sandboxLog), false, "overlap refuses before any sandbox invocation");
        const { receipt } = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
        assert.deepEqual([receipt.review.spent, receipt.verification.exitCode], [true, null], "the completed round is signed even when verification cannot launch");
      }
      if (fixture.mode.startsWith("temp-") && !fixture.protected) {
        const { receipt } = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
        const grantsDarwin = fixture.platform === "darwin" && !fixture.unavailable;
        assert.equal(fs.existsSync(getconfLog), fixture.platform === "darwin", "other platforms never query Darwin temp");
        for (const phase of ["verification"]) {
          const { sandbox } = receipt[phase], profile = sandbox.args[sandbox.args.indexOf("-c") + 1];
          const actual = [...profile.matchAll(/("(?:\\.|[^"\\])*")="write"/gu)].map(match => JSON.parse(match[1]));
          const expected = [...new Set([fs.realpathSync(repo), resolvedLocation(sandbox.tempRoot), ...(grantsDarwin && phase === "verification" ? [fs.realpathSync(darwinTemp)] : [])])];
          assert.deepEqual(actual.sort(), expected.sort(), phase + " records exactly the granted roots");
          assert.ok(profile.includes('\":root\"="read"'));
          assert.ok(profile.includes("network={enabled=true}"));
          assert.equal(sandbox.probed, true);
          assert.equal(fs.existsSync(sandbox.tempRoot), false);
          if (fixture.privateInsideDarwin) assert.equal(resolvedLocation(sandbox.tempRoot).startsWith(fs.realpathSync(darwinTemp) + path.sep), phase === "verification");
        }
        assert.equal(fs.readdirSync(evidence).some(name => name.startsWith(".write-boundary-")), false);
        const verified = call({ ...request, collect: false }); assert.equal(verified.status, 0, verified.stdout);
      }
      if (fixture.mode === "history") assert.deepEqual(fs.readFileSync(receiptFile), receiptBefore, "history verification does not reconcile the mutable head");
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

async function gitEnvironmentFixture(run) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "gate-git-env-"));
  const saved = { ...process.env };
  try {
    const pack = path.join(scratch, "pack");
    fs.cpSync(path.dirname(fileURLToPath(import.meta.url)), path.join(pack, "scripts"), { recursive: true });
    const gate = path.join(pack, "scripts/gate.mjs");
    // Expose only the copied fixture's private environment seam.
    fs.appendFileSync(gate, "\nexport { safeGitEnv, fetchGitEnv };\n");
    const environments = await import(pathToFileURL(gate));
    process.env.GIT_CONFIG_PARAMETERS = "'http.proxyAuthMethod'='basic' 'credential.helper'='!fixture proxy helper'";
    process.env.GIT_DIR = "/fixture/inherited-git-dir";
    process.env.GIT_ASKPASS = "/fixture/askpass";
    process.env.GIT_CONFIG_GLOBAL = "/fixture/global";
    delete process.env.MONO_WORKER_JOURNAL_IDENTITY;
    await run(environments);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test("fetchGitEnv preserves sandbox proxy parameters verbatim with the managed-worker hint", () => gitEnvironmentFixture(({ fetchGitEnv }) => {
  process.env.MONO_WORKER_JOURNAL_IDENTITY = "synthetic compatibility hint";
  const env = fetchGitEnv();
  assert.equal(env.GIT_CONFIG_PARAMETERS, process.env.GIT_CONFIG_PARAMETERS);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_ASKPASS, process.env.GIT_ASKPASS);
  assert.equal(env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_GLOBAL);
  assert.equal(env.GIT_NO_REPLACE_OBJECTS, "1");
}));

test("fetchGitEnv removes inherited proxy parameters without the managed-worker hint", () => gitEnvironmentFixture(({ fetchGitEnv }) => {
  assert.equal(fetchGitEnv().GIT_CONFIG_PARAMETERS, undefined);
}));

test("safeGitEnv removes inherited proxy parameters for non-fetch git even with the hint", () => gitEnvironmentFixture(({ safeGitEnv }) => {
  process.env.MONO_WORKER_JOURNAL_IDENTITY = "synthetic compatibility hint";
  const env = safeGitEnv();
  assert.equal(env.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_ASKPASS, undefined);
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
}));

test('ship-bot-policy: worker fields cannot remove or replace trusted bot requirements', async () => {
  const { validateShipBotPolicy } = await import('./gate.mjs');
  const trusted = { botChecks: ['Greptile Review'], botUnavailable: null };
  for (const policy of [{ botChecks: [] }, { botChecks: ['Other Bot'] }, { botUnavailable: 'worker says unavailable' }])
    assert.throws(() => validateShipBotPolicy(policy, trusted), /bot/);
  const s = sample(); s.checks.pop();
  assert.throws(() => evaluateShip(s, judgment(), validateShipBotPolicy({}, trusted)), /bot Greptile Review pending/);
  const unavailable = { ...trusted, botUnavailable: 'orchestrator confirmed service outage' };
  assert.doesNotThrow(() => evaluateShip(s, judgment(), validateShipBotPolicy({}, unavailable)));
  assert.throws(() => validateShipBotPolicy({ botUnavailable: 'different reason' }, unavailable), /bot/);
});

test('ship-next-attempt-after-fix: new head/state opens a window in the same task attempt', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-ship-next-'));
  try {
    const scripts = path.join(scratch, 'scripts');
    fs.cpSync(path.dirname(fileURLToPath(import.meta.url)), scripts, { recursive: true });
    const gate = path.join(scripts, 'gate.mjs');
    // Isolate GitHub and sealed-preflight I/O; run the actual window/state loop.
    let source = fs.readFileSync(gate, 'utf8');
    source = source.replace('const snapshot = readShipSnapshot(request.repo, request.number, deadline);', 'const snapshot = readJson(request.fixtureSnapshot);');
    source = source.replace('const proof = await verifyPreflight(request.preflight, snapshot);', 'const proof = { receipt: { path: "fixture-sealed-proof" } };');
    fs.writeFileSync(gate, source);
    const { shipGate } = await import(pathToFileURL(gate));
    const { atomicJson } = await import('./runtime.mjs');
    const root = path.join(scratch, 'root'), issue = 'MONO-162';
    const file = path.join(root, 'dispatch', `${issue}-a1`, 'pins.json');
    const pins = { root, worktree: scratch, reviewDatasetDigest: null, reviewDatasetVersion: 0, workerWritableRoots: [scratch] };
    const crypto = await import('node:crypto');
    atomicJson(file, pins);
    const binding = { file, digest: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
    atomicJson(path.join(root, 'workers.json'), { [issue]: { issue, worktree: scratch, stage: 'mono-deliver', attempt: 1, packVersion: 'test', surfaceRevision: 4, pins: binding } });
    const config = path.join(scratch, 'config.json');
    atomicJson(config, { orchestration: { delivery: { quietSec: 0.001, pollSec: 0.005 } } });
    const request = { preflight: { ...pins, pins: binding, head, collect: false, collectionId: `preflight-collect:${head}:1` },
      repo: 'owner/repo', number: 162, attempt: 1, config, watch: true,
      stateFile: path.join(scratch, 'ship-1.json'), judgmentFile: path.join(scratch, 'judgment.json'), fixtureSnapshot: path.join(scratch, 'github.json') };
    atomicJson(request.stateFile, { scope: { repo: request.repo, number: 162, attempt: 1 }, head, startedAt: Date.now() - 7201000, lastEventAt: Date.now() - 7201000 });
    for (const policy of [{ botChecks: [] }, { botChecks: ['Other Bot'] }, { botUnavailable: 'worker outage' }])
      await assert.rejects(shipGate({ ...request, policy }), /bot/);
    const previous = fs.readFileSync(request.stateFile);
    await assert.rejects(shipGate(request), /evidence-limit/);
    const nextHead = 'b'.repeat(40), snapshot = sample(); snapshot.head = nextHead;
    snapshot.checks.forEach(check => check.head = nextHead);
    atomicJson(request.fixtureSnapshot, snapshot); atomicJson(request.judgmentFile, { ...judgment(), head: nextHead });
    const next = { ...request, attempt: 2, stateFile: path.join(scratch, 'ship-2.json'), preflight: { ...request.preflight, head: nextHead, collectionId: `preflight-collect:${nextHead}:1` } };
    assert.match(await shipGate(next), /evidence complete and quiet period passed/);
    assert.deepEqual(fs.readFileSync(request.stateFile), previous);
    assert.equal(JSON.parse(fs.readFileSync(next.stateFile)).head, nextHead);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'workers.json')))[issue].attempt, 1);
    snapshot.checks.pop(); atomicJson(request.fixtureSnapshot, snapshot);
    atomicJson(config, { orchestration: { delivery: { quietSec: 0.001, pollSec: 0.005,
      collectionTimeoutSec: 0.005, confirmationTimeoutSec: 0.01, evidenceLimitSec: 0.6 } } });
    // The limit leaves room for at least one poll on a loaded host before it parks.
    const waiting = { ...next, attempt: 3, stateFile: path.join(scratch, 'ship-3.json') };
    await assert.rejects(shipGate(waiting), /evidence-limit/);
    assert.match(JSON.parse(fs.readFileSync(waiting.stateFile)).pendingReason, /bot Greptile Review pending/);

  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('ship-bot-policy: project configuration requires nonempty unique check names', async () => {
  const { shipBotChecks } = await import('./runtime.mjs');
  assert.deepEqual(shipBotChecks(), ['Greptile Review']);
  assert.deepEqual(shipBotChecks({ orchestration: { ship: { botChecks: ['Custom Review'] } } }), ['Custom Review']);
  for (const botChecks of [[], null, 'Greptile Review', [' '], ['Bot', 'Bot'], [' Bot']])
    assert.throws(() => shipBotChecks({ orchestration: { ship: { botChecks } } }), /botChecks/);
});
