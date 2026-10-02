#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { readJson, validateLanding, withLock, syncDir, isMain } from "../runtime.mjs";
import { commandFlags, allowedFlags, attemptState, effectivePins } from "./command-state.mjs";

const SHA = /^[a-f0-9]{40}$/, KEY = /^[A-Z][A-Z0-9]*-\d+$/;
const REASONS = new Set(["opened", "sibling-merge", "review-fix", "docs", "unknown"]);
const MAX_PAGES = 100;
function git(worktree, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1",
    GIT_GRAFT_FILE: "/dev/null", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
  return spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "advice.graftFileDeprecated=false", ...args],
    { cwd: worktree, env, encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
}
function gitText(worktree, ...args) {
  const r = git(worktree, ...args);
  if (r.status !== 0) throw new Error(`git ${args[0]} failed`);
  return r.stdout.trim();
}
function journal(root) {
  const file = path.join(root, "ledger.md");
  return (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : []).flatMap(row => {
    const match = /^- (\S+) (LANDING-PLAN|LANDING-HEAD|LANDING-REFRESH) (.+)$/.exec(row);
    return match ? [{ at: match[1], event: match[2], value: JSON.parse(match[3]) }] : [];
  });
}
function append(root, event, value) {
  const stamp = execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim();
  const fd = fs.openSync(path.join(root, "ledger.md"), "a", 0o600);
  try { fs.writeSync(fd, `- ${stamp} ${event} ${JSON.stringify(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(root);
}
const locked = (root, action) => withLock(path.join(root, "dispatch.lock"), action);
function identity(args) {
  if (!KEY.test(args.issue ?? "") || !/^[1-9][0-9]*$/.test(args.attempt ?? "") || !Number.isSafeInteger(Number(args.attempt)))
    throw new Error("--issue KEY and positive --attempt required");
  return { issue: args.issue, attempt: Number(args.attempt) };
}
async function head(args) {
  const value = { ...identity(args), sha: args.sha, reason: args.reason };
  if (!SHA.test(value.sha ?? "")) throw new Error("full 40-character SHA required");
  if (!REASONS.has(value.reason)) throw new Error("invalid --reason");
  if (value.reason === "sibling-merge") {
    if (!KEY.test(args.sibling ?? "") || args.sibling === value.issue) throw new Error("sibling-merge requires another --sibling KEY");
    value.sibling = args.sibling;
  } else if (args.sibling !== undefined) throw new Error("--sibling requires sibling-merge");
  return locked(args.root, () => {
    const prior = journal(args.root).find(row => row.event === "LANDING-HEAD" && row.value.issue === value.issue &&
      row.value.attempt === value.attempt && row.value.sha === value.sha);
    if (!prior) append(args.root, "LANDING-HEAD", value);
    return { code: 0, outcome: prior ? "already observed" : "observed", observation: prior?.value ?? value };
  });
}
async function plan(args) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-landing-plan-"));
  try { return await calculate(args, scratch); }
  finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
async function calculate(args, scratch) {
  const registry = readJson(path.join(args.root, "workers.json"));
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) throw new Error("invalid worker registry");
  const entries = Object.entries(registry).filter(([, entry]) => attemptState(args.root, entry).state === "active")
    .sort(([a, x], [b, y]) => String(x?.spawned_at ?? "").localeCompare(String(y?.spawned_at ?? "")) || a.localeCompare(b));
  const tips = new Map(), candidates = [], repositories = new Map();
  for (const [issue, entry] of entries) {
    const candidate = { issue, attempt: entry?.attempt ?? null, base: null, head: null, main: null, verdicts: [] };
    candidates.push(candidate);
    try {
      if (entry?.issue !== issue) throw new Error("registry issue identity mismatch");
      candidate.head = gitText(entry.worktree, "rev-parse", "HEAD");
      if (!SHA.test(candidate.head)) throw new Error("head unavailable");
      const pins = effectivePins(entry);
      if (!SHA.test(pins.base ?? "") || pins.worktree !== entry.worktree) throw new Error("pinned base/worktree unavailable");
      candidate.base = pins.base;
      const ref = /^origin\/([^\s~^:?*\[\\]+)$/.exec(pins.baseRef ?? "")?.[1];
      if (!ref || ref.startsWith("-")) throw new Error("landing branch unavailable in pins");
      const common = gitText(entry.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"), key = `${common}:${ref}`;
      if (!tips.has(key)) {
        const calculation = path.join(scratch, String(tips.size));
        try {
          gitText(scratch, "clone", "--bare", "--shared", common, calculation);
          gitText(calculation, "remote", "set-url", "origin", gitText(entry.worktree, "remote", "get-url", "origin"));
          gitText(calculation, "fetch", "--no-write-fetch-head", "--no-auto-maintenance", "origin", `+refs/heads/${ref}:refs/remotes/origin/${ref}`);
          tips.set(key, { sha: gitText(calculation, "rev-parse", `refs/remotes/origin/${ref}`), calculation });
        } catch { tips.set(key, { error: "main fetch failed" }); }
      }
      const tip = tips.get(key);
      if (tip.error) throw new Error(tip.error);
      candidate.main = tip.sha;
      repositories.set(issue, tip.calculation);
      if (gitText(entry.worktree, "status", "--porcelain", "--untracked-files=all")) throw new Error("dirty worktree");
      if (Number(gitText(entry.worktree, "rev-list", "--count", `${pins.base}..${candidate.head}`)) === 0) throw new Error("no commits beyond base");
      const merge = git(tip.calculation, "merge-tree", "--write-tree", tip.sha, candidate.head);
      if (merge.status === 1) candidate.verdicts.push("conflicts-with-main");
      else if (merge.status !== 0) throw new Error("merge-tree error");
    } catch (error) { candidate.verdicts.push(`unevaluable: ${error.message}`); }
  }
  const evaluable = new Set(candidates.filter(row => !row.verdicts.some(verdict => verdict.startsWith("unevaluable:"))));
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i], b = candidates[j];
    if (![a, b].every(row => evaluable.has(row))) continue;
    const worktree = repositories.get(a.issue);
    if (git(worktree, "cat-file", "-e", `${b.head}^{commit}`).status !== 0) {
      const fetched = git(worktree, "fetch", "--no-write-fetch-head", "--no-auto-maintenance", registry[b.issue].worktree, b.head);
      if (fetched.status !== 0) {
        a.verdicts.push("unevaluable: sibling head unavailable"); b.verdicts.push("unevaluable: sibling head unavailable"); continue;
      }
    }
    const merge = git(worktree, "merge-tree", "--write-tree", a.head, b.head);
    if (merge.status === 1) { a.verdicts.push(`conflicts-with:${b.issue}`); b.verdicts.push(`conflicts-with:${a.issue}`); }
    else if (merge.status !== 0) { a.verdicts.push("unevaluable: merge-tree error"); b.verdicts.push("unevaluable: merge-tree error"); }
  }
  for (const row of candidates) if (!row.verdicts.length) row.verdicts.push("clean");
  const mains = [...new Set(candidates.map(row => row.main).filter(Boolean))];
  const value = { main: mains.length === 1 ? mains[0] : null, candidates };
  await locked(args.root, () => append(args.root, "LANDING-PLAN", value));
  return { code: 0, outcome: "advisory", ...value };
}
function repository(args) {
  const origin = args.repo ?? gitText(process.cwd(), "remote", "get-url", "origin");
  const repo = args.repo ?? /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/?$/.exec(origin)?.[1]?.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) throw new Error("GitHub repository unavailable; provide --repo OWNER/NAME");
  return repo;
}
function github(argv, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("GitHub read timed out");
  return JSON.parse(execFileSync("gh", ["api", ...argv], { encoding: "utf8", timeout: Math.min(10_000, remaining),
    killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
}
function history(repo, pr) {
  const [owner, name] = repo.split("/"), events = [], deadline = Date.now() + 30_000;
  const query = `query($owner:String!,$name:String!,$pr:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$pr){timelineItems(first:100,after:$cursor,itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]){nodes{... on HeadRefForcePushedEvent{createdAt beforeCommit{oid} afterCommit{oid}}} pageInfo{hasNextPage endCursor}}}}}`;
  let cursor;
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = github(["graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `pr=${pr}`,
      ...(cursor ? ["-f", `cursor=${cursor}`] : [])], deadline);
    const timeline = data.data?.repository?.pullRequest?.timelineItems;
    if (data.errors?.length || !Array.isArray(timeline?.nodes) || typeof timeline.pageInfo?.hasNextPage !== "boolean")
      throw new Error("force-push history unavailable");
    for (const event of timeline.nodes) {
      if (!Number.isFinite(Date.parse(event?.createdAt)) || [event.beforeCommit?.oid, event.afterCommit?.oid].some(sha => sha != null && !SHA.test(sha)))
        throw new Error("invalid force-push event");
      events.push(event);
    }
    if (!timeline.pageInfo.hasNextPage) return events;
    cursor = timeline.pageInfo.endCursor;
    if (typeof cursor !== "string" || !cursor || seen.has(cursor)) throw new Error("invalid history pagination");
    seen.add(cursor);
  }
  throw new Error("history pagination limit exceeded");
}
function checks(repo, sha) {
  const runs = new Map(), deadline = Date.now() + 30_000;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = github([`repos/${repo}/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`], deadline);
    if (!Array.isArray(data.check_runs) || !Number.isInteger(data.total_count) || data.total_count < 0) throw new Error("checks unavailable");
    for (const run of data.check_runs) {
      if (!Number.isSafeInteger(run.id) || run.id < 1 || typeof run.name !== "string" || run.head_sha !== sha) throw new Error("invalid check run");
      const duration = Date.parse(run.completed_at) - Date.parse(run.started_at);
      runs.set(run.id, { id: run.id, name: run.name, durationSec: Number.isFinite(duration) && duration >= 0 ? duration / 1000 : null });
    }
    if (data.check_runs.length < 100 || page * 100 >= data.total_count) return [...runs.values()];
  }
  throw new Error("checks pagination limit exceeded");
}
function sameRefresh(a, b) {
  if (a.issue !== b.issue || a.attempt !== b.attempt) return false;
  if (b.history === "unavailable") return a.history === b.history && a.repo === b.repo && a.pr === b.pr;
  if (a.history || a.old !== b.old || a.new !== b.new) return false;
  return Boolean(a.old && a.new) || a.createdAt === b.createdAt;
}
async function harvest(args) {
  const id = identity(args), pr = Number(args.pr), repo = repository(args);
  if (!/^[1-9][0-9]*$/.test(args.pr ?? "") || !Number.isSafeInteger(pr)) throw new Error("positive --pr required");
  let events;
  try { events = history(repo, pr); }
  catch { return locked(args.root, () => {
    const value = { ...id, repo, pr, history: "unavailable" };
    const prior = journal(args.root).some(row => row.event === "LANDING-REFRESH" && sameRefresh(row.value, value));
    if (!prior) append(args.root, "LANDING-REFRESH", value);
    return { code: 0, outcome: "history unavailable", added: prior ? 0 : 1 };
  }); }
  const existing = journal(args.root), pending = [], fetched = new Map();
  for (const event of events) {
    const value = { ...id, repo, pr, old: event.beforeCommit?.oid ?? null, new: event.afterCommit?.oid ?? null, createdAt: event.createdAt };
    if (existing.some(row => row.event === "LANDING-REFRESH" && sameRefresh(row.value, value)) || pending.some(row => sameRefresh(row, value))) continue;
    const observation = value.old && value.new && existing.find(row => row.event === "LANDING-HEAD" && row.value.issue === id.issue &&
      row.value.attempt === id.attempt && row.value.sha === value.new)?.value;
    value.reason = observation?.reason ?? "unknown";
    if (observation?.sibling && value.reason === "sibling-merge") value.sibling = observation.sibling;
    if (value.new && !fetched.has(value.new)) {
      try { fetched.set(value.new, checks(repo, value.new)); } catch { fetched.set(value.new, "unknown"); }
    }
    value.checks = value.new ? fetched.get(value.new) : "unknown";
    pending.push(value);
  }
  return locked(args.root, () => {
    const rows = journal(args.root).filter(row => row.event === "LANDING-REFRESH").map(row => row.value);
    let added = 0;
    for (const value of pending) {
      if (rows.some(row => sameRefresh(row, value))) continue;
      if (Array.isArray(value.checks)) {
        const counted = new Set(rows.filter(row => row.issue === id.issue && row.attempt === id.attempt && row.new === value.new)
          .flatMap(row => Array.isArray(row.checks) ? row.checks.map(run => run.id) : []));
        value.checks = value.checks.filter(run => !counted.has(run.id));
      }
      append(args.root, "LANDING-REFRESH", value); rows.push(value); added++;
    }
    return { code: 0, outcome: "harvested", added, events: events.length };
  });
}
if (isMain(import.meta.url)) {
  try {
    const argv = process.argv.slice(2), command = argv[0]?.startsWith("--") || !argv.length ? "plan" : argv.shift();
    const args = commandFlags(argv, ["json"]);
    if (args.help) console.log("landing-plan.mjs --root DIR --config FILE [--json]\nlanding-plan.mjs head --root DIR --config FILE --issue KEY --attempt N --sha SHA --reason opened|sibling-merge|review-fix|docs|unknown [--sibling KEY] [--json]\nlanding-plan.mjs harvest --root DIR --config FILE --issue KEY --attempt N --pr P [--repo OWNER/NAME] [--json]");
    else {
      const flags = { plan: [], head: ["issue", "attempt", "sha", "reason", "sibling"], harvest: ["issue", "attempt", "pr", "repo"] };
      if (!Object.hasOwn(flags, command)) throw new Error("expected plan, head or harvest");
      allowedFlags(args, ["root", "config", "json", ...flags[command]]);
      if (!path.isAbsolute(args.root ?? "") || !args.config) throw new Error("absolute --root and --config required");
      const result = !validateLanding(readJson(args.config)) ? { code: 0, outcome: "not configured" } :
        command === "head" ? await head(args) : command === "harvest" ? await harvest(args) : await plan(args);
      console.log(args.json ? JSON.stringify(result) : `landing-plan: ${result.outcome}\n${JSON.stringify(result, null, 2)}`); process.exitCode = result.code;
    }
  } catch (error) { console.error(`landing-plan: stop: ${error.message}`); process.exitCode = 1; }
}
