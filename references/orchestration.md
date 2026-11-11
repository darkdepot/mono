# Orchestration Policy

Control-plane policy for `mono:orchestrate`: inspect, delegate, monitor, decide,
record and report. Delivery code stays in implement/preflight/ship workers.
Pre-delivery stages run the same skills in stage agents, with the orchestrator
answering as the delegated owner; a stage session owns its artifact and read-back.

## Parts

This file is the always-read part of the policy. The other parts load by
moment; a section named in the skill or in another part lives in the part
listed here. A condition describes state, not a one-time event: a part that
left context after compaction is read again when its condition holds.

| Part | Read when | Sections |
| --- | --- | --- |
| `references/orchestration-stages.md` | before launching or answering a pre-delivery stage agent, and before any `by=orchestrator` record | Director Discovery; Stage agent permissions and visible dialogue; Approval countercheck with Second Voice and Pre-write package review |
| `references/orchestration-dispatch.md` | before any worker dispatch, spawn or resume, and while a registry entry still carries startup `gates` or an unconsumed gate ack | Orchestration Mode Precedence with the dispatch command; Snapshot Markup Contract (U12); Two-Phase Dispatch Handshake; Worker Transports; Pre-application by mandate |
| `references/orchestration-delivery.md` | before the watcher starts, while `workers.json` holds an entry or a worker report, capsule or queued write is unreconciled, and before QA, merge or deploy of a shipped Issue | Independent QA before merge; Deploy and closeout; Monitoring Protocol; Review rounds; Delivery Write Barriers; Heartbeat |

## Roles

- Owner: always approves Idea, first-product exemplars and new taste-memory rules;
  may reopen any approval by speaking in the orchestrator chat.
- Orchestrator: one product session; dispatch, monitoring, technical decisions,
  ledger and deploy. Single Linear writer only for implement/preflight/ship workers,
  which queue their mutations in reports. Stage agents write their own records.
- Stage agent: one stage, its own dialogue and tools, confirmed record and selected
  transition returned to the orchestrator. Never starts the next stage or stage agents.
- Worker: one Issue, `mono:deliver` phases under the AFK contract, no direct Linear writes.

## Stage Ownership

| Stage | Runs in |
| --- | --- |
| `mono:idea` | stage agent; orchestrator shows owner its description verbatim as its final message and relays the shown text, question and verbatim owner reply |
| `mono:research` | stage agent after authorized start; no owner questions or separate approval |
| `mono:discovery` | stage agent; orchestrator answers with reasons and approves the shown PRD |
| `mono:design` | stage agent when routed; first-product exemplars and taste consent remain with owner |
| `mono:tech-evaluation` | stage agent when routed; orchestrator approves the shown page with a reason |
| `mono:handoff` | stage agent after required stages; records package, then authorized work start |
| `mono:implement`, `mono:preflight`, `mono:ship` | delivery worker session |
| `mono:deploy` | orchestrator session |

Gates in `references/lifecycle.md` keep their owners and order; no waiver.

## Decision Authority

Delegated Project: latest Idea approval's outside-fence line
«Ведёт оркестратор: владелец принёс идею оркестратору <дата>.». Repeat on Idea
reapproval. The owner's explicit words handing the Project over («веди сам») also
delegate it: write them verbatim as a Project comment at once; delegation starts
from that comment. Without either the owner leads: only owner starts
Research and work (`by=owner`). Do not add `by` to strict `mono-idea` records.
A `stale`/`legacy-migrate` Idea stops autonomous Research/work despite delegation:
carry it to owner for approval in words on the shown version, confirmed new record and fresh check first.
The orchestrator's reply or bundled start cannot approve that Idea snapshot.
Only delegated Projects with that current approval allow autonomous Research/work,
write start `by=orchestrator` with a reason, answer and approve after Idea, including
irreversible, deferred and contrary-to-owner decisions. Stage approval does not
execute external writes or spending. Configured merge/release/deploy policy (`deployApproval`) stays.

Before each `by=orchestrator` record apply the Approval countercheck in
`references/orchestration-stages.md`. The owner keeps
Idea approval, first-product exemplars and consent to new taste rules. Their words
reopen any approval. Owner-led stage sessions never accept another agent's reply
as approval; the sole exception is a stage launched by the orchestrator, never Idea.

Narrow control-plane exception: an explicit owner mandate may permit operational
and deploy-repair changes (scripts, infra config, docs sweeps), recorded in the ledger
with that mandate; feature code always routes through delivery workers.

## Mailbox And Ledger

