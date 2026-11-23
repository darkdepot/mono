# Plugin Installation and Compatibility

## Design tools (MONO-319)

Connect Paper and/or Wonder to the session that runs `mono:design`; verify the
selected tool is visible after starting a fresh session. Owner words for this
task override product `design.tool`, otherwise the default is `paper`. Missing
selected tool stops with a reason and a spoken offer of the alternative.
Rebuild stage-agent exact allowlists for available tools of both instruments;
restart the orchestrator session before launching the updated definitions.

The stage reads only the selected instrument's reference, uses its sandbox file
and a page per task, and stores sandbox links as service lines in product design
memory. Switching either way redraws from screenshots and preserves old versions;
a switch after approval needs a new round and approval. Wonder feedback arrives
in the stage session with consent before taste rules are stored. Its built-in
chat may lead the stage only when Mono and Linear are visible there.

Wonder PNGs come from the client-saved full screenshot or a locally rendered
artboard with its context tokens, file fonts and root fill. The agent compares
the rendering with the Wonder screenshot; mismatch stops approval. Whole screens,
Codex file capture and built-in chat remain for the first live task after release.
The scenario harness stays on Paper; `paper.fileIds` explicitly lists allowed test
files, sandbox first. Do not use an owner file or add Wonder to this harness.

## Source Of Truth

Install from the GitHub marketplace repository `darkdepot/mono`, never a local
folder. The version cache is `packRoot`; the marketplace clone is
not. The plugin has the repository layout: `skills/`, `references/`, `templates/`,
`scripts/`, `hooks/`, `AGENTS.md`, `VERSION`.

## Plugin Updates

The Mono session installs a merged, tagged release `v<VERSION>` in every place:
each Claude Code profile and Codex.

1. Claude Code, in each profile (another profile via `CLAUDE_CONFIG_DIR`, with
   `--scope user` and `--scope project` where both are installed):
   `claude plugin marketplace update mono-marketplace`, then
   `claude plugin update mono@mono-marketplace`.
2. Codex: `codex plugin marketplace remove mono-marketplace`,
   `codex plugin marketplace add darkdepot/mono --ref v<VERSION>`, then
   `codex plugin add mono@mono-marketplace`.
3. Compare each place's version cache with `git archive v<VERSION>`: every path,
   type, mode and content must match. Allowed extras are only tool service
   objects: Claude's `.in_use/`, Codex's `.git/` and `.codex-marketplace-install.json`.
4. Fresh run in each host: `claude -p` and `codex exec` must load a Mono skill
   from the new version folder. Running sessions keep old rules until restarted.

A mismatch or failed fresh run means the place is not installed: repeat the
commands, or report it with the reason. Deploy's `packResult` lists each place
([Pack](../skills/deploy/references/pack.md)).

An optional installer automates the same steps with holders, pauses and rollback; nobody uses it now:
`node scripts/pack-install.mjs --root DIR --repo DIR --tag v<VERSION> --config FILE`
(`--wave`, `--profile`, `--remove-place`, `--watcher-config`, `--breaking`; see `--help`).

## Compatibility

Identity is `packVersion` from `VERSION`, positive integer `surfaceRevision` from
`scripts/runtime.mjs`, and optional 40-hex `sourceCommit`. Revision 6 moves Linear writes to the worker; old attempts cannot resume on it.
Start/resume accepts equal `surfaceRevision`; other version/commit values are
descriptive. Report/task correlation remains strict for every present identity
field. Resolve scripts and policy from the task's saved pack folder. If that
folder is gone or the format differs, refuse with **start a new attempt**; never
redirect the task to new files. Protect both roots from worker writes.

## Quiescence

An incompatible update requires stopped launches and each product's own
orchestrator confirming `control.state=idle` and empty `workers.json` with
`scripts/verify-pack-state.mjs quiescence --root /path/to/own/product-state`.
Include paused attempts: retain their branches, pending writes and evidence, then
retire them through their product orchestrator; continue only with a new attempt.
Each product confirms its own quiescence; never edit another product state.
Rollback installs the previous version under this same incompatible-update rule.
Missing/corrupt state, active/draining control or any attempt blocks. Restart
sessions after cut-over. Ordinary compatible updates use the folder condition
above; they do not require machine-wide quiescence.

## Install-Source Verification (Deploy)

Verify the expected GitHub merge SHA for per-merge, or T and every task's merge
ancestry for the optional wave-drain path, from its matching main checkout. A mismatch is a deploy
blocker. The checkout verifies Git objects; GitHub is the plugin copy source.

### Wave Installation Source

Optional wave path, not used now. Apply [Landing Install](landing.md#install): halt, retain landed/stopped records,
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
together with matching cache trees. [Migration](../HANDBOOK.md#migrate-from-the-local-installer)
and [plugin live proof](landing.md#plugin-installation-proof) own their boundaries.

## Project Config Contract

Product repos keep only `.agents/mono-workflow.config.json`; never vendor skill
bodies, wrappers, workflow lockfiles, checkers or updater CI. Use
`scripts/project-config.mjs --repo /path/to/product --write --clean` for config
migration and `--check` for shape, required fields, placeholders and forbidden files.
Config fields/policies: [handbook](../HANDBOOK.md#project-config). Use null for absent
workflows; absent deploy blocks. `workflows.deploy` has no Land alias.

## Project Policy

The review round is mandatory: the collector host needs both review CLIs
logged in. The round runs [role:code-review](model-policy.md#roles) and
[role:code-review-checker](model-policy.md#roles), pinned at launch from BASE config. Optional
`"orchestration"` selects transport/concurrency; model routes come from BASE config.

Transport `claude-cli` additionally requires the Claude Code CLI installed on the
machine and a completed native Anthropic subscription login, positively confirmed
before each launch; provider keys and address overrides are refused and CLI versions
are not checked. A missing tool or login refuses the launch with the required action.
Codex remains required under every transport because review collection runs in its
sandbox.

## Release Policy

Use SemVer; pre-1.0 breaking minors require clear release notes. Plugin versions
equal `VERSION`; only release tasks change them. Try unreleased code per the [handbook](../HANDBOOK.md#install-or-update-a-release).
