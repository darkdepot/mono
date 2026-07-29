#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const CONFIG_RELATIVE_PATH = ".agents/mono-workflow.config.json";
const LEGACY_CONFIG_RELATIVE_PATH = ".agents/mono-workflow.config.md";
const PREVIOUS_CONFIG_RELATIVE_PATH = ".agents/linear-workflow.config.json";
const PREVIOUS_LEGACY_CONFIG_RELATIVE_PATH = ".agents/linear-workflow.config.md";
const LEGACY_FILES = [
  ".agents/mono-workflow-check.mjs",
  ".agents/mono-workflow.lock.json",
  LEGACY_CONFIG_RELATIVE_PATH,
  ".github/workflows/update-mono-workflow.yml",
  ".github/workflows/update-mono-agent-workflow.yml",
  PREVIOUS_CONFIG_RELATIVE_PATH,
  PREVIOUS_LEGACY_CONFIG_RELATIVE_PATH,
  ".agents/linear-workflow-check.mjs",
  ".agents/linear-workflow.lock.json",
  ".github/workflows/update-linear-workflow.yml",
  ".github/workflows/update-linear-agent-workflow.yml",
];

function usage() {
  console.error(
    "Usage: node scripts/project-config.mjs --repo /path/to/project [--project-name Name] [--consumer-name LegacyName] [--write] [--clean] [--check] [--print]"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    check: false,
    clean: false,
    projectName: "",
    print: false,
    repo: "",
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      args.repo = argv[++index] || "";
    } else if (arg === "--project-name" || arg === "--consumer-name") {
      args.projectName = argv[++index] || "";
    } else if (arg === "--write") {
      args.write = true;
    } else if (arg === "--clean") {
      args.clean = true;
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--print") {
      args.print = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }

  if (!args.repo) usage();
  if (!args.write && !args.clean && !args.check && !args.print) usage();
  args.repo = path.resolve(args.repo);
  return args;
}

function titleize(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeOptionalWorkflow(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /^none$/i.test(trimmed)) return null;
  return trimmed;
}

