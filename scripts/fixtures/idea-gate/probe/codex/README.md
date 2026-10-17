# Linear MCP live response fixtures

Captured at 2026-10-17 08:51:19 UTC. Project UUID: 59c079b6-fc26-40a6-ba19-9467674fa637 (P-MONO-270).

Only Linear read operations were called. Exact callable tool names:

- `mcp__codex_apps__linear_get_project` with `query` set to the project UUID; all optional arguments omitted.
- `mcp__codex_apps__linear_list_comments` with `projectId` set to the project UUID; all optional arguments omitted (documented default page size: 50).

Comment pages: 1. Page 1 contains 9 comments. The last page has `hasNextPage: false` and no next cursor; no additional request was needed.

## Preservation and redaction

Each response was an MCP result with a `content` array containing one `type: "text"` block, plus `isError: false`. The fixtures contain the exact text from that block, rather than a serialization of the MCP envelope. No pretty-printing, key reordering, whitespace normalization, or trailing newline was applied to response text.

Redaction uses targeted text-span replacement: user display-name string values (`name` within author/user/createdBy/lead and equivalent user objects, and `displayName`) become `"REDACTED"`; email addresses become `redacted@example.com`. Project, team, status, priority, and initiative names remain intact. Observed replacements: 1 project lead name and 9 comment author names; no email addresses found. All other response text remains unchanged.

## Observed JSON structure

- Project top-level keys, in returned order: `id`, `uuid`, `icon`, `color`, `name`, `summary`, `description`, `url`, `resourceCount`, `createdAt`, `updatedAt`, `startedAt`, `completedAt`, `canceledAt`, `startDate`, `startDateResolution`, `targetDate`, `targetDateResolution`, `priority`, `labels`, `initiatives`, `lead`, `leadTeam`, `status`, `teams`.
- Comments top-level keys: `comments`, `hasNextPage`. Pagination is a top-level boolean; no `cursor`, `nextCursor`, `endCursor`, or `pageInfo` field was returned.
- Comments are objects at `comments[]`. Their `id`, `body`, and `createdAt` fields live directly on each comment.
- Comment keys, in returned order: `id`, `body`, `attachments`, `createdAt`, `updatedAt`, `parentId`, `resolvedAt`, `quotedText`, `author`, `onBehalfOf`. Each author contains `id` and `name`; `onBehalfOf` is null in every returned comment.

`calls.json` records the exact tool names and arguments used. `MANIFEST.sha256` covers both response fixtures, the call log, and this README.

## Small-page run

Repeated `mcp__codex_apps__linear_list_comments` for project `59c079b6-fc26-40a6-ba19-9467674fa637` with `limit: 4`. The first request omitted `cursor`; each subsequent request passed the previous response's top-level `cursor` value as the tool's `cursor` argument, retaining `projectId` and `limit: 4`.

Captured 3 pages in `list_comments.limit4.page-N.json`, containing 4, 4, and 1 comments. Pages 1 and 2 returned top-level `hasNextPage: true` and `cursor`; page 3 returned `hasNextPage: false` and no cursor, ending pagination. All three calls are appended to `calls.json`.

Each file preserves the returned text block exactly except for the same targeted redaction: 9 author names became `"REDACTED"`; no email addresses were found. No JSON reserialization, whitespace normalization, or trailing newline was applied to response text. Only Linear read operations were called. The regenerated manifest includes all original and small-page response fixtures, the updated call log, and this README.
