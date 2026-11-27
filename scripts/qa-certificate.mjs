#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateShipCertificate } from './ship-certificate.mjs';
import { readQaRecipeFile } from './qa-recipe.mjs';

const SOURCES = ['task', 'requirement', 'acceptance', 'design', 'heuristic', 'scenario'];
export const QA_MARKER = 'mono-qa certificate';
// The certificate a task report carries after its marker line.
export const reportCertificate = report => JSON.parse(report.certificate.slice(QA_MARKER.length).trim());
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

function evidenceFile(file, root, label = 'evidenceRoot') {
  need(text(file) && path.isAbsolute(file), 'evidence path must be absolute');
  const actual = fs.realpathSync(file), parent = fs.realpathSync(root);
  need(actual.startsWith(parent + path.sep), `evidence escapes ${label}`);
  const stat = fs.statSync(actual);
  need(stat.isFile() && stat.size > 0 && (stat.mode & 0o444) !== 0, 'evidence must be a readable nonempty file');
  const fd = fs.openSync(actual, 'r');
  try { need(fs.readSync(fd, Buffer.alloc(1), 0, 1, 0) === 1, 'evidence cannot be opened'); }
  finally { fs.closeSync(fd); }
}

// A missing prior file is a broken carry-over, never «still waiting» (ENOENT means waiting at the gate).
function carryStep(message, fn) {
  try { return fn(); }
  catch (error) { throw new Error(`qa certificate: ${message}: ${error.message.replace(/^qa certificate: /, '')}`); }
}
const real = file => fs.realpathSync(file);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function headFolder(taskDir, head, message) {
  const folder = carryStep(message, () => real(path.join(taskDir, head)));
  need(folder === path.join(real(taskDir), head), `head folder ${head} must be a real folder inside qa/<KEY>/`);
  return folder;
}

// MONO-484: the host writes `purpose` and the `recheck` block before the pass. Items marked
// `carriedFrom` keep the result and evidence of the head where they were last observed live.
function priorPass(cert, expected, ctx) {
  const block = expected.recheck;
  need(object(block) && sha(block.previousHead) && block.previousHead !== expected.head
    && text(block.previousReport) && text(block.previousExpected) && Array.isArray(block.live), 'recheck requires previousHead, previousReport, previousExpected and live');
  need(!ctx.seen.has(block.previousHead), 'recheck chain repeats a head');
  const prevDir = path.dirname(path.resolve(block.previousReport));
  need(path.basename(block.previousReport) === 'task-report.json' && path.basename(block.previousExpected) === 'task-expected.json'
    && path.dirname(path.resolve(block.previousExpected)) === prevDir && path.basename(prevDir) === block.previousHead
    && path.basename(path.dirname(prevDir)) === expected.issue && path.basename(path.dirname(path.dirname(prevDir))) === 'qa',
  'previous report must be qa/<KEY>/<previousHead>/task-report.json of this task');
  const taskDir = path.dirname(prevDir);
  // Head folders are bound by real path: a symlinked head folder cannot point elsewhere.
  need(carryStep('previous QA folder missing', () => real(prevDir)) === path.join(real(taskDir), block.previousHead),
    'previous head folder must be a real folder inside qa/<KEY>/');
  if (ctx.taskDir) need(carryStep('previous QA folder missing', () => real(taskDir)) === carryStep('task QA folder missing', () => real(ctx.taskDir)),
    'previous report is outside qa/<KEY>/ of this task');
  const prevReport = carryStep('previous QA report missing', () => JSON.parse(fs.readFileSync(block.previousReport, 'utf8')));
  const prevExpected = carryStep('previous QA expectations missing', () => JSON.parse(fs.readFileSync(block.previousExpected, 'utf8')));
  need(object(prevExpected), 'previous expectations must be an object');
  // The prior pass keeps its own saved bindings; they must be this task, its head, ship and the same recipe.
  need(prevExpected.scope === 'task' && prevExpected.issue === expected.issue && prevExpected.head === block.previousHead
    && prevExpected.mode === 'ship' && prevExpected.recipeSource === expected.recipeSource && prevExpected.recipeSource !== 'file',
  'previous expectations must be a ship pass of this task and head with the same recipe source');
  need(digest(expected.recipeDigest) && prevExpected.recipeDigest === expected.recipeDigest, 'recipe changed since the previous pass');
  // The prior pass is checked by the same rules, without a ship certificate for its head.
  const prevCert = carryStep('previous QA report invalid', () => validate(prevReport, prevExpected,
    { skipShip: true, taskDir, seen: new Set([...ctx.seen, expected.head]) }));
  need(prevCert.kind === 'behavior', 'previous report has no item results');
  const prevExpectations = new Map(prevExpected.expectedItems.map(item => [item.id, item]));
  const live = new Set();
  // MONO-503: from the second pass a recheck names a short smoke set run live with the touched items.
  if (ctx.top) {
    need(Array.isArray(block.smoke) && block.smoke.length > 0 && block.smoke.every(id => expected.expectedItems.some(item => item.id === id)), 'recheck requires a nonempty smoke list of expected ids');
    for (const id of block.smoke) live.add(id);
  }
  for (const entry of block.live) {
    need(object(entry) && text(entry.id) && text(entry.reason) && expected.expectedItems.some(item => item.id === entry.id), 'recheck live entries need an expected id and reason');
    live.add(entry.id);
  }
  for (const item of prevCert.items) if (['failed', 'unverified'].includes(item.outcome)) live.add(item.id);
  for (const item of expected.expectedItems) {
    const old = prevExpectations.get(item.id);
    if (!old || old.source !== item.source || old.expectation !== item.expectation) live.add(item.id);
  }
  return { taskDir, live, items: new Map(prevCert.items.map(item => [item.id, item])), previousHead: block.previousHead,
    successors: prevCert.successors };
}

