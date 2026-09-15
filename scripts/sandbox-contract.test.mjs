import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { runSandboxed } from "./gate.mjs";

// Run outside a worker sandbox: nesting Seatbelt is unsupported on macOS.
// Inside a worker/collector, explicitly skip the unsupported nested host proof.
test("real Codex sandbox permits dispatched writes and denies evidence writes", async t => {
  if (process.platform === "darwin" && (process.env.CODEX_SANDBOX === "seatbelt" || process.env.MONO_DELIVERY_SANDBOX === "1")) {
    t.skip("nested Seatbelt sandbox: run host proof from the orchestrator outside worker sandboxes"); return;
  }
  const available = spawnSync("codex", ["--version"], { encoding: "utf8" });
  if (available.error?.code === "ENOENT") { t.skip("Codex CLI is absent on this fixture host"); return; }
  assert.equal(available.status, 0, available.stderr);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-sandbox-contract-"));
  const repo = path.join(root, "repo"), evidence = path.join(root, "evidence");
  fs.mkdirSync(repo); fs.mkdirSync(evidence);
  try {
    const result = await runSandboxed(process.execPath, ["-e", "const fs=require('node:fs'),os=require('node:os');fs.writeFileSync('allowed','ok');fs.writeFileSync(fs.mkdtempSync(os.tmpdir()+'/fixture-')+'/temp','ok')"], repo, evidence);
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(fs.readFileSync(path.join(repo, "allowed"), "utf8"), "ok");
    assert.deepEqual(fs.readdirSync(evidence), []);
    assert.equal(result.sandbox.probed, true);
    assert.equal(fs.existsSync(result.sandbox.tempRoot), false, "temporary runtime is cleaned after execution");
    const failed = await runSandboxed(process.execPath, ["-e", "process.exit(1)"], repo, evidence);
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.sandbox.probed, true, "command failure does not erase a successful denial probe");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
