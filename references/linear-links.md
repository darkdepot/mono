# Linear Links

| Entity | Format |
| --- | --- |
| Project | Bare `P-<TEAM>-N` |
| Issue | Bare `<TEAM>-N` |
| Document or initiative | `[exact title](<url>)` |

Linear turns bare Project/Issue IDs into chips; URLs, named links and handwritten
tags stay plain. Documents/initiatives have no chip IDs. No status beside chips.
Match by `id` or `uuid`, never title.

In fingerprinted contracts, document “chip” means a named link: IS-019/IS-021
(`references/contracts/issue.md`) mean this for PRD/Tech Spec; their text stays
unchanged. Project/PRD/Tech Spec references still forbid issue-only, including
named links. Its plain `Тематический проект:` theme line remains allowed.
