# Deploy Output Template

Default user-facing response:

```text
<Outcome sentence in human language. Say whether the PR was deployed, blocked, timed out, or waiting for a named decision.>

PR: [#<number>](<url>)
Linear Issue: `<key>` - <current Linear status>

Deploy status:
- Ship certificate: <found/missing/stale>; reviewed head SHA `<sha>`.
- Current PR head SHA: `<sha>`; match: <yes/no>.
- Deploy workflow: <name or missing>.
- Merged SHA: <sha or none>.
- Deploy target: <url/environment or none>.
- Deploy verification: <passed/failed/unavailable + evidence>.
- Live QA: <passed/failed/skipped + evidence or recorded skip reason>.
- Post-ship check: <PASS/FAIL/BLOCKED + human meaning>.
- Linear closeout: <Done/not done + reason>.
- Project update: <posted <url> | already posted <url> | not posted — <reason> | n/a — <reason>>.
- Project: <Completed | stays <status>, open <N> | stays <status> — <reason> | n/a>.
- Learnings recorded: <none or keys>.
- Learnings consulted: <none/keys/helper unavailable>.

Проверено:
- <PR/merge/deploy/Linear/learning state actually inspected>.

Не проверено:
- <manual QA/browser/prod/mobile surface/etc. that did not run, or `none known`>.

Что дальше:
1. <recommended next action, when one exists>.
2. <alternative next action, when useful>.
```

Optional internal summary for logs or Linear comments:

```text
Mono deploy verdict: <deployed|needs-human|blocked|timed-out>

PR:
Linear Issue:
Reviewed head SHA:
Current head SHA:
Deploy workflow:
Merged SHA:
Deploy target:
Verification:
Live QA:
Post-ship check:
Linear closeout:
Project update:
Project:
Learnings recorded:
Learnings consulted:
Notes:
```

Verdicts:

- `deployed`: deploy workflow completed, delivery evidence was captured, post-ship check ran or was reported, and Linear closeout completed.
- `needs-human`: explicit deploy approval, product/risk acceptance, external access, or delivery policy decision is required.
- `blocked`: required config, tools, auth, certificate, PR state, deploy target, or Linear context is unavailable.
- `timed-out`: merge, deploy, or deploy verification did not settle within the configured wait.

Verdict-to-human translation:

- Для `deployed`: напиши точно, что было смержено/задеплоено и как обновился Linear.
- Для stale certificates: «PR изменился после ревью; прогони `mono-ship` ещё раз перед деплоем.»
- Для отсутствующего Deploy workflow: «Deploy workflow не настроен; укажи `Deploy workflow` или запусти deploy-путь репозитория вручную.»
- Для `Project update: not posted`: скажи, что поставка выкачена, а запись в ленте проекта не появилась, и назови причину; вердикт деплоя от этого не меняется.
- Для `timed-out`: назови, что не устаканилось — merge, deploy, верификация или Linear closeout.
