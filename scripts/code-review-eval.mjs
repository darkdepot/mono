#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runReviewRound } from './code-review.mjs';
import { digest, isMain, runtimePackRoot } from './runtime.mjs';

const need = (ok, reason) => { if (!ok) throw new Error(`review evaluation: ${reason}`); };
const nonempty = value => typeof value === 'string' && value.trim();
export function validateReviewDataset(dataset) {
  need(dataset.schemaVersion === 1 && dataset.version >= 1 && Array.isArray(dataset.tasks) && dataset.tasks.length, 'invalid version/tasks');
  need(new Set(dataset.tasks.map(task => task.id)).size === dataset.tasks.length, 'duplicate task');
  for (const task of dataset.tasks) {
    need(/^[a-f0-9]{40}$/.test(task.base) && /^[a-f0-9]{40}$/.test(task.head) && task.contractMode === 'pinned-blob', 'base/head/contract must be pinned');
    need(/^[a-f0-9]{40}$/.test(task.contractSource?.blob) && /^[a-f0-9]{64}$/.test(task.contractSource?.sha256) && nonempty(task.contractSource.file), 'contract source not pinned');
  }
  need(Array.isArray(dataset.cases) && new Set(dataset.cases.map(item => item.id)).size === dataset.cases.length, 'duplicate cases');
  for (const item of dataset.cases) need(dataset.tasks.some(task => task.id === item.task) &&
    ['class', 'file', 'anchor', 'trigger', 'consequence', 'oracle'].every(key => nonempty(item[key])) &&
    ['late12', 'extended16'].includes(item.subset) && typeof item.eligible === 'boolean' && typeof item.danger === 'boolean' && item.origin === 'first-head', 'incomplete case');
  need(dataset.cases.filter(item => item.subset === 'late12').length === 12 && dataset.cases.length === 16, 'historical 12/16 slots changed');
  need(dataset.cleanControls?.length && dataset.cleanControls.every(item => /^[a-f0-9]{40}$/.test(item.head) && /^[a-f0-9]{40}$/.test(item.base) &&
    item.base !== item.head && nonempty(item.contract) && item.file === 'CODE_REVIEW_EVAL_CONTROL.md' && nonempty(item.content)), 'clean changes missing');
  need(dataset.cases.some(item => item.danger) && nonempty(dataset.matchingRule), 'danger/matching rule missing');
  return { datasetDigest: digest(dataset), cases: dataset.cases.length, late: 12, eligibleLate: dataset.cases.filter(item => item.subset === 'late12' && item.eligible).length,
    eligibleExtended: dataset.cases.filter(item => item.eligible).length, clean: dataset.cleanControls.length };
}
function git(cwd, args, extraEnv = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' });
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
}
export function materializeCleanControl(worktree, control) {
  need(control.file === 'CODE_REVIEW_EVAL_CONTROL.md' && nonempty(control.content), 'invalid clean control file');
  git(worktree, ['checkout', '-q', '--detach', control.base]);
  need(!fs.existsSync(path.join(worktree, control.file)), 'clean control would overwrite a historical file');
  fs.writeFileSync(path.join(worktree, control.file), control.content);
  git(worktree, ['add', '--force', '--', control.file]);
  const tree = git(worktree, ['write-tree']);
  const head = git(worktree, ['commit-tree', tree, '-p', control.base, '-m', 'Code review clean document control'], {
    GIT_AUTHOR_NAME: 'Evaluation Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_AUTHOR_DATE: '2026-11-01T00:00:00Z',
    GIT_COMMITTER_NAME: 'Evaluation Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test', GIT_COMMITTER_DATE: '2026-11-01T00:00:00Z',
  });
  need(head === control.head, 'clean control commit differs from pin');
  git(worktree, ['checkout', '-q', '--detach', head]);
  return head;
}
export function verifyDatasetBundle(dataset, bundle) {
  validateReviewDataset(dataset);
  need(path.isAbsolute(bundle) && fs.lstatSync(bundle).isFile(), 'absolute regular bundle required');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-bundle-'));
  try {
    git(scratch, ['init', '-q']);
    git(scratch, ['fetch', '-q', '--no-tags', bundle, ...dataset.tasks.map(task => `refs/tags/dataset/${task.id}-head`)]);
    for (const task of dataset.tasks) {
      need(git(scratch, ['rev-parse', `${task.head}^{commit}`]) === task.head && git(scratch, ['merge-base', task.base, task.head]) === task.base, `unavailable base/head ${task.id}`);
      need(git(scratch, ['rev-parse', `${task.head}:${task.contractSource.file}`]) === task.contractSource.blob, `contract blob changed ${task.id}`);
      const source = execFileSync('git', ['-C', scratch, 'cat-file', 'blob', task.contractSource.blob]);
      need(createHash('sha256').update(source).digest('hex') === task.contractSource.sha256, `contract bytes changed ${task.id}`);
      for (const item of dataset.cases.filter(item => item.task === task.id)) need(git(scratch, ['show', `${task.head}:${item.file}`]).includes(item.anchor), `code anchor missing ${item.id}`);
    }
    for (const control of dataset.cleanControls) materializeCleanControl(scratch, control);
    return { ...validateReviewDataset(dataset), bundle: 'verified', modelCalls: 0 };
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
export function pinnedReviewContract(worktree, task) {
  const source = execFileSync('git', ['-C', worktree, 'cat-file', 'blob', task.contractSource.blob]);
  need(createHash('sha256').update(source).digest('hex') === task.contractSource.sha256, 'contract bytes changed');
  return source.toString('utf8');
}
export async function runReviewEvaluation({ dataset, bundle, config = {}, runId, packRoot = runtimePackRoot() }, dependencies = {}) {
  verifyDatasetBundle(dataset, bundle);
  need(nonempty(runId), 'unique runId required');
  const runs = [];
  const tasks = [...dataset.tasks.map(task => ({ ...task, caseId: task.id })), ...dataset.cleanControls.map(item => ({ ...dataset.tasks.find(task => task.id === item.task), ...item, caseId: item.id }))];
  const progress = dependencies.onProgress ?? (() => {});
  await progress({ type: 'plan', runId, datasetDigest: digest(dataset), runs: tasks.flatMap(task => [1, 2, 3].map(repeat => ({ id: `${runId}:${task.caseId}:${repeat}`, caseId: task.caseId, repeat, status: 'not-run' }))) });
  tasksLoop: for (const task of tasks) {
    for (let repeat = 1; repeat <= 3; repeat++) {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-review-case-'));
      const row = { id: `${runId}:${task.caseId}:${repeat}`, task: task.task ?? task.id, caseId: task.caseId, repeat,
        head: task.head, base: task.base, contractDigest: null };
      try {
        git(scratch, ['init', '-q']);
        git(scratch, ['fetch', '-q', '--no-tags', bundle, `refs/tags/dataset/${task.task ?? task.id}-head`]);
        if (task.file) materializeCleanControl(scratch, task);
        else git(scratch, ['checkout', '-q', '--detach', task.head]);
        const contract = task.file ? task.contract : pinnedReviewContract(scratch, task);
        row.contractDigest = digest(contract);
        await progress({ type: 'started', ...row });
        const record = await runReviewRound({ worktree: scratch, head: task.head, base: task.base, contract, risk: 'risky', config, packRoot }, dependencies);
        runs.push({ ...row, record });
      } catch (error) {
        runs.push({ ...row, record: { outcome: 'not-reviewed', interrupted: !!error.interrupted, findings: [], costs: [], failures: [{ reason: error.message }] } });
      } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
      await progress({ type: 'result', ...runs.at(-1) });
      if (runs.at(-1).record.interrupted) break tasksLoop;
    }
  }
  return { schemaVersion: 1, datasetDigest: digest(dataset), runId, runs, interrupted: runs.some(run => run.record.interrupted), quality: 'unscored; separate independent adjudications required' };
}
export function compareReviewEvaluations(candidate, baseline) {
  need(candidate.datasetDigest === baseline.datasetDigest, 'comparison dataset differs');
  need(candidate.runs.length > 0, 'empty comparison is unreviewed');
  need(candidate.runs.length === baseline.runs.length, 'comparison run denominator differs');
  return candidate.runs.map(run => {
    const matches = baseline.runs.filter(other => other.caseId === run.caseId && other.repeat === run.repeat);
    need(matches.length === 1, 'comparison needs exactly one incumbent repeat');
    const other = matches[0];
    need(['head', 'base', 'contractDigest'].every(key => run[key] === other[key]), 'incumbent inputs differ');
    return { candidate: run.id, baseline: other.id, caseId: run.caseId, repeat: run.repeat };
  });
}
export function scoreReviewEvaluation(dataset, evaluation, adjudications) {
  validateReviewDataset(dataset); need(evaluation.datasetDigest === digest(dataset), 'dataset changed after runs');
  need(Array.isArray(evaluation.runs) && evaluation.runs.length > 0, 'empty evaluation is unreviewed');
  need(new Set(evaluation.runs.map(run => run.id)).size === evaluation.runs.length, 'duplicate run id');
  const rows = [], union = new Set(), used = new Set();
  for (const grade of adjudications) {
    const run = evaluation.runs.find(run => run.id === grade.runId), identity = `${grade.runId}:${grade.key}`;
    need(run?.record.findings.some(finding => finding.key === grade.key) && !used.has(identity), 'unknown/duplicate graded finding'); used.add(identity);
    need(['strict', 'partial', 'novel', 'false-positive'].includes(grade.match) && nonempty(grade.judge) && nonempty(grade.evidence), 'independent judgment/evidence required');
    if (['strict', 'partial'].includes(grade.match)) need(dataset.cases.some(item => item.id === grade.caseId && item.task === run.task), 'match belongs to another task');
  }
  for (const run of evaluation.runs) {
    const clean = dataset.cleanControls.some(item => item.id === run.caseId);
    const grades = adjudications.filter(grade => grade.runId === run.id), strict = new Set(grades.filter(grade => grade.match === 'strict').map(grade => grade.caseId));
    const eligible = dataset.cases.filter(item => item.eligible && (!clean && item.task === run.task));
    strict.forEach(id => union.add(id));
    rows.push({ runId: run.id, repeat: run.repeat, task: run.task, clean, outcome: run.record.outcome,
      late12: { found: eligible.filter(item => item.subset === 'late12' && strict.has(item.id)).length, total: eligible.filter(item => item.subset === 'late12').length },
      extended16: { found: eligible.filter(item => strict.has(item.id)).length, total: eligible.length },
      partial: grades.filter(grade => grade.match === 'partial').length,
      falsePositives: grades.filter(grade => grade.match === 'false-positive').length,
      cleanFalseAlarms: clean ? grades.filter(grade => grade.match === 'false-positive').length : 0,
      novel: grades.filter(grade => grade.match === 'novel').length,
      ungraded: run.record.findings.filter(finding => !grades.some(grade => grade.key === finding.key)).length,
      disputedDanger: eligible.filter(item => item.dangerStatus === 'disputed').map(item => item.id),
      dangerousMisses: eligible.filter(item => item.danger && item.dangerStatus !== 'disputed' && !strict.has(item.id)).map(item => item.id), costs: run.record.costs, failures: run.record.failures });
  }
  return { rows, unionAdditionalOnly: [...union], nominalSlots: { late12: 12, extended16: 16 },
    enhancements: rows.flatMap(row => row.dangerousMisses.map(id => ({ runId: row.runId, missedCase: id, action: 'independent cause analysis and prompt/test strengthening' }))),
    boundary: 'Every run is separate. Union is additional only. Compare incumbent rows only for identical head/base/contract. Reviewer recall alone does not block release.' };
}
export function scoreCheckerProbes(gold, verdicts) {
  need(Array.isArray(gold) && gold.length > 0 && new Set(gold.map(item => item.key)).size === gold.length, 'empty or duplicate gold key');
  need(Array.isArray(verdicts) && new Set(verdicts.map(item => item.key)).size === verdicts.length && verdicts.every(item => gold.some(expected => expected.key === item.key)), 'unknown/duplicate probe key');
  need([...gold, ...verdicts].every(item => ['confirmed', 'rejected', 'unresolved'].includes(item.outcome) && /^P[0-3]$/.test(item.weight) &&
    [true, false, null].includes(item.danger) && nonempty(item.mergeKey)), 'unparsed probe verdict');
  const rows = gold.map(expected => {
    const actual = verdicts.find(item => item.key === expected.key);
    return { key: expected.key, missing: !actual, falseRejection: expected.outcome === 'confirmed' && actual?.outcome === 'rejected',
      dangerRemoved: expected.danger && actual?.danger === false, dangerDisputed: expected.dangerStatus === 'disputed',
      weightMismatch: actual ? actual.weight !== expected.weight : null,
      verdictMismatch: actual ? actual.outcome !== expected.outcome : null,
      unsafe: expected.dangerStatus !== 'disputed' && expected.danger && expected.outcome === 'confirmed' && (actual?.danger === false || actual?.outcome === 'rejected') };
  });
  const falseMerges = [];
  for (let i = 0; i < verdicts.length; i++) for (let j = i + 1; j < verdicts.length; j++) {
    const a = verdicts[i], b = verdicts[j];
    if (a.mergeKey === b.mergeKey && gold.find(item => item.key === a.key).mergeKey !== gold.find(item => item.key === b.key).mergeKey) falseMerges.push([a.key, b.key]);
  }
  return { rows, falseRejections: rows.filter(row => row.falseRejection).length, dangerRemoved: rows.filter(row => row.dangerRemoved).length,
    falseMerges, falseMergeCount: falseMerges.length, weightMismatches: rows.filter(row => row.weightMismatch).length,
    releaseBlocked: rows.some(row => row.unsafe), completed: rows.every(row => !row.missing) };
}
if (isMain(import.meta.url)) {
  try {
    const [mode, file, ...args] = process.argv.slice(2);
    if (mode === '--help') console.log('Usage: code-review-eval.mjs --validate <cases.json> --bundle <absolute.bundle> | --request <json>\nLive request: {dataset,bundle,config,runId}. Runs 3 risky repetitions per task/control; prints records. Host only; no benchmark result is a certificate.');
    else if (mode === '--validate' && args[0] === '--bundle' && args.length === 2) console.log(JSON.stringify(verifyDatasetBundle(JSON.parse(fs.readFileSync(file, 'utf8')), args[1]), null, 2));
    else if (mode === '--request' && !args.length) {
      const evaluation = await runReviewEvaluation(JSON.parse(fs.readFileSync(file, 'utf8')), { onProgress: event => console.log(JSON.stringify(event)) });
      console.log(JSON.stringify({ type: 'complete', evaluation }));
      if (evaluation.interrupted) process.exitCode = 130;
    }
    else throw new Error('use --help');
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
