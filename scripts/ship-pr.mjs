#!/usr/bin/env node
// Ship's pull request: a draft opened at the first collection, secrets checked before every push,
// remarks from the bot, CI and the owner gathered for the review rounds, and the way out of draft.
// The ship gate (gate.mjs ship), its decision format and the certificate are unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomicJson, canonical, digest, readJson, flags, isMain, baseModelConfig } from './runtime.mjs';
import { readShipSnapshot } from './gate.mjs';
import { runRemarkCheck, remarkDigest } from './code-review.mjs';

// Every body Ship publishes on a PR carries this marker, in every phase, attempt and manual run.
export const SHIP_MARKER = '<!-- mono:ship -->';
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

// Plain signs only: a private key header, cloud keys, GitHub and model tokens.
export const SECRET_PATTERNS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
// Commits that would leave the machine: everything on HEAD that no remote-tracking branch of this remote has.
// Whole blobs of every added or changed file are read, so binary-looking files and diff attributes hide nothing.
const MAX_BLOB = 20 * 1024 * 1024;
export function scanBlob(file, content) {
  const found = [], lines = content.split('\n');
  lines.forEach((line, index) => { for (const [name, pattern] of SECRET_PATTERNS) if (pattern.test(line)) found.push({ file, line: index + 1, kind: name }); });
  return found;
}
export function unpushedSecrets(worktree, remote) {
  const commits = git(worktree, 'rev-list', 'HEAD', '--not', `--remotes=${remote}`).split('\n').filter(Boolean);
  return commits.flatMap(commit => {
    const files = git(worktree, '-c', 'core.quotePath=false', 'diff-tree', '--root', '-m', '--no-commit-id', '-r', '-z', '--name-only', '--diff-filter=AMCRT', commit)
      .split('\0').filter(Boolean);
    return [...new Set(files)].flatMap(file => {
      const size = Number(git(worktree, 'cat-file', '-s', `${commit}:${file}`));
      if (size > MAX_BLOB) return [{ file, line: 0, kind: 'file too large to scan', commit }];
      const content = execFileSync('git', ['cat-file', 'blob', `${commit}:${file}`], { cwd: worktree, maxBuffer: MAX_BLOB + 1024 }).toString('latin1');
      return scanBlob(file, content).map(item => ({ ...item, commit }));
    });
  });
}
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const ghJson = (...args) => JSON.parse(gh(...args) || 'null');
// Where GitHub push protection is on, GitHub is the check; elsewhere (or unreadable) Ship scans first.
export function checkSecrets({ worktree, repo, remote, protection = null }) {
  let status = protection;
  if (status === null) { try { status = gh('api', `repos/${repo}`, '--jq', '.security_and_analysis.secret_scanning_push_protection.status'); } catch { status = 'unknown'; } }
  if (status === 'enabled') return { scanned: false, protection: 'enabled', found: [] };
  const found = unpushedSecrets(worktree, remote);
  requireThat(!found.length, `secret before push: ${found.map(item => `${item.kind} in ${item.file}:${item.line} (${item.commit.slice(0, 12)})`).join('; ')}; a person decides`);
  return { scanned: true, protection: status, found };
}
function push({ worktree, repo, remote, branch, protection }) {
  const secrets = checkSecrets({ worktree, repo, remote, protection });
  try { execFileSync('git', ['push', remote, `HEAD:refs/heads/${branch}`], { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { throw new Error(`push refused: ${String(error.stderr ?? error.message).trim().slice(0, 2000)}`); }
  return secrets;
}
export function draftBody({ issue, issueUrl, title }) {
  return `${SHIP_MARKER}\n${title}\n\nЗадача: [${issue}](${issueUrl})\n`;
}
// U1: push and open the draft once; a second entry finds the open PR of the branch.
export function openDraft({ worktree, repo, remote, branch, base, title, issue, issueUrl, protection = null }) {
  requireThat(/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(issue ?? '') && /^https:\/\//.test(issueUrl ?? '') && title?.trim(), 'issue key, issue URL and title required');
  const secrets = push({ worktree, repo, remote, branch, protection });
  const open = ghJson('pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number,url,isDraft');
  requireThat(Array.isArray(open) && open.length <= 1, 'more than one open PR for the branch');
  if (open.length) return { ...open[0], created: false, secrets };
  const url = gh('pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--draft', '--title', `${title} (${issue})`, '--body', draftBody({ issue, issueUrl, title }));
  return { url, number: Number(url.split('/').pop()), isDraft: true, created: true, secrets };
}

const BOT = login => /\[bot\]$|greptile|devin/i.test(login ?? '');
const URGENT = /\bP[01]\b|badges\/p[01]\.svg/i;
const FAILED_RUNS = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'];
const marked = body => String(body ?? '').includes(SHIP_MARKER);
// A clipped remark names the digest of its full text, so an edit past the limit still changes the remark.
const clip = (value, limit) => { const flat = String(value ?? '').trim(); return flat.length > limit ? `${flat.slice(0, limit - 90)}…\n[full text sha256 ${digest(flat)}]` : flat; };
const firstLine = body => clip(String(body ?? '').replace(/<[^>]+>/g, ' ').split('\n').map(line => line.trim()).find(Boolean) ?? 'remark', 300);
const remarkId = value => String(value).replace(/[^A-Za-z0-9_.:/-]/g, '-').slice(0, 200);
// U3/U8: every open remark on the current head, with a stable id and a digest of its text.
// snapshot: readShipSnapshot; reviewComments: REST pulls/N/comments; issueComments: REST issues/N/comments.
export function collectRemarks({ snapshot, reviewComments = [], issueComments = [], pr = null }) {
  const head = snapshot.head, remarks = [];
  const byNode = new Map(reviewComments.map(comment => [comment.node_id, comment]));
  // Ship's own publications (the draft description included) are recognised by the marker; the owner's
  // instructions are the viewer's unmarked comments newer than Ship's first marked publication on this PR.
  const published = [...issueComments, ...reviewComments, ...(pr ? [pr] : [])].filter(comment => marked(comment.body)).map(comment => comment.created_at).sort();
  const since = published[0] ?? null;
  const owner = comment => since && comment.user?.login === snapshot.viewer && !marked(comment.body) && comment.created_at > since;
  for (const thread of snapshot.threads ?? []) {
    const first = thread.comments?.[0];
    // A resolved thread stays a remark: resolving it on GitHub is not evidence that it was settled.
    if (!first) continue;
    const rest = byNode.get(first.id);
    const source = BOT(first.author?.login) ? 'bot' : owner({ user: { login: first.author?.login }, body: first.body, created_at: first.publishedAt }) ? 'owner' : null;
    if (!source) continue;
    const body = thread.comments.filter(comment => !marked(comment.body)).map(comment => comment.body).join('\n\n');
    remarks.push({ id: remarkId(thread.id), source, file: rest?.path ?? '(pr)', line: rest?.line ?? rest?.original_line ?? 1, title: firstLine(first.body),
      body: clip(body, 4000), urgent: source === 'bot' && URGENT.test(first.body), head: /^[a-f0-9]{40}$/.test(rest?.commit_id ?? '') ? rest.commit_id : head,
      // Ship's own replies in the thread do not change the remark it answers.
      digest: digest(thread.comments.filter(comment => !marked(comment.body)).map(comment => [comment.id, comment.body])) });
  }
  for (const comment of snapshot.botComments ?? []) remarks.push({ id: remarkId(comment.id), source: 'bot', file: '(pr)', line: 1, title: firstLine(comment.body),
    body: clip(comment.body, 4000), urgent: URGENT.test(comment.body), head, digest: digest({ body: comment.body, updatedAt: comment.updatedAt ?? null }) });
  for (const comment of issueComments.filter(owner)) remarks.push({ id: remarkId(comment.node_id), source: 'owner', file: '(pr)', line: 1, title: firstLine(comment.body),
    body: clip(comment.body, 4000), urgent: false, head, digest: digest({ body: comment.body, updatedAt: comment.updated_at ?? null }) });
  for (const check of snapshot.checks ?? []) {
    const name = check.__typename === 'StatusContext' ? check.context : check.name;
    const failed = check.__typename === 'StatusContext' ? ['FAILURE', 'ERROR'].includes(check.state) : check.status === 'COMPLETED' && FAILED_RUNS.includes(check.conclusion);
    if (failed && check.head === head) remarks.push({ id: remarkId(`ci:${name}`), source: 'ci', file: '(pr)', line: 1, title: `CI check failed: ${name}`,
      body: clip(`${name}: ${check.conclusion ?? check.state}${check.targetUrl ? ` ${check.targetUrl}` : ''}`, 4000), urgent: false, head,
      digest: digest({ name, conclusion: check.conclusion ?? check.state, head }) });
  }
  return remarks.map(remark => ({ ...remark, digest: remarkDigest(remark) }));
}
// The form a remark takes in the collection request (gate.mjs preflight prRemarks).
export const requestRemark = ({ digest: _, ...remark }) => remark;

// U4: the draft leaves only with no failed CI on the head and every remark settled: carried in the
// prRemarks of the clean collection on this head (fixed and verified in the round), or confirmed by the
// read-only pass on this head for exactly this text. An owner instruction is never settled by the pass.
// A comment outside a thread has no head of its own: it was collected on the head before the fix.
const settled = remark => ({ ...requestRemark(remark), head: null });
export function readyBlockers({ head, remarks, sent = [], check = null }) {
  const blockers = [], fixed = new Set(sent.map(item => canonical(settled(item))));
  const confirmed = check?.head === head ? new Set(check.remarks.filter(item => check.verdicts.some(verdict => verdict.id === item.id && verdict.verdict === 'confirmed'))
    .map(item => `${item.id}\0${item.digest}`)) : new Set();
  for (const remark of remarks) {
    if (remark.source === 'ci') { blockers.push(`failed CI on head: ${remark.title}`); continue; }
    if (fixed.has(canonical(settled(remark)))) continue;
    if (remark.source === 'owner') { blockers.push(`owner instruction not done; ask the owner one question: ${remark.title}`); continue; }
    if (confirmed.has(`${remark.id}\0${remark.digest}`)) continue;
    blockers.push(`remark not settled on this head: ${remark.title} (${remark.id})`);
  }
  return blockers;
}
// U4: one mention of the bot per head when it has not reported on that head yet.
export function mentionNeeded({ snapshot, issueComments = [] }) {
  const head = snapshot.head;
  const botOnHead = (snapshot.checks ?? []).some(check => check.head === head && BOT(check.name ?? check.context)) ||
    (snapshot.reviews ?? []).some(review => BOT(review.user?.login) && review.commit_id === head);
  const mentioned = issueComments.some(comment => marked(comment.body) && comment.body.includes(head));
  return !botOnHead && !mentioned;
}
export const u6File = (stateFile, head) => `${stateFile}.u6-${head}.json`;

const usage = `Usage: ship-pr.mjs <command> [flags]
  open    --worktree W --repo R --remote origin --branch B --base main --title T --issue KEY --issue-url URL   push and open the draft (once)
  push    --worktree W --repo R --remote origin --branch B                                                  check secrets, then push a round's fix
  remarks --repo R --pr N [--out FILE]                                                                     open remarks on the head (bot, CI, owner) as JSON
  check   --worktree W --base SHA --head SHA --remarks FILE --state-file S                                read-only pass: remarks output items plus decision and evidence
  ready   --repo R --pr N --head SHA --state-file S --preflight REQUEST                                     leave draft: clean receipt (gate), no failed CI, every remark settled
  undo    --repo R --pr N                                                                                  back to draft (gh pr ready --undo)
  mention --repo R --pr N --mention @greptileai                                                            ask the bot once for this head
Every published body carries ${SHIP_MARKER}. Exit 1 prints the reason; nothing is merged.`;
async function main(argv) {
  const [command, ...rest] = argv, args = flags(rest);
  if (!command || command === '--help') { console.log(usage); return; }
  const snapshotFor = () => {
    const snapshot = readShipSnapshot(args.repo, Number(args.pr));
    const issueComments = ghJson('api', '--paginate', '--slurp', `repos/${args.repo}/issues/${args.pr}/comments`).flat();
    const reviewComments = ghJson('api', '--paginate', '--slurp', `repos/${args.repo}/pulls/${args.pr}/comments`).flat();
    const pr = ghJson('api', `repos/${args.repo}/pulls/${args.pr}`);
    return { snapshot, issueComments, reviewComments, pr: { body: pr.body ?? '', created_at: pr.created_at } };
  };
  if (command === 'open') return console.log(JSON.stringify(openDraft({ worktree: args.worktree, repo: args.repo, remote: args.remote ?? 'origin', branch: args.branch,
    base: args.base ?? 'main', title: args.title, issue: args.issue, issueUrl: args['issue-url'] })));
  if (command === 'push') return console.log(JSON.stringify(push({ worktree: args.worktree, repo: args.repo, remote: args.remote ?? 'origin', branch: args.branch, protection: null })));
  if (command === 'remarks') {
    const remarks = collectRemarks(snapshotFor());
    if (args.out) atomicJson(args.out, remarks);
    return console.log(JSON.stringify(remarks, null, 2));
  }
  if (command === 'check') {
    const remarks = readJson(args.remarks).map(({ id, source, title, body, urgent, head, decision, evidence }) => ({ id, source, title, body, urgent, head, decision, evidence }));
    const worktree = path.resolve(args.worktree);
    const result = await runRemarkCheck({ worktree, base: args.base, head: args.head, remarks, config: baseModelConfig(worktree, args.base) });
    const file = u6File(path.resolve(args['state-file']), args.head);
    atomicJson(file, { ...result, recordedAt: new Date().toISOString() });
    const needs = result.verdicts.filter(verdict => verdict.verdict !== 'confirmed');
    console.log(JSON.stringify({ file, needsFix: needs }));
    if (needs.length) process.exitCode = 1;
    return;
  }
  if (command === 'ready') {
    // The signed receipt decides: the pinned gate must pass collect:false for this exact request and head.
    const request = readJson(args.preflight);
    requireThat(request.collect === false && request.head === args.head, 'preflight request must be collect:false for this head');
    const gate = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'gate.mjs'), 'preflight', '--request', path.resolve(args.preflight)], { encoding: 'utf8' });
    requireThat(gate.status === 0, `stays draft: no clean review receipt on this head: ${String(gate.stdout || gate.stderr).trim().slice(0, 2000)}`);
    const found = snapshotFor(), { snapshot } = found;
    requireThat(snapshot.head === args.head, `PR head moved: ${snapshot.head}`);
    const file = u6File(path.resolve(args['state-file']), args.head);
    const blockers = readyBlockers({ head: args.head, remarks: collectRemarks(found), sent: request.prRemarks ?? [], check: fs.existsSync(file) ? readJson(file) : null });
    requireThat(!blockers.length, `stays draft: ${blockers.join('; ')}`);
    gh('pr', 'ready', String(args.pr), '--repo', args.repo);
    return console.log(JSON.stringify({ ready: true, head: args.head }));
  }
  if (command === 'undo') { gh('pr', 'ready', String(args.pr), '--repo', args.repo, '--undo'); return console.log(JSON.stringify({ draft: true })); }
  if (command === 'mention') {
    const { snapshot, issueComments } = snapshotFor();
    if (!mentionNeeded({ snapshot, issueComments })) return console.log(JSON.stringify({ mentioned: false }));
    gh('pr', 'comment', String(args.pr), '--repo', args.repo, '--body', `${SHIP_MARKER}\n${args.mention ?? '@greptileai'} review ${snapshot.head}`);
    return console.log(JSON.stringify({ mentioned: true, head: snapshot.head }));
  }
  throw new Error(`unknown command: ${command}\n${usage}`);
}
if (isMain(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.log(`ship-pr: fail: ${error.message}`); process.exitCode = 1; });
