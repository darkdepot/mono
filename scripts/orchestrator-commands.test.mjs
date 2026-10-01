import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { test } from "node:test";
import { extractSnapshot, references, section } from "./orchestrator/snapshot.mjs";
import { renderDispatch } from "./orchestrator/dispatch.mjs";
import { digest, readJson, atomicJson, withLock } from "./runtime.mjs";
import { publishPhase, validateConfirmation, confirmQueue } from "./delivery-state.mjs";
import { expandedWrite, effectivePins, admitCollection, collectionPinsBinding } from "./orchestrator/command-state.mjs";
import { acceptAck, acceptReport, acceptAmend } from "./orchestrator/accept.mjs";
import { reconcile } from "./orchestrator/linear-adapter.mjs";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = name => fs.readFileSync(path.join(checkout, "scripts/fixtures", name), "utf8");
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2)); };
const pass = result => { assert.equal(result.status, 0, result.stderr + result.stdout); return result.stdout.trim(); };
const issueFor = ids => `# Покрытие PRD/Spec\n${ids}\n`;

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

test("installed command workflow on scratch: refusals, dispatch, ack, sessions, admission and amend", async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-command-fixture-"));
  const skills = path.join(scratch, "skills"), root = path.join(scratch, "orchestrator"), repo = path.join(scratch, "repo"), bin = path.join(scratch, "bin"), temp = path.join(scratch, "worker-temp");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MONO_WORKFLOW_STATE_ROOT: path.join(scratch, "install-state"), MONO_WORKFLOW_KNOWN_ROOTS: skills };
  const run = (cmd, args, cwd = checkout) => spawnSync(cmd, args, { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const git = (...args) => pass(run("git", args, repo));
  let livePid;
  try {
    for (const directory of [repo, bin, temp, path.join(root, "reports")]) fs.mkdirSync(directory, { recursive: true });
    pass(run(process.execPath, ["scripts/install-local.mjs", "--skills-root", skills]));
    pass(run(process.execPath, ["scripts/install-local.mjs", "--skills-root", skills, "--check"]));
    const runtime = path.join(skills, ".mono-agent-workflow/scripts");
    for (const script of ["dispatch", "accept", "linear-adapter", "collector"]) pass(run(process.execPath, [path.join(runtime, `orchestrator/${script}.mjs`), "--help"]));
    const budget = JSON.parse(pass(run(process.execPath, [path.join(runtime, "read-budget.mjs"), "--json"])));
    // Dirty scratch installs add a six-byte provenance suffix per skill. It is
    // installer metadata, not a corpus change; clean committed installs are exact.
    const provenanceBytes = budget.files.filter(file => file.path.startsWith("skills/")).reduce((bytes, file) =>
      bytes + (fs.readFileSync(path.join(skills, file.path.slice(7)), "utf8").includes(" dirty. Do not edit manually. -->") ? 6 : 0), 0);
    assert.ok(budget.bytes - provenanceBytes <= 99_756, "worker corpus must not grow from the U12 baseline");
    write(path.join(bin, "codex"), '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"fixture-thread"}));setInterval(()=>{},1000);\n'); fs.chmodSync(path.join(bin, "codex"), 0o700);
    write(path.join(bin, "ps"), '#!/usr/bin/env node\nconsole.log("fixture-start");\n'); fs.chmodSync(path.join(bin, "ps"), 0o700);
    atomicJson(path.join(root, "control.json"), { state: "active", halt: false }); atomicJson(path.join(root, "workers.json"), {});
    git("init", "-b", "main");
    const origin = path.join(scratch, "origin.git"); pass(run("git", ["init", "--bare", origin])); git("remote", "add", "origin", origin);
    const config = path.join(repo, ".agents/mono-workflow.config.json");
    write(config, { projectName: "Fixture", orchestration: { transport: "codex-cli", dispatch: { product: "fixture", evidenceRoot: path.join(scratch, "evidence"), openDecisions: 0,
      verification: { command: "node", args: ["scripts/verify.mjs"] }, lifecycle_moves: [{ entity: "issue", key: "MONO-999", from: "Backlog", to: "In Progress" }] } } });
    write(path.join(repo, ".gitignore"), ".worktrees/\n.orchestrator/\n"); git("add", "."); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"); git("push", "origin", "main");
    const snapshot = path.join(scratch, "snapshot"), writable = path.join(scratch, "writable.json"); write(writable, [temp]);
    const body = "# MONO-999 — fixture\n# Что сделать\nImplement commands.\n# Готовность агента\nAFK\n# Покрытие PRD/Spec\nR4, U5\n# Как проверить\n1. node scripts/verify.mjs\n# Ключевые контракты\nNo direct writes.\n# Что не входит\nDeploy.\nРиск: standard\n";
    write(path.join(snapshot, "issue-MONO-999.md"), body); write(path.join(snapshot, "approval.md"), "Approved package and start; current project Delivery.");
    write(path.join(snapshot, "project-brief.md"), "# Fixture\nBrief\n"); write(path.join(snapshot, "prd.md"), fixture("cheap-waves-prd.md")); write(path.join(snapshot, "tech-spec.md"), fixture("cheap-waves-spec.md"));
    const command = path.join(runtime, "orchestrator/dispatch.mjs"), options = ["--issue", "MONO-999", "--root", root, "--config", config, "--snapshot", snapshot, "--handshake", "wait", "--worker-writable-roots", writable];
    // A pre-spawn start-gate refusal leaves no attempt registration.
    const worktree = path.join(repo, ".worktrees/MONO-999"); git("worktree", "add", "-b", "mono/mono-999", worktree, "origin/main"); write(path.join(worktree, "dirty"), "dirty");
    const refused = run(process.execPath, [command, ...options, "--profile", "full"]); assert.notEqual(refused.status, 0); assert.match(refused.stderr, /dirty/u);
    assert.equal(fs.existsSync(path.join(root, "attempts.json")), false); assert.deepEqual(readJson(path.join(root, "workers.json")), {});
    await t.test("dispatch-refused-snapshot-rebuild: each retry contains only its current composition", () => {
      const preparedSnapshot = path.join(root, "dispatch/MONO-999-a1/snapshot");
      const names = () => fs.readdirSync(preparedSnapshot).sort();
      assert.deepEqual(names(), ["approval.md", "issue-MONO-999.md", "prd.md", "project-brief.md", "tech-spec.md"]);
      const retry = (source, profile) => {
        const current = [...options]; current[current.indexOf("--snapshot") + 1] = source;
        const result = run(process.execPath, [command, ...current, "--profile", profile]);
        assert.notEqual(result.status, 0); assert.match(result.stderr, /dirty/u);
        assert.equal(fs.existsSync(path.join(root, "attempts.json")), false); assert.deepEqual(readJson(path.join(root, "workers.json")), {});
      };
      retry(preparedSnapshot, "short"); // A full generated snapshot may itself be the next input.
      assert.deepEqual(names(), ["approval.md", "issue-MONO-999.md", "prd-extract.md", "project-brief.md", "spec-extract.md"]);
      retry(snapshot, "full");
      assert.deepEqual(names(), ["approval.md", "issue-MONO-999.md", "prd.md", "project-brief.md", "tech-spec.md"]);
      const laneSource = path.join(scratch, "refused-lane-snapshot");
      write(path.join(laneSource, "issue-MONO-999.md"), body); write(path.join(laneSource, "approval.md"), "Approved lane fixture.");
      write(path.join(laneSource, "issue-only.json"), { marker: "fixture marker", label: "issue-only", fingerprint: createHash("sha256").update(body).digest("hex"),
        config: "enabled=true; ownerPrincipal=fixture", ownerApproval: "approved fixture fingerprint",
        seam: { package_kind: "issue-only", lifecycle_state_entity: "issue", behavioral_oracle: "fixture oracle", risk_class: "standard", approval_status: "approved-fresh" } });
      retry(laneSource, "short"); assert.deepEqual(names(), ["approval.md", "issue-MONO-999.md", "issue-only.json"]);
      retry(snapshot, "short");
      assert.deepEqual(names(), ["approval.md", "issue-MONO-999.md", "prd-extract.md", "project-brief.md", "spec-extract.md"]);
    });
    fs.unlinkSync(path.join(worktree, "dirty"));
    write(path.join(snapshot, "issue-MONO-999.md"), body.replace("R4, U5", "R99"));
    assert.match(run(process.execPath, [command, ...options]).stderr, /unknown.*R99/u); assert.equal(fs.existsSync(path.join(root, "attempts.json")), false);
    write(path.join(snapshot, "issue-MONO-999.md"), body);
    const laneRoot = path.join(scratch, "lane-orchestrator"), laneSnapshot = path.join(scratch, "lane-snapshot");
    fs.mkdirSync(path.join(laneRoot, "reports"), { recursive: true });
    atomicJson(path.join(laneRoot, "control.json"), { state: "active", halt: false }); atomicJson(path.join(laneRoot, "workers.json"), {});
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
    const launchDataset = path.join(scratch, "evidence/datasets/launch-fixture.md"); write(launchDataset, "Approved launch decisions.\n");
    const laneLaunch = JSON.parse(pass(run(process.execPath, [command, ...laneOptions, "--review-dataset", launchDataset, "--review-dataset-version", "7"]))); livePid = laneLaunch.pid;
    const lanePins = readJson(laneLaunch.pins.file);
    assert.equal(lanePins.reviewDataset, launchDataset); assert.equal(lanePins.reviewDatasetVersion, 7);
    assert.equal(lanePins.reviewDatasetDigest, createHash("sha256").update(fs.readFileSync(launchDataset)).digest("hex"));
    const laneRendered = fs.readFileSync(laneLaunch.dispatchFile, "utf8");
    assert.ok(laneRendered.includes(fingerprint));
    assert.equal(fs.existsSync(path.join(laneLaunch.snapshot, "prd.md")), false); assert.equal(fs.existsSync(path.join(laneLaunch.snapshot, "tech-spec.md")), false);
    process.kill(livePid, "SIGTERM"); livePid = undefined;
    const launched = JSON.parse(pass(run(process.execPath, [command, ...options]))); livePid = launched.pid;
    const registry = readJson(path.join(root, "workers.json")), entry = registry["MONO-999"];
    assert.equal(entry.attempt, 1); assert.equal(entry.pinsVersion, 0); assert.equal(entry.profile, "short"); assert.equal(entry.handshake, "wait");
    assert.equal(entry.pins.digest, (await import("./orchestrator/command-state.mjs")).sha256File(entry.pins.file));
    const launchedPins = readJson(entry.pins.file);
    assert.equal(launchedPins.reviewDataset, null); assert.equal(launchedPins.reviewDatasetVersion, 0); assert.equal(launchedPins.reviewDatasetDigest, null);
    assert.equal(readJson(launched.gateFile).worktree, worktree); assert.deepEqual(readJson(launched.spawnFile).gates, entry.gates);
    assert.ok(!fs.readFileSync(launched.dispatchFile, "utf8").includes("{{")); assert.match(fs.readFileSync(path.join(root, "ledger.md"), "utf8"), /\d{4}-\d\d-\d\dT.*Z DISPATCHED MONO-999/u);
    const rendered = fs.readFileSync(launched.dispatchFile, "utf8");
    assert.ok(rendered.includes(`--ack '${path.join(root, "reports/MONO-999-gate-ack-a1.json")}'`));
    assert.ok(rendered.includes(`--ack '${path.join(worktree, ".orchestrator/MONO-999-gate-ack-a1.json")}'`), "wait instructions use the actual fallback ack location");
    const collectionSample = JSON.parse(/## Запрос сбора[\s\S]*?```json\n([\s\S]*?)```/u.exec(rendered)[1]);
    assert.deepEqual(collectionSample.pins, entry.pins); assert.equal(collectionSample.reviewDatasetVersion, 0);
    assert.equal(Object.hasOwn(collectionSample, "reviewDataset"), false); assert.equal(collectionSample.collect, false);
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
    const queue = [{ id: "fixture:comment", operation: "comment", target: ack.issue, payload: { body: "Russian lead\nappend #/certificate" } }, { id: "fixture:state", operation: "issue-state", target: ack.issue, payload: { state: "In Progress" } }];
    const report = publishPhase({ issue: ack.issue, stage: "mono-deliver", attempt: 1, packVersion: entry.packVersion, sourceCommit: entry.sourceCommit, surfaceRevision: entry.surfaceRevision,
      phase: "code", sequence: 1, kind: "phase", head, certificate: "fixture certificate", linear_mutations_pending: queue, capsule: { phase: "code", head, decisions: [], writable_roots: entry.workerWritableRoots, open_queue: queue } }, reportFile);
    await t.test("report-durable-queue-conflict: every existing write identity is checked before instructions", async () => {
      const file = path.join(root, "consumed/MONO-999-a1", `${queue[1].id}.json`);
      const prior = { issue: ack.issue, attempt: 1, id: queue[1].id, writeDigest: digest(expandedWrite(queue[1], report)), state: "present", evidence: "prior connector read-back" };
      try {
        for (const conflict of [{ writeDigest: digest({ ...queue[1], payload: { state: "Different" } }) }, { issue: "MONO-998" }, { attempt: 2 }]) {
          atomicJson(file, { ...prior, ...conflict });
          const printed = [];
          await assert.rejects(acceptReport({ root, report: reportFile }, value => printed.push(value)), /changed within attempt/u);
          assert.deepEqual(printed, [], "no instructions, reread plan or session can authorize a conflicting queued write");
          assert.equal(fs.existsSync(path.join(root, "consumed/MONO-999-a1/sessions", `current-${digest(report)}.json`)), false);
        }
      } finally { fs.rmSync(file, { force: true }); }
    });
    const output = [], opened = await acceptReport({ root, report: reportFile }, value => output.push(value));
    const session = opened.session; assert.equal(opened.status, "observations-pending"); assert.match(output[0].writes[0].payload.body, /fixture certificate/u);
    await t.test("report-write-digests-expanded-certificate: printed digest observes the unchanged expanded write", () => {
      assert.equal(output[0].writeDigests[queue[0].id], digest(expandedWrite(queue[0], report)));
      assert.notEqual(output[0].writeDigests[queue[0].id], digest(queue[0]), "certificate expansion affects the printed digest");
      assert.deepEqual(output[0].writes, queue.map(item => expandedWrite(item, report)));
    });
    const observations = queue.map(item => { const write = expandedWrite(item, report); return { sessionId: session.sessionId, writeId: write.id, reportDigest: digest(report), writeDigest: output[0].writeDigests[write.id], observedAt: new Date().toISOString(), state: "present", evidence: "fresh connector read-back" }; });
    const args = { root, report: reportFile, session: session.sessionId, observe: observations.map(item => `${item.writeId}=${JSON.stringify(item)}`) };
    const confirmed = await acceptReport(args, () => {}); assert.equal(confirmed.status, "confirmed");
    const confirmationFile = path.join(root, "confirmations/MONO-999-phase-code-a1-s1.confirmed.json"); validateConfirmation(report, readJson(confirmationFile));
    const secondOutput = [], second = await acceptReport({ root, report: reportFile }, value => secondOutput.push(value)); assert.ok(secondOutput[0].reread);
    await assert.rejects(acceptReport({ ...args, session: second.session.sessionId }, () => {}), /session.*digest/u);
    assert.equal(reconcile({ action: "reconcile", issue: ack.issue, attempt: 1, idempotencyKey: `${ack.issue}:${queue[0].id}`, write: expandedWrite(queue[0], report) }, { root, reportFile, sessionId: session.sessionId }).state, "unknown");
    const fresh = observations.map(item => ({ ...item, sessionId: second.session.sessionId, observedAt: new Date().toISOString() }));
    const secondArgs = { root, report: reportFile, session: second.session.sessionId };
    await assert.rejects(acceptReport({ ...secondArgs, observe: [`${fresh[0].writeId}=${JSON.stringify({ ...fresh[0], writeDigest: "0".repeat(64) })}`] }, () => {}), /digest mismatch/u);
    await assert.rejects(acceptReport({ ...secondArgs, observe: [`${fresh[0].writeId}=${JSON.stringify({ ...fresh[0], observedAt: "2000-01-01T00:00:00Z" })}`] }, () => {}), /older/u);
    await assert.rejects(acceptReport({ ...secondArgs, observe: [`${fresh[0].writeId}=${JSON.stringify({ ...fresh[0], state: "missing" })}`] }, () => {}), /absent=true/u);
    const missing = { ...fresh[0], state: "missing", absent: true };
    assert.equal((await acceptReport({ ...secondArgs, observe: [`${missing.writeId}=${JSON.stringify(missing)}`] }, () => {})).status, "observations-pending");
    assert.equal(reconcile({ action: "reconcile", issue: ack.issue, attempt: 1, idempotencyKey: `${ack.issue}:${queue[0].id}`, write: expandedWrite(queue[0], report) }, { root, reportFile, sessionId: second.session.sessionId }).state, "missing");
    const secondObservations = fresh.map(item => `${item.writeId}=${JSON.stringify(item)}`);
    assert.equal((await acceptReport({ ...secondArgs, observe: secondObservations }, () => {})).status, "confirmed");
    assert.equal((await acceptReport(secondArgs, () => {})).status, "confirmed", "same session/effects confirmation is idempotent");
    await t.test("confirm-after-session-open: session failure leaves an empty queue unconfirmed", async () => {
      const empty = publishPhase({ ...report, sequence: 2, linear_mutations_pending: [], capsule: { ...report.capsule, open_queue: [] } }, reportFile);
      const sessions = path.join(root, "consumed/MONO-999-a1/sessions"), backup = sessions + ".saved";
      const emptyConfirmation = path.join(root, "confirmations/MONO-999-phase-code-a1-s2.confirmed.json");
      fs.renameSync(sessions, backup); write(sessions, "session setup is unavailable");
      try {
        await assert.rejects(acceptReport({ root, report: reportFile }, () => {}), /ENOTDIR/u);
        assert.equal(fs.existsSync(emptyConfirmation), false, "no confirmation before session setup succeeds");
      } finally { fs.unlinkSync(sessions); fs.renameSync(backup, sessions); }
      const emptyOutput = [], completed = await acceptReport({ root, report: reportFile }, value => emptyOutput.push(value));
      assert.equal(completed.status, "confirmed");
      assert.equal(emptyOutput[0].session.sessionId, completed.session.sessionId);
      assert.ok(fs.existsSync(path.join(sessions, completed.session.sessionId, "session.json")));
      validateConfirmation(empty, readJson(emptyConfirmation));
    });
    const prematureFile = path.join(root, "reports/MONO-999-phase-ship.json"), premature = { ...report, phase: "ship", capsule: { ...report.capsule, phase: "ship" } };
    atomicJson(prematureFile, premature); const prematureOutput = [];
    await assert.rejects(acceptReport({ root, report: prematureFile }, value => prematureOutput.push(value)), /phase preflight report is missing/u);
    assert.deepEqual(prematureOutput, [], "predecessor refusal occurs before any connector writes/session are exposed");
    assert.equal(fs.existsSync(path.join(root, "consumed/MONO-999-a1/sessions", `current-${digest(premature)}.json`)), false);
    const apply = spawnSync(path.join(runtime, "orchestrator/linear-adapter.mjs"), [], { env, encoding: "utf8", input: JSON.stringify({ action: "apply", issue: ack.issue, attempt: 1, write: queue[0] }) });
    assert.equal(apply.status, 0); assert.equal(apply.stdout, ""); assert.match(apply.stderr, /not success/u);
    const pins = effectivePins(readJson(path.join(root, "workers.json"))[ack.issue]);
    const request = { ...pins, pins: entry.pins, head, collect: false, collectionId: `preflight-collect:${head}:1` };
    const collect = { id: request.collectionId, operation: "preflight-collect", target: head, payload: { request } };
    const collectReport = { ...report, phase: "preflight", pinsVersion: 0, linear_mutations_pending: [collect], capsule: { ...report.capsule, phase: "preflight", open_queue: [collect] } };
    const admission = (await admitCollection(root, collectReport))[0]; assert.equal(admission.manifestDigest, digest(pins)); assert.equal(admission.reportDigest, digest(collectReport));
    await withLock(path.join(root, "launch.lock"), async () => { await assert.rejects(admitCollection(root, collectReport), /locked/u); });
    await assert.rejects(acceptAmend({ root, issue: ack.issue, attempt: "1", risk: "deep", text: "escalation without docs" }), /full-snapshot/u);
    await t.test("amend-pins-advance-after-resume: refused live-worker resume retains the registry", () => {
      const registryFile = path.join(root, "workers.json"), before = fs.readFileSync(registryFile, "utf8");
      const refusedAmend = run(process.execPath, [path.join(runtime, "orchestrator/accept.mjs"), "amend", "--root", root, "--issue", ack.issue, "--attempt", "1", "--text", "Refused live-worker amendment."]);
      assert.notEqual(refusedAmend.status, 0);
      assert.match(refusedAmend.stderr, /live/u, "the wrapper prints the resume refusal");
      assert.equal(JSON.parse(refusedAmend.stdout).state, "prepared");
      assert.equal(fs.readFileSync(registryFile, "utf8"), before, "undelivered pins cannot become effective");
      assert.ok(fs.existsSync(path.join(path.dirname(entry.pins.file), "pins.v1.json")), "prepare the version file before attempting resume");
      const pendingFile = path.join(path.dirname(entry.pins.file), "amendment.pending.json");
      assert.ok(readJson(pendingFile).launchMayHaveStartedAt);
      // Reset this isolated uncertain-delivery fixture, never production state.
      for (const name of ["amendment.pending.json", "pins.v1.json", "resume.v1.md", "resume.v1.json"]) fs.unlinkSync(path.join(path.dirname(entry.pins.file), name));
    });
    process.kill(livePid, "SIGTERM"); livePid = null;
    await new Promise(resolve => setTimeout(resolve, 100));
    const oldPath = process.env.PATH; process.env.PATH = env.PATH;
    try {
      const amended = await acceptAmend({ root, issue: ack.issue, attempt: "1", risk: "deep", text: "Raise risk to deep; approved full snapshot follows.", "full-snapshot": true, snapshot }); livePid = amended.pid;
      assert.equal(amended.pinsVersion, 1); assert.match(amended.pinsFile, /pins\.v1\.json$/u); assert.equal(readJson(path.join(root, "workers.json"))[ack.issue].pinsVersion, 1);
      assert.match(fs.readFileSync(amended.resumeFile, "utf8"), /## prd\.md/u);
      const originalResume = fs.readFileSync(amended.resumeFile, "utf8");
      process.kill(livePid, "SIGTERM"); livePid = null; await new Promise(resolve => setTimeout(resolve, 100));
      fs.appendFileSync(path.join(snapshot, "prd.md"), "\nAdditional approved snapshot context.\n");
      const changedSnapshot = await acceptAmend({ root, issue: ack.issue, attempt: "1", risk: "deep", text: "Raise risk to deep; approved full snapshot follows.", "full-snapshot": true, snapshot }); livePid = changedSnapshot.pid;
      assert.equal(changedSnapshot.pinsVersion, 2, "same snapshot path with changed bytes creates a new version");
      assert.equal(fs.readFileSync(amended.resumeFile, "utf8"), originalResume, "the already registered version is immutable");
      process.kill(livePid, "SIGTERM"); livePid = null; await new Promise(resolve => setTimeout(resolve, 100));
      const dataset = path.join(scratch, "evidence/datasets/fixture.md"); write(dataset, "Approved review decisions.");
      const laterAmendment = await acceptAmend({ root, issue: ack.issue, attempt: "1", text: "Resume after an independent dataset clarification.", "review-dataset": dataset, "review-dataset-version": "1" }); livePid = laterAmendment.pid;
      assert.equal(readJson(laterAmendment.pinsFile).reviewDatasetDigest, createHash("sha256").update(fs.readFileSync(dataset)).digest("hex"));
      assert.equal(laterAmendment.pinsVersion, 3, "an independent amendment does not require resupplying the full snapshot");
      assert.match(fs.readFileSync(laterAmendment.resumeFile, "utf8"), /Additional approved snapshot context/u, "persisted full documents are retained through later resumes");
      const staleWrite = { ...collect, id: `preflight-collect:${head}:2`, payload: { request: { ...request, collectionId: `preflight-collect:${head}:2` } } };
      await assert.rejects(admitCollection(root, { ...collectReport, linear_mutations_pending: [staleWrite], capsule: { ...collectReport.capsule, open_queue: [staleWrite] } }), /stale pinsVersion/u);
      const currentPins = effectivePins(readJson(path.join(root, "workers.json"))[ack.issue]);
      const datasetVersionReport = (number, version) => {
        const currentEntry = readJson(path.join(root, "workers.json"))[ack.issue];
        const collectionId = `preflight-collect:${head}:${number}`, currentRequest = { ...currentPins, pins: collectionPinsBinding(currentEntry), head, collect: false, collectionId };
        if (version === undefined) delete currentRequest.reviewDatasetVersion; else currentRequest.reviewDatasetVersion = version;
        const currentWrite = { id: collectionId, operation: "preflight-collect", target: head, payload: { request: currentRequest } };
        return { ...collectReport, pinsVersion: currentPins.pinsVersion, linear_mutations_pending: [currentWrite], capsule: { ...collectReport.capsule, open_queue: [currentWrite] } };
      };
      await assert.rejects(admitCollection(root, datasetVersionReport(3, 0)), /reviewDatasetVersion/u, "current pinsVersion cannot admit an older dataset at the same path");
      await assert.rejects(admitCollection(root, datasetVersionReport(4, undefined)), /reviewDatasetVersion/u, "omitting the version cannot bypass an amended dataset pin");
      assert.equal((await admitCollection(root, datasetVersionReport(5, 1)))[0].manifestDigest, digest(currentPins));
      assert.deepEqual((await admitCollection(root, collectReport))[0], admission, "prior admission is recoverable under its original version");
      await t.test("amend-resume-registration-recovery: finish a delivered amendment without a second launch", () => {
        process.kill(livePid, "SIGTERM"); livePid = null;
        const resumeScript = path.join(runtime, "orchestrator/resume.mjs"), actualResume = path.join(runtime, "orchestrator/resume.actual.mjs");
        const source = fs.readFileSync(resumeScript, "utf8"); write(actualResume, source);
        write(resumeScript, `import {execFileSync} from "node:child_process";\nconst output=execFileSync(process.execPath,[${JSON.stringify(actualResume)},...process.argv.slice(2)],{encoding:"utf8"});\nprocess.stdout.write(output);process.stderr.write("fixture interruption after successful resume\\n");process.exitCode=1;\n`);
        const args = [path.join(runtime, "orchestrator/accept.mjs"), "amend", "--root", root, "--issue", ack.issue, "--attempt", "1", "--text", "Recover delivered pins after interrupted registration."];
        try {
          const interrupted = run(process.execPath, args);
          const delivered = readJson(path.join(root, "workers.json"))[ack.issue]; livePid = delivered.pid;
          assert.notEqual(interrupted.status, 0); assert.match(interrupted.stderr, /interruption after successful resume/u);
          assert.equal(delivered.pinsVersion, 3, "resume delivery precedes pins registration");
          const deliveredResume = delivered.last_resume, resumeFile = path.join(path.dirname(entry.pins.file), "resume.v4.md"), deliveredText = fs.readFileSync(resumeFile, "utf8");
          const pendingFile = path.join(path.dirname(entry.pins.file), "amendment.pending.json"), pending = readJson(pendingFile);
          write(resumeScript, source);
          const changed = run(process.execPath, [...args.slice(0, -1), "A different amendment cannot replace delivered pending pins."]);
          assert.notEqual(changed.status, 0); assert.match(changed.stderr, /identical retry/u);
          assert.equal(readJson(path.join(root, "workers.json"))[ack.issue].pinsVersion, 3);
          fs.appendFileSync(resumeFile, "Tampered context.\n");
          const tampered = run(process.execPath, args); assert.notEqual(tampered.status, 0); assert.match(tampered.stderr, /content changed/u);
          write(resumeFile, deliveredText);
          const recovered = JSON.parse(pass(run(process.execPath, args)));
          assert.equal(recovered.pid, livePid, "recovery must not launch another worker"); assert.equal(recovered.pinsVersion, 4);
          const completed = readJson(path.join(root, "workers.json"))[ack.issue];
          assert.equal(completed.pinsVersion, 4); assert.deepEqual(completed.last_resume, deliveredResume);
          assert.equal(fs.readFileSync(resumeFile, "utf8"), deliveredText, "delivered amendment bytes stay unchanged");
          assert.equal(fs.existsSync(pendingFile), false);
          atomicJson(pendingFile, pending); // Interruption after registry publication, before pending cleanup.
          assert.equal(JSON.parse(pass(run(process.execPath, args))).pid, livePid);
          assert.equal(fs.existsSync(pendingFile), false); assert.deepEqual(readJson(path.join(root, "workers.json"))[ack.issue].last_resume, deliveredResume);
        } finally { write(resumeScript, source); fs.unlinkSync(actualResume); }
      });
      await t.test("amend-completed-retry-after-cleanup: live and exited deliveries return their original result", () => {
        const resumeScript = path.join(runtime, "orchestrator/resume.mjs"), source = fs.readFileSync(resumeScript, "utf8");
        const before = readJson(path.join(root, "workers.json")), originalPid = before[ack.issue].pid;
        const resumeFile = path.join(path.dirname(entry.pins.file), "resume.v4.md"), originalText = fs.readFileSync(resumeFile, "utf8");
        const args = [path.join(runtime, "orchestrator/accept.mjs"), "amend", "--root", root, "--issue", ack.issue, "--attempt", "1", "--text", "Recover delivered pins after interrupted registration."];
        write(resumeScript, 'console.error("completed amendment must not resume again");process.exitCode=73;\n');
        try {
          assert.equal(JSON.parse(pass(run(process.execPath, args))).pid, originalPid);
          assert.deepEqual(readJson(path.join(root, "workers.json")), before);
          assert.equal(fs.readFileSync(resumeFile, "utf8"), originalText);
          fs.appendFileSync(resumeFile, "Changed completed context.\n");
          const changed = run(process.execPath, args); assert.notEqual(changed.status, 0); assert.match(changed.stderr, /completed amendment content changed/u);
          write(resumeFile, originalText); assert.deepEqual(readJson(path.join(root, "workers.json")), before);
          process.kill(livePid, "SIGTERM"); livePid = null;
          assert.equal(JSON.parse(pass(run(process.execPath, args))).pid, originalPid, "an exited delivered worker is not launched again");
          assert.deepEqual(readJson(path.join(root, "workers.json")), before);
          assert.equal(fs.readFileSync(resumeFile, "utf8"), originalText);
        } finally { write(resumeScript, source); }
      });
      const pendingFile = path.join(path.dirname(entry.pins.file), "amendment.pending.json");
      const isolatedPreparation = async callback => {
        if (livePid) { process.kill(livePid, "SIGTERM"); livePid = null; }
        const registryFile = path.join(root, "workers.json"), before = readJson(registryFile), output = path.dirname(entry.pins.file);
        const names = new Set(fs.readdirSync(output));
        const resumeScript = path.join(runtime, "orchestrator/resume.mjs"), resumeSource = fs.readFileSync(resumeScript, "utf8");
        const acceptScript = path.join(runtime, "orchestrator/accept.mjs"), acceptSource = fs.readFileSync(acceptScript, "utf8");
        try { await callback({ registryFile, before, output, resumeScript, resumeSource, acceptScript, acceptSource }); }
        finally {
          const pid = readJson(registryFile)[ack.issue].pid;
          if (pid !== before[ack.issue].pid) { try { process.kill(pid, "SIGTERM"); } catch {} }
          livePid = null; atomicJson(registryFile, before);
          write(resumeScript, resumeSource); write(acceptScript, acceptSource);
          for (const name of fs.readdirSync(output)) if (!names.has(name)) fs.rmSync(path.join(output, name), { recursive: true, force: true });
          if (fs.existsSync(path.join(root, "amend.lock"))) fs.unlinkSync(path.join(root, "amend.lock"));
        }
      };
      const amendArgs = text => [path.join(runtime, "orchestrator/accept.mjs"), "amend", "--root", root, "--issue", ack.issue, "--attempt", "1", "--text", text];
      const removeDeadLock = result => {
        assert.equal(result.signal, "SIGKILL");
        assert.throws(() => process.kill(result.pid, 0), { code: "ESRCH" });
        const lock = path.join(root, "amend.lock"); assert.equal(readJson(lock).pid, result.pid); fs.unlinkSync(lock);
      };
      await t.test("amend-legacy-no-dataset-nonzero-version: preserve version across unrelated amendments", () => isolatedPreparation(async ({ registryFile, before }) => {
        const launchFile = before[ack.issue].pins.file, launchBytes = fs.readFileSync(launchFile);
        try {
          const legacy = readJson(launchFile); delete legacy.reviewDatasetDigest;
          legacy.reviewDataset = null; legacy.reviewDatasetVersion = 7; atomicJson(launchFile, legacy);
          const registry = readJson(registryFile), worker = registry[ack.issue];
          worker.pins.digest = createHash("sha256").update(fs.readFileSync(launchFile)).digest("hex");
          worker.pinsVersion = 0; delete worker.last_amendment; delete worker.completed_amendments; atomicJson(registryFile, registry);
          for (const text of ["Legacy unrelated amendment one.", "Legacy unrelated amendment two."]) {
            const result = JSON.parse(pass(run(process.execPath, amendArgs(text))));
            assert.equal(effectivePins(readJson(registryFile)[ack.issue]).reviewDatasetVersion, 7);
            assert.equal(readJson(path.join(path.dirname(launchFile), `pins.v${result.pinsVersion}.json`)).reviewDatasetVersion, 7);
            process.kill(result.pid, "SIGTERM");
            const deadline = Date.now() + 5000;
            while (true) {
              try { process.kill(result.pid, 0); } catch { break; }
              assert.ok(Date.now() < deadline, "fixture worker must exit before its next amendment");
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          }
        } finally { fs.writeFileSync(launchFile, launchBytes); }
      }));
      await t.test("amend-launch-failure-restores-grants: uncertain delivery preserves evidence and refuses restart", () => isolatedPreparation(({ registryFile, before }) => {
        const extra = path.join(scratch, "amend-grant"), grantsFile = path.join(scratch, "expanded-grants.json");
        fs.mkdirSync(extra); write(grantsFile, [...before[ack.issue].workerWritableRoots, extra]);
        fs.symlinkSync(process.execPath, path.join(bin, "node")); fs.symlinkSync("/usr/bin/git", path.join(bin, "git"));
        const codex = path.join(bin, "codex"), saved = codex + ".saved"; fs.renameSync(codex, saved);
        const args = [...amendArgs("Expand approved grants, but launch is unavailable."), "--worker-writable-roots", grantsFile];
        try {
          const failed = spawnSync(process.execPath, args, { cwd: checkout, env: { ...env, PATH: bin }, encoding: "utf8" });
          assert.notEqual(failed.status, 0); assert.match(failed.stderr, /ENOENT/u);
          assert.equal(JSON.parse(failed.stdout).state, "prepared");
          assert.ok(readJson(pendingFile).launchMayHaveStartedAt);
          assert.ok(readJson(registryFile)[ack.issue].workerWritableRoots.includes(fs.realpathSync(extra)));
          assert.equal(readJson(registryFile)[ack.issue].pinsVersion, before[ack.issue].pinsVersion);
          const evidence = fs.readFileSync(pendingFile), registry = fs.readFileSync(registryFile);
          fs.renameSync(saved, codex);
          const retried = run(process.execPath, args); assert.notEqual(retried.status, 0); assert.match(retried.stderr, /automatic restart refused/u);
          assert.deepEqual(fs.readFileSync(pendingFile), evidence); assert.deepEqual(fs.readFileSync(registryFile), registry);
        } finally { if (fs.existsSync(saved)) fs.renameSync(saved, codex); }
      }));
      await t.test("amend-pending-replacement-restores-original-grants: uncertain delivery refuses replacement", () => isolatedPreparation(({ registryFile, before, resumeScript }) => {
        const extra = path.join(scratch, "interrupted-amend-grant"), grantsFile = path.join(scratch, "interrupted-grants.json");
        fs.mkdirSync(extra); write(grantsFile, [...effectivePins(before[ack.issue]).workerWritableRoots, fs.realpathSync(extra)]);
        const args = [...amendArgs("Interrupted undelivered amendment."), "--worker-writable-roots", grantsFile];
        write(resumeScript, `import fs from "node:fs";import path from "node:path";import {readJson,atomicJson} from "../runtime.mjs";
const request=readJson(process.argv[process.argv.indexOf("--request")+1]),file=path.join(request.root,"workers.json"),registry=readJson(file),entry=registry[request.issue],roots=request.workerWritableRoots.map(value=>fs.realpathSync(value));
entry.workerWritableRoots=roots;entry.writable_roots=roots;entry.capsule.writable_roots=roots;atomicJson(file,registry);process.kill(process.ppid,"SIGKILL");
`);
        removeDeadLock(run(process.execPath, args));
        const evidence = fs.readFileSync(pendingFile), registry = fs.readFileSync(registryFile);
        assert.ok(readJson(pendingFile).launchMayHaveStartedAt);
        const replacement = run(process.execPath, amendArgs("Replace the interrupted undelivered amendment."));
        assert.notEqual(replacement.status, 0); assert.match(replacement.stderr, /replacement refused/u);
        assert.deepEqual(fs.readFileSync(pendingFile), evidence); assert.deepEqual(fs.readFileSync(registryFile), registry);
      }));
      await t.test("amend-interrupted-before-launch-marker: identical retry resumes the same prepared version", () => isolatedPreparation(({ acceptScript, acceptSource }) => {
        write(acceptScript, acceptSource.replace('record = { ...record, launchMayHaveStartedAt:', 'process.kill(process.pid, "SIGKILL"); record = { ...record, launchMayHaveStartedAt:'));
        const args = amendArgs("Retry proven unstarted preparation."); removeDeadLock(run(process.execPath, args));
        // SIGKILL held launch.lock as well; fixture owner verifies its holder died.
        const launchLock = path.join(root, "launch.lock"); assert.throws(() => process.kill(readJson(launchLock).pid, 0), { code: "ESRCH" }); fs.unlinkSync(launchLock);
        const pending = readJson(pendingFile), bytes = fs.readFileSync(pending.resumeFile);
        assert.equal(pending.launchMayHaveStartedAt, undefined);
        write(acceptScript, acceptSource);
        const resumed = JSON.parse(pass(run(process.execPath, args))); assert.equal(resumed.version, pending.pinsVersion); assert.equal(resumed.state, "registered");
        assert.deepEqual(fs.readFileSync(pending.resumeFile), bytes);
      }));
      await t.test("amend-interrupted-after-marker-before-resume: preserve evidence and refuse both retry and replacement", () => isolatedPreparation(({ acceptScript, acceptSource, registryFile }) => {
        write(acceptScript, acceptSource.replace('try { run("resume.mjs",', 'process.kill(process.pid, "SIGKILL"); try { run("resume.mjs",'));
        const args = amendArgs("Launch boundary recorded, command not called."); removeDeadLock(run(process.execPath, args));
        assert.ok(readJson(pendingFile).launchMayHaveStartedAt);
        const bytes = fs.readFileSync(pendingFile), registry = fs.readFileSync(registryFile); write(acceptScript, acceptSource);
        for (const command of [args, amendArgs("Replacement after uncertain launch.")]) {
          const refused = run(process.execPath, command); assert.notEqual(refused.status, 0); assert.match(refused.stderr, /launch may have started/u);
          assert.deepEqual(fs.readFileSync(pendingFile), bytes); assert.deepEqual(fs.readFileSync(registryFile), registry);
        }
      }));
      await t.test("amend-proven-nondelivery-restores-grants-before-replacement: marker absent", () => isolatedPreparation(({ registryFile, before, acceptScript, acceptSource, resumeScript }) => {
        write(acceptScript, acceptSource.replace('record = { ...record, launchMayHaveStartedAt:', 'process.kill(process.pid, "SIGKILL"); record = { ...record, launchMayHaveStartedAt:'));
        const args = amendArgs("Preparation before launch marker."); removeDeadLock(run(process.execPath, args));
        const launchLock = path.join(root, "launch.lock"); assert.throws(() => process.kill(readJson(launchLock).pid, 0), { code: "ESRCH" }); fs.unlinkSync(launchLock);
        const old = readJson(pendingFile); assert.equal(old.launchMayHaveStartedAt, undefined);
        const provisional = readJson(registryFile), extra = path.join(scratch, "proven-unstarted-grant"); fs.mkdirSync(extra);
        for (const key of ["workerWritableRoots", "writable_roots"]) provisional[ack.issue][key].push(extra);
        provisional[ack.issue].capsule.writable_roots.push(extra); atomicJson(registryFile, provisional);
        write(acceptScript, acceptSource); write(resumeScript, 'console.error("fixture launch unavailable");process.exitCode=1;\n');
        const replacement = run(process.execPath, amendArgs("Different prepared request.")); assert.notEqual(replacement.status, 0);
        assert.deepEqual(readJson(registryFile), before, "restore original grants before replacing preparation");
        assert.ok(readJson(pendingFile).pinsVersion > old.pinsVersion); assert.ok(readJson(pendingFile).launchMayHaveStartedAt);
        assert.equal(fs.readFileSync(old.resumeFile, "utf8").includes("Preparation before launch marker."), true);
      }));
      await t.test("amend-incomplete-snapshot-preparation-reserves-version: retry preserves orphaned bytes", () => isolatedPreparation(({ before, output, acceptScript, acceptSource }) => {
        write(acceptScript, acceptSource.replace('fs.mkdirSync(target);', 'fs.mkdirSync(target); process.kill(process.pid, "SIGKILL");'));
        const args = [...amendArgs("Recover interrupted snapshot staging."), "--full-snapshot", "--snapshot", snapshot];
        removeDeadLock(run(process.execPath, args));
        const launchLock = path.join(root, "launch.lock"); assert.throws(() => process.kill(readJson(launchLock).pid, 0), { code: "ESRCH" }); fs.unlinkSync(launchLock);
        const version = before[ack.issue].pinsVersion + 1, orphan = path.join(output, `snapshot.v${version}`);
        assert.ok(fs.existsSync(orphan)); assert.equal(fs.existsSync(path.join(output, `pins.v${version}.json`)), false);
        assert.equal(fs.existsSync(pendingFile), false);
        const sentinel = path.join(orphan, "retained-preparation.txt"); fs.writeFileSync(sentinel, "Keep incomplete preparation evidence.");
        write(acceptScript, acceptSource);
        const recovered = JSON.parse(pass(run(process.execPath, args))); assert.equal(recovered.version, version + 1);
        assert.equal(fs.readFileSync(sentinel, "utf8"), "Keep incomplete preparation evidence.");
        assert.equal(fs.existsSync(path.join(output, `pins.v${version}.json`)), false);
      }));
      await t.test("amend-earlier-completed-retry: later amendments preserve prior delivery results", () => {
        if (livePid) process.kill(livePid, "SIGTERM"); livePid = null;
        const command = path.join(runtime, "orchestrator/accept.mjs"), args = [command, "amend", "--root", root, "--issue", ack.issue, "--attempt", "1", "--text"];
        const first = JSON.parse(pass(run(process.execPath, [...args, "First historical amendment."]))); livePid = first.pid;
        const firstFiles = [first.pinsFile, first.resumeFile, first.resumeRequest].map(file => [file, fs.readFileSync(file, "utf8")]);
        process.kill(livePid, "SIGTERM"); livePid = null;
        const second = JSON.parse(pass(run(process.execPath, [...args, "Later independent amendment."]))); livePid = second.pid;
        assert.equal(second.pinsVersion, first.pinsVersion + 1);
        const registryFile = path.join(root, "workers.json"), before = readJson(registryFile);
        const resumeScript = path.join(runtime, "orchestrator/resume.mjs"), source = fs.readFileSync(resumeScript, "utf8");
        write(resumeScript, 'console.error("historical amendment must not resume again");process.exitCode=73;\n');
        try {
          assert.deepEqual(JSON.parse(pass(run(process.execPath, [...args, "First historical amendment."]))), first);
          assert.deepEqual(readJson(registryFile), before, "historical replay cannot roll back the current version or worker");
          assert.equal(fs.existsSync(path.join(path.dirname(first.pinsFile), `pins.v${second.pinsVersion + 1}.json`)), false);
          fs.appendFileSync(first.resumeFile, "Changed historical context.\n");
          const changed = run(process.execPath, [...args, "First historical amendment."]);
          assert.notEqual(changed.status, 0); assert.match(changed.stderr, /completed amendment content changed/u);
          write(first.resumeFile, firstFiles.find(([file]) => file === first.resumeFile)[1]);
          process.kill(livePid, "SIGTERM"); livePid = null;
          assert.deepEqual(JSON.parse(pass(run(process.execPath, [...args, "First historical amendment."]))), first);
          assert.deepEqual(readJson(registryFile), before);
          for (const [file, bytes] of firstFiles) assert.equal(fs.readFileSync(file, "utf8"), bytes);
        } finally { write(resumeScript, source); }
      });
      await t.test("amend-historical-omitted-pins-and-snapshot-ambiguity: candidates require distinguishing arguments", async () => {
        const text = "Identical text with different saved effective inputs.", args = amendArgs(text);
        const first = JSON.parse(pass(run(process.execPath, args))); livePid = first.pid;
        process.kill(livePid, "SIGTERM"); livePid = null; await new Promise(resolve => setTimeout(resolve, 100));
        const evolved = path.join(scratch, "evolved-snapshot"); fs.mkdirSync(evolved);
        for (const name of [`issue-${ack.issue}.md`, "approval.md", "project-brief.md", "prd.md", "tech-spec.md"]) fs.copyFileSync(path.join(snapshot, name), path.join(evolved, name));
        fs.appendFileSync(path.join(evolved, "prd.md"), "\nA later approved snapshot.\n");
        const secondArgs = [...args, "--review-dataset-version", "2", "--full-snapshot", "--snapshot", evolved];
        const second = JSON.parse(pass(run(process.execPath, secondArgs))); livePid = second.pid;
        assert.equal(second.version, first.version + 1);
        const registryFile = path.join(root, "workers.json"), registry = fs.readFileSync(registryFile), output = path.dirname(first.pinsFile), names = fs.readdirSync(output);
        const ambiguous = run(process.execPath, args); assert.notEqual(ambiguous.status, 0);
        const refusal = JSON.parse(ambiguous.stdout); assert.equal(refusal.version, null); assert.equal(refusal.outcome, "refused");
        assert.deepEqual(refusal.candidates, [first.version, second.version]);
        assert.deepEqual(fs.readFileSync(registryFile), registry); assert.deepEqual(fs.readdirSync(output), names);
        assert.deepEqual(JSON.parse(pass(run(process.execPath, [...args, "--review-dataset-version", "1"]))), first, "resolve omissions using each candidate, even though current dataset is newer");
        assert.deepEqual(JSON.parse(pass(run(process.execPath, secondArgs))), second);
        process.kill(livePid, "SIGTERM"); livePid = null;
      });
      await t.test("amend-snapshot-replay-uses-recorded-bytes: omitted snapshot ignores changed external inputs", () => {
        const args = [...amendArgs("Replay saved full documents."), "--full-snapshot", "--snapshot", snapshot];
        const first = JSON.parse(pass(run(process.execPath, args))); livePid = first.pid;
        const registryFile = path.join(root, "workers.json"), registry = fs.readFileSync(registryFile), pins = readJson(first.pinsFile);
        const bytes = fs.readFileSync(first.resumeFile), external = fs.readFileSync(path.join(snapshot, "prd.md"));
        fs.appendFileSync(path.join(snapshot, "prd.md"), "\nChanged caller input after delivery.\n");
        const omitted = amendArgs("Replay saved full documents.");
        assert.deepEqual(JSON.parse(pass(run(process.execPath, omitted))), first);
        assert.deepEqual(fs.readFileSync(first.resumeFile), bytes); assert.deepEqual(fs.readFileSync(registryFile), registry);
        fs.writeFileSync(path.join(snapshot, "prd.md"), external);
        for (const file of [first.pinsFile, first.resumeFile, first.resumeRequest, path.join(pins.fullSnapshot.directory, "prd.md")]) {
          const original = fs.readFileSync(file); fs.appendFileSync(file, "\nChanged recorded version.\n");
          const failed = run(process.execPath, omitted); assert.notEqual(failed.status, 0); assert.match(failed.stderr, /content changed/u);
          assert.equal(JSON.parse(failed.stdout).version, first.version); assert.equal(JSON.parse(failed.stdout).state, "registered");
          fs.writeFileSync(file, original); assert.deepEqual(fs.readFileSync(registryFile), registry);
        }
        process.kill(livePid, "SIGTERM"); livePid = null;
      });
      await t.test("amend-new-request-refusal-before-version-allocation: null version and explicit reason", () => {
        const registryFile = path.join(root, "workers.json"), bytes = fs.readFileSync(registryFile);
        const failed = run(process.execPath, [...amendArgs("A new prohibited downgrade."), "--risk", "tiny"]);
        assert.notEqual(failed.status, 0); const refusal = JSON.parse(failed.stdout);
        assert.equal(refusal.version, null); assert.equal(refusal.outcome, "refused"); assert.match(refusal.reason, /only escalate/u);
        assert.deepEqual(fs.readFileSync(registryFile), bytes);
      });
      await assert.rejects(acceptAmend({ root, issue: ack.issue, attempt: "1", risk: "tiny", text: "downgrade" }), /only escalate/u);
    } finally { process.env.PATH = oldPath; }
  } finally {
    const registryFile = path.join(root, "workers.json");
    if (fs.existsSync(registryFile)) livePid ??= readJson(registryFile)["MONO-999"]?.pid;
    if (livePid) { try { process.kill(livePid, "SIGTERM"); } catch {} }
    fs.rmSync(scratch, { recursive: true, force: true });
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

test("collector confirms an empty phase and leaves connector queues and terminal reports alone", async () => {
  const { collectOnce } = await import("./orchestrator/collector.mjs");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-collector-empty-"));
  const root = path.join(scratch, "root"), repo = path.join(scratch, "repo");
  const head = "a".repeat(40), issue = "MONO-999";
  const identity = { packVersion: "0.21.0", sourceCommit: head, surfaceRevision: 4 };
  const entry = { issue, stage: "mono-deliver", attempt: 1, worktree: repo, ...identity, spawned_at: new Date(Date.now() - 10000).toISOString() };
  const report = { ...entry, phase: "code", kind: "phase", sequence: 1, head, publishedAt: new Date().toISOString(), linear_mutations_pending: [],
    capsule: { phase: "code", head, decisions: [], writable_roots: [repo], open_queue: [] } };
  try {
    atomicJson(path.join(root, "workers.json"), { [issue]: entry });
    const file = path.join(root, "reports", `${issue}-phase-code.json`); atomicJson(file, report);
    await collectOnce({ root, issue, attempt: 1 });
    validateConfirmation(report, readJson(path.join(root, "confirmations", `${issue}-phase-code-a1-s1.confirmed.json`)));
    report.sequence = 2; report.linear_mutations_pending = report.capsule.open_queue = [{ id: "comment-1", operation: "comment", target: issue, payload: "hello" }];
    atomicJson(file, report); await collectOnce({ root, issue, attempt: 1 });
    assert.equal(fs.existsSync(path.join(root, "confirmations", `${issue}-phase-code-a1-s2.confirmed.json`)), false);
    atomicJson(file, { ...entry, status: "green" });
    await assert.rejects(collectOnce({ root, issue, attempt: 1 }), /phase identity/u);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

async function collectorAttentionFixture(runFixture) {
  const { collectOnce } = await import("./orchestrator/collector.mjs");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-collector-attention-"));
  const root = path.join(scratch, "root"), repo = path.join(scratch, "repo"), skillsRoot = path.join(scratch, "skills"), evidenceRoot = path.join(scratch, "evidence");
  const issue = "MONO-999", head = "d".repeat(40), options = { root, issue, attempt: 1 };
  const identity = { packVersion: "0.21.0", sourceCommit: head, surfaceRevision: 4 };
  const pins = { product: "fixture", root, worktree: repo, skillsRoot, evidenceRoot, baseRef: "origin/main", risk: "standard", critical: null,
    verification: { command: "node", args: ["verify.mjs"] }, workerWritableRoots: [repo], reviewDatasetVersion: 0 };
  const pinsFile = path.join(scratch, "pins.json");
  const attention = path.join(root, "reports", `${issue}-collect-attention-a1.json`), log = path.join(root, "reports", `${issue}-collector-a1.log`);
  const reportFile = path.join(root, "reports", `${issue}-phase-preflight.json`), registry = path.join(root, "workers.json");
  const phase = (name, sequence, queue = []) => ({ ...identity, issue, stage: "mono-deliver", attempt: 1, phase: name, kind: "confirmation-request", sequence, head,
    publishedAt: new Date().toISOString(), linear_mutations_pending: queue, capsule: { phase: name, head, decisions: [], open_queue: queue, writable_roots: [repo] } });
  const request = number => ({ ...pins, head, collect: false, collectionId: `preflight-collect:${head}:${number}` });
  const report = (number, overrides = {}) => {
    const value = { ...request(number), ...overrides };
    return phase("preflight", number, [{ id: value.collectionId, operation: "preflight-collect", target: head, payload: { request: value } }]);
  };
  const poll = () => collectOnce(options);
  const lines = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(line => line.includes("attention: ")) : [];
  const oldPath = process.env.PATH;
  try {
    for (const dir of [repo, skillsRoot, evidenceRoot]) fs.mkdirSync(dir, { recursive: true });
    atomicJson(pinsFile, pins);
    const entry = { ...identity, issue, stage: "mono-deliver", attempt: 1, worktree: repo,
      pins: { file: pinsFile, digest: createHash("sha256").update(fs.readFileSync(pinsFile)).digest("hex") }, spawned_at: new Date(Date.now() - 10000).toISOString() };
    atomicJson(registry, { [issue]: entry });
    atomicJson(path.join(root, "reports", `${issue}-phase-code.json`), phase("code", 1)); await poll();
    const bin = path.join(scratch, "bin");
    write(path.join(bin, "ps"), "#!/usr/bin/env node\nconsole.log('fixture-start');\n"); fs.chmodSync(path.join(bin, "ps"), 0o700);
    process.env.PATH = `${bin}:${oldPath}`;
    write(path.join(skillsRoot, ".mono-agent-workflow/scripts/gate.mjs"), "console.log('gate preflight: pass: fixture admission');\n");
    const signedHistory = async value => {
      const { createHmac, randomUUID } = await import("node:crypto"), { canonical } = await import("./runtime.mjs");
      const key = Buffer.alloc(32, 9); fs.writeFileSync(path.join(evidenceRoot, "receipt.key"), key);
      const receipt = { ...value, root: fs.realpathSync(root), worktree: fs.realpathSync(repo), evidenceRoot: fs.realpathSync(evidenceRoot), workerWritableRoots: [fs.realpathSync(repo)],
        producer: "gate-autoreview-v2", runId: randomUUID(), reviewDataset: null, modelRoutes: null };
      const file = path.join(evidenceRoot, "history", `${receipt.runId}.json`);
      const envelope = { receipt, signature: createHmac("sha256", key).update(canonical(receipt)).digest("hex") };
      atomicJson(file, envelope);
      return { receipt: file, receiptDigest: digest(envelope), gate: "gate preflight: fail: fixture reconciled refusal" };
    };
    await runFixture({ poll, lines, attention, reportFile, registry, entry, phase, report, request, signedHistory, options, scratch });
  } finally { process.env.PATH = oldPath; fs.rmSync(scratch, { recursive: true, force: true }); }
}

test("collector admission refusal writes exactly one attention line and durable pair", async () => {
  await collectorAttentionFixture(async f => {
    const report = f.report(1, { reviewDatasetVersion: 7 }); atomicJson(f.reportFile, report);
    await f.poll();
    const value = readJson(f.attention);
    assert.deepEqual(Object.keys(value).sort(), ["at", "collectionId", "pinsVersion", "reason", "reportDigest"]);
    assert.equal(value.reportDigest, digest(report)); assert.equal(value.pinsVersion, 0);
    assert.equal(value.collectionId, report.capsule.open_queue[0].id); assert.equal(value.reason, "collection pin mismatch: reviewDatasetVersion");
    assert.ok(Number.isFinite(Date.parse(value.at))); assert.equal(f.lines().length, 1);
    assert.deepEqual(fs.readdirSync(path.dirname(f.attention)).filter(name => name.includes("collect-attention")), [path.basename(f.attention)]);
  });
});

test("collector skips the same refused pair on another poll and in a restarted process", async () => {
  await collectorAttentionFixture(async f => {
    atomicJson(f.reportFile, f.report(1, { reviewDatasetVersion: 7 })); await f.poll();
    const before = fs.readFileSync(f.attention, "utf8"), logFile = f.attention.replace("collect-attention", "collector").replace(".json", ".log");
    const beforeLog = fs.readFileSync(logFile, "utf8"); await f.poll();
    const module = new URL("./orchestrator/collector.mjs", import.meta.url).href;
    pass(spawnSync(process.execPath, ["--input-type=module", "-e", `const {collectOnce}=await import(${JSON.stringify(module)});await collectOnce(${JSON.stringify(f.options)});`], { encoding: "utf8" }));
    assert.equal(fs.readFileSync(f.attention, "utf8"), before); assert.equal(f.lines().length, 1);
    assert.equal(fs.readFileSync(logFile, "utf8"), beforeLog);
  });
});

test("collector retries identical report bytes after registry pinsVersion advances", async () => {
  await collectorAttentionFixture(async f => {
    const report = f.report(1, { reviewDatasetVersion: 7 }); atomicJson(f.reportFile, report); await f.poll();
    atomicJson(path.join(path.dirname(f.entry.pins.file), "pins.v1.json"), { pinsVersion: 1 });
    atomicJson(f.registry, { [f.options.issue]: { ...f.entry, pinsVersion: 1 } }); await f.poll();
    assert.equal(f.lines().length, 2); assert.equal(readJson(f.attention).reportDigest, digest(report));
    assert.equal(readJson(f.attention).pinsVersion, 1); assert.equal(readJson(f.attention).reason, "new collection request uses stale pinsVersion");
  });
});

test("collector retries a new refused report and replaces the attention record", async () => {
  await collectorAttentionFixture(async f => {
    atomicJson(f.reportFile, f.report(1, { reviewDatasetVersion: 7 })); await f.poll();
    const next = { ...f.report(2, { risk: "deep" }), sequence: 1 }; atomicJson(f.reportFile, next); await f.poll();
    assert.equal(f.lines().length, 2); assert.equal(readJson(f.attention).reportDigest, digest(next));
    assert.equal(readJson(f.attention).collectionId, next.capsule.open_queue[0].id); assert.equal(readJson(f.attention).reason, "collection pin mismatch: risk");
  });
});

test("collector admitted current report clears only the exact attempt attention file", async () => {
  await collectorAttentionFixture(async f => {
    const report = f.report(1); atomicJson(f.reportFile, report);
    atomicJson(f.attention, { reportDigest: digest(report), collectionId: report.capsule.open_queue[0].id, pinsVersion: 1, reason: "prior refusal", at: new Date().toISOString() });
    const helper = f.attention.replace(".json", "-s1.txt"), other = f.attention.replace("-a1.json", "-a2.json");
    write(helper, "helper evidence"); atomicJson(other, { reason: "other attempt" });
    await f.signedHistory(f.request(1)); await f.poll();
    assert.equal(fs.existsSync(f.attention), false); assert.equal(fs.readFileSync(helper, "utf8"), "helper evidence");
    assert.equal(readJson(other).reason, "other attempt");
  });
});

test("collector corrected higher-sequence D2 admission clears the refused D1 attention", async () => {
  await collectorAttentionFixture(async f => {
    const rejected = f.report(1, { reviewDatasetVersion: 7 }); atomicJson(f.reportFile, rejected); await f.poll();
    // A later sequence still requires orchestrator reconciliation of D1.
    const evidence = await f.signedHistory(rejected.capsule.open_queue[0].payload.request);
    await confirmQueue(rejected, f.options.root, () => ({ state: "present", evidence }));
    assert.equal(fs.existsSync(f.attention), true);
    atomicJson(f.reportFile, f.report(2)); await f.signedHistory(f.request(2)); await f.poll();
    assert.equal(fs.existsSync(f.attention), false);
    assert.equal(readJson(path.join(f.options.root, "confirmations", `${f.options.issue}-phase-preflight-a1-s2.confirmed.json`)).status, "confirmed");
  });
});

test("collector confirmation of another phase leaves attention untouched", async () => {
  await collectorAttentionFixture(async f => {
    atomicJson(f.reportFile, f.report(1, { reviewDatasetVersion: 7 })); await f.poll();
    const before = fs.readFileSync(f.attention, "utf8");
    atomicJson(path.join(f.options.root, "reports", `${f.options.issue}-phase-code.json`), f.phase("code", 2)); await f.poll();
    assert.equal(fs.readFileSync(f.attention, "utf8"), before); assert.equal(f.lines().length, 1);
  });
});

test("collector launch lock error creates no attention file", async () => {
  await collectorAttentionFixture(async f => {
    atomicJson(f.reportFile, f.report(1));
    await withLock(path.join(f.options.root, "launch.lock"), async () => { await assert.rejects(f.poll(), /operation locked/u); });
    assert.equal(fs.existsSync(f.attention), false); assert.equal(f.lines().length, 0);
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
  let started, validatorPid;
  const validationFile = path.join(scratch, "validation.json");
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
    fs.writeFileSync(path.join(evidence, "receipt.key"), Buffer.alloc(32, 7));
    atomicJson(modeFile, { crash: false }); atomicJson(countFile, { collections: 0 });
    write(path.join(skills, ".mono-agent-workflow/scripts/gate.mjs"), `import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {withLock,atomicJson,readJson,canonical} from ${JSON.stringify(runtimeUrl)};
const request=readJson(process.argv[process.argv.indexOf('--request')+1]);
if(!request.collect){if(readJson(${JSON.stringify(modeFile)}).holdValidation){atomicJson(${JSON.stringify(validationFile)},{pid:process.pid});while(readJson(${JSON.stringify(modeFile)}).holdValidation)await new Promise(r=>setTimeout(r,50));}const receipt=readJson(path.join(request.evidenceRoot,request.head+'.json')).receipt;console.log(receipt.verification.exitCode===0?'gate preflight: pass: fixture recovered':'gate preflight: fail: fixture verification failed');process.exit();}
await withLock(path.join(request.evidenceRoot,request.head+'.collect.lock'),async()=>{
 const countFile=${JSON.stringify(countFile)},mode=readJson(${JSON.stringify(modeFile)});const count=readJson(countFile);count.collections++;atomicJson(countFile,count);if(mode.noReceipt)process.exit(78);
 const receipt={producer:'gate-autoreview-v2',runId:crypto.randomUUID(),head:request.head,base:request.head,collectionId:request.collectionId,product:request.product,skillsRoot:request.skillsRoot,
 root:fs.realpathSync(request.root),worktree:fs.realpathSync(request.worktree),evidenceRoot:fs.realpathSync(request.evidenceRoot),risk:request.risk,critical:request.critical,workerWritableRoots:request.workerWritableRoots.map(p=>fs.realpathSync(p)).sort(),reviewDataset:null,
 ...(request.pins?{pins:request.pins}:{}),verification:{...request.verification,exitCode:mode.failed?1:0}};
 if(mode.corrupt) receipt[mode.corrupt]=mode.value;
 const envelope={receipt,signature:crypto.createHmac('sha256',fs.readFileSync(path.join(request.evidenceRoot,'receipt.key'))).update(canonical(receipt)).digest('hex')};
 atomicJson(path.join(request.evidenceRoot,'history',receipt.runId+'.json'),envelope);
 if(mode.crash){const holder=readJson(${JSON.stringify(lock)});process.kill(holder.pid,'SIGKILL');process.exit(77);}
 atomicJson(path.join(request.evidenceRoot,request.head+'.json'),envelope);
 console.log('gate preflight: pass: fixture collected');
});
`);
    const pins = { product: "fixture", root, worktree: repo, skillsRoot: skills, baseRef: "origin/main", evidenceRoot: evidence,
      risk: "standard", critical: null, verification: { command: "node", args: ["verify.mjs"] }, workerWritableRoots: [repo] };
    const pinsFile = path.join(scratch, "dispatch/pins.json"); atomicJson(pinsFile, pins);
    const identity = { packVersion: "0.21.0", sourceCommit: head, surfaceRevision: 4 };
    const entry = { ...identity, issue, stage: "mono-deliver", attempt, worktree: repo, pinsVersion: 0,
      pins: { file: pinsFile, digest: createHash("sha256").update(fs.readFileSync(pinsFile)).digest("hex") }, spawned_at: new Date(Date.now() - 10000).toISOString() };
    atomicJson(path.join(root, "workers.json"), { [issue]: entry });
    const phase = (name, sequence, queue = []) => ({ ...identity, issue, stage: "mono-deliver", attempt, phase: name, kind: "confirmation-request", sequence, head,
      publishedAt: new Date().toISOString(), linear_mutations_pending: queue, capsule: { phase: name, head, writable_roots: [repo], decisions: [], open_queue: queue } });
    const code = phase("code", 1); atomicJson(path.join(root, "reports", `${issue}-phase-code.json`), code);
    started = await collectorStart(options); assert.ok(started.procStart);
    await assert.rejects(collectorStart(options), /locked/u);
    assert.equal(collectorStatus(options).status, "running-or-unverified");
    await waitUntil(() => fs.existsSync(path.join(root, "confirmations", `${issue}-phase-code-a1-s1.confirmed.json`)));
    const request = { ...pins, head, collect: false, collectionId: `preflight-collect:${head}:1` };
    const queued = { id: request.collectionId, operation: "preflight-collect", target: head, payload: { request } };
    const report = phase("preflight", 1, [queued]), reportFile = path.join(root, "reports", `${issue}-phase-preflight.json`);
    atomicJson(modeFile, { crash: true }); atomicJson(reportFile, report);
    await waitUntil(() => fs.existsSync(path.join(evidence, "history")) && fs.readdirSync(path.join(evidence, "history")).length === 1 && collectorStatus(options).status === "stale");
    assert.equal(fs.existsSync(lock), true); assert.equal(fs.existsSync(headLock), true); assert.equal(fs.existsSync(path.join(evidence, `${head}.json`)), false);
    const admissionFile = path.join(root, "consumed", `${issue}-a1/admissions`, `${queued.id}.json`);
    assert.equal(readJson(admissionFile).pinsVersion, 0);
    entry.pinsVersion = 1; atomicJson(path.join(scratch, "dispatch/pins.v1.json"), { pinsVersion: 1, risk: "deep" }); atomicJson(path.join(root, "workers.json"), { [issue]: entry });
    atomicJson(modeFile, { holdValidation: true }); started = await collectorStart(options);
    await waitUntil(() => fs.existsSync(validationFile)); validatorPid = readJson(validationFile).pid;
    const recoveryPid = started.pid; process.kill(recoveryPid, "SIGKILL"); started = null;
    await waitUntil(() => { try { process.kill(recoveryPid, 0); return false; } catch { return true; } });
    const { reclaimLock: reclaimHead } = await import("./runtime.mjs");
    assert.throws(() => reclaimHead(headLock), /locked/u, "a live detached validation gate protects the head lock after collector death");
    await assert.rejects(collectorStart(options), /locked/u);
    atomicJson(modeFile, { crash: false });
    await waitUntil(() => collectorStatus(options).status === "stale"); validatorPid = null;
    started = await collectorStart(options);
    const confirmed = path.join(root, "confirmations", `${issue}-phase-preflight-a1-s1.confirmed.json`);
    await waitUntil(() => fs.existsSync(confirmed)); validateConfirmation(report, readJson(confirmed));
    assert.equal(readJson(countFile).collections, 1, "history recovery never repeats review");
    assert.equal(fs.existsSync(headLock), false); assert.deepEqual(readJson(path.join(evidence, `${head}.json`)), readJson(readJson(confirmed).results[0].evidence.receipt));
    collectorStop(options); await waitUntil(() => !fs.existsSync(lock)); started = null;
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
      } finally { child.kill("SIGKILL"); }
    });
    const stale = { ...request, collectionId: `preflight-collect:${head}:2` };
    atomicJson(reportFile, phase("preflight", 2, [{ ...queued, id: stale.collectionId, payload: { request: stale } }]));
    await collectOnce(options);
    assert.equal(readJson(path.join(root, "reports", `${issue}-collect-attention-a1.json`)).reason, "new collection request uses stale pinsVersion");
    assert.equal(readJson(countFile).collections, 1);
    await t.test("receipt actual binding rejects signed mismatches", async () => {
      for (const [field, value] of [["risk", "standard"], ["critical", "wrong"], ["workerWritableRoots", []], ["verification", { command: "wrong", args: [] }], ["reviewDataset", { source: "wrong" }], ["pins", { file: "wrong", digest: "0".repeat(64) }]]) {
        const number = readJson(countFile).collections + 1, id = `preflight-collect:${head}:${number}`;
        const current = { ...request, risk: "deep", collectionId: id, ...(field === "pins" ? { pins: collectionPinsBinding(readJson(path.join(root, "workers.json"))[issue]), reviewDatasetVersion: 0 } : {}) }, next = { ...phase("preflight", 2, [{ ...queued, id, payload: { request: current } }]), pinsVersion: 1 };
        // Each refusal is a separate scratch report; discard only its unconfirmed
        // admission/result, then use a fresh ID for the next recorded gate run.
        atomicJson(reportFile, next); atomicJson(modeFile, { corrupt: field, value });
        await assert.rejects(collectOnce(options), new RegExp(`binding mismatch: ${field}`));
        assert.equal(fs.existsSync(path.join(root, "reports", `${issue}-collect-attention-a1.json`)), false);
        assert.equal(fs.existsSync(path.join(root, "confirmations", `${issue}-phase-preflight-a1-s2.confirmed.json`)), false);
      }
    });
    await t.test("failed signed collections are completed and never reviewed twice", async () => {
      const number = readJson(countFile).collections + 1, id = `preflight-collect:${head}:${number}`;
      const current = { ...request, risk: "deep", collectionId: id };
      const failed = { ...phase("preflight", 2, [{ ...queued, id, payload: { request: current } }]), pinsVersion: 1 };
      atomicJson(reportFile, failed); atomicJson(modeFile, { failed: true });
      await collectOnce(options);
      const confirmation = readJson(path.join(root, "confirmations", `${issue}-phase-preflight-a1-s2.confirmed.json`));
      validateConfirmation(failed, confirmation); assert.match(confirmation.results[0].evidence.gate, /^gate preflight: fail:/);
      assert.equal(readJson(countFile).collections, number);
      await collectOnce(options); assert.equal(readJson(countFile).collections, number);
    });
    await t.test("a started run without a receipt blocks automatic repetition", async () => {
      const number = readJson(countFile).collections + 1, id = `preflight-collect:${head}:${number}`;
      const current = { ...request, risk: "deep", collectionId: id };
      const incomplete = { ...phase("preflight", 3, [{ ...queued, id, payload: { request: current } }]), pinsVersion: 1 };
      atomicJson(reportFile, incomplete); atomicJson(modeFile, { noReceipt: true });
      await assert.rejects(collectOnce(options), /without an answer/u);
      await assert.rejects(collectOnce(options), /orchestrator reconciliation required/u);
      assert.equal(fs.existsSync(path.join(root, "reports", `${issue}-collect-attention-a1.json`)), false);
      assert.equal(readJson(countFile).collections, number);
      assert.equal(fs.existsSync(path.join(root, "confirmations", `${issue}-phase-preflight-a1-s3.confirmed.json`)), false);
    });
  } finally {
    if (validatorPid) { try { process.kill(validatorPid, "SIGKILL"); } catch {} }
    if (started) { try { collectorStop(options); } catch {} }
    process.env.PATH = oldPath;
    if (oldRows === undefined) delete process.env.MONO_FIXTURE_ROWS; else process.env.MONO_FIXTURE_ROWS = oldRows;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("collector recovers a baseline dataset with a separately numbered signed archive", async () => {
  const { collectOnce } = await import("./orchestrator/collector.mjs");
  const { createHmac, randomUUID } = await import("node:crypto");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-collector-baseline-"));
  const root = path.join(scratch, "root"), repo = path.join(scratch, "repo"), evidenceRoot = path.join(scratch, "evidence"), skillsRoot = path.join(scratch, "skills");
  const issue = "MONO-999", head = "c".repeat(40), identity = { packVersion: "0.21.0", sourceCommit: head, surfaceRevision: 4 };
  try {
    for (const dir of [repo, evidenceRoot, skillsRoot]) fs.mkdirSync(dir, { recursive: true });
    const reviewDataset = path.join(evidenceRoot, "datasets/scope.md"); write(reviewDataset, "# baseline dataset\n");
    const datasetDigest = createHash("sha256").update(fs.readFileSync(reviewDataset)).digest("hex");
    const pins = { root, worktree: repo, product: "fixture", skillsRoot, evidenceRoot, reviewDataset, risk: "standard", critical: null, baseRef: "origin/main",
      verification: { command: "node", args: ["verify.mjs"] }, workerWritableRoots: [repo] };
    const pinsFile = path.join(scratch, "pins.json"); atomicJson(pinsFile, pins);
    const entry = { ...identity, issue, stage: "mono-deliver", attempt: 1, worktree: repo, pinsVersion: 0,
      pins: { file: pinsFile, digest: createHash("sha256").update(fs.readFileSync(pinsFile)).digest("hex") }, spawned_at: new Date(Date.now() - 10000).toISOString() };
    atomicJson(path.join(root, "workers.json"), { [issue]: entry });
    const phase = (name, queue) => ({ ...identity, issue, stage: "mono-deliver", attempt: 1, phase: name, kind: "confirmation-request", sequence: 1, head,
      publishedAt: new Date().toISOString(), linear_mutations_pending: queue, capsule: { phase: name, head, decisions: [], open_queue: queue, writable_roots: [repo] } });
    atomicJson(path.join(root, "reports", `${issue}-phase-code.json`), phase("code", [])); await collectOnce({ root, issue, attempt: 1 });
    const request = { ...pins, head, collectionId: `preflight-collect:${head}:1`, collect: false };
    const queued = { id: request.collectionId, operation: "preflight-collect", target: head, payload: { request } };
    atomicJson(path.join(root, "reports", `${issue}-phase-preflight.json`), phase("preflight", [queued]));
    const key = Buffer.alloc(32, 8); fs.writeFileSync(path.join(evidenceRoot, "receipt.key"), key);
    const archived = await (await import("./gate.mjs")).archiveReviewDataset(reviewDataset, evidenceRoot);
    assert.equal(archived.version, 1);
    const receipt = { ...pins, producer: "gate-autoreview-v2", runId: randomUUID(), head, base: head, collectionId: request.collectionId,
      root: fs.realpathSync(root), worktree: fs.realpathSync(repo), evidenceRoot: fs.realpathSync(evidenceRoot), workerWritableRoots: [fs.realpathSync(repo)],
      reviewDataset: { source: reviewDataset, digest: datasetDigest, copy: `.orchestrator/review-dataset-${datasetDigest.slice(0, 8)}.md`, ...archived } };
    const history = path.join(evidenceRoot, "history", `${receipt.runId}.json`);
    const runtime = await import("./runtime.mjs");
    const sign = receipt => ({ receipt, signature: createHmac("sha256", key).update(runtime.canonical(receipt)).digest("hex") });
    atomicJson(history, sign({ ...receipt, reviewDataset: { ...receipt.reviewDataset, digest: "0".repeat(64) } }));
    await assert.rejects(collectOnce({ root, issue, attempt: 1 }), /receipt binding mismatch: reviewDataset/u);
    assert.equal(fs.existsSync(path.join(evidenceRoot, head + ".json")), false);
    atomicJson(history, sign(receipt));
    const bin = path.join(scratch, "bin"), oldPath = process.env.PATH;
    write(path.join(bin, "ps"), "#!/usr/bin/env node\nconsole.log('fixture-start');\n"); fs.chmodSync(path.join(bin, "ps"), 0o700);
    write(path.join(skillsRoot, ".mono-agent-workflow/scripts/gate.mjs"), "console.log('gate preflight: pass: fixture baseline recovered');\n");
    try {
      process.env.PATH = `${bin}:${oldPath}`;
      await collectOnce({ root, issue, attempt: 1 });
    } finally { process.env.PATH = oldPath; }
    const confirmation = readJson(path.join(root, "confirmations", `${issue}-phase-preflight-a1-s1.confirmed.json`));
    assert.equal(confirmation.status, "confirmed");
    assert.equal(readJson(path.join(evidenceRoot, head + ".json")).receipt.reviewDataset.version, 1);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("collector startup timeout stops its detached child before reporting failure", async () => {
  const { awaitCollectorReady } = await import("./orchestrator/collector.mjs");
  const { spawn } = await import("node:child_process");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-collector-timeout-"));
  const lock = path.join(scratch, "late.lock");
  const child = spawn(process.execPath, ["-e", `setTimeout(() => {require('fs').writeFileSync(${JSON.stringify(lock)}, JSON.stringify({pid:process.pid,ready:true}));}, 800);setInterval(()=>{},1000);`], { detached: true, stdio: "ignore" });
  try {
    await assert.rejects(awaitCollectorReady(child, lock, 100), /did not acquire attempt lock/u);
    assert.ok(child.signalCode || child.exitCode !== null, "the child has exited before the rejection reaches the caller");
    assert.equal(fs.existsSync(lock), false, "no collector can acquire a late lock after failed startup");
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); fs.rmSync(scratch, { recursive: true, force: true }); }
});


test("preapply AE12 named contracts on installed scratch", async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-preapply-ae12-"));
  const skills = path.join(scratch, "skills"), repo = path.join(scratch, "repo"), root = path.join(scratch, "orchestrator"), bin = path.join(scratch, "bin");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MONO_WORKFLOW_STATE_ROOT: path.join(scratch, "state"), MONO_WORKFLOW_KNOWN_ROOTS: skills,
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const run = (cmd, args, cwd = checkout) => spawnSync(cmd, args, { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const git = (cwd, ...args) => pass(run("git", args, cwd));
  const input = JSON.parse(fixture("preapply-ae12.json"));
  let pid;
  try {
    for (const dir of [repo, bin, path.join(root, "reports")]) fs.mkdirSync(dir, { recursive: true });
    pass(run(process.execPath, ["scripts/install-local.mjs", "--skills-root", skills]));
    const runtime = path.join(skills, ".mono-agent-workflow/scripts");
    write(path.join(bin, "codex"), '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"ae12"}));setInterval(()=>{},1000);\n'); fs.chmodSync(path.join(bin, "codex"), 0o700);
    atomicJson(path.join(root, "control.json"), { state: "active", halt: false }); atomicJson(path.join(root, "workers.json"), {});
    git(repo, "init", "-b", "main"); const origin = path.join(scratch, "origin.git"); git(scratch, "init", "--bare", origin); git(repo, "remote", "add", "origin", origin);
    const config = path.join(repo, ".agents/mono-workflow.config.json"), policy = readJson(path.join(checkout, ".agents/mono-workflow.config.json"));
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
    const manifest = (filename, content, sha = hash(content)) => `| path | sha256 |\n| --- | --- |\n| ${filename} | ${sha} |\n\n    - \`${filename}\`\n\`\`\`text\n${content}\`\`\`\n`;
    const target = ".agents/mono-workflow.config.json", opaquePath = ".agents/opaque.txt", opaqueBytes = fixture("preapply-opaque-bytes.txt");
    const good = manifest(target, bytes).replace(`| ${target} | ${hash(bytes)} |\n`, `| ${target} | ${hash(bytes)} |\n| ${opaquePath} | ${hash(opaqueBytes)} |\n`)
      + `    - \`${opaquePath}\`\n\`\`\`text\n${opaqueBytes}\`\`\`\n`;
    write(path.join(snapshot, "approval.md"), "Approved AE12; project Delivery."); write(path.join(snapshot, "project-brief.md"), "AE12"); write(path.join(snapshot, "prd.md"), "## Кратко\nAE12 scratch.\n");
    const setSpec = value => { write(path.join(snapshot, "issue-MONO-997.md"), body); write(path.join(snapshot, "tech-spec.md"), `- U7. AE12\n  - Предприменение:\n${value}- U8. Uncovered\n`); };
    setSpec(good);
    const writable = path.join(scratch, "writable.json"), temp = path.join(scratch, "worker-temp"); fs.mkdirSync(temp); write(writable, [temp]);
    const options = [path.join(runtime, "orchestrator/dispatch.mjs"), "--issue", "MONO-997", "--root", root, "--config", config, "--snapshot", snapshot, "--worker-writable-roots", writable];
    const refusal = (pattern, flags = ["--preapply"]) => {
      const result = run(process.execPath, [...options, ...flags]); if (result.status === 0) { process.kill(JSON.parse(result.stdout).pid, "SIGTERM"); } assert.notEqual(result.status, 0, result.stdout); assert.match(result.stderr, pattern);
      assert.equal(git(worktree, "rev-parse", "HEAD"), base); assert.equal(fs.existsSync(path.join(root, "attempts.json")), false); assert.deepEqual(readJson(path.join(root, "workers.json")), {});
      assert.equal(fs.readFileSync(path.join(worktree, target), "utf8"), rawConfig);
    };
    await t.test("preapply-flag-required", () => { setSpec(good); refusal(/--preapply/u, []); });
    await t.test("preapply-mandate-required", () => { delete policy.orchestration.preapply; write(config, policy); refusal(/mandate/u); policy.orchestration.preapply = { mandate: input.mandate }; write(config, policy); });
    for (const [name, value, pattern] of [
      ["preapply-outside-agents", manifest("other.json", bytes), /path/u],
      ["preapply-parent-traversal", manifest(".agents/../outside", bytes), /path/u],
      ["preapply-nonregular", manifest(".agents", bytes), /path|regular/u],
      ["preapply-directory-target", manifest(".agents/directory", bytes), /regular/u],
      ["preapply-hash-mismatch", manifest(target, bytes, "0".repeat(64)), /sha256/u],
      ["preapply-fence-without-path", good.replace(`    - \`${target}\`\n`, ""), /path/u],
      ["preapply-path-without-fence", manifest(target, bytes).replace(/```text\n[\s\S]*?```\n/u, ""), /fence/u],
      ["preapply-indented-fence", good.replaceAll("```", " ```"), /column|indent/u],
      ["preapply-four-space-fence", good.replaceAll("```", "    ```"), /column|indent/u],
      ["preapply-multiple-candidates", good + "  - Предприменение:\n" + good, /multiple/u],
    ]) await t.test(name, () => { setSpec(value); refusal(pattern); });
    await t.test("preapply-dirty-tree", () => { setSpec(good); const dirty = path.join(worktree, "dirty"); write(dirty, "dirty"); refusal(/dirty/u); fs.unlinkSync(dirty); });
    await t.test("preapply-conflicting-file-parent", () => {
      const prefix = ".agents/new-file", child = prefix + "/child";
      const value = good.replace("| --- | --- |\n", `| --- | --- |\n| ${prefix} | ${hash("one\n")} |\n| ${child} | ${hash("two\n")} |\n`)
        + `    - \`${prefix}\`\n\`\`\`text\none\n\`\`\`\n    - \`${child}\`\n\`\`\`text\ntwo\n\`\`\`\n`;
      setSpec(value); refusal(/regular|parent/u);
      assert.equal(fs.existsSync(path.join(worktree, prefix)), false);
    });
    await t.test("preapply-paused-launch-no-commit", () => { setSpec(good); atomicJson(path.join(root, "control.json"), { state: "paused", halt: true }); try { refusal(/halt|paused/u); } finally { git(worktree, "reset", "--hard", base); atomicJson(path.join(root, "control.json"), { state: "active", halt: false }); } });
    await t.test("preapply-late-refusal-rolls-back-commit-and-ledger", () => {
      setSpec(good); const log = path.join(root, "logs/MONO-997-mono-deliver-a1.jsonl"); write(log, "existing log fixture\n");
      try { refusal(/EEXIST/u); assert.equal(fs.readFileSync(path.join(root, "ledger.md"), "utf8").includes("PREAPPLY"), false); }
      finally { fs.unlinkSync(log); fs.rmSync(path.join(root, "ledger.md"), { force: true }); }
    });
    await t.test("preapply-transformed-staging-no-mutation", () => {
      const name = ".agents/filtered.txt", raw = "$Id: expanded-token $\n";
      const value = good.replace("| --- | --- |\n", `| --- | --- |\n| ${name} | ${hash(raw)} |\n`)
        + `    - \`${name}\`\n\`\`\`text\n${raw}\`\`\`\n`;
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
    await t.test("preapply-AE12-commit-before-start-gate", () => {
      setSpec(good); const launched = JSON.parse(pass(run(process.execPath, [...options, "--preapply"]))); pid = launched.pid;
      const head = git(worktree, "rev-parse", "HEAD"); assert.notEqual(head, base);
      assert.equal(git(worktree, "log", "-1", "--format=%s"), "MONO-997: pre-applied .agents changes (orchestrator)");
      assert.equal(fs.readFileSync(path.join(worktree, target), "utf8"), bytes);
      assert.equal(fs.readFileSync(path.join(worktree, opaquePath), "utf8"), opaqueBytes);
      assert.match(pass(run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", launched.gateFile])), /gate start: pass/u);
      assert.ok(fs.readFileSync(launched.dispatchFile, "utf8").includes(head)); assert.ok(fs.readFileSync(launched.dispatchFile, "utf8").includes(hash(bytes)));
      assert.ok(fs.readFileSync(path.join(root, "ledger.md"), "utf8").includes(`PREAPPLY MONO-997 ${head} per mandate ${input.mandate}`));
      assert.ok(fs.readFileSync(path.join(launched.snapshot, "issue-MONO-997.md"), "utf8").endsWith(`# Предприменение\n${good}`));
      process.kill(pid, "SIGTERM"); pid = null; atomicJson(path.join(root, "workers.json"), {});
      // Idempotence is observed even when a later dispatch refusal prevents another worker.
      atomicJson(path.join(root, "control.json"), { state: "paused", halt: true });
      const retry = run(process.execPath, [...options, "--preapply"]); assert.notEqual(retry.status, 0); assert.equal(git(worktree, "rev-parse", "HEAD"), head);
      assert.equal(fs.readFileSync(path.join(root, "ledger.md"), "utf8").split("PREAPPLY").length - 1, 1);
      fs.writeFileSync(path.join(root, "ledger.md"), "");
      atomicJson(path.join(root, "control.json"), { state: "active", halt: false });
      const recovered = JSON.parse(pass(run(process.execPath, [...options, "--preapply"]))); pid = recovered.pid;
      assert.equal(git(worktree, "rev-parse", "HEAD"), head);
      assert.ok(fs.readFileSync(path.join(root, "ledger.md"), "utf8").includes(`PREAPPLY MONO-997 ${head} per mandate ${input.mandate}`));
      process.kill(pid, "SIGTERM"); pid = null; atomicJson(path.join(root, "workers.json"), {});
    });
    await t.test("preapply-repaired-manifest-new-commit", () => {
      const previous = git(worktree, "rev-parse", "HEAD"), repairedBytes = bytes.replace("AE12 applied", "AE12 repaired");
      const repaired = good.replace(hash(bytes), hash(repairedBytes)).replace(bytes, repairedBytes);
      setSpec(repaired); const launched = JSON.parse(pass(run(process.execPath, [...options, "--preapply"]))); pid = launched.pid;
      const repairedHead = git(worktree, "rev-parse", "HEAD"); assert.notEqual(repairedHead, previous);
      assert.equal(fs.readFileSync(path.join(worktree, target), "utf8"), repairedBytes);
      process.kill(pid, "SIGTERM"); pid = null; atomicJson(path.join(root, "workers.json"), {});
      const retry = JSON.parse(pass(run(process.execPath, [...options, "--preapply"]))); pid = retry.pid;
      assert.equal(git(worktree, "rev-parse", "HEAD"), repairedHead);
      process.kill(pid, "SIGTERM"); pid = null; atomicJson(path.join(root, "workers.json"), {});
    });
    await t.test("preapply-issue-only-direct-section", () => {
      const ignored = ".agents/ignored.txt", ignoredBytes = "approved ignored target\n";
      const ignoredManifest = good.replace("| --- | --- |\n", `| --- | --- |\n| ${ignored} | ${hash(ignoredBytes)} |\n`)
        + `- \`${ignored}\`\n\`\`\`text\n${ignoredBytes}\`\`\`\n`;
      const laneBody = body + "# Предприменение\n" + ignoredManifest;
      write(path.join(snapshot, "issue-MONO-996.md"), laneBody);
      write(path.join(snapshot, "issue-only.json"), { marker: "fixture", label: "issue-only", fingerprint: hash(laneBody), config: "fixture enabled", ownerApproval: "approved",
        seam: { package_kind: "issue-only", lifecycle_state_entity: "issue", behavioral_oracle: "AE12", risk_class: "standard", approval_status: "approved-fresh" } });
      atomicJson(path.join(root, "control.json"), { state: "active", halt: false });
      const laneOptions = [...options]; laneOptions[laneOptions.indexOf("--issue") + 1] = "MONO-996";
      const launched = JSON.parse(pass(run(process.execPath, [...laneOptions, "--preapply"]))); pid = launched.pid;
      assert.equal(fs.readFileSync(path.join(launched.snapshot, "issue-MONO-996.md"), "utf8"), laneBody);
      assert.equal(fs.readFileSync(path.join(repo, ".worktrees/MONO-996", target), "utf8"), bytes);
      assert.equal(git(path.join(repo, ".worktrees/MONO-996"), "show", `HEAD:${ignored}`), ignoredBytes.trimEnd());
      process.kill(pid, "SIGTERM"); pid = null;
    });
    await t.test("preapply-amend-requires-new-dispatch", async () => {
      await assert.rejects(acceptAmend({ root, issue: "MONO-997", attempt: "1", preapply: true }), /new dispatch|новый запуск/u);
    });
  } finally { if (pid) { try { process.kill(pid, "SIGTERM"); } catch {} } fs.rmSync(scratch, { recursive: true, force: true }); }
});
