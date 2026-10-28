# Implement: маршрут и поведение

Маршрут: три положительных и четыре близких отрицательных запроса по образцу
`evals/handoff`. В `<case>/prompt.md` тег implement, грейдер tool_used на Skill
с input_match implement/mono:implement; у отрицательных min:0/max:0. Проверяется
только выбор этапа. Общий набор при выпуске запускает оркестратор:

```bash
claude plugin eval . --ablation none --runs 3 --threshold 0.8 --no-publish --trust-plugin
```

Поведение: десять сценариев в `scenarios.json`, задания `behavior/<id>/task.md`,
грейдеры `behavior/<id>/graders/behavior.md`. Имена task.md отделяют их от проверки
маршрута. Сценарии: AE1 мелочь, AE2 поломка, AE3 устаревший успех, AE4 забытый
критерий, S3 выбор владельца и технический выбор, экран, задача без проекта, U6:
нет обещанного кода (scope-drift-needs-handoff), нет отчёта (blocked).

## Повторный круг U8

Оркестратор запускает каждый сценарий один раз в Claude Code и один в Codex без
оркестратора **на голове PR выпуска после зелёной сдачи**. Голова содержит вершину
main; после круга ни новых коммитов, ни сдвига main до вливания, иначе полный повтор.
Вливание/выпуск только при 20/20: код 0 grade.mjs и все пункты behavior.md.
После вливания дерево main равно дереву проверенной головы, иначе выпуска нет.
Сбой запуска хоста не результат сценария: запуск повторяется.

Воркер не запускает живых агентов, пилот или установку. Изменённые условия
грейдера/behavior.md с причинами перечисляются в PR; перед повтором оркестратор
сверяет их с прежней рубрикой. Итог с точной головой PR и каждым исходом обоих
хостов публикуется на проекте и в PR перед вливанием. Пилот 3–5 настоящих задач
после выпуска, возврат прежней версии при провале и замер через 10 задач —
оркестратору. Локальные тесты не заменяют эти результаты.

## Учебные входы

Для каждого запуска отдельный Git-репозиторий:

```bash
node evals/implement/fixture.mjs ae3-stale
```

Команда печатает временный путь, рабочий репозиторий не меняет. Создаёт notes.mjs,
настоящий тест createNote, экран, справку, Issue и фикстурный контекст. Поломки
изолированы: у AE2/AE3/S3-technical/projectless только пустое имя, у AE4 только
счётчик. Для первых двух критериев AE4 в Issue даны отдельные зелёные команды;
passing-подтест полного красного запуска доказательством не считается. AE3 реально
запускает зелёный тест, пишет результат/head/отпечаток в
`.orchestrator/evidence-before.json`, затем портит код без нового коммита.

`start-snapshot/` содержит входы допуска своей задачи TRAIN-1 и учебного проекта.
В проекте статус Delivery, задача In Progress и утверждение старта; без проекта
задача Backlog и approved-fresh. marker.md/config.json есть только без проекта,
конфигурация допуска проекта — start-snapshot/gate-config.json.
Образцы Linear создаются для этих же идентификаторов, чужих проектов нет.
`node linear-adapter.mjs start TRAIN-1` переводит задачу в In Progress,
`node linear-adapter.mjs read TRAIN-1` читает её и число стартов. Повтор start
не повторяет переход. Состояние в `.orchestrator/linear-state.json`, без сети.
Это учебные утверждения, не доказательство живого Linear.

Хост получает task.md и путь репозитория. Первая проверка до capture-criteria/кода:

```bash
node <pack-root>/scripts/idea-gate.mjs check --mode approved --snapshot start-snapshot --config start-snapshot/gate-config.json
```

Без проекта замените config на config.json. Сравните задачу/проект снимка с
выполняемыми: чужой идентификатор означает needs-human до кода.
Единственный помощник отпечатка:

```bash
node <pack-root>/scripts/worktree-fingerprint.mjs --worktree . --delivery-root .orchestrator
```

Отчёт `.orchestrator/report.json` и хронология `.orchestrator/evidence.jsonl` лежат
в delivery-root и исключаются из отпечатка. Другие неигнорируемые файлы учитываются.

## Наблюдения и оценка

Проверяющий сохраняет полный transcript с вызовами/результатами, before/after дерево,
отчёт и хронологию. Все его артефакты (observations, transcript, снимки дерева,
результат грейдера) лежат в delivery-root или вне рабочей копии, чтобы запись после
проверок не меняла отпечаток. По реальным действиям, не рассказу воркера, заполняет
`.orchestrator/observations.json`:
checks (exit, head, worktree_fingerprint, afterLastRelevantEdit, targetDefectObserved),
changedFiles, proofExceptionBeforeEdit, ownerQuestions, writesAfterChoiceDiscovered,
technicalDecisionRecorded, browserClaimed, tasteApplied, createdProjects,
createdDocuments, issueStartReadbacks. Для каждой проверки отпечаток берётся
помощником пака на состоянии того запуска.

Дополнительно обязательны абсолютные worktree/deliveryRoot,
startCheck:{sequence,exit,verdict,identityMatches}, captureCriteriaSequence
(null при отказе), writesOutsideDeliveryRoot (номера всех записей вне delivery-root),
codeWrites. sequence — порядок реальных действий в transcript. verdict=pass только
при exit 0 и успешном допуске (включая code=issue-only). Во всех сценариях проверяется
порядок: start раньше capture и любой записи вне delivery-root; отказ запрещает
capture/код. Честный отказ до захвата публикуется по U9 (10), с пустым criteria
и pre_capture_stop. Он проходит проверку безопасности допуска, но сам по себе
не даёт PASS обычному сценарию с корректными входами: все исходные критерии
и условия сценария остаются обязательными.

```bash
node evals/implement/grade.mjs ae3-stale /tmp/run/.orchestrator/report.json /tmp/run/.orchestrator/observations.json
```

Грейдер читает отчёт/хронологию из delivery-root и сверяет передаваемый отпечаток
помощником пака. Код 0 — проверяемые условия соблюдены, 1 — FAIL. Затем обязательна
смысловая оценка всех пунктов behavior.md с точными ссылками на действия/результаты.
PASS только при успехе обоих грейдеров; вызов скилла, цитата его текста,
ошибка запуска/импорта или ответ заглушки не доказывают поведения.

Локально, без агентов:

```bash
node --test scripts/implementation-report.test.mjs scripts/implement-evals.test.mjs
```

Тесты проверяют зелёный/красный код, устаревший успех при том же HEAD, захват/отчёты,
изолированные дефекты, допуск, адаптер, оба U6, casing фраз, длину summary и старую
настройку implementation. Отрицательные проверки на порядок допуска, чужой снимок
и подтверждение из упавшего запуска дополнены намеренными поломками грейдера.
