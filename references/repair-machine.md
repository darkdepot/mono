# Artifact Repair Machine

Use this contract for targeted repair of an existing **Project-first** package.
`mono:handoff` owns the mutation, `mono:review artifact` checks the proposed
classification report-only, and `mono:check repair` reports whether the repair
effects are complete. This mode is additive: ordinary handoff creation and every
existing lifecycle route keep their current behavior.

## Routing boundary

Evaluate stage-specific ownership before the general front-door order. Accepted pre-ship drift is a terminal ownership override evaluated before the general existing-Project route. An edit to an existing issue-only Issue body is also a terminal override and routes to the create-then-approve renewal transaction in `mono:issue`, never to handoff repair.

| Fixture | Evidence | Owner | Result |
| --- | --- | --- | --- |
| `existing-project-pre-ship-drift` | An existing Project has drift accepted during pre-ship. | `mono:ship` | Run accepted drift sync in ship; do not enter handoff repair. |
| `issue-only-body-edit` | An existing issue-only Issue body needs any edit. | `mono:issue` | Run create-then-approve renewal; do not enter handoff repair. |
| `existing-project-targeted-repair` | An existing Project has a targeted PRD or Tech Spec repair request before pre-ship. | `mono:handoff repair` | Enter the stable-ID classification and class transaction; do not run ordinary package creation. |

Only when neither override matches, apply the front-door order:

1. A raw idea routes to `mono:idea`.
2. An unmistakably one-PR projectless request routes to `mono:issue`.
3. A targeted PRD or Tech Spec repair in a Project-first package routes to
   `mono:handoff` repair mode.
4. Existing Project or shaped discovery context that is not a targeted repair
   routes to ordinary `mono:handoff` package creation.

Any route ambiguity fails closed to the Project-first `mono:handoff` path;
ambiguity inside a proposed repair fails closed to class 3.

## Stable-ID diff preview

Before any durable mutation, show an exact before/after diff grouped by stable ID.
Each changed hunk names the narrowest durable identifier available: artifact
contract rule IDs (`PC-*`, `PR-*`, `TS-*`, `IS-*`) and artifact IDs such as
`R*`, `AE*`, `U*`, or `AC*`. For prose or metadata without its own ID, anchor the
hunk to the governing contract rule ID and name the field. If a hunk cannot be
anchored unambiguously, classify the repair as class 3.

The preview includes classification evidence, not only the proposed class. It
states which semantic surfaces changed and explicitly proves unchanged R/AE/AC, non-goals, risk class, and Issue set whenever class 1 or class 2 is proposed.
`mono:review artifact` inspects this preview before `mono:handoff` applies it.

## Classification table

The highest matching class wins. Risk growth always selects class 3. Ambiguity is class 3, including mixed diffs whose semantic effect cannot be proved.

| Fixture | Evidence | Class | Required result |
| --- | --- | --- | --- |
| `typo-or-format` | Only formatting, spelling, or a link correction to the same intended target changes; semantics and all guarded surfaces are unchanged. | `1` | Keep approval valid and do not touch Issues. |
| `how-only` | HOW, architecture, implementation seam, or validation changes while R/AE/AC, non-goals, visible behavior, risk, and Issue set are unchanged. | `2` | No owner approval; require `mono:review artifact` and all class 2 effects. |
| `requirement` | A requirement is added, removed, or semantically changed. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `acceptance` | An acceptance example or acceptance criterion is added, removed, or semantically changed. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `non-goal` | A non-goal or scope boundary changes. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `risk` | The recorded risk changes or evidence indicates risk growth. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `issue-set` | Issue count, slicing, dependency topology, or approved Issue membership changes. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `visible-behavior` | Externally visible behavior changes even when the written requirement or acceptance IDs were not updated. | `3` | Fail closed on unrecorded product drift; supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `ambiguous` | A changed hunk lacks a stable anchor or evidence cannot prove the class 1/2 guard set unchanged. | `3` | Fail closed; do not infer a lower class; supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |

