# Reviewer comparison protocol

The bench is an offline experiment runner, not a delivery gate. It never issues a
certificate or changes the reviewer policy. The orchestrator owns archive access,
provider credentials, live calls, grading and the subsequent decision. A worker
can inventory the real archive read-only and exercise fake providers in scratch.

## Declare the sample before calling providers

Start with `manifest --dry-run`. Inventory every receipt, identify task families,
and publish the exclusions. A missing archived dataset, missing code/base object,
changed helper or incompatible input is not a clean example. Receipt/history
copies of one run count once. Different versions of the same task remain one
cluster, including retries and defect/fix pairs; they are not independent samples.

Use the following initial target, or record a different target with its rationale
before freezing a manifest:

- At least 12 independent task families; include standard, deep and risky changes.
  Record the number of cases in each risk class, including any unavailable class.
- 27 known-defect cases: at least 3 P0, 12 P1 and 12 P2 defects. Include permission,
  data-integrity, routing, concurrency and ordinary logic failures where available.
- A corresponding fix for each defective case and at least 12 clean changes.
  A fix is independently inspected; the incumbent's clean verdict is not gold.
- Three repetitions per case and route, with identical inputs and settings.
- Hold out at least four whole task families, selected before route results exist.
  Keep both members of each pair and all versions/retries in the same partition.
- Declare `maxCalls`, a per-call `timeoutSec`, and a written `stopRule`. There are
  no automatic retries. Budget exhaustion leaves planned samples as `not-run`.
  A revised budget, selection, gold set, helper or input requires a new run ID.

These are sampling targets, not claims of statistical power. Report exact counts
and misses by severity, risk class, family, partition and repeat. Estimate
uncertainty by resampling whole families, not individual versions. Do not claim
non-inferiority from a small or convenience sample. A lost current P0–P2 defect
can reject a candidate; zero observed misses cannot prove equivalence.

With a thin archive, retain the same declared targets and show the shortfall. A
small scratch experiment may establish feasibility, not quality. An archive with
no reproducible cases produces an inventory and exclusion report; it cannot run.

## Frozen inputs

`manifest` embeds the exact archived dataset bytes and a digest-verified copy of
the helper. The receipt helper digest hashes the canonical JSON representation of its UTF-8 text, matching the gate; it is the helper version identifier. The manifest also records a separate SHA-256 of the exact helper bytes and validates both on replay. A currently installed
helper can supply the copy only when its digest equals the receipt's digest;
`--helper` can supply an older saved copy. The bench never edits archive files.
It records the commit, merge-base, tree ID, binary full-index diff digest, receipt
digest, dataset version/digest, helper digest, task cluster and sample partition.
The diff digest is computed in a temporary bare Git object view with default
configuration; checkout-local diff formatting and attribute overrides are excluded.
All inputs, route declarations and the sample/gold declaration have a canonical manifest digest. A live run refuses route changes after freezing.

The dataset is the archived context available at that historical run. Do not
substitute today's materialized dataset or append later decisions. Gold labels,
grading notes, later fixes and later decisions live only in the private manifest
and grading files. Only the frozen historical dataset is materialized for review.
The temporary repository contains the pinned Git state; review targets the same
branch/base invocation as collection, at priority P2. The bench does not execute
repository code. Unsupported submodules and unavailable objects are excluded.

Partitioning uses the pinned helper's deterministic preparation and defaults.
Claude and Pi use that helper's common prompt budget; the version and entire
helper copy bind the algorithm. The manifest reads a unique positive integer
`MAX_REVIEW_PROMPT_BYTES` declaration from those verified bytes (without executing
them). Missing, ambiguous or computed declarations record `unknown` with a reason;
the bench does not substitute its own budget. The input diff and dataset digests are the
prepared-evidence inputs, not a claim to hash the model's private prompt or reply.
Any future engine with different partitioning needs a separately declared harness
comparison. The current helper rejects Codex with `--no-tools`; Terra medium/high
remain listed controls but are excluded from this common protocol.

## Route admission and credentials

The checked-in `scripts/review-bench-routes.mjs` is a candidate declaration based
on the approved research snapshot. Its dates and provider terms need refreshing
by the orchestrator before live use. It is installed with the bench. A custom
routes JSON file uses the same array shape; a trusted `.mjs` file may export it.

