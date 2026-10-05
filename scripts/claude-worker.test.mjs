import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { copyPluginFixture } from "./plugin-fixture.mjs";
import { workerTransport } from "./worker-transport.mjs";
import { requiredPairings } from "./runtime.mjs";

const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};

test("Claude adapter pins stdin, session, model, effort, and closed tool sources", () => {
  const transport = workerTransport("claude-cli");
  assert.ok(transport, "managed Claude adapter must exist");
  const entry = { thread_id: crypto.randomUUID(), model_launch: { model_parameter: "fixture-model", effort_parameter: "high" },
    settingsFile: "/fixture/control/settings.json" };
  for (const resume of [false, true]) {
    const invocation = transport.invocation(entry, { prompt: "fixture task", resume });
    assert.equal(invocation.command, "claude");
    assert.equal(invocation.stdin, "fixture task");
    assert.equal(invocation.args.includes("fixture task"), false);
    const value = key => invocation.args[invocation.args.indexOf(key) + 1];
    assert.equal(value(resume ? "--resume" : "--session-id"), entry.thread_id);
    assert.equal(value("--model"), "fixture-model");
    assert.equal(value("--effort"), "high");
    assert.equal(value("--settings"), entry.settingsFile);
    assert.equal(value("--setting-sources"), "");
    assert.equal(value("--mcp-config"), '{"mcpServers":{}}');
    assert.ok(invocation.args.includes("--strict-mcp-config"));
    assert.ok(!invocation.args.includes("--dangerously-skip-permissions"));
  }
});

const cliStub = String.raw`#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2), value = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
if (args.includes("auth")) {
  const auth = JSON.parse(fs.readFileSync(path.join(__dirname, "auth.json")));
  console.log(JSON.stringify(auth)); process.exit(auth.loggedIn ? 0 : 1);
}
let input = ""; process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const mode = input.startsWith("{") ? JSON.parse(input).mode : "success";
  const session = value("--session-id") || value("--resume");
  fs.writeFileSync(path.join(process.cwd(), "observed.json"), JSON.stringify({args, input, envKeys: Object.keys(process.env),
    tmpdir:process.env.TMPDIR, claudeTmpdir:process.env.CLAUDE_CODE_TMPDIR,
    githubConfigDir:process.env.GH_CONFIG_DIR, githubConfigMode:fs.statSync(process.env.GH_CONFIG_DIR).mode & 0o777,
    githubConfigEntries:fs.readdirSync(process.env.GH_CONFIG_DIR),
    tempPrepared:fs.statSync(path.join(process.env.CLAUDE_CODE_TMPDIR, "claude-" + process.getuid())).isDirectory()}));
  const emit = event => console.log(JSON.stringify(event));
  const run = () => {
  const init = {type:"system",subtype:"init",session_id:session,model:value("--model"),permissionMode:"dontAsk",
    apiKeySource:"none",mcp_servers:[],tools:["Bash","Read","Edit","Write","NotebookEdit","Glob","Grep"]};
  if (mode === "wrong-model") init.model = "other-model";
  if (mode === "wrong-session") init.session_id = "other-session";
  if (mode === "unknown-tool") init.tools.push("NewNetworkTool");
  if (mode === "connector") init.mcp_servers.push({name:"fixture"});
  if (mode === "wrong-mode") init.permissionMode = "bypassPermissions";
  if (mode === "api-key") init.apiKeySource = "environment";
  if (mode !== "no-identity") emit(init);
  if (mode === "login-error") {
    emit({type:"result",is_error:true,subtype:"error_during_execution",session_id:session,errors:["Not logged in. Run claude auth login"]});
    return;
  }
  const reply = () => emit({type:"assistant",session_id:session,
    message:{model:value("--model"),content:[{type:"text",text:"fixture response"}]}});
  if (mode === "late-response") setTimeout(reply, 2000);
  else if (mode !== "no-response") reply();
  if (mode === "live") setInterval(() => {}, 1000);
  };
  if (mode === "leak") {
    const secret = process.env.GH_TOKEN;
    process.stdout.write(secret.slice(0, 7));
    process.stderr.write("fixture diagnostic " + secret + "\n");
    setTimeout(() => { process.stdout.write(secret.slice(7) + "\n"); run(); }, 10);
  } else run();
});
`;

