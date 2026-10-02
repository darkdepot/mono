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
Changelog assembly uses this policy; merge checks and wave installation are
separate implementation units.

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

At most one registered release attempt remains live: registration checks the
verified pins under `launch.lock`, including direct spawn. A stopped or paused
attempt remains registered and reserves the slot until the orchestrator explicitly
retires it. Release assembly and product rollout remain with their phase owners.

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
It inserts them immediately below the exact `heading` line, leaving all existing
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
duplicating the notes. The heading must occur exactly once; record filenames use
an uppercase issue prefix and numeric suffix, such as `MONO-107.md`.

After assembly, the release task moves the collected notes into the version's
section and leaves an empty `## [Unreleased]` heading. It updates `VERSION`;
the deploy owner publishes and verifies the version tag during release closeout.
