> Archived: completed implementation plan. Current rules are in the skills and references; do not execute this historical checklist.

# Plan 001: Add a one-command verification entry point and CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 889742b..HEAD -- README.md AGENTS.md scripts/ .github/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `889742b`, 2026-06-11

## Why this matters

This repo's correctness story is its validation scripts, but running them
requires copy-pasting up to 9 separate commands from `README.md`, and nothing
runs them automatically: there is no `.github/` directory, no `package.json`,
no Makefile. A PR that breaks a skill contract is only caught if a human
remembers the full ritual. A single `node scripts/verify.mjs` entry point plus
a GitHub Actions workflow makes the existing checks the default, both locally
and on every PR.

## Current state

- `README.md:196-208` — the "Validation" section lists these commands, each run by hand:

  ```bash
  git diff --check
  node --check scripts/install-local.mjs
  node --check scripts/project-config.mjs
  node --check scripts/lint-mono-artifacts.mjs
  node scripts/lint-mono-artifacts.mjs
  node --check scripts/validate-workflow.mjs
  node scripts/validate-workflow.mjs
  node scripts/install-local.mjs --check
  node scripts/project-config.mjs --repo /path/to/project --check
  ```

- `AGENTS.md:43-49` — its "Validation" section tells contributors to run only
  `git diff --check` before finishing changes.
- There is no `.github/` directory and no `package.json` (verified at the
  planned-at commit). All scripts are dependency-free Node ESM; plain `node`
  is the only runtime requirement.
- `scripts/validate-workflow.mjs` already includes functional tests of the
  installer and project-config in temp directories
  (`validateLocalInstallBehavior`, lines 259-307, and
  `validateProjectConfigBehavior`, lines 330-391), so running it in CI also
  exercises `install-local.mjs` and `project-config.mjs` end to end.
- **Two commands are machine-specific and must NOT be in the default verify
  run**:
  - `node scripts/install-local.mjs --check` compares the *user's installed
    skill pack* in `~/.codex/skills` against the current checkout. On a fresh
    clone or CI runner there is no installed pack, and in a dirty worktree the
    generated bodies embed a `dirty` marker, so this check fails by design
    away from the maintainer's machine.
  - `node scripts/project-config.mjs --repo /path/to/project --check` needs an
    external project repo path.
- Script style conventions (match them): `#!/usr/bin/env node` shebang,
  `node:`-prefixed imports, root resolved via
  `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`, a
  `failures` array printed with a summary and `process.exit(1)` on failure.
  Exemplar: `scripts/validate-workflow.mjs:1-36`. Arg parsing with explicit
  unknown-flag rejection and a `usage()` that exits 2: exemplar
  `scripts/install-local.mjs:15-52`.
- `scripts/validate-workflow.mjs:393-456` (`validateDocsAndExamples`) pins
  exact strings that `README.md` and `AGENTS.md` must keep, including
  `"node scripts/install-local.mjs"` and `"node scripts/project-config.mjs"`
  in README. Edits to those files must keep every pinned string present.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax check a script | `node --check scripts/<name>.mjs` | exit 0, no output |
| Artifact smoke | `node scripts/lint-mono-artifacts.mjs` | exit 0, `Linear artifact regression smoke passed` |
| Full workflow validation | `node scripts/validate-workflow.mjs` | exit 0, `Mono workflow validation passed (12 skills checked).` |
| Whitespace check | `git diff --check` | exit 0, no output |

## Scope

**In scope** (the only files you should modify or create):
- `scripts/verify.mjs` (create)
- `.github/workflows/validate.yml` (create)
- `README.md` (edit the "Validation" section only)
- `AGENTS.md` (edit the "Validation" section only)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `scripts/install-local.mjs`, `scripts/project-config.mjs`,
  `scripts/lint-mono-artifacts.mjs`, `scripts/validate-workflow.mjs` —
  verify.mjs orchestrates them; it must not change them.
- `skills/`, `references/`, `templates/`, `examples/` — no workflow content
  changes in this plan.
- `VERSION`, `CHANGELOG.md` — release bumps happen through the maintainer's
  ship flow, not here.

## Git workflow

- Branch: work on the current branch if dispatched into a worktree; otherwise
  create `advisor/001-verify-and-ci`.
- Commit style (from `git log`): conventional prefix, e.g.
  `feat: add one-command verification and CI`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `scripts/verify.mjs`

Dependency-free Node ESM, matching the conventions above. Behavior:

- Flags: `--install-check` (additionally runs
  `node scripts/install-local.mjs --check`; off by default because it is
  machine-specific), `--help`/`-h` (usage, exit 2), any unknown flag → print
  `Unknown argument: <arg>` and usage, exit 2.
