# Worker Report And Ledger Shapes

Machine-facing shapes for the `mono-orchestrate` mailbox. The worker report
JSON is English only, except `verification_items[].item`, which carries the
Issue's «Как проверить» lines verbatim in their original language. Ledger
entries are English except the fixed domain term
«Решил сам:» / `решил сам` from `references/orchestration.md`. No secrets in
either shape.

## Worker Report

Use the Worker Report section of `references/worker-contract.md` for phase capsules, confirmations, final green/parked reports, verbatim verification items and the parked-reason dictionary.

## Worker Registry

Path: `~/.mono-agent-workflow/orchestrator/<product>/workers.json`

Orchestrator-owned runtime metadata; workers never read or write it. One
entry per Issue, updated on gate pre-registration, spawn, phase progress, and
respawn. The registry
is what lets a fresh orchestrator session rebind to surviving `codex-cli`
threads (`codex exec resume <thread_id>`) instead of respawning them, and it
is the durable source of the gate names dispatched for the current attempt.

```json
{
  "<ISSUE-KEY>": {
    "transport": "<codex-cli | claude-code-desktop | fallback>",
    "model_policy": {
      "role": "<selected worker role>",
      "model": "<resolved policy model id>",
      "effort": "<resolved policy effort>"
    },
    "model_launch": {
      "case": "<codex-cli | fallback | claude-code-desktop>",
      "model_parameter": "<exact id or runtime alias actually set, or null>",
      "effort_parameter": "<effort actually set, or null>",
      "effort_source": "<explicit | runtime-default | unknown>",
      "actual_model": null,
      "evidence": "<requested command parameters | runtime alias assumption | manually selected, actual model unverified>"
    },
    "thread_id": "<codex thread id, or null>",
    "worktree": "<absolute path>",
    "branch": "<branch>",
    "stage": "mono-deliver",
    "attempt": "<positive integer>",
    "confirmationTimeoutSec": 1800,
    "product_name": "<product-language name for owner-facing statuses, or omitted>",
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

### Model provenance

For each new launch, record `model_policy` and `model_launch` in both the
generated dispatch and registry. `model_policy` is the intended row's role,
model and effort; `model_launch` is what was actually set, not a copy of that
intent. Use JSON null for unknown values (never the string "null"). The
`model_launch.case` matches `transport`:

- `codex-cli`: `model_parameter` and `effort_parameter` are the exact values
  passed in the command; `effort_source` is `explicit`. Codex does not report
  the served model, so `actual_model` remains null.
- `fallback`: `model_parameter` is the actual Agent runtime alias, with its
  alias-to-id mapping recorded as an assumption in `evidence`.
  `effort_parameter` is null, `effort_source` is `runtime-default`, and
  `actual_model` is null. Intended effort is not an applied parameter.
- `claude-code-desktop`: the owner selects manually; parameters not observed
  remain null, `effort_source` is `unknown`, and `actual_model` is null.
  Record "manually selected, actual model unverified" in `evidence`.

Legacy entries without these fields stay without them: never backfill from
the current policy. Unknown historical parameters stay unknown. Existing
threads retain launch pins; new values apply only to launches after install.
Resume still requires the existing pack identity gate. These fields add
provenance, not a runtime audit or permission to change a running model.

`gates` is optional. When present it is a non-empty array of unique,
non-empty strings, permitted only on the registry entry for a gate-carrying
`mono-deliver` dispatch. It is scoped to the current attempt identified by
`log`: a verified new gate attempt replaces it with that attempt's exact list,
and it never survives handshake consumption or another attempt.
When an ack exists, an absent or malformed `gates` value makes the ack
unusable and requires a verified new attempt with a correct list. With no ack,
field absence does not change the entry's watcher liveness signals.

`product_name` is optional: the product-language name this Issue is called
by in owner-facing statuses, so an orchestrator that resumed or compacted
keeps speaking product language instead of falling back to the Issue key.
It is descriptive metadata — it gates nothing, changes no worker contract,
and never replaces the Issue key in machine fields.

`thread_id: null` together with `pid: null` is permitted only for the
inactive gate-startup state: a gate-carrying `mono-deliver` entry with valid
`gates`, its empty attempt-numbered `log`, and publication-time `spawned_at`,
atomically registered only after that log file and its `logs/` directory have
both been fsynced and before the worker process starts. The watcher keeps that
state quiet for one bounded startup window measured from `spawned_at`, never
from log mtime. Until a valid `thread.started` arrives, empty or partial
output, contamination, another JSON event, and complete non-JSON output all
remain bounded; at timeout the watcher emits `spawn-fail`. A missing, invalid,
or more-than-five-seconds-future timestamp emits `spawn-fail` immediately,
never `dead`. Each watcher pass reads at most 256 KiB and resumes at its saved
cursor, so a busy pre-start log cannot block other workers and a later
`thread.started` remains discoverable. At timeout the watcher freezes the
observed size and finishes that snapshot before `spawn-fail`; later appends do
not extend the deadline. `--once` completes it through additional bounded
passes, and elapsed milliseconds are compared without rounding the startup
window upward. A missing or unreadable attempt log also emits
`spawn-fail`.
The launcher records pid immediately, while thread_id stays null through the
same bounded startup window. After `thread.started`, it records thread identity while preserving `log`
and `gates`; every other live `codex-cli` entry carries verified process
identity.

## Product Control

Path: `~/.mono-agent-workflow/orchestrator/<product>/control.json`

The orchestrator owns this file beside `workers.json`. Its complete schema is:

```json
{
  "state": "idle",
  "halt": false
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

Delivery entries keep stage=mono-deliver across phases. Startup gates are removed only after durable handshake consumption. Phase reports bind attempt, sequence, head and the full queue; confirmations bind their digest. Use scripts/orchestrator tools from the installed runtime. attempts.json retains per-Issue counts after active entries retire; never reset it to bypass a configured cap. halt refuses both spawn and resume without touching an existing process.
