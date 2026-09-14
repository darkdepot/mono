# Ship status UX (interactive mode)

Interactive composition only; AFK uses report/certificate. Observed gh/check/Linear/certificate evidence only; no added gate.

## Verdict copy

- green: «PR готов к `mono-deploy`; `mono-ship` не мержил и не деплоил.»
- needs-human only for explicit deploy approval, review/CI green: «PR готов к деплою, жду твоего подтверждения.» No blocker framing; deploy approval never gates ship.
- needs-human for unresolved feedback: «Нужно решение по ревью-фидбеку» plus exact unresolved points.
- blocked: missing prerequisite/exact unblock. timed-out: unsettled state and known/unknown PR safety.

Give decision options/consequences/recommendation. Use observed events/fixes/counts/heads.

## Статус ревью при наличии PR

Use `templates/ship-output.md`: actual reviewer/finding/fix/thread/CI evidence, full boundary.

## Review timeline

Review timeline: actual feedback rounds only—pre-ship review/scope, docs/head, CI/head, findings/classes, fixes/commit or none, rechecked reviewer/threads/merge, certificate/head. No invented events; zero findings means shorter timeline.
