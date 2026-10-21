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
| `prd-before-package-approval` | PRD edit before the owner's start (legacy: package approval). | `mono:discovery` | Repeat affected Discovery and obtain new PRD approval; Handoff then writes a new record version and summary. After the start the PRD change follows `existing-project-targeted-repair`. |
| `tech-page-before-start` | Any approved `mono-tech-page` line changes before work start. | `mono:tech-evaluation` | New page and effective record; Handoff reconciles again and writes a new package version. It never edits the Spec itself. |
| `tech-page-after-start` | Any approved page line changes after start. | `mono:handoff repair` → `mono:tech-evaluation` | Class 3 first: stop workers, supersede start, invalidate dependants and roll back; then new page/record, package review/check and new owner start. |
| `existing-project-targeted-repair` | An existing Project has a package record, Tech Spec, Issue or after-start PRD repair request before pre-ship. | `mono:handoff repair` | Enter the stable-ID classification and class transaction; do not run ordinary package creation. An after-start PRD change: Handoff first prepares the diff, classification and the class's worker stop, revocation and rollback; only then Discovery writes and approves the PRD (before that it may only draft); Handoff finishes. |

Only when neither override matches, apply the front-door order:

1. A raw idea routes to `mono:idea`.
2. An unmistakably one-PR projectless request routes to `mono:issue`.
3. A PRD edit before the start routes to `mono:discovery`; a targeted package
   record, Tech Spec, Issue or after-start PRD repair routes to `mono:handoff`
   repair mode.
4. Other existing Projects: PC-001 (`references/contracts/project.md`) routes via
   Research, approved PRD/Discovery, then ordinary `mono:handoff` packaging.

Any route ambiguity fails closed to the Project-first `mono:handoff` path;
ambiguity inside a proposed repair fails closed to class 3.

An effective Tech Evaluation Spec is an approved input, not a Handoff rewrite target.
A gap changing no page line is closed in package-record decisions. A pre-start
PRD edit changing no page line calls Tech Evaluation to renew the record without
showing the owner; otherwise a new page. After start, repair and accepted
pre-ship drift retain their owners; do not rerun routine approval freshness.

## Stable-ID diff preview

