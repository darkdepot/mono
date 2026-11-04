# Code review evaluation

`cases.json` version 3 pins three task heads, bases, dataset versions and exact
contract source blobs. The runner reads each pinned blob verbatim; authored
summaries never enter model context or the contract digest. The repository is supplied by the host through
an absolute `bundle` setting, never through a hardcoded local path. The bundle
must include tags `dataset/MONO-81-head`, `dataset/MONO-95-head` and
`dataset/MONO-146-head`, with reachable bases. MONO-75 is unavailable and excluded.
`code-review-eval.mjs` verifies each commit, source blob and case code anchor
without contacting models. Clean controls add one inert document to each pinned base. Their commit IDs,
content and contract are pinned in the manifest; the runner reconstructs the
exact commits with fixed fixture identity/date using git commit-tree, then
checks the expected hash. They are actual nonempty diffs, not empty-tree passes.
No personal data or credentials belong here.

```bash
node scripts/code-review-eval.mjs --validate evals/code-review/cases.json --bundle /absolute/heads.bundle
node --test scripts/code-review.test.mjs scripts/code-review-eval.test.mjs
```

The historical list has 12 late slots, extended to 16 by d-006, 156, 159 and 80.
An interrupted attempt remains a `not-reviewed` row in scoring; no later repeat
or task starts. Unstarted attempts stay unstarted; they are not clean results.
Each case names its first-head origin, file, mechanism, breaking input and actual
consequence. Later MONO-146 defects 67, 70 and 71 are excluded from first-head
recall. Historical CSV danger labels are observations, not the oracle.

Rechecked before calls: #17 is retained because rejected provider-less routes
remain in blindFinding's identity list and destroy an otherwise valid paid
result. #41's claimed registration-after-resume order does not exist: acceptAmend
registers pins first. A live retry requires reconciliation, already mandated by
the pinned contract. Keep its historical slot visible, exclude it from eligible
recall. Version 3 additionally excludes #68: the observer-descendant exemption
does not reach the old detached collector on documented separate CLI commands.
See backup-switch.mjs:54–61,87 and collector.mjs:145–149,210, independently checked
in host round 2's GPT-family danger adjudication item 5. A persistent exported-API
controller is outside these inputs. Keep the historical slot and disputed danger
visible; eligible totals are 10/14, alongside nominal 12/16. These classifications and the
danger judgments were independently checked by the host. Round 1 reclassifies
#156 and #80 as danger disputed: their matches and calibration errors are scored,
but neither contributes to the danger veto. #156 has no pinned consumer of the
stale snapshot directory (dispatch.mjs:93–107); #80 may falsely match argv tokens
in macOS ps eww (runtime.mjs:147–152), with low confidence. #21 confirms the
hardcoded field but only partially supports its consequence; no differing helper
budget or field consumer is established. Evidence and the orchestrator decision
are retained in the manifest. #17 and #41 are unchanged. Do not silently redefine the denominator.

