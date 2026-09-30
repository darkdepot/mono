# Autoreview Role Routing

Resolve [role:autoreview](model-policy.md#roles) from pinned BASE config. Select
engine/model/provider and final-risk effort from that route, never helper defaults.

## Canonical Routes

| Risk class | Role | Reasoning effort | Intended use |
|---|---|---|---|
| `tiny` | [role:autoreview](model-policy.md#roles) | `low` | Narrow low-risk work. |
| `standard` | [role:autoreview](model-policy.md#roles) | `medium` | Bounded product/workflow. |
| `deep` | [role:autoreview](model-policy.md#roles) | `high` | Cross-cutting/abstract/ambiguous/multi-step without high-impact boundary. |
| `risky` | [role:autoreview](model-policy.md#roles) | `high` | Auth/data/release/API/security. |
| `risky` with critical escalation | [role:autoreview](model-policy.md#roles) | `xhigh` | Concrete critical signal below. |

Product `effortByRisk` replaces defaults; critical selects `riskyCritical`.
Unsupported effort fails before launch.

### Reviewer capability

Require owner-approved bound pairing; resolution is no capability proof.
No Second Voice cross-vendor gate for code review.

### Effort recalibration

Approve `standard` `medium` → `high` via policy/product config;
never re-tier silently.

### Same-model review

Disclose `<worker-model> = <autoreview-model>` review. Keep live QA before closeout;
never weaken/delete/rewrite tests for green. Codex keeps cross-vendor exception.

## Classification

1. Read the latest approved risk (Project/review/Spec/Issue).
2. Use the higher approved/final-diff class. Ambiguity moves up; unclassified non-tiny defaults to deep.
3. Reclassify after scope/risk changes. Upward risk or stronger critical signals stale earlier clean evidence.
4. Escalate risky for irreversible production/data mutation, complex security, near-limit dispersed scope or a release blocker after conflicting credible reviews. Record the signal; importance alone is insufficient.

Decide model/effort technically; ask only for uninferable product/risk acceptance.

## Invocation

```bash
<autoreview-helper> --mode <scope> <scope-args> --engine <autoreview-engine> --model <autoreview-model> --thinking <effort>
```

Pin engine/model/effort/fingerprint. The gate clears ambient provider
variables and maps only the route endpoint and named credential. Each engine
keeps two fixed forms: with or without `--stream-engine-output`. Retries retain
the route; risk escalation selects its stronger effort. Unavailability retries
then blocks. No `--fallback-model`, `AUTOREVIEW_FALLBACK_MODEL` or
`AUTOREVIEW_CLAUDE_FALLBACK_MODEL`.

## Certificate Evidence

Record risk/source, critical/none, model/effort, --engine/--model/--thinking,
fingerprint/reclassification. Missing flags/wrong role/effort invalidates ready.
One installed-helper invocation by orchestrator collection certifies committed
scope and satisfies K-22; short tiny/standard needs no prior local pass.
