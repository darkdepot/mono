# Plan 011: mono-orchestrate control-plane skill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 90bab93..HEAD -- skills/ references/ templates/ scripts/validate-workflow.mjs README.md AGENTS.md references/lifecycle.md references/questioning.md`
> If any in-scope file changed since this plan was written, compare the
> "anchor" excerpts in each task against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

**Goal:** Add the `mono-orchestrate` control-plane skill (per the approved spec `docs/superpowers/specs/2026-06-11-mono-orchestrate-design.md`): one orchestrator session per product drives Linear projects/Issues through worker sessions, decides technical questions itself, and escalates only product decisions.

**Architecture:** Pure-markdown skill pack change. One new skill, one new reference, three new templates, doc updates, and validator registration. The validator (`scripts/validate-workflow.mjs`) is the test suite: every task first adds failing validator assertions, then writes the artifact until `node scripts/validate-workflow.mjs` passes. The installer (`scripts/install-local.mjs`) picks up new `skills/mono-*` dirs and `references/`/`templates/` files automatically — no installer changes.

**Tech Stack:** Markdown skills + Node validator scripts. No new dependencies.

## Status

DONE (final commit 48b1da6; fixes: a3e5780, 9f391e1, 917d5d6, 52fddb6).

## STOP conditions

- `node scripts/verify.mjs` fails at a step where this plan says it must pass.
- An Edit anchor (old_string) from this plan is not found verbatim in the live file — drift; stop and report.
- Any existing validator assertion starts failing for files this plan does not touch.
- You are tempted to change stage-skill ownership (e.g. give the orchestrator implement/ship behavior). Forbidden by AGENTS.md; stop and report instead.

## Conventions for all tasks

- Run commands from the repo root.
- Quick loop: `node scripts/validate-workflow.mjs`. Full gate before each commit: `node scripts/verify.mjs` (must print `Verification passed (8 checks).`).
- Skill instructions are English; user-facing template text is Russian (see AGENTS.md Language).
- Commit after each task with the exact message given.

---

### Task 1: references/orchestration.md (policy reference)

**Files:**
- Modify: `scripts/validate-workflow.mjs` (validateDocsAndExamples map)
- Create: `references/orchestration.md`

- [ ] **Step 1: Add failing validator assertions**

In `scripts/validate-workflow.mjs`, find this anchor inside the `validateDocsAndExamples` map:

```js
    "references/questioning.md": [
```

Insert immediately BEFORE that line:

```js
    "references/orchestration.md": [
      "## Roles",
      "## Stage Ownership",
      "## Decision Authority",
      "## Worker Transports",
      "## Mailbox And Ledger",
      "## Monitoring Protocol",
      "## Decision Briefs",
      "## Resume",
      "claude-code-desktop",
      "deployApproval",
      "any risk class except `tiny` under `risky-only`",
      "«Решил сам:»",
      "scope-drift-needs-handoff",
    ],
```

- [ ] **Step 2: Run validator to verify it fails**

Run: `node scripts/validate-workflow.mjs`
Expected: FAIL with `- Missing references/orchestration.md`

- [ ] **Step 3: Create `references/orchestration.md`**

Full content:

````markdown
# Orchestration Policy

Control-plane policy for `mono-orchestrate`. The orchestrator inspects,
delegates, monitors, decides or escalates, records, and reports. It never
implements stage work itself.

## Roles

- User: product decisions only — idea direction, scope, design, product risk,
  deploy approval per policy. Talks only to the orchestrator session.
- Orchestrator: one session per product; owns worker dispatch, monitoring, all
  Linear mutations during orchestration, technical decisions, deploy
  delegation, and the ledger.
- Workers: one Issue each; run `mono-implement` → `mono-preflight` →
  `mono-ship` sequentially in the same session and worktree under the AFK
  contract from `templates/orchestrator-dispatch.md`; they never write to
  Linear directly.

## Stage Ownership

| Stage | Runs in |
| --- | --- |
| `mono-idea`, discovery | orchestrator session, live with the user |
| `mono-handoff` | orchestrator session |
| `mono-implement`, `mono-preflight`, `mono-ship` | worker session |
| `mono-deploy` | orchestrator session |

Gate ordering from `references/lifecycle.md` is preserved verbatim. The
orchestrator sequences gates; it never skips, weakens, or replaces them, and
stage skills keep their ownership unchanged.

## Decision Authority

The user decides. Escalate immediately and interactively with a decision
brief (options + recommendation):

- Idea direction and scope: handoff package approval, Issue slicing, scope
  drift.
- Design and UX: always with prepared side-by-side variants (`/design-html`
  when the runtime provides it; concrete textual variants otherwise).
