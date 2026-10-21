# Changelog

All notable changes to Mono Agent Workflow are documented in this file.

This project follows Semantic Versioning. Breaking workflow or adapter contract changes require a major version bump after `v1.0.0`; before `v1.0.0`, they must be called out explicitly in release notes.

## [Unreleased]

## [0.35.1] - 2026-10-21

<!-- fragment: MONO-218 sha256:51ce9c318ec9319d1efbc82ecdd6813dd52554a96d7a203961bc556f6a88ae47 -->
### Этапы после первого живого прогона

- Утверждение только того, что видно: PRD на утверждение приходит сообщением с сутью, «Решил сам» и ссылкой, а правка PRD из Handoff с «Было / Стало»; окно стоит под этим сообщением.
- Детали PRD, которые всплыли при сборке, Discovery сначала проверяет у похожих продуктов и в нашем коде и приносит предложения с источниками; спрашивает только то, что меняет результат для владельца.
- Меньше служебных строк: перед первым действием одна простая фраза, содержательный старт после чтения, дальше этапы пишут, когда есть находка, вопрос или итог, а записи в Linear, проверки и помощники идут молча. Весь текст владельцу на его языке, без внутренних названий шагов.
- Idea при уже существующем проекте берёт рамку из слов владельца в разговоре, старые документы только справка; названный известный приём сначала смотрит у похожих продуктов.
- Handoff показывает финал и итог двумя сообщениями. Правила стали короче: запреты заменены образцами, обязательное чтение каждого этапа не выросло.

## [0.35.0] - 2026-10-20

<!-- fragment: MONO-210 sha256:92f8b10effa1d42dd49b7f13a01cceac5add9957e31593e530b88abf8db35f40 -->
### Idea и старт исследования

- Idea: описание утверждается только кнопкой «Утвердить» в окне вопроса («Утвердить» / «Ещё обсудить»), в любом режиме, и у оркестратора тоже. Слова в чате продолжают разговор. В Codex окно `request_user_input_async`; окна нет, утверждения нет и запись не делается. Машинная запись `mono-idea: approved` не меняется; строка `verify` об устаревшей версии теперь «Нужно новое утверждение».
- Idea: первое сообщение двумя абзацами, сроков и строк ожидания нет, будильник разведчиков снят. У разведчиков жёсткий предел итога, обязательная первая строка для владельца и запрет на непроверенные слова об охвате.
- Idea заканчивается отдельным финалом (проект, ссылка, статус Idea, команда) и окном «Начать исследование» / «Ещё обсудить» с планом от Research (`skills/research/references/plan.md`). Исследование начинает только владелец, кнопкой или словами; проект до этого в Idea. Заметки записи несут блок «Что всплыло в разговоре».
- Research: вход проверяется только чтением, затем перевод из Idea в Discovery с обратным чтением и только потом задача этапа. Свой план первым действием, без сроков, финал отдельно, затем окно «Начать <следующий этап>» в сессии владельца; оркестратор начинает следующий этап сам.
- Новый общий `references/owner-dialog.md`: механика окон выбора, утверждения и перехода в Claude Code и Codex, читается по условию. Воркерам в задании названы запрещённые инструменты вопросов.
- После Research новый проект идёт в Discovery; исключение определяется наличием одобренного старого пакета (`mono:check discovery`, Old path), такой проект идёт в Handoff (PC-001, PC-014, описание Handoff, lifecycle, оркестратор).
- Явная правка контракта проекта: PC-001, PC-013, PC-014; новый отпечаток в `scripts/validate-workflow.mjs`, Research стал проверяемым потребителем контракта.

<!-- fragment: MONO-211 sha256:301ae2ec7c71a998f1f3e79857b7435f6545d308c7ccaec01be5e23158c7403c -->
### Research как продакт и читаемый документ

- Research звучит как продакт с картиной: старт 1-2 строками (что исследую целиком, чьи решения учитываю, где проверяю сомнение владельца), итог по каждому вопросу плана 2-3 строками по мере готовности, неожиданное сразу, между вызовами текста нет. Вопросов владельцу нет, сроков нет.
- Сомнение владельца из разговора на Idea становится пунктом плана его словами и получает ответ в финале и в документе или становится неизвестным с проверкой.
- Документ «Исследование» читается сверху вниз: «Кратко» по фразе на каждый вопрос идеи, совет с опорой на найденное, по находке на вопрос с выводом в заголовке, коды фактов только в строках «Откуда:», даты с годом. Новая проверка `idea-gate.mjs research-draft` считает пределы до записи и по обратному чтению; проверка перед запуском работы и блок `mono-research` не меняются.
- Условная справка оркестратора для Research; финал отдельным сообщением, затем переход к следующему этапу: после Research новый проект идёт в Discovery; исключение определяется наличием одобренного старого пакета.

<!-- fragment: MONO-212 sha256:f1a8192780c0654a0f3e166531fa1d855e6284ad91de2754cb1e40f40f27c4de -->
### Discovery как продакт, который ищет решение вместе с владельцем

- Этап Discovery пересобран с нуля. Первое сообщение несёт свой взгляд: спор с постановкой, сильную версию идеи и один открытый вопрос про реальный случай, без пересказа и «Верно понял?». Дальше разговор по одному вопросу с догадками и позицией на каждый ответ; опасение владельца разбирается по причине, а не превращается в настройку; техника решается агентом строкой «Решил сам:».
- Два-три решения отличаются тем, что получит владелец; рекомендованное показывается на настоящем прошлом проекте до выбора. PRD короткий (до 10 требований, около двух страниц).
- Утверждение PRD только кнопкой «Утвердить» / «Ещё обсудить»; финал отдельным сообщением, затем «Начать Handoff» / «Ещё обсудить» в сессии владельца, у оркестратора Handoff начинается сам. Сроков и строк ожидания нет.
- Запись утверждения `mono-prd: approved`, проверка `mono:check discovery`, контракты и шов с Handoff не меняются. Новая скелетная проверка обязательного чтения Discovery в `validate-workflow.mjs`; шаблон PRD короче.
- Вход Discovery: после Research новый проект идёт в Discovery; исключение определяется наличием одобренного старого пакета (`mono:check discovery`, Old path): такой проект без явной просьбы владельца в этап не входит, ничего не пишется, дальше Handoff. В сессии владельца до первой записи в Linear этап проверяет, что окно вопроса есть; нет окна: стоп без записей. У оркестратора Discovery идёт сам и утверждает PRD своей записью `by=orchestrator`, как и раньше.

<!-- fragment: MONO-213 sha256:833aa7e5ced187254bde81f2974d85716a391f0d77d0c2da7a68732620488563 -->
### Handoff без Tech Spec: общие правила и контракты

- Работу начинает только владелец: кнопка «Начать работу» или слово «начинаем» после итога Handoff, в любом режиме. Оркестратор старт не даёт; Ready ставится после записи пакета, задач и проверки, до слова владельца, и сам работу не разрешает.
- Вместо Tech Spec на проекте одна запись пакета (комментарий проекта): версии входов, сверка, общие решения `U`, «Решил сам», граф задач. Воркер получает её в слоте `tech-spec.md`, запись старта владельца стоит на месте прежнего одобрения пакета (`approval_status=approved`, ссылка на «Исследование», `by=owner`). Старт привязан к версии записи, которую он назвал; правки классов 1-2 держат его цепочкой, класс 3 требует нового старта. Правка PRD после старта ждёт остановки задетых исполнителей. Скрипты доставки не менялись; одобренная дельта корпуса доставки в тесте +210 байт.
- Нарезка: одна задача по умолчанию, вторая и третья только по причине `too-big`, `shared-base` или `probe`, больше трёх только с ответом владельца. Задачи с общими местами идут цепочкой, внешний сервис требует живых образцов или пробы первой задачей.
- PRD пишет и правит только Discovery, Handoff никогда. Старый путь определяется по записям, а не по дате: это только одобренный пакет прежнего Handoff без записи «да» на PRD; `discoveryGate.since` маршрут больше не меняет. Такие пакеты во всех классах ремонта сохраняют Tech Spec и прежний формат одобрения.
- Явная правка контрактов: проект (PC-005, PC-008, PC-009, PC-014, PC-015, PC-016), задача (IS-001, IS-007, IS-008, IS-009, IS-013, IS-015, IS-017, IS-018, IS-023, IS-026, IS-028, IS-033), Tech Spec (TS-003, TS-004, TS-010, TS-011, TS-018, TS-019, TS-026: новый Tech Spec в этом выпуске не создаётся), PRD (PR-001, PR-003, PR-004, PR-024); новые отпечатки в `scripts/validate-workflow.mjs`.

<!-- fragment: MONO-214 sha256:4d76c10a76133b36f76a0bf989d2c33d2069d7f890cc7772b54f07df7b1d8788 -->
### Handoff как тимлид

- Этап Handoff пересобран на русском. Тимлид берёт только утверждённое (проект, «Исследование», PRD, позже Tech Spec и дизайн), сверяет, сам смотрит в код одним разведчиком в фоне и режет работу на задачи. PRD и Tech Spec он не пишет.
- Вопрос владельцу только когда выбор меняет то, что получит пользователь, что не входит, или ведёт к необратимому, потере данных или цене: простыми словами, 2-4 варианта со следствием, рекомендованный первым. Нужна правка PRD: Discovery правит её в том же касании с окном «Утвердить», Handoff продолжает с того же места. Остальное в «Решил сам» с причиной.
- Свой план в списке задач, старт 1-2 строками, итоги только с находкой, ни одного срока. Финал отдельным сообщением, затем итог (что делаем, задачи по строке, «Решил сам», что сверено) с окном «Начать работу» / «Ещё обсудить».
- Черновик записи пакета и задач до первой записи в Linear смотрят проверяющий и вторая модель другой семьи (в сессии владельца по механике Discovery). Ремонт по записи пакета; старые одобренные пакеты чинятся по прежним правилам, шаги ремонта переехали в условную справку.
- Под оркестратором Handoff идёт сам после Discovery и сам решает конфликты без денег, данных и необратимого; итог с «Начать работу» не держит другие волны, работу начинает только владелец.
- Handoff в списке русских этапов, обязательное чтение три файла (`SKILL.md`, `run.md`, `examples.md`) до 20 480 байт и новая скелетная проверка в `validate-workflow.mjs`; фикстуры «русский этап из списка» перенесены на `mono:issue`; прозовые пины Handoff в `lint-mono-artifacts.mjs` сняты. Набор evals срабатывания Handoff.

<!-- fragment: MONO-215 sha256:f5b9178d3b2213965ac138398193209a2a8efeaa7a5e940f2688b99e77dd796b -->
### Выпуск и обновление

- Выпуск 0.35.0: новые Idea, Research, Discovery и Handoff. Утверждение везде только кнопкой «Утвердить» в окне вопроса (Claude Code `AskUserQuestion`, Codex `request_user_input_async`); без окна утверждения нет. Исследование и работу начинает только владелец.
- Handoff без Tech Spec и без отдельного «да» на пакет: одна запись пакета комментарием проекта, Ready до слова владельца, итог с «Начать работу». Скрипты доставки не менялись.
- После Research новый проект идёт в Discovery; исключение определяется наличием одобренного старого пакета (пакет прежнего Handoff без «да» на PRD), отсечки по дате больше нет, `discoveryGate.since` маршрут не меняет.
- Явная правка контрактов проекта, PRD, Tech Spec и задачи. Версии плагинов согласованы; README и инструкция установки описывают обновление. Форматы совместимы, общая quiescence не требуется.
- Проверки Claude (`claude plugin validate . --strict`, `/skill-doctor`) и evals срабатывания перед PR выполняет оркестратор и включает результат в PR.

## [0.34.1] - 2026-10-19

<!-- fragment: MONO-209 sha256:e2621f02fe41d3afe6aa64f9b3746d139c3701f4b9acacdc26d2e60914baa0c5 -->
### Выпуск и обновление

- Выпуск 0.34.1: Discovery необязателен до новой версии этапа, отсечка снова спящая (`2099-12-31`). После Research основной путь — Handoff по старому пути; Discovery запускается только явной командой владельца. Продукт может включить его раньше через `discoveryGate.since` в `.agents/mono-workflow.config.json`.
- Исправлены маршруты по умолчанию в Research, проверке и оркестраторе, примеры и документация. Старый путь также открыт проекту без PRD, одобрения пакета и записи «да» PRD, если текущая дата UTC строго раньше действующей отсечки; существующие даты PRD/пакета, проверка Research и правила записей «да» не меняются. Сам Discovery и контракты сохранены.
- Форматы совместимы, общая quiescence не требуется; обычные условия Plugin Updates сохраняются, текущие попытки продолжаются на сохранённом `packRoot`.
- Проверки Claude (`claude plugin validate . --strict`, `/skill-doctor`) перед PR выполняет оркестратор и включает результат в PR.

## [0.34.0] - 2026-10-18

<!-- fragment: MONO-183 sha256:952ceeacdf0666622546f27cc01be0682fcaabe139f4cde94e54c020a5f15540 -->
# MONO-183

- Added one stage-task definition, role assignment and Russian task template; package membership, repair and dispatch consumers link to it.
- Research finds or creates its own task first, records its log there and closes it on completion or refused entry.
- Handoff sets Ready after approved package and passing check; Delivery Start accepts Ready, with legacy/missing-status Discovery fallback, and class 3 repair removes Ready.

<!-- fragment: MONO-184 sha256:5ae53eb79356f5a6560838ab280de0c8d52e42791fc2b4294b7b6ba5baec2da1 -->
# MONO-184

- Add Russian Discovery from approved draft v6: product solutions, explicit choice, version-bound PRD yes, tiny and close/defer paths, owner and orchestrator modes.
- Make Discovery the PRD owner before package approval; keep approved PRD read-only in Handoff, with explicit legacy path and independent Research checks.
- Update approved PRD/Project contracts and parity fingerprints, configuration validation, orchestration policy and activation eval cases.
- Invalidate the Handoff entry check when its inputs change; reread the approved PRD immediately before accepting package approval and return to Discovery on a version mismatch.

<!-- fragment: MONO-186 sha256:95d1e40e7f4dd1114dad287302d2d3858836fbf4fa173f2a203cb88a9d5e2ee5 -->
### Выпуск и обновление

- Выпуск 0.34.0 включает Discovery: решения, явный выбор и PRD с «да» на показанную версию в режиме владельца или оркестратора. Отсечка старого пути Handoff — 20.10.2026 (`2026-10-20`, 00:00 UTC), первый полный день UTC после последнего ожидаемого дня выпуска по d-002; при поздней установке продукт может сдвинуть её вперёд через `discoveryGate.since`. Handoff получает утверждённый PRD на чтение, задачи этапов не входят в набор задач реализации, Ready ставится после проверенного пакета.
- Версии плагинов согласованы; README и инструкция установки описывают обновление, поздний переход продукта, задачи с меткой `Этап` и поведение без Ready. Форматы совместимы, общая quiescence не нужна; сохранены обычные условия Plugin Updates и исходный `packRoot` текущих попыток.
- Проверки Claude на полном наборе Idea, Research и Discovery до PR, установка обоих хостов и живая приёмка после вливания принадлежат оркестратору; их результат фиксируется отдельно от локальных проверок пака.

<!-- fragment: MONO-201 sha256:6b8d1d315c0169c13bad7f7c7ad6a08a8d4266a8514927881c2908ae496beb07 -->
Исправлена проверка записи «да» в Idea: `record` сохраняет комментарий без завершающих переводов строки, а `verify` допускает их срезание Linear. Любые другие различия в тексте по-прежнему отклоняются; формат записи, снимок, отпечаток и проверка запуска работы не меняются.

