# Orchestration Policy

Control-plane policy for `mono:orchestrate`: inspect, delegate, monitor, decide,
record and report. Delivery code stays in implement/preflight/ship workers.
Pre-delivery stages run the same skills in stage agents, with the orchestrator
answering as the delegated owner; a stage session owns its artifact and read-back.

## Roles

- Owner: always approves Idea, first-product exemplars and new taste-memory rules;
  may reopen any approval by speaking in the orchestrator chat.
- Orchestrator: one product session; dispatch, monitoring, technical decisions,
  ledger and deploy. Single Linear writer only for implement/preflight/ship workers,
  which queue their mutations in reports. Stage agents write their own records.
- Stage agent: one stage, its own dialogue and tools, confirmed record and selected
  transition returned to the orchestrator. Never starts the next stage or stage agents.
- Worker: one Issue, `mono:deliver` phases under the AFK contract, no direct Linear writes.

## Stage Ownership

| Stage | Runs in |
| --- | --- |
| `mono:idea` | stage agent; orchestrator shows owner its description/window and relays only the owner's press |
| `mono:research` | stage agent after authorized start; no owner questions or separate approval |
| `mono:discovery` | stage agent; orchestrator answers with reasons and approves the shown PRD |
| `mono:design` | stage agent when routed; first-product exemplars and taste consent remain with owner |
| `mono:tech-evaluation` | stage agent when routed; orchestrator approves the shown page with a reason |
| `mono:handoff` | stage agent after required stages; records package, then authorized work start |
| `mono:implement`, `mono:preflight`, `mono:ship` | delivery worker session |
| `mono:deploy` | orchestrator session |

Gates in `references/lifecycle.md` keep their owners and order; no waiver.

## Decision Authority

Delegated Project: latest Idea approval's outside-fence line
«Ведёт оркестратор: владелец принёс идею оркестратору <дата>.». Repeat on Idea
reapproval. A Project delegated before this version can rely on an explicit owner
decision in a Project comment. Without either the owner leads: only owner starts
Research and work (`by=owner`). Do not add `by` to strict `mono-idea` records.
A `stale`/`legacy-migrate` Idea stops autonomous Research/work despite delegation:
carry it to owner for button approval, confirmed new record and fresh check first.
The orchestrator's reply or bundled start cannot approve that Idea snapshot.
Only delegated Projects with that current approval allow autonomous Research/work,
write start `by=orchestrator` with a reason, answer and approve after Idea, including
irreversible, deferred and contrary-to-owner decisions. Stage approval does not
execute external writes or spending. Configured merge/release/deploy policy (`deployApproval`) stays.

Before each `by=orchestrator` record apply the countercheck below. The owner keeps
Idea approval, first-product exemplars and consent to new taste rules. Their words
reopen any approval. Owner-led stage sessions never accept another agent's reply
as a press; the sole exception is a stage launched by the orchestrator, never Idea.

Narrow control-plane exception: an explicit owner mandate may permit operational
and deploy-repair changes (scripts, infra config, docs sweeps), recorded in the ledger
with that mandate; feature code always routes through delivery workers.

## Director Discovery

Run the chain through stage agents one Project at a time while delivery waves
continue. Deferred Projects wait for their return condition or owner return.
Launch prompt states owner context, exact stage-agent and scout names, product,
source inputs and round. Owner-led next stages remain in the same session, except
Design in a separate session whose parent ran Discovery. A delegated stage ends
with a verified record and selected transition; the orchestrator launches the next
stage session. A Discovery callback from Design/Tech Evaluation is performed in
that session under Discovery rules, with orchestrator's version-bound reason and
countercheck for PRD approval. Preserve partial Design → Discovery → Design recovery;
return only after the stage's own record is confirmed.

Every PRD approval decides design then size; `next=design` goes to Design then
ordinary/large work to Tech Evaluation, tiny work to Handoff. Not-needed routes
by size. Reapproval invalidates lower records when the route changes. Run `route`
before exemptions, then verify required records in chain order. PRD without
`next=` retains the router's old path. Handoff verifies effective `mono-tech` for
current PRD and consumes a valid record without another offer. Only absent/invalid
tech with ordinary/large size gets «Начать Tech Evaluation» / «Ещё обсудить».
Consent opens that old path; without it no package or continuation.
Tech Evaluation owns new Tech Specs; Handoff consumes them and owns package repair.
A changed tech page returns to its owner; class 3 repair needs a new authorized start.

Stage agents use the same dialogue as owner sessions. Their last turn contains
the result and window labels as text. Reply with exact label and reason on that
version; agent records `by=orchestrator`, reason and countercheck outside fences,
then reads back. Idea instead requires the owner's press in the orchestrator window.
Do not relay other stage questions to the owner. After every stage send the owner
its R1 result (conclusion, decisions, exclusions/reason, next, link; 120 words,
Handoff 150), plus «Утвердил сам, потому что…». Decisions on their behalf come first:
«Решил за тебя: …, потому что …». Show exceptions and deferred/irreversible choices.

Handoff offers «Начать работу» / «Передать оркестратору» / «Ещё обсудить».
In an ordinary Project the button or typed «передай оркестратору» records
`by=owner` and transfers delivery to the orchestrator. A delegated Project accepts
orchestrator start with reason/countercheck. Ready alone never starts delivery.

## Stage agent permissions and visible dialogue

Use `templates/stage-agent.md` and its adjacent `templates/stage-helper-hook.mjs`.
The template is outside `agents/` so the plugin cannot register placeholders.
Build stage and scout definitions under `~/.claude/agents/` using product/stage-specific
names, never overriding owner-session `mono:*-scout`. Use only exact tool names
from current host connections, no server wildcard. Default categories: files,
terminal, helpers, Linear, Paper for design, web search. No mail, finance, browser,
screen, Desktop sessions or windows without owner action. Host-added tools (e.g.
`advisor`) are not owner connections and are outside the list. This limits direct
calls, not isolation; terminal remains for verification and the isolated second model.

Desktop names `mcp__<uuid>__…` differ from CLI `mcp__claude_ai_<Имя>__…`: assemble
for the orchestrator's host; wrong names mean no access. Map each allowed exact
name to its category, leave all other connections absent. New connections stay
excluded until explicitly added. Scouts get their own exact allowlists plus read-only
restrictions. Launch prompt supplies their private names; stage uses only those.
`Agent(type)` does not restrict helpers: stage frontmatter must carry PreToolUse
matcher `Agent|Task`, invoking the hook with the allowed scout names. It reads
`tool_input.subagent_type`, rejects other types on stderr with exit 2. Copy the hook
to `<orchestrator-root>/hooks/` when building definitions and put its absolute path
in the header; never use a versioned plugin-cache or session-temp operational path.

At every orchestrator start and before each stage launch verify definitions, exact
tool names against live host connections, no project definition override, scout
names, hook bytes/path and current session visibility. New/edited definitions are
visible only to a session started afterward: start a fresh orchestrator session
before delegation. Missing, unverified or invisible definitions: do not launch;
report the reason while other Projects proceed. Codex cannot select a restricted
role/type for its subagent: delegated stages do not run there. Tell the owner:
«Этапы делегированного проекта идут в Claude Code». Do not substitute broader rights.

Append every stage/orchestrator message immediately to
`.claude/session-views/<этап>-<ключ проекта>-<круг>.md` in the product working
directory; link that file in each owner stage result. Not the orchestrator root:
Desktop opens chat file links only inside session folders. Check `git check-ignore`;
if unignored, append `.claude/session-views/` to the product `.git/info/exclude`,
leaving `.gitignore` unchanged. Do not use a child Desktop session for delegation:
the tested orchestrator session cannot launch it and messages cannot reach a
session launched by the orchestrator. Design under delegation is an agent too;
its end of turn returns control. Owner-led separate-session Design stays separate.

## Approval countercheck

Before every `by=orchestrator` record (PRD including renewals/Design callbacks,
mockup, tech page, work start, package-repair approval), run a different-family
second model per `references/model-policy.md`, read-only, foreground. Give result,
exact approved text/version, PRD, earlier owner decisions, stage second-model
report and proposed reason. Pass text/local paths, never Linear links: no owner
connections. Resolve model/effort by policy, then use the appropriate invocation:

```bash
codex exec --ignore-user-config --disable apps -m <модель> -c model_reasoning_effort=<усилие> -s read-only "<задание>" < /dev/null
claude -p --strict-mcp-config --model <модель> --effort <усилие> "<задание>" < /dev/null
```

`--disable apps` also blocks ChatGPT app connectors, enabled by default even
when user config is ignored.

Record verdict with model and reviewed-text version outside fences in that same
approval comment, alongside reason; machine lines unchanged. Text or reason changes:
check again. Objection: reply «Ещё обсудить» with it. Repeated objection on the same
point: decide, retain objection/rejection reason in record; first owner-result line:
«Решил за тебя: … вопреки второй модели, потому что …». No response after one retry:
no approval; report reason and continue other Projects. This countercheck is separate
from the unchanged package Second Voice dialogue below.

### Second Voice

For pre-write package review, delegate the critique to an independent fresh-context
Second Voice with the product brief, Linear links and repo read access. It reviews
the package; the orchestrator answers as product director. This dialogue protocol
does not run the Idea, Research or Discovery stages.

Model selection is mandatory and cross-vendor: the Second Voice runs on
a different model family from the orchestrator. A fresh context on the same
model is not a second voice. Resolve the model AND reasoning effort from the
selected policy row; never copy an effort literal into this consumer.

#### Claude orchestrator

