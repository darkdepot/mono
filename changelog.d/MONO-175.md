### Added

- Research snapshot validation before dispatch attempt registration: the package approval must name the document, its `mono-research` fence must match the Project and carry an allowed outcome and required reason. Extra fields remain compatible with the live Linear probe.
- Optional `researchGate.since` UTC cutoff; projectless Issues and earlier approvals pass without `research/`. The default remains dormant at `2099-12-31` until MONO-178.
- CLI, configuration and dispatch fixtures, including unchanged live-probe fence bytes and refusal without attempt consumption.
