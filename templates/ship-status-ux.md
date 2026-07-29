# Ship status UX (interactive mode)

Shape only. Every value comes from something you actually observed — a `gh`
query, a check run, a Linear artifact, a certificate. Nothing here is a story to
complete: the numbers, verdicts, and SHAs below are placeholders, and the
narrative in the timeline example is illustrative, not a template of events to
reproduce.

Read this at composition time, when `mono-ship` is running interactively and a
user is on the other side. A worker running from a dispatch has no user, renders
none of this, and satisfies the content requirements in
`skills/mono-ship/SKILL.md` through its report and the green certificate. This
file carries no gate: every rule about what a ship status must contain, and
every verdict boundary, stays in `skills/mono-ship/SKILL.md`.

## Verdict copy

- Для `green`: «PR готов к `mono-deploy`; `mono-ship` не мержил и не деплоил.»
- Для `needs-human` при зелёном ревью/CI, но с явным deploy approval: «PR готов к деплою, жду твоего подтверждения.» Не звучит как блокер.
- Для `needs-human` при нерешённом ревью-фидбеке: «Нужно решение по ревью-фидбеку» и список конкретных нерешённых пунктов.
- Для `blocked`: назови отсутствующий пресреквизит и точный следующий unblock-шаг.
- Для `timed-out`: назови, что не устаканилось, и известно ли, что PR в целом безопасен.
- Сделай статус ревью понятным. Укажи кто/что ревьюил, что нашли, что починили, что не решено, статус CI, безопасен ли PR с точки зрения ревью.
- Если resolver или documentation workflow пушили исправления, укажи точную версию кода после этого пуша и что ревью-статус был перепроверен.
- Для bug- и performance-работ: оригинальное воспроизведение или базовый замер, доказательство исправления и регрессионного теста или задокументированного gap.
- Включи компактную границу «проверено / не проверено». Если ручное browser QA, production smoke, mobile QA, верификация деплоя или другие поверхности не запускались — скажи прямо.
- Не сваливай фазовые имена, git-директивы или внутреннюю workflow-телеметрию, если они не объясняют статус.
- Заверши конкретными вариантами действий, когда нужно решение человека.
- Варианты должны объяснять последствия и содержать рекомендацию, когда состояние ревью/CI делает один путь явно предпочтительным.

## Статус ревью при наличии PR

```text
Статус ревью:
- Preflight: <ready/blocked/drift-candidate/needs-human/not run>; <кратко о локальной готовности>.
- Кто/что ревьюил: <pre-ship review + внешний авто-ревьюер PR — run/skipped/not configured; итог>.
- Documentation workflow: <run/skipped/not configured>; <изменил ли head — yes/no + итог>.
- Bug/perf proof: <not applicable or original symptom/baseline + fix proof + regression proof/gap>.
- Что нашли и что починили: <краткий список исправлений или «нет»>.
- Нерешённые треды: <количество/статус>.

Проверки CI:
- <блокирующая проверка>: <состояние>.
- <прочие релевантные проверки>: <состояние или «блокирующих нет»>.

Проверено:
- <ревью/проверки/Linear-статус — что реально смотрели>.

Не проверено:
- <ручное QA/прод/браузер/мобайл/деплой — что не запускали>.
```

## Review timeline

Include a short timeline when a feedback loop ran. The example below shows the
shape of the steps, not the events of your run: report the rounds that actually
happened, the findings that were actually raised, and the SHAs you actually
observed. A run with zero findings has a shorter timeline, and that is the
correct output.

```text
Review timeline:
1. Before PR: pre-ship review passed and scope matched the Linear Issue.
2. After PR: documentation workflow updated repo docs in `<sha>` or made no changes.
3. CI settled green for latest head `<sha>`.
4. <авто-ревьюер> left <count> findings of class <blocking/nit/none>.
5. <what was fixed, in `<sha>`, or «нечего чинить»>.
6. Re-check: <reviewer outcome>, unresolved threads: <count>, merge state: `<state>`.
7. `mono-ship green certificate` recorded for `<sha>`.
```
