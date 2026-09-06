# Zeni Dogfood Example

Zeni is the first consumer repo for this workflow.

Project policy:

- Zeni keeps its existing project-specific skills.
- Zeni keeps only `.agents/mono-workflow.config.json` for this workflow.
- Zeni must not vendor `.agents/skills/mono-*`, `.claude/skills/mono-*`, workflow lockfiles, local checkers, or updater CI for this workflow.
- Use the local skill pack installed from this upstream repo through `scripts/install-local.mjs`.
- Zeni stores project policy in `.agents/mono-workflow.config.json` and repo docs.
- Zeni's configured implementation workflow is Compound `ce-work`.
- Zeni's configured ship workflow is gstack `ship`.
- Zeni's configured documentation workflow is gstack `document-release`.
- Zeni's configured review feedback workflow is Compound `ce-resolve-pr-feedback`.
- Zeni's configured deploy workflow is gstack `land-and-deploy`.

Dogfood order:

1. Ship the reusable workflow MVP.
2. Install/update the local skill pack from this upstream repo.
3. Write or migrate Zeni's `.agents/mono-workflow.config.json` and clean legacy project installs.
4. Use `mono-idea` for raw idea intake.
5. Use discovery/review skills in Plan Mode when helpful.
6. Use `mono-handoff` before implementation.
7. Use `mono-review` as a risk-based gate before Issue creation or pre-ship when required.
8. Create approved execution Issue(s) through handoff.
9. Use `mono-implement` to start Delivery and implement from the approved Issue(s).
10. Use `mono-preflight` to prepare the local branch and produce a certificate.
11. Use `mono-ship` for pre-ship review/check, PR creation, repo docs, review loop, and green certificate.
12. Use `mono-deploy` for Deploy workflow, post-ship check, Linear closeout, and durable learnings.
13. Keep Project, PRD, Tech Spec, and Issue current in Linear.

## Correct Raw Idea Intake

Input:

```text
Improve Settings > Agent by splitting Identity & phase, Voice & guardrails, and Context into separate saveable blocks. Improve Goals design and think through Yield target binding.
```

Expected behavior:

1. `mono-idea` inspects only minimal context.
2. It asks 2-4 idea-shaping questions with recommended options.
3. It creates or updates a Linear Project in `Idea`.
4. Final output includes:
   - Project link.
   - Strengthened brief.
   - Next step: `/office-hours` or `/brainstorming`.
   - Reason for the recommendation.
   - Statement that no PRD, Tech Spec, Issue, plan, ExecPlan, or code was created.

No implementation plan is produced.

## Correct Discovery To Handoff

Expected behavior:

1. User runs `/office-hours` or `/brainstorming` in Plan Mode.
2. User optionally runs `/plan-design-review` and `/plan-eng-review`.
3. When a discovery/review implementation plan appears, user runs `/mono-handoff` instead of direct artifact authoring or direct implementation.
4. `mono-handoff` produces a handoff exit-plan if still in Plan Mode.
5. `mono-handoff` performs artifact intake, previews the package for approval before durable writes, and after approval updates Project, PRD, and Tech Spec in Linear and creates Issue(s).
6. `mono-handoff` runs or reports the required/advisory `mono-review handoff` gate before Issue creation.
7. Accepted review fixes are applied by `mono-handoff`, not by `mono-review`.
8. PRD and Tech Spec creation keeps the Project in Discovery or an equivalent pre-delivery state.
9. If the user explicitly approves implementation start, `mono-handoff` routes to `mono-implement`.
10. The Project moves to Delivery only through `mono-implement` after approved execution Issue(s) exist, delivery readiness is checked, and implementation-start approval is explicit.

## Correct Project Body Shape

Expected Project description sections:

```markdown
# Что

# Зачем

# Образ результата

# Что входит

# Что не входит
```

The Project body is a product brief, not a workflow dashboard. It should not include active doc lists, active issue lists, lifecycle bookkeeping, or agent-only workflow mechanics.

## Correct Issue Links

Expected Issue relationship shape:

- Body contains Linear chips/entity mentions for the Project, PRD, and Tech Spec.
- PRD and Tech Spec are added as Linear resources/links when the connector supports it.
- PRD and Tech Spec are not attached as Issue documents.
- Raw PRD or Tech Spec URLs are avoided when chips can represent the documents.

## Risk-Based Review Gate Examples

### Correct Risky Handoff Review

Input:

```text
Settings > Agent will change identity, phase, voice guardrails, and context behavior across multiple saveable blocks.
```

Expected behavior:

1. `mono-handoff` classifies the package as `deep` or `risky`.
2. Project, PRD, and Tech Spec are updated first.
3. `mono-review handoff` reports `needs-fixes` if actors, flows, requirement trace, validation, or rollout are weak.
4. User accepts or rejects proposed fixes.
5. `mono-handoff` applies accepted artifact fixes and records acceptance as a Linear comment.
6. `mono-check handoff` and `mono-check issue` run or are reported before implementation can start.
7. `mono-implement` verifies implementation-start approval, moves the Project to Delivery after prerequisites are explicit, then runs or reports `mono-check delivery`.

### Correct Implement To Preflight To Ship

Input:

```text
Implement the approved Issue from the current Linear package.
```

Expected behavior:

1. `mono-implement` fetches fresh Linear Project, PRD, Tech Spec, Issue, approval, review, and check state.
2. It starts from approved Issue(s), not raw discovery artifacts or local review plans.
3. It selects the configured/default implementation engine, implements the approved one-PR slice, and exits as `implemented-needs-preflight` when local implementation is complete.
4. `mono-preflight` inspects branch/worktree/diff, selects the explicit Opus 5 route from `references/autoreview-routing.md`, runs targeted verification and mandatory `autoreview` until it reports clean, commits when safe/configured, and emits a preflight certificate with the final route.
5. `mono-ship` consumes the preflight certificate, owns formal `mono-review pre-ship`, owns `mono-check pre-ship`, delegates PR creation to the configured Ship workflow, runs repo docs before final green when configured, stabilizes review/CI, and emits a `mono-ship green certificate`.
6. `mono-deploy` consumes the green certificate, verifies the current PR head SHA still matches, runs the configured Deploy workflow, runs/reports `mono-check post-ship`, closes Linear, and records durable learnings.

### Correct Tiny Advisory Review

Input:

```text
Rename one static empty-state sentence in a low-risk settings panel.
```

Expected behavior:

1. Scope is classified as `tiny`.
2. PRD-lite or no-spec exception is allowed only with the reason recorded.
3. `mono-review` is advisory and may be skipped.
4. `mono-check` can pass only when the advisory review-gate record is present in Project or Issue context.

### Anti-Example: Required Review Skipped

FAIL:

1. Handoff creates a standard Project, PRD, Tech Spec, and Issue package.
2. No `mono-review handoff` report or advisory exception is recorded.
3. Agent creates Issues and starts implementation.

Why this fails:

- Standard, deep, risky, or materially rewritten packages require the review gate.
- `mono-check handoff` should report FAIL.

### Anti-Example: Review Mutates Linear

FAIL:

1. `mono-review` finds weak acceptance examples.
2. `mono-review` edits the PRD directly.
3. Handoff proceeds without recording accepted fixes.

Why this fails:

- `mono-review` is report-only.
- Accepted fixes must be applied by `mono-handoff`, an explicit atomic skill, or `mono-ship`.

## Anti-Example: Vendored Project Install

FAIL:

```markdown
.agents/skills/mono-idea/SKILL.md
.claude/skills/mono-idea/SKILL.md
.agents/mono-workflow-check.mjs
.agents/mono-workflow.lock.json
.github/workflows/update-mono-workflow.yml
```

Why this fails:

- Project repos should not contain workflow skill bodies, discovery wrappers, workflow lockfiles, local checkers, or updater CI.
- The local skill pack is updated from the upstream repo, while project repos keep only `.agents/mono-workflow.config.json`.
- `mono-check project-config` should report this install as FAIL.

## Anti-Example: Direct Discovery Plan Approval

FAIL:

1. `/office-hours`, `/brainstorming`, or `/plan-eng-review` produces an implementation plan.
2. User approves the plan directly.
3. Agent starts code implementation without `mono-handoff`.

Why this fails:

- Discovery artifacts are inputs, not Linear source of truth.
- Project, PRD, Tech Spec, and Issue(s) were not updated before implementation.
- Implementation did not start from approved Linear Issue(s).

## Anti-Example: Delivery Too Early

FAIL:

1. PRD is created.
2. Tech Spec is created.
3. Project is moved to Delivery from `mono-handoff` or an atomic artifact skill.
4. No approved execution Issue exists, or no implementation-start approval is recorded.

Why this fails:

- PRD and Tech Spec belong to Discovery or Handoff.
- Delivery requires approved execution Issue(s) and explicit implementation-start approval.
- Delivery Start belongs to `mono-implement`.
- `mono-check delivery` must report FAIL.

## Anti-Example: Preflight Owns Ship

FAIL:

1. `mono-preflight` sees local tests pass.
2. It claims `mono-review pre-ship` and `mono-check pre-ship` passed.
3. It creates or lands the final PR without `mono-ship`.

Why this fails:

- `mono-preflight` owns local branch readiness only.
- Formal pre-ship review/check and PR lifecycle remain in `mono-ship`.
- Local tests do not imply PR review, CI, deploy, production smoke, or Linear closeout.

## Anti-Example: Ship Owns Deploy

FAIL:

1. `mono-ship` gets review and CI green.
2. It merges/deploys through the configured Deploy workflow.
3. It moves Linear to `Done` and records release learnings.

Why this fails:

- `mono-ship` stops at a `mono-ship green certificate`.
- Deploy workflow, post-ship check, Linear closeout, and learnings belong to `mono-deploy`.
- Repo documentation belongs before the green certificate so doc commits are reviewed before deploy.

## Anti-Example: Workflow Language In Linear Artifacts

FAIL:

1. Project body includes sections such as `Принципы workflow`, `Lifecycle`, `Документы`, `План задач`, or `Текущий статус`.
2. Tech Spec includes sections such as `Skill contracts` or `mono-check design`.

Why this fails:

- Linear artifacts must be product and implementation truth, not visible workflow instructions.
- Skills and examples should prevent this by construction; `scripts/lint-mono-artifacts.mjs` is only a lightweight smoke guard for this known regression class.

## Anti-Example: Dogfood Failure

FAIL:

1. User invokes `mono-idea` with a raw product improvement idea.
2. Agent performs deep code discovery.
3. Agent asks reasonable questions.
4. Agent writes an implementation plan.
5. Agent starts "Plan implementation".
6. No Linear Project is created.
7. No `/office-hours` or `/brainstorming` recommendation is made.

Why this fails:

- `mono-idea` did not complete its mandatory Project creation/update.
- Idea intake crossed into planning and delivery.
- `mono-check idea` must report FAIL.
