# Review Admission

Findings: fix or propose decline in phase report, bound to receipt
runId/collectionId/digest, head, dataset version, finding index/full canonical
SHA-256. ID: `<receipt digest>:<index>:<finding digest>`; never titles.

Basis: refutation (command/output or unreachable-path citation, evidence digest)
or boundary (earlier current approved d-NNN, scope/content digest); never likelihood.
Dangerous: unreviewed admission, secrets/security, data corruption, money,
irreversible actions. P0/P1/dangerous require refutation. Only orchestrator records,
approves/revokes; workers propose, never write evidence. Proposals block.

accepted-with-declines requires one valid unrevoked decline per finding on the
same receipt/head/dataset. Missing/rejected/filtered P0–P2/incomplete/contradictory
results or failed verification block. Preserve review/receipt. New head needs
review; new evidence needs decline-revoke. Recheck approvals/revocations;
Autoreview declines: lists finding ID/basis/approver. Clean unchanged.

Repeated key/class: park needs-decision before fixes/review/collection.
Propose class fix/checkpoint; only orchestrator
class-decision resumes. Unknown matching needs judgment; unmatched classes proceed.
Limit: restrict/remove behavior, verify remaining contract, create successor.
Boundary cannot excuse defects; new residual risk/reduced outcome needs owner.
Fix the class with existing/literal tools; no custom parsers/heuristics/extra mechanisms.

Counts survive heads/attempts/successors. After two local passes, stop before a third,
before/after external review. A clean last pass permits collection; a stop needs
continue. Two blocking receipts: no third collection without continue. Report
id/head/result (clean|findings) in capsule.local_passes;
orchestrator persists counts. Continue binds stop/next collection, finite
local/external allowances, nextStep/checkpoint. Use confirmed limits; count once,
park at exhaustion; replay never refills. Orchestrator alone links successors
to original chain. Continue cannot certify defects.
