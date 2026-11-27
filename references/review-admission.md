# Review Admission

A collection is one read-only review round on the committed head (reviewer, and
for P0/P1 of a `risky` task a checker of another model family). The gate line is the result; findings are
in the receipt (`review.record.findings`).
Behavior changes: a live main-scenario run before round 1.

Rounds per attempt by pinned risk, at most two: `risky` two, task changes
included; others one, plus one per task change, same head too. Round 1 reads
the whole change; later ones, a task change's and a new attempt's first too,
read fixes and open findings. Same head reuses its round.

- `review clean` or `clean-with-successors` with your verification: pass.
- `review not-converged (round 1 of 2)`: fix the error class of each open
  finding, check, commit, request the next round.
- Fast path after its round (`of 1`): fix; verify and request the final head
  as the line says (`hostVerification`: just request).
- `worker verification missing`: run it, request again.
- `needs-decision:` (round 2 not-converged, raised risk, round limit): park
  with that line; there is no further round.
- `not-reviewed:` (a role failed or coverage incomplete): no round spent;
  request this head again. `blocked:` (twice in a row): park blocked; the line
  says `(environment: …)` when the review failed on the host (timeout, sleep,
  network, login, model capacity or rate limit), which the orchestrator restores and retries without a task
  change, or `(review: …)` when it failed on the work (a malformed or incomplete
  answer, incomplete coverage, a single model family, unreadable or binary
  files, a CLI that could not start; login only when a login failed), which
  needs a task change.

One defect the checker merged under one `mergeKey` counts as one open finding
at its heaviest weight; it closes when every merged report closes.
A fixed finding closes when the reviewer stops reporting it on a new head
(a checked one also needs the checker's verified fix). Fixed PR remarks (bot, CI, owner) go in
`prRemarks` as open findings; a P0/P1 one needs a fix.

Successor candidates pass, not block: an older defect the task did not
introduce (on `risky` only a harmless one); a P3 leftover from round 2 on, unless
about data, security or a gate bypass; an unchecked P2/P3; on round 2 any
leftover marked harmless. Out-of-contract or risk-raised fixes never pass. List them in
certificate/report. After merge the task's Linear writer files each
`must-file` one and decides the rest.
