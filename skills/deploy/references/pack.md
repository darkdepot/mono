# Pack

Block exactly `{"targets":[{"kind":"pack"}]}`. Ordinary PR merge/outcome:
«влито, ждёт выпуска»; orchestrator wave or owner «выпусти». Manual PR without
registered attempt never calls landing-drain record.

Separate approved release PR assembles changelog, version, plugin manifests and
upgrade steps. New Deploy installs by preceding path; NEXT release uses pack-install.
Mono writes its block on main first; other products own their configs/copies.

Wave: landing-drain verify → `node <pack-root>/scripts/pack-install.mjs` → close.
Use --help. Breaking release/rollback requires verified quiescence.
Installer handles profiles/holders, prior versions/pause, tag pins, mismatched
places, version/commit/tree/fresh-session proof and watcher/pause recovery.
List dead records (never remove); live holders wait; product copies stay listed.

Pass installer JSON as packResult to the RELEASE PR's run, not a closed ordinary
run (it keeps «влито, ждёт выпуска»). Its outcome installed means
«выкатили и проверили»; rolled-back «откатили»; waiting/stopped NO outcome, name
holders/failure. Show places, sessions to restart, local copies still old.
Installed places must share verified expected/actual version; its v<VERSION>
commit must contain this PR merge. An old release cannot prove new delivery.

Transition: product sessions get owner yes/write blocks; CallCatch/Red need rollback.
Mono removes legacy fields. Close Project after Mono/Zeni web/CallCatch/Red blocks,
next verified pack-install release and Mono probe cleanup/archive.
