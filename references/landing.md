# Landing

## Shared paths

Parallel task branches avoid editing shared release files. Products opt in through
`landing` in `.agents/mono-workflow.config.json`; without this block, delivery
keeps its existing behavior. Each absent subblock disables its corresponding
behavior. The complete copyable config is [the example](../examples/landing-config.json).

## Configuration

```json
"landing": {
  "serialPaths": ["CHANGELOG.md", "VERSION", "shared/"],
  "changelog": {
    "fragmentDir": "changelog.d",
    "target": "CHANGELOG.md",
    "heading": "## [Unreleased]"
  },
  "validation": { "check": "validate", "timeoutSec": 1800 },
  "install": "per-merge"
}
```

`serialPaths` contains exact repository-relative file paths or directory prefixes
ending in `/`. Absolute paths, parent traversal, empty paths and duplicates are
invalid. There is no glob matching. `changelog` names the fragment directory,
target file and exact heading line. `validation` names the merge-commit check and
its positive integer timeout in seconds. `install` accepts `per-merge` (default)
or `wave-drain`. Unknown keys in `landing` or its subblocks are config errors.
Changelog assembly, merge validation and installation use this policy.

## Task fragment

Write a non-empty Markdown fragment to `<fragmentDir>/<ISSUE-KEY>.md` for a
user-visible change. The gate does not require a fragment's presence. For example,
`changelog.d/MONO-107.md` can contain:

```markdown
- MONO-107: assemble task records during release, preserving existing notes and
  recognizing already assembled records when a run is interrupted.
```

Keep shared release files for the release task. Mono's own config declares
`CHANGELOG.md` and `VERSION` as shared paths and `changelog.d` as its fragment
directory.

The gate reads the policy from the immutable dispatch `pins.base`, so a branch
cannot change its own policy. A branch introducing the block has a base without
the policy and is unaffected. Changed paths come from the gate's
merge-base..head diff with `--no-renames`: renaming away from a shared path still
counts; inherited changes after rebasing onto main do not.

The preflight check runs before receipt processing and reviewer collection, and
is also used for worker verification and ship. A non-release branch touching a
shared path receives three parts: `serial path touched: <path>`,
`landing.serialPaths` on the pinned base, and an action to write
`<fragmentDir>/<KEY>.md` or dispatch a release task. With no changelog block the
action names the release task. A request without pins under this policy receives
`landing policy requires pinned dispatch`.

## Release task

Only the orchestrator dispatches the separately approved release Issue using
`dispatch.mjs --release true`; `--release false` is the default. The manifest's
boolean `release` is immutable across amendments. The gate reads the exception
only from admitted, verified dispatch pins; a request field cannot grant it.
A release task may edit the shared paths and consume task fragments.

At most one release attempt is `active`: registration and resume check verified pins and
the shared attempt state under `launch.lock`, including direct spawn. A paused
or stopped attempt without a matching landing remains active until explicitly
retired. A stopped `landed` attempt does not reserve the release slot. Release
assembly and product rollout remain with their phase owners.

## Changelog assembly

From the pack checkout, the release task runs:

```bash
node scripts/changelog-assemble.mjs --worktree . --config .agents/mono-workflow.config.json --check
node scripts/changelog-assemble.mjs --worktree . --config .agents/mono-workflow.config.json
```

From an installed pack, use
`<skills-root>/.mono-agent-workflow/scripts/changelog-assemble.mjs` with the same
flags and the product's worktree and config paths. `--check` prints the resulting
target file and writes nothing. Without `landing.changelog`, the command reports
`not configured` and exits successfully.

The command orders records by key prefix, then numeric suffix (9 before 10).
It inserts them immediately below the first exact `heading` line, leaving all existing
text below them. Each record starts with
`<!-- fragment: <KEY> sha256:<digest> -->`; the digest is SHA-256 of the fragment's
original bytes. The target is replaced atomically before collected records are
removed. A repeated run removes a remaining record without inserting it again
only when its key and digest match a marker in the target. A key mentioned in
ordinary text is not a marker.

