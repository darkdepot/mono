# Recorded Claude PR publication probe

Host inputs supplied for MONO-322, 2026-11-04, Claude Code 2.1.316, installed
Mono 0.42.0. Temporary draft: https://github.com/darkdepot/mono/pull/244.
`provenance.json` records SHA-256 digests. Journals omit one leading empty line
to avoid watcher contamination warnings; source hashes and the exact transformation
are recorded. Other supplied files remain byte-identical.
No model or GitHub calls run when these fixtures are replayed.

`attempt-1` retains the real compound Bash write denial and Claude's explicit
«нет права публиковать ответы» stop. `result.is_error=false` means the CLI completed,
not that delivery succeeded. GitHub never received that denied write. The cause
within the compound command was not isolated; this is not a GitHub 403 fixture.
That historical no-right conclusion was premature: retry the same write as one
bare `gh api` per Bash call. Only denial of that bare call establishes
«нет права публиковать ответы». The synthetic bare-denial scenario in the test
is not an observed GitHub response.

`attempt-2` used one bare `gh api` command per Bash call with the same permission
policy, storing responses through Write. It created a line comment, posted a reply,
read its review back as `COMMENTED`, resolved the thread and posted
`@greptileai review` in the PR conversation. Launch files retain settings, arguments,
redacted environment, prepare result and successful startup check. Journals retain
the exact calls, errors, results and process/startup identities, including Claude's
foreground `system/task_started` / `system/task_notification` events.

GitHub response map for T2:

| File under `attempt-2/session-out/` | Meaning |
| --- | --- |
| `01-line-comment.json` | Published root review comment |
| `02-reply.json`, `03-reply-verify.json` | POST response and GET read-back; `in_reply_to_id` links the root |
| `04-review-state.json` | Reply's review id, `COMMENTED`, `submitted_at` |
| `05-threads-before.json` | Thread open, root and reply ids |
| `06-resolve.json`, `07-threads-after.json` | Resolve response and GET/query read-back |
| `08-bot-comment.json` | Conversation comment with bot mention |

`host-reread/` contains the host's independent thread/review reads, bot reaction
and PR cleanup (`state=closed`, `merged=false`, `merged_at=null`). The host created
and closed the temporary PR; all tested review/reply/resolve/comment actions in
the journals were Claude's own calls. A bot reaction proves receipt, not completed
review. No PENDING response or GitHub permission-error response was observed;
tests must label mutations of these shapes synthetic, never live evidence.

Omitted supplied files: token-user profile response, duplicate call summaries,
prompts/launcher and redundant host reads. The full read-only input directory was
`/private/var/folders/dw/fc6_vlfn7g3_hbw1fhbqxd9h0000gn/T/mono-322-probe-inputs`.
Current live agreement with GitHub remains an orchestrator check before merge.
