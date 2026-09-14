# Autoreview Role Routing

Resolve model only from [role:autoreview](model-policy.md#roles), effort from final risk below. Never rely on helper defaults or silently substitute engine/model/effort.

## Canonical Routes

| Risk class | Role | Reasoning effort | Intended use |
|---|---|---|---|
| `tiny` | [role:autoreview](model-policy.md#roles) | `low` | Narrow low-risk work. |
| `standard` | [role:autoreview](model-policy.md#roles) | `medium` | Bounded product/workflow. |
| `deep` | [role:autoreview](model-policy.md#roles) | `high` | Cross-cutting/abstract/ambiguous/multi-step without high-impact boundary. |
| `risky` | [role:autoreview](model-policy.md#roles) | `high` | Auth/data/release/API/security. |
| `risky` with critical escalation | [role:autoreview](model-policy.md#roles) | `xhigh` | Concrete critical signal below. |

Same role for all classes; substitute resolved placeholders.

### Reviewer capability

Require reviewer ≥ producer capability under `model-policy.md` pairing/rule; role resolution alone is no proof. No Second-Voice cross-vendor gate for code review.

### Effort recalibration

If live QA shows `medium` insufficient for `standard`, change this canonical table to `high`; never use ad-hoc per-run re-tiering.

### Same-model review

When `<worker-model> = <autoreview-model>`, disclose same-model review. Retain live QA before closeout and no weakening/deleting/rewriting tests for green. Codex retains cross-vendor reviewer exception.

## Classification

1. Read the most recent approved artifact's risk (Project/review/Spec/Issue).
2. Compare final diff; use the higher class. With no durable classification use readiness policy; ambiguity moves up, and unclassified non-tiny defaults to deep.
3. Reclassify after review fixes change scope/owner/risk and before final durable-scope review; select the route again. Upward risk or a new/stronger critical signal stales earlier clean evidence, including risky high→xhigh.
4. Escalate risky to xhigh only for concrete irreversible production/data mutation, complex security boundary, near-limit dispersed review scope, or release blocker after conflicting credible reviews. Record the signal; importance alone does not qualify.

Decide model/effort technically; ask only for uninferable product/risk acceptance.

## Invocation

```bash
<autoreview-helper> --mode <scope> <scope-args> --engine claude --model <autoreview-model> --thinking <effort>
```

Pin engine/model/effort every invocation. Keep route across retries/fixes unless risk escalates. Capacity/auth/model unavailability retries the same route, then blocks. Never pass `--fallback-model` or enable `AUTOREVIEW_FALLBACK_MODEL` / `AUTOREVIEW_CLAUDE_FALLBACK_MODEL`.

## Certificate Evidence

Record risk/source, critical signal/none, model/effort, explicit final --engine claude/--model/--thinking command and reclassification. Missing flags/wrong role/final-risk route invalidates ready.