async function fixture(run, { auth, config, missingTool = false, shortWindow = false } = {}) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-")));
  const repo = path.join(scratch, "repo"), root = path.join(scratch, "control"), pack = path.join(scratch, "pack"),
    skills = path.join(scratch, "skills"), bin = path.join(scratch, "bin"), temp = path.join(scratch, "temp");
  const savedEnv = { ...process.env };
  let runtime;
  try {
    for (const dir of [repo, root, skills, bin, temp]) fs.mkdirSync(dir);
    copyPluginFixture(pack);
    // The stub has no Unix socket path limit. Only its copied pack relaxes that
    // named constant; pure cases below exercise the real production bound.
    const adapterFile = path.join(pack, "scripts/transports/claude-cli.mjs");
    const adapterSource = fs.readFileSync(adapterFile, "utf8");
    const nativeLimit = "const maximumTemporaryPathBytes = 44;";
    assert.ok(adapterSource.includes(nativeLimit));
    fs.writeFileSync(adapterFile, adapterSource.replace(nativeLimit,
      "const maximumTemporaryPathBytes = Number.MAX_SAFE_INTEGER;"));
    if (shortWindow) {
      const file = path.join(pack, "scripts/transports/claude-cli.mjs");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("startupTimeoutMs: 120_000", "startupTimeoutMs: 250"));
    }
    runtime = await import(pathToFileURL(path.join(pack, "scripts/orchestrator/launch.mjs")));
    const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const cfg = config ?? { orchestration: { transport: "claude-cli", delivery: { confirmationTimeoutSec: 1200 } } };
    write(path.join(repo, ".agents/mono-workflow.config.json"), cfg);
    git("init", "-b", "fixture");
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
    write(path.join(root, "control.json"), { state: "active", halt: false });
    write(path.join(root, "workers.json"), {});
    write(path.join(bin, "auth.json"), auth ?? { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" });
    if (!missingTool) { write(path.join(bin, "claude"), cliStub); fs.chmodSync(path.join(bin, "claude"), 0o700); }
    write(path.join(bin, "gh"), '#!/usr/bin/env node\nprocess.stdout.write(process.env.FIXTURE_GH_INPUT);\n');
    fs.chmodSync(path.join(bin, "gh"), 0o700);
    // The synthetic credential exists only in process memory/environment.
    const secret = crypto.randomBytes(30).toString("hex");
    for (const [name, target] of [["node", process.execPath], ["git", "/usr/bin/git"], ["ps", "/bin/ps"], ["date", "/bin/date"]]) fs.symlinkSync(target, path.join(bin, name));
    Object.assign(process.env, { PATH: bin, FIXTURE_GH_INPUT: secret,
      GH_CONFIG_DIR: path.join(scratch, "github-config"), XDG_CONFIG_HOME: path.join(scratch, "xdg"),
      ANTHROPIC_API_KEY: secret, ANTHROPIC_BASE_URL: "https://provider.example.invalid",
      OPENAI_API_KEY: secret, CLAUDE_CODE_OAUTH_TOKEN: secret });
    const roots = [repo, path.join(repo, ".git"), path.join(root, "reports"), temp].sort();
    const request = { root, issue: "MONO-999", worktree: repo, branch: "fixture", base: git("rev-parse", "HEAD"),
      packRoot: pack, skillsRoot: skills, packVersion: fs.readFileSync(path.join(pack, "VERSION"), "utf8").trim(), surfaceRevision: 4,
      role: "worker-claude", transport: "claude-cli", dispatchFile: path.join(root, "task.md"),
      evidenceRoot: path.join(scratch, "evidence"), writable_roots: [temp], workerWritableRoots: roots,
      gates: [], lifecycle_moves: [], config: path.join(repo, ".agents/mono-workflow.config.json"),
      product_name: "fixture", handshake: "resume", profile: "full" };
    const start = mode => { write(request.dispatchFile, JSON.stringify({ mode })); return runtime.spawnWorker(request); };
    const registry = () => JSON.parse(fs.readFileSync(path.join(root, "workers.json")));
    await run({ scratch, repo, root, bin, pack, request, start, registry, runtime, secret, git });
  } finally {
    const file = path.join(root, "workers.json");
    if (fs.existsSync(file)) for (const entry of Object.values(JSON.parse(fs.readFileSync(file)))) {
      if (entry.pid) { try { process.kill(entry.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
    }
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test("managed Claude launch and resume use pinned identity, rights, and credential-free artifacts", async () => {
  await fixture(async ({ start, registry, repo, root, request, runtime, secret }) => {
    const launched = await start("leak");
    let entry = registry()["MONO-999"];
    assert.equal(launched.thread_id, entry.thread_id);
    assert.equal(entry.transport, "claude-cli");
    assert.equal(entry.model_launch.actual_model, entry.model_launch.model_parameter);
    assert.equal(entry.model_launch.auth_requested, "subscription");
    assert.equal(entry.model_launch.auth_observed, "claude.ai");
    assert.equal(entry.model_launch.effort_observed, null);
    assert.equal(entry.model_launch.effort_source, "requested");
    const settings = JSON.parse(fs.readFileSync(entry.settingsFile));
    assert.equal(settings.permissions.defaultMode, "dontAsk");
    assert.deepEqual(settings.sandbox.filesystem.allowWrite, entry.workerWritableRoots);
    assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
    assert.equal(settings.sandbox.enabled, true);
    assert.equal(settings.sandbox.failIfUnavailable, true);
    assert.equal(settings.sandbox.network.strictAllowlist, true);
    assert.equal("tlsTerminate" in settings.sandbox.network, false);
    assert.equal("credentials" in settings.sandbox, false);
    const credentialPaths = [...entry.githubCredentialPaths];
    assert.ok(credentialPaths.includes(process.env.GH_CONFIG_DIR));
    assert.ok(credentialPaths.includes(path.join(process.env.XDG_CONFIG_HOME, "gh")));
    for (const value of credentialPaths) {
      assert.ok(settings.sandbox.filesystem.denyRead.includes(value));
      assert.ok(settings.permissions.deny.includes("Read(/" + value + ")"));
      assert.ok(settings.permissions.deny.includes("Read(/" + value + "/**)"));
    }
    assert.ok(settings.sandbox.filesystem.denyWrite.includes(fs.realpathSync("/tmp") + "/claude-" + process.getuid()));
    for (const directory of [fs.realpathSync("/tmp") + "/claude", path.join(os.homedir(), ".npm/_logs"), path.join(os.homedir(), ".claude/debug")])
      assert.ok(settings.sandbox.filesystem.denyWrite.includes(directory));
    assert.ok(settings.permissions.deny.includes("WebFetch"));
    assert.ok(settings.permissions.deny.includes("WebSearch"));
    assert.ok(settings.sandbox.network.allowedDomains.every(domain => !domain.includes("linear")));
    const observed = JSON.parse(fs.readFileSync(path.join(repo, "observed.json")));
    assert.ok(observed.envKeys.includes("USER"));
    assert.ok(observed.envKeys.includes("GH_TOKEN"));
    assert.equal(observed.githubConfigDir, entry.githubConfigDir);
    assert.equal(observed.githubConfigMode, 0o700);
    assert.deepEqual(observed.githubConfigEntries, []);
    assert.ok(entry.workerWritableRoots.some(value => observed.githubConfigDir.startsWith(value + path.sep)));
    for (const value of credentialPaths) assert.equal(observed.githubConfigDir === value || observed.githubConfigDir.startsWith(value + path.sep), false);
    assert.equal(entry.processGroup, entry.pid);
    assert.equal(observed.tmpdir, repo);
    assert.equal(observed.claudeTmpdir, repo);
    assert.equal(observed.tempPrepared, true);
    assert.ok(entry.workerWritableRoots.includes(fs.realpathSync(observed.claudeTmpdir)));
    assert.ok(fs.statSync(path.join(repo, "claude-" + process.getuid())).isDirectory());
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "FIXTURE_GH_INPUT", "XDG_CONFIG_HOME"])
      assert.equal(observed.envKeys.includes(key), false, key);
    // Let the detached fixture exit and release its process before resume.
    while (true) { try { process.kill(entry.pid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 20)); }
    fs.writeFileSync(entry.settingsFile, "{}");
    fs.rmSync(path.join(repo, "claude-" + process.getuid()), { recursive: true });
    write(request.config, { orchestration: { transport: "codex-cli" } });
    process.env.GH_CONFIG_DIR = path.join(root, "new-github-config");
    const resumeFile = path.join(root, "resume.md"); write(resumeFile, '{"mode":"success"}');
    await runtime.resumeWorker({ root, issue: request.issue, resumeFile });
    entry = registry()["MONO-999"];
    const resumed = JSON.parse(fs.readFileSync(path.join(repo, "observed.json")));
    assert.equal(resumed.tempPrepared, true);
    assert.equal(resumed.githubConfigDir, observed.githubConfigDir);
    assert.equal(resumed.githubConfigMode, 0o700);
    assert.deepEqual(resumed.githubConfigEntries, []);
    assert.equal(resumed.claudeTmpdir, repo);
    assert.ok(resumed.args.includes("--resume"));
    assert.ok(resumed.args.includes(launched.thread_id));
    assert.ok(resumed.args.includes(entry.model_launch.model_parameter));
    assert.deepEqual(JSON.parse(fs.readFileSync(entry.settingsFile)).sandbox.filesystem.allowWrite, entry.workerWritableRoots);
    const resumedSettings = JSON.parse(fs.readFileSync(entry.settingsFile));
    assert.ok(resumedSettings.sandbox.filesystem.denyRead.includes(process.env.GH_CONFIG_DIR));
    for (const value of credentialPaths) {
      assert.ok(entry.githubCredentialPaths.includes(value));
      assert.ok(resumedSettings.sandbox.filesystem.denyRead.includes(value));
      assert.ok(resumedSettings.permissions.deny.includes("Read(/" + value + ")"));
    }
    const files = [path.join(root, "workers.json"), entry.log, entry.log.replace(/\.jsonl$/, ".stderr.log"),
      request.dispatchFile, entry.settingsFile, path.join(repo, "observed.json")];
    for (const file of files) assert.equal(fs.readFileSync(file, "utf8").includes(secret), false, file);
  });
});

test("Claude refuses long and multibyte temporary paths before an unpinned fallback", () => {
  const adapter = workerTransport("claude-cli");
  assert.throws(() => adapter.temporaryDirectory(["/fixture/" + "x".repeat(60)]), /short pinned temporary/);
  assert.throws(() => adapter.temporaryDirectory(["/fixture/" + "é".repeat(20)]), /short pinned temporary/);
  assert.equal(adapter.temporaryDirectory(["/fixture/" + "x".repeat(60), "/fixture/temp"]), "/fixture/temp");
  assert.equal(adapter.temporaryDirectory(["/fixture/temp", "/fit", "/fixture/short"]), "/fit");
  const name = "claude-" + process.getuid();
  const boundary = "/" + "x".repeat(44 - Buffer.byteLength("/" + name) - 1);
  assert.equal(Buffer.byteLength(path.join(boundary, name)), 44);
  assert.equal(adapter.temporaryDirectory([boundary]), boundary);
  assert.throws(() => adapter.temporaryDirectory([boundary + "x"]), /grant a short scratch path and retry/);
});

test("Claude refuses write paths that the shell sandbox would interpret as globs", () => {
  const adapter = workerTransport("claude-cli");
  for (const root of ["/fixture/run[12]", "/fixture/run?", "/fixture/run*"])
    assert.throws(() => adapter.settings([root], [], ["/fixture/github"]), /glob characters/);
  assert.throws(() => adapter.settings(["/fixture/work"], ["/fixture/control[12]"], ["/fixture/github"]), /glob characters/);
  assert.doesNotThrow(() => adapter.settings(["/fixture/work"], ["/fixture/control"], ["/fixture/github"]));
});

test("GitHub source restrictions cover default, overridden and symlinked credential paths", () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gh-source-")));
  try {
    const home = path.join(scratch, "home"), config = path.join(scratch, "custom"),
      xdg = path.join(scratch, "xdg"), target = path.join(scratch, "empty-source");
    fs.mkdirSync(config); fs.writeFileSync(target, "");
    fs.symlinkSync(target, path.join(config, "hosts.yml"));
    const adapter = workerTransport("claude-cli");
    const paths = adapter.githubCredentialPaths({ HOME: home, GH_CONFIG_DIR: config, XDG_CONFIG_HOME: xdg });
    const policy = adapter.settings([path.join(scratch, "work")], [], paths);
    for (const value of [path.join(home, ".config/gh"), config, path.join(xdg, "gh"), target]) {
      assert.ok(paths.includes(value));
      assert.ok(policy.sandbox.filesystem.denyRead.includes(value));
      assert.ok(policy.sandbox.filesystem.denyWrite.includes(value));
      assert.ok(policy.permissions.deny.includes("Read(/" + value + ")"));
      assert.ok(policy.permissions.deny.includes("Edit(/" + value + ")"));
    }
    assert.throws(() => adapter.settings(["/fixture/work"], []), /credential source protections missing/);
    assert.throws(() => adapter.githubCredentialPaths({ HOME: home, GH_CONFIG_DIR: config + "[*]" }), /glob characters/);
    const relative = adapter.githubCredentialPaths({ HOME: home, GH_CONFIG_DIR: "custom", XDG_CONFIG_HOME: "xdg" }, scratch);
    for (const value of [config, path.join(xdg, "gh"), target]) assert.ok(relative.includes(value));
    const escaped = adapter.settings(["/fixture/work"], [], ["/fixture/github\\config"]);
    assert.ok(escaped.permissions.deny.includes("Read(//fixture/github\\\\config)"));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("Claude internal temporary directory cannot follow a symlink outside pinned grants", async () => {
  await fixture(async ({ request, start, registry, repo, git }) => {
    fs.mkdirSync(request.evidenceRoot);
    fs.symlinkSync(request.evidenceRoot, path.join(repo, "claude-" + process.getuid()));
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "temporary symlink fixture");
    request.base = git("rev-parse", "HEAD");
    await assert.rejects(start("success"), /internal temporary directory/);
    assert.deepEqual(registry(), {});
  });
});

test("Claude refuses an unusable internal temporary path before launch", async () => {
  await fixture(async ({ start, registry, repo, git, request }) => {
    fs.writeFileSync(path.join(repo, "claude-" + process.getuid()), "occupied");
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "unusable temporary fixture");
    request.base = git("rev-parse", "HEAD");
    await assert.rejects(start("success"), /internal temporary directory/);
    assert.deepEqual(registry(), {});
  });
});

test("Claude startup refuses missing identity, response, login, wrong identity, and uncovered tools with retained attempts", async t => {
  for (const [mode, reason] of [
    ["wrong-model", /model/], ["wrong-session", /session/], ["no-identity", /identity/], ["no-response", /response/],
    ["login-error", /auth login/], ["unknown-tool", /policy/], ["connector", /connector/], ["wrong-mode", /permission/],
    ["api-key", /subscription/], ["late-response", /response/],
  ]) await t.test(mode, () => fixture(async ({ start, registry, root }) => {
    await assert.rejects(start(mode), reason);
    const entry = registry()["MONO-999"];
    assert.equal(entry.attempt, 1);
    assert.equal(entry.startup.status, "refused");
    assert.ok(fs.existsSync(entry.log));
    if (mode === "wrong-model") assert.equal(entry.model_launch.actual_model, "other-model");
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "attempts.json")))["MONO-999"], 1);
  }, { shortWindow: mode === "late-response" }));
});

