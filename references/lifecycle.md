# Linear Lifecycle

## Idea

Capture a strengthened idea without premature delivery artifacts. `mono-idea` is an intake gate, not a planning skill.

Required:

- Project in Idea.
- Strengthened brief from raw idea plus AskQuestion answers.
- Recommendation for `/office-hours` or `/brainstorming`.

Forbidden:

- PRD.
- Tech Spec.
- Issue.
- ExecPlan.
- Implementation plan.
- Code changes.

Gate: `mono-check idea`.

## Discovery

Use Plan Mode discovery and review skills to shape the idea.

Required:

- Project from `mono-idea`.
- `/office-hours` or `/brainstorming` output when product shape is unclear.
- `/plan-design-review` when UI or product surface needs design review.
- `/plan-eng-review` when architecture is ready to review.
- Handoff to `mono-handoff` instead of direct implementation approval.
- PRD and Tech Spec may exist while the Project remains in Discovery.

Forbidden:

- Treating discovery artifacts as durable Linear truth.
- Approving a discovery implementation plan directly.
- Starting implementation from a raw discovery or review plan.
- Moving the Project to Delivery merely because PRD or Tech Spec exists.

Gate: `mono-check discovery`, then `mono-handoff`.

## Handoff

Turn discovery into a Linear-backed execution package.

Required:

- Project remains in Discovery or an equivalent configured pre-delivery state. If no separate pre-delivery status exists, keep Discovery and record handoff readiness in comments or check output.
- Artifact intake summary following `references/artifact-intake.md`.
- Current PRD.
- Current Tech Spec.
- Package approval recorded as a Linear comment.
- Risk classification and review-gate policy.
- `mono-review handoff` when required by `references/readiness-gates.md`.
- User approval recorded as a Linear comment.
- Proposed Issue slicing.

Forbidden:

- Code changes during handoff.
- PR creation during handoff.
- Implementation before approved Issue(s) exist.
- Moving the Project to Delivery before approved execution Issue(s) exist.
- Moving the Project to Delivery from `mono-handoff`; Delivery Start belongs to `mono-implement`.

Gate: `mono-review handoff` when required or advisory, then `mono-check handoff`.

## Artifact Repair

Repair an existing Project-first package through `mono-handoff` and
`references/repair-machine.md` without reopening ordinary package creation.

Required:

- Exact before/after preview grouped by stable ID and a proposed class with
  evidence.
- `mono-review artifact` report-only classification review.
- Class 1 preserves approval and Issues.
- Class 2 stops or quiesces every affected active worker before any repair
  mutation, then synchronizes affected implementation-critical Issue snapshots,
  re-derives fingerprints, and stales preflight certificates issued before the
  repair.
- Class 3 stops workers, supersedes approvals, invalidates dependent artifacts,
  moves a Delivery Project back to Discovery, and requires owner re-approval.
- `mono-check repair` reports readiness after all class effects are recorded.

Forbidden:

- Downgrading ambiguity or risk growth below class 3.
- Using handoff repair for issue-only body renewal; that belongs to
  `mono-issue` and its create-then-approve transaction.
- Using handoff repair for accepted pre-ship drift; that remains owned by
  `mono-ship`.
- Letting a stale-contract worker continue or shipping on a pre-repair
  preflight certificate.

Gate: `mono-review artifact`, repair transaction, then `mono-check repair`.

## Issue

Create the one-PR execution contract.

Required:

- Issue attached to the Project.
- `Прочитать сначала` / Read first context.
- `AFK` or `HITL` readiness with the exact human dependency when present.
- Dependencies and blockers.
- Review-gate record.
- Context snapshot from Project, PRD, and Tech Spec or exception.
- Current vs desired behavior plus reproduction or baseline for bug/perf work.
- Key contracts when they matter for implementation.
- Concrete validation.
- User approval of the handoff package.
- Linear chips for Project, PRD, and Tech Spec where available.

Forbidden:

