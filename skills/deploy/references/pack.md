# Pack

Block exactly `{"targets":[{"kind":"pack"}]}`. Ordinary PR merge/outcome:
«влито, ждёт выпуска»; orchestrator wave or owner «выпусти». Manual PR without
registered attempt never calls landing-drain record.

Separate approved release PR assembles changelog.d, CHANGELOG, VERSION, both
plugin manifests, UPGRADING. New Deploy release installs by preceding path;
NEXT release uses pack-install. Mono session first writes pack block on main.
Other product configs/local plugin copies belong to their sessions.

Wave: landing-drain verify → `node <pack-root>/scripts/pack-install.mjs` → close.
Use --help for args. Breaking release/rollback requires verified quiescence.
Installer discovers all profiles, checks holders, saves prior versions/pause once,
pins tags, replaces mismatched places, checks versions/commits/trees and fresh
session skill load everywhere, restarts watchers/restores pause. Name dead records;
do not remove them. Live holders wait. Product copies listed, not silently updated.

Pass installer JSON as packResult to outcome. Its outcome installed means
«выкатили и проверили»; rolled-back «откатили»; waiting/stopped NO outcome, name
holders/failure. Show places, sessions to restart, local copies still old.
Installed places must share verified expected/actual version; its v<VERSION>
commit must contain this PR merge. An old release cannot prove new delivery.

Transition: each product session gets owner yes and writes block; CallCatch/Red
need working rollback first. Mono alone removes legacy fields. Project closes
after Mono/Zeni web/CallCatch/Red blocks, next verified pack-install release and
Mono probe cleanup/archive.
