# Model Policy

The table supplies defaults; validated product config may override them below.
Resolve roles before commands, dispatches and certificates. Normative references
use a `role:<role>` link to `#roles`; outputs record values, not new defaults.

## Roles

| Role | Model id | Reasoning effort | Applies to | Decided by |
| --- | --- | --- | --- | --- |
| `orchestrator` | `claude-fable-5-1` | n/a | Orchestrator session; effort unset. | Owner, 2026-09-06. |
| `second-voice` | `gpt-6-astra` | `high` | Second Voice for Claude; approved cross-vendor rule. | Owner, 2026-09-06. |
| `second-voice-alt` | `claude-opus-5` | `high` | Second Voice for GPT; independent of worker role. | Owner, 2026-09-06. |
| `worker-default` | `gpt-5.6-sol` | `high` | Default Codex worker. | Owner, 2026-09-06. |
| `worker-complex` | `gpt-6-astra` | `high` | Complex Codex work; explicit reason per dispatch, never automatic by risk. | Owner, 2026-09-06. |
| `worker-claude` | `claude-opus-5` | `high` | Claude worker transports; guarantees below. | Owner, 2026-09-06. |
| `autoreview` | `claude-opus-5` | [Canonical Routes](autoreview-routing.md#canonical-routes) | Mandatory reviewer; final-risk effort. | Owner-approved reviewer/producer pairing, 2026-09-06. |

## Reviewer and producer

The table records owner-approved worker/reviewer pairs, not measured capability.
Reviewer capability must be at least the producer's. Unestablished pairs require
an owner decision; matching model IDs require same-model review disclosure.

## Product overrides

This replaces the table-only boundary. `.agents/mono-workflow.config.json` may
set `models.roles`: role → `{engine|transport, model, effort|effortByRisk,
provider:{id,endpoint,credentialEnv}}`. Omitted fields inherit defaults;
changing engine requires compatible effort and provider. Keys live only in the
orchestrator environment; `credentialEnv` is its variable NAME. Endpoint and
credentialEnv may be null for native authentication. Unknown fields are refused.

Matrix: `worker-default|worker-complex` → codex; `worker-claude` → claude;
`autoreview` → claude|kimi|pi|codex; `second-voice` → native Codex for the Claude
orchestrator (cross-vendor). `orchestrator` and `second-voice-alt` overrides are
refused. No new worker transports: the CLI launcher accepts only Codex workers.
Claude/Codex efforts: low|medium|high|xhigh|max; Kimi: on|off; Pi:
off|minimal|low|medium|high|xhigh, subject to model compatibility. Autoreview uses
`effortByRisk` with tiny, standard, deep, risky, riskyCritical; all are required.

For every non-table worker/reviewer pair, `models.pairingAccepted[]` records
`{producer,reviewer,riskClasses,linearDecision,by,date}`. Producer includes role;
both sides carry engine, model, effort/effortByRisk, provider{id,endpoint} and
credentialEnv. Risk classes include all five effort keys. Compare every field;
a changed pair requires renewed acceptance naming that pair. Validation binds the Linear decision; it never measures capability.
`requiredPairings(config)` prints the exact pair data for that decision.

## Audience profile

`workerAudience` changes dispatch redundancy, not models; suitability for an
unmeasured model remains an assumption.

## Application boundary

`resolveRole(role, config)` reads table → override and fingerprints the canonical
route plus config digest. Resolve from the immutable BASE config at launch;
record `modelRoutes{base,configDigest,roles}` in dispatch/request/registry.
Config diffs cannot change pinned routes. New settings govern new launches. Resumes retain pins, never backfill unknowns; changed pack identity
still forbids resume.

## Orchestrator self-check

Compare the authoritative launch model with the orchestrator row once at start.
Report «Модель оркестратора: по политике | не по политике | не удалось проверить».
Match/difference/no authoritative ID select those outcomes respectively.
Self-identification is not evidence; this check never switches a session.

## Launch evidence

Keep policy intent, launch parameters and served-model evidence separate.
Codex reports requested parameters, not the actual served identity.

| Transport case | Model parameter | Effort parameter | Actual served model |
| --- | --- | --- | --- |
| `codex-cli` | Resolved id pinned. | Resolved effort pinned. | Unknown; parameters are evidence. |
| `fallback` | `model` alias; record alias-to-id assumption. | Runtime default, not policy effort. | Unknown. |
| `claude-code-desktop` | Owner selects manually. | Unverified. | Unverified. |
