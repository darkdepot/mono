# PRD Template

Use Russian for Linear PRD content.

Default sections:

```markdown
## Кратко

Размер: небольшой | средний | большой; признак: <что определило размер>
<бюджет, если назван>

## Акторы

## Проблема

## Текущий процесс

## Целевой процесс

## Сценарии

## Требования

## Примеры приемки

## Что должна доказать проверка

## Критерии успеха

Что не должно ухудшиться; когда смотрим.

## Что не входит в MVP

## Допущения

Главное первым.

## Что решили по неизвестным Research

Н<n> <словами>: <решение>: решено, принимаем риск, проверяем параллельно, сначала проверить или не делаем.

## Открытые вопросы

Кто решает: Design, Tech Evaluation или владелец.

## Связи

«Исследование»; задача этапа.
```

Rules:

Apply `references/contracts/prd.md`; omit irrelevant sections. Stable A/F/R/AE IDs; PRD-lite may use 1-3 obvious bullets. Actor inline: `A1. <кто>: <контекст/боль>`. Observable requirements, or structural with reason. Acceptance: `AE1 (безопасное сохранение). Покрывает R1, R2. Дано ..., когда ..., тогда ...`. Proof intent excludes commands/paths/test names/HOW. Leave HOW to Tech Spec. Size: chosen solution only, up to 15 KB, 10 R, 4 AE.