- Root: `~/.mono-agent-workflow/orchestrator/<product>/` — never inside a
  project repo (project repos keep only `.agents/mono-workflow.config.json`).
- Reports: `reports/<ISSUE-KEY>-<stage>.json` per
  `templates/orchestrator-report.md`. Workers write reports; the orchestrator
  reads them instead of parsing worker transcripts.
- Ledger: `ledger.md` — dated, high-level entries: dispatches, «Решил сам:»
  decisions, user decisions, lands, deploys, exact blockers. Only the
  orchestrator writes the ledger.
- Ledger format, mandatory:
  - One event per line, appended in write order; the timestamp is the
    actual moment of writing (ISO 8601 with timezone offset). Recording an
    event under the time it "should have happened" is forbidden. An event
    noticed late keeps its append position, carries the true write-time,
    and adds a `recorded-late` marker with the estimated event time
    (wave-1 precedent: a "07:50 respawned, thread live" entry written at
    11:43 hid a 4-hour idle gap from the final wave report).
  - Only observed facts: never record an action as done before observing
    its effect. A dispatch is recorded only after `thread.started` is
    parsed, a Linear mutation only after its read-back per Linear Write
    Verification — never on intent.
  - Corrections are new lines that reference the corrected entry; editing
    or rewriting existing lines is forbidden.
  - Any orchestrator idle or stall longer than 5 minutes — waiting on
    quota, on the user, or on its own scheduling — is a mandatory ledger
    entry with the cause. These entries feed «Что пошло не так:» in
    status updates and the final wave report.
- Worker registry: `workers.json` beside the ledger — orchestrator-owned
  runtime metadata, one entry per Issue: `transport`, `thread_id`,
  `worktree`, `branch`, `stage`, `spawned_at`, `last_activity_at`, `log`
  and `pid`, plus the dispatch `packVersion`, `sourceCommit`, and
  `surfaceRevision`, plus the optional `product_name` — the product-language
  name this Issue is called by in owner-facing statuses — and optional
  attempt-scoped `gates` only for the current
  gate-carrying `mono:deliver` attempt (shape and validity in
  `templates/orchestrator-report.md`). Updated on
  every verified spawn, resume, session rotation, phase transition, and respawn
  under the immediate-update rule in Worker Transports; workers never touch it.
- Product control: `control.json` beside `workers.json`, with the exact shape in
  `templates/orchestrator-report.md`. The orchestrator owns the lifecycle
  `active` → `draining` → `idle`: use `active` while dispatch is allowed,
  `draining` when no new work may start but registered workers are closing, and
  `idle` only when the active registry is empty. Incompatible-update quiescence is
  exactly `idle` plus an empty `workers.json`; verify it with
  `verify-pack-state.mjs quiescence`. Missing either condition blocks.
- Report delivery under a write sandbox: the mailbox root is writable for
  `codex-cli` workers via `--add-dir`. If a mailbox write is still denied,
  the worker writes the same JSON to
  `<worktree>/.orchestrator/<ISSUE-KEY>-<stage>.json` (never committed); the
  orchestrator sweeps both locations.
- Logs: `logs/<ISSUE-KEY>-<stage>-a<attempt>.jsonl` per spawn attempt,
  numbered from the first attempt (`-a1`) — the worker's JSONL event stream;
  the timestamp of the last event is the liveness heartbeat.
- No secrets in any of them. No routine polling entries in the ledger.

## Linear Write Verification

Verify-after-write, mandatory for every Linear mutation the orchestrator
applies: after the write, read back the mutated entity and confirm the
change actually applied — a success response alone is not confirmation.
Wave-1 precedent: `save_project` returned success while the project status
stayed unchanged (silent success-no-op). On a failed read-back, retry the
mutation once; if the read-back still shows the old state, record a ledger
failure entry naming both attempts and treat the mutation as pending —
never report it as applied.

## Decision Briefs

Never bring the user an unprepared question. Before asking:

1. Exhaust autonomous work; ask only when the question is the item's last
   blocker.
2. Prepare visual variants for design questions.
3. Refresh item state immediately before asking; never re-ask an answered
   question and never present a stale item as decision-ready.

Brief contents per `templates/orchestrator-brief.md`: what changes and for
whom, why the decision is needed now, completed proof (tests, autoreview, CI,
certificates as applicable), recommendation with rationale, exact options.
Ask immediately and interactively; unblocked work continues in parallel.

Brief integrity — five rules bind every decision brief; the
user-facing shapes live in `templates/orchestrator-brief.md`
(«Целостность брифа»):

