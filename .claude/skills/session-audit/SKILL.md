---
name: session-audit
description: Weekly audit of Mono sessions in the mono repository. Use when the owner says «разбери сессии». Builds the week map of real Mono sessions (product, kind, versions, links), the mandatory-layer sources, a digest of any session and the token cost of the pass. Project skill, not part of the pack.
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

Output is JSON on stdout; a refusal is JSON on stderr with a non-zero exit
(2: stop with a reason, 3: the pass belongs to another session).

## Data root

`SESSION_AUDIT_HOME`, else `<MONO_WORKFLOW_STATE_ROOT or ~/.mono-agent-workflow>/orchestrator/mono-agent-workflow/session-audit/`.
Every command stops when the root, after resolving symlinks, is inside a git
checkout, the mono repository or a pack install directory (`packInstallDirs`
of `config.json`, or any directory with a Mono plugin manifest), with the
real letter case of existing folders. Ids and file names that become paths
must be plain (`[A-Za-z0-9._-]`, no `..`); every write and delete goes through
plain directories of the root, never through a symlink. `collect` and
`extract` hold `<data root>/lock` (exclusive, with the holder's pid; a lock of
a dead process is taken) and write only while `state.json` still names their
pass and session.

- `config.json` here holds shared values only. `<data root>/config.json`
  overrides them key by key: `runPrefixes`, `standCodexHomes`,
  `excludedSessions`, `projectId`, `triageTeam`.
- `state.json`: `boundary` (end of the last finished pass), `deferredTails`
  and `pending` (`uuid`, `windowStart`, `windowEnd`, `startedAt`, `sessionId`,
  `deferredTails`, after a takeover also `takenOverAt`, `takenOverFrom`). The
  command that moves the boundary also moves `pending.deferredTails` to
  `state.deferredTails`: records that were still being written (`file`,
  `offset`) are read as new in the next pass whatever their own time.
- `queue.json`: unread signals; `collect` only counts them.
- `runs/<pass uuid>/`: `map.json`, `log`, `extract/<session>/chunk-NN.md`.

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
several on one line) are unpacked first; each read takes only an output that
fits it and no other read of the call, else it stays unconfirmed. Relative
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
(when asked, with options and `status`: unanswered until a reply), `answer`
(at the reply's own time), `load` with version, `op` (plan, helper and write
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

The analysis, signals, findings and records of the weekly pass are added by
the next task of the project.
