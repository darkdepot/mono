---
name: preflight
description: Use after implementation for local readiness and the mandatory review round before ship.
---

# Mono Preflight

Shared files: here or pack root.

[Landing](references/landing.md).

Only a draft PR; no ready/merge/deploy/closeout or formal pre-ship review/check.

Read first:

Read now:

1. `AGENTS.md`
2. `references/worker-contract.md`
3. `references/readiness-gates.md`
4. `references/human-friendly-output.md`

Read when:

- `references/issue-only-lane.md` — Issue lifecycle or lane decisions.
- `references/review-admission.md` — review rounds, findings or parks.

Before work/resume: identity, package/config/checks, git/diff/base, start
comments/certificates; apply worker snapshot/queue rules.

## Workflow

1. Require approved Issue/start and worker Context seam: Project-first package;
   issue-only current oracle/fingerprint/approval/marker. Candidate/missing
   artifacts/risk escalation → drift-candidate/fallback; stale context blocks.
2. Targeted checks; disclose unavailable/manual/browser/mobile/prod/acceptance.
   Final diff/approved risk: higher wins.
3. `review round`: the orchestrator's collection runs it read-only on the
   committed head with [role:code-review](references/model-policy.md#roles) and
   [role:code-review-checker](references/model-policy.md#roles), then
   verification. No in-worker review or substitute.
4. Commit; first request: `scripts/ship-pr.mjs open` (draft, once). Later: `push`,
   then `remarks`; fixed ones go in the request's `prRemarks`. Run the pinned
   gate.mjs preflight collect:false, publish its returned request, confirm, rerun.
5. Follow the gate line per references/review-admission.md: open findings → fix,
   check, commit, next round (three per attempt); `needs-decision:`/`blocked:`
   → park. No broad/release-sensitive rewrites or weakened tests.
6. Reclassify fixes. Pass needs review clean|clean-with-successors and
   verification on this head; missing/hand-made/old/stale proof fails.
7. Record safe commit/action; full `mono-preflight certificate` in
   Linear, dispatch append #/certificate once. Keep Issue verification/recovery/lead.

Statuses: ready, blocked, drift-candidate, needs-human. Ship judges unconfirmed
drift; package expansion needs handoff/atomic repair. Apply lane freeze/exit and
Tiny Output; acting user leads new follow-ups, existing owners remain.

Certificate:

```text
mono-preflight certificate
Preflight: <ready|blocked|drift-candidate|needs-human>
Issue(s): <keys>
Branch: <branch>; commit state: <clean/dirty/committed>
Changed files: <count/list/summary>
Local verification: <commands/outcomes>
Review: <clean|clean-with-successors|not-converged|not-reviewed|unavailable>; round: <n of 3>; receipt: <collectionId|none>
Review successors: <none|weight file:line title for each>
Review route: risk=<tiny|standard|deep|risky>; source=<Linear|diff>; critical=<none|signal>; reclassified=<no|summary>
Drift candidate: <none/summary>
Decision needed: <none | точное решение по-русски>
Not checked: <manual QA/browser/mobile/deploy/...>
Next: <mono:ship | mono:handoff | needs-human>
```

Claude ready certificate adds `Delivery differences:`: same-session startup
stop/resume.
