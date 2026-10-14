Review limits now park automation after two blocking external reviews or two local
passes. Chain counters survive commits, attempts and orchestrator-authorized
successors. Bounded continuation decisions use atomic, idempotent reservations;
they never admit unresolved defects.
Collections require pinned requests and correlated admission. Unpinned legacy
collections are refused. All pending admissions count on reservation and recheck.
Local stops withhold the
queue until continuation; a clean second pass keeps the normal collection flow.
Receipt issue/pins identity preserves chain counts across worktree changes;
anonymous historical receipts are ignored by scope decision.
