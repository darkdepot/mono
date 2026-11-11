# Orchestration Policy: Stages

Part of the `mono:orchestrate` control-plane policy. `references/orchestration.md`
holds the always-read part and the map of parts. Read this part before launching or
answering a pre-delivery stage agent, and before any `by=orchestrator` record.

## Director Discovery

Run the chain through stage agents one Project at a time while delivery waves
continue. Deferred Projects wait for their return condition or owner return.
Launch prompt states owner context, exact stage-agent and scout names, product,
source inputs and round. Owner-led next stages remain in the same session, except
Design in a separate session whose parent ran Discovery. A delegated stage ends
with a verified record and selected transition; the orchestrator launches the next
stage session. A Discovery callback from Design/Tech Evaluation is performed in
that session under Discovery rules, with orchestrator's version-bound reason and
countercheck for PRD approval. Preserve partial Design → Discovery → Design recovery;
return only after the stage's own record is confirmed.

Every PRD approval decides design then size; `next=design` goes to Design then
ordinary/large work to Tech Evaluation, tiny work to Handoff. Not-needed routes
by size. Reapproval invalidates lower records when the route changes. Run `route`
before exemptions, then verify required records in chain order. PRD without
`next=` retains the router's old path. Handoff verifies effective `mono-tech` for
current PRD and consumes a valid record without another offer. Only absent/invalid
tech with ordinary/large size gets a contextual text question about starting Tech Evaluation.
Consent opens that old path; without it no package or continuation.
Tech Evaluation owns new Tech Specs; Handoff consumes them and owns package repair.
A changed tech page returns to its owner; class 3 repair needs a new authorized start.

Stage agents use the same dialogue as owner sessions. Their last turn contains
the result, position and one contextual question as its final message. Reply in words with a reason on that
version; agent records `by=orchestrator`, reason and countercheck outside fences,
then reads back. Idea requires the owner: show the stage description verbatim as the orchestrator's final message, then relay that text, the actual question and the verbatim owner reply. A paraphrase is insufficient; without the owner's words no Idea approval.
Do not relay other stage questions to the owner. After every stage send the owner
its R1 result (conclusion, decisions, exclusions/reason, next, link; 120 words,
Handoff 150), plus «Утвердил сам, потому что…». Decisions on their behalf come first:
«Решил за тебя: …, потому что …». Show exceptions and deferred/irreversible choices.

Handoff asks a contextual question about starting work.
Only explicit owner words delegating work record
`by=owner` and transfers delivery to the orchestrator. A delegated Project accepts
orchestrator start with reason/countercheck. Ready alone never starts delivery.

## Stage agent permissions and visible dialogue

Use `templates/stage-agent.md` and its adjacent `templates/stage-helper-hook.mjs`.
The template is outside `agents/` so the plugin cannot register placeholders.
Build stage and scout definitions under `~/.claude/agents/` using product/stage-specific
names, never overriding owner-session `mono:*-scout`. Use only exact tool names
from current host connections, no server wildcard. Default categories: files,
terminal, helpers, Linear, Paper and Wonder for design, web search. No mail, finance, browser,
screen, Desktop sessions or windows without owner action. Host-added tools (e.g.
`advisor`) are not owner connections and are outside the list. This limits direct
calls, not isolation; terminal remains for verification and the isolated second model.

Desktop names `mcp__<uuid>__…` differ from CLI `mcp__claude_ai_<Имя>__…`: assemble
for the orchestrator's host; wrong names mean no access. Map each allowed exact
name to its category, leave all other connections absent. For Design include the exact available Paper and Wonder tool names, including
Wonder `get_skills`, `get_design_context`, `take_screenshot` and `get_element_code`;
the stage selects by owner words, product `design.tool`, then `paper`. Missing
selected tools stop the stage with an explicit alternative, never a silent switch.
New connections stay excluded until explicitly added. Scouts get their own exact allowlists plus read-only
restrictions. Launch prompt supplies their private names; stage uses only those.
`Agent(type)` does not restrict helpers: stage frontmatter must carry PreToolUse
matcher `Agent|Task`, invoking the hook with the allowed scout names. It reads
`tool_input.subagent_type`, rejects other types on stderr with exit 2. Copy the hook
to `<orchestrator-root>/hooks/` when building definitions and put its absolute path
in the header; never use a versioned plugin-cache or session-temp operational path.

At every orchestrator start and before each stage launch verify definitions, exact
tool names against live host connections, no project definition override, scout
names, hook bytes/path and current session visibility. New/edited definitions are
visible only to a session started afterward: start a fresh orchestrator session
before delegation. Missing, unverified or invisible definitions: do not launch;
report the reason while other Projects proceed. Codex cannot select a restricted
role/type for its subagent: delegated stages do not run there. Tell the owner:
«Этапы делегированного проекта идут в Claude Code». Do not substitute broader rights.

Append every stage/orchestrator message immediately to
`.claude/session-views/<этап>-<ключ проекта>-<круг>.md` in the product working
directory; link that file in each owner stage result. Not the orchestrator root:
Desktop opens chat file links only inside session folders. Check `git check-ignore`;
if unignored, append `.claude/session-views/` to the product `.git/info/exclude`,
leaving `.gitignore` unchanged. Do not use a child Desktop session for delegation:
the tested orchestrator session cannot launch it and messages cannot reach a
session launched by the orchestrator. Design under delegation is an agent too;
its end of turn returns control. Owner-led separate-session Design stays separate.

## Approval countercheck

Before every `by=orchestrator` record (PRD including renewals/Design callbacks,
mockup, tech page, work start, package-repair approval), run a different-family
second model per `references/model-policy.md`, read-only, foreground. Give result,
exact approved text/version, PRD, earlier owner decisions, stage second-model
report and proposed reason. Pass text/local paths, never Linear links: no owner
connections. Resolve model/effort by policy, then use the appropriate invocation:

