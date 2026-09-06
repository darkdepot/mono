# Install Guide

Install this workflow as a local skill pack. Project repos must not contain
workflow skill bodies, generated wrappers, workflow lockfiles, local workflow
checkers, or updater CI.

## Source Of Truth

Canonical workflow truth stays in the current
[`darkdepot/mono`](https://github.com/darkdepot/mono) repository checkout:

- `skills/mono-*/SKILL.md`
- `references/*`
- `templates/*`
- `scripts/install-local.mjs`
- `scripts/project-config.mjs`

Project-specific policy lives in `.agents/mono-workflow.config.json`.
When migrating an existing project, `project-config.mjs` reads the previous
`.agents/linear-workflow.config.json` and writes the same policy to the Mono
path. Use `--write --clean` to finish the migration and remove old generated
workflow files.

## Local Skill Pack

Run the installer from this upstream checkout:

```bash
node scripts/install-local.mjs --remove-stale
```

The default mode is `--all-roots`: the installer discovers every
previously-installed skills root by looking for
`.mono-agent-workflow.lock.json` in the known roots — `~/.codex/skills`,
`~/.claude/skills`, and any root recorded in a discovered lockfile — and syncs
each of them in one run, reporting the per-root installed version. A single
default run keeps every installed runtime (Codex, Claude Code, etc.) on the
same upstream version. On a fresh machine with no lockfiles, the installer
falls back to `~/.codex/skills`.

For each installed skills root the command writes:

- `<skills-root>/mono-*/SKILL.md`
- `<skills-root>/mono-*/AGENTS.md`
- `<skills-root>/mono-*/references/*`
- `<skills-root>/mono-*/templates/*`
- `<skills-root>/.mono-agent-workflow/scripts/*` (pack-private workflow runtime scripts)
- `<skills-root>/.mono-agent-workflow.lock.json`

The lockfile carries the additive pack identity triplet: `packVersion` from
`VERSION`, immutable `sourceCommit` from the installing checkout's HEAD, and
the positive integer `surfaceRevision`. Existing `upstreamVersion` and
`upstreamCommit` fields remain for compatibility and keep their semantics.

### Workflow Runtime Scripts

Some skills invoke a workflow script at delivery time rather than only reading
Markdown. The installer owns their copy so product repos never hand-vendor
workflow scripts. They are published, per installed root, into a pack-private
directory beside the lockfile:

- **Canonical path:** `<skills-root>/.mono-agent-workflow/scripts/<script>.mjs`
- **Discovery from an installed skill:** the pack-private directory is one level
  up from any installed `mono-*` skill directory, so a skill at
  `<skills-root>/mono-<name>/` reaches it at
  `../.mono-agent-workflow/scripts/<script>.mjs`.

The runtime scripts are the issue-only lane resolver
`.mono-agent-workflow/scripts/resolve-issue-context.mjs`, the pack guard
`.mono-agent-workflow/scripts/verify-pack-state.mjs`, and the orchestration
heartbeat watcher `.mono-agent-workflow/scripts/watch-workers.mjs`. Workers use
the pack guard to compare their dispatch identity with the installed lock at
every stage start or resume; future breaking installs use its quiescence probe.
The orchestrator launches the watcher from the installed pack-private copy, so
it does not depend on a checkout of this repository. Each script's hash is
recorded in the lockfile
(`runtimeScripts`), so `--check` fails when an installed runtime script is
missing, edited, or stale.

Use an explicit single skills root only for tests or runtimes outside the
known roots:

```bash
node scripts/install-local.mjs --skills-root /path/to/skills --remove-stale
```

Set `MONO_WORKFLOW_KNOWN_ROOTS` (a `path.delimiter`-separated list, `:` on
POSIX) to replace the known roots list, for example in fixtures or sandboxes.

Check every installed root without writing:

```bash
node scripts/install-local.mjs --check
```

The check reports the per-root installed version and fails when any
discovered root is missing files, stale, edited, or pinned to a different
upstream version or commit than the current checkout.

### Breaking Surface Changes

Use the transactional mode when a release removes or renames installed skills
or otherwise changes the public skill surface:

```bash
node scripts/install-local.mjs --breaking
```

The mode keeps the ordinary installer path unchanged and adds these cut-over
guards as one transaction across every discovered skills root:

1. Acquire the global `~/.mono-agent-workflow/install.lock`. The pathname is a
   stable container identified by `protocol.json` as `token-claims-v1`;
   contenders use token-scoped `choosing-<token>.json` and
   `claim-<token>.json` entries with a sequence/tie-break election. Tokens are
   1-128 ASCII alphanumerics/hyphens and equal-sequence claims use ascending
   bytewise ASCII token order; locale collation is forbidden. Release verifies
   the originally published token and sequence, then removes only that exact
   claim, so it can never unlink or rename a newer owner's lock object. Creating
   a missing container still uses
   atomic `mkdir`; an existing empty directory or one without the protocol
   marker is treated as an incomplete/legacy acquisition and fails closed. This
   is the migration handshake with older atomic-directory clients: they cannot
   overlap the token protocol, and must restart on the new pack before another
   mutation. Every mutating installer mode participates, so an ordinary sync
   cannot race a breaking transaction. A stale, malformed, or unreadable
   foreign claim fails closed and remains in place for manual inspection and
   removal. If the owned claim cannot be verified or removed, the transaction
   fails and retains its lock and recovery data instead of reporting success.
2. Scan every product root under
   `~/.mono-agent-workflow/orchestrator/` with the installed A5 quiescence
   contract: `control.json` must be `idle` and `workers.json` must be an empty
   object. `active`, `draining`, a nonempty registry, missing state, or corrupt
   JSON blocks with the exact product-root reason. After the scan, the
   installer atomically moves the complete `orchestrator/` tree aside and puts
   a non-writable directory claim at its canonical pathname. This freezes both
   existing product state and creation of new product roots during staging,
   commit, post-check, or rollback. Before any skills root is staged or changed,
   the installer repeats the A5 quiescence scan against the frozen tree; this
   catches an older, non-cooperating orchestrator that became active between
   the initial scan and the claim. The original tree is atomically restored
   before transaction backups are removed and before the global install lock
   directory is released; a restore failure retains all recovery data and the
   lock for manual recovery.
3. Preflight every discovered skills root before any of them is changed, then
   stage the complete new generated payload beside each root.
4. Move the old generated payload into per-root backups, install the staged
   payload, and run the same full post-check on every root. Any staging,
   mutation, injected failure, or post-check error restores every root already
   touched by the transaction.
5. Remove only retired `mono-*` / previous-brand generated directories that
   are named by the previous lock and carry an installer marker. An unexpected
   generated directory outside that lock blocks the transaction for inspection;
   a user-owned lookalike without the marker is preserved.

`--check` also fails on unexpected generated workflow directories and surplus
or duplicate `installedSkills` lockfile entries. These checks make a partially
retired surface visible even when all expected current skills are present.

For isolated fixtures or sandboxed installations only,
`MONO_WORKFLOW_STATE_ROOT` may point the global lock and orchestrator scan at a
temporary state root; production uses `~/.mono-agent-workflow`.

Breaking mode currently requires POSIX directory rename and permission
semantics and therefore rejects Windows before creating the state root or
changing any install target. Ordinary non-breaking install and `--check`
behavior on Windows are unchanged.

The quiescence scan cannot discover arbitrary IDE or CLI agent sessions that
are open outside the orchestrator registry. After a successful breaking
cut-over, restart all agent sessions before using the new surface. This restart
is a required operational step, not a property the installer can prove; it also
retires any process still using the pre-`protocol.json` lock contract.

`mono-preflight` has one external runtime prerequisite: the agent runtime
must have the `autoreview` skill/helper installed, for example
`~/.codex/skills/autoreview/scripts/autoreview`. This workflow does not vendor `autoreview`; preflight must exit `blocked` when the helper is unavailable.

## Install-Source Verification (Deploy)

When `install-local` runs as a deploy step — delivering a just-merged PR —
the installing checkout's HEAD must equal the expected merge SHA. Compare
`git rev-parse HEAD` against the PR's merge commit before installing.
A mismatch is a DEPLOY BLOCKER, not a warning: resolve the checkout state
first, then install. Precedent (the MONO-3 deploy incident): a foreign
commit on local main made `git pull --ff-only` fail with its output
swallowed, and the pack briefly installed from the wrong source, without
the just-merged contract — caught only via a version anomaly.

Guarded one-liner pattern (verify SHA → install → `--check`). The expected
SHA comes from the PR merge record (`gh`), never from the local checkout —
deriving it locally makes the guard tautological:

```bash
EXPECTED=$(gh pr view <N> --json mergeCommit -q .mergeCommit.oid); [ "$(git rev-parse HEAD)" = "$EXPECTED" ] \
  && node scripts/install-local.mjs --remove-stale \
  && node scripts/install-local.mjs --check
```

If the guard fails, do not install: fetch, inspect the divergence (a
silently failed pull or a foreign local commit are the precedent causes),
bring the checkout to the merge SHA, and rerun the guard.

When the merged release advances `surfaceRevision`, do not use the ordinary
sync in the guarded pattern. After verifying the merge SHA, require orchestrator
quiescence and run `node scripts/install-local.mjs --breaking`; that transaction
performs its own all-root post-check. Restart open agent sessions after the
cut-over.

## Project Config

Create, migrate, or check a project config from this upstream checkout:

```bash
node scripts/project-config.mjs --repo /path/to/project --project-name Zeni --write --clean
node scripts/project-config.mjs --repo /path/to/project --check
node scripts/project-config.mjs --repo /path/to/project --clean --check
```

The project config is JSON:

```json
{
  "schemaVersion": 1,
  "projectName": "Zeni",
  "linearTeam": "Zeni",
  "languages": {
    "linear": "Russian",
    "repo": "English"
  },
  "artifactRoots": [],
  "workflows": {
    "implementation": "compound-engineering:ce-work",
    "ship": "gstack ship",
    "documentation": "gstack document-release",
    "reviewFeedback": "compound-engineering:ce-resolve-pr-feedback",
    "deploy": "gstack land-and-deploy",
    "qa": null
  },
  "prerequisites": {
    "autoreviewHelper": true
  },
  "deployApproval": "always",
  "qaAuth": "cookie-import",
  "orchestration": {
    "transport": "codex-cli",
    "maxParallelWorkers": 3
  }
}
```

Use `null` for optional workflows that are not configured. Use an empty
`artifactRoots` array when no narrow local discovery/review artifact roots
exist.

`--clean` removes legacy generated project installs:

- `.agents/skills/mono-*`
- `.claude/skills/mono-*`
- `.agents/mono-workflow-check.mjs`
- `.agents/mono-workflow.lock.json`
- `.agents/mono-workflow.config.md`
- `.github/workflows/update-mono-workflow.yml`
- `.github/workflows/update-mono-agent-workflow.yml`
- `.agents/linear-workflow.config.json`
- `.agents/linear-workflow.config.md`
- `.agents/linear-workflow-check.mjs`
- `.agents/linear-workflow.lock.json`
- `.agents/skills/linear-*`
- `.claude/skills/linear-*`
- `.github/workflows/update-linear-workflow.yml`
- `.github/workflows/update-linear-agent-workflow.yml`

## Project Policy

Keep project-specific policy in `.agents/mono-workflow.config.json`,
`AGENTS.md`, or supporting repo docs.

The JSON config should record:

- `projectName`: product/repo display name.
- `linearTeam`: Linear team name.
- `languages.linear`: Linear-facing Project, PRD, Tech Spec, Issue, and comment language.
- `languages.repo`: repo docs and code comments language.
- `artifactRoots`: narrow repo-relative or absolute discovery/review artifact roots.
- `workflows.implementation`: implementation workflow for `mono-implement`, or `null`.
- `workflows.ship`: ship workflow for `mono-ship`, or `null` only when ship is intentionally unconfigured.
- `workflows.documentation`: documentation workflow for `mono-ship`, or `null`.
- `workflows.reviewFeedback`: review feedback workflow for `mono-ship`, or `null`.
- `workflows.deploy`: deploy workflow for `mono-deploy`, or `null`.
- `workflows.qa` (optional): the live-sweep instrument for the `mono-deploy` Live QA gate, e.g. an installed browser-automation skill; `null` or absent means the orchestrator uses whatever browser automation the runtime provides.
- `prerequisites.autoreviewHelper`: must be `true`; `mono-preflight` blocks if the helper is unavailable. The workflow passes an explicit Opus 5 model and effort from `references/autoreview-routing.md` instead of inheriting the external helper's default.
- `deployApproval` (optional): deploy approval policy — `"always"` (default), `"risky-only"` (approval required for `standard`, `deep`, and `risky` risk classes; only `tiny` proceeds without asking), or `"never"`.
- `qaAuth` (optional): how the Live QA sweep authenticates — `"cookie-import"`, `"test-account"`, or `"owner-session"`. `"owner-session"` is explicitly marked as involving the owner: the sweep drives the owner's real authenticated session and must never be assumed without asking. `null` or absent means no authenticated sweep is configured; the sweep covers unauthenticated surfaces only.
- `orchestration` (optional): `mono-orchestrate` policy. `transport` — worker transport (`"codex-cli"`, `"claude-code-desktop"`, or `"fallback"`); when absent the orchestrator detects the runtime per `references/orchestration.md`. `maxParallelWorkers` — concurrent worker cap (default 3).
- `issueOnlyLane` (optional): the direct Issue-only lane. `enabled` — boolean opt-in (`false` or absent leaves the lane off). `ownerPrincipal` — the stable Linear user ID authorized to approve issue-only intake; required (non-empty) when `enabled` is `true`. The create-then-approve intake transaction verifies each approval comment's author against this canonical field, and the lane fails closed to Project-first when it is absent.

## Checks

Validate the upstream workflow contract:

```bash
node scripts/validate-workflow.mjs
```

Verify the local skill pack across all installed roots:

```bash
node scripts/install-local.mjs --check
```

Verify a project repo:

```bash
node scripts/project-config.mjs --repo /path/to/project --check
```

The project check fails when:

- `.agents/mono-workflow.config.json` is missing or invalid JSON;
- required config fields are missing;
- any value still contains an unresolved `<...>` placeholder;
- `prerequisites.autoreviewHelper` is not `true`;
- legacy generated workflow project files or updater CI are present.

## Anti-Patterns

- Do not install Mono workflow skills into a project repo.
- Do not create `.claude/skills/mono-*` wrappers in a project repo.
- Do not keep `.agents/mono-workflow-check.mjs` or `.agents/mono-workflow.lock.json` in a project repo.
- Do not keep `.github/workflows/update-mono-workflow.yml` in a project repo.
- Do not keep `.github/workflows/update-mono-agent-workflow.yml` in a project repo.
- Do not hand-edit local generated skills under any installed skills root (`~/.codex/skills/mono-*`, `~/.claude/skills/mono-*`); edit this upstream repo and rerun `scripts/install-local.mjs`.
- Do not update only one skills root with `--skills-root` on a machine with several installed roots; the default `--all-roots` run keeps every root on the same version.
- Do not let `mono-review` mutate Linear artifacts; accepted fixes belong to `mono-handoff`, explicit atomic skills, or `mono-ship`.
- Do not let `mono-handoff` move the Project to Delivery; Delivery Start belongs to `mono-implement`.
- Do not let `mono-preflight` run pre-ship review/check or create/land the final PR by default; those belong to `mono-ship`.
- Do not let `mono-ship` merge, deploy, run post-ship checks, close Linear as shipped, or record deploy learnings; those belong to `mono-deploy`.
- Do not keep `Land workflow`; use `workflows.deploy`.
- Do not make Project Updates a required gate; record user review acceptance as a Linear comment.
- Do not turn the project update `mono-deploy` publishes at closeout into a gate: it is an informational result of the deploy, and its failure never blocks closeout or changes the deploy verdict.
