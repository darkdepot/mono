---
name: mono-orchestrate
description: Use when running a long-lived product orchestrator session that drives Linear projects and Issues through the workflow with delegated worker sessions.
---

# Mono Orchestrate

Use this skill to run the control plane for one product: drive Linear
projects and Issues through the existing workflow skills with delegated
workers, answer technical questions autonomously, and escalate only product
decisions to the user.

`mono-orchestrate` never does stage work itself. It inspects, delegates,
monitors, decides or escalates, records, and reports. Stage ownership is
unchanged: `mono-implement` owns Delivery Start, `mono-preflight` owns
local readiness, `mono-ship` owns the PR lifecycle, `mono-deploy` owns
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
  block (`orchestration.transport`, `orchestration.maxParallelWorkers`).
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

Workflow states:

1. `resume`
   - Rebuild the full picture from Linear + ledger + mailbox + worker
     registry + live session list before any action (Resume procedure in
     `references/orchestration.md`).
   - Rebind to surviving `codex-cli` workers by thread id instead of
     respawning them only when the registry and installed `surfaceRevision`
     match; never rebind a thread from another surface revision.
   - Apply queued Linear mutations from worker reports that were never
     applied.
   - Output the rebuilt status table before taking new actions.
2. `intake-and-discovery`
   - Run `mono-idea` per idea in this session; with several ideas, queue
     them and run discovery one project at a time (Director Discovery in
     `references/orchestration.md`) while dispatched work continues.
   - Run the recommended discovery route and review skills through the
     Second Voice protocol (`references/orchestration.md`): an independent
     reviewer agent interrogates and challenges, you answer as product
     director, record material choices under «Решил сам:», and batch
     genuinely contested items into checkpoints instead of relaying
     question streams to the user.
   - For user-facing surface, prepare the UX checkpoint per
     `templates/orchestrator-brief.md`: a near-production prototype that
     already passed a design-lens Second Voice review (in-session pass as
     fallback), plus the few contested UX decisions, one brief.
   - Scope boundaries, issue slicing, risk acceptance, and design stay the
     user's decisions — exercised at checkpoints with prepared variants,
     per the Always-ask list.
3. `handoff`
   - Run `mono-handoff` in this session. Bring the user one
     package-approval decision brief per `templates/orchestrator-brief.md`.
   - After package approval, implementation start is the orchestrator's own
     decision; record it explicitly (the bundled-approval rule from
     `mono-implement` applies).
4. `dispatch`
   - Acquire `~/.mono-agent-workflow/install.lock` using the shared Install
     Coordination protocol in `references/orchestration.md` before creating the product root
     or repairing its canonical state files, and before an `idle` → `active` transition.
     Do not create or mutate orchestrator state when the installer owns the lock.
   - Start the heartbeat watcher before the first spawn of a wave:
     `node scripts/watch-workers.mjs --root ~/.mono-agent-workflow/orchestrator/<product>`
     via the runtime Monitor primitive (Heartbeat in
     `references/orchestration.md`); no worker spawns until it is running.
   - One Issue per worker. Spawn through the runtime transport with
     `templates/orchestrator-dispatch.md`: full context snapshot, AFK
     contract, engine block, mailbox path, authorization. Include the
     no-sub-delegation rule in every dispatch prompt.
   - A dispatch that carries a lifecycle move — a project's first
     `mono-implement` dispatch, or an issue-only activation — runs the
     two-phase handshake: emit the pre-move snapshot with the Gate Phase block
     filled, apply no move until the worker's `gates-passed` gate-ack, check
     the exact ack artifact the event named — mailbox and fallback share a
     filename and can disagree — against the gate list you dispatched, by set
     equality on the gate names, never a count, then apply every move with
     read-back, resume that same worker with the read-back as an explicit
     snapshot amendment, and consume the ack by renaming it
     `<ISSUE-KEY>-gate-ack-a<N>.applied.json` in the same immediate post-resume
     registry update — every candidate for that attempt, in the mailbox and in
     the worktree fallback, not only the artifact the event named. An ack you reject for incomplete gate coverage is
     consumed too — renamed `<ISSUE-KEY>-gate-ack-a<N>.rejected.json` — and then
     owned by the no-ack path. That order is load-bearing in both directions: an ack
     left in place keeps suppressing that worker's `stall` and `dead` events,
     while consuming it before the resumed writer is registered leaves a window
     where the watcher calls a healthy resume dead. Neither order closes the
     crash window between the resume and the rename: when you cannot tell
     whether a resume landed, reconcile against the transport thread and the
     worktree before any second resume, because an unconsumed ack on its own
     never authorizes resuming twice. The rule, the ack shape,
     and the blocked and no-ack paths have one home: Two-Phase Dispatch
     Handshake in `references/orchestration.md`. Applying a dispatch-moment
     move earlier needs an explicit owner mandate recorded in the ledger; it is
     never a «Решил сам:» decision.
   - For `codex-cli` and `fallback` transports, create the worker's worktree
     before spawn per `references/orchestration.md` Worker Transports.
   - Verify every spawn per Worker Transports in
     `references/orchestration.md`: prompt passed as a file, `thread.started`
     in the log within 60s (else kill+retry), attempt-numbered logs from
     `-a1`, model and reasoning effort pinned in the command.
   - Record every spawn in `workers.json` (transport, thread id, worktree,
     branch, stage, `packVersion`, `sourceCommit`, `surfaceRevision`); update it
     on stage advance and respawn. Never record a live worker with an empty thread id.
   - Set `control.json` to `active` before dispatch. Use `draining` when new
     dispatch is stopped while registered workers close, and `idle` only with
     an empty active registry.
   - Cap concurrent workers at `orchestration.maxParallelWorkers` (default 3);
     queue the rest.
   - Respect Issue dependencies; queue dependents until their blockers
     report done.
   - Name workers `<ISSUE-KEY>: <stage>`.
