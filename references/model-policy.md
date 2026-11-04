# Model Policy

Validate routes before commands/dispatches/certificates.
Link `role:<role>` to `#roles`; report values.

## Roles

| Role | Model id | Reasoning effort | Applies to | Decided by |
| --- | --- | --- | --- | --- |
| `orchestrator` | `session-selected` | n/a | Unconstrained model/effort. | Owner, 2026-10-13. |
| `second-voice` | `gpt-6-astra` | `high` | Second Voice for Claude, cross-vendor. | Owner, 2026-09-30. |
| `second-voice-alt` | `claude-opus-5` | `high` | Second Voice for GPT, independent of worker. | Owner, 2026-09-06. |
| `worker-default` | `gpt-6.1-sol` | `high` | Codex. | Owner, 2026-09-30. |
| `worker-complex` | `gpt-6.1-sol` | `xhigh` | Complex Codex; require dispatch reason, never by risk. | Owner, 2026-09-30. |
| `worker-claude` | `claude-opus-5` | `high` | Claude worker; see below. | Owner, 2026-09-06. |
| `idea-helper` | claude-code: `claude-opus-5-5`; codex: `gpt-6.1-sol` | `high` | Read-only idea facts. | Owner, 2026-10-16. |
| `scout` | claude-code: `sonnet`; codex: `gpt-6-luna` | claude-code: `medium`; codex: `high` | Read-only scouts. | Owner, 2026-10-17. |
| `qa` | `claude-opus-5-5` | `high` | Independent QA; models.roles override. | Owner. |
| `code-review` | `gpt-6.1-sol` | `high` | Manual reviewer. | Owner, 2026-11-01. |
| `code-review-checker` | `claude-opus-5` | `high` | Finding checker. | Owner, 2026-11-01. |
| `autoreview` | `claude-opus-5` | [Routes](autoreview-routing.md#canonical-routes) | Old. | Owner. |

`idea-helper`/`scout`: `resolveRole` takes actual `host: "claude-code"|"codex"`
(default codex). `models.roles.<role>` overrides; omissions inherit. Stages use `scout`;
`idea-helper` stays for configs; Claude scouts require the short alias.

## Reviewer and producer

Owner approves pairs; disclose equal-model autoreview.

## Product overrides

`.agents/mono-workflow.config.json`: `models.roles` overrides engine|transport,
model, effort|effortByRisk, provider{id,endpoint,credentialEnv}; omissions inherit.
Unknown fields/secrets fail. Native auth: null endpoint/credentialEnv. Engine
changes require compatible model/effort/provider. `orchestrator` and
`second-voice-alt` cannot be overridden; Second Voice requires native Codex.
Workers: codex-cli → worker-default|worker-complex; claude-cli → worker-claude
(native subscription). Engine matrix: `ROLE_ENGINES`.
Efforts: Claude/Codex low|medium|high|xhigh|max; Kimi on|off;
Pi off|minimal|low|medium|high|xhigh.

`models.pairingAccepted[]`: {producer,reviewer,riskClasses,linearDecision,by,date}.
Routes bind engine/model, effort|effortByRisk, provider{id,endpoint}, credentialEnv;
producer adds role. Compare every field/five risks; changes renew owner approval.
`requiredPairings(config,{reviewerRole:'code-review'})` binds reviewer.role and
reviewer.checker routes. Either change renews acceptance. Default: `autoreview`. Acceptance never waives native auth or different families. Payload screening excludes role tool reads, post-screen edits and evaluation reconstruction.

## Audience profile

`workerAudience`: redundancy only; suitability unmeasured.

## Application boundary

`resolveRole(role, config)`: table → override; fingerprint binds route/config digest.
Launch from immutable BASE; pin `modelRoutes{base,configDigest,roles}` in
dispatch/request/registry. Resume preserves routes without backfill; config edits
affect new launches only.
[Pack compatibility](install.md#compatibility).

## Orchestrator self-check

Report «Модель оркестратора: <модель запуска> | не удалось определить» at start
from authoritative launch data; no verdict. Self-ID is no proof; no session
switching. Launch ignores `session-selected`.

Second Voice by actual family: Claude → `second-voice`, GPT → `second-voice-alt`;
others need a confirmed cross-family role. Unknown family never waives review.
`ROLE_ENGINES.orchestrator` proves no session model.

## Launch evidence

Policy/launch/served identity differ; Codex cannot prove served model.

| Transport | Model | Effort | Served model |
| --- | --- | --- | --- |
| `codex-cli` | Pinned id. | Pinned effort. | Unknown. |
| `claude-cli` | Pin id; match startup. | Explicit, unobserved. | Init + first response; check subscription login separately. |
| `fallback` | Alias; record alias/id assumption. | Runtime default. | Unknown. |
| `claude-code-desktop` | Owner selects. | Unverified. | Unverified. |
