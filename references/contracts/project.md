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
to `mono:research` when the owner starts Research («Начать исследование» or words),
or the orchestrator starts it for a delegated Project defined in PC-019. An existing Project in Discovery without a Research document routes
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
No `next=` is the Tech Evaluation old path; the router remains unchanged. Handoff
first verifies any effective `mono-tech` for the current PRD and consumes a valid
record without another offer. Only without a valid tech record does ordinary or
large size require «Начать Tech Evaluation» / «Ещё обсудить». Consent from the owner
(or delegated orchestrator) is the request
that opens Tech Evaluation on the old path. Without consent, Handoff stops before
writing a package; discussion cannot bypass Tech Evaluation. Tiny work may skip it.
Handoff still consumes existing `mono-tech` on that old path.
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
Project stays in Idea until the owner starts Research, or the orchestrator starts
it for a delegated Project (PC-019); Idea approval always remains with the owner.

## PC-014 — Discovery state

`mono:research` moves an approved Idea Project to Discovery after its read-only
entry check, once the owner or delegated orchestrator starts it (PC-019). In Discovery, PRD is created and changed only
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
exception), execution Issue set, the start record bound to the shown summary and
that Issue set (a legacy package: its approval), and readiness to start from those
Issues. Ordinary Projects require `by=owner`; only delegated Projects (PC-019)
accept `by=orchestrator` with a reason and the countercheck verdict outside fences.

## PC-017 — Ship state ownership

`mono:ship` synchronizes Issue and PR state. Project Updates are not the ship
state mechanism.

## PC-018 — Transition check

Before finishing a Project mutation, run or report `mono:check <mode>` for the
transition being supported.

## PC-019 — Delegated Project

Only the latest Idea approval comment's outside-fence line
«Ведёт оркестратор: владелец принёс идею оркестратору <дата>.» delegates a Project;
repeat it on Idea reapproval. Projects delegated before this version may use an
explicit owner decision in a Project comment. Without either, the owner leads.
Do not add `by` to the strict `mono-idea` record. The owner always approves Idea
by pressing its approval button. A `stale` or `legacy-migrate` Idea record stops
autonomous Research and work starts: the orchestrator carries it to the owner,
waits for their new button approval, confirmed record and fresh check. Its own
start cannot reapprove an Idea snapshot. After that the delegated orchestrator
may start Research and work, answer stages
and approve their shown versions with reasons, including irreversible decisions
and changes to earlier owner decisions. Every `by=orchestrator` approval requires
an independent read-only countercheck and its model/version verdict outside fences
in the same comment. Taste-memory consent and first-product exemplars stay with
the owner; their later words reopen approvals. Merge/release policy stays configured.