test("Claude pre-registration refusals preserve the attempt budget", async t => {
  for (const [name, options, mutate, reason] of [
    ["missing-tool", { missingTool: true }, () => {}, /install|Claude Code/],
    ["no-subscription", { auth: { loggedIn: false } }, () => {}, /auth login/],
    ["key-login", { auth: { loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" } }, () => {}, /subscription/],
    ["wrong-role", {}, request => request.role = "worker-default", /role/],
    ["wait-handshake", {}, request => request.handshake = "wait", /resume/],
    ["grant-mismatch", {}, request => request.workerWritableRoots.pop(), /grants/],
    ["unaccepted-pair", { config: { orchestration: { transport: "claude-cli" },
      models: { roles: { "worker-claude": { model: "unaccepted-model" } } } } }, () => {}, /pair/],
  ]) await t.test(name, () => fixture(async ({ request, start, registry, root }) => {
    mutate(request);
    await assert.rejects(start("success"), reason);
    assert.deepEqual(registry(), {});
    assert.equal(fs.existsSync(path.join(root, "attempts.json")), false);
  }, options));
  for (const provider of [
    { id: "anthropic", endpoint: "https://other.example.invalid", credentialEnv: "ANTHROPIC_API_KEY" },
    { id: "anthropic", endpoint: null, credentialEnv: "ANTHROPIC_API_KEY" },
  ]) await t.test("incompatible-native-route-" + Object.keys(provider).at(-1), async () => {
    const config = { orchestration: { transport: "claude-cli" }, models: { roles: { "worker-claude": { provider } } } };
    config.models.pairingAccepted = requiredPairings(config).map(pair => ({ ...pair,
      linearDecision: "https://linear.app/example/issue/MONO-999#comment-approval", by: "owner", date: "2026-10-06" }));
    await fixture(async ({ start, registry }) => {
      await assert.rejects(start("success"), /native|endpoint|credential/);
      assert.deepEqual(registry(), {});
    }, { config });
  });
});

test("Claude startup grants bind the immutable pins file, including symlink targets", async () => {
  await fixture(async ({ request, root, start, registry }) => {
    const file = path.join(root, "dispatch/pins.json");
    const bytes = JSON.stringify({ workerWritableRoots: [request.worktree] });
    write(file, bytes);
    request.pins = { file, digest: crypto.createHash("sha256").update(bytes).digest("hex") };
    await assert.rejects(start("success"), /immutable attempt pins/);
    assert.deepEqual(registry(), {});
    delete request.pins;
    const link = path.join(request.worktree, "evidence-link");
    fs.mkdirSync(request.evidenceRoot);
    fs.symlinkSync(request.evidenceRoot, link);
    request.writable_roots.push(link);
    request.workerWritableRoots.push(link);
    // Keep the source clean so the rights check, rather than the start gate, decides.
    fs.rmSync(link);
    const outsideLink = path.join(root, "evidence-link");
    fs.symlinkSync(request.evidenceRoot, outsideLink);
    request.writable_roots[request.writable_roots.length - 1] = outsideLink;
    request.workerWritableRoots[request.workerWritableRoots.length - 1] = outsideLink;
    await assert.rejects(start("success"), /evidenceRoot/);
    assert.deepEqual(registry(), {});
  });
});

test("installed dispatch selects Claude role and transport from immutable BASE", async () => {
  await fixture(async ({ scratch, repo, root, pack, request, registry, git }) => {
    const config = JSON.parse(fs.readFileSync(request.config));
    config.projectName = "Fixture";
    config.orchestration.dispatch = { product: "fixture", evidenceRoot: request.evidenceRoot, openDecisions: 0,
      verification: { command: "node", args: ["scripts/verify.mjs"] }, lifecycle_moves: [] };
    write(request.config, config);
    write(path.join(repo, ".gitignore"), ".worktrees/\n");
    git("add", "."); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "dispatch fixture");
    const origin = path.join(scratch, "origin.git");
    execFileSync("git", ["init", "--bare", origin], { stdio: "ignore" });
    git("remote", "add", "origin", origin); git("push", "origin", "HEAD:main");
    const snapshot = path.join(scratch, "snapshot");
    write(path.join(snapshot, "issue-MONO-999.md"), "# Fixture\n# Что сделать\nLaunch fixture.\n# Как проверить\nFixture only.\n# Ключевые контракты\nNo live model.\n# Готовность агента\nAFK\nРиск: standard\n");
    for (const name of ["approval.md", "project-brief.md", "prd.md", "tech-spec.md"]) write(path.join(snapshot, name), "Approved fixture.");
    const extras = path.join(scratch, "extras.json"); write(extras, request.writable_roots);
    const result = spawnSync(process.execPath, [path.join(pack, "scripts/orchestrator/dispatch.mjs"),
      "--issue", request.issue, "--root", root, "--config", request.config, "--snapshot", snapshot,
      "--full-snapshot", "--skills-root", request.skillsRoot, "--worker-writable-roots", extras], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const entry = registry()["MONO-999"];
    assert.equal(entry.transport, "claude-cli");
    assert.equal(entry.model_policy.role, "worker-claude");
    const dispatch = fs.readFileSync(path.join(root, "dispatch/MONO-999-a1/dispatch.md"), "utf8");
    assert.match(dispatch, /Transport: claude-cli/);
    assert.equal(entry.handshake, "resume");
  });
});

test("Claude resume refuses a live writer and changed pinned grants", async () => {
  await fixture(async ({ start, registry, root, request, runtime, scratch }) => {
    await start("live");
    const resumeFile = path.join(root, "resume.md"); write(resumeFile, '{"mode":"success"}');
    await assert.rejects(runtime.resumeWorker({ root, issue: request.issue, resumeFile }), /still live/);
    const entry = registry()["MONO-999"];
    process.kill(entry.pid, "SIGTERM");
    while (true) { try { process.kill(entry.pid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 20)); }
    await assert.rejects(runtime.resumeWorker({ root, issue: request.issue, resumeFile, workerWritableRoots: [request.worktree] }), /grants/);
    const extra = path.join(scratch, "expanded-grant");
    await assert.rejects(runtime.resumeWorker({ root, issue: request.issue, resumeFile,
      extraWritable: [extra], workerWritableRoots: [...entry.workerWritableRoots, extra] }), /immutable attempt pins/);
    assert.deepEqual(registry()["MONO-999"].workerWritableRoots, entry.workerWritableRoots);
  });
});


test("Claude refuses a GitHub configuration directory overlapping stored sources before registration", async () => {
  await fixture(async ({ start, repo, registry, root }) => {
    process.env.GH_CONFIG_DIR = repo;
    await assert.rejects(start("success"), /GitHub private configuration directory unavailable.*repair the attempt configuration path/);
    assert.deepEqual(registry(), {});
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "launch-refusals/MONO-999-a1.json"))).attempt_registered, false);
  });
});

