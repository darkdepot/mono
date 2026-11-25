---
name: session-audit
description: Weekly audit of Mono sessions in the mono repository. Use when the owner says «разбери сессии». Maps every real Mono session since the last pass, reads ledgers, reports and owner words, opens sessions by signals and a small random sample, checks each finding against its source, joins repeats with past findings, writes one weekly report and at most five Triage issues without quotes, and prints the summary. Project skill, not part of the pack.
---

# Session audit

Project skill of the mono repository, run in a Claude Code session in a mono
checkout. Scripts count and read; the session judges. Session files of both
hosts and the pack are only read; everything written goes to the data root.
No script calls Linear.

Commands (Node, no dependencies):

```bash
node .claude/skills/session-audit/scripts/session-audit.mjs collect --session ${CLAUDE_SESSION_ID}
node .claude/skills/session-audit/scripts/session-audit.mjs extract <session id> --session ${CLAUDE_SESSION_ID} [--from <event|ISO>] [--to <event|ISO>]
node .claude/skills/session-audit/scripts/session-audit.mjs cost --pass <pass uuid>
node .claude/skills/session-audit/scripts/session-audit.mjs cost <session id>...
```

The weekly pass adds `signals`, `opened`, `check`, `confirm`, `candidates`,
`register`, `select`, `plan`, `op`, `commit` and `summary` (see «Weekly pass»
and `--help`). Each takes `--session ${CLAUDE_SESSION_ID}`; files given to them
(subagent results, saved Linear answers) must lie in `runs/<pass uuid>/` of the
data root, for example `runs/<pass uuid>/inbox/`.

Output is JSON on stdout; a refusal is JSON on stderr with a non-zero exit
(2: stop with a reason, 3: the pass belongs to another session).

## Data root

