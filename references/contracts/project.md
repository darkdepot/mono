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
Projects route to `mono:idea`; an Idea Project with a verified approval record routes
to `mono:research` only when the owner starts Research («Начать исследование» or the
owner's words). An existing Project in Discovery without a Research document routes
to `mono:research`, except a package approved strictly before `researchGate.since` (config, otherwise `RESEARCH_GATE_DEFAULT_SINCE` in
`scripts/idea-gate.mjs`); without an approved PRD, a Project on the old path
(`skills/check/SKILL.md`, mode `discovery`, Old path) routes to `mono:handoff` unless
the owner explicitly requests Discovery, any other to `mono:discovery`. An approved PRD routes by one approval containing `design=needed|not-needed`
and `next=design|tech-evaluation|handoff`, with the design reason below it.
Needed always goes to Design; its approval then routes by PRD size: ordinary
and large Projects to Tech Evaluation, tiny work to Handoff. Not-needed routes
directly by size. At every reapproval Discovery decides design first, then size;
changed routes invalidate downstream approvals. Not-needed preserves absence
of `next=` only when the preceding PRD approval lacked it; a first record must
have `next=`. A PRD approval without `design=` is the Design old path, not a
stop or a date: keep its recorded Tech Evaluation route until reapproval.
No `next=` is the Tech Evaluation old path, skipping it unless requested by
the owner; Handoff still consumes existing `mono-tech` on that old path.
Route validation precedes all exemptions, then every required Design and Tech
approval must pass its command. Package repairs stay with `mono:handoff`.

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
live in the approval comment snapshot. Scope boundaries live in the PRD; Handoff
leaves the approved body unchanged, and legacy packages may keep the in scope
and out of scope sections (`Что входит`, `Что не входит`) they already added.

## PC-006 — No workflow dashboard

Do not put active documents, active Issues, status bookkeeping, lifecycle
notes, or workflow mechanics in the Project body.

## PC-007 — Relationship storage

Store document and Issue relationships in Linear metadata, resources,
comments, and the handoff package.

## PC-008 — Active document set

For this MVP, the only active Project document types are PRD, Tech Spec, and
Research («Исследование»). The package record is a Project comment, not a
document: one current version holds input versions, shared decisions, «Решил
сам», the reconciliation result and the execution Issue graph.

## PC-009 — Default Issue plan

Plan one active execution Issue by default. A second and third need a named,
recorded reason (too big for one review, a shared base several parts wait for,
or an external-service probe first); more than three only with the owner's
answer (split the Project or allow more).

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
PRD, Tech Spec, and execution Issues must not exist yet. Preserve any former scope
sections in the approval comment notes before replacing the body. The approved
Project stays in Idea until the owner starts Research; Research never starts by itself.

## PC-014 — Discovery state

`mono:research` moves an approved Idea Project to Discovery after its read-only
entry check, once the owner starts it. In Discovery, PRD is created and changed only
by `mono:discovery`. `mono:handoff` writes neither PRD nor Tech Spec; it writes the
package record. `mono:tech-evaluation` creates the short Tech Spec after page
approval, between Discovery and Handoff; tiny work and the Tech Evaluation old
path skip it. A legacy Tech Spec remains a valid input. These coexist before Delivery.

## PC-015 — Handoff readiness state

While the package is assembled, keep the Project in Discovery or an equivalent
configured pre-delivery state. After the package record, its review and execution
Issues are written and `mono:check handoff` passes, Handoff sets Ready before the
owner's start; Ready never authorizes implementation. Record readiness in comments
or check output, not in the Project body.

## PC-016 — Delivery state

Delivery begins only after `mono:implement` verifies the Project, current PRD,
the current package record (a legacy package: Tech Spec or explicit no-spec
exception), execution Issue set, the owner's start record (`by=owner`, bound to
the shown summary and that Issue set; a legacy package: its approval), and
readiness to start from those Issues. The orchestrator never gives the start.

## PC-017 — Ship state ownership

`mono:ship` synchronizes Issue and PR state. Project Updates are not the ship
state mechanism.

## PC-018 — Transition check

Before finishing a Project mutation, run or report `mono:check <mode>` for the
transition being supported.
