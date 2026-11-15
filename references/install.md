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

Run the released pack installer from a verified checkout with the release tag
available locally. The tag must point at the verified landing tip T; ordinary
merged tasks wait for the wave's release task. Installation always comes from
GitHub marketplace `darkdepot/mono`.

```bash
node scripts/pack-install.mjs --root /path/to/pack-state --repo /path/to/verified/checkout --tag v<VERSION> --config /path/to/product/.agents/mono-workflow.config.json --wave
```

The installing Mono session owns this command. Manual “выпусти” uses the same
command without `--wave`; wave mode performs `landing-drain verify` → installation
→ `close`. It never closes a wave after rollback or a failed check.

For a first installation the command creates its own `--root` if needed. Missing
`control.json` means `{"state":"idle"}` and missing `workers.json` means `{}`;
these defaults are saved atomically under the install/launch locks and read back.
Existing files are preserved, and corrupt state stops the command. Missing or
corrupt state in another product stops installation; it is never bootstrapped.
Use a dedicated pack-state directory directly under the products directory.

All `~/.claude*` profiles with `mono@mono-marketplace` are discovered, alongside
`~/.claude`, the current `CODEX_HOME` (default `~/.codex`) and places retained
from the previous installation record. Repeat `--profile /path/to/profile` for
additional Claude profiles. A disappeared remembered place stops installation;
only explicit `--remove-place /path/to/profile` retires it from this and subsequent runs. The
immutable first record retains its previous version for recovery.

The installer holds launch locks across product registries, calls
`updateBlockers` for replaced folders and reports live, dead and unknown holders
with product and Issue. Live/unknown holders yield `waiting` without installation.
Dead records are named and never removed. Live Codex processes using its outgoing
folder also wait. An ordinary Codex session in a product folder is an unknown
holder unless its exclusion from the updated home is proven; the installer does
not overwrite its cache. Use `--breaking` for an incompatible release: every product
must pass `verifyQuiescence`, including before rollback. The installing wave
retains its provenance: only records proven landed and stopped by `attemptState`
are excluded from its active-worker view. Paused/unproven attempts still block;
other product registries must be empty, and all controls must be idle.

Before replacement, `landing/install/<tag>.json` records every place's previous
version/commit and `control.json.pre-update-<version>` saves the original control.
Both are written once and read back. Retry retains them even after an interruption
with `halt` already set. Once an installation completes, the same tag can add
explicit or newly discovered Claude profiles and a changed `CODEX_HOME`. Their
first recovery state is appended before replacement to numbered JSON records in
`landing/install/<tag>.places/`; the original record, prior extensions and control
snapshot are never overwritten. Added places remain remembered across retries
and future releases. An unfinished installation must be resumed before adding
further places. An archived wave is closed idempotently before these additional
places are installed. Only places whose proof differs are installed again.
Intent and result read-backs live beside the record in `<tag>.progress.json`.
A pause intent is saved before `halt`; only an unfinished pause restores its saved
control. Repeating an already completed installation preserves current owner
control changes. A wave interrupted after `close` observes its archive and replays
the idempotent close only while all installed places still match, before checking
quiescence so the pending/archive overlap is settled canonically. Dead pending
and current-tip guard locks are reclaimed only after the entire holder group is
proven stopped; live or unverified locks are preserved. Worker records are never
removed by this recovery.

Claude permanently pins the same `ref` in `settings.json` /
`extraKnownMarketplaces` and `plugins/known_marketplaces.json`, with atomic file
replacement and paired read-back before any CLI update. One-sided pinning breaks
the catalog; catalog refusal restores both preceding records. Session-start
`autoUpdate` behavior is unverified, so automatic updates stay disabled.
Downgrade uses marketplace update + plugin update, without uninstall/reinstall.
A same-version plugin update may be a no-op: a corrupt tree that still differs
after retry triggers rollback, or `stopped` if no previous release can be restored.
Codex registers the release with `marketplace add --ref` and `plugin add`.

Each managed place is checked by installed version, tag commit and complete Git
tree (paths, types, executable modes, content hashes and symlink targets).
Only tool service objects absent from the release are excluded: Claude's
`.in_use/`, Codex's `.git/` and `.codex-marketplace-install.json`; the latter
must contain the expected `revision`. Codex's persistent config `ref` is checked.
A fresh session in each profile must find `mono:ship` in the verified folder.
A mismatch after one retry, missing fresh-session skill, or failed new watcher restores every place's
recorded previous tag and verifies again. A clean place with no preceding release
has no rollback target; failed initial installation is reported as `stopped`.

Before removing the pause, the installer restarts each product's watcher from
the verified installed folder and observes each fresh `watcher.json` pulse.
The pack product uses `--config`; other products use their recorded worker config,
or explicit repeated `--watcher-config /path/to/product-state=/path/to/config.json`.
Missing or ambiguous config stops before installation. Every caught failure
restores the original `control.json`; other products' controls, registries,
configs and local plugin copies are never rewritten. `mono@mono-dev` and foreign
`projectPath` copies are listed for their owning product sessions.

The CLI runs in a dedicated process group and waits in the caller, so crash
recovery does not confuse a live caller with installer descendants. The watcher
PID/start identity is validated before signalling. The final restart inventory
also includes sessions started during installation.

Stdout is one JSON line: `outcome` is `installed`, `rolled-back`, `waiting` or
`stopped`; `places` names expected/actual versions and proof, `holders` names
blocking and dead records, `restart` lists Claude/Codex sessions with product
folders, and `localCopies` names separate copies. Exit codes: 0 installed,
2 waiting, 1 rollback or failure. Restart the named sessions; loaded rules do
not change in an already running session. The JSON is evidence, not a claim that
those owner sessions have restarted.

## Compatibility

Identity is `packVersion` from `VERSION`, positive integer `surfaceRevision` from
`scripts/runtime.mjs`, and optional 40-hex `sourceCommit`. Revision 5 changes code-report confirmation; old attempts cannot resume on it.
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