A marker with the same key and a different digest, an empty or unreadable record,
or a missing heading refuses before changing any file. Correct the input and
retry. If interruption occurs after replacement but before removal, rerun the
same command with unchanged records: matching markers complete removal without
duplicating the notes. The first matching heading stays the insertion point even
when a record contains that heading too. Record filenames use an uppercase issue
prefix and numeric suffix, such as `MONO-107.md`.

After assembly, the release task moves the collected notes into the version's
section and leaves an empty `## [Unreleased]` heading. It updates `VERSION`;
the deploy owner publishes and verifies the version tag during release closeout.

## Merge validation

With `landing.validation`, ordinary merges and installation require a successful
`check` for the current landing branch tip obtained from GitHub. Before merging,
check that tip; after merging, capture `merge_commit_sha` from the GitHub PR record
and check that exact commit before another ordinary merge or installation. A green
PR check does not prove the landing commit. Fetch the tip again before installation;
if it changed, check the new tip as well. The installing checkout must still match
the expected GitHub merge SHA under the existing installation contract.

From a checkout, the orchestrator runs:

```bash
node scripts/orchestrator/landing-guard.mjs check --repo OWNER/NAME --sha FULL_SHA --root ORCHESTRATOR_ROOT --config PRODUCT_CONFIG --json
```

Installed location:
`<skills-root>/.mono-agent-workflow/scripts/orchestrator/landing-guard.mjs`.
`--sha` accepts only a full 40-character SHA. Without `landing.validation`, `check`
reports `not configured`, returns 0 and makes no observation or GitHub request.

The first invocation for that SHA records `firstObservedAt` once in
`landing/guard/<sha>.json` under the orchestrator root, before reading GitHub.
The deadline is that time plus `timeoutSec`, including when the first read fails;
commit dates and later arguments cannot extend it. The record binds the repository
and validation policy: changing either for an existing observation refuses rather
than resetting its deadline. Each call makes at most 100 page requests, with a
10-second per-request timeout and a 30-second total read budget, and never polls.
Reinvoke on a pending result; never remove an observation to restart its deadline.

Checks are read for exactly that SHA, page by page with `filter=all`. Other SHA
results are ignored. Among checks matching `check`, any unfinished run (including
one without `completed_at` or still queued) takes precedence over an old success
or failure. Otherwise choose greatest `completed_at`, then greatest `id`.

- 0: completed `success`, even if first observed after the deadline.
- 2: before the deadline, missing check, unfinished check or GitHub read failure.
- 1: completed `failure`, `cancelled`, `timed_out`, `action_required`, `stale`,
  `skipped` or `neutral`; also missing, unfinished or unreadable checks at the
  deadline. The result names the reason and the checks found on the commit.

Only a corrective Issue may bypass a red previous tip for one merge. After a
`check` result of 1, record the Issue and reason before merging:

```bash
node scripts/orchestrator/landing-guard.mjs corrective --issue ISSUE_KEY --red-sha FULL_SHA --reason 'Repair reason' --root ORCHESTRATOR_ROOT
```

`corrective` rechecks the stored repository/policy and requires code 1; green or
pending refuses. It stores the authorization in that SHA's observation and writes
one UTC-dated `LANDING-CORRECTIVE` line in `ledger.md`. Repeating identical data
changes nothing; a different Issue or reason refuses. The orchestrator binds the
exception to that Issue and previous red tip and allows only its one merge. No
ordinary merge or installation is authorized by this exception. Check the
corrective merge's new SHA under the same rule; normal delivery resumes only on
its success.

For the first rollout of this guard, the orchestrator qualifies the GitHub
contract from the main checkout before installing: use a temporary failing PR,
observe failure and a pending rerun after failure; on this guard's merge commit,
observe a pending rerun after success and final success. Close the temporary PR
without merging, install only after code 0 on this guard's own merge SHA, and
record the live outcomes in the Issue comment. Fixtures cover a newer failure
after success on the same SHA; they do not qualify GitHub's external behavior.

