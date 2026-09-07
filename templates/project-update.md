# Project Update Template

The single home of the project-update form and its text rules, for EVERY
writer: `mono-deploy` at closeout, and the orchestrator when it publishes a
project sweep, a hand completion, or a retro note. An update written from any
other form — a status register, a ledger, a wave digest — is a defect, whoever
wrote it.

Use the project config language for the update itself. Use Russian when no
project config is present. The shape blocks, the stop-dictionary lists, and the
worked examples below are shown in Russian because this pack's accepted
reference set is Russian; they are quoted as evidence of the FORM, never as a
language requirement. The rules around them stay English like the rest of the
repo: the file is mixed by design.

Publication mechanics — when the update is posted, how project completion is
decided, what the closeout records — live in `skills/mono-deploy/SKILL.md`. This
file governs the text only.

Two forms, and only two. «Выкладка» reports a result that shipped, and it is the
form of every `mono-deploy` closeout. «Состояние» reports where a project stands
when nothing shipped in this pass; it belongs to the orchestrator and has its
own section below.

## Shape

«Выкладка» — the form of a shipped result. One update per merged and deployed
Issue, health `On track`, nothing in the body beyond the three parts below:

```text
**<Заголовок: одна фраза о том, что теперь верно про продукт>**

<Одно-два предложения: что изменилось и, если это неочевидно, зачем.>

[<ISSUE-KEY>](<issue url>)
```

The final update of a project keeps the same shape with two differences: its
title opens with the project completion prefix — `Проект завершён: ` in Russian,
and its equivalent in the configured Linear language otherwise — and its body
may take the third sentence that invariant 2 allows only there.

«Состояние» is the second permitted form, defined in the State update section
below: the same three parts, but health by fact and a chip that may be absent.

## Invariants

Numbered so a review can name the one that failed. They bind both forms; an
invariant that binds one of them says so, and the State update section names
the two that form does not carry.

1. Form. Bold one-phrase title, blank line, body, blank line, and in «Выкладка»
   the Issue chip as the last line — with nothing after it. In «Состояние» the
   chip is optional on the terms that section states.
2. Length. Body: one to two sentences and at most 35 words. A third sentence is
   allowed only in a project's final update. Title: at most 10 words.
3. Health. In «Выкладка» always `On track` (`onTrack`). In «Состояние» health is
   by fact.
4. The title names a state of the product that is now true, not the work that
   was done. Test: the phrase can go into a list of the product's capabilities
   without a single edit. The subject of the title, and of the body's first
   sentence, is what the user can now do or what is now true about the product;
   «агент», «скилл», «сервер», «пак», «MCP», «валидатор», «воркер» are never
   that subject, and the title never opens with the name of a skill. One
   exception: when the title already states the present capability, the first
   sentence may be a single clause of contrast with the previous state
   («Раньше … мешала»), because that contrast is the why.
5. The body says what changed, and why when the why is not obvious from the
   title.
6. Nothing else: no «дальше» line, no forecasts, no progress estimates, no merge
   time, no signature.
7. No mechanics of our workflow — stages, review, automated checks, workers,
   certificates, branches, merge and deploy as words about process, the PR as an
   entity.
8. No service identifiers of the delivery itself: PR numbers, SHAs, UUIDs, run
   ids, file paths, branch names.
9. No links except the Issue chip.
10. The product's own vocabulary is allowed — the names of its skills, tools,
    integrations, environments, and surfaces — even when the delivered thing is
    itself engineering, such as a test suite, checks in CI, or a developer tool.
    Rules 7, 8, and 15 are about HOW we shipped it, never about WHAT was
    shipped: every banned word is banned as a fact about the delivery, so the
    stop dictionary never forbids naming the delivered result itself.
11. Source precedence: live-QA evidence (which criteria passed and what was
    observed) → the Issue's «Цель PR» / «Желаемое поведение» → the PRD
    requirement the Issue closes (the why) → the accepted-drift record in
    Linear. The PR body is not a source.
12. The update and the closeout lead «Выкатили: …» are written in one pass and
    name the same result.
13. Final update: the title opens with the completion prefix in the configured
    Linear language (`Проект завершён: ` in Russian, the default), and the body names
    the result of the whole project — either as its own closing sentence or
    because the whole body is that result.
14. Один результат — один апдейт. No subheadings («Что выехало», «Что это
    значит», «Дальше»), no bulleted lists, at most one chip. Several results are
    several updates, never one digest.
15. Стоп-словарь. Запрещены: SHA, номер сборки, `verify:prod`, срез, раунд,
    ревью, Second Voice, PR, worktree, сессия, стадия, идемпотентность,
    kill-switch, tombstone, кэш-метки, stale-while-revalidate, CI, байты,
    квитанции, коды требований и приёмки (R14, AC4, AE13), даты и время,
    проценты готовности. Разрешён словарь продукта: превью, Cashflow, Zenmoney,
    выписка, подписка, контрагент, долг, Альфред, имена помощников, названия
    скиллов, интеграций и экранов — как названия, а не как подлежащее.

## Live mode

