---
name: check
description: Use when checking Linear Project, PRD, Tech Spec, Issue, artifact repair, or ship readiness before moving a workflow to the next stage.
---

# Mono Check

Find shared files here or at the pack root.

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
- Never edit Project, documents, or Issues from `mono:check`. If the user asks to sync or fix artifacts, report the owner workflow to run.
- Do not use Project Updates as a required gate; use Linear comments for user review acceptance.
- Checks are report-only. They must not silently repair drift.
- Repair checks are readiness-only: inspect the stable-ID preview,
  classification evidence, review disposition, and class-specific effects; do
  not apply or complete a repair from `mono:check`.
- Judge artifact shape by semantics before exact heading spelling. Do not fail merely because a heading label differs when the artifact still has the right product/implementation/execution shape.
- Do fail when a document has the wrong responsibility: PRD invents HOW, Tech Spec invents WHAT, Issue copies whole PRD/Spec bodies, or Project becomes a workflow dashboard.
- Do not emit review findings, proposed fixes, decisions, or FYI sections. Those belong to `mono:review`.
- Treat `mono:review` as a risk-based quality gate and `mono:check` as the readiness status reporter.
- For standard, deep, or risky work, return `FAIL` if the required `mono:review` gate is missing, unresolved, or replaced by an unrecorded exception.
- For tiny advisory work, allow skipped `mono:review` only when the advisory reason is recorded in the relevant Project or Issue review-gate field.
- When checking project config status in an upstream checkout, run or report `node scripts/project-config.mjs --repo <project> --check` output.
- When checking project config status from inside a project repo, inspect `.agents/mono-workflow.config.json` and verify legacy vendored workflow files are absent, or route to the upstream `scripts/project-config.mjs --repo <project> --check`.
- Do not install, update, remove, or rewrite workflow skills from `mono:check`.
- Include a compact "checked / not checked" boundary. `PASS` must not imply uninspected manual QA, browser QA, production smoke, deploy verification, or user acceptance.

Issue-only mode branch:

- Before applying `issue`, `delivery`, `pre-ship`, or `post-ship` mode requirements, resolve the 5-field context seam with the live Issue body, current marker comment, project config, verified `issue-only` label, and authenticated owner-approval fingerprint. Enter the issue-only branch only when the resolver returns `package_kind=issue-only`, `lifecycle_state_entity=issue`, and `approval_status=approved-fresh`, with a non-empty `behavioral_oracle` and `risk_class` in `tiny|standard`.
- In that branch the self-contained Issue, current marker, freshly emitted whole-body fingerprint, authenticated approval, review disposition, and mode-specific delivery evidence replace Project, PRD, and Tech Spec chips. Do not require a parent Project, PRD/Tech Spec documents, chips, or resource links.
- Missing marker or a fail-closed `project-first` result never waives Project-first requirements. A parentless candidate that does not resolve issue-only is not a complete Project-first package; return `FAIL` or `BLOCKED` instead of inventing missing artifacts. A broken or stale marker is a hard `FAIL`; unavailable live context or owner-authentication evidence is `BLOCKED`.
- Project-first mode behavior remains unchanged, including the hard-FAIL rules below.

Mode checks:

Package slicing and membership mean [execution Issues](references/lifecycle.md#задачи-этапов) throughout these checks.

- Idea gate: `idea` consumes the actual `verify` result produced by `mono:idea` through `skills/idea/references/record.md`; do not hand-assemble a normalized snapshot for this mode. Require exit 0, «Готово» and JSON code `pass` bound to the expected Project and exact comment. Missing output or failed reads block progression; report Project and code. For `discovery`, save raw Linear responses unchanged: `project.json`, all `comments-N.json` and `comments-N.request.json` (`{}` first, then `{"cursor":"<previous response cursor>"}`). Run `node <pack-root>/scripts/idea-gate.mjs check --mode fresh --dump <dir> --config <path>`. For `delivery`, keep `--mode approved --snapshot <dir>` with the normalized snapshot. `<pack-root>` is `../..` from this skill folder; resolve it before running from the product repo.
- `idea`: PASS requires the owner's direct agreement on the shown four-section version, successful `verify` for its project-bound record, Project URL/id, confirmed status read-back, no premature Research document/PRD/Tech Spec/Issue/implementation plan, and next step Research (`mono:research`) starting with the first Unknown. A Project leaving Idea must have confirmed `Discovery` status after «Готово». A returned Project with the three idea sections unchanged keeps its body, package and status; new Unknowns are allowed. Without those sections, write the approved body, preserving old text in notes; change status only from Idea. Owner corrections to What/Why/Target outcome without an approved package use the approved-body path; with an approved package, stop before recording and route the body correction through mono:handoff artifact repair, then return to Idea record/verify. Do not require a later-stage Project to return to Discovery. Missing record or skipped approval is `FAIL`; route to `mono:idea`.
- `idea` (issue-only route): PASS for correct routing of unmistakable one-PR projectless work to `mono:issue`; its owner-approved fingerprint replaces the Project record. Do not require a Project on this route.
- `discovery`: apply the following conditions once, with the current package state:
  - Always: the `fresh` check above must return `pass`, `stale` or `legacy-migrate`; the latter two carry the current idea into the package approval touch (on `stale`, preserve the recorded Unknowns Research investigated). Discovery itself must have created no Tech Spec or [execution Issues](references/lifecycle.md#задачи-этапов); existing later-stage artifacts do not fail this provenance check. No code starts from this result. After Research, route to `mono:discovery`.
  - Inspect Research independently of the Discovery old path and existing package approval; only PRD yes is exempt after package approval. Find documents by the Project's `mono-research` block, not title. Several candidates: inspect the one linked by `Исследование: <ссылка>` in the stage decision comment; for close/defer before solution selection use the stage-task log link (no decision comment required). Missing selection link: FAIL, ask to identify the active document; do not require deleting the others. The selected document must have exactly one parseable `mono-research` block with this Project `uuid`, `outcome` in `ready|hold|not-required`, and nonempty `reason` for `hold`/`not-required`; otherwise FAIL → `mono:research`. No document is allowed only when the latest package approval (the one used for dispatch) has `approval.createdAt < researchGate.since`, strictly; config supplies `researchGate.since`, otherwise use `RESEARCH_GATE_DEFAULT_SINCE` in `scripts/idea-gate.mjs`. Otherwise FAIL → `mono:research`.
  - Old path: no `mono-prd: approved` record at all, and package approval or PRD created strictly before `discoveryGate.since` from product config, otherwise the cutoff in `references/lifecycle.md`. It waives only PRD yes, Discovery task and decision comment; Research still applies. Any yes record excludes the old path at every date before package approval.
  - New path before package approval: select PRD by `document` in the latest `mono-prd: approved` record. Its `project` and `document` must match the inspected Project/document, and `updatedAt` must equal a fresh document read. Missing/stale record: FAIL → `mono:discovery`; no record and several PRD candidates: ask to identify the document, without deleting others. Require the decision comment in the Discovery task and that task Done. Alternative close/defer exit: closed task with decision, reason and return condition; no PRD or yes required.
  - After package approval, do not recheck PRD yes. Missing context yields BLOCKED; any failed condition reports unfinished work and its next owner.
- `handoff`: call `mono:check discovery` once on entry (reuse Handoff’s entry result in the same run); do not repeat its conditions. FAIL returns through its named owner (PRD → `mono:discovery`, Research → `mono:research`).
- `handoff` and `delivery`: FAIL unless the `approved` Idea gate passes; an old Discovery project's `legacy-migrate` alone cannot authorize delivery. A missing record on a new project routes to `mono:idea`; never manufacture approval. For handoff this is the post-approval check, not a second entry check.
- `handoff`: PASS when Project, PRD, Tech Spec, and proposed or created [execution Issues](references/lifecycle.md#задачи-этапов) slicing are current; Project body is a concise product brief; package approval is recorded as a Linear comment; required `mono:review handoff` ran or a tiny advisory exception is recorded; and implementation has not started from raw `/office-hours`, `/brainstorming`, or review plan. Return `BLOCKED` when the package is otherwise valid but approval is pending. After approval and PASS, Handoff sets Ready; if the workspace has no Ready, report that the Project stays in Discovery. The pre-transition check does not require Ready already set.
- `repair`: PASS only when the exact stable-ID diff and evidence support the
  recorded class, `mono:review artifact` has no blocking finding, and every
  effect required by `references/repair-machine.md` is durably recorded. Class
  1 must preserve approval and Issues; class 2 must prove snapshot-sync with a
  re-derived fingerprint, stale-preflight-cert disposition, and stale worker
  stop; class 3 must prove worker stop, approval supersession, dependent
  invalidation, Delivery/Ready-to-Discovery rollback, and pending or completed owner
  re-approval. Ambiguity or risk growth under a recorded lower class is `FAIL`.
- `issue`: For [execution Issues](references/lifecycle.md#задачи-этапов), Issue belongs to the Project, is a one-PR contract, has required sections, includes `Прочитать сначала` / Read first context, `AFK` or `HITL` readiness, dependencies/blockers, Project/PRD/Tech Spec chips plus context snapshot, adds PRD/Tech Spec as resources/links when available, has coherent review-gate status and disposition, and has no attached PRD/Tech Spec docs.
- `issue`: bug/perf Issues include current behavior, desired behavior, reproduction or baseline, and fix-proof expectation, or explicitly say why the original symptom cannot be reproduced yet.
- `issue` (issue-only lane): after the shared branch above resolves issue-only/approved-fresh, judge it against the issue-only contract: a self-contained one-PR Issue with objective/scope/desired behavior, acceptance criteria with stable IDs, verification, non-goals, the exact five-field marker, coherent review disposition, and the owner-approved whole-body fingerprint. The intake readiness check requires a pre-start state whose type is `triage`, `backlog`, or `unstarted`; reject `started`, `completed`, and `canceled` in this mode because this check certifies the package before Delivery activation.
- `delivery`: Project is in Delivery, PRD is current, Tech Spec or explicit no-spec exception exists, approved [execution Issues](references/lifecycle.md#задачи-этапов) exist, approval covers the current [execution Issues](references/lifecycle.md#задачи-этапов) set and implementation start, required/advisory review-gate record is coherent with the risk classification, and `mono:implement` starts from those Issue(s).
- `delivery` (issue-only lane): use the Issue as the lifecycle carrier. Before the lifecycle move, PASS only when the resolved Issue remains in a pre-start state whose type is `triage`, `backlog`, or `unstarted`, its authenticated owner fingerprint approval is fresh and explicitly records the issue-only implementation-start authorization defined by the marker and `mono:implement` seam, the review disposition is coherent, and the Issue oracle defines the one-PR behavior and verification; reject `started`, `completed`, and `canceled` at this pre-move check. After a requested lifecycle read-back, accept only the configured started/in-progress Issue state. Never require or move a Project in this branch, and reject terminal Issue states.
- `pre-ship`: branch/diff matches Issue, local branch readiness is known through a `mono:preflight` certificate, required `mono:review pre-ship` ran for standard, deep, risky, or materially drifted work, Linear artifacts are not stale, scope drift is reflected or accepted, and no durable body contains obsolete PR chips or raw PR URLs.
- `pre-ship` (issue-only lane): compare the branch/diff and latest `mono-preflight certificate` with the resolved `behavioral_oracle` and fresh approved whole-body fingerprint. Require the same risk-based `mono:review pre-ship` gate as Project-first, reject oracle or fingerprint drift, and do not require nonexistent Project/PRD/Tech Spec artifacts.
- `post-ship`: Issue has PR chip/status, `In Review` after PR creation, `Done` only after verified deploy or explicit accepted delivery policy, deploy evidence is recorded, post-ship drift is synced back to Linear, and learning capture is reported when relevant.
- `post-ship`: a missing, failed, or skipped project update is never a `FAIL`. Project Updates are informational, `mono:deploy` owns them, and this mode neither requires one nor reads one as evidence.
- `post-ship` (issue-only lane): require the same Issue PR/status, deploy evidence, delivery-policy, drift, and learning records as Project-first, but validate delivered behavior against every acceptance ID and verification step in the fresh Issue `behavioral_oracle`. Require the marker and authenticated approval to remain approved-fresh; Project/PRD/Tech Spec artifacts remain intentionally absent.
- `project-config`: the project repo has `.agents/mono-workflow.config.json`, required config fields are present, `prerequisites.autoreviewHelper` is `true`, no unresolved placeholders remain, and no legacy generated Mono files or previous-brand `.agents/linear-workflow*`, `.agents/skills/linear-*`, `.claude/skills/linear-*`, or `.github/workflows/update-linear-*.yml` files remain.

Content-shape checks:

- Project: concise product brief. Relationships, status, review acceptance, and links live in Linear metadata, resources, or comments.
- PRD: WHAT document. It defines operator, problem, target workflow, requirements, non-goals, acceptance, and success criteria. Standard/Deep PRDs should use stable `R` requirement IDs and acceptance examples when behavior is conditional.
- Tech Spec: HOW document. It traces important design decisions back to PRD requirements when IDs exist, captures contracts/boundaries/validation/rollout, and does not redefine product behavior.
- Issue: one-PR execution contract. It contains chips for Project/PRD/Tech Spec, resource links when available, `AFK` or `HITL` readiness, dependencies, key contracts when useful, an implementation-critical context snapshot, and concrete validation/acceptance.

Hard FAIL examples:

- `mono:idea` ended without a Linear Project link, unless it routed unmistakable one-PR issue-only work to `mono:issue` (the issue-only front door creates no Project by design).
- An agent performed deep implementation discovery and wrote an implementation plan during Idea instead of creating the Project.
- A discovery implementation plan was approved directly without passing through `mono:handoff`.
- PRD, Tech Spec, or Issue was created during Idea without explicit repair context.
- Code implementation started before approved Linear Issue(s) existed.
- Project moved to Delivery with PRD and Tech Spec but no approved execution Issue or no implementation-start approval.
- Project moved to Delivery outside `mono:implement` without an explicit implementation-start approval record.
- Durable Project, PRD, Tech Spec, or Issue body contains workflow mechanics such as `mono:check`, `Skill contracts`, lifecycle gates, or agent-only instructions.
- Standard, deep, risky, or materially drifted work moved forward without the required `mono:review` gate.
- A no-spec exception was used for non-tiny work without `mono:review`.
- A project repo still vendors `.agents/skills/mono-*`, `.claude/skills/mono-*`, workflow lockfiles, local workflow checkers, or updater CI for this workflow.

Output:

- Use `templates/check-output.md`.
- Keep output concise.
- Include the exact mode in the status line.
- For FAIL, lead with `FAIL - Linear <mode> not ready`.
- For BLOCKED, name the smallest useful unblock step.
