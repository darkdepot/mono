import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { atomicJson, digest } from "./runtime.mjs";
import { sha256File } from "./orchestrator/command-state.mjs";

const script = path.resolve("scripts/orchestrator/landing-plan.mjs");
function filesBelow(dir, prefix = "") {
  return Object.fromEntries(fs.readdirSync(dir).flatMap(name => {
    const file = path.join(dir, name), key = prefix + name;
    return fs.statSync(file).isDirectory() ? Object.entries(filesBelow(file, key + "/")) : [[key, fs.readFileSync(file).toString("base64")]];
  }));
}
function fixture(t, commandScript = script) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-plan-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, "root"), repo = path.join(scratch, "repo"), bin = path.join(scratch, "bin");
  for (const dir of [root, repo, bin]) fs.mkdirSync(dir);
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git(repo, "init", "-b", "main"); fs.writeFileSync(path.join(repo, "shared"), "base\n");
  git(repo, "add", "."); git(repo, "commit", "-m", "base"); const base = git(repo, "rev-parse", "HEAD");
  git(repo, "remote", "add", "origin", repo);
  const config = path.join(scratch, "config.json"); atomicJson(config, { landing: { serialPaths: ["VERSION"] } });
  const workers = {}, save = () => atomicJson(path.join(root, "workers.json"), workers); save();
  function candidate(issue, file = issue, content = issue + "\n") {
    const worktree = path.join(scratch, issue); git(repo, "worktree", "add", "-b", issue, worktree, base);
    if (file) { fs.writeFileSync(path.join(worktree, file), content); git(worktree, "add", "."); git(worktree, "commit", "-m", issue); }
    const pins = path.join(root, `dispatch/${issue}-a1/pins.json`); atomicJson(pins, { base, baseRef: "origin/main", worktree });
    workers[issue] = { issue, attempt: 1, stage: "mono-deliver", worktree, pid: null, thread_id: null,
      packVersion: "fixture", sourceCommit: base, surfaceRevision: 4, spawned_at: "2020-01-01T00:00:00Z",
      pins: { file: pins, digest: sha256File(pins) }, pinsVersion: 0 }; save(); return worktree;
  }
  const run = (command = [], extraEnv = {}) => spawnSync(process.execPath,
    [commandScript, ...command, "--root", root, "--config", config, "--json"], { cwd: repo, env: { ...env, ...extraEnv }, encoding: "utf8" });
  const rows = event => (fs.existsSync(path.join(root, "ledger.md")) ? fs.readFileSync(path.join(root, "ledger.md"), "utf8").split("\n") : [])
    .flatMap(row => { const m = new RegExp(`^- \\S+ ${event} (.+)$`).exec(row); return m ? [JSON.parse(m[1])] : []; });
  return { scratch, root, repo, bin, env, git, base, config, workers, save, candidate, run, rows };
}

test("landing U9 clean pair: ordered advisory result and one ledger append only", t => {
  const f = fixture(t), a = f.candidate("MONO-901"), b = f.candidate("MONO-902");
  const registry = fs.readFileSync(path.join(f.root, "workers.json"));
  const metadata = filesBelow(path.join(f.repo, ".git"));
  const r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = JSON.parse(r.stdout); assert.deepEqual(result.candidates.map(row => row.verdicts), [["clean"], ["clean"]]);
  assert.equal(result.main, f.base); assert.equal(f.rows("LANDING-PLAN").length, 1);
  assert.deepEqual(fs.readFileSync(path.join(f.root, "workers.json")), registry);
  assert.deepEqual(filesBelow(path.join(f.repo, ".git")), metadata, "all worker Git metadata stays byte-for-byte unchanged");
  assert.equal(f.git(a, "status", "--porcelain"), ""); assert.equal(f.git(b, "status", "--porcelain"), "");
});

