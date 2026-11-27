---
name: orchestrate
description: Use when running a long-lived product orchestrator session that drives Linear projects and Issues through the workflow with delegated worker sessions.
---

# Mono Orchestrate

Find shared files here or at the pack root.

Run the control plane for one product: drive Linear projects and Issues
through the workflow skills with delegated workers, decide technical
questions, and escalate only product decisions to the user.

Run pre-delivery stages through the same stage skills in Claude Code agents;
answer as delegated owner. Each stage writes/read-backs its own Linear records,
returns its selected transition; the orchestrator launches the next stage.
Idea always needs the owner's verbatim reply. Delegation is the latest Idea record's
outside-fence mark (or a pre-version explicit owner decision); otherwise owner
starts Research/work. Delivery workers keep implement/preflight/ship ownership.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `references/orchestration.md`
3. `references/human-friendly-output.md`

Read when — load the file only when its condition is true for this run:

- `references/orchestration-stages.md` — before launching or answering a pre-delivery stage agent, and before any `by=orchestrator` record.
- `references/orchestration-dispatch.md` — before any worker dispatch, spawn or resume, and while a registry entry still carries startup `gates` or an unconsumed gate ack.
- `references/orchestration-delivery.md` — before the watcher starts, while `workers.json` holds an entry or a worker report or capsule is unreconciled, and before QA, merge or deploy of a shipped Issue.
- `templates/orchestrator-dispatch.md` — when a worker dispatch is prepared.
- `templates/orchestrator-brief.md` — before writing a status, wave report or decision brief.
- `templates/orchestrator-report.md` — when a worker report, phase capsule or registry entry is read, validated or written.
- `references/lifecycle.md` — when a Linear lifecycle move is sequenced or a start move from a gate acknowledgement is applied.
- `references/readiness-gates.md` — when a risk class or a stage readiness gate has to be decided for a wave.
- `references/questioning.md` — when this run escalates a decision to the owner.
- `templates/project-update.md` — when this run publishes or edits a Linear project update, including the update it writes for a project sweep or for a project completed by hand.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional. A condition describes state, not a one-time event: a file that left context after compaction is read again when its condition holds.

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
- When the user wants to drive a single Issue interactively; use plain
  stage skills.

Inputs to gather:

- Project config `.agents/mono-workflow.config.json`: product name,
  configured workflows, the `deploy` targets, and the optional `orchestration`
  block (`orchestration.transport`, `orchestration.maxParallelWorkers`).
- Fresh Linear state: projects in flight, Issue statuses, latest comments and
  certificates.
- Orchestrator state on disk under
  `~/.mono-agent-workflow/orchestrator/<product>/`: ledger, mailbox
  reports, the `workers.json` worker registry, and `control.json`.
- Runtime transport binding per `references/orchestration-dispatch.md` Worker
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
Use launch data, no verdict; self-identification
is no evidence; it never switches the session.

Workflow states:

1. `resume`
   - Rebuild state from Linear + ledger + mailbox + workers + sessions before acting (Resume in `references/orchestration.md`).
     Idea check: `node <pack-root>/scripts/idea-gate.mjs check --mode fresh --dump <dir> --config <config>`.
   - Find live `codex-cli`/`claude-cli` workers by thread id, not respawn; registry and
     `surfaceRevision` must match. Never rebind another surface revision's thread.
   - Read each live attempt's Issue comments and status back from Linear; the
     worker writes them, a dead worker's park you write.
   - Here and on every exit from a wait, find «веди до Handoff» marks on
     Projects before Delivery and continue their chain (Decision Authority in
     `references/orchestration.md`).
   - Before acting, output «Статус» with «Техника» per `templates/orchestrator-brief.md`.
