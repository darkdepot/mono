# Mono Agent Workflow

Reusable Mono workflow skills for AI coding agents.

Canonical repository: [github.com/darkdepot/mono](https://github.com/darkdepot/mono).

The workflow keeps Linear as the source of truth from raw idea to landed PR:

```text
mono-idea -> discovery/reviews -> mono-handoff -> approved Issue(s) -> mono-implement -> mono-preflight -> mono-ship -> mono-deploy
```

GitHub remains the branch, PR, review, CI, deploy, and merge-history surface. Linear owns the Project, PRD, Tech Spec, Issue contract, review acceptance, and drift notes.

## Skills

- `mono-idea`: raw idea intake, AskQuestion mini-grill, Project in Idea.
- `mono-issue`: atomic front door for genuinely one-PR, projectless issue-only work; owns the create-then-approve fingerprint transaction and fails closed to Project-first.
- `mono-handoff`: primary post-discovery bridge into Project, PRD, Tech Spec, package approval, and Issue(s).
- `mono-review`: report-only artifact quality and risk review.
- `mono-check`: report-only transition readiness checks.
- `mono-implement`: Delivery Start and implementation execution from approved Issue(s).
- `mono-preflight`: local branch readiness, targeted verification, mandatory risk-routed Opus 5 `autoreview` clean gate, and preflight certificate.
- `mono-ship`: wrapper around configured project ship, documentation, review feedback, and green certificate workflows.
- `mono-deploy`: wrapper around configured project deploy, post-ship check, Linear closeout, and learning capture workflows.
- `mono-orchestrate`: control-plane orchestrator session per product; drives projects and Issues through worker sessions, decides technical questions itself, escalates only product decisions (scope, design, risk); runs discovery in director mode — a Second Voice reviewer agent interrogates, the orchestrator answers, and the user gets reviewed prototypes at checkpoints; reports to the owner in product language (what the product now does, never Issue keys or stages as the subject; «Нужно от тебя:» always last).

The workflow includes an execution quality layer inspired by proven agent-skill
guardrails: PRDs must cover actor, capability, and benefit; Issues must be
durable AFK/HITL execution contracts; bug/perf work must carry a feedback-loop
proof expectation; and deep/risky work gets an architecture-quality lens.

## Workflow

```text
raw idea
-> /mono-idea outside Plan Mode
-> Linear Project in Idea

optional Plan Mode discovery
-> /office-hours or /brainstorming
-> /plan-design-review if UI/product surface
-> /plan-eng-review when architecture is ready

when final discovery/review plan appears
-> do not approve direct implementation
-> run /mono-handoff

/mono-handoff
-> if still in Plan Mode: produce handoff exit-plan
-> inspect scoped discovery/review artifacts through artifact intake
-> draft package and ask package approval before durable writes
-> after approval: update Linear artifacts
-> run required/advisory mono-review gate
-> apply accepted artifact fixes
-> create Linear Issue(s)
-> stop with approved Issue(s), or route explicit implementation-start approval to mono-implement

/mono-implement
-> verify implementation-start approval
-> move Project to Delivery when ready
-> run/report mono-check delivery
-> select implementation engine and implement from approved Issue(s)
-> exit to mono-preflight

/mono-preflight
-> inspect branch/worktree/diff
-> classify final risk, select the explicit route from references/autoreview-routing.md, and run mandatory autoreview until clean
-> commit when safe/configured
-> emit preflight certificate

/mono-ship
-> consume preflight certificate when present
-> run pre-ship mono-review and mono-check pre-ship when required
-> create/sync PR through configured ship workflow
-> run repo documentation workflow before final green when configured
-> stabilize review/CI/Greptile
-> emit mono-ship green certificate

/mono-deploy
-> consume mono-ship green certificate
-> verify current PR head SHA still matches
-> run configured Deploy workflow
-> run/report mono-check post-ship
-> close Linear and record durable learnings
```

Orchestrated mode (optional):

```text
/mono-orchestrate (one session per product)
-> resume state from Linear + ledger + mailbox + worker registry
-> run idea/discovery/handoff in-session (Director Discovery + Second Voice: checkpoints, not question streams)
-> dispatch one worker per Issue (implement -> preflight -> ship)
-> answer technical questions; escalate scope/design/risk as decision briefs
-> run mono-deploy per deployApproval policy
```

Recommended pairing: a Claude Code orchestrator session with one headless
Codex CLI worker per Issue (`codex-cli` transport — `codex exec` spawns,
resumable threads across stages, mailbox reports, `workers.json` registry for
resume). Set `orchestration.transport` in the project config or let the
orchestrator detect the runtime; see `references/orchestration.md`.

Discovery artifacts from `/office-hours`, `/brainstorming`, and reviews are inputs, not durable Linear truth. Linear becomes current when `mono-handoff` persists the package.

Use `mono-handoff` for post-discovery packaging, direct requests to write or repair a PRD or Tech Spec, scope changes, or any state where Project, PRD, Tech Spec, and execution Issues are not current together. Raw requests to create a new Project start at `mono-idea`; accepted pre-ship drift belongs to `mono-ship`.

PRD and Tech Spec creation does not mean Delivery. A Project should move to Delivery only through `mono-implement` after approved execution Issue(s) exist and implementation-start approval is explicit.

## Install Locally

Install or update the workflow as a local skill pack from this upstream checkout:

```bash
node scripts/install-local.mjs --remove-stale
```

For a breaking skill-surface revision, use the transactional mode instead:

```bash
node scripts/install-local.mjs --breaking
```

Breaking installation requires every orchestrator product root to be idle with
an empty worker registry, updates all discovered roots atomically, and performs
its own post-check. Restart open agent sessions after the cut-over so they reload
the installed skill registry.

The default mode is `--all-roots`: the installer discovers every previously-installed skills root by checking for `.mono-agent-workflow.lock.json` in the known roots (`~/.codex/skills`, `~/.claude/skills`, and any root recorded in a discovered lockfile) and syncs each of them in one run, reporting the per-root installed version. During the brand migration it also recognizes the previous `.linear-agent-workflow.lock.json`, removes generated `linear-*` skills, and replaces the old lock/runtime paths with Mono equivalents. On a fresh machine with no lockfiles it falls back to `~/.codex/skills`.

Each installed skills root contains:

- `<skills-root>/mono-*`: executable local skill bodies generated from upstream.
- `<skills-root>/mono-*/references` and `<skills-root>/mono-*/templates`: copied beside each local skill for progressive disclosure.
- `<skills-root>/.mono-agent-workflow.lock.json`: upstream repo, version, commit, dirty flag, installed skill paths, and copied asset hashes.

`mono-preflight` also requires the external `autoreview` skill/helper in the agent runtime. This workflow does not vendor `autoreview`; preflight blocks when the helper is missing.

`mono-preflight` does not inherit the external helper's model default. It
selects the explicit Opus 5 route only from the canonical table in
`references/autoreview-routing.md`, re-selects after final risk
reclassification, and records the route and command in the preflight
certificate.

Check every installed root without writing:

```bash
node scripts/install-local.mjs --check
```

Use a single explicit skills root only for testing or alternate runtimes:

```bash
node scripts/install-local.mjs --skills-root /path/to/skills --remove-stale
```

The checks fail when local skills are missing, stale, edited, too small to be executable, copied references/templates are missing, stale, edited, or unexpected, lockfile hashes drift, or any discovered root is pinned to an older upstream version.

## Project Config

Project repos must not vendor this workflow. They should contain only a repo-specific JSON config:

```bash
node scripts/project-config.mjs --repo /path/to/project --project-name Zeni --write --clean
node scripts/project-config.mjs --repo /path/to/project --check
node scripts/project-config.mjs --repo /path/to/project --clean --check
```

The config path is `.agents/mono-workflow.config.json`. It records project policy such as Linear team, Linear-facing language, artifact roots, `autoreview` prerequisite, implementation workflow, ship workflow, documentation workflow, review feedback workflow, and deploy workflow.

`--clean` removes legacy generated project installs:

- `.agents/skills/mono-*`
- `.claude/skills/mono-*`
- `.agents/mono-workflow-check.mjs`
- `.agents/mono-workflow.lock.json`
- `.agents/mono-workflow.config.md`
- `.github/workflows/update-mono-workflow.yml`
- `.github/workflows/update-mono-agent-workflow.yml`
- Previous-brand `.agents/linear-workflow*`, `.agents/skills/linear-*`, `.claude/skills/linear-*`, and `.github/workflows/update-linear-*.yml` files.

For Zeni, the configured flow can set implementation to Compound `ce-work`, then use gstack `ship`, gstack `document-release`, Compound `ce-resolve-pr-feedback`, and gstack `land-and-deploy` through `Deploy workflow`.

See `references/install.md` for install details and `references/versioning.md` for the local skill pack and project config contract.

## Documentation Map

- `CHANGELOG.md`: released workflow behavior changes.
- `examples/profile-workbench-regression.md`: regression example for handoff-first artifact quality.
- `examples/zeni-dogfood.md`: first Zeni dogfood flow and anti-examples.
- `references/artifact-intake.md`: scoped discovery and review artifact intake.
- `references/artifact-quality.md`: quality bar for Project, PRD, Tech Spec, Issue, preflight, ship, deploy, and review artifacts.
- `references/artifact-rules.md`: source-of-truth and Linear-facing artifact rules.
- `references/execution-quality.md`: PRD, Issue, bug/perf, and architecture guardrails.
- `references/human-friendly-output.md`: user-facing status and confidence-boundary wording.
- `references/install.md`: local install and project config guide.
- `references/lifecycle.md`: idea, discovery, handoff, delivery, preflight, ship, and deploy lifecycle.
- `references/questioning.md`: when workflow skills should ask humans.
- `references/readiness-gates.md`: risk classes, review policy, and owner boundaries.
- `references/review-rubric.md`: `mono-review` inspection rubric.
- `references/ship-feedback-loop.md`: `mono-ship` green-certificate loop.
- `references/versioning.md`: SemVer, local skill pack, and project config contract.
- `templates/check-output.md`: `mono-check` output template.
- `templates/deploy-output.md`: `mono-deploy` output template.
- `templates/issue.md`: Linear Issue template.
- `templates/prd.md`: Linear PRD template.
- `templates/project-update.md`: project update form, text invariants, and acceptance set.
- `templates/project.md`: Linear Project body template.
- `templates/review-output.md`: `mono-review` output template.
- `templates/ship-output.md`: `mono-ship` output template.
- `templates/ship-status-ux.md`: interactive `mono-ship` status copy and worked examples.
- `templates/tech-spec.md`: Linear Tech Spec template.

## Principles

- Reusable first: the workflow lives in this repo and is installed as a local skill pack, not copied into project repos.
- Config-only projects: project repos keep only `.agents/mono-workflow.config.json` for repo-specific policy.
- Linear first: durable requirements live in Linear.
- Handoff first: discovery implementation plans must pass through `mono-handoff` before implementation.
- Artifact intake first: local discovery/review files are scoped evidence, not broad-search source of truth.
- Delivery ladder: implementation starts through `mono-implement`, branch readiness flows through `mono-preflight`, PR green certification remains in `mono-ship`, and deploy/closeout belongs to `mono-deploy`.
- Strong artifacts first: skills and examples carry the workflow contract; scripts are only lightweight smoke guards for known regressions.
- Product brief Projects: Project bodies cover only five concerns: what, why, target outcome, in scope, and out of scope. Default Russian headings are `Что`, `Зачем`, `Образ результата`, `Что входит`, and `Что не входит`.
- WHAT/HOW/execution split: PRD defines behavior and acceptance, Tech Spec defines implementation, Issue defines one PR.
- Risk-based review: `mono-review` is required for standard, deep, risky, or drifted flows and advisory for tiny PRD-lite/no-spec exceptions.
- Review/check split: `mono-review` returns findings and next owner; `mono-check` owns `PASS`, `FAIL`, and `BLOCKED` readiness.
- One issue by default: split only into vertical slices with dependencies.
- Agent-ready Issues: mark `AFK` or `HITL`, name dependencies, avoid brittle line-number edit scripts, and require repro/fix proof for bug/perf work.
- No silent sync: report drift before moving stages.
- Report-only checks: `PASS` means inspected and no blocking drift found, not deterministic proof.
- Autonomy with transparency: agents resolve non-contested choices themselves and surface them as «Решил сам»; scope boundaries, issue slicing, risk acceptance, and design decisions stay with the user, and design choices are presented visually.

## Validation

Run the one-command entry point before finishing any change:

```bash
node scripts/verify.mjs
```

CI runs `node scripts/verify.mjs` automatically on every PR and push to `main`.

To additionally verify the installed local skill pack (maintainer machine only):

```bash
node scripts/verify.mjs --install-check
```

### Individual checks

```bash
git diff --check
node --check scripts/install-local.mjs
node --check scripts/project-config.mjs
node --check scripts/lint-mono-artifacts.mjs
node scripts/lint-mono-artifacts.mjs
node --check scripts/validate-workflow.mjs
node scripts/validate-workflow.mjs
node scripts/install-local.mjs --check
node scripts/project-config.mjs --repo /path/to/project --check
```