for (const mode of ["file", "escape"]) test("Claude resume refuses an unusable private GitHub directory: " + mode, async () => {
  await fixture(async ({ start, registry, root, runtime, request, scratch }) => {
    await start("success");
    const entry = registry()["MONO-999"];
    while (true) { try { process.kill(entry.pid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 20)); }
    fs.rmSync(entry.githubConfigDir, { recursive: true });
    if (mode === "file") fs.writeFileSync(entry.githubConfigDir, "");
    else fs.symlinkSync(scratch, entry.githubConfigDir);
    const resumeFile = path.join(root, "resume.md"); write(resumeFile, '{"mode":"success"}');
    await assert.rejects(runtime.resumeWorker({ root, issue: request.issue, resumeFile }), /GitHub private configuration directory unavailable/);
    assert.equal(registry()["MONO-999"].pid, entry.pid);
  });
});

test("Claude resume refuses surviving commands after its journal owner exits", async () => {
  await fixture(async ({ start, registry, root, runtime, request }) => {
    await start("success");
    const entry = registry()["MONO-999"];
    while (true) { try { process.kill(entry.pid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 20)); }
    const leader = spawn(process.execPath, ["-e", `const {spawn}=require("node:child_process");
      const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
      child.unref();`], { detached: true, stdio: "ignore" });
    try {
      await new Promise(resolve => leader.once("exit", resolve));
      assert.throws(() => process.kill(leader.pid, 0), { code: "ESRCH" });
      process.kill(-leader.pid, 0);
      const entries = registry(); entries["MONO-999"].pid = leader.pid;
      entries["MONO-999"].processGroup = leader.pid;
      write(path.join(root, "workers.json"), entries);
      const resumeFile = path.join(root, "resume.md"); write(resumeFile, '{"mode":"success"}');
      await assert.rejects(runtime.resumeWorker({ root, issue: request.issue, resumeFile }), /process group is still live/);
      assert.equal(registry()["MONO-999"].pid, leader.pid);
    } finally { process.kill(-leader.pid, "SIGKILL"); }
  });
});
