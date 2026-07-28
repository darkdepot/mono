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
   implementation-start option.
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
Linear, and never dispatches or steers workers; it is discovery work,
not stage work.

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
  read-back.
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
  reports `needs-decision` for the orchestrator to sequence.
- A stage's own lifecycle precondition is therefore sequenced by the
  orchestrator before dispatch, never queued from inside the stage and
  stepped over. Dispatch `mono-implement` with the Project already in
  Delivery, so the snapshot the worker evaluates is already the post-move
  state. A snapshot showing an unmet lifecycle precondition is a
  `needs-decision` report naming the move the orchestrator must apply and read
  back first. No stage defers an executable check onto a queued mutation
  entry: this mode has no protocol that would carry one, so a check the
  snapshot cannot answer is sequenced by the orchestrator, never left as
  descriptive text in a report.
- Interactive mode is unchanged: a stage run without a dispatch reads and
  writes Linear directly exactly as its stage skill says.

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
    empty `thread_id` is forbidden; write the registry entry only after
    `thread.started` is parsed.
  - Log files are numbered from the first attempt
    (`logs/<ISSUE-KEY>-<stage>-a1.jsonl`, retries `-a2`, `-a3`, ...) so a
    retry never overwrites the failed attempt's evidence.
  - The worker model and reasoning effort are pinned explicitly in the spawn
    command (`-c 'model=...'`, `-c 'model_reasoning_effort=...'`); CLI
    defaults drift between versions (the wave-1 `model_switch` precedent),
    and a silently switched model voids the dispatch contract.

  Immediately after verifying every spawn, resume, or session rotation, in the same orchestrator turn and before any other action, update that worker's `workers.json` entry with at least the current `pid`, `log`, `last_activity_at`, and `stage` (and the new `thread_id` on rotation). A live worker paired with a stale registry PID violates the registry contract; watcher events produced from that entry are untrustworthy, and investigating any such event must begin by reconciling the registry with the actual writer process.

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
  `surfaceRevision` (shape in `templates/orchestrator-report.md`). Updated on
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
- Material scope drift: stop the worker and escalate through
  `scope-drift-needs-handoff`; scope is always the user's decision.

## Heartbeat

The Monitoring Protocol defines when to intervene; the heartbeat is the
external pulse that notices dying workers without spending orchestrator
turns. `scripts/watch-workers.mjs` (this repo) is a zero-dependency,
read-only watcher over the orchestrator root: it reads `logs/`, `reports/`,
`workers.json`, and `control.json`, writes nothing, and emits one stable line
per watcher event to stdout —
`<ISO time> EVENT:<stall|dead|spawn-fail|report|idle> <ISSUE-KEY|-> <detail>`.
The watcher observes the active registry (`workers.json`), not the
directory's history; retired Issues' logs are outside its scope.

- At wave start — before the first worker spawn — the orchestrator must
  start the watcher against the mailbox root:
  `node scripts/watch-workers.mjs --root ~/.mono-agent-workflow/orchestrator/<product>`.
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
   it. Compare each entry's `surfaceRevision` with the currently installed
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
