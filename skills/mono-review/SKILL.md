---
name: mono-review
description: Use when reviewing Linear Project, PRD, Tech Spec, Issue, a proposed artifact repair classification, or pre-ship readiness quality without mutating Linear artifacts.
---

# Mono Review

Use this skill to review the quality of Mono workflow artifacts before handoff, delivery, issue creation, or ship.

`mono-review` is report-only. It finds drift, gaps, and decisions. It must not create, update, delete, or silently repair Project, PRD, Tech Spec, Issue, or PR state.

Read first:

1. `AGENTS.md`
2. `references/artifact-rules.md`
3. `references/artifact-quality.md`
4. `references/readiness-gates.md`
5. `references/execution-quality.md`
6. `references/review-rubric.md`
7. `references/human-friendly-output.md`
8. `templates/review-output.md`
9. `references/repair-machine.md`

Modes:

- `handoff`
- `delivery`
- `issue`
- `issue-only`
- `pre-ship`
- `artifact`

Workflow:

1. Fetch fresh Linear Project, PRD, Tech Spec, and Issue state relevant to the mode.
2. Fetch PR, branch, review, and merge state only when running `pre-ship`.
3. Read project config for Linear-facing language and configured ship, documentation, review feedback, and deploy workflows.
4. Classify risk using `references/readiness-gates.md`.
5. Decide whether the review gate is `required` or `advisory`.
6. Apply the rubric in `references/review-rubric.md`.
7. Return the report in `templates/review-output.md`.
8. Recommend the next owner workflow.

In `artifact` mode, inspect the proposed repair class against the exact
stable-ID diff and evidence in `references/repair-machine.md`. Confirm the
class 1/2 guard set is unchanged, fail closed to class 3 on ambiguity or risk
growth, and report every required class effect. This remains report-only:
`mono-review` neither applies the repair nor mutates approvals, snapshots,
certificates, workers, Issues, or Project lifecycle.

Rules:

- Do not use `PASS`, `FAIL`, or `BLOCKED` as the main review status. Those belong to `mono-check`.
- Translate the review verdict into a short human meaning before recommending the next workflow.
- Do not mutate Linear artifacts.
- Do not record Linear comments.
- Do not create Issues or PRs.
- Do not replace `mono-check`; run or recommend `mono-check` for readiness status after accepted fixes land.
- Keep Linear-facing report content in the project config language; use Russian when no project config is present.
- Keep repo skill instructions and docs in English.
- Treat Project, PRD, Tech Spec, and Issue as source of truth.
- Treat GitHub as PR, review, CI, deploy, and merge history only.
- Include a compact "checked / not checked" boundary. For `pre-ship`, distinguish inspected PR/review/CI state from manual QA, browser QA, deployment verification, or production smoke that did not run.
- For PRD review, check actor -> capability -> benefit coverage and behavior-validation intent.
- For Issue review, check two axes: whether a zero-context agent can execute it, and whether the Issue is durable rather than procedural or stale-prone.
- For issue-only work, the self-contained Issue is the sole artifact and source of truth: review it against the issue-only contract — objective/scope/desired behavior, acceptance criteria with stable IDs, verification, non-goals, the recorded risk class, and a non-vacuous behavioral oracle — and do not require or expect a Project, PRD, or Tech Spec. This mode is entered in two situations. (a) Intake-authorized draft: `mono-issue` invokes it to run the mandatory pre-approval review on the drafted, non-startable Issue before the marker, `issue-only` label, and approval exist — the resolver still returns project-first at that point, so authorization comes from intake, not from the resolver, and the intentionally absent Project/PRD/Tech Spec is never treated as a missing artifact. (b) Resolved: the resolver already returns `package_kind=issue-only` for an activated package. In both situations, standard issue-only still needs a `ready` verdict; tiny stays advisory.
- For bug and performance work, check that the Issue or PR carries a reproduction or feedback-loop contract and that pre-ship status reports fix proof.
- For deep or risky work, apply the architecture lens from `references/execution-quality.md`: interface as test surface, deletion test, and no shallow pass-through modules.

Verdicts:

- `ready`: required review ran and no blocking findings remain.
- `advisory-ready`: review was advisory or tiny scope, and no blocking risk was found.
- `needs-fixes`: blocking findings, proposed fixes, or decisions should be handled before moving forward.
- `blocked`: required artifacts, permissions, or context are unavailable.

Owner workflows:

- `mono-handoff`: applies accepted Project-first package fixes and executes the
  reviewed repair transaction before creating or resuming execution Issues.
- `mono-implement`: owns Delivery Start and implementation-start approval, then executes from approved Issue(s).
- `mono-preflight`: owns local branch readiness, targeted verification, the mandatory `autoreview` clean gate, commit state, and preflight certificate.
- `mono-handoff`: applies accepted Project-first PRD or Tech Spec fixes, including targeted repair before pre-ship.
- `mono-issue`: applies accepted Issue-only fixes when explicitly invoked.
- `mono-ship`: handles formal pre-ship review/check, accepted pre-ship drift sync, PR/review state, documentation-before-green, and green certificate.
- `mono-deploy`: handles deploy workflow delegation, post-ship check, Linear closeout, and learning capture.
- Human decision: handles product, UX, business, or scope questions.

Hard boundaries:

- If the only issue is project config or legacy vendored workflow drift, recommend `mono-check project-config`; use `node scripts/project-config.mjs --repo <project> --check` from upstream when available.
- If the package is missing a required artifact, report `blocked` or `needs-fixes`; do not create it. In the issue-only lane the sole required artifact is the self-contained Issue — an absent Project, PRD, or Tech Spec is expected there, not a missing artifact.
- If a review is advisory because the work is tiny, say why it is advisory and what would make it required.
- If scope is standard, deep, or risky, missing `mono-review` should be treated by `mono-check` as a readiness problem until review runs or an explicit exception is recorded.

Final response must include:

- Review verdict.
- Human meaning of the verdict.
- Mode.
- Risk classification.
- Whether the gate is required or advisory.
- Inspected artifacts.
- What was checked and what was not checked.
- Findings grouped as blocking findings, proposed fixes, decisions, and FYI.
- Recommended next workflow.
