## MONO-181 — Quiet monitoring during commands and no-change wakeups

- Defer ordinary stall alerts for a live writer with outstanding Codex command executions or Claude Bash calls, tracking parallel commands independently. The fixed 60-minute allowance starts on watcher observation, resets on watcher restart, and emits one marked stall at expiry. Dead writers and protocol deadlines keep their existing behavior.
- Require continuous watcher-output monitoring throughout the wave; periodic wakeups are a recorded degradation. False alarms, already-consumed reports and empty wakeups produce no owner message or routine ledger entry; actual monitoring recovery and healing remain recorded.
- Continue bounded log catch-up without waiting for regular interval ticks, so quiet history does not delay ordinary stall alerts by one interval per chunk. Retain only a bounded prefix and file position for unfinished records; completed records still use native JSON parsing to match command IDs after large output.

### Known limitations

- The 60-minute ceiling is a best-effort diagnostic, not a precise execution deadline. Observation, bounded log scans and watcher restarts can affect its timing; no command timestamp is recovered from the journal. A hung command that keeps writing heartbeat/progress events still has a fresh log and remains outside this change.
- When one command ends and another starts between watcher scans, the later command can inherit the earlier observation time or already-alerted state. Its ceiling alert may therefore be early or absent until observation resets. This is accepted as part of the best-effort timing diagnostic; ordinary no-command stalls, dead-writer checks and protocol deadlines remain required.
