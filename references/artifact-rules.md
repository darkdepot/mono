# Linear Artifact Rules

Linear-facing content must follow the project config language policy.

If no project config is present, use Russian for:

- Project summary/body
- PRD
- Tech Spec
- Issue description
- Linear comments

Repo skill instructions must be in English.

Source-of-truth policy:

- Linear owns requirements and implementation contracts.
- GitHub owns PR/review/CI/deploy/merge history.
- GitHub Issues are not the implementation source of truth.
- `/office-hours`, `/brainstorming`, `/plan-design-review`, and `/plan-eng-review` outputs are discovery inputs until `mono-handoff` persists them to Linear.
- Local markdown plans are temporary execution scratch unless explicitly promoted into Linear by `mono-handoff`.
- Artifact intake follows `references/artifact-intake.md`: local discovery files are scoped evidence, not broad-search source of truth.
- Projects and Issues the agent creates are owned by the acting user: `mono-idea` sets the Project lead at creation, `mono-handoff` and `mono-issue` set the Issue assignee at creation, and existing assignments are never overwritten. The remaining creation points — hotfix Issues filed from `mono-deploy` or `mono-orchestrate`, and follow-up Projects from `mono-preflight` and the issue-only lane — follow the same rule and are aligned by a separate slice (MONO-56).

Document policy:

- Active Project document types for this MVP are PRD and Tech Spec.
- Project body is a concise product brief with only five concerns: what, why, target outcome, in scope, and out of scope. Render headings in the project config language; default Russian headings are `Что`, `Зачем`, `Образ результата`, `Что входит`, and `Что не входит`.
- Do not put active docs, active issues, lifecycle bookkeeping, status tracking, or workflow mechanics in the Project body.
- PRD is the WHAT artifact. It defines operator, problem, target workflow, requirements, acceptance examples, success criteria, and non-goals.
- Tech Spec is the HOW artifact. It defines architecture, contracts, boundaries, risks, files/surfaces, validation, rollout, and rollback against the approved PRD.
- Issue is the one-PR execution contract. It should be enough for a zero-context implementation agent without copying the whole PRD or Tech Spec.
- Execution quality follows `references/execution-quality.md`: PRDs cover actor, capability, and benefit; Issues state `AFK` or `HITL`, dependencies, key contracts, and bug/perf feedback-loop proof when relevant.
- Prefer content-shape correctness over exact heading policing. Headings help readers, but the hard contract is responsibility separation: Project = product brief, PRD = WHAT, Tech Spec = HOW, Issue = execution.
- Attach PRD and Tech Spec to the Project, not to the Issue.
- The Issue should contain chips and an implementation-critical snapshot, not attached docs.
- Add PRD and Tech Spec as Issue resources/links when the connector supports it.
- Use Linear chips/entity mentions where available.
- Do not leave obsolete or closed PR chips in durable Project, PRD, Tech Spec, or Issue body.
- Do not use raw PR/document URLs in durable body when Linear chips can represent the entity.
- Keep workflow mechanics internal to skills, checks, and handoff summaries; do not leak `mono-check`, lifecycle gates, or agent instructions into Linear-facing Project, PRD, Tech Spec, or Issue bodies.

Review policy:

- User review acceptance is recorded as a Linear comment.
- Package approval authorizes durable Project/PRD/Tech Spec updates and Issue creation from the previewed package. The approval comment should name the approved package, PRD/Tech Spec links or intended titles, approved Issue slice titles or ids, and whether implementation may start.
- For the issue-only lane, package approval is the scope fingerprint. The owner approves the exact whole-body SHA-256 of the Issue contract, computed by `scripts/resolve-issue-context.mjs --emit-fingerprint`, through the create-then-approve intake transaction: create a non-startable Issue, record an owner approval comment (authored by the canonical owner principal) naming the fingerprint, verify the author and read back, then write the `mono-issue-only marker` plus the `issue-only` label. The intake remains non-activating; `mono-implement` owns the later Issue lifecycle move after re-resolution and the delivery check. Editing any part of the Issue body after approval changes the whole-body fingerprint and makes the approval stale, so it must be renewed. See `references/issue-only-lane.md` and `skills/mono-issue/SKILL.md`.
- If approval is missing, rejected, changes are requested, or the approval comment cannot be recorded, do not create execution Issues, do not move the Project to Delivery, and return `BLOCKED` or `INCOMPLETE` with current links.
- Implementation-start approval is owned by `mono-implement`. `mono-handoff` may record that implementation may start, but `mono-implement` verifies or obtains that approval before moving the Project to Delivery.
- Project Updates are not a required gate.
- `mono-deploy` publishes one project update per deployed Issue as an informational result of closeout, and completes the project when that shipment was its last. Neither is a gate: a failure is recorded and visible, and the deploy verdict does not change.
- `mono-review` is report-only. It returns findings, proposed fixes, decisions, FYI notes, verdict, risk, and next workflow.
- `mono-check` reports drift; it does not silently fix it.
- `mono-check` owns `PASS`, `FAIL`, and `BLOCKED`; `mono-review` must not use those as its main status.
- `mono-handoff`, explicit atomic skills, or `mono-ship` apply accepted fixes from a review report.
- `mono-implement` owns Delivery Start and implementation execution from approved Issue(s).
- `mono-preflight` owns local branch readiness, targeted verification, the mandatory `autoreview` clean gate, commit state, and preflight certificate.
- `mono-ship` owns formal pre-ship review/check, PR creation, repo documentation before final green, review-loop stabilization, and the `mono-ship green certificate`.
- `mono-deploy` owns deploy workflow delegation, verified delivery evidence, post-ship check, Linear closeout, and durable learning capture.
- Risk-based review gates follow `references/readiness-gates.md`.
- Tiny PRD-lite or no-spec exceptions may use advisory review only when the exception and reason are recorded.
- Raw discovery implementation plans must not be approved directly in this workflow; run `mono-handoff` first.