for (const scenario of ["text conflict", "modify/delete"]) test(`landing U9 ${scenario} names both siblings and leaves clean third`, t => {
  const f = fixture(t); f.candidate("MONO-902", "shared", "second\n");
  const a = f.candidate("MONO-901", "shared", "first\n"); f.candidate("MONO-903");
  if (scenario === "modify/delete") { f.git(a, "rm", "shared"); f.git(a, "commit", "-m", "delete"); }
  const r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = JSON.parse(r.stdout).candidates;
  assert.deepEqual(rows.map(row => row.issue), ["MONO-901", "MONO-902", "MONO-903"]);
  assert.deepEqual(rows.map(row => row.verdicts), [["conflicts-with:MONO-902"], ["conflicts-with:MONO-901"], ["clean"]]);
});
test("landing U9 refreshed main detects conflict without updating worker files", t => {
  const f = fixture(t), a = f.candidate("MONO-901", "shared", "worker\n"), head = f.git(a, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(f.repo, "shared"), "main\n"); f.git(f.repo, "add", "."); f.git(f.repo, "commit", "-m", "new main");
  const tip = f.git(f.repo, "rev-parse", "HEAD"), r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = JSON.parse(r.stdout); assert.equal(result.main, tip);
  assert.deepEqual(result.candidates[0].verdicts, ["conflicts-with-main"]);
  assert.equal(f.git(a, "rev-parse", "HEAD"), head); assert.equal(fs.readFileSync(path.join(a, "shared"), "utf8"), "worker\n");
});
for (const scenario of ["dirty worktree", "no commits beyond base", "pins", "merge-tree error", "main fetch failed"]) test(`landing U9 unevaluable: ${scenario}`, t => {
  const f = fixture(t), a = f.candidate("MONO-901", scenario === "no commits beyond base" ? null : "task");
  if (scenario === "dirty worktree") fs.writeFileSync(path.join(a, "untracked"), "dirty");
  if (scenario === "pins") { f.workers["MONO-901"].pins = null; f.save(); }
  if (scenario === "main fetch failed") f.git(f.repo, "remote", "set-url", "origin", path.join(f.scratch, "absent"));
  if (scenario === "merge-tree error") {
    const real = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(f.bin, "git"), `#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');if(process.argv.includes('merge-tree'))process.exit(128);const r=spawnSync(${JSON.stringify(real)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status);\n`); fs.chmodSync(path.join(f.bin, "git"), 0o755);
  }
  const r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(JSON.parse(r.stdout).candidates[0].verdicts.some(row => row.startsWith("unevaluable:") && row.includes(scenario)), r.stdout);
  assert.equal(f.rows("LANDING-PLAN").length, 1);
});
test("landing U9 empty registry records one empty plan; absent landing block does nothing", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, "next"), "next\n"); f.git(f.repo, "add", "."); f.git(f.repo, "commit", "-m", "new main");
  const tip = f.git(f.repo, "rev-parse", "HEAD"), metadata = filesBelow(path.join(f.repo, ".git"));
  const r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).main, tip, "main is fetched and recorded even without candidates");
  assert.equal(f.rows("LANDING-PLAN")[0].main, tip);
  assert.deepEqual(filesBelow(path.join(f.repo, ".git")), metadata);
  assert.deepEqual(JSON.parse(r.stdout).candidates, []); assert.equal(f.rows("LANDING-PLAN").length, 1);
  const prior = fs.readFileSync(path.join(f.root, "ledger.md")); atomicJson(f.config, {});
  assert.equal(JSON.parse(f.run().stdout).outcome, "not configured"); assert.deepEqual(fs.readFileSync(path.join(f.root, "ledger.md")), prior);
});
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const observation = (sha = C, reason = "sibling-merge") => ["head", "--issue", "MONO-901", "--attempt", "1", "--sha", sha, "--reason", reason,
  ...(reason === "sibling-merge" ? ["--sibling", "MONO-902"] : [])];
