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
- Include `Прочитать сначала` links or chips for Project, PRD, Tech Spec when it exists, and relevant repo docs; for a package-record package also Research and the package record (a link to its comment). A legacy package keeps its approved set and previous tracing.
- Include Linear chips/entity mentions for Project, PRD, and Tech Spec where available.
- Add PRD and Tech Spec as Linear resources/links when the connector supports it.
- Do not use raw document URLs in the body when Linear chips can represent those entities.
- Include an implementation-critical context snapshot.
- For UI work, Read first includes a design line: exact mono-design record id,
  Paper link and images hash, or no mockup; plus owner-taste, product-memory and
  immutable PNG-version paths under `~/.mono-agent-workflow/design/`. Copy
  applicable owner/product taste rules as text into `Снимок контекста` (including
  reason, correct/incorrect examples, source and weight), even without mockups or
  a Project. Explicitly say when no rules exist; unavailable existing rules block
  preparation. Dispatch delivers approved PNGs in the task snapshot, outside the
  worktree, without a commit; a worker reads those copies and the textual rules.
- Do not copy PRD or Tech Spec wholesale into the Issue. Pull only the context needed for one PR.
- Map the Issue scope to PRD requirement IDs and package-record or Tech Spec `U` units when available.
- `Готовность агента` must say `AFK` or `HITL`. Bare tokens come first so `mono:check` can parse them; each must carry a Russian gloss: `AFK (агент справится без тебя)` or `HITL (нужно твоё участие: <что именно>)`. Use `AFK` only when a zero-context implementation agent can execute without new human judgment. Use `HITL` when product, design, external access, manual QA, or risk acceptance is still required, and name the exact dependency.
- `Зависимости` should identify the parent/source package, `Blocked by`, and whether the Issue can start immediately.
- `Связи` in an issue-only Issue must carry the theme-project line, in one of exactly two forms: `Тематический проект: <точное имя проекта в Linear>` when the work continues the theme of a project — an already completed project counts — or `Тематический проект: нет — <почему>` when it continues none. The name is everything after the first `: ` to the end of the line. The line is plain text: no chip, no link, and no Project relation, so the issue-only lane's own rules are unchanged by it. `Тематический проект:` is a machine, language-independent token like `Project update:` — it is written exactly this way whatever the configured language is, while the value after it is written in the Linear language. Exactly one such line belongs in the section: a second one makes the field malformed, and closeout refuses to guess between them.
- `Ключевые контракты` should name stable behavior, types, config shapes, endpoints, invariants, or domain contracts that matter for implementation. Do not use it as a brittle file-by-file edit script.
- `Текущее поведение`, `Желаемое поведение`, and `Шаги воспроизведения` are required for bug or performance Issues. For other work, keep them only when useful or mark them `Не относится` when a full template is being rendered. If reproduction is not possible yet, say that explicitly and describe the smallest useful feedback loop to build.
- Include concrete validation, acceptance criteria starting `Готово, когда:`, and non-goals.
- Acceptance criteria should be checkable by another implementation agent without reading the whole discovery conversation.
- Do not attach PRD or Tech Spec docs to the Issue.
- Include validation commands or exact manual checks.
- Include risk classification, whether `mono:review` was required/advisory/skipped, verdict, review evidence or comment link, finding disposition, owner workflow, and next step.
- Only Handoff splits, by verifiable behavior and one recorded reason per extra Issue (`too-big`, `shared-base`, `probe`); at most three without the owner. `Зависимости` names that reason; Issues touching the same surfaces are chained.
- Keep the Issue durable: avoid line numbers, stale-prone edit choreography, and instructions that assume today's internal file layout will survive. File paths belong in read-first context when they are stable surfaces, and in `Где менять` marked «на момент нарезки <дата>».
- Without a Tech Spec, an Issue integrating an external service carries live response samples in `Ключевые контракты`, or it is blocked by its probe Issue.

Optional pre-application section (issue-only; Project-first dispatch materializes
it from the approved Tech Spec or package-record unit). Substitute raw content and its hash; the
path item may be indented and followed by blank lines before a column-zero `text`
fence. Blank lines after the marker and between items are allowed. Hash the raw
UTF-8 lines, each ending in LF, without trimming or adding indentation.

````markdown
# Предприменение
- `.agents/mono-workflow.config.json` sha256 `<sha256>`
```text
<точные байты файла с завершающим LF>
```
````
