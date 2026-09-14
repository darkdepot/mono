# Readiness Gates

## Risk Classification

Use higher approved/final-diff class; apply `references/autoreview-routing.md`:

- `tiny`: one narrow artifact, no data/auth/billing/migration/multi-surface UX/release/public-API risk; explicit PRD-lite/no-spec may qualify.
- `standard`: normal product/workflow; approved Project/PRD/Spec/Issue (issue-only substitutes its contract).
- `deep`: cross-cutting artifacts/abstractions/multi-step behavior; explicit architecture review of stable interfaces/real seams/tests.
- `risky`: auth/permissions/billing/migrations/sensitive-production data/release-deploy/public API/security.

## Review Gate Policy

Require review for standard/deep/risky handoff/pre-ship; created/materially rewritten PRD/Spec/Issue; material pre-ship drift/drift-candidate; bug/perf missing repro/baseline/loop; AFK with unresolved judgment; risky domains; or no-spec beyond tiny/low-risk. Tiny/accepted PRD-lite/explicit low-risk no-spec may be advisory with reason.

Handoff reviews draft Project/PRD/Spec/slicing before first durable write or queue. No standard/deep/risky exception; only recorded tiny advisory skip. Handoff fixes draft; review stays report-only. Apply `references/worker-contract.md` mode precedence. Issue-only review/check requires only its self-contained contract: standard ready, tiny advisory/reason, no Project/docs.

## Gate Outcomes

ready = required review/no blockers or owner-applied accepted fixes; advisory-ready = optional skip/non-blocking FYI; needs-fixes = fixes/decisions remain; blocked = artifacts/permissions/context unavailable.

## Tiny Output Profile

Tiny chat: outcome/link/next + boundary delta; ship/deploy always full Проверено/Не проверено. Start comment/preflight may share one Issue comment retaining `mono-preflight certificate`. Ship/deploy keep complete certificates, omit optional narrative.

## Ownership

Preserve the separate stage/repair owners in `AGENTS.md`; review is report-only, check readiness-only.