## Install

`landing.install: "wave-drain"` defers installation until every registered,
unretired attempt is `landed`. The shared `attemptState` function in
`orchestrator/command-state.mjs` also governs release uniqueness. It recognizes
`landed` only with verified pins, a matching confirmed green ship report and
landing record for that Issue/attempt, and a stopped worker: its pid is dead or
its current process start differs from `procStart`. A live pid with a landing,
unfinished start, pause, missing pins, foreign or unreadable report, or any
uncertainty remains `active`. State readers name the reason; they never retire
attempts. Installed archives retain the landing identity after pending removal.

The orchestrator uses `landing-drain.mjs` from the checkout, or
`<skills-root>/.mono-agent-workflow/scripts/orchestrator/landing-drain.mjs` once
installed. All commands take `--root ORCHESTRATOR_ROOT --config PRODUCT_CONFIG`;
`--json` returns structured output. With `per-merge` (default) or no install
subblock, these commands report `not configured`, return 0 and change nothing.

- `record --issue KEY --attempt N --pr P [--repo OWNER/NAME]` consumes the confirmed
  green ship certificate for the current attempt, including its PR and head.
  The request repository defaults to the attempt worktree's GitHub `origin`;
  supply `--repo` when the PR targets another repository, such as upstream of a
  fork. The certificate's `PR` field accepts GitHub PR URLs and numbers (with optional `#`), separated by whitespace, `/`, commas or Markdown-link brackets, only when every component names the same PR in the request repository; numbers without a URL bind to that repository.
  The merged GitHub PR must have that number, repository, head and the
  landing branch from the attempt's pins. It appends
  `{repo, issue, attempt, pr, head, mergeSha, mergedAt, guard}` to
  `landing/pending-install.json` and a UTC-dated `LANDED` line to `ledger.md`.
  `guard` preserves the check outcome at recording, including a red or pending
  check: an actual merge must stay accounted for. An identical replay changes
  nothing; conflicting Issue/attempt data refuses. Installed records cannot be
  requeued. This consumes sealed evidence rather than rerunning open-PR gates.
- `status` returns 0 with no active attempts, otherwise 2 with every blocking
  Issue/attempt and reason. It reads under `launch.lock` so an in-flight resume
  cannot expose an old stopped pid. Registered landed tasks do not block each other.
- `verify --install-sha T [--worktree MAIN_CHECKOUT]` requires existing
  `halt: true` in `control.json`. Set it before calling; keep it through install
  and read-back. Verification waits for `launch.lock`, then rereads halt, registry
  and processes under that lock before fixing the package composition. A launch
  or resume begun before halt holds the lock through pid publication, so verify
  sees that attempt as active. Spawn and resume already reject halt. Lock waits
  retry for at most 120 seconds, then refuse without changing package records;
  no lock is reclaimed or removed by a contender.
  T must equal GitHub's current landing branch tip, and the installing checkout
  (default: current directory) must have HEAD T. Each recorded merge is reread
  from GitHub, matches its certificate and pinned landing branch, and is an
  ancestor of T in that checkout. Every attempt must be landed and the check on
  T must return 0. It prints the records and per-task proof
  `{issue, attempt, pr, mergeSha, installSha}`, and atomically saves the immutable
  composition in `landing/batch-<T>.json`. Repeating T checks the same composition.
- `close --install-sha T --evidence TEXT` is an attestation by the deploy owner
  after successful installation and product-specific read-back. It requires the
  verified batch, archives its records and evidence in `landing/installed/<T>.json`,
  removes only those records from pending and writes `DRAIN-CLOSE`. Archive-first
  ordering recovers a crash before removal; identical close retries are harmless.
  Changed evidence or batch refuses. The script performs no installation itself.