function parseList(value) {
  const normalized = normalizeOptionalWorkflow(value);
  if (!normalized) return [];
  return normalized
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultConfig(projectName) {
  return {
    schemaVersion: 1,
    projectName,
    linearTeam: projectName,
    languages: {
      linear: "Russian",
      repo: "English",
    },
    artifactRoots: [],
    workflows: {
      implementation: null,
      ship: null,
      documentation: null,
      reviewFeedback: null,
      deploy: null,
    },
    prerequisites: {
      autoreviewHelper: true,
    },
    deployApproval: "always",
  };
}

function parseLegacyMarkdownConfig(text, projectName) {
  const config = defaultConfig(projectName);
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*-\s*([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();

    if (key === "Consumer") config.projectName = value || config.projectName;
    if (key === "Linear team") config.linearTeam = value || config.linearTeam;
    if (key === "Linear-facing Project, PRD, Tech Spec, Issue, and comment language") {
      config.languages.linear = value || config.languages.linear;
    }
    if (key === "Repo docs and code comments language") {
      config.languages.repo = value || config.languages.repo;
    }
    if (key === "Artifact roots") config.artifactRoots = parseList(value);
    if (key === "Implementation workflow") config.workflows.implementation = normalizeOptionalWorkflow(value);
    if (key === "Ship workflow") config.workflows.ship = normalizeOptionalWorkflow(value);
    if (key === "Documentation workflow") config.workflows.documentation = normalizeOptionalWorkflow(value);
    if (key === "Review feedback workflow") config.workflows.reviewFeedback = normalizeOptionalWorkflow(value);
    if (key === "Deploy workflow") config.workflows.deploy = normalizeOptionalWorkflow(value);
    if (key === "Autoreview helper") config.prerequisites.autoreviewHelper = true;
  }
  return config;
}

function readJsonConfig(configPath, failures = []) {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    failures.push(`Project config is not valid JSON: ${CONFIG_RELATIVE_PATH} (${error.message})`);
    return null;
  }
}

function configFromRepo(repo, projectName) {
  const jsonPath = path.join(repo, CONFIG_RELATIVE_PATH);
  const legacyPath = path.join(repo, LEGACY_CONFIG_RELATIVE_PATH);
  const previousJsonPath = path.join(repo, PREVIOUS_CONFIG_RELATIVE_PATH);
  const previousLegacyPath = path.join(repo, PREVIOUS_LEGACY_CONFIG_RELATIVE_PATH);
  if (fs.existsSync(jsonPath)) {
    const failures = [];
    const config = readJsonConfig(jsonPath, failures);
    if (!config) throw new Error(failures.join("\n"));
    if (!("deployApproval" in config)) config.deployApproval = "always";
    return config;
  }
  if (fs.existsSync(previousJsonPath)) {
    const failures = [];
    const config = readJsonConfig(previousJsonPath, failures);
    if (!config) throw new Error(failures.join("\n"));
    if (!("deployApproval" in config)) config.deployApproval = "always";
    return config;
  }
  if (fs.existsSync(legacyPath)) {
    return parseLegacyMarkdownConfig(fs.readFileSync(legacyPath, "utf8"), projectName);
  }
  if (fs.existsSync(previousLegacyPath)) {
    return parseLegacyMarkdownConfig(fs.readFileSync(previousLegacyPath, "utf8"), projectName);
  }
  return defaultConfig(projectName);
}

function hasPlaceholder(value) {
  if (typeof value === "string") return /<[^>\n]+>/.test(value);
  if (Array.isArray(value)) return value.some((entry) => hasPlaceholder(entry));
  if (value && typeof value === "object") return Object.values(value).some((entry) => hasPlaceholder(entry));
  return false;
}

function validateConfig(config, failures) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    failures.push("Project config must be a JSON object");
    return;
  }
  if (config.schemaVersion !== 1) failures.push("Project config schemaVersion must be 1");
  for (const field of ["projectName", "linearTeam"]) {
    if (typeof config[field] !== "string" || config[field].trim().length === 0) {
      failures.push(`Project config missing ${field}`);
    }
  }
  if (!config.languages || typeof config.languages !== "object") {
    failures.push("Project config missing languages");
  } else {
    for (const field of ["linear", "repo"]) {
      if (typeof config.languages[field] !== "string" || config.languages[field].trim().length === 0) {
        failures.push(`Project config missing languages.${field}`);
      }
    }
  }
  if (!Array.isArray(config.artifactRoots)) {
    failures.push("Project config artifactRoots must be an array");
  } else if (!config.artifactRoots.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    failures.push("Project config artifactRoots entries must be non-empty strings");
  }
  if (!config.workflows || typeof config.workflows !== "object") {
    failures.push("Project config missing workflows");
  } else {
    for (const field of ["implementation", "ship", "documentation", "reviewFeedback", "deploy"]) {
      if (!(field in config.workflows)) {
        failures.push(`Project config missing workflows.${field}`);
        continue;
      }
      const value = config.workflows[field];
      if (value !== null && (typeof value !== "string" || value.trim().length === 0)) {
        failures.push(`Project config workflows.${field} must be a string or null`);
      }
    }
    if ("qa" in config.workflows) {
      const value = config.workflows.qa;
      if (value !== null && (typeof value !== "string" || value.trim().length === 0)) {
        failures.push("Project config workflows.qa must be a string or null");
      }
    }
  }
  if (!config.prerequisites || config.prerequisites.autoreviewHelper !== true) {
    failures.push("Project config must set prerequisites.autoreviewHelper to true");
  }
  if ("deployApproval" in config) {
    const allowed = ["always", "risky-only", "never"];
    if (!allowed.includes(config.deployApproval)) {
      failures.push(`Project config deployApproval must be one of: ${allowed.join(", ")}`);
    }
  }
  if ("issueOnlyLane" in config) {
    const lane = config.issueOnlyLane;
    if (typeof lane !== "object" || lane === null || typeof lane.enabled !== "boolean") {
      failures.push("Project config issueOnlyLane must be an object with a boolean `enabled`");
    } else if (
      lane.enabled === true &&
      (typeof lane.ownerPrincipal !== "string" || lane.ownerPrincipal.trim().length === 0)
    ) {
      failures.push(
        "Project config issueOnlyLane.ownerPrincipal must be a non-empty stable Linear user ID when the lane is enabled"
      );
    }
  }
  if ("qaAuth" in config) {
    const allowed = ["cookie-import", "test-account", "owner-session"];
    if (config.qaAuth !== null && !allowed.includes(config.qaAuth)) {
      failures.push(`Project config qaAuth must be one of: ${allowed.join(", ")}`);
    }
  }
  if ("orchestration" in config) {
    const orchestration = config.orchestration;
    if (!orchestration || typeof orchestration !== "object" || Array.isArray(orchestration)) {
      failures.push("Project config orchestration must be an object");
    } else {
      const allowedTransports = ["codex-cli", "claude-code-desktop", "fallback"];
      if ("transport" in orchestration && orchestration.transport !== null && !allowedTransports.includes(orchestration.transport)) {
        failures.push(`Project config orchestration.transport must be one of: ${allowedTransports.join(", ")}`);
      }
      if (
        "maxParallelWorkers" in orchestration &&
        orchestration.maxParallelWorkers !== null &&
        (!Number.isInteger(orchestration.maxParallelWorkers) || orchestration.maxParallelWorkers < 1)
      ) {
        failures.push("Project config orchestration.maxParallelWorkers must be a positive integer");
      }
      const allowedWorkerAudiences = ["gpt-worker", "claude-5"];
      if (
        "workerAudience" in orchestration &&
        orchestration.workerAudience !== null &&
        !allowedWorkerAudiences.includes(orchestration.workerAudience)
      ) {
        failures.push(
          `Project config orchestration.workerAudience must be one of: ${allowedWorkerAudiences.join(", ")}`
        );
      }
    }
  }
  if (hasPlaceholder(config)) {
    failures.push("Project config contains unresolved <...> placeholder");
  }
  if ("landWorkflow" in config || config.workflows?.land) {
    failures.push("Project config must use workflows.deploy, not Land workflow compatibility fields");
  }
}

