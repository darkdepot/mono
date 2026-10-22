---
name: implement
description: Use when starting or running implementation from approved Linear Issue(s) after handoff.
---

# Mono Implement

Files: here/pack root. Absolute `<pack-root>/` = `../..` here, never product cwd.

[Landing](references/landing.md).

Own start/code → preflight. Ship: PR; deploy: closeout.
Config: `.agents/mono-workflow.config.json`.

Read first:

Read now:
1. `AGENTS.md`
2. `references/worker-contract.md`
3. `references/readiness-gates.md`
4. `references/human-friendly-output.md`

Read when:
- `references/ui-implementation.md` — UI, before code.
- `references/questioning.md` — asking interactive questions.
- `references/issue-only-lane.md` — `lifecycle_state_entity=issue` or lane park/freeze/exit.
- `skills/preflight/SKILL.md` — exiting implemented-needs-preflight.

Inspect package/config/git/base; identity on start/resume.
Dispatch: phase/full queue; standalone: report.

## Workflow

Before start run `node <pack-root>/scripts/idea-gate.mjs check --mode approved --snapshot <dir> --config <path>`. Use the pinned dispatch snapshot or fresh Linear Project, complete comments, package approval and Issue context; issue-only uses its approved-fresh envelope. Refusal blocks with project/code; missing idea record → `mono:idea`, missing start → Handoff summary. `legacy-migrate` cannot pass this mode.

start-checkpoint validates approved package/start/handoff/seam/lifecycle. Dispatch
branch/snapshot wins. Consult gstack-learnings-search --limit 10; absence advisory.
Record start; implement one PR with incremental checks. AFK forbids sub-workers;
interactive slices need Issue permission. Missing/conflicting artifacts allow
discovery. Product/access/dirty/risk decisions → mailbox; material drift →
scope-drift-needs-handoff. Russian stop comment. No PR/formal pre-ship checks.

Only existing tools/literal solutions. Repeated key/class: apply
`references/review-admission.md` before edits.

## Orchestration branch of `start-checkpoint`

1. Dispatch identity; mismatch/nonzero blocks.
2. Snapshot package/decisions/approval.
3. Require approved Issue/start and resolved/accepted/deferred handoff findings;
   missing blocks.
4. Resolve five-field snapshot seam; missing blocks moves. Worker handshake now
   if moves; issue-only check before ack. Publish ack; wait-ack or pause/exit.
5. Wait uses applied read-backs, no identity rerun; legacy resume needs all
   move read-backs plus identity. No-move uses current snapshot. Never repeat moves.
   Project-first: Delivery/current-state delivery check. Issue-only: started
   amendment/earlier pre-ack PASS; retry rechecks started. Non-PASS → needs-human;
   missing → blocked. Report state/verdict/writes/lag; no deferred checks.
6. Dispatch worktree/branch; advisory learnings.
7. Full: queue start. Short: empty code queue, capsule.decisions/start in Russian
   ready lead. Confirm empty queues. Missing approval blocks; no re-asking.

## Context-seam branch at Delivery Start

Apply worker Context seam. Project-first: package/start approval and checks passed;
Ready (Discovery for legacy/no workspace Ready) → Delivery. Run mono:check delivery
and record start; missing → park/restart, integrity → needs-human.
Issue-only: fresh authenticated fingerprint approval/pre-start PASS. Move only
Issue to started; record lifecycle/fingerprint/oracle/engine/verification, one PR.
Lane exit parks for superseding marker/Project-first restart; no retrofit.

Interactive `mono-package`: owner start record only, else Handoff summary, no code.
Legacy: separate package/start approvals or bundled handoff; offer start/defer; «запускай реализацию» suffices. Start permits Delivery/branch/code.
Never infer/re-ask approval.

## Engine and Start Comment

Implementation workflow first; otherwise ce-work (code), Superpowers executing-plans
(plan), test-driven-development (acceptance), systematic-debugging (repro), gstack qa
(browser). Subagents require permitted slices; AFK forbids. Unavailable: apply
`references/execution-quality.md`, record substitution.

Russian queued start: Issue/package/approval/checks, scope, engine/reason,
verification, learnings/helper absence, browser/manual/PR/deploy boundary.

Statuses: implemented-needs-preflight, blocked, scope-drift-needs-handoff, needs-human.
Final: Issue/sources/git/files/checks/drift/comment, preflight next. Tiny: readiness.
