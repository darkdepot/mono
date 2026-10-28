# Delivery Worker Contract

[Landing](landing.md).

## AFK Contract

Use dispatch Issue/branch/worktree. No branch changes, sub-workers, session
management, other-Issue edits or orchestrator state access (workers.json/ledger.md/
control.json/dispatch/consumed/logs/other reports). Read-only: own
consumed/<KEY>-gate-ack-a<N>.json and pinned own snapshot/design.json and
snapshot/design/*.png. No secrets/.orchestrator commits or
user questions: mailbox recommendation, stop. Other registry/dispatch reads: gates only.
Report before stops; passed pause ack only. Sequenced stops park; standalone
keeps statuses.

## Orchestration Mode Precedence

Snapshot replaces Linear/resolver; skill owns rules, dispatch facts. Queue after
gates; confirm before dependent work except the code-report case below. Disclose
lag; no judging unapplied state/inferred/skipped checks. Missing inputs block.
Standalone parks needs-decision; interactive keeps direct access/approval/handshake.

## Pack identity gate invocation

Before work/resume: all present dispatch identity pins, exit 0 and
pack-state: identity verified, else block. [Compatibility](install.md#compatibility).
Use the dispatched pack root, never the checkout; single-quote paths/pins.
Append `--source-commit` when the dispatch supplies `sourceCommit`.

```bash
node '<pack-root>/scripts/verify-pack-state.mjs' identity \
  --pack-root '<pack-root>' --pack-version '<dispatch packVersion>' \
  --surface-revision '<dispatch surfaceRevision>'
```

## Pre-applied files

At start match `git show <sha>` blobs to dispatch commit/files/sha256 and Issue
manifest; never edit them. Findings park `blocked` with exact replacement bytes;
artifact owner repairs Tech Spec/record or renews issue-only Issue, then NEW dispatch.
Amendment/resume cannot apply a repaired manifest.

## Two-Phase Dispatch Handshake

Initial moves only, including Issue activation in Delivery Project. Pre-move
snapshot is correct. Before ack verify implement entry/approval/seam/lane pre-start delivery check.
On gate completion/blocker/stop write reports/<ISSUE-KEY>-gate-ack-a<N>.json;
denial: same name in <worktree>/.orchestrator, never both.

```json
{
  "issue": "<ISSUE-KEY>",
  "phase": "gate",
  "gates": [{ "gate": "<gate name>", "status": "pass | blocked", "evidence": "<one line>" }],
  "status": "gates-passed | blocked"
}
```

Unique/nonempty gate names. gates-passed: exact set/all pass; blocked: nonempty
subset/one blocked. Blocked ack before report (missing blocked; adverse needs-human),
no move. Passed: no code/move/queue/report. Codex wait-ack expires at ack mtime +
ackWaitSec → write-unconfirmed. Applied read-backs amend state; delivery check,
no identity rerun. Resume: Codex exits; desktop/fallback retains session; all move
read-backs and identity/check rerun. Never repeat moves. No-move retry: current
snapshot, no ack/amendment. Consumption is not approval.

`claude-cli`: passed startup ack stops; orchestrator applies/read-backs, resumes
same session. Phase/collection waits: plain pack command, foreground, full existing
timeout under raised Bash ceiling; no backgrounding/sleep/polling substitute.
Report refusal before stop. Preflight owns external committed-head review/ready
disclosure; deadlines/queues unchanged.

## Sandbox ladder

Workspace-write/network: worktree, derived worktree/common Git directories,
<root>/reports (--add-dir spawn; writable_roots resume). codex 0.153.4 guards
explicit linked-worktree metadata. Set capsule.writable_roots at launch/resume.
Orchestrator root/confirmations/registry/control/consumed/logs: read-only.
No early PR/push/unrelated network; standalone implement: no network unless
excepted; preflight network/.git, ship push. Exact hidden grants. Disabled
sandbox logs in orchestrator ledger; denied mailbox uses same uncommitted JSON
fallback.

## Context seam

Before lifecycle/scope gates: snapshot Issue/marker/config/verified label/
authenticated approval/emit-fingerprint. Whole-body SHA-256; no inferred oracle/
lane/sixth field. Keep parent/marker/label/approval provenance for fallback.
Project-first: approved Project/PRD/Spec-record-or-exception/Issue; candidate is not proof.
Apply `references/issue-only-lane.md` Context Contract/Resolver/fallback/candidate/
freeze/exit: `approval_status=approved-fresh`, matching fingerprints/owner, eligible
risk, oracle acceptance/verification. Valid lane needs no Project docs; broken
markers never downgrade. Implement: integrity→needs-human, missing prerequisites→
park/restart. Preflight candidate/missing docs/deep-risky escalation→drift-candidate/
fallback/higher-risk review, never ready outside lane. Ship bad approval→stop gates/PR,
no-promotion handoff.

Project start: by=owner; PC-019 allows by=orchestrator with reason/countercheck
(model/version outside the fence in that comment) only with «Ведёт оркестратор»
outside the last Idea approval fence or earlier explicit owner Project comment.
Delegated stale/legacy-migrate Idea needs a new owner button, confirmed record and
fresh check. Legacy package/start or bundled approval can authorize code;
«запускай реализацию» permits Delivery/branch/code; documents alone do not.
[PC-016/PC-019](contracts/project.md).

## Delivery and pre-ship gates

Readiness-only; no findings/writes/repair/install. PASS inspected/unblocked; FAIL
violation; BLOCKED unavailable. Return mode/meaning/boundary/unblock;
failure: FAIL - Linear <mode> not ready.
Delivery: Delivery Project/current PRD/Spec-record-or-exception/approved Issues/start/
coherent risk-review; docs alone fail. Issue-only pre-activation: oracle/marker/
label/fresh authenticated approval/review; started/terminal fails. Retry/read-back:
configured started/nonterminal, no Project for issue-only.
Pre-ship: diff/Issue match, recoverable current preflight/review/artifacts, synced
drift, no stale PR chips/raw URLs; lane oracle/fingerprint replaces docs. Bad
approval stops PR/gates. Reject wrong roles, mechanics/full copies/brittle scripts,
premature code/Delivery/missing review; no fail-closed package creation.

## Review contract

Read-only package/config/branch/PR; no artifact/comment/Issue/PR/lifecycle/approval/
worker writes. Outcomes: ready/advisory-ready/needs-fixes/blocked. Apply artifact/
execution quality, coherence/feasibility/one-PR/durable AFK-HITL, applicable UI/
security/data/ship/deep-risky architecture. Valid lane needs no Project/docs.
Return verdict/meaning/mode/risk/gate-reason/inspected/boundary/next; findings
(blocking/proposed-fix/decision/fyi): artifact/evidence/impact/recommendation/owner.
Missing context/disposition blocks. Repair owners: handoff/issue renewal/ship drift.

## Execution and artifact handling

Apply `references/execution-quality.md`/`references/artifact-quality.md`.
Intake: paths → snapshot/reviews → decisions → configured roots → gstack, no broad
scans; absent roots unavailable. Approved Linear outranks scratch; carry compatible
stale choices only. Missing/conflicting scope/proof/risk/slicing stops writes;
no stale certificates/local body copies. Translate roles. Notes (omit empty):
read/unavailable/stale_or_ignored/conflicts/decisions_carried_forward/confidence_boundary,
one Russian sentence.

## Certificate recovery

Latest marker-bearing Linear comment/resource only: quote markers there.
Apply `references/human-friendly-output.md` Machine Blocks In Linear Comments;
report/chat omit human lead.

## Delivery Reports and Capsule

Dispatch: green/parked terminal; ready/implemented-needs-preflight intermediate.
Stops park, no respawn; standalone retains statuses/certificates.
reports/<ISSUE-KEY>-phase-<code|preflight|ship>.json or denied-write .orchestrator,
never both. Final fields + phase/increasing positive sequence/kind
(phase|confirmation-request)/head/phase_result. Capsule phase/head match;
open_queue=ordered linear_mutations_pending. Writes: stable id/operation/target/
payload; changed payload→new ID, new report→new collectionId. Keep obligations
across heads, omit confirmed writes; certificate: append #/certificate once.

Publish/wait: delivery-state.mjs; confirmation:
confirmations/<ISSUE-KEY>-phase-<phase>-a<N>-s<sequence>.confirmed.json.
Wait rejects dispatch-derived capsule.writable_roots paths; binds report digest/issue/attempt/phase/
sequence/verified results. Reconcile writes/collection receipts; apply missing only, fsync
consumed/<ISSUE-KEY>-a<N>/ results; confirm whole queue. Unknown/conflict/read-error
or partial/stale/foreign confirmation blocks. Reconcile lost replies/comments.
Resume dispatch/capsule/actual branch; preserve done/foreign changes; never reset/
repeat applied moves/writes. Timeout
orchestration.delivery.confirmationTimeoutSec (default 1800 seconds) parks
write-unconfirmed (запись не подтверждена).

Only generated implemented-needs-preflight comments defer waiting; other/unknown
writes and empty queues wait. publish generates full code-exit comments; stops wait,
no start-comment queue. Preflight carries pending code comments;
revisions use new IDs and mark old comments stale, pending or applied. Immutable sequence snapshots beside phase reports bind capsule.deferred_reports
sequence/reportDigest; predecessor checks verify fingerprints/carried/replacing comments.
Preflight confirms all before formal review, no extra Ship check. Green needs
all obligations. Confirm drift before PR, ready before review, In Review/PR chip after PR.

Pin product/evidenceRoot/packRoot/skillsRoot/risk/critical/verification/grants.
~/.mono-agent-workflow/evidence/<product>/ outside ALL grants, including
worktree/orchestrator. Orchestrator collect:true only; worker collect:false.
Keys grant no writes; hostile operator out of scope (one user/host).

Amend: "Effective attempt pins" pins.v<n>.json; no report version field.
Commit; collect:false exit 2 is pending. Publish only returned publishRequest in
payload.request, kind=confirmation-request:
id=request.collectionId=preflight-collect:<head>:<n>, operation=preflight-collect,
target=<head>, payload={request}. Adapter: immutable receipt path/digest/gate even
on failure; confirmation proves completion only. Verify collect:false.
Findings: apply references/review-admission.md. Repeated key/class parks needs-decision
before edits/new requests; otherwise fix/recommit/request or propose decline.
Transient: same head/route, increment n/sequence.
Ship: preflight={full collect:false request}; judgment={head,preShipReview,
readinessCheck,documentation,documentationReason,closures,botRemarks}. Verify sealed
head/merge-base receipt before judgment; no string substitutes.
Orchestrator rechecks preflight before ship. Ship-fix amendment: next ship-gate
attempt, new head/stateFile; preserve old state/task attempt. No gate-attempt cap;
existing window/review thresholds/declines/class stops/caps unchanged.

## Implementation exit evidence

Code exits: criteria, summary (2–3 product-language lines),
not_built/not_verified arrays (possibly empty); phase_result string.
After admission capture-criteria freezes Issue snapshot/standalone start-read
«Готово, когда:» into <root>/reports/<KEY>-criteria-a<N>.json, never report fields.
Immutable; publication checks each item in order before writes: no omission/addition/
rewording/reorder, whitespace normalization only. Standalone:
uncommitted .orchestrator. «Как проверить» separately in verification_items.
criteria: criterion, done:boolean, outcome:confirmed|unverified|broken,
proof (before edits), result (observed), head (40 hex), worktree_fingerprint (64 hex).
confirmed: done:true, command exit 0 on recorded delivered head/fingerprint after
last relevant edit, including dirty edits. Failed-run subtests cannot confirm; narrow passing runs can. Fingerprint only by
`node <pack-root>/scripts/worktree-fingerprint.mjs --worktree <worktree> --delivery-root <delivery-root>`;
Command in criterion proof. SHA-256: `git diff --binary HEAD`, then sorted
nonignored untracked files (`git ls-files --others --exclude-standard`), each:
path, NUL, content SHA-256 hex, NUL. Both sources exclude only delivery-root paths
when inside the worktree (`.orchestrator/` standalone). No other hashes/exclusions; report/chronology in delivery-root.
not_built:[{what,reason}]; not_verified:[{what,why,risk}], one per unverified
criterion, what=criterion. unverified/done:true built/untested; done:false unfinished;
broken never becomes unverified. Screen visibility without browser: unverified,
even with passing HTML tests. Summary: «экран в браузере не проверен».
Tiny text-only summary exactly 3 lines: result; «поведение не меняется» exception
with reason/check boundary; Preflight handoff. Evidence layers excluded.
Issue comment: summary → «Не проверено» → «Найдена поломка» → evidence
(criteria, significant-state table before edits, exclusions, decisions).
Breakage/unfinished/no progress: blocked, saved state. implemented-needs-preflight:
all done:true/no broken; publication rejects incomplete success.

Empty criteria without capture only for pre-capture refusals:
capture refusal (missing/ambiguous/unsupported-language section): blocked;
start refusal: blocked|needs-human. pre_capture_stop: kind=capture-refused|start-refused,
command/exit/reason; capture also absolute issue_file, start also verdict.
Exit 0/pass is no refusal. Comment: reason, expected format
«# Критерии приемки» / «Готово, когда:», missing labels only when absent.
Never invent criteria; other reports require capture/full ordered comparison;
completed work without it is refused.

## Worker Report

Path: ~/.mono-agent-workflow/orchestrator/<product>/reports/<ISSUE-KEY>-mono-deliver.json;
denied: <worktree>/.orchestrator/<ISSUE-KEY>-mono-deliver.json. English JSON;
verbatim verification, AFK stops.

```json
{
  "issue":"<ISSUE-KEY>",
  "stage":"mono-deliver",
  "attempt":1,
  "status":"<green | parked>",
  "reason":"<parked reason|null if green>",
  "text":"<result/proof/next/owner>",
  "packVersion":"<pin>",
  "sourceCommit":"<optional pin>",
  "surfaceRevision":<repeat the dispatch pin, integer>,
  "branch":"<branch>",
  "head":"<sha>",
  "phase_result":"<result>",
  "summary":"<lines>",
  "criteria":[{"criterion":"<text>","done":true,"outcome":"confirmed","proof":"<proof>","result":"<result>","head":"<sha>","worktree_fingerprint":"<sha256>"}],
  "not_built":[],"not_verified":[],
  "changed_files":[],
  "tests":{"run":"<cmd>","result":"<result>"},
  "verification_items":[
    {"item":"<item>","status":"pass | deferred | not-run","evidence":"<reason/owner>"}
  ],
  "question":"<str|null>",
  "recommendation":"<str|null>",
  "linear_mutations_pending":[],
  "capsule":{"phase":"<code | preflight | ship>","head":"<sha>","open_queue":[],"decisions":[],"local_passes":[{"id":"<id>","head":"<sha>","result":"<clean|findings>"}],"writable_roots":["<grant>"] },
  "certificate":"<str|null>",
  "notes":"<str|null>",
  "next":"<mono:deploy|owner>"
}
```

Parked reasons: blocked, needs-decision, needs-human, drift-candidate, timed-out,
scope-drift-needs-handoff, write-unconfirmed, evidence-limit (предел доказательств).
Decisions: exact question/recommendation. Orchestrator records parks in Linear this turn/read-back. Green: confirmed queues/current-head gates pass.

Keep every Issue «Как проверить» line verbatim/in order in verification_items;
pass | deferred | not-run, never unrun pass; name deferred owner. Name judgment/state. Repeat pins; standalone dispatched status,
sequenced intermediate.
