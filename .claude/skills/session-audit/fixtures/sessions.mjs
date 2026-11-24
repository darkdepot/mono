// Invented, anonymised session files in the record shapes Claude Code and
// Codex write. Each builder documents the case it stands for. Contents,
// names, ids and paths are synthetic; homes live under a temporary directory.

import fs from "node:fs";
import path from "node:path";

import { PACK, loadBody, writeTree } from "./pack.mjs";

export const NOW = "2026-11-25T12:00:00.000Z";
export const BOUNDARY = "2026-11-21T12:00:00.000Z";
export const BEFORE = "2026-11-20T10:00:00.000Z"; // before the boundary, inside 7 days
export const OLD = "2026-11-10T10:00:00.000Z"; // before any window

export const IDS = {
  owner: "11111111-1111-4111-8111-111111111111",
  ownerResume: "11111111-2222-4111-8111-111111111111",
  foreign: "22222222-1111-4111-8111-111111111111",
  noLoad: "22222222-2222-4111-8111-111111111111",
  orchestrator: "33333333-1111-4111-8111-111111111111",
  readsBoth: "33333333-2222-4111-8111-111111111111",
  readsNone: "33333333-3333-4111-8111-111111111111",
  audit: "44444444-1111-4111-8111-111111111111",
  qaRun: "55555555-1111-4111-8111-111111111111",
  worker: "66666666-1111-4111-8111-111111111111",
  childWorker: "66666666-2222-4111-8111-111111111111",
  shortReads: "66666666-3333-4111-8111-111111111111",
  codexOwner: "77777777-1111-4111-8111-111111111111",
  codexFork: "77777777-2222-4111-8111-111111111111",
  codexBatched: "77777777-3333-4111-8111-111111111111",
  reviewer: "66666666-4444-4111-8111-111111111111",
  stageAgent: "a0000000000000001",
  auditAgent: "a0000000000000009",
};