- Product risk: money, user data, irreversible production actions, external
  access.
- Deploy approval when the configured `deployApproval` policy requires it
  (`always`, or any risk class except `tiny` under `risky-only`; only `tiny`
  proceeds without asking).

The orchestrator decides itself and records every such decision in the ledger
under «Решил сам:» with a one-line reason:

- All technical and implementation questions from workers.
- Implementation start after package approval (recorded explicitly; the
  bundled-approval rule from `mono-implement` applies).
- Technical review-finding acceptance, CI repair, and PR stabilization
  routing.
- Merge/deploy for risk classes the configured `deployApproval` allows (all
  classes under `never`).

The user can override any recorded orchestrator decision later; reopen the
affected stage when that happens.

## Worker Transports

Three transport operations: spawn worker, continue worker, read worker
reports. Per-runtime bindings:

- `claude-code-desktop`: spawn via task chip with a self-contained dispatch
  prompt (one user click; the platform provides the worktree). Continue or
  steer via session message with user confirmation. Workers stay visible as
  normal sessions the user can open.
- `codex`: native thread creation and steering; no per-message confirmation.
- `fallback` (CLI/headless): named long-lived background subagents inside the
  orchestrator session; same contract and reporting.

Detect the runtime, state the chosen binding in the first status update, and
never block on a transport feature the runtime lacks.

## Mailbox And Ledger

- Root: `~/.mono-agent-workflow/orchestrator/<product>/` — never inside a
  project repo (project repos keep only `.agents/mono-workflow.config.json`).
- Reports: `reports/<ISSUE-KEY>-<stage>.json` per
  `templates/orchestrator-report.md`. Workers write reports; the orchestrator
  reads them instead of parsing worker transcripts.
- Ledger: `ledger.md` — dated, high-level entries: dispatches, «Решил сам:»
  decisions, user decisions, lands, deploys, exact blockers. Only the
  orchestrator writes the ledger.
- No secrets in either. No routine polling entries in the ledger.

## Monitoring Protocol

- Do not steer an actively progressing worker; do not raise the proof bar
  mid-flight; polling alone never justifies intervention.
- Intervene only on: a worker-reported question or blocker, exhausted work,
  repeated failures with no progress, gross divergence from the assigned
  Issue, or an unsafe mutation.
- Read the worker's latest state before any intervention or respawn.
- Stuck or dead worker: rebuild stage state from Linear plus the last mailbox
  report (the branch survives in the worktree) and respawn a worker to
  continue the stage, not restart the Issue.
- Material scope drift: stop the worker and escalate through
  `scope-drift-needs-handoff`; scope is always the user's decision.

## Decision Briefs

Never bring the user an unprepared question. Before asking:

1. Exhaust autonomous work; ask only when the question is the item's last
   blocker.
2. Prepare visual variants for design questions.
3. Refresh item state immediately before asking; never re-ask an answered
   question and never present a stale item as decision-ready.

Brief contents per `templates/orchestrator-brief.md`: what changes and for
whom, why the decision is needed now, completed proof (tests, autoreview, CI,
certificates as applicable), recommendation with rationale, exact options.
Ask immediately and interactively; unblocked work continues in parallel.

## Resume

A fresh orchestrator session rebuilds state without loss:

1. Read the project config; locate the mailbox root.
2. Scan Linear: projects in flight, Issue statuses, latest comments and
   certificates.
3. Read `ledger.md` and all mailbox reports; apply queued Linear mutations
   that were never applied.
4. List live worker sessions when the runtime allows it.
5. Output the rebuilt status table before taking any new action.
````

- [ ] **Step 4: Run validator to verify it passes**

Run: `node scripts/validate-workflow.mjs`
Expected: PASS — `Mono workflow validation passed (12 skills checked).`

- [ ] **Step 5: Full gate and commit**

Run: `node scripts/verify.mjs` — expected `Verification passed (8 checks).`

```bash
git add references/orchestration.md scripts/validate-workflow.mjs
git commit -m "feat: add orchestration policy reference for mono-orchestrate"
```

---

### Task 2: orchestrator templates (dispatch, brief, report)

**Files:**
- Modify: `scripts/validate-workflow.mjs` (validateTemplateSections map)
- Create: `templates/orchestrator-dispatch.md`
- Create: `templates/orchestrator-brief.md`
- Create: `templates/orchestrator-report.md`

- [ ] **Step 1: Add failing validator assertions**

In `scripts/validate-workflow.mjs`, find this anchor (the last entry of the
`requiredSections` object in `validateTemplateSections`):

