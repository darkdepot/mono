### Changed

- Rebuilt Idea from the approved Russian v7 draft: parallel source scouts, one meaning question at a time, owner yes to the shown description, verified recording before status changes, and Research next. The orchestrator runs Idea itself and shows its reasoned answers for owner approval.
- Made Idea checks consume `verify`, kept writing/recovery in the skill's own reference, and resolved script paths from the package root. Package validation now supports Russian read tiers, conditional Project-contract reads and skill-local references; mandatory Idea reading is limited to about 20 KB.
- Added 10 positive and 6 negative Claude plugin activation evals, three runs at threshold 0.8. The orchestrator runs Claude-only checks on the final head; live stage behavior acceptance follows release 0.32.1.
