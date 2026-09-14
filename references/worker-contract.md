# Delivery Worker Contract

Preserve stage ownership/order. Conditional reads bind, including queued writes.

## AFK Contract

Use only dispatched Issue/branch/worktree. No branch creation/switch, sub-workers, session management, other-Issue edits or state access (`workers.json`, `ledger.md`, `control.json`, `dispatch/`, `consumed/`, logs/other reports). Never commit `.orchestrator/` or include secrets.

Never ask users. Blocking mid-stage question → `needs-decision` report with exact question/recommendation, then stop. Terminal exit → stage status. Report before completion/blocker/any stop, except passed gate pause produces only ack.

## Orchestration Mode Precedence

Dispatch snapshot replaces every Linear read/resolver input; zero Linear calls regardless of availability. Queue permitted stage mutations in `linear_mutations_pending`; orchestrator applies/read-backs before advance. Skill wins rules, dispatch wins facts/pins/paths/constraints.

Keep all gates/order/statuses. Missing input → blocked naming it, never skip/infer/ask. Queue only after gate passes; queued writes trigger write-conditioned reads. Disclose pending/Linear lag; no applied claims or verdicts on unapplied state. Required write-before-progress → needs-decision for sequencing, never deferred checks in queue. Lifecycle uses handshake; interactive mode keeps direct reads/writes/approval.

## Pack identity gate invocation

Before work/resume run exact dispatch command; require exit 0 and `pack-state: identity verified`:

```bash
node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity \
  --lock '<installed-skills-root>/.mono-agent-workflow.lock.json' \
  --pack-version '<dispatch packVersion>' \
  --source-commit '<dispatch sourceCommit>' \
  --surface-revision '<dispatch surfaceRevision>'
```

`../.mono-agent-workflow/` is relative to installed skill, not worktree; lockfile is beside skill directories. Require identity/all four flags, single-quoted paths/pins with embedded quote escaped `'\''`; never reconstruct the supplied command. Any mismatch/nonzero/other output → blocked before stage work with dispatch pins. Checkout `SURFACE_REVISION` is code, not execution identity.

## Two-Phase Dispatch Handshake

Gate-pause only for dispatch's Project-to-Delivery/issue-only activation move; preflight/ship have none. Pre-move snapshot is expected. Run implement 1–4 plus issue-only delivery check before ack.

On gate completion/blocker/other stop write one attempt ack to dispatched `reports/<ISSUE-KEY>-gate-ack-a<N>.json`; denied write uses `<worktree>/.orchestrator/<ISSUE-KEY>-gate-ack-a<N>.json`. Never both:

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

Names must be non-empty/unique/dispatched. Gates-passed = exact set/all pass; blocked = non-empty subset/no foreign names/at least one non-pass. Ack enum is separate.

Passed: stop without code/move/queue/stage report. Blocked: ack then stage report (blocked for missing input, needs-human for adverse verdict), no move. Codex ends turn/process; desktop/fallback ends turn with session open.

Resume: require every applied move/read-back amendment, re-run identity, judge amended state; missing proof blocks code. No redundant moves. No-move retry needs current lifecycle snapshot, no ack/amendment. Registry/consumption never substitutes for approval.

## Sandbox ladder

Implement: workspace-write, no network, linked worktree + mailbox root. Preflight: add network/main-checkout writable .git. Ship: add push. Protected hidden-directory edits (e.g. `.agents`) need exact writable grant. No normal disabled sandbox; route exception to orchestrator for ledger reason. Mailbox denial uses identical JSON worktree fallback, never committed.

## Context seam

Before lifecycle/scope gates run installed resolver on current Issue/marker/config/verified label/authenticated approval and `--emit-fingerprint` on same body; dispatch uses snapshot. Whole-body SHA-256 only, no second/section hash/inferred oracle.

Retain trusted parent/marker/label/approval provenance outside five fields for fallback only; no sixth field/reclassification/inferred lane. Project result requires approved Project/PRD/Spec-or-exception/Issue; escaped candidate never proves it. For issue-only or candidate/freeze/exit decisions follow The Context Contract, The Resolver and fallback sections in `references/issue-only-lane.md`: require `approval_status=approved-fresh`, non-empty oracle, eligible risk and matching owner/marker/caller/current fingerprints. Compare oracle acceptance/verification and scope_fingerprint, not absent Project docs.

Implement integrity error → needs-human; failed Project prerequisites → park/restart. Preflight parentless candidate/missing Project artifacts/deep-risky escalation → drift-candidate/fallback, higher-risk review still runs, no ready outside lane. Ship bad approval stops formal gates/PR and routes no-promotion handoff fallback. Never silently downgrade broken/stale markers.

## Delivery and pre-ship gates

Evaluate current interactive/snapshot state. Check is readiness-only: PASS inspected/no blockers, FAIL hard violation, BLOCKED unavailable context/permissions. Return mode/human meaning/boundary/smallest unblock; failure leads `FAIL - Linear <mode> not ready`. No review finding sections, mutations/repairs or workflow installation while checking.

