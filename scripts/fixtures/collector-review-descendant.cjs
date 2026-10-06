const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const [mode, parent] = process.argv.slice(2), repo = process.cwd();
const file = name => path.join(repo, ".orchestrator", name);
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === "EPERM") return true;
    if (error.code === "ESRCH") return false;
    throw error;
  }
};
const publish = (name, value) => {
  const target = file(name);
  fs.writeFileSync(target + ".tmp", JSON.stringify(value));
  fs.renameSync(target + ".tmp", target);
};
const wait = predicate => {
  const deadline = Date.now() + 12000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("descendant fixture synchronization timed out");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
};
const known = {
  review: { findings: [{ priority: 1, title: "[P1] Preserve the fixture finding" }], overall_correctness: "patch is incorrect" },
  status: { schema_version: 1, status: "findings", engine: "claude", exit_code: 1, report_produced: true, timed_out: false }
};
if (mode === "verification") {
  fs.mkdirSync(path.join(repo, ".orchestrator"), { recursive: true });
  const child = cp.spawn(process.execPath, [__filename, "descendant", String(process.pid)], { detached: true, stdio: "ignore" });
  child.unref();
  wait(() => fs.existsSync(file("descendant-ready.json")));
  assert.equal(alive(child.pid), true);
} else if (mode === "descendant") {
  publish("descendant-ready.json", { pid: process.pid, parent: Number(parent) });
  wait(() => !alive(Number(parent)) && fs.existsSync(file("review-active.json")));
  const active = JSON.parse(fs.readFileSync(file("review-active.json")));
  const attempts = active.paths.map((target, index) => {
    try {
      fs.writeFileSync(target, JSON.stringify(index === 0 ? { findings: [], overall_correctness: "patch is correct" }
        : { ...known.status, status: "clean", exit_code: 0 }));
      return { target, result: "written" };
    } catch (error) { return { target, result: error.code }; }
  });
  publish("descendant-attempts.json", { parentAlive: alive(Number(parent)), reviewAlive: alive(active.pid), attempts });
} else if (mode === "review") {
  const args = process.argv.slice(2), val = flag => args[args.indexOf(flag) + 1];
  const paths = [val("--json-output"), val("--status-output")];
  assert.equal(fs.statSync(path.dirname(paths[0])).mode & 0o777, 0o700);
  paths.forEach((target, index) => fs.writeFileSync(target, JSON.stringify(index === 0 ? known.review : known.status)));
  publish("review-active.json", { pid: process.pid, paths });
  wait(() => fs.existsSync(file("descendant-attempts.json")));
  const proof = JSON.parse(fs.readFileSync(file("descendant-attempts.json")));
  assert.equal(proof.parentAlive, false, "verification has exited while its descendant survives");
  assert.equal(proof.reviewAlive, true, "attempts occur while the review is running");
  for (const attempt of proof.attempts) assert.ok(["EPERM", "EACCES", "EROFS"].includes(attempt.result), JSON.stringify(attempt));
  assert.deepEqual(JSON.parse(fs.readFileSync(paths[0])), known.review);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths[1])), known.status);
  console.log("autoreview target: branch | engine: claude | model: " + val("--model") + " | thinking: " + val("--thinking"));
  console.log("overall: patch is incorrect (0.9)");
  process.exitCode = 1;
} else throw new Error("unknown descendant fixture mode");
