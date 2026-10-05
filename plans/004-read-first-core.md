# Plan 004: Consolidate the shared "Read first" core into one reference

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 889742b..HEAD -- skills/ references/ scripts/validate-workflow.mjs`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: 001 (CI guard recommended before a 12-file sweep; not strictly required)
- **Category**: tech-debt
- **Planned at**: commit `889742b`, 2026-06-11

## Why this matters

Five reference documents form a de-facto shared core that almost every skill
lists in its "Read first" section: `AGENTS.md` (12 of 12 skills),
`references/artifact-rules.md` (11), `references/readiness-gates.md` (10),
`references/execution-quality.md` (10), `references/human-friendly-output.md`
(8). Adding or renaming a shared reference today means editing 8-12 skill
files in lockstep, and an agent loading one skill sees a flat 6-15 item list
with no signal about which entries are universal context vs. skill-specific.
Extracting the core into one short reference makes shared-reading changes a
one-file edit and shortens every skill's preamble.

## Current state

- Full "Read first" inventory at commit `889742b` (entry counts):
  mono-handoff 15, mono-implement 12, mono-ship 11, mono-deploy 9,
  mono-preflight 9, mono-review 8, mono-check 7, mono-idea 6,
  mono-issue 6, mono-prd 6, mono-spec 6, mono-project 5.

- Core membership matrix (which skills currently list each core doc):

  | Doc | Listed by |
  |-----|-----------|
  | `AGENTS.md` | all 12 |
  | `references/artifact-rules.md` | all except mono-idea |
  | `references/readiness-gates.md` | all except mono-idea, mono-prd |
  | `references/execution-quality.md` | all except mono-idea, mono-project |
  | `references/human-friendly-output.md` | check, deploy, handoff, idea, implement, preflight, review, ship |

- Example of the current shape — `skills/mono-handoff/SKILL.md:12-28`:

  ```
  Read first:

  1. `AGENTS.md`
  2. `skills/mono-project/SKILL.md`
  3. `skills/mono-prd/SKILL.md`
  4. `skills/mono-spec/SKILL.md`
  5. `skills/mono-issue/SKILL.md`
  6. `skills/mono-review/SKILL.md`
  7. `skills/mono-check/SKILL.md`
  8. `references/artifact-rules.md`
  9. `references/artifact-quality.md`
  10. `references/readiness-gates.md`
  11. `references/execution-quality.md`
  12. `references/artifact-intake.md`
  13. `references/questioning.md`
  14. `references/lifecycle.md`
  15. `references/human-friendly-output.md`
  ```

- Validator interplay (`scripts/validate-workflow.mjs`):
  - `extractReadFirstEntries` (lines 62-85) parses the numbered list after
    `Read first:`; every entry must contain at least one backticked path or it
    is flagged malformed.
  - `validateReadFirstPath` (lines 87-94) accepts `AGENTS.md` and existing
    paths under `skills/`, `references/`, `templates/` — a new
    `references/core-reading.md` is valid once the file exists.
  - `validateAntiPatterns` line 469 requires `mono-handoff` to contain the
    substring `references/artifact-intake.md` — keep that entry in handoff's
    list (it is skill-specific anyway).
  - `validateSkills` line 163 fails any SKILL.md under 900 characters — the
    trimmed lists keep every skill far above that; no risk.
- Plugin paths: all shared reading inputs resolve from the repository-shaped pack root. Verify the delivery reading union with `node scripts/read-budget.mjs`.
- `scripts/lint-mono-artifacts.mjs` pins nothing about Read-first lists.
- Language convention: the new reference is repo instruction text → English
  (`AGENTS.md:9-12`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Full validation | `node scripts/validate-workflow.mjs` | exit 0, `Mono workflow validation passed (12 skills checked).` |
| Artifact smoke | `node scripts/lint-mono-artifacts.mjs` | exit 0 |

## Scope

**In scope** (the only files you should modify or create):
- `references/core-reading.md` (create)
- All 12 `skills/mono-*/SKILL.md` ("Read first" sections only)
- `README.md` (Documentation Map list — add the new reference, one line)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Any skill content outside the "Read first" section.
- `scripts/validate-workflow.mjs` — no validator changes are needed; if you
  think you need one, that's a STOP condition.
- `AGENTS.md`, `references/` other than the new file, `templates/`,
  `examples/`, `VERSION`, `CHANGELOG.md`.

## Git workflow

- Branch: current worktree branch, or `advisor/004-read-first-core`.
- Commit style: `refactor: extract shared read-first core reference`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `references/core-reading.md`

Short English doc (~25 lines): a one-paragraph purpose statement ("the shared
context every workflow skill assumes; read these before the skill-specific
entries"), then the five core docs, each with a one-line role and an
applicability note for the exceptions:

- `AGENTS.md` — mission, source-of-truth map, skill design rules. All skills.
- `references/artifact-rules.md` — source-of-truth and Linear-facing artifact
  rules. All skills except `mono-idea` (no durable artifacts yet at intake).
- `references/readiness-gates.md` — risk classes, review policy, owner
  boundaries. All skills except `mono-idea` and `mono-prd`.
- `references/execution-quality.md` — PRD/Issue/bug-perf/architecture
  guardrails. All skills except `mono-idea` and `mono-project`.
- `references/human-friendly-output.md` — user-facing status and
  confidence-boundary wording. Skills that talk to the user about state:
  check, deploy, handoff, idea, implement, preflight, review, ship.

**Verify**: file exists; `node scripts/validate-workflow.mjs` → exit 0
(nothing references it yet; this just confirms no collateral damage).

### Step 2: Rewrite the 12 "Read first" lists

For every `skills/mono-*/SKILL.md`: entry 1 becomes
`` `references/core-reading.md` ``, the five core docs are removed from the
list, and all remaining skill-specific entries keep their current relative
order, renumbered. Keep the numbered + backticked format exactly (the parser
requires it). Example — mono-handoff's list becomes:

```
Read first:

