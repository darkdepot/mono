---
name: mono-ship
description: Use for accepted pre-ship drift and when shipping a Linear-tracked change through PR creation, repo documentation sync, strict PR review stabilization, and a deploy-ready mono-ship green certificate; earlier artifact repair belongs to mono-handoff.
---

# Mono Ship

Use this wrapper around the project repo's configured ship, documentation, and review feedback workflows.

`mono-ship` owns the PR lifecycle up to a deploy-ready green certificate. It does not merge, deploy, close Linear Issues as shipped, or run the deploy workflow. Those belong to `mono-deploy`.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `references/contracts/prd.md`
3. `references/contracts/tech-spec.md`
4. `references/readiness-gates.md`
5. `references/ship-feedback-loop.md`
6. `references/human-friendly-output.md`
7. `templates/ship-output.md`

Read when — load the file only when its condition is true for this run:

- `references/issue-only-lane.md` — when the resolved seam is `lifecycle_state_entity=issue`, or when the parentless ship gate routes a candidate.
- `references/install.md` — when the shipped change is a skill-pack delivery that installs or cuts over the pack.
- `skills/mono-preflight/SKILL.md` — when the recovered preflight certificate has to be judged rather than read.
- `skills/mono-review/SKILL.md` — when `mono-review pre-ship` is run or its report has to be judged from this stage.
- `skills/mono-check/SKILL.md` — when `mono-check pre-ship` is run or reported from this stage.
- `references/artifact-rules.md` — when ownership, language, or placement of a Linear artifact or comment is in question.
- `references/execution-quality.md` — when scope, drift, or verification evidence in the diff has to be judged.
- `templates/ship-status-ux.md` — when running interactively and a ship status is composed for a user.
- `templates/orchestrator-report.md` — when this stage runs from a dispatch, before writing the exit report.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.

Workflow:

Pack identity gate: before any work in this stage, both on its first start and
after every resume, read `packVersion`, `sourceCommit`, and `surfaceRevision`
from the dispatch snapshot and run the installed
`../.mono-agent-workflow/scripts/verify-pack-state.mjs identity` helper against
the installed lockfile. Any mismatch exits `blocked` before PR or Linear work;
record the mismatch and the same three dispatch identity fields in the worker
report. Never continue on a different installed pack.

1. `prepare`: fetch the Linear Issue plus the trusted context-resolver inputs: current marker comment, verified labels, authenticated owner-approval fingerprint, and project config. Resolve the 5-field context seam before deciding whether to route to `mono-handoff`; also run the installer-published resolver with `--emit-fingerprint` against the live Issue body so freshness is checked from the authoritative whole-body SHA-256.
2. `prepare`: branch on the resolved seam through the Parentless ship gate below. Project-first ship behavior remains unchanged: a genuine Project-first package still requires an approved Linear Issue linked to the Project with current PRD/Tech Spec context, otherwise stop and route to `mono-handoff`.
3. `prepare`: read the latest `mono-preflight certificate` from Linear comments or resources. If no certificate exists, route to `mono-preflight` before continuing.
4. `prepare`: classify scope/risk and compare branch or pending PR scope against Linear artifacts.
5. `prepare`: run or report `mono-review pre-ship` when required by `references/readiness-gates.md`.
6. `prepare`: apply or request accepted pre-ship Linear sync decisions through `mono-ship` before PR creation.
7. `prepare`: run or report `mono-check pre-ship`.
8. `create-pr`: gather Project, PRD, Tech Spec, Issue context, and preflight certificate for the configured Ship workflow.
9. `create-pr`: delegate actual PR creation to the configured Ship workflow.
10. `create-pr`: after PR creation, record PR number, PR URL, and latest head SHA; update the Linear Issue to `In Review` and add a PR chip.
11. `document-pr`: when a Documentation workflow is configured, run it after PR creation and before the final review loop. Default Zeni/GStack workflow is `gstack document-release`.
12. `document-pr`: if documentation changes push commits, record the new head SHA and restart review stabilization from that head.
13. `stabilize-review`: when a Review feedback workflow is configured, run the feedback loop in `references/ship-feedback-loop.md`.
14. `green-certificate`: when the review loop is green, record a `mono-ship green certificate` in Linear comments or resources.
15. Return the concise report in `templates/ship-output.md`.

