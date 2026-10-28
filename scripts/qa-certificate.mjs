#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateShipCertificate } from './ship-certificate.mjs';
import { readQaRecipeFile } from './qa-recipe.mjs';

export const QA_MARKER = 'mono-qa certificate';
const text = value => typeof value === 'string' && value.trim().length > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const need = (ok, message) => { if (!ok) throw new Error(`qa certificate: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function buildIdentity(build) {
  need(Array.isArray(build) && build.length > 0, 'project build must be nonempty');
  const issues = new Set();
  for (const entry of build) {
    need(object(entry) && text(entry.issue) && sha(entry.head), 'build requires issue and head');
    need(!issues.has(entry.issue), 'duplicate build issue');
    issues.add(entry.issue);
  }
  return JSON.stringify(build.map(({ issue, head }) => ({ issue, head })).sort((a, b) => a.issue.localeCompare(b.issue)));
}

function evidenceFile(file, root) {
  need(text(file) && path.isAbsolute(file), 'evidence path must be absolute');
  const actual = fs.realpathSync(file), parent = fs.realpathSync(root);
  need(actual.startsWith(parent + path.sep), 'evidence escapes evidenceRoot');
  const stat = fs.statSync(actual);
  need(stat.isFile() && stat.size > 0 && (stat.mode & 0o444) !== 0, 'evidence must be a readable nonempty file');
  const fd = fs.openSync(actual, 'r');
  try { need(fs.readSync(fd, Buffer.alloc(1), 0, 1, 0) === 1, 'evidence cannot be opened'); }
  finally { fs.closeSync(fd); }
}

// Expected identity comes from the caller, never from the certificate being checked.
export function validateQaCertificate(report, expected) {
  need(object(expected), 'expected identity required');
  const raw = report?.certificate;
  need(typeof raw === 'string' && raw.startsWith(QA_MARKER + '\n') && raw.split(QA_MARKER).length === 2, 'one marker required');
  const cert = JSON.parse(raw.slice(QA_MARKER.length).trim());
  need(object(cert), 'JSON object required');
  need(['task', 'project'].includes(cert.scope) && cert.scope === expected.scope, 'scope mismatch');
  const target = cert.scope === 'task' ? 'issue' : 'project';
  need(text(cert[target]) && text(expected[target]) && cert[target] === expected[target], `${target} mismatch`);
  need(sha(cert.head) && sha(cert.base) && cert.head === expected.head && cert.base === expected.base, 'head/base mismatch');
  need(['passed', 'failed', 'unverified'].includes(cert.verdict), 'verdict required');
  need(['ship', 'given-version'].includes(cert.mode), 'mode required');
  need(['config', 'registry', 'file'].includes(cert.recipeSource), 'recipeSource required');
  need(cert.mode === expected.mode && cert.recipeSource === expected.recipeSource, 'mode/recipe source mismatch');
  if (cert.recipeSource === 'file') readQaRecipeFile(expected.recipeFile);
  const gateEligible = cert.mode === 'ship' && cert.recipeSource !== 'file';
  need(typeof cert.gateEligible === 'boolean' && cert.gateEligible === gateEligible, 'gateEligible mismatch');
  if (cert.mode === 'ship') validateShipCertificate({ issue: expected.issue, head: expected.head, certificate: expected.shipCertificate });
  if (cert.scope === 'project') need(buildIdentity(cert.build) === buildIdentity(expected.build), 'project build changed');
  need(['behavior', 'no-behavior'].includes(cert.kind) && cert.kind === expected.kind, 'kind mismatch');
  if (cert.kind === 'no-behavior') {
    need(cert.scope === 'task' && text(cert.reason), 'no-behavior requires task and reason');
    need(cert.items === undefined, 'no-behavior cannot replace item results');
    return { ...cert, gateEligible };
  }
  need(Array.isArray(cert.items) && cert.items.length > 0, 'items must be nonempty');
  need(text(expected.evidenceRoot), 'evidenceRoot required');
  need(Array.isArray(expected.expectedItems) && expected.expectedItems.length > 0
    && expected.expectedItems.every(text) && new Set(expected.expectedItems).size === expected.expectedItems.length, 'unique expectation list required');
  need(Array.isArray(expected.taskCriteria) && expected.taskCriteria.every(id => expected.expectedItems.includes(id)), 'taskCriteria must be bound to expectations');
  const ids = new Set();
  for (const item of cert.items) {
    need(object(item) && text(item.id) && !ids.has(item.id) && text(item.expectation), 'unique item id and expectation required');
    ids.add(item.id);
    need(['task', 'requirement', 'acceptance', 'design', 'heuristic'].includes(item.source), 'item source required');
    need(['passed', 'failed', 'unverified', 'excluded'].includes(item.outcome), 'item outcome required');
    need(Array.isArray(item.evidence), 'item evidence required');
    for (const file of item.evidence) evidenceFile(file, expected.evidenceRoot);
    if (item.outcome === 'excluded') {
      need(item.evidence.length > 0, 'excluded requires evidence of instability on main');
      need(item.source !== 'task' && !expected.taskCriteria.includes(item.id), 'task acceptance cannot be excluded');
      need(text(item.reason) && typeof item.successor === 'string' && /^https:\/\/linear\.app\/[^\s]+\/issue\/[^\s]+$/.test(item.successor), 'excluded requires reason and successor issue link');
    } else if (item.outcome === 'passed') need(item.evidence.length > 0, 'passed item without evidence must be failed');
    else need(text(item.reason), 'failed/unverified requires reason');
    if (cert.verdict === 'passed') need(['passed', 'excluded'].includes(item.outcome), 'green verdict has failed or unverified item');
  }
  need(Array.isArray(expected.expectedItems) && expected.expectedItems.length > 0
    && expected.expectedItems.length === ids.size && expected.expectedItems.every(id => ids.has(id)), 'expectation list missing or incomplete');
  return { ...cert, gateEligible };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [reportFile, expectedFile, ...extra] = process.argv.slice(2);
    need(reportFile && expectedFile && extra.length === 0, 'usage: qa-certificate.mjs <report.json> <expected.json>');
    const cert = validateQaCertificate(JSON.parse(fs.readFileSync(reportFile)), JSON.parse(fs.readFileSync(expectedFile)));
    console.log(JSON.stringify({ valid: true, verdict: cert.verdict, gateEligible: cert.gateEligible }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
