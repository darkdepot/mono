# Tech Spec artifact contract

This bounded contract is the normative source for Tech Spec artifact behavior.
`mono:tech-evaluation` consumes it for new Tech Specs after page approval;
`mono:handoff` consumes it for legacy Tech Spec repair and reconciliation;
`mono:ship` consumes it for accepted pre-ship drift. Use the shared
[artifact rules](../artifact-rules.md), [artifact quality](../artifact-quality.md),
[readiness gates](../readiness-gates.md), and
[execution quality](../execution-quality.md) for cross-artifact policy. Render
the document with [templates/tech-spec.md](../../templates/tech-spec.md); do not
duplicate the template here.

## TS-001 — Tech Spec routing

New Tech Spec after page approval: `mono:tech-evaluation`. Legacy repair:
`mono:handoff`. Accepted pre-PR drift: `mono:ship`.

## TS-002 — Implementation truth

The Tech Spec records HOW the approved PRD will be built.

## TS-003 — Internal helper boundary

Only these stage owners write Tech Specs; no direct artifact door.

## TS-004 — Targeted-use eligibility

An approved page authorizes the new Spec. Route by PRD record per
`references/lifecycle.md`: ordinary/large via Tech Evaluation; tiny/old path skip.
Activation in T2.

## TS-005 — Linear-facing language

Write Tech Spec content and headings in the project-config language, defaulting
to Russian. Preserve the native language of identifiers, paths, commands,
product labels, and UI copy.

## TS-006 — HOW boundary

Define implementation HOW, not product discovery or new WHAT.

## TS-007 — Source documents

Use the Project and approved PRD as source documents.

## TS-008 — Decision trace

Trace important HOW decisions to `R` or `AE` IDs when they exist. Mark
cross-cutting technical support explicitly.

## TS-009 — No WHAT paraphrase

Link HOW to WHAT rather than rewriting PRD behavior. If WHAT is missing, return
to PRD or mark the gap before proceeding.

## TS-010 — Durable engineering review

Tech Evaluation persists its reviewed decision after page approval. Handoff copies
Spec decisions to package `U` units and Issue key contracts.

## TS-011 — Lightweight engineering pass

Old path without Tech Evaluation: Handoff writes HOW to package `U` units and Issues,
never a new Spec.

## TS-012 — Requirement trace coverage

Trace implementation decisions back to PRD requirement IDs.

## TS-013 — Stable implementation units

Use stable `U1`, `U2`, and subsequent implementation-unit IDs.

## TS-014 — Core implementation coverage

Keep non-inferable, costly-to-redo contracts, impact and proof.
Failures/release/rollback only when applicable; no empty sections.

## TS-015 — Observed backend contracts

For integration with an existing API or backend, include deployed-instance
response samples covering enum domains, object shapes, and edge records rather
than only endpoint existence. Treat spec/reality mismatch as a spec blocker;
when qualification is uncertain, sample.

## TS-016 — Unreachable backend fallback

If the deployed instance cannot be sampled during discovery, do not guess. Put
a contract-verification spike first in the wave and block consuming Issues on
it.

## TS-017 — Review-inspectable detail

For standard/deep/risky work, make trace, proof and applicable
failures/release/rollback reviewable, without review mechanics.

## TS-018 — Narrow no-spec exception

Tech Evaluation requires its Spec and effective `mono-tech`. Tiny/old-path HOW stays
in `U` units (deep/risky: at least one); legacy no-spec follows TS-019.

## TS-019 — Forbidden no-spec domains

A legacy no-spec exception never covers risky, cross-cutting, data, auth,
release, or multi-surface work.

## TS-020 — Unknowns by phase

Separate plan-time and implementation-time unknowns. Do not pretend helper
names, SQL, branch sequencing, or runtime failure details are settled before
implementation touches the code.

## TS-021 — Relevant sections only

Only relevant, populated sections. Estimate PR count/order/risk for Handoff; it owns
slicing. Estimate changes need no new page: they are absent from it.

## TS-022 — Deep architecture lens

For deep or risky work, make the interface the test surface, apply the deletion
test, require real seams, and avoid shallow pass-through modules.

## TS-023 — Directional examples only

Directional pseudocode and diagrams may clarify architecture. Exclude
copy-paste implementation code and shell choreography.

## TS-024 — No repair archaeology

Do not write historical repair language or transcript archaeology.

## TS-025 — No workflow mechanics

Keep `mono:check`, lifecycle, readiness criteria, and agent-contract
instructions out of the Linear Tech Spec body.

## TS-026 — No Delivery transition

Only `mono:implement` owns Delivery Start.

## TS-027 — No PR creation

Tech Spec mutation does not create PRs.

## TS-028 — No implementation start

Do not start implementation while authoring or repairing the Tech Spec.

## TS-029 — Trace self-review

Verify every important HOW decision traces to a PRD requirement or an explicit
cross-cutting technical need.

## TS-030 — Product-behavior self-review

If the spec introduces product behavior, stop and update PRD first.

## TS-031 — Deferred-detail self-review

Mark deferred implementation details clearly instead of guessing them.

## TS-032 — Backend-contract self-review

For backend-integrating work, verify the spec contains deployed response
samples or names the contract-verification spike that opens the wave.

## TS-033 — Stable-seam self-review

For deep or risky work, explain the stable interface or seam exercised by
implementation and tests.

## TS-034 — Body-purity self-review

Verify the body contains no workflow mechanics or lifecycle/readiness
instructions.

## TS-035 — Transition check

Entry: `mono:check discovery`; exit: `mono:check tech` plus Spec read-back. Handoff
checks `mono-tech` at entry/start; after start, repair/pre-PR drift applies.
