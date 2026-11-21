import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { admitRound, recordResult, readLedger, inFlight, waitForRound, requestDigest, roundRequestName, collectorLock } from "./review-rounds.mjs";
import { processStart } from "./runtime.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const head = "c".repeat(40);
const request = (root, n = 1, extra = {}) => ({ collectionId: `preflight-collect:${head}:${n}`, head, root, collect: false, ...extra });

test("round-admission-monotonic: a new round waits for the previous result and an admitted collectionId never takes another request", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-rounds-"));
  try {
    const first = admitRound(root, "MONO-451", 1, request(root, 1));
    assert.equal(first.ordinal, 1);
    assert.equal(first.requestDigest, requestDigest(request(root, 1)));
    assert.deepEqual(admitRound(root, "MONO-451", 1, request(root, 1)), first, "the same request replays its admission");
    assert.throws(() => admitRound(root, "MONO-451", 1, request(root, 1, { risk: "tiny" })), /already admitted for another request/,
      "a replaced request under an admitted collectionId is refused");
    assert.throws(() => admitRound(root, "MONO-451", 1, request(root, 2)), /round 1 .* has no result yet/,
      "a new collectionId is not admitted while the earlier round is in flight");
    assert.equal(inFlight(readLedger(root, "MONO-451", 1)).length, 1);
    recordResult(root, "MONO-451", 1, first, { status: "refused", reason: "fixture" });
    fs.writeFileSync(path.join(root, "consumed", "MONO-451-a1", "rounds", "2.json.999.tmp"), "");
    const second = admitRound(root, "MONO-451", 1, request(root, 2));
    assert.equal(second.ordinal, 2, "ordinals are host-assigned and only grow");
    assert.equal(inFlight(readLedger(root, "MONO-451", 1)).length, 1);
    assert.throws(() => recordResult(root, "MONO-451", 1, second, { status: "confirmed" }), /done, refused or failed/);
    const done = recordResult(root, "MONO-451", 1, second, { status: "done", receipt: "/x" });
    assert.deepEqual(recordResult(root, "MONO-451", 1, second, { status: "failed" }), done, "a result is written once");
    const file = path.join(root, "consumed", "MONO-451-a1", "rounds", "2.result.json");
    fs.writeFileSync(file, JSON.stringify({ ...done, requestDigest: "0".repeat(64) }));
    assert.throws(() => readLedger(root, "MONO-451", 1), /result does not match its admission/, "a result counts only for its own request");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("wait-round: returns the result bound to this request, refuses a foreign one and stops on a dead collector", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-wait-round-"));
  const roundFile = path.join(root, "reports", roundRequestName("MONO-451", 1));
  fs.mkdirSync(path.dirname(roundFile), { recursive: true });
  const lock = collectorLock(root, "MONO-451", 1);
  const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: holder.pid, procStart: processStart(holder.pid), processGroup: holder.pid }));
    fs.writeFileSync(roundFile, JSON.stringify({ issue: "MONO-451", attempt: 1, request: request(root, 1) }));
    const waiting = waitForRound(roundFile, 20);
    await new Promise(resolve => setTimeout(resolve, 100));
    const admission = admitRound(root, "MONO-451", 1, request(root, 1));
    recordResult(root, "MONO-451", 1, admission, { status: "done", receipt: "/r" });
    assert.equal((await waiting).status, "done");
    fs.writeFileSync(roundFile, JSON.stringify({ issue: "MONO-451", attempt: 1, request: request(root, 1, { risk: "risky" }) }));
    await assert.rejects(waitForRound(roundFile, 20), /already admitted for another request; use a new collectionId/);
    fs.writeFileSync(roundFile, JSON.stringify({ issue: "MONO-451", attempt: 1, request: request(root, 2) }));
    process.kill(-holder.pid, "SIGKILL");
    await new Promise(resolve => setTimeout(resolve, 200));
    // Just after launch the collector may not hold its lock yet: a fresh request keeps waiting.
    const fresh = waitForRound(roundFile, 20); let settled = false; fresh.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(settled, false, "a fresh request waits through the collector start grace");
    const old = new Date(Date.now() - 61_000); fs.utimesSync(roundFile, old, old);
    await assert.rejects(fresh, /collector not running/);
    await assert.rejects(waitForRound(roundFile, 20), /collector not running/);
    const cli = spawnSync(process.execPath, [path.join(scripts, "delivery-state.mjs"), "wait-round", "--request", roundFile], { encoding: "utf8" });
    assert.notEqual(cli.status, 0);
    assert.match(cli.stderr, /collector not running/);
  } finally {
    try { process.kill(-holder.pid, "SIGKILL"); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});
