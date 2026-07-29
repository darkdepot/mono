---
name: mono-check
description: Use when checking Linear Project, PRD, Tech Spec, Issue, artifact repair, or ship readiness before moving a workflow to the next stage.
---

# Mono Check

Use this skill as a report-only, best-effort transition gate. It inspects Linear context and reports whether the workflow can move forward. It does not provide deterministic proof and must not rewrite artifacts silently.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `references/readiness-gates.md`
3. `references/lifecycle.md`
4. `templates/check-output.md`

Read when — load the file only when its condition is true for this run:

- `references/execution-quality.md` — when the checked subject includes a diff, implementation, or verification evidence.
- `references/human-friendly-output.md` — when the verdict is rendered for a human or queued as Linear-facing text.
- `references/artifact-rules.md` — when the checked subject includes a Linear artifact body or a Linear-facing comment.
- `references/repair-machine.md` — when the check feeds or gates an artifact repair transaction.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.

Statuses:

- `PASS`: required state was inspected and no blocking drift was found.
- `FAIL`: the workflow violated a hard contract or skipped a required artifact.
- `BLOCKED`: the check cannot complete because required context or permissions are unavailable.

Modes:

- `idea`
- `discovery`
- `delivery`
- `issue`
- `handoff`
- `pre-ship`
- `post-ship`
- `project-config`
- `repair`

Rules:

- Fetch fresh Linear Project, PRD, Tech Spec, and Issue state before judging readiness.
- Treat Linear Project, PRD, Tech Spec, and Issue as durable source of truth.
- Treat GitHub as branch, PR, review, CI, and merge history only.
- Return `PASS` only when required state was inspected and no blocking drift was found.
- Return `FAIL` loudly when a hard workflow contract was violated.
- Return `BLOCKED` when artifacts cannot be inspected because context or permissions are unavailable.
- Keep `PASS`, `FAIL`, and `BLOCKED` in the status line for machine readability, but add a one-line human meaning immediately after it.
- Never edit Project, documents, or Issues from `mono-check`. If the user asks to sync or fix artifacts, report the owner workflow to run.
- Do not use Project Updates as a required gate; use Linear comments for user review acceptance.
- Checks are report-only. They must not silently repair drift.
- Repair checks are readiness-only: inspect the stable-ID preview,
  classification evidence, review disposition, and class-specific effects; do
  not apply or complete a repair from `mono-check`.
- Judge artifact shape by semantics before exact heading spelling. Do not fail merely because a heading label differs when the artifact still has the right product/implementation/execution shape.
- Do fail when a document has the wrong responsibility: PRD invents HOW, Tech Spec invents WHAT, Issue copies whole PRD/Spec bodies, or Project becomes a workflow dashboard.
- Do not emit review findings, proposed fixes, decisions, or FYI sections. Those belong to `mono-review`.
- Treat `mono-review` as a risk-based quality gate and `mono-check` as the readiness status reporter.
- For standard, deep, or risky work, return `FAIL` if the required `mono-review` gate is missing, unresolved, or replaced by an unrecorded exception.
- For tiny advisory work, allow skipped `mono-review` only when the advisory reason is recorded in the relevant Project or Issue review-gate field.
- When checking project config status in an upstream checkout, run or report `node scripts/project-config.mjs --repo <project> --check` output.
- When checking project config status from inside a project repo, inspect `.agents/mono-workflow.config.json` and verify legacy vendored workflow files are absent, or route to the upstream `scripts/project-config.mjs --repo <project> --check`.
- Do not install, update, remove, or rewrite workflow skills from `mono-check`.
- Include a compact "checked / not checked" boundary. `PASS` must not imply uninspected manual QA, browser QA, production smoke, deploy verification, or user acceptance.

Issue-only mode branch:

