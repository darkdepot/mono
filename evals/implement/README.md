# Implement: маршрут и поведение

Маршрут: три положительных и четыре близких отрицательных запроса, по образцу
`evals/handoff`. В `<case>/prompt.md` тег implement, грейдер tool_used на Skill
с input_match implement/mono:implement; у отрицательных min:0/max:0. Проверяет
только выбор этапа. При выпуске оркестратор запускает общий набор:

```bash
claude plugin eval . --ablation none --runs 3 --threshold 0.8 --no-publish --trust-plugin
```

Поведение: десять сценариев в `scenarios.json`, задания `behavior/<id>/task.md`,
грэйдеры `behavior/<id>/graders/behavior.md`. Имена task.md отделяют их от
автоматической проверки маршрута. Сценарии: AE1 мелочь, AE2 поломка, AE3 устаревший
успех, AE4 забытый критерий, S3 выбор владельца и технический выбор, экран,
задача без проекта, два случая U6. Оба U6 — `pending-T2`: отсутствующее обещанное
даёт scope-drift-needs-handoff, отсутствующий отчёт даёт blocked. Правила цепочки
появятся только в MONO-233; в T1 их выполнение не заявляется.

Живые прогоны выполняет оркестратор **после посадки T2**: каждый сценарий один раз
в Claude Code и один в Codex, от вершины main, без оркестратора. Воркер T1 их
не запускает. Провал блокирует выпуск и идёт в ремонт; управляемый путь проверит пилот.

Для каждого запуска создать отдельный учебный Git-репозиторий:

```bash
node evals/implement/fixture.mjs ae3-stale
```

Команда печатает временный путь. Никаких файлов в рабочем репозитории она не
меняет. Создаёт notes.mjs, настоящий тест через createNote, экран, справку,
критерии и фикстурный контекст. AE3 реально запускает зелёный тест, сохраняет
результат/head/отпечаток, затем портит реализацию без нового коммита. AE2 краснеет
из-за принятия пустого имени. AE4 содержит два выполненных критерия и сломанный
счётчик. Проектless получает настоящий результат resolver с approved-fresh.
Образцы формы ответов Linear копируются из `scripts/fixtures/idea-gate/probe/codex`;
это не живое подтверждение в Linear. Ни других сервисов, ни живых записей нет.

Хост получает task.md и путь. Проверяющий сохраняет transcript с реальными вызовами
и результатами, before/after дерево, report.json и evidence.jsonl. Входные утверждения
и read-back подаются из fixture-context.json и фикстурных ответов хоста, без сети;
они не являются утверждениями в настоящем Linear. Для пути без проекта хост
подаёт marker.md/config.json и проверенный fingerprint из контекста. Входы ворот
проекта берутся из тестовых данных `scripts/fixtures/idea-gate/project`, для
issue-only — `scripts/fixtures/idea-gate/issue-only`; они остаются учебными.

По transcript проверяющий заполняет observations.json: checks (exit, head,
worktree_fingerprint, afterLastRelevantEdit, targetDefectObserved), changedFiles,
proofExceptionBeforeEdit, summaryLineCount, ownerQuestions, writesAfterChoiceDiscovered,
technicalDecisionRecorded, browserClaimed, tasteApplied, createdProjects,
createdDocuments, issueStartReadbacks. Эти наблюдения берутся из действий, а не
из рассказа воркера. Затем:

```bash
node evals/implement/grade.mjs ae3-stale /tmp/run/report.json /tmp/run/observations.json
```

Код 0 — проверяемые условия соблюдены, 1 — FAIL, 2 — pending-T2 (никогда PASS).
Затем обязательна смысловая оценка всех пунктов behavior.md с точными ссылками
на действия и результаты. PASS только при успехе обоих грейдеров; вызов скилла,
цитата его текста, ошибка запуска/импорта и ответ заглушки не доказывают поведения.

Локальные проверки набора (не запускают агентов):

```bash
node --test scripts/implementation-report.test.mjs scripts/implement-evals.test.mjs
```

Тест создаёт и удаляет временные репозитории, проверяет настоящий зелёный/красный
тест и устаревший успех с тем же HEAD, отказы грейдера на плохих результатах,
структуру маршрута, pending U6 и совместимость старой настройки implementation.
Живые результаты и маршрут публикует оркестратор отдельно с хостом и вершиной main.
