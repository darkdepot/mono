# Changelog

All notable changes to Mono Agent Workflow are documented in this file.

This project follows Semantic Versioning. Breaking workflow or adapter contract changes require a major version bump after `v1.0.0`; before `v1.0.0`, they must be called out explicitly in release notes.

## [Unreleased]

### Breaking

- The installed surface narrows from 14 to 11 skills: `mono-project`,
  `mono-prd`, and `mono-spec` are retired. Their normative rules remain in
  `references/contracts/`; raw Project intent routes to `mono-idea`, while PRD
  and Tech Spec creation or repair routes to `mono-handoff` (accepted pre-ship
  drift remains owned by `mono-ship`).
- `surfaceRevision` advances from 1 to 2. Upgrade with the transactional
  `node scripts/install-local.mjs --breaking` flow only after orchestrators are
  idle and worker registries are empty, then restart open agent sessions.

### Added

- `mono-deploy` gains a `project-update` step between `mono-closeout` and
  `learn`: one Linear project update per deployed Issue, in product language,
  and — when that shipment was the project's last — the project's transition to
  `Completed` before the final update is published. Completion is judged by
  Issue status TYPE (`completed`, `canceled`, and `duplicate` do not block; any
  other type does), and its normative wording lives in `references/lifecycle.md`
  (Deploy).
- `templates/project-update.md`: the single home of the update's form, its text
  invariants, the live-mode rule, two verbatim examples, and the accepted
  13-update acceptance set. The installer ships it into every skill of every
  root like the other templates.
- Closeout gains two additive fields, in the Issue comment and in
  `templates/deploy-output.md`: `Project update:` and `Project:`.

### Changed

- `mono-orchestrate` owner-facing statuses switch to product language: the
  subject of every line is what the product now does for its user; Issue
  keys, stages, wave slice codes, and mechanics are never the subject. The
  «Статус» shape in `templates/orchestrator-brief.md` opens with a
  «Решений от тебя:» counter, separates «Новое за <период>:» from
  «Где мы к цели», adds «Можешь потрогать:», «Чем рискуем:»,
  «Обещал — не сделал:», and «Следующий контакт:», renames
  «Простои и отклонения:» to «Что пошло не так:», moves the machine
  register into a «Техника (можно не читать):» tail, and keeps
  «Нужно от тебя:» as the last block. `references/human-friendly-output.md`
  gains «Product Language For The Owner» with a stage glossary.
- The «Project Updates are not a required gate» rule is preserved everywhere it
  already lived and extended in `AGENTS.md`, `references/artifact-rules.md`,
  `references/install.md`, and `skills/mono-deploy/SKILL.md`: the update is an
  informational result of closeout, and its failure never changes a deploy
  verdict. `mono-check post-ship` states explicitly that a missing update is
  never a `FAIL`.
- `mono-orchestrate` carries the published update's URL and the project
  completion result into the «Linear:» line of the next status; `resume` never
  sweeps projects for completion.

## [0.20.1] - 2026-07-16

Completes the public brand migration by renaming the canonical GitHub
repository from `darkdepot/linear-agent-workflow` to `darkdepot/mono`.

### Changed

- The installer now records `darkdepot/mono` as the canonical upstream
  repository in generated lockfiles.
- README and install/versioning documentation now point to
  `https://github.com/darkdepot/mono`.
- Previous-brand repository markers remain supported only as migration input
  for installer-owned `0.19.x` state.

## [0.20.0] - 2026-07-16

Rebrands the workflow skill pack from `linear-*` to `mono-*` while keeping
Linear as the durable product/project system of record.

### Breaking

- All public skill names and commands now use the `mono-*` prefix:
  `mono-idea`, `mono-handoff`, `mono-implement`, `mono-preflight`,
  `mono-ship`, `mono-deploy`, and the related atomic/review/check skills.
  The old `/linear-*` commands are not installed as aliases.
- Project policy moves from `.agents/linear-workflow.config.json` to
  `.agents/mono-workflow.config.json`.
