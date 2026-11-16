# Web

Block: `{"targets":[{"kind":"vercel","paths":["src/**"],"domain":"app.example.com","team":"team_id","check":"node scripts/smoke.mjs"}]}`.
At most five fields; paths use * and **, omitted means all files. Zeni paths must
cover its vercel-ignore-build list; mobile uses none. team is the Vercel team ID
(team_…), never the slug. Product sessions write blocks; Mono only reads others.

Before AFK merge, open current deployment's own URL in owner's browser with Vercel
login; pass browserReady:{id,at}, or [{target,id,at}] for multiple targets
(ISO, at most 10 minutes). No browser: waits until
morning, no merge/outcome. Deploy never signs in.

prove reads production domain every 20s, CLI at most 120s. Proof: READY production
at merge or descendant. No build/ERROR/CANCELED: one immediate repeat with link.repoId; active/READY
build waits 10 minutes from merged_at. Repeat gets 10 more minutes. New main changes inside paths forbid old-code repeat.
Repair READY/STAGED stays off-domain until explicit promote. Rollback target/own
URL come from pre-merge run record, never Vercel's lastRollbackTarget.

Script runs quick check only by production domain. Inspect command source: browser
checks SAME pages/signs plus Issue scenario at own URLs. check adds target, id,
url, kind quick|scenario, result green|red|unavailable, attempt 1|2, surface
browser|domain. Unavailable needs reason/who; closeout names date. Only recorded
IDs/addresses and current domain accepted. No browser: unavailable without
browserAvailable:true; real-data-only obstacle with browser: set it true. No curl.

Domain red: browser-test new own URL twice and saved old own URL. Old also red:
known breakage, followup, no rollback. New red twice/old green: rollback decides,
checks restored domain/quick; create repair Issue, pass key as repairIssue.
S19/U5 explicit exception: domain red/own URL green keeps red record, discrepancy
followup, «выкатили, не проверено», never «проверили».

Repair merge uses fix equal to recorded repair Issue. prove; browser quick/scenario
on repair own URL; return promotes and exits awaiting prod check. Record prod
scenario, return again: green archives rollback; ONE red cancels return without
repeat, verifies rollback, Stop until morning. Browser unavailable: record
unavailable; rollback/return refuse, Stop, no outcome, open run. Supply browser
and resume same check. U7 unknown action cannot repeat without positive proof.
