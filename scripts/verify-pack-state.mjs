#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { attemptState } from "./orchestrator/command-state.mjs";
import { requireCompatiblePack, packLayout, isMain, resolvedLocation } from "./runtime.mjs";
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
  if (identity.sourceCommit !== undefined && (typeof identity.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(identity.sourceCommit))) {
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

export function updateBlockers(folder, productsRoot = path.join(os.homedir(), '.mono-agent-workflow/orchestrator')) {
  const replaced = resolvedLocation(folder), blockers = [], unknown = [];
  if (!fs.existsSync(productsRoot)) return { blockers, unknown };
  for (const product of fs.readdirSync(productsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const root = path.join(productsRoot, product.name), registry = path.join(root, 'workers.json');
    if (!fs.existsSync(registry)) continue;
    const workers = readJson(registry, 'workers.json');
    if (!workers || typeof workers !== 'object' || Array.isArray(workers)) fail(`invalid registry: ${registry}`);
    for (const [key, entry] of Object.entries(workers)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`invalid registry entry: ${product.name}/${key}`);
      const sources = ['packRoot'].filter(field => Object.hasOwn(entry, field));
      if (!sources.length) {
        unknown.push({ product: product.name, key });
        continue;
      }
      if (sources.some(field => typeof entry[field] !== 'string' || !path.isAbsolute(entry[field])))
        fail(`packRoot unavailable: ${product.name}/${key}`);
      const packRoot = entry.packRoot;
      const saved = resolvedLocation(packRoot);
      if ((saved === replaced || saved.startsWith(replaced + path.sep)) && attemptState(root, entry).state !== 'landed')
        blockers.push({ product: product.name, issue: entry.issue ?? key, attempt: entry.attempt, packRoot: saved });
    }
  }
  return { blockers, unknown };
}

function run(argv) {
  const command = argv[0];
  const options = parseOptions(argv.slice(1));
  if (command === 'version') {
    const value = packLayout(options['pack-root'] ? path.resolve(options['pack-root']) : undefined).identity();
    validateIdentity(value, 'installed identity'); console.log(value.packVersion); return;
  }
  if (command === 'before-update') {
    if (!options.folder) fail('before-update requires --folder');
    const { blockers, unknown } = updateBlockers(path.resolve(options.folder), options['products-root'] ? path.resolve(options['products-root']) : undefined);
    if (unknown.length) console.log(`pack-state: unknown entries: ${unknown.map(item => `${item.product}/${item.key}`).join('; ')}`);
    if (blockers.length) fail(`update blocked: ${blockers.map(item => `${item.product}/${item.issue} attempt ${item.attempt}: ${item.packRoot}`).join('; ')}`);
    console.log('pack-state: update allowed'); return;
  }
  if (command === "identity") {
    if (!options["pack-root"]) fail("identity requires --pack-root");
    const installed = packLayout(path.resolve(options["pack-root"])).identity();
    const expected = {
      packVersion: options["pack-version"],
      ...(options["source-commit"] ? { sourceCommit: options["source-commit"] } : {}),
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
  fail("usage: verify-pack-state.mjs <identity|version|before-update|quiescence> [options]");
}

if (isMain(import.meta.url)) try {
  run(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