<!-- fragment: MONO-203 sha256:b48b3d59e7719fabc8fe5c729ed9e95468e914f8c99665851520923ef1196c6f -->
Этап Idea ведёт разговор как менеджер проекта у основателя: первое сообщение сразу пересказывает идею словами владельца и называет срок, план из 3-4 шагов словами идеи, ни одного ожидания без строки статуса (в Claude Code его держит фоновый будильник). Разведчики работают в фоне, первая находка и ранний вопрос о маршруте приходят до итога по коду; картина связной речью без подписей, варианты с ценой один раз в карточке и свой выбор, агент прямо говорит, если делал бы иначе. Название проекта до «да», в Linear до «да» ничего не пишется, после «да» одна строка, финал и сразу исследование: «да» на описание включает его старт. Запись готовится, пока владелец читает описание; показанная версия становится одобренной только после «да». `record --notes` работает и до «да» и предупреждает о длинном тире и путях, которых нет на ветке из ссылки; вне репозитория отвечает `"paths":"unchecked"`. `verify` принимает выгрузку только нужных полей и комментарии без тела, если это не запись «да». Формат записи, снимок, отпечаток и проверка запуска работы не меняются.

## [0.33.0] - 2026-10-18

<!-- fragment: MONO-175 sha256:c0247603f8b3bbd1b8af508fea7479cf3d763712ef9b4e1c6140c31b17706147 -->
### Added

- Research snapshot validation before dispatch attempt registration: the package approval must name the document, its `mono-research` fence must match the Project and carry an allowed outcome and required reason. Extra fields remain compatible with the live Linear probe.
- Optional `researchGate.since` UTC cutoff; projectless Issues and earlier approvals pass without `research/`. The default remains dormant at `2099-12-31` until MONO-178.
- CLI, configuration and dispatch fixtures, including unchanged live-probe fence bytes and refusal without attempt consumption.

<!-- fragment: MONO-177 sha256:6c01b7d47aae5f1aefb33328edf20f8b7499c0439b1257bbe86abd1a2660cf68 -->
- MONO-177: add the Russian Research stage, web scout, raw-Linear fresh idea check and routing from Idea through Research to Handoff; carry Research unknowns and document references into package approval; expose the dormant Research cutoff for text-stage references.

<!-- fragment: MONO-178 sha256:de810c117f13be5762f15df3b27a08d67fb538ff3cc13c57d464ade319527eac -->
### Выпуск и обновление

- Выпуск 0.33.0 включает Research после Idea: факты, документ «Исследование» и совет без вопросов владельцу. Проверка Research включена с `2026-10-19` (00:00 UTC), первого полного дня UTC после выпуска; пакеты, одобренные раньше, и задачи без проекта проходят без исследования. `researchGate.since` позволяет сдвинуть отсечку для продукта.
- Версии плагинов согласованы; README и инструкция установки описывают совместимость форматов и прежний порядок Plugin Updates. Текущие попытки продолжаются на сохранённом `packRoot`; общая quiescence не требуется.
- Проверки покрывают границу UTC, отказ `research-missing`, проход с документом и `not-required`, включая dispatch без переопределения даты. Проверки Claude до PR и установка с живой приёмкой после вливания принадлежат оркестратору.

## [0.32.1] - 2026-10-18

<!-- fragment: MONO-187 sha256:1cc17d84c18c4f60e40858e19ac45893d020c8896fb0acca717cf662c84ad733 -->
### Added

- Idea recording and read-back CLI: `record` prepares the three-section Project body and approval comment; `verify` consumes raw Linear project/comment pages and checks the exact expected comment before reporting «Готово». Notes remain outside the fingerprint.
- Read-only plugin agents `linear-scout` and `code-scout`, plus a host-aware `scout` model role and `helper --host` CLI; `idea-helper` remains unchanged.
- Byte-preserved live Linear probes from Claude Code and Codex, manifest checks, and recording/verification regression scenarios.

### Changed

- Accepted PR #186 fixes: `record` refuses extra sections or preamble before writing; `verify` requires actual request cursors in separate `comments-N.request.json` files and checks the full cursor chain without altering raw responses. Regression cases cover an extra section and a skipped, renumbered middle page. MONO-188 must instruct the Idea agent to save each request cursor alongside its response.
- Project template uses second-level headings, with three body sections in Idea and scope sections added by Handoff. Explicit contract change: PC-001 routes existing Idea Projects to `mono:idea`; PC-005/PC-013 define the three-section body and preserve old scope in approval notes. Contract SHA-256: `7f3faa082fcd224b9e1eb4ddb8ee7726e9f0d01b69dc1796f515b2e73fad4a62`; both direct consumers remain checked.
- Workflow validation checks the scouts' known frontmatter fields and host efforts. Pin classification: no editorial sentence pins removed; commands, closed codes and agent field names are machine tokens, agent instructions stay in prose with field/body skeleton checks. Only the named, manifest-checked captured Linear files are excluded from executable model-policy scanning; their historical discussion is fixture data.
- Offset the scout documentation within model policy: delivery reading is 98,341 bytes, below the original 98,366-byte corpus and the unchanged 98,373-byte regression guard. No test limits or expectations changed.
- Include plugin agents in shared, model-policy and document-schema scratch copies so the same agent checks run against complete package fixtures.

<!-- fragment: MONO-188 sha256:ea937774d5569f75a2a459a4036f49871184597262c3ec348b20ada9c049d2d6 -->
### Changed

- Rebuilt Idea from the approved Russian v7 draft: parallel source scouts, one meaning question at a time, owner yes to the shown description, verified recording before status changes, and Research next. The orchestrator runs Idea itself and shows its reasoned answers for owner approval.
- Made Idea checks consume `verify`, kept writing/recovery in the skill's own reference, and resolved script paths from the package root. Package validation uses the shared `scripts/russian-stages.mjs` list (Idea first) for Russian read tiers, the first-AGENTS exemption and conditional Project-contract reads, with explicit package-root and skill-local references; mandatory Idea reading is limited to about 20 KB.
- The next stage is Research (`mono:research`); while that skill is absent from the installed pack, the next step is `mono:handoff`. Research's follow-up removes this temporary fallback.
- A returned Project with unchanged description sections keeps its body, package and status; the owner approves all four sections, including Unknowns drawn from description and scout facts. A Project without those sections follows the normal stage: preserve its old text in notes and write the approved body, changing status only from Idea. Notes carry a one-line fact plus source link for Research.
- Added 10 positive and 6 negative Claude plugin activation evals, three runs at threshold 0.8. The orchestrator runs Claude-only checks on the final head; live stage behavior acceptance follows release 0.32.1.
- Corrected returned descriptions update the approved body only before package approval; packaged Projects stop before recording and route the body correction through Handoff artifact repair. Explicitly count both scout tasks: the four-file mandatory Idea corpus is 20,441 bytes (limit 20,480), with an actual file-set/byte-total fixture.
- Aligned the orchestrator fallback and Idea check/lifecycle return branches; unchanged returns prepare scout notes before recording. An Idea Project with a verified approval record resumes interrupted status completion without another owner yes only when the current request neither changes nor adds to the idea. Changed input follows the normal updated-description/owner-yes path.
- Codex scouts now read their own definition files first (without frontmatter), from absolute paths supplied by Idea; Claude plugin agents retain their own definition loading. Definition paths are pinned only in the subagent launch skeleton, outside the four-file Idea input set. The actual-set fixture enforces this ownership and the unchanged 20,480-byte cap.

<!-- fragment: MONO-189 sha256:faee696979dd3a1b95bdd1a8cebe0a2fbcdd739f45700582cd28ba652dadac46 -->
### Выпуск и обновление

- В 0.32.1 проверка записи «да» включена: отсечка по умолчанию `2026-10-18` (00:00 UTC). Запуск и сертификат без записи разрешены только проектам, созданным и с одобренным пакетом строго до отсечки. Проверки покрывают границу даты, отказ без записи и прохождение с записью, включая dispatch.
- Обновление сохраняет каталоги живых попыток; перед заменой — `before-update` по всем продуктам. `models.roles.scout` добавляется только после установки 0.32.1 везде; `idea-helper` сохранён до отдельной задачи после 0.34.0.
- Откат — закреплённый `v0.32.0` из маркетплейса после удаления переопределения `scout` и проверки ролей старым пакетом. `ideaGate.since` меняет классификацию, но не пины и receipt; попытка перезапускается.

## [0.32.0] - 2026-10-17

<!-- fragment: MONO-170 sha256:6e34dc285af768b4afd7778b96ef6db7c95261d28c4933a92d745aa9d68903f1 -->
- Add the snapshot-only idea gate with canonical text fingerprints, fresh/approved checks, project-bound approval cutoff handling, issue-only seam acceptance, configurable headings and live Linear regression fixtures. Integration gates and the release cutoff are deferred to the following Issues.
- Known limitation (d-004): inline code spanning multiple source lines in an idea section refuses `unsupported-format`; single-line inline code remains literal.

<!-- fragment: MONO-171 sha256:0d58ebe26947f7c59c54e535a96928b15437f4dd7a1b383cfa43aa571f625949 -->
### Changed

- Require a project-matching approved idea and verified package approval before orchestrator dispatch; refusals do not consume attempts. Preserve issue-only and pre-0.32.0 attempt compatibility.
- Pin the saved idea, selected record and canonical artifact digest through collection requests, signed preflight receipts and ship verification; amendments and resumes retain the original binding.

<!-- fragment: MONO-172 sha256:a1663cf7905417a2f78cc057acac6d53362d51dec0f6104015e72c9911e7f5c5 -->
### Changed

- Rebuild `mono:idea` in Russian: linked facts from a host-selected `idea-helper`, at most three meaning questions, explicit owner approval recorded and read back, then a verified move to Discovery.
- Require idea-gate checks at idea/discovery, handoff and implementation boundaries; migrate old discovery and refreshed ideas through the package approval touch.
- Add host-specific `idea-helper` policy defaults and project overrides with fixtures preserving other role routes; keep rebuilt-stage prose Russian and machine tokens English.

<!-- fragment: MONO-173 sha256:522652c3f7ac2c171f14e30656b532fada8671f36989f492a4fa4c6087855df1 -->
### Выпуск и обновление

- В 0.32.0 проверка записи «да» спит: отсечка `2099-12-31` позволяет проектам с одобренными пакетами запускаться и получать сертификат без записи идеи. Этап Idea уже пишет запись; проверку по умолчанию включит следующий выпуск. Продукт может включить её раньше через `ideaGate.since`.
- Сохранять `packRoot` старых попыток; выполнять `before-update` по всем продуктам перед заменой каталога. Чтение старых receipt не переносит попытку, а `ideaGate.since` меняет только классификацию.
- Добавлять `models.roles.idea-helper` только после установки 0.32.0 везде. Для отката сохранить и убрать переопределение во всех затронутых конфигах, проверить штатные роли старым пакетом и установить закреплённый `v0.31.1` из маркетплейса.

<!-- fragment: MONO-182 sha256:8e747eece861db6ca5c1b3c5b0913adc357d9cee420f1b4f09544edfb2c0f6e6 -->
- Use English stage names Idea and Research in the Russian Idea skill; keep ordinary research wording, workflow rules and required reading unchanged.

## [0.31.1] - 2026-10-17

<!-- fragment: MONO-165 sha256:1ba7194435ad93272f01929f9ac7db282955574d26e0c0d56b3707f1e5a6fba0 -->
- MONO-165: allow only tool-specific extra cache objects during release-tree comparison: Codex `.git/` and a regular `.codex-marketplace-install.json` with the full tag revision, and Claude Code `.in_use/`. Preserve comparison of every released path, type, executable mode, content hash and symlink target; reject all other differences.

<!-- fragment: MONO-166 sha256:4fdd8b7912323550a3309e211b789a5b40c0ad07211c2520b84271c76c0ccbad -->
### Security

- Limit validation CI to read-only repository contents, pin its GitHub Actions to
  full commits, and disable persisted checkout credentials.
- Check for GitHub Actions updates weekly through one Dependabot group.
- Document supported versions and private vulnerability reporting in SECURITY.md.

<!-- fragment: MONO-167 sha256:637aeec8034d75e56aa3832ee14c55c3abe82d0c0848d5f1faff5d99a0ad3631 -->
### Fixed

- Reject invalid issue keys before exported review-ledger reads, class-stop writes,
  and CLI decision-record reads. Keep `^[A-Z][A-Z0-9]*-[1-9][0-9]*$` unchanged;
  additionally quote the two interpolated regular-expression prefixes.
- Pass the collector timeout fixture's lock path as a Node process argument.
- Scan original line segments when removing comments from issue context, so a
  closed comment cannot synthesize an opener that hides a following marker.
  Cover both an ordinary line and the suffix after a multiline comment closes.

### CodeQL triage (MONO-167)

Numbers refer to `darkdepot/mono` GitHub code-scanning alerts, inspected on
2026-10-16. No alert is dismissed by this PR; the orchestrator owns closeout.
The CI permissions alert belongs to the separate CI issue.

| GitHub alert | Rule | Location | Disposition and evidence |
| --- | --- | --- | --- |
| #2 | `js/incomplete-multi-character-sanitization` | `resolve-issue-context.mjs`, comment-closing line suffix in `contentTokens` | **исправлено**. Input: `<!-- prior line` followed by `--><!<!-- x -->--` and a valid marker. Consumer: marker/section scans over visible tokens. Expected: the original comment closes; the next marker remains recognized. The scanner examines original segments once; the regression compares the complete context with the valid-marker result. |
| #3 | `js/incomplete-multi-character-sanitization` | `resolve-issue-context.mjs`, ordinary line in `contentTokens` | **исправлено**. Input: `<!<!-- x -->--` before a valid marker. Consumer: marker/section scans. Expected: removing the closed inner comment must not create comment state and hide the next marker. The regression compares route, approval and complete acceptance/verification oracle; baseline comparison also checks exit codes and fingerprints. |
| #4 | `js/incomplete-multi-character-sanitization` | `resolve-issue-context.mjs`, `isSubstantiveText` | **неприменимо**. Input: criterion, verification-step or section text, including fenced examples and comment-only placeholders. The sole result is a Boolean letter/digit test; consumers decide whether content is substantive. No stripped string reaches an HTML renderer or another comment parser. Expected: `<!-- TODO -->` and `<!<!-- x -->--` alone are not substantive; visible letters/digits count. Residual delimiter punctuation has no letters/digits and cannot execute or hide later lines. Existing empty/comment-only criterion and section fixtures exercise this contract; full resolver baseline comparison preserves their results. |
| #5 | `js/incomplete-multi-character-sanitization` | `validate-workflow.mjs`, `markdownHeadings` | **неприменимо**. Input: tracked Markdown from README and linked documentation. Consumer: `forEachMarkdownLine`, then anchored heading extraction, title/slug checks and link addressability. Expected: closed comments contribute no headings; visible headings retain their titles/slugs. This is structure validation, not HTML sanitization. `<!<!-- x -->--` leaves punctuation that matches no heading; the consumer neither reparses comments nor renders HTML. The heading-comment fixture and unchanged README checks verify the boundary. |
| #6 | `js/incomplete-multi-character-sanitization` | `validate-workflow.mjs`, README Owner Rules extraction | **неприменимо**. Input: tracked README Markdown. Consumer: `documentSection`, then anchored rule-ID/link/target validation. Expected: closed commented-out rules contribute no entries; visible Owner Rules remain checkable. Residual delimiters cannot become an anchored heading or rule. No HTML rendering or second comment scan occurs. The owner-rule-comment fixture feeds a residual opener to the actual section consumer and verifies that a following visible rule remains visible; README is unchanged. |
| #7 | `js/bad-code-sanitization` | `orchestrator-commands.test.mjs`, collector startup timeout | **исправлено**. Input: temporary lock-file path. Consumer: detached `node -e` fixture. The program is constant; the path is a separate argv value read through `process.argv[1]`. Startup timeout still terminates the child before it can create a late lock. |
| #8 | `js/regex-injection` | `decisions.mjs`, dataset version filename matching | **исправлено**. Inputs: CLI and exported journal/dataset APIs. `journalFile` already checks the unchanged key pattern before filesystem access on every path to version matching. Added early CLI validation before reading a decision record and literal regex quoting. Invalid-key scenarios trap filesystem access for all exported journal/dataset entry points and check every CLI command. Existing valid dataset reuse/versioning expectations are unchanged. |
| #9 | `js/regex-injection` | `review-ledger.mjs`, `belongs` | **исправлено**. Inputs: CLI plus exported `readLedgerSources`. Added key validation before its first evidence access, and before exported class-stop access; added literal regex quoting in `belongs`. CLI, `buildReviewLedger`, adjudication and withholding already validate keys. Scenarios trap evidence access for invalid keys and preserve valid receipt filename matching. |

