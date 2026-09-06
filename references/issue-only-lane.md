# Issue-Only Lane Foundation

The issue-only lane lets a genuinely one-PR change move through the workflow
without a Project, PRD, and Tech Spec, while staying just as inspectable as the
full project-first lane. This document is the load-bearing foundation: it fixes
the versioned **marker**, the normative **5-field context contract** (the seam),
the deterministic **resolver** that every issue-only-lane consumer reads first,
and the no-promotion fallback shared by delivery stages. The assurance vector,
route-record, and reducer remain out of scope and land in later phases.

## The Marker

An issue-only package is opted in by a **marker** *and* the verified `issue-only`
Linear label, and only when the project has enabled the lane in its config — all
are required, and the lane fails closed to project-first if any is missing. The
project-level opt-in (`issueOnlyLane.enabled: true` with a non-empty
`ownerPrincipal`) is the coarsest gate: with the lane off, no marker or label can
select it.

- **Label:** `issue-only` on the Linear Issue. The label is the human-visible,
  filterable signal; the marker is the machine-readable receipt. Both are
  required to select the lane: the resolver treats the label as trusted input the
  caller has verified against Linear, and fails closed to project-first when it is
  absent.
- **Marker:** a machine block inside a Linear comment on the Issue, opened by the
  stable marker line `mono-issue-only marker`. Following the machine-block
  convention in `references/human-friendly-output.md` and
  `references/artifact-quality.md`, the comment leads with a short Russian human
  sentence (project config language when set) stating the outcome, then the
  unchanged machine block. Example:

  ```text
  Пакет переведён в issue-only: одна PR, продуктовой поверхности нет, риск обычный.

  mono-issue-only marker
  Marker version: 1
  Scope fingerprint: 3f8a1c0b9d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c
  Acceptance IDs: AC1, AC2
  Risk class: standard
  Approval: 3f8a1c0b9d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c (approved by owner 2026-07-11)
  ```

  The `Scope fingerprint` and the approved fingerprint are the full 64-hex
  sha256, never truncated — a short hash would be a collision target for the
  approval binding.
- **Previous-brand marker compatibility:** the resolver may read
  `linear-issue-only marker` from an already-approved durable Linear comment so
  the brand migration does not revoke a valid package. All new and renewed
  comments must write `mono-issue-only marker`.

- **Fields — EXACTLY these five, no more:**
  - `Marker version: 1` — the versioned schema of the marker itself. An unknown
    version is a hard violation, never a silent downgrade.
  - `Scope fingerprint` — a deterministic fingerprint of the **entire Issue body**
    (marker block removed), minimally normalized. It is how drift is caught: **any**
    change anywhere in the body — objective, scope, acceptance, verification,
    non-goals, review-gate, a heading rename, or a re-indentation — changes the
    fingerprint and the marker goes stale. Hashing the whole body (rather than
    parsing individual sections) is deliberate: it leaves no free-text-Markdown
    parsing surface for drift to slip past, at the cost that an approval must be
    renewed after **any** edit to the Issue body.
  - `Acceptance IDs` — the stable acceptance-criterion IDs (`AC1`, `AC2`, ...)
    this package commits to. They must match the IDs in the Issue body.
  - `Risk class` — one of the EXISTING classes `tiny`, `standard`, `deep`,
    `risky` from `references/readiness-gates.md`, read from the Issue's
    review-gate. The marker records the existing class; it never runs a fresh
    classifier. The resolver cross-checks this field against the class named in
    the Issue's `Ревью-гейт` section and rejects a marker that downgrades it (a
    re-tier like `standard→deep` counts as the higher class), so the field cannot
    be forged to slip a higher-risk change into the lane. In Phase 1 only `tiny`
    and `standard` are eligible for the lane; a marker recording `deep` or `risky`
    resolves to project-first (see the fail-closed invariant below).
  - `Approval` — the owner start-approval receipt. It carries the fingerprint the
    owner approved (or `none`), so freshness can be checked against current scope.
    The token alone is self-attested text; its **authenticity** (that the owner
    actually approved this fingerprint) is established by the create-then-approve
    intake transaction, which verifies the approval comment's author against the
    owner principal's stable Linear user ID — the fingerprint is publicly
    computable, so it proves text freshness, not authorship — before writing it
    as a verified owner comment, and the resolver only trusts it when the caller
    passes the matching `--approval-verified` fingerprint (see Trust boundary).
