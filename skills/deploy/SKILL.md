---
name: deploy
description: Use after green mono:ship, or when asked «выкати» / «выпусти», to merge, prove delivery, check production, roll back and close out.
---

# Mono Deploy

Use the product instructions already loaded for this session.
Run in the product's session, owner or orchestrator. Never in a delivery worker.
Linear writes belong to this session; scripts decide from observed facts.
No messages to people, live sends, production data writes or new bypass secrets.

Read first:

Read now:
- `references/output.md` — exact owner lines and Issue closeout.
- `references/project-update.md` — when delivery earns a project update.

Read when:
- `references/web.md` — affected vercel target.
- `references/local.md` — affected local target.
- `references/pack.md` — pack target or release.

## Run

1. Recover current green Ship certificate; changed head returns to mono:ship.
   Configure deploy once in this product's session; owner says yes to shown block.
   Mono alone may use delegated package approval with its reason. No block: no merge.
   Legacy workflows.deploy / deployApproval are ignored.
2. Request JSON outside checkout: absolute root/config/worktree, repo, issue, head,
   certificate (full text); root is existing product state root. Run
   `node <pack-root>/scripts/deploy.mjs merge --request <file>`.
   Script locks product, rereads PR/head/checks/remarks/QA/landing, records previous
   deployment before merge, resumes same run. With qa.beforeMerge, host tester must
   pass on same head. No repeated preflight/review. Night: afk:true; destructive
   migration or web without fresh signed-in browser mark waits, no outcome.
3. Follow affected target references. Commands merge, prove, local, check, rollback,
   return, outcome use same request plus target index. Inspect returned JSON;
   acknowledgement is not proof. Model reports observations; script decides.
   Affected none: show «не проверено: <reason>»; do not claim that part shipped.
4. outcome closes/read-backs only a supported category. Worst first: rolled back,
   failed, unverified, awaiting release, verified. No targets: Issue note, no outcome
   or update. Stop: no outcome, run open, other PRs wait. Resume same head; keep state.
5. Close Issue on confirmed merge; comment truth using output.md. Create/read back
   returned followup Issues. Repair gets Прод на откате; unverified closed Issue
   gets Не проверено, reason/checker/date. Resolve labels at first use. One recorded
   repair only while rolled back; no second failed repair at night. Retire delivered
   worker through orchestrator after closeout. No new registry.
6. Show exact owner lines in product terms, no commit/build identifiers. Project
   update only when result actually reached people.
