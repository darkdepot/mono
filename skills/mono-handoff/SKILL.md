---
name: mono-handoff
description: Use for an existing Project or shaped discovery to create the Project-first package, or for targeted PRD or Tech Spec repair. Raw ideas route to mono-idea, unmistakable one-PR projectless work to mono-issue, and pre-ship drift to mono-ship.
---

# Mono Handoff

Use this skill after discovery and reviews to turn shaped work into a Linear-backed execution package.

`mono-handoff` is the primary bridge from thinking to execution. It packages discovery output into Linear source-of-truth artifacts, gets user approval, creates Issue contracts, and only then hands off to implementation.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `references/contracts/project.md`
3. `references/contracts/prd.md`
4. `references/contracts/tech-spec.md`
5. `references/artifact-rules.md`
6. `references/artifact-intake.md`
7. `references/human-friendly-output.md`

Read when — load the file only when its condition is true for this run:

- `references/artifact-quality.md` — when artifact text has to be written or judged against the quality bar.
- `references/questioning.md` — when a discovery gap or an Always-ask decision has to be put to the owner.
- `references/readiness-gates.md` — when the risk class or a readiness gate for this package has to be decided.
- `references/lifecycle.md` — when a Linear lifecycle move or a lifecycle boundary is in play.
- `references/repair-machine.md` — when the run is a targeted artifact repair rather than a fresh package.
- `skills/mono-issue/SKILL.md` — when execution Issues are created or renewed from this stage.
- `skills/mono-review/SKILL.md` — when a `mono-review` report has to be run or judged from this stage.
- `skills/mono-check/SKILL.md` — when a `mono-check` verdict has to be run or reported from this stage.
- `references/execution-quality.md` — when the package has to be judged against implementation or verification evidence.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.

When to use:

- After `/office-hours` or `/brainstorming`.
- After `/plan-design-review` or `/plan-eng-review`.
- When a discovery or review session produced an implementation plan and the user wants to proceed through Linear.
- When shaped context exists but Linear Project, PRD, Tech Spec, and Issues are not yet current.
- When an existing Project-first PRD or Tech Spec needs targeted repair before pre-ship.

Inputs to gather:

- Linear Project link or id from `mono-idea`.
- Current conversation discovery decisions.
- Relevant `/office-hours`, `/brainstorming`, `/plan-design-review`, and `/plan-eng-review` outputs.
- Existing Linear Project, PRD, Tech Spec, and Issues.
- Latest `mono-review` report when one already exists.
- Minimal repo context needed to verify scope, interfaces, and validation.
- Artifact intake summary following `references/artifact-intake.md`.
- For repair mode: the current and proposed artifact versions, stable-ID diff,
  affected Issue snapshots, active worker dispatch fingerprints, and latest
  preflight certificates.

Quality bar:

- Use the strongest upstream artifact shape available:
  - Superpowers-style route discipline: shaping must produce an approved spec before implementation planning.
  - gstack-style premise and alternatives discipline: important choices are surfaced to the user before they land in durable artifacts.
  - Compound-style WHAT/HOW split: PRD answers WHAT, Tech Spec answers HOW, Issue answers one-PR execution.
- Handoff should make the next agent invent less, not more.
- Prefer fewer, stronger artifacts over verbose workflow transcripts.
- Do not rely on lint scripts to make artifacts good. The skill must produce clean artifacts by construction.

User-facing handoff UX:

- Assume the user already knows the idea. Do not re-explain discovery back to them unless the package changes the interpretation.
- Be confident and artifact-oriented: show how approved discovery maps into Project, PRD, Tech Spec, and Issue(s).
- Put Project first, then documents, then Issue(s). The Issue is execution detail, not the primary container of the work.
- Explain each artifact by job: Project is the product brief and lifecycle container, PRD is WHAT, Tech Spec is HOW, Issue is the first one-PR execution slice.
- Say clearly whether anything has been written to Linear yet. Draft approval and completion have different tones.
- Keep capability caveats small and decision-relevant. Do not center the response on connector limitations unless they block the next step.

Draft package approval UX:

- The pre-write approval screen must be a package map, not an idea recap.
- It must include:
  - "Nothing written yet" or the exact mutation boundary.
  - Project brief shape.
  - PRD product decisions.
  - PRD actor -> capability -> benefit coverage and behavior-validation intent.
  - Tech Spec implementation decisions.
  - «Решил сам:» — non-contested product choices the agent took itself, each with a one-line reason; overriding any of them is a valid approval answer.
  - Issue slicing, `AFK`/`HITL` readiness, dependencies, and why this split is right.
  - Review gate, risk, and validation plan.
  - Decision options — every option must say which approval(s) it grants.
