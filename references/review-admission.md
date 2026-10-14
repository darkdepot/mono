# Review Admission

Committed review: fix or propose `decline` in phase report: receipt runId/collectionId/digest, head, dataset version, finding index
and full canonical object SHA-256. ID: `<receipt digest>:<index>:<finding digest>`; no titles.

Basis: `refutation` (command/output or unreachable-path citation, evidence object
SHA-256) or `boundary` (earlier current approved `d-NNN`, scope/content
digest). No likelihood basis.
`dangerous` consequences: unreviewed code admission, secrets/security,
data corruption, money, irreversible actions. P0/P1 and dangerous require
refutation. Orchestrator records/approves/revokes; no worker evidence
writes. Proposals block.

Findings pass `accepted-with-declines` only with one valid unrevoked
decline per finding on that receipt/head/dataset version. Missing,
rejected, filtered P0–P2, incomplete/contradictory results or failed verification
block. Preserve review/receipt. New head needs review; new evidence needs
orchestrator `decline-revoke`. Recheck after approval/revocation; list finding ID,
basis, approver in `Autoreview declines:`. Clean unchanged.
