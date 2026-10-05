# Review Output Template

Use Russian for Linear-facing review comments or summaries when no project config overrides language.

```text
Коротко: <по-русски: смысл вердикта и безопасно ли двигаться дальше, нужны ли исправления или есть блокер>
Ревью Linear: <ready|advisory-ready|needs-fixes|blocked>

Режим: <handoff|pre-ship|artifact|issue|issue-only|delivery>
Риск: <крошечный (tiny)|обычный (standard)|глубокий (deep)|рискованный (risky)>
Ревью-гейт: <обязательное (required)|совещательное (advisory)>

Проверено:
- Проект:
- PRD:
- Техспек:
- Задачи:
- PR/ветка:

Не проверено:
- <manual QA/browser/prod/mobile/deploy surface/etc. that did not run, or `none known`>

Блокирующие замечания:
- <none or findings>

Предложенные исправления:
- <none or findings>

Нужно твоё решение:
- <none or вопрос + рекомендация агента>

К сведению:
- <none or findings>

Рекомендуемый следующий шаг:
```

Формат замечания:

```text
[<tier>] <artifact> - <title>
Доказательство:
Влияние:
Рекомендация:
Ответственный workflow:
```

Rules:

- Do not use `PASS`, `FAIL`, or `BLOCKED` as the review status.
- Do not mutate Linear artifacts from `mono:review`.
- Translate the review status into the `Коротко` line before listing findings.
- Include `Не проверено` so the user can distinguish review confidence from manual QA or deploy confidence.
- When review is required and blocking findings remain, verdict is `needs-fixes`.
- When required artifacts cannot be inspected, verdict is `blocked`.
- When review is advisory and no blocking risk exists, verdict is `advisory-ready`.
- Each item under `Нужно твоё решение:` must state the question and include an agent recommendation.
