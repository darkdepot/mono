---
name: mono-idea
description: Use only when the user brings a raw idea; mono-idea owns that route. Accepted pre-ship drift routes to mono-ship, unmistakable one-PR projectless work to mono-issue, and existing-Project handoff or artifact repair to mono-handoff.
---

# Mono Idea

Use this skill to turn a raw idea into a strengthened Linear Project in `Idea`.

`mono-idea` is the intake gate. It is not a planning skill and it never starts delivery.

Issue-only front door: before treating a request as a Project idea, check its shape. When it is unmistakably one-PR, projectless, issue-only work — one independently-acceptable outcome, exactly one PR, no product-surface or scope ambiguity — the correct front door is `mono-issue`. The lane is live only when `issueOnlyLane.enabled: true` and `ownerPrincipal` are configured in that consuming repo; without both, fail closed to Project-first. Intake deliberately leaves the approved Issue non-startable, and `mono-implement` later owns the delivery check plus Issue lifecycle move. Never enable the lane or infer consent on the owner's behalf. `mono-idea` itself stays at Idea and never resolves an entity or a lane; it only names the correct front door. Any ambiguity keeps the default Project-first intake below, where Project creation stays mandatory. On the issue-only route, `mono-idea` does not run the project-first `mono-check idea` gate — there is no Project to check, and `mono-check` is issue-only-aware; the intake front door owns issue-only readiness.

Read first:

Read now — every run of this stage loads all of these:

1. `AGENTS.md`
2. `references/contracts/project.md`
3. `references/questioning.md`
4. `references/human-friendly-output.md`

Read when — load the file only when its condition is true for this run:

- `references/lifecycle.md` — when this run creates or queues a Linear entity, or changes or queues its lifecycle state.
- `skills/mono-check/SKILL.md` — when a `mono-check` verdict has to be run or reported from this stage.

Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.

Workflow:

1. Confirm this runtime can create or update a Linear Project.
2. Inspect only the minimal repo and Linear context needed to ask better idea-shaping questions.
3. Ask 1-3 high-leverage AskQuestion-style questions — only those that shape direction: outcome, boundary, or audience. Resolve everything else yourself and record it as explicit assumptions in the strengthened brief, so the user corrects by reading, not by interrogation.
4. Each question must include answer options, one recommended option, and a short reason for the recommendation.
5. Accept custom user answers when options do not fit.
6. Build a strengthened brief from the raw idea and answers.
7. Apply `references/contracts/project.md` in full to create or update a Project in `Idea`.
8. Recommend `/office-hours` or `/brainstorming` and explain why.
9. Record a short Russian comment on the Linear Project (not just in chat) that includes the chosen discovery route (`/office-hours` или `/brainstorming`) and a one-line reason — so the route survives the chat session and the operator can recover the recommended next step from Linear alone.
10. Run or report `mono-check idea`.
11. Stop immediately.

User-facing narration:

- Keep workflow mechanics backstage. Do not narrate reading this skill, lifecycle rules, templates, or internal Linear constraints unless something is blocked.
- The first visible update should be product-context-first: name the user problem, the product area, and the immediate intake action.
- Mention Linear mechanics only when a durable state changes, approval is needed, or a blocker prevents the required Project mutation.
- Phrase constraints as product safety instead of process compliance: "I am stopping at Idea so we do not accidentally turn a raw direction into delivery scope."
- Do not re-summarize the user's own idea back to them as if it were new information. Strengthen it: clarify the tension, outcome, boundary, and next best discovery route.

Good first update shape:

```text
Понял: это про доверие к Settings loading, не просто про красивые skeletons. Я быстро проверю, нет ли уже такого Project в Linear, задам пару вопросов про границы и зафиксирую только Idea - без PRD, Issue и кода.
```

Hard terminal contract:

