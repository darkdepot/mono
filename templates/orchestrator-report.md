# Worker Report And Ledger Shapes

Machine-facing shapes for the `mono-orchestrate` mailbox. The worker report
JSON is English only, except `verification_items[].item`, which carries the
Issue's «Как проверить» lines verbatim in their original language. Ledger
entries are English except the fixed domain term
«Решил сам:» / `решил сам` from `references/orchestration.md`. No secrets in
either shape.

## Worker Report

Path: `~/.mono-agent-workflow/orchestrator/<product>/reports/<ISSUE-KEY>-<stage>.json`

```json
{
  "issue": "<ISSUE-KEY>",
  "stage": "<mono-implement | mono-preflight | mono-ship>",
  "status": "<implemented-needs-preflight | ready | green | blocked | needs-decision | needs-human | drift-candidate | timed-out | scope-drift-needs-handoff>",
  "packVersion": "<dispatch packVersion>",
  "sourceCommit": "<dispatch sourceCommit>",
  "surfaceRevision": <repeat the dispatch pin, integer>,
  "branch": "<branch>",
  "changed_files": ["<path>"],
  "tests": { "run": "<commands>", "result": "<outcome>" },
  "verification_items": [
    { "item": "<one «Как проверить» line, verbatim>", "status": "pass | deferred | not-run", "evidence": "<one line>" }
  ],
  "question": "<question text, or null>",
  "recommendation": "<the worker's own recommended answer, or null>",
  "linear_mutations_pending": ["<comment/status text the worker could not apply; where a certificate belongs, the literal pointer `append #/certificate`>"],
  "certificate": "<preflight certificate or mono-ship green certificate text — the only home of that text, or null>",
  "notes": "<runtime substitutions or constraints the orchestrator must know, or null>",
  "next": "<mono-preflight | mono-ship | mono-deploy | null>"
}
```

`notes` is optional free text for runtime facts the fixed fields cannot
carry — e.g. an engine or workflow substitution because the configured skill
was not available in the worker runtime. It never replaces a status.

The three pack identity fields are mandatory in every report and repeat the
dispatch pin the worker verified at stage start or resume. They identify the
contract that produced the report; `notes` must not substitute for them.
`surfaceRevision` is an integer, never a string: the orchestrator correlates
a report only when `packVersion` is a non-empty string, `sourceCommit` a
40-character hex SHA, and `surfaceRevision` a positive integer.

Both shapes therefore show `surfaceRevision` as an unquoted
`<repeat the dispatch pin, integer>` placeholder instead of a literal
number. An example that carries a concrete revision is a revision a worker
can copy, and during a surface cut-over the repository's own code constant
and the pin the dispatch carries are deliberately different numbers — only
the dispatch pin belongs in a report or a registry entry. The dispatch pins
are the installed lockfile values read at spawn time, so "repeat the
dispatch pin" and "installed lockfile" name the same number. Because of that
placeholder both blocks are shape sketches, not parseable JSON.

`certificate` is the single home of certificate text: a preflight or
`mono-ship` green certificate appears in the report exactly once, as the
content of that one field. A queued Linear comment references it and never
copies it — write the comment's own lead text and put the literal pointer
`append #/certificate` where the certificate belongs, and the orchestrator
splices the field in when it applies the mutation. Two copies are two
authorities that can diverge with no rule for resolving the divergence.

```text
Preflight по <ISSUE-KEY> зелёный. Сертификат: append #/certificate
```

`verification_items` is optional in shape but mandatory in coverage: a
stage-terminal report for `mono-implement` or `mono-preflight` MUST
enumerate every «Как проверить» item of the Issue, each with status
`pass | deferred | not-run` and one line of evidence. `deferred` and
`not-run` require a reason in `evidence`; a stage cannot claim completion
while an item is silently missing. The field is additive — it never changes
or replaces the report `status` set.

One semantics and one status enum, stated here once. The dispatch template
and the stage skills point at this list instead of restating it:

- One item per line of the Issue's «Как проверить», in the Issue's own
  order, with `item` carrying that line verbatim in its original language.
  Do not decompose one line into several items, do not merge lines, and do
  not re-key the array to acceptance criteria or to invented check names.
- `status` is exactly `pass | deferred | not-run`. The enum is closed: no
  stage, dispatch, or report adds a value to it.
- A «Как проверить» line with no command shape is still one item with a
  status from that enum. Its judgment mode is recorded in `evidence`, which
  opens with `judgment check:` and then states what was inspected and what
  was observed. `judgment check` is never a status value.
- An item that a later stage or the orchestrator owns is `deferred`, with
  the owner named in `evidence`.

Status semantics:

- Stage-terminal statuses reuse the stage skill's exit statuses verbatim:
  `implemented-needs-preflight` (implement), `ready` (preflight), `green`
  (ship green certificate), `blocked`, `needs-human`, `drift-candidate`
  (preflight), `timed-out` (ship), `scope-drift-needs-handoff`. Report the
  stage's own status — the orchestrator decides whether to answer, escalate
  to the user, or respawn.
- `needs-decision` is mailbox-only: the worker is paused mid-stage on a
  question and has included its own recommendation. The orchestrator answers
  (technical) or escalates (Always-ask) and then continues the same worker.

## Worker Registry

Path: `~/.mono-agent-workflow/orchestrator/<product>/workers.json`

Orchestrator-owned runtime metadata; workers never read or write it. One
entry per Issue, updated on spawn, stage advance, and respawn. The registry
is what lets a fresh orchestrator session rebind to surviving `codex-cli`
threads (`codex exec resume <thread_id>`) instead of respawning them, and it
is the durable source of the gate names dispatched for the current attempt.

```json
{
  "<ISSUE-KEY>": {
    "transport": "<codex-cli | claude-code-desktop | fallback>",
    "thread_id": "<codex thread id, or null>",
    "worktree": "<absolute path>",
    "branch": "<branch>",
    "stage": "<mono-implement | mono-preflight | mono-ship>",
    "gates": ["<dispatched gate name>"],
    "packVersion": "<installed lockfile packVersion>",
    "sourceCommit": "<installed lockfile sourceCommit>",
    "surfaceRevision": <repeat the dispatch pin, integer>,
    "spawned_at": "<ISO 8601>",
    "last_activity_at": "<ISO 8601>",
    "log": "<absolute path to the worker's JSONL log, or null>",
    "pid": "<OS pid of the codex-cli background process, or null>"
  }
}
```

`gates` is optional. When present it is a non-empty array of unique,
non-empty strings, permitted only on the registry entry for a gate-carrying
`mono-implement` dispatch. It is scoped to the current attempt identified by
`log`: a verified new gate attempt replaces it with that attempt's exact list,
and it never survives into `mono-preflight`, `mono-ship`, or another attempt.
When an ack exists, an absent or malformed `gates` value makes the ack
unusable and requires a verified new attempt with a correct list. With no ack,
field absence does not change the entry's watcher liveness signals.

## Product Control

Path: `~/.mono-agent-workflow/orchestrator/<product>/control.json`

The orchestrator owns this file beside `workers.json`. Its complete schema is:

```json
{
  "state": "idle"
}
```

`active` permits normal dispatch, `draining` permits only existing work to
close, and `idle` means no live work remains. Quiescence requires both
`state: idle` and an empty `workers.json`; neither signal is sufficient alone.

## Ledger Entry

Path: `~/.mono-agent-workflow/orchestrator/<product>/ledger.md`

```text
## <YYYY-MM-DD>
- <HH:MM> <ISSUE-KEY> dispatched: <stage>, worker `<ISSUE-KEY>: <stage>`
- <HH:MM> <ISSUE-KEY> решил сам: <decision> (<one-line reason>)
- <HH:MM> <ISSUE-KEY> user decision: <decision>
- <HH:MM> <ISSUE-KEY> landed/deployed: <PR/SHA + evidence>
- <HH:MM> blocker: <exact blocker and what is needed>
```

Only the orchestrator writes the ledger. Routine polling is never recorded.
