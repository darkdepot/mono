#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomicJson, canonical, digest, readJson, flags, isMain, withLock, shipBotChecks } from './runtime.mjs';
import { validateDeployConfig, affected } from './deploy-config.mjs';
import { validateShipCertificate } from './ship-certificate.mjs';
import { readShipSnapshot, isReviewBot, isBotCheck } from './gate.mjs';
import { readPrPublications, SHIP_MARKER, authorPart } from './ship-pr.mjs';
import { requireQaPassed } from './qa-gate.mjs';
import { check as landingCheck } from './orchestrator/landing-guard.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const need = (ok, message) => { if (!ok) throw new Error(`deploy: ${message}`); };
const SHA = /^[a-f0-9]{40}$/;
const stamp = value => typeof value === 'number' ? value : Date.parse(value);
const url = value => `https://${String(value).replace(/^https:\/\//, '').replace(/\/$/, '')}`;
const commit = deployment => deployment?.meta?.githubCommitSha ?? deployment?.gitSource?.sha;
const ready = deployment => deployment?.target === 'production' && deployment.readyState === 'READY';
const cli = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
const vercel = args => { try { return cli('vercel', args); } catch (error) { // Logout and timeouts get an actionable reason; the Stop stays.
  throw /ETIMEDOUT|not logged in|No existing credentials|\b40[13]\b/i.test(`${error.code} ${error.stderr}`) ? new Error('Vercel CLI не вошёл в аккаунт или не отвечает: войди (`vercel login`) и повтори') : error; } };
const gh = (...args) => JSON.parse(cli('gh', ['api', ...args]));
const pages = endpoint => gh('--paginate', '--slurp', endpoint).flat();
const save = (file, value) => {
  const data = JSON.parse(JSON.stringify(value));
  atomicJson(file, data); need(canonical(readJson(file)) === canonical(data), 'state read-back failed');
};
const filesIn = directory => fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => path.join(directory, name)) : [];

// Only the latest Ship publication on this head is the boundary. Resolved replies
// and Ship's own publications are deliberately excluded from new remarks.
export function afterShip({ snapshot, issueComments, reviewComments, pr, reviewBodies = snapshot.reviews }, head, ignoreBots = false, botChecks = ['Greptile Review', 'Devin Review']) {
  const ship = comment => !!snapshot.viewer && (comment.user?.login ?? comment.author?.login) === snapshot.viewer && comment.body?.includes(SHIP_MARKER);
  const body = authorPart(pr.body);
  const bodyPublication = body?.head === head && body.publishedAt ? { ...pr, updated_at: body.publishedAt } : null;
  const publications = [bodyPublication, ...issueComments, ...reviewBodies, ...reviewComments,
    ...snapshot.threads.flatMap(thread => thread.comments)].filter(Boolean);
  const onHead = comment => ship(comment) &&
    (comment.commit_id === head || comment.body.includes(head));
  const time = comment => stamp(comment.updated_at ?? comment.updatedAt ?? comment.submitted_at ?? comment.publishedAt ?? comment.created_at);
  const boundary = Math.max(...publications.filter(onHead).map(time));
  need(Number.isFinite(boundary), 'latest Ship publication time missing; republish Ship body');
  const reviewBot = user => isReviewBot(user, [...botChecks, 'Greptile Review', 'Devin Review'], [...snapshot.checks, ...(snapshot.ciHistory ?? []).flatMap(item => item.checks)]);
  const threads = snapshot.threads.filter(thread => !ignoreBots || !reviewBot(thread.comments?.[0]?.author));
  need(threads.every(thread => thread.isResolved === true), 'unresolved review thread');
  const threadComments = new Set(threads.flatMap(thread => thread.comments.map(comment => comment.id)));
  const comments = [...issueComments, ...reviewBodies, ...reviewComments.filter(comment => !threadComments.has(comment.node_id))];
  if (pr.body && !ship(pr)) comments.push(pr);
  return comments.filter(comment => comment.body?.trim() && !ship(comment) && (!ignoreBots || !reviewBot(comment.user ?? comment.author)) && time(comment) > boundary);
}

// An interrupted action is never replayed merely because its result is absent.
// The adapter must positively establish non-execution; unknown waits then stops.
export async function performIntent({ state, key, action, target, persist, observe, execute, now, sleep, deadline }) {
  let intent = state.intents[key];
  if (intent?.result) return intent.result;
  if (intent) {
    need(intent.action === action && intent.target === target, 'intent target changed');
    while (true) {
      const fact = await observe(intent);
      if (fact.state === 'occurred') { intent.result = fact.value; persist(); return intent.result; }
      if (fact.state === 'not-executed' && !intent.replayed) { intent.replayed = true; persist(); break; }
      need(now() < deadline, `${action} did not confirm${intent.error ? ` (${intent.error})` : ''}; Stop without repeating`);
      await sleep(Math.min(20_000, deadline - now()));
    }
  } else {
    intent = state.intents[key] = { action, target, at: now() }; persist();
  }
  try { await execute(intent); } catch (error) { intent.error = error.message; persist(); }
  while (true) {
    const fact = await observe(intent);
    if (fact.state === 'occurred') { intent.result = fact.value; persist(); return intent.result; }
    need(now() < deadline, `${action} did not confirm${intent.error ? ` (${intent.error})` : ''}; Stop without repeating`);
    await sleep(Math.min(20_000, deadline - now()));
  }
}

