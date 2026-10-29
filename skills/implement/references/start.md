# Вход и старт

Читай config/Git/базу; диспатч задаёт ветку/контекст, иначе свежие Linear/комментарии.
Допуск/Context seam — worker-contract; Handoff-находки закрыты/приняты/отложены.

До capture-criteria и любой записи кода — одна проверка старта:
без диспатча `node <pack-root>/scripts/idea-gate.mjs check --mode approved --snapshot <dir> --config <path>`;
с диспатчем handshake при переходах, иначе start gate. Установленный пак,
свежий снимок. Отказ/ненулевой код/не `pass`: нет входа `blocked`, целостность
`needs-human`. Утверждение из контекста/фикстуры отказ не заменяет; legacy-migrate
не допуск. Отчёт остановки в файл и сессию, публикация по worker-contract.
Чужая задача/проект в снимке или утверждении — `needs-human` до кода/захвата.

Диспатч: Two-Phase Dispatch Handshake/Resume по worker-contract; после переходов
Delivery/read-back без повтора identity, иначе текущее состояние. Самостоятельно:
утверждённый пакет/старт, Ready (старый Discovery без Ready) → Delivery,
mono:check delivery/read-back. issue-only-lane: только Issue → started/read-back.

Старт/PC-016/PC-019 — Context seam в worker-contract.

После допуска, до кода, из корня рабочей копии:
`node <pack-root>/scripts/delivery-state.mjs capture-criteria --issue <KEY> --attempt <N> --issue-file <file> --root <delivery-root>`.
file: snapshot/issue-<KEY>.md либо стартовое чтение Issue. Самостоятельно
`--root .orchestrator`: абсолютный путь от текущей папки.
`<delivery-root>/reports/<KEY>-criteria-a<N>.json` неизменно; не коммить.
Отказ захвата — blocked, публикация без выдуманных критериев по worker-contract.
Чужие движки/помощник уроков не нужны.

Устаревшее задание/иной риск/пакет — стоп. Старт в capsule.decisions/отчёте,
без комментария. Resume: сохранить сделанное/чужое, не повторять применённое.
Blocked by в пакете: сначала отчёт/влитой коммит предшественницы, main после посадки.
Нет входа — blocked, summary дословно «нет отчёта предшественницы»; обещанного нет —
scope-drift-needs-handoff, не строй заново. Старый отчёт без criteria: только коммит.
Самостоятельно входы из Linear/GitHub.