- If there is one recommended path, name it plainly.

Draft package example:

```text
Готов handoff draft. В Linear пока ничего не записывал.

Я разложил approved discovery в пакет так:

Project
Короткий product brief: привести Settings initial loading к structural skeletons. Без workflow-шума, без списков документов и без статуса реализации в body.

PRD
Фиксирует продуктовые правила: все Settings pages, только initial page load, skeleton structural-not-literal, route-known chrome остается стабильным, mobile/a11y не ломаются, background refresh и redesign не входят.

Tech Spec
Фиксирует реализацию: небольшой Settings skeleton kit в `src/components/settings`, route-family mapping для form/table/list/detail/logs pages, reuse текущих `Skeleton`, `Card`, `SettingsShell`, `SettingsSectionNav` и logs skeleton direction.

Issue
Один PR: `Привести initial skeleton состояний Settings к structural kit`.
Я бы не дробил это на несколько issues: изменение широкое по routes, но цель одна. Если резать по страницам, выше риск получить разный skeleton language в одном разделе.

Решил сам:
- Skeleton повторяет структуру, но не копирует каждую кнопку — иначе шум.
- Logs-страницы получают табличный skeleton, как у таблиц, а не спиннер.
Если что-то из этого не так - скажи, поправлю до записи в Linear.

Review gate
Risk: `standard`, потому что touched surface широкий: много Settings routes и визуальное качество. Перед Issue будет handoff review; перед PR нужен pre-ship review.

Validation
Static: `pnpm typecheck`, lint/targeted tests по факту diff.
Visual: desktop/mobile smoke на representative routes: general, profile, integrations, provider detail, import detail, accounts, counterparties, logs.

Что делаем?
1. Зафиксировать пакет в Linear и остановиться перед кодом. Рекомендую, если хочешь сначала увидеть durable PRD/Spec/Issue.
2. Зафиксировать пакет и сразу начать реализацию — это одновременно approval на старт кода (Project уйдёт в Delivery, появится ветка).
3. Поправить пакет перед записью.
```

Plan Mode behavior:

- If invoked in Plan Mode, produce a new exit plan for Linear handoff only.
- Treat the current or previous discovery/review plan as input context.
- Do not mutate Linear.
- Do not create PRD, Tech Spec, or Issue yet.
- Do not change code, create branches, create PRs, or start implementation.
- Frame the exit plan positively as the next workflow step: turn discovery into Linear-backed delivery.
- The exit plan must make clear that approval starts Linear handoff, not code implementation.

Plan Mode exit-plan shape:

```text
Plan: turn discovery into a Linear-backed execution package

1. Gather discovery and review context from this session and available artifacts.
2. Prepare the Linear Project update as a concise product brief.
3. Prepare the PRD from product and workflow decisions.
4. Prepare the Tech Spec from engineering and design review decisions.
5. Classify risk and identify whether `mono-review handoff` is required or advisory.
6. Present the Linear handoff package and review-gate plan for approval before durable writes.
7. After approval, update Linear artifacts, run or report `mono-review handoff`, apply accepted artifact fixes through `mono-handoff`, and create Linear Issue(s) as execution contracts.
8. Return the approved Issue link(s) and stop unless the user explicitly approved starting implementation.
9. If implementation start is approved, route to `mono-implement` as the Delivery Start owner.

No code changes happen during handoff.
```

Repair-mode workflow:

1. Apply routing precedence from `references/repair-machine.md`. Do not use repair mode for accepted pre-ship drift or an issue-only body edit; those
   belong to `mono-ship` and `mono-issue` renewal respectively.
2. Fetch the fresh Project-first package, approvals, affected Issue snapshots,
   active worker dispatches, and latest preflight certificates.
3. Produce the exact stable-ID before/after preview and proposed class with
   evidence. The highest matching class wins; ambiguity and risk growth are
   class 3.
4. Run `mono-review artifact` report-only on the proposed repair class. Apply no
   mutation while a blocking classification finding remains.
5. Apply the class transaction exactly as defined in
   `references/repair-machine.md`: class 1 preserves approvals and Issues;
   class 2 stops or quiesces every affected active worker before any repair
   mutation, then synchronizes snapshots and fingerprints and stales earlier
   preflight certificates; class 3 stops workers,
   supersedes approvals, invalidates dependants, and rolls Delivery back to
   Discovery for owner re-approval.
6. Run or report `mono-check repair` against every required effect and leave a
   durable repair record with the diff, class, evidence, old/new fingerprints,
   certificate disposition, worker disposition, and lifecycle result.

Execution-mode workflow:

