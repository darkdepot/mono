# Issue artifact contract

This bounded contract is the normative source for the Issue lifecycle writers:
Project-first package creation and repair owned by `mono:handoff`, projectless
issue-only intake and renewal owned by `mono:issue`, and accepted pre-ship drift
owned by `mono:ship`. Use the shared
[artifact rules](../artifact-rules.md), [artifact quality](../artifact-quality.md),
[readiness gates](../readiness-gates.md), and
[execution quality](../execution-quality.md) for cross-artifact policy. Render
the description with [templates/issue.md](../../templates/issue.md); do not
duplicate the template here.

## IS-001 — Issue routing

Use this contract to create or update a one-PR Linear Issue. `mono:handoff`
owns the Project-first branch from Project, PRD, and Tech Spec context;
`mono:issue` owns only unmistakable projectless issue-only intake and renewal;
`mono:ship` owns accepted pre-ship drift sync.

## IS-002 — Execution contract

The Issue is the one-PR execution contract.

## IS-003 — Internal helper boundary

Issue writing stays behind its lifecycle owner. `mono:handoff` writes and
repairs the Project-first package before pre-ship; `mono:issue` is the issue-only
front door and must refuse Project relations or Project, PRD, or Tech Spec
chips; `mono:ship` applies accepted pre-ship drift.

## IS-004 — Targeted-use eligibility

Route Project-first Issue creation and repair before pre-ship through
`mono:handoff`, including reviewer-feedback updates or maintenance. Accepted
pre-ship drift is the terminal override and belongs to `mono:ship`. An existing
issue-only Issue body may change only through `mono:issue` renewal using the
full create-then-approve transaction. No other direct Issue mutation route is
eligible.

## IS-005 — Issue-only branch

In the `mono:issue` branch, apply the
[issue-only lane contract](../issue-only-lane.md) in full for its authoring
modes, mutation limits, renewal path, routing exception, absent Project
artifacts, and project-first fallback. The protocol is incorporated by
reference and is not restated here.

## IS-006 — Linear-facing language

Write Issue content in the project-config language; default to Russian when the
config is absent.

## IS-007 — One Issue by default

Create one Issue by default.

## IS-008 — Project-first sources

In the `mono:handoff` branch, build a project-first Issue from Project, PRD, and
Tech Spec, or an explicit no-spec exception. These sources make the package
ineligible for `mono:issue`.

## IS-009 — Read-first context

Include a localized Read first section naming Project, PRD, Tech Spec, and
supporting documents or stable code paths.

## IS-010 — Review-gate record

Carry the risk classification and review-gate disposition: verdict, evidence
or comment link, finding disposition, owner workflow, and next step. A tiny
advisory exception must be explicit.

## IS-011 — Context snapshot

Put implementation-critical context directly in the Issue.

## IS-012 — Extract, do not copy

Do not copy PRD or Tech Spec wholesale. Extract the one-PR goal, scope,
surfaces, validation, acceptance, and non-goals.

## IS-013 — Scope trace

Map Issue scope to PRD requirement IDs and Tech Spec surfaces when available.

## IS-014 — Agent readiness

Mark `AFK` only when another agent can execute from the artifact set without
new human judgment. Otherwise mark `HITL` and name the exact product, design,
external-access, manual-QA, or risk-acceptance dependency.

## IS-015 — Dependencies

Name the parent or source package, `Blocked by` dependencies, and whether the
Issue can start immediately.

## IS-016 — Bug and performance proof

For bug or performance work, include current behavior, desired behavior,
reproduction or benchmark loop, and fix-proof expectation. If the original
symptom is not reproducible yet, say so explicitly.

## IS-017 — Key contracts

When material, name stable types, config shapes, endpoints, domain contracts,
invariants, or external behavior. Do not turn them into a file-by-file edit
script.

## IS-018 — Verification boundary

Include concrete validation, acceptance criteria, and non-goals.

## IS-019 — Project-first chips

Use Project, PRD, and Tech Spec chips only in the `mono:handoff` Project-first
branch. Their presence makes `mono:issue` refuse the request.

## IS-020 — Document resources

Add PRD and Tech Spec as Linear resources or links when the connector supports
it.

## IS-021 — Prefer chips to raw URLs

Do not put raw PRD or Tech Spec URLs in the body when chips can represent the
documents.

## IS-022 — No attached documents

Do not attach PRD or Tech Spec documents to the Issue.

## IS-023 — Vertical slicing

Only `mono:handoff` may split work when one PR is truly too large, and it must
split into vertical slices with explicit dependencies. A request for slicing is
ineligible for `mono:issue`.

## IS-024 — Ready before coding

Do not start coding until the Issue is sufficient for another agent.

## IS-025 — No premature PR chips

Do not add PR chips before a real PR exists.

## IS-026 — No raw-discovery creation

Do not create Issues directly from raw discovery plans before Project, PRD,
and Tech Spec are current.

## IS-027 — No Delivery transition

`mono:issue` never moves the Project to Delivery. `mono:implement` owns Delivery
Start after approval to execute from the Issue.

## IS-028 — Durable instructions

Exclude line numbers, brittle implementation choreography, and open-file-at-line
instructions. File paths are allowed only as stable read-first surfaces.

## IS-029 — Zero-context self-review

Verify another zero-context implementation agent can start without the
discovery transcript.

## IS-030 — Readiness self-review

Verify `AFK` contains no unresolved human judgment and `HITL` names the exact
human dependency.

## IS-031 — Feedback-loop self-review

Verify bug and performance work carries a feedback-loop contract.

## IS-032 — Acceptance self-review

Verify acceptance criteria are concrete enough to check after the PR.

## IS-033 — Scope-drift self-review

If a Project-first Issue introduces scope absent from PRD or Tech Spec before
pre-ship, return to handoff approval. At pre-ship, `mono:ship` applies accepted
drift and routes unaccepted scope change back through handoff approval. If
issue-only scope grows beyond its approved one-PR envelope, fail closed to
Project-first instead of renewing it in place.

## IS-034 — Issue check

Before finishing, run or report `mono:check issue`.
