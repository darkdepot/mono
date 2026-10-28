# Mono Agent Workflow

Текущий выпуск: **0.38.1**. См. [заметки выпуска](CHANGELOG.md#0381---2026-10-27).
Private vulnerability reports: [SECURITY.md](SECURITY.md).

## Один владелец этапа

Этап узнаёт владельца только из задания запуска. В сессии владельца следующий
этап идёт там же, кроме отдельной сессии Design. В делегированном проекте
оркестратор запускает те же этапы агентами Claude Code, отвечает им подписью
варианта и причиной на показанной версии; исключение не действует для Idea и
в сессии владельца. Идею всегда утверждает владелец кнопкой. Исполнитель-воркер
(codex-cli, claude-cli) этап не ведёт; агент этапа ведёт и сам пишет/читает обратно
свои записи Linear. Единственный писатель Linear для implement, preflight и ship
это оркестратор, применяющий очереди исполнителей. Этап возвращает запись и
выбранный переход; следующую сессию запускает оркестратор.

Делегирование: в последней записи идеи вне заборов строка «Ведёт оркестратор:
владелец принёс идею оркестратору <дата>.», повторяемая при переутверждении.
Ранее отданный проект может опираться на явное решение владельца в комментарии
проекта. Без обоих проект ведёт владелец. Только делегирование разрешает
оркестратору начать Research и работу самому, со стартом `by=orchestrator`,
причиной и вердиктом противовеса. Но `stale`/`legacy-migrate` идеи останавливает
автономный Research и работу до новой кнопки владельца, подтверждённой записи
и свежей проверки; старт оркестратора идею не переутверждает.
Обычному проекту нужен `by=owner`.
Окно Handoff: «Начать работу» / «Передать оркестратору» / «Ещё обсудить».
Кнопка и набранное «передай оркестратору» пишут `by=owner` и передают работу.
PRD без `next=`: Handoff проверяет действующую техоценку текущего PRD и при
годной записи идёт дальше без повторного предложения. Только без годной записи
для размера «обычное» или «проект» предлагает «Начать Tech Evaluation» / «Ещё
обсудить»; без согласия не продолжает и пакет не пишет. Маршрутизатор и его тест прежние. Контракт проекта PC-001/013/014/016
уточнён, новое правило PC-019 и его SHA-256 закреплены валидатором.

Оркестратор собирает определения этапа и разведчиков в `~/.claude/agents/`
под текущий хост: только точные имена файловых, терминальных, вспомогательных,
Linear, дизайн-Paper и поисковых инструментов. Никаких звёздочек по серверу.
[Шаблон](templates/stage-agent.md) вне `agents/`, рядом
[хук](templates/stage-helper-hook.mjs) PreToolUse `Agent|Task`, допускающий только
имена разведчиков этапа. Определения и путь хука сверяются при старте и перед
запуском; после изменения нужна новая сессия. Это ограничение прямых вызовов,
не изоляция. Делегированные этапы в Codex не запускаются. Разговор дописывается
сразу в `.claude/session-views/<этап>-<ключ проекта>-<круг>.md` продукта,
при необходимости исключённую через `.git/info/exclude`, со ссылкой в итоге.

Перед каждой записью `by=orchestrator` независимая другая семья модели читает
точный текст/версию и причину без подключений владельца; вердикт с моделью и
версией вне заборов в той же записи. Изменился текст или причина: новая проверка.
Строки второй модели этапов закреплены с `--ignore-user-config` и
`--strict-mcp-config`, а Codex также с `--disable apps`: подключённые приложения
не должны оставаться доступны через авторизацию ChatGPT. Владелец получает итог каждого этапа с «Утвердил сам,
потому что…» и решениями за него первыми. Новые правила вкуса и первые эталоны
по-прежнему его; его слово открывает утверждение заново. Подробности:
[общий разговор](references/owner-dialog.md), [политика](references/orchestration.md).

## Итог и одно окно

Перед каждым окном, включая выбор внутри этапа и Idea у оркестратора, этап
заканчивает чтения, помощников, черновики, проверки, записи и показ картинок.
Вопрос окна несёт суть решения и совет с причиной в одной-двух фразах, без
ссылок и разметки. У каждого варианта строка «что даёт / чем платим»; рекомендованный
первым с пометкой (Recommended), включая утверждения. При сверке нажатия и записи
снимается только завершающий суффикс пометки, подписи утверждения прежние.
Полный итог или позиция со ссылкой пишется ответом в чат, никогда только в
размышлениях. Claude Code и блокирующий Codex: текст и сразу окно в том же
сообщении, без вызовов между ними. Codex `request_user_input_async`: окно первым,
полный итог последним сообщением хода, после него вызовов нет. У async строки
последствий идут после сути в вопросе, каждая с точной подписи своего варианта.
Карточка пропала: итог и подписи текстом, без нажатия утверждения нет.
Файл, вывод команды и картинка не заменяют итог. Итог не цитирует правила и имена скиллов.
Служебные файлы этапа пишутся командой оболочки, не инструментом правки файлов.
Idea сначала показывает описание в чате, после нажатия пишет показанную версию
и заметки и проверяет форму до записи в Linear; остальные черновики до итога.
Порядок: [разговор с владельцем](references/owner-dialog.md).
Общая форма: вывод, при
необходимости «Тебе решить», главное, «Не берём» с причиной, «Дальше» и ссылка.
До 120 слов, Handoff до 150. Описание идеи само итог, Research в его «Дальше»
одной строкой; страница техлида до 130 слов без кода, «Тебе решить» всегда вторым
пунктом, последняя строка «Дальше» со ссылкой.

Idea, Discovery и Tech Evaluation: «Утвердить и начать <этап>» / «Утвердить,
продолжу позже» / «Ещё обсудить». Первое нажатие утверждает показанную версию и
разрешает переход, второе только утверждает; позже явное «начинаем <этап>»
запускает его без переутверждения после сверки версии. Research: «Начать <этап>» /
«Ещё обсудить». Handoff сохраняет три подписи выше. Без окна утверждения нет;
помощник оркестратора окна не открывает: итог и подписи
текстом концом хода, исключение Idea сохраняется.

Codex без `request_user_input` и `request_user_input_async`: итог и подписи
текстом концом хода, последней строкой где утвердить. Пустой ответ окна ничего
не утверждает, окно само не переоткрывается.

Все независимые от утверждения проверки до итога. После нажатия молча свежая
версия, запись, обратное чтение, команда проверки записи, закрытие задачи этапа,
проверка готовности по закрытой задаче; одна
строка о записи и переход только после успеха. Версия изменилась: «Было / Стало»
и окно снова, без записи. Повтор не помог: что именно не сделано, перехода нет;
записанная часть той же версии переиспользуется без дубля. У Research документ,
журнал и Done до итога; у Handoff запись пакета, задачи, отдельные вызовы
проверок пакета и задач и Ready до итога, после выбора только запись старта.
Research называет себе пределы документа до черновика. План только инструментом
хоста, служебных строк в чате нет, видимые проверки и ревью на языке чата.
Design показывает макет картинкой и только «Утвердить» / «Ещё обсудить»;
следующий этап предлагает родитель после возврата и проверки записи.

## Tech Evaluation между Discovery и Handoff

Выпущенный в 0.36.0 этап [mono:tech-evaluation](skills/tech-evaluation/SKILL.md) выбирает одно
техническое решение по утверждённым идее, исследованию и PRD. Сначала что можно
не строить и что уже есть, затем минимум, который не придётся переделывать.
Помощник проверяет настоящие случаи путём продукта, только на чтение; другая
семья модели проверяет черновики страницы и Tech Spec. Владелец получает одну
страницу до 130 слов и единое окно утверждения со стартом Handoff или отсрочкой,
без технических вопросов.

После Discovery маршрут задаёт одна запись PRD: сначала решение о дизайне,
затем размер. С экраном — Design, потом Tech Evaluation для обычного/крупного
проекта или Handoff для мелочи. Без экрана — сразу по размеру. Повторное
утверждение пересчитывает маршрут, прежняя запись без `design=` сохраняет свой
путь до него. Проверка `mono:check tech` и команда
`idea-gate.mjs tech --mode fresh --dump` проверяют запись техлида, версию PRD,
точную страницу, тело Tech Spec и связь с последней записью дизайна.

Новый короткий Tech Spec пишет только Tech Evaluation после утверждения
страницы; Handoff переносит решения в запись пакета и задачи. Разделов без
содержимого нет, отказы, выпуск и откат только по делу. Меняется строка страницы:
возврат к техлиду, после старта через ремонт класса 3 с новым стартом владельца.
Ведёт владелец: нажатие одного из вариантов «Утвердить…». Ведёт оркестратор: утверждает сам с причиной,
включая необратимое, отложенный пункт PRD и строку против прежнего решения
владельца. Оркестратор запускает Handoff после возвращения этапа; при старте работы его итог
показывает «Техлид решил за тебя:» с этими решениями и причинами. Итог этапа сразу получает владелец. Отложенный пункт переносит
Discovery без второй остановки.
После правки PRD из Handoff этап сам решает, меняется ли страница: прежняя
страница даёт новую запись без показа; меняется строка, новая страница. Во время
первого утверждения другая версия PRD всегда требует нового показа. Второе
исключение: правка ровно отложенного пункта через Discovery.
Формат и порядок записи: [жизненный цикл](references/lifecycle.md#tech-evaluation).
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
продукта, экраны с прода. Для Design должен быть открыт Paper. Фича проходит
референсы, 2–3 направления разной раскладки, сценарии и состояния; правка на месте — одно решение и показ.
Проверка по картинке до показа. Комментарий Paper становится общим правилом,
правилом продукта или разовой правкой, память пишет дизайнер с согласия
владельца. PRD меняет Discovery одним касанием с утверждением макета.

Владелец после Discovery видит «Утвердить и начать Design»: свежая сессия дизайнера получает
задание с PRD, исследованием, памятью и размером. В делегированном проекте эти этапы идут агентами оркестратора;
он выбирает направление по эталонам и вкусу, этап пишет `by=orchestrator`
с причиной и вердиктом противовеса.
Нет памяти продукта — один вопрос «на кого равняться» с предложенными эталонами;
только этот проект ждёт, остальные идут. Итог Handoff показывает решение
дизайнера рядом с решением техлида. Idea остаётся у владельца; старт работы следует правилу делегирования выше.

В сессии дизайна макет показан картинкой в чате, затем итог и только
«Утвердить» / «Ещё обсудить». После записи, обратного чтения и проверки дизайнер
закрывает задачу и пишет строку закрытия. В проекте владельца Claude Code он
пишет `.claude/session-views/design-<ключ проекта>-round-<n>.done` с «Дизайн
закончил», итогом и ссылкой; путь исключён из Git через `.git/info/exclude`,
если ещё не игнорируется. Родитель ставит фоновое ожидание именно этой отметки
при открытии дизайна и молчит. После пробуждения читает отметку, проверяет
`mono-design` командой и показывает итог с «Начать <этап>» / «Ещё обсудить».
Обсуждение идёт у родителя, правка макета новым кругом дизайна. Папка PNG не
сигнал; межсессионные сообщения не используются. В Codex владелец возвращается
сам, родитель проверяет запись на первом сообщении. В делегированном проекте
конец хода агента возвращает результат оркестратору, отметки нет. Дизайн не
запускает Tech Evaluation или Handoff и не показывает окно следующего этапа.

В Paper одна страница задачи, первая в списке; порядок задаётся полным списком
одним вызовом и читается обратно. Отказ: свежий список и один повтор, затем
честный итог, если страница не первая. Имя и иконка обновляются вместе, «✓»
появляется при утверждении и снимается на новом круге. Новые версии с подписью
сверху внутри страницы; утверждённые узлы и PNG неизменяемы, отдельной страницы
«Утверждено» нет. Перенос узлов для разовой уборки старых страниц ещё не проверен:
проба при первой работе дизайна с Paper.

Утверждение связывает Paper с неизменяемой папкой PNG и версией PRD.
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
описана в [обновлении до 0.37.0](#обновление-до-0370).
[evals/design](evals/design/README.md) проверяются при изменении описаний или evals;
обязательное чтение Discovery и Handoff — до 20 480 байт каждый.

## Задачи этапов и Ready

Research, Discovery, Design и Tech Evaluation первым шагом каждый находят или
заводят свою задачу с меткой `Этап` (`Research: <проект>`, `Discovery: <проект>`
и так далее). У Idea и Handoff задачи этапа нет. Записи о ходе работы — в
комментариях задачи, результат — в документе проекта; задачи этапов не входят
в набор задач реализации. Design и Tech Evaluation выпущены в 0.36.0 и активны по цепи записей.
Правила повторного входа, роли и единое определение задач реализации — в
[«Задачах этапов»](references/lifecycle.md#задачи-этапов), форма поручения —
[в шаблоне](templates/stage-task.md). Каждый этап отвечает только за свою задачу.

Handoff ставит Ready после записи пакета, задач и PASS проверки, до слова
владельца: Ready значит «проверено и записано», а не «начато». Обычный проект начинает
владелец кнопкой или словами; делегированный допускает старт оркестратора
с причиной и противовесом. Если Ready в рабочем пространстве нет, проект остаётся в Discovery,
проверка это сообщает. Реализация начинается из Ready; Discovery допустим у
старого проекта или при отсутствии Ready, если пакет прошёл проверки. Крупная
правка после старта снимает прежний старт и требует нового; у старого пакета
класс 3 переводит Delivery или Ready обратно в Discovery.

## Обновление до 0.38.1

Защита окон снята. В 0.38.1 итог шёл перед окном; в следующем выпуске действует
раздел «Итог и одно окно» выше: суть внутри окна, порядок зависит от инструмента.
Idea пишет файл показанной версии
и заметки после нажатия. Доверие хукам Mono в Codex больше не нужно.

После установки сессии этапов начинаются заново: прежние держат старые правила.
Формы записей и surface revision 4 сохраняются, текущие попытки завершаются на
своём сохранённом packRoot. Установка обоих хостов и проверка версии, тега и
кэшей — [Release 0.38.1](references/install.md#release-0381). Воркер готовит PR;
тег, merge и установку один раз на волну выполняет оркестратор.

После установки оркестратор проверяет Claude Desktop, терминал Claude Code,
Codex CLI и приложение Codex: в каждой среде окно утверждения и окно выбора,
в одной ещё повтор после правки. Экран и транскрипт проверяются отдельно;
помощник делегированного этапа возвращает итог и варианты как прежде (R8).
По транскриптам первого живого прогона оркестратор считает долю окон утверждения
и выбора с итогом по порядку хоста: цель 100%, все шесть этапов; этап без окон
досматривается отдельным прогоном. Это предстоящая проверка, не результат PR.
Провал исправляется порядком этапа в следующем выпуске, без новых механизмов.
После установки выпуска с U16 оркестратор повторяет проверку Claude Desktop и
приложения Codex: утверждение и выбор несут суть, совет с причиной и последствия
вариантов без раскрытия свёрнутых блоков, рекомендованный первым. Для async
вместо «итог и окно в одном сообщении» проверяется окно, затем итог последним
сообщением хода. Терминал Claude Code и Codex CLI не хуже; экран и транскрипт
отдельно. До записи результата проект не закрывается. Провал исправляется текстом
этапа; откат U16 до выпуска или установка 0.38.1 (откат самой 0.38.1 — 0.37.0).

## Обновление до 0.37.0

Одна сессия этапа для владельца и делегированного оркестратора: этап сам пишет
свои записи Linear, оркестратор отвечает на показанную версию с причиной и
проверкой другой семьи модели. Только идея, новые правила вкуса и первые
эталоны без памяти продукта остаются за владельцем. Обычную работу начинает
владелец, делегированную может начать оркестратор; Handoff предлагает и
«Передать оркестратору». Единственный писатель Linear для исполнителей
implement/preflight/ship по-прежнему оркестратор.

В конце этапа короткий итог и одно окно. Discovery сначала изучает продукт,
спрашивает по одному только неизвестное и коротко сравнивает решения; страница
техлида до 130 слов. Дизайн ограничен своей сессией: картинка, утверждение,
проверенная запись и возврат родителю. В Paper страница задачи наверху,
все версии внутри, утверждённые узлы и PNG не меняются.

После установки сессии этапов начинаются заново: прежние держат старые правила.
Формы записей сохраняются, контракт проекта явно уточнён для делегированного
старта; surface revision 4 и текущие попытки на сохранённом packRoot совместимы.
Установка обоих хостов и проверка версии/тега — [Release 0.37.0](references/install.md#release-0370).
Воркер не устанавливает пак и не ставит тег.

После установки оркестратор проводит живой прогон на трёх новых идеях
(про внешний вид, способной разрастись и мелочи) у владельца и в делегированном
проекте по PRD «Что должна доказать проверка». Это предстоящая приёмка, не
пройденная проверка выпуска. По каждому пункту результат комментарием проекта;
до этой записи проект не закрывается. Задачи закрываются по правилам доставки.

## Обновление до 0.36.0

Выпущены Design и Tech Evaluation. Маршрут: Idea → Research → Discovery →
Design, если запись PRD говорит `design=needed`, затем Tech Evaluation для
обычного/крупного проекта или Handoff для мелочи. При `design=not-needed`
Design пропускается, дальше тот же выбор по размеру. Discovery решает дизайн,
затем размер одной записью; при повторном утверждении пересчитывает маршрут.
Старые записи без `design=` сохраняют прежний путь до повторного утверждения;
отсутствие `next=` маршрутизатор ведёт в Handoff, который в 0.37.0 проверяет
техоценку и для обычного/крупного PRD без неё предлагает Tech Evaluation.

Design работает в открытом Paper: эталоны и память вкуса, макеты, проверка
картинок, утверждённая версия PNG. У оркестратора дизайнер сам выбирает
направление и утверждает `by=orchestrator` с причиной. Если нет памяти продукта,
владельцу остаётся один вопрос «на кого равняться» с предложенными эталонами;
ждёт только этот проект. Техлид затем проверяет решение и пишет короткий
Tech Spec; Handoff переносит решения дизайнера и техлида в пакет и задачи.
Прежний UX-чекпоинт с `/design-html` заменён этапом Design; проверка после
выкладки сравнивает экраны с утверждёнными PNG и правилами вкуса.

Контракты проекта и Tech Spec обновлены явно; поверхность доставки остаётся
revision 4, текущие попытки продолжаются на своём packRoot. Новая цепь записей
меняет совместимость отката: до первой записи нового формата возможен возврат
к 0.35.1, после неё — только исправление вперёд. Форматы и порядок отката
описаны в [Release 0.36.0](references/install.md#release-0360).

Обновление обоих хостов — по [Plugin Updates](references/install.md#plugin-updates).
Перед ship оркестратор проверяет Claude; живой прогон всей цепочки с владельцем
0.36.0 относился к MONO-229. Приёмка 0.37.0 после установки описана выше.

## Обновление до 0.35.1

Перед утверждением PRD видна его суть, «Решил сам» и ссылка; после правки,
в том числе из Handoff, «Было / Стало». Discovery сначала изучает детали и
приносит предложения с источниками. Idea берёт рамку из текущих слов владельца;
старый проект служит справкой. В четырёх этапах короткий старт перед первым
вызовом, затем сообщения с находками; итог Handoff и сводка показаны отдельно.

Форматы совместимы, контракты и пины не менялись; общая quiescence не требуется.
Обычные условия [Plugin Updates](references/install.md#plugin-updates) сохраняются:
проверка before-update для заменяемого каталога, пауза затронутых запусков и проверка
обоих кэшей. Текущие попытки продолжаются на сохранённом packRoot.
Проверки выпуска в [Release 0.35.1](references/install.md#release-0351).

## Обновление до 0.35.0

Этапы Idea, Research, Discovery и Handoff пересобраны как разговор с сильным
менеджером проекта, продактом и тимлидом. Утверждение везде только кнопкой
«Утвердить» в окне вопроса; слова в чате не согласие, без окна утверждения нет.
В обычном проекте исследование начинает владелец кнопкой или словами,
проект до этого в Idea; делегированный старт следует правилу выше. В 0.37.0
Research даёт итог и «Начать <этап>» / «Ещё обсудить», Discovery совмещает
утверждение и старт одним окном. Следующую сессию агента запускает оркестратор.
Сроков и строк ожидания нет нигде.

Handoff больше не пишет PRD и Tech Spec и не просит отдельного «да» на пакет.
Он сверяет утверждённое, спрашивает только про то, что меняет результат для
пользователя, деньги, данные или необратимое, режет работу на одну задачу
(до трёх по названной причине, больше только с твоим ответом), пишет одну запись
пакета комментарием проекта и ставит Ready. В обычном проекте работу начинает владелец:
кнопкой «Начать работу» или словом «начинаем». Делегированный проект следует
правилу делегирования выше.

После Research новый проект идёт в Discovery. Исключение определяется по записям, а не по дате:
это только пакет, одобренный прежним Handoff, без записи «да» на PRD; такие пакеты
живут и чинятся по прежним правилам. `discoveryGate.since` маршрут больше не меняет,
ключ остаётся допустимым в `.agents/mono-workflow.config.json`.

Явная правка контрактов проекта, PRD, Tech Spec и задачи: новые отпечатки.
Скрипты доставки не менялись: запись пакета едет воркеру в слоте `tech-spec.md`,
запись старта на месте прежнего комментария одобрения.
Выпуск совместим по форматам; общая quiescence не требуется. Сохраняются обычные условия Plugin Updates: before-update для удаляемого или заменяемого каталога, пауза затронутых запусков и проверка установки. Текущие попытки продолжаются только на сохранённом packRoot.
Установка обоих хостов по [Plugin Updates](references/install.md#plugin-updates);
проверки выпуска в [Release 0.35.0](references/install.md#release-0350).

## Обновление до 0.34.1

Discovery из 0.34.0 необязателен до новой версии этапа. Отсечка снова спящая:
**2099-12-31**. После Research основной путь — Handoff по старому пути с
написанием PRD; Discovery запускается только явной командой владельца.
Сам этап и запись «да» на PRD сохранены. Старый путь также открыт проекту без
PRD, одобрения пакета и записи «да», если текущая дата UTC строго раньше
действующей отсечки. Остальные условия `mono:check discovery` не меняются.
Если запись «да» PRD уже есть, до одобрения пакета проверяется её актуальность
при любой дате; Handoff получает такой PRD на чтение. После одобрения пакета
действуют обычные правила правок и Ship. Условие Research независимо от Discovery.

Продукт может включить Discovery раньше в `.agents/mono-workflow.config.json`:
`"discoveryGate": { "since": "2026-10-19" }`. Эта дата перекрывает спящую отсечку
из [lifecycle](references/lifecycle.md#discovery); с неё действует новый путь
с утверждённым PRD. Настройка меняет границу старого пути, а не пины и receipt.
Задачи этапов, метка `Этап`, Ready и поведение без Ready описаны
[выше](#задачи-этапов-и-ready).

Выпуск совместим по форматам; общая quiescence не требуется. Сохраняются обычные условия Plugin Updates: before-update для удаляемого или заменяемого каталога, пауза затронутых запусков и проверка установки. Текущие попытки продолжаются только на сохранённом packRoot.
Установка обоих хостов — по [Plugin Updates](references/install.md#plugin-updates);
проверки выпуска — в [Release 0.34.1](references/install.md#release-0341).

## Обновление до 0.33.0

После Idea теперь установлен Research (`mono:research`): факты до выбора решения,
документ Linear «Исследование: <проект>» и совет о следующем шаге. Этап проходит
без вопросов владельцу и без отдельного утверждения; агент этапа ведёт его сам.
Дальше — Discovery: решения, выбор и PRD с «да» на показанную версию.

Проверка Research включена с **2026-10-19, 00:00 UTC** — первого полного дня UTC
после выпуска. Для новых запусков оркестратором пакет, одобренный в этот момент
или позже, должен называть документ «Исследование» с допустимым блоком
`mono-research`; без документа запуск отказан `research-missing`. Пакеты,
одобренные строго раньше, и задачи без проекта проходят без исследования.
Мелкому проекту достаточно `not-required` с причиной.

В `.agents/mono-workflow.config.json` можно переопределить отсечку:
`"researchGate": { "since": "2026-10-20" }`. Сдвиг `researchGate.since` вперёд
откладывает правило для продукта, например при поздней установке; он меняет
только классификацию одобрений для новых запусков, а не пины или receipt.

Выпуск совместим по форматам; общая quiescence не требуется. Сохраняются обычные условия Plugin Updates: before-update для удаляемого или заменяемого каталога, пауза затронутых запусков и проверка установки. Текущие попытки продолжаются только на сохранённом packRoot.
Порядок установки и проверки обоих хостов — существующий
[Plugin Updates](references/install.md#plugin-updates); подробности —
[Release 0.33.0](references/install.md#release-0330).

## Обновление до 0.32.1

Idea ведёт идею от просьбы обычными словами до описания, на которое владелец
говорит «да». Два разведчика параллельно читают Linear и код; затем идут вопросы
о смысле по одному, окном выбора с рекомендацией, не больше трёх. В Codex без окна
выбора вопрос задаётся текстом. Оркестратор ведёт агента Idea, а описание
всегда утверждает владелец на показанной версии.
После Idea — Research (`mono:research`): факты, документ «Исследование» и совет без вопросов владельцу.

Проверка записи «да» включена: отсечка по умолчанию — **2026-10-18, 00:00 UTC**.
Запуск работы и сертификат для PR требуют запись именно этого проекта.
Проект без записи проходит «до правила» (`legacy-before-cutoff`), только если
и проект создан, и его пакет одобрен строго до отсечки. Старый проект без записи
может войти в подготовку пакета с `legacy-migrate`; «да» на идею тогда записывается
вместе с одобрением пакета. Это не разрешает запуск без записи после отсечки.

В `.agents/mono-workflow.config.json` можно задать свою дату:
`"ideaGate": { "since": "2026-10-18" }`. Сдвиг `ideaGate.since` вперёд временно
откладывает правило для продукта и меняет только классификацию проектов и одобрений;
пины и receipt остаются прежними, нужна новая попытка. Старые попытки завершаются
на сохранённом `packRoot`. До замены каталога выполните `before-update` по всем
продуктам; если старый каталог потерян, нужна новая попытка.

Переопределение `models.roles.scout` добавляйте только после установки 0.32.1
во всех затронутых продуктах и хостах. До этого используйте штатные модели нового
пакета. Роль `idea-helper` пока сохранена; удаление отдельной задачей после 0.34.0.
Для [отката на 0.32.0](references/install.md#roll-back-to-0320) сохраните и удалите
переопределение `scout` во всех затронутых конфигах, проверьте штатные роли старым
пакетом и установите закреплённый `v0.32.0` из маркетплейса.
Порядок раскатки и проверка обеих установок — [в инструкции](references/install.md#release-0321).

**Upgrading from 0.30.1 or earlier:** since 0.31.0, worker launch and resume require
a live watcher. Use [cross-product quiescence](references/install.md#quiescence):
stop launches, have each product's orchestrator confirm idle control and an empty
worker registry, then restart sessions after cut-over. Open attempts finish on
their original absolute `packRoot`; never replace or redirect that folder.
A separate staged cache can coexist until activation. Restart each product's
watcher from the new version before the first launch or resume. Missing, stale
or dead watchers refuse with `watcher-required` without consuming an attempt.
Decision journals, signed receipts and surface revision 4 remain compatible with
0.30.1; that version ignores watcher pulses and collection retry files.
See [rollback to 0.30.1](references/install.md#roll-back-to-0301) after attempts drain.

A reusable skill pack for owners and coding agents who deliver software through Linear and GitHub. Use it to turn a raw idea into approved work, run one delivery worker from code to a green pull request, and deploy with evidence. The owner decides the product; agents carry the work and show what they actually verified.

Canonical repository: [darkdepot/mono](https://github.com/darkdepot/mono).

This README is the complete introduction and owner-rule index. Follow its links for executable instructions, artifact contracts, templates, and runtime commands. Keep it current in the same PR whenever described behavior changes, as required by [Change Discipline](AGENTS.md#change-discipline).

Review repeats now stop collection before another reviewer runs. The orchestrator
records exact finding classes and a bounded `fix-class` or `limit` decision;
`limit` restricts/removes behavior, verifies the remaining contract and links a
successor. Workers park `needs-decision` before further fixes/reviews and use
existing tools or literal conservative solutions within the Issue contract.
A decision change resumes the same withheld request automatically; defects,
review routes and gate branches keep their existing requirements.
See [class decisions](references/orchestration.md#repeated-review-class).
Pending collection admissions recheck the current key/class stop on replay and
before execution. Completed collections reconcile their signed receipt without
another reviewer call. See [rollback to 0.29.0](references/install.md#roll-back-to-0290)
for the separate compatible journal view and fresh clean-review requirement.

Review limits now stop automation after two blocking external reviews or two local
passes. Counts follow the original Issue and orchestrator-authorized successors
across commits and attempts. A bounded `continue` decision permits further work;
atomic reservations and idempotent replay prevent refilling allowances. Defects
still block the PR. Pending admissions reserve capacity before execution. A clean
second local pass permits collection; a recorded local stop requires continuation.
Receipt counts use issue/pins identity, never worktree attribution. See [review limits](references/orchestration.md#review-limits).
Every collection requires a pinned request and correlated admission; unpinned
legacy requests cannot start collections. Legacy receipt reads remain compatible.
All pending admissions count when reserving and rechecking free capacity.
Local passes use stable IDs across the Issue chain; cumulative reports do not
recount passes in new attempts or successors. The ledger shows their clean or
findings outcomes.

Collections now share one deadline from phase publication through confirmation.
Configure `orchestration.delivery.collectionTimeoutSec` (default 1500),
`collectionRetries` (default 1) and `confirmationTimeoutSec` (default 1800)
before dispatch; require `collectionTimeoutSec < confirmationTimeoutSec < evidenceLimitSec`.
A run is bounded to 1500 seconds by default; a crash before a signed receipt may
retry once with the same admission, after class/cap and remaining-budget checks.
Signed failures reconcile without another review. Failed project verification
reruns once inside the same collection, with both outputs signed.
The collector-death regression waits through denied process probes within its
existing deadline, fails on live or unverified groups, and reports scenario and
cleanup failures separately. Negative controls leave a real descendant alive
past the watchdog deadline to verify that the regression still detects leaks.
See [collection recovery](references/orchestration.md#delivery-write-barriers).

## Workflow

Short dispatch extracts PRD/Tech Spec definitions through the [U12 snapshot markup contract](references/orchestration.md#snapshot-markup-contract-u12): parse blocks, then select coverage; unknown IDs refuse, while duplicates or unclosed fences retain full documents.

A **wave** is the work dispatched for an Issue, including retries, review, and its eventual delivery or recorded stop. A green PR is ready for deploy; deploy supplies the merge, delivery verification, and Linear closeout.

```text
raw idea → recorded owner approval → Project in Idea → owner or delegated orchestrator starts Research (Project status Discovery) → Discovery → Design when needed → Tech Evaluation by size → Handoff: reviewed package record, Issues, Ready
→ owner or delegated orchestrator starts work → start handshake → one mono:deliver worker
    code → confirmed write queue → local readiness → confirmed certificate
    → PR → reviews and checks → confirmed green certificate
→ mono:deploy → verification → Linear closeout and project update
```

1. **Capture.** Bring a raw idea to `mono:idea`. The founder's project manager searches Linear and code with two read-only scouts, brings findings and a recommendation, and asks at most three meaning questions. Plan only through the host tool; without it, no chat plan. Show What / Why / Target outcome / prioritized Unknowns as the summary itself, up to 120 words, followed by one line on what Research will check. Prepare the record and Research plan before showing this version. Immediately offer «Утвердить и начать Research» / «Утвердить, продолжу позже» / «Ещё обсудить». No window means no approval; chat words do not approve. Follow [the recording reference](skills/idea/references/record.md): fresh version, write, read back, `verify` and `mono:check idea`, then one recording line and the chosen transition. The Project stays in Idea until Research starts. Returning Projects preserve body/package/status when the three idea sections are unchanged; package-aware repairs stay with their owner. Decisions and doubts go into «Что всплыло в разговоре» for Research. Idea always needs the owner's click, including delegation.
2. **Research.** `mono:research` checks the fresh Idea record read-only before moving the Project to Discovery and opening its stage task. The owner starts it with the combined approval/start option or a later explicit start after approval; a delegated orchestrator may start it under the delegation rule. Gather facts, counterexamples and a second-family opinion without owner questions. Name the document limits internally before drafting, then run `idea-gate research-draft` on draft and read-back. Read back one Research document and its stage log and confirm Done before the final summary. Advice and excluded choices fit in 120 words immediately before «Начать <этап>» / «Ещё обсудить», with no intervening calls. Freshly verify before the chosen transition; a changed version needs a new summary and window. Tiny reversible work may be `not-required`; missing facts mean `hold` and a cheap next check. The next stage is Discovery, or Handoff repair for an approved legacy package. Earlier-package exceptions still use `researchGate.since`. The restricted delegated stage writes its own records and returns the transition to the orchestrator.
3. **Discover.** Run `mono:discovery` after Idea and Research off the old path, or on explicit request. Read the idea, full Research, product data and code before the first message. Keep it under 200 words: understanding with an invitation to correct, only findings that change the picture, and one unresolved question with its stakes; none remain, ask none. Usually 0–3 questions, one at a time: 2–3 choices with the recommendation first, or one sentence when a story is needed. Present solutions in a separate message under 250 words: real alternatives by owner outcome, a recommendation, its strongest drawback and a 4–8-line example on the owner's data. Design owns appearance. Mandatory reading stays within 19,456 bytes with the same three files. Finish drafts, builder and checks before the summary. The summary, up to 120 words with a PRD link and «Было / Стало» on edits, sits immediately above «Утвердить и начать <этап>» / «Утвердить, продолжу позже» / «Ещё обсудить»; the next stage follows `next=`. Freshly read the version after the click, record approval, read back, check, close the stage task and give one recording line. Failure stops transition; a changed version needs a new window; deferral records approval without starting. Tiny work skips second model and builder. Close/defer exits remain in the stage-task record. Delegated approval needs the shown version, reason and countercheck; the orchestrator launches the next stage.
4. **Design.** Run `mono:design` when the PRD record says `design=needed next=design`; keep Paper open. The designer uses product/owner memory and exemplars, checks the images, and records the approved Paper page with immutable PNGs. The orchestrator launches Design as a stage agent, chooses the direction and approves `by=orchestrator` with a reason; new taste rules and first-product exemplars remain with the owner. Show the mockup inline; the only Design options are «Утвердить» / «Ещё обсудить». Keep one task page first in Paper, with all versions inside, a meaningful icon and «✓» on approval. After verified recording, return «Дизайн закончил» to the parent using the round marker and background wait in owner-led Claude Code; Codex returns manually, delegated Design ends its agent turn. The parent verifies the record by command before offering Tech Evaluation or Handoff by PRD size; Design offers no next-stage window.
5. **Evaluate.** Run `mono:tech-evaluation` on the record route or explicit old-path request. The lead checks one solution against real product cases and a second model family before showing its plain-text page: up to 130 words, «Тебе решить» always second, behavior instead of mechanisms, last line «Дальше» with a link. The page itself is the summary immediately before «Утвердить и начать Handoff» / «Утвердить, продолжу позже» / «Ещё обсудить». After the click, freshly read inputs, write and read back Tech Spec and approval, run the record command and `mono:check tech`, then close the task. One recording line replaces the old repeated page and second transition window. Deferral does not start Handoff. Version and retry rules are shared; the existing PRD/Design partial-write exceptions remain. Handoff consumes the verified record chain.
6. **Package.** Run `mono:handoff` after the last required stage. Reconcile approved Project, Research, PRD and required Design/Tech Evaluation records; Handoff writes no new PRD or Tech Spec. A code scout checks the product; slice into one Issue unless `too-big`, `shared-base` or `probe` warrants more, with owner permission above three. Review drafts before writing. Write and read back package and Issues, run separate `mono:check handoff` and `mono:check issue` calls, then set and read back Ready, all before the summary. One summary up to 150 words sits immediately above «Начать работу» / «Передать оркестратору» / «Ещё обсудить». After the choice, freshly verify the shown version and write only the start record, read it back and check before implementation. A changed version needs «Было / Стало» and a new window; a failed retry blocks transition. Ordinary work requires owner start, delegated work accepts orchestrator start with reason and countercheck. Legacy repair rules remain; documents alone never authorize Delivery.
7. **Start.** `mono:implement` verifies pack identity, the approved package, start authorization, and the five-field context seam. For an orchestrated lifecycle move, the worker emits a gate acknowledgement before the orchestrator applies and reads back the move. In codex-cli `handshake: wait`, it waits in place for verified consumption and checks delivery on those read-backs; `resume` (default) retains exit and same-thread resume. Expiry parks `write-unconfirmed`. Product `stallSec`/`ackWaitSec` and watcher startup validation keep the wait within the existing monitoring window.
8. **Implement and prepare.** `mono:deliver` sequences `mono:implement`, `mono:preflight`, and `mono:ship` in one context. Implement exactly one approved Issue. Record every verification item verbatim, perform targeted checks, select the explicit risk-based autoreview route, and obtain clean independent review or `accepted-with-declines` with orchestrator-approved evidence. Commit a ready branch and record its certificate. `profile: short` is limited to tiny/standard, `critical: null`, `afk: true` and `openDecisions: 0`: targeted checks, commit and orchestrator collection remain mandatory; the prior local review is optional. The collector auto-confirms empty and collection queues, including carried confirmed writes. New connector writes in a collection queue require present observations in the active report session before collection. Start facts live in the code report; the Russian ready-certificate comment retains its machine block. Codex full and final deep/risky work retain the local loop. Managed Claude Code uses external committed-head collection only, with no in-worker helper pass; its ready certificate names that review route and stop/resume startup. Preserve phase ownership.
9. **Ship to green.** Synchronize accepted drift before the PR, create or update the PR through the configured ship workflow, and confirm its Linear status/link. Complete required pre-ship review and readiness checks, and the configured documentation workflow before green. Resolve review feedback and wait for current-head checks and bot evidence. Emit the green certificate only after all ship conditions and write confirmations pass.
10. **Deploy and close.** `mono:deploy` verifies that the current PR head matches the green certificate, applies the configured approval policy, and delegates the configured deploy workflow. Verify delivery and run live acceptance where users consume the result. Close the Issue only after its delivery requirements pass; publish the informational project update, report cost, record useful learnings, and retire the worker. Only the shipment of the last open Project Issue may complete that Project.

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
preserves the old text in notes; Idea never moves status. With an
approved package, stop before recording and route the correction through
`mono:handoff` artifact repair, then return to Idea recording and verification.
Without the three sections, run the normal stage with the owner. Notes carry
one-line known facts with source links for Research.

### Artifacts and truth

`idea-gate.mjs record --draft APPROVED --config CONFIG --out DIR` готовит
`body.md`: три раздела Idea с заголовками второго уровня. С `--project UUID`
и необязательным `--notes NOTES` он также создаёт `comment.md`: прежняя строка
утверждения, точный четырёхраздельный снимок и заметки вне отпечатка (с блоком «Что всплыло в разговоре»). Handoff добавляет
разделы границ работы в тело проекта. Лишний раздел `##` или текст вне четырёх
разделов в черновике дают «Стоп» (`unsupported-format`) до записи файлов.
`comment.md` записывается без завершающих переводов строки. `--notes` можно
передать и без `--project`, до утверждения: тогда появляется только `body.md`. В обоих
случаях ответ получает необязательный `warnings`: строки заметок с длинным тире
и пути, которых нет: ссылка `…/blob/<ветка>/<путь>` проверяется на этой ветке
(локальной или `origin/`, только чтение git), путь в обратных кавычках в checkout, где
запущена команда; ссылки на другие репозитории и на коммиты не проверяются. Вне
checkout заметки с путями дают `"paths":"unchecked"`. Предупреждения не блокируют запись.

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
`research/document.md`; сборка описана в [Orchestration](references/orchestration.md).
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

| Surface | What belongs there |
| --- | --- |
| Linear Project body | Idea: what, why, target outcome; Handoff leaves it unchanged (legacy packages may carry in scope and out of scope) |
| Project metadata, resources, comments | Lifecycle, active documents and Issues, relationships, approvals, review disposition, the package record and the owner's start |
| Research («Исследование») | Facts, confidence, unknowns and advice before choosing a solution |
| PRD | WHAT: actors, problem, workflows, requirements, acceptance and success |
| Tech Spec | HOW from Tech Evaluation after page approval, or a legacy package; only relevant contracts, impact and validation, failures/release/rollback when applicable; old-path shared HOW stays in the package record |
| Issue | One-PR execution contract, dependencies, AFK/HITL readiness, context snapshot, acceptance and verification |
| GitHub | Branch, PR, code review, CI, deploy and merge history |
| Worker report | Phase, exact head, decisions, every pending write and verification result; no direct Linear mutation |

Keep whole PRD and Tech Spec bodies out of Issues. Link them through Project resources and Issue chips/snapshots. Use stable requirement and acceptance IDs when required by risk. Prefer one Issue; a second and third need a named reason (`too-big`, `shared-base`, `probe`), more need the owner; Issues touching the same surfaces are chained. Mark **AFK** when an agent can execute alone, or **HITL** when a named human action remains. For a bug or performance issue, carry reproduction/baseline and fix-proof expectations, or an explicit reason that the symptom cannot yet be reproduced.

Handoff counts a change expected to exceed roughly 1,000 lines in critical paths (gates, release, security, data) as `too-big` and splits it into smaller one-PR Issues with verifiable contracts and dependencies.

### Issue-only work and repair

Use `mono:issue` only when [all nine eligibility conditions](skills/issue/SKILL.md#when-issue-only-is-granted--the-nine-eligibility-conditions) hold: an enabled lane, a genuinely one-PR self-contained request, eligible risk, and authenticated owner approval are essential parts of that boundary. Create the non-startable Issue first, then approve its exact whole-body fingerprint. The five-field seam selects the lane; a marker is an approval receipt, never a routing shortcut. Missing, broken or stale trust evidence fails closed. Renew an edited issue-only body through `mono:issue`; park and restart Project-first when required, without inventing Project documents inside the lane.

Use `mono:handoff` for [Project-first repair](references/repair-machine.md#classification-table): classify the exact proposed change, obtain report-only review, apply the class-specific worker, snapshot, approval and lifecycle effects, then check readiness. Risk growth or ambiguity raises the class. Review never repairs; `mono:check` never mutates. Accepted pre-ship drift belongs to `mono:ship`.

## Gates

A gate proves only its stated boundary. `mono:review` returns quality/risk findings (`ready`, `advisory-ready`, `needs-fixes`, `blocked`); `mono:check` reports inspected readiness (`PASS`, `FAIL`, `BLOCKED`). Neither silently changes an artifact. Their judgments supplement executable checks.

| Gate | What it proves |
| --- | --- |
| Package review and approval | The draft was reviewed at the required risk level before writing, and the owner accepted the package; implementation still needs start authorization |
| Pack identity / `gate.mjs start` | Installed pack is compatible under [the versioning rule](references/install.md#compatibility); branch, base and clean worktree match the start request |
| Start handshake / delivery check | The worker checked snapshot, approvals, resolved findings and context seam; the orchestrator applied/read back lifecycle changes; the amended package is ready for code |
| `gate.mjs preflight` | Current committed head/merge-base has successful verification and authentic clean or accepted-with-declines review evidence on the required model/effort route; missing, stale, fabricated or incomplete evidence fails |
| Pre-ship review and check | Diff matches the Issue, readiness is recoverable, required review is complete, artifacts are current and accepted drift is synchronized |
| `gate.mjs ship` | PR is open on the certified head, checks and bot review cover that head, threads and bot remarks are resolved/disposed, closure replies are published, no own review draft or outstanding change request remains, and mergeability is acceptable under policy |
| Deploy verification and live QA | Certified change was merged and delivered to the target; acceptance was checked where consumed, with explicit evidence or a permitted recorded skip |

Ship also requires recorded valid outcomes for pre-ship review, readiness, and documentation. Apply only the repository's accepted check exceptions. Pending or unknown evidence is not success; terminal failures stop the gate. A new head invalidates its old proof. The gate accumulates evidence on the current head, waits the configured quiet interval after events, and stops at its deadline rather than waiting forever.

Configure required PR bots with `orchestration.ship.botChecks` in the project
config: a nonempty list of unique check names, default `["Greptile Review"]`.
Dispatch pins the policy from the immutable base. Workers cannot empty, replace
or disable it. The orchestrator may record a confirmed outage for the current task
attempt with `accept.mjs amend --root DIR --issue KEY --attempt N --text TEXT
--bot-unavailable "<reason>"`; another attempt needs its own decision.

After an authorized ship fix, the amendment names the next ship-gate attempt:
run it for the new head with a new state file, preserving the previous one in the
same task attempt. Ship-gate attempts have no machine limit; the evidence window
and review strictness remain unchanged. Green phase reports require the same
issue/head/PR certificate validation as landing, which also requires confirmation.

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
The saved idea and selected record are pinned through collection, signed receipt
and ship, including canonical artifact contents. Amend/resume preserves the
binding; a new record requires a new attempt. Attempts pinned to packs older than
0.32.0 can finish without the idea field; every attempt keeps its original packRoot. Issue-only retains its existing envelope and seam.
See [snapshot assembly](references/orchestration.md#orchestrator-dispatch-command).
`orchestrator/accept.mjs ack|report|amend` validates a move plan before
connector writes, confirms report queues from fresh reconciliation sessions, and
prints `writeDigests` for the expanded writes, including certificates. Amendments
use one recovery state machine: `prepared`, `delivered` (registry-correlated
resume), then `registered`. `amendment.pending.json` records preparation and
whether launch may have started; `pins.v<n>.json` and version snapshot files are
immutable. Partial preparation artifacts reserve their version, so snapshot
staging interruptions cannot overwrite recorded bytes or block the next version.
Requests resolve omitted inputs against each saved version: one match
replays it, multiple matches refuse with candidate versions, and no match prepares
a new amendment under the current escalation rules. Registered retries return
saved results for live or exited workers, including after later amendments,
without reverting current pins or grants. Delivered retries finish registration
without another launch. Before the launch marker, a prepared retry resumes the
same version; proven nondelivery restores original grants before replacement.
A positively identified pre-spawn live-worker refusal in wait mode clears the
marker only after launch.lock verifies unchanged attempt/thread, pins version,
prior resume and wait record, restores grants and allows the prepared retry after
worker exit. Other missing correlated delivery after the marker remains uncertain:
evidence and grants are preserved, automatic restart and replacement refuse. Every amendment result
names its version (or `null` before allocation), state and reason. `amend.lock`
serializes completion; registry changes and collection admissions use `launch.lock`.
Connector queues confirm after their reconciliation session opens; the collector
confirms empty queues through the existing runtime barriers. Connector writes inherit evidence across reports only from verified whole-report confirmations in the same attempt; collection receipts remain bound to the exact report. Changed contents still fail. Workers omit confirmed writes from new queues and use a new collection identifier for every new report. `accept report` prints one response object, with retry instructions in `reread`; observation-time errors name the violated boundary.
The pack `linear-adapter.mjs` only
reads current-session observations; printing an apply instruction is never proof
of a write. See [command inputs and snapshot composition](references/orchestration.md#orchestrator-dispatch-command)
and [sessions/admissions](references/orchestration.md#delivery-write-barriers).
New bound collection admissions derive the current version from pins.file and
bind its full path/digest and effective fields; the phase report needs no version.
A stale version refusal names the full expected file. Prior admissions recover
before new-request checks; legacy admission and U14 attention keys are unchanged.
New collection admissions bind the effective dataset version as well as its path;
an omitted version denotes only the unversioned baseline (version 0).
On the short path, gates check registered pins and dataset bytes before returning `pending` (exit 2); workers publish only its `publishRequest`, and a sealed matching receipt is still required to pass.
Scripts do not write to Linear; the orchestrator uses its connector. The installed collector handles empty/collection-only queues; `.agents/`
pre-application uses `dispatch.mjs --preapply` under a recorded owner mandate, with a separate commit before start gates and artifact-owner repair before a new launch. Manifests use path/`sha256` list items with column-zero `text` fences, allowing nested item indentation and blank lines as serialized by Linear.

The orchestrator is the single Linear writer for implement/preflight/ship workers. A worker uses its dispatched snapshot as its entire Linear context and queues every required comment, state change, link and certificate in its report. Publish the whole queue with the phase capsule. Only the generated implemented-needs-preflight code comment defers waiting until the whole Preflight queue is confirmed; all other writes wait for durable confirmation. In-phase confirmation requests preserve drift-before-PR, ready-certificate-before-formal-review and In-Review-after-PR ordering. A queued write is not an applied write.

After a lost response, the orchestrator reconciles every write against its durable result and external state, then applies only missing actions. Keep stable write IDs for reconciliation; changed payloads need new IDs. Resume the same context and phase from its capsule with the complete open queue, decisions, head and writable roots. Recheck pack identity on every resume. A head change never drops pending obligations.

The orchestrator collects preflight verification and autoreview evidence outside worker sandboxes; workers only read the sealed receipt with `collect:false`. Evidence lives outside every worker-writable root. Reports are the worker mailbox; confirmations and orchestrator control state remain read-only to workers. A timeout parks the delivery with a dictionary reason. Final outcomes are `green` or `parked`, with the latter reflected visibly in Linear; intermediate readiness is never terminal delivery.

On macOS, collection verification also grants the resolved Darwin user temp root for Apple tools that write there independently of `TMPDIR`. Reject overlap with evidence, orchestrator, skills/pack and helper paths; retain the evidence denial probe. Autoreview receives no Darwin grant: its private results live under `~/.mono-agent-workflow/review-tmp`, outside verification and worker write grants, and are removed afterwards. The shared worktree remains writable to verification descendants while review reads it, as on main.

## Roles and Decisions

| Role | Responsibility and decision boundary |
| --- | --- |
| Owner | Product scope, slicing, design, acceptance of risk, package/start approval, deploy approval per policy |
| Orchestrator | One control session per product; inspect, dispatch, monitor, answer technical questions, apply/read back Linear queues for implement/preflight/ship workers, launch restricted stage agents and relay their results, and run deploy; each stage agent writes and reads back its own Linear records; never absorb code/preflight/ship |
| Delivery worker | One Issue/worktree/context; execute code, local readiness and ship in order; report evidence and queues; no Linear access, sub-workers, session management or owner questions in AFK mode |
| Second Voice | Independent pre-write package challenge on the policy-selected cross-vendor route |
| Autoreviewer | Independent code review using [role:autoreview](references/model-policy.md#roles) and risk-based effort; supply tool evidence |
| PR reviewers and CI | Evaluate the actual PR head; findings and check results become inputs to ship |

Record technical decisions as “Decided independently” in owner-facing reporting. Ask about scope, slicing, risk acceptance and design with prepared options and a recommendation; show design choices visually. Do not ask questions whose answer is already in the repository, Linear or config. The worker sends a blocked question and recommendation through its report to the orchestrator.

The orchestrator uses the owner-selected launch model and reports its authoritative identity or «не удалось определить», without a policy verdict; product overrides for this role remain refused. Second Voice selection still follows the actual orchestrator family. Resolve other role defaults from [the roles table](references/model-policy.md#roles) plus validated product `models` overrides, never helper defaults. Risk has four classes: `tiny`, `standard`, `deep`, `risky`; use the higher approved/final-diff class. Risk controls review depth and artifact needs, while a complex worker is an explicit orchestrator launch decision with a recorded reason. Preserve model/effort provenance; missing authoritative runtime data means unverified, not compliant. Policy changes govern new launches after installation, without rewriting historical records.

Mono pilots product `models` overrides in [config](.agents/mono-workflow.config.json): [role:second-voice](references/model-policy.md#roles) reviews packages and decisions (Project, PRD, Tech Spec, Issues); [role:autoreview](references/model-policy.md#roles) reviews code. Each role resolves independently from the policy table and product overrides. The pilot accepts same-model Codex worker/code-reviewer pairing. Remove `models` to roll back.

In orchestrated mode, use the configured transport or documented runtime detection. The managed Codex CLI and Claude Code transports support one resumable worker session per Issue. The registry, mailbox and append-only ledger support recovery; write only observed events with their actual recording times. Start the installed watcher as a tracked background process after every session restart, before launching or resuming workers. Observe its stdout continuously for the whole wave (`persistent: true` or equivalent); periodic wakeups require a recorded degradation. No-change wakeups, including inspected false alarms and already-consumed reports, produce no owner message or routine ledger entry; actual monitoring recovery and healing remain recorded. A silent live writer with unfinished Codex/Claude commands defers stall using a fixed 60-minute best-effort diagnostic from first watcher observation (reset on watcher restart; observation and bounded scanning can affect timing), then emits one marked stall for progress inspection. Missing writer evidence, dead workers and protocol wait deadlines retain priority. It reports each changed phase file and writes `watcher.json` every tick; launches require a fresh pulse and the same live process, refusing without spending an attempt. Refused amendments can retry when their cause is resolved; the uncertain-launch marker is written at the real spawn boundary and retained only if a process may have started. Losing the session and watcher together during running work needs supervision from the surrounding environment. Dispatch prepares the evidence directory and immutable review dataset v1 by default, preserving existing versions (including histories without v1) and explicit dataset pins; a decline still requires an approved linked decision. `control.json.halt` stops new launches/resumes without interrupting running workers; persistent attempt limits bound retries. Keep compaction wiring outside product repos and carry exact next action, pending obligations and decisions through compaction.

This repository delivers its own Issues on Codex, with `.agents/mono-workflow.config.json` set to `orchestration.transport: "codex-cli"`.
This repository names Claude Code as its backup worker; switching requires the orchestrator's decision for one of the two reasons documented in [Naming a backup worker](#naming-a-backup-worker).

`orchestration.transport: "claude-cli"` selects managed Claude Code launch/resume and the `worker-claude` role from immutable BASE; unchanged projects continue on Codex. It requires a native Anthropic route and positively confirmed subscription login, without provider keys or address overrides. Per-attempt settings bind file edits and shell writes to the approved grants, require the shell sandbox, close connectors and built-in web tools, and allow only GitHub network hosts. GitHub login is fetched outside the sandbox and passed as a real environment variable. Base-branch refresh preserves the sandbox proxy settings when the transport supplies its managed-worker hint. A private per-attempt GitHub CLI configuration directory is prepared inside the grants and reused on resume; both stored streams redact the login. GitHub CLI credential files and their resolved targets are read-denied to shell and file tools; resume retains those protections. Internal temporary paths must remain within short pinned grants; ungranted system fallbacks are denied. Startup requires the pinned session/model identity and a first successful response. Resume regenerates settings and retains the session, model and rights, refusing a live writer. Effort remains requested rather than observed. Start acknowledgement stops the worker; the orchestrator applies and reads back moves, then resumes the same session. Start handshake `wait` is refused. Phase and collection confirmations wait in the foreground under the raised Bash timeout ceiling and existing deadlines. Wait evidence binds session, attempt, current process instance and call ID; old calls cannot prove a resumed wait. The watcher uses log freshness, including command progress, and distinguishes completion without an attempt-correlated report from green/parked. Pre-PR review uses external collection on committed heads, without an in-worker pass; dispatch, launch record and ready certificate name both differences. Never print credential values: native session transcripts persist command output outside pack redaction. Live waits, expiry and collection are probed by the orchestrator at closeout.

Launch and resume derive the worktree-specific and common Git directories from the requested worktree, canonicalize them, and require the complete effective grant set to match the dispatch pin exactly. A regular checkout contributes one Git directory. Git environment overrides cannot redirect these reads or the capsule HEAD; worker environment settings remain intact. The evidence, installed skills, autoreview helper and orchestrator paths remain guarded. Missing or extra pinned roots refuse launch. Compatible pack updates allow resume under [the versioning rule](references/install.md#compatibility); incompatible updates require a new attempt. Reports retain the task's original identity, and the watcher emits `phase-rejected` with the task and reason when a phase report differs.

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
certificates, confirmations and Linear writes. Four differences are worth knowing
before choosing Claude Code:

| Difference | Codex | Claude Code |
| --- | --- | --- |
| Start confirmation | Waits in place for the orchestrator's read-back under `handshake: wait`, or exits and resumes | Always stops after writing its gate acknowledgement; the orchestrator applies and reads back the moves, then resumes the same session. `wait` is refused |
| Review before the PR | Local autoreview pass inside the worker for full and deep/risky work, plus the orchestrator's mandatory collection | The orchestrator's external collection on a committed head only: nested sandboxes cannot start, so there is no in-worker pass |
| Subscription | Its own provider subscription | Shared with the orchestrator, so an exhausted subscription stops both. A named limitation, not a defect |
| Codex on the machine | Required | Still required: review collection runs in the Codex sandbox |

Phase and collection confirmations still wait in place on both workers, and a missing
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
   lifecycle move and resumes the same session, each phase waits in the foreground for
   its confirmation, and the single review before the PR is an external collection on
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

### Naming a backup worker

An owner can also set `orchestration.backupTransport` to `codex-cli` or
`claude-cli`. It must differ from the primary, and the primary must be one of
those two managed CLI workers. For example:

```json
{ "orchestration": { "transport": "codex-cli", "backupTransport": "claude-cli" } }
```

This is a standing mandate for the orchestrator to open one new attempt when
the primary's subscription is exhausted (`subscription-exhausted`), or its
provider explicitly and persistently refuses after recovery on that same worker
(`provider-refusal-after-recovery`). The orchestrator chooses the reason and
supplies a verbatim excerpt from the previous attempt's output. Task failure,
stopped gates, unexplained silence, installation problems and config errors do
not qualify; there is no automatic failure classifier.

The orchestrator first reconciles outstanding writes and unfinished work,
uses the installed `backup-switch.mjs stop` command before retiring the old writer.
It freezes process creation, retains the tree (including separate process groups),
then force-stops it without resuming it. The orchestrator proves exit and retires
the registry entry. Captures remain across resumes; missing or incomplete stop
evidence refuses switching. It then uses the
ordinary dispatch command with `--backup-switch <absolute-decision-file>`.
The previous launch retains its host PID/start-time snapshot; missing proof still
refuses switching, and the snapshot must never be erased or broadened. A live
process blocks switching only when it retains a trace of that attempt: a captured
process group, a parent chain reaching a captured process, a matching
`MONO_ATTEMPT` marker, or an exact reference to that attempt's worktree or artifact.
Path references are literal matches with a trailing path boundary; longer sibling
paths do not match. References inside inline comments or script text may block
conservatively, without interpreting that language.
Verified control-caller processes are excluded. Unrelated host processes and
collectors for other tasks, even under the same product root, do not block; the
previous attempt's collector and active checks are checked separately.
If marker reading is unavailable and no other trace exists, a marked attempt
allows switching and records the count in the launch record for reconciliation.
An uncaptured orphan outside the captured groups, with a cleared environment and
neutral command, may go undetected; this is the accepted residual risk.
If the writer already exited, the command records its stopped state only after
the same process and ownership checks; it sends no signals.
The backup must have been named on the old attempt's base and remain the same
on the new base; the reviewer route stays unchanged. A dirty unresolved copy,
live old worker or descendant, exhausted attempt limit, or previous switch
refuses the launch. Preserved work is reconciled into a clean tree before the
ordinary start gate; rights, gates and attempt limits are never weakened.

Backup Codex uses `worker-default` unless the orchestrator records a reason for
`worker-complex`; backup Claude Code uses `worker-claude` and stop/resume startup.
The normal producer/reviewer pairing check applies. The new attempt pins carry
the switch and SHA-256 of its evidence. The ledger and attempt output retain the
reason, evidence path/digest, previous/new workers and attempt numbers; the
orchestrator writes and reads back the same facts in an Issue comment. One switch
per Issue, with no automatic return; a stopped backup can resume its own session.

The complete decision-file format and recovery procedure are in
[Backup worker switch](references/orchestration.md#backup-worker-switch).
At closeout the orchestrator practices the path in a one-off root on a real
attempt with a marked training reason. That proves switching, while a real
subscription-exhaustion response remains a separate observation.

For config rollback, remove `backupTransport` before choosing the other primary
or installing a pack that predates the setting. Existing attempts keep their
pins; a config edit cannot authorize a switch retroactively.

## Cost

A wave's cost is telemetry, not a gate. Wait mode avoids an exit/resume cycle; short may use zero local passes plus one certifying collection and one combined start/ready comment. These are mechanisms, not a measured savings claim; worker reading inputs and corpus bytes must not grow. Read the **Cost** line in deploy closeout and the **Wave Cost** line in orchestrator status; project updates carry only a short product-level conclusion. The installed `wave-cost.mjs` calculates the figures from reports, logs and ledger:

- Dispatch-to-green-PR and dispatch-to-merge elapsed time, independently selected from the `mono-deliver` report's top-level fields first, legacy `mono-ship` reports next, then ledger events. A green PR and a recorded merge are separate events: merge time never comes from delivery completion.
- Review rounds from `mono-deliver.review_rounds` (including zero), falling back to legacy `mono-ship` forms. Invalid or missing values fall through; source fields identify the selected report or event. Only `green_at` proves green in a delivery report; legacy ship completion/report timestamps remain supported.
- All measurable token use across worker turns and attempts (`turn.completed` for Codex, `result.usage` for Claude Code; cache creation and reads are included in normalized input), including parked and failed attempts, plus autoreviewer and orchestrator use where available; worker use is a diagnostic subtotal.
- Review accounting from `<evidenceRoot>/reviews/<KEY>.json` when present: collection requests (including withheld requests), helper invocations by recorded cause, announced and validated internal passes, and reviewer tokens by engine/provider with measured coverage. A withheld request executes no helper. Without a review ledger, the legacy log scan and cost line are unchanged. Final reports are selected by stage and Issue; retired registry entries and intermediate phase reports are excluded.
- Actual pack bytes read, review rounds, model and effort.
- Explicit unavailable components with reasons; never estimates presented as measurements.

Build a review ledger with `review-ledger.mjs build --issue <KEY> --root <orchestrator-root> --evidence-root <evidenceRoot>`; `print` reads the same sources without writing. Use `--out <scratch-directory>` to save a reviewable copy, and `wave-cost.mjs --ledger <copy.json>` to price that copy. Ambiguous source links appear in `unresolvedCoverage`, without guessed merges or duplicate calls. Causes remain `unknown` without evidence; self-check requires observed content identity. `adjudicate --issue <KEY> --evidence-root <evidenceRoot> --record <json-file>` records an orchestrator's origin, evidence, decision links and progress without inferring classifications from filenames. Repeating an `eventId` replaces that event's adjudication in place; the latest record wins and other records keep their order.

### Reviewer comparison bench

The experimental comparison tooling has been retired. Production reviewer selection follows the [model policy](references/model-policy.md#roles).

### Evidence-backed review declines

The preflight and ship gates accept a completed findings receipt only when every
exact finding has one unchanged, unrevoked orchestrator-approved `decline` for
that receipt, head and dataset version. `refutation` carries command/output or
an unreachable-path citation with its digest; `boundary` references an earlier
current approved `d-NNN` with matching scope and content. P0/P1 and dangerous
consequences require refutation. Rejected/missing findings, filtered P0–P2,
incomplete results and failed verification still block. Clean receipts retain
their existing rules; findings and signed receipts are never rewritten.

Workers review committed bytes with `--mode branch --base <base>`, then fix or
propose declines in their phase reports. Only the orchestrator writes `decline`
and `decline-revoke` outside worker grants, following
[approval and revocation](references/orchestration.md#review-decline-approval).
The ready certificate lists finding identity, basis and approver in
`Autoreview declines:`; the review ledger counts `decline` separately from review
executions. Standalone requests without pins must supply `issue` when collecting a receipt
for declines; it is signed with the receipt. Pinned attempts derive the Issue
from their verified manifest. New evidence revokes admission at the same head;
new heads need new receipts. Dataset versions retain only short active decline context, leaving
the receipt's archived dataset intact.

### Review decision pilot

The approved pilot adds an append-only decision journal and optional phase-report
proposals without changing gates or certificates. The orchestrator owns the
journal, dataset versions, materialization and collection decision; workers
propose evidence-backed dispositions, behaviour matrices and five checkpoint
answers. The [pilot protocol](references/orchestration.md#review-decision-pilot)
defines the fields and the [dispatch block](templates/orchestrator-dispatch.md)
repeats the relevant stage rules only for approved pilot Issues.

Installed `decisions.mjs record|list|render` uses `--issue KEY --evidence-root DIR`;
`record --record FILE` accepts `decision`, `matrix` or `verification` entries.
IDs cannot be overwritten. Revisions append a `supersedes` link, and deterministic
rendering includes only current entries. A matrix waiver is a `verification`
entry whose `waiver` names the decision's `findingKey` and gives a reason;
`forId` must reference that decision. `review-ledger.mjs decide` reports current
waivers in `waivedFindingKeys` instead of `matrixFindingKeys`; superseding the
referenced decision makes its waiver inactive. `version --source DATASET` publishes
`datasets/<KEY>-review-scope.v<N>.md` plus `.sha256` only when bytes change, reusing
identical archived content. An interrupted archive/digest publication is recovered
under the shared archive lock only when the retry has identical bytes; changed
inputs cannot supply a missing digest for an older archive. `materialize --version N --worktree DIR --digest SHA256`
returns a verified plain `.orchestrator/review-dataset-<d8>.md`, requires Git
exclusion and refuses indexed paths. Local reviews receive that pinned path via
`--dataset` and retain usage with `--stream-engine-output`; remove each copy at
attempt end using the same materialize pins plus `--remove true`.

`review-ledger.mjs decide --issue KEY --evidence-root DIR --attempt N` reads
adjudicated decision links and progress to suggest a matrix or checkpoint; it
never infers a finding key or grants readiness. Missing required evidence leads
the orchestrator to `withhold --record FILE` with attempt, collectionId, reason
and recordedBy, then rebuild the ledger. This records demand without executing
collection. Dispatch/dataset bytes are measured separately as pilot overhead;
the worker reading corpus stays unchanged.

Collections retain validation and usage lines in bounded streaming output before signing. Reviewer input, cache reads, cache writes and output stay separate: Claude input excludes both cache counters, whereas Codex input includes cached input and has no cache-write counter. Raw samples remain available; missing usage is null with a reason. Collection datasets are archived as immutable `<KEY>-review-scope.v<N>.md` files with `.sha256` sidecars, and receipts bind version and digest. Old receipts remain valid without usage or archive metadata; those inputs remain unavailable for reproduction.

Sum non-overlapping per-turn usage across every attempt. Cached input is part of input, not another amount to add. An attempt without usage records is unavailable; an unfinished turn makes the attempt incomplete. A wave containing either has an incomplete total. Known completed-turn usage remains a partial subtotal, and absent attempt usage is null, never a measured zero. The static worker reading budget is a separate measure: one union of mandatory, conditional and nested readings, shared files counted once, bounded at **99,882 bytes** with bytes/4 shown as an approximation. README is outside the worker reading list. Explanatory rationale stays outside that list and adds no gates.

```bash
node '<pack-root>/scripts/wave-cost.mjs' <ISSUE-KEY>
node scripts/read-budget.mjs
```

See [Cost Telemetry](references/orchestration.md#cost-telemetry) for inputs and unavailable-data handling. Compare improvements only against a recorded baseline and protocol; report insufficient evidence plainly.

The orchestrator starts the installed `collector.mjs start --root DIR --issue KEY
--attempt N` once per delivery attempt, uses `status` and the report log to inspect
it, and stops it at attempt end. Empty and collection-only queues confirm
automatically; connector writes still require fresh orchestrator read-backs.
Admission refusals write one attention file and log line per report digest and
current registry pins version; polling resumes admission when either changes,
and admission of the current preflight collection clears the attempt's file.
Signed history restores interrupted head receipts without a second review,
including failed collections. Incarnation/group checks refuse live or unverified
locks. Process-table probes run in a separate group so completed collection and
reconciliation gates clear their watchdog without mistaking the probe for a child.
This removes manual confirmation work; measured time/token savings still
require comparable completed waves under the cost protocol.

## Plugin Installation

### Users without an orchestrator

Use this setup on a user machine where no Mono orchestrator runs tasks. Both
tools track the GitHub marketplace's main branch:

```bash
claude plugin marketplace add darkdepot/mono
claude plugin install mono@mono-marketplace
codex plugin marketplace add darkdepot/mono
codex plugin add mono@mono-marketplace
```

In Claude Code, enable automatic updates for `mono-marketplace` through
`/plugin` → Marketplaces, or set `"autoUpdate": true` on that marketplace in
`extraKnownMarketplaces`. Alternatively, update the marketplace and plugin
manually:

```bash
claude plugin marketplace update mono-marketplace
claude plugin update mono@mono-marketplace
```

In Codex, update the marketplace snapshot, then install the plugin from it:

```bash
codex plugin marketplace upgrade mono-marketplace
codex plugin add mono@mono-marketplace
```

If your Codex marketplace was registered with `--ref v<VERSION>`, `upgrade`
keeps it on that tag. Move it to main once, then use the two update commands
above for future updates:

```bash
codex plugin marketplace remove mono-marketplace
codex plugin marketplace add darkdepot/mono
codex plugin add mono@mono-marketplace
```

Restart sessions after installation or an update so they load the installed
skills. Follow the [GitHub release pages](https://github.com/darkdepot/mono/releases)
for news about versions. A release page announces a release, but an update from
main does **not** guarantee that the installed files match that release's tag:
main may contain merged changes that have not yet been released.

On a machine where an orchestrator runs tasks, use the procedure below instead:
disable automatic updates, pin Codex to a release tag, check the update condition
and compare the installed cache with the released Git tree.

### Machines running an orchestrator

Register [darkdepot/mono](https://github.com/darkdepot/mono) as the GitHub marketplace;
no repository clone is needed to install. Replace `<VERSION>` below with the
released `VERSION` whose tag points to the verified landing tip T. Claude Code
uses the repository's main branch; Codex pins the marketplace to that version tag.
Follow
[source verification and update conditions](references/install.md#plugin-updates)
for each installation. For machines moving to plugins, follow
[the migration procedure](#migrate-from-the-local-installer).

```bash
claude plugin marketplace add darkdepot/mono
claude plugin install mono@mono-marketplace
codex plugin marketplace add darkdepot/mono --ref v<VERSION>
codex plugin add mono@mono-marketplace
```

Do not register a local folder as the marketplace: Claude Code reads such a
plugin in place without pinning its version, and both tools copy the entire
local folder, including unrelated files.
Immediately after each installation or update:

Compare each tool's version cache with T's Git tree: paths, types, executable
modes, content object hashes and symlink targets must match. Only extra service
objects at these exact paths relative to the version-folder root are allowed:
Codex directory `.git/` and regular file `.codex-marketplace-install.json`;
Claude Code directory `.in_use/`. These tool-specific exceptions never exclude
released files from comparison. The Codex file must be valid JSON with `revision`
equal to the full tag commit; invalid JSON, absent/different revision or another
object type fails. Every other extra, missing or changed object fails. Do not
substitute clone proof.
If either comparison differs, do not close the wave, release launch halts or
start tasks from the new installation. The installing orchestrator records
the mismatch, corrects the source and repeats the full verification of both tools.
Only the installing orchestrator registers or updates the shared marketplaces.

Restart sessions after installation. The external `autoreview` helper remains a
separate prerequisite in your tool's skills directory; its [pinned upstream source, installation and output-contract proof](references/install.md#external-autoreview-helper) are documented separately. Model/effort come from pack policy, with `--max-priority P2`. Pass the external directory as
`--skills-root` when dispatching. The plugin contains one copy of shared files:
`skills/`, `references/`, `templates/` and `scripts/` have the repository layout.
In Claude Code, invoke skills as `/mono:idea`, `/mono:handoff`, and so on; in Codex, run `/skills` and select the corresponding Mono skill.

Do not enable automatic updates for Mono on a machine running an orchestrator.
Update deliberately after a release.
Before any install/update that replaces a plugin folder, have each affected
product orchestrator pause new dispatch. Keep dispatch paused through the check
and replacement. Check the folder against attempts of every product, including
paused attempts:

```bash
node /path/to/current/mono/scripts/verify-pack-state.mjs before-update --folder /path/to/replaced/mono
```

A refusal names the product, Issue and attempt; wait for those attempts to finish
and become landed and stopped. Do not remove their records to bypass the check.
This check reads registries only. Entries without a pack root are listed as
unknown and do not block the update.
A new sibling folder does not replace the old folder. Attempts retain their
original absolute `packRoot`; compatible newer scripts can resume them while that folder exists.
If a task outlives the tool's retention of its version and the folder is gone,
start a new attempt. Worker sandboxes protect both the pack
folder and the external helper directory.

For isolated installation verification, set `CLAUDE_CONFIG_DIR` to an empty
temporary directory for Claude, and use a separate empty Codex home through
`CODEX_HOME`, then run the same GitHub marketplace/install commands and cache-tree
comparison. Locate the installed
folder using `claude plugin list --json` or the JSON output captured during
Codex installation (`codex plugin add --json mono@mono-marketplace`), and run:

```bash
node /path/to/installed/mono/scripts/verify-pack-state.mjs version
```

To try the checkout without installing, launch Claude from the repository with
`claude --plugin-dir "$PWD"`. Launch `codex --cd "$PWD"` and open
`skills/<skill>/SKILL.md` directly; shared files resolve from that repository.
These sessions do not change the installed pack.
See [Claude's manifest reference](https://code.claude.com/docs/en/plugins-reference)
and [OpenAI's package documentation](https://developers.openai.com/plugins/build/plugins).

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

   Preserve other skills, including the external `autoreview` helper, and all
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

## Project Config

Optional `orchestration.preapply.mandate` names the owner comment URL; absent/empty means no pre-application mandate.


Product repositories keep only `.agents/mono-workflow.config.json` for Mono. Do not vendor skill bodies, wrappers, locks, local workflow checkers, hooks or updater CI there.

```bash
node scripts/project-config.mjs --repo /path/to/product --project-name Product --write --clean
node scripts/project-config.mjs --repo /path/to/product --check
```

Configure product/team names, Linear/repository languages, narrow artifact roots, ship, documentation, review-feedback and deploy workflows, and the required `autoreviewHelper` prerequisite. `workflows.implementation` remains valid for existing configs but is no longer read by mono:implement; no external implementation engine or learnings helper is needed. Optional workflows may be `null`; a missing deploy workflow blocks deployment. Optional QA/authentication policy defines how live verification accesses the product; owner-session access requires permission. `--clean` removes legacy generated Mono and previous-brand workflow files while migrating project policy.

Optional `models.roles` overrides model routes within the [role/transport matrix](references/model-policy.md#product-overrides).
Autoreview accepts claude, kimi, pi or codex with `effortByRisk` for all five risk keys.
Worker Codex roles stay on Codex, worker Claude stays on Claude; Second Voice stays
cross-vendor and the orchestrator is not overridable. The CLI worker launcher
supports Codex workers and managed Claude Code workers selected by `orchestration.transport`. Native authentication uses null endpoint
and credentialEnv; external credentials are environment variable **names**, never
values. Pi supports native xai/google/minimax with a null endpoint, or OpenAI-compatible
routing via `OPENAI_BASE_URL`; unsupported endpoint mappings are refused.
Helpers that authenticate from the environment must declare `provider.credentialEnv` on `autoreview`; under the field-for-field rule, this is a pair change requiring a bound `pairingAccepted` record.

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

Set `deployApproval` to `always` (default), `risky-only` (approval for standard/deep/risky and unknown risk; only tiny proceeds without asking), or `never`. Approval binds the exact PR/head. Configure `orchestration.transport` and `maxParallelWorkers` (default 3) when needed. Delivery settings default to a 900-second confirmation timeout, 120-second quiet interval, 2,400-second evidence limit, 10-second polling and three attempts. This pack keeps its own issue-only lane disabled and stores no owner ID in the repository; consumers enable the lane explicitly with `issueOnlyLane.enabled` and the canonical approving `ownerPrincipal`. Plugin compatibility and helper policy: [guide](references/install.md).

The optional `workflows."qa"` setting selects live-sweep browser automation;
absent or null uses the available runtime tool. `qaAuth` accepts `cookie-import`,
`test-account` or `owner-session`; the latter requires explicit owner involvement.
Absent authentication covers unauthenticated surfaces only. Keep all product
config fields in the Project Config section above.

## Landing

The advisory `landing-plan.mjs` observer reports textual intersections among active
committed branches and the fetched landing tip, without affecting gates. The
owner status includes «Посадка». Handoff chains Issues that must edit the same file;
the orchestrator consults the observer before expanding a wave. `head` records PR
head observations; `harvest` records force-push events and their observable check
durations once. Only those events count refreshes. A waiting-queue decision needs
at least 30 landings and sibling-refresh cost exceeding estimated waiting;
unknown history remains unknown. See [scheduling and accounting](references/landing.md#scheduling).

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
the orchestrator records each merged task and updates the plugin once after the
release task and after every registered worker is stopped and landed.
Verification under halt fixes the batch, checks
GitHub's installation tip and every merge's ancestry; close after installation
read-back preserves per-task delivery proof. Failed installation retains pending
tasks for correction. Installed versions in both tools must equal `VERSION` at
the landing tip, and its version tag must point to that tip. See
[install and recovery](references/landing.md#install) and
[one-time migration](#migrate-from-the-local-installer).

## Owner Rules

The following 34 numbered entries are the sole owner-rule index, transferred from the former constitution. Each line states the obligation, its reason and the executable source; it is not a second full copy of the source text. Rule numbers preserve traceability. Link validation proves that a file and section are addressable; pack checks and same-PR README freshness preserve truth. Change rules through a Linear Issue and the orchestrator.

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
- **K-11.** Complete a Project only through the shipment of its last open Issue and begin its final update with the configured “Project completed” prefix, so the feed has a delivered conclusion — [Deploy](references/lifecycle.md#deploy) and [Invariants, item 13](templates/project-update.md#invariants).
- **K-12.** Name the theme Project in an issue-only Issue and send its shipment update there, so a projectless result still has a visible home — [Theme project](references/issue-only-lane.md#theme-project).
- **K-13.** Assign new agent-created Project leads and Issue assignees to the acting owner while preserving existing assignments, so created work reaches the owner's lists — [Linear Artifact Rules](references/artifact-rules.md#linear-artifact-rules).
- **K-14.** Treat project updates as informational closeout results whose absence or failure cannot block delivery or change its verdict, so reporting cannot stop shipment — [Skill Design Rules](AGENTS.md#skill-design-rules).
- **K-15.** Turn a raw idea into a Project with a read-back owner approval record and a verified move to Discovery, before PRD, Tech Spec, Issues or code — [Idea exit](references/lifecycle.md#idea).
- **K-16.** Review the package record and Issue slicing before the first write and bring the owner one summary with «Начать работу», so one decision does not become a stream of questions — [Pre-write package review](references/orchestration.md#pre-write-package-review).
- **K-17.** Have an independent cross-vendor Second Voice review the package draft before its first Linear write, so author and reviewer do not share the same blind spots — [Second Voice](references/orchestration.md#second-voice).
- **K-18.** Decide repository-, Linear- and config-derived implementation details, document structure and risk classification autonomously, but ask about scope, slicing, risk acceptance and design, so routine questions do not consume owner time or seize owner authority — [Autonomy Defaults](references/questioning.md#autonomy-defaults).
- **K-19.** Apply the project's deploy-approval policy (always, all except tiny, or never) to the exact code head, so yesterday's approval cannot authorize different code — [Project Config](README.md#project-config).
- **K-20.** Grant issue-only delivery only when all nine conditions hold and the owner approves the exact Issue fingerprint, falling back to Project-first on doubt, so the shortcut cannot bypass its boundary — [Nine eligibility conditions](skills/issue/SKILL.md#when-issue-only-is-granted--the-nine-eligibility-conditions) and [Trust boundary](references/issue-only-lane.md#trust-boundary).
- **K-21.** Invalidate approval whenever an approved issue-only body changes and obtain new review and fingerprint approval, so the approved text remains the executed contract — [Renewal recovery](skills/issue/SKILL.md#renewal-recovery).
- **K-22.** Run code autoreview at every risk class using the policy's autoreview model and class-routed effort from low through the highest escalated route, so the reviewer has the capability and depth to challenge the author — [Roles](references/model-policy.md#roles) and [Canonical Routes](references/autoreview-routing.md#canonical-routes).
- **K-23.** Classify work as tiny, standard, deep or risky to set artifact requirements and review depth, treating money, data, access, production and public interfaces as risky domains, so dangerous work cannot pass through a light process — [Risk Classification](references/readiness-gates.md#risk-classification).
- **K-24.** Require package review before writing and formal pre-ship review for standard, deep and risky work, permitting only a recorded tiny advisory exception, so review can challenge decisions before they become accepted artifacts — [Review Gate Policy](references/readiness-gates.md#review-gate-policy).
- **K-25.** Close an Issue only after merge, delivery and verification, except under an explicitly accepted merge-as-delivery policy, so closed work cannot silently fail to reach users — [Deploy](references/lifecycle.md#deploy).
- **K-26.** Verify user-facing changes live against Issue acceptance after deployment and file defects as immediate out-of-queue hotfixes, while still requiring the original Issue's own green live pass for closure, so automated checks cannot substitute for the user experience — [Deploy](references/lifecycle.md#deploy).
- **K-27.** Include a compact checked/not-checked boundary in every stage result and call uninspected work unverified, so the owner cannot infer unsupported confidence — [Checked / Not Checked](references/human-friendly-output.md#checked--not-checked).
- **K-28.** Report a stop with completed work, the exact blocking point, unperformed work and the smallest unblock action, so unfinished work cannot be mistaken for ready — [Blocked / Timed-Out Shape](references/human-friendly-output.md#blocked--timed-out-shape).
- **K-29.** Append only observed facts with actual recording times to the ledger and append corrections instead of rewriting history, so invented history cannot conceal delays — [Mailbox And Ledger](references/orchestration.md#mailbox-and-ledger).
- **K-30.** Let only the orchestrator write Linear for implement, preflight and ship workers, which queue writes or questions with recommendations in reports; pre-delivery stage agents write and read back their own records, so each artifact has one writer — [Orchestration Mode Precedence](references/worker-contract.md#orchestration-mode-precedence).
- **K-31.** Start every pack change with a Linear Issue before the first edit, so no shortcut evades review and verification — [Change Discipline](AGENTS.md#change-discipline).
- **K-32.** Update affected checks with behavior changes using structure and named behavior fixtures, keep prose free of pins and agent-only rules free of a second machine encoding, and preserve the four bounded contracts and fingerprints unless explicitly changed, so editorial rewrites stay green while protected invariants remain checked — [Fixture Coupling](AGENTS.md#fixture-coupling).
- **K-33.** Write Linear artifacts, comments, templates and examples in the configured project language (Russian here), the stages listed in `scripts/russian-stages.mjs` and `references/owner-dialog.md` in Russian, and other skills in English, so the owner can read the artifacts and models can execute the pack consistently — [Language](AGENTS.md#language).
- **K-34.** Route pack rule changes through a Linear Issue and the orchestrator, updating affected README sections in the same PR, so owner intent and the shipped description stay synchronized — [Change Discipline](AGENTS.md#change-discipline).

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
Только комментарий завершённой разработки идёт без ожидания: подтверждается всей
очередью Preflight до формального ревью; остановленный отчёт ждёт в своей очереди.
Новая версия заменяет комментарий и помечает прежний устаревшим. После обрыва
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
this pack uses `/mono:ship` and `/mono:review`.

| Skill | Use it for |
| --- | --- |
| [mono:idea](skills/idea/SKILL.md) | Idea intake and recorded owner approval; Research starts by owner or delegated orchestrator |
| [mono:research](skills/research/SKILL.md) | Facts before a solution, Research document and next-step advice without owner questions |
| [mono:discovery](skills/discovery/SKILL.md) | Solution found with the owner in conversation, explicit choice and version-approved PRD; same stage for owner or delegated orchestrator |
| [mono:design](skills/design/SKILL.md) | Designer stage after PRD routing, consented taste memory and immutable Paper/PNG approval; orchestrator chooses with reasons |
| [mono:tech-evaluation](skills/tech-evaluation/SKILL.md) | One checked technical solution, one version-approved plain-language page, then a short Tech Spec; same stage for owner or delegated orchestrator |
| [mono:issue](skills/issue/SKILL.md) | Eligible issue-only create-then-approve intake and body renewal |
| [mono:handoff](skills/handoff/SKILL.md) | Team lead: reconciles approved inputs, slices (one Issue by default), one reviewed package record, Ready; work starts by owner or delegated orchestrator; repair by the record |
| [mono:review](skills/review/SKILL.md) | Report-only quality/risk review |
| [mono:check](skills/check/SKILL.md) | Readiness-only transition assessment |
| [mono:deliver](skills/deliver/SKILL.md) | One delivery context sequencing its three phase owners |
| [mono:implement](skills/implement/SKILL.md) | Свой инженерный этап: старт, код и доказательства каждого критерия; один отчёт для Preflight |
| [mono:preflight](skills/preflight/SKILL.md) | Local verification, independent autoreview, commit and ready certificate |
| [mono:ship](skills/ship/SKILL.md) | Accepted pre-ship drift, PR, docs, feedback and green certificate |
| [mono:deploy](skills/deploy/SKILL.md) | Merge/deploy delegation, verification, closeout and learnings |
| [mono:orchestrate](skills/orchestrate/SKILL.md) | Product control plane: dispatch, monitoring, decisions and Linear writes |

## Documentation Map

| Need | Source |
| --- | --- |
| Artifact contracts and stable rule IDs | [Contract index](references/artifact-contracts.md), [Project](references/contracts/project.md), [PRD](references/contracts/prd.md), [Tech Spec](references/contracts/tech-spec.md), [Issue](references/contracts/issue.md); retired IDs are not reused |
| Scoped discovery intake and source precedence | [Artifact intake](references/artifact-intake.md); supplied paths, current Linear package and scoped context take precedence over stale scratch evidence; name missing/conflicting inputs |
| Artifact form and execution quality | [Artifact rules](references/artifact-rules.md), [quality bar](references/artifact-quality.md), [execution quality](references/execution-quality.md), [repair](references/repair-machine.md) |
| Risk, review and phase boundaries | [Readiness gates](references/readiness-gates.md), [review rubric](references/review-rubric.md), [lifecycle](references/lifecycle.md), [ship feedback loop](references/ship-feedback-loop.md) |
| Decisions and owner-facing wording | [Questioning](references/questioning.md), [human output](references/human-friendly-output.md), [decision/status/wave brief](templates/orchestrator-brief.md) |
| Runtime and worker recovery | [Orchestration](references/orchestration.md), [worker contract](references/worker-contract.md), [dispatch](templates/orchestrator-dispatch.md), [report](templates/orchestrator-report.md), [compaction](templates/compact-instructions.md) |
| Linear artifact templates | [Project](templates/project.md), [PRD](templates/prd.md), [Tech Spec](templates/tech-spec.md), [Issue](templates/issue.md), [project updates](templates/project-update.md); templates define form, contracts define obligations |
| Review, check and delivery output | [Review](templates/review-output.md), [check](templates/check-output.md), [ship](templates/ship-output.md), [interactive ship status](templates/ship-status-ux.md), [deploy](templates/deploy-output.md); examples are placeholders, not evidence |
| Installation and policy | [Install](references/install.md), [versioning](references/install.md), [models](references/model-policy.md), [autoreview routing](references/autoreview-routing.md) |
| Rationale outside worker reading | [Audience](references/rationale/audience.md), [review](references/rationale/review.md), [output](references/rationale/output.md), [delivery](references/rationale/delivery.md); explanation adds no obligations |
| Worked examples and history | [Consumer dogfood](examples/consumer-dogfood.md), [profile regression](examples/profile-workbench-regression.md), [CHANGELOG](CHANGELOG.md) |

Runtime scripts live in [scripts/](scripts/): `gate.mjs` checks evidence; `delivery-state.mjs` publishes/confirms queues; `runtime.mjs` provides role resolution, config validation, durable writes, locks and hashes; `orchestrator/spawn.mjs`, `resume.mjs` and `consume-gate-ack.mjs` use the shared launch implementation; `watch-workers.mjs` monitors registered work; `resolve-issue-context.mjs` resolves the issue-only seam; `verify-pack-state.mjs` verifies identity/quiescence; `decisions.mjs` records decisions and versions/materializes datasets; `review-ledger.mjs` builds and summarizes review-event ledgers and supplies adjudication hints; `wave-cost.mjs` measures cost; `read-budget.mjs` bounds reading. Invoke runtime scripts from the installed pack, with `--help` and pinned dispatch inputs. Install and update through the [GitHub marketplace](references/install.md#plugin-updates); maintain product config with `project-config.mjs` from the upstream checkout.

## Principles

Keep skills as routes and artifact-scoped owners, wrappers as sequencing, and references/templates as progressive reading. A module should carry meaningful complexity behind a real interface; deep/risky changes require evidence at system seams. Trace actor → capability → benefit, and prove one behavior before expanding implementation. Record real external-system responses rather than inventing contracts.

Keep gates and responsibilities intact in both interactive and orchestrated delivery. Review supplies findings and the next owner; check supplies readiness; accepted fixes go through handoff, issue renewal, ship drift or explicit artifact owners. Never silently synchronize drift or promote stale approval. Read only relevant, bounded sources, name stale/unavailable/conflicting inputs, and preserve the confidence boundary.

Treat Markdown as agent instructions. Protect executable behavior with fixtures, artifact contracts with their bounded fingerprints and consumer checks, and document shape with skeleton checks. Do not encode agent-only rules twice or pin sentences. Every pack change begins with a Linear Issue; README freshness is mandatory even when the optional documentation workflow is unavailable.

## Validation

Run before completing a change:

```bash
node scripts/verify.mjs
```

The entry point includes `git diff --check`, syntax checks, artifact/workflow checks and isolated plugin runtime fixtures.
Scratch validation copies include the scout-hook template. Runtime fixture files run sequentially to isolate their deadline assertions from concurrent process startup. CI runs it on PRs and pushes to main. Required README sections and all 34 rule links are checked structurally; a renamed target section fails with the rule number. Tests also remove required README sections and exercise model-policy detection on README. Passing link checks establishes addressability, not semantic truth.

Use focused checks while editing:

```bash
node scripts/validate-workflow.mjs --readme-only
node scripts/validate-workflow.mjs --model-policy-fixtures
node scripts/read-budget.mjs
node scripts/validate-plugin.mjs
claude plugin validate . --strict
node scripts/lint-mono-artifacts.mjs
node --test scripts/route-gate.test.mjs scripts/design-gate.test.mjs scripts/tech-gate.test.mjs
```

Runtime tests use scratch plugin folders; the real sandbox-boundary test runs outside a worker sandbox and reports an explicit skip when nested sandboxing prevents it. Installation, live production QA, deploy and owner acceptance are separate evidence boundaries, never implied by a local green check.
