import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = path.resolve("scripts/changelog-assemble.mjs");
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/changelog-u4/ordered.json", import.meta.url)));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-changelog-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "changelog.d"));
  const config = path.join(root, "config.json");
  fs.writeFileSync(config, JSON.stringify({ landing: { changelog: {
    fragmentDir: "changelog.d", target: "CHANGELOG.md", heading: "## [Unreleased]",
  } } }));
  const target = path.join(root, "CHANGELOG.md");
  fs.writeFileSync(target, golden.initial);
  for (const [name, text] of Object.entries(golden.fragments)) fs.writeFileSync(path.join(root, "changelog.d", name), text);
  const run = (extra = [], nodeArgs = []) => spawnSync(process.execPath,
    [...nodeArgs, script, "--worktree", root, "--config", config, ...extra], { encoding: "utf8" });
  const snapshot = () => Object.fromEntries(["CHANGELOG.md", ...fs.readdirSync(path.join(root, "changelog.d")).map(name => `changelog.d/${name}`)]
    .map(name => [name, fs.readFileSync(path.join(root, name), "utf8")]));
  return { root, config, target, run, snapshot };
}

test("landing U4 golden: prefix and numeric order, preserve existing text, repeat", t => {
  const f = fixture(t);
  let r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(f.target, "utf8"), golden.expected);
  assert.deepEqual(fs.readdirSync(path.join(f.root, "changelog.d")), []);
  const before = f.snapshot(); r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.snapshot(), before);
});

test("landing U4 golden: --check prints result without mutations", t => {
  const f = fixture(t), before = f.snapshot();
  const r = f.run(["--check"]); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, golden.expected); assert.deepEqual(f.snapshot(), before);
});

for (const scenario of ["empty", "missing-heading", "same-key-changed-content", "unreadable"]) {
  test(`landing U4 golden refusal without changes: ${scenario}`, t => {
    const f = fixture(t);
    if (scenario === "empty") fs.writeFileSync(path.join(f.root, "changelog.d/MONO-9.md"), " \n\t");
    if (scenario === "missing-heading") fs.writeFileSync(f.target, golden.initial.replace("## [Unreleased]", "## Other"));
    if (scenario === "same-key-changed-content") fs.writeFileSync(f.target, golden.expected);
    if (scenario === "same-key-changed-content") fs.appendFileSync(path.join(f.root, "changelog.d/MONO-9.md"), "- Changed.\n");
    const before = f.snapshot();
    if (scenario === "unreadable") fs.symlinkSync("missing-file", path.join(f.root, "changelog.d/MONO-11.md"));
    const r = f.run(); assert.equal(r.status, 1, r.stdout + r.stderr);
    const reason = { empty: "empty fragment: MONO-9", "missing-heading": "missing heading", "same-key-changed-content": "fragment digest mismatch: MONO-9", unreadable: "not a regular file" }[scenario];
    assert.ok(r.stderr.includes(reason), r.stderr);
    if (scenario === "unreadable") {
      assert.equal(fs.readlinkSync(path.join(f.root, "changelog.d/MONO-11.md")), "missing-file");
      fs.unlinkSync(path.join(f.root, "changelog.d/MONO-11.md"));
    }
    assert.deepEqual(f.snapshot(), before);
  });
}

test("landing U4 golden: key mentioned in prose is not a marker", t => {
  const f = fixture(t);
  fs.writeFileSync(f.target, golden.initial.replace("Existing text", "MONO-9 and MONO-10 Existing text"));
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(f.target, "utf8"), golden.expected.replace("Existing text", "MONO-9 and MONO-10 Existing text"));
});

test("landing U4 golden: interruption after atomic replacement before deletion", t => {
  const f = fixture(t), preload = path.join(f.root, "interrupt.cjs");
  fs.writeFileSync(preload, 'const fs = require("node:fs"); const unlink = fs.unlinkSync; fs.unlinkSync = function(file) { if (String(file).endsWith(".md")) process.exit(73); return unlink.apply(this, arguments); };\n');
  const r = f.run([], ["--require", preload]); assert.equal(r.status, 73, r.stderr);
  assert.equal(fs.readFileSync(f.target, "utf8"), golden.expected);
  assert.equal(fs.readdirSync(path.join(f.root, "changelog.d")).length, 3);
  const retry = f.run(); assert.equal(retry.status, 0, retry.stderr);
  assert.equal(fs.readFileSync(f.target, "utf8"), golden.expected);
  assert.deepEqual(fs.readdirSync(path.join(f.root, "changelog.d")), []);
});

test("landing U4: replacement failure leaves target and records intact", t => {
  const f = fixture(t), before = f.snapshot(), preload = path.join(f.root, "rename-failure.cjs");
  fs.writeFileSync(preload, 'const fs = require("node:fs"); fs.renameSync = function() { throw new Error("fixture rename failure"); };\n');
  const r = f.run([], ["--require", preload]); assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes("fixture rename failure"));
  assert.deepEqual(f.snapshot(), before);
  assert.equal(fs.readdirSync(f.root).some(name => name.endsWith(".tmp")), false);
});

test("landing U4 golden: a heading inside a fragment survives interruption and retry", t => {
  const f = fixture(t);
  const headingGolden = JSON.parse(fs.readFileSync(new URL("./fixtures/changelog-u4/heading-in-fragment.json", import.meta.url)));
  for (const [name, body] of Object.entries(headingGolden.fragments)) fs.writeFileSync(path.join(f.root, "changelog.d", name), body);
  const preload = path.join(f.root, "interrupt.cjs");
  fs.writeFileSync(preload, 'const fs = require("node:fs"); const unlink = fs.unlinkSync; fs.unlinkSync = function(file) { if (String(file).endsWith(".md")) process.exit(73); return unlink.apply(this, arguments); };\n');
  const first = f.run([], ["--require", preload]); assert.equal(first.status, 73, first.stderr);
  assert.equal(fs.readFileSync(f.target, "utf8"), headingGolden.expected);
  const retry = f.run(); assert.equal(retry.status, 0, retry.stderr);
  assert.equal(fs.readFileSync(f.target, "utf8"), headingGolden.expected);
  assert.deepEqual(fs.readdirSync(path.join(f.root, "changelog.d")), []);
});

test("landing U4: absent policy is a no-op", t => {
  const f = fixture(t), before = f.snapshot(); fs.writeFileSync(f.config, "{}");
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("not configured")); assert.deepEqual(f.snapshot(), before);
});

test("landing U4: a directory alias cannot make the target a consumed fragment", t => {
  const f = fixture(t);
  fs.symlinkSync("changelog.d", path.join(f.root, "alias"), "dir");
  fs.writeFileSync(path.join(f.root, "changelog.d/MONO-9.md"), golden.initial);
  fs.writeFileSync(f.config, JSON.stringify({ landing: { changelog: {
    fragmentDir: "changelog.d", target: "alias/MONO-9.md", heading: "## [Unreleased]",
  } } }));
  const before = f.snapshot(), r = f.run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stderr.includes("target must be outside fragmentDir"));
  assert.deepEqual(f.snapshot(), before);
  assert.equal(fs.readlinkSync(path.join(f.root, "alias")), "changelog.d");
});
