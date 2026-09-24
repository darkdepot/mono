# Reviewer comparison protocol

The bench is an offline experiment runner, not a delivery gate. It never issues a
certificate or changes the reviewer policy. The orchestrator owns archive access,
subscription-login verification, live calls, grading and the subsequent decision.
A worker can inventory the real archive read-only and exercise fake providers in scratch.

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
comparison. Each plan selects exactly one common protocol through `tools`; runs
with different values use different plans and run IDs.

## Route admission and credentials

The checked-in `scripts/review-bench-routes.mjs` declares only the approved Claude
Code, Codex CLI and Grok Build subscription routes. It is installed with the bench.
A custom routes JSON file uses the same array shape; a trusted `.mjs` file may
export it.

A subscription route has no credential mapping. It carries the orchestrator's
login-status evidence instead:

```json
{
  "id": "sol-high",
  "engine": "codex",
  "model": "<approved codex selector>",
  "effort": "high",
  "provider": {"id": "openai"},
  "credentialEnv": [],
  "environment": {},
  "eligibility": {
    "billingChannelAllowed": true,
    "source": "MONO-85 approved Codex subscription login",
    "subscriptionLogin": {
      "cli": "codex",
      "statusCommand": "codex login status",
      "checkedAt": "2026-09-24T00:23:45Z",
      "by": "mono-orchestrator"
    }
  }
}
```

Claude Code finds its macOS Keychain login by `USER`; Codex CLI and Grok Build
read login files under `HOME`. The bench exposes only the closed environment
allowlist `PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `LC_ALL`,
`SystemRoot`, and `PATHEXT`. It prints `subscriptionLogin` in admissions and
reports, but it never runs `statusCommand` and never decides whether the stored
authentication is a subscription; the orchestrator performs that check
immediately before a live run. An empty `credentialEnv` without a valid record
is refused with `subscription login evidence required`. Custom key-backed
fixtures remain valid for negative admission tests: a missing variable is named,
never its value. No credential value or undeclared host variable is forwarded or
persisted, and no Codex route receives `--codex-config`.

Admission also requires a positive billing assertion with a source and the absence
of `eligibility.toVerify`. An otherwise eligible route must pass the helper's
actual `--dry-run` on the frozen cases: input construction, prompt/schema
preparation, exact engine/model/effort, and isolation startup. Dry-run contacts no
reviewer. A successful dry-run is local compatibility evidence, not a live access
probe or a promise of availability.

`tools: "off"` is the default common protocol and adds both `--no-web-search` and
`--no-tools`; Codex is refused because the helper does not support tools-off for
that engine. `tools: "on"` keeps `--no-web-search` but omits `--no-tools`, admitting
Codex while refusing Pi and Grok because the helper always disables tools for
those engines. These are engine-plus-model bundles with different tool
implementations, comparable only inside the same plan protocol. For Claude,
`--no-web-search` removes WebSearch and WebFetch. For Codex, it avoids enabling
web search but cannot disable cache search. The report records those limits. A
baseline route additionally receives a separate production-settings group with a
different anonymous ID; blind grading never sees protocol labels, and reports
never mix common and production groups.

After the owner logs a subscription provider into Pi, the orchestrator may add a
custom Pi route with empty credentials and a `subscriptionLogin` record for the
underlying `claude` or `codex` login. It first verifies the login and payment
channel, freezes a `tools: "off"` plan under a new run ID, and performs dry-run
admission. Pi routes are never admitted to a `tools: "on"` plan.

The checked-in Grok route uses `grok login` and no API-key variables. Its login
signal is the `You are logged in` line from `grok models`, not that command's exit
code. The route is admitted only to `tools: "off"`, uses the engine's default
`low` effort established by MONO-86, and is comparable only with the Claude routes
inside that same `off` protocol.

## Plan file and commands

First inventory, then use the emitted stable case IDs in a plan JSON file. Example
shape (the real file must contain matching defect/fix cases):

```json
{
  "tools": "on",
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
node scripts/review-bench.mjs run --dry-run --evidence-root "$ARCHIVE" --repo "$REPO" --plan plan.json --routes routes.json
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
comparing cost or availability. An unfrozen `run --dry-run` reads `--plan`; once a
manifest is frozen, its plan is authoritative and any `--plan` override is refused.

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

A read-only scratch-installed inventory on 2026-09-24 found 23 reproducible cases
across five task clusters (MONO-80 through MONO-84); 22 archived runs still lacked
a dataset version. With a declared `tools: "on"` dry-run, all six checked-in routes
passed admission. With `tools: "off"`, the two Claude routes passed and all four
Codex routes were excluded with `helper rejects tools-off for Codex`. Both runs
reported zero provider calls and exposed no credential variables. The archive
remains below the declared sampling targets; this is feasibility evidence only.
Those historical cases freeze helper bytes without Grok support and are therefore
incompatible with the Grok route. For a new manifest frozen with a Grok-capable
helper, the admission expectations are three routes at `off` (two Claude plus
Grok) and six at `on` (two Claude plus four Codex, with Grok excluded).

Supply the Git checkout containing the historical objects as `--repo`.
`--root` optionally records the orchestrator directory as provenance; it is not
used as a Git working directory. No orchestrator registry or state is read. A
missing source checkout produces a Git-input exclusion, not a helper-version
claim. These observations concern input availability, not reviewer quality.

The default routes are explicitly marked experimental bench data. The validator
exception is exact to that file and marker (MONO-81 decision d-004); all production
consumers retain the single-model-source restriction. Removing the marker or
putting it in another consumer does not grant that consumer an exception.
