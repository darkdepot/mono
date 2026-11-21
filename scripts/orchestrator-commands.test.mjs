import { copyPluginFixture, writeWatcherFixture } from './plugin-fixture.mjs';
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { test } from "node:test";
import { extractSnapshot, references, section } from "./orchestrator/snapshot.mjs";
import { renderDispatch } from "./orchestrator/dispatch.mjs";
import { ideaDispatchFixture, ideaProjectId } from './fixtures/idea-dispatch.mjs';
import { applyPreapply, preapplyManifest } from "./orchestrator/preapply.mjs";
import { digest, readJson, atomicJson, withLock, canonical, REVIEW_PRODUCER } from "./runtime.mjs";
import { publishPhase } from "./delivery-state.mjs";
import { effectivePins, admitCollection, collectionPinsBinding, checkCollectionRequest, pinnedShipPolicy } from "./orchestrator/command-state.mjs";
import { acceptAck } from "./orchestrator/accept.mjs";
import { readLedger, recordResult, roundRequestName } from "./review-rounds.mjs";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = name => fs.readFileSync(path.join(checkout, "scripts/fixtures", name), "utf8");
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2)); };
const pass = result => { assert.equal(result.status, 0, result.stderr + result.stdout); return result.stdout.trim(); };
const issueFor = ids => `# Покрытие PRD/Spec\n${ids}\n`;

