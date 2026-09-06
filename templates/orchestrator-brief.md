# Шаблоны оркестратора: бриф и статус

User-facing shapes for `mono-orchestrate`. User-visible text is Russian per
project config (`languages.linear`).

## Бриф решения (Decision Brief)

```text
Нужно твоё решение: <о чём, простыми словами продукта> — <тип: scope | дизайн | риск | deploy> (<ISSUE-KEY или пакет>)

Что решаем: <одно предложение в терминах продукта, не реализации>
Почему сейчас: <что именно блокируется этим решением>
Что уже доказано: <тесты, autoreview, CI, сертификаты — что применимо>
Рекомендация: <вариант> — <одна строка почему>

Варианты:
1. <вариант A> — <что изменится для тебя и продукта> — рекомендую, <одна причина>
2. <вариант B> — <что изменится для тебя и продукта>
3. <свой ответ>
```

Package-approval briefs: include an option that explicitly bundles
implementation start («это одновременно approval на старт кода») so the
bundled-approval rule from `mono-implement` applies and the orchestrator
does not re-ask before dispatching workers.

Design questions: prepare side-by-side variants first (`/design-html` when the
runtime provides it), open them, then ask. Never decide visual questions
silently and never ask them text-only when the difference is visual.

## UX-чекпоинт (UX Checkpoint Brief)

```text
UX-чекпоинт: <проект> — прототип готов к твоему фидбэку

Что смотрим: <ссылка/файл прототипа — near-production, уже прошёл внутренний design review>
Контекст: <одно предложение — какую часть продукта это меняет>
Решил сам: <ключевые product/UX-решения внутри прототипа, по строке с причиной>

Нужно твоё решение:
1. <контестный UX-вопрос: вариант A — рекомендую, почему / вариант B>
2. <…или «только общий фидбэк по прототипу»>
```

The prototype must be near-production before the checkpoint: realistic
product content, correct states, side-by-side variants where a genuine choice
exists (`/design-html` when the runtime provides it), and an internal
design-review pass already applied. Never bring a first draft.

## Целостность брифа (Brief Integrity)

These rules bind every Decision Brief and UX checkpoint that offers
numbered or lettered options — with or without a board or prototype
(a plain package-approval brief included). Wave-1 precedent: a
brief numbered 7 questions against a 5-section board; the owner's
«2) B» decoded to one option under brief numbering and to a different
one under board numbering — a possibly inverted product decision — and
the contested question was then closed by silence after a fallback line.

- Board-aligned IDs: question IDs mirror board section IDs exactly.
  Multiple questions inside one section get section-scoped suffixes
  (1a, 1b). Cross-section renumbering is forbidden: a question with no
  board section gets its own explicitly labeled block, never a number
  shifted from another section.
- Self-identifying tokens: every option carries a token rendered on
  both the board and the brief, e.g. «1a-КАРТОЧКА / 1a-МОДАЛКА». An
  answer is valid without its number when the token or the verbatim
  option text identifies it.
- Echo-back: before acting on the answers, post a mapping table
  «вопрос → выбранный вариант (дословно)». An answer whose text does
  not match the addressed question's option set is a numbering fault —
  a mandatory one-line re-confirm precedes any work on that item.
- No closure by silence: an item routed to a checkpoint as contested is
  never closed by silence — no answer means asked again, not resolved.
  A fallback line («если не ответишь — делаю X») does not resolve a
  contested item.
- Post-approval delta: any spec change after a package approval that
  alters user-visible behavior appears as an explicit
  «Изменилось после твоего одобрения:» delta list at the next owner
  touch — never only as a fait-accompli status line. When in doubt
  whether a change is user-visible, include it in the delta.

Echo-back shape (posted before acting on the answers):

```text
Сверка ответов — вопрос → выбранный вариант (дословно):
- 1a: «<текст выбранного варианта>»
- 2: «<текст выбранного варианта>»
Если где-то не то — поправь одной строкой; спорные пункты в работу не беру до подтверждения.
```

Post-approval delta shape (at the next owner touch):

```text
Изменилось после твоего одобрения:
- <что изменилось в видимом пользователю поведении> — <почему>
```

## Статус (Status Update)

One shape for every owner-facing status: the update after an ordinary
turn, the period report («за ночь», «за отрезок»), and the final wave
report. Depth scales; the shape does not. The register is product
language per Product Language For The Owner in
`references/human-friendly-output.md`: the subject of every line is what
the product now does for its user, and an Issue key, a stage, a wave
slice code, or a mechanism is never the subject of a line. The owner
never has to ask for a human version.

