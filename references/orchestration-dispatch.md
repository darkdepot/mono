# Orchestration Policy: Dispatch

Part of the `mono:orchestrate` control-plane policy. `references/orchestration.md`
holds the always-read part and the map of parts. Read this part before any worker
dispatch, spawn or resume, and while a registry entry still carries startup
`gates` or an unconsumed gate ack.

## Orchestration Mode Precedence

Apply the Orchestration Mode Precedence section of `references/worker-contract.md`.
Apply Delivery Write Barriers in `references/orchestration-delivery.md`; only the closed code-report exception in worker-contract defers confirmation to Preflight; consume final green/parked separately. The resume sweep is crash recovery,
never the normal application path. Dispatch lifecycle moves use the handshake
below: gates precede application and the worker resumes only on verified state.
Never defer a check onto a queued mutation or describe pending state as applied.

### Generated dispatch as audience adapter

The stage skills are one surface for every worker model. The generated dispatch
is the per-Issue layer that adapts it, so safety redundancy is tuned here and
never by editing a skill for one model's benefit. Two rules bound this:

- The dispatch may repeat, resolve, and enumerate. It may not soften, reword,
  or replace a rule. Split precedence above still holds — the skill wins on
  rules, the dispatch wins on facts — so a redundancy that paraphrases a gate
  is a defect, not an adaptation.
- The skill's tier-1 "Read now" ladder is a floor, not a ceiling. A dispatch may
  promote a "Read when" entry into a required read for that run when it knows
  the condition already holds; it may never demote a tier-1 entry.

Set `orchestration.workerAudience` in the project config (`gpt-worker` |
`claude-5`; default `gpt-worker`, which is the safe direction). It selects how
much redundancy the generator emits:

| Dispatch element | `gpt-worker` | `claude-5` |
| --- | --- | --- |
| Identity gate: fully resolved command literal, exit-0 success string, the confusable-pin warning | carried | carried |
| Byte-frozen paths with their expected hashes; the exact protected-surface list | carried | carried |
| Verification surface: one runnable command per item, or the item marked as a judgment check | carried | carried |
| Restating AFK gates the skill already binds — single-writer, no sub-delegation, never-ask, report-before-stop | restated inline | one pointer line to the stage skill and this section |
| Parked reason semantics (`blocked` vs `needs-human` vs `needs-decision` vs drift) | restated as an explicit decision list | named only where this Issue makes one likely |
| Worked output shapes (comment, certificate, report skeletons) | inlined in the dispatch | referenced by path, composed at write time |
| Per-step ordering the skill already fixes | re-enumerated | omitted |

Anything a worker cannot execute without guessing — an absolute path, a command
literal, a hash, a confusable pair of values in play — is carried in full to
both audiences. Facts are never compressed for either column.

### Orchestrator dispatch command

