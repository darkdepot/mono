---
name: mono-implement
description: Use when starting or running implementation from approved Linear Issue(s) after handoff.
---

# Mono Implement

Own Delivery Start/code, then preflight. Ship owns PR; deploy owns closeout.
Read project `.agents/mono-workflow.config.json` for team/language/roots/workflows.

Read first:

Read now:
1. `AGENTS.md`
2. `references/worker-contract.md`
3. `references/readiness-gates.md`
4. `references/human-friendly-output.md`

Read when:
- `references/questioning.md` — asking interactive questions.
- `references/issue-only-lane.md` — `lifecycle_state_entity=issue` or lane park/freeze/exit.
- `../mono-preflight/SKILL.md` — exiting implemented-needs-preflight.

Gather package/resources/comments, approvals/review/checks, config/validation
and git/base. Run dispatch identity before work/resume; no discovery/chat-only
start. Return sequenced phase results/full queue for confirmation, otherwise a stage report.

## Workflow

start-checkpoint validates package/start approval/handoff/seam and lane lifecycle
below; dispatch uses its branch/snapshot. Consult gstack-learnings-search --limit 10
(optional scoped query/type); unavailable/none is advisory. Record start comment.
Execute approved one PR with incremental verification. AFK forbids sub-workers;
interactive parallel slices require Issue permission. No discovery unless missing/
contradictory artifacts. Blocking product/UX/business/access/dirty/risk decisions
use mailbox under dispatch; material drift → scope-drift-needs-handoff.
Exit with fields below; comment in Russian for blocked/needs-human/drift only.
Never create PR or run/claim formal pre-ship review/check.

## Orchestration branch of `start-checkpoint`

1. Run exact dispatch identity; mismatch/nonzero blocks.
2. Read snapshot package, decisions and approvals.
3. Require approved Issue, explicit start approval and resolved/accepted/deferred
   handoff findings. Missing field blocks.
4. Resolve the five-field seam from snapshot. Missing input blocks without moves.
   Move-carrying dispatch runs worker handshake now; issue-only delivery check
   precedes ack. Publish ack and pause as that protocol requires.
5. Resume: rerun identity; require every applied-move/read-back amendment.
   No-move dispatch requires current snapshot. Never repeat lifecycle moves.
   Project-first: require visible Delivery; run/report delivery check against
   amended or already-Delivery state. Issue-only: require started-state
   amendment and earlier pre-ack PASS; no-move retry requires started state and
   re-evaluation. Non-PASS → needs-human; missing inputs → blocked before code.
   Record snapshot state, verdict and run/report arm in notes. Queue only other
   permitted mutations; disclose lag, never defer checks or claim application.
6. Keep dispatched worktree/branch; consult advisory learnings.
7. Queue implementation-start comment. No interactive approval prompt; missing
   approval blocks. The sequencer confirms writes required before progression.

## Context-seam branch at Delivery Start

Apply worker-contract Context seam. Project-first: obtain start approval, move
Project to Delivery, run/report mono-check delivery, record start comment.
Missing prerequisites park/restart; integrity errors → needs-human.
Issue-only: fresh authenticated fingerprint approval authorizes start without
another approval. Require pre-start delivery PASS, move only Issue to configured
started state, record lifecycle/fingerprint/oracle IDs/engine/verification,
implement oracle's one PR. Scope/topology/risk outside lane requires parking,
approved superseding marker and restarting Project-first; never retrofit docs
or Project onto the parked Issue.

Separate interactive package/start approval. Require explicit Issue/start authority;
bundled handoff approval counts. State that start allows Delivery/branch/code,
never PR/merge/deploy. Offer start (recommended for final scope) or defer;
«запускай реализацию» suffices. Never infer ambiguous approval or re-ask valid approval.

## Engine and Start Comment

Use configured Implementation workflow. If absent/None choose Compound ce-work
for general implementation; Superpowers executing-plans for an approved concrete
plan, test-driven-development for encodable acceptance, systematic-debugging for
repro loops, subagent-driven-development only for permitted independent slices
with explicit ownership; gstack qa when browser/manual verification dominates.
AFK no-subworker rule wins. Unavailable engine: execute here under
`references/execution-quality.md` and record substitution.

Start comment (Russian by default): name Issues; inspected Project/PRD/Spec,
approvals/review/checks; approved scope only; workflow and selection reason;
verification plan; learnings or helper unavailable; uninspected browser/manual,
PR/deploy boundary. Queue it in dispatch mode.

Statuses: implemented-needs-preflight, blocked, scope-drift-needs-handoff,
needs-human. Final names Issue/sources, branch dirty/committed, files, checks,
drift, comment outcome and preflight as next owner. Tiny output follows readiness.