- Installed-pack state moves from `.linear-agent-workflow*` to
  `.mono-agent-workflow*`, and `LINEAR_WORKFLOW_KNOWN_ROOTS` is superseded by
  `MONO_WORKFLOW_KNOWN_ROOTS`.
- Durable workflow markers and certificates written after this release use
  the `mono-*` brand, including `mono-issue-only marker`,
  `mono-preflight certificate`, and `mono-ship green certificate`.

### Added

- Installer migration support discovers previous-brand lockfiles, installs the
  complete `mono-*` pack, removes installer-owned `linear-*` skills, and
  replaces the old lock/runtime paths. The previous environment override
  remains readable during migration.
- Project config migration reads previous JSON or Markdown config, writes the
  Mono JSON config, and removes previous-brand vendored skills, generated
  checkers, lockfiles, configs, and updater workflows with `--write --clean`.
- The issue-only resolver continues to read an already-approved
  `linear-issue-only marker`, so the brand migration does not revoke durable
  Linear approvals. New and renewed marker comments use the Mono marker.
- Functional fixtures cover installed-pack migration, previous JSON/Markdown
  project config migration, and previous-brand durable marker compatibility.

### Changed

- All skill frontmatter, cross-skill routing, templates, references, examples,
  plans, validation pins, runtime paths, user-facing status text, and docs now
  use the Mono brand.
- The artifact linter entry point is now
  `scripts/lint-mono-artifacts.mjs`; `scripts/verify.mjs` invokes the renamed
  checker.
- The local checkout and GitHub repository slug remain
  `darkdepot/linear-agent-workflow` for this release; lockfile upstream
  identity continues to record the actual repository URL until that external
  rename is performed separately.

### Migration

Update installed skill roots:

```bash
node scripts/install-local.mjs --remove-stale
node scripts/install-local.mjs --check
```

Migrate each project repository:

```bash
node scripts/project-config.mjs --repo /path/to/project --write --clean --check
```

Restart the agent runtime after installation so its skill registry reloads,
then use `/mono-*` commands.

## [0.19.1] - 2026-07-11

Makes the code-review model policy an explicit design choice next to the newly cross-vendor Second Voice (MONO-13).

### Changed

