# Versioning And Install Contract

This repository has one canonical workflow source, one local skill pack
contract, and one project config contract.

Canonical workflow truth lives in:

- `skills/mono-*/SKILL.md`
- `references/*`
- `templates/*`
- `scripts/install-local.mjs`
- `scripts/project-config.mjs`

## Local Skill Pack Contract

Use `scripts/install-local.mjs` for installs and updates:

```bash
node scripts/install-local.mjs --remove-stale
node scripts/install-local.mjs --check
```

The default `--all-roots` mode discovers every installed skills root by
checking for `.mono-agent-workflow.lock.json` in the known roots
(`~/.codex/skills`, `~/.claude/skills`, and any root recorded in a discovered
lockfile) and syncs or checks each of them in one run, reporting the per-root
installed version. On a fresh machine it falls back to `~/.codex/skills`.

The install writes local runtime files into each installed skills root:

- `mono-*/SKILL.md` as executable generated local skill bodies;
- `mono-*/AGENTS.md` beside each generated local skill;
- `mono-*/references/*` and `mono-*/templates/*` beside each generated local skill;
- `.mono-agent-workflow.lock.json` with upstream identity, version, commit, dirty flag, installed skill paths/hashes, and copied asset hashes.

The lockfile also exposes the canonical dispatch identity: `packVersion`,
`sourceCommit`, and positive integer `surfaceRevision`. Surface revision `3`
identifies the current 10-skill surface; later breaking surface migrations must
advance it explicitly rather than deriving it from directory count.

Opening `<skills-root>/<name>/SKILL.md` must be enough for the agent runtime
to follow the skill. Project repos must not carry workflow execution logic.

## Local Lockfile

The local lockfile pins:

- upstream repository name;
- upstream version from `VERSION`;
- immutable 40-character upstream commit SHA;
- whether the upstream checkout was dirty when generated;
- install timestamp;
- skills root;
- generated local skill paths and hashes;
- copied `AGENTS.md`, `references/`, and `templates/` hashes;
- pack-private workflow runtime script paths and hashes (`runtimeScripts`).

Example shape:

```json
{
  "schemaVersion": 3,
  "packVersion": "0.20.1",
  "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
  "surfaceRevision": 3,
  "upstreamRepo": "darkdepot/mono",
  "upstreamVersion": "0.20.1",
  "upstreamCommit": "0123456789abcdef0123456789abcdef01234567",
  "upstreamDirty": false,
  "installedAt": "2026-06-10T00:00:00.000Z",
  "skillsRoot": "$HOME/.codex/skills",
  "assets": {
    "agents": "...",
    "references": [{ "path": "artifact-quality.md", "sha256": "..." }],
    "templates": [{ "path": "prd.md", "sha256": "..." }]
  },
  "runtimeScripts": [
    { "path": ".mono-agent-workflow/scripts/resolve-issue-context.mjs", "sha256": "..." },
    { "path": ".mono-agent-workflow/scripts/verify-pack-state.mjs", "sha256": "..." },
    { "path": ".mono-agent-workflow/scripts/watch-workers.mjs", "sha256": "..." }
  ],
  "installedSkills": [
    {
      "name": "mono-check",
      "path": "mono-check/SKILL.md",
      "sha256": "..."
    }
  ]
}
```

`installedAt` changes on every install. Treat `upstreamCommit`,
`upstreamVersion`, generated body hashes, and copied asset hashes as the
meaningful release metadata.

Before starting or resuming a worker stage, compare its dispatch triplet to the
installed lock with `verify-pack-state.mjs identity`. Any `packVersion`,
`sourceCommit`, or `surfaceRevision` mismatch blocks the stage. The helper's
`quiescence` mode accepts only `control.json` in `idle` state plus an empty
`workers.json`; A5 publishes this probe without adding the breaking installer
mode owned by A6.

## Project Config Contract

Project-specific workflow choices live in `.agents/mono-workflow.config.json`.

Required fields:

- `projectName`: product/repo display name.
- `linearTeam`: Linear team name.
- `languages.linear`: Linear-facing Project, PRD, Tech Spec, Issue, and comment language.
- `languages.repo`: repo docs and code comments language.
- `artifactRoots`: array of narrow repo-relative or absolute artifact roots. Use `[]` when none exist.
- `workflows`: object with `implementation`, `ship`, `documentation`, `reviewFeedback`, and `deploy`.
- `prerequisites.autoreviewHelper`: must be `true`.
- `deployApproval` (optional): deploy approval policy — `"always"` (default), `"risky-only"` (approval required for `standard`, `deep`, and `risky` risk classes; only `tiny` proceeds without asking), or `"never"`. When absent, the effective value is `"always"`.