Select [execution Issues](lifecycle.md#задачи-этапов) before dispatch; never pass a task labelled
`Этап` to `dispatch.mjs`, which cannot inspect labels. This selection applies to
every dispatch path below, including retries and corrective work.

For [execution Issues](lifecycle.md#задачи-этапов), installed command: `scripts/orchestrator/dispatch.mjs --issue KEY --root DIR
--config FILE --snapshot DIR`. Optional risk/critical, profile, handshake and
role/reason pin the attempt. --moves JSON, --open-decisions N, --verification JSON
or `orchestration.dispatch` defaults are required; defaults also cover product,
evidenceRoot, reviewDataset/reviewDatasetVersion, budget. --gates JSON overrides
the four startup gates (issue-only adds delivery check). --worker-writable-roots
JSON adds roots including temp; worktree/Git/mailbox roots are derived.
--skills-root overrides the installed root for scratch tests.

The config is at the project repo's `.agents/mono-workflow.config.json`.
The command fetches origin/main, creates `.worktrees/KEY` on `mono/key` from it
or verifies that existing worktree branch. Snapshot: `issue-KEY.md`, `approval.md`,
`project-brief.md`, `prd.md`, `tech-spec.md`. Before dispatch, read the Issue's
project relation and Project, then paginate every Project comment. Normalize:
`idea/project.json` = {id,createdAt,status,body,language}; language from
languages.linear (Russian→ru, English→en; otherwise configure ideaGate.headings).
`idea/idea-records.json` = {complete:true,comments:[{id,createdAt,body}]}; true only
after all pages. `issue-context.json` = {issueId,issueKey,projectId,blockedBy:[Issue keys]} from
all Linear Blocked by relations; explicit [] when absent. For package starts,
dispatch selects only blockers in approval.md's issues= set. Without that token
there is no declared package chain; ordinary external blockers produce no chain input. Before launching a
chain task, supply predecessors/<KEY>/code-report.json (final code phase report)
or code-report.md (legacy published report) and merge.json = {issue,mergeCommit,head}
from the merged PR. Dispatch verifies merge ancestry on fetched origin/main,
copies both into snapshot/predecessors/, writes chain.json and embeds the full
reports/commit inputs in the dispatch. Missing input refuses blocked «нет отчёта
предшественницы»; no predecessor means no chain files, even with stray sources.
A legacy report has no promised list; compare only its merged commit. Workers
start from these inputs and main, stop scope-drift-needs-handoff if promised code
is absent, never rebuild it. Scheduling remains Handoff/orchestrator-owned.
For a package record, `tech-spec.md` holds the content of the current record's
`mono-package` fence (its `- U<n>.` units, `## Кратко` and manifests stay
parseable; the dispatch label `Tech Spec:` stays) and `approval.md` is the authorized
start comment; before dispatch verify ordinary `by=owner`, or delegated
`by=orchestrator` with reason/countercheck (latest Idea mark or earlier owner decision),
never bundling unapproved stale/legacy Idea: owner agreement/record/fresh check first; listing this
Issue, and names the record version it started with its `sha256`; the current
version is that one or is reached from it by a verified chain of class 1-2
versions with protected surfaces and Issue set unchanged. A class 3 version after
it needs a new authorized start; never rewrite the old start. A legacy package keeps
its Tech Spec and approval comment.
`approval.md` is the exact start or package approval comment; `approval.json` =
{commentId,createdAt,bodySha256}, SHA-256 of its UTF-8 bytes. That comment must
appear in this Project's comments with matching timestamp/body hash.
Require exactly one approval_status=approved and no other approval markers;
unmarked approval is allowed only before ideaGate.since, reported as
legacy-before-cutoff. `checkIdea` approved runs before attempt registration;
refusal names code/project and consumes no attempt. Issue-only keeps its existing
`issue-only.json` envelope (marker,label,fingerprint,config,ownerApproval,seam),
passes seam to checkIdea and needs no Project files.

For a UI task with U2, its Read first must contain
`Дизайн: запись mono-design <id>,` and its full `images` hash. Prepare
`design.json` in the source snapshot: {issue,recordId,images,dump}; `dump`
points to fresh raw design-gate responses (Project, all comments/requests, PRD).
The dispatch command runs `idea-gate.mjs design` itself using the product config,
checks the selected record, its Project against the task’s verified Project,
and the copied image hash, and writes `snapshot/design/`
PNGs plus normalized `snapshot/design.json` and the consumed raw responses in
`snapshot/design-input/` for refused-attempt retries. It renders the final snapshot
path in the worker prompt. The AFK read exception covers only its pinned
`snapshot/design.json` and `snapshot/design/*.png`, not other dispatch state.
Copies stay outside the worktree and are never
committed. Without a U2 record omit this manifest: no PNGs are supplied.
An Issue naming U2 without its source manifest refuses dispatch. Textual
owner/product taste rules come from the Issue's context snapshot, including
UI work without mockups; home paths alone cannot substitute for those rules.

After the Idea check and before registering an attempt, dispatch checks Research.
For a Project package, read the Research document named by `id` or `url` in the
exact `approval.md` comment. Save the named document as snapshot inputs:

```text
research/document.json  {id,url,title,projectId} from the document metadata
research/document.md    body copied unchanged from the Linear read-back
```

Do not substitute another Project document titled «Исследование». The gate reads
only the one `mono-research` JSON fence in the named document: `project` must match
the Project UUID, `outcome` is `ready`, `hold` or `not-required`; `hold` and
`not-required` require a nonempty `reason`. Extra fields, including the older
record format, are allowed. Prose, `interface`, fact quality and PRD decisions
are not checked. Run `node <pack-root>/scripts/idea-gate.mjs research --snapshot <dir>
--config <path>` to inspect the same snapshot without network access; output is
one line, `research-gate: pass|fail: <code> project=<id>`.

`researchGate.since` optionally overrides `RESEARCH_GATE_DEFAULT_SINCE` with a
valid `YYYY-MM-DD` UTC date. The default is `2026-10-19`, 00:00 UTC, active since 0.33.0. A package whose `approval.createdAt` is strictly
before this date passes as `legacy-before-cutoff`; equality requires Research.
An Idea `issue-only` verdict with no Issue Project passes as `issue-only`.
Neither exemption reads `research/`, and the directory may be absent. When it
exists, dispatch copies it into the attempt snapshot; absence never triggers a
copy for an exempt package. Other packages require the named document. Any read
error refuses the launch. Research refusals name the code and Project and do
not register or consume an attempt. The closed codes are `pass`, `not-required`,
`issue-only`, `legacy-before-cutoff`, `research-missing`, `research-bad-record`,
`research-other-project`, `research-not-referenced`, `bad-since`, `read-failed`.
This is a dispatch-only check; preflight, ship and direct worker launch do not
add another Research gate.

Dispatch saves idea files, approval/context and selected-record.json plus the
cutoff/headings policy; pins.idea binds path/projectId/recordId/fingerprint/digest/
artifactDigest/verdict. artifactDigest covers canonical contents of every saved
idea file and its approval/context (or issue-only envelope). Amend/resume keeps
this binding unchanged; a new idea record needs a new attempt. Collection requests
must carry the same idea. Preflight collection and ship reread files and require
the semantic/artifact digests and signed receipt binding to match. Launch pins
before 0.32.0 may omit idea; newer launches cannot. The worker still judges
authenticated approval and delivery readiness at its gates.

Artifacts live in `dispatch/KEY-aN/`: pins.json, pins.sha256, start-gate.json,
spawn.json, dispatch.md, moves.json and snapshot/. The command resolves modelRoutes
from immutable BASE through spawn --pins, renders every named placeholder from
`templates/orchestrator-dispatch.md`, runs gate start, then spawn and appends one
`date -u` ledger line. No pre-spawn refusal registers an attempt.
--full-snapshot retains complete documents.
Retrying a refused attempt replaces the snapshot directory with exactly its
current composition, after capturing all inputs; superseded files are removed.

Short snapshot: Issue, approval, brief, prd-extract.md and spec-extract.md. Extract
exact A/F/R/AE/U keys with numeric IDs and optional prime/Cyrillic suffixes;
expand ranges, follow “Покрывает …” and inline semicolon coverage transitively
with cycle protection. Boundaries and block opacity follow the [U12 snapshot markup contract](#snapshot-markup-contract-u12);
I slice definitions are boundaries; I remains outside PRD/Spec coverage lookup. Always retain PRD Кратко/Что не входит в MVP/Допущения and Spec
Кратко/Архитектура/Контракты и границы/Риски и защита/Что может сломаться и как
защищаемся/Валидация/Релиз и откат; absent optional sections are skipped. Unknown
keys refuse before fallback; duplicate definitions or unclosed fences retain full docs with a note. Full deep/risky
and explicitly full dispatches retain full documents; issue-only has no Project
documents.

## Snapshot Markup Contract (U12)

`scripts/orchestrator/snapshot.mjs` first parses each document into a source-backed
block tree, then selects definitions and coverage from that tree. This is the
extraction contract; other Markdown features do not extend it.

- Headings have levels 1–6, with 0–3 leading ASCII spaces and whitespace or end
  after the opening hashes. Empty headings and whitespace-separated closing
  hashes are recognized. More-indented heading-like lines remain text.
- List items use `- ` or `* ` at any indentation column. Tabs advance to the
  next multiple of four. A selectable definition starts at the beginning of a
  list item or level 2–3 heading, with an existing A/F/R/AE/U identifier followed
  by `.`, `(`, whitespace or end. The identifier grammar and suffixes are unchanged.
  `I<n>` is only a boundary, never a selectable identifier.
- A list definition ends at the next heading of any level, or the next definition
  of any boundary family at the same or smaller column. Nested items, fences and
  text remain inside it. A heading definition ends at the next heading of any level.
  Coverage in an unselected neighbouring definition does not enter the closure.
- Backtick and tilde fences open with at least three matching characters and
  0–3 leading ASCII spaces. A backtick opener's info contains no backticks.
  Closing fences use the same character, at least the opener's length and no info.
  Fence contents cannot define IDs, end definitions or supply coverage; their
  source lines remain verbatim inside an included interval. Fenced example
  definitions are not duplicates, and fenced-only IDs cannot satisfy coverage.
  Other text markup (tables, HTML, footnotes and quotes) is opaque.
- Selection expands the existing ranges and follows both `Покрывает …` and inline
  semicolon coverage transitively, with cycle protection. An unknown ID reached
  from Issue coverage or any reachable definition refuses dispatch (d-003),
  including when duplicate definitions or an unclosed fence also exist.
  Duplicates and unclosed fences otherwise retain full documents with `note`.
- The always-included sections listed above stay unchanged; missing optional
  sections are skipped. Overlapping source intervals appear once in source order.

Named `scripts/fixtures/snapshot-u12-*.json` cases exercise each rule, including
MONO-95's columns, indented headings, indented fences, empty/closed headings and
nested items. Template and MONO-92 fixtures remain supported. The package-byte
fixture records pre-change extracts; scratch dispatch compares its output bytes
against that baseline. The delivery reading corpus does not grow.

## Two-Phase Dispatch Handshake

The one startup confirmation binds the active registry attempt and current pins,
including no-move starts, and preserves approved package/risk coherence. The existing
start gate checks root/Issue/attempt/pins against the registry before code; only its
internal pre-spawn call may admit the next unregistered attempt. Stale dispatches
refuse even when branch, base and pack coincide. No start-comment queue.
Reconcile consumed moves before resume; never apply a present move again.

**No dispatch-moment lifecycle move is applied before the worker's gate-ack.**
This section owns the protocol referenced by dispatch, `mono:implement` and
`mono:orchestrate`. Only an explicit owner mandate naming the move permits a
deviation; quote it in `ledger.md`. «Решил сам:» cannot authorize one.

Only dispatch-carried moves need the handshake: Project → Delivery, issue-only
Issue activation, or Project-first Issue activation while its Project is Delivery.
The startup dispatch is mono:deliver; preflight/ship stay internal, without new
dispatches or lifecycle gate pauses.

Protocol:

1. Gate-phase dispatch. The orchestrator emits the dispatch with the pre-move
   snapshot — Project not yet in Delivery, or Issue not yet started — and the
   dispatch template's Gate Phase block filled in. It applies no lifecycle
   move yet, and the pre-move snapshot is correct, not stale.
   Before the worker process starts, atomically pre-register an inactive
   current-attempt entry
   with the empty attempt-numbered `log`, exact dispatched
   `registryEntry.gates`, pack identity, `thread_id: null`, and `pid: null`.
   Start the worker only after that durable write succeeds; after
   `thread.started`, update the same entry with verified live identity while
   preserving `log` and `gates`.
2. Worker gate phase. The worker runs steps 1-4 of the orchestration branch of
   `start-checkpoint` in `skills/implement/SKILL.md`: pack identity gate,
   snapshot package context, approval plus `mono:review handoff` findings, and
   the 5-field context seam. On the issue-only lane it also evaluates the
   delivery check there, because that check gates the move this dispatch
   carries. This is the stage's own opening, not a separate pre-stage: the
   same session, worktree, dispatch, and stage continue into execution.
3. Gate-ack, then wait or stop. The worker writes
   `reports/<ISSUE-KEY>-gate-ack-a<N>.json` under the orchestrator root, where
   `<N>` is the attempt number this dispatch's log carries. On `gates-passed`
   it waits in codex-cli `handshake: wait`, or stops in `resume` mode, without
   queuing/applying moves, code or phase reports yet. Wait uses installed
   `delivery-state.mjs wait-ack --root <root> --issue <KEY> --attempt <N>
   --ack <path> --moves <json-file> --config <cfg>`: deadline is ack mtime +
   `ackWaitSec`; expiry parks `write-unconfirmed`, then exit/resume recovery.
   Validate own issue/attempt, ackDigest and each dispatched moveDigest/read-back.
   Applied read-backs amend the snapshot; run the post-move delivery check,
   without rerunning identity in the same process. On `blocked`, write ack then
   the Blocked-path stage report before stopping; ack alone strands the Issue
   until the watcher expires and enters liveness healing:

   ```json
   {
     "issue": "<ISSUE-KEY>",
     "phase": "gate",
     "gates": [
       { "gate": "<gate name>", "status": "pass | blocked", "evidence": "<one line>" }
     ],
     "status": "gates-passed | blocked"
   }
   ```

   `gates` is nonempty with unique names from the dispatched list.
   `gates-passed` needs the exact full set, all `pass`; `blocked` permits a
   subset but requires a blocked entry. A contradictory ack counts as no ack.

   The gate-ack is not a stage report: it has its own path, its own two-value
   `status`, and it neither uses nor extends the `verification_items` enum.
   Worker Report and gate-ack machine shapes stay unchanged; launch/registry
   fields additionally pin `handshake` (`wait|resume`, default `resume`),
   `profile` (`short|full`, default `full`), `pins {file, digest}` (SHA-256 of
   dispatch pins bytes), `pinsVersion: 0`, and `procStart` at `thread.started`
   registration (`ps -p <pid> -o lstart=`, trimmed). Short requires tiny/standard,
   `critical: null`, orchestrator-supplied `afk: true` and `openDecisions: 0`.
   Legacy full/resume launches may omit pins; wait/short requires them. Ack delivery follows the same sandbox
   rule as a report: if the mailbox write is denied, write the same JSON to
   `<worktree>/.orchestrator/<ISSUE-KEY>-gate-ack-a<N>.json` (never committed). Both
   the orchestrator and the watcher read the fallback path as well as the
   mailbox one, because an ack the watcher cannot see reads as a dead worker
   and would send the healing ladder against a worker that is merely waiting.

   An attempt has exactly ONE ack. Files in both locations contradict each
   other and count as no ack; never rank them by freshness or parseability.
   Choosing a preferred artifact could admit a stale, partial or future-dated file
   to authorize a lifecycle move. Reading nothing costs a stall event that
   reconciles; reading the wrong one costs the gate.
   Consumption is per ATTEMPT, not per file: consuming an ack renames every
   file for that attempt in BOTH locations, and a consumed marker in either
   location is a tombstone — while one exists, no remaining file for that
   attempt is an ack. That tombstone is a delivery/suppression marker only; it
   is never authority to clear durable registry state.

   Before any candidate rename, the orchestrator writes its trusted
   consumption record in the same consumption step:

   ```json
   {
     "issue": "<ISSUE-KEY>",
     "attempt": 1,
     "outcome": "applied | rejected | blocked"
   }
   ```

   Its path is
   `<orchestrator-root>/consumed/<ISSUE-KEY>-gate-ack-a<N>.json`. The
   `consumed/` namespace is private orchestrator state: only the orchestrator
   writes it, dispatches never expose it as a worker output path, and workers
   are forbidden to touch it. It is not a new gate-ack field or Worker Registry
   field. Before publishing or trusting any record, fsync the orchestrator-root
   directory that contains `consumed/`, even when `consumed/` already exists;
   this completes a namespace creation whose earlier parent sync failed or was
   interrupted. No record may be published until that directory entry is
   durable. The record is
   atomically published before any in-place ack rename and
   before the separate write that removes `registryEntry.gates`. Publish it
   with a same-directory temporary file and atomic rename after the file is
   durable, then fsync the containing `consumed/` directory after the rename.
   Publication is complete only after that directory sync; if it is unsupported
   or fails, stop before any ack rename or registry cleanup. A visible final
   name after a failed sync is not yet authority. Resume must successfully
   fsync `consumed/` before treating any visible final-name record as cleanup
   authority; only then is it the journaled intent Resume may trust. The
   example's `1` stands for the positive integer
   `<N>` from the attempt-numbered filename. Missing record fails safely:
   the ack and `gates` stay until the same outcome is retried or a verified new
   attempt overwrites the field at spawn. Once the record exists, finish every
   candidate rename selected by its `outcome` before removing `gates`.
   An ack delivered or polled while that matching CURRENT-attempt record exists
   is consumption recovery, never a new lifecycle signal: do not apply moves
   again; finish the journaled rename and registry cleanup.

   A future-dated ack is not read at all, so it is neither delivered nor able
   to suppress. The
   `gate-ack` watcher event names the FULL path it validated, and
   the coverage check in step 4 is performed on that exact artifact — never on
   "the ack" resolved a second time, which is how an orchestrator ends up
   authorizing a move against gate evidence nobody validated. A transport with
   no watcher event applies the same rule when it polls.

   A stage report beside an unconsumed ack means different things depending on
   the ack, so the consumer reads the ack's `status` first and never the report
   on its own.

   A `blocked` ack beside a stage report is the ordinary non-green outcome, not
   a crash. A `blocked` ack alone is not yet consumable: the worker writes the
   ack before its report, so consuming during that interval would discard the
   only durable recovery evidence if the worker died. Preserve the ack and
   `registryEntry.gates` while polling for the correlated ordinary stage report.
   Shape and freshness do not correlate a blocked report to an attempt until its attempt and transport/worktree provenance are verified. Before consumption,
   reconcile the transport thread and worktree exactly as for the
   `gates-passed`-plus-report ambiguity below; if current-attempt authorship is
   not proven, keep the ack and field and resolve the ambiguity.
   Only after that report exists and validates, atomically publish the private
   consumption record with `outcome: blocked`, rename the ack as
   `<ISSUE-KEY>-gate-ack-a<N>.blocked.json`, remove `registryEntry.gates`, and
   route the report through the ordinary non-green path. That is the third
   consumption state, beside `.applied` after a resume and `.rejected` for a
   coverage failure: an ack whose gates honestly did not pass is spent too, and
   without a state of its own it would be redelivered on every watcher restart.
   The record binds the ack outcome, not a report version. After a crash with a
   private `outcome: blocked` record, Resume may finish the journaled ack rename
   and registry cleanup, but it re-runs transport/worktree reconciliation before
   routing any shared-path report; the record alone never authenticates that
   report or authorizes routing it twice.

   A `gates-passed` ack beside a stage report is the genuinely ambiguous one.
   It is what the crash window above looks like — the resume succeeded, the
   worker ran and reported, and the orchestrator died before consuming the ack
   — and it is equally what a superseded worker leaves behind, because a stale report may belong to an earlier attempt rather than
   to this ack. Either reading is wrong in one direction: consuming the ack
   strands a current dispatch that never ran, resuming again replays one that
   did. Reconcile before acting — establish from the transport thread and the
   worktree whether THIS attempt executed — and never silently consume the ack
   or resume on it twice. The same reconciliation covers the crash window
   between a resume and its rename: an unconsumed ack alone never authorizes a
   second resume.

   The watcher does not resolve it, and deliberately so. A report carries an attempt number, but a superseded worker still alive can write one after
   its successor's log was born and after that successor's ack; no ordering
   rule distinguishes the two. A watcher that suppressed the ack on that
   evidence would discard the CURRENT attempt's gate-ack and strand its
   dispatch — a worse failure than the duplicate the suppression was meant to
   prevent, and one the consumer rule above already prevents. Fence a replay
   where the binding exists, not where only a timestamp does.
4. Lifecycle application. On `status: gates-passed` the orchestrator first
   reads `registryEntry.gates` from the registry entry whose `log` identifies
   this current attempt, validates its complete shape, and checks the exact
   ack artifact against that durable list — set equality on the gate names,
   not a count, and every one `pass`. Process memory and the watcher event are
   not evidence those gates ran. When an ack exists, absent or malformed
   `registryEntry.gates` makes it unusable; there is no form-only legacy branch.
   A foreign or duplicate ack name, or an incomplete `gates-passed` set, also
   makes the ack unusable. The producer-contract recovery is a verified respawn
   of a NEW gate attempt that writes its own correct list. A non-empty subset is
   valid only for `blocked`, which never authorizes lifecycle moves. Entries
   without an ack do not evaluate this gate-list consumer rule, so absent
   `gates` leaves their watcher liveness signals unchanged.
   Rejecting an ack has its own consumption step, because a rejected ack that
   stays in place goes on suppressing liveness for a worker nobody is about to
   resume: atomically publish the private consumption record with
   `outcome: rejected`, then rename it to
   `<ISSUE-KEY>-gate-ack-a<N>.rejected.json`, which re-arms the ladder
   immediately, and remove `registryEntry.gates`. Rejection is
   TERMINAL for this attempt: recovery is a verified respawn of a NEW gate
   attempt with its own list, never a same-attempt nudge after consumption.
   It then applies every lifecycle move this dispatch carries and
   confirms each with read-back per Linear Write Verification. A move whose
   read-back still shows the old state is pending, never applied, and the
   worker is not resumed for execution while it is pending.
5. Continue for execution. In wait mode, consume the live waiting writer:
   pid alive, matching procStart and thread_id; after that thread.started in
   the attempt jsonl, an item.started command_execution contains
   delivery-state.mjs wait-ack with this issue/attempt and has no item.completed
   with the same item.id. Intervening status/agent messages do not end the wait.
   Refusal: `waiting writer not verified`. Before the private record/tombstone,
   persist last_wait {pid, procStart, thread_id, gateAckDigest, consumedAt}; write
   consumedAt once, never renew it on recovery. Identical prior consumption
   completes cleanup without re-verifying the writer. If waiting verification
   fails, use the ordinary registered-resume recovery below.

   In legacy resume mode, the orchestrator resumes the same worker with a
   resume signal that names each applied move together with its read-back
   result, explicitly as an amendment of the dispatch snapshot. Every
   post-resume check — including `mono:check delivery` — is evaluated against
   that amended post-move state. The pack identity gate runs again after the
   resume, unchanged: resuming is a stage resume, so the gate is mandatory.

   First, the immediate post-resume registry update that records the new
   writer per Worker Transports preserves `registryEntry.gates`. The runtime records last_resume with the new pid, thread, registration time and exact gate-ack digest; consumption requires this marker, not the stale gate-phase pid. A subsequently exited resumed writer can still be consumed so the watcher re-arms and detects the real failure. After that
   writer registration is confirmed, the orchestrator atomically publishes
   the private consumption record with `outcome: applied`, then renames every
   candidate for the attempt to `<ISSUE-KEY>-gate-ack-a<N>.applied.json` in
   place. Only after the trusted record and every rename succeed does a separate
   registry write remove `gates`. All four parts of that order matter.
   Consuming it is not bookkeeping: a gate-ack suppresses liveness events, and
   the resumed worker writes to the same stage log, so an ack left in place
   would go on suppressing `stall` and `dead` for a worker that has crashed
   after its resume; the rename re-arms the liveness ladder for the execution
   phase and keeps the ack on disk as history. Renaming the ack or removing
   `gates` before the record would discard trusted recovery evidence, while a
   missing record leaves both ack and field safely in place. Starting the
   record-and-rename sequence any earlier is equally wrong: if the rename
   completes before the resumed writer is registered, the gate-phase pid is
   already gone and nothing suppresses liveness, so a watcher scan in that
   window reports `dead` for a healthy resume and sends the healing ladder
   against it. A resuming orchestrator that finds an unconsumed ack beside an
   already-resumed worker consumes it then.

### Registry gate-list lifecycle

This table owns the producer transitions for the optional
`registryEntry.gates` field. It defines registry state changes; the
stage-aware recovery decision for malformed and forbidden-presence branches
lives on both monitor surfaces under Monitoring Protocol, not inside the
handshake.

| Transition | Required registry action |
| --- | --- |
| Verified gate-carrying spawn, respawn, or session rotation | Write the exact non-empty unique gate-name list for the NEW current attempt together with its attempt-numbered `log`. |
| Same-attempt no-ack nudge or resume | Preserve `gates`; this is still the same attempt. |
| `gates-passed` received, resumed writer not yet confirmed | Preserve `gates`; the durable consumer contract is still live. |
| Consume `.applied` in resume mode | Register the resumed writer while preserving `gates`, atomically publish the private consumption record with `outcome: applied`, rename every ack candidate, then remove `gates` separately. |
| Consume `.applied` in wait mode | Verify the live waiting writer, persist `last_wait` once, publish private consumption, rename ack candidates, then remove `gates`; no resume. |
| Consume `.rejected` | The attempt is TERMINAL: atomically publish the private consumption record with `outcome: rejected`, rename every ack candidate, then remove `gates`. Recovery is an immediate verified respawn of a NEW gate attempt with its own list; never same-attempt nudge after consumption. |
| Consume `.blocked` | Only after the correlated stage report is present and valid: atomically publish the private consumption record with `outcome: blocked`, rename every ack candidate, then remove `gates` and route the report. |
| Malformed `gates` on a gate-carrying entry | Treat it as a producer contract error and terminate the attempt; verified-respawn a NEW gate attempt with a correct list. |
| `gates` retained after startup consumption | Reconcile the private consumption record and finish cleanup before processing phase reports. |
| Phase advance | Reconcile startup ack first; preserve delivery stage/log and confirm the complete phase queue. Never dispatch a new stage. |
| Crash after consumption-record publication | Resume treats the well-formed private CURRENT-attempt record as intent: finish renaming every remaining ack candidate to the suffix selected by `outcome`, then remove stale `gates`. Tombstones and mailbox files never authorize either action. |

Blocked path: a gate that fails makes the ack `status: blocked`, and the worker
then also writes the normal stage report at the mailbox report path, so watcher
report correlation is preserved exactly as it is today. That report carries the
stage's OWN exit status for the failure it hit:
`needs-human` when a gate returned a real adverse verdict, `blocked` when the
snapshot cannot supply a required input. Mode precedence never rewrites a
stage's exit statuses, so the ack's `blocked` says only "gates not passed,
apply nothing" while the report says what happened and routes through the
ordinary non-green path, unchanged. The orchestrator applies no lifecycle move
on a blocked ack. Keep the ack and `registryEntry.gates` until the correlated
report is present and valid; only then consume the ack as `.blocked`, remove
the field, and route the report. The attempt is terminal after consumption and
has no resume.

No-ack path: an ack that never arrives is not a new signal. It is the existing
liveness ladder — `stall`/`dead`, then nudge → respawn → session rotation —
because a worker that never acked never reached the contracted wait.

Both transports, because the pause and the resume differ in mechanism only:

- `codex-cli`: `handshake: wait` keeps the process blocked in wait-ack within
  ackWaitSec; consumption releases it. Expiry parks write-unconfirmed and exits.
  `resume` (default) retains exit/same-thread `codex exec resume` with the
  amendment prompt. No user interaction.
- `claude-code-desktop` and `fallback`: the worker writes the ack and ends its
  turn; the session stays open and is continued with a session message
  carrying the resume signal. Transport price, named plainly: in
  `claude-code-desktop` a resume message needs the user's confirmation, so the
  handshake costs one user click per gate-ack there. That click is a transport
  cost, not a checkpoint — it carries no decision, is never dressed up as a
  decision brief, and never becomes a place to re-open scope.

## Worker Transports

Three transport operations: spawn worker, continue worker, read worker
reports. Transport selection: `orchestration.transport` from the project
config wins when present (`codex-cli` | `claude-cli` | `claude-code-desktop` | `fallback`);
without config, prefer `codex-cli` when the `codex` CLI is installed and
authenticated, then `claude-code-desktop` when running in Claude Code
Desktop, then `fallback`. Per-runtime bindings:

Every transport is pinned to the installed pack identity. Before dispatch,
read `packVersion` from `VERSION`, `surfaceRevision` from runtime and optional
`sourceCommit` from plugin identity, and copy them verbatim into the dispatch
snapshot and the new `workers.json` entry. At the first start and every stage
resume the worker runs `verify-pack-state.mjs identity` under the compatibility
rule in [Versioning](install.md#compatibility). Retain the task's original
identity after a compatible update; reports must still match the task record
strictly. Incompatible surfaces block with a named recovery: a new attempt.

### Pack identity gate invocation

Use the executable shape, quoting, path base, success criterion and pin rules
in `references/worker-contract.md` (Pack identity gate invocation). Resolve the
command with absolute installed paths and dispatch pins before launch; emit it
in full for both audiences. Never substitute a checkout's `SURFACE_REVISION`.

### Sandbox ladder

A mono:deliver process needs the union of phase capabilities from launch:
workspace-write, network, writable worktree, the worktree-specific Git directory and the common Git directory, derived from the worktree, and only <root>/reports as mailbox.
codex 0.153.4 protects the metadata directory of an explicitly listed linked worktree.
Keep <root>/confirmations, workers.json, attempts.json, control.json, consumed/,
logs/ and dispatch/ outside worker grants. Spawn uses --add-dir <root>/reports;
resume uses the supported writable_roots config override. Persist the complete
write-grant list in the launch capsule; phase capsules copy these dispatch pins.
Phase authority still limits code to implement, commits to preflight, PR/push to
ship; broader process capability never widens the Issue. Standalone phase grants
follow the worker contract. Hidden directories need exact grants. Disabled sandbox
remains exceptional, recorded in the ledger with the owner mandate/reason.

### Worker model selection

For a new Codex worker, select [role:worker-default](model-policy.md#roles).
The orchestrator may select [role:worker-complex](model-policy.md#roles) per
dispatch by judgment, recording the reason under «Решил сам:». There is no
automatic risk-class-to-worker mapping. Resolve model AND effort from the
selected role over immutable BASE config through installed spawn --pins; copy
modelRoutes into dispatch, launch and preflight requests. Spawn verifies them
before launch. Record the role, policy values, parameters actually set and
transport case in dispatch and registry per `templates/orchestrator-report.md`. On resume preserve the
recorded launch pins; do not resolve new policy values for an existing thread.

- `codex-cli`: use node '<pack-root>/scripts/orchestrator/spawn.mjs' --request <json>
  and node '<pack-root>/scripts/orchestrator/resume.mjs' --request <json>,
  never a product checkout or session helper.
  Run --help for request fields. Spawn enforces start gate, control halt/state,
  attempt cap, durable empty-log pre-registration and explicit model/effort.
  It persists launch metadata in the attempt log before execution, preserving
  price evidence after registry retirement. No shell interpolation: prompt is
  read from dispatchFile and passed as one argument; stdin is /dev/null.
  Observe thread.started within 120 seconds; failed startup keeps its attempt
  and process evidence for reconciliation, never overwrites logs. Do not call a
  null-thread entry live. Register pid promptly, then thread once observed.
  Keep startup gate list while waiting or same-attempt recovery; new attempts
  provide a fresh list. The watcher bounds incomplete startup independently.
  Resume preserves launch pins and appends the same log, refuses a live writer
  and incompatible surface revisions, uses cwd plus sandbox/network writable-root overrides (sandbox_workspace_write.network_access).
  Reconcile a crash before another resume; never silently retry a possibly live
  detached process. A launch.lock left by a crashed caller requires process and
  registry reconciliation before removal. No phase dispatches/resume templates.
  Use consume-gate-ack.mjs only after handshake read-back/resume registration;
  its durable private record precedes ack rename and gates cleanup. At deploy,
  remove old helpers/spawn-codex-gate.sh, helpers/resume-codex.sh and
  helpers/consume-gate-ack.mjs, recording the installed replacements. Workers do
  not delete the external helpers.

### Claude worker transports

Claude worker transports select [role:worker-claude](model-policy.md#roles).
Resolve its modelRoutes with installed runtime.mjs --role worker-claude from
immutable BASE config. They share policy intent, but launch guarantees differ. Record the case
in every generated dispatch and registry entry, with unknown values kept
separate from the policy target:

- `claude-cli`: managed launch and resume through installed spawn/resume scripts.
  The immutable BASE selects this transport and role; incompatible role, pairing,
  provider endpoint or credential reference refuses before attempt registration.
  Only native Anthropic subscription login is supported. Before each launch,
  positively confirm `claude auth status` under a closed environment allowlist
  with `USER` and without provider key/address variables; do not check CLI versions.
  Fetch GitHub login with `gh auth token` outside the worker sandbox and pass it
  only as a real process environment variable. Prepare a private, owner-only
  GH_CONFIG_DIR inside the grants, reuse it on resume, and keep stored credential
  sources unreadable. Redact stdout/stderr before storing either stream.
  The CLI's own native session storage is owner-only and lies outside this journal-redaction boundary.
  Submit the task on stdin with print/stream-json, pinned session/model/effort.
  Success requires matching init session/model, dontAsk, no key source or
  connectors, only tools with an explicit policy, and a first successful assistant
  response within 120 seconds. Retain refused attempts/logs and name the action.
  Record requested effort separately from observed model and subscription login.
  Generate managed-settings/<KEY>-a<N>.json inside orchestrator control from the
  same canonical grants check used at launch/resume. File-tool Edit permissions
  and Bash sandbox writes use that set; protected control/evidence/pack paths
  remain denied through symlinks. Require sandbox availability, forbid unsandboxed
  commands, allow only GitHub domains and the system certificate service, and deny
  WebFetch/WebSearch. Bind internal temp storage to a short granted root; refuse
  long paths and deny ungranted system fallbacks. Strict empty MCP, no Chrome, closed built-in tools, no user,
  project or local setting sources. The Bash timeout exceeds phase confirmation.
  Resume regenerates settings from attempt pins, keeps the same session/model and
  refuses a live writer. Never adopt current project settings. Startup uses stop/resume:
  the worker writes its gate acknowledgement and stops; the orchestrator applies
  and reads back every move before resuming the same session. Start handshake
  wait is refused. Pre-PR review uses external committed-head collection only,
  without an in-worker pass because nested sandboxes cannot run. Dispatch,
  model_launch.delivery_differences and the ready certificate disclose both facts.
  Never print credentials: native session transcripts retain command output
  outside journal redaction. A refused shell command follows report-before-stop.
  Phase and collection confirmations use the plain pack blocking wait command
  in the foreground under the raised Bash timeout ceiling. The seam proves an
  outstanding Bash call by session, Issue/attempt, current runner PID/procStart
  and call ID. Each runner writes a mono.worker-instance marker before CLI output;
  a resume discards old outstanding calls. A tool result (including background
  handoff), permission denial or turn result closes the wait. Stale, foreign or
  partial confirmations never advance the phase; existing deadlines apply.
  Log mtime supplies liveness, including tool_progress appends during a command.
  A turn result without a correlated report is completion without a report,
  never green or parked. Sum result.usage once per completed turn across resumes;
  normalize cache reads/creation into input, and preserve unavailable/incomplete
  coverage when a turn lacks final usage. No monetary accounting.
- `claude-code-desktop`: spawn via task chip with a self-contained dispatch
  prompt (one user click; the platform provides the worktree). Continue or
  steer via session message with user confirmation. Workers stay visible as
  normal sessions the user can open. The owner selects the model manually in
  the interface: record "manually selected, actual model unverified". Model
  and effort launch parameters remain unknown unless actually observed; never
  fill them with policy intent.
- `fallback` (CLI/headless): named long-lived background subagents inside the
  orchestrator session; same contract and reporting. Set the Agent tool
  `model` parameter through the runtime alias for the resolved role; record
  that alias and the assumption about its mapping. Effort is not controllable:
  record runtime default, not the policy effort as applied. If the runtime
  cannot represent that model, report the unavailable route rather than
  silently select another row.

Worktree provisioning: for `codex-cli`, `claude-cli` and `fallback` the orchestrator
creates the worker's worktree before spawn
(`git worktree add <repo>/.worktrees/<ISSUE-KEY> -b <branch>`), keeps it
across stages, and removes it only after deploy closeout. Deploy retirement is
also the only normal removal point for the active registry: after verified
deploy and Linear closeout, remove the Issue entry from `workers.json`. Keep
its reports and logs as history. A blocked or incomplete closeout does not
retire the entry.
`claude-code-desktop` uses platform-provided worktrees.

State the chosen binding in the first status update, and never block on a
transport feature the runtime lacks.

## Pre-application by mandate

For [execution Issues](lifecycle.md#задачи-этапов), `dispatch.mjs --preapply` applies only approved manifest bytes under `.agents/`
before start gates and spawn, on a clean tree. The product config's
`orchestration.preapply.mandate` is the URL of an owner comment covering both
application and the repair procedure; absent/empty means no mandate. Establish
that value in a separate orchestrator action before a live pre-application wave.
Workers never bootstrap or change it.

Issue-only uses `# Предприменение` in the approved Issue. Project-first keeps a
nested `Предприменение:` list item within the covered Tech Spec or package-record
`U` unit; dispatch reads the full approved slot before extraction and materializes
only its wrapper as the Issue section in the snapshot. For each file, use one
list item with a backtick-quoted path, the word `sha256`, a backtick-quoted
64-character lowercase hex hash and nothing else, followed by a `text` fence.
List items allow any nesting indentation; blank lines may occur after the marker,
between items and before fences. Tables are refused. Candidate boundaries are
headings and neighboring items at the marker's column or less, except items
starting with a backtick-quoted path: collect those even when malformed and
validate the entire manifest before application. Opening/closing fences start at
column zero, even inside a nested unit; content has no added nesting indentation.
SHA-256 covers raw UTF-8 lines without trimming/dedenting, joined with `\n` and ending
with `\n`. Fence contents are opaque to the exported U12 block parser.

Reject multiple candidates, indented fences, unmatched path/fence pairs, hashes
that disagree, paths outside `.agents/`, `..`, symbolic links (including parents)
and nonregular targets before application. A section without mandate or without
--preapply refuses before spawn, without registering an attempt.

Hold `launch.lock` from spawn availability through application, start gates and
attempt registration; refused pre-registration launches restore the owned commit
and ledger entry under that lock. Stage approved ignored targets
explicitly; transformed staged blobs refuse and restore files/index before commit.

Commit `<KEY>: pre-applied .agents changes (orchestrator)` before start gates;
render commit, paths and hashes in «Предприменённые изменения». Append a UTC
`date -u` ledger entry `PREAPPLY <KEY> <sha> per mandate <url>`. Repeating the same
manifest reuses its verified commit only when current HEAD also contains every
approved blob, without another commit/entry. Pins, gate
requests/receipts and `gate.mjs start` stay unchanged; review against origin/main
includes the pre-applied commit. Workers compare commit blobs to the dispatch
and manifest at start, then leave these files unchanged.

A review finding on manifest files parks blocked with exact replacement bytes.
Project-first: mono:handoff repairs the Spec under repair-machine classification
by meaning, with every class effect; issue-only: mono:issue renews the Issue
through create-then-approve. Dispatch the approved replacement as a NEW attempt
with --preapply; `accept amend --preapply` always refuses and names that route.
