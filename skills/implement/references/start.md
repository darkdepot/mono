# Вход и старт

Читай задачу, пакет, `.agents/mono-workflow.config.json`, Git/базу. Диспатч
заменяет Linear, фиксирует ветку; иначе свежие Linear и все комментарии.
Допуск и пять полей Context seam — worker-contract; разрешённые находки Handoff
закрыты/приняты/отложены. Проблема целостности — `needs-human`, нет входа — `blocked`.

До старта: `node <pack-root>/scripts/idea-gate.mjs check --mode approved --snapshot <dir> --config <path>`.
Корень установленного пака; без диспатча свежий снимок. Отказ не обходи:
нет идеи — mono:idea, нет старта — итог Handoff; legacy-migrate не допуск.

С диспатчем identity, снимок/утверждения, допуск, Two-Phase Dispatch Handshake
из worker-contract. После переходов проверка Delivery по обратному чтению,
без повтора identity. Resume по контракту. Без переходов текущее состояние.
Без оркестратора утверждённый пакет/старт, перевод Ready (старый Discovery без Ready)
в Delivery и mono:check delivery; прочитай обратно. PC-019 и legacy — worker-contract.
Задача без проекта: issue-only-lane, только Issue в started, обратное чтение;
Project/PRD/Spec не требуй. Документы одни не разрешают старт.

Комментарий старта/очередь прежние: full — задача/пакет/утверждение/допуск,
объём, способ работы, проверки и границы; short — capsule.decisions/начало ready.
До кода подтверди всю очередь, даже пустую; без оркестратора запиши/прочитай обратно.
Движок и помощник уроков не выбираются.
