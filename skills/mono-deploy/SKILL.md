---
name: mono-deploy
description: Use after mono-ship reports green to merge/deploy through the configured deploy workflow, verify delivery, close Linear, and record durable learnings.
---

# Mono Deploy

Use this skill after `mono-ship` has created a deploy-ready PR and recorded a `mono-ship green certificate`.

`mono-deploy` owns merge/deploy delegation, deploy evidence, post-ship Linear closeout, and durable operational learning capture. It must not create the PR, run local branch preflight, or perform initial implementation.

`mono-deploy` is an orchestrator-owned stage, not a worker stage. The worker pack-identity gate applies to `mono-implement`, `mono-preflight`, and `mono-ship`; deploy consumes the accepted green certificate and the orchestrator retires the registry entry in this same session.

Requires `mono-ship green certificate` before any merge or deploy action.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `references/readiness-gates.md`
3. `references/human-friendly-output.md`
4. `templates/deploy-output.md`
5. `templates/project-update.md`

Read when — load the file only when its condition is true for this run:

- `references/install.md` — when the deployed change is a skill-pack delivery that installs or cuts over the pack.
- `references/issue-only-lane.md` — when the resolved seam is `lifecycle_state_entity=issue`, or when a lane closeout decision is in play.
- `skills/mono-ship/SKILL.md` — when the recovered green certificate is missing, superseded, or not `green`.
- `skills/mono-check/SKILL.md` — when `mono-check post-ship` is run or reported from this stage.
- `references/execution-quality.md` — when this run performs live verification against the Issue's acceptance IDs.
- `references/artifact-rules.md` — when this run must decide where a Linear record belongs or which stage owns it.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.

Workflow:

