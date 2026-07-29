---
name: mono-implement
description: Use when starting or running implementation from approved Linear Issue(s) after handoff.
---

# Mono Implement

Use this skill to own Delivery Start and implementation execution from approved Linear Issue(s), including an approved issue-only package resolved through the shared context seam.

`mono-implement` starts only after either (a) `mono-handoff` produced a current Project, PRD, Tech Spec, and approved execution Issue(s), or (b) `mono-issue` produced a self-contained Issue whose resolver seam is `issue-only` with fresh owner approval. It verifies implementation-start approval, moves the resolved lifecycle entity into Delivery/started state when ready, selects the implementation engine, runs implementation from the approved Issue(s), and exits into `mono-preflight`.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `skills/mono-check/SKILL.md`
3. `references/readiness-gates.md`
4. `references/execution-quality.md`
5. `references/lifecycle.md`
6. `references/human-friendly-output.md`

Read when — load the file only when its condition is true for this run:

- `references/issue-only-lane.md` — when the resolved seam is `lifecycle_state_entity=issue`, or when a lane park, freeze, or exit decision is in play.
- `skills/mono-preflight/SKILL.md` — when this stage exits `implemented-needs-preflight`.
- `skills/mono-review/SKILL.md` — when the package context does not already record the disposition of a `mono-review handoff` finding.
- `references/artifact-rules.md` — when this run must decide where a Linear record belongs or which stage owns it.
- `references/artifact-quality.md` — when this run writes, queues, or repairs the body of a Linear artifact or a Linear-facing comment.
- `references/artifact-intake.md` — when the package context carries a handoff artifact intake summary.
- `references/questioning.md` — when running interactively and a product, UX, or business question has to be asked; an AFK worker never asks.
- `references/orchestration.md` — when this stage runs from a dispatch, before the orchestration branch of `start-checkpoint`.
- `templates/orchestrator-report.md` — when this stage runs from a dispatch, before writing the exit report.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.

When to use:

- The user says "implement", "start implementation", "build this", or equivalent after approved Linear Issue(s) exist.
- `mono-handoff` completed Issue creation and the user explicitly approved starting now.
- `mono-issue` completed the issue-only create-then-approve transaction and the live resolver returns `package_kind=issue-only` with `approval_status=approved-fresh`.
- A fresh implementation agent receives approved Linear Issue(s) and needs a bounded start workflow.

Do not use:

- Before either a current approved Project-first package (Project, PRD, Tech Spec or explicit no-spec exception, and execution Issue) or a current resolver-approved issue-only package exists.
- From raw `/office-hours`, `/brainstorming`, review plans, local markdown plans, or chat history alone.
- For PR creation, review-loop stabilization, deploy, or closeout. PR creation/review belongs to `mono-ship`; deploy and closeout belong to `mono-deploy`.

Inputs to gather:

- Fresh package context: Project, PRD, Tech Spec, approved Issue(s), resources, comments, and review/check state for Project-first; or the self-contained Issue, marker, verified label, authenticated owner approval, and review/check state for issue-only.
- Handoff artifact intake summary when recorded in Linear comments, resources, or package notes.
- Package approval comment and implementation-start approval, if already recorded.
- Project config, including optional `Implementation workflow`.
- Prior operational learnings for this repo through `gstack-learnings-search` when the helper is available.
- Minimal repo context needed to understand commands, conventions, and validation.
- Current git branch, worktree state, and remote/base branch status.

Workflow states:

Pack identity gate: before any work in this stage, both on its first start and
after every resume, read `packVersion`, `sourceCommit`, and `surfaceRevision`
from the dispatch snapshot and run the installed
`../.mono-agent-workflow/scripts/verify-pack-state.mjs identity` helper against
the installed lockfile — that path is relative to this installed skill's own
directory, never to the worktree, and the canonical invocation with its
required flags and lockfile path lives in the Pack identity gate invocation
section of `references/orchestration.md`. Under orchestration, run the fully
resolved command the dispatch carries. Any mismatch exits `blocked` before code
or lifecycle work; record the mismatch and the same three dispatch identity
fields in the worker report. Never continue on a different installed pack.

