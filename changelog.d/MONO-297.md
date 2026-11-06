### Added
- Add a manual code-review circle with an independent finding checker, strict responses, coverage checks, secret scanning and separate read-only role permissions; keep the current delivery chain.
- Add pinned historical defect cases, recorded checker responses and reproducible per-run evaluation with dangerous-case calibration. Live host checks remain required before merge.

### Fixed
- Capture and screen stdout and stderr from every circle-owned child process before parsing, retaining or forwarding them; withhold both on a hit, including successful Git warnings, catalog/auth helpers and role failures.
- Screen all successful and failed model output through one bounded JSON-decoding/redaction boundary before retention, reports, forwarding or evaluation; refuse secret-bearing replies and preserve safe fixture handling.
- Decode all embedded failed-answer JSON strings to a fixed point before redaction; withhold undecodable or over-budget content on both attempts.
- Share host Git isolation between circle and evaluation: disable content filters and drivers on every call, screen pinned blobs independently of attributes, and refuse opaque blobs, gitlinks and index hints before worktree inspection.
- Normalize color on every host Git read, including raw diffs and exact contract blobs, so repository color settings cannot bypass patch secret scanning.
- Detect multiline assignments on both patch sides, decode failed JSON/JSONL answers before redaction, and refuse ignored dirty submodules or changed gitlinks before model calls.
- Preserve Claude native login identity; isolate and probe Codex tools, record observed role boundaries/models, and refuse unreadable Claude worktrees before calls.
- Use short checker IDs and retain redacted, bounded failed answers. Load exact pinned contracts in dataset v2 and record disputed danger/partial consequence decisions without changing recall denominators.
- Read repository rules from pinned Git blobs and scan header-shaped hunk lines, preventing host-file prefill and failed-answer redaction bypasses.
- Retain rejected scope/risk flags until new checker evidence, require bound acceptance for reviewer/checker route changes, and keep old confirmed non-dangerous findings report-only at round three.
- Screen every outgoing context source and redact failed answers, retain confirmed scope/risk flags, stop evaluation after its scored interrupted attempt, and isolate recorded fixtures from the native Codex catalog.
- Disable host Git diff/textconv helpers on every review/evaluation read, redact mixed multiline secrets before retaining failed answers, and require coverage of gitlink updates despite submodule ignore settings.
- Strengthen checker R7 exclusions after four live danger removals, retain served-model fallback/usage identities, reclassify unreachable #68 in gold v3 (10/14 eligible, 12/16 nominal), and document all eight reviewer misses with proposed strengthenings. Host recalibration remains release-blocking.
- Apply the shared Git helper policy inside role environments and neutralize repository discovery; screen encoded input JSON layers through the same bounded decoder as output before any affected role starts.
- Apply dataset v2 payload screening through one credential-family table and secret-like key rule, including AWS STS; preserve quoted key/value boundaries during bounded JSON decoding and withhold unresolved layers. Document tool-read, post-screen edit and evaluation-reconstruction exclusions; unknown families remain MONO-329.
- Apply the same family table to whole multiline payloads and reconstructed patch sides before input forwarding or output retention.
- Derive unquoted assignment matching and parsed-key classification from the same normalized secret-key suffixes, covering arbitrary separators without losing key prefixes.
- Keep overlapping credential candidates visible after an invalid JWT-shaped prefix, so dotted context cannot consume a supported JWT before validation.

Исправления PR: линейный поиск JWT с ограничением объёма строки и работы декодера; итоги набора 10/14; статические CLI-фикстуры читают JSON без вставки данных в исходный код.
Незавершённые JSON-литералы также не запускают повторный поиск с экранированных кавычек.
Локальный P1: поддерживаемый токен в имени файла больше не скрывается за подчёркиванием или текстовым префиксом; правило исправлено для всех семейств и JWT.

- Resolve MONO-326: one bounded decoder accepts successful JSON decoding and source backslashes; catalog resolution stays transient and outgoing content is screened.
- Apply approved whole-token family boundaries and credential-shaped assignment values without path/string exemptions; replay the real native catalog, MONO-302 diff, tiny request and all nine r3 checker answers.
- Keep credentials following unquoted URLs or in-word comment markers visible to screening.
- Apply dataset v4 structural screening: preserve raw duplicate members before JSON parsing, lex actual key/value bindings without a length floor, scan nested JSON in quoted source, and accept non-JSON brace/bracket prose. Keep fixed placeholders and property reads benign.
- Apply continue:21: retain complete env/flag values containing `=`, recognize comments before binding operators, skip bare type-only members, and redact rule-2 values in diff/blob payloads without stopping a benign round. Keep family and fail-closed JSON refusals.
- Apply continue:22: pair typed declaration/field initializers with their keys and preserve adjacent source when replacing escape-aware quoted values.

- Bound source-text payload screening to dataset v5 forms; other lexical forms remain MONO-329.

- Apply continue:23: give both roles a read-only pinned export without repository Git configuration; preserve JSON numeric text and redact runtime boolean/null bindings while leaving type-only members alone.

- Apply continue:24: redact the complete matched nested literal before considering the env/flag whitespace fallback, including plain assignments after separators.

- Apply continue:26: reserve whitespace-delimited spans for shell env lines and flags; preserve adjacent statements when screening numeric source assignments and class fields.

- Apply continue:28 / dataset v6: replace lexical source-binding spans with stateless whole-line/bracket-block screening, map decoded hits to original lines without rewriting escapes, and remove dead lexical-binding code. This supersedes v4–continue:26 source-span rules; JSON pairing/fail-closed checks, credential families and real-byte launch/parser regressions remain.

- Apply continue:29 / dataset v7: construct outgoing diffs from screened base/head blobs, list unscreenable files as unreviewed, ignore quoted block delimiters and withhold the remainder on unclear quotes, and redact credential-family substrings in paths without identifier boundaries.

- Apply continue:30 / dataset v8: remove source block-boundary counting; a matched opener conservatively withholds the full file remainder, preserving diff prefixes across hunks and listing partially withheld files in prompts, round records and reports.

- Apply continue:31: treat unclear gold danger as dangerous in checker calibration; count its removal, block release and leave unsafe calibration incomplete.

- Apply continue:32: reject dangling clean-control symlinks and create exclusively; normalize diff headers only before hunks; preserve the raw MONO-302 fixture with a path-specific whitespace attribute.

- Apply continue:33 after failed host QA: use strict JWT path recognition and distinct aliases; validate pinned anchors on raw local blobs; retain danger across reviewer/checker flags and require a screened-head code quote for dangerous rejections. Retry contradictory merge verdicts once, then preserve separate keys. Add real MONO-302 path and MONO-81 source regressions; old ae2bed26 Ship certificate is revoked.

- Apply continue:34: check every possible JWT header suffix in both path and source screens, accepting noncanonical JSON whitespace and empty signatures; keep the real MONO-302 inventory unchanged and aliases distinct.
- Close dangerous findings with Git-verified deletion evidence and keep screened path aliases stable across rounds and literal-name collisions.
- Limit secret-key placeholder exemptions to complete lowercase angle-bracket words of at most 33 characters, shared by JSON and source-line screening.