- Before applying `issue`, `delivery`, `pre-ship`, or `post-ship` mode requirements, resolve the 5-field context seam with the live Issue body, current marker comment, project config, verified `issue-only` label, and authenticated owner-approval fingerprint. Enter the issue-only branch only when the resolver returns `package_kind=issue-only`, `lifecycle_state_entity=issue`, and `approval_status=approved-fresh`, with a non-empty `behavioral_oracle` and `risk_class` in `tiny|standard`.
- In that branch the self-contained Issue, current marker, freshly emitted whole-body fingerprint, authenticated approval, review disposition, and mode-specific delivery evidence replace Project, PRD, and Tech Spec chips. Do not require a parent Project, PRD/Tech Spec documents, chips, or resource links.
- Missing marker or a fail-closed `project-first` result never waives Project-first requirements. A parentless candidate that does not resolve issue-only is not a complete Project-first package; return `FAIL` or `BLOCKED` instead of inventing missing artifacts. A broken or stale marker is a hard `FAIL`; unavailable live context or owner-authentication evidence is `BLOCKED`.
- Project-first mode behavior remains unchanged, including the hard-FAIL rules below.

Mode checks:

- `idea`: PASS only when Project URL/id exists, Project status is `Idea`, strengthened brief exists, no premature PRD/Tech Spec/Issue exists, final output contains no implementation plan, and next step is explicitly `/office-hours` or `/brainstorming`.
- `idea`: FAIL when no Project exists, Project is not `Idea`, the agent wrote a plan instead of creating the Project, implementation started, PRD/Tech Spec/Issue was created without explicit repair context, the session ended without Project link and did not mark `mono-idea` as `BLOCKED / INCOMPLETE`, or no next shaping skill was recommended.
- `idea` (issue-only route): PASS when the request was correctly routed to the `mono-issue` front door as unmistakable one-PR issue-only work and no Project was created by design; the missing Project is expected, not a FAIL. Ambiguous or project-shaped ideas still require a Project by the rules above.
- `discovery`: Project is in Discovery or an equivalent pre-delivery state, discovery outputs are available, no implementation has started from a raw discovery plan, and the next required durable mutation is `mono-handoff`.
- `discovery`: PASS when PRD and Tech Spec exist but Project remains pre-delivery; FAIL when Project moved to Delivery merely because PRD or Tech Spec exists.
- `handoff`: PASS when Project, PRD, Tech Spec, and proposed or created Issue slicing are current; Project body is a concise product brief; package approval is recorded as a Linear comment; required `mono-review handoff` ran or a tiny advisory exception is recorded; and implementation has not started from raw `/office-hours`, `/brainstorming`, or review plan. Return `BLOCKED` when the package is otherwise valid but approval is pending.
- `repair`: PASS only when the exact stable-ID diff and evidence support the
  recorded class, `mono-review artifact` has no blocking finding, and every
  effect required by `references/repair-machine.md` is durably recorded. Class
  1 must preserve approval and Issues; class 2 must prove snapshot-sync with a
  re-derived fingerprint, stale-preflight-cert disposition, and stale worker
  stop; class 3 must prove worker stop, approval supersession, dependent
  invalidation, Delivery-to-Discovery rollback, and pending or completed owner
  re-approval. Ambiguity or risk growth under a recorded lower class is `FAIL`.