1. `start-checkpoint`
   - Check the mode first: a stage started from a dispatch runs the
     `start-checkpoint` orchestration branch below instead of the Linear
     operations in the bullets that follow.
   - Fetch fresh Linear context.
   - Verify approved execution Issue(s) exist.
   - Verify or obtain explicit implementation-start approval.
   - Confirm required `mono-review handoff` findings are resolved, accepted, or explicitly deferred.
   - Confirm delivery prerequisites are present before changing lifecycle state.
   - Move the Project to Delivery only after approval and prerequisites are explicit.
   - Run or report `mono-check delivery` after the Project is in Delivery.
   - Inspect git state and create or switch to a safe implementation branch when needed.
   - Consult prior learnings with `gstack-learnings-search --limit 10` (optionally `--query`/`--type` scoped to the Issue topic) when the helper is available. Treat results as advisory context only, never as a gate; when the helper is unavailable or returns nothing, proceed and report that.
   - Record a human Linear comment that implementation started.
2. `execute`
   - Select the implementation engine.
   - Implement only the approved one-PR Issue slice unless the Issue plan explicitly supports parallel slices.
   - Keep product discovery closed. Ask only for product, UX, business, external access, dirty-worktree, or risk decisions that block safe execution.
   - Run targeted validation as the implementation progresses.
3. `exit`
   - Return exactly one terminal status.
   - Record changed files, tests/checks run, tests/checks not run, branch/dirty state, drift summary, Linear comment outcome, and next workflow.
   - For `blocked`, `needs-human`, and `scope-drift-needs-handoff`: post a short Russian Linear exit comment on the Issue following the Linear Exit Comments rule in `references/human-friendly-output.md`. (`implemented-needs-preflight` is handled by the next workflow — no extra comment needed here.)

## Orchestration branch of `start-checkpoint`

This branch runs when the stage was started from a dispatch built on
`templates/orchestrator-dispatch.md`. It has zero required Linear operations:
zero Linear reads, zero Linear writes. Mode precedence itself is single-homed
in the Orchestration Mode Precedence section of `references/orchestration.md`;
this branch is only how `start-checkpoint` executes under it.

1. Run the pack identity gate exactly as the dispatch spells it out. A
   mismatch or a non-zero exit is `blocked` before every other step here.
2. Take the package context from the dispatch snapshot — Project, PRD, Tech
   Spec, Issue body, recorded decisions, and recorded approvals. This replaces
   "Fetch fresh Linear context"; issue no Linear call.
3. Verify from that snapshot that the approved execution Issue and an explicit
   implementation-start approval are present, and that required
   `mono-review handoff` findings are resolved, accepted, or explicitly
   deferred. A snapshot that cannot show one of these is a `blocked` report
   naming the missing field — never an assumption, never a Linear lookup.
4. Resolve the context seam through the Context-seam branch below before the
   gate-ack and before any lifecycle mutation, keeping the gate in its
   existing position ahead of the lifecycle move. Its inputs come from the
   dispatch's
   context-seam and issue-only snapshot fields; a snapshot that cannot supply
   a required input is `blocked`, and a `blocked` report carries no lifecycle
   mutation. The seam's own fail-closed rules, gate ordering, and exit
   statuses are unchanged in this mode.

   Gate pause, between steps 4 and 5: when this dispatch carries a lifecycle
   move, steps 1-4 above are its gate phase and the gate phase ends here.
   Write the gate-ack the dispatch names and stop until you are resumed. The
   ack shape, the blocked and no-ack paths, and how each transport pauses and
   resumes live in the Two-Phase Dispatch Handshake section of
   `references/orchestration.md`. A pre-move snapshot is the NORMAL state of
   this phase and never a finding here. On the issue-only lane, evaluate
   `mono-check delivery` in issue-only mode before you ack and carry its
   verdict into the ack, because it gates the move this dispatch carries. A
   dispatch that carries no lifecycle move has no gate phase and continues
   straight into step 5.
