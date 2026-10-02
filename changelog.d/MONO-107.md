- MONO-107: assemble task changelog records in key order during release, preserve
  existing notes, preview without writes, and recover interrupted assembly using
  per-record SHA-256 markers. Mono task branches now leave records in changelog.d;
  CHANGELOG.md and VERSION are reserved for the orchestrator's release task.