1. `prepare`: fetch the fresh Linear Issue, current marker comment, verified labels, authenticated owner-approval fingerprint, PR, and project config. Resolve the 5-field context seam before package-specific prepare fetches, and run the installer-published resolver with `--emit-fingerprint` against the live Issue body. For `lifecycle_state_entity=project`, fetch the current Project, PRD, and Tech Spec exactly as before. For `lifecycle_state_entity=issue`, require `package_kind=issue-only`, `approval_status=approved-fresh`, a non-empty `behavioral_oracle`, and `risk_class` in `tiny|standard`; form the prepare context from the self-contained Issue and seam, recording Project and PRD/Tech Spec as `n/a`.
2. `prepare`: read the latest `mono-ship green certificate` from Linear comments or resources. If no certificate exists, route to `mono-ship`.
3. `prepare`: verify the PR URL/number and current PR head SHA match the certificate. If the head changed, route back to `mono-ship` for review stabilization.
4. `prepare`: confirm required checks, Greptile/review state, unresolved review threads, and merge state are still compatible with the certificate.
5. `prepare`: consult prior operational learnings with `gstack-learnings-search --type operational --limit 10` when the helper is available; surface anything relevant to merge/deploy (deploy config quirks, merge queue behavior) before delegating. Advisory only.
6. `approve`: read `deployApproval` from `.agents/mono-workflow.config.json` (absent → `"always"`). Apply the policy:
   - `"always"`: require a recorded approval for every deploy. Approval is recorded as a Russian Linear comment on the Issue («Деплой одобрен: <кем/когда>; PR #<n>, head `<sha>`») or given explicitly in the current session. An in-session approval must be recorded as that Linear comment before the `deploy` step runs, so the authorization is always recoverable from Linear by a fresh agent. An approval is valid only when its PR number and head SHA match the current PR head; an approval recorded for a different PR or an older head is stale — treat it as absent. If no valid approval is recorded and none is given in the current session, stop with `needs-human` using the ask shape below.
   - `"risky-only"`: require approval only when the Issue risk class is `standard`, `deep`, or `risky`. For `tiny` risk proceed without asking. If the risk class cannot be determined from the Issue, require approval; never default to `tiny`.
   - `"never"`: proceed without asking; report the policy in the deploy output.
   - If approval is needed but not yet recorded, present the following ask:
     ```text
     Готов деплоить <Issue key>: PR #<n> merge в <target>.
     Что произойдёт: <merge/deploy путь, среда>. Откат: <как откатить>.
     1. Деплоим — рекомендую: ревью и CI зелёные.
     2. Подождать — PR останется готовым, ничего не произойдёт.
     ```
7. `deploy`: delegate merge/deploy to the configured Deploy workflow. Default Zeni/GStack workflow is `gstack land-and-deploy`.
8. `verify`: capture merge SHA, deployment URL/environment, deploy status, and verification evidence from the Deploy workflow.
9. `live-qa`: run the Live QA gate below on the deployed artifact. A user-facing change cannot proceed to closeout without a green live pass or an explicit recorded skip reason; a recorded reason may excuse only a sweep that did not run, never a failed one.
10. `post-ship`: run or report `mono-check post-ship` after deploy evidence is known.
11. `mono-closeout`: update the Linear Issue to `Done` only after verified deploy (or an explicit accepted delivery policy says merge is delivery for this repo) and, for user-facing changes, a green live pass per the Live QA gate (or the gate's explicit recorded not-run skip).
12. `project-update`: publish one project update per deployed Issue and, when this shipment was the project's last, complete the project. Form and text rules live in `templates/project-update.md`; this step owns the order, the reads, and the failure semantics.
    1. Batch order: when one closeout covers several Issues, run the sub-steps below per Issue in Issue-key order. The completion check and the `Completed` transition happen ONCE PER PROJECT the batch touches — before the LAST Issue of that project, and only after every Issue of the batch is `Done`. A batch spanning several projects completes each project its Issues close, each on its own last Issue.
    2. Project of the Issue: an issue-only Issue, or any Issue with no project, ends this step as `n/a` with the reason. Project updates exist only on the Project-first path; an Issue closed without a deploy never reaches this step at all.
    3. Idempotency read: read the project's existing updates. When an update already carries this Issue's chip, publication is skipped as `already posted`, but the completion check and the status transition still run. Idempotency is by EFFECT, not by step: a skipped publication never cancels sub-steps 4 and 5.
    4. Completion rule: read the project's Issues and apply the normative rule in `references/lifecycle.md` (Deploy). Judge by Linear status TYPE, never by status name: `completed`, `canceled`, and `duplicate` do not block completion; every other type — `backlog`, `unstarted`, `started`, `triage`, and anything Linear adds later — blocks it.
    5. Completion transition: when the rule says complete and the project is not already `Completed`, write the `Completed` status and read it back. The final form of the update is allowed ONLY when THIS closeout performed that write and confirmed it by read-back. A project already `Completed` on entry keeps the ordinary form and is not written again. An unconfirmed write keeps the ordinary form and records the failure. A replay that confirms `Completed` for the first time after this Issue's update was already published publishes no second update; the completion reaches the owner through the closeout lines and the orchestrator status instead.
    6. Text: compose the update from `templates/project-update.md` in the SAME pass as the closeout lead «Выкатили: …», so both name one result. The final form is permitted only under the sub-step 5 condition.
    7. Publish the update with health `On track` and read it back.
    8. Record the two closeout lines below in the Issue comment and in the deploy report.
    Any refusal in sub-steps 5-7 is recorded: a refused or unconfirmed publication as `Project update: not posted — <reason>`, a refused or unconfirmed transition as `Project: stays <status> — status write unconfirmed`, each with a ledger entry under orchestration and a line in the next owner status. It never changes the deploy verdict and never blocks closeout. The project is completed by shipment only: a project left with no open Issues by cancellation or by a hand-closed tail is the owner's to complete, and this step neither publishes nor moves anything for it.
13. `learn`: record durable operational discoveries with `gstack-learnings-log` when they would save future time.
14. `retire`: after deploy verification and Linear closeout are complete, synchronously remove the Issue entry from `workers.json` in this orchestrator session before emitting the terminal deploy closeout. This is the retirement event; it requires no worker acknowledgement or intermediate worker status. Keep historical reports and logs, but never leave a deployed worker in the active registry. A blocked, needs-human, failed, or timed-out closeout does not retire the worker.
15. Return the concise report in `templates/deploy-output.md`.

Deploy workflow config:

- Read `workflows.deploy` from `.agents/mono-workflow.config.json` when present.
- Treat missing, placeholder, or `None` Deploy workflow as `blocked`; do not invent a merge/deploy path.
- Do not accept `Land workflow` as a compatibility alias. Projects must migrate to `workflows.deploy`.

Live QA gate:

Deploy closeout for a user-facing change is not complete without a live QA pass on the real deployed artifact. The gate runs after deploy verification and before Linear closeout.

- Precondition — version match: before any sweep, verify the deployed version matches the certified merged SHA (deployment metadata, version endpoint/marker, or Deploy workflow evidence). If the deployed content predates the certified version — wave-1 precedent: prod content predated the certified version during an environment migration — stop, treat delivery as unverified, and resolve the deploy before sweeping.
- Context freshness: immediately before the sweep, re-read the Issue body, marker comment, verified label, and authenticated owner approval, then resolve the seam and emit the live whole-body fingerprint again. For issue-only, the package must still resolve with the same fresh fingerprint and non-empty oracle used at prepare; never reconstruct or infer an oracle from prose outside the resolver.
- Functional smoke — Project-first: Project-first deploy behavior remains unchanged. On the real deployed app with real data, walk the PRD acceptance criteria of the shipped Issue and check the console for errors.
- Functional smoke — issue-only: build the live-QA checklist from the Issue seam and walk every `behavioral_oracle.acceptance_ids` entry in AC1..ACn order, using `behavioral_oracle.verify_steps` as the Issue-authored proof instructions. Record pass/fail evidence for every AC-ID; never substitute nonexistent PRD acceptance criteria or silently drop an ID.
- Oracle drift: if the live resolver reports a broken/stale marker, no longer returns `package_kind=issue-only` plus `approval_status=approved-fresh`, or returns acceptance IDs/verify steps/fingerprint that differ from the prepared package, stop closeout. Oracle drift is a failed live QA gate, never a skipped sweep; the rule that a recorded reason may excuse only a sweep that did not run, never a failed one, applies to the Issue oracle unchanged.
- Design acceptance: compare the live result against the prototype approved at the UX checkpoint and repo design standards; judge autonomously against that approved baseline, never your own taste. For either lane, skip design acceptance when no approved prototype exists; functional smoke alone suffices for live QA and is still mandatory unless an explicit permitted not-run reason is recorded.
- Defect handling — fix-forward: on a live defect, file an immediate hotfix Issue out of queue and dispatch it. Set the assignee of that hotfix Issue to the acting user (`assignee: "me"` on the Linear connector) at creation, so the defect is the owner's the moment it appears in Linear; an Issue that already exists keeps the assignee it has. The new defect Issue does not block the original Issue's `Done`, but the shipped Issue moves to `Done` only after its own live pass is green. The hotfix Issue gets its own live verification when it ships. On every live defect, also consult the shipped Issue's preflight certificate for its autoreview route: a defect shipped by standard-route-reviewed code triggers the standard-route re-tier review per `references/autoreview-routing.md`.
- Flake adjudication: verify on clean state before calling something a defect (fresh session/reload, cleared transient state). A known-flaky failure outside the shipped diff becomes a separate tiny Issue, not a gate failure (wave-1 pattern).
- Non-web and non-user-facing surfaces: the gate's spirit is "verify the delivered artifact live". For a skill-pack repo, `node scripts/install-local.mjs --check` green against the delivered version counts as the live pass. Map other surfaces the same way: exercise the delivered artifact where its consumers use it.
- Install-source verification (skill-pack delivery): before running `install-local` as a deploy step, the installing checkout's HEAD must equal the expected merge SHA — compare `git rev-parse HEAD` against the PR's merge commit obtained from the merge record via `gh` — never from the local checkout, which would make the guard tautological. A mismatch is a DEPLOY BLOCKER, not a warning: resolve the checkout state first, then install (the MONO-3 precedent causes were a silently failed `git pull --ff-only` with its output swallowed, and a foreign commit on local main; the pack briefly installed from the wrong source and was caught only via a version anomaly). Install with the guarded one-liner pattern from `references/install.md` (verify SHA → install → `--check`); never install from an unverified checkout.
- Instrument and auth: use the `workflows.qa` instrument from `.agents/mono-workflow.config.json` when configured; `null` or absent means use whatever browser automation the runtime provides. Authenticate per `qaAuth` (`cookie-import` | `test-account` | `owner-session`); `owner-session` involves the owner and must be asked for, never assumed.
- Skipping the gate requires an explicit recorded reason in the deploy closeout (for example: no user-facing surface changed); a silent skip is a contract violation. A failed sweep can never be converted into a skip; failures follow the defect path above.

Learning capture:

- Use the gstack operational learning pattern, not interactive `/learn`.
- Record only durable discoveries such as deploy config quirks, merge queue behavior, branch cleanup pitfalls, review-loop facts, or repo-specific verification commands.
- Do not run `/learn prune`, `/learn export`, `/learn stats`, or any interactive learning-management command automatically.
- Include `Learnings recorded: <none|keys>` in the deploy report and Linear closeout comment.
- Consult before writing: prior learnings are read in `prepare`; record only discoveries that are new relative to what was consulted.

Deploy closeout shape:

When recording this closeout as a Linear comment, open with the Russian human lead above the machine block. The first Russian sentence must state the shipped product outcome and verification environment. Post the comment once, after `project-update` has produced its two lines, so it is written complete instead of patched afterwards:

```text
Выкатили: <что получили пользователи>; проверено на <среда>.
<опционально: одно дополнительное предложение — итог или следующий шаг>

mono-deploy closeout
Deploy: <deployed|blocked|needs-human|timed-out>
Issue(s): <keys>
PR: <number/url>
Reviewed head SHA: <sha from mono-ship green certificate>
Merged SHA: <sha or none>
Deploy workflow: <name>
Deploy target: <url/environment or none>
Deploy verification: <passed/failed/unavailable + evidence>
Live QA: <passed/failed/skipped + evidence or recorded skip reason>
Post-ship check: <PASS/FAIL/BLOCKED + meaning>
Linear closeout: <Done/not done + reason>
Project update: <posted <url> | already posted <url> | not posted — <reason> | n/a — <reason>>
Project: <Completed | stays <status>, open <N> | stays <status> — <reason> | n/a>
Learnings recorded: <none/list>
Learnings consulted: <none/keys/helper unavailable>
Checked: <states inspected>
Not checked: <manual/browser/mobile/prod surfaces not inspected>
```

The Russian product-outcome lead is required in Linear; the machine core below the marker is never translated or summarized away.

Verdicts:

- `deployed`: deploy workflow completed, delivery evidence was captured, post-ship check ran or was reported, and Linear closeout completed.
- `needs-human`: explicit deploy approval, product/risk acceptance, external access, or delivery policy decision is required.
- `blocked`: required config, tools, auth, certificate, PR state, deploy target, or Linear context is unavailable.
- `timed-out`: merge, deploy, or deploy verification did not settle within the configured wait.

For `tiny` work, follow the Tiny Output Profile in references/readiness-gates.md.

Rules:

- Do not create or update the PR except through the configured Deploy workflow.
- Do not merge or deploy without a current `mono-ship green certificate`.
- Do not deploy if the current PR head SHA differs from the certificate head SHA.
- Do not run repo documentation workflow here; repo documentation must happen in `mono-ship` before final green certification.
- Do not close Linear as `Done` before deploy evidence exists, unless the project policy explicitly says merge is delivery and that acceptance is recorded.
- Do not close an Issue as `Done` with a failed or skipped live pass on a user-facing change; a skip requires an explicit recorded reason in the deploy closeout.
- Do not use Project Updates as a required gate; record closeout in Linear comments/resources and status.
- Project Updates stay informational here: `project-update` is a STEP of this stage, never a gate of it. `mono-deploy` publishes the update as a result of closeout, and a failed update or a failed project transition is recorded, visible, and verdict-neutral.
- Do not let the `project-update` step change a deploy verdict, block `mono-closeout`, or become a requirement of any readiness check.
- Do not move a project to `Completed` outside this step, and do not move one whose last open Issue was cancelled or closed by hand rather than shipped.
- Do not report deploy closeout complete until the retired Issue entry has been removed from `workers.json`; the orchestrator owns this mutation.
- Keep Linear-facing comments in the project config language; use Russian when no project config is present.
- Include checked/not-checked boundaries. Deploy success does not imply manual browser QA, mobile QA, or production smoke unless those actually ran.

Final response must include:

- Deploy verdict.
- PR URL, reviewed head SHA, and merged SHA when present.
- Deploy workflow and target.
- Verification evidence.
- Live QA result (or the recorded skip reason).
- Linear closeout outcome.
- Project update outcome and project completion outcome.
- Learnings recorded.
- Checked and not-checked boundary.
