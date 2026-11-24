// Edge cases found in review, each in invented content: repeated Codex items
// without ids, answers and outputs after the boundary, native Codex
// questions, contradicting partial reads, batched reads, relative paths,
// changed full reads, a child of the audit, receipts under evidence roots.

import fs from "node:fs";
import path from "node:path";

import { PACK, loadBody, writeTree } from "./pack.mjs";
import { BEFORE, BOUNDARY, NOW, OLD, at, claude, codex, execCmd, jsonl } from "./sessions.mjs";

export const EDGE = {
  repeat: "a1111111-1111-4111-8111-111111111111",
  questions: "a2222222-1111-4111-8111-111111111111",
  nativeQuestion: "a3333333-1111-4111-8111-111111111111",
  contradict: "a4444444-1111-4111-8111-111111111111",
  batched: "a5555555-1111-4111-8111-111111111111",
  relative: "a6666666-1111-4111-8111-111111111111",
  changedFull: "a7777777-1111-4111-8111-111111111111",
  audit: "a8888888-1111-4111-8111-111111111111",
  auditChild: "a8888888-2222-4111-8111-111111111111",
  revisit: "a9999999-1111-4111-8111-111111111111",
  syncQuestion: "a3333333-2222-4111-8111-111111111111",
  stageMismatch: "acacacac-1111-4111-8111-111111111111",
  batchedMismatch: "acacacac-2222-4111-8111-111111111111",
};

export const LONG_OWNER = `Long owner note. ${"word ".repeat(70_000)}END-OF-OWNER-NOTE`;

