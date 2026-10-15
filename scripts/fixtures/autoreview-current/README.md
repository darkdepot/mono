# Current upstream output captures

`provenance.json` pins `openclaw/agent-skills` and its external helper digest.
On 2026-10-15, upstream main was `05d42d1fe0a76d00e339d7b80d248c27b0ea34d9`.
No helper implementation is included here.

Regenerate from a clean external checkout of that commit:

```bash
python3 scripts/fixtures/autoreview-current/capture.py /path/to/agent-skills
```

The script substitutes only `run_engine` with deterministic complete model JSON.
Upstream `main_impl` still selects/captures the branch, validates the response,
filters at P2, renders stdout, computes exit codes, and writes `review.json` and
`status.json`. These are format captures, not evidence of a real model review.
Only the scratch base SHA in stdout is normalized. Neither JSON artifact is
rewritten. The replay helper adapts model/effort header operands to the test
policy, allowing the existing model-policy mutation fixtures to remain valid.
The capture's Claude route is a format test operand, not Mono's product route.

`collection-helper-clean.json` and `collection-helper-findings.json` replay the
artifacts through the real collection/signing/preflight CLI in the existing
sandbox transport fixture. Tests read back both artifacts unchanged, require
helper-digest binding, reject findings without approval, accept a matching
orchestrator decline, then reject its revocation without rewriting the receipt.
Existing named decline fixtures cover forged/stale/dangerous/incomplete results.