- **Recovery:** most-recent-wins. The most recent **standalone** `mono-issue-only
  marker` line, **outside any fenced code block**, is authoritative; older marker
  comments are superseded. A prose mention or a fenced documentation example of
  the marker format is never treated as an opt-in. For an inline marker (the Issue
  body used as the marker source), **every** marker block — the authoritative
  newest and any superseded older one — is removed before the scope is hashed, so
  a renewal never binds stale marker metadata into the fingerprint or the
  review-gate class.

## Marker ≠ Route-Record

The marker is a lightweight approval receipt for the issue-only lane. It is **not**
a route-record. The boundary is explicit: **маркер ≠ route-record**.

The marker MUST NOT carry any of the spine's route-record fields:

- `route_revision`
- `assurance_vector`
- `required_artifacts`

Those belong to the future spine resolver, not to this marker. A marker that
carries any of them is malformed and is rejected (fail-closed). Keeping the
marker deliberately small is what makes the issue-only lane cheap: it records
just enough to prove an approved, non-drifted, one-PR scope — nothing that would
reintroduce project-first ceremony.

## Trust boundary

Intake remains non-activating: it leaves a prepared Issue in a pre-start state,
and `mono-implement` owns the later delivery check and Issue lifecycle move.
Activation is config-gated per repository by explicit
`issueOnlyLane.enabled: true` plus a non-empty `ownerPrincipal`; no workflow may
write or infer that opt-in. The owner decision on 2026-07-17 enables the lane for
this upstream repository so it can be exercised here; every other repository
remains disabled until its own explicit config opt-in.

The resolver is a deterministic, pure function over its inputs. It enforces
**structure, freshness, eligibility, and provenance-agreement** — it is not, and
cannot be, the point where owner identity is authenticated. That authentication
is the job of the **create-then-approve intake transaction**,
which is the only sanctioned marker writer: it creates a non-startable Issue,
records the owner's approval as a verified Linear comment against the exact
full-contract fingerprint, verifies the comment author against the canonical
owner principal, reads it back, and writes the marker and the `issue-only` label.

Because marker and label text is otherwise self-attested, the resolver never
grants issue-only from marker text alone. It additionally requires two trusted
signals the caller supplies after reading Linear:

- `--label issue-only` — the verified label is present on the Issue.
- `--approval-verified <fingerprint>` — the fingerprint the caller confirmed
  against the authenticated owner-approval comment.

Issue-only is granted only when the marker is valid and fresh, the risk class is
in the Phase-1 envelope, the verified label is present, and the marker's recorded
approval, the live scope fingerprint, and the caller-verified fingerprint all
agree. Any gap fails closed to project-first.

## The Context Contract (the seam)

Every issue-only-lane consumer resolves context through one seam: a fixed
**5-field contract**. This is the stable interface later slices build on.

| Field | Domain | Meaning |
| --- | --- | --- |
| `package_kind` | `issue-only` \| `project-first` | Which lane this package is in. |
| `lifecycle_state_entity` | `issue` \| `project` | Which Linear entity holds the authoritative lifecycle state. Issue-only reads the Issue; project-first reads the Project. This is the seam that decouples the lifecycle-state source. |
| `behavioral_oracle` | `{kind: issue-verification, acceptance_ids, verify_steps}` for issue-only; `null` for project-first | How the package is proven. For issue-only the oracle is the Issue's own acceptance criteria and verify steps. Both must be non-empty, but a verify step is **not** required to cite the individual acceptance ID(s) it proves — a step may validate the change holistically (e.g. "run the suite"). Per-step acceptance-ID traceability is deliberately out of scope for the lightweight Phase-1 lane; it belongs to the Phase-3 Live-QA amendment if a need for it appears. |
| `risk_class` | `tiny` \| `standard` for issue-only (deep/risky fall back to project-first in Phase 1); `null` for project-first | The EXISTING review-gate risk class, read — never re-derived. |
| `approval_status` | `approved-fresh` for issue-only; `absent` for project-first | `approved-fresh`: the owner-approved fingerprint, the live scope fingerprint, and the caller-verified fingerprint all agree. A stale (superseded) or absent approval is not a distinct issue-only state — it fails closed to project-first, so issue-only always carries `approved-fresh`. |