5. Perform no lifecycle move and no delivery check against Linear. After a
   gate phase this step runs only once you are resumed, and it reads the
   dispatch snapshot as amended by the resume signal's read-back of the
   applied moves — that amended post-move state, never the pre-move snapshot,
   is what every check here evaluates. Re-run the pack identity gate first. An
   amendment that does not show this dispatch's move applied is a
   hard stop, not a shrug: report `blocked` naming the move and the missing
   read-back, and write no code. A dispatch that carried no lifecycle move has
   no amendment to read and arrives here directly. Which mutation you queue
   depends on the lane, and the two lanes differ.
   - Project-first: queue no lifecycle move in this lane. The orchestrator
     applies the Delivery move on your gate-ack, before it resumes this stage
     for execution, so the amended state already shows the Project in
     Delivery and is the post-move state the interactive order requires;
     re-queuing it would be a redundant mutation. A dispatch that carried no
     Delivery move has no ack and no amendment, and needs none: its own
     snapshot is already that state, which is why it carried no move — the
     ordinary case of a later Issue in a Project that reached Delivery long
     ago. Either way the state you evaluate must SHOW the Project in Delivery;
     a snapshot with no move applied and no amendment naming one is the hard
     stop above, never a state to work around.
     Take the "report" arm of "run or report": evaluate `mono-check delivery`
     against that state, record the verdict, and record in `notes`
     that it is snapshot-based and which of the two cases applied. Do not
     report a verdict derived from state you cannot see,
     and do not defer the check onto a queued
     mutation — this mode has no protocol that would carry a deferred check.
   - Issue-only: the delivery check precedes the Issue-to-started move, and
     it evaluates the Issue's own inputs — review disposition, marker, label,
     owner approval, oracle, fingerprint — which that move does not change,
     so the gate phase is its correct evaluation state and you evaluated it
     there. On a `gates-passed` ack the orchestrator applies the
     Issue-to-started move before resuming you, so this lane queues no
     lifecycle mutation either; confirm the amendment shows it and record the
     verdict. A dispatch that carried no activation move — a retry on an Issue
     already in its started state — has no ack and no amendment either;
     evaluate the same Issue-owned inputs from the snapshot and require that
     snapshot to show the Issue already started. A real verdict other than
     `PASS` stops before code as
     `needs-human`; a snapshot that cannot supply one of those inputs
     is `blocked` naming the missing input. Neither of those outcomes reaches
     a `gates-passed` ack, so neither moves the Issue: the ack goes out
     `blocked` and the stage report carries whichever of those two statuses
     you actually hit.
   What must be true before code is already true: steps 3 and 4 verified it
   from the snapshot, and any lifecycle move this dispatch carried was applied
   and read back by the orchestrator before it resumed you — a dispatch that
   carried none needed none. Every other mutation this stage produces is still
   queued rather than applied — treat it as queued, not as done: it lands when
   the orchestrator applies it at the stage boundary, so Linear lags this
   worktree for the rest of the stage, per the queued-mutation clause of
   Orchestration Mode Precedence.
   Record in the report `notes` which arm of "run or report" applied and on
   what state. Every queued mutation goes into `linear_mutations_pending` in
   its required shape and the orchestrator applies it with read-back.
6. Use the worktree and branch the dispatch names; do not create a branch and
   do not switch branches.
7. Consult prior learnings with `gstack-learnings-search` exactly as in the
   interactive branch, and record `helper unavailable` when the helper is
   absent.
8. Queue the implementation-start comment in `linear_mutations_pending` using
   the Implementation-start comment shape below; do not post it.
9. The interactive implementation-start approval prompt below is not used in
   this mode — there is no user on the worker's side and the dispatch carries
   the recorded approval. A missing recorded approval is `blocked`, never a
   question to the user.

Ordering in this branch mirrors the interactive one: identity gate, snapshot
context, approval and findings, context seam, gate pause, then the lane's own
delivery-check and lifecycle order. Queuing a mutation is how this mode
performs a Linear write, which is why
a gate that must precede a lifecycle change must also precede its queuing —
and the gate-ack is how this mode places those same gates ahead of a lifecycle
move the orchestrator applies instead.

