# Review Admission

A collection runs one read-only review round on the committed head (reviewer and
checker of two model families), then verification. The gate line is the
result; findings are in the signed receipt under `review.record.findings`.
A behavior change gets a live run of its main scenario before round 1.

Pinned risk sets rounds per task attempt: `risky` up to three, others one;
amendments keep the count and record. Round 1 reads the whole change, later ones
fixes and open findings. Same head reuses its round; new base, fresh record.

- `review clean` or `clean-with-successors` with verification: pass.
- `review not-converged (round 1|2 of 3)`: fix the error class of each open
  finding, check, commit, request the next round.
- Fast path after its round (`of 1`): fix, run the full verification on the
  final head, request it with `workerVerification: {head, exitCode: 0}`.
- `needs-decision:` (round 3 not-converged, raised risk, failed verification):
  park needs-decision with that line.
- `not-reviewed:` (a role failed or coverage was incomplete): no round spent;
  request the same head again. `blocked:` (twice in a row): park blocked.

A fixed finding closes when the checker verifies the fix on the new head and
the reviewer no longer reports it. Fixed PR remarks (bot, CI, owner) go in
`prRemarks` as open findings; a P0/P1 one needs a fix.

Successor candidates pass instead of blocking: an older defect the task did not
introduce (on `risky` only a harmless one); a P3 leftover from round 2 on, unless
about data, security or a gate bypass; on round 3 any leftover both roles call
harmless. Out-of-contract or risk-raised fixes never pass. List them in the
certificate and report. After merge the task's Linear writer files every
`must-file` one and decides on the rest.
