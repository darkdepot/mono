# Recorded Vercel rollback and return probe

Negative findings: `lastRollbackTarget` stayed `null`; creating a GitHub
deployment without `repoId` failed; CLI access to the protected deployment URL
returned HTTP 302. These findings required the version 3 Handoff repair before
T3 could start. The approved repair is recorded in the MONO-421 dispatch;
these fixtures preserve the observations, including the failures.

Host probe for MONO-421, local date 2026-11-15, Vercel CLI 59.5.0, Node.js 26.5.0.
The host used a separate private GitHub repository and static Vercel project,
`mono-deploy-probe`, with two commits on `main`. All CLI actions ran in a
non-interactive session without a linked `.vercel` directory. The delivery
worker imported the host's sanitized captures and did not repeat the probe.
The host's point-by-point result in MONO-421, comment
`174e372a-64c0-43b8-81c5-75edeb44dc36`, is the live evidence source.

`provenance.json` retains the host's date, CLI version, replacement list and
capture edits. Its added inventory hashes the other 29 JSON files, which remain
byte-identical to the supplied sanitized inputs. CLI captures retain `command`,
`exitCode`, and either a parsed `response` or captured `output`; `requestBody`
is present for API writes. The browser capture is a host observation, not a raw
Vercel API response. None of these files performs a network request on replay.

## Response map

| Files | Observed result |
| --- | --- |
| `01-create-project.json`, `02-set-protection.json` | GitHub-linked project created; protection set to `prod_deployment_urls_and_all_previews` |
| `03-deploy-v1.json`, `04-deploy-v2.json`, `05-project-before-rollback.json`, `06-domain-read-before-rollback.json` | Two production deployments from different commits; production alias on ready v2 |
| `03a-deploy-gitsource-without-repoId-error.json` | HTTP 400: `gitSource` missing required property `repoId` |
| `07-rollback.json`, `08-project-during-rollback.json`, `09-domain-read-during-rollback.json` | Rollback passed without window/prompt; alias moved to v1; `autoAssignCustomDomains=false`, `lastRollbackTarget=null` |
| `10-deploy-new-during-rollback.json`, `11-new-deploy-ready-staged.json`, `12-domain-read-after-new-deploy.json` | Repeated v2 creation passed without window/prompt; deployment reached `READY`/`STAGED`; alias stayed on v1 |
| `13-promote.json`, `14-project-after-promote.json`, `15-domain-read-after-promote.json`, `16-aliases-after-promote.json` | Explicit promote passed without window/prompt; alias moved to repeated v2; `autoAssignCustomDomains=true`, `lastRollbackTarget=null` |
| `17-rollback-2.json`, `17-poll-project-during-rollback-2.json`, `18-project-during-rollback-2.json` | Second rollback passed; project flag changed to false a few seconds after the target changed; `lastRollbackTarget` stayed null |
| `19-plain-curl-own-url.json`, `20-vercel-curl-own-url.json` | Plain curl and `vercel curl` returned 302 on the protected deployment URL; existing CLI login did not grant page access, no automation bypass secret created |
| `21-promote-2-return.json`, `22-project-after-promote-2.json`, `23-aliases-final.json`, `24-domain-read-final.json` | Second explicit promote passed; alias returned to repeated v2; project flag true |
| `25-plain-curl-production-alias.json` | Production alias returned HTTP 200 |
| `26-browser-own-url.json` | Owner's Chrome with an existing Vercel login opened `Probe v2` without a prompt; unsigned agent browser reached login; Aside could not be checked because it required account sign-in |

The production alias moved v2 → v1 → repeated v2 → v1 → repeated v2. Domain
reads retain `id`, `target`, `readyState`, `readySubstate`, `meta.githubCommitSha`
and `gitSource.sha`. Project reads retain the actual `null` rollback target;
consumers must keep their own pre-merge target rather than infer one from it.

## Working deployment request

`new-production-deployment-request-body.json` is the exact sanitized body of
`10-deploy-new-during-rollback.json`. Supply `gitSource.repoId` from the project's
`link.repoId`. The `"<REPO_ID>"` replacement represents a JSON **number** in the
live request, not a string; other placeholders stand for redacted account values.
Deployment IDs and commit SHAs remain unchanged so response relationships can
be replayed. A production deployment created during rollback stays staged until
an explicit promote; creation success alone does not prove an alias move.

## Proof boundary

This probe used only `vercel.app` aliases. It does not prove custom-domain
behavior, including Zeni's domain. No actions on Zeni, CallCatch or Red were
part of this probe. CLI success does not establish protected page access.
Browser access was proven only in the host's already signed-in Chrome session;
Aside was unavailable and is not marked passed. No new bypass secrets or
account permissions were introduced. Live Deploy acceptance remains T3's work;
the probe resources remain available until project closeout.
