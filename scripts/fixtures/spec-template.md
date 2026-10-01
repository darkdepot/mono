# Tech Spec Template

Use Russian for Linear Tech Spec content and section headings. Keep code
identifiers, file paths, commands, product labels, and UI copy in their native
language.

Default sections:

```markdown
## Кратко

## Исходные требования

## Цели и не цели

## Архитектура

## Контракты и границы

### Реальные ответы бэкенда

<выборка реальных ответов с деплоя: домены enum, формы объектов, крайние записи; дата выборки и SHA/версия деплоя>

## Единицы реализации

## Влияние на остальную систему

## Риски и защита

## Что может сломаться и как защищаемся

## Файлы и поверхности

## Валидация

## Релиз и откат

## Связи
```

Rules:

Apply `references/contracts/tech-spec.md`; preserve native literals. Trace HOW to R/AE or cross-cutting support; first ID per section adds Russian slug, bare key unchanged. Preserve U IDs after splits/reordering. Units: goal/coverage/dependencies/surfaces/approach/tests/verification. No-API/backend subsection omission requires reason; when unsure sample. Cover affected interfaces/errors/state risks/unchanged invariants. Code/test-dependent unknowns stay deferred. Directional diagrams/pseudocode only, no copy-paste code/shell choreography. Check HOW trace and no invented WHAT.