**Fail-closed invariant:** **no marker ⇒ `package_kind=project-first`.** A missing
or unrecognizable marker always resolves to the safe, full-ceremony lane. A
package is never silently treated as issue-only. Project-first is also the result
whenever the lane is not opted in by config — the opt-in requires
`issueOnlyLane.enabled: true` with a non-empty `ownerPrincipal`, so no `--config`,
a disabled lane, or a missing owner all fail closed — and when a structurally
valid marker records a `deep` or `risky` risk class, since in Phase 1 only
`tiny`/`standard` are eligible and deep/risky keeps full ceremony until the
Phase-3 safety modules land. Selecting issue-only additionally requires the
verified `issue-only` label and a caller-verified, fresh owner approval; absent
either, the resolver fails closed to project-first.

## The Resolver

`scripts/resolve-issue-context.mjs` is the deterministic implementation of the
seam. It mirrors the deterministic-config-script structure of
`scripts/project-config.mjs`.

- **Inputs (`reads {issue body, marker, config, verified label, verified approval}`):**
  - `--issue <path>` — the Issue body markdown (required).
  - `--marker <path>` — the marker source; defaults to the Issue body when
    omitted, so an inline or a separate-comment marker both work.
  - `--config <path>` — project config JSON. It is the lane's **opt-in gate**:
    issue-only is granted only when the config sets `issueOnlyLane.enabled: true`
    AND names a non-empty `issueOnlyLane.ownerPrincipal` (a stable Linear user
    ID). No `--config`, no `issueOnlyLane`, an `enabled` other than `true`, or an
    empty `ownerPrincipal` all leave the lane un-opted-in and fail closed to
    project-first. A structurally malformed `issueOnlyLane` (not an object, or a
    non-boolean `enabled`) is a hard violation. The resolver only checks the
    opt-in's presence and owner designation; it never authenticates the Linear
    comment author (the create-then-approve intake owns that).
  - `--label <names>` — trusted, caller-verified Linear labels on the Issue
    (comma-separated; a name may contain spaces). Issue-only requires the exact
    full label `issue-only` among them — a label like `not issue-only` does not
    count.
  - `--approval-verified <fingerprint>` — the owner-approval fingerprint the
    caller verified against the authenticated Linear comment. Issue-only requires
    it to equal the live scope fingerprint and the marker's recorded approval.
  - `--emit-fingerprint` — prints the computed scope fingerprint for `--issue`
    and exits; used to author markers and to build fixtures without duplicating
    the hash.
- **Output:** the 5-field contract as pretty JSON on stdout, exit `0`.
- **Fingerprint:** the full `sha256` (64 hex, never truncated — a short hash is a
  collision target for the approval binding) over the **entire Issue body** with
  the marker block removed, minimally normalized (trailing whitespace stripped,
  blank-line runs collapsed, leading indentation preserved). It is NOT parsed into
  sections. Consequently **any** change to the body — to any normative section, a
  heading rename, a re-indentation, or even surrounding prose — changes the hash
  and invalidates the approval. This whole-body hash is deliberately chosen over
  section-parsing so there is no free-text-Markdown surface (fences, nested
  headings, duplicate sections, delimiters) for drift to slip past; the trade-off
  is that an approval must be renewed after any Issue-body edit. The section
  parsing the resolver still does — for the acceptance/verify oracle, the risk
  cross-check, and the completeness gate — cannot bypass this hash, because those
  outputs never widen what the fingerprint covers.
- **Fail-closed behavior:**
  - No usable marker (marker line absent) ⇒ `project-first`, exit `0`.
  - A valid, integrity-checked marker for a project that has not opted the lane
    in via `--config` (`issueOnlyLane.enabled: true` with a non-empty
    `ownerPrincipal`) ⇒ `project-first`, exit `0` — the lane is off, not corrupt.
    The opt-in gate runs AFTER every marker-integrity check, so a corrupt marker
    still hard-fails even when no config is supplied.
  - A structurally valid marker whose `Risk class` is `deep` or `risky` ⇒
    `project-first`, exit `0` — out of the Phase-1 envelope, not corrupt.
  - A valid, in-envelope marker without the verified `issue-only` label, or
    without a fresh caller-verified owner approval ⇒ `project-first`, exit `0` —
    the opt-in is incomplete, not corrupt.
  - A marker that is present but integrity-invalid ⇒ `process.exit(1)` with a
    single stable line to stderr. Violations: `issue-only-lane: broken marker: …`
    (unknown `Marker version`, a missing field, an unknown extra field beyond the
    five, an unparseable line inside the machine block, a duplicate field, an
    invalid `Risk class`, a `Risk class` that does not match the Issue
    review-gate, an empty behavioral oracle, an incomplete self-contained contract
    (no described scope/behavior or no non-goals), mismatched `Acceptance IDs`, or
    a forbidden route-record field), `issue-only-lane: stale marker: scope
    fingerprint mismatch …`, and `issue-only-lane: invalid config: …` for a
    structurally malformed `issueOnlyLane` (a non-object lane or a non-boolean
    `enabled`). It is never silently resolved as issue-only.
