# Worker Dispatch Prompt

Generator instructions: fill every placeholder and emit one Issue delivery dispatch.
Use Generated dispatch as audience adapter in `references/orchestration.md`:
select configured `orchestration.workerAudience` (default `gpt-worker`), preserve
its redundancy matrix and reading floor. Repeat rules only where that profile
requires them; never soften/replace them. Both audiences get exact facts,
protected paths/hashes, verification lines and the resolved identity command.
Before rendering Codex dispatch, run installed `orchestrator/spawn.mjs --pins <request-json>`;
Claude transports use installed `runtime.mjs --role worker-claude --worktree <repo> --base <commit>`.
Copy `modelRoutes` unchanged into launch and every preflight request. It
resolves the selected worker and autoreview roles from immutable BASE config;
the worker diff never selects its own reviewer.

## Assignment

- Issue: <ISSUE-KEY> — <title>
- Delivery skill: mono-deliver
- Attempt: <positive integer>
- Gate request: <absolute start-gate JSON; lock/pins/worktree/branch/base>
- Runtime scripts: <absolute installed scripts directory>
- Product: <product slug>
- evidenceRoot: <absolute ~/.mono-agent-workflow/evidence/<product>/ outside EVERY worker-writable root>
- Model routes: <modelRoutes JSON: base, configDigest, roles with engine/model/effort or effortByRisk/provider/credentialEnv/fingerprint; variable names only>
- Preflight pins: <installed skillsRoot, approved risk/critical, exact verification command/args, baseRef>
- workerWritableRoots: <complete absolute grants, including temporary roots and the worktree-specific Git directory and the common Git directory, derived from the worktree; only <root>/reports within orchestrator root; copy to capsule.writable_roots>
- Collection: orchestrator collect:true outside worker sandboxes; worker collect:false only
- Confirmation timeout: <configured seconds>
- Worktree/branch: <path / branch>
- Worker session name: `<ISSUE-KEY>: mono-deliver`
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
- Delivery budget: <monitoring guidance, not a gate>

<!-- review-pilot:start -->
## Review discipline for this task (experiment for project <PROJECT>)

Generator: include this block only for the explicitly approved pilot Issues. It
repeats and sharpens the stage owners' rules; it never replaces or relaxes them.

<!-- review-pilot:matrix -->
### Repeated invariant

For two finding-bearing review events linked by the orchestrator to one
`findingKey` in this attempt, supply `behaviour_matrices` before requesting
another collection: `invariant`, `states` with `state` and `expected`, targeted
`verification`, and `decisionIds` referring to this report's dispositions.
The orchestrator checks the matrix and test result before requesting collection.
A matrix waiver exists only as a journal entry with a reason.

<!-- review-pilot:checkpoint -->
### Five answers when progress stops

After two consecutive rounds adjudicated as `none`, supply `checkpoint`:
`confirmedDefects` (what remains broken), `evidence` (what proves it),
`failedFixes` (what was tried and why it failed), `nextExperiment` (the smallest
next test), `stopCondition` (what result changes the next action).
Supply `progress_claim` with `progress`, `evidence`, and `eventIds`; the
orchestrator decides whether progress occurred before requesting collection.

<!-- review-pilot:dispositions -->
### Evidence for dispositions

Propose `review_dispositions` as typed `decision` entries with `id`, `eventId`,
`findingKey` supplied by the orchestrator, `problem`, `trigger`, `evidence`,
`impact`, `origin`, `decision`, `validity`, `verification`, `supersedes`,
`proposedBy`, and `recordedAt`. The orchestrator checks and records proposals.
Never infer a finding key. Missing identity goes back to the orchestrator.

<!-- review-pilot:reopening -->
### Previously refuted findings

Without a new fact, answer a repeated refuted finding with the decision `id`
and evidence, without another code edit. A contradictory reproduction can
justify a new decision with `supersedes`; a new trigger is a new finding.
A finding still required by the gate remains unresolved: park through the
existing decision path. Journal entries cannot turn findings into clean proof.

<!-- review-pilot:local -->
### Local reviewer calls

Keep the phase's required model, effort, threshold and clean-result rule.
Add `--stream-engine-output` and the pinned `--dataset` path to every local
call. Preserve the output and reference the collection request in the report.
A diagnostic hint never supplies a certificate or waives a stage check.

<!-- review-pilot:dataset -->
### Pinned materialized dataset

- datasetVersion: <immutable version number>
- datasetPath: <.orchestrator/review-dataset-<d8>.md>
- datasetDigest: <SHA-256 of the pinned version>

The orchestrator materializes this ordinary, ignored file and verifies its
digest before local review. Use it unchanged. A new version needs a fresh
materialization and dispatch pin before the next call; the collector still
makes its own verified copy. The orchestrator removes materializations at the
end of the attempt. Missing matrix/checkpoint evidence causes a recorded
`withheld` request, with a reason, and no collection call.
<!-- review-pilot:end -->

## Engine

- Transport: <codex-cli | claude-code-desktop | fallback>
- Delivery skill body: <absolute installed mono-deliver/SKILL.md path; read fully before
  work for codex-cli; invoke installed skill for other transports>
- Project config: `.agents/mono-workflow.config.json`
- Pack identity gate: <fully resolved `verify-pack-state.mjs identity` command
  from Pack identity gate invocation in `references/worker-contract.md`, all
  four flags, absolute installed paths and dispatch pins; single-quote values,
  escape embedded quotes as `'\''`; require exit 0 and
  `pack-state: identity verified`. Do not substitute checkout SURFACE_REVISION>
- Sandbox: <workspace-write, network, worktree, the worktree-specific Git directory and the common Git directory, derived from the worktree, and mailbox writable roots; phase authority still limits writes>
  codex 0.153.4 protects the metadata directory of an explicitly listed linked worktree.
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

- Exit report: <absolute orchestrator reports/<ISSUE-KEY>-mono-deliver.json>
- Fallback on denied write: <absolute worktree/.orchestrator/<ISSUE-KEY>-mono-deliver.json>
- Shape: Worker Report in `references/worker-contract.md`.
- Write on completion/blocker/other stop, except a passed gate-pause ack.
- Never commit `.orchestrator/` or touch orchestrator-owned state.

## Authorization

- Allowed: <one Issue delivery; push/PR only inside ship after its gates>
- Not allowed: direct Linear writes, merge/deploy/Issue closeout, other Issues
  or orchestrator state. Stage rules win on rules; dispatch wins on facts.

## Recovery

On interruption resume the same thread with the current snapshot amendment and the latest own phase capsule/confirmation paths. Re-run identity and continue that phase; do not generate a stage-specific dispatch or resume template. Require a confirmed whole queue before advancing.

Set write.id=request.collectionId=preflight-collect:<head>:<n>; increment n per collection request on that head. Preserve the ID on lost-response reconciliation; a failed run is recorded, its retry gets a new ID.

Pass evidenceRoot and workerWritableRoots to spawn; any resume grant expansion requires this dispatch pin to be amended to the complete effective roots and supplied to resume.