export function buildEdgeWorld(root, { repo }) {
  const home = path.join(root, "home");
  const alpha = path.join(home, "work", "alpha");
  fs.mkdirSync(path.join(alpha, ".git"), { recursive: true });
  const clone = path.join(home, "packs", "mono-clone");
  writeTree(clone, PACK["v0.2.0"]);
  const loose = path.join(home, "loose", "copy");
  writeTree(loose, { "skills/review/SKILL.md": PACK["v0.1.0"]["skills/review/SKILL.md"] });
  const projectDir = path.join(home, ".claude", "projects", "-work-alpha");
  const day = path.join(home, ".codex", "sessions", "2026", "11", "22");
  const files = [];
  const put = (file, records) => { jsonl(file, records); files.push(file); return file; };
  const rollout = (id) => path.join(day, `rollout-2026-11-22T00-00-00-${id}.jsonl`);
  const review = PACK["v0.2.0"]["skills/review/SKILL.md"];
  const reviewCat = (session, minutes, call) => [
    session.exec(at(BEFORE, minutes), call, execCmd(`cat ${path.join(clone, "skills", "review", "SKILL.md")}`)),
    session.output(at(BEFORE, minutes), call, [review]),
  ];

  // Repeated owner words without item ids, before and after the boundary.
  const rp = codex(EDGE.repeat, { cwd: alpha, originator: "Codex Desktop", source: "vscode" });
  const again = (minutesBase, minutes) => rp.raw(at(minutesBase, minutes), "response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] });
  put(rollout(EDGE.repeat), [...rp.meta(at(BEFORE, 0)), ...reviewCat(rp, 1, "call_rp"), again(BEFORE, 2), again(BOUNDARY, 10)]);

  // Questions answered after the boundary, an unanswered one, a second-model
  // output after the boundary and an owner message above 200 KB.
  const q = claude(EDGE.questions, alpha);
  put(path.join(projectDir, `${EDGE.questions}.jsonl`), [
    q.load(at(BEFORE, 1), path.join(clone, "skills", "review"), loadBody("v0.2.0", "review")),
    q.use(at(BEFORE, 5), "toolu_late", "AskUserQuestion", { questions: [{ question: "Keep the old title?", options: [{ label: "Keep" }, { label: "Change" }] }] }),
    q.use(at(BEFORE, 6), "toolu_cx", "Bash", { command: "claude -p 'second look' < /dev/null" }),
    q.result(at(BOUNDARY, 5), "toolu_late", "User has answered your questions.", { answers: { "Keep the old title?": "Change" } }),
    q.use(at(BOUNDARY, 6), "toolu_open", "AskUserQuestion", { questions: [{ question: "Publish now?", options: [{ label: "Yes" }, { label: "Later" }] }] }),
    q.result(at(BOUNDARY, 7), "toolu_cx", "second look: fine"),
    q.user(at(BOUNDARY, 8), LONG_OWNER),
  ]);

  // Native Codex question tool with JSON arguments and a reply message.
  const nq = codex(EDGE.nativeQuestion, { cwd: alpha, originator: "Codex Desktop", source: "vscode" });
  put(rollout(EDGE.nativeQuestion), [
    ...nq.meta(at(BEFORE, 0)),
    ...reviewCat(nq, 1, "call_nq_read"),
    nq.raw(at(BOUNDARY, 20), "response_item", { type: "function_call", id: "fc_q", call_id: "call_q", name: "request_user_input_async", arguments: JSON.stringify({ questions: [{ title: "Which colour?", options: ["Blue", "Green"] }] }) }),
    nq.raw(at(BOUNDARY, 20), "response_item", { type: "function_call_output", id: "fco_q", call_id: "call_q", output: "{\"status\":\"queued\"}" }),
    nq.user(at(BOUNDARY, 25), `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: JSON.stringify(["request_user_input_async", "call_q", 0]), question: "Which colour?", answer: "Green" }])}\n</send_user_message_question_reply>`),
  ]);

  // The synchronous question tool returns the answers in its output.
  const sq = codex(EDGE.syncQuestion, { cwd: alpha, originator: "Codex Desktop", source: "vscode" });
  put(rollout(EDGE.syncQuestion), [
    ...sq.meta(at(BEFORE, 0)),
    ...reviewCat(sq, 1, "call_sq_read"),
    sq.raw(at(BOUNDARY, 21), "response_item", { type: "function_call", id: "fc_sq", call_id: "call_sq", name: "request_user_input", arguments: JSON.stringify({ questions: [{ title: "Which day?", options: ["Monday", "Tuesday"] }] }) }),
    sq.raw(at(BOUNDARY, 22), "response_item", { type: "function_call_output", id: "fco_sq", call_id: "call_sq", output: JSON.stringify({ answers: [{ title: "Which day?", answer: "Tuesday" }] }) }),
  ]);

  // Stage reads after a confirmed load whose shown lines fit no tag: one
  // call alone, and one call of a batch with results per call.
  const guide = path.join(clone, "references", "guide.md");
  const sm = codex(EDGE.stageMismatch, { cwd: alpha });
  put(rollout(EDGE.stageMismatch), [
    ...sm.meta(at(BOUNDARY, 32)),
    ...reviewCat(sm, 0, "call_sm_load").map((record) => ({ ...record, timestamp: at(BOUNDARY, 33) })),
    sm.exec(at(BOUNDARY, 34), "call_sm", execCmd(`sed -n '3,5p' ${guide}`)),
    sm.output(at(BOUNDARY, 34), "call_sm", ["Guide rule 1 of the invented pack.\nGuide rule two, edited locally.\nGuide rule 3 of the invented pack."]),
  ]);
  const bm = codex(EDGE.batchedMismatch, { cwd: alpha });
  put(rollout(EDGE.batchedMismatch), [
    ...bm.meta(at(BOUNDARY, 35)),
    ...reviewCat(bm, 0, "call_bm_load").map((record) => ({ ...record, timestamp: at(BOUNDARY, 36) })),
    bm.exec(at(BOUNDARY, 37), "call_bm", `const rs = await Promise.allSettled([tools.exec_command({cmd:"sed -n '3,4p' ${guide}"}),tools.exec_command({cmd:"ls -1"})]);\nrs.forEach((r) => text(JSON.stringify(r)))\n`),
    bm.output(at(BOUNDARY, 37), "call_bm", [
      JSON.stringify({ status: "fulfilled", value: { output: "Guide rule 1 of the invented pack.\nA rule that no release has." } }) +
      JSON.stringify({ status: "fulfilled", value: { output: "a.txt\nb.txt" } }),
    ]),
  ]);

  // A partial read whose lines contradict the tag in the middle.
  const ct = codex(EDGE.contradict, { cwd: alpha });
  const lines = PACK["v0.1.0"]["skills/review/SKILL.md"].split("\n").slice(4, 19);
  lines[8] = "Step 5: rate nothing at all";
  put(rollout(EDGE.contradict), [
    ...ct.meta(at(BOUNDARY, 30)),
    ct.exec(at(BOUNDARY, 31), "call_ct", execCmd(`sed -n '5,19p' ${path.join(loose, "skills", "review", "SKILL.md")}`)),
    ct.output(at(BOUNDARY, 31), "call_ct", [lines.join("\n")]),
  ]);

  // Batched reads: a foreign skill's head and the Mono skill, outputs printed
  // as JSON one after another; the foreign read must not take the Mono text.
  const bt = codex(EDGE.batched, { cwd: alpha });
  const foreign = path.join(home, "other", "skills", "review", "SKILL.md");
  put(rollout(EDGE.batched), [
    ...bt.meta(at(BOUNDARY, 40)),
    bt.exec(at(BOUNDARY, 41), "call_bt", `const rs = await Promise.allSettled([tools.exec_command({cmd:"head -n 3 ${foreign}"}),tools.exec_command({cmd:"cat ${path.join(clone, "skills", "review", "SKILL.md")}"})]);\nrs.forEach((r) => text(JSON.stringify(r)))\n`),
    bt.output(at(BOUNDARY, 41), "call_bt", [
      JSON.stringify({ status: "fulfilled", value: { output: "---\nname: other\ndescription: Other set." } }) +
      JSON.stringify({ status: "fulfilled", value: { output: review } }),
    ]),
  ]);

  // A relative path read in the pack clone as its working folder.
  const rl = codex(EDGE.relative, { cwd: clone });
  put(rollout(EDGE.relative), [
    ...rl.meta(at(BOUNDARY, 50)),
    rl.exec(at(BOUNDARY, 51), "call_rl", execCmd("cat skills/implement/SKILL.md")),
    rl.output(at(BOUNDARY, 51), "call_rl", [PACK["v0.2.0"]["skills/implement/SKILL.md"]]),
  ]);

  // A full read of an installed file with a local line added.
  const cf = codex(EDGE.changedFull, { cwd: alpha });
  put(rollout(EDGE.changedFull), [
    ...cf.meta(at(BOUNDARY, 60)),
    cf.exec(at(BOUNDARY, 61), "call_cf", execCmd(`cat ${path.join(clone, "skills", "qa", "SKILL.md")}`)),
    cf.output(at(BOUNDARY, 61), "call_cf", [`${PACK["v0.2.0"]["skills/qa/SKILL.md"]}Local note added after install.\n`]),
  ]);

  // The audit session starts a `codex exec` child whose id is in its output.
  const au = claude(EDGE.audit, alpha);
  put(path.join(projectDir, `${EDGE.audit}.jsonl`), [
    au.load(at(BOUNDARY, 70), path.join(repo, ".claude", "skills", "session-audit"), "# Session audit\n\nInvented body."),
    au.use(at(BOUNDARY, 71), "toolu_child", "Bash", { command: "codex exec 'open one session' < /dev/null" }),
    au.result(at(BOUNDARY, 72), "toolu_child", `session id: ${EDGE.auditChild}\ndone`),
  ]);
  const ac = codex(EDGE.auditChild, { cwd: alpha });
  put(rollout(EDGE.auditChild), [...ac.meta(at(BOUNDARY, 71.5)), ...reviewCat(ac, 0, "call_ac").map((record) => ({ ...record, timestamp: at(BOUNDARY, 71.6) }))]);

  // A session whose second record was still being written at the last pass.
  const rv = claude(EDGE.revisit, alpha);
  const revisitFile = put(path.join(projectDir, `${EDGE.revisit}.jsonl`), [
    rv.load(at(BEFORE, 1), path.join(clone, "skills", "review"), loadBody("v0.2.0", "review")),
    rv.say(at(BEFORE, 2), "Finished just before the boundary."),
  ]);
  const revisitOffset = Buffer.byteLength(fs.readFileSync(revisitFile, "utf8").split("\n")[0], "utf8") + 1;

  // A file whose last record is cut (being written now).
  const tailFile = path.join(projectDir, "abababab-1111-4111-8111-111111111111.jsonl");
  const tl = claude("abababab-1111-4111-8111-111111111111", alpha);
  fs.mkdirSync(path.dirname(tailFile), { recursive: true });
  fs.writeFileSync(tailFile, `${JSON.stringify(tl.load(at(BOUNDARY, 80), path.join(clone, "skills", "review"), loadBody("v0.2.0", "review")))}\n{"type":"assistant","uuid":"cut`);
  files.push(tailFile);

  // Review receipts under the default evidence root and under one a
  // dispatch record names; an old receipt stays outside the window.
  const state = path.join(home, ".mono-agent-workflow");
  const writeReceipt = (dir, name, recordedAt) => {
    fs.mkdirSync(path.join(dir, "history"), { recursive: true });
    fs.writeFileSync(path.join(dir, "history", name), JSON.stringify({ receipt: { producer: "invented", recordedAt, review: { outcome: "converged" } } }));
  };
  writeReceipt(path.join(state, "evidence", "alpha"), "run-1.json", at(BOUNDARY, 90));
  writeReceipt(path.join(state, "evidence", "alpha"), "run-0.json", OLD);
  const elsewhere = path.join(home, "evidence-elsewhere");
  writeReceipt(elsewhere, "run-2.json", at(BOUNDARY, 95));
  fs.mkdirSync(path.join(state, "orchestrator", "alpha", "dispatch"), { recursive: true });
  fs.writeFileSync(path.join(state, "orchestrator", "alpha", "dispatch", "workers.json"), JSON.stringify({ workers: [{ issue: "ALPHA-20", evidenceRoot: elsewhere }] }));

  const stamp = new Date(NOW);
  for (const file of files) fs.utimesSync(file, stamp, stamp);
  return { home, clone, projectDir, revisitFile, revisitOffset, tailFile, elsewhere, files };
}
