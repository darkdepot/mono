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
- `tech`
- `delivery`
- `issue`
- `handoff`
- `design`
- `pre-ship`
- `post-ship`
- `project-config`
- `repair`

Rules:

- Fetch fresh Linear Project, PRD, Tech Spec, package record, and Issue state before judging readiness.
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
- Before mode-specific exemptions, whenever a PRD approval exists, save fresh raw `project.json` and complete `comments-N.json` with `comments-N.request.json` and run `node <pack-root>/scripts/idea-gate.mjs route --mode fresh --dump <dir> --config <path>`. Require exit 0, «Готово», JSON `pass` before deciding which stages may be skipped. `bad-record` is a hard stop at its writer named by `stage`, never `no-record`. Only that writer may enter record repair: Tech Evaluation uses `skills/tech-evaluation/references/spec.md`, «Вход для исправления записи». Inspect its upstream prerequisites separately; a damaged tech record does not invalidate an otherwise current PRD. Keep the full-chain check FAIL, never turn this bounded repair entry into Discovery/tech/Handoff PASS. In MONO-227 Design is dormant: PRD `design=`, `next=design`, any `mono-design` or tech `design=` fails. PRD without `design=` keeps its former route with or without `next`, never a date cutoff. The route command validates fields and dictionaries; it does not prove stage freshness or approval completion.
- `design`: after the route check, raw dump also includes `prd.json`; run `node <pack-root>/scripts/idea-gate.mjs design --mode fresh --dump <dir> --config <path>`. Only exit 0, «Готово», JSON `pass` permit PASS. `no-record`, `stale-prd`, `stale-images` return to Design; `bad-record` to its writer. No reading substitute. While dormant any design approval is FAIL and no stage/task/new record is created. After MONO-228, require exact latest PRD binding and recalculated immutable PNG hash.
- `handoff`: after route, verify every entry in `requiredRecords`, in chain order, using the `design` and `tech` commands above. Missing/stale required Design returns to Design, required Tech Evaluation to that stage; neither can be skipped because the other passed. Empty list is the preserved old path or tiny direct route, never an excuse to bypass the initial route check. Repeat before the first work-start record. After start use repair/accepted drift for freshness, while route field validation still precedes exemptions.
- `idea`: PASS requires the owner's approval of the shown four-section version (only the «Утвердить» button in the question window, in every mode; chat words like «да» are not approval; without a window there is no approval), successful `verify` for its project-bound record, Project URL/id, confirmed status read-back, no premature Research document/PRD/Tech Spec/Issue/implementation plan. The check does not require the start window: after PASS the agent sends the final message and offers «Начать исследование» / «Ещё обсудить» only for a Project in `Idea`. A new Project stays in `Idea` after «Готово»; `mono:research` moves it to Discovery when the owner starts it, never Idea itself. A returned Project with the three idea sections unchanged keeps its body, package and status; new Unknowns are allowed. Without those sections, write the approved body, preserving old text in notes; keep the status. Owner corrections to What/Why/Target outcome without an approved package use the approved-body path; with an approved package, stop before recording and route the body correction through mono:handoff artifact repair, then return to Idea record/verify. Do not require a later-stage Project to return to Discovery. Missing record or skipped approval is `FAIL`; route to `mono:idea`.
- `idea` (issue-only route): PASS for correct routing of unmistakable one-PR projectless work to `mono:issue`; its owner-approved fingerprint replaces the Project record. Do not require a Project on this route.
- `discovery`: apply the following conditions once, with the current package state:
  - Always: the `fresh` check above must return `pass`, `stale` or `legacy-migrate`; the latter two carry the current idea into the Handoff summary and the owner's start record (on `stale`, preserve the recorded Unknowns Research investigated). Discovery itself must have created no Tech Spec or [execution Issues](references/lifecycle.md#задачи-этапов); existing later-stage artifacts do not fail this provenance check. No code starts from this result. After Research, a Project on the old path below routes to `mono:handoff` unless the owner explicitly requests Discovery; any other Project routes to `mono:discovery`.
  - Inspect Research independently of the Discovery old path and an existing start; only PRD yes is exempt after the owner's start (legacy: package approval). Find documents by the Project's `mono-research` block, not title. Several candidates: inspect the one linked by `Исследование: <ссылка>` in the stage decision comment; for close/defer before solution selection use the stage-task log link (no decision comment required). Missing selection link: FAIL, ask to identify the active document; do not require deleting the others. The selected document must have exactly one parseable `mono-research` block with this Project `uuid`, `outcome` in `ready|hold|not-required`, and nonempty `reason` for `hold`/`not-required`; otherwise FAIL → `mono:research`. No document is allowed only when the latest start or package approval (the one used for dispatch) has `approval.createdAt < researchGate.since`, strictly; config supplies `researchGate.since`, otherwise use `RESEARCH_GATE_DEFAULT_SINCE` in `scripts/idea-gate.mjs`. Otherwise FAIL → `mono:research`.
  - Old path: no `mono-prd: approved` record at all, and an approved legacy package: an earlier Handoff's package approval comment that dispatch accepts (exactly one `approval_status=approved`, or unmarked and created strictly before `ideaGate.since`) and no `mono-package: recorded` comment on the Project. Records decide, never dates; `discoveryGate.since` no longer applies. A Project without an approved package is never on the old path. It waives only PRD yes, Discovery task and decision comment; Research still applies. Any yes record excludes the old path.
  - New path before the owner's start: select PRD by `document` in the latest `mono-prd: approved` record. Its `project` and `document` must match the inspected Project/document, and `updatedAt` must equal a fresh document read. Missing/stale record: FAIL → `mono:discovery`; no record and several PRD candidates: ask to identify the document, without deleting others. Require the decision comment in the Discovery task and that task Done. Alternative close/defer exit: closed task with decision, reason and return condition; no PRD or yes required.
  - After the owner's start (legacy: package approval), do not recheck PRD yes. Missing context yields BLOCKED; any failed condition reports unfinished work and its next owner.
