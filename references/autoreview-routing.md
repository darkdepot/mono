# Autoreview Role Routing

`mono-preflight` resolves the model from [role:autoreview](model-policy.md#roles) and the
reasoning effort from the final workflow risk class below.
Never rely on the external `autoreview` helper's built-in model default:
that helper is independently updateable and its default
may change without this workflow changing.

## Canonical Routes

| Risk class | Role | Reasoning effort | Intended use |
|---|---|---|---|
| `tiny` | [role:autoreview](model-policy.md#roles) | `low` | Narrow, explicit, low-risk changes with a clear expected result. |
| `standard` | [role:autoreview](model-policy.md#roles) | `medium` | Normal bounded product and workflow changes. |
| `deep` | [role:autoreview](model-policy.md#roles) | `high` | Cross-cutting behavior, new abstractions, ambiguity, or difficult multi-step reasoning without a high-impact boundary. |
| `risky` | [role:autoreview](model-policy.md#roles) | `high` | Auth, permissions, billing, migrations, sensitive data, release/deploy flow, public APIs, and security boundaries. |
| `risky` with critical escalation | [role:autoreview](model-policy.md#roles) | `xhigh` | Irreversible production/data risk, a complex security boundary, a near-limit dispersed scope, or a release blocker after conflicting reviews. |

All classes resolve the same reviewer role; the class grades reasoning effort.
The model comes only from the policy table, never from helper defaults or a
second local selection.
Do not silently fall back to another engine, model, or effort when a selected
route is unavailable.

### Reviewer capability

A review model must be at least as capable as the code's producer for the gate
to add signal: a weaker reviewer rubber-stamps exactly the failures the gate
exists to catch. The owner-approved pairing and the decision rule in
`model-policy.md` govern that capability relationship; resolving a role does not itself prove it.
Cross-vendor review is deliberately not a code-review requirement, and must
not be added by analogy to the Second Voice: independence-by-different-vendor
guards subjective product judgment, where two instances of one model share the
same priors, while code review is grounded in the concrete diff — bugs, logic,
contract shape.

### Effort recalibration

If live QA later shows `medium` is too weak for standard-class
work, `standard` re-tiers the same reviewer role to `high`; that re-tier lands as a
routing-table change in this file, never as an ad-hoc per-run override.

### Same-model review

Condition: `<worker-model> = <autoreview-model>` after resolving both roles.

Known limitation at every class: whenever the resolved worker and reviewer
identifiers match, the route performs same-model review of code that model
produced, and a model reviewing its own output is worst-placed to catch its own blind spots. The compensations are the ones
this workflow already relied on — the mandatory live QA gate before Linear
closeout, the no-test-edits rule (review-triggered fixes must never weaken,
delete, or rewrite tests to reach green), and the standing exception of
cross-vendor review whenever the worker engine is Codex instead of Claude,
which puts the reviewer at a different vendor than the producer.

## Classification

1. Read the risk class already recorded in the current Linear Project, review
   report, Tech Spec, or Issue. Prefer the most recent approved artifact.
2. Compare that class with the actual final diff. Use the higher class when the
   implementation added a riskier surface than the approved package records.
3. When no durable risk class can be recovered, classify from
   `references/readiness-gates.md`. Ambiguity moves upward, never downward. A
   missing classification for a non-tiny change defaults to `deep`, not
   `standard`.
4. Reclassify before the final durable-scope review when review-triggered fixes
   materially change the files, owner boundary, or risk surface.
5. After that final classification, select the route again from the canonical
   table. An earlier clean result is stale when the risk class moves upward or
   a new or stronger critical signal now requires a higher route, including a
   same-class `risky` transition from `high` to `xhigh`.

Within `risky`, escalate from `high` to `xhigh` only when at least one critical
signal is concrete in the final scope: irreversible production or data
mutation, a complex security boundary, a near-limit dispersed review bundle,
or a release blocker after conflicting credible reviews. Record that signal in
the certificate. Do not use `xhigh` merely because the change is important.

The route is a technical workflow decision. Do not ask the user to choose a
model or effort. Ask only when the actual risk requires product or risk
acceptance that the agent cannot infer safely.

## Invocation

Resolve `<autoreview-model>` from [role:autoreview](model-policy.md#roles) in the installed
policy. Resolve `<effort>` from the selected Canonical Routes row above.
Substitute both before invoking the helper; these placeholders are not CLI
values. Always pin the Claude engine and pass both values explicitly:

```bash
<autoreview-helper> --mode <scope> <scope-args> --engine claude --model <autoreview-model> --thinking <effort>
```

Examples:

```bash
# Tiny
<autoreview-helper> --mode branch --base origin/main --engine claude --model <autoreview-model> --thinking low

# Standard
<autoreview-helper> --mode branch --base origin/main --engine claude --model <autoreview-model> --thinking medium

# Deep
<autoreview-helper> --mode branch --base origin/main --engine claude --model <autoreview-model> --thinking high

# Risky
<autoreview-helper> --mode branch --base origin/main --engine claude --model <autoreview-model> --thinking high

# Risky with a recorded critical escalation
<autoreview-helper> --mode branch --base origin/main --engine claude --model <autoreview-model> --thinking xhigh
```

Keep the selected route unchanged across retries and review-fix iterations
unless the risk classification moves upward. Capacity, authentication, or
model-availability errors must retry the same route and then block; they must
not trigger a cheaper or older hidden fallback. That ban covers every channel
the helper offers: never pass `--fallback-model`, and never let a fallback
chain in through the environment with `AUTOREVIEW_FALLBACK_MODEL` or
`AUTOREVIEW_CLAUDE_FALLBACK_MODEL`.

## Certificate Evidence

The preflight certificate must record:

- risk class and where it came from;
- critical escalation signal or `none`;
- selected model and reasoning effort;
- final command with explicit `--model` and `--thinking`;
- any upward reclassification during the review loop.

`ready` is invalid when the final command omits `--engine claude` or either routing flag, selects a model
other than the identifier resolved from [role:autoreview](model-policy.md#roles), or does not match the final risk class.
