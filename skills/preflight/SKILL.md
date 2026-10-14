---
name: preflight
description: Use after implementation for local readiness and mandatory autoreview before ship.
---

# Mono Preflight

Shared files: here or pack root.

[Landing](references/landing.md).

No PR/merge/deploy/closeout or formal pre-ship review/check.

Read first:

Read now:

1. `AGENTS.md`
2. `references/worker-contract.md`
3. `references/autoreview-routing.md`
4. `references/readiness-gates.md`
5. `references/human-friendly-output.md`

Read when:

- `references/issue-only-lane.md` — Issue lifecycle or lane decisions.
- `references/review-admission.md` — review loops, findings or declines.

Before work/resume: identity, package/config/checks, git/diff/base, start
comments/certificates; apply worker snapshot/queue rules.

## Workflow

1. Require approved Issue/start and worker Context seam: Project-first package;
   issue-only current oracle/fingerprint/approval/marker. Candidate/missing
   artifacts/risk escalation → drift-candidate/fallback; stale context blocks.
2. Targeted checks; disclose unavailable/manual/browser/mobile/prod/acceptance.
   Final diff/approved risk: higher wins.
3. `autoreview`: resolve installed helper path; missing → blocked. Read
   Classification/Invocation in references/autoreview-routing.md; resolve
   [role:autoreview](references/model-policy.md#roles), explicit engine/model/
   thinking effort. Never substitute reviews/defaults.
4. Commit before review. Full/final deep/risky: mandatory committed loop,
   --mode branch --base <actual base>; fix/check/commit before another pass.
   Short tiny/standard: local pass optional; checks/commit/collection mandatory.
   Use review-admission caps; keep cumulative capsule.local_passes [{id,head}].
   `claude-cli`: external collection only (nested sandbox unavailable); publish
   pinned collect:false gate's returned request, confirm, rerun gate.
5. Certifying review: complete clean exit 0/no actionable residuals; P3-only
   filtered/correct is advisory. Apply references/review-admission.md for findings;
   only orchestrator-approved declines certify. No broad/release-sensitive rewrites
   or weakened tests. Fixes repeat checks/committed review within allowances;
   tooling/decision blockers park.
6. Reclassify fixes. Orchestrator preflight-collect, then gate.mjs preflight
   collect:false. Missing/hand-made/incomplete/stale proof fails. Retain failures;
   count local passes/collections separately (short may have zero local passes).
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
Autoreview: <clean|accepted-with-declines|blocked|needs-human|unavailable>; final command: <scope helper command>; result: <exit 0 + clean line|accepted-with-declines + receipt|none>
Autoreview declines: <none|finding id; basis; approvedBy for each>
Autoreview decisions: <none|stop id; continue id; remaining local/external allowances>
Autoreview route: risk=<tiny|standard|deep|risky>; source=<Linear|diff>; critical=<none|signal>; model=<resolved model id>; effort=<low|medium|high|xhigh>; reclassified=<no|summary>
Autoreview loop: <iterations>; accepted findings fixed: <none/list>; residual actionable findings: <none/list; ready: none>
Drift candidate: <none/summary>
Decision needed: <none | точное решение по-русски>
Not checked: <manual QA/browser/mobile/deploy/...>
Next: <mono:ship | mono:handoff | needs-human>
```

Claude ready certificate adds `Delivery differences:`: same-session startup
stop/resume; external committed-head pre-PR review, no in-worker pass.
Count local passes/collections separately.
