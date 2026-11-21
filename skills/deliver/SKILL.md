---
name: deliver
description: Use for one approved Issue from code to a green PR in one worker context.
---

# Mono Deliver

Files: here or pack root.

One Issue/context/worktree. Phase owners: implement/preflight/ship; deploy outside.
Use existing tools or literal conservative solutions, no custom parsers/heuristics
or extra mechanisms beyond the Issue. Correct the error class; review rounds and
parks follow `references/review-admission.md`.

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

Resume/restart/compaction: identity, own capsule/round request, grants, gh PR and Linear facts.
Recover active dispatch/branch/capsule per worker-contract; missing/conflicting
inputs park. New head stales proof.
Start: gate.mjs start --request <file>; implement handshake; wait mode runs wait-ack after ack.
Linear: worker-contract Linear Writes; every write read back before advancing.

1. Implement; publish the two-layer code report (all criteria, exclusions and gaps),
   post its comment. No broken/unfinished work advances.
2. Preflight/commit; write the preflight-collect round request, wait-round for its
   result, gate.mjs preflight collect:false, worker failure rules. Gate line per
   review-admission. Pass: ready certificate comment once, before formal review.
3. Ship. New head repeats checks/review round/evidence.
   gate.mjs ship --request <file> → pass/decision/deadline; ready, In Review, certificate.
   Orchestrator rechecks collect:false at green.

ready/implemented-needs-preflight: intermediate; keep context/dispatch.
Publish: delivery-state.mjs publish --report <candidate> --output <own phase path>.
Round wait: foreground; re-read capsule; progress only on exit 0.

Final: worker Report green/parked, every verification item.
Report before stops except passed startup pause; park comment is yours.
