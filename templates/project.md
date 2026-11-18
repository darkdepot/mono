# Project Template

Use the project config language for Linear Project body. Use Russian when no
project config is present.

Before its own Idea stage, a map Project created by `mono:initiative` is the
PC-005/PC-013 exception: Idea status, no Brief, one line with the initiative link,
`К<n>` and value, plus «Зависит от: P-<TEAM>-N, …» when dependencies exist.
Its own Idea stage preserves this whole body in the Brief’s «Отброшено» before
writing the ordinary description and Brief; Initiative approval does not start it.

Otherwise in Idea, use exactly three second-level sections. Legacy Handoff packages added In scope and
Out of scope; the current Handoff leaves the approved body unchanged. Unknowns live in the approval comment snapshot, outside the body.

Default Russian Idea body:

```markdown
## Что

## Зачем

## Образ результата
```

Legacy packages may carry:

```markdown
## Что входит

## Что не входит
```

Rules:

- Keep Project body as a concise project description, not a workflow dashboard.
- Do not inline full PRD or Tech Spec.
- Do not include active docs, active issues, status bookkeeping, lifecycle notes, or workflow mechanics in the Project body.
- Keep document and issue relationships in Linear metadata, resources, comments, or the handoff package.
- Record review-gate state in Linear comments, metadata, or the handoff package, not as visible Project-body sections.
- Do not include PR chips before a real PR exists.
- Do not include visible sections such as `Принципы workflow`, `Lifecycle`, `Документы`, `План задач`, `Ревью-гейт`, or `Текущий статус`.
