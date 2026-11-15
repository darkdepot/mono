# Local

Block: `{"targets":[{"kind":"local","paths":["src/**"],"command":"node scripts/local.mjs","check":"node scripts/health.mjs"}]}`.
Product script supports install <commit>, restore <commit>, status. Install saves
prior build BEFORE changing files; failure to save refuses install. status JSON:
copyCommit, processCommit, startedAt (ISO/epoch ms), installing/restoring booleans.
Both copy and running process must contain merge; process starts after intent.
New files alone prove nothing.

local runs install/status/health; red repeated once restores saved build, checks
status/health, records rollback. Create repair Issue with Прод на откате; pass key
as repairIssue. Only recorded repair installs while rolled back. Green archives
rollback; red twice restores rollback build and stops until morning.

Issue scenario: check surface local, id processCommit, kind scenario. Owner-only
live call/send: unavailable with reason/who/date; «выкатили, не проверено», one
owner action. Never place live calls/sends to test.
