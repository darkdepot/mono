# Orchestration Policy: Delivery

Part of the `mono:orchestrate` control-plane policy. `references/orchestration.md`
holds the always-read part and the map of parts. Read this part before the watcher
starts, while `workers.json` holds an entry or a worker report or capsule is
unreconciled, and before QA, merge or deploy of a shipped Issue.

## Independent QA before merge

After every confirmed green ship, resolve the recipe from the product config's
`qa` block or the product's explicit `<!-- mono-qa product: NAME -->` record in
`references/qa-recipes.md`. Examples, `workflows.qa`, `qaAuth` and assignment
files do not connect a product. No recipe: do not launch a tester; preserve the
existing merge path and record «тестировщик не подключён» in closeout.
A recipe with `beforeMerge: false` turns this gate off for the product: merge does
not wait for a tester and closeout records «тестировщик по запросу»; run `mono:qa`
on request and once before a release.

For connected products launch **mono:qa on the host**, on role `qa`, outside the
worker's copy. Give it the task, approved PRD/design, current PR head, confirmed
ship certificate, current main as test-merge base and recipe. Save its expectation
list before actions. The tester publishes and reads back its report, certificate
and main recording in the task; the project pass also publishes its report in the
Project. Worker self-assessment cannot replace this pass.

Failed/unverified holds merge and wave installation. Send concrete bugs, steps,
expected/actual and evidence through a ship-fix task change, preserving
the task attempt and prior ship state. After new head passes ship, launch QA again
on the **entire list**, with fresh evidence; do not reuse prior green items or cap
QA attempts. Recheck disputed items yourself; keep false alarms in the report with
the removal reason. Missing/contradictory expectations stay unverified until a
recorded decision; changed user-visible behavior goes to the owner before rerun.

### Current host inputs

Only the host writes `<root>/qa/state.json`, refreshed from **all paginated**
Project Issues in Linear and their current GitHub heads before preparation,
merge, landing record, and installation verification. Missing/unknown facts are
blocking. Keep it outside every worker grant; never accept it from a worker.
Each `tasks[KEY]` has the exact current `head` and explicit `project` (ID or null).
Each `projects[ID].issues` row has `issue`, `head`, `statusType`, `labels` (names)
and `mergedAt`: the freshly read GitHub PR `merged_at`, or explicit null for an
unmerged PR. Missing merge progress blocks; Linear status never implies landing.
Include stage Issues too, with their actual labels. Build composition
contains every non-canceled/non-duplicate implementation and its source PR head,
including shipped work, excluding label `Этап`; it is independent of the QA result.

Before QA, save `<root>/qa/<KEY>/<head>/task-expected.json` using the inputs of
`scripts/qa-certificate.mjs` (base, kind, evidenceRoot, expectedItems, taskCriteria).
`expectedItems` is an array of `{id, source, expectation}`; freeze exact text/source,
not IDs alone. With `qa.skills`, run `skills-select.mjs` with `configFile`, worktree,
base/head, `expectedFile` (independent task inputs), `taskExpectedFile` and `output`
before the pass. It appends scenario × host entries to the new task-expected.json.
`purpose: change` respects perChange; release/acceptance select the complete catalog.
Never call a selected scenario no-behavior or excluded; failed/unverified holds merge.
After publication/read-back save `task-report.json` with the certificate string.
For final QA use `project-expected.json` and `project-report.json` at the final
Issue/head. Save expectations independently before the pass, never extract IDs,
kind or composition from the completed certificate. The gate overwrites task,
head, scope, recipe source, mode and task ship from current inputs; base remains
the tested base. Moving main alone does not restart QA.

