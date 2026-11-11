# Orchestration Policy: Delivery

Part of the `mono:orchestrate` control-plane policy. `references/orchestration.md`
holds the always-read part and the map of parts. Read this part before the watcher
starts, while `workers.json` holds an entry or a worker report, capsule or queued
write is unreconciled, and before QA, merge or deploy of a shipped Issue.

## Independent QA before merge

After every confirmed green ship, resolve the recipe from the product config's
`qa` block or the product's explicit `<!-- mono-qa product: NAME -->` record in
`references/qa-recipes.md`. Examples, `workflows.qa`, `qaAuth` and assignment
files do not connect a product. No recipe: do not launch a tester; preserve the
existing merge path and record «тестировщик не подключён» in closeout.

For connected products launch **mono:qa on the host**, on role `qa`, outside the
worker's copy. Give it the task, approved PRD/design, current PR head, confirmed
ship certificate, current main as test-merge base and recipe. Save its expectation
list before actions. The tester publishes and reads back its report, certificate
and main recording in the task; the project pass also publishes its report in the
Project. Worker self-assessment cannot replace this pass.

Failed/unverified holds merge and wave installation. Send concrete bugs, steps,
expected/actual and evidence through the existing ship-fix amendment, preserving
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

The orchestrator applies [Merge validation](landing.md#merge-validation): ordinary
merge and installation require a green current landing branch tip, and every
merge requires checking its exact GitHub merge SHA before continuing. A named
corrective Issue needs the recorded `corrective` exception before its merge;
the resulting commit must pass before ordinary delivery resumes. Deploy and
closeout retain their existing phase ownership and approval requirements.

With `landing.install: "wave-drain"`, use [Install](landing.md#install) for batch
installation, shared attempt state, halt and recovery. The orchestrator records
landings, retains Issues In Review until batch close, then closes and retires each
task with its proof. It owns first rollout from merged main and removes halt after
close or failed installation; worker stages never perform these actions.

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
before healing. Phase event: validate capsule/attempt and consume its whole queue
through the barrier below; do not resume a worker waiting on a confirmation file.
The watcher suppresses phase liveness only for the bounded confirmation wait.
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
and checker from different model families), then sandboxed verification, and
signs one `gate-review-v3` receipt. The collector host needs both the Codex and
Claude CLIs logged in by subscription; a single-family setup gives
`not-reviewed`, and so does a logged-out CLI whose role has to run (the checker
runs only when the reviewer reports findings).

Between rounds do nothing: the worker fixes open findings and requests the next
round itself. At most three completed rounds per pins file, counted from signed
receipts; the same head reuses its round; `not-reviewed` spends nothing.

Parks:
- needs-decision, `review not-converged after round 3` or `review round limit
  reached`: narrow the contract, split the Issue or change the approach, then
  `accept.mjs amend` (the new pins version opens a fresh three) or start a new
  attempt.
- needs-decision, `verification failed on the reviewed head`: decide whether the
  code or the environment is wrong; a new request on the same head reuses the
  round and reruns only verification.
- blocked, `not-reviewed twice in a row`: restore both CLI logins, then amend to
  resume.

`clean-with-successors` passes. Its candidates are older defects, minor P3
leftovers from round 2 on (never data, security or gate bypass) and, on round 3,
leftovers both roles call harmless. After merge file every `must-file` entry of
the receipt's `review.successors` list (an older dangerous defect; a minor one
only for data, security or gate bypass) and decide
which of the rest become Issues; the gate line and ready certificate repeat the
list. The collection window (`collectionTimeoutSec`) must cover a round, which
takes up to 25 minutes on a large risky change, plus verification and one rerun.

## Delivery Write Barriers

Only the generated implemented-needs-preflight code-report Issue comment skips
waiting. Unknown/other writes and stopped reports wait; no start-comment queue.
Use the worker-contract closed list: pending code comments carry into Preflight,
new versions replace them and mark old comments stale. Preflight's whole queue
confirms before formal review; timeout parks write-unconfirmed. Predecessor
checks verify report fingerprints even for deferred code. This adds no Ship gate.
The watcher emits the code phase event but does not treat that deferred comment
as a blocked writer; other phase waits keep their existing deadline/liveness rules.