2. `intake-and-discovery`
   - Follow Director Discovery and Stage agent permissions in `references/orchestration-stages.md`.
     Build `~/.claude/agents/` stage/scout definitions from `templates/stage-agent.md`
     and current host's exact tool names in fixed allowed categories. Copy
     `templates/stage-helper-hook.mjs` into `<orchestrator-root>/hooks/`; use its
     absolute path for PreToolUse `Agent|Task`, allowing only the named scouts.
     At every start and before launch verify host connections, definitions, hook
     and session visibility. Edited/new definitions require a new orchestrator
     session; until then do not launch. Codex delegated stages do not run: tell owner
     they run in Claude Code. No silent widening of tools or server wildcards.
   - One Project chain at a time: stage agents ask the same questions and show the
     same result as to owner; answer in words with a reason on that version.
     Idea in your session: show the stage description verbatim as your final
     message, per references/owner-dialog.md — finish service
     work; the question carries your position and the decision at stake;
     final-message result and contextual question; relay the exact shown text, actual
     question and verbatim owner reply. Idea files are written by shell from that
     conversation before Linear writes, with only the named small correction.
     Only a delegated Project allows autonomous Research/work start; «веди до Handoff»
     allows Research, not work start. First exemplars and
     new taste rules stay with owner. Their words reopen approvals.
   - Maintain `.claude/session-views/<этап>-<ключ проекта>-<круг>.md` in product cwd,
     append by shell before the final owner summary/question or after the owner reply; Idea description/notes from the shown message and actual owner reply.
     `git check-ignore` first; if needed add
     `.claude/session-views/` to product `.git/info/exclude`, never `.gitignore`.
     Link conversation in each stage result; no child Desktop delegation session.
   - `stale`/`legacy-migrate` Idea stops autonomous Research/work despite delegation.
     Carry it to owner; require their Idea agreement in words, confirmed record and fresh check.
     Never approve that snapshot through your reply or work-start comment.
   - Research start `by=orchestrator` is not approval: reason only, no second model.
     Before orchestrator approvals/work start run the foreground read-only different-family
     countercheck in `references/orchestration-stages.md`: text/version/reason; verdict/model/version outside fences in the same comment;
     changed text/reason needs recheck. Explain the objection in words without approval; repeated
     objection may be overridden with explicit reason; no answer after one retry
     means no approval, other Projects continue.
   - Send each stage's R1 result to owner with «Утвердил сам, потому что…»;
     first lines «Решил за тебя: …, потому что …», including overrides.
3. `handoff`
   - Launch Handoff after the routed required records. It owns package/review/Issues.
     Missing `next=`: consume effective valid tech for current PRD without another
     offer. Only absent/invalid tech with ordinary/large size offers Tech Evaluation;
     without consent no package or bypass. Authorized start only: ordinary and «веди до Handoff»
     `by=owner` after the owner's answer, delegated `by=orchestrator` with reason/countercheck. «Передать оркестратору» or typed
     «передай оркестратору» in owner session records `by=owner` and transfers work.
     Confirm start before dispatch; Ready alone is never authorization.