5. `monitor`
   - Poll the mailbox cheaply; read reports; advance the same worker session
     to the next stage (`mono-implement` → `mono-preflight` →
     `mono-ship`). For `codex-cli` workers advance the same thread with
     `codex exec resume` and treat process exit plus report as the normal
     advance signal (liveness ladder in `references/orchestration.md`).
   - Follow the Monitoring Protocol in `references/orchestration.md`. Do not steer an actively progressing worker.
   - Heartbeat watcher events (`stall`, `dead`, `spawn-fail`) are Monitoring
     Protocol triggers: read the worker's latest state, then heal through
     the ladder nudge → respawn → session rotation; alert the user only when
     the ladder is exhausted. Record every healing step and its result in
     the ledger (Heartbeat in `references/orchestration.md`).
   - A `gate-ack` event is a delivery event, not a liveness one. If this
     stage's report is also present, that pairing is AMBIGUOUS rather than
     proof: reports carry no attempt number, so the report may belong to a
     superseded worker and not to this ack. Reconcile before acting — check the
     transport thread and the worktree for whether THIS attempt executed — and
     never silently consume the ack or resume on it twice. Otherwise read the ack
     and branch on its `status`: `gates-passed` applies the dispatch's
     lifecycle moves with read-back and resumes that worker; `blocked` applies
     no move at all and waits for the ordinary stage report that path also
     writes, which routes to `decide-or-escalate` like any non-green report
     (Two-Phase Dispatch Handshake in `references/orchestration.md`). A worker
     quiet after a fresh `gates-passed` ack is waiting by contract — never
     heal it.
   - Route non-green reports (`blocked`, `needs-human`, `drift-candidate`,
     `needs-decision`, `scope-drift-needs-handoff`) to `decide-or-escalate`
     instead of advancing.
   - Audit `verification_items` coverage before advancing a stage-terminal
     report: missing coverage of the Issue's «Как проверить», or wholesale
     deferral with no `pass` items, is treated as non-green regardless of the
     report status.
   - On `timed-out`: treat as a stuck worker; rebuild stage state from Linear
     and the last mailbox report and respawn per the Monitoring Protocol.
6. `decide-or-escalate`
   - Technical questions: decide, record in the ledger under «Решил сам:»
     with a one-line reason, answer the worker.
   - Always-ask questions (scope, design/UX, product risk, deploy approval
     per policy): escalate immediately and interactively with a decision
     brief. Design questions require prepared visual variants first.
7. `deploy-and-closeout`
   - When a worker reports `green` (mono-ship green certificate), run
     `mono-deploy` from this session per the configured Deploy workflow
     and `deployApproval` policy, including its mandatory Live QA gate
     (`skills/mono-deploy/SKILL.md`). The live sweep runs
     orchestrator-side — workers have no browser.
   - On a live defect, file an immediate hotfix Issue and dispatch it
     out of queue ahead of queued work (fix-forward); the shipped Issue
     moves to `Done` only after its own live pass is green, and the hotfix
     Issue gets its own live verification.
   - Record ledger entries; verify Linear closeout happened per stage skill
     contracts.
   - After successful deploy closeout, remove the Issue entry from
     `workers.json`; this retirement is required before the wave can become
     `idle`.

Rules:

- This skill is a control plane: never implement, edit code, fix CI, or rewrite PRs
  in this session; delegate that to workers. Discovery artifacts (prototypes,
  mockups, review notes) are discovery work, not stage work, and stay
  orchestrator-owned.
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
- Touch the user only at checkpoints: intake direction questions, the UX
  checkpoint, package approval, deploy approval per policy, and ad-hoc
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
  `scope-drift-needs-handoff` routes through `mono-handoff` with the user.
- A stuck or dead worker is respawned from Linear plus the last mailbox
  report; continue the stage, do not restart the Issue.
- The heartbeat watcher (`scripts/watch-workers.mjs`) is started before the
  first spawn and runs for the whole wave; running a wave without it is a
  degradation recorded in the ledger (Heartbeat in
  `references/orchestration.md`).
- Keep the ledger free of secrets and routine polling entries.
- Keep user-facing output in the project config language (Russian by
  default); ledger and mailbox stay English except the fixed «Решил сам:»
  term.

Session verdicts:

- `active`: work in flight; status updates continue.
- `needs-human`: an Always-ask decision blocks all remaining progress;
  waiting on the user.
- `blocked`: orchestration cannot continue (Linear, config, or worker state
  unrecoverable); exact blocker reported.
- `idle`: every active Issue is deployed and closed; awaiting new work.

Final response (status update) must include, per
`templates/orchestrator-brief.md`:

- Status table: each active Issue with stage and one-line state.
- «Решил сам:» — decisions taken since the last update, one line each with
  the reason.
- «Нужно от тебя:» — decision briefs, or «нет».
- Workers: spawned/advanced/respawned since the last update.
- Linear: mutations applied and certificates recorded.
- «Простои и отклонения:» — idle periods over 5 minutes with cause and
  duration, contract deviations with reason, or «нет» when clean.
- «Контекст: ~N%» — orchestrator session context usage per the Context
  Budget policy in `references/orchestration.md`.
- Cost telemetry: the per-Issue cost tail in the status table («цена: ~N
  тыс. out-токенов, M циклов ревью», or «цена: н/д» when data is missing)
  and, in the final wave report, the «Цена волны» block — per the Cost
  Telemetry policy in `references/orchestration.md`. Cost is telemetry,
  not a gate: it never blocks, pauses, or pages.
