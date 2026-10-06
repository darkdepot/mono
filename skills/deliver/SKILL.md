---
name: deliver
description: Use for one approved Issue from code to a green PR in one worker context.
---

# Mono Deliver

Shared files: here or pack root.

One Issue/context/worktree; implement/preflight/ship own phases; deploy outside.

Read first:

Read now:
1. `AGENTS.md`
2. `references/worker-contract.md`

Read when:
- `skills/implement/SKILL.md` — entering code.
- `skills/preflight/SKILL.md` — entering readiness or rechecking code changes.
- `skills/ship/SKILL.md` — entering/resuming PR work.

Resolve scripts from dispatched pack root.

## Sequence and Recovery

On work/resume/restart/compaction: identity, latest own capsule/confirmation,
launch writable_roots and PR facts via gh; continue that phase.
Missing/conflicting inputs park. New heads stale proof, never queues.
Start: gate.mjs start --request <file>; implement handshake; wait mode runs wait-ack after ack.

1. Implement; publish code result/full queue, confirm, enter readiness.
2. Preflight/commit; publish one preflight-collect confirmation-request per
   worker contract. After confirmation run gate.mjs preflight collect:false;
   apply worker failure rules. Pass: publish ready certificate once, confirm
   comment before formal review.
3. Ship in order with all in-phase write barriers. Head changes
   repeat checks/review and restart evidence. Run gate.mjs ship --request <file>
   to pass/decision/deadline; confirm full ship queue/certificate.
   Orchestrator rechecks collect:false before ship.

ready/implemented-needs-preflight: intermediate, preserve context/dispatch.
Publish: delivery-state.mjs publish --report <candidate> --output <own phase path>.
Dependencies use confirmation-request; log continuation in decisions.
Wait through delivery-state.mjs wait --report <phase> --confirmation <path>
--config <project config>. Re-read capsule; only exit 0 permits progression.
Apply worker queue/ID/timeout/recovery rules.

`claude-cli`: worker startup/foreground waits; preflight review/certificate rules.

Final: worker Report green/parked rules and every verification item.
Report before stops except passed startup pause; orchestrator reflects parked
in Linear this turn.
