# Итог Ship

Итог человеку языком продукта; сначала результат или точное решение.

```text
<1-3 строки: что готово, попытка, круги ревью из трёх, ожидание из предела>
PR: [#<номер>](<url>)
Задача: `<ключ>` - <статус>

Статус ревью:
- Preflight: <ready/blocked/drift-candidate/needs-human/not run>; <локальная готовность>.
- Ревью: <кто, круги, итог>; замечания бота, CI и владельца: <решены как>.
- Documentation workflow: <запущен/пропущен/не настроен; влияние на голову>.
- Bug/perf proof: <not applicable or original symptom/baseline + fix proof + regression proof/gap>.
- Нерешённые обсуждения: <число>.

Проверки: <строка Ship из описания PR>

Проверено:
- <что смотрел>.
Не проверено:
- <ручное, браузер, прод, мобильный, выкладка, приёмка или «ничего известного»>.

Что дальше: <обычно mono:deploy; альтернатива и её цена>.

mono-ship green certificate: <записан/не записан + причина>
Next: <mono:deploy | needs-human | blocked>
```

Вердикты по `templates/ship-status-ux.md`.
