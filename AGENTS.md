# AGENTS.md

## Mission

This repo defines reusable Mono workflow skills for AI coding agents.

The workflow helps agents move from raw idea to shipped PR while keeping Linear as the durable source of truth for Project, PRD, Tech Spec, and Issue.

## Language

- Skill instructions in this repo are written in English.
- Linear-facing templates and output examples are written in Russian.

## Source Of Truth

- Linear Project entity = shaped outcome plus lifecycle/status and relationships carried through Linear metadata, resources, comments, and the handoff package.
- Linear Project body = concise product brief only: what, why, target outcome, in scope, and out of scope.
- Linear PRD = WHAT: problem, operator, workflow, scenarios, requirements, acceptance.
- Linear Tech Spec = HOW: architecture, contracts, failure modes, validation.
- Linear Issue = one-PR execution contract with context snapshot.
- `mono-review` = report-only quality/risk review; no Linear mutations.
- GitHub = branch, PR, review, CI, deploy, and merge history only.
- `mono-handoff` = project-first package creation and artifact repair; it persists Project, PRD, Tech Spec, and Issue slicing before implementation starts and owns reviewed class 1-3 repair transactions.
- `mono-issue` = issue-only intake and renewal through the create-then-approve transaction; issue-only body edits never route to handoff repair.
- `mono-implement` = Delivery Start and implementation execution from approved Linear Issue(s).
- `mono-preflight` = local branch readiness, targeted verification, mandatory `autoreview` clean gate with the model from [role:autoreview](references/model-policy.md#roles) and risk-routed effort, commit state, and preflight certificate.
- `mono-ship` = accepted pre-ship drift sync, formal pre-ship review/check, PR lifecycle, repo documentation before final green, review feedback loop, and green certificate.
- `mono-deploy` = deploy workflow delegation, verified delivery evidence, post-ship check, Linear closeout, and durable learning capture.
- `mono-orchestrate` = product-level control plane: worker dispatch, monitoring, decision routing, single Linear writer during orchestration; never does stage work itself.

## Skill Design Rules

- Keep `SKILL.md` descriptions as routing text, not the whole workflow.
- Keep atomic skills focused on one artifact.
- Keep wrappers focused on orchestration.
- Use `references/` and `templates/` through progressive disclosure.
- Do not copy long templates into every skill.
- Keep `mono-review` report-only and `mono-check` readiness-only.
- Repair ownership stays split: `mono-handoff` mutates Project-first artifacts,
  `mono-review artifact` checks classification report-only, `mono-check repair`
  reports readiness, `mono-issue` renews issue-only bodies, and
  `mono-ship` owns accepted pre-ship drift.
- Apply accepted review fixes through `mono-handoff`, explicit atomic skills, or `mono-ship`.
- Keep `mono-handoff`, `mono-implement`, `mono-preflight`, `mono-ship`, and `mono-deploy` ownership separate; do not collapse them into a monolithic delivery skill.
- Keep `mono-orchestrate` control-plane only: it sequences stages and routes decisions but never absorbs stage ownership or implements.
- Keep `autoreview` routing explicit and update-safe: `mono-preflight` resolves the model from [role:autoreview](references/model-policy.md#roles) and effort by risk class and never depends on the external helper's built-in default.
- Do not make Project Updates a required gate.
- `mono-deploy` publishes a project update as an informational result of closeout: a step of that stage, never a gate of any stage.
- Record user review acceptance as a Linear comment.
- Project repos must keep only `.agents/mono-workflow.config.json` for this workflow. Do not install, generate, or vendor `.agents/skills/mono-*`, `.claude/skills/mono-*`, workflow lockfiles, local checkers, or updater CI into project repos.

## Validation

Run before finishing changes:

```bash
node scripts/verify.mjs
```

This includes `git diff --check` and all artifact and workflow checks.

## Fixture Coupling

- `scripts/validate-workflow.mjs` checks files, sections, fields, identifiers, ordering, and script behavior on scratch copies. Prose can be reworded freely.
- String pins may contain only machine tokens explicitly listed in `MACHINE_TOKENS`: markers, field labels, dictionary keys and values, placeholders, commands, and paths. The validator rejects an out-of-list pin. A regex over a sentence is a prose pin too.
- The four files in `references/contracts/` and their SHA-256 fingerprints form the bounded contract core. Their existing consumer checks remain required. Change a contract and its fingerprint only as an explicit contract change.
- Rules that only agents execute are held by the text and by review. Never pin them or add a second machine encoding of those rules inside the documents. The validator checks their document skeleton only.
- Classify a pin before removing it: remove editorial wording; list machine tokens; cover script behavior with a named fixture; retain only the skeleton for agent rules. Record the classification and replacement in the PR. Never loosen an invariant just to make verification pass.