```js
    "templates/check-output.md": [
      "Смысл:",
      "Чего не хватает:",
      "Расхождения:",
      "Следующий unblock:",
      "Нарушение контракта:",
      "Как починить:",
    ],
```

Insert immediately AFTER it (keep the trailing comma on the block above):

```js
    "templates/orchestrator-dispatch.md": [
      "## Assignment",
      "## Context Snapshot",
      "## AFK Contract",
      "## Mailbox",
      "## Authorization",
      "Do not ask the user",
      "Never write to Linear yourself",
      "no sub-workers",
    ],
    "templates/orchestrator-brief.md": [
      "Что решаем:",
      "Почему сейчас:",
      "Что уже доказано:",
      "Рекомендация:",
      "Решил сам:",
      "Нужно от тебя:",
    ],
    "templates/orchestrator-report.md": [
      "\"issue\"",
      "\"stage\"",
      "\"status\"",
      "\"question\"",
      "\"recommendation\"",
      "\"linear_mutations_pending\"",
      "needs-decision",
      "needs-human",
      "drift-candidate",
      "## Ledger Entry",
    ],
```

- [ ] **Step 2: Run validator to verify it fails**

Run: `node scripts/validate-workflow.mjs`
Expected: FAIL with three lines, including `- Missing template: templates/orchestrator-dispatch.md`

- [ ] **Step 3: Create `templates/orchestrator-dispatch.md`**

Full content:

````markdown
# Worker Dispatch Prompt

Template for spawning one worker session per Issue from `mono-orchestrate`.
Fill every placeholder. The worker must be able to start immediately with no
Linear access: the snapshot below is its whole world until Linear MCP is up.

## Assignment

- Issue: <ISSUE-KEY> — <title>
- Stage skill: <mono-implement | mono-preflight | mono-ship>
- Worktree/branch: <path / branch>
- Worker session name: `<ISSUE-KEY>: <stage>`
- Chip title (user-visible, Russian): `<ISSUE-KEY>: <стадия по-русски>`

## Context Snapshot

- Project brief: <full text>
- PRD: <full text, or the sections relevant to this Issue>
- Tech Spec: <full text, or the contracts relevant to this Issue>
- Issue: <full Issue body, verbatim>
- Decisions so far: <user decisions and «Решил сам:» entries relevant to this
  Issue, one line each>

## AFK Contract

- Do not ask the user. For a mid-stage question that blocks progress: write a
  mailbox report with status `needs-decision`, include your own
  recommendation, and stop. Report stage-terminal exits (including
  `needs-human` and `drift-candidate`) with the stage's own status verbatim.
- One Issue only; no sub-workers; do not manage other sessions; do not touch
  files owned by other Issues.
- Never write to Linear yourself, even when Linear is available. Produce
  every stage-required Linear mutation (comments, status moves, certificates)
  in its required shape, but deliver it through `linear_mutations_pending` in
  your report; the orchestrator applies it.
- Follow the stage skill exactly, including its exit statuses and gates.

## Mailbox

- Write the exit report to
  `~/.mono-agent-workflow/orchestrator/<product>/reports/<ISSUE-KEY>-<stage>.json`
  following `templates/orchestrator-report.md`.
- Write the report on stage completion, on any blocker, and before stopping
  for any other reason.

## Authorization

- Allowed: <stage-appropriate scope, e.g. local code changes and verification;
  push and PR creation only for the ship stage>
- Not allowed: any direct Linear writes, merge, deploy, Issue closeout — the
  orchestrator owns those.
````

- [ ] **Step 4: Create `templates/orchestrator-brief.md`**

Full content:

````markdown
# Шаблоны оркестратора: бриф и статус

User-facing shapes for `mono-orchestrate`. User-visible text is Russian per
project config (`languages.linear`).

## Бриф решения (Decision Brief)

```text
Нужно твоё решение: <ISSUE-KEY или пакет> — <тип: scope | дизайн | риск | deploy>

Что решаем: <одно предложение в терминах продукта, не реализации>
Почему сейчас: <что именно блокируется этим решением>
Что уже доказано: <тесты, autoreview, CI, сертификаты — что применимо>
Рекомендация: <вариант> — <одна строка почему>

Варианты:
1. <вариант A> — рекомендую
2. <вариант B>
3. <свой ответ>
```

Package-approval briefs: include an option that explicitly bundles
implementation start («это одновременно approval на старт кода») so the
bundled-approval rule from `mono-implement` applies and the orchestrator
does not re-ask before dispatching workers.

Design questions: prepare side-by-side variants first (`/design-html` when the
runtime provides it), open them, then ask. Never decide visual questions
silently and never ask them text-only when the difference is visual.

## Статус (Status Update)

