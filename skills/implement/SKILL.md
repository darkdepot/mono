---
name: implement
description: Use when starting or running implementation from approved Linear Issue(s) after handoff.
---

# Mono Implement

Find shared files here or at the pack root.

[Landing](references/landing.md).

Own Delivery Start/code, then preflight. Ship owns PR; deploy owns closeout.
Config: `.agents/mono-workflow.config.json`.

Read first:

Read now:
1. `AGENTS.md`
2. `references/worker-contract.md`
3. `references/readiness-gates.md`
4. `references/human-friendly-output.md`

Read when:
- `references/questioning.md` — asking interactive questions.
- `references/issue-only-lane.md` — `lifecycle_state_entity=issue` or lane park/freeze/exit.
- `skills/preflight/SKILL.md` — exiting implemented-needs-preflight.

Inspect package/comments, approvals/review/checks, config/validation and git/base.
Identity before work/resume; no discovery/chat-only start. Dispatch returns phase
result/full queue for confirmation; standalone a stage report.

## Workflow

start-checkpoint validates package/start/handoff/seam/lifecycle below. Dispatch
branch/snapshot wins. Consult gstack-learnings-search --limit 10 (scoped optional
query/type); absence is advisory. Record start; implement one approved PR with
incremental checks. AFK forbids sub-workers; interactive slices need Issue
permission. Discovery only for missing/conflicting artifacts. Product/UX/business/
access/dirty/risk decisions go to mailbox; material drift → scope-drift-needs-handoff.
Return fields below; Russian comment for blocked/needs-human/drift. No PR or
formal pre-ship review/check.

## Orchestration branch of `start-checkpoint`

1. Run exact dispatch identity; mismatch/nonzero blocks.
2. Read snapshot package, decisions and approvals.
3. Require approved Issue, explicit start approval and resolved/accepted/deferred
   handoff findings. Missing field blocks.
4. Resolve the five-field seam from snapshot. Missing input blocks without moves.
   Move-carrying dispatch runs worker handshake now; issue-only delivery check
   precedes ack. Publish ack: wait-ack in wait mode; otherwise pause/exit.
5. Wait: applied read-backs, no identity rerun. Legacy resume: all move read-backs
   plus identity. No-move: current snapshot; never repeat moves. Project-first:
   visible Delivery and delivery check on amended/current state. Issue-only:
   started-state amendment/earlier pre-ack PASS; no-move rechecks started state.
   Non-PASS → needs-human; missing → blocked before code. Report state/verdict,
   permitted writes and lag; no deferred checks or unapplied-state claims.
6. Keep dispatch worktree/branch; consult advisory learnings.
7. Full: queue start comment. Short: empty code queue; start facts in
   capsule.decisions and Russian ready-certificate lead. Confirm empty queues too.
   Missing approval blocks; no re-asking.

## Context-seam branch at Delivery Start

Apply worker Context seam. Project-first: start approval, Delivery move,
mono:check delivery, start comment. Missing prerequisites park/restart; integrity
errors → needs-human. Issue-only: fresh authenticated fingerprint approval,
pre-start delivery PASS; move only Issue to configured started state, record
lifecycle/fingerprint/oracle IDs/engine/verification; implement one oracle PR.
Lane scope/topology/risk exit parks, requires approved superseding marker and
Project-first restart; never retrofit docs/Project onto parked Issue.

Interactive package/start approvals are separate; bundled handoff counts.
Explicit Issue/start authority allows Delivery/branch/code, never PR/merge/deploy.
Offer start or defer; «запускай реализацию» suffices. No inferred or repeated approval.

## Engine and Start Comment

Use configured Implementation workflow; otherwise ce-work for general code,
Superpowers executing-plans for an approved plan, test-driven-development for
encodable acceptance, systematic-debugging for repros, gstack qa for browser proof.
subagent-driven-development requires permitted slices/ownership; AFK forbids it.
Unavailable engine: execute under `references/execution-quality.md`, record substitution.

Russian start comment: Issues, inspected Project/PRD/Spec/approval/review/checks,
approved scope, workflow/reason, verification, learnings/helper absence and
uninspected browser/manual/PR/deploy. Queue under dispatch.

Statuses: implemented-needs-preflight, blocked, scope-drift-needs-handoff,
needs-human. Final names Issue/sources, branch dirty/committed, files, checks,
drift, comment outcome and preflight as next owner. Tiny output follows readiness.
