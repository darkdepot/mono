# Issue Template

Use Russian for Linear Issue description.

Required sections:

```markdown
# Прочитать сначала

# Цель PR

# Что сделать

# Покрытие PRD/Spec

# Готовность агента

# Зависимости

# Ключевые контракты

# Текущее поведение

# Желаемое поведение

# Шаги воспроизведения

# Где менять

# Как проверить

# Критерии приемки

# Что не входит

# Связи

# Снимок контекста

# Ревью-гейт
```

Rules:

- Issue is a one-PR execution contract.
- Include `Прочитать сначала` links or chips for Project, PRD, Tech Spec, and relevant repo docs.
- Include Linear chips/entity mentions for Project, PRD, and Tech Spec where available.
- Add PRD and Tech Spec as Linear resources/links when the connector supports it.
- Do not use raw document URLs in the body when Linear chips can represent those entities.
- Include an implementation-critical context snapshot.
- Do not copy PRD or Tech Spec wholesale into the Issue. Pull only the context needed for one PR.
- Map the Issue scope to PRD requirement IDs and Tech Spec surfaces when available.
- `Готовность агента` must say `AFK` or `HITL`. Bare tokens come first so `mono-check` can parse them; each must carry a Russian gloss: `AFK (агент справится без тебя)` or `HITL (нужно твоё участие: <что именно>)`. Use `AFK` only when a zero-context implementation agent can execute without new human judgment. Use `HITL` when product, design, external access, manual QA, or risk acceptance is still required, and name the exact dependency.
- `Зависимости` should identify the parent/source package, `Blocked by`, and whether the Issue can start immediately.
- `Связи` in an issue-only Issue must carry the theme-project line, in one of exactly two forms: `Тематический проект: <точное имя проекта в Linear>` when the work continues the theme of a project — an already completed project counts — or `Тематический проект: нет — <почему>` when it continues none. The name is everything after the first `: ` to the end of the line. The line is plain text: no chip, no link, and no Project relation, so the issue-only lane's own rules are unchanged by it. `Тематический проект:` is a machine, language-independent token like `Project update:` — it is written exactly this way whatever the configured language is, while the value after it is written in the Linear language. Exactly one such line belongs in the section: a second one makes the field malformed, and closeout refuses to guess between them.
- `Ключевые контракты` should name stable behavior, types, config shapes, endpoints, invariants, or domain contracts that matter for implementation. Do not use it as a brittle file-by-file edit script.
- `Текущее поведение`, `Желаемое поведение`, and `Шаги воспроизведения` are required for bug or performance Issues. For other work, keep them only when useful or mark them `Не относится` when a full template is being rendered. If reproduction is not possible yet, say that explicitly and describe the smallest useful feedback loop to build.
- Include concrete validation, acceptance criteria, and non-goals.
- Acceptance criteria should be checkable by another implementation agent without reading the whole discovery conversation.
- Do not attach PRD or Tech Spec docs to the Issue.
- Include validation commands or exact manual checks.
- Include risk classification, whether `mono-review` was required/advisory/skipped, verdict, review evidence or comment link, finding disposition, owner workflow, and next step.
- Split only into vertical slices with dependencies when one PR is truly too large.
- Keep the Issue durable: avoid line numbers, stale-prone edit choreography, and instructions that assume today's internal file layout will survive. File paths belong in read-first context only when they are stable surfaces.
