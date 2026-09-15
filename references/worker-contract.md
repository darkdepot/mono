# Delivery Worker Contract

## AFK Contract

Use dispatched Issue/branch/worktree only. No branch switching/creation, sub-workers,
session management, other-Issue edits or orchestrator state access (workers.json,
ledger.md, control.json, dispatch, consumed, logs/other reports). Never commit secrets
or .orchestrator. No user questions: mailbox exact question/recommendation, then stop.
Report before terminal stops; passed startup pause emits only ack. Map sequenced
phase stops to parked; standalone phases retain statuses.

## Orchestration Mode Precedence

Snapshot replaces Linear/resolver reads. Skill wins rules,
dispatch wins facts/pins/paths/constraints. Queue writes after
gates pass; orchestrator applies/read-backs before progress. Disclose lag,
never claim application or judge unapplied state. Missing inputs block by name,
never infer or skip. Use confirmation barriers for write-before-progress;
standalone dispatch stops needs-decision. Never defer checks into a queue.
Interactive mode retains direct reads/writes/approval; lifecycle uses handshake.

## Pack identity gate invocation

Before work/resume require the exact dispatch command to exit 0 with
pack-state: identity verified; otherwise block.

```bash
node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity \
  --lock '<installed-skills-root>/.mono-agent-workflow.lock.json' \
  --pack-version '<dispatch packVersion>' \
  --source-commit '<dispatch sourceCommit>' \
  --surface-revision '<dispatch surfaceRevision>'
```

Require identity/all four flags. Resolve ../.mono-agent-workflow from installed
skill; lock sits beside skills. Single-quote paths/pins (embedded quote: '\'').
Never reconstruct the command or substitute checkout SURFACE_REVISION.

## Two-Phase Dispatch Handshake

Initial lifecycle moves only, including Issue activation in an already-Delivery
Project. Pre-move snapshot is expected. Run implement steps 1–4 and issue-only
pre-start delivery check before ack. On gate completion/blocker/other stop write
one reports/<ISSUE-KEY>-gate-ack-a<N>.json; denied mailbox uses the same name in
<worktree>/.orchestrator, never both.

```json
{
  "issue": "<ISSUE-KEY>",
  "phase": "gate",
  "gates": [{ "gate": "<gate name>", "status": "pass | blocked", "evidence": "<one line>" }],
  "status": "gates-passed | blocked"
}
```

Use unique, nonempty dispatched names. Gates-passed: exact set, all pass;
blocked: nonempty subset, at least one blocked. Passed: stop, no code/move/queue/report.
Blocked: ack then report (missing input: blocked; adverse verdict: needs-human), no move.
Codex exits; desktop/fallback keeps session. Resume: require every move read-back,
rerun identity/checks on amended state; never repeat moves. No-move retry: current
lifecycle snapshot, no ack/amendment. Consumption never replaces approval.

## Sandbox ladder

Workspace-write/network: worktree; the worktree-specific Git directory and the common Git directory, derived from the worktree; mailbox <root>/reports (--add-dir spawn; writable_roots resume).
codex 0.153.4 guards explicit linked-worktree metadata.
Launch/resume: set capsule.writable_roots. Orchestrator root, confirmations,
registry, control, consumed, logs: read-only.
No early PR/push/unrelated network. Standalone implement: no network unless excepted;
preflight network/.git; ship push. Exact hidden grants. Disabled sandbox: log in
orchestrator ledger. Denied mailbox: same uncommitted JSON fallback.

## Context seam

Before lifecycle/scope gates resolve Issue/marker/config/verified label/authenticated
approval and emit-fingerprint on that body; dispatch uses snapshot. Whole-body
SHA-256 only, no inferred oracle/lane/sixth field. Preserve trusted parent/marker/
label/approval provenance separately for fallback. Project-first needs approved
Project/PRD/Spec-or-exception/Issue; escaped candidate proves nothing. Follow
`references/issue-only-lane.md` Context Contract/Resolver/fallback for issue-only,
candidate/freeze/exit, including `approval_status=approved-fresh`, matching fingerprints/owner,
eligible risk and oracle acceptance/verification. Never require absent Project
docs for valid issue-only or downgrade broken markers. Implement integrity errors
→ needs-human, missing Project prerequisites → park/restart; preflight candidate/
missing docs/deep-risky escalation → drift-candidate/fallback with higher-risk
review, never ready outside lane; ship bad approval stops gates/PR and routes
no-promotion handoff.

## Delivery and pre-ship gates

Check current readiness only; no findings/mutations/repairs/installation.
PASS inspected/no blockers; FAIL hard violation; BLOCKED unavailable inputs.
Return mode/meaning/boundary/smallest unblock; failure: FAIL - Linear <mode> not ready.
Project delivery after move requires Delivery, current PRD, Spec/explicit exception,
approved Issues, set/start approval, coherent risk/review; docs alone fail.
Issue-only checks oracle/marker/label/fresh authenticated approval/review before
activation; started/terminal states fail then. After read-back or no-move retry
require configured started state, never terminal; no Project required or moved.
Pre-ship: matching diff/Issue, current recoverable preflight, required review,
current artifacts, accepted/synced drift, no obsolete PR chips/raw URLs; valid
issue-only oracle/fingerprint substitutes docs. Bad approval stops before PR/gates.
Reject wrong artifact roles, workflow mechanics/full copies/brittle edit scripts,
premature code/Delivery or missing review. Fail-closed output cannot create a package.

## Review contract

