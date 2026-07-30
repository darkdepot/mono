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
     `node '<installed-mono-orchestrate-dir>/../.mono-agent-workflow/scripts/watch-workers.mjs' --root ~/.mono-agent-workflow/orchestrator/<product>`
     via the runtime Monitor primitive (Heartbeat in
     `references/orchestration.md`); no worker spawns until it is running.
     Substitute `<installed-mono-orchestrate-dir>` with the absolute directory
     containing this loaded `SKILL.md`; never resolve the `../` segment against
     the product/worktree current directory.
     The upstream pack source remains `scripts/watch-workers.mjs` for
     development and fixtures.
   - One Issue per worker. Spawn through the runtime transport with
     `templates/orchestrator-dispatch.md`: full context snapshot, AFK
     contract, engine block, mailbox path, authorization. Include the
     no-sub-delegation rule in every dispatch prompt.
   - Before starting every gate-carrying `mono-implement` spawn, respawn,
     or session rotation, create its empty attempt log and atomically
     pre-register `registryEntry.gates` as the exact non-empty, unique list of
     gate names dispatched for THAT attempt alongside `stage`, `log`, pack
     identity, publication-time `spawned_at`, `thread_id: null`, and `pid: null`.
     The worker process starts only after that durable write succeeds. After
     `thread.started`, update the
     same entry with verified live identity while preserving `log` and `gates`;
     retire an inactive entry when spawn fails. The watcher recognizes the
     empty-log/null-identity entry as inactive startup, keeps it quiet for one
     stall-threshold window measured from that `spawned_at`, and emits
     `spawn-fail` if `thread.started` never arrives. A value more than five
     seconds in the future is malformed and gets no startup suppression.
     Preserve the list on a
     same-attempt no-ack nudge/resume and while a passed ack awaits confirmed
     resume. Never copy it to a new attempt implicitly: a verified new
     gate-carrying attempt writes its own list, while `mono-preflight`,
     `mono-ship`, and every other non-gate dispatch omit it. The complete
     rename-before-delete lifecycle is single-homed in the Registry gate-list
     lifecycle table of `references/orchestration.md`.
   - A dispatch that carries a lifecycle move — a project's first
     `mono-implement` dispatch, or an issue-only activation — runs the
     two-phase handshake: emit the pre-move snapshot with the Gate Phase block
     filled, apply no move until the worker's `gates-passed` gate-ack, check
     the exact ack artifact the event named — mailbox and fallback share a
     filename and can disagree — against `registryEntry.gates` from the
     current attempt's registry entry: `gates-passed` requires exact set
     equality on the gate names, never a count; `blocked` accepts a non-empty
     subset but no foreign or duplicate names. Then apply every move only for
     `gates-passed`, with
     read-back, resume that same worker with the read-back as an explicit
     snapshot amendment, register the resumed writer while preserving
     `registryEntry.gates`, atomically publish the private orchestrator
     `<orchestrator-root>/consumed/<ISSUE-KEY>-gate-ack-a<N>.json` record with
     `outcome: applied`, rename every candidate for that attempt to
     `<ISSUE-KEY>-gate-ack-a<N>.applied.json`, and only then remove `gates` in
     a separate registry write. The rename covers the mailbox and the worktree fallback, not only
     the artifact the event named. An ack you reject for incomplete gate
     coverage is consumed too — atomically publish the trusted record with `outcome: rejected`, then rename
     it `<ISSUE-KEY>-gate-ack-a<N>.rejected.json` and remove `gates`. That attempt is terminal;
     verified-respawn a NEW gate attempt with its own list and never
     same-attempt nudge it. Tombstones are delivery/suppression markers only
     and never authorize Resume cleanup; only a well-formed record for the
     current attempt in the private `consumed/` namespace does. A fabricated
     mailbox record is never cleanup authority. That order is load-bearing in both directions: an ack
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
     branch, stage, `packVersion`, `sourceCommit`, `surfaceRevision`, and the
     attempt-scoped `gates` list when this is a gate-carrying attempt); update
     it on stage advance and respawn. Never record an empty thread id for a
     live worker.
   - Set `control.json` to `active` before dispatch. Use `draining` when new
     dispatch is stopped while registered workers close, and `idle` only with
     an empty active registry.
   - Cap concurrent workers at `orchestration.maxParallelWorkers` (default 3);
     queue the rest.
   - Respect Issue dependencies; queue dependents until their blockers
     report done.
   - Name workers `<ISSUE-KEY>: <stage>`.