`delivery-state.mjs qa-status --root <root> --config <config> --report <ship-report>`
returns the same QA state used by deploy preparation, landing record/status and
wave verification: `waiting` (exit 2), `failed` (1), `passed` or `not-connected` (0).
Ship green remains a code/review milestone **before QA**, not permission to merge.
Do not require QA in the worker's ship publication: the host launches it afterwards.
Save the green certificate read back from Issue comments/resources as host JSON
with `issue`, `head`, `certificate`; this is not a worker-registration requirement.
Run `scripts/orchestrator/qa.mjs prepare --root <root> --config <config> --issue <KEY>
--head <fresh-PR-head> --ship-report <read-back-ship.json>` before any merge, including per-merge products.
No recipe resolves before reading ship files or worker state, so the command also
works with only `--config` on that path. Connected standalone deployments supply
the same read-back JSON and host QA inputs without an orchestrator registry.
The landing queue retains its confirmed ship checks and rechecks QA before record
and wave verification. Default state readers use the trusted host config path
recorded as `entry.config` at launch. Legacy dispatches recover that exact path
from their correlated existing `spawn.json`; no worker checkout fallback exists.
Unavailable host metadata stays unknown/active, never inferred disconnected.
Explicit config must agree with a recorded host config when one is available.
A short no-behavior task certificate needs a reason and an independently selected
kind; it never substitutes for project coverage. Given-version or assignment-file
certificates never open gates, even if their verdict is green.

### Final project pass

When exactly one unmerged implementation without label `Этап` remains, run
final QA on its test merge over **all R and
AE of the approved PRD**. This Issue still needs its own task certificate. Hold
its merge and wave installation until the project certificate matches the current
build. The sole unmerged Issue is final even when a previous held chain has merged.
With multiple unmerged Issues, a nonempty held chain must contain every one of
them; otherwise preparation fails with a held-chain conflict. A matching chain
selects its last Issue; no chain means task QA only. Before wave installation,
when all PRs are merged, the latest GitHub merge is final, including held Issues;
ambiguous merge order blocks. Neither Linear lifecycle
nor a saved finalIssue selects it. The build lists all eligible implementation
Issues and heads, including merged held Issues. Require every build head only
when project QA is required; earlier task-only PRs may land while later unstarted
Issues have no PR/head (their mergedAt is null and they count as unmerged).
Changed tasks or heads invalidate the final
certificate; rerun the full final list and publish/read back the new project report.
Earlier tasks may deploy individually when merge deploys immediately, each after
its own green task certificate.

A final-pass bug becomes a new approved implementation Issue, branched from the
held task's branch. Retain **both** in `heldIssues` in dependency order, with
each in `tasks` and `issues`; additional bugs extend the same held chain. Run task
QA for each, final QA at the last held successor's head/test merge with the whole build.
After green, merge held predecessors then the successor in dependency order;
all remain bound to the same final composition during landing and installation.
Keep its QA expected ship certificate bound to that successor's issue/head.
Do not repair product code in the tester session or silently waive a disputed item.

## Deploy and closeout

After green Ship and Independent QA above, invoke `mono:deploy` in this product's
session; its script owns the merge, version proof, checks, rollback and outcome.
It closes the Issue on merge and publishes an update only after delivery; retain
proof and retire the worker after closeout. No deploy worker.

## Monitoring Protocol

Do not steer progressing workers, raise proof mid-flight or intervene for polling
alone. Intervene on reported questions/blockers, exhausted work, repeated failures
without progress, gross scope divergence or unsafe mutation; inspect latest state
first. An unconfirmed watcher alarm is a prompt to inspect, not an owner blocker.
A no-change wakeup (false alarm after inspection, already-consumed report, or no
events) produces no owner message and no routine ledger entry. Record actual
observation recovery and every healing step/result; retain escalation after the
healing ladder or an Always-ask decision. Check startup registry gates before ack/report routing: malformed/absent
with ack is a producer contract error; reconcile/retire and create a verified new
attempt with correct gates, never same-attempt nudge. After consumption, gates
must be absent. Finish private journal recovery before phase routing.

For a fresh attempt, do not infer death from a process search for its transport
thread ID: only resumed attempts carry that ID in their process arguments. Verify
liveness using the current attempt's registry PID and matching process start time
(`procStart`); a live PID with a different start time is not that attempt.

