# Model Policy

This is the only source of executable model identifiers in the active pack.
Agents resolve a role before preparing a command, dispatch or certificate;
those outputs record resolved values, never create another model source.
Use a `role:<role>` Markdown link to this document's `#roles` section for
every normative role reference. The validator checks both the role and the
consumer that uses it; an arbitrary role mention is not a binding.

## Roles

| Role | Model id | Reasoning effort | Applies to | Decided by |
| --- | --- | --- | --- | --- |
| `orchestrator` | `claude-fable-5-1` | n/a | Orchestrator session; effort is not set by this policy. | Owner, 2026-09-06. |
| `second-voice` | `gpt-6-astra` | `high` | Second Voice for a Claude orchestrator; effort source: the approved Second Voice rule, both sides at high reasoning. | Owner, 2026-09-06. |
| `second-voice-alt` | `claude-opus-5` | `high` | Second Voice for a GPT orchestrator; effort source: the same approved Second Voice rule. Independent of the Claude worker role. | Owner, 2026-09-06. |
| `worker-default` | `gpt-5.6-sol` | `high` | Default Codex worker; effort source: the existing worker spawn command. | Owner, 2026-09-06. |
| `worker-complex` | `gpt-6-astra` | `high` | Complex Codex work, selected per dispatch by orchestrator judgment with a recorded reason; never selected automatically by risk class. Effort source: the existing worker spawn command. | Owner, 2026-09-06. |
| `worker-claude` | `claude-opus-5` | `high` | Claude worker transports; effort source: the existing worker spawn target, subject to the transport guarantees below. | Owner, 2026-09-06. |
| `autoreview` | `claude-opus-5` | [Canonical Routes](autoreview-routing.md#canonical-routes) | Mandatory preflight reviewer; effort comes only from the final risk route. | Owner-approved reviewer/producer pairing, 2026-09-06. |

## Reviewer and producer

The owner approved the pairing of the worker roles with the reviewer role in
this table. The reviewer must be at least as capable as the code's producer.
The table records that decision; it does not prove model capability. Any change
that breaks, or cannot establish, reviewer capability at least equal to the
producer requires an explicit owner decision BEFORE editing a model cell.
Same-model review limitations apply whenever the resolved worker and reviewer
identifiers match, regardless of the role names or transport.

## Audience profile

`workerAudience` controls dispatch redundancy, not model selection. Its fit
for future models is an unverified assumption; a model cell change does not
change that profile or prove its suitability.

## Application boundary

New policy values apply to new launches after pack installation. Running
threads keep their launch pins; resumes use those recorded pins, not freshly
resolved table values. Never backfill old registry entries from a new policy.
Missing fields remain unknown. The existing pack identity gate still forbids
resuming a thread across a changed pack identity.

## Orchestrator self-check

At session start, compare the authoritative model identifier reported by the
launch environment with the `orchestrator` row. Report exactly one outcome:
«Модель оркестратора: по политике | не по политике | не удалось проверить».
A matching identifier means «по политике»; a different one means «не по
политике». Without an authoritative identifier report «не удалось проверить».
Prompt self-identification is not evidence. This check neither switches a
running session nor audits its model during execution.

## Launch evidence

For Codex roles, evidence is the requested launch parameters: Codex output does
not report the actual served model. Keep policy intent, parameters actually
set, and unknown served identity separate in dispatches and registry records.

| Transport case | Model parameter | Effort parameter | Actual served model |
| --- | --- | --- | --- |
| `codex-cli` | Exact resolved model id pinned in the launch command. | Resolved row effort pinned in the launch command. | Unknown; requested parameters are the evidence. |
| `fallback` | Agent tool `model` parameter set through a runtime alias; alias-to-id correspondence is a runtime assumption, recorded explicitly. | Not controllable: runtime default, never the policy target reported as set. | Unknown. |
| `claude-code-desktop` | Owner selects manually in the interface. | Not verified; do not infer it from policy intent. | Manually selected, actual model unverified. |
