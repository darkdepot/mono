# Review Admission

A collection runs one read-only review round on the committed head (reviewer and
checker from different model families), then verification. The gate line is the
result; findings are in the signed receipt under `review.record.findings`.

At most three rounds per task attempt; an amendment keeps the count and record.
Round 1 reads the whole change, later ones (post-PR fixes too) only fixes
and open findings. Same head reuses its round; new base, fresh record.

- `review clean` or `clean-with-successors` with verification: pass.
- `review not-converged (round 1|2 of 3)`: fix the error class of each open
  finding with existing/literal tools, check, commit, request the next round.
- `needs-decision:` (not-converged after round 3, round limit, failed
  verification): park needs-decision with that line. The orchestrator splits
  or changes approach in a new attempt.
- `not-reviewed:` (a role failed or coverage was incomplete): no round spent;
  request the same head once more. `blocked:` (twice in a row): park blocked.

A fixed finding closes when the checker verifies the fix on the new head and
the reviewer no longer reports it, dangerous or not. PR remarks you fixed (bot,
CI, owner) go in `prRemarks` as open findings; a P0/P1 one needs a fix.

Successor candidates pass instead of blocking: an older defect the task did not
introduce (any round); a minor P3 leftover from round 2 on, unless it is about
data, security or a gate bypass; on round 3 also any leftover both roles call
harmless. Out-of-contract or risk-raised fixes never pass. List candidates in
the certificate and report. After merge the task's Linear writer files every
`must-file` one (an older dangerous defect, minor ones only for data, security
or gate bypass) and decides on the rest. Never weaken tests to converge.
