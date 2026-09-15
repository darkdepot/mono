---
name: mono-deliver
description: Use to deliver one approved Issue from code to a green PR in one worker context.
---

# Mono Deliver

One Issue/context/worktree; implement/preflight/ship own phases. Deploy stays outside.

Read first:

Read now:
1. `AGENTS.md`
2. `references/worker-contract.md`

Read when:
- `skills/mono-implement/SKILL.md` — entering code.
- `skills/mono-preflight/SKILL.md` — entering readiness or rechecking code changes.
- `skills/mono-ship/SKILL.md` — entering/resuming PR work.

Resolve ../.mono-agent-workflow/scripts from this installed skill, never the checkout. Use --help/dispatch pins.

## Sequence and Recovery

Before work/resume/restart/compaction run dispatch identity and read the latest own
phase capsule/confirmation; copy launch writable_roots into the capsule. Read PR facts through gh; continue that phase.
Missing/conflicting inputs park. New heads invalidate proof, never pending writes.
Start: gate.mjs start --request <file>, then implement handshake.

1. Execute implement; publish its code phase result/full queue, confirm, enter readiness.
2. Execute preflight; commit. Publish a confirmation-request with one
   preflight-collect item (worker contract). After confirmation run gate.mjs
   preflight with collect:false; handle failures per worker contract. On pass publish
   ready certificate once and confirm its comment before formal review.
3. Execute ship in its order, including all in-phase write barriers. Head changes
   repeat required checks/review and restart evidence. Run gate.mjs ship --request
   <file> to pass/decision/deadline; confirm full ship queue including certificate.
   Orchestrator rechecks collect:false before ship.

ready/implemented-needs-preflight stay intermediate; never reset context/dispatch.
Publish: delivery-state.mjs publish --report <candidate> --output <own phase path>.
Use confirmation-request for dependencies; log continuation in decisions.
Wait through delivery-state.mjs wait --report <phase> --confirmation <path>
--config <project config>. Re-read capsule; only exit 0 permits progression.
Follow worker-contract queue/ID/timeout/recovery rules.

Final: apply worker Report green/parked rules; retain every verification item.
Report before stopping except passed startup pause. Orchestrator reflects parked
in Linear in the same turn.
