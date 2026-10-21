# AGENTS.md

This repo is the Mono pack: skills that take a product idea to a shipped PR, with Linear as the record. Two readers load this file: agents editing the pack, and the English workflow skills at run time (they read it first; the Russian stages do not). Every byte here counts against the worker read budget (`node scripts/read-budget.mjs`), so add only what an agent cannot find in the skill it runs.

## Language

Stages listed in `scripts/russian-stages.mjs` (idea, research, discovery, handoff) and `references/owner-dialog.md` are written in Russian; other skills in English. Linear artifacts, templates and examples use the project language (Russian here) so the owner can read them. Commands, paths, keys and codes stay English everywhere.

## Source Of Truth

- Linear holds the Project, PRD (what and why), Tech Spec (how), Issue (one-PR contract) and every owner approval as a comment. Obligations live in `references/contracts/`, shape in `templates/`.
- GitHub holds branch, PR, review, CI and merge history.
- Each skill's description and the README Skills table route between stages. The orchestrator runs Idea, Research, Discovery and Handoff itself and is the sole Linear writer; workers run implement, preflight and ship and queue Linear writes in reports. Project-first work starts on the owner's word after Handoff; issue-only work starts with owner approval through `mono:issue`.

## Skill Design Rules

- A description routes; a skill owns one artifact or phase; a wrapper such as `mono:deliver` only sequences owners and keeps their rules with them.
- `SKILL.md` carries what the model cannot infer; longer material sits in `references/` or `templates/` behind a Read when condition.
- Review reports quality and risk, check reports readiness, and neither edits artifacts. Accepted fixes go through their owner: `mono:handoff` for package repair (classes in `references/repair-machine.md`), `mono:issue` for issue-only bodies, `mono:ship` for pre-ship drift.
- Project updates report deploy closeout; delivery proceeds and keeps its verdict when an update is missing or fails.
- Product repos carry only `.agents/mono-workflow.config.json`; the pack installs as a GitHub marketplace plugin ([Installation](references/install.md)).

## Change Discipline

Open a Linear Issue before the first edit, so every change passes review and verification. Changes to skills, references and templates go through the orchestrator session, with affected README sections updated in the same PR. Each task adds `changelog.d/<ISSUE-KEY>.md`; releases assemble them per [Landing](references/landing.md#changelog-assembly).

## Validation

Run `node scripts/verify.mjs` before finishing; focused checks are in the README Validation section.

## Fixture Coupling

`scripts/validate-workflow.mjs` checks structure (files, headings, fields, IDs, order) and script behavior on scratch copies, so prose stays free to reword. A check that needs a literal adds it to `MACHINE_TOKENS` (markers, labels, dictionary values, placeholders, commands, paths); sentences stay unpinned. Script behavior is guarded by named fixtures, agent-only rules by skeleton checks and review, each encoded once. The four `references/contracts/` files keep SHA-256 fingerprints and consumer checks; change them only as an explicit contract change. When a pin goes away, record in the PR how it was classified and what replaces it, and keep the invariant it guarded.