- Attached PRD or Tech Spec documents on the Issue.
- Raw document URLs when Linear chips can represent the entities.
- Code changes before the Issue is sufficient for another agent.

Gate: `mono-check issue`.

## Delivery

Prepare and run implementation from approved Linear Issue(s). Delivery starts through `mono-implement` only after execution Issue(s) exist and implementation is ready to begin.

Required:

- Project in Delivery.
- Current PRD.
- Current Tech Spec or explicit no-spec exception.
- Approved execution Issue(s).
- Approval covers the current Issue set and explicitly allows implementation start.
- Required review findings resolved, accepted, or explicitly deferred.
- Implementation starts from the approved Issue(s), not from raw discovery output.
- `mono-implement` verifies or obtains implementation-start approval, moves the Project to Delivery, runs or reports `mono-check delivery`, records the start comment, and selects the implementation engine.
- `mono-implement` exits as `implemented-needs-preflight`, `blocked`, `scope-drift-needs-handoff`, or `needs-human`.
- Prior operational learnings consulted through `gstack-learnings-search` when the helper is available, advisory only.

Forbidden:

- Passing delivery readiness with only PRD and Tech Spec.
- Moving to Delivery when package approval did not authorize implementation start.
- Starting implementation from a raw `/office-hours`, `/brainstorming`, or review plan.
- Creating PRs, running pre-ship review/check, deploy, or closeout from `mono-implement`.

Gate: `mono-check delivery`.

## Preflight

Prepare the local implementation branch for ship without taking over PR lifecycle.

Required:

- Approved Linear Issue(s) and implementation output.
- Branch/worktree state inspected.
- Local diff compared against Project, PRD, Tech Spec, and Issue.
- Targeted tests/checks run or explicitly reported as not run.
- Installed `autoreview` helper run until it reports clean with the explicit risk-matched GPT-5.6 model and effort from `references/autoreview-routing.md`, or preflight exits `blocked`/`needs-human`.
- Commit state reported, with commits created only when safe and configured.
- Preflight certificate emitted with status `ready`, `blocked`, `drift-candidate`, or `needs-human`.

Forbidden:

- Running or claiming `mono-review pre-ship`.
- Running or claiming `mono-check pre-ship`.
- Creating the final PR.
- Merging, deploying, or closing Linear Issues.
- Replacing `autoreview` with Compound `ce-code-review`, built-in `/review`, ad hoc review, or a hand-written self-review.

Gate: `mono-preflight` certificate, then `mono-ship`.

## Ship

Create, document, and stabilize a PR without losing Linear source of truth.

Required:

- Read the `mono-preflight` certificate when present. If no recoverable certificate exists, route to `mono-preflight` before continuing.
- `mono-review pre-ship` when risk is standard, deep, risky, or implementation materially drifted from Linear artifacts.
- `mono-check pre-ship`.
- Delegate PR creation to configured ship workflow.
- Issue moves to `In Review` after PR creation.
- Run the configured Documentation workflow before final green when configured.
- If documentation changes the PR head, rerun review/check stabilization on the new head.
- If configured, delegate review feedback stabilization to the configured resolver.
- Poll checks, GitHub review state, unresolved threads, and Greptile every 10 minutes until strict green or terminal stop.
- Record `mono-ship green certificate` with PR URL, head SHA, CI, Greptile, unresolved feedback count, merge state, checked/not-checked boundary, and next `mono-deploy`.

Forbidden:

- Merging or deploying.
- Closing Linear Issues as shipped.
- Running post-ship check.
- Recording deploy evidence or operational learnings.

Gate: `mono-ship green certificate`, then `mono-deploy`.

## Deploy

Merge/deploy a green PR and close out Linear only after delivery evidence exists.

Required:

- Read the latest `mono-ship green certificate`.
- Verify current PR head SHA still matches the certificate head SHA.
- Confirm the configured `Deploy workflow` exists and is not `None`.
- Delegate merge/deploy to the configured Deploy workflow.
- Capture merged SHA, deploy target, and deploy verification evidence.
- Before the live sweep, verify the deployed version matches the certified merged SHA.
- Run the live QA sweep on the deployed app for user-facing changes: functional smoke over the shipped Issue's PRD acceptance criteria plus design acceptance against the approved UX-checkpoint prototype (functional smoke alone when no prototype was approved).
- Move a user-facing Issue to `Done` only after its own live pass is green.
- On a live defect, file an immediate hotfix Issue out of queue and dispatch it (fix-forward); the defect Issue does not block the original Issue's `Done`.
- Run or report `mono-check post-ship` after deploy evidence is known.
- Move the Linear Issue to `Done` only after verified deploy or an explicit accepted delivery policy says merge is delivery for this repo.
- Publish one project update per deployed Issue on the Project-first path, out of that Issue's closeout, in the form and language of `templates/project-update.md`.
- Complete the project when this delivery was its last. A project is complete when every Issue attached to it has a status whose TYPE is `completed`, `canceled`, or `duplicate`; any other type — `backlog`, `unstarted`, `started`, `triage`, and anything Linear adds later — blocks completion. The rule is judged by status type, never by status name, and `mono-deploy` owns the transition.
- Keep the completion order: write the project's `Completed` status and confirm it by read-back FIRST, then publish the final update. The final form of the update is allowed only when this closeout performed and confirmed that transition.
- Consult prior operational learnings through `gstack-learnings-search` before delegating merge/deploy, advisory only.
- Record durable operational learnings through `gstack-learnings-log` when they would save future time.

Forbidden:

- Deploying when the PR head SHA differs from the green certificate.
- Closing an Issue as `Done` with a failed live pass on a user-facing change — a recorded reason may excuse only a sweep that did not run, never a failed one. A skipped sweep without an explicit recorded reason is equally forbidden.
- Running repo documentation workflow; repo docs belong before ship green.
- Running interactive `/learn prune`, `/learn export`, or `/learn stats` automatically.
- Inventing a merge/deploy path when `Deploy workflow` is missing or `None`.
- Blocking closeout, or changing the deploy verdict, because the project update or the project transition failed. Both are informational: the failure is recorded and visible, never a gate.
- Completing a project that no shipment completed. A project left without open Issues by cancellation or by a hand-closed tail is the owner's to complete, and an Issue that was not deployed gets no update.

## Orchestration

Optional mode: `mono-orchestrate` runs one control-plane session per
product and sequences the stages above through delegated workers.

Required:

- Gate ordering of this lifecycle preserved verbatim.
- `mono-idea`, discovery, `mono-handoff`, and `mono-deploy` run in the
  orchestrator session; `mono-implement`, `mono-preflight`, and
  `mono-ship` run in one worker session per Issue.
- All Linear mutations during orchestration flow through the orchestrator
  (single writer); workers never write to Linear and queue stage-required
  mutations in mailbox reports.
- Always-ask decisions (scope, design, product risk, deploy per policy) reach
  the user as decision briefs — immediately when they block progress;
  design/UX items arising during discovery batch into the UX checkpoint per
  Director Discovery.
- Discovery under orchestration follows Director Discovery
  (references/orchestration.md): the orchestrator answers discovery-skill
  questions itself — a Second Voice reviewer generates them when the
  runtime provides one — and touches the user only at checkpoints — intake
  direction questions, the UX checkpoint with a reviewed prototype, package
  approval, deploy approval per policy, and ad-hoc risk or scope-drift
  escalations.

Forbidden:

- Skipping or weakening any gate above because an orchestrator is present.
- The orchestrator performing implement/preflight/ship work itself.
- Workers orchestrating: spawning sub-workers or managing other sessions.
- Moving stage ownership: Delivery Start stays with `mono-implement`, PR
  lifecycle with `mono-ship`, merge/deploy and closeout with
  `mono-deploy`.
- Relaying discovery-skill question streams to the user one by one, or
  presenting an unreviewed first-draft prototype at the UX checkpoint.