- `tech`: ordinary entry requires `mono:check discovery` PASS; repair entry follows the bounded writer rule above. After route, inspect its predecessor: PRD `next=tech-evaluation`, or after MONO-228 valid Design with that `next`; preserve the explicit owner-requested Tech Evaluation old path. Every required `design` record is verified by its command first. Run `node <pack-root>/scripts/idea-gate.mjs tech --mode fresh --dump <dir> --config <path>` on fresh raw PRD/Spec and complete comments; only exit 0, «Готово», JSON `pass` permits PASS. Missing/stale PRD/Spec or `stale-design` blocks at the owner stage; no reading substitute.
- Tech Evaluation old path: latest `mono-prd: approved` exists without `next=`; it skips Tech Evaluation unless explicitly requested by the owner. This is distinct from Discovery's old path above, which has no PRD record. `next=handoff` also skips it. Discovery emits `next=` by size for new approvals; repeated approval preserves the prior record's route or absence.
- `handoff`: call `mono:check discovery` once on entry (reuse Handoff’s entry result in the same run); do not repeat its conditions. FAIL returns through its named owner (PRD → `mono:discovery`, Research → `mono:research`).
- `handoff`: before start, run `tech --mode fresh --dump` on fresh raw inputs when `requiredRecords` includes `tech`; require «Готово»/`pass` and consume the referenced Spec. On the Design old path (PRD without `design=`), this includes `next=tech-evaluation` or any existing `mono-tech`, even without `next=`. Without a required effective record FAIL → `mono:tech-evaluation`; no required tech record means its absence does not block. Repeat at owner-start recording. After start use repair/pre-ship drift, not routine freshness rechecks.
- `delivery`: FAIL unless the `approved` Idea gate passes; an old Discovery project's `legacy-migrate` alone cannot authorize delivery. A missing record on a new project routes to `mono:idea`; never manufacture approval. `handoff` uses its entry `fresh` result; on `stale`/`legacy-migrate` the idea record rides in the owner's start record.
- `handoff`: PASS when the current package record (`mono-package: recorded`, read back byte for byte: its `sha256` matches the fence content) names the current PRD approval and Research; it has no `approval_status`, `mono-idea:` or `mono-idea-snapshot`; deep or risky carries at least one shared `U` decision; [execution Issues](references/lifecycle.md#задачи-этапов) match its task list, at most three unless the owner allowed more, each with PRD requirement IDs and «Готово, когда»; `mono:review handoff` and the second voice ran before the first write with every finding fixed or declined with a reason and no blocking finding left (tiny: advisory reason recorded); and nothing started. Owner start is not required: after PASS Handoff sets Ready before the start; if the workspace has no Ready, report that the Project stays in Discovery. The pre-transition check does not require Ready already set. A legacy package keeps its earlier criteria: Tech Spec or an allowed explicit no-spec exception (PC-016) and its recorded package approval.
- `repair`: PASS only when the exact stable-ID diff and evidence support the
  recorded class, `mono:review artifact` has no blocking finding, and every
  effect required by `references/repair-machine.md` is durably recorded. Class
  1 must preserve approval and Issues; class 2 must prove snapshot-sync with a
  re-derived fingerprint, stale-preflight-cert disposition, and stale worker
  stop; class 3 must prove worker stop, start or approval supersession, dependent
  invalidation, the rollback (legacy: Delivery/Ready to Discovery and a pending or
  completed owner re-approval in the old format; package record: Ready kept or
  restored and a pending or completed new owner start). Ambiguity or risk growth under a recorded lower class is `FAIL`.
- `issue`: For [execution Issues](references/lifecycle.md#задачи-этапов), Issue belongs to the Project, is a one-PR contract, has required sections, includes `Прочитать сначала` / Read first context, `AFK` or `HITL` readiness, dependencies/blockers, Project/PRD chips, the Tech Spec chip when it exists, the package record link for a package-record package (not for a legacy one), a context snapshot, adds PRD/Tech Spec as resources/links when available, has coherent review-gate status and disposition, and has no attached PRD/Tech Spec docs.
- `issue`: bug/perf Issues include current behavior, desired behavior, reproduction or baseline, and fix-proof expectation, or explicitly say why the original symptom cannot be reproduced yet.
- `issue` (issue-only lane): after the shared branch above resolves issue-only/approved-fresh, judge it against the issue-only contract: a self-contained one-PR Issue with objective/scope/desired behavior, acceptance criteria with stable IDs, verification, non-goals, the exact five-field marker, coherent review disposition, and the owner-approved whole-body fingerprint. The intake readiness check requires a pre-start state whose type is `triage`, `backlog`, or `unstarted`; reject `started`, `completed`, and `canceled` in this mode because this check certifies the package before Delivery activation.
- `delivery`: Project is in Delivery, PRD is current, [execution Issues](references/lifecycle.md#задачи-этапов) exist. Package record: the owner's start record (`by=owner`, exactly one `approval_status=approved`) names the record version it started and its `sha256` and lists the current Issue set; the current version is that one or is reached from it by a verified chain of class 1-2 versions with protected surfaces and the Issue set unchanged; any class 3 version after it needs a new owner start; the old start is never rewritten. Legacy package: Tech Spec or an allowed explicit no-spec exception (PC-016) and its package approval covering the current set and implementation start. The required/advisory review-gate record is coherent with the risk classification, and `mono:implement` starts from those Issue(s).
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
- Tech Spec: HOW document. It traces important design decisions back to PRD requirements when IDs exist, captures contracts/boundaries/validation and applicable failures/release/rollback without empty sections, and does not redefine product behavior.
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
- A legacy no-spec exception was used for non-tiny work without `mono:review`.
- Work on a package-record package started without the owner's start record, or from a start not `by=owner`.
- A project repo still vendors `.agents/skills/mono-*`, `.claude/skills/mono-*`, workflow lockfiles, local workflow checkers, or updater CI for this workflow.

Output:

- Use `templates/check-output.md`.
- Keep output concise.
- Include the exact mode in the status line.
- For FAIL, lead with `FAIL - Linear <mode> not ready`.
- For BLOCKED, name the smallest useful unblock step.