## Class 1 execution

After a ready `mono:review artifact` report, `mono:handoff` may apply the exact
previewed non-semantic edit. Class 1 keeps package and implementation-start approvals valid. It must not update Issue bodies, Issue snapshots, fingerprints, certificates, worker dispatches, Issue slicing, or Project lifecycle state.

## Class 2 execution

Class 2 needs no owner touch, but it is never silent. Require a ready
`mono:review artifact` report that confirms the stable-ID diff and guarded
surfaces. Before mutation, identify affected Issues, preflight certificates, and
active workers. Class 2 stops or quiesces every affected active worker before
any repair mutation, as defined by the stale-worker-stop fixture. Only after all
affected workers are quiescent, apply the previewed artifact repair, then execute
the remaining snapshot-sync and stale-preflight-cert effects as one repair
transaction. If any effect cannot complete, stop and report the partial state;
do not claim the repair ready.

Project-first implementation-start approval is bound to the unchanged scope and Issue set, not to an Issue snapshot fingerprint. Because class 2 proves those approval surfaces unchanged, owner renewal is neither required nor allowed; fresh dispatch is the required non-owner re-authorization for implementation against the synchronized snapshot.

## Class 2 effect fixture: snapshot-sync

For every affected execution Issue, synchronize the implementation-critical fields
copied from the repaired artifact while leaving unrelated Issue scope untouched.
Then re-derive each affected Issue snapshot fingerprint from the complete updated
snapshot using the package's canonical fingerprint procedure. Record the old and
new fingerprints as repair evidence. A body edit to an issue-only Issue is not
this effect; it requires `mono:issue` renewal.

## Class 2 effect fixture: stale-preflight-cert

The authoritative `mono-preflight certificate` is stale when it was issued before the repair mutation. Mark it stale in repair evidence: the affected branch must rerun `mono:preflight`; an older green or ready result cannot authorize
ship after the repair. A certificate issued after the repair against the current
Issue snapshot fingerprint remains eligible.

## Class 2 effect fixture: stale-worker-stop

Before changing the artifact or Issue snapshots, stop or quiesce every affected active worker before the repair mutation. No affected worker may execute during the repair transaction.

For each affected active worker, compare its dispatch snapshot fingerprint with
the re-derived fingerprint. When the dispatch snapshot fingerprint differs from the re-derived fingerprint, the worker must stop before any further implementation step. Resume only through a fresh dispatch that carries the new fingerprint;
thread memory or an in-place verbal update is not a substitute.

## Class 3 rollback

Class 3 cannot mutate product scope under an old approval. First stop affected workers before rollback. Then supersede the package approval and supersede the implementation-start approval, invalidate dependent Tech Spec, Issue snapshots, certificates, and Issue slicing, and move a Delivery Project back to Discovery. Preserve the proposed stable-ID diff as evidence, obtain owner
re-approval of the rebuilt package, and start Delivery again only through
`mono:implement`.

The order is safety-critical: stop workers -> supersede approvals -> invalidate dependants -> Delivery to Discovery -> rebuild -> review/check -> owner re-approval. Never keep Delivery active while a class 3 repair is pending.

## Pre-application manifest repair

The manifest is part of its Tech Spec implementation unit. A worker finding on
pre-applied `.agents/` files parks blocked with exact replacement bytes;
`mono:handoff` owns the stable-ID preview, review and repair. Classify by meaning:
class 2 only when guarded R/AE/AC, non-goals, visible behavior, risk and Issue set
are unchanged, with snapshot synchronization, fingerprint recomputation and
certificate staleness; changed risk/scope selects class 3 with owner reapproval.
After repair, require a NEW `dispatch.mjs --preapply` attempt, never amend/resume.
Issue-only manifests live in the Issue and renew through `mono:issue`.
