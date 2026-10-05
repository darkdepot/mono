# PRD artifact contract

This bounded contract is the normative source for PRD artifact behavior.
`mono:handoff` consumes it for Project-first package creation and repair;
`mono:ship` consumes it for accepted pre-ship drift. Use the shared
[artifact rules](../artifact-rules.md), [artifact quality](../artifact-quality.md),
[execution quality](../execution-quality.md), and
[questioning policy](../questioning.md) for cross-artifact policy. Render the
document with [templates/prd.md](../../templates/prd.md); do not duplicate the
template here.

## PR-001 — PRD routing

Use this contract inside the lifecycle owner that creates or updates a Linear
PRD after discovery, an explicit discovery skip, or an approved repair.

## PR-002 — Product truth

The PRD records WHAT the workflow achieves and how the user experiences it.

## PR-003 — Internal helper boundary

PRD writing is owned by lifecycle stages rather than exposed as a direct
artifact door. The normal post-discovery and repair workflow is `mono:handoff`;
accepted pre-ship drift belongs to `mono:ship`.

## PR-004 — Targeted-use eligibility

A direct request to write or repair a PRD must route to `mono:handoff` repair.
Accepted pre-ship drift routes to `mono:ship`; no other workflow mutates the
PRD directly.

## PR-005 — Linear-facing language

Write PRD content in the project-config language; default to Russian when the
config is absent.

## PR-006 — WHAT boundary

Define operator behavior, scope boundaries, requirements, acceptance, and
success criteria. Do not define HOW.

## PR-007 — Lightweight requirements shape

Keep the PRD as a lightweight requirements document rather than a process
transcript. Include material needed by Tech Spec and Issue consumers; omit
ceremony that does not help them.

## PR-008 — Product decisions stay in PRD

Resolve actors, user-visible behavior, MVP boundaries, and acceptance in the
PRD so the Tech Spec does not invent product decisions.

## PR-009 — Approved inputs

Ground the PRD in Project context and discovery output from `/brainstorming` or
`/office-hours`.

## PR-010 — Explicit discovery skip

When both discovery workflows are explicitly skipped, create PRD-lite from the
strengthened brief and mark its lower confidence.

## PR-011 — Core product coverage

Capture the problem, target operator, workflow, scenarios, requirements,
non-goals, and acceptance.

## PR-012 — Requirement IDs by risk

For standard or deep work, assign stable `R1`, `R2`, and subsequent requirement
IDs. Plain bullets are reserved for very small PRD-lite documents.

## PR-013 — Actor-capability-benefit coverage

Check scenarios and requirements for actor, capability, and benefit. Add a long
user-story section only when it materially clarifies product truth.

## PR-014 — Conditional acceptance examples

Use stable `AE` examples for stateful or conditional behavior, express them as
given/when/then, and trace them to `R` IDs. A localized human-readable slug may
supplement but never replace the bare machine ID.

## PR-015 — Dual success criteria

Define success for both the human/operator outcome and handoff quality, so Tech
Spec and Issue slicing proceed without inventing product behavior.

## PR-016 — Behavior-validation intent

Name user-visible behaviors that Tech Spec and Issue validation must prove.
Keep this product-facing and exclude test files and implementation commands.

## PR-017 — Complete product inventory

When relevant, cover actors, current and target workflows, scenarios,
requirements, acceptance examples, success criteria, boundaries, assumptions,
open questions, non-goals, and links.

## PR-018 — Stable identifier families

Use stable `A` actor IDs, `F` flow IDs, `R` requirement IDs, and `AE` acceptance
example IDs.

## PR-019 — Traceable requirements

Make each requirement observable, or structural with enough rationale to trace
into the Tech Spec.

## PR-020 — Question threshold

Ask only about product, workflow, scope, or risk choices that cannot be inferred
from Project, discovery, or repository context.

## PR-021 — Review acceptance record

Record user review acceptance as a Linear comment.

## PR-022 — No Issue creation

PRD mutation does not create Issues.

## PR-023 — No implementation architecture

Keep implementation architecture in Tech Spec, not PRD.

## PR-024 — No Delivery transition

PRD creation belongs to Discovery or Handoff and must not move the Project to
Delivery.

## PR-025 — No implementation start

Do not start implementation while authoring or repairing the PRD.

## PR-026 — Invention self-review

Before finishing, identify and fix any product behavior that the Tech Spec
would otherwise have to invent.

## PR-027 — Coverage self-review

Verify that every important requirement names an actor, capability, and
benefit.

## PR-028 — Validation-boundary self-review

Verify that the PRD names its behavior-validation target without leaking HOW.

## PR-029 — Requirement-proof self-review

Verify every standard/deep requirement has an observable behavior or an
explicit structural reason.

## PR-030 — Conditional-ambiguity self-review

Verify acceptance examples cover ambiguous conditional behavior.

## PR-031 — HOW deferral self-review

Verify all implementation details remain deferred to Tech Spec.

## PR-032 — Discovery check

Before finishing, run or report `mono:check discovery`.