export async function runDeploy(command, request, clock = {}) {
  const now = clock.now ?? Date.now;
  const sleep = clock.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  need(['merge', 'prove', 'local', 'check', 'rollback', 'return', 'outcome'].includes(command), 'unknown command');
  need(path.isAbsolute(request.root ?? '') && path.isAbsolute(request.config ?? '') && path.isAbsolute(request.worktree ?? ''), 'absolute root/config/worktree required');
  need(/^[\w.-]+\/[\w.-]+$/.test(request.repo ?? '') && SHA.test(request.head ?? '') && /^[A-Z][A-Z0-9]*-\d+$/.test(request.issue ?? ''), 'repo, head and issue required');
  const config = readJson(request.config), started = now(); // No block: merge after the same gates, honest «не проверено».
  const deploy = Object.hasOwn(config, 'deploy') ? validateDeployConfig(config.deploy) : null;
  const lock = path.join(request.root, 'deploy.lock'), runFile = path.join(request.root, 'landing/deploy', `${request.head}.json`);
  // The ledger gets a line only when the run state changes, not on every repeated call.
  const phase = r => JSON.stringify([r.merge, r.landing?.code, r.stop?.reason, r.closedAt, r.targets.map(t => [t.proof?.id, !!t.unread, t.rolledBack, t.returned, t.failed])]);
  const write = (r, logged) => {
    save(runFile, r); if (phase(r) === logged) return logged;
    const fd = fs.openSync(path.join(request.root, 'ledger.md'), 'a', 0o600);
    try { fs.writeSync(fd, `- ${new Date(now()).toISOString()} DEPLOY ${JSON.stringify({ head: r.head, command, closed: !!r.closedAt })}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } return phase(r);
  };
  const result = await withLock(lock, async () => {
    let run = fs.existsSync(runFile) ? readJson(runFile) : null, logged = run && phase(run);
    const persist = () => { logged = write(run, logged); };
    if (run) need(run.repo === request.repo && run.issue === request.issue && run.head === request.head && canonical(run.config) === canonical(deploy), 'run/config identity changed');
    const rollbackFile = target => path.join(request.root, 'landing/rollback', `${target.key}.json`);
    const rollback = target => fs.existsSync(rollbackFile(target)) ? readJson(rollbackFile(target)) : null;
    const archive = target => { const file = rollbackFile(target), value = readJson(file);
      save(path.join(path.dirname(file), 'archive', `${target.key}-${value.head}.json`), { ...value, returnedAt: now() }); fs.unlinkSync(file); };
    const api = (target, endpoint) => JSON.parse(vercel(['api', endpoint, '--scope', target.recipe.team]));
    const domain = target => api(target, `/v13/deployments/${target.recipe.domain}?teamId=${encodeURIComponent(target.recipe.team)}`);
    const project = target => api(target, `/v9/projects/${target.projectId}`);
    const follows = (base, actual) => SHA.test(actual ?? '') && (actual === base || ['identical', 'ahead'].includes(gh(`repos/${run?.repo ?? request.repo}/compare/${base}...${actual}`).status));
    const quick = (target, address) => {
      let result = 'green', reason = '';
      try { cli('sh', target.recipe.kind === 'local' ? ['-c', target.recipe.check] : ['-c', `${target.recipe.check} "$1"`, 'deploy-check', address], { cwd: request.worktree }); }
      catch (error) { result = 'red'; reason = String(error.stderr ?? error.message).slice(0, 1500); }
      const check = { id: target.proof.id, url: address, kind: 'quick', surface: target.recipe.kind === 'local' ? 'local' : 'domain', result, reason, attempt: target.checks.filter(c => c.id === target.proof.id && c.kind === 'quick' && c.surface === 'domain').length + 1, at: now() };
      target.checks.push(check); persist(); return check;
    };
    const health = target => need(quick(target, target.recipe.kind === 'local' ? '' : url(target.recipe.domain)).result === 'green', 'restored production quick check failed; Stop');
    const followup = (target, reason, kind = 'repair') => {
      if (!(run.followups ??= []).some(row => row.target === target.key && row.reason === reason)) run.followups.push({ target: target.key, reason, kind }); persist(); };
    const stopped = (reason, target, browser = false) => {
      run.stop = { reason, target: target?.key, browser, at: now() }; persist();
      let production = 'не подтверждён';
      if (browser && target?.recipe.kind === 'vercel') try {
        const current = domain(target), rb = rollback(target);
        if (ready(current)) production = current.id === (rb?.rollback.id ?? target.baseline?.id) ? 'на прошлой версии'
          : current.id === target.proof?.id ? 'на новой версии' : 'на версии, которую этот запуск не подтвердил';
      } catch { /* The owner line must preserve unavailable production identity. */ }
      return { state: 'stopped', outcome: null, open: true, reason, followups: run.followups ?? [], lines: browser ? [
        `Стоп в ${config.projectName}: проверка недоступна.`,
        `Сделал: не откатывал, проверить ${rollback(target)?.fix ? 'сборку починки' : 'прошлую сборку'} без браузера со входом Vercel не смог; прод сейчас ${production}.`,
        'От тебя: дай браузер со входом Vercel.'
      ] : [`Стоп в ${config.projectName}: ${reason}.`] };
    };
    const flagMatches = async (target, expected, deadline = now() + 30_000) => {
      while (project(target).autoAssignCustomDomains !== expected) { need(now() < deadline, 'rollback file and Vercel disagree'); await sleep(Math.min(1_000, deadline - now())); }
    };
    if (command === 'merge') {
      const binding = validateShipCertificate({ issue: request.issue, head: request.head, certificate: request.certificate }, request.repo);
      const pr = gh(`repos/${request.repo}/pulls/${binding.pr}`);
      need(pr.head?.sha === request.head, 'head changed; back to Ship');
      need(pr.state === 'open' || pr.merged === true, 'PR is not open');
      if (run) need(run.pr === binding.pr, 'run belongs to another PR');
      let files, fileError;
      try { files = pages(`repos/${request.repo}/pulls/${binding.pr}/files`); }
      catch (error) { fileError = error.message; }
      const complete = Number.isSafeInteger(pr.changed_files) && pr.changed_files >= 0 && Array.isArray(files) &&
        files.length === pr.changed_files && files.every(file => typeof file?.filename === 'string' && file.filename.length);
      if (!complete) {
        const reason = `PR file list ${fileError ? `unavailable: ${fileError}` : `incomplete: expected ${pr.changed_files}, read ${files?.length ?? 0}`}`;
        return { state: 'blocked', outcome: null, targets: (deploy?.targets ?? []).map((_, index) => index), reason, lines: [`Не вливаю: ${reason}.`] };
      }
      if (request.afk && !pr.merged && files.some(file => /(^|\/)migrations\//.test(file.filename) &&
        (typeof file.patch !== 'string' || !file.patch.trim() || file.patch.split('\n').some(line => /^\+[^+]/.test(line) && /\b(drop|rename|truncate)\b/i.test(line))))) return { state: 'waiting-morning', outcome: null, reason: 'destructive migration' };
      const other = filesIn(path.dirname(runFile)).map(readJson).find(row => row.head !== request.head && !row.closedAt);
      need(!other, 'another deploy run is open');
      const browserReady = target => {
        const current = domain(target), mark = Array.isArray(request.browserReady) ? request.browserReady.find(mark => mark.target === target.index) : request.browserReady;
        if (!mark || mark.id !== current.id || !Number.isFinite(stamp(mark.at)) || now() - stamp(mark.at) > 600_000 || stamp(mark.at) > now()) return false;
        target.browserReady = mark; return true;
      };
      if (!run) {
        run = { head: request.head, repo: request.repo, issue: request.issue, pr: binding.pr, config: deploy, createdAt: now(), intents: {}, targets: (deploy?.targets ?? []).map((recipe, index) => ({ key: digest(recipe).slice(0, 16), index, recipe, checks: [] })).filter(target => affected(target.recipe, files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean)))) };
        for (const target of run.targets) if (target.recipe.kind === 'vercel') {
          target.baseline = domain(target); target.projectId = target.baseline.projectId;
          need(ready(target.baseline) && target.baseline.id && target.baseline.url && target.projectId, 'production rollback target unavailable');
        }
      }
      for (const file of filesIn(path.join(request.root, 'landing/rollback')))
        need(run.targets.some(target => path.basename(file) === `${target.key}.json`), 'product on rollback; repair must affect recorded target');
      for (const target of run.targets) {
        const rb = rollback(target);
        if (target.recipe.kind === 'vercel') {
          await flagMatches(target, !rb || rb.phase === 'awaiting-prod');
          if (request.afk && !pr.merged && !browserReady(target)) return { state: 'waiting-morning', outcome: null, reason: 'browser with Vercel login not ready' };
        }
        if (rb) {
          need(request.fix === rb.issue && request.issue === rb.issue, 'product on rollback; only recorded repair Issue allowed');
          const attempt = { issue: request.issue, pr: binding.pr, head: request.head };
          need(!rb.fix || canonical(rb.fix) === canonical(attempt), 'repair attempt belongs to another PR/head');
          if (!rb.fix) { rb.fix = attempt; save(rollbackFile(target), rb); }
        }
      }
      if (!pr.merged) {
        const snapshot = readShipSnapshot(request.repo, binding.pr, Infinity, binding.bot ? 0 : null);
        need(snapshot.head === request.head && snapshot.state === 'OPEN', 'head changed; back to Ship');
        const bots = binding.bot ? shipBotChecks(config) : [];
        const waived = check => !!binding.bot && isBotCheck(check.name ?? check.context, snapshot, { botChecks: bots });
        const excludedBot = snapshot.checks.some(check => waived(check) && (check.__typename === 'StatusContext' ? check.state !== 'SUCCESS' : check.status !== 'COMPLETED' || check.conclusion !== 'SUCCESS'));
        need((snapshot.mergeStateStatus === 'CLEAN' && pr.mergeable_state === 'clean') ||
          (excludedBot && snapshot.mergeable === 'MERGEABLE' && snapshot.mergeStateStatus === 'UNSTABLE' && pr.mergeable_state === 'unstable'), 'merge state is not clean');
        need(snapshot.checks.filter(check => !waived(check)).every(check => check.head === request.head && (check.__typename === 'StatusContext' ? check.state === 'SUCCESS' : check.status === 'COMPLETED' && ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion))), 'checks unfinished or red');
        need(!afterShip({ snapshot, ...readPrPublications(request.repo, binding.pr, { includeReviews: true }) }, request.head, !!binding.bot, bots).length, 'new remarks after Ship');
        requireQaPassed({ root: request.root, config, issue: request.issue, head: request.head, shipCertificate: request.certificate });
        if (config.landing?.validation) {
          const tip = gh(`repos/${request.repo}/commits/main`).sha;
          const guard = await landingCheck({ root: request.root, config: request.config, repo: request.repo, sha: tip });
          const record = readJson(path.join(request.root, 'landing/guard', `${tip}.json`));
          need(guard.code === 0 || (guard.code === 1 && record.corrective?.issue === request.issue), 'landing tip is red; corrective authorization required');
        }
        if (request.afk && run.targets.some(target => target.recipe.kind === 'vercel' && !browserReady(target))) return { state: 'waiting-morning', outcome: null, reason: 'browser with Vercel login not ready' };
        persist(); // Immutable pre-merge rollback target is read back before gh writes.
        cli('gh', ['pr', 'merge', String(binding.pr), '--repo', request.repo, '--squash', '--match-head-commit', request.head]);
      }
      const merged = gh(`repos/${request.repo}/pulls/${binding.pr}`);
      need(merged.merged && merged.head.sha === request.head && SHA.test(merged.merge_commit_sha) && Number.isFinite(stamp(merged.merged_at)), 'merge not confirmed');
      run.merge = merged.merge_commit_sha; run.mergedAt = stamp(merged.merged_at); persist();
      if (run.targets.some(target => target.recipe.kind === 'pack') && config.landing) {
        const registryFile = path.join(request.root, 'workers.json');
        const entry = fs.existsSync(registryFile) ? readJson(registryFile)[request.issue] : null;
        if (entry?.attempt) cli(process.execPath, [path.join(scripts, 'orchestrator/landing-drain.mjs'), 'record', '--root', request.root, '--issue', request.issue, '--attempt', String(entry.attempt), '--pr', String(binding.pr), '--repo', request.repo, '--config', request.config]);
      }
      if (config.landing?.validation) { run.landing = await landingCheck({ root: request.root, repo: request.repo, sha: run.merge, config: request.config }); persist(); }
      return { state: run.landing && run.landing.code !== 0 ? 'waiting-validation' : 'merged', head: run.head, merge: run.merge, landing: run.landing, targets: run.targets.map(target => target.index) };
    }
    need(run?.merge, 'merged run required');
    const target = run.targets.find(row => row.index === Number(request.target));
    if (command === 'rollback' && request.repairIssue && target?.rolledBack) {
      const rb = rollback(target);
      need(/^[A-Z][A-Z0-9]*-\d+$/.test(request.repairIssue) && rb?.head === run.head && (!rb.issue || rb.issue === request.repairIssue), 'repair Issue binding conflicts');
      rb.issue = request.repairIssue; save(rollbackFile(target), rb); persist();
      return { state: 'repair-bound', outcome: 'откатили' };
    }
    if (run.closedAt) return { state: 'closed', ...run.outcome };
    if (config.landing?.validation && (run.landing?.code !== 0 || run.landing.sha !== run.merge) && ['local', 'prove', 'return', 'outcome'].includes(command))
      return { state: 'waiting-validation', outcome: null, open: true, reason: 'green landing-guard check on merge commit not recorded; resume merge', landing: run.landing ?? null };
    if (['prove', 'local', 'check', 'rollback', 'return'].includes(command)) need(target, 'affected target index required');
    const currentChecks = t => t.recipe.kind === 'local' ? t.checks.slice(t.proof?.checksFrom ?? 0) : t.checks;
    const latest = (t, id, surface, kind) => currentChecks(t).filter(check => check.id === id && check.surface === surface && check.kind === kind).at(-1);
    const green = (t, id, surface) => ['quick', 'scenario'].every(kind => latest(t, id, surface, kind)?.result === 'green');
    const browserMissing = t => t.checks.some((check, index) => check.surface === 'browser' && check.result === 'unavailable' && check.browserAvailable !== true && !t.checks.slice(index + 1).some(next => next.id === check.id && next.kind === check.kind && next.surface === 'browser' && (next.result !== 'unavailable' || next.browserAvailable === true)));
    const deploymentFor = t => {
      const p = project(t);
      const found = [...(p.latestDeployments ?? []), p.targets?.production].filter(Boolean).find(item => commit(item) === run.merge && item.target === 'production');
      return found ? api(t, `/v13/deployments/${found.id}`) : null;
    };
    const intent = (key, action, destination, observe, execute, deadline) => performIntent({ state: run, key: `${target.key}:${key}`, action, target: destination, persist, observe, execute, now, sleep, deadline });
    const retry = async deadline => {
      // Admission governs a new POST, not observation of a recorded action.
      if (!run.intents[`${target.key}:retry`]) {
        const main = gh(`repos/${run.repo}/commits/main`).sha;
        if (main !== run.merge) {
          const comparison = gh(`repos/${run.repo}/compare/${run.merge}...${main}`);
          need(Array.isArray(comparison.files) && comparison.files.length < 300, 'main comparison incomplete; no repeat');
          if (!['ahead', 'identical'].includes(comparison.status) || affected(target.recipe, (comparison.files ?? []).flatMap(file => [file.filename, file.previous_filename].filter(Boolean)))) return false;
        }
      }
      const p = project(target);
      need(p.link?.repoId && p.id && p.name, 'project GitHub repoId required for repeat');
      await intent('retry', 'repeat', run.merge, async recorded => {
        try {
          if (!rollback(target)) {
            const current = domain(target);
            if (ready(current) && follows(run.merge, commit(current))) return { state: 'occurred', value: { id: current.id, at: recorded.at } };
          }
          const d = deploymentFor(target);
          // Project latestDeployments is a summary, not an authoritative negative
          // receipt. An interrupted POST with no visible build stays unknown.
          if (!d || stamp(d.createdAt) < recorded.at) return { state: 'unknown' };
          if (['INITIALIZING', 'BUILDING', 'QUEUED'].includes(d.readyState)) return { state: 'unknown' };
          return { state: 'occurred', value: { id: d.id, at: recorded.at } };
        } catch { return { state: 'unknown' }; }
      }, async () => {
        const body = { name: p.name, project: p.id, target: 'production', gitSource: { type: 'github', repoId: p.link.repoId, ref: 'main', sha: run.merge } };
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-deploy-'));
        try {
          const file = path.join(temporary, 'body.json'); fs.writeFileSync(file, JSON.stringify(body));
          vercel(['api', '/v13/deployments', '--scope', target.recipe.team, '-X', 'POST', '--input', file]);
        } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
      }, deadline);
      return true;
    };
    const webAction = async (action, destination, key = action) => {
      const result = await intent(key, action, destination.id, async () => {
        // T1 exposes no authoritative negative action receipt. A different
        // domain target stays unknown; it cannot authorize replaying a write.
        try { const d = domain(target); return ready(d) && d.id === destination.id ? { state: 'occurred', value: d } : { state: 'unknown' }; }
        catch { return { state: 'unknown' }; }
      }, async () => vercel([action === 'promote' ? 'promote' : 'rollback', destination.id, '--yes', '--scope', target.recipe.team, '--timeout', '120s']), now() + 600_000);
      target.proof = result; persist(); return result;
    };
    if (command === 'prove') {
      need(target.recipe.kind === 'vercel', 'prove requires vercel');
      const rb = rollback(target), repair = rb?.fix?.head === run.head;
      const initialDeadline = run.mergedAt + 600_000;
      const pendingRepeat = run.intents[`${target.key}:retry`];
      if (pendingRepeat && !pendingRepeat.result) {
        try { await retry(pendingRepeat.at + 600_000); }
        catch (error) { return stopped(error.message, target); }
      }
      while (true) {
        let d;
        try { d = repair ? deploymentFor(target) : domain(target); }
        catch (error) { target.unread = error.message; persist(); return { state: 'unverified', outcome: 'выкатили, не проверено', versionProven: false }; }
        if (ready(d) && follows(run.merge, commit(d))) {
          delete target.unread; delete target.failed; target.proof = d;
          if (run.stop?.target === target.key && !run.stop.browser) delete run.stop;
          if (repair) { rb.deployment = d; save(rollbackFile(target), rb); }
          persist();
          if (!repair) quick(target, url(target.recipe.domain));
          return { state: repair ? 'repair-ready' : 'proven', id: d.id, url: url(d.url) };
        }
        const repeated = run.intents[`${target.key}:retry`];
        const deadline = repeated ? repeated.at + 600_000 : initialDeadline;
        const build = repair ? d : deploymentFor(target);
        if (!repeated && (!build || ['ERROR', 'CANCELED'].includes(build.readyState) || now() >= deadline)) {
          try { if (await retry(now() + 600_000)) continue; }
          catch (error) { return stopped(error.message, target); }
        }
        if (now() >= deadline) {
          if (repair) return stopped('repair deployment is not READY; production stays on rollback', target);
          if (repeated && d && ready(d) && !follows(run.merge, commit(d))) {
            target.failed = true; target.failureProof = d; followup(target, 'deployment failed; production remains on previous version'); persist();
            return { state: 'failed', outcome: 'выкатка упала, прод на старой версии' };
          }
          return stopped('deployment not confirmed before deadline', target);
        }
        await sleep(Math.min(20_000, deadline - now()));
      }
    }
    if (command === 'check') {
      need(['quick', 'scenario'].includes(request.kind) && ['green', 'red', 'unavailable'].includes(request.result) && [1, 2].includes(request.attempt), 'check kind/result/attempt invalid');
      const surface = request.surface, available = request.browserAvailable === true || request.blockedBy === 'auth';
      need(['domain', 'browser', 'local', 'none'].includes(surface), 'check surface required');
      need(['local', 'none'].includes(surface) ? target.recipe.kind === surface : target.recipe.kind === 'vercel', 'check surface mismatches target');
      const rb = rollback(target), allowed = [target.proof, target.baseline, rb?.deployment, rb?.rollback, surface === 'none' && { id: run.merge }].filter(Boolean);
      const d = allowed.find(d => d.id === request.id);
      need(d, 'check deployment/process id not in run');
      need(request.blockedBy === undefined || (request.blockedBy === 'auth' && surface === 'browser' && request.result === 'unavailable'), 'blockedBy auth marks only an unavailable own-URL browser check');
      if (surface === 'none') need(typeof request.observed === 'string' && request.observed.trim() && (request.release === undefined || /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(request.release)), 'none scenario needs observed version; release must be a version');
      need(request.kind === 'scenario' || surface === 'browser', 'only browser quick checks are model observations');
      if (rb?.phase === 'awaiting-prod' && surface === 'domain') need(request.attempt === 1, 'production return check has no repeat');
      if (surface === 'domain') need(domain(target).id === request.id && url(request.url) === url(target.recipe.domain), 'domain/id mismatch');
      if (surface === 'browser') need(url(request.url) === url(d.url), 'own deployment URL mismatch');
      if (request.result === 'unavailable') need(request.reason && request.who, 'unavailable check needs reason and who');
      need(!currentChecks(target).some(check => check.id === request.id && check.kind === request.kind && check.surface === surface && check.attempt === request.attempt && check.result !== 'unavailable'), 'check attempt already recorded');
      target.checks.push({ id: request.id, url: request.url, kind: request.kind, result: request.result, reason: request.reason, who: request.who, browserAvailable: available || undefined, blockedBy: request.blockedBy, observed: request.observed, release: request.release, attempt: request.attempt, surface, at: now() });
      if ((request.result !== 'unavailable' || available) && run.stop?.browser && !browserMissing(target)) delete run.stop;
      persist();
      if (surface === 'browser' && request.result === 'unavailable' && !available) return stopped(request.reason, target, true);
      return { state: 'recorded' };
    }
    if (command === 'rollback') {
      need(target.recipe.kind === 'vercel' && target.proof && target.baseline, 'proven vercel deployment required');
      if (browserMissing(target)) return stopped('browser with Vercel login unavailable', target, true);
      const id = (target.rollbackFrom ?? target.proof).id;
      const failing = ['quick', 'scenario'].filter(kind => (kind === 'scenario' || latest(target, id, 'domain', kind)?.result === 'red') && [1, 2].every(attempt => target.checks.some(check => check.id === id && check.surface === 'browser' && check.kind === kind && check.attempt === attempt && check.result === 'red')) && latest(target, target.baseline.id, 'browser', kind)?.result === 'green');
      need(failing.length, 'rollback requires browser red twice on new and green on recorded rollback target');
      try {
        const before = target.rollbackFrom ?? target.proof;
        if (!run.intents[`${target.key}:rollback`]) {
          const current = domain(target);
          need(ready(current) && current.id === before.id, 'production version changed; refuse rollback');
        }
        target.rollbackFrom = before; persist(); await webAction('rollback', target.baseline);
        health(target); await flagMatches(target, false);
        save(rollbackFile(target), { head: run.head, issue: request.repairIssue ?? null, rollback: target.baseline, before, phase: 'rolled-back', fix: null });
        followup(target, 'production rolled back; create repair Issue with Прод на откате label');
        target.rolledBack = true; delete run.stop; persist(); return { state: 'rolled-back', outcome: 'откатили' };
      } catch (error) { return stopped(error.message, target); }
    }
    if (command === 'return') {
      const rb = rollback(target);
      need(target.recipe.kind === 'vercel' && rb?.fix?.head === run.head && rb.fix.issue === run.issue, 'recorded repair required');
      if (rb.phase === 'return-canceled') return stopped('repair return canceled; production stays on rollback until morning', target);
      if (browserMissing(target)) return stopped('browser with Vercel login unavailable', target, true);
      need(rb.deployment && green(target, rb.deployment.id, 'browser'), 'repair own URL scenario and quick checks must be green');
      if (rb.phase !== 'awaiting-prod') {
        try {
          if (!run.intents[`${target.key}:promote`]) {
            const current = domain(target);
            need(ready(current) && current.id === rb.rollback.id, 'production version changed; refuse promote');
          }
          rb.prodChecksFrom ??= target.checks.length; save(rollbackFile(target), rb);
          await webAction('promote', rb.deployment); await flagMatches(target, true);
        }
        catch (error) { return stopped(error.message, target); }
        rb.phase = 'awaiting-prod'; save(rollbackFile(target), rb); quick(target, url(target.recipe.domain));
        return { state: 'awaiting-prod-check', outcome: null };
      }
      const productionChecks = target.checks.slice(rb.prodChecksFrom).filter(check => check.id === rb.deployment.id && check.surface === 'domain');
      if (!run.intents[`${target.key}:cancel-return`] && !productionChecks.some(check => check.kind === 'quick')) {
        const current = domain(target);
        need(ready(current) && current.id === rb.deployment.id, 'repair is not on production domain');
        productionChecks.push(quick(target, url(target.recipe.domain)));
      }
      if (run.intents[`${target.key}:cancel-return`] || productionChecks.some(check => check.result === 'red')) {
        try {
          if (!run.intents[`${target.key}:cancel-return`]) {
            const current = domain(target);
            need(ready(current) && current.id === rb.deployment.id, 'production version changed; refuse cancel-return');
          }
          await webAction('rollback', rb.rollback, 'cancel-return'); health(target); await flagMatches(target, false);
        }
        catch (error) { return stopped(error.message, target); }
        rb.phase = 'return-canceled'; save(rollbackFile(target), rb);
        return stopped('repair return canceled; production stays on rollback until morning', target);
      }
      need(domain(target).id === rb.deployment.id, 'repair is not on production domain');
      need(['quick', 'scenario'].every(kind => productionChecks.filter(check => check.kind === kind).at(-1)?.result === 'green'), 'return awaits production scenario and quick checks');
      archive(target); target.returned = true;
      if (run.stop?.target === target.key) delete run.stop;
      persist(); return { state: 'returned', outcome: 'выкатили и проверили' };
    }
    if (command === 'local') {
      need(target.recipe.kind === 'local', 'local target required');
      const current = () => { const s = JSON.parse(cli('sh', ['-c', `${target.recipe.command} status`], { cwd: request.worktree })); need(SHA.test(s.copyCommit) && SHA.test(s.processCommit) && Number.isFinite(stamp(s.startedAt)), 'local status invalid'); return s; };
      const proveProcess = s => {
        const previous = target.proof;
        const same = previous?.copyCommit === s.copyCommit && previous.id === s.processCommit && stamp(previous.startedAt) === stamp(s.startedAt);
        target.proof = { ...s, id: s.processCommit, checksFrom: same ? previous.checksFrom ?? 0 : target.checks.length }; persist();
      };
      const rb = rollback(target), desired = run.merge;
      if (!target.baseline) { target.baseline = current(); target.baseline.id = target.baseline.processCommit; persist(); }
      const action = async (verb, sha, key, previous) => {
        await intent(key, verb, sha, async recorded => {
          try {
            const s = current();
            const matches = verb === 'install' ? follows(sha, s.copyCommit) && follows(sha, s.processCommit) : s.copyCommit === sha && s.processCommit === sha;
            if (matches && stamp(s.startedAt) >= recorded.at && !s.installing && !s.restoring) return { state: 'occurred', value: s };
            if (s.copyCommit === previous.copyCommit && s.processCommit === previous.processCommit && !s.installing && !s.restoring) return { state: 'not-executed' };
          } catch {}
          return { state: 'unknown' };
        }, async () => cli('sh', ['-c', `${target.recipe.command} ${verb} "$1"`, 'deploy-local', sha], { cwd: request.worktree }), now() + 600_000);
      };
      const restore = async before => {
        const destination = rb?.rollback ?? target.baseline;
        if (!run.intents[`${target.key}:restore`]) { const s = current(); need(s.copyCommit === before.copyCommit && s.processCommit === before.processCommit, 'локальная версия изменилась; откат не делаю'); }
        target.restoreFrom = before; persist();
        await action('restore', destination.processCommit, 'restore', before);
        proveProcess(current()); health(target);
        if (!rb) save(rollbackFile(target), { head: run.head, issue: request.repairIssue ?? null, rollback: destination, before, fix: null, phase: 'rolled-back' });
        target.rolledBack = true; delete run.stop; persist();
        return rb ? stopped('local repair failed; restored rollback version until morning', target) : { state: 'rolled-back', outcome: 'откатили' };
      };
      try {
        if (run.intents[`${target.key}:restore`]) return await restore(target.restoreFrom ?? target.proof);
        await action('install', desired, 'install', target.baseline);
        const s = current(); need(follows(desired, s.copyCommit) && follows(desired, s.processCommit), 'local process version not proven');
        proveProcess(s);
        const first = quick(target, '');
        if (first.result === 'green' || quick(target, '').result === 'green') {
          const scenario = latest(target, target.proof.id, 'local', 'scenario');
          if (scenario?.result === 'red') {
            const twice = [1, 2].every(attempt => currentChecks(target).some(c => c.id === target.proof.id && c.surface === 'local' && c.kind === 'scenario' && c.result === 'red' && c.attempt === attempt));
            return twice ? await restore(s) : { state: 'awaiting-local-scenario-repeat', outcome: null };
          }
          if (rb && scenario?.result !== 'green') return { state: 'awaiting-local-scenario', outcome: null };
          if (rb) archive(target); target.returned = !!rb;
          if (run.stop?.target === target.key) delete run.stop;
          persist(); return { state: 'proven' };
        }
        return await restore(s);
      } catch (error) { return stopped(error.message, target); }
    }
    if (command === 'outcome') {
      if (run.stop) return stopped(run.stop.reason, run.targets.find(t => t.key === run.stop.target), run.stop.browser);
      const order = ['откатили', 'выкатка упала, прод на старой версии', 'выкатили, не проверено', 'влито, ждёт выпуска', 'выкатили и проверили'];
      const rows = [];
      for (const t of run.targets) {
        let outcome, reason, note;
        const activeRollback = rollback(t);
        if (activeRollback?.fix?.head === run.head && !t.returned) return stopped('repair awaits verified return', t);
        const expectedWeb = t.failed ? t.failureProof ?? t.baseline : t.proof;
        if (expectedWeb && t.recipe.kind === 'vercel') {
          let current;
          try { current = domain(t); delete t.unread; } catch (error) { t.unread = error.message; }
          if (current) need(ready(current) && current.id === expectedWeb.id, 'current production version changed; rerun prove');
          persist();
        }
        if (t.proof && t.recipe.kind === 'local') {
          const current = JSON.parse(cli('sh', ['-c', `${t.recipe.command} status`], { cwd: request.worktree }));
          need(current.copyCommit === t.proof.copyCommit && current.processCommit === t.proof.id && stamp(current.startedAt) === stamp(t.proof.startedAt) && !current.installing && !current.restoring, 'current local version changed; rerun local');
        }
        if (t.unread) { outcome = order[2]; reason = `На проде подтвердить не смог: ${t.unread}`; }
        else if (t.rolledBack) outcome = order[0];
        else if (t.failed) outcome = order[1];
        else if (t.recipe.kind === 'pack') {
          const installed = request.packResult;
          if (installed && ['waiting', 'stopped'].includes(installed.outcome)) return { state: installed.outcome, outcome: null, open: true, detail: installed };
          need(!installed || ['installed', 'rolled-back'].includes(installed.outcome), 'invalid pack install result');
          outcome = !installed ? order[3] : installed.outcome === 'installed' ? order[4] : order[0];
          if (installed?.outcome === 'installed') {
            const version = installed.places?.[0]?.expected;
            need(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version ?? '') && installed.places.every(place => place.verified && place.expected === version && place.actual === version), 'release places must verify one installed version');
            const sha = gh(`repos/${run.repo}/commits/v${version}`).sha;
            need(follows(run.merge, sha), 'installed release does not contain this merge');
            t.proof = { id: sha, places: installed.places }; persist();
          } else if (installed) { t.proof = { id: installed.places?.map(place => place.actual).join(','), places: installed.places }; persist(); }
        } else if (t.recipe.kind === 'none') { // Verified only when the observed version is the merge or its tagged release.
          const s = latest(t, run.merge, 'none', 'scenario'), green = s?.result === 'green';
          let tagged = false;
          if (green && s.release && s.observed === s.release) try { tagged = follows(run.merge, gh(`repos/${run.repo}/commits/v${s.release.replace(/^v/, '')}`).sha); } catch { /* No tag: stays unverified. */ }
          if (green && (s.observed === run.merge || tagged)) { outcome = order[4]; t.proof = { id: run.merge, observed: s.observed, release: s.release }; persist(); }
          else { outcome = order[2]; reason = [t.recipe.reason, s && (green ? `наблюдённая версия ${s.observed} не совпала с влитой` : `сценарий ${s.result === 'red' ? 'красный' : 'недоступен'}: ${s.reason ?? ''}`)].filter(Boolean).join('; '); }
        }
        else {
          need(t.proof, 'version not proven');
          if (browserMissing(t)) return stopped('browser with Vercel login unavailable', t, true);
          const surface = t.recipe.kind === 'local' ? 'local' : 'domain';
          // Own build URL behind a login: green production quick and scenario on the proven version verify it.
          const own = ['quick', 'scenario'].map(kind => latest(t, t.proof.id, 'browser', kind)).filter(Boolean), prod = ['quick', 'scenario'].map(kind => latest(t, t.proof.id, 'domain', kind));
          const walled = t.recipe.kind === 'vercel' && own.some(check => check.blockedBy === 'auth') && own.every(check => check.result === 'green' || check.blockedBy === 'auth');
          if (walled && prod.some(check => check?.result === 'red')) return stopped('проверка по домену красная, а адрес сборки закрыт входом: сравнить нельзя', t);
          if (walled && prod.every(check => check?.result === 'green')) { outcome = order[4]; note = 'проверено на проде: адрес сборки закрыт входом'; }
          else {
            if (t.recipe.kind === 'vercel') need(latest(t, t.proof.id, 'browser', 'quick') && latest(t, t.proof.id, 'browser', 'scenario'), 'own URL browser quick and scenario results required');
            const scenario = latest(t, t.proof.id, t.recipe.kind === 'vercel' ? 'browser' : surface, 'scenario');
            need(scenario, 'task scenario result or explicit unavailable reason/checker must be recorded');
            const checkFor = kind => kind === 'scenario' ? scenario : latest(t, t.proof.id, surface, 'quick');
            const reds = ['quick', 'scenario'].filter(kind => checkFor(kind)?.result === 'red' || latest(t, t.proof.id, surface, kind)?.result === 'red' || (t.recipe.kind === 'vercel' && latest(t, t.proof.id, 'browser', kind)?.result === 'red'));
            const unavailable = [...new Set(['quick', 'scenario'].flatMap(kind => [checkFor(kind), latest(t, t.proof.id, surface, kind), latest(t, t.proof.id, 'browser', kind)]))].filter(check => check?.result === 'unavailable');
            const discrepancy = reds.length && reds.every(kind => latest(t, t.proof.id, 'browser', kind)?.result === 'green');
            const known = reds.length && reds.every(kind => latest(t, t.baseline.id, 'browser', kind)?.result === 'red');
            if (discrepancy) { // S19 is the explicit U5 exception; preserve the red domain result.
              outcome = order[2]; reason = 'проверка по домену красная, по адресу сборки зелёная'; followup(t, reason, 'discrepancy');
            } else if (known) {
              const otherKinds = ['quick', 'scenario'].filter(kind => !reds.includes(kind));
              const remaining = otherKinds.flatMap(kind => kind === 'quick' && t.recipe.kind === 'vercel' ? [checkFor(kind), latest(t, t.proof.id, 'browser', kind)] : [checkFor(kind)]);
              need(remaining.every(Boolean), 'remaining scenario/check must be recorded');
              outcome = remaining.every(check => check.result === 'green') && !unavailable.length ? order[4] : order[2];
              reason = 'известная поломка на прошлой сборке'; followup(t, reason);
            }
            else {
              need(!reds.length, 'red check unresolved; compare in browser before outcome');
              const checked = scenario.result === 'green' && checkFor('quick')?.result === 'green' && (scenario.surface !== 'browser' || latest(t, t.proof.id, 'browser', 'quick')?.result === 'green');
              need(checked || unavailable.length, 'scenario result or unavailable reason/checker must be recorded');
              outcome = checked && !unavailable.length ? order[4] : order[2];
            }
            if (unavailable.length) reason = [...new Set([reason, ...unavailable.map(check => `${check.reason}; проверит ${check.who}`)])].filter(Boolean).join('; ');
          }
        }
        rows.push({ target: t.index, outcome, reason, note, versionProven: !!t.proof && !t.unread && !t.failed, proof: (t.failed ? expectedWeb : t.proof)?.id });
      }
      rows.sort((a, b) => order.indexOf(a.outcome) - order.indexOf(b.outcome));
      const bare = !run.config && { reason: 'у продукта нет настроек выкатки (блок `deploy`)', noDeployBlock: true };
      const result = { outcome: rows[0]?.outcome ?? (bare ? order[2] : null), ...bare, targets: rows, followups: run.followups ?? [], noTargets: !rows.length && !bare, projectUpdateAllowed: rows.length > 0 && rows.every(row => row.versionProven && ['выкатили и проверили', 'выкатили, не проверено'].includes(row.outcome)) };
      run.closedAt = now(); run.outcome = result; persist();
      return { state: 'closed', ...result };
    }
  });
  // Merge waits ≤8 min for the main check outside deploy.lock; a pause plus a bounded guard read (≤40 s) must fit.
  let landing = command === 'merge' ? result.landing : null, waited = false;
  while (landing?.code === 2 && now() + 70_000 <= started + 480_000) {
    await sleep(30_000); waited = true; landing = await landingCheck({ root: request.root, repo: request.repo, sha: result.merge, config: request.config });
  }
  if (waited) landing = await withLock(lock, () => { // Only the result write retakes the lock; a newer persisted result wins.
    const run = readJson(runFile), logged = phase(run);
    need(run.merge === result.merge && !run.closedAt, 'run changed while waiting for main check');
    if (canonical(run.landing) === canonical(result.landing)) { run.landing = landing; write(run, logged); } return run.landing;
  });
  const state = waited ? { ...result, state: landing.code ? 'waiting-validation' : 'merged', landing } : result;
  return landing?.code === 2 ? { ...state, reason: 'проверка main ещё идёт, повтори merge' } : state;
}

if (isMain(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2), args = flags(rest);
  if (command === '--help' || !command) console.log('deploy.mjs merge|prove|local|check|rollback|return|outcome --request FILE (see skills/deploy/references/)');
  else runDeploy(command, readJson(args.request)).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
