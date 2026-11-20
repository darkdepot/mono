# Linear Lifecycle

## Order And Statuses

Stages run Idea → Research → Discovery → Design when required → Tech Evaluation
when named → Handoff → Delivery (Implement, then Preflight with its code review
round) → Ship → independent QA before merge → Deploy. Each stage owns its rules,
records and recovery in its own skill; this reference keeps only what they share.

Project statuses: `Idea` until Research starts; Research moves it to `Discovery`;
Handoff sets `Ready` after the package record, execution Issues and
`mono:check handoff` pass (a workspace without `Ready` keeps `Discovery`);
`mono:implement` moves it to `Delivery`; `mono:deploy` completes it after the last
shipment. Close sets `Canceled`; defer keeps the status. Ordinary Projects need the
owner's start; delegated Projects (PC-019: latest Idea delegation mark or explicit
owner decision) allow the orchestrator's start `by=orchestrator` with reason and
countercheck. The narrow «веди до Handoff» mode keeps work start with the owner. Stage sessions and the orchestrator follow
`references/owner-dialog.md` and `references/orchestration-stages.md`.

## Initiative

Owner intake has three routes: one projectless PR to `mono:issue`, one Project
idea to `mono:idea`, several Projects to `mono:initiative`. Initiative runs only
in the owner's session; the orchestrator neither launches nor approves it.
The stage first classifies the idea honestly as task, project or initiative and
routes the first two. For an initiative it sharpens the idea with the owner,
records the owner's approval of the shown initiative, then proposes a map of
Projects that each deliver complete value, records approval of the map and
creates/links map Projects in Idea. It never starts Projects.

Re-entry resumes from the first missing step and shows Project states from
Linear, status first: Canceled means отменён; Completed — завершён; Discovery,
Ready, Delivery and later work states — в работе. Idea with a valid recorded
Idea approval means разрешён к запуску; Idea without it — заведён; an item
without a Project — предложен. The path does not change Initiative status after
Planned or close it: completed Projects do not prove the result. Project
body/Brief exception is in PC-005/PC-013; stage writing and recovery live in
`skills/initiative/`.

## Idea

`mono:idea` (`skills/idea/SKILL.md`): turns a raw idea into an Idea Project with an
owner-approved, read-back `mono-idea` record and Brief, or routes one-PR
projectless work to `mono:issue`. Next: Research. Gate: `mono:check idea`.

## Research

`mono:research` (`skills/research/SKILL.md`): after an authorized start, moves the
Project to Discovery and writes one «Исследование» document. Next:
`mono:discovery`, or `mono:handoff` for a Project on the old path
(`skills/check/SKILL.md`, mode `discovery`).

## Discovery

`mono:discovery` (`skills/discovery/SKILL.md`): finds the solution with the owner
and writes the PRD with one `mono-prd: approved` record that decides `design=`
and the route, or closes/defers the Project. The old path is decided by records, never
dates; product `discoveryGate.since` no longer changes routing. Its home is
`skills/check/SKILL.md`, mode `discovery`, which is also the gate.

## Design

`mono:design` (`skills/design/SKILL.md`): mockups for a PRD with
`design=needed next=design`, then one `mono-design: approved` record routing
ordinary/large work to Tech Evaluation and tiny work to Handoff. Gate:
`mono:check design`.

### Record chain

Handoff entry, work-start recording and Project-first `mono:check` modes
`discovery`, `tech`, `handoff` and `delivery` always first save raw Project and
complete comment responses with actual request cursors and run:
`node <pack-root>/scripts/idea-gate.mjs route --mode fresh --dump <dir> --config <path>`.
Require exit 0, «Готово», JSON `pass` before deciding which stage checks to skip.
This also applies without a PRD approval: old-path exemptions apply only after
`pass`. `requiredRecords` names the records to verify; route validates fields and
closed dictionaries, not freshness or stage completion. `bad-record` stops at its
named writer stage; it is never absence. The most recent approval by `createdAt`
wins; no fallback from a damaged newer one. A PRD without `design=` is the Design
old path, with or without `next=`. Records, never dates.

The chain follows the last approval: PRD → Design when required → Tech Evaluation
when named → Handoff. Handoff and work start require a valid record at every named
stage; missing or stale returns to that stage, never skips. Record formats and
writing order live with their writers: `mono-prd: approved` in
`skills/discovery/references/prd.md`, `mono-design: approved` in
`skills/design/references/approval.md`, `mono-tech: approved` with its
`mono-tech-page` fence in `skills/tech-evaluation/references/spec.md`.

### Project Brief at stage entry

Research, Discovery, Design, Tech Evaluation and Handoff (including repair) read
the project Brief first, through the `Бриф:` URL in the Idea approval record.
No such line means the preserved old path. A URL requires its actual document with
the terminal `mono-brief` block bound to this project; missing/unreadable/wrong
binding is FAIL → Idea, never a substitute Brief or silent fallback. Format and
consent rules live in `references/brief.md`.

## Tech Evaluation

`mono:tech-evaluation` (`skills/tech-evaluation/SKILL.md`): when the preceding PRD
or valid Design record names `next=tech-evaluation` (or on the owner-requested
Tech Evaluation old path, PRD without `next=`), chooses one technical solution, gets the page approved and
writes the Tech Spec and its `mono-tech: approved` record. Next: Handoff. Gate:
`mono:check tech`.

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
решений закрытой задачи без открытия (`skills/discovery/references/prd.md`).
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

