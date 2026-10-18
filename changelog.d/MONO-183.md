# MONO-183

- Added one stage-task definition, role assignment and Russian task template; package membership, repair and dispatch consumers link to it.
- Research finds or creates its own task first, records its log there and closes it on completion or refused entry.
- Handoff sets Ready after approved package and passing check; Delivery Start accepts Ready, with legacy/missing-status Discovery fallback, and class 3 repair removes Ready.
