# Readiness Gates

Readiness gates protect the Linear lifecycle without turning every small change into ceremony.

## Risk Classification

Use `tiny`, `standard`, `deep`, or `risky`.

The same class controls the mandatory `autoreview` model and reasoning effort
through `references/autoreview-routing.md`. When approved artifacts and the
final diff disagree, use the higher risk class for review routing.

`tiny`:

- One narrow artifact update.
- No data, auth, billing, migration, multi-surface UX, release, or public API risk.
- PRD-lite or explicit no-spec exception may be acceptable.

`standard`:

- Normal product or workflow change.
- Needs Project, PRD, Tech Spec, and one Issue before implementation.
- Needs review before handoff and pre-ship.

`deep`:

- Cross-cutting workflow, multiple artifacts, new abstractions, or multi-step agent behavior.
- Needs explicit architecture-quality review for stable interfaces, real seams, and test surface.
- Needs review before handoff and pre-ship.

`risky`:

- Touches auth, permissions, billing, migrations, sensitive data, production data, release/deploy flow, public API, or security boundaries.
- Needs review before handoff and pre-ship.

## Review Gate Policy

`mono-review` is required when:

- scope is `standard`, `deep`, or `risky`;
- handoff creates or materially rewrites PRD, Tech Spec, or Issue contracts;
- pre-ship scope is `standard`, `deep`, or `risky`;
- pre-ship scope differs from approved Linear artifacts;
- preflight reports `drift-candidate`;
- bug or performance work lacks a recorded reproduction, baseline, or feedback-loop expectation;
- an Issue is marked `AFK` but still contains unresolved human judgment;
- work touches risky domains;
- a no-spec exception is requested for anything beyond tiny low-risk work.

`mono-review` is advisory when:

- work is `tiny`;
- PRD-lite is explicitly accepted;
- no-spec exception is explicit, low-risk, and recorded.

Handoff-gate timing is pre-write. The handoff review runs on the draft package — draft Project brief, draft PRD, draft Tech Spec, and proposed Issue slicing — before the first durable Linear write of that package, so findings are fixed in the draft instead of in an artifact that is already written. "Before the first durable Linear write" means before the first Linear mutation the run applies, or, where the run queues mutations instead of applying them, before the first mutation it queues; the write-versus-queue substitution has one home in Orchestration Mode Precedence in `references/orchestration.md`. The required-versus-advisory split above is what decides the obligation: `standard`, `deep`, and `risky` cannot skip this review, while `tiny` stays advisory with the skip reason recorded. `mono-handoff` owns the order and applies the accepted fixes; `mono-review` accepts the draft package as its input in this mode and stays report-only.

In the issue-only lane (`package_kind=issue-only`), the self-contained Issue is the sole artifact: `mono-review` and `mono-check` judge it against the issue-only contract and do not require a Project, PRD, or Tech Spec. The required-versus-advisory split is unchanged — standard issue-only still requires review to `ready`; tiny stays advisory with the reason recorded.

## Gate Outcomes

- `ready`: required review ran, no blocking findings remain, or accepted fixes were applied by the owning workflow.
- `advisory-ready`: review was optional and skipped or produced only non-blocking FYI.
- `needs-fixes`: proposed fixes or decisions remain before the next stage.
- `blocked`: required artifacts, permissions, or context are unavailable.

## Tiny Output Profile

When risk class is `tiny`:

- Chat finals shrink to: outcome sentence + link + Что дальше (boundary only as delta — see Boundary Delta Rule in `references/human-friendly-output.md`). Exception: ship and deploy chat finals always keep the full `Проверено/Не проверено` form, even for `tiny` work — the Boundary Delta Rule says so and wins here.
- The implementation-start comment and the preflight certificate may be combined into ONE Linear comment on the Issue. The certificate marker line `mono-preflight certificate` must appear verbatim inside the combined comment so downstream workflow stages can recover the certificate.
- Ship and deploy keep their certificates unchanged (required for machine recovery) but drop all optional narrative around them.

Reference: each of `mono-implement`, `mono-preflight`, `mono-ship`, and `mono-deploy` carries one line pointing here.

## Ownership

- `mono-review` reports findings only.
- `mono-check` reports readiness only.
- `mono-handoff` applies accepted artifact fixes and records approval comments.
- `mono-implement` owns Delivery Start and implementation execution from approved Issue(s).
- `mono-preflight` owns local branch readiness and emits the preflight certificate.
- `mono-ship` owns formal pre-ship review/check, accepted pre-ship drift sync, PR/review state, repo documentation before final green, and the green certificate.
- `mono-deploy` owns merge/deploy delegation, post-ship readiness, Linear closeout, and durable learning capture.