Each route names its engine, model, effort, provider ID, optional HTTPS endpoint,
credential variable names and target-to-source environment mapping. For example:

```json
{
  "id": "candidate",
  "engine": "claude",
  "model": "glm-5.3",
  "effort": "high",
  "provider": {"id": "zai", "endpoint": "https://api.z.ai/api/anthropic"},
  "credentialEnv": ["ZAI_API_KEY"],
  "environment": {"ANTHROPIC_AUTH_TOKEN": "ZAI_API_KEY"},
  "eligibility": {
    "billingChannelAllowed": true,
    "source": "https://docs.z.ai/devpack/tool/claude"
  }
}
```

No key values belong in route files. The bench names missing variables and
forwards only the listed mappings plus an explicit OS environment allowlist.
Provider selectors, fallback-model overrides and unrelated credentials are not
inherited. Raw child output is captured in memory; credential values are removed
before persisted results or console summaries. Helper report/status files are
private temporary files, read and discarded when the temporary repository is
removed. The helper remains responsible for its own authentication and output
isolation; the bench does not change it.

Admission requires a positive billing assertion with a source and the absence of
`eligibility.toVerify`. Schema errors, missing credentials, unverified billing or
unsupported tools-off routing exclude a route before invoking the helper. An
otherwise eligible route must pass the helper's actual `--dry-run` on the frozen
cases: input construction, prompt/schema preparation, exact engine/model/effort,
and isolation startup. A second check binds each actual call to its exact case
and settings. Dry-run contacts no reviewer. A successful dry-run is local
compatibility evidence, not a paid model-access probe or a promise of availability.
A provider failure during a live call is retained as an operational failure.

The common invocation adds `--no-web-search --no-tools` for every route. A route
marked `baseline: true` also gets a separate production-settings experiment only
when its engine/model/effort match the archived production route. That experiment
retains the collection tool/web settings. It gets different anonymous IDs, and
the grader is not told which samples use the production protocol. The report
separates common-protocol model comparisons from this harness comparison.

Z.ai uses its supported Claude Code channel. Kimi uses Moonshot pay-per-token,
never Kimi Code membership for unattended automation. DeepSeek uses its
Anthropic-format endpoint. Grok's Pi support and subscription terms, MiniMax's
Token Plan and model compatibility, and Pi/Gemini availability are explicitly
`toVerify`. Clear that field only with documented evidence. Codex quota does not
make a tools-on control comparable to the tools-off experiment. The default
incumbent uses an API key; an orchestrator may declare its authorized subscription
login route with no credential mapping after verifying that payment channel.

## Plan file and commands

First inventory, then use the emitted stable case IDs in a plan JSON file. Example
shape (the real file must contain matching defect/fix cases):

```json
{
  "repeats": 3,
  "maxCalls": 2000,
  "timeoutSec": 600,
  "stopRule": "Stop at the call limit or per-call deadline; no retries.",
  "minimums": {"families": 12, "clean": 12, "pairs": 27, "heldoutFamilies": 4, "P0": 3, "P1": 12, "P2": 12},
  "cases": [
    {"id": "case-from-inventory", "partition": "heldout", "kind": "defect", "pair": "pair-1",
     "gold": [{"id": "defect-1", "severity": "P1", "evidence": "Independent reproduction and source location"}]},
    {"id": "fix-from-inventory", "partition": "heldout", "kind": "fix", "pair": "pair-1", "gold": []}
  ]
}
```

```sh
node scripts/review-bench.mjs manifest --dry-run --evidence-root "$ARCHIVE" --repo "$REPO"
node scripts/review-bench.mjs run --dry-run --evidence-root "$ARCHIVE" --repo "$REPO" --routes routes.json
node scripts/review-bench.mjs manifest --evidence-root "$ARCHIVE" --repo "$REPO" --run-id comparison-1 --plan plan.json --routes routes.json
node scripts/review-bench.mjs run --dry-run --evidence-root "$ARCHIVE" --repo "$REPO" --run-id comparison-1 --routes routes.json
node scripts/review-bench.mjs run --evidence-root "$ARCHIVE" --repo "$REPO" --run-id comparison-1 --routes routes.json
node scripts/review-bench.mjs score --evidence-root "$ARCHIVE" --run-id comparison-1 --adjudications grades.json
node scripts/review-bench.mjs report --evidence-root "$ARCHIVE" --run-id comparison-1
```

