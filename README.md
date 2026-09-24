# Mono Agent Workflow

A reusable skill pack for owners and coding agents who deliver software through Linear and GitHub. Use it to turn a raw idea into approved work, run one delivery worker from code to a green pull request, and deploy with evidence. The owner decides the product; agents carry the work and show what they actually verified.

Canonical repository: [darkdepot/mono](https://github.com/darkdepot/mono).

This README is the complete introduction and owner-rule index. Follow its links for executable instructions, artifact contracts, templates, and runtime commands. Keep it current in the same PR whenever described behavior changes, as required by [Change Discipline](AGENTS.md#change-discipline).

## Workflow

A **wave** is the work dispatched for an Issue, including retries, review, and its eventual delivery or recorded stop. A green PR is ready for deploy; deploy supplies the merge, delivery verification, and Linear closeout.

```text
raw idea → Project in Idea → discovery → reviewed and approved package
→ approved Issue → start handshake → one mono-deliver worker
    code → confirmed write queue → local readiness → confirmed certificate
    → PR → reviews and checks → confirmed green certificate
→ mono-deploy → verification → Linear closeout and project update
```

1. **Capture.** Bring a raw idea to `mono-idea`, outside Plan Mode. Create a strengthened Project in Idea, assigned to the owner, without PRD, Tech Spec, Issues, or code. An unmistakable one-PR request may instead enter `mono-issue` under its eligibility rules.
2. **Discover.** Shape the problem through `/office-hours` or `/brainstorming`; review a product/UI surface with `/plan-design-review` and an implementation architecture with `/plan-eng-review`. These outputs are inputs to handoff, not permission to code. In orchestrated discovery, a Second Voice challenges the draft, the orchestrator answers technical questions, and the owner sees reviewed prototypes and prepared decisions at checkpoints.
3. **Package.** Run `mono-handoff`. Inspect supplied artifacts and scoped sources, draft the Project/PRD/Tech Spec and Issue slicing, review before the first durable package write, and obtain package approval. Persist the approved package in Linear and apply accepted fixes through its owner. Keep the Project pre-delivery until implementation start is explicitly authorized; documents alone never authorize Delivery.
4. **Start.** `mono-implement` verifies pack identity, the approved package, start authorization, and the five-field context seam. For an orchestrated lifecycle move, the worker emits a gate acknowledgement and pauses; the orchestrator applies and reads back the move, then resumes the same worker. Recheck readiness against that amended snapshot before code.
5. **Implement and prepare.** `mono-deliver` sequences `mono-implement`, `mono-preflight`, and `mono-ship` in one context. Implement exactly one approved Issue. Record every verification item verbatim, perform targeted checks, select the explicit risk-based autoreview route, and obtain clean independent review. Commit a ready branch and record its certificate. Preserve separate phase ownership even though the worker context is shared.
6. **Ship to green.** Synchronize accepted drift before the PR, create or update the PR through the configured ship workflow, and confirm its Linear status/link. Complete required pre-ship review and readiness checks, and the configured documentation workflow before green. Resolve review feedback and wait for current-head checks and bot evidence. Emit the green certificate only after all ship conditions and write confirmations pass.
7. **Deploy and close.** `mono-deploy` verifies that the current PR head matches the green certificate, applies the configured approval policy, and delegates the configured deploy workflow. Verify delivery and run live acceptance where users consume the result. Close the Issue only after its delivery requirements pass; publish the informational project update, report cost, record useful learnings, and retire the worker. Only the shipment of the last open Project Issue may complete that Project.

### Artifacts and truth

| Surface | What belongs there |
| --- | --- |
| Linear Project body | What, why, target outcome, in scope, out of scope |
| Project metadata, resources, comments | Lifecycle, active documents and Issues, relationships, approvals, review disposition, handoff |
| PRD | WHAT: actors, problem, workflows, requirements, acceptance and success |
| Tech Spec | HOW: architecture, real system contracts, failures, implementation units, validation and rollback |
| Issue | One-PR execution contract, dependencies, AFK/HITL readiness, context snapshot, acceptance and verification |
| GitHub | Branch, PR, code review, CI, deploy and merge history |
| Worker report | Phase, exact head, decisions, every pending write and verification result; no direct Linear mutation |

Keep whole PRD and Tech Spec bodies out of Issues. Link them through Project resources and Issue chips/snapshots. Use stable requirement and acceptance IDs when required by risk. Prefer one Issue; split only into independently demonstrable vertical slices with explicit dependencies. Mark **AFK** when an agent can execute alone, or **HITL** when a named human action remains. For a bug or performance issue, carry reproduction/baseline and fix-proof expectations, or an explicit reason that the symptom cannot yet be reproduced.

### Issue-only work and repair

Use `mono-issue` only when [all nine eligibility conditions](skills/mono-issue/SKILL.md#when-issue-only-is-granted--the-nine-eligibility-conditions) hold: an enabled lane, a genuinely one-PR self-contained request, eligible risk, and authenticated owner approval are essential parts of that boundary. Create the non-startable Issue first, then approve its exact whole-body fingerprint. The five-field seam selects the lane; a marker is an approval receipt, never a routing shortcut. Missing, broken or stale trust evidence fails closed. Renew an edited issue-only body through `mono-issue`; park and restart Project-first when required, without inventing Project documents inside the lane.

Use `mono-handoff` for [Project-first repair](references/repair-machine.md#classification-table): classify the exact proposed change, obtain report-only review, apply the class-specific worker, snapshot, approval and lifecycle effects, then check readiness. Risk growth or ambiguity raises the class. Review never repairs; `mono-check` never mutates. Accepted pre-ship drift belongs to `mono-ship`.

## Gates

A gate proves only its stated boundary. `mono-review` returns quality/risk findings (`ready`, `advisory-ready`, `needs-fixes`, `blocked`); `mono-check` reports inspected readiness (`PASS`, `FAIL`, `BLOCKED`). Neither silently changes an artifact. Their judgments supplement executable checks.

| Gate | What it proves |
| --- | --- |
| Package review and approval | The draft was reviewed at the required risk level before writing, and the owner accepted the package; implementation still needs start authorization |
| Pack identity / `gate.mjs start` | Installed version, source commit and surface revision match dispatch; branch, base and clean worktree match the start request |
| Start handshake / delivery check | The worker checked snapshot, approvals, resolved findings and context seam; the orchestrator applied/read back lifecycle changes; the amended package is ready for code |
| `gate.mjs preflight` | Current committed head/merge-base has successful verification and authentic clean review evidence on the required model/effort route; missing, stale, fabricated or incomplete evidence fails |
| Pre-ship review and check | Diff matches the Issue, readiness is recoverable, required review is complete, artifacts are current and accepted drift is synchronized |
| `gate.mjs ship` | PR is open on the certified head, checks and bot review cover that head, threads and bot remarks are resolved/disposed, closure replies are published, no own review draft or outstanding change request remains, and mergeability is acceptable under policy |
| Deploy verification and live QA | Certified change was merged and delivered to the target; acceptance was checked where consumed, with explicit evidence or a permitted recorded skip |

Ship also requires recorded valid outcomes for pre-ship review, readiness, and documentation. Apply only the repository's accepted check exceptions. Pending or unknown evidence is not success; terminal failures stop the gate. A new head invalidates its old proof. The gate accumulates evidence on the current head, waits the configured quiet interval after events, and stops at its deadline rather than waiting forever.

### Write barriers and recovery

The orchestrator is the single Linear writer. A worker uses its dispatched snapshot as its entire Linear context and queues every required comment, state change, link and certificate in its report. Publish the whole queue with the phase capsule; continue only after its durable confirmation. In-phase confirmation requests preserve drift-before-PR, ready-certificate-before-formal-review and In-Review-after-PR ordering. A queued write is not an applied write.

After a lost response, the orchestrator reconciles every write against its durable result and external state, then applies only missing actions. Keep stable write IDs for reconciliation; changed payloads need new IDs. Resume the same context and phase from its capsule with the complete open queue, decisions, head and writable roots. Recheck pack identity on every resume. A head change never drops pending obligations.

The orchestrator collects preflight verification and autoreview evidence outside worker sandboxes; workers only read the sealed receipt with `collect:false`. Evidence lives outside every worker-writable root. Reports are the worker mailbox; confirmations and orchestrator control state remain read-only to workers. A timeout parks the delivery with a dictionary reason. Final outcomes are `green` or `parked`, with the latter reflected visibly in Linear; intermediate readiness is never terminal delivery.

## Roles and Decisions

| Role | Responsibility and decision boundary |
| --- | --- |
| Owner | Product scope, slicing, design, acceptance of risk, package/start approval, deploy approval per policy |
| Orchestrator | One control session per product; inspect, dispatch, monitor, answer technical questions, apply/read back Linear writes, run discovery/handoff and deploy; never absorb code/preflight/ship |
| Delivery worker | One Issue/worktree/context; execute code, local readiness and ship in order; report evidence and queues; no Linear access, sub-workers, session management or owner questions in AFK mode |
| Second Voice | Independent pre-write package challenge on the policy-selected cross-vendor route |
| Autoreviewer | Independent code review using [role:autoreview](references/model-policy.md#roles) and risk-based effort; supply tool evidence |
| PR reviewers and CI | Evaluate the actual PR head; findings and check results become inputs to ship |

Record technical decisions as “Decided independently” in owner-facing reporting. Ask about scope, slicing, risk acceptance and design with prepared options and a recommendation; show design choices visually. Do not ask questions whose answer is already in the repository, Linear or config. The worker sends a blocked question and recommendation through its report to the orchestrator.

Resolve production model choices from [the model policy](references/model-policy.md#roles) plus validated product `models` overrides, never helper defaults. Candidate IDs may also live in the explicitly marked experimental bench routes file; production consumers resolve roles. Risk has four classes: `tiny`, `standard`, `deep`, `risky`; use the higher approved/final-diff class. Risk controls review depth and artifact needs, while a complex worker is an explicit orchestrator launch decision with a recorded reason. Preserve model/effort provenance; missing authoritative runtime data means unverified, not compliant. Policy changes govern new launches after installation, without rewriting historical records.

In orchestrated mode, use the configured transport or documented runtime detection. Codex CLI supports one resumable worker thread per Issue. The registry, mailbox and append-only ledger support recovery; write only observed events with their actual recording times. The installed watcher reports liveness and phase events. `control.json.halt` stops new launches/resumes without interrupting running workers; persistent attempt limits bound retries. Keep compaction wiring outside product repos and carry exact next action, pending obligations and decisions through compaction.

Launch and resume derive the worktree-specific and common Git directories from the requested worktree, canonicalize them, and require the complete effective grant set to match the dispatch pin exactly. A regular checkout contributes one Git directory. Git environment overrides cannot redirect these reads or the capsule HEAD; worker environment settings remain intact. The evidence, installed skills, autoreview helper and orchestrator paths remain guarded. Missing or extra pinned roots refuse launch; resume still requires the original pack identity.

Run `node --test scripts/worktree-sandbox.test.mjs` on the orchestrator host at deploy for the paired Git permission proof. It reports `deferred` inside a nested sandbox; outside one, missing Codex or sandbox startup failure fails the probe. This host check runs separately from the portable `verify.mjs` suite.

## Cost

A wave's cost is telemetry, not a gate. Read the **Cost** line in deploy closeout and the **Wave Cost** line in orchestrator status; project updates carry only a short product-level conclusion. The installed `wave-cost.mjs` calculates the figures from reports, logs and ledger:

- Dispatch-to-green-PR and dispatch-to-merge elapsed time, independently selected from the `mono-deliver` report's top-level fields first, legacy `mono-ship` reports next, then ledger events. A green PR and a recorded merge are separate events: merge time never comes from delivery completion.
- Review rounds from `mono-deliver.review_rounds` (including zero), falling back to legacy `mono-ship` forms. Invalid or missing values fall through; source fields identify the selected report or event. Only `green_at` proves green in a delivery report; legacy ship completion/report timestamps remain supported.
- All measurable token use across worker turns and attempts, including parked and failed attempts, plus autoreviewer and orchestrator use where available; worker use is a diagnostic subtotal.
- Review accounting from `<evidenceRoot>/reviews/<KEY>.json` when present: collection requests (including withheld requests), helper invocations by recorded cause, announced and validated internal passes, and reviewer tokens by engine/provider with measured coverage. A withheld request executes no helper. Without a review ledger, the legacy log scan and cost line are unchanged. Final reports are selected by stage and Issue; retired registry entries and intermediate phase reports are excluded.
- Actual pack bytes read, review rounds, model and effort.
- Explicit unavailable components with reasons; never estimates presented as measurements.

Build a review ledger with `review-ledger.mjs build --issue <KEY> --root <orchestrator-root> --evidence-root <evidenceRoot>`; `print` reads the same sources without writing. Use `--out <scratch-directory>` to save a reviewable copy, and `wave-cost.mjs --ledger <copy.json>` to price that copy. Ambiguous source links appear in `unresolvedCoverage`, without guessed merges or duplicate calls. Causes remain `unknown` without evidence; self-check requires observed content identity. `adjudicate --issue <KEY> --evidence-root <evidenceRoot> --record <json-file>` records an orchestrator's origin, evidence, decision links and progress without inferring classifications from filenames. Repeating an `eventId` replaces that event's adjudication in place; the latest record wins and other records keep their order.

### Reviewer comparison bench

`review-bench.mjs manifest|run|score|report` compares reviewers on frozen archive inputs without writing receipts or certificates. The installed [default routes](scripts/review-bench-routes.mjs) use only approved subscription logins, with empty credential mappings and an orchestrator-supplied `subscriptionLogin` record; the bench reads authentication from the `HOME` allowlist, prints that record, and never executes its status command or checks the payment type. `manifest --dry-run --evidence-root DIR --repo DIR` inventories reproducible cases, while unfrozen `run --dry-run --plan FILE --routes FILE --evidence-root DIR --repo DIR` checks admission without provider calls; a frozen manifest owns its plan. The [sampling and blind-grading protocol](docs/review-bench-protocol.md) defines `tools: "off" | "on"`: both common protocols pass `--no-web-search`, tools-off also passes `--no-tools`, tools-on admits Codex but compares engine/model bundles with differing tools, Codex cache search cannot be disabled, and Pi remains tools-off only. The experimental Grok 4.7 route uses Grok Build subscription-login evidence with no key mapping and is admitted only to the tools-off protocol. Common results and the incumbent's separate production-settings baseline use distinct report groups and blind grading sees neither protocol. Results stay under `<evidenceRoot>/bench/<runId>/`; a thin archive yields feasibility evidence only, reviewer choice remains a separate recorded decision, and live calls belong to the orchestrator after installation.

### Review decision pilot

The approved pilot adds an append-only decision journal and optional phase-report
proposals without changing gates or certificates. The orchestrator owns the
journal, dataset versions, materialization and collection decision; workers
propose evidence-backed dispositions, behaviour matrices and five checkpoint
answers. The [pilot protocol](references/orchestration.md#review-decision-pilot)
defines the fields and the [dispatch block](templates/orchestrator-dispatch.md)
repeats the relevant stage rules only for approved pilot Issues.

Installed `decisions.mjs record|list|render` uses `--issue KEY --evidence-root DIR`;
`record --record FILE` accepts `decision`, `matrix` or `verification` entries.
IDs cannot be overwritten. Revisions append a `supersedes` link, and deterministic
rendering includes only current entries. A matrix waiver is a `verification`
entry whose `waiver` names the decision's `findingKey` and gives a reason;
`forId` must reference that decision. `review-ledger.mjs decide` reports current
waivers in `waivedFindingKeys` instead of `matrixFindingKeys`; superseding the
referenced decision makes its waiver inactive. `version --source DATASET` publishes
`datasets/<KEY>-review-scope.v<N>.md` plus `.sha256` only when bytes change, reusing
identical archived content. An interrupted archive/digest publication is recovered
under the shared archive lock only when the retry has identical bytes; changed
inputs cannot supply a missing digest for an older archive. `materialize --version N --worktree DIR --digest SHA256`
returns a verified plain `.orchestrator/review-dataset-<d8>.md`, requires Git
exclusion and refuses indexed paths. Local reviews receive that pinned path via
`--dataset` and retain usage with `--stream-engine-output`; remove each copy at
attempt end using the same materialize pins plus `--remove true`.

`review-ledger.mjs decide --issue KEY --evidence-root DIR --attempt N` reads
adjudicated decision links and progress to suggest a matrix or checkpoint; it
never infers a finding key or grants readiness. Missing required evidence leads
the orchestrator to `withhold --record FILE` with attempt, collectionId, reason
and recordedBy, then rebuild the ledger. This records demand without executing
collection. Dispatch/dataset bytes are measured separately as pilot overhead;
the worker reading corpus stays unchanged.

Collections retain validation and usage lines in bounded streaming output before signing. Reviewer input, cache reads, cache writes and output stay separate: Claude input excludes both cache counters, whereas Codex input includes cached input and has no cache-write counter. Raw samples remain available; missing usage is null with a reason. Collection datasets are archived as immutable `<KEY>-review-scope.v<N>.md` files with `.sha256` sidecars, and receipts bind version and digest. Old receipts remain valid without usage or archive metadata; those inputs remain unavailable for reproduction.

Sum non-overlapping per-turn usage across every attempt. Cached input is part of input, not another amount to add. The static worker reading budget is a separate measure: one union of mandatory, conditional and nested readings, shared files counted once, bounded at **99,882 bytes** with bytes/4 shown as an approximation. README is outside the worker reading list. Explanatory rationale stays outside that list and adds no gates.

```bash
node '<skills-root>/.mono-agent-workflow/scripts/wave-cost.mjs' <ISSUE-KEY>
node scripts/read-budget.mjs
```

See [Cost Telemetry](references/orchestration.md#cost-telemetry) for inputs and unavailable-data handling. Compare improvements only against a recorded baseline and protocol; report insufficient evidence plainly.

## Install Locally

Prerequisites: a checkout of this repository, Node.js for its scripts, Git, the relevant agent runtime and Linear access for the orchestrator/interactive owner stages, GitHub access through `gh`, and an installed external `autoreview` skill/helper. Mono does not vendor that helper; missing mandatory review support blocks readiness. Use the policy model and [canonical effort routes](references/autoreview-routing.md#canonical-routes).

Install or update from the upstream checkout:

```bash
node scripts/install-local.mjs --remove-stale
node scripts/install-local.mjs --check
```

The default is `--all-roots`: discover previously installed roots using `.mono-agent-workflow.lock.json` in `~/.codex/skills`, `~/.claude/skills` and recorded roots, then sync/check each root. A fresh machine falls back to `~/.codex/skills`. Migration also recognizes the previous-brand lock and generated `linear-*` files; remove only installer-owned legacy payloads.

Each root receives generated `mono-*/SKILL.md`, adjacent `AGENTS.md`, references and templates, runtime scripts under `.mono-agent-workflow/scripts/`, this README at `.mono-agent-workflow/README.md`, and `.mono-agent-workflow.lock.json`. The lock records version, immutable source commit, surface revision, dirty flag and installed hashes, including `assets.readme`. Checks reject missing, edited, stale or unexpected payloads and invalid lock entries. Sync replaces the private runtime directory, removing retired files. Edit the upstream pack, never generated skills.

For a breaking skill-surface revision:

```bash
node scripts/install-local.mjs --breaking
```

Breaking install requires idle orchestrator state and empty worker registries. It coordinates roots under the global install lock, freezes the orchestrator tree, stages and checks all roots transactionally, rolls back on failure, and retains recovery data on incomplete recovery. Restart open agent sessions after cut-over. Verify the installing checkout HEAD equals the merge SHA from the PR record before a deploy install; an old or divergent checkout is a deploy blocker. See [installation](references/install.md#breaking-surface-changes) and [versioning](references/versioning.md#local-lockfile).

Use an explicit root and isolated state only for scratch tests or an alternate runtime; never point a test at real installed roots:

```bash
MONO_WORKFLOW_STATE_ROOT=/tmp/mono-test-state node scripts/install-local.mjs --skills-root /tmp/mono-test-skills
MONO_WORKFLOW_STATE_ROOT=/tmp/mono-test-state node scripts/install-local.mjs --skills-root /tmp/mono-test-skills --check
```

## Project Config

Product repositories keep only `.agents/mono-workflow.config.json` for Mono. Do not vendor skill bodies, wrappers, locks, local workflow checkers, hooks or updater CI there.

```bash
node scripts/project-config.mjs --repo /path/to/product --project-name Product --write --clean
node scripts/project-config.mjs --repo /path/to/product --check
```

Configure product/team names, Linear/repository languages, narrow artifact roots, implementation, ship, documentation, review-feedback and deploy workflows, and the required `autoreviewHelper` prerequisite. Optional workflows may be `null`; a missing deploy workflow blocks deployment. Optional QA/authentication policy defines how live verification accesses the product; owner-session access requires permission. `--clean` removes legacy generated Mono and previous-brand workflow files while migrating project policy.

Optional `models.roles` overrides model routes within the [role/transport matrix](references/model-policy.md#product-overrides).
Autoreview accepts claude, kimi, pi or codex with `effortByRisk` for all five risk keys.
Worker Codex roles stay on Codex, worker Claude stays on Claude; Second Voice stays
cross-vendor and the orchestrator is not overridable. The CLI worker launcher
continues to support only Codex workers. Native authentication uses null endpoint
and credentialEnv; external credentials are environment variable **names**, never
values. Pi supports native xai/google/minimax with a null endpoint, or OpenAI-compatible
routing via `OPENAI_BASE_URL`; unsupported endpoint mappings are refused.
Helpers that authenticate from the environment must declare `provider.credentialEnv` on `autoreview`; under the field-for-field rule, this is a pair change requiring a bound `pairingAccepted` record.

Every changed producer/reviewer pair needs a `pairingAccepted` record with the exact
producer and reviewer routes (including both providers, credential variable names
and risk efforts), all risk classes, a `linearDecision` URL, `by` and `date`.
`requiredPairings(config)` in `scripts/runtime.mjs` returns that pair data for review;
`project-config.mjs --check` refuses absent or changed bindings and names the pair.
It validates the recorded decision's binding, not model capability.

Before dispatch, `orchestrator/spawn.mjs --pins <request-json>` prints `modelRoutes`
from the immutable base commit. Carry those pins into launch and collection requests;
config edits in the delivered diff cannot change that delivery's reviewer. New
receipts record engine/model/effort/provider/fingerprint, verified at `collect:false`;
legacy receipts retain their signature and meaning, read as claude/unknown. Collection
builds provider environment from the route and keeps the existing two invocation forms,
sealed-head requirement and all certification checks. No provider key value belongs
in config, dispatch, registry or receipts. Resumes keep their original pins.

Set `deployApproval` to `always` (default), `risky-only` (approval for standard/deep/risky and unknown risk; only tiny proceeds without asking), or `never`. Approval binds the exact PR/head. Configure `orchestration.transport` and `maxParallelWorkers` (default 3) when needed. Delivery settings default to a 900-second confirmation timeout, 120-second quiet interval, 2,400-second evidence limit, 10-second polling and three attempts. This pack keeps its own issue-only lane disabled and stores no owner ID in the repository; consumers enable the lane explicitly with `issueOnlyLane.enabled` and the canonical approving `ownerPrincipal`. See [Project Policy](references/install.md#project-policy) for the full config contract.

## Owner Rules

The following 34 numbered entries are the sole owner-rule index, transferred from the former constitution. Each line states the obligation, its reason and the executable source; it is not a second full copy of the source text. Rule numbers preserve traceability. Link validation proves that a file and section are addressable; pack checks and same-PR README freshness preserve truth. Change rules through a Linear Issue and the orchestrator.

- **K-01.** Write statuses, reports and briefs with the product or user outcome as their subject so the owner can understand them without knowing the workflow — [Product Language For The Owner](references/human-friendly-output.md#product-language-for-the-owner).
- **K-02.** Put Issue keys, slice codes, SHAs, stage names and internal labels in the closing technical block rather than making them the subject, so identifiers cannot hide the result — [Product Language For The Owner](references/human-friendly-output.md#product-language-for-the-owner).
- **K-03.** Distinguish live production verification, automatic post-deploy verification and deployment without live inspection, reserving “works” or “in production” claims for current live proof so unverified delivery cannot masquerade as verified behavior — [Product Language For The Owner](references/human-friendly-output.md#product-language-for-the-owner).
- **K-04.** End every status with the owner's required decisions (including “none”) and repeat the decision count at the start so requests cannot get lost — [Status Update](templates/orchestrator-brief.md#статус-status-update).
- **K-05.** Include “What went wrong” in every status, naming delays over five minutes and departures from agreements or explicitly saying none, so the real cost remains visible — [Status Update](templates/orchestrator-brief.md#статус-status-update).
- **K-06.** Publish one shipment-form project update for each deployed Issue with an outcome title, one or two sentences and the Issue link last, so releases appear in the project feed — [Shape](templates/project-update.md#shape).
- **K-07.** Limit update titles to ten words and bodies to one or two sentences and 35 words, allowing a third sentence only in the final Project update, so updates remain readable — [Invariants, item 2](templates/project-update.md#invariants).
- **K-08.** Exclude SHAs, build numbers, PRs, slices, rounds, reviews, stages, sessions, dates and completion percentages from project-update prose while permitting product vocabulary, so the update describes the product — [Invariants, item 15](templates/project-update.md#invariants).
- **K-09.** Give separate outcomes separate updates and use no subheadings, lists or more than one link inside an update, so each result stays visible — [Invariants, item 14](templates/project-update.md#invariants).
- **K-10.** Use the State form when no shipment occurred, report factual Project health, make the link optional and end with the owner's needed action, so progress cannot look like delivery — [State update](templates/project-update.md#state-update).
- **K-11.** Complete a Project only through the shipment of its last open Issue and begin its final update with the configured “Project completed” prefix, so the feed has a delivered conclusion — [Deploy](references/lifecycle.md#deploy) and [Invariants, item 13](templates/project-update.md#invariants).
- **K-12.** Name the theme Project in an issue-only Issue and send its shipment update there, so a projectless result still has a visible home — [Theme project](references/issue-only-lane.md#theme-project).
- **K-13.** Assign new agent-created Project leads and Issue assignees to the acting owner while preserving existing assignments, so created work reaches the owner's lists — [Linear Artifact Rules](references/artifact-rules.md#linear-artifact-rules).
- **K-14.** Treat project updates as informational closeout results whose absence or failure cannot block delivery or change its verdict, so reporting cannot stop shipment — [Skill Design Rules](AGENTS.md#skill-design-rules).
- **K-15.** Turn a raw idea into an Idea-state Project with one strengthened brief and no PRD, Tech Spec, Issues or code, so implementation planning waits for the decision to proceed — [Idea state](references/contracts/project.md#pc-013--idea-state).
- **K-16.** Present the Project brief, PRD, Tech Spec and Issue slicing as one package with a completed review verdict, so one decision does not become a stream of questions — [Pre-write package review](references/orchestration.md#pre-write-package-review).
- **K-17.** Have an independent cross-vendor Second Voice review the package draft before its first Linear write, so author and reviewer do not share the same blind spots — [Second Voice](references/orchestration.md#second-voice).
- **K-18.** Decide repository-, Linear- and config-derived implementation details, document structure and risk classification autonomously, but ask about scope, slicing, risk acceptance and design, so routine questions do not consume owner time or seize owner authority — [Autonomy Defaults](references/questioning.md#autonomy-defaults).
- **K-19.** Apply the project's deploy-approval policy (always, all except tiny, or never) to the exact code head, so yesterday's approval cannot authorize different code — [Project Policy](references/install.md#project-policy).
- **K-20.** Grant issue-only delivery only when all nine conditions hold and the owner approves the exact Issue fingerprint, falling back to Project-first on doubt, so the shortcut cannot bypass its boundary — [Nine eligibility conditions](skills/mono-issue/SKILL.md#when-issue-only-is-granted--the-nine-eligibility-conditions) and [Trust boundary](references/issue-only-lane.md#trust-boundary).
- **K-21.** Invalidate approval whenever an approved issue-only body changes and obtain new review and fingerprint approval, so the approved text remains the executed contract — [Renewal recovery](skills/mono-issue/SKILL.md#renewal-recovery).
- **K-22.** Run code autoreview at every risk class using the policy's autoreview model and class-routed effort from low through the highest escalated route, so the reviewer has the capability and depth to challenge the author — [Roles](references/model-policy.md#roles) and [Canonical Routes](references/autoreview-routing.md#canonical-routes).
- **K-23.** Classify work as tiny, standard, deep or risky to set artifact requirements and review depth, treating money, data, access, production and public interfaces as risky domains, so dangerous work cannot pass through a light process — [Risk Classification](references/readiness-gates.md#risk-classification).
- **K-24.** Require package review before writing and formal pre-ship review for standard, deep and risky work, permitting only a recorded tiny advisory exception, so review can challenge decisions before they become accepted artifacts — [Review Gate Policy](references/readiness-gates.md#review-gate-policy).
- **K-25.** Close an Issue only after merge, delivery and verification, except under an explicitly accepted merge-as-delivery policy, so closed work cannot silently fail to reach users — [Deploy](references/lifecycle.md#deploy).
- **K-26.** Verify user-facing changes live against Issue acceptance after deployment and file defects as immediate out-of-queue hotfixes, while still requiring the original Issue's own green live pass for closure, so automated checks cannot substitute for the user experience — [Deploy](references/lifecycle.md#deploy).
- **K-27.** Include a compact checked/not-checked boundary in every stage result and call uninspected work unverified, so the owner cannot infer unsupported confidence — [Checked / Not Checked](references/human-friendly-output.md#checked--not-checked).
- **K-28.** Report a stop with completed work, the exact blocking point, unperformed work and the smallest unblock action, so unfinished work cannot be mistaken for ready — [Blocked / Timed-Out Shape](references/human-friendly-output.md#blocked--timed-out-shape).
- **K-29.** Append only observed facts with actual recording times to the ledger and append corrections instead of rewriting history, so invented history cannot conceal delays — [Mailbox And Ledger](references/orchestration.md#mailbox-and-ledger).
- **K-30.** Let only the orchestrator write Linear in orchestrated mode and have workers queue writes or questions with recommendations in reports, so two writers cannot create divergent truth — [Orchestration Mode Precedence](references/worker-contract.md#orchestration-mode-precedence).
- **K-31.** Start every pack change with a Linear Issue before the first edit, so no shortcut evades review and verification — [Change Discipline](AGENTS.md#change-discipline).
- **K-32.** Update affected checks with behavior changes using structure and named behavior fixtures, keep prose free of pins and agent-only rules free of a second machine encoding, and preserve the four bounded contracts and fingerprints unless explicitly changed, so editorial rewrites stay green while protected invariants remain checked — [Fixture Coupling](AGENTS.md#fixture-coupling).
- **K-33.** Write Linear artifacts and comments in the configured project language (Russian here) and skill instructions in English, so the owner can read the artifacts and models can execute the pack consistently — [Language](AGENTS.md#language).
- **K-34.** Route pack rule changes through a Linear Issue and the orchestrator, updating affected README sections in the same PR, so owner intent and the shipped description stay synchronized — [Change Discipline](AGENTS.md#change-discipline).

## Skills

| Skill | Use it for |
| --- | --- |
| [mono-idea](skills/mono-idea/SKILL.md) | Raw idea intake and strengthened Idea Project |
| [mono-issue](skills/mono-issue/SKILL.md) | Eligible issue-only create-then-approve intake and body renewal |
| [mono-handoff](skills/mono-handoff/SKILL.md) | Project-first packaging, slicing and reviewed artifact repair |
| [mono-review](skills/mono-review/SKILL.md) | Report-only quality/risk review |
| [mono-check](skills/mono-check/SKILL.md) | Readiness-only transition assessment |
| [mono-deliver](skills/mono-deliver/SKILL.md) | One delivery context sequencing its three phase owners |
| [mono-implement](skills/mono-implement/SKILL.md) | Delivery Start and approved code execution |
| [mono-preflight](skills/mono-preflight/SKILL.md) | Local verification, independent autoreview, commit and ready certificate |
| [mono-ship](skills/mono-ship/SKILL.md) | Accepted pre-ship drift, PR, docs, feedback and green certificate |
| [mono-deploy](skills/mono-deploy/SKILL.md) | Merge/deploy delegation, verification, closeout and learnings |
| [mono-orchestrate](skills/mono-orchestrate/SKILL.md) | Product control plane: dispatch, monitoring, decisions and Linear writes |

## Documentation Map

| Need | Source |
| --- | --- |
| Artifact contracts and stable rule IDs | [Contract index](references/artifact-contracts.md), [Project](references/contracts/project.md), [PRD](references/contracts/prd.md), [Tech Spec](references/contracts/tech-spec.md), [Issue](references/contracts/issue.md); retired IDs are not reused |
| Scoped discovery intake and source precedence | [Artifact intake](references/artifact-intake.md); supplied paths, current Linear package and scoped context take precedence over stale scratch evidence; name missing/conflicting inputs |
| Artifact form and execution quality | [Artifact rules](references/artifact-rules.md), [quality bar](references/artifact-quality.md), [execution quality](references/execution-quality.md), [repair](references/repair-machine.md) |
| Risk, review and phase boundaries | [Readiness gates](references/readiness-gates.md), [review rubric](references/review-rubric.md), [lifecycle](references/lifecycle.md), [ship feedback loop](references/ship-feedback-loop.md) |
| Decisions and owner-facing wording | [Questioning](references/questioning.md), [human output](references/human-friendly-output.md), [decision/status/wave brief](templates/orchestrator-brief.md) |
| Runtime and worker recovery | [Orchestration](references/orchestration.md), [worker contract](references/worker-contract.md), [dispatch](templates/orchestrator-dispatch.md), [report](templates/orchestrator-report.md), [compaction](templates/compact-instructions.md) |
| Linear artifact templates | [Project](templates/project.md), [PRD](templates/prd.md), [Tech Spec](templates/tech-spec.md), [Issue](templates/issue.md), [project updates](templates/project-update.md); templates define form, contracts define obligations |
| Review, check and delivery output | [Review](templates/review-output.md), [check](templates/check-output.md), [ship](templates/ship-output.md), [interactive ship status](templates/ship-status-ux.md), [deploy](templates/deploy-output.md); examples are placeholders, not evidence |
| Installation and policy | [Install](references/install.md), [versioning](references/versioning.md), [models](references/model-policy.md), [autoreview routing](references/autoreview-routing.md) |
| Rationale outside worker reading | [Audience](references/rationale/audience.md), [review](references/rationale/review.md), [output](references/rationale/output.md), [delivery](references/rationale/delivery.md); explanation adds no obligations |
| Worked examples and history | [Consumer dogfood](examples/consumer-dogfood.md), [profile regression](examples/profile-workbench-regression.md), [CHANGELOG](CHANGELOG.md) |

Runtime scripts live in [scripts/](scripts/): `gate.mjs` checks evidence; `delivery-state.mjs` publishes/confirms queues; `runtime.mjs` provides role resolution, config validation, durable writes, locks and hashes; `orchestrator/spawn.mjs`, `resume.mjs` and `consume-gate-ack.mjs` use the shared launch implementation; `watch-workers.mjs` monitors registered work; `resolve-issue-context.mjs` resolves the issue-only seam; `verify-pack-state.mjs` verifies identity/quiescence; `decisions.mjs` records decisions and versions/materializes datasets; `review-ledger.mjs` builds and summarizes review-event ledgers and supplies adjudication hints; `wave-cost.mjs` measures cost; `read-budget.mjs` bounds reading. Invoke runtime scripts from the installed pack, with `--help` and pinned dispatch inputs. Installation and config maintenance use `install-local.mjs` and `project-config.mjs` from the upstream checkout.

## Principles

Keep skills as routes and artifact-scoped owners, wrappers as sequencing, and references/templates as progressive reading. A module should carry meaningful complexity behind a real interface; deep/risky changes require evidence at system seams. Trace actor → capability → benefit, and prove one behavior before expanding implementation. Record real external-system responses rather than inventing contracts.

Keep gates and responsibilities intact in both interactive and orchestrated delivery. Review supplies findings and the next owner; check supplies readiness; accepted fixes go through handoff, issue renewal, ship drift or explicit artifact owners. Never silently synchronize drift or promote stale approval. Read only relevant, bounded sources, name stale/unavailable/conflicting inputs, and preserve the confidence boundary.

Treat Markdown as agent instructions. Protect executable behavior with fixtures, artifact contracts with their bounded fingerprints and consumer checks, and document shape with skeleton checks. Do not encode agent-only rules twice or pin sentences. Every pack change begins with a Linear Issue; README freshness is mandatory even when the optional documentation workflow is unavailable.

## Validation

Run before completing a change:

```bash
node scripts/verify.mjs
```

The entry point includes `git diff --check`, syntax checks, artifact/workflow checks, scratch installation and runtime fixtures. CI runs it on PRs and pushes to main. Required README sections and all 34 rule links are checked structurally; a renamed target section fails with the rule number. Tests also remove required README sections and exercise model-policy detection on README. Passing link checks establishes addressability, not semantic truth.

Use focused checks while editing:

```bash
node scripts/validate-workflow.mjs --readme-only
node scripts/validate-workflow.mjs --model-policy-fixtures
node scripts/read-budget.mjs
node scripts/lint-mono-artifacts.mjs
```

On a maintainer machine only, `node scripts/verify.mjs --install-check` additionally checks real installed roots. Runtime tests use scratch roots; the real sandbox-boundary test runs outside a worker sandbox and reports an explicit skip when nested sandboxing prevents it. Installation, live production QA, deploy and owner acceptance are separate evidence boundaries, never implied by a local green check.
