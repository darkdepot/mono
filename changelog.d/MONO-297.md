### Added
- Add a manual code-review circle with an independent finding checker, strict responses, coverage checks, secret scanning and separate read-only role permissions; keep the current delivery chain.
- Add pinned historical defect cases, recorded checker responses and reproducible per-run evaluation with dangerous-case calibration. Live host checks remain required before merge.

### Fixed
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
