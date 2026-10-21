# Tech Spec Template

Use Russian for Linear Tech Spec content and section headings. Keep code
identifiers, file paths, commands, product labels, and UI copy in their native
language.

Choose only sections that carry a decision; never publish empty headings or
repeat the PRD. Failures, release and rollback are conditional, not a checklist.

```markdown
## Кратко
<одно техническое решение и почему оно проще>

## Решения
- U1. <что исполнитель не угадает; контракт, граница и проверка>. Покрывает R1

## Прикидка для Handoff
<примерное число PR, что первым, где риск; нарезку решает Handoff>

## Связи
<PRD и источники решения>
```

When relevant, add populated sections: «Исходные требования», «Архитектура»,
«Контракты и границы», «Реальные ответы бэкенда», «Единицы реализации»,
«Влияние на остальную систему», «Что может сломаться и как защищаемся»,
«Валидация», «Релиз и откат». For a backend, include real deployed enum domains,
object shapes and edge records with sampling date/version, or the first probe.

Apply `references/contracts/tech-spec.md`; preserve native literals. Trace HOW
to R/AE or cross-cutting support; keep stable U IDs after splits/reordering.
Record only non-inferable, expensive-to-redo decisions and deferred unknowns.
Directional diagrams/pseudocode only, no copy-paste code/shell choreography.

Optional nested manifest: indented path/hash items and blank lines are allowed;
column-zero fences contain raw UTF-8 with final LF;
dispatch changes only its wrapper to `# Предприменение`.

````markdown
- U1. <единица; покрытие>
  - Предприменение:
    - `.agents/mono-workflow.config.json` sha256 `<sha256>`
```text
<точные байты файла с завершающим LF>
```
````
