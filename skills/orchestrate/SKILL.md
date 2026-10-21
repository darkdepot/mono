---
name: orchestrate
description: Use when running a long-lived product orchestrator session that drives Linear projects and Issues through the workflow with delegated worker sessions.
---

# Mono Orchestrate

Find shared files here or at the pack root.

Use this skill to run the control plane for one product: drive Linear
projects and Issues through the existing workflow skills with delegated
workers, answer technical questions autonomously, and escalate only product
decisions to the user.

`mono:orchestrate` runs Idea itself as the explicit stage-work exception.
Research too: no owner questions or yes; the result goes to the owner.
Discovery and routed Tech Evaluation also run here. Tech Evaluation approves
as owner (`by=orchestrator` with reason), including irreversible, deferred and
contrary-to-owner decisions; no owner windows, result at Handoff work start.
Discovery emits `next=` for new approvals; repeat approvals keep their route.
It inspects, delegates,
monitors, decides or escalates, records, and reports. Stage ownership is
unchanged: `mono:implement` owns Delivery Start, `mono:preflight` owns
local readiness, `mono:ship` owns the PR lifecycle, `mono:deploy` owns
merge/deploy and closeout.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `references/orchestration.md`
3. `references/human-friendly-output.md`
4. `templates/orchestrator-dispatch.md`
5. `templates/orchestrator-brief.md`
6. `templates/orchestrator-report.md`

Read when — load the file only when its condition is true for this run:

- `references/lifecycle.md` — when a Linear lifecycle move is sequenced or a queued lifecycle mutation is applied.
- `references/readiness-gates.md` — when a risk class or a stage readiness gate has to be decided for a wave.
- `references/questioning.md` — when this run escalates a decision to the owner.
- `templates/project-update.md` — when this run publishes or edits a Linear project update, including the update it writes for a project sweep or for a project completed by hand.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.

When to use:

- The user starts or resumes an orchestrator session for a product («веди
  проекты», "orchestrate", "resume orchestration").
- Several Issues or projects must move in parallel without the user
  dispatching stages by hand.
- A previous orchestrator session ended and durable state must be rebuilt.

Do not use:

- For doing stage work directly; route it through workers or run the
  orchestrator-owned stages per the Stage Ownership table in
  `references/orchestration.md`.
- As a worker or subagent; workers must not orchestrate.
- When the user wants to drive a single Issue interactively; plain stage
  skills serve that better.

Inputs to gather:

- Project config `.agents/mono-workflow.config.json`: product name,
  configured workflows, `deployApproval`, and the optional `orchestration`
  block (`orchestration.transport`, `orchestration.backupTransport`, `orchestration.maxParallelWorkers`).
- Fresh Linear state: projects in flight, Issue statuses, latest comments and
  certificates.
- Orchestrator state on disk under
  `~/.mono-agent-workflow/orchestrator/<product>/`: ledger, mailbox
  reports, the `workers.json` worker registry, and `control.json`.
- Runtime transport binding per `references/orchestration.md` Worker
  Transports (config override first, then runtime detection).
- Live worker sessions via the runtime session list when available.
### Local compaction wiring

For every product orchestrator, copy the installed
`templates/orchestrator-compaction-hook.sh` template to an operational path
under the orchestrator root, keep its root parameter explicit, and use
`templates/compact-instructions.md` as the compaction prompt. The expected
product-local `.claude/settings.json` shape is:

```json
{
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "75"
  },
  "hooks": {
    "PreCompact": [
      {
        "matcher": "auto",
        "hooks": [
          {
            "type": "command",
            "command": "bash <orchestrator-root>/hooks/defer-auto-compaction.sh <orchestrator-root>"
          }
        ]
      }
    ]
  }
}
```

This `.claude/settings.json` is local and uncommitted operational state: add
its exact path to the checkout's `.git/info/exclude`, never to a committed
`.gitignore`, and never commit it. Copy the hook outside the product repo;
do not vendor Mono skills, templates, hooks, or workflow runtime files into
the product. The product repo still keeps only
`.agents/mono-workflow.config.json` for this workflow.

