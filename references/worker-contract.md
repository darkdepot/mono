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
gates; confirm application/read-back before progress. Disclose lag; never judge
unapplied state or infer/skip checks. Missing inputs block. Standalone parks
needs-decision; interactive retains direct access/approval and handshake.

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

Before lifecycle/scope gates resolve Issue/marker/config/verified label/
authenticated approval/emit-fingerprint from dispatch snapshot. Whole-body
SHA-256 only; no inferred oracle/lane/sixth field. Retain parent/marker/label/
approval provenance for fallback. Project-first needs approved
Project/PRD/Spec-record-or-exception/Issue; candidate escape is not proof.
Apply `references/issue-only-lane.md` Context Contract/Resolver/fallback,
candidate/freeze/exit: `approval_status=approved-fresh`, matching fingerprints/
owner, eligible risk, oracle acceptance/verification. Valid lane needs no Project
docs; broken markers never downgrade. Implement integrity error → needs-human;
missing Project prerequisites → park/restart. Preflight candidate/missing docs/
deep-risky escalation → drift-candidate/fallback/higher-risk review, never ready
outside lane. Ship bad approval stops gates/PR → no-promotion handoff.

## Delivery and pre-ship gates

Readiness-only, no findings/writes/repair/install. PASS inspected/unblocked; FAIL
violation; BLOCKED unavailable. Return mode/meaning/boundary/unblock;
failure: FAIL - Linear <mode> not ready.
Delivery: Delivery Project/current PRD/Spec-record-or-exception/approved Issues/start/
coherent risk-review; docs alone fail. Issue-only pre-activation: oracle/marker/
label/fresh authenticated approval/review; started/terminal fails. Read-back/retry:
configured started/nonterminal, no Project for issue-only.
Pre-ship: diff/Issue match, current recoverable preflight/review/artifacts, synced
drift, no stale PR chips/raw URLs; lane oracle/fingerprint replaces docs. Bad
approval stops PR/gates. Reject wrong roles, mechanics/full copies/brittle scripts,
premature code/Delivery/missing review; no fail-closed package creation.

## Review contract

Review package/config/branch/PR read-only, no artifact/comment/Issue/PR/lifecycle/
approval/worker writes. Outcomes: ready/advisory-ready/needs-fixes/blocked. Apply
artifact/execution quality, coherence/feasibility/one-PR/durable AFK-HITL,
applicable UI/security/data/ship/deep-risky architecture. Valid lane needs no
Project/docs. Return verdict/meaning/mode/risk/gate-reason/inspected/boundary/next;
blocking/proposed-fix/decision/fyi: artifact/evidence/impact/recommendation/owner.
Missing context/disposition blocks; repair: handoff/issue renewal/ship drift.

## Execution and artifact handling

Apply `references/execution-quality.md`/`references/artifact-quality.md`.
Intake: explicit paths → snapshot/reviews → decisions → configured roots → gstack;
no broad scans; absent roots unavailable. Approved Linear outranks scratch;
carry only compatible stale choices. Stop before writes on missing/conflicting
scope/proof/risk/slicing; no stale certificates. Notes: read/unavailable/stale_or_ignored/conflicts/
decisions_carried_forward/confidence_boundary (omit empty), one Russian sentence.
Translate roles; no local body copies.

## Certificate recovery

Recover latest marker-bearing Linear comment/resource; quote markers only there.
Apply `references/human-friendly-output.md` Machine Blocks In Linear Comments;
report/chat omit human lead.

## Delivery Reports and Capsule

Mono-deliver: one dispatch; terminal green/parked, intermediate ready/
implemented-needs-preflight. Stops park; no stage respawn. Standalone retains
statuses/certificates.

Phase: reports/<ISSUE-KEY>-phase-<code|preflight|ship>.json; denial: same name in
worktree .orchestrator, never both. Final fields plus phase/positive increasing
sequence/kind (phase/confirmation-request)/head/phase_result.
Capsule phase/head match; open_queue = ordered linear_mutations_pending.
Writes: stable id/operation/target/payload; changed payload → new ID; obligations
survive heads. Omit confirmed writes; new report needs new collectionId. Keep
ID only for an unchanged report. Certificate: append #/certificate once. Short: confirm empty code queue; start
facts in capsule.decisions/Russian ready lead; unchanged machine core.

Publish/wait through delivery-state.mjs. Confirmation path:
confirmations/<ISSUE-KEY>-phase-<phase>-a<N>-s<sequence>.confirmed.json.
Wait rejects paths inside dispatch-derived capsule.writable_roots; binds report
digest/issue/attempt/phase/sequence/verified results. Reconcile writes against
Linear, collections against receipts; apply missing only, fsync results
under consumed/<ISSUE-KEY>-a<N>/, confirm whole queue. Unknown/conflict/read-error
or partial/stale/foreign confirmation blocks. Reconcile lost responses/comments;
empty queues wait too. Resume capsule after break/compaction; timeout
orchestration.delivery.confirmationTimeoutSec (default 1800 seconds) parks
write-unconfirmed (запись не подтверждена).

Confirm in-phase queues before dependent work: accepted drift before PR, ready
certificate before formal review, In Review/PR chip after PR.

