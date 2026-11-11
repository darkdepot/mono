#!/usr/bin/env node
// Ship's pull request: a draft opened at the first collection, secrets checked before every push,
// remarks from the bot, CI and the owner gathered for the review rounds, and the way out of draft.
// The ship gate (gate.mjs ship), its decision format and the certificate are unchanged.
import fs from 'node:fs';
import os from 'node:os';
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
    // Raw NUL-separated output: a path may start or end with whitespace.
    const files = execFileSync('git', ['-c', 'core.quotePath=false', 'diff-tree', '--root', '-m', '--no-commit-id', '-r', '-z', '--name-only', '--diff-filter=AMCRT', commit],
      { cwd: worktree, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
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
// GitHub protection counts only when the remote really pushes to that repository.
export function pushesTo(url, repo) {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return !!match && `${match[1]}/${match[2]}`.toLowerCase() === String(repo).toLowerCase();
}
export function checkSecrets({ worktree, repo, remote, protection = null }) {
  let pushUrl = null; try { pushUrl = git(worktree, 'remote', 'get-url', '--push', remote); } catch {}
  if (!pushesTo(pushUrl, repo)) protection = 'not this repository';
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
// The author's part of the description sits between its own markers and names the head it describes;
// anything outside them (a bot's block) is kept when the description is rewritten.
const BODY_START = /<!-- mono:ship body head=([a-f0-9]{40}|none) -->\n?/, BODY_END = '<!-- /mono:ship body -->';
const BODY_MARKERS = /<!-- mono:ship body head=[^>]*-->\n?|<!-- \/mono:ship body -->\n?/g;
// Exactly one pair of markers; nested, repeated or unclosed ones mean there is no author part to trust.
export function authorPart(body) {
  const text = String(body ?? ''), start = BODY_START.exec(text);
  if (!start || (text.match(BODY_MARKERS) ?? []).length !== 2) return null;
  const end = text.indexOf(BODY_END, start.index + start[0].length);
  if (end < 0) return null;
  return { head: start[1] === 'none' ? null : start[1], text: text.slice(start.index + start[0].length, end).trim(),
    outside: (text.slice(0, start.index) + text.slice(end + BODY_END.length)).replace(SHIP_MARKER, '').trim() };
}
// A bot's block in the description is the one it marks itself (Greptile: <!-- greptile_comment --> … <!-- /greptile_comment -->).
export const botBlocks = body => [...String(body ?? '').matchAll(/<!-- ([a-z][a-z0-9_]*)_comment -->[\s\S]*?<!-- \/\1_comment -->/g)].map(match => match[0]);
export function composeBody({ author, head, current = '' }) {
  // Everything else of the old description is replaced: old author text never stays visible beside the new.
  const rest = botBlocks(current).join('\n\n');
  return `${SHIP_MARKER}\n<!-- mono:ship body head=${head ?? 'none'} -->\n${author.trim()}\n${BODY_END}${rest ? `\n\n${rest}` : ''}\n`;
}
export function draftBody({ issue, issueUrl, title, head = null }) {
  return composeBody({ author: `${title}\n\nЗадача: [${issue}](${issueUrl})`, head });
}
// U5: the «Проверки» line comes from the head's check evidence. Only finished, successful checks
// are «прошли»; skipped, neutral, failed, running and carried-over ones are named as such.
const CHECK_STATE = check => {
  if (check.__typename === 'StatusContext') return { SUCCESS: 'passed', PENDING: 'running', EXPECTED: 'running' }[check.state] ?? 'failed';
  if (check.status !== 'COMPLETED') return 'running';
  return { SUCCESS: 'passed', SKIPPED: 'skipped', NEUTRAL: 'neutral' }[check.conclusion] ?? 'failed';
};
const CHECK_WORDS = { skipped: 'пропущено', neutral: 'нейтрально', failed: 'упало', running: 'идёт' };
export function checksLine({ checks = [], head, deferred = [] }) {
  const onHead = checks.filter(check => check.head === head), groups = { passed: [], skipped: [], neutral: [], failed: [], running: [] };
  for (const check of onHead) groups[CHECK_STATE(check)].push(check.__typename === 'StatusContext' ? check.context : check.name);
  const parts = Object.entries(CHECK_WORDS).filter(([key]) => groups[key].length).map(([key, word]) => `${word}: ${groups[key].join(', ')}`);
  if (deferred.length) parts.push(`перенесено: ${deferred.join(', ')}`);
  return `Проверки: ${groups.passed.length} из ${onHead.length + deferred.length} прошли${parts.length ? `; ${parts.join('; ')}` : ''}`;
}
// What a reader sees: comments and every <details> block (with attributes, nested, or left unclosed) removed.
const visible = text => {
  let seen = String(text).replace(/<!--[\s\S]*?-->/g, ' '), previous;
  do { previous = seen; seen = seen.replace(/<details\b[^>]*>(?:(?!<details\b)[\s\S])*?<\/details\s*>/gi, ' '); } while (seen !== previous);
  return seen.replace(/<details\b[\s\S]*$/i, ' ');
};
const CHECKS_LINE = /^[ \t]*(?:[-*+>][ \t]*)*Проверки:.*$/gm;
const section = (text, name) => { const match = new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm').exec(text); return match ? match[1].trim() : null; };
// U5: only the unambiguous is checked before leaving draft; the read-only pass judges the rest.
export function bodyProblems({ body, issue, head, checks = [] }) {
  const part = authorPart(body);
  if (!part) return ['описание без части автора между метками Ship'];
  // Only what a reader sees counts: sections and the link hidden in comments or details do not.
  const problems = [], seen = visible(part.text);
  if (part.head !== head) problems.push('описание не переписано после последней версии кода');
  const changed = section(seen, 'Что изменилось');
  if (!changed || !/^\s*[-*] \S/m.test(changed)) problems.push('нет раздела «Что изменилось» со списком');
  for (const name of ['Зачем', 'Как проверить']) if (!section(seen, name)) problems.push(`нет раздела «${name}»`);
  const words = seen.split(/\s+/).filter(Boolean).length;
  if (words > 400) problems.push(`видимая часть ${words} слов, больше 400`);
  if (!/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(issue ?? '') || !seen.includes(`[${issue}](https://`)) problems.push(`нет ссылки на задачу ${issue}`);
  if (/\b[a-f0-9]{40}\b/.test(seen)) problems.push('хеш версии в видимой части');
  // The line must say exactly what the head's checks say now; carried-over items keep their own words.
  const lines = [...seen.matchAll(CHECKS_LINE)].map(match => match[0]);
  if (lines.length !== 1 || !lines[0].startsWith('Проверки: ')) problems.push('нужна ровно одна строка «Проверки», её пишет Ship');
  else {
    const written = lines[0].split(' · ')[0].trim(), deferred = /перенесено: ([^;]*)/.exec(written)?.[1].split(', ').filter(Boolean) ?? [];
    const fresh = checksLine({ checks, head, deferred });
    if (written !== fresh) problems.push(`строка «Проверки» устарела: сейчас «${fresh}»; перепиши описание (ship-pr.mjs body)`);
  }
  return problems;
}
// U1: push and open the draft once; a second entry finds the open PR of the branch.
export function openDraft({ worktree, repo, remote, branch, base, title, issue, issueUrl, protection = null }) {
  const head = git(worktree, 'rev-parse', 'HEAD');
  requireThat(/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(issue ?? '') && /^https:\/\//.test(issueUrl ?? '') && title?.trim(), 'issue key, issue URL and title required');
  const secrets = push({ worktree, repo, remote, branch, protection });
  const open = ghJson('pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number,url,isDraft');
  requireThat(Array.isArray(open) && open.length <= 1, 'more than one open PR for the branch');
  if (open.length) return { ...open[0], created: false, secrets };
  const url = gh('pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--draft', '--title', `${title} (${issue})`, '--body', draftBody({ issue, issueUrl, title, head }));
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
    // Every unmarked owner comment in any thread is an instruction of its own, never part of a bot remark.
    for (const comment of thread.comments) if (owner({ user: { login: comment.author?.login }, body: comment.body, created_at: comment.publishedAt })) {
      const at = byNode.get(comment.id) ?? rest;
      remarks.push({ id: remarkId(comment.id), source: 'owner', file: at?.path ?? '(pr)', line: at?.line ?? at?.original_line ?? 1, title: firstLine(comment.body),
        body: clip(comment.body, 4000), urgent: false, head });
    }
    if (!BOT(first.author?.login)) continue;
    const source = 'bot';
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
// U5/U6: the description passes the form check and the read-only pass found it truthful for exactly this text.
export function descriptionBlockers({ body, issue, head, checks = [], check = null }) {
  const problems = bodyProblems({ body, issue, head, checks });
  if (problems.length) return problems;
  const judged = check?.head === head ? check.description : null;
  if (judged?.digest !== digest(authorPart(body).text)) return ['описание не проверено на правдивость для этого текста и версии'];
  return judged.verdict === 'truthful' ? [] : [`в описании неверно: ${judged.falseClaims.join('; ')}`];
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
// Untrue claims in a row: a rewrite gets one more pass, the second stops Ship; a remarks-only pass keeps the count.
export const nextDescriptionFailures = (before, verdict) => verdict === 'false-claims' ? before + 1 : verdict === 'truthful' ? 0 : before;

const usage = `Usage: ship-pr.mjs <command> [flags]
  open    --worktree W --repo R --remote origin --branch B --base main --title T --issue KEY --issue-url URL   push and open the draft (once)
  push    --worktree W --repo R --remote origin --branch B                                                  check secrets, then push a round's fix
  remarks --repo R --pr N [--out FILE]                                                                     open remarks on the head (bot, CI, owner) as JSON
  body    --repo R --pr N --head SHA --issue KEY --file AUTHOR.md [--deferred "a;b"]                      rewrite the author part (templates/pr-body.md) and the «Проверки» line
  check   --worktree W --base SHA --head SHA --state-file S [--remarks FILE] [--repo R --pr N]          read-only pass: remarks (with decision, evidence) and the description
  ready   --repo R --pr N --head SHA --issue KEY --state-file S --preflight REQUEST                     leave draft: clean receipt, no failed CI, remarks settled, description checked
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
  if (command === 'body') {
    const pr = ghJson('api', `repos/${args.repo}/pulls/${args.pr}`), snapshot = readShipSnapshot(args.repo, Number(args.pr));
    requireThat(snapshot.head === args.head, `PR head moved: ${snapshot.head}`);
    // Ship writes the «Проверки» line itself from the head's checks; the author's text must not carry one.
    const author = fs.readFileSync(args.file, 'utf8').replace(CHECKS_LINE, '').trim();
    const line = checksLine({ checks: snapshot.checks, head: args.head, deferred: (args.deferred ?? '').split(';').map(item => item.trim()).filter(Boolean) });
    const body = composeBody({ author: `${author}\n\n${line} · Задача: ${args.issue}`, head: args.head, current: pr.body ?? '' });
    const problems = bodyProblems({ body, issue: args.issue, head: args.head, checks: snapshot.checks });
    requireThat(!problems.length, `description refused: ${problems.join('; ')}`);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pr-body-')), 'body.md');
    fs.writeFileSync(file, body);
    gh('pr', 'edit', String(args.pr), '--repo', args.repo, '--body-file', file);
    return console.log(JSON.stringify({ updated: true, head: args.head, checks: line }));
  }
  if (command === 'check') {
    const remarks = (args.remarks ? readJson(args.remarks) : []).map(({ id, source, title, body, urgent, head, decision, evidence }) => ({ id, source, title, body, urgent, head, decision, evidence }));
    const description = args.pr ? authorPart(ghJson('api', `repos/${args.repo}/pulls/${args.pr}`).body)?.text ?? null : null;
    requireThat(!args.pr || description, 'the PR body has no author part to check');
    const worktree = path.resolve(args.worktree), file = u6File(path.resolve(args['state-file']), args.head);
    const prior = fs.existsSync(file) ? readJson(file) : null;
    const result = await runRemarkCheck({ worktree, base: args.base, head: args.head, remarks, description, config: baseModelConfig(worktree, args.base) });
    // A rewrite after untrue claims gets one more pass; a second disagreement in a row stops Ship.
    const descriptionFailures = nextDescriptionFailures(prior?.descriptionFailures ?? 0, result.description.verdict);
    atomicJson(file, { ...result, descriptionFailures, recordedAt: new Date().toISOString() });
    const needs = result.verdicts.filter(verdict => verdict.verdict !== 'confirmed');
    console.log(JSON.stringify({ file, needsFix: needs, description: result.description }));
    if (descriptionFailures >= 2) { console.log('ship-pr: stop: the description disagreed with the change twice in a row; a person decides'); process.exitCode = 2; }
    else if (needs.length || descriptionFailures) process.exitCode = 1;
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
    const check = fs.existsSync(file) ? readJson(file) : null;
    const blockers = [...readyBlockers({ head: args.head, remarks: collectRemarks(found), sent: request.prRemarks ?? [], check }),
      ...descriptionBlockers({ body: found.pr.body, issue: args.issue, head: args.head, checks: snapshot.checks, check })];
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
