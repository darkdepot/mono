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

- `references/issue-only-lane.md` — when lifecycle_state_entity=issue, or a lane freeze/follow-up/cancel decision is in play.

Before work/resume: identity, package/config/validation, git/diff/base and start
comments/certificates; apply worker snapshot/queue/confirmation rules.

## Workflow

1. Require approved Issue and Delivery or explicit proceed approval. Before
   scope comparison apply worker Context seam: full package for Project-first;
   current oracle/fingerprint and re-read approval/marker/emit-fingerprint for
   issue-only. Candidate/missing artifacts/deep-risky escalation → drift-candidate/
   fallback; stale/unresolved context cannot ready.
2. Run targeted checks; report unavailable/manual/browser/mobile/prod/acceptance
   surfaces honestly. Compare final diff risk with approved risk; higher wins.
3. `autoreview`: resolve installed helper path; missing → blocked. Read
   Classification/Invocation in references/autoreview-routing.md; resolve
   [role:autoreview](references/model-policy.md#roles), explicit engine/model/
   thinking effort. Never substitute reviews/defaults.
4. Full/final deep or risky: mandatory --mode local helper loop, fix accepted
   findings, safely commit. Short tiny/standard: optional local pass;
   mandatory targeted checks/commit/collection. Local clean never certifies
   committed scope: --mode branch --base <actual base>, or --mode commit --commit
   <ref> for single/already-landed scope. Record commands; failures block.
   `claude-cli`, every risk/profile: external collection only, no in-worker pass
   (nested sandbox unavailable). Check/commit; publish pinned collect:false gate's
   returned request, await confirmation, rerun gate. Fix/recheck/recommit/recollect
   to pass under unchanged model/effort/clean-result rules. Codex keeps local loop.
5. Certifying review: exit 0, complete clean result, no actionable residuals.
   --max-priority P2 accepts clean/scoped-clean or exit-0 filtered/correct with no
   accepted/missing findings and only P3 filtered. Record P3 advisory; no P3-only
   loops. Check findings against contracts/code; reject with evidence or apply
   small defensible owner-scoped fixes. No broad/release-sensitive rewrites or
   weakened/deleted/rewritten tests for green. Changes repeat targeted checks and
   required local loop; tooling/decision blockers park.
6. Reclassify after fixes. Sequencer: orchestrator preflight-collect, then
   gate.mjs preflight collect:false; never worker collection. Missing/hand-made/
   incomplete/stale committed-scope proof fails. Keep failed runs/dispositions;
   receipt supplies iterations. Short may report 0 local passes + N collections.
7. Safe commit through ce-commit/repo convention; otherwise name remaining action.
   Record full `mono-preflight certificate` in Linear; dispatch queues
   append #/certificate (single copy). Keep every Issue verification line and
   worker recovery/lead rules.

Statuses: ready, blocked, drift-candidate, needs-human. Ship judges unconfirmed
drift; outside-package work → handoff/atomic repair before PR. Issue-only freeze:
fingerprint-matching independently shippable scope; expansion → follow-up Project, else cancel.
New follow-up lead/assignee: acting user; preserve owners. Apply lane/Tiny Output.

Certificate:

```text
mono-preflight certificate
Preflight: <ready|blocked|drift-candidate|needs-human>
Issue(s): <keys>
Branch: <branch>; commit state: <clean/dirty/committed>
Changed files: <count/list/summary>
Local verification: <commands/outcomes>
Autoreview: <clean|blocked|needs-human|unavailable>; final command: <scope helper command>; clean result: <exit 0 + clean line|none>
Autoreview route: risk=<tiny|standard|deep|risky>; source=<Linear|diff>; critical=<none|signal>; model=<resolved model id>; effort=<low|medium|high|xhigh>; reclassified=<no|summary>
Autoreview loop: <iterations>; accepted findings fixed: <none/list>; residual actionable findings: <none/list; ready: none>
Drift candidate: <none/summary>
Decision needed: <none | точное решение по-русски>
Not checked: <manual QA/browser/mobile/deploy/...>
Next: <mono:ship | mono:handoff | needs-human>
```

Final: certificate with Russian decision/unblock, git, boundary, review proof,
drift and next owner.

Claude ready certificate adds `Delivery differences:`: same-session startup
stop/resume; external committed-head pre-PR review, no in-worker pass.
Count local passes/collections separately.
