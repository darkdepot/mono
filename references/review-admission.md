# Review Admission

A collection is one read-only review round on the committed head (reviewer and
checker of different model families). The gate line is the result; findings are
in the receipt (`review.record.findings`).
Behavior changes: a live main-scenario run before round 1.

Rounds per attempt by pinned risk: `risky` up to three, task changes
included, plus at most one extra round the orchestrator grants after them;
others one, plus one per task change, same head too. Round 1
and the first after a task change read the whole change, later ones fixes and
open findings. Same head reuses its round; new base, fresh record.

- `review clean` or `clean-with-successors` with your verification: pass.
- `review not-converged (round 1|2 of 3)`: fix the error class of each open
  finding, check, commit, request the next round.
- Fast path after its round (`of 1`): fix; verify and request the final head
  as the line says (`hostVerification`: just request).
- `worker verification missing`: run it, request again.
- `needs-decision:` (round 3 not-converged, raised risk, round limit): park
  with that line. If the orchestrator resumes you with an extra round, fix and
  request the next round as usual: its line reads `round 4 of 4, extra` and
  judges like round 3; a `needs-decision … (extra round used)` line parks again.
- `not-reviewed:` (a role failed or coverage incomplete): no round spent;
  request this head again. `blocked:` (twice in a row): park blocked; the line
  says `(environment: …)` when the review failed on the host (timeout, sleep,
  network, login), which the orchestrator restores and retries without a task
  change, or `(review)` when it failed on the work, which needs a task change.

One defect the checker merged under one `mergeKey` counts as one open finding
at its heaviest weight; it closes when every merged report closes.
A fixed finding closes when the checker verifies the fix on a new head and
the reviewer stops reporting it. Fixed PR remarks (bot, CI, owner) go in
`prRemarks` as open findings; a P0/P1 one needs a fix.

Successor candidates pass, not block: an older defect the task did not
introduce (on `risky` only a harmless one); a P3 leftover from round 2 on, unless
about data, security or a gate bypass; on round 3 (and the extra round 4) any
leftover both roles call harmless. Out-of-contract or risk-raised fixes never pass. List them in
certificate/report. After merge the task's Linear writer files each
`must-file` one and decides the rest.
