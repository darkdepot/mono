# Mono Review Rubric

Use this rubric from `mono:review` to inspect Linear Project, PRD, Tech Spec, and Issue packages.

`mono:review` is report-only. It must not create, update, delete, or silently repair Linear artifacts.

## Inputs

- Fresh Linear Project.
- Fresh PRD document, when expected.
- Fresh Tech Spec document, when expected.
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
- Active docs are PRD and Tech Spec unless an explicit exception exists.
- Active Issues represent current approved execution plan.
- No stale PR chips or raw PR URLs remain.

PRD:

- Defines WHAT and target operator.
- Requirements are stable and checkable.
- Requirements and scenarios cover actor, capability, and benefit.
- Flows and acceptance examples cover stateful or conditional behavior.
- Behavior-validation intent gives Tech Spec and Issue a product-facing proof target.
- Non-goals and assumptions prevent downstream invention.

Tech Spec:

- Defines HOW and traces to PRD requirements.
- Implementation units are stable and independently understandable.
- Failure modes, validation, rollout, and rollback are concrete.
- Deep/risky specs use the interface as the test surface and pass the deletion-test smell check.
- No-spec exception is justified when present.

Issue:

- One PR by default.
- Includes `Прочитать сначала` / Read first context, context snapshot, validation, acceptance, and non-goals.
- States `AFK` or `HITL`, dependencies, and blockers.
- For bug/perf work, includes current vs desired behavior and a reproduction, baseline, or feedback-loop expectation.
- Is durable: no line numbers, brittle edit scripts, or procedural choreography.
- Uses Project, PRD, and Tech Spec chips.
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
  visible-behavior change and the ordered rollback: worker stop, approval
  supersession, dependent invalidation, Delivery to Discovery, owner
  re-approval.
- Ambiguity or risk growth is class 3. A mixed or unanchored diff cannot receive
  a lower advisory classification.

## Finding Format

Each finding must include:

- Tier: `blocking`, `proposed-fix`, `decision`, or `fyi`.
- Artifact: Project, PRD, Tech Spec, Issue, or Ship.
- Evidence: short quote or artifact section reference.
- Impact: what goes wrong if ignored.
- Recommendation: concrete next action.
- Owner workflow: `mono:handoff`, `mono:implement`, `mono:preflight`, `mono:ship`, `mono:deploy`, `mono:issue`, or human decision.

## Report Shape

Use `templates/review-output.md`.

Do not emit `PASS`, `FAIL`, or `BLOCKED` as the main review status. Those words belong to `mono:check`.

Allowed review verdicts:

- `ready`
- `advisory-ready`
- `needs-fixes`
- `blocked`
