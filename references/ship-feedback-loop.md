# Ship Feedback Loop

`mono:ship` stabilizes PRs through configured ship/docs/resolvers; deploy owns merge/post-ship/closeout/learnings.

## Inputs

Inputs: package/preflight, PR number/URL/head, docs/feedback, Linear snapshot.

## Review Bot Configuration Check

Before resolving, inspect bot re-review-on-push/re-request. Fix repetition through config or record environment; never spend resolver cycles on bot config.

## Loop

1. Match PR to Issue/package/preflight; check bot config before resolving.
2. Refresh head before waits/docs/resolver. Run docs on each head; docs/resolver pushes restart docs/review.
3. Poll checks/reviews/threads/Greptile to terminal/timeout; prefer Greptile MCP, else identifying GitHub checks/statuses.
4. Classify actionable comments/threads as novel/re-emitted under Finding Dedup.
5. No actionable feedback: quiet period. Otherwise invoke configured resolver; absent resolver → needs-human with feedback/missing-workflow note.
6. Repeat to terminal; after the authorized final novel-finding cycle apply Non-Blocking Convergence.

## Defaults

orchestration.delivery: pollSec=10, quietSec=120, evidenceLimitSec=2400 (positive
seconds). Keep the maximum 3 novel resolver rounds and Non-Blocking Convergence;
dedup consumes no round. The PR-attempt deadline survives heads; head/evidence
changes restart quiet time. Use the installed gate, never another prose timer.

## Authorized Ship Fix

Orchestrator's ship-fix amendment names the next ship-gate attempt: new
head/stateFile/preflight proof, preserved old state, same task attempt. No machine bound on ship-gate attempts; the unchanged window waives nothing, costing time.
Review thresholds/declines/class stops/caps stay unchanged; never reset old deadlines.

Required bots: attempt pins from orchestration.ship.botChecks (default
["Greptile Review"]). Only orchestrator accept.mjs amend --bot-unavailable "<reason>"
grants unavailability for this task attempt. Worker policy cannot weaken these
requirements; absent a decision, wait for head bot evidence until the deadline.

## Finding Dedup

Close re-emitted accepted/fixed or evidence-rejected findings with a published reply citing prior thread/commit/decline. Dedup consumes no round; replies are evidence events. A changing cosmetic target remains one adjudicated finding. Uncertainty/new angles stay novel/open. Never weaken/delete/bypass tests; autoreview's no-test-edits rule applies.

## Non-Blocking Convergence

After the final authorized resolver round, publish deferrals for new cosmetic/nit findings (naming/style/phrasing/optional refactor); file warranted follow-ups. Escalate correctness/security/data-loss/contract blockers or uncertain severity. Record deferrals/published-replies check in the green certificate.

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
in Linear for recovery, including deferrals/published replies.

## Review Status Reporting

Report preflight/pre-ship (including missing/skipped), docs/head/reviewers, fixes/commit, thread count/unknown, refreshed head/merge/CI, certificate recorded/not. Separate blockers/nits/product-UX-scope. Show review/findings/fix/recheck timeline, remaining feedback and deploy review-safety. Name unrun manual/browser/prod/mobile/deploy/acceptance; green proves none.

## Needs-Human Exit

`needs-human`: exhausted resolver rounds (subject to convergence), repeated failed/skipped Greptile, merge conflicts, product/UX/business/scope decisions, resolver needs-human, unrelated dirty files or another actor changing head during fixes. Deploy owns approval; it never gates ship.

## Blocked Or Timed Out

`blocked`: missing tools/auth/PR/Linear context; name next action. `timed-out`: checks/reviews/Greptile/loop expire; expiry precedes needs-human unless returned by resolver or a human decision is known.

## Linear Comments

Queue Russian comments: PR/review, docs/head, completion/stop, certificate recorded/blocked, decisions. Human decisions need exact question/PR link.
