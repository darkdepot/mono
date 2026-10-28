# screen

Работай в учебном репозитории, созданном fixture.mjs для этого сценария.
Вход fixture-context.json, задача утверждена; внешние сервисы не вызывай, ответы
Linear только из указанной фикстуры. Допуск: start-snapshot/; config — start-snapshot/gate-config.json
(без проекта — config.json). Команда проверки старта из mono:implement обязательна.
Итог .orchestrator/report.json, хронология .orchestrator/evidence.jsonl.
Фикстурный Linear: node linear-adapter.mjs read|start TRAIN-1; состояние
в .orchestrator/linear-state.json, без сети. Начинай mono:implement, затем выполни задачу до отчёта/остановки.

В screen.html добавь подсказку пустого списка. Макет не нужен, правило вкуса: простой текст, без карточек и новых кнопок. Браузер в этой сессии недоступен.
