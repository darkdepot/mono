# Artifact Intake

Artifact intake makes discovery evidence visible before it becomes durable Linear truth.

Use this reference from `mono:handoff` and any workflow that needs to explain
which upstream discovery, review, or implementation artifacts were inspected.

## Source Precedence

Inspect sources in this order:

1. Explicit user-provided artifact paths and Linear resources.
2. Fresh Linear Project, PRD, Tech Spec, Issues, comments, and review reports.
3. Current conversation decisions.
4. Configured project artifact roots, if the project config names any.
5. Local gstack artifacts only when scoped by project slug, current branch or
   session, or explicit filename match.

Do not perform broad home-directory scans. If no scoped artifact root exists,
report local artifacts as unavailable instead of guessing.

## Configured Artifact Roots

Project config may define optional artifact roots:

```markdown
- Artifact roots: None
```

When configured, accept repo-relative paths or explicit absolute paths supplied
by the project. Roots must be narrow enough to inspect intentionally, such as a
repo docs folder or a project-scoped gstack artifact directory. Do not treat
home directories, broad project parents, or unrelated worktree folders as valid
roots.

## Required Fields

Every intake summary must include:

- `read`: artifacts actually inspected.
- `unavailable`: referenced or expected artifacts that could not be inspected.
- `stale_or_ignored`: older, superseded, unrelated, or out-of-scope artifacts.
- `conflicts`: meaningful disagreements between sources.
- `decisions_carried_forward`: discovery decisions translated into Project,
  PRD, Tech Spec, or Issue shape.
- `confidence_boundary`: what the package is and is not grounded in.

Use `none` explicitly when a field has no entries. Do not omit fields.

## Freshness And Conflict Rules

- Prefer explicit user-provided paths over discovered local files.
- Prefer Linear artifacts over local scratch when Linear is newer or already
  records package approval.
- Treat local plans and review reports as evidence, not source of truth.
- Treat stale local artifacts as useful only when they explain prior decisions
  and do not conflict with fresher Linear state.
- If local and Linear artifacts conflict on product scope, validation, risk, or
  Issue slicing, surface the conflict before durable writes.
- If an expected artifact is unavailable, proceed only when the missing content
  is not material or the user accepts the confidence boundary.

## Output Shape

The structured intake record belongs in the package-approval Linear comment and package notes. The chat final carries a one-sentence Russian rendering instead.

Structured record (for package-approval Linear comment):

```text
Artifact intake:
- read: <sources actually inspected>
- unavailable: <expected or referenced sources not inspected, or none>
- stale_or_ignored: <sources ignored and why, or none>
- conflicts: <material disagreements, or none>
- decisions_carried_forward: <decisions translated into Linear shape>
- confidence_boundary: <what this package can and cannot prove>
```

Chat final (one Russian sentence, e.g.):

```text
Читал: discovery-план и PRD; не нашёл: заметки office-hours; конфликтов нет; уверенность средняя по scope реализации.
```

## Durable Artifact Rule

Never paste local artifact bodies directly into Linear. Translate inspected
evidence into the right durable shape:

- Project: concise product brief and lifecycle container.
- PRD: WHAT, operator workflow, requirements, acceptance, and boundaries.
- Tech Spec: HOW, contracts, failure modes, validation, rollout, rollback.
- Issue: one-PR execution contract with context snapshot and proof plan.