Pending mutations use their own lock and atomic JSON replacement; registry-bound
record/verify also serialize with launch. Ledger appends share `dispatch.lock`.
After close, close each Issue with its individual proof, then retire its attempt.
Until then it stays In Review. A failed install or red T leaves pending records
intact: the orchestrator removes halt, starts a corrective task, and verifies a
new T containing the earlier merges. Removing halt is always the orchestrator's
action, after close or after installation failure. This does not change the
cross-product quiescence rule for breaking installations or the installation
source check for `per-merge`.

First rollout of U7 uses the merged main checkout for record, status, halt,
verify, install and read-back. Run close from the newly installed runtime, then
remove halt. The deploy owner records this live proof; worker fixtures do not
substitute for first application.

## Scheduling

At handoff, put Issues from the same set that must edit the same file in an
explicit dependency chain. Keep independent work parallel. This is a slicing
judgment reviewed with the package, not a script gate; shared release paths stay
with the release Issue under the rules above.

Before dispatching another approved Issue into a running wave, the orchestrator
runs the observer and considers the reported intersections together with that
Issue's intended files and dependencies. Resolve a real overlap through the
Issue's worker or scheduling decision. The observer evaluates only registered
active attempts with committed work; it cannot evaluate an unlaunched Issue,
rebase a worker, impose waiting, or change a gate or lifecycle state.

## Landing observer

From the checkout, the orchestrator runs:

```bash
node scripts/orchestrator/landing-plan.mjs --root ORCHESTRATOR_ROOT --config PRODUCT_CONFIG --json
```

Installed location:
`<skills-root>/.mono-agent-workflow/scripts/orchestrator/landing-plan.mjs`.
Without `landing`, all three commands report `not configured` and change nothing.
The observer uses the shared `attemptState` classifier and includes every `active`
registry entry, ordered by `spawned_at`, then Issue key. It obtains each base
from verified effective pins and each head from its worktree. Missing pins,
no commits beyond base, a dirty tree (including untracked files), unavailable
main or another calculation failure yields `unevaluable: <reason>`.

Main refresh is independent of candidate evaluation, including an empty registry.
Invoke the command from the product checkout: without usable candidate pins, it
uses that checkout and its origin default-branch ref (or `origin/main` when absent).
An unavailable tip is `main: null` with an explicit `mainError`.
Before calculation it fetches the pinned landing branch from origin into a
disposable bare repository using the existing object store as an alternate. It checks
main against each evaluable head, then evaluable heads pairwise using
`git merge-tree --write-tree`. Exit 0 alone means clean; exit 1 means conflict;
any other exit means `unevaluable: merge-tree error`. Output uses a list of
verdicts: `clean`, `conflicts-with-main`, `conflicts-with:<KEY>` or
`unevaluable: <reason>`. Multiple conflicts can coexist. Every invocation appends
one `LANDING-PLAN` record with main, candidate bases, heads and verdicts, including
an empty registry. No gate reads this output. Worker files, branches, indexes,
registry, Git metadata and task states remain unchanged; fetched refs and
merge-tree objects live only in the temporary repository, which is removed on
exit. The sole durable observer result is its ledger line. Do not infer semantic compatibility from a clean textual merge.

The owner status has one «Посадка» line: name observed intersections or a clean
result, and disclose branches that could not be evaluated and why.

## Head observations and refresh history

The orchestrator records the PR-opening head and every newly accepted ship-report
head, choosing an evidence-supported reason and recording the sibling when known:

```bash
node scripts/orchestrator/landing-plan.mjs head --root ORCHESTRATOR_ROOT --config PRODUCT_CONFIG --issue KEY --attempt N --sha FULL_SHA --reason opened --json
node scripts/orchestrator/landing-plan.mjs head --root ORCHESTRATOR_ROOT --config PRODUCT_CONFIG --issue KEY --attempt N --sha FULL_SHA --reason sibling-merge --sibling SIBLING_KEY --json
node scripts/orchestrator/landing-plan.mjs harvest --root ORCHESTRATOR_ROOT --config PRODUCT_CONFIG --issue KEY --attempt N --pr P --repo OWNER/NAME --json
```