for (const reason of ["opened", "sibling-merge", "review-fix", "docs", "unknown"]) test(`landing U9 head ${reason}: one observation per identity, never a refresh`, t => {
  const f = fixture(t); let r = f.run(observation(C, reason)); assert.equal(r.status, 0, r.stdout + r.stderr);
  const prior = fs.readFileSync(path.join(f.root, "ledger.md")); r = f.run(observation(C, reason)); assert.equal(r.status, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.root, "ledger.md")), prior);
  assert.equal(f.rows("LANDING-HEAD")[0].reason, reason); assert.equal(f.rows("LANDING-REFRESH").length, 0);
});
test("landing U9 head rejects partial SHA and invalid sibling reason", t => {
  const f = fixture(t); assert.equal(f.run(observation("abc", "docs")).status, 1);
  assert.equal(f.run(observation(C).slice(0, -2)).status, 1);
  assert.equal(fs.existsSync(path.join(f.root, "ledger.md")), false);
});
function githubFixture(f, overrides = {}) {
  const event = (old, next, at) => ({ createdAt: at, beforeCommit: old ? { oid: old } : null, afterCommit: next ? { oid: next } : null });
  const mock = { pages: [[event(A, B, "2026-09-30T22:27:16Z"), event(B, C, "2026-09-30T23:16:33Z")]], ...overrides };
  const file = path.join(f.scratch, "github.json"), calls = path.join(f.scratch, "calls.jsonl"); atomicJson(file, mock);
  fs.writeFileSync(path.join(f.bin, "gh"), `#!/usr/bin/env node
const fs=require('node:fs'), m=JSON.parse(fs.readFileSync(process.env.PLAN_MOCK)), args=process.argv.slice(2);
fs.appendFileSync(process.env.PLAN_CALLS,JSON.stringify(args)+'\\n');
if(args[1]==='graphql') {
 if(m.historyError)process.exit(1);
 const cursor=args.find(a=>a.startsWith('cursor=')); const page=cursor?Number(cursor.split('=')[1]):0;
 console.log(JSON.stringify({data:{repository:{pullRequest:{timelineItems:{nodes:m.pages[page],pageInfo:{hasNextPage:page+1<m.pages.length,endCursor:String(page+1)}}}}}}));
} else {
 if(m.checksError)process.exit(1);
 const sha=/commits\\/([a-f0-9]+)\\//.exec(args[1])[1];
 if(!args[1].includes('filter=all')||!args[1].includes('per_page=100'))process.exit(71);
 const page=Number(new URL('https://fixture/'+args[1]).searchParams.get('page'));
 const runs=m.checks??[{id:sha==='${B}'?110126331912:110126371646,name:'validate',head_sha:sha,started_at:'2026-09-30T22:27:23Z',completed_at:'2026-09-30T22:29:19Z'}];
 console.log(JSON.stringify({total_count:runs.length,check_runs:runs.slice((page-1)*100,page*100)}));
}
`); fs.chmodSync(path.join(f.bin, "gh"), 0o755);
  const env = { PLAN_MOCK: file, PLAN_CALLS: calls };
  const harvest = () => f.run(["harvest", "--issue", "MONO-901", "--attempt", "1", "--pr", "105", "--repo", "owner/repo"], env);
  return { mock, file, calls, event, harvest, save: () => atomicJson(file, mock) };
}
test("landing U9 harvest A→B→C with one C observation, exact checks and idempotent repeat", t => {
  const f = fixture(t), gh = githubFixture(f); assert.equal(f.run(observation()).status, 0);
  const r = gh.harvest(); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(JSON.parse(r.stdout).added, 2);
  const rows = f.rows("LANDING-REFRESH"); assert.deepEqual(rows.map(row => [row.old, row.new, row.reason]), [[A, B, "unknown"], [B, C, "sibling-merge"]]);
  assert.equal(rows[1].sibling, "MONO-902"); assert.equal(rows[0].sibling, undefined);
  assert.deepEqual(rows.map(row => row.checks[0].durationSec), [116, 116]);
  assert.deepEqual(rows.map(row => row.checks[0].id), [110126331912, 110126371646]);
  const prior = fs.readFileSync(path.join(f.root, "ledger.md")); assert.equal(JSON.parse(gh.harvest().stdout).added, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.root, "ledger.md")), prior);
});
test("landing U9 harvest ordinary added commits produce no refresh", t => {
  const f = fixture(t), gh = githubFixture(f, { pages: [[]] }); f.run(observation());
  assert.equal(JSON.parse(gh.harvest().stdout).added, 0); assert.equal(f.rows("LANDING-REFRESH").length, 0);
});
for (const scenario of ["checks unavailable", "missing before", "missing after", "history unavailable", "two event pages"]) test(`landing U9 harvest ${scenario}`, t => {
  const f = fixture(t), gh = githubFixture(f); f.run(observation());
  if (scenario === "checks unavailable") gh.mock.checksError = true;
  if (scenario === "missing before") gh.mock.pages[0][1].beforeCommit = null;
  if (scenario === "missing after") gh.mock.pages[0][1].afterCommit = null;
  if (scenario === "history unavailable") gh.mock.historyError = true;
  if (scenario === "two event pages") gh.mock.pages = gh.mock.pages[0].map(row => [row]); gh.save();
  const r = gh.harvest(); assert.equal(r.status, 0, r.stdout + r.stderr); const rows = f.rows("LANDING-REFRESH");
  if (scenario === "history unavailable") { assert.equal(rows.length, 1); assert.equal(rows[0].history, "unavailable"); }
  else { assert.equal(rows.length, 2); if (scenario === "checks unavailable") assert.ok(rows.every(row => row.checks === "unknown"));
    if (scenario.startsWith("missing")) { assert.equal(rows[1].reason, "unknown"); assert.equal(rows[1][scenario === "missing before" ? "old" : "new"], null); }
    if (scenario === "two event pages") assert.equal(fs.readFileSync(gh.calls, "utf8").split('\n').filter(row => row.includes('graphql')).length, 2);
  }
  const prior = fs.readFileSync(path.join(f.root, "ledger.md")); assert.equal(JSON.parse(gh.harvest().stdout).added, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.root, "ledger.md")), prior);
});
test("landing U9 harvest incomplete distinct events remain distinct; checks on a repeated new head counted once", t => {
  const f = fixture(t), gh = githubFixture(f); gh.mock.pages = [[gh.event(null, C, "2026-10-01T00:00:00Z"), gh.event(null, C, "2026-10-01T01:00:00Z")]]; gh.save();
  assert.equal(gh.harvest().status, 0); const rows = f.rows("LANDING-REFRESH"); assert.equal(rows.length, 2);
  assert.equal(rows[0].checks.length, 1); assert.equal(rows[1].checks.length, 0); assert.equal(JSON.parse(gh.harvest().stdout).added, 0);
});
test("landing U9 harvest two check pages retains every run once", t => {
  const f = fixture(t), gh = githubFixture(f); gh.mock.pages = [[gh.event(A, B, "2026-10-01T00:00:00Z")]];
  gh.mock.checks = Array.from({length:101}, (_,i) => ({id:i+1,name:'validate',head_sha:B,started_at:null,completed_at:null})); gh.save();
  const r = gh.harvest(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(f.rows("LANDING-REFRESH")[0].checks.length, 101); assert.equal(f.rows("LANDING-REFRESH")[0].checks[0].durationSec, null);
});
test("landing U9 installed layout executes plan, head and harvest outside source checkout", t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-plan-install-")); t.after(() => fs.rmSync(scratch, {recursive:true,force:true}));
  const skills = path.join(scratch, "skills"), installed = path.join(skills, ".mono-agent-workflow/scripts/orchestrator/landing-plan.mjs");
  const install = spawnSync(process.execPath, ["scripts/install-local.mjs", "--skills-root", skills], {encoding:"utf8",
    env:{...process.env,MONO_WORKFLOW_STATE_ROOT:path.join(scratch,"state"),MONO_WORKFLOW_KNOWN_ROOTS:skills}});
  assert.equal(install.status, 0, install.stdout + install.stderr); const f = fixture(t, installed); f.candidate("MONO-901");
  assert.equal(f.run().status, 0); assert.equal(f.run(observation()).status, 0); const gh = githubFixture(f);
  const r = gh.harvest(); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(f.rows("LANDING-REFRESH").length, 2);
});

