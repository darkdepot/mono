# Worker Dispatch Prompt

Generator instructions: fill every placeholder and emit one Issue/stage dispatch.
Use Generated dispatch as audience adapter in `references/orchestration.md`:
select configured `orchestration.workerAudience` (default `gpt-worker`), preserve
its redundancy matrix and reading floor. Repeat rules only where that profile
requires them; never soften/replace them. Both audiences get exact facts,
protected paths/hashes, verification lines and the resolved identity command.

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

- Outcome: <durable end state>
- Verification surface: <every Issue «Как проверить» line verbatim, in order;
  runnable commands or judgment checks; maps 1:1 to `verification_items` under
  `references/worker-contract.md`>
- Constraints: <exact protected surfaces/hashes, contracts, statuses, gates>
- Blocked protocol: follow the stage and worker contract; report failed/skipped
  verification, never wave it through.
- Stage budget: <monitoring guidance, not a gate>

## Engine

- Transport: <codex-cli | claude-code-desktop | fallback>
- Stage skill body: <absolute installed stage SKILL.md path; read fully before
  work for codex-cli; invoke installed skill for other transports>
- Project config: `.agents/mono-workflow.config.json`
- Pack identity gate: <fully resolved `verify-pack-state.mjs identity` command
  from Pack identity gate invocation in `references/worker-contract.md`, all
  four flags, absolute installed paths and dispatch pins; single-quote values,
  escape embedded quotes as `'\''`; require exit 0 and
  `pack-state: identity verified`. Do not substitute checkout SURFACE_REVISION>
- Sandbox: <exact stage grants from worker contract, including mailbox root>
- Report delivery: <absolute mailbox path and worktree fallback>

The codex-cli installed root is `~/.codex/skills/`. Emit this command with every placeholder resolved; it is invocation data, not a second gate definition:

```bash
node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity \
  --lock '<installed-skills-root>/.mono-agent-workflow.lock.json' \
  --pack-version '<packVersion above>' \
  --source-commit '<sourceCommit above>' \
  --surface-revision '<surfaceRevision above>'
```

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

For a dispatch with no lifecycle move emit only:
`- Gate phase: not applicable — this dispatch carries no lifecycle move.`
Otherwise resolve these facts; execute Two-Phase Dispatch Handshake in the
worker contract without redefining it:

- Lifecycle moves: <every move, still unapplied; snapshot deliberately pre-move>
- Gates: <exact gate names from implement steps 1–4; issue-only adds delivery>
- Gate-ack: <absolute reports/<ISSUE-KEY>-gate-ack-a<N>.json and fallback path>
- Pause/resume: <transport-specific stop; resumed amendment with every applied
  move/read-back, then identity again; blocked ack precedes terminal report>

## AFK Contract

Apply `references/worker-contract.md`: snapshot-only Linear access, single
writer, one Issue, no sub-workers/session management, no user questions,
report-before-stop, unchanged gates/statuses and stage-owned branch. Generate
profile-required redundancy from that source verbatim; do not invent a second
AFK contract. Every pending Linear comment/status/certificate uses the required
report shape; certificate text occurs once with `append #/certificate` in its
queued comment.

## Mailbox

- Exit report: <absolute orchestrator reports/<ISSUE-KEY>-<stage>.json>
- Fallback on denied write: <absolute worktree/.orchestrator/<ISSUE-KEY>-<stage>.json>
- Shape: Worker Report in `references/worker-contract.md`.
- Write on completion/blocker/other stop, except a passed gate-pause ack.
- Never commit `.orchestrator/` or touch orchestrator-owned state.

## Authorization

- Allowed: <exact stage-appropriate scope; push/PR only for ship>
- Not allowed: direct Linear writes, merge/deploy/Issue closeout, other Issues
  or orchestrator state. Stage rules win on rules; dispatch wins on facts.