Dry runs print summaries and do not write to the archive. Other commands write
only to a newly reserved `<evidenceRoot>/bench/<runId>/`. Existing artifacts are
never overwritten. After interruption inspect `started.json` and individual
`sample-*.json` files; count that attempted experiment and its incomplete outcomes
in the study log, then use a new run ID. Never drop an interrupted attempt when
comparing cost or availability.

## Gold and blind grading

Build gold from independent reproduction and inspection. Findings from the
incumbent are evidence, not truth. Gold is fixed before calls, including the
held-out partition. Only the experiment operator may read `manifest.json`,
`routes.private.json`, `run.json` and individual sample files. Give graders only
`blind.json` and the relevant separately prepared gold/source evidence. The blind
file omits route mappings, provider telemetry and protocol labels; route IDs are
random, and explicit route names in finding text are removed. Writing style can
still be recognizable; do not treat textual anonymization as perfect blinding.
The bench randomizes the order of samples in the blind file.

Record one adjudication for each returned finding:

```json
{"entries":[{"sampleId":"anonymous-sample-id","findingIndex":0,"outcome":"match","goldId":"defect-1","reviewers":["grader-a"],"evidence":"Same trigger and affected behavior"}]}
```

Outcomes are `match`, `false-positive`, `novel`, `disputed`, or `duplicate`.
Match by behavior and trigger, not title similarity. Match only gold from that
case. Duplicate findings cannot increase recall. A false positive requires
`novelTriage: true` and evidence of the triage. Every disputed adjudication uses
`wasDisputed: true` and at least two independent reviewer IDs before resolution.
An explicit `disputed` outcome also requires two distinct reviewers even when the
flag is omitted. A defect/fix pair has exactly one case of each kind in one
cluster; clean cases cannot stand in for either member.
Leave unreviewed observations unresolved. Novel confirmed defects are reported
separately; revise gold only in a new experiment, never after seeing a preferred
route. A finding without a grade is unknown, not a false positive.

## Report and decision

Report P0/P1/P2 recall separately (detected/known, with null for no examples),
precision with its adjudicated denominator, repeated observations, paired misses,
false alarms on fixes, novel defects, unresolved findings and failed outcomes.
Retain timeouts, preparation failures and stopped calls in operational denominators;
report calls, completed results and planned samples separately. Show elapsed time
and reviewer token usage with measured/called coverage and reasons for missing
usage. Tokens are not price, remaining quota, or a provider billing statement.
Break out held-out results and production harness differences. Inspect pair-level
results and cluster uncertainty before any provider recommendation. `pairedMisses`
counts pair/repeat observations with at least one missed gold defect after both
defect and fix results are complete and adjudicated. The report joins those two
samples by pair ID and repeat, records missed defects and false alarms on the
fix, and separates evaluated and unresolved pairs from all planned pairs. Failed,
stopped or ungraded members keep the pair unresolved.

A coverage gap produces `feasibility-only` and no quality recommendation. With
coverage, `keep-incumbent` remains the default, including when all candidates
fail, quality is uncertain or savings are not persuasive. Neither outcome changes
policy. Any later reviewer choice needs a separately recorded decision covering
quality, failures, cost, provider limits and the relevant producer/reviewer pair.

## Observed archive feasibility on this machine

Corrected read-only inventory on 2026-09-16 (MONO-81 delivery, after its first
preflight collection) examined 28 distinct archived runs. Six cases were
reproducible across three task clusters (MONO-80, MONO-81 and MONO-83); 22 lacked
an archived dataset version. All nine default routes were excluded; provider
calls were zero. Seven routes lacked credential variables, several also required
provider verification, and both Terra controls were incompatible with the
helper's tools-off requirement. The archive remains below the declared sampling
targets and has no predeclared gold sample; this is feasibility evidence only.

Supply the Git checkout containing the historical objects as `--repo`.
`--root` optionally records the orchestrator directory as provenance; it is not
used as a Git working directory. No orchestrator registry or state is read. A
missing source checkout produces a Git-input exclusion, not a helper-version
claim. These observations concern input availability, not reviewer quality.

The default routes are explicitly marked experimental bench data. The validator
exception is exact to that file and marker (MONO-81 decision d-004); all production
consumers retain the single-model-source restriction. Removing the marker or
putting it in another consumer does not grant that consumer an exception.