4. `dispatch`
   - Apply [landing launch scheduling](references/landing.md#scheduling) before adding work to a running wave.
   - Before incompatible plugin updates require machine-wide quiescence per
     `references/install.md`; each product owns its launch halt and read-back.
   - Start the heartbeat watcher before the first spawn of a wave:
     `node '<pack-root>/scripts/watch-workers.mjs' --root ~/.mono-agent-workflow/orchestrator/<product>`
     via continuous runtime monitoring (`persistent: true` or equivalent) for
     the whole wave (Heartbeat in
     `references/orchestration-delivery.md`); no worker spawns until it is running.
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
     (default full), immutable pins {file,digest}; short only tiny/standard,
     critical null, afk true, openDecisions 0 (last two supplied by orchestrator).
     Use installed scripts/orchestrator/spawn.mjs; never session-local helpers.
     Select worker role by the model policy and recorded technical judgment;
     preserve launch pins on resume. The tool enforces halt, attempt cap and
     durable registration before execution. Keep worktree, attempt log and
     context across phases. Respect dependencies/concurrency configuration.
   - For lifecycle-carrying startup follow Two-Phase Dispatch Handshake in
     references/orchestration-dispatch.md exactly: pre-move snapshot, validated ack,
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
     Keep attempts.json when an entry retires; never reset the cap. Raise one
     Issue's cap only with `attempt-cap.mjs raise` (+1 while exhausted, reason;
     above 6 the owner's verbatim words), never a local config: [cap](../../references/orchestration-delivery.md#monitoring-protocol).
5. `monitor`
   - Apply the durable late-bot-feedback cursor
     in references/orchestration-delivery.md on restore and each deploy; P1/P2
     correction Issues must be read back before advancing the journal point.
   - Apply Monitoring Protocol in `references/orchestration-delivery.md` before
     every event/poll. No-change wakeups
     (false alarm after inspection, already-consumed report, or no events) create
     no owner message or routine ledger entry. Record actual observation recovery
     and healing steps/results. An unconfirmed alarm is no owner blocker. Validate startup gates,
     ack status and current-attempt provenance before report routing. Private
     consumed records guide crash recovery; mailbox tombstones never authorize it.
     Ack/report ambiguity requires transport/worktree reconciliation. A blocked
     ack waits for its correlated report before consumption; rejected attempt
     requires a new verified attempt, never same-attempt nudge.
   - The worker writes and reads back its own Issue reports, comments and
     statuses through Linear MCP; you neither queue nor confirm them (Delivery
     Write Barriers). You write only start moves and «Изменение задачи».
   - Consume phase, parked and green events AND poll phase files; validate the capsule. The
     collector starts with the attempt and takes the worker's round requests
     itself; if the launch result or the worker reports it stopped, restart it
     with `scripts/orchestrator/collector.mjs start --root DIR --issue KEY
     --attempt N` and read its reports log. A task change: write «Изменение
     задачи» on the Issue in words, then resume.mjs with taskChange set to its
     link and those words in the resume file; a risk or grant change is a new attempt on the same branch.
     A `not-reviewed twice … (environment: …)` park needs no task change: restore
     the host (wake, load, network, CLI login), then resume.mjs with reviewRetry: true;
     a `(review: …)` park still needs the task change.
     A strict-path `needs-decision` after round 3: first an extra round, resume.mjs
     with extraRound: {reason} (once per attempt, at most one open finding, no raised
     risk, out-of-contract work or open owner remark; never with reviewRetry), with
     one journal line; then merge by the rule or a new attempt ([Parks](../../references/orchestration-delivery.md#review-rounds)).
     Grant workers reports/ only. The collector host needs both the Codex and Claude CLIs logged in by subscription, from different model families; a single-family setup gives `not-reviewed`. Approve nothing between rounds ([Review rounds](../../references/orchestration-delivery.md#review-rounds)); recheck collect:false before ship.
     Never send a stage-resume prompt to a worker waiting on a round.
   - Validate each terminal verification_items list against every Issue line;
     missing coverage or wholesale deferral without pass is non-green. Green
     requires an independently run installed ship gate.
     Parked requires dictionary reason/text: read the worker's park comment back
     (a dead worker's you write) in this same turn, then route decide-or-escalate. A failed Linear write stays
     visible as pending, never reported applied.
   - For stall/dead/spawn-fail inspect latest state before healing. Startup ack
     pause is not death; reconcile unconsumed ack first. Wait consumption keeps
     suppression until log continues, at most one stallSec from fixed consumedAt.
     A round wait holds only while its collector lives. These deadlines take priority over unfinished commands.
     Ordinary silent live writers with pending commands defer stall for a fixed
     60-minute best-effort diagnostic from first watcher observation; process descendants alone prove
     nothing. At «идёт команда дольше 60 минут», inspect progress.
     Missing writer evidence and dead are not deferred. No report: same-thread resume once to demand capsule
     and report; failed recovery uses a new attempt within cap, not a restarted
     Issue. Record every healing step/result. Do not steer progressing workers.
6. `decide-or-escalate`
   - Technical questions: decide, ledger «Решил сам:» with a one-line reason,
     answer the worker. Owner said to work without him: reversible ones too.
   - Always-ask questions (scope, first-product exemplars, product risk, product deploy-block approval): escalate at once with a decision
     brief; owner away: a non-blocking message, never a question window; work goes on.
     First-product exemplars carry proposed references and reasons.
7. `deploy-and-closeout`
   - Invoke `mono:deploy` in this product session after green Ship and green
     `mono:qa` of the same head per references/orchestration-delivery.md (QA may start
     earlier with `qa.earlyStart: true`); it owns merge/proof/checks/
     rollback/outcome, Linear closeout and project update. Retire the delivered
     worker after closeout and carry its update/completion result to owner status.

Rules:

- This skill is a control plane: feature code/CI/PR work stays in delivery workers.
  Pre-delivery artifacts belong to their stage agents; each writes its own records.
- Narrow control-plane exception: under an explicit owner mandate the
  orchestrator MAY author operational and deploy-repair changes directly —
  deploy scripts, infra config, docs address sweeps — and every such change
  is ALWAYS recorded in the ledger as a control-plane exception naming the
  mandate. Feature code NEVER qualifies; it always routes through workers.
- Delivery workers write and read back their own Issue reports, comments and
  statuses; this session writes only their start moves and «Изменение задачи».
  Stage sessions write and read back their own artifacts.
- Never skip or weaken lifecycle gates; the orchestrator sequences gates, it
  does not replace them.
- Never ask the user an unprepared question; exhaust autonomous work first
  and refresh item state immediately before asking (Decision Briefs policy).
- Idea approval, new taste rules and first-product exemplars remain owner decisions.
  A delegated Project authorizes subsequent stage decisions and Research/work start;
  «веди до Handoff» the same up to Handoff, work start stays with the owner;
  ordinary Projects still need owner start. Deploy follows configured policy.
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
  `references/orchestration-delivery.md`).
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
