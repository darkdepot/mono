# Ship Feedback Loop

Own PR stabilization through `mono-ship`; delegate configured ship/docs/resolver workflows. Merge/deploy/post-ship/closeout/learnings belong to deploy.

## Inputs

Gather current package, preflight certificate, PR number/URL/head, configured documentation and feedback workflows. Under dispatch use snapshot for Linear context.

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

Poll every 10 minutes; maximum 3 resolver rounds and 90 minutes wall-clock; quiet period 10 minutes without new review comments, check or head changes. Only novel findings consume rounds.

## Finding Dedup

Close later re-emissions of accepted/fixed or evidence-rejected findings with published reply citing prior thread/commit/decline rationale. Dedup consumes no round and does not restart quiet time; a cosmetic target that keeps changing remains one adjudicated finding. Treat uncertainty or a new angle as novel and keep open. Never weaken/delete/bypass tests to reach green; autoreview's no-test-edits rule applies here.

## Non-Blocking Convergence

After final authorized resolver round, reply deferring new cosmetic/nit findings (naming/style/phrasing/optional refactor), file follow-up when warranted, then reach terminal status. Never defer correctness/security/data-loss/contract blockers; escalate, including uncertain severity. Record deferrals and published-replies check in green certificate.

## Published Replies

Closure rationale must be published; unsubmitted drafts count unresolved. Before green check own reviews:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '.[] | select(.state=="PENDING")'
```

Require empty output for worker-owned reviews.

## Green Exit

Require stable latest head; docs run there/no changes/intentionally unavailable; required checks green or repo-accepted non-blocking; latest Greptile complete or intentionally unavailable; zero unresolved threads, own pending drafts and unaddressed available Greptile comments; merge state clean or repo-deployable; quiet period passed. Every closure rationale must be public.

## Green Certificate

Record the full `mono-ship green certificate` from `skills/mono-ship/SKILL.md` durably in Linear comments/resources for recovery by deploy. Include convergence deferrals and published-replies result.

## Review Status Reporting

PR exits report preflight/pre-ship outcomes or missing/skipped; docs/head; reviewers; separate blockers/nits/product-UX-scope; fixes/commit; threads/count or unknown; latest head/rechecked merge/CI; certificate recorded/not. Show actual review/findings/fix/re-check timeline, remaining actionable feedback and deploy review-safety. Name unrun manual/browser/prod/mobile/deploy/acceptance; green proves none of them.

## Needs-Human Exit

Return `needs-human` for exhausted resolver rounds (subject to convergence), repeated failed/skipped Greptile, merge conflict, product/UX/business/scope decision, resolver needs-human, unrelated dirty files or another actor changing head during fixes. Deploy approval is never a ship gate; deploy owns it.

## Blocked Or Timed Out

Return `blocked` for unavailable tools/auth/PR/Linear context, naming next action. Return `timed-out` when checks/reviews/Greptile/loop exceed wall-clock; expiry precedes needs-human unless resolver already returned it or a required human decision is known.

## Linear Comments

Use concise Russian comments for PR/review transition, docs outcome/head changes, loop completion/stop, certificate recorded/blocked and decisions. For human feedback decisions include exact question and linked PR context. Under dispatch queue comments.
