---
name: mono-preflight
description: Use after implementation and before ship to verify local branch readiness through mandatory autoreview and produce a preflight certificate.
---

# Mono Preflight

Use this skill after implementation is complete or nearly complete, before `mono-ship`.

`mono-preflight` owns local branch readiness only. It checks worktree state, compares the local diff against approved Linear scope, runs targeted verification, runs the mandatory `autoreview` closeout loop until the helper reports clean, commits when safe and configured, and emits a preflight certificate that `mono-ship` can consume.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `references/autoreview-routing.md`
3. `references/readiness-gates.md`
4. `references/execution-quality.md`
5. `references/human-friendly-output.md`

Read when — load the file only when its condition is true for this run:

- `references/issue-only-lane.md` — when the resolved seam is `lifecycle_state_entity=issue`, or when a lane freeze, follow-up, or cancel decision is in play.
- `skills/mono-check/SKILL.md` — when a `mono-check` verdict has to be run or reported from this stage.
- `skills/mono-review/SKILL.md` — when the package context does not already record the disposition of a review finding.
- `references/artifact-rules.md` — when this run must decide where a Linear record belongs or which stage owns it.
- `references/artifact-quality.md` — when this run records or queues the certificate for Linear, or recovers an earlier certificate.
- `references/lifecycle.md` — when this run routes back to `mono-handoff`, or names or queues a Linear lifecycle state.
- `templates/orchestrator-report.md` — when this stage runs from a dispatch, before writing the exit report.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.

When to use:

- Implementation has produced local changes and the user says "prepare PR", "commit", "self-review", "preflight", or "ship".
- `mono-implement` exited with `implemented-needs-preflight`.
- A branch needs local readiness proof before PR creation or ship orchestration.

Do not use:

- Before code implementation has started.
- As a substitute for `mono-review pre-ship` or `mono-check pre-ship`.
- For PR creation, review-loop stabilization, deploy, or Linear closeout. PR creation and review stabilization belong to `mono-ship`; deploy and closeout belong to `mono-deploy`.

Inputs to gather:

- Fresh package context: Linear Project, PRD, Tech Spec, and Issue for Project-first; or the self-contained Issue, marker, verified label, authenticated owner approval, and resolver output for issue-only.
- Current branch, worktree status, staged/unstaged changes, and commit state.
- Local diff against the intended base branch.
- Project config and repo validation commands from `AGENTS.md` or project docs.
- Any implementation-start or preflight Linear comments already present.

Workflow:

Pack identity gate: before any work in this stage, both on its first start and
after every resume, read `packVersion`, `sourceCommit`, and `surfaceRevision`
from the dispatch snapshot and run the installed
`../.mono-agent-workflow/scripts/verify-pack-state.mjs identity` helper against
the installed lockfile. Any mismatch exits `blocked` before verification,
autoreview, or commits; record the mismatch and the same three dispatch identity
fields in the worker report. Never continue on a different installed pack.

1. Confirm there is an approved Linear Issue and implementation is in Delivery or otherwise explicitly approved to proceed.
2. Inspect git branch and worktree state.
3. Resolve the same 5-field issue context used at Delivery Start before comparing scope:
   - For `lifecycle_state_entity=project`, require a complete approved Project-first package before comparing against Project, PRD, Tech Spec, and Issue scope exactly as before. Retain the trusted candidate provenance read for resolution (parent relationship plus verified marker/label/approval presence) outside the five-field seam. If the result came from a parentless issue-only candidate or the required Project artifacts are absent, do not treat it as a genuine Project-first package: mark the exit `drift-candidate` and trigger the deterministic fallback instead. Provenance selects fallback handling only; it does not reclassify the resolver result or expand the seam. The genuine Project-first branch remains unchanged.
   - For `lifecycle_state_entity=issue`, require `package_kind=issue-only` and `approval_status=approved-fresh`, re-read the authenticated owner approval and current marker, and use the installer-published resolver with `--emit-fingerprint` to obtain the live whole-body `scope_fingerprint`. Then compare the diff against `behavioral_oracle` plus the live `scope_fingerprint`, not against a nonexistent Project, PRD, or Tech Spec. The oracle's acceptance IDs and verification steps define the allowed behavior; the fingerprint proves the exact approved Issue body is still current. A stale marker, mismatched fingerprint, missing approval, or unresolved oracle cannot produce `ready`.