- Scope: this terminal contract and the Project-centric final response below govern the Project-first path. When the front-door check above routes unmistakable one-PR issue-only work to `mono-issue`, `mono-idea` completes by naming that front door — no Project is created, and the absence of a Project link is expected, not an incompletion. Any ambiguity stays Project-first, where the rules below are mandatory.
- Project creation or update in Linear status `Idea` is mandatory.
- No Linear Project link or id means `mono-idea` is not complete.
- After the Project is created or updated, stop. Do not continue into discovery, planning, or delivery.
- Final response must be one human message, not a compliance checklist. It must include:
  - Linear Project link.
  - Project status.
  - Strengthened brief summary in product language.
  - Selected next-step recommendation: `/office-hours` or `/brainstorming`.
  - Short reason for that recommendation.
  - Compact boundary statement that no PRD, Tech Spec, Issue, implementation plan, ExecPlan, or code was created.

Final response UX:

- Start with the durable outcome: Project created or updated, Project name, status, and link.
- Give the user a product understanding check they can validate without opening Linear.
- Prefer `/office-hours` when the idea already has a clear product direction but needs taste, scope, and tradeoff shaping.
- Prefer `/brainstorming` when the idea is still broad, ambiguous, or has multiple possible product directions.
- Avoid duplicated "nothing else was created" footers; say it once, naturally.

Example final:

```text
Готово. Создал проект в Linear: [Settings skeleton states cleanup](<url>). Статус: `Idea`.

Я понял задачу так: loading в Settings должен ощущаться как стабильная форма будущей страницы, а не как временная серая заглушка. Scope широкий по разделу, но узкий по состоянию: все Settings pages, только initial page load. Главное качество - без скачка композиции после загрузки: skeleton держит основные размеры, плотность, карточки, таблицы, формы и settings-nav контекст, но не копирует каждый текст, иконку и кнопку.

На этом этапе я остановился ровно на идее: зафиксировал направление, но не заводил PRD, Tech Spec, Issue и не трогал код.

Следующий шаг я бы сделал через `/office-hours`. Тут уже не нужно придумывать фичу с нуля; нужно договориться о вкусе и границах: где skeleton должен повторять структуру, где детализация становится шумом, и какие экраны брать за эталон.
```

Do not include raw gate logs, internal command transcripts, or repeated lifecycle explanations in the final response.

Plan Mode and permission boundary:

- `mono-idea` normally runs outside Plan Mode or in a mutation-capable execution mode.
- Do not rely on Plan Mode for required Linear mutations. Host behavior differs across Codex, Claude Code, and other agents.
- If Plan Mode or permissions block Linear mutation, stop early as `BLOCKED / INCOMPLETE`.
- In that blocked case, do not ask the full question set, do not produce an implementation plan, and do not pretend intake completed.
- Use this blocked wording:

```text
BLOCKED / INCOMPLETE - mono-idea cannot complete because creating/updating a Linear Project in Idea is mandatory, and this runtime/mode did not allow the Linear mutation.

Работа не завершена. Project в Linear не создан.

Уже durable:
- Ничего. Никаких артефактов создано не было.

Следующий unblock:
- Выйди из Plan Mode (или перезапусти /mono-idea в обычном режиме) — я создам Project в статусе Idea.
```

Context inspection guidance:

- Inspect only enough context to identify the product area, avoid duplicate Projects, and ask sharper intake questions.
- Do not perform full implementation discovery.
- Do not map code paths, architecture, tests, or files unless that is the minimum needed to phrase an idea-shaping question.
- If the idea is already implementation-shaped, still create an `Idea` Project first, then recommend the next workflow.

Forbidden during Idea:

- Implementation plan.
- ExecPlan.
- PRD.
- Tech Spec.
- Issue.
- Code changes.
- "Plan implementation".
- Transitioning the Project to Delivery.
- Approving a discovery or implementation plan directly.

Rules:

- Route unmistakably one-PR, projectless issue-only work to the `mono-issue` front door when the consuming repo has enabled the lane (`issueOnlyLane.enabled: true` plus a non-empty `ownerPrincipal`); keep Project-first intake as the working default for everything else and for any ambiguity.
- Do not create PRD, Tech Spec, or Issue during Idea.
- Do not start implementation.
- Do not treat the raw idea as shaped requirements.
- Do not let local docs, gstack artifacts, or chat plans become durable source of truth during Idea.
- Repo skill instructions and local repo docs remain English unless the project config says otherwise.
- Keep Linear-facing output in the project config language; use Russian when no project config is present.