`SESSION_AUDIT_HOME`, else `<MONO_WORKFLOW_STATE_ROOT or ~/.mono-agent-workflow>/orchestrator/mono-agent-workflow/session-audit/`.
Every command stops when the root, after resolving symlinks, is inside a git
checkout, the mono repository or a pack install directory (`packInstallDirs`
of `config.json`, or any directory with a Mono plugin manifest), with the
real letter case of existing folders. Ids and file names that become paths
must be plain (`[A-Za-z0-9._-]`, no `..`); every write and delete goes through
plain directories of the root, never through a symlink or into a file with a
second hard link. `collect` and `extract` hold `<data root>/lock` (created
whole in one step with the holder's pid and a unique token) and write only
while `state.json` still names their pass and session. An existing lock is
never reclaimed on its own: the command stops with `holderPid`,
`holderSession`, `lockAgeMinutes` and `holderAlive`. Tell the owner; only
after the owner's words «забери проход» run `collect --take-over`, which also
takes the lock and writes a line to `<data root>/lock.log`. The holder removes
its lock on release.

- `config.json` here holds shared values only. `<data root>/config.json`
  overrides them key by key: `runPrefixes`, `standCodexHomes`,
  `excludedSessions`, `projectId` (Linear project of the weekly report) and
  `triageTeam` (Linear team for Triage). Without `projectId` and `triageTeam`
  `plan` stops loudly and nothing is written to Linear.
- `state.json`: `boundary` (end of the last finished pass), `deferredTails`
  and `pending` (`uuid`, `windowStart`, `windowEnd`, `startedAt`, `sessionId`,
  `deferredTails`, after a takeover also `takenOverAt`, `takenOverFrom`). The
  command that moves the boundary also moves `pending.deferredTails` to
  `state.deferredTails`: records that were still being written (`file`,
  `offset`) are read as new in the next pass whatever their own time.
- `queue.json`: `{signals: []}`, signals not opened yet; `collect` only counts
  them, `signals` writes them, `commit` drops the opened ones.
- `findings.json`: the findings registry (U7), apart from what was read.
- `runs/<pass uuid>/`: `map.json`, `log`, `extract/<session>/chunk-NN.md`,
  `signals.json`, `opened.json`, `checked/`, `checks.json`, `findings.json`,
  `F-<uuid>/finding.json` (quotes; the pointer of the report),
  `selection.json`, `plan.json`, `summary.json`.

## collect

Window: (boundary, now]; the first pass takes `firstPassDays` (7). An event is
new when its own timestamp is in the window; file times are used only to skip
files not written since the window start.

- An unfinished pass of this session is resumed: same uuid and window.
- An unfinished pass of another session stops the run with `passUuid`,
  `holderSession` and `silentMinutes` (since the last event in its file). Tell
  the owner and ask to close that session. Only after the owner's explicit words
  «забери проход» run `collect --take-over`; it writes this session as holder
  and a line to the pass log. Never pass `--take-over` on your own.
- No new session events, no sources in the window and an empty queue: prints
  `nothingNew: true` and writes nothing.
- An unknown record kind in a session file stops the run with every file and
  line; add the kind to `config.json` only after reading such a record.

A session counts only with a real Mono load: a Claude `isMeta` user record
starting with `Base directory for this skill: <dir>/skills/<name>` whose body
(after that line, one empty line and a trailing `ARGUMENTS: …` block) equals
`skills/<name>/SKILL.md` of a tag without frontmatter, or whose `<dir>` is a
Mono pack root; a Codex call that reads `…/skills/<name>/SKILL.md`. A partial
read (Read with offset or limit, `sed -n`, `head`, `tail`, cut output) counts
with a pack root path or at least 10 non-empty body lines. A full read matches
a tag only when its whole text equals the tag file; a partial read only when
every line it shows is one contiguous range of the tag file. Search output
(`rg`, `grep`) is not a read. Codex outputs printed as JSON (one per line or
several on one line) are unpacked first. A read whose output is known (one
result per call, or one call with one read) is judged on that output, and a
mismatch makes the version unconfirmed; other reads take only an output that
fits them and no other read of the call, else they stay unconfirmed. Relative
paths are resolved against the folder the command ran in.
Quotes of the load line, `invoked_skills` attachments, foreign skills with Mono
names, sessions without a load and sessions of this audit (any session that
loaded `.claude/skills/session-audit`, with its subagents, forks and headless
runs it started) are not counted. Codex items without an id are told apart by
time and position; a fork's items count as copies only when they equal a
parent item and come in the copy burst at the fork's start.

## map.json

- `schema`, `passUuid`, `startedAt`, `window` (`start`, `end`), `tags`.
- `sessions[]`: `id`, `ids` (all session ids joined by resume copies), `host`
  (`claude`, `codex`), `profile` (Claude profile directory or Codex home),
  `files`, `cwd`, `product` (repository folder of the work folder, `orchestrator/<product>`
  for a worker found there, else `unknown`), `kind` (`owner`, `orchestrator`,
  `stage-agent`, `worker`, `review`), `run` (`marked`, `reasons`: `qa-load`,
  `prefix:<p>`, `stand-home:<h>`), `loads[]` (`skill`, `at`, `path`,
  `partial`, `version`), `links` (`parent` `{id, via}`, `orchestrator`
  `{product, via}`, `task`, `stages`), `linkStatus` (`linked` or `none`:
  «без связи»), `newEvents`, `forkedFrom`, `forkTime`, `forkCopiesSkipped`,
  `revisitKeys` (events read again from deferred tails), `firstNewEvent`,
  `lastNewEvent` (`key`, `ts`).
- `version`: `{status: "confirmed", tags, range}` (one tag or `first..last`)
  or `{status: "unconfirmed", pathHint}`. Tags are those whose files equal the
  loaded `SKILL.md` and every pack file the stage read after the load; the path
  is only a hint.
- `links.parent.via`: `subagent-meta`, `codex-thread-spawn`, `codex-fork`,
  `parent-output` (the child's id printed in exactly one parent's tool output).
  `links.orchestrator.via`: the orchestrator file that names the worker's id.
  Ambiguous links stay empty.
- `sources`: `ledger[]` (`product`, `path`, `line`, `ts`) and `reports[]`
  (`kind`: `phase-report`, `candidate-report`, `review-receipt`, `qa-report`;
  `product`, `path`, `ts`), each with its own time in the window. Review
  receipts are `history/*.json` of the evidence roots (`<state root>/evidence/<product>`
  and every `evidenceRoot` in the product's dispatch records), timed by
  `receipt.recordedAt`.
- `counters`: `sessions`, `newEvents`, `byProduct`, `byKind`, `byVersion`
  (range or `unconfirmed`), `byHost`, `sources`, `excluded` (`noMonoLoad`,
  `audit`, `configured`, `noNewEvents`).
- `deferredTails[]`: `session`, `file`, `offset`, `line` of last records still
  being written.
- `queueLength`.

## extract

Digest of the new events of a map session, or of `--from`/`--to` (an event key
or ISO time, for a queued signal), written to `runs/<uuid>/extract/<session>/`
and listed as `chunks[]` (`file`, `bytes`, `contextBytes`, `entries`, `first`,
`last`). Lines are `[time] kind: text`: `owner` (or `prompt` in subagents and
headless runs) verbatim with commands, `assistant` visible text, `question`
(when asked, with options and `status`: unanswered until a reply; Claude
`AskUserQuestion`, Codex `request_user_input_async` with its reply message and
`request_user_input` with answers in its output), `answer` (at the reply's own
time), `load` with version, `op` (plan, helper and write
tools by name only), `second-model` (`codex exec` or `claude -p` command and
output at the output's own time, at most 20 KB). No other tool results and no
reasoning. Above 200 KB the digest is cut at stage loads and at 200 KB inside a
stage; an entry above 200 KB continues as `[part i/n]` pieces. Each chunk has up
to 20 KB of context (last stage load and earlier owner words), which is not new.

## cost

Claude usage of the pass sessions (found by the pass uuid in their text) or of
given session ids, with their `subagents/`, each `message.id` once (the record
with the largest usage wins). Fields and sums follow `scripts/token-usage.mjs`:
`usage`, `tokens` (full input plus output) and `cacheReadTokens` apart.

## Weekly pass

Run in this order; every step after `collect` refuses a session that does not
hold the pass (exit 3). Never work around a refusal. The data root lock
refuses rather than waits, so this session runs `extract` and every pass
command one at a time; subagents only read chunk files and write inbox files,
each finding with its own id.

1. `collect`. `nothingNew: true`: say so and stop; nothing is opened or
   written. A resumed pass continues where it stopped (its plan included).
2. Mandatory layer, read whole by subagents in parts: the ledger lines and
   reports of `map.sources`, and the owner words of top-level `owner` and
   `orchestrator` sessions (`extract` of each; `owner` lines only, without
   notifications, service records or tool results). The subagents return
   interventions they find as `[{session, from, to, reason: "intervention"}]`;
   save that list to `runs/<uuid>/inbox/extra.json`.
3. `signals --extra <file>`: mechanical signals (park, `phase_result` blocked
   or needs-human, `not-converged` receipts, a tester report whose
   `mono-qa certificate` says `failed`, attempt ≥ 2, long phase: from the
   issue's `DISPATCHED` ledger line or the previous phase report to this
   report's `publishedAt`, over two medians of the stage and at least 30
   minutes) plus the
   queue, ordered by cost (stop, intervention, extra rounds, attempt, length;
   unknown is zero and after a known equal). A signal joins a session only by
   an id written in its source; else `session: null` («без связи»), its source
   line is the evidence. `random` are three sessions without signals, of
   different kinds, seeded by the pass uuid.
4. Open the three random sessions and the signals in order. Session signals:
   `extract <session>` (a queued signal of an earlier pass: `extract <session>
   --from <range.first.ts> --to <range.last.ts>`). Each opening is one
   subagent (`openModel` of the config, empty: this session's model) with the
   digest chunks, `SKILL.md` and references of the stage at every tag of the
   range (`git show <tag>:<path>`), and the registry candidates
   (`candidates --stage <s> --kind <k> --rule <text>`). After each, `opened
   <signal or session id>`; stop opening signals when `budget.exhausted`.
   Unopened signals stay in the queue for the next pass and are named in the
   summary.
5. The subagent writes its findings to `runs/<uuid>/inbox/<name>.json`, one
   object or a list, and returns only the file name:
   `{id, kind: broken|intervention|guess|time-loss|simplify, scope:
   pack|product|host, stage, pointer, quote, mechanism, proposal, rule,
   latest, changed, screen, cost, sameAs}`. `stage` is a pack skill name;
   anything else is kept and published as `other`. `pointer` is `{session,
   event}` (event = record uuid or Codex item id; its time and the stage
   version are read from the file) or, without a session, `{source, line,
   ts}` (a ledger line or report of the map). `quote`: at most two lines,
   copied from that event or line. `mechanism` and `proposal`: own words in
   pack terms (rule, reference, step, script), at most 300 characters, no
   paths, no issue keys of other teams, no quotes. `rule`/`latest`/`changed`:
   `{file, text}` in the pack (`latest`: where the last release still allows
   it; `changed`: where the last release says otherwise). `cost`: `stops`,
   `interventions`, `extraRounds`, `minutes`, each `{value, mark:
   measured|estimate|unknown, source}`; `measured` needs `source.kind` ledger,
   receipt or wave-cost (`scripts/wave-cost.mjs <KEY>`). `sameAs`: the
   registry `F-` id or another proposal id when the mechanism is the same;
   features alone never make two findings one, and one rule can have several
   findings.
6. `check <file>`: drops and counts a finding whose quote is not in its event
   or line, whose rule place is missing in a tag of the range, or whose guess
   rule exists in one; versions «не подтверждена» use the tag of the path
   hint («по пути»), and without it `broken` with a rule and `guess` are
   dropped as `no-version`. `screen: true` gives `needs-owner`.
7. `register --linear <file>`: before it, read every registry finding named
   by `sameAs` that has an issue with Linear MCP `get_issue` (with relations
   for a Duplicate) and save the answers as a list to
   `runs/<uuid>/inbox/linear.json`, adding `duplicateOf` for a Duplicate and
   `mechanismRemoved: true` for a cancel whose comment says the mechanism was
   removed. Outcomes: open issue: comment and row; rejected: row with the
   earlier decision and link, no status change; Done without `fixed_in` in
   `CHANGELOG.md`: comment and row; every version at or after `fixed_in`:
   «вернулось», back to Triage; all before it: repeat, row only; crossing or
   unknown: «повтор, версия неоднозначна».
8. `select`: Triage only for a confirmed pack finding with a proposal that the
   last release still allows and that repeated in two sessions, cost an
   intervention or stopped work; returned findings too; at most five, by
   stops and interventions, then extra rounds and minutes. Only confirmed
   members count; members waiting for the owner or declined add nothing. The
   rest are «в очереди» and compete again next pass (a queued return is
   reopened then), after their places are read again in the last release.
   «Уже изменено» (even for a return), product and host findings, and
   findings waiting for the owner are rows of the report only.
9. `plan`: builds `runs/<uuid>/plan.json` from allowed fields only and refuses
   any text with a quote (8 words in a row from a digest, or a stored quote of
   any length), a path other than the pointer `runs/<uuid>/<F-id>`, an issue
   key of another team, an e-mail, a token or other credential, a long hex or
   base64 string, or a link other than a Linear issue, document or project
   page or the mono repository (no query or fragment); rewrite the named
   finding and run `check`, `register`, `select`, `plan` again. Run again
   after a crash or any change: operations that may have reached Linear stay,
   planned ones are refreshed or removed, a report already sent gets one
   update only if its content changed.
10. Apply the plan one operation at a time, never two at once:
    `op next` gives the key and the exact MCP call; `op sent <key>` before the
    call (it re-checks the text); send `call.args` verbatim; read the object
    back (`get_document`, `get_issue`, the comment), save the answer to the
    inbox and `op confirm <key> --response <file>`. An error, timeout or
    unclear answer: `op lost <key>`, then reconcile, never create again: save
    `list_documents` of the project or `list_issues` of the team created since
    the pass start, or all `list_comments` of the target issue, as full
    objects with their text (`content`, `description` or `body`), and run
    `op reconcile <key> --listing <file>`; text search is only a helper. Not
    found: wait a minute and reconcile again. After three misses the pass
    stops with the marker `session-audit op=<uuid>/<key>`: tell the owner;
    only after their words that the object is not in Linear run
    `op resume <key> --owner-said`.
11. `summary` gives the result before the commit. If it lists findings to
    confirm, show the summary with «От тебя» and ask; on the owner's answer
    in this session run `confirm <proposal id> --yes|--no`, `register`,
    `select`, `plan` (it appends operations and a report update) and apply
    the new operations. Nothing waiting: commit at once; the owner moves on
    without an answer: commit, the findings stay in the report as waiting.
12. `commit`: only when the plan was built from the current `register` and
    `select` and every operation is confirmed (a read-back must match the
    target, the marker, and the planned words and links); updates the registry
    and the queue (a fix counts as confirmed only by sessions opened in a
    pass), moves the boundary and the deferred tails, and ends the pass. Show `summary.text` to the owner in Russian product language.
