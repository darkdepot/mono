---
name: mono-implement
description: Use when starting or running implementation from approved Linear Issue(s) after handoff.
---

# Mono Implement

Own Delivery Start/code; next preflight. Read `.agents/mono-workflow.config.json` for team/language/roots/workflows; ship owns PR, deploy delivery/closeout.

Read first:

Read now:

1. `AGENTS.md`
2. `references/worker-contract.md`
3. `references/readiness-gates.md`
4. `references/human-friendly-output.md`

Read when:

- `references/questioning.md` — when asking interactive questions.
- `references/issue-only-lane.md` — when the seam is `lifecycle_state_entity=issue`, or a lane park, freeze, or exit is in play.
- `skills/mono-preflight/SKILL.md` — when exiting `implemented-needs-preflight`.

Gather package/resources/comments/intake/approval/review/checks/config, repo validation/conventions, git/base. No discovery/review/local-plan/chat-only start.

Before work/resume run `verify-pack-state.mjs identity` with dispatch `packVersion`, `sourceCommit`, `surfaceRevision`; mismatch blocks code/lifecycle.

Workflow states:

1. `start-checkpoint`: dispatch uses branch below. Interactively fetch/validate Issues, explicit start approval, handoff disposition and seam; confirm prerequisites, then lane-ordered lifecycle/delivery check. Inspect git/use safe branch when needed. Consult `gstack-learnings-search --limit 10` (optional scoped --query/--type); unavailable/none is advisory and recorded. Record start comment.
2. `execute`: select engine; implement approved one PR only unless Issue allows parallel slices. Discovery stays closed unless artifacts missing/contradictory. Ask only blocking product/UX/business/access/dirty/risk decisions (mailbox under dispatch); validate incrementally. Material drift → scope-drift-needs-handoff.
3. `exit`: one status, files/checks/unrun/git/drift/comment/next; every Issue verification line in worker-contract verification_items. Never omit/pass skipped checks. Russian exit comment for blocked/needs-human/drift; no extra success comment.

## Orchestration branch of `start-checkpoint`

Apply worker-contract precedence.

1. Run exact dispatch identity command; mismatch/nonzero = `blocked`.
2. Use snapshot package, decisions and approvals.
3. Verify approved Issue, explicit start approval and resolved/accepted/deferred handoff findings. Missing field = `blocked`.
4. Resolve Context-seam branch from snapshot. Missing input = `blocked`, no move. Move-carrying dispatch: run handshake now; issue-only delivery check runs before ack. Write ack and stop under that protocol.
5. After resume re-run identity; require applied-move amendment/read-back. No-move dispatch needs current snapshot. No lifecycle/redundant moves:
   - Project-first: require visible Project Delivery; evaluate/report delivery check now against amended state or already-Delivery no-move snapshot.
   - Issue-only: confirm started-state amendment and earlier pre-ack delivery verdict. No-move retry requires already-started state and re-evaluation of the same Issue inputs. Non-PASS is `needs-human`; missing inputs `blocked`, before code; neither authorizes successful ack/move.
   In `notes`, name snapshot state, verdict and run/report arm. Queue only other permitted mutations; disclose lag, never defer checks or claim writes applied.
6. Use dispatched worktree/branch.
7. Consult advisory learnings; report unavailable/none.
8. Queue required implementation-start comment in `linear_mutations_pending`.
9. No interactive approval prompt; missing approval = `blocked`.

## Context-seam branch at Delivery Start

Apply Context seam in `references/worker-contract.md` before lifecycle change. Project-first: obtain start approval, move Project to Delivery, run/report `mono-check delivery`, record start comment. Missing prerequisites park/restart; integrity errors → needs-human.

Fresh issue-only order: authenticated fingerprint approval is start authorization, no second approval; require pre-start delivery PASS, otherwise needs-human; move only Issue to configured started/in-progress; record lifecycle/fingerprint/oracle IDs/engine/verification in start comment; implement oracle's one PR, then preflight. Scope/topology/risk outside lane before code requires parking, superseding marker approval and restarting Project-first, never retrofitting Project/docs onto parked Issue.

Implementation-start approval UX:

Separate package/start approval. Require explicit implementation/Issue-key authorization; bundled handoff start approval counts, never re-ask. Ambiguity does not count; issue-only uses fresh authenticated fingerprint approval.

Required prompt shape:

```text
Пакет утверждён. Теперь отдельное решение — старт реализации.

Что это разрешает: Project переходит в Delivery, создаётся ветка, агент пишет код по <Issue keys>.
Чего это НЕ разрешает: PR, merge и deploy — они потребуют отдельных шагов.

1. Стартовать сейчас — рекомендую, если scope финален.
2. Отложить — пакет останется утверждённым, старт можно дать позже любой фразой "запускай реализацию".
```

Implementation engine selection:

Use configured `Implementation workflow`; absent/`None`, choose: Compound `ce-work` for general Issue/plan work; Superpowers `executing-plans` for a concrete approved plan without rediscovery, `test-driven-development` for encodable acceptance/repro, `systematic-debugging` for bug/perf repro loops, `subagent-driven-development` only for independent slices with explicit file/surface boundaries; gstack `qa` after implementation when browser/product/manual verification dominates. AFK no-subworker rule still applies. Unavailable skill: execute under this skill and `references/execution-quality.md`; record substitution in notes.

Exit statuses: `implemented-needs-preflight`, `blocked`, `scope-drift-needs-handoff`, `needs-human` under worker contract. Never create PRs or run/claim `mono-review pre-ship` / `mono-check pre-ship`. Use configured comment language, Russian default; tiny follows `references/readiness-gates.md`.

Implementation-start comment shape:

```text
Начал реализацию по <Issue keys>.

Проверил: <Project, PRD, Tech Spec, Issue, approval/review/check state>.
Делаю строго по утверждённому Issue; ничего сверх scope не добавляю.
Объем: <approved one-PR slice>.
Workflow реализации: <configured workflow or default selection and why>.
План проверки: <targeted tests/checks/manual surfaces expected later>.
Учтённые learnings: <none|ключи|helper unavailable>.
Пока не проверено: <browser/manual/PR review/deploy/etc.>.
```

Final: status, Issue IDs, sources, branch/dirty/committed, files, checks run/unrun, drift, comment outcome, next owner (preflight).
