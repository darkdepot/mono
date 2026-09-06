# Human-Friendly Workflow Output

Workflow output should help the user understand the real state of the work, not the internal pipeline that produced it.

Use these rules for user-facing status updates, final responses, Linear comments, and decision prompts.

## Outcome First

Start with the human outcome:

- What is durable now?
- Is the work ready, waiting, blocked, or incomplete?
- What exact decision or unblock is needed?

Do not start with internal verdict labels, phase names, tool transcripts, or raw command directives.

## Product Language For The Owner

The owner reads a status as the product's owner, not as the workflow's
operator. Every owner-facing status, period report, wave report, and
decision brief passes the translation test: a reader who has never opened
the Linear board and does not know the workflow understands every line.
A line that needs the workflow glossary to be understood is rewritten.

- The subject of a line is what the product now does for its user, or what
  changed for that user. Issue keys, wave slice codes (I5, I-cap), internal
  labels (R21, 8a), stage and skill names, certificate names, and git/infra
  mechanics (SHA, squash-merge, worktree, nohup, registry) are
  never the subject of a line. Wave slice codes and internal labels are not shown to
  the owner at all.
- Internal nouns are jargon too: «ядро», «охват», «журнал», «контрольная
  сверка», «стенд», «матрица приёмки», «вольются», «прогнать». Say what the
  user can do instead.
- One Linear key per line, at the end, in parentheses, only when the line is
  one Issue — a lookup handle, never a name. A group of Issues carries no key.
- «работает» and «на проде» are said only about what was
  verified live after the latest deploy. Three states, not two:
  «проверил вживую на проде» after a human pass;
  «проверка после выкладки прошла» when the automatic post-deploy check
  passed and nobody looked at it live (the `verify:prod PASS` glossary line
  below); «выложено, вживую не гонял» when neither happened.
- No placeholders in sent text: a missing number is words («несколько
  часов», «не считал»), a missing key is no key. `<ISSUE-KEY>`, `~N`, and
  `3xx` never leave a template.
- Numbers carry a unit and a meaning; a bare «28/40» is a cipher in digits.
- The machine register — the per-Issue table, PRs, SHAs, build versions,
  worker mechanics, cost, context — lives in the «Техника (можно не
  читать):» tail of a status or in Linear machine blocks, never in the
  headline.
- The owner never has to ask for a human version: the product-language form
  is the only form.

Stage and mechanism glossary for owner-facing lines:

- `mono-implement` → «пишется код»
- `mono-preflight` → «локальная проверка перед PR»
- `mono-ship` → «PR, авто-ревью и проверки»
- `mono-deploy` → «выкладка в прод»
- closeout → «закрытие задачи в Linear»
- certificate → «отметка, что этап пройден»
- squash-merge → «влито в main»
- `verify:prod PASS` → «проверка после выкладки прошла»
- worktree, registry, thread id, nohup/setsid → not shown; «Техника» only

## Status Glossary

Translate workflow statuses before showing them to the user:

- `PASS`: "I inspected the required state and found no blocking drift." Also say what was not proven.
- `FAIL`: "A hard workflow contract was violated or a required artifact/stage is missing."
- `BLOCKED`: "I could not inspect or mutate required state because something external is unavailable." Name the smallest unblock step.
- `ready`: "Review is complete for this gate and no blocking findings remain."
- `advisory-ready`: "This was low-risk/advisory and nothing blocks moving forward."
- `needs-fixes`: "Review found changes or decisions that should be handled before the next stage."
- `blocked`: "Review cannot complete because required artifacts, permissions, tools, or context are missing."
- `green`: "The PR is stable after docs/review/checks and ready for `mono-deploy`, but it has not been merged or deployed by `mono-ship`."
- `deployed`: "The PR was merged/deployed, delivery evidence was captured, and Linear closeout ran."
- `implemented-needs-preflight`: "Implementation finished locally and needs preflight before PR/ship."
- `scope-drift-needs-handoff`: "Implementation found material scope drift that should be reflected in Linear before continuing."
- `drift-candidate`: "Local changes may differ from approved Linear scope; ship should run formal pre-ship review/check before PR green certification."
- `needs-human`: never leave this raw. Say which human decision is needed:
  - "Ready for deploy, waiting for approval."
  - "Decision needed on review feedback."
  - "Decision needed on product, UX, business, scope, or external state."
- `timed-out`: "Waiting did not settle in time." Name what is still pending and whether safety is known or unknown.

## Checked / Not Checked

For any handoff, implement, preflight, review, check, ship, blocked, or timed-out final, include a compact confidence boundary:

```text
Проверено:
- <artifact/state/check that was actually inspected>

Не проверено:
- <manual QA/browser/prod/mobile/deploy surface/etc. that did not run>
```

Keep this short. The goal is trust calibration, not an audit log.

If something cannot be inspected, say `unknown` instead of implying it passed.

## Boundary Delta Rule

In chat finals after the first stage, state the boundary as a DELTA when it did not change from the previous stage:

```text
Граница не изменилась с preflight; добавилось: deploy verification passed.
```

The full Проверено/Не проверено form is required whenever:

- the boundary materially changed (new surfaces checked, new surfaces skipped, or previously unknown state resolved);
- the stage is ship or deploy.

The full boundary always stays inside the durable Linear certificates. The previous boundary is recoverable from the last certificate in Linear.

## Human Decision Prompts

When asking for a decision, list options with consequences and a recommendation when one is clear.

Prefer:

```text
Что дальше:
1. Run `mono-deploy` сейчас - рекомендую, потому что review/CI зеленые и unresolved feedback нет.
2. Оставить PR в review - если хочешь руками посмотреть UI перед merge.
```

Avoid:

```text
1 - land
2 - review
```

## Fresh-Agent Handoff Option

Offer a fresh-agent handoff as a first-class next step when any of these are true:

- the session is long or close to compaction;
- implementation is about to start after substantial discovery;
- there are multiple execution Issues or parallelizable slices;
- the user expressed concern about context quality;
- the next step would benefit from a clean prompt and bounded scope.

When offering it, include the tradeoff:

- Continue here: fastest when context is still clean and the next slice is small.
- Fresh-agent handoff: safest when the current thread is long or discovery-heavy.
- Subagent-driven flow: useful only when work can be split without losing product/style coherence.

## Blocked / Timed-Out Shape

Blocked or timed-out responses must still be useful:

```text
Работа не завершена.

Уже durable:
- <links/state that exist>

Где остановился:
- <exact blocker or pending state>

Чего не было сделано:
- <Issue/PR/merge/deploy/code/etc.>

Проверено:
- <artifact/state/check that was actually inspected before the stop>

Не проверено:
- <manual QA/browser/prod/mobile/deploy surface/etc. that did not run>

Следующий unblock:
- <one smallest useful action>
```

Do not call a blocked run complete. Do not hide partial durable state.

## Risk And Gate Glossary

Use these Russian renderings in user-facing lines:

- `tiny` → «крошечный: правка в одну строку, ритуалы по минимуму»
- `standard` → «обычный»
- `deep` → «глубокий: затрагивает много поверхностей»
- `risky` → «рискованный: деньги/данные/прод»
- `required` → «обязательное ревью»
- `advisory` → «совещательное: можно идти дальше, замечания на усмотрение»

## Tooling Glossary

Translate tooling vocabulary into plain Russian in user-facing lines:

- `Greptile` → «внешний авто-ревьюер PR»
- `head SHA` → «точная версия кода, которую проверяли»
- `merge state` → «можно ли влить без конфликтов»
- `CI` → «автоматические проверки на сервере»

Rule: helper command paths and exit codes belong only inside Linear machine blocks, never in chat finals.

## Linear Exit Comments

Whenever a stage ends in a non-ready terminal status (`blocked`, `needs-human`, `scope-drift-needs-handoff`, or `timed-out`), the skill must post a short Russian Linear comment on the Issue (or the Project during Idea). Use the blocked shape as a spirit guide: one line of what is already durable, one line of where it stopped, one line «Нужно от тебя: <точное решение или unblock>».

Happy-path terminals keep their existing comments and certificates; this rule covers the silent failure paths only.

Example:

```text
Реализация остановлена. Durable: ветка `feat/settings-skeleton`, все файлы закоммичены.
Где остановился: не могу получить доступ к Linear Issue — токен истёк.
Нужно от тебя: обнови Linear API token и перезапусти /mono-implement.
```

## Machine Blocks In Linear Comments

Certificates and closeouts posted to Linear are dual-audience: the next workflow stage recovers them by their stable English marker and field keys.

Every such comment MUST open with 1-2 Russian sentences (project config language when set) stating the human outcome and the next step — e.g. `Ветка готова к PR: автоматическое ревью чистое, локальные проверки прошли. Дальше — mono-ship.` — followed by the unchanged machine block.

The marker line, field names, and status tokens inside the machine block must never be translated, reworded, or summarized away.

Exception: the Russian-comments rule in each skill applies to the human lead; the machine core is exempt by design.