```text
Статус (<продукт>, <N> задач):
- <ISSUE-KEY> — <стадия> — <одна строка состояния>

Решил сам: <решения с прошлого апдейта, по строке с причиной, или «ничего»>
Нужно от тебя: <брифы по форме выше, или «нет»>
Воркеры: <spawned/advanced/respawned, или «без изменений»>
Linear: <применённые мутации и сертификаты, или «без изменений»>
```
````

- [ ] **Step 5: Create `templates/orchestrator-report.md`**

Full content:

````markdown
# Worker Report And Ledger Shapes

Machine-facing shapes for the `mono-orchestrate` mailbox. The worker report
JSON is English only. Ledger entries are English except the fixed domain term
«Решил сам:» / `решил сам` from `references/orchestration.md`. No secrets in
either shape.

## Worker Report

Path: `~/.mono-agent-workflow/orchestrator/<product>/reports/<ISSUE-KEY>-<stage>.json`

```json
{
  "issue": "<ISSUE-KEY>",
  "stage": "<mono-implement | mono-preflight | mono-ship>",
  "status": "<implemented-needs-preflight | ready | green | blocked | needs-decision | needs-human | drift-candidate | timed-out | scope-drift-needs-handoff>",
  "branch": "<branch>",
  "changed_files": ["<path>"],
  "tests": { "run": "<commands>", "result": "<outcome>" },
  "question": "<question text, or null>",
  "recommendation": "<the worker's own recommended answer, or null>",
  "linear_mutations_pending": ["<comment/status text the worker could not apply>"],
  "certificate": "<preflight certificate or mono-ship green certificate text, or null>",
  "next": "<mono-preflight | mono-ship | mono-deploy | null>"
}
```

Status semantics:

- Stage-terminal statuses reuse the stage skill's exit statuses verbatim:
  `implemented-needs-preflight` (implement), `ready` (preflight), `green`
  (ship green certificate), `blocked`, `needs-human`, `drift-candidate`
  (preflight), `timed-out` (ship), `scope-drift-needs-handoff`. Report the
  stage's own status — the orchestrator decides whether to answer, escalate
  to the user, or respawn.
- `needs-decision` is mailbox-only: the worker is paused mid-stage on a
  question and has included its own recommendation. The orchestrator answers
  (technical) or escalates (Always-ask) and then continues the same worker.

## Ledger Entry

Path: `~/.mono-agent-workflow/orchestrator/<product>/ledger.md`

```text
## <YYYY-MM-DD>
- <HH:MM> <ISSUE-KEY> dispatched: <stage>, worker `<ISSUE-KEY>: <stage>`
- <HH:MM> <ISSUE-KEY> решил сам: <decision> (<one-line reason>)
- <HH:MM> <ISSUE-KEY> user decision: <decision>
- <HH:MM> <ISSUE-KEY> landed/deployed: <PR/SHA + evidence>
- <HH:MM> blocker: <exact blocker and what is needed>
```

Only the orchestrator writes the ledger. Routine polling is never recorded.
````

- [ ] **Step 6: Run validator to verify it passes**

Run: `node scripts/validate-workflow.mjs`
Expected: PASS — `Mono workflow validation passed (12 skills checked).`

- [ ] **Step 7: Full gate and commit**

Run: `node scripts/verify.mjs` — expected `Verification passed (8 checks).`

```bash
git add templates/orchestrator-dispatch.md templates/orchestrator-brief.md templates/orchestrator-report.md scripts/validate-workflow.mjs
git commit -m "feat: add orchestrator dispatch, brief, and report templates"
```

---

### Task 3: skills/mono-orchestrate/SKILL.md + validator registration

**Files:**
- Modify: `scripts/validate-workflow.mjs` (EXPECTED_SKILLS + validateAntiPatterns)
- Create: `skills/mono-orchestrate/SKILL.md`

- [ ] **Step 1: Register the skill and add failing contract assertions**

Edit 1 — in `scripts/validate-workflow.mjs`, replace:

```js
  "mono-issue",
  "mono-preflight",
```

with:

```js
  "mono-issue",
  "mono-orchestrate",
  "mono-preflight",
```

Edit 2 — find this anchor at the end of `validateAntiPatterns`:

```js
  if (!idea.includes("BLOCKED / INCOMPLETE - mono-idea cannot complete because")) {
    fail("mono-idea blocked message must preserve English marker line");
  }
}
```

Replace it with:

```js
  if (!idea.includes("BLOCKED / INCOMPLETE - mono-idea cannot complete because")) {
    fail("mono-idea blocked message must preserve English marker line");
  }

  const orchestrate = read("skills/mono-orchestrate/SKILL.md");
  for (const required of [
    "control plane",
    "never implement, edit code, fix CI, or rewrite PRs",
    "Single Linear writer",
    "One Issue per worker",
    "no-sub-delegation",
    "scope-drift-needs-handoff",
    "Do not steer an actively progressing worker",
    "«Решил сам:»",
    "references/orchestration.md",
    "templates/orchestrator-dispatch.md",
    "templates/orchestrator-brief.md",
    "templates/orchestrator-report.md",
    "deployApproval",
    "Session verdicts:",
    "timed-out",
    "~/.mono-agent-workflow/orchestrator/<product>/",
    "`mono-implement` owns Delivery Start",
  ]) {
    if (!orchestrate.includes(required)) fail(`mono-orchestrate contract missing: ${required}`);
  }
}
```

- [ ] **Step 2: Run validator to verify it fails**

Run: `node scripts/validate-workflow.mjs`
Expected: exits non-zero. The failure list must include `- Missing expected core skill: mono-orchestrate` (the `read()` call for the missing SKILL.md may also throw — either failure mode is acceptable evidence here).

- [ ] **Step 3: Create `skills/mono-orchestrate/SKILL.md`**

Full content:

````markdown
---
name: mono-orchestrate
description: Use when running a long-lived product orchestrator session that drives Linear projects and Issues through the workflow with delegated worker sessions.
---

# Mono Orchestrate

Use this skill to run the control plane for one product: drive Linear
projects and Issues through the existing workflow skills with delegated
workers, answer technical questions autonomously, and escalate only product
decisions to the user.

`mono-orchestrate` never does stage work itself. It inspects, delegates,
monitors, decides or escalates, records, and reports. Stage ownership is
unchanged: `mono-implement` owns Delivery Start, `mono-preflight` owns
local readiness, `mono-ship` owns the PR lifecycle, `mono-deploy` owns
merge/deploy and closeout.

Read first:

1. `AGENTS.md`
2. `references/orchestration.md`
3. `references/lifecycle.md`
4. `references/questioning.md`
5. `references/readiness-gates.md`
6. `references/human-friendly-output.md`
7. `templates/orchestrator-dispatch.md`
8. `templates/orchestrator-brief.md`
9. `templates/orchestrator-report.md`

When to use:

- The user starts or resumes an orchestrator session for a product («веди
  проекты», "orchestrate", "resume orchestration").
- Several Issues or projects must move in parallel without the user
  dispatching stages by hand.
- A previous orchestrator session ended and durable state must be rebuilt.

Do not use:

- For doing stage work directly; route it through workers or run the
  orchestrator-owned stages per the Stage Ownership table in
  `references/orchestration.md`.
- As a worker or subagent; workers must not orchestrate.
- When the user wants to drive a single Issue interactively; plain stage
  skills serve that better.

Inputs to gather:

- Project config `.agents/mono-workflow.config.json`: product name,
  configured workflows, `deployApproval`.
- Fresh Linear state: projects in flight, Issue statuses, latest comments and
  certificates.
- Orchestrator state on disk under
  `~/.mono-agent-workflow/orchestrator/<product>/`: ledger and mailbox
  reports.
- Runtime transport binding per `references/orchestration.md` Worker
  Transports.
- Live worker sessions via the runtime session list when available.

Workflow states:

1. `resume`
   - Rebuild the full picture from Linear + ledger + mailbox + live session
     list before any action (Resume procedure in
     `references/orchestration.md`).
   - Apply queued Linear mutations from worker reports that were never
     applied.
   - Output the rebuilt status table before taking new actions.
2. `intake-and-discovery`
   - Run `mono-idea` and discovery dialogue directly in this session, live
     with the user. Scope and design belong to the user.
3. `handoff`
   - Run `mono-handoff` in this session. Bring the user one
     package-approval decision brief per `templates/orchestrator-brief.md`.
   - After package approval, implementation start is the orchestrator's own
     decision; record it explicitly (the bundled-approval rule from
     `mono-implement` applies).
4. `dispatch`
   - One Issue per worker. Spawn through the runtime transport with
     `templates/orchestrator-dispatch.md`: full context snapshot, AFK
     contract, mailbox path, authorization. Include the no-sub-delegation
     rule in every dispatch prompt.
   - Respect Issue dependencies; queue dependents until their blockers
     report done.
   - Name workers `<ISSUE-KEY>: <stage>`.
