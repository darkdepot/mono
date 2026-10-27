# Issue-Only Lane Foundation

A one-PR change without Project/PRD/Tech Spec uses the versioned marker, the
5-field context contract, deterministic resolver and no-promotion fallback below.
Assurance vector, route-record and reducer remain outside this phase.

## The Marker

All required: config issueOnlyLane.enabled: true, nonempty ownerPrincipal,
verified exact issue-only Linear label and a fresh authenticated marker approval.
Missing opt-in fails closed to project-first; nobody may infer/write config opt-in.
The label is the filterable human signal, the marker the machine receipt.

A Linear Issue comment starts with an outcome sentence in the configured language
(Russian by default), then the unchanged machine block, per
references/human-friendly-output.md and references/artifact-quality.md:

```text
Пакет переведён в issue-only: один PR, риск обычный.

mono-issue-only marker
Marker version: 1
Scope fingerprint: 3f8a1c0b9d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c
Acceptance IDs: AC1, AC2
Risk class: standard
Approval: 3f8a1c0b9d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c (approved by owner 2026-07-11)
```

Exactly five fields, no extras:
- Marker version: 1; unknown version is a hard violation, never downgrade.
- Scope fingerprint: full 64-hex SHA-256 of the entire minimally normalized Issue
  body, all inline marker blocks removed. Never truncate approval hashes.
- Acceptance IDs: stable AC1, AC2, ... matching the Issue's criteria.
- Risk class: existing review-gate tiny|standard|deep|risky, never a new classifier.
  Cross-check against the Issue's Ревью-гейт; downgrades fail, standard→deep uses
  the higher class. Only tiny/standard are eligible; valid deep/risky falls back.
- Approval: owner's start-approved fingerprint or none. Text is self-attested;
  authenticity requires the caller's matching --approval-verified after checking
  the canonical stable Linear owner user ID, not merely a matching public hash.

The latest standalone mono-issue-only marker line outside fences wins; older
comments are superseded. Prose mentions/fenced examples never opt in. Remove all
inline marker blocks before hashing/risk parsing, including superseded blocks.
Existing approved linear-issue-only marker receipts remain readable; every new
or renewed comment writes mono-issue-only marker.

## Marker ≠ Route-Record

маркер ≠ route-record. It records approved unchanged one-PR scope only.
Forbidden spine fields: route_revision, assurance_vector, required_artifacts.
Any such field makes the marker malformed and rejected, not a future route.

## Trust boundary

Create-then-approve intake alone writes markers: create a non-startable Issue,
record verified owner approval of the full-contract fingerprint, authenticate
comment author against ownerPrincipal, read back, write marker and issue-only
label. Intake never activates delivery; mono:implement owns its check and move.
The upstream pack keeps its own lane disabled with no repository owner principal;
consumers remain disabled until explicit repository opt-in.

Resolver is pure: structure, freshness, eligibility and provenance-agreement,
not identity authentication. The caller supplies trusted --label issue-only and
--approval-verified <fingerprint> after reading Linear. Marker approval, live
scope and verified approval must all agree; absent signals fall back.

## The Context Contract (the seam)

Every consumer first resolves exactly this 5-field contract:

| Field | Domain | Meaning |
| --- | --- | --- |
| package_kind | issue-only \| project-first | Lane authority. |
| lifecycle_state_entity | issue \| project | Authoritative lifecycle carrier. |
| behavioral_oracle | {kind: issue-verification, acceptance_ids, verify_steps} or null | Issue criteria and verify steps, both nonempty. No per-step acceptance-ID trace required; a holistic suite is valid. Phase-3 Live-QA may later add traceability. Project-first: null. |
| risk_class | tiny \| standard or null | Existing review-gate class, read, never re-derived. deep/risky falls back in Phase 1 until Phase-3 safety modules. Project-first: null. |
| approval_status | approved-fresh \| absent | issue-only only when owner-approved/live/caller-verified fingerprints match; otherwise project-first/absent. |

Fail-closed invariant: no marker ⇒ package_kind=project-first. Missing/unrecognizable
marker, absent/disabled config or owner, valid deep/risky, absent verified label
or fresh authenticated approval all return project-first, never a silent lane.
Stale/absent approval is not another issue-only state.

## The Resolver

scripts/resolve-issue-context.mjs follows the deterministic-config-script shape
of scripts/project-config.mjs. Inputs: reads {issue body, marker, config, verified label, verified approval}.

| Input | Contract |
| --- | --- |
| --issue <path> | Required Issue markdown. |
| --marker <path> | Comment source; defaults to Issue body for inline marker. |
| --config <path> | enabled must be true and ownerPrincipal nonempty stable Linear user ID. Missing config/lane, disabled or absent owner means no opt-in; non-object lane or non-boolean enabled hard-fails. No author authentication here. |
| --label <names> | Caller-verified comma-separated full labels; names may contain spaces. Exact issue-only required; not issue-only does not count. |
| --approval-verified <fingerprint> | Caller-authenticated approval; equal to live scope and marker receipt. |
| --emit-fingerprint | Emit the whole-body hash and exit; use for marker authoring and fixtures, never duplicate hashing. |

