# Linear Lifecycle

## Idea

`mono:idea` handles a raw idea or an existing Idea Project. Two read-only scouts,
`linear-scout` and `code-scout`, gather linked facts in parallel before the recap.
Unmistakable one-PR projectless work routes to `mono:issue` only when the configured
lane is enabled and has `ownerPrincipal`; otherwise it goes through a Project.
Questions concern meaning, at most three, each built on the last answer (independent ones
may go together); a route question is separate and may come early from the Linear facts.
The stage session runs Idea; its orchestrator answers questions with reasons,
shows the description/window to the owner and relays only their approval press.

Exit requires the owner's approval of What / Why / Target outcome / prioritized
Unknowns, given only by pressing an approval option from `references/owner-dialog.md` (also under the
orchestrator; chat words never approve; without a window there is no approval and
nothing is written), and successful `verify` for that exact Project record. The writing
and recovery steps live only in `skills/idea/references/record.md`. After «Готово» the
status stays Idea, confirmed by read-back, then `mono:check idea` must pass. A Project returned
with the three idea sections unchanged keeps its body, package and status;
Unknowns may be new. Without those sections, write the approved body and preserve
old text in notes; Idea never changes the status. Owner corrections to What / Why /
Target outcome follow that body-write path without an approved package. With an
approved package, stop before recording and route the correction through
`mono:handoff` artifact repair, then return to Idea recording and verification.
Unknowns stay in the record. No Research document, PRD, Tech Spec, Issue, implementation
plan, ExecPlan or code is created here. A refusal returns to Idea.

The next stage is Research (`mono:research`). The description itself is the summary,
with one line on what Research will check, immediately above the combined approval/start
window from `references/owner-dialog.md`. Prepare the Research plan before showing it
(`skills/research/references/plan.md`). After verified recording, give one recording line
and honor the selected start or deferral; no second summary/window. A later explicit start
reuses verified approval of the same version. Ordinary Projects need owner start. Delegated Projects
(PC-019: latest Idea delegation mark or earlier explicit owner decision) allow
orchestrator Research start after confirmed Idea approval. The Project stays in Idea until then.
Idea approval is separate from the Handoff start.

## Research

`mono:research` gathers facts before choosing a solution, without owner questions or
a separate yes. Its plan comes from the approved Idea record and the notes block
«Что всплыло в разговоре»; a legacy Project uses its description. Entered from an Idea
Project, it needs a fresh `pass` and authorized start (owner, or delegated
orchestrator per PC-019), checked read-only before any
Linear write; then it moves the Project to Discovery, reads it back and only then opens
its stage task. It writes one Research («Исследование») document and one
comment in its stage task with the stage log, then stops with an answer, advice and next step.
`mono:discovery` follows. Only a Project on the old path (`skills/check/SKILL.md`, mode
`discovery`, Old path: a legacy approved package) goes to `mono:handoff`, which repairs
that package and never writes a new one.
A Project without Research routes here, except a package approved before
`researchGate.since` in config, otherwise `RESEARCH_GATE_DEFAULT_SINCE` from `scripts/idea-gate.mjs`.

Stage transitions: owner sessions continue in the same session after an authorized
transition, except Design in a separate session whose parent ran Discovery.
Ordinary Projects need owner Research/work start. Delegated Projects use the
latest Idea delegation mark (or earlier explicit owner Project comment); only then
may orchestrator start Research/work itself, `by=orchestrator` with reason and
countercheck. Handoff window: «Начать работу» / «Передать оркестратору» / «Ещё обсудить».
Owner's button or typed «передай оркестратору» records `by=owner` and transfers work.
Stage agents finish with confirmed record and selected transition; orchestrator
launches the next stage. Each session writes and reads back its own Linear records.
Single writer applies only to implement/preflight/ship workers' queued mutations.
Shared `owner-dialog.md` owns the launch-context exception: orchestrator label/reason
is a press on the shown version, never for Idea or in owner sessions. No stage agents
spawn stages. Discovery callbacks from Design/Tech Evaluation stay in that session,
with partial-write recovery unchanged. Every `by=orchestrator` record requires the
orchestrator's independent countercheck, verdict/model/version and reason outside
fences in the same comment. Every stage result goes to owner immediately.

