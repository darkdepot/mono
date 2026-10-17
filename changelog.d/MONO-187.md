### Added

- Idea recording and read-back CLI: `record` prepares the three-section Project body and approval comment; `verify` consumes raw Linear project/comment pages and checks the exact expected comment before reporting «Готово». Notes remain outside the fingerprint.
- Read-only plugin agents `linear-scout` and `code-scout`, plus a host-aware `scout` model role and `helper --host` CLI; `idea-helper` remains unchanged.
- Byte-preserved live Linear probes from Claude Code and Codex, manifest checks, and recording/verification regression scenarios.

### Changed

- Accepted PR #186 fixes: `record` refuses extra sections or preamble before writing; `verify` requires actual request cursors in separate `comments-N.request.json` files and checks the full cursor chain without altering raw responses. Regression cases cover an extra section and a skipped, renumbered middle page. MONO-188 must instruct the Idea agent to save each request cursor alongside its response.
- Project template uses second-level headings, with three body sections in Idea and scope sections added by Handoff. Explicit contract change: PC-001 routes existing Idea Projects to `mono:idea`; PC-005/PC-013 define the three-section body and preserve old scope in approval notes. Contract SHA-256: `7f3faa082fcd224b9e1eb4ddb8ee7726e9f0d01b69dc1796f515b2e73fad4a62`; both direct consumers remain checked.
- Workflow validation checks the scouts' known frontmatter fields and host efforts. Pin classification: no editorial sentence pins removed; commands, closed codes and agent field names are machine tokens, agent instructions stay in prose with field/body skeleton checks. Only the named, manifest-checked captured Linear files are excluded from executable model-policy scanning; their historical discussion is fixture data.
- Offset the scout documentation within model policy: delivery reading is 98,341 bytes, below the original 98,366-byte corpus and the unchanged 98,373-byte regression guard. No test limits or expectations changed.
- Include plugin agents in shared, model-policy and document-schema scratch copies so the same agent checks run against complete package fixtures.
