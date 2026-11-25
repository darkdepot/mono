import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateShip, validatePreflight, advanceEvidence, botRemarkDigest, reviewHistory, roundWork, blockedTwice, roundOutcome, reviewContext, roundLimit, ROUND_LIMIT, extraRoundRefusal, extraRoundGranted } from "./gate.mjs";
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
test("the pinned risk sets the round limit and the strict path holds older harmful defects too", () => {
  assert.deepEqual(['tiny', 'standard', 'deep', 'risky'].map(roundLimit), [1, 1, 1, 3]);
  assert.equal(ROUND_LIMIT, 3, 'the installed constant is unchanged');
  const older = extra => ({ outcome: 'not-converged', findings: [reviewed({ origin: 'pre-existing', ...extra })] });
  // AE3: on the strict path an older defect harming the main path, data or install never leaves as a successor.
  for (const round of [1, 2, 3]) assert.equal(roundOutcome(older({ danger: true, dangerCase: 'readiness' }), round, true).outcome, 'not-converged');
  assert.equal(roundOutcome(older({ weight: 'P3', danger: true, dangerCase: 'data' }), 2, true).outcome, 'not-converged');
  assert.equal(roundOutcome(older({ danger: true, dangerCase: 'readiness' }), 1).outcome, 'clean-with-successors', 'the fast path keeps must-file successors');
  assert.equal(roundOutcome(older({}), 1, true).successors[0].line, 'P2 a.mjs:3 Leftover', 'a harmless older defect still passes');
  assert.equal(roundOutcome(older({ weight: 'P3', danger: true, dangerCase: 'silent-result' }), 1, true).outcome, 'clean-with-successors');
  const head = "a".repeat(40), base = "b".repeat(40), workerVerification = { head, exitCode: 0 };
  const fast = review => ({ producer: REVIEW_PRODUCER, head, base, consistency: { passed: true, error: null },
    verification: { exitCode: 0, sandbox: { mode: "workspace-write", probed: true } }, review: { round: 1, limit: 1, successors: [], record: { findings: [reviewed()] }, ...review } });
  assert.match(validatePreflight(fast({ outcome: 'clean', workerVerification }), head, base), /^review clean \(round 1 of 1\), fixes after it confirmed by the worker's full verification, and verification/);
  assert.throws(() => validatePreflight(fast({ outcome: 'clean', workerVerification: { head: base, exitCode: 0 } }), head, base), /worker verification is not on this head/);
  assert.throws(() => validatePreflight(fast({ outcome: 'not-converged' }), head, base), { message: /^review not-converged \(round 1 of 1\); fix, run the full verification on the final head/ });
});
test("review refusal and successor lines: an older dangerous defect must be filed, a long list stays readable by the collector", () => {
  const older = roundOutcome({ outcome: 'not-converged', findings: [reviewed({ origin: 'pre-existing', danger: true, dangerCase: 'data' })] }, 1);
  assert.deepEqual(older.successors.map(item => item.line), ['must-file P2 a.mjs:3 Leftover']);
  assert.equal(roundOutcome({ outcome: 'clean', findings: [reviewed({ origin: 'pre-existing' })] }, 1).successors[0].line, 'P2 a.mjs:3 Leftover');
  const owner = reviewed({ class: 'pr-remark', source: 'owner', weight: 'P3', danger: false });
  assert.deepEqual(roundOutcome({ outcome: 'not-converged', findings: [owner] }, 3), { outcome: 'not-converged', successors: [] }, 'an owner instruction never becomes a successor');
  assert.equal(roundOutcome({ outcome: 'not-converged', findings: [{ ...owner, source: 'bot' }] }, 2).outcome, 'clean-with-successors', 'a minor bot remark follows the ordinary rules');
  assert.equal(roundOutcome({ outcome: 'not-converged', findings: [reviewed({ origin: 'pre-existing', weight: 'P3', danger: true, dangerCase: 'silent-result' })] }, 1).successors[0].line, 'P3 a.mjs:3 Leftover', 'a minor older defect is a candidate');
  const many = Array.from({ length: 200 }, (_, index) => reviewed({ key: `k${index}`, trigger: 't'.repeat(300), reason: 'r'.repeat(400) }));
  const head = "a".repeat(40), base = "b".repeat(40);
  const receipt = { producer: REVIEW_PRODUCER, head, base, consistency: { passed: true, error: null }, verification: { exitCode: null },
    review: { outcome: 'not-converged', round: 1, successors: [], record: { findings: many } } };
  assert.throws(() => validatePreflight(receipt, head, base), error => error.message.length < 48000 && /^review not-converged \(round 1 of 3\); fix and request the next round; 200 open: /.test(error.message) && / more in the next round$/.test(error.message));
});
test("review rounds are counted per task attempt from receipt history", () => {
  const pins = { file: '/root/dispatch/MONO-1-a1/pins.json', digest: 'd' }, base = 'b'.repeat(40), contractDigest = 'c'.repeat(64);
  const heads = ['1', '2', '3', '4'].map(digit => digit.repeat(40));
  let clock = 0;
  const receipt = (at, outcome, extra = {}) => ({ producer: REVIEW_PRODUCER, recordedAt: new Date(Date.UTC(2026, 10, 10, 0, clock++)).toISOString(), runId: `run-${clock}`, pins, head: at, base,
    ...extra, review: { outcome, spent: !['not-reviewed', 'refused'].includes(outcome), contractDigest, record: { run: clock }, ...extra.review } });
  const read = (receipts, at = heads[0], other = {}) => reviewHistory(receipts, { pins, head: at, base, contractDigest, ...other });
  assert.deepEqual(read([]), { spent: 0, onContract: 0, notReviewed: 0, notReviewedCause: null, notReviewedCauses: [], notReviewedWork: [], notReviewedReason: null, reuse: null, record: null });
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
  const changedContract = 'f'.repeat(64);
  assert.equal(read(failed, heads[0], { contractDigest: changedContract }).notReviewed, 0, 'a task change clears the failure streak');
  assert.deepEqual(read(three, heads[3], { contractDigest: changedContract }), { spent: 3, onContract: 0, notReviewed: 0, notReviewedCause: null, notReviewedCauses: [], notReviewedWork: [], notReviewedReason: null, reuse: null, record: three[2].review.record },
    'a task change keeps the count, starts the count on its contract and continues the record');
  assert.equal(read(three, heads[2], { contractDigest: changedContract }).reuse, null, 'a changed contract never reuses a round');
  assert.deepEqual(read(three.slice(0, 2), heads[1], { contractDigest: changedContract }), { spent: 2, onContract: 0, notReviewed: 0, notReviewedCause: null, notReviewedCauses: [], notReviewedWork: [], notReviewedReason: null, reuse: null, record: three[1].review.record }, 'a new contract continues the record');
  assert.deepEqual(read(three.slice(0, 2), heads[1], { base: 'e'.repeat(40) }), { spent: 2, onContract: 2, notReviewed: 0, notReviewedCause: null, notReviewedCauses: [], notReviewedWork: [], notReviewedReason: null, reuse: null, record: null }, 'a new base starts a fresh record and keeps the count');
  const foreign = [{ ...three[0], producer: 'gate-autoreview-v2' }, { ...three[1], pins: { file: '/root/dispatch/MONO-2-a1/pins.json', digest: 'd' } },
    { ...three[2], pins: { file: '/root/dispatch/MONO-1-a2/pins.json', digest: 'd' } }, { producer: REVIEW_PRODUCER, pins }, null];
  assert.equal(read(foreign).spent, 0, 'old receipts, other tasks and other attempts are never counted');
});
test("MONO-488: a round's work causes come only from the call that ended it", () => {
  const head = 'a'.repeat(40), on = extra => ({ head, round: 1, ...extra });
  const interrupted = 'review interrupted; role process group stopped';
  // A login failure recovered on the retry of an earlier pass, then the next pass interrupted on its first attempt.
  const recovered = [on({ role: 'code-review', attempt: 1, reason: 'Claude login expired; login refresh: ok', cause: 'login' }),
    on({ role: 'code-review', attempt: 1, reason: interrupted, cause: 'other' }), on({ reason: interrupted, interrupted: true })];
  assert.deepEqual(roundWork({ failures: recovered }, head, 1), ['review interrupted']);
  // A call that failed both attempts names both, and nothing of an earlier recovered pass.
  const both = [on({ role: 'code-review', attempt: 1, reason: 'Claude login expired', cause: 'login' }),
    on({ role: 'code-review', attempt: 1, reason: 'role failed (timeout); no response admitted', cause: 'timeout' }),
    on({ role: 'code-review', attempt: 2, reason: 'Codex did not complete', cause: 'other' }), on({ reason: 'Codex did not complete' })];
  assert.deepEqual(roundWork({ failures: both }, head, 1), ['timeout', 'malformed or incomplete reviewer answer']);
  assert.deepEqual(roundWork({ failures: [on({ reason: 'incomplete changed-file coverage after focused pass' })], unreviewedFiles: ['a.bin'] }, head, 1),
    ['incomplete coverage of the changed files', 'unreadable or binary files']);
});
test("a review retry clears only an environmental not-reviewed streak recorded before it (MONO-483)", () => {
  const pins = { file: '/root/dispatch/MONO-1-a1/pins.json', digest: 'd' }, base = 'b'.repeat(40), contractDigest = 'c'.repeat(64), at = '1'.repeat(40);
  let clock = 0;
  const time = () => new Date(Date.UTC(2026, 10, 10, 0, clock++)).toISOString();
  const receipt = (outcome, cause, extra = {}) => ({ producer: REVIEW_PRODUCER, recordedAt: time(), runId: `run-${clock}`, pins, head: at, base,
    review: { outcome, spent: outcome !== 'not-reviewed', contractDigest, record: { run: clock }, ...(cause ? { cause } : {}),
      failures: cause === 'environment' ? [{ role: 'code-review', attempt: 1, cause: 'timeout' }, { role: 'code-review', attempt: 2, cause: 'network' }] : [], ...extra } });
  const retry = number => ({ number, recordedAt: time() });
  const read = (receipts, retries = []) => reviewHistory(receipts, { pins, head: at, base, contractDigest, retries });
  const env = [receipt('not-reviewed', 'environment'), receipt('not-reviewed', 'environment')];
  assert.deepEqual([read(env).notReviewed, read(env).notReviewedCause], [2, 'environment']);
  assert.deepEqual(read(env).notReviewedCauses, ['timeout', 'network'], 'the streak names its environmental causes');
  const marked = retry(1);
  assert.equal(read(env, [marked]).notReviewed, 0, 'a retry after an environmental streak clears it');
  const again = [...env, receipt('not-reviewed', 'environment')];
  assert.equal(read(again, [marked]).notReviewed, 1, 'the streak starts again after the retry');
  assert.equal(read([...again, receipt('not-reviewed', 'environment')], [marked]).notReviewed, 2, 'two more after the retry block again');
  const before = retry(9), late = [receipt('not-reviewed', 'environment'), receipt('not-reviewed', 'environment')];
  assert.equal(read(late, [before]).notReviewed, 2, 'a retry recorded before the last receipt of the streak does not cut it');
  const work = [receipt('not-reviewed', 'review'), receipt('not-reviewed', 'review')];
  assert.deepEqual([read(work, [retry(1)]).notReviewed, read(work).notReviewedCause], [2, 'review'], 'a streak caused by the work is not cleared');
  // MONO-488: the streak names the work's causes from each receipt, or from an older receipt's reason.
  const named = [receipt('not-reviewed', 'review', { workCauses: ['malformed or incomplete reviewer answer'] }),
    receipt('not-reviewed', 'review', { reason: 'incomplete changed-file coverage after focused pass' })];
  assert.deepEqual(read(named).notReviewedWork, ['malformed or incomplete reviewer answer', 'incomplete coverage of the changed files']);
  // MONO-488 review: a mixed streak keeps its labels and the latest unlabeled reason.
  const mixedWork = [receipt('not-reviewed', 'review', { workCauses: ['malformed or incomplete reviewer answer'], reason: 'Codex did not complete' }),
    receipt('not-reviewed', 'review', { workCauses: [], reason: 'role failed (output limit); no response admitted' })];
  assert.equal(blockedTwice(read(mixedWork)), 'blocked: not-reviewed twice in a row on this head (review: malformed or incomplete reviewer answer); resume with a task change: role failed (output limit); no response admitted');
  assert.equal(blockedTwice(read([...mixedWork].reverse().map((item, index) => ({ ...item, recordedAt: `2026-11-1${index}T00:00:00.000Z` })))),
    'blocked: not-reviewed twice in a row on this head (review: malformed or incomplete reviewer answer); resume with a task change', 'a labelled latest round needs no raw reason');
  const mixed = [receipt('not-reviewed', 'environment'), receipt('not-reviewed', 'review')];
  assert.deepEqual([read(mixed, [retry(1)]).notReviewed, read(mixed).notReviewedCause], [2, 'review'], 'one work cause in the streak keeps it');
  const legacy = [receipt('not-reviewed', null), receipt('not-reviewed', null)];
  assert.deepEqual([read(legacy, [retry(1)]).notReviewed, read(legacy).notReviewedCause], [2, 'review'], 'an old receipt without a cause counts as the work');
  const spentFirst = [receipt('not-converged', null), ...[receipt('not-reviewed', 'environment'), receipt('not-reviewed', 'environment')]];
  const plain = read(spentFirst), retried = read(spentFirst, [retry(1)]);
  assert.deepEqual([retried.spent, retried.onContract, retried.record], [plain.spent, plain.onContract, plain.record], 'a retry changes no round count and no record');
  assert.deepEqual([plain.spent, plain.onContract, retried.notReviewed], [1, 1, 0]);
  // MONO-483 review: a retry dated after the collection that judges it (a planted future record) never counts.
  const pending = [receipt('not-reviewed', 'environment'), receipt('not-reviewed', 'environment')], future = { number: 1, recordedAt: '2099-01-01T00:00:00.000Z' };
  assert.equal(reviewHistory(pending, { pins, head: at, base, contractDigest, retries: [future], now: time() }).notReviewed, 2, 'a future-dated retry is ignored');
  const delivered = retry(1), judged = time();
  assert.equal(reviewHistory(pending, { pins, head: at, base, contractDigest, retries: [delivered], now: judged }).notReviewed, 0);
  assert.equal(reviewHistory(pending, { pins, head: at, base, contractDigest, retries: [delivered], now: pending[1].recordedAt }).notReviewed, 2,
    'a retry later than the judging time does not count');
  assert.equal(reviewHistory(pending, { pins, head: at, base, contractDigest, retries: [{ ...delivered, void: 'startup refused: fixture' }], now: judged }).notReviewed, 2,
    'a retry voided after a refused startup never counts');
});
// MONO-482: one extra round per attempt on the strict path, only after its rounds are spent, only for a narrow remainder
// (at most one open finding, none raising the risk, out of the contract or an open owner remark), bound to the attempt's
// third spent receipt.
test("MONO-482 extra round: who may have one, and which grant the gate counts", () => {
  const pins = { file: '/root/dispatch/MONO-1-a1/pins.json', digest: 'd' }, base = 'b'.repeat(40), contractDigest = 'c'.repeat(64);
  let clock = 0;
  const time = () => new Date(Date.UTC(2026, 10, 25, 0, clock++)).toISOString();
  const receipt = (outcome, findings = [], extra = {}) => ({ producer: REVIEW_PRODUCER, recordedAt: time(), runId: `run-${clock}`, pins, head: String(clock % 10).repeat(40), base,
    review: { outcome, spent: !['not-reviewed', 'refused'].includes(outcome), contractDigest, successors: [], record: { outcome, findings }, ...extra } });
  const open = (key = 'k1', extra = {}) => reviewed({ key, ...extra });
  const spent = findings => [receipt('not-converged', [open()]), receipt('not-converged', [open()]), receipt('not-converged', findings)];
  const decide = (receipts, extra = {}) => extraRoundRefusal(receipts, { pins, risk: 'risky', grants: [], ...extra });
  const one = spent([open()]);
  assert.deepEqual(decide(one), { refusal: null, receipt: one[2].runId }, 'one open finding after three rounds: granted, bound to the third receipt');
  const clean = spent([]); assert.deepEqual(decide(clean), { refusal: null, receipt: clean[2].runId }, 'a clean third round and a later fix: granted');
  const accepted = spent([open('k1'), open('k2')]); accepted[2].review = { ...accepted[2].review, outcome: 'clean-with-successors', successors: [{ key: 'k1', line: 'P2' }, { key: 'k2', line: 'P2' }] };
  assert.equal(decide(accepted).refusal, null, 'successor candidates of an accepted round are not open findings');
  // In a round that did not converge every leftover counts, an older defect the worker did not fix too.
  assert.match(decide(spent([open('k1', { danger: true }), open('k2', { origin: 'pre-existing' })])).refusal, /2 findings open/);
  for (const [name, receipts, extra, refusal] of [
    ['rounds left', spent([open()]).slice(0, 2), {}, /rounds left \(2 of 3 spent\)/],
    ['two open findings', spent([open('k1'), open('k2')]), {}, /2 findings open; the extra round is for at most one/],
    ['a raised risk, even closed', spent([open('k1'), open('k2', { status: 'closed', riskRaised: true })]), {}, /raised the risk or found work outside the contract/],
    ['out of contract', spent([open('k1', { outOfContract: true })]), {}, /raised the risk or found work outside the contract/],
    ['an open owner remark', spent([open('k1', { class: 'pr-remark', source: 'owner' })]), {}, /owner remark on the PR is open/],
    ['the fast path', spent([open()]), { risk: 'standard' }, /strict path \(risky\) only/],
    ['a second grant', spent([open()]), { grants: [{ number: 1, reason: 'QA fix', recordedAt: time(), receipt: 'run-x' }] }, /one extra round per attempt/],
  ]) assert.match(decide(receipts, extra).refusal ?? '', refusal, name);
  assert.equal(decide(one, { grants: [{ number: 1, reason: 'QA fix', recordedAt: time(), receipt: 'run-x', void: 'startup refused: fixture' }] }).refusal, null,
    'a grant voided after a refused startup leaves the attempt its extra round');
  const otherAttempt = one.map(item => ({ ...item, pins: { ...pins, file: '/root/dispatch/MONO-1-a2/pins.json' } }));
  assert.match(decide(otherAttempt).refusal, /rounds left \(0 of 3 spent\)/, 'another attempt\'s rounds never count');
  // The gate counts a grant only bound to this attempt's third spent receipt, delivered before the collection, not void.
  const grant = { number: 1, reason: 'QA fix', recordedAt: time(), receipt: one[2].runId }, now = time();
  assert.equal(extraRoundGranted(one, { pins, grants: [grant], now }), true);
  assert.equal(extraRoundGranted(one, { pins, grants: [{ ...grant, receipt: one[1].runId }], now }), false, 'bound to another receipt');
  assert.equal(extraRoundGranted(one, { pins, grants: [{ ...grant, void: 'startup refused: x' }], now }), false, 'void');
  assert.equal(extraRoundGranted(one, { pins, grants: [{ ...grant, recordedAt: '2099-01-01T00:00:00.000Z' }], now }), false, 'dated after the collection');
  assert.equal(extraRoundGranted(otherAttempt, { pins, grants: [grant], now }), false, 'never carried into a new attempt');
  assert.equal(extraRoundGranted(one.slice(0, 2), { pins, grants: [grant], now }), false);
  // A review retry after the grant (an environmental not-reviewed pair on the fourth round's head) neither spends
  // a round nor touches the grant: the two stay independent, only never in one resume.
  const fourthHead = '9'.repeat(40), env = () => ({ ...receipt('not-reviewed'), head: fourthHead, review: { outcome: 'not-reviewed', spent: false, cause: 'environment', contractDigest,
    failures: [{ role: 'code-review', attempt: 1, cause: 'timeout' }] } });
  const streak = [...one, env(), env()], retried = reviewHistory(streak, { pins, head: fourthHead, base, contractDigest, retries: [{ number: 1, recordedAt: time() }], now: time() });
  assert.deepEqual([retried.spent, retried.notReviewed, extraRoundGranted(streak, { pins, grants: [grant], now: time() })], [3, 0, true]);
  // The fourth round judges leftovers like the third.
  assert.equal(roundOutcome({ outcome: 'not-converged', findings: [reviewed()] }, 4, true).outcome, 'clean-with-successors');
  assert.equal(roundOutcome({ outcome: 'not-converged', findings: [reviewed({ danger: true })] }, 4, true).outcome, 'not-converged');
});
test("MONO-482 extra round lines: round 4 of 4 (extra), a not-converged extra round needs a decision, round 3 names the extra round", () => {
  const base = "b".repeat(40);
  const receipt = review => ({ producer: REVIEW_PRODUCER, head, base, risk: 'risky', consistency: { passed: true, error: null },
    verification: { exitCode: null }, workerVerification: { head, exitCode: 0 }, review: { outcome: 'clean', round: 4, limit: 4, successors: [], record: { findings: [reviewed()] }, ...review } });
  assert.match(validatePreflight(receipt({}), head, base), /^review clean \(round 4 of 4 \(extra\)\) and verification verified on head$/);
  assert.throws(() => validatePreflight(receipt({ outcome: 'not-converged' }), head, base),
    { message: /^needs-decision: review not-converged after round 4 of 4 \(extra round used\); 1 open: P2 a\.mjs:3 Leftover/ });
  assert.throws(() => validatePreflight(receipt({ outcome: 'not-converged', round: 3, limit: 3 }), head, base),
    { message: /^needs-decision: review not-converged after round 3 of 3; 1 open: .*; the orchestrator may resume with extraRound for one extra round/ });
  assert.throws(() => validatePreflight(receipt({ outcome: 'not-converged', round: 2, limit: 4 }), head, base), { message: /^review not-converged \(round 2 of 4\); fix and request the next round/ });
  // A fast-path receipt never mentions the extra round.
  assert.throws(() => validatePreflight({ ...receipt({ outcome: 'not-converged', round: 1, limit: 1 }), risk: 'standard' }, head, base),
    error => /^review not-converged \(round 1 of 1\); fix, run the full verification/.test(error.message) && !/extraRound/.test(error.message));
});
test('shared review context refreshes the remote base, uses HEAD while dirty, and reads this attempt\'s current-contract rounds with delivered task changes', async () => {
  const { execFileSync } = await import('node:child_process');
  const { atomicJson } = await import('./runtime.mjs');
  const { recordTaskChange, dropTaskChange, taskChanges } = await import('./orchestrator/command-state.mjs');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-context-'));
  try {
    const repo = path.join(scratch, 'repo'), origin = path.join(scratch, 'origin.git');
    fs.mkdirSync(repo);
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const commit = message => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', message); return git('rev-parse', 'HEAD'); };
    git('init', '-b', 'main'); const first = commit('base');
    git('init', '--bare', origin); git('remote', 'add', 'origin', origin); git('push', 'origin', 'main');
    const second = commit('new base'); git('push', 'origin', 'main');
    git('update-ref', 'refs/remotes/origin/main', first); // Simulate a worker's stale remote ref.
    git('switch', '-c', 'delivery'); const tip = commit('work');
    fs.writeFileSync(path.join(repo, 'dirty'), 'uncommitted');
    const root = path.join(scratch, 'control'), attempt = path.join(root, 'dispatch/MONO-999-a1');
    fs.mkdirSync(path.join(attempt, 'snapshot'), { recursive: true });
    fs.writeFileSync(path.join(attempt, 'snapshot/issue-MONO-999.md'), 'Approved task.');
    const pins = { file: path.join(attempt, 'pins.json'), digest: 'a'.repeat(64) };
    const url = 'https://linear.app/darkdepot/issue/MONO-999/x#comment-1';
    recordTaskChange(attempt, url, `Изменение задачи: ${url}\nNarrow to input.mjs.`);
    assert.throws(() => recordTaskChange(attempt, url, 'no link in the text'), /quoted in the resume file/);
    const undelivered = recordTaskChange(attempt, url + '0', `Undelivered: ${url}0`);
    dropTaskChange(attempt, { ...undelivered, number: 9 }); assert.equal(taskChanges(attempt).length, 2, 'only the exact recorded change is dropped');
    dropTaskChange(attempt, undelivered); assert.equal(taskChanges(attempt).length, 1, 'a refused spawn drops its undelivered change');
    const evidenceRoot = path.join(scratch, 'evidence'); fs.mkdirSync(path.join(evidenceRoot, 'history'), { recursive: true });
    const expected = `Approved task.\n\n## Изменение задачи 1 (${url})\nИзменение задачи: ${url}\nNarrow to input.mjs.`;
    const receipt = { producer: REVIEW_PRODUCER, pins, head: tip, base: second, recordedAt: '2026-11-15T00:00:01Z',
      review: { spent: true, contractDigest: digest(expected), record: {}, outcome: 'clean' } };
    const seal = (name, value) => atomicJson(path.join(evidenceRoot, 'history', name + '.json'), { receipt: value });
    seal('valid', receipt);
    seal('other-attempt', { ...receipt, pins: { ...pins, file: path.join(root, 'dispatch/MONO-999-a2/pins.json') } });
    fs.symlinkSync(path.join(evidenceRoot, 'history', 'valid.json'), path.join(evidenceRoot, 'history', 'linked.json'));
    const request = { worktree: repo, baseRef: 'origin/main', evidenceRoot, pins };
    const result = reviewContext(request, {});
    assert.equal(result.head, tip); assert.equal(result.base, second);
    assert.equal(git('rev-parse', 'origin/main'), second, 'base refresh uses the gate remote fetch');
    assert.equal(result.contract, expected); assert.equal(result.contractDigest, digest(expected));
    assert.equal(result.history.spent, 1); assert.deepEqual(result.history.reuse, receipt);
    const live = reviewContext(request, {}, first);
    assert.equal(live.base, first, 'the live PR base remains authoritative'); assert.equal(live.history.reuse, null);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
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
    // MONO-488: the work's own cause is named from the receipt; login is mentioned only for a login failure.
    [{ review: { outcome: 'not-reviewed', round: null, reason: 'role failed', repeated: true } }, /^blocked: not-reviewed twice in a row on this head \(review\); resume with a task change: role failed$/],
    [{ review: { outcome: 'not-reviewed', round: null, reason: 'Codex did not complete', repeated: true } },
      /^blocked: not-reviewed twice in a row on this head \(review: malformed or incomplete reviewer answer\); resume with a task change: Codex did not complete$/],
    [{ review: { outcome: 'not-reviewed', round: null, reason: 'incomplete changed-file coverage after focused pass', repeated: true } },
      /^blocked: not-reviewed twice in a row on this head \(review: incomplete coverage of the changed files\); resume with a task change: incomplete changed-file coverage after focused pass$/],
    [{ review: { outcome: 'not-reviewed', round: null, reason: 'role failed (1); no response admitted', repeated: true, streakWork: ['CLI login', 'malformed or incomplete reviewer answer'] } },
      /^blocked: not-reviewed twice in a row on this head \(review: CLI login, malformed or incomplete reviewer answer\); check that both review CLIs are logged in, then resume with a task change: role failed/],
    [{ review: { outcome: 'not-reviewed', round: null, reason: 'role failed (timeout)', repeated: true, cause: 'environment', causes: ['timeout', 'host-slept'] } },
      /^blocked: not-reviewed twice in a row on this head \(environment: timeout, host-slept\); restore the environment \(host awake, load down, network, CLI login\) and resume the worker with reviewRetry, without a task change: role failed \(timeout\)$/],
    [{ review: { outcome: 'refused', round: null, reason: 'needs-decision: review round limit reached' } }, /^needs-decision: review round limit reached$/],
    [{ verification: { exitCode: 1, sandbox: { mode: "workspace-write", probed: true } } }, /^needs-decision: verification failed/],
    [{ verification: { exitCode: null } }, /^worker verification missing on this head/],
    [{ verification: { exitCode: null }, workerVerification: { head, exitCode: 1 } }, /^worker verification missing on this head/],
    [{ verification: { exitCode: null }, workerVerification: { head: "c".repeat(40), exitCode: 0 } }, /^worker verification missing on this head/],
    [{ verification: { exitCode: 0, sandbox: { mode: "workspace-write", probed: false } } }, /sandbox proof missing/],
    [{ consistency: { passed: false, error: 'head or base changed during verification' } }, /consistency failed or missing: head or base changed/],
    // MONO-457: a host verification receipt needs its own exit 0; neither the worker's word nor a sandbox proof replaces it.
    [{ verification: { host: true, head, exitCode: 1, log: '/e/v.log', tail: 'ps:\n  failed' }, workerVerification: { head, exitCode: 0 } },
      /^verification failed on this head on the host \(exit 1\); fix and request again, the same head too for a flaky run; log \/e\/v\.log; tail: ps: failed$/],
    [{ verification: { host: true, exitCode: null, sandbox: { mode: "workspace-write", probed: true } } }, /^verification failed on this head on the host \(exit null\)/],
    // MONO-462: a green host run counts only bound to the head its clean checkout held.
    [{ verification: { host: true, exitCode: 0, log: '/e/v.log' } }, /^host verification is not bound to this head: request a new collection$/],
    [{ verification: { host: true, head: "c".repeat(40), exitCode: 0, log: '/e/v.log' } }, /^host verification is not bound to this head/],
  ]) assert.throws(() => validatePreflight(receipt(extra), head, base), { message: refusal });
  assert.match(validatePreflight(receipt({ verification: { host: true, head, exitCode: 0, log: '/e/v.log' } }), head, base),
    /^review clean \(round 1 of 3\) and host verification verified on head$/);
  // The collection no longer verifies: its receipt passes only with the worker's full verification of this head.
  assert.match(validatePreflight(receipt({ verification: { command: 'node', args: ['verify.mjs'], exitCode: null }, workerVerification: { head, exitCode: 0 } }), head, base),
    /^review clean \(round 1 of 3\) and verification verified on head$/);
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
  const { spawnSync, spawn } = await import("node:child_process");
  const { atomicJson, canonical, digest } = await import("./runtime.mjs");
  const { sha256File, recordTaskChange, recordReviewRetry } = await import("./orchestrator/command-state.mjs");
  const files = fs.readdirSync("scripts/fixtures").filter(name => /^(collection-u13|collection-idea|collection-review)-.*\.json$/u.test(name));
  for (const name of files) await t.test(name, async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join("scripts/fixtures", name), "utf8"));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-u13-cli-"));
    try {
      const repo = path.join(scratch, "repo"), root = path.join(scratch, "orchestrator"), evidence = path.join(scratch, "evidence"), skills = path.join(scratch, "skills"), bin = path.join(scratch, "bin");
      for (const dir of [repo, root, evidence, skills, bin]) fs.mkdirSync(dir);
      const env = { ...process.env, HOME: path.join(scratch, "home"), PATH: `${bin}:${process.env.PATH}` };
      const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
      const git = (...args) => { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
      write(path.join(repo, ".gitignore"), ".orchestrator/\n");
      git("init", "-b", "delivery"); git("add", ".gitignore"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
      const head = git("rev-parse", "HEAD");
      for (const policy of ["model-policy.md"]) write(path.join(skills, "references", policy), fs.readFileSync(path.join("references", policy), "utf8"));
      // The collection runs only the review roles: any other codex call (the old sandbox) fails the fixture.
      installReviewClis(bin);
      const pinsFile = path.join(root, "dispatch/MONO-999-a1/pins.json");
      write(path.join(path.dirname(pinsFile), "snapshot/issue-MONO-999.md"), "# MONO-999\n\nFixture task contract.\n");
      const pins = { product: "fixture", root, worktree: repo, skillsRoot: skills, baseRef: "HEAD", evidenceRoot: evidence,
        risk: "standard", critical: null, verification: { command: process.execPath, args: ["-e", "process.exit(0)"] }, workerWritableRoots: [repo] };
      // AC4: preserve the complete old manifest; obsolete fields are ignored, never trimmed.
      if (fixture.mode === "compatibility") {
        const archive = path.join(evidence, "datasets/fixture.v1.md");
        if (fixture.populated) { write(archive, "Old archived decisions.\n"); write(archive + ".sha256", sha256File(archive) + "\n"); }
        Object.assign(pins, { reviewDataset: fixture.populated ? archive : null,
          reviewDatasetVersion: fixture.populated ? 1 : 0, reviewDatasetDigest: fixture.populated ? sha256File(archive) : null });
      }
      if (fixture.mode.startsWith("review-")) {
        git("branch", "review-base"); pins.baseRef = "review-base";
        // The strict path keeps up to three rounds; the fast path has one.
        if (fixture.mode === "review-rounds" || fixture.mode.startsWith("review-extra")) pins.risk = "risky";
        pins.verification.args = ["-e", `const fs=require('node:fs');fs.mkdirSync('.orchestrator',{recursive:true});fs.writeFileSync('.orchestrator/verify-saw',fs.readFileSync(${JSON.stringify(path.join(bin, "review.log"))},'utf8'))`];
      }
      if (fixture.mode.startsWith("review-host") || fixture.mode === "review-extra-host") {
        // MONO-462: Git routing inherited by the collection never reaches the command (it would read the worker's copy).
        Object.assign(env, { GIT_DIR: path.join(repo, ".git"), GIT_WORK_TREE: repo });
        // MONO-457: the verification exits with the code in verify-exit, logs where and how it ran, and on verify-tamper
        // plants a receipt for this attempt in the evidence history. MONO-462: on verify-probe (the QA probe) it writes an
        // uncommitted fix into the worker's copy, reads input.mjs where it runs, puts the copy back and fails without the fix.
        pins.hostVerification = true;
        const control = JSON.stringify(scratch), history = JSON.stringify(path.join(evidence, "history"));
        pins.verification.args = ["-e", `const fs=require('node:fs'),p=require('node:path'),d=${control};
const read=n=>{try{return fs.readFileSync(p.join(d,n),'utf8').trim()}catch{return null}};
fs.appendFileSync(p.join(d,'verify-runs'),JSON.stringify({cwd:process.cwd(),tmp:process.env.TMPDIR,gitDir:process.env.GIT_DIR??null,head:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()})+'\\n');
if(read('verify-psfail'))fs.writeFileSync(p.join(d,'ps-fail'),'1');
const w=read('verify-probe');if(w){const f=p.join(w,'input.mjs'),kept=fs.readFileSync(f);fs.writeFileSync(f,kept+'// uncommitted fix\\n');const seen=fs.readFileSync('input.mjs','utf8');fs.writeFileSync(f,kept);if(!seen.includes('uncommitted fix')){console.log('FAIL add broken');process.exit(1);}}
const t=read('verify-tamper');if(t){const x=JSON.parse(t);fs.writeFileSync(p.join(${history},'planted.json'),JSON.stringify({receipt:{producer:'gate-review-v3',pins:{file:x.pins},collectionId:x.collectionId,verification:{host:true,exitCode:0}}}));fs.appendFileSync(x.edit,' ');}
const sc=read('verify-screen');if(sc){const x=JSON.parse(sc);fs.mkdirSync(p.dirname(x.file),{recursive:true});fs.writeFileSync(x.file,JSON.stringify(x.body));}
if(read('verify-child')){const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>require("node:fs").writeFileSync('+JSON.stringify(read('verify-child'))+',"{}"),1500)'],{stdio:'ignore'});c.unref();}
const code=Number(read('verify-exit')??0);if(code)console.log('FAIL fixture step');console.log('host verify output: process table read');process.exit(code);`];
      }
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
      // MONO-481: the screen check before the first review round, pinned like hostVerification.
      if (fixture.mode.endsWith("-screen")) pins.screenCheck = true;
      atomicJson(pinsFile, pins);
      const binding = { file: pinsFile, digest: sha256File(pinsFile) };
      const entry = { issue: "MONO-999", attempt: 1, stage: "mono-deliver", worktree: repo,
        packVersion: "fixture", sourceCommit: "b".repeat(40), surfaceRevision: 4, pins: binding, pinsVersion: 0 };
      const registryFile = path.join(root, "workers.json");
      const register = () => atomicJson(registryFile, { "MONO-999": entry }); register();
      // The worker ran the full verification on this head before asking for the collection.
      let request = { ...pins, head, collect: false, collectionId: `preflight-collect:${head}:1`, pins: binding, workerVerification: { head, exitCode: 0 } };
      const file = path.join(scratch, "request.json"), receiptFile = path.join(evidence, `${head}.json`);
      const call = value => { atomicJson(file, value); return spawnSync(process.execPath, ["scripts/gate.mjs", "preflight", "--request", file], { env, encoding: "utf8" }); };
      const admit = async value => {
        if(!fs.existsSync(registryFile))return;
        // The collector's ledger: earlier rounds of the fixture are closed before the next admission.
        const {admitRound,recordResult,readLedger,inFlight}=await import('./review-rounds.mjs');
        for (const { admission } of inFlight(readLedger(root,'MONO-999',1))) if (admission.collectionId !== value.collectionId) recordResult(root,'MONO-999',1,admission,{status:'done'});
        return admitRound(root,'MONO-999',1,{...value,collect:false});
      };
      const collect = async (value, expected = 0) => { await admit(value); const r = call({ ...value, collect: true }); assert.equal(r.status, expected, r.stdout + r.stderr); return JSON.parse(fs.readFileSync(receiptFile, "utf8")); };
      const seal = envelope => atomicJson(receiptFile, envelope);
      if (fixture.mode === "compatibility") {
        delete request.reviewDatasetDigest;
        if (!fixture.populated) delete request.reviewDataset;
        // An old manifest with retired fields still collects, and an old signed receipt still reads.
        await collect(request);
        const envelope = JSON.parse(fs.readFileSync(receiptFile));
        assert.equal(Object.hasOwn(envelope.receipt, "reviewDataset"), false, "new gate receipt omits retired binding");
        assert.equal(Object.hasOwn(envelope, "signature"), false, "receipts are no longer signed");
        const beforeArchive = fixture.populated ? fs.readFileSync(pins.reviewDataset) : null;
        envelope.receipt.reviewDataset = fixture.populated ? { source: pins.reviewDataset, digest: pins.reviewDatasetDigest,
          copy: ".orchestrator/review-dataset-old.md", archive: pins.reviewDataset, version: 1 } : null;
        envelope.signature = "0".repeat(64); seal(envelope);
        if (fixture.populated) fs.unlinkSync(pins.reviewDataset);
        assert.equal(call(request).status, 0, "old signed receipt reads without inspecting the obsolete archive");
        if (fixture.populated) write(pins.reviewDataset, beforeArchive);
        else assert.equal(fs.existsSync(path.join(evidence, "datasets")), false);
        return;
      }
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
          assert.equal(fs.existsSync(receiptFile), false); return;
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
        const at = (tip, n = 1, pinned = binding) => ({ ...request, head: tip, collectionId: `preflight-collect:${tip}:${n}`, pins: pinned, workerVerification: { head: tip, exitCode: 0 } });
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
        assert.deepEqual([reviewCalls(bin), fs.existsSync(verifySaw)], [['reviewer', 'reviewer', 'checker'], false], 'the collection never runs the verification');
        receipt = await round(at(first, 2), 1, /review not-converged \(round 1 of 3\)/);
        assert.equal(receipt.review.spent, false); assert.ok(receipt.review.reusedFrom); assert.equal(reviewCalls(bin).length, 3, 'the same head reuses its round');
        // A role that cannot run spends no round.
        setReview(bin, { loggedOut: 'codex' });
        const offline = commit('export const offline = 0;\n');
        receipt = await round(at(offline), 1, /fail: not-reviewed: .*no round spent, request this head once more/);
        assert.deepEqual([receipt.review.spent, receipt.review.record], [false, null]);
        await round(at(offline, 2), 1, /fail: blocked: not-reviewed twice in a row on this head/);
        const blocked = call(at(offline, 3)); assert.equal(blocked.status, 1); assert.match(blocked.stdout, /fail: blocked: not-reviewed twice in a row/);
        assert.match(blocked.stdout, /environment: login/, 'a logged-out Codex is an environmental login cause');
        setReview(bin, { loggedOut: null, findings: [], verdict: closing });
        const second = commit('export const two = 2;\n');
        // A bot remark from the draft PR, fixed on this head: it enters the round and is signed with the receipt.
        const prRemarks = [{ id: 'PRRT_1', source: 'bot', file: 'input.mjs', line: 1, title: 'Remark from the PR bot', body: 'one is not validated', urgent: false, head: offline }];
        const withRemarks = (value, extra = {}) => ({ ...value, prRemarks, ...extra });
        receipt = await round(withRemarks(at(second)), 0, /pass: review clean \(round 2 of 3\) and verification verified on head/);
        assert.deepEqual(receipt.prRemarks, prRemarks, 'the remarks are bound in the signed receipt');
        assert.ok(receipt.review.record.findings.some(finding => finding.class === 'pr-remark' && finding.status === 'closed'), 'the checker closed the fixed remark');
        const unbound = call(at(second)); assert.equal(unbound.status, 1); assert.match(unbound.stdout, /collection request mismatch: admission; expected "the admitted round request for collectionId"/);
        const malformed = call(withRemarks(at(second, 2), { prRemarks: [{ ...prRemarks[0], file: '../outside' }] })); assert.equal(malformed.status, 1); assert.match(malformed.stdout, /invalid PR remark location/);
        assert.deepEqual([fs.existsSync(verifySaw), receipt.verification], [false, { ...pins.verification, exitCode: null }], 'the collection records the verification unrun');
        const gh = path.join(bin, 'gh');
        write(gh, `#!/usr/bin/env node
const a=process.argv.slice(2),empty={nodes:[],pageInfo:{hasNextPage:false}};
const pr={headRefOid:${JSON.stringify(second)},baseRefOid:${JSON.stringify(base)},baseRefName:'delivery',state:'OPEN',mergeStateStatus:'CLEAN',mergeable:'MERGEABLE',reviewThreads:empty};
console.log(JSON.stringify(a.includes('graphql')?{data:{repository:{pullRequest:pr,object:{statusCheckRollup:{contexts:empty}}}}}:a.includes('user')?{login:'fixture'}:[]));
`); fs.chmodSync(gh, 0o700);
        const judgmentFile = path.join(scratch, 'judgment.json'), stateFile = path.join(scratch, 'ship.json'); atomicJson(judgmentFile, { ...judgment(), head: second });
        const ship = () => { atomicJson(file, { preflight: withRemarks(at(second)), repo: 'fixture/repo', number: 1, attempt: 1, stateFile, judgmentFile, watch: false });
          return spawnSync(process.execPath, ['scripts/gate.mjs', 'ship', '--request', file], { env, encoding: 'utf8' }); };
        let shipped = ship(); assert.match(shipped.stdout, /fail: checks not created on head/, shipped.stdout + shipped.stderr);
        assert.equal(JSON.parse(fs.readFileSync(stateFile)).preflightReceipt.runId, receipt.runId, 'ship read the signed review receipt');
        const sealed = fs.readFileSync(stored(second)), old = JSON.parse(sealed); old.receipt.producer = 'gate-autoreview-v2';
        atomicJson(stored(second), old);
        for (const refused of [ship(), call(withRemarks(at(second)))]) { assert.equal(refused.status, 1); assert.match(refused.stdout, /old receipt format/); }
        fs.writeFileSync(stored(second), sealed);
        // Without the worker's verification of this head the signed round does not pass; the same head with it does, without a new round.
        const calls2 = reviewCalls(bin).length, { workerVerification: _, ...unverified } = withRemarks(at(second, 2));
        await admit(unverified); const missing = call({ ...unverified, collect: true });
        assert.equal(missing.status, 1); assert.match(missing.stdout, /fail: worker verification missing on this head/);
        for (const exitCode of [0, 1]) {
          const answered = withRemarks(at(second, 3 + exitCode), { workerVerification: { head: second, exitCode } }); await admit(answered);
          for (const result of [call({ ...answered, collect: true }), call(answered)]) assert.equal(result.status, exitCode ? 1 : 0, result.stdout + result.stderr);
        }
        assert.equal(reviewCalls(bin).length, calls2, 'the same head reuses its round');
        setReview(bin, { findings: leftover('Second leftover'), verdict: reviewVerdict() });
        const third = commit('export const three = 3;\n');
        receipt = await round(at(third), 0, /pass: review clean-with-successors \(round 3 of 3\).*successor candidates: P2 input\.mjs:1 Second leftover/);
        assert.deepEqual(receipt.review.successors.map(item => item.line), ['P2 input.mjs:1 Second leftover']);
        assert.deepEqual(receipt.review.record.rounds.map(item => item.scope), ['full', 'fixes-and-open-findings', 'fixes-and-open-findings'], 'only the first round reads the whole change');
        const fourth = commit('export const four = 4;\n'), calls = reviewCalls(bin).length, limit = /^gate preflight: fail: needs-decision: review round limit reached \(3 of 3 on this task attempt\)/;
        const unpublished = call(at(fourth)); assert.equal(unpublished.status, 1, 'refused before the worker publishes'); assert.match(unpublished.stdout, limit);
        receipt = await round(at(fourth), 1, limit);
        assert.equal(receipt.review.outcome, 'refused'); assert.equal(reviewCalls(bin).length, calls, 'a fourth round is never launched');
        // A task change («Изменение задачи» plus resume) keeps the count and reaches the reviewer with the Issue.
        const url = 'https://linear.app/darkdepot/issue/MONO-999/x#comment-2', launchContract = receipt.review.contractDigest;
        recordTaskChange(path.dirname(pinsFile), url, `Изменение задачи: ${url}\nNarrow: only input.mjs.`);
        const fifth = commit('export const five = 5;\n');
        receipt = await round(at(fifth), 1, limit);
        assert.equal(receipt.review.outcome, 'refused'); assert.equal(reviewCalls(bin).length, calls, 'a task change keeps the count: no fourth round');
        assert.notEqual(receipt.review.contractDigest, launchContract);
        assert.equal(receipt.review.contractDigest, digest(`# MONO-999\n\nFixture task contract.\n\n\n## Изменение задачи 1 (${url})\nИзменение задачи: ${url}\nNarrow: only input.mjs.`), 'the reviewer reads the task change with the Issue');
        git('checkout', '-q', third);
        const stale = call(at(third)); assert.equal(stale.status, 1, 'a clean round from before the task change no longer counts');
        assert.match(stale.stdout, /the task changed after this review round/);
        return;
      }
      if (fixture.mode === 'review-environment') {
        // MONO-483: a review that did not happen because of the environment (here: the Codex role cannot resolve its host)
        // is retried by a plain resume with reviewRetry, without a task change; one that did not happen because of the
        // work itself (a malformed answer) still needs a task change.
        const author = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];
        const commit = text => { fs.appendFileSync(path.join(repo, 'input.mjs'), text); git('add', 'input.mjs'); git(...author, 'commit', '-m', text.trim()); return git('rev-parse', 'HEAD'); };
        const at = (tip, n = 1) => ({ ...request, head: tip, collectionId: `preflight-collect:${tip}:${n}`, workerVerification: { head: tip, exitCode: 0 } });
        const round = async (value, status, line) => {
          await admit(value);
          for (const result of [call({ ...value, collect: true }), call(value)]) { assert.equal(result.status, status, result.stdout + result.stderr); assert.match(result.stdout, line); }
          return JSON.parse(fs.readFileSync(path.join(evidence, `${value.head}.json`), 'utf8')).receipt;
        };
        const attempt = path.dirname(pinsFile), changes = path.join(attempt, 'task-changes.json'), retries = path.join(attempt, 'review-retries.json');
        const leftover = [reviewFinding('input.mjs', { anchor: 'Leftover', title: 'Leftover' })];
        // Control first: a malformed answer is the work's own cause; a review retry does not clear its streak.
        setReview(bin, { failRole: 'malformed', findings: leftover });
        const broken = commit('export const broken = 1;\n');
        let receipt = await round(at(broken), 1, /fail: not-reviewed: /);
        assert.equal(receipt.review.cause, 'review');
        assert.ok(receipt.review.failures.filter(item => item.role).every(item => item.cause === 'other'));
        assert.deepEqual(receipt.review.workCauses, ['malformed or incomplete reviewer answer']);
        // MONO-488: the blocked line names the malformed answer, not a login, on the round's own line and on later requests.
        const malformedLine = /fail: blocked: not-reviewed twice in a row on this head \(review: malformed or incomplete reviewer answer\); resume with a task change/;
        receipt = await round(at(broken, 2), 1, malformedLine);
        for (const text of [fs.readFileSync(path.join(evidence, `${broken}.json`), 'utf8'), call(at(broken, 2)).stdout]) assert.doesNotMatch(text, /logged in/);
        recordReviewRetry(attempt);
        const still = call(at(broken, 3)); assert.equal(still.status, 1); assert.match(still.stdout, malformedLine); assert.doesNotMatch(still.stdout, /logged in/);
        const calls = reviewCalls(bin).length;
        await round(at(broken, 3), 1, malformedLine);
        assert.equal(reviewCalls(bin).length, calls, 'no role runs on a blocked work streak');
        // MONO-488: incomplete coverage of the changed files is named the same way.
        setReview(bin, { failRole: null, skipCoverage: true });
        const uncovered = commit('export const uncovered = 1;\n');
        receipt = await round(at(uncovered), 1, /fail: not-reviewed: incomplete changed-file coverage after focused pass; no round spent/);
        assert.deepEqual([receipt.review.cause, receipt.review.workCauses], ['review', ['incomplete coverage of the changed files']]);
        const coverageLine = /fail: blocked: not-reviewed twice in a row on this head \(review: incomplete coverage of the changed files\); resume with a task change/;
        await round(at(uncovered, 2), 1, coverageLine);
        const parkedCoverage = call(at(uncovered, 3)); assert.match(parkedCoverage.stdout, coverageLine); assert.doesNotMatch(parkedCoverage.stdout, /logged in/);
        setReview(bin, { skipCoverage: false });
        // The environment: the Codex role cannot resolve its host on a new head.
        setReview(bin, { failRole: 'network' });
        const offline = commit('export const offline = 0;\n');
        receipt = await round(at(offline), 1, /fail: not-reviewed: .*Could not resolve host.*no round spent, request this head once more/);
        assert.deepEqual([receipt.review.spent, receipt.review.cause], [false, 'environment']);
        assert.deepEqual(receipt.review.failures.filter(item => item.role).map(item => item.cause), ['network', 'network'], 'each failed role attempt names its cause');
        for (const side of ['start', 'end']) assert.ok(Number.isFinite(receipt.review.host[side].load1) && receipt.review.host[side].cpus > 0, `host load at the ${side} of the round`);
        assert.equal(typeof receipt.review.host.slept, 'boolean');
        const contractDigest = receipt.review.contractDigest;
        receipt = await round(at(offline, 2), 1, /fail: blocked: not-reviewed twice in a row on this head \(environment: network\); restore the environment .*resume the worker with reviewRetry, without a task change/);
        assert.equal(receipt.review.cause, 'environment');
        const parked = call(at(offline, 3)); assert.equal(parked.status, 1); assert.match(parked.stdout, /fail: blocked: not-reviewed twice in a row on this head \(environment: network\).*reviewRetry/);
        // The orchestrator restored the network and resumed the worker with reviewRetry: the next collection on the same head runs a round.
        setReview(bin, { failRole: null });
        recordReviewRetry(attempt);
        receipt = await round(at(offline, 3), 1, /fail: review not-converged \(round 1 of 1\)/);
        assert.deepEqual([receipt.review.spent, receipt.review.round, receipt.review.contractDigest], [true, 1, contractDigest], 'a review retry keeps the contract');
        assert.ok(receipt.review.host && receipt.review.record && !Object.hasOwn(receipt.review.record, 'host'), 'host facts sit on the review, not in the stage record');
        assert.equal(fs.existsSync(changes), false, 'no task change was recorded');
        assert.deepEqual(JSON.parse(fs.readFileSync(retries, 'utf8')).map(item => item.number), [1, 2]);
        // The fast path gets no extra round from a retry: the fixed head passes on the worker's verification, no role runs.
        recordReviewRetry(attempt);
        const fixed = commit('export const fixed = 1;\n'), before = reviewCalls(bin).length;
        receipt = await round(at(fixed), 0, /pass: review clean \(round 1 of 1\), fixes after it confirmed by the worker's full verification/);
        assert.deepEqual([reviewCalls(bin).length, receipt.review.spent], [before, false]);
        return;
      }
      if (fixture.mode === 'review-host') {
        // MONO-457: pinned hostVerification. The collection runs the full verification on the committed head outside the
        // worker sandbox, before the review round; the worker sends no workerVerification and never parks for it.
        const author = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];
        const commit = text => { fs.appendFileSync(path.join(repo, 'input.mjs'), text); git('add', 'input.mjs'); git(...author, 'commit', '-m', text.trim()); return git('rev-parse', 'HEAD'); };
        const { workerVerification: _, ...base } = request;
        const at = (tip, n = 1) => ({ ...base, head: tip, collectionId: `preflight-collect:${tip}:${n}` });
        const round = async (value, status, line) => {
          await admit(value);
          for (const result of [call({ ...value, collect: true }), call(value)]) { assert.equal(result.status, status, result.stdout + result.stderr); assert.match(result.stdout, line); }
          return JSON.parse(fs.readFileSync(path.join(evidence, `${value.head}.json`), 'utf8')).receipt;
        };
        const runs = () => fs.existsSync(path.join(scratch, 'verify-runs')) ? fs.readFileSync(path.join(scratch, 'verify-runs'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
        setReview(bin, { findings: [reviewFinding('input.mjs', { anchor: 'First leftover', title: 'First leftover' })] });
        // MONO-462: the checkout is a repository of its own: worker Git configuration that would apply only there
        // (a conditional include for the checkout's Git directory turning on a smudge filter) never runs.
        const smudged = path.join(scratch, 'smudged'), included = path.join(scratch, 'checkout-include.gitconfig');
        write(included, `[filter "probe"]\n\tsmudge = "sh -c 'touch ${smudged} && cat'"\n`);
        for (const pattern of ['gitdir:**/worktrees/**', 'gitdir:**/*.checkout/**']) git('config', `includeIf.${pattern}.path`, included);
        write(path.join(repo, '.gitattributes'), 'input.mjs filter=probe\n'); git('add', '.gitattributes');
        const first = commit('export const one = 1;\n');
        assert.equal(call(at(first)).status, 2, 'pending without workerVerification: the round verifies');
        // A red head: no review call, no round spent, the line names the log and its tail.
        write(path.join(scratch, 'verify-exit'), '1');
        let receipt = await round(at(first), 1, /fail: verification failed on this head on the host \(exit 1\); fix and request again, the same head too for a flaky run; log .*preflight-collect-[a-f0-9]{40}-1\.log; tail: FAIL fixture step$/m);
        assert.deepEqual([reviewCalls(bin).length, receipt.review.outcome, receipt.review.spent, receipt.verification.host, receipt.verification.exitCode], [0, 'refused', false, true, 1]);
        assert.match(fs.readFileSync(receipt.verification.log, 'utf8'), /host verify output/);
        const [ran] = runs();
        // MONO-462: the run executes in a clean checkout of exactly the head beside the marker, removed afterwards.
        assert.equal(ran.cwd, path.join(fs.realpathSync(evidence), 'verification', `preflight-collect-${first}-1.checkout`));
        assert.deepEqual([ran.head, receipt.verification.head, fs.existsSync(ran.cwd), ran.gitDir], [first, first, false, null]);
        assert.equal(git('worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1, 'no checkout left registered');
        assert.match(path.basename(ran.tmp), /^mono-host-verify-/);
        assert.equal(fs.existsSync(smudged), false, 'no worker filter ran for the checkout');
        assert.equal(fs.existsSync(ran.tmp), false, 'the private temporary directory is removed');
        // MONO-462 (QA probe): an uncommitted fix placed in the worker's copy during the run and put back before its end
        // does not turn the red head green; the worker's tree is clean at the end, so only the checkout catches it.
        write(path.join(scratch, 'verify-exit'), '0'); write(path.join(scratch, 'verify-probe'), repo);
        receipt = await round(at(first, 2), 1, /fail: verification failed on this head on the host \(exit 1\).*tail: FAIL add broken$/m);
        assert.deepEqual([reviewCalls(bin).length, receipt.review.spent, receipt.consistency.passed, git('status', '--porcelain')], [0, false, true, '']);
        fs.unlinkSync(path.join(scratch, 'verify-probe'));
        // The same head again (a flaky run): the verification reruns, then the round runs.
        receipt = await round(at(first, 3), 1, /fail: review not-converged \(round 1 of 1\); fix and request the final head; the collection runs the full verification on the host/);
        assert.deepEqual([runs().length, receipt.review.spent, receipt.verification.exitCode], [3, true, 0]);
        // Fast path: the fixed head passes on the host verification without a second round.
        const fixed = commit('export const fixed = 1;\n'), calls = reviewCalls(bin).length;
        assert.equal(call(at(fixed)).status, 2, 'the spent round still admits the fixed head for host verification');
        receipt = await round(at(fixed), 0, /pass: review clean \(round 1 of 1\), fixes after it confirmed by the full verification on the host, and host verification verified on head/);
        assert.deepEqual([reviewCalls(bin).length, receipt.review.spent, receipt.review.hostVerified, receipt.workerVerification], [calls, false, true, undefined]);
        // A run that plants a receipt for the next collection and edits an earlier one fails consistency; no review runs,
        // the planted receipt goes to quarantine and the edited one gets its bytes back, so the next request is pending.
        const history = path.join(evidence, 'history'), earlier = path.join(history, fs.readdirSync(history).sort()[0]), kept = fs.readFileSync(earlier);
        write(path.join(scratch, 'verify-tamper'), JSON.stringify({ pins: pinsFile, collectionId: `preflight-collect:${fixed}:3`, edit: earlier }));
        receipt = await round(at(fixed, 2), 1, /fail: collection consistency failed: evidence changed during host verification: history\/[^,]+\.json, history\/planted\.json/);
        assert.deepEqual([reviewCalls(bin).length, receipt.consistency.passed], [calls, false]);
        assert.deepEqual([fs.existsSync(path.join(history, 'planted.json')), fs.readdirSync(path.join(evidence, 'quarantine')).some(name => name.endsWith('-planted.json'))], [false, true]);
        assert.deepEqual(fs.readFileSync(earlier), kept, 'the edited receipt of this attempt is put back');
        fs.unlinkSync(path.join(scratch, 'verify-tamper'));
        assert.equal(call(at(fixed, 3)).status, 2, 'no planted receipt answers the next collection');
        // A descendant the command leaves behind is stopped with its group before it can write.
        const late = path.join(history, 'late.json'); write(path.join(scratch, 'verify-child'), late);
        await round(at(fixed, 3), 0, /pass: review clean \(round 1 of 1\)/);
        await new Promise(resolve => setTimeout(resolve, 2500));
        assert.equal(fs.existsSync(late), false, 'the descendant was stopped before writing');
        fs.unlinkSync(path.join(scratch, 'verify-child'));
        assert.equal(fs.readdirSync(path.join(evidence, 'verification')).some(name => name.endsWith('.running')), false, 'no marker after finished runs');
        // A receipt of a collection whose host run did not finish (marker left by a dead gate) is never read.
        const markerFile = path.join(evidence, 'verification', `preflight-collect-${fixed}-3.running`);
        write(markerFile, JSON.stringify({ collectionId: `preflight-collect:${fixed}:3`, group: null }));
        const unfinished = call(at(fixed, 3)); assert.equal(unfinished.status, 1); assert.match(unfinished.stdout, /host verification of this collection did not finish/);
        fs.unlinkSync(markerFile);
        // MONO-462: when the group stop cannot be confirmed (process table unreadable after the run), the checkout stays
        // with the marker for recovery, which removes it once the group is confirmed stopped.
        write(path.join(bin, 'ps'), `#!/bin/sh\nif [ -f ${JSON.stringify(path.join(scratch, 'ps-fail'))} ] && [ "$1" = "-axo" ]; then echo 'ps: denied' >&2; exit 1; fi\nexec /bin/ps "$@"\n`);
        fs.chmodSync(path.join(bin, 'ps'), 0o755); write(path.join(scratch, 'verify-psfail'), '1');
        const unconfirmed = at(fixed, 4); await admit(unconfirmed);
        const stuck = call({ ...unconfirmed, collect: true }); fs.rmSync(path.join(scratch, 'ps-fail'), { force: true }); fs.unlinkSync(path.join(scratch, 'verify-psfail'));
        assert.equal(stuck.status, 1, stuck.stdout + stuck.stderr); assert.match(stuck.stdout, /collection consistency failed: verification descendants unverified/);
        const keptCheckout = path.join(evidence, 'verification', `preflight-collect-${fixed}-4.checkout`), keptMarker = keptCheckout.replace(/\.checkout$/, '.running');
        assert.deepEqual([fs.existsSync(keptCheckout), fs.existsSync(keptMarker)], [true, true], 'kept while the group stop is unconfirmed');
        const { recoverHostRun, hostRunMarker } = await import('./review-rounds.mjs')
        assert.equal(typeof await recoverHostRun(evidence, `preflight-collect:${fixed}:4`, pinsFile), 'string');
        assert.deepEqual([fs.existsSync(keptCheckout), fs.existsSync(keptMarker)], [false, false], 'recovery removes the checkout after the confirmed stop');
        // MONO-482 review: one host run per root at a time. While another collection's marker is open this one is refused
        // before any worker code runs: no snapshot, no verification run, no review round, no round spent, not a not-reviewed.
        const otherMarker = path.join(evidence, 'verification', `preflight-collect-${'e'.repeat(40)}-1.running`);
        write(otherMarker, JSON.stringify({ collectionId: `preflight-collect:${'e'.repeat(40)}:1`, group: null, snapshot: [] }));
        const runsBefore = runs().length, reviewsBefore = reviewCalls(bin).length;
        const busy = await round(at(fixed, 5), 1, /fail: host verification preflight-collect-e{40}-1 is running or unrecovered in this orchestrator root; nothing ran and no round is spent, request this head again after it ends/);
        assert.deepEqual([runs().length, reviewCalls(bin).length, busy.review.outcome, busy.review.spent, fs.existsSync(hostRunMarker(evidence, `preflight-collect:${fixed}:5`))],
          [runsBefore, reviewsBefore, 'refused', false, false]);
        fs.rmSync(otherMarker);
        // The pin decides: a receipt without the host run (older sandbox form) never passes a pinned attempt.
        const stored = path.join(evidence, `${fixed}.json`), passing = JSON.parse(fs.readFileSync(history + '/' + fs.readdirSync(history).find(name => JSON.parse(fs.readFileSync(path.join(history, name))).receipt.collectionId === `preflight-collect:${fixed}:1`)));
        passing.receipt.verification = { ...pins.verification, exitCode: 0, sandbox: { mode: 'workspace-write', probed: true } };
        atomicJson(stored, passing);
        const sandboxed = call(at(fixed)); assert.equal(sandboxed.status, 1); assert.match(sandboxed.stdout, /host verification missing on this head/);
        return;
      }
      if (fixture.mode === 'review-screen' || fixture.mode === 'review-host-screen') {
        // MONO-481: pinned screenCheck. Before the attempt's first spent round the collection waits for the host's screen
        // check of exactly this head: waiting and mismatches run no reviewer, spend no round and never count toward
        // not-reviewed; from the first spent round on (task changes included) the collection no longer waits.
        const author = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];
        const commit = text => { fs.appendFileSync(path.join(repo, 'input.mjs'), text); git('add', 'input.mjs'); git(...author, 'commit', '-m', text.trim()); return git('rev-parse', 'HEAD'); };
        const host = fixture.mode === 'review-host-screen', { workerVerification: _, ...unverified } = request;
        const at = (tip, n = 1, extra = {}) => ({ ...(host ? unverified : { ...request, workerVerification: { head: tip, exitCode: 0 } }),
          head: tip, collectionId: `preflight-collect:${tip}:${n}`, ...extra });
        const round = async (value, status, line) => {
          await admit(value);
          for (const result of [call({ ...value, collect: true }), call(value)]) { assert.equal(result.status, status, result.stdout + result.stderr); assert.match(result.stdout, line); }
          return JSON.parse(fs.readFileSync(path.join(evidence, `${value.head}.json`), 'utf8')).receipt;
        };
        const screen = (tip, outcome) => {
          const r = spawnSync(process.execPath, ['scripts/orchestrator/qa.mjs', 'screen-check', '--pins', pinsFile, '--head', tip, '--outcome', outcome,
            '--report', `https://linear.app/darkdepot/issue/MONO-999/x#comment-screen-${outcome}`], { env, encoding: 'utf8' });
          assert.equal(r.status, 0, r.stdout + r.stderr);
        };
        const waiting = /fail: screen check on the host has no result for this head yet; no round spent/;
        const reviewers = () => reviewCalls(bin).filter(role => role === 'reviewer').length;
        const runs = () => fs.existsSync(path.join(scratch, 'verify-runs')) ? fs.readFileSync(path.join(scratch, 'verify-runs'), 'utf8').trim().split('\n').length : 0;
        setReview(bin, { findings: [reviewFinding('input.mjs', { anchor: 'First leftover', title: 'First leftover' })] });
        const first = commit('export const one = 1;\n');
        if (host) {
          // With host verification pinned too, a waiting head runs neither the verification nor the reviewer.
          let receipt = await round(at(first), 1, waiting);
          assert.deepEqual([runs(), reviewers(), receipt.review.spent, receipt.verification.exitCode], [0, 0, false, null]);
          screen(first, 'passed'); setReview(bin, { findings: [] });
          // Dispatch never pins both switches (round 3); these pins only exercise the gate's re-validation after a run.
          // Codex review round 2: a worker-authored host run that changes the approved design and exits 0 does not get
          // the round; the result is re-validated against the current snapshot after the run, never from a cached read.
          const design = path.join(path.dirname(pinsFile), 'snapshot/design.json');
          write(path.join(scratch, 'verify-screen'), JSON.stringify({ file: design, body: { forged: true } }));
          receipt = await round(at(first, 2), 1, waiting);
          assert.deepEqual([runs(), reviewers(), receipt.review.spent], [1, 0, false], 'the run happened, the round did not');
          fs.unlinkSync(path.join(scratch, 'verify-screen')); fs.unlinkSync(design);
          // The result lives in the host-owned ledger, not in evidenceRoot: nothing a host run is judged on, nothing to quarantine.
          assert.equal(fs.existsSync(path.join(evidence, 'screen-check')), false);
          receipt = await round(at(first, 3), 0, /pass: review clean \(round 1 of 1\) and host verification verified on head; screen check on the host passed on this head \(report .*#comment-screen-passed\)$/m);
          assert.deepEqual([runs(), reviewers(), receipt.review.spent], [2, 1, true]);
          return;
        }
        let receipt = await round(at(first), 1, waiting);
        assert.deepEqual([receipt.review.outcome, receipt.review.spent, reviewCalls(bin).length], ['refused', false, 0]);
        // Another head's result does not count: a file for another head, or this head's file naming another head.
        const other = 'e'.repeat(40);
        screen(other, 'passed'); await round(at(first, 2), 1, waiting);
        atomicJson(path.join(fs.realpathSync(root), 'consumed/MONO-999-a1/screen-check', `${first}.json`), { head: other, outcome: 'passed', report: 'x' });
        await round(at(first, 3), 1, waiting);
        // A result without the host's binding to this attempt's launch pins (hand-written) does not count either.
        atomicJson(path.join(fs.realpathSync(root), 'consumed/MONO-999-a1/screen-check', `${first}.json`), { head: first, outcome: 'passed', report: 'x' });
        await round(at(first, 5), 1, waiting);
        screen(first, 'mismatches');
        receipt = await round(at(first, 4), 1, /fail: screen check on the host found mismatches with the mockup on this head .*#comment-screen-mismatches\); fix them from the task change and request the new head; no round spent/);
        assert.deepEqual([receipt.review.spent, reviewCalls(bin).length], [false, 0]);
        // The fixed head needs its own screen check before the first round.
        const second = commit('export const second = 2;\n');
        await round(at(second), 1, waiting);
        screen(second, 'passed');
        // Waiting refusals never count toward not-reviewed: the first one after them is not yet blocked.
        setReview(bin, { loggedOut: 'codex' });
        receipt = await round(at(second, 2), 1, /fail: not-reviewed: .*no round spent, request this head once more/);
        setReview(bin, { loggedOut: null });
        // The round's line carries the host's result for this head: the worker cannot read evidenceRoot.
        receipt = await round(at(second, 3), 1, /fail: review not-converged \(round 1 of 1\).*; screen check on the host passed on this head \(report .*#comment-screen-passed\)$/m);
        assert.deepEqual([receipt.review.spent, reviewers(), receipt.screenCheck.head], [true, 1, second]);
        // From the first spent round on no screen check is needed: the fixed head passes on the worker's verification.
        const third = commit('export const third = 3;\n');
        await round(at(third), 0, /pass: review clean \(round 1 of 1\), fixes after it confirmed by the worker's full verification/);
        // A task change after the spent round gets its round without a screen check either.
        const url = 'https://linear.app/darkdepot/issue/MONO-999/x#comment-7';
        recordTaskChange(path.dirname(pinsFile), url, `Изменение задачи: ${url}\nRound the result.`);
        setReview(bin, { findings: [], verdict: reviewVerdict({ outcome: 'rejected', closed: true }) });
        await round(at(third, 2), 0, /pass: review clean \(round 1 of 1\) and verification verified on head/);
        assert.equal(reviewers(), 2);
        return;
      }
      if (fixture.mode === 'review-fast') {
        // AC1: one round, a fix, then the final head passes on the worker's full verification without a second round.
        const author = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];
        const commit = text => { fs.appendFileSync(path.join(repo, 'input.mjs'), text); git('add', 'input.mjs'); git(...author, 'commit', '-m', text.trim()); return git('rev-parse', 'HEAD'); };
        const at = (tip, n = 1, extra = {}) => ({ ...request, head: tip, collectionId: `preflight-collect:${tip}:${n}`, workerVerification: { head: tip, exitCode: 0 }, ...extra });
        const stored = tip => path.join(evidence, `${tip}.json`);
        const round = async (value, status, line) => {
          await admit(value);
          for (const result of [call({ ...value, collect: true }), call(value)]) { assert.equal(result.status, status, result.stdout + result.stderr); assert.match(result.stdout, line); }
          return JSON.parse(fs.readFileSync(stored(value.head), 'utf8')).receipt;
        };
        setReview(bin, { findings: [reviewFinding('input.mjs', { anchor: 'First leftover', title: 'First leftover' })] });
        const first = commit('export const one = 1;\n');
        let receipt = await round(at(first), 1, /fail: review not-converged \(round 1 of 1\); fix, run the full verification on the final head and request it with workerVerification/);
        assert.deepEqual([receipt.review.spent, receipt.review.limit], [true, 1]);
        const fixed = commit('export const fixed = 1;\n'), calls = reviewCalls(bin).length, spent = /fail: review round spent \(1 of 1 on this task attempt\); fix, run the full verification/;
        for (const workerVerification of [undefined, { head: first, exitCode: 0 }, { head: fixed, exitCode: 1 }]) {
          const refused = call(at(fixed, 1, { workerVerification })); assert.equal(refused.status, 1); assert.match(refused.stdout, spent);
        }
        const malformed = call(at(fixed, 1, { workerVerification: { head: fixed, exitCode: 0, note: 'x' } })); assert.equal(malformed.status, 1); assert.match(malformed.stdout, /workerVerification must be/);
        const verified = at(fixed, 1, { workerVerification: { head: fixed, exitCode: 0 } });
        receipt = await round(verified, 0, /pass: review clean \(round 1 of 1\), fixes after it confirmed by the worker's full verification, and verification verified on head/);
        assert.equal(reviewCalls(bin).length, calls, 'no second round on the fast path');
        assert.deepEqual([receipt.review.spent, receipt.workerVerification, receipt.review.workerVerification], [false, verified.workerVerification, verified.workerVerification]);
        const unbound = call(at(fixed, 1, { workerVerification: undefined })); assert.equal(unbound.status, 1); assert.match(unbound.stdout, /collection request mismatch: admission; expected "the admitted round request for collectionId"/);
        // A task change («Изменение задачи» plus resume) after the spent round: the reviewer gets exactly one round on the
        // new contract, on the same head, reading the whole change; the next requests pass on the worker's verification again.
        const changeTask = n => { const url = `https://linear.app/darkdepot/issue/MONO-999/x#comment-${n}`;
          recordTaskChange(path.dirname(pinsFile), url, `Изменение задачи: ${url}\nRound ${n}: round the result.`); };
        const reviewers = () => reviewCalls(bin).filter(role => role === 'reviewer').length;
        changeTask(1); setReview(bin, { findings: [], verdict: reviewVerdict({ outcome: 'rejected', closed: true }) });
        const stale = call(verified); assert.equal(stale.status, 1); assert.match(stale.stdout, /the task changed after this review round/);
        let before = reviewers();
        receipt = await round(at(fixed, 2), 0, /pass: review clean \(round 1 of 1\) and verification verified on head/);
        assert.equal(reviewers() - before, 1, 'the task change gets one review round on the unchanged head');
        assert.deepEqual([receipt.review.spent, receipt.review.round, receipt.review.record.rounds.length, receipt.review.record.rounds.at(-1).scope, receipt.review.record.rounds.at(-1).reviewedFiles],
          [true, 1, 2, 'full', ['input.mjs']], 'the round after a task change reads the whole change');
        assert.equal(receipt.review.contractDigest, digest(`# MONO-999\n\nFixture task contract.\n\n\n## Изменение задачи 1 (https://linear.app/darkdepot/issue/MONO-999/x#comment-1)\nИзменение задачи: https://linear.app/darkdepot/issue/MONO-999/x#comment-1\nRound 1: round the result.`));
        before = reviewers();
        await round(at(fixed, 3), 0, /pass: review clean \(round 1 of 1\)/);
        const afterChange = commit('export const afterChange = 1;\n');
        const spentAgain = call(at(afterChange, 1, { workerVerification: undefined })); assert.equal(spentAgain.status, 1); assert.match(spentAgain.stdout, spent);
        await round(at(afterChange), 0, /pass: review clean \(round 1 of 1\), fixes after it confirmed by the worker's full verification/);
        assert.equal(reviewers(), before, 'no second round without another task change');
        // Each further task change gets its round while the stage record has room (three rounds), then it needs a new attempt.
        changeTask(2); receipt = await round(at(afterChange, 2), 0, /pass: review clean \(round 1 of 1\) and verification verified on head/);
        assert.deepEqual([reviewers() - before, receipt.review.record.rounds.length], [1, 3]);
        changeTask(3); before = reviewers();
        const full = call(at(afterChange, 3)); assert.equal(full.status, 1); assert.match(full.stdout, /fail: needs-decision: review round limit reached \(3 of 3 on this task attempt\)/);
        assert.equal(reviewers(), before);
        const fresh =() => { for (const name of fs.readdirSync(path.join(evidence, 'history'))) fs.unlinkSync(path.join(evidence, 'history', name)); };
        // An older harmful defect passed by the round stays a must-file successor on the worker-verified head.
        fresh(); setReview(bin, { findings: [reviewFinding('input.mjs', { anchor: 'Older', title: 'Older' })], verdict: reviewVerdict({ origin: 'pre-existing', danger: true, dangerCase: 'data', dangerReason: 'Data may be lost.' }) });
        const olderHead = commit('export const older = 1;\n');
        await round(at(olderHead), 0, /pass: review clean-with-successors \(round 1 of 1\).*must-file P2 input\.mjs:1 Older/);
        const botFix = commit('export const botFix = 1;\n');
        receipt = await round(at(botFix, 1, { workerVerification: { head: botFix, exitCode: 0 } }), 0, /pass: review clean-with-successors \(round 1 of 1\), fixes after it confirmed.*must-file P2 input\.mjs:1 Older/);
        // A raised risk from the round is the orchestrator's decision, never the worker's word, also after the base moves.
        fresh(); setReview(bin, { findings: [reviewFinding('input.mjs', { anchor: 'Raised', title: 'Raised' })], verdict: reviewVerdict({ riskRaised: true }) });
        const raised = commit('export const raised = 1;\n');
        await round(at(raised), 1, /fail: review not-converged \(round 1 of 1\)/);
        git('branch', '-f', 'review-base', raised);
        const after = commit('export const after = 1;\n');
        await round(at(after, 1, { workerVerification: { head: after, exitCode: 0 } }), 1, /fail: needs-decision: the review round found work outside the task or a higher risk/);
        return;
      }
      if (fixture.mode.startsWith('review-extra')) {
        // MONO-482: one extra round in the same attempt, granted by resume extraRound (recorded beside the launch pins),
        // run through the real collection and review round.
        const { extraRoundCheck } = await import('./gate.mjs');
        const { recordExtraRound, extraRounds } = await import('./orchestrator/command-state.mjs');
        const author = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'], attempt = path.dirname(pinsFile);
        const commit = text => { fs.appendFileSync(path.join(repo, 'input.mjs'), text); git('add', 'input.mjs'); git(...author, 'commit', '-m', text.trim()); return git('rev-parse', 'HEAD'); };
        const at = (tip, n = 1) => ({ ...request, head: tip, collectionId: `preflight-collect:${tip}:${n}`, workerVerification: { head: tip, exitCode: 0 } });
        const round = async (value, status, line) => {
          await admit(value);
          for (const result of [call({ ...value, collect: true }), call(value)]) { assert.equal(result.status, status, result.stdout + result.stderr); assert.match(result.stdout, line); }
          return JSON.parse(fs.readFileSync(path.join(evidence, `${value.head}.json`), 'utf8')).receipt;
        };
        const reviewers = () => reviewCalls(bin).filter(role => role === 'reviewer').length;
        const dangerous = reviewVerdict({ danger: true, dangerCase: 'data', dangerReason: 'Negative values corrupt stored records.' });
        const leftover = [reviewFinding('input.mjs', { anchor: 'Leftover', title: 'Leftover' })];
        const hint = /the orchestrator may resume with extraRound for one extra round/;
        const limit3 = /fail: needs-decision: review round limit reached \(3 of 3 on this task attempt\); the orchestrator may resume with extraRound/;
        // The collector's ledger of this attempt: contiguous ordinals, one admission per collectionId.
        const ordinals = async () => (await import('./review-rounds.mjs')).readLedger(root, 'MONO-999', 1).map(item => item.admission?.collectionId ?? item.collectionId);
        if (fixture.mode === 'review-extra-host') {
          // MONO-482 review round 3 (P1): another root's host run A plants this attempt's grant and is still open while this
          // collection starts; A settles (the plant removed) while this collection waits to open its own host run. No decision
          // may come from a control file read before its own run opened: it reads the grant again after opening and finds none.
          const { workerVerification: _, ...noWorker } = request;
          const hostAt = (tip, n = 1) => ({ ...noWorker, head: tip, collectionId: `preflight-collect:${tip}:${n}` });
          setReview(bin, { findings: leftover, verdict: dangerous });
          await round(hostAt(commit('export const one = 1;\n')), 1, /fail: review not-converged \(round 1 of 3\)/);
          await round(hostAt(commit('export const two = 2;\n')), 1, /fail: review not-converged \(round 2 of 3\)/);
          const third = await round(hostAt(commit('export const three = 3;\n')), 1, /fail: needs-decision: review not-converged after round 3 of 3/);
          const fourth = commit('export const four = 4;\n'), value = hostAt(fourth);
          const grants = path.join(attempt, 'extra-round.json'), markerA = path.join(evidence, 'verification', `preflight-collect-${'e'.repeat(40)}-1.running`), lock = path.join(root, 'launch.lock');
          write(grants, JSON.stringify([{ number: 1, reason: 'planted by run A', receipt: third.runId, recordedAt: new Date().toISOString() }]));
          write(markerA, JSON.stringify({ collectionId: `preflight-collect:${'e'.repeat(40)}:1`, group: null, snapshot: [] }));
          write(lock, JSON.stringify({ pid: process.pid, lockId: 'run A settling' }));
          await admit(value); atomicJson(file, { ...value, collect: true });
          const calls = reviewers();
          const gate = spawn(process.execPath, ['scripts/gate.mjs', 'preflight', '--request', file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
          let out = ''; gate.stdout.on('data', chunk => out += chunk); gate.stderr.on('data', chunk => out += chunk);
          // The collection has read its context and waits on launch.lock to open its host run; run A settles meanwhile.
          await new Promise(resolve => setTimeout(resolve, 4000));
          fs.rmSync(grants); fs.rmSync(markerA); fs.rmSync(lock);
          const status = await new Promise(resolve => gate.once('exit', resolve));
          assert.equal(status, 1, out); assert.match(out, limit3);
          assert.equal(reviewers(), calls, 'no fourth round on a grant read before the host run opened');
          return;
        }
        if (fixture.mode === 'review-extra') {
          // A narrow remainder: one dangerous finding open after round 3, no task change. The fourth round reads the fixes and
          // open findings; when it does not converge either it needs a decision and there is no second extra round.
          setReview(bin, { findings: leftover, verdict: dangerous });
          let receipt = await round(at(commit('export const one = 1;\n')), 1, /fail: review not-converged \(round 1 of 3\)/);
          receipt = await round(at(commit('export const two = 2;\n')), 1, /fail: review not-converged \(round 2 of 3\)/);
          const third = await round(at(commit('export const three = 3;\n')), 1, /fail: needs-decision: review not-converged after round 3 of 3; 1 open: P2 input\.mjs:1 Leftover/);
          assert.match(call(at(third.head)).stdout, hint, 'the round-3 line names the extra round');
          const fourth = commit('export const four = 4;\n'), calls = reviewers();
          receipt = await round(at(fourth), 1, limit3);
          assert.deepEqual([receipt.review.outcome, reviewers()], ['refused', calls], 'without the extra round no fourth round runs');
          // Resume extraRound: the host checks the right to it, then records it bound to the third spent receipt.
          const { receipt: bound } = extraRoundCheck(pinsFile);
          assert.equal(bound, third.runId);
          recordExtraRound(attempt, 'one finding left after round 3', bound);
          const before = await ordinals();
          receipt = await round(at(fourth, 2), 1, /fail: needs-decision: review not-converged after round 4 of 4 \(extra round used\); 1 open: P2 input\.mjs:1 Leftover/);
          assert.deepEqual([receipt.review.spent, receipt.review.round, receipt.review.limit, receipt.review.record.rounds.length, receipt.review.record.rounds.at(-1).scope],
            [true, 4, 4, 4, 'fixes-and-open-findings'], 'the fourth round reads only the fixes and open findings');
          assert.equal(reviewers(), calls + 1, 'the fourth round ran the reviewer');
          assert.deepEqual([receipt.pins.file, await ordinals()], [pinsFile, [...before, at(fourth, 2).collectionId]], 'the same attempt, pins and round ledger: the fourth round is the next ordinal');
          assert.doesNotMatch(receipt.review.reason ?? '', /fix, run the full verification/, 'never the fast-path line');
          // No fifth round and no second grant.
          const fifth = commit('export const five = 5;\n'), spentCalls = reviewers();
          receipt = await round(at(fifth), 1, /fail: needs-decision: review round limit reached \(4 of 4 on this task attempt, extra round used\); split the Issue or change approach in a new attempt/);
          assert.equal(reviewers(), spentCalls, 'a fifth round is never launched');
          assert.throws(() => extraRoundCheck(pinsFile), /extraRound refused: one extra round per attempt/);
          assert.throws(() => recordExtraRound(attempt, 'again', bound), /one extra round per attempt/);
          assert.equal(extraRounds(attempt).length, 1, 'a refused second grant writes nothing');
          return;
        }
        if (fixture.mode === 'review-extra-fix') {
          // A clean round 3, then a QA fix on a new head without a task change: the extra round reads only the fixes and
          // open findings and a clean result is ready in the same attempt.
          setReview(bin, { findings: leftover, verdict: dangerous });
          await round(at(commit('export const one = 1;\n')), 1, /fail: review not-converged \(round 1 of 3\)/);
          setReview(bin, { findings: [], verdict: reviewVerdict({ outcome: 'rejected', closed: true }) });
          await round(at(commit('export const two = 2;\n')), 0, /pass: review clean \(round 2 of 3\)/);
          const third = await round(at(commit('export const three = 3;\n')), 0, /pass: review clean \(round 3 of 3\)/);
          const fix = commit('export const qaFix = 4;\n');
          await round(at(fix), 1, limit3);
          recordExtraRound(attempt, 'QA bugs fixed after a clean round 3', extraRoundCheck(pinsFile).receipt);
          const before = reviewers();
          const receipt = await round(at(fix, 2), 0, /pass: review clean \(round 4 of 4 \(extra\)\) and verification verified on head/);
          assert.deepEqual([receipt.review.round, receipt.review.record.rounds.at(-1).scope, reviewers() - before], [4, 'fixes-and-open-findings', 1],
            'the extra round without a task change reads only the fixes and open findings');
          assert.deepEqual([receipt.pins.file, receipt.review.contractDigest], [pinsFile, third.review.contractDigest], 'same attempt and contract');
          return;
        }
        // review-extra-change: the main path of an outside fix. A clean round 3, then a task change and a new head; the
        // extra round reads the whole change on the changed contract and a clean result is ready in the same attempt.
        setReview(bin, { findings: leftover, verdict: dangerous });
        await round(at(commit('export const one = 1;\n')), 1, /fail: review not-converged \(round 1 of 3\)/);
        setReview(bin, { findings: [], verdict: reviewVerdict({ outcome: 'rejected', closed: true }) });
        await round(at(commit('export const two = 2;\n')), 0, /pass: review clean \(round 2 of 3\)/);
        const third = await round(at(commit('export const three = 3;\n')), 0, /pass: review clean \(round 3 of 3\)/);
        const url = 'https://linear.app/darkdepot/issue/MONO-999/x#comment-3';
        recordTaskChange(attempt, url, `Изменение задачи: ${url}\nAlso accept zero.`);
        const fourth = commit('export const four = 4;\n');
        await round(at(fourth), 1, limit3);
        recordExtraRound(attempt, 'task change after a clean round 3', extraRoundCheck(pinsFile).receipt);
        const receipt = await round(at(fourth, 2), 0, /pass: review clean \(round 4 of 4 \(extra\)\) and verification verified on head/);
        assert.deepEqual([receipt.review.round, receipt.review.limit, receipt.review.record.rounds.at(-1).scope, receipt.review.record.rounds.at(-1).reviewedFiles],
          [4, 4, 'full', ['input.mjs']], 'the extra round after a task change reads the whole change');
        assert.notEqual(receipt.review.contractDigest, third.review.contractDigest, 'the round read the changed contract');
        assert.deepEqual([receipt.pins.file, receipt.review.record.rounds.length], [pinsFile, 4], 'same attempt and record');
        return;
      }
      let expectedField = null, expectedValue = null, expectedStatus = 2;
      if (fixture.mode === "mismatch") { expectedField = fixture.field; expectedValue = pins[fixture.field]; if (fixture.omit) delete request[fixture.field]; else request[fixture.field] = fixture.value; }
      if (fixture.mode === "pins-digest") { request.pins = { ...binding, digest: "0".repeat(64) }; expectedField = "pins.digest"; expectedValue = binding.digest; }
      if (fixture.mode === "no-pins") { delete request.pins; expectedField = "pins"; expectedValue = binding; }
      if (fixture.mode === "amended") {
        // Pins versions no longer exist: an amended attempt from an older pack is refused, never read as launch pins.
        entry.pinsVersion = 1; register();
        const result = call(request); assert.equal(result.status, 1); assert.match(result.stdout, /pins versions no longer exist; start a new attempt/);
        return;
      }
      if (fixture.mode === "replaced-request") {
        // A worker cannot replace an admitted request under the same collectionId: collection refuses it.
        await admit(request);
        const result = call({ ...request, risk: "tiny", collect: true }); assert.equal(result.status, 1);
        assert.match(result.stdout, /collection request mismatch: admission; expected "the admitted round request for collectionId"/);
        assert.equal(fs.existsSync(receiptFile), false); return;
      }
      if (fixture.mode === "other-head") {
        const envelope = await collect(request); envelope.receipt.collectionId = `preflight-collect:${head}:2`; seal(envelope);
        request.collectionId = `preflight-collect:${head}:3`;
      }
      if (fixture.mode === "collect") { expectedStatus = 0; request.collect = true; }
      if (fixture.mode === "legacy") {
        const envelope = await collect(request); delete envelope.receipt.pins; delete envelope.receipt.idea; seal(envelope);
        expectedStatus = 1;
        if (fixture.unregistered) { delete request.pins; expectedStatus = 0; }
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
      if (expectedStatus === 2) {
        assert.deepEqual(result.stdout.trim().split("\n"), [`gate preflight: pending: ${request.collectionId}`, JSON.stringify({ publishRequest: request })]);
        if (receiptBefore) assert.deepEqual(fs.readFileSync(receiptFile), receiptBefore);
        else assert.equal(fs.existsSync(receiptFile), false);
      }
      if (fixture.mode === "receipt-pins") assert.match(result.stdout, /receipt pins differs from dispatch request/u);
      if (fixture.mode === "collect") {
        const envelope = JSON.parse(fs.readFileSync(receiptFile, "utf8")); assert.deepEqual(envelope.receipt.pins, binding);
        const history = path.join(evidence, "history", `${envelope.receipt.runId}.json`);
        assert.deepEqual(JSON.parse(fs.readFileSync(history)), envelope);
        assert.deepEqual([envelope.receipt.verification, envelope.receipt.workerVerification], [{ ...pins.verification, exitCode: null }, { head, exitCode: 0 }]);
        write(path.join(root, 'reports/collector.log'), 'edited ordinary log');
        const bytes = fs.readFileSync(history), verified = call({ ...request, collect: false }); assert.equal(verified.status, 0, verified.stdout);
        assert.deepEqual(fs.readFileSync(history), bytes, 'signed output survives a fresh gate process and ordinary log edits');
        const tampered = call({ ...request, collect: false, workerVerification: { head, exitCode: 1 } }); assert.equal(tampered.status, 1);
        assert.match(tampered.stdout, /collection request mismatch: admission; expected "the admitted round request for collectionId"/);
        // The cost report reads the round exactly as the gate signed it.
        write(path.join(root, 'logs/MONO-999-mono-deliver-a1.jsonl'), JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }) + '\n');
        const cost = spawnSync(process.execPath, ['scripts/wave-cost.mjs', 'MONO-999', '--root', root, '--evidence-root', evidence], { encoding: 'utf8' });
        assert.deepEqual(JSON.parse(cost.stdout.split('\nЦена волны')[0]).autoreview.receipts, { receipts: 1, rounds: 1, not_reviewed: 0, calls: 1, measured_calls: 0 }, cost.stderr);
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
  for (const policy of [{ botChecks: [] }, { botChecks: ['Other Bot'] }, { botUnavailable: 'worker says unavailable' }, { botOutcome: 'молчал' }])
    assert.throws(() => validateShipBotPolicy(policy, trusted), /bot/);
  const s = sample(); s.checks.pop();
  assert.throws(() => evaluateShip(s, judgment(), validateShipBotPolicy({}, trusted)), /bot Greptile Review pending/);
  const unavailable = { ...trusted, botUnavailable: 'orchestrator confirmed service outage' };
  assert.doesNotThrow(() => evaluateShip(s, judgment(), validateShipBotPolicy({}, unavailable)));
  assert.throws(() => validateShipBotPolicy({ botUnavailable: 'different reason' }, unavailable), /bot/);
});

test('ship-next-attempt-after-fix: new gate window retains task bot outcome across heads and restart', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-ship-next-'));
  try {
    const scripts = path.join(scratch, 'scripts');
    fs.cpSync(path.dirname(fileURLToPath(import.meta.url)), scripts, { recursive: true });
    const gate = path.join(scripts, 'gate.mjs');
    // Isolate GitHub and sealed-preflight I/O; run the actual window/state loop.
    let source = fs.readFileSync(gate, 'utf8');
    source = source.replace('const snapshot = readShipSnapshot(request.repo, request.number, deadline, !bot?.outcome ? since : null);', 'const snapshot = readJson(request.fixtureSnapshot);');
    source = source.replace('const proof = await verifyPreflight(request.preflight, snapshot);', 'const proof = { receipt: { path: "fixture-sealed-proof" } };');
    fs.writeFileSync(gate, source);
    const { shipGate } = await import(pathToFileURL(gate));
    const { atomicJson } = await import('./runtime.mjs');
    const root = path.join(scratch, 'root'), issue = 'MONO-162';
    const file = path.join(root, 'dispatch', `${issue}-a1`, 'pins.json');
    const pins = { root, worktree: scratch, workerWritableRoots: [scratch] };
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
    assert.match(await shipGate(waiting), /Бот: ответил/);
    const botFile = path.join(root, 'reports', `${issue}-a1-ship-bot.json`);
    assert.equal(JSON.parse(fs.readFileSync(botFile)).outcome, 'ответил');
    // A separate synthetic task clock: silent bot, first green already thirty minutes ago.
    atomicJson(botFile, { scope: { repo: request.repo, number: request.number }, startedAt: Date.now() - 1_800_001, outcome: null });
    const timed = { ...waiting, attempt: 4, stateFile: path.join(scratch, 'ship-4.json') };
    assert.match(await shipGate(timed), /Бот: молчал/);
    assert.equal(JSON.parse(fs.readFileSync(timed.stateFile)).bot.outcome, 'молчал');
    assert.match(await shipGate(timed), /Бот: молчал/, 'restart does not reopen bot wait');
    const expired = JSON.parse(fs.readFileSync(timed.stateFile));
    expired.startedAt = Date.now() - 7_201_000; expired.pendingReason = 'bot Greptile Review pending on head';
    atomicJson(timed.stateFile, expired);
    assert.match(await shipGate(timed), /Бот: молчал/, 'restart long after pure bot wait does not park on evidence-limit');
    atomicJson(botFile, { scope: { repo: request.repo, number: request.number }, startedAt: Date.now() - 200_000, outcome: null });
    snapshot.checks.push({ __typename: 'CheckRun', name: 'Greptile Review', head: nextHead, status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: new Date().toISOString() });
    atomicJson(request.fixtureSnapshot, snapshot);
    assert.match(await shipGate(timed), /Бот: ответил/, 'timely answer retains the already granted evidence extension');
    const answered = JSON.parse(fs.readFileSync(timed.stateFile));
    answered.startedAt = Date.now() - 7_201_000; answered.botDeadline = 0; delete answered.pendingReason;
    atomicJson(timed.stateFile, answered);
    await assert.rejects(shipGate(timed), /evidence-limit/, 'an already answered bot does not grant a fresh window for unrelated evidence');
    // Same head reused by a new attempt: the green bot check predates botSince, so Ship keeps waiting.
    atomicJson(botFile, { scope: { repo: request.repo, number: request.number }, startedAt: Date.now() - 200_000, outcome: null });
    snapshot.botSince = Date.now() - 100_000; snapshot.checks.at(-1).completedAt = new Date(Date.now() - 3_600_000).toISOString();
    atomicJson(request.fixtureSnapshot, snapshot);
    const reused = { ...timed, attempt: 5, watch: false, stateFile: path.join(scratch, 'ship-5.json') };
    await assert.rejects(shipGate(reused), /bot reply not seen in this attempt/);
    assert.equal(JSON.parse(fs.readFileSync(botFile)).outcome, null);



  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('ship-bot-policy: project configuration accepts no bots and requires unique check names', async () => {
  const { shipBotChecks } = await import('./runtime.mjs');
  assert.deepEqual(shipBotChecks(), ['Greptile Review']);
  assert.deepEqual(shipBotChecks({ orchestration: { ship: { botChecks: ['Custom Review'] } } }), ['Custom Review']);
  assert.deepEqual(shipBotChecks({ orchestration: { ship: { botChecks: [] } } }), []);
  for (const botChecks of [null, 'Greptile Review', [' '], ['Bot', 'Bot'], [' Bot']])
    assert.throws(() => shipBotChecks({ orchestration: { ship: { botChecks } } }), /botChecks/);
});


test('ship bot clock starts at fully green mandatory CI, persists over heads and expires at thirty minutes', async () => {
  const { advanceBotWait } = await import('./gate.mjs');
  const policy = { botChecks: ['Greptile Review'], requiredChecks: ['validate'] };
  const start = 1_000_000, s = sample(); s.checks.pop();
  const pending = structuredClone(s); pending.checks[0].status = 'IN_PROGRESS';
  assert.equal(advanceBotWait(null, pending, policy, start).startedAt, null);
  for (const conclusion of ['FAILURE', 'SKIPPED', 'NEUTRAL']) {
    const red = structuredClone(s); red.checks[0].conclusion = conclusion;
    assert.equal(advanceBotWait(null, red, policy, start).startedAt, null);
  }
  const absent = structuredClone(s); absent.checks.shift();
  assert.equal(advanceBotWait(null, absent, policy, start).startedAt, null);
  let clock = advanceBotWait(null, s, policy, start);
  assert.equal(clock.startedAt, start); assert.equal(clock.outcome, null);
  const changed = structuredClone(s); changed.head = 'b'.repeat(40); changed.checks.forEach(c => c.head = changed.head);
  clock = advanceBotWait(JSON.parse(JSON.stringify(clock)), changed, policy, start + 1_799_999);
  assert.equal(clock.startedAt, start); assert.equal(clock.outcome, null);
  clock = advanceBotWait(clock, changed, policy, start + 1_800_000);
  assert.equal(clock.outcome, 'молчал');
  assert.doesNotThrow(() => evaluateShip(changed, { ...judgment(), head: changed.head }, { ...policy, botOutcome: clock.outcome }));
  assert.equal(advanceBotWait(null, s, { botChecks: [] }, start).outcome, 'нет');
});

test('timely bot response is retained after fixes; original bot remarks still require judgment', async () => {
  const { advanceBotWait } = await import('./gate.mjs');
  const policy = { botChecks: ['Greptile Review'] }, s = sample(), start = 1_000_000;
  let clock = advanceBotWait(null, s, policy, start);
  assert.equal(clock.outcome, 'ответил');
  s.checks[2].status = 'IN_PROGRESS'; s.head = 'b'.repeat(40); s.checks.forEach(c => c.head = s.head);
  clock = advanceBotWait(clock, s, policy, start + 1_800_001);
  assert.equal(clock.outcome, 'ответил');
  const j = { ...judgment(), head: s.head };
  assert.doesNotThrow(() => evaluateShip(s, j, { ...policy, botOutcome: clock.outcome }));
  s.botComments = [{ id: 'P1', body: 'P1: broken path' }];
  assert.throws(() => evaluateShip(s, j, { ...policy, botOutcome: clock.outcome }), /unaddressed bot remark/);
  j.botRemarks = [{ id: 'P1', commentDigest: botRemarkDigest(s.botComments[0]), outcome: 'fixed', evidence: 'fixed and checked on this head' }];
  assert.doesNotThrow(() => evaluateShip(s, j, { ...policy, botOutcome: clock.outcome }));
  s.botComments[0].body = 'P2: consider the edge case';
  j.botRemarks[0] = { id: 'P1', commentDigest: botRemarkDigest(s.botComments[0]), outcome: 'rejected', evidence: 'published reply explaining why the observed behavior is intended' };
  assert.doesNotThrow(() => evaluateShip(s, j, { ...policy, botOutcome: clock.outcome }));
  j.botRemarks[0].evidence = '';
  assert.throws(() => evaluateShip(s, j, { ...policy, botOutcome: clock.outcome }), /unaddressed bot remark/);
});


test('bot deadline uses first completed mandatory CI and does not accept a late reply as timely', async () => {
  const { advanceBotWait } = await import('./gate.mjs');
  const now = 4_000_000, greenAt = now - 1_800_001, s = sample();
  s.requiredChecks = ['validate']; s.checks[0].completedAt = new Date(greenAt).toISOString();
  s.checks[2].completedAt = new Date(now).toISOString();
  assert.deepEqual(advanceBotWait(null, s, { botChecks: ['Greptile Review'] }, now), { startedAt: greenAt, outcome: 'молчал' });
  s.checks[2].status = 'IN_PROGRESS';
  assert.doesNotThrow(() => evaluateShip(s, judgment(), { botChecks: [], botOutcome: 'нет' }));
  s.requiredChecks.push('Greptile Review');
  assert.throws(() => evaluateShip(s, judgment(), { botChecks: [], botOutcome: 'нет' }), /Greptile Review.*pending/);
});


test('CI automation remarks never count as a review bot response and still require disposition', async () => {
  const { advanceBotWait } = await import('./gate.mjs');
  const s = sample(), now = 4_000_000; s.checks.pop();
  s.botComments = [{ id: 'CI', body: 'P1: CI warning', reviewBot: false, createdAt: new Date(now).toISOString() }];
  assert.equal(advanceBotWait(null, s, { botChecks: ['Greptile Review'] }, now).outcome, null);
  assert.throws(() => evaluateShip(s, judgment(), { botOutcome: 'молчал' }), /unaddressed bot remark CI/);
});

for (const status of ['IN_PROGRESS', 'COMPLETED']) test(`settled review bot alone permits UNSTABLE merge state: ${status}`, () => {
  const s = sample(); s.mergeStateStatus = 'UNSTABLE';
  Object.assign(s.checks[2], { status, conclusion: status === 'COMPLETED' ? 'FAILURE' : null });
  assert.doesNotThrow(() => evaluateShip(s, judgment(), { botOutcome: 'молчал' }));
  assert.throws(() => evaluateShip(s, judgment()), /pending|not green/);
  s.checks[0].status = 'IN_PROGRESS';
  assert.throws(() => evaluateShip(s, judgment(), { botOutcome: 'молчал' }), /pending/);
  s.checks[0].status = 'COMPLETED'; s.checks[0].conclusion = 'FAILURE';
  assert.throws(() => evaluateShip(s, judgment(), { botOutcome: 'молчал' }), /not green/);
  s.checks[0].conclusion = 'SUCCESS'; s.requiredChecks = ['Greptile Review'];
  assert.throws(() => evaluateShip(s, judgment(), { botOutcome: 'молчал' }), /pending|not green/);
});

test('review bot identities exclude CI apps and ordinary users', async () => {
  const { isReviewBot, advanceBotWait } = await import('./gate.mjs');
  const s = sample(); s.checks.pop(); const now = 4_000_000;
  for (const login of ['github-actions[bot]', 'vercel[bot]', 'codecov[bot]', 'buildkite[bot]', 'owner', 'greptile-fan']) {
    assert.equal(isReviewBot({ login, type: login.endsWith('[bot]') ? 'Bot' : 'User' }), false, login);
    s.reviews = [{ user: { login }, state: 'COMMENTED', submitted_at: new Date(now).toISOString(), commit_id: head }];
    assert.equal(advanceBotWait(null, s, { botChecks: ['Greptile Review'] }, now).outcome, null);
  }
  assert.equal(isReviewBot({ login: 'greptile-apps[bot]' }), true);
});

test('early PR comment and empty-body inline review count as timely bot replies', async () => {
  const { advanceBotWait } = await import('./gate.mjs');
  const start = 4_000_000, s = sample(), policy = { botChecks: ['Greptile Review'] };
  s.checks.pop(); s.headStartedAt = new Date(start - 300_000).toISOString();
  s.checks[0].completedAt = new Date(start).toISOString();
  s.botComments = [{ id: 'early', reviewBot: true, body: 'Review done', createdAt: new Date(start - 60_000).toISOString() }];
  assert.equal(advanceBotWait(null, s, policy, start).outcome, 'ответил');
  s.botComments[0].createdAt = new Date(start - 400_000).toISOString();
  assert.equal(advanceBotWait(null, s, policy, start).outcome, null, 'old headless comment is not evidence for a new head');
  s.botComments = [];
  s.reviews = [{ user: { login: 'greptile-apps[bot]', type: 'Bot' }, body: '', state: 'COMMENTED', commit_id: head, submitted_at: new Date(start - 60_000).toISOString() }];
  assert.equal(advanceBotWait(null, s, policy, start).outcome, 'ответил');
  s.reviews[0].state = 'PENDING';
  assert.equal(advanceBotWait(null, s, policy, start).outcome, null);
});

test('first Ship recovers the earliest green head from this attempt before fixes', async () => {
  const { advanceBotWait } = await import('./gate.mjs');
  const now = 4_000_000, firstGreen = now - 1_800_001, s = sample();
  s.checks.pop(); s.requiredChecks = ['validate'];
  s.checks[0].completedAt = new Date(now - 60_000).toISOString();
  s.ciHistory = [{ head: 'b'.repeat(40), checks: [{ ...s.checks[0], head: 'b'.repeat(40), completedAt: new Date(firstGreen).toISOString() }] }];
  s.botSince = firstGreen - 1000;
  assert.deepEqual(advanceBotWait(null, s, { botChecks: ['Greptile Review'] }, now), { startedAt: firstGreen, outcome: 'молчал' });
  s.botSince = firstGreen + 1;
  assert.equal(advanceBotWait(null, s, { botChecks: ['Greptile Review'] }, now).startedAt, now - 60_000, 'earlier attempt does not open the clock');
  s.ciHistory[0].checks[0].conclusion = 'FAILURE'; s.botSince = firstGreen - 1000;
  assert.equal(advanceBotWait(null, s, { botChecks: ['Greptile Review'] }, now).startedAt, now - 60_000);
  s.ciHistory[0].checks[0].conclusion = 'SUCCESS'; s.botSince = 0;
  assert.equal(advanceBotWait(null, s, { botChecks: ['Greptile Review'] }, now).startedAt, firstGreen, 'manual PR boundary predates Ship entry');
});

test('historical replies are recovered for every configured bot without accepting CI apps', async () => {
  const { advanceBotWait, isReviewBot } = await import('./gate.mjs');
  const now = 4_000_000, first = now - 120_000, s = sample(), old = 'b'.repeat(40);
  s.checks.pop(); s.requiredChecks = ['validate']; s.botSince = first - 1000;
  s.headStartedAt = new Date(now - 30_000).toISOString(); s.checks[0].completedAt = new Date(now).toISOString();
  s.ciHistory = [{ head: old, headStartedAt: new Date(first).toISOString(), checks: [{ ...s.checks[0], head: old, completedAt: new Date(first + 10_000).toISOString() }] }];
  const policy = { botChecks: ['Greptile Review'] };
  s.reviews = [{ user: { login: 'greptile-apps[bot]' }, state: 'COMMENTED', body: '', commit_id: old, submitted_at: new Date(first + 20_000).toISOString() }];
  assert.equal(advanceBotWait(null, s, policy, now).outcome, 'ответил');
  s.reviews = []; s.botComments = [{ user: { login: 'greptile-apps[bot]' }, body: 'Reviewed H1', createdAt: new Date(first + 20_000).toISOString() }];
  assert.equal(advanceBotWait(null, s, policy, now).outcome, 'ответил');
  s.botComments = []; s.ciHistory[0].checks.push({ __typename: 'CheckRun', name: 'Greptile Review', head: old, status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: new Date(first + 20_000).toISOString() });
  assert.equal(advanceBotWait(null, s, policy, now).outcome, 'ответил');
  s.botSince = now - 10_000;
  assert.equal(advanceBotWait(null, s, policy, now).outcome, null, 'reply before the pinned attempt is excluded');
  const app = { __typename: 'CheckRun', name: 'Custom Review', head, status: 'IN_PROGRESS', checkSuite: { app: { slug: 'custom-review' } } };
  assert.equal(isReviewBot({ login: 'custom-review[bot]' }, ['Custom Review'], [app]), true);
  assert.equal(isReviewBot({ login: 'vercel[bot]' }, ['Custom Review'], [app]), false);
  s.checks.push(app); s.checks[0].completedAt = new Date(now).toISOString();
  s.botComments = [{ user: { login: 'custom-review[bot]', type: 'Bot' }, body: 'Reviewed', createdAt: new Date(now).toISOString() }];
  assert.equal(advanceBotWait(null, s, { botChecks: ['Custom Review', 'Devin Review'] }, now).outcome, 'ответил', 'combine configured app reply with the other bot check');
});

test('configured StatusContext bot is identified by its creator', async () => {
  const { isReviewBot, advanceBotWait } = await import('./gate.mjs');
  const now = 4_000_000, s = sample();
  const status = { __typename: 'StatusContext', context: 'Custom Review', head, state: 'PENDING', createdAt: new Date(now).toISOString(), creator: { __typename: 'Bot', login: 'custom-review' } };
  assert.equal(isReviewBot({ login: 'custom-review[bot]' }, ['Custom Review'], [status]), true, 'GraphQL Bot login without suffix');
  assert.equal(isReviewBot({ login: 'custom-review[bot]' }, ['Custom Review'], [{ ...status, creator: { __typename: 'Bot', login: 'custom-review[bot]' } }]), true);
  assert.equal(isReviewBot({ login: 'vercel[bot]' }, ['Custom Review'], [status]), false);
  assert.equal(isReviewBot({ login: 'custom-review[bot]' }, ['Custom Review'], [{ ...status, creator: null }]), false);
  assert.equal(isReviewBot({ login: 'sasha' }, ['Custom Review'], [{ ...status, creator: { __typename: 'User', login: 'sasha' } }]), false, 'a person posting a status is not a review bot');
  assert.equal(isReviewBot({ login: 'vercel[bot]' }, ['Custom Review'], [{ ...status, creator: { __typename: 'User', login: 'vercel' } }]), false, 'a human creator never lends a bot identity');
  assert.equal(isReviewBot({ login: 'custom-review[bot]' }, ['Custom Review'], [{ ...status, creator: { login: 'custom-review' } }]), false, 'creator type is required');
  assert.equal(isReviewBot({ login: 'custom-review[bot]' }, ['Other Review'], [status]), false);
  s.checks.pop(); s.checks.push(status); s.botSince = now - 60_000; s.headStartedAt = new Date(now - 30_000).toISOString();
  s.botComments = [{ user: { login: 'custom-review[bot]', type: 'Bot' }, body: 'Reviewed', createdAt: new Date(now).toISOString() }];
  assert.equal(advanceBotWait(null, s, { botChecks: ['Custom Review'] }, now).outcome, 'ответил');
});

test('bot replies before the attempt boundary never count, on any source', async () => {
  const { advanceBotWait } = await import('./gate.mjs');
  const since = 4_000_000, now = since + 120_000, old = 'b'.repeat(40), s = sample(), policy = { botChecks: ['Greptile Review'] };
  s.checks.pop(); s.requiredChecks = ['validate']; s.botSince = since;
  s.headStartedAt = new Date(now - 30_000).toISOString(); s.checks[0].completedAt = new Date(now - 10_000).toISOString();
  // Old head H1: required CI re-run after the boundary, bot replies are from an earlier attempt.
  s.ciHistory = [{ head: old, headStartedAt: new Date(since - 3_600_000).toISOString(), checks: [
    { ...s.checks[0], head: old, completedAt: new Date(since + 2 * 60_000).toISOString() },
    { __typename: 'CheckRun', name: 'Greptile Review', head: old, status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: new Date(since - 54 * 60_000).toISOString() },
  ] }];
  const early = new Date(since - 54 * 60_000).toISOString(), late = new Date(since + 60_000).toISOString();
  assert.equal(advanceBotWait(null, s, policy, now).outcome, null, 'old check run');
  s.ciHistory[0].checks[1].completedAt = late;
  assert.equal(advanceBotWait(null, s, policy, now).outcome, 'ответил', 'check run inside the window');
  s.ciHistory[0].checks.pop();
  s.botComments = [{ user: { login: 'greptile-apps[bot]' }, body: 'Reviewed H1', head: old, createdAt: early }];
  assert.equal(advanceBotWait(null, s, policy, now).outcome, null, 'old head-bound comment');
  s.botComments[0].createdAt = late;
  assert.equal(advanceBotWait(null, s, policy, now).outcome, 'ответил');
  s.botComments = [{ user: { login: 'greptile-apps[bot]' }, body: 'Reviewed', createdAt: early }];
  assert.equal(advanceBotWait(null, s, policy, now).outcome, null, 'old issue comment');
  s.botComments = [];
  s.reviews = [{ user: { login: 'greptile-apps[bot]' }, state: 'COMMENTED', body: '', commit_id: old, submitted_at: early }];
  assert.equal(advanceBotWait(null, s, policy, now).outcome, null, 'old review');
  s.reviews[0].submitted_at = late;
  assert.equal(advanceBotWait(null, s, policy, now).outcome, 'ответил');
});
