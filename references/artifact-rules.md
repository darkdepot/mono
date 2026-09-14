# Linear Artifact Rules

Apply `AGENTS.md` source-of-truth, artifact responsibilities, stage ownership and language rules. Linear defaults Russian; repo instructions English. Discovery/local scratch becomes truth only through handoff; worker intake follows `references/worker-contract.md`, never broad home scans.

Set newly created Project leads and Issue assignees to acting user in every owner stage, including hotfix/follow-up; preserve existing assignments.

Project body: only what/why/outcome/in/out (`Что`, `Зачем`, `Образ результата`, `Что входит`, `Что не входит`); no active-doc/Issue/status/workflow dashboard. PRD WHAT; Spec HOW; Issue one PR/snapshot, not whole-doc copies. Apply `references/execution-quality.md`. Judge responsibility before heading spelling. Attach PRD/Spec only to Project; Issue gets chips/snapshot/resource links when supported. Prefer chips/entity mentions over raw URLs; remove obsolete/closed PR chips. Keep workflow mechanics out of durable bodies.

Record user/package acceptance in comments, naming package, PRD/Spec links/titles, Issue slices/IDs and start authorization. Missing/rejected/unrecordable approval or requested changes forbids execution-Issue creation/Delivery: BLOCKED/INCOMPLETE with links. Implement verifies start approval; handoff may explicitly grant it. Raw discovery implementation plans require handoff first.

Issue-only uses canonical-owner approval of exact whole-body SHA-256: non-startable Issue → authenticated approval/comment/read-back → marker/label; intake never activates. Body changes stale approval, renewed by mono-issue; implement re-resolves/checks before activation. Follow `references/issue-only-lane.md` and resolver `--emit-fingerprint`.

Project Updates never gate: deploy posts informational per-shipment update and completes only last-shipment Project; errors visible/verdict-neutral. Theme-project issue-only updates complete none. Apply `references/readiness-gates.md`; tiny PRD-lite/no-spec advisory requires recorded exception/reason. Review reports findings/fixes/decisions/FYI/verdict/risk/next; check owns PASS/FAIL/BLOCKED and reports drift, neither silently repairs; accepted fixes go to authorized owner.