Poll phase reports as well as events; events accelerate, never prove application.
Use installed `scripts/orchestrator/accept.mjs ack --root DIR --issue KEY
--attempt N`: validate the sole ack location, registry correlation, gate coverage
and outcome before exposing any plan. Without an existing consumption record,
the plan contains planDigest, plannedAt, ackDigest and moves with moveDigest.
After connector writes, --readback FILE requires that planDigest and one dated
read-back per move observed no earlier than the plan. Identical prior consumption
completes rename/gate cleanup without a new plan; contradictory records refuse.

Run installed `scripts/orchestrator/collector.mjs start|stop|status --root DIR
--issue KEY --attempt N` outside all worker sandboxes. Start once per attempt;
stop at retirement. It confirms empty and collection-only phase queues, never
connector queues. Inspect `reports/KEY-collector-aN.log` for refusals/results.
`reports/KEY-collect-attention-aN.json` signals an admission refusal to the orchestrator once per report digest/current registry pinsVersion/current decision digest tuple, persists across restarts, and clears when the current collection-only preflight report is admitted, including a replacement for the refused report.
The attempt lock `reports/KEY-collector-aN.lock` stores pid/procStart and the
active gate incarnation. Start reclaims only a dead holder and dead gate tree;
unknown process telemetry refuses. Collector and gate use separate dedicated process groups. A gate waits on stdin
until the collector durably records its incarnation; parent death before release
cannot launch an unregistered gate. Validation also registers its gate group in
the held per-head lock before release; reclamation checks both recorded trees.
Group membership preserves orphan descendants.
Legacy locks without group metadata require manual reconciliation; an unrelated
live member of a shared group also prevents reclaim. Stop verifies incarnation,
requests graceful shutdown and lets an active gate finish before releasing locks.

Phase correlation uses validatePhase, registry issue/attempt/pack identity, the
sole standard/fallback location, report digest and existing predecessor barriers;
terminal delivery reports never substitute for phase reports. Collection admission
shares launch.lock with amend, reads registry pinsVersion, and seals reportDigest
and manifestDigest. Old admitted requests recover against their admitted version;
new stale-version requests refuse. Before collection, find signed history by
collectionId and compare actual receipt bindings (including risk/critical, dataset,
grants and verification) against the admitted request. Under the per-head lock,
restore the mutable head envelope from history and confirm completion, including
failed runs, without repeating review. A durable collection-start record in
`consumed/KEY-aN/collections/<collectionId>.json` stores launches and the active
gate incarnation alongside the attempt's admissions. Before a receipt exists,
a dead group permits a bounded retry of the same collectionId/admission. Recheck
current class/cap on every launch without reserving new capacity. The counter
survives collector restarts. Any signed receipt, including provider failure,
ends collection retries; immutable history wins over mutable head evidence.
Reclaim a stale per-head lock only through
its exclusive `.reclaim` marker after proving holder/group descendants dead.
Live or unverified holders refuse. History-first receipt order and gate semantics
remain unchanged; all queue confirmations use delivery-state's existing barriers.

Use `scripts/orchestrator/accept.mjs report --root DIR --report FILE` for connector
queues. For nonempty queues, before opening or printing writes it uses the existing
delivery-state barriers to validate all predecessor reports/confirmations; a refusal
exposes no connector instructions or new session. Empty queues establish the session
first, then validate predecessors during the real confirmation. Session setup failure
leaves no confirmation. No predecessor rules are duplicated.
It opens `{sessionId, openedAt, reportDigest}` under
`consumed/KEY-aN/sessions/<sessionId>/session.json`; `current-<reportDigest>.json`
identifies the active session. A retry first prints the reread list (find comments
by marker before republication), then opens a fresh session and prints expanded
certificate writes. Supply --session UUID and repeated --observe 'writeId=JSON'
(or writeId=@file) observations with sessionId, writeId, reportDigest, writeDigest,
observedAt, state and evidence. Fresh means at/after publication and session opening;
missing additionally requires absent:true. Complete present observations delegate
delivery-state confirm with MONO_ACCEPT_ROOT, MONO_ACCEPT_SESSION and
MONO_ACCEPT_REPORT, using the pack `scripts/orchestrator/linear-adapter.mjs`.
The adapter recomputes the report/write digests, verifies the active session and
returns unknown for absent/stale/foreign observations. apply prints a connector
instruction on stderr and returns no success result. No command writes to Linear.

