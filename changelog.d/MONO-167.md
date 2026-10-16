### Fixed

- Reject invalid issue keys before exported review-ledger reads, class-stop writes,
  and CLI decision-record reads. Keep `^[A-Z][A-Z0-9]*-[1-9][0-9]*$` unchanged;
  additionally quote the two interpolated regular-expression prefixes.
- Pass the collector timeout fixture's lock path as a Node process argument.
- Scan original line segments when removing comments from issue context, so a
  closed comment cannot synthesize an opener that hides a following marker.
  Cover both an ordinary line and the suffix after a multiline comment closes.

### CodeQL triage (MONO-167)

Numbers refer to `darkdepot/mono` GitHub code-scanning alerts, inspected on
2026-10-16. No alert is dismissed by this PR; the orchestrator owns closeout.
The CI permissions alert belongs to the separate CI issue.

| GitHub alert | Rule | Location | Disposition and evidence |
| --- | --- | --- | --- |
| #2 | `js/incomplete-multi-character-sanitization` | `resolve-issue-context.mjs`, comment-closing line suffix in `contentTokens` | **исправлено**. Input: `<!-- prior line` followed by `--><!<!-- x -->--` and a valid marker. Consumer: marker/section scans over visible tokens. Expected: the original comment closes; the next marker remains recognized. The scanner examines original segments once; the regression compares the complete context with the valid-marker result. |
| #3 | `js/incomplete-multi-character-sanitization` | `resolve-issue-context.mjs`, ordinary line in `contentTokens` | **исправлено**. Input: `<!<!-- x -->--` before a valid marker. Consumer: marker/section scans. Expected: removing the closed inner comment must not create comment state and hide the next marker. The regression compares route, approval and complete acceptance/verification oracle; baseline comparison also checks exit codes and fingerprints. |
| #4 | `js/incomplete-multi-character-sanitization` | `resolve-issue-context.mjs`, `isSubstantiveText` | **неприменимо**. Input: criterion, verification-step or section text, including fenced examples and comment-only placeholders. The sole result is a Boolean letter/digit test; consumers decide whether content is substantive. No stripped string reaches an HTML renderer or another comment parser. Expected: `<!-- TODO -->` and `<!<!-- x -->--` alone are not substantive; visible letters/digits count. Residual delimiter punctuation has no letters/digits and cannot execute or hide later lines. Existing empty/comment-only criterion and section fixtures exercise this contract; full resolver baseline comparison preserves their results. |
| #5 | `js/incomplete-multi-character-sanitization` | `validate-workflow.mjs`, `markdownHeadings` | **неприменимо**. Input: tracked Markdown from README and linked documentation. Consumer: `forEachMarkdownLine`, then anchored heading extraction, title/slug checks and link addressability. Expected: closed comments contribute no headings; visible headings retain their titles/slugs. This is structure validation, not HTML sanitization. `<!<!-- x -->--` leaves punctuation that matches no heading; the consumer neither reparses comments nor renders HTML. The heading-comment fixture and unchanged README checks verify the boundary. |
| #6 | `js/incomplete-multi-character-sanitization` | `validate-workflow.mjs`, README Owner Rules extraction | **неприменимо**. Input: tracked README Markdown. Consumer: `documentSection`, then anchored rule-ID/link/target validation. Expected: closed commented-out rules contribute no entries; visible Owner Rules remain checkable. Residual delimiters cannot become an anchored heading or rule. No HTML rendering or second comment scan occurs. The owner-rule-comment fixture feeds a residual opener to the actual section consumer and verifies that a following visible rule remains visible; README is unchanged. |
| #7 | `js/bad-code-sanitization` | `orchestrator-commands.test.mjs`, collector startup timeout | **исправлено**. Input: temporary lock-file path. Consumer: detached `node -e` fixture. The program is constant; the path is a separate argv value read through `process.argv[1]`. Startup timeout still terminates the child before it can create a late lock. |
| #8 | `js/regex-injection` | `decisions.mjs`, dataset version filename matching | **исправлено**. Inputs: CLI and exported journal/dataset APIs. `journalFile` already checks the unchanged key pattern before filesystem access on every path to version matching. Added early CLI validation before reading a decision record and literal regex quoting. Invalid-key scenarios trap filesystem access for all exported journal/dataset entry points and check every CLI command. Existing valid dataset reuse/versioning expectations are unchanged. |
| #9 | `js/regex-injection` | `review-ledger.mjs`, `belongs` | **исправлено**. Inputs: CLI plus exported `readLedgerSources`. Added key validation before its first evidence access, and before exported class-stop access; added literal regex quoting in `belongs`. CLI, `buildReviewLedger`, adjudication and withholding already validate keys. Scenarios trap evidence access for invalid keys and preserve valid receipt filename matching. |

No CommonMark compatibility or HTML sanitization guarantee is introduced. Existing
marker examples are compared against the original resolver for complete stdout,
stderr and exit code, including route, marker recognition, fingerprints and oracle.
Only the two documented synthetic-opener inputs may differ. Existing expectations
and contract fingerprints are unchanged; no machine-token pin was removed.
