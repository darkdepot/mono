# AGENTS.md

Mono skills take ideas to shipped PRs. Linear holds truth. Runtime read budget: `node scripts/read-budget.mjs`.

## Language

Stages in `scripts/russian-stages.mjs` and `references/owner-dialog.md`: Russian; other skills: English. Linear artifacts, templates and examples use the project language (Russian here). Machine tokens stay English.

## Source Of Truth

- Linear holds the Project, PRD (what and why), Tech Spec (how), Issue (one-PR contract) and every owner approval as a comment. Obligations live in `references/contracts/`, shape in `templates/`.
- GitHub holds branch, PR, review, CI and merge history.
- Each skill's description and the README Skills table route between stages. The orchestrator launches the same pre-delivery stage sessions and answers as delegated owner; each stage writes and reads back its own Linear records. The orchestrator is the sole Linear writer for implement, preflight and ship workers, which queue mutations in reports. Ordinary Project work needs owner start after Handoff; delegated Project work allows orchestrator start with reason. Issue-only work needs owner approval through `mono:issue`.

## Skill Design Rules

- `mono:tech-evaluation` owns new Tech Spec after page approval; Handoff consumes it and repairs legacy Spec; Ship owns accepted pre-PR drift. Owner-led approval: `by=owner`. Orchestrator-led: `by=orchestrator` with reason, including irreversible/deferred/contrary-to-owner lines; no owner windows in a stage agent, result shown after each stage; independent countercheck before every orchestrator approval.

- `mono:design` owns mockups and consented design memory. Discovery decides `design=` then size in one PRD approval; the active record chain routes Design, Tech Evaluation and Handoff. The orchestrator launches Design as a stage agent and approves `by=orchestrator` with a reason; only first-product exemplars need the owner.
- `mono:tech-evaluation` chooses and checks the technical solution after Discovery; one approved page, then a short Spec; Handoff owns slicing.
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
