Live Linear project-description round trip, P-MONO-270, 16.10.2026 07:27Z (save_project patch append, then get_project).
Observed: '- ' and '+ ' become '* '; a '+' item inside a '-' list is split into a separate list with two blank lines; runs of blank lines outside lists collapse; '*' and '[ ]' get backslash-escaped, '_', '#', '>' do not; trailing double-space hard break removed; fenced code unchanged.
Comment round trip, 16.10.2026 07:36Z (save_comment then list_comments): body byte-identical, including fenced record and snapshot, mixed list markers, escapes and trailing double space. Comments are not reserialized on create; the snapshot fence is the source of truth for the fingerprint.

The three live samples are preserved as JSON strings (`markdown`) with SHA-256
checksums, retaining the source bytes including intentional trailing spaces while
passing `git diff --check`. Decoded bytes were compared with the approved handoff
fixtures. The zero-hash comment intentionally probes serialization;
tests substitute the actual fingerprint to exercise record validation.

`project/`, `legacy/` and `issue-only/` are synthetic complete snapshot examples
for U1 and its U2 consumer. Each includes a test-only `config.json` with a cutoff.
Run `node scripts/idea-gate.mjs check --mode approved --snapshot
scripts/fixtures/idea-gate/NAME --config scripts/fixtures/idea-gate/NAME/config.json`:
the respective codes are `pass`, `legacy-before-cutoff`, `issue-only`.
Project examples keep Unknowns only in the comment snapshot. `approval.json`
contains metadata; its `bodySha256` binds the exact bytes in `approval.md` to a
comment from the complete project comment list. The API receives those metadata
plus `approval.body` (the contents of `approval.md`). All four custom heading
keys (`what`, `why`, `outcome`, `unknowns`) must be distinct nonempty strings.
