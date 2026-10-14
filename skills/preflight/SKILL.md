---
name: preflight
description: Use after implementation for local readiness and mandatory autoreview before ship.
---

# Mono Preflight

Shared files: here or pack root.

[Landing](references/landing.md).

No PR/merge/deploy/closeout/shipped claims or formal `mono:review pre-ship` / `mono:check pre-ship`.

Read first:

Read now:

1. `AGENTS.md`
2. `references/worker-contract.md`
3. `references/autoreview-routing.md`
4. `references/readiness-gates.md`
5. `references/human-friendly-output.md`

Read when:

- `references/issue-only-lane.md` — Issue lifecycle or lane decisions.
- `references/review-admission.md` — findings or decline proposals.

Before work/resume: identity, package/config/checks, git/diff/base, start
comments/certificates; apply worker snapshot/queue rules.

## Workflow

1. Require approved Issue and Delivery/proceed approval. Apply worker Context
   seam before scope comparison: Project-first full package; issue-only current
   oracle/fingerprint, re-read approval/marker/emit-fingerprint. Candidate/missing
   artifacts/deep-risky escalation → drift-candidate/fallback; stale context blocks.
2. Targeted checks; disclose unavailable/manual/browser/mobile/prod/acceptance.
   Final diff/approved risk: higher wins.
3. `autoreview`: resolve installed helper path; missing → blocked. Read
   Classification/Invocation in references/autoreview-routing.md; resolve
   [role:autoreview](references/model-policy.md#roles), explicit engine/model/
   thinking effort. Never substitute reviews/defaults.
4. Commit before review. Full/final deep or risky: mandatory helper loop on
   committed bytes, --mode branch --base <actual base>; fix/recheck/recommit
   before another pass. Short tiny/standard: optional local pass; checks, commit
   and collection mandatory. Record commands; failures block.
   `claude-cli`: external collection only (nested sandbox unavailable); publish
   pinned collect:false gate's returned request, confirm, rerun gate.
5. Certifying review: complete clean exit 0, no actionable residuals; P3-only
   filtered/correct is advisory, never another loop. For findings apply
   references/review-admission.md: fix or propose a decline with proof in the
   phase report. Only the orchestrator approves; a local proposal cannot certify.
   No broad/release-sensitive rewrites or weakened tests for green. Fixes repeat
   checks and the committed loop; tooling/decision blockers park.
6. Reclassify fixes. Sequencer: orchestrator preflight-collect, then gate.mjs
   preflight collect:false; no worker collection. Missing/hand-made/incomplete/
   stale proof fails. Keep failures/dispositions; receipt supplies iterations.
   Short may report 0 local passes + N collections.
7. Record the safe commit under repo convention; otherwise name remaining action.
   Record full `mono-preflight certificate` in Linear; dispatch queues
   append #/certificate (single copy). Keep every Issue verification line and
   worker recovery/lead rules.

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
Autoreview route: risk=<tiny|standard|deep|risky>; source=<Linear|diff>; critical=<none|signal>; model=<resolved model id>; effort=<low|medium|high|xhigh>; reclassified=<no|summary>
Autoreview loop: <iterations>; accepted findings fixed: <none/list>; residual actionable findings: <none/list; ready: none>
Drift candidate: <none/summary>
Decision needed: <none | точное решение по-русски>
Not checked: <manual QA/browser/mobile/deploy/...>
Next: <mono:ship | mono:handoff | needs-human>
```

Final: certificate, Russian decision/unblock, git/boundary/review proof/drift/next.

Claude ready certificate adds `Delivery differences:`: same-session startup
stop/resume; external committed-head pre-PR review, no in-worker pass.
Count local passes/collections separately.