`head` requires a full 40-character SHA. Reasons are
`opened|sibling-merge|review-fix|docs|unknown`; `sibling-merge` requires another
Issue's key, and other reasons have no sibling. An identical
`{issue, attempt, sha}` adds nothing, preserving the original observation even
if a later caller supplies another reason. `LANDING-HEAD` is an observation,
never a counted refresh. Unknown cause remains `unknown`.

After landing, `harvest` reads GitHub GraphQL
`HEAD_REF_FORCE_PUSHED_EVENT` history page by page. `--repo` defaults to the
current checkout's GitHub origin; use it explicitly for an upstream PR on a fork.
Each event produces one `LANDING-REFRESH` identified by
`{issue, attempt, old, new}`. Its reason and sibling come from the `LANDING-HEAD`
whose SHA equals `new`, otherwise `unknown`. For A→B→C with only an observation
of C, A→B stays unknown and B→C takes C's reason. Ordinary appended commits have
no force-push event and produce no refresh.

A missing event side is stored as `null` and its reason is `unknown`; `createdAt`
distinguishes incomplete events that would otherwise share the same identity.
Check-runs on `new` are read with `filter=all` and pagination and stored as
`{id, name, durationSec}`; an unobservable duration is `null`. Each run on each
new head is counted once per Issue/attempt, including repeated events pointing
to that head. Unavailable checks or a missing new head record `checks: "unknown"`.
Unavailable or incomplete history reads append one `history: "unavailable"`
record per repository/PR/Issue/attempt; its refresh count remains unknown. A later
successful harvest can add events but does not erase that evidence limit.
A repeated harvest adds nothing for already recorded events, including incomplete
ones. Reads are bounded to 100 pages and a 30-second budget per history/head, with
at most 10 seconds per request; no command polls. Ledger appends and replay
checks serialize under `dispatch.lock`, with each line fsynced before proceeding.

Before installing U9, the orchestrator runs harvest from the merged main checkout
on PR 105: five events must match the Tech Spec sample, and a second run must add
none. Worker fixtures validate the implementation; that live check qualifies the
external history contract and belongs to the deploy owner.

## Landing journal and queue decision

All landing entries use the existing `ledger.md` and a UTC stamp from `date -u`:

```text
- <UTC> LANDING-PLAN {"main":"<sha>","candidates":[{"issue":"<KEY>","attempt":1,"base":"<sha>","head":"<sha>","main":"<sha>","verdicts":["conflicts-with:<KEY>"]}]}
- <UTC> LANDING-HEAD {"issue":"<KEY>","attempt":1,"sha":"<sha>","reason":"sibling-merge","sibling":"<KEY>"}
- <UTC> LANDING-REFRESH {"issue":"<KEY>","attempt":1,"repo":"<OWNER/NAME>","pr":105,"old":"<sha>","new":"<sha>","createdAt":"<UTC>","reason":"unknown","checks":[{"id":1,"name":"validate","durationSec":116}]}
```

`LANDED` carries PR, merge SHA, merge time and the check outcome on that merge;
`LANDING-CORRECTIVE` carries its red tip, corrective Issue and reason;
`DRAIN-CLOSE` carries the installed composition and evidence, as defined above.
Only `LANDING-REFRESH` counts branch history rewrites; never count observations or
ordinary added commits. Missing history, checks or durations are unknown costs,
not zero. Count sibling-caused events only when their recorded reason is
`sibling-merge`; do not guess from temporal proximity.

Decide on a mandatory waiting queue only after at least 30 landings, and only
when time and checks spent on sibling-caused refreshes exceed estimated waiting.
Waiting is the interval from the first `LANDING-PLAN` predicting
`conflicts-with:<KEY>` to that sibling's `LANDED` timestamp. Preserve the Issue/
attempt association; compare measured refresh effort and check durations with
those waiting intervals, exposing unknown data and the cost-estimation assumptions.
Until that decision is supported, the observer advises and work stays parallel
under the dependency/scheduling rules. No waiting queue or new cost model is
introduced here.
