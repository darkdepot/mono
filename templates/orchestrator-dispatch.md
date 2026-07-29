# Worker Dispatch Prompt

Template for spawning one worker session per Issue from `mono-orchestrate`.
Fill every placeholder. The worker must be able to start immediately with no
Linear access: the snapshot below is its whole world for the whole stage,
whether or not Linear MCP is reachable. Reachability never re-opens direct
Linear access — see Mode precedence in the AFK Contract below.

## Assignment

- Issue: <ISSUE-KEY> — <title>
- Stage skill: <mono-implement | mono-preflight | mono-ship>
- Worktree/branch: <path / branch>
- Worker session name: `<ISSUE-KEY>: <stage>`
- Chip title (user-visible, Russian): `<ISSUE-KEY>: <стадия по-русски>`
- packVersion: `<installed lockfile packVersion>`
- sourceCommit: `<installed lockfile sourceCommit>`
- surfaceRevision: `<installed lockfile surfaceRevision>`

## Goal Contract

- Outcome: <one sentence — the durable end-state that must be true when this
  stage is done>
- Verification surface: <every «Как проверить» line of the Issue, one per
  line, lifted verbatim from that section and kept in its order; lines with
  a command shape are each runnable as written. A line with no command shape
  is carried verbatim too and is verified as a judgment check — the worker
  records that mode in the `evidence` of its `verification_items` entry,
  never as a status value. This list is the report's `verification_items`
  1:1; item semantics and the status enum have a single home in
  `templates/orchestrator-report.md` and are not restated here>
- Constraints: <what must not change or break — pinned contracts, protected
  files, statuses, and gates this stage must leave intact>
- Blocked protocol: when stuck, write a mailbox report with status
  `needs-decision`, include your own recommendation, and stop. You never
  judge your own "done": a failing or skipped verification item is reported,
  not waved through.
- Stage budget: <stage time guidance from the Monitoring Protocol —
  guidance, not a gate>

## Engine

- Transport: <codex-cli | claude-code-desktop | fallback>
- Your worktree is pre-created by the orchestrator; work only inside it.
- Stage skill body: read `~/.codex/skills/<stage-skill>/SKILL.md` fully before
  starting and follow it exactly; its `references/` and `templates/` live
  beside it. (For claude-code-desktop or fallback workers: invoke the
  installed `<stage-skill>` skill instead.)
- Project config: `.agents/mono-workflow.config.json` at the repo root.
- Pack identity gate — run exactly this command before starting the stage and
  again after every resume, and require exit 0 with
  `pack-state: identity verified`:

  ```bash
  node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity \
    --lock '<installed-skills-root>/.mono-agent-workflow.lock.json' \
    --pack-version '<packVersion above>' \
    --source-commit '<sourceCommit above>' \
    --surface-revision '<surfaceRevision above>'
  ```

  Emit it fully resolved — absolute paths and the three pins substituted —
  and keep the single quotes shown above, escaping any embedded single quote
  as `'\''`, so it runs as written from the worktree with no guessing. Any
  `packVersion`, `sourceCommit`, or `surfaceRevision` mismatch, or any
  non-zero exit, is a hard `blocked` exit; do not continue on the locally
  installed pack. Path base, flags, lockfile, and quoting rules live in the
  Pack identity gate invocation section of `references/orchestration.md`.
- Report delivery: write to the mailbox path below. If the sandbox denies
  that write, write the same JSON to
  `<worktree>/.orchestrator/<ISSUE-KEY>-<stage>.json` instead; never commit
  `.orchestrator/`.

## Context Snapshot

- Project brief: <full text, or `n/a (issue-only)`>
- PRD: <full text, the sections relevant to this Issue, or `n/a (issue-only)`>
- Tech Spec: <full text, the contracts relevant to this Issue, or `n/a (issue-only)`>
- Issue: <full Issue body, verbatim>
- Issue-only marker: <current marker comment verbatim, or `n/a (project-first)`>
- Verified label: <`issue-only`, or `n/a (project-first)`>
- Scope fingerprint: <fresh whole-body SHA-256, or `n/a (project-first)`>
- Issue-only config: <`enabled=true; ownerPrincipal=<stable Linear user ID>`, or `n/a (project-first)`>
- Owner approval: <authenticated author plus approved fingerprint, or `n/a (project-first)`>
- Context seam: <resolved 5-field JSON, or `n/a` when resolution is blocked>
- Decisions so far: <user decisions and «Решил сам:» entries relevant to this
  Issue, one line each>