At session start, report the informational self-check from
[role:orchestrator](references/model-policy.md#roles):
«Модель оркестратора: <модель запуска> | не удалось определить».
Use authoritative launch-environment data, with no verdict; prompt
self-identification is not evidence and this status never switches the session.

Workflow states:

1. `resume`
   - Rebuild the full picture from Linear + ledger + mailbox + worker
     registry + live session list before any action (Resume procedure in
     `references/orchestration.md`).
   - Find surviving `codex-cli` and `claude-cli` workers by thread id instead of
     respawning them only when the registry and `surfaceRevision`
     match; never rebind a thread from another surface revision.
   - Apply queued Linear mutations from worker reports that were never
     applied.
   - Output the rebuilt status (the «Статус» shape from
     `templates/orchestrator-brief.md` with its «Техника» table) before
     taking new actions.
2. `intake-and-discovery`
   - Run `mono:idea` per idea in this session: launch both scouts, recap, answer the route and 1–3 meaning questions yourself with reasons; ask the owner only when their meaning is unclear. Show the description and «Ответил сам:» in the approval window; only the owner’s «Утвердить» counts. Never relay the stage questions or approve for the owner; this approval is separate from the work start. With several ideas, queue
     them and run discovery one project at a time (Director Discovery in
     `references/orchestration.md`) while dispatched work continues.
   - After the Idea final message, run `mono:research` yourself only after the
     owner starts it (button or words); the Project stays in Idea until then.
     After Research start the next stage yourself, without waiting: `mono:discovery`
     by its orchestrator-mode reference; only a legacy package on the old path
     (`mono:check discovery`, Old path) goes to `mono:handoff` repair. Research adds no questions
     or yes. Discovery answers with sources, chooses a solution and gives its own
     PRD yes; its one second-model pass is not a Second Voice interview. Return
     both results to the owner without waiting. A deferred Project is not picked
     up before its task's return condition or an explicit owner return.
   - For user-facing surface, prepare the UX checkpoint per
     `templates/orchestrator-brief.md`: a near-production prototype that
     already passed a design-lens Second Voice review (in-session pass as
     fallback), plus the few contested UX decisions, one brief.
   - Discovery choices/PRD yes are the orchestrator's with sources and owner
     override; more than three Issues, money, user data, irreversible effects and
     design stay the user's decisions — exercised at checkpoints with prepared
     variants, per the Always-ask list.
3. `handoff`
   - After Discovery run `mono:handoff` yourself in this session, by its
     orchestrator-mode reference. Answer reconciliation conflicts without money,
     user data or irreversible effects yourself with a recorded reason; those and
     more than three Issues go to the owner while other waves continue.
   - Bring the user the Handoff summary; it never holds other waves. Work starts
     only when the owner presses «Начать работу» or says «начинаем»; then write
     and read back the start record before any dispatch. Never start work
     yourself; a Ready Project without that record is never dispatched.
4. `dispatch`
   - Apply [landing launch scheduling](references/landing.md#scheduling) before adding work to a running wave.
   - Before incompatible plugin updates require machine-wide quiescence per
     `references/install.md`; each product owns its launch halt and read-back.
   - Start the heartbeat watcher before the first spawn of a wave:
     `node '<pack-root>/scripts/watch-workers.mjs' --root ~/.mono-agent-workflow/orchestrator/<product>`
     via continuous runtime monitoring (`persistent: true` or equivalent) for
     the whole wave (Heartbeat in
     `references/orchestration.md`); no worker spawns until it is running.
     Substitute `<pack-root>` with the loaded pack root;
     never use the product/worktree current directory.
     The upstream pack source remains `scripts/watch-workers.mjs` for
     development and fixtures.
   - Select [execution Issues](references/lifecycle.md#задачи-этапов) only; never pass a task labelled `Этап` to `dispatch.mjs` (the script cannot inspect labels).
   - One of the [execution Issues](references/lifecycle.md#задачи-этапов) per worker. Use `scripts/orchestrator/dispatch.mjs`
     with Issue, root, config, snapshot bodies and the explicit lifecycle moves,
     open-decision count and verification command. It builds pins/digest, extracts,
     start-gate and spawn requests, renders the single dispatch template, passes
     start, launches through spawn.mjs and appends the UTC ledger event. Refusals
     before spawn register no attempt; --preapply requires the approved manifest and mandate.
     Spawn through the runtime transport with
     `templates/orchestrator-dispatch.md`: one delivery, full context snapshot, AFK
     contract, engine block, mailbox path, authorization. Include the
     no-sub-delegation rule in every dispatch prompt.
   - Dispatch mono:deliver once per approved [execution Issues](references/lifecycle.md#задачи-этапов) with the full snapshot,
     exact identity command, start-gate request and required phase capabilities.
     Pin request handshake=wait|resume (default resume), profile=short|full
     (default full), pins {file,digest}, pinsVersion=0; short only tiny/standard,
     critical null, afk true, openDecisions 0 (last two supplied by orchestrator).
     Use installed scripts/orchestrator/spawn.mjs; never session-local helpers.
     Select worker role by the model policy and recorded technical judgment;
     preserve launch pins on resume. The tool enforces halt, attempt cap and
     durable registration before execution. Keep worktree, attempt log and
     context across phases. Respect dependencies/concurrency configuration.
   - For lifecycle-carrying startup follow Two-Phase Dispatch Handshake in
     references/orchestration.md exactly: pre-move snapshot, validated ack,
     read-back of every move, verified writer, private record, ack rename,
     gates removal. Wait: consume live waiting writer without resume; resume:
     same-thread registered writer. Use `scripts/orchestrator/accept.mjs ack`
     to validate before printing a digest-bound move plan; apply via the connector
     and supply --readback with planDigest and fresh observations. Identical
     consumption completes recovery without another plan; conflicting records
     refuse. It delegates to installed consume-gate-ack.mjs and,
     only for exit/resume recovery, resume.mjs. Missing/contradictory evidence never
     permits lifecycle replay; poll both mailbox and fallback.
   - Use active control for dispatch, draining for existing work only, idle only
     with empty registry. halt refuses spawn/resume without stopping workers.
     Keep attempts.json when an entry retires; never reset the cap.
5. `monitor`
   - Record PR-opening and accepted ship heads with `head`, then collect force-push events with `harvest` after landing, per [landing accounting](references/landing.md#head-observations-and-refresh-history).
   - Apply Monitoring Protocol before every event/poll. No-change wakeups
     (false alarm after inspection, already-consumed report, or no events) create
     no owner message or routine ledger entry. Record actual observation recovery
     and healing steps/results. An unconfirmed alarm is no owner blocker. Validate startup gates,
     ack status and current-attempt provenance before report routing. Private
     consumed records guide crash recovery; mailbox tombstones never authorize it.
     Ack/report ambiguity requires transport/worktree reconciliation. A blocked
     ack waits for its correlated report before consumption; rejected attempt
     requires a new verified attempt, never same-attempt nudge.
   - Consume phase events AND poll phase files. Validate capsule and full queue;
     start `scripts/orchestrator/collector.mjs start --root DIR --issue KEY
     --attempt N` outside worker sandboxes for empty/collection-only queues; inspect
     `status` and its reports log, and `stop` at attempt end. Connector queues still
     apply Delivery Write Barriers through installed
     `scripts/orchestrator/accept.mjs report`: open a reconciliation session,
     inspect expanded writes (reread first on retry), apply through the connector,
     submit --session/--observe read-backs and confirm the full queue with the
     pack `scripts/orchestrator/linear-adapter.mjs`. Old session observations
     never authorize a new confirmation; printed apply instructions prove nothing.
     Use `accept.mjs amend --text` for upward risk/critical, dataset-version or
     complete-grant amendments and --full-snapshot when requested; it registers
     pins.v<n>.json after resume.mjs succeeds, under the collection admission lock.
     Refused resume leaves the current registry pins unchanged.
     Keep durable per-write results/reconciliation.
     Grant workers reports/ only; publish confirmations/ outside their grants. Handle preflight-collect with sandboxed verification/review at the pinned evidenceRoot; recheck collect:false before ship.
     Publish whole-queue confirmation; never send a stage-resume prompt to a
     worker waiting on a file. Preserve certificate-before-review,
     drift-before-PR, In-Review-after-PR ordering. On recovery read capsule and
     reconcile Linear before applying only missing writes.
   - Validate each terminal verification_items list against every Issue line;
     missing coverage or wholesale deferral without pass is non-green. Green
     requires all confirmations plus an independently run installed ship gate.
     Parked requires dictionary reason/text: reflect it in Linear with read-back
     in this same turn, then route decide-or-escalate. A failed Linear write stays
     visible as pending, never reported applied.
   - For stall/dead/spawn-fail inspect latest state before healing. Startup ack
     pause is not death; reconcile unconsumed ack first. Wait consumption keeps
     suppression until log continues, at most one stallSec from fixed consumedAt.
     Phase confirmation wait
     is bounded by config. These deadlines take priority over unfinished commands.
     Ordinary silent live writers with pending commands defer stall for a fixed
     60-minute best-effort diagnostic from first watcher observation; process descendants alone prove
     nothing. At «идёт команда дольше 60 минут», inspect progress as before.
     Missing writer evidence and dead remain unchanged. No report: same-thread resume once to demand capsule
     and report; failed recovery uses a new attempt within cap, not a restarted
     Issue. Record every healing step/result. Do not steer progressing workers.
   - Backup switching is an orchestrator decision, never failure classification.
     Only `subscription-exhausted` or `provider-refusal-after-recovery` may use the
     standing `orchestration.backupTransport` mandate on the old BASE. Follow
     Backup worker switch in `references/orchestration.md`: quiesce/capture the tree,
     stop/retire the old attempt, reconcile unattributed post-launch processes
     against its retained baseline, preserve/reconcile work, and dispatch a
     new attempt with `--backup-switch` and journal evidence. Both bases retain
     the backup and reviewer; cap, rights and gates stay intact. Default backup
     roles: Codex `worker-default` (complex only with recorded reason), Claude
     `worker-claude`. Read back the Issue comment naming reason, evidence/digest,
     workers and attempts before startup moves. Retain the one-switch marker;
     no automatic return. Closeout training uses a real attempt in a one-off
     root with a marked reason; never fabricate live subscription exhaustion.
6. `decide-or-escalate`
   - Technical questions: decide, record in the ledger under «Решил сам:»
     with a one-line reason, answer the worker.
   - Always-ask questions (scope, design/UX, product risk, deploy approval
     per policy): escalate immediately and interactively with a decision
     brief. Design questions require prepared visual variants first.
7. `deploy-and-closeout`
   - When a worker reports `green` (mono-ship green certificate), run
     `mono:deploy` from this session per the configured Deploy workflow
     and `deployApproval` policy, including its mandatory Live QA gate
     (`skills/deploy/SKILL.md`). The live sweep runs
     orchestrator-side — workers have no browser.
   - On a live defect, file an immediate hotfix Issue and dispatch it
     out of queue ahead of queued work (fix-forward); the shipped Issue
     moves to `Done` only after its own live pass is green, and the hotfix
     Issue gets its own live verification.
     Set the assignee of that hotfix Issue to the acting user
     (`assignee: "me"` on the Linear connector) at creation; an Issue that
     already exists keeps the assignee it has.
   - Record ledger entries; verify Linear closeout happened per stage skill
     contracts.
   - Carry the closeout's `project-update` outcome into the next status: the
     published update's URL and the project-completion result belong on the
     «Linear:» line. Completion is a closeout effect only — `resume` never
     sweeps projects for completion and never publishes an update that no
     shipment produced.
   - After successful deploy closeout, remove the Issue entry from
     `workers.json`; this retirement is required before the wave can become
     `idle`.

Rules:

- This skill is a control plane: never implement, edit code, fix CI, or rewrite PRs
  in this session; delegate that to workers. Discovery artifacts (prototypes,
  mockups, review notes) stay orchestrator-owned. Stages before Handoff
  (Idea, Research, Discovery) explicitly run here under their own rules;
  implement/preflight/ship always stay in workers.
- Narrow control-plane exception: under an explicit owner mandate the
  orchestrator MAY author operational and deploy-repair changes directly —
  deploy scripts, infra config, docs address sweeps — and every such change
  is ALWAYS recorded in the ledger as a control-plane exception naming the
  mandate. Feature code NEVER qualifies; it always routes through workers.
- Single Linear writer: all Linear mutations during orchestration happen in
  this session; workers never write to Linear and queue every stage-required
  mutation in their reports.
- Never skip or weaken lifecycle gates; the orchestrator sequences gates, it
  does not replace them.
- Never ask the user an unprepared question; exhaust autonomous work first
  and refresh item state immediately before asking (Decision Briefs policy).
- Idea approval and the start of Research still wait for the owner. Research/Discovery results are owner
  contacts without waiting; Discovery uses its own yes, never owner yes.
- Touch the user only at checkpoints: Idea description approval and Research start (clarify meaning only when necessary), the UX
  checkpoint, the Handoff summary and work start, deploy approval per policy, and ad-hoc
  risk or scope-drift escalations; decide everything else and record it
  under «Решил сам:» (Director Discovery in `references/orchestration.md`).
- Second Voice reviewers are discovery agents, not workers: they never
  talk to the user, never write Linear, and never dispatch or steer
  workers.
- Workers must not spawn sub-workers or manage other sessions; the
  no-sub-delegation rule goes into every dispatch prompt.
- One Issue per worker; the worker keeps its session and worktree across
  stages to preserve context.
- On material drift, stop the worker and escalate:
  `scope-drift-needs-handoff` routes through `mono:handoff` with the user.
- A stuck or dead worker is respawned from Linear plus the last mailbox
  report; continue the stage, do not restart the Issue.
- The heartbeat watcher (`scripts/watch-workers.mjs` from the pack root)
  is started before the first spawn and runs for
  the whole wave with continuously monitored stdout (`persistent: true` or
  equivalent). Periodic wakeups are only an explicitly recorded degradation,
  with cause/binding and actual recovery recorded in the ledger (Heartbeat in
  `references/orchestration.md`).
- Keep the ledger free of secrets and routine polling/no-change wakeup entries.
- Keep user-facing output in the project config language (Russian by
  default); ledger and mailbox stay English except the fixed «Решил сам:»
  term.
- Owner-facing output is product language: statuses, period reports, wave
  reports, and briefs name work by what the product now does for its user,
  never by Issue key, stage, wave slice code, or mechanism as the subject
  (Product Language For The Owner in `references/human-friendly-output.md`).
  The machine register lives only in the «Техника (можно не читать):» tail,
  and the owner never has to ask for a human version.
- Every project update in Linear — a sweep over the Delivery projects, a
  completion by hand, a retro note, an edit of someone else's update — is
  written only in the form of `templates/project-update.md` («Выкладка» or
  «Состояние»). The status register and the ledger — «Техника», Issue keys,
  wave slice codes, SHAs, build numbers, review rounds — never reach a Linear
  update. One update is one project and one result: a sweep over several
  shipped Issues is split into one update per Issue.

Session verdicts:

- `active`: work in flight; status updates continue.
- `needs-human`: an Always-ask decision blocks all remaining progress;
  waiting on the user.
- `blocked`: orchestration cannot continue (Linear, config, or worker state
  unrecoverable); exact blocker reported.
- `idle`: every active Issue is deployed and closed; awaiting new work.

Final response (status update) follows the «Статус» shape in
`templates/orchestrator-brief.md` and Product Language For The Owner in
`references/human-friendly-output.md`; the final wave report adds that
template's «Итог волны» blocks — what the wave came to against its goal,
what did not make it and why, and what it taught — between «Где мы к
цели» and «Техника». Every status carries:

- The first line: period, product, one sentence on where the product stands
  against the wave goal, and the counter «Решений от тебя: N (в конце)» or
  «нет».
- «Новое за <период>:» — what the product's user can now do, each line in one
  of the three states of the template: «проверил вживую на проде»,
  «проверка после выкладки прошла», or «выложено, вживую не гонял»;
  «Можешь потрогать:» when there is something to touch; «Где мы к цели:» —
  done and remaining in product words.
- «В работе сейчас:» and «Дальше по очереди:» — the next product outcomes in
  order, each with its human-worded stage and what it waits on; work an
  external constraint has stopped carries «стоит: <из-за чего>» instead of a
  stage.
- «Что пошло не так:» — idle periods over 5 minutes and contract deviations,
  stated as the result that moved, or «нет» when clean; «Чем рискуем:» and
  «Обещал — не сделал:» only when there is an open risk or an unkept
  promise.
- «Решил сам:» — decisions taken since the last update, one line each with
  the reason; a standing rule only when it delayed something.
- «Проверил вживую / Не проверял» in product words, and
  «Следующий контакт:» — when the owner hears from you next and about what.
- «Техника (можно не читать):» — the machine register: the per-Issue status
  table with stage and one-line state, workers spawned/advanced/respawned
  since the last update, Linear mutations applied and certificates
  recorded, and «Контекст: ~N%» — orchestrator session context usage per
  the Context Budget policy in `references/orchestration.md`.
  Cost telemetry lives in this tail too. Before emitting a status, run the
  `node '<pack-root>/scripts/wave-cost.mjs'
  <ISSUE-KEY>` for each Issue with logs,
  and copy its final Russian line verbatim after the `Цена волны:` label. If
  collection fails, write `unavailable: <reason>` instead of estimating. The
  final wave report carries the same lines in its «Цена волны» block, per the
  Cost Telemetry policy in `references/orchestration.md`. Cost is telemetry,
  not a gate: it never blocks, pauses, delays a stage, or pages.
- «Нужно от тебя:» is always the last block: decision briefs per the
  template, each under the board-aligned ID of its own board section
  (`1a-…`), or «нет».
