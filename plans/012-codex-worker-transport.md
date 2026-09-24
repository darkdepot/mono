# Plan 012: codex-cli worker transport for mono-orchestrate

> **Executor instructions**: Follow this plan task by task. Each task adds
> failing validator assertions first, then writes the artifact until
> `node scripts/validate-workflow.mjs` passes, then runs the full gate
> `node scripts/verify.mjs` and commits with the exact message given.
> If anything in "STOP conditions" occurs, stop and report — do not improvise.

**Goal:** Make `mono-orchestrate` first-class for the "Claude orchestrator +
Codex executors" operating model: the orchestrator session (any runtime with
shell access, typically Claude Code) spawns one headless Codex CLI worker per
Issue via `codex exec`, steers it across stages via `codex exec resume`, and
recovers it after orchestrator death via a persisted worker registry.

**Architecture:** Pure-markdown skill pack change plus validator pins. No new
scripts. The existing mailbox/ledger contract is unchanged; a new
orchestrator-owned `workers.json` registry and a `codex-cli` transport binding
are added. Stage skills gain runtime-availability fallbacks so they degrade
gracefully inside Codex workers (where Compound/Superpowers/gstack skills are
not invocable).

**Verified Codex CLI facts (Context7, /openai/codex, 2026-07):**

- `codex exec --json` prints JSONL events; `thread.started` carries the
  thread id.
- `codex exec resume <thread-id> "<prompt>"` continues a thread
  non-interactively (`--last` picks the newest).
- `--sandbox workspace-write` bounds writes to the working directory;
  `--add-dir <dir>` adds extra writable directories; network is off by
  default and enabled with `-c 'sandbox_workspace_write.network_access=true'`.
- `--cd <dir>` sets the worker's working directory.
- `-c 'model_reasoning_effort="high"'` sets effort per invocation.

## Status

IMPLEMENTED — `node scripts/validate-workflow.mjs` (13 skills) and
`node scripts/verify.mjs` (8 checks) pass. Execution note: a platform
safety-classifier outage during the session blocked subagent dispatch, so the
controller applied Tasks 1-5 directly and validator pins were added together
with each artifact rather than as a separate failing step first; Task 6
closeout and the independent review pass ran after the outage cleared.

## STOP conditions

- `node scripts/verify.mjs` fails at a step where this plan says it must pass.
- An anchor (old_string) from this plan is not found verbatim in the live
  file — drift; stop and report.
- You are tempted to weaken a lifecycle gate, let workers write to Linear, or
  move stage ownership. Forbidden by AGENTS.md; stop and report.
- You are tempted to add new exit statuses to the worker report. The status
  set is pinned; use the new optional `notes` field instead.

## Conventions for all tasks

- Run commands from the repo root.
- Quick loop: `node scripts/validate-workflow.mjs`. Full gate before each
  commit: `node scripts/verify.mjs` (must print `Verification passed (8 checks).`).
- Skill instructions and references are English; user-facing template text is
  Russian (AGENTS.md Language rules). Machine-facing shapes stay English.
- Do not touch `VERSION` or `CHANGELOG.md` (they belong to the ship workflow).

## Shared design decisions (all tasks must stay consistent with these)

1. **Transport rename**: the `codex` binding in
   `references/orchestration.md` Worker Transports becomes `codex-cli` and is
   redefined as: the orchestrator — in any runtime with shell access — creates
   and steers headless Codex worker threads via `codex exec` /
   `codex exec resume`. It subsumes the old "orchestrator runs in Codex" case.
2. **Transport selection**: project config may set
   `orchestration.transport` (`codex-cli` | `claude-code-desktop` |
   `fallback`); config wins. Without config: prefer `codex-cli` when the
   `codex` CLI is installed and authenticated, else `claude-code-desktop` when
   running in Claude Code Desktop, else `fallback`. The chosen binding is still
   stated in the first status update.
3. **Worker registry**: `~/.mono-agent-workflow/orchestrator/<product>/workers.json`,
   orchestrator-owned (workers never touch it), one entry per Issue:
   `transport`, `thread_id`, `worktree`, `branch`, `stage`, `spawned_at`,
   `last_activity_at`, `log`. Updated on spawn/advance/respawn; read during
   resume so a fresh orchestrator can `codex exec resume` surviving threads.
