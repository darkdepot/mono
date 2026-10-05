---
name: deliver
description: Use to deliver one approved Issue from code to a green PR in one worker context.
---

# Mono Deliver

Find shared files here or at the pack root.

One Issue/context/worktree; implement/preflight/ship own phases. Deploy is outside.

Read first:

Read now:
1. `AGENTS.md`
2. `references/worker-contract.md`

Read when:
- `skills/implement/SKILL.md` — entering code.
- `skills/preflight/SKILL.md` — entering readiness or rechecking code changes.
- `skills/ship/SKILL.md` — entering/resuming PR work.

Resolve scripts from the dispatched pack root.

## Sequence and Recovery

On work/resume/restart/compaction: identity, latest own capsule/confirmation
and launch writable_roots. Read PR facts via gh; continue that phase.
Park missing/conflicting inputs. New heads stale proof, never queues.
Start: gate.mjs start --request <file>; implement handshake; wait mode runs wait-ack after ack.

1. Execute implement; publish its code phase result/full queue, confirm, enter readiness.
2. Execute preflight; commit. Publish a confirmation-request with one
   preflight-collect item (worker contract). After confirmation run gate.mjs
   preflight with collect:false; handle failures per worker contract. On pass publish
   ready certificate once and confirm its comment before formal review.
3. Execute ship in its order, including all in-phase write barriers. Head changes
   repeat required checks/review and restart evidence. Run gate.mjs ship --request
   <file> to pass/decision/deadline; confirm full ship queue including certificate.
   Orchestrator rechecks collect:false before ship.

ready/implemented-needs-preflight are intermediate; preserve context/dispatch.
Publish: delivery-state.mjs publish --report <candidate> --output <own phase path>.
Use confirmation-request for dependencies; log continuation in decisions.
Wait through delivery-state.mjs wait --report <phase> --confirmation <path>
--config <project config>. Re-read capsule; only exit 0 permits progression.
Keep worker-contract queue/ID/timeout/recovery rules.

Final: worker Report green/parked rules; retain every verification item.
Report before stopping except passed startup pause. Orchestrator reflects parked
in Linear in the same turn.