test("landing U9 excludes only stopped landed attempts through shared classification", t => {
  const f = fixture(t), worktree = f.candidate("MONO-901"), entry = f.workers['MONO-901'];
  const head = f.git(worktree, 'rev-parse', 'HEAD'); entry.pid = 99999999; entry.procStart = 'old'; entry.thread_id = 'thread'; f.save();
  const report = { ...entry, phase:'ship', sequence:1, kind:'phase', head, status:'green', publishedAt:new Date().toISOString(),
    certificate:`mono-ship green certificate\nShip: green\nIssue(s): MONO-901\nPR: https://github.com/owner/repo/pull/105\nHead SHA: ${head}\n`,
    linear_mutations_pending:[], capsule:{phase:'ship',head,decisions:[],open_queue:[],writable_roots:[worktree]} };
  atomicJson(path.join(f.root,'reports/MONO-901-phase-ship.json'), report);
  atomicJson(path.join(f.root,'confirmations/MONO-901-phase-ship-a1-s1.confirmed.json'),
    {report,issue:'MONO-901',attempt:1,phase:'ship',sequence:1,status:'confirmed',reportDigest:digest(report),results:[]});
  atomicJson(path.join(f.root,'landing/pending-install.json'), [{repo:'owner/repo',issue:'MONO-901',attempt:1,pr:105,head,mergeSha:f.base,mergedAt:'2026-10-01T00:00:00Z'}]);
  const r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr); assert.deepEqual(JSON.parse(r.stdout).candidates, []);
  fs.unlinkSync(path.join(f.root,'confirmations/MONO-901-phase-ship-a1-s1.confirmed.json'));
  const uncertain = f.run(); assert.equal(uncertain.status,0,uncertain.stdout+uncertain.stderr); assert.equal(JSON.parse(uncertain.stdout).candidates.length,1);
});
