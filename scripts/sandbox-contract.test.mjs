import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { runSandboxed, sandboxWriteRoots } from "./gate.mjs";

// Run outside a worker sandbox: nesting Seatbelt is unsupported on macOS.
// Inside a worker/collector, explicitly skip the unsupported nested host proof.
function hostAvailable(t, darwinOnly = false, {
  platform = process.platform, env = process.env,
  probe = () => spawnSync("codex", ["--version"], { encoding: "utf8" })
} = {}) {
  if (darwinOnly && platform !== "darwin") {
    t.skip("macOS is required for the Darwin collector proof"); return false;
  }
  if (platform === "darwin" && (env.CODEX_SANDBOX === "seatbelt" || env.MONO_DELIVERY_SANDBOX === "1" || env.MONO_WORKER_JOURNAL_IDENTITY)) {
    t.skip("nested Seatbelt sandbox: run host proof from the orchestrator outside worker sandboxes"); return false;
  }
  const available = probe();
  if (available.error?.code === "ENOENT") { t.skip("Codex CLI is absent on this fixture host"); return false; }
  assert.equal(available.status, 0, available.stderr);
  return true;
}

function hostFixture() {
  // Protected fixture directories must be outside Darwin's write grant. The
  // child chooses os.tmpdir() with a host TMPDIR; the collector keeps its own.
  const scratch = spawnSync(process.execPath, ["-e", `
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.stdout.write(fs.mkdtempSync(path.join(os.tmpdir(),'mono-sandbox-contract-')));
`], { env: { ...process.env, ...(process.platform === "darwin" ? { TMPDIR: "/tmp", TMP: "/tmp", TEMP: "/tmp" } : {}) }, encoding: "utf8" });
  assert.equal(scratch.status, 0, scratch.stderr);
  const root = fs.realpathSync(scratch.stdout), repo = path.join(root, "repo"), evidence = path.join(root, "evidence");
  const protectedPaths = { "orchestrator root": path.join(root, "orchestrator"), skillsRoot: path.join(root, "skills"),
    packRoot: path.join(root, "pack"), "autoreview helper real path": path.join(root, "helper", "autoreview") };
  for (const dir of [repo, evidence, protectedPaths["orchestrator root"], protectedPaths.skillsRoot, protectedPaths.packRoot, path.dirname(protectedPaths["autoreview helper real path"])]) fs.mkdirSync(dir);
  fs.writeFileSync(protectedPaths["autoreview helper real path"], "fixture helper");
  return { root, repo, evidence, protectedPaths };
}

