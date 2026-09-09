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
- `templates/project-update.md` — when this run publishes or edits a Linear project update, including the update it writes for a project sweep or for a project completed by hand.
- `docs/ru/konstituciya-paka.md`, `docs/ru/karta-paka.md` — when this run compares the owner-layer documents with the installed copies or publishes them.

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
- Owner-layer documents: the Linear team documents «Карта пака» and
  «Конституция пака» identified by `owner-layer/documents.json` under the
  orchestrator root, and their installed copies under
  `../.mono-agent-workflow/docs/ru/` relative to the installed
  `mono-orchestrate` directory (Owner-layer reconciliation below).

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

### Owner-layer reconciliation

The owner reads and edits the pack in Russian: the Linear team documents
«Карта пака» and «Конституция пака» are the owner layer over the English
pack. This step is the whole path from an owner edit to work, and it runs one
way only: it reads Linear, writes nothing back into the document, and creates
nothing the owner has not approved. An edited article is a request, never an
approval.

Run it at the start of every orchestrator session — inside `resume`, before
the rebuilt status — and again whenever the owner says «сверь конституцию» or
«сверь карту».

Nothing in this step gates anything. A document that cannot be identified,
read, compared, or filed is named in the status and the session continues:
reconciliation informs the owner and creates drafts, and it never blocks a
dispatch, a stage, or a deploy.

1. Identify the documents. Read `owner-layer/documents.json` under the
   orchestrator root: it maps each document file name to its Linear document
   id (`karta-paka.md` for «Карта пака», `konstituciya-paka.md` for
   «Конституция пака»). When that file is absent, call
   `list_documents(<teamId from the project config>)`, match those two titles
   exactly, and write the file with the ids you found. A title with zero or
   several matches leaves that document uncompared for this run: report it and
   continue with the other one. Never guess an id, and never create the
   document.
   A mapped id that no longer resolves gets the same discovery once rather
   than being retried blindly for ever: when `get_document(<id>)` reports the
   document as missing — not merely unavailable, which is a transient failure
   to report and retry next run — repeat the exact-title match, and on exactly
   one match repair `owner-layer/documents.json` with the new id and continue
   with it. Zero or several matches keeps the refusal above. Without this, a
   document that was deleted and recreated would leave every later owner edit
   unfiled while each run reported the same failure.
2. Read both sides. `get_document(<id>)` gives the Linear side. The installed
   side is `../.mono-agent-workflow/docs/ru/<file>` resolved against the
   installed `mono-orchestrate` skill directory — `karta-paka.md` for the map,
   shipped from `docs/ru/karta-paka.md`, and `konstituciya-paka.md` for the
   constitution, shipped from `docs/ru/konstituciya-paka.md`. Never resolve
   that path against the product repository or a worker worktree: neither
   carries the installed copy.
3. Normalise both sides identically before comparing: LF line endings, no
   trailing whitespace on any line, every line beginning `Версия пака:`
   removed, a line whose first non-whitespace characters are an
   unordered-list marker (`- `, `* ` or `+ `) rewritten to the canonical
   marker `- ` while preserving the line's leading indentation, leading and
   trailing blank lines trimmed, exactly one closing LF. The marker step
   exists because Linear's document service rewrites every unordered-list
   marker to `* ` on every write — a property of the service, not of our
   files — so without it a document the owner has never touched would still
   show a difference on every run. This step applies to every line,
   including a line inside a fenced code block, so a marker-only edit
   hidden inside a fence is invisible to this comparison; the two
   owner-layer documents must therefore carry no fenced code block, and if
   one is ever added, Linear's marker-rewrite behaviour inside it must be
   measured before this rule can be trusted there. The third observed service
   rewrite is a bare Linear issue key (for example `MONO-57`) becoming link
   markup on write; this rule does not canonicalise issue links, so owner-layer
   documents must carry no bare Linear issue key, and if one appears, measure
   the service's behaviour before trusting the rule there. Hash each
   normalised text with SHA-256. Equal hashes mean this document is
   synchronised and nothing further happens for it.
