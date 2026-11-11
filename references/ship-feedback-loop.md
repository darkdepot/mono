# Ship Feedback Loop

`mono:ship` takes the draft PR out of draft and stabilizes it; deploy owns merge/post-ship/closeout/learnings.

## Inputs

Inputs: package/preflight, PR number/URL/head, docs/feedback, Linear snapshot.

## Review Bot Configuration Check

Inspect bot re-review-on-push/re-request first. Fix repetition through config or record the environment; no round goes to bot config.

## Loop

1. Match PR to Issue/package/preflight; check bot config.
2. Refresh head before waits/docs. Run docs on each head; a docs push restarts docs/review.
3. Poll checks/reviews/threads/Greptile to terminal/timeout; prefer Greptile MCP, else identifying GitHub checks/statuses.
4. No actionable feedback: quiet period. Otherwise settle it per skills/ship step 8 (`scripts/ship-pr.mjs`); no external resolver.
5. Repeat to terminal. A remark already settled (fixed, declined with evidence) is closed with a published reply citing the prior thread/commit; it consumes no round. Never weaken/delete/bypass tests.

## Defaults

orchestration.delivery: pollSec=10, quietSec=120, evidenceLimitSec=7200 (positive
seconds). Review rounds are counted per task attempt, at most three. The PR-attempt
deadline survives heads; head/evidence changes restart quiet time. Use the
installed gate, never another prose timer.

## Authorized Ship Fix

Orchestrator's ship-fix amendment names the next ship-gate attempt: new
head/stateFile/preflight proof, preserved old state, same task attempt. No machine bound on ship-gate attempts; the unchanged window waives nothing, costing time.
The fixed head needs one narrow review round within the attempt's three. Never reset old deadlines.

Required bots: attempt pins from orchestration.ship.botChecks (default
["Greptile Review"]). Only orchestrator accept.mjs amend --bot-unavailable "<reason>"
grants unavailability for this task attempt. Worker policy cannot weaken these
requirements; absent a decision, wait for head bot evidence until the deadline.

## Published Replies

Publish closure rationale; drafts remain unresolved. Before green check own reviews:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '.[] | select(.state=="PENDING")'
```

Worker-owned output must be empty.

## Green Exit

Run installed gate.mjs ship --request <json>: open PR/stable head; docs on head,
unchanged or authorized unavailable; pre-ship review/readiness passed; head CI
green/accepted terminal non-blocking; head Greptile complete/authorized unavailable;
no unresolved threads, own drafts, change requests or unaddressed bot remarks;
published closure rationale; quiet pause before deadline. Require MERGEABLE/CLEAN,
or UNSTABLE only for accepted terminal failures with nothing pending. Await
UNKNOWN/empty rollups. CheckRun/StatusContext must prove head bot checks, not old
reviews. Before judgment record sealed head/merge-base preflight proof; heads stale
proof. Return gate reason. Record Rules API 403/404 unavailable; keep other gates.
Retry other reads to deadline; evidence-limit parks, waiving nothing.

## Green Certificate

Store full `mono-ship green certificate` from `skills/ship/SKILL.md`
in Linear for recovery, including successors/published replies.

## Review Status Reporting

Report preflight/pre-ship (including missing/skipped), docs/head/reviewers, fixes/commit, thread count/unknown, refreshed head/merge/CI, certificate recorded/not. Separate blockers/nits/product-UX-scope. Name unrun manual/browser/prod/mobile/deploy/acceptance; green proves none.

## Needs-Human Exit

`needs-human`: repeated failed/skipped Greptile, merge conflicts, product/UX/business/scope decisions, unrelated dirty files or another actor changing head during fixes. Deploy owns approval; it never gates ship.

## Blocked Or Timed Out

`blocked`: missing tools/auth/PR/Linear context; name next action. `timed-out`: checks/reviews/Greptile/loop expire; expiry precedes needs-human unless a human decision is known.

## Linear Comments

Queue Russian comments: PR/review, docs/head, completion/stop, certificate recorded/blocked, decisions. Human decisions need exact question/PR link.