[Host round-2 enhancements](round2-enhancements.md) covers every eligible gold
miss in that run, the partial matches, observed alternatives, inferred causes and
concrete proposed strengthenings. Preserve the old v2 run/digest; v3 scoring is a
new classification, not a rewrite of the measured inputs. The four checker
danger removals (#18 twice, #23, #40) remain a release stop until host live
recalibration. Visibility, inspectability, recognizable placeholders and later
fail-closed safeguards do not negate an R7 category. `round2-checker-regressions.json`
retains those observed verdicts separately from authored corrected controls.
V3 records #18 as data loss in retained evidence and #40 as missing readiness;
both stay dangerous. The stronger implementation-bypass claim for #40 is unproved.

Match strictly only with BOTH the same code location and the same failure
mechanism/trigger. A matching title or consequence is insufficient. Partial
matches are separate. A judge must cite evidence; no lexical matching heuristic.
The judge works separately from the reviewer/checker. Gold and input digest stay
frozen throughout an experiment; changing either requires a new version/run.

Host live request: `{dataset:<parsed cases.json>,bundle:<absolute path>,config,
runId}` to `node scripts/code-review-eval.mjs --request <json>`. Every task and
authored documentation change control runs three times with risky production prompts through
the SAME runReviewRound function. Each invocation is its own row; failures and
costs remain in the row, not silently dropped. The CLI emits JSONL plan/started/result/complete events; preserve stdout and
interruption evidence outside the repository so an interrupted call stays in
the denominator. The final complete event contains the whole evaluation. The host compares incumbent results on exactly
the same head/base/contract and repeats, not the old summary percentages. `compareReviewEvaluations` rejects changed
head/base/contract or repeat denominators before pairing incumbent rows.
`scoreReviewEvaluation(dataset,evaluation,adjudications)` requires independent
`{runId,key,match,caseId,judge,evidence}` annotations for strict/partial matches;
novel/false-positive annotations omit caseId. It reports each run, ungraded
findings, dangerous misses, and union only as an additional column. There is no
automatic promotion based on recall. Novel findings are not automatically false.

`historical-checker.json` preserves both batches of checker replies from
2026-10-31 in their ORIGINAL schema, including all duplicates and disagreements.
These are observations, never a successful run of the new roles. The historical
prompts were broader and used different danger names; current prompts and exact
schemas live beside the manual skill. Deterministic current-schema transcripts
in `recorded-responses.json` are authored controls, not measured model output.

Checker calibration uses a separate verdict oracle per finding. Pass gold and
current parsed verdicts to `scoreCheckerProbes`; it counts false rejections,
removed danger, incorrect severity and merging distinct causes independently.
An undisputed known real dangerous case rejected or stripped of danger blocks release until
the cause is fixed and rechecked. A reviewer miss is an enhancement with cause
analysis, not a release veto. Unreviewed probes stay missing, never pass.

Before merge the host owns: live write/network/credential/config/hook refusal
tests on both tools; manual invocation from both systems (or explicitly recorded
separate local read-only roles with the same schemas/boundaries if nesting is
unavailable); three independent live repeats and incumbent comparison; independent
gold and checker calibration; results and enhancements recorded in the Issue.
The worker cannot prove these with recorded answers.

The role transport leaves Codex credential reads at worker-level machine access,
as accepted by the owner 2026-11-01. Read-only is not a credential-read deny list.
Signing-key integrity relies on denied writes. Host probes must describe the
actual installed tool boundaries, not infer them from launch arguments. Codex
uses an auth-only temporary home and a tool-restricted native model catalog, then
probes its exposed tool list before reading the task. Any unexpected tool or MCP
startup rejects the run. Claude reports Read/Glob/Grep plus StructuredOutput
(the schema response tool), with no MCP; denied worktree roots are refused up front.
Reports include the actual role engines/models/families and observed tool surfaces.
Every observed served-model identity is retained with its stream source: init,
refusal fallback, assistant message and modelUsage (including canonical names),
also on failed attempts. Reports show the requested route and the observed model
list separately; an init model cannot hide a later fallback. This records identity
observations, not an inference about final-model ordering from modelUsage keys.
`round2-model-stream.json` separates the observed refusal fallback from authored
multi-fallback and usage-alias controls; these names are data, not model policy.
Failed role answers recursively decode every JSON/JSONL string layer with
`JSON.parse` before secret scanning, including nested Codex `item.text` and further
embedded JSON. Both retained attempts are capped at 8 KiB; undecodable content or
decoding beyond 32 levels, 4096 nodes or 256 KiB is withheld rather than stored raw.
Mixed line secrets and multiline assignments are screened independently; retained
answers are rescanned after line redaction. Circle and evaluation Git calls share
one policy: hook/fsmonitor and color overrides, configured content filters and
diff/merge helpers disabled, and diff/show (including raw diffs) forced colorless
without external diff or textconv. Raw contracts keep exact hash-validated bytes.
Before worktree reads, gitlinks and index hints are refused; this also avoids
entering submodules with independent executable configuration. Both pinned blobs
of every changed path are scanned regardless of attributes. NUL-containing or
non-UTF8 blobs are refused before roles; patch scanning still reconstructs both
hunk sides for multiline assignments. Unsupported helper names fail closed.
