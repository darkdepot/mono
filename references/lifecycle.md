# Linear Lifecycle

## Idea

`mono:idea` handles a raw idea or an existing Idea Project. Two read-only scouts,
`linear-scout` and `code-scout`, gather linked facts in parallel before the recap.
Unmistakable one-PR projectless work routes to `mono:issue` only when the configured
lane is enabled and has `ownerPrincipal`; otherwise it goes through a Project.
Questions concern meaning, at most three, each built on the last answer (independent ones
may go together); a route question is separate and may come early from the Linear facts.
The orchestrator runs Idea itself and answers these questions with reasons, showing
«Ответил сам:» to the owner rather than forwarding the questions.

Exit requires the owner's explicit yes to What / Why / Target outcome / prioritized
Unknowns and successful `verify` for that exact Project record. The writing and recovery
steps live only in `skills/idea/references/record.md`. Status Discovery follows «Готово»
and is confirmed by read-back, then `mono:check idea` must pass. A Project returned
with the three idea sections unchanged keeps its body, package and status;
Unknowns may be new. Without those sections, write the approved body and preserve
old text in notes; status changes only from Idea. Owner corrections to What / Why /
Target outcome follow that body-write path without an approved package. With an
approved package, stop before recording and route the correction through
`mono:handoff` artifact repair, then return to Idea recording and verification.
Unknowns stay in the record. No Research document, PRD, Tech Spec, Issue, implementation
plan, ExecPlan or code is created here. A refusal returns to Idea.

The next stage is Research (`mono:research`), starting with the first Unknown.
Idea stops after its final message; the owner's yes also covers starting Research, so the
agent then invokes `mono:research` unless the owner asked to hold it (the orchestrator runs
it itself). Idea approval is separate from package approval.

## Research

`mono:research` gathers facts before choosing a solution, without owner questions or
a separate yes. The approved Idea record supplies the questions; a legacy Project
uses its description. It writes one Research («Исследование») document and one
comment in its stage task with the stage log, then stops with an answer, advice and next step.
`mono:discovery` follows.
A Project without Research routes here, except a package approved before
`researchGate.since` in config, otherwise `RESEARCH_GATE_DEFAULT_SINCE` from `scripts/idea-gate.mjs`.

## Discovery

`mono:discovery` takes the approved Idea record and Research («Исследование»),
finds up to three real solutions, obtains an explicit choice and writes the chosen
solution's PRD in Linear with yes bound to the shown document version. It runs in
the owner session or the orchestrator session itself; workers/background launches
do not start it. Details and the selected Research link stay in the Discovery task.

Close/defer is decided by the lead: owner, or orchestrator with a reason. Close
sets Canceled; defer keeps status, records the return condition in the closed task.
Both exit without PRD or Handoff. Do not resume deferred work before the condition
or an owner return. Otherwise gate: `mono:check discovery`, then `mono:handoff`.
Until Design and Tech Evaluation exist, Handoff receives their open questions and
«нужны макеты» (Research `interface: true` or a new screen/window in the solution).
A raw implementation plan never authorizes code or Delivery.

Discovery cutoff: `2099-12-31` until release; product `discoveryGate.since` overrides
it. The old-path eligibility and package-aware checks have one home:
`skills/check/SKILL.md`, mode `discovery`. On that path Handoff may write PRD-lite;
tiny new Discovery work gets a short PRD. On the new path Handoff reads approved
PRD only; before package approval a PRD finding returns to Discovery, with renewed
yes in the same owner touch as package approval. After package approval normal
repair/Ship drift applies, without rechecking PRD yes.

The entry `fresh` check admits `pass`, `stale`, `legacy-migrate`; stale/legacy ideas
are shown in the package touch and recorded with package approval. Migration alone
never permits implementation. `no-record` on a new project returns to `mono:idea`.
Implement checks `approved` before start.

## Задачи этапов

