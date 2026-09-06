# Project Update Template

The single home of the project-update form and its text rules. `mono-deploy`
composes every project update from this file at its `project-update` step.

Use the project config language for the update itself. Use Russian when no
project config is present. The shape block and both worked examples below are
shown in Russian because this pack's accepted reference set is Russian; they are
quoted as evidence of the FORM, never as a language requirement. The rules
around them stay English like the rest of the repo.

Publication mechanics — when the update is posted, how project completion is
decided, what the closeout records — live in `skills/mono-deploy/SKILL.md`. This
file governs the text only.

## Shape

One update per merged and deployed Issue, health `On track`, nothing in the body
beyond the three parts below:

```text
**<Заголовок: одна фраза о результате для продукта>**

<Одно-три предложения: что изменилось и, если это неочевидно, зачем.>

[<ISSUE-KEY>](<issue url>)
```

The final update of a project keeps the same shape with one difference: its
title opens with the project completion prefix — `Проект завершён: ` in Russian,
and its equivalent in the configured Linear language otherwise.

## Invariants

Numbered so a review can name the one that failed.

1. Form. Bold one-phrase title, blank line, body, blank line, the Issue chip as
   the last line — and nothing after it.
2. Body length. One to three sentences. Prefer one or two; take the third only
   when it carries real product meaning.
3. Health. Always `On track` (`onTrack`).
4. The title names a state of the product that is now true, not the work that
   was done. Test: it makes sense to someone who does not know how it was built.
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
    Rules 7 and 8 are about HOW we shipped it, never about WHAT was shipped.
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

## Live mode

In live mode the last line is the Issue chip and nothing else. The
`· влито <дата>, <время>` tail belongs only to the retrospective acceptance set
below; never add it to a live update.

## Examples

Verbatim, from the accepted set. Ordinary update (ZENI-379):

```text
**Реальные импортированные платежи по подписке теперь можно перевести в долг**

Защита импортированных операций от правок заодно запрещала и классификацию в долг, то есть ровно то, для чего пакет долгов и делался. Теперь классификация разрешена, а суммы, даты и источник остаются нетронутыми. Если банк потом скорректирует платёж, поправка ляжет отдельной строкой.

[ZENI-379](https://linear.app/darkdepot/issue/ZENI-379/bag-mcpdebt-provider-imported-blokiruet-perevod-realnyh-platezhej-kami)
```

Final update (ZENI-381):

```text
**Проект завершён: новые типы операций привязываются к существующему контрагенту по ID**

Для контрагентов вроде Wirex, у которых появляются новые направления операций, обогащение дополняет существующую карточку правилами, а не создаёт дубликат и не трогает имя, аватар и настройки. Это была последняя поставка проекта: обогащение без браузера, правила, аватары, обратимые изменения и атомарный путь «предложить → показать → применить» доставлены целиком.

[ZENI-381](https://linear.app/darkdepot/issue/ZENI-381/mcp-privyazyvat-novye-tipy-operacij-k-sushestvuyushemu-kontragentu-po)
```

## Acceptance set

The 13 updates published on 2026-09-06 across four Zeni projects («Финансовый
оркестратор Zeni», «Zeni MCP · Debt Operations V1», «Zeni MCP · P2 Counterparty
Enrichment», «Zeni MCP · Без искусственных квот владельца») are the accepted
format — the owner confirmed the form on them. Recover them from Linear with
`get_status_updates` on those projects.

They are the acceptance set for the invariants above — for the FORM of an
update, not for its language, since this pack's Linear language is Russian.
Every one of them must pass every text invariant, with the retrospective `· влито …` tail excluded
because it never belongs to a live update. Invariants 11 and 12 are process
rules about how an update is produced, which a published body cannot
demonstrate on its own. When one of them fails an invariant, the
invariant is wrong and gets fixed — not the example.

A draft that must fail: «Прошли preflight и autoreview, PR #812 смержен в main»
breaks invariant 7 (workflow mechanics), invariant 8 (`#812` and a branch name),
invariant 4 (it names the work, not a product state), and invariant 1 (no title,
body, or chip).
