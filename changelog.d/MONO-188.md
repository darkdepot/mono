### Changed

- Rebuilt Idea from the approved Russian v7 draft: parallel source scouts, one meaning question at a time, owner yes to the shown description, verified recording before status changes, and Research next. The orchestrator runs Idea itself and shows its reasoned answers for owner approval.
- Made Idea checks consume `verify`, kept writing/recovery in the skill's own reference, and resolved script paths from the package root. Package validation uses the shared `scripts/russian-stages.mjs` list (Idea first) for Russian read tiers, the first-AGENTS exemption and conditional Project-contract reads, with explicit package-root and skill-local references; mandatory Idea reading is limited to about 20 KB.
- The next stage is Research (`mono:research`); while that skill is absent from the installed pack, the next step is `mono:handoff`. Research's follow-up removes this temporary fallback.
- Added 10 positive and 6 negative Claude plugin activation evals, three runs at threshold 0.8. The orchestrator runs Claude-only checks on the final head; live stage behavior acceptance follows release 0.32.1.