- **Not a spine-resolver:** it emits no assurance vector, no route-record, and no
  `required_artifacts`. It reads recorded state (risk class, approval) and checks
  scope integrity; it does not classify risk, reduce an assurance vector, or
  compute a route. Those are later slices.
- **Installed location (runtime):** the intake transaction runs the resolver from
  an installed environment, so `scripts/install-local.mjs` publishes it — per
  skills root — at the canonical pack-private path
  `<skills-root>/.mono-agent-workflow/scripts/resolve-issue-context.mjs`,
  recorded in the lockfile's `runtimeScripts` (see `references/install.md`). The
  create-then-approve intake transaction invokes it there; because the
  pack-private directory is one level up from any installed `mono-*` skill
  directory, a skill reaches it at
  `../.mono-agent-workflow/scripts/resolve-issue-context.mjs`. Product repos
  never vendor the script — the installer owns the copy. In this upstream
  checkout the same script is `scripts/resolve-issue-context.mjs`.

## Deterministic Project-first fallback

There is **No in-place Issue-to-Project promotion**. An Issue that entered the issue-only lane is never converted into, attached to, or reused as the execution Issue of a new Project. Scope/risk escape is a lane exit with a new Project-first package, not a container mutation.

Fallback triggers include a seam that no longer resolves issue-only, stale or absent approval at Delivery Start, a second outcome or PR, unresolved product/UX/architecture/operations judgment, and a preflight diff whose higher risk classification is `deep` or `risky`. Marker-integrity failures remain hard failures with their stable resolver error; they are not silently downgraded.

The five-field seam stays the only lane authority, but callers retain the trusted package provenance they already read to invoke it: whether the Issue has a parent Project and whether verified issue-only marker/label/approval inputs were present. This is not a sixth seam field and never turns a `project-first` result back into `issue-only`. It only prevents an escaped parentless candidate that resolved fail-closed from being mistaken for a complete Project-first package: with no approved Project artifacts, the caller performs the fallback below instead of running Project lifecycle operations.

### Pre-code exit

Before any implementation code exists:

1. Park the original Issue in a non-startable state and record why the issue-only envelope was left.
2. Supersede the authoritative marker without editing the approved Issue contract: write a newest exact five-field marker whose fingerprint, acceptance IDs, and risk still match the live body, but whose receipt is `Approval: superseded`; remove the `issue-only` label. The resolver then returns the exact project-first seam. The original approval is annulled and can never authorize the restart.
3. Restart through `mono-idea` → discovery/handoff as a new Project-first package with new approval. Do not add a Project, PRD, Tech Spec, or Project relationship to the parked Issue. The other allowed outcome is cancellation.

### Post-`ready` exit

After a `mono-preflight` certificate already says `ready`, freeze the independently shippable Issue slice and its current PR scope. A frozen approval remains valid only while the whole-body fingerprint matches: do not edit the Issue body, acceptance IDs, marker fingerprint, or frozen implementation scope. Ship and deploy only that frozen slice as-is, and put every expanded outcome into a separate follow-up Project with its own PRD, Tech Spec, Issue, review, and approval. Set that follow-up Project's lead to the acting user (`lead: "me"` on the Linear connector) and the assignee of every Issue created in it to the same acting user (`assignee: "me"`) at creation, and never overwrite an assignment that already exists. If the current slice cannot remain independently shippable or its fingerprint no longer matches, cancel it instead; do not repair it by promotion.

An escalation discovered after code exists but before `ready` exits preflight as `drift-candidate`. Because there is no ready independently shippable slice to freeze, the safe choices are to cancel the issue-only attempt and restart Project-first, or stop for the orchestrator's risk decision. In every timing case, in-place promotion is forbidden.
