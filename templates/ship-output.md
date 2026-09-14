# Ship Output Template

```text
<outcome/readiness/expiry/exact decision>
PR: [#<number>](<url>)
Linear Issue: `<key>` - <status>

Статус ревью:
- Preflight: <ready/blocked/drift-candidate/needs-human/not run>; <local readiness>.
- Кто/что ревьюил: <reviewers + run/skipped/not configured + outcome>.
- Documentation workflow: <run/skipped/not configured; head change/outcome>.
- Bug/perf proof: <not applicable or original symptom/baseline + fix proof + regression proof/gap>.
- Что нашли и что починили: <findings/fixes or none>.
- Нерешённые треды: <count/state>.

Проверки CI:
- <blocking check>: <state>.
- <other checks>: <state/non-blocking>.

Проверено:
- <inspected states>.
Не проверено:
- <unrun manual/browser/prod/mobile/deploy/acceptance or none known>.

Статус в Linear:
- <Issue/Project sync>.
- <comments/resources/status writes>.

Что дальше:
1. <recommended next step/consequence; green normally mono-deploy>.
2. <useful alternative/consequence>.
```

Optional logs/Linear summary:

```text
Mono ship verdict: <green|needs-human|blocked|timed-out>

PR:
Linear Issue:
Latest head SHA:
Phases run:
Rounds run:
Checks status:
Greptile status:
Review status:
Documentation workflow:
Resolver used:
Commits pushed:
Fixes applied: <none or concise list with commit SHA>
Merge state: <clean/blocked/conflict/unknown>
Unresolved feedback:
mono-ship green certificate: <recorded/not recorded + reason>
Next: <mono-deploy | needs-human | blocked>
Notes:
```

Verdicts:

Apply Verdict copy in `templates/ship-status-ux.md`.