## Context-seam branch at Delivery Start

Resolve the 5-field context seam before changing lifecycle state. For every candidate Issue, use the installer-published `../.mono-agent-workflow/scripts/resolve-issue-context.mjs` with the live Issue body, current marker comment, project config, verified `issue-only` label, and the fingerprint read from an authenticated owner-approval comment. Also run the same resolver with `--emit-fingerprint` against the live Issue body at start time. Do not compute a second fingerprint or use the superseded section-hash formula: the resolver's whole-body SHA-256 is authoritative.

Branch only on the resolved seam:

- `lifecycle_state_entity=project`: first validate that the current Issue belongs to a complete, approved Project-first package. A `project` lifecycle entity does not prove that Project artifacts exist: an escaped issue-only candidate also resolves to this fail-closed seam. Preserve the trusted candidate provenance read for the resolver call (parent relationship plus verified marker/label/approval presence) outside the five-field output; it may select fallback handling, but it never reclassifies the seam or adds a sixth field. When Project, PRD, Tech Spec/no-spec exception, and approval are present, execute the existing `start-checkpoint`, Delivery lifecycle move, approval UX, readiness check, implementation-start comment, and execution flow exactly as written above. Project-first branch remains unchanged. When those Project-first prerequisites are absent, park/restart through the deterministic fallback instead of running the Project lifecycle path.
- `lifecycle_state_entity=issue`: this is the issue-only branch. Require `package_kind=issue-only`, `approval_status=approved-fresh`, a non-empty `behavioral_oracle`, and `risk_class` in `tiny|standard`. The resolver invocation is the start-time fingerprint verification: it must prove that the owner-approved fingerprint, marker fingerprint, caller-verified fingerprint, and freshly emitted whole-body fingerprint still agree. A resolver integrity error (`broken marker` or `stale marker`) is a hard `needs-human` stop and is never silently downgraded. A successful fail-closed `project-first` result from an issue-only candidate triggers the deterministic pre-code fallback in the `project` branch above; it does not enter this branch and is not treated as a complete Project-first package. Never infer issue-only from a parentless Issue or marker text.

For a fresh issue-only branch:

1. Treat the authenticated owner fingerprint approval as the explicit issue-only implementation-start approval; do not ask for a Project-first second approval or manufacture a new approval.
2. Run `mono-check delivery` in issue-only mode against the resolved self-contained Issue, its review disposition, marker, label, owner approval, oracle, and fingerprint. Do not require a Project, PRD, or Tech Spec in this mode. Anything other than `PASS` stops before code as `needs-human` while the Issue is still non-startable.
3. Move the **Issue** into its configured started/in-progress state only after the delivery check passes. Do not create or move a Project, because the Issue is the lifecycle carrier.
4. Record the implementation-start comment on the Issue, naming the Issue-owned lifecycle, approved fingerprint, oracle acceptance IDs, selected engine, and planned verification.
5. Execute only the one-PR behavior described by the Issue oracle and exit normally into `mono-preflight`.

The issue-only lane never promotes an Issue into a Project in place. Before coding: park the Issue, supersede the marker approval, and restart Project-first when scope, topology, or risk leaves the lane. Follow the deterministic fallback in `references/issue-only-lane.md`; do not retrofit Project/PRD/Tech Spec onto the parked Issue.

Implementation-start approval UX:

For Project-first this is the SECOND approval in the workflow. The first approval was package approval granted during `mono-handoff`. Implementation-start approval is a separate, more consequential gate: it authorises Project movement to Delivery, branch creation, and code writing. Issue-only uses the authenticated owner fingerprint approval rule in the context-seam branch above instead of this Project-specific prompt.

Required prompt shape:

```text
Пакет утверждён. Теперь отдельное решение — старт реализации.

Что это разрешает: Project переходит в Delivery, создаётся ветка, агент пишет код по <Issue keys>.
Чего это НЕ разрешает: PR, merge и deploy — они потребуют отдельных шагов.

1. Стартовать сейчас — рекомендую, если scope финален.
2. Отложить — пакет останется утверждённым, старт можно дать позже любой фразой "запускай реализацию".
```