Workflow fields:

- `Implementation workflow`: starts and runs implementation from approved Linear Issue(s) when a project wants a fixed engine.
- `Ship workflow`: creates/syncs the branch or PR through the project repo's normal ship command.
- `Documentation workflow`: updates repo documentation after PR creation and before final PR green certification.
- `Review feedback workflow`: resolves actionable PR review feedback, such as Greptile comments.
- `Deploy workflow`: merges and verifies/deploys the PR after `mono-ship` records a green certificate.
- `Autoreview helper`: records the external `autoreview` skill/helper prerequisite required by `mono-preflight`.
- `Artifact roots`: names narrow local discovery/review artifact roots.

Use `null` for optional workflows that are not configured. When
`workflows.implementation` is `null`, `mono-implement` uses the documented
default selection table. When `workflows.documentation` is `null`,
`mono-ship` skips repo documentation sync and says so. When
`workflows.reviewFeedback` is `null`, `mono-ship` waits for checks/reviews
once and stops if actionable feedback appears. When `workflows.deploy` is
`null`, `mono-deploy` stops with a clear blocked report instead of inventing
a merge/deploy path.

`Autoreview helper` is required, not optional. When
`prerequisites.autoreviewHelper` is missing or not `true`, project config
checks fail. When the field is present but the helper is unavailable in the
agent runtime, `mono-preflight` stops `blocked` instead of replacing the
review gate.

The helper remains external and independently updateable. Model selection is
therefore owned by this workflow: `mono-preflight` passes the explicit
GPT-5.6 model and reasoning effort defined in
`references/autoreview-routing.md` for the final risk class. Project config
does not duplicate this technical routing table.

Example Zeni project config:

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
    "deploy": "gstack land-and-deploy"
  },
  "prerequisites": {
    "autoreviewHelper": true
  },
  "deployApproval": "always"
}
```

`Land workflow` is not a supported compatibility alias. Projects must use
`workflows.deploy`.

Every placeholder value in `.agents/mono-workflow.config.json` must be
resolved before the project config is ready.

## Updates

Workflow updates are local:

1. Update this upstream checkout to the desired version/commit.
2. Run `node scripts/install-local.mjs --remove-stale` (default `--all-roots` mode updates every installed skills root).
3. Run `node scripts/install-local.mjs --check`.
4. Use `node scripts/project-config.mjs --repo /path/to/project --check` only to verify project-specific config and absence of legacy vendored workflow files.

Project migrations are config-only:

1. Start a normal branch in the project repo when the project repo needs a committed config cleanup.
2. Run `node scripts/project-config.mjs --repo /path/to/project --project-name <Name> --write --clean`.
3. Review the JSON config and removed legacy workflow files.
4. Run `node scripts/project-config.mjs --repo /path/to/project --check`.
5. Land the project PR.

## Checks

`node scripts/install-local.mjs --check` verifies, for every installed skills
root:

- each expected local `<skills-root>/mono-*` skill exists;
- installed skill contents match the current upstream-generated body;
- copied `AGENTS.md`, `references/`, and `templates/` match the upstream checkout;
- `.mono-agent-workflow.lock.json` has matching paths, SHA-256 hashes, and upstream version/commit.

`node scripts/project-config.mjs --repo /path/to/project --check` verifies:

- `.agents/mono-workflow.config.json` exists and is valid JSON;
- required fields are present and have the expected JSON shape;
- no unresolved `<...>` placeholders remain;
- `prerequisites.autoreviewHelper` is `true`;
- legacy generated workflow project files and updater CI are absent.

`mono-check` may report project config status, but local skill install,
update, stale detection, and project cleanup belong to `scripts/install-local.mjs`
and `scripts/project-config.mjs`.

## Release Policy

Use SemVer tags for workflow releases.

- Patch: documentation, generated text, or validation changes that do not alter workflow behavior or install/config contracts.
- Minor: new skills, new optional project config fields, new checks, or backward-compatible workflow additions.
- Major: removed skills, incompatible lockfile schema, required project config changes, or workflow changes that alter required Linear artifact semantics.

Before `v1.0.0`, breaking changes are allowed in minor releases only when the
changelog and release notes call them out clearly.
