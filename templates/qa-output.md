# Отчёт QA

Язык — `languages.linear` продукта. Заполнить до первого действия: задача/проект,
head, base, режим, источник рецепта, модель/effort, место публикации и состав
сборки для проекта. Закрепить список ожиданий отдельным файлом.

## Ожидания и результаты

| id | Источник: task / requirement / acceptance / design / heuristic | Ожидание до прохода | Исход | Доказательство и время главы | Причина / решение |
| --- | --- | --- | --- | --- | --- |

Для проекта все R и AE PRD. Для задачи каждый «Готово, когда», связанные R/AE,
PNG и пограничные случаи. Не вычёркивать не пройденное и снятые ложные тревоги.

## Баги

Одна проблема: шаги; ожидаемое; фактическое; расхождение с критерием/R/AE/PNG;
доказательство. Отдельно: нестабильность, повтор на чистой копии/main и ссылка
новой задачи при excluded; снятая ложная тревога с причиной.

## Итог владельцу

Вердикт и смысл; проверено; не проверено и почему; баги; главное видео и главы;
запрещённые сценарии владельцу; следующий ответственный. Без просмотра видео
должно быть ясно, что готово. Публикация и read-back: ссылки/результат.

## Машинная форма

`report.json`: объект с `certificate` — строкой: точный маркер
`mono-qa certificate`, перевод строки, затем JSON **без Markdown-забора**:

```json
{
  "scope": "task",
  "issue": "EXAMPLE-1",
  "head": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "base": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "verdict": "passed",
  "mode": "given-version",
  "recipeSource": "file",
  "gateEligible": false,
  "kind": "behavior",
  "items": [{
    "id": "C1", "source": "task", "expectation": "Ожидание из задачи",
    "outcome": "passed", "evidence": ["<evidence>/session.cast"]
  }]
}
```

Это образец, не доказательство. `expected.json` получает независимо из задания:
`scope`, `issue` или `project`, `head`, `base`, `kind`, `mode`, `recipeSource`,
`evidenceRoot`, `expectedItems` (полный массив id), `taskCriteria` (id критериев
задачи). Для `ship`: `issue` последней задачи и `shipCertificate` строкой;
для `file`: `recipeFile` — читаемый файл задания. Пути доказательств абсолютные
внутри постоянной папки этой версии. Для каждого passed нужен непустой файл;
без доказательства outcome=failed, reason объясняет отсутствие. У failed и
unverified обязательна reason. Пустой evidence допустим только при отсутствии
доказательства, зелёного вердикта тогда нет.

`excluded`: source не task, reason и successor (ссылка на отдельную задачу);
добавить доказательство нестабильности main. taskCriteria исключать нельзя.
`project`: вместо issue поле project, в сертификате и expected полный
`build: [{"issue":"EXAMPLE-1","head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]`.
Изменение задач или head в сборке требует нового прохода.

Короткая форма: `kind: no-behavior`, scope=task, issue/head/base/verdict/reason
и mode/recipeSource/gateEligible, без items. expected.kind тоже no-behavior;
этот выбор заранее обоснован задачей и diff. given-version и рецепт file никогда
не открывают ворота. В режиме ship пригодность означает привязку к ship и рецепту,
а готовность требует ещё verdict=passed; сама публикация ворот не включает.
