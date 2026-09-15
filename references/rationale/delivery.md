# Delivery rationale

Package approval and implementation-start approval carry different consequences. Snapshot-based orchestration keeps one Linear writer while workers execute in isolated worktrees. State therefore lags queued writes until report consumption, and lifecycle-dependent gates need the explicit dispatch handshake.

Attempt-numbered acknowledgements bind gates to their writer; time ordering alone cannot separate overlapping attempts. The orchestrator's durable consumption journal handles crash recovery and duplicate delivery, while workers need only acknowledgement, pause and amended-state obligations.

A shared worker contract removes transport/registry/watcher instructions from stage reading. The read budget counts conditional and mandatory references together so changing a read's tier cannot reduce the measured corpus. Bytes divided by four is only an approximate token measure; actual reads and cost remain log-derived telemetry.

One-behavior implementation loops keep tests connected to observable behavior. Stable Issue contracts survive ordinary refactors better than procedural file/line instructions. Live verification covers consumer behavior that local checks and code review alone do not observe.

The ack is numbered by attempt for the same reason the logs are: an ack
belongs to the writer that produced it, and timestamps cannot tell
overlapping writers apart. A superseded attempt that is still alive can
write after its successor's log was born, and a shared path would let that
ack look current for the successor — the orchestrator would then apply the
moves and resume a worker on gates that worker never ran. A retry carries
the same gate names, so no set-equality check downstream would catch it
either. The attempt number is what binds an ack to its dispatch attempt.

Per-feature cost is a first-class operational metric, same as context
usage. Wave-1 precedent: a full production wave ran with zero cost
visibility — one Issue consumed 49M input tokens (97% cached), one PR
accumulated 59 review submissions, and none of it appeared in any report.
Model-tiering policy has no data without this telemetry.

Refuse collector and start-gate Git reads when .gitmodules or an indexed gitlink is present: executable-filter inspection covers only the superproject, so submodules are unsupported.
