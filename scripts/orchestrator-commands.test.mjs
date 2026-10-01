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
import { publishPhase, validateConfirmation } from "./delivery-state.mjs";
import { expandedWrite, effectivePins, admitCollection } from "./orchestrator/command-state.mjs";
import { acceptAck, acceptReport, acceptAmend } from "./orchestrator/accept.mjs";
import { reconcile } from "./orchestrator/linear-adapter.mjs";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = name => fs.readFileSync(path.join(checkout, "scripts/fixtures", name), "utf8");
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2)); };
const pass = result => { assert.equal(result.status, 0, result.stderr + result.stdout); return result.stdout.trim(); };
const issueFor = ids => `# Покрытие PRD/Spec\n${ids}\n`;

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
    assert.equal(budget.bytes - provenanceBytes, 99_756);
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
    const laneLaunch = JSON.parse(pass(run(process.execPath, [command, ...laneOptions]))); livePid = laneLaunch.pid;
    const laneRendered = fs.readFileSync(laneLaunch.dispatchFile, "utf8");
    assert.ok(laneRendered.includes(fingerprint));
    assert.equal(fs.existsSync(path.join(laneLaunch.snapshot, "prd.md")), false); assert.equal(fs.existsSync(path.join(laneLaunch.snapshot, "tech-spec.md")), false);
    process.kill(livePid, "SIGTERM"); livePid = undefined;
    const launched = JSON.parse(pass(run(process.execPath, [command, ...options]))); livePid = launched.pid;
    const registry = readJson(path.join(root, "workers.json")), entry = registry["MONO-999"];
    assert.equal(entry.attempt, 1); assert.equal(entry.pinsVersion, 0); assert.equal(entry.profile, "short"); assert.equal(entry.handshake, "wait");
    assert.equal(entry.pins.digest, (await import("./orchestrator/command-state.mjs")).sha256File(entry.pins.file));
    assert.equal(readJson(launched.gateFile).worktree, worktree); assert.deepEqual(readJson(launched.spawnFile).gates, entry.gates);
    assert.ok(!fs.readFileSync(launched.dispatchFile, "utf8").includes("{{")); assert.match(fs.readFileSync(path.join(root, "ledger.md"), "utf8"), /\d{4}-\d\d-\d\dT.*Z DISPATCHED MONO-999/u);
    const rendered = fs.readFileSync(launched.dispatchFile, "utf8");
    assert.ok(rendered.includes(`--ack '${path.join(root, "reports/MONO-999-gate-ack-a1.json")}'`));
    assert.ok(rendered.includes(`--ack '${path.join(worktree, ".orchestrator/MONO-999-gate-ack-a1.json")}'`), "wait instructions use the actual fallback ack location");
    assert.ok(fs.existsSync(path.join(launched.snapshot, "prd-extract.md"))); assert.equal(fs.existsSync(path.join(launched.snapshot, "prd.md")), false);
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
    const observations = queue.map(item => { const write = expandedWrite(item, report); return { sessionId: session.sessionId, writeId: write.id, reportDigest: digest(report), writeDigest: digest(write), observedAt: new Date().toISOString(), state: "present", evidence: "fresh connector read-back" }; });
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
    const request = { ...pins, head, collect: false, collectionId: `preflight-collect:${head}:1` };
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
      assert.equal(fs.readFileSync(registryFile, "utf8"), before, "undelivered pins cannot become effective");
      assert.ok(fs.existsSync(path.join(path.dirname(entry.pins.file), "pins.v1.json")), "prepare the version file before attempting resume");
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
      const laterAmendment = await acceptAmend({ root, issue: ack.issue, attempt: "1", text: "Resume after an independent dataset clarification.", "review-dataset-version": "1" }); livePid = laterAmendment.pid;
      assert.equal(laterAmendment.pinsVersion, 3, "an independent amendment does not require resupplying the full snapshot");
      assert.match(fs.readFileSync(laterAmendment.resumeFile, "utf8"), /Additional approved snapshot context/u, "persisted full documents are retained through later resumes");
      const staleWrite = { ...collect, id: `preflight-collect:${head}:2`, payload: { request: { ...request, collectionId: `preflight-collect:${head}:2` } } };
      await assert.rejects(admitCollection(root, { ...collectReport, linear_mutations_pending: [staleWrite], capsule: { ...collectReport.capsule, open_queue: [staleWrite] } }), /stale pinsVersion/u);
      const currentPins = effectivePins(readJson(path.join(root, "workers.json"))[ack.issue]);
      const datasetVersionReport = (number, version) => {
        const collectionId = `preflight-collect:${head}:${number}`, currentRequest = { ...currentPins, head, collect: false, collectionId };
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
      await t.test("amend-launch-failure-restores-grants: undelivered permissions stay aligned with effective pins", () => {
        if (livePid) process.kill(livePid, "SIGTERM"); livePid = null;
        const registryFile = path.join(root, "workers.json"), before = readJson(registryFile);
        const extra = path.join(scratch, "amend-grant"), grantsFile = path.join(scratch, "expanded-grants.json");
        fs.mkdirSync(extra); write(grantsFile, [...before[ack.issue].workerWritableRoots, extra]);
        // Restrict PATH to fixtures so a missing codex can never fall through to
        // a real worker binary. Git/Node remain concrete local dependencies.
        fs.symlinkSync(process.execPath, path.join(bin, "node")); fs.symlinkSync("/usr/bin/git", path.join(bin, "git"));
        const codex = path.join(bin, "codex"), saved = codex + ".saved"; fs.renameSync(codex, saved);
        const args = [path.join(runtime, "orchestrator/accept.mjs"), "amend", "--root", root, "--issue", ack.issue, "--attempt", "1", "--text", "Expand approved grants, but launch is unavailable.", "--worker-writable-roots", grantsFile];
        try {
          const failed = spawnSync(process.execPath, args, { cwd: checkout, env: { ...env, PATH: bin }, encoding: "utf8" });
          assert.notEqual(failed.status, 0); assert.match(failed.stderr, /ENOENT/u);
          assert.deepEqual(readJson(registryFile), before, "failed launch restores prior registry grants and pins");
          fs.renameSync(saved, codex);
          const retried = JSON.parse(pass(run(process.execPath, args))); livePid = retried.pid;
          assert.equal(retried.pinsVersion, 5);
          const effective = effectivePins(readJson(registryFile)[ack.issue]);
          assert.deepEqual(new Set(readJson(registryFile)[ack.issue].workerWritableRoots.map(root => fs.realpathSync(root))),
            new Set(effective.workerWritableRoots.map(root => fs.realpathSync(root))));
          assert.ok(effective.workerWritableRoots.includes(extra));
        } finally { if (fs.existsSync(saved)) fs.renameSync(saved, codex); }
      });
      await t.test("amend-pending-replacement-restores-original-grants: interruption cannot change the rollback baseline", () => {
        process.kill(livePid, "SIGTERM"); livePid = null;
        const registryFile = path.join(root, "workers.json"), before = readJson(registryFile);
        const resumeScript = path.join(runtime, "orchestrator/resume.mjs"), source = fs.readFileSync(resumeScript, "utf8");
        const extra = path.join(scratch, "interrupted-amend-grant"), grantsFile = path.join(scratch, "interrupted-grants.json");
        // Canonical paths also exercise Linux recovery on hosts with temp aliases.
        fs.mkdirSync(extra); write(grantsFile, [...effectivePins(before[ack.issue]).workerWritableRoots, fs.realpathSync(extra)]);
        const args = [path.join(runtime, "orchestrator/accept.mjs"), "amend", "--root", root, "--issue", ack.issue, "--attempt", "1", "--text", "Interrupted undelivered amendment.", "--worker-writable-roots", grantsFile];
        // Interrupt only the scratch accept process, after resume's provisional
        // grant write and before either registered delivery or wrapper rollback.
        write(resumeScript, `import fs from "node:fs";import path from "node:path";import {readJson,atomicJson} from "../runtime.mjs";\nconst request=readJson(process.argv[process.argv.indexOf("--request")+1]),file=path.join(request.root,"workers.json"),registry=readJson(file),entry=registry[request.issue],roots=request.workerWritableRoots.map(value=>fs.realpathSync(value));\nentry.workerWritableRoots=roots;entry.writable_roots=roots;entry.capsule.writable_roots=roots;atomicJson(file,registry);process.kill(process.ppid,"SIGKILL");\n`);
        const codex = path.join(bin, "codex"), saved = codex + ".saved";
        try {
          const interrupted = run(process.execPath, args);
          assert.equal(interrupted.signal, "SIGKILL");
          const provisional = readJson(registryFile)[ack.issue];
          assert.ok(provisional.workerWritableRoots.includes(fs.realpathSync(extra)));
          assert.equal(provisional.pinsVersion, 5); assert.deepEqual(provisional.last_resume, before[ack.issue].last_resume);
          const lock = path.join(root, "amend.lock");
          assert.equal(readJson(lock).pid, interrupted.pid);
          assert.throws(() => process.kill(interrupted.pid, 0), { code: "ESRCH" });
          const pending = readJson(path.join(path.dirname(entry.pins.file), "amendment.pending.json"));
          assert.deepEqual(pending.previousResume, provisional.last_resume);
          assert.deepEqual(pending.previousLaunchGrants.workerWritableRoots, before[ack.issue].workerWritableRoots);
          // The scratch owner has established death and reconciled that no
          // delivery was registered; only then remove its orphaned lock.
          fs.unlinkSync(lock);
          write(resumeScript, source); fs.renameSync(codex, saved);
          const replacement = [...args]; replacement[replacement.indexOf("--text") + 1] = "Replace the interrupted undelivered amendment.";
          const failed = spawnSync(process.execPath, replacement, { cwd: checkout, env: { ...env, PATH: bin }, encoding: "utf8" });
          assert.notEqual(failed.status, 0); assert.match(failed.stderr, /ENOENT/u);
          assert.deepEqual(readJson(registryFile), before, "replacement failure restores the original grants, not the provisional expansion");
          fs.renameSync(saved, codex);
          const retried = JSON.parse(pass(run(process.execPath, replacement))); livePid = retried.pid;
          assert.equal(retried.pinsVersion, 6);
          const registered = readJson(registryFile)[ack.issue];
          assert.deepEqual(new Set(registered.workerWritableRoots.map(value => fs.realpathSync(value))),
            new Set(effectivePins(registered).workerWritableRoots.map(value => fs.realpathSync(value))));
        } finally { write(resumeScript, source); if (fs.existsSync(saved)) fs.renameSync(saved, codex); }
      });
      await t.test("amend-earlier-completed-retry: later amendments preserve prior delivery results", () => {
        process.kill(livePid, "SIGTERM"); livePid = null;
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
 verification:{...request.verification,exitCode:mode.failed?1:0}};
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
    await assert.rejects(collectOnce(options), /stale pinsVersion/u); assert.equal(readJson(countFile).collections, 1);
    await t.test("receipt actual binding rejects signed mismatches", async () => {
      for (const [field, value] of [["risk", "standard"], ["critical", "wrong"], ["workerWritableRoots", []], ["verification", { command: "wrong", args: [] }], ["reviewDataset", { source: "wrong" }]]) {
        const number = readJson(countFile).collections + 1, id = `preflight-collect:${head}:${number}`;
        const current = { ...request, risk: "deep", collectionId: id }, next = { ...phase("preflight", 2, [{ ...queued, id, payload: { request: current } }]), pinsVersion: 1 };
        // Each refusal is a separate scratch report; discard only its unconfirmed
        // admission/result, then use a fresh ID for the next recorded gate run.
        atomicJson(reportFile, next); atomicJson(modeFile, { corrupt: field, value });
        await assert.rejects(collectOnce(options), new RegExp(`binding mismatch: ${field}`));
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

test("collector binds omitted dataset version to baseline zero during history recovery", async () => {
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
    const receipt = { ...pins, producer: "gate-autoreview-v2", runId: randomUUID(), head, base: head, collectionId: request.collectionId,
      root: fs.realpathSync(root), worktree: fs.realpathSync(repo), evidenceRoot: fs.realpathSync(evidenceRoot), workerWritableRoots: [fs.realpathSync(repo)],
      reviewDataset: { source: reviewDataset, digest: datasetDigest, copy: `.orchestrator/review-dataset-${datasetDigest.slice(0, 8)}.md`, version: 1 } };
    atomicJson(path.join(evidenceRoot, "history", `${receipt.runId}.json`), { receipt, signature: createHmac("sha256", key).update((await import("./runtime.mjs")).canonical(receipt)).digest("hex") });
    await assert.rejects(collectOnce({ root, issue, attempt: 1 }), /receipt binding mismatch: reviewDataset/u);
    assert.equal(fs.existsSync(path.join(root, "confirmations", `${issue}-phase-preflight-a1-s1.confirmed.json`)), false);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
