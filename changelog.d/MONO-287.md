Added a read-only skills host probe for Claude text before approval windows,
with the recorded v0.38.1 defect, v0.41.0 control and sanitized response samples
for six window policies in Claude Code and Codex. The regression runs in verify;
host-only evidence gaps remain explicit and mandatory reading is unchanged.
Malformed event envelopes or fields consumed by the probe return unverified,
even when the remaining trace contains a passing window or a known defect.
Visible text is limited to the current turn and excludes whitespace and zero-width
characters; damaged child events invalidate the trace before being skipped.
