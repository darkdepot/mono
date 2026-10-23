# Mono Review Rubric

Use this rubric from `mono:review` to inspect Linear Project, PRD, Tech Spec, and Issue packages.

`mono:review` is report-only. It must not create, update, delete, or silently repair Linear artifacts.

## Inputs

- Fresh Linear Project.
- Fresh PRD document, when expected.
- Fresh Tech Spec document, when expected.
- Package record (current Project comment version, or its draft in pre-write `handoff`), when expected; its `U` units and Issues carry failure modes, validation, rollout and rollback where a Tech Spec would.
- Fresh Issue(s), when expected.
- Discovery and review context when available.
- Preflight certificate when running `pre-ship` and one exists.
- Project config for language, team, and configured workflows.
- Execution quality expectations from `references/execution-quality.md`.

## Persona Lenses

Always apply:

- Coherence: artifact sections agree with each other.
- Feasibility: the proposed delivery can be implemented and verified.
- Scope: Issue slicing and non-goals keep the work to a one-PR contract by default.
- Agent readiness: Issues are durable, independently verifiable, and honest about `AFK` vs `HITL`.

Apply conditionally:

- Product: problem, operator, workflow, and acceptance are clear enough.
- Design: UI/product-surface flows, states, and edge cases are represented.
- Security/data: auth, permissions, privacy, migration, production data, or public API risks exist.
- Ship: preflight certificate, pre-ship review, documentation-before-green, PR mapping, and green certificate state are coherent.
- Architecture: deep/risky work has a real seam or stable interface and avoids shallow pass-through abstractions.

## Checks

Project:

- Lifecycle status matches current stage.
- Active docs are PRD, Tech Spec (only when it exists), and Research («Исследование»); the package record is a Project comment.
- Active Issues represent current approved execution plan.
- No stale PR chips or raw PR URLs remain.

PRD:

- Defines WHAT and target operator.
- Requirements are stable and checkable.
- Requirements and scenarios cover actor, capability, and benefit.
- Flows and acceptance examples cover stateful or conditional behavior.
- Behavior-validation intent gives Tech Spec and Issue a product-facing proof target.
- Non-goals and assumptions prevent downstream invention.

Package record:

- Input versions name the approved PRD and Research; reconciliation findings are resolved; shared `U` decisions cover what several Issues need (deep/risky: at least one).
- One Issue unless a recorded `too-big`, `shared-base` or `probe` reason; at most three without the owner; every PRD requirement has an Issue and every Issue a requirement.
- No `approval_status`, `mono-idea:` or `mono-idea-snapshot` inside it.

Tech Spec:

- Defines HOW and traces to PRD requirements.
- Implementation units are stable and independently understandable.
- New Specs are written only by Tech Evaluation after page approval; legacy repair is Handoff, accepted pre-ship drift Ship. The effective `mono-tech` record and fresh Spec read-back agree.
- Only non-inferable, expensive-to-redo details remain, with concrete validation and applicable failure/release/rollback decisions; no empty sections.
- Deep/risky specs use the interface as the test surface and pass the deletion-test smell check.
- No-spec exception is justified when present; it cannot replace the Spec on the Tech Evaluation route. Old-path/tiny package records retain their `U` decisions.
- Handoff carries approved Spec decisions into `U` units and Issue key contracts; any change to a page line returns to Tech Evaluation (after start, class 3 repair first).

Issue:

- One PR by default.
- Includes `Прочитать сначала` / Read first context, context snapshot, validation, acceptance, and non-goals.
- States `AFK` or `HITL`, dependencies, and blockers.
- For bug/perf work, includes current vs desired behavior and a reproduction, baseline, or feedback-loop expectation.
- Is durable: no line numbers, brittle edit scripts, or procedural choreography.
- Uses Project and PRD chips, the Tech Spec chip only when it exists, and a package-record link for a package record.
- Does not attach PRD or Tech Spec docs.

Pre-ship:

- Preflight certificate is consumed when present, or missing local readiness is called out.
- Branch or PR scope still matches Linear artifacts.
- Bug/perf PRs report original symptom or baseline, fix proof, and regression proof or documented test-seam gap.
- Material drift is synced or explicitly accepted.
- Review feedback and unresolved decisions are represented.
- Documentation workflow ran before the final green certificate when configured.
- Green certificate records the reviewed head SHA and next `mono:deploy`.

Repair classification:

- The proposed class is checked against the exact stable-ID diff, not the
  repair author's label alone.
- Class 1 evidence proves the edit is non-semantic and preserves approvals and
  Issues.
- Class 2 evidence proves unchanged R/AE/AC, non-goals, visible behavior, risk,
  and Issue set, and names all three effects: snapshot-sync with fingerprint
  re-derivation, stale-preflight-cert disposition, and stale worker stop.
- Class 3 evidence covers requirement/acceptance/non-goal/risk/Issue-set or
  visible-behavior change and the ordered rollback: worker stop, approval or
  start supersession, dependent invalidation, Delivery to Discovery (legacy
  package) or to Ready (package record), owner re-approval or a new owner start.
- Ambiguity or risk growth is class 3. A mixed or unanchored diff cannot receive
  a lower advisory classification.

## Finding Format

Each finding must include:

- Tier: `blocking`, `proposed-fix`, `decision`, or `fyi`.
- Artifact: Project, PRD, Tech Spec, Issue, or Ship.
- Evidence: short quote or artifact section reference.
- Impact: what goes wrong if ignored.
- Recommendation: concrete next action.
- Owner workflow: `mono:tech-evaluation`, `mono:discovery`, `mono:handoff`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:deploy`, `mono:issue`, or human decision.

## Report Shape

Use `templates/review-output.md`.

Do not emit `PASS`, `FAIL`, or `BLOCKED` as the main review status. Those words belong to `mono:check`.

Allowed review verdicts:

- `ready`
- `advisory-ready`
- `needs-fixes`
- `blocked`
