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
  fork. A full GitHub PR URL must name this repository; a bare PR number binds to
  it. The merged GitHub PR must have that number, repository, head and the
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