- `issue`: Issue belongs to the Project, is a one-PR contract, has required sections, includes `Прочитать сначала` / Read first context, `AFK` or `HITL` readiness, dependencies/blockers, Project/PRD/Tech Spec chips plus context snapshot, adds PRD/Tech Spec as resources/links when available, has coherent review-gate status and disposition, and has no attached PRD/Tech Spec docs.
- `issue`: bug/perf Issues include current behavior, desired behavior, reproduction or baseline, and fix-proof expectation, or explicitly say why the original symptom cannot be reproduced yet.
- `issue` (issue-only lane): after the shared branch above resolves issue-only/approved-fresh, judge it against the issue-only contract: a self-contained one-PR Issue with objective/scope/desired behavior, acceptance criteria with stable IDs, verification, non-goals, the exact five-field marker, coherent review disposition, and the owner-approved whole-body fingerprint. The intake readiness check requires a pre-start state whose type is `triage`, `backlog`, or `unstarted`; reject `started`, `completed`, and `canceled` in this mode because this check certifies the package before Delivery activation.
- `delivery`: Project is in Delivery, PRD is current, Tech Spec or explicit no-spec exception exists, approved execution Issue(s) exist, approval covers the current Issue set and implementation start, required/advisory review-gate record is coherent with the risk classification, and `mono-implement` starts from those Issue(s).
- `delivery` (issue-only lane): use the Issue as the lifecycle carrier. Before the lifecycle move, PASS only when the resolved Issue remains in a pre-start state whose type is `triage`, `backlog`, or `unstarted`, its authenticated owner fingerprint approval is fresh and explicitly records the issue-only implementation-start authorization defined by the marker and `mono-implement` seam, the review disposition is coherent, and the Issue oracle defines the one-PR behavior and verification; reject `started`, `completed`, and `canceled` at this pre-move check. After a requested lifecycle read-back, accept only the configured started/in-progress Issue state. Never require or move a Project in this branch, and reject terminal Issue states.
- `pre-ship`: branch/diff matches Issue, local branch readiness is known through a `mono-preflight` certificate, required `mono-review pre-ship` ran for standard, deep, risky, or materially drifted work, Linear artifacts are not stale, scope drift is reflected or accepted, and no durable body contains obsolete PR chips or raw PR URLs.
- `pre-ship` (issue-only lane): compare the branch/diff and latest `mono-preflight certificate` with the resolved `behavioral_oracle` and fresh approved whole-body fingerprint. Require the same risk-based `mono-review pre-ship` gate as Project-first, reject oracle or fingerprint drift, and do not require nonexistent Project/PRD/Tech Spec artifacts.
- `post-ship`: Issue has PR chip/status, `In Review` after PR creation, `Done` only after verified deploy or explicit accepted delivery policy, deploy evidence is recorded, post-ship drift is synced back to Linear, and learning capture is reported when relevant.
- `post-ship` (issue-only lane): require the same Issue PR/status, deploy evidence, delivery-policy, drift, and learning records as Project-first, but validate delivered behavior against every acceptance ID and verification step in the fresh Issue `behavioral_oracle`. Require the marker and authenticated approval to remain approved-fresh; Project/PRD/Tech Spec artifacts remain intentionally absent.
- `project-config`: the project repo has `.agents/mono-workflow.config.json`, required config fields are present, `prerequisites.autoreviewHelper` is `true`, no unresolved placeholders remain, and no legacy generated Mono files or previous-brand `.agents/linear-workflow*`, `.agents/skills/linear-*`, `.claude/skills/linear-*`, or `.github/workflows/update-linear-*.yml` files remain.

Content-shape checks:

- Project: concise product brief. Relationships, status, review acceptance, and links live in Linear metadata, resources, or comments.
- PRD: WHAT document. It defines operator, problem, target workflow, requirements, non-goals, acceptance, and success criteria. Standard/Deep PRDs should use stable `R` requirement IDs and acceptance examples when behavior is conditional.
- Tech Spec: HOW document. It traces important design decisions back to PRD requirements when IDs exist, captures contracts/boundaries/validation/rollout, and does not redefine product behavior.
- Issue: one-PR execution contract. It contains chips for Project/PRD/Tech Spec, resource links when available, `AFK` or `HITL` readiness, dependencies, key contracts when useful, an implementation-critical context snapshot, and concrete validation/acceptance.

Hard FAIL examples:

- `mono-idea` ended without a Linear Project link, unless it routed unmistakable one-PR issue-only work to `mono-issue` (the issue-only front door creates no Project by design).
- An agent performed deep implementation discovery and wrote an implementation plan during Idea instead of creating the Project.
- A discovery implementation plan was approved directly without passing through `mono-handoff`.
- PRD, Tech Spec, or Issue was created during Idea without explicit repair context.
- Code implementation started before approved Linear Issue(s) existed.
- Project moved to Delivery with PRD and Tech Spec but no approved execution Issue or no implementation-start approval.
- Project moved to Delivery outside `mono-implement` without an explicit implementation-start approval record.
- Durable Project, PRD, Tech Spec, or Issue body contains workflow mechanics such as `mono-check`, `Skill contracts`, lifecycle gates, or agent-only instructions.
- Standard, deep, risky, or materially drifted work moved forward without the required `mono-review` gate.
- A no-spec exception was used for non-tiny work without `mono-review`.
- A project repo still vendors `.agents/skills/mono-*`, `.claude/skills/mono-*`, workflow lockfiles, local workflow checkers, or updater CI for this workflow.

Output:

- Use `templates/check-output.md`.
- Keep output concise.
- Include the exact mode in the status line.
- For FAIL, lead with `FAIL - Linear <mode> not ready`.
- For BLOCKED, name the smallest useful unblock step.
