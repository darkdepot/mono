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

Use this contract when creating or updating the Linear Project that serves as
the workflow source of truth. A raw request to write a Project routes to
`mono:idea`; an existing Project or shaped-discovery repair routes to
`mono:handoff`.

## PC-002 — Concise product brief

Create or update the Project overview as a concise product brief.

## PC-003 — Linear-facing language

Write the Project body in the project-config language; default to Russian when
the config is absent.

## PC-004 — Overview boundary

Keep the Project at overview level. Never inline the PRD or Tech Spec.

## PC-005 — Five body concerns

Limit the body to what, why, target outcome, in scope, and out of scope. In
default Russian output the corresponding headings are `Что`, `Зачем`, `Образ
результата`, `Что входит`, and `Что не входит`.

## PC-006 — No workflow dashboard

Do not put active documents, active Issues, status bookkeeping, lifecycle
notes, or workflow mechanics in the Project body.

## PC-007 — Relationship storage

Store document and Issue relationships in Linear metadata, resources,
comments, and the handoff package.

## PC-008 — Active document set

For this MVP, the only active Project document types are PRD and Tech Spec.

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

In Idea, keep only the strengthened brief; PRD, Tech Spec, and Issue must not
exist yet.

## PC-014 — Discovery state

In Discovery, the Project coexists with discovery output. Durable PRD and Tech
Spec may exist and are normally created by `mono:handoff`.

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
