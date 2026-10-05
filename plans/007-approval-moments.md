> Archived: completed implementation plan. Current rules are in the skills and references; do not execute this historical checklist.

# Plan 007: Specify the two undefined approval moments (implementation start, deploy)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 889742b..HEAD -- skills/mono-implement/SKILL.md skills/mono-handoff/SKILL.md skills/mono-deploy/SKILL.md references/questioning.md scripts/project-config.mjs scripts/validate-workflow.mjs references/install.md references/install.md`
> On any mismatch with the "Current state" excerpts, treat as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: human-ux / safety
- **Planned at**: commit `889742b`, 2026-06-11

## Why this matters

The workflow's two most consequential human moments are under-specified:

1. **Implementation-start approval.** The workflow distinguishes package
   approval (handoff) from implementation-start approval (implement), but only
   the first has a specified prompt. Handoff's option «2. Зафиксировать пакет
   и сразу после readiness gate начать реализацию» silently grants BOTH
   approvals in one tap, without telling the operator that the second, more
   consequential gate (Project moves to Delivery, branch created, code
   written) was just passed. When mono-implement asks for start approval on
   its own, no wording, options, or authorizes/doesn't-authorize boundary is
   defined — an agent can infer approval from an ambiguous «ну давай».
2. **Deploy approval.** mono-deploy step 5 says "if deploy requires explicit
   user approval and no approval is recorded, stop with needs-human" — but
   nothing defines WHEN deploy requires approval, where approval is recorded,
   or what the ask looks like. questioning.md's per-stage list stops at
   mono-ship and omits mono-deploy entirely. The green certificate ends
   with `Next: mono-deploy`, so a chained or fresh agent can merge to
   production unattended through the fail-open conditional. This is the only
   production-irreversible step in the workflow.

## Current state

All excerpts verified at commit `889742b`.

- `skills/mono-implement/SKILL.md:50-59` — `start-checkpoint` requires
  "Verify or obtain explicit implementation-start approval" with no prompt
  shape. Line 92: "Do not treat package approval as implementation-start
  approval unless that approval is explicit."
- `skills/mono-handoff/SKILL.md:107-110` — the «Что делаем?» options:

  ```text
  1. Зафиксировать пакет в Linear и остановиться перед кодом. Рекомендую, если хочешь сначала увидеть durable PRD/Spec/Issue.
  2. Зафиксировать пакет и сразу после readiness gate начать реализацию.
  3. Поправить пакет перед записью.
  ```

  Option 2 does not say it also grants the second approval. Line 190:
  "Do not treat package approval as implementation-start approval unless the
  user explicitly approved starting implementation from the created Issue(s)."
- `skills/mono-deploy/SKILL.md:32` — `5. approve: if deploy requires
  explicit user approval and no approval is recorded, stop with needs-human.`
  Nothing defines the trigger, the record location, or the ask shape. Line 75
  defines `needs-human` as including "explicit deploy approval".
- `references/questioning.md:14-21` — "Question stages" lists mono-idea,
  mono-handoff, mono-review, mono-implement, mono-preflight,
  mono-ship. **No mono-deploy line.**
- `scripts/project-config.mjs` — config schema includes `workflows.*`,
  `linearTeam`, `languages`, `artifactRoots`, `prerequisites.autoreviewHelper`.
  No deploy-approval policy field. Config docs: `references/install.md:80-130`,
  `references/install.md:60-115`.
- Validator: `validateAntiPatterns` pins implement strings at
  `scripts/validate-workflow.mjs:489-501` (including
  `Move the Project to Delivery only after approval and prerequisites are explicit`)
  and deploy strings at 526-537. Additive edits are safe.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Full validation | `node scripts/validate-workflow.mjs` | exit 0 |
| Artifact smoke | `node scripts/lint-mono-artifacts.mjs` | exit 0 |
| Config script check | `node --check scripts/project-config.mjs` | exit 0 |

## Scope

**In scope**:
- `skills/mono-implement/SKILL.md`, `skills/mono-handoff/SKILL.md`,
  `skills/mono-deploy/SKILL.md`
- `references/questioning.md`
- `scripts/project-config.mjs` + `references/install.md` +
  `references/install.md` (new optional config field, documented)
- `scripts/validate-workflow.mjs` (new pins; update its project-config
  fixtures if the new field is required — prefer optional)
- `plans/README.md` (status row)

**Out of scope**:
- Output templates (plans 005/006).
- The ship stage's own approval moments (already specified in
  ship-feedback-loop.md).
- Making deploy approval interactive-blocking for `tiny` risk when the user
  explicitly invoked `/mono-deploy` themselves — see design decisions below.

## Git workflow

- Branch: current worktree branch, or `advisor/007-approval-moments`.
- Commit style: `feat: specify implementation-start and deploy approval moments`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Implementation-start approval prompt in mono-implement

Add a subsection `Implementation-start approval UX:` after "Workflow states"
with: this is the SECOND approval (package approval was the first); the
required Russian prompt shape mirroring handoff's decision-options style:

```text
Пакет утверждён. Теперь отдельное решение — старт реализации.

Что это разрешает: Project переходит в Delivery, создаётся ветка, агент пишет код по <Issue keys>.
Чего это НЕ разрешает: PR, merge и deploy — они потребуют отдельных шагов.

1. Стартовать сейчас — рекомендую, если scope финален.
2. Отложить — пакет останется утверждённым, старт можно дать позже любой фразой "запускай реализацию".
```