4. **Canonical spawn shape** (documented, not scripted):

   ```bash
   codex exec --json \
     --cd <worktree> \
     --sandbox workspace-write \
     --add-dir ~/.mono-agent-workflow/orchestrator/<product> \
     -c 'model_reasoning_effort="high"' \
     "$(cat <dispatch-prompt-file>)" \
     > ~/.mono-agent-workflow/orchestrator/<product>/logs/<ISSUE-KEY>-<stage>.jsonl 2>&1 &
   ```

   Run in the background via the orchestrator runtime. Parse `thread.started`
   from the log for the thread id. Ship-stage spawns/resumes add
   `-c 'sandbox_workspace_write.network_access=true'` (push/PR need network).
5. **Report delivery under sandbox**: primary — the mailbox root is writable
   because of `--add-dir`; fallback — if the mailbox write is denied, the
   worker writes the same JSON to `<worktree>/.orchestrator/<ISSUE-KEY>-<stage>.json`
   and must never commit `.orchestrator/`. The orchestrator sweeps both
   locations.
6. **Worktree provisioning**: for `codex-cli` and `fallback` transports the
   orchestrator creates the worktree before spawn
   (`git worktree add <repo>/.worktrees/<ISSUE-KEY> -b <branch>`), keeps it
   across stages, and removes it only after deploy closeout.
   `claude-code-desktop` keeps platform-provided worktrees.
7. **Liveness ladder** for codex-cli workers: process exit + report = normal
   advance; process exit without report = resume the thread once demanding the
   report; resume failed or exited reportless again = stuck worker → rebuild
   from Linear + last report and respawn (Monitoring Protocol unchanged).
   Heartbeat = timestamp of the last JSONL event in the log. Stage budgets
   (guidance): implement 60m, preflight 30m, ship 90m; a ship worker that ends
   its turn before green is resumed with "continue stabilization".
8. **Skill loading in Codex workers**: the dispatch prompt names the exact
   installed skill body path (`~/.codex/skills/<stage-skill>/SKILL.md`) and
   instructs the worker to read it fully and follow it exactly; `references/`
   and `templates/` live beside it.
9. **Report shape**: one new OPTIONAL field `"notes"` — runtime substitutions
   or constraints the orchestrator must know, or null. No new statuses.
10. **Runtime-availability fallbacks** in stage skills: when a configured or
    selected engine/workflow skill is not invocable in the current runtime,
    execute the equivalent steps directly under the stage skill's own contract
    and record the substitution (exit report + `notes`). Gates never weaken.

---

### Task 1: references/orchestration.md — codex-cli transport, registry, monitoring

**Files:** `scripts/validate-workflow.mjs` (docs map), `references/orchestration.md`

- [ ] Add validator pins for `references/orchestration.md` (extend its existing
  entry in the `validateDocsAndExamples` map): `"codex-cli"`,
  `"codex exec resume"`, `"--add-dir"`, `"workers.json"`,
  `"sandbox_workspace_write.network_access"`, `"git worktree add"`.
  Run validator — must FAIL on those pins.
- [ ] Rewrite `## Worker Transports`: replace the `codex` bullet with a
  `codex-cli` binding per shared decisions 1–2 and 4; add the transport
  selection rule (config override first); keep `claude-code-desktop` and
  `fallback` bullets; add decision 6 (worktree provisioning) and decision 7
  (liveness ladder, budgets) — the ladder details may live in
  `## Monitoring Protocol`. Extend `## Mailbox And Ledger` with the registry
  (decision 3) and report-delivery fallback (decision 5). Extend `## Resume`
  step 4: read `workers.json` and rebind to live threads
  (`codex exec resume`) in addition to the runtime session list.
- [ ] Validator passes; `node scripts/verify.mjs` passes.
- [ ] Commit: `feat: add codex-cli worker transport and worker registry to orchestration policy`

### Task 2: orchestrator templates — dispatch Engine section, report notes + registry shape

**Files:** `scripts/validate-workflow.mjs` (template sections map),
`templates/orchestrator-dispatch.md`, `templates/orchestrator-report.md`

- [ ] Add validator pins: dispatch — `"## Engine"`, `"~/.codex/skills/"`,
  `".orchestrator/"`; report — `"\"notes\""`, `"## Worker Registry"`,
  `"workers.json"`. Run validator — must FAIL.
- [ ] `templates/orchestrator-dispatch.md`: add an `## Engine` section after
  `## Assignment` covering: transport value; for codex-cli workers the exact
  stage-skill body path (decision 8) with the "read fully, follow exactly"
  instruction; report delivery mechanics (decision 5) including the
  never-commit rule for `.orchestrator/`; a line that the worktree is
  pre-created by the orchestrator. Keep every existing section intact.
- [ ] `templates/orchestrator-report.md`: add optional `"notes"` field to the
  JSON shape (decision 9) with one line of semantics; append a
  `## Worker Registry` section documenting `workers.json` (decision 3,
  orchestrator-owned, workers never write it).