function carriedItem(item, prior) {
  need(sha(item.carriedFrom), 'carriedFrom must be a head');
  need(!prior.live.has(item.id), `item ${item.id} must be checked live`);
  const old = prior.items.get(item.id);
  need(old && old.source === item.source && old.expectation === item.expectation, `carried item ${item.id} differs from the previous report`);
  need(old.outcome === item.outcome && (old.outcome === 'passed' || (old.outcome === 'excluded'
    && old.successor === item.successor && old.reason === item.reason)), `carried item ${item.id} was not green on the previous head`);
  need(item.carriedFrom === (old.carriedFrom ?? prior.previousHead), `carried item ${item.id} must name the head where it was observed`);
  need(JSON.stringify(item.evidence) === JSON.stringify(old.evidence) && item.evidence.length > 0, `carried item ${item.id} must keep its evidence`);
  const origin = headFolder(prior.taskDir, item.carriedFrom, `carried evidence of ${item.id} missing`);
  for (const file of item.evidence) carryStep(`carried evidence of ${item.id} missing`, () => evidenceFile(file, origin, 'the observed head folder'));
}

// Expected identity comes from the caller, never from the certificate being checked.
// `taskDir` is the host's qa/<KEY>/ folder; the gate passes it, the CLI derives it from the recheck block.
export function validateQaCertificate(report, expected, { taskDir } = {}) {
  return validate(report, expected, { skipShip: false, taskDir, seen: new Set(), top: true });
}

// MONO-503: a bug is blocking (breaks an acceptance item, regresses a passing item, data, security,
// crash) or successor (filed as a new issue after merge, never holds it).
const BLOCKING = ['acceptance', 'regression', 'data', 'security', 'crash'];
const PROTECTED = ['task', 'requirement', 'acceptance', 'scenario'];
function triage(cert, expected, prior, before) {
  const bugs = cert.bugs ?? [];
  need(Array.isArray(bugs), 'bugs must be an array');
  const items = new Map(cert.items.map(item => [item.id, item])), ids = new Set();
  for (const bug of bugs) {
    need(object(bug) && text(bug.id) && !ids.has(bug.id) && text(bug.summary), 'bug requires a unique id and summary');
    ids.add(bug.id);
    need(['blocking', 'successor'].includes(bug.class), `bug ${bug.id} requires class blocking or successor`);
    need(bug.item === undefined || items.has(bug.item), `bug ${bug.id} names an unknown item`);
    need(bug.class === 'blocking' || !BLOCKING.includes(bug.why), `bug ${bug.id} with why ${bug.why} is a blocking bug, not a successor`);
    if (bug.class === 'blocking') {
      need(BLOCKING.includes(bug.why), `blocking bug ${bug.id} requires why: ${BLOCKING.join(', ')}`);
      need(!['acceptance', 'regression'].includes(bug.why) || items.get(bug.item)?.outcome === 'failed',
        `blocking bug ${bug.id} must name the failed item it breaks`);
    }
  }
  const successorFor = id => bugs.some(bug => bug.class === 'successor' && bug.item === id);
  for (const item of cert.items) {
    if (item.outcome !== 'failed' || !successorFor(item.id)) continue;
    need(!PROTECTED.includes(item.source) && !expected.taskCriteria.includes(item.id), `failed acceptance item ${item.id} is a blocking bug`);
    // A baseline counts only for the same expectation: changed text under the same id is a new item.
    const same = old => old?.outcome === 'passed' && old.source === item.source && old.expectation === item.expectation;
    need(!(same(prior?.items.get(item.id)) || before.passed.some(old => old.id === item.id && same(old))),
      `item ${item.id} passed on the previous head: regression is a blocking bug`);
  }
  const holding = bugs.some(bug => bug.class === 'blocking')
    || cert.items.some(item => item.outcome === 'unverified' || (item.outcome === 'failed' && !successorFor(item.id)));
  if (cert.verdict === 'passed') need(!holding, 'green verdict has a blocking bug, a failed or an unverified item');
  else need(holding || !bugs.length, 'successor bugs alone cannot hold the verdict');
  // Successors found on earlier heads stay listed in every second pass until the current pass sees their item
  // pass live or lists them in `resolved` ({head, id}).
  const resolved = cert.resolved ?? [];
  need(Array.isArray(resolved) && resolved.every(entry => object(entry) && sha(entry.head) && text(entry.id)), 'resolved entries need head and id');
  const own = bugs.filter(bug => bug.class === 'successor').map(bug => ({ ...bug, head: cert.head }));
  const key = bug => JSON.stringify([bug.item ?? null, bug.summary]);
  const seen = new Set(own.map(key));
  const earlier = [...(prior?.successors ?? []), ...before.successors].filter(bug => !seen.has(key(bug)) && seen.add(key(bug))
    && !resolved.some(entry => entry.head === bug.head && entry.id === bug.id)
    && !(bug.item && items.get(bug.item)?.outcome === 'passed' && items.get(bug.item).carriedFrom === undefined));
  return [...earlier, ...own];
}

