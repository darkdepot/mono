import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { test } from "node:test";

const script = path.resolve("scripts/release-notes.mjs");

function fixture(t, { version = "1.2.3", claude = version, codex = version, changelog } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-release-notes-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Release fixture");
  fs.writeFileSync(path.join(root, "VERSION"), `${version}\n`);
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), changelog ?? "## [Unreleased]\n\nUnreleased work.\n\n## [1.2.3] - 2026-10-13\n\n### Added\n\n- Release content.\n\n[1.2.3]: https://example.invalid/release\n\n## [1.2.2]\n\nOlder content.\n");
  for (const [dir, value] of [[".claude-plugin", claude], [".codex-plugin", codex]]) {
    if (value === null) continue;
    fs.mkdirSync(path.join(root, dir));
    fs.writeFileSync(path.join(root, dir, "plugin.json"), JSON.stringify({ version: value }));
  }
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts/release-notes.mjs"), "throw new Error('tag code executed');\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "release data");
  git("tag", "v1.2.3");
  const run = (tag = "v1.2.3") => spawnSync(process.execPath,
    [script, "--repo", root, "--tag", tag], { encoding: "utf8" });
  return { root, git, run };
}

test("release notes: section found, links removed, subheadings retained", t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "### Added\n\n- Release content.\n");
});

test("release notes: bracketed content headings do not end the version section", t => {
  const f = fixture(t, { changelog: "## [1.2.3]\n\nFirst notes.\n\n## [Context]\n\nMore release notes.\n\n## [1.2.2]\nOld notes.\n" });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "First notes.\n\n## [Context]\n\nMore release notes.\n");
});

for (const [name, options, message] of [
  ["section absent", { changelog: "## [Unreleased]\nPending.\n## [1.2.2]\nOlder.\n" }, "missing changelog section"],
  ["section empty after links removed", { changelog: "## [1.2.3]\n\n[1.2.3]: https://example.invalid\n\n## [1.2.2]\nOlder.\n" }, "empty changelog section"],
  ["section empty after named links removed", { changelog: "## [1.2.3]\n\n[Unreleased]: https://example.invalid/compare\n[issue]: https://example.invalid/issue\n\n## [1.2.2]\nOlder.\n" }, "empty changelog section"],
  ["section empty after indented links removed", { changelog: "## [1.2.3]\n\n   [issue]: https://example.invalid/issue\n" }, "empty changelog section"],
  ["section empty after links without colon spacing removed", { changelog: "## [1.2.3]\n\n[issue]:https://example.invalid/issue\n" }, "empty changelog section"],
  ["tag differs from VERSION", { version: "1.2.4" }, "tag/version mismatch"],
  ["Claude version differs", { claude: "1.2.4" }, ".claude-plugin/plugin.json version mismatch"],
  ["Codex version differs", { codex: "1.2.4" }, ".codex-plugin/plugin.json version mismatch"],
  ["Claude manifest absent", { claude: null }, ".claude-plugin/plugin.json"],
  ["Codex manifest absent", { codex: null }, ".codex-plugin/plugin.json"],
  ["Unreleased never selected", { version: "Unreleased" }, "invalid release version"],
]) {
  test(`release notes refusal: ${name}`, t => {
    const result = fixture(t, options).run();
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(message), result.stderr);
  });
}

test("release notes: exact existing tag data, not working tree or branch, no tag code", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "VERSION"), "9.9.9\n");
  f.git("add", "."); f.git("commit", "--quiet", "-m", "unreleased data");
  f.git("branch", "v9.9.9");
  assert.equal(f.run().status, 0);
  for (const tag of ["v9.9.9", "--help", "v1.2.3^{commit}"]) {
    const result = f.run(tag);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
});