function scanLegacyProjectFiles(repo) {
  const legacy = [];
  for (const relativePath of LEGACY_FILES) {
    if (fs.existsSync(path.join(repo, relativePath))) legacy.push(relativePath);
  }

  for (const skillsRoot of [".agents/skills", ".claude/skills"]) {
    const absoluteRoot = path.join(repo, skillsRoot);
    if (!fs.existsSync(absoluteRoot)) continue;
    for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        (entry.name.startsWith("mono-") || entry.name.startsWith("linear-"))
      ) {
        legacy.push(path.join(skillsRoot, entry.name));
      }
    }
  }

  return legacy.sort();
}

function removeEmptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmdirSync(dir);
  } catch {
    // Directory still has project-owned files.
  }
}

function cleanLegacyProjectFiles(repo) {
  for (const relativePath of LEGACY_FILES) {
    fs.rmSync(path.join(repo, relativePath), { recursive: true, force: true });
  }

  for (const skillsRoot of [".agents/skills", ".claude/skills"]) {
    const absoluteRoot = path.join(repo, skillsRoot);
    if (!fs.existsSync(absoluteRoot)) continue;
    for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        (entry.name.startsWith("mono-") || entry.name.startsWith("linear-"))
      ) {
        fs.rmSync(path.join(absoluteRoot, entry.name), { recursive: true, force: true });
      }
    }
    removeEmptyDir(absoluteRoot);
  }

  removeEmptyDir(path.join(repo, ".github", "workflows"));
  removeEmptyDir(path.join(repo, ".github"));
  removeEmptyDir(path.join(repo, ".claude", "skills"));
  removeEmptyDir(path.join(repo, ".claude"));
}

function writeConfig(repo, config) {
  const configPath = path.join(repo, CONFIG_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function checkProject(repo) {
  const failures = [];
  const configPath = path.join(repo, CONFIG_RELATIVE_PATH);
  if (!fs.existsSync(configPath)) {
    failures.push(`Missing project config: ${CONFIG_RELATIVE_PATH}`);
  } else {
    const config = readJsonConfig(configPath, failures);
    if (config) validateConfig(config, failures);
  }

  const legacyFiles = scanLegacyProjectFiles(repo);
  for (const relativePath of legacyFiles) {
    failures.push(`Legacy Mono workflow project install file must be removed: ${relativePath}`);
  }

  if (failures.length > 0) {
    console.error("Mono workflow project config check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`Mono workflow project config check passed for ${repo}`);
}

const args = parseArgs(process.argv.slice(2));
if (!fs.existsSync(args.repo) || !fs.statSync(args.repo).isDirectory()) {
  console.error(`Project repo does not exist: ${args.repo}`);
  process.exit(1);
}

const projectName = args.projectName || titleize(path.basename(args.repo));
const monoConfigPath = path.join(args.repo, CONFIG_RELATIVE_PATH);
const migratableConfigPaths = [
  LEGACY_CONFIG_RELATIVE_PATH,
  PREVIOUS_CONFIG_RELATIVE_PATH,
  PREVIOUS_LEGACY_CONFIG_RELATIVE_PATH,
].map((relativePath) => path.join(args.repo, relativePath));

if (args.write) {
  let config = null;
  try {
    config = configFromRepo(args.repo, projectName);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  writeConfig(args.repo, config);
  console.log(`Wrote ${CONFIG_RELATIVE_PATH} for ${args.repo}`);
}

if (args.clean) {
  if (
    !args.write &&
    !fs.existsSync(monoConfigPath) &&
    migratableConfigPaths.some((configPath) => fs.existsSync(configPath))
  ) {
    console.error(
      `Refusing to clean the only project config. Run with --write --clean to migrate it to ${CONFIG_RELATIVE_PATH}.`
    );
    process.exit(1);
  }
  cleanLegacyProjectFiles(args.repo);
  console.log(`Cleaned legacy Mono workflow files for ${args.repo}`);
}

if (args.print) {
  try {
    console.log(JSON.stringify(configFromRepo(args.repo, projectName), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (args.check) {
  checkProject(args.repo);
}
