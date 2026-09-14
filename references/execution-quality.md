# Execution Quality Layer

Linear owns package/approvals/drift; GitHub branch/PR/review/CI/deploy/merge. PRD WHAT, Spec HOW, Issue one PR.

## PRD Coverage

Cover actor -> capability -> benefit; sharpen missing actors/benefits before handoff. No default long user-story section. User-visible proof intent excludes commands/test filenames.

## Durable Issue Writing

Prefer current/desired behavior, observable contracts/invariants, stable type/config/endpoint/domain names and independent acceptance. No line numbers, brittle edit scripts/choreography or full-doc copies; paths only for stable required reading.

## Agent Readiness

AFK = package supports execution/proof without new judgment; HITL = decisions/design/access/manual-QA/risk remain. Prefer one Issue; split only oversized PRs or safe independent vertical slices. Each completes a demoable/verifiable path across layers with `Blocked by` or `None - can start immediately`.

## Bug And Performance Proof

Record a feedback-loop contract before code: repro, failing test/command, browser/CLI/curl/trace/fixture/benchmark loop, or reason unavailable. Before ship: symptom/baseline, fix/improvement proof, regression/test-seam gap, unrun manual/browser/prod/deploy/mobile. Passing tests never substitutes for symptom proof.

## Tracer-Bullet Implementation

One behavior proof → smallest satisfying change → repeat; refactor after green. Never all tests then all code.

## Architecture Lens

Deep/risky: module = interface/implementation; interface = caller invariants/order/errors/config; seam = interface location; adapter = implementation. The interface is the test surface. Apply the deletion test: removal should redistribute meaningful complexity; reject pass-through/shallow modules. One adapter is hypothetical, two evidence a real seam.