Output: pretty 5-field JSON, exit 0. Fingerprint: full sha256 over entire body,
all marker blocks removed, trailing whitespace stripped, blank-line runs collapsed,
leading indentation preserved. No section-derived fingerprint. Any edit to scope,
criteria, verification, non-goals, review-gate, headings, indentation or surrounding
prose renews approval. Oracle/risk/completeness parsing never narrows hash coverage;
fences/nesting/duplicates/delimiters cannot provide unbound scope.

Fail-closed outcomes:
- No usable marker: project-first, exit 0.
- Valid marker without config opt-in, eligible risk, verified label or matching
  authenticated fresh approval: project-first, exit 0 (incomplete, not corrupt).
- Marker integrity is checked before config opt-in, even without --config.
- Present invalid marker: process.exit(1), one stable stderr line, never downgrade.
  issue-only-lane: broken marker: … covers unknown version, missing/extra/duplicate
  fields, unparseable machine lines, invalid/mismatched risk, empty oracle,
  incomplete self-contained scope/behavior or non-goals, mismatched Acceptance IDs
  and forbidden route-record fields. issue-only-lane: stale marker: scope fingerprint
  mismatch … covers stale body. issue-only-lane: invalid config: … covers malformed lane.

Not a spine-resolver: no assurance vector, route-record or required_artifacts;
no risk classification, assurance reduction or route computation. Read recorded
risk/approval, check integrity only. Runtime script from installed
<pack-root>/scripts/resolve-issue-context.mjs; repository/plugin paths match,
products never vendor it. Installation: references/install.md.

## Theme project

An issue-only Issue names its theme project in the `Связи` line
`Тематический проект: <name>`, or says `Тематический проект: нет — <причина>`
when no project's theme fits. The line exists for one reason: so a delivered
result is visible in a project's feed, which is where the owner reads what
shipped. `mono:deploy` publishes the closeout update on that project.

It is not part of the lane's contract. It is not a marker field, it is not a
sixth seam field, the resolver never parses it, and it is not a Project
relation — the lane still forbids one. But it IS part of the Issue body, so
the whole-body fingerprint covers it like every other character: adding or
changing it in an already-approved Issue makes that approval stale, and it may
be done only through the full create-then-approve renewal transaction. An
Issue approved before this rule existed carries no such line; that is an
acceptable state, not drift, and closeout records it as `n/a`.

## Deterministic Project-first fallback

Promotion mode: forbidden

There is **No in-place Issue-to-Project promotion**. An Issue that entered the issue-only lane is never converted into, attached to, or reused as the execution Issue of a new Project. Scope/risk escape is a lane exit with a new Project-first package, not a container mutation.

Fallback triggers include a seam that no longer resolves issue-only, stale or absent approval at Delivery Start, a second outcome or PR, unresolved product/UX/architecture/operations judgment, and a preflight diff whose higher risk classification is `deep` or `risky`. Marker-integrity failures remain hard failures with their stable resolver error; they are not silently downgraded.

The five-field seam stays the only lane authority, but callers retain the trusted package provenance they already read to invoke it: whether the Issue has a parent Project and whether verified issue-only marker/label/approval inputs were present. This is not a sixth seam field and never turns a `project-first` result back into `issue-only`. It only prevents an escaped parentless candidate that resolved fail-closed from being mistaken for a complete Project-first package: with no approved Project artifacts, the caller performs the fallback below instead of running Project lifecycle operations.

### Pre-code exit

Exit disposition: park-and-restart-project-first

Before any implementation code exists:

1. Park the original Issue in a non-startable state and record why the issue-only envelope was left.
2. Supersede the authoritative marker without editing the approved Issue contract: write a newest exact five-field marker whose fingerprint, acceptance IDs, and risk still match the live body, but whose receipt is `Approval: superseded`; remove the `issue-only` label. The resolver then returns the exact project-first seam. The original approval is annulled and can never authorize the restart.
3. Restart through `mono:idea` → discovery/handoff as a new Project-first package with new approval. Do not add a Project, PRD, Tech Spec, or Project relationship to the parked Issue. The other allowed outcome is cancellation.

### Post-`ready` exit

Frozen slice disposition: ship-unchanged-or-cancel

Expansion destination: separate-follow-up-project

After a `mono:preflight` certificate already says `ready`, freeze the independently shippable Issue slice and its current PR scope. A frozen approval remains valid only while the whole-body fingerprint matches: do not edit the Issue body, acceptance IDs, marker fingerprint, or frozen implementation scope. Ship and deploy only that frozen slice as-is, and put every expanded outcome into a separate follow-up Project with its own PRD, Tech Spec, Issue, review, and approval. Set that follow-up Project's lead to the acting user (`lead: "me"` on the Linear connector) and the assignee of every Issue created in it to the same acting user (`assignee: "me"`) at creation, and never overwrite an assignment that already exists. If the current slice cannot remain independently shippable or its fingerprint no longer matches, cancel it instead; do not repair it by promotion.

An escalation discovered after code exists but before `ready` exits preflight as `drift-candidate`. Because there is no ready independently shippable slice to freeze, the safe choices are to cancel the issue-only attempt and restart Project-first, or stop for the orchestrator's risk decision. In every timing case, in-place promotion is forbidden.
