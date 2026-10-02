import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { withLock } from "./runtime.mjs";

const script = path.resolve("scripts/orchestrator/landing-guard.mjs");
const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const runCheck = (overrides = {}) => ({ id: 1, name: "validate", head_sha: sha,
  status: "completed", conclusion: "success", completed_at: "2026-10-01T01:00:00Z", ...overrides });
function fixture(t, checks = [runCheck()]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-guard-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, "config.json"), mock = path.join(root, "mock.json"), calls = path.join(root, "calls.jsonl");
  fs.writeFileSync(config, JSON.stringify({ landing: { validation: { check: "validate", timeoutSec: 1800 } } }));
  fs.writeFileSync(mock, JSON.stringify({ checks }));
  fs.writeFileSync(path.join(root, "gh"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2); fs.appendFileSync(process.env.GUARD_CALLS, JSON.stringify(args)+'\\n');
const mock = JSON.parse(fs.readFileSync(process.env.GUARD_MOCK));
if (mock.error) { console.error(mock.error); process.exit(1); }
const endpoint = args[1];
if (!endpoint.includes('/commits/${sha}/check-runs') || !endpoint.includes('filter=all') || !endpoint.includes('per_page=100')) process.exit(71);
const page = Number(new URL('https://fixture/'+endpoint).searchParams.get('page'));
console.log(JSON.stringify({ total_count: mock.checks.length, check_runs: mock.checks.slice((page-1)*100,page*100) }));
`);
  fs.chmodSync(path.join(root, "gh"), 0o755);
  const state = path.join(root, "landing/guard", `${sha}.json`);
  const run = (args = []) => spawnSync(process.execPath, [script, "check", "--repo", "owner/repo", "--sha", sha,
    "--root", root, "--config", config, "--json", ...args], { encoding: "utf8", env: { ...process.env,
      PATH: root + path.delimiter + process.env.PATH, GUARD_MOCK: mock, GUARD_CALLS: calls } });
  const age = () => { const value = JSON.parse(fs.readFileSync(state)); value.firstObservedAt = "2000-01-01T00:00:00Z"; fs.writeFileSync(state, JSON.stringify(value)); };
  const corrective = (reason = "repair main") => spawnSync(process.execPath, [script, "corrective", "--issue", "MONO-108", "--red-sha", sha,
    "--reason", reason, "--root", root], { encoding: "utf8", env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, GUARD_MOCK: mock, GUARD_CALLS: calls } });
  return { root, config, mock, calls, state, run, age, corrective };
}

test("landing U6 success on exact full SHA", t => {
  const f = fixture(t), r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).reason, "completed/success");
  assert.ok(fs.existsSync(f.state));
});

for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "stale", "skipped", "neutral"]) {
  test(`landing U6 terminal stop: ${conclusion} and discovered names`, t => {
    const f = fixture(t, [runCheck({ conclusion }), runCheck({ id: 2, name: "other" })]), r = f.run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout); assert.equal(out.reason, `completed/${conclusion}`);
    assert.deepEqual(out.checks.map(run => run.name), ["validate", "other"]);
  });
}
for (const scenario of ["absent", "other-sha", "unfinished", "not-started", "old-failure-rerun", "old-success-rerun"]) {
  test(`landing U6 pending then deadline stop: ${scenario}`, t => {
    const checks = scenario === "absent" ? [] : scenario === "other-sha" ? [runCheck({ head_sha: otherSha })] :
      scenario === "unfinished" ? [runCheck({ status: "in_progress", completed_at: null, conclusion: null })] :
      scenario === "not-started" ? [runCheck({ status: "queued", completed_at: null, started_at: null, conclusion: null })] :
      [runCheck({ conclusion: scenario === "old-failure-rerun" ? "failure" : "success" }),
        runCheck({ id: 2, status: "in_progress", completed_at: null, conclusion: null })];
    const f = fixture(t, checks); let r = f.run(); assert.equal(r.status, 2, r.stdout + r.stderr);
    const first = JSON.parse(fs.readFileSync(f.state)).firstObservedAt;
    r = f.run(); assert.equal(r.status, 2); assert.equal(JSON.parse(fs.readFileSync(f.state)).firstObservedAt, first);
    f.age(); r = f.run(); assert.equal(r.status, 1); assert.ok(JSON.parse(r.stdout).reason.includes("deadline"));
  });
}
test("landing U6 latest completed_at then greatest id wins, independent of order", t => {
  const f = fixture(t, [runCheck({ id: 50, completed_at: "2026-10-01T02:00:00Z", conclusion: "failure" }),
    runCheck({ id: 51, completed_at: "2026-10-01T02:00:00Z", conclusion: "success" }),
    runCheck({ id: 99, completed_at: "2026-10-01T01:00:00Z", conclusion: "failure" })]);
  let r = f.run(); assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).selected, 51);
  fs.writeFileSync(f.mock, JSON.stringify({ checks: [runCheck(), runCheck({ id: 2, completed_at: "2026-10-01T03:00:00Z", conclusion: "failure" })] }));
  r = f.run(); assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).selected, 2);
});
test("landing U6 success observed after deadline remains success", t => {
  const f = fixture(t, []); assert.equal(f.run().status, 2); f.age();
  fs.writeFileSync(f.mock, JSON.stringify({ checks: [runCheck()] }));
  assert.equal(f.run().status, 0);
});
test("landing U6 reads two pages including pending rerun with filter=all", t => {
  const checks = Array.from({ length: 100 }, (_, i) => runCheck({ id: i + 1, name: i ? "other" : "validate" }));
  checks.push(runCheck({ id: 101, status: "pending", completed_at: null, conclusion: null }));
  const f = fixture(t, checks), r = f.run(); assert.equal(r.status, 2, r.stdout + r.stderr);
  const calls = fs.readFileSync(f.calls, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(calls.length, 2); assert.ok(calls[0][1].includes("page=1")); assert.ok(calls[1][1].includes("page=2"));
  assert.equal(JSON.parse(r.stdout).checks.length, 101);
});
test("landing U6 first GitHub read error starts fixed deadline; errors before and after deadline", t => {
  const f = fixture(t); fs.writeFileSync(f.mock, JSON.stringify({ error: "fixture unavailable" }));
  let r = f.run(); assert.equal(r.status, 2, r.stdout + r.stderr);
  const first = JSON.parse(fs.readFileSync(f.state)).firstObservedAt;
  r = f.run(); assert.equal(r.status, 2); assert.equal(JSON.parse(fs.readFileSync(f.state)).firstObservedAt, first);
  f.age(); r = f.run(); assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).reason, "GitHub read failed at deadline");
});
for (const date of ["1900-01-01T00:00:00Z", "2999-01-01T00:00:00Z"]) {
  test(`landing U6 deadline ignores commit date ${date}`, t => {
    const f = fixture(t, [runCheck({ name: "other", commit: { committer: { date } } })]);
    assert.equal(f.run().status, 2); const first = JSON.parse(fs.readFileSync(f.state)).firstObservedAt;
    assert.ok(Math.abs(Date.parse(first) - Date.now()) < 5000);
    assert.equal(f.run().status, 2); assert.equal(JSON.parse(fs.readFileSync(f.state)).firstObservedAt, first);
    f.age(); assert.equal(f.run().status, 1);
    const calls = fs.readFileSync(f.calls, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(calls.every(args => args[1].includes("/check-runs?")));
  });
}
test("landing U6 short SHA rejected; no configuration is a no-op", t => {
  const f = fixture(t);
  const short = spawnSync(process.execPath, [script, "check", "--repo", "owner/repo", "--sha", "abc", "--root", f.root, "--config", f.config], { encoding: "utf8" });
  assert.equal(short.status, 1); assert.ok(short.stderr.includes("full 40-character SHA")); assert.equal(fs.existsSync(f.state), false);
  fs.writeFileSync(f.config, "{}"); const r = f.run(); assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).reason, "not configured"); assert.equal(fs.existsSync(f.state), false); assert.equal(fs.existsSync(f.calls), false);
});
test("landing U6 corrective red authorization and repeat leave one log line and unchanged state", t => {
  const f = fixture(t, [runCheck({ conclusion: "failure" })]); assert.equal(f.run().status, 1);
  assert.equal(f.corrective().status, 0);
  const state = fs.readFileSync(f.state, "utf8"), ledger = fs.readFileSync(path.join(f.root, "ledger.md"), "utf8");
  assert.equal(f.corrective().status, 0); assert.equal(fs.readFileSync(f.state, "utf8"), state);
  assert.equal(fs.readFileSync(path.join(f.root, "ledger.md"), "utf8"), ledger);
  assert.equal(ledger.trim().split("\n").length, 1); assert.ok(ledger.includes("LANDING-CORRECTIVE"));
  assert.equal(JSON.parse(state).corrective.issue, "MONO-108"); assert.equal(f.corrective("different reason").status, 1);
});
for (const status of ["success", "pending"]) {
  test(`landing U6 corrective refuses ${status}, including fresh recheck`, t => {
    const f = fixture(t, [runCheck({ conclusion: "failure" })]); assert.equal(f.run().status, 1);
    fs.writeFileSync(f.mock, JSON.stringify({ checks: [runCheck(status === "success" ? {} : { status: "waiting", completed_at: null, conclusion: null })] }));
    const r = f.corrective(); assert.equal(r.status, 1); assert.ok(r.stderr.includes("requires check code 1"));
    assert.equal(fs.existsSync(path.join(f.root, "ledger.md")), false);
    assert.equal(JSON.parse(fs.readFileSync(f.state)).corrective, undefined);
  });
}

test("landing U6 policy changes cannot reset an observed deadline", t => {
  const f = fixture(t, []); assert.equal(f.run().status, 2);
  const before = fs.readFileSync(f.state, "utf8");
  fs.writeFileSync(f.config, JSON.stringify({ landing: { validation: { timeoutSec: 3600, check: "validate" } } }));
  const refused = f.run(); assert.equal(refused.status, 1); assert.ok(refused.stderr.includes("immutable"));
  assert.equal(fs.readFileSync(f.state, "utf8"), before);
  fs.writeFileSync(f.config, JSON.stringify({ landing: { validation: { timeoutSec: 1800, check: "validate" } } }));
  assert.equal(f.run().status, 2);
  assert.equal(JSON.parse(fs.readFileSync(f.state)).firstObservedAt, JSON.parse(before).firstObservedAt);
});

test("landing U6 corrective reconciles interruption after ledger append", t => {
  const f = fixture(t, [runCheck({ conclusion: "failure" })]); assert.equal(f.run().status, 1);
  assert.equal(f.corrective().status, 0);
  const ledger = fs.readFileSync(path.join(f.root, "ledger.md"), "utf8"), state = JSON.parse(fs.readFileSync(f.state));
  delete state.corrective; fs.writeFileSync(f.state, JSON.stringify(state));
  assert.equal(f.corrective().status, 0);
  assert.equal(fs.readFileSync(path.join(f.root, "ledger.md"), "utf8"), ledger);
  assert.equal(JSON.parse(fs.readFileSync(f.state)).corrective.issue, "MONO-108");
});

test("landing U6 a hanging GitHub request is bounded and preserves observation", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "gh"), "#!/usr/bin/env node\nprocess.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n");
  const started = Date.now(), r = f.run();
  assert.equal(r.status, 2, r.stdout + r.stderr); assert.ok(Date.now() - started < 15_000);
  assert.equal(JSON.parse(r.stdout).reason, "GitHub read failed"); assert.ok(fs.existsSync(f.state));
});

for (const status of ["success", "pending"]) {
  test(`landing U6 existing corrective authorization still refuses ${status}`, t => {
    const f = fixture(t, [runCheck({ conclusion: "failure" })]); assert.equal(f.run().status, 1);
    assert.equal(f.corrective().status, 0);
    const state = fs.readFileSync(f.state, "utf8"), ledger = fs.readFileSync(path.join(f.root, "ledger.md"), "utf8");
    fs.writeFileSync(f.mock, JSON.stringify({ checks: [runCheck(status === "success" ? {} : { status: "queued", completed_at: null, conclusion: null })] }));
    const r = f.corrective(); assert.equal(r.status, 1); assert.ok(r.stderr.includes("requires check code 1"));
    assert.equal(fs.readFileSync(f.state, "utf8"), state); assert.equal(fs.readFileSync(path.join(f.root, "ledger.md"), "utf8"), ledger);
  });
}
test("landing U6 interruption recovery rejects conflicting journal authorization", t => {
  const f = fixture(t, [runCheck({ conclusion: "failure" })]); assert.equal(f.run().status, 1);
  assert.equal(f.corrective().status, 0);
  const ledger = fs.readFileSync(path.join(f.root, "ledger.md"), "utf8"), value = JSON.parse(fs.readFileSync(f.state));
  delete value.corrective; fs.writeFileSync(f.state, JSON.stringify(value));
  const state = fs.readFileSync(f.state, "utf8"), r = f.corrective("different repair");
  assert.equal(r.status, 1); assert.ok(r.stderr.includes("journal authorization conflict"));
  assert.equal(fs.readFileSync(f.state, "utf8"), state); assert.equal(fs.readFileSync(path.join(f.root, "ledger.md"), "utf8"), ledger);
});

test("landing U6 corrective serializes audit writes with dispatch rollback", async t => {
  const f = fixture(t, [runCheck({ conclusion: "failure" })]); assert.equal(f.run().status, 1);
  await withLock(path.join(f.root, "dispatch.lock"), () => {
    const state = fs.readFileSync(f.state, "utf8"), r = f.corrective();
    assert.equal(r.status, 1, r.stdout + r.stderr); assert.ok(r.stderr.includes("operation locked"));
    assert.equal(fs.readFileSync(f.state, "utf8"), state);
    assert.equal(fs.existsSync(path.join(f.root, "ledger.md")), false);
  });
  assert.equal(f.corrective().status, 0);
  assert.equal(fs.readFileSync(path.join(f.root, "ledger.md"), "utf8").trim().split("\n").length, 1);
});

test("landing U6 corrective restores a missing audit record without changing authorization", t => {
  const f = fixture(t, [runCheck({ conclusion: "failure" })]); assert.equal(f.run().status, 1);
  assert.equal(f.corrective().status, 0);
  const state = fs.readFileSync(f.state, "utf8"), ledger = path.join(f.root, "ledger.md");
  fs.writeFileSync(ledger, "- existing unrelated entry\n");
  assert.equal(f.corrective().status, 0); assert.equal(fs.readFileSync(f.state, "utf8"), state);
  const restored = fs.readFileSync(ledger, "utf8");
  assert.ok(restored.startsWith("- existing unrelated entry\n")); assert.ok(restored.includes("LANDING-CORRECTIVE"));
  assert.equal(f.corrective().status, 0); assert.equal(fs.readFileSync(ledger, "utf8"), restored);
});