No CommonMark compatibility or HTML sanitization guarantee is introduced. Existing
marker examples are compared against the original resolver for complete stdout,
stderr and exit code, including route, marker recognition, fingerprints and oracle.
Only the two documented synthetic-opener inputs may differ. Existing expectations
and contract fingerprints are unchanged; no machine-token pin was removed.

<!-- fragment: MONO-169 sha256:1bb1898e1b93ca066d769186a326533ca192f5166147056a8fb4b15b628f6f74 -->
### Fixed

- Replace fixed watcher-event startup sleeps with bounded output polling in the between-scan continuation regression. Confirm a completed scan and its delivered output before expiring the fixed continuation window; retain writer identity, the consumed acknowledgement and the quiet log when changing only `consumedAt`. Watcher behavior and clocks are unchanged.

<!-- fragment: MONO-181 sha256:5909236ad9ddfaa71c2ccd2b82036134b645b2097ce0be52debf341bee040409 -->
## MONO-181 — Quiet monitoring during commands and no-change wakeups

- Defer ordinary stall alerts for a live writer with outstanding Codex command executions or Claude Bash calls, tracking parallel commands independently. The fixed 60-minute allowance starts on watcher observation, resets on watcher restart, and emits one marked stall at expiry. Dead writers and protocol deadlines keep their existing behavior.
- Require continuous watcher-output monitoring throughout the wave; periodic wakeups are a recorded degradation. False alarms, already-consumed reports and empty wakeups produce no owner message or routine ledger entry; actual monitoring recovery and healing remain recorded.
- Continue bounded log catch-up without waiting for regular interval ticks, so quiet history does not delay ordinary stall alerts by one interval per chunk. Retain only a bounded prefix and file position for unfinished records; completed records still use native JSON parsing to match command IDs after large output.

### Known limitations

- The 60-minute ceiling is a best-effort diagnostic, not a precise execution deadline. Observation, bounded log scans and watcher restarts can affect its timing; no command timestamp is recovered from the journal. A hung command that keeps writing heartbeat/progress events still has a fresh log and remains outside this change.
- When one command ends and another starts between watcher scans, the later command can inherit the earlier observation time or already-alerted state. Its ceiling alert may therefore be early or absent until observation resets. This is accepted as part of the best-effort timing diagnostic; ordinary no-command stalls, dead-writer checks and protocol deadlines remain required.

## [0.31.0] - 2026-10-16

<!-- fragment: MONO-159 sha256:41d1020d1b4c597e68c979ab1fdba94d3a8f6705bd85ae3a448761facf608be2 -->
- Emit watcher events for every changed phase report and select confirmation waits by publication time. Record an atomic persistent-watcher pulse each tick, preserve it during one-shot scans, and require a fresh, live matching observer before worker launch or resume, without consuming attempts on refusal.
- Prepare the evidence directory and immutable default review dataset at dispatch; preserve existing archives, digests and explicit dataset versions. Document session restart and observer supervision boundaries.
- Recheck the observer in the shared locked launch path, record possible amendment delivery only at the actual spawn boundary, and clear it on failed process creation. Refusals remain retryable while indeterminate launches retain duplicate-launch protection. Reuse sparse immutable dataset histories without creating v1 beside later versions.
- Wait for the interrupted resume process to exit before removing its fixture lock; retain the dead-holder and unchanged-lock proofs, including delayed child teardown.

<!-- fragment: MONO-160 sha256:ad91b9d8c4e66a6118a680f374aa0fd6bb9660591c6390ee832db39cd4ebc41c -->
- Bound collection runs and retries to the attempt's publication deadline; terminate and verify process groups, preserve retry counts, and recheck class/cap without another admission.
- Reconcile signed receipts without rerunning reviews; retry project verification once with both outputs signed, preserving sandbox and head/base refusals.
- Pin collection timeout/retry settings, align Mono's confirmation window, and remove fresh executable startup timing from short confirmation fixtures.
- Isolate process-table observers from the gate group so successful collection/reconciliation clears its watchdog; cover self-observing telemetry and collector death.

<!-- fragment: MONO-161 sha256:731bac27d0aa0f69897a3e4bf4b12bcabb5c9ff484667378270702ea26245f35 -->
# MONO-161

- Unblock mixed confirmation queues: reuse verified same-attempt confirmations without applying their writes again, and collect after all new connector writes have present observations in the active report session.
- Reject collection identifier reuse for another report at publication and mailbox acceptance; keep lost-response retries idempotent.
- Return one `accept report` response object and identify the violated observation-time boundary.

<!-- fragment: MONO-162 sha256:b4de2d1904ef28f0cf17ccb3a3575bc2b87dc1ebdf232668e2c8ac079a66305b -->
- Validate green ship certificates at publication with the same issue/head/PR check used for landing; landing still requires confirmation.
- Pin required PR bot checks from `orchestration.ship.botChecks` (default Greptile Review). Only an orchestrator `accept amend --bot-unavailable` decision for the current task attempt can waive unavailable bot evidence; worker policy cannot weaken it.
- Document authorized ship fixes using the next named ship-gate attempt and a new state file in the same task attempt, preserving prior state without changing evidence windows or review strictness.

<!-- fragment: MONO-163 sha256:3ca31f71baf6f8cc058f0b8891fee8a57a72a6a73b85a12b86922b8b750538c5 -->
- Release 0.31.0: a **breaking pre-1.0 minor** because worker launch and resume
  now refuse with `watcher-required` without a fresh live watcher. Activate only
  after cross-product quiescence; each product's orchestrator confirms its own
  state. After installation and cache verification, restart each watcher from
  the new version before the first launch or resume.
- Decision journals, signed receipts and surface revision 4 remain unchanged
  from 0.30.1. New `watcher.json` and collection retry files are ignored by
  0.30.1. Open attempts finish on their original pinned `packRoot`; do not replace
  a used folder. A staged cache can coexist until activation. Roll back to
  0.30.1 in both tools after outgoing attempts finish, preserving evidence,
  dispatch pins and history and restarting the old watcher.
- Operator settings: `orchestration.delivery.collectionTimeoutSec` defaults to
  1500 seconds, `collectionRetries` to 1 and `confirmationTimeoutSec` to 1800;
  configure before dispatch with `collectionTimeoutSec < confirmationTimeoutSec
  < evidenceLimitSec`. One deadline covers collection through confirmation.
- Required PR bots come from pinned `orchestration.ship.botChecks` (default
  `["Greptile Review"]`). Only the orchestrator may record an outage for the
  current attempt with `accept.mjs amend --bot-unavailable "<reason>"`; workers
  cannot disable the requirement. Review strictness is unchanged.

<!-- fragment: MONO-164 sha256:028e5c3ef074bc0116846c784f2b3e5f1b2850f2e179a9986244068eb207de53 -->
- Keep denied process-group probes unknown while waiting for the collector watchdog within the existing deadline; require group, leader and descendant termination, and preserve the primary failure separately from cleanup diagnostics.
- Make collection retry telemetry propagate non-ESRCH probe errors; cover refusal to retry live or unverified groups, real surviving descendants with watchdog termination disabled, and cleanup failures that must not mask the scenario assertion.

## [0.30.1] - 2026-10-15

<!-- fragment: MONO-157 sha256:1f7f4b0e4bcdc92473c616f48e400980326efeaf1fa68c611b046fca4995b9b8 -->
- Recheck repeated review keys/classes when replaying an unexecuted collection admission and immediately before collection; preserve completed receipt reconciliation without a reviewer rerun.
- Add named late-class/key replay, direct-execution and completed-collection fixtures, plus the rollback procedure for a separate 0.29.0 journal view and fresh clean review.

<!-- fragment: MONO-158 sha256:b283489eebebe94bc8eb2967d26f0c8d1077423afde75b582e5a55e0588d99b7 -->
- Release 0.30.1 with the repeated-class collection admission fix and journal
  rollback procedure; assemble the task records and align the pack, plugin and
  README release versions.

## [0.30.0] - 2026-10-15

<!-- fragment: MONO-152 sha256:34004798a8f49983eddccec56da88fb010d50a7ae7100e81ac2aa3b008aab653 -->
# MONO-152

- Accept completed review findings through exact, evidence-backed orchestrator
  declines; re-read revocations for preflight and ship without rewriting receipts.
- Review committed worker bytes, list approved declines in readiness certificates,
  and count decline events separately from reviewer executions.

<!-- fragment: MONO-153 sha256:1c8e08ef60580be4e7e311245f6bb628e04f39a59c9c5f3fe19bf417b36a3e96 -->
- Stop repeated finding keys or recorded classes before another review collection; orchestrator class decisions resume the same withheld request. Require bounded whole-class fixes or verified behavior limits, and keep workers within simple Issue-scoped mechanisms.
- Preserve class stops for symlinked worktrees and pinned Issue identities; share the withheld-history lock across admission and manual recording.

<!-- fragment: MONO-154 sha256:52aae8978207cdef1e8c3312aed9de1b3ae44b606094a7fcefe8336646e68e60 -->
Review limits now park automation after two blocking external reviews or two local
passes. Chain counters survive commits, attempts and orchestrator-authorized
successors. Bounded continuation decisions use atomic, idempotent reservations;
they never admit unresolved defects.
Collections require pinned requests and correlated admission. Unpinned legacy
collections are refused. All pending admissions count on reservation and recheck.
Local stops withhold the
queue until continuation; a clean second pass keeps the normal collection flow.
Receipt issue/pins identity preserves chain counts across worktree changes;
anonymous historical receipts are ignored by scope decision.
Stable local pass IDs prevent cumulative reports in new attempts or successors
from counting earlier passes again. Internal-pass ledger events retain clean or
findings outcomes.

<!-- fragment: MONO-155 sha256:491721d58b03794029eb244b13b544be0d3cb6841bde5365af6f321563128a42 -->
- Pin the external autoreview helper source and installation proof; test current upstream status/report output through clean and approved-decline gates.
- Split expected changes above roughly 1,000 lines in critical paths during handoff; retain the worker reading ceiling and existing model policy.

<!-- fragment: MONO-156 sha256:700b1970853175d021d64eebbe56fd562744a7bf2d3aea830902e315949a422c -->
- Release 0.30.0 with evidence-backed review declines, repeated-class stops,
  bounded review automation and current autoreview compatibility; assemble the
  task records and align the pack, plugin and README release versions.