Implementation engine selection:

- Use the configured `Implementation workflow` when present and not `None`.
- If the field is missing or `None`, stay backward-compatible and default to this selection table:
  - Compound `ce-work` for general implementation from an approved Issue or plan.
  - Superpowers `executing-plans` when a concrete written plan should be executed without rediscovery.
  - Superpowers `test-driven-development` when acceptance can be encoded as tests or a bug reproduction first.
  - Superpowers `systematic-debugging` when the Issue is a bug or performance symptom with a repro loop.
  - Superpowers `subagent-driven-development` only when slices are independent and file/surface boundaries are explicit.
  - gstack `qa` after implementation when browser, product, or manual-surface verification is the main risk.
- When the configured or selected engine skill is not available in the current runtime (for example a Codex worker where Compound or Superpowers skills are not invocable), implement directly from the approved Issue under this skill and `references/execution-quality.md`, and record the substitution in the exit report (and in the report `notes` field when running under orchestration).

Exit statuses:

- `implemented-needs-preflight`: code changes exist and the next workflow is `mono-preflight`.
- `blocked`: required Linear context, repo state, tooling, permissions, or validation are unavailable.
- `scope-drift-needs-handoff`: implementation discovered material scope drift that must be reflected in Linear before continuing.
- `needs-human`: a product, UX, business, external access, dirty-worktree, or risk decision is required.

For `tiny` work, follow the Tiny Output Profile in references/readiness-gates.md.

Rules:

- Keep Linear as durable truth. Local discovery artifacts are evidence only after `mono-handoff` translated them into Linear.
- Do not re-run product discovery unless Linear artifacts are missing or contradictory.
- Do not start from local discovery artifacts alone.
- Do not treat package approval as implementation-start approval unless that approval is explicit.
- The issue-only owner approval is explicit implementation-start approval only when the resolver returns `package_kind=issue-only` and `approval_status=approved-fresh`; otherwise the normal Project-first approval rule above still applies.
- Do not infer implementation-start approval from ambiguous phrases; the approval must name implementation or the Issue key(s) explicitly. Choosing a handoff package option that explicitly bundles implementation start (e.g. «это одновременно approval на старт кода») counts as explicit; do not re-ask after it.
- Do not move the Project to Delivery before approved Issue(s) exist.
- Do not pass delivery readiness with only PRD and Tech Spec.
- Do not create PRs directly from `mono-implement`.
- Do not run or claim `mono-review pre-ship` or `mono-check pre-ship`; those belong to `mono-ship`.
- If material drift appears, stop as `scope-drift-needs-handoff`.
- The stage exit report enumerates every «Как проверить» item of the Issue, each with a `pass | deferred | not-run` status and one line of evidence. Under orchestration that list is the `verification_items` array of the mailbox report, in the shape `templates/orchestrator-report.md` defines. The stage cannot claim completion while an item is silently missing; `deferred`/`not-run` are valid only with a recorded reason in the evidence.
- Keep Linear-facing comments in the project config language; use Russian when no project config is present.

Implementation-start comment shape:

```text
Начал реализацию по <Issue keys>.

Проверил: <Project, PRD, Tech Spec, Issue, approval/review/check state>.
Делаю строго по утверждённому Issue; ничего сверх scope не добавляю.
Объем: <approved one-PR slice>.
Workflow реализации: <configured workflow or default selection and why>.
План проверки: <targeted tests/checks/manual surfaces expected later>.
Учтённые learnings: <none|ключи|helper unavailable>.
Пока не проверено: <browser/manual/PR review/deploy/etc.>.
```

Final response must include:

- Status: one of `implemented-needs-preflight`, `blocked`, `scope-drift-needs-handoff`, or `needs-human`.
- Issue IDs implemented.
- Sources read.
- Branch and dirty/committed state.
- Changed files.
- Tests/checks run and not run.
- Drift summary against Project, PRD, Tech Spec, and Issue.
- Linear comment outcome.
- Next workflow recommendation, usually `mono-preflight` when implementation completed.