- Question IDs mirror board section IDs exactly. Multiple questions
  inside one section get section-scoped suffixes (1a, 1b).
  Cross-section renumbering is forbidden.
- Every option carries a self-identifying token rendered on both the
  board and the brief (e.g. «1a-КАРТОЧКА / 1a-МОДАЛКА»); an answer is
  valid without its number when the token or the verbatim option text
  identifies it.
- Echo-back: before acting on answers, the orchestrator posts a mapping
  table «вопрос → выбранный вариант (дословно)»; an answer whose text
  does not match the addressed question's option set is a numbering fault
  and requires a mandatory one-line re-confirm before any work on that
  item.
- An item routed to a checkpoint as contested is never closed by silence:
  no answer means asked again, not resolved. A fallback line never
  resolves a contested item.
- Any spec or record change after the owner's start that alters user-visible
  behavior appears as an explicit «Изменилось после твоего одобрения:»
  delta list at the next owner touch, never only as a fait-accompli
  status line. When in doubt whether a change is user-visible, include
  it in the delta.

## Context Budget

Orchestrator session context usage is a first-class operational metric,
not an implementation detail. Wave-1 precedent: the session peaked at 92%
of a 1M-token window with no signal to the owner.

- Report current usage as «Контекст: ~N%» in every status update; a rough
  estimate is fine — the trend matters more than precision.
