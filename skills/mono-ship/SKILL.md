---
name: mono-ship
description: Use for accepted pre-ship drift, PR creation, documentation and review through green; earlier repair belongs to handoff.
---

# Mono Ship

Own PR/docs/review through green, never merge/deploy/closeout. Route code/hygiene to implement/preflight. Require approved Linear Issue; discovery/docs/GitHub Issues cannot substitute.

Read first:

Read now:

1. `AGENTS.md`
2. `references/contracts/prd.md`
3. `references/contracts/tech-spec.md`
4. `references/worker-contract.md`
5. `references/readiness-gates.md`
6. `references/ship-feedback-loop.md`
7. `references/human-friendly-output.md`
8. `templates/ship-output.md`

Read when:

- `references/issue-only-lane.md` — when `lifecycle_state_entity=issue`, or the parentless ship gate routes a candidate.
- `skills/mono-preflight/SKILL.md` — when the recovered preflight certificate is missing, superseded or not `ready`.
- `templates/ship-status-ux.md` — when composing interactive status for a user.

Run exact dispatch identity before work/resume. Apply worker snapshot/queue rules.
Under mono-deliver return phase results, confirm full queues and use gate.mjs ship;
never dispatch another stage. Preserve the following order.

## Workflow

1. Apply worker Context seam/parentless gate. Project-first needs approved linked
   Issue/current Project/PRD/Spec, otherwise handoff. Valid issue-only uses oracle/
   fingerprint/current preflight, no Project docs. Absent/stale/broken approval or
   fail-closed context stops formal gates/PR; use deterministic no-promotion fallback.
2. Recover latest mono-preflight certificate. Missing/superseded → preflight;
   drift-candidate → formal review/check. Compare scope/risk/diff with artifacts.
3. Run/report required mono-review pre-ship under readiness policy and worker
   contract; unresolved decisions/artifacts/blocking findings → needs-human.
4. Apply/request accepted pre-ship Linear sync before PR creation; record user
   acceptance. Confirm its writes under the sequencer. Earlier Project-first
   repair belongs to handoff; issue-only renewal to issue intake.
5. Run/report mono-check pre-ship, readiness-only, no repairs.
6. Delegate PR creation to configured Ship workflow, with package/preflight
   context. Record number/URL/head; queue In Review and PR chip after creation,
   then confirm them before further dependent progression.
7. Run Documentation workflow after PR/before stabilization (gstack document-release
   for default Zeni/GStack). Record head effect; pushes restart on new head.
   Missing workflow means intentionally unavailable with reason; always report outcome.
8. Delegate Review feedback workflow once inspectable. Follow feedback-loop bot
   config/dedup/published-replies/convergence rules. Missing resolver: inspect once;
   actionable feedback → needs-human, otherwise all green conditions still apply.
   Product/UX/business/scope/risk questions → needs-human.
9. Obtain live gate.mjs ship pass; publish full green certificate and confirm its
   queue before terminal green. Under dispatch no direct Linear writes.

Delegate available required workflows. If unavailable, record an equivalent
gh/docs/feedback substitution under unchanged gates. Route code/hygiene and
head-change proof back to implement/preflight.

On any recovery read PR existence/head/CI/threads/merge from gh, not memory.
Use feedback-loop UX and templates/ship-status-ux.md interactively; retain the
same boundary in AFK reports. Record tiny advisory skips; risk review is lane-independent.

Green certificate shape:

For Linear prepend the Russian outcome/next lead; preserve the machine block:

```text
<1-2 Russian sentences: outcome and next>

mono-ship green certificate
Ship: green
Issue(s): <keys>
PR: <number/url>
Head SHA: <sha>
Preflight: <certificate reference + status>
Pre-ship review: <run/skipped + outcome>
Documentation workflow: <run/skipped/not configured + head SHA effect>
CI: <green/non-blocking summary>
Greptile: <completed/unavailable + outcome>
Unresolved review threads: <0/count/unknown>
Merge state: <clean/blocked/conflict/unknown>
Checked: <states inspected>
Not checked: <manual/browser/mobile/prod/deploy surfaces not inspected>
Next: mono-deploy
```

Apply worker Certificate recovery, Tiny Output Profile and Linear Exit Comments
for blocked/needs-human/timed-out; give exact unresolved question. Final: verdict,
PR/Issue/head, docs effect, review/CI/threads, certificate recorded/pending,
inspected/uninspected boundary and next owner.
