# AGENTS.md

## Mission

Define reusable Mono coding-agent skills from raw idea to shipped PR, with Linear as durable Project/PRD/Tech Spec/Issue truth.

## Language

Write skills in English; Linear templates/examples in Russian.

## Source Of Truth

- Project entity: shaped outcome, lifecycle and relationships in metadata/resources/comments/handoff; body: only what/why/outcome/in/out.
- PRD: WHAT (problem/operator/workflow/scenarios/requirements/acceptance). Tech Spec: HOW (architecture/contracts/failures/validation). Issue: one-PR contract with snapshot.
- GitHub: branch/PR/review/CI/deploy/merge history only.
- `mono-handoff`: persists Project-first package/slicing before implementation; owns reviewed class 1–3 repair.
- `mono-issue`: issue-only create-then-approve intake/body renewal; never handoff repair.
- `mono-implement`: Delivery Start/code from approved Issues.
- `mono-preflight`: local readiness/targeted verification/commit/certificate; mandatory clean `autoreview`, model from [role:autoreview](references/model-policy.md#roles), effort by risk.
- `mono-ship`: accepted pre-ship drift, formal review/check, PR/docs-before-green/feedback/certificate.
- `mono-deploy`: deploy delegation/evidence/post-ship/closeout/durable learnings.
- `mono-orchestrate`: product control plane, dispatch/monitor/decisions and sole orchestrated Linear writer; never stage work.

## Skill Design Rules

Keep SKILL descriptions as routing, atomics on one artifact, wrappers on orchestration. Use `references/`/`templates/` progressively; do not copy long templates into skills. Preserve separate handoff/implement/preflight/ship/deploy ownership. `mono-deliver` sequences the three delivery phases in one worker context; keep each phase rule in its owning skill, never merge them into a monolith. Orchestrator dispatches, confirms writes and monitors; it never implements or absorbs stages.

Keep review report-only (quality/risk, no mutations), check readiness-only. Repair: handoff mutates Project-first, `mono-review artifact` judges classification, `mono-check repair` reports readiness, issue renews issue-only, ship owns accepted pre-ship drift. Apply accepted fixes only through these owners or explicit atomics.

Pin autoreview model via policy role and effort via risk, never external helper defaults. Project Updates are informational deploy-closeout results, never any stage's gate. Record user acceptance in Linear comments.

Project repos keep only `.agents/mono-workflow.config.json`; never install/generate/vendor `.agents/skills/mono-*`, `.claude/skills/mono-*`, workflow locks, local checkers or updater CI there.

## Validation

Before finishing run `node scripts/verify.mjs`, including `git diff --check` and all artifact/workflow checks.

## Fixture Coupling

`scripts/validate-workflow.mjs` checks files/sections/fields/IDs/order and script behavior on scratch copies; prose is freely rewordable. String pins may contain only `MACHINE_TOKENS` markers, labels, dictionary keys/values, placeholders, commands and paths; unlisted pins fail. A sentence regex is also a prose pin.

Keep four `references/contracts/` files, SHA-256 fingerprints and consumer checks as bounded core; changing contract/fingerprint requires explicit contract change. Agent-only rules live in text/review, with skeleton checks only: never pin them or add a second machine encoding.

Before removing a pin classify it: remove editorial wording, list machine tokens, replace script behavior with named fixtures, keep only skeleton for agent rules. Record classification/replacement in PR; never weaken invariants for green verification.
