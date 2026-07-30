# Orchestration Policy

Control-plane policy for `mono-orchestrate`. The orchestrator inspects,
delegates, monitors, decides or escalates, records, and reports. It never
implements stage work itself.

## Roles

- User: product decisions only — idea direction, scope, design, product risk,
  deploy approval per policy. Talks only to the orchestrator session.
- Orchestrator: one session per product; owns worker dispatch, monitoring, all
  Linear mutations during orchestration, technical decisions, deploy
  delegation, and the ledger.
- Workers: one Issue each; run `mono-implement` → `mono-preflight` →
  `mono-ship` sequentially in the same session and worktree under the AFK
  contract from `templates/orchestrator-dispatch.md`; they never write to
  Linear directly.

## Stage Ownership

| Stage | Runs in |
| --- | --- |
| `mono-idea`, discovery | orchestrator session (Director Discovery) |
| `mono-handoff` | orchestrator session |
| `mono-implement`, `mono-preflight`, `mono-ship` | worker session |
| `mono-deploy` | orchestrator session |

Gate ordering from `references/lifecycle.md` is preserved verbatim. The
orchestrator sequences gates; it never skips, weakens, or replaces them, and
stage skills keep their ownership unchanged.

## Decision Authority

The user decides. Escalate immediately and interactively with a decision
brief (options + recommendation):

- Idea direction and scope: handoff package approval, Issue slicing, scope
  drift.
- Design and UX: always with prepared side-by-side variants (`/design-html`
  when the runtime provides it; concrete textual variants otherwise). Under
  Director Discovery, batch design/UX escalations into the UX checkpoint
  unless they block discovery from continuing.
- Product risk: money, user data, irreversible production actions, external
  access.
- Deploy approval when the configured `deployApproval` policy requires it
  (`always`, or any risk class except `tiny` under `risky-only`; only `tiny`
  proceeds without asking).

The orchestrator decides itself and records every such decision in the ledger
under «Решил сам:» with a one-line reason:

- All technical and implementation questions from workers.
- Implementation start after package approval (recorded explicitly; the
  bundled-approval rule from `mono-implement` applies).
- Technical review-finding acceptance, CI repair, and PR stabilization
  routing.
- Merge/deploy for risk classes the configured `deployApproval` allows (all
  classes under `never`).

Narrow control-plane exception: under an explicit owner mandate the
orchestrator may author operational and deploy-repair changes directly —
deploy scripts, infra config, docs address sweeps. Every such change is
always recorded in the ledger as a control-plane exception naming the
mandate; feature code never qualifies and always routes through workers.
Wave-1 precedent: deploy-repair ops PRs authored under the owner's explicit
«исправь» mandate and honestly ledgered.

The user can override any recorded orchestrator decision later; reopen the
affected stage when that happens.

## Director Discovery

Discovery under orchestration runs in director mode: the user is the
advisor, the orchestrator is the product director. Discovery skills
(`/office-hours`, `/brainstorming`, `/plan-design-review`,
`/plan-eng-review`) are interrogative — they extract decisions from their
operator. Under orchestration the interrogative side runs as a Second
Voice — an independent reviewer agent per the protocol below — and the
orchestrator answers as product director, grounded in the Linear brief,
repo and product context, and prior user answers. It never relays a
discovery-skill question stream to the user.

- Material product choices made this way are recorded under «Решил сам:»
  and surface in the package-approval brief, where overriding any of them
  is a valid answer.
- Genuinely contested items (per the Always-ask list) are collected and
  batched into the UX checkpoint or the package-approval brief; interrupt
  discovery only when the item blocks it from continuing.
- When a named discovery skill is not available in the current runtime,
  run an equivalent review pass over the same ground (product,
  engineering, and design lenses) through the Second Voice — a missing
  skill does not license in-session self-review while an agent binding
  exists — and record the substitution in the discovery notes.
- Second Voice and lens reviews run as agents per the Second Voice
  protocol below; findings return to the orchestrator, never to the user
  directly. Workers remain barred from spawning anything.

Checkpoints — the only moments that touch the user:

1. Intake direction questions: 1-3 per idea per `mono-idea`; zero when
   the idea is already clear.
2. UX checkpoint (user-facing surface only): one brief per
   `templates/orchestrator-brief.md` with a reviewed near-production
   prototype and the few contested UX decisions.
3. Package approval: the existing single handoff brief, bundling the
   implementation-start option and the pre-write review verdict.
4. Deploy approval per the configured `deployApproval` policy.
5. Ad-hoc: risk acceptance and material scope drift — these never wait.

Prototype bar for the UX checkpoint: prepared via `/design-html` when the
runtime provides it (concrete textual variants otherwise), realistic
product content, correct states, side-by-side variants where a genuine
choice exists, and a design-lens Second Voice pass already applied
(in-session review as fallback) — the prototype is near-production,
never a first draft.

Multi-idea intake: the user may bring several ideas in one session. Run
`mono-idea` per idea, queue discovery, and run Director Discovery one
project at a time while dispatched delivery work continues in parallel;
show the discovery queue in the status table.

### Second Voice

A self-interview is an echo chamber. The interrogative side of discovery
is delegated to a Second Voice: an independent reviewer agent in a fresh
context that gets the product brief, Linear links, repo read access, and
the named discovery skill's question framework — none of the
orchestrator's reasoning. It plays interviewer for idea shaping
(`/office-hours`, `/brainstorming`) and critic for reviews
(`/plan-eng-review`, `/plan-design-review`); the orchestrator answers as
product director.

Model selection is mandatory and cross-vendor: the Second Voice runs on
a different model family from the orchestrator. A fresh context on the
*same* model is not a second voice — it inherits the same training,
biases, and blind spots and collapses into self-review (an Opus
orchestrator interrogating an Opus reviewer learns nothing new). Pick the
strongest available cross-vendor model, both sides at high reasoning;
never block discovery on a missing one.

- Orchestrator on a Claude model (Fable, Opus, Sonnet, …) → Second Voice
  = `gpt-5.6-sol` at `model_reasoning_effort="high"`, a fresh `codex
  exec` thread continued with `codex exec resume`. The thread is a
  reviewer, not a worker: no worktree, no Issue, no registry entry. Note
  the live thread id and round count in the discovery notes so a resumed
  orchestrator rebinds or deliberately restarts the dialogue — and ends
  orphaned reviewer processes — instead of silently losing it.