## Discovery

`mono:discovery` takes the approved Idea record and Research («Исследование»),
searches for the solution with the owner in conversation (own view, two or three
solutions that differ by what the owner gets, a live example), obtains an explicit
choice and writes the chosen solution's PRD in Linear with a clicked approval option
bound to the shown document version. It runs in
the owner session or a stage agent launched by the orchestrator; delivery workers
(codex-cli, claude-cli) do not lead stages. Launch task alone identifies the owner. Details and the selected Research link stay in the Discovery task.

Close/defer is decided by the lead: owner, or orchestrator with a reason. Close
sets Canceled; defer keeps status, records the return condition in the closed task.
Both exit without PRD or Handoff. Do not resume deferred work before the condition
or an owner return. Otherwise gate: `mono:check discovery`, then the route in the PRD approval below.
Discovery decides whether the solution changes what the user sees (Research
`interface: true` or an affected screen/window), then PRD size. It writes one
approval with `design=` and `next=`, with the design reason below.
A raw implementation plan never authorizes code or Delivery.

Discovery always follows Research. The old path is decided by records, not dates:
no `mono-prd: approved` record and an approved legacy package (approval comment,
no package record). Product `discoveryGate.since` no longer changes routing; the key
stays valid in config. The old-path eligibility and package-aware checks have one home:
`skills/check/SKILL.md`, mode `discovery`. Tiny Discovery work gets a short PRD.
Handoff reads the approved PRD only: a finding that needs a PRD change gets the
owner's answer in Handoff, then Discovery changes the PRD with a renewed approval in
the same touch and Handoff continues. After authorized start, normal repair/Ship
drift applies, without rechecking PRD yes.

The entry `fresh` check admits `pass`; owner-led stale/legacy Ideas are shown in
Handoff and carried only in owner-approved start (legacy: package approval).
Delegated `stale`/`legacy-migrate` stops autonomous Research/work: carry Idea to
owner, obtain their button approval, confirmed record and fresh check first.
An orchestrator reply/start never approves that Idea snapshot. Migration alone
never permits implementation. `no-record` on a new project returns to `mono:idea`.
Implement checks `approved` before start.

## Design

The Design switch and all new record writers are enabled together, without a
product override or temporary route. Project contract PC-001 is explicitly
updated; the PRD contract and its fingerprint stay unchanged.
Rollback is possible only before the first new-format record (`mono-design`,
PRD `design=` or `next=design`, tech `design=`); after it, fix forward.

### Record chain

Handoff entry, work-start recording and Project-first `mono:check` modes
`discovery`, `tech`, `handoff` and `delivery` always first save raw Project and
complete comment responses with actual request cursors and run:
`node <pack-root>/scripts/idea-gate.mjs route --mode fresh --dump <dir> --config <path>`.
Require exit 0, «Готово», JSON `pass` before deciding which stage checks to skip.
This also applies without a PRD approval: old-path exemptions apply only after
`pass`. Damaged records stop at their writer.
`requiredRecords` names the records to verify; route validates fields and closed
dictionaries, not freshness or stage completion. `bad-record` stops at its named
writer stage; it is never absence. `tech` also performs this validation before
returning `no-record`. The most recent approval by `createdAt` wins; no fallback
from a damaged newer one. A PRD without `design=` is the Design old path, with
or without `next=`; it keeps today's Tech Evaluation route. Records, never dates.

The active record formats are:

```text
mono-prd: approved project=<uuid> document=<uuid PRD> updatedAt=<ISO> design=needed|not-needed next=<stage> by=owner|orchestrator
mono-design: approved project=<uuid> prd=<uuid PRD> prd-updatedAt=<ISO> paper=<URL> images=<sha256> next=tech-evaluation|handoff by=owner|orchestrator
```

