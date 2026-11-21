# Ship Feedback Loop

`mono:ship` stabilizes the draft PR; deploy owns merge, delivery and closeout.

## Inputs

Approved package, current-head preflight, PR, docs/feedback and Linear snapshot.

## Review Bot Configuration Check

Check re-review-on-push/re-request; fix config or record its absence, without a review round.
`orchestration.ship.botChecks` pins unique check names, default ["Greptile Review"].
An empty list means no bot; workers cannot override pins. Bots must not be branch-required CI.

## Loop

1. Match PR/Issue/preflight. Refresh head before docs/waits; each new head needs docs/proof.
2. Run gate.mjs ship while polling CI and feedback. Its task-level Ship bot state stores
   startedAt at the first fully green mandatory CI (red/pending CI never opens it).
   Recover earlier green PR heads of this attempt on entry.
   Thirty minutes later silence becomes «молчал», without park.
   Restart, fixes and new gate state files never reset this task clock. With []: «нет».
3. Timely reply: P1 fixed, P2 fixed or answered, per skills/ship step 8; decisions in
   judgment.botRemarks, threads closed by published replies. Later heads need CI/proof,
   never another bot wait; outcome stays «ответил».
4. Previously settled findings get a published reference to the prior reply/commit,
   without a round. Never weaken tests.
5. Finish the quiet period and gates; pending CI is never green.

## Defaults

orchestration.delivery: pollSec=10, quietSec=120, evidenceLimitSec=7200 (positive
seconds). Evidence and quiet clocks remain separate
from the fixed bot limit. Bot waiting can extend the evidence deadline through
its thirty minutes and quiet pause; CI/read failures still expire.

## Authorized Ship Fix

A ship fix stays in the worker session and names the next gate attempt, new
head/stateFile/proof; preserve old state and task attempt. No gate-attempt cap.
Task bot state stays in reports/<Issue>-a<attempt>-ship-bot.json (standalone:
ship-bot-<owner>-<repo>-<PR>.json beside stateFile, retain it). Never reset it or old evidence deadlines.

## Published Replies

Publish rationale; drafts stay unresolved. Own pending reviews must be empty:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '.[] | select(.state=="PENDING")'
```

## Green Exit

Installed gate.mjs ship --request <json>: open stable head; sealed head/merge-base
preflight; pre-ship review/readiness passed; docs run/unchanged/authorized unavailable;
CI green/accepted terminal non-blocking; bot replied/timed out/absent; no unresolved
threads, own drafts, change requests or unaddressed remarks; published replies;
quiet pause. MERGEABLE/CLEAN, or UNSTABLE only for accepted failures. Await UNKNOWN
and empty rollups. Rules API 403/404 is unavailable, not proof of success.
Other reads retry to the evidence deadline; their expiry still parks.

## Green Certificate

Store the full skill certificate in Linear, including replies/successors and exactly
one «Бот: ответил|молчал|нет» from the gate's bot outcome. Deploy uses this line to
ignore unfinished bot checks and bot remarks after Ship; CI and owner remarks always
block.

## Review Status Reporting

Name preflight/pre-ship, docs/head/reviewers, fixes, threads, CI/merge, bot outcome and
certificate publication. Disclose unrun manual/browser/prod/mobile/deploy/acceptance.

## Needs-Human Exit

Conflicts, product/UX/scope decisions, unrelated dirty files or another writer's head
change need a decision. Deploy owns merge approval.

## Blocked Or Timed Out

Missing tools/auth/context: blocked. CI/read deadlines: timed-out/evidence-limit.
Bot silence alone never parks a new attempt.

## Linear Comments

Write Russian results/decisions/certificate yourself; dispatch writes follow worker-contract Linear Writes.
