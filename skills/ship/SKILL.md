---
name: ship
description: >-
  Выход PR из черновика до зелёного итога после сбора Preflight: замечания бота,
  CI и владельца, описание для людей, принятый дрейф перед PR, сертификат для Deploy.
  Ранний ремонт пакета в mono:handoff, вливание в mono:deploy.
---

# Mono Ship

Ведёшь PR от черновика до зелёного; `<корень>` = `../..`.
[Посадка](<корень>/references/landing.md).

Не вливаешь, не выкладываешь, не закрываешь задачу. Код и гигиена идут в
implement/preflight. Нужна утверждённая задача Linear: находки, документы и
задачи GitHub её не заменяют.

Прочитай сразу:
- `<корень>/references/ship-feedback-loop.md`;
- `<корень>/templates/ship-output.md`.
Прочитай, когда:
- `AGENTS.md`: на входе;
- `<корень>/references/worker-contract.md`: диспатч, отчёт, очередь;
- `<корень>/references/readiness-gates.md`: допуск и риск;
- `<корень>/references/contracts/prd.md`: дрейф против PRD;
- `<корень>/references/contracts/tech-spec.md`: дрейф против Tech Spec;
- `<корень>/references/human-friendly-output.md`: итог;
- `<корень>/templates/pr-body.md`: описание PR;
- `<корень>/references/issue-only-lane.md`: `lifecycle_state_entity=issue`;
- `<корень>/skills/preflight/SKILL.md`: сертификат preflight пропал, устарел или не `ready`;
- `<корень>/templates/ship-status-ux.md`: статус человеку в разговоре.

## Порядок

1. Личность диспатча до работы; снимок и очередь по контракту исполнителя.
   Проектной задаче нужны утверждённая связанная задача, проект, PRD и Tech Spec
   или запись пакета, иначе handoff; issue-only: оракул, отпечаток, свежий
   preflight. Нет утверждения или контекст закрыт: ворот и PR нет.
2. Последний сертификат preflight: нет или устарел → preflight; drift-candidate →
   формальное ревью и check. Сверь объём, риск и дифф с артефактами.
3. `mono:review pre-ship` по допуску; нерешённое или блокирующее → needs-human.
4. Принятый дрейф в Linear до выхода из черновика, записи подтверждены.
5. `mono:check pre-ship`: только готовность, без ремонта.
6. Черновик открыл preflight. Описание: `scripts/ship-pr.mjs body` после каждого
   круга, перед `ready` и перед зелёным. Каждое из `remarks`: исправлено в чистом
   круге или решено без кода `check --pr` (он же проверяет описание; назван в
   botRemarks evidence). Затем `ready`; бот молчит: один `mention`. In Review и
   чип PR в очередь после выхода из черновика.
7. Documentation workflow после выхода из черновика; нет процесса: недоступен с причиной.
8. Позднее замечание или упавший CI: решено без кода через `check` или неопасное
   стало наследником; нужна правка: `undo`, стоп «не сошлось». Комментарий
   владельца без метки Ship: один вопрос. Продукт, UX, деньги, объём → needs-human.
9. Живой `gate.mjs ship` проходит; полный зелёный сертификат, очередь подтверждена.
   Под диспатчем прямых записей в Linear нет.

После восстановления состояние PR читай из gh. blocked, needs-human, timed-out:
выходной комментарий с точным вопросом.

## Ручной запуск

Без диспатча, в сессии владельца: ветка с готовой задачей Linear и подписанной
квитанцией ревью clean или clean-with-successors на текущей версии из сбора
задачи. Сбор не делаешь: `collect:false` берёт последний запрос сбора задачи к
этой квитанции. Нет задачи или квитанции: отказ с причиной. Правка нужна: стоп.
Linear пишешь сам. Нет права отвечать в обсуждениях: стоп «нет права публиковать ответы».

## Итог

Над сертификатом 1-3 строки языком продукта: что готово, попытка, круги ревью
из трёх, ожидание из предела. «PR готов к вливанию. Попытка 1, круги 2 из 3,
ожидание 12 мин из 120.» Блок прежней формы:

```text
mono-ship green certificate
Ship: green
Issue(s): <keys>
PR: <number/url>
Head SHA: <sha>
Preflight: <certificate reference + status>
Pre-ship review: <run/skipped + outcome>
Documentation workflow: <run/skipped/not configured + head SHA effect>
CI: <green/non-blocking summary>
Greptile: <completed/unavailable + outcome>
Unresolved review threads: <0/count/unknown>
Merge state: <clean/blocked/conflict/unknown>
Checked: <states inspected>
Not checked: <manual/browser/mobile/prod/deploy surfaces not inspected>
Next: mono:deploy
```