Add a rule: do not infer start approval from ambiguous phrases; the approval
must name implementation or the Issue.

**Verify**: `node scripts/validate-workflow.mjs` → exit 0.

### Step 2: Label the bundled approval in handoff's options

In `skills/mono-handoff/SKILL.md:107-110`, extend option 2 with an explicit
marker: `2. Зафиксировать пакет и сразу начать реализацию — это одновременно
approval на старт кода (Project уйдёт в Delivery, появится ветка).` Add one
sentence to "Draft package approval UX": every option must say which
approval(s) it grants.

**Verify**: `node scripts/validate-workflow.mjs` → exit 0 (the lint pin
`Run a content-shape review on the package` and others are untouched).

### Step 3: Deploy-approval policy

a. `scripts/project-config.mjs`: add an OPTIONAL config field
   `deployApproval` with allowed values `"always" | "risky-only" | "never"`,
   default when absent: `"always"`. Follow the existing field validation
   pattern (see how `workflows` values are validated in the same file); update
   the written config template so new configs include
   `"deployApproval": "always"`.
b. `skills/mono-deploy/SKILL.md`: replace the vague step 5 with a defined
   gate: read `deployApproval` from config (absent → `always`); `always` →
   require a recorded approval for every deploy; `risky-only` → require it for
   `standard`/`deep`/`risky` risk classes; `never` → proceed (still report).
   Approval is recorded as a Russian Linear comment on the Issue
   («Деплой одобрен: <кем/когда>») or given explicitly in the current session;
   a fresh agent must be able to recover it from Linear. Define the ask shape:

   ```text
   Готов деплоить <Issue key>: PR #<n> merge в <target>.
   Что произойдёт: <merge/deploy путь, среда>. Откат: <как откатить>.
   1. Деплоим — рекомендую: ревью и CI зелёные.
   2. Подождать — PR останется готовым, ничего не произойдёт.
   ```

c. `references/questioning.md`: add the missing stage line:
   `- `mono-deploy`: ask only for deploy approval per the configured
   deploy-approval policy, or a delivery-policy/risk-acceptance decision.`
d. Document the field in `references/install.md` (config fields list,
   ~line 80-90) and `references/install.md` (config example + field list,
   keeping the JSON examples valid).

**Verify**: `node --check scripts/project-config.mjs` → exit 0.
**Verify**: `node scripts/validate-workflow.mjs` → exit 0 — note its
`validateProjectConfigBehavior` fixtures write and check a config; if the new
field is optional with a default, existing fixtures pass unchanged. If you
made it required, the fixtures fail — make it optional (that is the design
decision; do not change the fixtures to force requiredness).

### Step 4: Pin the new contract

In `scripts/validate-workflow.mjs` `validateAntiPatterns`, add pins:
implement — `Implementation-start approval UX:` and one line of the prompt
shape; handoff — `это одновременно approval на старт кода`; deploy —
`deployApproval` and one line of the ask shape. In the docs check, pin the new
questioning.md deploy line (`references/questioning.md` is not currently in
`validateDocsAndExamples` — add an entry).

**Verify**: `node --check scripts/validate-workflow.mjs` → exit 0.
**Verify**: `node scripts/validate-workflow.mjs` → exit 0.

### Step 5: Full suite

**Verify**: `node scripts/lint-mono-artifacts.mjs` → exit 0;
`node scripts/validate-workflow.mjs` → exit 0. If plan 001 landed:
`node scripts/verify.mjs` → exit 0.

## Test plan

Validator pins (Step 4) are the regression layer. For project-config: the
existing temp-dir fixture in `validateLocalInstallBehavior`/`validateProjectConfigBehavior`
already round-trips a config; add one assertion there that a config written by
`--write` contains `"deployApproval"` (follow the existing
`config.workflows.ship !== "gstack ship"` assertion pattern at
validate-workflow.mjs:355).

## Done criteria

- [ ] mono-implement contains the start-approval prompt shape (Russian) and the no-inference rule
- [ ] handoff option 2 names the bundled approval
- [ ] mono-deploy step 5 reads `deployApproval` with `always` default and defines the ask + record shape
- [ ] questioning.md has a `mono-deploy` stage line
- [ ] `node scripts/project-config.mjs --repo <tmp> --write` produces a config containing `deployApproval` (covered by the validator fixture)
- [ ] `node scripts/validate-workflow.mjs` exits 0; `node scripts/lint-mono-artifacts.mjs` exits 0
- [ ] `git status --porcelain` only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- Making `deployApproval` work requires changing the config schemaVersion or
  breaking existing configs — stop; the field must be optional/defaulted.
- Any existing validator pin or fixture fails and the fix would mean weakening
  a pin — stop and report.
- You find an existing deploy-approval mechanism elsewhere (e.g. in the
  configured `gstack land-and-deploy` workflow) that this would duplicate —
  stop and report; the gate may belong at the wrapper level only.

## Maintenance notes

- The `deployApproval` default `always` is deliberately conservative: an
  unattended chained run stops before production. Teams that want hands-off
  deploys opt into `never` consciously, in their own config.
- Reviewer should scrutinize: the no-inference rule wording (it must not make
  the agent re-ask after a clear «да, запускай реализацию»).
- Deferred: an analogous explicit policy for merge-vs-deploy split targets
  (staging vs prod) — needs real config consumers first.