test("real Codex sandbox permits dispatched writes and denies evidence writes", async t => {
  if (!hostAvailable(t)) return;
  const { root, repo, evidence, protectedPaths } = hostFixture();
  try {
    const result = await runSandboxed(process.execPath, ["-e", "const fs=require('node:fs'),os=require('node:os');fs.writeFileSync('allowed','ok');fs.writeFileSync(fs.mkdtempSync(os.tmpdir()+'/fixture-')+'/temp','ok')"], repo, evidence, { protectedPaths });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(fs.readFileSync(path.join(repo, "allowed"), "utf8"), "ok");
    assert.deepEqual(fs.readdirSync(evidence), []);
    assert.equal(result.sandbox.probed, true);
    assert.equal(fs.existsSync(result.sandbox.tempRoot), false, "temporary runtime is cleaned after execution");
    const failed = await runSandboxed(process.execPath, ["-e", "process.exit(1)"], repo, evidence, { protectedPaths });
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.sandbox.probed, true, "command failure does not erase a successful denial probe");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("real macOS collector permits atomic Darwin temp writes and denies evidence writes", async t => {
  if (!hostAvailable(t, true)) return;
  const { root, repo, evidence, protectedPaths } = hostFixture();
  try {
    const result = await runSandboxed(process.execPath, ["-e", `
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const darwin=fs.realpathSync(cp.execFileSync('getconf',['DARWIN_USER_TEMP_DIR'],{encoding:'utf8'}).trim());
const directory=fs.mkdtempSync(path.join(darwin,'mono-atomic-proof-'));
try {
  for(const excluded of [process.cwd(),process.env.TMPDIR]) assert.ok(!directory.startsWith(fs.realpathSync(excluded)+path.sep));
  const temporary=path.join(directory,'atomic.tmp'),file=path.join(directory,'atomic.txt');
  fs.writeFileSync(temporary,'Darwin atomic write');fs.renameSync(temporary,file);
  assert.equal(fs.readFileSync(file,'utf8'),'Darwin atomic write');
} finally {fs.rmSync(directory,{recursive:true,force:true});}
`], repo, evidence, { protectedPaths });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(result.sandbox.probed, true);
    assert.deepEqual(fs.readdirSync(evidence), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("real macOS collector builds and tests a minimal SwiftPM package", async t => {
  if (!hostAvailable(t, true)) return;
  const swift = spawnSync("swift", ["--version"], { encoding: "utf8" });
  if (swift.error?.code === "ENOENT") { t.skip("Swift toolchain is absent on this fixture host"); return; }
  assert.equal(swift.status, 0, swift.stderr);
  const version = /Swift version (\d+)\.(\d+)/u.exec(swift.stdout + swift.stderr);
  assert.ok(version, "Swift toolchain version must be identifiable before the host proof");
  if (Number(version[1]) < 5) { t.skip(`SwiftPM proof requires Swift 5.0 or newer; detected ${version[1]}.${version[2]}`); return; }
  const { root, repo, evidence, protectedPaths } = hostFixture();
  try {
    fs.writeFileSync(path.join(repo, "Package.swift"), `// swift-tools-version:5.0
import PackageDescription
let package = Package(name: "CollectorProof", targets: [
    .target(name: "CollectorProof"),
    .testTarget(name: "CollectorProofTests", dependencies: ["CollectorProof"])
])
`);
    fs.mkdirSync(path.join(repo, "Sources/CollectorProof"), { recursive: true });
    fs.writeFileSync(path.join(repo, "Sources/CollectorProof/Proof.swift"), "public func answer() -> Int { 42 }\n");
    fs.mkdirSync(path.join(repo, "Tests/CollectorProofTests"), { recursive: true });
    fs.writeFileSync(path.join(repo, "Tests/CollectorProofTests/ProofTests.swift"), `import XCTest
@testable import CollectorProof
final class ProofTests: XCTestCase {
    func testAnswer() { XCTAssertEqual(answer(), 42) }
}
`);
    // Keep a cold toolchain's module caches within existing worktree grants.
    const cache = path.join(repo, "module-cache");
    const result = await runSandboxed("swift", ["test", "--disable-sandbox"], repo, evidence, {
      protectedPaths, env: { ...process.env, SWIFTPM_MODULECACHE_OVERRIDE: cache, CLANG_MODULE_CACHE_PATH: cache }
    });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(result.sandbox.probed, true);
    assert.match(result.output, /Executed 1 test/u);
    assert.deepEqual(fs.readdirSync(evidence), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("real macOS collector denies a surviving verification descendant access to review artifacts", async t => {
  if (!hostAvailable(t, true)) return;
  const { root, repo, evidence, protectedPaths } = hostFixture();
  const originalHome = process.env.HOME;
  try {
    // A fixture HOME keeps all scratch under os.tmpdir(), outside Darwin's grant.
    process.env.HOME = path.join(root, "home");
    const fixture = path.resolve("scripts/fixtures/collector-review-descendant.cjs");
    const verification = await runSandboxed(process.execPath, [fixture, "verification"], repo, evidence, { protectedPaths });
    assert.equal(verification.exitCode, 0, JSON.stringify(verification));
    const ready = JSON.parse(fs.readFileSync(path.join(repo, ".orchestrator/descendant-ready.json")));
    assert.doesNotThrow(() => process.kill(ready.pid, 0), "detached descendant survives verification completion");
    const review = await runSandboxed(process.execPath, [fixture, "review"], repo, evidence, {
      protectedPaths, reviewArtifacts: true, verificationWritableRoots: sandboxWriteRoots(verification.sandbox), workerWritableRoots: [repo]
    });
    assert.equal(review.exitCode, 1, JSON.stringify(review));
    assert.equal(review.json.overall_correctness, "patch is incorrect");
    assert.equal(review.json.findings[0].priority, 1);
    assert.equal(review.status.status, "findings"); assert.equal(review.status.exit_code, 1);
    const proof = JSON.parse(fs.readFileSync(path.join(repo, ".orchestrator/descendant-attempts.json")));
    assert.equal(proof.parentAlive, false); assert.equal(proof.reviewAlive, true);
    assert.deepEqual(proof.attempts.map(attempt => attempt.target), ["--json-output", "--status-output"].map(flag => review.args[review.args.indexOf(flag) + 1]));
    assert.ok(proof.attempts.every(attempt => ["EPERM", "EACCES", "EROFS"].includes(attempt.result)));
    assert.equal(verification.sandbox.probed, true); assert.equal(review.sandbox.probed, true);
    assert.deepEqual(fs.readdirSync(evidence), []);
    assert.equal(fs.existsSync(review.sandbox.tempRoot), false);
  } finally {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    const ready = path.join(repo, ".orchestrator/descendant-ready.json");
    if (fs.existsSync(ready)) { try { process.kill(JSON.parse(fs.readFileSync(ready)).pid, "SIGTERM"); } catch {} }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Darwin host proof skips a non-authoritative managed Claude worker hint", () => {
  let reason;
  const available = hostAvailable({ skip: value => reason = value }, true, {
    platform: "darwin", env: { MONO_WORKER_JOURNAL_IDENTITY: "synthetic hint" },
    probe: () => { throw new Error("nested sandbox host must not be probed"); }
  });
  assert.equal(available, false);
  assert.match(reason, /nested.*sandbox.*orchestrator/u);
});

test("Darwin host proof still probes outside managed workers", () => {
  let probes = 0;
  assert.equal(hostAvailable({ skip: () => assert.fail("host proof must not skip") }, true, {
    platform: "darwin", env: {}, probe: () => { probes++; return { status: 0, stderr: "" }; }
  }), true);
  assert.equal(probes, 1);
});
