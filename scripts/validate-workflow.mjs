#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validationStateRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "mono-workflow-validator-state-")
);
process.on("exit", () => {
  fs.rmSync(validationStateRoot, { recursive: true, force: true });
});
const failures = [];
const EXPECTED_SKILLS = [
  "mono-check",
  "mono-deploy",
  "mono-handoff",
  "mono-idea",
  "mono-implement",
  "mono-issue",
  "mono-orchestrate",
  "mono-preflight",
  "mono-review",
  "mono-ship",
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function fail(message) {
  failures.push(message);
}

function artifactContractPinError(pin) {
  if (!exists(pin.path)) return `Missing artifact contract adapter: ${pin.path}`;
  if (!read(pin.path).includes(pin.snippet)) {
    return `${pin.path} must apply the complete migrated contract rule range`;
  }
  return null;
}

function listSkillNames() {
  return fs
    .readdirSync(path.join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mono-"))
    .map((entry) => entry.name)
    .sort();
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

function extractReadFirstEntries(text) {
  const index = text.indexOf("Read first:");
  if (index < 0) return { paths: [], malformedLines: [] };

  const paths = [];
  const malformedLines = [];
  const lines = text.slice(index + "Read first:".length).split("\n");
  let started = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^\d+\.\s+(.+)$/);
    if (!match) {
      if (started) break;
      continue;
    }
    started = true;
    const backtickedPaths = [...match[1].matchAll(/`([^`]+)`/g)].map((pathMatch) => pathMatch[1]);
    if (backtickedPaths.length === 0) malformedLines.push(line.trim());
    paths.push(...backtickedPaths);
  }

  return { paths, malformedLines };
}

function validateReadFirstPath(referencedPath) {
  if (referencedPath === "AGENTS.md") return exists("AGENTS.md");
  if (/^(https?:|\/)/.test(referencedPath)) return false;
  if (/[$<>]/.test(referencedPath)) return false;
  if (referencedPath.startsWith("./") || referencedPath.startsWith("../")) return false;
  if (/^(skills|references|templates|scripts)\//.test(referencedPath)) return exists(referencedPath);
  return false;
}

function runNode(args, options = {}) {
  const { env = {}, ...rest } = options;
  return execFileSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MONO_WORKFLOW_STATE_ROOT: validationStateRoot,
      ...env,
    },
    ...rest,
  });
}

function expectCommandFailure(label, callback, expectedText) {
  try {
    callback();
    fail(`${label} unexpectedly passed`);
  } catch (error) {
    const output = `${error.stdout?.toString() || ""}\n${error.stderr?.toString() || ""}`;
    if (expectedText && !output.includes(expectedText)) {
      fail(`${label} failed with unexpected output; expected to include "${expectedText}"`);
    }
  }
}

function issueOnlyLaneActivationError(config) {
  const lane = config.issueOnlyLane;
  if (lane === undefined) return null;
  if (!lane || typeof lane !== "object" || Array.isArray(lane)) {
    return "issueOnlyLane must be an object";
  }
  if (typeof lane.enabled !== "boolean") {
    return "issueOnlyLane.enabled must be a boolean";
  }
  if (!lane.enabled) return null;
  if (typeof lane.ownerPrincipal !== "string" || lane.ownerPrincipal.trim().length === 0) {
    return "enabled issueOnlyLane requires a non-empty ownerPrincipal";
  }
  return null;
}

function validateSkills() {
  const skills = listSkillNames();
  const skillSet = new Set(skills);

  for (const expectedSkill of EXPECTED_SKILLS) {
    if (!skillSet.has(expectedSkill)) fail(`Missing expected core skill: ${expectedSkill}`);
  }

  for (const skill of skills) {
    if (!EXPECTED_SKILLS.includes(skill)) fail(`Unexpected linear skill: ${skill}`);
  }

  for (const skill of skills) {
    const relativePath = `skills/${skill}/SKILL.md`;
    if (!exists(relativePath)) {
      fail(`Missing ${relativePath}`);
      continue;
    }

    const text = read(relativePath);
    const frontmatter = parseFrontmatter(text);
    if (!frontmatter) {
      fail(`${relativePath} must start with YAML frontmatter`);
    } else {
      if (frontmatter.name !== skill) fail(`${relativePath} frontmatter name must be ${skill}`);
      if (!frontmatter.description || frontmatter.description.length < 20) {
        fail(`${relativePath} needs a useful frontmatter description`);
      }
    }

    if (!text.includes("Read first:")) fail(`${relativePath} missing Read first section`);

    const { paths: readFirstPaths, malformedLines } = extractReadFirstEntries(text);
    for (const malformedLine of malformedLines) {
      fail(`${relativePath} has malformed Read first entry: ${malformedLine}`);
    }
    for (const referencedPath of readFirstPaths) {
      if (!validateReadFirstPath(referencedPath)) {
        fail(`${relativePath} has broken Read first path: ${referencedPath}`);
      }
    }

    if (text.length < 900) fail(`${relativePath} looks too small to be an executable source skill`);
  }
}

function retiredAdapterReferenceAllowed(relativePath) {
  return (
    relativePath === "CHANGELOG.md" ||
    relativePath === "scripts/validate-workflow.mjs" ||
    relativePath.startsWith("plans/") ||
    relativePath.startsWith("docs/spikes/")
  );
}

function validateRetiredAdapterReferenceAllowlist() {
  if (retiredAdapterReferenceAllowed("README.md")) {
    fail("Retired adapter reference allowlist must reject active documentation");
  }
  if (!retiredAdapterReferenceAllowed("plans/migration-fixture.md")) {
    fail("Retired adapter reference allowlist must preserve historical migration documents");
  }

  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const retiredReference = /mono-(?:project|prd|spec)(?:\/SKILL\.md)?/;

  for (const relativePath of files) {
    if (!exists(relativePath) || retiredAdapterReferenceAllowed(relativePath)) continue;
    // `git ls-files` reports a nested repository — a linked worktree or a
    // submodule — as one directory entry, and `exists` accepts it, so reading
    // it raises EISDIR. Only a regular file carries text to scan.
    if (!fs.statSync(path.join(root, relativePath)).isFile()) continue;
    const body = read(relativePath);
    if (retiredReference.test(body)) {
      fail(
        `${relativePath} references a retired Project/PRD/Tech Spec adapter outside the historical migration allowlist`
      );
    }
  }
}

const OWNER_LAYER_MAP_PATH = "docs/ru/karta-paka.md";
const OWNER_LAYER_MAP_FIELDS = [
  "Назначение:",
  "Кто читает:",
  "Ключевые правила:",
  "Что менять, чтобы…:",
];

// The owner-layer coverage inventory: every regular file under skills/,
// references/ (recursively, including contracts/), and templates/, plus
// scripts/*.mjs, AGENTS.md, and README.md. docs/, examples/, plans/,
// CHANGELOG.md, node_modules, and hidden entries stay out, so the map covers
// the pack surface a reader has to understand and nothing else.
function ownerLayerInventory() {
  const files = [];
  const walk = (relativeDir) => {
    for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const relativePath = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };
  for (const dir of ["skills", "references", "templates"]) walk(dir);
  // Same regular-file contract as walk(): a directory or symlink named
  // `<name>.mjs` is not a pack file and must not enter the inventory.
  for (const entry of fs.readdirSync(path.join(root, "scripts"), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || !entry.name.endsWith(".mjs") || !entry.isFile()) continue;
    files.push(`scripts/${entry.name}`);
  }
  files.push("AGENTS.md", "README.md");
  return files.sort();
}

// The one fence walk both owner-layer parsers share: headings and field lines
// are read only OUTSIDE fenced blocks, so a fenced example of the map or the
// constitution format never counts as real content.
function forEachOwnerLayerLine(text, visit) {
  let fence = null;
  for (const rawLine of text.split("\n")) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(rawLine);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const info = fenceMatch[2];
      if (fence === null) {
        // An opening fence may carry an info string, except that a backtick
        // fence's info string may not contain a backtick; such a line is
        // ordinary content and falls through to the parsing below.
        if (marker[0] !== "`" || !info.includes("`")) {
          fence = marker;
          continue;
        }
      } else {
        // A CLOSING fence carries no info string. ```js inside a ``` block is
        // content, not a close — treating it as one would end the block early
        // and expose the example's headings as real map coverage.
        if (marker[0] === fence[0] && marker.length >= fence.length && info.trim() === "") {
          fence = null;
        }
        continue;
      }
    }
    if (fence !== null) continue;
    visit(rawLine);
  }
}

// Entry headings and field lines are read only OUTSIDE fenced blocks, so a
// fenced example of the entry format never counts as coverage. Any other
// heading closes the current entry, which keeps a section heading from
// donating its fields to the entry above it.
function parseOwnerLayerMapEntries(text) {
  const entries = [];
  let current = null;
  forEachOwnerLayerLine(text, (rawLine) => {
    const heading = /^## `([^`]+)`\s*$/.exec(rawLine);
    if (heading) {
      current = { path: heading[1], fields: new Set() };
      entries.push(current);
      return;
    }
    if (/^#{1,6} /.test(rawLine)) {
      current = null;
      return;
    }
    if (!current) return;
    for (const field of OWNER_LAYER_MAP_FIELDS) {
      if (rawLine.startsWith(field)) current.fields.add(field);
    }
  });
  return entries;
}

// Parser fixtures: a fenced EXAMPLE of the entry format must never count as
// coverage, and an info-string line such as ```js inside a fence must not end
// the block. Structural in-process probes over synthetic text — they pin the
// parser's behaviour, not any sentence of the map.
function validateOwnerLayerMapParser() {
  const fencedExample = [
    "# Example map",
    "",
    "Версия пака: main",
    "",
    "```text",
    "## `references/inside-fence.md`",
    "",
    "Назначение: пример записи.",
    "```js",
    "## `references/after-info-string.md`",
    "```",
    "",
    "## `AGENTS.md`",
    "",
    "Назначение: правила репозитория.",
    "Кто читает: любой, кто меняет пак.",
    "Ключевые правила:",
    "",
    "- одно правило.",
    "",
    "Что менять, чтобы…:",
    "",
    "- цель → `AGENTS.md`.",
    "",
  ].join("\n");
  const parsed = parseOwnerLayerMapEntries(fencedExample);
  const parsedPaths = parsed.map((entry) => entry.path);
  if (JSON.stringify(parsedPaths) !== JSON.stringify(["AGENTS.md"])) {
    fail(
      `Owner-layer map parser must ignore fenced examples, including after an info-string line, found ${JSON.stringify(parsedPaths)}`
    );
  } else if (parsed[0].fields.size !== OWNER_LAYER_MAP_FIELDS.length) {
    fail("Owner-layer map parser must collect all four fields of an entry outside a fence");
  }

  const tildeFence = ["~~~text", "## `references/inside-tilde-fence.md`", "~~~", ""].join("\n");
  if (parseOwnerLayerMapEntries(tildeFence).length !== 0) {
    fail("Owner-layer map parser must ignore entries inside a tilde fence");
  }

  const duplicated = parseOwnerLayerMapEntries(
    ["## `AGENTS.md`", "", "Назначение: раз.", "", "## `AGENTS.md`", "", "Назначение: два.", ""].join("\n")
  );
  if (duplicated.length !== 2) {
    fail("Owner-layer map parser must report a repeated heading as a second entry so the duplicate check can see it");
  }
}

// Structural coverage only: every inventory file has an entry, every entry
// points at a real repository file, no heading repeats, and each entry carries
// the four fields. Nothing here pins Russian prose — the map's wording is the
// owner's to change in Linear.
function validateOwnerLayerMap() {
  if (!exists(OWNER_LAYER_MAP_PATH)) {
    fail(`Missing owner-layer map: ${OWNER_LAYER_MAP_PATH}`);
    return;
  }
  const text = read(OWNER_LAYER_MAP_PATH);
  if (!text.split("\n").slice(0, 5).some((line) => line.startsWith("Версия пака:"))) {
    fail(`${OWNER_LAYER_MAP_PATH} must carry a pack-version line in its first five lines`);
  }

  const seen = new Set();
  for (const entry of parseOwnerLayerMapEntries(text)) {
    if (seen.has(entry.path)) {
      fail(`${OWNER_LAYER_MAP_PATH} has a duplicate map entry: ${entry.path}`);
      continue;
    }
    seen.add(entry.path);
    if (path.isAbsolute(entry.path) || entry.path.split("/").includes("..")) {
      fail(`${OWNER_LAYER_MAP_PATH} has a map entry outside the repository: ${entry.path}`);
      continue;
    }
    if (!exists(entry.path)) {
      fail(`${OWNER_LAYER_MAP_PATH} maps a file that does not exist: ${entry.path}`);
      continue;
    }
    // `exists` is true for a directory or a symlink too, while the inventory
    // holds regular files only; hold both sides to the same contract.
    if (!fs.lstatSync(path.join(root, entry.path)).isFile()) {
      fail(`${OWNER_LAYER_MAP_PATH} maps a path that is not a regular file: ${entry.path}`);
      continue;
    }
    for (const field of OWNER_LAYER_MAP_FIELDS) {
      if (!entry.fields.has(field)) {
        fail(`${OWNER_LAYER_MAP_PATH} entry ${entry.path} is missing the field ${field}`);
      }
    }
  }
  for (const relativePath of ownerLayerInventory()) {
    if (!seen.has(relativePath)) {
      fail(`${OWNER_LAYER_MAP_PATH} is missing a map entry for ${relativePath}`);
    }
  }
}

const OWNER_LAYER_CONSTITUTION_PATH = "docs/ru/konstituciya-paka.md";
const OWNER_LAYER_CONSTITUTION_ANCHOR_FIELD = "Опора:";
const OWNER_LAYER_CONSTITUTION_PROPOSAL = "Статус: предложение";
// Every field an article may carry. The list exists to close the `Опора:` list
// when the next field starts, so a bullet under `Где живёт:` is prose and never
// an anchor. `Цитата:` is parsed for that boundary only and never validated.
// The three fields every article carries, proposal or not. `Опора:` is not
// here because the proposal marker exempts an article from it, and `Цитата:`
// is optional by design.
const OWNER_LAYER_CONSTITUTION_REQUIRED_FIELDS = ["Правило:", "Почему:", "Где живёт:"];
const OWNER_LAYER_CONSTITUTION_FIELDS = [
  "Правило:",
  "Почему:",
  "Где живёт:",
  "Цитата:",
  "Статус:",
  OWNER_LAYER_CONSTITUTION_ANCHOR_FIELD,
];

// Articles are `## К-NN.` headings read outside fenced blocks; any other
// heading closes the current article, so a section heading cannot donate its
// fields to the article above it. Anchor entries are collected only while the
// `Опора:` field is open.
function parseOwnerLayerConstitutionArticles(text) {
  const articles = [];
  const malformed = [];
  let current = null;
  let inAnchors = false;
  forEachOwnerLayerLine(text, (rawLine) => {
    const heading = /^## (К-\d+)\./.exec(rawLine);
    if (heading) {
      current = { number: heading[1], anchors: [], fields: new Set(), proposal: false };
      articles.push(current);
      inAnchors = false;
      return;
    }
    if (/^#{1,6} /.test(rawLine)) {
      // A heading that means to be an article but does not match the form —
      // a Latin `K`, a missing dot — would otherwise drop out of the walk in
      // silence, taking its anchors with it. Collect it so the check can say so.
      const nearMiss = /^#{1,6} +([KК][-–—][^\s]*)/.exec(rawLine);
      if (nearMiss) malformed.push(nearMiss[1]);
      current = null;
      inAnchors = false;
      return;
    }
    if (!current) return;
    if (rawLine.startsWith(OWNER_LAYER_CONSTITUTION_ANCHOR_FIELD)) {
      current.fields.add(OWNER_LAYER_CONSTITUTION_ANCHOR_FIELD);
      inAnchors = true;
      return;
    }
    if (rawLine.trim() === OWNER_LAYER_CONSTITUTION_PROPOSAL) {
      current.proposal = true;
      inAnchors = false;
      return;
    }
    const field = OWNER_LAYER_CONSTITUTION_FIELDS.find((name) => rawLine.startsWith(name));
    if (field) {
      current.fields.add(field);
      inAnchors = false;
      return;
    }
    if (!inAnchors) return;
    const anchor = /^-\s+`([^`]+)`\s+·\s+(\S.*?)\s*$/.exec(rawLine);
    if (anchor) current.anchors.push({ path: anchor[1], target: anchor[2] });
  });
  return { articles, malformed };
}

// What an anchor may point at inside one pack file: the text of an H1-H4
// heading (compared after the `#` markers), the ID of an `## <ID>` heading such
// as a contract clause, and the numbers of the invariants listed under
// `## Invariants`. Nothing here reads a sentence: a verbatim English phrase is
// never validated, which is what keeps the constitution from becoming a second
// layer of prose pins.
const ownerLayerAnchorTargetCache = new Map();

function ownerLayerAnchorTargets(relativePath) {
  const cached = ownerLayerAnchorTargetCache.get(relativePath);
  if (cached) return cached;
  const headings = new Set();
  const idHeadings = [];
  const invariants = new Set();
  let inInvariants = false;
  forEachOwnerLayerLine(read(relativePath), (rawLine) => {
    const heading = /^(#{1,4}) +(.*?) *$/.exec(rawLine);
    if (heading) {
      headings.add(heading[2]);
      if (heading[1] === "##") idHeadings.push(heading[2]);
      inInvariants = heading[1] === "##" && heading[2] === "Invariants";
      return;
    }
    if (/^#{1,6} /.test(rawLine)) {
      inInvariants = false;
      return;
    }
    if (!inInvariants) return;
    const invariant = /^ *(\d+)\./.exec(rawLine);
    if (invariant) invariants.add(invariant[1]);
  });
  const targets = { headings, idHeadings, invariants };
  ownerLayerAnchorTargetCache.set(relativePath, targets);
  return targets;
}

function resolveOwnerLayerAnchor(relativePath, target) {
  const targets = ownerLayerAnchorTargets(relativePath);
  const quoted = /^«(.+)»$/.exec(target);
  if (quoted) return targets.headings.has(quoted[1]);
  const invariant = /^(?:инвариант +)?(\d+)$/.exec(target);
  if (invariant) return targets.invariants.has(invariant[1]);
  // An ID anchors the heading that opens with it, so `PC-013` still resolves
  // against `## PC-013 — Idea state` without pinning the title after the dash.
  return targets.idHeadings.some((text) => text === target || text.startsWith(`${target} `));
}

// Structural anchor coverage only: article numbers are unique, every article
// without `Статус: предложение` carries at least one anchor, no anchor repeats
// inside one article, and every anchor names a pack file from the S1 inventory
// plus a heading or stable ID that exists in it. Nothing here pins the Russian
// prose — the wording of an article is the owner's to change in Linear.
function validateOwnerLayerConstitution() {
  if (!exists(OWNER_LAYER_CONSTITUTION_PATH)) {
    fail(`Missing owner-layer constitution: ${OWNER_LAYER_CONSTITUTION_PATH}`);
    return;
  }
  const text = read(OWNER_LAYER_CONSTITUTION_PATH);
  if (!text.split("\n").slice(0, 5).some((line) => line.startsWith("Версия пака:"))) {
    fail(`${OWNER_LAYER_CONSTITUTION_PATH} must carry a pack-version line in its first five lines`);
  }

  const { articles, malformed } = parseOwnerLayerConstitutionArticles(text);
  for (const heading of malformed) {
    fail(
      `${OWNER_LAYER_CONSTITUTION_PATH} has a heading that looks like an article but does not match \`## К-NN.\`: ${heading}`
    );
  }

  const inventory = new Set(ownerLayerInventory());
  const seen = new Set();
  for (const article of articles) {
    if (seen.has(article.number)) {
      fail(`${OWNER_LAYER_CONSTITUTION_PATH} has a duplicate article: ${article.number}`);
      continue;
    }
    seen.add(article.number);
    for (const requiredField of OWNER_LAYER_CONSTITUTION_REQUIRED_FIELDS) {
      if (!article.fields.has(requiredField)) {
        fail(
          `${OWNER_LAYER_CONSTITUTION_PATH} article ${article.number} is missing the field ${requiredField}`
        );
      }
    }
    if (article.anchors.length === 0) {
      if (!article.proposal) {
        fail(
          `${OWNER_LAYER_CONSTITUTION_PATH} article ${article.number} has no ${OWNER_LAYER_CONSTITUTION_ANCHOR_FIELD} entry and is not marked «${OWNER_LAYER_CONSTITUTION_PROPOSAL}»`
        );
      }
      continue;
    }
    const anchorsSeen = new Set();
    for (const anchor of article.anchors) {
      const label = `\`${anchor.path}\` · ${anchor.target}`;
      if (anchorsSeen.has(label)) {
        fail(`${OWNER_LAYER_CONSTITUTION_PATH} article ${article.number} repeats the anchor ${label}`);
        continue;
      }
      anchorsSeen.add(label);
      if (!inventory.has(anchor.path)) {
        fail(
          `${OWNER_LAYER_CONSTITUTION_PATH} article ${article.number} anchors ${label}: ${anchor.path} is not a pack file in the owner-layer inventory`
        );
        continue;
      }
      if (!resolveOwnerLayerAnchor(anchor.path, anchor.target)) {
        fail(
          `${OWNER_LAYER_CONSTITUTION_PATH} article ${article.number} anchors ${label}: no such heading or stable ID in ${anchor.path}`
        );
      }
    }
  }
}

// Parser fixtures: a fenced EXAMPLE of the article format must never count as
// an article, `Статус: предложение` must be seen, and a bullet list under a
// field other than `Опора:` must never be read as an anchor. Structural
// in-process probes over synthetic text — they pin the parser's behaviour, not
// any sentence of the constitution.
function validateOwnerLayerConstitutionParser() {
  const fenced = [
    "# Example",
    "",
    "Версия пака: main",
    "",
    "```text",
    "## К-99. Внутри забора",
    "",
    "Опора:",
    "",
    "- `AGENTS.md` · «Language»",
    "```",
    "",
    "## I. Раздел",
    "",
    "## К-01. Настоящая статья",
    "",
    "Правило: одно предложение.",
    "",
    "Опора:",
    "",
    "- `AGENTS.md` · «Language»",
    "",
    "## К-02. Предложение",
    "",
    "Правило: одно предложение.",
    "",
    "Статус: предложение",
    "",
  ].join("\n");
  const parsed = parseOwnerLayerConstitutionArticles(fenced).articles;
  const parsedNumbers = parsed.map((article) => article.number);
  if (JSON.stringify(parsedNumbers) !== JSON.stringify(["К-01", "К-02"])) {
    fail(
      `Owner-layer constitution parser must ignore fenced examples, found ${JSON.stringify(parsedNumbers)}`
    );
  } else if (parsed[0].anchors.length !== 1 || parsed[0].anchors[0].path !== "AGENTS.md") {
    fail("Owner-layer constitution parser must collect the Опора entry of an article outside a fence");
  } else if (parsed[1].proposal !== true || parsed[1].anchors.length !== 0) {
    fail(
      "Owner-layer constitution parser must mark «Статус: предложение» and leave that article without anchors"
    );
  }

  const otherField = parseOwnerLayerConstitutionArticles(
    ["## К-03. Только Где живёт", "", "Где живёт:", "", "- `AGENTS.md` · «Language»", ""].join("\n")
  ).articles;
  if (otherField.length !== 1 || otherField[0].anchors.length !== 0) {
    fail("Owner-layer constitution parser must count anchor entries only under Опора:");
  }

  const duplicated = parseOwnerLayerConstitutionArticles(
    ["## К-07. Раз", "", "Статус: предложение", "", "## К-07. Два", "", "Статус: предложение", ""].join("\n")
  ).articles;
  if (duplicated.length !== 2) {
    fail(
      "Owner-layer constitution parser must report a repeated article number as a second article so the duplicate check can see it"
    );
  }

  // Field collection: an article's own fields are recorded so the required-field
  // check can see a dropped one, and a heading that means to be an article but
  // misses the form is reported instead of silently vanishing from the walk.
  const fields = parseOwnerLayerConstitutionArticles(
    ["## К-04. Все поля", "", "Правило: одно предложение.", "", "Почему: одна причина.", "", "Где живёт: `AGENTS.md`.", ""].join("\n")
  ).articles;
  if (
    !fields[0].fields.has("Правило:") ||
    !fields[0].fields.has("Почему:") ||
    !fields[0].fields.has("Где живёт:")
  ) {
    fail("Owner-layer constitution parser must record the fields an article carries");
  }

  const nearMiss = parseOwnerLayerConstitutionArticles(
    ["## K-05. Латинская K", "", "Правило: одно предложение.", "", "## К-06 без точки", "", "Правило: одно предложение.", ""].join("\n")
  );
  if (nearMiss.articles.length !== 0 || nearMiss.malformed.length !== 2) {
    fail(
      `Owner-layer constitution parser must report a heading that looks like an article but does not match the form, found ${JSON.stringify(nearMiss.malformed)}`
    );
  }
}

function validateArtifactContractParity() {
  const indexPath = "references/artifact-contracts.md";
  const missingAdapterFixturePath = "skills/__missing-adapter-fixture__/SKILL.md";
  const missingAdapterFixtureError = artifactContractPinError({
    path: missingAdapterFixturePath,
    snippet: "unused fixture snippet",
  });
  if (missingAdapterFixtureError !== `Missing artifact contract adapter: ${missingAdapterFixturePath}`) {
    fail("Artifact contract adapter missing-file fixture must return a controlled validation failure");
  }
  const artifacts = {
    project: {
      prefix: "PC",
      contractPath: "references/contracts/project.md",
      ledgerSourcePath: "references/contracts/project.md",
      templatePath: "templates/project.md",
      contractFingerprint: "2f7764d7b156d77daa51358db7be4dc77963f5522033237a889fb6b91785fa24",
      contractConsumers: [
        "skills/mono-idea/SKILL.md",
        "skills/mono-handoff/SKILL.md",
      ],
    },
    prd: {
      prefix: "PR",
      contractPath: "references/contracts/prd.md",
      ledgerSourcePath: "references/contracts/prd.md",
      templatePath: "templates/prd.md",
      contractFingerprint: "26b9abe56f353541ff3f39af271b394b3292fd63056efcca689d98e07b8ba234",
      contractConsumers: [
        "skills/mono-handoff/SKILL.md",
        "skills/mono-ship/SKILL.md",
      ],
    },
    "tech-spec": {
      prefix: "TS",
      contractPath: "references/contracts/tech-spec.md",
      ledgerSourcePath: "references/contracts/tech-spec.md",
      templatePath: "templates/tech-spec.md",
      contractFingerprint: "80eeaac564a09e28de1c92996115fd09fc2463ebc2073cb4c73597bc3135522f",
      contractConsumers: [
        "skills/mono-handoff/SKILL.md",
        "skills/mono-ship/SKILL.md",
      ],
    },
    issue: {
      prefix: "IS",
      contractPath: "references/contracts/issue.md",
      ledgerSourcePath: "references/contracts/issue.md",
      templatePath: "templates/issue.md",
      contractFingerprint: "685fc2e574a114dca4e76bba3ce0fee2592748d948b7a7db663fa5b53a103ebe",
      contractConsumers: ["skills/mono-issue/SKILL.md"],
    },
  };

  if (!exists(indexPath)) {
    fail(`Missing artifact contract index: ${indexPath}`);
    return;
  }

  const index = read(indexPath);
  const ledgerRows = new Map();
  const ledgerRuleOwners = new Map();
  const definedIds = new Map();

  for (const [artifact, config] of Object.entries(artifacts)) {
    const contractLink = `[${artifact}](contracts/${artifact}.md)`;
    if (!index.includes(contractLink)) fail(`${indexPath} missing contract link ${contractLink}`);

    if (!exists(config.contractPath)) {
      fail(`Missing artifact contract: ${config.contractPath}`);
      continue;
    }

    const contract = read(config.contractPath);
    if (config.contractFingerprint) {
      const actualContractFingerprint = createHash("sha256").update(contract).digest("hex");
      if (actualContractFingerprint !== config.contractFingerprint) {
        fail(`${config.contractPath} normative contract fingerprint changed; update its migrated pin`);
      }
      for (const consumerPath of config.contractConsumers) {
        if (!exists(consumerPath)) {
          fail(`Missing artifact contract consumer: ${consumerPath}`);
          continue;
        }
        const { paths } = extractReadFirstEntries(read(consumerPath));
        if (!paths.includes(config.contractPath)) {
          fail(`${consumerPath} must read ${config.contractPath} as its normative artifact source`);
        }
      }
      if (config.adapterContractPin) {
        const pinError = artifactContractPinError(config.adapterContractPin);
        if (pinError) fail(pinError);
      }
    } else {
      if (!exists(config.sourcePath)) {
        fail(`Missing artifact contract source: ${config.sourcePath}`);
        continue;
      }
      const sourceLines = read(config.sourcePath).replace(/\r\n?/g, "\n").split("\n");
      const anchoredSource = [];
      for (const anchor of config.anchors) {
        const [startToken, endToken = startToken] = String(anchor).split("-");
        const start = Number(startToken);
        const end = Number(endToken);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > sourceLines.length) {
          fail(`${config.sourcePath}:${anchor} is not a valid source anchor`);
          continue;
        }
        anchoredSource.push(`${anchor}\n${sourceLines.slice(start - 1, end).join("\n")}`);
      }
      const actualSourceFingerprint = createHash("sha256").update(anchoredSource.join("\n---\n")).digest("hex");
      if (actualSourceFingerprint !== config.sourceFingerprint) {
        fail(`${config.sourcePath} normative source content fingerprint changed; update its contract and parity ledger`);
      }
    }
    const relativeTemplatePath = `../../${config.templatePath}`;
    const templateLink = `[${config.templatePath}](${relativeTemplatePath})`;
    if (!contract.includes(templateLink)) fail(`${config.contractPath} must link ${config.templatePath}`);
    if (contract.includes("```")) fail(`${config.contractPath} must link templates instead of copying fenced template content`);

    const rulePattern = new RegExp(`^## (${config.prefix}-\\d{3}) — .+$`, "gm");
    for (const match of contract.matchAll(rulePattern)) {
      const ruleId = match[1];
      if (definedIds.has(ruleId)) {
        fail(`Duplicate artifact contract rule ID ${ruleId} in ${definedIds.get(ruleId)} and ${config.contractPath}`);
      } else {
        definedIds.set(ruleId, config.contractPath);
      }
    }
  }

  const ledgerPattern = /^\| `([^`]+)` \| `((?:PC|PR|TS|IS)-\d{3})` \| ([^|]+) \|[ \t]*$/gm;
  for (const match of index.matchAll(ledgerPattern)) {
    const [, sourceAnchor, ruleId, consumers] = match;
    if (ledgerRows.has(sourceAnchor)) fail(`Duplicate parity ledger source anchor ${sourceAnchor}`);
    if (ledgerRuleOwners.has(ruleId)) {
      fail(`Duplicate parity ledger rule ID ${ruleId} for ${ledgerRuleOwners.get(ruleId)} and ${sourceAnchor}`);
    } else {
      ledgerRuleOwners.set(ruleId, sourceAnchor);
    }
    ledgerRows.set(sourceAnchor, { ruleId, consumers: consumers.trim() });
  }

  for (const config of Object.values(artifacts)) {
    const ruleIds = [...definedIds.entries()]
      .filter(([ruleId, contractPath]) => contractPath === config.contractPath && ruleId.startsWith(`${config.prefix}-`))
      .map(([ruleId]) => ruleId)
      .sort();
    const sourceAnchors = config.ledgerSourcePath
      ? ruleIds.map((ruleId) => `${config.ledgerSourcePath}#${ruleId}`)
      : config.legacyAnchors.map((anchor) => `${config.legacySourcePath}:${anchor}`);
    for (const [anchorIndex, sourceAnchor] of sourceAnchors.entries()) {
      const expectedRuleId = `${config.prefix}-${String(anchorIndex + 1).padStart(3, "0")}`;
      const row = ledgerRows.get(sourceAnchor);
      if (!row) {
        fail(`${indexPath} missing parity ledger row for ${sourceAnchor}`);
        continue;
      }
      if (!definedIds.has(row.ruleId)) fail(`${sourceAnchor} maps to undefined rule ID ${row.ruleId}`);
      if (row.ruleId !== expectedRuleId) {
        fail(`${sourceAnchor} maps to ${row.ruleId}; expected rule ID ${expectedRuleId}`);
      }
      if (!row.ruleId.startsWith(`${config.prefix}-`)) {
        fail(`${sourceAnchor} must map to a ${config.prefix}-* rule ID, got ${row.ruleId}`);
      }
      if (!/`[^`]+`/.test(row.consumers)) fail(`${sourceAnchor} must name at least one consumer`);
    }
  }

  for (const sourceAnchor of ledgerRows.keys()) {
    const known = Object.values(artifacts).some((config) => {
      if (config.ledgerSourcePath) {
        return sourceAnchor.startsWith(`${config.ledgerSourcePath}#${config.prefix}-`);
      }
      return config.legacyAnchors.some(
        (anchor) => sourceAnchor === `${config.legacySourcePath}:${anchor}`
      );
    });
    if (!known) fail(`${indexPath} has unexpected parity ledger source anchor ${sourceAnchor}`);
  }

  const mappedIds = new Set([...ledgerRows.values()].map((row) => row.ruleId));
  for (const [ruleId, contractPath] of definedIds) {
    if (!mappedIds.has(ruleId)) fail(`${contractPath} defines unmapped rule ID ${ruleId}`);
  }
}

function validateRepairAndRoutingContract() {
  const repairContractPath = "references/repair-machine.md";
  if (!exists(repairContractPath)) {
    fail(`Missing repair-machine contract: ${repairContractPath}`);
    return;
  }

  const repairContract = read(repairContractPath);
  const classificationFixtures = [
    ["typo-or-format", "1"],
    ["how-only", "2"],
    ["requirement", "3"],
    ["acceptance", "3"],
    ["non-goal", "3"],
    ["risk", "3"],
    ["issue-set", "3"],
    ["visible-behavior", "3"],
    ["ambiguous", "3"],
  ];
  for (const [fixture, expectedClass] of classificationFixtures) {
    const rowPattern = new RegExp(
      "^\\| `" + fixture + "` \\| [^\\n]+ \\| `" + expectedClass + "` \\|",
      "m"
    );
    if (!rowPattern.test(repairContract)) {
      fail(`Repair classification fixture ${fixture} must resolve to class ${expectedClass}`);
    }
  }

  const routingOverlapFixtures = [
    ["existing-project-pre-ship-drift", "mono-ship"],
    ["issue-only-body-edit", "mono-issue"],
    ["existing-project-targeted-repair", "mono-handoff repair"],
  ];
  for (const [fixture, expectedOwner] of routingOverlapFixtures) {
    const rowPattern = new RegExp(
      "^\\| `" + fixture + "` \\| [^\\n]+ \\| `" + expectedOwner + "` \\|",
      "m"
    );
    if (!rowPattern.test(repairContract)) {
      fail(`Repair routing overlap fixture ${fixture} must resolve to ${expectedOwner}`);
    }
  }

}

function validateLocalInstallBehavior() {
  const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-workflow-skills-"));
  const installedResolver = path.join(skillsRoot, ".mono-agent-workflow", "scripts", "resolve-issue-context.mjs");
  const installedPackVerifier = path.join(skillsRoot, ".mono-agent-workflow", "scripts", "verify-pack-state.mjs");
  const installedWatcher = path.join(skillsRoot, ".mono-agent-workflow", "scripts", "watch-workers.mjs");
  const ownerMapRelativePath = ".mono-agent-workflow/docs/ru/karta-paka.md";
  const installedOwnerMap = path.join(skillsRoot, ...ownerMapRelativePath.split("/"));
  const legacySkillDir = path.join(skillsRoot, "linear-check");
  const legacyLockPath = path.join(skillsRoot, ".linear-agent-workflow.lock.json");
  const legacyRuntimeDir = path.join(skillsRoot, ".linear-agent-workflow");
  try {
    expectCommandFailure(
      "install-local --check --remove-stale conflict",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check", "--remove-stale"]),
      "--remove-stale has no effect in --check mode"
    );

    fs.mkdirSync(legacySkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacySkillDir, "SKILL.md"),
      "<!-- Installed from darkdepot/linear-agent-workflow @ legacy. Do not edit manually. -->\n"
    );
    fs.mkdirSync(legacyRuntimeDir, { recursive: true });
    fs.writeFileSync(path.join(legacyRuntimeDir, "legacy.mjs"), "// legacy\n");
    fs.writeFileSync(
      legacyLockPath,
      `${JSON.stringify({ installedSkills: [{ name: "linear-check" }] }, null, 2)}\n`
    );

    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);

    const lockPath = path.join(skillsRoot, ".mono-agent-workflow.lock.json");
    const installedIdentity = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const expectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    if (installedIdentity.packVersion !== read("VERSION").trim()) {
      fail("Local install lockfile packVersion must equal VERSION");
    }
    if (installedIdentity.sourceCommit !== expectedCommit) {
      fail("Local install lockfile sourceCommit must equal the immutable source HEAD");
    }
    if (installedIdentity.surfaceRevision !== 3) {
      fail("Local install lockfile surfaceRevision must equal the current surface revision");
    }
    if (installedIdentity.installedSkills?.length !== EXPECTED_SKILLS.length) {
      fail(`Fresh local install must contain exactly ${EXPECTED_SKILLS.length} skills`);
    }
    for (const retired of ["mono-project", "mono-prd", "mono-spec"]) {
      if (fs.existsSync(path.join(skillsRoot, retired))) {
        fail(`Fresh 10-skill install unexpectedly contains retired adapter ${retired}`);
      }
    }
    if (fs.existsSync(path.join(skillsRoot, "mono-issue-intake"))) {
      fail("Fresh 10-skill install unexpectedly contains retired mono-issue-intake");
    }
    const installedIssue = fs.readFileSync(path.join(skillsRoot, "mono-issue", "SKILL.md"), "utf8");
    if (parseFrontmatter(installedIssue)?.name !== "mono-issue") {
      fail("Installed mono-issue must be the issue-only front door, not the retired atomic adapter");
    }
    const installedIssueLock = installedIdentity.installedSkills.find((entry) => entry.name === "mono-issue");
    const installedIssueHash = createHash("sha256").update(installedIssue).digest("hex");
    if (installedIssueLock?.sha256 !== installedIssueHash) {
      fail("Installed mono-issue hash must match the installed front-door body");
    }
    if (!fs.existsSync(installedPackVerifier)) {
      fail("Local install missing the canonical pack-state verifier");
    } else {
      runNode([
        installedPackVerifier,
        "identity",
        "--lock",
        lockPath,
        "--pack-version",
        installedIdentity.packVersion,
        "--source-commit",
        installedIdentity.sourceCommit,
        "--surface-revision",
        String(installedIdentity.surfaceRevision),
      ]);
    }
    if (!fs.existsSync(installedWatcher)) {
      fail("Local install missing the canonical heartbeat watcher");
    } else {
      const watcherManifestPath = ".mono-agent-workflow/scripts/watch-workers.mjs";
      const watcherManifest = installedIdentity.runtimeScripts?.find(
        (entry) => entry.path === watcherManifestPath
      );
      const installedWatcherHash = createHash("sha256")
        .update(fs.readFileSync(installedWatcher))
        .digest("hex");
      if (watcherManifest?.sha256 !== installedWatcherHash) {
        fail("Local install heartbeat watcher hash must match the runtimeScripts manifest");
      }
    }

    if (fs.existsSync(legacySkillDir)) fail("Local install kept previous-brand linear-check");
    if (fs.existsSync(legacyLockPath)) fail("Local install kept previous-brand lockfile");
    if (fs.existsSync(legacyRuntimeDir)) fail("Local install kept previous-brand runtime directory");

    for (const skill of EXPECTED_SKILLS) {
      const skillPath = path.join(skillsRoot, skill, "SKILL.md");
      if (!fs.existsSync(skillPath)) {
        fail(`Local install missing ${skill}`);
        continue;
      }
      const skillText = fs.readFileSync(skillPath, "utf8");
      if (!skillText.includes("Installed by Mono Agent Workflow")) {
        fail(`Local install ${skill} missing generated metadata`);
      }
      if (!skillText.includes("`.agents/mono-workflow.config.json`")) {
        fail(`Local install ${skill} missing project config note`);
      }
      if (/`skills\/mono-/.test(skillText)) {
        fail(`Local install ${skill} kept repo-root peer skill paths`);
      }
    }

    // AC3: the issue-only resolver is installed at the canonical pack-private
    // path and is runnable in the installed layout — the create-then-approve
    // intake (MONO-15) invokes it from here at delivery time.
    if (!fs.existsSync(installedResolver)) {
      fail("Local install missing the canonical issue-only resolver");
    } else {
      const probeIssue = path.join(skillsRoot, "probe-issue.md");
      fs.writeFileSync(
        probeIssue,
        ["# Probe", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
      );
      const probeFp = runNode([installedResolver, "--issue", probeIssue, "--emit-fingerprint"]).trim();
      if (!/^[0-9a-f]{64}$/.test(probeFp)) {
        fail("Installed issue-only resolver must be runnable and emit a 64-hex fingerprint");
      }
      fs.rmSync(probeIssue, { force: true });
    }

    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]);

    // AC3: execute the INSTALLED watcher, not the upstream source copy. A
    // malformed synthetic worker log produces spawn-fail immediately, avoiding
    // filesystem birthtime/ctime/mtime assumptions across macOS and Linux.
    const watcherFixtureRoot = path.join(skillsRoot, "watcher-fixture");
    const watcherLogsDir = path.join(watcherFixtureRoot, "logs");
    fs.mkdirSync(watcherLogsDir, { recursive: true });
    const watcherLogPath = path.join(watcherLogsDir, "MONO-39-mono-implement-a1.jsonl");
    fs.writeFileSync(watcherLogPath, "synthetic non-json worker output\n");
    fs.writeFileSync(
      path.join(watcherFixtureRoot, "workers.json"),
      `${JSON.stringify({
        "MONO-39": {
          transport: "codex-cli",
          stage: "mono-implement",
          pid: 999_999_999,
          log: watcherLogPath,
        },
      }, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(watcherFixtureRoot, "control.json"),
      `${JSON.stringify({ state: "active" }, null, 2)}\n`
    );
    const installedWatcherOutput = runNode([
      installedWatcher,
      "--root",
      watcherFixtureRoot,
      "--once",
    ]);
    if (!installedWatcherOutput.includes("EVENT:spawn-fail MONO-39")) {
      fail("Installed heartbeat watcher must emit an event for the synthetic registry/log fixture");
    }

    for (const [field, value, expectedText] of [
      ["packVersion", "0.0.0", "Lockfile packVersion is 0.0.0"],
      ["sourceCommit", "b".repeat(40), "Lockfile sourceCommit mismatch"],
      ["surfaceRevision", 99, "Lockfile surfaceRevision is 99"],
    ]) {
      const tamperedLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      tamperedLock[field] = value;
      fs.writeFileSync(lockPath, `${JSON.stringify(tamperedLock, null, 2)}\n`);
      expectCommandFailure(
        `install-local --check tampered ${field} fixture`,
        () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
        expectedText
      );
      runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    }

    fs.appendFileSync(path.join(skillsRoot, "mono-review", "SKILL.md"), "\nBROKEN\n");
    expectCommandFailure(
      "install-local --check edited skill fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "stale or edited"
    );

    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.appendFileSync(path.join(skillsRoot, "mono-review", "references", "review-rubric.md"), "\nBROKEN\n");
    expectCommandFailure(
      "install-local --check edited reference fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "stale or edited"
    );

    // A tampered installed runtime script is caught by --check, exactly like an
    // edited skill body or reference.
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.appendFileSync(installedResolver, "\n// BROKEN\n");
    expectCommandFailure(
      "install-local --check edited runtime script fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "stale or edited"
    );

    // AC1 negative probe: deleting the installed watcher makes --check fail.
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.rmSync(installedWatcher, { force: true });
    expectCommandFailure(
      "install-local --check missing heartbeat watcher fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "Missing installed runtime script: .mono-agent-workflow/scripts/watch-workers.mjs"
    );

    // The "unexpected" branch: an extra file under the canonical scripts dir is
    // flagged (mirrors the copied-asset unexpected-file test).
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.writeFileSync(path.join(skillsRoot, ".mono-agent-workflow", "scripts", "stray.mjs"), "// stray\n");
    expectCommandFailure(
      "install-local --check unexpected runtime script fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "Unexpected installed pack file"
    );

    // The tamper scan walks the whole .mono-agent-workflow/ root: a file planted
    // one level up (not under scripts/) is flagged too.
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.writeFileSync(path.join(skillsRoot, ".mono-agent-workflow", "evil.mjs"), "// evil\n");
    expectCommandFailure(
      "install-local --check pack-root stray file fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "Unexpected installed pack file"
    );

    // AC2: the owner-layer documents are installed as pack-private payload at
    // <skills-root>/.mono-agent-workflow/docs/ru/, their hashes are recorded in
    // the lockfile under `ownerLayer`, and --check holds them exactly like a
    // runtime script — missing, edited, and extra each fail.
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    const ownerLayerLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (!Array.isArray(ownerLayerLock.ownerLayer) || ownerLayerLock.ownerLayer.length === 0) {
      fail("Local install lockfile must record the owner-layer documents in ownerLayer");
    } else if (!fs.existsSync(installedOwnerMap)) {
      fail("Local install missing the installed owner-layer map");
    } else {
      const ownerMapEntry = ownerLayerLock.ownerLayer.find(
        (entry) => entry.path === ownerMapRelativePath
      );
      const installedOwnerMapHash = createHash("sha256")
        .update(fs.readFileSync(installedOwnerMap))
        .digest("hex");
      if (ownerMapEntry?.sha256 !== installedOwnerMapHash) {
        fail("Local install owner-layer map hash must match the ownerLayer manifest");
      }
      if (fs.readFileSync(installedOwnerMap, "utf8") !== read("docs/ru/karta-paka.md")) {
        fail("Local install owner-layer map must be copied verbatim from the upstream checkout");
      }
    }

    fs.rmSync(installedOwnerMap, { force: true });
    expectCommandFailure(
      "install-local --check missing owner-layer document fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      `Missing installed owner-layer document: ${ownerMapRelativePath}`
    );

    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.appendFileSync(installedOwnerMap, "\nBROKEN\n");
    expectCommandFailure(
      "install-local --check edited owner-layer document fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "Installed owner-layer document is stale or edited"
    );

    // The allowlist stays fail-closed for the new payload directory too: an
    // extra file beside an installed owner-layer document is still an error.
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.writeFileSync(path.join(path.dirname(installedOwnerMap), "stray.md"), "# stray\n");
    expectCommandFailure(
      "install-local --check unexpected owner-layer document fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "Unexpected installed pack file"
    );

    // schemaVersion 2 -> 3 migration: a pre-MONO-19 lockfile (v2 shape, no
    // runtimeScripts) fails --check loudly, and a re-sync upgrades it to a clean
    // v3 install that passes.
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    const v2Lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    v2Lock.schemaVersion = 2;
    delete v2Lock.runtimeScripts;
    fs.writeFileSync(lockPath, `${JSON.stringify(v2Lock, null, 2)}\n`);
    expectCommandFailure(
      "install-local --check schemaVersion 2 lockfile fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "Lockfile schemaVersion must be 3"
    );
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]);
  } finally {
    fs.rmSync(skillsRoot, { recursive: true, force: true });
  }
}

function validatePackIdentityAndQuiescenceBehavior() {
  const script = "scripts/verify-pack-state.mjs";
  if (!exists(script)) {
    fail(`Missing ${script}`);
    return;
  }

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-workflow-pack-state-"));
  const lockPath = path.join(fixtureRoot, ".mono-agent-workflow.lock.json");
  const controlPath = path.join(fixtureRoot, "control.json");
  const workersPath = path.join(fixtureRoot, "workers.json");
  const identity = {
    packVersion: "0.20.1",
    sourceCommit: "a".repeat(40),
    surfaceRevision: 1,
  };

  try {
    fs.writeFileSync(lockPath, `${JSON.stringify(identity, null, 2)}\n`);

    // AC1: the four identity-bearing JSON surfaces and control.json accept the
    // canonical additive shape. Template pins below keep the prose examples in
    // lockstep with these executable fixtures.
    const dispatch = { ...identity };
    const registry = { "MONO-30": { ...identity } };
    const report = { issue: "MONO-30", stage: "mono-implement", ...identity };
    const control = { state: "idle" };
    for (const [label, value] of Object.entries({ dispatch, report })) {
      if (
        typeof value.packVersion !== "string" ||
        !/^[0-9a-f]{40}$/.test(value.sourceCommit) ||
        !Number.isInteger(value.surfaceRevision) ||
        value.surfaceRevision < 1
      ) {
        fail(`${label} identity schema fixture rejected the canonical shape`);
      }
    }
    if (Object.values(registry).some((entry) => entry.surfaceRevision !== identity.surfaceRevision)) {
      fail("workers.json identity schema fixture rejected the canonical shape");
    }
    if (!["active", "draining", "idle"].includes(control.state)) {
      fail("control.json schema fixture rejected the canonical shape");
    }

    runNode([
      script,
      "identity",
      "--lock",
      lockPath,
      "--pack-version",
      identity.packVersion,
      "--source-commit",
      identity.sourceCommit,
      "--surface-revision",
      String(identity.surfaceRevision),
    ]);

    // AC2: either immutable source commit or surface revision drift is a hard
    // stage block. Both fields are changed in one probe so the error must name
    // both mismatches rather than short-circuiting after the first.
    expectCommandFailure(
      "pack identity mismatch fixture",
      () =>
        runNode([
          script,
          "identity",
          "--lock",
          lockPath,
          "--pack-version",
          identity.packVersion,
          "--source-commit",
          "b".repeat(40),
          "--surface-revision",
          "3",
        ]),
      "sourceCommit expected"
    );
    expectCommandFailure(
      "pack surface revision mismatch fixture",
      () =>
        runNode([
          script,
          "identity",
          "--lock",
          lockPath,
          "--pack-version",
          identity.packVersion,
          "--source-commit",
          identity.sourceCommit,
          "--surface-revision",
          "3",
        ]),
      "surfaceRevision expected 3 but installed 1"
    );

    // AC3: breaking-install quiescence is exactly idle + empty registry.
    fs.writeFileSync(controlPath, `${JSON.stringify(control, null, 2)}\n`);
    fs.writeFileSync(workersPath, "{}\n");
    runNode([script, "quiescence", "--root", fixtureRoot]);

    fs.writeFileSync(
      workersPath,
      `${JSON.stringify({ "MONO-30": registry["MONO-30"] }, null, 2)}\n`
    );
    expectCommandFailure(
      "pack nonempty worker registry quiescence fixture",
      () => runNode([script, "quiescence", "--root", fixtureRoot]),
      "workers.json has 1 active worker"
    );

    fs.writeFileSync(workersPath, "{}\n");
    fs.writeFileSync(controlPath, `${JSON.stringify({ state: "paused" }, null, 2)}\n`);
    expectCommandFailure(
      "pack invalid control schema fixture",
      () => runNode([script, "quiescence", "--root", fixtureRoot]),
      "control.state must be one of active, draining, idle"
    );
    for (const state of ["active", "draining"]) {
      fs.writeFileSync(controlPath, `${JSON.stringify({ state }, null, 2)}\n`);
      expectCommandFailure(
        `pack ${state} control quiescence fixture`,
        () => runNode([script, "quiescence", "--root", fixtureRoot]),
        `control.state=${state}`
      );
    }

    const surfaceRevisionMatch = read("scripts/install-local.mjs").match(
      /const SURFACE_REVISION = (\d+);/
    );
    if (!surfaceRevisionMatch) {
      fail("install-local must declare the canonical numeric SURFACE_REVISION");
    } else {
      // The report and registry examples must never hand a worker a concrete
      // revision to copy: during a surface cut-over the code constant and the
      // dispatch pin are deliberately different numbers, and only the dispatch
      // pin belongs in a report or a registry entry. The placeholder is
      // unquoted because the emitted value must be an integer, never a string.
      const reportTemplate = read("templates/orchestrator-report.md");
      if (/"surfaceRevision":\s*\d/.test(reportTemplate)) {
        fail(
          `orchestrator report template must not pin a concrete surfaceRevision (code constant is ${surfaceRevisionMatch[1]}); its examples repeat the dispatch pin`
        );
      }
      const reportSurfacePin = '"surfaceRevision": <repeat the dispatch pin, integer>,';
      const reportSurfacePins = reportTemplate.split(reportSurfacePin).length - 1;
      if (reportSurfacePins !== 2) {
        fail(
          `orchestrator report template must show ${reportSurfacePin} in both report and registry shapes`
        );
      }
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function validateMultiRootInstallBehavior() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mono-workflow-multi-root-"));
  const codexRoot = path.join(baseDir, "codex", "skills");
  const claudeRoot = path.join(baseDir, "claude", "skills");
  const recordedRoot = path.join(baseDir, "recorded", "skills");
  const lockName = ".mono-agent-workflow.lock.json";
  const env = {
    ...process.env,
    MONO_WORKFLOW_KNOWN_ROOTS: [codexRoot, claudeRoot].join(path.delimiter),
  };
  const version = read("VERSION").trim();

  try {
    expectCommandFailure(
      "install-local --all-roots --skills-root conflict",
      () => runNode(["scripts/install-local.mjs", "--all-roots", "--skills-root", codexRoot]),
      "--all-roots cannot be combined with --skills-root"
    );

    // Fresh machine: no lockfiles anywhere, default mode installs the first known root only.
    const fallbackOutput = runNode(["scripts/install-local.mjs"], { env });
    if (!fallbackOutput.includes("No installed skills roots found")) {
      fail("install-local default mode must report the fresh-install fallback");
    }
    if (!fs.existsSync(path.join(codexRoot, lockName))) {
      fail("install-local default mode must install into the first known root on a fresh machine");
    }
    if (fs.existsSync(claudeRoot)) {
      fail("install-local fresh-install fallback must not create other known roots");
    }

    // With a second installed root, one default run must sync every root and report per-root versions.
    runNode(["scripts/install-local.mjs", "--skills-root", claudeRoot], { env });
    const syncOutput = runNode(["scripts/install-local.mjs", "--all-roots", "--remove-stale"], { env });
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      if (!syncOutput.includes(`Installed ${EXPECTED_SKILLS.length} Mono workflow skills into ${skillsRoot} (version ${version})`)) {
        fail(`install-local --all-roots must report a per-root install for ${skillsRoot}`);
      }
      // AC3: every synced root gets the pack-private resolver at the canonical path.
      if (!fs.existsSync(path.join(skillsRoot, ".mono-agent-workflow", "scripts", "resolve-issue-context.mjs"))) {
        fail(`install-local --all-roots must install the issue-only resolver into ${skillsRoot}`);
      }
    }

    const checkOutput = runNode(["scripts/install-local.mjs", "--check"], { env });
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      if (!checkOutput.includes(`Mono workflow local install check passed for ${skillsRoot} (version ${version})`)) {
        fail(`install-local --check must report the per-root version for ${skillsRoot}`);
      }
    }

    // A root recorded in a discovered lockfile is synced even when missing from the known list.
    runNode(["scripts/install-local.mjs", "--skills-root", recordedRoot], { env });
    const claudeLockPath = path.join(claudeRoot, lockName);
    const claudeLock = JSON.parse(fs.readFileSync(claudeLockPath, "utf8"));
    claudeLock.skillsRoot = recordedRoot;
    fs.writeFileSync(claudeLockPath, `${JSON.stringify(claudeLock, null, 2)}\n`);
    const recordedOutput = runNode(["scripts/install-local.mjs"], { env });
    if (!recordedOutput.includes(`Installed ${EXPECTED_SKILLS.length} Mono workflow skills into ${recordedRoot}`)) {
      fail("install-local --all-roots must sync roots recorded in discovered lockfiles");
    }

    // One root left at an older version: the multi-root check must surface it.
    const codexLockPath = path.join(codexRoot, lockName);
    const codexLock = JSON.parse(fs.readFileSync(codexLockPath, "utf8"));
    codexLock.upstreamVersion = "0.0.1";
    fs.writeFileSync(codexLockPath, `${JSON.stringify(codexLock, null, 2)}\n`);
    expectCommandFailure(
      "install-local --check stale per-root version fixture",
      () => runNode(["scripts/install-local.mjs", "--check"], { env }),
      "Lockfile upstreamVersion is 0.0.1"
    );
    runNode(["scripts/install-local.mjs"], { env });

    // One edited root: the multi-root check must fail naming the broken root and still pass the healthy one.
    fs.appendFileSync(path.join(claudeRoot, "mono-review", "SKILL.md"), "\nBROKEN\n");
    for (const expectedText of [
      `Mono workflow local install check failed for ${claudeRoot}`,
      `Mono workflow local install check passed for ${codexRoot}`,
    ]) {
      expectCommandFailure(
        "install-local --check multi-root edited skill fixture",
        () => runNode(["scripts/install-local.mjs", "--check"], { env }),
        expectedText
      );
    }

    runNode(["scripts/install-local.mjs", "--all-roots"], { env });
    runNode(["scripts/install-local.mjs", "--all-roots", "--check"], { env });
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

function validateBreakingInstallBehavior() {
  const installerSource = read("scripts/install-local.mjs");
  const breakingStart = installerSource.indexOf("function breakingSync(");
  const breakingEnd = installerSource.indexOf("\nconst args =", breakingStart);
  const breakingBody = installerSource.slice(breakingStart, breakingEnd);
  if (
    breakingStart < 0 ||
    breakingEnd < 0 ||
    breakingBody.indexOf("acquireGlobalInstallLock") < 0 ||
    breakingBody.indexOf("resolveTargetRoots(args)") < breakingBody.indexOf("acquireGlobalInstallLock")
  ) {
    fail("install-local --breaking must discover target roots only after acquiring the global lock");
  }

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mono-workflow-breaking-install-"));
  const stateRoot = path.join(baseDir, "state");
  const productRoot = path.join(stateRoot, "orchestrator", "fixture-product");
  const codexRoot = path.join(baseDir, "codex", "skills");
  const claudeRoot = path.join(baseDir, "claude", "skills");
  const lockName = ".mono-agent-workflow.lock.json";
  const installLockPath = path.join(stateRoot, "install.lock");
  const env = {
    ...process.env,
    MONO_WORKFLOW_KNOWN_ROOTS: [codexRoot, claudeRoot].join(path.delimiter),
    MONO_WORKFLOW_STATE_ROOT: stateRoot,
  };

  function writeProductState(control, workers) {
    fs.mkdirSync(productRoot, { recursive: true });
    fs.writeFileSync(path.join(productRoot, "control.json"), `${JSON.stringify(control, null, 2)}\n`);
    fs.writeFileSync(path.join(productRoot, "workers.json"), `${JSON.stringify(workers, null, 2)}\n`);
  }

  function writeInstallLock(owner) {
    fs.mkdirSync(installLockPath, { recursive: true });
    fs.writeFileSync(
      path.join(installLockPath, "protocol.json"),
      `${JSON.stringify({ protocol: "token-claims-v1" }, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(installLockPath, `claim-${owner.token}.json`),
      `${JSON.stringify({ ...owner, sequence: 1 }, null, 2)}\n`
    );
  }

  function installLockClaims() {
    if (!fs.existsSync(installLockPath)) return [];
    return fs.readdirSync(installLockPath).filter((name) => /^claim-.+\.json$/.test(name));
  }

  function seedPreviousSkillSurface(skillsRoot, surfaceRevision, retiredSkills) {
    const lockPath = path.join(skillsRoot, lockName);
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.surfaceRevision = surfaceRevision;

    const atomicIssueBody = [
      "<!-- Installed by Mono Agent Workflow @ previous-surface. Do not edit manually. -->",
      "# Mono Issue",
      "",
      "This is the retired internal/advanced atomic helper.",
      "",
    ].join("\n");
    const atomicIssuePath = path.join(skillsRoot, "mono-issue", "SKILL.md");
    fs.writeFileSync(atomicIssuePath, atomicIssueBody);
    const issueEntry = lock.installedSkills.find((entry) => entry.name === "mono-issue");
    issueEntry.sha256 = createHash("sha256").update(atomicIssueBody).digest("hex");

    for (const retired of retiredSkills) {
      const retiredDir = path.join(skillsRoot, retired);
      fs.mkdirSync(retiredDir, { recursive: true });
      const body = "<!-- Installed by Mono Agent Workflow @ previous-surface. Do not edit manually. -->\n";
      fs.writeFileSync(path.join(retiredDir, "SKILL.md"), body);
      lock.installedSkills.push({
        name: retired,
        path: `${retired}/SKILL.md`,
        sha256: createHash("sha256").update(body).digest("hex"),
      });
    }
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  }

  function snapshotTree(treeRoot) {
    const entries = [];
    function walk(current) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const entryPath = path.join(current, entry.name);
        const relativePath = path.relative(treeRoot, entryPath);
        if (entry.isDirectory()) {
          entries.push(`dir:${relativePath}`);
          walk(entryPath);
        } else if (entry.isFile()) {
          entries.push(`file:${relativePath}:${createHash("sha256").update(fs.readFileSync(entryPath)).digest("hex")}`);
        } else {
          entries.push(`other:${relativePath}`);
        }
      }
    }
    walk(treeRoot);
    return entries.join("\n");
  }

  function orchestratorTransactionArtifacts() {
    if (!fs.existsSync(stateRoot)) return [];
    return fs
      .readdirSync(stateRoot)
      .filter(
        (name) =>
          name.startsWith(".orchestrator.install-backup-") ||
          name.startsWith(".orchestrator.install-claim-")
      )
      .sort();
  }

  try {
    expectCommandFailure(
      "install-local --breaking --check conflict",
      () => runNode(["scripts/install-local.mjs", "--breaking", "--check"], { env }),
      "--breaking cannot be combined with --check"
    );

    expectCommandFailure(
      "install-local --breaking unsupported Windows fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], {
        env: { ...env, MONO_WORKFLOW_TEST_FORCE_WINDOWS: "1" },
      }),
      "--breaking is not supported on Windows"
    );
    if (fs.existsSync(installLockPath)) {
      fail("install-local --breaking Windows refusal mutated the global lock state");
    }

    writeProductState({ state: "idle" }, {});
    runNode(["scripts/install-local.mjs", "--skills-root", codexRoot], { env });
    runNode(["scripts/install-local.mjs", "--skills-root", claudeRoot], { env });

    // AC1 fresh 10, 11→10, and direct 14→10: first prove a clean current
    // install, then model both previous surfaces. Both paths also restore the
    // retired atomic mono-issue body so the transaction must perform the
    // semantic swap, not merely delete a directory.
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      const freshLock = JSON.parse(
        fs.readFileSync(path.join(skillsRoot, lockName), "utf8")
      );
      if (freshLock.surfaceRevision !== 3 || freshLock.installedSkills?.length !== 10) {
        fail(`Fresh breaking-install fixture must start with 10 skills at surfaceRevision 3 in ${skillsRoot}`);
      }
    }
    seedPreviousSkillSurface(
      codexRoot,
      1,
      ["mono-issue-intake", "mono-project", "mono-prd", "mono-spec"]
    );
    seedPreviousSkillSurface(claudeRoot, 2, ["mono-issue-intake"]);

    // AC3 + strengthened --check: generated stale directories and surplus
    // installedSkills entries are failures, while a user-owned mono-* lookalike
    // is neither removed nor reported as generated drift.
    const staleDir = path.join(codexRoot, "mono-retired");
    const lookalikeDir = path.join(codexRoot, "mono-user-owned");
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleDir, "SKILL.md"),
      "<!-- Installed by Mono Agent Workflow @ retired. Do not edit manually. -->\n"
    );
    fs.mkdirSync(lookalikeDir, { recursive: true });
    fs.writeFileSync(path.join(lookalikeDir, "SKILL.md"), "# User-owned lookalike\n");
    expectCommandFailure(
      "install-local --check unexpected generated directory fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", codexRoot, "--check"], { env }),
      "Unexpected generated workflow skill directory: mono-retired"
    );
    expectCommandFailure(
      "install-local --breaking unowned generated directory fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      "not owned by the previous lock: mono-retired"
    );
    fs.rmSync(staleDir, { recursive: true, force: true });

    const codexLockPath = path.join(codexRoot, lockName);
    const escapeTarget = path.join(baseDir, "escape-target", "mono-prd");
    fs.mkdirSync(escapeTarget, { recursive: true });
    fs.writeFileSync(
      path.join(escapeTarget, "SKILL.md"),
      "<!-- Installed by Mono Agent Workflow @ external. Do not edit manually. -->\n"
    );
    const pathEscapeLock = JSON.parse(fs.readFileSync(codexLockPath, "utf8"));
    pathEscapeLock.installedSkills.push({
      name: "../../escape-target/mono-prd",
      path: "../../escape-target/mono-prd/SKILL.md",
      sha256: "0".repeat(64),
    });
    fs.writeFileSync(codexLockPath, `${JSON.stringify(pathEscapeLock, null, 2)}\n`);
    expectCommandFailure(
      "install-local --breaking previous-lock path escape fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      "installed skill name must be a safe direct child"
    );
    if (!fs.existsSync(path.join(escapeTarget, "SKILL.md"))) {
      fail("install-local --breaking path escape fixture mutated an external generated directory");
    }
    pathEscapeLock.installedSkills = pathEscapeLock.installedSkills.filter(
      (entry) => entry.name !== "../../escape-target/mono-prd"
    );
    fs.writeFileSync(codexLockPath, `${JSON.stringify(pathEscapeLock, null, 2)}\n`);
    fs.rmSync(path.join(baseDir, "escape-target"), { recursive: true, force: true });

    const surplusLock = JSON.parse(fs.readFileSync(codexLockPath, "utf8"));
    surplusLock.installedSkills.push({
      name: "mono-ghost",
      path: "mono-ghost/SKILL.md",
      sha256: "0".repeat(64),
    });
    fs.writeFileSync(codexLockPath, `${JSON.stringify(surplusLock, null, 2)}\n`);
    expectCommandFailure(
      "install-local --check surplus lock entry fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", codexRoot, "--check"], { env }),
      "Lockfile has unexpected skill entry: mono-ghost"
    );
    surplusLock.installedSkills = surplusLock.installedSkills.filter(
      (entry) => entry.name !== "mono-ghost"
    );
    fs.writeFileSync(codexLockPath, `${JSON.stringify(surplusLock, null, 2)}\n`);

    // AC1 multi-root success: one breaking transaction repairs both roots,
    // removes generated stale state, preserves the non-generated lookalike,
    // and leaves every root post-check clean.
    const successOutput = runNode(["scripts/install-local.mjs", "--breaking"], {
      env: { ...env, MONO_WORKFLOW_TEST_PROBE_QUIESCENCE_CLAIM: "1" },
    });
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      if (!successOutput.includes(`Breaking install committed for ${skillsRoot}`)) {
        fail(`install-local --breaking must report a committed transaction for ${skillsRoot}`);
      }
    }
    if (!successOutput.includes("Quiescence claim probe passed")) {
      fail("install-local --breaking did not prove that control.json writers were excluded during cut-over");
    }
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      const migratedLock = JSON.parse(
        fs.readFileSync(path.join(skillsRoot, lockName), "utf8")
      );
      if (migratedLock.surfaceRevision !== 3 || migratedLock.installedSkills?.length !== 10) {
        fail(`Breaking install did not migrate the previous surface to 10 skills at surfaceRevision 3 in ${skillsRoot}`);
      }
      for (const retired of ["mono-issue-intake", "mono-project", "mono-prd", "mono-spec"]) {
        if (fs.existsSync(path.join(skillsRoot, retired))) {
          fail(`Breaking install kept retired generated adapter ${retired} at ${skillsRoot}`);
        }
      }
      const installedIssue = fs.readFileSync(path.join(skillsRoot, "mono-issue", "SKILL.md"), "utf8");
      if (parseFrontmatter(installedIssue)?.name !== "mono-issue") {
        fail(`Breaking install did not swap mono-issue to the front-door body at ${skillsRoot}`);
      }
      const lockedIssue = migratedLock.installedSkills.find((entry) => entry.name === "mono-issue");
      if (lockedIssue?.sha256 !== createHash("sha256").update(installedIssue).digest("hex")) {
        fail(`Breaking install recorded the wrong mono-issue front-door hash at ${skillsRoot}`);
      }
    }
    if (!fs.existsSync(path.join(lookalikeDir, "SKILL.md"))) {
      fail("install-local --breaking removed a non-generated mono-* lookalike");
    }
    runNode(["scripts/install-local.mjs", "--check"], { env });
    const idempotentOutput = runNode(["scripts/install-local.mjs", "--breaking"], { env });
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      if (!idempotentOutput.includes(`Breaking install committed for ${skillsRoot}`)) {
        fail(`Idempotent 10→10 breaking install did not commit ${skillsRoot}`);
      }
      const idempotentLock = JSON.parse(fs.readFileSync(path.join(skillsRoot, lockName), "utf8"));
      if (idempotentLock.surfaceRevision !== 3 || idempotentLock.installedSkills?.length !== 10) {
        fail(`Idempotent 10→10 breaking install changed the target surface at ${skillsRoot}`);
      }
    }
    runNode(["scripts/install-local.mjs", "--check"], { env });
    if (fs.readFileSync(path.join(productRoot, "control.json"), "utf8") !== '{\n  "state": "idle"\n}\n') {
      fail("install-local --breaking did not restore the claimed control.json byte-for-byte");
    }

    // AC1 rollback: inject a failure after committing the second root. Both
    // roots must return byte-for-byte to their pre-transaction trees.
    fs.appendFileSync(path.join(codexRoot, "mono-review", "SKILL.md"), "\nROOT-ONE-BEFORE-ROLLBACK\n");
    fs.appendFileSync(path.join(claudeRoot, "mono-review", "SKILL.md"), "\nROOT-TWO-BEFORE-ROLLBACK\n");
    const beforeRollback = new Map([
      [codexRoot, snapshotTree(codexRoot)],
      [claudeRoot, snapshotTree(claudeRoot)],
    ]);
    expectCommandFailure(
      "install-local --breaking second-root rollback fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], {
        env: { ...env, MONO_WORKFLOW_TEST_FAIL_AFTER_ROOT: "2" },
      }),
      "Injected breaking install failure after root 2"
    );
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      if (snapshotTree(skillsRoot) !== beforeRollback.get(skillsRoot)) {
        fail(`install-local --breaking did not roll back ${skillsRoot} exactly`);
      }
    }

    // A rollback failure must retain the transaction backup for manual
    // recovery instead of deleting the only remaining copy in finally.
    expectCommandFailure(
      "install-local --breaking rollback backup retention fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], {
        env: {
          ...env,
          MONO_WORKFLOW_TEST_FAIL_AFTER_ROOT: "1",
          MONO_WORKFLOW_TEST_FAIL_ROLLBACK_ROOT: "1",
        },
      }),
      "backup retained at"
    );
    const codexTransactionDirs = fs
      .readdirSync(path.dirname(codexRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".mono-agent-workflow-install-"))
      .map((entry) => path.join(path.dirname(codexRoot), entry.name));
    if (codexTransactionDirs.length !== 1) {
      fail("install-local --breaking rollback failure must retain exactly one transaction directory");
    } else if (!fs.existsSync(path.join(codexTransactionDirs[0], "backup", "mono-review", "SKILL.md"))) {
      fail("install-local --breaking rollback failure did not retain the managed-root backup");
    }
    for (const transactionDir of codexTransactionDirs) {
      fs.rmSync(transactionDir, { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(path.dirname(claudeRoot), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(".mono-agent-workflow-install-")) {
        fs.rmSync(path.join(path.dirname(claudeRoot), entry.name), { recursive: true, force: true });
      }
    }
    if (installLockClaims().length !== 1) {
      fail("install-local --breaking rollback failure must retain the global lock for recovery");
    }
    fs.rmSync(installLockPath, { recursive: true, force: true });

    // A lock whose ownership cannot be proven at release is an installation
    // failure, not success. Already-mutated roots are rolled back and the lock
    // plus backups remain available for recovery.
    const beforeReleaseFailure = new Map([
      [codexRoot, snapshotTree(codexRoot)],
      [claudeRoot, snapshotTree(claudeRoot)],
    ]);
    expectCommandFailure(
      "install-local --breaking lock release failure fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], {
        env: { ...env, MONO_WORKFLOW_TEST_FAIL_INSTALL_LOCK_RELEASE: "1" },
      }),
      "Install lock release failed"
    );
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      if (snapshotTree(skillsRoot) !== beforeReleaseFailure.get(skillsRoot)) {
        fail(`install-local --breaking did not roll back ${skillsRoot} after lock release failure`);
      }
      for (const entry of fs.readdirSync(path.dirname(skillsRoot), { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith(".mono-agent-workflow-install-")) {
          fs.rmSync(path.join(path.dirname(skillsRoot), entry.name), { recursive: true, force: true });
        }
      }
    }
    if (installLockClaims().length !== 1) {
      fail("install-local --breaking release failure did not retain the global lock");
    }
    fs.rmSync(installLockPath, { recursive: true, force: true });

    // The ordinary writer is not transactional, but a failed release is still
    // an explicit non-zero install failure. Handle it without an uncaught
    // exception and retain the claim for safe manual recovery.
    expectCommandFailure(
      "install-local ordinary lock release failure fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", codexRoot], {
        env: { ...env, MONO_WORKFLOW_TEST_FAIL_INSTALL_LOCK_RELEASE: "1" },
      }),
      "Install lock release failed"
    );
    if (installLockClaims().length !== 1) {
      fail("install-local ordinary release failure did not retain the global lock");
    }
    fs.rmSync(installLockPath, { recursive: true, force: true });

    // Replacing the whole stable container after ownership read-back cannot
    // make release delete a newer owner: the old token's unique claim pathname
    // is absent in the replacement container. Ownership is now uncertain, so
    // roots stay in their fully post-checked state and recovery data is retained
    // instead of racing the newer owner with an unsafe rollback.
    expectCommandFailure(
      "install-local --breaking replacement-owner release race fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], {
        env: { ...env, MONO_WORKFLOW_TEST_REPLACE_LOCK_CONTAINER_BEFORE_RELEASE: "1" },
      }),
      "lock ownership is uncertain"
    );
    runNode(["scripts/install-local.mjs", "--check"], { env });
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      let retainedRecovery = false;
      for (const entry of fs.readdirSync(path.dirname(skillsRoot), { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith(".mono-agent-workflow-install-")) {
          retainedRecovery = true;
          fs.rmSync(path.join(path.dirname(skillsRoot), entry.name), { recursive: true, force: true });
        }
      }
      if (!retainedRecovery) {
        fail(`install-local --breaking did not retain recovery data after lock replacement at ${skillsRoot}`);
      }
    }
    if (JSON.stringify(installLockClaims()) !== JSON.stringify(["claim-newer-owner.json"])) {
      fail("install-local --breaking release race removed or changed the newer owner's claim");
    }
    const displacedLocks = fs
      .readdirSync(stateRoot)
      .filter((name) => name.startsWith("install.lock.displaced-"));
    if (displacedLocks.length !== 1) {
      fail("install-local --breaking release race did not retain the displaced owned claim");
    }
    fs.rmSync(installLockPath, { recursive: true, force: true });
    if (displacedLocks.length === 1) {
      fs.rmSync(path.join(stateRoot, displacedLocks[0]), { recursive: true, force: true });
    }

    // A staging failure on root 2 must clean both root 2's locally-created
    // transaction directory and the already-tracked staged root 1 directory.
    expectCommandFailure(
      "install-local --breaking staging cleanup fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], {
        env: { ...env, MONO_WORKFLOW_TEST_FAIL_DURING_STAGE_ROOT: "2" },
      }),
      "Injected breaking install staging failure at root 2"
    );
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      const leaked = fs
        .readdirSync(path.dirname(skillsRoot), { withFileTypes: true })
        .some((entry) => entry.isDirectory() && entry.name.startsWith(".mono-agent-workflow-install-"));
      if (leaked) fail(`install-local --breaking leaked staging data beside ${skillsRoot}`);
    }

    // A root and parent created only by a failed breaking transaction must be
    // removed after rollback so filesystem absence is restored exactly.
    const freshRoot = path.join(baseDir, "fresh-runtime", "skills");
    expectCommandFailure(
      "install-local --breaking fresh-root rollback fixture",
      () => runNode(
        ["scripts/install-local.mjs", "--skills-root", freshRoot, "--breaking"],
        { env: { ...env, MONO_WORKFLOW_TEST_FAIL_AFTER_ROOT: "1" } }
      ),
      "Injected breaking install failure after root 1"
    );
    if (fs.existsSync(freshRoot) || fs.existsSync(path.dirname(freshRoot))) {
      fail("install-local --breaking rollback kept a root or parent created by the failed transaction");
    }

    // AC2 quiescence: both non-idle control states and a nonempty registry
    // block before target-root mutation with the A5 helper's precise reason.
    for (const state of ["active", "draining"]) {
      writeProductState({ state }, {});
      const liveTreeBefore = snapshotTree(path.join(stateRoot, "orchestrator"));
      expectCommandFailure(
        `install-local --breaking ${state} wave fixture`,
        () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
        `control.state=${state} (requires idle)`
      );
      if (snapshotTree(path.join(stateRoot, "orchestrator")) !== liveTreeBefore) {
        fail(`install-local --breaking mutated the live ${state} orchestrator tree before refusal`);
      }
      if (orchestratorTransactionArtifacts().length > 0) {
        fail(`install-local --breaking claimed the live ${state} orchestrator tree before refusal`);
      }
    }
    writeProductState({ state: "idle" }, { "MONO-LIVE": { stage: "mono-implement" } });
    expectCommandFailure(
      "install-local --breaking nonempty registry fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      "workers.json has 1 active worker: MONO-LIVE"
    );

    // An orchestrator still running the pre-coordination surface can activate
    // after the initial scan. The frozen-tree revalidation must catch that
    // race before any skills root changes and restore the now-active state.
    writeProductState({ state: "idle" }, {});
    const beforeRacedQuiescence = new Map([
      [codexRoot, snapshotTree(codexRoot)],
      [claudeRoot, snapshotTree(claudeRoot)],
    ]);
    expectCommandFailure(
      "install-local --breaking scan-to-claim activation fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], {
        env: { ...env, MONO_WORKFLOW_TEST_ACTIVATE_AFTER_QUIESCENCE_SCAN: "1" },
      }),
      "control.state=active (requires idle)"
    );
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      if (snapshotTree(skillsRoot) !== beforeRacedQuiescence.get(skillsRoot)) {
        fail(`install-local --breaking mutated ${skillsRoot} before frozen quiescence revalidation`);
      }
    }
    if (
      JSON.parse(fs.readFileSync(path.join(productRoot, "control.json"), "utf8")).state !==
      "active"
    ) {
      fail("install-local --breaking did not restore the state caught by frozen revalidation");
    }
    if (orchestratorTransactionArtifacts().length > 0) {
      fail("install-local --breaking leaked a claim after frozen quiescence refusal");
    }

    fs.writeFileSync(path.join(productRoot, "control.json"), "{broken\n");
    fs.writeFileSync(path.join(productRoot, "workers.json"), "{}\n");
    expectCommandFailure(
      "install-local --breaking corrupt control fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      "cannot read control.json"
    );

    fs.writeFileSync(path.join(productRoot, "control.json"), '{"state":"idle"}\n');
    fs.writeFileSync(path.join(productRoot, "workers.json"), "[broken\n");
    expectCommandFailure(
      "install-local --breaking corrupt registry fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      "cannot read workers.json"
    );

    // All skills roots are preflighted before any target mutation. A corrupt
    // second lock therefore leaves the first root untouched.
    writeProductState({ state: "idle" }, {});
    runNode(["scripts/install-local.mjs", "--skills-root", codexRoot], { env });
    runNode(["scripts/install-local.mjs", "--skills-root", claudeRoot], { env });
    const firstBeforePreflightFailure = snapshotTree(codexRoot);
    fs.writeFileSync(path.join(claudeRoot, lockName), "{broken\n");
    expectCommandFailure(
      "install-local --breaking all-root preflight fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      "Lockfile is corrupted"
    );
    if (snapshotTree(codexRoot) !== firstBeforePreflightFailure) {
      fail("install-local --breaking mutated the first root before the second root passed preflight");
    }
    runNode(["scripts/install-local.mjs", "--skills-root", claudeRoot], { env });

    // Protocol cut-over: an empty directory or an active legacy owner without
    // protocol.json is never joined as a token-claims container.
    fs.rmSync(installLockPath, { recursive: true, force: true });
    fs.mkdirSync(installLockPath, { recursive: true });
    expectCommandFailure(
      "install-local --breaking incomplete legacy lock fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      "incomplete or legacy lock requires manual inspection and removal"
    );
    fs.writeFileSync(
      path.join(installLockPath, "owner.json"),
      `${JSON.stringify({ pid: process.pid, token: "test-token-placeholder" }, null, 2)}\n`
    );
    expectCommandFailure(
      "install-local --breaking active legacy lock fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      `breaking install lock is held by active process ${process.pid}`
    );
    fs.rmSync(installLockPath, { recursive: true, force: true });

    // AC3 global lock: a lock owned by this live parent process represents a
    // concurrent installer and must be rejected deterministically.
    fs.mkdirSync(stateRoot, { recursive: true });
    writeInstallLock({ pid: process.pid, token: "fixture", startedAt: new Date().toISOString() });
    expectCommandFailure(
      "install-local --breaking concurrent lock fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      `breaking install lock is held by active process ${process.pid}`
    );
    expectCommandFailure(
      "install-local ordinary writer honors global lock fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", codexRoot], { env }),
      `breaking install lock is held by active process ${process.pid}`
    );
    fs.rmSync(installLockPath, { recursive: true, force: true });

    // Stale locks fail closed and remain in place for inspection; automatically
    // unlinking a pathname after a raced read could delete a new live lock.
    writeInstallLock({
      pid: 2147483647,
      token: "test-token-placeholder",
      startedAt: new Date(0).toISOString(),
    });
    expectCommandFailure(
      "install-local --breaking stale lock race fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], { env }),
      "stale breaking install lock requires manual removal"
    );
    if (installLockClaims().length !== 1) {
      fail("install-local --breaking removed a stale lock without an atomic ownership claim");
    }
    fs.rmSync(installLockPath, { recursive: true, force: true });

    // If a legacy/non-cooperating writer recreates the canonical root during
    // the narrow claim handoff, partial-claim metadata must keep both the
    // original tree and global lock available for manual recovery.
    writeProductState({ state: "idle" }, {});
    expectCommandFailure(
      "install-local --breaking partial quiescence claim retention fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], {
        env: { ...env, MONO_WORKFLOW_TEST_FAIL_DURING_QUIESCENCE_CLAIM: "recreate" },
      }),
      "original retained at"
    );
    const partialClaimBackups = orchestratorTransactionArtifacts().filter((name) =>
      name.startsWith(".orchestrator.install-backup-")
    );
    if (partialClaimBackups.length !== 1 || installLockClaims().length !== 1) {
      fail("install-local --breaking partial claim failure did not retain its backup and lock");
    } else {
      fs.rmdirSync(path.join(stateRoot, "orchestrator"));
      fs.renameSync(
        path.join(stateRoot, partialClaimBackups[0]),
        path.join(stateRoot, "orchestrator")
      );
    }
    fs.rmSync(installLockPath, { recursive: true, force: true });

    // If the parent-level quiescence claim cannot be restored, the installer
    // rolls roots back and retains the global lock plus all recovery data.
    const beforeClaimRestoreFailure = new Map([
      [codexRoot, snapshotTree(codexRoot)],
      [claudeRoot, snapshotTree(claudeRoot)],
    ]);
    expectCommandFailure(
      "install-local --breaking quiescence restore retention fixture",
      () => runNode(["scripts/install-local.mjs", "--breaking"], {
        env: { ...env, MONO_WORKFLOW_TEST_FAIL_QUIESCENCE_RESTORE: "1" },
      }),
      "Quiescence restore failed"
    );
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      if (snapshotTree(skillsRoot) !== beforeClaimRestoreFailure.get(skillsRoot)) {
        fail(`install-local --breaking did not roll back ${skillsRoot} after quiescence restore failure`);
      }
      const retainedTransaction = fs
        .readdirSync(path.dirname(skillsRoot), { withFileTypes: true })
        .some((entry) => entry.isDirectory() && entry.name.startsWith(".mono-agent-workflow-install-"));
      if (!retainedTransaction) {
        fail(`install-local --breaking did not retain transaction recovery data beside ${skillsRoot}`);
      }
    }
    if (installLockClaims().length !== 1) {
      fail("install-local --breaking released the global lock after quiescence restore failure");
    }
    const orchestratorBackups = fs
      .readdirSync(stateRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".orchestrator.install-backup-"))
      .map((entry) => path.join(stateRoot, entry.name));
    if (orchestratorBackups.length !== 1) {
      fail("install-local --breaking did not retain exactly one orchestrator backup for recovery");
    } else {
      fs.chmodSync(path.join(stateRoot, "orchestrator"), 0o700);
      fs.rmdirSync(path.join(stateRoot, "orchestrator"));
      fs.renameSync(orchestratorBackups[0], path.join(stateRoot, "orchestrator"));
    }
    for (const skillsRoot of [codexRoot, claudeRoot]) {
      for (const entry of fs.readdirSync(path.dirname(skillsRoot), { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith(".mono-agent-workflow-install-")) {
          fs.rmSync(path.join(path.dirname(skillsRoot), entry.name), { recursive: true, force: true });
        }
      }
    }
    fs.rmSync(installLockPath, { recursive: true, force: true });
  } finally {
    const claimedOrchestratorRoot = path.join(stateRoot, "orchestrator");
    if (fs.existsSync(claimedOrchestratorRoot)) {
      fs.chmodSync(claimedOrchestratorRoot, 0o700);
    }
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

function writeLegacyProjectConfig(repo) {
  fs.mkdirSync(path.join(repo, ".agents"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".agents", "linear-workflow.config.md"),
    `# Linear Workflow Consumer Config

- Consumer: Fixture
- Linear team: Fixture
- Linear-facing Project, PRD, Tech Spec, Issue, and comment language: Russian
- Repo docs and code comments language: English
- Autoreview helper: Required installed \`autoreview\` skill/helper in the agent runtime.
- Artifact roots: docs/discovery, docs/reviews
- Implementation workflow: compound-engineering:ce-work
- Ship workflow: gstack ship
- Documentation workflow: None
- Review feedback workflow: compound-engineering:ce-resolve-pr-feedback
- Deploy workflow: gstack land-and-deploy
`
  );
}

function validateProjectConfigBehavior() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "mono-workflow-project-"));
  try {
    fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Fixture Project\n");
    writeLegacyProjectConfig(repo);
    fs.mkdirSync(path.join(repo, ".agents", "skills", "linear-review"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".agents", "skills", "linear-review", "SKILL.md"), "legacy\n");
    fs.mkdirSync(path.join(repo, ".claude", "skills", "linear-review"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".claude", "skills", "linear-review", "SKILL.md"), "legacy\n");
    fs.writeFileSync(path.join(repo, ".agents", "linear-workflow-check.mjs"), "legacy\n");
    fs.writeFileSync(path.join(repo, ".agents", "linear-workflow.lock.json"), "{}\n");
    fs.mkdirSync(path.join(repo, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".github", "workflows", "update-linear-workflow.yml"), "legacy\n");
    fs.writeFileSync(path.join(repo, ".github", "workflows", "update-linear-agent-workflow.yml"), "legacy\n");

    runNode(["scripts/project-config.mjs", "--repo", repo, "--write", "--clean"]);

    const configPath = path.join(repo, ".agents", "mono-workflow.config.json");
    if (!fs.existsSync(configPath)) fail("project-config must write JSON config");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (config.projectName !== "Fixture") fail("project-config must preserve legacy Consumer as projectName");
    if (config.linearTeam !== "Fixture") fail("project-config must preserve legacy Linear team");
    if (JSON.stringify(config.artifactRoots) !== JSON.stringify(["docs/discovery", "docs/reviews"])) {
      fail("project-config must migrate legacy Artifact roots");
    }
    if (config.workflows.ship !== "gstack ship") fail("project-config must migrate Ship workflow");
    if (config.workflows.deploy !== "gstack land-and-deploy") fail("project-config must migrate Deploy workflow");
    if (!("deployApproval" in config)) fail("project-config must write deployApproval field");

    config.deployApproval = "risky-only";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]);

    config.deployApproval = "monthly";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    expectCommandFailure(
      "project-config --check invalid deployApproval fixture",
      () => runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]),
      "deployApproval"
    );
    config.deployApproval = "always";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    config.issueOnlyLane = { enabled: true, ownerPrincipal: "user_abc123" };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]);

    config.issueOnlyLane = { enabled: true };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    expectCommandFailure(
      "project-config --check issue-only lane without ownerPrincipal fixture",
      () => runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]),
      "ownerPrincipal"
    );
    delete config.issueOnlyLane;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    config.workflows.qa = "gstack qa-only";
    config.qaAuth = "cookie-import";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]);

    config.qaAuth = "shared-password";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    expectCommandFailure(
      "project-config --check invalid qaAuth fixture",
      () => runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]),
      "qaAuth"
    );

    config.qaAuth = "owner-session";
    config.orchestration = { ...(config.orchestration || {}), workerAudience: "gpt-5" };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    expectCommandFailure(
      "project-config --check invalid orchestration.workerAudience fixture",
      () => runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]),
      "workerAudience"
    );

    config.orchestration.workerAudience = "claude-5";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]);
    delete config.orchestration.workerAudience;

    config.workflows.qa = 42;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    expectCommandFailure(
      "project-config --check invalid workflows.qa fixture",
      () => runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]),
      "workflows.qa"
    );

    delete config.workflows.qa;
    delete config.qaAuth;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]);

    for (const removed of [
      ".agents/linear-workflow.config.md",
      ".agents/linear-workflow-check.mjs",
      ".agents/linear-workflow.lock.json",
      ".agents/skills/linear-review",
      ".claude/skills/linear-review",
      ".github/workflows/update-linear-workflow.yml",
      ".github/workflows/update-linear-agent-workflow.yml",
    ]) {
      if (fs.existsSync(path.join(repo, removed))) fail(`project-config --clean did not remove ${removed}`);
    }

    runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]);

    fs.mkdirSync(path.join(repo, ".agents", "skills", "mono-idea"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".agents", "skills", "mono-idea", "SKILL.md"), "legacy\n");
    expectCommandFailure(
      "project-config --check vendored skill fixture",
      () => runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]),
      "Legacy Mono workflow project install file must be removed"
    );
    runNode(["scripts/project-config.mjs", "--repo", repo, "--clean", "--check"]);

    const jsonMigrationRepo = path.join(repo, "previous-json-project");
    fs.mkdirSync(path.join(jsonMigrationRepo, ".agents"), { recursive: true });
    const previousJsonConfig = {
      schemaVersion: 1,
      projectName: "Previous JSON Fixture",
      linearTeam: "Mono",
      languages: { linear: "Russian", repo: "English" },
      artifactRoots: ["plans"],
      workflows: {
        implementation: null,
        ship: "gstack ship",
        documentation: null,
        reviewFeedback: null,
        deploy: "gstack land-and-deploy",
      },
      prerequisites: { autoreviewHelper: true },
      deployApproval: "risky-only",
    };
    fs.writeFileSync(
      path.join(jsonMigrationRepo, ".agents", "linear-workflow.config.json"),
      `${JSON.stringify(previousJsonConfig, null, 2)}\n`
    );
    expectCommandFailure(
      "project-config standalone clean preserves previous-brand JSON fixture",
      () => runNode(["scripts/project-config.mjs", "--repo", jsonMigrationRepo, "--clean", "--check"]),
      "Refusing to clean the only project config"
    );
    if (!fs.existsSync(path.join(jsonMigrationRepo, ".agents", "linear-workflow.config.json"))) {
      fail("project-config standalone clean must preserve the only previous-brand JSON config");
    }
    runNode(["scripts/project-config.mjs", "--repo", jsonMigrationRepo, "--write", "--clean", "--check"]);
    const migratedJsonConfig = JSON.parse(
      fs.readFileSync(path.join(jsonMigrationRepo, ".agents", "mono-workflow.config.json"), "utf8")
    );
    if (migratedJsonConfig.projectName !== previousJsonConfig.projectName) {
      fail("project-config must preserve previous-brand JSON config during migration");
    }
    if (fs.existsSync(path.join(jsonMigrationRepo, ".agents", "linear-workflow.config.json"))) {
      fail("project-config --clean must remove the previous-brand JSON config after migration");
    }

    config.projectName = "<set project>";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    expectCommandFailure(
      "project-config --check placeholder fixture",
      () => runNode(["scripts/project-config.mjs", "--repo", repo, "--check"]),
      "unresolved"
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function validateIssueOnlyLaneBehavior() {
  const activeProjectConfig = JSON.parse(read(".agents/mono-workflow.config.json"));
  const activeProjectConfigError = issueOnlyLaneActivationError(activeProjectConfig);
  if (activeProjectConfigError) {
    fail(`Upstream project config is invalid: ${activeProjectConfigError}`);
  }

  // MONO-25 negative fixture: activation without an owner principal is invalid,
  // even though a disabled or absent lane remains a valid project-first config.
  const missingOwnerConfig = structuredClone(activeProjectConfig);
  missingOwnerConfig.issueOnlyLane = { enabled: true };
  const missingOwnerConfigError = issueOnlyLaneActivationError(missingOwnerConfig);
  if (!missingOwnerConfigError?.includes("ownerPrincipal")) {
    fail("enabled issueOnlyLane without a non-empty ownerPrincipal fixture must fail validation");
  }
  for (const [label, issueOnlyLane] of [
    ["non-object", "invalid"],
    ["non-boolean enabled", { enabled: "true" }],
  ]) {
    const malformedConfig = structuredClone(activeProjectConfig);
    malformedConfig.issueOnlyLane = issueOnlyLane;
    if (!issueOnlyLaneActivationError(malformedConfig)) {
      fail(`${label} issueOnlyLane fixture must fail activation validation`);
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mono-workflow-issue-only-"));
  try {
    // MONO-19: the issue-only lane is a config opt-in. issue-only is granted only
    // when --config enables the lane AND names an owner principal. Every fixture
    // that expects issue-only — and every project-first fixture whose intent is a
    // downstream soft gate (eligibility envelope, verified label, fresh approval)
    // — passes this enabling config, so the ONLY reason it fails closed is the
    // specific gate under test. The dedicated opt-in fixtures below omit or weaken
    // it on purpose.
    const enableConfigPath = path.join(dir, "config-enabled.json");
    fs.writeFileSync(
      enableConfigPath,
      `${JSON.stringify({ schemaVersion: 1, issueOnlyLane: { enabled: true, ownerPrincipal: "user_owner_1" } }, null, 2)}\n`
    );

    const issuePath = path.join(dir, "issue.md");
    const markerPath = path.join(dir, "marker.md");
    fs.writeFileSync(
      issuePath,
      [
        "# Fixture Issue",
        "",
        "## Что сделать",
        "",
        "- SCOPE_SENTINEL build the resolver seam",
        "",
        "## Acceptance",
        "",
        "- AC1: resolver prints five fields",
        "- AC2: missing marker yields project-first",
        "",
        "## How to verify",
        "",
        "1. run resolver on a valid marker",
        "2. run resolver with no marker",
        "",
        "## Что не входит",
        "",
        "- NONGOALS_SENTINEL skill wiring",
        "",
        "## Ревью-гейт",
        "",
        "- REVIEWGATE_SENTINEL standard, pre-ship review",
        "",
      ].join("\n")
    );

    const writeMarker = (fields) =>
      fs.writeFileSync(markerPath, `${["mono-issue-only marker", ...fields].join("\n")}\n`);

    // Fixture 1 — legacy-unchanged: a project-first issue (no marker) resolves
    // to project-first. The lane never activates without a marker.
    const legacy = JSON.parse(runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath]));
    if (legacy.package_kind !== "project-first") fail("resolve-issue-context legacy issue must be project-first");
    if (legacy.lifecycle_state_entity !== "project") fail("resolve-issue-context project-first must read the Project lifecycle entity");
    if (legacy.behavioral_oracle !== null) fail("resolve-issue-context project-first must have no behavioral oracle");
    if (legacy.risk_class !== null) fail("resolve-issue-context project-first must not synthesize a risk class");
    if (legacy.approval_status !== "absent") fail("resolve-issue-context project-first approval must be absent");

    // Compute the correct fingerprint via the resolver's own helper so the
    // happy fixture never duplicates the hash.
    const fingerprint = runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--emit-fingerprint"]).trim();

    // The two trusted, caller-verified signals every issue-only resolution needs
    // on top of a valid marker: the verified issue-only label and the owner-
    // approval fingerprint the caller confirmed against the authenticated comment.
    const issueOnlyArgs = ["--label", "issue-only", "--approval-verified", fingerprint];

    // Fixture 2 — happy: a valid marker plus both trusted signals and the real
    // enabled upstream project config resolves the five fields correctly. This
    // live-config coupling is intentional: AC1/AC4 guard the upstream opt-in.
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      `Approval: ${fingerprint} (approved by owner)`,
    ]);
    const happy = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", ".agents/mono-workflow.config.json", ...issueOnlyArgs])
    );
    if (happy.package_kind !== "issue-only") fail("resolve-issue-context valid marker must be issue-only");
    if (happy.lifecycle_state_entity !== "issue") fail("resolve-issue-context issue-only must read the Issue lifecycle entity");
    if (!happy.behavioral_oracle || happy.behavioral_oracle.kind !== "issue-verification") {
      fail("resolve-issue-context issue-only oracle kind must be issue-verification");
    }
    if (JSON.stringify(happy.behavioral_oracle?.acceptance_ids) !== JSON.stringify(["AC1", "AC2"])) {
      fail("resolve-issue-context issue-only oracle must carry the Issue acceptance IDs");
    }
    if (!Array.isArray(happy.behavioral_oracle?.verify_steps) || happy.behavioral_oracle.verify_steps.length !== 2) {
      fail("resolve-issue-context issue-only oracle must carry the Issue verify steps");
    }
    if (happy.risk_class !== "standard") fail("resolve-issue-context issue-only must read the recorded risk class");
    if (happy.approval_status !== "approved-fresh") {
      fail("resolve-issue-context issue-only approval must be approved-fresh when the fingerprint matches");
    }

    // Fixture 7 — resume-discovery. Linear narrows the scan to open,
    // parentless Issues carrying the verified issue-only label; the resuming
    // orchestrator then re-runs the seam and trusts only approved-fresh results.
    const isResumeDiscoveryCandidate = ({ parentProject, statusType, labels, seam, reconstructionVerified }) =>
      parentProject === null &&
      !["completed", "canceled"].includes(statusType) &&
      labels.includes("issue-only") &&
      reconstructionVerified === true &&
      seam.package_kind === "issue-only" &&
      seam.lifecycle_state_entity === "issue" &&
      seam.approval_status === "approved-fresh";
    const resumeCandidate = {
      parentProject: null,
      statusType: "started",
      labels: ["issue-only"],
      seam: happy,
      reconstructionVerified: true,
    };
    if (!isResumeDiscoveryCandidate(resumeCandidate)) {
      fail("resume-discovery fixture must recover an open parentless issue-only Issue");
    }
    const resumeWithoutLabelSeam = JSON.parse(
      runNode([
        "scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath,
        "--config", enableConfigPath, "--approval-verified", fingerprint,
      ])
    );
    if (isResumeDiscoveryCandidate({ ...resumeCandidate, labels: [], seam: resumeWithoutLabelSeam })) {
      fail("resume-discovery fixture must not recover a candidate without the issue-only label");
    }
    const resumeWithoutMarkerSeam = JSON.parse(
      runNode([
        "scripts/resolve-issue-context.mjs", "--issue", issuePath,
        "--config", enableConfigPath, ...issueOnlyArgs,
      ])
    );
    if (isResumeDiscoveryCandidate({ ...resumeCandidate, seam: resumeWithoutMarkerSeam })) {
      fail("resume-discovery fixture must not recover a candidate without the marker");
    }
    if (isResumeDiscoveryCandidate({ ...resumeCandidate, reconstructionVerified: false })) {
      fail("resume-discovery fixture must fail closed when reconstruction evidence is unverified");
    }

    // Fixture 5 runtime proof: the `happy` assertions above prove the valid
    // marker + trusted approval route is issue-only/approved-fresh. This second
    // invocation proves the same parentless candidate with no marker fails
    // closed to project-first, completing the two ship routes without rechecking
    // the already-proven happy object.
    const parentlessShipAbsent = JSON.parse(
      runNode([
        "scripts/resolve-issue-context.mjs", "--issue", issuePath,
        "--config", enableConfigPath, ...issueOnlyArgs,
      ])
    );
    if (
      parentlessShipAbsent.package_kind !== "project-first" ||
      parentlessShipAbsent.approval_status !== "absent"
    ) {
      fail("parentless-ship absent marker fixture must route back through project-first fallback");
    }

    // Fixture 6 runtime proof: deploy's live checklist is exactly the Issue
    // oracle AC-ID sequence. Editing an oracle criterion after approval makes
    // the marker stale and is a failure, not an excusable not-run sweep.
    const liveOracleChecklist = happy.behavioral_oracle?.acceptance_ids;
    if (JSON.stringify(liveOracleChecklist) !== JSON.stringify(["AC1", "AC2"])) {
      fail("live-oracle fixture checklist must equal the Issue behavioral_oracle AC-ID sequence");
    }
    const oracleDriftPath = path.join(dir, "issue-live-oracle-drift.md");
    fs.writeFileSync(
      oracleDriftPath,
      fs.readFileSync(issuePath, "utf8").replace(
        "AC2: missing marker yields project-first",
        "AC2: drifted live behavior",
      ),
    );
    expectCommandFailure(
      "resolve-issue-context live-oracle drift fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", oracleDriftPath,
          "--marker", markerPath, "--config", enableConfigPath, ...issueOnlyArgs,
        ]),
      "issue-only-lane: stale marker",
    );

    // Brand migration compatibility: previously approved durable Linear
    // comments keep resolving. New writes use mono; reads accept the old marker.
    fs.writeFileSync(
      markerPath,
      `${[
        "linear-issue-only marker",
        "Marker version: 1",
        `Scope fingerprint: ${fingerprint}`,
        "Acceptance IDs: AC1, AC2",
        "Risk class: standard",
        `Approval: ${fingerprint}`,
      ].join("\n")}\n`
    );
    const previousBrandMarker = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", enableConfigPath, ...issueOnlyArgs])
    );
    if (previousBrandMarker.package_kind !== "issue-only") {
      fail("resolve-issue-context must preserve previous-brand durable marker approvals");
    }

    // Guard (must-fix #3): the fingerprint binds the FULL Issue contract, not
    // just acceptance + verify. Mutating the scope or the non-goals section must
    // change the fingerprint, so an approval can never survive a contract change.
    const emitFingerprint = (issueFile) =>
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issueFile, "--emit-fingerprint"]).trim();
    const fullBody = fs.readFileSync(issuePath, "utf8");
    for (const [sentinel, label] of [
      ["SCOPE_SENTINEL", "scope/what-to-do"],
      ["NONGOALS_SENTINEL", "non-goals"],
      ["REVIEWGATE_SENTINEL", "review-gate risk"],
    ]) {
      const mutatedPath = path.join(dir, `issue-mutated-${sentinel}.md`);
      fs.writeFileSync(mutatedPath, fullBody.replace(sentinel, `${sentinel}_MUTATED`));
      if (emitFingerprint(mutatedPath) === fingerprint) {
        fail(`resolve-issue-context fingerprint must cover the ${label} section`);
      }
    }

    // Guard: issue-only requires BOTH the verified label AND a fresh caller-
    // verified approval. Drop either and a fully valid marker fails closed to
    // project-first — marker text alone never activates the lane.
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      `Approval: ${fingerprint}`,
    ]);
    const noLabel = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", enableConfigPath, "--approval-verified", fingerprint])
    );
    if (noLabel.package_kind !== "project-first") {
      fail("resolve-issue-context must fail closed to project-first without the verified issue-only label");
    }
    // A full label name is matched — "not issue-only" (one label with a space) is
    // not the "issue-only" opt-in and must not activate the lane.
    const wrongLabel = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", enableConfigPath, "--label", "not issue-only", "--approval-verified", fingerprint])
    );
    if (wrongLabel.package_kind !== "project-first") {
      fail("resolve-issue-context must match the full label name, not a bare word inside a longer label");
    }
    const noApproval = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", enableConfigPath, "--label", "issue-only"])
    );
    if (noApproval.package_kind !== "project-first") {
      fail("resolve-issue-context must fail closed to project-first without a caller-verified approval");
    }
    const wrongApproval = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", "0000deadbeef"])
    );
    if (wrongApproval.package_kind !== "project-first") {
      fail("resolve-issue-context must fail closed to project-first when the caller-verified approval does not match the scope fingerprint");
    }

    // Fixture 3 — missing-marker: a marker source without the marker line is
    // fail-closed to project-first (never silently issue-only).
    const emptyMarkerPath = path.join(dir, "empty.md");
    fs.writeFileSync(emptyMarkerPath, "no marker here\n");
    const missing = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", emptyMarkerPath])
    );
    if (missing.package_kind !== "project-first") fail("resolve-issue-context missing marker must fail closed to project-first");

    // Fixture 4 — risk/scope escalation -> project-first. Start with the valid
    // standard package above, then model the two deterministic exit causes. A
    // risk reclassification to risky remains structurally valid but leaves the
    // Phase-1 envelope; a superseded approval parks pre-code scope growth. Both
    // must resolve through the same five-field seam as project-first.
    const projectFirstSeam = {
      package_kind: "project-first",
      lifecycle_state_entity: "project",
      behavioral_oracle: null,
      risk_class: null,
      approval_status: "absent",
    };
    const riskEscalatedIssuePath = path.join(dir, "issue-risk-escalated.md");
    const riskEscalatedMarkerPath = path.join(dir, "marker-risk-escalated.md");
    const riskEscalatedBody = fullBody.replace(
      "REVIEWGATE_SENTINEL standard, pre-ship review",
      "REVIEWGATE_SENTINEL risky, pre-ship review (diff reclassified)"
    );
    fs.writeFileSync(riskEscalatedIssuePath, riskEscalatedBody);
    const riskEscalatedFingerprint = emitFingerprint(riskEscalatedIssuePath);
    fs.writeFileSync(
      riskEscalatedMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${riskEscalatedFingerprint}`, "Acceptance IDs: AC1, AC2", "Risk class: risky", `Approval: ${riskEscalatedFingerprint}`].join("\n")}\n`
    );
    const riskEscalated = JSON.parse(
      runNode([
        "scripts/resolve-issue-context.mjs", "--issue", riskEscalatedIssuePath,
        "--marker", riskEscalatedMarkerPath, "--config", enableConfigPath,
        "--label", "issue-only", "--approval-verified", riskEscalatedFingerprint,
      ])
    );
    if (JSON.stringify(riskEscalated) !== JSON.stringify(projectFirstSeam)) {
      fail("resolve-issue-context risky-diff escalation must fall back to the exact project-first seam contract");
    }

    fs.writeFileSync(
      markerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${fingerprint}`, "Acceptance IDs: AC1, AC2", "Risk class: standard", "Approval: superseded"].join("\n")}\n`
    );
    const scopeEscalated = JSON.parse(
      runNode([
        "scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath,
        "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", fingerprint,
      ])
    );
    if (JSON.stringify(scopeEscalated) !== JSON.stringify(projectFirstSeam)) {
      fail("resolve-issue-context pre-code scope escalation with superseded approval must fall back to the exact project-first seam contract");
    }

    // Negative halves of the fixture pin stable integrity failures: pretending
    // the risky body is still standard is a broken marker, while carrying the
    // old standard fingerprint into the risky body is stale.
    fs.writeFileSync(
      riskEscalatedMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${riskEscalatedFingerprint}`, "Acceptance IDs: AC1, AC2", "Risk class: standard", `Approval: ${riskEscalatedFingerprint}`].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context risk-escalation downgrade fixture",
      () => runNode([
        "scripts/resolve-issue-context.mjs", "--issue", riskEscalatedIssuePath,
        "--marker", riskEscalatedMarkerPath, "--config", enableConfigPath,
        "--label", "issue-only", "--approval-verified", riskEscalatedFingerprint,
      ]),
      "issue-only-lane: broken marker: marker Risk class"
    );
    fs.writeFileSync(
      riskEscalatedMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${fingerprint}`, "Acceptance IDs: AC1, AC2", "Risk class: risky", `Approval: ${fingerprint}`].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context risk-escalation stale-scope fixture",
      () => runNode([
        "scripts/resolve-issue-context.mjs", "--issue", riskEscalatedIssuePath,
        "--marker", riskEscalatedMarkerPath, "--config", enableConfigPath,
        "--label", "issue-only", "--approval-verified", fingerprint,
      ]),
      "issue-only-lane: stale marker"
    );

    // Guard: a prose MENTION of the marker line (not standalone) is not a marker —
    // an Issue documenting the convention still resolves to project-first, never a
    // spurious broken-marker hard failure (this repo's own Issues do this).
    const proseIssuePath = path.join(dir, "issue-prose-mention.md");
    fs.writeFileSync(
      proseIssuePath,
      [
        "# Prose mention",
        "",
        "## Что сделать",
        "",
        "Document the `mono-issue-only marker` convention; Marker version: 1 is inline prose.",
        "",
        "## Критерии приёмки",
        "",
        "- AC1: x",
        "",
        "## Как проверить",
        "",
        "1. step",
        "",
        "## Ревью-гейт",
        "",
        "- standard",
        "",
      ].join("\n")
    );
    const prose = JSON.parse(runNode(["scripts/resolve-issue-context.mjs", "--issue", proseIssuePath]));
    if (prose.package_kind !== "project-first") {
      fail("resolve-issue-context must treat a prose mention of the marker line as project-first, not a marker");
    }

    // Guard: a fenced code block inside a section does not truncate it — a
    // `# comment` inside a ``` fence must not drop the rest of the scope out of
    // the fingerprint, or scope drift after the fence would go undetected.
    const fencedBase = [
      "# Fenced",
      "",
      "## Что сделать",
      "",
      "```sh",
      "# setup step (a comment, not a heading)",
      "run build",
      "```",
      "",
      "FENCED_TAIL after the fence is still scope.",
      "",
      "## Критерии приёмки",
      "",
      "- AC1: x",
      "",
      "## Как проверить",
      "",
      "1. step",
      "",
      "## Ревью-гейт",
      "",
      "- standard",
      "",
    ].join("\n");
    const fencedPath = path.join(dir, "issue-fenced.md");
    fs.writeFileSync(fencedPath, fencedBase);
    const fencedFp = emitFingerprint(fencedPath);
    const fencedMutPath = path.join(dir, "issue-fenced-mut.md");
    fs.writeFileSync(fencedMutPath, fencedBase.replace("FENCED_TAIL", "FENCED_TAIL_MUTATED"));
    if (emitFingerprint(fencedMutPath) === fencedFp) {
      fail("resolve-issue-context fingerprint must include scope after a fenced code block (a fence must not truncate the section)");
    }

    // Guard: semantic indentation is part of the fingerprint — re-indenting a
    // fenced code block in the scope changes the hash, so no meaning-changing
    // whitespace edit can slip past an existing approval.
    const indentA = ["# Ind", "", "## Что сделать", "", "```python", "def f():", "    return 1", "```", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const indentAPath = path.join(dir, "issue-indent-a.md");
    const indentBPath = path.join(dir, "issue-indent-b.md");
    fs.writeFileSync(indentAPath, indentA);
    fs.writeFileSync(indentBPath, indentA.replace("    return 1", "        return 1"));
    if (emitFingerprint(indentAPath) === emitFingerprint(indentBPath)) {
      fail("resolve-issue-context fingerprint must be sensitive to semantic indentation in the scope");
    }

    // Guard: the full 64-hex sha256 is emitted, never a truncated hash (a short
    // hash is a collision target for the approval binding).
    if (!/^[0-9a-f]{64}$/.test(emitFingerprint(indentAPath))) {
      fail("resolve-issue-context must emit the full 64-hex sha256 fingerprint");
    }

    // Guard: a nested subsection under a normative heading still participates in
    // the fingerprint — content under `### Edge cases` inside `## Что сделать` is
    // hashed, so edits there invalidate an approval.
    const nestedBase = (tail) =>
      ["# N", "", "## Что сделать", "", "intro line", "", "### Edge cases", "", tail, "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const nestedAPath = path.join(dir, "issue-nested-a.md");
    const nestedBPath = path.join(dir, "issue-nested-b.md");
    fs.writeFileSync(nestedAPath, nestedBase("handle empty input"));
    fs.writeFileSync(nestedBPath, nestedBase("handle HUGE input differently"));
    if (emitFingerprint(nestedAPath) === emitFingerprint(nestedBPath)) {
      fail("resolve-issue-context fingerprint must include content under nested subsections");
    }

    // Guard: section boundaries are canonically encoded — moving a "---"-delimited
    // fragment from one section into an adjacent one changes the fingerprint (a
    // raw delimiter join would let it collide).
    const boundary = (scope, desired) =>
      ["# B", "", "## Что сделать", "", scope, "", "## Желаемое поведение", "", desired, "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const boundaryAPath = path.join(dir, "issue-boundary-a.md");
    const boundaryBPath = path.join(dir, "issue-boundary-b.md");
    fs.writeFileSync(boundaryAPath, boundary("keep", "moved"));
    fs.writeFileSync(boundaryBPath, boundary("keep\n\n---\n\nmoved", ""));
    if (emitFingerprint(boundaryAPath) === emitFingerprint(boundaryBPath)) {
      fail("resolve-issue-context fingerprint must unambiguously encode section boundaries");
    }

    // Guard: a fenced EXAMPLE of the marker format is not an opt-in — an Issue
    // documenting the format in a code fence still resolves to project-first.
    const fencedMarkerPath = path.join(dir, "issue-fenced-marker.md");
    fs.writeFileSync(
      fencedMarkerPath,
      ["# Doc", "", "## Что сделать", "", "Example marker format:", "", "```text", "mono-issue-only marker", "Marker version: 1", "Scope fingerprint: abc", "Acceptance IDs: AC1", "Risk class: standard", "Approval: none", "```", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const fencedMarker = JSON.parse(runNode(["scripts/resolve-issue-context.mjs", "--issue", fencedMarkerPath]));
    if (fencedMarker.package_kind !== "project-first") {
      fail("resolve-issue-context must treat a fenced marker example as project-first, not an opt-in");
    }

    // Guard: fence type/length is tracked — a ~~~ line inside a ```text block does
    // not close it, so a `# heading` inside the block cannot truncate the section.
    const fenceTypeBase = (tail) =>
      ["# FT", "", "## Что сделать", "", "```text", "~~~", "# not a real heading", tail, "```", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const fenceTypeAPath = path.join(dir, "issue-fencetype-a.md");
    const fenceTypeBPath = path.join(dir, "issue-fencetype-b.md");
    fs.writeFileSync(fenceTypeAPath, fenceTypeBase("payload one"));
    fs.writeFileSync(fenceTypeBPath, fenceTypeBase("payload two"));
    if (emitFingerprint(fenceTypeAPath) === emitFingerprint(fenceTypeBPath)) {
      fail("resolve-issue-context fence tracking must honor fence type so nested content stays in the section");
    }

    // Guard: a duplicate normative section is not ignored — content in a SECOND
    // `## Что сделать` is hashed too, so it cannot change post-approval unnoticed.
    const dupBase = (second) =>
      ["# Dup", "", "## Что сделать", "", "first scope", "", "## Что сделать", "", second, "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const dupAPath = path.join(dir, "issue-dup-a.md");
    const dupBPath = path.join(dir, "issue-dup-b.md");
    fs.writeFileSync(dupAPath, dupBase("second scope A"));
    fs.writeFileSync(dupBPath, dupBase("second scope B"));
    if (emitFingerprint(dupAPath) === emitFingerprint(dupBPath)) {
      fail("resolve-issue-context fingerprint must include duplicate normative sections");
    }

    // Guard: an issue-only package must be a self-contained Issue — missing
    // scope/behavior or non-goals is rejected even with valid acceptance + verify.
    const incompletePath = path.join(dir, "issue-incomplete.md");
    fs.writeFileSync(
      incompletePath,
      ["# Incomplete", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const incompleteFp = emitFingerprint(incompletePath);
    const incompleteMarkerPath = path.join(dir, "marker-incomplete.md");
    fs.writeFileSync(
      incompleteMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${incompleteFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${incompleteFp}`].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context incomplete contract fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", incompletePath, "--marker", incompleteMarkerPath,
          "--label", "issue-only", "--approval-verified", incompleteFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: an INLINE marker (marker source defaults to the issue body) is
    // stripped before hashing, so its own fingerprint field does not change the
    // hash — the package resolves issue-only, never self-referentially stale.
    const inlineBody = ["# Inline", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: x", "- AC2: y", "", "## Как проверить", "", "1. s", "2. t", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const inlinePath = path.join(dir, "issue-inline.md");
    fs.writeFileSync(inlinePath, inlineBody);
    const inlineFp = emitFingerprint(inlinePath);
    fs.writeFileSync(
      inlinePath,
      `${inlineBody}\nmono-issue-only marker\nMarker version: 1\nScope fingerprint: ${inlineFp}\nAcceptance IDs: AC1, AC2\nRisk class: standard\nApproval: ${inlineFp}\n`
    );
    const inlineResolved = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", inlinePath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", inlineFp])
    );
    if (inlineResolved.package_kind !== "issue-only") {
      fail("resolve-issue-context inline marker must be stripped before hashing so it resolves issue-only, not stale");
    }

    // Guard: most-recent-wins recovery for INLINE markers — a renewed (second)
    // inline marker is authoritative, and BOTH the superseded and the fresh blocks
    // are stripped before hashing, so an old block (stale fingerprint, higher risk)
    // never binds into the fingerprint or contaminates the review-gate class.
    const renewBody = ["# Renew", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: x", "- AC2: y", "", "## Как проверить", "", "1. s", "2. t", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const renewPath = path.join(dir, "issue-renew.md");
    fs.writeFileSync(renewPath, renewBody);
    const renewFp = emitFingerprint(renewPath);
    fs.writeFileSync(
      renewPath,
      `${renewBody}\nmono-issue-only marker\nMarker version: 1\nScope fingerprint: deadbeefdead\nAcceptance IDs: AC1, AC2\nRisk class: deep\nApproval: deadbeefdead\n\nmono-issue-only marker\nMarker version: 1\nScope fingerprint: ${renewFp}\nAcceptance IDs: AC1, AC2\nRisk class: standard\nApproval: ${renewFp}\n`
    );
    const renewResolved = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", renewPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", renewFp])
    );
    if (renewResolved.package_kind !== "issue-only") {
      fail("resolve-issue-context must strip ALL inline markers (superseded + fresh) and honor the newest, so a renewed inline marker resolves issue-only");
    }

    // Guard: negative headings are not miscounted as behavior — an English Issue
    // with only Non-goals (plus acceptance + verify) has no described behavior and
    // is rejected, not admitted as a self-contained package.
    const negHeadingPath = path.join(dir, "issue-neg-heading.md");
    fs.writeFileSync(
      negHeadingPath,
      ["# Neg", "", "## Acceptance", "", "- AC1: x", "", "## How to verify", "", "1. s", "", "## Non-goals", "", "- out of scope thing", "", "## Review gate", "", "- standard", ""].join("\n")
    );
    const negFp = emitFingerprint(negHeadingPath);
    const negMarkerPath = path.join(dir, "marker-neg.md");
    fs.writeFileSync(
      negMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${negFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${negFp}`].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context negative-heading behavior fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", negHeadingPath, "--marker", negMarkerPath,
          "--label", "issue-only", "--approval-verified", negFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: a verification given as a bare command block (no list) is a valid
    // step, not "no steps" — the package resolves issue-only and the command is
    // preserved in the oracle's verify_steps.
    const cmdVerifyBody = ["# Cmd", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "```sh", "npm test", "```", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const cmdVerifyPath = path.join(dir, "issue-cmd-verify.md");
    fs.writeFileSync(cmdVerifyPath, cmdVerifyBody);
    const cmdVerifyFp = emitFingerprint(cmdVerifyPath);
    const cmdVerifyMarkerPath = path.join(dir, "marker-cmd-verify.md");
    fs.writeFileSync(
      cmdVerifyMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${cmdVerifyFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${cmdVerifyFp}`].join("\n")}\n`
    );
    const cmdVerify = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", cmdVerifyPath, "--marker", cmdVerifyMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", cmdVerifyFp])
    );
    if (cmdVerify.package_kind !== "issue-only") {
      fail("resolve-issue-context must accept a bare command-block verification as a valid step");
    }
    if (!cmdVerify.behavioral_oracle.verify_steps.some((step) => step.includes("npm test"))) {
      fail("resolve-issue-context must preserve command-block content in verify_steps");
    }

    // Guard: an over-broad positive-scope heading is not counted as behavior — an
    // Issue whose only scope-ish heading is "Scope exclusions" (a negative) has no
    // described behavior and is rejected as not self-contained.
    const scopeExclPath = path.join(dir, "issue-scope-excl.md");
    fs.writeFileSync(
      scopeExclPath,
      ["# SE", "", "## Scope exclusions", "", "- not this", "", "## Acceptance", "", "- AC1: x", "", "## How to verify", "", "1. s", "", "## Out of scope", "", "- nor that", "", "## Review gate", "", "- standard", ""].join("\n")
    );
    const scopeExclFp = emitFingerprint(scopeExclPath);
    const scopeExclMarkerPath = path.join(dir, "marker-scope-excl.md");
    fs.writeFileSync(
      scopeExclMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${scopeExclFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${scopeExclFp}`].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context scope-exclusions heading fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", scopeExclPath, "--marker", scopeExclMarkerPath,
          "--label", "issue-only", "--approval-verified", scopeExclFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: verify_steps splits only on TOP-LEVEL items — a nested item and a
    // fenced "2." line stay in their parent step, matching the section structure.
    const nestedVerifyBody = ["# NV", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. Run the check:", "   - confirm the result", "   ```sh", "   2. not a step", "   ```", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const nestedVerifyPath = path.join(dir, "issue-nested-verify.md");
    fs.writeFileSync(nestedVerifyPath, nestedVerifyBody);
    const nvFp = emitFingerprint(nestedVerifyPath);
    const nvMarkerPath = path.join(dir, "marker-nv.md");
    fs.writeFileSync(nvMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${nvFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${nvFp}`].join("\n")}\n`);
    const nv = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", nestedVerifyPath, "--marker", nvMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", nvFp])
    );
    if (nv.package_kind !== "issue-only") fail("resolve-issue-context nested-verify fixture must resolve issue-only");
    if (nv.behavioral_oracle.verify_steps.length !== 1) {
      fail("resolve-issue-context must split verify_steps only on top-level items (nested item + fenced line are not separate steps)");
    }

    // Guard: a behavior section whose content starts with a nested subheading is
    // still described behavior (extractSection keeps nested subsections).
    const nestedBehaviorBody = ["# NB", "", "## Что сделать", "", "### Details", "", "- the actual scope", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const nestedBehaviorPath = path.join(dir, "issue-nested-behavior.md");
    fs.writeFileSync(nestedBehaviorPath, nestedBehaviorBody);
    const nbFp = emitFingerprint(nestedBehaviorPath);
    const nbMarkerPath = path.join(dir, "marker-nb.md");
    fs.writeFileSync(nbMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${nbFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${nbFp}`].join("\n")}\n`);
    const nb = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", nestedBehaviorPath, "--marker", nbMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", nbFp])
    );
    if (nb.package_kind !== "issue-only") {
      fail("resolve-issue-context must count a behavior section starting with a nested subheading as described behavior");
    }

    // Guard: a behavior heading whose only content is an EMPTY fenced block has no
    // substantive content and is rejected — a fence marker is not behavior.
    const emptyFenceBody = ["# EF", "", "## Что сделать", "", "```", "```", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const emptyFencePath = path.join(dir, "issue-empty-fence.md");
    fs.writeFileSync(emptyFencePath, emptyFenceBody);
    const efFp = emitFingerprint(emptyFencePath);
    const efMarkerPath = path.join(dir, "marker-ef.md");
    fs.writeFileSync(efMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${efFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${efFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context empty-fence behavior fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", emptyFencePath, "--marker", efMarkerPath,
          "--label", "issue-only", "--approval-verified", efFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: stripMarkerBlock removes ONLY recognized marker fields — normative
    // text like "Endpoint: /admin/delete" after a (superseded) marker line stays
    // in the fingerprint, so changing it stales the approval.
    const afterMarker = (endpoint) =>
      ["# AM", "", "## Что сделать", "", "mono-issue-only marker", "Marker version: 1", "Scope fingerprint: deadbeefdead", "Acceptance IDs: AC1", "Risk class: standard", "Approval: none", `Endpoint: ${endpoint}`, "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const amAPath = path.join(dir, "issue-am-a.md");
    const amBPath = path.join(dir, "issue-am-b.md");
    fs.writeFileSync(amAPath, afterMarker("/admin/read"));
    fs.writeFileSync(amBPath, afterMarker("/admin/delete"));
    if (emitFingerprint(amAPath) === emitFingerprint(amBPath)) {
      fail("resolve-issue-context must keep non-marker content after a marker line in the fingerprint");
    }

    // Guard: a meaning-changing heading rename changes the fingerprint — the
    // matched heading text is bound into the hash, so "Scope" vs "Scope exclusions"
    // (mapping the same body) are distinct.
    const renameBody = (scopeHeading) =>
      ["# RN", "", `## ${scopeHeading}`, "", "- the body", "", "## Objective", "", "the objective", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const rnAPath = path.join(dir, "issue-rn-a.md");
    const rnBPath = path.join(dir, "issue-rn-b.md");
    fs.writeFileSync(rnAPath, renameBody("Scope"));
    fs.writeFileSync(rnBPath, renameBody("Scope exclusions"));
    if (emitFingerprint(rnAPath) === emitFingerprint(rnBPath)) {
      fail("resolve-issue-context must bind the matched heading text into the fingerprint (a rename changes the hash)");
    }

    // Guard: a bare nested subheading with no body under it is not substantive
    // behavior — the completeness gate rejects it.
    const emptyNestedPath = path.join(dir, "issue-empty-nested.md");
    fs.writeFileSync(
      emptyNestedPath,
      ["# EN", "", "## Что сделать", "", "### Details", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const enFp = emitFingerprint(emptyNestedPath);
    const enMarkerPath = path.join(dir, "marker-en.md");
    fs.writeFileSync(enMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${enFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${enFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context empty nested behavior fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", emptyNestedPath, "--marker", enMarkerPath,
          "--label", "issue-only", "--approval-verified", enFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: a marker with duplicate Acceptance IDs (padding the count to mask a
    // missing required id) is rejected — IDs are compared as deduped sets.
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC1",
      "Risk class: standard",
      `Approval: ${fingerprint}`,
    ]);
    expectCommandFailure(
      "resolve-issue-context duplicate acceptance id fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, ...issueOnlyArgs]),
      "issue-only-lane: broken marker: duplicate Acceptance IDs"
    );

    // Guard: a marker line OUTSIDE a fence whose fields are all INSIDE a fenced
    // code block collects no real fields (fenced = documentation example) and
    // fails closed, never a silent issue-only even with valid label/approval args.
    const fencedFieldsMarkerPath = path.join(dir, "marker-fenced-fields.md");
    fs.writeFileSync(
      fencedFieldsMarkerPath,
      `${["mono-issue-only marker", "```text", "Marker version: 1", `Scope fingerprint: ${fingerprint}`, "Acceptance IDs: AC1, AC2", "Risk class: standard", `Approval: ${fingerprint}`, "```"].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context fenced marker fields fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", fencedFieldsMarkerPath,
          ...issueOnlyArgs,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: a heading with valid Markdown indentation (1-3 spaces) is recognized,
    // so content under an indented " ## Scope" section binds the fingerprint.
    const indentHeadingBase = (tail) =>
      ["# IH", "", " ## Что сделать", "", tail, "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const ihAPath = path.join(dir, "issue-ih-a.md");
    const ihBPath = path.join(dir, "issue-ih-b.md");
    fs.writeFileSync(ihAPath, indentHeadingBase("- scope A"));
    fs.writeFileSync(ihBPath, indentHeadingBase("- scope B"));
    if (emitFingerprint(ihAPath) === emitFingerprint(ihBPath)) {
      fail("resolve-issue-context must recognize indented Markdown headings so their content binds the fingerprint");
    }

    // Guard: a behavior section whose only content is an HTML comment is not
    // substantive and is rejected — an invisible comment is not described behavior.
    const htmlCommentPath = path.join(dir, "issue-html-comment.md");
    fs.writeFileSync(
      htmlCommentPath,
      ["# HC", "", "## Что сделать", "", "<!-- TODO: fill this in -->", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const hcFp = emitFingerprint(htmlCommentPath);
    const hcMarkerPath = path.join(dir, "marker-hc.md");
    fs.writeFileSync(hcMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${hcFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${hcFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context html-comment behavior fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", htmlCommentPath, "--marker", hcMarkerPath,
          "--label", "issue-only", "--approval-verified", hcFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: stripMarkerBlock skips the same leading blank lines findMarkerBlock
    // allows — an inline marker with a blank line before its fields still resolves.
    const blankInlineBody = ["# BI", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: x", "- AC2: y", "", "## Как проверить", "", "1. s", "2. t", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const blankInlinePath = path.join(dir, "issue-blank-inline.md");
    fs.writeFileSync(blankInlinePath, blankInlineBody);
    const biFp = emitFingerprint(blankInlinePath);
    fs.writeFileSync(
      blankInlinePath,
      `${blankInlineBody}\nmono-issue-only marker\n\nMarker version: 1\nScope fingerprint: ${biFp}\nAcceptance IDs: AC1, AC2\nRisk class: standard\nApproval: ${biFp}\n`
    );
    const blankInline = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", blankInlinePath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", biFp])
    );
    if (blankInline.package_kind !== "issue-only") {
      fail("resolve-issue-context must strip an inline marker with a leading blank line before its fields so it resolves issue-only");
    }

    // Guard: only DECLARED acceptance IDs are collected — a cross-reference in a
    // criterion's prose ("described by AC99") and an id in a fenced example are not
    // declarations, so the oracle reports exactly the declared ids.
    const crossRefBody = ["# CR", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: preserve behavior described by AC99", "- AC2: also see AC1", "", "```", "AC77: fenced example", "```", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const crossRefPath = path.join(dir, "issue-crossref.md");
    fs.writeFileSync(crossRefPath, crossRefBody);
    const crFp = emitFingerprint(crossRefPath);
    const crMarkerPath = path.join(dir, "marker-cr.md");
    fs.writeFileSync(crMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${crFp}`, "Acceptance IDs: AC1, AC2", "Risk class: standard", `Approval: ${crFp}`].join("\n")}\n`);
    const cr = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", crossRefPath, "--marker", crMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", crFp])
    );
    if (cr.package_kind !== "issue-only") fail("resolve-issue-context cross-reference fixture must resolve issue-only with declared ids only");
    if (JSON.stringify(cr.behavioral_oracle.acceptance_ids) !== JSON.stringify(["AC1", "AC2"])) {
      fail("resolve-issue-context must collect only declared acceptance IDs (not cross-references or fenced examples)");
    }

    // Guard: a clean "standard" review-gate resolves issue-only. (This base issue
    // is reused below by replacing the review-gate line to test re-tier / history
    // / chain forms.)
    const reGateA = ["# RG", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: x", "", "## Как проверить", "", "1. s", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "standard", ""].join("\n");
    const reGateAPath = path.join(dir, "issue-regate-a.md");
    fs.writeFileSync(reGateAPath, reGateA);
    const rgaFp = emitFingerprint(reGateAPath);
    const rgaMarkerPath = path.join(dir, "marker-rga.md");
    fs.writeFileSync(rgaMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${rgaFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${rgaFp}`].join("\n")}\n`);
    const rga = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", reGateAPath, "--marker", rgaMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", rgaFp])
    );
    if (rga.package_kind !== "issue-only" || rga.risk_class !== "standard") {
      fail("resolve-issue-context must read the recorded review-gate class (standard), not a later 'deep' mention");
    }

    // And an explicit re-tier "standard→deep" records the target deep (out of the
    // Phase-1 envelope → project-first).
    const reGateB = reGateA.replace("standard", "standard→deep (new abstraction)");
    const reGateBPath = path.join(dir, "issue-regate-b.md");
    fs.writeFileSync(reGateBPath, reGateB);
    const rgbFp = emitFingerprint(reGateBPath);
    const rgbMarkerPath = path.join(dir, "marker-rgb.md");
    fs.writeFileSync(rgbMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${rgbFp}`, "Acceptance IDs: AC1", "Risk class: deep", `Approval: ${rgbFp}`].join("\n")}\n`);
    const rgb = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", reGateBPath, "--marker", rgbMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", rgbFp])
    );
    if (rgb.package_kind !== "project-first") {
      fail("resolve-issue-context must read a 'standard→deep' re-tier as deep (out of Phase-1 envelope → project-first)");
    }

    // Guard: a DOWNWARD re-tier "deep→standard" still records the higher class
    // (deep), so a standard marker cannot downgrade it into the lane.
    const downRetier = reGateA.replace("standard", "deep→standard (scope shrank)");
    const drPath = path.join(dir, "issue-down-retier.md");
    fs.writeFileSync(drPath, downRetier);
    const drFp = emitFingerprint(drPath);
    const drMarkerPath = path.join(dir, "marker-dr.md");
    fs.writeFileSync(drMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${drFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${drFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context downward re-tier fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", drPath, "--marker", drMarkerPath,
          "--label", "issue-only", "--approval-verified", drFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: an empty acceptance declaration ("- AC1:" with no criterion text) is
    // not a usable criterion — the Issue has no acceptance and is rejected.
    const emptyAcPath = path.join(dir, "issue-empty-ac.md");
    fs.writeFileSync(
      emptyAcPath,
      ["# EA", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1:", "", "## Как проверить", "", "1. run it", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const eaFp = emitFingerprint(emptyAcPath);
    const eaMarkerPath = path.join(dir, "marker-ea.md");
    fs.writeFileSync(eaMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${eaFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${eaFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context empty acceptance criterion fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", emptyAcPath, "--marker", eaMarkerPath,
          "--label", "issue-only", "--approval-verified", eaFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: a verification placeholder ("1. <!-- TODO -->") is not a real step —
    // the Issue has no verification and is rejected.
    const placeholderVerifyPath = path.join(dir, "issue-placeholder-verify.md");
    fs.writeFileSync(
      placeholderVerifyPath,
      ["# PV", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: real criterion", "", "## Как проверить", "", "1. <!-- TODO -->", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const pvFp = emitFingerprint(placeholderVerifyPath);
    const pvMarkerPath = path.join(dir, "marker-pv.md");
    fs.writeFileSync(pvMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${pvFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${pvFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context placeholder verify fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", placeholderVerifyPath, "--marker", pvMarkerPath,
          "--label", "issue-only", "--approval-verified", pvFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: a "## Что сделать" whose body is ONLY nested OTHER normative sections
    // has no scope description of its own and is rejected.
    const nestedForeignPath = path.join(dir, "issue-nested-foreign.md");
    fs.writeFileSync(
      nestedForeignPath,
      ["# NF", "", "## Что сделать", "", "### Критерии приёмки", "", "- AC1: real criterion", "", "### Как проверить", "", "1. run it", "", "### Что не входит", "", "- ng", "", "### Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const nfFp = emitFingerprint(nestedForeignPath);
    const nfMarkerPath = path.join(dir, "marker-nf.md");
    fs.writeFileSync(nfMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${nfFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${nfFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context nested-foreign-sections fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", nestedForeignPath, "--marker", nfMarkerPath,
          "--label", "issue-only", "--approval-verified", nfFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: verify steps with valid 0-3 space indentation are separate steps.
    const indentStepsBody = ["# IS", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "  1. first check", "  2. second check", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const indentStepsPath = path.join(dir, "issue-indent-steps.md");
    fs.writeFileSync(indentStepsPath, indentStepsBody);
    const isFp = emitFingerprint(indentStepsPath);
    const isMarkerPath = path.join(dir, "marker-is.md");
    fs.writeFileSync(isMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${isFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${isFp}`].join("\n")}\n`);
    const is = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", indentStepsPath, "--marker", isMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", isFp])
    );
    if (is.package_kind !== "issue-only" || is.behavioral_oracle.verify_steps.length !== 2) {
      fail("resolve-issue-context must treat 0-3 space indented list items as separate verify steps");
    }

    // Guard: only the EXACT authoritative "Review gate" heading sets the class — an
    // earlier "Review gate considerations" section cannot mask the deep class and
    // downgrade the package into the lane.
    const gateDupPath = path.join(dir, "issue-gate-dup.md");
    fs.writeFileSync(
      gateDupPath,
      ["# GD", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run it", "", "## Что не входит", "", "- ng", "", "## Review gate considerations", "", "- standard was rejected", "", "## Review gate", "", "- deep", ""].join("\n")
    );
    const gdFp = emitFingerprint(gateDupPath);
    const gdMarkerPath = path.join(dir, "marker-gd.md");
    fs.writeFileSync(gdMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${gdFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${gdFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context review-gate considerations fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", gateDupPath, "--marker", gdMarkerPath,
          "--label", "issue-only", "--approval-verified", gdFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: a duplicate Acceptance ID declared in the issue body is ambiguous and
    // rejected, like a duplicate id in the marker.
    const dupAcPath = path.join(dir, "issue-dup-ac.md");
    fs.writeFileSync(
      dupAcPath,
      ["# DA", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: first criterion", "- AC1: second criterion, same id", "", "## Как проверить", "", "1. run it", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const daFp = emitFingerprint(dupAcPath);
    const daMarkerPath = path.join(dir, "marker-da.md");
    fs.writeFileSync(daMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${daFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${daFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context duplicate body acceptance id fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", dupAcPath, "--marker", daMarkerPath,
          "--label", "issue-only", "--approval-verified", daFp,
        ]),
      "issue-only-lane: broken marker: duplicate Acceptance ID declared in issue body"
    );

    // Guard: a re-classification CHAIN records the highest class — "tiny→standard→
    // deep" is deep, so a standard marker cannot downgrade it into the lane.
    const chainGate = reGateA.replace("standard", "tiny→standard→deep (grew twice)");
    const chainPath = path.join(dir, "issue-chain.md");
    fs.writeFileSync(chainPath, chainGate);
    const chFp = emitFingerprint(chainPath);
    const chMarkerPath = path.join(dir, "marker-ch.md");
    fs.writeFileSync(chMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${chFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${chFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context re-tier chain fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", chainPath, "--marker", chMarkerPath,
          "--label", "issue-only", "--approval-verified", chFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: Linear task-list acceptance criteria ("- [ ] AC1: ...") are recognized.
    const checklistBody = ["# CL", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- [ ] AC1: resolver works", "- [x] AC2: marker parses", "", "## Как проверить", "", "1. run it", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const checklistPath = path.join(dir, "issue-checklist.md");
    fs.writeFileSync(checklistPath, checklistBody);
    const clFp = emitFingerprint(checklistPath);
    const clMarkerPath = path.join(dir, "marker-cl.md");
    fs.writeFileSync(clMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${clFp}`, "Acceptance IDs: AC1, AC2", "Risk class: standard", `Approval: ${clFp}`].join("\n")}\n`);
    const cl = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", checklistPath, "--marker", clMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", clFp])
    );
    if (cl.package_kind !== "issue-only" || JSON.stringify(cl.behavioral_oracle.acceptance_ids) !== JSON.stringify(["AC1", "AC2"])) {
      fail("resolve-issue-context must recognize Markdown task-list acceptance criteria");
    }

    // Guard: a re-tier chain in "risk history" cannot LOWER the authoritative class
    // — "risky; previous history: tiny→standard" stays risky.
    const historyGate = reGateA.replace("standard", "risky; previous history: tiny→standard");
    const historyPath = path.join(dir, "issue-history.md");
    fs.writeFileSync(historyPath, historyGate);
    const hyFp = emitFingerprint(historyPath);
    const hyMarkerPath = path.join(dir, "marker-hy.md");
    fs.writeFileSync(hyMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${hyFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${hyFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context risk-history fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", historyPath, "--marker", hyMarkerPath,
          "--label", "issue-only", "--approval-verified", hyFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: sections hidden inside an HTML comment are invisible — an Issue whose
    // Acceptance and How-to-verify are commented out has no oracle and is rejected.
    const commentedOraclePath = path.join(dir, "issue-commented-oracle.md");
    fs.writeFileSync(
      commentedOraclePath,
      ["# CO", "", "## Что сделать", "", "- do it", "", "<!--", "## Критерии приёмки", "", "- AC1: hidden criterion", "", "## Как проверить", "", "1. hidden step", "-->", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const coFp = emitFingerprint(commentedOraclePath);
    const coMarkerPath = path.join(dir, "marker-co.md");
    fs.writeFileSync(coMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${coFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${coFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context commented-oracle fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", commentedOraclePath, "--marker", coMarkerPath,
          "--label", "issue-only", "--approval-verified", coFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: the review-gate class is the MAX of all mentioned classes — a
    // "standard was proposed; Risk class: risky" section reads risky, so a
    // standard marker cannot enter the lane.
    const maxGate = reGateA.replace("standard", "standard was proposed; Risk class: risky");
    const maxPath = path.join(dir, "issue-max-gate.md");
    fs.writeFileSync(maxPath, maxGate);
    const mgFp = emitFingerprint(maxPath);
    const mgMarkerPath = path.join(dir, "marker-mg.md");
    fs.writeFileSync(mgMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${mgFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${mgFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context max-class review-gate fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", maxPath, "--marker", mgMarkerPath,
          "--label", "issue-only", "--approval-verified", mgFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: an ATX heading with a closing "#" sequence ("## Ревью-гейт ##") is
    // still recognized.
    const closingHashBody = ["# CH", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт ##", "", "- standard", ""].join("\n");
    const closingHashPath = path.join(dir, "issue-closing-hash.md");
    fs.writeFileSync(closingHashPath, closingHashBody);
    const chhFp = emitFingerprint(closingHashPath);
    const chhMarkerPath = path.join(dir, "marker-chh.md");
    fs.writeFileSync(chhMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${chhFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${chhFp}`].join("\n")}\n`);
    const chh = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", closingHashPath, "--marker", chhMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", chhFp])
    );
    if (chh.package_kind !== "issue-only") {
      fail("resolve-issue-context must recognize ATX headings with a closing hash sequence");
    }

    // Guard: a 4-space-indented ``` is indented code, NOT a fence, so it does not
    // hide the following normative headings.
    const fourSpaceFenceBody = ["# FS", "", "## Что сделать", "", "    ```", "    code indented", "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const fourSpacePath = path.join(dir, "issue-four-space.md");
    fs.writeFileSync(fourSpacePath, fourSpaceFenceBody);
    const fsFp = emitFingerprint(fourSpacePath);
    const fsMarkerPath = path.join(dir, "marker-fs.md");
    fs.writeFileSync(fsMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${fsFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${fsFp}`].join("\n")}\n`);
    const fs4 = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", fourSpacePath, "--marker", fsMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", fsFp])
    );
    if (fs4.package_kind !== "issue-only") {
      fail("resolve-issue-context must not treat a 4-space-indented ``` as a fence that hides later headings");
    }

    // Guard: a marker line indented 4+ spaces is a Markdown indented code block (a
    // documentation example), not an opt-in — even with an otherwise-valid inline
    // marker and matching label/approval, the Issue resolves project-first.
    const cleanImBody = ["# IM", "", "## Что сделать", "", "- do it", "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const cleanImPath = path.join(dir, "issue-im-clean.md");
    fs.writeFileSync(cleanImPath, cleanImBody);
    const imFp = emitFingerprint(cleanImPath);
    const indentedMarkerPath = path.join(dir, "issue-indented-marker.md");
    fs.writeFileSync(
      indentedMarkerPath,
      `${cleanImBody}\n    mono-issue-only marker\n    Marker version: 1\n    Scope fingerprint: ${imFp}\n    Acceptance IDs: AC1\n    Risk class: standard\n    Approval: ${imFp}\n`
    );
    const im = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", indentedMarkerPath, "--label", "issue-only", "--approval-verified", imFp])
    );
    if (im.package_kind !== "project-first") {
      fail("resolve-issue-context must treat a 4-space-indented marker line as project-first, not an opt-in");
    }

    // Guard: a marker line inside an HTML comment (a commented-out example, e.g. an
    // Issue documenting the format) is not a marker — it resolves project-first,
    // never a spurious broken-marker error from parsing the commented fields.
    const commentedMarkerPath = path.join(dir, "issue-commented-marker.md");
    fs.writeFileSync(
      commentedMarkerPath,
      ["# CM", "", "## Что сделать", "", "Documents the marker format:", "", "<!--", "mono-issue-only marker", "Marker version: 1", "(fields omitted in this example)", "-->", "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const cmm = JSON.parse(runNode(["scripts/resolve-issue-context.mjs", "--issue", commentedMarkerPath]));
    if (cmm.package_kind !== "project-first") {
      fail("resolve-issue-context must ignore a marker line inside an HTML comment (project-first, not a broken-marker error)");
    }

    // Guard: content after an HTML comment closes mid-line ("--> real scope") is
    // visible and counts — the tail after "-->" is not skipped.
    const remainderBody = ["# RM", "", "## Что сделать", "", "<!-- placeholder note", "--> the real scope is here", "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const remainderPath = path.join(dir, "issue-remainder.md");
    fs.writeFileSync(remainderPath, remainderBody);
    const rmFp = emitFingerprint(remainderPath);
    const rmMarkerPath = path.join(dir, "marker-rm.md");
    fs.writeFileSync(rmMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${rmFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${rmFp}`].join("\n")}\n`);
    const rm = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", remainderPath, "--marker", rmMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", rmFp])
    );
    if (rm.package_kind !== "issue-only") {
      fail("resolve-issue-context must see content after an HTML comment closes mid-line");
    }

    // Guard: the oracle sections use EXACT headings — "## Acceptance history" and
    // "## Verify exclusions" are not the canonical acceptance/verify sections, so an
    // Issue lacking the real ones has no oracle and is rejected.
    const looseHeadingPath = path.join(dir, "issue-loose-heading.md");
    fs.writeFileSync(
      looseHeadingPath,
      ["# LH", "", "## Что сделать", "", "- do it", "", "## Acceptance history", "", "- AC1: old criterion", "", "## Verify exclusions", "", "1. not a real step", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const lhFp = emitFingerprint(looseHeadingPath);
    const lhMarkerPath = path.join(dir, "marker-lh.md");
    fs.writeFileSync(lhMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${lhFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${lhFp}`].join("\n")}\n`);
    expectCommandFailure(
      "resolve-issue-context loose-oracle-heading fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", looseHeadingPath, "--marker", lhMarkerPath,
          "--label", "issue-only", "--approval-verified", lhFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: marker fields indented 4+ spaces are a Markdown indented code block —
    // an example with an unindented marker line and indented fields collects no
    // fields and fails closed, never a silent issue-only.
    const aFp = "a".repeat(64);
    const indentedFieldsPath = path.join(dir, "issue-indented-fields.md");
    fs.writeFileSync(
      indentedFieldsPath,
      ["# IF", "", "## Что сделать", "", "Example:", "", "mono-issue-only marker", "", `    Marker version: 1`, `    Scope fingerprint: ${aFp}`, "    Acceptance IDs: AC1", "    Risk class: standard", `    Approval: ${aFp}`, "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    expectCommandFailure(
      "resolve-issue-context indented marker fields fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", indentedFieldsPath,
          "--label", "issue-only", "--approval-verified", aFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: a "<!--" inside a fenced code block is literal, not a comment — it must
    // NOT swallow the real sections after the fence.
    const commentInFenceBody = ["# CF", "", "## Что сделать", "", "```", "<!-- this is code, not a comment", "```", "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const cfPath = path.join(dir, "issue-comment-in-fence.md");
    fs.writeFileSync(cfPath, commentInFenceBody);
    const cfFp = emitFingerprint(cfPath);
    const cfMarkerPath = path.join(dir, "marker-cf.md");
    fs.writeFileSync(cfMarkerPath, `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${cfFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${cfFp}`].join("\n")}\n`);
    const cf = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", cfPath, "--marker", cfMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", cfFp])
    );
    if (cf.package_kind !== "issue-only") {
      fail("resolve-issue-context must treat <!-- inside a fence as literal, not swallow the following sections");
    }

    // Guard: marker fields with a mixed space+tab indent reaching 4 columns are
    // indented code, not fields — fail closed (the old space-only check missed this).
    const tabFp = "b".repeat(64);
    const tabFieldsPath = path.join(dir, "issue-tab-fields.md");
    fs.writeFileSync(
      tabFieldsPath,
      ["# TF", "", "## Что сделать", "", "mono-issue-only marker", "", "  \tMarker version: 1", `  \tScope fingerprint: ${tabFp}`, "  \tAcceptance IDs: AC1", "  \tRisk class: standard", `  \tApproval: ${tabFp}`, "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    expectCommandFailure(
      "resolve-issue-context tab-indented marker fields fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", tabFieldsPath,
          "--label", "issue-only", "--approval-verified", tabFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: a 4+-column-indented recognized-key line after an inline marker is
    // Markdown code, not a field — stripMarkerBlock leaves it in the whole-body
    // fingerprint, so changing it invalidates the approval.
    const indentedAfterMarker = (val) =>
      ["# IAM", "", "## Что сделать", "", "- do it", "", "mono-issue-only marker", "Marker version: 1", "Scope fingerprint: x", "Acceptance IDs: AC1", "Risk class: standard", "Approval: none", `    Risk class: ${val}`, "", "## Критерии приёмки", "", "- AC1: real", "", "## Как проверить", "", "1. run", "", "## Что не входит", "", "- ng", "", "## Ревью-гейт", "", "- standard", ""].join("\n");
    const iamAPath = path.join(dir, "issue-iam-a.md");
    const iamBPath = path.join(dir, "issue-iam-b.md");
    fs.writeFileSync(iamAPath, indentedAfterMarker("keep"));
    fs.writeFileSync(iamBPath, indentedAfterMarker("changed"));
    if (emitFingerprint(iamAPath) === emitFingerprint(iamBPath)) {
      fail("resolve-issue-context must keep a 4+-indent recognized-key line in the fingerprint (not strip it as a marker field)");
    }

    // Guard: a stale scope fingerprint is a hard violation, not a silent lane.
    writeMarker([
      "Marker version: 1",
      "Scope fingerprint: deadbeef12ab",
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      "Approval: none",
    ]);
    expectCommandFailure(
      "resolve-issue-context stale fingerprint fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath]),
      "issue-only-lane: stale marker"
    );

    // Guard: a structurally broken marker (unknown version) is a hard violation.
    writeMarker([
      "Marker version: 2",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      "Approval: none",
    ]);
    expectCommandFailure(
      "resolve-issue-context broken marker version fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath]),
      "issue-only-lane: broken marker"
    );

    // Guard: the marker ≠ route-record boundary is executable — a route-record
    // field is rejected.
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      "Approval: none",
      "route_revision: 7",
    ]);
    expectCommandFailure(
      "resolve-issue-context forbidden route-record field fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath]),
      "issue-only-lane: broken marker"
    );

    // Guard: the "exactly five fields, no more" contract is executable — an extra
    // sixth field (even a benign one) is rejected, so the marker can't quietly grow.
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      "Approval: none",
      "Notes: sneaky sixth field",
    ]);
    expectCommandFailure(
      "resolve-issue-context unknown extra field fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath]),
      "issue-only-lane: broken marker: unknown field"
    );

    // Guard: the Phase-1 eligibility envelope is executable — a marker that
    // MATCHES an Issue genuinely classified deep/risky (its review-gate carries
    // that class) falls back to project-first, never silently issue-only
    // (deep/risky keeps full ceremony until Phase 3).
    for (const ineligible of ["deep", "risky"]) {
      const ineligibleIssuePath = path.join(dir, `issue-${ineligible}.md`);
      fs.writeFileSync(ineligibleIssuePath, fullBody.replace("REVIEWGATE_SENTINEL standard", `REVIEWGATE_SENTINEL ${ineligible}`));
      const ineligibleFp = emitFingerprint(ineligibleIssuePath);
      const ineligibleMarkerPath = path.join(dir, `marker-${ineligible}.md`);
      fs.writeFileSync(
        ineligibleMarkerPath,
        `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${ineligibleFp}`, "Acceptance IDs: AC1, AC2", `Risk class: ${ineligible}`, `Approval: ${ineligibleFp}`].join("\n")}\n`
      );
      const outOfEnvelope = JSON.parse(
        runNode(["scripts/resolve-issue-context.mjs", "--issue", ineligibleIssuePath, "--marker", ineligibleMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", ineligibleFp])
      );
      if (outOfEnvelope.package_kind !== "project-first") {
        fail(`resolve-issue-context must fall back to project-first for an out-of-envelope ${ineligible} marker`);
      }
    }

    // Guard: the marker's Risk class cannot DOWNGRADE the Issue's authoritative
    // review-gate class — a "standard" marker on a deep Issue is rejected, not
    // silently admitted to the lane.
    const deepIssuePath = path.join(dir, "issue-deep.md");
    fs.writeFileSync(deepIssuePath, fullBody.replace("REVIEWGATE_SENTINEL standard", "REVIEWGATE_SENTINEL deep"));
    const deepFp = emitFingerprint(deepIssuePath);
    const downgradeMarkerPath = path.join(dir, "marker-downgrade.md");
    fs.writeFileSync(
      downgradeMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${deepFp}`, "Acceptance IDs: AC1, AC2", "Risk class: standard", `Approval: ${deepFp}`].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context risk downgrade fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", deepIssuePath, "--marker", downgradeMarkerPath, "--label", "issue-only", "--approval-verified", deepFp]),
      "issue-only-lane: broken marker"
    );

    // Guard: integrity is checked BEFORE the eligibility fallback — a deep marker
    // (matching a deep Issue) with a stale fingerprint still hard-fails via the
    // fingerprint check, it does not slip into a silent project-first.
    const deepStaleMarkerPath = path.join(dir, "marker-deep-stale.md");
    fs.writeFileSync(
      deepStaleMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", "Scope fingerprint: deadbeef12ab", "Acceptance IDs: AC1, AC2", "Risk class: deep", "Approval: none"].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context corrupt deep marker fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", deepIssuePath, "--marker", deepStaleMarkerPath]),
      "issue-only-lane: stale marker"
    );

    // Guard: a sixth field whose key uses a hyphen or digit is still parsed and
    // rejected, never skipped as end-of-block.
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      "Approval: none",
      "Owner-ID: sneaky",
    ]);
    expectCommandFailure(
      "resolve-issue-context hyphenated extra field fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath]),
      "issue-only-lane: broken marker"
    );

    // Guard: a duplicate field is ambiguous and rejected — a second value can
    // never silently mask the first (here a second Risk class hiding a first).
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: deep",
      "Risk class: standard",
      "Approval: none",
    ]);
    expectCommandFailure(
      "resolve-issue-context duplicate field fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath]),
      "issue-only-lane: broken marker: duplicate field"
    );

    // Guard: a field-shaped line whose key holds punctuation the charset cannot
    // represent is a violation, not a silent block terminator that hides a field.
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      "Approval: none",
      "Notes.v2: sneaky",
    ]);
    expectCommandFailure(
      "resolve-issue-context unparseable line fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath]),
      "issue-only-lane: broken marker: unparseable line"
    );

    // Guard: an unparseable line BEFORE the first field is rejected too — a
    // punctuation-keyed line cannot hide ahead of Marker version.
    fs.writeFileSync(
      markerPath,
      `${["mono-issue-only marker", "Notes.v2: hidden", "Marker version: 1", `Scope fingerprint: ${fingerprint}`, "Acceptance IDs: AC1, AC2", "Risk class: standard", `Approval: ${fingerprint}`].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context pre-field unparseable line fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, ...issueOnlyArgs]),
      "issue-only-lane: broken marker: unparseable line"
    );

    // Guard: an empty behavioral oracle is rejected — issue-only needs at least
    // one acceptance ID and one verify step, so an Issue with no acceptance IDs
    // (and a marker whose "Acceptance IDs: ," parses empty) hard-fails.
    const emptyOraclePath = path.join(dir, "issue-empty-oracle.md");
    fs.writeFileSync(
      emptyOraclePath,
      ["# Empty oracle", "", "## Acceptance", "", "- no stable ids here", "", "## How to verify", "", "1. a step", "", "## Ревью-гейт", "", "- standard", ""].join("\n")
    );
    const emptyFp = runNode(["scripts/resolve-issue-context.mjs", "--issue", emptyOraclePath, "--emit-fingerprint"]).trim();
    const emptyOracleMarkerPath = path.join(dir, "marker-empty-oracle.md");
    fs.writeFileSync(
      emptyOracleMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${emptyFp}`, "Acceptance IDs: ,", "Risk class: standard", `Approval: ${emptyFp}`].join("\n")}\n`
    );
    expectCommandFailure(
      "resolve-issue-context empty oracle fixture",
      () =>
        runNode([
          "scripts/resolve-issue-context.mjs", "--issue", emptyOraclePath, "--marker", emptyOracleMarkerPath,
          "--label", "issue-only", "--approval-verified", emptyFp,
        ]),
      "issue-only-lane: broken marker"
    );

    // Guard: a stale (superseded) owner approval fails closed to project-first —
    // the lane never activates on an approval that does not match current scope.
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      "Approval: 0000deadbeef (approved by owner for an older scope)",
    ]);
    const staleApproval = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", "0000deadbeef"])
    );
    if (staleApproval.package_kind !== "project-first") {
      fail("resolve-issue-context must fail closed to project-first on a stale (superseded) owner approval");
    }

    // ── Config opt-in gate (MONO-19) ─────────────────────────────────────────
    // The issue-only lane is OFF by default. A fully valid marker + verified
    // label + fresh approval resolves issue-only ONLY when --config opts the lane
    // in AND names an owner principal. Every other config shape fails closed to
    // project-first; only structural corruption of issueOnlyLane is a hard
    // violation. (The happy fixture above already proves the enabled +
    // ownerPrincipal grant, so these cover the fail-closed cases.)
    writeMarker([
      "Marker version: 1",
      `Scope fingerprint: ${fingerprint}`,
      "Acceptance IDs: AC1, AC2",
      "Risk class: standard",
      `Approval: ${fingerprint}`,
    ]);

    // (a) No --config at all ⇒ project-first, even with a valid marker + verified
    // label + fresh approval. The lane never activates without the opt-in.
    const noConfig = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, ...issueOnlyArgs])
    );
    if (noConfig.package_kind !== "project-first") {
      fail("resolve-issue-context must fail closed to project-first without the opt-in config");
    }

    // (b) issueOnlyLane.enabled === false ⇒ project-first even with a valid
    // marker and a named owner.
    const disabledConfigPath = path.join(dir, "config-disabled.json");
    fs.writeFileSync(
      disabledConfigPath,
      `${JSON.stringify({ schemaVersion: 1, issueOnlyLane: { enabled: false, ownerPrincipal: "user_owner_1" } }, null, 2)}\n`
    );
    const disabled = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", disabledConfigPath, ...issueOnlyArgs])
    );
    if (disabled.package_kind !== "project-first") {
      fail("resolve-issue-context must fail closed to project-first when the lane is disabled by config");
    }

    // (c) enabled === true but no ownerPrincipal ⇒ project-first (fail-closed).
    // The opt-in must both enable the lane AND designate the owner principal.
    const noOwnerConfigPath = path.join(dir, "config-no-owner.json");
    fs.writeFileSync(
      noOwnerConfigPath,
      `${JSON.stringify({ schemaVersion: 1, issueOnlyLane: { enabled: true } }, null, 2)}\n`
    );
    const noOwner = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", noOwnerConfigPath, ...issueOnlyArgs])
    );
    if (noOwner.package_kind !== "project-first") {
      fail("resolve-issue-context must fail closed to project-first when the enabled lane names no ownerPrincipal");
    }

    // (c′) enabled === true with an empty/whitespace ownerPrincipal ⇒ project-first.
    const blankOwnerConfigPath = path.join(dir, "config-blank-owner.json");
    fs.writeFileSync(
      blankOwnerConfigPath,
      `${JSON.stringify({ schemaVersion: 1, issueOnlyLane: { enabled: true, ownerPrincipal: "   " } }, null, 2)}\n`
    );
    const blankOwner = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", blankOwnerConfigPath, ...issueOnlyArgs])
    );
    if (blankOwner.package_kind !== "project-first") {
      fail("resolve-issue-context must fail closed to project-first when ownerPrincipal is empty/whitespace");
    }

    // (d) A structurally malformed issueOnlyLane is a hard violation, never a
    // silent enable — a non-boolean `enabled` and a non-object lane both fail
    // closed with the stable invalid-config line.
    const badEnabledConfigPath = path.join(dir, "config-bad-enabled.json");
    fs.writeFileSync(
      badEnabledConfigPath,
      `${JSON.stringify({ schemaVersion: 1, issueOnlyLane: { enabled: "false" } }, null, 2)}\n`
    );
    expectCommandFailure(
      "resolve-issue-context malformed config enabled fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", badEnabledConfigPath, ...issueOnlyArgs]),
      "issue-only-lane: invalid config"
    );
    const nonObjectLaneConfigPath = path.join(dir, "config-nonobject-lane.json");
    fs.writeFileSync(
      nonObjectLaneConfigPath,
      `${JSON.stringify({ schemaVersion: 1, issueOnlyLane: "enabled" }, null, 2)}\n`
    );
    expectCommandFailure(
      "resolve-issue-context non-object issueOnlyLane fixture",
      () => runNode(["scripts/resolve-issue-context.mjs", "--issue", issuePath, "--marker", markerPath, "--config", nonObjectLaneConfigPath, ...issueOnlyArgs]),
      "issue-only-lane: invalid config"
    );

    // AC2 / MONO-15 stale-approval fixture — the create-then-approve read-back
    // guard. A marker approved against fingerprint F goes STALE the moment ANY of
    // the four contract sections (scope, acceptance, verify, non-goals) is edited
    // after approval: the whole-body fingerprint no longer matches F, so the
    // resolver hard-fails with `stale marker` and never silently resolves the
    // edited body as issue-only. This exercises the EXISTING whole-body detection
    // (no new hashing path) and proves the intake transaction parks any package
    // whose body drifts between approve and activate.
    const staleBase = [
      "# Stale After Approval",
      "",
      "## Что сделать",
      "",
      "- STALE_SCOPE build the widget",
      "",
      "## Критерии приёмки",
      "",
      "- AC1: STALE_ACCEPTANCE the widget renders",
      "",
      "## Как проверить",
      "",
      "1. STALE_VERIFY run the widget suite",
      "",
      "## Что не входит",
      "",
      "- STALE_NONGOALS theming work",
      "",
      "## Ревью-гейт",
      "",
      "- standard, pre-ship review",
      "",
    ].join("\n");
    const staleBasePath = path.join(dir, "issue-stale-base.md");
    fs.writeFileSync(staleBasePath, staleBase);
    const staleFp = emitFingerprint(staleBasePath);
    // The marker the owner approved against fingerprint F (the unedited body).
    const staleMarkerPath = path.join(dir, "marker-stale-after-approval.md");
    fs.writeFileSync(
      staleMarkerPath,
      `${["mono-issue-only marker", "Marker version: 1", `Scope fingerprint: ${staleFp}`, "Acceptance IDs: AC1", "Risk class: standard", `Approval: ${staleFp}`].join("\n")}\n`
    );
    // Sanity: the unedited body resolves issue-only under the approved marker, so
    // the failures below are caused only by the post-approval body edit.
    const staleBaseResolved = JSON.parse(
      runNode(["scripts/resolve-issue-context.mjs", "--issue", staleBasePath, "--marker", staleMarkerPath, "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", staleFp])
    );
    if (staleBaseResolved.package_kind !== "issue-only") {
      fail("resolve-issue-context stale-approval base must resolve issue-only before any post-approval edit");
    }
    // Editing ANY of the four sections after approval invalidates it: the marker
    // still records F while the body now hashes to F', so the resolver hard-fails.
    for (const [sentinel, label] of [
      ["STALE_SCOPE", "scope"],
      ["STALE_ACCEPTANCE", "acceptance"],
      ["STALE_VERIFY", "verify"],
      ["STALE_NONGOALS", "non-goals"],
    ]) {
      const editedPath = path.join(dir, `issue-stale-${sentinel}.md`);
      fs.writeFileSync(editedPath, staleBase.replace(sentinel, `${sentinel}_EDITED_AFTER_APPROVAL`));
      expectCommandFailure(
        `resolve-issue-context stale-approval ${label}-edit fixture`,
        () =>
          runNode([
            "scripts/resolve-issue-context.mjs", "--issue", editedPath, "--marker", staleMarkerPath,
            "--config", enableConfigPath, "--label", "issue-only", "--approval-verified", staleFp,
          ]),
        "issue-only-lane: stale marker"
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function validateWatcherContaminationBehavior() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-workflow-watcher-"));
  try {
    const logsDir = path.join(fixtureRoot, "logs");
    fs.mkdirSync(logsDir);

    const contaminated = [
      "Reading additional input from stdin...",
      JSON.stringify({ type: "thread.started", thread_id: "fixture-thread" }),
      "",
    ].join("\n");
    const longEventPrefix = 'Reading additional input from stdin...\n{"type":"thread.started","payload":"';
    const boundaryPadding = (4095 - Buffer.byteLength(longEventPrefix) % 4096 + 4096) % 4096;
    const contaminatedWithBoundarySplit = `${longEventPrefix}${"x".repeat(boundaryPadding)}é"}\n`;
    const fixtures = {
      "MONO-101-mono-implement-a1.jsonl": contaminated,
      "MONO-102-mono-implement-a1.jsonl": contaminatedWithBoundarySplit,
      "MONO-103-mono-implement-a1.jsonl": "Reading additional input from stdin...\n",
      "MONO-104-mono-implement-a1.jsonl": "\n\n",
    };
    const stale = new Date(Date.now() - 181_000);
    for (const [name, body] of Object.entries(fixtures)) {
      const logPath = path.join(logsDir, name);
      fs.writeFileSync(logPath, body);
      fs.utimesSync(logPath, stale, stale);
    }
    fs.writeFileSync(
      path.join(fixtureRoot, "workers.json"),
      JSON.stringify({
        "MONO-101": { transport: "codex-cli", stage: "mono-implement", pid: process.pid, log: path.join(logsDir, "MONO-101-mono-implement-a1.jsonl") },
        "MONO-102": { transport: "codex-cli", stage: "mono-implement", pid: 999_999_999, log: path.join(logsDir, "MONO-102-mono-implement-a1.jsonl") },
        "MONO-103": { transport: "codex-cli", stage: "mono-implement", pid: 999_999_999, log: path.join(logsDir, "MONO-103-mono-implement-a1.jsonl") },
        "MONO-104": { transport: "codex-cli", stage: "mono-implement", pid: 999_999_999, log: path.join(logsDir, "MONO-104-mono-implement-a1.jsonl") },
      })
    );

    const result = spawnSync(
      process.execPath,
      [
        "scripts/watch-workers.mjs",
        "--root",
        fixtureRoot,
        "--stall-sec",
        "90",
        "--once",
      ],
      { cwd: root, encoding: "utf8" }
    );
    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    if (result.status !== 0) {
      fail(`watcher contamination fixture failed to run: ${stderr || result.error?.message || `exit ${result.status}`}`);
      return;
    }

    if (!stdout.includes("EVENT:stall MONO-101")) {
      fail("contaminated watcher log with a live writer must still emit stall");
    }
    if (!stdout.includes("EVENT:dead MONO-102")) {
      fail("contaminated watcher log with a gone writer must still emit dead");
    }
    if (/EVENT:spawn-fail MONO-10[12]\b/.test(stdout)) {
      fail("contaminated watcher logs with valid JSON events must not emit spawn-fail");
    }
    if (!stdout.includes("EVENT:spawn-fail MONO-103") || !stdout.includes("EVENT:spawn-fail MONO-104")) {
      fail("watcher logs without JSON events, including blank-only output, must emit spawn-fail");
    }
    const contaminationWarnings = stderr.match(/watch-workers: non-JSON contamination before valid JSON events in MONO-10[12]-mono-implement-a1\.jsonl/g) || [];
    if (contaminationWarnings.length !== 2) {
      fail("each contaminated watcher log must emit one diagnostic warning");
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function validateWatcherInactiveGateSpawnBehavior() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-workflow-watcher-inactive-"));
  let incrementalWatcher = null;
  try {
    const logsDir = path.join(fixtureRoot, "logs");
    fs.mkdirSync(logsDir);
    const freshLog = path.join(logsDir, "MONO-361-mono-implement-a1.jsonl");
    const staleLog = path.join(logsDir, "MONO-362-mono-implement-a1.jsonl");
    const otherLog = path.join(logsDir, "MONO-363-mono-implement-a1.jsonl");
    const futureLog = path.join(logsDir, "MONO-365-mono-implement-a1.jsonl");
    const partialLog = path.join(logsDir, "MONO-366-mono-implement-a1.jsonl");
    const contaminatedPartialLog = path.join(logsDir, "MONO-367-mono-implement-a1.jsonl");
    const completedFailureLog = path.join(logsDir, "MONO-368-mono-implement-a1.jsonl");
    const expiredPartialLog = path.join(logsDir, "MONO-369-mono-implement-a1.jsonl");
    const nonStartJsonLog = path.join(logsDir, "MONO-370-mono-implement-a1.jsonl");
    const contaminationOnlyLog = path.join(logsDir, "MONO-371-mono-implement-a1.jsonl");
    const missingLog = path.join(logsDir, "MONO-374-mono-implement-a1.jsonl");
    const almostExpiredLog = path.join(logsDir, "MONO-375-mono-implement-a1.jsonl");
    const oneShotLargeLog = path.join(logsDir, "MONO-376-mono-implement-a1.jsonl");
    fs.writeFileSync(freshLog, "");
    fs.writeFileSync(staleLog, "");
    fs.writeFileSync(otherLog, `${JSON.stringify({ type: "thread.started", thread_id: "other-thread" })}\n`);
    fs.writeFileSync(futureLog, "");
    fs.writeFileSync(partialLog, '{"type":"thread.started","thread_id":"partial');
    fs.writeFileSync(
      contaminatedPartialLog,
      'Reading additional input from stdin...\n{"type":"thread.started","thread_id":"partial'
    );
    fs.writeFileSync(completedFailureLog, "spawn command failed before JSON\n");
    fs.writeFileSync(expiredPartialLog, '{"type":"thread.started","thread_id":"expired');
    fs.writeFileSync(nonStartJsonLog, `${JSON.stringify({ type: "turn.completed" })}\n`);
    fs.writeFileSync(contaminationOnlyLog, "Reading additional input from stdin...\n");
    fs.writeFileSync(almostExpiredLog, "");
    fs.writeFileSync(
      oneShotLargeLog,
      `${`${JSON.stringify({ type: "turn.completed" })}\n`.repeat(12_000)}${JSON.stringify({
        type: "thread.started",
        thread_id: "one-shot-thread",
      })}\n`
    );
    const stale = new Date(Date.now() - 181_000);
    // Deliberately invert log age and registration age: startup timeout must
    // follow the durable registry publication, not a prepared log's mtime.
    fs.utimesSync(freshLog, stale, stale);
    fs.utimesSync(otherLog, stale, stale);
    fs.utimesSync(futureLog, stale, stale);
    fs.utimesSync(expiredPartialLog, stale, stale);
    fs.utimesSync(nonStartJsonLog, stale, stale);
    const registeredNow = new Date().toISOString();
    const registeredStale = stale.toISOString();
    const registeredAlmostExpired = new Date(Date.now() - 89_000).toISOString();
    const identity = {
      packVersion: "0.20.1",
      sourceCommit: "a".repeat(40),
      surfaceRevision: 3,
    };
    fs.writeFileSync(
      path.join(fixtureRoot, "workers.json"),
      JSON.stringify({
        "MONO-361": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: freshLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredNow,
          ...identity,
        },
        "MONO-362": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: staleLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredStale,
          ...identity,
        },
        "MONO-363": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: otherLog,
          thread_id: "other-thread",
          pid: 999_999_999,
          ...identity,
        },
        "MONO-365": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: futureLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: new Date(Date.now() + 3_600_000).toISOString(),
          ...identity,
        },
        "MONO-366": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: partialLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredNow,
          ...identity,
        },
        "MONO-367": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: contaminatedPartialLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredNow,
          ...identity,
        },
        "MONO-368": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: completedFailureLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredStale,
          ...identity,
        },
        "MONO-369": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: expiredPartialLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredStale,
          ...identity,
        },
        "MONO-370": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: nonStartJsonLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredStale,
          ...identity,
        },
        "MONO-371": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: contaminationOnlyLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredNow,
          ...identity,
        },
        "MONO-374": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: missingLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredNow,
          ...identity,
        },
        "MONO-375": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: almostExpiredLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredAlmostExpired,
          ...identity,
        },
        "MONO-376": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: oneShotLargeLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredStale,
          ...identity,
        },
      })
    );

    const result = spawnSync(
      process.execPath,
      ["scripts/watch-workers.mjs", "--root", fixtureRoot, "--stall-sec", "90", "--once"],
      { cwd: root, encoding: "utf8" }
    );
    const stdout = result.stdout || "";
    if (result.status !== 0) {
      fail(`inactive gate-spawn watcher fixture failed to run: ${result.stderr || result.error?.message || `exit ${result.status}`}`);
      return;
    }
    if (/EVENT:(stall|dead|spawn-fail) MONO-361\b/.test(stdout)) {
      fail("fresh inactive gate-spawn registration must stay quiet during its bounded startup window");
    }
    if (!stdout.includes("EVENT:spawn-fail MONO-362")) {
      fail("expired inactive gate-spawn registration must emit spawn-fail");
    }
    if (!stdout.includes("EVENT:dead MONO-363")) {
      fail("inactive gate-spawn handling must continue processing other workers");
    }
    if (!stdout.includes("EVENT:spawn-fail MONO-365")) {
      fail("future-dated inactive registration must emit spawn-fail rather than enter ordinary dead healing");
    }
    if (!stdout.includes("EVENT:spawn-fail MONO-374")) {
      fail("inactive gate-spawn registration without a readable log must emit spawn-fail");
    }
    for (const issue of ["MONO-375", "MONO-376"]) {
      if (new RegExp(`EVENT:(stall|dead|spawn-fail) ${issue}\\b`).test(stdout)) {
        fail(`bounded startup must not fail before its threshold or before one-shot rescan (${issue})`);
      }
    }
    for (const issue of ["MONO-366", "MONO-367", "MONO-371"]) {
      if (new RegExp(`EVENT:(stall|dead|spawn-fail) ${issue}\\b`).test(stdout)) {
        fail(`startup without thread.started must remain bounded during its window (${issue})`);
      }
    }
    for (const issue of ["MONO-368", "MONO-369", "MONO-370"]) {
      if (!stdout.includes(`EVENT:spawn-fail ${issue}`)) {
        fail(`completed failure or startup without thread.started must emit spawn-fail (${issue})`);
      }
    }

    const incrementalLog = path.join(logsDir, "MONO-372-mono-implement-a1.jsonl");
    const sentinelLog = path.join(logsDir, "MONO-373-mono-implement-a1.jsonl");
    const busyEvent = `${JSON.stringify({
      type: "turn.completed",
      detail: "x".repeat(900),
    })}\n`;
    fs.writeFileSync(
      incrementalLog,
      `${busyEvent.repeat(400)}${JSON.stringify({
        type: "thread.started",
        thread_id: "incremental-thread",
      })}\n`
    );
    fs.writeFileSync(sentinelLog, "");
    const incrementalEntry = {
      transport: "codex-cli",
      stage: "mono-implement",
      log: incrementalLog,
      thread_id: null,
      pid: null,
      gates: ["pack-identity"],
      spawned_at: registeredStale,
      ...identity,
    };
    fs.writeFileSync(
      path.join(fixtureRoot, "workers.json"),
      JSON.stringify({ "MONO-372": incrementalEntry })
    );
    incrementalWatcher = startWatcherFixture(fixtureRoot);
    await new Promise((resolve) => setTimeout(resolve, 2_200));

    fs.writeFileSync(
      path.join(fixtureRoot, "workers.json"),
      JSON.stringify({
        "MONO-372": incrementalEntry,
        "MONO-373": {
          transport: "codex-cli",
          stage: "mono-implement",
          log: sentinelLog,
          thread_id: null,
          pid: null,
          gates: ["pack-identity"],
          spawned_at: registeredStale,
          ...identity,
        },
      })
    );
    const sentinelObserved = waitForWatcherFixture(
      () => watcherOutput(incrementalWatcher.stdoutPath).includes("EVENT:spawn-fail MONO-373"),
      5_000
    );
    const incrementalOutput = watcherOutput(incrementalWatcher.stdoutPath);
    if (!sentinelObserved) {
      fail("incremental startup fixture did not observe the post-update sentinel scan");
    }
    if (/EVENT:(stall|dead|spawn-fail) MONO-372\b/.test(incrementalOutput)) {
      fail("bounded incremental log scanning must still discover a later thread.started event");
    }
  } finally {
    if (incrementalWatcher !== null) {
      await incrementalWatcher.stop();
    }
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function waitForWatcherFixture(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return null;
}

function startWatcherFixture(fixtureRoot, extraArgs = []) {
  const stdoutPath = path.join(fixtureRoot, "watcher.stdout");
  const stderrPath = path.join(fixtureRoot, "watcher.stderr");
  const stdoutFd = fs.openSync(stdoutPath, "w");
  const stderrFd = fs.openSync(stderrPath, "w");
  const child = spawn(
    process.execPath,
    [
      "scripts/watch-workers.mjs",
      "--root",
      fixtureRoot,
      "--stall-sec",
      "90",
      "--repeat-sec",
      "1",
      "--interval-sec",
      "1",
      ...extraArgs,
    ],
    { cwd: root, stdio: ["ignore", stdoutFd, stderrFd] }
  );
  return {
    child,
    stdoutPath,
    stderrPath,
    async stop() {
      const exited = new Promise((resolve, reject) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`watcher fixture did not exit after SIGTERM: ${fixtureRoot}`));
        }, 5_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      child.kill("SIGTERM");
      try {
        await exited;
      } finally {
        fs.closeSync(stdoutFd);
        fs.closeSync(stderrFd);
      }
    },
  };
}

function watcherOutput(pathname) {
  try {
    return fs.readFileSync(pathname, "utf8");
  } catch {
    return "";
  }
}

async function validateWatcherV3Behavior() {
  const identity = {
    packVersion: "0.20.1",
    sourceCommit: "a".repeat(40),
    surfaceRevision: 1,
  };
  const reportFor = (issue, stage = "mono-implement", overrides = {}) => ({
    issue,
    stage,
    status: "implemented-needs-preflight",
    ...identity,
    ...overrides,
  });
  const registryFor = (issue, log, overrides = {}) => ({
    [issue]: {
      transport: "codex-cli",
      stage: "mono-implement",
      log,
      pid: process.pid,
      ...identity,
      ...overrides,
    },
  });
  const writeJson = (pathname, value) =>
    fs.writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`);
  const writeLog = (pathname) =>
    fs.writeFileSync(pathname, `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`);

  // AC1 create/unchanged/update: one watcher process remembers report
  // versions by mtime+size across scans, but a fresh process would emit the
  // current version again (at-least-once across watcher restarts).
  const reportCycleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-watcher-report-cycle-"));
  try {
    const logsDir = path.join(reportCycleRoot, "logs");
    const reportsDir = path.join(reportCycleRoot, "reports");
    fs.mkdirSync(logsDir);
    fs.mkdirSync(reportsDir);
    const logPath = path.join(logsDir, "MONO-201-mono-implement-a1.jsonl");
    const reportPath = path.join(reportsDir, "MONO-201-mono-implement.json");
    writeLog(logPath);
    writeJson(path.join(reportCycleRoot, "workers.json"), registryFor("MONO-201", logPath));
    writeJson(path.join(reportCycleRoot, "control.json"), { state: "active" });
    writeJson(reportPath, reportFor("MONO-201"));

    const watcher = startWatcherFixture(reportCycleRoot, ["--idle-sec", "30"]);
    const first = waitForWatcherFixture(() => {
      const output = watcherOutput(watcher.stdoutPath);
      return (output.match(/EVENT:report MONO-201\b/g) || []).length === 1 && output;
    });
    if (!first) fail("watcher report create fixture did not emit exactly once");

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_150);
    const unchanged = watcherOutput(watcher.stdoutPath);
    if ((unchanged.match(/EVENT:report MONO-201\b/g) || []).length !== 1) {
      fail("watcher unchanged report fixture must stay silent across scans");
    }

    writeJson(reportPath, reportFor("MONO-201", "mono-implement", { notes: "updated report version" }));
    const updated = waitForWatcherFixture(() => {
      const output = watcherOutput(watcher.stdoutPath);
      return (output.match(/EVENT:report MONO-201\b/g) || []).length === 2 && output;
    });
    if (!updated) fail("watcher updated report fixture did not emit a second report event");
    await watcher.stop();

    const restart = spawnSync(
      process.execPath,
      ["scripts/watch-workers.mjs", "--root", reportCycleRoot, "--stall-sec", "90", "--idle-sec", "30", "--once"],
      { cwd: root, encoding: "utf8" }
    );
    if (restart.status !== 0 || !restart.stdout.includes("EVENT:report MONO-201")) {
      fail("watcher restart must re-emit the current report version once");
    }
  } finally {
    fs.rmSync(reportCycleRoot, { recursive: true, force: true });
  }

  // AC1 lag/prior-attempt/foreign-identity/non-codex-silence in one scan.
  const correlationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-watcher-report-correlation-"));
  try {
    const logsDir = path.join(correlationRoot, "logs");
    const reportsDir = path.join(correlationRoot, "reports");
    fs.mkdirSync(logsDir);
    fs.mkdirSync(reportsDir);
    const workers = {};

    const addFixture = (issue, { reportFirst = false, registry = {}, report = {} } = {}) => {
      const logPath = path.join(logsDir, `${issue}-mono-implement-a1.jsonl`);
      const reportPath = path.join(reportsDir, `${issue}-mono-implement.json`);
      if (reportFirst) writeJson(reportPath, reportFor(issue, "mono-implement", report));
      writeLog(logPath);
      workers[issue] = registryFor(issue, logPath, registry)[issue];
      if (!reportFirst) writeJson(reportPath, reportFor(issue, "mono-implement", report));
      return { logPath, reportPath };
    };

    const lag = addFixture("MONO-202");
    const lagBirthMs = fs.statSync(lag.logPath).birthtimeMs;
    fs.utimesSync(lag.logPath, new Date(lagBirthMs + 60_000), new Date(lagBirthMs + 60_000));
    fs.utimesSync(lag.reportPath, new Date(lagBirthMs + 10), new Date(lagBirthMs + 10));

    const prior = addFixture("MONO-203", { reportFirst: true });
    const priorBirthMs = fs.statSync(prior.logPath).birthtimeMs;
    fs.utimesSync(prior.reportPath, new Date(priorBirthMs - 1_000), new Date(priorBirthMs - 1_000));

    addFixture("MONO-204", { report: { sourceCommit: "b".repeat(40) } });
    addFixture("MONO-205", { registry: { transport: "claude-code-desktop", pid: null } });
    addFixture("MONO-209", {
      registry: { packVersion: undefined, sourceCommit: undefined, surfaceRevision: undefined },
      report: { packVersion: undefined, sourceCommit: undefined, surfaceRevision: undefined },
    });
    writeJson(path.join(correlationRoot, "workers.json"), workers);
    writeJson(path.join(correlationRoot, "control.json"), { state: "active" });

    const result = spawnSync(
      process.execPath,
      ["scripts/watch-workers.mjs", "--root", correlationRoot, "--stall-sec", "90", "--idle-sec", "30", "--once"],
      { cwd: root, encoding: "utf8" }
    );
    if (result.status !== 0) {
      fail(`watcher report correlation fixtures failed to run: ${result.stderr || `exit ${result.status}`}`);
    } else {
      if (!result.stdout.includes("EVENT:report MONO-202")) {
        fail("watcher report lag fixture must allow report mtime within the stall threshold");
      }
      for (const [issue, label] of [
        ["MONO-203", "prior-attempt"],
        ["MONO-204", "foreign-identity"],
        ["MONO-205", "non-codex-silence"],
        ["MONO-209", "missing-identity"],
      ]) {
        if (result.stdout.includes(`EVENT:report ${issue}`)) {
          fail(`watcher ${label} report fixture must stay silent`);
        }
      }
    }
  } finally {
    fs.rmSync(correlationRoot, { recursive: true, force: true });
  }

  // MONO-48: liveness suppression must consume the same correlated report
  // snapshot as report delivery. A fresh pathname alone proves nothing: wrong
  // issue/stage, missing identity, and foreign identity must each leave the
  // named liveness branch armed. The log is aged BEFORE the report is written
  // so report.mtime >= log.birthtime holds with macOS btime and Node's
  // ctime-as-birthtime fallback alike.
  const suppressionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-watcher-report-suppression-"));
  try {
    const logsDir = path.join(suppressionRoot, "logs");
    const reportsDir = path.join(suppressionRoot, "reports");
    fs.mkdirSync(logsDir);
    fs.mkdirSync(reportsDir);
    const workers = {};
    const staleLog = new Date(Date.now() - 200_000);

    const addSuppressionFixture = (issue, { pid, report }) => {
      const logPath = path.join(logsDir, `${issue}-mono-implement-a1.jsonl`);
      const reportPath = path.join(reportsDir, `${issue}-mono-implement.json`);
      writeLog(logPath);
      fs.utimesSync(logPath, staleLog, staleLog);
      writeJson(reportPath, report);
      workers[issue] = registryFor(issue, logPath, { pid })[issue];
    };

    // Positive controls: a correlated fresh report still suppresses every
    // non-live outcome exactly as before.
    addSuppressionFixture("MONO-210", {
      pid: process.pid,
      report: reportFor("MONO-210"),
    });
    addSuppressionFixture("MONO-211", {
      pid: 999_999_999,
      report: reportFor("MONO-211"),
    });
    addSuppressionFixture("MONO-212", {
      pid: null,
      report: reportFor("MONO-212"),
    });

    // Negative controls name the exact branch that an uncorrelated report must
    // not suppress.
    addSuppressionFixture("MONO-213", {
      pid: process.pid,
      report: reportFor("MONO-999", "mono-preflight"),
    });
    addSuppressionFixture("MONO-214", {
      pid: 999_999_999,
      report: {},
    });
    addSuppressionFixture("MONO-215", {
      pid: null,
      report: reportFor("MONO-215", "mono-implement", { sourceCommit: "b".repeat(40) }),
    });

    writeJson(path.join(suppressionRoot, "workers.json"), workers);
    writeJson(path.join(suppressionRoot, "control.json"), { state: "active" });

    const result = spawnSync(
      process.execPath,
      ["scripts/watch-workers.mjs", "--root", suppressionRoot, "--stall-sec", "90", "--idle-sec", "30", "--once"],
      { cwd: root, encoding: "utf8" }
    );
    if (result.status !== 0) {
      fail(`watcher report suppression fixtures failed to run: ${result.stderr || `exit ${result.status}`}`);
    } else {
      for (const issue of ["MONO-210", "MONO-211", "MONO-212"]) {
        if (new RegExp(`EVENT:(stall|dead) ${issue}\\b`).test(result.stdout)) {
          fail(`watcher correlated fresh report must suppress every liveness branch (${issue})`);
        }
      }
      if (!result.stdout.includes("EVENT:stall MONO-213")) {
        fail("watcher wrong issue/stage report must not suppress the named stall event");
      }
      if (!/EVENT:dead MONO-214\b.*writer pid .* is gone/.test(result.stdout)) {
        fail("watcher report without pack identity must not suppress the named dead-writer event");
      }
      if (!/EVENT:dead MONO-215\b.*with no writer evidence/.test(result.stdout)) {
        fail("watcher foreign-identity report must not suppress the named no-writer-evidence event");
      }
    }
  } finally {
    fs.rmSync(suppressionRoot, { recursive: true, force: true });
  }

  // AC2 threshold/no-spam plus live codex and pid-less non-codex blockers.
  for (const [label, workers, expectIdle, idleSec] of [
    ["empty registry threshold", {}, true, "2"],
    ["live codex worker", registryFor("MONO-206", "/missing-but-registered.jsonl"), false, "1"],
    ["pid-less non-codex worker", registryFor("MONO-207", null, { transport: "fallback", pid: null, log: null }), false, "1"],
  ]) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-watcher-idle-basic-"));
    try {
      fs.mkdirSync(path.join(fixtureRoot, "logs"));
      fs.mkdirSync(path.join(fixtureRoot, "reports"));
      const workersPath = path.join(fixtureRoot, "workers.json");
      writeJson(workersPath, workers);
      writeJson(path.join(fixtureRoot, "control.json"), { state: Object.keys(workers).length === 0 ? "idle" : "active" });
      const old = new Date(Date.now() - 10_000);
      fs.utimesSync(workersPath, old, old);
      const watcher = startWatcherFixture(fixtureRoot, ["--idle-sec", idleSec]);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_150);
      await watcher.stop();
      const idleEvents = watcherOutput(watcher.stdoutPath).match(/EVENT:idle\b/g) || [];
      if (expectIdle && idleEvents.length !== 1) fail(`watcher ${label} fixture must emit once without spam`);
      if (!expectIdle && idleEvents.length !== 0) fail(`watcher ${label} fixture must not emit idle`);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }

  // AC2 positive A5 retirement transition: active/draining entries block;
  // after the entry is removed and control reaches idle, the latest emitted
  // report event — not an artificially old registry mtime — starts the clock.
  const retirementRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-watcher-idle-retirement-"));
  try {
    const logsDir = path.join(retirementRoot, "logs");
    const reportsDir = path.join(retirementRoot, "reports");
    fs.mkdirSync(logsDir);
    fs.mkdirSync(reportsDir);
    const logPath = path.join(logsDir, "MONO-208-mono-implement-a1.jsonl");
    const reportPath = path.join(reportsDir, "MONO-208-mono-implement.json");
    const workersPath = path.join(retirementRoot, "workers.json");
    const controlPath = path.join(retirementRoot, "control.json");
    writeLog(logPath);
    writeJson(reportPath, reportFor("MONO-208"));
    writeJson(workersPath, registryFor("MONO-208", logPath));
    writeJson(controlPath, { state: "active" });

    const watcher = startWatcherFixture(retirementRoot, ["--idle-sec", "1"]);
    if (!waitForWatcherFixture(() => watcherOutput(watcher.stdoutPath).includes("EVENT:report MONO-208"))) {
      fail("watcher retirement fixture did not emit its initial report event");
    }
    writeJson(controlPath, { state: "draining" });
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(workersPath, old, old);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_150);
    if (watcherOutput(watcher.stdoutPath).includes("EVENT:idle")) {
      fail("watcher active/draining registry entries must block idle");
    }

    writeJson(reportPath, reportFor("MONO-208", "mono-implement", { notes: "event resets idle_since" }));
    const secondReportLine = waitForWatcherFixture(() => {
      const lines = watcherOutput(watcher.stdoutPath).split("\n").filter((line) => line.includes("EVENT:report MONO-208"));
      return lines.length === 2 ? lines[1] : null;
    });
    if (!secondReportLine) fail("watcher retirement fixture did not emit the clock-resetting event");

    writeJson(workersPath, {});
    writeJson(controlPath, { state: "idle" });
    fs.utimesSync(workersPath, old, old);
    const idleLine = waitForWatcherFixture(() =>
      watcherOutput(watcher.stdoutPath).split("\n").find((line) => line.includes("EVENT:idle")),
      4_000
    );
    await watcher.stop();
    if (!idleLine) {
      fail("watcher retirement fixture must emit idle after all entries retire and idle-sec elapses");
    } else if (secondReportLine) {
      const reportAt = Date.parse(secondReportLine.split(" ")[0]);
      const idleAt = Date.parse(idleLine.split(" ")[0]);
      if (idleAt - reportAt < 1_000) {
        fail("watcher idle_since must move forward when any event is emitted");
      }
    }
  } finally {
    fs.rmSync(retirementRoot, { recursive: true, force: true });
  }
}

// MONO-47 — `gate-ack` is additive to the v3 event set. It rides the same
// correlation surface as `report`, and only a FRESH `gates-passed` ack
// suppresses stall/dead: the gate pause of the two-phase dispatch handshake is
// a contracted wait, while a blocked, stale, or malformed ack proves nothing
// and must leave the liveness ladder armed.
// The report override and the suppression branch must both key on BELONGING, so
// that any ack belonging to the attempt makes suppression bounded rather than
// absolute (orchestrator amendment 3 on MONO-47). This replaces an earlier pin
// that required the pause-fresh predicate here: two review rounds asked for
// mutually inverse predicates, each correct about its own failure — requiring a
// current pause let unbounded report suppression bury the ack/report pair
// forever, requiring belonging with an unbounded override called a completed
// worker dead. Bounding it satisfies both, and the post-bound event is a
// consumption boundary, never a healing signal.
//
// A runtime fixture cannot pin the distinguishing state: it needs
// birthtime <= ack.mtime < log.mtime - stall with the log already stale, and
// birthtime cannot be moved backwards portably — macOS pulls it back on an
// earlier utimes, Linux does not — the same limit documented on MONO-333. So it
// is pinned structurally.
function validateGateAckSuppressionPredicate() {
  const watcher = read("scripts/watch-workers.mjs");
  const override = watcher.slice(watcher.indexOf("  const pausedOnAck ="), watcher.indexOf("  const reportStat ="));
  if (!override.includes("ackBelongsToAttempt(gateAck.stat, log)")) {
    fail(
      "watch-workers.mjs: pausedOnAck must key on ackBelongsToAttempt so any belonging ack bounds report suppression (amendment 3); requiring a current pause lets unbounded report suppression bury the ack/report pair"
    );
  }
  if (override.includes("isFreshForLog")) {
    fail(
      "watch-workers.mjs: pausedOnAck must not key on isFreshForLog; a retained crash-window ack still has to bound report suppression after execution advances the log"
    );
  }
  const suppression = watcher.slice(watcher.indexOf("if (gateAck !== null && ackBelongsToAttempt(gateAck.stat, log))"));
  if (!suppression.startsWith("if (gateAck !== null && ackBelongsToAttempt(gateAck.stat, log))")) {
    fail(
      "watch-workers.mjs: the gate-pause suppression branch must use the same belonging predicate as the override, or the two disagree and the pair is neither bounded nor suppressed"
    );
  }

}

function validateWatcherGateAckBehavior() {
  const identity = {
    packVersion: "0.20.1",
    sourceCommit: "a".repeat(40),
    surfaceRevision: 1,
  };
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-watcher-gate-ack-"));
  try {
    const logsDir = path.join(fixtureRoot, "logs");
    const reportsDir = path.join(fixtureRoot, "reports");
    fs.mkdirSync(logsDir);
    fs.mkdirSync(reportsDir);
    const workers = {};
    // Well past 2x the 90s stall threshold, and every writer pid is gone —
    // exactly the shape a codex-cli gate pause leaves behind.
    const staleLog = new Date(Date.now() - 200_000);

    const gateAck = (issue, status, gates = null) => ({
      issue,
      phase: "gate",
      // A blocked ack must carry a blocked gate: the invariant runs both ways,
      // so an all-pass `blocked` ack is a contradiction, not a default.
      gates: gates ?? [
        { gate: "pack identity gate", status: "pass", evidence: "pack-state: identity verified" },
        ...(status === "blocked"
          ? [{ gate: "context seam", status: "blocked", evidence: "snapshot has no seam field" }]
          : []),
      ],
      status,
    });

    const addFixture = (
      issue,
      ack,
      {
        registry = {},
        priorAttempt = false,
        report = null,
        fallbackAck = false,
        stage = "mono-implement",
        attempt = 1,
        omitRegistryGates = false,
      } = {}
    ) => {
      const logPath = path.join(logsDir, `${issue}-${stage}-a${attempt}.jsonl`);
      fs.writeFileSync(logPath, `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`);
      // Age the log FIRST and read its birthtime after: macOS pulls a file's
      // birthtime back to an earlier mtime, so a prior-attempt ack computed
      // from the pre-aging birthtime would land inside the freshness window.
      fs.utimesSync(logPath, staleLog, staleLog);
      const birthMs = fs.statSync(logPath).birthtimeMs;
      // The sandbox fallback the protocol permits: same JSON, under the
      // worker's own worktree instead of the mailbox.
      const worktree = path.join(fixtureRoot, "worktrees", issue);
      if (ack) {
        let ackPath;
        if (fallbackAck) {
          fs.mkdirSync(path.join(worktree, ".orchestrator"), { recursive: true });
          ackPath = path.join(worktree, ".orchestrator", `${issue}-gate-ack-a${attempt}.json`);
        } else {
          ackPath = path.join(reportsDir, `${issue}-gate-ack-a${attempt}.json`);
        }
        fs.writeFileSync(ackPath, `${JSON.stringify(ack, null, 2)}\n`);
        // A prior attempt's ack predates this log file and proves nothing
        // about this writer.
        if (priorAttempt) fs.utimesSync(ackPath, new Date(birthMs - 1_000), new Date(birthMs - 1_000));
      }
      if (report) {
        fs.writeFileSync(path.join(reportsDir, `${issue}-${stage}.json`), `${JSON.stringify(report, null, 2)}\n`);
      }
      const inferredRegistryGates = [
        ...new Set(
          (Array.isArray(ack?.gates) ? ack.gates : [])
            .map((entry) => entry?.gate)
            .filter((gate) => typeof gate === "string" && gate.length > 0)
        ),
      ];
      workers[issue] = {
        transport: "codex-cli",
        stage,
        log: logPath,
        worktree,
        pid: 999_999_999,
        ...identity,
        ...(ack === null || omitRegistryGates
          ? {}
          : {
              gates: inferredRegistryGates.length > 0 ? inferredRegistryGates : ["pack identity gate"],
            }),
        ...registry,
      };
    };

    addFixture("MONO-301", gateAck("MONO-301", "gates-passed"));
    addFixture("MONO-302", gateAck("MONO-302", "blocked"));
    addFixture("MONO-303", gateAck("MONO-303", "gates-passed"), { priorAttempt: true });
    addFixture("MONO-304", gateAck("MONO-304", "gates-passed"), {
      registry: { transport: "claude-code-desktop" },
    });
    addFixture("MONO-305", { ...gateAck("MONO-305", "gates-passed"), phase: "execution" });
    addFixture("MONO-306", gateAck("MONO-306", "gates-passed"), {
      report: { issue: "MONO-306", stage: "mono-implement", status: "implemented-needs-preflight", ...identity },
    });
    // The ack is the only evidence the gates ran, so an ack that skips or
    // contradicts that evidence must neither deliver nor suppress.
    addFixture("MONO-307", { issue: "MONO-307", phase: "gate", status: "gates-passed" });
    addFixture("MONO-308", gateAck("MONO-308", "gates-passed", []));
    addFixture(
      "MONO-309",
      gateAck("MONO-309", "gates-passed", [
        { gate: "pack identity gate", status: "pass", evidence: "pack-state: identity verified" },
        { gate: "context seam", status: "blocked", evidence: "snapshot has no seam field" },
      ])
    );
    addFixture("MONO-310", gateAck("MONO-310", "gates-passed", [{ gate: "pack identity gate", status: "pass" }]));
    // Mirror of MONO-309: `blocked` over gates that all passed is consumed as a
    // real refusal and strands a dispatch whose gates actually passed.
    addFixture(
      "MONO-331",
      gateAck("MONO-331", "blocked", [
        { gate: "pack identity gate", status: "pass", evidence: "pack-state: identity verified" },
      ])
    );
    // A repeated gate name could stand in for an omitted one under a coverage
    // check that counts entries instead of comparing the set.
    addFixture(
      "MONO-316",
      gateAck("MONO-316", "gates-passed", [
        { gate: "pack identity gate", status: "pass", evidence: "pack-state: identity verified" },
        { gate: "pack identity gate", status: "pass", evidence: "pack-state: identity verified" },
      ])
    );
    // The documented sandbox fallback must be observed, or a worker that
    // acked from its worktree reads as dead during a contracted wait.
    addFixture("MONO-311", gateAck("MONO-311", "gates-passed"), { fallbackAck: true });
    // A consumed ack no longer correlates: the rename at resume time is what
    // re-arms the liveness ladder for the execution phase.
    addFixture("MONO-312", null);
    fs.writeFileSync(
      path.join(reportsDir, "MONO-312-gate-ack-a1.applied.json"),
      `${JSON.stringify(gateAck("MONO-312", "gates-passed"), null, 2)}\n`
    );
    // A prior attempt's mailbox ack must not shadow the fresh fallback ack of
    // the worker that is paused right now.
    addFixture("MONO-313", gateAck("MONO-313", "gates-passed"), { fallbackAck: true });
    const shadowingAckPath = path.join(reportsDir, "MONO-313-gate-ack-a1.json");
    fs.writeFileSync(shadowingAckPath, `${JSON.stringify(gateAck("MONO-313", "blocked"), null, 2)}\n`);
    const shadowStale = new Date(fs.statSync(workers["MONO-313"].log).birthtimeMs - 1_000);
    fs.utimesSync(shadowingAckPath, shadowStale, shadowStale);
    // Suppression demands the same registry correlation delivery does: a
    // foreign-stage entry can neither deliver its ack nor silence liveness.
    addFixture("MONO-314", gateAck("MONO-314", "gates-passed"), {
      registry: { stage: "mono-preflight" },
    });
    // Registry and log can also AGREE on a stage that has no gate phase at
    // all: preflight and ship dispatches carry no lifecycle move, so an ack
    // there is spurious however well-formed it looks.
    addFixture("MONO-315", gateAck("MONO-315", "gates-passed"), { stage: "mono-preflight" });

    // MONO-49 U4 — the durable dispatched-gate registry contract. The watcher
    // must compare the ack names with `registryEntry.gates` at its shared read
    // boundary, so the same result controls both delivery and suppression.
    const packGate = { gate: "pack identity gate", status: "pass", evidence: "pack-state: identity verified" };
    const seamGate = { gate: "context seam", status: "pass", evidence: "project-first package complete" };
    const blockedSeamGate = { gate: "context seam", status: "blocked", evidence: "snapshot incomplete" };
    const reviewGate = { gate: "approval review", status: "pass", evidence: "review ready" };
    const blockedReviewGate = { gate: "approval review", status: "blocked", evidence: "approval missing" };
    const dispatchedGates = ["pack identity gate", "context seam"];
    // (a) exact match.
    addFixture("MONO-336", gateAck("MONO-336", "gates-passed", [packGate, seamGate]), {
      registry: { gates: dispatchedGates },
    });
    // (b) exact match in another order.
    addFixture("MONO-337", gateAck("MONO-337", "gates-passed", [seamGate, packGate]), {
      registry: { gates: dispatchedGates },
    });
    // (c-e) subset, extra name, and foreign name.
    addFixture("MONO-338", gateAck("MONO-338", "gates-passed", [packGate]), {
      registry: { gates: dispatchedGates },
    });
    addFixture("MONO-339", gateAck("MONO-339", "gates-passed", [packGate, seamGate]), {
      registry: { gates: ["pack identity gate"] },
    });
    addFixture("MONO-340", gateAck("MONO-340", "gates-passed", [packGate, reviewGate]), {
      registry: { gates: dispatchedGates },
    });
    // (f-j) malformed present registry values fail closed.
    addFixture("MONO-341", gateAck("MONO-341", "gates-passed", [packGate]), {
      registry: { gates: [] },
    });
    addFixture("MONO-342", gateAck("MONO-342", "gates-passed", [packGate]), {
      registry: { gates: ["pack identity gate", "pack identity gate"] },
    });
    addFixture("MONO-343", gateAck("MONO-343", "gates-passed", [packGate]), {
      registry: { gates: "pack identity gate" },
    });
    addFixture("MONO-344", gateAck("MONO-344", "gates-passed", [packGate]), {
      registry: { gates: ["pack identity gate", 1] },
    });
    addFixture("MONO-345", gateAck("MONO-345", "gates-passed", [packGate]), {
      registry: { gates: ["pack identity gate", ""] },
    });
    // (k) An ack beside a gates-less registry entry fails closed. There is no
    // legacy form-only branch.
    addFixture("MONO-346", gateAck("MONO-346", "gates-passed", [packGate]), {
      omitRegistryGates: true,
    });
    // (m) a prior attempt's tombstone must not hide a valid current attempt.
    addFixture("MONO-347", gateAck("MONO-347", "gates-passed", [seamGate, packGate]), {
      registry: { gates: dispatchedGates },
      attempt: 2,
    });
    fs.writeFileSync(
      path.join(reportsDir, "MONO-347-gate-ack-a1.applied.json"),
      `${JSON.stringify(gateAck("MONO-347", "gates-passed", [packGate]), null, 2)}\n`
    );
    // (n) a blocked ack may honestly report a non-empty subset of the gates
    // dispatched for this attempt.
    addFixture("MONO-348", gateAck("MONO-348", "blocked", [blockedSeamGate]), {
      registry: { gates: dispatchedGates },
    });
    // Reports have no attempt number. A late superseded report can look fresh
    // beside the current blocked ack, so the watcher must surface BOTH and
    // leave attempt reconciliation to the orchestrator consumer.
    addFixture("MONO-364", gateAck("MONO-364", "blocked", [blockedSeamGate]), {
      registry: { gates: dispatchedGates },
      report: {
        issue: "MONO-364",
        stage: "mono-implement",
        status: "blocked",
        ...identity,
      },
    });
    // (o) blocked remains fail-closed when it names a foreign gate.
    addFixture("MONO-349", gateAck("MONO-349", "blocked", [blockedReviewGate]), {
      registry: { gates: dispatchedGates },
    });
    // No ack means there is no gate contract to consume. A gates-less entry
    // keeps the ordinary liveness behavior rather than entering a discriminator.
    addFixture("MONO-352", null);

    // The fallback ack path is inside the worker's own worktree, so it is
    // worker-controlled. Anything that is not a bounded regular file must be
    // rejected BEFORE it is opened: the watcher is synchronous, so a FIFO would
    // block it forever and a device would read without bound, silently ending
    // liveness monitoring for every worker at once.
    const hostileFallback = (issue, build) => {
      addFixture(issue, null, { registry: { gates: ["pack identity gate"] } });
      const ackDir = path.join(fixtureRoot, "worktrees", issue, ".orchestrator");
      fs.mkdirSync(ackDir, { recursive: true });
      build(path.join(ackDir, `${issue}-gate-ack-a1.json`));
    };
    // A symlink pointing at a perfectly valid ack is still not a regular file.
    const realAckPath = path.join(fixtureRoot, "valid-ack.json");
    fs.writeFileSync(realAckPath, `${JSON.stringify(gateAck("MONO-317", "gates-passed"), null, 2)}\n`);
    hostileFallback("MONO-317", (ackPath) => fs.symlinkSync(realAckPath, ackPath));
    // Oversized: a real ack is a handful of gate entries.
    hostileFallback("MONO-318", (ackPath) => {
      const padded = gateAck("MONO-318", "gates-passed");
      padded.gates[0].evidence = "x".repeat(128 * 1024);
      fs.writeFileSync(ackPath, JSON.stringify(padded));
    });
    // The one that would actually hang a synchronous reader.
    let fifoIssue = null;
    if (spawnSync("mkfifo", ["--version"], { encoding: "utf8" }).error === undefined) {
      fifoIssue = "MONO-319";
      hostileFallback(fifoIssue, (ackPath) => spawnSync("mkfifo", [ackPath]));
      if (!fs.existsSync(path.join(fixtureRoot, "worktrees", fifoIssue, ".orchestrator", `${fifoIssue}-gate-ack-a1.json`))) {
        fifoIssue = null;
      }
    }

    // The failure round 8 named: a superseded attempt that is still alive
    // writes its ack AFTER its successor's log was born, so every timestamp
    // test accepts it. A retry carries the same gate names, so set equality
    // downstream would not catch it either — the orchestrator would apply the
    // moves and resume attempt 2 on gates only attempt 1 ever ran. Only the
    // attempt number in the path can tell the two writers apart.
    const lateAckIssue = "MONO-320";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const supersededLog = path.join(logsDir, `${lateAckIssue}-mono-implement-a1.jsonl`);
      const currentLog = path.join(logsDir, `${lateAckIssue}-mono-implement-a2.jsonl`);
      fs.writeFileSync(supersededLog, logLine);
      fs.writeFileSync(currentLog, logLine);
      const older = new Date(Date.now() - 300_000);
      fs.utimesSync(supersededLog, older, older);
      fs.utimesSync(currentLog, staleLog, staleLog);
      // Written now: newer than attempt 2's log birthtime, so freshness alone
      // would take it.
      fs.writeFileSync(
        path.join(reportsDir, `${lateAckIssue}-gate-ack-a1.json`),
        `${JSON.stringify(gateAck(lateAckIssue, "gates-passed"), null, 2)}\n`
      );
      workers[lateAckIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: currentLog,
        worktree: path.join(fixtureRoot, "worktrees", lateAckIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // A resume that failed after the moves landed: the ack is never consumed,
    // and freshness against the log alone would suppress liveness forever
    // because both its operands are fixed file timestamps. The wall-clock
    // bound is what re-arms the ladder on a parked Issue.
    const stalePauseIssue = "MONO-321";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${stalePauseIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      const longAgo = new Date(Date.now() - 900_000);
      fs.utimesSync(logPath, longAgo, longAgo);
      const ackPath = path.join(reportsDir, `${stalePauseIssue}-gate-ack-a1.json`);
      fs.writeFileSync(ackPath, `${JSON.stringify(gateAck(stalePauseIssue, "gates-passed"), null, 2)}\n`);
      // Newer than the log's birthtime, so isFreshForLog still accepts it —
      // only the wall-clock bound (4x the 90s stall threshold) rejects it.
      const pausedAt = new Date(Date.now() - 700_000);
      fs.utimesSync(ackPath, pausedAt, pausedAt);
      workers[stalePauseIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", stalePauseIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // A forged future date must not buy suppression: the worker sets its own
    // timestamps on the fallback path, and a negative age would otherwise slip
    // under a ceiling-only bound and restore unbounded silence.
    const futureAckIssue = "MONO-322";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${futureAckIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      fs.utimesSync(logPath, staleLog, staleLog);
      const ackPath = path.join(reportsDir, `${futureAckIssue}-gate-ack-a1.json`);
      fs.writeFileSync(ackPath, `${JSON.stringify(gateAck(futureAckIssue, "gates-passed"), null, 2)}\n`);
      const future = new Date(Date.now() + 3_600_000);
      fs.utimesSync(ackPath, future, future);
      workers[futureAckIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", futureAckIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // Two fresh candidates tying on mtime, disagreeing on status: a leftover
    // mailbox `gates-passed` must not shadow the current fallback `blocked`.
    // Ambiguity fails closed — neither is selected.
    const tieIssue = "MONO-323";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${tieIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      fs.utimesSync(logPath, staleLog, staleLog);
      const mailboxAck = path.join(reportsDir, `${tieIssue}-gate-ack-a1.json`);
      const fallbackDir = path.join(fixtureRoot, "worktrees", tieIssue, ".orchestrator");
      fs.mkdirSync(fallbackDir, { recursive: true });
      const fallbackAck = path.join(fallbackDir, `${tieIssue}-gate-ack-a1.json`);
      fs.writeFileSync(mailboxAck, `${JSON.stringify(gateAck(tieIssue, "gates-passed"), null, 2)}\n`);
      fs.writeFileSync(fallbackAck, `${JSON.stringify(gateAck(tieIssue, "blocked"), null, 2)}\n`);
      const sameInstant = new Date(Date.now() - 5_000);
      fs.utimesSync(mailboxAck, sameInstant, sameInstant);
      fs.utimesSync(fallbackAck, sameInstant, sameInstant);
      workers[tieIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", tieIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // Near-future, inside the old one-stall tolerance: a worker must not be
    // able to mint extra suppression for itself by nudging its own mtime.
    const nearFutureIssue = "MONO-324";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${nearFutureIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      fs.utimesSync(logPath, staleLog, staleLog);
      const ackPath = path.join(reportsDir, `${nearFutureIssue}-gate-ack-a1.json`);
      fs.writeFileSync(ackPath, `${JSON.stringify(gateAck(nearFutureIssue, "gates-passed"), null, 2)}\n`);
      const nearFuture = new Date(Date.now() + 30_000);
      fs.utimesSync(ackPath, nearFuture, nearFuture);
      workers[nearFutureIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", nearFutureIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // The unselected leftover after consumption: the fallback ack was the one
    // renamed, and the mailbox copy stayed behind. A tombstone for the attempt
    // must stop it becoming current on the next scan.
    const leftoverIssue = "MONO-325";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${leftoverIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      fs.utimesSync(logPath, staleLog, staleLog);
      const fallbackDir = path.join(fixtureRoot, "worktrees", leftoverIssue, ".orchestrator");
      fs.mkdirSync(fallbackDir, { recursive: true });
      // Consumed: the selected artifact was renamed in the fallback location.
      fs.writeFileSync(
        path.join(fallbackDir, `${leftoverIssue}-gate-ack-a1.applied.json`),
        `${JSON.stringify(gateAck(leftoverIssue, "gates-passed"), null, 2)}\n`
      );
      // Left behind, still perfectly valid and fresh.
      fs.writeFileSync(
        path.join(reportsDir, `${leftoverIssue}-gate-ack-a1.json`),
        `${JSON.stringify(gateAck(leftoverIssue, "gates-passed"), null, 2)}\n`
      );
      workers[leftoverIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", leftoverIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // A superseded attempt's report must not hide the successor's valid ack.
    // Reports carry no attempt number, so an older report beside a newer ack
    // is exactly that shape: the ack still has to be delivered.
    const staleReportIssue = "MONO-327";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${staleReportIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      fs.utimesSync(logPath, staleLog, staleLog);
      const reportPath = path.join(reportsDir, `${staleReportIssue}-mono-implement.json`);
      fs.writeFileSync(
        reportPath,
        `${JSON.stringify({ issue: staleReportIssue, stage: "mono-implement", status: "implemented-needs-preflight", ...identity }, null, 2)}\n`
      );
      const ackPath = path.join(reportsDir, `${staleReportIssue}-gate-ack-a1.json`);
      fs.writeFileSync(ackPath, `${JSON.stringify(gateAck(staleReportIssue, "gates-passed"), null, 2)}\n`);
      // Report older than the ack; both still fresh against the log.
      const reportAt = new Date(Date.now() - 60_000);
      fs.utimesSync(reportPath, reportAt, reportAt);
      workers[staleReportIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", staleReportIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // A stuck worker touching its own ack must not buy another window: the
    // deadline runs on the pause, not on the ack's mtime.
    const renewedAckIssue = "MONO-328";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${renewedAckIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      const longQuiet = new Date(Date.now() - 900_000);
      fs.utimesSync(logPath, longQuiet, longQuiet);
      // Freshly touched, as a worker renewing its deadline would.
      fs.writeFileSync(
        path.join(reportsDir, `${renewedAckIssue}-gate-ack-a1.json`),
        `${JSON.stringify(gateAck(renewedAckIssue, "gates-passed"), null, 2)}\n`
      );
      workers[renewedAckIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", renewedAckIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // A valid blocked ack is spent once consumed, and its consumption state has
    // to be one the watcher recognises or it redelivers on every restart.
    const blockedConsumedIssue = "MONO-329";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${blockedConsumedIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      fs.utimesSync(logPath, staleLog, staleLog);
      fs.writeFileSync(
        path.join(reportsDir, `${blockedConsumedIssue}-gate-ack-a1.blocked.json`),
        `${JSON.stringify(gateAck(blockedConsumedIssue, "blocked"), null, 2)}\n`
      );
      fs.writeFileSync(
        path.join(reportsDir, `${blockedConsumedIssue}-gate-ack-a1.json`),
        `${JSON.stringify(gateAck(blockedConsumedIssue, "blocked"), null, 2)}\n`
      );
      workers[blockedConsumedIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", blockedConsumedIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate", "context seam"],
      };
    }

    // A report beside an unconsumed gates-passed ack must not silence the
    // worker past the gate-pause bound: that pairing needs reconciliation, and
    // reconciliation needs a liveness signal to trigger it.
    const maskedIssue = "MONO-330";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${maskedIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      const longQuiet = new Date(Date.now() - 900_000);
      fs.utimesSync(logPath, longQuiet, longQuiet);
      fs.writeFileSync(
        path.join(reportsDir, `${maskedIssue}-gate-ack-a1.json`),
        `${JSON.stringify(gateAck(maskedIssue, "gates-passed"), null, 2)}\n`
      );
      fs.writeFileSync(
        path.join(reportsDir, `${maskedIssue}-mono-implement.json`),
        `${JSON.stringify({ issue: maskedIssue, stage: "mono-implement", status: "implemented-needs-preflight", ...identity }, null, 2)}\n`
      );
      workers[maskedIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", maskedIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // Greptile P1: a superseded attempt that is still appending outranks the
    // current one in collectLatestLogs, so the current attempt's ack must be
    // read against the log the REGISTRY names or a contracted pause reads as
    // death.
    const supersededNewerIssue = "MONO-332";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const supersededLog = path.join(logsDir, `${supersededNewerIssue}-mono-implement-a1.jsonl`);
      const currentLog = path.join(logsDir, `${supersededNewerIssue}-mono-implement-a2.jsonl`);
      fs.writeFileSync(supersededLog, logLine);
      fs.writeFileSync(currentLog, logLine);
      // The zombie's log is NEWER, so collectLatestLogs picks it.
      const zombieTouch = new Date(Date.now() - 100_000);
      const currentQuiet = new Date(Date.now() - 200_000);
      fs.utimesSync(currentLog, currentQuiet, currentQuiet);
      fs.utimesSync(supersededLog, zombieTouch, zombieTouch);
      fs.writeFileSync(
        path.join(reportsDir, `${supersededNewerIssue}-gate-ack-a2.json`),
        `${JSON.stringify(gateAck(supersededNewerIssue, "gates-passed"), null, 2)}\n`
      );
      workers[supersededNewerIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: currentLog,
        worktree: path.join(fixtureRoot, "worktrees", supersededNewerIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // The crash window survives execution: an unconsumed ack must still be
    // DELIVERED after the resumed worker advanced the log past it, so the
    // consumer sees the ack/report pair and reconciles.
    //
    // Portability matters more than realism in how this is staged. The
    // distinction under test needs birthtime <= ack.mtime < log.mtime - stall,
    // and a real 90s gap cannot be manufactured by backdating: macOS pulls
    // st_birthtime back when an earlier mtime is set, Linux does not, and where
    // btime is unsupported Node falls back to ctime — which utimes bumps to now.
    // Backdating the log therefore made the ack predate birthtime on CI only.
    // Advancing the log FORWARD instead is symmetric on both platforms: the ack
    // is written after the log is created, so it always post-dates birthtime,
    // and the log's mtime is pushed beyond it by more than the stall threshold.
    const survivesExecutionIssue = "MONO-333";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const logPath = path.join(logsDir, `${survivesExecutionIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      // Advance the log BEFORE writing the ack. utimes bumps ctime, and where
      // btime is unsupported Node reports ctime as birthtime — so writing the
      // ack last keeps ack.mtime >= birthtime under either interpretation.
      const advanced = new Date(Date.now() + 200_000);
      fs.utimesSync(logPath, advanced, advanced);
      const ackPath = path.join(reportsDir, `${survivesExecutionIssue}-gate-ack-a1.json`);
      fs.writeFileSync(ackPath, `${JSON.stringify(gateAck(survivesExecutionIssue, "gates-passed"), null, 2)}\n`);
      workers[survivesExecutionIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", survivesExecutionIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // Greptile: a superseded attempt that keeps writing must not hold the
    // current attempt's gate pause open. Its log is newer and gets selected,
    // but the pause bound is measured on the registry's attempt log, which has
    // been quiet far past the bound — so liveness re-arms.
    const zombieHoldsPauseIssue = "MONO-334";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      const zombieLog = path.join(logsDir, `${zombieHoldsPauseIssue}-mono-implement-a1.jsonl`);
      const pausedLog = path.join(logsDir, `${zombieHoldsPauseIssue}-mono-implement-a2.jsonl`);
      fs.writeFileSync(pausedLog, logLine);
      fs.writeFileSync(zombieLog, logLine);
      const pausedQuiet = new Date(Date.now() - 900_000);
      fs.utimesSync(pausedLog, pausedQuiet, pausedQuiet);
      // The zombie is ACTIVELY writing — inside the stall window. That is the
      // case that reproduces the defect: driven from the mtime-selected log the
      // scan takes the healthy early return and the paused attempt's expired
      // bound is never reached. Staging the zombie as merely "older than the
      // threshold" could not reproduce it, which is what the review caught.
      const zombieTouch = new Date(Date.now() - 30_000);
      fs.utimesSync(zombieLog, zombieTouch, zombieTouch);
      // Ack written after both utimes so it post-dates birthtime under either
      // the real-btime or the ctime-fallback reading.
      fs.writeFileSync(
        path.join(reportsDir, `${zombieHoldsPauseIssue}-gate-ack-a2.json`),
        `${JSON.stringify(gateAck(zombieHoldsPauseIssue, "gates-passed"), null, 2)}\n`
      );
      workers[zombieHoldsPauseIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: pausedLog,
        worktree: path.join(fixtureRoot, "worktrees", zombieHoldsPauseIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    // A leftover ack from a PRIOR attempt must not switch off report
    // suppression: the completed worker below has a valid fresh report and must
    // not be called dead because a stale ack file is still lying around.
    const staleAckIssue = "MONO-335";
    {
      const logLine = `${JSON.stringify({ type: "thread.started", thread_id: "fixture" })}\n`;
      // Ack first and explicitly old, so it predates the log's birthtime under
      // either the real-btime or the ctime-fallback reading.
      const ackPath = path.join(reportsDir, `${staleAckIssue}-gate-ack-a1.json`);
      fs.writeFileSync(ackPath, `${JSON.stringify(gateAck(staleAckIssue, "gates-passed"), null, 2)}\n`);
      const ackAt = new Date(Date.now() - 500_000);
      fs.utimesSync(ackPath, ackAt, ackAt);
      const logPath = path.join(logsDir, `${staleAckIssue}-mono-implement-a1.jsonl`);
      fs.writeFileSync(logPath, logLine);
      fs.utimesSync(logPath, staleLog, staleLog);
      // Report written last: the stage completed normally.
      fs.writeFileSync(
        path.join(reportsDir, `${staleAckIssue}-mono-implement.json`),
        `${JSON.stringify({ issue: staleAckIssue, stage: "mono-implement", status: "implemented-needs-preflight", ...identity }, null, 2)}\n`
      );
      workers[staleAckIssue] = {
        transport: "codex-cli",
        stage: "mono-implement",
        log: logPath,
        worktree: path.join(fixtureRoot, "worktrees", staleAckIssue),
        pid: 999_999_999,
        ...identity,
        gates: ["pack identity gate"],
      };
    }

    fs.writeFileSync(path.join(fixtureRoot, "workers.json"), `${JSON.stringify(workers, null, 2)}\n`);
    fs.writeFileSync(path.join(fixtureRoot, "control.json"), `${JSON.stringify({ state: "active" }, null, 2)}\n`);

    const runOnce = () =>
      spawnSync(
        process.execPath,
        [path.join(root, "scripts", "watch-workers.mjs"), "--root", fixtureRoot, "--stall-sec", "90", "--idle-sec", "30", "--once"],
        // The timeout is the regression detector for the FIFO fixture: without
        // the pre-read lstat guard this scan never returns at all.
        { cwd: root, encoding: "utf8", timeout: 60_000 }
      );

    const result = runOnce();
    if (result.signal === "SIGTERM" || result.error?.code === "ETIMEDOUT") {
      fail(
        "watcher scan never returned: a worker-controlled fallback ack path must be rejected by lstat before it is opened"
      );
      return;
    }
    if (result.status !== 0) {
      fail(`watcher gate-ack fixtures failed to run: ${result.stderr || `exit ${result.status}`}`);
      return;
    }
    const stdout = result.stdout || "";

    // Hostile fallback shapes deliver nothing and suppress nothing.
    for (const issue of ["MONO-317", "MONO-318", ...(fifoIssue ? [fifoIssue] : [])]) {
      if (stdout.includes(`EVENT:gate-ack ${issue}`)) {
        fail(`watcher must not deliver a gate-ack from a non-regular or oversized fallback path (${issue})`);
      }
      if (!stdout.includes(`EVENT:dead ${issue}`)) {
        fail(`watcher must still emit dead when the only fallback ack is not a bounded regular file (${issue})`);
      }
    }

    for (const [issue, label] of [
      ["MONO-301", "gates-passed"],
      ["MONO-302", "blocked"],
      ["MONO-311", "worktree-fallback"],
      ["MONO-327", "ack newer than a superseded attempt's report"],
      ["MONO-332", "ack on the registry log while a superseded log is newer"],
      ["MONO-333", "unconsumed ack after execution advanced the log"],
      ["MONO-306", "unconsumed ack beside a completed stage report"],
      ["MONO-336", "registry gate names exact match"],
      ["MONO-337", "registry gate names exact match in another order"],
      ["MONO-347", "current attempt despite prior-attempt tombstone"],
      ["MONO-348", "blocked ack with a non-empty registry-gate subset"],
      ["MONO-364", "blocked ack beside a potentially superseded shared-path report"],
    ]) {
      if (!stdout.includes(`EVENT:gate-ack ${issue}`)) {
        fail(`watcher ${label} gate-ack fixture must emit a gate-ack event`);
      }
    }
    for (const [issue, label] of [
      ["MONO-303", "prior-attempt"],
      ["MONO-304", "non-codex"],
      ["MONO-305", "malformed-phase"],
      ["MONO-307", "missing-gates-array"],
      ["MONO-308", "empty-gates-array"],
      ["MONO-309", "gates-passed-over-a-blocked-gate"],
      ["MONO-310", "gate-entry-without-evidence"],
      ["MONO-312", "consumed-ack"],
      ["MONO-314", "foreign-stage-registry"],
      ["MONO-315", "no-gate-phase-stage"],
      ["MONO-316", "duplicate-gate-name"],
      ["MONO-320", "late-ack-from-a-superseded-attempt"],
      ["MONO-313", "two-files-for-one-attempt"],
      ["MONO-322", "future-dated"],
      ["MONO-324", "near-future"],
      ["MONO-323", "ambiguous-tie"],
      ["MONO-325", "leftover-candidate-after-consumption"],
      ["MONO-329", "consumed-blocked-ack"],
      ["MONO-331", "blocked-ack-over-all-passing-gates"],
      ["MONO-338", "registry-gates-subset"],
      ["MONO-339", "registry-gates-extra-name"],
      ["MONO-340", "registry-gates-foreign-name"],
      ["MONO-341", "registry-gates-empty-array"],
      ["MONO-342", "registry-gates-duplicates"],
      ["MONO-343", "registry-gates-non-array"],
      ["MONO-344", "registry-gates-non-string-element"],
      ["MONO-345", "registry-gates-empty-string"],
      ["MONO-349", "blocked ack with a foreign registry gate"],
      ["MONO-346", "gates-less registry entry with an ack"],
      ["MONO-352", "gates-less registry entry without an ack"],
    ]) {
      if (stdout.includes(`EVENT:gate-ack ${issue}`)) {
        fail(`watcher ${label} gate-ack fixture must stay silent`);
      }
    }

    // The event must identify WHICH artifact was validated: mailbox and
    // fallback share a filename, and MONO-313 has both present and disagreeing.
    const ackLineFor = (issue) =>
      stdout.split("\n").find((line) => line.includes(`EVENT:gate-ack ${issue}`)) ?? "";
    for (const [issue, expectedDir] of [
      ["MONO-301", path.join(fixtureRoot, "reports")],
      ["MONO-311", path.join(fixtureRoot, "worktrees", "MONO-311", ".orchestrator")],
    ]) {
      const line = ackLineFor(issue);
      if (!line.includes(path.join(expectedDir, `${issue}-gate-ack-a1.json`))) {
        fail(
          `watcher gate-ack event for ${issue} must name the full path of the artifact it validated, got: ${JSON.stringify(line)}`
        );
      }
    }

    // A healthy gate pause must not read as death, wherever the ack landed.
    for (const [issue, label] of [
      ["MONO-335", "completed worker whose only ack is from a prior attempt"],
      ["MONO-332", "registry log while a superseded log is newer"],
      ["MONO-301", "mailbox"],
      ["MONO-311", "worktree fallback"],
      ["MONO-302", "valid blocked ack awaiting its stage report"],
      ["MONO-348", "valid blocked-subset ack awaiting its stage report"],
    ]) {
      if (new RegExp(`EVENT:(stall|dead) ${issue}\\b`).test(stdout)) {
        fail(`a fresh usable gate-ack in the ${label} must suppress stall and dead for that worker`);
      }
    }
    // Everything that is not a healthy pause keeps the liveness ladder armed.
    for (const [issue, label] of [
      ["MONO-303", "prior-attempt ack"],
      ["MONO-305", "malformed ack"],
      ["MONO-307", "gates-passed ack with no gates array"],
      ["MONO-308", "gates-passed ack with an empty gates array"],
      ["MONO-309", "gates-passed ack over a blocked gate"],
      ["MONO-331", "blocked ack over gates that all passed"],
      ["MONO-310", "gate entry with no evidence"],
      ["MONO-312", "consumed ack"],
      // An ack the watcher would not deliver must not silence liveness either.
      ["MONO-304", "non-codex entry's ack"],
      ["MONO-314", "ack under a foreign-stage registry entry"],
      ["MONO-315", "ack beside a stage that has no gate phase"],
      ["MONO-316", "ack repeating one gate name"],
      ["MONO-320", "late ack written by a superseded attempt"],
      ["MONO-321", "gate-ack whose pause outlived the suppression bound"],
      ["MONO-328", "freshly touched ack whose pause outlived the bound"],
      ["MONO-334", "zombie log holding open an expired gate pause"],
      ["MONO-330", "report masking an unconsumed ack past the gate-pause bound"],
      ["MONO-322", "future-dated gate-ack"],
      ["MONO-313", "two ack files for one attempt"],
      ["MONO-323", "ambiguous tie between mailbox and fallback acks"],
      ["MONO-324", "near-future gate-ack"],
      ["MONO-325", "leftover ack candidate whose attempt was already consumed"],
      ["MONO-338", "ack whose names are a subset of registry gates"],
      ["MONO-339", "ack with a gate beyond the registry gates"],
      ["MONO-340", "ack with a foreign gate name"],
      ["MONO-341", "present empty registry gates array"],
      ["MONO-342", "present registry gates array with duplicates"],
      ["MONO-343", "present non-array registry gates value"],
      ["MONO-344", "present registry gates array with a non-string element"],
      ["MONO-345", "present registry gates array with an empty string"],
      ["MONO-349", "blocked ack with a foreign registry gate"],
      ["MONO-346", "gates-less registry entry with an ack"],
      ["MONO-352", "gates-less registry entry without an ack"],
    ]) {
      if (!stdout.includes(`EVENT:dead ${issue}`)) {
        fail(`watcher must still emit dead for a worker whose only evidence is a ${label}`);
      }
    }
    // v3 semantics intact: the report event still fires next to a gate-ack.
    if (!stdout.includes("EVENT:report MONO-306") || !stdout.includes("EVENT:report MONO-364")) {
      fail("gate-ack must not suppress the v3 report event for the same worker");
    }

    // At-least-once across watcher restarts, same rule as `report`.
    const restart = runOnce();
    if (restart.status !== 0 || !restart.stdout.includes("EVENT:gate-ack MONO-301")) {
      fail("watcher restart must re-emit the current gate-ack version once");
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function validateCompactionContract() {
  const hookRelativePath = "templates/orchestrator-compaction-hook.sh";
  const instructionsRelativePath = "templates/compact-instructions.md";

  if (!exists(hookRelativePath)) {
    fail(`Missing ${hookRelativePath}`);
  } else {

    const hookPath = path.join(root, hookRelativePath);
    const runHook = (fixtureRoot, trigger, env = {}) =>
      spawnSync("bash", [hookPath, fixtureRoot], {
        cwd: root,
        encoding: "utf8",
        input: `${JSON.stringify({ trigger })}\n`,
        env: { ...process.env, ...env },
      });
    const parseHookOutput = (label, result) => {
      if (result.status !== 0) {
        fail(`${label} exited ${result.status}: ${result.stderr || result.error?.message || "unknown error"}`);
        return null;
      }
      try {
        return JSON.parse((result.stdout || "").trim());
      } catch {
        fail(`${label} did not emit JSON: ${JSON.stringify(result.stdout)}`);
        return null;
      }
    };
    const withFixtureRoot = (label, callback) => {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mono-compaction-${label}-`));
      try {
        callback(fixtureRoot);
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    };

    withFixtureRoot("manual", (fixtureRoot) => {
      const output = parseHookOutput("manual compaction fixture", runHook(fixtureRoot, "manual"));
      if (output && Object.keys(output).length !== 0) fail("manual compaction must be allowed");
    });

    withFixtureRoot("missing", (fixtureRoot) => {
      const output = parseHookOutput("missing sentinel fixture", runHook(fixtureRoot, "auto"));
      if (output?.decision !== "block" || typeof output.reason !== "string" || output.reason.length === 0) {
        fail("automatic compaction without a sentinel must block with a reason");
      }
    });

    withFixtureRoot("missing-root", (fixtureRoot) => {
      const missingRoot = path.join(fixtureRoot, "not-created");
      const output = parseHookOutput("missing orchestrator root fixture", runHook(missingRoot, "auto"));
      if (output?.decision !== "block" || !output.reason?.includes("does not exist")) {
        fail("automatic compaction with a missing orchestrator root must block with an explicit reason");
      }
    });

    withFixtureRoot("fresh", (fixtureRoot) => {
      fs.writeFileSync(path.join(fixtureRoot, ".compact-block-count"), "2\n");
      fs.writeFileSync(path.join(fixtureRoot, "compaction-safe"), "");
      const now = new Date();
      fs.utimesSync(path.join(fixtureRoot, "compaction-safe"), now, now);
      const output = parseHookOutput("fresh sentinel fixture", runHook(fixtureRoot, "auto"));
      if (output && Object.keys(output).length !== 0) fail("automatic compaction at a fresh sentinel must be allowed");
      if (fs.readFileSync(path.join(fixtureRoot, ".compact-block-count"), "utf8").trim() !== "0") {
        fail("fresh-sentinel allow must reset the deferral counter");
      }
    });

    withFixtureRoot("stale", (fixtureRoot) => {
      fs.writeFileSync(path.join(fixtureRoot, "compaction-safe"), "");
      const stale = new Date(Date.now() - 301_000);
      fs.utimesSync(path.join(fixtureRoot, "compaction-safe"), stale, stale);
      const output = parseHookOutput("stale sentinel fixture", runHook(fixtureRoot, "auto"));
      if (output?.decision !== "block") fail("automatic compaction at a stale sentinel must block");
      if (fs.readFileSync(path.join(fixtureRoot, ".compact-block-count"), "utf8").trim() !== "1") {
        fail("stale-sentinel block must increment the deferral counter");
      }
    });

    withFixtureRoot("forced", (fixtureRoot) => {
      fs.writeFileSync(path.join(fixtureRoot, ".compact-block-count"), "3\n");
      const output = parseHookOutput("forced allow fixture", runHook(fixtureRoot, "auto"));
      if (output && Object.keys(output).length !== 0) fail("the fourth automatic attempt must be forcibly allowed");
      if (fs.readFileSync(path.join(fixtureRoot, ".compact-block-count"), "utf8").trim() !== "0") {
        fail("forced allow must reset the deferral counter");
      }
    });

    for (const style of ["bsd", "gnu"]) {
      withFixtureRoot(`mtime-${style}`, (fixtureRoot) => {
        const binDir = path.join(fixtureRoot, "bin");
        const statLog = path.join(fixtureRoot, "stat.log");
        fs.mkdirSync(binDir);
        fs.writeFileSync(
          path.join(binDir, "stat"),
          "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$MONO_STAT_CALL_LOG\"\nprintf '%s\\n' \"$MONO_STAT_MTIME\"\n"
        );
        fs.chmodSync(path.join(binDir, "stat"), 0o755);
        fs.writeFileSync(path.join(fixtureRoot, "compaction-safe"), "");
        const output = parseHookOutput(
          `${style} mtime fixture`,
          runHook(fixtureRoot, "auto", {
            MONO_COMPACTION_STAT_STYLE: style,
            MONO_STAT_CALL_LOG: statLog,
            MONO_STAT_MTIME: String(Math.floor(Date.now() / 1000)),
            PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
          })
        );
        if (output && Object.keys(output).length !== 0) fail(`${style} mtime branch must allow a fresh sentinel`);
        const expectedArgs = style === "bsd" ? "-f %m" : "-c %Y";
        if (!fs.readFileSync(statLog, "utf8").includes(expectedArgs)) {
          fail(`${style} mtime branch did not execute stat ${expectedArgs}`);
        }
      });
    }
  }

  if (!exists(instructionsRelativePath)) {
    fail(`Missing ${instructionsRelativePath}`);
  } else {

  }

}

// MONO-43: the stage-report contract has one home per fact. The certificate
// lives in `certificate` and is referenced, never copied, from a queued
// mutation; the `verification_items` semantics and status enum are stated
// once in the report template and pointed at from the dispatch template.

function costTemplateFieldFaults(surfaces) {
  const faults = [];
  const deploySlice = boundedSlice(
    "templates/deploy-output.md",
    surfaces.deploy,
    "Deploy status:",
    "\nПроверено:",
    "default deploy-status block"
  );
  if (deploySlice && !/^\s*- Cost:\s*\S/m.test(deploySlice)) {
    faults.push("deploy-cost-field");
  }

  const statusSlice = boundedSlice(
    "templates/orchestrator-brief.md",
    surfaces.brief,
    "Решений от тебя:",
    "\n```",
    "ordinary orchestrator status"
  );
  if (statusSlice && !/^Цена волны:\s*\S/m.test(statusSlice)) {
    faults.push("status-wave-cost-field");
  }
  return faults;
}

function validateCostTemplateFields() {
  const surfaces = {
    deploy: read("templates/deploy-output.md"),
    brief: read("templates/orchestrator-brief.md"),
  };
  const faults = costTemplateFieldFaults(surfaces);
  if (faults.length > 0) {
    fail(`cost template fields are incomplete: ${faults.join(", ")}`);
  }

  const negativeFixtures = [
    ["deploy-cost-field", { ...surfaces, deploy: surfaces.deploy.replace(/^\s*- Cost:.*$/m, "") }],
    ["status-wave-cost-field", { ...surfaces, brief: surfaces.brief.replace(/^Цена волны:.*$/m, "") }],
  ];
  for (const [expectedFault, fixture] of negativeFixtures) {
    if (!costTemplateFieldFaults(fixture).includes(expectedFault)) {
      fail(`cost template negative fixture must reject removal of ${expectedFault}`);
    }
  }
}

function parseWaveCostOutput(output) {
  const marker = "\nЦена волны ";
  const markerIndex = output.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error("missing Russian one-line output");
  return {
    json: JSON.parse(output.slice(0, markerIndex)),
    line: output.slice(markerIndex + 1).trim(),
  };
}

function validateWaveCostBehavior() {
  const scriptPath = path.join(root, "scripts", "wave-cost.mjs");
  if (!fs.existsSync(scriptPath)) {
    fail("Missing runtime script: scripts/wave-cost.mjs");
    return;
  }

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-wave-cost-"));
  try {
    const logsDir = path.join(fixtureRoot, "logs");
    const reportsDir = path.join(fixtureRoot, "reports");
    const consumedDir = path.join(fixtureRoot, "consumed");
    const installedSkillsRoot = path.join(fixtureRoot, ".claude", "skills");
    const installedSkill = path.join(installedSkillsRoot, "mono-implement", "SKILL.md");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.mkdirSync(consumedDir, { recursive: true });
    fs.mkdirSync(path.dirname(installedSkill), { recursive: true });
    fs.writeFileSync(installedSkill, "# Installed fixture\n1234567890\n");
    fs.writeFileSync(path.join(fixtureRoot, "workers.json"), "{}\n");
    fs.writeFileSync(
      path.join(fixtureRoot, "ledger.md"),
      "## 2026-09-09\n- 10:00 (09.09) MONO-999 DISPATCHED: mono-implement, fixture\n"
    );

    const event = (value) => `${JSON.stringify(value)}\n`;
    fs.writeFileSync(
      path.join(logsDir, "MONO-999-mono-implement-a1.jsonl"),
      event({ type: "thread.started", thread_id: "fixture-1", metadata_path: installedSkill }) +
        event({
          type: "item.completed",
          item: { type: "command_execution", command: `/bin/zsh -lc 'cat ${installedSkill}'` },
        }) +
        event({
          type: "turn.completed",
          usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            cache_write_input_tokens: 0,
            output_tokens: 10,
            reasoning_output_tokens: 3,
          },
        }) +
        event({
          type: "turn.completed",
          usage: {
            input_tokens: 250,
            cached_input_tokens: 200,
            cache_write_input_tokens: 0,
            output_tokens: 20,
            reasoning_output_tokens: 5,
          },
        })
    );
    fs.writeFileSync(
      path.join(logsDir, "MONO-999-mono-implement-a2.jsonl"),
      event({ type: "thread.started", thread_id: "fixture-2" }) +
        event({
          type: "turn.completed",
          usage: {
            input_tokens: 50,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 5,
            reasoning_output_tokens: 1,
          },
        })
    );

    const checkoutOutput = parseWaveCostOutput(
      runNode(["scripts/wave-cost.mjs", "MONO-999", "--root", fixtureRoot])
    );
    const result = checkoutOutput.json;
    if (
      result.worker.turns !== 3 ||
      result.worker.attempt_count !== 2 ||
      result.worker.usage.input_tokens !== 400 ||
      result.worker.usage.cached_input_tokens !== 240 ||
      result.worker.usage.output_tokens !== 35 ||
      result.worker.usage.non_overlapping_total_tokens !== 435
    ) {
      fail("wave-cost multi-turn fixture must sum every turn of every attempt without adding cached input twice");
    }
    if (
      result.accounting_comparison.old_last_event_rule.input_tokens !== 300 ||
      result.accounting_comparison.corrected_all_turns.input_tokens !== 400 ||
      result.accounting_comparison.input_delta_tokens !== 100
    ) {
      fail("wave-cost output must explain the divergence from the retired last-event accounting rule");
    }
    if (
      !String(result.intervals.dispatch_to_green_pr).startsWith("unavailable: ") ||
      !String(result.intervals.dispatch_to_merge).startsWith("unavailable: ") ||
      !String(result.autoreview.usage).startsWith("unavailable: ") ||
      !String(result.orchestrator.usage).startsWith("unavailable: ") ||
      result.phase_usage_note !== "по фазам недоступно"
    ) {
      fail("wave-cost missing-phase fixture must name every unavailable component and the phase-usage limit");
    }
    if (
      result.pack_reading.files.length !== 1 ||
      result.pack_reading.files[0].read_commands !== 1 ||
      result.pack_reading.total_bytes !== fs.statSync(installedSkill).size ||
      result.pack_reading.approx_tokens !== Math.ceil(fs.statSync(installedSkill).size / 4)
    ) {
      fail("wave-cost pack-reading fixture must count each actually read installed pack file once");
    }
    if (
      !checkoutOutput.line.startsWith("Цена волны MONO-999:") ||
      checkoutOutput.line.includes("unavailable:") ||
      checkoutOutput.line.includes("{") ||
      !checkoutOutput.line.includes("авто-ревью н/д (помощник не сообщает учёт)") ||
      !checkoutOutput.line.includes("оркестратор н/д (транскрипт не передан)")
    ) {
      fail("wave-cost must emit a compact Russian summary without raw unavailable values or JSON");
    }

    fs.appendFileSync(
      path.join(logsDir, "MONO-999-mono-implement-a1.jsonl"),
      event({
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "autoreview --mode branch",
          aggregated_output:
            "autoreview target: branch\nreview passes: 1\nautoreview usage: input=10 cached=2 output=2\n",
        },
      })
    );
    fs.writeFileSync(
      path.join(consumedDir, "MONO-999-mono-ship.json"),
      `${JSON.stringify({
        issue: "MONO-999",
        stage: "mono-ship",
        review_rounds: { novel_resolver_rounds: 2, unresolved_threads: 0 },
      })}\n`
    );
    const wrongIssueReport = path.join(reportsDir, "MONO-999-mono-ship-a9.json");
    fs.writeFileSync(
      wrongIssueReport,
      `${JSON.stringify({
        issue: "MONO-9999",
        stage: "mono-ship",
        review_rounds: 99,
        green_at: "2026-09-09T10:45:00Z",
      })}\n`
    );
    const futureReportTime = new Date(Date.now() + 60_000);
    fs.utimesSync(wrongIssueReport, futureReportTime, futureReportTime);
    fs.writeFileSync(
      path.join(fixtureRoot, "workers.json"),
      `${JSON.stringify({ "MONO-999": { model: "fixture-model", effort: "medium" } })}\n`
    );
    fs.writeFileSync(
      path.join(fixtureRoot, "ledger.md"),
      [
        "## 2026-09-09",
        "- 10:00 (09.09) MONO-999 DISPATCHED: legacy record",
        "- 10:05 (09.09) MONO-999 SHIP GREEN: first record",
        "- 10:06 (09.09) MONO-999 MERGED: first record",
        "- 2026-09-09T09:55:00Z MONO-999 clock correction: thread.started ≈ 2026-09-09T09:55:00Z; DISPATCHED",
        "- 10:15 (09.09) MONO-999 SHIP GREEN: corrected record",
        "- 10:20 (09.09) MONO-999 MERGED: corrected record",
        "- 10:30 (09.09) MONO-9999 MERGED: another Issue",
        "- 10:40 (09.09) MONO-1000 MERGED: example output names MONO-999",
        "",
      ].join("\n")
    );
    const transcript = path.join(fixtureRoot, "orchestrator.jsonl");
    fs.writeFileSync(
      transcript,
      event({
        type: "item.completed",
        item: { type: "agent_message", text: `MONO-999 uses model ${"GPT-" + "5"}` },
      }) +
        event({
          type: "turn.completed",
          usage: {
            input_tokens: 20,
            cached_input_tokens: 5,
            cache_write_input_tokens: 0,
            output_tokens: 3,
            reasoning_output_tokens: 1,
          },
        }) +
        event({ type: "item.completed", item: { type: "agent_message", text: "MONO-9999" } }) +
        event({
          type: "turn.completed",
          usage: {
            input_tokens: 1_000,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 100,
            reasoning_output_tokens: 10,
          },
        })
    );

    const measuredOutput = parseWaveCostOutput(
      runNode([
        "scripts/wave-cost.mjs",
        "MONO-999",
        "--root",
        fixtureRoot,
        "--orchestrator-transcript",
        transcript,
      ])
    );
    if (
      measuredOutput.json.review_rounds !== 2 ||
      measuredOutput.json.measurable_total.input_tokens !== 430 ||
      measuredOutput.json.measurable_total.cached_input_tokens !== 247 ||
      measuredOutput.json.measurable_total.output_tokens !== 40 ||
      measuredOutput.json.intervals.dispatch_to_green_pr.seconds !== 1200 ||
      measuredOutput.json.intervals.dispatch_to_merge.seconds !== 1500
    ) {
      fail("wave-cost measured fixture must normalize review rounds and prefer corrected interval endpoints");
    }
    if (
      measuredOutput.line.length > 320 ||
      measuredOutput.line.includes("{") ||
      measuredOutput.line.includes("unavailable:")
    ) {
      fail("wave-cost fully measured Russian summary must be one compact sentence of at most 320 characters");
    }

    fs.appendFileSync(
      transcript,
      event({
        type: "item.completed",
        item: { type: "agent_message", text: "Compare MONO-999 with MONO-1000" },
      }) +
        event({
          type: "turn.completed",
          usage: {
            input_tokens: 500,
            cached_input_tokens: 100,
            cache_write_input_tokens: 0,
            output_tokens: 50,
            reasoning_output_tokens: 10,
          },
        })
    );
    const ambiguousOutput = parseWaveCostOutput(
      runNode([
        "scripts/wave-cost.mjs",
        "MONO-999",
        "--root",
        fixtureRoot,
        "--orchestrator-transcript",
        transcript,
      ])
    );
    if (
      !String(ambiguousOutput.json.orchestrator.usage).startsWith(
        "unavailable: orchestrator transcript has a multi-Issue turn"
      ) ||
      !ambiguousOutput.line.includes("оркестратор н/д (ход затрагивает несколько задач)")
    ) {
      fail("wave-cost must not attribute one multi-Issue orchestrator turn to every mentioned Issue");
    }

    const installedScript = path.join(
      installedSkillsRoot,
      ".mono-agent-workflow",
      "scripts",
      "wave-cost.mjs"
    );
    fs.mkdirSync(path.dirname(installedScript), { recursive: true });
    fs.copyFileSync(scriptPath, installedScript);
    const installedOutput = execFileSync(
      process.execPath,
      [installedScript, "MONO-999", "--root", fixtureRoot],
      { cwd: fixtureRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const installedResult = parseWaveCostOutput(installedOutput);
    if (installedResult.json.worker.usage.input_tokens !== 400) {
      fail("installed-layout wave-cost fixture must run without a pack checkout");
    }

    fs.appendFileSync(
      path.join(logsDir, "MONO-999-mono-implement-a2.jsonl"),
      event({
        type: "turn.completed",
        usage: { input_tokens: 5, output_tokens: 1 },
      })
    );
    const partialOutput = parseWaveCostOutput(
      runNode(["scripts/wave-cost.mjs", "MONO-999", "--root", fixtureRoot])
    );
    if (
      partialOutput.json.worker.complete !== false ||
      !String(partialOutput.json.worker.usage_status).startsWith("unavailable: ") ||
      !String(partialOutput.json.measurable_total_status).startsWith("unavailable: ") ||
      partialOutput.line.includes("токенов измеримо") ||
      !partialOutput.line.includes("исполнитель н/д (неполные данные в логах)")
    ) {
      fail("wave-cost must not publish a partial worker total as fully measurable");
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const REGISTRY_GATE_REQUIREMENTS = [
  {
    "label": "watcher-inactive-registration-clock",
    "file": "watcher",
    "text": "Date.parse(registryEntry.spawned_at)"
  },
  {
    "label": "watcher-inactive-future-timestamp",
    "file": "watcher",
    "text": "if (inactiveSpawn.invalidTimestamp)"
  },
  {
    "label": "watcher-inactive-partial-first-event",
    "file": "watcher",
    "text": "!inspection.hasThreadStarted"
  },
  {
    "label": "watcher-inactive-requires-thread-started",
    "file": "watcher",
    "text": "!inspection.hasThreadStarted"
  },
  {
    "label": "watcher-log-scan-budget",
    "file": "watcher",
    "text": "const LOG_SCAN_MAX_BYTES = 256 * 1024"
  },
  {
    "label": "watcher-log-scan-cursor",
    "file": "watcher",
    "text": "state.offset += bytesRead"
  },
  {
    "label": "watcher-log-scan-completion-barrier",
    "file": "watcher",
    "text": "if (!inspection.scanComplete)"
  },
  {
    "label": "watcher-log-scan-frozen-timeout-snapshot",
    "file": "watcher",
    "text": "freezeLogInspectionTarget(log.filePath, inspection.observedSize)"
  },
  {
    "label": "watcher-log-scan-one-shot-progress",
    "file": "watcher",
    "text": "} while (args.once && oneShotNeedsRescan)"
  },
  {
    "label": "watcher-startup-timeout-millisecond-boundary",
    "file": "watcher",
    "text": "if (startupAgeMs < args.stallSec * 1000) return"
  },
  {
    "label": "watcher-inactive-missing-log-recovery",
    "file": "watcher",
    "text": "inactive gate spawn has no readable attempt log"
  },
  {
    "label": "watcher-inspection-state-active-registry-eviction",
    "file": "watcher",
    "text": "currentLogPaths.add(path.resolve(expandHome(entry.log)))"
  }
];

function registryGateContractFaults(surfaces) {
  const faults = [];
  for (const requirement of REGISTRY_GATE_REQUIREMENTS) {
    if (!surfaces.watcher.includes(requirement.text)) faults.push(requirement.label);
  }

  const watcher = surfaces.watcher;
  const registryReadStart = watcher.indexOf("function readRegistryGates(registryEntry)");
  const elementValidation = watcher.indexOf("for (const gate of gates)", registryReadStart);
  const registrySet = watcher.indexOf("const gateNames = new Set(gates)", registryReadStart);
  if (
    registryReadStart < 0 ||
    elementValidation < registryReadStart ||
    registrySet < elementValidation
  ) {
    faults.push("watcher-full-shape-before-set");
  }
  for (const [label, text] of [
    ["watcher-legacy-presence", 'Object.prototype.hasOwnProperty.call(registryEntry ?? {}, "gates")'],
    ["watcher-absent-null", 'Object.prototype.hasOwnProperty.call(registryEntry ?? {}, "gates")) {\n    return null;'],
    ["watcher-malformed-null", "if (registryGates === null) return null;"],
    ["watcher-no-foreign-gates", "!ack.gateNames.every((gateName) => registryGates.gateNames.has(gateName))"],
    [
      "watcher-passed-set-equality",
      'ack.status === "gates-passed" && ack.gateNames.length !== registryGates.gateNames.size',
    ],
  ]) {
    if (!watcher.includes(text)) faults.push(label);
  }
  if (watcher.includes("INSTALLED_SOURCE_COMMIT") || watcher.includes("installedSourceCommit")) {
    faults.push("watcher-source-commit-discriminator-removed");
  }
  return faults;
}

function validateRegistryGateContract() {
  const surfaces = { watcher: read("scripts/watch-workers.mjs") };
  for (const requirement of REGISTRY_GATE_REQUIREMENTS) requireMachineToken(requirement.text);
  const faults = registryGateContractFaults(surfaces);
  if (faults.length) fail(`registry gate contract is incomplete: ${faults.join(", ")}`);
  for (const { label, text } of REGISTRY_GATE_REQUIREMENTS) {
    const mutated = { watcher: surfaces.watcher.replace(text, "") };
    if (!registryGateContractFaults(mutated).includes(label)) {
      fail(`registry gate negative fixture did not reject removed ${label} branch`);
    }
  }
}

function validateStatusTemplateFields() {
  // Existing template field labels are structure. Agent-facing wording and
  // the order in which an agent presents the blocks are reviewed as text.
  const file = "templates/orchestrator-brief.md";
  const section = modelSection(read(file), "Статус (Status Update)");
  const blocks = section === null ? [] : fencedBlocks(section);
  for (const field of ["Решений от тебя:", "Техника (можно не читать):", "Нужно от тебя (<N> решений):"]) {
    requireMachineToken(field);
    if (!blocks.some((block) => block.includes(field))) fail(file + ": missing status field " + field);
  }
}

// Fenced blocks of a Markdown surface, in order, without their fence lines.
// The owner-layer field checks below need them because a durable machine block
// is the only occurrence of a field that downstream recovery depends on.
function fencedBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (/^\s{0,3}```/.test(line)) {
      if (current === null) current = [];
      else {
        blocks.push(current.join("\n"));
        current = null;
      }
      continue;
    }
    if (current !== null) current.push(line);
  }
  return blocks;
}

// Assert a field inside the fenced block a marker identifies, never anywhere in
// the file: a surface that also EXPLAINS the field in prose would keep a
// whole-file check green after the machine-block line itself was deleted, which
// is the one deletion that breaks recovery by a later stage.
function assertFieldInFencedBlock(relativePath, marker, field) {
  const blocks = fencedBlocks(read(relativePath)).filter((block) => block.includes(marker));
  if (blocks.length === 0) {
    fail(`${relativePath} must keep a fenced block containing ${JSON.stringify(marker)}`);
    return;
  }
  for (const block of blocks) {
    const hasField = block
      .split("\n")
      .some((line) => line.trim().replace(/^-\s*/, "").startsWith(field));
    if (!hasField) {
      fail(
        `${relativePath} block ${JSON.stringify(marker)} must carry the ${JSON.stringify(field)} field`
      );
    }
  }
}

function validateOwnerLayerProcedureSurface() {
  // MONO-64 — the owner-layer PROCEDURE, checked structurally only. The
  // reconciliation step must declare both documents as a deferred read AND name
  // them in the step itself, and the publication step must carry its closeout
  // field into the deploy template. Nothing here pins a sentence: how the two
  // steps are worded stays editable, the surfaces they live on do not.
  const orchestrateSurface = "skills/mono-orchestrate/SKILL.md";
  const orchestrateText = read(orchestrateSurface);
  const tierRange = readTierBounds(orchestrateText);
  const tierTwoStart = tierRange?.start ?? -1;
  const tierTwoEnd = tierRange?.end ?? -1;
  if (tierTwoStart < 0 || tierTwoEnd <= tierTwoStart) {
    fail(`${orchestrateSurface} must carry a "Read when" tier block holding the owner-layer documents`);
  } else {
    const tierTwoSlice = orchestrateText.slice(
      tierTwoStart,
      tierTwoEnd
    );
    // The body after the tier rule is where the reconciliation step lives; a
    // path declared in the ladder but never used by a step is a dangling read.
    const stepBody = orchestrateText.slice(tierTwoEnd);
    for (const documentPath of [OWNER_LAYER_MAP_PATH, OWNER_LAYER_CONSTITUTION_PATH]) {
      if (!tierTwoSlice.includes(documentPath)) {
        fail(
          `${orchestrateSurface} must read ${documentPath} in its "Read when" tier: the orchestrator compares it with the installed copy`
        );
      }
      if (!stepBody.includes(documentPath)) {
        fail(
          `${orchestrateSurface} must name ${documentPath} in its owner-layer reconciliation step, not only in the "Read when" tier`
        );
      }
    }
  }

  // The publication outcome has to survive in the blocks a later stage and the
  // owner actually read back: the deploy closeout comment and both blocks of the
  // deploy output template.
  assertFieldInFencedBlock("skills/mono-deploy/SKILL.md", "mono-deploy closeout", "Owner layer:");
  assertFieldInFencedBlock("templates/deploy-output.md", "Deploy status:", "Owner layer:");
  assertFieldInFencedBlock("templates/deploy-output.md", "Mono deploy verdict:", "Owner layer:");
}

function boundedSlice(relativePath, text, startMarker, endMarker, label) {
  const start = text.indexOf(startMarker);
  const end = start >= 0 ? text.indexOf(endMarker, start + startMarker.length) : -1;
  if (start < 0 || end <= start) {
    fail(`${relativePath} must carry a ${label} section bounded by its own markers`);
    return null;
  }
  return text.slice(start, end);
}

// MONO-65 review follow-up — the marker rule is written per-line and has no
// awareness of Markdown code fences, so a marker-only edit hidden inside a
// fenced block would normalise away identically on both sides: reconciliation
// would miss it, and publication could then overwrite the owner's edit. We
// have not measured what Linear's document service does to a marker inside a
// fence, so the fix is not to teach the rule to skip fenced lines (that could
// just as easily turn a narrow blind spot into a permanent false difference
// on every run, the very bug this Issue fixes). Instead the two owner-layer
// documents are constrained: neither may contain a code fence at all. Both
// contain zero fences today, so this passes now and turns red the moment one
// is added - which is exactly when the rule's fence behaviour would need to
// be measured before being trusted. Structural only: a fenced line either
// exists in the file or it does not.
const OWNER_LAYER_FENCE_FREE_PATHS = [OWNER_LAYER_MAP_PATH, OWNER_LAYER_CONSTITUTION_PATH];
const CODE_FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

function validateOwnerLayerDocumentsFenceFree() {
  for (const docPath of OWNER_LAYER_FENCE_FREE_PATHS) {
    const lines = read(docPath).split("\n");
    const fenceLineIndex = lines.findIndex((line) => CODE_FENCE_LINE_PATTERN.test(line));
    if (fenceLineIndex >= 0) {
      fail(
        `${docPath} line ${fenceLineIndex + 1}: owner-layer documents must carry no code fence - the marker-canonicalisation rule's behaviour inside a fence has not been measured against Linear's document service`
      );
    }
  }
}

// MONO-71 — Linear rewrites a bare Issue key from this workspace into link
// markup when a document is written. The comparison deliberately does not
// canonicalise issue links, so keep the two owner-layer documents free of the
// only key shape the service rewrites here. Contract and artifact ids such as
// PC-005, IS-004, and К-22 remain valid because they do not match this pattern.
const OWNER_LAYER_BARE_ISSUE_KEY_PATTERN = /\bMONO-[0-9]+\b/;

function validateOwnerLayerDocumentsBareIssueKeyFree() {
  for (const docPath of [OWNER_LAYER_MAP_PATH, OWNER_LAYER_CONSTITUTION_PATH]) {
    const lines = read(docPath).split("\n");
    const bareKeyLineIndex = lines.findIndex((line) =>
      OWNER_LAYER_BARE_ISSUE_KEY_PATTERN.test(line)
    );
    if (bareKeyLineIndex >= 0) {
      fail(
        `${docPath} line ${bareKeyLineIndex + 1}: owner-layer documents must carry no bare Linear issue key - measure the document service rewrite before extending the normalisation rule`
      );
    }
  }
}

function validateProjectUpdateSurface() {
  const { paths } = extractReadFirstEntries(read("skills/mono-deploy/SKILL.md"));
  if (!paths.includes("templates/project-update.md")) {
    fail("skills/mono-deploy/SKILL.md must read templates/project-update.md as its project-update source");
  }

  // The orchestrator publishes project updates too, so the template must sit in
  // its deferred read ladder. extractReadFirstEntries parses tier-1 entries
  // only, so this is a substring check on the tier-2 slice between the
  // "Read when" heading and the tier rule.
  const orchestrateSurface = "skills/mono-orchestrate/SKILL.md";
  const orchestrateText = read(orchestrateSurface);
  const tierRange = readTierBounds(orchestrateText);
  const tierTwoStart = tierRange?.start ?? -1;
  const tierTwoEnd = tierRange?.end ?? -1;
  if (tierTwoStart < 0 || tierTwoEnd <= tierTwoStart) {
    fail(`${orchestrateSurface} must carry a "Read when" tier block holding the project-update contract`);
  } else if (
    !orchestrateText
      .slice(tierTwoStart, tierTwoEnd)
      .includes("templates/project-update.md")
  ) {
    fail(
      `${orchestrateSurface} must read templates/project-update.md in its "Read when" tier: the orchestrator writes project updates too`
    );
  }
}

// MONO-69: model cells are data, never fixture expectations. Role bindings,
// command fields, route keys and effort values are structural contracts.
const MODEL_POLICY_PATH = "references/model-policy.md";
const MODEL_ROLES = [
  "orchestrator", "second-voice", "second-voice-alt", "worker-default",
  "worker-complex", "worker-claude", "autoreview",
];
const MODEL_ENUM_ALLOWLIST = new Set([
  "claude-code-desktop", "claude-5", "gpt-worker", "gpt-5",
]);
const MODEL_EFFORTS = ["low", "medium", "high", "xhigh"];
const REVIEW_ROUTES = new Map([
  ["tiny", "low"], ["standard", "medium"], ["deep", "high"],
  ["risky", "high"], ["risky with critical escalation", "xhigh"],
]);
const NORMATIVE_MODEL_SECTIONS = [
  ["references/lifecycle.md", "Preflight"],
  ["references/versioning.md", "Project Config Contract"],
  ["references/artifact-quality.md", "Preflight Certificate"],
  ["references/install.md", "Project Policy"],
];

function executableModelIds(text) {
  // Deliberately independent of table contents: old and fabricated ids count.
  return [...text.matchAll(/\b(?:claude|gpt)-[a-z0-9]+(?:[.-][a-z0-9]+)*\b/gi)]
    .map((match) => match[0])
    .filter((token) => /\d/.test(token) && !MODEL_ENUM_ALLOWLIST.has(token));
}

function isModelId(value) {
  const ids = executableModelIds(value);
  return ids.length === 1 && ids[0] === value;
}

function modelSection(text, title) {
  const lines = text.split("\n");
  let start = -1;
  let level = 0;
  let fence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (!heading) continue;
    if (start >= 0 && heading[1].length <= level) return lines.slice(start, i).join("\n");
    if (heading[2] === title) { start = i + 1; level = heading[1].length; }
  }
  return start < 0 ? "" : lines.slice(start).join("\n");
}

function modelTable(section, columns) {
  const rows = [];
  forEachOwnerLayerLine(section, (line) => {
    if (line.trim().startsWith("|")) {
      rows.push(line.trim().slice(1, -1).split("|").map((cell) => cell.trim()));
    }
  });
  const header = rows.shift();
  const separator = rows.shift();
  if (!header || header.join("|").toLowerCase() !== columns.join("|") ||
      !separator || separator.length !== columns.length || !separator.every((cell) => /^:?-+:?$/.test(cell))) {
    throw new Error(`invalid table header; expected ${columns.join(" | ")}`);
  }
  if (rows.some((row) => row.length !== columns.length || row.some((cell) => !cell))) {
    throw new Error("invalid or empty table cell");
  }
  return rows;
}

function policyRoles(text) {
  const rows = modelTable(modelSection(text, "Roles"), ["role", "model id", "reasoning effort", "applies to", "decided by"]);
  const roles = new Map();
  for (const [roleCell, modelCell, effortCell, appliesTo, decidedBy] of rows) {
    const role = roleCell.replaceAll("`", "");
    const model = modelCell.replaceAll("`", "");
    const effort = effortCell.replaceAll("`", "");
    if (roles.has(role)) throw new Error(`duplicate role ${role}`);
    if (!MODEL_ROLES.includes(role)) throw new Error(`unknown role ${role}`);
    if (!isModelId(model)) throw new Error(`invalid model id for ${role}`);
    if (role === "orchestrator" ? effort !== "n/a" : role === "autoreview"
      ? effort !== "[Canonical Routes](autoreview-routing.md#canonical-routes)"
      : !MODEL_EFFORTS.includes(effort)) throw new Error(`invalid effort source for ${role}`);
    roles.set(role, { model, effort, appliesTo, decidedBy });
  }
  if (roles.size !== MODEL_ROLES.length) throw new Error("policy must define all seven roles");
  return roles;
}

function modelRoleReferences(text) {
  return [...text.matchAll(/\[role:([a-z][a-z0-9-]*)\]\(([^)]+)\)/g)]
    .map((match) => ({ role: match[1], target: match[2] }));
}

function modelActiveFiles(base) {
  const files = [];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(base, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  for (const directory of ["skills", "references", "templates", "scripts", "docs/ru"]) walk(directory);
  return files;
}

function modelCommand(section, executable) {
  const commands = [...section.matchAll(/```bash\s*\n([\s\S]*?)```/g)]
    .map((match) => match[1].trim())
    .filter((command) => command.startsWith(executable));
  if (commands.length !== 1) throw new Error(`expected one ${executable} command template`);
  return commands[0];
}

function modelRecordErrors(record) {
  // Fixture validation only: never reads or mutates a live worker registry.
  const intended = record.model_policy;
  const launch = record.model_launch;
  if (intended === undefined && launch === undefined) return []; // Legacy: do not backfill.
  const errors = [];
  if (!intended || !MODEL_ROLES.filter((role) => role.startsWith("worker-")).includes(intended.role) ||
      !isModelId(intended.model || "") || !MODEL_EFFORTS.includes(intended.effort)) errors.push("invalid policy intent");
  if (!launch || launch.case !== record.transport || !["codex-cli", "fallback", "claude-code-desktop"].includes(launch.case)) {
    return [...errors, "invalid transport case"];
  }
  if (launch.actual_model !== null || typeof launch.evidence !== "string" || !launch.evidence.trim()) errors.push("invalid unknown/evidence boundary");
  if (launch.case === "codex-cli") {
    if (launch.model_parameter !== intended?.model || launch.effort_parameter !== intended?.effort || launch.effort_source !== "explicit") errors.push("codex launch pins differ from recorded intent");
  } else if (launch.case === "fallback") {
    if (typeof launch.model_parameter !== "string" || !launch.model_parameter.trim() || launch.effort_parameter !== null || launch.effort_source !== "runtime-default") errors.push("fallback must record alias and uncontrolled effort");
  } else if (launch.model_parameter !== null || launch.effort_parameter !== null || launch.effort_source !== "unknown") {
    errors.push("desktop parameters must stay unknown");
  }
  return errors;
}

function renderModelRegistryExample(sample, intended, transport) {
  // Instantiate the documented shape for fixtures, preserving literal values
  // so a contradictory template parameter is checked rather than overwritten.
  const codex = transport === "codex-cli";
  const fallback = transport === "fallback";
  const values = new Map([
    ["<codex-cli | claude-code-desktop | fallback>", transport],
    ["<codex-cli | fallback | claude-code-desktop>", transport],
    ["<selected worker role>", intended.role],
    ["<resolved policy model id>", intended.model],
    ["<resolved policy effort>", intended.effort],
    ["<exact id or runtime alias actually set, or null>", codex ? intended.model : fallback ? "runtime-alias" : null],
    ["<effort actually set, or null>", codex ? intended.effort : null],
    ["<explicit | runtime-default | unknown>", codex ? "explicit" : fallback ? "runtime-default" : "unknown"],
    ["<requested command parameters | runtime alias assumption | manually selected, actual model unverified>",
      codex ? "requested command parameters" : fallback ? "runtime alias assumption" : "manually selected, actual model unverified"],
  ]);
  return JSON.parse(JSON.stringify(sample), (_key, value) => {
    return typeof value === "string" && values.has(value) ? values.get(value) : value;
  });
}

function checkModelPolicy(base) {
  const errors = [];
  const body = (file) => fs.readFileSync(path.join(base, file), "utf8");
  let roles;
  try { roles = policyRoles(body(MODEL_POLICY_PATH)); }
  catch (error) { return [`${MODEL_POLICY_PATH}: ${error.message}`]; }
  for (const section of ["Reviewer and producer", "Audience profile", "Application boundary", "Orchestrator self-check", "Launch evidence"]) {
    if (!modelSection(body(MODEL_POLICY_PATH), section).trim()) errors.push(`${MODEL_POLICY_PATH}: missing policy section ${section}`);
  }
  function binding(file, section, expected) {
    const refs = modelRoleReferences(section);
    const found = new Set(refs.map((ref) => ref.role));
    if (found.size !== expected.length || expected.some((role) => !found.has(role))) {
      errors.push(`${file}: role binding must be ${expected.join(", ")}; found ${[...found].join(", ") || "none"}`);
    }
  }
  for (const file of [...modelActiveFiles(base), "AGENTS.md", "README.md"]) {
    const text = body(file);
    if (file !== MODEL_POLICY_PATH) {
      for (const id of executableModelIds(text)) errors.push(`${file}: executable model id outside policy: ${id}`);
    }
    for (const ref of modelRoleReferences(text)) {
      if (!roles.has(ref.role)) errors.push(`${file}: unknown role ${ref.role}`);
      if (!/(?:^|\/)model-policy\.md#roles$/.test(ref.target)) errors.push(`${file}: invalid policy role target ${ref.target}`);
    }
    const markers = [...text.matchAll(/\[role:([a-z][a-z0-9-]*)\]/g)];
    if (markers.length !== modelRoleReferences(text).length) errors.push(`${file}: policy role reference must be a link`);
    for (const [, role] of markers) {
      if (!roles.has(role)) errors.push(`${file}: unknown role ${role}`);
    }
    // A route outside the canonical table is another authority, including
    // tables appended after that section or copied into another consumer.
    const routeRows = (source) => [...source.matchAll(/^\s*\|\s*`?(?:tiny|standard|deep|risky)\b[^\n]*$/gm)].map((match) => match[0]);
    const allowedRows = file === "references/autoreview-routing.md" ? routeRows(modelSection(text, "Canonical Routes")) : [];
    if (routeRows(text).length !== allowedRows.length) errors.push(`${file}: route rows outside Canonical Routes`);
  }
  for (const [file, section] of NORMATIVE_MODEL_SECTIONS) binding(file, modelSection(body(file), section), ["autoreview"]);
  const preflightFile = "skills/mono-preflight/SKILL.md";
  const preflight = body(preflightFile);
  const workflow = preflight.split(/^Workflow:\s*$/m)[1] || "";
  const reviewStep = /^5\.[^\n]*\n([\s\S]*?)(?=^6\.)/m.exec(workflow)?.[1] || "";
  binding(preflightFile, reviewStep, ["autoreview"]);
  binding("skills/mono-orchestrate/SKILL.md", body("skills/mono-orchestrate/SKILL.md"), ["orchestrator"]);
  const certificate = preflight.split("Autoreview route:")[1]?.split("\n")[0] || "";
  for (const field of ["risk", "source", "critical", "model", "effort", "reclassified"]) {
    if (!new RegExp(`(?:^|;)\\s*${field}=<[^>]+>`).test(certificate)) errors.push(`${preflightFile}: certificate routing field missing: ${field}`);
  }
  if (!certificate.includes("model=<resolved model id>")) errors.push(`${preflightFile}: certificate must record resolved model id`);
  const orchestrationFile = "references/orchestration.md";
  const orchestration = body(orchestrationFile);
  const secondVoice = modelSection(orchestration, "Second Voice");
  const codexVoice = modelSection(secondVoice, "Claude orchestrator");
  const claudeVoice = modelSection(secondVoice, "GPT orchestrator");
  binding(orchestrationFile + " Second Voice/Claude", codexVoice, ["second-voice"]);
  binding(orchestrationFile + " Second Voice/GPT", claudeVoice, ["second-voice-alt"]);
  const workers = modelSection(orchestration, "Worker model selection");
  binding(orchestrationFile + " spawn", workers, ["worker-default", "worker-complex"]);
  binding(orchestrationFile + " Claude transport", modelSection(orchestration, "Claude worker transports"), ["worker-claude"]);
  for (const [section, executable, model, effort] of [
    [codexVoice, "codex exec", "second-voice-model", "second-voice-effort"],
    [claudeVoice, "claude -p", "second-voice-alt-model", "second-voice-alt-effort"],
    [workers, "codex exec", "worker-model", "worker-effort"],
  ]) {
    try {
      const command = modelCommand(section, executable);
      const modelFlag = executable === "claude -p" ? `--model <${model}>` : `-c 'model="<${model}>"'`;
      const effortFlag = executable === "claude -p" ? `--effort <${effort}>` : `-c 'model_reasoning_effort="<${effort}>"'`;
      if (!command.includes(modelFlag) || !command.includes(effortFlag)) errors.push(`${orchestrationFile}: command must consume row model AND effort (${model})`);
    } catch (error) { errors.push(`${orchestrationFile}: ${error.message}`); }
  }
  // Worker and Second Voice efforts cannot be copied into their consumers.
  for (const file of [orchestrationFile, "skills/mono-orchestrate/SKILL.md", "templates/orchestrator-brief.md", "templates/orchestrator-report.md"]) {
    const literalEffort = /(?:model_reasoning_effort\s*=\s*["']?|--effort\s+|(?:at|both sides at)\s+)(?:low|medium|high|xhigh)\b/i;
    if (literalEffort.test(body(file))) errors.push(`${file}: worker/Second Voice effort literal outside policy`);
  }
  const routingFile = "references/autoreview-routing.md";
  const routing = body(routingFile);
  // These replace the former name-bearing recalibration and same-model pins:
  // check bounded code tokens/relations, not a prescribed English sentence.
  const recalibrationTokens = [...modelSection(routing, "Effort recalibration").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  if (!["standard", "medium", "high"].every((token) => recalibrationTokens.includes(token))) errors.push(`${routingFile}: missing standard effort recalibration operands`);
  const sameModel = modelSection(routing, "Same-model review");
  if (!/`<worker-model>\s*=\s*<autoreview-model>`/.test(sameModel)) errors.push(`${routingFile}: missing resolved model equality condition`);
  try {
    const rows = modelTable(modelSection(routing, "Canonical Routes"), ["risk class", "role", "reasoning effort", "intended use"]);
    const routes = new Map();
    const classes = new Set();
    for (const [riskCell, roleCell, effortCell] of rows) {
      const key = riskCell.replaceAll("`", "");
      if (routes.has(key)) errors.push(`${routingFile}: duplicate route ${key}`);
      routes.set(key, effortCell.replaceAll("`", ""));
      classes.add(key.split(" ")[0]);
      binding(routingFile + ` route ${key}`, roleCell, ["autoreview"]);
    }
    if (rows.length !== 5 || classes.size !== 4 || routes.size !== 5 ||
        [...REVIEW_ROUTES].some(([key, effort]) => routes.get(key) !== effort) ||
        [...routes.keys()].some((key) => !REVIEW_ROUTES.has(key))) errors.push(`${routingFile}: route set must be exactly four classes, five unique routes and unchanged class efforts`);
    for (const command of [...modelSection(routing, "Invocation").matchAll(/^<autoreview-helper>.*$/gm)].map((match) => match[0])) {
      if (!command.includes("--engine claude --model <autoreview-model> --thinking ")) errors.push(`${routingFile}: invocation must use explicit role model and route effort`);
    }
    if (!modelSection(routing, "Invocation").includes("--thinking <effort>")) errors.push(`${routingFile}: missing generic invocation`);
  } catch (error) { errors.push(`${routingFile}: ${error.message}`); }
  const registryFile = "templates/orchestrator-report.md";
  try {
    const section = modelSection(body(registryFile), "Worker Registry");
    const block = /```json\s*\n([\s\S]*?)```/.exec(section)?.[1];
    const sample = JSON.parse(block.replace("<repeat the dispatch pin, integer>", "1"))["<ISSUE-KEY>"];
    for (const [field, keys] of [["model_policy", ["role", "model", "effort"]], ["model_launch", ["case", "model_parameter", "effort_parameter", "effort_source", "actual_model", "evidence"]]]) {
      if (!sample[field] || keys.some((key) => !Object.hasOwn(sample[field], key))) errors.push(`${registryFile}: missing ${field} provenance fields`);
    }
    if (sample.model_launch?.actual_model !== null) errors.push(`${registryFile}: actual served model must be unknown`);
    for (const transport of ["codex-cli", "fallback", "claude-code-desktop"]) {
      const role = transport === "codex-cli" ? "worker-default" : "worker-claude";
      const intended = { role, model: roles.get(role).model, effort: roles.get(role).effort };
      const record = renderModelRegistryExample(sample, intended, transport);
      for (const error of modelRecordErrors(record)) errors.push(`${registryFile}: ${transport} template provenance: ${error}`);
    }
  } catch (error) { errors.push(`${registryFile}: invalid registry model shape: ${error.message}`); }
  for (const file of ["skills/mono-orchestrate/SKILL.md", "templates/orchestrator-brief.md"]) {
    const text = body(file).replace(/\s+/g, " ");
    const status = /Модель оркестратора: ([^\n]*?не удалось проверить)/.exec(text)?.[1] || "";
    if (status !== "по политике | не по политике | не удалось проверить") errors.push(`${file}: missing three-outcome orchestrator status field`);
  }
  return errors;
}

function validateModelPolicyFixtures() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-model-policy-"));
  try {
    for (const name of ["skills", "references", "templates", "scripts", "docs/ru", "AGENTS.md", "README.md"]) {
      fs.cpSync(path.join(root, name), path.join(scratch, name), { recursive: true });
    }
    const script = path.join(scratch, "scripts/validate-workflow.mjs");
    const check = () => runNode([script, "--model-policy-only"], { cwd: scratch });
    const file = (name) => path.join(scratch, name);
    const originalPolicy = fs.readFileSync(file(MODEL_POLICY_PATH), "utf8");
    const originals = new Map();
    function change(name, transform) {
      const before = fs.readFileSync(file(name), "utf8");
      const after = transform(before);
      if (typeof after !== "string" || after === before) throw new Error(`Fixture did not change ${name}`);
      if (!originals.has(name)) originals.set(name, before);
      fs.writeFileSync(file(name), after);
      if (fs.readFileSync(file(name), "utf8") !== after) throw new Error(`Fixture write failed: ${name}`);
    }
    function restore() {
      for (const [name, text] of originals) {
        fs.writeFileSync(file(name), text);
        if (fs.readFileSync(file(name), "utf8") !== text) throw new Error(`Fixture restore failed: ${name}`);
      }
      originals.clear();
    }
    function rowKey(line) {
      return line.trimStart().startsWith("|") ? line.split("|")[1].trim().replaceAll("`", "") : null;
    }
    function row(text, key, transform) {
      return text.split("\n").map((line) => rowKey(line) === key ? transform(line) : line).join("\n");
    }
    function cell(text, role, index, value) {
      return row(text, role, (line) => {
        const cells = line.split("|");
        cells[index + 1] = ` \`${value}\` `;
        return cells.join("|");
      });
    }
    // Build ids, not a second inventory of current or historic model names.
    const fabricated = (family, variant) => [family, "987", `fixture${variant}`].join("-");
    const roles = policyRoles(originalPolicy);
    const marker = (role) => `[role:${role}]`;
    const link = (role) => `[role:${role}](references/model-policy.md#roles)`;
    check();
    change(MODEL_POLICY_PATH, (text) => cell(text, "worker-default", 1, fabricated("gpt", "a")));
    check();
    console.log("PASS model-policy AE1: changed cell, unchanged fixtures");
    restore(); check();
    function negative(label, mutate, expected) {
      const previousFailures = failures.length;
      try {
        mutate();
        if (originals.size === 0) throw new Error(`${label}: fixture made no edits`);
        expectCommandFailure(label, check, expected);
      } finally {
        restore();
        check();
      }
      if (failures.length === previousFailures) console.log(`PASS model-policy ${label}: red (${expected}), restored green`);
    }
    negative("AE2 stale literal", () => {
      change(MODEL_POLICY_PATH, (text) => cell(text, "worker-default", 1, fabricated("gpt", "b")));
      change("skills/mono-preflight/SKILL.md", (text) => text + `\n${roles.get("worker-default").model}\n`);
    }, "skills/mono-preflight/SKILL.md: executable model id outside policy");
    negative("AE3 wrong existing role", () => change("skills/mono-preflight/SKILL.md", (text) => text.replace(marker("autoreview"), marker("worker-default"))), "role binding must be autoreview");
    negative("AE4 duplicate role", () => change(MODEL_POLICY_PATH, (text) => row(text, "worker-default", (line) => `${line}\n${line}`)), "duplicate role worker-default");
    negative("AE4 unknown role", () => change("README.md", (text) => text + `\n${link("unknown-reviewer")}\n`), "unknown role unknown-reviewer");
    negative("AE4 changed class effort", () => change("references/autoreview-routing.md", (text) => cell(text, "standard", 2, "high")), "route set must be exactly");
    negative("AE4 sixth route", () => change("references/autoreview-routing.md", (text) => row(text, "tiny", (line) => line + "\n" + line.replace("`tiny`", "`standard` with extra escalation"))), "route set must be exactly");
    negative("AE4 duplicate route", () => change("references/autoreview-routing.md", (text) => row(text, "tiny", (line) => `${line}\n${line}`)), "duplicate route tiny");
    negative("review equality condition", () => change("references/autoreview-routing.md", (text) => text.replace(/<worker-model>\s*=\s*<autoreview-model>/, "<worker-model> != <autoreview-model>")), "missing resolved model equality condition");
    negative("standard recalibration", () => change("references/autoreview-routing.md", (text) => text.replace(/(###\s+Effort recalibration[\s\S]*?)`high`/, "$1`low`")), "missing standard effort recalibration operands");
    for (const [name] of NORMATIVE_MODEL_SECTIONS) {
      negative(`normative reference ${name}`, () => change(name, (text) => text.replace(/\[role:autoreview\]\([^)]+\)/g, "reviewer")), `${name}: role binding must be autoreview`);
    }
    for (const name of ["docs/ru/karta-paka.md", "references/execution-quality.md", "templates/orchestrator-brief.md", "scripts/verify.mjs"]) {
      negative(`active detector ${name}`, () => change(name, (text) => text + `\n${fabricated("claude", "stale")}\n`), `${name}: executable model id outside policy`);
    }
    change("README.md", (text) => text + `\n${[...MODEL_ENUM_ALLOWLIST].join(" ")}\n`);
    check(); restore(); check();
    console.log("PASS model-policy enum allowlist");
    negative("spawn effort source", () => change("references/orchestration.md", (text) => text.replaceAll('<worker-effort>', roles.get("worker-default").effort)), "command must consume row model AND effort");
    negative("AE4 route outside canonical section", () => change("references/autoreview-routing.md", (text) => {
      const tiny = text.split("\n").find((line) => rowKey(line) === "tiny");
      if (!tiny) throw new Error("Fixture route tiny not found");
      return `${text}\n${tiny}\n`;
    }), "route rows outside Canonical Routes");
    negative("Second Voice wrong branch", () => change("references/orchestration.md", (text) => text.replace(marker("second-voice"), marker("second-voice-alt"))), "Second Voice/Claude: role binding must be second-voice");
    negative("registry provenance fields", () => change("templates/orchestrator-report.md", (text) => text.replace(/"effort_parameter"\s*:/, '"lost_effort_parameter":')), "missing model_launch provenance fields");
    negative("registry template model mismatch", () => change("templates/orchestrator-report.md", (text) => text.replace(/("model_parameter"\s*:)\s*"[^"]*"/, '$1 "runtime-alias"')), "codex-cli template provenance: codex launch pins differ");
    negative("registry template uncontrolled effort", () => change("templates/orchestrator-report.md", (text) => text.replace(/("effort_source"\s*:)\s*"[^"]*"/, '$1 "explicit"')), "fallback template provenance: fallback must record alias and uncontrolled effort");
    negative("registry template desktop parameter", () => change("templates/orchestrator-report.md", (text) => text.replace(/("effort_parameter"\s*:)\s*"[^"]*"/, '$1 "<resolved policy effort>"')), "claude-code-desktop template provenance: desktop parameters must stay unknown");

    const nextVoiceModel = fabricated("gpt", "voice");
    const nextReviewModel = fabricated("claude", "review");
    const nextEffort = MODEL_EFFORTS.find((effort) => effort !== roles.get("second-voice").effort);
    change(MODEL_POLICY_PATH, (text) => cell(cell(cell(text, "second-voice", 1, nextVoiceModel), "second-voice", 2, nextEffort), "autoreview", 1, nextReviewModel));
    check();
    const changedRoles = policyRoles(fs.readFileSync(file(MODEL_POLICY_PATH), "utf8"));
    const orchestration = fs.readFileSync(file("references/orchestration.md"), "utf8");
    const voiceTemplate = modelCommand(modelSection(orchestration, "Claude orchestrator"), "codex exec");
    const voiceCommand = voiceTemplate.replaceAll("<second-voice-model>", changedRoles.get("second-voice").model)
      .replaceAll("<second-voice-effort>", changedRoles.get("second-voice").effort);
    const routing = fs.readFileSync(file("references/autoreview-routing.md"), "utf8");
    const reviewTemplate = modelCommand(modelSection(routing, "Invocation").split("Examples:")[0], "<autoreview-helper>");
    const route = modelTable(modelSection(routing, "Canonical Routes"), ["risk class", "role", "reasoning effort", "intended use"]).find((row) => row[0] === "`risky`");
    const reviewCommand = reviewTemplate.replaceAll("<autoreview-model>", changedRoles.get("autoreview").model)
      .replaceAll("<effort>", route[2].replaceAll("`", ""));
    if (!voiceCommand.includes(`model="${nextVoiceModel}"`) || !voiceCommand.includes(`model_reasoning_effort="${nextEffort}"`) ||
        !reviewCommand.includes(`--model ${nextReviewModel} --thinking ${REVIEW_ROUTES.get("risky")}`)) fail("AE5 commands must consume changed model and effort cells");
    console.log(`PASS model-policy AE5 Second Voice: ${voiceCommand}`);
    console.log(`PASS model-policy AE5 autoreview: ${reviewCommand}`);
    restore(); check();

    const legacy = { transport: "codex-cli" };
    const before = JSON.stringify(legacy);
    if (modelRecordErrors(legacy).length || JSON.stringify(legacy) !== before) fail("AE8 legacy entries must remain unchanged");
    const intended = { role: "worker-default", model: roles.get("worker-default").model, effort: roles.get("worker-default").effort };
    const launch = { case: "codex-cli", model_parameter: intended.model, effort_parameter: intended.effort, effort_source: "explicit", actual_model: null, evidence: "requested command parameters" };
    const current = { transport: "codex-cli", model_policy: intended, model_launch: launch };
    const serialized = JSON.stringify(current);
    change(MODEL_POLICY_PATH, (text) => cell(text, "worker-default", 1, fabricated("gpt", "newlaunch")));
    const newIntended = { ...intended, model: policyRoles(fs.readFileSync(file(MODEL_POLICY_PATH), "utf8")).get("worker-default").model };
    const newRecord = { ...current, model_policy: newIntended, model_launch: { ...launch, model_parameter: newIntended.model } };
    if (modelRecordErrors(current).length || modelRecordErrors(newRecord).length || JSON.stringify(current) !== serialized || newRecord.model_policy.model === current.model_policy.model) fail("AE8 new launch/retained pins boundary");
    for (const transport of ["fallback", "claude-code-desktop"]) {
      const record = { transport, model_policy: { role: "worker-claude", model: roles.get("worker-claude").model, effort: roles.get("worker-claude").effort }, model_launch: { case: transport, model_parameter: transport === "fallback" ? "runtime-alias" : null, effort_parameter: null, effort_source: transport === "fallback" ? "runtime-default" : "unknown", actual_model: null, evidence: "transport assumption; served model unverified" } };
      if (modelRecordErrors(record).length) fail(`AE8 ${transport} valid provenance rejected`);
      record.model_launch.effort_parameter = intended.effort;
      if (!modelRecordErrors(record).length) fail(`AE8 ${transport} must reject intended effort as applied`);
    }
    restore(); check();
    console.log("PASS model-policy AE8: provenance cases, retained pins and legacy no-backfill");
  } catch (error) {
    fail(`Model policy fixtures failed: ${error.message}\n${error.stdout || ""}\n${error.stderr || ""}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const STRING_PINS = [
  ["skills/mono-ship/SKILL.md","templates/ship-status-ux.md"],
  ["templates/ship-status-ux.md","Статус ревью:"],
  ["templates/ship-status-ux.md","Review timeline:"],
  ["references/orchestration.md","orchestration.workerAudience"],
  ["skills/mono-deploy/SKILL.md","Project update:"],
  ["templates/deploy-output.md","Project update:"],
  ["skills/mono-deploy/SKILL.md","Тематический проект:"],
  ["skills/mono-issue/SKILL.md","Тематический проект:"],
  ["templates/issue.md","Тематический проект:"],
  ["templates/project-update.md","Тематический проект:"],
  ["templates/review-output.md","Ревью Linear:"],
  ["templates/review-output.md","Блокирующие замечания:"],
  ["templates/review-output.md","Предложенные исправления:"],
  ["templates/review-output.md","Нужно твоё решение:"],
  ["templates/review-output.md","К сведению:"],
  ["templates/ship-output.md","Preflight:"],
  ["templates/ship-output.md","Bug/perf proof:"],
  ["templates/deploy-output.md","Deploy status:"],
  ["templates/deploy-output.md","Ship certificate:"],
  ["templates/deploy-output.md","Deploy workflow:"],
  ["templates/deploy-output.md","Learnings recorded:"],
  ["templates/check-output.md","Смысл:"],
  ["templates/check-output.md","Чего не хватает:"],
  ["templates/check-output.md","Расхождения:"],
  ["templates/check-output.md","Следующий unblock:"],
  ["templates/check-output.md","Нарушение контракта:"],
  ["templates/check-output.md","Как починить:"],
  ["templates/orchestrator-dispatch.md","~/.codex/skills/"],
  ["templates/orchestrator-dispatch.md",".orchestrator/"],
  ["templates/orchestrator-brief.md","Что решаем:"],
  ["templates/orchestrator-brief.md","Почему сейчас:"],
  ["templates/orchestrator-brief.md","Что уже доказано:"],
  ["templates/orchestrator-brief.md","Рекомендация:"],
  ["templates/orchestrator-brief.md","Решил сам:"],
  ["templates/orchestrator-brief.md","Нужно от тебя:"],
  ["templates/orchestrator-report.md","\"issue\""],
  ["templates/orchestrator-report.md","\"stage\""],
  ["templates/orchestrator-report.md","\"status\""],
  ["templates/orchestrator-report.md","\"verification_items\""],
  ["templates/orchestrator-report.md","\"question\""],
  ["templates/orchestrator-report.md","\"recommendation\""],
  ["templates/orchestrator-report.md","\"linear_mutations_pending\""],
  ["templates/orchestrator-report.md","\"notes\""],
  ["templates/orchestrator-report.md","needs-decision"],
  ["templates/orchestrator-report.md","needs-human"],
  ["templates/orchestrator-report.md","drift-candidate"],
  ["templates/orchestrator-report.md","workers.json"],
  ["skills/mono-handoff/SKILL.md","references/repair-machine.md"],
  ["skills/mono-handoff/SKILL.md","mono-review artifact"],
  ["skills/mono-review/SKILL.md","references/repair-machine.md"],
  ["skills/mono-review/SKILL.md","- `artifact`"],
  ["skills/mono-check/SKILL.md","references/repair-machine.md"],
  ["skills/mono-check/SKILL.md","repair"],
  ["templates/orchestrator-dispatch.md","packVersion"],
  ["templates/orchestrator-dispatch.md","sourceCommit"],
  ["templates/orchestrator-dispatch.md","surfaceRevision"],
  ["templates/orchestrator-report.md","packVersion"],
  ["templates/orchestrator-report.md","sourceCommit"],
  ["templates/orchestrator-report.md","surfaceRevision"],
  ["templates/orchestrator-report.md","control.json"],
  ["scripts/verify.mjs","verify-pack-state.mjs"],
  ["references/install.md","packVersion"],
  ["references/install.md","sourceCommit"],
  ["references/install.md","surfaceRevision"],
  ["references/install.md","verify-pack-state.mjs"],
  ["references/versioning.md","packVersion"],
  ["references/versioning.md","sourceCommit"],
  ["references/versioning.md","surfaceRevision"],
  ["references/versioning.md","verify-pack-state.mjs"],
  ["skills/mono-implement/SKILL.md","verify-pack-state.mjs identity"],
  ["skills/mono-implement/SKILL.md","packVersion"],
  ["skills/mono-implement/SKILL.md","sourceCommit"],
  ["skills/mono-implement/SKILL.md","surfaceRevision"],
  ["skills/mono-implement/SKILL.md","blocked"],
  ["skills/mono-preflight/SKILL.md","verify-pack-state.mjs identity"],
  ["skills/mono-preflight/SKILL.md","packVersion"],
  ["skills/mono-preflight/SKILL.md","sourceCommit"],
  ["skills/mono-preflight/SKILL.md","surfaceRevision"],
  ["skills/mono-preflight/SKILL.md","blocked"],
  ["skills/mono-ship/SKILL.md","verify-pack-state.mjs identity"],
  ["skills/mono-ship/SKILL.md","packVersion"],
  ["skills/mono-ship/SKILL.md","sourceCommit"],
  ["skills/mono-ship/SKILL.md","surfaceRevision"],
  ["skills/mono-ship/SKILL.md","blocked"],
  ["references/orchestration.md","control.json"],
  ["references/orchestration.md","protocol.json"],
  ["references/orchestration.md","verify-pack-state.mjs identity"],
  ["skills/mono-orchestrate/SKILL.md","control.json"],
  ["skills/mono-orchestrate/SKILL.md","active"],
  ["skills/mono-orchestrate/SKILL.md","draining"],
  ["skills/mono-orchestrate/SKILL.md","idle"],
  ["skills/mono-orchestrate/SKILL.md","surfaceRevision"],
  ["references/issue-only-lane.md","mono-issue-only marker"],
  ["references/issue-only-lane.md","Marker version: 1"],
  ["references/issue-only-lane.md","Scope fingerprint"],
  ["references/issue-only-lane.md","Acceptance IDs"],
  ["references/issue-only-lane.md","Risk class"],
  ["references/issue-only-lane.md","Approval"],
  ["references/issue-only-lane.md","route_revision"],
  ["references/issue-only-lane.md","assurance_vector"],
  ["references/issue-only-lane.md","required_artifacts"],
  ["references/issue-only-lane.md","package_kind"],
  ["references/issue-only-lane.md","lifecycle_state_entity"],
  ["references/issue-only-lane.md","behavioral_oracle"],
  ["references/issue-only-lane.md","issue-verification"],
  ["references/issue-only-lane.md","risk_class"],
  ["references/issue-only-lane.md","approval_status"],
  ["references/issue-only-lane.md","scripts/resolve-issue-context.mjs"],
  ["references/issue-only-lane.md","issueOnlyLane.enabled: true"],
  ["references/issue-only-lane.md","ownerPrincipal"],
  ["references/issue-only-lane.md",".mono-agent-workflow/scripts/resolve-issue-context.mjs"],
  ["skills/mono-implement/SKILL.md","lifecycle_state_entity=issue"],
  ["skills/mono-implement/SKILL.md","approval_status=approved-fresh"],
  ["references/issue-only-lane.md","Approval: superseded"],
  ["templates/orchestrator-dispatch.md","PRD:"],
  ["templates/orchestrator-dispatch.md","Tech Spec:"],
  ["templates/orchestrator-dispatch.md","Issue-only marker:"],
  ["templates/orchestrator-dispatch.md","Verified label:"],
  ["templates/orchestrator-dispatch.md","Scope fingerprint:"],
  ["templates/orchestrator-dispatch.md","Issue-only config:"],
  ["templates/orchestrator-dispatch.md","Owner approval:"],
  ["templates/orchestrator-dispatch.md","Context seam:"],
  ["skills/mono-issue/SKILL.md","scripts/resolve-issue-context.mjs"],
  ["skills/mono-issue/SKILL.md","--emit-fingerprint"],
  ["skills/mono-issue/SKILL.md","--issue <issue-body> --emit-fingerprint"],
  ["skills/mono-issue/SKILL.md","--issue <live-issue-body> --emit-fingerprint"],
  ["skills/mono-issue/SKILL.md","--approval-verified"],
  ["skills/mono-issue/SKILL.md",".mono-agent-workflow/scripts/resolve-issue-context.mjs"],
  ["skills/mono-issue/SKILL.md","issueOnlyLane.ownerPrincipal"],
  ["skills/mono-issue/SKILL.md","route_revision"],
  ["skills/mono-idea/SKILL.md","mono-issue"],
  ["skills/mono-issue/SKILL.md","references/contracts/issue.md"],
  ["templates/review-output.md","issue-only"],
  ["README.md","mono-implement"],
  ["README.md","mono-preflight"],
  ["README.md","mono-deploy"],
  ["README.md","autoreview"],
  ["README.md","node scripts/install-local.mjs"],
  ["README.md","node scripts/project-config.mjs"],
  ["README.md","--all-roots"],
  ["README.md","~/.claude/skills"],
  ["references/artifact-intake.md","read"],
  ["references/artifact-intake.md","unavailable"],
  ["references/artifact-intake.md","stale_or_ignored"],
  ["references/artifact-intake.md","conflicts"],
  ["references/artifact-intake.md","decisions_carried_forward"],
  ["references/artifact-intake.md","confidence_boundary"],
  ["references/readiness-gates.md","tiny"],
  ["references/readiness-gates.md","standard"],
  ["references/readiness-gates.md","deep"],
  ["references/readiness-gates.md","risky"],
  ["references/readiness-gates.md","references/autoreview-routing.md"],
  ["references/review-rubric.md","Allowed review verdicts:"],
  ["references/review-rubric.md","ready"],
  ["references/review-rubric.md","advisory-ready"],
  ["references/review-rubric.md","needs-fixes"],
  ["references/review-rubric.md","blocked"],
  ["references/install.md",".agents/mono-workflow.config.json"],
  ["references/install.md","--all-roots"],
  ["references/install.md","~/.claude/skills"],
  ["references/install.md",".mono-agent-workflow.lock.json"],
  ["references/install.md","MONO_WORKFLOW_KNOWN_ROOTS"],
  ["references/install.md","references/autoreview-routing.md"],
  ["references/orchestration.md","claude-code-desktop"],
  ["references/orchestration.md","deployApproval"],
  ["references/orchestration.md","scope-drift-needs-handoff"],
  ["references/orchestration.md","codex-cli"],
  ["references/orchestration.md","codex exec resume"],
  ["references/orchestration.md","--add-dir"],
  ["references/orchestration.md","workers.json"],
  ["references/orchestration.md","sandbox_workspace_write.network_access"],
  ["references/orchestration.md","git worktree add"],
  ["references/versioning.md","references/autoreview-routing.md"],
  ["references/install.md","\"orchestration\""],
  ["scripts/verify.mjs","watch-workers.mjs"],
  ["references/orchestration.md","thread.started"],
  ["references/orchestration.md","< /dev/null"],
  ["references/orchestration.md","watch-workers.mjs"],
  ["references/orchestration.md","EVENT:"],
  ["references/orchestration.md","model_reasoning_effort"],
  ["skills/mono-orchestrate/SKILL.md","watch-workers.mjs"],
  ["skills/mono-orchestrate/SKILL.md","../.mono-agent-workflow/scripts/watch-workers.mjs"],
  ["references/orchestration.md","node '<installed-mono-orchestrate-dir>/../.mono-agent-workflow/scripts/watch-workers.mjs' --root ~/.mono-agent-workflow/orchestrator/<product>"],
  ["references/install.md",".mono-agent-workflow/scripts/watch-workers.mjs"],
  ["references/versioning.md",".mono-agent-workflow/scripts/watch-workers.mjs"],
  ["references/orchestration.md","recorded-late"],
  ["references/orchestration.md","CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"],
  ["references/orchestration.md","compaction-safe"],
  ["references/orchestration.md","fallback"],
  ["templates/orchestrator-brief.md","Что пошло не так:"],
  ["templates/orchestrator-brief.md","Контекст: ~N%"],
  ["templates/orchestrator-compaction-hook.sh","MONO_ORCHESTRATOR_ROOT"],
  ["templates/orchestrator-compaction-hook.sh","MONO_COMPACTION_FRESHNESS_SECONDS:-300"],
  ["templates/orchestrator-compaction-hook.sh","MONO_COMPACTION_MAX_DEFERRALS:-3"],
  ["templates/orchestrator-compaction-hook.sh","get_mtime()"],
  ["templates/orchestrator-compaction-hook.sh","stat -f %m"],
  ["templates/orchestrator-compaction-hook.sh","stat -c %Y"],
  ["templates/compact-instructions.md","workers.json"],
  ["skills/mono-orchestrate/SKILL.md","CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"],
  ["skills/mono-orchestrate/SKILL.md","\"75\""],
  ["skills/mono-orchestrate/SKILL.md","\"PreCompact\""],
  ["skills/mono-orchestrate/SKILL.md","\"matcher\": \"auto\""],
  ["skills/mono-orchestrate/SKILL.md","templates/orchestrator-compaction-hook.sh"],
  ["skills/mono-orchestrate/SKILL.md",".claude/settings.json"],
  ["skills/mono-deploy/SKILL.md","workflows.qa"],
  ["skills/mono-deploy/SKILL.md","qaAuth"],
  ["references/install.md","\"qa\""],
  ["references/install.md","cookie-import"],
  ["references/install.md","test-account"],
  ["references/install.md","owner-session"],
  ["templates/deploy-output.md","Live QA:"],
  ["templates/orchestrator-report.md","pass | deferred | not-run"],
  ["skills/mono-implement/SKILL.md","pass | deferred | not-run"],
  ["skills/mono-preflight/SKILL.md","pass | deferred | not-run"],
  ["templates/orchestrator-dispatch.md","references/orchestration.md"],
  ["skills/mono-implement/SKILL.md","references/orchestration.md"],
  ["references/orchestration.md","node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity"],
  ["references/orchestration.md","--lock '<installed-skills-root>/.mono-agent-workflow.lock.json'"],
  ["references/orchestration.md","--pack-version '<dispatch packVersion>'"],
  ["references/orchestration.md","--source-commit '<dispatch sourceCommit>'"],
  ["references/orchestration.md","--surface-revision '<dispatch surfaceRevision>'"],
  ["templates/orchestrator-dispatch.md","node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity"],
  ["templates/orchestrator-dispatch.md","--lock '<installed-skills-root>/.mono-agent-workflow.lock.json'"],
  ["templates/orchestrator-dispatch.md","--pack-version '<packVersion above>'"],
  ["templates/orchestrator-dispatch.md","--source-commit '<sourceCommit above>'"],
  ["templates/orchestrator-dispatch.md","--surface-revision '<surfaceRevision above>'"],
  ["references/ship-feedback-loop.md","gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '.[] | select(.state==\"PENDING\")'"],
  ["templates/orchestrator-brief.md","Изменилось после твоего одобрения:"],
  ["references/orchestration.md","Изменилось после твоего одобрения:"],
  ["templates/orchestrator-brief.md","Решений от тебя:"],
  ["templates/orchestrator-brief.md","Можешь потрогать:"],
  ["templates/orchestrator-brief.md","В работе сейчас:"],
  ["templates/orchestrator-brief.md","Дальше по очереди:"],
  ["templates/orchestrator-brief.md","Чем рискуем:"],
  ["templates/orchestrator-brief.md","Обещал — не сделал:"],
  ["templates/orchestrator-brief.md","Следующий контакт:"],
  ["templates/orchestrator-brief.md","Техника (можно не читать):"],
  ["templates/compact-instructions.md","product_name"],
  ["skills/mono-deploy/SKILL.md","git rev-parse HEAD"],
  ["references/install.md","git rev-parse HEAD"],
  ["skills/mono-handoff/SKILL.md","references/artifact-intake.md"],
  ["skills/mono-handoff/SKILL.md","read"],
  ["skills/mono-handoff/SKILL.md","unavailable"],
  ["skills/mono-handoff/SKILL.md","stale_or_ignored"],
  ["skills/mono-handoff/SKILL.md","conflicts"],
  ["skills/mono-handoff/SKILL.md","decisions_carried_forward"],
  ["skills/mono-handoff/SKILL.md","confidence_boundary"],
  ["skills/mono-implement/SKILL.md","Implementation workflow"],
  ["skills/mono-implement/SKILL.md","implemented-needs-preflight"],
  ["skills/mono-implement/SKILL.md","scope-drift-needs-handoff"],
  ["skills/mono-implement/SKILL.md","gstack-learnings-search"],
  ["skills/mono-implement/SKILL.md","Учтённые learnings:"],
  ["skills/mono-preflight/SKILL.md","mono-preflight certificate"],
  ["skills/mono-preflight/SKILL.md","Issue(s):"],
  ["skills/mono-preflight/SKILL.md","Branch:"],
  ["skills/mono-preflight/SKILL.md","Changed files:"],
  ["skills/mono-preflight/SKILL.md","Local verification:"],
  ["skills/mono-preflight/SKILL.md","Autoreview:"],
  ["skills/mono-preflight/SKILL.md","Autoreview loop:"],
  ["skills/mono-preflight/SKILL.md","Drift candidate:"],
  ["skills/mono-preflight/SKILL.md","Not checked:"],
  ["skills/mono-preflight/SKILL.md","Next:"],
  ["skills/mono-preflight/SKILL.md","Decision needed:"],
  ["skills/mono-ship/SKILL.md","Documentation workflow"],
  ["skills/mono-ship/SKILL.md","mono-ship green certificate"],
  ["skills/mono-ship/SKILL.md","Next: mono-deploy"],
  ["skills/mono-deploy/SKILL.md","Deploy workflow"],
  ["skills/mono-deploy/SKILL.md","mono-check post-ship"],
  ["skills/mono-deploy/SKILL.md","gstack-learnings-log"],
  ["skills/mono-deploy/SKILL.md","gstack-learnings-search"],
  ["skills/mono-deploy/SKILL.md","Learnings consulted:"],
  ["skills/mono-deploy/SKILL.md","deployApproval"],
  ["templates/ship-output.md","mono-ship green certificate"],
  ["templates/ship-output.md","Documentation workflow"],
  ["templates/ship-output.md","Next:"],
  ["templates/deploy-output.md","Deploy workflow"],
  ["templates/deploy-output.md","Learnings recorded"],
  ["skills/mono-check/SKILL.md","project-config"],
  ["skills/mono-orchestrate/SKILL.md","scope-drift-needs-handoff"],
  ["skills/mono-orchestrate/SKILL.md","references/orchestration.md"],
  ["skills/mono-orchestrate/SKILL.md","templates/orchestrator-dispatch.md"],
  ["skills/mono-orchestrate/SKILL.md","templates/orchestrator-brief.md"],
  ["skills/mono-orchestrate/SKILL.md","templates/orchestrator-report.md"],
  ["skills/mono-orchestrate/SKILL.md","deployApproval"],
  ["skills/mono-orchestrate/SKILL.md","Session verdicts:"],
  ["skills/mono-orchestrate/SKILL.md","timed-out"],
  ["skills/mono-orchestrate/SKILL.md","codex-cli"],
  ["skills/mono-orchestrate/SKILL.md","workers.json"],
  ["skills/mono-orchestrate/SKILL.md","codex exec resume"],
  ["skills/mono-orchestrate/SKILL.md","orchestration.transport"],
  ["skills/mono-orchestrate/SKILL.md","maxParallelWorkers"],
  ["templates/review-output.md","Ревью Linear: <ready|advisory-ready|needs-fixes|blocked>"],
  ["templates/ship-output.md","Preflight: <ready/blocked/drift-candidate/needs-human/not run>"],
  ["templates/ship-output.md","Bug/perf proof: <not applicable or original symptom/baseline + fix proof + regression proof/gap>"],
  ["templates/deploy-output.md","Ship certificate: <found/missing/stale>"],
  ["skills/mono-handoff/SKILL.md","`mono-review artifact`"],
  ["skills/mono-check/SKILL.md","`repair`"],
  ["references/orchestration.md","`protocol.json`"],
  ["skills/mono-implement/SKILL.md","`lifecycle_state_entity=issue`"],
  ["skills/mono-implement/SKILL.md","`approval_status=approved-fresh`"],
  ["templates/orchestrator-dispatch.md","PRD: <full text, the sections relevant to this Issue, or `n/a (issue-only)`>"],
  ["templates/orchestrator-dispatch.md","Tech Spec: <full text, the contracts relevant to this Issue, or `n/a (issue-only)`>"],
  ["templates/orchestrator-dispatch.md","Issue-only marker: <current marker comment verbatim, or `n/a (project-first)`>"],
  ["templates/orchestrator-dispatch.md","Verified label: <`issue-only`, or `n/a (project-first)`>"],
  ["templates/orchestrator-dispatch.md","Scope fingerprint: <fresh whole-body SHA-256, or `n/a (project-first)`>"],
  ["templates/orchestrator-dispatch.md","Issue-only config: <`enabled=true; ownerPrincipal=<stable Linear user ID>`, or `n/a (project-first)`>"],
  ["templates/orchestrator-dispatch.md","Owner approval: <authenticated author plus approved fingerprint, or `n/a (project-first)`>"],
  ["templates/orchestrator-dispatch.md","Context seam: <resolved 5-field JSON, or `n/a` when resolution is blocked>"],
  ["skills/mono-idea/SKILL.md","`mono-issue`"],
  ["references/artifact-intake.md","`read`"],
  ["references/artifact-intake.md","`unavailable`"],
  ["references/artifact-intake.md","`stale_or_ignored`"],
  ["references/artifact-intake.md","`conflicts`"],
  ["references/artifact-intake.md","`decisions_carried_forward`"],
  ["references/artifact-intake.md","`confidence_boundary`"],
  ["references/readiness-gates.md","`tiny`:"],
  ["references/readiness-gates.md","`standard`:"],
  ["references/readiness-gates.md","`deep`:"],
  ["references/readiness-gates.md","`risky`:"],
  ["references/review-rubric.md","`ready`"],
  ["references/review-rubric.md","`advisory-ready`"],
  ["references/review-rubric.md","`needs-fixes`"],
  ["references/review-rubric.md","`blocked`"],
  ["references/orchestration.md","EVENT:<stall|dead|spawn-fail|report|gate-ack|idle>"],
  ["references/orchestration.md","`recorded-late`"],
];
const REQUIRED_HEADINGS = [
  ["references/repair-machine.md","Class 2 effect fixture: snapshot-sync"],
  ["references/repair-machine.md","Class 2 effect fixture: stale-preflight-cert"],
  ["references/repair-machine.md","Class 2 effect fixture: stale-worker-stop"],
  ["references/orchestration.md","Generated dispatch as audience adapter"],
  ["references/orchestration.md","Pre-write package review"],
  ["templates/prd.md","Акторы"],
  ["templates/prd.md","Текущий процесс"],
  ["templates/prd.md","Требования"],
  ["templates/prd.md","Примеры приемки"],
  ["templates/prd.md","Что должна доказать проверка"],
  ["templates/prd.md","Критерии успеха"],
  ["templates/prd.md","Допущения"],
  ["templates/prd.md","Открытые вопросы"],
  ["templates/prd.md","Связи"],
  ["templates/tech-spec.md","Исходные требования"],
  ["templates/tech-spec.md","Контракты и границы"],
  ["templates/tech-spec.md","Реальные ответы бэкенда"],
  ["templates/tech-spec.md","Единицы реализации"],
  ["templates/tech-spec.md","Влияние на остальную систему"],
  ["templates/tech-spec.md","Что может сломаться и как защищаемся"],
  ["templates/tech-spec.md","Валидация"],
  ["templates/tech-spec.md","Релиз и откат"],
  ["templates/issue.md","Прочитать сначала"],
  ["templates/issue.md","Готовность агента"],
  ["templates/issue.md","Зависимости"],
  ["templates/issue.md","Ключевые контракты"],
  ["templates/issue.md","Текущее поведение"],
  ["templates/issue.md","Желаемое поведение"],
  ["templates/issue.md","Шаги воспроизведения"],
  ["templates/issue.md","Ревью-гейт"],
  ["templates/issue.md","Снимок контекста"],
  ["templates/issue.md","Как проверить"],
  ["templates/issue.md","Критерии приемки"],
  ["templates/issue.md","Что не входит"],
  ["templates/project.md","Что"],
  ["templates/project.md","Зачем"],
  ["templates/project.md","Образ результата"],
  ["templates/project.md","Что входит"],
  ["templates/project.md","Что не входит"],
  ["templates/project-update.md","Shape"],
  ["templates/project-update.md","Invariants"],
  ["templates/project-update.md","Live mode"],
  ["templates/project-update.md","Theme project"],
  ["templates/project-update.md","State update"],
  ["templates/project-update.md","Examples"],
  ["templates/project-update.md","Acceptance set"],
  ["templates/orchestrator-dispatch.md","Assignment"],
  ["templates/orchestrator-dispatch.md","Goal Contract"],
  ["templates/orchestrator-dispatch.md","Engine"],
  ["templates/orchestrator-dispatch.md","Context Snapshot"],
  ["templates/orchestrator-dispatch.md","AFK Contract"],
  ["templates/orchestrator-dispatch.md","Mailbox"],
  ["templates/orchestrator-dispatch.md","Authorization"],
  ["templates/orchestrator-report.md","Ledger Entry"],
  ["templates/orchestrator-report.md","Worker Registry"],
  ["references/lifecycle.md","Artifact Repair"],
  ["references/issue-only-lane.md","Pre-code exit"],
  ["references/issue-only-lane.md","Post-`ready` exit"],
  ["skills/mono-issue/SKILL.md","Phase-1 go-live boundary"],
  ["references/contracts/issue.md","IS-005 — Issue-only branch"],
  ["references/contracts/issue.md","IS-008 — Project-first sources"],
  ["references/contracts/issue.md","IS-019 — Project-first chips"],
  ["examples/zeni-dogfood.md","Risk-Based Review Gate Examples"],
  ["examples/zeni-dogfood.md","Correct Risky Handoff Review"],
  ["examples/zeni-dogfood.md","Correct Implement To Preflight To Ship"],
  ["examples/zeni-dogfood.md","Anti-Example: Ship Owns Deploy"],
  ["examples/zeni-dogfood.md","Anti-Example: Vendored Project Install"],
  ["examples/zeni-dogfood.md","Correct Tiny Advisory Review"],
  ["examples/zeni-dogfood.md","Anti-Example: Required Review Skipped"],
  ["examples/zeni-dogfood.md","Anti-Example: Review Mutates Linear"],
  ["examples/zeni-dogfood.md","Anti-Example: Preflight Owns Ship"],
  ["references/readiness-gates.md","Tiny Output Profile"],
  ["references/artifact-quality.md","PRD"],
  ["references/artifact-quality.md","Tech Spec"],
  ["references/artifact-quality.md","Issue"],
  ["references/artifact-quality.md","Review Findings"],
  ["references/artifact-quality.md","Preflight Certificate"],
  ["references/human-friendly-output.md","Machine Blocks In Linear Comments"],
  ["references/human-friendly-output.md","Linear Exit Comments"],
  ["references/execution-quality.md","PRD Coverage"],
  ["references/execution-quality.md","Durable Issue Writing"],
  ["references/execution-quality.md","Agent Readiness"],
  ["references/execution-quality.md","Bug And Performance Proof"],
  ["references/execution-quality.md","Architecture Lens"],
  ["references/orchestration.md","Roles"],
  ["references/orchestration.md","Stage Ownership"],
  ["references/orchestration.md","Decision Authority"],
  ["references/orchestration.md","Worker Transports"],
  ["references/orchestration.md","Mailbox And Ledger"],
  ["references/orchestration.md","Monitoring Protocol"],
  ["references/orchestration.md","Decision Briefs"],
  ["references/orchestration.md","Resume"],
  ["references/questioning.md","Autonomy Defaults"],
  ["references/questioning.md","Orchestrated Mode"],
  ["references/lifecycle.md","Orchestration"],
  ["references/orchestration.md","Director Discovery"],
  ["references/orchestration.md","Second Voice"],
  ["references/orchestration.md","Heartbeat"],
  ["references/orchestration.md","Linear Write Verification"],
  ["references/orchestration.md","Context Budget"],
  ["templates/compact-instructions.md","НЕМЕДЛЕННОЕ СЛЕДУЮЩЕЕ ДЕЙСТВИЕ"],
  ["templates/compact-instructions.md","ЖИВЫЕ ВОРКЕРЫ"],
  ["templates/compact-instructions.md","РЕШЕНИЯ ВЛАДЕЛЬЦА"],
  ["templates/compact-instructions.md","РЕШИЛ САМ"],
  ["templates/compact-instructions.md","ТУПИКИ"],
  ["templates/compact-instructions.md","ПРОТОКОЛЬНЫЕ ГОТЧИ"],
  ["templates/compact-instructions.md","ОЧЕРЕДЬ ЗАДАЧ"],
  ["templates/compact-instructions.md","ПРЕДПОЧТЕНИЯ ВЛАДЕЛЬЦА"],
  ["references/contracts/tech-spec.md","TS-015 — Observed backend contracts"],
  ["references/contracts/tech-spec.md","TS-016 — Unreachable backend fallback"],
  ["references/orchestration.md","Orchestration Mode Precedence"],
  ["references/orchestration.md","Pack identity gate invocation"],
  ["skills/mono-implement/SKILL.md","Orchestration branch of `start-checkpoint`"],
  ["templates/orchestrator-dispatch.md","Gate Phase"],
  ["references/orchestration.md","Cost Telemetry"],
  ["templates/orchestrator-brief.md","Цена волны (Wave Cost Summary)"],
  ["templates/orchestrator-brief.md","Целостность брифа (Brief Integrity)"],
  ["templates/orchestrator-brief.md","Статус (Status Update)"],
  ["templates/orchestrator-brief.md","Итог волны (Wave Report)"],
  ["references/human-friendly-output.md","Product Language For The Owner"],
  ["skills/mono-check/SKILL.md","Mono Check"],
  ["skills/mono-deploy/SKILL.md","Mono Deploy"],
  ["skills/mono-handoff/SKILL.md","Mono Handoff"],
  ["skills/mono-idea/SKILL.md","Mono Idea"],
  ["skills/mono-implement/SKILL.md","Mono Implement"],
  ["skills/mono-issue/SKILL.md","Mono Issue"],
  ["skills/mono-orchestrate/SKILL.md","Mono Orchestrate"],
  ["skills/mono-preflight/SKILL.md","Mono Preflight"],
  ["skills/mono-review/SKILL.md","Mono Review"],
  ["skills/mono-ship/SKILL.md","Mono Ship"],
  ["templates/ship-status-ux.md","Ship status UX (interactive mode)"],
  ["skills/mono-implement/SKILL.md","Context-seam branch at Delivery Start"],
  ["references/readiness-gates.md","Review Gate Policy"],
  ["references/orchestration.md","Unavailable route"],
  ["templates/prd.md","PRD Template"],
  ["templates/tech-spec.md","Tech Spec Template"],
  ["templates/issue.md","Issue Template"],
  ["templates/project.md","Project Template"],
  ["templates/review-output.md","Review Output Template"],
  ["references/review-rubric.md","Checks"],
  ["AGENTS.md","Source Of Truth"],
  ["references/orchestration.md","Install Coordination"],
  ["references/orchestration.md","Claude worker transports"],
  ["skills/mono-orchestrate/SKILL.md","Owner-layer reconciliation"],
  ["references/issue-only-lane.md","Marker ≠ Route-Record"],
  ["references/issue-only-lane.md","The Context Contract (the seam)"],
  ["references/issue-only-lane.md","The Resolver"],
  ["references/issue-only-lane.md","Trust boundary"],
  ["references/issue-only-lane.md","Deterministic Project-first fallback"],
  ["skills/mono-issue/SKILL.md","Create-then-approve intake and renewal transaction"],
  ["references/artifact-rules.md","Linear Artifact Rules"],
  ["skills/mono-issue/SKILL.md","When issue-only is granted — the nine eligibility conditions"],
  ["skills/mono-issue/SKILL.md","Prequalification — judge on the raw request, before creating anything"],
  ["skills/mono-issue/SKILL.md","Established by the transaction, enforced by the resolver"],
  ["skills/mono-issue/SKILL.md","Renewal recovery"],
  ["skills/mono-issue/SKILL.md","Routing and fail-closed proof"],
  ["references/contracts/issue.md","IS-001 — Issue routing"],
  ["references/contracts/issue.md","IS-003 — Internal helper boundary"],
  ["references/contracts/issue.md","IS-004 — Targeted-use eligibility"],
  ["README.md","Principles"],
  ["AGENTS.md","Skill Design Rules"],
  ["examples/zeni-dogfood.md","Zeni Dogfood Example"],
  ["references/artifact-intake.md","Source Precedence"],
  ["references/artifact-intake.md","Configured Artifact Roots"],
  ["references/autoreview-routing.md","Autoreview Role Routing"],
  ["references/autoreview-routing.md","Canonical Routes"],
  ["references/autoreview-routing.md","Reviewer capability"],
  ["references/autoreview-routing.md","Same-model review"],
  ["references/install.md","Breaking Surface Changes"],
  ["references/orchestration.md","Sandbox ladder"],
  ["references/orchestration.md","Worker model selection"],
  ["references/versioning.md","Project Config Contract"],
  ["templates/orchestrator-brief.md","UX-чекпоинт (UX Checkpoint Brief)"],
  ["README.md","Skills"],
  ["references/install.md","Project Config"],
  ["references/orchestration.md","Two-Phase Dispatch Handshake"],
  ["references/orchestration.md","Registry gate-list lifecycle"],
  ["skills/mono-orchestrate/SKILL.md","Local compaction wiring"],
  ["references/lifecycle.md","Deploy"],
  ["references/install.md","Project Policy"],
  ["templates/orchestrator-report.md","Worker Report"],
  ["templates/orchestrator-dispatch.md","Worker Dispatch Prompt"],
  ["references/ship-feedback-loop.md","Review Bot Configuration Check"],
  ["references/ship-feedback-loop.md","Finding Dedup"],
  ["references/ship-feedback-loop.md","Published Replies"],
  ["references/ship-feedback-loop.md","Green Exit"],
  ["references/ship-feedback-loop.md","Non-Blocking Convergence"],
  ["references/install.md","Install-Source Verification (Deploy)"],
  ["references/review-rubric.md","Mono Review Rubric"],
  ["references/lifecycle.md","Linear Lifecycle"],
  ["AGENTS.md","AGENTS.md"],
  ["references/issue-only-lane.md","Issue-Only Lane Foundation"],
  ["references/orchestration.md","Orchestration Policy"],
  ["references/contracts/issue.md","Issue artifact contract"],
  ["references/questioning.md","Questioning Policy"],
  ["templates/orchestrator-brief.md","Шаблоны оркестратора: бриф и статус"],
  ["README.md","Mono Agent Workflow"],
  ["references/install.md","Install Guide"],
  ["templates/compact-instructions.md","Orchestrator Compaction Instructions"],
  ["templates/orchestrator-report.md","Worker Report And Ledger Shapes"],
  ["references/readiness-gates.md","Readiness Gates"],
  ["references/human-friendly-output.md","Human-Friendly Workflow Output"],
  ["templates/deploy-output.md","Deploy Output Template"],
  ["templates/project-update.md","Project Update Template"],
  ["templates/orchestrator-report.md","Model provenance"],
  ["references/lifecycle.md","Delivery"],
  ["references/lifecycle.md","Ship"],
  ["README.md","Workflow"],
  ["references/lifecycle.md","Preflight"],
  ["AGENTS.md","Fixture Coupling"],
  ["README.md","Documentation Map"],
  ["references/orchestration.md","Claude orchestrator"],
  ["templates/ship-status-ux.md","Статус ревью при наличии PR"],
  ["templates/ship-status-ux.md","Review timeline"],
  ["templates/ship-status-ux.md","Verdict copy"],
];
const MACHINE_TOKENS = new Set([
  "!inspection.hasThreadStarted",
  "\"75\"",
  "\"PreCompact\"",
  "\"issue\"",
  "\"linear_mutations_pending\"",
  "\"matcher\": \"auto\"",
  "\"notes\"",
  "\"orchestration\"",
  "\"qa\"",
  "\"question\"",
  "\"recommendation\"",
  "\"stage\"",
  "\"status\"",
  "\"verification_items\"",
  "-",
  "- `artifact`",
  "--add-dir",
  "--all-roots",
  "--approval-verified",
  "--emit-fingerprint",
  "--issue <issue-body> --emit-fingerprint",
  "--issue <live-issue-body> --emit-fingerprint",
  "--lock '<installed-skills-root>/.mono-agent-workflow.lock.json'",
  "--pack-version '<dispatch packVersion>'",
  "--pack-version '<packVersion above>'",
  "--source-commit '<dispatch sourceCommit>'",
  "--source-commit '<sourceCommit above>'",
  "--surface-revision '<dispatch surfaceRevision>'",
  "--surface-revision '<surfaceRevision above>'",
  "../.mono-agent-workflow/scripts/watch-workers.mjs",
  "../.mono-agent-workflow/scripts/wave-cost.mjs",
  ".agents/mono-workflow.config.json",
  ".claude/settings.json",
  ".mono-agent-workflow.lock.json",
  ".mono-agent-workflow/scripts/resolve-issue-context.mjs",
  ".mono-agent-workflow/scripts/watch-workers.mjs",
  ".orchestrator/",
  "< /dev/null",
  "AGENTS.md",
  "Acceptance IDs",
  "Allowed review verdicts:",
  "Approval",
  "Approval: superseded",
  "Autoreview loop:",
  "Autoreview:",
  "Branch:",
  "Bug/perf proof:",
  "Bug/perf proof: <not applicable or original symptom/baseline + fix proof + regression proof/gap>",
  "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
  "Changed files:",
  "Context seam:",
  "Context seam: <resolved 5-field JSON, or `n/a` when resolution is blocked>",
  "Cost:",
  "Date.parse(registryEntry.spawned_at)",
  "Decision needed:",
  "Deploy status:",
  "Deploy workflow",
  "Deploy workflow:",
  "Documentation workflow",
  "Drift candidate:",
  "EVENT:",
  "EVENT:<stall|dead|spawn-fail|report|gate-ack|idle>",
  "Exit disposition:",
  "Expansion destination:",
  "Frozen slice disposition:",
  "Implementation workflow",
  "Issue(s):",
  "Issue-only config:",
  "Issue-only config: <`enabled=true; ownerPrincipal=<stable Linear user ID>`, or `n/a (project-first)`>",
  "Issue-only marker:",
  "Issue-only marker: <current marker comment verbatim, or `n/a (project-first)`>",
  "Learnings consulted:",
  "Learnings recorded",
  "Learnings recorded:",
  "Linear review:",
  "Live QA:",
  "Local verification:",
  "MONO_COMPACTION_FRESHNESS_SECONDS:-300",
  "MONO_COMPACTION_MAX_DEFERRALS:-3",
  "MONO_ORCHESTRATOR_ROOT",
  "MONO_WORKFLOW_KNOWN_ROOTS",
  "Marker version: 1",
  "Next:",
  "Next: mono-deploy",
  "Not checked:",
  "Owner approval:",
  "Owner approval: <authenticated author plus approved fingerprint, or `n/a (project-first)`>",
  "PRD:",
  "PRD: <full text, the sections relevant to this Issue, or `n/a (issue-only)`>",
  "Preflight:",
  "Preflight: <ready/blocked/drift-candidate/needs-human/not run>",
  "Project update:",
  "Modes:",
  "Promotion mode:",
  "README.md",
  "Review timeline:",
  "Risk class",
  "Scope fingerprint",
  "Scope fingerprint:",
  "Scope fingerprint: <fresh whole-body SHA-256, or `n/a (project-first)`>",
  "Session verdicts:",
  "Ship certificate:",
  "Ship certificate: <found/missing/stale>",
  "Tech Spec:",
  "Tech Spec: <full text, the contracts relevant to this Issue, or `n/a (issue-only)`>",
  "Verified label:",
  "Verified label: <`issue-only`, or `n/a (project-first)`>",
  "`advisory-ready`",
  "`approval_status=approved-fresh`",
  "`blocked`",
  "`confidence_boundary`",
  "`conflicts`",
  "`decisions_carried_forward`",
  "`deep`:",
  "`lifecycle_state_entity=issue`",
  "`mono-issue`",
  "`mono-review artifact`",
  "`needs-fixes`",
  "`protocol.json`",
  "`read`",
  "`ready`",
  "`recorded-late`",
  "`repair`",
  "`risky`:",
  "`stale_or_ignored`",
  "`standard`:",
  "`tiny`:",
  "`unavailable`",
  "absent",
  "acceptance",
  "active",
  "advisory-ready",
  "ambiguous",
  "applied | rejected | blocked",
  "approval_status",
  "approval_status=approved-fresh",
  "approved-fresh",
  "assurance_vector",
  "attempt",
  "autoreview",
  "behavioral_oracle",
  "blocked",
  "branch",
  "certificate",
  "changed_files",
  "claude-code-desktop",
  "codex exec resume",
  "codex-cli",
  "compaction-safe",
  "confidence_boundary",
  "conflicts",
  "const LOG_SCAN_MAX_BYTES = 256 * 1024",
  "control.json",
  "cookie-import",
  "currentLogPaths.add(path.resolve(expandHome(entry.log)))",
  "decisions_carried_forward",
  "deep",
  "deployApproval",
  "draining",
  "drift-candidate",
  "error",
  "evidence",
  "examples/zeni-dogfood.md",
  "explicit",
  "fallback",
  "forbidden",
  "freezeLogInspectionTarget(log.filePath, inspection.observedSize)",
  "gate",
  "gates",
  "gates-passed | blocked",
  "get_mtime()",
  "gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '.[] | select(.state==\"PENDING\")'",
  "git rev-parse HEAD",
  "git worktree add",
  "gstack-learnings-log",
  "gstack-learnings-search",
  "identity",
  "idle",
  "if (!inspection.scanComplete)",
  "if (inactiveSpawn.invalidTimestamp)",
  "if (startupAgeMs < args.stallSec * 1000) return",
  "implemented-needs-preflight",
  "inactive gate spawn has no readable attempt log",
  "invalid",
  "issue",
  "issue-only",
  "issue-verification",
  "issueOnlyLane.enabled: true",
  "issueOnlyLane.ownerPrincipal",
  "item",
  "label",
  "ledger.md",
  "lifecycle_state_entity",
  "lifecycle_state_entity=issue",
  "linear_mutations_pending",
  "mailbox",
  "manual",
  "maxParallelWorkers",
  "model",
  "model_reasoning_effort",
  "mono-check post-ship",
  "mono-deploy",
  "mono-handoff",
  "mono-handoff repair",
  "mono-idea",
  "mono-implement",
  "mono-issue",
  "mono-issue-only marker",
  "mono-preflight",
  "mono-preflight certificate",
  "mono-preflight certificate\nPreflight: <ready|blocked|drift-candidate|needs-human>",
  "mono-review artifact",
  "mono-ship",
  "mono-ship green certificate",
  "needs-decision",
  "needs-fixes",
  "needs-human",
  "next",
  "node '<installed-mono-orchestrate-dir>/../.mono-agent-workflow/scripts/watch-workers.mjs' --root ~/.mono-agent-workflow/orchestrator/<product>",
  "node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity",
  "node scripts/install-local.mjs",
  "node scripts/project-config.mjs",
  "none",
  "notes",
  "orchestration.transport",
  "orchestration.workerAudience",
  "orchestrator",
  "outcome",
  "owner-session",
  "ownerPrincipal",
  "pack-identity",
  "packVersion",
  "package_kind",
  "park-and-restart-project-first",
  "pass",
  "pass | blocked",
  "pass | deferred | not-run",
  "phase",
  "product_name",
  "project",
  "project-config",
  "project-first",
  "protocol.json",
  "qaAuth",
  "question",
  "quiescence",
  "read",
  "ready",
  "recommendation",
  "recorded",
  "recorded-late",
  "references/artifact-intake.md",
  "references/artifact-quality.md",
  "references/autoreview-routing.md",
  "references/contracts/issue.md",
  "references/human-friendly-output.md",
  "references/install.md",
  "references/issue-only-lane.md",
  "references/lifecycle.md",
  "references/orchestration.md",
  "references/questioning.md",
  "references/readiness-gates.md",
  "references/repair-machine.md",
  "references/review-rubric.md",
  "references/ship-feedback-loop.md",
  "references/versioning.md",
  "repair",
  "reports",
  "required_artifacts",
  "result",
  "review",
  "risk",
  "risk_class",
  "risky",
  "route_revision",
  "run",
  "sandbox_workspace_write.network_access",
  "scope",
  "scope-drift-needs-handoff",
  "scripts/resolve-issue-context.mjs",
  "second-voice",
  "separate-follow-up-project",
  "ship-unchanged-or-cancel",
  "skills/mono-check/SKILL.md",
  "skills/mono-deploy/SKILL.md",
  "skills/mono-handoff/SKILL.md",
  "skills/mono-idea/SKILL.md",
  "skills/mono-implement/SKILL.md",
  "skills/mono-issue/SKILL.md",
  "skills/mono-orchestrate/SKILL.md",
  "skills/mono-preflight/SKILL.md",
  "skills/mono-review/SKILL.md",
  "skills/mono-ship/SKILL.md",
  "source",
  "sourceCommit",
  "stage",
  "stale_or_ignored",
  "standard",
  "stat -c %Y",
  "stat -f %m",
  "state",
  "state.offset += bytesRead",
  "status",
  "surfaceRevision",
  "templates/compact-instructions.md",
  "templates/deploy-output.md",
  "templates/orchestrator-brief.md",
  "templates/orchestrator-compaction-hook.sh",
  "templates/orchestrator-dispatch.md",
  "templates/orchestrator-report.md",
  "templates/review-output.md",
  "templates/ship-output.md",
  "templates/ship-status-ux.md",
  "templates/tech-spec.md",
  "test-account",
  "tests",
  "thread.started",
  "timed-out",
  "tiny",
  "token-claims-v1",
  "unavailable",
  "unavailable: <reason>",
  "unknown",
  "unresolved",
  "verification_items",
  "verify-pack-state.mjs",
  "verify-pack-state.mjs identity",
  "watch-workers.mjs",
  "wave-cost.mjs",
  "workers.json",
  "workflows.qa",
  "} while (args.once && oneShotNeedsRescan)",
  "~/.claude/skills",
  "~/.codex/skills/",
  "Блокирующие замечания:",
  "В работе сейчас:",
  "Дальше по очереди:",
  "Изменилось после твоего одобрения:",
  "К сведению:",
  "Как починить:",
  "Контекст: ~N%",
  "Можешь потрогать:",
  "Нарушение контракта:",
  "Нужно от тебя (<N> решений):",
  "Нужно от тебя:",
  "Нужно твоё решение:",
  "Обещал — не сделал:",
  "Почему сейчас:",
  "Предложенные исправления:",
  "Расхождения:",
  "Ревью Linear:",
  "Ревью Linear: <ready|advisory-ready|needs-fixes|blocked>",
  "Рекомендация:",
  "Решений от тебя:",
  "Решил сам:",
  "Следующий unblock:",
  "Следующий контакт:",
  "Смысл:",
  "Статус ревью:",
  "Тематический проект:",
  "Техника (можно не читать):",
  "Учтённые learnings:",
  "Цена волны:",
  "Чего не хватает:",
  "Чем рискуем:",
  "Что пошло не так:",
  "Что решаем:",
  "Что уже доказано:"
]);

// Document skeleton and existing machine shapes; agent-only rules stay in text and review.
// Prose is deliberately not an input to these predicates. The four artifact
// contracts retain their existing bounded fingerprints in validateArtifactContractParity.
let rejectedStringPins = 0;
function requireMachineToken(token) {
  if (!MACHINE_TOKENS.has(token)) {
    rejectedStringPins++;
    fail(`String pin outside MACHINE_TOKENS: ${JSON.stringify(token)}`);
    return false;
  }
  return true;
}
function assertIncludes(relativePath, token, label = token) {
  if (requireMachineToken(token) && !read(relativePath).includes(token)) {
    fail(`${relativePath} missing machine token ${label}`);
  }
}
// Only a section's own lines count. A nested heading, a code example, or a
// second section of the same name cannot donate a missing lane field.
function documentSection(text, title) {
  const lines = [];
  let active = false, matches = 0, fence = null;
  for (const line of text.split("\n")) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (delimiter) {
      if (fence === null) fence = delimiter[1][0];
      else if (delimiter[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) { active = heading[2] === title; if (active) matches++; continue; }
    if (active) lines.push(line);
  }
  return matches === 1 ? lines : null;
}
// The four lane fields are the explicit, bounded dictionary exception.
const LANE_FIELDS = [
  ["Deterministic Project-first fallback", "Promotion mode:", "forbidden"],
  ["Pre-code exit", "Exit disposition:", "park-and-restart-project-first"],
  ["Post-`ready` exit", "Expansion destination:", "separate-follow-up-project"],
  ["Post-`ready` exit", "Frozen slice disposition:", "ship-unchanged-or-cancel"],
];
function laneFieldFaults(text) {
  const faults = [];
  for (const [section, field, expected] of LANE_FIELDS) {
    requireMachineToken(field); requireMachineToken(expected);
    const lines = documentSection(text, section);
    if (lines === null) { faults.push(`${section}: missing or duplicate section`); continue; }
    const values = lines.map((line) => line.trim()).filter((line) => line.startsWith(field))
      .map((line) => line.slice(field.length).trim());
    if (values.length !== 1) faults.push(`${field} missing or duplicate field`);
    else if (values[0] !== expected) faults.push(`${field} dictionary mismatch`);
  }
  return faults;
}
function validateDocumentSkeleton() {
  for (const [file, token] of STRING_PINS) assertIncludes(file, token);
  for (const [file, heading] of REQUIRED_HEADINGS) {
    if (!read(file).split("\n").some((line) => /^#{1,6}\s+/.test(line) && line.replace(/^#{1,6}\s+/, "").trim() === heading)) fail(`${file}: missing required heading ${heading}`);
  }
  failures.push(...laneFieldFaults(read("references/issue-only-lane.md")));
  console.log(`Prose-pin counter = ${rejectedStringPins}; machine-token list self-check ${rejectedStringPins ? "red" : "green"}.`);
}
// Mode declarations are a machine dictionary, separate from explanatory prose.
function validateCheckModeDeclaration() {
  requireMachineToken("Modes:"); requireMachineToken("repair");
  const lines = documentSection(read("skills/mono-check/SKILL.md"), "Mono Check") || [];
  const starts = lines.flatMap((line, index) => line === "Modes:" ? [index] : []);
  const modes = [];
  if (starts.length === 1) for (const line of lines.slice(starts[0] + 1)) {
    if (!line.trim()) continue;
    const entry = /^- `([^`]+)`$/.exec(line);
    if (!entry) break;
    modes.push(entry[1]);
  }
  if (modes.filter((mode) => mode === "repair").length !== 1) fail("mono-check Modes: missing or duplicate repair declaration");
}
function readTierBounds(text) {
  const now = /^Read now(?:\s|:|$).*$/m.exec(text);
  const when = /^Read when(?:\s|:|$).*$/m.exec(text);
  if (!now || !when || when.index <= now.index) return null;
  const start = when.index + when[0].length;
  let end = start, started = false;
  for (const line of text.slice(start).split("\n")) {
    if (/^(?:- |\d+\. )/.test(line)) started = true;
    else if (started && line.trim() && !/^\s/.test(line)) break;
    end += line.length + 1;
  }
  return { now: now.index, start, end: Math.min(end, text.length) };
}
function validateReadFirstTierContract() {
  for (const skill of listSkillNames()) {
    const file = `skills/${skill}/SKILL.md`, text = read(file);
    const tier = readTierBounds(text);
    if (!tier) { fail(`${file}: missing or unordered read tiers`); continue; }
    if (extractReadFirstEntries(text).paths[0] !== "AGENTS.md") fail(`${file}: AGENTS.md must be the first eager read`);
    const conditional = text.slice(tier.start, tier.end);
    for (const line of conditional.split("\n")) {
      if (/^\d+\.\s/.test(line.trim())) fail(`${file}: numbered conditional read`);
      if (line.startsWith("- ") && !/^-(?:\s+`[^`]+`,?)+\s+—\s+\S/.test(line)) fail(`${file}: conditional read needs a path and a condition`);
    }
  }
  const tiered = ["Read first:", "Read now:", "1. `AGENTS.md`", "2. `references/lifecycle.md`", "Read when:", "- `references/issue-only-lane.md` — fixture `lifecycle_state_entity=issue`", "", "End."].join("\n");
  if (extractReadFirstEntries(tiered).paths.join("|") !== "AGENTS.md|references/lifecycle.md") fail("read-tier fixture: conditional path leaked into eager reads");
  const misplaced = tiered.replace("2. `references/lifecycle.md`", "2. `references/lifecycle.md` — fixture `lifecycle_state_entity=issue`");
  if (!extractReadFirstEntries(misplaced).paths.includes("lifecycle_state_entity=issue") || validateReadFirstPath("lifecycle_state_entity=issue")) fail("read-tier fixture: eager condition must fail path validation");
  for (const field of ["Статус ревью:", "Review timeline:"]) {
    if (read("skills/mono-ship/SKILL.md").includes(field)) fail(`mono-ship re-inlines ${field}`);
  }
  const certificate = "mono-preflight certificate\nPreflight: <ready|blocked|drift-candidate|needs-human>";
  requireMachineToken(certificate);
  if (read("skills/mono-preflight/SKILL.md").split(certificate).length !== 2) fail("mono-preflight certificate must appear exactly once");
}
function validateDocumentBoundaries() {
  const check = read("skills/mono-check/SKILL.md");
  for (const token of ["templates/review-output.md", "Linear review:", "Ревью Linear:"]) {
    requireMachineToken(token);
    if (check.includes(token)) fail(`mono-check must not carry review output ${token}`);
  }
  const bannedHeadings = {
    "templates/project.md": ["Lifecycle", "Документы", "План задач", "Ревью-гейт", "Текущий статус"],
    "templates/tech-spec.md": ["Skill contracts", "mono-check design", "Дизайн mono-check", "Дизайн mono-review"],
  };
  for (const [file, headings] of Object.entries(bannedHeadings)) for (const heading of headings) {
    if (read(file).split("\n").some((line) => /^#{1,6}\s+/.test(line) && line.replace(/^#{1,6}\s+/, "").trim() === heading)) fail(`${file}: forbidden workflow heading ${heading}`);
  }
  for (const file of ["skills/mono-ship/SKILL.md", "templates/ship-output.md"]) if (read(file).includes("pr-created")) fail(`${file}: retired terminal status pr-created`);
  for (const file of ["skills/mono-preflight/SKILL.md", "README.md", "CHANGELOG.md", "examples/zeni-dogfood.md"]) if (read(file).includes("`tiny` ->")) fail(`${file}: duplicate canonical autoreview route`);
  const dispatch = read("templates/orchestrator-dispatch.md");
  if (dispatch.includes("pass | deferred | not-run")) fail("dispatch duplicates the report's verification status dictionary");
  const report = read("templates/orchestrator-report.md");
  const records = fencedBlocks(report).filter((block) => block.trim().startsWith("{"));
  if (!records.length) fail("report must keep its JSON machine shapes");
  // surfaceRevision is numeric in both report and registry examples, not a
  // quoted placeholder. Parse the actual blocks, as the model-policy parser does.
  for (const block of records) {
    if (!block.includes('"surfaceRevision"')) continue;
    try {
      const value = JSON.parse(block.replaceAll("<repeat the dispatch pin, integer>", "1"));
      const record = value["<ISSUE-KEY>"] || value;
      if (!Number.isInteger(record.surfaceRevision)) fail("report surfaceRevision must be an integer");
    } catch (error) { fail(`report JSON shape: ${error.message}`); }
  }
}

function validateAe6Fixtures() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-document-schema-"));
  const originals = new Map();
  const file = (name) => path.join(scratch, name);
  function change(name, transform) {
    const before = fs.readFileSync(file(name), "utf8"), after = transform(before);
    if (typeof after !== "string" || after === before) throw new Error(`AE6 mutation made no change: ${name}`);
    if (!originals.has(name)) originals.set(name, before);
    fs.writeFileSync(file(name), after);
    if (fs.readFileSync(file(name), "utf8") !== after) throw new Error(`AE6 mutation read-back failed: ${name}`);
  }
  function restore() {
    for (const [name, before] of originals) fs.writeFileSync(file(name), before);
    originals.clear();
  }
  const check = () => runNode([file("scripts/validate-workflow.mjs"), "--document-skeleton-only"], { cwd: scratch });
  function negative(label, mutate, expected) {
    const before = failures.length;
    try { mutate(); expectCommandFailure(label, check, expected); }
    finally { restore(); check(); }
    if (failures.length === before) console.log(`PASS AE6 ${label}: red, restored green`);
  }
  try {
    for (const name of ["skills", "references", "templates", "scripts", "docs/ru", "AGENTS.md", "README.md", "CHANGELOG.md", "examples"]) {
      fs.cpSync(path.join(root, name), file(name), { recursive: true });
    }
    check();
    // Select prose by its section and paragraph shape, never its wording.
    // Prefixing contextual wording preserves the rule and works after a prior
    // editorial rewrite too; no baseline sentence is required by the fixture.
    for (const [name, heading] of [
      ["skills/mono-implement/SKILL.md", "Mono Implement"],
      ["references/issue-only-lane.md", "Post-`ready` exit"],
      ["references/orchestration.md", "Cost Telemetry"],
    ]) change(name, (text) => {
      const paragraph = documentSection(text, heading)?.join("\n").split(/\n\s*\n/)
        .map((block) => block.trim()).find((block) => /^[A-Za-z]/.test(block) &&
          !/^[A-Za-z][A-Za-z -]*:/.test(block) && /[.!?]$/.test(block));
      if (!paragraph) throw new Error(`AE6 missing prose paragraph: ${name} / ${heading}`);
      return text.replace(paragraph, "In this workflow, " + paragraph[0].toLowerCase() + paragraph.slice(1));
    });
    check();
    // Re-run the entire AE6 suite against already reworded documents. The
    // child still exercises every fixture; only recursive rehearsal stops.
    if (!process.argv.includes("--ae6-reworded-tree")) {
      runNode([file("scripts/validate-workflow.mjs"), "--ae6-fixtures", "--ae6-reworded-tree"], { cwd: scratch });
      console.log("PASS AE6 reworded tree: complete AE6 suite green");
    }
    restore(); check();
    console.log("PASS AE6 equivalent prose: skill, lane and cost rewordings green");
    negative("required section removed", () => change("references/issue-only-lane.md", (text) => text.replace("### Post-`ready` exit\n", "")), "missing or duplicate section");
    for (const [, field, value] of LANE_FIELDS) {
      negative(`required lane field removed: ${field}`, () => change("references/issue-only-lane.md", (text) => text.replace(`${field} ${value}\n`, "")), `${field} missing or duplicate field`);
    }
    negative("protected destination weakened with headings and identifiers intact", () => {
      change("references/issue-only-lane.md", (text) => {
        const weakened = text.replace("Expansion destination: separate-follow-up-project", "Expansion destination: current-project");
        const structure = (body) => body.split("\n").filter((line) => /^#{1,6} /.test(line)).join("\n") + "\n" +
          [...body.matchAll(/^([A-Za-z][A-Za-z -]+):/gm)].map((match) => match[1]).join("\n");
        if (structure(text) !== structure(weakened)) throw new Error("AE6 weakening changed a heading or field identifier");
        return weakened;
      });
    }, "Expansion destination: dictionary mismatch");
    negative("arbitrary sentence pin", () => change("scripts/validate-workflow.mjs", (text) => text.replace(
      "\nvalidateDocumentSkeleton();", '\nassertIncludes("README.md", "This arbitrary sentence must never become a pin.");\nvalidateDocumentSkeleton();')), "String pin outside MACHINE_TOKENS");
    negative("contract edited without fingerprint refresh", () => change("references/contracts/issue.md", (text) => text + "\nFixture edit.\n"), "fingerprint");
    negative("field donated by nested section", () => change("references/issue-only-lane.md", (text) => text.replace(
      "Expansion destination: separate-follow-up-project", "#### Nested fixture\n\nExpansion destination: separate-follow-up-project")), "Expansion destination: missing or duplicate field");
    negative("duplicate field", () => change("references/issue-only-lane.md", (text) => text.replace(
      "Promotion mode: forbidden", "Promotion mode: forbidden\nPromotion mode: forbidden")), "Promotion mode: missing or duplicate field");
    negative("forbidden template heading", () => change("templates/project.md", (text) => text.replace(
      "# Что\n", "# Lifecycle\n\n# Что\n")), "forbidden workflow heading Lifecycle");
    negative("report field removed", () => change("templates/orchestrator-report.md", (text) => text.replace(
      '  "question": "<question text, or null>",\n', "")), "missing mandatory machine field");
    negative("repair mode declaration removed with prose intact", () => change("skills/mono-check/SKILL.md", (text) => text.replace(
      "- `repair`\n", "")), "Modes: missing or duplicate repair declaration");
    change("skills/mono-deploy/SKILL.md", (text) => text.replace(/^(\d+)(\. `cost`:)/m, (_, ordinal, suffix) => `${ordinal === "99" ? "98" : "99"}${suffix}`));
    check(); restore(); check();
    console.log("PASS AE6 cost step renumbering: green");
  } catch (error) {
    fail(`AE6 fixtures failed: ${error.message}\n${error.stdout || ""}\n${error.stderr || ""}`);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

// Named workflow steps are machine identifiers; ordinal changes are editorial.
function namedWorkflowStep(text, id) {
  const lines = text.split("\n");
  let start = -1, end = lines.length, count = 0;
  for (let index = 0; index < lines.length; index++) {
    const match = /^\d+\.\s+`([^`]+)`(?:\s|:|$)/.exec(lines[index]);
    if (match?.[1] === id) { count++; start = index; }
    else if (start >= 0 && /^\d+\.\s/.test(lines[index]) && end === lines.length) end = index;
  }
  return count === 1 ? lines.slice(start, end).join("\n") : null;
}
function validateCostCommandStructure() {
  const deploy = namedWorkflowStep(read("skills/mono-deploy/SKILL.md"), "cost");
  const status = read("skills/mono-orchestrate/SKILL.md");
  for (const [label, text, field] of [["deploy cost step", deploy, "Cost:"], ["orchestrator status", status, "Цена волны:"]]) {
    if (text === null) { fail(`${label}: missing or duplicate named step`); continue; }
    for (const token of ["../.mono-agent-workflow/scripts/wave-cost.mjs", field, "unavailable: <reason>"]) {
      requireMachineToken(token);
      if (!text.includes(token)) fail(`${label}: missing command operand ${token}`);
    }
  }
  if (exists("skills/mono-issue-intake")) fail("Retired skills/mono-issue-intake directory must be absent");
}
function validateMachineShapes() {
  function example(file, predicate) {
    const records = [];
    for (const block of fencedBlocks(read(file))) {
      if (!block.trim().startsWith("{")) continue;
      try { records.push(JSON.parse(block.replaceAll("<repeat the dispatch pin, integer>", "1"))); }
      catch { continue; }
    }
    const matches = records.filter(predicate);
    if (matches.length !== 1) { fail(`${file}: missing or duplicate machine example`); return null; }
    return matches[0];
  }
  function fields(record, required, label) {
    required.forEach(requireMachineToken);
    if (!record || required.some((field) => !Object.hasOwn(record, field))) fail(`${label}: missing mandatory machine field`);
  }
  const report = example("templates/orchestrator-report.md", (value) => value.issue === "<ISSUE-KEY>");
  fields(report, ["issue", "stage", "status", "packVersion", "sourceCommit", "surfaceRevision", "branch", "changed_files", "tests", "verification_items", "question", "recommendation", "linear_mutations_pending", "certificate", "notes", "next"], "worker report");
  if (report) {
    fields(report.tests, ["run", "result"], "report tests");
    fields(report.verification_items?.[0], ["item", "status", "evidence"], "verification item");
    const status = report.verification_items?.[0]?.status;
    requireMachineToken("pass | deferred | not-run");
    if (status !== "pass | deferred | not-run") fail("verification item: closed status dictionary changed");
  }
  const ack = example("references/orchestration.md", (value) => value.phase === "gate");
  fields(ack, ["issue", "phase", "gates", "status"], "gate ack");
  if (ack) {
    fields(ack.gates?.[0], ["gate", "status", "evidence"], "gate ack entry");
    if (ack.status !== "gates-passed | blocked" || ack.gates?.[0]?.status !== "pass | blocked") fail("gate ack: status dictionary changed");
  }
  const consumption = example("references/orchestration.md", (value) => Object.hasOwn(value, "attempt") && Object.hasOwn(value, "outcome"));
  fields(consumption, ["issue", "attempt", "outcome"], "consumption record");
  if (consumption && (!Number.isInteger(consumption.attempt) || consumption.outcome !== "applied | rejected | blocked")) fail("consumption record: attempt or outcome dictionary changed");
}

failures.push(...checkModelPolicy(root));
if (!process.argv.includes("--ae6-fixtures") && !process.argv.includes("--document-skeleton-only") && !process.argv.includes("--model-policy-only") && failures.length === 0) validateModelPolicyFixtures();
if (process.argv.includes("--model-policy-only") || process.argv.includes("--model-policy-fixtures")) {
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
  console.log("Model policy validation passed.");
  process.exit(0);
}

validateDocumentSkeleton();
validateCheckModeDeclaration();
validateDocumentBoundaries();
validateCostCommandStructure();
validateMachineShapes();
if (process.argv.includes("--document-skeleton-only") || process.argv.includes("--ae6-fixtures")) {
  validateSkills();
  validateReadFirstTierContract();
  validateProjectUpdateSurface();
  validateOwnerLayerProcedureSurface();
  validateOwnerLayerDocumentsBareIssueKeyFree();
  validateOwnerLayerDocumentsFenceFree();
  validateOwnerLayerMapParser();
  validateOwnerLayerMap();
  validateOwnerLayerConstitutionParser();
  validateOwnerLayerConstitution();
  validateArtifactContractParity();
  validateRepairAndRoutingContract();
  validateRegistryGateContract();
  validateCostTemplateFields();
  validateStatusTemplateFields();
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
  if (process.argv.includes("--ae6-fixtures")) validateAe6Fixtures();
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
  console.log("Document skeleton validation passed."); process.exit(0);
}

validateSkills();
validateReadFirstTierContract();
validateProjectUpdateSurface();
validateOwnerLayerProcedureSurface();
validateOwnerLayerDocumentsBareIssueKeyFree();
validateOwnerLayerDocumentsFenceFree();
validateRetiredAdapterReferenceAllowlist();
validateOwnerLayerMapParser();
validateOwnerLayerMap();
validateOwnerLayerConstitutionParser();
validateOwnerLayerConstitution();
validateArtifactContractParity();
validateRepairAndRoutingContract();
validatePackIdentityAndQuiescenceBehavior();
validateLocalInstallBehavior();
validateMultiRootInstallBehavior();
validateBreakingInstallBehavior();
validateProjectConfigBehavior();
validateIssueOnlyLaneBehavior();
validateWatcherContaminationBehavior();
await validateWatcherInactiveGateSpawnBehavior();
await validateWatcherV3Behavior();
validateWatcherGateAckBehavior();
validateGateAckSuppressionPredicate();
validateCompactionContract();
validateRegistryGateContract();
validateCostTemplateFields();
validateWaveCostBehavior();
validateAe6Fixtures();
validateStatusTemplateFields();

if (failures.length > 0) {
  console.error("Mono workflow validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Mono workflow validation passed (${listSkillNames().length} skills checked).`);
