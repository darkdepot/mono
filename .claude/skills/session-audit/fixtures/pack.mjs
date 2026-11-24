// A tiny invented pack with two tagged versions, built into a temporary git
// repository by the tests. Nothing here comes from real sessions.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const body = (title, lines) => `\n# ${title}\n\n${lines.map((line, i) => `Step ${i + 1}: ${line}`).join("\n")}\n`;

const reviewLines = [
  "read the artifact named in the request",
  "list each claim the artifact makes",
  "check every claim against its source",
  "mark the claims without a source",
  "rate the risk of each unsupported claim",
  "write findings in the order of risk",
  "keep findings short and concrete",
  "name the place of each finding",
  "suggest one fix per finding",
  "stop when every claim is checked",
  "report the count of findings",
  "return the report to the caller",
];

const plain = (name, title, count) => `---\nname: ${name}\ndescription: Invented ${name} skill used only by fixtures.\n---\n${body(title, Array.from({ length: count }, (_, i) => `${name} action number ${i + 1} of the invented flow`))}`;

export const PACK = {
  "v0.1.0": {
    ".claude-plugin/plugin.json": "{\n  \"name\": \"mono\"\n}\n",
    "skills/review/SKILL.md": `---\nname: review\ndescription: Invented review skill used only by fixtures.\n---\n${body("Review", reviewLines)}`,
    "skills/implement/SKILL.md": plain("implement", "Implement", 14),
    "skills/orchestrate/SKILL.md": plain("orchestrate", "Orchestrate", 40),
    "skills/qa/SKILL.md": plain("qa", "QA", 12),
    "references/guide.md": `# Guide\n\n${Array.from({ length: 10 }, (_, i) => `Guide rule ${i + 1} of the invented pack.`).join("\n")}\nGuide closing line for the first release.\n`,
  },
};

PACK["v0.2.0"] = {
  ...PACK["v0.1.0"],
  "skills/review/SKILL.md": PACK["v0.1.0"]["skills/review/SKILL.md"].replace("Step 9: suggest one fix per finding", "Step 9: suggest at most two fixes per finding"),
  "references/guide.md": PACK["v0.1.0"]["references/guide.md"].replace("Guide closing line for the first release.", "Guide closing line for the second release."),
};

const GIT = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "init.defaultBranch=main"];

function git(repo, args) {
  execFileSync("git", [...GIT, "-C", repo, ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

export function writeTree(dir, files) {
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// Temporary git repository with tags v0.1.0 and v0.2.0.
export function makePackRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", [...GIT, "init", "-q", dir], { stdio: "ignore" });
  for (const tag of ["v0.1.0", "v0.2.0"]) {
    writeTree(dir, PACK[tag]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", `release ${tag}`]);
    git(dir, ["tag", tag]);
  }
  return dir;
}

export function loadBody(tag, skill) {
  const text = PACK[tag][`skills/${skill}/SKILL.md`];
  return text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^\n+/, "");
}
