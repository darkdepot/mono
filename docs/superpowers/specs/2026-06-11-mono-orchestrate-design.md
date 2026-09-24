# mono-orchestrate Design Spec

Date: 2026-06-11
Status: approved by user (design review via HTML companion document)
Source inspiration: `steipete/agent-scripts` `maintainer-orchestrator` skill, adapted
to the mono-agent-workflow lifecycle and runtimes.

## Problem

The workflow performs well but requires the user to act as a full-time dispatcher:

- The user manually moves work between stage skills (`mono-idea` →
  `mono-handoff` → `mono-implement` → `mono-preflight` → `mono-ship` →
  `mono-deploy`).
- ~80% of agent questions are confirmations of the agent's own recommendation;
  agents idle while waiting for them.
- Multi-issue projects (3-4 Issues) force context shuttling across sessions,
  which is the most painful part of resuming work.
- Decisions where the user is genuinely needed are narrow: idea direction,
  scope, design/UX, and product risk.

## Goal

A control-plane orchestrator skill (`mono-orchestrate`) that runs the full
lifecycle (idea → deploy) for one product per session, drives multiple Linear
projects and Issues in parallel through worker sessions, answers all technical
questions itself, and escalates only product decisions to the user —
immediately and interactively, as prepared decision briefs.

## Approved User Decisions

1. **Coverage**: full lifecycle, idea → deploy. Discovery dialogue happens live
   in the orchestrator session with the user.
2. **Decision authority**: product, scope, design, and product risk belong to
   the user; everything technical (including PR stabilization and merge/deploy
   per configured policy) is delegated to the orchestrator.
3. **Interaction rhythm**: every escalation is asked immediately as an
   interactive question with options and a recommendation; no digest batching.
4. **Session scale**: one orchestrator session per product/repo, managing
   multiple Linear projects and Issues in parallel with dependency awareness.
5. **Worker model**: a fleet of separate, visible worker sessions. In Claude
   Code Desktop workers are spawned via task chips (one user click per spawn;
   per-message confirmation for steering is accepted by the user). Codex
   support is a day-one requirement via its native thread management.
6. **Worker context**: the full context snapshot (Project, PRD, Tech Spec,
   Issue) is embedded in the worker's spawn prompt so the worker starts
   immediately without waiting for Linear MCP availability.

## Architecture: Three Roles

### User

- Talks only to the orchestrator session.
- Decides: idea direction, handoff package approval (scope + Issue slicing),
  scope drift, design/UX, product risk (money, user data, irreversible
  production actions, external access), deploy approval when the configured
  `deployApproval` policy requires it.
- Confirms worker spawn chips and steering messages (runtime-imposed clicks).

### Orchestrator (`mono-orchestrate`, one session per product)

Control-plane only — it never implements, fixes code, or edits PRs itself.

Owns:

- Idea intake (`mono-idea`) and discovery dialogue with the user, run
  directly in the orchestrator session.
- `mono-handoff` execution (Linear-heavy, code-light).
- All Linear mutations: lifecycle status moves, comments, certificates. Single
  writer; workers never write to Linear and queue every stage-required
  mutation into their reports.
- Worker dispatch, monitoring, technical question answering, stage
  transitions, and `mono-deploy` delegation.
- The persistent ledger and decision log.

Boundaries:

- Existing skill ownership is untouched: `mono-implement` still owns Delivery
  Start, `mono-ship` owns the PR lifecycle, `mono-deploy` owns merge and
  closeout. The orchestrator routes work into those skills, it does not absorb
  them (per AGENTS.md: no monolithic delivery skill).
- Self-decided answers are recorded in the ledger as decided-by-orchestrator
  entries with a one-line reason; the user can override any of them later.

### Workers (one session per Issue)

- Run `mono-implement` → `mono-preflight` → `mono-ship` sequentially in
  the same session/worktree to preserve context across stages.
- Operate under an AFK contract embedded in the spawn prompt:
  - never ask the user; any gate or question becomes a structured report with
    the worker's own recommendation;
  - one Issue per worker; no sub-workers; no touching other Issues' files;
  - never write to Linear; queue all stage-required mutations into the report;
  - write an exit report to the mailbox at stage completion or on any blocker.
- Worker naming follows `ISSUE-KEY: stage` (e.g. `ZEN-42: implement`).

## Stage Ownership Map

| Stage | Owner | Notes |
| --- | --- | --- |
| `mono-idea` | Orchestrator + user | 1-3 direction questions to the user |
| Discovery | User + orchestrator | live dialogue; scope/design decided by user |
| `mono-handoff` | Orchestrator | one package-approval brief to the user |
| `mono-implement` | Worker | start authorized by package approval |
| `mono-preflight` | Worker | autoreview clean gate unchanged |
| `mono-ship` | Worker | PR loop to green certificate |
| `mono-deploy` | Orchestrator | per `deployApproval` policy |

Package approval remains the user's scope-control moment. After it, the
orchestrator grants implementation start itself (explicitly recorded, using
the existing bundled-approval mechanism from `mono-implement`).

## Worker Transport Abstraction

The skill defines three transport operations — spawn worker, continue worker,
read worker reports — with per-runtime bindings:

1. **Claude Code Desktop**: spawn via task chip (self-contained prompt; user
   clicks once; worktree provided by the platform). Continue/steer via
   session messaging with user confirmation. Workers are visible as normal
   sessions the user can open.
2. **Codex**: native thread creation/steering (the original
   maintainer-orchestrator model); no per-message clicks.
3. **Fallback (CLI/headless)**: named long-lived background subagents inside
   the orchestrator session; same contract and reporting.

Expected interaction cost in Claude Code Desktop: ~3-4 clicks per Issue
(1 spawn + 2-3 stage-transition/steering confirmations).

## Reporting: File Mailbox

Workers report through files, not transcript parsing:

- Mailbox root: `~/.mono-agent-workflow/orchestrator/<product>/`
- Reports: `reports/<ISSUE>-<stage>.json` with: issue, stage, terminal status
  (reusing existing exit statuses plus `needs-decision`), branch, changed
  files, tests run/not run, optional question + worker recommendation, queued
  Linear mutations, next workflow.
- Ledger: `ledger.md` — dated, high-level entries: dispatches, self-decided
  answers, user decisions, lands, deploys, blockers. No secrets, no routine
  polling entries.

The mailbox lives outside project repos (project repos keep only
`.agents/mono-workflow.config.json`, per existing policy).

## Decision Authority Matrix

User (immediate interactive question, decision-brief format):

- Idea direction and scope: package approval, Issue slicing, scope drift.
- Design/UX: always with prepared side-by-side mockups (via `/design-html`
  when the runtime provides it, concrete textual variants otherwise — existing
  questioning policy inherited).
- Product risk: money, user data, irreversible production actions, external
  access.
- Deploy when `deployApproval` policy requires it (`always`, or any risk
  class except `tiny` under `risky-only`).

Orchestrator (decides itself, records in ledger):

- All technical decisions and worker technical questions.
- Implementation start after package approval.
- Technical review-finding acceptance, CI repair, PR stabilization.
- Merge/deploy for risk classes allowed by the configured `deployApproval`.

## Decision Briefs

No unprepared questions. Before asking, the orchestrator:

1. Exhausts autonomous work — a question is asked only when it is the last
   blocker for that item.
2. Prepares visual variants for design questions.
3. Refreshes item state immediately before asking; never re-asks an answered
   question or presents a stale item as decision-ready.

Brief contents: what changes and for whom; why the decision is needed now;
completed proof (tests, autoreview, CI, certificates as applicable);
recommendation with rationale; exact options. Asked immediately and
interactively (AskUserQuestion-style with options + recommendation).

## Monitoring Protocol (adapted from maintainer-orchestrator)

- Do not steer an actively progressing worker; do not raise the proof bar
  mid-flight; polling alone never justifies intervention.
- Intervene only on: worker-requested decision, exhausted work, repeated
  failures with no progress, gross divergence from the assigned Issue, or
  unsafe mutation.
- Read the worker's latest state before any intervention.
- Stuck/dead worker: reconstruct stage state from Linear + last mailbox report
  (branch survives in the worktree), respawn a worker to continue, not restart.
- Material scope drift: stop the worker, escalate to the user through the
  existing `scope-drift-needs-handoff` path.

## Recovery / Resume

Session state is reconstructable, by design:

- Source of truth: Linear (project lifecycle states, Issue statuses, comments,
  certificates).
- Working state: ledger + mailbox on disk; live worker sessions discoverable
  via runtime session listing.
- A fresh orchestrator session runs a resume procedure: scan Linear for
  in-flight projects, read ledger/mailbox, list live workers, rebuild the
  status table, and continue. Orchestrator session death loses nothing.

## Deliverables

- `skills/mono-orchestrate/SKILL.md` — routing text, roles, workflow states,
  exit statuses, read-first list (per skill design rules).
- `references/orchestration.md` — authority matrix, monitoring protocol,
  transport bindings, mailbox/ledger contract, resume procedure.
- `templates/orchestrator-dispatch.md` — worker spawn prompt template (context
  snapshot + AFK contract), Russian-facing where user-visible.
- `templates/orchestrator-brief.md` — decision brief + status update shapes
  (Russian, per human-friendly-output conventions).
- `templates/orchestrator-report.md` — mailbox report schema and ledger entry
  shapes.
- Updates: `scripts/validate-workflow.mjs` (new skill/templates validation),
  `README.md`, `AGENTS.md`, `references/lifecycle.md` (orchestrator role),
  `references/questioning.md` (escalation routing when orchestrated).

Out of scope:

- No changes to project repos beyond optionally switching the first consumer's
  `deployApproval` to `risky-only` (separate, explicit step).
- No new external services; mailbox is plain files.
- No automation of runtime-imposed confirmation clicks.
- No replacement or merging of existing stage skills.

## Constraints Carried Forward

- `mono-review` stays report-only; `mono-check` stays readiness-only.
- Preflight's mandatory `autoreview` clean gate is unchanged.
- Linear-facing output language follows project config (Russian for current
  projects); repo artifacts stay English.
- Lifecycle gate ordering (`references/lifecycle.md`) is preserved verbatim;
  the orchestrator sequences gates, it does not skip or weaken them.