5. `monitor`
   - Poll the mailbox cheaply; read reports; advance the same worker session
     to the next stage (`mono-implement` → `mono-preflight` →
     `mono-ship`).
   - Follow the Monitoring Protocol in `references/orchestration.md`. Do not
     steer an actively progressing worker.
   - Route non-green reports (`blocked`, `needs-human`, `drift-candidate`,
     `needs-decision`, `scope-drift-needs-handoff`) to `decide-or-escalate`
     instead of advancing.
   - On `timed-out`: treat as a stuck worker; rebuild stage state from Linear
     and the last mailbox report and respawn per the Monitoring Protocol.
6. `decide-or-escalate`
   - Technical questions: decide, record in the ledger under «Решил сам:»
     with a one-line reason, answer the worker.
   - Always-ask questions (scope, design/UX, product risk, deploy approval
     per policy): escalate immediately and interactively with a decision
     brief. Design questions require prepared visual variants first.
7. `deploy-and-closeout`
   - When a worker reports `green` (mono-ship green certificate), run
     `mono-deploy` from this session per the configured Deploy workflow
     and `deployApproval` policy.
   - Record ledger entries; verify Linear closeout happened per stage skill
     contracts.

Rules:

- This skill is a control plane: never implement, edit code, fix CI, or
  rewrite PRs in this session; delegate that to workers.
- Single Linear writer: all Linear mutations during orchestration happen in
  this session; workers never write to Linear and queue every stage-required
  mutation in their reports.
- Never skip or weaken lifecycle gates; the orchestrator sequences gates, it
  does not replace them.
- Never ask the user an unprepared question; exhaust autonomous work first
  and refresh item state immediately before asking (Decision Briefs policy).
- Workers must not spawn sub-workers or manage other sessions; the
  no-sub-delegation rule goes into every dispatch prompt.
- One Issue per worker; the worker keeps its session and worktree across
  stages to preserve context.
- On material drift, stop the worker and escalate:
  `scope-drift-needs-handoff` routes through `mono-handoff` with the user.
- A stuck or dead worker is respawned from Linear plus the last mailbox
  report; continue the stage, do not restart the Issue.
- Keep the ledger free of secrets and routine polling entries.
- Keep user-facing output in the project config language (Russian by
  default); ledger and mailbox stay English except the fixed «Решил сам:»
  term.

Session verdicts:

- `active`: work in flight; status updates continue.
- `needs-human`: an Always-ask decision blocks all remaining progress;
  waiting on the user.
- `blocked`: orchestration cannot continue (Linear, config, or worker state
  unrecoverable); exact blocker reported.
- `idle`: every active Issue is deployed and closed; awaiting new work.

Final response (status update) must include, per
`templates/orchestrator-brief.md`:

- Status table: each active Issue with stage and one-line state.
- «Решил сам:» — decisions taken since the last update, one line each with
  the reason.
- «Нужно от тебя:» — decision briefs, or «нет».
- Workers: spawned/advanced/respawned since the last update.
- Linear: mutations applied and certificates recorded.
````

- [ ] **Step 4: Run validator to verify it passes**

Run: `node scripts/validate-workflow.mjs`
Expected: PASS — `Mono workflow validation passed (13 skills checked).` (count goes 12 → 13)

- [ ] **Step 5: Full gate and commit**

Run: `node scripts/verify.mjs` — expected `Verification passed (8 checks).`

```bash
git add skills/mono-orchestrate/SKILL.md scripts/validate-workflow.mjs
git commit -m "feat: add mono-orchestrate control-plane skill"
```

---

### Task 4: questioning.md and lifecycle.md updates

**Files:**
- Modify: `scripts/validate-workflow.mjs` (validateAntiPatterns, end of the orchestrate block)
- Modify: `references/questioning.md`
- Modify: `references/lifecycle.md`

- [ ] **Step 1: Add failing validator assertions**

In `scripts/validate-workflow.mjs`, find the closing of the orchestrate block added in Task 3:

```js
    if (!orchestrate.includes(required)) fail(`mono-orchestrate contract missing: ${required}`);
  }
}
```

Replace with:

```js
    if (!orchestrate.includes(required)) fail(`mono-orchestrate contract missing: ${required}`);
  }
  assertIncludes("references/questioning.md", "`mono-orchestrate`: ask only for Always-ask escalations");
  assertIncludes("references/questioning.md", "## Orchestrated Mode");
  assertIncludes("references/lifecycle.md", "## Orchestration");
}
```

- [ ] **Step 2: Run validator to verify it fails**

Run: `node scripts/validate-workflow.mjs`
Expected: FAIL with three `references/... missing ...` lines.

- [ ] **Step 3: Update `references/questioning.md`**

Edit 1 — replace the `Question stages:` lead-in line with `Question stages (worker note: under \`mono-orchestrate\` dispatch, the \`## Orchestrated Mode\` section below overrides every per-stage line — route questions to the orchestrator mailbox, never to the user):` — then, in the `Question stages:` list, replace:

```markdown
- `mono-implement`: ask only for implementation-start approval or a blocker involving product, UX, business, external access, dirty worktree, or risk acceptance.
```

with:

```markdown
- `mono-implement`: ask only for implementation-start approval or a blocker involving product, UX, business, external access, dirty worktree, or risk acceptance.
- `mono-orchestrate`: ask only for Always-ask escalations (scope, design/UX, product risk, deploy approval per the configured policy); answer worker technical questions autonomously and record them under «Решил сам:».
```

Edit 2 — append at the end of the file (after the `Output:` list):

```markdown

## Orchestrated Mode

When a stage skill runs inside a worker dispatched by `mono-orchestrate`:

- The worker never asks the user. Every question becomes a mailbox report
  with the worker's own recommendation (`needs-decision`).
- The orchestrator answers technical questions itself and records them under
  «Решил сам:» in the ledger.
- Always-ask questions still reach the user — through the orchestrator,
  immediately and interactively, as a prepared decision brief. The Always-ask
  list above is unchanged; only the routing changes.
```

- [ ] **Step 4: Update `references/lifecycle.md`**

Append at the end of the file (after the `## Deploy` section):

```markdown

## Orchestration

Optional mode: `mono-orchestrate` runs one control-plane session per
product and sequences the stages above through delegated workers.

Required:

- Gate ordering of this lifecycle preserved verbatim.
- `mono-idea`, discovery, `mono-handoff`, and `mono-deploy` run in the
  orchestrator session; `mono-implement`, `mono-preflight`, and
  `mono-ship` run in one worker session per Issue.
- All Linear mutations during orchestration flow through the orchestrator
  (single writer); workers never write to Linear and queue stage-required
  mutations in mailbox reports.
- Always-ask decisions (scope, design, product risk, deploy per policy) reach
  the user as immediate decision briefs.

Forbidden:

- Skipping or weakening any gate above because an orchestrator is present.
- The orchestrator performing implement/preflight/ship work itself.
- Workers orchestrating: spawning sub-workers or managing other sessions.
- Moving stage ownership: Delivery Start stays with `mono-implement`, PR
  lifecycle with `mono-ship`, merge/deploy and closeout with
  `mono-deploy`.
```

- [ ] **Step 5: Run validator to verify it passes**

Run: `node scripts/validate-workflow.mjs`
Expected: PASS — `Mono workflow validation passed (13 skills checked).`

- [ ] **Step 6: Full gate and commit**

Run: `node scripts/verify.mjs` — expected `Verification passed (8 checks).`

```bash
git add references/questioning.md references/lifecycle.md scripts/validate-workflow.mjs
git commit -m "docs: route questioning and lifecycle through orchestrated mode"
```

---

### Task 5: README.md and AGENTS.md updates

**Files:**
- Modify: `scripts/validate-workflow.mjs` (validateAntiPatterns, end of the orchestrate block)
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add failing validator assertions**

Find the lines added in Task 4 Step 1:

```js
  assertIncludes("references/lifecycle.md", "## Orchestration");
}
```

Replace with:

```js
  assertIncludes("references/lifecycle.md", "## Orchestration");
  assertIncludes("README.md", "`mono-orchestrate`: control-plane orchestrator");
  assertIncludes("AGENTS.md", "`mono-orchestrate` = product-level control plane");
}
```

- [ ] **Step 2: Run validator to verify it fails**

Run: `node scripts/validate-workflow.mjs`
Expected: FAIL with two `... missing ...` lines for README.md and AGENTS.md.

- [ ] **Step 3: Update `README.md`**

Edit 1 — in the `## Skills` list, replace:

```markdown
- `mono-deploy`: wrapper around configured project deploy, post-ship check, Linear closeout, and learning capture workflows.
```

with:

```markdown
- `mono-deploy`: wrapper around configured project deploy, post-ship check, Linear closeout, and learning capture workflows.
- `mono-orchestrate`: control-plane orchestrator session per product; drives projects and Issues through worker sessions, decides technical questions itself, escalates only product decisions (scope, design, risk).
```

Edit 2 — at the end of the `## Workflow` section (after the `/mono-deploy` block), append:

```markdown

Orchestrated mode (optional):

```text
/mono-orchestrate (one session per product)
-> resume state from Linear + ledger + mailbox
-> run idea/discovery/handoff with the user in-session
-> dispatch one worker per Issue (implement -> preflight -> ship)
-> answer technical questions; escalate scope/design/risk as decision briefs
-> run mono-deploy per deployApproval policy
```
```

