---
name: mono-issue
description: Use after excluding a raw idea when a request is unmistakably one-PR projectless issue-only work, or for create-then-approve renewal; Project relation or Project/PRD/Tech Spec chips, Issue slicing, deep/risky/multi-surface scope, or ambiguity fail closed to Project-first, while pre-ship drift routes to mono-ship.
---

# Mono Issue

Use this skill as the front door for genuinely one-PR, projectless work that qualifies for the issue-only lane. It collapses idea → discovery → handoff → issue into a single gate: a self-contained Linear Issue, an owner-approved scope fingerprint, and the `issue-only` label — no Project, PRD, or Tech Spec.

`mono-issue` owns first-time issue-only intake and create-then-approve renewal for an existing issue-only Issue. It is a front door, not a redirect or an internal atomic adapter. It grants the lane only when every eligibility condition holds.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `references/contracts/issue.md`
3. `references/issue-only-lane.md`
4. `references/readiness-gates.md`
5. `references/human-friendly-output.md`
6. `templates/issue.md`

Read when — load the file only when its condition is true for this run:

- `references/artifact-rules.md` — when this run must decide where a Linear record belongs or which stage owns it.
- `skills/mono-idea/SKILL.md` — when this run routes the request back to discovery.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.

Contract application:

- `references/contracts/issue.md` is the normative source for Issue artifact behavior. Apply `IS-001` through `IS-034` in full; `IS-005` supplies the issue-only routing exception and incorporates `references/issue-only-lane.md` without duplicating its protocol.
- If issue-only prequalification refuses the request, stop this skill without rendering or mutating an Issue. Route shaped Project-first work to `mono-handoff` and unshaped work to `mono-idea`; the destination lifecycle owner applies the Project-first rules.
- Render the self-contained Issue with `templates/issue.md`, applying every branch-relevant content, readiness, review, durability, and check rule from the bounded contract.

## Routing and fail-closed proof

Prove the right to enter issue-only before creating or renewing anything:

- A Project relation or Project/PRD/Tech Spec chips is an immediate refusal. Existing Project or shaped package context routes to `mono-handoff`; accepted pre-ship drift routes to `mono-ship`.
- If the request asks for Issue slicing, dependent slices, or more than one PR, refuse issue-only and route to `mono-handoff` for Project-first planning.
- If the work is deep, risky, multi-surface, cross-cutting, or ambiguous, fail closed to Project-first. Route a shaped request to `mono-handoff`; route an unshaped request to `mono-idea`.
- Only unmistakably one-PR projectless work may continue. Never infer eligibility from the caller naming `mono-issue`.
- An existing issue-only Issue body edit is not ordinary mutation. It may continue only through the create-then-approve renewal transaction below.

## When issue-only is granted — the nine eligibility conditions

The issue-only lane is granted only when all nine conditions hold for the activated package. Conditions 1–3 and 9 are outputs of the transaction; conditions 4–8 are prequalification inputs.

### Prequalification — judge on the raw request, before creating anything

4. Risk class is `tiny` or `standard`. `deep` and `risky` stay Project-first.
5. The work is authorable as a complete self-contained Issue with objective, scope, desired behavior, stable acceptance IDs, verification, explicit non-goals, and a non-vacuous behavioral oracle.
6. Exactly one PR delivers the whole independently acceptable outcome; no slicing or dependent Issue topology is needed.
7. The Issue is the sole authoritative entity and lifecycle carrier. No Project, PRD, or Tech Spec exists or is created.
8. The request has no risky domain, new actors, multi-surface or cross-cutting change, unresolved judgment, or critical escalation signal.

If any prequalification condition is unmet or uncertain, fail closed to Project-first and stop before the transaction.

### Established by the transaction, enforced by the resolver

1. A valid, fresh `mono-issue-only marker` carries Marker version 1, exactly the five contract fields, and no forbidden route-record field.
2. The exact verified `issue-only` label is present.
3. The live whole-body fingerprint, marker approval, and caller-verified owner approval agree.
9. The explicit approval decision is authenticated against the stable Linear user ID in `issueOnlyLane.ownerPrincipal`; author identity without an explicit owner decision is insufficient.

Any missing, stale, superseded, unverified, or ambiguous signal fails closed to Project-first. Marker-integrity errors remain hard failures.

## Create-then-approve intake and renewal transaction

Approval binds to the full whole-body SHA-256 of the Issue contract. Run these steps in order for first-time intake and again after any edit to an existing issue-only Issue body:

