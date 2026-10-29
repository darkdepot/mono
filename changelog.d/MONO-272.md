### Changed

- Connected products require green QA on the current PR head before deploy preparation and landing. The orchestrator runs the independent tester after ship and repeats the full list after ship-fix.
- Final implementation waits for project QA over the current build; held bug successors share that final certificate. Products without a recipe retain their existing merge path with an explicit tester-not-connected note.
