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

1. `prepare`: fetch current Issue, marker, verified labels, authenticated owner fingerprint, PR and config. Resolve five-field seam and emit live whole-body fingerprint before package-specific fetches. Project lane fetches Project/PRD/Spec; issue lane requires issue-only/approved-fresh, non-empty oracle and tiny|standard risk, with Project/docs `n/a`.
2. `prepare`: recover latest green certificate from comments/resources; absent/superseded/non-green routes to ship. Require matching PR number/URL/current head; changed head routes back to stabilization. Confirm checks/Greptile/reviews/threads/merge remain certificate-compatible.
3. `prepare`: consult `gstack-learnings-search --type operational --limit 10` if available; surface relevant deploy/queue quirks before delegation. Advisory only, record unavailable/none.
4. `approve`: apply `deployApproval` (absent = `always`). `always` requires explicit approval bound to current PR/head; record in-session approval as a Russian Issue comment before deploy. Wrong PR/old head is stale. `risky-only` requires approval for standard/deep/risky or unknown risk; only tiny proceeds without it. `never` proceeds without asking and is reported. When needed, stop `needs-human` and present:

```text
Готов деплоить <Issue key>: PR #<n> merge в <target>.
Что произойдёт: <merge/deploy путь, среда>. Откат: <как откатить>.
1. Деплоим — рекомендую: ревью и CI зелёные.
2. Подождать — PR останется готовым, ничего не произойдёт.
```

Record approval as `Деплой одобрен: <кем/когда>; PR #<n>, head <sha>`.

5. `deploy`: delegate the Deploy workflow (configured, e.g. `gstack land-and-deploy`). Never invent a path or merge/deploy without current green certificate/head match.
6. `verify`: capture merged SHA, target URL/environment, deploy status/evidence.
7. `live-qa`: execute the Live QA gate below after deploy verification and before closeout.
8. `post-ship`: run/report `mono-check post-ship` after evidence exists.
9. `mono-closeout`: set Issue Done only after verified deploy (or recorded policy accepting merge as delivery), plus green live QA for user-facing changes or explicit permitted not-run reason. Failed live QA is never excused as skipped.
10. `project-update`: execute the update procedure below.
11. `cost`: run installed `../.mono-agent-workflow/scripts/wave-cost.mjs <ISSUE-KEY>` from this skill directory after closeout evidence. Copy exact final Russian line into closeout/report `Cost:`. Unmeasurable script/component = `unavailable: <reason>`; telemetry never blocks/delays closeout.
12. `learn`: record new durable operational discoveries via `gstack-learnings-log`.
13. `retire`: after verified delivery and Linear closeout, synchronously remove Issue from `workers.json` in this orchestrator session before terminal closeout. No worker ack/intermediate status; keep reports/logs. Never retire blocked/needs-human/failed/timed-out work or leave a deployed worker active.
14. Return `templates/deploy-output.md`.

Project-update procedure:

- Publish one update per deployed Issue. It is informational, never a gate or deploy-verdict input. Run batches in Issue-key order. Check/transition each Project once, before its last batch Issue, only after every batch Issue is Done.
- Project-first uses Issue's Project. For issue-only/parentless, read exactly one `Тематический проект:` line and resolve exact name among unarchived configured-team Projects. Duplicate lines are malformed without lookup. One match proceeds only through idempotency/text/publication/reporting, never Project completion/status; even an already-Completed theme receives ordinary form. Zero/multiple/malformed = `Project update: not posted — тематический проект «<имя>» не найден / неоднозначен` (quote ambiguous field text). Absent legacy line = `Project update: n/a — тематический проект в Issue не назван`; explicit нет = `Project update: n/a — тематический проект: нет (<причина из Issue>)`. `Project:` is `n/a — тематический проект «<имя>», статус не меняется` or `n/a — тематического проекта нет`.
- Read existing updates: matching Issue chip means `already posted`, no duplicate. On Project-first still perform completion check/transition; theme path never does.
- Completion uses current Project Issues and status TYPE under `references/lifecycle.md` (Deploy): only completed/canceled/duplicate are non-blocking; every other/unknown type blocks. Only this shipment of the last open Issue can complete Project, never cancellation/hand-close or issue-only theme shipment.
- If complete and not already Completed, write/read back Completed. Use final update form only when this closeout performed and confirmed that transition. Already-Completed/unconfirmed writes use ordinary form, no redundant status write. If replay confirms completion after update already exists, publish no second update; report completion through closeout/owner status.
- Compose `templates/project-update.md` «Выкладка» (never orchestrator «Состояние») in the same pass as «Выкатили: …» lead, naming one result; use final prefix only under confirmed-transition condition. This is the single update form for all writers, with its stricter stop dictionary.
- Publish `On track`, read back, record Project update/Project lines in Issue closeout and deploy report. Refused/unconfirmed publication = `not posted — <reason>`; refused/unconfirmed transition = `stays <status> — status write unconfirmed`. Record each failure or theme n/a in ledger under orchestration and next owner status in product language. Never change deploy verdict/block closeout; no update/status move for a non-deploy hand-closed tail.

