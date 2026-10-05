# Tech Spec artifact contract

This bounded contract is the normative source for Tech Spec artifact behavior.
`mono:handoff` consumes it for Project-first package creation and repair;
`mono:ship` consumes it for accepted pre-ship drift. Use the shared
[artifact rules](../artifact-rules.md), [artifact quality](../artifact-quality.md),
[readiness gates](../readiness-gates.md), and
[execution quality](../execution-quality.md) for cross-artifact policy. Render
the document with [templates/tech-spec.md](../../templates/tech-spec.md); do not
duplicate the template here.

## TS-001 — Tech Spec routing

Use this contract inside the lifecycle owner that creates or updates a Linear
Tech Spec before Delivery, Issue creation, or an approved repair.

## TS-002 — Implementation truth

The Tech Spec records HOW the approved PRD will be built.

## TS-003 — Internal helper boundary

Tech Spec writing is owned by lifecycle stages rather than exposed as a direct
artifact door. The normal post-discovery and repair workflow is `mono:handoff`;
accepted pre-ship drift belongs to `mono:ship`.

## TS-004 — Targeted-use eligibility

A direct request to write or repair a Tech Spec must route to `mono:handoff`
repair. Accepted pre-ship drift routes to `mono:ship`; no other workflow mutates
the Tech Spec directly.

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

When an engineering review exists, translate it into durable Tech Spec form.

## TS-011 — Lightweight engineering pass

When no engineering review exists, perform a lightweight engineering pass and
write a lightweight spec.

## TS-012 — Requirement trace coverage

Trace implementation decisions back to PRD requirement IDs.

## TS-013 — Stable implementation units

Use stable `U1`, `U2`, and subsequent implementation-unit IDs.

## TS-014 — Core implementation coverage

Include system-wide impact, contracts, failure modes, validation, rollout, and
rollback.

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

For standard, deep, risky, or review-sensitive packages, make requirement
trace, validation, rollback, and failure modes concrete enough for
`mono:review artifact`, without adding review-workflow sections to the body.

## TS-018 — Narrow no-spec exception

Use a no-spec exception only for truly simple, low-risk work.

## TS-019 — Forbidden no-spec domains

Never use a no-spec exception for risky, cross-cutting, data, auth, release, or
multi-surface work.

## TS-020 — Unknowns by phase

Separate plan-time and implementation-time unknowns. Do not pretend helper
names, SQL, branch sequencing, or runtime failure details are settled before
implementation touches the code.

## TS-021 — Relevant sections only

Include architecture, contracts, boundaries, risks, files/surfaces,
validation, rollout, and rollback when relevant; omit a section only when it
adds no value.

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

Tech Spec creation belongs to Discovery or Handoff. Only `mono:implement` owns
Delivery Start.

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

For standalone use run or report `mono:check discovery`; inside `mono:handoff`,
run or report `mono:check handoff`.
