# AGENTS.md

## Mission

Define reusable Mono skills from idea to shipped PR; Linear holds Project/PRD/Tech Spec/Issue truth.

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

Use SKILL descriptions for routing, atomics for one artifact, wrappers for orchestration. Read `references/`/`templates/` progressively; never inline long templates. Keep handoff/implement/preflight/ship/deploy owners separate. `mono-deliver` sequences three phases in one context; rules stay with phase owners, never in a monolith. Orchestrator only dispatches, confirms writes and monitors; never implements stages.

Review only reports quality/risk; check only reports readiness. Repair: handoff mutates Project-first, `mono-review artifact` judges classification, `mono-check repair` reports readiness, issue renews issue-only, ship owns accepted pre-ship drift. Apply accepted fixes only through these owners or explicit atomics.

Pin autoreview model by policy role and effort by risk, never helper defaults. Project Updates inform deploy closeout; never gate any stage. Record user acceptance in Linear comments.

Project repos keep only `.agents/mono-workflow.config.json`; never install/generate/vendor `.agents/skills/mono-*`, `.claude/skills/mono-*`, workflow locks, local checkers or updater CI there.

## Change Discipline

Start every pack change with a Linear Issue before the first edit. Route pack rule changes through the orchestrator. Update README.md in the same PR as any Issue changing behavior it describes.

## Validation

Before finishing run `node scripts/verify.mjs`: `git diff --check` and all artifact/workflow checks.

## Fixture Coupling

`scripts/validate-workflow.mjs` checks files/sections/fields/IDs/order and script behavior on scratch copies; prose is freely rewordable. Allow only listed `MACHINE_TOKENS` pins: markers, labels, dictionary keys/values, placeholders, commands and paths. Reject unlisted pins and sentence regexes.

Keep four `references/contracts/` files, SHA-256 fingerprints and consumer checks as bounded core; changing contract/fingerprint requires explicit contract change. Agent-only rules stay in text/review with skeleton checks; never pin or encode them twice.

Classify removed pins: drop editorial wording, list machine tokens, use named fixtures for script behavior and skeletons for agent rules. Record classification/replacement in PR; never weaken invariants to pass.
