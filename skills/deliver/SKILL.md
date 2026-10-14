---
name: deliver
description: Use for one approved Issue from code to a green PR in one worker context.
---

# Mono Deliver

Files: here or pack root.

One Issue/context/worktree. Phase owners: implement/preflight/ship; deploy outside.
Use existing tools or literal conservative solutions, no custom parsers/heuristics
or extra mechanisms beyond the Issue. Correct the error class; repeated key/class
parks needs-decision before edits/collection (`references/review-admission.md`).

Read first:

Read now:
1. `AGENTS.md`
2. `references/worker-contract.md`

Read when:
- `skills/implement/SKILL.md` — entering code.
- `skills/preflight/SKILL.md` — entering readiness or rechecking code changes.
- `skills/ship/SKILL.md` — entering/resuming PR work.

Scripts: dispatched pack root.

## Sequence and Recovery

Resume/restart/compaction: identity, own capsule/confirmation, grants, gh PR facts.
Continue that phase; missing/conflicting inputs park. New head stales proof, not queues.
Start: gate.mjs start --request <file>; implement handshake; wait mode runs wait-ack after ack.

1. Implement; publish code/full queue, confirm, enter readiness.
2. Preflight/commit; publish preflight-collect confirmation-request. Confirm,
   gate.mjs preflight collect:false, worker failure rules. Pass: publish ready
   certificate once; confirm before formal review.
3. Ship with write barriers. New head repeats checks/review/evidence.
   gate.mjs ship --request <file> → pass/decision/deadline; confirm queue/certificate.
   Orchestrator rechecks collect:false before ship.

ready/implemented-needs-preflight: intermediate; keep context/dispatch.
Publish: delivery-state.mjs publish --report <candidate> --output <own phase path>.
Dependencies: confirmation-request, log continuation.
Wait: delivery-state.mjs wait --report <phase> --confirmation <path>
--config <project config>. Re-read capsule; progress only on exit 0. Worker rules apply.

`claude-cli`: startup/foreground waits; preflight rules.

Final: worker Report green/parked, every verification item.
Report before stops except passed startup pause; orchestrator reflects parks.
