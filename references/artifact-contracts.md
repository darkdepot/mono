# Artifact contracts

This index is the stable entry point for the four bounded Linear artifact
contracts. A contract owns artifact-specific normative behavior; shared policy
continues to live in the linked `references/` documents, and presentation shape
continues to live in `templates/`.

- [project](contracts/project.md)
- [prd](contracts/prd.md)
- [tech-spec](contracts/tech-spec.md)
- [issue](contracts/issue.md)

Rule IDs are permanent addresses. New rules receive new IDs; removed rules stay
reserved rather than being renumbered. The parity ledger maps every normative
purpose, routing, rule, lifecycle/status, and finish-check statement to exactly
one contract rule. `Read first` lists are dependency metadata, not artifact
rules, and are intentionally outside the ledger.

The consumers column names the stage skills and guards that own adoption.
Project, PRD, Tech Spec, and Issue now use their bounded contracts as the active
rule source after the compatibility adapters were retired. Validator pins cover
every bounded contract and its direct lifecycle consumers.

## Project parity

| Contract source | Rule ID | Named consumers |
| --- | --- | --- |
| `references/contracts/project.md#PC-001` | `PC-001` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-002` | `PC-002` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-003` | `PC-003` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-004` | `PC-004` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-005` | `PC-005` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-006` | `PC-006` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-007` | `PC-007` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-008` | `PC-008` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-009` | `PC-009` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-010` | `PC-010` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-011` | `PC-011` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-012` | `PC-012` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-013` | `PC-013` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-014` | `PC-014` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-015` | `PC-015` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-016` | `PC-016` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-017` | `PC-017` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/project.md#PC-018` | `PC-018` | `mono:idea`, `mono:handoff`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |

## PRD parity

| Contract source | Rule ID | Named consumers |
| --- | --- | --- |
| `references/contracts/prd.md#PR-001` | `PR-001` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-002` | `PR-002` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-003` | `PR-003` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-004` | `PR-004` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-005` | `PR-005` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-006` | `PR-006` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-007` | `PR-007` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-008` | `PR-008` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-009` | `PR-009` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-010` | `PR-010` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-011` | `PR-011` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-012` | `PR-012` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-013` | `PR-013` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-014` | `PR-014` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-015` | `PR-015` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-016` | `PR-016` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-017` | `PR-017` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-018` | `PR-018` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-019` | `PR-019` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-020` | `PR-020` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-021` | `PR-021` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-022` | `PR-022` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-023` | `PR-023` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-024` | `PR-024` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-025` | `PR-025` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-026` | `PR-026` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-027` | `PR-027` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-028` | `PR-028` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-029` | `PR-029` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-030` | `PR-030` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-031` | `PR-031` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/prd.md#PR-032` | `PR-032` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |

## Tech Spec parity

| Contract source | Rule ID | Named consumers |
| --- | --- | --- |
| `references/contracts/tech-spec.md#TS-001` | `TS-001` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-002` | `TS-002` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-003` | `TS-003` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-004` | `TS-004` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-005` | `TS-005` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-006` | `TS-006` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-007` | `TS-007` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-008` | `TS-008` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-009` | `TS-009` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-010` | `TS-010` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-011` | `TS-011` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-012` | `TS-012` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-013` | `TS-013` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-014` | `TS-014` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-015` | `TS-015` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-016` | `TS-016` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-017` | `TS-017` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-018` | `TS-018` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-019` | `TS-019` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-020` | `TS-020` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-021` | `TS-021` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-022` | `TS-022` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-023` | `TS-023` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-024` | `TS-024` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-025` | `TS-025` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-026` | `TS-026` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-027` | `TS-027` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-028` | `TS-028` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-029` | `TS-029` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-030` | `TS-030` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-031` | `TS-031` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-032` | `TS-032` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-033` | `TS-033` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-034` | `TS-034` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/tech-spec.md#TS-035` | `TS-035` | `mono:handoff`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |

## Issue parity

| Contract source | Rule ID | Named consumers |
| --- | --- | --- |
| `references/contracts/issue.md#IS-001` | `IS-001` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-002` | `IS-002` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-003` | `IS-003` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-004` | `IS-004` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-005` | `IS-005` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-006` | `IS-006` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-007` | `IS-007` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-008` | `IS-008` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-009` | `IS-009` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-010` | `IS-010` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-011` | `IS-011` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-012` | `IS-012` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-013` | `IS-013` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-014` | `IS-014` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-015` | `IS-015` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-016` | `IS-016` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-017` | `IS-017` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-018` | `IS-018` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-019` | `IS-019` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-020` | `IS-020` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-021` | `IS-021` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-022` | `IS-022` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-023` | `IS-023` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-024` | `IS-024` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-025` | `IS-025` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-026` | `IS-026` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-027` | `IS-027` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-028` | `IS-028` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-029` | `IS-029` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-030` | `IS-030` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-031` | `IS-031` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-032` | `IS-032` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-033` | `IS-033` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
| `references/contracts/issue.md#IS-034` | `IS-034` | `mono:handoff`, `mono:issue`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:check`, `mono:review`, `scripts/lint-mono-artifacts.mjs` |
