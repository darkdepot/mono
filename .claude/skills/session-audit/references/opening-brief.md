# Brief for an opening subagent

The session that runs the pass gives this brief to every subagent that opens
a session or a signal, together with: the digest chunk files, the inbox file
name to write, its id prefix, the stages and tags of the range, the latest
release tag and the registry candidates (`candidates`). Everything else is
read only; the subagent writes its one inbox file and returns only its name
and the count of findings.

## What Mono is

Mono is a plugin pack of workflow skills. Read the pack at a tag with
`git -C <mono repository> show <tag>:skills/<stage>/SKILL.md`, its
`references/…` and the root `references/…`.

## What to find

Things in how Mono worked that are worth improving in the pack:

- `broken`: a pack rule was broken, or a step failed;
- `intervention`: the owner (or the orchestrator in his place) had to step in;
- `guess`: the model relied on a rule the pack does not have;
- `time-loss`: time was lost waiting, looping or redoing;
- `simplify`: something could be done simpler.

`scope`: `pack` (fixable in Mono), `product` (the product's own code or
setup), `host` (the machine, CLIs, logins).

## Evidence (a script checks it and drops what fails)

- `pointer` for a session event: `{"session": "<map session id>", "event":
  "<key>"}`. Every digest line starts with `[<time> #<key>]`; copy that key
  (with or without `#`). Do not search the raw session files. For a ledger
  line or report without a session: `{"source": "<path of the map source>",
  "line": N, "ts": "<time of the line>"}`.
- `quote`: at most two lines copied exactly from the text of that event or
  line. An `answer` line also repeats its question and a `second-model` line
  its command: both belong to other events, so quote only the reply or the
  output itself.
- `rule`, `latest`, `changed`: `{"file": "skills/<stage>/SKILL.md or
  references/…", "text": "<exact substring of that file>"}`. `rule` is the
  pack text the behaviour broke, at the session's tag; `latest` is where the
  latest release still allows the problem (leave it out if it no longer
  does); `changed` is where the latest release says otherwise. For a `guess`,
  `rule.text` is the invented rule in a few words and must not exist in the
  pack.
- `mechanism` and `proposal`: по-русски (Linear is read in Russian), own
  words in pack terms (rule, reference, step, script), at most 300
  characters, no paths, no quotes, no issue keys of other teams (say «задача
  продукта» instead).
- `cost`: `stops`, `interventions`, `extraRounds`, `minutes`, each `{"value":
  n, "mark": "measured|estimate|unknown", "source": {"kind": "…", "ref":
  "…"}}`; `measured` needs `source.kind` `ledger`, `receipt` or `wave-cost`.
- `stage`: a pack skill name, or `other`.
- `screen: true` only when the only evidence is what the owner saw on screen.
- `sameAs`: a registry `F-` id from the candidates, or another id of your own
  list, when the mechanism is the same. Features alone never make two
  findings one; one mechanism in several sessions is one finding with the
  strongest pointer.
- `id`: `<your prefix>-N`.

## Output

A JSON array of findings in the named inbox file. Be selective: a few strong
findings with exact evidence beat many weak ones. Product problems: at most
one line each, scope `product`. Return only the file name and the count.
