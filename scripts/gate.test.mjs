import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateShip, validatePreflight, advanceEvidence, botRemarkDigest } from "./gate.mjs";

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
test("preflight rejects absent, failed, incomplete, stale and wrong-route evidence", () => {
  const route = { model: "policy-model", effort: "high" };
  const receipt = { head, base: "b".repeat(40), route, verification: { exitCode: 0 },
    review: { exitCode: 0, output: "autoreview target: branch | engine: claude | model: policy-model | thinking: high\nautoreview clean: no accepted/actionable findings reported\noverall: patch is correct (0.9)\n" },
    loop: { iterations: 1, residualFindings: [], disposition: "clean" } };
  assert.doesNotThrow(() => validatePreflight(receipt, head, receipt.base, route));
  const advisory = structuredClone(receipt);
  advisory.review.json = { overall_correctness: "patch is correct", findings: [], priority_filtered_findings: [{ priority: "P3", title: "advisory" }] };
  assert.doesNotThrow(() => validatePreflight(advisory, head, receipt.base, route));
  advisory.review.json.priority_filtered_findings[0].priority = "P2";
  assert.throws(() => validatePreflight(advisory, head, receipt.base, route), /structured result/);
  assert.throws(() => validatePreflight(null, head, receipt.base, route));
  for (const mutate of [r => r.head = "c".repeat(40), r => r.review.exitCode = 1, r => r.review.output = "clean", r => r.route.effort = "medium", r => r.loop.residualFindings = ["finding"], r => delete r.loop]) {
    const r = structuredClone(receipt); mutate(r); assert.throws(() => validatePreflight(r, head, receipt.base, route));
  }
});