5. `monitor`
   - Poll the mailbox cheaply for BOTH reports and gate-acks. The ack is durable
     state, not just an event: watcher delivery is at-least-once per watcher
     process, so a consumer that crashed or missed the event is not told again
     while that process lives. The poll is what makes the handshake recoverable;
     the event only accelerates it and is never proof of validation. An
     unconsumed ack found by polling is handled exactly as a delivered one,
     and both paths validate it against `registryEntry.gates` from the current
     attempt rather than process memory.
   - Read reports; advance the same worker session
     to the next stage (`mono-implement` → `mono-preflight` →
     `mono-ship`). For `codex-cli` workers advance the same thread with
     `codex exec resume` and treat process exit plus report as the normal
     advance signal (liveness ladder in `references/orchestration.md`).
   - Follow the Monitoring Protocol in `references/orchestration.md`. Do not steer an actively progressing worker.
   - Before any heartbeat event enters the common healing ladder, perform the
     stage-aware `registryEntry.gates` shape check. A malformed present value
     on a gate-carrying `mono-implement` entry is a producer contract error:
     terminate that attempt and verified-respawn a NEW gate attempt with its
     own correct list; do not same-attempt nudge it. Any presence on a
     `mono-preflight` or `mono-ship` entry is forbidden: start a new attempt
     of that same stage WITHOUT `gates`. These are monitor recovery branches,
     not watcher mutations and not handshake routing.
     When an ack exists but `gates` is absent, the ack is unusable and the
     current attempt takes the NEW-attempt recovery branch with a correct
     dispatched list. There is no source-identity discriminator or form-only
     legacy branch. With no ack, field absence leaves watcher liveness signals
     unchanged.
     Because stage/log advance and `gates` removal are one atomic
     post-reconciliation write, later-stage presence is never an in-progress
     cleanup window: finish journal recovery while the entry is still
     `mono-implement`; otherwise take the forbidden-presence branch.
   - Before the ordinary no-ack healing ladder, only when `registryEntry.stage` is `mono-implement` and its CURRENT log
     is `<ISSUE-KEY>-mono-implement-a<N>.jsonl`, a well-formed private record
     for that same `<N>` with `outcome: rejected` skips same-attempt nudge and
     routes directly to a verified respawn of a NEW gate attempt with its own
     correct list. Preflight and ship entries never consult the record. The
     private record preserves terminal routing across an orchestrator crash
     before or after ack rename and `gates` removal. If the record exists while
     an unconsumed ack remains, finish the rename selected by `outcome` first.
     A watcher redelivery or poll of that ack is consumption recovery, not
     authority to apply lifecycle moves again.
   - An unconsumed valid `blocked` ack without its correlated stage report is
     missing-report recovery, not the no-ack ladder. Preserve the ack and
     `registryEntry.gates`; resume the same thread once to demand the report,
     and consume `.blocked` only after the report validates.
   - Heartbeat watcher events (`stall`, `dead`, `spawn-fail`) are Monitoring
     Protocol triggers: read the worker's latest state, then heal through
     the ladder nudge → respawn → session rotation; alert the user only when
     the ladder is exhausted. Record every healing step and its result in
     the ledger (Heartbeat in `references/orchestration.md`).
   - A `gate-ack` event is a delivery signal, not durable proof and not a
     liveness event. Read the exact artifact named by the event and validate it
     against `registryEntry.gates` from the current attempt before reading its
     `status`; polling performs the identical validation. That validation is
     status-asymmetric: `gates-passed` requires exact set equality, while
     `blocked` accepts a non-empty subset with no foreign or duplicate names.
     After validation, read the ack's `status` first, never the report on its own.
     `blocked` applies no move at
     all, and its ack arrives before its report by contract.
     Do not publish the consumption record, rename the ack, or remove
     `registryEntry.gates` until the correlated ordinary stage report exists
     and validates. Before consuming `.blocked`, reconcile the transport thread and worktree
     to prove the current attempt authored the shared-path report; report shape
     and freshness alone are insufficient. Preserve the ack and field while
     polling or resolving ambiguity.
     Only after that report validates, atomically publish the private
     orchestrator `<orchestrator-root>/consumed/<ISSUE-KEY>-gate-ack-a<N>.json` record with
     `outcome: blocked`, rename the ack as
     `<ISSUE-KEY>-gate-ack-a<N>.blocked.json`, remove `registryEntry.gates`, and
     route the report through `decide-or-escalate` like any non-green report —
     the two arriving
     together is that path working, not a crash.
     `gates-passed` applies the
     dispatch's lifecycle moves with read-back and resumes that worker — unless
     this stage's report is already present, which is AMBIGUOUS rather than
     proof, because reports carry no attempt number and that one may belong to
     a superseded worker. Reconcile before acting — check the transport thread
     and the worktree for whether THIS attempt executed — and never silently
     consume the ack or resume on it twice (Two-Phase Dispatch Handshake in
     `references/orchestration.md`). For every outcome, atomically publish the
     trusted consumption record first — durable file, atomic rename, then
     `fsync` of the containing `consumed/` directory; before publishing or
     trusting any record, also `fsync` the orchestrator-root directory that
     contains `consumed/`, whether or not the namespace already existed — then
     rename every ack candidate, then remove `gates`. A visible record after a
     failed directory sync is not authority: Resume re-syncs `consumed/`
     successfully before trusting it. A
     worker-writable tombstone or mailbox record never substitutes for that
     private current-attempt record during Resume cleanup. For `outcome:
     blocked`, that record binds only the ack outcome: after a crash, re-run
     transport/worktree reconciliation before routing any report and never use
     the record itself as report-version proof. A worker quiet after a fresh
     `gates-passed` ack is waiting by contract — never heal it.
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
- The heartbeat watcher (`../.mono-agent-workflow/scripts/watch-workers.mjs`
  relative to this installed skill directory; upstream source
  `scripts/watch-workers.mjs`) is started before the first spawn and runs for
  the whole wave; running a wave without it is a degradation recorded in the
  ledger (Heartbeat in
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
