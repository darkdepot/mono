# Execution Quality Layer

Linear owns package/approvals/drift; GitHub branch/PR/review/CI/deploy/merge. PRD WHAT, Spec HOW, Issue one PR.

## PRD Coverage

Cover actor -> capability -> benefit; sharpen missing actors/benefits before handoff. No default long user-story section. User-visible proof intent excludes commands/test filenames.

## Durable Issue Writing

Prefer current/desired behavior, observable contracts/invariants, stable type/config/endpoint/domain names and independent acceptance. No line numbers, brittle edit scripts/choreography or full-doc copies; paths only for stable required reading and dated change surfaces.

## Agent Readiness

AFK = package supports execution/proof without new judgment; HITL = decisions/design/access/manual-QA/risk remain. Prefer one Issue; split only for Handoff's named reasons; over three needs the owner; legacy slicing stays. Each completes a demoable/verifiable path across layers with `Blocked by` or `None - can start immediately`.

## Bug And Performance Proof

Record a feedback-loop contract before code: repro, failing test/command, browser/CLI/curl/trace/fixture/benchmark loop, or reason unavailable. Before ship: symptom/baseline, fix/improvement proof, regression/test-seam gap, unrun manual/browser/prod/deploy/mobile. Passing tests never substitutes for symptom proof.

## Tracer-Bullet Implementation

One behavior proof → smallest satisfying change → repeat; refactor after green. Never all tests then all code.

## Architecture Lens

Deep/risky: module = interface/implementation; interface = caller invariants/order/errors/config; seam = interface location; adapter = implementation. The interface is the test surface. Apply the deletion test: removal should redistribute meaningful complexity; reject pass-through/shallow modules. One adapter is hypothetical, two evidence a real seam.

## Implementation Proof

Before edits, choose proof for every acceptance criterion. Permissions/access,
user data, money, state transitions (including gates and pack delivery), external
services and releases: write significant states as a table in the report's evidence
layer before editing; test each state and deliberately break behavior to show each
test turns red. This is working evidence, not a separate step or gate.
Other behavior: a test failing on old code or a characterization of existing behavior.
Text without behavior: record the exception «поведение не меняется» and why.
Startup/import failures and stub responses prove nothing about the target behavior.

Each test names the defect it catches, uses a real consumer and an expectation
independent of the tested code. A mismatch means fix code or stop, never fit the
expectation to the implementation. Unrun/skipped tests do not count. A sentence
in a skill file does not prove agent behavior; use behavioral scenarios.
After an edit touches checked behavior, rerun its proof on the delivered state.