let counter = 0;
const uuid = () => {
  counter += 1;
  return `e0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
};

export const at = (base, minutes) => new Date(Date.parse(base) + minutes * 60000).toISOString();

function jsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

// ---------------------------------------------------------------- Claude shapes

function claude(sessionId, cwd, entrypoint = "claude-desktop") {
  const base = (type, ts, extra) => ({ parentUuid: null, isSidechain: false, type, uuid: uuid(), timestamp: ts, userType: "external", entrypoint, cwd, sessionId, version: "9.9.9", gitBranch: "main", ...extra });
  return {
    user: (ts, text) => base("user", ts, { message: { role: "user", content: text } }),
    meta: (ts, text) => base("user", ts, { isMeta: true, message: { role: "user", content: [{ type: "text", text }] } }),
    // Live load form: "Base directory" line, empty line, body without frontmatter, arguments appended.
    load: (ts, dir, bodyText, args) => base("user", ts, { isMeta: true, message: { role: "user", content: [{ type: "text", text: `Base directory for this skill: ${dir}\n\n${bodyText}${args ? `\n\nARGUMENTS: ${args}` : ""}` }] } }),
    say: (ts, text, id = `msg_${uuid()}`, usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 }) =>
      base("assistant", ts, { message: { model: "model-x", id, type: "message", role: "assistant", content: [{ type: "text", text }], usage } }),
    use: (ts, id, name, input, msgId = `msg_${uuid()}`) =>
      base("assistant", ts, { message: { model: "model-x", id: msgId, type: "message", role: "assistant", content: [{ type: "tool_use", id, name, input }], usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } }),
    result: (ts, id, content, toolUseResult) => base("user", ts, { message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content }] }, ...(toolUseResult ? { toolUseResult } : {}) }),
    other: (type, extra = {}) => ({ type, ...extra, sessionId }),
  };
}

const numbered = (text, start = 1) => text.split("\n").filter((_line, i, all) => i < all.length - 1 || all[i] !== "").map((line, i) => `${start + i}\t${line}`).join("\n");

// ---------------------------------------------------------------- Codex shapes

function codex(id, { cwd, originator = "codex_exec", source = "exec", forkedFrom = null, parentMeta = null } = {}) {
  let ordinal = 0;
  const record = (ts, type, payload) => ({ timestamp: ts, ordinal: ordinal++, type, payload });
  return {
    meta: (ts) => [
      record(ts, "session_meta", { session_id: forkedFrom || id, id, ...(forkedFrom ? { forked_from_id: forkedFrom } : {}), timestamp: ts, cwd, originator, cli_version: "9.9.9", source }),
      ...(parentMeta ? [record(ts, "session_meta", parentMeta)] : []),
    ],
    turn: (ts) => record(ts, "turn_context", { cwd }),
    user: (ts, text, itemId = `msg_${uuid()}`) => record(ts, "response_item", { type: "message", id: itemId, role: "user", content: [{ type: "input_text", text }] }),
    say: (ts, text, itemId = `msg_${uuid()}`) => record(ts, "response_item", { type: "message", id: itemId, role: "assistant", content: [{ type: "output_text", text }] }),
    exec: (ts, callId, input, itemId = `ctc_${uuid()}`) => record(ts, "response_item", { type: "custom_tool_call", id: itemId, status: "completed", call_id: callId, name: "exec", input }),
    output: (ts, callId, parts, itemId = `ctco_${uuid()}`) => record(ts, "response_item", { type: "custom_tool_call_output", id: itemId, call_id: callId, output: [{ type: "input_text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }, ...parts.map((text) => ({ type: "input_text", text }))] }),
    event: (ts, payload) => record(ts, "event_msg", payload),
    raw: (ts, type, payload) => record(ts, type, payload),
  };
}

const execCmd = (cmd) => `const r = await tools.exec_command({cmd:${JSON.stringify(cmd)},max_output_tokens:9000});\ntext(r.output)\n`;

// ---------------------------------------------------------------- world

export function buildWorld(root, { repo }) {
  counter = 0;
  const home = path.join(root, "home");
  const work = path.join(home, "work");
  const alpha = path.join(work, "alpha");
  fs.mkdirSync(path.join(alpha, ".git"), { recursive: true });
  const projects = path.join(home, ".claude", "projects");
  const projectDir = path.join(projects, "-work-alpha");
  const files = [];
  const put = (file, records) => { jsonl(file, records); files.push(file); return file; };

  // Installed copies of the pack. The cache path says 0.2.0 but holds the
  // 0.1.0 review text: the version comes from the tags, the path is a hint.
  const cache = path.join(home, ".claude", "plugins", "cache", "mono-marketplace", "mono", "0.2.0");
  writeTree(cache, { ...PACK["v0.2.0"], "skills/review/SKILL.md": PACK["v0.1.0"]["skills/review/SKILL.md"] });
  // A git-clone install has no version in its path.
  const clone = path.join(home, "packs", "mono-clone");
  writeTree(clone, PACK["v0.2.0"]);
  // A copy of skill files without any pack manifest.
  const looseCopy = path.join(home, ".codex", "loose-mono");
  writeTree(looseCopy, { "skills/review/SKILL.md": PACK["v0.1.0"]["skills/review/SKILL.md"] });
  // Someone else's skill set with the same names as Mono.
  const foreignSkills = path.join(home, ".claude", "skills");
  writeTree(foreignSkills, { "review/SKILL.md": "---\nname: review\ndescription: Another set.\n---\n\n# Other review\n\nLook at the code and say what you think.\n" });

  // 1. Owner session: load of review from the cache, Q&A window, plan,
  //    second model in the parent, the load line quoted by the owner and seen
  //    in a tool output (neither is a load). Events before the boundary were
  //    read in the previous pass; later events are new.
  const c1 = claude(IDS.owner, alpha);
  const ownerRecords = [
    c1.other("custom-title", { customTitle: "x" }),
    c1.user(at(BEFORE, 0), "Start the review of the invented page."),
    c1.load(at(BEFORE, 1), path.join(cache, "skills", "review"), loadBody("v0.1.0", "review"), "page one"),
    c1.say(at(BEFORE, 2), "Reading the page before the boundary.", "msg_before_1"),
    c1.user(at(BOUNDARY, 30), "Please continue. Earlier it said: Base directory for this skill: /somewhere/skills/review"),
    c1.say(at(BOUNDARY, 31), "Continuing after the boundary.", "msg_after_1"),
    c1.use(at(BOUNDARY, 32), "toolu_q1", "AskUserQuestion", { questions: [{ question: "Which page next?", header: "Next", multiSelect: false, options: [{ label: "Page two" }, { label: "Page three" }] }] }),
    c1.result(at(BOUNDARY, 33), "toolu_q1", "User has answered your questions: \"Which page next?\"=\"Page two\".", { answers: { "Which page next?": "Page two" } }),
    c1.use(at(BOUNDARY, 34), "toolu_plan", "TodoWrite", { todos: [{ content: "secret plan text", status: "pending" }] }),
    c1.result(at(BOUNDARY, 34), "toolu_plan", "ok"),
    c1.use(at(BOUNDARY, 35), "toolu_grep", "Bash", { command: "grep -r 'Base directory' notes.txt" }),
    c1.result(at(BOUNDARY, 35), "toolu_grep", "notes.txt: Base directory for this skill: /elsewhere/skills/qa"),
    c1.use(at(BOUNDARY, 36), "toolu_cx", "Bash", { command: "codex exec --skip-git-repo-check 'review page two' < /dev/null" }),
    c1.result(at(BOUNDARY, 37), "toolu_cx", `session id: ${IDS.childWorker}\nchild says: page two is fine\n${"x".repeat(30000)}`),
    c1.use(at(BOUNDARY, 38), "toolu_q2", "AskUserQuestion", { questions: [{ question: "Ship it?", header: "Ship", multiSelect: false, options: [{ label: "Yes" }, { label: "No" }] }] }),
    c1.result(at(BOUNDARY, 39), "toolu_q2", "[User did not answer this question — they sent a message instead. Treat the message as their reply.]"),
    c1.user(at(BOUNDARY, 40), "<task-notification>background job done</task-notification>"),
    c1.other("attachment", { attachment: { type: "invoked_skills", skills: [{ name: "review", path: "plugin:review", content: `Base directory for this skill: ${path.join(cache, "skills", "review")}\n\nquoted` }] } }),
  ];
  put(path.join(projectDir, `${IDS.owner}.jsonl`), ownerRecords);
  // 1b. Resume of the owner session: a new file starting with a copy of the
  //     old history (same uuids and times), then new events.
  const resume = claude(IDS.ownerResume, alpha);
  const copied = ownerRecords.filter((record) => record.uuid).slice(0, 6).map((record) => ({ ...record, sessionId: IDS.ownerResume }));
  put(path.join(projectDir, `${IDS.ownerResume}.jsonl`), [
    ...copied,
    resume.user(at(BOUNDARY, 120), "Resumed: finish page two."),
    resume.say(at(BOUNDARY, 121), "Finished page two.", "msg_after_1"),
  ]);

  // 2. Foreign skill named like a Mono skill, outside the pack: not Mono.
  const c2 = claude(IDS.foreign, alpha);
  put(path.join(projectDir, `${IDS.foreign}.jsonl`), [
    c2.load(at(BOUNDARY, 60), path.join(foreignSkills, "review"), "# Other review\n\nLook at the code and say what you think."),
    c2.say(at(BOUNDARY, 61), "Other review done."),
  ]);
  // 2b. Session without any Mono load.
  const c2b = claude(IDS.noLoad, alpha);
  put(path.join(projectDir, `${IDS.noLoad}.jsonl`), [c2b.user(at(BOUNDARY, 70), "Hello"), c2b.say(at(BOUNDARY, 71), "Hi")]);

  // 3. Orchestrator from the git clone: orchestrate equals both tags; a full
  //    Read of the guide (numbered lines, raw file in toolUseResult) leaves v0.2.0.
  const c3 = claude(IDS.orchestrator, alpha);
  const guideV2 = PACK["v0.2.0"]["references/guide.md"];
  put(path.join(projectDir, `${IDS.orchestrator}.jsonl`), [
    c3.load(at(BOUNDARY, 80), path.join(clone, "skills", "orchestrate"), loadBody("v0.2.0", "orchestrate")),
    c3.use(at(BOUNDARY, 81), "toolu_r1", "Read", { file_path: path.join(clone, "references", "guide.md") }),
    c3.result(at(BOUNDARY, 81), "toolu_r1", numbered(guideV2), { type: "text", file: { filePath: path.join(clone, "references", "guide.md"), content: guideV2.replace(/\n$/, ""), numLines: 12, startLine: 1, totalLines: 12 } }),
    c3.use(at(BOUNDARY, 82), "toolu_agent", "Agent", { description: "stage agent", prompt: "do the stage" }),
    c3.result(at(BOUNDARY, 90), "toolu_agent", "stage agent finished"),
  ]);
  // 3a. Stage agent of the orchestrator with its meta file.
  const agentDir = path.join(projectDir, IDS.orchestrator, "subagents");
  const sa = claude(IDS.orchestrator, alpha);
  put(path.join(agentDir, `agent-${IDS.stageAgent}.jsonl`), [
    { ...sa.user(at(BOUNDARY, 83), "Run the implement stage."), isSidechain: true, agentId: IDS.stageAgent },
    { ...sa.load(at(BOUNDARY, 84), path.join(clone, "skills", "implement"), loadBody("v0.1.0", "implement")), agentId: IDS.stageAgent },
    { ...sa.say(at(BOUNDARY, 85), "Stage done.", "msg_agent_1"), agentId: IDS.stageAgent },
  ]);
  fs.writeFileSync(path.join(agentDir, `agent-${IDS.stageAgent}.meta.json`), JSON.stringify({ agentType: "general-purpose", description: "stage agent", toolUseId: "toolu_agent" }));

  // 3b. A Read of the first five guide lines (offset/limit, numbered lines
  //     only) fits both tags; 3c. a Read whose text fits no tag.
  const c3b = claude(IDS.readsBoth, alpha);
  const firstFive = guideV2.split("\n").slice(0, 5).join("\n");
  put(path.join(projectDir, `${IDS.readsBoth}.jsonl`), [
    c3b.load(at(BOUNDARY, 100), path.join(clone, "skills", "implement"), loadBody("v0.2.0", "implement")),
    c3b.use(at(BOUNDARY, 101), "toolu_r2", "Read", { file_path: path.join(clone, "references", "guide.md"), offset: 1, limit: 5 }),
    c3b.result(at(BOUNDARY, 101), "toolu_r2", `${numbered(firstFive)}\n\n<system-reminder>\nnote\n</system-reminder>`),
  ]);
  const c3c = claude(IDS.readsNone, alpha);
  put(path.join(projectDir, `${IDS.readsNone}.jsonl`), [
    c3c.load(at(BOUNDARY, 102), path.join(clone, "skills", "implement"), loadBody("v0.2.0", "implement")),
    c3c.use(at(BOUNDARY, 103), "toolu_r3", "Read", { file_path: path.join(clone, "references", "guide.md") }),
    c3c.result(at(BOUNDARY, 103), "toolu_r3", numbered("# Guide\n\nA locally edited guide.\n"), { type: "text", file: { filePath: "x", content: "# Guide\n\nA locally edited guide.", numLines: 3, startLine: 1, totalLines: 3 } }),
  ]);

  // 4. The audit session itself and its subagent: never in the map.
  const auditDir = path.join(repo, ".claude", "skills", "session-audit");
  const c4 = claude(IDS.audit, repo);
  put(path.join(projectDir, `${IDS.audit}.jsonl`), [
    c4.user(at(BOUNDARY, 200), "разбери сессии"),
    c4.load(at(BOUNDARY, 201), auditDir, "# Session audit\n\nInvented body."),
    c4.say(at(BOUNDARY, 202), "Collecting."),
  ]);
  const auditAgents = path.join(projectDir, IDS.audit, "subagents");
  const a9 = claude(IDS.audit, repo);
  put(path.join(auditAgents, `agent-${IDS.auditAgent}.jsonl`), [
    { ...a9.load(at(BOUNDARY, 203), path.join(cache, "skills", "review"), loadBody("v0.1.0", "review")), agentId: IDS.auditAgent },
    { ...a9.say(at(BOUNDARY, 204), "Opened a session."), agentId: IDS.auditAgent },
  ]);
  fs.writeFileSync(path.join(auditAgents, `agent-${IDS.auditAgent}.meta.json`), JSON.stringify({ agentType: "general-purpose", description: "open a session" }));

  // 5. QA run in a second Claude profile with its work folder under a run prefix.
  const stand = path.join(home, "stands", "demo");
  const c5 = claude(IDS.qaRun, stand, "sdk-cli");
  put(path.join(home, ".claude-second", "projects", "-stands-demo", `${IDS.qaRun}.jsonl`), [
    c5.user(at(BOUNDARY, 300), "Test the demo."),
    c5.load(at(BOUNDARY, 301), path.join(clone, "skills", "qa"), loadBody("v0.2.0", "qa")),
    c5.say(at(BOUNDARY, 302), "Demo checked."),
  ]);

  // 6. Codex worker of the orchestrator: full cat of implement from the clone
  //    in a worktree of a task; its id is in the orchestrator ledger.
  const codexDay = path.join(home, ".codex", "sessions", "2026", "11", "22");
  const worktree = path.join(alpha, ".worktrees", "ALPHA-12");
  const w1 = codex(IDS.worker, { cwd: worktree });
  put(path.join(codexDay, `rollout-2026-11-22T10-00-00-${IDS.worker}.jsonl`), [
    ...w1.meta(at(BOUNDARY, 400)),
    w1.turn(at(BOUNDARY, 400)),
    w1.user(at(BOUNDARY, 400), "<environment_context>\n  <cwd>x</cwd>\n</environment_context>"),
    w1.user(at(BOUNDARY, 401), "Implement task ALPHA-12."),
    w1.exec(at(BOUNDARY, 402), "call_w1", execCmd(`cat '${path.join(clone, "skills", "implement", "SKILL.md")}'`)),
    w1.output(at(BOUNDARY, 402), "call_w1", [PACK["v0.2.0"]["skills/implement/SKILL.md"]]),
    // Batched call whose results are printed as JSON objects one after
    // another on one line: a full cat of the guide narrows the version, the
    // `rg -n` search beside it is not a read of the file.
    w1.exec(at(BOUNDARY, 402.5), "call_w1b", `const rs = await Promise.allSettled([tools.exec_command({cmd:"cat '${path.join(clone, "references", "guide.md")}'"}),tools.exec_command({cmd:"rg -n 'rule' '${path.join(clone, "references", "guide.md")}'"})]);\nrs.forEach((r) => text(JSON.stringify(r)))\n`),
    w1.output(at(BOUNDARY, 402.5), "call_w1b", [
      JSON.stringify({ status: "fulfilled", value: { chunk_id: "c1", exit_code: 0, output: PACK["v0.2.0"]["references/guide.md"] } }) +
      JSON.stringify({ status: "fulfilled", value: { chunk_id: "c2", exit_code: 0, output: "3:Guide rule 1 of the invented pack.\n4:Guide rule 2 of the invented pack.\n" } }),
    ]),
    w1.say(at(BOUNDARY, 403), "Implemented."),
  ]);

  // 7. Codex child started by the owner session (`codex exec` above): partial
  //    read of 15 review lines by `sed -n` from a copy without a pack manifest.
  const w2 = codex(IDS.childWorker, { cwd: alpha });
  const reviewV1 = PACK["v0.1.0"]["skills/review/SKILL.md"].split("\n");
  put(path.join(codexDay, `rollout-2026-11-22T11-00-00-${IDS.childWorker}.jsonl`), [
    ...w2.meta(at(BOUNDARY, 36)),
    w2.exec(at(BOUNDARY, 36.2), "call_w2", execCmd(`sed -n '5,19p' ${path.join(looseCopy, "skills", "review", "SKILL.md")}`)),
    w2.output(at(BOUNDARY, 36.3), "call_w2", [reviewV1.slice(4, 19).join("\n")]),
    w2.say(at(BOUNDARY, 36.5), "Page two is fine."),
  ]);

  // 8. Short reads: `head -n 1` of a foreign SKILL.md and four lines of a Mono
  //    skill outside a pack root: neither is a Mono load.
  const w3 = codex(IDS.shortReads, { cwd: alpha });
  put(path.join(codexDay, `rollout-2026-11-22T12-00-00-${IDS.shortReads}.jsonl`), [
    ...w3.meta(at(BOUNDARY, 500)),
    w3.exec(at(BOUNDARY, 501), "call_w3", execCmd(`head -n 1 ${path.join(home, "elsewhere", "skills", "review", "SKILL.md")}\nsed -n '6,9p' ${path.join(looseCopy, "skills", "review", "SKILL.md")}`)),
    w3.output(at(BOUNDARY, 501), "call_w3", [`---\n${reviewV1.slice(5, 9).join("\n")}`]),
    w3.say(at(BOUNDARY, 502), "Nothing to do."),
  ]);

  // 9. Codex owner session (desktop) with a full review read from the clone,
  //    9b. its fork: copies of the parent items with new times, then new ones.
  const o1 = codex(IDS.codexOwner, { cwd: alpha, originator: "Codex Desktop", source: "vscode" });
  const ownerItems = [
    o1.user(at(BOUNDARY, 600), "Review page four.", "msg_o1_user"),
    o1.exec(at(BOUNDARY, 601), "call_o1", execCmd(`cat ${path.join(clone, "skills", "review", "SKILL.md")}`), "ctc_o1"),
    o1.output(at(BOUNDARY, 601), "call_o1", [PACK["v0.2.0"]["skills/review/SKILL.md"]], "ctco_o1"),
    o1.say(at(BOUNDARY, 602), "Page four reviewed.", "msg_o1_say"),
  ];
  put(path.join(codexDay, `rollout-2026-11-22T13-00-00-${IDS.codexOwner}.jsonl`), [...o1.meta(at(BOUNDARY, 600)), ...ownerItems]);
  const parentMeta = { session_id: IDS.codexOwner, id: IDS.codexOwner, timestamp: at(BOUNDARY, 600), cwd: alpha, originator: "Codex Desktop", source: "vscode" };
  const f1 = codex(IDS.codexFork, { cwd: alpha, originator: "Codex Desktop", source: "vscode", forkedFrom: IDS.codexOwner, parentMeta });
  put(path.join(codexDay, `rollout-2026-11-22T14-00-00-${IDS.codexFork}.jsonl`), [
    ...f1.meta(at(BOUNDARY, 700)),
    f1.raw(at(BOUNDARY, 700), "compacted", { message: "" }),
    ...ownerItems.map((item) => ({ ...item, timestamp: at(BOUNDARY, 700) })),
    f1.user(at(BOUNDARY, 701), "In the fork: try another wording."),
    f1.say(at(BOUNDARY, 702), "Fork answer."),
  ]);

  // 10. Batched Codex call: the path is interpolated and the output carries
  //     a truncation header inside a JSON line of the batch.
  const o2 = codex(IDS.codexBatched, { cwd: alpha, originator: "Codex Desktop", source: "vscode" });
  const orchestrateV = PACK["v0.2.0"]["skills/orchestrate/SKILL.md"].split("\n");
  const batch = `await Promise.allSettled([["skill",tools.exec_command({cmd:"sed -n '1,30p' '\${d}/SKILL.md'",max_output_tokens:900})],["files",tools.exec_command({cmd:"ls -1",max_output_tokens:100})]].map(async([k,p])=>{const r=await p;text([k,r.output])}))`;
  put(path.join(codexDay, `rollout-2026-11-22T15-00-00-${IDS.codexBatched}.jsonl`), [
    ...o2.meta(at(BOUNDARY, 800)),
    o2.exec(at(BOUNDARY, 801), "call_o2", batch),
    o2.output(at(BOUNDARY, 801), "call_o2", [`${JSON.stringify(["skill", `Warning: truncated output (original token count: 999)\nTotal output lines: 30\n\n${orchestrateV.slice(0, 22).join("\n")}`])}\n${JSON.stringify(["files", "a.txt\nb.txt"])}`]),
    o2.user(at(BOUNDARY, 802), `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: "q1", question: "Which plan?", answer: "The short one" }])}\n</send_user_message_question_reply>`),
    o2.say(at(BOUNDARY, 803), "Going with the short plan."),
  ]);

  // 11. Codex reviewer: a headless run that loads review; not in the ledger,
  //     no parent prints its id, so it stays without a link.
  const r1 = codex(IDS.reviewer, { cwd: path.join(home, "scratch") });
  put(path.join(codexDay, `rollout-2026-11-22T16-00-00-${IDS.reviewer}.jsonl`), [
    ...r1.meta(at(BOUNDARY, 900)),
    r1.exec(at(BOUNDARY, 901), "call_r1", execCmd(`cat ${path.join(clone, "skills", "review", "SKILL.md")}`)),
    r1.output(at(BOUNDARY, 901), "call_r1", [PACK["v0.2.0"]["skills/review/SKILL.md"]]),
    r1.say(at(BOUNDARY, 902), "Reviewed."),
    // Partial read by pattern: twelve step lines of the clone's review.
    r1.exec(at(BOUNDARY, 903), "call_r2", execCmd(`sed -n '/^Step 1:/,/^Step 12:/p' ${path.join(clone, "skills", "review", "SKILL.md")}`)),
    r1.output(at(BOUNDARY, 903), "call_r2", [PACK["v0.2.0"]["skills/review/SKILL.md"].split("\n").filter((line) => line.startsWith("Step ")).join("\n")]),
  ]);

  // Orchestrator records: ledger lines (one in the window with the worker
  // id, one older), a phase report and an archived report.
  const orch = path.join(home, ".mono-agent-workflow", "orchestrator", "alpha");
  fs.mkdirSync(path.join(orch, "reports", "archive"), { recursive: true });
  fs.writeFileSync(path.join(orch, "ledger.md"), [
    "# Ledger",
    `- ${OLD} ALPHA-11 merged`,
    `- ${at(BOUNDARY, 399)} ALPHA-12 worker started session ${IDS.worker}`,
    `- ${at(BOUNDARY, 410)} ALPHA-12 phase done`,
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(orch, "reports", "ALPHA-12-implementation.json"), JSON.stringify({ issue: "ALPHA-12", finishedAt: at(BOUNDARY, 405) }));
  fs.writeFileSync(path.join(orch, "reports", "archive", "ALPHA-9-implementation.json"), JSON.stringify({ issue: "ALPHA-9", finishedAt: at(BOUNDARY, 405) }));
  fs.mkdirSync(path.join(orch, "receipts"), { recursive: true });
  fs.writeFileSync(path.join(orch, "receipts", "ALPHA-11.json"), JSON.stringify({ issue: "ALPHA-11", at: OLD }));

  const stamp = new Date(NOW);
  for (const file of files) fs.utimesSync(file, stamp, stamp);
  return { home, projects, projectDir, alpha, clone, cache, looseCopy, orch, files };
}

export function unknownRecordWorld(root) {
  const home = path.join(root, "home");
  const file = path.join(home, ".claude", "projects", "-x", "99999999-1111-4111-8111-111111111111.jsonl");
  jsonl(file, [
    { type: "user", uuid: "e9999999-0000-4000-8000-000000000001", timestamp: at(BOUNDARY, 10), sessionId: "99999999-1111-4111-8111-111111111111", cwd: "/x", message: { role: "user", content: "hi" } },
    { type: "mystery-record", uuid: "e9999999-0000-4000-8000-000000000002", timestamp: at(BOUNDARY, 11) },
  ]);
  return { home, file };
}