```text
<Период>, <продукт>. <Одна фраза: где продукт относительно цели волны>. Решений от тебя: <N> (в конце) | нет.

Новое за <период>:
- <Что пользователь продукта теперь может сделать или что для него изменилось>. <Выложено когда; «проверил вживую на проде» | «проверка после выкладки прошла» | «выложено, вживую не гонял»>. (<ISSUE-KEY>)

Можешь потрогать: <что открыть и что сделать, чтобы увидеть новое своими руками>

Где мы к цели «<цель волны>»: готово — <части, простыми словами>; осталось — <части и их состояние>.

В работе сейчас:
- <Что пользователь получит, когда это будет готово>. <Где сейчас: пишется код | локальная проверка перед PR | PR, авто-ревью и проверки | выкладка в прод | стоит: <из-за чего>>. <Когда рассчитываю выложить, или честное «срока пока нет»>. (<ISSUE-KEY>)

Дальше по очереди:
1. <Следующий продуктовый результат> — <чего ждёт, чтобы начаться>.
2. <…>

Что пошло не так:
- <Что случилось, простыми словами; какой результат съехал и на сколько>. <Что сделал>. Или «нет».

Чем рискуем:
- <Незакрытый риск как последствие для пользователя, не как техническая оговорка>.

Обещал — не сделал:
- <Что было обещано в прошлом статусе и не случилось> — <почему и что теперь>.

Решил сам:
- <Решение этого отрезка> — <одна причина>. <Влияет ли на сроки>. Или «ничего».

Проверил вживую: <что именно и как>. Не проверял: <что и с каким последствием, если там что-то поехало>.

Следующий контакт: <когда и по какому поводу>. Раньше — только если понадобится твоё решение.

Техника (можно не читать): <ISSUE-KEY>: <стадия>, <состояние>, цена: ~N тыс. out-токенов, M циклов ревью; <PR, SHA, версия сборки>; воркеры: <spawned/advanced/respawned или «без изменений»>; Linear: <применённые мутации и сертификаты или «без изменений»>; простои дольше 5 минут: <длительность>; Контекст: ~N%.

Нужно от тебя (<N> решений):
1a-<ТОКЕН>. <Бриф решения по форме выше: что решаем, варианты с последствиями для тебя и продукта, рекомендация с причиной>
2b-<ТОКЕН>. <Следующий бриф; ID берётся из своей секции борда, сквозной нумерации нет>
```

Rules that bind every status:

- Product language: the subject of every line in «Новое», «В работе
  сейчас», and «Дальше по очереди» is what the product now does for its
  user. Issue keys, stages, wave slice codes (I5, I-cap), internal labels
  (R21, 8a), certificate names, and git/infra mechanics are never the
  subject of a line; wave slice codes and internal labels are not shown to
  the owner at all. Internal nouns («ядро», «охват», «стенд», «матрица
  приёмки», «вольются») are jargon too — say what the user can do instead.
- One Linear key per line, at the end, in parentheses, only when the line
  is one Issue; render it as a link when the runtime renders links. A line
  that covers several Issues carries no key; the project link goes to
  «Техника».
- «работает» and «на проде» are said only about what was verified live
  after the latest deploy. Three states, never two: «проверил вживую на
  проде» when a human pass confirmed it after the latest deploy;
  «проверка после выкладки прошла» when the automatic post-deploy check
  passed and nobody looked at it live (the `verify:prod PASS` glossary line
  in `references/human-friendly-output.md`); «выложено, вживую не гонял»
  when neither happened.
- A task an external constraint has stopped — waiting on the owner, on
  access, on quota, on someone else — carries the state «стоит: <из-за
  чего>» in «В работе сейчас:», with the blocker named in product words.
  «Стоит» is not a stage: it says the work is not moving and why, so a
  frozen line cannot masquerade as one still in progress.
- «Можешь потрогать:» appears only when there is something to touch — the
  same condition as in `skills/mono-orchestrate/SKILL.md`. With nothing
  the owner can open yet, the line is omitted, never filled with a
  placeholder.
- No placeholders in sent text: `<ISSUE-KEY>`, `~N`, and `3xx` never leave
  this template. A number you do not have is words («несколько часов»,
  «не считал»); a key you do not have is no key.
- Numbers carry a unit and a meaning («читается ли логотип в мелком круге
  в списке»), never a bare «28/40».
- A delay is stated as the result that moved («приёмка съехала с утра на
  вечер»); hours go to «Техника».
- «Новое за <период>:» is only what changed since the previous status.
  The accumulated picture lives in one line under «Где мы к цели»; never
  re-list yesterday's wins as today's.
- «Решил сам:» carries only decisions of this period. A standing rule
  («записи на проде только по приказу») appears only when it delayed
  something.
- «Чем рискуем:» and «Обещал — не сделал:» appear only when there is an
  open risk or an unkept promise from the previous status — never as empty
  headings.
