#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { atomicJson, canonical, readJson, validateLanding, withLock, syncDir, isMain } from "../runtime.mjs";
import { commandFlags, allowedFlags, registryEntry, landedShip, attemptState } from "./command-state.mjs";
import { check } from "./landing-guard.mjs";

const SHA = /^[a-f0-9]{40}$/;
const sameLanding = (a, b) => ["repo", "issue", "attempt", "pr", "head", "mergeSha", "mergedAt"].every(key => a[key] === b[key]);
const pendingFile = root => path.join(root, "landing/pending-install.json");
function pending(root) {
  const file = pendingFile(root), records = fs.existsSync(file) ? readJson(file) : [];
  if (!Array.isArray(records) || records.some(record => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.repo ?? "") ||
      !/^[A-Z][A-Z0-9]*-\d+$/.test(record.issue ?? "") || !Number.isInteger(record.attempt) || record.attempt < 1 ||
      !Number.isInteger(record.pr) || record.pr < 1 || !SHA.test(record.head ?? "") || !SHA.test(record.mergeSha ?? "") ||
      !Number.isFinite(Date.parse(record.mergedAt)))) throw new Error("invalid pending installation records");
  if (new Set(records.map(record => `${record.issue}:${record.attempt}`)).size !== records.length) throw new Error("duplicate pending attempt");
  return records;
}
// The launch owner publishes its pid before releasing launch.lock. Waiting for
// the same lock is necessary; observing a pid-less registry before it is unsafe.
async function locked(file, action) {
  const deadline = Date.now() + 120_000;
  while (true) {
    try { return await withLock(file, action); }
    catch (error) {
      if (error.code !== "ELOCKED" || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
function github(endpoint) {
  return JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL",
    maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
}
function mergedPull(ship, pr) {
  const data = github(`repos/${ship.repo}/pulls/${pr}`);
  if (data.number !== pr || data.merged !== true || data.state !== "closed" || data.base?.ref !== ship.branch ||
      data.base?.repo?.full_name !== ship.repo || data.head?.sha !== ship.head || !SHA.test(data.merge_commit_sha ?? "") ||
      !Number.isFinite(Date.parse(data.merged_at))) throw new Error("GitHub merged PR repository/number/branch/head mismatch");
  return data;
}
// Callers hold dispatch.lock before launch/pending locks, matching dispatch's
// thread-publication order and preventing a ledger/launch lock inversion.
function journal(root, event, value) {
    const file = path.join(root, "ledger.md");
    const rows = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
    const marker = new RegExp(`^- \\S+ ${event} (.+)$`);
    if (rows.some(row => { const match = marker.exec(row); return match && canonical(JSON.parse(match[1])) === canonical(value); })) return;
    const stamp = execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim();
    const fd = fs.openSync(file, "a", 0o600);
    try { fs.writeSync(fd, `- ${stamp} ${event} ${JSON.stringify(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    syncDir(root);
}
async function record(args) {
  const attempt = Number(args.attempt), pr = Number(args.pr);
  if (!Number.isInteger(pr) || pr < 1) throw new Error("positive --pr required");
  return locked(path.join(args.root, "dispatch.lock"), () => locked(path.join(args.root, "launch.lock"), () => locked(`${pendingFile(args.root)}.lock`, async () => {
    const entry = registryEntry(args.root, args.issue, attempt), ship = landedShip(args.root, entry);
    if (pr !== ship.pr) throw new Error("PR does not match confirmed ship certificate");
    const data = mergedPull(ship, pr);
    const value = { repo: ship.repo, issue: args.issue, attempt, pr, head: ship.head, mergeSha: data.merge_commit_sha, mergedAt: data.merged_at };
    const records = pending(args.root), prior = records.find(row => row.issue === args.issue && row.attempt === attempt);
    if (prior && !sameLanding(prior, value)) throw new Error("conflicting landing record for this issue/attempt");
    // An installed record also reserves its identity; replay must not requeue it.
    const installed = path.join(args.root, "landing/installed");
    const closed = (fs.existsSync(installed) ? fs.readdirSync(installed).filter(file => file.endsWith(".json")) : [])
      .flatMap(file => readJson(path.join(installed, file)).records).find(row => row.issue === args.issue && row.attempt === attempt);
    if (closed && !sameLanding(closed, value)) throw new Error("conflicting installed landing record");
    const saved = prior ?? closed ?? { ...value, guard: await check({ root: args.root, repo: ship.repo, sha: value.mergeSha, config: args.config }) };
    if (!prior && !closed) atomicJson(pendingFile(args.root), [...records, saved]);
    journal(args.root, "LANDED", saved);
    return { code: 0, outcome: "recorded", record: saved };
  })));
}
function statusUnderLaunchLock(root) {
  const registry = readJson(path.join(root, "workers.json"));
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) throw new Error("invalid worker registry");
  const attempts = Object.entries(registry).map(([issue, entry]) => entry?.issue === issue ? attemptState(root, entry) :
    { issue, state: "active", reason: "registry issue identity mismatch" });
  const blockers = attempts.filter(entry => entry.state === "active");
  return { code: blockers.length ? 2 : 0, outcome: blockers.length ? "blocked" : "ready", attempts, blockers };
}
function requireHalt(root) {
  if (readJson(path.join(root, "control.json")).halt !== true) throw new Error("verify requires halt: true in control.json");
}
function git(worktree, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_GRAFT_FILE: "/dev/null", GIT_NO_LAZY_FETCH: "1" });
  return execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "advice.graftFileDeprecated=false", ...args],
    { cwd: worktree, env, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const proofs = (records, installSha) => records.map(({ issue, attempt, pr, mergeSha }) => ({ issue, attempt, pr, mergeSha, installSha }));
function batchFile(root, sha) {
  if (!SHA.test(sha ?? "")) throw new Error("full 40-character --install-sha required");
  return path.join(root, "landing", `batch-${sha}.json`);
}
async function verify(args) {
  const file = batchFile(args.root, args["install-sha"]), installSha = args["install-sha"];
  requireHalt(args.root);
  return locked(path.join(args.root, "launch.lock"), () => locked(`${pendingFile(args.root)}.lock`, async () => {
    requireHalt(args.root);
    const readiness = statusUnderLaunchLock(args.root);
    if (readiness.code !== 0) throw new Error(`active attempts block installation: ${readiness.blockers.map(row => `${row.issue}: ${row.reason}`).join("; ")}`);
    const records = pending(args.root).sort((a, b) => a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : a.attempt - b.attempt);
    if (!records.length) throw new Error("no pending installation records");
    let repo, branch;
    for (const record of records) {
      const ship = landedShip(args.root, registryEntry(args.root, record.issue, record.attempt));
      if (repo && (repo !== ship.repo || branch !== ship.branch)) throw new Error("batch contains different repositories/landing branches");
      repo = ship.repo; branch = ship.branch;
      if (ship.pr !== record.pr || ship.head !== record.head || ship.repo !== record.repo) throw new Error("pending record differs from confirmed certificate");
      const data = mergedPull(ship, record.pr);
      if (data.merge_commit_sha !== record.mergeSha || data.merged_at !== record.mergedAt) throw new Error("pending merge provenance differs from GitHub");
    }
    const tip = () => {
      const data = github(`repos/${repo}/branches/${encodeURIComponent(branch)}`);
      if (data.name !== branch || data.commit?.sha !== installSha) throw new Error("install SHA differs from GitHub landing branch tip");
    };
    tip();
    const worktree = path.resolve(args.worktree ?? process.cwd());
    if (git(worktree, "rev-parse", "HEAD") !== installSha) throw new Error("installing checkout HEAD differs from install SHA");
    for (const record of records) {
      try { git(worktree, "merge-base", "--is-ancestor", record.mergeSha, installSha); }
      catch { throw new Error(`${record.issue}: merge SHA is not a verified ancestor of install SHA`); }
    }
    const guard = await check({ root: args.root, repo, sha: installSha, config: args.config });
    if (guard.code !== 0) throw new Error(`install SHA check not successful: ${guard.reason}`);
    const batch = { repo, branch, installSha, records, proofs: proofs(records, installSha) };
    requireHalt(args.root); tip();
    if (fs.existsSync(file)) {
      if (canonical(readJson(file)) !== canonical(batch)) throw new Error("verified batch composition is immutable for this install SHA");
    } else atomicJson(file, batch);
    return { code: 0, outcome: "verified", ...batch };
  }));
}
async function close(args) {
  const file = batchFile(args.root, args["install-sha"]), installSha = args["install-sha"];
  if (typeof args.evidence !== "string" || !args.evidence.trim()) throw new Error("non-empty --evidence required after installation read-back");
  return locked(path.join(args.root, "dispatch.lock"), () => locked(`${pendingFile(args.root)}.lock`, () => {
    const batch = readJson(file);
    if (batch.installSha !== installSha || !Array.isArray(batch.records) || !batch.records.length || canonical(batch.proofs) !== canonical(proofs(batch.records, installSha)))
      throw new Error("invalid verified installation batch");
    const archive = path.join(args.root, "landing/installed", `${installSha}.json`), value = { ...batch, evidence: args.evidence };
    const prior = fs.existsSync(archive) ? readJson(archive) : null;
    if (prior && canonical(prior) !== canonical(value)) throw new Error("conflicting installation close evidence/batch");
    const records = pending(args.root);
    for (const record of batch.records) {
      const current = records.find(row => row.issue === record.issue && row.attempt === record.attempt);
      if ((!current && !prior) || (current && canonical(current) !== canonical(record))) throw new Error("pending batch changed before close");
    }
    // Archive first: a crash before pending removal is recovered using this
    // exact batch, without requiring another install or losing its evidence.
    if (!prior) atomicJson(archive, value);
    const remaining = records.filter(record => !batch.records.some(row => row.issue === record.issue && row.attempt === record.attempt));
    if (canonical(records) !== canonical(remaining)) atomicJson(pendingFile(args.root), remaining);
    journal(args.root, "DRAIN-CLOSE", value);
    return { code: 0, outcome: "closed", ...value };
  }));
}
if (isMain(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2), args = commandFlags(argv, ["json"]);
    if (args.help || command === "--help") console.log("landing-drain.mjs record --root DIR --config FILE --issue KEY --attempt N --pr P [--json]\nlanding-drain.mjs status --root DIR --config FILE [--json]\nlanding-drain.mjs verify --root DIR --config FILE --install-sha T [--worktree DIR] [--json]\nlanding-drain.mjs close --root DIR --config FILE --install-sha T --evidence TEXT [--json]");
    else {
      const commands = { record: ["issue", "attempt", "pr"], status: [], verify: ["install-sha", "worktree"], close: ["install-sha", "evidence"] };
      if (!Object.hasOwn(commands, command)) throw new Error("expected record, status, verify or close");
      allowedFlags(args, ["root", "config", "json", ...commands[command]]);
      if (!path.isAbsolute(args.root ?? "") || !args.config) throw new Error("absolute --root and --config required");
      const policy = validateLanding(readJson(args.config));
      const result = policy?.install !== "wave-drain" ? { code: 0, outcome: "not configured" } :
        command === "record" ? await record(args) : command === "status" ? await locked(path.join(args.root, "launch.lock"), () => statusUnderLaunchLock(args.root)) : command === "verify" ? await verify(args) : await close(args);
      console.log(args.json ? JSON.stringify(result) : `landing-drain: ${result.outcome}\n${JSON.stringify(result, null, 2)}`); process.exitCode = result.code;
    }
  } catch (error) { console.error(`landing-drain: stop: ${error.message}`); process.exitCode = 1; }
}