Pin product/evidenceRoot/packRoot/skillsRoot/risk/critical/verification/grants.
~/.mono-agent-workflow/evidence/<product>/ outside ALL grants, including
worktree/orchestrator. Orchestrator collect:true only; worker collect:false.
Keys grant no writes; hostile operator out of scope (one user/host).

After amend collect with resume's "Effective attempt pins" pins.v<n>.json;
no report version field. Commit; pinned collect:false exit 2 is pending, not pass.
Publish only publishRequest in payload.request, kind=confirmation-request:
id=request.collectionId=preflight-collect:<head>:<n>, operation=preflight-collect,
target=<head>, payload={request}. Adapter: immutable receipt path/digest/gate even
on failure; confirmation proves completion only. Verify collect:false.
Findings: apply references/review-admission.md. Repeated key/class parks needs-decision
before edits/new requests; otherwise fix/recommit/request or propose decline.
Transient: same head/route, increment n/sequence.
Ready on pass.
Ship: preflight={full collect:false request}; judgment={head,preShipReview,
readinessCheck,documentation,documentationReason,closures,botRemarks}. Verify sealed
head/merge-base receipt before judgment; no string substitutes.
Orchestrator rechecks preflight before ship. A ship-fix amendment names the next ship-gate attempt:
new head/new stateFile, preserve old state, same task attempt. No machine bound on
ship-gate attempts; the unchanged window waives nothing, costing time. Review
thresholds/declines/class stops/caps stay unchanged.

## Implementation exit evidence

Every code exit, regardless of packVersion: criteria (nonempty), summary (2–3
product-language lines), not_built and not_verified arrays (may be empty).
Start records/queues unchanged; phase_result stays a status string.
criteria: every «Готово, когда» item verbatim/in order, never omit/weaken unfinished
work; «Как проверить» separately in verification_items. Fields: criterion, done
(boolean), outcome (confirmed|unverified|broken), proof (method chosen before edits),
result (observed, not promised), head (40 hex), worktree_fingerprint (64 hex at check).
confirmed requires done:true/delivered head; relevant edits stale earlier success,
even without a commit. Fingerprint: SHA-256 of binary diff from HEAD and sorted
untracked path/content hashes, excluding reports; record command.
not_built: [{what,reason}]; not_verified: [{what,why,risk}], one per unverified
criterion with what equal to criterion. unverified/done:true = built, untested;
done:false = unfinished. Broken never becomes unverified.
Screen summary: «экран в браузере не проверен». Tiny text-only report: 3–4 lines.
One Issue comment: summary → «Не проверено» → «Найдена поломка» → evidence
(criteria, significant-state table written before edits, exclusions, decisions).
Breakage/unfinished/no progress → blocked, saved state. implemented-needs-preflight:
every done:true, no broken; publication refuses missing criteria/broken/unfinished
success. Preflight unchanged.

## Worker Report

Path: ~/.mono-agent-workflow/orchestrator/<product>/reports/<ISSUE-KEY>-mono-deliver.json;
denial: <worktree>/.orchestrator/<ISSUE-KEY>-mono-deliver.json. English JSON,
verbatim verification, AFK stops.

```json
{
  "issue": "<ISSUE-KEY>",
  "stage": "mono-deliver",
  "attempt": 1,
  "status": "<green | parked>",
  "reason": "<dictionary reason for parked; null for green>",
  "text": "<outcome, evidence, next action and owner>",
  "packVersion": "<dispatch packVersion>",
  "sourceCommit": "<dispatch sourceCommit, omit when absent>",
  "surfaceRevision": <repeat the dispatch pin, integer>,
  "branch": "<branch>",
  "summary": "<2–3 product-language lines>",
  "criteria": [{"criterion":"<acceptance item>","done":true,"outcome":"confirmed","proof":"<method>","result":"<observation>","head":"<sha>","worktree_fingerprint":"<sha256>"}],
  "not_built": [], "not_verified": [],
  "changed_files": [],
  "tests": { "run": "<commands>", "result": "<outcome>" },
  "verification_items": [
    { "item": "<verbatim verification line>", "status": "pass | deferred | not-run", "evidence": "<reason/owner>" }
  ],
  "question": "<question text, or null>",
  "recommendation": "<recommendation, or null>",
  "linear_mutations_pending": [],
  "capsule": { "phase": "<code | preflight | ship>", "head": "<sha>", "open_queue": [], "decisions": [], "local_passes": [{"id":"<stable pass id>","head":"<reviewed sha>","result":"<clean|findings>"}], "writable_roots": ["<dispatch grant>"] },
  "certificate": "<certificate text or null>",
  "notes": "<runtime facts or null>",
  "next": "<mono:deploy | named recovery owner>"
}
```

Parked reasons: blocked, needs-decision, needs-human, drift-candidate, timed-out,
scope-drift-needs-handoff, write-unconfirmed, evidence-limit (предел доказательств).
Decisions: exact question/recommendation. Orchestrator reflects parked in Linear
this turn/read-back. Green: confirmed queues/current-head gates pass.

Keep every Issue «Как проверить» line verbatim/in order in verification_items;
pass | deferred | not-run, never unrun pass; name deferred owner. Evidence names
judgment check and inspected state. Repeat pins; standalone dispatched status,
sequenced intermediate.