Ship pins capture orchestration.ship.botChecks from the immutable project base
(default ["Greptile Review"], nonempty unique names). A worker cannot override this
list. For a confirmed bot outage, use accept.mjs amend --bot-unavailable "<reason>"
with the current --issue/--attempt and recovery --text; the decision is scoped to
that task attempt and does not carry into another attempt. A ship-fix amendment
names the next ship-gate attempt number; the worker keeps the old state and uses
a new stateFile for the new head within the same task attempt. Ship-gate attempts
have no machine bound; review/class/cap gates and evidence-window code are unchanged.

Launch pins are immutable. `accept.mjs amend --root DIR --issue KEY --attempt N
--text TEXT` writes `pins.v<n>.json` and prepares a resume file/request before
calling resume.mjs; only a successful resume advances pinsVersion in the registry.
A refused resume prints its reason and leaves the registry unchanged. Amendments
serialize across preparation and resume; registration and admission share launch.lock.
Before resume, `amendment.pending.json` beside the version files retains their digests,
attempt/thread identity and the prior registered resume. An identical retry compares
that record with the newly registered resume and finishes the pins update without
launching again. Changed prepared bytes or a different amendment refuse while a
delivered version awaits registration. Cleanup after registration is recoverable too.
The launch-may-have-started marker is written before resume. Clear it only for
this invocation's positively identified pre-spawn refusal for a live wait worker,
after launch.lock verifies unchanged attempt/thread, current version, prior resume
and wait record. Restore prior grants and keep the version prepared for retry
after worker exit. Changed state, post-spawn refusal or ambiguous failure retains
all evidence and refuses automatic restart; correlated delivery recovers forward.
Risk/critical only escalate; dataset changes
require a newer --review-dataset-version; --worker-writable-roots must be the
complete effective grants; --full-snapshot --snapshot DIR includes the full docs
in the resume amendment. The document bytes participate in amendment identity;
changed bytes require a new version even at the same source path. The version
stores fullSnapshot directory/digest and subsequent independent amendments carry
those verified documents forward without requiring the caller to resupply them.
Same amendment bytes recover the same version.
Registered amendments retain completion history by amendment digest, including
prepared-file digests and their resume results, after pending cleanup. Identical
completed retries return the original result without another launch, whether the
delivered worker is live or has exited. Later amendments preserve these records;
replaying an earlier result leaves the current pins, grants and worker unchanged.
Changed completed bytes refuse; a new delivery needs a new amendment text.
An undelivered pending replacement retains the original rollback grants;
provisional grant expansion from an interrupted resume cannot become its baseline.
`command-state.mjs admitCollection` and amend use launch.lock. Admission layout:
`consumed/KEY-aN/admissions/<collectionId>.json` contains exactly
`{collectionId, reportDigest, pinsVersion, manifestDigest}`; manifestDigest is the
canonical digest of launch pins overlaid with that amendment version. New bound requests
derive their version from pins.file (pins.json = 0; pins.v<n>.json = n), require the
current registry version, and match the full file path, digest and effective
request/grant fields, including reviewDatasetVersion and dataset path. The stale
version refusal names the full expected pins path; no report version is required.
Previously admitted requests recover before new-request checks; legacy admission
and U14 report-digest/registry-version bindings remain; attention also tracks current decision state. Omitted
reviewDatasetVersion means version 0 only for an unversioned baseline; it cannot
bypass a newer amendment. Identical previously admitted requests remain recoverable under their
original version. MONO-96 owns receipt collection/recovery, not these commands.

Validate identity/attempt/head/sequence and full queue, including comments and
certificates. Use installed delivery-state.mjs confirm with the orchestrator-owned
pack Linear adapter above. The adapter receives action=reconcile|apply, issue, attempt,
idempotencyKey and write via stdin; stdout JSON returns state=present|missing|unknown
and read-back evidence. Reconcile compares desired payload/target, locates comments
by stable marker/idempotency key, and returns unknown on ambiguity/read failure.
Apply never means confirmed: the runtime reconciles again afterward. Implement
observations with the configured Linear connector; never give adapter authority to a worker.

