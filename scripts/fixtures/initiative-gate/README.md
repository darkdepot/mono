# Initiative approval connector samples

These are raw responses from the authorized Mono test-initiative probe on
28.10.2026 (`probe-u1/`) and the initiative-description/document link sample on
17.11.2026 UTC, 18.11 locally (`probe-u1-links/`). Inputs were supplied read-only
by the orchestrator for MONO-259, under S6/U1 of the approved package record.
Only personal names, email addresses and user IDs are replaced by `<owner>`,
`<email>` and `<user-id>`; all other bytes, entity IDs, text and timestamps stay
as received. `MANIFEST.sha256` binds the redacted files. This follows
`scripts/fixtures/idea-gate/README.md`; no real initiative is written by tests.

The selected 28.10 responses preserve the initiative's string status, project
list, paired issue tag, decision before/after appending `Заведён`, both document
response envelopes, and the byte-identical comment response/list read-back.
That comment deliberately used placeholder hashes and old «нажал» prose;
`updatedAt` precedes `createdAt`. The link sample adds self-closing project/issue
tags and a named project link that remains a link.

Tests copy responses into a temporary dump and bind its comment to independent
expected normalized bodies, never to the implementation's hash helper. Link
cases use the link-sample initiative and decision IDs with a synthetic approval
based on the captured comment shape. Mutations and pagination requests are
synthetic and remain outside these captured responses. The historical probe's
placeholder comment is not evidence of an actual owner approval.
