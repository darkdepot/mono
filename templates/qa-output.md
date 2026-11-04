# Отчёт QA

Язык — `languages.linear` продукта. Заполнить до первого действия: задача/проект,
head, base, режим, источник рецепта, модель/effort, место публикации и состав
сборки для проекта. Закрепить список ожиданий отдельным файлом.

## Ожидания и результаты

| id | Источник: task / requirement / acceptance / design / heuristic / scenario | Ожидание до прохода | Исход | Доказательство и время главы | Причина / решение |
| --- | --- | --- | --- | --- | --- |

Для проекта все R и AE PRD. Для задачи каждый «Готово, когда», связанные R/AE,
PNG и пограничные случаи. Не вычёркивать не пройденное и снятые ложные тревоги.

Для скиллов отдельная строка на сценарий и хост: passed / failed / unverified,
ссылка на след и свежий дамп monotest, время в миллисекундах и число задач.
`suite-result.json` содержит `startedAt`, `finishedAt`, `durationMs`, `monotestTasks`
(уникальные задачи, не сумма повторных чтений одной цепочки), `results` по хостам.
Неизмеренное число — null; остановленный хвост остаётся unverified. Запись в рабочий
Linear: failed, остановка всех хостов, `manualRemoval` со ссылкой владельцу.

## Баги

Одна проблема: шаги; ожидаемое; фактическое; расхождение с критерием/R/AE/PNG;
доказательство. Отдельно: нестабильность, повтор на чистой копии/main и ссылка
новой задачи при excluded; снятая ложная тревога с причиной.

## Итог владельцу

Вердикт и смысл; проверено; не проверено и почему; баги; главное видео и главы;
запрещённые сценарии владельцу; следующий ответственный. Без просмотра видео
должно быть ясно, что готово. Публикация и read-back: ссылки/результат.

Для `given-version`: «История после версии и исправление не просматривались».
Если граница нарушена, вместо этой строки описать увиденное: проход
недействителен, вердикт не `passed`, нужен новый проход в чистой сессии.
Оговорки досева: перечень созданного, пункты, которым это понадобилось,
и ссылка на журнал досева; журнал входит в доказательства каждого зависимого
пункта. Эти сведения остаются в отчёте и доказательствах, без новых полей сертификата.

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
`evidenceRoot`, `expectedItems` (полный массив `{id, source, expectation}`), `taskCriteria` (id критериев
задачи). Текст и источник каждого пункта совпадают побайтно; строковые id старой формы не принимаются. Для `ship`: `issue` последней задачи и `shipCertificate` строкой;
для `file`: `recipeFile` — читаемый файл задания. Пути доказательств абсолютные
внутри постоянной папки этой версии. Для каждого passed нужен непустой файл;
без доказательства outcome=failed, reason объясняет отсутствие. У failed и
unverified обязательна reason. Пустой evidence допустим только при отсутствии
доказательства, зелёного вердикта тогда нет.

`excluded`: source не task и не scenario, reason и successor (ссылка на отдельную задачу);
добавить доказательство нестабильности main. taskCriteria и scenario исключать нельзя.
`project`: вместо issue поле project, в сертификате и expected полный
`build: [{"issue":"EXAMPLE-1","head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]`.
Изменение задач или head в сборке требует нового прохода.

Короткая форма: `kind: no-behavior`, scope=task, issue/head/base/verdict/reason
и mode/recipeSource/gateEligible, без items. expected.kind тоже no-behavior;
этот выбор заранее обоснован задачей и diff. При наличии scenario в ожиданиях no-behavior запрещён, даже если expected.kind тоже no-behavior. given-version и рецепт file никогда
не открывают ворота. В режиме ship пригодность означает привязку к ship и рецепту,
а готовность требует ещё verdict=passed; сама публикация ворот не включает.
