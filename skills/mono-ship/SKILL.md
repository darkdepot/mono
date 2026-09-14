---
name: mono-ship
description: Use for accepted pre-ship drift and when shipping a Linear-tracked change through PR creation, repo documentation sync, strict PR review stabilization, and a deploy-ready mono-ship green certificate; earlier artifact repair belongs to mono-handoff.
---

# Mono Ship

Own configured PR/docs/review through green. No merge/deploy/closeout; code/hygiene routes to implement/preflight. Require approved Linear Issue; discovery/PRD/Spec/GitHub Issues alone do not qualify.

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

Run `verify-pack-state.mjs identity` before work/resume with dispatch `packVersion`, `sourceCommit`, `surfaceRevision`; mismatch is blocked before PR/Linear. Apply worker-contract snapshot/queue/sequencing.

Workflow:

1. `prepare`: apply worker-contract Context seam with current Issue/resolver inputs/config and `--emit-fingerprint`.
2. `prepare`: apply the Parentless ship gate below. A genuine Project-first package requires approved Issue linked to Project with current PRD/Tech Spec context, otherwise route to `mono-handoff`.
3. `prepare`: recover the latest `mono-preflight certificate` from comments/resources. Missing/superseded → preflight; `drift-candidate` → formal review/check. No PR before required gates pass.
4. `prepare`: classify scope/risk and compare branch/pending PR with approved artifacts.
5. `prepare`: run/report required `mono-review pre-ship` under the worker contract and readiness policy. Unresolved decisions, missing artifacts or blocking findings stop `needs-human`.
6. `prepare`: apply/request accepted pre-ship Linear sync through this stage before PR creation. Record user acceptance in comments. Earlier Project-first repair belongs to handoff; issue-only body renewal belongs to issue intake.
7. `prepare`: run/report `mono-check pre-ship` under the worker contract. No check/review repairs.
8. `create-pr`: gather package context and preflight certificate; delegate PR creation to configured Ship workflow.
9. `create-pr`: record PR number/URL/latest head SHA, set Issue `In Review`, add PR chip.
10. `document-pr`: run configured Documentation workflow after PR creation and before final stabilization (`gstack document-release` for default Zeni/GStack). If it pushes, record new head and restart stabilization there.
11. `stabilize-review`: enter the feedback loop whenever checks/reviews are inspectable. Delegate to configured Review feedback workflow. Missing documentation/resolver is `not configured`, never a reason to omit a terminal outcome. With no resolver, wait for checks/reviews once; actionable feedback is `needs-human`, otherwise strict green conditions still apply.
12. `green-certificate`: once green, record full `mono-ship green certificate` in comments/resources and return the ship-output report.

Parentless ship gate:

Apply worker-contract Context seam before formal review/check/PR. Project-first requires approved linked Issue/current Project/PRD/Spec. Valid issue-only uses self-contained oracle/fingerprint/current preflight, never routes to handoff merely for absent Project/docs. Absent/stale/broken/mismatched approval or fail-closed parentless result stops and routes deterministic no-promotion fallback. Risk-based review stays lane-independent; tiny advisory requires recorded reason.

Workflow delegation:

Delegate available configured ship/docs/resolver workflows; no direct PR/feedback implementation or workflow fork. Only if unavailable, perform equivalent push/PR via gh, docs and feedback steps under unchanged gates; record substitution in notes. No merge/deploy/shipped closeout.

After interruption/capacity failure/crash/resume/respawn reconstruct PR existence/exact head/CI/threads/merge exclusively via gh before stabilization/green; memory is unverified. Apply feedback bot-config/dedup/fail-safe/published-replies/convergence rules. Product/UX/business/scope/risk feedback → needs-human.

User-facing ship status UX:

Apply Review Status Reporting in `references/ship-feedback-loop.md` and human-output rules: outcome first, exact decision/options/consequences/recommendation, evidence boundary. Render `templates/ship-status-ux.md` interactively; AFK includes the same content in report/certificate.

Green certificate shape:

For Linear prepend required Russian outcome/next lead; keep the machine block unchanged:

```text
<1-2 предложения по-русски: итог и следующий шаг — e.g. «PR готов к деплою: ревью чистое, CI зелёный. Дальше — mono-deploy.»>

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

Apply worker-contract Certificate recovery.

For `tiny` work, follow the Tiny Output Profile in references/readiness-gates.md.

Exit comment rule:

For needs-human/blocked/timed-out apply Linear Exit Comments in `references/human-friendly-output.md`; unresolved-feedback needs-human includes the exact question under `references/ship-feedback-loop.md`.

Final response: verdict/PR/Issue/head, docs/head effect, review/CI/threads, certificate recorded/not, full boundary and next owner.