1. `references/core-reading.md`
2. `skills/mono-project/SKILL.md`
3. `skills/mono-prd/SKILL.md`
4. `skills/mono-spec/SKILL.md`
5. `skills/mono-issue/SKILL.md`
6. `skills/mono-review/SKILL.md`
7. `skills/mono-check/SKILL.md`
8. `references/artifact-quality.md`
9. `references/artifact-intake.md`
10. `references/questioning.md`
11. `references/lifecycle.md`
```

Apply the same transformation to the other 11 skills. Do not add core docs to
skills that previously lacked them — the applicability notes in
`core-reading.md` carry that nuance instead.

**Verify** after each batch of 3-4 skills: `node scripts/validate-workflow.mjs`
→ exit 0 (catches malformed entries and broken paths immediately).

### Step 3: Update the README Documentation Map

Add one line for `references/core-reading.md` in the alphabetized
Documentation Map list (`README.md:152-176`), matching the existing
`- path: description` format.

**Verify**: `node scripts/validate-workflow.mjs` → exit 0.

### Step 4: Full suite + duplication sweep

**Verify**: `node scripts/lint-mono-artifacts.mjs` → exit 0.

**Verify**: no skill still lists a core doc in its Read first section:

```bash
for f in skills/*/SKILL.md; do awk '/^Read first:/{flag=1;next} flag&&/^[0-9]+\./{print FILENAME": "$0;next} flag&&NF==0{c++; if(c>1) exit; next} flag{exit}' "$f"; done | grep -E "artifact-rules|readiness-gates|execution-quality|human-friendly-output|\`AGENTS.md\`" ; echo "exit=$?"
```
→ no output lines, `exit=1` (grep found nothing).

**Verify** (only if plan 001 landed): `node scripts/verify.mjs` → exit 0.

## Test plan

`validate-workflow.mjs` is the test: it validates every Read-first entry's
format and path on every run (lines 147-157), and its pinned-substring checks
confirm no skill body outside the lists was disturbed. The Step 4 sweep is
the regression check for the consolidation itself.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `references/core-reading.md` exists and names all five core docs
- [ ] `grep -l "core-reading.md" skills/*/SKILL.md | wc -l` → 12
- [ ] The Step 4 duplication sweep returns no matches
- [ ] `node scripts/validate-workflow.mjs` exits 0
- [ ] `node scripts/lint-mono-artifacts.mjs` exits 0
- [ ] `git status --porcelain` shows changes only in: `references/core-reading.md`, the 12 SKILL.md files, `README.md`, `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `node scripts/validate-workflow.mjs` fails with a pinned-substring error
  after a Read-first edit — that means a pin lives inside a list you changed;
  report which pin, do not edit the validator.
- The current Read-first lists don't match the inventory in "Current state"
  (drift since planning).
- You find a skill whose body (outside the list) textually depends on a
  Read-first entry number (e.g. "see item 9 above").
- The change seems to require touching `scripts/validate-workflow.mjs`.

## Maintenance notes

- Future shared references: add them to `references/core-reading.md` (one
  file) instead of 12 lists; keep truly stage-specific docs in the per-skill
  lists.
- Reviewer should scrutinize: that the applicability exceptions (idea, prd,
  project) survived into `core-reading.md`, since those skills no longer
  carry the distinction in their own lists.
- Related but deferred: README/AGENTS/lifecycle rule-duplication
  (see plans/README.md backlog) — same disease, bigger surgery, weaker
  payoff; reassess after this lands.
