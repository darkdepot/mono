### Added
- Add a manual code-review circle with an independent finding checker, strict responses, coverage checks, secret scanning and separate read-only role permissions; keep the current delivery chain.
- Add pinned historical defect cases, recorded checker responses and reproducible per-run evaluation with dangerous-case calibration. Live host checks remain required before merge.

### Fixed
- Preserve Claude native login identity; isolate and probe Codex tools, record observed role boundaries/models, and refuse unreadable Claude worktrees before calls.
- Use short checker IDs and retain redacted, bounded failed answers. Load exact pinned contracts in dataset v2 and record disputed danger/partial consequence decisions without changing recall denominators.
- Read repository rules from pinned Git blobs and scan header-shaped hunk lines, preventing host-file prefill and failed-answer redaction bypasses.
- Retain rejected scope/risk flags until new checker evidence, require bound acceptance for reviewer/checker route changes, and keep old confirmed non-dangerous findings report-only at round three.
