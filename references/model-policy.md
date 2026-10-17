# Model Policy

Resolve defaults/validated overrides before commands/dispatches/certificates.
Link `role:<role>` to `#roles`; report values.

## Roles

| Role | Model id | Reasoning effort | Applies to | Decided by |
| --- | --- | --- | --- | --- |
| `orchestrator` | `session-selected` | n/a | No model/effort constraint. | Owner, 2026-10-13. |
| `second-voice` | `gpt-6-astra` | `high` | Second Voice for Claude, cross-vendor. | Owner, 2026-09-30. |
| `second-voice-alt` | `claude-opus-5` | `high` | Second Voice for GPT, independent of worker. | Owner, 2026-09-06. |
| `worker-default` | `gpt-6.1-sol` | `high` | Codex worker. | Owner, 2026-09-30. |
| `worker-complex` | `gpt-6.1-sol` | `xhigh` | Complex Codex; dispatch reason required, never risk-selected. | Owner, 2026-09-30. |
| `worker-claude` | `claude-opus-5` | `high` | Claude worker; guarantees below. | Owner, 2026-09-06. |
| `idea-helper` | claude-code: `claude-opus-5-5`; codex: `gpt-6.1-sol` | `high` | Read-only idea facts. | Owner, 2026-10-16. |
| `autoreview` | `claude-opus-5` | [Canonical Routes](autoreview-routing.md#canonical-routes) | Code reviewer. | Owner, 2026-09-06. |

For `idea-helper`, skills pass their actual `host: "claude-code"` or `host: "codex"`
to `resolveRole`. `models.roles.idea-helper` overrides host defaults; omissions
inherit (Claude/Codex, high). Existing callers without host default to codex.

## Reviewer and producer

Pairs need owner approval, not measurement. Reviewers must match producer
capability; disclose equal-model review.

## Product overrides

`.agents/mono-workflow.config.json`: `models.roles` maps roles to
`{engine|transport,model,effort|effortByRisk,provider:{id,endpoint,credentialEnv}}`.
Omissions inherit; engine changes need compatible effort/provider. Reject unknown
fields. Secrets stay with the orchestrator; `credentialEnv` names a variable.
Native auth: null endpoint/credentialEnv.

Engines: `idea-helper` → claude|codex; `worker-default|worker-complex` → codex;
`worker-claude` → claude; `autoreview` → claude|kimi|pi|codex;
`second-voice` → native Codex for Claude (cross-vendor).
No overrides for `orchestrator`/`second-voice-alt`.
Managed transports: `codex-cli` → `worker-default|worker-complex`; `claude-cli` →
`worker-claude`, native Anthropic subscription, no endpoint/credential overrides.
Supported efforts: Claude/Codex low|medium|high|xhigh|max; Kimi on|off;
Pi off|minimal|low|medium|high|xhigh. Autoreview requires all
`effortByRisk` keys: tiny, standard, deep, risky, riskyCritical.

Non-table pairs: `models.pairingAccepted[]` =
`{producer,reviewer,riskClasses,linearDecision,by,date}`. Producer adds role;
both routes carry engine/model/effort or effortByRisk/provider{id,endpoint}/credentialEnv.
Compare all fields/five risks; changes require renewed approval. This binds the
Linear decision, not capability. `requiredPairings(config)` prints it.

## Audience profile

`workerAudience`: redundancy only; model suitability is unmeasured.

## Application boundary

`resolveRole(role, config)`: table → override; fingerprint binds route/config digest.
Launch from immutable BASE; store `modelRoutes{base,configDigest,roles}` in
dispatch/request/registry. Resume retains routes without backfill; config changes
affect new launches only.
[Pack compatibility](install.md#compatibility).

## Orchestrator self-check

Report «Модель оркестратора: <модель запуска> | не удалось определить» at start
from authoritative launch data, no verdict. Self-identification is not proof;
no session switching. Launch scripts ignore `session-selected`.

Actual family selects Second Voice: Claude → `second-voice`, GPT → `second-voice-alt`;
others need a confirmed different-family role. Unknown family cannot waive review.
`ROLE_ENGINES.orchestrator` proves no session model.

## Launch evidence

Policy, launch parameters and served identity are separate; Codex parameters
prove no served model.

| Transport case | Model parameter | Effort parameter | Actual served model |
| --- | --- | --- | --- |
| `codex-cli` | Pinned resolved id. | Pinned resolved effort. | Unknown. |
| `claude-cli` | Pinned id; startup must match. | Explicit, unobserved. | Init plus first response; subscription login checked separately. |
| `fallback` | Alias; record alias-to-id assumption. | Runtime default. | Unknown. |
| `claude-code-desktop` | Owner selects. | Unverified. | Unverified. |