4. Run targeted tests/checks appropriate to the diff. If a check cannot run, report it under `Not checked`.
5. Run the mandatory `autoreview` gate:
   - Invoke the installed `autoreview` skill/helper. Do not substitute Compound `ce-code-review`, built-in `/review`, ad hoc self-review, reviewer panels, or a hand-written summary for this gate.
   - Resolve the concrete helper path before running it. Use an installed global helper such as `~/.codex/skills/autoreview/scripts/autoreview` or the path documented by the installed `autoreview` skill. This workflow does not vendor `autoreview`; if no helper is available, stop with `blocked`. Record the exact command in the certificate.
   - Choose the helper target using the `autoreview` contract:
     - Dirty local work: first run `<autoreview-helper> --mode local` only for the staged/unstaged/untracked tail, then apply accepted fixes and commit or intentionally leave the branch dirty with `blocked`/`needs-human`.
     - Branch or PR work: run `<autoreview-helper> --mode branch --base <resolved-base-ref>`, using the actual PR/default base when known.
     - Already-landed or single-commit work: `<autoreview-helper> --mode commit --commit <ref>`.
   - Classify the final diff as `tiny`, `standard`, `deep`, or `risky` using the approved Linear package and `references/readiness-gates.md`. If the implementation is riskier than the recorded class, use the higher class and record the drift.
   - For both lanes, preserve the existing risk-escalation rule: the higher of the approved package and final diff controls the autoreview route, and no issue-only rule weakens or replaces the canonical routing in `references/autoreview-routing.md`.
   - For an issue-only package, a final diff reclassified to `deep` or `risky` is a `drift-candidate` and triggers the deterministic Project-first fallback in `references/issue-only-lane.md`. Run the mandatory autoreview using that higher risk class, but do not emit `ready` for an out-of-envelope issue-only package.
   - Select the model and effort only from the canonical table in `references/autoreview-routing.md`; do not restate or infer a second copy of the table in this skill.
   - Pass `--engine codex`, `--model`, and `--thinking` explicitly on every helper invocation. Never rely on external helper or environment defaults, never use GPT-5.5 as a normal route, and never silently fall back to another engine, model, or effort.
   - Treat helper exit 0 plus the clean result (`autoreview clean: no accepted/actionable findings reported`) as the only successful review outcome.
   - Treat nonzero helper exit with accepted/actionable findings as not clean. Verify every finding against the real code, reject only unsupported findings with evidence, and apply small fixes for accepted/actionable findings at the right ownership boundary.
   - After any review-triggered code change, re-run the relevant targeted verification and re-run `autoreview`.
   - Keep looping until `autoreview` exits clean, or stop with `blocked`/`needs-human` if the helper is unavailable, cannot determine scope, repeatedly fails for tooling/capacity reasons, or still reports actionable findings that require a human decision.
   - Reclassify the final risk after all review-triggered fixes are committed, then re-select the model and effort from `references/autoreview-routing.md`. If risk moved upward or a new or stronger critical signal requires a higher route, the earlier clean result does not count; the final durable-scope review must use the newly selected higher route.
   - Before emitting `ready`, run one final clean review for the selected durable scope: branch/PR mode for branch or PR work, or commit mode for already-landed or single-commit work. A clean local dirty-work review alone is not sufficient when the intended reviewed artifact is committed changes.
   - Do not mark preflight `ready` while `autoreview` is unavailable, skipped, replaced by another reviewer, or still reporting accepted/actionable findings.
6. Commit via Compound `ce-commit` or repo convention when the branch is safe and the commit workflow is configured. If not safe, leave a precise next action.
7. Record the full preflight certificate as a Linear comment or resource with the stable marker `mono-preflight certificate`.
8. Emit the preflight certificate.

Certificate statuses:

- `ready`: local branch is ready for `mono-ship`.
- `blocked`: required repo state, validation, auth, or tooling is unavailable.
- `drift-candidate`: local diff may materially differ from approved Linear scope and needs formal pre-ship review or handoff repair.
- `needs-human`: a product, UX, business, external access, dirty-worktree, or risk decision is required.

Preflight certificate shape:

```text
mono-preflight certificate
Preflight: <ready|blocked|drift-candidate|needs-human>
Issue(s): <keys>
Branch: <branch>; commit state: <clean/dirty/committed>
Changed files: <count/list or summary>
Local verification: <commands run + outcome>
Autoreview: <clean|blocked|needs-human|unavailable>; final command: <selected-scope helper command>; clean result: <exit 0 + clean line or none>
Autoreview route: risk=<tiny|standard|deep|risky>; source=<Linear artifact or diff inference>; critical=<none|concrete escalation signal>; model=<gpt-5.6-luna|gpt-5.6-sol>; effort=<low|medium|high|xhigh>; reclassified=<no|summary>
Autoreview loop: <iterations>; accepted findings fixed: <none/list>; residual actionable findings: <none/list, must be none for ready>
Drift candidate: <none/summary>
Decision needed: <none | точное решение по-русски>
Not checked: <manual QA/browser/mobile/deploy/etc.>
Next: <mono-ship | mono-handoff | needs-human>
```

For `tiny` work, follow the Tiny Output Profile in references/readiness-gates.md.

Rules:

- Do not create the final PR.
- Do not merge, deploy, close Linear Issues, or mark work shipped.
- Do not run or claim `mono-review pre-ship`; it remains owned by `mono-ship`.
- Do not run or claim `mono-check pre-ship`; it remains owned by `mono-ship`.
- If drift appears material but not yet confirmed, mark `drift-candidate` and let `mono-ship` own the formal pre-ship review/check decision.
- The issue-only lane never promotes an Issue into a Project in place. After `ready`: freeze the independently shippable slice while its whole-body fingerprint still matches, keep expanded scope out of the current PR, and create a separate follow-up Project; otherwise cancel. Set that follow-up Project's lead to the acting user (`lead: "me"` on the Linear connector) and the assignee of every Issue created in it to the same acting user (`assignee: "me"`) at creation, and never overwrite an assignment that already exists. Follow `references/issue-only-lane.md`.
- If drift is already clearly outside the approved package, route back to `mono-handoff` or explicit atomic artifact repair before PR.
- Do not cap the review loop at an arbitrary round count. The `autoreview` helper is the loop authority; preflight readiness requires its clean result.
- Do not call Compound `ce-code-review` for this gate. It is not an acceptable replacement for `autoreview` inside `mono-preflight`.
- Do not auto-apply broad rewrites, release-sensitive changes, or fixes that the agent cannot defend after reading the relevant code and contracts.
- Do not silently reject a repeated `autoreview` finding and mark `ready`. If `autoreview` does not return clean, the certificate must be `blocked` or `needs-human`.
- The stage exit report enumerates every «Как проверить» item of the Issue, each with a `pass | deferred | not-run` status and one line of evidence. Under orchestration that list is the `verification_items` array of the mailbox report, in the shape `templates/orchestrator-report.md` defines. The stage cannot claim completion while an item is silently missing; `deferred`/`not-run` are valid only with a recorded reason in the evidence.
- Do not mark preflight `ready` when the final `autoreview` command omits explicit `--engine codex`, `--model`, or `--thinking`, selects a non-GPT-5.6 model, or does not match the final risk class in `references/autoreview-routing.md`.
- Keep Linear-facing comments in the project config language; use Russian when no project config is present.
- Include a checked/not-checked boundary. Local tests do not imply browser QA, production smoke, mobile QA, deploy verification, or user acceptance.
- Do not summarize the certificate away in Linear. A fresh `mono-ship` agent must be able to recover the full certificate from Linear comments or resources.

Human Linear comment/resource shape:

The certificate block above, unchanged, with one addition: a Russian human lead
`<1-2 предложения по-русски: итог и следующий шаг>` as the first line, then a
blank line, then the `mono-preflight certificate` marker line and the rest of
the block exactly as printed. Nothing else differs between the two forms — the
chat and report form carries the machine core with no lead.

Rules for the Human Linear comment:

- The Russian human lead (1-2 sentences) is required; it states the outcome and next step for the operator. It is required in the Linear comment/resource form and absent from the chat and report form — never optional in either direction.
- The machine core below the marker line is never translated, reworded, or summarized away — downstream skills recover the certificate by its stable marker and field keys.
- `Decision needed:` must be non-`none` whenever the certificate status is `needs-human`; name the exact decision or unblock required in Russian.

Final response must include:

- Preflight certificate.
- Whether local code is committed, dirty, or blocked.
- Tests/checks run and not run.
- Autoreview command and outcome.
- Autoreview risk route, model, reasoning effort, source, and any upward reclassification.
- Autoreview loop iterations, accepted findings fixed, and residual actionable findings.
- Drift candidate summary.
- Next workflow recommendation.