Discovery writes the design reason below its record. `design=needed` only pairs
with `next=design`; `design=not-needed` only with `next=tech-evaluation|handoff`,
or no `next` if the former approval lacked it. Unknown fields, values or other
combinations are `bad-record`. No separate “design not required” record.
Next follows the last approval in the chain: PRD → Design when required →
Tech Evaluation when named → Handoff. Tech Evaluation entry requires its
predecessor to name `next=tech-evaluation`. Handoff and work start require a valid
record at every named stage; missing/stale design returns to Design, never skips.
An existing tech record is still consumed on the old path, even without `next`.

### Designer and approval

`skills/design/SKILL.md` owns the designer, two-layer memory, Paper approval and
`Design: <project>` task under the stage-task rules. Product memory is outside
repos under `~/.mono-agent-workflow/design/`; only the designer writes it after
owner consent. First run asks whom to emulate and confirms two rings of strong
exemplars. Every run updates production screens if anything merged since the
last update, reads old Paper threads, design system and taste rules before drawing.
Feature depth: references, 2–3 layout directions, scenarios, states, with owner
contact after each. Otherwise one solution over the production screen and one
showing. The owner can change depth; platforms follow the affected product.
Inspect exported images before every showing. Comments become an owner rule,
product rule or one-off fix, with consent before recording a rule.

Approved artboards are duplicated to Paper «Утверждено <ДД.ММ.ГГГГ>» and exported
as `NN-<name>.png` (ASCII letters, digits, hyphens) into a new immutable version:
`~/.mono-agent-workflow/design/<slug>/approved/<project uuid>/<first 12 of images>/`.
Compute `images` within that folder using
`LC_ALL=C ls *.png | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`.
The Design record binds latest PRD approval id/version, Paper page, image hash
and `next`: ordinary/large PRD to `tech-evaluation`, tiny to `handoff`.
Design task depth does not change that route. Raw dump also includes `prd.json`;
run `idea-gate.mjs design --mode fresh --dump <dir> --config <path>`.
Exit 0, «Готово», JSON `pass` are required; `no-record`, `stale-prd`,
`stale-images`, `bad-record` stop. Reading is not a substitute.

A PRD correction uses one approval of mockups and «Было / Стало». Discovery
writes the PRD and its approval with `design=needed next=design`, then Design
writes its record with the new `prd-updatedAt` in the same touch. Only the first
succeeded: retry the second under the same approval. Designer never edits PRD.
Owner-led Discovery ends with «Начать Design»; Desktop opens a fresh designer
session via `mcp__ccd_session__start_session` using
`$TMPDIR/mono-design/<project>/brief.md`; Codex/terminal use that file and their
host's `mono:design` invocation. Designer ends with the next-stage window from
its own `next`. Under delegation Design runs as an orchestrator stage agent, returning the shown
version for orchestrator approval `by=orchestrator` with reason and countercheck. No product memory: send the owner one question whom to emulate
with proposed exemplars; only that Project waits, others continue. Consent is
still required for taste memory. Owner receives each stage result, with design/tech decisions also in Handoff.

### Reapproval and technical evaluation

At every PRD reapproval,
including the old path, Discovery decides design again, then size and `next`;
not-needed with a previously absent `next` keeps its absence. A changed route
invalidates downstream approvals; rerun with showing under the current mode.
A new-format PRD approval requires lower records created after it even if its
document version is unchanged; historical approvals without `design=` retain
their previous freshness semantics until reapproval. Same route: each stage itself decides whether its approved artifact changes.
Designer sees unchanged screens: new record, same images, new PRD version,
no showing. Tech lead sees unchanged page: renewed record without showing.

With a valid design record, Tech Evaluation reads its PNGs with the product and
checks screen risks. An infeasible mockup returns to Design before page showing.
A PRD item present on approved screens cannot be deferred by the tech lead:
return to Design before showing, with «предлагаю убрать: …, потому что …» in
its stage task; new design round and PRD correction through Discovery.
An item absent from screens may be deferred on the page as today. Its approval
calls Discovery in the same touch; unchanged screens get a new Design record
with the same images without showing, then Tech Spec and tech approval.
`mono-tech` adds optional `design=<latest mono-design comment id>|none`;
omission means `none`. Mismatch with the latest design record yields
`stale-design`, so Tech Evaluation reenters on design changes too.