```bash
codex exec --ignore-user-config --disable apps -m <модель> -c model_reasoning_effort=<усилие> -s read-only "<задание>" < /dev/null
claude -p --strict-mcp-config --model <модель> --effort <усилие> "<задание>" < /dev/null
```

`--disable apps` also blocks ChatGPT app connectors, enabled by default even
when user config is ignored.

Record verdict with model and reviewed-text version outside fences in that same
approval comment, alongside reason; machine lines unchanged. Text or reason changes:
check again. Objection: explain it in words without approving. Repeated objection on the same
point: decide, retain objection/rejection reason in record; first owner-result line:
«Решил за тебя: … вопреки второй модели, потому что …». No response after one retry:
no approval; report reason and continue other Projects. This countercheck is separate
from the unchanged package Second Voice dialogue below.

### Second Voice

For pre-write package review, delegate the critique to an independent fresh-context
Second Voice with the product brief, Linear links and repo read access. It reviews
the package; the orchestrator answers as product director. This dialogue protocol
does not run the Idea, Research or Discovery stages.

Model selection is mandatory and cross-vendor: the Second Voice runs on
a different model family from the orchestrator. A fresh context on the same
model is not a second voice. Resolve the model AND reasoning effort from the
selected policy row; never copy an effort literal into this consumer.

#### Claude orchestrator

Orchestrator on Claude → [role:second-voice](model-policy.md#roles).
Resolve from the immutable BASE config with the installed runtime before launch:

```bash
node <installed-runtime>/runtime.mjs --role second-voice --worktree <repo> --base <base-commit>
```

Use `modelRoutes.roles["second-voice"]` model/effort in a fresh Codex thread:

```bash
codex exec --json -c 'model="<second-voice-model>"' -c 'model_reasoning_effort="<second-voice-effort>"' "$(cat <review-prompt-file>)" < /dev/null
```

Replace both placeholders from the resolved route and record its fingerprint/base. Continue
with `codex exec resume`, preserving the requested launch pins. This is a
reviewer, not a worker: no worktree, Issue or registry entry. Record its
thread id, resolved role, requested model and effort, and round count in
discovery notes. On resume rebind or deliberately restart the dialogue and
end orphaned reviewer processes.

#### GPT orchestrator

Orchestrator on GPT → [role:second-voice-alt](model-policy.md#roles).
Use its exact model id and row effort through the Claude CLI, never an
alias or a floating latest selector:

```bash
claude -p --model <second-voice-alt-model> --effort <second-voice-alt-effort> "$(cat <review-prompt-file>)" < /dev/null
```

Replace both placeholders from this row before launch and continue the same
review session with its launch pins. This role is independent of the
Claude worker row; changing a worker never selects the alternative reviewer.

#### Unavailable route

- Fallback, only when the cross-vendor model is unreachable (no Codex
  auth, or no Claude access): run the lens review in-session (product,
  engineering, and design lenses) and record the substitution and its
  reason in the discovery notes.
  A same-model Second Voice is not an acceptable fallback; an in-session
  lens pass is.

Dispatch shape per skill run: the reviewer role and the named skill; the
product brief and Linear links; repo read access; the instruction to
deliver questions and challenges as its final message — never through
user-question tools, there is no user on its side; and the required
closing verdict: strengths, top risks, contested items, recommendation.

Dialogue protocol: rounds of ask → answer → challenge, capped at 3
rounds per skill (guidance, not a gate). After the cap, unresolved
disagreements that are Always-ask class go to the user as checkpoint
items; the rest the orchestrator decides, recording both positions under
«Решил сам:».

Boundaries: the Second Voice never talks to the user, never writes
Linear, and never dispatches or steers workers; it is discovery work and
pre-write package review, not stage work. Both roles carry the same
boundaries: reviewing a draft package never grants it a Linear write, an
owner conversation, or any authority over workers.

### Pre-write package review

The orchestrator's `mono:handoff` state has one mandatory Second Voice run
that is not discovery: the drafted package record and [execution Issues](lifecycle.md#задачи-этапов)
bodies, checked against the approved PRD read-only, go to an independent reviewer
next to `mono:review handoff`, BEFORE the orchestrator writes any of it to Linear.
Order, not preference: synthesize the draft, review it, fix the draft, then write,
set Ready and bring the owner the summary.

- The reviewer is a discovery agent under the Second Voice protocol above —
  fresh context, cross-vendor model, no worktree, no Issue, no registry
  entry — and it has no Linear-write capability and no owner contact.
  Findings return to the orchestrator, which applies accepted fixes to the
  draft package.
- Obligation follows `references/readiness-gates.md`: required for
  `standard`, `deep`, and `risky`, advisory for `tiny` with the skip reason
  recorded. The orchestrator cannot decide this gate away under «Решил
  сам:»; only findings inside it are its to accept.
- The reviewed subject is the draft, so none of the drafted bodies — package
  record, [execution Issues](lifecycle.md#задачи-этапов) — is written to Linear at review time.
  The Project entity itself may already exist, and stays available to the
  reviewer as surrounding context; what is absent is the drafted content, not
  necessarily the container. That absence is expected and is never reported as
  a missing artifact. Approved PRD already exists read-only; a PRD finding returns
  to Discovery for renewed yes in the package touch, per the pre-write `handoff` mode in
  `skills/review/SKILL.md`.
- Workers never run this review. They cannot spawn agents, and a worker is
  not independent of the package it was dispatched from.
- The work-start checkpoint stays a single owner touch, because the verdict
  is already applied when the summary is written.
