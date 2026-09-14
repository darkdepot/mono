# Human-Friendly Workflow Output

For statuses/finals, Linear comments/decisions.

## Outcome First

Lead: durable result/readiness/decision/unblock, no phase/command transcript.

## Product Language For The Owner

Statuses/period/wave/decisions need no board/glossary. Name user-visible change; hide slice codes/internal labels; replace jargon with user action. Single-Issue line: one trailing parenthesized key; groups: none. Replace «ядро», «охват», «журнал», «контрольная сверка», «стенд», «матрица приёмки», «вольются», «прогнать» with user actions.

Works/in-production requires latest live proof. Human pass: «проверил вживую на проде»; automatic-only `verify:prod PASS`: «проверка после выкладки прошла»; neither: «выложено, вживую не гонял». No placeholders (`<ISSUE-KEY>`, `~N`, `3xx`): spell unknown numbers, omit unknown keys; include units/meaning. PR/SHA/build/worker/cost/context only in `Техника (можно не читать):` or machine blocks. Always use human form.

Render:

- mono-implement: «пишется код»; mono-preflight: «локальная проверка перед PR».
- mono-ship: «PR, авто-ревью и проверки»; mono-deploy: «выкладка в прод».
- closeout: «закрытие задачи в Linear»; certificate: «отметка, что этап пройден»; squash-merge: «влито в main».
- worktree/registry/thread/nohup/setsid: technical tail only.

## Status Glossary

Translate:

- PASS: inspected/no blocking drift; name limits. FAIL: hard contract/artifact/stage violation.
- BLOCKED: external state prevents inspection/mutation; smallest unblock.
- ready: review complete/no blockers; advisory-ready: advisory permits continuation.
- needs-fixes: fixes/decisions first; blocked: artifacts/tools/permissions/context missing.
- green: docs/review/checks stable, deploy-ready; ship neither merged nor deployed.
- deployed: merge/deploy/evidence/Linear closeout complete.
- implemented-needs-preflight: code done, preflight before PR.
- scope-drift-needs-handoff: material drift needs Linear sync; drift-candidate: possible drift needs formal pre-ship review/check.
- needs-human: name approval/feedback/product/UX/business/scope/access decision, never raw status.
- timed-out: waiting expired; name pending state and safety known/unknown.

## Checked / Not Checked

Handoff/implement/preflight/review/check/ship/blocked/timed-out finals include:

```text
Проверено:
- <observed state/check>
Не проверено:
- <unrun manual/browser/prod/mobile/deploy/acceptance>
```

Uninspected = unknown, never pass.

## Boundary Delta Rule

After first stage, unchanged chat boundary may be a latest-certificate delta. Material changes, ship/deploy/durable certificates need full boundary.

## Human Decision Prompts

Give options/consequences and supported recommendation, not bare directives.

## Fresh-Agent Handoff Option

Offer fresh context for long/near-compaction/discovery-heavy sessions, multiple/parallel slices or context concerns/benefit. Explain speed of small clean-context sessions versus fresh-context safety; subagents only if product/style survive separation. AFK rules win.

## Blocked / Timed-Out Shape

Name unfinished/unperformed work, durable links/state, exact stop/pending state, boundary/smallest unblock. Never imply complete.

## Risk And Gate Glossary

Render:

- tiny: «крошечный: правка в одну строку, ритуалы по минимуму»; standard: «обычный».
- deep: «глубокий: затрагивает много поверхностей»; risky: «рискованный: деньги/данные/прод».
- required: «обязательное ревью»; advisory: «совещательное: можно идти дальше, замечания на усмотрение».

## Tooling Glossary

Greptile: «внешний авто-ревьюер PR»; head SHA: «точная версия кода, которую проверяли»; merge state: «можно ли влить без конфликтов»; CI: «автоматические проверки на сервере». Helper paths/exit codes only in Linear machine blocks, never chat finals.

## Linear Exit Comments

Blocked/needs-human/scope-drift-needs-handoff/timed-out: short Russian Issue (Idea: Project) comment, result/stop/`Нужно от тебя: <точное решение или unblock>`. Keep happy-path comments/certificates; queue under dispatch.

## Machine Blocks In Linear Comments

Certificate/closeout: 1–2 Russian sentences (or configured language), outcome/next, then unchanged English machine core. Keep markers/fields/statuses verbatim; only lead follows comment language.