- «Следующий контакт:» is mandatory: when the owner will hear from you next
  and about what.
- «Нужно от тебя:» is always the last block, and the first line repeats the
  count («Решений от тебя: 1 (в конце)» / «нет»). «Нужно от тебя: нет» is
  still the last line. Each item is a Decision Brief per the shape above; a
  standing rule or a reminder is not a decision and does not go here.
- «Техника (можно не читать):» is the single home of the machine register
  in chat: the per-Issue status table (`<ISSUE-KEY>: <стадия>, <состояние>,
  цена: …`), PR numbers, SHAs, build versions, workers
  spawned/advanced/respawned, Linear mutations and certificates, idle
  periods over 5 minutes with duration, «Контекст: ~N%», and — in the final
  wave report — the «Цена волны» block. A line whose subject is an Issue
  key (`- <ISSUE-KEY> — …`) belongs here and nowhere else in a status; the
  table may run over several lines. It sits right before «Нужно от тебя:»
  so the owner skips it in one scroll.
- Items under «Нужно от тебя:» carry the board-aligned IDs and tokens of
  «Целостность брифа» above: the ID opens with its own board section number
  (`1a-…`, `2b-…`), never with a running number of the status, and
  renumbering across sections is forbidden here for the reason it is
  forbidden in a brief — the owner's «2) B» must decode the same way on the
  board and in the status. «Решений от тебя: N» stays a count and never
  becomes that numbering.

Three sizes, one shape:

- Ordinary turn with no news: five to six lines — the first line with the
  counter, «Новое: видимого изменения нет, идёт <что>», «Решил сам:» and
  «Что пошло не так:» as visible lines of their own, «Следующий контакт:»,
  one «Техника:» tail with «Контекст» and «цена» collapsed into it, and
  «Нужно от тебя: нет».
- Period report («за ночь», «за отрезок»): the full shape.
- Final wave report: the full shape plus the wave-only blocks in «Итог
  волны» below.

«Решил сам:» and «Что пошло не так:» are never folded into «можно не
читать», at any of the three sizes. What the orchestrator decided on its
own and what went wrong are the two things the owner is most entitled to
see without opening a tail; collapsing them is how the real cost of a wave
becomes invisible.

«Что пошло не так:» is mandatory in every status update: every
orchestrator idle or stall longer than 5 minutes with its cause and the
result it moved, and every deviation from the orchestration contract with
its reason; write «нет» when the period was clean. It stays a visible line
of its own and never moves into the «Техника» tail. The final wave report
carries the same section covering the whole wave. These are async-visible
records for the owner, not blocking notifications (owner decision Q5) —
they never interrupt or page the user.

«Контекст: ~N%» reports orchestrator session context usage per the
Context Budget policy in `references/orchestration.md`; it lives in the
«Техника» tail.

The per-Issue cost tail «цена: ~N тыс. out-токенов, M циклов ревью» is
compact telemetry per the Cost Telemetry policy in
`references/orchestration.md`: include it only when the data is
available; write «цена: н/д» otherwise. Cost lines are async-visible
records for the owner — never blocking, never a gate, never a reason to
interrupt work.

## Итог волны (Wave Report)

The final wave report is the status shape above at full depth, plus the
wave-only blocks below, placed between «Где мы к цели» and «Техника»:

```text
К чему пришли против цели «<цель волны>»: <что пользователь продукта получил в итоге; что из цели не вошло>.

Не вошло и почему:
- <Обещанная часть> — <почему не вошла; куда делась: следующая волна | снято>.

Чему научились:
- <Один урок, который меняет следующую волну> — <что делаем иначе>.
```

The wave cost block from «Цена волны (Wave Cost Summary)» below is not one
of these wave-only blocks. It belongs to the machine register and sits
inside the «Техника (можно не читать):» tail of the same report, after the
per-Issue table — which is also the only place a per-feature line may open
with an Issue key.

## Цена волны (Wave Cost Summary)

The final wave report includes a «Цена волны» summary block — per-feature
tokens, review cycles, and wall-clock, plus wave totals. It lives inside
the «Техника (можно не читать):» tail of that report, which is why its
per-feature lines may open with an Issue key:

```text
Цена волны:
- <ISSUE-KEY> — ~N тыс. out-токенов (in ~N тыс., cached ~N%), M циклов ревью, wall-clock <часы:минуты>
- …
Итого: ~N тыс. out-токенов, M циклов ревью, wall-clock <часы:минуты>
```

Numbers come from the per-stage ledger entries recorded at stage close
(Cost Telemetry in `references/orchestration.md`); a feature with missing
data gets «н/д» for the missing field instead of a guess. Like «Что пошло
не так:», this block is async-visible and never blocking.