Read ack status before any report. Applied/rejected/blocked private records bind
only the current attempt. Rejected is terminal: reconcile, then new attempt within
cap, never nudge. Blocked ack without report waits for same-attempt report recovery;
preserve ack/gates until verified report exists, then consume blocked. Passed ack
with report or uncertain resume requires transport/worktree reconciliation, never
second lifecycle application/resume from an ack alone. Record recovery sync and
rename before gates removal; tombstones never authorize cleanup.

A fresh passed startup ack is a contracted pause, not death. Any stall/dead while
its ack remains unconsumed is a consumption boundary: reconcile writer/mailbox
before healing. Phase event: validate capsule/attempt; review rounds go through
the collector started with the attempt; do not resume a worker waiting on a round.
The watcher suppresses liveness only while a round request has no result and the
attempt's collector lives.
Startup suppression remains stallSec × 4 from log silence. With --config, watcher
--stall-sec defaults to product stallSec (120); an explicit flag overrides, minimum
90. Config ackWaitSec (420) must be ≤ stallSec × 4 − pollSec (10); watcher startup
also validates against its effective threshold. For wait + .applied, while log
mtime < last_wait.consumedAt, continuation is ≤ ONE stallSec from consumedAt:
finite, not future, 0 ≤ age < stallSec. Never renewable; log continuation or
expiry restores ordinary monitoring. These protocol deadlines take priority over
unfinished commands, including when a child process remains alive.

In ordinary work, a silent log with a live writer (`writerPidState`) and an
unfinished command defers stall using a fixed 60-minute best-effort diagnostic
from the watcher's first observation of that state. This is not a precise execution
deadline: observation, bounded scanning and restart effects can affect its timing. Codex tracks every `command_execution`
`item.started` by `item.id` until its `item.completed`, resetting on
`thread.started`; Claude reuses current-instance Bash `tool_use.id` /
`tool_result.tool_use_id` tracking. Completing one parallel command leaves the
others pending. Process descendants alone prove no command. No log timestamp
backdates this allowance; watcher restart starts it again. At the limit emit one
stall marked «идёт команда дольше 60 минут», then inspect progress as usual.
No unfinished command means ordinary stall; missing writer evidence and `dead`
remain unchanged. A hung command that keeps writing progress still has a fresh
log: detecting it remains outside this rule.

No-ack/no-report exit: resume the same thread once demanding its capsule/report;
second reportless exit or failed resume rebuilds from Linear plus capsule/worktree
and uses a verified new attempt, preserving outstanding write IDs and reconciliation.
Use installed resume/spawn tools; do not reset Issue or attempt counts.
Keep dirty work on same-thread resume. If that thread cannot resume, park
needs-decision with its capsule and preserved dirty tree; never loop new spawns,
discard changes or bypass the mandatory clean-tree start gate. A clean recovery
checkpoint needs the preflight owner before a verified new attempt. Halt refuses
new spawns/resumes, not running workers. Escalate only after the healing ladder
(nudge → respawn → session rotation) is exhausted or an Always-ask decision exists.
Keep actual decisions/results in ledger; a no-change wakeup is neither. Delivery budget is guidance, not a gate.
Material scope drift parks scope-drift-needs-handoff and goes to owner decision.

## Review rounds

A collection runs one read-only review round on the committed head (reviewer
and checker from different model families) and writes one `gate-review-v3`
receipt with `verification.exitCode: null`: the worker runs the full product
verification and sends `workerVerification {head, exitCode}`; the receipt passes
only with exit 0 on its head. Receipts of older attempts keep their sandbox verification. The collector host needs both the Codex and
Claude CLIs logged in by subscription; a single-family setup gives
`not-reviewed`, and so does a logged-out CLI whose role has to run (the checker
runs only when the reviewer reports findings).

