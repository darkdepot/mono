### Fixed

- Replace fixed watcher-event startup sleeps with bounded output polling in the between-scan continuation regression. Confirm a completed scan and its delivered output before expiring the fixed continuation window; retain writer identity, the consumed acknowledgement and the quiet log when changing only `consumedAt`. Watcher behavior and clocks are unchanged.
