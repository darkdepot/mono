---
name: mono-preflight
description: Use after implementation and before ship to verify local branch readiness through mandatory autoreview and produce a preflight certificate.
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

Before work/resume run `verify-pack-state.mjs identity` with dispatch `packVersion`, `sourceCommit`, `surfaceRevision`; mismatch blocks checks/review/commits. Gather package/config/validation/git/diff/base/start comments/certificates; apply worker-contract snapshot/queue rules.

Workflow:

1. Require an approved Issue and Delivery state or other explicit approval to proceed.
2. Inspect git.
3. Apply worker-contract Context seam before comparing scope: genuine Project-first against full package; issue-only against live oracle/fingerprint after re-reading approval/marker and `--emit-fingerprint`. Parentless candidate/missing Project artifacts = drift-candidate/fallback. Stale/mismatched/unapproved/unresolved Issue context cannot yield ready.
4. Run targeted checks appropriate to the diff. Record unavailable checks in `Not checked`; local tests prove no uninspected manual/browser/mobile/prod/deploy/user-acceptance surface.
5. Run mandatory autoreview:

- Resolve the installed `autoreview` skill/helper's concrete path (for example `~/.codex/skills/autoreview/scripts/autoreview`); absent helper is `blocked`. Record the exact invocation. Never replace this gate with Compound `ce-code-review`, `/review`, panels, self-review or handwritten summaries.
- Dirty tail: run `<autoreview-helper> --mode local` on staged/unstaged/untracked changes first; fix accepted findings, then commit, or leave dirty as `blocked`/`needs-human`. Branch/PR scope: `--mode branch --base <resolved-base-ref>` using actual PR/default base. Already-landed/single-commit scope: `--mode commit --commit <ref>`.
- Apply Classification and Invocation in `references/autoreview-routing.md`; resolve [role:autoreview](references/model-policy.md#roles), pass `--engine claude`, `--model`, `--thinking`. Issue-only deep/risky escalation is drift-candidate/fallback; still run higher-risk review, never ready outside lane.
- Success requires helper exit 0 and `autoreview clean: no accepted/actionable findings reported`. Nonzero with actionable findings is not clean. Verify every finding against code/contracts, reject only unsupported findings with evidence, and apply defensible small fixes at the correct owner boundary. Never auto-apply broad or release-sensitive rewrites, or weaken/delete/rewrite tests to reach green.
- After a review-triggered code change, repeat relevant targeted checks and autoreview. Loop until clean; no arbitrary round cap. Missing helper, undetermined scope, repeated tooling/capacity failure, or a required human decision stops `blocked`/`needs-human`. Never silently dismiss a repeated finding or certify ready while it persists.
- After committed fixes, apply canonical final reclassification, then require clean branch/PR or commit review as appropriate. Local clean alone never certifies committed work.

6. Commit via Compound `ce-commit` or configured repo convention when safe. Otherwise leave the branch state and exact next action explicit.
7. Record the full certificate in a Linear comment/resource with `mono-preflight certificate`. Under dispatch queue the comment using `append #/certificate`; the report field is its sole text copy. Apply worker-contract recovery/lead rules and enumerate all Issue verification lines.

8. Emit the certificate.

Certificate statuses: `ready` (local branch ready for ship), `blocked` (state/validation/auth/tooling missing), `drift-candidate` (possible scope drift), `needs-human` (decision needed). Unconfirmed drift goes to ship's formal decision; clearly outside-package work returns to handoff/atomic repair before PR. Issue-only after ready: freeze only independently shippable fingerprint-matching slice, exclude expansion to separate follow-up Project, otherwise cancel. Set new follow-up lead/Issue assignees to acting user (`lead: "me"`, `assignee: "me"`); preserve existing assignments. Follow lane contract.

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

For `tiny` work, follow the Tiny Output Profile in references/readiness-gates.md.

Human Linear comment/resource shape:

Apply worker-contract Certificate recovery; for needs-human, `Decision needed:` names exact Russian decision/unblock.

Final response: full certificate, git state, boundary, autoreview evidence, drift and next.