const HEAD = /^[a-f0-9]{40}$/;
function derivedTaskDir(expected) {
  const root = text(expected.evidenceRoot) ? path.resolve(expected.evidenceRoot) : '';
  return root && path.basename(root) === expected.head && path.basename(path.dirname(root)) === expected.issue
    && path.basename(path.dirname(path.dirname(root))) === 'qa' ? path.dirname(root) : null;
}
// MONO-503: from the second pass on a task the recheck block is mandatory; a full pass needs a recorded
// reason, and the full list at the final gate (`fullPass.final`) runs once per task. Returns the ids that passed
// on another head of this task, so a full second pass cannot call a regression a successor either.
function secondPass(expected, ctx, prior, enforce) {
  const passed = [], successors = [], found = { passed, successors };
  const taskDir = ctx.taskDir ?? prior?.taskDir ?? derivedTaskDir(expected);
  const full = expected.fullPass;
  need(full === undefined || (object(full) && text(full.reason) && [undefined, true].includes(full.final)), 'fullPass requires a reason');
  need(!(full && expected.recheck), 'recheck and fullPass exclude each other');
  if (!taskDir || !fs.existsSync(taskDir)) return found;
  const others = fs.readdirSync(taskDir).filter(name => HEAD.test(name) && name !== expected.head
    && fs.existsSync(path.join(taskDir, name, 'task-report.json')));
  for (const name of others) {
    // Host-written reports of this task; an unreadable one is checked where it is carried, not here.
    try {
      const old = reportCertificate(JSON.parse(fs.readFileSync(path.join(taskDir, name, 'task-report.json'), 'utf8')));
      for (const item of old.items ?? []) if (item?.outcome === 'passed') passed.push(item);
      for (const bug of old.bugs ?? []) if (bug?.class === 'successor') successors.push({ ...bug, head: name });
    } catch { /* not a behavior report */ }
  }
  if (!others.length || !enforce) return found;
  need(expected.recheck !== undefined || full, 'second pass on this task requires a recheck block or fullPass.reason');
  if (full?.final) for (const name of others) {
    let saved; try { saved = JSON.parse(fs.readFileSync(path.join(taskDir, name, 'task-expected.json'), 'utf8')); } catch { continue; }
    need(saved?.fullPass?.final !== true, `final full pass already ran on head ${name}`);
  }
  return found;
}