- Orchestrator on GPT-5.6 (`sol`, `terra`, `luna`) → Second Voice =
  Claude Opus (latest) at high reasoning, spawned via the Claude
  transport — the Agent tool's `opus` model in Claude Code, or `claude -p
  --model opus` from a Codex runtime — and continued via session messages
  to the same agent.
- Fallback, only when the cross-vendor model is unreachable (no Codex
  auth, or no Claude access): run the lens review in-session (product,
  engineering, and design lenses) and record the substitution and its
  reason in the discovery notes.
  A same-model Second Voice is not an acceptable fallback; an in-session
  lens pass is.

Dispatch shape per skill run: the reviewer role and the named skill; the
product brief and Linear links; repo read access; the instruction to
deliver questions and challenges as its final message — never through
user-question tools, there is no user on its side; and the required
closing verdict: strengths, top risks, contested items, recommendation.

Dialogue protocol: rounds of ask → answer → challenge, capped at 3
rounds per skill (guidance, not a gate). After the cap, unresolved
disagreements that are Always-ask class go to the user as checkpoint
items; the rest the orchestrator decides, recording both positions under
«Решил сам:».

Boundaries: the Second Voice never talks to the user, never writes
Linear, and never dispatches or steers workers; it is discovery work and
pre-write package review, not stage work. Both roles carry the same
boundaries: reviewing a draft package never grants it a Linear write, an
owner conversation, or any authority over workers.

### Pre-write package review

The orchestrator's `mono-handoff` state has one mandatory Second Voice run
that is not discovery: the drafted handoff package — draft Project brief,
draft PRD, draft Tech Spec, and proposed Issue slicing — goes to an
independent reviewer BEFORE the orchestrator writes any of it to Linear.
Order, not preference: synthesize the draft, review it, fix the draft, then
put it to the owner with the verdict already attached, and only then write.

- The reviewer is a discovery agent under the Second Voice protocol above —
  fresh context, cross-vendor model, no worktree, no Issue, no registry
  entry — and it has no Linear-write capability and no owner contact.
  Findings return to the orchestrator, which applies accepted fixes to the
  draft package.
- Obligation follows `references/readiness-gates.md`: required for
  `standard`, `deep`, and `risky`, advisory for `tiny` with the skip reason
  recorded. The orchestrator cannot decide this gate away under «Решил
  сам:»; only findings inside it are its to accept.
- The reviewed subject is the draft, so none of the drafted bodies — Project
  brief, PRD, Tech Spec, Issue slicing — is written to Linear at review time.
  The Project entity itself may already exist, and stays available to the
  reviewer as surrounding context; what is absent is the drafted content, not
  necessarily the container. That absence is expected and is never reported as
  a missing artifact, per the pre-write `handoff` mode in
  `skills/mono-review/SKILL.md`.
- Workers never run this review. They cannot spawn agents, and a worker is
  not independent of the package it was dispatched from.
- The package-approval checkpoint stays a single owner touch, because the
  verdict is already in hand when the brief is written.

## Orchestration Mode Precedence

Orchestration mode is any stage a worker runs from a dispatch built on
`templates/orchestrator-dispatch.md`. This section is the single home of the
rule; the dispatch template and the stage skills point here instead of
restating it.

- The dispatch snapshot is the single source of Linear state in orchestration
  mode. Wherever a stage skill tells the worker to fetch, re-read, or
  re-resolve fresh Linear state, in this mode that instruction means "use the
  dispatch snapshot".
- Wherever a stage skill tells the worker to move, comment on, update, or
  otherwise mutate Linear, in this mode that instruction means "produce the
  mutation in its required shape and queue it in `linear_mutations_pending`".
  The orchestrator stays the single Linear writer and applies it with
  read-back. Applying that queue is part of consuming the report, not a later
  chore: on every stage-terminal report the orchestrator applies each queued
  mutation and verifies it per Linear Write Verification BEFORE it advances
  the stage pipeline. Advancing a stage while a report's mutations are still
  unapplied is a contract violation — it strands the Issue in its previous
  Linear state with the stage's comments missing. The Resume-time sweep of
  unapplied mutations is a crash-recovery backstop, never the normal path.
- The same substitution applies to any condition a stage skill places on a
  read, not only to the instructions themselves. A deferred "Read when" entry
  whose condition names writing, recording, or moving something in Linear is
  satisfied in this mode by queuing that mutation. Write such a condition so it
  names the queued form too: a condition worded only for the interactive path
  silently excludes every orchestrated run, which is how a worker ends up
  composing an artifact without the contract that governs it.
- Split precedence by kind: where a dispatch and its stage skill disagree on a
  rule, the stage skill wins; where they disagree on a fact — identity pins,
  absolute paths, snapshot content, this-Issue constraints — the dispatch
  wins.
- Mode precedence changes who performs a Linear operation, never whether a
  gate runs. Every gate, gate ordering, exit status, and fail-closed rule of
  the stage skill applies unchanged. A snapshot that cannot satisfy a gate is
  a `blocked` report naming the missing input, never a skipped gate, an
  inference, or a question to the user.
- Queued mutations land only when the orchestrator applies them, and it reads
  the queue from a report — so a mutation queued during a stage lands at the
  stage boundary, and Linear lifecycle state lags the worktree for the length
  of that stage. State this lag plainly; do not describe a queued mutation as
  applied, and do not derive a verdict from state the mutation has not
  reached yet. The lag is a property of single-writer orchestration, not a
  licence to skip anything: every precondition a gate places on starting code
  is verified from the snapshot before code starts, and a mutation whose gate
  has not passed is never queued at all. A stage that genuinely cannot
  continue until a mutation has landed cannot get that in this mode and
  reports `needs-decision` for the orchestrator to sequence and resume —
  except for the dispatch-moment lifecycle moves, which Two-Phase Dispatch
  Handshake below sequences by protocol instead of by exception report.
- A stage's own lifecycle precondition is therefore sequenced by the
  orchestrator around the gate phase of the two-phase dispatch handshake —
  applied after the worker's gate-ack and before that worker is resumed for
  execution — never queued from inside the stage and stepped over. Dispatch
  `mono-implement` with the Project not yet in Delivery and move it on the
  gate-ack, so the state the worker executes from is the post-move state its
  resume amendment names. Inside the gate phase a snapshot showing an unmet
  dispatch-moment lifecycle precondition is the expected state, not a
  finding; after resume, an amendment that still shows that move unapplied is
  a hard stop. No stage defers an executable check onto a queued mutation
  entry: this mode has no protocol that would carry one, so a check the
  snapshot cannot answer is sequenced by the orchestrator, never left as
  descriptive text in a report.
- Interactive mode is unchanged: a stage run without a dispatch reads and
  writes Linear directly exactly as its stage skill says.

### Generated dispatch as audience adapter

The stage skills are one surface for every worker model. The generated dispatch
is the per-Issue layer that adapts it, so safety redundancy is tuned here and
never by editing a skill for one model's benefit. Two rules bound this:

- The dispatch may repeat, resolve, and enumerate. It may not soften, reword,
  or replace a rule. Split precedence above still holds — the skill wins on
  rules, the dispatch wins on facts — so a redundancy that paraphrases a gate
  is a defect, not an adaptation.
- The skill's tier-1 "Read now" ladder is a floor, not a ceiling. A dispatch may
  promote a "Read when" entry into a required read for that run when it knows
  the condition already holds; it may never demote a tier-1 entry.

Set `orchestration.workerAudience` in the project config (`gpt-worker` |
`claude-5`; default `gpt-worker`, which is the safe direction). It selects how
much redundancy the generator emits:

| Dispatch element | `gpt-worker` | `claude-5` |
| --- | --- | --- |
| Identity gate: fully resolved command literal, exit-0 success string, the confusable-pin warning | carried | carried |
| Byte-frozen paths with their expected hashes; the exact protected-surface list | carried | carried |
| Verification surface: one runnable command per item, or the item marked as a judgment check | carried | carried |
| Restating AFK gates the skill already binds — single-writer, no sub-delegation, never-ask, report-before-stop | restated inline | one pointer line to the stage skill and this section |
| Stage-terminal status semantics (`blocked` vs `needs-human` vs `needs-decision` vs drift) | restated as an explicit decision list | named only where this Issue makes one likely |
| Worked output shapes (comment, certificate, report skeletons) | inlined in the dispatch | referenced by path, composed at write time |
| Per-step ordering the skill already fixes | re-enumerated | omitted |

The reason the two columns differ is a measured difference in failure mode. A
strongly rule-following worker fails by omission, which restatement fixes. A
strongly synthesizing worker fails by anchoring on the nearest worked example
and producing something well-shaped and partly invented, which restatement does
not fix and inlined examples make worse. Every row above still carries the same
obligations to both audiences; only where the text lives changes.

Anything a worker cannot execute without guessing — an absolute path, a command
literal, a hash, a confusable pair of values in play — is carried in full to
both audiences. Facts are never compressed for either column.

## Two-Phase Dispatch Handshake

**No dispatch-moment lifecycle move is applied before the worker's gate-ack.**
This section is the single home of that rule and of the protocol that carries
it; the dispatch template, `mono-implement`, and `mono-orchestrate` point here
instead of restating it. The only exception is an explicit owner mandate
naming the move, recorded in `ledger.md` as a deviation with that mandate
quoted — and it is NOT available under «Решил сам:», so the orchestrator can
never grant it to itself.

Dispatch-moment lifecycle moves are the moves a dispatch itself carries: the
Project → Delivery move of a project's first `mono-implement` dispatch, and
the Issue-to-started move that activates an issue-only Issue. Applicability
follows from that: only a dispatch carrying such a move runs the handshake.
`mono-preflight` and `mono-ship` advances carry no lifecycle move, so they are
dispatched and resumed exactly as before, with no gate phase.

Order, and it is the whole protocol:

1. Gate-phase dispatch. The orchestrator emits the dispatch with the pre-move
   snapshot — Project not yet in Delivery, or Issue not yet started — and the
   dispatch template's Gate Phase block filled in. It applies no lifecycle
   move yet, and the pre-move snapshot is correct, not stale.
   Before the worker process starts, atomically pre-register an inactive
   current-attempt entry
   with the empty attempt-numbered `log`, exact dispatched
   `registryEntry.gates`, pack identity, `thread_id: null`, and `pid: null`.
   Start the worker only after that durable write succeeds; after
   `thread.started`, update the same entry with verified live identity while
   preserving `log` and `gates`.
2. Worker gate phase. The worker runs steps 1-4 of the orchestration branch of
   `start-checkpoint` in `skills/mono-implement/SKILL.md`: pack identity gate,
   snapshot package context, approval plus `mono-review handoff` findings, and
   the 5-field context seam. On the issue-only lane it also evaluates the
   delivery check there, because that check gates the move this dispatch
   carries. This is the stage's own opening, not a separate pre-stage: the
   same session, worktree, dispatch, and stage continue into execution.
3. Gate-ack, then stop. The worker writes
   `reports/<ISSUE-KEY>-gate-ack-a<N>.json` under the orchestrator root, where
   `<N>` is the attempt number this dispatch's log carries, and then stops —
   what "stops" means depends on the ack's own status. On `gates-passed` it
   stops without queuing or applying the move, writing code, or producing a
   stage report. On `blocked` the gate phase is over rather than paused, so it
   writes the stage report the Blocked path below requires — ack first, then
   report — and stops only after both exist. Leaving a blocked ack with no
   report would strand the Issue: the orchestrator would wait for a report that
   never comes while the watcher's bounded ack handoff eventually expires and
   drives the worker into liveness healing instead:

   ```json
   {
     "issue": "<ISSUE-KEY>",
     "phase": "gate",
     "gates": [
       { "gate": "<gate name>", "status": "pass | blocked", "evidence": "<one line>" }
     ],
     "status": "gates-passed | blocked"
   }
   ```

   `gates` is non-empty and carries each reported gate name exactly once.
   For `gates-passed`, its set of names equals this dispatch's gate list
   exactly. For `blocked`, it may be a non-empty subset of that list because
   later gates may not have run, but it must contain no foreign name. A
   repeated name is invalid in both branches.
   `gates-passed` requires every entry to be `pass`, so an ack that claims
   `gates-passed` while carrying a blocked, duplicated, or missing gate
   is self-contradictory
   and is treated as no ack at all. The invariant runs both ways: `blocked`
   requires at least one entry that is not `pass`, because an ack claiming
   `blocked` over gates that all passed is consumed as a real refusal and
   strands a dispatch whose gates actually passed.

   The ack is numbered by attempt for the same reason the logs are: an ack
   belongs to the writer that produced it, and timestamps cannot tell
   overlapping writers apart. A superseded attempt that is still alive can
   write after its successor's log was born, and a shared path would let that
   ack look current for the successor — the orchestrator would then apply the
   moves and resume a worker on gates that worker never ran. A retry carries
   the same gate names, so no set-equality check downstream would catch it
   either. The attempt number is what binds an ack to its dispatch attempt.

   The gate-ack is not a stage report: it has its own path, its own two-value
   `status`, and it neither uses nor extends the `verification_items` enum.
   The Worker Report shape and gate-ack shape are unchanged by this protocol;
   the Worker Registry in `templates/orchestrator-report.md` gains only the
   optional attempt-scoped `gates` field. Ack delivery follows the same sandbox
   rule as a report: if the mailbox write is denied, write the same JSON to
   `<worktree>/.orchestrator/<ISSUE-KEY>-gate-ack-a<N>.json` (never committed). Both
   the orchestrator and the watcher read the fallback path as well as the
   mailbox one, because an ack the watcher cannot see reads as a dead worker
   and would send the healing ladder against a worker that is merely waiting.

   An attempt has exactly ONE ack. The two locations are two places it may
   live, never two acks to choose between: if a file for that attempt exists in
   both, that is a contradiction about which gates ran, and it resolves to no
   ack at all. Do not rank them — not by freshness, not by recency, not by
   which one parses. Every such rule hands the gate to whichever artifact
   scores best, which is how a stale, half-written, or future-dated file comes
   to authorize a lifecycle move. Reading nothing costs a stall event that
   reconciles; reading the wrong one costs the gate.
   Consumption is per ATTEMPT, not per file: consuming an ack renames every
   file for that attempt in BOTH locations, and a consumed marker in either
   location is a tombstone — while one exists, no remaining file for that
   attempt is an ack. That tombstone is a delivery/suppression marker only; it
   is never authority to clear durable registry state.

   Before any candidate rename, the orchestrator writes its trusted
   consumption record in the same consumption step:

   ```json
   {
     "issue": "<ISSUE-KEY>",
     "attempt": 1,
     "outcome": "applied | rejected | blocked"
   }
   ```

   Its path is
   `<orchestrator-root>/consumed/<ISSUE-KEY>-gate-ack-a<N>.json`. The
   `consumed/` namespace is private orchestrator state: only the orchestrator
   writes it, dispatches never expose it as a worker output path, and workers
   are forbidden to touch it. It is not a new gate-ack field or Worker Registry
   field. Before publishing or trusting any record, fsync the orchestrator-root
   directory that contains `consumed/`, even when `consumed/` already exists;
   this completes a namespace creation whose earlier parent sync failed or was
   interrupted. No record may be published until that directory entry is
   durable. The record is
   atomically published before any in-place ack rename and
   before the separate write that removes `registryEntry.gates`. Publish it
   with a same-directory temporary file and atomic rename after the file is
   durable, then fsync the containing `consumed/` directory after the rename.
   Publication is complete only after that directory sync; if it is unsupported
   or fails, stop before any ack rename or registry cleanup. A visible final
   name after a failed sync is not yet authority. Resume must successfully
   fsync `consumed/` before treating any visible final-name record as cleanup
   authority; only then is it the journaled intent Resume may trust. The
   example's `1` stands for the positive integer
   `<N>` from the attempt-numbered filename. Missing record fails safely:
   the ack and `gates` stay until the same outcome is retried or a verified new
   attempt overwrites the field at spawn. Once the record exists, finish every
   candidate rename selected by its `outcome` before removing `gates`.
   An ack delivered or polled while that matching CURRENT-attempt record exists
   is consumption recovery, never a new lifecycle signal: do not apply moves
   again; finish the journaled rename and registry cleanup.

   A future-dated ack is not read at all, so it is neither delivered nor able
   to suppress. The
   `gate-ack` watcher event names the FULL path it validated, and
   the coverage check in step 4 is performed on that exact artifact — never on
   "the ack" resolved a second time, which is how an orchestrator ends up
   authorizing a move against gate evidence nobody validated. A transport with
   no watcher event applies the same rule when it polls.

   A stage report beside an unconsumed ack means different things depending on
   the ack, so the consumer reads the ack's `status` first and never the report
   on its own.

   A `blocked` ack beside a stage report is the ordinary non-green outcome, not
   a crash. A `blocked` ack alone is not yet consumable: the worker writes the
   ack before its report, so consuming during that interval would discard the
   only durable recovery evidence if the worker died. Preserve the ack and
   `registryEntry.gates` while polling for the correlated ordinary stage report.
   Shape and freshness do not correlate a blocked report to an attempt because
   the shared report path carries no attempt number. Before consumption,
   reconcile the transport thread and worktree exactly as for the
   `gates-passed`-plus-report ambiguity below; if current-attempt authorship is
   not proven, keep the ack and field and resolve the ambiguity.
   Only after that report exists and validates, atomically publish the private
   consumption record with `outcome: blocked`, rename the ack as
   `<ISSUE-KEY>-gate-ack-a<N>.blocked.json`, remove `registryEntry.gates`, and
   route the report through the ordinary non-green path. That is the third
   consumption state, beside `.applied` after a resume and `.rejected` for a
   coverage failure: an ack whose gates honestly did not pass is spent too, and
   without a state of its own it would be redelivered on every watcher restart.
   The record binds the ack outcome, not a report version. After a crash with a
   private `outcome: blocked` record, Resume may finish the journaled ack rename
   and registry cleanup, but it re-runs transport/worktree reconciliation before
   routing any shared-path report; the record alone never authenticates that
   report or authorizes routing it twice.

   A `gates-passed` ack beside a stage report is the genuinely ambiguous one.
   It is what the crash window above looks like — the resume succeeded, the
   worker ran and reported, and the orchestrator died before consuming the ack
   — and it is equally what a superseded worker leaves behind, because a report
   carries no attempt number and may belong to an earlier attempt rather than
   to this ack. Either reading is wrong in one direction: consuming the ack
   strands a current dispatch that never ran, resuming again replays one that
   did. Reconcile before acting — establish from the transport thread and the
   worktree whether THIS attempt executed — and never silently consume the ack
   or resume on it twice. The same reconciliation covers the crash window
   between a resume and its rename: an unconsumed ack alone never authorizes a
   second resume.

   The watcher does not resolve it, and deliberately so. A stage report carries
   no attempt number, so a superseded worker still alive can write one after
   its successor's log was born and after that successor's ack; no ordering
   rule distinguishes the two. A watcher that suppressed the ack on that
   evidence would discard the CURRENT attempt's gate-ack and strand its
   dispatch — a worse failure than the duplicate the suppression was meant to
   prevent, and one the consumer rule above already prevents. Fence a replay
   where the binding exists, not where only a timestamp does.
4. Lifecycle application. On `status: gates-passed` the orchestrator first
   reads `registryEntry.gates` from the registry entry whose `log` identifies
   this current attempt, validates its complete shape, and checks the exact
   ack artifact against that durable list — set equality on the gate names,
   not a count, and every one `pass`. Process memory and the watcher event are
   not evidence those gates ran. When an ack exists, absent or malformed
   `registryEntry.gates` makes it unusable; there is no form-only legacy branch.
   A foreign or duplicate ack name, or an incomplete `gates-passed` set, also
   makes the ack unusable. The producer-contract recovery is a verified respawn
   of a NEW gate attempt that writes its own correct list. A non-empty subset is
   valid only for `blocked`, which never authorizes lifecycle moves. Entries
   without an ack do not evaluate this gate-list consumer rule, so absent
   `gates` leaves their watcher liveness signals unchanged.
   Rejecting an ack has its own consumption step, because a rejected ack that
   stays in place goes on suppressing liveness for a worker nobody is about to
   resume: atomically publish the private consumption record with
   `outcome: rejected`, then rename it to
   `<ISSUE-KEY>-gate-ack-a<N>.rejected.json`, which re-arms the ladder
   immediately, and remove `registryEntry.gates`. Rejection is
   TERMINAL for this attempt: recovery is a verified respawn of a NEW gate
   attempt with its own list, never a same-attempt nudge after consumption.
   It then applies every lifecycle move this dispatch carries and
   confirms each with read-back per Linear Write Verification. A move whose
   read-back still shows the old state is pending, never applied, and the
   worker is not resumed for execution while it is pending.
5. Resume for execution. The orchestrator resumes the same worker with a
   resume signal that names each applied move together with its read-back
   result, explicitly as an amendment of the dispatch snapshot. Every
   post-resume check — including `mono-check delivery` — is evaluated against
   that amended post-move state. The pack identity gate runs again after the
   resume, unchanged: resuming is a stage resume, so the gate is mandatory.

   First, the immediate post-resume registry update that records the new
   writer per Worker Transports preserves `registryEntry.gates`. After that
   writer registration is confirmed, the orchestrator atomically publishes
   the private consumption record with `outcome: applied`, then renames every
   candidate for the attempt to `<ISSUE-KEY>-gate-ack-a<N>.applied.json` in
   place. Only after the trusted record and every rename succeed does a separate
   registry write remove `gates`. All four parts of that order matter.
   Consuming it is not bookkeeping: a gate-ack suppresses liveness events, and
   the resumed worker writes to the same stage log, so an ack left in place
   would go on suppressing `stall` and `dead` for a worker that has crashed
   after its resume; the rename re-arms the liveness ladder for the execution
   phase and keeps the ack on disk as history. Renaming the ack or removing
   `gates` before the record would discard trusted recovery evidence, while a
   missing record leaves both ack and field safely in place. Starting the
   record-and-rename sequence any earlier is equally wrong: if the rename
   completes before the resumed writer is registered, the gate-phase pid is
   already gone and nothing suppresses liveness, so a watcher scan in that
   window reports `dead` for a healthy resume and sends the healing ladder
   against it. A resuming orchestrator that finds an unconsumed ack beside an
   already-resumed worker consumes it then.

### Registry gate-list lifecycle

This table owns the producer transitions for the optional
`registryEntry.gates` field. It defines registry state changes; the
stage-aware recovery decision for malformed and forbidden-presence branches
lives on both monitor surfaces under Monitoring Protocol, not inside the
handshake.

| Transition | Required registry action |
| --- | --- |
| Verified gate-carrying spawn, respawn, or session rotation | Write the exact non-empty unique gate-name list for the NEW current attempt together with its attempt-numbered `log`. |
| Same-attempt no-ack nudge or resume | Preserve `gates`; this is still the same attempt. |
| `gates-passed` received, resumed writer not yet confirmed | Preserve `gates`; the durable consumer contract is still live. |
| Consume `.applied` | Register the resumed writer while preserving `gates`, atomically publish the private consumption record with `outcome: applied`, rename every ack candidate, then remove `gates` separately. |
| Consume `.rejected` | The attempt is TERMINAL: atomically publish the private consumption record with `outcome: rejected`, rename every ack candidate, then remove `gates`. Recovery is an immediate verified respawn of a NEW gate attempt with its own list; never same-attempt nudge after consumption. |
| Consume `.blocked` | Only after the correlated stage report is present and valid: atomically publish the private consumption record with `outcome: blocked`, rename every ack candidate, then remove `gates` and route the report. |
| Malformed `gates` on a gate-carrying entry | Treat it as a producer contract error and terminate the attempt; verified-respawn a NEW gate attempt with a correct list. |
| `gates` present on `mono-preflight` or `mono-ship` | Presence is forbidden, not a selector: start a new attempt of that same stage WITHOUT `gates`. |
| Stage advance or any other non-gate dispatch | Reconcile every unconsumed ack first, then atomically change `stage`/`log` and remove `gates` in the same registry write. |
| Crash after consumption-record publication | Resume treats the well-formed private CURRENT-attempt record as intent: finish renaming every remaining ack candidate to the suffix selected by `outcome`, then remove stale `gates`. Tombstones and mailbox files never authorize either action. |

Blocked path: a gate that fails makes the ack `status: blocked`, and the worker
then also writes the normal stage report at the mailbox report path, so watcher
report correlation is preserved exactly as it is today. That report carries the
stage's OWN exit status for the failure it hit:
`needs-human` when a gate returned a real adverse verdict, `blocked` when the
snapshot cannot supply a required input. Mode precedence never rewrites a
stage's exit statuses, so the ack's `blocked` says only "gates not passed,
apply nothing" while the report says what happened and routes through the
ordinary non-green path, unchanged. The orchestrator applies no lifecycle move
on a blocked ack. Keep the ack and `registryEntry.gates` until the correlated
report is present and valid; only then consume the ack as `.blocked`, remove
the field, and route the report. The attempt is terminal after consumption and
has no resume.

No-ack path: an ack that never arrives is not a new signal. It is the existing
liveness ladder — `stall`/`dead`, then nudge → respawn → session rotation —
because a worker that never acked never reached the contracted wait.

Both transports, because the pause and the resume differ in mechanism only:

- `codex-cli`: the worker writes the ack and its process exits, exactly as at
  a stage boundary. The orchestrator resumes the same thread with the
  `codex exec resume` form in Worker Transports, passing the resume signal as
  the dispatch prompt file. No user interaction.
- `claude-code-desktop` and `fallback`: the worker writes the ack and ends its
  turn; the session stays open and is continued with a session message
  carrying the resume signal. Transport price, named plainly: in
  `claude-code-desktop` a resume message needs the user's confirmation, so the
  handshake costs one user click per gate-ack there. That click is a transport
  cost, not a checkpoint — it carries no decision, is never dressed up as a
  decision brief, and never becomes a place to re-open scope.

## Worker Transports

Three transport operations: spawn worker, continue worker, read worker
reports. Transport selection: `orchestration.transport` from the project
config wins when present (`codex-cli` | `claude-code-desktop` | `fallback`);
without config, prefer `codex-cli` when the `codex` CLI is installed and
authenticated, then `claude-code-desktop` when running in Claude Code
Desktop, then `fallback`. Per-runtime bindings:

Every transport is pinned to the installed pack identity. Before dispatch,
read `packVersion`, `sourceCommit`, and `surfaceRevision` from the installed
`.mono-agent-workflow.lock.json` and copy them verbatim into the dispatch
snapshot and the new `workers.json` entry. At the first start and every stage
resume the worker runs `verify-pack-state.mjs identity`; any identity mismatch
is a `blocked` report and the stage does not continue.

### Pack identity gate invocation

This is the single home of the gate's executable shape. The dispatch template
and the stage skills point here; nothing else restates the path, the
subcommand, or the flags.

```bash
node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity \
  --lock '<installed-skills-root>/.mono-agent-workflow.lock.json' \
  --pack-version '<dispatch packVersion>' \
  --source-commit '<dispatch sourceCommit>' \
  --surface-revision '<dispatch surfaceRevision>'