Project delivery requires visible Delivery, current PRD, Spec/explicit exception, approved Issues, approval covering set/start and coherent risk/review. PRD/Spec alone fails. Evaluate after move. Issue-only checks oracle/marker/label/authenticated fresh approval/review while pre-start (triage/backlog/unstarted), rejecting started/completed/canceled before activation; after read-back/no-move retry require configured started/in-progress, never terminal. Never require/move a Project on that lane.

Pre-ship requires matching diff/Issue, recoverable current preflight certificate, required review, current artifacts, accepted/synced drift, no obsolete PR chips/raw PR URLs. Issue-only requires oracle/fingerprint match without Project docs; bad approval stops before formal review/check/PR.

Judge artifact-quality responsibilities by meaning, not headings. Reject wrong WHAT/HOW/execution/body roles, workflow mechanics, full-doc copies, brittle line/edit scripts, premature code/Delivery or missing required review. Fail-closed resolver output never manufactures a package.

## Review contract

Run/report required named review on package/config and relevant pre-ship branch/PR state; report-only, no artifact/comment/Issue/PR/lifecycle/approval/worker mutations. Verdict ready/advisory-ready/needs-fixes/blocked, never uppercase check statuses.

Apply coherence/feasibility/one-PR/durable AFK-HITL lenses; add product/UI-state/security-data/ship/deep-risky architecture as applicable. Apply artifact/execution quality to PRD actor-benefit/proof/conditional acceptance; Spec trace/interfaces/failures/rollout; Issue context/durability/blockers; pre-ship scope/drift/certificates/docs/head/feedback. Valid issue-only needs no Project/docs.

Return verdict/meaning/mode/risk/gate-reason/inspected/boundary/next plus grouped blocking/proposed-fix/decision/fyi, each artifact/evidence/impact/recommendation/owner. Missing required context → blocked/needs-fixes; resolve/report missing disposition, never assume. Accepted fixes route to handoff, issue renewal or ship drift; no delivery artifact-repair execution.

## Execution and artifact handling

Apply `references/execution-quality.md` and `references/artifact-quality.md`. Intake precedence: explicit paths/resources → fresh Linear package/comments/reviews → conversation decisions → configured narrow roots → project/branch/session/filename-scoped gstack files. No home/broad-parent/unrelated-worktree scans; absent scoped roots = unavailable. Prefer explicit paths; newer/approved Linear outranks scratch. Use stale evidence only to explain non-conflicting prior decisions. Missing material input requires accepted confidence boundary or stops; scope/proof/risk/slicing conflicts stop before writes. No stale-contract work or pre-repair certificates.

Intake fields: `read`, `unavailable`, `stale_or_ignored`, `conflicts`, `decisions_carried_forward`, `confidence_boundary`; include all, use `none` for empty. Put structured intake in package-approval comment/notes, chat as one Russian sentence. Translate evidence into artifact roles; never paste local bodies into Linear.

## Certificate recovery

Latest marker-bearing Linear comment/resource wins; older superseded. Never quote markers in unrelated comments. Apply Machine Blocks In Linear Comments in `references/human-friendly-output.md`; chat/report omits the human lead.

## Worker Report

Path: `~/.mono-agent-workflow/orchestrator/<product>/reports/<ISSUE-KEY>-<stage>.json`; denied write uses `<worktree>/.orchestrator/<ISSUE-KEY>-<stage>.json`. English JSON except verbatim Issue verification; no secrets.

```json
{
  "issue": "<ISSUE-KEY>",
  "stage": "<mono-implement | mono-preflight | mono-ship>",
  "status": "<implemented-needs-preflight | ready | green | blocked | needs-decision | needs-human | drift-candidate | timed-out | scope-drift-needs-handoff>",
  "packVersion": "<dispatch packVersion>",
  "sourceCommit": "<dispatch sourceCommit>",
  "surfaceRevision": <repeat the dispatch pin, integer>,
  "branch": "<branch>",
  "changed_files": ["<path>"],
  "tests": { "run": "<commands>", "result": "<outcome>" },
  "verification_items": [
    { "item": "<verbatim verification line>", "status": "pass | deferred | not-run", "evidence": "<one line>" }
  ],
  "question": "<question text, or null>",
  "recommendation": "<the worker's own recommended answer, or null>",
  "linear_mutations_pending": ["<queued mutation; certificate pointer: append #/certificate>"],
  "certificate": "<certificate text or null>",
  "notes": "<runtime facts or null>",
  "next": "<mono-preflight | mono-ship | mono-deploy | null>"
}
```

Repeat dispatch pins: non-empty packVersion, 40-hex sourceCommit, positive-integer surfaceRevision; no checkout constants. Placeholder is an unquoted shape sketch. Optional notes is runtime context, not status. Certificate once; queued comment uses `append #/certificate` for orchestrator splice.

Implement/preflight terminal verification_items requires every «Как проверить» line verbatim in original language/order; no split/merge/re-key/omission. Only `pass | deferred | not-run`; deferred/not-run require reasons and later-stage items name owner. Judgment evidence starts `judgment check:` with inspected/observed state, never a new status. Coverage does not replace exit status.

Use the stage's terminal status verbatim from the dictionary above; orchestrator routes/escalates/respawns. Mailbox-only needs-decision is a mid-stage question/recommendation, followed by same-worker continuation after technical answer/Always-ask escalation.
