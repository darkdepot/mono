# Host round 2: reviewer misses and strengthening

Review head: `e06d7a319b400d849cea5408ec5c4e92382a27fe`.
Run: `cand-20261103`, three independent risky repeats for each task. Each first
round used the all-defects pass plus an ordinary pass, then one checker batch.
The eight eligible cases below have zero strict matches in all three repeats;
#19 has partial matches in all three; #69 has partial matches in repeats 1 and 3.
A partial match or the union is not a strict hit for an individual run.

Evidence names are relative to the host round-2 evidence package:
`candidate-evaluation.json`, `judge/adjudications-MONO-81.json`,
`judge/adjudications-MONO-95.json`, `judge/adjudications-MONO-146.json`, and
`score-candidate.json`. Finding key prefixes below identify retained records;
run IDs are `cand-20261103:<task>:<repeat>`. The judge's concrete location and
mechanism rule controls matching. Cause analysis is an inference from outputs
and the pass instructions, not a claim about the model's private reasoning.
These are proposed strengthenings, not already measured improvements. Do not
feed this gold-specific list into historical task contracts or scored prompts.

### #17 MONO-81 — rejected route remains in anonymization

Observed: the reviewer found whole-finding identity substitution (#18,
`d41c8d6873`, repeat 1) and malformed credential declarations (partial #19,
`2ca2b8bc4d`). It did not report a provider-less rejected route crashing
blindFinding after a different valid route's paid result returns.

Cause analysis (inference): attention reached validation and redaction, but did
not connect admission exclusions to the later traversal of every declared route.
Repeating a broad review did not force the mixed valid/invalid configuration path.

Strengthening: ask for one end-to-end negative-input trace across validation,
filtering and result persistence, including a valid item beside a rejected item;
check that excluded configuration cannot affect successful work downstream.

Evidence: MONO-81 judge entries for those keys distinguish #18 and partial #19;
gold #17 anchors `r.provider.id` in review-bench.mjs, not substring replacement.

### #19 MONO-81 — missing route id does not match persisted admission

Observed: all three repeats found malformed credentialEnv/null-route failures,
including `2ca2b8bc4d`, `8a4c080d2b` and `2cf0e210d5`. The judge marks them partial: the gold input
is a route without id, whose persisted routeId becomes `invalid` while lookup
uses undefined at review-bench.mjs:256.

Cause analysis (inference): finding one malformed-input class did not establish
that every required field's refusal survives serialization and lookup. The
ordinary pass repeated the credential-shape mechanism rather than missing-id flow.

Strengthening: partition invalid declarations by each required field, then trace
error identifiers through persistence and their consumer lookup; demand the
exact missing-field trigger before merging findings into one class.

Evidence: MONO-81 partial-to-19 judge notes cite credentialValues :32,
routeCheck :154 and the distinct admissions lookup :256. Partial remains partial.

### #20 MONO-81 — numeric environment fixture is vacuous

Observed: the reviewer reported that bench tests were absent from standard
verify (`2e82376b45`, repeat 1; `e6d2371c28`, repeat 3), and a missing
GIT_NO_LAZY_FETCH environment guard. It did not identify the TOKENS assertion
that checks a literal independently of the child environment.

Cause analysis (inference): checking test registration and production isolation
left the fixture's asserted value-to-observation link unexamined. File coverage
alone does not require showing that a guarded behavior can make a test fail.

Strengthening: for each readiness/isolation assertion, trace its observed child
value and state a mutation that would turn the assertion red. Separate numeric
ambient settings from credential-shaped values; do not execute project tests
inside the read-only role.

Evidence: MONO-81 judge classifies test registration as novel, explicitly distinct
from #20/#24's ineffective assertions inside review-bench.test.mjs.

### #21 MONO-81 — hardcoded helper prompt budget metadata

Observed: helper digest incompatibility was found in every repeat (for example
`7cff74f5e1`); no finding matched `maxPromptBytes:512000` in the manifest.

Cause analysis (inference): following the hash mismatch did not audit each field
claimed as derived metadata back to its actual producer. The pinned gold itself
has only a partial consequence: no differing helper budget or field consumer is
established. This is not evidence of a demonstrated dangerous execution failure.

Strengthening: audit generated provenance fields against their named source;
label constants versus derived values explicitly, and require an actual consumer
or contract obligation before claiming impact. Preserve the partial gold label.

Evidence: MONO-81 judge's strict d-006 entries concern helper byte hashing, not
budget provenance; cases.json's #21 reclassification cites review-bench.mjs:89
and the digest-bound helper at :79-80, :86, :190-191.

