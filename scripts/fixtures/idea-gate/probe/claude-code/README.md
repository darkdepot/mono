# Linear connector live probe: Claude Code

- Captured: 2026-10-17T08:50:48Z (UTC), read-only; nothing was created, updated or deleted in Linear.
- Host: Claude Code, Linear MCP connector `mcp__841cf23e-389a-499b-bafe-205d2a057b45`.
- Tools: `get_project`, `list_comments`. Exact arguments are in `calls.json` (defaults only: no include flags, no limit, no orderBy, no cursor).
- Target: project P-MONO-270, uuid `59c079b6-fc26-40a6-ba19-9467674fa637`, «Этап Idea».

## Files

- `get_project.json`: tool text output of `get_project`, byte-for-byte except redaction.
- `list_comments.page-1.json`: tool text output of `list_comments`, first and only page, byte-for-byte except redaction.
- `list_comments.limit4.page-1.json` … `page-3.json`: small-page run (`limit: 4`), see «Small-page run».
- `calls.json`: array of `{file, tool, arguments}`.
- `MANIFEST.sha256`: SHA-256 of all files above.

Each tool returned a single MCP content block of `type: "text"`; the saved file is exactly that text (compact JSON, no trailing newline). It was not pretty-printed or re-serialized.

## Pagination (default run)

- Pages: 1.
- Page 1 response: top-level keys `comments`, `hasNextPage`; `hasNextPage` is `false`.
- No cursor key is present at all on the last page (no `cursor`, `endCursor` or `pageInfo`). The tool schema says to pass "the previous response's cursor when hasNextPage is true", so a `cursor` field is expected only when there is a next page; in the default run all 9 comments fit into the default limit of 50; the cursor was observed live in the small-page run below.
- Default order is `updatedAt`, newest first.

## Observed structure

`get_project` top-level keys, in order:
`id` (identifier `P-MONO-270`), `uuid`, `icon`, `color`, `name`, `summary`, `description` (Markdown project body), `url`, `resourceCount`, `createdAt`, `updatedAt`, `startedAt`, `completedAt`, `canceledAt`, `startDate`, `startDateResolution`, `targetDate`, `targetDateResolution`, `priority` {`value`, `name`}, `labels`, `initiatives` [{`id`, `name`}], `lead` {`id`, `name`}, `leadTeam` {`id`, `name`, `key`}, `status` {`id`, `name`, `type`}, `teams` [{`id`, `name`, `key`}].
Note: `id` is the human identifier, the UUID is in `uuid`.

`list_comments`: `comments[]`, each with keys in order:
`id` (comment UUID), `body` (Markdown, including fenced blocks such as `mono-idea-snapshot`), `attachments` (array), `createdAt`, `updatedAt` (ISO-8601 UTC with milliseconds), `parentId` (null for top-level), `resolvedAt`, `quotedText` (null for non-inline comments), `author` {`id`, `name`}, `onBehalfOf` (null here).
So comment body is `comments[i].body`, creation time `comments[i].createdAt`, id `comments[i].id`.

## Small-page run

Captured 2026-10-17T08:52–08:53Z (UTC), same project, `list_comments` with `limit: 4`, following the cursor until `hasNextPage` was `false`. Files: `list_comments.limit4.page-1.json` … `page-3.json`; exact arguments in `calls.json`.

- Pages: 3 (4 + 4 + 1 comments).
- Cursor field name: `cursor`.
- Location: top level of the response object, after `comments` and `hasNextPage` (key order `comments`, `hasNextPage`, `cursor`).
- Value: the `id` of the last comment on that page (page 1: `f5de731e-66ca-4384-ae67-f34eb6b701f2`, page 2: `c89729ef-654a-4da8-9248-aa971219955f`). It is a plain comment UUID, not an opaque token.
- Passed back: as the `cursor` tool argument, unchanged, together with the same `projectId` and `limit`.
- Last page: `hasNextPage: false` and the `cursor` key is absent (not `null`). Page-complete rule for consumers: stop when `hasNextPage` is `false`; do not expect a null cursor.
- Cross-check: the 9 comments of pages 1–3, in order, are identical objects to the 9 comments of the default single-page run (`list_comments.page-1.json`). Order is `updatedAt` descending (comment `6ccb31fe…` was edited at 07:37:18Z and sits between comments updated at 07:57Z and 07:26Z).

The exact text of each small-page response was taken from the tool result as recorded in this session's transcript (one `type: "text"` block per call), not retyped.

## Redaction

Applied by a small Python script on the raw text with targeted regexes (the original was confirmed to parse as JSON before and after, but was never re-serialized, so key order, escapes and whitespace are unchanged):

- `"name"` inside person objects (`author`, `user`, `createdBy`, `lead`, `creator`, `onBehalfOf`, `assignee`, `actor`, matched as `"<key>":{"id":"…","name":"…"}`) replaced with `REDACTED`. Hits: 1 in `get_project.json` (`lead.name`), 9 in `list_comments.page-1.json` (`author.name`), 4 + 4 + 1 in `list_comments.limit4.page-1..3.json` (`author.name`).
- `"displayName"` values replaced with `REDACTED`: 0 hits.
- Email addresses replaced with `redacted@example.com`: 0 hits.
- Team, status and initiative names were left as is. Comment bodies contained no person names.

## Anomalies

- Comment `654f94f1-faf0-4176-8ceb-d3528a0ba66a` has `updatedAt` (08:24:29.607Z) 42 ms earlier than its `createdAt` (08:24:29.649Z). Consumers must not assume `updatedAt >= createdAt`.
