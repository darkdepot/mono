import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicJson, digest, readJson } from '../runtime.mjs';

// Relations are normalized from Linear, membership from the approved start's
// literal issues= token. A cross-package blocker is scheduling, not a chain.
export function copyChainSnapshot(source, target, issue, approval, worktree, base) {
  if (fs.existsSync(path.join(source, 'issue-only.json'))) return null;
  const context = readJson(path.join(source, 'issue-context.json'));
  const blockers = context.blockedBy ?? [];
  if (!Array.isArray(blockers) || blockers.some(key => !/^[A-Z][A-Z0-9]*-\d+$/.test(key))) throw new Error('invalid Blocked by snapshot');
  const token = /(?:^|\s)issues=([^\s]+)/u.exec(approval)?.[1];
  if (!token) return null;
  if (token && !Array.isArray(context.blockedBy)) throw new Error('approved package requires an explicit Blocked by snapshot');
  const members = token?.split(',').map(item => /^[^:]+:([A-Z][A-Z0-9]*-\d+)$/u.exec(item)?.[1]) ?? [];
  if (blockers.length && (!members.includes(issue) || members.some(key => !key))) throw new Error('Blocked by requires the approved package Issue set');
  const chain = [...new Set(blockers.filter(key => members.includes(key)))];
  if (!chain.length) return null;
  const predecessors = chain.map(key => {
    if (key === issue) throw new Error('a chain cannot depend on itself');
    const directory = path.join(source, 'predecessors', key), mergeFile = path.join(directory, 'merge.json');
    const json = path.join(directory, 'code-report.json'), markdown = path.join(directory, 'code-report.md');
    const reportFile = fs.existsSync(json) ? json : markdown;
    if (!fs.existsSync(reportFile) || !fs.existsSync(mergeFile)) throw new Error(`blocked: нет отчёта предшественницы ${key}`);
    const merge = readJson(mergeFile), body = fs.readFileSync(reportFile, 'utf8');
    if (merge.issue !== key || !/^[a-f0-9]{40}$/.test(merge.mergeCommit ?? '') || !body.trim()) throw new Error(`invalid predecessor ${key}`);
    try { execFileSync('git', ['-C', worktree, 'merge-base', '--is-ancestor', merge.mergeCommit, base], { stdio: 'pipe' }); }
    catch { throw new Error(`${key}: predecessor merge is not on dispatch main`); }
    const report = reportFile === json ? readJson(json) : null;
    if (report && (report.issue !== key || (report.phase !== undefined && report.phase !== 'code') ||
        (Array.isArray(report.criteria) && (report.phase !== 'code' || report.phase_result !== 'implemented-needs-preflight')) ||
        (merge.head && report.head && merge.head !== report.head))) throw new Error(`invalid final code report ${key}`);
    return { issue: key, mergeCommit: merge.mergeCommit, legacy: !Array.isArray(report?.criteria),
      report: `predecessors/${key}/${path.basename(reportFile)}`, reportDigest: digest(body), body, directory, reportFile, mergeFile };
  });
  for (const entry of predecessors) {
    const directory = path.join(target, 'predecessors', entry.issue); fs.mkdirSync(directory, { recursive: true });
    fs.copyFileSync(entry.reportFile, path.join(directory, path.basename(entry.reportFile)));
    fs.copyFileSync(entry.mergeFile, path.join(directory, 'merge.json'));
  }
  const saved = { issue, base, predecessors: predecessors.map(({ directory, reportFile, mergeFile, body, ...entry }) => entry) };
  atomicJson(path.join(target, 'chain.json'), saved);
  return { ...saved, predecessors: predecessors.map(({ directory, reportFile, mergeFile, ...entry }) => entry) };
}
