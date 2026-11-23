# Pack

Block exactly `{"targets":[{"kind":"pack"}]}`.

Ordinary pack PR: outcome «влито, ждёт выпуска»; Issue Done on merge; retire
the worker after that closeout. A registered attempt's merge still writes its
pending-install record; nothing closes it on this path and retirement ignores it.

Release: a separate approved PR assembles changelog, version, plugin manifests
and upgrade steps. Before the tag, run `mono:qa` on the release PR head. After
merge and tag, install per `<pack-root>/references/install.md`, then pass to THIS
release PR's run `packResult`
`{"outcome":"installed","places":[{"place":"<profile>","expected":"<VERSION>","actual":"<VERSION>","verified":true}]}`:
one place per Claude Code profile and Codex; expected is the tag version, actual
the cached one; verified only when the cache equals the tag tree and a fresh
session loaded that version. Then «выкатили и проверили»; the tag must contain
this merge. A place that does not match: send `stopped` with the place and
reason; no outcome, run stays open. `rolled-back` means «откатили».
The installer is optional.