`mono:handoff` (`skills/handoff/SKILL.md`): reconciles the approved inputs, slices
execution Issues, writes one package record, sets Ready and brings the owner one
summary for the start. It writes no PRD or Tech Spec, changes no code and never moves
the Project to Delivery. A legacy package (approved by the earlier Handoff, no
package record) keeps its Tech Spec, approval and repair rules.

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
- Project, PRD and Tech Spec references per [references/linear-links.md](linear-links.md).

Forbidden:

- Attached PRD or Tech Spec documents on the Issue.
- Bare document URLs without their exact titles (`references/linear-links.md`).
- Code changes before the Issue is sufficient for another agent.

Gate: `mono:check issue`.

## Delivery

`mono:implement` (`skills/implement/SKILL.md`) starts Delivery from approved
execution Issue(s) after the authorized start per PC-016/019 (legacy: package
approval) covers the current Issue set. Start from Ready; Discovery is accepted for a
legacy Project or a workspace without Ready, with package checks passed. It moves the
Project to Delivery and never creates PRs, runs pre-ship review/check, deploys or
closes out. The code review round (`mono:code-review` roles) runs inside Preflight;
independent QA (`mono:qa`) runs after the ship green certificate, before merge.

Gate: `mono:check delivery`.

## Preflight

Prepare the local implementation branch for ship without taking over PR lifecycle.

Required:

- Approved Linear Issue(s) and implementation output.
- Branch/worktree state inspected.
- Local diff compared against Project, PRD, Tech Spec, and Issue.
- Targeted tests/checks run or explicitly reported as not run.
- The collection's read-only review round by [role:code-review](model-policy.md#roles) and [role:code-review-checker](model-policy.md#roles) ends `clean` or `clean-with-successors` within three rounds and verification passes, or preflight parks.
- Commit state reported, with commits created only when safe and configured.
- Preflight certificate emitted with status `ready`, `blocked`, `drift-candidate`, or `needs-human`.

Forbidden:

- Running or claiming `mono:review pre-ship`.
- Running or claiming `mono:check pre-ship`.
- Creating the final PR.
- Merging, deploying, or closing Linear Issues.
- Replacing the review round with Compound `ce-code-review`, built-in `/review`, ad hoc review, or a hand-written self-review.

Gate: `mono:preflight` certificate, then `mono:ship`.

## Ship

`mono:ship` (`skills/ship/SKILL.md`) takes the draft PR opened by `mono:preflight` out
of draft against its certificate, documents and stabilizes it, runs `mono:check pre-ship`, moves the Issue to
`In Review` and records `mono-ship green certificate`. It never merges, deploys,
closes Issues or records deploy evidence.

Gate: `mono-ship green certificate`, then `mono:deploy`.

## Deploy

After `mono-ship green certificate`, `mono:deploy` runs in the product session.
The configured `deploy.targets` block authorizes merge; absent block refuses.
Check tester results before merge when qa.beforeMerge requires them. Script
rereads head/checks/remarks and landing tip, saves rollback target, then squash
merges that head. Night web requires a fresh signed-in browser readiness mark;
destructive migrations wait until morning. No messages or live sends.

Close the Issue on confirmed merge with a truthful check comment. Prove production
version before checking the Issue scenario and product quick check. New repeated
browser failure versus green saved old build permits one platform rollback and
one recorded repair. Stop without outcome when browser/action is unavailable;
keep run open. Pack PR awaits release, installed pack proves every named place.

Only proven delivery earns an update; verified or explicitly unverified with
reason/checker/date. A missing/failed update never changes delivery verdict.
One Issue/result in product language: title at most 10 words, body at most 35,
Issue chip last. Issue-only uses its named theme and never changes Project status.
Only shipment of the last open Project Issue may complete the Project: every
attached task has status TYPE completed, canceled or duplicate; other/unknown
types block. Write/read back Completed before final prefix; already Completed or
unconfirmed writes use ordinary form. No completion sweep after a hand-closed tail.

Five outcomes, worst first: rolled back; deployment failed/production old;
deployed unverified; merged awaiting release; deployed verified. No targets:
Issue note only. Main design-file synchronization belongs to Design. Retire the
worker after closeout; keep pending checks visible with label Не проверено.

## Orchestration

Optional mode: `mono:orchestrate` runs one control-plane session per
product and sequences the stages above through delegated workers.

Required:

- Lifecycle gate ownership and order unchanged.
- Pre-delivery stages run in Claude Code stage agents with exact allowlists and
  helper hook, built/verified by orchestrator; a new session after definition edits.
  Delegated stages never run in Codex. See `references/orchestration-stages.md`.
- Launch task identifies the owner. Stage records/read-backs itself and returns
  its selected transition; orchestrator starts the next session, not the stage.
- Single Linear writer only for implement/preflight/ship workers: orchestrator
  applies their queued mutations. Pre-delivery stage agents write their own records.
- Idea always waits for owner agreement in words. Delegated Projects per PC-019 allow autonomous
  Research/work start and approvals with reason/countercheck; ordinary Projects do not.
  «Веди до Handoff» allows the same up to Handoff; work start stays `by=owner`.
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
