# Delivery Worker Contract

[Landing](landing.md).

## AFK Contract

Use dispatch Issue/branch/worktree. No branch changes/sub-workers/session
management/other-Issue edits or orchestrator state access (workers.json/ledger.md/
control.json/dispatch/consumed/logs/other reports), except own
consumed/<KEY>-gate-ack-a<N>.json reads. No secrets/.orchestrator commits or user
questions: mailbox question/recommendation, stop. Only gates read registry/dispatch.
Report before stops; passed pause ack only. Sequenced stops park; standalone
keeps statuses.

## Orchestration Mode Precedence

Snapshot replaces Linear/resolver; skill owns rules, dispatch facts/pins/paths.
Queue after gates; confirm orchestrator application/read-back before progress.
Disclose lag; no application claims or judgment of unapplied state. Missing inputs
block; never infer/skip/defer checks. Standalone parks needs-decision; interactive
keeps direct access/approval, lifecycle handshake.

## Pack identity gate invocation

Before work/resume: all present dispatch identity pins, exit 0 and
pack-state: identity verified, else block. [Compatibility](versioning.md#local-lockfile).
Use the dispatched pack root, never the checkout; single-quote paths/pins.
Legacy: --lock instead of --pack-root, plus --source-commit when pinned.

```bash
node '<pack-root>/scripts/verify-pack-state.mjs' identity \
  --pack-root '<pack-root>' --pack-version '<dispatch packVersion>' \
  --surface-revision '<dispatch surfaceRevision>'
```

## Pre-applied files

At start match `git show <sha>` blobs to dispatch commit/files/sha256 and Issue
manifest; never change those files.
Review findings on them park `blocked` with exact replacement bytes; the artifact
owner repairs the Tech Spec or renews the issue-only Issue, then starts a NEW
dispatch. No amendment/resume can apply the repaired manifest.

## Two-Phase Dispatch Handshake

Initial moves only, including Issue activation in Delivery Project. Pre-move
snapshot is correct. Before ack run implement 1–4/lane pre-start delivery check.
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

Gate names unique/nonempty; gates-passed: exact set/all pass; blocked: nonempty
subset/one blocked. Blocked ack precedes report (missing blocked; adverse
needs-human), no move. Passed: no code/move/queue/report. Codex wait-ack deadline:
ack mtime + ackWaitSec; expiry parks write-unconfirmed. Applied read-backs amend
state: delivery check, no identity rerun. Resume: Codex exits, desktop/fallback
keeps session; all move read-backs plus identity/check rerun. Never repeat moves.
No-move retry: current snapshot, no ack/amendment. Consumption is not approval.

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
approval provenance for fallback. Project-first requires approved
Project/PRD/Spec-or-exception/Issue; escaped candidate proves nothing.
Apply `references/issue-only-lane.md` Context Contract/Resolver/fallback,
candidate/freeze/exit: `approval_status=approved-fresh`, matching fingerprints/
owner, eligible risk, oracle acceptance/verification. Valid lane needs no Project
docs; broken markers never downgrade. Implement integrity error → needs-human;
missing Project prerequisites → park/restart. Preflight candidate/missing docs/
deep-risky escalation → drift-candidate/fallback/higher-risk review, never ready
outside lane. Ship bad approval stops gates/PR → no-promotion handoff.

## Delivery and pre-ship gates

Readiness-only: no findings/mutations/repair/install. PASS inspected/no blockers;
FAIL violation; BLOCKED inputs unavailable. Return mode/meaning/boundary/unblock;
failure: FAIL - Linear <mode> not ready.
Project delivery: Delivery/current PRD/Spec-or-exception/approved Issues/set and
start approval/coherent risk-review; docs alone fail. Issue-only pre-activation:
oracle/marker/label/fresh authenticated approval/review; started/terminal fails.
After read-back/no-move retry: configured started state, never terminal; no Project.
Pre-ship: diff/Issue match, recoverable current preflight/review/artifacts, synced
accepted drift, no obsolete PR chips/raw URLs; lane oracle/fingerprint substitutes
docs. Bad approval stops PR/gates. Reject wrong roles, workflow mechanics/full
copies/brittle scripts, premature code/Delivery/missing review. No fail-closed
package creation.

## Review contract

Named package/config and branch/PR review is report-only: no artifact/comment/
Issue/PR/lifecycle/approval/worker writes. Outcomes: ready, advisory-ready,
needs-fixes, blocked. Apply artifact/execution quality, coherence/feasibility/
one-PR/durable AFK-HITL and applicable UI/security/data/ship/deep-risky architecture.
Valid lane needs no Project/docs. Return verdict/meaning/mode/risk/gate-reason/
inspected/boundary/next; blocking/proposed-fix/decision/fyi each carry artifact/
evidence/impact/recommendation/owner. Missing context/disposition blocks. Accepted
repair routes handoff/issue renewal/ship drift, never review.

## Execution and artifact handling

Apply `references/execution-quality.md`/`references/artifact-quality.md`.
Intake: explicit paths → fresh Linear package/reviews → decisions → configured
narrow roots → scoped gstack. No broad scans; absent roots unavailable. Approved
newer Linear outranks scratch; stale evidence explains compatible decisions only.
Missing/conflicting scope/proof/risk/slicing: boundary or stop before writes; no
stale contracts/certificates. Approval notes: read/unavailable/stale_or_ignored/
conflicts/decisions_carried_forward/confidence_boundary (none if empty), one Russian
chat sentence. Translate roles; never paste local bodies.

## Certificate recovery

Use the latest marker-bearing Linear comment/resource; never quote markers elsewhere.
Apply Machine Blocks In Linear Comments in
`references/human-friendly-output.md`; report/chat omit human lead.

## Delivery Reports and Capsule

Mono-deliver: one dispatch; terminal green/parked, intermediate ready/
implemented-needs-preflight. Park stops; no stage respawn. Standalone retains
statuses/certificates.

Phase: reports/<ISSUE-KEY>-phase-<code|preflight|ship>.json; denied mailbox:
same name in worktree .orchestrator, never both. Add phase/positive increasing
sequence/kind (phase/confirmation-request)/head/phase_result to final fields.
Capsule phase/head match; open_queue = ordered linear_mutations_pending.
Writes: stable id/operation/target/payload; changed payload needs new ID; preserve
obligations across heads. Certificate: append #/certificate, one copy. Short:
confirm empty code queue; start facts in capsule.decisions/Russian ready lead
before unchanged machine core.

Publish/wait through delivery-state.mjs. Confirmation path:
confirmations/<ISSUE-KEY>-phase-<phase>-a<N>-s<sequence>.confirmed.json.
Wait rejects paths inside dispatch-derived capsule.writable_roots; binds report
digest/issue/attempt/phase/sequence and verified results. Reconcile Linear writes
against Linear, collections against receipts; apply missing only, fsync results
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

After amend use resume's "Effective attempt pins" pins.v<n>.json for collection;
no report version field. Commit; pinned collect:false exit 2 is pending, not pass. Publish only publishRequest in payload.request, kind=confirmation-request:
id=request.collectionId=preflight-collect:<head>:<n>, operation=preflight-collect,
target=<head>, payload={request}. Adapter: immutable receipt path/digest/gate, even on failure; confirmation proves completion only. Verify collect:false.
Findings: fix/recommit/request; transient: same head/route, increment n/sequence. Ready on pass.
Ship: preflight={full collect:false request}; judgment={head,preShipReview,
readinessCheck,documentation,documentationReason,closures,botRemarks}. Verify the sealed
head/merge-base receipt before judgment; strings cannot replace it.
Orchestrator rechecks preflight before ship.

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
  "changed_files": [],
  "tests": { "run": "<commands>", "result": "<outcome>" },
  "verification_items": [
    { "item": "<verbatim verification line>", "status": "pass | deferred | not-run", "evidence": "<reason/owner>" }
  ],
  "question": "<question text, or null>",
  "recommendation": "<recommendation, or null>",
  "linear_mutations_pending": [],
  "capsule": { "phase": "<code | preflight | ship>", "head": "<sha>", "open_queue": [], "decisions": [], "writable_roots": ["<dispatch grant>"] },
  "certificate": "<certificate text or null>",
  "notes": "<runtime facts or null>",
  "next": "<mono-deploy | named recovery owner>"
}
```

Parked reasons: blocked, needs-decision, needs-human, drift-candidate, timed-out,
scope-drift-needs-handoff, write-unconfirmed, evidence-limit (предел доказательств).
Decisions need exact question/recommendation. Orchestrator reflects parked in
Linear this turn/read-back. Green: all queues confirmed/current-head gates pass.

Keep Issue «Как проверить» verbatim/in order; pass/deferred/not-run, never unrun
pass; name later-stage owner. Judgment evidence: judgment check: + inspected
state. Repeat present pins. Standalone uses dispatched path/status; sequenced intermediate.
