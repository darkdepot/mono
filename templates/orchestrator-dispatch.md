# Worker Dispatch Prompt

<!-- generator:start -->
Generator instructions: fill every placeholder and emit one Issue delivery dispatch.
Use Generated dispatch as audience adapter in `references/orchestration-dispatch.md`:
select configured `orchestration.workerAudience` (default `gpt-worker`), preserve
its redundancy matrix and reading floor. Repeat rules only where that profile
requires them; never soften/replace them. Both audiences get exact facts,
protected paths/hashes, verification lines and the resolved identity command.
Before rendering Codex dispatch, run installed `orchestrator/spawn.mjs --pins {{spawn_request}}`;
Claude transports use installed `runtime.mjs --role worker-claude --worktree {{worktree}} --base {{base}}`.
Copy `modelRoutes` unchanged into launch and every preflight request. Worker
and review roles resolve from immutable BASE config; the worker diff never
selects its own reviewer.

For pre-application append a «Предприменённые изменения» block naming the
verified orchestrator commit and its path/sha256 table before launch. The worker
compares `git show <sha>` blobs to that block and the snapshot manifest at start.

<!-- generator:end -->

## Assignment

- Issue: {{issue}} — {{title}}
- Delivery skill: mono:deliver
- Attempt: {{attempt}}
- handshake: {{handshake}} (default resume)
- profile: {{profile}} (default full; short requires tiny/standard, critical null, afk true, openDecisions 0)
- pins: {{pins_file}} / {{pins_digest}} (immutable for this attempt)
- Gate request: {{gate_request}} (lock/pins/worktree/branch/base)
- Pack root: {{pack_root}}
- Runtime scripts: {{runtime_scripts}}
- Product: {{product}}
- evidenceRoot: {{evidence_root}} (outside EVERY worker-writable root)
- Model routes: {{model_routes}}
- Preflight pins: {{preflight_pins}}
- workerWritableRoots: {{writable_roots}} (complete grants including temporary and derived Git directories; only reports within orchestrator root; copy to capsule.writable_roots)
- Collection: the collector started with this attempt runs collect:true outside worker sandboxes; worker collect:false only
- Round request: {{round_request}}
- Worktree/branch: {{worktree}} / {{branch}}
- Worker session name: `{{issue}}: mono-deliver`
- Chip title (user-visible, Russian): `{{issue}}: доставка`
- packVersion: `{{pack_version}}`
- sourceCommit: `{{source_commit}}`
- surfaceRevision: `{{surface_revision}}`

<!-- landing:start -->
## Посадка

- Общие пути: {{landing_paths}}
- Каталог записей: {{landing_fragments}}
- Задача-релиз: {{landing_release}}

<!-- landing:end -->

<!-- host-verification:start -->
## Проверка на хосте

Pinned `hostVerification: true`: the full verification (the pinned
`verification` command) needs the host, so the collection runs it on the
committed head outside your sandbox, before the review round, and the round
receipt carries its exit code. Do not run it in the sandbox and do not park for
it: run focused checks, report the full verification as `unverified` /
`deferred` with the reason «проверка на хосте в круге ревью», then commit and
request the round without `workerVerification`. The line
`verification failed on this head on the host` is a fix: read the named log,
fix, commit and request again (a flaky run: the same head with the next
collection number). Readiness cites the receipt's host verification.

<!-- host-verification:end -->
## Запрос сбора