## Tech Evaluation

The intended order is Discovery → Tech Evaluation → Handoff for ordinary and
large Projects; tiny work goes directly to Handoff. Route by records, not dates:
`next=tech-evaluation|handoff` in `mono-prd: approved`. A PRD approval without
`next=` is the **Tech Evaluation old path**; the router is unchanged. Handoff
verifies any effective `mono-tech` for the current PRD: a valid record is consumed
without another offer. Without one, ordinary/large PRD requires «Начать Tech Evaluation» /
«Ещё обсудить». Owner/delegated consent is the request opening that route; without
it no package or continuation. Tiny work may skip. This differs from Discovery's
no-PRD old path. Existing tech is consumed even on the Design old path.
Discovery first decides design at every approval, then size: needed goes to
Design; its approval routes ordinary/large to Tech Evaluation and tiny to
Handoff. Not-needed goes there directly. Reapproval recomputes the route by
size; only not-needed with a previously absent `next=` preserves absence.
The requested old-path deferred-item callback records `next=tech-evaluation`.
Changed routes invalidate lower approvals; same route allows renewal without
showing only when that stage itself confirms unchanged screens/page.

Tech Evaluation owns the technical decision and new Tech Spec. Owner-led: show
one page immediately above the combined approval/start window from `references/owner-dialog.md`,
on that exact version, `by=owner`. Orchestrator-led:
the stage agent runs the same stage; orchestrator approves `by=orchestrator`
with a reason, including irreversible decisions, a deferred PRD item and a
line against an earlier owner decision. No owner window or escalation inside
that stage; owner receives its result immediately with approval reason.
Ordinary work starts `by=owner`; delegated work allows `by=orchestrator` with reason. This is a stage decision, not permission for
external writes, spending or production actions.

### Tech approval record

One Project comment: first a `text` fence with the exact first line
`mono-tech: approved project=<uuid> prd=<uuid PRD> prd-updatedAt=<ISO> spec=<uuid Tech Spec> spec-sha256=<sha256> page-sha256=<sha256> by=owner|orchestrator design=<latest mono-design id>|none`,
then a `mono-tech-page` fence with the exact approved page, then the approval
provenance/reason outside the fences. Hash the page's lines between fences as
UTF-8 with final LF. Hash the Spec's exact body returned by fresh Linear read-back.

Order: approve the shown page; apply any deferral through Discovery below;
write and read back Tech Spec; write the record; read it back and verify.
Before writing, re-read PRD: a version different from the shown page requires
a new page. Exceptions are precisely the approved deferred item and the Handoff
reentry with an unchanged page described below; the first approval never reuses
a page across PRD versions. The record is effective
while `prd-updatedAt` equals the latest PRD approval (and its fresh document)
and `spec-sha256` equals the fresh Spec body. Spec `updatedAt` is deliberately
ignored because a document comment changes it. Latest means comment `createdAt`,
not edit time. Never fall back from a damaged newer approval to an older one.

Save raw Linear responses unchanged to `project.json`, every `comments-N.json`
and `comments-N.request.json` ({} first, then the actual previous cursor),
`prd.json`, `tech-spec.json`. Document fields: `id`, `content`, `project.id`
(or `projectId`), PRD `updatedAt`. Run
`node <pack-root>/scripts/idea-gate.mjs tech --mode fresh --dump <dir> --config <path>`.
Require exit 0, «Готово» and JSON code `pass`; failure codes are `no-record`,
`stale-prd`, `stale-spec`, `stale-design`, `bad-record`, with «Стоп: <причина>». Reading instead
of running the command cannot authorize the step.

Handoff verifies at entry and before recording the start every stage named by
`route.requiredRecords`, in order: Design then Tech Evaluation when required.
Missing/stale approval returns to its stage. The old path without a required
record keeps its exemptions, only after route validation. Before start,
a PRD edit calls Tech Evaluation in the same touch. Only that stage decides
whether a page line changes: unchanged renews the record with the new PRD
version without showing the page again; changed requires a new page. This
exception is only for Handoff reentry before start, never a PRD version change
during the first approval. After start, repair and accepted
pre-ship drift own Spec changes, not a routine approval-freshness recheck.

