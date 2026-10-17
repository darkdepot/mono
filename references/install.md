# Plugin Installation and Compatibility

## Source Of Truth

Install from the GitHub marketplace repository `darkdepot/mono`, never a local
folder. The version cache is `packRoot`; the marketplace clone is
not. The plugin has the repository layout: `skills/`, `references/`, `templates/`,
`scripts/`, `AGENTS.md`, `VERSION`.

## Plugin Updates

This procedure is for machines running an orchestrator; user machines follow
[Users without an orchestrator](../README.md#users-without-an-orchestrator).

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

Codex has `codex plugin marketplace upgrade`, but it keeps a tag-pinned
marketplace on the same tag. On the orchestrator machine, remove its clone
(the cache remains), register the new release tag, then install:

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

Immediately after each install/update:

Compare each tool's version cache with T's Git tree: paths, types, executable
modes, content object hashes and symlink targets must match. Only extra service
objects at these exact paths relative to the version-folder root are allowed:
Codex directory `.git/` and regular file `.codex-marketplace-install.json`;
Claude Code directory `.in_use/`. These tool-specific exceptions never exclude
released files from comparison. The Codex file must be valid JSON with `revision`
equal to the full tag commit; invalid JSON, absent/different revision or another
object type fails. Every other extra, missing or changed object fails. Do not
substitute clone proof.
Any mismatch blocks wave close, removing launch halts and starting tasks from
the new installation. Record/correct the source, then repeat the full comparison
and version/tag proof of **both** tools. Accept proof only when both match.

After installation and cache verification, stop the previous watcher and restart
it **from the newly installed version before the first worker launch or resume**
in each product. Its own orchestrator runs the watcher as a tracked background
process, using that product's absolute config path:

```bash
node '<new-pack-root>/scripts/watch-workers.mjs' --root /path/to/own/product-state --config /path/to/product/.agents/mono-workflow.config.json
```

Observe a fresh `watcher.json` pulse from that process. Keep launch halts until
verification and watcher restart finish; `watcher-required` names the start
command if the pulse is absent, stale or does not match a live process.

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

## External Autoreview Helper

Source: [openclaw/agent-skills, skills/autoreview](https://github.com/openclaw/agent-skills/tree/05d42d1fe0a76d00e339d7b80d248c27b0ea34d9/skills/autoreview).
Verified upstream main on 2026-10-15: commit
`05d42d1fe0a76d00e339d7b80d248c27b0ea34d9`; helper SHA-256
`73ea6d7835a50c5348a52571f648be70cdd026a07139e7701237b0fec8a9cd80`.
The helper is an external prerequisite, never vendored in Mono. The installing
orchestrator updates it at release, after affected attempts stop; workers do not.
Use a fresh source checkout and set `skills_root` to the external directory passed
as `--skills-root` (normally `$HOME/.codex/skills`):

```bash
git clone https://github.com/openclaw/agent-skills.git /path/to/fresh/agent-skills
git -C /path/to/fresh/agent-skills checkout --detach 05d42d1fe0a76d00e339d7b80d248c27b0ea34d9
rsync -a --delete /path/to/fresh/agent-skills/skills/autoreview/ "$skills_root/autoreview/"
diff -r /path/to/fresh/agent-skills/skills/autoreview "$skills_root/autoreview"
"$skills_root/autoreview/scripts/autoreview" --version
"$skills_root/autoreview/scripts/autoreview" --help
```

Require a matching tree and `autoreview source-sha256:` followed by the hash above.
Use Python 3; install the selected engine CLI and its native authentication.
The gate still binds the installed helper digest to each receipt. A new upstream
version needs renewed output-fixture proof before updating this pin. The named
`collection-helper-*` tests replay its `status.json`/`review.json` for clean and
findings outcomes, including approved/revoked declines:
`node --test --test-name-pattern='named collection fixtures' scripts/gate.test.mjs`.

## Project Policy

External review is mandatory: missing helper blocks preflight. Pass the explicit
[role:autoreview](model-policy.md#roles) model and effort from
`references/autoreview-routing.md`; never inherit helper defaults. Optional
`"orchestration"` selects transport/concurrency; model routes come from BASE config.

Transport `claude-cli` additionally requires the Claude Code CLI installed on the
machine and a completed native Anthropic subscription login, positively confirmed
before each launch; provider keys and address overrides are refused and CLI versions
are not checked. A missing tool or login refuses the launch with the required action.
Codex remains required under every transport because review collection runs in its
sandbox.

## Release Policy

Use SemVer; pre-1.0 breaking minors require clear release notes. Plugin versions
equal `VERSION`; only release tasks change them. Try unreleased code per README.

### Release 0.32.1

Проверка записи «да» включена с отсечкой `2026-10-18` (00:00 UTC).
Запуск работы и сертификат требуют корректную запись этого проекта. Без записи
`legacy-before-cutoff` доступен, только если проект создан и пакет одобрен строго
до этой даты. Старый проект в подготовке пакета получает `legacy-migrate` только
в режиме `fresh`; запись идеи добавляется вместе с одобрением пакета, до запуска.
`ideaGate.since` в конфиге продукта переопределяет дату: сдвиг вперёд временно
откладывает правило, но не меняет пины и receipt; нужна новая попытка.

Раскатка при живых попытках сохраняет порядок 0.32.0: каждая старая попытка
завершается на сохранённом абсолютном `packRoot`. Перед любой заменой каталога
выполните `before-update` для заменяемого пути по всем продуктам, удерживая паузу
запусков до конца замены; отказ блокирует её. Новый пакет можно подготовить рядом,
сохранив старый каталог. Если старого каталога нет, запускайте новую попытку.
Совместимое чтение старых receipt не переносит попытку на новый пакет.
Установка и проверка обоих кэшей выполняются по Plugin Updates; после установки
каждый оркестратор перезапускает watcher из новой версии и проверяет свежий pulse.

`models.roles.scout` добавляйте только после установки 0.32.1 во всех затронутых
продуктах и хостах: старый пакет отвергает эту роль. До этого используйте штатные
значения роли нового пакета без переопределения конфига. Роль `idea-helper`
сохранена; удаление — отдельная задача после 0.34.0.
Установка и живая приёмка поведения Idea — после вливания, их выполняет оркестратор.
Следующий этап — Research; пока `mono:research` не установлен — `mono:handoff`.

### Roll Back To 0.32.0

Откат ведёт устанавливающий оркестратор. Приостановите запуски и сборы во всех
затронутых продуктах; завершите и остановите попытки исходящей версии, включая
приостановленные. Сохраните полные конфиги, записи решений, receipt/history,
ключ receipt, снимки, все версии пинов, отчёты и подтверждения с хешами.
Записи «да» в Linear остаются безвредными комментариями.

Сохраните и удалите `models.roles.scout` из **всех** затронутых конфигов.
Проверьте `validateModels(config)` из `scripts/runtime.mjs` проверенного пакета
0.32.0 на JSON каждого фактического конфига после удаления переопределения.
CLI `runtime.mjs --base` читает конфиг из коммита и не проверяет незакоммиченное
удаление. Если старого пакета нет, сначала подготовьте закреплённую версию
в отдельном профиле/кэше и выполните проверку там. Ошибка блокирует откат.
`idea-helper` для этого отката удалять не требуется: роль есть в 0.32.0.
Если в конфиге задан `ideaGate.since`, он сохранит приоритет и в 0.32.0;
для возврата к выключенной проверке сохраните и уберите это переопределение
либо явно сдвиньте дату вперёд перед новыми попытками.

Выберите именно тег `v0.32.0` из GitHub marketplace, **не текущий main**.
Отключите автоматические обновления. Перед каждой заменой кэша выполните
`before-update` по всем продуктам. В чистых отдельных профилях:

```bash
claude plugin marketplace add 'https://github.com/darkdepot/mono.git#v0.32.0'
claude plugin install mono@mono-marketplace
codex plugin marketplace add darkdepot/mono --ref v0.32.0
codex plugin add mono@mono-marketplace
```

Для существующего Codex marketplace удалите регистрацию и добавьте тег по
Plugin Updates, предварительно защитив заменяемый каталог через `before-update`.
Сверьте оба установленных кэша с Git-деревом тега по путям, типам, режимам,
хешам и ссылкам; обе версии должны быть `0.32.0`. Перепроверьте сохранённые хеши
данных. Перезапустите watcher каждого продукта из проверенного пакета 0.32.0
и подтвердите свежий pulse перед снятием паузы. Новые попытки получают новые
пины 0.32.0; старые попытки и сертификаты на новый пакет не перенаправляются.

### Roll Back To 0.31.1

Откат ведёт устанавливающий оркестратор. Приостановите запуски и сборы во всех
затронутых продуктах; завершите и остановите попытки исходящей версии, включая
приостановленные. Сохраните полные конфиги, записи решений, receipt/history,
ключ receipt, снимки, все версии пинов, отчёты и подтверждения с хешами.
Записи «да» в Linear остаются безвредными комментариями.

Сохраните и удалите `models.roles.idea-helper` из **всех** затронутых конфигов.
До активации отката проверьте разрешение штатных ролей сохранённым проверенным
пакетом 0.31.1 на каждом фактическом конфиге после удаления переопределения.
Его экспорт `validateModels(config)` из `scripts/runtime.mjs` проверяет все роли
и возвращает их маршруты; передайте ему JSON именно изменённого файла.
CLI `runtime.mjs --base` читает конфиг из коммита и не проверяет незакоммиченное
удаление. Если старого пакета нет, сначала подготовьте закреплённую версию
в отдельном профиле/кэше и выполните проверку там. Ошибка блокирует откат.

Выберите именно тег `v0.31.1` из GitHub marketplace, **не текущий main**.
Отключите автоматические обновления. Перед каждой заменой кэша выполните
`before-update` по всем продуктам. В чистых отдельных профилях:

```bash
claude plugin marketplace add 'https://github.com/darkdepot/mono.git#v0.31.1'
claude plugin install mono@mono-marketplace
codex plugin marketplace add darkdepot/mono --ref v0.31.1
codex plugin add mono@mono-marketplace
```

Для существующего Codex marketplace удалите регистрацию и добавьте тег по
Plugin Updates, предварительно защитив заменяемый каталог через `before-update`.
Сверьте оба установленных кэша с Git-деревом тега по путям, типам, режимам,
хешам и ссылкам; обе версии должны быть `0.31.1`. Перепроверьте сохранённые хеши
данных. Перезапустите watcher каждого продукта из проверенного пакета 0.31.1
и подтвердите свежий pulse перед снятием паузы. Новые попытки получают новые
пины 0.31.1; старые попытки и сертификаты на новый пакет не перенаправляются.

0.31.0 is a breaking minor because a live watcher is now required for launch and
resume; activate it using cross-product quiescence. Decision journals, signed
receipts and surface revision 4 remain compatible with 0.30.1. The new
`watcher.json` and collection retry files are optional to 0.30.1 and are ignored
there. Stage a new cache beside an open attempt only without replacing its
pinned folder or activating the incompatible release; the attempt finishes with
its saved `packRoot`. Each product's own orchestrator establishes quiescence;
the installer changes only the shared pack installation, never another product's
control, registry, configuration or evidence.

### Roll Back To 0.30.1

The installing orchestrator owns rollback after every attempt using the outgoing
pack has finished and stopped, including paused attempts. Pause launches and
collections in affected products and keep them paused through verification.
Preserve complete decision journals, signed receipts/history and receipt key,
datasets, all dispatch pin versions, reports, confirmations and product history;
record their hashes before and after rollback. Do not delete records to evade
`before-update` and do not resume an outgoing-version attempt on 0.30.1.

Select GitHub tag `v0.30.1` in both tools, with automatic updates disabled. Before
any command replacing a cache folder, run `before-update` against that exact
folder across all products as described above; a refusal blocks replacement.
Use separate tool profiles/cache directories if a pinned folder must remain.
In clean profiles the installation commands are:

```bash
claude plugin marketplace add 'https://github.com/darkdepot/mono.git#v0.30.1'
claude plugin install mono@mono-marketplace
codex plugin marketplace add darkdepot/mono --ref v0.30.1
codex plugin add mono@mono-marketplace
```

For an existing Codex marketplace, remove its registration and register the tag
as in Plugin Updates; protect the replaced cache with `before-update` first.
Verify both actual version-cache trees against `v0.30.1`, including paths, types,
modes, hashes and symlinks; both installed versions must read `0.30.1`. No journal
projection is required for this rollback: retain all evidence, pins and history
byte-for-byte, including the new files ignored by 0.30.1. Recheck their saved
hashes. Restart each product's watcher from the verified 0.30.1 pack as a tracked
background process; verify that it stays running and monitor its normal event
output. Version 0.30.1 does not write `watcher.json`, so no fresh pulse is required
for rollback. Then release launch halts. New attempts use fresh 0.30.1 dispatch
pins; never redirect archived attempts or reuse a newer certificate as proof.

### Roll Back To 0.29.0

The installing orchestrator owns rollback. Pause affected launches and collections,
stop affected attempts safely, and retain their pending obligations. Do not resume
a 0.30.x attempt under 0.29.0 or remove its records to bypass an installation gate.
Keep the old sessions stopped until the cut-over is verified.

Before changing anything, preserve an immutable copy of the **complete** decision
journals, signed receipts/history and receipt key, datasets, dispatch pins (all
versions), reports and confirmations. Record file hashes and verify them after
the exercise. Keep the original evidence and pins unchanged; a compatibility
view is a separate evidence root, not an edit to the original journal.

Choose fresh absolute paths `full_evidence` (the preserved evidence copy) and
`rollback_evidence` (the separate 0.29.0 root), and set `issue` to the affected key.
For each Issue, project only the three supported entry types without reordering
or rebuilding entries; this preserves `supersedes` and `forId` references:

```bash
node --input-type=module - "$full_evidence" "$rollback_evidence" "$issue" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const [source, destination, issue] = process.argv.slice(2);
if (!path.isAbsolute(source) || !path.isAbsolute(destination) || source === destination ||
    !/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(issue)) throw new Error('distinct absolute roots and Issue required');
const journal = JSON.parse(fs.readFileSync(path.join(source, 'decisions', `${issue}.json`)));
const entries = journal.entries.filter(e => ['decision', 'matrix', 'verification'].includes(e.type));
fs.mkdirSync(path.join(destination, 'decisions'), { recursive: true });
fs.writeFileSync(path.join(destination, 'decisions', `${issue}.json`),
  JSON.stringify({ ...journal, entries }, null, 2) + '\n', { flag: 'wx' });
JS
```

`decline`, `decline-revoke`, `class`, `class-decision`, `continue` and `successor`
are deliberately absent. Do not translate them into old decisions or readiness.
Accepted declines and cap allowances confer no readiness after rollback.

Select GitHub tag `v0.29.0` in **both** tools. Use clean, separate tool profiles
and cache directories so the stopped attempts' installed folders remain intact;
do not overwrite the currently pinned pack. If reusing any installation folder,
the existing `before-update` condition still applies and a refusal blocks it.
In those clean profiles, with automatic updates disabled:

```bash
claude plugin marketplace add 'https://github.com/darkdepot/mono.git#v0.29.0'
claude plugin install mono@mono-marketplace
codex plugin marketplace add darkdepot/mono --ref v0.29.0
codex plugin add mono@mono-marketplace
```

The Claude git-URL fragment selects the tag ([CLI reference](https://code.claude.com/docs/en/plugins/cli-reference#plugin-marketplace-add)).
Verify both actual version-cache trees against the Git tree of `v0.29.0`, including
modes/symlinks; each installed `VERSION` must be `0.29.0`. Set `old_pack` to a
verified 0.29.0 cache and validate the separate journal with that version:

```bash
node "$old_pack/scripts/decisions.mjs" list --issue "$issue" --evidence-root "$rollback_evidence"
node "$old_pack/scripts/decisions.mjs" render --issue "$issue" --evidence-root "$rollback_evidence"
```

Any invalid/dangling reference blocks rollback; do not silently drop or repair
entries. Recheck the preserved full journal, receipts and pins against the saved
hashes. Keep both the full archive and the readable compatibility view.

Create new attempts using the 0.29.0 rules and verified pack identity. Refresh
their dispatch pins, model/config base, dataset path/version/digest, worktree/base,
evidence root and complete writable roots; never amend the archived pins. Run a
full review of the committed code being sent under those pins. In a training root,
prove that old gates reject a findings receipt despite its former accepted
declines and accept a fresh full clean review when all other checks pass; retain
commands/results with the rollback record. Only then resume affected work. Do not
reuse a 0.30.x certificate, continuation, or accepted-with-declines result.