### #24 MONO-81 — no child allowlist proof

Observed: the reviewer found offline Git environment omissions and test
registration, not a fixture forwarding an unrelated process.env sentinel to the
helper and inspecting what the child receives.

Cause analysis (inference): proving that tests run was treated separately from
whether the required allowlist boundary has an observable negative control.
The two broad passes supplied no explicit check of absent test obligations.

Strengthening: map each mandatory readiness proof to a child observation and
negative control. For an environment allowlist, inspect coverage of unrelated
sentinels as well as named credentials and numeric settings; distinguish missing
proof from a proven production leak.

Evidence: MONO-81 judge notes for `2e82376b45`/`e6d2371c28` explicitly reject
matching the registration finding to #24: different location and mechanism.

### #42 MONO-95 — nested definition absorbs an outdented sibling

Observed: all repeats found Markdown fence-length bugs (`e719edd231`,
`0db41de022`, `0bf53c60c1`); repeat 2 also found punctuation-truncated coverage
IDs (`48c4388db3`). No output matched definitions()' indent end boundary.

Cause analysis (inference): the reviewer explored parser edge cases, but neither
broad pass required a transition matrix for list depth. Adjacent parsing bugs
repeated while nested-to-parent boundaries were left untested by reasoning.

Strengthening: inspect state transitions in each parser loop: sibling, parent,
child, end of section and fenced content; include nested definition followed by
an outdented list sibling. Keep this generic in prompts, not a gold hint in the
pinned task contract.

Evidence: MONO-95 judge labels fence and punctuation findings novel, distinguishing
snapshot.mjs:20-21/:55 from gold definitions() indent handling at :48-49.

### #156 MONO-95 — stale artifacts after a refused dispatch

Observed: repeated findings concern literal double-brace content rejected by
rendering (`c0163562e3`, `ff3b1c7fa1`, `fbbace673a`) and structured seam
rendering. None trace a refused full attempt reused as short with old files left
in dispatch/KEY-aN/snapshot.

Cause analysis (inference): single-invocation rendering paths drew attention;
the review did not model two commands reusing an unregistered attempt directory.
Ordinary repetition adds no explicit persistent-artifact inventory.

Strengthening: for failure/retry paths, compare the created artifacts before the
refusal and after a changed retry, including files no longer selected. Trace an
actual reader before claiming worker contamination or a gate bypass. #156 stays
eligible for the artifact defect, with disputed danger excluded from the veto.

Evidence: MONO-95 judge calls double-brace rejection novel, not #156; the gold
reclassification cites dispatch.mjs:93-107 and the absence of a pinned snapshot
consumer. Do not turn the disputed stronger consequence into a measured fact.

### #69 MONO-146 — quoted sibling path falsely matches the worktree

Observed: repeats 1 and 3 found attached-option paths such as
`make -C/absolute/worktree watch` not being recognized (`dcd89b0fec`,
`f0b0963204`). The judge assigns partial #69 with the opposite mechanism:
false MISS permits a survivor, while gold #69 falsely MATCHES a quoted longer
sibling `/tmp/worktree copy/check.mjs` and stops an ordinary switch.

Cause analysis (inference): a real delimiter bug was found on one side of the
predicate. The ordinary pass did not require the complementary false-positive
boundary, so a shared function/location was mistaken for broader mechanism coverage.

Strengthening: require both matching and nonmatching adversarial inputs for
ownership/reference predicates: exact path, attached option, quoted longer
sibling, punctuation and spaces. Keep opposite directions as separate findings
and fixes until evidence proves both.

Evidence: MONO-146 partial-to-69 judge notes cite exactAttemptReference :34 and
backup-switch.mjs:86-93, explicitly distinguishing gate-bypass from gate-stall.

## Release and measurement boundary

Gold v3 excludes #68 on the documented separate-command inputs, after independent
GPT-family adjudication item 5. Eligible totals are 10/14; nominal slots remain
12/16. Preserve historical v2 scores and their input digest; any v3 score must use
the v3 digest and clearly identify reclassification, not silently rewrite a run.
#41 remains excluded; #17 remains confirmed; #21's consequence remains partial;
#156/#80 remain danger disputed. The four dangerous checker removals (#23, #18
twice, #40) block release until live recalibration passes. Recorded controls only
prove parser/report and calibration accounting. This document proposes reviewer
strengthenings; it does not claim a recall gain or authorize release.
