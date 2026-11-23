---
name: deploy
description: Use after green mono:ship, or when asked «выкати» / «выпусти», to merge, prove delivery, check production, roll back and close out.
---

# Mono Deploy

Use product instructions already loaded.
Run in the product's session, owner or orchestrator. Never in a delivery worker.
Session owns Linear writes; scripts decide from facts.
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

1. Recover green Ship for current head; changed head returns to mono:ship.
   Before issue-only merge, reread live Issue/marker/label; verify its whole-body
   fingerprint against approval (../../references/issue-only-lane.md); changed or
   revoked approval: stop.
   Product block needs owner yes; Mono may use delegated package approval/reason.
   No block: same merge gates, close unverified; invalid block refuses. Ignore legacy
   workflows.deploy / deployApproval.
2. Request JSON outside checkout: absolute root/config/worktree, repo, issue, head,
   certificate (full text); root is existing product state root. Run
   `node <pack-root>/scripts/deploy.mjs merge --request <file>`; merge waits up to
   8 min for the main check; `waiting-validation`: repeat the same call.
   Script locks/rereads PR/head/checks/remarks/QA/landing and records previous
   deployment. qa.beforeMerge needs host tester on same head. Night: afk:true; destructive
   migration or web without fresh signed-in browser mark waits, no outcome.
3. Follow affected target references. Commands merge, prove, local, check, rollback,
   return, outcome use same request plus target index. Inspect returned JSON;
   acknowledgement is not proof. Model reports observations; script decides.
   Affected none: check surface none, scenario, id = merge, observed version (+release
   if stated). Verified only if observed is merge or tagged release; else «не проверено: <reason>».
4. outcome closes/read-backs supported categories, worst first. No targets: note,
   no outcome/update. No block: unverified with reason, no update.
   Stop: no outcome, run open, other PRs wait. Keep state.
5. Close Issue on confirmed merge; comment truth using output.md. Create/read back
   returned followup Issues. Repair gets Прод на откате; unverified closed Issue
   gets Не проверено, reason/checker/date. Resolve labels at first use. One recorded
   repair only while rolled back; no second failed repair at night. Retire delivered
   worker through orchestrator after closeout. No new registry.
   After creating repair Issue, bind repairIssue via rollback, even on a closed run.
6. Show exact owner lines in product terms, no commit/build identifiers.
   Project update only after proven delivery.
