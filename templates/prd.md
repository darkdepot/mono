# PRD Template

Use Russian for Linear PRD content.

Default sections:

```markdown
## Кратко

Размер: мелочь | обычное | проект; <бюджет владельца или «предполагаю»>

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

Н<n> <словами>: <решение> — решено (как), принимаем риск (какой), проверяем параллельно (как, где результат), сначала проверить (без ответа строить нельзя), не делаем (почему).

## Открытые вопросы

Кто решает: Design, Tech Evaluation или владелец.

## Связи

«Исследование»; задача этапа.
```

Rules:

Apply `references/contracts/prd.md`; omit irrelevant sections. Stable A/F/R/AE IDs; PRD-lite may use 1–3 obvious bullets. Actor context inline: `A1. <кто> — <контекст/боль>`, one per operator. Observable requirements, or structural with reason. Stateful acceptance: `AE1 (безопасное сохранение). Покрывает R1 (частичное сохранение), R2. Дано ..., когда ..., тогда ...`; bare IDs are keys, slugs additive/config-language. Proof intent excludes commands/paths/test names/HOW. Fix gaps the Spec would invent.