1. Fetch fresh Linear Project, PRD, Tech Spec, and Issue state.
2. Gather discovery and review artifacts using `references/artifact-intake.md`.
   - Inspect explicit user-provided artifact paths and Linear resources first.
   - Inspect fresh Linear Project, PRD, Tech Spec, Issues, comments, and review reports.
   - Inspect current conversation decisions.
   - Inspect configured project artifact roots when present.
   - Inspect local gstack artifacts only when scoped by project slug, branch/session, or explicit filename match.
   - Do not perform broad home-directory scans.
   - Produce `read`, `unavailable`, `stale_or_ignored`, `conflicts`, `decisions_carried_forward`, and `confidence_boundary`.
3. Synthesize a draft handoff package before mutating durable Linear artifacts:
   - Artifact intake summary and confidence boundary.
   - Project summary as a concise product brief.
   - PRD as product truth with requirement IDs and acceptance examples when useful.
   - PRD coverage check for actor, capability, benefit, and behavior-validation intent.
   - Tech Spec as implementation truth that traces HOW decisions back to PRD requirements.
   - Proposed Issue slicing with one-PR default, `AFK`/`HITL` readiness, and explicit dependencies if split.
   - Risk classification and whether the review gate is required, advisory, skipped, or blocked.
   - Remaining assumptions, if any, that the user should see before Issue creation.
4. Run a content-shape review on the package:
   - Project reads like a product brief, not a dashboard.
   - PRD contains WHAT and acceptance, not implementation architecture.
   - PRD requirements and scenarios have clear actor, capability, and benefit coverage.
   - Tech Spec contains HOW and validation, not product rediscovery.
   - Issue slices are durable execution contracts, not copied PRD/Spec documents or brittle edit scripts.
   - Bug and performance Issues carry a reproduction or feedback-loop expectation.
   - Operational status, lifecycle gates, and workflow mechanics are absent from Linear-facing bodies.
5. Present the draft package summary to the user for package approval before durable writes.
6. If approval is missing, rejected, or changes are requested, do not create Issue(s), do not move the Project to Delivery, revise and re-present or stop as `BLOCKED / INCOMPLETE` with current links.
7. After package approval, create or update PRD and Tech Spec in Linear.
8. Update the Project body with only the product brief concerns: what, why, target outcome, in scope, and out of scope. Render headings in the project config language; default Russian headings are `Что`, `Зачем`, `Образ результата`, `Что входит`, and `Что не входит`.
9. Record approval as a Linear comment. The comment should identify the approved package, PRD/Tech Spec links or intended titles, approved Issue slice titles or ids, and whether implementation may start.
10. Run or report `mono-review handoff` when the gate is required or advisory.
11. Present review verdict, blocking findings, proposed fixes, and decisions to the user before Issue creation.
12. Record accepted review fixes, explicit deferrals, and final approval as a Linear comment.
13. Apply accepted Project, PRD, Tech Spec, or Issue-plan fixes through `mono-handoff`.
14. Create or update Linear Issue(s) from the approved package.
15. Run or report `mono-check handoff` and `mono-check issue`.
16. If the user explicitly approved implementation start, route to `mono-implement`. `mono-implement` owns Project-to-Delivery movement, `mono-check delivery`, the implementation-start comment, and implementation execution.
17. If implementation start is not approved, stop after handoff and return the approved Issue link(s).

Rules:

- Resolve non-contested product micro-choices yourself and surface them under «Решил сам:»; ask only per the Always-ask list in references/questioning.md (scope boundaries, issue slicing, risk acceptance, design decisions).
- Design and visual decisions follow references/questioning.md: prepare /design-html variants when available; the user controls design.
- Keep durable workflow truth in Linear.
- Treat local and gstack artifacts as discovery inputs, not durable source of truth.
- Follow `references/artifact-intake.md`; do not scan broadly or guess which local scratch file is authoritative.
- Do not approve or implement a raw discovery/review plan directly.
- Do not start code implementation until Linear Issue(s) exist and are approved as execution contracts.
- Do not treat package approval as implementation-start approval unless the user explicitly approved starting implementation from the created Issue(s).
- Do not move the Project to Delivery from `mono-handoff`; route explicit implementation-start approval to `mono-implement`.
- Do not treat PRD or Tech Spec creation as Delivery.
- Keep Project descriptions free of active-doc lists, active-issue lists, lifecycle bookkeeping, and workflow mechanics.
- Keep PRD/Spec bodies free of review-readiness dashboards, next-skill instructions, lint/check instructions, and lifecycle bookkeeping.
- Do not create PRs directly; implementation and branch readiness must pass through `mono-implement` and `mono-preflight` before the configured ship workflow.
- Keep Linear-facing Project, PRD, Tech Spec, Issue descriptions, and comments in the project config language; use Russian when no project config is present.
- Keep repo skill instructions and docs in English.
- Use Linear comments for user review acceptance, not Project Updates.
- Split Issues only when one PR is truly too large; split into vertical slices with explicit dependencies.
- Mark every execution Issue as `AFK` or `HITL` and name dependencies or blockers.
- If a source artifact is a local plan or review report, translate it into PRD/Spec/Issue shape. Do not paste the local artifact body into Linear unchanged.
- `mono-review` is report-only. Do not ask it to apply fixes or create artifacts.
- Required `mono-review handoff` findings must be resolved, accepted, or explicitly deferred before creating Issues.
- Advisory tiny-scope review may be skipped only when the reason is recorded in the Project and Issue review-gate fields.
- Apply accepted review fixes in `mono-handoff`; then run `mono-check` to report readiness.
- Follow `references/repair-machine.md` for Project-first artifact repair. Never
  downgrade an ambiguous diff, skip a class 2 effect, or keep Delivery active
  during a class 3 rollback.