- `references/autoreview-routing.md`: states that cross-vendor review is deliberately not a code-review requirement and must not be added by analogy to the Second Voice. Independence-by-different-vendor guards subjective product judgment (the Second Voice's job, where two instances of one model share priors); code review is grounded in the concrete diff, so the gate is served better by matching model strength to risk within the GPT-5.6 Luna/Terra/Sol ladder than by crossing vendors. Cross-vendor code review remains only the existing `risky`-class compensation, and only when the worker engine is not Codex. Pinned in `scripts/validate-workflow.mjs`.

## [0.19.0] - 2026-07-11

Second Voice model selection is now cross-vendor and relative to the orchestrator (MONO-12), fixing a self-review echo observed live.

### Changed

- `references/orchestration.md` `### Second Voice`: the reviewer model is selected relative to the orchestrator and must be a different model family — a fresh context on the *same* model inherits the same blind spots and collapses into self-review. An orchestrator on any Claude model (Fable, Opus, Sonnet, …) draws its Second Voice from `gpt-5.6-sol` at `model_reasoning_effort="high"`; an orchestrator on GPT-5.6 (`sol`, `terra`, `luna`) draws it from Claude Opus (latest) at high reasoning. Both sides run at high reasoning effort. The prior binding hardcoded an Opus-class reviewer and keyed independence on a distinct *session* rather than a distinct model, so an Opus orchestrator interviewed an Opus reviewer.
- Fallback is explicit: only when the cross-vendor model is unreachable (no Codex auth, or no Claude access) does discovery fall back to an in-session lens pass, with the reason recorded. A same-model Second Voice is not an acceptable fallback.

### Added

- `scripts/validate-workflow.mjs` pins both invariants (`a different model family from the orchestrator`, `A same-model Second Voice is not an acceptable fallback`); break/restore negative test recorded in `docs/spikes/mono-12-pin-tests.md`.

## [0.18.1] - 2026-07-11

Hotfix release from the first live run of the heartbeat watcher against a real orchestrator directory (MONO-11).

### Fixed

- `scripts/watch-workers.mjs` no longer emits `EVENT:dead` for retired Issues: log checks are scoped to Issues present in the active `workers.json` registry; a directory's historical logs are outside the watcher's scope. Registry-side checks (entry-without-log, pid-gone) are unchanged.
- Completed-but-unconsumed workers no longer trigger false `EVENT:stall`/`EVENT:dead`: a terminal mailbox report for the same Issue+stage suppresses events even when the Codex CLI's final shutdown writes leave the report marginally older than the log (grace window of one stall threshold), guarded by the log's birthtime so a prior-attempt report can never mask a genuine retry death.

### Added

- Heartbeat contract sentence in `references/orchestration.md` — the watcher observes the active registry, not the directory's history — pinned in `scripts/validate-workflow.mjs`; before/after fixture reproductions and discrimination probes recorded in `docs/spikes/mono-1-watcher-spike.md`.

## [0.18.0] - 2026-07-11

Wave-2 hardening release: MONO-5 through MONO-10 close the contract, hygiene, telemetry, integrity, and ops gaps found while dogfooding orchestrated delivery, and amend the autoreview model routing.

### Added

- Goal contract and verification binding (MONO-5): `templates/orchestrator-dispatch.md` gains a `## Goal Contract` section — the durable end-state lifted verbatim from the Issue, runnable verification commands, and what must not change or break — so a worker can judge its own "done" against the contract instead of vibes. `templates/orchestrator-report.md` gains `verification_items` (`pass | deferred | not-run`, optional in shape but mandatory in coverage): stage exit reports in `linear-implement` and `linear-preflight` enumerate every «Как проверить» item and cannot claim completion while an item is silently missing; the orchestrator audits `verification_items` coverage before advancing a stage-terminal report.
- Review-loop hygiene (MONO-6): before the first resolver cycle the review bots' configuration is checked and config-class noise is fixed via configuration, never burned down with resolver cycles; duplicate findings are deduplicated without consuming the cycle budget, guarded by a double fail-safe (in doubt = novel, dedup must never dismiss real findings); a published-replies submitted-check (no pending draft reviews) becomes a green-certificate precondition; after the authorized final resolver cycle convergence is non-blocking — remaining threads get deferral replies and a follow-up issue when warranted.
- Per-feature cost telemetry (MONO-7): `references/orchestration.md` gains a `## Cost Telemetry` section — tokens summed across all attempts of a stage from the last `turn.completed` event per thread, review cycles counted, stage wall-clock from ledger timestamps with `recorded-late` entries honestly marked; status updates carry a per-Issue cost tail and the wave closeout a «Цена волны» block. Cost is telemetry, not a gate: no thresholds, no blocking, visibility only.
- Brief integrity (MONO-8): decision briefs mirror board section IDs exactly with section-scoped suffixes (1a, 1b) and cross-section renumbering forbidden; option tokens are self-identifying (valid without their number); owner answers are echoed back as «вопрос → выбранный вариант (дословно)» with a one-line re-confirm on any numbering doubt — in doubt, re-ask; questions are never closed by silence; anything changed after approval is disclosed under «Изменилось после твоего одобрения:».
- Ops lessons (MONO-9): install-source SHA blocker — the installing checkout's HEAD must equal the expected merge SHA taken from the gh merge record (`git rev-parse HEAD` provenance, verify SHA → install → `--check`), and a mismatch is a DEPLOY BLOCKER, not a warning; after any interruption PR state is reconstructed exclusively via `gh` commands against the exact head SHA, never from thread memory; a forced mid-wave resume drill is defined as a planned one-time operational act (not a recurring gate) that records every reconstruction discrepancy in the ledger and feeds the PRD wave-1 success criteria.
- Autoreview routing amendments (MONO-10, `references/autoreview-routing.md`): the reviewer-vs-producer principle — a review model must be at least as capable as the code's producer for the gate to add signal; the `standard` → `gpt-5.6-luna`/`medium` route is marked PROVISIONAL pending live-QA validation of the hermes-dashboard waves, with an explicit re-tier trigger to `gpt-5.6-sol`/`medium` if live QA surfaces defects that Luna-reviewed code shipped; the same-model limitation at `risky` (Sol reviewing Sol, METR reward-hacking context) is documented together with its compensations (live QA gate, no-test-edits rule, cross-vendor review when the worker engine is not Codex).

### Changed

- The `deep` risk class now routes autoreview at reasoning effort `high` instead of `medium` (`gpt-5.6-sol`/`high`), aligning the canonical table with the tiering research and strengthening the gate; no route was weakened.
- `scripts/validate-workflow.mjs` pins all wave-2 contracts (`validateGoalContractBinding`, `validateReviewLoopHygiene`, `validateCostTelemetry`, `validateBriefIntegrity`, `validateOpsLessons`) plus the MONO-10 routing pins (updated deep row, PROVISIONAL marking, re-tier trigger, same-model limitation); each pin set is proven by a break/restore negative-test protocol recorded in `docs/spikes/` (`mono-5-pin-tests.md` through `mono-10-pin-tests.md`).

## [0.17.0] - 2026-07-11

### Changed

- `linear-preflight` now routes mandatory `autoreview` through explicit GPT-5.6 model/effort pairs derived from the existing workflow risk class, using the canonical table in `references/autoreview-routing.md`.
- The final preflight certificate records the risk source, selected model and effort, and any upward reclassification; `ready` fails closed when explicit routing is missing or mismatched.
- Model routing lives in the Linear workflow rather than the independently updated external `autoreview` skill, so upstream helper refreshes cannot silently restore an older model default.

## [0.16.0] - 2026-07-11

Wave-1 hardening release: MONO-1 through MONO-4 close the reliability gaps found while dogfooding orchestrated delivery.

### Added

- Orchestrator heartbeat (MONO-1): external tick via `scripts/watch-workers.mjs` tailing worker session logs and emitting `EVENT:<stall|dead|spawn-fail>` lines; spawn watchdog that catches missing `thread.started` / empty `thread_id` on worker spawn; healing ladder nudge → respawn → session rotation with user alerts only after the ladder is exhausted. Dispatch prompts are passed via file only (`"$(cat <dispatch-prompt-file>)" < /dev/null`), and the worker model and reasoning effort are pinned explicitly in the spawn command (`-c 'model=...'`, `-c 'model_reasoning_effort=...'`) so CLI default drift cannot silently switch models.
- Honest ledger (MONO-2): ledger entries carry the timestamp of the actual moment of writing, backfilled events are marked `recorded-late`, and corrections are new lines, never edits. Status updates disclose orchestrator idle windows in the «Простои и отклонения» brief section; Linear Write Verification requires reading back the mutated entity after every write (a success response alone is not confirmation); `## Context Budget` defines «Контекст: ~N%» reporting with 70%/85% thresholds and rotation that never happens mid-dispatch.
- Mandatory Live QA gate in deploy closeout (MONO-3): before Linear closeout, verify the deployed version matches the certified merged SHA, walk the PRD acceptance criteria of the shipped Issue on the live app, and check the console for errors. Design acceptance is judged autonomously against the prototype approved at the UX checkpoint, never the agent's own taste. Defects fix-forward through an immediate hotfix Issue out of queue that closes only after its own live pass is green. New optional `workflows.qa` / `qaAuth` project config fields, plus a narrow control-plane exception (explicit owner mandate; feature code never qualifies).
- Real-backend contract sampling in Tech Spec (MONO-4): for features integrating with an existing API or backend, the Tech Spec must include a sample of real responses from the deployed instance — enum value domains, object shapes, edge records — not just an endpoint list; a spec-vs-reality mismatch is a spec blocker, not an implementation surprise. New «Реальные ответы бэкенда» subsection in `templates/tech-spec.md`, the matching quality bar in `references/artifact-quality.md` ("endpoint exists" is not contract verification), and the degradation rule: when the deployed instance is unreachable during discovery, a contract-verification spike Issue goes first in the wave.

### Changed

- `scripts/validate-workflow.mjs` pins all wave-1 contracts (`validateHeartbeatContract`, `validateHonestLedgerContract`, `validateLiveQaGateContract`, `validateRealBackendContractSampling`); each pin set is proven by a break/restore negative-test protocol recorded in `docs/spikes/` (`mono-1-watcher-spike.md`, `mono-2-pin-tests.md`, `mono-3-pin-tests.md`, `mono-4-pin-tests.md`).

## [0.15.0] - 2026-07-09

### Added

- `codex-cli` worker transport for `linear-orchestrate`: the orchestrator spawns one headless Codex thread per Issue (`codex exec --json` in a pre-created worktree), advances the same thread across stages with `codex exec resume`, and tracks every worker in a `workers.json` registry (transport, thread id, worktree, branch, stage). Liveness ladder, stage budgets, and report-delivery fallback under a write sandbox are specified in `references/orchestration.md` Worker Transports; transport selection honors the new optional `orchestration` config block (`orchestration.transport`, `orchestration.maxParallelWorkers`).
- Director Discovery (`references/orchestration.md`): discovery under orchestration runs in director mode — the orchestrator answers discovery-skill questions itself as product director and touches the user only at five checkpoints: intake direction questions, the UX checkpoint with a reviewed near-production prototype, package approval, deploy approval per policy, and ad-hoc risk or scope-drift escalations. Includes the prototype bar (never a first draft), multi-idea intake queueing, and the «UX-чекпоинт» brief shape in `templates/orchestrator-brief.md`.
- Second Voice (`references/orchestration.md`): the interrogative side of discovery is delegated to an independent reviewer agent in a fresh context (Opus-class subagent in Claude Code, a fresh high-reasoning `codex exec` thread otherwise, in-session lens review as recorded fallback). Dialogue protocol ask → answer → challenge capped at 3 rounds; disagreements that survive the cap go to the user only when Always-ask class; the Second Voice never talks to the user, never writes Linear, and never dispatches workers.
- Runtime-availability fallbacks: `linear-implement` and `linear-ship` define behavior when a configured engine/workflow is not available in the current runtime, recording the substitution without weakening gates.
- Executor plans `plans/012-codex-worker-transport.md`, `plans/013-director-discovery.md`, `plans/014-second-voice-discovery.md`; validator pins for all new contracts.

### Changed

- `references/questioning.md` Orchestrated Mode covers discovery skills in the orchestrator session; `references/lifecycle.md` Orchestration section names the checkpoint model; README documents director mode and the recommended orchestrator/worker pairing.
- Always-ask design/UX escalations arising during discovery batch into the UX checkpoint instead of interrupting; discovery artifacts (prototypes, mockups, review notes) are defined as orchestrator-owned discovery work, not stage work.

## [0.14.0] - 2026-06-12

### Added

- `linear-orchestrate`: control-plane orchestrator skill — one session per product drives Linear projects and Issues through delegated worker sessions (`linear-implement` → `linear-preflight` → `linear-ship` per Issue), answers worker technical questions autonomously, and escalates only product decisions (scope, design, product risk, deploy approval per `deployApproval`) to the user as prepared decision briefs.
- `references/orchestration.md`: orchestration policy — roles, stage ownership, decision authority, worker transports (Claude Code Desktop chips, Codex threads, background-subagent fallback), mailbox and ledger contract, monitoring protocol, and resume procedure.
- `templates/orchestrator-dispatch.md` (worker spawn prompt with context snapshot and AFK contract), `templates/orchestrator-brief.md` (Russian decision-brief and status-update shapes), `templates/orchestrator-report.md` (mailbox report JSON and ledger entry shapes).
- Orchestrated-mode routing: `references/questioning.md` gains a `linear-orchestrate` question stage and an `## Orchestrated Mode` section; `references/lifecycle.md` gains an `## Orchestration` section with explicit Required/Forbidden lists.
- Validator pins for all new contracts in `scripts/validate-workflow.mjs` (now 13 skills checked), including the strict single-Linear-writer rule: workers never write to Linear and queue every stage-required mutation through `linear_mutations_pending`.
- Design spec `docs/superpowers/specs/2026-06-11-linear-orchestrate-design.md` and executor plan `plans/011-linear-orchestrate.md`.

### Changed

- `README.md` and `AGENTS.md` document the orchestrator role and the control-plane-only design rule; stage ownership of existing skills is unchanged.

## [0.13.0] - 2026-06-11

### Added

- `scripts/install-local.mjs` now defaults to `--all-roots`: it discovers every previously-installed skills root by checking for `.linear-agent-workflow.lock.json` in the known roots (`~/.codex/skills`, `~/.claude/skills`, and any root recorded in a discovered lockfile) and syncs or checks each of them in one run, reporting the per-root installed version. This fixes the failure mode where only the default root was reinstalled and other roots (for example `~/.claude/skills`) were silently left at an older version.
- `--check` now also fails when a lockfile is pinned to a different upstream version than the current checkout, and reports the per-root version on success.
- `LINEAR_WORKFLOW_KNOWN_ROOTS` environment override for the known roots list (used by fixtures and sandboxes).
- Multi-root functional fixtures in `scripts/validate-workflow.mjs`: fresh-install fallback, one-run sync across roots, lockfile-recorded root discovery, stale per-root version detection, and per-root check failure isolation.

### Changed

- Explicit `--skills-root` keeps the previous single-root behavior; combining it with `--all-roots` is rejected.

## [0.12.0] - 2026-06-11

### Added

- Add `scripts/verify.mjs` one-command verification (range-aware whitespace check in CI) and a GitHub Actions workflow that runs it on every PR.
- Add `deployApproval` config policy (`always` default / `risky-only` / `never`): `linear-deploy` now defines when to ask, the Russian ask shape, and a durable approval record bound to the PR number and head SHA; stale approvals are treated as absent. Deploy approval is never a ship gate.
- Add an implementation-start approval prompt shape to `linear-implement` («что это разрешает / чего НЕ разрешает»); handoff package options now name which approval(s) they grant.
- Add Autonomy Defaults to `references/questioning.md`: agents decide non-contested choices themselves and surface them as «Решил сам» in the handoff package; scope boundaries, issue slicing, risk acceptance, and design decisions always go to the user, and visual decisions are presented through `/design-html` variants.
- Add Linear exit comments for every non-ready stop (blocked / needs-human / scope-drift / timed-out), a `Decision needed:` field in the preflight certificate, a Tiny Output Profile for `tiny`-risk work, and a Boundary Delta Rule against «Проверено/Не проверено» fatigue.
- Add learnings read-back: `linear-implement` and `linear-deploy` consult `gstack-learnings-search` (advisory) before work, closing the loop that previously only wrote learnings at deploy.
- Add `plans/` — the advisor audit record: executed improvement plans, verified findings, and rejected-findings rationale.

### Changed

- Linear machine blocks became dual-layer: certificates and the deploy closeout posted to Linear now open with 1-2 Russian human sentences above the byte-stable machine core; the deploy closeout leads with the shipped product outcome. Certificate recovery rule documented (latest marker comment wins).
- Russified the user-facing output templates: check output («Смысл», «Следующий unblock»), review report («Коротко» first, «Нужно твоё решение:», translated risk/gate values), ship output (telemetry moved to the internal summary, translated next steps), deploy say-strings; added risk/gate and tooling glossaries to `references/human-friendly-output.md`.
- Humanized the handoff chat final: artifact intake is one Russian sentence; the structured snake_case record moved to the package-approval Linear comment.
- Humanized Linear documents: PRD template merged three overlapping operator sections (16 → 14 sections), calque headings renamed to natural Russian, R/AE references carry Russian slugs, and Issue `AFK`/`HITL` values carry a Russian gloss.
- `linear-idea` now asks 1-3 direction-shaping questions and records the rest as explicit assumptions; its blocked message keeps the English marker line with a Russian blocked-shape body; the chosen discovery route is persisted as a Project comment.

### Fixed

- `project-config.mjs --write` backfills `deployApproval` into existing JSON configs; invalid values are rejected with fixture coverage in `validate-workflow.mjs`.
- `verify.mjs --help` exits 0; duplicate file reads removed in `validate-workflow.mjs`; check-output template labels are now validator-pinned.

## [0.11.0] - 2026-06-10

### Added

- Add `scripts/install-local.mjs` for installing/updating the workflow as a local `~/.codex/skills/linear-*` skill pack.
- Add `scripts/project-config.mjs` for creating, migrating, checking, and cleaning project-level `.agents/linear-workflow.config.json`.

### Changed

- Pre-v1.0 packaging contract change: project repos must no longer vendor generated `linear-*` skills, wrappers, lockfiles, local checkers, or updater CI.
- Replace generated project install validation with local skill-pack validation plus project JSON config validation.

### Removed

- Remove `scripts/sync-consumer.mjs` and the generated full-copy project install contract.

## [0.10.0] - 2026-05-29

### Changed

- Pre-v1.0 workflow behavior change: make `linear-preflight` use the installed `autoreview` helper as a mandatory clean gate instead of the previous bounded Compound `ce-code-review` loop.
- Record `Autoreview helper` as an explicit consumer prerequisite; generated workflow installs do not vendor the external `autoreview` helper and preflight blocks when it is unavailable.

## [0.9.0] - 2026-05-23

### Added

- Add `linear-deploy` as the post-ship owner for Deploy workflow delegation, verified delivery evidence, post-ship check, Linear closeout, and durable learning capture.
- Add `templates/deploy-output.md` and a durable `linear-ship green certificate` contract for handoff from ship to deploy.
- Add optional consumer config field `Documentation workflow`, defaulting Zeni to `gstack document-release`.

### Changed

- Pre-v1.0 workflow behavior change: hard-rename `Land workflow` to `Deploy workflow`; no compatibility alias is supported.
- Move repo documentation sync into `linear-ship` before final green review stabilization so doc commits are reviewed before deploy.
- Split `linear-ship` and `linear-deploy`: `linear-ship` now stops at a deploy-ready green certificate, while `linear-deploy` owns merge/deploy, post-ship check, Linear closeout, and learning capture.
- Strengthen `linear-preflight` with a bounded pre-PR `ce-code-review` loop and residual finding reporting.

## [0.8.0] - 2026-05-23

### Added

- Add `linear-implement` as the Delivery Start owner that verifies implementation-start approval, moves Projects to Delivery, runs or reports `linear-check delivery`, selects an implementation engine, and exits to preflight.
- Add `linear-preflight` as the local branch readiness owner for worktree/diff inspection, targeted verification, self-review, commit state, and a preflight certificate consumed by `linear-ship`.
- Add `references/artifact-intake.md` for scoped discovery/review artifact intake with source precedence, freshness/conflict rules, and required confidence-boundary fields.
- Add optional consumer config field `Implementation workflow`, with backward-compatible default selection when absent.

### Changed

- Make the lifecycle explicit: `linear-idea -> discovery/reviews -> linear-handoff -> approved Issue(s) -> linear-implement -> linear-preflight -> linear-ship`.
- Update `linear-handoff` to run artifact intake before package synthesis and route explicit start-now approval to `linear-implement` instead of owning Delivery Start.
- Clarify that `linear-ship` consumes preflight output when present and remains sole owner of formal pre-ship review/check, PR creation/stabilization, review feedback, merge/deploy delegation, and Linear closeout.
- Extend consumer sync and workflow validation to include the Delivery Bridge Trio skills and copied references/templates.

## [0.7.0] - 2026-05-19

### Added

- Add an execution quality reference for PRD coverage, durable Issue writing, AFK/HITL readiness, bug/perf feedback-loop proof, tracer-bullet implementation guidance, and deep/risky architecture review.

### Changed

- Strengthen PRD and Issue contracts with actor/capability/benefit coverage, behavior-validation intent, agent readiness, dependencies, key contracts, and bug/perf current-vs-desired reproduction shape.
- Make consumer install checks fail while `.agents/linear-workflow.config.md` still contains unresolved `<...>` placeholders.

## [0.6.0] - 2026-05-18

### Changed

- Make `linear-idea`, `linear-handoff`, `linear-review`, `linear-check`, and `linear-ship` user-facing responses outcome-first and more human: product-first idea intake, artifact-map handoff summaries, human review/check meanings, explicit next-step options, and review/CI status that explains whether a PR is actually ready to land.
- Add a shared human-friendly output contract with status translation, checked/not-checked confidence boundaries, consequence-aware decision prompts, fresh-agent handoff guidance, and blocked/timed-out response shape.

## [0.5.0] - 2026-05-18

### Added

- Add `linear-review` as a report-only quality and risk review gate for Project, PRD, Tech Spec, Issue, and pre-ship packages.
- Add shared questioning, artifact-quality, readiness-gate, and review-rubric references plus a review output template.
- Add workflow validation through `scripts/validate-workflow.mjs`.
- Add generated consumer-local `.agents/linear-workflow-check.mjs` plus copied asset and wrapper hashes in the install lockfile.

### Changed

- Strengthen PRD, Tech Spec, and Issue templates with review-gate fields, traceable IDs, richer acceptance, implementation units, failure modes, validation, and rollback expectations while preserving product-brief Project bodies.
- Update `linear-handoff`, `linear-check`, and `linear-ship` around the risk-based review gate while keeping `linear-check` as readiness-only.
- Make consumer install checks compare copied `references/` and `templates/` against upstream instead of checking only sentinel files.
- Make workflow validation exercise consumer-sync behavior with fixtures for edited, missing, extra, and redirect-stub generated files.
- Keep Linear-facing template headings in Russian while preserving repo skill instructions in English.

## [0.4.0] - 2026-05-17

### Changed

- Pre-v1.0 workflow behavior change: make `linear-handoff` the primary post-discovery route and reposition atomic PRD/Spec/Issue skills as internal/advanced helpers.
- Keep Projects in Discovery through PRD and Tech Spec creation; Delivery now requires approved execution Issue(s).
- Define package approval, implementation-start approval, and delivery checks so handoff cannot silently become implementation.
- Replace Project and Tech Spec templates that leaked workflow mechanics into Linear-facing artifacts.
- Strengthen PRD/Tech Spec/Issue skill contracts with WHAT/HOW/execution separation, PRD requirement IDs, acceptance examples, and content-shape checks.
- Reserve future install/update workflow changes for explicit versioned releases.

### Added

- Add a lightweight regression smoke script and a Profile Workbench example for the first Zeni dogfood failure mode.

### Fixed

- Artifact smoke failures now use portable ESM path resolution and de-duplicated unreadable-file diagnostics.

## [0.3.0] - 2026-05-17

### Added

- Extend `linear-ship` into a full Ship-phase orchestrator around configured PR creation, review feedback, merge/deploy, and Linear closeout workflows.
- Add optional consumer config fields for review feedback and merge/deploy workflows.
- Add ship feedback-loop reference and ship output template.

## [0.2.0] - 2026-05-17

### Added

- `linear-handoff` as the post-discovery bridge from review outputs into Project, PRD, Tech Spec, and Issue(s).
- Full-copy consumer sync through `scripts/sync-consumer.mjs`.
- Consumer install checks that reject stale generated skills, missing copied references/templates, unmanaged Linear skills, and redirect-stub patterns.
- Consumer sync now removes orphaned generated `linear-*` skill and wrapper directories before writing the current upstream set.
- Consumer template-copy checks now require both `project.md` and `check-output.md` sentinels.
- `upstreamVersion` and full upstream commit metadata in `.agents/linear-workflow.lock.json`.

### Changed

- Consumer installs now generate executable `.agents/skills/linear-*` copies instead of thin workflow-source redirects.
- `.claude/skills/linear-*` is discovery-only and points to the generated `.agents` skill body.
- `linear-idea` and `linear-check` now route discovery plans through `linear-handoff` before implementation.

## [0.1.0] - 2026-05-17

### Added

- Two generated wrapper modes:
  - `self` mode for dogfooding this repository from its current checkout.
  - `consumer` mode for pinned, reviewable installs in repos like Zeni.
- Consumer lockfile contract at `.agents/linear-workflow.lock.json`.
- Install, update, check, and smoke-test scripts for wrapper generation and drift checks.
- Versioning reference for SemVer, lockfiles, wrapper hashes, and breaking-change policy.