### Deferred PRD item

Approval of a page with «предлагаю отложить» is the decision; no second stop.
Tech Evaluation calls Discovery in the same touch. Only Discovery moves that
item into «Что не входит в MVP», records a new `mono-prd: approved`, deciding design then size again
(on the owner-requested old path without mockups, `next=tech-evaluation`), and appends a
line to its closed stage task's decision comment without reopening the task.
Owner-led: `by=owner` and «по нажатию на странице техлида <дата>».
Orchestrator-led: `by=orchestrator` with the reason. Then Tech Evaluation writes
the Spec and `mono-tech` with the new PRD version and latest design id. It never edits PRD itself.

## Задачи этапов

Задачи реализации (execution Issues) не включают задачи с меткой `Этап`.
Это определение действует для набора задач пакета, одобрения, ревью, проверок,
Issue set во всех классах правки и запуска работы. Создание задачи этапа само по
себе не меняет набор задач реализации и класс правки пакета.

Своя задача есть у Research, Discovery, Design и Tech Evaluation. У Idea и
Handoff задачи этапа нет. Роли: Idea — проджект-менеджер; Research и Discovery —
продакт; Design — дизайнер; Tech Evaluation — техлид; Handoff — тимлид;
Implementation — инженер.

Каждый этап первым шагом (Research сразу после проверки входа и перехода из Idea) ищет свою задачу по проекту, метке `Этап` и началу
названия: `Research:`, `Discovery:`, `Design:` или `Tech Evaluation:`. Название
целиком: `Research: <проект>`, `Discovery: <проект>` и так же для остальных.
Открытую берёт, закрытую при повторном входе открывает. Исключение для Discovery:
перенос отложенного пункта по утверждённой странице техлида дописывает комментарий
решений закрытой задачи без открытия (Tech Evaluation, «Deferred PRD item» выше).
Другое исключение: отложенная,
у которой условие возврата не наступило и владелец её не вернул; этап говорит,
до чего отложено, и останавливается, задачу не открывает. Нет задачи: заводит по
[шаблону задачи этапа](../templates/stage-task.md), исполнитель — владелец.
Предыдущий этап задач не заводит; каждый отвечает только за свою.

Метку `Этап` ищет в команде первый этап, которому она нужна; если её нет,
создаёт. Задача этапа без ветки и PR: поручение роли, журнал в комментариях,
результат в документе проекта. В конце этапа задача закрывается в Done.
Research проверяет вход до любых записей и при отказе задачу не заводит: причина
только в сессии. У остальных этапов при отказе входа (проверка идеи или Research)
в задаче записываются причина и куда дальше, затем она закрывается. Каждая запись
читается обратно.

## Handoff

The team lead reconciles the approved inputs and slices the work; it writes no PRD
or Tech Spec.

Required:

- Entry through `mono:check discovery`: approved idea, Research, PRD approved on its
  current version. Otherwise the Project returns to the owner stage of what is missing.
- Reconciliation of Project, Research, PRD and, when they exist, Tech Spec and design.
- Owner questions only for choices that change what the user gets or what is out of
  scope, or that are irreversible, lose data or cost money; a PRD change goes to
  Discovery in the same touch.
- One look at the product code before slicing.
- One execution Issue by default; a second and third by a recorded reason; more only
  with the owner's answer.
- `mono:review handoff` and a second voice on another model, both before the first
  Linear write, each finding fixed or declined with a reason (tiny: advisory).
- One package record as a Project comment, then execution Issues, `mono:check handoff`,
  and Ready set and read back. If Ready is absent from the workspace, keep Discovery;
  the check reports that fallback.
- Final message, then the summary with «Начать работу» / «Передать оркестратору» / «Ещё обсудить».
- Authorized start written/read back: ordinary `by=owner` after button or words;
  delegated `by=orchestrator` with reason/countercheck per PC-019.

Forbidden:

- Writing or changing PRD or Tech Spec.
- Code changes or PR creation during handoff.
- Starting ordinary work without owner start, or orchestrator start without delegation.
- Moving the Project to Delivery from `mono:handoff`; Delivery Start belongs to `mono:implement`.

A legacy package (approved by the earlier Handoff, no package record) keeps its
Tech Spec, approval and repair rules.

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
  and requires a new authorized start on a new summary. A legacy package moves a Delivery
  or Ready Project back to Discovery and needs a new approval in its old format; a
  package record keeps or returns it to Ready. After the start a PRD change waits
  until Handoff has stopped affected work; then Discovery writes it.
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
- Context snapshot from Project, PRD, and the package record (legacy: Tech Spec or exception).
- Current vs desired behavior plus reproduction or baseline for bug/perf work.
- Key contracts when they matter for implementation.
- Concrete validation.
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
- Current package record (legacy: Tech Spec or explicit no-spec exception).
- Execution Issue(s) from that package.
- The authorized start record per PC-016/019 (legacy: package approval) covers the current Issue set and allows implementation start.
- Required review findings resolved, accepted, or explicitly deferred.
- Implementation starts from the approved Issue(s), not from raw discovery output.
- `mono:implement` verifies or obtains implementation-start approval, moves the Project to Delivery, runs or reports `mono:check delivery`, records the start comment, and selects the implementation engine.
- `mono:implement` exits as `implemented-needs-preflight`, `blocked`, `scope-drift-needs-handoff`, or `needs-human`.
- Prior operational learnings consulted through `gstack-learnings-search` when the helper is available, advisory only.

Forbidden:

- Passing delivery readiness with only PRD and Tech Spec.
- Moving to Delivery without authorized start per PC-016/019 (legacy: approval authorizing start).
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
- Run Live QA in the browser session on the deployed app: functional smoke over shipped acceptance criteria plus comparison of changed screens to the exact U2 PNG version and textual taste rules. Without mockups compare taste rules alone; already-started projects with an approved legacy prototype retain it. Differences follow the ordinary deploy-defect/hotfix path before showing work to the owner.
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

- Lifecycle gate ownership and order unchanged.
- Pre-delivery stages run in Claude Code stage agents with exact allowlists and
  helper hook, built/verified by orchestrator; a new session after definition edits.
  Delegated stages never run in Codex. See `references/orchestration.md`.
- Launch task identifies the owner. Stage records/read-backs itself and returns
  its selected transition; orchestrator starts the next session, not the stage.
- Single Linear writer only for implement/preflight/ship workers: orchestrator
  applies their queued mutations. Pre-delivery stage agents write their own records.
- Idea always waits for owner press. Delegated Projects per PC-019 allow autonomous
  Research/work start and approvals with reason/countercheck; ordinary Projects do not.
- Owner retains new taste rules and first exemplars. Each result reaches them with
  «Утвердил сам, потому что…» and leading «Решил за тебя: …, потому что …» where needed.
- Every `by=orchestrator` approval has foreground different-family read-only
  countercheck; verdict/model/version and reason outside fences in the same comment.
- Append messages immediately to product `.claude/session-views/`, locally excluded
  via `.git/info/exclude` if needed; link conversation in owner result.
- Deploy approval follows configured policy.


Forbidden:

- Skipping or weakening any gate above because an orchestrator is present.
- The orchestrator performing implement/preflight/ship work itself.
- Workers orchestrating: spawning sub-workers or managing other sessions.
- Moving stage ownership: Delivery Start stays with `mono:implement`, PR
  lifecycle with `mono:ship`, merge/deploy and closeout with
  `mono:deploy`.
- Relaying stage question streams or orchestrator Design choices to the owner;
  first-product exemplars and consented taste memory keep their explicit rules.

## One Delivery Context

For orchestrated work dispatch mono:deliver once. Its code, preflight and ship phases retain the owners and order above. Each phase publishes its full write queue and capsule; only confirmation after durable per-write read-back permits progression. In-phase barriers preserve drift-before-PR, certificate-before-formal-review and In-Review-after-PR ordering. Recover the same phase after interruption; final status is green or parked with a dictionary reason, reflected in Linear in the same orchestrator turn.
