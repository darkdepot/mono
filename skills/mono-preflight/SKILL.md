---
name: mono-preflight
description: Use after implementation to verify local readiness with mandatory autoreview before ship.
---

# Mono Preflight

No PR/merge/deploy/closeout/shipped claims or formal `mono-review pre-ship` / `mono-check pre-ship`.

Read first:

Read now:

1. `AGENTS.md`
2. `references/worker-contract.md`
3. `references/autoreview-routing.md`
4. `references/readiness-gates.md`
5. `references/human-friendly-output.md`

Read when:

- `references/issue-only-lane.md` — when lifecycle_state_entity=issue, or a lane freeze/follow-up/cancel decision is in play.

Run dispatch identity before work/resume. Gather package/config/validation,
git/diff/base and start comments/certificates. Apply worker snapshot/queue rules;
confirm sequenced phase queues before ship.

## Workflow

1. Require approved Issue and Delivery state or explicit proceed approval;
   inspect git. Apply worker Context seam before comparing scope: Project-first
   uses full package; issue-only uses current oracle/fingerprint, re-reading
   approval/marker and emit-fingerprint. Candidate/missing artifacts/deep-risky
   escalation → drift-candidate/fallback; stale or unresolved context cannot ready.
2. Run targeted checks; report unavailable/manual/browser/mobile/prod/acceptance
   surfaces honestly. Compare final diff risk with approved risk; higher wins.
3. `autoreview`: resolve installed autoreview helper's concrete path; missing → blocked.
   Read Classification and Invocation in references/autoreview-routing.md;
   resolve [role:autoreview](references/model-policy.md#roles), explicit engine
   claude, model and thinking effort. Never substitute reviews or defaults.
4. Dirty tail: helper --mode local, fix accepted findings, then safely commit;
   otherwise blocked/needs-human. Final committed scope requires --mode branch
   --base <actual base>, or --mode commit --commit <ref> for single/already-landed
   scope. Local clean alone never certifies committed work. Record exact commands.
5. Require exit 0, complete clean result and no residual actionable findings.
   Use --max-priority P2: clean/scoped-clean or exit-0 filtered with a correct
   verdict, no accepted/missing findings and only P3 filtered. Log P3 advisory
   dispositions; never loop on P3 alone. Nonzero/incomplete fails. Verify findings
   against code/contracts; reject unsupported ones with evidence, apply defensible
   small fixes at their owner boundary. No automatic broad/release-sensitive
   rewrites or weakening/deleting/rewriting tests for green. After each code
   change repeat targeted checks and autoreview; no arbitrary round cap. Repeated
   tooling/capacity failure or needed decision → blocked/needs-human.
6. Reclassify after fixes; require clean committed-scope review. Under the
   sequencer request orchestrator preflight-collect (worker contract), then run
   gate.mjs preflight collect:false. Never collect as worker. Missing/hand-made/
   incomplete/stale artifacts fail; preserve failed runs and loop dispositions.
7. Commit through ce-commit or repo convention only when safe; otherwise report
   exact remaining action. Record the full certificate with mono-preflight
   certificate in Linear; dispatch queues append #/certificate (single text copy).
   Enumerate every Issue verification line and obey worker recovery/lead rules.

Statuses: ready, blocked, drift-candidate, needs-human. Unconfirmed drift goes to
ship's formal decision; outside-package work returns to handoff/atomic repair
before PR. Issue-only ready may freeze only a fingerprint-matching independently
shippable slice and move expansion to follow-up Project, otherwise cancel. Set
new follow-up lead/Issue assignee to acting user (me), preserve existing ones;
follow lane contract. Apply Tiny Output Profile when appropriate.

Preflight certificate shape:

```text
mono-preflight certificate
Preflight: <ready|blocked|drift-candidate|needs-human>
Issue(s): <keys>
Branch: <branch>; commit state: <clean/dirty/committed>
Changed files: <count/list or summary>
Local verification: <commands run + outcome>
Autoreview: <clean|blocked|needs-human|unavailable>; final command: <selected-scope helper command>; clean result: <exit 0 + clean line or none>
Autoreview route: risk=<tiny|standard|deep|risky>; source=<Linear artifact or diff inference>; critical=<none|concrete escalation signal>; model=<resolved model id>; effort=<low|medium|high|xhigh>; reclassified=<no|summary>
Autoreview loop: <iterations>; accepted findings fixed: <none/list>; residual actionable findings: <none/list, must be none for ready>
Drift candidate: <none/summary>
Decision needed: <none | точное решение по-русски>
Not checked: <manual QA/browser/mobile/deploy/etc.>
Next: <mono-ship | mono-handoff | needs-human>
```

Apply worker Certificate recovery/lead and Tiny Output Profile. Decision needed
names the Russian decision/unblock. Final: certificate, git, boundary, autoreview
proof, drift and next owner.
