# Real-byte screening regressions

These fixtures reproduce the host r4 failure on MONO-297 head
`dd79ff621f164f9a025f58871f8abcef70f87906`. They are regression inputs,
not successful live role runs or a new calibration measurement.

- `codex-0.159.2-catalog.json`: unchanged bytes from the bundled native catalog;
  SHA-256 `262dc36e0e7beb290aef8196bd59f42acf51647b8f7b68dafa533ae7742019e6`.
  Codex instruction attribution is retained in [NOTICE](../../../skills/code-review/NOTICE.md).
- `MONO-302.diff`: actual Git diff from `8226fca80635dedf0c97d86979b529275976b565`
  to `ca16110b9ef28817a1506621511ea6725dbc5f94`; no reconstructed source lines.
- `requests.json`: host manual/tiny requests with only machine-local worktree paths
  omitted. The tests recreate the tiny repository from `tiny-files.json` and remap
  its head/base to the new temporary commits; the original pinned SHAs remain here.
- `checker-r3.json`: nine reconstructed r3 answers and their exact finding fields,
  using the same field selection as the host replay. No changed reasons or merge keys.

The tests require a completed round and 9/9 accepted answers. Dataset v8 keeps v6's
stateless source line rule supersedes the earlier lexical-span expectations:
a matched line/block may be hidden, but must not prevent launch or parsing.
Unmatched source bytes, including regex escapes, stay exact. The native catalog,
MONO-302 diff, tiny request and nine checker answers retain their pinned bytes.
Credential probes run through the same screen without path or string exemptions.
Model responses here are recorded fixtures; the orchestrator must still repeat
live manual checks from both host systems before merge.

Collection-10 regressions cover full-blob redaction beyond hunk context, quoted block delimiters (uncertain quotes withhold the remainder), and embedded credential-family filenames across inventory, prompt and report channels.

Collection-11 regression keeps the exact regex closer source and checks remainder withholding across later hunks, both patch sides and both roles. V8 replaces prior block-end/suffix-preservation expectations: same-line openers conservatively withhold the remainder without interpreting closers. Other files, prefix bytes, JSON decoding and role launch/parser controls remain checked.