- Default step list, in order, each run as a child process from the repo root:
  1. `git diff --check`
  2. `node --check scripts/install-local.mjs`
  3. `node --check scripts/project-config.mjs`
  4. `node --check scripts/lint-mono-artifacts.mjs`
  5. `node --check scripts/validate-workflow.mjs`
  6. `node --check scripts/verify.mjs`
  7. `node scripts/lint-mono-artifacts.mjs`
  8. `node scripts/validate-workflow.mjs`
- Use `execFileSync` (never a shell string) with the repo root as `cwd`,
  capturing stdout/stderr. Print one line per step: `PASS <label>` or
  `FAIL <label>`, and on failure also print the captured output indented.
- Run all steps even after a failure (report everything), then print a summary
  line (`Verification passed (N checks).` or `Verification failed: <M> of <N>
  checks failed.`) and exit 0/1 accordingly.

**Verify**: `node scripts/verify.mjs` → exit 0, one `PASS` line per step,
summary `Verification passed (8 checks).`

**Verify**: `node scripts/verify.mjs --bogus-flag; echo "exit=$?"` → prints
`Unknown argument: --bogus-flag`, usage text, `exit=2`.

### Step 2: Create `.github/workflows/validate.yml`

```yaml
name: validate

on:
  push:
    branches: [main]
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node scripts/verify.mjs
```

Note: `validate-workflow.mjs` shells out to `git rev-parse HEAD` and
`git status --short` inside its installer fixtures; `actions/checkout`
provides a real git checkout, so this works on the runner.

**Verify**: `node -e "const s=require('fs').readFileSync('.github/workflows/validate.yml','utf8'); for (const t of ['actions/checkout@v4','node scripts/verify.mjs','pull_request']) if (!s.includes(t)) { console.error('missing '+t); process.exit(1); } console.log('ok')"` → `ok`.

### Step 3: Update the `README.md` "Validation" section

Replace the current command list (README.md:196-208) with: a lead
recommendation to run `node scripts/verify.mjs`, a note that
`node scripts/verify.mjs --install-check` additionally verifies the installed
local skill pack (maintainer machine only), and a collapsed "Individual
checks" list containing the same commands as today (keep
`node scripts/install-local.mjs --check` and
`node scripts/project-config.mjs --repo /path/to/project --check` listed
there — the validator pins the substrings `node scripts/install-local.mjs`
and `node scripts/project-config.mjs` in README). Mention that CI runs
`verify.mjs` on every PR.

**Verify**: `node scripts/validate-workflow.mjs` → exit 0 (README pins intact).

### Step 4: Update the `AGENTS.md` "Validation" section

Change the pre-finish instruction from only `git diff --check` to running
`node scripts/verify.mjs` (which includes `git diff --check`). Keep the
section short — two or three lines. Do not touch any other AGENTS.md section
(the validator pins several exact sentences elsewhere in the file).

**Verify**: `node scripts/validate-workflow.mjs` → exit 0.

### Step 5: Full suite

**Verify**: `node scripts/verify.mjs` → exit 0, `Verification passed (8 checks).`

## Test plan

The new script is itself test infrastructure; its negative path is covered by
the unknown-flag check in Step 1. No separate test files. Full verification is
Step 5.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node scripts/verify.mjs` exits 0 and prints 8 PASS lines
- [ ] `node scripts/verify.mjs --bogus-flag` exits 2
- [ ] `.github/workflows/validate.yml` exists and contains `node scripts/verify.mjs`
- [ ] `node scripts/validate-workflow.mjs` exits 0
- [ ] `node scripts/lint-mono-artifacts.mjs` exits 0
- [ ] `git status --porcelain` shows changes only in: `scripts/verify.mjs`, `.github/workflows/validate.yml`, `README.md`, `AGENTS.md`, `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `node scripts/validate-workflow.mjs` fails after your README.md or AGENTS.md
  edit and a second attempt at restoring the pinned strings also fails — the
  pin list lives in `scripts/validate-workflow.mjs:393-456`; do not edit the
  validator to make it pass.
- A `.github/workflows/` directory already exists with a conflicting workflow.
- `node scripts/verify.mjs` fails on a step that also fails when run directly
  from the README list before your changes (pre-existing breakage — report,
  don't fix here).

## Maintenance notes

- Any future script added to `scripts/` should be appended to the step list in
  `verify.mjs` (both the `node --check` and, if it's a check, the run step).
- Reviewer should scrutinize: that `--install-check` stays opt-in (CI must not
  depend on `~/.codex/skills` state), and that README/AGENTS pinned strings
  survived.
- Deferred: a pre-commit hook was considered and skipped — CI plus one local
  command is enough for a repo of this size.