4. A difference is an owner edit waiting for work. Take the reconciliation
   snapshot of that document:
   - `document id` — the Linear id from step 1;
   - `base hash` — the SHA-256 of the normalised LINEAR document as this
     reconciliation read it just now: always a fresh `get_document(<id>)`
     read, never the text a step believes it sent or is about to send. The
     publication step in `skills/mono-deploy/SKILL.md` compares against
     exactly this value later, which is how it tells a document the owner
     has not touched since from one edited after the snapshot;
   - `diff hash` — the SHA-256 of the unified diff between the normalised
     installed copy and the normalised Linear document. It names this
     difference, and it is what holds one difference to one draft.
5. One filed record per difference hash. Before creating anything, look for a
   record that might already carry this diff hash — the draft Issue on the
   issue-only lane, the intake Project on the Project-first one. Search by
   the document id instead of the diff hash: Linear's issue search does not
   find a 64-character hex hash in a body, while it finds a dash-separated
   UUID precisely — a property of the search, not of our data. Confirm a
   candidate only by READING its body and requiring both the same document id
   and the same diff hash in its «Снимок контекста»; result rank is never
   confirmation, only the read body is. An empty or irrelevant search result
   is NOT proof that no record exists, and nothing may be created until the
   document-id search has been run and its candidates read. A search that
   errors, times out, or returns a partial or unreadable result is not an
   empty result either: only a search that completed and whose candidates
   were fully read may be treated as returning none that confirms. When a
   candidate confirms this way, create nothing and change nothing: the
   difference is already filed, and a later start with the same diff hash
   produces no second record. A found record confirms the difference
   regardless of its lifecycle state: canceled means the difference was
   considered and rejected, closed means it was already carried over, and
   neither is filed again; if the owner returns to a rejected difference,
   they edit the document again and a record is filed only for a DIFFERENT
   normalised difference with a new diff hash, while the previous diff hash
   remains confirmed regardless of the later edit because the hash is
   computed from the normalised difference, not from the fact of editing.
   Create a new record only when the document-id search and its candidate
   reads above find none that confirms.
6. File it through the ordinary intake, never by hand. Which lane applies
   decides what is created, and each lane keeps its own approval boundary:
   - one PR, and the issue-only conditions are met → `mono-issue`. Its
     create-then-approve transaction produces the non-startable draft Issue
     itself, and the snapshot goes into that Issue's «Снимок контекста».
   - anything larger → the ordinary Project-first intake, `mono-idea` and then
     `mono-handoff`. That lane creates no execution Issue before package
     approval and this step never asks it to: the filed record is the intake
     Project opened for this request, the snapshot is recorded on it, and the
     Issue the approved package later creates carries the same snapshot
     forward into its own «Снимок контекста».
   In both lanes the instruction is the Russian text the owner wrote: carry the
   edited article or map entry verbatim and do not translate it. Write the
   snapshot of step 4 as three labelled lines, so the publication step can
   recover it from Linear alone. The local `owner-layer/<file>.snapshot.json`
   cache under the orchestrator root only speeds up the next read; when cache
   and Linear disagree, Linear is right.
7. Confirm the record before treating the difference as filed. A Linear write
   can return success and apply nothing, so read back whatever you just created
   and require the snapshot to be present in the body you read back. Until that
   read-back succeeds the difference is NOT filed: say so in the status and let
   the next reconciliation file it again. A pending owner edit that disappears
   silently is the one failure this step exists to prevent.
8. Nothing filed here is startable. It is created without approval and is
   activated only through the ordinary path of its lane — review, fingerprint,
   and the owner's explicit «ок» for issue-only; package approval for
   Project-first. Editing a document is not an approval, and this step never
   moves an Issue into a started state.
9. Report the outcome in the status line «Конституция и карта:
   синхронизированы | <N> правок ждут» of `templates/orchestrator-brief.md`,
   counting the filed differences. A document that could not be compared and a
   difference that could not be filed are named in that line too, in product
   language.