In live mode the last line of a «Выкладка» update is the Issue chip and nothing
else. The `· влито <дата>, <время>` tail belongs only to the retrospective
acceptance set below; never add it to a live update in either form.

## Theme project

An issue-only Issue has no project of its own, so its update is published on
the theme project named by the `Тематический проект:` line in the Issue's
`Связи` section — the project whose theme the delivered work continues. The
form does not change with the lane: the same shape above, the same invariants
1-12, 14, 15, and the chip of that issue-only Issue as the last line.

Only the ordinary «Выкладка» form exists here. Invariant 13 does not apply,
because an issue-only shipment never completes a project: the completion prefix
is never written on this path. A project already in `Completed` receives its
update on the same terms as an active one — the update records what shipped,
and it changes no project status.

## State update

«Состояние» — the form of an update with no shipment behind it: a sweep over a
project in flight, a completion by hand with no last delivery, a «до завершения
осталось …» note. The orchestrator writes it; the `project-update` step of
`mono-deploy` never does.

```text
**<Заголовок: одна фраза о том, что сейчас верно про продукт>**

<Одно-два предложения: что уже работает, что осталось и — последней мыслью —
что нужно от владельца, когда это нужно.>

[<ISSUE-KEY задачи-блокера или следующего шага>](<issue url>)
```

The same three parts as «Выкладка», with three differences:

- Health is by fact — `onTrack`, `atRisk`, or `offTrack` — never `On track` by
  default.
- The last line is the chip of the Issue that blocks the project or carries its
  next step. When no such Issue exists, the update ends with its body and
  carries no chip at all.
- The last thought of the body is «нужно от тебя …» whenever something is needed
  from the owner; when nothing is, the body simply ends.

Запрещены в этой форме: даты, проценты, перечисление срезов и «до Completed
остаётся <ключ>». «Состояние» never opens with the completion prefix and never
moves a project to `Completed`: a project is completed by a shipment, and that
path lives in `skills/mono-deploy/SKILL.md`, while a project left without open
Issues by cancellation or by a hand-closed tail stays the owner's to complete.
The update about such a project is written in this form, never with the
completion prefix. Invariants 12 and 13 are the two this form does not carry;
every other invariant binds it, 14 and 15 included.

## Examples

Verbatim, from the accepted set. «Выкладка», ordinary update (ZENI-379):

```text
**Платёж по подписке из банка теперь можно перевести в долг**

Раньше защита импортированных операций этому мешала. Суммы, даты и источник остаются нетронутыми, а поправка от банка ляжет отдельной строкой.

[ZENI-379](https://linear.app/darkdepot/issue/ZENI-379/bag-mcpdebt-provider-imported-blokiruet-perevod-realnyh-platezhej-kami)
```

«Выкладка», final update (ZENI-381):

```text
**Проект завершён: новые операции не создают дубль контрагента**

Для контрагентов вроде Wirex обогащение дополняет существующую карточку правилами, не трогая имя, аватар и настройки. Это была последняя поставка: обогащение контрагентов доставлено целиком.

[ZENI-381](https://linear.app/darkdepot/issue/ZENI-381/mcp-privyazyvat-novye-tipy-operacij-k-sushestvuyushemu-kontragentu-po)
```

«Состояние» (ZENI-393 as the blocking Issue):

```text
**Долги из чата работают, кроме повторного импорта по ним**

Заведение долга, погашение и перевод подписки в долг уже на проде. Остался один баг: после перевода в долг повторный импорт из Zenmoney и выписок падает вместо корректирующей строки.

[ZENI-393](https://linear.app/darkdepot/issue/ZENI-393/bag-importa-zenmoney-sync-i-statement-upsert-obnovlyayut-yadro)
```

## Acceptance set

The 32 updates published or rewritten on 2026-09-07 after the CPO review — 26
rewritten in place and 6 written new from their Issues — are the accepted
format. They live in the feeds of «Pulse», «Модельная политика», «Финансовый
оркестратор Zeni», «Свежесть веба», «P4a», «Zeni Mobile оффлайн», «Документы к
транзакциям», «Debt Operations V1», «P2 Counterparty Enrichment», and «Без
искусственных квот». Recover them from Linear with `get_status_updates` on those
projects.

They are the acceptance set for the invariants above — for the FORM of an
update, not for its language, since this pack's Linear language is Russian.
Every one of them must pass every text invariant, with the retrospective `· влито …` tail excluded
because it never belongs to a live update. Invariants 11 and 12 are process
rules about how an update is produced, which a published body cannot
demonstrate on its own. When one of them fails an invariant, the
invariant is wrong and gets fixed — not the example.

Two drafts that must fail. «Прошли preflight и autoreview, PR #812 смержен в
main» breaks invariant 7 (workflow mechanics), invariant 8 (`#812` and a branch
name), invariant 4 (it names the work, not a product state), and invariant 1 (no
title, body, or chip). «06.09, вечер. Доставлено: I0, I9, I2… ревью r2 ready,
раунд a3» breaks invariant 14 — several results listed inside one update — and
invariant 15 by the whole of its vocabulary: даты, коды срезов, ревью и раунды.
Nothing in it is a state of the product, so it fails invariant 4 too.
