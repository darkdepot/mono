# Plugin Installation and Compatibility

## Source Of Truth

Install from the GitHub marketplace repository `darkdepot/mono`, never a local
folder. The version cache is `packRoot`; the marketplace clone is
not. The plugin has the repository layout: `skills/`, `references/`, `templates/`,
`scripts/`, `AGENTS.md`, `VERSION`.

## Plugin Updates

Only the installing orchestrator registers or updates the shared marketplace.
Disable automatic updates. Install/update deliberately after a release task,
when GitHub main equals the verified landing tip T. Without a new release, do
not install a wave: unchanged version metadata cannot prove its bytes released.

Initial installation (replace `<VERSION>` with `VERSION` at T):

```bash
claude plugin marketplace add darkdepot/mono
claude plugin install mono@mono-marketplace
codex plugin marketplace add darkdepot/mono --ref v<VERSION>
codex plugin add mono@mono-marketplace
```

Claude keeps the marketplace on main; refresh it before updating the plugin:

```bash
claude plugin marketplace update mono-marketplace
claude plugin update mono@mono-marketplace
```

Codex has no marketplace-update command. Remove its clone (the cache remains),
register the new tag, then install:

```bash
codex plugin marketplace remove mono-marketplace
codex plugin marketplace add darkdepot/mono --ref v<VERSION>
codex plugin add mono@mono-marketplace
```

Before **every** command deleting or overwriting a version folder, pause launches
in every affected product and check the actual replaced folder across all products:

```bash
node '<pack-root>/scripts/verify-pack-state.mjs' before-update --folder /path/to/replaced/mono
```

Keep launches paused through check/replacement. A refusal names product, Issue,
attempt: wait until all named attempts, including paused ones, are landed and
stopped. Never remove records to evade this read-only check. Entries with no
`packRoot` are reported unknown. Each product's orchestrator owns its state.
Claude puts new versions beside old ones and does not copy an unchanged version.
Codex deletes the previous folder; same-version reinstall overwrites in place,
so it needs the condition too. Tasks keep their original absolute `packRoot`.

Immediately after each install/update compare **each tool's version cache** with
T's Git tree: paths, types, executable modes, content object hashes and symlink
targets; no changed, missing or extra files. Only Codex's administrative `.git`
directory may be extra; the pack does not read it. Do not substitute clone proof.
Any mismatch blocks wave close, removing launch halts and starting tasks from
the new installation. Record/correct the source, then repeat the full comparison
and version/tag proof of **both** tools. Accept proof only when both match.

## Compatibility

Identity is `packVersion` from `VERSION`, positive integer `surfaceRevision` from
`scripts/runtime.mjs`, and optional 40-hex `sourceCommit`. Revision 4 is unchanged.
Start/resume accepts equal `surfaceRevision`; other version/commit values are
descriptive. Report/task correlation remains strict for every present identity
field. Resolve scripts and policy from the task's saved pack folder. If that
folder is gone or the format differs, refuse with **start a new attempt**; never
redirect the task to new files. External `autoreview` stays in separate `skillsRoot`; protect
both roots and the helper's real path from worker writes.

## Quiescence

An incompatible update requires stopped launches and each product's own
orchestrator confirming `control.state=idle` and empty `workers.json` with
`scripts/verify-pack-state.mjs quiescence --root /path/to/own/product-state`.
Missing/corrupt state, active/draining control or any attempt blocks. Restart
sessions after cut-over. Ordinary compatible updates use the folder condition
above; they do not require machine-wide quiescence.

## Install-Source Verification (Deploy)

Verify the expected GitHub merge SHA for per-merge, or T and every task's merge
ancestry for wave-drain, from its matching main checkout. A mismatch is a deploy
blocker. The checkout verifies Git objects; GitHub is the plugin copy source.

### Wave Installation Source

Apply [Landing Install](landing.md#install): halt, retain landed/stopped records,
verify T/ancestry/validation, install released plugin, verify both tools, close,
then release halts. A changed GitHub tip requires matching checkout and complete
verification again. Record both installed folders/versions, T, tag target and
each `{issue, attempt, pr, mergeSha, installSha}`. Read the installed version:

```bash
node /path/to/installed/mono/scripts/verify-pack-state.mjs version
git show "$T:VERSION"
git rev-parse "v$(git show "$T:VERSION")^{commit}"
```

Both tools' versions must equal `VERSION` at T and the tag must resolve to T,
together with matching cache trees. [Migration](../README.md#migrate-from-the-local-installer)
and [plugin live proof](landing.md#plugin-installation-proof) own their boundaries.

## Project Config Contract

Product repos keep only `.agents/mono-workflow.config.json`; never vendor skill
bodies, wrappers, workflow lockfiles, checkers or updater CI. Use
`scripts/project-config.mjs --repo /path/to/product --write --clean` for config
migration and `--check` for shape, required fields, placeholders and forbidden files.
Config fields/policies: [README](../README.md#project-config). Use null for absent
workflows; absent deploy blocks. `workflows.deploy` has no Land alias.

## Project Policy

External review is mandatory: missing helper blocks preflight. Pass the explicit
[role:autoreview](model-policy.md#roles) model and effort from
`references/autoreview-routing.md`; never inherit helper defaults. Optional
`"orchestration"` selects transport/concurrency; model routes come from BASE config.

## Release Policy

Use SemVer; pre-1.0 breaking minors require clear release notes. Plugin versions
equal `VERSION`; only release tasks change them. Try unreleased code per README.