At session start, resolve [role:orchestrator](references/model-policy.md#roles)
and perform the self-check from `references/model-policy.md` using authoritative
launch-environment data. Beside «Конституция и карта» report
«Модель оркестратора: по политике | не по политике | не удалось проверить».
Absent authoritative data means «не удалось проверить»; prompt self-identification
never proves a match and this status does not switch the running session.

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
   - Compare the owner-layer documents with their installed copies and file
     each pending owner edit as one non-startable draft (Owner-layer
     reconciliation above); do this before the status, which carries its
     result. Run the same step whenever the owner says «сверь конституцию» or
     «сверь карту».
   - Output the rebuilt status (the «Статус» shape from
     `templates/orchestrator-brief.md` with its «Техника» table) before
     taking new actions.
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
     or session rotation, create its empty attempt log, fsync that file and
     its `logs/` directory, and only then atomically pre-register
     `registryEntry.gates` as the exact non-empty, unique list of gate names
     dispatched for THAT attempt alongside `stage`, `log`, pack
     identity, publication-time `spawned_at`, `thread_id: null`, and `pid: null`.
     The worker process starts only after that durable write succeeds. After
     `thread.started`, update the
     same entry with verified live identity while preserving `log` and `gates`;
     retire an inactive entry when spawn fails. The watcher recognizes the
     null-identity entry as inactive startup and keeps any output quiet for one
     stall-threshold window measured from `spawned_at` until a valid
     `thread.started` arrives. At timeout it emits `spawn-fail`. A missing,
     invalid, or more-than-five-seconds-future timestamp emits `spawn-fail`
     immediately rather than entering `dead` healing. The watcher reads at
     most 256 KiB of that log per pass and resumes from its cursor on the next
     pass, preserving later `thread.started` detection without blocking other
     workers. At timeout it freezes the observed log size and finishes that
     snapshot before declaring `spawn-fail`; subsequent appends cannot prolong
     the decision. `--once` completes the snapshot through additional bounded
     passes in the same invocation, and timeout comparison uses elapsed
     milliseconds without rounding upward. A missing or unreadable attempt log also emits
     `spawn-fail`.
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
   - Resolve worker roles and both policy values per Worker model selection
     in `references/orchestration.md`. Select `worker-complex` only by judgment
     for this dispatch, with the reason recorded under «Решил сам:»; never
     derive it automatically from risk class. Record the selected role, policy
     intent, actual launch parameters and transport case in the dispatch and
     registry per `templates/orchestrator-report.md`. Do not backfill legacy
     records; preserve existing launch pins on resume.
   - For `codex-cli` and `fallback` transports, create the worker's worktree
     before spawn per `references/orchestration.md` Worker Transports.
   - Verify every spawn per Worker Transports in
     `references/orchestration.md`: prompt passed as a file, `thread.started`
     in the log within 60s (else kill+retry), attempt-numbered logs from
     `-a1`, model and reasoning effort pinned in the command.
   - Record every spawn in `workers.json` (transport, thread id, worktree,
     branch, stage, `packVersion`, `sourceCommit`, `surfaceRevision`, the
     optional `product_name` — this Issue's product-language name, recorded
     whenever owner-facing statuses use one — and the
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
   - Follow the Monitoring Protocol in `references/orchestration.md`. Do not steer an actively progressing worker.
   - Before processing any report event or poll, and before any heartbeat event
     enters the common healing ladder, perform the stage-aware
     `registryEntry.gates` shape check. This check preempts report routing and
     stage advancement: when a malformed or forbidden-presence branch applies,
     do not accept that attempt's report. A malformed present value
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
   - Read reports only after that stage-aware check; advance the same worker
     session to the next stage (`mono-implement` → `mono-preflight` →
     `mono-ship`). For `codex-cli` workers advance the same thread with
     `codex exec resume` and treat process exit plus report as the normal
     advance signal (liveness ladder in `references/orchestration.md`).
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
  installer-published `../.mono-agent-workflow/scripts/wave-cost.mjs
  <ISSUE-KEY>` from this installed skill directory for each Issue with logs,
  and copy its final Russian line verbatim after the `Цена волны:` label. If
  collection fails, write `unavailable: <reason>` instead of estimating. The
  final wave report carries the same lines in its «Цена волны» block, per the
  Cost Telemetry policy in `references/orchestration.md`. Cost is telemetry,
  not a gate: it never blocks, pauses, delays a stage, or pages.
- «Нужно от тебя:» is always the last block: decision briefs per the
  template, each under the board-aligned ID of its own board section
  (`1a-…`), or «нет».