const fixtureProcessExists = pid => {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
};
const stopFixtureProcess = async pid => {
  if (!pid || !fixtureProcessExists(pid)) return;
  const signal = value => { try { process.kill(pid, value); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  signal("SIGTERM");
  let deadline = Date.now() + 5000;
  while (fixtureProcessExists(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  if (fixtureProcessExists(pid)) {
    signal("SIGKILL"); deadline = Date.now() + 5000;
    while (fixtureProcessExists(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(fixtureProcessExists(pid), false, `fixture pid ${pid} must no longer exist`);
};
const fixtureProcesses = () => {
  const pids = new Set(), registrations = new Map(), retired = new Set();
  const track = pid => { if (pid) pids.add(pid); return pid; };
  const registry = file => {
    if (fs.existsSync(file)) for (const worker of Object.values(readJson(file))) {
      const registration = JSON.stringify([file, worker.pid, worker.spawned_at, worker.last_resume?.registeredAt]);
      if (retired.has(registration)) continue;
      track(worker.pid);
      if (!registrations.has(worker.pid)) registrations.set(worker.pid, new Set());
      registrations.get(worker.pid).add(registration);
    }
  };
  const stop = async pid => {
    if (!pids.has(pid)) return;
    await stopFixtureProcess(pid);
    pids.delete(pid);
    for (const registration of registrations.get(pid) ?? []) retired.add(registration);
  };
  const cleanup = async () => {
    const results = await Promise.allSettled([...pids].map(stop));
    const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, "fixture process cleanup failed");
    assert.equal(pids.size, 0, "all tracked fixture processes have exited");
  };
  return { track, registry, stop, cleanup };
};

const fixtureReady = child => new Promise((resolve, reject) => {
  const finished = error => {
    child.off("message", ready); child.off("error", failed); child.off("close", closed);
    if (error) reject(error); else resolve();
  };
  const ready = () => finished();
  const failed = error => finished(error);
  const closed = () => finished(new Error("fixture child exited before readiness"));
  child.once("message", ready); child.once("error", failed); child.once("close", closed);
});

test("removed review-dataset flags are unknown to dispatch and accept; amend no longer exists", () => {
  const amend = spawnSync(process.execPath, [path.join(checkout, "scripts/orchestrator/accept.mjs"), "amend", "--root", os.tmpdir()], { encoding: "utf8" });
  assert.notEqual(amend.status, 0); assert.match(amend.stderr, /expected ack/);
  for (const [script, prefix] of [["dispatch", []], ["accept", ["ack"]]]) {
    for (const flag of ["--review-dataset", "--review-dataset-version"]) {
      const result = spawnSync(process.execPath, [path.join(checkout, "scripts/orchestrator", script + ".mjs"), ...prefix, "--root", os.tmpdir(), flag, "1"], { encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr + result.stdout, new RegExp("unknown.*" + flag.slice(2), "i"));
    }
  }
});

test("fixture cleanup waits for its own delayed child to exit", async () => {
  const child = spawn(process.execPath, ["-e", `
process.on("SIGTERM", () => setTimeout(() => process.exit(0), 200));
setInterval(() => {}, 1000);
process.send("ready");
`], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const exited = new Promise(resolve => child.once("close", resolve));
  try {
    await fixtureReady(child);
    await stopFixtureProcess(child.pid);
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" }, `fixture pid ${child.pid} must no longer exist`);
  } finally { child.kill("SIGKILL"); await exited; }
});

test("fixture readiness rejects a child that exits before ready", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(1)"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const exited = new Promise(resolve => child.once("close", resolve));
  try { await assert.rejects(fixtureReady(child), /exited before readiness/u); }
  finally { child.kill("SIGKILL"); await exited; }
});

test("launch pins are immutable: amended attempts and pins versions are refused", async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-immutable-pins-"));
  try {
    const file = path.join(scratch, 'pins.json'), idea = { path: '/saved/idea', projectId: ideaProjectId, digest: 'a'.repeat(64) };
    atomicJson(file, { packVersion: '0.32.0', idea });
    const entry = { pins: { file, digest: createHash('sha256').update(fs.readFileSync(file)).digest('hex') } };
    assert.deepEqual(effectivePins(entry).idea, idea);
    atomicJson(path.join(scratch, 'pins.v1.json'), { pinsVersion: 1, risk: 'risky' });
    assert.throws(() => effectivePins({ ...entry, pinsVersion: 1 }), /pins versions no longer exist; start a new attempt on the same branch/u,
      'an escalated risk is never silently read back as the launch risk');
    assert.deepEqual(collectionPinsBinding(entry), entry.pins);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("snapshot U12 named contracts", async t => {
  for (const name of fs.readdirSync(path.join(checkout, "scripts/fixtures")).filter(name => /^snapshot-u12-.*\.json$/u.test(name) && !name.endsWith("package-bytes.json"))) {
    await t.test(name, () => {
      const input = JSON.parse(fixture(name));
      const run = () => extractSnapshot(input.issue ?? issueFor(input.coverage), input.prd ?? "", input.spec ?? "");
      if (input.error) { assert.throws(run, error => error.message === input.error); return; }
      const result = run();
      assert.equal(result.full, input.full ?? false);
      if (input.ids) assert.deepEqual(result.ids, input.ids);
      if (input.note) assert.ok(result.note.includes(input.note));
      for (const text of input.includes ?? []) assert.ok(result.prd.includes(text), text);
      for (const text of input.specIncludes ?? []) assert.ok(result.spec.includes(text), text);
      for (const text of input.once ?? []) assert.equal(result.prd.split(text).length - 1, 1, text);
      for (const text of input.excludes ?? []) assert.ok(!result.prd.includes(text), text);
      if (input.full) { assert.equal(result.prd, input.prd); assert.equal(result.spec, input.spec ?? ""); }
    });
  }
});

test("snapshot-single-task-short-record: compressed U coverage retains decisions and preapply", () => {
  const input = JSON.parse(fixture("snapshot-single-task-short-record.json"));
  const result = extractSnapshot(input.issue, input.prd, input.spec);
  assert.equal(result.full, false);
  assert.deepEqual(result.ids, ["R1", "U1", "U2"]);
  assert.match(result.prd, /R1\. Источник виден/u);
  assert(!result.prd.includes("R2."));
  for (const decision of ["U1. Источник после имени", "U2. Настройка источника"]) assert(result.spec.includes(decision));
  assert(!result.spec.includes("U3."));
  assert.deepEqual(preapplyManifest(input.issue, input.prd, result.spec, false).entries, input.entries);
  assert.deepEqual(preapplyManifest(input.issue, input.prd, input.spec, false).entries, input.entries);
  const withoutConfig = issueFor("R1, U1");
  assert.equal(preapplyManifest(withoutConfig, input.prd, input.spec, false), null);
  assert(!extractSnapshot(withoutConfig, input.prd, input.spec).spec.includes("Предприменение"));
  assert.throws(() => preapplyManifest(input.issue, input.prd,
    result.spec.replace(input.entries[0].sha256, "0".repeat(64)), false), /sha256 mismatch/u);
});

test("snapshot U12 package extracts retain baseline bytes", () => {
  for (const expected of JSON.parse(fixture("snapshot-u12-package-bytes.json"))) {
    assert.deepEqual(extractSnapshot(issueFor(expected.coverage), fixture("cheap-waves-prd.md"), fixture("cheap-waves-spec.md")),
      { full: expected.full, note: expected.note, ids: expected.ids, prd: expected.prd, spec: expected.spec });
  }
});

test("snapshot grammar: template sections, exact IDs, source fixtures, closure and ambiguity", () => {
  const templateBody = text => /```markdown\n([\s\S]*?)```/u.exec(text)[1];
  const prd = templateBody(fixture("prd-template.md")).replace("## Требования", "## Требования\n\n- R1. Requirement.").replace("## Примеры приемки", "## Примеры приемки\n\n- AE1. Покрывает R1. Example.");
  const spec = templateBody(fixture("spec-template.md")).replace("## Единицы реализации", "## Единицы реализации\n\n### U1 (implementation; R1; I1)\nImplementation.");
  const templates = extractSnapshot(issueFor("AE1, U1"), prd, spec);
  assert.deepEqual(new Set(templates.ids), new Set(["AE1", "U1", "R1"]));
  assert.match(templates.prd, /## Допущения/u); assert.match(templates.spec, /## Архитектура/u);
  const measured = extractSnapshot(issueFor("R8–R9, U5′, U1"), fixture("mono-92-prd.md"), fixture("mono-92-spec.md"));
  assert.equal(measured.full, false); assert.ok(measured.ids.includes("R3"), "inline coverage reaches R3");
  assert.match(measured.prd, /\* R8 /u); assert.match(measured.spec, /\* U5′ /u);
  const noOptional = fixture("mono-92-spec.md").replace(/## Что может сломаться и как защищаемся\n[\s\S]*?(?=\n## )/u, "");
  assert.doesNotThrow(() => extractSnapshot(issueFor("U1"), fixture("mono-92-prd.md"), noOptional), "absent optional section is skipped");
  const cheap = extractSnapshot(issueFor("AE3а, U5, U6"), fixture("cheap-waves-prd.md"), fixture("cheap-waves-spec.md"));
  assert.equal(cheap.full, false); assert.ok(cheap.ids.includes("R1")); assert.match(cheap.prd, /AE3а/u);
  const cheapInline = fixture("cheap-waves-spec.md").replace("- U6 (команды, адаптер, сеансы)", "- U6 (команды, адаптер, сеансы; R1, R3; I2)");
  assert.ok(extractSnapshot(issueFor("U6"), fixture("cheap-waves-prd.md"), cheapInline).ids.includes("R3"), "package inline coverage fixture reaches its additional requirement");
  assert.deepEqual(references("R8-R9, AE3а, U5′, U5'"), ["R8", "R9", "AE3а", "U5′", "U5'"]);
  assert.throws(() => extractSnapshot(issueFor("R99"), prd, spec), /unknown.*R99/u);
  assert.throws(() => extractSnapshot(issueFor("AE1"), prd.replace("Покрывает R1", "Покрывает R99"), spec), /unknown.*R99/u);
  const duplicate = extractSnapshot(issueFor("R1"), prd + "\n- R1. Duplicate.\n", spec);
  assert.equal(duplicate.full, true); assert.equal(duplicate.prd, prd + "\n- R1. Duplicate.\n"); assert.match(duplicate.note, /Duplicate/u);
  assert.throws(() => extractSnapshot(issueFor("R99"), duplicate.prd, spec), /unknown/u);
  const cycle = extractSnapshot(issueFor("R1"), "## Кратко\nBrief\n- R1. Покрывает R2. One\n- R2. Покрывает R1. Two", "## Кратко\nSpec\n");
  assert.deepEqual(cycle.ids, ["R1", "R2"]);
  const fenced = "## Кратко\nBrief\n```\n- R1. Not a definition\n```\n- R1. Real definition\n  details\n- R2. Other\n";
  assert.equal(extractSnapshot(issueFor("R1"), fenced, spec).full, false);
  for (const marker of ["`", "~"]) {
    const nestedFence = ["### R1. Requirement", "Before example.", `${marker.repeat(4)}markdown`,
      marker.repeat(3), "### R99. Example heading", "- R98. Example list item", marker.repeat(3),
      `${marker.repeat(4)} still-example`, "### R97. Example after an invalid closing fence",
      marker.repeat(5), "After example.", "### R2. Next requirement", "Unselected content."].join("\n");
    const extracted = extractSnapshot(issueFor("R1"), nestedFence, spec);
    assert.match(extracted.prd, /After example\./u, "shorter or info-bearing delimiters cannot close the outer fence");
    assert.ok(!extracted.prd.includes("Unselected content"));
    for (const id of ["R99", "R98", "R97"]) assert.throws(() => extractSnapshot(issueFor(id), nestedFence, spec), /unknown/u);
  }
  const headingBoundary = "## Требования\n### R1 Requirement\nSelected content.\n#### Details\nSeparate section. Покрывает R99.\n";
  const headingExtract = extractSnapshot(issueFor("R1"), headingBoundary, spec);
  assert.match(headingExtract.prd, /Selected content/u); assert.ok(!headingExtract.prd.includes("Separate section"), "contract ends at the next heading regardless of its level");
  for (const marker of ["#", "####", "#####", "######"]) {
    assert.throws(() => extractSnapshot(issueFor("R1"), `${marker} R1. Internal note\nNo contracted definition.\n`, spec), /unknown.*R1/u);
  }
  assert.match(extractSnapshot(issueFor("R1"), "## R1. Requirement\nContent\n", spec).prd, /Content/u);
  assert.throws(() => renderDispatch("{{missing}}", {}), /unfilled/u);
});

test("extract-stops-at-any-peer-definition: unrelated coverage stays outside a selected definition", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-peer-definition-"));
  try {
    for (const next of ["AE1", "U1", "I1", "A1", "F1", "R2"]) {
      const file = path.join(scratch, "prd.md");
      write(file, `## Требования\n- R1. Selected requirement.\n  Selected detail.\n* ${next}. Unselected neighbour. Покрывает R99.\n  Other detail.\n`);
      const extracted = extractSnapshot(issueFor("R1"), fs.readFileSync(file, "utf8"), "");
      assert.deepEqual(extracted.ids, ["R1"]);
      assert.match(extracted.prd, /Selected detail/u);
      assert.ok(!extracted.prd.includes("Unselected neighbour"), next);
      assert.throws(() => extractSnapshot(issueFor("R99"), fs.readFileSync(file, "utf8"), ""), /unknown.*R99/u);
    }
    const nested = extractSnapshot(issueFor("R1"), "- R1. Parent.\n  - AE1. Nested detail.\n- U1. Peer. Покрывает R99.\n", "");
    assert.match(nested.prd, /Nested detail/u, "a nested list definition is not a peer boundary");
    assert.ok(!nested.prd.includes("Peer."));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("extract-stops-on-list-outdent: a nested selection cannot copy an outer neighbour", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-outdent-definition-"));
  try {
    for (const next of ["R2", "AE1", "U1", "I1", "A1", "F1"]) {
      for (const indent of ["", "  "]) {
        const file = path.join(scratch, "prd.md");
        write(file, `## Требования\n    - R1. Selected nested definition.\n      Selected detail.\n${indent}- ${next}. Outer neighbour. Покрывает R99.\n`);
        const extracted = extractSnapshot(issueFor("R1"), fs.readFileSync(file, "utf8"), "");
        assert.deepEqual(extracted.ids, ["R1"]);
        assert.match(extracted.prd, /Selected detail/u);
        assert.ok(!extracted.prd.includes("Outer neighbour"), next);
        assert.throws(() => extractSnapshot(issueFor("R99"), fs.readFileSync(file, "utf8"), ""), /unknown.*R99/u);
      }
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("extract-mixed-indent-columns: retain deeper detail and stop at equal or shallower columns", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-tab-definition-"));
  try {
    for (const [parent, child, next] of [["  ", "\t", ""], ["\t", "\t\t", "  "], [" \t", "\t  ", "   "], ["\t", "\t  ", "    "]]) {
      const file = path.join(scratch, "prd.md");
      write(file, `## Требования\n- A1. Outer context.\n${parent}- R1. Selected requirement.\n${child}- AE1. Retained nested detail.\n${next}- U1. Unselected neighbour. Покрывает R99.\n`);
      const extracted = extractSnapshot(issueFor("R1"), fs.readFileSync(file, "utf8"), "");
      assert.deepEqual(extracted.ids, ["R1"]);
      assert.match(extracted.prd, /Retained nested detail/u);
      assert.ok(!extracted.prd.includes("Unselected neighbour"));
      assert.throws(() => extractSnapshot(issueFor("R99"), fs.readFileSync(file, "utf8"), ""), /unknown.*R99/u);
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("extract-indented-heading-boundaries: valid indentation retains definitions and common sections", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-heading-indent-"));
  try {
    for (const indent of [" ", "  ", "   "]) {
      for (const level of [1, 2, 3, 4, 5, 6]) {
        const file = path.join(scratch, "prd.md");
        write(file, `${indent}## Кратко\nRequired common context.\n## Требования\n${indent}### R1 Requirement\nSelected content.\n${indent}${"#".repeat(level)} Details\nUnselected content. Покрывает R99.\n`);
        const extracted = extractSnapshot(issueFor("R1"), fs.readFileSync(file, "utf8"), "");
        assert.deepEqual(extracted.ids, ["R1"]);
        assert.match(extracted.prd, /Required common context/u);
        assert.match(extracted.prd, /Selected content/u);
        assert.ok(!extracted.prd.includes("Unselected content"));
        assert.throws(() => extractSnapshot(issueFor("R99"), fs.readFileSync(file, "utf8"), ""), /unknown.*R99/u);
      }
    }
    const code = "## Требования\n### R1 Requirement\nSelected content.\n\n    ### R2 Code example\n";
    assert.match(extractSnapshot(issueFor("R1"), code, "").prd, /R2 Code example/u);
    assert.throws(() => extractSnapshot(issueFor("R2"), code, ""), /unknown.*R2/u);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("extract-fence-indent: indented delimiter text cannot close or open a top-level fence", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-fence-indent-"));
  try {
    for (const character of ["`", "~"]) {
      for (const indent of ["    ", "\t", "  \t"]) {
        const fence = character.repeat(3), file = path.join(scratch, "prd.md");
        write(file, `## Требования\n### R1 Requirement\n${fence}markdown\n${indent}${fence}\n### R99 Example\n${fence}\nAfter example.\n### R2 Requirement\nSecond selected detail.\n`);
        const source = fs.readFileSync(file, "utf8");
        assert.match(extractSnapshot(issueFor("R1"), source, "").prd, /After example/u);
        assert.match(extractSnapshot(issueFor("R2"), source, "").prd, /Second selected detail/u);
        assert.throws(() => extractSnapshot(issueFor("R99"), source, ""), /unknown.*R99/u);
        assert.match(extractSnapshot(issueFor("R2"), `## Требования\n${indent}${fence}\n### R2 Requirement\n`, "").prd, /R2 Requirement/u);
      }
      for (const indent of ["", " ", "  ", "   "]) {
        const fence = character.repeat(3);
        assert.match(extractSnapshot(issueFor("R2"), `## Требования\n${indent}${fence}\n### R99 Example\n${indent}${fence}\n### R2 Requirement\n`, "").prd, /R2 Requirement/u);
      }
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("extract-empty-and-closed-headings: section titles normalize while every heading ends a definition", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-empty-heading-"));
  try {
    for (const ending of ["", " ##", "\t###  "]) {
      for (const empty of ["#", "##", "### ###", "   ####\t### \t"]) {
        const file = path.join(scratch, "prd.md");
        write(file, `## Кратко${ending}\nRequired common context.\n## Требования\n### R1 Requirement${ending}\nSelected detail.\n${empty}\nUnselected coverage. Покрывает R99.\n`);
        const extracted = extractSnapshot(issueFor("R1"), fs.readFileSync(file, "utf8"), "");
        assert.match(extracted.prd, /Required common context/u);
        assert.match(extracted.prd, /Selected detail/u);
        assert.ok(!extracted.prd.includes("Unselected coverage"));
        assert.throws(() => extractSnapshot(issueFor("R99"), fs.readFileSync(file, "utf8"), ""), /unknown.*R99/u);
      }
    }
    assert.match(extractSnapshot(issueFor("R1"), "## Требования\n### R1 Requirement\n#hashtag\n####### Too many\nRetained detail.\n", "").prd, /Retained detail/u);
    assert.equal(section("## Literal#\nRetained text.\n", "Literal#"), "## Literal#\nRetained text.");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("dispatch-placeholder-scope: inserted Issue fields stay literal and template holes refuse", () => {
  assert.equal(renderDispatch("Issue: {{issue_body}}", { issue_body: "Use {{field_name}} and {{}} literally." }),
    "Issue: Use {{field_name}} and {{}} literally.");
  for (const template of ["{{missing}}", "{{}}", "{{issue_body}} {{missing}}"])
    assert.throws(() => renderDispatch(template, { issue_body: "Issue text" }), /unfilled dispatch placeholder/u);
  assert.throws(() => renderDispatch("{{issue_body}}", { issue_body: "" }), /unfilled dispatch placeholder/u);
});

test("accept-rejected-incomplete-ack: rejection consumes without allowing applied or blocked", async t => {
  for (const ackGates of [[], [{ gate: "identity", status: "pass", evidence: "checked" }]])
    await t.test(`${ackGates.length} of 2 gates`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-reject-ack-")), issue = "MONO-999";
      const ackFile = path.join(root, "reports", `${issue}-gate-ack-a1.json`);
      const recordFile = path.join(root, "consumed", `${issue}-gate-ack-a1.json`);
      const ack = { issue, phase: "gate", status: "gates-passed", gates: ackGates };
      const entry = { issue, stage: "mono-deliver", attempt: 1, packVersion: "0.42.0", surfaceRevision: 5,
        worktree: path.join(root, "worktree"), log: path.join(root, `${issue}-mono-deliver-a1.jsonl`),
        gates: ["identity", "context"], lifecycle_moves: [] };
      const args = { root, issue, attempt: "1" };
      try {
        atomicJson(path.join(root, "workers.json"), { [issue]: entry }); atomicJson(ackFile, ack);
        for (const outcome of [undefined, "applied", "blocked"]) {
          await assert.rejects(acceptAck({ ...args, ...(outcome ? { outcome } : {}) }, () => {}), /ack/u);
          assert.deepEqual(readJson(ackFile), ack);
          assert.equal(fs.existsSync(recordFile), false);
          assert.deepEqual(readJson(path.join(root, "workers.json"))[issue].gates, entry.gates);
        }
        const result = spawnSync(process.execPath, [path.join(checkout, "scripts/orchestrator/accept.mjs"),
          "ack", "--root", root, "--issue", issue, "--attempt", "1", "--outcome", "rejected"], { encoding: "utf8" });
        pass(result);
        assert.deepEqual(readJson(recordFile), { issue, attempt: 1, outcome: "rejected", gates: entry.gates, ack, ackDigest: digest(ack), readback: [] });
        assert.equal(fs.existsSync(ackFile), false);
        assert.deepEqual(readJson(ackFile.replace(".json", ".rejected.json")), ack);
        assert.equal(readJson(path.join(root, "workers.json"))[issue].gates, undefined);
        await acceptAck({ ...args, outcome: "rejected" }, () => {});
        assert.equal(readJson(recordFile).outcome, "rejected", "recovery is idempotent");
        await assert.rejects(acceptAck({ ...args, outcome: "applied" }, () => {}), /ack/u);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});

test("installed command workflow on scratch: refusals, dispatch, ack, sessions, round admission and task change", async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-command-fixture-"));
  const skills = path.join(scratch, "skills"), root = path.join(scratch, "orchestrator"), repo = path.join(scratch, "repo"), bin = path.join(scratch, "bin"), temp = path.join(scratch, "worker-temp");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, };
  const processes = fixtureProcesses();
  const run = (cmd, args, cwd = checkout) => {
    const result = spawnSync(cmd, args, { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    processes.registry(path.join(root, "workers.json"));
    processes.registry(path.join(scratch, "lane-orchestrator/workers.json"));
    return result;
  };
  const git = (...args) => pass(run("git", args, repo));
  let livePid;
  try {
    for (const directory of [repo, bin, temp, path.join(root, "reports")]) fs.mkdirSync(directory, { recursive: true });
    copyPluginFixture(skills);
    const runtime = path.join(skills, "scripts");
    for (const script of ["dispatch", "accept", "collector"]) pass(run(process.execPath, [path.join(runtime, `orchestrator/${script}.mjs`), "--help"]));
    const budget = JSON.parse(pass(run(process.execPath, [path.join(runtime, "read-budget.mjs"), "--json"])));
    // Approved deltas: Research +383 (MONO-177), Discovery +815 (MONO-184), Handoff +210 (MONO-213).
    // Keep the original 11-byte fixture margin; the pack ceiling stays 99_882.
    assert.ok(budget.bytes <= 98_373 + 383 + 815 + 210, "worker corpus exceeds the baseline plus approved stage deltas");
    write(path.join(bin, "codex"), '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"fixture-thread"}));setInterval(()=>{},1000);\n'); fs.chmodSync(path.join(bin, "codex"), 0o700);
    // The collector started with the attempt reads its own process group from the table.
    write(path.join(bin, "ps"), "#!/usr/bin/env node\nconsole.log(process.argv.includes('-axo')?process.ppid+' 1 '+process.ppid+' S fixture-start':'fixture-start');\n"); fs.chmodSync(path.join(bin, "ps"), 0o700);
    atomicJson(path.join(root, "control.json"), { state: "active", halt: false }); atomicJson(path.join(root, "workers.json"), {}); writeWatcherFixture(root, env);
    git("init", "-b", "main");
    const origin = path.join(scratch, "origin.git"); pass(run("git", ["init", "--bare", origin])); git("remote", "add", "origin", origin);
    const config = path.join(repo, ".agents/mono-workflow.config.json");
    write(config, { projectName: "Fixture", ideaGate: { since: '2026-10-17' }, researchGate: { since: '2026-10-19' }, orchestration: { transport: "codex-cli", dispatch: { product: "fixture", evidenceRoot: path.join(scratch, "evidence"), openDecisions: 0,
      verification: { command: "node", args: ["scripts/verify.mjs"] }, lifecycle_moves: [{ entity: "issue", key: "MONO-999", from: "Backlog", to: "In Progress" }] } } });
    write(path.join(repo, ".gitignore"), ".worktrees/\n.orchestrator/\n"); git("add", "."); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"); git("push", "origin", "main");
    const snapshot = path.join(scratch, "snapshot"), writable = path.join(scratch, "writable.json"); write(writable, [temp]);
    const body = "# MONO-999 — fixture\n# Что сделать\nImplement commands. Keep {{field_name}} literal.\n# Готовность агента\nAFK\n# Покрытие PRD/Spec\nR4, U5\n# Как проверить\n1. node scripts/verify.mjs\n# Ключевые контракты\nNo direct writes.\n# Что не входит\nDeploy.\nРиск: standard\n";
    write(path.join(snapshot, "issue-MONO-999.md"), body); write(path.join(snapshot, "approval.md"), "Approved package and start; current project Delivery.");
    write(path.join(snapshot, "project-brief.md"), "# Fixture\nBrief\n"); write(path.join(snapshot, "prd.md"), fixture("cheap-waves-prd.md")); write(path.join(snapshot, "tech-spec.md"), fixture("cheap-waves-spec.md"));
    const command = path.join(runtime, "orchestrator/dispatch.mjs"), options = ["--issue", "MONO-999", "--root", root, "--config", config, "--snapshot", snapshot, "--handshake", "wait", "--worker-writable-roots", writable];
    await t.test('idea dispatch refuses missing records before registering attempts', () => {
      ideaDispatchFixture(snapshot, 'MONO-999', input => { input.records.comments = input.records.comments.filter(c => c.id !== 'idea-1'); });
      const result = run(process.execPath, [command, ...options]);
      assert.notEqual(result.status, 0, 'a project without an approved idea cannot launch');
      assert.match(result.stderr, new RegExp(`no-record project=${ideaProjectId}`));
      assert.equal(fs.existsSync(path.join(root, 'attempts.json')), false);
      assert.deepEqual(readJson(path.join(root, 'workers.json')), {});
    });
    ideaDispatchFixture(snapshot);
    // A pre-spawn start-gate refusal leaves no attempt registration.
    const worktree = path.join(repo, ".worktrees/MONO-999"); git("worktree", "add", "-b", "mono/mono-999", worktree, "origin/main"); write(path.join(worktree, "dirty"), "dirty");
    await t.test('research dispatch refuses before attempt registration and copies the referenced document', () => {
      const configured = readJson(config);
      write(config, { ...configured, researchGate: { since: '2026-10-17' } });
      const document = { id: 'research-1', url: 'https://linear.app/document/research-1', title: 'Исследование', projectId: ideaProjectId };
      const prepare = (reference = true) => ideaDispatchFixture(snapshot, 'MONO-999', i => {
        i.approval.createdAt = '2026-10-17T00:00:00Z';
        if (reference) i.body += `\n${document.url}`;
      });
      const refuse = code => {
        const result = run(process.execPath, [command, ...options]);
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes(`research-gate: fail: ${code} project=${ideaProjectId}`), result.stderr);
        assert.equal(fs.existsSync(path.join(root, 'attempts.json')), false);
        assert.deepEqual(readJson(path.join(root, 'workers.json')), {});
      };
      prepare(); refuse('research-missing');
      write(path.join(snapshot, 'research/document.json'), document);
      const record = { project: ideaProjectId, outcome: 'ready', reason: '', interface: false };
      const content = '```mono-research\n' + JSON.stringify(record) + '\n```';
      write(path.join(snapshot, 'research/document.md'), content);
      prepare(false); refuse('research-not-referenced');
      prepare(); write(path.join(snapshot, 'research/document.md'), 'No fence'); refuse('research-bad-record');
      write(path.join(snapshot, 'research/document.md'), content);
      write(path.join(snapshot, 'issue-only.json'), { marker: 'planted', label: 'issue-only', fingerprint: 'fake',
        config: 'fake', ownerApproval: 'fake', seam: { package_kind: 'issue-only', lifecycle_state_entity: 'issue', approval_status: 'approved-fresh' } });
      refuse('research-other-project'); fs.unlinkSync(path.join(snapshot, 'issue-only.json'));
      const result = run(process.execPath, [command, ...options]);
      assert.match(result.stderr, /dirty/u, 'valid research reaches start gate');
      const saved = path.join(root, 'dispatch/MONO-999-a1/snapshot/research');
      assert.deepEqual(readJson(path.join(saved, 'document.json')), document);
      assert.equal(fs.readFileSync(path.join(saved, 'document.md'), 'utf8'), content);
      assert.equal(fs.existsSync(path.join(root, 'attempts.json')), false);
      fs.rmSync(path.join(snapshot, 'research'), { recursive: true }); ideaDispatchFixture(snapshot);
      write(config, configured);
    });
    await t.test('Research release default checks the UTC boundary before registering attempts', () => {
      const configured = readJson(config), defaults = { ...configured };
      delete defaults.researchGate; write(config, defaults);
      const document = { id: 'research-release', url: 'https://linear.app/document/research-release', title: 'Исследование', projectId: ideaProjectId };
      const prepare = createdAt => ideaDispatchFixture(snapshot, 'MONO-999', i => {
        i.approval.createdAt = createdAt; i.body += `\n${document.url}`;
      });
      try {
        prepare('2026-10-18T23:59:59.999Z');
        assert.match(run(process.execPath, [command, ...options]).stderr, /dirty/u, 'earlier approval reaches start gate without research/');
        for (const createdAt of ['2026-10-19T00:00:00Z', '2026-10-19T12:00:00Z']) {
          prepare(createdAt);
          assert.match(run(process.execPath, [command, ...options]).stderr, /research-gate: fail: research-missing/u);
          assert.equal(fs.existsSync(path.join(root, 'attempts.json')), false);
          assert.deepEqual(readJson(path.join(root, 'workers.json')), {});
        }
        write(path.join(snapshot, 'research/document.json'), document);
        for (const outcome of ['ready', 'not-required']) {
          const content = '```mono-research\n' + JSON.stringify({ project: ideaProjectId, outcome, reason: 'Обратимая правка текста', interface: false }) + '\n```';
          write(path.join(snapshot, 'research/document.md'), content);
          assert.match(run(process.execPath, [command, ...options]).stderr, /dirty/u, `${outcome} reaches start gate`);
          assert.equal(fs.readFileSync(path.join(root, 'dispatch/MONO-999-a1/snapshot/research/document.md'), 'utf8'), content);
        }
      } finally {
        fs.rmSync(path.join(snapshot, 'research'), { recursive: true, force: true });
        ideaDispatchFixture(snapshot); write(config, configured);
      }
    });
    await t.test('release default refuses missing records after cutoff, accepts records and preserves earlier approvals', () => {
      const configured = readJson(config);
      const defaults = { ...configured }; delete defaults.ideaGate;
      write(config, defaults);
      try {
        ideaDispatchFixture(snapshot, 'MONO-999', i => {
          i.project.createdAt = '2026-10-18T00:00:00Z';
          i.approval.createdAt = '2026-10-18T00:00:00Z';
          i.records.comments = i.records.comments.filter(c => c.id !== 'idea-1');
        });
        assert.match(run(process.execPath, [command, ...options]).stderr, /no-record project=/u);
        ideaDispatchFixture(snapshot, 'MONO-999', i => {
          i.project.createdAt = '2026-10-18T00:00:00Z';
          i.approval.createdAt = '2026-10-18T00:00:00Z';
        });
        assert.match(run(process.execPath, [command, ...options]).stderr, /dirty/u, 'matching record reaches start gate');
        ideaDispatchFixture(snapshot, 'MONO-999', i => {
          i.project.createdAt = '2026-10-17T00:00:00Z';
          i.approval.createdAt = '2026-10-17T23:59:59Z';
          i.records.comments = i.records.comments.filter(c => c.id !== 'idea-1');
        });
        const legacy = run(process.execPath, [command, ...options]);
        assert.match(legacy.stderr, /legacy-before-cutoff/u);
        assert.match(legacy.stderr, /dirty/u, 'pre-cutoff package reaches start gate');
        assert.equal(fs.existsSync(path.join(root, 'attempts.json')), false);
        assert.deepEqual(readJson(path.join(root, 'workers.json')), {});
      } finally { write(config, configured); ideaDispatchFixture(snapshot); }
    });
    await t.test('idea dispatch refuses foreign, incomplete and unapproved package snapshots', async t => {
      const other = '11111111-1111-1111-1111-111111111111';
      for (const [name, change, code] of [
        ['foreign-record', i => { i.records.comments[0].body = i.records.comments[0].body.replaceAll(ideaProjectId, other); }, 'other-project'],
        ['complete-foreign-project', i => { i.project.id = other; i.records.comments[0].body = i.records.comments[0].body.replaceAll(ideaProjectId, other); }, 'other-project'],
        ['wrong-issue', i => { i.context.issueKey = 'MONO-998'; }, 'read-failed'],
        ['pending', i => { i.body = 'approval_status=pending'; }, 'read-failed'],
        ['rejected', i => { i.body = 'approval_status=rejected'; }, 'read-failed'],
        ['two-approved', i => { i.body = 'approval_status=approved\napproval_status=approved'; }, 'read-failed'],
        ['approved-and-pending', i => { i.body = 'approval_status=approved\napproval_status=pending'; }, 'read-failed'],
        ['new-unmarked', i => { i.body = 'Approved'; i.approval.createdAt = '2026-10-17T00:00:00Z'; }, 'read-failed'],
        ['old-foreign-approval', i => { i.project.createdAt = '2026-10-01T00:00:00Z'; i.approval.commentId = 'foreign-approval'; }, 'other-project'],
        ['incomplete-comments', i => { i.records.complete = false; }, 'read-failed'],
      ]) await t.test(name, () => {
        ideaDispatchFixture(snapshot, 'MONO-999', change);
        const response = run(process.execPath, [command, ...options]);
        assert.notEqual(response.status, 0); assert.match(response.stderr, new RegExp(`${code} project=`));
        assert.equal(fs.existsSync(path.join(root, 'attempts.json')), false); assert.deepEqual(readJson(path.join(root, 'workers.json')), {});
      });
      for (const name of ['approval.json', 'issue-context.json', 'idea/project.json', 'idea/idea-records.json']) {
        ideaDispatchFixture(snapshot); fs.unlinkSync(path.join(snapshot, name));
        assert.match(run(process.execPath, [command, ...options]).stderr, /read-failed project=/u);
      }
      ideaDispatchFixture(snapshot); write(path.join(snapshot, 'approval.json'), { ...readJson(path.join(snapshot, 'approval.json')), bodySha256: '0'.repeat(64) });
      assert.match(run(process.execPath, [command, ...options]).stderr, /read-failed project=/u);
      ideaDispatchFixture(snapshot, 'MONO-999', i => { i.project.createdAt = '2026-10-01T00:00:00Z'; i.records.comments = i.records.comments.filter(c => c.id !== 'idea-1'); i.body = 'Approved legacy package'; });
      const legacy = run(process.execPath, [command, ...options]);
      assert.match(legacy.stderr, /legacy-before-cutoff/u); assert.match(legacy.stderr, /dirty/u);
      assert.equal(fs.existsSync(path.join(root, 'attempts.json')), false);
      // Old research can enter handoff without a record, but dispatch cannot.
      const { checkIdea } = await import('./idea-gate.mjs');
      const old = ideaDispatchFixture(snapshot, 'MONO-999', i => { i.project.createdAt = '2026-10-01T00:00:00Z'; i.records.comments = i.records.comments.filter(c => c.id !== 'idea-1'); i.approval.createdAt = '2026-10-18T00:00:00Z'; });
      assert.equal(checkIdea({ mode: 'fresh', project: old.project, records: old.records, since: '2026-10-17' }).code, 'legacy-migrate');
      assert.match(run(process.execPath, [command, ...options]).stderr, /no-record project=/u);
      ideaDispatchFixture(snapshot, 'MONO-999', i => { i.project.createdAt = old.project.createdAt; i.approval.createdAt = old.approval.createdAt; });
      assert.match(run(process.execPath, [command, ...options]).stderr, /dirty/u, 'package with a record now reaches start gate');
      ideaDispatchFixture(snapshot);
    });
    const refused = run(process.execPath, [command, ...options, "--profile", "full"]); assert.notEqual(refused.status, 0); assert.match(refused.stderr, /dirty/u);
    assert.equal(fs.existsSync(path.join(root, "attempts.json")), false); assert.deepEqual(readJson(path.join(root, "workers.json")), {});
    await t.test("dispatch-refused-snapshot-rebuild: each retry contains only its current composition", async () => {
      const preparedSnapshot = path.join(root, "dispatch/MONO-999-a1/snapshot");
      const names = () => fs.readdirSync(preparedSnapshot).sort();
      assert.deepEqual(names(), ["approval.json", "approval.md", "idea", "issue-MONO-999.md", "issue-context.json", "prd.md", "project-brief.md", "tech-spec.md"]);
      const retry = (source, profile) => {
        const current = [...options]; current[current.indexOf("--snapshot") + 1] = source;
        const result = run(process.execPath, [command, ...current, "--profile", profile]);
        assert.notEqual(result.status, 0); assert.match(result.stderr, /dirty/u);
        assert.equal(fs.existsSync(path.join(root, "attempts.json")), false); assert.deepEqual(readJson(path.join(root, "workers.json")), {});
      };
      retry(preparedSnapshot, "short"); // A full generated snapshot may itself be the next input.
      assert.deepEqual(names(), ["approval.json", "approval.md", "idea", "issue-MONO-999.md", "issue-context.json", "prd-extract.md", "project-brief.md", "spec-extract.md"]);
      retry(snapshot, "full");
      assert.deepEqual(names(), ["approval.json", "approval.md", "idea", "issue-MONO-999.md", "issue-context.json", "prd.md", "project-brief.md", "tech-spec.md"]);
      ideaDispatchFixture(snapshot, 'MONO-999', input => {
        input.context.blockedBy = ['MONO-998'];
        input.body += '\nmono-package: start issues=T1:MONO-998,T2:MONO-999';
      });
      const merged = git('rev-parse', 'origin/main');
      write(path.join(snapshot, 'predecessors/MONO-998/code-report.md'), 'Предшественница: команды работают.');
      write(path.join(snapshot, 'predecessors/MONO-998/merge.json'), { issue: 'MONO-998', mergeCommit: merged });
      retry(snapshot, 'full');
      assert.equal(readJson(path.join(preparedSnapshot, 'chain.json')).predecessors[0].mergeCommit, merged);
      assert.match(fs.readFileSync(path.join(root, 'dispatch/MONO-999-a1/dispatch.md'), 'utf8'), /Предшественница: команды работают/);
      assert.equal(fs.readFileSync(path.join(preparedSnapshot, 'predecessors/MONO-998/code-report.md'), 'utf8'), 'Предшественница: команды работают.');
      ideaDispatchFixture(snapshot);
      retry(snapshot, 'full');
      assert.equal(fs.existsSync(path.join(preparedSnapshot, 'chain.json')), false, 'stray source reports do not create a chain');
      assert.equal(fs.existsSync(path.join(preparedSnapshot, 'predecessors')), false);
      const laneSource = path.join(scratch, "refused-lane-snapshot");
      write(path.join(laneSource, "issue-MONO-999.md"), body); write(path.join(laneSource, "approval.md"), "Approved lane fixture.");
      write(path.join(laneSource, "issue-only.json"), { marker: "fixture marker", label: "issue-only", fingerprint: createHash("sha256").update(body).digest("hex"),
        config: "enabled=true; ownerPrincipal=fixture", ownerApproval: "approved fixture fingerprint",
        seam: { package_kind: "issue-only", lifecycle_state_entity: "issue", behavioral_oracle: "fixture oracle", risk_class: "standard", approval_status: "approved-fresh" } });
      retry(laneSource, "short"); assert.deepEqual(names(), ["approval.md", "idea", "issue-MONO-999.md", "issue-only.json"]);
      retry(snapshot, "short");
      assert.deepEqual(names(), ["approval.json", "approval.md", "idea", "issue-MONO-999.md", "issue-context.json", "prd-extract.md", "project-brief.md", "spec-extract.md"]);
    });
    await t.test("dispatch-afk-leading-token: only leading AFK selects the short profile", async t => {
      try {
        for (const [readiness, afk] of [
          ["HITL (нужно твоё участие: проверка, после неё задача станет AFK)", false],
          ["Not AFK", false], ["AFK (агент справится без тебя)", true]
        ]) await t.test(readiness, () => {
          write(path.join(snapshot, "issue-MONO-999.md"), body.replace("\nAFK\n", `\n${readiness}\n`));
          const response = run(process.execPath, [command, ...options]);
          assert.match(response.stderr, /dirty/u, "the scratch start gate refuses code entry");
          const prepared = readJson(path.join(root, "dispatch/MONO-999-a1/pins.json"));
          assert.equal(prepared.afk, afk);
          assert.equal(prepared.profile, afk ? "short" : "full");
          if (!afk) assert.match(run(process.execPath, [command, ...options, "--profile", "short"]).stderr, /short requires/u);
        });
      } finally { write(path.join(snapshot, "issue-MONO-999.md"), body); }
    });
    fs.unlinkSync(path.join(worktree, "dirty"));
    write(path.join(snapshot, "issue-MONO-999.md"), body.replace("R4, U5", "R99"));
    assert.match(run(process.execPath, [command, ...options]).stderr, /unknown.*R99/u); assert.equal(fs.existsSync(path.join(root, "attempts.json")), false);
    write(path.join(snapshot, "issue-MONO-999.md"), body);
    const laneRoot = path.join(scratch, "lane-orchestrator"), laneSnapshot = path.join(scratch, "lane-snapshot");
    fs.mkdirSync(path.join(laneRoot, "reports"), { recursive: true });
    writeWatcherFixture(laneRoot, env); atomicJson(path.join(laneRoot, "control.json"), { state: "active", halt: false }); atomicJson(path.join(laneRoot, "workers.json"), {});
    const laneBody = body.replaceAll("MONO-999", "MONO-998"), fingerprint = createHash("sha256").update(laneBody).digest("hex");
    write(path.join(laneSnapshot, "issue-MONO-998.md"), laneBody); write(path.join(laneSnapshot, "approval.md"), "Approved issue-only fixture.");
    const lane = { marker: "fixture marker", label: "issue-only", fingerprint, config: "enabled=true; ownerPrincipal=fixture", ownerApproval: "approved fixture fingerprint",
      seam: { package_kind: "issue-only", lifecycle_state_entity: "issue", behavioral_oracle: "fixture oracle", risk_class: "standard", approval_status: "approved-fresh" } };
    const laneMoves = path.join(scratch, "lane-moves.json"); write(laneMoves, []);
    const laneOptions = ["--issue", "MONO-998", "--root", laneRoot, "--config", config, "--snapshot", laneSnapshot, "--moves", laneMoves, "--worker-writable-roots", writable];
    for (const invalid of [undefined, null, "", "   ", 123]) {
      write(path.join(laneSnapshot, "issue-only.json"), { ...lane, fingerprint: invalid });
      const response = run(process.execPath, [command, ...laneOptions]);
      if (response.status === 0) livePid = JSON.parse(response.stdout).pid;
      assert.notEqual(response.status, 0, "issue-only fingerprint is required before spawn");
      assert.match(response.stderr, /issue-only/u);
      assert.equal(fs.existsSync(path.join(laneRoot, "attempts.json")), false); assert.deepEqual(readJson(path.join(laneRoot, "workers.json")), {});
      assert.equal(fs.existsSync(path.join(repo, ".worktrees/MONO-998")), false, "incomplete lane refuses before worktree preparation");
    }
    write(path.join(laneSnapshot, "issue-only.json"), lane);
    // AC4 config compatibility: obsolete defaults are ignored even when unreadable.
    const laneConfigFile = laneOptions[laneOptions.indexOf("--config") + 1], laneConfig = readJson(laneConfigFile);
    laneConfig.orchestration.dispatch = { ...laneConfig.orchestration.dispatch, reviewDataset: "/missing/retired.md", reviewDatasetVersion: 7 };
    atomicJson(laneConfigFile, laneConfig);
    const laneLaunch = JSON.parse(pass(run(process.execPath, [command, ...laneOptions]))); livePid = processes.track(laneLaunch.pid);
    const lanePins = readJson(laneLaunch.pins.file);
    assert.equal(lanePins.idea.verdict, 'issue-only');
    assert.equal(fs.existsSync(path.join(laneLaunch.snapshot, 'research')), false, 'projectless dispatch succeeds without research/');
    await t.test("AC4 new launch schema ignores old config defaults", () => {
      const sample = JSON.parse(/## Запрос сбора[\s\S]*?```json\n([\s\S]*?)```/u.exec(fs.readFileSync(laneLaunch.dispatchFile, "utf8"))[1]);
      for (const value of [lanePins, sample]) for (const field of ["reviewDataset", "reviewDatasetVersion", "reviewDatasetDigest"])
        assert.equal(Object.hasOwn(value, field), false);
    });
    const laneRendered = fs.readFileSync(laneLaunch.dispatchFile, "utf8");
    assert.ok(laneRendered.includes(fingerprint));
    assert.equal(fs.existsSync(path.join(laneLaunch.snapshot, "prd.md")), false); assert.equal(fs.existsSync(path.join(laneLaunch.snapshot, "tech-spec.md")), false);
    await processes.stop(livePid); livePid = undefined;
    const launched = JSON.parse(pass(run(process.execPath, [command, ...options]))); livePid = processes.track(launched.pid);
    const registry = readJson(path.join(root, "workers.json")), entry = registry["MONO-999"];
    assert.equal(entry.attempt, 1); assert.equal(entry.pinsVersion, undefined); assert.equal(entry.profile, "short"); assert.equal(entry.handshake, "wait");
    assert.equal(launched.collector?.status, "running", `the collector starts with the attempt: ${JSON.stringify(launched.collector)}`);
    assert.equal(Object.hasOwn(entry, "confirmationTimeoutSec") || Object.hasOwn(entry, "collectionTimeoutSec"), false, "no collection windows");
    assert.equal(entry.pins.digest, (await import("./orchestrator/command-state.mjs")).sha256File(entry.pins.file));
    const launchedPins = readJson(entry.pins.file);
    assert.equal(fs.existsSync(path.join(launched.snapshot, 'research')), false, 'pre-cutoff package dispatch succeeds without research/');
    assert.equal(launchedPins.idea.verdict, 'pass'); assert.equal(launchedPins.idea.projectId, ideaProjectId);
    assert.equal(readJson(path.join(launched.snapshot, 'idea/selected-record.json')).id, 'idea-1');
    assert.equal(readJson(launched.gateFile).worktree, worktree); assert.deepEqual(readJson(launched.spawnFile).gates, entry.gates);
    assert.deepEqual(readJson(launched.pins.file).shipBotChecks, ["Greptile Review"]);
    assert.ok(fs.readFileSync(launched.dispatchFile, "utf8").includes("Keep {{field_name}} literal.")); assert.match(fs.readFileSync(path.join(root, "ledger.md"), "utf8"), /\d{4}-\d\d-\d\dT.*Z DISPATCHED MONO-999/u);
    const rendered = fs.readFileSync(launched.dispatchFile, "utf8");
    await t.test("dispatch-project-seam: project approval is separate from the five-field lane contract", () => {
      const seam = JSON.parse(/^- Context seam: (.+)$/mu.exec(rendered)[1]);
      assert.deepEqual(seam, { package_kind: "project-first", lifecycle_state_entity: "project",
        behavioral_oracle: null, risk_class: null, approval_status: "absent" });
    });
    assert.ok(rendered.includes(`--ack '${path.join(root, "reports/MONO-999-gate-ack-a1.json")}'`));
    assert.ok(rendered.includes(`--ack '${path.join(worktree, ".orchestrator/MONO-999-gate-ack-a1.json")}'`), "wait instructions use the actual fallback ack location");
    const collectionSample = JSON.parse(/## Запрос сбора[\s\S]*?```json\n([\s\S]*?)```/u.exec(rendered)[1]);
    assert.deepEqual(collectionSample.pins, entry.pins);
    assert.equal(collectionSample.collect, false);
    assert.throws(() => renderDispatch("{{collection_request}}", { collection_request: "" }), /unfilled dispatch placeholder/u);
    assert.ok(fs.existsSync(path.join(launched.snapshot, "prd-extract.md"))); assert.equal(fs.existsSync(path.join(launched.snapshot, "prd.md")), false);
    const baseline = JSON.parse(fixture("snapshot-u12-package-bytes.json")).find(item => item.coverage === "R4, U5");
    assert.equal(fs.readFileSync(path.join(launched.snapshot, "prd-extract.md"), "utf8"), baseline.prd, "scratch dispatch retains baseline PRD bytes");
    assert.equal(fs.readFileSync(path.join(launched.snapshot, "spec-extract.md"), "utf8"), baseline.spec, "scratch dispatch retains baseline Spec bytes");
    const printed = [], ackArgs = { root, issue: "MONO-999", attempt: "1" };
    await assert.rejects(acceptAck(ackArgs, value => printed.push(value)), /ack absent/u); assert.equal(printed.length, 0);
    const ackFile = path.join(root, "reports/MONO-999-gate-ack-a1.json"), ack = { issue: "MONO-999", phase: "gate", status: "gates-passed", gates: entry.gates.map(gate => ({ gate, status: "pass", evidence: "fixture" })) };
    atomicJson(ackFile, { ...ack, gates: ack.gates.slice(1) }); await assert.rejects(acceptAck(ackArgs, value => printed.push(value)), /outcome/u); assert.equal(printed.length, 0);
    atomicJson(ackFile, ack); await acceptAck(ackArgs, value => printed.push(value)); const plan = printed[0]; assert.ok(plan.planDigest);
    const observationFile = path.join(scratch, "ack-readback.json");
    const readback = [{ moveDigest: plan.moves[0].moveDigest, evidence: "target state read through connector", observedAt: new Date().toISOString() }];
    write(observationFile, { readback }); await assert.rejects(acceptAck({ ...ackArgs, readback: observationFile }, () => {}), /planDigest/u);
    write(observationFile, { planDigest: plan.planDigest, readback: [{ ...readback[0], observedAt: "2000-01-01T00:00:00Z" }] }); await assert.rejects(acceptAck({ ...ackArgs, readback: observationFile }, () => {}), /older/u);
    const recordFile = path.join(root, "consumed/MONO-999-gate-ack-a1.json");
    const beforeConsumption = readJson(path.join(root, "workers.json"));
    beforeConsumption[ack.issue].last_resume = { pid: entry.pid, thread_id: entry.thread_id, gateAckDigest: digest(ack), registeredAt: new Date().toISOString() };
    atomicJson(path.join(root, "workers.json"), beforeConsumption);
    write(observationFile, { planDigest: plan.planDigest, readback: [{ ...readback[0], observedAt: new Date().toISOString() }] });
    await acceptAck({ ...ackArgs, readback: observationFile }, () => {});
    assert.equal(readJson(recordFile).outcome, "applied", "fresh plan-bound readback delegates consumption");
    atomicJson(ackFile, ack); // Model interrupted rename recovery for the following prior-record fixtures.
    atomicJson(recordFile, { issue: ack.issue, attempt: 1, outcome: "rejected", gates: entry.gates, ack, ackDigest: digest(ack), readback });
    printed.length = 0; await assert.rejects(acceptAck(ackArgs, value => printed.push(value)), /contradictory/u); assert.equal(printed.length, 0);
    atomicJson(recordFile, { issue: ack.issue, attempt: 1, outcome: "applied", gates: entry.gates, ack, ackDigest: digest(ack), readback });
    await acceptAck(ackArgs, value => printed.push(value)); assert.equal(printed.length, 1); assert.equal(printed[0].planDigest, undefined);
    assert.ok(fs.existsSync(ackFile.replace(".json", ".applied.json"))); assert.equal(readJson(path.join(root, "workers.json"))[ack.issue].gates, undefined);
    const reportFile = path.join(root, "reports/MONO-999-phase-code.json"), head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim();
    const base = { issue: ack.issue, stage: "mono-deliver", attempt: 1, packVersion: entry.packVersion, ...(entry.sourceCommit ? { sourceCommit: entry.sourceCommit } : {}), surfaceRevision: entry.surfaceRevision,
      phase: "code", sequence: 1, kind: "phase", head, linear_mutations_pending: [], capsule: { phase: "code", head, decisions: [], writable_roots: entry.workerWritableRoots, open_queue: [] } };
    await t.test("report-linear-writes-not-queued: the worker writes its comments and statuses; no report confirmation command exists", () => {
      for (const write of [{ id: "fixture:comment", operation: "comment", target: ack.issue, payload: { body: "Russian lead" } },
        { id: "fixture:state", operation: "issue-state", target: ack.issue, payload: { state: "In Progress" } }])
        assert.throws(() => publishPhase({ ...base, linear_mutations_pending: [write], capsule: { ...base.capsule, open_queue: [write] } }, reportFile), /queued writes no longer exist/u);
      assert.equal(fs.existsSync(reportFile), false);
      const removed = spawnSync(process.execPath, [path.join(runtime, "orchestrator/accept.mjs"), "report", "--root", root, "--report", reportFile], { env, encoding: "utf8" });
      assert.notEqual(removed.status, 0); assert.match(removed.stderr, /expected ack/u);
    });
    const report = publishPhase(base, reportFile);
    assert.equal(fs.existsSync(path.join(root, "confirmations")), false, "an empty phase report advances without any confirmation");
    const pins = effectivePins(readJson(path.join(root, "workers.json"))[ack.issue]);
    const request = { ...pins, pins: entry.pins, head, collect: false, workerVerification: { head: head, exitCode: 0 }, collectionId: `preflight-collect:${head}:1` };
    const round = { issue: ack.issue, attempt: 1, request };
    await withLock(path.join(root, "launch.lock"), async () => { await assert.rejects(admitCollection(root, round), /locked/u); });
    const { admission, refusal } = await admitCollection(root, round);
    assert.equal(refusal, null); assert.equal(admission.manifestDigest, digest(pins)); assert.equal(admission.ordinal, 1);
    assert.deepEqual((await admitCollection(root, round)).admission, admission, "the same request replays its admission");
    await assert.rejects(admitCollection(root, { ...round, request: { ...request, risk: "risky" } }), /already admitted for another request/u);
    await assert.rejects(admitCollection(root, { ...round, request: { ...request, collectionId: `preflight-collect:${head}:2` } }), /has no result yet/u);
    recordResult(root, ack.issue, 1, admission, { status: "refused", reason: "fixture" });
    const mismatched = await admitCollection(root, { ...round, request: { ...request, risk: "tiny", collectionId: `preflight-collect:${head}:2` } });
    assert.match(mismatched.refusal, /collection pin mismatch: risk/u, "a request off the launch pins is admitted only to record its refusal");
    recordResult(root, ack.issue, 1, mismatched.admission, { status: "refused", reason: mismatched.refusal });
    assert.deepEqual(readLedger(root, ack.issue, 1).map(item => item.result.status), ["refused", "refused"]);
    await processes.stop(livePid); livePid = null;
    const oldPath = process.env.PATH; process.env.PATH = env.PATH;
    try {
      await t.test("task-change-resume: an «Изменение задачи» link resumes the same session and reaches the reviewer; grants and risk never change", async () => {
        const resume = path.join(runtime, "orchestrator/resume.mjs"), resumeFile = path.join(scratch, "task-change.md"), requestFile = path.join(scratch, "resume-request.json");
        const url = "https://linear.app/darkdepot/issue/MONO-999/fixture#comment-1";
        write(resumeFile, `Изменение задачи: ${url}\nRead the comment and follow it.\n`);
        write(requestFile, { root, issue: ack.issue, resumeFile, workerWritableRoots: [...entry.workerWritableRoots, scratch] });
        const widened = run(process.execPath, [resume, "--request", requestFile]);
        assert.notEqual(widened.status, 0); assert.match(widened.stderr, /a risk or grant change is a new attempt on the same branch/u);
        write(requestFile, { root, issue: ack.issue, resumeFile, taskChange: "https://linear.app/darkdepot/issue/MONO-999/fixture#comment-2" });
        const unquoted = run(process.execPath, [resume, "--request", requestFile]);
        assert.notEqual(unquoted.status, 0); assert.match(unquoted.stderr, /quoted in the resume file/u);
        write(requestFile, { root, issue: ack.issue, resumeFile, taskChange: url });
        const resumed = JSON.parse(pass(run(process.execPath, [resume, "--request", requestFile]))); livePid = processes.track(resumed.pid);
        assert.equal(resumed.thread_id, entry.thread_id, "the same session resumes");
        assert.equal(resumed.collector?.status, "running");
        const changes = readJson(path.join(path.dirname(entry.pins.file), "task-changes.json"));
        assert.deepEqual(changes.map(change => [change.number, change.url]), [[1, url]]);
        assert.deepEqual(readJson(path.join(root, "workers.json"))[ack.issue].workerWritableRoots, entry.workerWritableRoots);
        assert.equal(readJson(entry.pins.file).risk, pins.risk, "launch pins stay unchanged");
        assert.equal(fs.readdirSync(path.dirname(entry.pins.file)).some(name => /^pins\.v\d+\.json$/u.test(name)), false);
        await processes.stop(livePid); livePid = null;
      });
    } finally { process.env.PATH = oldPath; }
  } finally {
    processes.track(livePid);
    processes.registry(path.join(root, "workers.json"));
    processes.registry(path.join(scratch, "lane-orchestrator/workers.json"));
    try { await processes.cleanup(); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
});

test("collector locks retain incarnation and reclaim only dead isolated process trees", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mono-collector-lock-"));
  const file = path.join(dir, "head.collect.lock");
  const oldPath = process.env.PATH;
  write(path.join(dir, "ps"), `#!/usr/bin/env node
if (process.argv.includes("-axo")) console.log("${process.pid} 1 ${process.pid} S fixture-start"); else console.log("fixture-start");
`); fs.chmodSync(path.join(dir, "ps"), 0o700); process.env.PATH = `${dir}:${oldPath}`;
  try {
    await withLock(file, async () => {
      assert.equal(readJson(file).procStart, (await import("./runtime.mjs")).processStart(process.pid));
      await assert.rejects(withLock(file, () => {}, { reclaim: true }), /locked/u);
    });
    const { reclaimLock } = await import("./runtime.mjs");
    atomicJson(file, { pid: 99999999, procStart: "dead incarnation", processGroup: 99999999 });
    reclaimLock(file);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(file + ".reclaim"), false);
    atomicJson(file, { pid: process.pid, procStart: "old incarnation", processGroup: process.pid });
    reclaimLock(file);
    assert.equal(fs.existsSync(file), false, "a reused PID does not make the old incarnation live");
  } finally { process.env.PATH = oldPath; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("collector ignores phase reports and refuses a round request before the code report", async () => {
  await collectorAttentionFixture(async f => {
    await f.poll();
    assert.deepEqual(readLedger(f.options.root, f.options.issue, 1), [], "phase reports never wait for the collector");
    fs.unlinkSync(path.join(f.options.root, "reports", `${f.options.issue}-phase-code.json`));
    await f.signedHistory(f.request(1)); atomicJson(f.roundFile, f.round(1)); await f.poll();
    const [only] = readLedger(f.options.root, f.options.issue, 1);
    assert.equal(only.result.status, "refused"); assert.match(only.result.reason, /phase code report is missing/u);
    assert.equal(fs.existsSync(path.join(f.options.root, "confirmations")), false);
  });
});

async function collectorAttentionFixture(runFixture, plugin = false) {
  const { collectOnce } = await import("./orchestrator/collector.mjs");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-collector-attention-"));
  const root = path.join(scratch, "root"), repo = path.join(scratch, "repo"), skillsRoot = path.join(scratch, "skills"), evidenceRoot = path.join(scratch, "evidence");
  const issue = "MONO-999", head = "d".repeat(40), options = { root, issue, attempt: 1 };
  const identity = { packVersion: "0.21.0", sourceCommit: head, surfaceRevision: 4 };
  const pins = { ...(plugin ? { packRoot: path.join(scratch, "task-plugin") } : {}), product: "fixture", root, worktree: repo, skillsRoot, evidenceRoot, baseRef: "origin/main", risk: "standard", critical: null,
    verification: { command: "node", args: ["verify.mjs"] }, workerWritableRoots: [repo] };
  const pinsFile = path.join(root, "dispatch", `${issue}-a1`, "pins.json");
  const log = path.join(root, "reports", `${issue}-collector-a1.log`);
  const roundFile = path.join(root, "reports", roundRequestName(issue, 1)), registry = path.join(root, "workers.json");
  const phase = (name, sequence) => ({ ...identity, issue, stage: "mono-deliver", attempt: 1, phase: name, kind: "phase", sequence, head,
    publishedAt: new Date().toISOString(), capsule: { phase: name, head, decisions: [], writable_roots: [repo] } });
  const request = number => ({ ...pins, pins: { file: pinsFile, digest: createHash("sha256").update(fs.readFileSync(pinsFile)).digest("hex") }, head, collect: false, workerVerification: { head: head, exitCode: 0 }, collectionId: `preflight-collect:${head}:${number}` });
  const round = (number, overrides = {}) => ({ issue, attempt: 1, request: { ...request(number), ...overrides } });
  const poll = () => collectOnce(options);
  const lines = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(line => line.includes("attention: ")) : [];
  const oldPath = process.env.PATH;
  try {
    for (const dir of [repo, skillsRoot, evidenceRoot]) fs.mkdirSync(dir, { recursive: true });
    atomicJson(pinsFile, pins);
    const entry = { ...identity, issue, stage: "mono-deliver", attempt: 1, worktree: repo, workerWritableRoots: [repo],
      pins: { file: pinsFile, digest: createHash("sha256").update(fs.readFileSync(pinsFile)).digest("hex") }, spawned_at: new Date(Date.now() - 10000).toISOString() };
    atomicJson(registry, { [issue]: entry });
    atomicJson(path.join(root, "reports", `${issue}-phase-code.json`), phase("code", 1));
    const bin = path.join(scratch, "bin");
    write(path.join(bin, "ps"), "#!" + process.execPath + "\nconsole.log(process.argv.includes('-axo')?process.ppid+' 1 '+process.ppid+' S fixture-start':'fixture-start');\n"); fs.chmodSync(path.join(bin, "ps"), 0o700);
    process.env.PATH = `${bin}:${oldPath}`;
    if (plugin) write(path.join(pins.packRoot, 'VERSION'), '0.22.0\n');
    write(plugin ? path.join(pins.packRoot, 'scripts/gate.mjs') : path.join(skillsRoot, "scripts/gate.mjs"), "console.log('gate preflight: pass: fixture admission');\n");
    // A receipt in history, as the gate writes it: evidenceRoot is outside every worker grant, so it carries no signature.
    const signedHistory = async value => {
      const { randomUUID } = await import("node:crypto");
      const receipt = { issue, ...value, root: fs.realpathSync(root), worktree: fs.realpathSync(repo), evidenceRoot: fs.realpathSync(evidenceRoot), workerWritableRoots: [fs.realpathSync(repo)],
        producer: REVIEW_PRODUCER, runId: randomUUID(), modelRoutes: null };
      const file = path.join(evidenceRoot, "history", `${receipt.runId}.json`);
      atomicJson(file, { receipt });
      return { receipt: file, receiptDigest: digest({ receipt }) };
    };
    await runFixture({ poll, lines, roundFile, round, registry, entry, phase, request, signedHistory, options, scratch });
  } finally { process.env.PATH = oldPath; fs.rmSync(scratch, { recursive: true, force: true }); }
}

test("plugin collector executes the task folder gate with a separate helper root", async () => {
  await collectorAttentionFixture(async f => {
    atomicJson(f.roundFile, f.round(1));
    const history = await f.signedHistory(f.request(1)); await f.poll();
    const [only] = readLedger(f.options.root, f.options.issue, 1);
    assert.equal(only.result.status, 'done', JSON.stringify(only.result));
    assert.equal(only.result.gate, 'gate preflight: pass: fixture admission');
    assert.equal(only.result.receipt, history.receipt);
    assert.notEqual(f.request(1).packRoot, f.request(1).skillsRoot);
  }, true);
});

test("collector records a refused round once for a request off the launch pins, also after a restart", async () => {
  await collectorAttentionFixture(async f => {
    atomicJson(f.roundFile, f.round(1, { risk: "deep" })); await f.poll();
    const ledger = readLedger(f.options.root, f.options.issue, 1);
    assert.deepEqual(ledger.map(item => [item.admission.ordinal, item.result.status, item.result.reason]), [[1, "refused", "collection pin mismatch: risk"]]);
    const logFile = path.join(f.options.root, "reports", `${f.options.issue}-collector-a1.log`), beforeLog = fs.readFileSync(logFile, "utf8");
    await f.poll();
    const module = new URL("./orchestrator/collector.mjs", import.meta.url).href;
    pass(spawnSync(process.execPath, ["--input-type=module", "-e", `const {collectOnce}=await import(${JSON.stringify(module)});await collectOnce(${JSON.stringify(f.options)});`], { encoding: "utf8" }));
    assert.deepEqual(readLedger(f.options.root, f.options.issue, 1), ledger);
    assert.equal(fs.readFileSync(logFile, "utf8"), beforeLog, "a known request is skipped silently");
  });
});

test("collector-replaced-request: an admitted collectionId never takes another request; the next one is admitted after the result", async () => {
  await collectorAttentionFixture(async f => {
    atomicJson(f.roundFile, f.round(1, { risk: "deep" })); await f.poll();
    const before = readLedger(f.options.root, f.options.issue, 1);
    atomicJson(f.roundFile, f.round(1)); await f.poll(); await f.poll();
    assert.deepEqual(readLedger(f.options.root, f.options.issue, 1), before, "the refused result stays bound to the first request");
    assert.deepEqual(f.lines().map(line => line.replace(/^\S+ /u, "")), [`attention: collectionId preflight-collect:${"d".repeat(40)}:1 already admitted for another request`]);
    atomicJson(f.roundFile, f.round(2)); await f.signedHistory(f.request(2)); await f.poll();
    const after = readLedger(f.options.root, f.options.issue, 1);
    assert.deepEqual(after.map(item => [item.admission.ordinal, item.admission.collectionId.endsWith(":2") || item.admission.ordinal === 1, item.result.status]), [[1, true, "refused"], [2, true, "done"]]);
  });
});

test("collector finishes an admitted round before reading a newer request", async () => {
  await collectorAttentionFixture(async f => {
    const { admitRound } = await import("./review-rounds.mjs");
    admitRound(f.options.root, f.options.issue, 1, f.request(1));
    await f.signedHistory(f.request(1));
    atomicJson(f.roundFile, f.round(2)); await f.poll();
    const ledger = readLedger(f.options.root, f.options.issue, 1);
    assert.deepEqual(ledger.map(item => [item.admission.ordinal, item.result?.status]), [[1, "done"]], "the overwritten mailbox cannot skip the admitted round");
    await f.signedHistory(f.request(2)); await f.poll();
    assert.deepEqual(readLedger(f.options.root, f.options.issue, 1).map(item => item.result.status), ["done", "done"]);
  });
});

test("collector-refusal-persisted: a refused admission is recorded after a restart and never runs", async () => {
  await collectorAttentionFixture(async f => {
    const { admitRound } = await import("./review-rounds.mjs");
    admitRound(f.options.root, f.options.issue, 1, f.request(1), { refusal: "collection pin mismatch: packRoot" });
    await f.signedHistory(f.request(1)); await f.poll();
    const [only] = readLedger(f.options.root, f.options.issue, 1);
    assert.deepEqual([only.result.status, only.result.reason, only.result.gate], ["refused", "collection pin mismatch: packRoot", undefined]);
  });
});

test("collector launch lock error records nothing", async () => {
  await collectorAttentionFixture(async f => {
    atomicJson(f.roundFile, f.round(1));
    await withLock(path.join(f.options.root, "launch.lock"), async () => { await assert.rejects(f.poll(), /operation locked/u); });
    assert.deepEqual(readLedger(f.options.root, f.options.issue, 1), []); assert.equal(f.lines().length, 0);
  });
});

test("collector installed scratch: gate crash leaves both locks, admitted recovery, binding checks and commands", async t => {
  const { collectorStart, collectorStop, collectorStatus, collectOnce } = await import("./orchestrator/collector.mjs");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-collector-recovery-"));
  const root = path.join(scratch, "root"), repo = path.join(scratch, "repo"), evidence = path.join(scratch, "evidence"), skills = path.join(scratch, "skills"), bin = path.join(scratch, "bin");
  const issue = "MONO-999", head = "b".repeat(40), attempt = 1, options = { root, issue, attempt };
  const lock = path.join(root, "reports", `${issue}-collector-a1.lock`), headLock = path.join(evidence, `${head}.collect.lock`);
  const oldPath = process.env.PATH, rows = path.join(scratch, "rows.json");
  const oldRows = process.env.MONO_FIXTURE_ROWS;
  const runtimeUrl = new URL("./runtime.mjs", import.meta.url).href;
  const countFile = path.join(scratch, "count.json"), modeFile = path.join(scratch, "mode.json");
  const waitUntil = async predicate => { const deadline = Date.now() + 12000; while (!predicate()) { if (Date.now() > deadline) assert.fail("fixture deadline: " + (fs.existsSync(path.join(root,"reports",`${issue}-collector-a1.log`)) ? fs.readFileSync(path.join(root,"reports",`${issue}-collector-a1.log`),"utf8") : "no log")); await new Promise(resolve => setTimeout(resolve, 50)); } };
  const processes = fixtureProcesses();
  let started, validatorPid;
  const validationFile = path.join(scratch, "validation.json");
  const roundFile = path.join(root, "reports", roundRequestName(issue, 1));
  const result = ordinal => readLedger(root, issue, 1).find(item => item.admission.ordinal === ordinal)?.result ?? null;
  try {
    for (const dir of [repo, evidence, bin, path.dirname(lock)]) fs.mkdirSync(dir, { recursive: true });
    write(rows, [lock, headLock]);
    // Seatbelt denies host ps in a worker. This adapter supplies process telemetry
    // for real detached fixture children, checking their OS liveness by signal 0.
    write(path.join(bin, "ps"), `#!/usr/bin/env node
const fs=require('fs');
if(!process.argv.includes('-axo')) { console.log('fixture-start'); process.exit(); }
const live=p=>{try{process.kill(p,0);return true}catch{return false}};
const found=new Map([[process.ppid,{pid:process.ppid,processGroup:process.ppid}]]);
for(const file of JSON.parse(fs.readFileSync(process.env.MONO_FIXTURE_ROWS))) if(fs.existsSync(file)) {
 const holder=JSON.parse(fs.readFileSync(file)); for(const row of [holder,holder.gate,...(holder.descendants??[])].filter(Boolean)) if(live(row.pid)) found.set(row.pid,row);
}
for(const row of found.values()) console.log(row.pid+' 1 '+row.processGroup+' S fixture-start');
`); fs.chmodSync(path.join(bin, "ps"), 0o700);
    process.env.PATH = `${bin}:${oldPath}`; process.env.MONO_FIXTURE_ROWS = rows;
    atomicJson(modeFile, { crash: false }); atomicJson(countFile, { collections: 0 });
    write(path.join(skills, "scripts/gate.mjs"), `import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {withLock,atomicJson,readJson} from ${JSON.stringify(runtimeUrl)};
const request=readJson(process.argv[process.argv.indexOf('--request')+1]);
if(!request.collect){if(readJson(${JSON.stringify(modeFile)}).holdValidation){atomicJson(${JSON.stringify(validationFile)},{pid:process.pid});while(readJson(${JSON.stringify(modeFile)}).holdValidation)await new Promise(r=>setTimeout(r,50));}const receipt=readJson(path.join(request.evidenceRoot,request.head+'.json')).receipt;console.log(receipt.verification.exitCode===0?'gate preflight: pass: fixture recovered':'gate preflight: fail: fixture verification failed');process.exit();}
await withLock(path.join(request.evidenceRoot,request.head+'.collect.lock'),async()=>{
 const countFile=${JSON.stringify(countFile)},mode=readJson(${JSON.stringify(modeFile)});const count=readJson(countFile);count.collections++;atomicJson(countFile,count);if(mode.noReceipt)process.exit(78);
 const receipt={issue:${JSON.stringify(issue)},producer:'gate-review-v3',runId:crypto.randomUUID(),head:request.head,base:request.head,collectionId:request.collectionId,product:request.product,skillsRoot:request.skillsRoot,
 root:fs.realpathSync(request.root),worktree:fs.realpathSync(request.worktree),evidenceRoot:fs.realpathSync(request.evidenceRoot),risk:request.risk,critical:request.critical,workerWritableRoots:request.workerWritableRoots.map(p=>fs.realpathSync(p)).sort(),
 ...(request.pins?{pins:request.pins}:{}),verification:{...request.verification,exitCode:mode.failed?1:0}};
 if(mode.corrupt) receipt[mode.corrupt]=mode.value;
 const envelope={receipt};
 atomicJson(path.join(request.evidenceRoot,'history',receipt.runId+'.json'),envelope);
 if(mode.crash){const holder=readJson(${JSON.stringify(lock)});process.kill(holder.pid,'SIGKILL');process.exit(77);}
 atomicJson(path.join(request.evidenceRoot,request.head+'.json'),envelope);
 console.log('gate preflight: pass: fixture collected');
});
`);
    const pins = { product: "fixture", root, worktree: repo, skillsRoot: skills, baseRef: "origin/main", evidenceRoot: evidence,
      risk: "standard", critical: null, verification: { command: "node", args: ["verify.mjs"] }, workerWritableRoots: [repo] };
    const pinsFile = path.join(root, "dispatch", `${issue}-a1`, "pins.json"); atomicJson(pinsFile, pins);
    const identity = { packVersion: "0.21.0", sourceCommit: head, surfaceRevision: 4 };
    const entry = { ...identity, issue, stage: "mono-deliver", attempt, worktree: repo, workerWritableRoots: [repo],
      pins: { file: pinsFile, digest: createHash("sha256").update(fs.readFileSync(pinsFile)).digest("hex") }, spawned_at: new Date(Date.now() - 10000).toISOString() };
    atomicJson(path.join(root, "workers.json"), { [issue]: entry });
    const code = { ...identity, issue, stage: "mono-deliver", attempt, phase: "code", kind: "phase", sequence: 1, head,
      publishedAt: new Date().toISOString(), capsule: { phase: "code", head, writable_roots: [repo], decisions: [] } };
    atomicJson(path.join(root, "reports", `${issue}-phase-code.json`), code);
    started = await collectorStart(options); processes.track(started.pid); assert.ok(started.procStart);
    await assert.rejects(collectorStart(options), /locked/u);
    assert.equal(collectorStatus(options).status, "running-or-unverified");
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(readLedger(root, issue, 1), [], "the running collector waits for a round request");
    const request = { ...pins, pins: collectionPinsBinding(entry), head, collect: false, workerVerification: { head: head, exitCode: 0 }, collectionId: `preflight-collect:${head}:1` };
    atomicJson(modeFile, { crash: true }); atomicJson(roundFile, { issue, attempt, request });
    await waitUntil(() => fs.existsSync(path.join(evidence, "history")) && fs.readdirSync(path.join(evidence, "history")).length === 1 && collectorStatus(options).status === "stale");
    await processes.stop(started.pid);
    assert.equal(fs.existsSync(lock), true); assert.equal(fs.existsSync(headLock), true); assert.equal(fs.existsSync(path.join(evidence, `${head}.json`)), false);
    assert.equal(readLedger(root, issue, 1)[0].result, null, "the crashed round stays admitted without a result");
    // The worker overwrites its mailbox: the admitted round is still finished first.
    atomicJson(roundFile, { issue, attempt, request: { ...request, collectionId: `preflight-collect:${head}:9` } });
    atomicJson(modeFile, { holdValidation: true }); started = await collectorStart(options); processes.track(started.pid);
    await waitUntil(() => fs.existsSync(validationFile)); validatorPid = processes.track(readJson(validationFile).pid);
    const recoveryPid = started.pid; process.kill(recoveryPid, "SIGKILL"); started = null;
    await waitUntil(() => { try { process.kill(recoveryPid, 0); return false; } catch { return true; } });
    await processes.stop(recoveryPid);
    const { reclaimLock: reclaimHead } = await import("./runtime.mjs");
    assert.throws(() => reclaimHead(headLock), /locked/u, "a live detached validation gate protects the head lock after collector death");
    await assert.rejects(collectorStart(options), /locked/u);
    atomicJson(modeFile, { crash: false });
    await waitUntil(() => collectorStatus(options).status === "stale"); await processes.stop(validatorPid); validatorPid = null;
    atomicJson(roundFile, { issue, attempt, request });
    started = await collectorStart(options); processes.track(started.pid);
    await waitUntil(() => result(1) !== null);
    assert.equal(result(1).status, "done"); assert.equal(result(1).gate, "gate preflight: pass: fixture recovered");
    assert.equal(readJson(countFile).collections, 1, "history recovery never repeats review");
    assert.equal(fs.existsSync(headLock), false); assert.deepEqual(readJson(path.join(evidence, `${head}.json`)), readJson(result(1).receipt));
    collectorStop(options); await waitUntil(() => !fs.existsSync(lock)); await processes.stop(started.pid); started = null;
    assert.equal(collectorStatus(options).status, "stopped");
    await t.test("dead holder cannot reclaim a live orphan descendant", async () => {
      const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
      const exited = new Promise(resolve => child.once("exit", resolve));
      try {
        const holder = { pid: 99999999, procStart: "fixture-start", processGroup: 99999999,
          descendants: [{ pid: child.pid, procStart: "fixture-start", processGroup: 99999999 }] };
        atomicJson(lock, holder); atomicJson(headLock, holder);
        await assert.rejects(collectorStart(options), /locked/u);
        const { reclaimLock } = await import("./runtime.mjs");
        assert.throws(() => reclaimLock(headLock), /locked/u);
        assert.equal(fs.existsSync(headLock + ".reclaim"), false);
        child.kill("SIGKILL"); await exited;
        reclaimLock(headLock); collectorStop(options);
        assert.equal(fs.existsSync(lock), false); assert.equal(fs.existsSync(headLock), false);
      } finally { child.kill("SIGKILL"); await exited; }
    });
    const next = () => { const ordinal = readLedger(root, issue, 1).length + 1, id = `preflight-collect:${head}:${ordinal + 10}`;
      atomicJson(roundFile, { issue, attempt, request: { ...request, collectionId: id } }); return ordinal; };
    await t.test("receipt actual binding rejects mismatches with a failed result", async () => {
      for (const [field, value] of [["risk", "deep"], ["critical", "wrong"], ["workerWritableRoots", []], ["verification", { command: "wrong", args: [] }], ["pins", { file: "wrong", digest: "0".repeat(64) }]]) {
        const ordinal = next(); atomicJson(modeFile, { corrupt: field, value });
        await collectOnce(options);
        assert.equal(result(ordinal).status, "failed"); assert.match(result(ordinal).reason, new RegExp(`binding mismatch: ${field}`));
      }
    });
    await t.test("failed collections are completed and never reviewed twice", async () => {
      const ordinal = next(), count = readJson(countFile).collections; atomicJson(modeFile, { failed: true });
      await collectOnce(options);
      assert.equal(result(ordinal).status, "done"); assert.match(result(ordinal).gate, /^gate preflight: fail:/);
      assert.equal(readJson(countFile).collections, count + 1);
      await collectOnce(options); assert.equal(readJson(countFile).collections, count + 1);
    });
    await t.test("a started run without a receipt retries only within its allowance, then fails", async () => {
      const ordinal = next(), count = readJson(countFile).collections; atomicJson(modeFile, { noReceipt: true });
      await collectOnce(options);
      assert.equal(result(ordinal).status, "failed"); assert.match(result(ordinal).reason, /retries exhausted/);
      await collectOnce(options);
      assert.equal(readJson(countFile).collections, count + 2);
    });
  } finally {
    try {
      if (started) collectorStop(options);
    } finally {
      try { await processes.cleanup(); } finally {
        process.env.PATH = oldPath;
        if (oldRows === undefined) delete process.env.MONO_FIXTURE_ROWS; else process.env.MONO_FIXTURE_ROWS = oldRows;
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    }
  }
});

test("AC4 collector accepts old reviewDataset receipts and new receipts without the field", async t => {
  for (const shape of ["new", "0.49.x", "before-0.49.0"]) await t.test(shape, async () => {
    await collectorAttentionFixture(async f => {
      const pinsFile = f.entry.pins.file, base = readJson(pinsFile);
      const archive = path.join(f.scratch, "evidence/datasets/scope.v1.md"); write(archive, "Archived context.\n");
      const hash = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
      if (shape !== "new") Object.assign(base, { reviewDataset: shape === "0.49.x" ? null : archive,
        reviewDatasetVersion: shape === "0.49.x" ? 0 : 1, reviewDatasetDigest: shape === "0.49.x" ? null : hash });
      atomicJson(pinsFile, base);
      const registry = readJson(f.registry); registry[f.entry.issue].pins.digest = createHash("sha256").update(fs.readFileSync(pinsFile)).digest("hex"); atomicJson(f.registry, registry);
      const request = { ...f.request(1), ...(shape === "new" ? {} : { reviewDatasetVersion: base.reviewDatasetVersion }),
        ...(shape === "before-0.49.0" ? { reviewDataset: archive } : {}) };
      atomicJson(f.roundFile, { issue: f.options.issue, attempt: 1, request });
      const signed = await f.signedHistory(request), envelope = readJson(signed.receipt);
      if (shape !== "new") envelope.receipt.reviewDataset = shape === "0.49.x" ? null : { source: archive,
        archive, version: 1, digest: hash, copy: ".orchestrator/review-dataset-old.md" };
      atomicJson(signed.receipt, envelope); fs.unlinkSync(archive);
      await f.poll();
      const [only] = readLedger(f.options.root, f.options.issue, 1);
      assert.equal(only.result.status, "done", JSON.stringify(only.result));
      assert.equal(only.admission.manifestDigest, digest(base));
      const receipt = readJson(path.join(base.evidenceRoot, f.request(1).head + ".json")).receipt;
      assert.equal(Object.hasOwn(receipt, "reviewDataset"), shape !== "new");
    });
  });
});

test("collector startup timeout stops its detached child before reporting failure", async () => {
  const { awaitCollectorReady } = await import("./orchestrator/collector.mjs");
  const { spawn } = await import("node:child_process");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-collector-timeout-"));
  const lock = path.join(scratch, "late.lock");
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {require('fs').writeFileSync(process.argv[1], JSON.stringify({pid:process.pid,ready:true}));}, 800);setInterval(()=>{},1000);", lock], { detached: true, stdio: "ignore" });
  try {
    await assert.rejects(awaitCollectorReady(child, lock, 100), /did not acquire attempt lock/u);
    assert.ok(child.signalCode || child.exitCode !== null, "the child has exited before the rejection reaches the caller");
    assert.equal(fs.existsSync(lock), false, "no collector can acquire a late lock after failed startup");
  } finally { await stopFixtureProcess(child.pid); fs.rmSync(scratch, { recursive: true, force: true }); }
});


test("preapply AE12 named contracts on installed scratch", async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-preapply-ae12-"));
  const skills = path.join(scratch, "skills"), repo = path.join(scratch, "repo"), root = path.join(scratch, "orchestrator"), bin = path.join(scratch, "bin");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const processes = fixtureProcesses();
  const run = (cmd, args, cwd = checkout) => {
    const result = spawnSync(cmd, args, { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    processes.registry(path.join(root, "workers.json"));
    return result;
  };
  const git = (cwd, ...args) => pass(run("git", args, cwd));
  const input = JSON.parse(fixture("preapply-ae12.json"));
  let pid;
  try {
    for (const dir of [repo, bin, path.join(root, "reports")]) fs.mkdirSync(dir, { recursive: true });
    copyPluginFixture(skills);
    const runtime = path.join(skills, "scripts");
    write(path.join(bin, "codex"), '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"ae12"}));setInterval(()=>{},1000);\n'); fs.chmodSync(path.join(bin, "codex"), 0o700);
    atomicJson(path.join(root, "control.json"), { state: "active", halt: false }); atomicJson(path.join(root, "workers.json"), {}); writeWatcherFixture(root, env);
    git(repo, "init", "-b", "main"); const origin = path.join(scratch, "origin.git"); git(scratch, "init", "--bare", origin); git(repo, "remote", "add", "origin", origin);
    const config = path.join(repo, ".agents/mono-workflow.config.json"), policy = readJson(path.join(checkout, ".agents/mono-workflow.config.json"));
    policy.orchestration.transport = "codex-cli";
    policy.ideaGate = { since: '2026-10-17' };
    policy.orchestration.preapply = { mandate: input.mandate };
    policy.orchestration.delivery = { ...policy.orchestration.delivery, attemptCap: 10 };
    policy.orchestration.dispatch = { product: "ae12", evidenceRoot: path.join(scratch, "evidence"), openDecisions: 0, lifecycle_moves: [], verification: { command: "node", args: ["scripts/verify.mjs"] } };
    write(config, JSON.stringify(policy, null, 2) + "\n"); write(path.join(repo, ".gitignore"), ".worktrees/\n.agents/ignored.txt\n"); write(path.join(repo, ".agents/directory/file"), "fixture\n"); write(path.join(repo, ".gitattributes"), ".agents/filtered.txt ident\n");
    git(repo, "add", "."); git(repo, "commit", "-m", "AE12 mandate bootstrap"); git(repo, "push", "origin", "main");
    const worktree = path.join(repo, ".worktrees/MONO-997"); git(repo, "worktree", "add", "-b", "mono/mono-997", worktree, "origin/main");
    const base = git(worktree, "rev-parse", "HEAD"), snapshot = path.join(scratch, "snapshot");
    const body = "# AE12\n# Что сделать\nPreapply.\n# Готовность агента\nAFK\n# Покрытие PRD/Spec\nU7\n# Как проверить\n1. AE12\n# Ключевые контракты\nMandate.\nРиск: standard\n";
    const rawConfig = fs.readFileSync(config, "utf8");
    const bytes = rawConfig.replace('"projectName": "Mono Agent Workflow"', '"projectName": "AE12 applied"');
    const hash = value => createHash("sha256").update(value).digest("hex");
    const manifest = (filename, content, sha = hash(content)) => `    - \`${filename}\` sha256 \`${sha}\`\n\`\`\`text\n${content}\`\`\`\n`;
    const target = ".agents/mono-workflow.config.json", opaquePath = ".agents/opaque.txt", opaqueBytes = JSON.parse(fixture("preapply-opaque-bytes.json")).bytes;
    const good = manifest(target, bytes) + manifest(opaquePath, opaqueBytes);
    write(path.join(snapshot, "approval.md"), "Approved AE12; project Delivery."); write(path.join(snapshot, "project-brief.md"), "AE12"); write(path.join(snapshot, "prd.md"), "## Кратко\nAE12 scratch.\n");
    ideaDispatchFixture(snapshot, 'MONO-997');
    const setSpec = value => { write(path.join(snapshot, "issue-MONO-997.md"), body); write(path.join(snapshot, "tech-spec.md"), `- U7. AE12\n  - Предприменение:\n${value}- U8. Uncovered\n`); };
    setSpec(good);
    const writable = path.join(scratch, "writable.json"), temp = path.join(scratch, "worker-temp"); fs.mkdirSync(temp); write(writable, [temp]);
    const options = [path.join(runtime, "orchestrator/dispatch.mjs"), "--issue", "MONO-997", "--root", root, "--config", config, "--snapshot", snapshot, "--worker-writable-roots", writable];
    const refusal = (pattern, flags = ["--preapply"]) => {
      const result = run(process.execPath, [...options, ...flags]); if (result.status === 0) processes.track(JSON.parse(result.stdout).pid); assert.notEqual(result.status, 0, result.stdout); assert.match(result.stderr, pattern);
      assert.equal(git(worktree, "rev-parse", "HEAD"), base); assert.equal(fs.existsSync(path.join(root, "attempts.json")), false); assert.deepEqual(readJson(path.join(root, "workers.json")), {});
      assert.equal(fs.readFileSync(path.join(worktree, target), "utf8"), rawConfig);
      assert.equal(fs.existsSync(path.join(worktree, opaquePath)), false);
    };
    await t.test("preapply-flag-required", () => { setSpec(good); refusal(/--preapply/u, []); });
    await t.test("preapply-mandate-required", () => { delete policy.orchestration.preapply; write(config, policy); refusal(/mandate/u); policy.orchestration.preapply = { mandate: input.mandate }; write(config, policy); });
    for (const [name, value, pattern] of [
      ["preapply-outside-agents", manifest("other.json", bytes), /path/u],
      ["preapply-parent-traversal", manifest(".agents/../outside", bytes), /path/u],
      ["preapply-nonregular", manifest(".agents", bytes), /path|regular/u],
      ["preapply-directory-target", manifest(".agents/directory", bytes), /regular/u],
      ["preapply-hash-mismatch", manifest(target, bytes, "0".repeat(64)), /sha256/u],
      ["preapply-table-form-refused", `| path | sha256 |\n| --- | --- |\n| ${target} | ${hash(bytes)} |\n\n    - \`${target}\`\n\`\`\`text\n${bytes}\`\`\`\n`, /path|manifest/u],
      ["preapply-malformed-second-item", manifest(target, bytes) + manifest(opaquePath, opaqueBytes, "invalid").replace("    -", "  -"), /path|sha256/u],
      ["preapply-malformed-second-extra-space", manifest(target, bytes) + manifest(opaquePath, opaqueBytes, "invalid").replace("    - ", "  -  "), /path|sha256/u],
      ["preapply-malformed-second-tab", manifest(target, bytes) + manifest(opaquePath, opaqueBytes, "invalid").replace("    - ", "  -\t"), /path|sha256/u],
      ["preapply-malformed-second-star-spacing", manifest(target, bytes) + manifest(opaquePath, opaqueBytes, "invalid").replace("    - ", "  *  "), /path|sha256/u],
      ["preapply-duplicate-path", manifest(target, bytes) + manifest(target, bytes).replace("    -", "  -"), /duplicate|repeated/u],
      ["preapply-truncated-hash", manifest(target, bytes) + manifest(opaquePath, opaqueBytes, "a".repeat(63)).replace("    -", "  -"), /path|sha256/u],
      ["preapply-missing-sha256", manifest(target, bytes) + manifest(opaquePath, opaqueBytes).replace("sha256 ", "").replace("    -", "  -"), /path|sha256/u],
      ["preapply-unclosed-path", manifest(target, bytes) + manifest(opaquePath, opaqueBytes).replace(`${opaquePath}\``, opaquePath).replace("    -", "  -"), /path|sha256/u],
      ["preapply-fence-without-path", good.replace(`    - \`${target}\` sha256 \`${hash(bytes)}\`\n`, ""), /path/u],
      ["preapply-path-without-fence", manifest(target, bytes).replace(/```text\n[\s\S]*?```\n/u, ""), /fence/u],
      ["preapply-indented-fence", good.replaceAll("```", " ```"), /column|indent/u],
      ["preapply-four-space-fence", good.replaceAll("```", "    ```"), /column|indent/u],
      ["preapply-multiple-candidates", good + "  - Предприменение:\n" + good, /multiple/u],
    ]) await t.test(name, () => { setSpec(value); refusal(pattern); });
    await t.test("preapply-dirty-tree", () => { setSpec(good); const dirty = path.join(worktree, "dirty"); write(dirty, "dirty"); refusal(/dirty/u); fs.unlinkSync(dirty); });
    await t.test("preapply-conflicting-file-parent", () => {
      const prefix = ".agents/new-file", child = prefix + "/child";
      const value = good + manifest(prefix, "one\n") + manifest(child, "two\n");
      setSpec(value); refusal(/regular|parent/u);
      assert.equal(fs.existsSync(path.join(worktree, prefix)), false);
    });
    await t.test("preapply-paused-launch-no-commit", () => { setSpec(good); atomicJson(path.join(root, "control.json"), { state: "paused", halt: true }); try { refusal(/halt|paused/u); } finally { git(worktree, "reset", "--hard", base); atomicJson(path.join(root, "control.json"), { state: "active", halt: false }); } });
    await t.test("preapply-late-refusal-rolls-back-commit-and-ledger", () => {
      setSpec(good); const log = path.join(root, "logs/MONO-997-mono-deliver-a1.jsonl"); write(log, "existing log fixture\n");
      try { refusal(/EEXIST/u); assert.equal(fs.readFileSync(path.join(root, "ledger.md"), "utf8").includes("PREAPPLY"), false); }
      finally { fs.unlinkSync(log); fs.rmSync(path.join(root, "ledger.md"), { force: true }); }
    });
    await t.test("preapply-late-refusal-preserves-existing-ignored-bytes", () => {
      const name = ".agents/ignored.txt", original = "existing local ignored bytes\n", replacement = "approved replacement\n";
      const value = good + manifest(name, replacement);
      const file = path.join(worktree, name), log = path.join(root, "logs/MONO-997-mono-deliver-a1.jsonl"); write(file, original); write(log, "existing log fixture\n");
      try { setSpec(value); refusal(/EEXIST/u); assert.equal(fs.readFileSync(file, "utf8"), original); }
      finally { fs.unlinkSync(log); fs.rmSync(file, { force: true }); fs.rmSync(path.join(root, "ledger.md"), { force: true }); }
    });
    await t.test("preapply-transformed-staging-no-mutation", () => {
      const name = ".agents/filtered.txt", raw = "$Id: expanded-token $\n";
      const value = good + manifest(name, raw);
      try { setSpec(value); refusal(/staged|blob|transform/u);
        assert.equal(fs.existsSync(path.join(worktree, name)), false); assert.equal(git(worktree, "status", "--porcelain"), "");
      } finally { git(worktree, "reset", "--hard", base); atomicJson(path.join(root, "workers.json"), {}); }
    });
    await t.test("preapply-symlink", () => {
      const link = path.join(worktree, ".agents/link"); fs.symlinkSync(config, link); git(worktree, "add", ".agents/link"); git(worktree, "commit", "-m", "link fixture");
      const linkHead = git(worktree, "rev-parse", "HEAD"); setSpec(manifest(".agents/link", bytes));
      const result = run(process.execPath, [...options, "--preapply"]); assert.notEqual(result.status, 0); assert.match(result.stderr, /symbolic|symlink/u); assert.equal(git(worktree, "rev-parse", "HEAD"), linkHead);
      assert.equal(fs.existsSync(path.join(root, "attempts.json")), false); git(worktree, "reset", "--hard", base);
    });
    await t.test("preapply-AE12-commit-before-start-gate", async () => {
      setSpec(good); const launched = JSON.parse(pass(run(process.execPath, [...options, "--preapply"]))); pid = processes.track(launched.pid);
      const head = git(worktree, "rev-parse", "HEAD"); assert.notEqual(head, base);
      assert.equal(git(worktree, "log", "-1", "--format=%s"), "MONO-997: pre-applied .agents changes (orchestrator)");
      assert.equal(fs.readFileSync(path.join(worktree, target), "utf8"), bytes);
      assert.equal(fs.readFileSync(path.join(worktree, opaquePath), "utf8"), opaqueBytes);
      assert.match(pass(run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", launched.gateFile])), /gate start: pass/u);
      assert.ok(fs.readFileSync(launched.dispatchFile, "utf8").includes(head)); assert.ok(fs.readFileSync(launched.dispatchFile, "utf8").includes(hash(bytes)));
      assert.ok(fs.readFileSync(path.join(root, "ledger.md"), "utf8").includes(`PREAPPLY MONO-997 ${head} per mandate ${input.mandate}`));
      assert.ok(fs.readFileSync(path.join(launched.snapshot, "issue-MONO-997.md"), "utf8").endsWith(`# Предприменение\n${good}`));
      await processes.stop(pid); pid = null; atomicJson(path.join(root, "workers.json"), {});
      // Idempotence is observed even when a later dispatch refusal prevents another worker.
      atomicJson(path.join(root, "control.json"), { state: "paused", halt: true });
      const retry = run(process.execPath, [...options, "--preapply"]); assert.notEqual(retry.status, 0); assert.equal(git(worktree, "rev-parse", "HEAD"), head);
      assert.equal(fs.readFileSync(path.join(root, "ledger.md"), "utf8").split("PREAPPLY").length - 1, 1);
      fs.writeFileSync(path.join(root, "ledger.md"), "");
      atomicJson(path.join(root, "control.json"), { state: "active", halt: false });
      const recovered = JSON.parse(pass(run(process.execPath, [...options, "--preapply"]))); pid = processes.track(recovered.pid);
      assert.equal(git(worktree, "rev-parse", "HEAD"), head);
      assert.ok(fs.readFileSync(path.join(root, "ledger.md"), "utf8").includes(`PREAPPLY MONO-997 ${head} per mandate ${input.mandate}`));
      await processes.stop(pid); pid = null; atomicJson(path.join(root, "workers.json"), {});
    });
    await t.test("preapply-repaired-manifest-new-commit", async () => {
      const previous = git(worktree, "rev-parse", "HEAD"), repairedBytes = bytes.replace("AE12 applied", "AE12 repaired");
      const repaired = good.replace(hash(bytes), hash(repairedBytes)).replace(bytes, repairedBytes);
      setSpec(repaired); const launched = JSON.parse(pass(run(process.execPath, [...options, "--preapply"]))); pid = processes.track(launched.pid);
      const repairedHead = git(worktree, "rev-parse", "HEAD"); assert.notEqual(repairedHead, previous);
      assert.equal(fs.readFileSync(path.join(worktree, target), "utf8"), repairedBytes);
      await processes.stop(pid); pid = null; atomicJson(path.join(root, "workers.json"), {});
      const retry = JSON.parse(pass(run(process.execPath, [...options, "--preapply"]))); pid = processes.track(retry.pid);
      assert.equal(git(worktree, "rev-parse", "HEAD"), repairedHead);
      await processes.stop(pid); pid = null; atomicJson(path.join(root, "workers.json"), {});
    });
    await t.test("preapply-full-materialized-snapshot-retry", async () => {
      const launched = JSON.parse(pass(run(process.execPath, [...options, "--preapply", "--full-snapshot"]))); pid = processes.track(launched.pid);
      const head = git(worktree, "rev-parse", "HEAD"), materialized = fs.readFileSync(path.join(launched.snapshot, "issue-MONO-997.md"), "utf8");
      await processes.stop(pid); pid = null; atomicJson(path.join(root, "workers.json"), {});
      const retryOptions = [...options]; retryOptions[retryOptions.indexOf("--snapshot") + 1] = launched.snapshot;
      const retried = JSON.parse(pass(run(process.execPath, [...retryOptions, "--preapply", "--full-snapshot"]))); pid = processes.track(retried.pid);
      assert.equal(git(worktree, "rev-parse", "HEAD"), head);
      assert.equal(fs.readFileSync(path.join(retried.snapshot, "issue-MONO-997.md"), "utf8"), materialized);
      await processes.stop(pid); pid = null; atomicJson(path.join(root, "workers.json"), {});
      const attempts = fs.readFileSync(path.join(root, "attempts.json"), "utf8");
      write(path.join(retried.snapshot, "issue-MONO-997.md"), materialized.replace("AE12 repaired", "AE12 forged"));
      retryOptions[retryOptions.indexOf("--snapshot") + 1] = retried.snapshot;
      const refused = run(process.execPath, [...retryOptions, "--preapply", "--full-snapshot"]);
      assert.notEqual(refused.status, 0); assert.match(refused.stderr, /sha256|materialized/u);
      assert.equal(git(worktree, "rev-parse", "HEAD"), head); assert.equal(fs.readFileSync(path.join(root, "attempts.json"), "utf8"), attempts);
      const approvedBytes = bytes.replace("AE12 applied", "AE12 repaired"), forgedBytes = approvedBytes.replace("AE12 repaired", "AE12 forged");
      write(path.join(retried.snapshot, "issue-MONO-997.md"), materialized.replace(approvedBytes, forgedBytes).replace(hash(approvedBytes), hash(forgedBytes)));
      const divergent = run(process.execPath, [...retryOptions, "--preapply", "--full-snapshot"]);
      assert.notEqual(divergent.status, 0); assert.match(divergent.stderr, /materialized.*differs/u);
      assert.equal(git(worktree, "rev-parse", "HEAD"), head); assert.equal(fs.readFileSync(path.join(root, "attempts.json"), "utf8"), attempts);
    });
    await t.test("preapply-launch-lock-covers-commit-through-registration", async () => {
      const gate = path.join(runtime, "gate.mjs"), original = fs.readFileSync(gate, "utf8"), backup = path.join(runtime, "gate-original.mjs"), probe = path.join(scratch, "competing-launch.json");
      write(backup, original);
      write(gate, `import fs from "node:fs"; import path from "node:path"; import {spawnSync,execFileSync} from "node:child_process"; import {isMain} from "./runtime.mjs"; export {startGate,reviewEnvironment} from "./gate-original.mjs";
if(isMain(import.meta.url)){ const args=process.argv.slice(2), request=path.join(path.dirname(args[args.indexOf("--request")+1]),"spawn.json"); const other=spawnSync(process.execPath,[${JSON.stringify(path.join(runtime, "orchestrator/spawn.mjs"))},"--request",request],{encoding:"utf8"}); fs.writeFileSync(${JSON.stringify(probe)},JSON.stringify({status:other.status,stderr:other.stderr})); if(other.status===0)process.kill(JSON.parse(other.stdout).pid,"SIGTERM"); process.stdout.write(execFileSync(process.execPath,[${JSON.stringify(backup)},...args],{encoding:"utf8"})); }
`);
      try {
        const launched = JSON.parse(pass(run(process.execPath, [...options, "--preapply"]))); pid = processes.track(launched.pid);
        const other = readJson(probe); assert.notEqual(other.status, 0); assert.match(other.stderr, /operation locked/u);
        await processes.stop(pid); pid = null; atomicJson(path.join(root, "workers.json"), {});
      } finally { write(gate, original); fs.rmSync(backup, { force: true }); }
    });
    await t.test("preapply-issue-only-direct-section", async () => {
      const ignored = ".agents/ignored.txt", ignoredBytes = "approved ignored target\n";
      const ignoredManifest = good + manifest(ignored, ignoredBytes);
      const laneBody = body + "# Предприменение\n" + ignoredManifest;
      const laneSnapshot = path.join(scratch, "issue-only-snapshot");
      write(path.join(laneSnapshot, "approval.md"), "Approved issue-only AE12.");
      write(path.join(laneSnapshot, "issue-MONO-996.md"), laneBody);
      write(path.join(laneSnapshot, "issue-only.json"), { marker: "fixture", label: "issue-only", fingerprint: hash(laneBody), config: "fixture enabled", ownerApproval: "approved",
        seam: { package_kind: "issue-only", lifecycle_state_entity: "issue", behavioral_oracle: "AE12", risk_class: "standard", approval_status: "approved-fresh" } });
      atomicJson(path.join(root, "control.json"), { state: "active", halt: false });
      const laneOptions = [...options]; laneOptions[laneOptions.indexOf("--issue") + 1] = "MONO-996";
      laneOptions[laneOptions.indexOf("--snapshot") + 1] = laneSnapshot;
      const launched = JSON.parse(pass(run(process.execPath, [...laneOptions, "--preapply"]))); pid = processes.track(launched.pid);
      assert.equal(fs.readFileSync(path.join(launched.snapshot, "issue-MONO-996.md"), "utf8"), laneBody);
      assert.equal(fs.readFileSync(path.join(repo, ".worktrees/MONO-996", target), "utf8"), bytes);
      assert.equal(git(path.join(repo, ".worktrees/MONO-996"), "show", `HEAD:${ignored}`), ignoredBytes.trimEnd());
      await processes.stop(pid); pid = null;
    });
    await t.test("preapply-requires-new-dispatch: resume carries text only", async () => {
      const { resumeWorker } = await import("./orchestrator/launch.mjs");
      await assert.rejects(resumeWorker({ root, issue: "MONO-997", resumeFile: path.join(root, "absent.md"), preapply: true }), /a risk or grant change is a new attempt/u);
    });
  } finally {
    processes.track(pid); processes.registry(path.join(root, "workers.json"));
    try { await processes.cleanup(); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
});


test("preapply-literal-pathspec: only the literal approved filename enters the commit", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "mono-preapply-literal-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  try {
    git("init", "-b", "main"); write(path.join(repo, ".gitignore"), ".agents/*\n");
    git("add", ".gitignore"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
    git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    const name = ".agents/literal*", unicode = ".agents/байты.txt", bytes = "approved literal filename\n", extra = ".agents/literal-extra";
    write(path.join(repo, extra), "outside manifest\n");
    const manifest = { entries: [name, unicode].map(path => ({ path, bytes, sha256: createHash("sha256").update(bytes).digest("hex") })) };
    const result = applyPreapply(repo, "MONO-994", manifest);
    assert.deepEqual(git("diff-tree", "--no-commit-id", "--name-only", "-r", "-z", result.commit).split("\0").filter(Boolean), [name, unicode]);
    assert.equal(fs.readFileSync(path.join(repo, extra), "utf8"), "outside manifest\n");
    assert.equal(applyPreapply(repo, "MONO-994", manifest).created, false);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test("preapply-current-head-missing-ignored-file: reapply instead of reusing ancestor", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "mono-preapply-head-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  try {
    git("init", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    write(path.join(repo, ".gitignore"), ".agents/*\n"); git("add", ".gitignore"); git("commit", "-m", "fixture");
    const name = ".agents/ignored.txt", bytes = "approved bytes\n", manifest = { entries: [{ path: name, bytes, sha256: createHash("sha256").update(bytes).digest("hex") }] };
    const first = applyPreapply(repo, "MONO-993", manifest);
    git("rm", "--cached", "--", name); git("commit", "-m", "remove from current revision");
    assert.equal(fs.readFileSync(path.join(repo, name), "utf8"), bytes); assert.equal(git("status", "--porcelain"), "");
    const reapplied = applyPreapply(repo, "MONO-993", manifest); assert.equal(reapplied.created, true); assert.notEqual(reapplied.commit, first.commit);
    assert.equal(git("show", `HEAD:${name}`), bytes.trimEnd());
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test("preapply-covered-unit-selection: unrelated approved units are not dispatch candidates", () => {
  const bytes = "fixture\n", hash = createHash("sha256").update(bytes).digest("hex");
  const manifest = `  - Предприменение:\n    - \`.agents/fixture\` sha256 \`${hash}\`\n\`\`\`text\n${bytes}\`\`\`\n`;
  const issue = "# Покрытие PRD/Spec\nU7\n", prd = "## Кратко\nFixture\n";
  assert.equal(preapplyManifest(issue, prd, `- U7. Current\n- U8. Other\n${manifest}`, false), null);
  const selected = preapplyManifest(issue, prd, `- U7. Current\n${manifest}- U8. Other\n${manifest}`, false);
  assert.deepEqual(selected.entries.map(entry => entry.path), [".agents/fixture"]);
});


test("preapply-linear-serialized: bytes survive materialization and U12 extraction", () => {
  const spec = fixture("preapply-linear-serialized.md");
  const issue = "# Покрытие PRD/Spec\nU7\n", prd = "## Кратко\nFixture\n";
  const bytes = '{\n  "fixture": "neutral",\n  "enabled": true\n}\n';
  const expected = [{ path: ".agents/fixture.json", sha256: createHash("sha256").update(bytes).digest("hex"), bytes }];
  const parsed = preapplyManifest(issue, prd, spec, false);
  assert.deepEqual(parsed.entries, expected);
  assert.equal(parsed.materialized, "# Предприменение\n" + spec.slice(spec.indexOf("  * Предприменение:\n") + "  * Предприменение:\n".length));
  assert.deepEqual(preapplyManifest(parsed.materialized, null, null, true).entries, expected);
  const repeated = preapplyManifest(issue + parsed.materialized, prd, spec, false);
  assert.equal(repeated.alreadyMaterialized, true);
  assert.equal(repeated.materialized, parsed.materialized);
  const extracted = extractSnapshot(issue, prd, spec);
  assert.equal(extracted.spec, spec);
  assert.deepEqual(preapplyManifest(issue, prd, extracted.spec, false).entries, expected);
});

test("preapply-ordinary-sibling-boundary: notes after the manifest remain outside it", () => {
  const spec = fixture("preapply-linear-serialized.md");
  const issue = "# Покрытие PRD/Spec\nU7\n", prd = "## Кратко\nFixture\n";
  const expected = preapplyManifest(issue, prd, spec, false);
  for (const marker of ["-", "*"]) {
    const parsed = preapplyManifest(issue, prd, spec + `  ${marker} Verification notes\n`, false);
    assert.deepEqual(parsed, expected);
  }
});

test("preapply-whitespace-blank-lines: surrounding whitespace and raw content survive", () => {
  const spec = fixture("preapply-linear-serialized.md").replaceAll("\n\n", "\n \t \n");
  const issue = "# Покрытие PRD/Spec\nU7\n", prd = "## Кратко\nFixture\n";
  const bytes = '{\n  "fixture": "neutral",\n  "enabled": true\n}\n';
  const parsed = preapplyManifest(issue, prd, spec, false);
  assert.deepEqual(parsed.entries, [{ path: ".agents/fixture.json", sha256: createHash("sha256").update(bytes).digest("hex"), bytes }]);
  assert.ok(parsed.materialized.includes("\n \t \n"));
  assert.deepEqual(preapplyManifest(parsed.materialized, null, null, true).entries, parsed.entries);
  assert.equal(preapplyManifest(issue + parsed.materialized, prd, spec, false).alreadyMaterialized, true);
  assert.equal(extractSnapshot(issue, prd, spec).spec, spec);
});

test('collection admission: registered attempts require pins for reads and collection', async () => {
  await collectorAttentionFixture(async f => {
    const request = f.request(1); delete request.pins;
    for (const collect of [false, true]) assert.throws(() => checkCollectionRequest({ ...request, collect }), /mismatch: pins;/);
    const { refusal } = await admitCollection(f.options.root, { issue: f.options.issue, attempt: 1, request });
    assert.match(refusal, /mismatch: pins/);
  });
});

test('collection admission: unregistered and unbound direct collection cannot skip admission',async()=>{
  await collectorAttentionFixture(async f=>{
    const request=f.request(1),registry=readJson(f.registry); delete request.pins;
    delete registry['MONO-999'].pins;atomicJson(f.registry,registry);
    assert.equal(checkCollectionRequest(request),null);
    assert.throws(()=>checkCollectionRequest({...request,collect:true}),/admission/);
    fs.unlinkSync(f.registry);
    assert.equal(checkCollectionRequest(request),null);
    assert.throws(()=>checkCollectionRequest({...request,collect:true}),/admission/);
  });
});

test('collection admission: direct collect:true needs the collector admission bound to this request; repeated execution cannot reuse it',async()=>{
  await collectorAttentionFixture(async f=>{
    const request=f.request(1);
    assert.doesNotThrow(()=>checkCollectionRequest(request));
    assert.throws(()=>checkCollectionRequest({...request,collect:true}),/admission/);
    await admitCollection(f.options.root,{issue:f.options.issue,attempt:1,request});
    assert.doesNotThrow(()=>checkCollectionRequest({...request,collect:true}));
    assert.throws(()=>checkCollectionRequest({...request,workerVerification:{head:request.head,exitCode:1},collect:true}),/mismatch: admission/,
      'a replaced request under the admitted collectionId is refused, also for collect:false reads');
    assert.throws(()=>checkCollectionRequest({...request,head:'e'.repeat(40),collect:true}),/collectionId/);
    await f.signedHistory(request);
    assert.throws(()=>checkCollectionRequest({...request,collect:true}),/already executed/);
    assert.doesNotThrow(()=>checkCollectionRequest(request));
  });
});

async function collectionRetryFixture(mode, run) {
  await collectorAttentionFixture(async f => {
    const request = f.request(1), round = { issue: f.options.issue, attempt: 1, request };
    const template = await f.signedHistory(request), envelope = readJson(template.receipt);
    fs.unlinkSync(template.receipt);
    const stateFile = path.join(f.scratch, 'retry-state.json');
    const script = path.join(request.skillsRoot, 'scripts/gate.mjs');
    const startFile = path.join(f.options.root, 'consumed/MONO-999-a1/collections', request.collectionId + '.json');
    const runtime = new URL('./runtime.mjs', import.meta.url).href;
    atomicJson(stateFile, { collections: 0, reconciles: 0 });
    f.entry.collectionRetries = 1;
    atomicJson(f.registry, { [f.options.issue]: f.entry });
    write(script, `import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {atomicJson,readJson,withLock} from ${JSON.stringify(runtime)};
const q=readJson(process.argv.at(-1)),stateFile=${JSON.stringify(stateFile)},mode=${JSON.stringify(mode)};
const state=readJson(stateFile);state[q.collect?'collections':'reconciles']++;atomicJson(stateFile,state);
if(!q.collect)console.log('gate preflight: '+(mode==='signed-failure'?'fail: provider unavailable':'pass: reconciled'));
else await withLock(path.join(q.evidenceRoot,q.head+'.collect.lock'),async()=>{
 if(mode==='crash-always'||(mode==='crash-once'&&state.collections===1))process.exit(78);
 if(mode==='hang'){setInterval(()=>{},1000);await new Promise(()=>{});}
 if(mode==='orphan'||mode==='orphan-pipe'){
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:mode==='orphan-pipe'?['ignore','inherit','inherit']:'ignore'});
  child.unref();atomicJson(stateFile,{...state,descendant:child.pid,group:process.pid});
 }
 const envelope=${JSON.stringify(envelope)};
 atomicJson(${JSON.stringify(template.receipt)},envelope);console.log('gate preflight: '+(mode==='signed-failure'?'fail: provider unavailable':'pass: collected'));
});
`);
    // Model host process telemetry inside the worker sandbox. Group signals and
    // fixture processes are real; only the denied ps query is replaced.
    const ps = path.join(f.scratch, 'bin/ps');
    write(ps, `#!${process.execPath}
const fs=require('node:fs'),{execFileSync}=require('node:child_process'),state=JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}));
if(!process.argv.includes('-axo')){console.log('fixture-start');process.exit();}
const live=pid=>{try{
 if(state.probeError)throw Object.assign(new Error('fixture telemetry '+state.probeError),{code:state.probeError});
 process.kill(pid,0);return true;
}catch(error){if(error.code==='ESRCH')return false;throw error}};
const file=${JSON.stringify(startFile)},gate=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).gate:null;
for(const row of [gate, state.descendant?{pid:state.descendant,processGroup:state.group}:null].filter(Boolean))
 if(live(row.pid))console.log(row.pid+' 1 '+row.processGroup+' S fixture-start');
if(process.argv.at(-1)==='pid=,ppid=,pgid=,stat=,lstart='){
 const group=Number(execFileSync('python3',['-I','-S','-c','import os;print(os.getpgrp())'],{encoding:'utf8'}).trim());
 console.log(process.pid+' '+process.ppid+' '+group+' S fixture-start');
}
`);
    const admit = async () => (await admitCollection(f.options.root, round)).admission;
    const started = async launches => { const admission = await admit();
      atomicJson(startFile, { collectionId: admission.collectionId, requestDigest: admission.requestDigest, launches, startedAt: new Date().toISOString() }); };
    const publish = () => atomicJson(f.roundFile, round);
    const result = () => readLedger(f.options.root, f.options.issue, 1)[0]?.result ?? null;
    await run({ ...f, request, round, publish, stateFile, startFile, started, admit, result, template });
  });
}

test('retry-normal-completion: one collection and one collect:false reconciliation record a done result', async () => {
  await collectionRetryFixture('complete', async f => {
    f.publish(); await f.poll();
    assert.deepEqual(readJson(f.stateFile), { collections: 1, reconciles: 1 });
    assert.equal(f.result().status, 'done'); assert.equal(f.result().receipt, f.template.receipt);
    assert.doesNotMatch(fs.readFileSync(path.join(f.options.root, 'reports/MONO-999-collector-a1.log'), 'utf8'), /retry refused|attention:/);
  });
});

test('retry-crash-before-receipt: retry uses the same admission and collectionId; late history wins', async () => {
  await collectionRetryFixture('crash-once', async f => {
    f.publish(); await f.poll();
    assert.equal(readJson(f.stateFile).collections, 2); assert.equal(readJson(f.startFile).launches, 2);
    assert.equal(f.result().receipt, f.template.receipt);
    const ledger = readLedger(f.options.root, f.options.issue, 1); await f.poll();
    assert.deepEqual(readLedger(f.options.root, f.options.issue, 1), ledger);
    assert.equal(readJson(f.stateFile).collections, 2);
  });
});
test('retry-provider-failure: a failure receipt is reconciled without another collection', async () => {
  await collectionRetryFixture('signed-failure', async f => {
    f.publish(); await f.poll();
    assert.equal(readJson(f.stateFile).collections, 1);
    assert.equal(f.result().status, 'done'); assert.match(f.result().gate, /fail: provider unavailable/);
    const bytes = fs.readFileSync(f.template.receipt); await f.poll();
    assert.deepEqual(fs.readFileSync(f.template.receipt), bytes);
  });
});
test('retry-budget-after-restart: persisted launches cannot refill; a late receipt is never collected again', async () => {
  await collectionRetryFixture('crash-always', async f => {
    f.publish(); await f.started(2);
    const module = new URL('./orchestrator/collector.mjs', import.meta.url).href;
    pass(spawnSync(process.execPath, ['--input-type=module', '-e', `const {collectOnce}=await import(${JSON.stringify(module)});await collectOnce(${JSON.stringify(f.options)});`], { encoding: 'utf8' }));
    assert.equal(readJson(f.stateFile).collections, 0);
    assert.equal(f.result().status, 'failed'); assert.match(f.result().reason, /retries exhausted/);
    assert.equal(readJson(f.startFile).launches, 2);
    await f.signedHistory(f.request); await f.poll();
    assert.equal(readJson(f.stateFile).collections, 0, 'late first receipt is never executed again');
  });
});
test('retry-live-descendant: a live prior group keeps the round in flight and blocks every retry', async () => {
  await collectionRetryFixture('crash-once', async f => {
    f.publish(); await f.started(1);
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    const closed = new Promise(resolve => child.once('close', resolve));
    try {
      atomicJson(f.startFile, { ...readJson(f.startFile), gate: { pid: child.pid, procStart: 'fixture-start', processGroup: child.pid } });
      await f.poll(); assert.equal(readJson(f.stateFile).collections, 0);
      assert.equal(f.result(), null, 'a live gate may still write its receipt');
      assert.match(f.lines().at(-1), /descendants live/);
    } finally { child.kill('SIGTERM'); await closed; }
  });
});
for (const probeError of ['EPERM', 'unavailable']) test(`retry-unverified-group: ${probeError} telemetry refuses a relaunch`, async () => {
  await collectionRetryFixture('crash-once', async f => {
    f.publish(); await f.started(1);
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: true });
    const closed = new Promise(resolve => child.once('close', resolve));
    try {
      atomicJson(f.startFile, { ...readJson(f.startFile), gate: { pid: child.pid, procStart: 'fixture-start', processGroup: child.pid } });
      atomicJson(f.stateFile, { ...readJson(f.stateFile), probeError });
      await f.poll();
      assert.equal(readJson(f.stateFile).collections, 0);
      assert.equal(readJson(f.startFile).launches, 1);
      assert.equal(f.result(), null, 'unknown telemetry keeps the round in flight, never failed');
      assert.match(f.lines().at(-1), /previous gate telemetry unavailable; retry refused/);
    } finally { child.kill('SIGKILL'); await closed; }
  });
});
test('retry-stuck-gate: a gate stuck past the safety ceiling is stopped and the round fails', async () => {
  await collectionRetryFixture('hang', async f => {
    f.entry.collectionRetries = 0; atomicJson(f.registry, { [f.options.issue]: f.entry });
    const { collectOnce } = await import('./orchestrator/collector.mjs');
    f.publish(); await collectOnce({ ...f.options, gateStuckMs: 800 });
    assert.equal(f.result().status, 'failed'); assert.match(f.result().reason, /retries exhausted/);
    assert.match(fs.readFileSync(path.join(f.options.root, 'reports/MONO-999-collector-a1.log'), 'utf8'), /gate stuck past the safety ceiling|gate terminated without an answer/);
    const gate = readJson(f.startFile).gate; assert.throws(() => process.kill(-gate.processGroup, 0), { code: 'ESRCH' });
  });
});
test('retry-stuck-gate-collector-death: the gate holds the wall-clock ceiling itself after its collector dies', async () => {
  await collectionRetryFixture('hang', async f => {
    f.entry.collectionRetries = 0; atomicJson(f.registry, { [f.options.issue]: f.entry }); f.publish();
    const module = new URL('./orchestrator/collector.mjs', import.meta.url).href;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', `const {collectOnce}=await import(${JSON.stringify(module)});await collectOnce(${JSON.stringify({ ...f.options, gateStuckMs: 2500 })});`], { stdio: 'ignore', detached: true });
    const closed = new Promise(resolve => parent.once('close', resolve));
    const live = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    let gate;
    try {
      for (let i = 0; i < 160 && !gate; i++) { await new Promise(r => setTimeout(r, 50)); try { gate = readJson(f.startFile).gate; } catch {} }
      assert.ok(gate, 'the gate registers before the collector dies');
      parent.kill('SIGKILL'); await closed;
      assert.equal(live(-gate.processGroup), true, 'the stuck gate outlives its collector until the ceiling');
      for (let i = 0; i < 120 && live(-gate.processGroup); i++) await new Promise(r => setTimeout(r, 50));
      assert.equal(live(-gate.processGroup), false, 'the gate group ends at its own ceiling');
    } finally { parent.kill('SIGKILL'); if (gate && live(-gate.processGroup)) process.kill(-gate.processGroup, 'SIGKILL'); }
  });
});
for (const mode of ['orphan', 'orphan-pipe']) test(`retry-${mode}-group: a descendant left by a finished gate is stopped before reconciliation, even holding its pipes`, async () => {
  await collectionRetryFixture(mode, async f => {
    f.publish(); await f.poll();
    const { descendant } = readJson(f.stateFile);
    assert.ok(descendant); assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
    assert.equal(f.result().status, 'done');
  });
});

test('ship-bot-policy: launch pins decide the bots; an amended attempt is refused', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-ship-policy-'));
  const root = path.join(scratch, 'root'), issue = 'MONO-162', head = 'a'.repeat(40);
  const file = path.join(root, 'dispatch', `${issue}-a1`, 'pins.json');
  const pins = { root, worktree: scratch, workerWritableRoots: [scratch], shipBotChecks: ['Custom Review'] };
  const entry = { issue, worktree: scratch, attempt: 1, stage: 'mono-deliver', packVersion: 'test', surfaceRevision: 4, pins: { file } };
  try {
    atomicJson(file, pins); entry.pins.digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    atomicJson(path.join(root, 'workers.json'), { [issue]: entry });
    const request = { ...pins, pins: collectionPinsBinding(entry), head, collect: false, workerVerification: { head: head, exitCode: 0 }, collectionId: `preflight-collect:${head}:1` };
    assert.deepEqual(pinnedShipPolicy(request), { botChecks: ['Custom Review'], botUnavailable: null });
    atomicJson(path.join(root, 'workers.json'), { [issue]: { ...entry, pinsVersion: 1 } });
    assert.throws(() => pinnedShipPolicy(request), /pins versions no longer exist/);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});


test('ship-bot-policy: immutable attempt pins accept an empty bot list', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-no-bots-'));
  const root = path.join(scratch, 'root'), issue = 'MONO-162', head = 'a'.repeat(40);
  const file = path.join(root, 'dispatch', `${issue}-a1`, 'pins.json');
  const pins = { root, worktree: scratch, workerWritableRoots: [scratch], shipBotChecks: [] };
  try {
    atomicJson(file, pins);
    const binding = { file, digest: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
    atomicJson(path.join(root, 'workers.json'), { [issue]: { issue, worktree: scratch, attempt: 1, stage: 'mono-deliver', packVersion: 'test', surfaceRevision: 5, pins: binding } });
    assert.deepEqual(pinnedShipPolicy({ ...pins, pins: binding, head, collect: false, collectionId: `preflight-collect:${head}:1` }), { botChecks: [], botUnavailable: null });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
