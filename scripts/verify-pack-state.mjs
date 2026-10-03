#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { requireCompatiblePack } from "./runtime.mjs";
const CONTROL_STATES = new Set(["active", "draining", "idle"]);

function fail(message) {
  throw new Error(`pack-state: ${message}`);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`cannot read ${label} at ${filePath}: ${error.message}`);
  }
}

function validateIdentity(identity, label) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    fail(`${label} must be a JSON object`);
  }
  if (typeof identity.packVersion !== "string" || identity.packVersion.length === 0) {
    fail(`${label}.packVersion must be a non-empty string`);
  }
  if (typeof identity.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(identity.sourceCommit)) {
    fail(`${label}.sourceCommit must be a lowercase 40-hex commit SHA`);
  }
  if (!Number.isInteger(identity.surfaceRevision) || identity.surfaceRevision < 1) {
    fail(`${label}.surfaceRevision must be a positive integer`);
  }
  return identity;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`invalid arguments near ${key || "end of command"}`);
    }
    options[key.slice(2)] = value;
  }
  return options;
}

export function verifyIdentity(installed, expected) {
  validateIdentity(installed, "installed identity");
  validateIdentity(expected, "dispatch identity");
  try { requireCompatiblePack(installed, expected); }
  catch (error) { fail(error.message); }
}

export function verifyQuiescence(control, workers) {
  if (!control || typeof control !== "object" || Array.isArray(control)) {
    fail("control.json must be a JSON object");
  }
  if (!CONTROL_STATES.has(control.state)) {
    fail("control.state must be one of active, draining, idle");
  }
  if (!workers || typeof workers !== "object" || Array.isArray(workers)) {
    fail("workers.json must be an object map");
  }

  const blockers = [];
  if (control.state !== "idle") {
    blockers.push(`control.state=${control.state} (requires idle)`);
  }
  const workerKeys = Object.keys(workers);
  if (workerKeys.length > 0) {
    blockers.push(
      `workers.json has ${workerKeys.length} active worker${workerKeys.length === 1 ? "" : "s"}: ${workerKeys.join(", ")}`
    );
  }
  if (blockers.length > 0) fail(`not quiescent: ${blockers.join("; ")}`);
}

function run(argv) {
  const command = argv[0];
  const options = parseOptions(argv.slice(1));
  if (command === "identity") {
    if (!options.lock) fail("identity requires --lock");
    const installed = readJson(path.resolve(options.lock), "lockfile");
    const expected = {
      packVersion: options["pack-version"],
      sourceCommit: options["source-commit"],
      surfaceRevision: Number(options["surface-revision"]),
    };
    verifyIdentity(installed, expected);
    console.log("pack-state: identity verified");
    return;
  }
  if (command === "quiescence") {
    if (!options.root) fail("quiescence requires --root");
    const root = path.resolve(options.root);
    const control = readJson(path.join(root, "control.json"), "control.json");
    const workers = readJson(path.join(root, "workers.json"), "workers.json");
    verifyQuiescence(control, workers);
    console.log("pack-state: quiescent");
    return;
  }
  fail("usage: verify-pack-state.mjs <identity|quiescence> [options]");
}

try {
  run(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