Задачи реализации (execution Issues) не включают задачи с меткой `Этап`.
Это определение действует для набора задач пакета, одобрения, ревью, проверок,
Issue set во всех классах правки и запуска работы. Создание задачи этапа само по
себе не меняет набор задач реализации и класс правки пакета.

Своя задача есть у Research, Discovery, Design и Tech Evaluation. У Idea и
Handoff задачи этапа нет. Роли: Idea — проджект-менеджер; Research и Discovery —
продакт; Design — дизайнер; Tech Evaluation — техлид; Handoff — тимлид;
Implementation — инженер.

Каждый этап первым шагом ищет свою задачу по проекту, метке `Этап` и началу
названия: `Research:`, `Discovery:`, `Design:` или `Tech Evaluation:`. Название
целиком: `Research: <проект>`, `Discovery: <проект>` и так же для остальных.
Открытую берёт, закрытую при повторном входе открывает. Исключение: отложенная,
у которой условие возврата не наступило и владелец её не вернул; этап говорит,
до чего отложено, и останавливается, задачу не открывает. Нет задачи: заводит по
[шаблону задачи этапа](../templates/stage-task.md), исполнитель — владелец.
Предыдущий этап задач не заводит; каждый отвечает только за свою.

Метку `Этап` ищет в команде первый этап, которому она нужна; если её нет,
создаёт. Задача этапа без ветки и PR: поручение роли, журнал в комментариях,
результат в документе проекта. В конце этапа задача закрывается в Done.
Если вход отказан (проверка идеи или Research), в задаче записываются причина
и куда дальше, затем она закрывается. Каждая запись читается обратно.

## Handoff

Turn discovery into a Linear-backed execution package.

Required:

- Project stays in Discovery while assembling the package. After package approval and PASS `mono:check handoff`, set and read back Ready, the configured pre-delivery status before Delivery. If Ready is absent from the workspace, keep Discovery; the check reports that fallback.
- Artifact intake summary following `references/artifact-intake.md`.
- Current PRD.
- Current Tech Spec.
- Package approval recorded as a Linear comment.
- Risk classification and review-gate policy.
- `mono:review handoff` when required by `references/readiness-gates.md`.
- User approval recorded as a Linear comment.
- Proposed Issue slicing.

Forbidden:

- Code changes during handoff.
- PR creation during handoff.
- Implementation before approved Issue(s) exist.
- Moving the Project to Delivery before approved execution Issue(s) exist.
- Moving the Project to Delivery from `mono:handoff`; Delivery Start belongs to `mono:implement`.

Gate: `mono:review handoff` when required or advisory, then `mono:check handoff`.

## Artifact Repair

Repair an existing Project-first package through `mono:handoff` and
`references/repair-machine.md` without reopening ordinary package creation.

Required:

- Exact before/after preview grouped by stable ID and a proposed class with
  evidence.
- `mono:review artifact` report-only classification review.
- Class 1 preserves approval and Issues.
- Class 2 stops or quiesces every affected active worker before any repair
  mutation, then synchronizes affected implementation-critical Issue snapshots,
  re-derives fingerprints, and stales preflight certificates issued before the
  repair.
- Class 3 stops workers, supersedes approvals, invalidates dependent artifacts,
  moves a Delivery or Ready Project back to Discovery, and requires owner re-approval.
- `mono:check repair` reports readiness after all class effects are recorded.

Forbidden:

- Downgrading ambiguity or risk growth below class 3.
- Using handoff repair for issue-only body renewal; that belongs to
  `mono:issue` and its create-then-approve transaction.
- Using handoff repair for accepted pre-ship drift; that remains owned by
  `mono:ship`.
- Letting a stale-contract worker continue or shipping on a pre-repair
  preflight certificate.

Gate: `mono:review artifact`, repair transaction, then `mono:check repair`.

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

Gate: `mono:check issue`.

## Delivery

