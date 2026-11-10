# Review Admission

A collection runs one read-only review round on the committed head (reviewer and
checker from different model families), then verification. The gate line is the
result; findings are in the signed receipt under `review.record.findings`.

At most three completed rounds per pins file; an accepted amendment (new
`pins.v<n>.json`) opens a fresh three. The same head reuses its round. A changed
base or contract starts a fresh record; the count stays.

- `review clean` or `clean-with-successors` with verification: pass.
- `review not-converged (round 1|2 of 3)`: fix the error class of each open
  finding with existing/literal tools, check, commit, request the next round.
- `needs-decision:` (not-converged after round 3, round limit, failed
  verification): park needs-decision with that line. The orchestrator narrows
  the contract, splits or changes approach.
- `not-reviewed:` (a role failed or coverage was incomplete): no round spent;
  request the same head once more. `blocked:` (twice in a row): park blocked.

Successors: on round 3 leftovers that are not dangerous, unresolved, out of
contract or risk-raised pass as candidates. List them in the certificate and
report; the orchestrator files Issues after merge. Never weaken tests to converge.