Issue set, membership, count, slicing and dependency topology in every class below
mean [execution Issues](lifecycle.md#задачи-этапов).

Before any durable mutation, show an exact before/after diff grouped by stable ID.
Each changed hunk names the narrowest durable identifier available: artifact
contract rule IDs (`PC-*`, `PR-*`, `TS-*`, `IS-*`) and artifact IDs such as
`R*`, `AE*`, `U*`, `AC*`, or package-record `C*`, `S*`, `T*`. For prose or metadata without its own ID, anchor the
hunk to the governing contract rule ID and name the field. If a hunk cannot be
anchored unambiguously, classify the repair as class 3.

The preview includes classification evidence, not only the proposed class. It
states which semantic surfaces changed and explicitly proves unchanged R/AE/AC, non-goals, risk class, and [execution Issues](lifecycle.md#задачи-этапов) set whenever class 1 or class 2 is proposed.
`mono:review artifact` inspects this preview before `mono:handoff` applies it.

## Classification table

The highest matching class wins. Risk growth always selects class 3. Ambiguity is class 3, including mixed diffs whose semantic effect cannot be proved.

| Fixture | Evidence | Class | Required result |
| --- | --- | --- | --- |
| `typo-or-format` | Only formatting, spelling, or a link correction to the same intended target changes; semantics and all guarded surfaces are unchanged. | `1` | Keep approval valid and do not touch Issues. |
| `how-only` | HOW, architecture, implementation seam, or validation changes while R/AE/AC, non-goals, visible behavior, risk, and [execution Issues](lifecycle.md#задачи-этапов) set are unchanged. | `2` | No owner approval; require `mono:review artifact` and all class 2 effects. |
| `tech-page` | Any line of the approved Tech Evaluation page changes, including tested cases or risk. | `3` | Stop workers and perform class 3 rollback before Tech Evaluation produces a new page/record; then Handoff rebuilds and obtains a new owner start. |
| `requirement` | A requirement is added, removed, or semantically changed. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `acceptance` | An acceptance example or acceptance criterion is added, removed, or semantically changed. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `non-goal` | A non-goal or scope boundary changes. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `risk` | The recorded risk changes or evidence indicates risk growth. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `issue-set` | [execution Issues](lifecycle.md#задачи-этапов) count, slicing, dependency topology, or approved membership changes. | `3` | Supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `visible-behavior` | Externally visible behavior changes even when the written requirement or acceptance IDs were not updated. | `3` | Fail closed on unrecorded product drift; supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |
| `ambiguous` | A changed hunk lacks a stable anchor or evidence cannot prove the class 1/2 guard set unchanged. | `3` | Fail closed; do not infer a lower class; supersede approval, invalidate dependants, require owner re-approval, and roll back Delivery. |

## Package record versions

A package record changes only by a new Project comment version naming its
`previous` version and `class`; earlier versions stay as evidence. The owner's
start binds one version's `sha256` and its Issue set. Before the start there is
nothing to supersede: re-slicing within three Issues is a new version with review,
check and a new summary, without a separate question, and the Project stays Ready.
The start stays bound to the version it named and is never rewritten; later
versions keep it valid only through a verified chain of class 1-2 versions with
protected surfaces and the Issue set unchanged. A class 3 version supersedes that
start; a new owner start on the new summary is required. A legacy package keeps its
Tech Spec and old approval format in every class; its class 3 returns to Discovery
and needs a new owner approval after repair, never an automatic package record.

## Class 1 execution

After a ready `mono:review artifact` report, `mono:handoff` may apply the exact
previewed non-semantic edit. Class 1 keeps package and implementation-start approvals valid. It must not update Issue bodies, Issue snapshots, fingerprints, certificates, worker dispatches, [execution Issues](lifecycle.md#задачи-этапов) slicing, or Project lifecycle state.

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

Project-first implementation-start approval is bound to the unchanged scope and [execution Issues](lifecycle.md#задачи-этапов) set, not to an Issue snapshot fingerprint. Because class 2 proves those approval surfaces unchanged, owner renewal is neither required nor allowed; fresh dispatch is the required non-owner re-authorization for implementation against the synchronized snapshot.

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

Class 3 cannot mutate product scope under an old approval. First stop affected workers before rollback. Then supersede the package approval and supersede the implementation-start approval, invalidate dependent Tech Spec or record version, Issue snapshots, certificates, and [execution Issues](lifecycle.md#задачи-этапов) slicing, and move a Delivery or Ready Project back to Discovery (a package record: back to Ready while it is rebuilt). Preserve the proposed stable-ID diff as evidence, obtain owner
re-approval of the rebuilt package, and start Delivery again only through
`mono:implement`.

The order is safety-critical: stop workers -> supersede approvals -> invalidate dependants -> Delivery or Ready to Discovery (package record: Ready) -> rebuild -> review/check -> owner re-approval (package record: a new owner start). Never keep Delivery active, or a legacy Ready, while a class 3 repair is pending.

## Pre-application manifest repair

The manifest is part of its Tech Spec or package-record `U` unit. A worker finding on
pre-applied `.agents/` files parks blocked with exact replacement bytes;
`mono:handoff` owns the stable-ID preview, review and repair. Classify by meaning:
class 2 only when guarded R/AE/AC, non-goals, visible behavior, risk and [execution Issues](lifecycle.md#задачи-этапов) set
are unchanged, with snapshot synchronization, fingerprint recomputation and
certificate staleness; changed risk/scope selects class 3 with owner reapproval.
After repair, require a NEW `dispatch.mjs --preapply` attempt for [execution Issues](lifecycle.md#задачи-этапов), never amend/resume.
Issue-only manifests live in the Issue and renew through `mono:issue`.