- [ ] Validator passes; `node scripts/verify.mjs` passes.
- [ ] Commit: `feat: extend orchestrator dispatch and report templates for codex workers`

### Task 3: skills/mono-orchestrate/SKILL.md — transport selection, registry, worktrees

**Files:** `scripts/validate-workflow.mjs` (orchestrate contract block),
`skills/mono-orchestrate/SKILL.md`

- [ ] Add validator pins to the orchestrate contract list: `"codex-cli"`,
  `"workers.json"`, `"codex exec resume"`. Run validator — must FAIL.
- [ ] Update SKILL.md: `Inputs to gather` — add optional
  `orchestration.transport` / `orchestration.maxParallelWorkers` from project
  config and the worker registry; `dispatch` state — worktree provisioning for
  codex-cli/fallback, registry write on spawn, cap parallel workers per
  config (default 3); `monitor` state — process-exit semantics and the
  liveness ladder reference; `resume` state — registry read + thread rebind.
  Keep the control-plane rules and read-first list intact (the read-first list
  already covers the updated references/templates).
- [ ] Validator passes; `node scripts/verify.mjs` passes.
- [ ] Commit: `feat: wire codex-cli transport and worker registry into mono-orchestrate`

### Task 4: stage-skill runtime fallbacks (implement, ship)

**Files:** `scripts/validate-workflow.mjs` (anti-pattern/contract pins),
`skills/mono-implement/SKILL.md`, `skills/mono-ship/SKILL.md`

- [ ] Add validator pins: implement — `"not available in the current runtime"`;
  ship — `"not available in the current runtime"`. Run validator — must FAIL.
- [ ] `skills/mono-implement/SKILL.md`: after the engine selection table,
  add the decision-10 fallback line (implement directly from the approved
  Issue under this skill + `references/execution-quality.md`; record the
  substitution in the exit report and `notes` under orchestration).
- [ ] `skills/mono-ship/SKILL.md`: read the file first; add an analogous
  fallback where ship/documentation/reviewFeedback workflows are delegated:
  when the configured workflow is not invocable in the current runtime,
  perform the equivalent steps directly (branch push, PR creation via `gh`,
  docs update, feedback loop) under this skill's own gates and certificate
  contract, and record the substitution. Do not touch gate ordering or the
  green-certificate requirements.
- [ ] Validator passes; `node scripts/verify.mjs` passes.
- [ ] Commit: `feat: add runtime-availability fallbacks to implement and ship stages`

### Task 5: config + docs — orchestration config block, README

**Files:** `scripts/validate-workflow.mjs` (docs pins), `references/install.md`,
`README.md`

- [ ] Add validator pins: install.md — `"orchestration"`,
  `"maxParallelWorkers"`; README — `"Codex CLI worker"`. Run validator — must FAIL.
- [ ] `references/install.md`: add the optional `orchestration` block to the
  JSON example and to the field list:
  `"orchestration": { "transport": "codex-cli", "maxParallelWorkers": 3 }` —
  optional; when absent the orchestrator falls back to runtime detection
  (decision 2). Confirm `scripts/project-config.mjs --check` tolerates configs
  with and without the block (inspect the script; if its template or checks
  need a change, keep the field optional and existing configs passing; if no
  change is needed, change nothing).
- [ ] `README.md`: extend the "Orchestrated mode (optional)" section with the
  recommended pairing: a Claude Code orchestrator session dispatching one
  headless Codex CLI worker per Issue (`codex exec`, resumable threads,
  mailbox reports). One short paragraph or 2 diagram lines; no duplication of
  the policy reference.
- [ ] Validator passes; `node scripts/verify.mjs` passes.
- [ ] Commit: `docs: document orchestration config block and codex worker mode`

### Task 6: closeout

- [ ] Run `node scripts/verify.mjs` — expected `Verification passed (8 checks).`
- [ ] Add plan 012 row to `plans/README.md` status table:
  `| 012 | codex-cli worker transport for mono-orchestrate | P1 | M | 011 | DONE (<commit>) |`
- [ ] Commit: `docs: mark plan 012 done in plans index`

## Out of scope (do not do)

- VERSION bump and CHANGELOG entry (ship workflow owns them).
- New scripts, wrappers, or vendored helpers for spawning codex (the policy
  reference documents command shapes; the orchestrator runtime executes them).
- Any change to `mono-preflight`'s autoreview gate, `mono-review`,
  `mono-check`, or gate ordering.
- Automating runtime-imposed confirmation clicks in Claude Code Desktop.
- Project repo changes (e.g. adding the orchestration block to the first consumer's config).
