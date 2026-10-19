# Discovery: срабатывание этапа

Три положительных запроса (решения после Research, разговор о решении после Research,
правка PRD до одобрения пакета)
и четыре близких отрицательных (сырая идея, Research, Tech Spec, одна правка на PR).
Тег `discovery`, грейдер `tool_used` для `Skill`; у отрицательных `min: 0`, `max: 0`.
Только маршрутизация, без записей Linear. Оркестратор запускает полный набор Idea,
Research и Discovery на выпуске MONO-186:

```bash
claude plugin eval . --ablation none --runs 3 --threshold 0.8 --no-publish --trust-plugin
```

Живая приёмка и проверки Claude относятся к MONO-186, не к этому PR.