Edit 3 — note: README edit 2 nests a ```text block inside the markdown you are
writing; keep the outer structure of README intact (it already uses ```text
blocks at the top level, so no extra fencing is needed in the actual file).

- [ ] **Step 4: Update `AGENTS.md`**

Edit 1 — in `## Source Of Truth`, replace:

```markdown
- `mono-deploy` = deploy workflow delegation, verified delivery evidence, post-ship check, Linear closeout, and durable learning capture.
```

with:

```markdown
- `mono-deploy` = deploy workflow delegation, verified delivery evidence, post-ship check, Linear closeout, and durable learning capture.
- `mono-orchestrate` = product-level control plane: worker dispatch, monitoring, decision routing, single Linear writer during orchestration; never does stage work itself.
```

Edit 2 — in `## Skill Design Rules`, replace:

```markdown
- Keep `mono-handoff`, `mono-implement`, `mono-preflight`, `mono-ship`, and `mono-deploy` ownership separate; do not collapse them into a monolithic delivery skill.
```

with:

```markdown
- Keep `mono-handoff`, `mono-implement`, `mono-preflight`, `mono-ship`, and `mono-deploy` ownership separate; do not collapse them into a monolithic delivery skill.
- Keep `mono-orchestrate` control-plane only: it sequences stages and routes decisions but never absorbs stage ownership or implements.
```

- [ ] **Step 5: Run validator to verify it passes**

Run: `node scripts/validate-workflow.mjs`
Expected: PASS — `Mono workflow validation passed (13 skills checked).`

- [ ] **Step 6: Full gate and commit**

Run: `node scripts/verify.mjs` — expected `Verification passed (8 checks).`

```bash
git add README.md AGENTS.md scripts/validate-workflow.mjs
git commit -m "docs: document mono-orchestrate in README and AGENTS"
```

---

### Task 6: install smoke check and plan index closeout

**Files:**
- Modify: `plans/README.md` (status row)

- [ ] **Step 1: Smoke-check the local install path**

```bash
TMP_ROOT=$(mktemp -d)/skills
node scripts/install-local.mjs --skills-root "$TMP_ROOT"
ls "$TMP_ROOT/mono-orchestrate"
```

Expected: listing shows `SKILL.md`, `AGENTS.md`, `references/`, `templates/`.

```bash
node scripts/install-local.mjs --skills-root "$TMP_ROOT" --check
rm -rf "$(dirname "$TMP_ROOT")"
```

Expected: check passes for the temp root.

- [ ] **Step 2: Final full verification**

Run: `node scripts/verify.mjs`
Expected: `Verification passed (8 checks).`

- [ ] **Step 3: Update the plan index**

In `plans/README.md`, replace:

```markdown
| 011 | mono-orchestrate control-plane skill | P1 | M | — | TODO |
```

with:

```markdown
| 011 | mono-orchestrate control-plane skill | P1 | M | — | DONE (<commit>) |
```

Replace `<commit>` with the short SHA of the Task 5 commit.

- [ ] **Step 4: Commit**

```bash
git add plans/README.md
git commit -m "docs: mark plan 011 done in plans index"
```

---

## Out of scope (do not do)

- VERSION bump and CHANGELOG entry — they belong to the ship workflow
  (`gstack ship`), not to this plan.
- Installer changes — `install-local.mjs` discovers new skills, references,
  and templates automatically.
- Project repo changes (e.g. switching the first consumer's `deployApproval` to
  `risky-only`) — separate explicit step with the user.
- Any change to existing stage skills' ownership or gates.

## Spec coverage map

- Spec "Architecture: Three Roles" → Task 1 (`## Roles`), Task 3 (SKILL.md intro/rules).
- Spec "Stage Ownership Map" → Task 1 (`## Stage Ownership`), Task 4 (lifecycle `## Orchestration`).
- Spec "Worker Transport Abstraction" → Task 1 (`## Worker Transports`).
- Spec "Reporting: File Mailbox" → Task 1 (`## Mailbox And Ledger`), Task 2 (report template).
- Spec "Decision Authority Matrix" → Task 1 (`## Decision Authority`), Task 4 (questioning.md).
- Spec "Decision Briefs" → Task 1 (`## Decision Briefs`), Task 2 (brief template).
- Spec "Monitoring Protocol" → Task 1 (`## Monitoring Protocol`), Task 3 (SKILL.md rules).
- Spec "Recovery / Resume" → Task 1 (`## Resume`), Task 3 (`resume` state).
- Spec "Deliverables" → Tasks 1-5 files; validator updates in Tasks 1-5.
- Spec "Constraints Carried Forward" → STOP conditions + Task 4 lifecycle Forbidden list.
