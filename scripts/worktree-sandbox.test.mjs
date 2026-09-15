import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("host Git probe: explicit linked-worktree metadata grant enables fetch, add and commit", t => {
  if (process.env.CODEX_SANDBOX || process.env.MONO_DELIVERY_SANDBOX === "1") {
    t.skip("deferred: nested sandbox; owner: orchestrator on the host, at deploy"); return;
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" });
  const run = (command, args, cwd) => spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 60_000 });
  const ok = result => { assert.equal(result.status, 0, JSON.stringify(result)); return result.stdout.trim(); };
  const version = ok(run("codex", ["--version"]));
  t.diagnostic(`codex version: ${version}`);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mono-worktree-sandbox-")));
  const main = path.join(root, "main"), worktree = path.join(root, "linked"), remote = path.join(root, "remote.git");
  const common = path.join(main, ".git"), metadata = path.join(common, "worktrees/linked");
  const git = (cwd, ...args) => ok(run("git", args, cwd));
  try {
    fs.mkdirSync(main); git(main, "init", "-b", "main");
    for (const [key, value] of [["user.name", "Sandbox Fixture"], ["user.email", "fixture@example.invalid"], ["core.hooksPath", "/dev/null"], ["commit.gpgsign", "false"], ["tag.gpgsign", "false"]]) git(main, "config", key, value);
    fs.writeFileSync(path.join(main, "tracked.txt"), "base\n");
    git(main, "add", "tracked.txt"); git(main, "commit", "-m", "base");
    const base = git(main, "rev-parse", "HEAD");
    git(main, "worktree", "add", "-b", "linked", worktree);
    git(root, "init", "--bare", remote); git(main, "remote", "add", "origin", remote);
    fs.writeFileSync(path.join(main, "upstream.txt"), "new remote content\n");
    git(main, "add", "upstream.txt"); git(main, "commit", "-m", "remote update");
    const upstream = git(main, "rev-parse", "HEAD"); git(main, "push", "origin", "HEAD:refs/heads/incoming");
    // Restore this object database to the pre-fetch state; the new commit lives only in the local remote.
    git(main, "reset", "--hard", base);
    git(main, "update-ref", "-d", "refs/remotes/origin/incoming");
    git(main, "reflog", "expire", "--expire=now", "--all"); git(main, "gc", "--prune=now");
    assert.notEqual(run("git", ["cat-file", "-e", upstream], worktree).status, 0);
    const probe = path.join(root, "probe.cjs");
    fs.writeFileSync(probe, `
const fs=require('node:fs'), cp=require('node:child_process');
const git=(...args)=>{const r=cp.spawnSync('git',args,{encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr);process.exit(1);}return r.stdout.trim();};
const indexBefore=git('rev-parse','HEAD^{tree}');
git('fetch','origin','refs/heads/incoming:refs/remotes/origin/incoming');
const fetched=git('rev-parse','refs/remotes/origin/incoming');
fs.writeFileSync('tracked.txt','worker change\\n');git('add','tracked.txt');
const indexAfter=git('write-tree');git('commit','-m','worker change');
console.log(JSON.stringify({fetched,indexBefore,indexAfter,commit:git('rev-parse','HEAD'),parent:git('rev-parse','HEAD^'),tree:git('rev-parse','HEAD^{tree}')}));
`);
    const backup = path.join(root, "initial"); fs.mkdirSync(backup);
    fs.cpSync(common, path.join(backup, "git"), { recursive: true });
    fs.cpSync(worktree, path.join(backup, "tree"), { recursive: true });
    const probeWith = roots => {
      t.diagnostic(`cwd: ${worktree}; writable roots: ${JSON.stringify(roots)}`);
      return run("codex", ["sandbox", "-c", 'sandbox_mode="workspace-write"', "-c", `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`,
        "-c", "sandbox_workspace_write.network_access=true", "--", process.execPath, probe], worktree);
    };
    const denied = probeWith([worktree, common]);
    assert.notEqual(denied.status, 0, "negative probe must fail");
    assert.ok(denied.stderr.includes(path.join(metadata, "FETCH_HEAD")), JSON.stringify(denied));
    assert.match(denied.stderr, /Operation not permitted|Permission denied|Read-only file system/i);
    // Both runs begin from identical repository, index, ref and worktree bytes.
    fs.rmSync(common, { recursive: true }); fs.cpSync(path.join(backup, "git"), common, { recursive: true });
    fs.rmSync(worktree, { recursive: true }); fs.cpSync(path.join(backup, "tree"), worktree, { recursive: true });
    const allowed = JSON.parse(ok(probeWith([worktree, common, metadata])));
    assert.equal(allowed.fetched, upstream);
    assert.notEqual(allowed.indexAfter, allowed.indexBefore);
    assert.notEqual(allowed.commit, base);
    assert.equal(allowed.parent, base);
    assert.equal(allowed.tree, allowed.indexAfter);
    t.diagnostic("negative: metadata FETCH_HEAD access denied; positive: new remote ref fetched, index changed, commit created");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
