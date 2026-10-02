#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { atomicJson, canonical, readJson, validateLanding, withLock, syncDir, isMain } from "../runtime.mjs";
import { commandFlags, allowedFlags } from "./command-state.mjs";

const SHA = /^[a-f0-9]{40}$/;
const STATUSES = new Set(["queued", "in_progress", "completed", "waiting", "requested", "pending"]);
const CONCLUSIONS = new Set(["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required", "stale"]);
const MAX_PAGES = 100, READ_TIMEOUT_MS = 30_000;

function location(root, sha) {
  if (!path.isAbsolute(root ?? "")) throw new Error("absolute --root required");
  if (!SHA.test(sha ?? "")) throw new Error("full 40-character SHA required");
  return path.join(root, "landing", "guard", `${sha}.json`);
}
function repository(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) throw new Error("--repo OWNER/NAME required");
}
function readChecks(repo, sha, found) {
  const deadline = Date.now() + READ_TIMEOUT_MS;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("GitHub check-runs read timed out");
    const endpoint = `repos/${repo}/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`;
    const data = JSON.parse(execFileSync("gh", ["api", endpoint], {
      encoding: "utf8", timeout: Math.min(10_000, remaining), killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }));
    if (!Array.isArray(data.check_runs) || !Number.isInteger(data.total_count) || data.total_count < 0)
      throw new Error("invalid GitHub check-runs response");
    for (const run of data.check_runs) {
      if (!run || typeof run.name !== "string" || !SHA.test(run.head_sha ?? "")) throw new Error("invalid GitHub check run");
      if (run.head_sha === sha) found.push(run);
    }
    if (data.check_runs.length < 100 || page * 100 >= data.total_count) return;
  }
  throw new Error(`GitHub check-runs pagination exceeds ${MAX_PAGES} pages`);
}
function decide(state) {
  const checks = [];
  const result = (code, reason, selected = null, error = null) => ({ code,
    outcome: code === 0 ? "pass" : code === 2 ? "pending" : "stop", reason,
    sha: state.sha, check: state.validation.check, firstObservedAt: state.firstObservedAt,
    deadline: new Date(Date.parse(state.firstObservedAt) + state.validation.timeoutSec * 1000).toISOString(),
    checks: checks.map(run => ({ id: run.id, name: run.name, status: run.status, conclusion: run.conclusion ?? null })),
    selected, ...(error ? { error } : {}),
  });
  const expired = () => Date.now() >= Date.parse(state.firstObservedAt) + state.validation.timeoutSec * 1000;
  try {
    readChecks(state.repo, state.sha, checks);
    const named = checks.filter(run => run.name === state.validation.check);
    for (const run of named) {
      if (!Number.isSafeInteger(run.id) || run.id < 1 || !STATUSES.has(run.status) ||
          (run.completed_at && !Number.isFinite(Date.parse(run.completed_at))) ||
          (run.conclusion != null && !CONCLUSIONS.has(run.conclusion))) throw new Error("invalid named GitHub check run");
    }
    if (!named.length) return result(expired() ? 1 : 2, expired() ? "check absent at deadline" : "check absent");
    if (named.some(run => run.status !== "completed" || !run.completed_at))
      return result(expired() ? 1 : 2, expired() ? "check unfinished at deadline" : "check unfinished");
    const selected = named.sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at) || b.id - a.id)[0];
    if (!selected.conclusion) throw new Error("completed check has no conclusion");
    return result(selected.conclusion === "success" ? 0 : 1, `completed/${selected.conclusion}`, selected.id);
  } catch (error) {
    return result(expired() ? 1 : 2, expired() ? "GitHub read failed at deadline" : "GitHub read failed", null, error.message);
  }
}
function loadState(file) {
  const state = readJson(file);
  if (state.sha !== path.basename(file, ".json") || !Number.isFinite(Date.parse(state.firstObservedAt)))
    throw new Error("invalid guard observation");
  repository(state.repo);
  validateLanding({ landing: { validation: state.validation } });
  return state;
}
async function check(args) {
  const file = location(args.root, args.sha);
  repository(args.repo);
  if (!args.config) throw new Error("--config required");
  const validation = validateLanding(readJson(args.config))?.validation;
  if (!validation) return { code: 0, outcome: "pass", reason: "not configured", sha: args.sha, checks: [] };
  return withLock(`${file}.lock`, () => {
    let state;
    if (fs.existsSync(file)) {
      state = loadState(file);
      if (state.repo !== args.repo || canonical(state.validation) !== canonical(validation))
        throw new Error("guard observation repository/validation mismatch; first observation is immutable");
    } else {
      state = { sha: args.sha, repo: args.repo, validation, firstObservedAt: new Date().toISOString() };
      // Persist before the first GitHub read, including one that fails.
      atomicJson(file, state);
    }
    const result = decide(state);
    atomicJson(file, { ...state, lastResult: result });
    return result;
  });
}
async function corrective(args) {
  const file = location(args.root, args["red-sha"]);
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(args.issue ?? "") || typeof args.reason !== "string" || !args.reason.trim() || /[\r\n]/.test(args.reason))
    throw new Error("--issue KEY and non-empty single-line --reason required");
  return withLock(`${file}.lock`, () => {
    if (!fs.existsSync(file)) throw new Error("corrective requires check observation for red SHA");
    const state = loadState(file), authorization = { issue: args.issue, redSha: state.sha, reason: args.reason };
    if (state.corrective && canonical(state.corrective) !== canonical(authorization))
      throw new Error("corrective authorization already belongs to another issue/reason");
    const result = decide(state);
    if (result.code !== 1) throw new Error(`corrective requires check code 1; got ${result.code}: ${result.reason}`);
    // Dispatch rollback rewrites the ledger under this same lock.
    return withLock(path.join(args.root, "dispatch.lock"), () => {
      const ledger = path.join(args.root, "ledger.md");
      const journal = fs.existsSync(ledger) ? fs.readFileSync(ledger, "utf8").split("\n").flatMap(row => {
        const match = /^- \S+ LANDING-CORRECTIVE (.+)$/.exec(row);
        return match ? [JSON.parse(match[1])] : [];
      }).filter(entry => entry.redSha === state.sha) : [];
      if (journal.some(entry => canonical(entry) !== canonical(authorization)))
        throw new Error("corrective journal authorization conflict for red SHA");
      // Reconcile either side of an interrupted ledger/state write.
      if (!journal.length) {
        const stamp = execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim();
        const fd = fs.openSync(ledger, "a");
        try { fs.writeSync(fd, `- ${stamp} LANDING-CORRECTIVE ${JSON.stringify(authorization)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        syncDir(args.root);
      }
      if (state.corrective) return { code: 0, outcome: "corrective", reason: "already authorized", ...authorization };
      atomicJson(file, { ...state, lastResult: result, corrective: authorization });
      return { code: 0, outcome: "corrective", reason: "one corrective merge authorized", ...authorization };
    });
  });
}
if (isMain(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2), args = commandFlags(argv, ["json"]);
    if (args.help) {
      console.log("landing-guard.mjs check --repo OWNER/NAME --sha SHA --root DIR --config FILE [--json]\nlanding-guard.mjs corrective --issue KEY --red-sha SHA --reason TEXT --root DIR");
    } else {
      if (!["check", "corrective"].includes(command)) throw new Error("expected check or corrective");
      allowedFlags(args, command === "check" ? ["repo", "sha", "root", "config", "json"] : ["issue", "red-sha", "reason", "root"]);
      const result = await (command === "check" ? check(args) : corrective(args));
      console.log(args.json ? JSON.stringify(result) : `landing-guard: ${result.outcome}: ${result.reason}; checks: ${result.checks?.map(run => run.name).join(", ") || "none"}`);
      process.exitCode = result.code;
    }
  } catch (error) { console.error(`landing-guard: stop: ${error.message}`); process.exitCode = 1; }
}