```

Single-quote every substituted path and pin value, as shown. Single quotes are
literal in POSIX shells, so a root containing spaces, `$`, or backticks still
reaches the helper unchanged; a value containing a single quote is escaped by
the generator as `'\''`. Substituting a path unquoted, or inside double
quotes, leaves it subject to word splitting and command substitution — which
turns a mechanical gate into a spurious `blocked` or into shell-evaluated
text.

- Path base: the `../.mono-agent-workflow/…` form used inside stage skills is
  relative to the directory of the installed stage skill being read, never to
  the worker's worktree. `<installed-skills-root>` is that skill directory's
  parent — `~/.codex/skills` for a `codex-cli` worker, `~/.claude/skills` for
  a Claude worker.
- Subcommand `identity` is required; without it the helper exits 1 on usage.
- All four flags are required: `--lock`, `--pack-version`, `--source-commit`,
  `--surface-revision`.
- Lockfile: `.mono-agent-workflow.lock.json` sits beside the installed skill
  directories, so its path is
  `<installed-skills-root>/.mono-agent-workflow.lock.json`.
- Success is exit 0 together with `pack-state: identity verified`. Any other
  exit, output, or mismatch is a `blocked` report before stage work.
- The dispatch carries this command fully resolved — absolute paths, the three
  pins substituted — so the worker runs it as written from its worktree and
  never reconstructs a path or a flag.
- The pins identify the installed execution protocol. A same-named
  `SURFACE_REVISION` constant inside the target checkout is repo code that may
  be under the Issue's scope; changing it neither satisfies nor mutates this
  gate, and the report repeats the dispatch pins, not the repo constant.

### Sandbox ladder

Sandbox grants follow a stage ladder: `mono-implement` uses `workspace-write` without network; `mono-preflight` adds network and writable main-checkout `.git` while retaining the writable orchestrator root for mailbox delivery; `mono-ship` keeps those grants and permits push.

| Stage | Sandbox mode and grants | Why |
| --- | --- | --- |
| `mono-implement` | `workspace-write`, no network, plus the writable orchestrator root | Edit only the linked worktree and deliver the mailbox report. |
| `mono-preflight` | `workspace-write`, network, writable main-checkout `.git`, plus the writable orchestrator root | Run the review helper, commit from the linked worktree, and deliver the mailbox report. |
| `mono-ship` | The `mono-preflight` grants, with push permitted | Push the branch, create and stabilize the PR, and keep mailbox delivery available. |
| Any stage that edits a protected hidden directory such as `.agents` | An explicit writable grant for that exact directory | Codex protects dot-directories even when their worktree is writable. |

Escalating to a fully disabled sandbox is not normal operation; record it in `ledger.md` as a deviation with the reason.

- `codex-cli`: the orchestrator — in any runtime with shell access — creates
  and steers headless Codex worker threads; this subsumes the older `codex`
  binding. Spawn as a background process, one per Issue:

  ```bash
  codex exec --json \
    --cd <worktree> \
    --sandbox workspace-write \
    --add-dir ~/.mono-agent-workflow/orchestrator/<product> \
    -c 'model="<pinned model>"' \
    -c 'model_reasoning_effort="high"' \
    "$(cat <dispatch-prompt-file>)" < /dev/null \
    > ~/.mono-agent-workflow/orchestrator/<product>/logs/<ISSUE-KEY>-<stage>-a1.jsonl \
    2> ~/.mono-agent-workflow/orchestrator/<product>/logs/<ISSUE-KEY>-<stage>-a1.stderr.log &
  ```

  Spawn verification, mandatory for every spawn attempt:

  - The dispatch prompt is passed only as a file
    (`"$(cat <dispatch-prompt-file>)" < /dev/null`); inline prompts are
    forbidden. Quoting drift silently truncates inline prompts, and without
    `< /dev/null` a mis-parsed command drops the CLI into interactive stdin
    mode instead of failing.
  - `thread.started` must appear in the log within 60 seconds of spawn;
    otherwise kill the process and retry as the next attempt.
  - A non-empty log with no valid JSON event is an immediate spawn failure —
    kill and retry; never wait out the timeout. A non-JSON line followed by
    valid JSON events is contamination, not spawn failure; inspect the separate
    stderr log, while liveness monitoring continues from the JSON events.
  - Recording "ok" or a live thread in the worker registry or ledger with an
    empty `thread_id` is forbidden. A gate-carrying attempt has one narrow
    pre-spawn exception: its inactive entry is published with `thread_id: null`
    and `pid: null` before the process exists, then replaced with live identity
    only after `thread.started` is parsed.
  - Log files are numbered from the first attempt
    (`logs/<ISSUE-KEY>-<stage>-a1.jsonl`, retries `-a2`, `-a3`, ...) so a
    retry never overwrites the failed attempt's evidence.
  - The worker model and reasoning effort are pinned explicitly in the spawn
    command (`-c 'model=...'`, `-c 'model_reasoning_effort=...'`); CLI
    defaults drift between versions (the wave-1 `model_switch` precedent),
    and a silently switched model voids the dispatch contract.

  Before a gate-carrying worker process can start, create its empty
  attempt-numbered log and atomically pre-register the inactive `workers.json`
  entry with that `log`, stage, pack identity, the publication-time
  `spawned_at`, and exact `gates` list. The
  worker process starts only after this durable write succeeds, so its ack
  cannot overtake the producer contract. Immediately after `thread.started` is
  parsed, replace `thread_id: null` and `pid: null` with the verified live
  identity while preserving `log` and `gates`. A failed spawn retires that
  inactive entry before the next attempt is pre-registered. The watcher treats
  that exact empty-log/null-identity state as inactive startup: it emits no
  liveness event for one stall-threshold startup window until a valid
  `thread.started` arrives. Empty or partial output, contamination, another
  JSON event, and a complete non-JSON line all remain in that same bounded
  state; at timeout they become `spawn-fail`. The startup window
  begins at that registry publication's `spawned_at`, never at a prepared log's
  mtime. A missing, invalid, or more-than-five-seconds-future `spawned_at`
  cannot define a safe window and emits `spawn-fail` immediately, never
  `dead`.

  Immediately after verifying every non-gate spawn, resume, or session
  rotation, in the same orchestrator turn and before any other action, update
  that worker's `workers.json` entry with at least the current `pid`, `log`,
  `last_activity_at`, and `stage` (and the new `thread_id` on rotation). A
  same-attempt gate resume preserves the existing list until the lifecycle
  table authorizes removal. A live worker paired with a stale registry PID
  violates the registry contract; watcher events produced from that entry are
  untrustworthy, and investigating any such event must begin by reconciling
  the registry with the actual writer process.

  Parse the `thread.started` event from the log for the thread id and record
  it in the worker registry, together with the background process pid (`$!`)
  so the heartbeat watcher can probe writer liveness. Continue or steer the
  same thread with the same attempt-numbered stdout/stderr pair (resume appends
  because each attempt log is cumulative):

  Resume does not accept the global `--cd`, `--sandbox`, or `--add-dir` flags; any of them in a resume command is a contract error — set the working directory with `cd` and grants through `-c` overrides.

  ```bash
  cd <worktree> && codex exec resume <thread-id> --json \
    -c 'model="<pinned model>"' \
    -c 'model_reasoning_effort="<pinned effort>"' \
    -c 'sandbox_mode="workspace-write"' \
    -c 'sandbox_workspace_write.writable_roots=["<orchestrator-root>"]' \
    "$(cat <dispatch-prompt-file>)" < /dev/null \
    >> ~/.mono-agent-workflow/orchestrator/<product>/logs/<ISSUE-KEY>-<stage>-a<N>.jsonl \
    2>> ~/.mono-agent-workflow/orchestrator/<product>/logs/<ISSUE-KEY>-<stage>-a<N>.stderr.log &
  ```

  The thread keeps its context across stages. Ship-stage spawns and resumes add
  `-c 'sandbox_workspace_write.network_access=true'` (push and PR creation
  need network). The dispatch prompt names the installed stage-skill body
  (`~/.codex/skills/<stage-skill>/SKILL.md`) because Codex workers load
  skills by reading files, not through a skill tool.
- `claude-code-desktop`: spawn via task chip with a self-contained dispatch
  prompt (one user click; the platform provides the worktree). Continue or
  steer via session message with user confirmation. Workers stay visible as
  normal sessions the user can open.
- `fallback` (CLI/headless): named long-lived background subagents inside the
  orchestrator session; same contract and reporting.

Worktree provisioning: for `codex-cli` and `fallback` the orchestrator
creates the worker's worktree before spawn
(`git worktree add <repo>/.worktrees/<ISSUE-KEY> -b <branch>`), keeps it
across stages, and removes it only after deploy closeout. Deploy retirement is
also the only normal removal point for the active registry: after verified
deploy and Linear closeout, remove the Issue entry from `workers.json`. Keep
its reports and logs as history. A blocked or incomplete closeout does not
retire the entry.
`claude-code-desktop` uses platform-provided worktrees.

State the chosen binding in the first status update, and never block on a
transport feature the runtime lacks.

## Install Coordination

Orchestrator startup and breaking installation share one exclusion boundary.
Before creating `~/.mono-agent-workflow/orchestrator/<product>/`, repairing a
missing `control.json` or `workers.json`, or changing an existing product from
`idle` to `active`, the orchestrator must acquire
`~/.mono-agent-workflow/install.lock` with the shared token-scoped claim
protocol. Create a missing directory with atomic `mkdir` and publish
`protocol.json` as `token-claims-v1`; when the directory already exists, require
that exact marker before joining it. A missing marker is an incomplete or
legacy acquisition and fails closed. The directory is then a stable container:
publish a unique
`choosing-<token>.json`, derive the next sequence from existing claims, publish
`claim-<token>.json`, clear the choosing entry, then proceed only when the
sequence/token ordering selects that exact claim and no foreign choosing entry
remains. Tokens are 1-128 ASCII alphanumerics/hyphens; equal sequences use
ascending bytewise ASCII token order, never locale collation. Every entry
carries the current PID, ownership token, and `startedAt`.
This is the same protocol used by `install-local --breaking`, not a second
orchestrator-only lock.

While holding the lock, create or repair the product root and initialize
`control.json` plus `workers.json`, or write `control.json` as `active`. In
either case, hold the lock through read-back of every state file written by
that operation. Only then may startup continue to watcher launch and worker
dispatch. Release only the caller's unique `claim-<token>.json`, after reading
it back and confirming the same token and sequence; the stable `install.lock`
container remains. A missing, unreadable, or mismatched owned claim is an
explicit startup failure, never a silently successful release.

If the election finds a foreign choosing entry or an earlier claim, make no
product-root, control, or registry mutation. An active owner means this startup
or wave transition must wait and retry after that owner releases it. A stale or
unreadable lock fails closed and its foreign token-scoped entry remains for
manual inspection and removal; never remove another token's entry. This makes
product-root discovery and the quiescence decision stable for the installer's
complete cut-over window.

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
    entry with the cause. These entries feed «Простои и отклонения:» in
    status updates and the final wave report.
- Worker registry: `workers.json` beside the ledger — orchestrator-owned
  runtime metadata, one entry per Issue: `transport`, `thread_id`,
  `worktree`, `branch`, `stage`, `spawned_at`, `last_activity_at`, `log`
  and `pid`, plus the dispatch `packVersion`, `sourceCommit`, and
  `surfaceRevision`, plus optional attempt-scoped `gates` only for the current
  gate-carrying `mono-implement` attempt (shape and validity in
  `templates/orchestrator-report.md`). Updated on
  every verified spawn, resume, session rotation, stage advance, and respawn
  under the immediate-update rule in Worker Transports; workers never touch it.
- Product control: `control.json` beside `workers.json`, with the exact shape in
  `templates/orchestrator-report.md`. The orchestrator owns the lifecycle
  `active` → `draining` → `idle`: use `active` while dispatch is allowed,
  `draining` when no new work may start but registered workers are closing, and
  `idle` only when the active registry is empty. Breaking-install quiescence is
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

## Monitoring Protocol

- Do not steer an actively progressing worker; do not raise the proof bar
  mid-flight; polling alone never justifies intervention.
- Intervene only on: a worker-reported question or blocker, exhausted work,
  repeated failures with no progress, gross divergence from the assigned
  Issue, or an unsafe mutation.
- Read the worker's latest state before any intervention or respawn.
- Before processing any report event or poll, and before any heartbeat enters
  the common healing ladder, validate `registryEntry.gates` with a stage-aware
  branch. This recovery check preempts report routing and stage advancement:
  a report from an entry that takes a malformed or forbidden-presence branch
  is not consumed as a successful stage result. On a gate-carrying
  `mono-implement` entry, a present
  malformed value is a producer contract error: terminate the current attempt
  and verified-respawn a NEW gate attempt with its own correct non-empty unique
  list; never same-attempt nudge it. On a `mono-preflight` or `mono-ship`
  entry, any presence is forbidden: start a new attempt of that same stage
  WITHOUT `gates`. When an ack exists but `gates` is absent, take the same
  NEW-attempt producer-contract recovery; with no ack, absence leaves ordinary
  liveness handling unchanged. These branches run here before the common
  ladder; the handshake table defines the state transition but does not route
  recovery.
  A later-stage entry can never legitimately retain `gates`: stage/log
  advance and `gates` removal are one atomic post-reconciliation registry write.
  Therefore first finish any journal recovery while the entry is still
  `mono-implement`; only unexplained presence on an already later-stage entry
  takes the forbidden-presence respawn branch.
- Before applying the ordinary no-ack healing ladder, inspect the private
  consumption namespace only for a `mono-implement` registry entry whose CURRENT stage-qualified
  log is `<ISSUE-KEY>-mono-implement-a<N>.jsonl`. A well-formed private
  consumption record for that same `<N>` with `outcome: rejected` is a durable
  terminal routing signal. Skip same-attempt nudge and verified-respawn a NEW
  gate attempt with its own correct list. Preflight and ship entries never
  consult these records, even when their stage-local attempt number is also
  `<N>`. Watcher liveness events remain unchanged; this is orchestrator
  recovery routing from trusted durable state.
- An unconsumed valid `blocked` ack with no correlated report is a
  missing-report recovery case, never the no-ack path. Preserve both the ack
  and `registryEntry.gates`; use the ordinary reportless-exit recovery to
  resume the same thread once and demand its stage report. Consume `.blocked`
  only after that report validates. A failed recovery may advance to the
  existing rebuild/respawn rung, but it never turns the ack into absent
  evidence or authorizes early cleanup.
- Stuck or dead worker: rebuild stage state from Linear plus the last mailbox
  report (the branch survives in the worktree) and respawn a worker to
  continue the stage, not restart the Issue.
- `codex-cli` liveness ladder: process exit with a mailbox report is the
  normal advance signal; process exit without a report — resume the thread
  once with `cd <worktree> && codex exec resume <thread-id> --json -c 'model="<pinned model>"' -c 'model_reasoning_effort="<pinned effort>"' -c 'sandbox_mode="workspace-write"' [-c 'sandbox_workspace_write.network_access=true'] [-c 'sandbox_workspace_write.writable_roots=["<path>",...]'] "$(cat <dispatch-prompt-file>)" < /dev/null >> <attempt-log>.jsonl 2>> <attempt-log>.stderr.log &`, demanding the report; a failed resume or a second reportless exit is a
  stuck worker (rebuild and respawn per the bullet above). Stage budgets,
  guidance not gates: implement 60m, preflight 30m, ship 90m. A ship worker
  whose turn ends before green is resumed with «continue stabilization» using
  that same working resume form.
- Gate-pause carve-out: a worker that has written a fresh `gates-passed`
  gate-ack and gone quiet is waiting by contract, not stuck (Two-Phase
  Dispatch Handshake). Its exited process (`codex-cli`) or ended turn
  (`claude-code-desktop`, `fallback`) is the expected end of the gate phase,
  not a liveness signal. The correct response is to apply the dispatch's
  lifecycle moves with read-back and resume that worker:
  never a nudge, respawn, session rotation, or owner page. The ladder applies
  only when no gate-ack arrives at all, which is the ordinary liveness case
  above. Whenever an UNCONSUMED gate-ack exists for that attempt, any `stall` or
  `dead` for it is a consumption boundary rather than a death — however long
  after the ack it arrives. Suppression for such an attempt is bounded, so the
  event is the protocol asking for reconciliation of an ack/report pair it
  refuses to bury, not evidence the worker died: the gate-phase process is gone
  by design, the resumed one may never have been registered, and the worker may
  in fact have completed. Reconcile the registry against the actual writer
  process and the mailbox first, then consume or resume as that shows. Routing
  such an event into healing or replay is a contract error — it can respawn a
  worker whose work already landed. Only an attempt with NO unconsumed ack
  takes the ordinary healing ladder.
- Material scope drift: stop the worker and escalate through
  `scope-drift-needs-handoff`; scope is always the user's decision.

## Heartbeat

The Monitoring Protocol defines when to intervene; the heartbeat is the
external pulse that notices dying workers without spending orchestrator
turns. The installed runtime is
`../.mono-agent-workflow/scripts/watch-workers.mjs`, resolved relative to the
installed `mono-orchestrate` skill directory; `scripts/watch-workers.mjs` is
the upstream repository source used for pack development and fixtures. It is
a zero-dependency, read-only watcher over the orchestrator root: it reads
`logs/`, `reports/`, `workers.json`, and `control.json`, writes nothing, and
emits one stable line per watcher event to stdout —
`<ISO time> EVENT:<stall|dead|spawn-fail|report|gate-ack|idle> <ISSUE-KEY|-> <detail>`.
The watcher observes the active registry (`workers.json`), not the
directory's history; retired Issues' logs are outside its scope.

- At wave start — before the first worker spawn — the orchestrator must
  start the watcher against the mailbox root:
  `node '<installed-mono-orchestrate-dir>/../.mono-agent-workflow/scripts/watch-workers.mjs' --root ~/.mono-agent-workflow/orchestrator/<product>`.
  Substitute `<installed-mono-orchestrate-dir>` with the absolute directory
  containing the loaded `mono-orchestrate/SKILL.md`; never resolve the `../`
  segment against the product/worktree current directory.
  Run it through the runtime's monitor primitive (Claude Code: the Monitor
  tool with `persistent: true`); a runtime without one falls back to a
  background process plus a periodic wakeup that reads its stdout. Record
  the degraded binding in the ledger.
- Watcher liveness events are Monitoring Protocol triggers: treat `stall`,
  `dead`, and `spawn-fail` lines exactly like a worker-reported blocker — read
  the worker's latest state first, then act. `spawn-fail` feeds the spawn
  verification kill+retry rule in Worker Transports. Non-JSON contamination
  before later valid JSON events produces one diagnostic warning on stderr,
  not a repeated watcher event, and does not suppress stall/dead checks.
- `report` is emitted only for `codex-cli` workers, whose JSONL log provides
  the correlation surface. The report must match the worker registry's A5
  identity and issue/stage, and must satisfy the exact v2 freshness predicate:
  report mtime is at least the log birthtime and at least log mtime minus the
  stall threshold. On `report`, read the correlated report and advance the stage pipeline.
  Report delivery is at-least-once across watcher restarts:
  one process suppresses an unchanged mtime+size version and emits an updated
  version, while a restarted watcher emits the current version once again.
  The consumer deduplicates by reading the report's current state.
  Non-Codex transports keep their existing report-polling contract; the watcher never
  emits `report` for `claude-code-desktop` or `fallback` entries.
- `gate-ack` rides the same correlation surface as `report` and the same
  at-least-once rule: `codex-cli` entries only, registry-matched identity and
  stage. Its freshness is deliberately NOT the report's, and the difference is
  load-bearing in both directions. Delivery asks only that the ack BELONG to
  this attempt — its mtime at or after the attempt log's birthtime — because a
  resumed worker's own execution advances that same log, and an ack left
  unconsumed by the crash window has to keep reaching the consumer precisely
  then; a delivered ack is therefore not a claim that the worker is still
  paused. Suppression asks the stricter question and applies the report
  predicate too, since only a current pause may silence liveness. A polling
  transport applies the same split: it must not discard a retained ack merely
  for lagging the log, or it discards the crash-recovery evidence.
  Delivery is at-least-once per watcher PROCESS, exactly as `report` is: an
  unchanged version is not re-emitted while that process lives, and a restarted
  watcher emits it once more. For a report that suffices because the
  orchestrator also polls the mailbox for reports; an ack needs the same poll
  for the same reason, and the orchestrator does poll for both. Never treat the
  event as the only route to an ack — a consumer that missed it while the
  watcher stayed up would otherwise see only the later `dead`, and the ack it
  must reconcile would sit unread. Its file is
  `reports/<ISSUE-KEY>-gate-ack-a<N>.json` or the worktree fallback path, whose
  minimal shape carries no identity fields, so its correlation comes from the
  registry entry and the log it belongs to. In the shared `readGateAck`
  boundary, the watcher validates the complete shape of
  `registryEntry.gates` before any set operation and then compares its names
  with the ack. When an ack exists, absent or malformed `registryEntry.gates`
  makes it unusable; there is no source-identity discriminator and no form-only
  legacy branch. Entries without an ack do not evaluate this gate-list consumer
  rule and keep their ordinary watcher liveness signaling. With a durable list,
  `gates-passed` requires exact set equality, while `blocked` accepts a
  non-empty subset with no foreign names; duplicates are invalid in both
  branches. Any mismatch produces neither delivery nor suppression. The
  watcher never mutates the registry snapshot. It also validates the ack whole
  and fails closed: a missing or malformed ack `gates` array, or
  `gates-passed` over a gate that did not pass, is treated as no ack at all. It is scoped to
  the stage that can have a gate phase — a `mono-implement` log — so an ack
  beside a `mono-preflight` or `mono-ship` log, whose dispatches carry no
  lifecycle move, is spurious and neither delivers nor suppresses.
  A fresh usable gate-ack suppresses `stall` and both `dead` branches for that
  worker during a bounded handoff: `gates-passed` waits for lifecycle
  application and resume. A valid `blocked` ack gets the same bounded suppression until its stage
  report is observed or the ack is consumed, so the normal ack-before-report
  interval cannot start duplicate healing. That suppression is bounded twice
  over. Normally the
  orchestrator consuming the ack at resume time ends it — the watcher cannot
  distinguish a retained ack from a live pause, so the rename in step 5 is what
  re-arms the ladder. When both a `gate-ack` and a `report` are emitted for the
  same worker, the `gate-ack`
  comes first, because the consumer reads the ack's status before it acts on
  the report. But if lifecycle application succeeds and the resume, the
  registration, or that rename then fails, nothing would consume the ack at
  all, and freshness against the log never expires by itself: so suppression
  additionally lapses after a few stall thresholds of wall-clock, and the
  ladder re-arms on its own. While an unconsumed usable gate-ack is
  present that bound also governs over ordinary report suppression, which is
  unbounded by construction: otherwise a report left beside the ack — the
  very pairing this protocol sends to reconciliation — would silence the
  worker forever and reconciliation would never be triggered. That clock runs on the PAUSE — the worker's log
  going quiet — never on the ack's own timestamp: the ack sits at a
  worker-writable path, and a deadline the worker can refresh by touching
  the file is no deadline at all. That is an age window rather than a ceiling: an
  ack dated in the future buys no suppression at all, because the worker sets
  its own timestamps on the fallback path and a forged date would otherwise
  reopen the same unbounded silence. A gate pause that outlives that bound is a stuck
  handshake, not a healthy wait, and the orchestrator is meant to hear about
  it — reconcile the worker, then either retry the resume or consume the ack
  and treat it as the no-ack path. Suppression
  demands the same registry correlation delivery does: an ack the watcher would
  not deliver cannot silence liveness either. On `gate-ack`, read the
  exact correlated artifact, revalidate it against `registryEntry.gates` from
  the current attempt with the same status-asymmetric rule, and only then
  branch on its `status` —
  `gates-passed` runs step 4 onward
  of Two-Phase Dispatch Handshake, `blocked` applies nothing and waits for the
  ordinary stage report that path also writes. Either way it is a
  delivery event, never a Monitoring Protocol trigger. Every consumption
  branch atomically publishes the trusted private
  `<orchestrator-root>/consumed/<ISSUE-KEY>-gate-ack-a<N>.json` record first,
  then renames the attempt's ack candidates, and only then removes
  `registryEntry.gates`; a tombstone alone never authorizes cleanup.
  Non-Codex transports
  keep the polling contract here too.
- `idle` is product-wide (its issue-key slot is `-`) and fires after the active
  registry has been empty longer than `--idle-sec` (default 300). A5 retirement
  means deploy closeout removed the Issue entry; `control.json` state `idle`
  does not retire a remaining entry, and entries present while control is
  `active` or `draining` always block `idle`. `idle_since` is the later of the
  registry mtime and the last emitted watcher event, so any emitted event moves
  the clock forward; repeat emission is no more frequent than that idle window
  (and remains subject to `--repeat-sec`). On `idle`, the orchestrator records
  the idle period and its cause in `ledger.md`, satisfying the mandatory
  longer-than-five-minutes idle rule rather than treating it as routine polling.
- The stall threshold is at least 90 seconds (default 120); lower values
  misread normal turn gaps as stalls, and the watcher refuses them.
- Healing ladder, in order: nudge (resume the thread demanding a report) →
  respawn (rebuild stage state per the Monitoring Protocol) →
  session rotation (fresh thread and fresh attempt-numbered log). Alert the
  owner only when the ladder is exhausted (owner decision Q3); never page
  on the first stall.
- Forced worker termination is a process-tree operation: starting from the worker PID recorded in the registry, enumerate descendants recursively with `pgrep -P`, terminate the captured tree leaf-to-root and the wrapper last (never kill only the wrapper PID), then prove from the captured PID set plus an exact transport-thread-id process search that no survivor remains before resume, respawn, or session rotation. A survivor can retain the transport thread and hang every later resume.
- Every healing step and its result are mandatory ledger entries — a
  watcher event that triggered intervention is never routine polling.

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

Brief integrity — five rules bind every brief and UX checkpoint; the
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
- Any spec change after a package approval that alters user-visible
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

Per-feature cost is a first-class operational metric, same as context
usage. Wave-1 precedent: a full production wave ran with zero cost
visibility — one Issue consumed 49M input tokens (97% cached), one PR
accumulated 59 review submissions, and none of it appeared in any report.
Model-tiering policy has no data without this telemetry.

Per-Issue collection, performed by the orchestrator:

- Worker tokens: read the LAST `turn.completed` event of each attempt log
  of the stage (`logs/<ISSUE-KEY>-<stage>-a<attempt>.jsonl`); each is
  cumulative for its own thread — record input, cached, and output as
  reported there, and sum ACROSS attempts (a respawn or rotation starts a
  fresh thread whose spend must not vanish). Never sum events within one
  log.
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
never let cost collection delay a stage advance; a missing number is
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
3. Read `ledger.md` and all mailbox reports; apply queued Linear mutations
   that were never applied.
4. Corroborate key ledger claims — dispatches, stage advances, deploys —
   against worker log and report timestamps. A ledger line with no
   supporting evidence is marked unverified and its state is re-derived
   from Linear plus logs instead of being trusted. This is a judgment rule
   for the resuming session, not a pin-enforceable check: it defines how
   much to trust the ledger, not a mechanical validation.
5. Read `workers.json` and list live worker sessions when the runtime allows
   it. Consult `consumed/` only when `registryEntry.stage` is `mono-implement`
   and the CURRENT registry log basename is
   `<ISSUE-KEY>-mono-implement-a<N>.jsonl`. Before clearing any stale
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
   lockfile before using its thread id. When surfaceRevision differs, do not rebind
   or resume that thread; report it blocked for a fresh compatible dispatch.
   Otherwise rebind to surviving `codex-cli` workers by thread id
   (`cd <worktree> && codex exec resume <thread-id> --json -c 'model="<pinned model>"' -c 'model_reasoning_effort="<pinned effort>"' -c 'sandbox_mode="workspace-write"' [-c 'sandbox_workspace_write.network_access=true'] [-c 'sandbox_workspace_write.writable_roots=["<path>",...]'] "$(cat <dispatch-prompt-file>)" < /dev/null >> <attempt-log>.jsonl 2>> <attempt-log>.stderr.log &`) instead of respawning them.
6. Output the rebuilt status table before taking any new action.

Forced mid-wave resume drill — a planned one-time operational act,
not a recurring gate: during the next wave the orchestrator deliberately
performs a clean handoff to a fresh session mid-wave, at a safe boundary
per Context Budget (after the current monitoring pass or stage advance
completes, never mid-dispatch), runs this Resume procedure for real, and
records every reconstruction discrepancy in the ledger — unverified
ledger claims, lost thread bindings, unapplied Linear mutations, report
gaps; "no discrepancies" is a valid result only after actively looking.
The drill result feeds the PRD wave-1 success criteria. Before scheduling the drill, check the ledger and PRD for a completed-drill record and skip if one exists — it is one-time, not per-wave. Rationale: the
wave-1 orchestrator session peaked at 92% of a 1M context window and a
forced mid-wave resume has never been tested.