Between rounds do nothing: the worker fixes open findings and requests the next
round itself. The pinned risk sets the completed rounds per task attempt (`risky`
three, the fast path one), counted from the attempt's receipts;
rounds after the first read only the fixes and open findings; the same head
reuses its round; `not-reviewed` spends nothing. `ROUND_LIMIT` stays 3 and
`reviewContext` in `gate.mjs` counts from the receipt history.

Fast path: after its round the worker fixes, runs the full verification on the
final head and requests it with `workerVerification: {head, exitCode: 0}`; the
collection accepts that head without another round (`review clean (round 1 of 1),
fixes after it confirmed by the worker's full verification`), unless the round
found out-of-contract work or a raised risk (needs-decision). The bot sees the
result on the PR.

Live run (before review): the worker runs the main scenario of a behavior change
in its worktree and puts the proof in the code report. Pack skill and stage
changes it cannot run from its sandbox: the orchestrator runs them in the test
Linear workspace after the first code report, before review. No separate gate:
Preflight checks the proof in the code report before its first collection, and
pre-ship review (`mono:review`) reports a missing run; the collection's review
round never sees the code report.

Parks:
- needs-decision, `review not-converged after round 3` or `review round limit
  reached` (strict path): the orchestrator decides; merging needs green CI, passed
  required checks and no open finding harming the main path, data or the owner's
  install; otherwise split the Issue or change the approach in a new attempt. A
  task change keeps the count and adds no rounds.
- needs-decision, `verification failed on the reviewed head` (older attempts):
  decide whether the code or the environment is wrong.
- blocked, `not-reviewed twice in a row`: restore both CLI logins, then resume
  the worker with a task change (the streak belongs to one contract; the count stays).

`clean-with-successors` passes. Its candidates are older defects (on the strict
path only harmless ones), minor P3
leftovers from round 2 on (never data, security or gate bypass) and, on round 3,
leftovers both roles call harmless. After merge the task's Linear writer (the
worker through Linear MCP when it has access, otherwise the orchestrator) files
every `must-file` entry of the receipt's `review.successors` list (an older dangerous defect; a minor one
only for data, security or gate bypass) and decide
which of the rest become Issues; the gate line and ready certificate repeat the
list. A round takes up to 25 minutes on a large risky change; every reviewer role
has its own time limit, so a hung CLI ends the round instead of a window; a gate
stuck outside them (a blocking Git read) is stopped after a fixed two-hour safety
ceiling, also when its collector died, and the round fails.

## Delivery Write Barriers

The worker is the sole writer of its Issue's reports, comments and statuses: it
writes them through Linear MCP and reads each back before advancing. The
orchestrator neither queues nor confirms them; it writes only the handshake start
moves (`lifecycle_moves`) and «Изменение задачи». No report waits for the
orchestrator.

Poll phase reports as well as events; events accelerate, never prove application.
Use installed `scripts/orchestrator/accept.mjs ack --root DIR --issue KEY
--attempt N`: validate the sole ack location, registry correlation, gate coverage
and outcome before exposing any plan. Without an existing consumption record,
the plan contains planDigest, plannedAt, ackDigest and moves with moveDigest.
After connector writes, --readback FILE requires that planDigest and one dated
read-back per move observed no earlier than the plan. Identical prior consumption
completes rename/gate cleanup without a new plan; contradictory records refuse.

Attempt launch (`spawn.mjs`, `dispatch.mjs`) starts the attempt's collector
outside all worker sandboxes, without an orchestrator turn, and resume starts a
stopped one; the launch result names it (`collector`). `scripts/orchestrator/
collector.mjs start|stop|status --root DIR --issue KEY --attempt N` restarts or
inspects it; it exits when the attempt leaves the registry. A review round: the
worker runs `gate.mjs preflight` collect:false, writes `{issue, attempt, request:
<publishRequest>}` to `reports/KEY-round-aN.json` and runs `delivery-state.mjs
wait-round --request FILE`, which returns the collector's result for exactly that
request and fails fast when no live collector holds the attempt lock.