Parentless ship gate:

- Preserve the trusted candidate provenance used for resolution — parent relationship plus verified marker/label/approval presence — outside the five-field seam. It can distinguish a genuine Project-first package from a parentless issue-only candidate, but it never reclassifies the resolver output or adds another seam field.
- When a parentless candidate resolves `package_kind=issue-only` with `approval_status=approved-fresh`, require `lifecycle_state_entity=issue`, a non-empty `behavioral_oracle`, and `risk_class` in `tiny|standard`. Continue shipping from the self-contained Issue and its current preflight certificate; do not route the parentless Issue to `mono-handoff` merely because Project, PRD, and Tech Spec do not exist.
- An absent marker resolves `project-first` and routes the parentless candidate through the deterministic fallback to `mono-handoff`; it must not be mistaken for a complete Project-first package. A `stale marker` resolver error is a hard stop that routes back to `mono-handoff` under the same no-promotion fallback contract. Never continue to formal pre-ship review/check or PR creation with absent, stale, broken, or mismatched issue-only approval state.
- For issue-only, compare branch/PR scope with the live Issue `behavioral_oracle` and approved whole-body fingerprint recovered through the resolver, not with nonexistent Project artifacts. The issue-only lane never promotes the Issue into a Project in place; follow `references/issue-only-lane.md` for freeze/cancel and follow-up handling.
- The review policy is lane-independent. Required `mono-review pre-ship` runs for `standard`, `deep`, `risky`, or materially drifted work before PR creation or green certification; only `tiny` remains advisory for the recorded reason.

User-facing ship status UX:

- Start with the outcome in human language. Do not start with `Mono ship: <verdict>` when talking to the user.
- Translate internal verdicts:
  - `green`: PR is ready for `mono-deploy`; it has not been merged, deployed, or closed by `mono-ship`.
  - `needs-human`: a specific decision is needed; name the decision, not only the verdict.
  - `blocked`: the workflow cannot proceed because required context, auth, tools, PR state, or Linear state is unavailable.
  - `timed-out`: waiting did not settle; name what is still pending.
- Whatever renders the status, it must carry all of this content: who or what
  reviewed and the outcome; what was found and what was fixed; the count and
  state of unresolved threads; CI state; whether the PR is review-safe; and,
  when a resolver or documentation workflow pushed fixes, the exact head SHA
  after that push plus the fact that review status was re-checked against it.
- For bug and performance work the status carries the original reproduction or
  baseline, the proof of the fix, and the regression proof or the documented
  gap.
- The status carries a compact checked / not-checked boundary and says plainly
  when manual browser QA, production smoke, mobile QA, deploy verification, or
  any other surface was not run.
- Do not dump phase names, git directives, or internal workflow telemetry that
  does not explain the status. When a human decision is needed, end with
  concrete options that state their consequences, and recommend one when review
  or CI state makes a path clearly preferable.

Interactive rendering — the Russian status copy, the «Статус ревью» block, and
the «Review timeline» worked example live in `templates/ship-status-ux.md` and
are read at composition time when a user is present. Under orchestration this
stage runs AFK with no user on its side: it renders none of them, and the
content requirements above are satisfied by the report and the certificate
instead. Moving that copy out changes nothing about which gates run or what the
status must contain.

Green certificate shape:

When recording this certificate as a Linear comment, open with the Russian human lead above the machine block:

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

The Russian human lead is required in Linear; the machine core below the marker is never translated or summarized away.

For `tiny` work, follow the Tiny Output Profile in references/readiness-gates.md.

Exit comment rule:

