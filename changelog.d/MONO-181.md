## MONO-181 — Quiet monitoring during commands and no-change wakeups

- Defer ordinary stall alerts for a live writer with outstanding Codex command executions or Claude Bash calls, tracking parallel commands independently. The fixed 60-minute allowance starts on watcher observation, resets on watcher restart, and emits one marked stall at expiry. Dead writers and protocol deadlines keep their existing behavior.
- Require continuous watcher-output monitoring throughout the wave; periodic wakeups are a recorded degradation. False alarms, already-consumed reports and empty wakeups produce no owner message or routine ledger entry; actual monitoring recovery and healing remain recorded.
