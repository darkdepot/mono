# Ship Feedback Loop

Own PR stabilization in `mono-ship`; delegate configured ship/docs/resolvers. Leave merge/deploy/post-ship/closeout/learnings to deploy.

## Inputs

Gather package, preflight certificate, PR number/URL/head and configured docs/feedback. Use dispatch snapshot for Linear.

## Review Bot Configuration Check

Before first resolver cycle inspect bot re-review-on-push/re-request settings. Fix repeated-adjudicated-finding behavior through config or record as environment fact; never spend code resolver cycles on bot configuration.

## Loop

1. Confirm PR maps to Issue and scope matches package/preflight; perform bot config check before first resolver.
2. Detect latest head before each wait/docs/resolver run. Run configured documentation if not run at current head. After docs/resolver push, record new head and restart documentation/review there.
3. Poll checks, review, unresolved threads and Greptile to terminal/timeout. Prefer Greptile MCP; otherwise identifying GitHub checks/statuses.
4. Inspect threads and actionable Greptile comments; classify novel/re-emitted under Finding Dedup.
5. No actionable feedback: start quiet period. Otherwise invoke configured resolver; absent resolver is `needs-human` with feedback summary/missing-workflow note.
6. Repeat to terminal outcome; after authorized final novel-finding cycle apply Non-Blocking Convergence.

## Defaults

Use orchestration.delivery configuration: pollSec (10), quietSec (120), evidenceLimitSec (2400), all positive seconds. Keep the maximum 3 novel resolver rounds and Non-Blocking Convergence; dedup consumes no round. The evidence deadline is per PR attempt and survives head changes; a new head or new inspected evidence restarts the quiet pause. Run the installed gate script, never a second timer in prose.

## Finding Dedup

Close later re-emissions of accepted/fixed or evidence-rejected findings with published reply citing prior thread/commit/decline rationale. Dedup consumes no round; its published reply is a new evidence event; a cosmetic target that keeps changing remains one adjudicated finding. Treat uncertainty or a new angle as novel and keep open. Never weaken/delete/bypass tests to reach green; autoreview's no-test-edits rule applies here.

## Non-Blocking Convergence

After final authorized resolver round, reply deferring new cosmetic/nit findings (naming/style/phrasing/optional refactor), file follow-up when warranted, then reach terminal status. Never defer correctness/security/data-loss/contract blockers; escalate, including uncertain severity. Record deferrals and published-replies check in green certificate.

## Published Replies

Closure rationale must be published; unsubmitted drafts count unresolved. Before green check own reviews:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '.[] | select(.state=="PENDING")'
```

Require empty output for worker-owned reviews.

## Green Exit

Run installed gate.mjs ship --request <json>: live open PR/stable head;
docs on head/no changes/intentionally unavailable; mandatory pre-ship review
performed/readiness passed; head CI green or accepted terminal non-blocking;
Head Greptile completed/intentionally unavailable; zero unresolved threads,
own drafts, requested changes or unaddressed bot remarks; public closure rationales;
evidence pause before deadline. Require MERGEABLE with CLEAN, or UNSTABLE
only with accepted terminal non-blocking failures and nothing pending.
Await UNKNOWN/empty rollups. Parse CheckRun/StatusContext; require head bot checks,
not old reviews after force-push. Before judgment require sealed preflight proof
for PR head/merge-base; record its path. New heads invalidate proofs; return gate reason.
Rules API 403/404: record unavailability; retain other gates. Retry other read failures
until deadline; evidence-limit parks, waiving nothing.

## Green Certificate

Store full `mono-ship green certificate` from `skills/mono-ship/SKILL.md`
in Linear for deploy recovery: convergence deferrals/published replies included.

## Review Status Reporting

PR exits report preflight/pre-ship outcomes or missing/skipped; docs/head; reviewers; separate blockers/nits/product-UX-scope; fixes/commit; threads/count or unknown; latest head/rechecked merge/CI; certificate recorded/not. Show actual review/findings/fix/re-check timeline, remaining actionable feedback and deploy review-safety. Name unrun manual/browser/prod/mobile/deploy/acceptance; green proves none of them.

## Needs-Human Exit

Return `needs-human` for exhausted resolver rounds (subject to convergence), repeated failed/skipped Greptile, merge conflict, product/UX/business/scope decision, resolver needs-human, unrelated dirty files or another actor changing head during fixes. Deploy approval is never a ship gate; deploy owns it.

## Blocked Or Timed Out

Return `blocked` for unavailable tools/auth/PR/Linear context, naming next action. Return `timed-out` when checks/reviews/Greptile/loop exceed wall-clock; expiry precedes needs-human unless resolver already returned it or a required human decision is known.

## Linear Comments

Use concise Russian comments for PR/review transition, docs outcome/head changes, loop completion/stop, certificate recorded/blocked and decisions. For human feedback decisions include exact question and linked PR context. Under dispatch queue comments.