## Gate Phase

Fill this section when this dispatch carries a lifecycle move — a project's
first `mono-implement` dispatch, or an issue-only activation. Otherwise emit
exactly `- Gate phase: not applicable — this dispatch carries no lifecycle
move.` and drop the rest of the section. The protocol has one home, the
Two-Phase Dispatch Handshake section of `references/orchestration.md`; this
block only resolves it for this Issue.

- Lifecycle moves this dispatch carries, all still unapplied: <e.g. `Project
  «<name>» → Delivery`, or `Issue <ISSUE-KEY> → <configured started state>`.
  The Context Snapshot above is deliberately the pre-move state; that is
  correct, not stale, and it is never a finding>
- Gates to pass before you stop: <one per line — for `mono-implement`, steps
  1-4 of its orchestration branch: pack identity gate, snapshot package
  context, approval plus `mono-review handoff` findings, and the 5-field
  context seam; on the issue-only lane the delivery check joins them>
- Write the gate-ack to
  `~/.mono-agent-workflow/orchestrator/<product>/reports/<ISSUE-KEY>-gate-ack.json`
  in the shape `references/orchestration.md` fixes — `issue`, `phase`,
  `gates[]`, `status` of `gates-passed` or `blocked`. Write it on gate
  completion, on any gate blocker, and before stopping for any other reason.
  It is not a stage report and changes nothing in
  `templates/orchestrator-report.md`. If the sandbox denies that write, write
  the same JSON to `<worktree>/.orchestrator/<ISSUE-KEY>-gate-ack.json`, the
  same fallback the report uses.
- Then stop and wait to be resumed: do not apply or queue the lifecycle move,
  write code, run the delivery check, or write the stage report first.
  <codex-cli: end the turn and let the process exit. claude-code-desktop or
  fallback: end the turn and leave the session open.>
- On `status: blocked`, also write the ordinary stage report with status
  `blocked` at the Mailbox path below, then stop; no lifecycle move is
  applied.
- Your resume signal names every applied move with its read-back. Treat it as
  an amendment of the Context Snapshot above, re-run the pack identity gate
  exactly as at start, and evaluate every post-resume check — including
  `mono-check delivery` — against that amended post-move state. A resume whose
  amendment does not show this dispatch's move applied is a `blocked` report,
  never a reason to continue.

## AFK Contract

- Mode precedence: this stage runs in orchestration mode, so the Context
  Snapshot above is your entire Linear world. Apply the
  Orchestration Mode Precedence section of `references/orchestration.md` to
  every stage-skill instruction that reads or writes Linear; the rule is
  stated there, once, and is not repeated here.
- Do not ask the user. For a mid-stage question that blocks progress: write a
  mailbox report with status `needs-decision`, include your own
  recommendation, and stop. Report stage-terminal exits (including
  `needs-human` and `drift-candidate`) with the stage's own status verbatim.
- One Issue only; no sub-workers; do not manage other sessions; do not touch
  files owned by other Issues.
- Never write to Linear yourself, even when Linear is available. Produce
  every stage-required Linear mutation (comments, status moves, certificates)
  in its required shape, but deliver it through `linear_mutations_pending` in
  your report; the orchestrator applies it. A certificate travels in the
  report's `certificate` field, and the queued comment references it with
  `append #/certificate` rather than carrying a second copy — see
  `templates/orchestrator-report.md`.
- Follow the stage skill exactly, including its exit statuses and gates.

## Mailbox

- Write the exit report to
  `~/.mono-agent-workflow/orchestrator/<product>/reports/<ISSUE-KEY>-<stage>.json`
  following `templates/orchestrator-report.md`.
- Write the report on stage completion, on any blocker, and before stopping
  for any other reason.

## Authorization

- Allowed: <stage-appropriate scope, e.g. local code changes and verification;
  push and PR creation only for the ship stage>
- Not allowed: any direct Linear writes, merge, deploy, Issue closeout — the
  orchestrator owns those.