The host-owned ledger `consumed/KEY-aN/rounds/` keeps `<n>.json` (ordinal,
collectionId, request digest, the request) and `<n>.result.json` (`done`,
`refused` or `failed`, bound to the same collectionId and digest). Admission
(launch.lock) is monotonic: a new collectionId only after every earlier round has
a result; the same collectionId never takes another request; an in-flight round is
finished first even when the worker overwrote its mailbox. A request off the
launch pins or before the code report is admitted only to record `refused`. The
gate's collect:true requires the admission bound to its request; collect:false
with a replaced request under an admitted collectionId refuses. Landing waits for
a result of every admitted round, and a refused or failed round never blocks it.
Inspect `reports/KEY-collector-aN.log` for admissions, results and attention.
The attempt lock `reports/KEY-collector-aN.lock` stores pid/procStart and the
active gate incarnation. Start reclaims only a dead holder and dead gate tree;
unknown process telemetry refuses. Collector and gate use separate dedicated process groups. A gate waits on stdin
until the collector durably records its incarnation; parent death before release
cannot launch an unregistered gate. Validation also registers its gate group in
the held per-head lock before release; reclamation checks both recorded trees.
Group membership preserves orphan descendants; a group left after the gate closes
is stopped before reconciliation. Stop verifies incarnation, requests graceful
shutdown and lets an active gate finish before releasing locks.

Before collection, find history by collectionId and compare actual receipt
bindings (including risk/critical, grants and verification) against the admitted
request. Under the per-head lock, restore the mutable head envelope from history
and record the result, including failed reviews, without repeating review. A
durable collection-start record in `consumed/KEY-aN/collections/<collectionId>.json`
stores launches and the active gate incarnation. Before a receipt exists, a dead
group permits `collectionRetries` (default 1) more launches of the same
collectionId; exhausted retries record `failed`. A live or unverified gate keeps
the round in flight, never failed. Any receipt, including provider failure, ends
retries; immutable history wins over mutable head evidence. Reclaim a stale
per-head lock only through its exclusive `.reclaim` marker after proving
holder/group descendants dead.

Receipts carry no signature: `evidenceRoot` sits outside every worker grant
(launch, gate and collector check it), so its regular files under `history/` are
the receipts; older signed envelopes still read. No command writes to Linear.

Ship pins capture orchestration.ship.botChecks from the immutable base: unique
names, default ["Greptile Review"], [] means no bot. Workers cannot override them.
New attempts use the pinned Ship gate's persistent thirty-minute bot clock from
first fully green mandatory CI; no reset on fixes/restart, no bot-timeout park.
Timely P1 is fixed in the PR, P2 fixed or answered in botRemarks; no re-wait on later heads.
The certificate records Бот: ответил|молчал|нет; installed Deploy waives only bot
checks/late bot remarks with that line. CI and owner remarks remain blockers.
Bot checks must not be required by branch protection (Mono requires only validate).
Products set [] only after installing this compatible release and restarting orchestration.

Attempts from before the bot clock end before this release installs in quiescence;
no bot-unavailability amendment exists. ROUND_LIMIT stays 3, REVIEW_PRODUCER,
verification fields and the PR body marker stay.
A ship-fix still names a new gate attempt/stateFile/head/proof and preserves old
state; task bot clock in reports/<Issue>-a<attempt>-ship-bot.json survives all of them.

### Late bot feedback

At every product deploy and orchestrator restoration, read bot reviews/comments
on merged PRs from the last processed point in the journal: last update time and id.
Read all pages and select updates after that point, with no age window; include inline reviews.
For reviews without updatedAt, reread prior reviews and compare their bodies and inline
comments with the last processed version; an edit is new feedback even for an older id.
Turn every late P1/P2 into a correction Issue, deduplicating by
PR/review id and finding. Record/read back the Issue before advancing the journal
cursor. Failed writes leave the point unchanged. On first adoption, create the four
known outstanding P1 Issues immediately; the PR worker does not own these writes.