Prepare and run implementation from approved Linear Issue(s). Delivery starts through `mono:implement` only after execution Issue(s) exist and implementation is ready to begin. Start from Ready; Discovery is accepted for a legacy Project or any Project whose workspace has no Ready status, with package checks passed.

Required:

- Project in Delivery.
- Current PRD.
- Current Tech Spec or explicit no-spec exception.
- Approved execution Issue(s).
- Approval covers the current Issue set and explicitly allows implementation start.
- Required review findings resolved, accepted, or explicitly deferred.
- Implementation starts from the approved Issue(s), not from raw discovery output.
- `mono:implement` verifies or obtains implementation-start approval, moves the Project to Delivery, runs or reports `mono:check delivery`, records the start comment, and selects the implementation engine.
- `mono:implement` exits as `implemented-needs-preflight`, `blocked`, `scope-drift-needs-handoff`, or `needs-human`.
- Prior operational learnings consulted through `gstack-learnings-search` when the helper is available, advisory only.

Forbidden:

- Passing delivery readiness with only PRD and Tech Spec.
- Moving to Delivery when package approval did not authorize implementation start.
- Starting implementation from a raw `/office-hours`, `/brainstorming`, or review plan.
- Creating PRs, running pre-ship review/check, deploy, or closeout from `mono:implement`.

Gate: `mono:check delivery`.

## Preflight

Prepare the local implementation branch for ship without taking over PR lifecycle.

Required:

