# Project artifact contract

This bounded contract is the normative source for Project artifact behavior.
Lifecycle owners consume it directly: `mono:idea` creates or strengthens an
Idea Project, while `mono:handoff` creates or repairs the Project-first package.
It defines artifact behavior, not lifecycle orchestration. Use the shared [artifact rules](../artifact-rules.md),
[readiness gates](../readiness-gates.md), and [lifecycle](../lifecycle.md) for
cross-artifact policy. Render the body with
[templates/project.md](../../templates/project.md); the template remains the
single source for presentation shape.

## PC-001 — Project routing

Use this contract for Linear Project mutations. Raw ideas and existing Idea
Projects route to `mono:idea`. An existing Project in Discovery without a
Research document routes to `mono:research`, except a package approved strictly
before `researchGate.since` (config, otherwise `RESEARCH_GATE_DEFAULT_SINCE` in
`scripts/idea-gate.mjs`); without an approved PRD to `mono:discovery` (old path in
`references/lifecycle.md`); otherwise, and for package repairs, to `mono:handoff`.

## PC-002 — Concise product brief

Create or update the Project overview as a concise product brief.

## PC-003 — Linear-facing language

Write the Project body in the project-config language; default to Russian when
the config is absent.

## PC-004 — Overview boundary

Keep the Project at overview level. Never inline the PRD or Tech Spec.

## PC-005 — Body concerns by stage

In Idea, limit the body to what, why, and target outcome, with second-level
headings: `Что`, `Зачем`, `Образ результата` in default Russian output. Unknowns
live in the approval comment snapshot. Handoff adds in scope and out of scope
(`Что входит`, `Что не входит`); these concerns remain outside the Idea body.

## PC-006 — No workflow dashboard

Do not put active documents, active Issues, status bookkeeping, lifecycle
notes, or workflow mechanics in the Project body.

## PC-007 — Relationship storage

Store document and Issue relationships in Linear metadata, resources,
comments, and the handoff package.

## PC-008 — Active document set

For this MVP, the only active Project document types are PRD, Tech Spec, and
Research («Исследование»).

## PC-009 — Default Issue plan

Plan one active execution Issue by default.

## PC-010 — Review-gate record

Record risk, required/advisory/skipped state, verdict, evidence or comment
link, inspected artifacts, finding disposition, owner workflow, and next step
in Linear comments, metadata, or the handoff package rather than the body.

## PC-011 — No premature PR chips

Do not add PR chips before a real PR exists.

## PC-012 — No obsolete PR references

Remove obsolete or closed PR chips, and do not keep raw PR URLs in the durable
Project body.

## PC-013 — Idea state

In Idea, keep only the three-section strengthened brief defined in PC-005;
PRD, Tech Spec, and Issue must not exist yet. Preserve any former scope sections
in the approval comment notes before replacing the body.

## PC-014 — Discovery state

In Discovery, PRD is created by `mono:discovery`, Tech Spec normally by
`mono:handoff`. They coexist with the Project before Delivery.

## PC-015 — Handoff readiness state

While PRD, Tech Spec, and proposed or approved Issue slicing are made current,
keep the Project in Discovery or an equivalent configured pre-delivery state.
Record readiness in comments or check output, not in the Project body.

## PC-016 — Delivery state

Delivery begins only after `mono:implement` verifies the Project, current PRD,
Tech Spec or explicit no-spec exception, approved execution Issue set, explicit
implementation-start approval, and readiness to start from those Issues.

## PC-017 — Ship state ownership

`mono:ship` synchronizes Issue and PR state. Project Updates are not the ship
state mechanism.

## PC-018 — Transition check

Before finishing a Project mutation, run or report `mono:check <mode>` for the
transition being supported.
