import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { atomicJson, changedPaths, withLock } from "./runtime.mjs";
import { effectivePins, sha256File } from "./orchestrator/command-state.mjs";
import { checkSpawnAvailability } from "./orchestrator/launch.mjs";
import { renderDispatch } from "./orchestrator/dispatch.mjs";

const scenarios = ["clean-branch", "file-edit", "prefix-edit", "rename", "release", "forged-release", "branch-removes-policy", "inherited-after-rebase", "no-pins", "no-policy", "branch-introduces-policy"];
test("landing U2 named gate fixtures", async t => {
  for (const scenario of scenarios) await t.test(scenario, () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-landing-gate-"));
    try {
      const repo = path.join(scratch, "repo"), root = path.join(scratch, "root"), evidence = path.join(scratch, "evidence"), skills = path.join(scratch, "skills");
      for (const dir of [repo, root, evidence, skills]) fs.mkdirSync(dir);
      const git = (...args) => { const r = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: repo, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
      const write = (file, body) => { const target = path.join(repo, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body); };
      const policy = { serialPaths: ["CHANGELOG.md", "shared/"], changelog: { fragmentDir: "changelog.d", target: "CHANGELOG.md", heading: "## [Unreleased]" } };
      const config = ["no-policy", "branch-introduces-policy"].includes(scenario) ? {} : { landing: policy };
      write(".agents/mono-workflow.config.json", JSON.stringify(config)); write("CHANGELOG.md", "original\n"); write("shared/file.md", "original\n");
      git("init", "-b", "main"); git("add", "."); git("commit", "-m", "base"); const launchBase = git("rev-parse", "HEAD"); git("checkout", "-b", "task");
      if (["file-edit", "release", "forged-release", "branch-removes-policy", "no-pins", "no-policy", "branch-introduces-policy"].includes(scenario)) write("CHANGELOG.md", "task change\n");
      if (scenario === "prefix-edit") write("shared/new.md", "task change\n");
      if (scenario === "rename") git("mv", "CHANGELOG.md", "renamed.md");
      if (scenario === "branch-removes-policy") write(".agents/mono-workflow.config.json", "{}");
      if (scenario === "branch-introduces-policy") write(".agents/mono-workflow.config.json", JSON.stringify({ landing: policy }));
      write("task.md", "task\n"); git("add", "."); git("commit", "-m", "task");
      if (scenario === "inherited-after-rebase") {
        git("checkout", "main"); write("CHANGELOG.md", "sibling release\n"); git("add", "."); git("commit", "-m", "sibling release"); git("checkout", "task"); git("rebase", "main");
      }
      const head = git("rev-parse", "HEAD"), base = git("merge-base", "main", head);
      if (scenario === "rename") assert.ok(changedPaths(repo, base, head).includes("CHANGELOG.md"));
      if (scenario === "inherited-after-rebase") assert.ok(!changedPaths(repo, base, head).includes("CHANGELOG.md"));
      const pinsFile = path.join(root, "dispatch/MONO-999-a1/pins.json");
      const pins = { base: launchBase, release: scenario === "release", product: "fixture", root, worktree: repo, skillsRoot: skills, baseRef: "main", evidenceRoot: evidence,
        risk: "deep", critical: null, verification: { command: process.execPath, args: ["-e", "process.exit(0)"] }, workerWritableRoots: [repo], reviewDataset: null, reviewDatasetVersion: 0, reviewDatasetDigest: null };
      atomicJson(pinsFile, pins); const binding = { file: pinsFile, digest: sha256File(pinsFile) };
      atomicJson(path.join(root, "workers.json"), { "MONO-999": { issue: "MONO-999", attempt: 1, stage: "mono-deliver", worktree: repo, packVersion: "fixture", sourceCommit: launchBase, surfaceRevision: 4, pins: binding, pinsVersion: 0 } });
      const request = { ...pins, head, collectionId: `preflight-collect:${head}:1`, pins: binding, collect: false }; delete request.reviewDatasetDigest; delete request.reviewDataset;
      if (scenario === "forged-release") request.release = true;
      if (scenario === "no-pins") delete request.pins;
      const file = path.join(scratch, "request.json");
      const refused = ["file-edit", "prefix-edit", "rename", "forged-release", "branch-removes-policy", "no-pins"].includes(scenario);
      for (const collect of refused ? [false, true] : [false]) {
        atomicJson(file, { ...request, collect });
        const r = spawnSync(process.execPath, ["scripts/gate.mjs", "preflight", "--request", file], { encoding: "utf8" });
        assert.equal(r.status, refused ? 1 : 2, r.stdout + r.stderr);
        if (scenario === "no-pins") assert.match(r.stdout, /landing policy requires pinned dispatch/);
        else if (refused) {
          const touched = scenario === "prefix-edit" ? "shared/new.md" : "CHANGELOG.md";
          assert.ok(r.stdout.includes(`serial path touched: ${touched}`), r.stdout);
          assert.ok(r.stdout.includes(`landing.serialPaths on ${launchBase}`), r.stdout);
          assert.ok(r.stdout.includes("write changelog.d/<KEY>.md or dispatch a release task"), r.stdout);
        }
        assert.equal(fs.existsSync(path.join(evidence, `${head}.json`)), false, "no review receipt processed or collected");
      }
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  });
});

test("landing U2 amendment cannot change release", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-landing-pins-"));
  try {
    const file = path.join(root, "pins.json"); atomicJson(file, { release: false });
    const entry = { pins: { file, digest: sha256File(file) }, pinsVersion: 1 };
    atomicJson(path.join(root, "pins.v1.json"), { pinsVersion: 1, risk: "deep" });
    assert.equal(effectivePins(entry).release, false);
    atomicJson(path.join(root, "pins.v1.json"), { pinsVersion: 1, release: true });
    assert.throws(() => effectivePins(entry), /release.*immutable/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("landing U2 two releases are refused under launch.lock, including direct spawn availability", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-landing-release-"));
  try {
    atomicJson(path.join(root, "control.json"), { state: "active" });
    const binding = key => { const file = path.join(root, `dispatch/${key}-a1/pins.json`); atomicJson(file, { release: true }); return { file, digest: sha256File(file) }; };
    const first = binding("MONO-998"), second = binding("MONO-999");
    atomicJson(path.join(root, "workers.json"), { "MONO-998": { issue: "MONO-998", pins: first, pinsVersion: 0, pid: null } });
    const request = { root, issue: "MONO-999", pins: second, config: {} };
    await withLock(path.join(root, "launch.lock"), () => assert.throws(() => checkSpawnAvailability(request), /release.*MONO-998/));
    atomicJson(path.join(root, "workers.json"), {});
    await withLock(path.join(root, "launch.lock"), () => assert.doesNotThrow(() => checkSpawnAvailability(request)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("landing U2 dispatch renders landing block only with BASE policy", () => {
  const template = "before\n<!-- landing:start -->\n## Посадка\n{{landing_paths}}\n{{landing_fragments}}\n{{landing_release}}\n<!-- landing:end -->\nafter";
  assert.equal(renderDispatch(template, {}), "before\nafter");
  assert.match(renderDispatch(template, { landing_paths: "CHANGELOG.md", landing_fragments: "changelog.d", landing_release: "false" }), /## Посадка/);
});

test("landing U2 installed dispatch validates release and reserves a single release for direct spawn", async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-landing-dispatch-"));
  const skills = path.join(scratch, "skills"), repo = path.join(scratch, "repo"), root = path.join(scratch, "root"), bin = path.join(scratch, "bin");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MONO_WORKFLOW_STATE_ROOT: path.join(scratch, "state"), MONO_WORKFLOW_KNOWN_ROOTS: skills,
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const run = (cmd, args, cwd = process.cwd()) => spawnSync(cmd, args, { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const pass = r => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout.trim(); };
  const git = (...args) => pass(run("git", args, repo));
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  let pid;
  try {
    for (const dir of [repo, bin, root]) fs.mkdirSync(dir, { recursive: true });
    pass(run(process.execPath, ["scripts/install-local.mjs", "--skills-root", skills]));
    write(path.join(bin, "codex"), '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"landing-fixture"}));setInterval(()=>{},1000);\n'); fs.chmodSync(path.join(bin, "codex"), 0o700);
    atomicJson(path.join(root, "control.json"), { state: "active" }); atomicJson(path.join(root, "workers.json"), {});
    git("init", "-b", "main"); const origin = path.join(scratch, "origin.git"); pass(run("git", ["init", "--bare", origin])); git("remote", "add", "origin", origin);
    const config = JSON.parse(fs.readFileSync(".agents/mono-workflow.config.json"));
    config.orchestration.dispatch = { product: "landing", evidenceRoot: path.join(scratch, "evidence"), openDecisions: 0, lifecycle_moves: [], verification: { command: "node", args: ["scripts/verify.mjs"] } };
    const configFile = path.join(repo, ".agents/mono-workflow.config.json"); write(configFile, JSON.stringify(config)); write(path.join(repo, ".gitignore"), ".worktrees/\n");
    git("add", "."); git("commit", "-m", "base"); git("push", "origin", "main");
    const snapshot = path.join(scratch, "snapshot");
    write(path.join(snapshot, "issue-MONO-999.md"), "# Landing fixture\n# Что сделать\nLanding.\n# Готовность агента\nAFK\n# Покрытие PRD/Spec\nU1\n# Как проверить\nLanding.\n# Ключевые контракты\nLanding.\nРиск: standard\n");
    for (const file of ["approval.md", "project-brief.md", "prd.md", "tech-spec.md"]) write(path.join(snapshot, file), "Approved landing fixture.\n");
    const runtime = path.join(skills, ".mono-agent-workflow/scripts"), extras = path.join(scratch, "roots.json"); atomicJson(extras, [path.join(scratch, "temp")]); fs.mkdirSync(path.join(scratch, "temp"));
    const args = [path.join(runtime, "orchestrator/dispatch.mjs"), "--root", root, "--config", configFile, "--snapshot", snapshot, "--issue", "MONO-999", "--profile", "full", "--worker-writable-roots", extras];
    await t.test("invalid-release-flag", () => {
      for (const value of ["yes", "TRUE", "1"]) { const r = run(process.execPath, [...args, "--release", value]); assert.equal(r.status, 1); assert.match(r.stderr, /--release must be true or false/); }
      assert.equal(fs.existsSync(path.join(root, "attempts.json")), false);
    });
    await t.test("no-policy-dispatch", () => {
      const launched = JSON.parse(pass(run(process.execPath, args))); pid = launched.pid;
      const pins = JSON.parse(fs.readFileSync(launched.pins.file)); assert.equal(pins.release, false);
      assert.equal(fs.readFileSync(launched.dispatchFile, "utf8").includes("## Посадка"), false);
      process.kill(pid, "SIGTERM"); pid = null; atomicJson(path.join(root, "workers.json"), {});
    });
    config.landing = { serialPaths: ["CHANGELOG.md"], changelog: { fragmentDir: "changelog.d", target: "CHANGELOG.md", heading: "## [Unreleased]" } };
    write(configFile, JSON.stringify(config)); git("add", ".agents/mono-workflow.config.json"); git("commit", "-m", "enable landing"); git("push", "origin", "main");
    // A new dispatch still reuses its existing task worktree, whose branch can
    // change config independently. Rendering must use the new main BASE.
    const worktree = path.join(repo, ".worktrees/MONO-999"); pass(run("git", ["reset", "--hard", "origin/main"], worktree));
    await t.test("release-dispatch-and-direct-second-release", () => {
      const launched = JSON.parse(pass(run(process.execPath, [...args, "--release", "true"]))); pid = launched.pid;
      const pins = JSON.parse(fs.readFileSync(launched.pins.file)); assert.equal(pins.release, true);
      const text = fs.readFileSync(launched.dispatchFile, "utf8"); assert.match(text, /## Посадка/); assert.match(text, /Каталог записей: changelog.d/); assert.match(text, /Задача-релиз: true/);
      const request = JSON.parse(fs.readFileSync(launched.spawnFile)); request.issue = "MONO-998";
      const direct = path.join(scratch, "direct.json"); atomicJson(direct, request);
      const r = run(process.execPath, [path.join(runtime, "orchestrator/spawn.mjs"), "--request", direct]);
      assert.equal(r.status, 1); assert.match(r.stderr, /release task already registered: MONO-999/);
      assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(root, "workers.json")))).length, 1);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, "attempts.json")))["MONO-998"], undefined);
    });
  } finally { if (pid) process.kill(pid, "SIGTERM"); fs.rmSync(scratch, { recursive: true, force: true }); }
});