Launch pins are immutable with their fingerprint (`effectivePins`, round binding);
pins versions no longer exist and an amended registry entry from an older pack is
refused. A task change: write the «Изменение задачи» comment on the Issue in
words, then resume the same session with `resume.mjs` request `{root, issue,
resumeFile, taskChange: <comment link>}`; the resume file repeats the comment's
words and its link, since reviewers cannot open Linear.
Resume records the delivered text append-only in `dispatch/KEY-aN/task-changes.json`
and the review round reads it with the Issue; a refused resume records nothing.
Resume carries no grants or network override: a risk, critical or grant change is
a new attempt on the same branch.

On spawn, pin evidenceRoot and the complete workerWritableRoots in the request/registry. Build collection and worker verification requests from the launch pins. Use ~/.mono-agent-workflow/evidence/<product>/ outside EVERY
worker-writable root (including the orchestrator root and temporary grants).
Only the collector outside all worker sandboxes runs collect:true. The gate runs the read-only review round ([Review rounds](#review-rounds)) on an export of the pinned tree and runs no verification. Keep all orchestrator control state read-only. Repository-configured executable Git filters are unsupported by privileged gate reads: the gate refuses before execution. If a product requires such filters, obtain a trusted isolation policy instead of disabling this check.
Publish enforces code → preflight → ship: read the latest earlier phase reports; missing or mismatched predecessors refuse. Fallback publication supplies --root. Worker collect:false must pass before ready.
A review fix uses a new head and collectionId: preflight-collect:<head>:<n>, with n incremented for each round request on that head, including a retry after a refused or failed round. Never let a worker collect or select new pins. Preserve failed receipts.
The gate locks collection per head in evidenceRoot. Spawn releases the registry lock after durable PID registration, waits for thread.started outside it, and registers the same attempt/PID thread under a short lock. Collector reclaim uses the incarnation/group checks and marker above; never remove a live or unverified lock or start a competing collector. Before the ship gate independently run preflight collect:false with the same dispatch request; Preflight and merge stay bound to the head (`deploy.mjs --match-head-commit`).
Keep reports as the sole writable mailbox; journal, registry and the round ledger remain outside the sandbox grant. Hostile local operator attestation remains out of scope.

The worker keeps in-phase order: drift sync before PR, ready certificate before
formal review, In Review after PR. Keep phase=code|preflight|ship and the same
delivery context/log. A retry after terminal parked archives a reconciled capsule
only after the new attempt has read the Issue's Linear state back; never erase old
receipts.

Consume final green only after current preflight/ship gates; landing still
requires the code and preflight reports and a result for every admitted round of
the attempt. For parked, read
the worker's park comment back; if the worker died without one, write the
reason/text and next action to Linear in this SAME turn, read it back,
and then decide/escalate; missing write access remains an explicit pending action,
never a hidden stop. No report → recovery, never implicit green.

## Heartbeat

The Monitoring Protocol defines when to intervene; the heartbeat is the
external pulse that notices dying workers without spending orchestrator
turns. The runtime is `scripts/watch-workers.mjs`, resolved from the dispatched
pack root; the same source serves development and fixtures. It reads worker
state and, in persistent mode, atomically writes its own `watcher.json` each tick: pid,
procStart, packVersion, startedAt, beatAt, intervalSec. It emits one stable
line per watcher event to stdout —
`<ISO time> EVENT:<stall|dead|spawn-fail|failed|completed-without-report|report|phase|phase-rejected|gate-ack|halt|idle> <ISSUE-KEY|-> <detail>`.
`phase-rejected` names the task and mismatched identity fields when a phase
report fails strict report-to-task correlation. It never accepts the report or
suppresses liveness on its strength.
The watcher observes the active registry (`workers.json`), not the
directory's history; retired Issues' logs are outside its scope.

- At session start/restart, before any worker spawn or resume, the orchestrator must
  start the watcher against the mailbox root:
  `node '<pack-root>/scripts/watch-workers.mjs' --root ~/.mono-agent-workflow/orchestrator/<product> --config <cfg>`.
  Use the absolute product config path so watcher and worker share delivery clocks.
  Substitute `<pack-root>` with the dispatch pin or loaded plugin root;
  never use the product/worktree current directory.
  Keep it as a tracked background process of the session, with its stdout
  observed by the runtime's monitor primitive (Claude Code: Monitor with
  `persistent: true` or equivalent) continuously for the whole wave.
  Periodic wakeups are a fallback only as an explicitly recorded degradation;
  record the cause and binding in the ledger, and record actual monitoring recovery.
  Under `launch.lock`, spawn/resume require a pulse no older than three intervals,
  no more than one second in the future, and a live pid with matching procStart.
  `watcher-required` gives the start command; refusal registers no attempt and
  consumes no attempt allowance. Read-only `spawn --pins` is exempt.
  The common launch path rechecks the pulse before spawn under the same lock.
  A launch registers its attempt and a resume records its task change only at that
  boundary; pre-spawn refusals and failed process creation leave neither, while an indeterminate real
  launch retains its recovery evidence and refuses an automatic duplicate.
  If the session and watcher disappear together while a worker runs, the pack
  cannot detect that loss; the orchestrator environment owns that supervision.
- Each changed phase report file emits `phase`, regardless of stage order.
  Deduplication stays per file/mtime/size; a round wait follows the round
  request file and its ledger result, not the phase reports.
- Watcher liveness events are Monitoring Protocol triggers: treat `stall`,
  `dead`, and `spawn-fail` lines as inspection triggers — read the worker's
  latest state first, then act on confirmed need. An alarm alone is no owner
  blocker; false alarms and other no-change wakeups stay silent in chat and ledger. `spawn-fail` feeds the spawn
  verification kill+retry rule in Worker Transports. Non-JSON contamination
  before later valid JSON events produces one diagnostic warning on stderr,
  not a repeated watcher event, and does not suppress stall/dead checks.
- `completed-without-report` and `failed` on Claude Code require recovery in the
  same session after reading the latest phase state; neither is a terminal task
  outcome. Only an attempt-correlated green/parked report supplies that outcome.
- `report` is emitted for managed `codex-cli` and `claude-cli` workers, whose JSONL log provides
  the correlation surface. The report must match the worker registry's A5
  identity and issue/stage, and must satisfy the exact v2 freshness predicate:
  report mtime is at least the log birthtime and at least log mtime minus the
  stall threshold. On `report`, read the correlated report and consume its final green/parked outcome.
  Report delivery is at-least-once across watcher restarts:
  one process suppresses an unchanged mtime+size version and emits an updated
  version, while a restarted watcher emits the current version once again.
  The consumer deduplicates by reading the report's current state.
  Desktop/fallback transports keep their existing report-polling contract; the watcher never
  emits `report` for `claude-code-desktop` or `fallback` entries.
- `gate-ack` rides the same correlation surface as `report` and the same
  at-least-once rule: managed CLI entries only, registry-matched identity and
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
  the delivery that can have a startup gate phase — a `mono-deliver` log — so an ack
  beside a legacy `mono-preflight` or `mono-ship` log, which carries no
  lifecycle move, is spurious and neither delivers nor suppresses.
  A fresh usable gate-ack suppresses `stall` and both `dead` branches for that
  worker during a bounded handoff: `gates-passed` waits for lifecycle
  application and wait-mode consumption or resume. A valid `blocked` ack gets the same bounded suppression until its stage
  report is observed or the ack is consumed, so the normal ack-before-report
  interval cannot start duplicate healing. That suppression is bounded twice
  over. Normally the
  consuming the ack ends the startup window. Wait-mode .applied gets only the
  fixed post-consumption continuation in Monitoring Protocol; legacy rename
  immediately re-arms the ladder. When both a `gate-ack` and a `report` are emitted for the
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
  confirmed intervention is never routine polling. An inspected alarm with no
  change creates neither a routine ledger entry nor an owner message.