Run/report named review on package/config and relevant branch/PR, report-only:
no artifact/comment/Issue/PR/lifecycle/approval/worker writes. Outcomes ready,
advisory-ready, needs-fixes, blocked. Apply artifact/execution quality plus
coherence/feasibility/one-PR/durable AFK-HITL; add UI/security/data/ship/deep-risky
architecture where applicable. Valid issue-only needs no Project/docs. Return
verdict/meaning/mode/risk/gate-reason/inspected/boundary/next; group blocking,
proposed-fix, decision, fyi with artifact/evidence/impact/recommendation/owner.
Missing context/disposition blocks. Accepted repair routes handoff, issue renewal
or ship drift, never review itself.

## Execution and artifact handling

Apply `references/execution-quality.md` and `references/artifact-quality.md`.
Intake: explicit paths → fresh Linear package/reviews → decisions → configured
narrow roots → project/branch/session/file-scoped gstack. No broad scans; absent
roots unavailable. Approved newer Linear outranks scratch; stale evidence only
explains compatible decisions. Material missing/conflicting scope/proof/risk/slicing
requires accepted boundary or stop before writes; no stale contracts/certificates.
Record read, unavailable, stale_or_ignored, conflicts, decisions_carried_forward,
confidence_boundary (none when empty) in approval notes; one Russian chat sentence.
Translate artifact roles; never paste local bodies into Linear.

## Certificate recovery

Use the latest marker-bearing Linear comment/resource; never quote markers elsewhere.
Apply Machine Blocks In Linear Comments in
`references/human-friendly-output.md`; report/chat omit human lead.

## Delivery Reports and Capsule

Mono-deliver: one dispatch, terminal green/parked; ready/implemented-needs-preflight
are intermediate. Map stops to parked reasons; no stage respawn. Standalone keeps
phase statuses/certificates.

Phase: reports/<ISSUE-KEY>-phase-<code|preflight|ship>.json; denied mailbox uses
worktree .orchestrator, same name, never both. Add phase, increasing positive
sequence, kind (phase/confirmation-request), head, phase_result to final fields.
Capsule phase/head match; open_queue equals ordered linear_mutations_pending.
Each write: stable id, operation, target, payload. Certificate comments: append
#/certificate, one text copy. Never reuse IDs for changed payloads or drop
obligations on head change.

Publish/wait through delivery-state.mjs. Confirmation path:
confirmations/<ISSUE-KEY>-phase-<phase>-a<N>-s<sequence>.confirmed.json.
Wait refuses paths within capsule.writable_roots copied from dispatch. It binds report digest, issue/attempt/phase/sequence and each verified write result. Orchestrator reconciles before apply: Linear writes against Linear, collection
against its receipt. Apply only missing actions; fsync results under consumed/<ISSUE-KEY>-a<N>/, then
confirms the entire queue. Unknown/conflicting/read-error blocks; reconcile lost responses, including comments. Empty queues also wait.
Partial/stale/foreign confirmation blocks. Resume the capsule after
break/compaction; timeout orchestration.delivery.confirmationTimeoutSec (default
900 seconds) parks write-unconfirmed (запись не подтверждена).

In-phase confirmation-request preserves ship order: accepted drift before PR,
ready certificate before formal review, In Review/PR chip after PR. Queueing
never proves application; only confirmed writes permit dependent progression.

Pin product/evidenceRoot, skillsRoot, risk/critical, verification/write grants.
Evidence: ~/.mono-agent-workflow/evidence/<product>/ outside ALL worker grants
(including worktree/orchestrator root). Orchestrator: collect:true outside worker
sandboxes; worker: collect:false. Readable keys grant no writes. Hostile local
operator attestation: out of scope (one user/host).

After commit publish kind=confirmation-request with one write:
id=request.collectionId=preflight-collect:<head>:<n>, operation=preflight-collect,
target=<head>, payload={request}. Adapter returns immutable receipt path/digest/gate
answer even on failure; confirmation proves completion only. Verify collect:false.
Findings: fix/recommit/request again. Transient failures: same head/route, increment
n/sequence. Publish ready on pass.
Ship: preflight={complete collect:false request}; judgment={head,preShipReview,
readinessCheck,documentation,documentationReason,closures,botRemarks}. Verify the sealed
head/merge-base receipt before judgment; strings cannot replace it.
Orchestrator rechecks preflight before ship.

## Worker Report

Path: ~/.mono-agent-workflow/orchestrator/<product>/reports/<ISSUE-KEY>-mono-deliver.json;
on denial: <worktree>/.orchestrator/<ISSUE-KEY>-mono-deliver.json. English JSON except
verbatim verification items; follow AFK stops.

```json
{
  "issue": "<ISSUE-KEY>",
  "stage": "mono-deliver",
  "attempt": 1,
  "status": "<green | parked>",
  "reason": "<dictionary reason for parked; null for green>",
  "text": "<outcome, evidence, next action and owner>",
  "packVersion": "<dispatch packVersion>",
  "sourceCommit": "<dispatch sourceCommit>",
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

Parked reasons: blocked, needs-decision, needs-human, drift-candidate, timed-out, scope-drift-needs-handoff, write-unconfirmed, evidence-limit (предел доказательств). Include exact question/recommendation for decisions. Orchestrator reflects parked in Linear in the same turn with read-back; green requires all queues confirmed/current-head gates passed.

Keep every Issue «Как проверить» item verbatim/in order. Use pass/deferred/not-run; never pass unrun checks; name later-stage owner. Prefix judgment evidence judgment check: and inspected state. Repeat dispatch pins. Standalone: dispatched path/status; sequenced: intermediate results.