- Approved Linear Issue(s) and implementation output.
- Branch/worktree state inspected.
- Local diff compared against Project, PRD, Tech Spec, and Issue.
- Targeted tests/checks run or explicitly reported as not run.
- Installed `autoreview` helper run until it reports clean with the model resolved from [role:autoreview](model-policy.md#roles) and risk-matched effort from `references/autoreview-routing.md`, or preflight exits `blocked`/`needs-human`.
- Commit state reported, with commits created only when safe and configured.
- Preflight certificate emitted with status `ready`, `blocked`, `drift-candidate`, or `needs-human`.

Forbidden:

- Running or claiming `mono:review pre-ship`.
- Running or claiming `mono:check pre-ship`.
- Creating the final PR.
- Merging, deploying, or closing Linear Issues.
- Replacing `autoreview` with Compound `ce-code-review`, built-in `/review`, ad hoc review, or a hand-written self-review.

Gate: `mono:preflight` certificate, then `mono:ship`.

## Ship

Create, document, and stabilize a PR without losing Linear source of truth.

Required:

- Read the `mono:preflight` certificate when present. If no recoverable certificate exists, route to `mono:preflight` before continuing.
- `mono:review pre-ship` when risk is standard, deep, risky, or implementation materially drifted from Linear artifacts.
- `mono:check pre-ship`.
- Delegate PR creation to configured ship workflow.
- Issue moves to `In Review` after PR creation.
- Run the configured Documentation workflow before final green when configured.
- If documentation changes the PR head, rerun review/check stabilization on the new head.
- If configured, delegate review feedback stabilization to the configured resolver.
- Run installed gate.mjs ship on live checks, reviews, threads and Greptile until current-head evidence passes its configured pause or the hard deadline parks the delivery.
- Record `mono-ship green certificate` with PR URL, head SHA, CI, Greptile, unresolved feedback count, merge state, checked/not-checked boundary, and next `mono:deploy`.

Forbidden:

- Merging or deploying.
- Closing Linear Issues as shipped.
- Running post-ship check.
- Recording deploy evidence or operational learnings.

Gate: `mono-ship green certificate`, then `mono:deploy`.

## Deploy

Merge/deploy a green PR and close out Linear only after delivery evidence exists.

Required:

- Read the latest `mono-ship green certificate`.
- Verify current PR head SHA still matches the certificate head SHA.
- Confirm the configured `Deploy workflow` exists and is not `None`.
- Delegate merge/deploy to the configured Deploy workflow.
- Capture merged SHA, deploy target, and deploy verification evidence.
- With `landing.install: "wave-drain"`, follow [Install](landing.md#install): keep the Issue In Review until `close`, with proof the installed version contains its merge commit.
- Before the live sweep, verify the deployed version matches the certified merged SHA; for wave installation, verify T and the task's merge ancestry through its batch proof.
- Run the live QA sweep on the deployed app for user-facing changes: functional smoke over the shipped Issue's PRD acceptance criteria plus design acceptance against the approved UX-checkpoint prototype (functional smoke alone when no prototype was approved).
- Move a user-facing Issue to `Done` only after its own live pass is green.
- On a live defect, file an immediate hotfix Issue out of queue and dispatch it (fix-forward); the defect Issue does not block the original Issue's `Done`.
- Run or report `mono:check post-ship` after deploy evidence is known.
- Move the Linear Issue to `Done` only after verified deploy or an explicit accepted delivery policy says merge is delivery for this repo.
- Publish one project update per deployed Issue, out of that Issue's closeout, in the form and language of `templates/project-update.md`. On the Project-first path the update goes to the Issue's own project; on the issue-only path it goes to the theme project the Issue names in its `Тематический проект:` line, when it names one.
- Complete the project when this delivery was its last, on the Project-first path only: an issue-only shipment publishes on a theme project it does not own and never writes a project status, so it completes no project. A project is complete when every Issue attached to it has a status whose TYPE is `completed`, `canceled`, or `duplicate`; any other type — `backlog`, `unstarted`, `started`, `triage`, and anything Linear adds later — blocks completion. The rule is judged by status type, never by status name, and `mono:deploy` owns the transition.
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

Optional mode: `mono:orchestrate` runs one control-plane session per
product and sequences the stages above through delegated workers.

Required:

- Gate ordering of this lifecycle preserved verbatim.
- `mono:idea`, `mono:research`, `mono:discovery`, `mono:handoff`, and `mono:deploy` run in the
  orchestrator session; `mono:implement`, `mono:preflight`, and
  `mono:ship` run in one worker session per Issue.
- `mono:research` runs in the orchestrator session itself. No owner questions or
  yes; the result goes to the owner. Discovery answers with sources, chooses and
  gives its own PRD yes; its result goes to the owner without waiting. Idea still
  waits for the owner’s yes.
- All Linear mutations during orchestration flow through the orchestrator
  (single writer); workers never write to Linear and queue stage-required
  mutations in mailbox reports.
- Always-ask decisions (scope, design, product risk, deploy per policy) reach
  the user as decision briefs — immediately when they block progress;
  design/UX items arising during discovery batch into the UX checkpoint per
  Director Discovery.
- Discovery under orchestration follows its stage reference: one second-model
  pass without interview or continued dialogue. Owner contacts: Idea description
  approval, Research/Discovery results without waiting, UX checkpoint with a reviewed
  prototype, package approval, deploy approval per policy, ad-hoc risk/scope drift.


Forbidden:

- Skipping or weakening any gate above because an orchestrator is present.
- The orchestrator performing implement/preflight/ship work itself.
- Workers orchestrating: spawning sub-workers or managing other sessions.
- Moving stage ownership: Delivery Start stays with `mono:implement`, PR
  lifecycle with `mono:ship`, merge/deploy and closeout with
  `mono:deploy`.
- Relaying discovery-skill question streams to the user one by one, or
  presenting an unreviewed first-draft prototype at the UX checkpoint.

## One Delivery Context

For orchestrated work dispatch mono:deliver once. Its code, preflight and ship phases retain the owners and order above. Each phase publishes its full write queue and capsule; only confirmation after durable per-write read-back permits progression. In-phase barriers preserve drift-before-PR, certificate-before-formal-review and In-Review-after-PR ordering. Recover the same phase after interruption; final status is green or parked with a dictionary reason, reflected in Linear in the same orchestrator turn.
