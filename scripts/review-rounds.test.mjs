import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { admitRound, recordResult, readLedger, inFlight, waitForRound, requestDigest, roundRequestName, collectorLock, hostRunMarker, hostRunCheckout, evidenceSnapshot, recoverHostRun, writeScreenCheck, readScreenCheck } from "./review-rounds.mjs";
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

// MONO-462: the host run executes in a clean checkout of the head beside the marker; recovery after a dead gate
// removes it once the group is confirmed stopped, and keeps it while the group may live.
test("host run recovery removes the head checkout only after the group is stopped", async () => {
  const evidence = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mono-host-checkout-")));
  const pinsFile = "/orchestrator/dispatch/MONO-999-a1/pins.json", id = `preflight-collect:${head}:1`;
  const marker = hostRunMarker(evidence, id), checkout = hostRunCheckout(evidence, id);
  try {
    assert.equal(checkout, marker.replace(/\.running$/, ".checkout"));
    fs.mkdirSync(path.join(checkout, ".git"), { recursive: true }); fs.writeFileSync(path.join(checkout, "a.txt"), "a\n");
    fs.writeFileSync(marker, JSON.stringify({ collectionId: id, group: 99999, snapshot: [] }));
    await assert.rejects(recoverHostRun(evidence, id, pinsFile), /without a start identity/);
    assert.equal(fs.existsSync(checkout), true, "kept while the group may live");
    fs.writeFileSync(marker, JSON.stringify({ collectionId: id, group: null, snapshot: [] }));
    assert.equal(await recoverHostRun(evidence, id, pinsFile), "host run interrupted");
    assert.deepEqual([fs.existsSync(checkout), fs.existsSync(marker)], [false, false]);
  } finally { fs.rmSync(evidence, { recursive: true, force: true }); }
});

test("host run recovery: a gate that died mid-run leaves no planted or edited receipt and no live group", async () => {
  const evidence = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mono-host-recovery-")));
  const pinsFile = "/orchestrator/dispatch/MONO-999-a1/pins.json", id = `preflight-collect:${head}:1`;
  const receipt = (collectionId, extra = {}) => JSON.stringify({ receipt: { producer: "gate-review-v3", pins: { file: pinsFile }, collectionId, ...extra } });
  let writer;
  try {
    fs.mkdirSync(path.join(evidence, "history"), { recursive: true });
    const earlier = path.join(evidence, "history", "earlier.json"), kept = receipt(`preflight-collect:${"d".repeat(40)}:1`);
    fs.writeFileSync(earlier, kept);
    fs.writeFileSync(path.join(evidence, "history", "foreign.json"), JSON.stringify({ receipt: { pins: { file: "/orchestrator/dispatch/MONO-1-a1/pins.json" } } }));
    // The run: a detached group still alive, receipts planted for the next collection and this one, an earlier one edited.
    writer = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
    const marker = hostRunMarker(evidence, id);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ collectionId: id, group: writer.pid, procStart: processStart(writer.pid), snapshot: evidenceSnapshot(evidence, pinsFile) }));
    fs.writeFileSync(path.join(evidence, "history", "next.json"), receipt(`preflight-collect:${head}:2`, { verification: { host: true, exitCode: 0 } }));
    fs.writeFileSync(path.join(evidence, `${head}.json`), receipt(id));
    fs.appendFileSync(earlier, " ");
    assert.match(await recoverHostRun(evidence, id, pinsFile), /evidence changed during host verification/);
    if (writer.exitCode === null && writer.signalCode === null) await new Promise(resolve => writer.once("exit", resolve));
    assert.equal(writer.signalCode, "SIGKILL", "the run's group is stopped");
    assert.deepEqual(fs.readdirSync(path.join(evidence, "history")).sort(), ["earlier.json", "foreign.json"]);
    assert.equal(fs.readFileSync(earlier, "utf8"), kept, "the edited receipt of this attempt is put back");
    assert.equal(fs.existsSync(path.join(evidence, `${head}.json`)), false);
    assert.equal(fs.readdirSync(path.join(evidence, "quarantine")).length, 2);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(await recoverHostRun(evidence, id, pinsFile), null, "nothing to settle without a marker");
    // A reused group id (live leader with another start identity) is never signalled: ours already ended.
    const stranger = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
    try {
      fs.writeFileSync(marker, JSON.stringify({ collectionId: id, group: stranger.pid, procStart: "Mon Jan  1 00:00:00 2001", snapshot: evidenceSnapshot(evidence, pinsFile) }));
      assert.equal(await recoverHostRun(evidence, id, pinsFile), "host run interrupted");
      assert.equal(stranger.exitCode === null && stranger.signalCode === null, true, "a foreign group survives");
      assert.notEqual(processStart(stranger.pid), null);
      // A group without a start identity is never signalled: the round stays in flight with the marker kept.
      fs.writeFileSync(marker, JSON.stringify({ collectionId: id, group: stranger.pid, snapshot: evidenceSnapshot(evidence, pinsFile) }));
      await assert.rejects(recoverHostRun(evidence, id, pinsFile), /without a start identity/);
      assert.equal(fs.existsSync(marker), true);
      assert.equal(stranger.exitCode === null && stranger.signalCode === null, true);
    } finally { try { process.kill(-stranger.pid, "SIGKILL"); } catch {} }
    // A marker written before the run was released names no group: nothing ran, nothing is signalled.
    fs.writeFileSync(marker, JSON.stringify({ collectionId: id, group: null, snapshot: evidenceSnapshot(evidence, pinsFile) }));
    assert.equal(await recoverHostRun(evidence, id, pinsFile), "host run interrupted");
  } finally {
    try { process.kill(-writer?.pid, "SIGKILL"); } catch {}
    fs.rmSync(evidence, { recursive: true, force: true });
  }
});

// Greptile P1 on MONO-481: the approved mockup lives in the dispatch snapshot, not the commit. A result binds the
// attempt (pins file, digest, number) and the snapshot's design digest; the same head in a new attempt or with
// changed approved images does not reuse it.
test("MONO-481 screen check result: same head, new attempt or changed design digest → refused", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-screen-binding-")), evidence = path.join(root, "evidence");
  try {
    const attempt = n => {
      const dir = path.join(root, "dispatch", `MONO-999-a${n}`), file = path.join(dir, "pins.json");
      fs.mkdirSync(path.join(dir, "snapshot/design"), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ screenCheck: true, evidenceRoot: evidence }));
      fs.writeFileSync(path.join(dir, "snapshot/design.json"), JSON.stringify({ images: "v1" }));
      fs.writeFileSync(path.join(dir, "snapshot/design/01-screen.png"), "png v1");
      return { file, digest: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), dir };
    };
    const a1 = attempt(1), a2 = attempt(2);
    writeScreenCheck(evidence, head, "passed", "report", a1);
    assert.equal(readScreenCheck(evidence, head, a1)?.outcome, "passed");
    assert.equal(readScreenCheck(evidence, head, a2), null, "a new attempt on the same head needs its own check");
    fs.writeFileSync(path.join(a1.dir, "snapshot/design/01-screen.png"), "png v2");
    assert.equal(readScreenCheck(evidence, head, a1), null, "changed approved images refuse the old result");
    fs.writeFileSync(path.join(a1.dir, "snapshot/design/01-screen.png"), "png v1");
    fs.writeFileSync(path.join(a1.dir, "snapshot/design.json"), JSON.stringify({ images: "v2" }));
    assert.equal(readScreenCheck(evidence, head, a1), null, "a changed design record refuses it too");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