Runtime fsyncs an applying intent, then the exact per-write present result under
consumed/<ISSUE-KEY>-a<N>/<id>.json before whole-queue confirmation. On recovery
reconcile ALL Linear writes against Linear, even local successes, applying only missing
ones. Keep IDs/payloads stable; conflicting payload for an old ID refuses. Read-back
must prove the desired effect, not merely a successful API response. Retry only
after reconciliation; missing confirmations cannot duplicate comments. Never claim
an unavailable adapter completed a queue: leave pending and park at the deadline.

For operation=preflight-collect, route the adapter to the gate, never Linear.
Validate the single-item confirmation-request against dispatch product, pinned
installed skillsRoot, risk/critical, verification command, worktree/head/base and
evidenceRoot. On spawn, pin evidenceRoot and the complete workerWritableRoots in the request/registry. On resume, any extra grant requires an amended dispatch with the complete effective list; the runtime refuses evidence-root overlap and persists effective grants before launch. Build collection and worker verification requests from these current pins, never an earlier dispatch. Use ~/.mono-agent-workflow/evidence/<product>/ outside EVERY
worker-writable root (including the orchestrator root and temporary grants).
Only the orchestrator outside all worker sandboxes runs collect:true. An optional reviewDataset pin stays bound in the receipt as {source,digest,copy} and archived; reviewers do not receive it. The gate first runs the read-only review round ([Review rounds](#review-rounds)) on an export of the pinned tree; only after `clean` or `clean-with-successors` it
runs verification inside codex sandbox with the worktree and one private temp directory writable. On macOS verification also grants the realpath of `getconf DARWIN_USER_TEMP_DIR` when available: Apple tools write there independently of TMPDIR. Before sandbox launch reject overlap with evidenceRoot, orchestrator root, skillsRoot and packRoot; such a refusal is recorded in the signed receipt, so the completed round is kept. Unavailable Darwin temp leaves the existing verification grants; other platforms are unchanged. Keep TMPDIR/TMP/TEMP in the invocation's private directory. Never use workerWritableRoots as collector grants; keep all orchestrator control state read-only. Exclude skillsRoot/evidenceRoot; a denial probe fails closed if that
boundary is missing. Record the probe independently of the command exit code. Pause the worker during collection. Repository-configured executable Git filters are unsupported by privileged gate reads: the gate refuses before execution. If a product requires such filters, obtain a trusted isolation policy instead of disabling this check. Reconcile
an existing authenticated receipt matching request.collectionId and all pins before repeating collection; failed
reviews are completed runs too, not missing actions. Return present evidence as
{receipt: <evidenceRoot>/history/<runId>.json, receiptDigest: <SHA-256 of canonical envelope>, gate: <exact gate answer>}, including a fail. The runtime checks immutable history identity, digest, signature and collection ID before confirming or accepting confirmation; the mutable head receipt is never confirmation evidence. Fsync that result
and confirm through the same runtime. Publish and confirm enforce code → preflight → ship: read the latest earlier phase reports and earlier sequence confirmations, allowing only the fingerprint-bound code-report deferral above. Confirmations retain the report snapshot, so overwritten phase files do not erase sequence evidence. Missing or mismatched predecessors refuse before adapter calls. Fallback publication supplies --root; confirmation reads the report directory and root mailbox and refuses conflicting copies. Worker collect:false must pass before ready;
A review fix uses a new head/write ID. Use write.id=request.collectionId=preflight-collect:<head>:<n>. Increment n for each collection request on that head, including transient retries after a recorded failure; also advance the phase sequence. Never reuse the failed collection ID for a new run; a lost response retains its original ID. Bind confirmation evidence to the immutable history receipt as well as the current head receipt. Never let a worker collect or select new
pins. Preserve failed receipts. Configure confirmationTimeoutSec BEFORE dispatch
to cover verification plus review. Defaults: `confirmationTimeoutSec=6300`,
`collectionTimeoutSec=4500`, `collectionRetries=1` (nonnegative integer).
Require `collectionTimeoutSec < confirmationTimeoutSec < evidenceLimitSec`.
Launch pins all three collection/confirmation settings in the registry; old
attempts retain their existing confirmation timeout and use the new collection
defaults, so an old 1200-second window refuses collection without adequate budget.
One deadline is phase `publishedAt + confirmationTimeoutSec`; config changes and
collector restarts never reset it. Before a collection launch reserve its full
run limit plus 30 seconds for teardown, reconciliation and confirmation. A
receipt reconciliation uses the remaining window (at most the run limit),
reserving 10 seconds for teardown/confirmation; it requires at least 30 seconds
to start. Confirmation requires 5 seconds left and checks the deadline again
before publication. No new run starts without its budget. An early crash may
leave enough time to retry; a full-length timeout normally will not.
The released gate also holds its original deadline watchdog, including at most
2 seconds of teardown reserve; it kills its group even if the collector dies. After the gate finishes, the watchdog remains until
descendant telemetry proves its group empty.
On timeout signal the isolated group with TERM, then KILL if necessary, and
verify no live descendants remain before retry. Unknown/live groups refuse.
Exhausted retries, insufficient time or stalled reconciliation write `timed-out`
with the technical reason to the collector log and attention file; preserve
history for explicit orchestrator recovery. Project verification retries once
only with a proved sandbox and unchanged head/base; both numbered outputs are
signed in `verification.output`, with the last exit code. Sandbox or consistency
failures do not retry; the reviewer still runs at most once per collection.
Keep it below evidenceLimitSec as a configuration consistency rule. The evidence
limit runs from the ship attempt's startedAt, while confirmation waiting runs
separately from the phase report's publishedAt; the inequality does not prove
evidence freshness.
Pass the same --config to delivery-state.mjs confirm; its adapter timeout uses confirmationTimeoutSec. The gate locks collection per head in evidenceRoot. Spawn releases the registry lock after durable PID registration, waits for thread.started outside it, and registers the same attempt/PID thread under a short lock. Collector reclaim uses the incarnation/group checks and marker above; never remove a live or unverified lock or start a competing collector. Never extend an in-flight deadline; reconcile any late collector completion. Before the ship gate independently run preflight
collect:false with the same dispatch request. The pack collector uses the existing receipt key; no key service.

Publish whole-queue confirmations under <root>/confirmations/, outside all worker write grants. The worker wait refuses any confirmation path overlapping capsule.writable_roots. Keep reports as the sole writable mailbox; journal and registry remain outside the sandbox grant. Hostile local operator attestation remains out of scope. Run scripts/sandbox-contract.test.mjs outside a worker sandbox to prove the real Codex CLI boundary; absent CLI and detected nested Seatbelt are explicit skips, never host proof. Other failures block. The routine verify suite includes this test; the orchestrator runs it outside worker sandboxes for the actual boundary proof.

A confirmation timeout parking the worker as `write-unconfirmed` is an expected
path while a collection continues. Reconcile the late result with the same
collection ID, then confirm the original queue and resume the worker; do not
create a replacement request for a response that was merely late.

Publish confirmation only for the entire digest-bound queue, including empty
queues. Preserve in-phase order: drift sync before PR, ready certificate before
formal review, In Review/PR chip after PR. Keep phase=code|preflight|ship and the
same delivery context/log. A retry after terminal parked archives a reconciled
capsule only after remapping outstanding obligations to its new attempt through
Linear reconciliation; never erase old receipts or replay from an empty queue.

Consume final green only after current preflight/ship gates and all confirmations. For parked,
write the reason/text and next action to Linear in this SAME turn, read it back,
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
  Amendments record possible delivery only at that boundary; pre-spawn refusals
  and failed process creation leave no marker, while an indeterminate real
  launch retains its recovery evidence and refuses an automatic duplicate.
  If the session and watcher disappear together while a worker runs, the pack
  cannot detect that loss; the orchestrator environment owns that supervision.
- Each changed phase report file emits `phase`, regardless of stage order.
  Deduplication stays per file/mtime/size; the confirmation wait uses the latest
  publishedAt, then sequence, rather than the furthest stage.
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