- **Incompatible update:** review journal and collection admission formats change.
  Install 0.30.0 only under cross-product quiescence: stop launches and have each
  product's orchestrator confirm idle control and an empty worker registry before
  cut-over, then restart sessions. See [Quiescence](references/install.md#quiescence).

## [0.29.0] - 2026-10-13

<!-- fragment: MONO-148 sha256:b6018a13929b4edcb1cd26694605774daebf0f097fc5550b980e9313616b2736 -->
### Added

- Publish GitHub release pages from the version tag's changelog section after validating the pack and both plugin versions; existing pages remain unchanged.
- Document installation and updates from main for users without an orchestrator, including moving a tag-pinned Codex marketplace to main and the possibility of merged, unreleased changes.

### Fixed

- Correct Codex marketplace upgrade guidance while preserving the orchestrator machine's release-tag, update-condition and installed-cache verification procedure.

<!-- fragment: MONO-149 sha256:c8d8a709e6ca197ad00e37af5a679c63683020ee58f9eb0771c16f11d0554c79 -->
### Changed

- The orchestrator runs on its owner-selected launch model and reports the authoritative model or «не удалось определить» without a policy verdict. Second Voice independence and other role routes remain unchanged (MONO-149).

<!-- fragment: MONO-151 sha256:b5a43dcc3a60c6283332fc10aa6ee820e7aa87e1ecbf5fe85d2402f6a1e68619 -->
- Release 0.29.0 with the owner-selected orchestrator launch model, automated GitHub release pages and user plugin-update guidance; assemble the task records and align the pack, plugin and README release versions.

## [0.28.0] - 2026-10-12

<!-- fragment: MONO-142 sha256:cfbbc9b6faa59c4a254a78475e31000f8ff704a08ac341d42781a71683fab19c -->
- Named Claude Code as this repository's backup worker while keeping Codex as the primary; switching requires the orchestrator's decision for a documented reason.

<!-- fragment: MONO-143 sha256:d1f5d047cf89913a79d585b27aff93232c2821d4d84948b6a3c12901e266fd60 -->
- Isolate the managed Claude CLI config test from the repository's backup worker setting, preserving the validator and explicit primary/backup pair checks.

<!-- fragment: MONO-145 sha256:c9ad4bd37fcbd3f0902c1d0e40065ce70dd05b13e7d0788d0e6f873cbfb7b78b -->
- Isolate launch fixtures from the repository's backup worker setting, preserving launch behavior and explicit backup route tests.

<!-- fragment: MONO-146 sha256:919a50b1a937e45ad5946b1e37fc15348c9bc67fe248e582fc72d6c4677c7210 -->
### Fixed

- Backup worker switching now ignores unrelated host processes and other tasks' collectors while refusing live remnants identified by captured groups, ancestry, an inherited per-attempt marker or exact attempt paths. Retained snapshots and stop proofs remain mandatory; unavailable marker reads without another trace are counted in launch evidence under the accepted residual risk.

<!-- fragment: MONO-147 sha256:060f5d7ddd74c327946a279d5e96848641800a50d612d042888c89a0b9d9d26c -->
- Release 0.28.0 with the repository's named backup worker, isolated configuration and launch fixtures, and previous-attempt process ownership checks; assemble the wave's task records and align the pack, plugin and README release versions.

## [0.27.0] - 2026-10-11

<!-- fragment: MONO-132 sha256:d98a01fa8cbf8de93478200f31db63efd66092c91cc446b5c43dea196cb04cf4 -->
- Document how a product chooses its delivery worker with one setting, how Claude Code differs from Codex and a worked selection/return example, state the Claude Code installation requirements, and return this repository's own worker to Codex.

<!-- fragment: MONO-133 sha256:1cfe2a7ab5a4d299d818adc99279fd10fd871a85e0b8395ab43c44120954d8de -->
- Allow projects to name a backup Codex or Claude Code worker. The orchestrator can open one new attempt only for subscription exhaustion or persistent provider refusal after recovery, with pinned journal evidence, unchanged reviewer and rights, quiesced and stopped previous processes, reconciled process ownership (including detached descendants) and the existing gates and attempt limit.

<!-- fragment: MONO-134 sha256:b72ec7963990877d0066da941b6494cfea041246616392d74984ba6e5df4d6b9 -->
- Release 0.27.0 with the worker-choice guide, the return of this repository to Codex, the backup worker and managed Claude Code permission fixes; assemble the final wave's task records and align the pack, plugin and README release versions.

<!-- fragment: MONO-139 sha256:a16a271c0a717858d7605dc8e6c18ddb270488e996e984420462b41d228b612b -->
### Changed

- Re-enable Claude Code for this repository's second acceptance attempt on installed release 0.26.0; the orchestrator pre-applied the transport setting, and README now identifies the second acceptance window (MONO-139).

<!-- fragment: MONO-140 sha256:9a4f7bc24eb52482b4d257d7d720e14e787d626871e23f3e07996c25f067c0b0 -->
- Keep the managed-worker journal identity hint out of the credential-redaction fixture's child process, so the full pack verification is green inside a managed Claude Code worker; the instance marker stays covered by the existing startup-ack and same-session resume test (MONO-140).

<!-- fragment: MONO-141 sha256:ce571ad1e9f9a10333313ece00aceece190a057e8882c1a0f8cbd3c002190ea8 -->
- Explicitly allow the GitHub CLI `gh api` command family and direct Read access to the two pinned pack and skills roots in managed Claude Code launch and resume settings, keeping credential, write and web-tool restrictions unchanged. Real permission acceptance remains pending the orchestrator's post-release probe (MONO-141).

## [0.26.0] - 2026-10-11

<!-- fragment: MONO-131 sha256:dd7d472d9b2d63ecb3dd653d4b628aa9864db7acc26ec546f93e31f041972d2a -->
- Select Claude Code for this repository's acceptance window through the orchestrator-pre-applied transport setting, and name the temporary selection in README.

<!-- fragment: MONO-136 sha256:713d8ac761c79af15e26d04af68b7182d23cff746b5c0b25b67ba0059ce9847e -->
- Return this repository to the Codex worker on main by the orchestrator (emergency return under the owner mandate after the live acceptance parked on Claude Code sandbox defects); README wording stays with the acceptance task.

<!-- fragment: MONO-137 sha256:606a8954a69c66f937220b21109c545643d9a56e503ee19b451108fd86fb7e2b -->
- Preserve Claude Code sandbox proxy parameters only for gate base-branch fetches with the existing managed-worker hint; keep all other Git environment filtering unchanged.
- Skip nested macOS sandbox host proofs under that compatibility hint and isolate Claude launch fixtures from real GitHub credential paths, with launch/resume and environment regression coverage.

<!-- fragment: MONO-138 sha256:59f1a906b8a148b8aca63031e6681442c0036bc8562f5ccc344ba5e1e5dd1a95 -->
- MONO-138: release 0.26.0 with the Claude Code sandbox fixes and the emergency return of this repository to Codex; assemble the interim wave's task records and align the pack, plugin and README release versions.

## [0.25.0] - 2026-10-06

<!-- fragment: MONO-127 sha256:96c657b85ab2bf3e8decd63ba96a452c790b2dad2851a453b12e21a07b5a8f92 -->
- Extract the worker transport seam with one `codex-cli` implementation for launch/resume, startup identity, waiting-command proof, liveness and usage. Keep Codex delivery behavior and existing attempt records unchanged.
- Report missing worker usage as unavailable and interrupted attempts as incomplete; mark their wave totals incomplete instead of treating absent usage as a measured zero.

<!-- fragment: MONO-128 sha256:cdb6cc0b859ddc20243a86732beb1914126132a4431a1dcbaaf533f770be0c85 -->
- Add managed Claude Code launch and resume with pinned sessions, subscription-login checks, canonical write grants, closed settings and connector sources, restricted network tools, credential-safe logs, and explicit startup refusals. Existing Codex delivery remains the default; full Claude delivery follows separately.

<!-- fragment: MONO-129 sha256:732d7248a1c0494b26a9279782045dba63409f64e550aa1d838f877aa9d0abd2 -->
Managed Claude Code delivery now supports stop/resume startup acknowledgement,
foreground phase and collection waits, attempt-correlated reports, watcher
liveness and completion without a report, and honest per-turn token accounting.
Dispatch, launch records and ready certificates disclose external-only committed
review and the startup difference; credential values must never be printed.
Codex delivery behavior is preserved. Live confirmation and collection probes
remain the orchestrator's closeout verification.

<!-- fragment: MONO-130 sha256:9ad1558aecfd51b8720512750c25f5612ed149062835694acd60a74b2b38989b -->
- MONO-130: release 0.25.0 with managed Claude Code workers, assemble the wave's task records, align pack and plugin versions, and update the README's supported worker transports.

<!-- fragment: MONO-135 sha256:617f6074f75ec7ae69a443cb42d108f4c5c98b858256fb6f86e047ae10f12e4d -->
- On macOS, allow sealed collection verification to write under the resolved Darwin user temp root so SwiftPM and Apple tools work with `swift test --disable-sandbox`. Reject overlap with protected evidence, orchestrator, skills, pack and helper paths; retain the evidence write-denial probe and private `TMPDIR`.
- Isolate macOS autoreview's private results under `~/.mono-agent-workflow/review-tmp`, outside verification and worker write grants, with no Darwin grant. Cover surviving verification descendants with portable and real sandbox fixtures; preserve a known non-clean review after denied artifact writes. The existing shared worktree exposure is unchanged.
- Add portable grant/overlap/receipt fixtures and explicit host-only macOS atomic-write and SwiftPM proofs. Stabilize existing collection fixture timing while retaining HTTP-error, pending and deadline assertions. Other platforms and receipt/contracts are unchanged.

## [0.24.0] - 2026-10-05

Breaking: the local installer is removed; use the marketplace plugin and calls such as `/mono:idea` instead of the old `mono-*` skill names. Existing task stages and certificate markers remain compatible.

<!-- fragment: MONO-121 sha256:ea3ccfbe6ee2c632ba55ab44ca4dbe0f1e2a6feb3d019e21ef09227b2b09dd53 -->
### Changed

- Mono now uses only the repository-shaped plugin layout. Installation and compatibility share a short guide; deployment requires plugin proof in both tools and a completed machine migration.

### Removed

- Retired local installation code, its identity state and operational checks. Delivery fixtures use isolated plugin trees; compatible continuation, update protection and product-repository cleanup checks remain.

<!-- fragment: MONO-122 sha256:7d2468db7141fa2bc3bf4287a54358b6f657bdf0ee5e109e0aa4b6c51c47e041 -->
### Changed

- Renamed all eleven skill directories and names for plugin calls such as `/mono:idea`, `/mono:ship`, and `/mono:review`. Updated current instructions, paths, pack checks, and four explicitly revised artifact contract fingerprints.
- Kept persisted stages, certificate markers, issue-only markers, attempt/session names, temporary prefixes, product config/state paths, and historical records compatible with their existing values.

<!-- fragment: MONO-123 sha256:0963e80c9c5f58c0a4431081a6bd3518a81f5ec22ffc325cc06e654a0d85d973 -->
- MONO-123: release 0.24.0 with the retired installer and plugin skill names, assemble the wave's task records, and align pack and plugin versions.

## [0.23.0] - 2026-10-03

<!-- fragment: MONO-117 sha256:e0905d65c4ffb9fe830bbe911f5968ce8ae22d80dbfe9d4a66155049bf9151af -->
- Allow worker resume and start gates after compatible pack updates by comparing only `surfaceRevision`; incompatible surfaces name a new attempt as recovery.
- Emit `phase-rejected` watcher events for foreign phase-report identity while preserving strict report-to-task matching through a shared identity-field constant.

<!-- fragment: MONO-118 sha256:ec7bae64df40330fed34a000df8ffc4f9c2935f6aebd9226627a3bf0dfa56d14 -->
- Package Mono as a Claude Code and Codex plugin alongside the legacy installer. Pin each attempt to its pack folder, separate external review helpers, and check all products before an update replaces a folder in use.

<!-- fragment: MONO-119 sha256:02a09593e95d8bf79f81c7010f076eae3661d2fbcc42bd53ee4e6350cb6c43de -->
- Prepare the one-time migration from the local installer to plugins in Claude Code and Codex. Document per-product migration conditions, exact legacy cleanup, release-tip source checks, updates that wait for attempts using replaced folders, and installation proof by version and tag before wave close.

<!-- fragment: MONO-120 sha256:d00b78036364c944f49b73aa71dff43049ce614b95712b7c2e7f50069f83a2c2 -->
- MONO-120: prepare release 0.23.0 for the first plugin installation and machine migration, assemble accumulated task records, preserve an empty Unreleased section, and align pack and plugin versions.

<!-- fragment: MONO-124 sha256:55817bb51b251b51c4f25d56b5a8561663d3cc72e8d2058c7df8230b6ef06a33 -->
- List registry entries without a pack root as unknown before plugin updates, continue checking other products, and retain refusals for blocking attempts or invalid registry data.

<!-- fragment: MONO-125 sha256:dc259df4fc5c9ddd288947030726d5ca715db094c7a6a932b74cb0d76d96e007 -->
- Install and update Mono from the GitHub marketplace repository: Claude Code refreshes the marketplace and plugin, while Codex pins each release tag through re-registration. Verify each installed version cache against the landing tip's Git tree before closing the wave or resuming tasks; document migration rollback from a Git checkout at the first migration release.

<!-- fragment: MONO-126 sha256:210f698d799796439c97025a11dd6379a297e611498bdf977358e9a06087f5ac -->
- Select the skill-pack deploy live pass by machine installation state: check the legacy installer before migration, use plugin installation proof after both tools migrate with clean recorded skills roots, and block closeout for incomplete migration.

## [0.22.0] - 2026-10-03

<!-- fragment: MONO-107 sha256:6a043c0974110d08f39cc16fd00982feb8e790b6ac6276fcb61a654406aa67ad -->
- MONO-107: assemble task changelog records in key order during release, preserve
  existing notes, preview without writes, and recover interrupted assembly using
  per-record SHA-256 markers. Mono task branches now leave records in changelog.d;
  CHANGELOG.md and VERSION are reserved for the orchestrator's release task.

<!-- fragment: MONO-108 sha256:c530a0e86e3c275ef3bf041bde8e3f6d8f2eda06535fb7b685eebf8a5d6d23db -->
- MONO-108: require successful validation of the exact landing commit before the next ordinary merge or installation; report pending and failed checks with a fixed deadline and record an explicit exception for a corrective Issue.

<!-- fragment: MONO-109 sha256:83d6c3149270c08c1f6a44e400f47ad306153b206786090a5bc2627a1edb6321 -->
- MONO-109: install the pack once at wave end, after all registered tasks have
  landed and their workers stopped. Preserve merged-task records through failed
  installation and close each task with proof its merge is in the installed version.

<!-- fragment: MONO-110 sha256:d7ac0e1b51dc6ed4d78d23e55b2ea48240da9aae1ffab17ff8a2011b631dd870 -->
- MONO-110: add an advisory landing observer, deduplicated PR head and force-push accounting, and shared scheduling rules for parallel task waves.

<!-- fragment: MONO-111 sha256:1989c2826dd723074dcea89498afce0c228bc12bf26ea0a6a59d0b64da109fc7 -->
- Clarify fresh-attempt liveness checks: verify the registry PID and process start time instead of searching process arguments for a transport thread ID.

<!-- fragment: MONO-112 sha256:9f8673fc8a7ce4f5f2d10ca12e06a714f9950fb31dabb15c11bb3921685e8ef2 -->
- Orchestrator command test fixtures track their own live worker PIDs, retire completed launches, and wait for process exit during cleanup, including resumed workers. Regression checks cover delayed termination and a child exiting before readiness.

<!-- fragment: MONO-113 sha256:f33c5e935577a7631ed96d01b8e194df3326680103d9776023bdaa99b09217ff -->
- MONO-113: document a timed landing-policy onboarding walkthrough, migration of
  shared release edits, staged configuration and version choices for products
  that release every merge.

<!-- fragment: MONO-114 sha256:463df2c65dc2fea0654b1bfadbbeda3e557631a7cdab7d96d344eaad34e03669 -->
- MONO-114: prepare release 0.22.0 from accumulated task records, preserve an
  empty Unreleased section, and update the canonical pack version.

<!-- fragment: MONO-116 sha256:ea25f9bdab96657ef8ddc2b0a967e3f36221787e256d71bf8e5897c69c064e3a -->
Landing records now accept green ship certificates whose PR field contains a number (with optional `#`), GitHub URL, or matching number and URL, including slash, comma and Markdown-link forms. Conflicting numbers, repositories and unrelated text are refused without changing pending installation records or the landing ledger.

- MONO-106: validate optional landing policy, reject task edits to shared paths
  before review using immutable base policy and merge-base diffs, and reserve a
  single pinned release task. Add dispatch landing facts, a config example and
  one canonical operator reference. Mono's own policy remains unconfigured.

- MONO-105: admit amended collection requests by their pins.file version without
  a phase-report version field; stale bound requests name the full expected path.
  Clear the conservative launch marker only for the identified pre-spawn refusal
  of a live wait worker after locked state checks, restore grants and allow the
  same prepared retry after exit. Preserve uncertain-launch evidence, prior
  admissions, legacy behavior, receipt contracts and U14 attention keys.

- MONO-103: complete the first live `.agents/` pre-application check under the
  owner's mandate (AE12). The orchestrator committed this repository's delivery
  confirmation window change from 1800 to 1200 seconds before start gates; the
  worker verified and preserved the config and aligned the test pin. Pack behavior
  is unchanged.

- MONO-104: replace pre-application tables with path/sha256 list items; accept
  Linear nesting and blank lines while preserving raw bytes and whole-manifest
  refusals before application and attempt registration.

- MONO-101: apply approved `.agents/` manifests by recorded owner mandate before
  dispatch start gates, with exact UTF-8 hashes, commit/ledger evidence and
  idempotent retries. Materialize covered Tech Spec manifests through the U12
  tree; reject unsafe/malformed input before spawn. Verify staged bytes, support
  approved ignored targets as literal paths, and restore original ignored bytes
  on pre-registration rollback. Reuse requires current-head blob proof; hold the
  launch lock through application and registration. Workers verify and preserve
  these files; repair/renewal requires a new dispatch. Gate/receipt/pins and
  bounded artifact contracts stay unchanged; mandate bootstrap and live rollout
  remain separate orchestrator actions.

- MONO-100: persist collector admission refusals once per report digest and
  current registry pins version in the attempt's attention file. Retry only
  when that pair changes; admission of the current collection-only preflight
  report clears the exact file, including attention for a replaced report.
  Add named fixtures for restart, retry, replacement, cleanup and lock errors;
  admission rules/reasons, receipts, locks and polling interval stay unchanged.

- MONO-99: bind worker collection requests to registered pins and dataset
  digests under U13, reusing admission comparison without gate-side writes.
  Emit `pending` (exit 2) with `publishRequest` before collection; preserve
  legacy receipts and optionally sign/verify the pins binding in gate/history
  checks. Render the pinned request in dispatch and keep the worker corpus
  within its prior budget. Receipt envelope/signature, admission shape and
  history-before-head publication are unchanged.

- MONO-98: parse snapshot documents into a block tree before selecting definitions
  and transitive coverage under U12. Keep fences and other opaque markup out of
  coverage; unknown IDs refuse before duplicate/unclosed-fence fallback. Add
  named contract and MONO-95 fixtures plus pre-change package-byte baselines,
  verified through scratch dispatch; identifier grammar, common sections and
  delivery reading budget remain unchanged.

- MONO-97: unify amendment recovery under U11 with prepared/delivered/registered
  states, saved per-version inputs, ambiguity candidates and immutable recorded
  snapshots; partial snapshot staging reserves its version. Correlated delivery recovers registration without another launch;
  historical retries preserve current pins and grants. Record the conservative
  launch boundary before resume: uncertain delivery preserves evidence and
  refuses restart/replacement, while proven nondelivery restores original grants.
  Amendment outputs include version/state/reason; report outputs include
  `writeDigests` for expanded writes without changing the write objects. Add
  installed scratch fixtures, including interrupted launch-boundary cases.

- MONO-96: install the per-attempt orchestrator collector with start/stop/status,
  empty/collection-only queue confirmation and signed history-first recovery.
  Bind recovery to admitted pins versions and actual receipt fields; reconcile
  mutable head receipts under the existing per-head lock without another review.
  Locks retain process incarnations; exclusive reclaim markers permit takeover
  only after isolated holder/gate process trees are dead. Live/unknown locks and
  connector queues stay with the orchestrator; gate semantics and receipt order
  are unchanged.

- MONO-95: install orchestrator dispatch/accept commands and the pack Linear
  adapter. Dispatch renders the single template, pins launch identity, extracts
  exact referenced snapshot definitions and refuses before registration on
  gate/input failure. Accept validates ack before plans, binds dated read-backs,
  reconciles report writes through fresh digest-bound sessions, and registers
  amendments/admissions under one lock. Printed apply instructions never count
  as success. Pins become current only after successful resume, empty queues
  confirm after session setup, and extracts stop at any peer ID definition.
  Interrupted amendment registration resumes from durable pending evidence
  without launching the worker twice; failed launches restore undelivered grants.
  Retain completed amendment evidence after pending cleanup, and rebuild refused
  dispatch snapshots from the current inputs without superseded files.
  Replacing an undelivered pending amendment preserves its original grant rollback.
  Keep earlier completed amendment results across subsequent successful amendments.
  Issue-only snapshots require a nonempty scope fingerprint before preparation.
  Scripts never write to Linear. Add installed scratch command and
  source-document extraction fixtures; retain worker corpus, core contracts and
  existing spawn/resume/consume/delivery-state request shapes unchanged.

- MONO-93: add bounded in-place gate-ack waiting, live-writer consumption,
  handshake/profile/pins registry fields, shared stall/ack clocks and finite
  post-consumption watcher continuation. Short tiny/standard deliveries may
  skip the local helper pass and put start facts in the ready-comment lead;
  targeted checks, commit, certifying collection, queue confirmations and
  existing gates/legacy consumption stay required. Update rules and fixtures
  without worker-corpus growth or new reading edges.

- MONO-89: pass `USER` and `LOGNAME` through the reviewer-bench environment
  allowlist so Claude Code can find its macOS Keychain login, while keeping
  provider credentials and other undeclared host variables isolated.

- MONO-88: add the experimental Grok 4.7 reviewer-bench route through Grok
  Build subscription login only, keep it tools-off, reject every Grok credential
  mapping, and document that historical frozen helpers cannot run the route.

- MONO-85: replace key-backed reviewer bench routes with six Claude Code and
  Codex CLI subscription routes, require recorded subscription-login evidence,
  and add plan-scoped tools-on/off protocols. Tools-on admits Codex without
  `--no-tools`, preserves `--no-web-search` with its documented cache-search
  limit, keeps Pi tools-off only, refuses frozen-plan overrides, and separates
  common and production report groups without disclosing protocol to graders.

- MONO-87: replace consumer-specific examples and template text with a fictional
  neutral product, remove the owner identifier from the pack config, disable its
  issue-only lane, and preserve fixture coverage through machine-token and
  structural checks.

- MONO-84: increase the confirmation default to 1800 seconds with a shared
  configuration check that keeps it below the evidence limit; make adjudication
  replacement key off `eventId`; add current, reasoned matrix waivers; and
  document amendment-before-collection ordering and late-collection recovery.

- Add per-product model role overrides with engine/transport and effort validation,
  bound producer/reviewer decisions, and immutable BASE route fingerprints through
  dispatch, collection, receipts and launches. Isolate invocation provider variables,
  preserve legacy receipt checks, and update policy references by displacement.


### Changed

- MONO-81: add an installed reviewer comparison bench and default candidate routes. Freeze archived code/base, dataset and helper inputs; exclude irreproducible cases and unadmitted routes; run the common tools-off protocol and a separate production baseline; retain anonymous grading, gold scoring, failures, usage coverage and feasibility reports. Add scratch fixtures and the sampling protocol. Permit model literals only in the explicitly marked experimental routes file, with negative fixtures preserving production-consumer restrictions. Reviewer policy, delivery gates and the worker corpus remain unchanged.

- MONO-80: add the append-only decision journal, deterministic current-entry rendering, immutable dataset versions (including identical-input recovery of an interrupted digest publication) and digest-checked ignored materializations. Validate optional phase proposals without changing confirmation semantics; derive review hints from adjudications and retain reasoned withheld collection requests. Add the approved-pilot dispatch block and orchestration instructions, install the new runtime module, and cover journal/history, versions, materialization, proposal references, hints and dispatch structure with fixtures. Worker corpus bytes remain unchanged.

- MONO-83: install `review-ledger.mjs` with the private runtime, reject installer manifests whose relative `.mjs` imports are not included, and cover the missing dependency plus a real installed `wave-cost.mjs --ledger` path with named fixtures.

- MONO-79: add review-event accounting with cross-source identities, explicit launch causes, separate certification roles, unresolved coverage and evidence-backed adjudications. Capture reviewer usage before receipt signing, retain validation lines while streaming, accept only the legacy and streaming fixed invocations, and archive immutable dataset versions. Prefer review-ledger counters and provider usage in wave cost, preserve the legacy line without a ledger, and exclude retired registry entries when selecting final delivery reports. Add correlation, retention, usage, archive and cost fixtures.

- MONO-78: derive and canonicalize both Git directories from the requested worktree on launch and resume, with locally cleaned Git reads for directory discovery and capsule HEAD. Keep exact grant pins and all protected-path guards. Read green time, recorded merge time and review rounds independently from top-level `mono-deliver` fields, with legacy report/ledger fallback and valid zero rounds. Update dispatch, sandbox and README instructions; cover exact sets, environment redirection, guards and cost sources with fixtures. Add a paired host fetch/add/commit probe, deferred to the orchestrator at deploy inside nested sandboxes.

- MONO-76: make the English README the complete pack description and sole 34-rule owner index, with required-section and resolvable-link checks. Require a Linear Issue before pack edits and same-PR README freshness. Remove the Russian owner documents, reconciliation/publication workflows and their validators; migrate documentation model-policy and installer fixtures to README. Install README with an asset hash and omit the ownerLayer lock field. Linear document stubs and orchestrator-root cleanup remain deploy-owned.

- MONO-75 (breaking, surfaceRevision 4): dispatch one mono-deliver context with separate code/preflight/ship owners. Add durable per-write reconciliation, whole-queue confirmations and phase capsules; finish as green or parked. Install head-bound gates and orchestration launch/resume/ack tools together, with halt and persistent attempt caps. Replace fixed PR silence with bounded evidence accumulation; preserve all green conditions. Count the sequencer and worker contract without raising the 99,882-byte ceiling.
- Collect preflight evidence only from the orchestrator outside worker write grants; workers verify pinned receipts with collect:false. Bind dispatch inputs and retain one confirmation-request for each collection. Grant only reports/ as the worker mailbox, keep confirmations/control state outside the grant, and record capsule writable_roots. Use preflight-collect:<head>:<n> for collection retries. Run verification and review behind sandbox evidence-write denial probes and writable private temp directories; disable Git monitors/hooks and refuse repository executable filters during gate reads and serialize collection per head. Use the configured confirmation budget for adapters. Preserve global Git excludesFile without restoring executable global settings. Skip the real sandbox fixture inside nested Seatbelt; require the orchestrator host proof. Seal collection consistency before persistence and review against the immutable base SHA. Bind bot remark dispositions to current comment content. Ship watch waits for pending evidence until its deadline. Accept UNSTABLE/MERGEABLE when all non-passing checks are policy-accepted terminal non-blocking and nothing is pending; retain required-check success and refuse terminal merge obstacles. While checks are pending, accumulate BLOCKED/UNKNOWN evidence; one-shot returns the pending reason and watch stops only at readiness or its deadline. Limit collector writes to the worktree and one private temp directory, regardless of request-listed worker grants. Preserve successful sandbox denial proof when verification or review exits with a failure. Refuse collector/start Git reads for repositories with submodules rather than inspecting nested executable-filter configurations. Bind optional orchestrator-owned review datasets under evidenceRoot by source path and file SHA-256. Supply a temporary repo-relative copy to the helper, verify its digest before/after review, record source/digest/copy and remove the copy afterwards. Launch the helper with the gate’s hardened Git environment.

- Preserve startup-log cursors beyond 1 MiB; bind collection confirmations to authenticated immutable history receipts; reject outstanding requested changes; share complete parked-report correlation between watcher and acknowledgement consumption.

- Enforce phase and sequence predecessors in both publication and queue confirmation; retain report snapshots in durable confirmations and re-read them during recovery before applying later writes. Find fallback predecessors under dispatched writable roots when later phases return to the normal mailbox.

- Require the live PR head/base’s sealed preflight receipt inside the ship gate before judged outcomes; retain receipt identity in ship evidence state and its path in the gate answer.

- Bind review receipts to head and merge-base, refresh remote-tracking base refs and use the live PR base tip in ship. Preserve receipts across base advances with an unchanged diff; new heads or a different merge-base still refuse.

- Record rules API 403/404 as unavailable on the repository plan/visibility while retaining explicit required checks and merge checks. Keep branch slashes in the endpoint path; retry other GitHub read failures only within the existing ship deadline. Materialize the captured PR base object when a force-push makes it unreachable from the freshly fetched branch tip.

- Restore trusted global/system credentials, URL rewrites and askpass/SSH settings only for base fetches; keep hardened Git reads, disabled hooks/monitors and replacement/graft protections. Report failed fetches as pending in watch and refuse one-shot.

- Await lazy UNKNOWN mergeability even after checks finish; keep one-shot pending, watch recovery and the original deadline. Known terminal merge/check failures still refuse immediately.

- MONO-74: split the delivery-worker contract from orchestrator transport,
  registry, watcher and resume policy. Shorten delivery/deploy instructions,
  centralize worker report and certificate references, and move explanatory
  rationale outside delivery reading. Preserve audience-adapted dispatch,
  stage ownership, gates, report fields and the protected contract core.
- Install dependency-free `read-budget.mjs` beside `wave-cost.mjs`. Validate
  one recursive, deduplicated union of the three delivery skills and all
  mandatory, conditional and inline pack reads. Print composition, bytes and
  approximate tokens (bytes/4); negative fixtures cover oversized additions.
- Record the approved pre-rewrite baseline: 334,371 bytes / 28 files. At implementation handoff, the
  source corpus was 98,834 bytes / 21 files (~24,708.5 tokens); the
  installed corpus was 99,882 bytes (~24,970.5 tokens), including generated
  skill headers. Set the validator ceiling to the measured installed 99,882
  bytes. The 60,000-byte target was not reached: protected issue-only/model
  policy and PRD/Tech Spec contracts consume 36,943 bytes; the remaining
  worker protocol, stage gates/certificates, feedback and output obligations
  require a later delivery-contract change for further substantial reduction.
  Keep map coverage and the constitution's moved authority link current.
- Preflight review restores the canonical Russian owner glossary, jargon
  exclusions and live-verification phrases, and gives ship verdict copy one
  explicit template home; restore implement's conditional questioning-policy
  read for interactive questions and explicit Project-first Delivery Start steps.
  Preserve ship formal review/check for drift-candidate certificates.
  After removing duplicate prose, the final source
  corpus is 98,816 bytes; installed 99,846 bytes clean (99,864 with dirty
  markers); the
  accepted 99,882-byte ceiling and all gates remain unchanged.

- MONO-73: remove prose pins from workflow validation. Keep explicit machine-token pins, document skeleton checks, script behavior fixtures, and the four unchanged contract fingerprints. Agent-only rules remain in the text and review; AE6 scratch-copy fixtures cover rewording, missing structure, weakened lane fields, unlisted pins, and contract edits.

### Wave cost telemetry (MONO-72)

- Add the dependency-free installed `wave-cost.mjs` runtime script. It sums
  every per-turn usage event across all stages and attempts without counting
  cached input twice, reports all other measurable per-PR components and
  explicit unavailable reasons, records actual pack reads, and emits JSON plus
  one Russian status line.
- Carry that exact line in deploy closeout and orchestrator status, with
  structural template checks and synthetic multi-turn, missing-data, and
  installed-root fixtures. Cost remains telemetry and never a delivery gate.

### Owner-layer reconciliation (MONO-71)

- Clarify that a filed owner-layer difference stays confirmed when its record
  is canceled or closed, and document Linear's bare issue-key rewrite without
  changing reconciliation comparison behavior.
- Reject bare `MONO-<number>` Issue keys in both owner-layer documents while
  continuing to allow contract and artifact identifiers such as `PC-005`,
  `IS-004`, and `К-22`; structurally protect both new rule clauses.

### Repository hygiene (MONO-70)

- Ignore `.claude/` and `.worktrees/` so local agent workspaces do not mark
  clean skill-pack installations as dirty.

### Model policy (MONO-69, 0.21.0)

- Add `references/model-policy.md` as the sole model and role-effort source
  for seven roles. Preflight, both Second Voice branches and worker launches
  resolve roles; risk classes, class efforts and critical escalation remain
  unchanged. The owner-approved reviewer/producer pairing remains an owner
  decision, and worker selection is never inferred from risk class.
- Validate role bindings, model-id syntax across the active surface, and the
  complete set of review routes structurally instead of pinning model names.
  Scratch-tree fixtures cover changed cells, stale ids, wrong/unknown/duplicate
  roles, altered/extra/duplicate routes, command generation and launch provenance.
- Record policy intent separately from parameters actually set for each of
  the three transports. Existing threads keep their launch pins; legacy
  records are not backfilled. Orchestrator status distinguishes a verified
  match, a mismatch and unavailable evidence.
- Update the Russian map and article К-22 to refer to roles. This is a minor
  release for new checks and backward-compatible workflow additions; the
  installed surface revision and existing identity gate do not change.

### Breaking

- The installed surface narrows from 14 to 11 skills: `mono-project`,
  `mono-prd`, and `mono-spec` are retired. Their normative rules remain in
  `references/contracts/`; raw Project intent routes to `mono-idea`, while PRD
  and Tech Spec creation or repair routes to `mono-handoff` (accepted pre-ship
  drift remains owned by `mono-ship`).
- `surfaceRevision` advances from 1 to 2. Upgrade with the transactional
  `node scripts/install-local.mjs --breaking` flow only after orchestrators are
  idle and worker registries are empty, then restart open agent sessions.

### Added

- Owner layer, part three — the procedure around the two documents.
  `mono-orchestrate` gains an Owner-layer reconciliation step that runs at every
  session start and on the owner's «сверь конституцию/карту»: it reads «Карта
  пака» and «Конституция пака» from Linear by the ids in
  `owner-layer/documents.json`, compares each with its installed copy under
  `../.mono-agent-workflow/docs/ru/` by normalised hash (LF, no trailing
  whitespace, `Версия пака:` lines removed, trimmed, one closing LF), and turns
  a difference into exactly ONE non-startable draft Issue per difference hash,
  carrying the snapshot (document id, base hash, diff hash) in the Issue body
  and confirmed by reading the created Issue back. The draft is activated only
  through the ordinary create-then-approve path: editing a document is a
  request, never an approval. The status line «Конституция и карта:
  синхронизированы | <N> правок ждут» is added to
  `templates/orchestrator-brief.md`.
- `mono-deploy` gains an `owner-layer publish` step after `project-update`: when
  the deployed PR changed `docs/ru/*`, it re-reads the Linear document, compares
  its normalised hash with the snapshot's base hash, and writes the merged copy
  with its `Версия пака:` line only when the two agree — then confirms the write
  by reading the document back, because the update response truncates `content`
  and a Linear write can report success while applying nothing. The outcomes are
  `Owner layer: published <document> @ <sha>`,
  `not published — concurrent owner edit`, `not published — no snapshot`,
  `not published — <reason>` for a connector failure (including a write no
  read-back confirms), and `n/a — deploy did not change docs/ru`. Every outcome
  is verdict-neutral: the deploy verdict never changes and closeout is never
  blocked. The `Owner layer:` field joins the deploy closeout block and
  `templates/deploy-output.md`.
- `scripts/validate-workflow.mjs` gains `validateOwnerLayerProcedureSurface()`:
  both document paths must appear in the `mono-orchestrate` "Read when" tier and
  in the step itself, and `Owner layer:` must appear in `mono-deploy` and in the
  deploy output template. Structural only — no new prose pins.
  `references/install.md` and the README describe how the owner layer is edited.
- Owner layer, part two: `docs/ru/konstituciya-paka.md` is the Russian
  constitution of the pack — 34 articles in nine sections covering the rules the
  owner sees and decides: status language, project-update form, ownership,
  approvals and mandates, the issue-only lane, models and review, deploy and
  closeout, honesty and boundaries, and changing the pack itself. Each article
  carries `Правило:`, `Почему:`, `Где живёт:` and an `Опора:` list; the two
  articles whose rule does not yet exist in the pack carry
  `Статус: предложение` instead of an anchor.
- `scripts/validate-workflow.mjs` gains `validateOwnerLayerConstitution()` and
  its parser fixtures, reusing the coverage inventory and the fence walk of the
  map check. An anchor is a pack path plus either a heading text (matched among
  H1-H4 after the `#` markers) or a stable ID (`## PC-013`-style, or a numbered
  invariant of `templates/project-update.md`); a verbatim sentence is never
  validated. A duplicate `К-NN`, a repeated anchor inside one article, a path
  outside the inventory, a heading or ID that no longer exists, a missing
  `Опора:` on an article without `Статус: предложение`, a missing `Правило:`,
  `Почему:` or `Где живёт:` field, and a heading that means to be an article but
  does not match `## К-NN.` each fail with the article number, the file, and the
  anchor. The catalogue's composition is deliberately NOT pinned: which articles
  exist is the owner's product decision, and a check that fixed the list would
  turn the owner's own edit red.
- Owner layer, part one: `docs/ru/karta-paka.md` is the Russian map of the pack —
  one entry per file, in working order, with purpose, audience, key rules, and
  what to change. `scripts/validate-workflow.mjs` gains
  `validateOwnerLayerMap()`, a structural coverage check over the inventory
  (`skills/`, `references/` recursively, `templates/`, `scripts/*.mjs`,
  `AGENTS.md`, `README.md`): a file with no entry, an entry with no file, a
  duplicate heading, and a missing field each fail with the path.
- `scripts/install-local.mjs` publishes `docs/ru/*.md` as pack-private payload
  at `<skills-root>/.mono-agent-workflow/docs/ru/`, records their hashes in the
  lockfile under `ownerLayer` (modelled on `runtimeScripts`), and builds the
  `.mono-agent-workflow/` allowlist as the union of runtime scripts and
  owner-layer documents. The extra-file scan stays fail-closed and now reports
  `Unexpected installed pack file` for either payload kind. `references/install.md`,
  `references/versioning.md`, and the README Documentation Map describe the layer.
- `mono-deploy` gains a `project-update` step between `mono-closeout` and
  `learn`: one Linear project update per deployed Issue, in product language,
  and — when that shipment was the project's last — the project's transition to
  `Completed` before the final update is published. Completion is judged by
  Issue status TYPE (`completed`, `canceled`, and `duplicate` do not block; any
  other type does), and its normative wording lives in `references/lifecycle.md`
  (Deploy).
- `templates/project-update.md`: the single home of the update's form, its text
  invariants, the live-mode rule, two verbatim examples, and the accepted
  13-update acceptance set. The installer ships it into every skill of every
  root like the other templates.
- Closeout gains two additive fields, in the Issue comment and in
  `templates/deploy-output.md`: `Project update:` and `Project:`.
- Issue-only shipments reach a project feed. An issue-only Issue names its
  theme project in `Связи` as the plain-text line
  `Тематический проект: <имя>` (or `Тематический проект: нет — <почему>`) —
  a machine, language-independent field, never a Project relation or chip —
  and `mono-deploy` publishes the ordinary update on that project at
  closeout, without touching its status, including for a project already in
  `Completed`. An unnamed, missing, or ambiguous theme project becomes a
  spoken `n/a`/`not posted` reason instead of a silent `n/a`. The rule lives
  in `templates/issue.md`, `skills/mono-issue/SKILL.md`,
  `skills/mono-deploy/SKILL.md`, the new `## Theme project` section of
  `templates/project-update.md`, `templates/deploy-output.md`,
  `references/lifecycle.md`, `references/artifact-rules.md`, and
  `references/issue-only-lane.md`, with a structural field check in
  `scripts/validate-workflow.mjs`. The line is inside the whole-body
  fingerprint, so adding it to an approved Issue needs a create-then-approve
  renewal; an Issue approved before the rule simply closes out as `n/a`.

### Changed

- Mandatory `mono-preflight` autoreview moves off the GPT-5.6 family and onto
  Claude Opus 5, per the owner decision of 2026-09-06. All five rows of the
  canonical table in `references/autoreview-routing.md` route to
  `claude-opus-5` and are graded only by reasoning effort; the Invocation
  examples, the Certificate Evidence rule, the flag rule and `ready`
  prohibition in `skills/mono-preflight/SKILL.md`, and the certificate line in
  `references/artifact-quality.md` all pass `--engine claude`, and the
  certificate shape carries `model=<claude-opus-5>`. A `ready` verdict reviewed
  on Opus 5 is no longer recorded as a deviation from the table.
- `references/autoreview-routing.md` states the situation honestly instead of
  keeping the retired provisional framing: while workers run on Claude the
  review is same-model at every class, the compensations are unchanged (the
  mandatory live QA gate before closeout and the no-test-edits rule), and
  cross-vendor review is what happens when the worker engine is Codex. A
  `standard` re-tier still lands as a change to the table, never as a per-run
  override. The hidden-fallback ban now names both channels the helper offers —
  the `--fallback-model` flag and the `AUTOREVIEW_FALLBACK_MODEL` /
  `AUTOREVIEW_CLAUDE_FALLBACK_MODEL` environment variables. The defect-handling
  line in `skills/mono-deploy/SKILL.md` names the standard route instead of the
  retired model, keeping its re-tier pointer verbatim.
- The remaining autoreview-route mentions follow the same move: `AGENTS.md`,
  `README.md`, `references/install.md`, `references/lifecycle.md`,
  `references/versioning.md`, and `examples/consumer-dogfood.md`.
- `scripts/validate-workflow.mjs` moves every affected pin together with its
  text and drops three pins that guarded editorial wording on a paragraph this
  change abolishes: `PROVISIONAL pending live-QA validation of the`,
  `hermes-dashboard waves`, and
  `if live QA surfaces defects that Luna-reviewed code shipped`. The pin list
  for `references/autoreview-routing.md` goes from 16 to 13 entries and gains
  no new prose pin; the anti-duplication guards for the canonical table are
  restated for the new route.
- `mono-orchestrate` owner-facing statuses switch to product language: the
  subject of every line is what the product now does for its user; Issue
  keys, stages, wave slice codes, and mechanics are never the subject. The
  «Статус» shape in `templates/orchestrator-brief.md` opens with a
  «Решений от тебя:» counter, separates «Новое за <период>:» from
  «Где мы к цели», adds «Можешь потрогать:», «Чем рискуем:»,
  «Обещал — не сделал:», and «Следующий контакт:», renames
  «Простои и отклонения:» to «Что пошло не так:», moves the machine
  register into a «Техника (можно не читать):» tail, and keeps
  «Нужно от тебя:» as the last block. `references/human-friendly-output.md`
  gains «Product Language For The Owner» with a stage glossary.
- The «Project Updates are not a required gate» rule is preserved everywhere it
  already lived and extended in `AGENTS.md`, `references/artifact-rules.md`,
  `references/install.md`, and `skills/mono-deploy/SKILL.md`: the update is an
  informational result of closeout, and its failure never changes a deploy
  verdict. `mono-check post-ship` states explicitly that a missing update is
  never a `FAIL`.
- `mono-orchestrate` carries the published update's URL and the project
  completion result into the «Linear:» line of the next status; `resume` never
  sweeps projects for completion.
- The owner status surface is reconciled end to end after the product-language
  change: `templates/orchestrator-brief.md` drops the last «Простои и
  отклонения» label, moves the «Цена волны» block into the
  «Техника (можно не читать):» tail where key-led lines belong, numbers
  «Нужно от тебя» items by board-aligned IDs (`1a-…`) instead of a running
  count, adds the «стоит: <из-за чего>» state and the third verification state
  «проверка после выкладки прошла», and stops folding «Решил сам:» and
  «Что пошло не так:» into «можно не читать». `skills/mono-orchestrate/SKILL.md`
  matches: the final response points at «Итог волны», cost telemetry sits
  inside «Техника», and «Нужно от тебя:» stays the last block.
- The worker registry gains an optional `product_name`
  (`templates/orchestrator-report.md`, `references/orchestration.md`), and
  `templates/compact-instructions.md` now points at that field instead of a
  name that no record carried.
- `scripts/validate-workflow.mjs` holds the status shape structurally rather
  than by editorial pins: the key-led-bullet check now exempts only the
  «Техника (можно не читать):» block, so the machine register may be key-led
  while every owner-facing block — «Нужно от тебя» included — is still judged,
  and
  sixteen brittle prose pins (a section heading's wording, glossary arrows,
  a duplicate of a pin `validateHonestLedgerContract` already owns) are
  removed. The five structural checks, the section-label pins, and the eight
  invariant-bearing prose pins stay. `AGENTS.md` records the rule — new checks
  are structural, no new prose pins — and the caveat that an editorial pin may
  be dropped when it guards wording rather than an invariant.
- Owner assignment now covers the remaining creation points, so no Project or
  Issue the agent creates is left unowned: the hotfix Issue filed from the Live
  QA gate (`skills/mono-deploy/SKILL.md`) and from orchestrated
  deploy-and-closeout (`skills/mono-orchestrate/SKILL.md`) is created with
  `assignee: "me"`, and the follow-up Project opened when scope grows after
  `ready` (`skills/mono-preflight/SKILL.md`, `references/issue-only-lane.md`)
  is created with `lead: "me"` and its Issues with `assignee: "me"`. Existing
  assignments are never overwritten, and the ownership policy line in
  `references/artifact-rules.md` is unchanged.
- The ownership policy line in `references/artifact-rules.md` now states the
  rule in force at all six creation points — `mono-idea` sets the Project
  lead, `mono-handoff` and `mono-issue` the Issue assignee, `mono-deploy` and
  `mono-orchestrate` the assignee of a hotfix Issue, and the follow-up Project
  opened after `ready` (one creation point, documented in both
  `mono-preflight` and the issue-only lane) takes that lead plus the assignee
  of every Issue created in it — with existing assignments never overwritten.
  It replaces the tail that deferred the remaining points to a separate slice,
  which the entry above has since landed. The line carries no validator pin
  and none was added.
- `templates/project-update.md` becomes the single form for every writer of a
  Linear project update — `mono-deploy` at closeout and the orchestrator when
  it publishes a project sweep, a completion by hand, or a retro note — and it
  gains a second form. «Выкладка» keeps the shipped-result shape; the new
  `## State update` section defines «Состояние» for an update with no shipment
  behind it, with health by fact, a chip that names the blocking or next-step
  Issue or is absent, and a ban on dates, percentages, and slice listings. The
  invariants tighten to a title of at most 10 words and a body of one to two
  sentences and at most 35 words, add the capability-list test and the ban on
  service subjects («агент», «скилл», «сервер», «пак», «MCP», «валидатор»,
  «воркер»), and gain «Один результат — один апдейт» (14) and «Стоп-словарь»
  (15); invariant 10 now says that the stop dictionary governs HOW a result
  shipped and never forbids naming what shipped. The issue-only path follows
  invariants 1-12, 14, 15. Both exemplars are replaced by their rewritten live
  versions, a «Состояние» example joins them, and the acceptance set becomes
  the 32 updates of 2026-09-07 with a second anti-example.
- The other writers point at that one form: `mono-orchestrate` reads the
  template in its «Read when» ladder and writes a project update only in one of
  its two forms — the status register and the ledger never reach a Linear
  update, and a sweep over several shipped Issues is split into one update per
  Issue; sub-step 6 of the `project-update` step in `skills/mono-deploy/SKILL.md`
  names «Выкладка» as its form and leaves «Состояние» to the orchestrator; and
  Product Language For The Owner in `references/human-friendly-output.md` links
  to the template as the stricter rule for updates.
- `scripts/validate-workflow.mjs` adds `## State update` to the required
  headings of the template and one structural check that the tier-2 «Read when»
  block of `mono-orchestrate` carries the template path; the tier-2 heading and
  tier-rule strings move from `validateReadFirstTierContract` to module level so
  both checks read one copy. No new prose pin was added.

### Fixed

- The validator no longer crashes with `EISDIR` in a checkout that holds
  nested worktrees. `git ls-files` reports a nested repository as a single
  directory entry and `fs.existsSync` accepts it, so the retired-adapter
  reference scan in `scripts/validate-workflow.mjs` now reads an entry only
  when it is a regular file; directories, linked worktrees, and submodule
  entries are skipped. Tracked files are scanned exactly as before, so a
  retired adapter name outside the historical allowlist still fails the check.
- Owner-layer normalisation no longer reports a synchronised document as
  changed. Linear's document service rewrites every unordered-list marker to
  `* ` on every write — a property of the service, not of our files — so a
  document published intact always produced a fresh-read hash that disagreed
  with the installed copy's hash, which meant `mono-deploy`'s mandatory
  read-back reported `not published — write not confirmed by read-back` for
  writes that had landed perfectly, and `mono-orchestrate`'s reconciliation
  filed the owner a draft Issue for edits they never made. The normalisation
  rule gains one more step, identically worded in `mono-orchestrate`'s
  reconciliation (step 3) and in both `mono-deploy` owner-layer publish
  sub-steps (3, the pre-publication snapshot, and 6, the mandatory
  read-back): a line whose first non-whitespace characters are an
  unordered-list marker (`- `, `* ` or `+ `) is rewritten to the canonical
  marker `- `, preserving indentation, before hashing. The base hash is now
  stated explicitly to come from a fresh `get_document` read, never from the
  text a step believes it sent or is about to send, in both the place it is
  defined (`mono-orchestrate` step 4) and the place `mono-deploy` recovers it
  for comparison. `scripts/validate-workflow.mjs` gains
  `validateOwnerLayerMarkerCanonicalization()`: the marker-canonicalisation
  clause must appear in a bounded slice of all three sites, or the check
  fails. Structural only — no new prose pin.
- Owner-layer reconciliation no longer files a duplicate draft for an owner
  edit that is already on record. Step 5 said to look for a record carrying
  the document id and diff hash without saying how, and a literal search on
  the 64-character diff hash finds nothing: Linear's issue search does not
  match a hex hash inside a body, while it matches a dash-separated UUID
  precisely — a property of the search, not of our data. Measured against a
  real filed record, that search returned ten unrelated Issues and missed it
  entirely, so every run concluded "not filed" and created another draft.
  Step 5 now names the lookup: search by the document id, then confirm a
  candidate only by reading its body and requiring both the same document id
  and the same diff hash together in its «Снимок контекста» — result rank is
  never confirmation, only the read body is — and states explicitly that an
  empty or irrelevant search result is not proof no record exists, so nothing
  may be created before that search has run and its candidates have been
  read. Pre-ship review on this Issue's own PR added a third clause: a
  search that errors, times out, or returns a partial/unreadable result is
  not the same thing as a completed search that read its candidates and
  found none, so it must not license creation either.
  `scripts/validate-workflow.mjs` gains
  `validateOwnerLayerRecordLookupByDocumentId()`: all three clauses must
  appear inside step 5's own bounded slice, or the check fails. Structural
  only — no new prose pin.

## [0.20.1] - 2026-07-16

Completes the public brand migration by renaming the canonical GitHub
repository from `darkdepot/linear-agent-workflow` to `darkdepot/mono`.

### Changed

- The installer now records `darkdepot/mono` as the canonical upstream
  repository in generated lockfiles.
- README and install/versioning documentation now point to
  `https://github.com/darkdepot/mono`.
- Previous-brand repository markers remain supported only as migration input
  for installer-owned `0.19.x` state.

## [0.20.0] - 2026-07-16

Rebrands the workflow skill pack from `linear-*` to `mono-*` while keeping
Linear as the durable product/project system of record.

### Breaking

- All public skill names and commands now use the `mono-*` prefix:
  `mono-idea`, `mono-handoff`, `mono-implement`, `mono-preflight`,
  `mono-ship`, `mono-deploy`, and the related atomic/review/check skills.
  The old `/linear-*` commands are not installed as aliases.
- Project policy moves from `.agents/linear-workflow.config.json` to
  `.agents/mono-workflow.config.json`.
- Installed-pack state moves from `.linear-agent-workflow*` to
  `.mono-agent-workflow*`, and `LINEAR_WORKFLOW_KNOWN_ROOTS` is superseded by
  `MONO_WORKFLOW_KNOWN_ROOTS`.
- Durable workflow markers and certificates written after this release use
  the `mono-*` brand, including `mono-issue-only marker`,
  `mono-preflight certificate`, and `mono-ship green certificate`.

### Added

- Installer migration support discovers previous-brand lockfiles, installs the
  complete `mono-*` pack, removes installer-owned `linear-*` skills, and
  replaces the old lock/runtime paths. The previous environment override
  remains readable during migration.
- Project config migration reads previous JSON or Markdown config, writes the
  Mono JSON config, and removes previous-brand vendored skills, generated
  checkers, lockfiles, configs, and updater workflows with `--write --clean`.
- The issue-only resolver continues to read an already-approved
  `linear-issue-only marker`, so the brand migration does not revoke durable
  Linear approvals. New and renewed marker comments use the Mono marker.
- Functional fixtures cover installed-pack migration, previous JSON/Markdown
  project config migration, and previous-brand durable marker compatibility.

### Changed

- All skill frontmatter, cross-skill routing, templates, references, examples,
  plans, validation pins, runtime paths, user-facing status text, and docs now
  use the Mono brand.
- The artifact linter entry point is now
  `scripts/lint-mono-artifacts.mjs`; `scripts/verify.mjs` invokes the renamed
  checker.
- The local checkout and GitHub repository slug remain
  `darkdepot/linear-agent-workflow` for this release; lockfile upstream
  identity continues to record the actual repository URL until that external
  rename is performed separately.

### Migration

Update installed skill roots:

```bash
node scripts/install-local.mjs --remove-stale
node scripts/install-local.mjs --check
```

Migrate each project repository:

```bash
node scripts/project-config.mjs --repo /path/to/project --write --clean --check
```

Restart the agent runtime after installation so its skill registry reloads,
then use `/mono-*` commands.

## [0.19.1] - 2026-07-11

Makes the code-review model policy an explicit design choice next to the newly cross-vendor Second Voice (MONO-13).

### Changed

- `references/autoreview-routing.md`: states that cross-vendor review is deliberately not a code-review requirement and must not be added by analogy to the Second Voice. Independence-by-different-vendor guards subjective product judgment (the Second Voice's job, where two instances of one model share priors); code review is grounded in the concrete diff, so the gate is served better by matching model strength to risk within the GPT-5.6 Luna/Terra/Sol ladder than by crossing vendors. Cross-vendor code review remains only the existing `risky`-class compensation, and only when the worker engine is not Codex. Pinned in `scripts/validate-workflow.mjs`.

## [0.19.0] - 2026-07-11

Second Voice model selection is now cross-vendor and relative to the orchestrator (MONO-12), fixing a self-review echo observed live.

### Changed

- `references/orchestration.md` `### Second Voice`: the reviewer model is selected relative to the orchestrator and must be a different model family — a fresh context on the *same* model inherits the same blind spots and collapses into self-review. An orchestrator on any Claude model (Fable, Opus, Sonnet, …) draws its Second Voice from `gpt-5.6-sol` at `model_reasoning_effort="high"`; an orchestrator on GPT-5.6 (`sol`, `terra`, `luna`) draws it from Claude Opus (latest) at high reasoning. Both sides run at high reasoning effort. The prior binding hardcoded an Opus-class reviewer and keyed independence on a distinct *session* rather than a distinct model, so an Opus orchestrator interviewed an Opus reviewer.
- Fallback is explicit: only when the cross-vendor model is unreachable (no Codex auth, or no Claude access) does discovery fall back to an in-session lens pass, with the reason recorded. A same-model Second Voice is not an acceptable fallback.

### Added

- `scripts/validate-workflow.mjs` pins both invariants (`a different model family from the orchestrator`, `A same-model Second Voice is not an acceptable fallback`); break/restore negative test recorded in `docs/spikes/mono-12-pin-tests.md`.

## [0.18.1] - 2026-07-11

Hotfix release from the first live run of the heartbeat watcher against a real orchestrator directory (MONO-11).

### Fixed

- `scripts/watch-workers.mjs` no longer emits `EVENT:dead` for retired Issues: log checks are scoped to Issues present in the active `workers.json` registry; a directory's historical logs are outside the watcher's scope. Registry-side checks (entry-without-log, pid-gone) are unchanged.
- Completed-but-unconsumed workers no longer trigger false `EVENT:stall`/`EVENT:dead`: a terminal mailbox report for the same Issue+stage suppresses events even when the Codex CLI's final shutdown writes leave the report marginally older than the log (grace window of one stall threshold), guarded by the log's birthtime so a prior-attempt report can never mask a genuine retry death.

### Added

- Heartbeat contract sentence in `references/orchestration.md` — the watcher observes the active registry, not the directory's history — pinned in `scripts/validate-workflow.mjs`; before/after fixture reproductions and discrimination probes recorded in `docs/spikes/mono-1-watcher-spike.md`.

## [0.18.0] - 2026-07-11

Wave-2 hardening release: MONO-5 through MONO-10 close the contract, hygiene, telemetry, integrity, and ops gaps found while dogfooding orchestrated delivery, and amend the autoreview model routing.

### Added

- Goal contract and verification binding (MONO-5): `templates/orchestrator-dispatch.md` gains a `## Goal Contract` section — the durable end-state lifted verbatim from the Issue, runnable verification commands, and what must not change or break — so a worker can judge its own "done" against the contract instead of vibes. `templates/orchestrator-report.md` gains `verification_items` (`pass | deferred | not-run`, optional in shape but mandatory in coverage): stage exit reports in `linear-implement` and `linear-preflight` enumerate every «Как проверить» item and cannot claim completion while an item is silently missing; the orchestrator audits `verification_items` coverage before advancing a stage-terminal report.
- Review-loop hygiene (MONO-6): before the first resolver cycle the review bots' configuration is checked and config-class noise is fixed via configuration, never burned down with resolver cycles; duplicate findings are deduplicated without consuming the cycle budget, guarded by a double fail-safe (in doubt = novel, dedup must never dismiss real findings); a published-replies submitted-check (no pending draft reviews) becomes a green-certificate precondition; after the authorized final resolver cycle convergence is non-blocking — remaining threads get deferral replies and a follow-up issue when warranted.
- Per-feature cost telemetry (MONO-7): `references/orchestration.md` gains a `## Cost Telemetry` section — tokens summed across all attempts of a stage from the last `turn.completed` event per thread, review cycles counted, stage wall-clock from ledger timestamps with `recorded-late` entries honestly marked; status updates carry a per-Issue cost tail and the wave closeout a «Цена волны» block. Cost is telemetry, not a gate: no thresholds, no blocking, visibility only.
- Brief integrity (MONO-8): decision briefs mirror board section IDs exactly with section-scoped suffixes (1a, 1b) and cross-section renumbering forbidden; option tokens are self-identifying (valid without their number); owner answers are echoed back as «вопрос → выбранный вариант (дословно)» with a one-line re-confirm on any numbering doubt — in doubt, re-ask; questions are never closed by silence; anything changed after approval is disclosed under «Изменилось после твоего одобрения:».
- Ops lessons (MONO-9): install-source SHA blocker — the installing checkout's HEAD must equal the expected merge SHA taken from the gh merge record (`git rev-parse HEAD` provenance, verify SHA → install → `--check`), and a mismatch is a DEPLOY BLOCKER, not a warning; after any interruption PR state is reconstructed exclusively via `gh` commands against the exact head SHA, never from thread memory; a forced mid-wave resume drill is defined as a planned one-time operational act (not a recurring gate) that records every reconstruction discrepancy in the ledger and feeds the PRD wave-1 success criteria.
- Autoreview routing amendments (MONO-10, `references/autoreview-routing.md`): the reviewer-vs-producer principle — a review model must be at least as capable as the code's producer for the gate to add signal; the `standard` → `gpt-5.6-luna`/`medium` route is marked PROVISIONAL pending live-QA validation of the hermes-dashboard waves, with an explicit re-tier trigger to `gpt-5.6-sol`/`medium` if live QA surfaces defects that Luna-reviewed code shipped; the same-model limitation at `risky` (Sol reviewing Sol, METR reward-hacking context) is documented together with its compensations (live QA gate, no-test-edits rule, cross-vendor review when the worker engine is not Codex).

### Changed

- The `deep` risk class now routes autoreview at reasoning effort `high` instead of `medium` (`gpt-5.6-sol`/`high`), aligning the canonical table with the tiering research and strengthening the gate; no route was weakened.
- `scripts/validate-workflow.mjs` pins all wave-2 contracts (`validateGoalContractBinding`, `validateReviewLoopHygiene`, `validateCostTelemetry`, `validateBriefIntegrity`, `validateOpsLessons`) plus the MONO-10 routing pins (updated deep row, PROVISIONAL marking, re-tier trigger, same-model limitation); each pin set is proven by a break/restore negative-test protocol recorded in `docs/spikes/` (`mono-5-pin-tests.md` through `mono-10-pin-tests.md`).

## [0.17.0] - 2026-07-11

### Changed

- `linear-preflight` now routes mandatory `autoreview` through explicit GPT-5.6 model/effort pairs derived from the existing workflow risk class, using the canonical table in `references/autoreview-routing.md`.
- The final preflight certificate records the risk source, selected model and effort, and any upward reclassification; `ready` fails closed when explicit routing is missing or mismatched.
- Model routing lives in the Linear workflow rather than the independently updated external `autoreview` skill, so upstream helper refreshes cannot silently restore an older model default.

## [0.16.0] - 2026-07-11

Wave-1 hardening release: MONO-1 through MONO-4 close the reliability gaps found while dogfooding orchestrated delivery.

### Added

- Orchestrator heartbeat (MONO-1): external tick via `scripts/watch-workers.mjs` tailing worker session logs and emitting `EVENT:<stall|dead|spawn-fail>` lines; spawn watchdog that catches missing `thread.started` / empty `thread_id` on worker spawn; healing ladder nudge → respawn → session rotation with user alerts only after the ladder is exhausted. Dispatch prompts are passed via file only (`"$(cat <dispatch-prompt-file>)" < /dev/null`), and the worker model and reasoning effort are pinned explicitly in the spawn command (`-c 'model=...'`, `-c 'model_reasoning_effort=...'`) so CLI default drift cannot silently switch models.
- Honest ledger (MONO-2): ledger entries carry the timestamp of the actual moment of writing, backfilled events are marked `recorded-late`, and corrections are new lines, never edits. Status updates disclose orchestrator idle windows in the «Простои и отклонения» brief section; Linear Write Verification requires reading back the mutated entity after every write (a success response alone is not confirmation); `## Context Budget` defines «Контекст: ~N%» reporting with 70%/85% thresholds and rotation that never happens mid-dispatch.
- Mandatory Live QA gate in deploy closeout (MONO-3): before Linear closeout, verify the deployed version matches the certified merged SHA, walk the PRD acceptance criteria of the shipped Issue on the live app, and check the console for errors. Design acceptance is judged autonomously against the prototype approved at the UX checkpoint, never the agent's own taste. Defects fix-forward through an immediate hotfix Issue out of queue that closes only after its own live pass is green. New optional `workflows.qa` / `qaAuth` project config fields, plus a narrow control-plane exception (explicit owner mandate; feature code never qualifies).
- Real-backend contract sampling in Tech Spec (MONO-4): for features integrating with an existing API or backend, the Tech Spec must include a sample of real responses from the deployed instance — enum value domains, object shapes, edge records — not just an endpoint list; a spec-vs-reality mismatch is a spec blocker, not an implementation surprise. New «Реальные ответы бэкенда» subsection in `templates/tech-spec.md`, the matching quality bar in `references/artifact-quality.md` ("endpoint exists" is not contract verification), and the degradation rule: when the deployed instance is unreachable during discovery, a contract-verification spike Issue goes first in the wave.

### Changed

- `scripts/validate-workflow.mjs` pins all wave-1 contracts (`validateHeartbeatContract`, `validateHonestLedgerContract`, `validateLiveQaGateContract`, `validateRealBackendContractSampling`); each pin set is proven by a break/restore negative-test protocol recorded in `docs/spikes/` (`mono-1-watcher-spike.md`, `mono-2-pin-tests.md`, `mono-3-pin-tests.md`, `mono-4-pin-tests.md`).

## [0.15.0] - 2026-07-09

### Added

- `codex-cli` worker transport for `linear-orchestrate`: the orchestrator spawns one headless Codex thread per Issue (`codex exec --json` in a pre-created worktree), advances the same thread across stages with `codex exec resume`, and tracks every worker in a `workers.json` registry (transport, thread id, worktree, branch, stage). Liveness ladder, stage budgets, and report-delivery fallback under a write sandbox are specified in `references/orchestration.md` Worker Transports; transport selection honors the new optional `orchestration` config block (`orchestration.transport`, `orchestration.maxParallelWorkers`).
- Director Discovery (`references/orchestration.md`): discovery under orchestration runs in director mode — the orchestrator answers discovery-skill questions itself as product director and touches the user only at five checkpoints: intake direction questions, the UX checkpoint with a reviewed near-production prototype, package approval, deploy approval per policy, and ad-hoc risk or scope-drift escalations. Includes the prototype bar (never a first draft), multi-idea intake queueing, and the «UX-чекпоинт» brief shape in `templates/orchestrator-brief.md`.
- Second Voice (`references/orchestration.md`): the interrogative side of discovery is delegated to an independent reviewer agent in a fresh context (Opus-class subagent in Claude Code, a fresh high-reasoning `codex exec` thread otherwise, in-session lens review as recorded fallback). Dialogue protocol ask → answer → challenge capped at 3 rounds; disagreements that survive the cap go to the user only when Always-ask class; the Second Voice never talks to the user, never writes Linear, and never dispatches workers.
- Runtime-availability fallbacks: `linear-implement` and `linear-ship` define behavior when a configured engine/workflow is not available in the current runtime, recording the substitution without weakening gates.
- Executor plans `plans/012-codex-worker-transport.md`, `plans/013-director-discovery.md`, `plans/014-second-voice-discovery.md`; validator pins for all new contracts.

### Changed

- `references/questioning.md` Orchestrated Mode covers discovery skills in the orchestrator session; `references/lifecycle.md` Orchestration section names the checkpoint model; README documents director mode and the recommended orchestrator/worker pairing.
- Always-ask design/UX escalations arising during discovery batch into the UX checkpoint instead of interrupting; discovery artifacts (prototypes, mockups, review notes) are defined as orchestrator-owned discovery work, not stage work.

## [0.14.0] - 2026-06-12

### Added

- `linear-orchestrate`: control-plane orchestrator skill — one session per product drives Linear projects and Issues through delegated worker sessions (`linear-implement` → `linear-preflight` → `linear-ship` per Issue), answers worker technical questions autonomously, and escalates only product decisions (scope, design, product risk, deploy approval per `deployApproval`) to the user as prepared decision briefs.
- `references/orchestration.md`: orchestration policy — roles, stage ownership, decision authority, worker transports (Claude Code Desktop chips, Codex threads, background-subagent fallback), mailbox and ledger contract, monitoring protocol, and resume procedure.
- `templates/orchestrator-dispatch.md` (worker spawn prompt with context snapshot and AFK contract), `templates/orchestrator-brief.md` (Russian decision-brief and status-update shapes), `templates/orchestrator-report.md` (mailbox report JSON and ledger entry shapes).
- Orchestrated-mode routing: `references/questioning.md` gains a `linear-orchestrate` question stage and an `## Orchestrated Mode` section; `references/lifecycle.md` gains an `## Orchestration` section with explicit Required/Forbidden lists.
- Validator pins for all new contracts in `scripts/validate-workflow.mjs` (now 13 skills checked), including the strict single-Linear-writer rule: workers never write to Linear and queue every stage-required mutation through `linear_mutations_pending`.
- Design spec `docs/superpowers/specs/2026-06-11-linear-orchestrate-design.md` and executor plan `plans/011-linear-orchestrate.md`.

### Changed

- `README.md` and `AGENTS.md` document the orchestrator role and the control-plane-only design rule; stage ownership of existing skills is unchanged.

## [0.13.0] - 2026-06-11

### Added

- `scripts/install-local.mjs` now defaults to `--all-roots`: it discovers every previously-installed skills root by checking for `.linear-agent-workflow.lock.json` in the known roots (`~/.codex/skills`, `~/.claude/skills`, and any root recorded in a discovered lockfile) and syncs or checks each of them in one run, reporting the per-root installed version. This fixes the failure mode where only the default root was reinstalled and other roots (for example `~/.claude/skills`) were silently left at an older version.
- `--check` now also fails when a lockfile is pinned to a different upstream version than the current checkout, and reports the per-root version on success.
- `LINEAR_WORKFLOW_KNOWN_ROOTS` environment override for the known roots list (used by fixtures and sandboxes).
- Multi-root functional fixtures in `scripts/validate-workflow.mjs`: fresh-install fallback, one-run sync across roots, lockfile-recorded root discovery, stale per-root version detection, and per-root check failure isolation.

### Changed

- Explicit `--skills-root` keeps the previous single-root behavior; combining it with `--all-roots` is rejected.

## [0.12.0] - 2026-06-11

### Added

- Add `scripts/verify.mjs` one-command verification (range-aware whitespace check in CI) and a GitHub Actions workflow that runs it on every PR.
- Add `deployApproval` config policy (`always` default / `risky-only` / `never`): `linear-deploy` now defines when to ask, the Russian ask shape, and a durable approval record bound to the PR number and head SHA; stale approvals are treated as absent. Deploy approval is never a ship gate.
- Add an implementation-start approval prompt shape to `linear-implement` («что это разрешает / чего НЕ разрешает»); handoff package options now name which approval(s) they grant.
- Add Autonomy Defaults to `references/questioning.md`: agents decide non-contested choices themselves and surface them as «Решил сам» in the handoff package; scope boundaries, issue slicing, risk acceptance, and design decisions always go to the user, and visual decisions are presented through `/design-html` variants.
- Add Linear exit comments for every non-ready stop (blocked / needs-human / scope-drift / timed-out), a `Decision needed:` field in the preflight certificate, a Tiny Output Profile for `tiny`-risk work, and a Boundary Delta Rule against «Проверено/Не проверено» fatigue.
- Add learnings read-back: `linear-implement` and `linear-deploy` consult `gstack-learnings-search` (advisory) before work, closing the loop that previously only wrote learnings at deploy.
- Add `plans/` — the advisor audit record: executed improvement plans, verified findings, and rejected-findings rationale.

### Changed

- Linear machine blocks became dual-layer: certificates and the deploy closeout posted to Linear now open with 1-2 Russian human sentences above the byte-stable machine core; the deploy closeout leads with the shipped product outcome. Certificate recovery rule documented (latest marker comment wins).
- Russified the user-facing output templates: check output («Смысл», «Следующий unblock»), review report («Коротко» first, «Нужно твоё решение:», translated risk/gate values), ship output (telemetry moved to the internal summary, translated next steps), deploy say-strings; added risk/gate and tooling glossaries to `references/human-friendly-output.md`.
- Humanized the handoff chat final: artifact intake is one Russian sentence; the structured snake_case record moved to the package-approval Linear comment.
- Humanized Linear documents: PRD template merged three overlapping operator sections (16 → 14 sections), calque headings renamed to natural Russian, R/AE references carry Russian slugs, and Issue `AFK`/`HITL` values carry a Russian gloss.
- `linear-idea` now asks 1-3 direction-shaping questions and records the rest as explicit assumptions; its blocked message keeps the English marker line with a Russian blocked-shape body; the chosen discovery route is persisted as a Project comment.

### Fixed

- `project-config.mjs --write` backfills `deployApproval` into existing JSON configs; invalid values are rejected with fixture coverage in `validate-workflow.mjs`.
- `verify.mjs --help` exits 0; duplicate file reads removed in `validate-workflow.mjs`; check-output template labels are now validator-pinned.

## [0.11.0] - 2026-06-10

### Added

- Add `scripts/install-local.mjs` for installing/updating the workflow as a local `~/.codex/skills/linear-*` skill pack.
- Add `scripts/project-config.mjs` for creating, migrating, checking, and cleaning project-level `.agents/linear-workflow.config.json`.

### Changed

- Pre-v1.0 packaging contract change: project repos must no longer vendor generated `linear-*` skills, wrappers, lockfiles, local checkers, or updater CI.
- Replace generated project install validation with local skill-pack validation plus project JSON config validation.

### Removed

- Remove `scripts/sync-consumer.mjs` and the generated full-copy project install contract.

## [0.10.0] - 2026-05-29

### Changed

- Pre-v1.0 workflow behavior change: make `linear-preflight` use the installed `autoreview` helper as a mandatory clean gate instead of the previous bounded Compound `ce-code-review` loop.
- Record `Autoreview helper` as an explicit consumer prerequisite; generated workflow installs do not vendor the external `autoreview` helper and preflight blocks when it is unavailable.

## [0.9.0] - 2026-05-23

### Added

- Add `linear-deploy` as the post-ship owner for Deploy workflow delegation, verified delivery evidence, post-ship check, Linear closeout, and durable learning capture.
- Add `templates/deploy-output.md` and a durable `linear-ship green certificate` contract for handoff from ship to deploy.
- Add optional consumer config field `Documentation workflow`, defaulting the first consumer to `gstack document-release`.

### Changed

- Pre-v1.0 workflow behavior change: hard-rename `Land workflow` to `Deploy workflow`; no compatibility alias is supported.
- Move repo documentation sync into `linear-ship` before final green review stabilization so doc commits are reviewed before deploy.
- Split `linear-ship` and `linear-deploy`: `linear-ship` now stops at a deploy-ready green certificate, while `linear-deploy` owns merge/deploy, post-ship check, Linear closeout, and learning capture.
- Strengthen `linear-preflight` with a bounded pre-PR `ce-code-review` loop and residual finding reporting.

## [0.8.0] - 2026-05-23

### Added

- Add `linear-implement` as the Delivery Start owner that verifies implementation-start approval, moves Projects to Delivery, runs or reports `linear-check delivery`, selects an implementation engine, and exits to preflight.
- Add `linear-preflight` as the local branch readiness owner for worktree/diff inspection, targeted verification, self-review, commit state, and a preflight certificate consumed by `linear-ship`.
- Add `references/artifact-intake.md` for scoped discovery/review artifact intake with source precedence, freshness/conflict rules, and required confidence-boundary fields.
- Add optional consumer config field `Implementation workflow`, with backward-compatible default selection when absent.

### Changed

- Make the lifecycle explicit: `linear-idea -> discovery/reviews -> linear-handoff -> approved Issue(s) -> linear-implement -> linear-preflight -> linear-ship`.
- Update `linear-handoff` to run artifact intake before package synthesis and route explicit start-now approval to `linear-implement` instead of owning Delivery Start.
- Clarify that `linear-ship` consumes preflight output when present and remains sole owner of formal pre-ship review/check, PR creation/stabilization, review feedback, merge/deploy delegation, and Linear closeout.
- Extend consumer sync and workflow validation to include the Delivery Bridge Trio skills and copied references/templates.

## [0.7.0] - 2026-05-19

### Added

- Add an execution quality reference for PRD coverage, durable Issue writing, AFK/HITL readiness, bug/perf feedback-loop proof, tracer-bullet implementation guidance, and deep/risky architecture review.

### Changed

- Strengthen PRD and Issue contracts with actor/capability/benefit coverage, behavior-validation intent, agent readiness, dependencies, key contracts, and bug/perf current-vs-desired reproduction shape.
- Make consumer install checks fail while `.agents/linear-workflow.config.md` still contains unresolved `<...>` placeholders.

## [0.6.0] - 2026-05-18

### Changed

- Make `linear-idea`, `linear-handoff`, `linear-review`, `linear-check`, and `linear-ship` user-facing responses outcome-first and more human: product-first idea intake, artifact-map handoff summaries, human review/check meanings, explicit next-step options, and review/CI status that explains whether a PR is actually ready to land.
- Add a shared human-friendly output contract with status translation, checked/not-checked confidence boundaries, consequence-aware decision prompts, fresh-agent handoff guidance, and blocked/timed-out response shape.

## [0.5.0] - 2026-05-18

### Added

- Add `linear-review` as a report-only quality and risk review gate for Project, PRD, Tech Spec, Issue, and pre-ship packages.
- Add shared questioning, artifact-quality, readiness-gate, and review-rubric references plus a review output template.
- Add workflow validation through `scripts/validate-workflow.mjs`.
- Add generated consumer-local `.agents/linear-workflow-check.mjs` plus copied asset and wrapper hashes in the install lockfile.

### Changed

- Strengthen PRD, Tech Spec, and Issue templates with review-gate fields, traceable IDs, richer acceptance, implementation units, failure modes, validation, and rollback expectations while preserving product-brief Project bodies.
- Update `linear-handoff`, `linear-check`, and `linear-ship` around the risk-based review gate while keeping `linear-check` as readiness-only.
- Make consumer install checks compare copied `references/` and `templates/` against upstream instead of checking only sentinel files.
- Make workflow validation exercise consumer-sync behavior with fixtures for edited, missing, extra, and redirect-stub generated files.
- Keep Linear-facing template headings in Russian while preserving repo skill instructions in English.

## [0.4.0] - 2026-05-17

### Changed

- Pre-v1.0 workflow behavior change: make `linear-handoff` the primary post-discovery route and reposition atomic PRD/Spec/Issue skills as internal/advanced helpers.
- Keep Projects in Discovery through PRD and Tech Spec creation; Delivery now requires approved execution Issue(s).
- Define package approval, implementation-start approval, and delivery checks so handoff cannot silently become implementation.
- Replace Project and Tech Spec templates that leaked workflow mechanics into Linear-facing artifacts.
- Strengthen PRD/Tech Spec/Issue skill contracts with WHAT/HOW/execution separation, PRD requirement IDs, acceptance examples, and content-shape checks.
- Reserve future install/update workflow changes for explicit versioned releases.

### Added

- Add a lightweight regression smoke script and a Profile Workbench example for the first consumer dogfood failure mode.

### Fixed

- Artifact smoke failures now use portable ESM path resolution and de-duplicated unreadable-file diagnostics.

## [0.3.0] - 2026-05-17

### Added

- Extend `linear-ship` into a full Ship-phase orchestrator around configured PR creation, review feedback, merge/deploy, and Linear closeout workflows.
- Add optional consumer config fields for review feedback and merge/deploy workflows.
- Add ship feedback-loop reference and ship output template.

## [0.2.0] - 2026-05-17

### Added

- `linear-handoff` as the post-discovery bridge from review outputs into Project, PRD, Tech Spec, and Issue(s).
- Full-copy consumer sync through `scripts/sync-consumer.mjs`.
- Consumer install checks that reject stale generated skills, missing copied references/templates, unmanaged Linear skills, and redirect-stub patterns.
- Consumer sync now removes orphaned generated `linear-*` skill and wrapper directories before writing the current upstream set.
- Consumer template-copy checks now require both `project.md` and `check-output.md` sentinels.
- `upstreamVersion` and full upstream commit metadata in `.agents/linear-workflow.lock.json`.

### Changed

- Consumer installs now generate executable `.agents/skills/linear-*` copies instead of thin workflow-source redirects.
- `.claude/skills/linear-*` is discovery-only and points to the generated `.agents` skill body.
- `linear-idea` and `linear-check` now route discovery plans through `linear-handoff` before implementation.

## [0.1.0] - 2026-05-17

### Added

- Two generated wrapper modes:
  - `self` mode for dogfooding this repository from its current checkout.
  - `consumer` mode for pinned, reviewable installs such as the first consumer.
- Consumer lockfile contract at `.agents/linear-workflow.lock.json`.
- Install, update, check, and smoke-test scripts for wrapper generation and drift checks.
- Versioning reference for SemVer, lockfiles, wrapper hashes, and breaking-change policy.
