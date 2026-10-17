### Changed

- Require a project-matching approved idea and verified package approval before orchestrator dispatch; refusals do not consume attempts. Preserve issue-only and pre-0.32.0 attempt compatibility.
- Pin the saved idea, selected record and canonical artifact digest through collection requests, signed preflight receipts and ship verification; amendments and resumes retain the original binding.