Deploy workflow config:

Read `workflows.deploy` from `.agents/mono-workflow.config.json`. Missing/placeholder/None is blocked; `Land workflow` is not an alias. Never create/update PR outside configured Deploy workflow or run repo documentation here; ship owns docs-before-green.

Live QA gate:

- Before sweep verify deployed version matches certified merged SHA via metadata/version marker/workflow evidence. Older content means unverified delivery: stop and resolve deploy before testing.
- Immediately before sweep re-read Issue/marker/verified label/authenticated approval, resolve seam and emit whole-body fingerprint. Issue-only must retain prepare's approved-fresh package, fingerprint and non-empty oracle; never infer oracle outside resolver.
- On actual deployed app with real data walk shipped Issue's PRD acceptance and inspect console errors. Issue-only instead walks every oracle `acceptance_ids` AC1..ACn using `verify_steps`, recording pass/fail per ID; no missing IDs/nonexistent PRD substitutes.
- Broken/stale marker, lost issue-only/approved-fresh, or changed oracle IDs/steps/fingerprint fails live QA and stops closeout; never label drift skipped.
- Compare live design to approved UX-checkpoint prototype and repo standards, not personal taste. Without approved prototype skip design acceptance only; functional smoke remains required unless explicit permitted not-run reason.
- On defect file/dispatch immediate out-of-queue hotfix Issue with acting-user `assignee: "me"` at creation; preserve existing assignments. Hotfix doesn't itself block original Done, but original still needs its own green live pass; hotfix gets live QA on shipment. Consult original preflight route: standard-reviewed defect triggers standard re-tier review under `references/autoreview-routing.md`.
- Confirm on clean session/reload/transient state before classifying defect. Known flaky failure outside diff becomes separate tiny Issue, not gate failure.
- Verify non-web artifacts where consumers use them; skill-pack live pass is `node scripts/install-local.mjs --check` against delivered version. Before installation require installing checkout `git rev-parse HEAD` equal expected merge SHA from PR merge record via `gh`, never locally-derived expectation. Mismatch is DEPLOY BLOCKER. Use guarded SHA→install→check pattern in `references/install.md`.
- Use configured `workflows.qa` or available browser automation when absent/null. Authenticate per `qaAuth` (`cookie-import`, `test-account`, `owner-session`); ask for owner-session, never assume it.
- Record any not-run skip reason in closeout (e.g. no user-facing surface). Silent skip violates contract; failed sweep follows defect path, never converts to skip.

Learning capture:

Consult before recording; write only new durable deploy/queue/branch-cleanup/review/verification discoveries. Use operational `gstack-learnings-log`, never interactive `/learn` or automatic prune/export/stats. Record `Learnings recorded: <none|keys>` in report/Linear closeout.

Deploy closeout shape:

When recording this closeout as a Linear comment, open with the Russian human lead above the machine block. The first Russian sentence must state the shipped product outcome and verification environment. Post the comment once, after `project-update` and `cost` have produced their lines, so it is written complete instead of patched afterwards:

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
Project: <Completed | stays <status>, open <N> | stays <status> — <reason> | n/a — <reason>>
Cost: <exact Russian line from wave-cost.mjs | unavailable: <reason>>
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

Keep Linear comments in configured language, Russian by default. Include full checked/not-checked boundaries; deploy success never implies unrun browser/mobile/prod checks. Updates and cost stay verdict-neutral. Do not report complete closeout before registry retirement.

Final response includes verdict, PR/reviewed head/merged SHA, workflow/target, verification/live QA or skip, Linear closeout, Project update/completion, exact cost line/unavailable reason, learnings and boundary.
