#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage(exitCode = 2) {
  console.error(
    "Usage: node scripts/verify.mjs [--install-check] [--help|-h]"
  );
  console.error("");
  console.error("Options:");
  console.error("  --install-check  Also run node scripts/install-local.mjs --check");
  console.error("                   (machine-specific; only valid on maintainer machine)");
  console.error("  --help, -h       Show this help and exit");
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { installCheck: false };
  for (const arg of argv) {
    if (arg === "--install-check") {
      args.installCheck = true;
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// In CI (GITHUB_BASE_REF set, base ref fetched) the working tree is clean, so a
// bare `git diff --check` is a no-op; check the committed PR range instead.
function whitespaceCheckArgs() {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    try {
      execFileSync("git", ["rev-parse", "--verify", `origin/${baseRef}`], { cwd: root, stdio: "ignore" });
      return ["diff", "--check", `origin/${baseRef}...HEAD`];
    } catch {
      // base ref not fetched — fall back to the working-tree check
    }
  }
  return ["diff", "--check"];
}

const whitespaceArgs = whitespaceCheckArgs();
const steps = [
  { label: `git ${whitespaceArgs.join(" ")}`, cmd: "git", cmdArgs: whitespaceArgs },
  { label: "node --check scripts/install-local.mjs", cmd: "node", cmdArgs: ["--check", "scripts/install-local.mjs"] },
  { label: "node --check scripts/project-config.mjs", cmd: "node", cmdArgs: ["--check", "scripts/project-config.mjs"] },
  { label: "node --check scripts/lint-mono-artifacts.mjs", cmd: "node", cmdArgs: ["--check", "scripts/lint-mono-artifacts.mjs"] },
  { label: "node --check scripts/validate-workflow.mjs", cmd: "node", cmdArgs: ["--check", "scripts/validate-workflow.mjs"] },
  { label: "node --check scripts/verify-pack-state.mjs", cmd: "node", cmdArgs: ["--check", "scripts/verify-pack-state.mjs"] },
  { label: "node --check scripts/watch-workers.mjs", cmd: "node", cmdArgs: ["--check", "scripts/watch-workers.mjs"] },
  { label: "node --check scripts/verify.mjs", cmd: "node", cmdArgs: ["--check", "scripts/verify.mjs"] },
  { label: "node scripts/lint-mono-artifacts.mjs", cmd: "node", cmdArgs: ["scripts/lint-mono-artifacts.mjs"] },
  { label: "node --test delivery runtime fixtures", cmd: "node", cmdArgs: ["--test", "scripts/gate.test.mjs", "scripts/delivery-state.test.mjs", "scripts/delivery-runtime.test.mjs", "scripts/sandbox-contract.test.mjs"] },
  { label: "node scripts/validate-workflow.mjs", cmd: "node", cmdArgs: ["scripts/validate-workflow.mjs"] },
];

if (args.installCheck) {
  steps.push({ label: "node scripts/install-local.mjs --check", cmd: "node", cmdArgs: ["scripts/install-local.mjs", "--check"] });
}

const failures = [];

for (const step of steps) {
  try {
    execFileSync(step.cmd, step.cmdArgs, {
      cwd: root,
      stdio: "pipe",
    });
    console.log(`PASS ${step.label}`);
  } catch (err) {
    console.log(`FAIL ${step.label}`);
    const output = [err.stdout, err.stderr]
      .map((b) => (b ? b.toString().trimEnd() : ""))
      .filter(Boolean)
      .join("\n");
    if (output) {
      for (const line of output.split("\n")) {
        console.log(`  ${line}`);
      }
    }
    failures.push(step.label);
  }
}

const total = steps.length;
if (failures.length === 0) {
  console.log(`Verification passed (${total} checks).`);
  process.exit(0);
} else {
  console.log(`Verification failed: ${failures.length} of ${total} checks failed.`);
  process.exit(1);
}