Final response after an approved package must include:

- Outcome sentence: handoff is fixed in Linear and whether code was touched.
- Clickable artifact map, ordered Project -> PRD -> Tech Spec -> Issue(s).
- Artifact intake, one Russian sentence: what fed the package, what was unavailable or conflicting, where confidence is low (e.g. «Читал: discovery-план и PRD; не нашёл: заметки office-hours; конфликтов нет»). The structured intake record (`read`, `unavailable`, `stale_or_ignored`, `conflicts`, `decisions_carried_forward`, `confidence_boundary`) is recorded in the package-approval Linear comment, not the chat final.
- Project status.
- One-line role for each artifact:
  - Project: top-level product brief and lifecycle container.
  - PRD: WHAT decisions and boundaries.
  - Tech Spec: HOW, mapping, validation, rollout or rollback.
  - Issue(s): execution slice(s), usually one PR unless split is necessary.
- Review verdict, risk classification, and whether the review gate was required or advisory.
- Clear statement whether the user needs to run `mono-review` again. If handoff review and checks already passed and artifacts did not change afterward, say repeat review is not needed until implementation or pre-ship.
- Compact "checked / not checked" boundary when review, validation, manual QA, browser checks, or implementation did not run.
- Next-step options with a recommendation.
- Offer fresh-agent handoff as a first-class option when the current session is long, the user raised context-quality concerns, or implementation is about to start after substantial discovery.
- If implementation start was approved, state that `mono-implement` owns Delivery Start and will run next.

Completion example:

```text
Готово. Handoff зафиксирован в Linear, код не трогал.

Пакет:
- Project: [Settings skeleton states cleanup](<url>) - статус `Discovery`; верхний контейнер работы и короткий product brief.
- PRD: [Settings structural skeletons](<url>) - WHAT: какие Settings loading states покрываем, что значит structural-not-literal, где границы.
- Tech Spec: [Settings structural skeletons](<url>) - HOW: skeleton kit, route-family mapping, validation, rollout/rollback.
- Issue: [ZENI-6](<url>) - первый execution slice; сейчас это один PR.

Пакет уже проверен: `mono-review handoff` и `mono-check` прошли, блокеров нет. Повторно запускать `mono-review` сейчас не нужно. Следующий review нужен перед PR/ship, после реализации.

Проверено:
- Linear Project/PRD/Tech Spec/Issue package shape.
- Handoff review/check gate.

Не проверено:
- Код и UI: реализация еще не начиналась.

Безопасные пути дальше:

1. **Начать реализацию здесь** - рекомендую, если остаемся в этой сессии.
   Я сначала сделаю implementation-start checkpoint: перечитаю Project/PRD/Tech Spec/Issue, проверю git status/branch и только потом начну код.

2. **Подготовить handoff prompt для свежего агента** - лучший вариант, если не хочешь тащить длинный чат в реализацию.
   Я соберу короткий prompt с Linear links, scope, validation и запретом на rediscovery.

3. **Запустить subagent-driven flow** - подходит, если работу можно безопасно разрезать.
   Для визуальных задач чаще выбирай один implementer + reviewer agents, чтобы не потерять единый стиль.

4. **Еще обсудить пакет** - если хочешь поменять split, validation или scope до старта кода.
```

If implementation start was explicitly approved, the final response may replace the next-step options with the implementation-start checkpoint and the workflow that will run next.

If handoff is `BLOCKED / INCOMPLETE`, include the current Project/PRD/Tech Spec links that exist, the missing approval or inspection step, and a clear statement that no Issue creation or implementation handoff happened.