- Compaction-first is the default: keep one orchestrator session and set
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75` in the product's local Claude
  settings so automatic compaction begins at 75% context usage.
- The safe-boundary sentinel is `<orchestrator-root>/compaction-safe`. After
  every stage close and every ledger write, the orchestrator touches this
  file only after the durable state is current. The sentinel is fresh for
  300 seconds by default; an absent or stale sentinel never authorizes
  automatic compaction. The freshness window is configurable in
  `templates/orchestrator-compaction-hook.sh`.
- Wire the template's `PreCompact` hook for automatic compaction. It blocks
  outside a fresh safe boundary for at most three consecutive deferrals;
  the fourth automatic attempt is forcibly allowed and resets the counter,
  preventing context-window starvation. Manual compaction is always
  allowed, and a fresh sentinel also resets the counter.
- Use `templates/compact-instructions.md` for the compaction summary. As the
  first post-compaction action, re-read the tail of `ledger.md`,
  `workers.json`, and the product's memory index before monitoring,
  dispatching, mutating Linear, or answering from the compacted summary.
- A session handoff through the Resume procedure is an exceptional fallback
  for a corrupted/unrecoverable session or a compaction that cannot preserve
  safe state. It is not the default response to a context threshold.

## Cost Telemetry

Per-Issue collection, performed by the orchestrator:

- Worker tokens: count every Codex `turn.completed` or Claude Code `result.usage`
  event in every attempt log of
  every stage (`logs/<ISSUE-KEY>-<stage>-a<attempt>.jsonl`). A Codex log whose
  counters never decrease reports thread totals (logs from 30.09.2026 on:
  16.3M → 22.0M → 26.9M … 107.9M in one resumed thread), so its last event is
  the attempt; a log that reports each run separately (516,590 → 433,845 →
  5,072,542) is summed. `wave-cost.mjs` shows the choice as `counting`. Keep input, cached
  input, and output separate; cached input is a subset of input and must not
  be added to it again. Include respawned, parked, and failed attempts, and
  deduplicate attempt files by their canonical path. Claude cache reads and
  creation are included in normalized input. A missing final result preserves
  unavailable/incomplete coverage across continuations; never replace it with zero.
- Review cycles: the count of review submissions handled during the ship
  stage, taken from the ship-stage report and PR review history.
- Stage wall-clock: derived from the ledger's write-time entries for stage
  dispatch and stage close; honest write-time discipline (see Mailbox And
  Ledger) is what makes this derivable. For `recorded-late` entries, use
  the marker's estimated event time, not the late write-time.

Record the collected numbers per stage in the ledger at stage close; a
  missing number is recorded with the reason it could not be collected, on
the same stage-close entry or an adjacent line. Judgment note, stated
honestly: collection is manual agent work — reading logs, counting review
submissions, subtracting timestamps — not a pin-enforceable mechanism;
pins can anchor this policy text, not the collection itself.

Cost is telemetry, not a gate: no thresholds, no blocking, visibility
only. Never pause, steer, or fail a worker because of cost numbers, and
never let cost collection delay a phase transition; a missing number is
recorded as unavailable, never blocks, and never pages the user. Cost
data feeds status updates and the final wave report per
`templates/orchestrator-brief.md` («цена: …» per Issue, «Цена волны» for
the wave) — async-visible records for the owner, nothing more.

## Resume

A fresh orchestrator session rebuilds state without loss:

1. Read the project config; locate the mailbox root.
2. Scan Linear: projects in flight, Issue statuses, latest comments and
   certificates. Separately query open parentless Issues carrying the verified `issue-only` label. For every returned candidate, re-read its body, current
   marker comment, authenticated owner-approval comment, and project config,
   then re-run the 5-field context seam with the freshly emitted whole-body
   fingerprint. Only `package_kind=issue-only` plus `approval_status=approved-fresh` is resumable as an issue-only package.
   Missing label or marker is not discovered as issue-only; a broken/stale
   marker, missing authenticated approval, or closed status is excluded. Any
   unverified reconstruction fails closed and is excluded from the issue-only queue. This
   scan adds parentless issue-only discovery only; it does not change dependency
   ordering or reclassify any fail-closed result.
3. Read ledger, phase capsules and mailbox reports; reconcile every queued write against Linear and apply only missing writes through Delivery Write Barriers. Never replay a queue from local receipts alone.
4. Corroborate key ledger claims — dispatches, phase transitions, deploys —
   against worker log and report timestamps. A ledger line with no
   supporting evidence is marked unverified and its state is re-derived
   from Linear plus logs instead of being trusted. This is a judgment rule
   for the resuming session, not a pin-enforceable check: it defines how
   much to trust the ledger, not a mechanical validation.
5. Read `workers.json` and list live worker sessions when the runtime allows
   it. Consult `consumed/` only when `registryEntry.stage` is `mono-deliver`
   and the CURRENT registry log basename is
   `<ISSUE-KEY>-mono-deliver-a<N>.jsonl`. Before clearing any stale
   `registryEntry.gates`, parse the CURRENT
   attempt `<N>` from that entry's `log` and require the private orchestrator
   consumption record. First successfully fsync the orchestrator-root directory
   that contains `consumed/`, even when the namespace already exists, and then
   fsync the existing `consumed/` directory. The first sync completes any
   interrupted namespace creation; the second completes any visible record
   rename whose earlier directory sync failed. If either sync fails, stop with
   the ack and registry unchanged. Then read
   `<orchestrator-root>/consumed/<ISSUE-KEY>-gate-ack-a<N>.json` for the SAME
   current `<N>`. Only a well-formed record in `consumed/` whose `issue`,
   `attempt`, and `outcome` match this Issue, current attempt, and one of
   `applied | rejected | blocked` authorizes removal. A fabricated record in
   `reports/` never authorizes cleanup. Neither does a tombstone in either ack
   location, including the worker-writable fallback. A missing, malformed, or
   other-attempt private record leaves the ack and `gates` in place; reconcile
   the current attempt or verified-respawn a new attempt, whose spawn
   registration rewrites the field. When a current-attempt private record exists but an unconsumed ack
   candidate remains, finish every in-place rename selected by its `outcome`
   before removing `gates`. This is the crash recovery for every window between
   outcome publication, ack rename, and the separate registry deletion.
   If that current-attempt record has `outcome: rejected`, the attempt is
   durably terminal even after its ack was renamed and `gates` was removed.
   Resume skips same-attempt nudge and verified-respawns a NEW gate attempt
   with its own correct list before the ordinary no-ack ladder can run.
   Compare each entry's `surfaceRevision` with the currently installed
   plugin identity before using its thread id. When surfaceRevision differs, do not rebind
   or resume that thread; report it blocked and start a new attempt.
   Otherwise find surviving `codex-cli` and `claude-cli` workers by thread id;
   keep a live writer, and resume only a cleanly stopped one
   through installed scripts/orchestrator/resume.mjs instead of respawning them.
6. Output the rebuilt status table before taking any new action.

Forced mid-wave resume drill — a planned one-time operational act,
not a recurring gate: during the next wave the orchestrator deliberately
performs a clean handoff to a fresh session mid-wave, at a safe boundary
per Context Budget (after the current monitoring pass or phase transition
completes, never mid-dispatch), runs this Resume procedure for real, and
records every reconstruction discrepancy in the ledger — unverified
ledger claims, lost thread bindings, unapplied Linear mutations, report
gaps; "no discrepancies" is a valid result only after actively looking.
The drill result feeds the PRD wave-1 success criteria. Before scheduling the drill, check the ledger and PRD for a completed-drill record and skip if one exists — it is one-time, not per-wave. Rationale: the
wave-1 orchestrator session peaked at 92% of a 1M context window and a
forced mid-wave resume has never been tested.