function validate(report, expected, ctx) {
  need(object(expected), 'expected identity required');
  const raw = report?.certificate;
  need(typeof raw === 'string' && raw.startsWith(QA_MARKER + '\n'), 'one marker required');
  const cert = reportCertificate(report);
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
  if (cert.mode === 'ship' && !ctx.skipShip) validateShipCertificate({ issue: expected.issue, head: expected.head, certificate: expected.shipCertificate });
  if (cert.scope === 'project') need(buildIdentity(cert.build) === buildIdentity(expected.build), 'project build changed');
  need(['behavior', 'no-behavior'].includes(cert.kind) && cert.kind === expected.kind, 'kind mismatch');
  need(expected.purpose === undefined || ['change', 'release', 'acceptance'].includes(expected.purpose), 'purpose must be change, release or acceptance');
  if (expected.recheck !== undefined) need(cert.scope === 'task' && cert.mode === 'ship' && cert.recipeSource !== 'file'
    && cert.kind === 'behavior' && expected.purpose === 'change', 'recheck only for a task ship pass with purpose change');
  need(Array.isArray(expected.expectedItems) && expected.expectedItems.every(item => object(item) && text(item.id)
    && text(item.expectation) && SOURCES.includes(item.source))
    && new Set(expected.expectedItems.map(item => item.id)).size === expected.expectedItems.length, 'unique expectation list required');
  const expectations = new Map(expected.expectedItems.map(item => [item.id, item]));
  need(!(cert.kind === 'no-behavior' && expected.expectedItems.some(item => item.source === 'scenario')), 'scenario cannot use no-behavior');
  if (cert.kind === 'no-behavior') {
    need(cert.scope === 'task' && text(cert.reason), 'no-behavior requires task and reason');
    need(cert.items === undefined && cert.bugs === undefined, 'no-behavior cannot replace item results');
    return { ...cert, gateEligible, successors: [] };
  }
  need(Array.isArray(cert.items) && cert.items.length > 0, 'items must be nonempty');
  need(text(expected.evidenceRoot), 'evidenceRoot required');
  need(expected.expectedItems.length > 0, 'unique expectation list required');
  need(Array.isArray(expected.taskCriteria) && expected.taskCriteria.every(id => expectations.has(id)), 'taskCriteria must be bound to expectations');
  const prior = expected.recheck === undefined ? null : priorPass(cert, expected, ctx);
  if (expected.fullPass !== undefined) need(cert.scope === 'task' && cert.kind === 'behavior', 'fullPass only for a task pass');
  const ids = new Set();
  for (const item of cert.items) {
    need(object(item) && text(item.id) && !ids.has(item.id) && text(item.expectation), 'unique item id and expectation required');
    ids.add(item.id);
    need(SOURCES.includes(item.source), 'item source required');
    const bound = expectations.get(item.id);
    need(bound && bound.source === item.source && bound.expectation === item.expectation, 'expectation text or source changed/mismatch');
    need(item.source !== 'scenario' || item.outcome !== 'excluded', 'scenario cannot be excluded');
    need(['passed', 'failed', 'unverified', 'excluded'].includes(item.outcome), 'item outcome required');
    need(Array.isArray(item.evidence), 'item evidence required');
    if (item.carriedFrom !== undefined) {
      need(prior, 'carried items require a recheck block with purpose change');
      carriedItem(item, prior);
    } else {
      for (const file of item.evidence) evidenceFile(file, expected.evidenceRoot);
      if (prior) {
        const current = headFolder(prior.taskDir, expected.head, 'current head folder missing');
        for (const file of item.evidence) evidenceFile(file, current, 'the current head folder');
      }
    }
    if (item.outcome === 'excluded') {
      need(item.evidence.length > 0, 'excluded requires evidence of instability on main');
      need(item.source !== 'task' && !expected.taskCriteria.includes(item.id), 'task acceptance cannot be excluded');
      need(text(item.reason) && typeof item.successor === 'string' && /^https:\/\/linear\.app\/[^\s]+\/issue\/[^\s]+$/.test(item.successor), 'excluded requires reason and successor issue link');
    } else if (item.outcome === 'passed') need(item.evidence.length > 0, 'passed item without evidence must be failed');
    else need(text(item.reason), 'failed/unverified requires reason');
  }
  need(Array.isArray(expected.expectedItems) && expected.expectedItems.length > 0
    && expected.expectedItems.length === ids.size && expected.expectedItems.every(item => ids.has(item.id)), 'expectation list missing or incomplete');
  const passedBefore = ctx.top && cert.scope === 'task' && cert.mode === 'ship' && cert.recipeSource !== 'file'
    ? secondPass(expected, ctx, prior, !['release', 'acceptance'].includes(expected.purpose)) : { passed: [], successors: [] };
  const successors = triage(cert, expected, prior, passedBefore);
  return { ...cert, gateEligible, successors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [reportFile, expectedFile, ...extra] = process.argv.slice(2);
    need(reportFile && expectedFile && extra.length === 0, 'usage: qa-certificate.mjs <report.json> <expected.json>');
    const cert = validateQaCertificate(JSON.parse(fs.readFileSync(reportFile)), JSON.parse(fs.readFileSync(expectedFile)));
    console.log(JSON.stringify({ valid: true, verdict: cert.verdict, gateEligible: cert.gateEligible }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