For `needs-human`, `blocked`, and `timed-out` ship endings, post a short Russian Linear exit comment on the Issue following the Linear Exit Comments rule in `references/human-friendly-output.md`. For `needs-human` caused by unresolved review feedback, the comment must include the exact question as required by `references/ship-feedback-loop.md` — reference that rule rather than duplicating it here.

Rules:

- Do not create PRs directly.
- Do not fork or reimplement the project repo's ship workflow.
- Runtime-availability fallback: when a configured ship, documentation, or review feedback workflow is not available in the current runtime (for example a Codex worker where Compound or gstack skills are not invocable), perform the equivalent steps directly under this skill's own gates — branch push and PR creation via `gh`, documentation sync, feedback resolution — keep the gate ordering and the green-certificate contract unchanged, and record the substitution in the report (`notes` field under orchestration). This is a last-resort delegation path, never permission to bypass a configured workflow that is available.
- Do not resolve review feedback directly when a configured resolver exists; delegate to it.
- Do not merge or deploy directly; route green PRs to `mono-deploy`.
- Do not close Linear Issues as shipped; `mono-deploy` owns verified delivery closeout.
- Do not perform initial implementation or local branch hygiene; route those to `mono-implement` or `mono-preflight`.
- Do not start from a raw discovery/review plan, PRD, or Tech Spec; shipping starts from an approved Linear Issue.
- Do not use GitHub Issues as requirements.
- Sync material drift back to Linear before claiming completion.
- Use Linear comments for user review acceptance, not Project Updates.
- `mono-review` is report-only; `mono-ship` owns accepted pre-ship drift sync, `mono-check pre-ship`, PR/review state updates, documentation-before-green orchestration, and the green certificate.
- Required `mono-review pre-ship` runs for `standard`, `deep`, `risky`, or materially drifted work before PR creation or green certification.
- `mono-preflight` owns local branch readiness and emits a certificate; it must not run or claim `mono-review pre-ship`, `mono-check pre-ship`, PR creation, deploy, or closeout.
- Do not continue into formal pre-ship review/check or PR creation without a recoverable `mono-preflight certificate` in Linear comments or resources.
- Stop with `needs-human` when required review returns unresolved decisions, missing artifacts, or blocking findings.
- After PR creation, enter review stabilization whenever PR checks/reviews can be inspected. Missing Documentation or Review feedback workflows are reported as `not configured`; they are not a reason to skip the green/blocked/timed-out/needs-human outcome.
- If Review feedback workflow is absent, wait for checks/reviews once; stop with `needs-human` if actionable feedback appears, otherwise create the green certificate when strict conditions are met.
- Stop with `needs-human` when feedback asks for product, UX, business, or scope decisions.
- PR state after interruption — gh only: after ANY turn interruption (provider capacity error, crash, resume, respawn), the worker or orchestrator reconstructs PR/CI/review state exclusively via `gh` commands against the exact head SHA — never from thread memory; state assumed from memory is treated as unverified. Re-verify PR existence, head SHA, CI checks, review threads, and merge state with `gh` before continuing stabilization or recording a green certificate (HD-46 precedent: a ship turn died on a provider capacity error after push + PR creation, and PR state had to be reconciled via `gh`).
- Review-loop hygiene: follow the Review Bot Configuration Check, Finding Dedup with its fail-safe, Published Replies, and Non-Blocking Convergence rules in `references/ship-feedback-loop.md`; the Published Replies submitted-check is an additional green-certificate precondition.
- Final verdict `green` always means "ready for `mono-deploy`", not merged or deployed.

Final response must include:

- Ship verdict.
- PR URL and Linear Issue key.
- Latest head SHA.
- Whether documentation workflow ran and whether it changed the head SHA.
- Review status, CI status, and unresolved feedback count.
- Whether a `mono-ship green certificate` was recorded.
- Checked and not-checked boundary.
- Next workflow recommendation, normally `mono-deploy`.