1. Create or update a non-startable Issue in the intake-authorized draft mode. Author the self-contained body by applying `references/contracts/issue.md` directly, especially `IS-005` through `IS-018` and `IS-028` through `IS-034`; do not call or read another Issue-writing SKILL.md. Leave the state type in `triage`, `backlog`, or `unstarted`. Set the assignee to the acting user (`assignee: "me"` on the Linear connector) when creating the Issue; a renewal leaves the existing assignee untouched. Assignment is Linear metadata rather than body content, so it changes no part of the whole-body fingerprint the owner approves below. Do not write the marker or label yet.
2. Run the mandatory review gate on the drafted body. `standard` requires `mono-review issue-only` to reach `ready`; `tiny` may use an explicitly recorded advisory exception. Record the disposition before fingerprinting.
3. Compute the fingerprint only with the installer-published resolver: `node ../.mono-agent-workflow/scripts/resolve-issue-context.mjs --issue <issue-body> --emit-fingerprint`. Pass the reviewed Issue body explicitly. Do not add a second hashing path or concatenate sections.
4. Present the reviewed body and exact fingerprint and wait for an explicit owner decision. Never self-approve or manufacture approval through the owner's connector. After the owner explicitly approves, record that decision as a Linear approval comment naming the exact fingerprint, made by or on the explicit instruction of the owner principal, and capture the comment author's stable Linear user ID for read-back. A connector comment without the preceding explicit decision carries no authority.
5. Read back the live body and approval comment. Recompute with `node ../.mono-agent-workflow/scripts/resolve-issue-context.mjs --issue <live-issue-body> --emit-fingerprint`; require both fingerprint equality and the owner principal's stable Linear user ID as author.
6. Bind label first, marker last. Set `issue-only`, then write the `mono-issue-only marker` with exactly `Marker version`, `Scope fingerprint`, `Acceptance IDs`, `Risk class`, and `Approval`. On any error, roll back the partial state. The marker must not contain `route_revision`, `assurance_vector`, `required_artifacts`, or a sixth field: маркер ≠ route-record.
7. Run the readiness check before activation: `mono-check issue` in issue-only mode must return `PASS`. Otherwise remove the marker and label and return `BLOCKED`.
8. Leave a prepared, approved, non-startable package. Intake never moves the Issue to started; `mono-implement` owns activation after resolver and delivery-check read-back.

The resolver command for downstream verification includes the live Issue, separate marker comment, project config, verified label, and approval fingerprint: `node <resolver> --issue <path> --marker <marker-comment> --config <project-config> --label issue-only --approval-verified <fingerprint>`.

## Renewal recovery

Renewal recovery differs from first-time rollback. After any body edit, the previous authoritative marker is stale. A failed renewal must remove or supersede that previous marker and remove the label; otherwise the resolver hard-fails before it can fall back. Write a new marker only after fresh review, fingerprinting, explicit owner approval, and read-back reconciliation.

The renewal path never promotes the Issue in place or routes its body edit to handoff repair. If scope or risk leaves the envelope before code, park the Issue, annul the marker approval, and restart Project-first. After a ready preflight, freeze the independently shippable slice and put expanded scope in a separate Project.

## Phase-1 go-live boundary

The lane remains config-gated. It is usable only when the consuming repo explicitly sets `issueOnlyLane.enabled: true` and a non-empty `ownerPrincipal`. Intake remains non-activating and Project-first behavior remains available unchanged.

## Rules

- Never create Project, PRD, or Tech Spec artifacts or their chips/resources in issue-only.
- Never infer issue-only from marker text alone; marker, verified label, authenticated explicit approval, config opt-in, and eligible risk must all agree.
- Reuse the installer-published resolver for every fingerprint and resolution; protocol strings and its five-field output are byte-stable.
- Write Linear-facing content in the project config language; default to Russian. Repo instructions remain English.
- Follow the machine-block convention: a short human lead precedes the unchanged marker block.

## Before finishing

- Confirm the Issue is self-contained, one PR, projectless, and executable by a zero-context agent.
- Confirm risk is `tiny` or `standard`, review disposition is current, and all fail-closed routing probes were applied.
- Confirm marker, label, and owner-approved fingerprint were bound only after read-back reconciliation and the Issue remains non-startable.
- Confirm first-time intake or create-then-approve renewal used the canonical resolver and `mono-check issue` passed.
- If any check fails, park the Issue and return `BLOCKED` or Project-first; never leave a half-opened lane.