Use this pinned preflight request; replace HEAD in head/collectionId with the
committed SHA and increment the collection number on retry. Gate-side reads of
registry/dispatch are allowed. Worker reads there are limited to its pinned
snapshot/design.json and snapshot/design/*.png; other dispatch state stays closed.
Run preflight with collect:false. Exit 2 is pending, not pass: write
`{"issue","attempt","request":<returned publishRequest>}` to the round request
file, run `{{wait_round}}` in the foreground, then rerun collect:false. Never
construct a replacement request from the error text.

```json
{{collection_request}}
```

## Goal Contract

- Outcome: {{outcome}}
- Verification surface: {{verification_items}}
  Retain every line verbatim/in order as verification_items under references/worker-contract.md.
- Constraints: {{constraints}}
- Approach change for this attempt: {{approach_change}} (do this differently from the previous attempt)
- Blocked protocol: follow the stage and worker contract; report failed/skipped
  verification, never wave it through.
- Delivery budget: {{budget}} (guidance, not a gate)

## Engine

- Transport: {{transport}}
- Delivery skill body: {{delivery_skill}}; read fully before work for codex-cli; invoke installed skill for other transports
- Project config: `.agents/mono-workflow.config.json`
- Pack identity gate: {{identity_command}}; all present identity pins, single-quoted paths/values; require exit 0 and pack-state: identity verified; never substitute checkout SURFACE_REVISION
- Sandbox: workspace-write, network ON, {{writable_roots}}; phase authority still limits writes
  codex 0.153.4 protects the metadata directory of an explicitly listed linked worktree.
- Report delivery: {{mailbox}}; fallback {{fallback}}

<!-- claude-delivery:start -->
### Claude Code delivery differences

Start acknowledgement uses `resume`: write the gate acknowledgement and stop.
The orchestrator applies and reads back the moves, then resumes this same session
with the read-back. A request for start-handshake `wait` is refused.

The review round follows worker-contract. Run the pack's plain
`node '<pack-root>/scripts/delivery-state.mjs' wait-round --request '<round request>'`
invocation in the foreground. Never background it or replace it with
sleep/polling; a refused command is reported through the existing stop protocol.

The review round runs only in external collection on a committed head. Fix open
findings, commit, write the returned request as the round request and wait for its result;
only a passing `collect:false` gate permits readiness. Record the delivery
difference in the ready certificate. Phase/terminal reports must identify this
registered Issue and attempt; a final model answer alone is not green or parked.

Never print credential values. Claude Code's own owner-only session transcripts
persist command output outside the pack journal's redaction, like Codex logs.
<!-- claude-delivery:end -->

Emit the resolved command below; it is invocation data, not a second gate definition:

```bash
{{identity_command}}
```

## Context Snapshot

Chain input (final predecessor reports and merged commits, copied into this
attempt snapshot): {{chain_context}}

Design input: {{design_context}}

Read approved PNGs from that snapshot directory before UI code; apply the textual
owner/product taste rules from the Issue context. Never copy or commit PNGs into
the worktree. Live screen comparison is Deploy in a browser session.

Snapshot composition: {{snapshot_note}}. Short includes Issue, approval, brief, referenced definitions and common PRD/Spec sections; full retains complete documents. Issue-only includes no Project documents.

Approval record:
{{approval}}

- Project brief: {{project_brief}}
- PRD: {{prd}}
- Tech Spec: {{spec}}
- Issue: {{issue_body}}
- Issue-only marker: {{marker}}
- Verified label: {{label}}
- Scope fingerprint: {{fingerprint}}
- Issue-only config: {{issue_only_config}}
- Owner approval: {{owner_approval}}
- Context seam: {{context_seam}}
- Decisions so far: {{decisions}}

## Gate Phase

For a dispatch with no lifecycle move emit only:
`- Gate phase: not applicable — this dispatch carries no lifecycle move.`
Otherwise resolve these facts; execute Two-Phase Dispatch Handshake in the
worker contract without redefining it:

- Lifecycle moves: {{moves}}; still unapplied, snapshot deliberately pre-move
- Gates: {{gates}}
- Gate-ack: {{gate_ack}}; fallback {{fallback}}/{{issue}}-gate-ack-a{{attempt}}.json
- Wait/resume: {{wait_or_resume}}; wait uses installed delivery-state.mjs wait-ack, resume carries the applied-move read-back.

## AFK Contract

Apply `references/worker-contract.md`: snapshot as Linear context, one Issue,
no sub-workers/session management, no user questions
(no `AskUserQuestion` or `request_user_input*`; blockers go to the mailbox),
report-before-stop, unchanged gates and stage-owned branch. Generate
profile-required redundancy from that source verbatim; do not invent a second
AFK contract. You are the sole writer of this Issue's reports, comments and
statuses: write them through Linear MCP (`save_comment`, `save_issue`) and read
each back before advancing (worker-contract Linear Writes). The orchestrator
writes only the start move and «Изменение задачи». Certificate text occurs once
in its comment.

## Mailbox

- Exit report: {{mailbox}}/{{issue}}-mono-deliver.json
- Fallback on denied write: {{fallback}}/{{issue}}-mono-deliver.json
- Shape: Worker Report in `references/worker-contract.md`.
- Write on completion/blocker/other stop, except a passed gate-pause ack.
- Never commit `.orchestrator/` or touch orchestrator-owned state.

## Authorization

- Allowed: this one Issue delivery; its Linear comments/statuses via Linear MCP;
  push/PR only inside ship after its gates
- Not allowed: other Linear tools or Issues, merge/deploy/Issue closeout, start
  moves or orchestrator state. Stage rules win on rules; dispatch wins on facts.

## Recovery

On interruption the orchestrator resumes the same thread; a task change arrives as the link to an «Изменение задачи» comment on the Issue: read it there and follow it. Re-run identity and continue from the latest own phase capsule; do not generate a stage-specific dispatch or resume template. Read back Linear before repeating any write; a written round request is waited for before advancing.

Set request.collectionId=preflight-collect:HEAD:n; increment n per round request on that head. Keep the ID while waiting for its result; a failed or refused round is recorded, a new request gets a new ID.

Pass evidenceRoot and workerWritableRoots to spawn; a risk or grant change is a new attempt on the same branch.
