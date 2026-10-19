# AGENTS.md

## Mission

Define reusable Mono skills from idea to shipped PR; Linear holds Project/PRD/Tech Spec/Issue truth.

## Language

Write skills in English; stages rebuilt under «Mono как продукт» and `references/owner-dialog.md` in Russian. Machine tokens (commands/paths/keys/codes) stay English; Linear templates/examples stay Russian.

## Source Of Truth

- Project entity: shaped outcome, lifecycle and relationships in metadata/resources/comments/handoff; body: only what/why/outcome/in/out.
- PRD: WHAT (problem/operator/workflow/scenarios/requirements/acceptance). Tech Spec: HOW (architecture/contracts/failures/validation). Issue: one-PR contract with snapshot.
- GitHub: branch/PR/review/CI/deploy/merge history only.
- `mono:idea`: raw idea to an approved Project description; owner yes only.
- `mono:research`: facts before a solution; «Исследование» document; no owner questions.
- `mono:discovery`: up to three solutions, a choice, PRD with yes on the shown version.
- `mono:handoff`: persists Project-first package/slicing before implementation; owns reviewed class 1–3 repair.
- `mono:issue`: issue-only create-then-approve intake/body renewal; never handoff repair.
- `mono:implement`: Delivery Start/code from approved Issues.
- `mono:preflight`: local readiness/targeted verification/commit/certificate; mandatory `autoreview` (clean or approved declines), model from [role:autoreview](references/model-policy.md#roles), effort by risk.
- `mono:ship`: accepted pre-ship drift, formal review/check, PR/docs-before-green/feedback/certificate.
- `mono:deploy`: deploy delegation/evidence/post-ship/closeout/durable learnings.
- `mono:orchestrate`: product control plane, dispatch/monitor/decisions and sole orchestrated Linear writer; runs Idea for owner yes, Research and Discovery itself; other stages keep their owners.

## Skill Design Rules

Use descriptions for routing, atomics for single artifacts and wrappers for orchestration. Read shared files progressively; never inline long templates. Keep phase owners separate: mono:deliver only sequences implement/preflight/ship; their rules stay with their owners. Orchestrator dispatches, confirms and monitors. Idea is its exception: answer questions with reasons, present the description and «Ответил сам:» for owner yes, separately from package approval. Research too: no owner questions or yes; the result goes to the owner. Discovery: answers with sources and its own PRD yes; the result goes to the owner. Implement/preflight/ship stay in workers.

Review only reports quality/risk; check only reports readiness. Repair: handoff mutates Project-first, `mono:review artifact` judges classification, `mono:check repair` reports readiness, issue renews issue-only, ship owns accepted pre-ship drift. Apply accepted fixes only through these owners or explicit atomics.

Pin autoreview model by policy role and effort by risk, never helper defaults. Project Updates inform deploy closeout; never gate any stage. Record user acceptance in Linear comments.

Project repos keep only `.agents/mono-workflow.config.json`; never install/generate/vendor `.agents/skills/mono-*`, `.claude/skills/mono-*`, workflow lockfiles, local checkers or updater CI there.

Install/update through the GitHub marketplace plugin; one repository layout and shared files. Compatibility, update condition and proof: [Installation](references/install.md).

## Change Discipline

Open a Linear Issue before edits. Rules go through the orchestrator; update README in same PR.
Task notes: `changelog.d/<ISSUE-KEY>.md`; releases: [Landing](references/landing.md#changelog-assembly).

## Validation

Before finishing run `node scripts/verify.mjs`: `git diff --check` and all artifact/workflow checks.

## Fixture Coupling

`scripts/validate-workflow.mjs` checks files/sections/fields/IDs/order and script behavior on scratch copies; prose is freely rewordable. Allow only listed `MACHINE_TOKENS` pins: markers, labels, dictionary keys/values, placeholders, commands and paths. Reject unlisted pins and sentence regexes.

Keep four `references/contracts/` files, SHA-256 fingerprints and consumer checks as bounded core; changing contract/fingerprint requires explicit contract change. Agent-only rules stay in text/review with skeleton checks; never pin or encode them twice.

Classify removed pins: drop editorial wording, list machine tokens, use named fixtures for script behavior and skeletons for agent rules. Record classification/replacement in PR; never weaken invariants to pass.
