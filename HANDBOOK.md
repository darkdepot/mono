# Mono Agent Workflow

The complete rule reference for the Mono plugin: stage rules, gates, roles,
installation details, project config, owner rules and validation. For what Mono
is and how to start, read the [README](README.md). Per-release upgrade notes are
in [UPGRADING](UPGRADING.md). Private vulnerability reports: [SECURITY.md](SECURITY.md).

Mono is a plugin for owners and coding agents who deliver software through Linear and GitHub. Use it to turn a raw idea into approved work, run one delivery worker from code to a green pull request, and deploy with evidence. The owner decides the product; agents carry the work and show what they actually verified.

Canonical repository: [darkdepot/mono](https://github.com/darkdepot/mono).

This handbook is the complete rule reference and owner-rule index. Follow its links for executable instructions, artifact contracts, templates, and runtime commands. Keep it current in the same PR whenever described behavior changes, as required by [Change Discipline](AGENTS.md#change-discipline).

Code review before the PR is a read-only round inside the orchestrator's
collection: a reviewer and an independent checker from different model families
read the pinned diff of the committed head and one receipt is written. By
default the collection does not verify: the worker runs the full product
verification on the head and sends `workerVerification {head, exitCode}`, and the
receipt passes only with exit 0 on its head. A product whose full verification
needs the host (Mono's own reads the process table, which the Codex sandbox
forbids) sets `orchestration.delivery.hostVerification: true`; see
[host verification](#host-verification). The change sets the path: Handoff marks installer,
delivery, deploy and release, product prod scripts, user data and migrations,
security, public API and review-gate changes `risky` (the strict path, at most
three rounds per task attempt plus one extra round the orchestrator may grant); everything else, `deep` included, takes the fast
path with one round, after which the worker fixes and the final head passes on
its full verification without another round. A behavior change gets a live run
of its main scenario before the first round (pack skills and stages: the
orchestrator in the test Linear workspace). A task change («Изменение задачи»)
keeps the strict path's count and gives the fast path one more round, even on an
unchanged head. Only round 1 of the first attempt reads the whole change; every
other round, after a task change or in a new attempt on the same branch (its record
and last reviewed head carry over, its round count starts afresh), reads only the
fixes since the last reviewed head and open findings, plus the files the task change
names and any reviewed file rewritten by more than half. The worker fixes open findings and asks for the next round without
waiting for anyone. A fixed finding closes when the checker verifies the fix
and the reviewer stops reporting it. Older defects (on the strict path only
harmless ones), minor leftovers from the
second round on (never about data, security or a gate bypass) and, from the
third round on, leftovers both roles call harmless pass as successor candidates;
anything else left after the third round parks `needs-decision` for the
orchestrator: first one extra round in the same attempt (resume with `extraRound`,
once per attempt, only with at most one open finding and no raised risk,
out-of-contract work or open owner remark), then merge by the rule, split the
Issue or change the approach. The collector host needs both the Codex and Claude CLIs logged in by
subscription, from different model families; a single-family setup gives
`not-reviewed`, and so does a logged-out CLI whose role has to run. The Claude login refreshes itself: before each Claude role on the host, and every five minutes from the watcher while a worker is registered; a role that fails on an expired login names it («вход Claude истёк или не найден»), gets one refresh and one relaunch. A `not-reviewed` receipt names its cause: `environment` when every failed role attempt timed out, met a sleeping host, the network, a login still failing after its refresh, an overloaded model or a rate limit (the second attempt waits a minute), otherwise `review`, with the host load and a sleep flag; two in a row on one head park `blocked`, and a pair is retried by resuming the worker with `reviewRetry` after the host or the cause is fixed, never with a task change; a `review` pair names the work's cause on its blocked line (a malformed or incomplete answer, incomplete coverage, a single model family, unreadable or binary files, a CLI that could not start) and mentions the CLI login only when a login failed. See [review rounds](references/orchestration-delivery.md#review-rounds).
A large change (over about 200 KB of diff, or over the engine's input limit: Codex 1,000,000 bytes, Claude 800,000) is reviewed in small file groups of about 200 KB of diff, files of one directory together, a large file by its hunks (one indivisible hunk over 200 KB gets a group of its own up to the engine limit), with the same contract and open findings in every group plus a bounded map of the whole change (every changed file with its added and removed lines and the headers of its changed places; hunk headers are dropped first when the map is too large); the groups of one pass run two at a time, each call with its own single retry (the PR remark check also goes in groups, where one group's needs-fix decides). Every role call keeps the fixed 600 s limit, and a timeout names it (`role failed (timeout after 600 s)`, cause `timeout`). Answers of finished groups are kept in the host's evidence root (`review-groups/<head>.json`, outside every worker grant, bound to head, base, contract and launch pins and judged by the host-run evidence snapshot for every attempt of the root: any change, a symlink or a missing file discards the saved answers instead of restoring them, it is touched evidence for the attempt whose run it was). Reuse is off under host verification: when this attempt or any attempt of the orchestrator root has `hostVerification` pinned (checked under launch.lock at opening and again right before every read and write), nothing is saved or read and every collection reviews every group, because host verification runs worker code with host rights that could plant saved answers; isolating it is MONO-489. Otherwise, when a group fails twice the round is `not-reviewed` and spends nothing, and the next collection on the same head and contract runs only the missing groups; any change of head, contract, open findings or group plan reuses nothing. The round is spent only when every group of every pass is covered: each pass must cover every changed file from its own answers (an answer that leaves out files it was sent gets its pass one focused pass on them, then the round is `not-reviewed`), so an empty answer never rides on an earlier pass; from round 2 on (same contract) the checker reads the fixes since the last round and the change and files only around the open findings; the checker's evidence is otherwise cut to the findings' regions to fit; over 16 findings go to the checker in batches of at most 16 (whole files, one directory together, halved when over the input limit, two at a time, each with its own retry), a merge holds only inside one batch (a duplicate across a batch boundary counts twice) and one failed batch leaves the round `not-reviewed`; what cannot fit fails with its reason, as does a role failure, which keeps the engine's trimmed stderr.
Every collection requires a pinned request and correlated admission; unpinned
legacy requests cannot start collections. Receipts of the previous format are not accepted.

The collector starts with the attempt, without an orchestrator turn, and takes
each round request the worker writes (`reports/KEY-round-aN.json`) into a
host-owned ledger with one result per round (`done`, `refused`, `failed`) bound to
that request; the worker waits with `delivery-state.mjs wait-round`. There are no
collection or confirmation windows (`confirmationTimeoutSec`, `collectionTimeoutSec`
are ignored): every reviewer role has its own time limit, and a gate stuck outside
them is stopped after a fixed two-hour safety ceiling. With groups of about 200 KB two at a time a change of
about 1 MB (six groups a pass) takes three waves a pass, well inside it; if a gate is stopped at the ceiling
anyway, the finished groups are already saved and the collection retry runs only the missing ones. A crash before a receipt
may retry `collectionRetries` times (default 1) with the same admission; failure
receipts reconcile without another review. Receipts are unsigned: `evidenceRoot`
outside every worker grant is the trust anchor.
See [collection recovery](references/orchestration-delivery.md#delivery-write-barriers).

## Один владелец этапа

Владельца этап узнаёт только из задания запуска. В его сессии следующий этап там же,
кроме Design. В делегированном проекте
оркестратор запускает те же этапы агентами Claude Code, отвечает им словами
с причиной на показанной версии; исключение не действует для Idea и
в сессии владельца. Идею утверждает владелец словами на дословно показанное описание этапа. Исполнитель-воркер
(codex-cli, claude-cli) этап не ведёт; агент этапа ведёт и сам пишет/читает обратно
свои записи Linear. В implement, preflight и ship исполнитель сам пишет и читает
обратно отчёты, комментарии и статусы своей задачи через Linear MCP; оркестратор
пишет только стартовые переходы и «Изменение задачи». Этап возвращает запись и
выбранный переход; следующую сессию запускает оркестратор.

Делегирование: в последней записи идеи вне заборов строка «Ведёт оркестратор:
владелец принёс идею оркестратору <дата>.», повторяемая при переутверждении.
Слова владельца «веди сам» дословно в комментарии проекта делегируют его с этого комментария.
Без обоих проект ведёт владелец. Только делегирование разрешает
оркестратору начать Research и работу самому, со стартом `by=orchestrator`:
Research — причина без второй модели; работа — причина и противовес. `stale`/`legacy-migrate` идеи останавливает
автономный Research и работу до нового согласия владельца на показанное, подтверждённой записи
и свежей проверки; старт оркестратора идею не переутверждает.
Обычному проекту нужен `by=owner`; Handoff спрашивает о старте показанного пакета.
Прямые слова о передаче оркестратору пишут `by=owner` и передают работу.

Узкий режим «веди до Handoff» (PC-019): слова владельца дословно в комментарии
проекта и строка вне заборов «Ведёт оркестратор до Handoff: <дата>. Старт работ за
владельцем.». Сказано в сессии этапа без оркестратора — этап пишет такой комментарий
по `references/owner-dialog.md` и останавливается. Оркестратор ищет метку в проектах
до Delivery при восстановлении и при каждом выходе из ожидания и ведёт цепочку с
существующих записей: этапы до Handoff без ответов владельца, утверждения
`by=orchestrator` с причиной и противовесом, итог каждого этапа владельцу. Handoff
останавливается на Ready с вопросом о старте; старт только `by=owner`. Поправка
владельца словами открывает этап заново, прежнее утверждение оркестратора не действует.
Слова наперёд (`references/owner-dialog.md`, PC-016): владелец, утверждая PRD при
`design=not-needed`, макет или страницу техлида, прямо говорит готовить дальше,
проверять и передавать в работу. Этап пишет в заборе своего утверждения строку
`mono-forward: granted` с объёмом `tech`, `package` или `start`, версией PRD и Design;
слова остаются единственной строкой «Владелец: ответил». В том же разговоре
владельца (с сессией Design и её родителем) Tech Evaluation и Handoff дальше не
переспрашивают: показывают итог для сведения и пишут прежние записи `by=owner`
со строкой «Согласие наперёд: <id>». Утверждение макета согласие не покрывает.
Новое слово владельца по существу, правка PRD или макета, пункт списка владельца
в Handoff, непустое «Тебе решить», отзыв или новый разговор заканчивают согласие:
этап сначала пишет `mono-forward: revoked`, потом задаёт обычный вопрос. Старт по
согласию допускают `mono:check delivery` и оркестратор перед диспатчем тем же
чтением Linear; исполнитель принимает закреплённый `approval.md`. Стенд проверяет
записи шага `inherited` по согласию из более ранних этапов той же цепочки
(`forwardEvidence`) и сценарии `handoff/forward-chain`, `tech-evaluation/forward-stop`.

Известные ограничения слов наперёд: защита от подделки не цель, согласие на
том же уровне доверия, что и сегодняшние цитаты слов владельца; дописанный агентом
`scope=start` ловят ревью и разбор сессий, а не проверки. Прод и сегодня не
отличает механически старт по показанному итогу от старта по непоказанному:
допуск читает прозу, показанный текст связывает только стенд. Не замеченный
этапом конец согласия без записанного отзыва и правка комментариев задним
числом в Linear не видны.

PRD без `next=`: Handoff проверяет действующую техоценку текущего PRD и при
годной записи идёт дальше без повторного предложения. Только без годной записи
для среднего или большого проекта спрашивает о старте Tech Evaluation текстом; без согласия не продолжает и пакет не пишет. Старый размер читается через соответствие Discovery.

Оркестратор собирает определения этапа и разведчиков в `~/.claude/agents/`
под текущий хост: только точные имена файловых, терминальных, вспомогательных,
Linear, дизайн-Paper/Wonder и поисковых инструментов. Никаких звёздочек по серверу.
[Шаблон](templates/stage-agent.md) вне `agents/`, рядом
[хук](templates/stage-helper-hook.mjs) PreToolUse `Agent|Task`, допускающий только
имена разведчиков этапа. Определения/путь хука сверяются при старте и перед запуском; изменение требует новой сессии.
Это ограничение вызовов, не изоляция. Делегированные этапы в Codex не запускаются. Разговор дописывается
сразу в `.claude/session-views/<этап>-<ключ проекта>-<круг>.md` продукта,
при необходимости исключённую через `.git/info/exclude`, со ссылкой в итоге.

Перед утверждением оркестратора и стартом работ другая семья модели читает
текст/версию и причину без подключений владельца; вердикт/модель/версия
вне заборов той же записи. Только она проверяет версию Discovery, Design и Tech Evaluation:
агенты этих этапов вторую модель не запускают; ревью Handoff до записи остаётся.
При любом размере отмеченные автором возражения «по формулировке» вносятся
мелкой поправкой без нового круга: «Поправки по формулировке: было → стало»,
утверждение связано с исправленной версией. Без отметки возражение по сути;
по сути или иная правка текста/причины — новая проверка; макеты, ремонт и
issue-only исключением не пользуются. PRD и Tech Spec до 15 КБ.
Команды второй модели: `--ignore-user-config`/`--strict-mcp-config`, Codex также
`--disable apps --skip-git-repo-check`: без приложений ChatGPT, работают вне git.
Research: дословная команда без обёрток, всегда передний план, таймаут `600000`;
Handoff: Bash без фона с тем же таймаутом; проверяющий тем же сообщением в фоне. Владелец получает итог каждого этапа с «Утвердил сам,
потому что…» и решениями за него первыми. Новые правила вкуса и первые эталоны
по-прежнему его; его слово открывает утверждение заново. Подробности:
[общий разговор](references/owner-dialog.md), [политика](references/orchestration-stages.md).

## Итог и разговор

Этапы Idea, Research, Discovery, Design, Tech Evaluation и Handoff заканчивают
всю служебную работу, затем последним сообщением хода показывают итог, свою
позицию с причиной и один вопрос под ситуацию. После него вызовов нет. Выборы
внутри этапа тоже вопросом текстом, по одному. Окон и готовых подписей ответов
нет. Рамка «следующий шаг» Claude Code Desktop получает только итог, без вопроса
и кнопок ответа. Правила одинаковы в Claude Code и Codex.

Любое ясное согласие с показанным утверждает. Мелкая названная поправка вносится
без повторного показа и называется одной строкой; согласованная версия содержит
только её. Изменение смысла, картинки Design или пакета Handoff требует нового
показа. Вопрос и продолжение мысли — разговор; неясный ответ этап уточняет.
В Linear вне машинных заборов дословно «Владелец: ответил …» и, если была,
«Поправка: …». Idea хранит показанное в `shown.md`, согласованное в `approved.md`;
PRD и Tech Spec записываются по версии исправленного документа.

Ответ относится к заданному вопросу: согласие со стартом начинает следующий
этап только если о старте спросили или владелец сам прямо попросил. «Да, но позже»
утверждает без старта; «да» на уточнение ничего не утверждает. Research документ
не утверждает, только получает старт Discovery. Design утверждает макет в своей
сессии, следующий этап предлагает родитель. Handoff записывает старт показанного
пакета. Передача оркестратору требует прямых слов владельца.

После согласия молча свежее чтение, запись, обратное чтение, команды проверки,
закрытие задачи и проверка этапа; затем одна строка о результате. Посторонняя
смена версии требует нового показа. Машинные форматы и `idea-gate.mjs` прежние,
старые записи с «нажал» действительны. Потерянные файлы восстанавливаются из
показа и ответа в разговоре; нет их — новый показ. Подробности в
[правиле разговора](references/owner-dialog.md).

## Idea с контекстом инициативы

Idea называет найденную связь с инициативой и читает её описание и «Решение»:
цель, ставка и место в карте помогают уточнить замысел. Рамка описания остаётся
словами владельца, утверждение Idea отдельное и словами, как прежде.
Похожий пункт ещё не связь: владелец подтверждает принадлежность до записи.
В шаге записи новый проект создаётся с `addInitiatives`, существующий без связи
получает её тем же полем, затем читается обратно по UUID. Другие связи остаются.
Новый проект, признанный пунктом карты, получает её приоритет при создании;
номер пункта и ссылка на инициативу сохраняются в «Отброшено» брифа для поиска
при повторном входе Initiative. Строка — справочный контекст карты, не выдуманное
прежнее тело; Idea не пишет «Решение». Уже привязанный не требует повторного
подтверждения. Нет инициативы — прежний путь.

Проект карты с двумя строками без брифа проходит обычный Idea без трёх разделов:
прежнее тело записывается целиком в «Отброшено» брифа Linear и читается обратно
перед заменой. Подтверждённая привязка выполняется и при возврате без записи Idea,
когда прежнее тело остаётся. Контекст условный:
[справка Idea](skills/idea/references/initiative.md); обязательное чтение до
20 480 байт. Idea не перенаправляет разговор в Initiative автоматически;
маршрут нескольких проектов указан в описании скилла. Срабатывание проверяется
в `evals/idea/`. До PR после готовности Preflight исполнитель ждёт живой прогон
T3: независимый тестировщик в роли владельца утверждает описание словами на новых
тестовых сущностях в Mono Test. Сущности T2 уже отменены. Оркестратор публикует
«Живой прогон: …» в задаче, передаёт его исполнителю и отменяет новые тестовые
сущности; владелец лично проверяет после выпуска и обновления пака.

## Инициатива перед проектами

[mono:initiative](skills/initiative/SKILL.md) ведёт владелец в своей сессии;
оркестратор этап не запускает и не утверждает. Основа —
[ресерч 20.11.2026](https://linear.app/darkdepot/document/reserch-iniciativy-dlya-etapa-monoinitiative-20112026-cf41dabb60eb):
Linear Method, Shape Up, Rumelt, Seiden, OKR, Amazon PR/FAQ, нарезка срезами
(Wake, Adzic, Patton, Kniberg) и опыт практиков.

Сначала честная классификация: дело на часы — задача и `mono:issue`; один
результат с концом на одну-шесть недель — проект и `mono:idea`; результат,
которого не даёт ни один проект, и видны два и больше связанных полезных
проекта — инициатива. Спорное решается в пользу меньшего.

Инициативу этап разгоняет, а не пересказывает: первым ответом приносит черновик
сильнее слов владельца, спрашивает только то, что её меняет, сам добирает
нужные факты. Описание из шести частей: «Проблема», «Результат», «Как поймём»,
«Ставка», «Не делаем», «Почему сейчас»; рядом документ «Решение: <инициатива>»
с рассмотренными путями, рисками и позже картой. Ограничение или защита только
с названным вредом. Без консилиумов, второй модели и многоступенчатых сверок.

Согласие словами на показанную версию записывается прежним комментарием
`mono-initiative: approved` с хешами описания и «Решения» из обратного чтения;
`node scripts/idea-gate.mjs initiative --mode fresh --dump <папка> --config <конфиг>`
должна дать pass. Первое утверждение переводит Proposed в Planned. Затем карта:
каждый проект называет пользу, а не слой; после любого польза остаётся; первый
проходит весь путь и проверяет главное допущение; обычно два-пять проектов,
зависимости только на более ранние номера. Согласие на карту записывается тем
же комментарием на новую версию «Решения», после pass проекты заводятся в Idea
с привязкой, приоритетом и строкой пункта, в «Решение» пишется «Заведён».
Повтор ищет по `id` и номеру пункта, в том числе в «Отброшено» брифа, дублей
не создаёт; признанный существующий проект получает только привязку, приоритет
и зависимость комментарием. Мелкая поправка после показа по общему правилу
[owner-dialog](references/owner-dialog.md).

PC-001/005/013 по-прежнему допускают проекты карты без брифа до собственной
Idea. Инициативой проекты не запускаются и не делегируются. Повторный вход
продолжает с первого несделанного шага и показывает состояния проектов по
статусу и записи Idea. Обязательное чтение только SKILL, справка Linear
условная; `node scripts/read-budget.mjs --skill initiative --mandatory`.
[Сценарии](evals/initiative/README.md): срабатывание и поведение.

## Tech Evaluation между Discovery и Handoff

Выпущенный в 0.36.0 этап [mono:tech-evaluation](skills/tech-evaluation/SKILL.md) выбирает одно
техническое решение по утверждённым идее, исследованию и PRD. Сначала что можно
не строить и что уже есть, затем минимум, который не придётся переделывать.
Помощник проверяет настоящие случаи путём продукта, только на чтение; другая
семья модели проверяет черновики страницы и Tech Spec (в цепочке оркестратора
это его встречная проверка перед утверждением). Владелец получает одну
страницу до 130 слов, позицию и вопрос об утверждении и старте Handoff,
без технических вопросов.

После Discovery маршрут задаёт одна запись PRD: сначала решение о дизайне,
затем размер. С экраном — Design, потом Tech Evaluation для среднего/большого
проекта или Handoff для небольшого. Без экрана — сразу по размеру. Повторное
утверждение пересчитывает маршрут, прежняя запись без `design=` сохраняет свой
путь до него. Проверка `mono:check tech` и команда
`idea-gate.mjs tech --mode fresh --dump` проверяют запись техлида, версию PRD,
точную страницу, тело Tech Spec и связь с последней записью дизайна.

Размер определяется признаками в [правилах Discovery](skills/discovery/references/prd.md),
а не одним числом задач; при сомнении больший. Research называет предварительный
размер и признак в совете. Discovery утверждает их с PRD и показывает этапы впереди;
в «Кратко» одна строка: «Размер: средний; признак: меняет правило этапа; задач: одна».
Старые слова читаются через соответствие там же, старые записи не переписываются;
маршрут задаёт `next=`. Риск задачи tiny/standard/deep/risky — отдельная шкала.
Design, Tech Evaluation и Handoff называют рост в итоге и до нарезки возвращают
в Discovery на повторное утверждение PRD; нужный техлид идёт до нарезки. У небольшого
на Handoff ростом также считаются больше одной задачи или риск deep/risky.
Понижение только при повторном утверждении PRD; после старта удерживают объём
или ремонтируют пакет.

Новый короткий Tech Spec пишет только Tech Evaluation после утверждения
страницы; Handoff переносит решения в запись пакета и задачи. Разделов без
содержимого нет, отказы, выпуск и откат только по делу. Меняется строка страницы:
возврат к техлиду, после старта через ремонт класса 3 с новым стартом владельца.
Ведёт владелец: ясное согласие с показанным. Ведёт оркестратор: утверждает сам с причиной,
включая необратимое, отложенный пункт PRD и строку против прежнего решения
владельца. Оркестратор запускает Handoff после возвращения этапа; при старте работы его итог
показывает «Техлид решил за тебя:» с этими решениями и причинами. Итог этапа сразу получает владелец. Отложенный пункт переносит
Discovery без второй остановки.
После правки PRD из Handoff этап сам решает, меняется ли страница: прежняя
страница даёт новую запись без показа; меняется строка, новая страница. Во время
первого утверждения другая версия PRD всегда требует нового показа. Второе
исключение: правка ровно отложенного пункта через Discovery.
Формат и порядок записи: [запись техлида](skills/tech-evaluation/references/spec.md).
Явная правка контрактов Tech Spec и проекта по решению владельца 21.10.2026;
их SHA-256 обновлены, доставка снимка задач не меняется.

## Design между Discovery и техническим решением

Выпущенный в 0.36.0 [mono:design](skills/design/SKILL.md) включён вместе
со всеми записями цепи и контрактом проекта. Discovery пишет `design=needed next=design` или
`design=not-needed` с маршрутом по размеру одной записью, причину ниже.
При каждом повторном утверждении сначала заново решается дизайн, затем размер;
смена маршрута снимает нижние записи. Прежний путь определяется отсутствием
`design=`, без даты: до следующего утверждения PRD он остаётся прежним.
Только повторная `not-needed` после записи без `next=` сохраняет его отсутствие;
первая запись обязана иметь маршрут. [Цепь записей](references/lifecycle.md#record-chain)
проверяется командой `route` до любых послаблений, затем каждую нужную запись
проверяет `design`/`tech`. Неверные поля и сочетания — `bad-record`, не отсутствие.

Дизайнер с памятью: подтверждённые эталоны в два кольца, правила владельца и
продукта, экраны с прода. Design работает в Paper и Wonder: слово владельца
для задачи → `design.tool` продукта → `paper` по умолчанию. Нужный инструмент
не подключён — стоп с причиной и предложение второго словами; без молчаливой замены. Фича проходит
референсы, 2–3 направления разной раскладки, сценарии и состояния; правка на месте — одно решение и показ.
Проверка по картинке до показа. Замечания — полными ветками Paper или
сообщениями в сессии Wonder; общее правило, правило продукта или разовая правка.
Память вкуса пишет дизайнер только с согласия владельца. Общий порядок отделён
от условно читаемых справок [Paper](skills/design/references/paper.md) и
[Wonder](skills/design/references/wonder.md). PRD меняет Discovery одним касанием с утверждением макета.

Владелец после Discovery соглашается с показанным PRD и стартом Design: свежая сессия дизайнера получает
задание с PRD, исследованием, памятью и размером. В делегированном проекте эти этапы идут агентами оркестратора;
он выбирает направление по эталонам и вкусу, этап пишет `by=orchestrator`
с причиной и вердиктом противовеса.
Нет памяти продукта — один вопрос «на кого равняться» с предложенными эталонами;
только этот проект ждёт, остальные идут. Итог Handoff показывает решение
дизайнера рядом с решением техлида. Idea остаётся у владельца; старт работы следует правилу делегирования выше.

В сессии дизайна макет показан картинкой в чате, затем итог, позиция и вопрос о макете последним сообщением хода. После записи, обратного чтения и проверки дизайнер
закрывает задачу и пишет строку закрытия. В проекте владельца Claude Code он
пишет `.claude/session-views/design-<ключ проекта>-round-<n>.done` с «Дизайн
закончил», итогом и ссылкой; путь исключён из Git через `.git/info/exclude`,
если ещё не игнорируется. Родитель ставит фоновое ожидание именно этой отметки
при открытии дизайна и молчит. После пробуждения читает отметку, проверяет
`mono-design` командой и показывает итог, позицию и вопрос о старте следующего этапа.
Обсуждение идёт у родителя, правка макета новым кругом дизайна. Папка PNG не
сигнал; межсессионные сообщения не используются. В Codex владелец возвращается
сам, родитель проверяет запись на первом сообщении. В делегированном проекте
конец хода агента возвращает результат оркестратору, отметки нет. Дизайн не
запускает Tech Evaluation или Handoff и не спрашивает о старте следующего этапа.

У продукта песочница в каждом используемом инструменте; прежний файл со
страницами задач становится песочницей без уборки. Ссылки по инструментам этап
пишет в память продукта служебными строками без отдельного согласия. Одна
страница на задачу со всеми кругами. Смена словом в обе стороны: снимки текущей
версии, перерисовка следующей на странице задачи в новой песочнице, в журнале
что перенеслось и что нет; прежние версии сохраняются. После утверждения это
новый круг и новое утверждение. В Paper страница задачи первая в списке; порядок задаётся полным списком
одним вызовом и читается обратно. Отказ: свежий список и один повтор, затем
честный итог, если страница не первая. Имя и иконка обновляются вместе, «✓»
появляется при утверждении и снимается на новом круге. Новые версии с подписью
сверху внутри страницы; утверждённые узлы и PNG неизменяемы, отдельной страницы
«Утверждено» нет. Перенос узлов для разовой уборки старых страниц ещё не проверен:
проба при первой работе дизайна с Paper.

Главный файл один на продукт, отдельно от песочниц: создаётся в `design.tool`
(без настройки Paper) и остаётся там до слова владельца о переносе по снимкам
по разделам. Страница — весь раздел с экранами и состояниями, как на проде;
ссылка, дата, версия и проверенный коммит основной ветки живут в памяти продукта.
Задача в любом инструменте берёт опоры со снимков страниц. До рисунка отсутствующая
страница уже выпущенного раздела собирается целиком: Wonder из кода проверенного выпуска, Paper по снимкам
живого продукта той версии. Актуальность сверяется между коммитом раздела и
проверенным коммитом выпуска из доказательства доставки; невыпущенные слияния
не основание обновлять опору. Изменения экранов между этими границами или отметка
«устарел» требуют обновить весь раздел до рисунка, включая соседние состояния.
Раздел ещё не выпускался — только песочница задачи и служебная строка «нет
выпущенной основы», без страницы и выдуманного коммита. Сверка только с выпущенными
соседями, если они есть; итог — «раздел ещё не выпущен, сверять не с чем».
Страницу заводит Design при следующем входе после первого подтверждённого выпуска.

До показа агент снимает страницу раздела и сверяет соседние экраны и состояния;
расхождения входят в итог. Главный инструмент недоступен — «не сверено» с причиной,
показ продолжается. Утверждение главный файл не меняет. При следующем входе после
выпуска Design заменяет только затронутые экраны по живому продукту, записывает дату,
версию и отличия от утверждённых PNG. Непроверенные соседние изменения не дают
продвинуть проверенный коммит или снять старую отметку. Нет инструмента либо
обновление не удалось — сообщение и «раздел устарел после выпуска <дата>»;
итог выпуска сохраняется. Служебные строки пишутся без согласия, правила вкуса
по-прежнему только дизайнером с согласия. Синхронизация принадлежит Design;
Deploy поставляет доказательство доставки, но главный файл не обновляет.

Утверждение связывает `canvas` (HTTPS-ссылку на макет), `tool=paper|wonder`,
неизменяемую папку PNG и версию PRD. Старое `paper=` без новых полей читается
как `canvas` с `tool=paper`. Смесь видов, неполная пара `canvas`/`tool` и
неизвестный инструмент дают `bad-record`; повреждённая последняя запись
не заменяется более ранней. В Wonder `take_screenshot` в режиме `full` на каждый
артборд; клиентский PNG либо отрисовка `get_element_code` с контекстом, шрифтами
и заливкой корня. Агент сравнивает отрисовку со снимком Wonder: расхождение
блокирует утверждение. Большие экраны по секциям. Встроенный чат ведёт этап
только при видимых Mono и Linear; до живой пробы основной путь — сессия этапа.
Целый экран, Codex и чат ждут первой задачи после выпуска.
UI-задача получает строку дизайна и пути к памяти/картинкам, применимые правила
обоих слоёв текстом в снимке контекста. Задачи без макета, включая без проекта,
применяют правила. Диспатч кладёт PNG конкретной записи в снимок задачи вне
рабочего дерева и коммита; исполнитель читает оттуда. Live QA Deploy в браузере
сверяет изменённые экраны с этими PNG и вкусом; расхождения исправляются обычным
hotfix до показа владельцу. Начатые проекты с утверждённым прежним прототипом
сохраняют его как опору проверки.

Техлид читает макет; пункт на утверждённых экранах возвращает в Design новым
кругом, пункт вне экранов может отложить строкой страницы: Discovery правит PRD,
Design обновляет запись тех же картинок без показа, затем Spec/`mono-tech`.
Повреждённая запись блокирует цепь; её писатель отдельно проверяет входы,
восстанавливает утверждённое или получает новое согласие и пишет замену.
Полная проверка остаётся FAIL до успешной проверки новой записи и цепи.
Контракт PRD не меняется; PC-001 и его отпечаток изменены явно.
Откат возможен до первой записи нового формата, дальше только исправление вперёд.
Design и Tech Evaluation выпущены вместе в 0.36.0. Приёмка трёх идей по PRD
описана в [обновлении до 0.37.0](UPGRADING.md#обновление-до-0370).
[evals/design](evals/design/README.md) проверяются при изменении описаний или evals;
обязательное чтение Discovery и Handoff — до 20 480 байт каждый.

## Задачи этапов и Ready

Research, Discovery, Design и Tech Evaluation сначала находят или
заводят свою задачу с меткой `Этап` (`Research: <проект>`, `Discovery: <проект>`
и так далее). У Idea и Handoff задачи этапа нет. Записи о ходе работы — в
комментариях задачи, результат — в документе проекта; задачи этапов не входят
в набор задач реализации.
Правила повторного входа, роли и единое определение задач реализации — в
[«Задачах этапов»](references/lifecycle.md#задачи-этапов), форма поручения —
[в шаблоне](templates/stage-task.md). Каждый этап отвечает только за свою задачу.

Discovery: дамп своих чтений по «4. Проверить» Idea с `body` всех комментариев;
нет сырых ответов MCP — не причина пропуска. До перехода `route` pass и check PASS.
Handoff: после записи и обратного чтения пакета/задач один вызов `mono:check`
на `handoff` и `issue` всех задач на таком же дампе; этап выдаёт отчёт проверки
по шаблону со строкой статуса на каждый режим отдельным сообщением; Ready следующим шагом, только при PASS обоих. Своя сверка не замена, нового круга ревью нет.
В «веди до Handoff» и «веди сам» больше трёх задач разрешает оркестратор с причиной,
без отдельного противовеса; запись принимает ответ владельца или оркестратора.
Ready — готовность, не старт: обычный проект и «до Handoff» начинает владелец;
делегированный — оркестратор с причиной/противовесом. Нет Ready — остаётся Discovery.
Реализация из Ready, старый проект или нет Ready — из Discovery после проверок.
Крупная правка снимает старт; класс 3 старого пакета возвращает Delivery/Ready в Discovery.

## QA перед вливанием

После зелёного ship оркестратор подключённого продукта зовёт `mono:qa` на хосте;
с `qa.earlyStart: true` (по умолчанию выключено) раньше, после подтверждённого
отчёта code для опубликованного head. Подготовка deploy и очередь посадки ждут
зелёные Ship и QA одного head. Баги тестировщика делятся на блокирующие (не выполнен
пункт «Готово, когда» или R/AE, регрессия, данные, безопасность, падение) и
наследников. Вливание держат только блокирующие: исполнитель чинит их на той же
ветке без смены договора задачи и без новой попытки. Наследники вливание не держат
и после него становятся новыми задачами. Со второго прохода по задаче перепроверка
обязательна: живьём упавшие, новые, изменённые, экраны задетых файлов и короткий
дымовой набор, остальные пункты переносятся с доказательствами head, где их видели
(блок `recheck` и `purpose: change` в ожиданиях). Полный проход задачи только с
записанной причиной (`fullPass`), полный список на последних воротах один раз
(`fullPass.final`); финальный проход проекта и выпуск остаются полными. Лимит
прохода: перепроверка 60 минут, полный 120, непроверенное `unverified` с причиной.
Последняя задача реализации
с невлитым PR дополнительно ждёт финальный проход всех R/AE PRD на текущем составе сборки.
Изменился состав — финальный сертификат больше не годится. Правка без поведения
проходит с коротким сертификатом и причиной; продукт без рецепта продолжает
прежний путь с записью «тестировщик не подключён».

Сверка экранов до ревью: при рецепте QA задача с макетом в снимке получает пин
`screenCheck` (по умолчанию включено, `qa.screenCheck: false` выключает; при проверке
на хосте сверка уступает, а явное `true` вместе с ней отвергается). На голове
первого запроса сбора оркестратор на хосте прогоняет `mono:qa` в `given-version` только по
пунктам PNG и вкуса; первый круг ревью ждёт результат этой головы, не тратя круг.
Расхождения уходят исполнителю одним «Изменением задачи», исправленная голова
сверяется снова. Исполнитель экраны не снимает, новых стоянок у него нет; видимость
у него `unverified`, пока нет отчёта хоста о той же голове. Сверка и QA делят один
стенд, QA после Ship остаётся полным: [Screen check before review](references/orchestration-delivery.md#screen-check-before-review).

Последнюю задачу определяет состояние PR в GitHub: задача закрывается при
вливании своего PR. После последнего merge финальная
проверка по-прежнему нужна перед установкой. Сохранённый finalIssue не заменяет
свежие сведения о merge. Единственный невлитый PR становится финальным даже
после завершённой удержанной цепочки. При нескольких невлитых PR удержанная
цепочка должна включать их все, иначе ворота отказывают; после всех merge
финальной остаётся последняя влитая задача, включая задачи удержанной цепочки.
Неоднозначный порядок последних merge блокирует установку.
Полный набор head нужен при проверке проекта; ранней задаче достаточно своего
сертификата, даже если у будущих задач ещё нет PR.

Хостовые входы и команды: [Independent QA before merge](references/orchestration-delivery.md#independent-qa-before-merge).
Состояние `waiting|failed|passed|not-connected` одинаково для подготовки deploy,
очереди и `delivery-state.mjs qa-status`. Подготовка использует прочитанный обратно
ship-сертификат и не требует регистрации исполнителя; без рецепта не нужны и
локальные файлы ship. Наблюдатели читают единый конфиг хоста, а не копию исполнителя. Пак подключается терминальным рецептом;
примеры вымышленного продукта в справочнике подключением не являются.
Проверка после выкладки сохраняется.

## Workflow

Short dispatch extracts PRD/Tech Spec definitions through the [U12 snapshot markup contract](references/orchestration-dispatch.md#snapshot-markup-contract-u12): parse blocks, then select coverage; unknown IDs refuse, while duplicates or unclosed fences retain full documents.

A **wave** is the work dispatched for an Issue, including retries, review, and its eventual delivery or recorded stop. A green PR is ready for deploy; deploy supplies the merge, delivery verification, and Linear closeout.

```text
raw idea → recorded owner approval → Project in Idea → owner or delegated orchestrator starts Research (Project status Discovery) → Discovery → Design when needed → Tech Evaluation by size → Handoff: reviewed package record, Issues, Ready
→ owner or delegated orchestrator starts work → start handshake → one mono:deliver worker
    code → worker's own Linear writes, read back → local readiness → certificate
    → PR → reviews and checks → green certificate
→ mono:deploy → verification → Linear closeout and project update
```

1. **Capture.** `mono:idea` shows the complete four-section description, position and contextual question as its final message. The owner agrees in words. Only the named small correction is added; record and verify before any authorized Research start. Orchestrated Idea requires the exact shown text, question and verbatim owner reply.
2. **Research.** `mono:research` checks Idea and reads the project Brief before moving to Discovery, gathers facts, then adds up to three sourced findings to the Brief without approval. It reads back the document and stage log, verifies and closes its task before the final result. It asks only about starting Discovery, never about approving the Research document.
3. **Discover.** `mono:discovery` starts from the project Brief and studies the product and Research, asks unknown meaning questions one at a time in text, compares outcomes and prepares the PRD before its final summary, position and question. Record the corrected document version, design route and exact reply before closing and checking the stage.
4. **Design.** `mono:design` reads the project Brief and uses product memory and exemplars and shows checked mockup images before its final text summary, position and approval question. An image correction needs a new show. Record immutable PNGs, verify and return to the parent; Design does not start the next stage.
5. **Evaluate.** `mono:tech-evaluation` reads the project Brief and checks the solution and shows its page, position and contextual question as its final message. Approval records the corrected Tech Spec and exact owner words; Handoff starts only when authorized.
6. **Package.** `mono:handoff` reconciles the Brief with approved inputs before recording, reviews and records the package and execution Issues, checks each and sets Ready before its final summary, position and start question. Work starts only on agreement to that question or explicit owner words; delegation needs an explicit request.
7. **Start.** `mono:implement` verifies pack identity, the approved package, start authorization, and the five-field context seam. For an orchestrated lifecycle move, the worker emits a gate acknowledgement before the orchestrator applies and reads back the move. In codex-cli `handshake: wait`, it waits in place for verified consumption and checks delivery on those read-backs; `resume` (default) retains exit and same-thread resume. Expiry parks `write-unconfirmed`. Product `stallSec`/`ackWaitSec` and watcher startup validation keep the wait within the existing monitoring window.
8. **Implement and prepare.** `mono:deliver` sequences `mono:implement`, `mono:preflight`, and `mono:ship` in one context. Implement exactly one approved Issue. Record every verification item verbatim, perform targeted checks, commit, and pass the collection's review round (`clean` or `clean-with-successors`; one round on the fast path, then the worker's full verification on the final head; at most three on `risky`) and verification. Record the ready certificate. `profile: short` is limited to tiny/standard, `critical: null`, `afk: true` and `openDecisions: 0`: targeted checks, commit and orchestrator collection remain mandatory. The worker writes its own Linear comments and statuses and reads each back; the collector started with the attempt runs each review round from the worker's round request without an orchestrator turn. Start facts live in the code report; the Russian ready-certificate comment retains its machine block. Review runs only in the external collection on a committed head, for every transport; managed Claude Code's ready certificate also names its stop/resume startup. Preserve phase ownership.
9. **Ship to green.** Preflight opens the PR as a draft at its first collection request (`scripts/ship-pr.mjs open`, secrets checked before every push where GitHub push protection is off) and feeds the bot remarks, failed CI checks and owner instructions it fixed into the next review round (`prRemarks`), where they close only when the checker verifies the fix. Ship writes the description for people in Russian from `templates/pr-body.md` (`ship-pr.mjs body`, rewritten after every round: the author's part between Ship's markers names its head and publication time (PR activity cannot move Deploy's boundary; republish a legacy body without that time), a bot's block outside them is kept, and Ship itself writes the «Проверки» line in which only finished successful checks are «прошли»), synchronizes accepted drift, settles every other remark through a read-only pass (`ship-pr.mjs check`), leaves draft (`ship-pr.mjs ready`) only with a clean receipt on the head, no failed CI and every remark settled, and writes and reads back the Linear status. A bot remark that needs code (a P1, or a P2 the worker accepts) and a failed CI check become a ship fix in the same worker session, with no return to draft, park, task change or orchestrator turn: fix, full verification (the worker's, or the round's own with host verification), push, a review round under the path's rules with the remark in `prRemarks` (fast path: the verified fix is confirmed without a second round), a reply with the Ship marker in the thread and resolve, then the next ship-gate attempt with a new state file. A P2 without a fix gets a reasoned reply or becomes a harmless successor. Ship parks only for a decision: disputed substance, out-of-contract work or raised risk, `needs-decision` (the strict path after its third round, or after its extra fourth), or an unavailable environment. Ship speaks Russian to the owner: one to three product lines above the certificate name the attempt, the review rounds spent of three (4 of 4 with the extra round) and the wait out of its limit. Run by hand in the owner's session, Ship needs a branch with a ready Linear Issue and a clean receipt on the current head from the Issue's collection; otherwise it refuses with the reason, and without permission to post replies it stops with «нет права публиковать ответы». Complete required pre-ship review and readiness checks, and the configured documentation workflow before green. Wait for current-head CI and the bounded task bot outcome. Emit the green certificate only after all ship conditions pass and its Linear comment reads back.
10. **Deploy and close.** `mono:deploy` merges the pinned green head after its pre-merge gates; without a deploy.targets block it closes «выкатили, не проверено» with that reason and no project update, and an invalid block refuses. With a block it proves the actual version and checks the Issue scenario/product health. Close the Issue on merge with a truthful comment. New repeated browser failure against a green previous build permits rollback and one repair. Only proven delivery earns a project update; only shipment of its last open Issue may complete a Project. Retire the delivered worker after closeout.

Stages rebuilt under «Mono как продукт» and their shared host reference
`references/owner-dialog.md` are written in Russian; machine tokens
(commands, paths, keys and codes) stay English. Other skills remain English;
Linear templates/examples stay Russian. Idea and Research use `scout`, resolved by
`idea-gate helper` for `claude-code` or `codex`; `models.roles.scout` overrides
the host default from the [roles table](references/model-policy.md#roles).
The `idea-helper` role is retained for now; removal is a separate task after 0.34.0.

Idea reads its own `references/` beside the skill; `<корень>/` resolves to the
pack root (`../..` from the skill folder). The Project contract is a conditional
read before body writes; Idea does not eagerly read the product's `AGENTS.md`.
Verified-record recovery applies only when the current request neither changes nor
adds to the idea; changed input takes the normal updated-description/owner-yes path.
`node scripts/read-budget.mjs --skill idea --mandatory` reports its required
corpus, explicitly including both scout task files; the complete mandatory set stays
below 20,480 without conditional reads. The recording reference and
the Project contract are conditional and are read while the scouts search, before
the description is shown; launch-context dialogue lives in conditional
`references/owner-dialog.md`. Scout definitions are read
by the scouts themselves, not by Idea: Codex receives absolute definition paths
and tells each subagent to read its own file first, skipping frontmatter. Both
English read tiers stay valid for every stage. [The shared Russian-stage list](scripts/russian-stages.mjs)
(Idea and Research) enables Russian labels, colon conditions, the first-`AGENTS.md`
exemption and conditional Project-contract reads; later Russian stages add themselves
there. Package-root paths and each skill's own reference folder are checked by the
same resolver in plugin validation, workflow validation and reading counts.
Research mandatory reading is measured by `node scripts/read-budget.mjs --skill research --mandatory`;
all listed Russian stages have the same fixed 20,480-byte limit.
Research activation cases live in [evals/research](evals/research/README.md).
Handoff is a listed Russian stage too: `node scripts/read-budget.mjs --skill handoff --mandatory`
counts exactly `SKILL.md`, `references/run.md` and `references/examples.md`; record,
review, scout and repair rules are conditional. Its activation cases
live in [evals/handoff](evals/handoff/README.md).
Tech Evaluation uses the same three mandatory files and 20,480-byte ceiling;
`node scripts/read-budget.mjs --skill tech-evaluation --mandatory` measures it.
Design reads exactly its SKILL.md and references/run.md eagerly; drawing, memory and
approval references are conditional. Measure with
`node scripts/read-budget.mjs --skill design --mandatory`.
`mono:check` is a listed Russian stage too: it reads its SKILL.md, the readiness
gates and the check output template eagerly, then only the mode file it runs
(`references/before-work.md` or `references/delivery.md`; Project-first `delivery`
also reads the record chain from the first); measure with
`node scripts/read-budget.mjs --skill check --mandatory`.
Activation cases: [evals/tech-evaluation](evals/tech-evaluation/README.md).
Claude validation, skill-doctor and host tests run on the preflight-ready head
before ship; activation evals rerun only when skill descriptions or eval cases
change. MONO-251 prepares 0.38.0; the orchestrator runs Claude validate,
skill-doctor and eval before ship, then live acceptance after installation.
The Project stays open until every PRD acceptance item has a recorded result.
The Russian `<корень>/` prefix belongs to listed stages; English stages use
`<pack-root>/` in commands.
[Activation evals](evals/idea/README.md)
contain 10 positive and 7 negative prompts, three runs at threshold 0.8; the
orchestrator runs Claude-only checks on the final head. Stage behavior is accepted
live after 0.32.1, not by these activation scores.

A returned Project with unchanged What / Why / Target outcome keeps its body,
package and status: show all four sections, deriving Unknowns from description
and scout facts, then record and verify. If the owner corrects those three
sections, a Project without an approved package writes the approved body and
preserves the replaced text verbatim in the Brief’s «Отброшено»; Idea never moves status. With an
approved package, stop before recording and route the correction through
`mono:handoff` artifact repair, then return to Idea recording and verification.
Without the three sections, run the normal stage with the owner. Idea creates or
updates a separate Project Brief from the conversation and scout facts; it reuses
the document identified by its project-bound `mono-brief` block, including on return.

### Artifacts and truth

`idea-gate.mjs record --draft APPROVED --config CONFIG --out DIR` готовит
`body.md`: три раздела Idea с заголовками второго уровня. С `--project UUID`
обязательна `--brief URL`: команда создаёт `comment.md` с прежней строкой
утверждения, точным четырёхраздельным снимком и строкой «Бриф: <ссылка>» вместо
блока заметок. Отпечаток и проверка записи Idea не меняются: старая запись с
заметками проходит `verify` и `check --mode fresh`. Комментарий без завершающих
переводов строки; лишний `##` или текст вне четырёх разделов дают
`unsupported-format` до записи файлов.

Idea после проекта и до комментария создаёт или обновляет документ
«Бриф: <проект>» по [справке брифа](references/brief.md), читаемой только по условию.
Пять разделов: «Суть сейчас» на один экран, «Как это видит владелец», «Решения и
повороты», «Что знаем», «Отброшено»; пустые опускаются. Поиск по последнему блоку
`mono-brief` с UUID проекта, один документ на проект. Заменяемое тело дословно
уходит в «Отброшено» внутри забора длиннее всех серий обратных кавычек в нём.
После публикации комментария Idea сразу добавляет его ссылку к своей строке
решения и читает бриф обратно; сбои переиспользуют документ и комментарий.
Research, Discovery, Design, Tech Evaluation и Handoff читают бриф на входе.
Строка «Бриф:» записи Idea указывает документ: без неё проект идёт по прежнему
пути; ссылка без документа с блоком этого проекта даёт FAIL к Idea в проверках
Discovery, Design, Tech и Handoff. Research строит рамку по брифу, без него по
«Что всплыло», затем по описанию и неизвестным. Его частный `brief.md` это рамка
исследования; одноимённый файл для Design это задание дизайнеру.

После исследования Research без утверждения дописывает до трёх находок со
ссылкой. Discovery, Design, Tech Evaluation и Handoff отражают утверждённое
решение, поворот и устаревшее со ссылкой на согласие; без согласия новая мысль
остаётся в «Открыто». Новые мысли владельца пересказываются, ответы оркестратора
в этот раздел не идут. Каждая запись читается обратно. До записи пакета Handoff,
включая ремонт, приводит бриф к последнему действующему утверждению PRD или пакета, называет
пропущенный этап и снятое расхождение в итоге; возражение ведёт в Discovery или
ремонт без отдельной остановки. Каждый этап называет конкретную опору и отмечает
переспрос уже сказанного. После отмены прежних согласий при ремонте класса 3
бриф следует новому утверждённому PRD; отменённый пакет его не откатывает.
Ship и реализация бриф не ведут.

Сверка QA восстанавливает правки брифа через `save_document` patch. Для
`op: replace` без `replace_all` исходная строка должна встретиться ровно один раз;
с `replace_all: true` заменяются все совпадения, но нужно хотя бы одно. Привязка
полного чтения и последний блок `mono-brief` проверяются как прежде.
`insert_before` и `insert_after` требуют привязанного нативного чтения того же
документа, ровно одного совпадения `anchor` и совпадения результата с обратным
чтением; отсутствующий или неоднозначный якорь отвергается.
`replace_range` заменяет текст от единственного `from` до единственного после него
`to`; сам `to` остаётся на месте. Патч описания задачи (`save_issue`) применяется
теми же правилами к описанию, которое вернула предыдущая запись этой задачи.
Ссылка согласия в строке брифа — полный Linear URL записи с `#comment-<uuid>`,
не голый id. При сверке Handoff итог явно называет этап пропущенного решения.

`--brief-draft FILE` передаёт черновик с первых вызовов, в том числе без проекта:
он даёт прежние предупреждения о длинных тире и несуществующих путях, но не
копируется в комментарий. Ссылка `…/blob/<ветка>/<путь>` проверяется на этой ветке
(локальной или `origin/`, только чтение git), путь в обратных кавычках в checkout,
где запущена команда; чужие репозитории и коммиты не проверяются. Вне checkout
черновик с путями даёт `"paths":"unchecked"`. Предупреждения не блокируют запись.

`idea-gate.mjs verify --project UUID --dump DIR --expect COMMENT --config CONFIG`
читает ответы Linear как есть: `project.json`, `comments-1.json`, `comments-2.json`…
Рядом с каждым ответом сохраните `comments-N.request.json` с фактически переданным
cursor: `{}` для первой страницы, `{"cursor":"…"}` для следующих. Каждый следующий
запрос должен продолжать cursor предыдущего ответа; перенумерация файлов не
заменяет эту цепочку. Нужны все страницы: `hasNextPage`, cursor последнего
комментария на промежуточных, без cursor на последней. Достаточно полей, которые
читает скрипт (`uuid`, `createdAt`, `status.name`, `description`; `comments`,
`hasNextPage`, `cursor`; у комментария `id`, `createdAt`, `updatedAt`, `body`), их
значения не меняются. Для `verify` у комментариев без записи утверждения `body` можно
опустить; `check --dump` требует все тела.
UUID берётся из `uuid`, а не из человекочитаемого `id`.
«Готово» означает `pass` для комментария `--expect`: при сравнении снимаются только
завершающие переводы строк с обеих сторон, остальной текст совпадает байт в байт.
Изменение тела проекта даёт
«Нужно новое утверждение», ошибка чтения или записи — «Стоп» с действием. Вторая строка —
JSON с машинным кодом. Скрипт не обращается в Linear.
Состав dump и команды также описаны в `node scripts/idea-gate.mjs --help`.

`idea-gate.mjs helper --host claude-code|codex [--config CONFIG]` возвращает
модель и усилие [role:scout](references/model-policy.md#roles); переопределение —
`models.roles.scout`. Три агента плагина в `agents/` только читают Linear, код и интернет;
В Codex встроенный субагент сам читает своё определение по абсолютному пути,
пропуская шапку; ведущий этапа передаёт задание и контекст. Роль `idea-helper`
пока сохранена; удаление отдельной задачей после 0.34.0. Добавляйте переопределение `scout` только
после установки выпуска 0.32.1 во всех затронутых продуктах и хостах.

`scripts/idea-gate.mjs` проверяет запись «да» по снимку без сети.
`check --mode fresh --dump DIR --config CONFIG` читает сырые ответы Linear в той же
раскладке и с теми же проверками страниц и курсоров, что `verify`. Язык из конфига:
`Russian` → `ru`, `English` → `en`, либо `ideaGate.headings`. Команда сравнивает текущие Что/Зачем/
Образ результата с записанными Неизвестными; `check --mode approved --snapshot DIR` проверяет целостность
записи без сравнения текущего тела. Принимается новейшая корректная запись проекта
или подтверждённое одобрение пакета до отсечки. Старый проект без записи входит
в пакет с `legacy-migrate` только в режиме `fresh`; задача без проекта требует
`approved-fresh`. Handoff проверяет `fresh` на входе: при `stale` или
`legacy-migrate` текущая идея входит в итог, а запись старта владельца несёт идею
и `approval_status=approved`. Новый проект с `no-record` возвращается
в `mono:idea`. Проверки delivery и implement требуют `approved`;
проверка Discovery допускает `pass`, `stale`, `legacy-migrate`. Проверка `fresh` в
Research, check discovery и Handoff использует только `--dump`; dispatch сохраняет `approved --snapshot`.
Вывод: `idea-gate: pass|fail: <code> project=<id>`, при проходе ещё JSON.

Discovery пишет в PRD решение по каждому Н Research. Handoff берёт утверждённый PRD на чтение и PRD не пишет; запись пакета называет запись «да» и выбранное Discovery «Исследование», запись старта ссылается на то же «Исследование»; при `stale` сохраняются исследованные неизвестные.
Dispatch и receipt связывают результат проверки и снимок, включая проход до отсечки без записи.

Проверка Research перед запуском работы: `node scripts/idea-gate.mjs research
--snapshot DIR [--config CONFIG]`. После проверки Idea dispatch требует документ,
названный в одобрении пакета, и один JSON-забор `mono-research`: UUID проекта,
`outcome` (`ready`, `hold`, `not-required`) и непустую причину у последних двух.
Лишние поля разрешены; проза и другие документы проекта не влияют на результат.
Снимок содержит `research/document.json` (`id`, `url`, `title`, `projectId`) и
`research/document.md`; сборка описана в [Orchestration](references/orchestration-dispatch.md#orchestrator-dispatch-command).
Вывод одной строкой: `research-gate: pass|fail: <code> project=<id>`.
Отказ не расходует попытку. Задача без проекта и пакет с `approval.createdAt`
строго до `researchGate.since` проходят без каталога `research/`; имеющийся каталог
копируется в снимок попытки. Необязательный `researchGate.since` — дата `YYYY-MM-DD`
по UTC; неверная дата, в том числе явный `null`, даёт `bad-since`. По умолчанию
`RESEARCH_GATE_DEFAULT_SINCE` — `2026-10-19` (00:00 UTC), проверка включена с
0.33.0. Сдвиг `researchGate.since` вперёд откладывает её для новых запусков
продукта. Проверка работает только по снимку, без сети.
Прежний реестр живой пробы и новый блок проверяются [фикстурами](scripts/fixtures/research-gate/README.md).

Необязательный `ideaGate.since` принимает дату `YYYY-MM-DD`; без него действует
`2026-10-18` (00:00 UTC, проверка включена с 0.32.1). Неверная дата даёт `bad-since`. `ideaGate.headings`
переопределяет все четыре заголовка, например
`{"what":"Что","why":"Зачем","outcome":"Образ результата","unknowns":"Неизвестные"}`.
Defaults normalize `Russian`/`English` from config (or `project.language` for a snapshot without a configured language) to `ru`/`en`. Snapshot examples and
live Linear serialization samples: [fixtures](scripts/fixtures/idea-gate/README.md).
`fingerprint --snapshot FILE --config CONFIG` hashes the four sections as canonical UTF-8 bytes;
inline code and fences remain literal. The project body stays unchanged.
Known limitation: inline code spanning multiple source lines refuses `unsupported-format`.

`node scripts/idea-gate.mjs initiative --mode fresh --dump DIR --config CONFIG`
проверяет согласие владельца на инициативу без сети. Дамп содержит сырые
`initiative.json` (`get_initiative` с `includeProjects`, статус строкой),
`decision.json` (`get_document` или `list_documents`) и полные страницы
`comments-N.json` с фактическими `comments-N.request.json`, как выше.
Действует последняя запись `mono-initiative: approved` по `createdAt`, только
`by=owner`; проза вне забора не участвует. Хеши описания и решения считаются
по обратному чтению: строки «Заведён» исключены, теги проекта/задачи заменены
на `id`, маркеры списков и угловые скобки адресов ссылок приведены к одной
форме, пробелы в конце строк убраны, повторные пустые строки сжаты.
«Есть проект» входит в хеш; переименование тега его не меняет.
`updatedAt` сущностей не служит версией, у комментария он может быть раньше
`createdAt`. Вывод: «Готово» или «Стоп: …», затем JSON с `code` из `pass`,
`no-record`, `stale-brief`, `stale-decision`, `bad-record`.
Обезличенные живые образцы и происхождение —
[фикстуры](scripts/fixtures/initiative-gate/README.md).

| Surface | What belongs there |
| --- | --- |
| Linear Project body | Idea: what, why, target outcome; Handoff leaves it unchanged (legacy packages may carry in scope and out of scope) |
| Project metadata, resources, comments | Lifecycle, active documents and Issues, relationships, approvals, review disposition, the package record and the owner's start |
| Research («Исследование») | Facts, confidence, unknowns and advice before choosing a solution |
| PRD | WHAT: actors, problem, workflows, requirements, acceptance and success |
| Tech Spec | HOW from Tech Evaluation after page approval, or a legacy package; only relevant contracts, impact and validation, failures/release/rollback when applicable; old-path shared HOW stays in the package record |
| Issue | One-PR execution contract, dependencies, AFK/HITL readiness, context snapshot, acceptance and verification |
| GitHub | Branch, PR, code review, CI, deploy and merge history |
| Worker report | Phase, exact head, decisions, collection request and verification result; Linear comments/statuses are written by the worker through Linear MCP |

Keep whole PRD and Tech Spec bodies out of Issues. Link them through Project resources and Issue references/snapshots, following [references/linear-links.md](references/linear-links.md) for each entity's format. Use stable requirement and acceptance IDs when required by risk. Prefer one Issue; a second and third need a named reason (`too-big`, `shared-base`, `probe`), more need the owner; Issues touching the same surfaces are chained. Mark **AFK** when an agent can execute alone, or **HITL** when a named human action remains. For a bug or performance issue, carry reproduction/baseline and fix-proof expectations, or an explicit reason that the symptom cannot yet be reproduced.

Handoff counts a change expected to exceed roughly 1,000 lines in critical paths (gates, release, security, data) as `too-big` and splits it into smaller one-PR Issues with verifiable contracts and dependencies.

### Issue-only work and repair

`mono:issue` ведёт маленькую самостоятельную задачу без проекта по-русски:
один PR, риск tiny/standard, нет продуктовых вопросов и связей с Project/PRD/Spec.
Иначе причина и Idea или Handoff, без создания задачи. Все
[девять условий](skills/issue/references/run.md#девять-условий) сохраняются.
Ревью standard до показа даёт ready; tiny допускает записанное исключение.
До показа владельцу перечитанное живое тело проверяется резолвером с черновым маркером из пяти полей; «Ревью-гейт» называет ровно один класс.
Владелец видит до 120 слов: изменение, проверка, исключения и ссылка, затем
позиция и один вопрос. «Да» утверждает и запускает, «да, но позже» ждёт «запускай».
Отпечаток и прежние пять полей остаются внутри, автор проверяется по ownerPrincipal.
Правка требует «Было / Стало» и нового согласия, отзыв блокирует старт;
[порядок и таблица восстановления](skills/issue/references/decisions.md) задают
шаги записи и сбои. После одобрения обязательны новое чтение задачи и комментариев
из Linear, сверка автора и отпечаток перечитанного живого тела; после маркера
отдельная `mono:check issue` до PASS. После правки новый отпечаток также берётся
только из перечитанного тела. Скилл исполнения читается после записи старта,
даты и «вчера»/«сегодня» владельцу по его часовому поясу, в итогах нет служебных слов. Справка даёт команды от сохранённого JSON get_issue до извлечения description и отпечатка
именно этого тела; каждый разрешающий ответ, включая второй в сессии, проходит
полный цикл с отдельной проверкой готовности. Оркестратор показывает итог дословно, передаёт вопрос и ответ,
сам задачу не утверждает; после перезапуска возвращает в этап не начатые
кандидаты с меткой issue-only без approved-fresh. Отложенные и отозванные не
запускаются. Даже для approved-fresh перед стартом после Resume заново нужна
отдельная mono:check issue до PASS. Если после снятия метки ответ потерян,
до нового показа этап закрывает оставшийся разрешающий маркер через superseded;
без подтверждённой записи новый показ не проводится. Заморозка начинается после
сертификата mono:preflight ready, а ready ревью до показа ей не равен.
В сессии владельца mono:implement идёт здесь, в оркестраторе он
запускает исполнителя после подтверждения. Начатые по старым правилам задачи
продолжаются без нового согласия. Формат и резолвер прежние. Окно перед стартом
и неизвестный после перезапуска незаписанный отзыв остаются принятыми ограничениями.

Use `mono:handoff` for [Project-first repair](references/repair-machine.md#classification-table): classify the exact proposed change, obtain report-only review, apply the class-specific worker, snapshot, approval and lifecycle effects, then check readiness. Risk growth or ambiguity raises the class. Review never repairs; `mono:check` never mutates. Accepted pre-ship drift belongs to `mono:ship`.

## Gates

A gate proves only its stated boundary. `mono:review` returns quality/risk findings (`ready`, `advisory-ready`, `needs-fixes`, `blocked`); `mono:check` reports inspected readiness (`PASS`, `FAIL`, `BLOCKED`). Neither silently changes an artifact. Their judgments supplement executable checks.

| Gate | What it proves |
| --- | --- |
| Package review and approval | Before writing: one Issue, any risk including tiny, both reviewers in one round; wording fixes without a round, P0/P1 substance fixes rechecked by finder or refuted by source. Multiple Issues retain up to three rounds and tiny advisory/reason. Implementation needs start authorization |
| Pack identity / `gate.mjs start` | Installed pack is compatible under [the versioning rule](references/install.md#compatibility); branch, base and clean worktree match the start request |
| Start handshake / delivery check | The worker checked snapshot, approvals, resolved findings and context seam; the orchestrator applied/read back lifecycle changes; the updated package is ready for code |
| `gate.mjs preflight` | Current committed head/merge-base has an authentic receipt with review `clean` or `clean-with-successors` and the worker's verification exit 0 on that head; missing, stale, fabricated, old-format or incomplete evidence fails |
| Pre-ship review and check | Diff matches the Issue, readiness is recoverable, required review is complete, artifacts are current and accepted drift is synchronized |
| `gate.mjs ship` | PR is open on the certified head, mandatory CI covers that head and the task bot wait is settled, threads and bot remarks are resolved/disposed, closure replies are published, no own review draft or outstanding change request remains, and mergeability is acceptable under policy |
| Independent QA before merge | Connected products require current-head task QA; held final work also requires project QA matching the current build. Ship green precedes this gate. A recipe with `beforeMerge: false` turns it off: QA runs on request and before a release |
| Deploy verification and live QA | Certified change was merged and delivered to the target; acceptance was checked where consumed, with explicit evidence or a permitted recorded skip |

Ship also requires recorded valid outcomes for pre-ship review, readiness, and documentation. Apply only the repository's accepted check exceptions. Pending or unknown evidence is not success; terminal failures stop the gate. A new head invalidates its old proof. The gate accumulates evidence on the current head, waits the configured quiet interval after events, and stops at its deadline rather than waiting forever.

Configure PR bots with `orchestration.ship.botChecks`: unique names, default
`["Greptile Review"]`, or `[]` for no bot. Dispatch pins the immutable-base policy;
workers cannot override it. New attempts wait thirty minutes from first fully green
mandatory CI; red/pending CI never opens the bot clock. Task-level Ship state
`reports/<Issue>-a<attempt>-ship-bot.json` stores `startedAt` and outcome across
restarts, corrected heads, task changes and new gate state files. Silence becomes
`молчал` without a park; [] gives `нет`. Timely reply gives `ответил`:
fix P1 in the PR, fix P2 or publish a reply, retain `botRemarks`; later heads do not
wait again. General evidence/quiet clocks still govern other Ship conditions.

The certificate adds `Бот: ответил|молчал|нет`. Installed Deploy with this line
ignores pending bot checks and late bot feedback; mandatory CI and owner remarks
always block. Certificates without it keep legacy blocking. Bot checks must not
be branch-required (Mono requires only `validate`). Attempts from before the bot
clock end before the quiescent install that removed `amend --bot-unavailable`.
Product [] is enabled only after installation and orchestration restart.

After a ship fix, made in the same worker session, preserve old gate state; new
head/stateFile/proof uses a new gate attempt without resetting task bot state. Green reports retain issue/head/PR
certificate validation. On every deploy/restore the orchestrator
reads late bot feedback on merged PRs after a journal cursor (time/id), without
an age cutoff; P1/P2 become deduplicated correction Issues, read back before cursor
advance. Initially file the four known outstanding P1s. See
[delivery rules](references/orchestration-delivery.md#late-bot-feedback).

### Write barriers and recovery

Installed `orchestrator/dispatch.mjs` launches an approved Issue from snapshot
bodies in one command: extracts for short, immutable pins/digest, rendered
dispatch, start gate, spawn and a UTC ledger event. Refusals before spawn register
no attempt; their retries rebuild the exact requested snapshot composition.
Project dispatch now requires `idea/project.json`, complete paginated
`idea/idea-records.json`, `approval.json` and `issue-context.json` alongside the
package documents. The Issue key/project and approval comment timestamp/body hash must match;
the idea check accepts a package without a record only when both project creation
and package approval precede the cutoff (default: 2026-10-18 UTC); package approval needs exactly one
`approval_status=approved` (unmarked approval only before the configured cutoff).
The saved idea and selected record are pinned through collection, receipt
and ship, including canonical artifact contents. Resume preserves the
binding; a new record requires a new attempt. Attempts pinned to packs older than
0.32.0 can finish without the idea field; every attempt keeps its original packRoot. Issue-only retains its existing envelope and seam.
See [snapshot assembly](references/orchestration-dispatch.md#orchestrator-dispatch-command).
`orchestrator/accept.mjs ack` validates a move plan before connector writes; there
is no report confirmation command and no `amend`. Launch pins stay immutable with
their fingerprint (`effectivePins`, round binding); `pins.v<n>.json` and
`pinsVersion` are gone, and a registry entry amended by an older pack is refused. A
task change is an «Изменение задачи» comment on the Issue plus `resume.mjs` with
`taskChange` set to its link (the resume file repeats the comment's words and link): resume records the
delivered text in `dispatch/KEY-aN/task-changes.json` and the review round reads it
with the Issue. After an environmental `not-reviewed` streak, `resume.mjs` with
`reviewRetry: true` (never with `taskChange`) records a retry in
`dispatch/KEY-aN/review-retries.json` instead, dropped when the launch is refused;
it lets the next collection on the same head run a round and changes neither the
contract nor the round count. On the strict path after its three rounds,
`resume.mjs` with `extraRound: {reason}` (with or without `taskChange`, never with
`reviewRetry`) checks the right to one extra round and records it in
`dispatch/KEY-aN/extra-round.json`, bound to the last spent receipt. Resume carries no grants or network override; a risk, critical or
grant change is a new attempt on the same branch. The attempt cap is `attemptCap`
from the product config committed at BASE (the base for every task, pack default 3,
at most 6: a higher value counts as 6 with a warning), or the cap of the last raise
recorded for that Issue in `attempt-cap-raises.json` beside `attempts.json`, outside
every worker grant, whichever is larger; `orchestrator/attempt-cap.mjs raise`
records one raise with the cap it produced (one more) only while the cap is
exhausted, with a reason, and above 6 attempts only with the owner's verbatim
words; otherwise it refuses and writes nothing. A later BASE change never re-judges
a recorded raise. Raise evaluates the BASE dispatch would use now; a spawn refused
on a stale pinned BASE is re-dispatched. A different `attemptCap` in the
`--config` file is ignored with a warning, so a local config never adds attempts;
the ceiling of 6 is not configurable. A worker whose log ends on an overloaded model, a rate limit or the network (the watcher's `dead` line names `cause=`) is resumed in the same attempt after 1, 5 and 15 minutes, then every 15; an attempt opened after such a death or a pack surface change is recorded in `attempts-uncounted.json` and does not count. See [attempt cap raises](references/orchestration-delivery.md#monitoring-protocol). Registry changes and collector
admissions use `launch.lock`. The collector admits each round request into the
host-owned ledger (`consumed/KEY-aN/rounds/`): a new collectionId only after every
earlier round has a result, the same collectionId never with another request, and
the result bound to its request's digest; landing waits for a result of every
admitted round, and a refused or failed round never blocks it. See [command inputs and snapshot composition](references/orchestration-dispatch.md#orchestrator-dispatch-command)
and [sessions/admissions](references/orchestration-delivery.md#delivery-write-barriers).
On the short path, gates check registered pins before returning `pending` (exit 2); workers write only its `publishRequest` as the round request, and a matching receipt is still required to pass.
Scripts do not write to Linear; the worker and the orchestrator use their own Linear MCP connectors. The collector started with the attempt handles round requests; `.agents/`
pre-application uses `dispatch.mjs --preapply` under a recorded owner mandate, with a separate commit before start gates and artifact-owner repair before a new launch. Manifests use path/`sha256` list items with column-zero `text` fences, allowing nested item indentation and blank lines as serialized by Linear.

The delivery worker is the sole writer of its Issue's reports, comments and statuses. It uses its dispatched snapshot as Linear context, writes through Linear MCP (`save_comment`, `save_issue`; the codex-cli launch pre-approves only these, as the MONO-449 probe found) and reads each write back before advancing. Before a write it looks for an existing comment or status so a resume does not duplicate it. The orchestrator writes only the handshake start moves and the «Изменение задачи» comment, and no longer queues or confirms worker writes. The worker keeps drift-before-ready, ready-certificate-before-formal-review and In-Review-after-ready ordering. `claude-cli` workers have no Linear MCP, so delivery dispatch refuses them.

Resume the same context and phase from its capsule with the round request, decisions, head and writable roots. Recheck pack identity on every resume. A head change never drops pending obligations.

The collector runs the review round outside worker sandboxes; the worker runs the full product verification; workers only read the sealed receipt with `collect:false`. Evidence lives outside every worker-writable root. Reports are the worker mailbox; the collector ledger and orchestrator control state remain read-only to workers. A timeout parks the delivery with a dictionary reason. Final outcomes are `green` or `parked`, with the latter written visibly to Linear by the worker (by the orchestrator only for a dead worker); intermediate readiness is never terminal delivery.

The review round runs on a read-only export of the pinned tree and needs no write grant.

## Roles and Decisions

| Role | Responsibility and decision boundary |
| --- | --- |
| Owner | Product scope, slicing, design, acceptance of risk, package/start approval and the product deploy block |
| Orchestrator | One control session per product; inspect, dispatch, monitor, answer technical questions, apply/read back start moves and «Изменение задачи» for delivery workers, launch restricted stage agents and relay their results, and run deploy; each stage agent writes and reads back its own Linear records; never absorb code/preflight/ship |
| Delivery worker | One Issue/worktree/context; execute code, local readiness and ship in order; report evidence; write and read back its own Issue comments and statuses through Linear MCP; no other Linear writes, sub-workers, session management or owner questions in AFK mode |
| Second Voice | Independent pre-write package challenge on the policy-selected cross-vendor route |
| Code reviewer and checker | Read-only review round by [role:code-review](references/model-policy.md#roles) and [role:code-review-checker](references/model-policy.md#roles) from different model families; a finding counts only with the checker's verdict |
| PR reviewers and CI | Evaluate the actual PR head; findings and check results become inputs to ship |

Record technical decisions as “Decided independently” in owner-facing reporting. Ask about scope, slicing, risk acceptance and design with prepared options and a recommendation; show design choices visually. Do not ask questions whose answer is already in the repository, Linear or config. The worker sends a blocked question and recommendation through its report to the orchestrator. When the owner has said to work without him, the orchestrator decides technical and reversible questions itself with «Решил сам:», sends owner questions as non-blocking messages, never a question window, and keeps working.

The orchestrator uses the owner-selected launch model and reports its authoritative identity or «не удалось определить», without a policy verdict; product overrides for this role remain refused. Second Voice selection still follows the actual orchestrator family. Resolve other role defaults from [the roles table](references/model-policy.md#roles) plus validated product `models` overrides, never helper defaults. Risk has four classes: `tiny`, `standard`, `deep`, `risky`; use the higher approved/final-diff class. Risk controls review depth and artifact needs, while a complex worker is an explicit orchestrator launch decision with a recorded reason. Preserve model/effort provenance; missing authoritative runtime data means unverified, not compliant. Policy changes govern new launches after installation, without rewriting historical records; role models change only between waves, never while attempts are live.

Mono pilots product `models` overrides in [config](.agents/mono-workflow.config.json): [role:second-voice](references/model-policy.md#roles) reviews packages and decisions (Project, PRD, Tech Spec, Issues); [role:code-review](references/model-policy.md#roles) with [role:code-review-checker](references/model-policy.md#roles) reviews code before the PR. Each role resolves independently from the policy table and product overrides. The pilot accepts same-family Codex worker/code-reviewer pairing. Remove `models` to roll back.

In orchestrated mode, use the configured transport or documented runtime detection. The managed Codex CLI and Claude Code transports support one resumable worker session per Issue. The registry, mailbox and append-only ledger support recovery; write only observed events with their actual recording times. Start the installed watcher as a tracked background process after every session restart, before launching or resuming workers. Observe its stdout continuously for the whole wave (`persistent: true` or equivalent); periodic wakeups require a recorded degradation. No-change wakeups, including inspected false alarms and already-consumed reports, produce no owner message or routine ledger entry; actual monitoring recovery and healing remain recorded. A silent live writer with unfinished Codex/Claude commands defers stall using a fixed 60-minute best-effort diagnostic from first watcher observation (reset on watcher restart; observation and bounded scanning can affect timing), then emits one marked stall for progress inspection. Missing writer evidence, dead workers and protocol wait deadlines retain priority. It reports each changed phase file, repeats `parked` and `green` for a stopped or ship-green attempt until a reaction, and writes `watcher.json` every tick; launches require a fresh pulse and the same live process, refusing without spending an attempt. Refused launches and resumes can retry when their cause is resolved; a launch registers its attempt at the real spawn boundary and keeps it even if process creation fails; a resume drops its task change when no process started. Losing the session and watcher together during running work needs supervision from the surrounding environment. Dispatch prepares the evidence directory and registered launch pins. `control.json.halt` stops new launches/resumes without interrupting running workers; persistent attempt limits bound retries. Keep compaction wiring outside product repos and carry exact next action, pending obligations and decisions through compaction.

This repository delivers its own Issues on Codex, with `.agents/mono-workflow.config.json` set to `orchestration.transport: "codex-cli"`.

`orchestration.transport: "claude-cli"` selects managed Claude Code launch/resume and the `worker-claude` role from immutable BASE; unchanged projects continue on Codex. It requires a native Anthropic route and positively confirmed subscription login, without provider keys or address overrides. Per-attempt settings bind file edits and shell writes to the approved grants, require the shell sandbox, close connectors and built-in web tools, and allow only GitHub network hosts. GitHub login is fetched outside the sandbox and passed as a real environment variable. Base-branch refresh preserves the sandbox proxy settings when the transport supplies its managed-worker hint. A private per-attempt GitHub CLI configuration directory is prepared inside the grants and reused on resume; both stored streams redact the login. GitHub CLI credential files and their resolved targets are read-denied to shell and file tools; resume retains those protections. Internal temporary paths must remain within short pinned grants; ungranted system fallbacks are denied. Startup requires the pinned session/model identity and a first successful response. Resume regenerates settings and retains the session, model and rights, refusing a live writer. Effort remains requested rather than observed. Start acknowledgement stops the worker; the orchestrator applies and reads back moves, then resumes the same session. Start handshake `wait` is refused. Delivery dispatch refuses this transport while its worker has no Linear MCP for its own Issue writes. Review round waits (`wait-round`) run in the foreground under the raised Bash timeout ceiling and existing deadlines. Wait evidence binds session, attempt, current process instance and call ID; old calls cannot prove a resumed wait. The watcher uses log freshness, including command progress, and distinguishes completion without an attempt-correlated report from green/parked. Pre-PR review uses external collection on committed heads, without an in-worker pass; dispatch, launch record and ready certificate name both differences. Never print credential values: native session transcripts persist command output outside pack redaction. Live waits, expiry and collection are probed by the orchestrator at closeout.

Launch and resume derive the worktree-specific and common Git directories from the requested worktree, canonicalize them, and require the complete effective grant set to match the dispatch pin exactly. A regular checkout contributes one Git directory. Git environment overrides cannot redirect these reads or the capsule HEAD; worker environment settings remain intact. The evidence, installed skills and orchestrator paths remain guarded. Missing or extra pinned roots refuse launch. Compatible pack updates allow resume under [the versioning rule](references/install.md#compatibility); incompatible updates require a new attempt. Reports retain the task's original identity, and the watcher emits `phase-rejected` with the task and reason when a phase report differs.

Run `node --test scripts/worktree-sandbox.test.mjs` on the orchestrator host at deploy for the paired Git permission proof. It reports `deferred` inside a nested sandbox; outside one, missing Codex or sandbox startup failure fails the probe. This host check runs separately from the portable `verify.mjs` suite.

### Choosing the delivery worker

One setting decides who executes a product's Issues under the orchestrator:
`orchestration.transport` in its `.agents/mono-workflow.config.json`. `codex-cli` is
the default and needs no entry; `claude-cli` selects the managed Claude Code worker
and its `worker-claude` role. Everything else about the product stays as it is, and
the orchestrator keeps the model selected at session launch either way.

The value is read from the Issue's immutable base commit. Editing it therefore never
changes a worker that is already running: an attempt keeps the worker, rights and
model it started with, and the new value applies to the next launch. A worker is also
never chosen from the diff it delivers. An unknown value, a role belonging to the
other tool, or a producer/reviewer pair without an accepted `pairingAccepted` record
refuses the launch before the attempt is registered. `claude-cli` additionally
requires the native Anthropic route: a provider key or an address override on
`worker-claude` refuses that launch, while Codex roles may keep them.

Both workers deliver one approved Issue to a green PR through the same gates,
certificates, review rounds and Linear writes. Four differences are worth knowing
before choosing Claude Code:

| Difference | Codex | Claude Code |
| --- | --- | --- |
| Start confirmation | Waits in place for the orchestrator's read-back under `handshake: wait`, or exits and resumes | Always stops after writing its gate acknowledgement; the orchestrator applies and reads back the moves, then resumes the same session. `wait` is refused |
| Subscription | Its own provider subscription | Shared with the orchestrator, so an exhausted subscription stops both. A named limitation, not a defect |
| CLIs on the collector host | Codex and Claude, both logged in by subscription | The same: the review pair spans both families |

Review rounds still wait in place on both workers, and a missing
mandatory capability is a refused launch rather than a disclosed difference. The
chosen worker's differences appear in the launch record and in the ready certificate,
never silently.

A worked example, this repository's own acceptance window:

1. **Select.** The orchestrator pre-applies `"transport": "claude-cli"` under its
   recorded owner mandate, as a separate commit before the start gate, and lands that
   Issue. Every other byte of the config is unchanged.
2. **Check.** `node scripts/project-config.mjs --repo /path/to/product --check`
   passes on the merged tip, and the accepted pair for `worker-claude` is on record.
3. **Deliver.** The next Issue dispatched from that base runs on the managed Claude
   Code worker: its acknowledgement stops the worker, the orchestrator applies the
   lifecycle move and resumes the same session, each review round waits in the foreground
   for its result, and the single review before the PR is an external collection on
   the committed head.
4. **Return.** The returning Issue carries the reverse pre-application,
   `"transport": "codex-cli"`, byte-identical otherwise. Its own worker is still
   Claude Code, because the worker comes from the immutable base and not from this
   diff.
5. **Confirm.** After the merge the config check passes again and the next dispatch
   resolves a Codex worker.

Rolling the choice back is the same one setting in the other direction, with the same
boundary: running attempts keep their pins and finish on their original worker, while
new launches go to Codex. Installation requirements for each worker are in
[Project Policy](references/install.md#project-policy).

## Cost

A wave's cost is telemetry, not a gate. Wait mode avoids an exit/resume cycle; short uses one certifying collection and one combined start/ready comment. These are mechanisms, not a measured savings claim; worker reading inputs and corpus bytes must not grow. Read the **Wave Cost** line in orchestrator status; project updates carry only a short product-level conclusion. The installed `wave-cost.mjs` calculates the figures from reports, logs, review receipts and ledger:

- Dispatch-to-green-PR and dispatch-to-merge elapsed time, independently selected from the `mono-deliver` report's top-level fields first, legacy `mono-ship` reports next, then ledger events. A green PR and a recorded merge are separate events: merge time never comes from delivery completion.
- Review rounds from `mono-deliver.review_rounds` (including zero), falling back to legacy `mono-ship` forms. Invalid or missing values fall through; source fields identify the selected report or event. Only `green_at` proves green in a delivery report; legacy ship completion/report timestamps remain supported.
- All measurable token use across worker turns and attempts (`turn.completed` for Codex, `result.usage` for Claude Code; cache creation and reads are included in normalized input), including parked and failed attempts, plus review and orchestrator use where available; worker use is a diagnostic subtotal.
- Review cost from the `gate-review-v3` receipts in `<evidenceRoot>/history/` whose pins file belongs to the Issue (`--evidence-root`, by default the product's evidence folder): completed rounds, each counted once although later and reused receipts repeat it, runs that ended `not-reviewed`, and the tokens of every review call with measured coverage. Irregular files and other Issues' receipts are skipped. An Issue without such receipts keeps the legacy scan of helper output in worker logs and its cost line. Final reports are selected by stage and Issue; retired registry entries and intermediate phase reports are excluded.
- Actual pack bytes read, review rounds, model and effort.
- Explicit unavailable components with reasons; never estimates presented as measurements.

### Reviewer comparison bench

The experimental comparison tooling has been retired. Production reviewer selection follows the [model policy](references/model-policy.md#roles).

### Review rounds

The preflight and ship gates accept only a `gate-review-v3` receipt for the exact
head and merge-base: review `clean` or `clean-with-successors` and the worker's
verification exit 0 on that head (`workerVerification`), or with host
verification the collection's own run exit 0 on that head; receipts of older
attempts keep their sandbox verification. Rounds are counted from receipts per task
attempt: three at most, the same head reuses its round,
`not-reviewed` spends nothing (two in a row on a head park `blocked`: an
`environment` pair is retried with `reviewRetry` after restoring the host, a
`review` pair is fixed (a code fix is a new head) or retried the same way; a retry is
never a task change), a task change continues the record (on the
strict path it keeps the count; the fast path gets one round on the changed task,
inside the record's three), and main merged into the branch continues it with the same
count (main's own files stay out of the delta). A new attempt on the same branch with the
same risk carries the last record's findings and reviewed head with a fresh count (its
rounds are never reused). Round 1 reads the whole change;
later rounds read the fixes and open findings. After the strict path's third
round the orchestrator may grant one extra round per attempt (`resume.mjs`
`extraRound: {reason}`): only when at most one finding is open (successor
candidates of an accepted round aside; findings the checker merged under one
`mergeKey` on the same head count once at their heaviest weight, here and in the
gate's open list and successor lines, while a closed member never closes an open one) and the last round raised no risk, found no
out-of-contract work and left no open owner remark on the PR. Resume checks this
before writing anything and records the grant in `dispatch/KEY-aN/extra-round.json`
beside the launch pins under `extra-round.lock` (host-only, outside worker grants,
bound to the attempt's third spent receipt; dropped on a refused spawn, voided on
a refused startup, guarded by the host-run evidence snapshot, which covers the
control files of every attempt of the root, with one host run per root at a time
(another collection's run refuses this one before anything runs, no round spent;
a retired attempt's marker, its group ended or its id reused, is settled by the next
opening; every settlement holds launch.lock and re-reads the marker; a collection
with a host run reads the contract, retries and grant again only after its run
opened); a resume writing one waits for every
host run and, with a retry or extra round, for the attempt's round in flight); the gate's strict
limit becomes 4 and the review round accepts a fourth (`round 4 of 4, extra`),
which judges like round 3. A not-converged extra round parks
`needs-decision … (extra round used)` with no second grant. After
the limit the orchestrator merges by the rule, splits the Issue or changes approach in a new attempt.
Refusals are receipts too and reach the worker as a `gate preflight: fail:`
line. With pin `screenCheck` the attempt's first round waits for the host's
screen check of the same head; waiting and mismatches spend no round. The orchestrator approves nothing between rounds and after merge decides
which candidates from the receipt's list become Issues (every `must-file` one does; the task's Linear writer files them): [review rounds](references/orchestration-delivery.md#review-rounds),
worker [round rule](references/review-admission.md).

### Host verification

Some product verification cannot run in the worker's Codex sandbox: Mono's own
`node scripts/verify.mjs` reads the process table, and the sandbox refuses the
setuid `ps` under any seatbelt profile. Such a product sets
`orchestration.delivery.hostVerification: true` in its config. Dispatch reads it
from BASE and pins it for the attempt (`hostVerification` in the launch pins;
the dispatch adds a «Проверка на хосте» block), so neither the worker's branch
nor its round request can switch it.

With the pin, every collection first runs the pinned `verification` command
outside the sandbox in a clean checkout of exactly the request's committed head:
a fresh repository at `<evidenceRoot>/verification/<collectionId>.checkout`,
outside every worker grant, that reads the head's objects from the worker
repository but none of its configuration, hooks, filters or sparse patterns, so
the worker's working copy (including an uncommitted edit made and reverted
during the run) never feeds the result. The checkout holds only committed files
and the detached head, without branches or remotes: a product whose
verification needs untracked inputs such as `node_modules` installs them in its
command. The run
has a process group of its own that is stopped as a whole when the command
exits and a private temporary directory, writes its output to
`<evidenceRoot>/verification/<collectionId>.log`, and the checkout is removed
once the group is confirmed stopped (otherwise recovery removes it). While it runs, a
`<collectionId>.running` marker beside the log holds the evidence snapshot
taken before the run and the group, registered before the command is released:
no receipt of that collection is read while the marker exists, and if the gate
dies mid-run, collector recovery confirms the group stopped (or keeps the round
in flight), removes the checkout, settles the evidence against the snapshot like
the gate would, quarantines what was written for that collection and runs it
again. The receipt records `verification {host: true, head, exitCode, log, tail}`
(the tail prefers failing lines); a host run counts only with `head` equal to
the reviewed head:

- exit 0: the review round runs as usual, and on the fast path a fixed head
  passes on this run instead of `workerVerification`;
- non-zero: no reviewer runs and no round is spent; the worker gets
  `verification failed on this head on the host (exit N)` with the log path and
  tail, fixes and requests again (the same head with the next collection number
  for a flaky run);
- the head, base or worktree changed, a history receipt changed, or a receipt
  bound to this attempt appeared or changed during the run: the collection's
  consistency fails; this attempt's earlier receipts get their bytes back and
  new ones go to `<evidenceRoot>/quarantine/`, so no later collection reads them.

The worker runs focused checks, reports the full verification as deferred to the
round and requests without `workerVerification`; it never parks for it.
Trade-off: the run executes worker-authored code with the orchestrator's rights,
outside the sandbox that otherwise keeps the evidence out of the worker's reach.
The group stop, the marker and the evidence check catch a run that plants or
edits this attempt's receipts, including through leftover children, but not
code that deliberately escapes into a new session or touches other host state;
this is why the switch is per product and off by default.

Receipts keep the raw usage of every review call: Claude input excludes both cache counters, whereas Codex input includes cached input and has no cache-write counter. A call without usage stays null and counts as unmeasured, never as zero. Old receipts remain valid without usage metadata; those inputs remain unavailable for reproduction.

Count each attempt once: sum per-turn usage, or take the last event when a Codex log reports thread totals (its counters never decrease; `counting` shows which). Cached input is part of input, not another amount to add. An attempt without usage records is unavailable; an unfinished turn makes the attempt incomplete. A wave containing either has an incomplete total. Known completed-turn usage remains a partial subtotal, and absent attempt usage is null, never a measured zero. The static worker reading budget is a separate measure: one union of mandatory, conditional and nested readings, shared files counted once, bounded at **99,882 bytes** with bytes/4 shown as an approximation. The README and this handbook are outside the worker reading list. Explanatory rationale stays outside that list and adds no gates.

```bash
node '<pack-root>/scripts/wave-cost.mjs' <ISSUE-KEY>
node scripts/read-budget.mjs
```

See [Cost Telemetry](references/orchestration.md#cost-telemetry) for inputs and unavailable-data handling. Compare improvements only against a recorded baseline and protocol; report insufficient evidence plainly.

Attempt launch and resume start the installed collector; `collector.mjs
start|stop|status --root DIR --issue KEY --attempt N` restarts or inspects it, and
it exits when the attempt leaves the registry. It admits the worker's round
request, runs the round and records its result; a request off the launch pins or
before the code report gets a `refused` result, a replaced request under an
admitted collectionId gets one attention line and no result. History restores
interrupted head receipts without a second review, including failed collections.
Incarnation/group checks refuse live or unverified locks; a live gate keeps its
round in flight. This removes the orchestrator turn before each round; measured
time savings still require comparable completed waves under the cost protocol.

## Plugin Installation

For Design, connect the selected Paper or Wonder tools in the stage session;
see [Design tool setup](references/install.md#design-tools-mono-319). Rebuild
stage-agent allowlists and start fresh sessions after changes.

### Install or update a release

The Mono session installs each tagged release by plugin update in every place:
each Claude Code profile (`claude plugin marketplace update`, then
`claude plugin update`) and Codex (re-add the marketplace on `v<VERSION>`, then
`codex plugin add`). It compares every version cache with `git archive v<VERSION>`
and checks that a fresh `claude -p` and `codex exec` load the new version; restart
running sessions to load new rules. Exact commands and allowed service files:
[Plugin Updates](references/install.md#plugin-updates).

The optional installer `scripts/pack-install.mjs` automates the same steps with
holders, pauses and rollback; it is not used now. Its fake-CLI fixtures run with a
temporary HOME: `node --test scripts/deploy.test.mjs
node --test scripts/pack-install.test.mjs`; do not use owner profiles.

To try unreleased code without installation, launch Claude from the checkout with
`claude --plugin-dir "$PWD"`, or open `skills/<skill>/SKILL.md` from Codex in that
checkout. These sessions do not change the installed pack.

## Migrate From the Local Installer

Migration is one machine-wide installation shared by all products. The product
performing it installs a wave that ends with the approved migration release;
the owner authorizes the migration in that release task. The first migration release `v0.23.0` contains the former installer for rollback. Do not install intervening pack changes
between this migration and the project's final release.
After migration, the pack's deploy live pass uses [plugin installation proof](references/landing.md#plugin-installation-proof) and any other machine state blocks closeout.

1. **Halt launches in every product.** Each product's own orchestrator pauses
   dispatch/resume and keeps it paused through migration and installation
   verification. The installing orchestrator does not edit another product's
   configuration, control files or registry.
2. **Check each product's conditions.** In the installing product, all attempts
   in the wave must be landed and stopped under
   [wave installation](references/landing.md#install); retain their records until
   the wave is closed. Each **other** product's orchestrator confirms its current
   quiescence: `control.state` is `idle` and `workers.json` is empty. That
   orchestrator runs the existing read-only check and reports its result:

   ```bash
   node /path/to/current/mono/scripts/verify-pack-state.mjs quiescence --root /path/to/own/product-state
   ```

   A paused or unfinished attempt in another product prevents migration. Its
   own orchestrator finishes it or resolves it before confirming quiescence.
3. **Verify the released landing tip T.** From the main repository checkout,
   complete `landing-drain record/status/verify` under halt. The release task
   must have landed; HEAD must equal GitHub's current landing tip T, all recorded
   merges must be ancestors of T, and T's validation must pass. Confirm the tag
   `v<VERSION>` points to T. The main checkout verifies the tip and ancestry;
   the plugin installation source is the GitHub marketplace repository.
4. **Remove the exact legacy footprint and install the plugin in both tools.**
   In each skills root (`~/.claude/skills`, `~/.codex/skills`, and any additional
   root recorded by the legacy installation), remove only these eleven
   directories and two private paths:

   ```text
   mono-idea/        mono-handoff/    mono-issue/      mono-implement/
   mono-preflight/   mono-ship/       mono-deploy/     mono-orchestrate/
   mono-deliver/     mono-check/      mono-review/
   .mono-agent-workflow/
   .mono-agent-workflow.lock.json
   ```

   Preserve other skills and all
   product state. Do not use a wildcard deletion to remove an unexplained
   lookalike. The installing orchestrator registers the GitHub repository as
   the marketplace in both tools and installs using
   [Plugin Installation](#plugin-installation), with Codex pinned to `v<VERSION>`.
   Before any command that replaces a version folder, run `before-update` against
   that actual folder across **all** products, even for a same-version reinstall;
   keep launches halted and wait for any named attempts. Immediately after
   installation:

   Compare each tool's version cache with T's Git tree: paths, types, executable
   modes, content object hashes and symlink targets must match. Only extra service
   objects at these exact paths relative to the version-folder root are allowed:
   Codex directory `.git/` and regular file `.codex-marketplace-install.json`;
   Claude Code directory `.in_use/`. These tool-specific exceptions never exclude
   released files from comparison. The Codex file must be valid JSON with `revision`
   equal to the full tag commit; invalid JSON, absent/different revision or another
   object type fails. Every other extra, missing or changed object fails. Do not
   substitute clone proof.
   Follow
   [Plugin Updates](references/install.md#plugin-updates) for later releases.
5. **Verify installation before closing the wave.** Check every legacy skills
   root for any name beginning with `mono-`, plus the private directory and
   lockfile. The following read-only check fails and prints every remaining
   path; include all additional roots from step 4 in its arguments:

   ```bash
   python3 - "$HOME/.claude/skills" "$HOME/.codex/skills" <<'PY'
   import sys
   from pathlib import Path
   remaining = []
   for root in map(Path, sys.argv[1:]):
       if root.exists():
           remaining.extend(str(p) for p in root.iterdir()
                            if p.name.startswith('mono-') or p.name in
                            {'.mono-agent-workflow', '.mono-agent-workflow.lock.json'})
   for item in sorted(remaining):
       print(item)
   raise SystemExit(1 if remaining else 0)
   PY
   ```

   Locate both installed plugin folders with `claude plugin list --json` and
   the JSON output captured during the guarded Codex installation (add `--json`
   to its installation command). Run each installed folder's
   `scripts/verify-pack-state.mjs version`: both versions must equal `VERSION`
   at T, and the version tag must resolve to T. Accept that proof only with
   matching cache-tree comparisons from step 4. A leftover copy or mismatch
   blocks wave close, releasing launch halts and starting tasks from the new
   installation. The installing orchestrator records any mismatch, corrects
   the source and repeats the full verification of both tools before continuing.
   Restart the orchestrator sessions and their collector and
   watcher from the plugin, preserving the launch halts; each other product's
   own orchestrator reads this section, confirms its plugin paths and unchanged
   product policy/state, and starts a skill from the plugin. Start a plugin skill
   in each tool with a read-only project-config check: use `/mono:check project-config` in Claude Code; in Codex, run `/skills`, select the Mono `check` skill and request `project-config`. This checks the repository configuration without changing files or Linear state.
6. **Close the wave, then resume launches.** The installing orchestrator runs
   `landing-drain close` from the installed plugin only after both tools' proof
   and the no-old-copies check pass. It records each task's delivery proof,
   closes its Issues and retires its attempts through the deploy owner. Each
   product's own orchestrator then removes its launch halt; other products'
   state is never edited by the installing orchestrator.

If migration stops after removing legacy copies, keep launches halted. The
release's rollback is to reinstall with the legacy installer from the main
repository checkout set to the **first migration release commit**, resolved from tag `v0.23.0`, where it
still exists: the installer requires a Git checkout, so do not run it from the
plugin cache. Restore the previous
`workflows.deploy` value through its config owner. Restart sessions and verify
that installation before resuming. The other product's config and state remain
its own orchestrator's responsibility.

## Deploy targets

The product session owns `.agents/mono-workflow.config.json`. Configure `deploy`
as `{ "targets": [...] }`; without a block Deploy still merges after the same
pre-merge gates and closes «выкатили, не проверено» with the reason that the
product has no deploy settings, no version proof and no project update; an
invalid block refuses. Targets: `vercel` has paths,
domain, team (Vercel team ID, never a slug), check; `local` has paths, command, check; `pack` has only kind;
`none` has paths/reason. Unknown fields and a sixth field fail. Paths are root
relative * / ** globs; omitted means all files. See the [web](skills/deploy/references/web.md),
[local](skills/deploy/references/local.md) and [pack](skills/deploy/references/pack.md)
recipes. Each block needs owner yes in its own product session. Web paths cover
the product's ignore-build list and mobile uses none. Mono's exact block is
`{"targets":[{"kind":"pack"}]}`.

`deploy.mjs` commands merge/prove/local/check/rollback/return/outcome accept
`--request FILE`. It locks one open run per product in landing/deploy, records
pre-merge rollback target and action intentions with read-backs, and uses raw PR
publications after the latest Ship marker on the same head; a `Бот:` certificate
waives only bot waits/late bot remarks. QA beforeMerge and
landing tip remain merge gates. After merging it waits up to 8 minutes outside
the lock for the main check on the merge commit; `waiting-validation` means repeat
the same call. The ledger gets a DEPLOY line only when run state changes. It never uses auto-merge. Manual pack PRs without
registry attempts skip landing-drain record. CLI calls are bounded at 120 seconds.
Before an issue-only merge, Deploy rereads the current body, marker, label and
approved whole-body fingerprint; changed or revoked approval stops the merge (K-21).
Review body edit times come from GraphQL. Before rollback or a final outcome,
the live build/process must still match the recorded checks; a mismatch stops.

Web proof reads the domain every 20 seconds, waits 10 minutes from merged_at,
repeats once with GitHub repoId, waits 10 more. New touched main changes prevent
old-code repeat; a missing or capped compare file list cannot authorize it. Domain
reads continue while a repeat builds. Browser checks of protected own URLs use the owner's Vercel
login and the same quick-check signs plus Issue scenario. Night web needs a fresh
browser-ready mark BEFORE merge; without it, wait until morning. Red domain/green
own URL retains the red, creates a discrepancy Issue and remains unverified.
An own URL behind a login wall (for example Cloudflare Access) is recorded as
unavailable with `blockedBy: "auth"`; then green script domain quick and recorded
domain scenario on the proven version give «выкатили и проверили» with a note,
without them the result stays unverified, and red domain stops without outcome.
Only browser red twice on new/green on saved old permits rollback. Repair STAGED
is checked at its own URL, explicitly promoted, then checked on production before
archiving rollback. One red after return cancels return, no repeat, Stop until
morning. No browser: Stop/open run/no outcome; do not mint bypass secrets.

Five outcomes worst first: rolled back; deployment failed/production old; deployed
unverified; merged awaiting release; deployed verified. No targets means no outcome;
no block means «выкатили, не проверено». A `none` target is verified only by a
green `surface: "none"` scenario whose observed version is the merge commit or a
stated release whose `v<release>` tag contains the merge.
Every unavailable check keeps its reason/checker. An ordinary pack PR is Done on
merge with «влито, ждёт выпуска». A release PR passes `mono:qa` on its head before
the tag; after installation its run gets `packResult` with every place verified,
which gives «выкатили и проверили». Closed ordinary pack PR runs keep their waiting outcome.
Owner lines and Issue closeout use [output](skills/deploy/references/output.md);
project update only for proven delivery uses its short [rule](skills/deploy/references/project-update.md).
Deploy's entire reading union is capped at **13,000 bytes** by read-budget.mjs.
Design now synchronizes its main product file from verified released screens;
Deploy does not alter design memory.

## Project Config

Optional `design.tool` selects `paper` or `wonder`; omitted `design` or `tool`
means `paper`. For example: `"design": {"tool": "wonder"}`. The config checker
rejects unsupported tools with a `design.tool` error. Design approval records
use `canvas=<https>` and `tool=paper|wonder`; the PNG archive stays unchanged.

Optional `qa` defines the independent tester's copy recipe and enables the
current-head QA merge gate after green ship. `workflows.qa` remains
an optional workflow string and `qaAuth` an access policy, neither is a recipe.

```json
{
  "qa": {
    "mode": "terminal",
    "install": [],
    "start": "node scripts/verify.mjs",
    "ready": {
      "command": "pwd && git rev-parse HEAD",
      "identity": "cwd is the detached QA copy and full SHA matches the requested version"
    },
    "data": {"source": "local-fixtures", "description": "Only local pack fixtures"},
    "forbiddenActions": ["No publication, Linear mutations or real data writes"]
  }
}
```

`mode` is `web|terminal|mobile`; `install` is an array (empty if unnecessary).
`start` must use the assigned `$QA_PORT` for web/mobile. `ready.command` plus
`ready.identity` must prove this copy answers (listener PID/cwd/build marker for
web). `data.source` is `read-only|synthetic|qaAuth|local-fixtures`; describe its
boundary, and select a valid `qaAuth` policy for that source. `forbiddenActions`
is a nonempty list of external action restrictions. Unknown recipe fields fail.
Without `qa`, use only this product's record in [QA recipes](references/qa-recipes.md).
An unconnected product can supply a recipe file for a given-version run; that
certificate cannot open gates. `models.roles.qa` overrides the pack QA role.

Optional `orchestration.preapply.mandate` names the owner comment URL; absent/empty means no pre-application mandate.

Product repositories keep only `.agents/mono-workflow.config.json` for Mono. Do not vendor skill bodies, wrappers, locks, local workflow checkers, hooks or updater CI there.

```bash
node scripts/project-config.mjs --repo /path/to/product --project-name Product --write --clean
node scripts/project-config.mjs --repo /path/to/product --check
```

Configure product/team names, Linear/repository languages, narrow artifact roots, ship, documentation, review-feedback and deploy targets. Ship and review feedback are built into `mono:ship`: `workflows.ship` accepts `null`, `mono` or `gstack ship`, `workflows.reviewFeedback` accepts `null`, `mono` or `compound-engineering:ce-resolve-pr-feedback`; all of them mean the built-in Ship, and any other value fails the config check with that reason. The old `prerequisites.autoreviewHelper` field is no longer required and is accepted silently. `workflows.implementation` remains valid for existing configs but is no longer read by mono:implement; no external implementation engine or learnings helper is needed. Optional workflows may be `null`. Without a `deploy` block a green PR still merges after all pre-merge checks and closes «выкатили, не проверено»; an invalid block refuses; old `workflows.deploy` and `deployApproval` are accepted and ignored. Optional QA/authentication policy defines how live verification accesses the product; owner-session access requires permission. `--clean` removes legacy generated Mono and previous-brand workflow files while migrating project policy.

Optional `models.roles` overrides model routes within the [role/transport matrix](references/model-policy.md#product-overrides).
The legacy `autoreview` role (old pins and configs only; it never runs) accepts claude, kimi, pi or codex with `effortByRisk` for all five risk keys.
Worker Codex roles stay on Codex, worker Claude stays on Claude; Second Voice stays
cross-vendor and the orchestrator is not overridable. The CLI worker launcher
supports Codex workers and managed Claude Code workers selected by `orchestration.transport`. Native authentication uses null endpoint
and credentialEnv; external credentials are environment variable **names**, never
values. Pi supports native xai/google/minimax with a null endpoint, or OpenAI-compatible
routing via `OPENAI_BASE_URL`; unsupported endpoint mappings are refused.
Routes that authenticate from the environment must declare `provider.credentialEnv`; under the field-for-field rule, this is a pair change requiring a bound `pairingAccepted` record.

Every changed producer/reviewer pair needs a `pairingAccepted` record with the exact
producer and reviewer routes (including both providers, credential variable names
and risk efforts), all risk classes, a `linearDecision` URL, `by` and `date`.
`requiredPairings(config)` in `scripts/runtime.mjs` returns that pair data for review;
`project-config.mjs --check` refuses absent or changed bindings and names the pair.
It validates the recorded decision's binding, not model capability.

Before dispatch, `orchestrator/spawn.mjs --pins <request-json>` prints `modelRoutes`
from the immutable base commit. Carry those pins into launch and collection requests;
config edits in the delivered diff cannot change that delivery's reviewer. New
receipts record engine/model/effort/provider/fingerprint, verified at `collect:false`;
legacy receipts retain their signature and meaning, read as claude/unknown. Collection
builds provider environment from the route and keeps the existing two invocation forms,
sealed-head requirement and all certification checks. No provider key value belongs
in config, dispatch, registry or receipts. Resumes keep their original pins.

The owner approves a product deploy block once; the block adds version proof and checks to guarded merge without another approval, and a product without one merges unverified. Mono alone uses delegated package approval. Configure targets with at most five fields (kind included), unknown fields fail. No block is inferred from repository files. Configure `orchestration.transport` and `maxParallelWorkers` (default 3) when needed. Delivery settings default to a 120-second quiet interval, 7,200-second evidence limit, 10-second polling, 420-second acknowledgement wait, one collection retry and three attempts (`attemptCap` is read from the config committed at BASE, at most 6; one task gets more only through a recorded raise). This repository opts in to its own issue-only lane with its owner ID; the lane stays off by default, and consumers enable it explicitly with `issueOnlyLane.enabled` and the canonical approving `ownerPrincipal`. Plugin compatibility and helper policy: [guide](references/install.md).

The optional `workflows."qa"` setting selects live-sweep browser automation;
absent or null uses the available runtime tool. `qaAuth` accepts `cookie-import`,
`test-account` or `owner-session`; the latter requires explicit owner involvement.
Absent authentication covers unauthenticated surfaces only. Keep all product
config fields in the Project Config section above.

## Landing

Handoff chains Issues that must edit the same file; independent work stays parallel.
See [scheduling](references/landing.md#scheduling).

Products can opt in to a landing policy for parallel task delivery. The rule and
operator instructions live in [Landing](references/landing.md), with a complete
[example config](examples/landing-config.json).

Landing records accept existing green certificates with a PR number, GitHub URL,
or matching number and URL, including slash, comma and Markdown-link forms;
conflicting identities and unrelated text are refused.

Mono enables this policy: ordinary tasks leave a non-empty Markdown record in
`changelog.d/<ISSUE-KEY>.md`; `CHANGELOG.md` and `VERSION` belong to a separately
approved release task dispatched by the orchestrator. The release task assembles
the records with `changelog-assemble.mjs`, then prepares the version section.
See [assembly and recovery](references/landing.md#changelog-assembly) for the
command, preview and retry behavior. Mono also enables `landing.validation` with
`check: "validate"` and `timeoutSec: 1800`: merge and check the exact merge commit.
Ordinary merges and installation wait
for a green main tip; a repair uses the named corrective exception. See
[merge validation](references/landing.md#merge-validation) for commands, result
codes and first-rollout qualification. Mono selects `landing.install: "wave-drain"`:
Deploy records each registered task's merge in `pending-install.json`. The task
is Done on merge and its worker is retired after that closeout; the records do
not block retirement. Each release installs by plugin update with cache and
fresh-run checks ([Plugin Updates](references/install.md#plugin-updates)), and
nothing closes these records. Collecting a wave (`landing-drain verify/close`,
`pack-install --wave`) is optional and not used now. See
[install and recovery](references/landing.md#install) and
[one-time migration](#migrate-from-the-local-installer).

## Owner Rules

The following 34 numbered entries are the sole owner-rule index, transferred from the former constitution. Each line states the obligation, its reason and the executable source; it is not a second full copy of the source text. Rule numbers preserve traceability. Link validation proves that a file and section are addressable; pack checks and same-PR handbook freshness preserve truth. Change rules through a Linear Issue and the orchestrator.

- **K-01.** Write statuses, reports and briefs with the product or user outcome as their subject so the owner can understand them without knowing the workflow — [Product Language For The Owner](references/human-friendly-output.md#product-language-for-the-owner).
- **K-02.** Put Issue keys, slice codes, SHAs, stage names and internal labels in the closing technical block rather than making them the subject, so identifiers cannot hide the result — [Product Language For The Owner](references/human-friendly-output.md#product-language-for-the-owner).
- **K-03.** Distinguish live production verification, automatic post-deploy verification and deployment without live inspection, reserving “works” or “in production” claims for current live proof so unverified delivery cannot masquerade as verified behavior — [Product Language For The Owner](references/human-friendly-output.md#product-language-for-the-owner).
- **K-04.** End every status with the owner's required decisions (including “none”) and repeat the decision count at the start so requests cannot get lost — [Status Update](templates/orchestrator-brief.md#статус-status-update).
- **K-05.** Include “What went wrong” in every status, naming delays over five minutes and departures from agreements or explicitly saying none, so the real cost remains visible — [Status Update](templates/orchestrator-brief.md#статус-status-update).
- **K-06.** Publish one shipment-form project update for each deployed Issue with an outcome title, one or two sentences and the Issue link last, so releases appear in the project feed — [Shape](templates/project-update.md#shape).
- **K-07.** Limit update titles to ten words and bodies to one or two sentences and 35 words, allowing a third sentence only in the final Project update, so updates remain readable — [Invariants, item 2](templates/project-update.md#invariants).
- **K-08.** Exclude SHAs, build numbers, PRs, slices, rounds, reviews, stages, sessions, dates and completion percentages from project-update prose while permitting product vocabulary, so the update describes the product — [Invariants, item 15](templates/project-update.md#invariants).
- **K-09.** Give separate outcomes separate updates and use no subheadings, lists or more than one link inside an update, so each result stays visible — [Invariants, item 14](templates/project-update.md#invariants).
- **K-10.** Use the State form when no shipment occurred, report factual Project health, make the link optional and end with the owner's needed action, so progress cannot look like delivery — [State update](templates/project-update.md#state-update).
- **K-11.** Complete a Project only through the shipment of its last open Issue and begin its final update with the configured “Project completed” prefix, so the feed has a delivered conclusion — [Deploy project update](skills/deploy/references/project-update.md#project-update) and [Invariants, item 13](templates/project-update.md#invariants).
- **K-12.** Name the theme Project in an issue-only Issue and send its shipment update there, so a projectless result still has a visible home — [Theme project](references/issue-only-lane.md#theme-project).
- **K-13.** Assign new agent-created Project leads and Issue assignees to the acting owner while preserving existing assignments, so created work reaches the owner's lists — [Linear Artifact Rules](references/artifact-rules.md#linear-artifact-rules).
- **K-14.** Treat project updates as informational closeout results whose absence or failure cannot block delivery or change its verdict, so reporting cannot stop shipment — [Skill Design Rules](AGENTS.md#skill-design-rules).
- **K-15.** Turn a raw idea into a Project with a read-back owner approval record and a verified move to Discovery, before PRD, Tech Spec, Issues or code — [Idea exit](references/lifecycle.md#idea).
- **K-16.** Review record and slicing before writing; one Issue uses a short record with needed Spec decisions in U and references their numbers, both reviewers run one full round at any risk. Wording fixes need no round; P0/P1 substance fixes get finder-only targeted recheck, rejection needs source refutation. Bring one summary with «Начать работу» — [Pre-write package review](references/orchestration-stages.md#pre-write-package-review).
- **K-17.** Have an independent cross-vendor Second Voice review the package draft before its first Linear write, so author and reviewer do not share the same blind spots — [Second Voice](references/orchestration-stages.md#second-voice).
- **K-18.** Decide repository-, Linear- and config-derived implementation details, document structure and risk classification autonomously, but ask about scope, slicing, risk acceptance and design, so routine questions do not consume owner time or seize owner authority — [Autonomy Defaults](references/questioning.md#autonomy-defaults).
- **K-19.** Require a green Ship certificate bound to the current PR head; prove delivery only through the owner-approved deploy.targets block — [Project Config](HANDBOOK.md#project-config).
- **K-20.** Grant issue-only delivery only when all nine conditions hold and the owner approves the exact Issue fingerprint, falling back to Project-first on doubt, so the shortcut cannot bypass its boundary — [Nine eligibility conditions](skills/issue/references/run.md#девять-условий) and [Trust boundary](references/issue-only-lane.md#trust-boundary).
- **K-21.** Invalidate approval whenever an approved issue-only body changes and obtain new review and fingerprint approval, so the approved text remains the executed contract — [Renewal recovery](skills/issue/references/decisions.md#повторный-вход).
- **K-22.** Run the code review round at every risk class with the policy's reviewer and checker from different model families, pinned at launch, so the reviewer has the capability and depth to challenge the author — [Roles](references/model-policy.md#roles) and [Review admission](references/review-admission.md#review-admission).
- **K-23.** Classify work as tiny, standard, deep or risky to set artifact requirements and review depth, treating money, data, access, production and public interfaces as risky domains, so dangerous work cannot pass through a light process — [Risk Classification](references/readiness-gates.md#risk-classification).
- **K-24.** Require both pre-write package reviewers for a single Issue at every risk, including tiny; multiple Issues keep up to three rounds and tiny advisory with reason. Formal pre-ship review for standard/deep/risky stays unchanged — [Review Gate Policy](references/readiness-gates.md#review-gate-policy).
- **K-25.** Close an Issue on confirmed merge and keep delivery truth, proof, checker and date in its closeout comment — [Deploy](skills/deploy/SKILL.md#run).
- **K-26.** Verify user-facing changes live against Issue acceptance after deployment and file defects as immediate out-of-queue hotfixes, and keep unverified results visible in the closed Issue, so automated checks cannot substitute for the user experience — [Deploy](skills/deploy/SKILL.md#run).
- **K-27.** Include a compact checked/not-checked boundary in every stage result and call uninspected work unverified, so the owner cannot infer unsupported confidence — [Checked / Not Checked](references/human-friendly-output.md#checked--not-checked).
- **K-28.** Report a stop with completed work, the exact blocking point, unperformed work and the smallest unblock action, so unfinished work cannot be mistaken for ready — [Blocked / Timed-Out Shape](references/human-friendly-output.md#blocked--timed-out-shape).
- **K-29.** Append only observed facts with actual recording times to the ledger and append corrections instead of rewriting history, so invented history cannot conceal delays — [Mailbox And Ledger](references/orchestration.md#mailbox-and-ledger).
- **K-30.** Let the delivery worker write and read back its own Issue reports, comments and statuses through Linear MCP, with the orchestrator writing only start moves and «Изменение задачи»; pre-delivery stage agents write and read back their own records, so each artifact has one writer — [Linear Writes](references/worker-contract.md#linear-writes).
- **K-31.** Start every pack change with a Linear Issue before the first edit, so no shortcut evades review and verification — [Change Discipline](AGENTS.md#change-discipline).
- **K-32.** Update affected checks with behavior changes using structure and named behavior fixtures, keep prose free of pins and agent-only rules free of a second machine encoding, and preserve the four bounded contracts and fingerprints unless explicitly changed, so editorial rewrites stay green while protected invariants remain checked — [Fixture Coupling](AGENTS.md#fixture-coupling).
- **K-33.** Write Linear artifacts, comments, templates and examples in the configured project language (Russian here), the stages listed in `scripts/russian-stages.mjs` and `references/owner-dialog.md` in Russian, and other skills in English, so the owner can read the artifacts and models can execute the pack consistently — [Language](AGENTS.md#language).
- **K-34.** Route pack rule changes through a Linear Issue and the orchestrator, updating affected handbook sections in the same PR, so owner intent and the shipped description stay synchronized — [Change Discipline](AGENTS.md#change-discipline).

## Разработка и отчёт

`mono:implement` написан на русском и работает в Claude Code и Codex, с оркестратором
и без него, по утверждённой задаче пакета или mono:issue без проекта. До правки
выбирает доказательство по последствиям; тесты называют поломку и проверяют настоящее
поведение. Итог: две-три строки для владельца, затем «Не проверено», «Найдена поломка»
и доказательства по каждому «Готово, когда», включая несделанное. Для экрана сверху
прямо «экран в браузере не проверен»; вкус и PNG остаются входами, живая сверка у Deploy.
При старте утверждённые пункты «Готово, когда» сохраняются отдельно от отчёта
через `delivery-state.mjs capture-criteria`: из снимка Issue или стартового чтения
Linear без оркестратора. Список неизменяемый; публикация требует полного совпадения
порядка и текста, разрешая только нормализацию пробелов. Захват поддерживает
обычные и нумерованные списки; вложенный текст остаётся внутри своего пункта.
Метки секции и начала списка определены в [шаблоне Issue](templates/issue.md)
только для русского и английского. Иные метки, отсутствующая или неоднозначная
секция дают `blocked` с ожидаемыми метками до записи состояния.
`phase_result` остаётся строкой; `criteria`, `summary`, `not_built`, `not_verified`
обязательны в каждом итоговом кодовом отчёте независимо от версии. Только отказ
старта или захвата до сохранения списка допускает пустой `criteria`: причина,
ожидаемый формат раздела, отсутствующие метки лишь когда их действительно нет.
Остальные отчёты без списка отказываются. Поломка и
несделанное не публикуются как `implemented-needs-preflight`.
На старте одна сверка действующего задания; отдельного комментария старта нет.
Отчёты, комментарии и статусы задачи исполнитель пишет сам через Linear MCP и
читает обратно; очереди и подтверждения записей оркестратором нет. Новая версия
отчёта называет прежний комментарий устаревшим. После обрыва
сохраняются ветка и сделанное, применённые действия не повторяются.
Цепочка — Blocked by внутри пакета: диспатч несёт отчёт предшественницы и её влитой
коммит; без входа задача останавливается, обещанное не строится заново.
Протокол несовместим (surfaceRevision 5): обновление и откат только при покое
каждого продукта, включая приостановленные попытки, по [Installation](references/install.md#quiescence).
Старые попытки продолжаются только новыми. Выпуск 0.39.0 несовместим с прежним
протоколом. Установка при выкладке; пилот и замер после выпуска у оркестратора.
До захвата и кода — одна проверка старта; чужая задача/проект в снимке останавливает.
Отпечаток считает `scripts/worktree-fingerprint.mjs`, исключая только delivery-root
внутри рабочей копии; там же отчёт и хронология. `confirmed` требует команды с кодом 0
на записанных коммите/отпечатке после последней правки. Видимость без браузера остаётся
`unverified`. У мелкой текстовой правки ровно три строки summary: результат;
исключение с причиной и граница проверки; передача в Preflight.
QA и приёмка на работающем продукте — следующий проект, не часть этого этапа.

[Набор evals/implement](evals/implement/README.md): маршрут отдельно от поведения.
Локально: `node --test scripts/implementation-report.test.mjs scripts/implement-evals.test.mjs`.
Тест создаёт учебный Git-репозиторий во временной папке. Повторный круг 20 сценариев
на голове PR выпуска после зелёной сдачи запускает оркестратор; голова содержит main,
после круга код не меняется. Вливание только при 20/20 и совпадении дерева main с
проверенной головой. Результат живого круга здесь не заявлен.

## Skills

Invoke pack skills with the plugin namespace: `/mono:idea`, `/mono:handoff`,
and the names below. Short `/ship` and `/review` may belong to other skills;
this pack uses `/mono:ship` and `/mono:review`. Independent QA is `/mono:qa`, never a foreign `/qa`.

| Skill | Use it for |
| --- | --- |
| [mono:initiative](skills/initiative/SKILL.md) | Owner session only: honest task/project/initiative call, sharpened initiative approved in words, then a value-sliced map of linked Idea Projects without starting them |
| [mono:idea](skills/idea/SKILL.md) | Idea intake with optional initiative context and recorded owner approval; Research starts by owner or delegated orchestrator |
| [mono:research](skills/research/SKILL.md) | Facts before a solution, Research document and next-step advice without owner questions |
| [mono:discovery](skills/discovery/SKILL.md) | Solution found with the owner in conversation, explicit choice and version-approved PRD; same stage for owner or delegated orchestrator |
| [mono:design](skills/design/SKILL.md) | Designer stage after PRD routing, consented taste memory and immutable Paper/Wonder PNG approval; orchestrator chooses with reasons |
| [mono:tech-evaluation](skills/tech-evaluation/SKILL.md) | One checked technical solution, one version-approved plain-language page, then a short Tech Spec; same stage for owner or delegated orchestrator |
| [mono:issue](skills/issue/SKILL.md) | Одна задача без проекта: короткий итог, согласие со стартом или на потом, отзыв и восстановление |
| [mono:handoff](skills/handoff/SKILL.md) | Team lead: reconciles approved inputs, slices (one Issue by default), one reviewed package record, Ready; work starts by owner or delegated orchestrator; repair by the record |
| [mono:code-review](skills/code-review/SKILL.md) | Manual code report with an independent checker; delivery still uses Preflight |
| [mono:review](skills/review/SKILL.md) | Report-only quality/risk review |
| [mono:check](skills/check/SKILL.md) | Readiness-only transition assessment |
| [mono:deliver](skills/deliver/SKILL.md) | One delivery context sequencing its three phase owners |
| [mono:implement](skills/implement/SKILL.md) | Свой инженерный этап: старт, код и доказательства каждого критерия; один отчёт для Preflight |
| [mono:preflight](skills/preflight/SKILL.md) | Local verification, commit, the collection's review round and ready certificate |
| [mono:ship](skills/ship/SKILL.md) | Accepted pre-ship drift, PR, docs, feedback and green certificate |
| [mono:qa](skills/qa/SKILL.md) | Независимая проверка готовой задачи или всего проекта на хосте: ожидания до действий, доказательства, баги и сертификат; заданная версия без права вливания |
| [mono:deploy](skills/deploy/SKILL.md) | Guarded merge, version proof, production checks, rollback/return and truthful outcome |
| [mono:orchestrate](skills/orchestrate/SKILL.md) | Product control plane: dispatch, monitoring, decisions and Linear writes |

## Documentation Map

| Need | Source |
| --- | --- |
| Artifact contracts and stable rule IDs | [Contract index](references/artifact-contracts.md), [Project](references/contracts/project.md), [PRD](references/contracts/prd.md), [Tech Spec](references/contracts/tech-spec.md), [Issue](references/contracts/issue.md); retired IDs are not reused |
| Scoped discovery intake and source precedence | [Artifact intake](references/artifact-intake.md); supplied paths, current Linear package and scoped context take precedence over stale scratch evidence; name missing/conflicting inputs |
| Artifact form and execution quality | [Artifact rules](references/artifact-rules.md), [quality bar](references/artifact-quality.md), [execution quality](references/execution-quality.md), [repair](references/repair-machine.md) |
| Risk, review and phase boundaries | [Readiness gates](references/readiness-gates.md), [review rubric](references/review-rubric.md), [lifecycle](references/lifecycle.md) (order, statuses, record chain and stage tasks; each stage keeps its own rules in its skill), [ship feedback loop](references/ship-feedback-loop.md) |
| Decisions and owner-facing wording | [Questioning](references/questioning.md), [human output](references/human-friendly-output.md), [decision/status/wave brief](templates/orchestrator-brief.md) |
| Runtime and worker recovery | [Orchestration](references/orchestration.md) with its parts for [stages](references/orchestration-stages.md), [dispatch](references/orchestration-dispatch.md) and [delivery](references/orchestration-delivery.md), [worker contract](references/worker-contract.md), [dispatch](templates/orchestrator-dispatch.md), [report](templates/orchestrator-report.md), [compaction](templates/compact-instructions.md) |
| Linear artifact templates | [Project](templates/project.md), [PRD](templates/prd.md), [Tech Spec](templates/tech-spec.md), [Issue](templates/issue.md), [project updates](templates/project-update.md); templates define form, contracts define obligations |
| Review, check and delivery output | [Review](templates/review-output.md), [check](templates/check-output.md), [ship](templates/ship-output.md), [interactive ship status](templates/ship-status-ux.md), [deploy](skills/deploy/references/output.md); examples are placeholders, not evidence |
| Installation and policy | [Install](references/install.md), [versioning](references/install.md), [models](references/model-policy.md), [risk classes](references/readiness-gates.md#risk-classification) |
| Rationale outside worker reading | [Audience](references/rationale/audience.md), [review](references/rationale/review.md), [output](references/rationale/output.md), [delivery](references/rationale/delivery.md); explanation adds no obligations |
| Worked examples and history | [Consumer dogfood](examples/consumer-dogfood.md), [profile regression](examples/profile-workbench-regression.md), [CHANGELOG](CHANGELOG.md) |

Runtime scripts live in [scripts/](scripts/): `gate.mjs` checks evidence; `delivery-state.mjs` publishes reports and waits for review rounds (`wait-round`); `review-rounds.mjs` keeps the round ledger; `runtime.mjs` provides role resolution, config validation, durable writes, locks and hashes; `orchestrator/spawn.mjs`, `resume.mjs` and `consume-gate-ack.mjs` use the shared launch implementation; `watch-workers.mjs` monitors registered work and keeps the Claude login fresh (`claude-login.mjs`); `resolve-issue-context.mjs` resolves the issue-only seam; `verify-pack-state.mjs` verifies identity/quiescence; `wave-cost.mjs` measures cost; `read-budget.mjs` bounds reading. Invoke runtime scripts from the installed pack, with `--help` and pinned dispatch inputs. Install and update through the [GitHub marketplace](references/install.md#plugin-updates); maintain product config with `project-config.mjs` from the upstream checkout.

## Principles

Keep skills as routes and artifact-scoped owners, wrappers as sequencing, and references/templates as progressive reading. A module should carry meaningful complexity behind a real interface; deep/risky changes require evidence at system seams. Trace actor → capability → benefit, and prove one behavior before expanding implementation. Record real external-system responses rather than inventing contracts.

Keep gates and responsibilities intact in both interactive and orchestrated delivery. Review supplies findings and the next owner; check supplies readiness; accepted fixes go through handoff, issue renewal, ship drift or explicit artifact owners. Never silently synchronize drift or promote stale approval. Read only relevant, bounded sources, name stale/unavailable/conflicting inputs, and preserve the confidence boundary.

Treat Markdown as agent instructions. Protect executable behavior with fixtures, artifact contracts with their bounded fingerprints and consumer checks, and document shape with skeleton checks. Do not encode agent-only rules twice or pin sentences. Every pack change begins with a Linear Issue; handbook freshness is mandatory even when the optional documentation workflow is unavailable.

## Manual code review pilot

`mono:code-review` reports checked code, verified findings, remaining work and
whether ordinary checks can continue. It leaves the tree and Linear untouched.
Use `node scripts/code-review.mjs --request <temporary.json>` with
`{worktree,head,base,contract,risk,config}`; head/base are full immutable commits,
the tree must be clean, config is the parsed product config. Human report is the
default; `--json` prints the returned record. It neither runs verify nor signs or
issues a delivery certificate; delivery runs the same round inside collection.

`runReviewRound(input,{runRole?})` in `scripts/code-review.mjs` is the sole circle
boundary for the host and manual command. Input includes the task contract and
optional `stageRecord`; output has schemaVersion, base, contractDigest, rounds,
findings, failures, the current round and the code-computed outcome. Callers own
persistence. Technical failure returns no round and is retried once.
Changed-file coverage gets one focused pass. Risky/1000-line first rounds add an
ordinary second pass, combined by stable class/file/code-anchor key. The checker
sees every open finding (over 16, split into batches), original base content, current files and prior decisions;
only its evidence closes or reopens a key. Checker wire IDs are F1..Fn; code maps
them back to stable keys. Each failed answer is kept in the record, capped at 8 KiB. The checker assigns P0-P3, R7 danger/case,
origin relative to task base, merge key and scope/risk flags. Code adds whether
the location changed after round one (±2 context lines), costs and failures.
Danger retains the maximum over all observations of a stable key (true > unknown > false), before any reopening shortcut; unknown/unmarked danger stays dangerous. The record keeps this tri-state maximum alongside its fail-safe boolean danger. A fresh unresolved verdict is retained even without newEvidence; an old safe rejection cannot discard a later dangerous or unknown verdict. A previously dangerous key retains its danger and original origin even after closure and reopening. A rejected finding stays unresolved and open if either role marks danger true or leaves it unknown, regardless of an exact codeQuote or Git-verified deletion. Only both-explicit-false findings can close through rejection. Contradictory merge verdicts get one batch retry, then keep separate keys. Visible damage, recognizable placeholders or downstream fail-closed
checks do not excuse false gate refusals, altered evidence or missing readiness.
Unknown danger stays dangerous. Pre-existing non-dangerous defects are reported;
confirmed ones stay report-only on round three; open unresolved findings block.
Scope/risk flags are structural: each stable key retains their logical OR over all rounds, computed before reopening shortcuts. Rejection, closure and new checker evidence cannot clear them.

Roles see the diff, task contract, project rules and pinned files as they are,
through the same subscription providers as the coding worker. The stage does not
screen for secrets: inputs, model output, records and reports are not redacted.
A role answer is one JSON object of at most 2 MiB, checked against the response
fields; a malformed answer is retried once. Malformed JSON input to the manual
and evaluation CLIs produces a fixed diagnostic. Binary blobs (NUL-containing or
non-UTF-8) are not role inputs and are not exported; changed binary paths are
listed as «двоичный файл, не проверялся» without affecting the text-review
outcome. An open finding on a path that exists at the reviewed head but has no
readable text (a binary file or a directory) stays open and makes the round
`not-reviewed`; deletion evidence requires actual path absence at that head.
`contractDigest` and the evaluation comparison identity are plain SHA-256 digests.

Recorded fixtures stub the native catalog; live host probes use the installed CLI. Repository rules
come from pinned Git blobs; the host never follows AGENTS.md symlinks into files
outside the reviewed version.
The circle and evaluation share one host Git policy: override color, hooks and
fsmonitor, disable configured content filters and diff/merge helpers before every
call, and force `--no-color`, no external diff and no textconv on diff/show.
Outgoing diffs are built per file from the pinned base/head blobs, so attributes
cannot hide a change; file modes and added/deleted paths are kept.
Both roles read one temporary, read-only export of every pinned HEAD text blob, with no `.git` directory. Export attributes cannot hide or rewrite files; symlinks become their target text and are listed in context. The export is removed after the circle. Neutral global/system Git config and helper overrides remain defense in depth; mutable environment overrides are not the repository-config boundary.
Exact contract blobs keep their bytes. Worktree reads refuse gitlinks and index
hints (`assume-unchanged`, `skip-worktree`) before inspecting files.
Role stdout/stderr accumulate bounded raw Buffers (16 MiB/1 MiB) and decode once with fatal UTF-8 before parsing; chunk boundaries preserve multibyte paths and evidence, the BOM is kept, and invalid bytes are refused. Interruption kills the role process group, is never retried and stops later evaluation calls as a scored row.
`scripts/code-review-real.test.mjs`, run by verify, runs the round over a fixed list of twenty real pack changes (including the 112-file 28f5de40) with stub roles. Every change must come back `clean` with each changed text file in the diff and in the export; CI fetches full history.

Outcome vocabulary is `clean`, `clean-with-successors`, `not-converged`,
`not-reviewed`. The round itself reports successorKeys as `not-converged`; the
collection gate decides which leftovers pass as successor candidates. A
dangerous finding closes only by an agreed fix on a later head: the checker
verifies it gone and the reviewer no longer reports it. No model selects a
stage outcome.

Roles [code-review](references/model-policy.md#roles) and
[code-review-checker](references/model-policy.md#roles) resolve separately with
native subscription auth and different known families. New circle pairing
records use `requiredPairings(config,{reviewerRole:'code-review'})`; existing
role-less records still refer to the legacy `autoreview` role. New records bind the full checker
route in `reviewer.checker`; either role change requires renewed acceptance.
New circle launches also check changed producer routes against that pair.
Pair acceptance cannot waive the
new roles' family boundary. Each launch has its own read-only permissions and a
neutral working directory, with user/project configuration, hooks and connectors
excluded. Codex gets a temporary auth-only CODEX_HOME and a native catalog with
write/delegation tool selectors removed. Each launch probes its live tool list;
unknown tools or MCP startup fail closed. Claude retains USER/LOGNAME for native
login and reports its startup tool list; a tree under a denied credential directory
is refused before any model call. Human reports name each engine, requested model,
all observed served models (init, fallback events and modelUsage), family
and observed boundary, including unknown observations. The [dataset instructions](evals/code-review/README.md) state the
credential-read limitation and required live boundary tests.

## Validation

Bot-limit fixtures: `node --test scripts/gate.test.mjs scripts/deploy.test.mjs scripts/delivery-runtime.test.mjs` cover first green, red/pending CI, restart/fixes, empty policy, new/legacy certificates, and retained CI/owner blockers. Check-run bot responses are synthetic; recorded PR 244 replies remain in `scripts/fixtures/claude-pr-replies/`. A live silent-bot → timed Ship → Deploy merge check before review is separate evidence; skill scenarios run through the orchestrator in test Linear (U3).

Fixture children: worker and collector launches are detached, so a fixture that starts them guards its scratch directory with `scripts/test-fixtures/fixture-processes.mjs` (stub owner watchdog, a janitor for a killed test, and an after-test check that no process naming the directory survives); `node --test scripts/fixture-processes.test.mjs` covers the guards.

Pack installation fixtures: `node --test scripts/pack-install.test.mjs` uses fake Claude/Codex CLIs and temporary profiles; it covers interrupted installation, immutable rollback targets, holders, dual-file pins, tree proof, fresh-session discovery and the wave cycle.

The recorded [Claude PR publication probe](references/worker-contract.md#claude-pr-probe)
on Claude Code 2.1.316 / pack 0.42.0 confirmed replies, thread resolution and PR
comments with existing transport permissions. Use one bare `gh api` per Bash
call. A compound-command denial means retry the same write bare; only denial
of the bare write stops delivery with «нет права публиковать ответы». Raw GitHub responses and denied/successful
session fixtures for the next Ship work live in `scripts/fixtures/claude-pr-replies/`;
replay them with `node --test scripts/claude-delivery.test.mjs`. Replay does not
replace the orchestrator's live GitHub check before merge.
The model-policy scan treats only the exact recorded journals and launch JSON
paths as historical data; neighboring documentation and executable code remain
checked. Provenance reconstructs the original journal hashes after removal of
one leading empty line; all recorded JSON content is unchanged. The bare-denial
scenario is synthetic; the recorded compound denial is not evidence of no rights.
Instruction sentences and descriptive qualifiers stay free to reword: tests check
archive/version structure and recorded behavior; review checks instruction meaning.

Наблюдённые способы поднять безопасную копию и сохранить доказательства для
веба, терминального пака и мобильного симулятора собраны в
[рецептах QA](references/qa-recipes.md). Там же — результат загрузки WebM в
Linear, ограничения пробы, требования к хосту и время шагов. Замок стенда
берёт только проверка на симуляторе, веб-проверка его не ждёт. Это справочник;
тестировщик [mono:qa](skills/qa/SKILL.md) использует его на хосте.
Проверка сертификата: `node scripts/qa-certificate.mjs <report.json> <expected.json>`;
[отдельный шаблон](templates/qa-output.md) описывает task/project, короткий и
given-version сертификаты. Ожидания связывают id, точный текст и источник; scenario нельзя исключить или заменить no-behavior.

Run before completing a change (independent steps run in parallel; `MONO_VERIFY_JOBS=1` runs one step at a time):

```bash
node scripts/verify.mjs
```

The entry point includes `git diff --check`, syntax checks, artifact/workflow checks and isolated plugin runtime fixtures.
Its session-audit step runs every `*.test.mjs` of the project skill `.claude/skills/session-audit/scripts/` (not part of the pack) on synthetic fixtures without listing the files.
It also runs the recorded code-review round and evaluation fixtures:
`node --test scripts/code-review.test.mjs scripts/code-review-eval.test.mjs scripts/code-review-real.test.mjs scripts/code-review-login.test.mjs scripts/code-review-cause.test.mjs scripts/claude-login.test.mjs`.
These prove parsing, coverage, launch boundaries and result calculation; host
isolation and live model quality remain host checks, as described in the
[review dataset](evals/code-review/README.md).
Checker calibration treats unclear gold danger as dangerous; removing it blocks release and leaves calibration incomplete.

Design approval regressions cover legacy `paper=`, new `canvas`/`tool`, mixed or
incomplete fields and a damaged latest record through the shared reader and the
`design`/`route` commands. Run them with
`node --test scripts/idea-gate.test.mjs scripts/design-gate.test.mjs scripts/skills-records.test.mjs scripts/project-config.test.mjs`;
config cases accept Wonder and omitted defaults and reject unsupported tools.
Paper guard regressions use a real stdio relay fixture for two allowed test files,
missing/foreign IDs and forbidden actions: `node --test scripts/skills-catalog.test.mjs`.
All post-Idea scenarios require the project-bound Brief, including a seeded Brief
that a stage only reads (`scope: project`). Empty/unclear scenarios compare the
native baseline and every write: no unapproved change to the current essence,
decisions or exclusions; a proposal belongs in Open questions. Approve/correction
rubrics check consent links, owner thoughts and read-back. Handoff approve seeds
a filter conflict with the approved PRD and requires reconciliation before the
package record. `references/brief.md` selects all six stages. These behavioral
scenarios run on the orchestrator host; unit fixtures prove the checker only.
The live Design approve/correction/empty and main-file scenarios run on the orchestrator host,
not in a delivery worker; local fixtures do not certify live stage behavior.
It also runs the [skills host probe regression](evals/scenarios/probe/README.md):
recorded window replies from both hosts and the Claude text-before-window defect/control.
Run it alone with `node --test scripts/skills-probe.test.mjs`. These local samples
do not certify host isolation, Linear writes, Design or client screenshots.
Host drivers and the trace checker are documented in [skill QA](references/qa-skills.md).
The Codex startup read retry audits the entire failed turn and its completion before resuming.
Run a scenario with `node scripts/skills-run.mjs <request.json>` or check its native
trace with `node scripts/skills-trace.mjs <request.json>`. The active catalog uses
word replies only. Question roles, approval/start outcomes and anchors are fixed
before the run; a required rubric judges their meaning against the native document.
A short summary links to the document ID and body hash read before showing and
freshly after the reply; updatedAt is auxiliary. A record read from a comment list,
whose rows carry no address, is linked by `#comment-<id>`; a Design summary links the
canvas of its approval record while the named PRD stays bound by the reads. A package
start carries the hash of the `mono-package` fence content, equal to the record header. Corrections change only the named
passage. The driver starts a following stage only with predefined scenario permission
and a native post-reply action after the current stage rubric passes. Canonical
document identities come from native responses, including slug lookups. Harmless
deferral wording is allowed; exact forbidden offers and the semantic rubric remain
blocking. The production driver, checker and record verifier select window mode
only for tested versions before 0.43.0; current versions retain the window ban.
Claude background-task yields and pending completion notifications wait for a fresh
completed parent stage summary; progress before the notification-processing turn
cannot trigger an owner reply. A consumed native notification permits the
completed parent turn; host-injected Skill bodies and resumed developer/system
context never become owner replies. Claude scenarios permit one logged neutral
idle continuation, then keep repeated progress unverified. Idea
presentation titles stay outside the canonical four-section approval; absent
presentation bindings remain unverified. Markerless legacy choices require an
explicit scenario label (`expectedWindows.role: "choice"`); the checker still
reports malformed cards and summaries stranded before an async window. Codex
window answers require the native reply envelope with the tested call and question
identities; plain chat and replies to other calls remain unverified. New tool
work ends earlier progress; the last visible presentation after that work must
appear in the final summary. Reasoning, blank messages and delayed results of
earlier calls cannot hide that presentation. Only non-target free questions can
omit options; target windows always require the scenario decision, advice,
reason and valid options, including in role-less historical contracts.
Historical acceptance uses real native window answers and the current conversation
rubric. Linked approval records still bind the shown version after the answer;
Claude child events cannot supply that owner-visible presentation or replace the
last parent summary.
Historical Claude windows retain that parent summary across message IDs; newer
parent text replaces it, and parent service work invalidates it.
Historical record verification requires every native window check and the digest-bound
conversation rubric to pass. The tested version selects this path: text-reply
metadata cannot bypass historical windows. Named corrections share the text path's
snapshot and project-body checks, accepting only the authorized revised artifact.
Rubric input includes the actual summaries, questions,
native answers and following responses. Missing scenario policies, rubric input or
judgment remain unverified. Approval requires an actual approving option label or
the scenario's exact correction text; arbitrary prose cannot grant authority.
Offline Claude answers may come from the already verified native receipt.
Every historical scenario source, including each additional trace, requires its
own window expectations, policy and native answer proof. All source exchanges
enter the combined rubric; missing evidence stays unverified, and any failed
source or record dominates an unverified one. Resume fingerprints include native
answer journals. Codex refusals use the same call/question reply envelope as
other window answers and grant no approval authority. Historical Idea creation
compares the project description with the canonical three sections while the
approval snapshot binds the complete shown presentation. Native issues may omit
the team: the fixed dump resolves it through project metadata or complete team
reads before reading exact status UUIDs; ambiguous teams keep status verification
unverified without discarding the issue dump. A status written as a name in another
letter case or as a status type resolves only to a single status of that catalog. Recorded window failures remain
failed even if later native answers or trace reads are missing.
Resume can explicitly re-prepare bindings after a rubric digest exists; the old
judgment is discarded and only the new digest can certify the annotations.
Historical Codex sources omit owner rubric input only when a completed additional
trace has no assistant text, window calls or writes. Scenario response anchors
use stems/alternatives; malformed questions and unauthorized records still fail.
The AC1 guard reads all files under `skills/` and `templates/`, plus
`references/owner-dialog.md` and `references/orchestration*.md`, for retired window
labels and answer-list formatting. History and old fixtures are outside that scope.
The suite saves the native trace, writes and fresh dump with their rubric digest.
Review that saved evidence, then use the same request with `resume: true` to
continue without rerunning a completed stage. Changed evidence or digest refuses
resume; failed and unverified rubric results still block the next stage.
Binding preparation targets one saved stage and preserves completed earlier
rubrics; native notification enqueue times, tool-name listings and rendered Linear
mentions do not change the verified owner or record history.
Extra replies, questions, completed turns, forged quotes, early writes and unfinished
main/scout activity remain blocking. See [skill QA](references/qa-skills.md).
The [scenario catalog](evals/scenarios/README.md) holds six Mono stages and 19
scenarios, with per-host question roles and probe-derived seeds. Scenario replies are fixed before the run. Fresh seed routes are
checked before the stage starts. Select a committed
`base...head` with `node scripts/skills-select.mjs <request.json>`, then pass that
saved selection and the explicit index path to `node scripts/skills-suite.mjs
<request.json>`. The optional `qa.skills` recipe connects any product's own index/hosts/perChange.
Use configFile/expectedFile/taskExpectedFile in selection to save scenario × host
expectations in task-expected.json. Per-change selection can be disabled while
acceptance still selects the full catalog, including direct selection with an
empty or stage-only diff. Release selection uses the catalog's
explicit release plan: all six stages once in one fresh project per host, without
Linear seeds. It requires an orchestrator start reason for the separate transition
after Design, and retains rubric/record checks before each next stage. Its generated
report lists all four clients as unverified until host-side capture supplements it.
The [acceptance key](evals/scenarios/acceptance/key.json) names the exact historical
conditions, required screenshots, fixed-version controls and real gate decisions;
a different failure or a report color does not satisfy the key. Mono's own config is activated
only after 0.42.0 is installed. The expected items are frozen before the first host call;
removed scenarios are refused. Main paths use short chains in one fresh monotest
project, other neighbors use their own seeds. Design requires a request-supplied
Paper file list (`paper.fileIds`, sandbox first) and the neutral pre-execution guard.
Wonder is outside this harness; its first acceptance is a live task after release. These data files are not part
of normal required reading. Project manifests use `get_project.uuid` as `id`;
invalid or required missing manifests fail that stage, leave later chain stages unverified,
and preserve the suite result while other units continue. Seed prompts request
only their recipe's data. A manifest is required by an expected `project` record,
a seed or a chain member; standalone Idea approval and correction require it.
An unanswered standalone Idea forbids project creation and needs no manifest;
an absent seed pointer means `unverified: seed not completed`, before the stage starts.
Every stage's manifest is compared field by field (`id`, `name`, `url`) with
the existing project, including the first stage with its validated seed pointer;
JSON key order does not affect identity. If an unverified stage omits its own
manifest, its validated seed project still routes fresh record reads; next-stage execution
also requires predefined permission and a post-reply action; it does not trigger another seed or promote the stage to passed. A passed
stage still requires its own manifest.
The suite requires a Git checkout at `packRoot` on `selection.head`, with no
tracked changes or untracked execution files. It checks again before and after
each stage; unversioned scratch copies have no silent override. Stage file rules
include consumed contracts and references. If no stage maps a change under
`skills/`, `references/` or `templates/`, selection is explicitly `uncovered`
(CLI exit 2), and the suite returns `unverified` rather than a zero-item pass.
Extra stage questions outside scenario policy fail.
Design alone grants the test product memory directory, its `approved/` archive,
and a fresh export run directory;
its approval reason anchor is advice, without requiring the next stage name.
Paper exports to the owner's Downloads without a path parameter. The guard copies
only files named by that result into the run directory, verifies size and SHA-256,
then rewrites their paths; foreign paths and symlinks are refused. If deleting an
original fails with EPERM/EACCES, its path is logged and listed in suite-result's
`exportLeftovers` for the orchestrator; other failures remain errors.
Design archives the returned files normally.
Unit preparation failures persist completed items, fail that unit and leave its
later chain unverified while independent units continue. Empty selection is
`not-required` (CLI exit 0), never a pass. Scout definitions select their launching
stages; missing project manifest paths are refused before prompt generation.
A scenario with `continuation: "same-session"` hands its conversation to the next
non-Design stage of its chain, as in the owner's session: Claude resumes the session
(`--resume`), Codex resumes the thread in the same private home with this stage's
MCP servers. Design always opens its own session and returns to that parent, so
Discovery → Design → Tech Evaluation → Handoff keeps the last two in Discovery's
conversation; a Design scenario cannot declare a continuation. A scenario `chain`
lists earlier scenario keys in pipeline order and selection runs them as one unit.
A continued stage skips the workspace read its conversation already made, and its
evidence holds only its own turns (Codex writes the rollout tail as `trace.jsonl`).
A reply step with `intent: "inherited"` moves without a question and without a
driver answer under an earlier recorded consent. It must be the last step, show
its summary, ask nothing and pass its declared response; an undeclared skip fails
as before. A record under an inherited step (MONO-485) keeps its machine form and
names outside fences («Согласие наперёд:») a `mono-forward: granted` comment of this
Project. The suite passes every earlier passed text stage of the chain as
`forwardEvidence`; the grant must be the write that followed a real owner reply
declared `forward: "tech"|"package"|"start"` with the same words. Scope, PRD and Design
versions, revokes, at most three start Issues and the words are checked against the
fresh dump; between the words and the record only an interjection marked
`continues: true` may be an owner reply. An approval record carries a grant only
for a reply that declares `forward`.
A step with `intent: "interject"` sends its `reply` as a real owner message after the
completed turn that shows its summary and asks nothing, for example a correction in
the middle of a chain; a later step must carry the stage's answer.
The stage driver takes each run's permitted stages only from its launch argument in
that run's MCP config (a resumed host restarts it), never from a file the stage can
write; its schema lists only the fixed stage vocabulary, so a continued stage starts
what its own run permits rather than what an earlier stage's schema listed.
Focused checks: `node --test scripts/skills-catalog.test.mjs scripts/skills-window-roles.test.mjs scripts/skills-continuation.test.mjs`.
The shared audit bounds real MCP actions to monotest/Paper and a local stage-driver
control tool, and requires a workspace read before writes. Every main/child rollout
shares that boundary; replies and completion stay tied to the main thread.
Cleanup still signals the process group after its leader exits. A fixed 500 ms
grace bounds held pipes; timeout remains a failure, and normal exit retains its
evidence verdict. ESRCH and macOS EPERM for an exited leader stay quiet.
The exit event is sufficient even before exit fields update. Other signal errors
are kept in `cleanupErrors` without changing the original verdict or timeout.
Codex accepts completion on the final allowed iteration before reporting the
turn limit; an unfinished scenario still fails and the default remains 32.
Host information remains open: unknown events and
non-tool blocks are ignored, other native host items and dynamic exec access are
notes. Exec audits tool names, without command lists or a JavaScript parser.
Host tools default to `"*"`; all monotest tools are available after confirmation.
The private Codex home retains a disabled Linear transport and approves test MCP
servers. A startup read race retries once. Native proofs still require linked
host evidence, native text, delivered replies and fresh completion. The default
stage budget is one hour; text checks retain the full native trace.
Run `node --test scripts/skills-{owner,run,trace,probe,proof}.test.mjs`.
MONO-291 release/window regressions: `node --test scripts/skills-release.test.mjs
scripts/skills-records.test.mjs scripts/skills-process.test.mjs scripts/skills-catalog.test.mjs`.
The fixed dump includes raw team status lists and resolves exact UUID/name pairs;
another status of the same type is a mismatch. Claude tool discovery, synthetic
skill timestamps, rendered Linear chips/links and driver-initiated 137/143 exits
have paired regression controls. These fixtures do not certify live client screens,
ordinary-session isolation, measured per-change cost or release acceptance.
Codex audits after a turn and cannot promise pre-execution refusal; isolation comes
from the test home and servers, not from command strings. A mechanical pass still
needs the conversation rubric and live orchestrator proof. Standalone synthetic
checker parity remains MONO-294; scenario sets, record checks and QA gates are
later package work.
Scratch validation copies include the scout-hook template. Runtime fixture files run sequentially to isolate their deadline assertions from concurrent process startup. Process-cleanup tests advance controlled driver clocks only after real child output or leader exit: startup load consumes no test budget, while the timeout and 500 ms cleanup bound remain asserted against live leaders and held pipes. CI runs it on PRs and pushes to main. Required handbook sections and all 34 rule links are checked structurally; a renamed target section fails with the rule number. Tests also remove required handbook sections and exercise model-policy detection on README. Passing link checks establishes addressability, not semantic truth.

Use focused checks while editing:

```bash
node --test scripts/qa-certificate.test.mjs scripts/qa-evals.test.mjs scripts/project-config.test.mjs scripts/landing-drain.test.mjs
node scripts/validate-workflow.mjs --handbook-only
node scripts/validate-workflow.mjs --model-policy-fixtures
node scripts/read-budget.mjs
node scripts/validate-plugin.mjs
claude plugin validate . --strict
node scripts/lint-mono-artifacts.mjs
node --test scripts/route-gate.test.mjs scripts/design-gate.test.mjs scripts/tech-gate.test.mjs scripts/initiative-gate.test.mjs
```

Runtime tests use scratch plugin folders; the real sandbox-boundary test runs outside a worker sandbox and reports an explicit skip when nested sandboxing prevents it. Installation, live production QA, deploy and owner acceptance are separate evidence boundaries, never implied by a local green check.

Skill record checks: `node --test scripts/skills-records.test.mjs scripts/qa-certificate.test.mjs scripts/qa-gate.test.mjs`.
A separate monotest-only read process dumps the fixed project/documents/issues/comments
checklist after each stage. The script schedules every read and saves native raw
responses; the model never writes dump files. Successful seed writes need the
expected project/route; strict payload/history checks apply to scenario writes.
Project status matches the identity supplied by the write (id or name).
Any unverified item retains its status while the chain gathers later evidence;
only a real failed stops that chain. Native write results use complete fresh
cursor chains; working MCP calls stop the suite. Manual-removal links require a
successful mutation; reads and errored or missing results never suggest deletion.
Record counts use the stage gates’ block scanner and record locations: project
comments for approvals/start, document fences for Research. Prose mentions and
task logs never count as records; real duplicates still fail. Short input types match
the canonical approval/start marker names exactly; suffixed names do not match.
Native CommandExecution metadata identifies quoted shell command data inside exec;
MCP names in that data are not record calls. Actual unbound monotest calls stay
unverified, and native McpToolCall records are always retained.
The suite reports scenario/host, duration and unique monotest task count. Missing
native evidence stays unverified. The unchanged landing gate requires passed;
MONO-279's exact expectation/source binding is included. See [record proof inputs](references/qa-skills.md#свежий-дамп-и-сверка-записей).

Record checks apply to every supplied native trace, including scouts and dump
children. Owner-conversation expectations apply to the main trace; additional
traces opt in with their own expectations while retaining the full call, terminal
and record audit. Supported literal Codex exec arguments are decoded before
start/transition checks, matching direct-call authority.
In multi-stage traces, the preceding reply determines the source stage and
permitted destination of each transition; earlier consent cannot authorize a
later deferred start. Each dump read must
provably start after all scenario writes; missing
or overlapping order stays unverified. Native times and Claude's hash-bound
driver process interval support offline replay; request times and file mtimes do
not. Public live excerpts retain their original native clock evidence.
Page reads use fixed per-tool arguments, preserved across the cursor chain;
search filters cannot prove an exhaustive project dump. Approval binds the last
owner-visible text of the decision turn. Native MCP completions need a linked
literal invocation to prove a fresh read preceded the approval write; an excerpt
without that invocation remains unverified.
Dump host/capacity failures remain unverified and get one isolated retry. Both
attempts are retained and audited; observed write violations stay failed. A
non-binding unverified dump continues its chain without becoming passed. Linear heading gaps and
trailing empty lines normalize without changing text, paragraph or code checks.
Codex approvals use delivered native rollout answers; its `{thread,prompt}` sent
journal is not a Claude event stream. Live3 regression excerpts include that journal
and the scripted dump's own rollout, matching the suite's record-check inputs.
Stored Markdown comparison accepts Linear's link wrappers, list markers,
self-links on bare file-like tokens, backslashes before prose square brackets,
spacing at heading/list boundaries, the indent of a list item's continuation line,
the dash count of a table delimiter row and CommonMark's edge-space trimming of a
code span, while retaining paragraph breaks and code text.
Package starts require Handoff's native start/delegate button; other approvals
still require an approval answer.
Version bindings use the gate's existing record parser and a native read before
display. Surrounding prose, a different decision window or a repeated cursor
cannot make an approval or incomplete dump pass.