Orchestrator on Claude → [role:second-voice](model-policy.md#roles).
Resolve from the immutable BASE config with the installed runtime before launch:

```bash
node <installed-runtime>/runtime.mjs --role second-voice --worktree <repo> --base <base-commit>
```

Use `modelRoutes.roles["second-voice"]` model/effort in a fresh Codex thread:

```bash
codex exec --json -c 'model="<second-voice-model>"' -c 'model_reasoning_effort="<second-voice-effort>"' "$(cat <review-prompt-file>)" < /dev/null
```

Replace both placeholders from the resolved route and record its fingerprint/base. Continue
with `codex exec resume`, preserving the requested launch pins. This is a
reviewer, not a worker: no worktree, Issue or registry entry. Record its
thread id, resolved role, requested model and effort, and round count in
discovery notes. On resume rebind or deliberately restart the dialogue and
end orphaned reviewer processes.

#### GPT orchestrator

Orchestrator on GPT → [role:second-voice-alt](model-policy.md#roles).
Use its exact model id and row effort through the Claude CLI, never an
alias or a floating latest selector:

```bash
claude -p --model <second-voice-alt-model> --effort <second-voice-alt-effort> "$(cat <review-prompt-file>)" < /dev/null
```

Replace both placeholders from this row before launch and continue the same
review session with its launch pins. This role is independent of the
Claude worker row; changing a worker never selects the alternative reviewer.

#### Unavailable route

- Fallback, only when the cross-vendor model is unreachable (no Codex
  auth, or no Claude access): run the lens review in-session (product,
  engineering, and design lenses) and record the substitution and its
  reason in the discovery notes.
  A same-model Second Voice is not an acceptable fallback; an in-session
  lens pass is.

Dispatch shape per skill run: the reviewer role and the named skill; the
product brief and Linear links; repo read access; the instruction to
deliver questions and challenges as its final message — never through
user-question tools, there is no user on its side; and the required
closing verdict: strengths, top risks, contested items, recommendation.

Dialogue protocol: rounds of ask → answer → challenge, capped at 3
rounds per skill (guidance, not a gate). After the cap, unresolved
disagreements that are Always-ask class go to the user as checkpoint
items; the rest the orchestrator decides, recording both positions under
«Решил сам:».

Boundaries: the Second Voice never talks to the user, never writes
Linear, and never dispatches or steers workers; it is discovery work and
pre-write package review, not stage work. Both roles carry the same
boundaries: reviewing a draft package never grants it a Linear write, an
owner conversation, or any authority over workers.

### Pre-write package review

The orchestrator's `mono:handoff` state has one mandatory Second Voice run
that is not discovery: the drafted package record and [execution Issues](lifecycle.md#задачи-этапов)
bodies, checked against the approved PRD read-only, go to an independent reviewer
next to `mono:review handoff`, BEFORE the orchestrator writes any of it to Linear.
Order, not preference: synthesize the draft, review it, fix the draft, then write,
set Ready and bring the owner the summary.

- The reviewer is a discovery agent under the Second Voice protocol above —
  fresh context, cross-vendor model, no worktree, no Issue, no registry
  entry — and it has no Linear-write capability and no owner contact.
  Findings return to the orchestrator, which applies accepted fixes to the
  draft package.
- Obligation follows `references/readiness-gates.md`: required for
  `standard`, `deep`, and `risky`, advisory for `tiny` with the skip reason
  recorded. The orchestrator cannot decide this gate away under «Решил
  сам:»; only findings inside it are its to accept.
- The reviewed subject is the draft, so none of the drafted bodies — package
  record, [execution Issues](lifecycle.md#задачи-этапов) — is written to Linear at review time.
  The Project entity itself may already exist, and stays available to the
  reviewer as surrounding context; what is absent is the drafted content, not
  necessarily the container. That absence is expected and is never reported as
  a missing artifact. Approved PRD already exists read-only; a PRD finding returns
  to Discovery for renewed yes in the package touch, per the pre-write `handoff` mode in
  `skills/review/SKILL.md`.
- Workers never run this review. They cannot spawn agents, and a worker is
  not independent of the package it was dispatched from.
- The work-start checkpoint stays a single owner touch, because the verdict
  is already applied when the summary is written.

## Orchestration Mode Precedence

Apply the Orchestration Mode Precedence section of `references/worker-contract.md`.
Apply Delivery Write Barriers below; only the closed code-report exception in worker-contract defers confirmation to Preflight; consume final green/parked separately. The resume sweep is crash recovery,
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
never bundling unapproved stale/legacy Idea: owner button/record/fresh check first; listing this
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
documents. --review-pilot JSON explicitly selects the template's optional review
block with project/version/path/digest facts; it never changes stage rules.

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

### Backup worker switch

The owner may name `orchestration.backupTransport` in project config: `codex-cli`
or `claude-cli`, distinct from the primary, and only with a managed CLI primary.
Absence means no mandate. The value on the previous attempt's immutable BASE is
the standing owner mandate; changing live config cannot grant it retroactively.

Only the orchestrator decides to switch, using this dictionary:

| Reason | Required decision |
| --- | --- |
| `subscription-exhausted` | The primary's subscription is exhausted |
| `provider-refusal-after-recovery` | The primary's provider explicitly and persistently refuses after ordinary recovery on that same worker failed |

There is no failure classifier. Task failure, stopped gates, unexplained silence,
installation problems and config errors never authorize a switch. For the second
reason, retained same-thread resume metadata and journal evidence after that
resume are required. The orchestrator judges what the excerpt demonstrates.

Run ordinary recovery/reconciliation first: settle queued obligations against
Linear, capture and stop the process tree, preserve unfinished work, and retire
the previous registry entry by the existing verified-retry procedure. Do not
delete `attempts.json`, logs, dispatch pins or `attempt-records/`. Launch/resume
retain a protected per-attempt entry and process incarnation/group history when
a backup is configured. Missing history or process identity refuses switching.
Run the installed stop command before retiring each registered incarnation:

```bash
node '<pack-root>/scripts/orchestrator/backup-switch.mjs' stop --root '<root>' --issue 'EXAMPLE-7'
```

Under the launch lock it sends `SIGSTOP` to the worker groups, recursively finds
and freezes descendant groups, and requires stopped states before retaining the
tree and start identities. A process disappearing before quiescence refuses the
capture. Once process creation is quiescent, it records that proof and force-stops
the captured processes leaf-to-root with `SIGKILL`, retaining the wrapper last.
No `SIGCONT` occurs between capture and termination. An incomplete stop leaves
the registered attempt, process observations and stopped processes for
reconciliation; a pending stop cannot be retried into a new proof. Never treat it
as successful retirement. Confirm process exit before removing the registry
entry. The backup launch separately rechecks every identity and group for survivors.
Retain captures across resumes; each incarnation requires this stop procedure.
Missing/incomplete quiescence or stop evidence refuses switching, including an
attempt that exited before its tree was captured. Reconcile missing evidence
instead of claiming an unobserved tree stopped. Captured descendants and orphan group members refuse switching while live.
Before spawning either managed transport, launch creates an opaque UUID v4
marker, `MONO_ATTEMPT`, stored as `entry.attemptMarker` in the protected
`attempt-records/<ISSUE>-a<N>.json` (and protected registry entry). Each attempt
gets a different value; every continuation retains the same value. Both
transports pass the pinned marker after environment filtering, replacing any
inherited caller marker. The Claude journal runner and worker's child commands
inherit it; managed settings do not override it. The marker identifies process
ownership only: it grants no permissions and changes no sandbox, network or gate.
Legacy attempts without a marker continue to use the other three traces.

The process table returns PID, parent PID, group, start time, state and command,
without environment. Start identities retain the legacy caller-locale format;
Linux reads full UTF-8 command text separately. On macOS, the command column
contains only the executable label from the kernel's separate path area. Raw
arguments stay inside a private probe: an incarnation-checked exact-path query
returns only `matched`, `absent` or `unavailable`, preserving literal references
without returning argument/environment bytes. The query scans the kernel-reported
argument region conservatively; a rewritten title can make that region ambiguous.
A separate incarnation-checked reader returns only
`matched`, `absent` or `unavailable`: macOS reads `ps` environment output for
processes owned by the current user; Linux reads `/proc/<pid>/environ`. Environment
bytes never leave that reader or appear in records, snapshots, journals or errors.
An unavailable read is not evidence that the marker is absent. Successful macOS
`ps` fallback output without readable arguments/environment is also unavailable.
Because macOS `ps` flattens arguments and environment values, a candidate match
is confirmed against NUL-delimited `KERN_PROCARGS2` entries by a private `python3`
probe using the standard `ctypes` library. Its isolated `-I -S` invocation excludes
workspace/user startup imports and respects the kernel's `ARG_MAX`. Marker
and exact-path requests return only verdicts; command-table requests return only
PID and executable label. A missing interpreter or denied kernel read returns
`unavailable` for those queries. A marker-like argument or text inside another
environment value is not a confirmed environment match. Empty/omitted environment
data or a flattened candidate that cannot be confirmed is unavailable, rather
than evidence of absence. Rewritten titles may remove argument separators while
the kernel retains argc. An intact marker beyond that reported region still
matches; a marker consumed into it is unavailable rather than absent. No raw
arguments or environment leave the private probe, regardless of variable names.
The fourth trace scans the whole command text for a literal worktree or
attempt-artifact path. An occurrence counts when the character after the path
is the end of the text, `/`, or outside `[A-Za-z0-9._-]`. Longer sibling paths
such as `<worktree>-2` do not match. Quotes, comments, interpreter options and
script syntax are not interpreted. Literal references inside inline comments,
patterns or script bodies may conservatively block switching; that false
positive is accepted. Process exclusions depend on identity, never command text.

The launch record retains the pre-launch host PID/start-time baseline when a
backup is configured. Missing baseline proof still refuses switching; never erase
or broaden it. The snapshot does not make unrelated new processes remnants.
At both stopped-tree reconciliation and backup launch, a live process blocks if
it belongs to a captured group, its parent chain reaches a captured incarnation,
its marker matches, or its command contains an exact reference to this attempt's
worktree or artifact. A shared product root, incidental substring or longer path
prefix is insufficient. New writer, captured-process and collector identities
also retain `procStartEpoch`, observed with `LC_TIME=C` and `TZ=UTC`. Different
independently observed UTC starts prove PID reuse; a locale or time-zone change
in the legacy formatted `procStart` string does not. Legacy identities without
that UTC observation can still be ruled out when the current UTC start is after
the protected writer activity/capture time, or the collector lock's last write.
Otherwise their PID/group signal remains and requires reconciliation. Stopped
proofs preserve those original observation bounds as `observedByEpoch` rather
than advancing them to the time of a later reconciliation. Recording a resume
freezes legacy bounds before replacing the entry; each new writer retains its
own registration bound. An unavailable original bound stays unavailable.
The pre-launch baseline keeps its existing
PID/formatted-start shape.
Verified processes of the current control invocation are excluded after checking
the registered previous-attempt collector and its checks, even when they descend
from that controller. Another task's collector under the same root is not a remnant. The
previous attempt's collector, its active gate and their descendants are checked
separately. Refusals retain the existing text and identify the blocking PIDs.

For a marked attempt, an unavailable marker read with no other trace allows the
process to be ignored. The backup launch records
`processOwnership.unavailableMarkerCount` in its protected launch/attempt entry;
stopped-tree reconciliation records the same count in its retirement proof.
No environment is recorded. This count is available for orchestrator
reconciliation, as part of the accepted residual risk: an uncaptured orphan
outside captured groups, with a cleared environment and neutral command, may
remain undetected. Unrelated products, sessions, utilities and other tasks'
collectors do not block switching.
If the registered writer already exited, the command sends no signals: it
requires all retained writer/descendant identities and groups to be absent and
the attempt-ownership check to pass, then records `proof: already-stopped`.
Launch repeats these checks. A clean natural exit still requires complete stop
proof and absence of every surviving trace of the old attempt.

Create a decision file outside worker grants and an evidence file containing a
nonempty, verbatim contiguous excerpt from the previous attempt's JSONL journal.
Keep both as history. Example decision (replace paths and Issue facts):

```json
{
  "issue": "EXAMPLE-7",
  "previousAttempt": 1,
  "reason": "subscription-exhausted",
  "backupTransport": "claude-cli",
  "evidenceFile": "/absolute/orchestrator/switch-input/EXAMPLE-7-a1.txt"
}
```

Add `--backup-switch /absolute/orchestrator/switch-input/EXAMPLE-7.json` to the
ordinary installed `orchestrator/dispatch.mjs` command for [execution Issues](lifecycle.md#задачи-этапов), retaining the current
snapshot, gates, verification, risk and complete write grants. A direct spawn
request carries the same object in `backupSwitch` and its normalized record in
the new attempt's pins. This record is the sole exception to selecting the
BASE primary. The runtime adds both attempt numbers, both transports, both bases,
the source journal and SHA-256 of the evidence bytes. It rechecks the record
under the launch lock before registering the new attempt.

The previous attempt must be the latest counted one and unregistered; its
processes and descendants must be stopped. Both bases must retain the same
backup and primary, and the resolved reviewer route must be unchanged (compare
route values, not fingerprints that also include the whole config). The normal
producer/reviewer pairing check still applies. The ordinary start gate requires
a clean tree containing the new BASE: reconcile preserved edits/commits first,
never discard work or bypass the gate to admit a dirty tree. New grants may not
expand the previous worker's grants. The existing attempt cap is unchanged.

On backup Codex, default to `worker-default`; `worker-complex` requires a recorded
selection reason. On backup Claude Code, use `worker-claude` and `handshake: resume`.
Every startup, phase, collection and ship gate still applies. The runtime retains
the switch in `backup-switches/<KEY>.json`, the ledger, registry, dispatch and new
attempt pins/journal. One switch per Issue; retain that marker through retirement.
There is no automatic return or second switch. A stopped backup may resume its
same session under the existing recovery rules.

After dispatch, including a refused startup that retained an attempt, reconcile
the switch record and write/read back a Russian Issue comment before advancing
startup moves. Name the reason, evidence path and digest, previous/new workers
and attempt numbers; include the complex-role reason when selected. Reconcile a
lost comment response before writing another. Scripts never write Linear.

Closeout training is orchestrator-owned: use a one-off root and a real managed
attempt, with `"training": true` in the decision and a clearly marked reason in
the ledger/Issue comment. Synthetic unit-test data proves refusal branches;
training proves the actual launch path. Neither claims a live subscription-limit
response; that remains a separate observation and must never be fabricated.

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

## Independent QA before merge

After every confirmed green ship, resolve the recipe from the product config's
`qa` block or the product's explicit `<!-- mono-qa product: NAME -->` record in
`references/qa-recipes.md`. Examples, `workflows.qa`, `qaAuth` and assignment
files do not connect a product. No recipe: do not launch a tester; preserve the
existing merge path and record «тестировщик не подключён» in closeout.

For connected products launch **mono:qa on the host**, on role `qa`, outside the
worker's copy. Give it the task, approved PRD/design, current PR head, confirmed
ship certificate, current main as test-merge base and recipe. Save its expectation
list before actions. The tester publishes and reads back its report, certificate
and main recording in the task; the project pass also publishes its report in the
Project. Worker self-assessment cannot replace this pass.

Failed/unverified holds merge and wave installation. Send concrete bugs, steps,
expected/actual and evidence through the existing ship-fix amendment, preserving
the task attempt and prior ship state. After new head passes ship, launch QA again
on the **entire list**, with fresh evidence; do not reuse prior green items or cap
QA attempts. Recheck disputed items yourself; keep false alarms in the report with
the removal reason. Missing/contradictory expectations stay unverified until a
recorded decision; changed user-visible behavior goes to the owner before rerun.

### Current host inputs

Only the host writes `<root>/qa/state.json`, refreshed from **all paginated**
Project Issues in Linear and their current GitHub heads before preparation,
merge, landing record, and installation verification. Missing/unknown facts are
blocking. Keep it outside every worker grant; never accept it from a worker.
Each `tasks[KEY]` has the exact current `head` and explicit `project` (ID or null).
Each `projects[ID].issues` row has `issue`, `head`, `statusType`, `labels` (names)
and `mergedAt`: the freshly read GitHub PR `merged_at`, or explicit null for an
unmerged PR. Missing merge progress blocks; Linear status never implies landing.
Include stage Issues too, with their actual labels. Build composition
contains every non-canceled/non-duplicate implementation and its source PR head,
including shipped work, excluding label `Этап`; it is independent of the QA result.

Before QA, save `<root>/qa/<KEY>/<head>/task-expected.json` using the inputs of
`scripts/qa-certificate.mjs` (base, kind, evidenceRoot, expectedItems, taskCriteria).
After publication/read-back save `task-report.json` with the certificate string.
For final QA use `project-expected.json` and `project-report.json` at the final
Issue/head. Save expectations independently before the pass, never extract IDs,
kind or composition from the completed certificate. The gate overwrites task,
head, scope, recipe source, mode and task ship from current inputs; base remains
the tested base. Moving main alone does not restart QA.

`delivery-state.mjs qa-status --root <root> --config <config> --report <ship-report>`
returns the same QA state used by deploy preparation, landing record/status and
wave verification: `waiting` (exit 2), `failed` (1), `passed` or `not-connected` (0).
Ship green remains a code/review milestone **before QA**, not permission to merge.
Do not require QA in the worker's ship publication: the host launches it afterwards.
Save the green certificate read back from Issue comments/resources as host JSON
with `issue`, `head`, `certificate`; this is not a worker-registration requirement.
Run `scripts/orchestrator/qa.mjs prepare --root <root> --config <config> --issue <KEY>
--head <fresh-PR-head> --ship-report <read-back-ship.json>` before any merge, including per-merge products.
No recipe resolves before reading ship files or worker state, so the command also
works with only `--config` on that path. Connected standalone deployments supply
the same read-back JSON and host QA inputs without an orchestrator registry.
The landing queue retains its confirmed ship checks and rechecks QA before record
and wave verification. Default state readers use the trusted host config path
recorded as `entry.config` at launch. Legacy dispatches recover that exact path
from their correlated existing `spawn.json`; no worker checkout fallback exists.
Unavailable host metadata stays unknown/active, never inferred disconnected.
Explicit config must agree with a recorded host config when one is available.
A short no-behavior task certificate needs a reason and an independently selected
kind; it never substitutes for project coverage. Given-version or assignment-file
certificates never open gates, even if their verdict is green.

### Final project pass

When exactly one unmerged implementation without label `Этап` remains, run
final QA on its test merge over **all R and
AE of the approved PRD**. This Issue still needs its own task certificate. Hold
its merge and wave installation until the project certificate matches the current
build. The sole unmerged Issue is final even when a previous held chain has merged.
With multiple unmerged Issues, a nonempty held chain must contain every one of
them; otherwise preparation fails with a held-chain conflict. A matching chain
selects its last Issue; no chain means task QA only. Before wave installation,
when all PRs are merged, the last held Issue is final, or the latest GitHub merge
when there is no chain; ambiguous merge order blocks. Neither Linear lifecycle
nor a saved finalIssue selects it. The build lists all eligible implementation
Issues and heads, including merged held Issues. Require every build head only
when project QA is required; earlier task-only PRs may land while later unstarted
Issues have no PR/head (their mergedAt is null and they count as unmerged).
Changed tasks or heads invalidate the final
certificate; rerun the full final list and publish/read back the new project report.
Earlier tasks may deploy individually when merge deploys immediately, each after
its own green task certificate.

A final-pass bug becomes a new approved implementation Issue, branched from the
held task's branch. Retain **both** in `heldIssues` in dependency order, with
each in `tasks` and `issues`; additional bugs extend the same held chain. Run task
QA for each, final QA at the last held successor's head/test merge with the whole build.
After green, merge held predecessors then the successor in dependency order;
all remain bound to the same final composition during landing and installation.
Keep its QA expected ship certificate bound to that successor's issue/head.
Do not repair product code in the tester session or silently waive a disputed item.

## Deploy and closeout

The orchestrator applies [Merge validation](landing.md#merge-validation): ordinary
merge and installation require a green current landing branch tip, and every
merge requires checking its exact GitHub merge SHA before continuing. A named
corrective Issue needs the recorded `corrective` exception before its merge;
the resulting commit must pass before ordinary delivery resumes. Deploy and
closeout retain their existing phase ownership and approval requirements.

With `landing.install: "wave-drain"`, use [Install](landing.md#install) for batch
installation, shared attempt state, halt and recovery. The orchestrator records
landings, retains Issues In Review until batch close, then closes and retires each
task with its proof. It owns first rollout from merged main and removes halt after
close or failed installation; worker stages never perform these actions.

## Mailbox And Ledger

- Root: `~/.mono-agent-workflow/orchestrator/<product>/` — never inside a
  project repo (project repos keep only `.agents/mono-workflow.config.json`).
- Reports: `reports/<ISSUE-KEY>-<stage>.json` per
  `templates/orchestrator-report.md`. Workers write reports; the orchestrator
  reads them instead of parsing worker transcripts.
- Ledger: `ledger.md` — dated, high-level entries: dispatches, «Решил сам:»
  decisions, user decisions, lands, deploys, exact blockers. Only the
  orchestrator writes the ledger.
- Ledger format, mandatory:
  - One event per line, appended in write order; the timestamp is the
    actual moment of writing (ISO 8601 with timezone offset). Recording an
    event under the time it "should have happened" is forbidden. An event
    noticed late keeps its append position, carries the true write-time,
    and adds a `recorded-late` marker with the estimated event time
    (wave-1 precedent: a "07:50 respawned, thread live" entry written at
    11:43 hid a 4-hour idle gap from the final wave report).
  - Only observed facts: never record an action as done before observing
    its effect. A dispatch is recorded only after `thread.started` is
    parsed, a Linear mutation only after its read-back per Linear Write
    Verification — never on intent.
  - Corrections are new lines that reference the corrected entry; editing
    or rewriting existing lines is forbidden.
  - Any orchestrator idle or stall longer than 5 minutes — waiting on
    quota, on the user, or on its own scheduling — is a mandatory ledger
    entry with the cause. These entries feed «Что пошло не так:» in
    status updates and the final wave report.
- Worker registry: `workers.json` beside the ledger — orchestrator-owned
  runtime metadata, one entry per Issue: `transport`, `thread_id`,
  `worktree`, `branch`, `stage`, `spawned_at`, `last_activity_at`, `log`
  and `pid`, plus the dispatch `packVersion`, `sourceCommit`, and
  `surfaceRevision`, plus the optional `product_name` — the product-language
  name this Issue is called by in owner-facing statuses — and optional
  attempt-scoped `gates` only for the current
  gate-carrying `mono:deliver` attempt (shape and validity in
  `templates/orchestrator-report.md`). Updated on
  every verified spawn, resume, session rotation, phase transition, and respawn
  under the immediate-update rule in Worker Transports; workers never touch it.
- Product control: `control.json` beside `workers.json`, with the exact shape in
  `templates/orchestrator-report.md`. The orchestrator owns the lifecycle
  `active` → `draining` → `idle`: use `active` while dispatch is allowed,
  `draining` when no new work may start but registered workers are closing, and
  `idle` only when the active registry is empty. Incompatible-update quiescence is
  exactly `idle` plus an empty `workers.json`; verify it with
  `verify-pack-state.mjs quiescence`. Missing either condition blocks.
- Report delivery under a write sandbox: the mailbox root is writable for
  `codex-cli` workers via `--add-dir`. If a mailbox write is still denied,
  the worker writes the same JSON to
  `<worktree>/.orchestrator/<ISSUE-KEY>-<stage>.json` (never committed); the
  orchestrator sweeps both locations.
- Logs: `logs/<ISSUE-KEY>-<stage>-a<attempt>.jsonl` per spawn attempt,
  numbered from the first attempt (`-a1`) — the worker's JSONL event stream;
  the timestamp of the last event is the liveness heartbeat.
- No secrets in any of them. No routine polling entries in the ledger.

## Linear Write Verification

Verify-after-write, mandatory for every Linear mutation the orchestrator
applies: after the write, read back the mutated entity and confirm the
change actually applied — a success response alone is not confirmation.
Wave-1 precedent: `save_project` returned success while the project status
stayed unchanged (silent success-no-op). On a failed read-back, retry the
mutation once; if the read-back still shows the old state, record a ledger
failure entry naming both attempts and treat the mutation as pending —
never report it as applied.

## Monitoring Protocol

Do not steer progressing workers, raise proof mid-flight or intervene for polling
alone. Intervene on reported questions/blockers, exhausted work, repeated failures
without progress, gross scope divergence or unsafe mutation; inspect latest state
first. An unconfirmed watcher alarm is a prompt to inspect, not an owner blocker.
A no-change wakeup (false alarm after inspection, already-consumed report, or no
events) produces no owner message and no routine ledger entry. Record actual
observation recovery and every healing step/result; retain escalation after the
healing ladder or an Always-ask decision. Check startup registry gates before ack/report routing: malformed/absent
with ack is a producer contract error; reconcile/retire and create a verified new
attempt with correct gates, never same-attempt nudge. After consumption, gates
must be absent. Finish private journal recovery before phase routing.

For a fresh attempt, do not infer death from a process search for its transport
thread ID: only resumed attempts carry that ID in their process arguments. Verify
liveness using the current attempt's registry PID and matching process start time
(`procStart`); a live PID with a different start time is not that attempt.

Read ack status before any report. Applied/rejected/blocked private records bind
only the current attempt. Rejected is terminal: reconcile, then new attempt within
cap, never nudge. Blocked ack without report waits for same-attempt report recovery;
preserve ack/gates until verified report exists, then consume blocked. Passed ack
with report or uncertain resume requires transport/worktree reconciliation, never
second lifecycle application/resume from an ack alone. Record recovery sync and
rename before gates removal; tombstones never authorize cleanup.

A fresh passed startup ack is a contracted pause, not death. Any stall/dead while
its ack remains unconsumed is a consumption boundary: reconcile writer/mailbox
before healing. Phase event: validate capsule/attempt and consume its whole queue
through the barrier below; do not resume a worker waiting on a confirmation file.
The watcher suppresses phase liveness only for the bounded confirmation wait.
Startup suppression remains stallSec × 4 from log silence. With --config, watcher
--stall-sec defaults to product stallSec (120); an explicit flag overrides, minimum
90. Config ackWaitSec (420) must be ≤ stallSec × 4 − pollSec (10); watcher startup
also validates against its effective threshold. For wait + .applied, while log
mtime < last_wait.consumedAt, continuation is ≤ ONE stallSec from consumedAt:
finite, not future, 0 ≤ age < stallSec. Never renewable; log continuation or
expiry restores ordinary monitoring. These protocol deadlines take priority over
unfinished commands, including when a child process remains alive.

In ordinary work, a silent log with a live writer (`writerPidState`) and an
unfinished command defers stall using a fixed 60-minute best-effort diagnostic
from the watcher's first observation of that state. This is not a precise execution
deadline: observation, bounded scanning and restart effects can affect its timing. Codex tracks every `command_execution`
`item.started` by `item.id` until its `item.completed`, resetting on
`thread.started`; Claude reuses current-instance Bash `tool_use.id` /
`tool_result.tool_use_id` tracking. Completing one parallel command leaves the
others pending. Process descendants alone prove no command. No log timestamp
backdates this allowance; watcher restart starts it again. At the limit emit one
stall marked «идёт команда дольше 60 минут», then inspect progress as usual.
No unfinished command means ordinary stall; missing writer evidence and `dead`
remain unchanged. A hung command that keeps writing progress still has a fresh
log: detecting it remains outside this rule.

No-ack/no-report exit: resume the same thread once demanding its capsule/report;
second reportless exit or failed resume rebuilds from Linear plus capsule/worktree
and uses a verified new attempt, preserving outstanding write IDs and reconciliation.
Use installed resume/spawn tools; do not reset Issue or attempt counts.
Keep dirty work on same-thread resume. If that thread cannot resume, park
needs-decision with its capsule and preserved dirty tree; never loop new spawns,
discard changes or bypass the mandatory clean-tree start gate. A clean recovery
checkpoint needs the preflight owner before a verified new attempt. Halt refuses
new spawns/resumes, not running workers. Escalate only after the healing ladder
(nudge → respawn → session rotation) is exhausted or an Always-ask decision exists.
Keep actual decisions/results in ledger; a no-change wakeup is neither. Delivery budget is guidance, not a gate.
Material scope drift parks scope-drift-needs-handoff and goes to owner decision.

## Review decline approval

Declines are normal admission records, separate from the experimental pilot.
Dispatch creates immutable review dataset v1 by default under evidenceRoot and
pins its path/version/digest. It reuses matching v1 bytes; otherwise it selects
the latest existing version, including histories without v1, without creating
v1 beside later versions or rewriting archives or digests. Explicit
datasets retain their path/version. A decline needs a version and a linked,
approved decision in the journal; the default dataset grants no decline itself.
The worker proposes in its phase report; only the orchestrator writes
`decisions/<KEY>.json` using installed `decisions.mjs record`. For standalone
requests without pins, supply `issue` at collection: the receipt signs that
identity and selects its journal; worktree directory names carry no authority. Never grant the
worker evidence-root writes, edit a receipt or change its archived dataset.

1. Read the signed immutable receipt and exact full finding. Compute SHA-256 of
   canonical receipt and finding (runtime canonical JSON sorts object keys),
   preserving array order. `findingIdentity(receipt, index)` yields
   `{id: "<receipt digest>:<index>:<finding digest>", index, digest}`. Use the
   zero-based index; equal titles at different locations remain distinct.
2. Verify refutation command/output or unreachable-path citation independently.
   Judge dangerous consequences: unreviewed code admission, security/secrets,
   data corruption, money, irreversible action. P0/P1 or dangerous needs
   refutation; likelihood is never proof. A boundary must already have been
   approved before the receipt and remain current with its promised behavior.
3. Append a `decline` with id/type/recordedAt, receipt
   `{collectionId, runId, digest}`, head, datasetVersion, finding identity,
   dangerous boolean, approvedBy=`orchestrator`, approvedAt and recordDigest.
   `basis` is `{type:"refutation", evidence:{command,output}|{citation}, digest}`
   or `{type:"boundary", decisionId:"d-NNN", digest, scope}`. Evidence digest is
   SHA-256 of its canonical object. Boundary digest hashes the full decision;
   scope equals its boundary.scope. That current `decision` has decision=`limit`,
   boundary `{scope,remainingContract}`, approval `{by:"orchestrator",at}` and
   validity.head matching the receipt. Inspect those contents; date alone fails.
   `decisionDigest(entry)` hashes all canonical fields except recordDigest;
   store that digest only after approving the unchanged contents. Conflicting
   active approvals for one finding block; revoke before replacing one.
4. Re-run preflight collect:false against the same receipt. Its result can be
   `accepted-with-declines`; preserve the original verdict/overall_correctness/
   findings, and confirm the worker's ready comment lists each identity, basis
   and approver. Ship re-reads the same journal through the shared gate.
5. New evidence appends `decline-revoke`: id/type/recordedAt, forId,
   declineDigest (the original recordDigest), reason, evidence and evidenceDigest,
   approvedBy=`orchestrator`, approvedAt, recordDigest. Never edit prior records.
   Revocation blocks the next admission even on unchanged code. New code needs
   a new receipt and approvals. Rebuild the review ledger to expose decline
   events and revocation flags; they add no reviewer executions.

After approval, a next dataset version may carry only a short active-decline
summary as context “do not raise without a new fact”. Never repin or version the
current receipt's dataset to manufacture admission. Old clean receipts keep
working; findings receipts lacking recordedAt cannot use declines.

## Repeated review class

Only the orchestrator appends `class` and `class-decision` through
`decisions.mjs record`; evidence stays outside every worker grant. Never infer
matching from titles or prose. Use explicit adjudication links for `findingKey`;
use `findingIdentity(receipt,index)` for full canonical finding IDs.

`class`: id, rule (violated invariant), mechanism, findingIds (nonempty exact IDs),
supersedes (null initially), approvedBy=orchestrator, approvedAt, recordedAt,
recordDigest=`decisionDigest(entry)`. A replacement preserves the rule; preserve
history. Uncertain classification needs orchestrator judgment; a new unmatched
class does not stop collection.

`class-decision`: id, receipt {collectionId, runId, digest}, classIds, findingKeys
(at least one), outcome=fix-class|limit, nextStep (one bounded step), checkpoint,
supersedes, approvedBy=orchestrator, approvedAt, recordedAt, recordDigest. Approval
must follow the latest receipt. Superseding preserves that receipt; only current
entries and current referenced classes apply. `limit` additionally carries
boundary {decisionId: d-NNN, digest: SHA-256 of full canonical boundary},
behaviorChange (restriction/removal), remainingVerification {command, output} or
{citation}, and successor (Linear Issue URL). The current approved limit boundary
must match content and reviewed head. A boundary alone cannot excuse a live defect.

Before another collection:
1. Inspect the latest receipt and earlier receipt findings; record exact class
   membership and key links. `review-ledger.mjs decide` returns `classStop`.
2. Repeat without a current decision: park worker `needs-decision` before edits,
   local review or new collection. Admission under launch.lock records `withheld`
   and `class-stop`; no reviewer launches.
3. Choose `fix-class`: one bounded correction of the whole error class/checkpoint;
   or `limit`: restrict/remove behavior, verify the remaining approved contract,
   link successor. Scope decisions stay within approved outcome/delegated bounds.
   New residual risk or reduced promised outcome goes to owner before continuing;
   already approved boundaries need no repeated approval.
4. Deliver the decision/instructions to the parked worker; amend dispatch if it
   adds a requirement. Append the decision. Collector automatically re-evaluates
   the withheld request with unchanged reportDigest/pinsVersion when current
   decision state changes. No manual restart/new request ID is needed. Admissions
   remain immutable/idempotent; launch.lock serializes contenders.

The fresh history receipts supply latest-round identity; journal/adjudications
supply explicit classification. A class decision permits another review, never
admits a defect or changes gate branches/model/effort/priority. Class-stop demand
is retained after later admission and counts zero reviewer executions at stop.

## Review limits

Only the orchestrator records `continue` or `successor` through decisions.mjs.
No worker writes evidence. `reviews/<original>-counters.json` stores chain-wide
blocking signed receipt identities, local internal-pass events, stops and finite
reservation lists; heads and attempts are not counter boundaries. Valid declines
remove their exact blocking findings; revocation restores them. Filtered/rejected
blocking findings remain blocking. Gates still require clean or accepted-with-declines.

Workers report cumulative capsule.local_passes [{id,head,result}] with stable IDs for each
actual local pass (result=clean|findings; omitted means findings), including failures; do not count the passes inside an external
receipt as worker-local passes. Collector persists them under launch.lock before
queue handling. A recorded local stop withholds collection until a later bound
continue. A clean last pass at two ends the local loop normally and permits collection.
After two local passes, park needs-decision before another pass,
both before and after the first external review. Deliver current chain totals and
approved remaining local allowance in the resume amendment; a worker never writes
or infers the allowance. Persist local passes before granting continuation.

After two receipts still containing blocking findings, command-state refuses the
next external collection under launch.lock, records cap-stop and withheld demand,
and returns needs-decision. Read its stop id from evidence. Continue fields:
type=continue, id, supersedes (null initially), stopId, collectionId (the exact next
preflight-collect:<head>:<n>), localPasses/externalCollections (nonnegative integer
additional budgets), nextStep/checkpoint (bounded action and verification point),
approvedBy=orchestrator, approvedAt/recordedAt, recordDigest=decisionDigest(entry).
Approval follows the persisted stop. Local grants count from that stop's total;
external grants count durable reservations for it. Include decisions/remaining
allowances in Autoreview decisions:. No decision permits a gate to accept a defect.

The first use binds the stop to its designated next collection. Each later use
atomically reserves one of the same finite external budget. Request replay retains
its reservation, including recovery between counter and admission writes. New heads,
attempts and successors share the reservation list. Reusing or superseding a decision
does not add budgets: replacement values are total allowances for that same stop,
and consumed reservations remain consumed. Exhaustion requires a fresh bounded
decision; park without one. Changes to current chain decisions re-evaluate an
identical refused report/pins pair. Competing requests serialize; a lock refusal
reserves nothing and may be retried with the original request identity.

Every collect:true requires a pinned request and registered correlated admission
before any helper runs; unpinned legacy requests are refused. The collector owns
admission. Collect:false remains usable to obtain pending requests
and reconcile history. Collection IDs bind the reviewed head. A completed signed
history cannot be executed again with the same ID; reconcile it instead.
Every outstanding admission (no signed receipt yet) reserves free capacity under
launch.lock. Blocking receipts plus outstanding admissions fill the free allowance;
replay consumes no additional slot. Completion releases a pending slot, but a
blocking receipt replaces it in the count. The gate rechecks all pending reservations,
including continuations, against free capacity;
a stopped free reservation requires a bound continue before promotion. Decision or
counter changes re-evaluate a withheld request, including completion of a clean
pending collection.
Attribute signed receipts by receipt.issue, otherwise the Issue key of the
pins.file attempt directory. Ignore receipts with neither; there is no worktree
fallback or persisted ownership table. Current receipts carry these identities,
so head, attempt, successor and worktree changes preserve the chain count.
Scope decision d-005 retains a fail-closed limitation: external-only receipt changes
can invalidate a local continuation and create a new cap-stop requiring a decision.
No collection or defect admission occurs; repair is deferred until after release.

Create a successor only through an orchestrator decision: either the existing
class-decision limit's successor URL, or continue.successorIssue. Before dispatch,
record in the successor journal type=successor, id, originalIssue (the original,
never an intermediate successor), decision {id,digest} identifying that original
journal's authorizing entry, approvedBy=orchestrator, approvedAt/recordedAt and
recordDigest. One immutable relation per successor; historical creation authority
survives later decision replacement. The relation inherits all counters and grants;
it does not excuse a defect, expand approved scope, or reset the chain.

## Review decision pilot

Enable the dispatch pilot block only for approved experimental Issues. Stage
rules, statuses, certificates and final-head proof remain unchanged. The worker
proposes; the orchestrator adjudicates and writes evidence. Do not install the
pilot obligations as universal stage rules before the pilot disposition.

Use installed `decisions.mjs` with `--issue KEY --evidence-root DIR`:
`record --record FILE` appends to `decisions/<KEY>.json`; `list` reads history;
`render` emits one deterministic current-decision section. Entry types are
`decision`, `matrix`, and `verification` (the checkpoint belongs to the phase
report). Decisions carry the orchestrator-assigned findingKey, problem,
trigger, evidence, impact, origin, decision, validity {head, base, contracts,
assumptions}, verification, supersedes, proposedBy and recordedAt. Matrices
carry invariant, states [{state, expected}], verification and recordedAt;
verification entries carry forId, method, result and recordedAt. A matrix waiver
is a verification entry with waiver {findingKey, reason}; forId must name a
decision on that findingKey. Only current entries apply, so superseding the
decision also retires its waiver. Every entry
has id/type. New evidence appends a new ID and a supersedes link to the current
entry of the same type and invariant; old entries are retained, never edited.
Pilot matrix waivers do not satisfy the review decline gate.

`version --source FILE` replaces the managed section in the source dataset,
retaining other sections, and creates immutable
`datasets/<KEY>-review-scope.v<N>.md` plus `.sha256` only for changed bytes.
An identical archived version is reused. If a crash left an archive without its
digest, an identical retry restores only the missing sidecar under the shared
archive lock; different bytes refuse recovery. Pin its version, path and digest
before the next review; do not revise a source during collection/verification.
`materialize --version N --worktree DIR --digest SHA256` checks that archive,
writes a plain `.orchestrator/review-dataset-<d8>.md` outside the Git index,
requires Git exclusion, verifies the written digest, and returns its path.
Keep `.orchestrator/` in the main checkout's info/exclude. Workers receive the
repo-relative path and digest and use it unchanged with --dataset for local
passes, plus --stream-engine-output. New version: materialize and repin before
review. The collector retains its separate copy protocol. At attempt end use
`materialize` with the same pins and `--remove true` to remove each copy.

Optional phase fields are proposals, not accepted decisions:
- review_dispositions: decision entries plus eventId. A supersedes ID outside
  this report is a journal reference whose existence the orchestrator checks.
- behaviour_matrices: matrix entries plus decisionIds, referencing dispositions
  in this report with the same findingKey. Include targeted verification results.
- checkpoint: five nonempty answers named confirmedDefects, evidence,
  failedFixes, nextExperiment, stopCondition.
- progress_claim: {progress: fixed|evidence|new-cause|none, evidence, eventIds}.
The validator checks types and local references; the orchestrator checks
external references and meaning. Legacy reports and confirm semantics persist.

An orchestrator decision that adds a requirement to the diff, such as
documentation, a fixture or a boundary change, must reach the worker as a
dispatch amendment before the next collection is approved.

Before a collection request, read `review-ledger.mjs decide --issue KEY
--evidence-root DIR --attempt N`. It reads the saved ledger, adjudications and
journal; only explicit adjudication links to decision IDs supply findingKey.
It returns matrixFindingKeys for keys in two finding-bearing rounds of this
attempt, and checkpointRequired for the last two adjudicated rounds with
progress none. Parent collection/helper/internal-pass events count as one
round; record order determines round order, with later records updating that
round's progress. Unknown links remain visible; never infer a key from prose.
Review missing coverage before acting on the hint. Adjudicate progress only
with evidence, including null when unresolved.

Pre-collect checklist:
- The dispatch dataset version and digest equal `decisions.mjs version` for the
  current journal and source dataset; identical bytes reuse the version.
- No requirement remains undelivered to the worker.
- The last collection's finding keys have been delivered to the worker.

If the required matrix/test result or five answers are absent, do not call
the collection adapter. Record `review-ledger.mjs withhold --issue KEY
--evidence-root DIR --record FILE` with {attempt, collectionId, reason,
recordedBy}; rebuild the ledger to include this collection-request with status
withheld. It counts demand and zero executions. Give a later actual request a
new ID. Otherwise record the decision to proceed and run the unchanged gate.
Publish the pilot protocol before its control/two pilot waves and report the
outcome before proposing universal rules. Measure generated dispatch bytes and
rendered dataset bytes as pilot overhead, separately from the unchanged worker
corpus; report source and scratch-plugin read-budget measurements.

## Delivery Write Barriers

Only the generated implemented-needs-preflight code-report Issue comment skips
waiting. Unknown/other writes and stopped reports wait; no start-comment queue.
Use the worker-contract closed list: pending code comments carry into Preflight,
new versions replace them and mark old comments stale. Preflight's whole queue
confirms before formal review; timeout parks write-unconfirmed. Predecessor
checks verify report fingerprints even for deferred code. This adds no Ship gate.
The watcher emits the code phase event but does not treat that deferred comment
as a blocked writer; other phase waits keep their existing deadline/liveness rules.

Poll phase reports as well as events; events accelerate, never prove application.
Use installed `scripts/orchestrator/accept.mjs ack --root DIR --issue KEY
--attempt N`: validate the sole ack location, registry correlation, gate coverage
and outcome before exposing any plan. Without an existing consumption record,
the plan contains planDigest, plannedAt, ackDigest and moves with moveDigest.
After connector writes, --readback FILE requires that planDigest and one dated
read-back per move observed no earlier than the plan. Identical prior consumption
completes rename/gate cleanup without a new plan; contradictory records refuse.

Run installed `scripts/orchestrator/collector.mjs start|stop|status --root DIR
--issue KEY --attempt N` outside all worker sandboxes. Start once per attempt;
stop at retirement. It confirms empty and collection-only phase queues, never
connector queues. Inspect `reports/KEY-collector-aN.log` for refusals/results.
`reports/KEY-collect-attention-aN.json` signals an admission refusal to the orchestrator once per report digest/current registry pinsVersion/current decision digest tuple, persists across restarts, and clears when the current collection-only preflight report is admitted, including a replacement for the refused report.
The attempt lock `reports/KEY-collector-aN.lock` stores pid/procStart and the
active gate incarnation. Start reclaims only a dead holder and dead gate tree;
unknown process telemetry refuses. Collector and gate use separate dedicated process groups. A gate waits on stdin
until the collector durably records its incarnation; parent death before release
cannot launch an unregistered gate. Validation also registers its gate group in
the held per-head lock before release; reclamation checks both recorded trees.
Group membership preserves orphan descendants.
Legacy locks without group metadata require manual reconciliation; an unrelated
live member of a shared group also prevents reclaim. Stop verifies incarnation,
requests graceful shutdown and lets an active gate finish before releasing locks.

Phase correlation uses validatePhase, registry issue/attempt/pack identity, the
sole standard/fallback location, report digest and existing predecessor barriers;
terminal delivery reports never substitute for phase reports. Collection admission
shares launch.lock with amend, reads registry pinsVersion, and seals reportDigest
and manifestDigest. Old admitted requests recover against their admitted version;
new stale-version requests refuse. Before collection, find signed history by
collectionId and compare actual receipt bindings (including risk/critical, dataset,
grants and verification) against the admitted request. Under the per-head lock,
restore the mutable head envelope from history and confirm completion, including
failed runs, without repeating review. A durable collection-start record in
`consumed/KEY-aN/collections/<collectionId>.json` stores launches and the active
gate incarnation alongside the attempt's admissions. Before a receipt exists,
a dead group permits a bounded retry of the same collectionId/admission. Recheck
current class/cap on every launch without reserving new capacity. The counter
survives collector restarts. Any signed receipt, including provider failure,
ends collection retries; immutable history wins over mutable head evidence.
Reclaim a stale per-head lock only through
its exclusive `.reclaim` marker after proving holder/group descendants dead.
Live or unverified holders refuse. History-first receipt order and gate semantics
remain unchanged; all queue confirmations use delivery-state's existing barriers.

Use `scripts/orchestrator/accept.mjs report --root DIR --report FILE` for connector
queues. For nonempty queues, before opening or printing writes it uses the existing
delivery-state barriers to validate all predecessor reports/confirmations; a refusal
exposes no connector instructions or new session. Empty queues establish the session
first, then validate predecessors during the real confirmation. Session setup failure
leaves no confirmation. No predecessor rules are duplicated.
It opens `{sessionId, openedAt, reportDigest}` under
`consumed/KEY-aN/sessions/<sessionId>/session.json`; `current-<reportDigest>.json`
identifies the active session. A retry first prints the reread list (find comments
by marker before republication), then opens a fresh session and prints expanded
certificate writes. Supply --session UUID and repeated --observe 'writeId=JSON'
(or writeId=@file) observations with sessionId, writeId, reportDigest, writeDigest,
observedAt, state and evidence. Fresh means at/after publication and session opening;
missing additionally requires absent:true. Complete present observations delegate
delivery-state confirm with MONO_ACCEPT_ROOT, MONO_ACCEPT_SESSION and
MONO_ACCEPT_REPORT, using the pack `scripts/orchestrator/linear-adapter.mjs`.
The adapter recomputes the report/write digests, verifies the active session and
returns unknown for absent/stale/foreign observations. apply prints a connector
instruction on stderr and returns no success result. No command writes to Linear.

Ship pins capture orchestration.ship.botChecks from the immutable project base
(default ["Greptile Review"], nonempty unique names). A worker cannot override this
list. For a confirmed bot outage, use accept.mjs amend --bot-unavailable "<reason>"
with the current --issue/--attempt and recovery --text; the decision is scoped to
that task attempt and does not carry into another attempt. A ship-fix amendment
names the next ship-gate attempt number; the worker keeps the old state and uses
a new stateFile for the new head within the same task attempt. Ship-gate attempts
have no machine bound; review/class/cap gates and evidence-window code are unchanged.

Launch pins are immutable. `accept.mjs amend --root DIR --issue KEY --attempt N
--text TEXT` writes `pins.v<n>.json` and prepares a resume file/request before
calling resume.mjs; only a successful resume advances pinsVersion in the registry.
A refused resume prints its reason and leaves the registry unchanged. Amendments
serialize across preparation and resume; registration and admission share launch.lock.
Before resume, `amendment.pending.json` beside the version files retains their digests,
attempt/thread identity and the prior registered resume. An identical retry compares
that record with the newly registered resume and finishes the pins update without
launching again. Changed prepared bytes or a different amendment refuse while a
delivered version awaits registration. Cleanup after registration is recoverable too.
The launch-may-have-started marker is written before resume. Clear it only for
this invocation's positively identified pre-spawn refusal for a live wait worker,
after launch.lock verifies unchanged attempt/thread, current version, prior resume
and wait record. Restore prior grants and keep the version prepared for retry
after worker exit. Changed state, post-spawn refusal or ambiguous failure retains
all evidence and refuses automatic restart; correlated delivery recovers forward.
Risk/critical only escalate; dataset changes
require a newer --review-dataset-version; --worker-writable-roots must be the
complete effective grants; --full-snapshot --snapshot DIR includes the full docs
in the resume amendment. The document bytes participate in amendment identity;
changed bytes require a new version even at the same source path. The version
stores fullSnapshot directory/digest and subsequent independent amendments carry
those verified documents forward without requiring the caller to resupply them.
Same amendment bytes recover the same version.
Registered amendments retain completion history by amendment digest, including
prepared-file digests and their resume results, after pending cleanup. Identical
completed retries return the original result without another launch, whether the
delivered worker is live or has exited. Later amendments preserve these records;
replaying an earlier result leaves the current pins, grants and worker unchanged.
Changed completed bytes refuse; a new delivery needs a new amendment text.
An undelivered pending replacement retains the original rollback grants;
provisional grant expansion from an interrupted resume cannot become its baseline.
`command-state.mjs admitCollection` and amend use launch.lock. Admission layout:
`consumed/KEY-aN/admissions/<collectionId>.json` contains exactly
`{collectionId, reportDigest, pinsVersion, manifestDigest}`; manifestDigest is the
canonical digest of launch pins overlaid with that amendment version. New bound requests
derive their version from pins.file (pins.json = 0; pins.v<n>.json = n), require the
current registry version, and match the full file path, digest and effective
request/grant fields, including reviewDatasetVersion and dataset path. The stale
version refusal names the full expected pins path; no report version is required.
Previously admitted requests recover before new-request checks; legacy admission
and U14 report-digest/registry-version bindings remain; attention also tracks current decision state. Omitted
reviewDatasetVersion means version 0 only for an unversioned baseline; it cannot
bypass a newer amendment. Identical previously admitted requests remain recoverable under their
original version. MONO-96 owns receipt collection/recovery, not these commands.

Validate identity/attempt/head/sequence and full queue, including comments and
certificates. Use installed delivery-state.mjs confirm with the orchestrator-owned
pack Linear adapter above. The adapter receives action=reconcile|apply, issue, attempt,
idempotencyKey and write via stdin; stdout JSON returns state=present|missing|unknown
and read-back evidence. Reconcile compares desired payload/target, locates comments
by stable marker/idempotency key, and returns unknown on ambiguity/read failure.
Apply never means confirmed: the runtime reconciles again afterward. Implement
observations with the configured Linear connector; never give adapter authority to a worker.

Runtime fsyncs an applying intent, then the exact per-write present result under
consumed/<ISSUE-KEY>-a<N>/<id>.json before whole-queue confirmation. On recovery
reconcile ALL Linear writes against Linear, even local successes, applying only missing
ones. Keep IDs/payloads stable; conflicting payload for an old ID refuses. Read-back
must prove the desired effect, not merely a successful API response. Retry only
after reconciliation; missing confirmations cannot duplicate comments. Never claim
an unavailable adapter completed a queue: leave pending and park at the deadline.

For operation=preflight-collect, route the adapter to the gate, never Linear.
Validate the single-item confirmation-request against dispatch product, pinned
installed skillsRoot, risk/critical, verification command, worktree/head/base and
evidenceRoot. On spawn, pin evidenceRoot and the complete workerWritableRoots in the request/registry. On resume, any extra grant requires an amended dispatch with the complete effective list; the runtime refuses evidence-root overlap and persists effective grants before launch. Build collection and worker verification requests from these current pins, never an earlier dispatch. Use ~/.mono-agent-workflow/evidence/<product>/ outside EVERY
worker-writable root (including the orchestrator root and temporary grants).
Only the orchestrator outside all worker sandboxes runs collect:true. Optionally pin reviewDataset to an orchestrator-owned absolute file under evidenceRoot; the gate binds receipt reviewDataset as {source,digest,copy}. Keep the source unchanged through collection and worker verification. Immediately before the helper, copy it to .orchestrator/review-dataset-<digest8>.md in the reviewed checkout and pass that repo-relative path via --dataset. Verify the copy digest against the source before and after the helper; remove the copy afterwards, best effort. Keep .orchestrator/ ignored; no worker runs during collection. The gate
runs verification AND the installed autoreview helper inside codex sandbox with the worktree and one private temp directory writable per invocation. On macOS only verification also grants the realpath of `getconf DARWIN_USER_TEMP_DIR` when available: Apple tools write there independently of TMPDIR. Before sandbox launch reject overlap with evidenceRoot, orchestrator root, skillsRoot, packRoot and the resolved helper target. Unavailable Darwin temp leaves the existing verification grants; other platforms are unchanged. Keep TMPDIR/TMP/TEMP in each invocation's private directory. On macOS create review's directory with mode 0700 under ~/.mono-agent-workflow/review-tmp; validate its canonical location outside the Darwin root, all verification write grants, protected roots and workerWritableRoots before launch. Review receives no Darwin grant. Keep review.json, status.json and other consumed review artifacts in that directory and remove it afterwards. The shared worktree remains writable to verification descendants while review reads it: this exposure exists on main and is neither introduced nor closed here. Never use workerWritableRoots as collector grants; keep all orchestrator control state read-only. Exclude skillsRoot/evidenceRoot; a denial probe fails closed if that
boundary is missing. Record the probe independently of the command exit code; a review with findings fails as a review failure. Keep the trusted autoreview helper outside that write scope, including its real symlink target. Pause the worker during collection. Repository-configured executable Git filters are unsupported by privileged gate/helper reads: the gate refuses before execution, including after verification. If a product requires such filters, obtain a trusted isolation policy instead of disabling this check. Reconcile
an existing authenticated receipt matching request.collectionId and all pins before repeating collection; failed
reviews are completed runs too, not missing actions. Return present evidence as
{receipt: <evidenceRoot>/history/<runId>.json, receiptDigest: <SHA-256 of canonical envelope>, gate: <exact gate answer>}, including a fail. The runtime checks immutable history identity, digest, signature and collection ID before confirming or accepting confirmation; the mutable head receipt is never confirmation evidence. Fsync that result
and confirm through the same runtime. Publish and confirm enforce code → preflight → ship: read the latest earlier phase reports and earlier sequence confirmations, allowing only the fingerprint-bound code-report deferral above. Confirmations retain the report snapshot, so overwritten phase files do not erase sequence evidence. Missing or mismatched predecessors refuse before adapter calls. Fallback publication supplies --root; confirmation reads the report directory and root mailbox and refuses conflicting copies. Worker collect:false must pass before ready;
A review fix uses a new head/write ID. Use write.id=request.collectionId=preflight-collect:<head>:<n>. Increment n for each collection request on that head, including transient retries after a recorded failure; also advance the phase sequence. Never reuse the failed collection ID for a new run; a lost response retains its original ID. Bind confirmation evidence to the immutable history receipt as well as the current head receipt. Never let a worker collect or select new
pins. Preserve failed receipts. Configure confirmationTimeoutSec BEFORE dispatch
to cover verification plus review. Defaults: `confirmationTimeoutSec=1800`,
`collectionTimeoutSec=1500`, `collectionRetries=1` (nonnegative integer).
Require `collectionTimeoutSec < confirmationTimeoutSec < evidenceLimitSec`.
Launch pins all three collection/confirmation settings in the registry; old
attempts retain their existing confirmation timeout and use the new collection
defaults, so an old 1200-second window refuses collection without adequate budget.
One deadline is phase `publishedAt + confirmationTimeoutSec`; config changes and
collector restarts never reset it. Before a collection launch reserve its full
run limit plus 30 seconds for teardown, reconciliation and confirmation. A
receipt reconciliation uses the remaining window (at most the run limit),
reserving 10 seconds for teardown/confirmation; it requires at least 30 seconds
to start. Confirmation requires 5 seconds left and checks the deadline again
before publication. No new run starts without its budget. An early crash may
leave enough time to retry; a full-length timeout normally will not.
The released gate also holds its original deadline watchdog, including at most
2 seconds of teardown reserve; it kills its group even if the collector dies. After the gate finishes, the watchdog remains until
descendant telemetry proves its group empty.
On timeout signal the isolated group with TERM, then KILL if necessary, and
verify no live descendants remain before retry. Unknown/live groups refuse.
Exhausted retries, insufficient time or stalled reconciliation write `timed-out`
with the technical reason to the collector log and attention file; preserve
history for explicit orchestrator recovery. Project verification retries once
only with a proved sandbox and unchanged head/base; both numbered outputs are
signed in `verification.output`, with the last exit code. Sandbox or consistency
failures do not retry; the reviewer still runs at most once per collection.
Keep it below evidenceLimitSec as a configuration consistency rule. The evidence
limit runs from the ship attempt's startedAt, while confirmation waiting runs
separately from the phase report's publishedAt; the inequality does not prove
evidence freshness.
Pass the same --config to delivery-state.mjs confirm; its adapter timeout uses confirmationTimeoutSec. The gate locks collection per head in evidenceRoot. Spawn releases the registry lock after durable PID registration, waits for thread.started outside it, and registers the same attempt/PID thread under a short lock. Collector reclaim uses the incarnation/group checks and marker above; never remove a live or unverified lock or start a competing collector. Never extend an in-flight deadline; reconcile any late collector completion. Before the ship gate independently run preflight
collect:false with the same dispatch request. The pack collector uses the existing receipt key; no key service.

Publish whole-queue confirmations under <root>/confirmations/, outside all worker write grants. The worker wait refuses any confirmation path overlapping capsule.writable_roots. Keep reports as the sole writable mailbox; journal and registry remain outside the sandbox grant. Hostile local operator attestation remains out of scope. Run scripts/sandbox-contract.test.mjs outside a worker sandbox to prove the real Codex CLI boundary; absent CLI and detected nested Seatbelt are explicit skips, never host proof. Other failures block. The routine verify suite includes this test; the orchestrator runs it outside worker sandboxes for the actual boundary proof.

A confirmation timeout parking the worker as `write-unconfirmed` is an expected
path while a collection continues. Reconcile the late result with the same
collection ID, then confirm the original queue and resume the worker; do not
create a replacement request for a response that was merely late.

Publish confirmation only for the entire digest-bound queue, including empty
queues. Preserve in-phase order: drift sync before PR, ready certificate before
formal review, In Review/PR chip after PR. Keep phase=code|preflight|ship and the
same delivery context/log. A retry after terminal parked archives a reconciled
capsule only after remapping outstanding obligations to its new attempt through
Linear reconciliation; never erase old receipts or replay from an empty queue.

Consume final green only after current preflight/ship gates and all confirmations. For parked,
write the reason/text and next action to Linear in this SAME turn, read it back,
and then decide/escalate; missing write access remains an explicit pending action,
never a hidden stop. No report → recovery, never implicit green.

## Heartbeat

The Monitoring Protocol defines when to intervene; the heartbeat is the
external pulse that notices dying workers without spending orchestrator
turns. The runtime is `scripts/watch-workers.mjs`, resolved from the dispatched
pack root; the same source serves development and fixtures. It reads worker
state and, in persistent mode, atomically writes its own `watcher.json` each tick: pid,
procStart, packVersion, startedAt, beatAt, intervalSec. It emits one stable
line per watcher event to stdout —
`<ISO time> EVENT:<stall|dead|spawn-fail|failed|completed-without-report|report|phase|phase-rejected|gate-ack|halt|idle> <ISSUE-KEY|-> <detail>`.
`phase-rejected` names the task and mismatched identity fields when a phase
report fails strict report-to-task correlation. It never accepts the report or
suppresses liveness on its strength.
The watcher observes the active registry (`workers.json`), not the
directory's history; retired Issues' logs are outside its scope.

- At session start/restart, before any worker spawn or resume, the orchestrator must
  start the watcher against the mailbox root:
  `node '<pack-root>/scripts/watch-workers.mjs' --root ~/.mono-agent-workflow/orchestrator/<product> --config <cfg>`.
  Use the absolute product config path so watcher and worker share delivery clocks.
  Substitute `<pack-root>` with the dispatch pin or loaded plugin root;
  never use the product/worktree current directory.
  Keep it as a tracked background process of the session, with its stdout
  observed by the runtime's monitor primitive (Claude Code: Monitor with
  `persistent: true` or equivalent) continuously for the whole wave.
  Periodic wakeups are a fallback only as an explicitly recorded degradation;
  record the cause and binding in the ledger, and record actual monitoring recovery.
  Under `launch.lock`, spawn/resume require a pulse no older than three intervals,
  no more than one second in the future, and a live pid with matching procStart.
  `watcher-required` gives the start command; refusal registers no attempt and
  consumes no attempt allowance. Read-only `spawn --pins` is exempt.
  The common launch path rechecks the pulse before spawn under the same lock.
  Amendments record possible delivery only at that boundary; pre-spawn refusals
  and failed process creation leave no marker, while an indeterminate real
  launch retains its recovery evidence and refuses an automatic duplicate.
  If the session and watcher disappear together while a worker runs, the pack
  cannot detect that loss; the orchestrator environment owns that supervision.
- Each changed phase report file emits `phase`, regardless of stage order.
  Deduplication stays per file/mtime/size; the confirmation wait uses the latest
  publishedAt, then sequence, rather than the furthest stage.
- Watcher liveness events are Monitoring Protocol triggers: treat `stall`,
  `dead`, and `spawn-fail` lines as inspection triggers — read the worker's
  latest state first, then act on confirmed need. An alarm alone is no owner
  blocker; false alarms and other no-change wakeups stay silent in chat and ledger. `spawn-fail` feeds the spawn
  verification kill+retry rule in Worker Transports. Non-JSON contamination
  before later valid JSON events produces one diagnostic warning on stderr,
  not a repeated watcher event, and does not suppress stall/dead checks.
- `completed-without-report` and `failed` on Claude Code require recovery in the
  same session after reading the latest phase state; neither is a terminal task
  outcome. Only an attempt-correlated green/parked report supplies that outcome.
- `report` is emitted for managed `codex-cli` and `claude-cli` workers, whose JSONL log provides
  the correlation surface. The report must match the worker registry's A5
  identity and issue/stage, and must satisfy the exact v2 freshness predicate:
  report mtime is at least the log birthtime and at least log mtime minus the
  stall threshold. On `report`, read the correlated report and consume its final green/parked outcome.
  Report delivery is at-least-once across watcher restarts:
  one process suppresses an unchanged mtime+size version and emits an updated
  version, while a restarted watcher emits the current version once again.
  The consumer deduplicates by reading the report's current state.
  Desktop/fallback transports keep their existing report-polling contract; the watcher never
  emits `report` for `claude-code-desktop` or `fallback` entries.
- `gate-ack` rides the same correlation surface as `report` and the same
  at-least-once rule: managed CLI entries only, registry-matched identity and
  stage. Its freshness is deliberately NOT the report's, and the difference is
  load-bearing in both directions. Delivery asks only that the ack BELONG to
  this attempt — its mtime at or after the attempt log's birthtime — because a
  resumed worker's own execution advances that same log, and an ack left
  unconsumed by the crash window has to keep reaching the consumer precisely
  then; a delivered ack is therefore not a claim that the worker is still
  paused. Suppression asks the stricter question and applies the report
  predicate too, since only a current pause may silence liveness. A polling
  transport applies the same split: it must not discard a retained ack merely
  for lagging the log, or it discards the crash-recovery evidence.
  Delivery is at-least-once per watcher PROCESS, exactly as `report` is: an
  unchanged version is not re-emitted while that process lives, and a restarted
  watcher emits it once more. For a report that suffices because the
  orchestrator also polls the mailbox for reports; an ack needs the same poll
  for the same reason, and the orchestrator does poll for both. Never treat the
  event as the only route to an ack — a consumer that missed it while the
  watcher stayed up would otherwise see only the later `dead`, and the ack it
  must reconcile would sit unread. Its file is
  `reports/<ISSUE-KEY>-gate-ack-a<N>.json` or the worktree fallback path, whose
  minimal shape carries no identity fields, so its correlation comes from the
  registry entry and the log it belongs to. In the shared `readGateAck`
  boundary, the watcher validates the complete shape of
  `registryEntry.gates` before any set operation and then compares its names
  with the ack. When an ack exists, absent or malformed `registryEntry.gates`
  makes it unusable; there is no source-identity discriminator and no form-only
  legacy branch. Entries without an ack do not evaluate this gate-list consumer
  rule and keep their ordinary watcher liveness signaling. With a durable list,
  `gates-passed` requires exact set equality, while `blocked` accepts a
  non-empty subset with no foreign names; duplicates are invalid in both
  branches. Any mismatch produces neither delivery nor suppression. The
  watcher never mutates the registry snapshot. It also validates the ack whole
  and fails closed: a missing or malformed ack `gates` array, or
  `gates-passed` over a gate that did not pass, is treated as no ack at all. It is scoped to
  the delivery that can have a startup gate phase — a `mono-deliver` log — so an ack
  beside a legacy `mono-preflight` or `mono-ship` log, which carries no
  lifecycle move, is spurious and neither delivers nor suppresses.
  A fresh usable gate-ack suppresses `stall` and both `dead` branches for that
  worker during a bounded handoff: `gates-passed` waits for lifecycle
  application and wait-mode consumption or resume. A valid `blocked` ack gets the same bounded suppression until its stage
  report is observed or the ack is consumed, so the normal ack-before-report
  interval cannot start duplicate healing. That suppression is bounded twice
  over. Normally the
  consuming the ack ends the startup window. Wait-mode .applied gets only the
  fixed post-consumption continuation in Monitoring Protocol; legacy rename
  immediately re-arms the ladder. When both a `gate-ack` and a `report` are emitted for the
  same worker, the `gate-ack`
  comes first, because the consumer reads the ack's status before it acts on
  the report. But if lifecycle application succeeds and the resume, the
  registration, or that rename then fails, nothing would consume the ack at
  all, and freshness against the log never expires by itself: so suppression
  additionally lapses after a few stall thresholds of wall-clock, and the
  ladder re-arms on its own. While an unconsumed usable gate-ack is
  present that bound also governs over ordinary report suppression, which is
  unbounded by construction: otherwise a report left beside the ack — the
  very pairing this protocol sends to reconciliation — would silence the
  worker forever and reconciliation would never be triggered. That clock runs on the PAUSE — the worker's log
  going quiet — never on the ack's own timestamp: the ack sits at a
  worker-writable path, and a deadline the worker can refresh by touching
  the file is no deadline at all. That is an age window rather than a ceiling: an
  ack dated in the future buys no suppression at all, because the worker sets
  its own timestamps on the fallback path and a forged date would otherwise
  reopen the same unbounded silence. A gate pause that outlives that bound is a stuck
  handshake, not a healthy wait, and the orchestrator is meant to hear about
  it — reconcile the worker, then either retry the resume or consume the ack
  and treat it as the no-ack path. Suppression
  demands the same registry correlation delivery does: an ack the watcher would
  not deliver cannot silence liveness either. On `gate-ack`, read the
  exact correlated artifact, revalidate it against `registryEntry.gates` from
  the current attempt with the same status-asymmetric rule, and only then
  branch on its `status` —
  `gates-passed` runs step 4 onward
  of Two-Phase Dispatch Handshake, `blocked` applies nothing and waits for the
  ordinary stage report that path also writes. Either way it is a
  delivery event, never a Monitoring Protocol trigger. Every consumption
  branch atomically publishes the trusted private
  `<orchestrator-root>/consumed/<ISSUE-KEY>-gate-ack-a<N>.json` record first,
  then renames the attempt's ack candidates, and only then removes
  `registryEntry.gates`; a tombstone alone never authorizes cleanup.
  Non-Codex transports
  keep the polling contract here too.
- `idle` is product-wide (its issue-key slot is `-`) and fires after the active
  registry has been empty longer than `--idle-sec` (default 300). A5 retirement
  means deploy closeout removed the Issue entry; `control.json` state `idle`
  does not retire a remaining entry, and entries present while control is
  `active` or `draining` always block `idle`. `idle_since` is the later of the
  registry mtime and the last emitted watcher event, so any emitted event moves
  the clock forward; repeat emission is no more frequent than that idle window
  (and remains subject to `--repeat-sec`). On `idle`, the orchestrator records
  the idle period and its cause in `ledger.md`, satisfying the mandatory
  longer-than-five-minutes idle rule rather than treating it as routine polling.
- The stall threshold is at least 90 seconds (default 120); lower values
  misread normal turn gaps as stalls, and the watcher refuses them.
- Healing ladder, in order: nudge (resume the thread demanding a report) →
  respawn (rebuild stage state per the Monitoring Protocol) →
  session rotation (fresh thread and fresh attempt-numbered log). Alert the
  owner only when the ladder is exhausted (owner decision Q3); never page
  on the first stall.
- Forced worker termination is a process-tree operation: starting from the worker PID recorded in the registry, enumerate descendants recursively with `pgrep -P`, terminate the captured tree leaf-to-root and the wrapper last (never kill only the wrapper PID), then prove from the captured PID set plus an exact transport-thread-id process search that no survivor remains before resume, respawn, or session rotation. A survivor can retain the transport thread and hang every later resume.
- Every healing step and its result are mandatory ledger entries — a
  confirmed intervention is never routine polling. An inspected alarm with no
  change creates neither a routine ledger entry nor an owner message.

## Decision Briefs

Never bring the user an unprepared question. Before asking:

1. Exhaust autonomous work; ask only when the question is the item's last
   blocker.
2. Prepare visual variants for design questions.
3. Refresh item state immediately before asking; never re-ask an answered
   question and never present a stale item as decision-ready.

Brief contents per `templates/orchestrator-brief.md`: what changes and for
whom, why the decision is needed now, completed proof (tests, autoreview, CI,
certificates as applicable), recommendation with rationale, exact options.
Ask immediately and interactively; unblocked work continues in parallel.

Brief integrity — five rules bind every decision brief; the
user-facing shapes live in `templates/orchestrator-brief.md`
(«Целостность брифа»):

- Question IDs mirror board section IDs exactly. Multiple questions
  inside one section get section-scoped suffixes (1a, 1b).
  Cross-section renumbering is forbidden.
- Every option carries a self-identifying token rendered on both the
  board and the brief (e.g. «1a-КАРТОЧКА / 1a-МОДАЛКА»); an answer is
  valid without its number when the token or the verbatim option text
  identifies it.
- Echo-back: before acting on answers, the orchestrator posts a mapping
  table «вопрос → выбранный вариант (дословно)»; an answer whose text
  does not match the addressed question's option set is a numbering fault
  and requires a mandatory one-line re-confirm before any work on that
  item.
- An item routed to a checkpoint as contested is never closed by silence:
  no answer means asked again, not resolved. A fallback line never
  resolves a contested item.
- Any spec or record change after the owner's start that alters user-visible
  behavior appears as an explicit «Изменилось после твоего одобрения:»
  delta list at the next owner touch, never only as a fait-accompli
  status line. When in doubt whether a change is user-visible, include
  it in the delta.

## Context Budget

Orchestrator session context usage is a first-class operational metric,
not an implementation detail. Wave-1 precedent: the session peaked at 92%
of a 1M-token window with no signal to the owner.

- Report current usage as «Контекст: ~N%» in every status update; a rough
  estimate is fine — the trend matters more than precision.
- Compaction-first is the default: keep one orchestrator session and set
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75` in the product's local Claude
  settings so automatic compaction begins at 75% context usage.
- The safe-boundary sentinel is `<orchestrator-root>/compaction-safe`. After
  every stage close and every ledger write, the orchestrator touches this
  file only after the durable state is current. The sentinel is fresh for
  300 seconds by default; an absent or stale sentinel never authorizes
  automatic compaction. The freshness window is configurable in
  `templates/orchestrator-compaction-hook.sh`.
- Wire the template's `PreCompact` hook for automatic compaction. It blocks
  outside a fresh safe boundary for at most three consecutive deferrals;
  the fourth automatic attempt is forcibly allowed and resets the counter,
  preventing context-window starvation. Manual compaction is always
  allowed, and a fresh sentinel also resets the counter.
- Use `templates/compact-instructions.md` for the compaction summary. As the
  first post-compaction action, re-read the tail of `ledger.md`,
  `workers.json`, and the product's memory index before monitoring,
  dispatching, mutating Linear, or answering from the compacted summary.
- A session handoff through the Resume procedure is an exceptional fallback
  for a corrupted/unrecoverable session or a compaction that cannot preserve
  safe state. It is not the default response to a context threshold.

## Cost Telemetry

Per-Issue collection, performed by the orchestrator:

- Worker tokens: sum every Codex `turn.completed` or Claude Code `result.usage`
  event in every attempt log of
  every stage (`logs/<ISSUE-KEY>-<stage>-a<attempt>.jsonl`). Each event is
  per-turn, not cumulative — the observed input sequence 516,590 → 433,845
  → 5,072,542 in one thread is the motivating evidence. Keep input, cached
  input, and output separate; cached input is a subset of input and must not
  be added to it again. Include respawned, parked, and failed attempts, and
  deduplicate attempt files by their canonical path. Claude cache reads and
  creation are included in normalized input. A missing final result preserves
  unavailable/incomplete coverage across continuations; never replace it with zero.
- Review cycles: the count of review submissions handled during the ship
  stage, taken from the ship-stage report and PR review history.
- Stage wall-clock: derived from the ledger's write-time entries for stage
  dispatch and stage close; honest write-time discipline (see Mailbox And
  Ledger) is what makes this derivable. For `recorded-late` entries, use
  the marker's estimated event time, not the late write-time.

Record the collected numbers per stage in the ledger at stage close; a
  missing number is recorded with the reason it could not be collected, on
the same stage-close entry or an adjacent line. Judgment note, stated
honestly: collection is manual agent work — reading logs, counting review
submissions, subtracting timestamps — not a pin-enforceable mechanism;
pins can anchor this policy text, not the collection itself.

Cost is telemetry, not a gate: no thresholds, no blocking, visibility
only. Never pause, steer, or fail a worker because of cost numbers, and
never let cost collection delay a phase transition; a missing number is
recorded as unavailable, never blocks, and never pages the user. Cost
data feeds status updates and the final wave report per
`templates/orchestrator-brief.md` («цена: …» per Issue, «Цена волны» for
the wave) — async-visible records for the owner, nothing more.

## Resume

A fresh orchestrator session rebuilds state without loss:

1. Read the project config; locate the mailbox root.
2. Scan Linear: projects in flight, Issue statuses, latest comments and
   certificates. Separately query open parentless Issues carrying the verified `issue-only` label. For every returned candidate, re-read its body, current
   marker comment, authenticated owner-approval comment, and project config,
   then re-run the 5-field context seam with the freshly emitted whole-body
   fingerprint. Only `package_kind=issue-only` plus `approval_status=approved-fresh` is resumable as an issue-only package.
   Missing label or marker is not discovered as issue-only; a broken/stale
   marker, missing authenticated approval, or closed status is excluded. Any
   unverified reconstruction fails closed and is excluded from the issue-only queue. This
   scan adds parentless issue-only discovery only; it does not change dependency
   ordering or reclassify any fail-closed result.
3. Read ledger, phase capsules and mailbox reports; reconcile every queued write against Linear and apply only missing writes through Delivery Write Barriers. Never replay a queue from local receipts alone.
4. Corroborate key ledger claims — dispatches, phase transitions, deploys —
   against worker log and report timestamps. A ledger line with no
   supporting evidence is marked unverified and its state is re-derived
   from Linear plus logs instead of being trusted. This is a judgment rule
   for the resuming session, not a pin-enforceable check: it defines how
   much to trust the ledger, not a mechanical validation.
5. Read `workers.json` and list live worker sessions when the runtime allows
   it. Consult `consumed/` only when `registryEntry.stage` is `mono-deliver`
   and the CURRENT registry log basename is
   `<ISSUE-KEY>-mono-deliver-a<N>.jsonl`. Before clearing any stale
   `registryEntry.gates`, parse the CURRENT
   attempt `<N>` from that entry's `log` and require the private orchestrator
   consumption record. First successfully fsync the orchestrator-root directory
   that contains `consumed/`, even when the namespace already exists, and then
   fsync the existing `consumed/` directory. The first sync completes any
   interrupted namespace creation; the second completes any visible record
   rename whose earlier directory sync failed. If either sync fails, stop with
   the ack and registry unchanged. Then read
   `<orchestrator-root>/consumed/<ISSUE-KEY>-gate-ack-a<N>.json` for the SAME
   current `<N>`. Only a well-formed record in `consumed/` whose `issue`,
   `attempt`, and `outcome` match this Issue, current attempt, and one of
   `applied | rejected | blocked` authorizes removal. A fabricated record in
   `reports/` never authorizes cleanup. Neither does a tombstone in either ack
   location, including the worker-writable fallback. A missing, malformed, or
   other-attempt private record leaves the ack and `gates` in place; reconcile
   the current attempt or verified-respawn a new attempt, whose spawn
   registration rewrites the field. When a current-attempt private record exists but an unconsumed ack
   candidate remains, finish every in-place rename selected by its `outcome`
   before removing `gates`. This is the crash recovery for every window between
   outcome publication, ack rename, and the separate registry deletion.
   If that current-attempt record has `outcome: rejected`, the attempt is
   durably terminal even after its ack was renamed and `gates` was removed.
   Resume skips same-attempt nudge and verified-respawns a NEW gate attempt
   with its own correct list before the ordinary no-ack ladder can run.
   Compare each entry's `surfaceRevision` with the currently installed
   plugin identity before using its thread id. When surfaceRevision differs, do not rebind
   or resume that thread; report it blocked and start a new attempt.
   Otherwise find surviving `codex-cli` and `claude-cli` workers by thread id;
   keep a live writer, and resume only a cleanly stopped one
   through installed scripts/orchestrator/resume.mjs instead of respawning them.
6. Output the rebuilt status table before taking any new action.

Forced mid-wave resume drill — a planned one-time operational act,
not a recurring gate: during the next wave the orchestrator deliberately
performs a clean handoff to a fresh session mid-wave, at a safe boundary
per Context Budget (after the current monitoring pass or phase transition
completes, never mid-dispatch), runs this Resume procedure for real, and
records every reconstruction discrepancy in the ledger — unverified
ledger claims, lost thread bindings, unapplied Linear mutations, report
gaps; "no discrepancies" is a valid result only after actively looking.
The drill result feeds the PRD wave-1 success criteria. Before scheduling the drill, check the ledger and PRD for a completed-drill record and skip if one exists — it is one-time, not per-wave. Rationale: the
wave-1 orchestrator session peaked at 92% of a 1M context window and a
forced mid-wave resume has never been tested.

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
