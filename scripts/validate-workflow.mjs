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
const FROZEN_ADAPTER_DESCRIPTION_LINES = {};

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

function assertIncludes(relativePath, text, label = text) {
  const body = read(relativePath);
  if (!body.includes(text)) fail(`${relativePath} missing ${label}`);
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

    const frozenDescriptionLine = FROZEN_ADAPTER_DESCRIPTION_LINES[skill];
    if (frozenDescriptionLine) {
      const actualDescriptionLine = text.split("\n").find((line) => line.startsWith("description:"));
      if (actualDescriptionLine !== frozenDescriptionLine) {
        fail(`${relativePath} compatibility-adapter description changed; it is frozen until Phase B`);
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

    if (/thin adapter/i.test(text) || /Resolve and follow/i.test(text)) {
      fail(`${relativePath} looks like a redirect adapter`);
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
    const body = read(relativePath);
    if (retiredReference.test(body)) {
      fail(
        `${relativePath} references a retired Project/PRD/Tech Spec adapter outside the historical migration allowlist`
      );
    }
  }
}

function validateTemplateSections() {
  const requiredSections = {
    "templates/prd.md": [
      "## Акторы",
      "## Текущий процесс",
      "## Требования",
      "## Примеры приемки",
      "## Что должна доказать проверка",
      "## Критерии успеха",
      "## Допущения",
      "## Открытые вопросы",
      "## Связи",
    ],
    "templates/tech-spec.md": [
      "## Исходные требования",
      "## Контракты и границы",
      "### Реальные ответы бэкенда",
      "## Единицы реализации",
      "## Влияние на остальную систему",
      "## Что может сломаться и как защищаемся",
      "## Валидация",
      "## Релиз и откат",
    ],
    "templates/issue.md": [
      "# Прочитать сначала",
      "# Готовность агента",
      "# Зависимости",
      "# Ключевые контракты",
      "# Текущее поведение",
      "# Желаемое поведение",
      "# Шаги воспроизведения",
      "# Ревью-гейт",
      "# Снимок контекста",
      "# Как проверить",
      "# Критерии приемки",
      "# Что не входит",
    ],
    "templates/project.md": ["# Что", "# Зачем", "# Образ результата", "# Что входит", "# Что не входит"],
    "templates/review-output.md": [
      "Ревью Linear: <ready|advisory-ready|needs-fixes|blocked>",
      "Блокирующие замечания:",
      "Предложенные исправления:",
      "Нужно твоё решение:",
      "К сведению:",
      "Do not use `PASS`, `FAIL`, or `BLOCKED` as the review status.",
    ],
    "templates/ship-output.md": [
      "Preflight: <ready/blocked/drift-candidate/needs-human/not run>",
      "Bug/perf proof: <not applicable or original symptom/baseline + fix proof + regression proof/gap>",
    ],
    "templates/deploy-output.md": [
      "Deploy status:",
      "Ship certificate: <found/missing/stale>",
      "Deploy workflow:",
      "Learnings recorded:",
    ],
    "templates/check-output.md": [
      "Смысл:",
      "Чего не хватает:",
      "Расхождения:",
      "Следующий unblock:",
      "Нарушение контракта:",
      "Как починить:",
    ],
    "templates/orchestrator-dispatch.md": [
      "## Assignment",
      "## Goal Contract",
      "## Engine",
      "## Context Snapshot",
      "## AFK Contract",
      "## Mailbox",
      "## Authorization",
      "Do not ask the user",
      "Never write to Linear yourself",
      "no sub-workers",
      "~/.codex/skills/",
      ".orchestrator/",
    ],
    "templates/orchestrator-brief.md": [
      "Что решаем:",
      "Почему сейчас:",
      "Что уже доказано:",
      "Рекомендация:",
      "Решил сам:",
      "Нужно от тебя:",
    ],
    "templates/orchestrator-report.md": [
      "\"issue\"",
      "\"stage\"",
      "\"status\"",
      "\"verification_items\"",
      "\"question\"",
      "\"recommendation\"",
      "\"linear_mutations_pending\"",
      "\"notes\"",
      "needs-decision",
      "needs-human",
      "drift-candidate",
      "## Ledger Entry",
      "## Worker Registry",
      "workers.json",
    ],
  };

  for (const [relativePath, sections] of Object.entries(requiredSections)) {
    if (!exists(relativePath)) {
      fail(`Missing template: ${relativePath}`);
      continue;
    }
    for (const section of sections) assertIncludes(relativePath, section);
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

function validateReviewCheckBoundary() {
  const review = read("skills/mono-review/SKILL.md");
  const check = read("skills/mono-check/SKILL.md");

  for (const required of [
    "report-only",
    "must not create, update, delete, or silently repair",
    "Do not use `PASS`, `FAIL`, or `BLOCKED`",
    "`mono-review` is report-only",
  ]) {
    if (!review.includes(required)) fail(`mono-review skill boundary missing: ${required}`);
  }

  if (check.includes("templates/review-output.md") || check.includes("Linear review:") || check.includes("Ревью Linear:")) {
    fail("mono-check must not use the review output template");
  }

  if (!check.includes("Do not emit review findings")) fail("mono-check must explicitly avoid review findings");
  if (!check.includes("Never edit Project, documents, or Issues from `mono-check`")) {
    fail("mono-check must be strictly readiness-only");
  }
  if (!check.includes("return `FAIL` if the required `mono-review` gate is missing")) {
    fail("mono-check must fail missing required review gates");
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
  for (const [fixture, expectedClass] of classificationFixtures.filter(([, value]) => value === "3")) {
    const rowPattern = new RegExp(
      "^\\| `" + fixture + "` \\| [^|]+ \\| `" + expectedClass + "` \\| ([^|]+) \\|$",
      "m"
    );
    const requiredResult = repairContract.match(rowPattern)?.[1]?.toLowerCase() ?? "";
    for (const required of ["supersede approval", "invalidate dependants", "require owner re-approval", "roll back delivery"]) {
      if (!requiredResult.includes(required)) {
        fail(`Repair class 3 fixture ${fixture} required result missing ${JSON.stringify(required)}`);
      }
    }
  }

  const classTwoEffectFixtures = [
    {
      name: "snapshot-sync",
      required: [
        "## Class 2 effect fixture: snapshot-sync",
        "implementation-critical fields",
        "re-derive each affected Issue snapshot fingerprint",
      ],
    },
    {
      name: "stale-preflight-cert",
      required: [
        "## Class 2 effect fixture: stale-preflight-cert",
        "issued before the repair mutation",
        "must rerun `mono-preflight`",
      ],
    },
    {
      name: "stale-worker-stop",
      required: [
        "## Class 2 effect fixture: stale-worker-stop",
        "stop or quiesce every affected active worker before the repair mutation",
        "dispatch snapshot fingerprint differs from the re-derived fingerprint",
        "stop before any further implementation step",
      ],
    },
  ];
  for (const fixture of classTwoEffectFixtures) {
    for (const required of fixture.required) {
      if (!repairContract.includes(required)) {
        fail(`Class 2 ${fixture.name} fixture missing ${JSON.stringify(required)}`);
      }
    }
  }

  const classTwoOrderingPins = [
    { path: "skills/mono-handoff/SKILL.md", mutation: "synchronizes" },
    { path: "references/lifecycle.md", mutation: "synchronizes" },
    { path: "references/repair-machine.md", mutation: "apply the previewed artifact repair" },
  ];
  for (const { path: relativePath, mutation } of classTwoOrderingPins) {
    const body = read(relativePath).replace(/\s+/g, " ").toLowerCase();
    const workerStop = body.indexOf("stops or quiesces every affected active worker before any repair mutation");
    const snapshotSync = body.indexOf(mutation);
    if (workerStop < 0) {
      fail(`${relativePath} must front-load the class 2 affected-worker stop`);
    } else if (snapshotSync < 0 || workerStop > snapshotSync) {
      fail(`${relativePath} must stop affected workers before class 2 snapshot mutation`);
    }
  }

  for (const required of [
    "Accepted pre-ship drift is a terminal ownership override evaluated before the general existing-Project route",
    "exact before/after diff grouped by stable ID",
    "unchanged R/AE/AC, non-goals, risk class, and Issue set",
    "Ambiguity is class 3",
    "Class 1 keeps package and implementation-start approvals valid",
    "must not update Issue bodies, Issue snapshots, fingerprints, certificates, worker dispatches, Issue slicing, or Project lifecycle state",
    "Project-first implementation-start approval is bound to the unchanged scope and Issue set, not to an Issue snapshot fingerprint",
    "fresh dispatch is the required non-owner re-authorization",
    "stop affected workers before rollback",
    "supersede the implementation-start approval",
    "invalidate dependent Tech Spec, Issue snapshots, certificates, and Issue slicing",
    "move a Delivery Project back to Discovery",
    "stop workers -> supersede approvals -> invalidate dependants -> Delivery to Discovery -> rebuild -> review/check -> owner re-approval",
    "owner re-approval",
  ]) {
    if (!repairContract.includes(required)) fail(`Repair-machine contract missing ${JSON.stringify(required)}`);
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

  const skillPins = {
    "skills/mono-handoff/SKILL.md": [
      "references/repair-machine.md",
      "repair mode",
      "`mono-review artifact`",
      "Do not use repair mode for accepted pre-ship drift",
    ],
    "skills/mono-review/SKILL.md": [
      "references/repair-machine.md",
      "- `artifact`",
      "proposed repair class",
      "report-only",
    ],
    "skills/mono-check/SKILL.md": [
      "references/repair-machine.md",
      "`repair`",
      "readiness-only",
    ],
    "references/review-rubric.md": [
      "Repair classification",
      "stable-ID diff",
      "Ambiguity or risk growth is class 3",
    ],
    "references/lifecycle.md": [
      "## Artifact Repair",
      "issue-only body renewal",
      "accepted pre-ship drift",
    ],
    "AGENTS.md": [
      "`mono-handoff` = project-first package creation and artifact repair",
      "`mono-issue` = issue-only intake and renewal",
      "accepted pre-ship drift",
    ],
  };
  for (const [relativePath, pins] of Object.entries(skillPins)) {
    for (const pin of pins) assertIncludes(relativePath, pin, JSON.stringify(pin));
  }

  const routingFixtures = [
    ["skills/mono-idea/SKILL.md", "raw idea", "mono-idea", "pre-ship drift routes to mono-ship"],
    ["skills/mono-issue/SKILL.md", "unmistakably one-PR projectless", "renewal"],
    ["skills/mono-handoff/SKILL.md", "existing Project or shaped discovery", "PRD or Tech Spec repair"],
    ["skills/mono-ship/SKILL.md", "pre-ship drift", "mono-ship"],
  ];
  for (const [relativePath, ...signals] of routingFixtures) {
    const frontmatter = parseFrontmatter(read(relativePath));
    for (const signal of signals) {
      if (!frontmatter?.description?.includes(signal)) {
        fail(`${relativePath} description missing routing signal ${JSON.stringify(signal)}`);
      }
    }
  }
}

function validateLocalInstallBehavior() {
  const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mono-workflow-skills-"));
  const installedResolver = path.join(skillsRoot, ".mono-agent-workflow", "scripts", "resolve-issue-context.mjs");
  const installedPackVerifier = path.join(skillsRoot, ".mono-agent-workflow", "scripts", "verify-pack-state.mjs");
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
    if (!installedIssue.includes("create-then-approve renewal") || installedIssue.includes("internal/advanced atomic helper")) {
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

    // The "missing installed runtime script" branch: a deleted resolver is
    // flagged (mirrors the copied-asset missing-file test).
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.rmSync(installedResolver, { force: true });
    expectCommandFailure(
      "install-local --check missing runtime script fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "Missing installed runtime script"
    );

    // The "unexpected" branch: an extra file under the canonical scripts dir is
    // flagged (mirrors the copied-asset unexpected-file test).
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.writeFileSync(path.join(skillsRoot, ".mono-agent-workflow", "scripts", "stray.mjs"), "// stray\n");
    expectCommandFailure(
      "install-local --check unexpected runtime script fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "Unexpected installed runtime script"
    );

    // The tamper scan walks the whole .mono-agent-workflow/ root: a file planted
    // one level up (not under scripts/) is flagged too.
    runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot]);
    fs.writeFileSync(path.join(skillsRoot, ".mono-agent-workflow", "evil.mjs"), "// evil\n");
    expectCommandFailure(
      "install-local --check pack-root stray file fixture",
      () => runNode(["scripts/install-local.mjs", "--skills-root", skillsRoot, "--check"]),
      "Unexpected installed runtime script"
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

    for (const [relativePath, required] of [
      ["templates/orchestrator-dispatch.md", ["packVersion", "sourceCommit", "surfaceRevision"]],
      ["templates/orchestrator-report.md", ["packVersion", "sourceCommit", "surfaceRevision", "control.json"]],
    ]) {
      for (const field of required) assertIncludes(relativePath, field, JSON.stringify(field));
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

function validatePackIdentityWorkflowContract() {
  assertIncludes("scripts/verify.mjs", "verify-pack-state.mjs", "pack-state syntax verification");

  for (const relativePath of ["references/install.md", "references/versioning.md"]) {
    for (const required of ["packVersion", "sourceCommit", "surfaceRevision", "verify-pack-state.mjs"]) {
      assertIncludes(relativePath, required, `${relativePath}: ${required}`);
    }
  }

  for (const relativePath of [
    "skills/mono-implement/SKILL.md",
    "skills/mono-preflight/SKILL.md",
    "skills/mono-ship/SKILL.md",
  ]) {
    for (const required of [
      "verify-pack-state.mjs identity",
      "packVersion",
      "sourceCommit",
      "surfaceRevision",
      "blocked",
    ]) {
      assertIncludes(relativePath, required, `${relativePath}: ${required}`);
    }
  }

  for (const required of [
    "control.json",
    "`active` → `draining` → `idle`",
    "`~/.mono-agent-workflow/install.lock`",
    "token-scoped claim",
    "`protocol.json`",
    "`claim-<token>.json`",
    "bytewise ASCII token order",
    "hold the lock through read-back",
    "unreadable lock fails closed",
    "verify-pack-state.mjs identity",
    "remove the Issue entry from `workers.json`",
    "surfaceRevision differs",
    "do not rebind",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }

  for (const required of [
    "control.json",
    "active",
    "draining",
    "idle",
    "surfaceRevision",
    "Acquire `~/.mono-agent-workflow/install.lock`",
    "before creating the product root",
    "before an `idle` → `active` transition",
  ]) {
    assertIncludes("skills/mono-orchestrate/SKILL.md", required, JSON.stringify(required));
  }
  assertIncludes(
    "skills/mono-deploy/SKILL.md",
    "remove the Issue entry from `workers.json`",
    "deploy retirement contract"
  );

  // Resume rebind is stricter than issue-only discovery: a live thread belongs
  // to the surface it was dispatched under and cannot be rebound after a
  // breaking surface change, even when the thread id still exists.
  const canRebindWorker = (entry, installedIdentity) =>
    entry.surfaceRevision === installedIdentity.surfaceRevision;
  const installedIdentity = { surfaceRevision: 1 };
  if (!canRebindWorker({ surfaceRevision: 1 }, installedIdentity)) {
    fail("resume identity fixture must rebind a matching surfaceRevision");
  }
  if (canRebindWorker({ surfaceRevision: 3 }, installedIdentity)) {
    fail("resume identity fixture must not rebind a mismatched surfaceRevision");
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
      if (!installedIssue.includes("create-then-approve renewal") || installedIssue.includes("internal/advanced atomic helper")) {
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
  // String pins: the doc fixes the marker line, the five marker fields, the
  // 5-field contract, the marker ≠ route-record boundary, and the fail-closed
  // invariant.
  for (const pin of [
    "mono-issue-only marker",
    "Marker version: 1",
    "Scope fingerprint",
    "Acceptance IDs",
    "Risk class",
    "Approval",
    "маркер ≠ route-record",
    "route_revision",
    "assurance_vector",
    "required_artifacts",
    "package_kind",
    "lifecycle_state_entity",
    "behavioral_oracle",
    "issue-verification",
    "risk_class",
    "approval_status",
    "no marker ⇒ `package_kind=project-first`",
    "scripts/resolve-issue-context.mjs",
    "Not a spine-resolver",
    // MONO-19: config opt-in gate + the canonical installed resolver path.
    "opt-in gate",
    "issueOnlyLane.enabled: true",
    "ownerPrincipal",
    "config-gated per repository",
    "owner decision on 2026-07-17",
    ".mono-agent-workflow/scripts/resolve-issue-context.mjs",
  ]) {
    assertIncludes("references/issue-only-lane.md", pin);
  }

  // MONO-16: downstream delivery consumes the resolver seam without changing
  // the existing Project-first path. These pins keep the prose contracts tied
  // to the executable escalation fixture below.
  for (const required of [
    "Resolve the 5-field context seam before changing lifecycle state",
    "`lifecycle_state_entity=issue`",
    "`approval_status=approved-fresh`",
    "Run `mono-check delivery` in issue-only mode",
    "Project-first branch remains unchanged",
    "A `project` lifecycle entity does not prove that Project artifacts exist",
    "A resolver integrity error (`broken marker` or `stale marker`) is a hard `needs-human` stop",
    "A successful fail-closed `project-first` result from an issue-only candidate triggers the deterministic pre-code fallback",
    "Before coding: park the Issue, supersede the marker approval, and restart Project-first",
  ]) {
    assertIncludes("skills/mono-implement/SKILL.md", required, JSON.stringify(required));
  }
  const implementDelivery = read("skills/mono-implement/SKILL.md");
  const issueOnlyDeliveryCheck = implementDelivery.indexOf("Run `mono-check delivery` in issue-only mode");
  const issueOnlyLifecycleMove = implementDelivery.indexOf("Move the **Issue** into its configured started/in-progress state");
  if (issueOnlyDeliveryCheck > issueOnlyLifecycleMove) {
    fail("mono-implement issue-only delivery check must pass before the Issue moves to started/in-progress");
  }
  for (const required of [
    "compare the diff against `behavioral_oracle` plus the live `scope_fingerprint`",
    "preserve the existing risk-escalation rule",
    "`deep` or `risky` is a `drift-candidate`",
    "do not treat it as a genuine Project-first package",
    "After `ready`: freeze the independently shippable slice",
  ]) {
    assertIncludes("skills/mono-preflight/SKILL.md", required, JSON.stringify(required));
  }
  for (const required of [
    "No in-place Issue-to-Project promotion",
    "Pre-code exit",
    "Post-`ready` exit",
    "Approval: superseded",
    "frozen approval remains valid only while the whole-body fingerprint matches",
    "separate follow-up Project",
  ]) {
    assertIncludes("references/issue-only-lane.md", required, JSON.stringify(required));
  }

  // MONO-17 / fixture 5 — parentless ship gate. The ship contract must consume
  // the same five-field seam, keep a freshly approved issue-only package out of
  // handoff, fail closed for an absent/stale marker, and preserve the mandatory
  // standard+ pre-ship review.
  for (const required of [
    "Resolve the 5-field context seam before deciding whether to route to `mono-handoff`",
    "`package_kind=issue-only` with `approval_status=approved-fresh`",
    "do not route the parentless Issue to `mono-handoff`",
    "An absent marker resolves `project-first` and routes the parentless candidate through the deterministic fallback to `mono-handoff`",
    "A `stale marker` resolver error is a hard stop that routes back to `mono-handoff`",
    "Project-first ship behavior remains unchanged",
    "Required `mono-review pre-ship` runs for `standard`, `deep`, `risky`",
  ]) {
    assertIncludes("skills/mono-ship/SKILL.md", required, JSON.stringify(required));
  }

  // MONO-17 / fixture 6 — deploy live Issue oracle. Prepare must be seam-shaped,
  // issue-only live QA must walk every Issue AC-ID, oracle drift must fail (never
  // become a skip), and design acceptance is omitted when no prototype exists.
  for (const required of [
    "Resolve the 5-field context seam before package-specific prepare fetches",
    "Project and PRD/Tech Spec as `n/a`",
    "walk every `behavioral_oracle.acceptance_ids` entry in AC1..ACn order",
    "Oracle drift is a failed live QA gate, never a skipped sweep",
    "skip design acceptance when no approved prototype exists",
    "Project-first deploy behavior remains unchanged",
  ]) {
    assertIncludes("skills/mono-deploy/SKILL.md", required, JSON.stringify(required));
  }

  // MONO-18 / fixture 7 — check modes, dispatch snapshot, and resume-discovery.
  // Every issue-only check mode must use the same verified seam instead of
  // Project/PRD/Spec presence, dispatch must carry the complete worker world,
  // and resume must discover only open, parentless, label-selected candidates
  // that re-resolve issue-only/approved-fresh.
  for (const required of [
    "Before applying `issue`, `delivery`, `pre-ship`, or `post-ship` mode requirements",
    "`package_kind=issue-only`, `lifecycle_state_entity=issue`, and `approval_status=approved-fresh`",
    "`issue` (issue-only lane)",
    "`delivery` (issue-only lane)",
    "`pre-ship` (issue-only lane)",
    "`post-ship` (issue-only lane)",
    "Missing marker or a fail-closed `project-first` result never waives Project-first requirements",
  ]) {
    assertIncludes("skills/mono-check/SKILL.md", required, JSON.stringify(required));
  }
  assertIncludes(
    "skills/mono-check/SKILL.md",
    "Project moved to Delivery with PRD and Tech Spec but no approved execution Issue or no implementation-start approval.",
    "hard-FAIL Project-in-Delivery-without-approved-Issue must remain unchanged",
  );

  for (const required of [
    "PRD: <full text, the sections relevant to this Issue, or `n/a (issue-only)`>",
    "Tech Spec: <full text, the contracts relevant to this Issue, or `n/a (issue-only)`>",
    "Issue-only marker: <current marker comment verbatim, or `n/a (project-first)`>",
    "Verified label: <`issue-only`, or `n/a (project-first)`>",
    "Scope fingerprint: <fresh whole-body SHA-256, or `n/a (project-first)`>",
    "Issue-only config: <`enabled=true; ownerPrincipal=<stable Linear user ID>`, or `n/a (project-first)`>",
    "Owner approval: <authenticated author plus approved fingerprint, or `n/a (project-first)`>",
    "Context seam: <resolved 5-field JSON, or `n/a` when resolution is blocked>",
  ]) {
    assertIncludes("templates/orchestrator-dispatch.md", required, JSON.stringify(required));
  }

  for (const required of [
    "query open parentless Issues carrying the verified `issue-only` label",
    "re-run the 5-field context seam",
    "Only `package_kind=issue-only` plus `approval_status=approved-fresh` is resumable",
    "Missing label or marker is not discovered as issue-only",
    "unverified reconstruction fails closed",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }

  // MONO-25 activates the config-gated lane for this upstream repository.
  // Intake still leaves a package non-startable; mono-implement alone moves the
  // Issue after the delivery check, and every repository remains config-opt-in.
  for (const [relativePath, required] of [
    ["skills/mono-issue/SKILL.md", "Intake never moves the Issue to started; `mono-implement` owns activation"],
    ["skills/mono-idea/SKILL.md", "live only when `issueOnlyLane.enabled: true` and `ownerPrincipal` are configured"],
    ["references/artifact-rules.md", "intake remains non-activating; `mono-implement` owns the later Issue lifecycle move"],
    ["references/issue-only-lane.md", "Intake remains non-activating"],
    ["references/issue-only-lane.md", "config-gated per repository"],
    ["references/issue-only-lane.md", "owner decision on 2026-07-17"],
  ]) {
    assertIncludes(relativePath, required, JSON.stringify(required));
  }
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

function validateIssueIntakeContract() {
  // MONO-33: mono-issue is the issue-only front door. Pins anchor the
  // load-bearing intake, renewal, and fail-closed routing prose; the
  // create-then-approve transaction remains backed by the byte-stable resolver.
  for (const required of [
    "nine eligibility conditions",
    "Prequalification",
    "intake-authorized draft mode",
    "create-then-approve",
    "scripts/resolve-issue-context.mjs",
    "--emit-fingerprint",
    "--issue <issue-body> --emit-fingerprint",
    "--issue <live-issue-body> --emit-fingerprint",
    "--approval-verified",
    "whole-body",
    "non-startable Issue",
    "Run the mandatory review gate on the drafted body",
    "readiness check before activation",
    "Phase-1 go-live boundary",
    "prepared, approved, non-startable package",
    "`mono-implement` owns activation",
    "label first, marker last",
    "On any error, roll back the partial state",
    "Renewal recovery differs from first-time rollback",
    "failed renewal must remove or supersede that previous marker",
    ".mono-agent-workflow/scripts/resolve-issue-context.mjs",
    "owner principal's stable Linear user ID",
    "issueOnlyLane.ownerPrincipal",
    "explicit owner decision",
    "record that decision as a Linear approval comment naming the exact fingerprint",
    "capture the comment author's stable Linear user ID for read-back",
    "Never self-approve",
    "маркер ≠ route-record",
    "route_revision",
    "`issue-only` label",
    "fails closed to Project-first",
    "Do not add a second hashing path",
    "Project relation or Project/PRD/Tech Spec chips",
    "request asks for Issue slicing",
    "deep, risky, multi-surface, cross-cutting, or ambiguous",
    "create-then-approve renewal",
    "Apply `IS-001` through `IS-034`",
    "stop this skill without rendering or mutating an Issue",
    "the destination lifecycle owner applies the Project-first rules",
  ]) {
    assertIncludes("skills/mono-issue/SKILL.md", required, JSON.stringify(required));
  }
  if (exists("skills/mono-issue-intake")) {
    fail("Retired skills/mono-issue-intake directory must be absent");
  }
  const issueFrontDoor = read("skills/mono-issue/SKILL.md");
  if (issueFrontDoor.includes("internal/advanced atomic helper")) {
    fail("mono-issue still contains the retired atomic-adapter behavior");
  }

  // mono-idea guard: names the issue-only front door but keeps Project-first as
  // the default and mandatory for the idea path (does not weaken the terminal
  // Project-creation contract).
  for (const required of [
    "Issue-only front door",
    "`mono-issue`",
    "Project creation stays mandatory",
    "Route unmistakably one-PR, projectless issue-only work to the `mono-issue` front door",
  ]) {
    assertIncludes("skills/mono-idea/SKILL.md", required, JSON.stringify(required));
  }

  // Issue-contract guard: the bounded contract names the post-cut-over writer
  // split, delegates issue-only behavior to the lane contract, and keeps the
  // project-first source and chip rules explicit under mono-handoff ownership.
  for (const required of [
    "owns the Project-first branch from Project, PRD, and Tech Spec context",
    "`mono-issue` owns only unmistakable projectless issue-only intake and renewal",
    "front door and must refuse Project relations",
    "issue-only Issue body may change only through `mono-issue` renewal",
    "full create-then-approve",
    "pre-ship drift is the terminal override and belongs to `mono-ship`",
    "## IS-005 — Issue-only branch",
    "[issue-only lane contract](../issue-only-lane.md) in full",
    "## IS-008 — Project-first sources",
    "`mono-handoff` branch, build a project-first Issue from Project, PRD, and",
    "## IS-019 — Project-first chips",
    "Their presence makes `mono-issue` refuse the request",
  ]) {
    assertIncludes("references/contracts/issue.md", required, JSON.stringify(required));
  }
  assertIncludes("skills/mono-issue/SKILL.md", "references/contracts/issue.md", "bounded Issue contract source");

  // mono-check guard: idea/issue modes are issue-only-aware so the two intake
  // entry paths (projectless idea route, self-contained issue-only Issue) do not
  // hit a mandatory false failure from the project-first check modes.
  for (const required of [
    "no Project was created by design",
    "judge it against the issue-only contract",
  ]) {
    assertIncludes("skills/mono-check/SKILL.md", required, JSON.stringify(required));
  }

  // mono-review guard: an issue-only review mode judges the self-contained
  // Issue without requiring Project/PRD/Tech Spec, so the intake review gate is
  // satisfiable for projectless standard work.
  for (const required of [
    "the self-contained Issue is the sole artifact and source of truth",
    "Intake-authorized draft",
  ]) {
    assertIncludes("skills/mono-review/SKILL.md", required, JSON.stringify(required));
  }
  // The mandatory review-output template must offer the issue-only mode so a
  // mono-review issue-only run can state its actual mode and still conform.
  assertIncludes("templates/review-output.md", "issue-only", '"issue-only" in review-output mode enum');

  // artifact-rules: the issue-only approval contract is the whole-body scope
  // fingerprint, produced by the create-then-approve transaction.
  for (const required of [
    "the issue-only lane, package approval is the scope fingerprint",
    "whole-body SHA-256 of the Issue contract",
    "create-then-approve intake transaction",
  ]) {
    assertIncludes("references/artifact-rules.md", required, JSON.stringify(required));
  }
}

function validateDocsAndExamples() {
  for (const [relativePath, texts] of Object.entries({
    "README.md": [
      "mono-implement",
      "mono-preflight",
      "mono-deploy",
      "autoreview",
      "node scripts/install-local.mjs",
      "node scripts/project-config.mjs",
      "--all-roots",
      "~/.claude/skills",
      "per-root",
      "Review/check split",
      "Delivery ladder",
      "Autonomy with transparency",
    ],
    "AGENTS.md": [
      "`mono-review` = report-only quality/risk review",
      "`mono-implement` = Delivery Start",
      "`mono-preflight` = local branch readiness",
      "mandatory `autoreview` clean gate",
      "`mono-deploy` = deploy workflow delegation",
      "Keep `mono-review` report-only",
      "Project repos must keep only `.agents/mono-workflow.config.json`",
    ],
    "examples/zeni-dogfood.md": [
      "Risk-Based Review Gate Examples",
      "Zeni keeps only `.agents/mono-workflow.config.json`",
      "Use the local skill pack installed from this upstream repo",
      "Correct Risky Handoff Review",
      "Correct Implement To Preflight To Ship",
      "Anti-Example: Ship Owns Deploy",
      "Anti-Example: Vendored Project Install",
      "Correct Tiny Advisory Review",
      "Anti-Example: Required Review Skipped",
      "Anti-Example: Review Mutates Linear",
      "Anti-Example: Preflight Owns Ship",
    ],
    "references/artifact-intake.md": [
      "Do not perform broad home-directory scans",
      "Artifact roots",
      "`read`",
      "`unavailable`",
      "`stale_or_ignored`",
      "`conflicts`",
      "`decisions_carried_forward`",
      "`confidence_boundary`",
    ],
    "references/readiness-gates.md": ["`tiny`:", "`standard`:", "`deep`:", "`risky`:", "references/autoreview-routing.md", "Tiny Output Profile"],
    "references/autoreview-routing.md": [
      "`tiny` | `gpt-5.6-luna` | `low`",
      "`standard` | `gpt-5.6-luna` | `medium`",
      "`deep` | `gpt-5.6-sol` | `high`",
      "`risky` | `gpt-5.6-sol` | `high`",
      "`risky` with critical escalation | `gpt-5.6-sol` | `xhigh`",
      "Never rely on the external `autoreview` helper's built-in model default",
      "Do not silently fall back",
      "at least as capable as the code's producer",
      "PROVISIONAL pending live-QA validation of the",
      "hermes-dashboard waves",
      "if live QA surfaces defects that Luna-reviewed code shipped",
      "`standard` re-tiers to `gpt-5.6-sol` / `medium`",
      "`gpt-5.6-sol` (same-model review)",
      "no-test-edits rule",
      "cross-vendor review whenever the worker",
      "Cross-vendor review is deliberately not a code-review requirement",
    ],
    "references/artifact-quality.md": ["## PRD", "## Tech Spec", "## Issue", "## Review Findings", "## Preflight Certificate"],
    "references/human-friendly-output.md": ["## Machine Blocks In Linear Comments", "## Linear Exit Comments"],
    "references/execution-quality.md": ["## PRD Coverage", "## Durable Issue Writing", "## Agent Readiness", "## Bug And Performance Proof", "## Architecture Lens"],
    "references/review-rubric.md": ["Allowed review verdicts:", "`ready`", "`advisory-ready`", "`needs-fixes`", "`blocked`"],
    "references/install.md": [
      "local skill pack",
      ".agents/mono-workflow.config.json",
      "does not vendor `autoreview`",
      "--all-roots",
      "~/.claude/skills",
      ".mono-agent-workflow.lock.json",
      "MONO_WORKFLOW_KNOWN_ROOTS",
      "per-root",
      "references/autoreview-routing.md",
    ],
    "references/orchestration.md": [
      "## Roles",
      "## Stage Ownership",
      "## Decision Authority",
      "## Worker Transports",
      [
        "### Sandbox ladder",
        "",
        "Sandbox grants follow a stage ladder: `mono-implement` uses `workspace-write` without network; `mono-preflight` adds network and writable main-checkout `.git` while retaining the writable orchestrator root for mailbox delivery; `mono-ship` keeps those grants and permits push.",
        "",
        "| Stage | Sandbox mode and grants | Why |",
        "| --- | --- | --- |",
        "| `mono-implement` | `workspace-write`, no network, plus the writable orchestrator root | Edit only the linked worktree and deliver the mailbox report. |",
        "| `mono-preflight` | `workspace-write`, network, writable main-checkout `.git`, plus the writable orchestrator root | Run the review helper, commit from the linked worktree, and deliver the mailbox report. |",
        "| `mono-ship` | The `mono-preflight` grants, with push permitted | Push the branch, create and stabilize the PR, and keep mailbox delivery available. |",
        "| Any stage that edits a protected hidden directory such as `.agents` | An explicit writable grant for that exact directory | Codex protects dot-directories even when their worktree is writable. |",
        "",
        "Escalating to a fully disabled sandbox is not normal operation; record it in `ledger.md` as a deviation with the reason.",
      ].join("\n"),
      "## Mailbox And Ledger",
      "## Monitoring Protocol",
      "## Decision Briefs",
      "## Resume",
      "claude-code-desktop",
      "deployApproval",
      "any risk class except `tiny` under `risky-only`",
      "«Решил сам:»",
      "scope-drift-needs-handoff",
      "codex-cli",
      "codex exec resume",
      "Resume does not accept the global `--cd`, `--sandbox`, or `--add-dir` flags; any of them in a resume command is a contract error — set the working directory with `cd` and grants through `-c` overrides.",
      "--add-dir",
      "workers.json",
      "sandbox_workspace_write.network_access",
      "git worktree add",
    ],
    "references/questioning.md": [
      "`mono-deploy`: ask only for deploy approval",
      "## Autonomy Defaults",
      "/design-html",
    ],
    "references/versioning.md": [
      "`Autoreview helper`",
      "`Artifact roots`",
      "`Implementation workflow`",
      "`Documentation workflow`",
      "`Deploy workflow`",
      "project config",
      "references/autoreview-routing.md",
    ],
  })) {
    if (!exists(relativePath)) {
      fail(`Missing ${relativePath}`);
      continue;
    }
    for (const text of texts) assertIncludes(relativePath, text);
  }
}

function validateAntiPatterns() {
  const review = read("skills/mono-review/SKILL.md");
  if (/Final response must include:[\s\S]*PASS/.test(review)) {
    fail("mono-review final response must not use PASS/FAIL/BLOCKED statuses");
  }

  const handoff = read("skills/mono-handoff/SKILL.md");
  if (!handoff.includes("Apply accepted review fixes in `mono-handoff`")) {
    fail("mono-handoff must own accepted review fixes");
  }
  if (!handoff.includes("references/artifact-intake.md")) {
    fail("mono-handoff must use artifact intake before package synthesis");
  }
  for (const required of [
    "`read`",
    "`unavailable`",
    "`stale_or_ignored`",
    "`conflicts`",
    "`decisions_carried_forward`",
    "`confidence_boundary`",
  ]) {
    if (!handoff.includes(required)) fail(`mono-handoff must expose artifact intake field: ${required}`);
  }
  if (!handoff.includes("Artifact intake, one Russian sentence")) {
    fail("mono-handoff final response must carry artifact intake one-sentence Russian rendering");
  }
  if (!handoff.includes("The structured intake record")) {
    fail("mono-handoff final response must reference the structured intake record location");
  }
  if (!handoff.includes("Do not move the Project to Delivery from `mono-handoff`")) {
    fail("mono-handoff must not own Delivery Start");
  }
  if (!handoff.includes("это одновременно approval на старт кода")) {
    fail("mono-handoff option 2 must label the bundled approval");
  }
  if (!handoff.includes("«Решил сам:»")) {
    fail("mono-handoff must include «Решил сам:» ledger in package approval UX");
  }
  if (!handoff.includes("Always-ask list")) {
    fail("mono-handoff rules must reference the Always-ask list in questioning.md");
  }

  const implement = read("skills/mono-implement/SKILL.md");
  for (const required of [
    "Use this skill to own Delivery Start",
    "Run or report `mono-check delivery`",
    "Move the Project to Delivery only after approval and prerequisites are explicit",
    "after the Project is in Delivery",
    "missing or `None`",
    "Implementation workflow",
    "implemented-needs-preflight",
    "scope-drift-needs-handoff",
    "Implementation-start approval UX:",
    "Что это разрешает: Project переходит в Delivery",
    "post a short Russian Linear exit comment on the Issue following the Linear Exit Comments rule",
    "For `tiny` work, follow the Tiny Output Profile in references/readiness-gates.md",
    "gstack-learnings-search",
    "Учтённые learnings:",
  ]) {
    if (!implement.includes(required)) fail(`mono-implement contract missing: ${required}`);
  }

  const ship = read("skills/mono-ship/SKILL.md");
  if (!ship.includes("`mono-review` is report-only; `mono-ship` owns accepted pre-ship drift sync")) {
    fail("mono-ship must own accepted pre-ship drift sync");
  }
  if (!ship.includes("read the latest `mono-preflight certificate`")) {
    fail("mono-ship must consume the preflight certificate when present");
  }
  if (!ship.includes("If no certificate exists, route to `mono-preflight` before continuing")) {
    fail("mono-ship must require a preflight certificate before ship");
  }
  if (!ship.includes("Linear comments or resources")) {
    fail("mono-ship must recover the preflight certificate from Linear");
  }
  for (const required of ["Documentation workflow", "mono-ship green certificate", "Next: mono-deploy", "Poll interval: 10 minutes"]) {
    if (!ship.includes(required) && !read("references/ship-feedback-loop.md").includes(required)) {
      fail(`mono-ship ladder contract missing: ${required}`);
    }
  }
  if (/Land workflow|configured land workflow|land\/deploy workflow/i.test(ship)) {
    fail("mono-ship must not reference old Land workflow or own deploy");
  }
  if (ship.includes("pr-created")) fail("mono-ship must not keep pr-created as a terminal ship verdict");

  const deploy = read("skills/mono-deploy/SKILL.md");
  for (const required of [
    "Requires `mono-ship green certificate`",
    "Deploy workflow",
    "gstack land-and-deploy",
    "mono-check post-ship",
    "gstack-learnings-log",
    "Do not run `/learn prune`, `/learn export`, `/learn stats`",
    "Do not accept `Land workflow` as a compatibility alias",
    "deployApproval",
    "Готов деплоить",
    "gstack-learnings-search",
    "Learnings consulted:",
    "re-tier review per `references/autoreview-routing.md`",
  ]) {
    if (!deploy.includes(required)) fail(`mono-deploy contract missing: ${required}`);
  }

  const preflight = read("skills/mono-preflight/SKILL.md");
  for (const required of [
    "owns local branch readiness only",
    "`ready`",
    "`blocked`",
    "`drift-candidate`",
    "`needs-human`",
    "mono-preflight certificate",
    "Issue(s): <keys>",
    "Branch: <branch>; commit state: <clean/dirty/committed>",
    "Changed files: <count/list or summary>",
    "Local verification: <commands run + outcome>",
    "Autoreview: <clean|blocked|needs-human|unavailable>; final command: <selected-scope helper command>; clean result: <exit 0 + clean line or none>",
    "Autoreview route: risk=<tiny|standard|deep|risky>; source=<Linear artifact or diff inference>; critical=<none|concrete escalation signal>; model=<gpt-5.6-luna|gpt-5.6-sol>; effort=<low|medium|high|xhigh>; reclassified=<no|summary>",
    "Autoreview loop: <iterations>; accepted findings fixed: <none/list>; residual actionable findings: <none/list, must be none for ready>",
    "Drift candidate: <none/summary>",
    "Not checked: <manual QA/browser/mobile/deploy/etc.>",
    "Next: <mono-ship | mono-handoff | needs-human>",
    "Do not run or claim `mono-review pre-ship`",
    "Do not run or claim `mono-check pre-ship`",
    "Do not create the final PR",
    "Preflight certificate shape",
    "Invoke the installed `autoreview` skill/helper",
    "Do not substitute Compound `ce-code-review`, built-in `/review`, ad hoc self-review, reviewer panels, or a hand-written summary",
    "Treat helper exit 0 plus the clean result",
    "Before emitting `ready`, run one final clean review for the selected durable scope",
    "Pass `--engine codex`, `--model`, and `--thinking` explicitly on every helper invocation",
    "never use GPT-5.5 as a normal route",
    "Reclassify the final risk",
    "then re-select the model and effort from `references/autoreview-routing.md`",
    "or a new or stronger critical signal requires a higher route",
    "the earlier clean result does not count",
    "A clean local dirty-work review alone is not sufficient",
    "Do not cap the review loop at an arbitrary round count",
    "Do not call Compound `ce-code-review` for this gate",
    "Do not silently reject a repeated `autoreview` finding and mark `ready`",
    "Decision needed: <none | точное решение по-русски>",
    "For `tiny` work, follow the Tiny Output Profile in references/readiness-gates.md",
  ]) {
    if (!preflight.includes(required)) fail(`mono-preflight boundary missing: ${required}`);
  }
  const forbiddenRoutingCopies = [
    "`tiny` ->",
    "Luna/low for `tiny`",
    "maps `tiny`/`standard` to explicit GPT-5.6 Luna",
  ];
  for (const relativePath of ["skills/mono-preflight/SKILL.md", "README.md", "CHANGELOG.md", "examples/zeni-dogfood.md"]) {
    const body = read(relativePath);
    for (const duplicate of forbiddenRoutingCopies) {
      if (body.includes(duplicate)) {
        fail(`${relativePath} must not duplicate the canonical autoreview routing table: ${duplicate}`);
      }
    }
  }

  const shipOutput = read("templates/ship-output.md");
  if (!shipOutput.includes("Preflight: <ready/blocked/drift-candidate/needs-human/not run>")) {
    fail("ship output template must preserve preflight status boundary");
  }
  if (shipOutput.includes("pr-created")) fail("ship output template must stay focused on green/needs-human/blocked/timed-out");
  for (const required of ["mono-ship green certificate", "Documentation workflow", "Next: <mono-deploy | needs-human | blocked>"]) {
    if (!shipOutput.includes(required)) fail(`ship output template missing ladder field: ${required}`);
  }

  const deployOutput = read("templates/deploy-output.md");
  for (const required of ["Ship certificate: <found/missing/stale>", "Deploy workflow", "Learnings recorded", "stale certificates"]) {
    if (!deployOutput.includes(required)) fail(`deploy output template missing: ${required}`);
  }

  const check = read("skills/mono-check/SKILL.md");
  if (!check.includes("local branch readiness is known through a `mono-preflight` certificate")) {
    fail("mono-check pre-ship must require the preflight certificate");
  }
  if (!check.includes("project-config")) fail("mono-check must expose project-config mode");
  if (check.includes("generated consumer skills are full executable copies")) {
    fail("mono-check must not enforce the removed generated consumer install contract");
  }

  const dogfood = read("examples/zeni-dogfood.md");
  for (const banned of [
    "Zeni `.agents/skills/mono-*` contains generated full copies from upstream",
    "Zeni `.claude/skills/mono-*` contains tiny discovery wrappers to `.agents`",
    "Zeni stores consumer policy in `.agents/mono-workflow.config.md`",
    "Install generated full skills into Zeni",
  ]) {
    if (dogfood.includes(banned)) fail(`Zeni dogfood example preserves removed install contract: ${banned}`);
  }

  const techSpecContract = read("references/contracts/tech-spec.md");
  if (techSpecContract.includes("mono-review design")) {
    fail("Tech Spec contract must not reference unsupported mono-review design mode");
  }

  const projectTemplate = read("templates/project.md");
  for (const banned of ["# Lifecycle", "# Документы", "# План задач", "# Ревью-гейт", "# Текущий статус"]) {
    if (projectTemplate.includes(banned)) fail(`Project template must not expose workflow dashboard section: ${banned}`);
  }

  const techSpecTemplate = read("templates/tech-spec.md");
  for (const banned of ["## Skill contracts", "## mono-check design", "## Дизайн mono-check", "## Дизайн mono-review"]) {
    if (techSpecTemplate.includes(banned)) fail(`Tech Spec template must not expose workflow mechanics section: ${banned}`);
  }

  // New dual-layer comment contract pins (plan 005)
  if (!preflight.includes("<1-2 предложения по-русски: итог и следующий шаг>")) {
    fail("mono-preflight human comment shape missing Russian human-lead placeholder");
  }
  if (!preflight.includes("The Russian human lead (1-2 sentences) is required")) {
    fail("mono-preflight must require the Russian human lead in Linear comment");
  }

  if (!deploy.includes("Выкатили: <что получили пользователи>; проверено на <среда>.")) {
    fail("mono-deploy closeout shape missing required product-outcome Russian lead");
  }
  if (!deploy.includes("The Russian product-outcome lead is required in Linear")) {
    fail("mono-deploy must require the Russian product-outcome lead");
  }

  const idea = read("skills/mono-idea/SKILL.md");
  if (!idea.includes("Выйди из Plan Mode (или перезапусти /mono-idea в обычном режиме) — я создам Project в статусе Idea.")) {
    fail("mono-idea blocked message missing Russian unblock instruction");
  }
  if (!idea.includes("BLOCKED / INCOMPLETE - mono-idea cannot complete because")) {
    fail("mono-idea blocked message must preserve English marker line");
  }

  const orchestrate = read("skills/mono-orchestrate/SKILL.md");
  for (const required of [
    "control plane",
    "never implement, edit code, fix CI, or rewrite PRs",
    "Single Linear writer",
    "One Issue per worker",
    "no-sub-delegation",
    "scope-drift-needs-handoff",
    "Do not steer an actively progressing worker",
    "«Решил сам:»",
    "references/orchestration.md",
    "templates/orchestrator-dispatch.md",
    "templates/orchestrator-brief.md",
    "templates/orchestrator-report.md",
    "deployApproval",
    "Session verdicts:",
    "timed-out",
    "~/.mono-agent-workflow/orchestrator/<product>/",
    "`mono-implement` owns Delivery Start",
    "codex-cli",
    "workers.json",
    "codex exec resume",
    "orchestration.transport",
    "maxParallelWorkers",
    "Director Discovery",
    "UX checkpoint",
    "Touch the user only at checkpoints",
    "Second Voice",
  ]) {
    if (!orchestrate.includes(required)) fail(`mono-orchestrate contract missing: ${required}`);
  }
  if (!implement.includes("not available in the current runtime")) {
    fail("mono-implement must define the engine runtime-availability fallback");
  }
  if (!ship.includes("not available in the current runtime")) {
    fail("mono-ship must define the workflow runtime-availability fallback");
  }
  assertIncludes("references/questioning.md", "`mono-orchestrate`: ask only for Always-ask escalations");
  assertIncludes("references/questioning.md", "## Orchestrated Mode");
  assertIncludes("references/lifecycle.md", "## Orchestration");
  assertIncludes("references/orchestration.md", "## Director Discovery");
  assertIncludes("references/orchestration.md", "near-production");
  assertIncludes("references/orchestration.md", "never a first draft");
  assertIncludes("references/orchestration.md", "### Second Voice");
  assertIncludes("references/orchestration.md", "a different model family from the orchestrator");
  assertIncludes("references/orchestration.md", "A same-model Second Voice is not an acceptable fallback");
  assertIncludes("references/orchestration.md", "never talks to the user, never writes");
  assertIncludes("references/questioning.md", "Director Discovery");
  assertIncludes("references/questioning.md", "Second Voice");
  assertIncludes("references/lifecycle.md", "Director Discovery");
  assertIncludes("references/lifecycle.md", "Second Voice");
  assertIncludes("templates/orchestrator-brief.md", "UX-чекпоинт");
  assertIncludes("README.md", "director mode");
  assertIncludes("README.md", "Second Voice");
  assertIncludes("README.md", "`mono-orchestrate`: control-plane orchestrator");
  assertIncludes("README.md", "Codex CLI worker");
  assertIncludes("AGENTS.md", "`mono-orchestrate` = product-level control plane");
  assertIncludes("references/install.md", "\"orchestration\"");
  assertIncludes("references/install.md", "maxParallelWorkers");
}

function validateHeartbeatContract() {
  if (!exists("scripts/watch-workers.mjs")) {
    fail("Missing scripts/watch-workers.mjs");
  }
  assertIncludes("scripts/verify.mjs", "watch-workers.mjs", "node --check step for scripts/watch-workers.mjs");
  assertIncludes("references/orchestration.md", "Immediately after verifying every spawn, resume, or session rotation, in the same orchestrator turn and before any other action, update that worker's `workers.json` entry with at least the current `pid`, `log`, `last_activity_at`, and `stage` (and the new `thread_id` on rotation). A live worker paired with a stale registry PID violates the registry contract; watcher events produced from that entry are untrustworthy, and investigating any such event must begin by reconciling the registry with the actual writer process.");

  for (const required of [
    "## Heartbeat",
    "thread.started",
    "< /dev/null",
    "empty `thread_id`",
    "watch-workers.mjs",
    "-a1.jsonl",
    "EVENT:<stall|dead|spawn-fail|report|idle>",
    "retired Issues' logs are outside its scope",
    "`report` is emitted only for `codex-cli` workers",
    "read the correlated report and advance the stage pipeline",
    "at-least-once across watcher restarts",
    "deduplicates by reading the report's current state",
    "Non-Codex transports keep their existing report-polling contract",
    "On `idle`, the orchestrator records",
    "the idle period and its cause in `ledger.md`",
    "`--idle-sec` (default 300)",
    "nudge",
    "session rotation",
    "Forced worker termination is a process-tree operation: starting from the worker PID recorded in the registry, enumerate descendants recursively with `pgrep -P`, terminate the captured tree leaf-to-root and the wrapper last (never kill only the wrapper PID), then prove from the captured PID set plus an exact transport-thread-id process search that no survivor remains before resume, respawn, or session rotation. A survivor can retain the transport thread and hang every later resume.",
    "model_reasoning_effort",
  ]) {
    assertIncludes("references/orchestration.md", required);
  }

  for (const required of [
    "watch-workers.mjs",
    "Heartbeat in",
    "before the first spawn",
    "nudge → respawn → session rotation",
    "an empty thread id",
  ]) {
    assertIncludes("skills/mono-orchestrate/SKILL.md", required, `heartbeat contract: ${JSON.stringify(required)}`);
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

function validateHonestLedgerContract() {
  for (const required of [
    "One event per line",
    "actual moment of writing",
    "`recorded-late`",
    "Corrections are new lines",
    "longer than 5 minutes",
    "## Linear Write Verification",
    "read back the mutated entity",
    "a success response alone is not confirmation",
    "silent success-no-op",
    "marked unverified",
    "## Context Budget",
    "«Контекст: ~N%»",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
    "75",
    "compaction-safe",
    "300 seconds",
    "three consecutive deferrals",
    "fourth automatic attempt",
    "post-compaction",
    "session handoff",
    "fallback",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }

  for (const required of ["Простои и отклонения:", "Контекст: ~N%", "not blocking notifications"]) {
    assertIncludes("templates/orchestrator-brief.md", required);
  }

  for (const required of ["«Простои и отклонения:»", "«Контекст: ~N%»"]) {
    assertIncludes("skills/mono-orchestrate/SKILL.md", required, `status update contract: ${required}`);
  }
}

function validateCompactionContract() {
  const hookRelativePath = "templates/orchestrator-compaction-hook.sh";
  const instructionsRelativePath = "templates/compact-instructions.md";

  if (!exists(hookRelativePath)) {
    fail(`Missing ${hookRelativePath}`);
  } else {
    for (const required of [
      "MONO_ORCHESTRATOR_ROOT",
      "MONO_COMPACTION_FRESHNESS_SECONDS:-300",
      "MONO_COMPACTION_MAX_DEFERRALS:-3",
      "get_mtime()",
      "stat -f %m",
      "stat -c %Y",
    ]) {
      assertIncludes(hookRelativePath, required, JSON.stringify(required));
    }

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
    for (const required of [
      "НЕМЕДЛЕННОЕ СЛЕДУЮЩЕЕ ДЕЙСТВИЕ",
      "ЖИВЫЕ ВОРКЕРЫ",
      "workers.json",
      "РЕШЕНИЯ ВЛАДЕЛЬЦА",
      "что НЕ одобрено",
      "РЕШИЛ САМ",
      "ТУПИКИ",
      "ПРОТОКОЛЬНЫЕ ГОТЧИ",
      "ОЧЕРЕДЬ ЗАДАЧ",
      "ПРЕДПОЧТЕНИЯ ВЛАДЕЛЬЦА",
      "Do not include rereadable content",
      "path pointers instead of content",
    ]) {
      assertIncludes(instructionsRelativePath, required, JSON.stringify(required));
    }
  }

  for (const required of [
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
    '"75"',
    '"PreCompact"',
    '"matcher": "auto"',
    "templates/orchestrator-compaction-hook.sh",
    ".claude/settings.json",
    "local and uncommitted",
    ".git/info/exclude",
  ]) {
    assertIncludes("skills/mono-orchestrate/SKILL.md", required, JSON.stringify(required));
  }
}

function validateLiveQaGateContract() {
  for (const required of [
    "Live QA gate",
    "verify the deployed version matches the certified merged SHA",
    "walk the PRD acceptance criteria of the shipped Issue and check the console for errors",
    "prototype approved at the UX checkpoint",
    "never your own taste",
    "functional smoke alone suffices",
    "immediate hotfix Issue out of queue",
    "fix-forward",
    "only after its own live pass is green",
    "own live verification",
    "verify on clean state before calling something a defect",
    "not a gate failure",
    "verify the delivered artifact live",
    "counts as the live pass",
    "workflows.qa",
    "qaAuth",
    "explicit recorded reason",
  ]) {
    assertIncludes("skills/mono-deploy/SKILL.md", required, JSON.stringify(required));
  }

  for (const required of [
    "verify the deployed version matches the certified merged SHA",
    "live QA sweep on the deployed app for user-facing changes",
    "only after its own live pass is green",
    "immediate hotfix Issue out of queue",
    "fix-forward",
    "may excuse only a sweep that did not run, never a failed one",
  ]) {
    assertIncludes("references/lifecycle.md", required, JSON.stringify(required));
  }

  for (const required of [
    "\"qa\"",
    "`workflows.qa` (optional)",
    "`qaAuth` (optional)",
    "cookie-import",
    "test-account",
    "owner-session",
    "involving the owner",
  ]) {
    assertIncludes("references/install.md", required, JSON.stringify(required));
  }

  for (const required of [
    "Live QA gate",
    "workers have no browser",
    "out of queue",
    "control-plane exception",
    "explicit owner mandate",
    "Feature code NEVER",
  ]) {
    assertIncludes("skills/mono-orchestrate/SKILL.md", required, JSON.stringify(required));
  }

  for (const required of [
    "control-plane exception",
    "explicit owner mandate",
    "deploy scripts, infra config, docs address sweeps",
    "feature code never qualifies",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }

  assertIncludes("templates/deploy-output.md", "Live QA:", "Live QA line in deploy status block");
}

function validateRealBackendContractSampling() {
  for (const required of [
    "## TS-015 — Observed backend contracts",
    "response samples covering enum domains, object shapes, and edge records",
    "only endpoint existence",
    "spec/reality mismatch as a spec blocker",
    "when qualification is uncertain, sample",
    "## TS-016 — Unreachable backend fallback",
    "contract-verification spike first in the wave",
  ]) {
    assertIncludes("references/contracts/tech-spec.md", required, JSON.stringify(required));
  }
  assertIncludes(
    "templates/tech-spec.md",
    "record the one-line omission reason",
    '"record the one-line omission reason"'
  );

  for (const required of [
    "sample of real responses from the deployed instance",
    "\"Endpoint exists\" is not contract verification",
    "sampling date and deployed SHA/version",
    "contract-verification spike Issue",
  ]) {
    assertIncludes("references/artifact-quality.md", required, JSON.stringify(required));
  }

  for (const required of [
    "домены enum",
    "крайние записи",
    "дата выборки и SHA/версия деплоя",
    "sampled real responses from the deployed instance",
    "An endpoint list alone does not verify the contract",
    "contract-verification spike Issue that goes first in the wave",
  ]) {
    assertIncludes("templates/tech-spec.md", required, JSON.stringify(required));
  }
}

function validateGoalContractBinding() {
  assertIncludes(
    "skills/mono-orchestrate/SKILL.md",
    "wholesale\n     deferral with no `pass` items, is treated as non-green",
    '"wholesale deferral is non-green"'
  );
  // "## Goal Contract" (dispatch) and "\"verification_items\"" (report) are
  // structural pins owned by validateTemplateSections; phrase pins live here.
  for (const required of [
    "the durable end-state",
    "lifted verbatim from",
    "each runnable as written",
    "what must not change or break",
    "judge your own \"done\"",
    "guidance, not a gate",
  ]) {
    assertIncludes("templates/orchestrator-dispatch.md", required, JSON.stringify(required));
  }

  for (const required of [
    "pass | deferred | not-run",
    "optional in shape but mandatory in coverage",
    "enumerate every «Как проверить» item",
    "require a reason in `evidence`",
    "silently missing",
    "replaces the report `status` set",
  ]) {
    assertIncludes("templates/orchestrator-report.md", required, JSON.stringify(required));
  }

  for (const relativePath of ["skills/mono-implement/SKILL.md", "skills/mono-preflight/SKILL.md"]) {
    for (const required of [
      "enumerates every «Как проверить» item",
      "pass | deferred | not-run",
      "verification_items",
      "cannot claim completion while an item is silently missing",
      "only with a recorded reason",
    ]) {
      assertIncludes(relativePath, required, JSON.stringify(required));
    }
  }
}

// MONO-43: the stage-report contract has one home per fact. The certificate
// lives in `certificate` and is referenced, never copied, from a queued
// mutation; the `verification_items` semantics and status enum are stated
// once in the report template and pointed at from the dispatch template.
function validateReportContractSingleHome() {
  for (const required of [
    "single home of certificate text",
    "appears in the report exactly once",
    "append #/certificate",
    "an integer, never a string",
    "repeat the dispatch pin, integer",
    "One semantics and one status enum, stated here once",
    "The enum is closed",
    "is never a status value",
  ]) {
    assertIncludes("templates/orchestrator-report.md", required, JSON.stringify(required));
  }

  for (const required of [
    "verified as a judgment check",
    "never as a status value",
    "item semantics and the status enum have a single home in",
    "append #/certificate",
  ]) {
    assertIncludes("templates/orchestrator-dispatch.md", required, JSON.stringify(required));
  }

  const dispatchTemplate = read("templates/orchestrator-dispatch.md");
  // `judgment check` describes how an item was verified, never what its
  // status is; the enum has no such value and the dispatch must not mint one.
  // Guard the shape rather than one historical wording: pinning the single
  // phrase this slice removed (`marked `judgment check``) would let the same
  // contract break return as `status: judgment check` or "sets status to
  // judgment check". So the dispatch may name the term only in the sanctioned
  // verification-mode sentence, and every other mention is a failure whatever
  // its phrasing.
  const judgmentMentions = (dispatchTemplate.match(/judgment check/g) ?? []).length;
  const judgmentModeMentions = (dispatchTemplate.match(/verified as a judgment check/g) ?? []).length;
  if (judgmentMentions !== judgmentModeMentions) {
    fail(
      "templates/orchestrator-dispatch.md may name `judgment check` only as the verification mode (\"verified as a judgment check\", recorded in evidence), never as a verification-item status value"
    );
  }
  // Single home: the dispatch points at the enum instead of restating it, so
  // the two templates cannot drift into a second, divergent vocabulary.
  if (dispatchTemplate.includes("pass | deferred | not-run")) {
    fail(
      "the verification_items status enum has a single home in templates/orchestrator-report.md; templates/orchestrator-dispatch.md must point at it, not restate it"
    );
  }
}

function validateReviewLoopHygiene() {
  for (const required of [
    "Before the first resolver cycle on a PR, check the review bots' configuration",
    "fixed via configuration or recorded as an environment fact",
    "never burned down with resolver cycles",
    "does not consume the resolver cycle budget and does not restart the quiet period",
    "Resolver cycle budgets count only novel findings",
    "treat it as novel and keep the thread open",
    "Dedup must never become a channel for dismissing real findings",
    "published, not a pending draft",
    "gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '.[] | select(.state==\"PENDING\")'",
    "Unpublished rationales count as unresolved threads",
    "This submitted-check is a green-certificate precondition",
    "No pending (unsubmitted) review drafts remain for the worker's own reviews",
    "After the authorized final resolver cycle",
    "binds this path too",
    "When in doubt whether a finding is blocking-class, escalate",
    "get deferral replies, filed as a follow-up issue when warranted",
    "proceeds to terminal status",
    "always escalate instead",
  ]) {
    assertIncludes("references/ship-feedback-loop.md", required, JSON.stringify(required));
  }

  for (const required of [
    "Review Bot Configuration Check, Finding Dedup with its fail-safe, Published Replies, and Non-Blocking Convergence rules in `references/ship-feedback-loop.md`",
    "the Published Replies submitted-check is an additional green-certificate precondition",
  ]) {
    assertIncludes("skills/mono-ship/SKILL.md", required, JSON.stringify(required));
  }
}

function validateCostTelemetry() {
  // MONO-7: cost is telemetry, not a gate. Pins anchor the policy text;
  // collection itself is manual agent work and stays judgment, not a pin.
  for (const required of [
    "## Cost Telemetry",
    "LAST `turn.completed` event",
    "sum ACROSS attempts",
    "Review cycles",
    "ship-stage report",
    "Stage wall-clock",
    "ledger at stage close",
    "not a pin-enforceable mechanism",
    "Cost is telemetry, not a gate: no thresholds, no blocking, visibility\nonly.",
    "Never pause, steer, or fail a worker because of cost numbers",
    "never let cost collection delay a stage advance",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }

  for (const required of [
    "цена: ~N тыс. out-токенов, M циклов ревью",
    "«цена: н/д»",
    "## Цена волны (Wave Cost Summary)",
    "Цена волны:",
    "never blocking, never a gate",
    "Cost Telemetry in `references/orchestration.md`",
  ]) {
    assertIncludes("templates/orchestrator-brief.md", required, JSON.stringify(required));
  }

  for (const required of [
    "Cost telemetry: the per-Issue cost tail in the status table",
    "«Цена волны» block",
    "Cost is telemetry,\n  not a gate: it never blocks, pauses, or pages.",
  ]) {
    assertIncludes("skills/mono-orchestrate/SKILL.md", required, JSON.stringify(required));
  }
}

function validateBriefIntegrity() {
  // MONO-8: brief integrity — board-aligned question IDs, self-identifying
  // option tokens, echo-back before acting, no closure by silence, and the
  // post-approval delta list. Pins anchor the contract prose and the
  // user-facing shapes; decoding an owner's answer stays judgment work.
  for (const required of [
    "## Целостность брифа (Brief Integrity)",
    "mirror board section IDs exactly",
    "section-scoped suffixes",
    "(1a, 1b)",
    "Cross-section renumbering is forbidden",
    "1a-КАРТОЧКА / 1a-МОДАЛКА",
    "valid without its number",
    "вопрос → выбранный вариант (дословно)",
    "numbering fault",
    "one-line re-confirm",
    "never closed by silence",
    "no answer means asked again, not resolved",
    "Изменилось после твоего одобрения:",
    "When in doubt\n  whether a change is user-visible, include it in the delta",
  ]) {
    assertIncludes("templates/orchestrator-brief.md", required, JSON.stringify(required));
  }

  for (const required of [
    "mirror board section IDs exactly",
    "section-scoped suffixes",
    "(1a, 1b)",
    "Cross-section renumbering is forbidden",
    "1a-КАРТОЧКА / 1a-МОДАЛКА",
    "valid without its number",
    "вопрос → выбранный вариант (дословно)",
    "numbering fault",
    "one-line re-confirm",
    "never closed by silence",
    "no answer means asked again, not resolved",
    "Изменилось после твоего одобрения:",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }
}

function validateOpsLessons() {
  // MONO-9: operational lessons — install-source SHA blocker (MONO-3 deploy
  // incident), gh-only PR state after interruptions (HD-46), and the forced
  // mid-wave resume drill. Pins anchor the contract prose; resolving a bad
  // checkout, reconciling a PR via gh, and running the drill stay judgment
  // and operational work, not pin-enforceable mechanisms.
  for (const relativePath of ["skills/mono-deploy/SKILL.md", "references/install.md"]) {
    for (const required of [
      "the installing checkout's HEAD must equal the expected merge SHA",
      "git rev-parse HEAD",
      "a DEPLOY BLOCKER, not a warning",
    "never from the local checkout",
      "verify SHA → install → `--check`",
    ]) {
      assertIncludes(relativePath, required, JSON.stringify(required));
    }
  }

  for (const required of [
    "exclusively via `gh` commands against the exact head SHA",
    "never from thread memory",
    "state assumed from memory is treated as unverified",
  ]) {
    assertIncludes("skills/mono-ship/SKILL.md", required, JSON.stringify(required));
  }

  for (const required of [
    "Forced mid-wave resume drill",
    "a planned one-time operational act",
    "not a recurring gate",
    "records every reconstruction discrepancy in the ledger",
    "feeds the PRD wave-1 success criteria",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }
}

// MONO-42 — the worker start seam. Mode precedence has exactly one home in
// references/orchestration.md; the dispatch template and mono-implement point
// at it. The identity gate is documented as an executable command, and
// mono-implement carries an orchestration start-checkpoint branch with zero
// required Linear operations.
function validateOrchestrationModePrecedence() {
  for (const required of [
    "## Orchestration Mode Precedence",
    "The dispatch snapshot is the single source of Linear state in orchestration",
    "queue it in `linear_mutations_pending`",
    "the stage skill wins; where they disagree on a fact",
    "changes who performs a Linear operation, never whether a",
    "Applying that queue is part of consuming the report",
    "BEFORE it advances",
    "Advancing a stage while a report's mutations are still",
    "Queued mutations land only when the orchestrator applies them",
    "do not describe a queued mutation as",
    "reports `needs-decision` for the orchestrator to sequence",
    "lifecycle precondition is therefore sequenced by the",
    "No stage defers an executable check onto a queued mutation",
    "Interactive mode is unchanged",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }

  // Single home: pointers only, never a second copy of the rule.
  const precedenceRule = "The dispatch snapshot is the single source of Linear state in orchestration";
  const precedencePointer = "Orchestration Mode Precedence";
  for (const relativePath of [
    "templates/orchestrator-dispatch.md",
    "skills/mono-implement/SKILL.md",
  ]) {
    if (read(relativePath).includes(precedenceRule)) {
      fail(
        `${relativePath} must point at Orchestration Mode Precedence in references/orchestration.md, not restate the rule`
      );
    }
    assertIncludes(relativePath, precedencePointer, `${relativePath}: mode-precedence pointer`);
    assertIncludes(relativePath, "references/orchestration.md", `${relativePath}: mode-precedence home path`);
  }

  // The identity command is single-quoted in both canonical copies: single
  // quotes are literal in POSIX shells, so a resolved installed-skills root
  // containing spaces or shell metacharacters cannot break the gate.
  for (const required of [
    "### Pack identity gate invocation",
    "node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity",
    "--lock '<installed-skills-root>/.mono-agent-workflow.lock.json'",
    "--pack-version '<dispatch packVersion>'",
    "--source-commit '<dispatch sourceCommit>'",
    "--surface-revision '<dispatch surfaceRevision>'",
    "pack-state: identity verified",
    "relative to the directory of the installed stage skill being read",
    "Single-quote every substituted path and pin value",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }

  for (const required of [
    "node '<installed-skills-root>/.mono-agent-workflow/scripts/verify-pack-state.mjs' identity",
    "--lock '<installed-skills-root>/.mono-agent-workflow.lock.json'",
    "--pack-version '<packVersion above>'",
    "--source-commit '<sourceCommit above>'",
    "--surface-revision '<surfaceRevision above>'",
    "pack-state: identity verified",
    "Emit it fully resolved",
    "keep the single quotes shown above",
    "whether or not Linear MCP is reachable",
  ]) {
    assertIncludes("templates/orchestrator-dispatch.md", required, JSON.stringify(required));
  }

  // No availability-based escape hatch may survive next to the precedence
  // pointer: reachable Linear must never re-open direct worker access.
  if (read("templates/orchestrator-dispatch.md").includes("whole world until Linear MCP is up")) {
    fail(
      "templates/orchestrator-dispatch.md must not re-open direct Linear access when MCP becomes reachable"
    );
  }

  for (const required of [
    "## Orchestration branch of `start-checkpoint`",
    "zero required Linear operations",
    "zero Linear reads, zero Linear writes",
    "Check the mode first: a stage started from a dispatch runs the",
    '"Fetch fresh Linear context"; issue no Linear call.',
    "Perform no lifecycle move and no delivery check against Linear",
    "the canonical invocation with its",
    "a gate that must precede a lifecycle change must also precede its queuing",
  ]) {
    assertIncludes("skills/mono-implement/SKILL.md", required, JSON.stringify(required));
  }

  const implementSkill = read("skills/mono-implement/SKILL.md");
  const branchStart = implementSkill.indexOf("## Orchestration branch of `start-checkpoint`");
  const branchEnd = implementSkill.indexOf("## Context-seam branch at Delivery Start");
  if (branchStart < 0 || branchEnd < 0 || branchStart > branchEnd) {
    fail("mono-implement orchestration branch must sit before the context-seam branch");
  } else {
    const branch = implementSkill.slice(branchStart, branchEnd);
    // The orchestration branch may never require a Linear operation.
    for (const banned of ["Fetch fresh Linear context.", "Record a human Linear comment"]) {
      if (branch.includes(banned)) {
        fail(`mono-implement orchestration branch must not require the Linear operation: ${banned}`);
      }
    }
    // Gate ordering, preserved through queuing: the context seam is resolved
    // before any lifecycle mutation is queued, and on the issue-only lane the
    // delivery verdict precedes the queued Issue-to-started move — because
    // queuing a mutation is how this mode performs it.
    const seamStep = branch.indexOf("Resolve the context seam through the Context-seam branch below");
    const lifecycleStep = branch.indexOf("Perform no lifecycle move and no delivery check against Linear");
    if (seamStep < 0 || lifecycleStep < 0 || seamStep > lifecycleStep) {
      fail(
        "mono-implement orchestration branch must resolve the context seam before queuing the lifecycle move"
      );
    }
    // The issue-only lane must actually queue its lifecycle mutation, and
    // only after the delivery verdict — not merely mention the move.
    const issueOnlyQueue = branch.indexOf("On `PASS`, queue the Issue-to-started move");
    const issueOnlyGate = branch.indexOf("Issue-only: the delivery check precedes");
    if (issueOnlyQueue < 0 || !branch.includes("in `linear_mutations_pending` before writing any code")) {
      fail(
        "mono-implement orchestration branch must queue the Issue-to-started move in linear_mutations_pending on a PASS verdict"
      );
    } else if (issueOnlyGate < 0 || issueOnlyGate > issueOnlyQueue) {
      fail(
        "mono-implement orchestration branch must evaluate the issue-only delivery verdict before queuing the Issue-to-started move"
      );
    }

    for (const required of [
      "the delivery check precedes the Issue-to-started move",
      "Project-first: queue no lifecycle move in this lane",
      "sequences the Delivery move before it dispatches this stage",
      "do not defer the check onto a queued",
      "`needs-decision` report naming that move for the orchestrator to apply",
      "treat it as queued, not as done",
      "What must be true before code is",
      "is `blocked` naming",
    ]) {
      if (!branch.includes(required)) {
        fail(`mono-implement orchestration branch missing delivery-gate semantics: ${JSON.stringify(required)}`);
      }
    }
  }
}

// MONO-45 — two-tier read-first ladders. Tier-1 ("Read now") is the eager
// closure every run of a stage loads; tier-2 ("Read when") is deferred behind a
// stated condition and is deliberately outside the validated set, because
// extractReadFirstEntries stops at the first non-numbered line. The tier is a
// deferral, never a downgrade: a tier-2 read is mandatory once its condition
// holds, and the bounded-contract requirement in validateArtifactContractParity
// still forces its consumers to keep contract paths in tier-1.
function validateReadFirstTierContract() {
  const tierNowHeading = "Read now — every run of this stage loads all of these:";
  const tierWhenHeading = "Read when — load the file only when its condition is true for this run:";
  const tierRule =
    'Every "Read when" entry is a real requirement once its condition holds: the tier exists to defer a read, never to make it optional.';

  for (const skill of listSkillNames()) {
    const relativePath = `skills/${skill}/SKILL.md`;
    if (!exists(relativePath)) continue;
    const text = read(relativePath);
    for (const required of [tierNowHeading, tierWhenHeading, tierRule]) {
      assertIncludes(relativePath, required, JSON.stringify(required));
    }
    if (text.indexOf(tierNowHeading) > text.indexOf(tierWhenHeading)) {
      fail(`${relativePath} must state the "Read now" tier before the "Read when" tier`);
    }

    const { paths } = extractReadFirstEntries(text);
    if (paths[0] !== "AGENTS.md") {
      fail(`${relativePath} must keep AGENTS.md as the first "Read now" entry`);
    }
    const tierTwoBlock = text.slice(text.indexOf(tierWhenHeading) + tierWhenHeading.length, text.indexOf(tierRule));
    for (const line of tierTwoBlock.split("\n")) {
      if (/^\d+\.\s/.test(line.trim())) {
        fail(`${relativePath} has a numbered "Read when" entry, which the tier-1 parser would validate: ${line.trim()}`);
      }
    }
    for (const line of tierTwoBlock.split("\n")) {
      if (!line.trim().startsWith("- ")) continue;
      if (!line.includes(" — ")) {
        fail(`${relativePath} has a "Read when" entry without a stated condition: ${line.trim()}`);
      }
      // A deferral condition must be answerable from the run's inputs BEFORE the
      // file is read. A condition phrased as an outcome of the work the file
      // governs is self-referential: a run that does not already suspect the
      // problem skips the file and can return a falsely clean result.
      for (const resultDependent of [
        "is in question",
        "part of the finding",
        "decides the verdict",
        "has to be judged rather than read",
        "against the quality bar",
        "if it turns out",
        "if needed",
        "as needed",
        "when relevant",
        "when applicable",
      ]) {
        if (line.toLowerCase().includes(resultDependent)) {
          fail(
            `${relativePath} has a result-dependent or vague "Read when" condition (${JSON.stringify(resultDependent)}); state a precondition observable before the read: ${line.trim()}`
          );
        }
      }
    }
  }

  // Parser fixture: a tier-2 bullet is not harvested as a tier-1 path, and a
  // tier-1 entry carrying extra backticked prose still is — which is why
  // conditions live on tier-2 lines only.
  const tieredFixture = [
    "Read first:",
    "",
    tierNowHeading,
    "",
    "1. `AGENTS.md`",
    "2. `references/lifecycle.md`",
    "",
    tierWhenHeading,
    "",
    "- `references/issue-only-lane.md` — when the resolved seam is `lifecycle_state_entity=issue`.",
    "",
    tierRule,
    "",
  ].join("\n");
  const tieredPaths = extractReadFirstEntries(tieredFixture).paths;
  if (tieredPaths.join("|") !== "AGENTS.md|references/lifecycle.md") {
    fail("two-tier read-first fixture must harvest exactly the tier-1 entries");
  }
  if (tieredPaths.includes("lifecycle_state_entity=issue")) {
    fail("two-tier read-first fixture must not harvest tier-2 condition text as a path");
  }
  const conditionOnTierOne = tieredFixture.replace(
    "2. `references/lifecycle.md`",
    "2. `references/lifecycle.md` — only when the seam is `lifecycle_state_entity=issue`"
  );
  const conditionPaths = extractReadFirstEntries(conditionOnTierOne).paths;
  if (!conditionPaths.includes("lifecycle_state_entity=issue")) {
    fail("condition text on a tier-1 entry must expose its backticked tokens to path validation");
  }
  if (validateReadFirstPath("lifecycle_state_entity=issue")) {
    fail("a tier-1 condition token must not pass path validation; conditions belong on tier-2 lines");
  }

  // Audience split — the interactive ship UX and its worked example live in a
  // template read at composition time; the worker path keeps every gate.
  assertIncludes("skills/mono-ship/SKILL.md", "templates/ship-status-ux.md", "ship status UX pointer");
  for (const inlined of ["Статус ревью:", "Review timeline:", "Для `green`:"]) {
    if (read("skills/mono-ship/SKILL.md").includes(inlined)) {
      fail(`mono-ship must not re-inline the interactive ship status UX: ${JSON.stringify(inlined)}`);
    }
  }
  for (const required of [
    "Shape only.",
    "Every value comes from something you actually observed",
    "This\nfile carries no gate",
    "Статус ревью:",
    "Review timeline:",
  ]) {
    assertIncludes("templates/ship-status-ux.md", required, JSON.stringify(required));
  }

  // M5 — the coverage rule keeps its enforcement clause in both stage skills
  // and delegates only the field shape to the report template.
  for (const relativePath of ["skills/mono-implement/SKILL.md", "skills/mono-preflight/SKILL.md"]) {
    for (const required of [
      "each with a `pass | deferred | not-run` status and one line of evidence",
      "Under orchestration that list is the `verification_items` array of the mailbox report, in the shape `templates/orchestrator-report.md` defines.",
      "The stage cannot claim completion while an item is silently missing; `deferred`/`not-run` are valid only with a recorded reason in the evidence.",
      "`templates/orchestrator-report.md` — when this stage runs from a dispatch, before writing the exit report.",
    ]) {
      assertIncludes(relativePath, required, JSON.stringify(required));
    }
  }

  // M6 — one printed certificate block; the Linear form is described, not
  // reprinted, and the Russian lead stays required for it.
  const preflightBody = read("skills/mono-preflight/SKILL.md");
  const certificateCore = "mono-preflight certificate\nPreflight: <ready|blocked|drift-candidate|needs-human>";
  if (preflightBody.split(certificateCore).length - 1 !== 1) {
    fail("mono-preflight must print the certificate machine core exactly once");
  }
  for (const required of [
    "The certificate block above, unchanged, with one addition",
    "It is required in the Linear comment/resource form and absent from the chat and report form — never optional in either direction.",
  ]) {
    assertIncludes("skills/mono-preflight/SKILL.md", required, JSON.stringify(required));
  }

  // A deferred read whose condition names a Linear write must also name the
  // queued form, or the condition silently excludes every orchestrated run.
  for (const required of [
    "The same substitution applies to any condition a stage skill places on a\n  read",
    "names the queued form too",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }
  assertIncludes(
    "skills/mono-preflight/SKILL.md",
    "- `references/artifact-quality.md` — when this run records or queues the certificate for Linear, or recovers an earlier certificate.",
    "preflight certificate-quality read covers the queued form"
  );

  // Dispatch-generator audience guidance — one home in orchestration.md.
  for (const required of [
    "### Generated dispatch as audience adapter",
    "orchestration.workerAudience",
    "It may not soften, reword,\n  or replace a rule",
    "is a floor, not a ceiling",
    "Facts are never compressed for either column.",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }
}

// MONO-46 — pre-write handoff review. The whole value of this gate is its
// ORDER: the drafted package is reviewed BEFORE the first durable Linear write,
// so findings are fixed in a draft instead of in an artifact that already
// exists. That is what these pins anchor — step positions inside the
// execution-mode workflow, computed from what each step DOES, so rewording
// around them cannot silently restore the old post-write order. The obligation
// the order carries (no skip for `standard`/`deep`/`risky`, advisory with a
// recorded reason for `tiny`) and the `mono-review` carve-out that makes a
// pre-write review possible at all are pinned by their load-bearing sentences,
// not by incidental phrasing.
function validatePreWriteHandoffReviewOrder() {
  const handoffPath = "skills/mono-handoff/SKILL.md";
  const handoff = read(handoffPath);

  const workflowStart = handoff.indexOf("Execution-mode workflow:");
  const workflowEnd = handoff.indexOf("Rules:", workflowStart);
  if (workflowStart < 0 || workflowEnd < 0 || workflowStart > workflowEnd) {
    fail(`${handoffPath} must keep an execution-mode workflow section ahead of its rules`);
    return;
  }
  const workflow = handoff.slice(workflowStart, workflowEnd);

  const reviewStep = workflow.indexOf("pre-write handoff review on the draft package");
  if (reviewStep < 0) {
    fail(`${handoffPath} execution-mode workflow must run the pre-write handoff review on the draft package`);
    return;
  }

  const durableWrites = [
    "create or update PRD and Tech Spec in Linear",
    "Update the Project body",
    "Record approval as a Linear comment",
    "Create or update Linear Issue(s) from the approved package",
  ];
  const durableWriteIndexes = [];
  for (const durableWrite of durableWrites) {
    const writeStep = workflow.indexOf(durableWrite);
    if (writeStep < 0) {
      fail(`${handoffPath} execution-mode workflow missing durable-write step: ${JSON.stringify(durableWrite)}`);
      continue;
    }
    durableWriteIndexes.push(writeStep);
    if (writeStep < reviewStep) {
      fail(
        `${handoffPath} performs a durable Linear write before the pre-write handoff review: ${JSON.stringify(durableWrite)}`
      );
    }
  }

  // The old order must not creep back in behind a durable write.
  if (durableWriteIndexes.length > 0) {
    const lastDurableWrite = Math.max(...durableWriteIndexes);
    if (workflow.indexOf("mono-review handoff", lastDurableWrite) >= 0) {
      fail(`${handoffPath} must not schedule the handoff review after a durable Linear write`);
    }
  }

  // Fixes land in the draft, and the owner's single touch already carries the
  // verdict: review → draft fixes → approval, all before the writes above.
  const draftFixStep = workflow.indexOf("Apply accepted review fixes to the draft package");
  const approvalStep = workflow.indexOf("for package approval before durable writes");
  if (draftFixStep < 0 || draftFixStep < reviewStep) {
    fail(`${handoffPath} must apply accepted review fixes to the draft after the pre-write review`);
  }
  if (approvalStep < 0 || approvalStep < draftFixStep) {
    fail(`${handoffPath} must present the package for approval after the draft review and its fixes`);
  }

  for (const required of [
    "The handoff review runs on the draft package before the first durable Linear write of that package",
    "required for `standard`, `deep`, and `risky`",
    "For `tiny` the gate stays advisory",
    "`standard`, `deep`, and `risky` have no such skip",
    // The condition must hold in both modes; the write→queue substitution keeps
    // its single home and is pointed at, never restated here.
    "Interactive runs invoke `mono-review handoff` report-only over the draft package",
    "Orchestrated runs delegate the same handoff-review contract",
    "Orchestration Mode Precedence",
    // An owner-requested revision cannot be approved under the previous
    // draft's verdict, and a skipped tiny gate has a disposition to show.
    "returns through steps 5-6 before it is re-presented",
    "for a `tiny` package whose advisory gate was skipped, the recorded skip reason",
  ]) {
    assertIncludes(handoffPath, required, JSON.stringify(required));
  }
  if (handoff.includes("The dispatch snapshot is the single source of Linear state in orchestration")) {
    fail(
      `${handoffPath} must point at Orchestration Mode Precedence in references/orchestration.md, not restate the rule`
    );
  }

  for (const required of [
    "Handoff-gate timing is pre-write",
    "before the first durable Linear write of that package",
  ]) {
    assertIncludes("references/readiness-gates.md", required, JSON.stringify(required));
  }

  for (const required of [
    "`handoff` has a pre-write mode",
    "never a missing artifact and never grounds for `blocked`",
    "In pre-write `handoff` mode the required artifacts are the draft bodies supplied as input",
    // No escape hatch may reopen the skip the gate exists to close.
    "no recorded exception substitutes for it",
  ]) {
    assertIncludes("skills/mono-review/SKILL.md", required, JSON.stringify(required));
  }

  for (const required of [
    "### Pre-write package review",
    "BEFORE the orchestrator writes any of it to Linear",
    "no Linear-write capability and no owner contact",
    "Workers never run this review",
    "pre-write package review, not stage work",
    // The drafted bodies are unwritten; the Project container may well exist.
    "The Project entity itself may already exist",
  ]) {
    assertIncludes("references/orchestration.md", required, JSON.stringify(required));
  }
}

validateSkills();
validateReadFirstTierContract();
validatePreWriteHandoffReviewOrder();
validateRetiredAdapterReferenceAllowlist();
validateTemplateSections();
validateArtifactContractParity();
validateReviewCheckBoundary();
validateRepairAndRoutingContract();
validatePackIdentityAndQuiescenceBehavior();
validatePackIdentityWorkflowContract();
validateLocalInstallBehavior();
validateMultiRootInstallBehavior();
validateBreakingInstallBehavior();
validateProjectConfigBehavior();
validateIssueOnlyLaneBehavior();
validateIssueIntakeContract();
validateDocsAndExamples();
validateAntiPatterns();
validateHeartbeatContract();
validateWatcherContaminationBehavior();
await validateWatcherV3Behavior();
validateHonestLedgerContract();
validateCompactionContract();
validateLiveQaGateContract();
validateRealBackendContractSampling();
validateGoalContractBinding();
validateReportContractSingleHome();
validateOrchestrationModePrecedence();
validateReviewLoopHygiene();
validateCostTelemetry();
validateBriefIntegrity();
validateOpsLessons();

if (failures.length > 0) {
  console.error("Mono workflow validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Mono workflow validation passed (${listSkillNames().length} skills checked).`);
