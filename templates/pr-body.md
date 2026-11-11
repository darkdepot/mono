# PR body

The author's part of a Ship PR description. Ship keeps it between its own markers
(`<!-- mono:ship body head=… -->` … `<!-- /mono:ship body -->`), writes the
«Проверки» line itself from the head's checks and keeps a bot's block outside
the markers. Rewrite the whole part after every round, before leaving draft and before green:
`scripts/ship-pr.mjs body --file <this text>`. Before leaving draft the form is
checked (required sections, a list in «Что изменилось», visible part up to 400
words, the task link, written for the current head) and the read-only pass
(`ship-pr.mjs check --pr`) confirms every statement against the change.

Russian for people, light markdown, no hashes, paths or machine fields in the
visible part; technique only inside `<details>`. The title (set when the draft
opens) states the result and ends with the task key.

```markdown
<one or two sentences: what changes for the user of the product>

## Что изменилось

- <a change in product words>
- <another change>

## Зачем

<why now, with the number or the decision behind it>

## Как проверить

1. <do this> → <you see this>
2. <for an internal rule: behaviour before and after>

## Посмотри особенно

<only when there is something a reviewer should look at closely>

## Не проверено

<only when something was not run; name it and why; never call it passed>

<details><summary>Техника</summary>

<files, functions, pins, reviews>
</details>

Задача: [<KEY>](<task URL>)
```
