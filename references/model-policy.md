# Model Policy

Defaults accept validated product overrides. Resolve roles before
commands/dispatches/certificates. Normative links use `role:<role>` → `#roles`;
outputs record values, not defaults.

## Roles

| Role | Model id | Reasoning effort | Applies to | Decided by |
| --- | --- | --- | --- | --- |
| `orchestrator` | `session-selected` | n/a | Launch model; no required model or effort. | Owner, 2026-10-13: «без жёстких ограничений». |
| `second-voice` | `gpt-6-astra` | `high` | Second Voice for Claude; approved cross-vendor rule. | Owner, 2026-09-30. |
| `second-voice-alt` | `claude-opus-5` | `high` | Second Voice for GPT; independent of worker role. | Owner, 2026-09-06. |
| `worker-default` | `gpt-6.1-sol` | `high` | Default Codex worker. | Owner, 2026-09-30. |
| `worker-complex` | `gpt-6.1-sol` | `xhigh` | Complex Codex work; explicit reason per dispatch, never automatic by risk. | Owner, 2026-09-30. |
| `worker-claude` | `claude-opus-5` | `high` | Claude worker transports; guarantees below. | Owner, 2026-09-06. |
| `idea-helper` | claude-code: `claude-opus-5-5`; codex: `gpt-6.1-sol` | `high` | Read-only idea facts in the calling host. | Owner, 2026-10-16. |
| `autoreview` | `claude-opus-5` | [Canonical Routes](autoreview-routing.md#canonical-routes) | Mandatory reviewer; final-risk effort. | Owner-approved reviewer/producer pairing, 2026-09-06. |

For `idea-helper`, the skill supplies `host: "claude-code"` or `host: "codex"`
to `resolveRole`. Resolve `models.roles.idea-helper` first; omitted fields inherit
that host's table defaults (Claude engine for claude-code, Codex for codex).
The resolver's omitted host defaults to codex for existing callers; skills must
select their actual host. The effort is high on both hosts.

## Reviewer and producer

Pairs are owner-approved, not measured. Reviewers must be at least as capable
as producers. Unestablished pairs need owner approval; matching model IDs need
same-model review disclosure.

## Product overrides

`.agents/mono-workflow.config.json` may set `models.roles`: role → `{engine|transport, model, effort|effortByRisk,
provider:{id,endpoint,credentialEnv}}`. Omitted fields inherit defaults;
changing engine requires compatible effort and provider. Keys stay in the
orchestrator environment; `credentialEnv` names its variable. Native auth allows
null endpoint/credentialEnv. Unknown fields are refused.

Matrix: `idea-helper` → claude|codex; `worker-default|worker-complex` → codex; `worker-claude` → claude;
`autoreview` → claude|kimi|pi|codex; `second-voice` → native Codex for the Claude
orchestrator (cross-vendor). `orchestrator` and `second-voice-alt` overrides are
refused. Managed CLI transports: `codex-cli` accepts `worker-default|worker-complex`;
`claude-cli` accepts `worker-claude`, native Anthropic subscription only, without
endpoint overrides or credential references.
Claude/Codex efforts: low|medium|high|xhigh|max; Kimi: on|off; Pi:
off|minimal|low|medium|high|xhigh, subject to model compatibility. Autoreview uses
`effortByRisk` with tiny, standard, deep, risky, riskyCritical; all are required.

Non-table pairs require `models.pairingAccepted[]`:
`{producer,reviewer,riskClasses,linearDecision,by,date}`. Producer carries role; both sides carry
engine/model/effort or effortByRisk/provider{id,endpoint}/credentialEnv. Risk
classes cover all five effort keys. Compare every field; changed pairs need
renewed acceptance. Validation binds the Linear decision, not capability.
`requiredPairings(config)` prints the exact pair data for that decision.

## Audience profile

`workerAudience` changes dispatch redundancy, not models; unmeasured model
suitability is assumed.

## Application boundary

`resolveRole(role, config)` reads table → override and fingerprints the canonical
route plus config digest. Resolve from the immutable BASE config at launch;
record `modelRoutes{base,configDigest,roles}` in dispatch/request/registry.
Resume retains routes; no backfill. Config changes affect new launches only. [Pack compatibility](install.md#compatibility).

## Orchestrator self-check

Report «Модель оркестратора: <модель запуска> | не удалось определить» at start,
using authoritative launch data; no verdict. Self-identification is not evidence;
no session switching. `session-selected` is unused by launch scripts.

Second Voice follows the actual orchestrator family: Claude → `second-voice`,
GPT → `second-voice-alt`; another known family → an existing role confirmed to
have a different family. Unknown family never waives mandatory independent
review. `ROLE_ENGINES.orchestrator` is not session-model evidence.

## Launch evidence

Separate policy, launch parameters and served-model evidence. Codex parameters
do not prove served identity.

| Transport case | Model parameter | Effort parameter | Actual served model |
| --- | --- | --- | --- |
| `codex-cli` | Resolved id pinned. | Resolved effort pinned. | Unknown; parameters are evidence. |
| `claude-cli` | Resolved id pinned; startup must match. | Requested explicitly; unobserved. | Init identity plus first successful response; subscription login checked separately. |
| `fallback` | `model` alias; record alias-to-id assumption. | Runtime default, not policy effort. | Unknown. |
| `claude-code-desktop` | Owner selects manually. | Unverified. | Unverified. |
