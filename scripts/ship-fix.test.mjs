// A timely bot remark that needs code is fixed inside the same worker session (skills/ship step 8):
// fix, round per path, reply/resolve, next ship-gate attempt. No undo, park, task change or orchestrator turn.
// Drives the real preflight and ship gates through their CLI; GitHub is a fake `gh` reading gh-state.json.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { atomicJson } from './runtime.mjs';
import { sha256File } from './orchestrator/command-state.mjs';
import { admitRound, recordResult, readLedger, inFlight } from './review-rounds.mjs';
import { installReviewClis, setReview, reviewCalls, reviewVerdict } from './test-fixtures/review-clis.mjs';

const fakeGh = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const a=process.argv.slice(2),s=JSON.parse(fs.readFileSync(path.join(__dirname,'gh-state.json'),'utf8'));
const page=nodes=>({nodes,pageInfo:{hasNextPage:false,endCursor:null}});
const value=name=>{const item=a.find(arg=>arg.startsWith(name+'='));return item&&item.slice(name.length+1);};
let out;
if(a[1]==='graphql'){
  const q=value('query');
  if(q.includes('statusCheckRollup'))out={data:{repository:{object:{committedDate:s.committedDate,statusCheckRollup:{contexts:page(s.checks[value('head')]??[])}}}}};
  else if(q.includes('reviewThreads'))out={data:{repository:{pullRequest:{reviewThreads:page(s.threads.map(({id,isResolved})=>({id,isResolved,isOutdated:false})))}}}};
  else if(q.includes('node(id:'))out={data:{node:{comments:page(s.threads.find(t=>t.id===value('id')).comments)}}};
  else out={data:{repository:{pullRequest:{headRefOid:s.head,createdAt:s.createdAt,state:'OPEN',mergeStateStatus:'CLEAN',mergeable:'MERGEABLE',baseRefName:'review-base',baseRefOid:s.base,baseRef:null}}}};
} else if(a[1]==='user')out={login:s.viewer};
else if(a.some(arg=>arg.includes('/rules/branches/')))out=[];
else if(a.some(arg=>arg.endsWith('/commits')))out=[[]];
else if(a.some(arg=>arg.endsWith('/reviews')))out=[s.reviews];
else if(a.some(arg=>arg.endsWith('/comments')))out=[[]];
else {console.error('unexpected gh call '+a.join(' '));process.exit(9);}
console.log(JSON.stringify(out));
`;

for (const risk of ['standard', 'risky']) test(`bot P2 with a code fix reaches green in the same attempt without a park (${risk})`, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-ship-fix-'));
  try {
    const repo = path.join(scratch, 'repo'), root = path.join(scratch, 'orchestrator'), evidence = path.join(scratch, 'evidence'),
      skills = path.join(scratch, 'skills'), bin = path.join(scratch, 'bin');
    for (const dir of [repo, root, evidence, skills, bin]) fs.mkdirSync(dir);
    const env = { ...process.env, HOME: path.join(scratch, 'home'), PATH: `${bin}:${process.env.PATH}` };
    const git = (...args) => { const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    const author = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];
    fs.writeFileSync(path.join(repo, '.gitignore'), '.orchestrator/\n');
    git('init', '-q', '-b', 'delivery'); git('add', '.gitignore'); git(...author, 'commit', '-q', '-m', 'fixture');
    git('branch', 'review-base');
    const base = git('rev-parse', 'HEAD');
    const commit = text => { fs.appendFileSync(path.join(repo, 'input.mjs'), text); git('add', 'input.mjs'); git(...author, 'commit', '-q', '-m', text.trim()); return git('rev-parse', 'HEAD'); };
    fs.mkdirSync(path.join(skills, 'references'));
    fs.copyFileSync('references/model-policy.md', path.join(skills, 'references/model-policy.md'));
    installReviewClis(bin);
    fs.writeFileSync(path.join(bin, 'gh'), fakeGh, { mode: 0o700 });

    const issue = 'MONO-999', pinsFile = path.join(root, `dispatch/${issue}-a1/pins.json`);
    fs.mkdirSync(path.join(path.dirname(pinsFile), 'snapshot'), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(pinsFile), `snapshot/issue-${issue}.md`), `# ${issue}\n\nFixture task contract.\n`);
    const pins = { product: 'fixture', root, worktree: repo, skillsRoot: skills, baseRef: 'review-base', evidenceRoot: evidence,
      risk, critical: null, verification: { command: process.execPath, args: ['-e', 'process.exit(0)'] }, workerWritableRoots: [repo] };
    atomicJson(pinsFile, pins);
    const binding = { file: pinsFile, digest: sha256File(pinsFile) };
    atomicJson(path.join(root, 'workers.json'), { [issue]: { issue, attempt: 1, stage: 'mono-deliver', worktree: repo,
      packVersion: 'fixture', sourceCommit: 'b'.repeat(40), surfaceRevision: 4, pins: binding, pinsVersion: 0 } });

    const requestFile = path.join(scratch, 'request.json');
    const gate = (name, value) => { atomicJson(requestFile, value); return spawnSync(process.execPath, ['scripts/gate.mjs', name, '--request', requestFile], { env, encoding: 'utf8' }); };
    const at = (tip, extra = {}) => ({ ...pins, head: tip, collect: false, collectionId: `preflight-collect:${tip}:1`, pins: binding, workerVerification: { head: tip, exitCode: 0 }, ...extra });
    // The collector: admit the worker's round request, run the collection, record the result.
    const round = (value, line) => {
      for (const { admission } of inFlight(readLedger(root, issue, 1))) recordResult(root, issue, 1, admission, { status: 'done' });
      admitRound(root, issue, 1, value);
      for (const result of [gate('preflight', { ...value, collect: true }), gate('preflight', value)]) {
        assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, line);
      }
      return JSON.parse(fs.readFileSync(path.join(evidence, `${value.head}.json`), 'utf8')).receipt;
    };
    const limit = risk === 'risky' ? 3 : 1;

    // Round 1 is clean; the PR leaves draft.
    setReview(bin, { findings: [], verdict: reviewVerdict({ outcome: 'rejected', closed: true }) });
    const first = commit('export const one = 1;\n');
    round(at(first), new RegExp(`pass: review clean \\(round 1 of ${limit}\\)`));
    const reviewersAfterRound1 = reviewCalls(bin).length;

    // Greptile answers on time with a valid P2 that needs code.
    const now = () => new Date().toISOString();
    const greptile = { login: 'greptile-apps[bot]', type: 'Bot' };
    const summary = { id: 1, node_id: 'PRR_summary', state: 'COMMENTED', user: greptile, body: 'Greptile summary: 1 comment', commit_id: first, submitted_at: now() };
    const p2 = { id: 'PRRC_p2', body: '**P2** Leftover personal identifier in input.mjs', publishedAt: now(), author: { login: 'greptile-apps[bot]' }, pullRequestReview: { state: 'COMMENTED' } };
    const green = (tip, extra = []) => [{ __typename: 'CheckRun', name: 'validate', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: now(), completedAt: now(),
      checkSuite: { commit: { oid: tip }, app: { slug: 'github-actions' } } }, ...extra];
    const state = { head: first, base, createdAt: now(), committedDate: now(), viewer: 'worker', reviews: [summary],
      checks: { [first]: green(first, [{ __typename: 'CheckRun', name: 'Greptile Review', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: now(), completedAt: now(),
        checkSuite: { commit: { oid: first }, app: { slug: 'greptile-apps' } } }]) },
      threads: [{ id: 'PRRT_p2', isResolved: false, comments: [p2] }] };
    atomicJson(path.join(bin, 'gh-state.json'), state);
    const config = path.join(scratch, 'config.json');
    atomicJson(config, { orchestration: { delivery: { quietSec: 0.001, pollSec: 0.005 } } });
    const judgmentFile = path.join(scratch, 'judgment.json');
    const disposition = { id: summary.node_id, commentDigest: null, outcome: 'informational', evidence: 'review summary; its one remark is the P2 thread' };
    const { botRemarkDigest } = await import('./gate.mjs');
    disposition.commentDigest = botRemarkDigest({ body: summary.body, updatedAt: summary.submitted_at });
    const ship = (attempt, preflight, watch) => gate('ship', { preflight, repo: 'fixture/repo', number: 1, attempt, config, watch,
      stateFile: path.join(scratch, `ship-${attempt}.json`), judgmentFile });
    atomicJson(judgmentFile, { head: first, preShipReview: 'выполнено', readinessCheck: 'пройдена', documentation: 'без изменений', closures: [], botRemarks: [disposition] });
    const blocked = ship(1, at(first), false);
    assert.equal(blocked.status, 1); assert.match(blocked.stdout, /gate ship: fail: unresolved thread PRRT_p2/, blocked.stdout + blocked.stderr);
    const botFile = path.join(root, 'reports', `${issue}-a1-ship-bot.json`);
    assert.equal(JSON.parse(fs.readFileSync(botFile, 'utf8')).outcome, 'ответил', 'the bot answered within its window');
    const attempt1 = fs.readFileSync(path.join(scratch, 'ship-1.json'));

    // Ship fix in the same session: fix, verify, push, one round per path with the remark in prRemarks.
    const fixed = commit('export const fixed = 1;\n');
    const prRemarks = [{ id: 'PRRT_p2', source: 'bot', file: 'input.mjs', line: 1, title: 'P2 Leftover personal identifier in input.mjs',
      body: p2.body, urgent: false, head: first }];
    const fixRequest = at(fixed, { prRemarks });
    const receipt = round(fixRequest, risk === 'risky'
      ? /pass: review clean \(round 2 of 3\) and verification verified on head/
      : /pass: review clean \(round 1 of 1\), fixes after it confirmed by the worker's full verification/);
    assert.deepEqual(receipt.prRemarks, prRemarks);
    if (risk === 'risky') assert.ok(reviewCalls(bin).length > reviewersAfterRound1, 'the strict path spends its next round on the fix');
    else {
      assert.equal(reviewCalls(bin).length, reviewersAfterRound1, 'the fast path confirms the fix without a second round');
      assert.equal(receipt.review.spent, false);
    }

    // Reply in the thread with the Ship marker, resolve; the bot check on the new head may still run: no new bot wait.
    const reply = { id: 'PRRC_reply', body: '<!-- mono:ship -->\nFixed in the next commit.', publishedAt: now(), author: { login: 'worker' }, pullRequestReview: { state: 'COMMENTED' } };
    Object.assign(state, { head: fixed, committedDate: now(), threads: [{ id: 'PRRT_p2', isResolved: true, comments: [p2, reply] }] });
    state.checks[fixed] = green(fixed, [{ __typename: 'CheckRun', name: 'Greptile Review', status: 'IN_PROGRESS', conclusion: null, startedAt: now(), completedAt: null,
      checkSuite: { commit: { oid: fixed }, app: { slug: 'greptile-apps' } } }]);
    atomicJson(path.join(bin, 'gh-state.json'), state);
    atomicJson(judgmentFile, { head: fixed, preShipReview: 'выполнено', readinessCheck: 'пройдена', documentation: 'без изменений',
      closures: [{ threadId: 'PRRT_p2', replyId: reply.id }], botRemarks: [disposition] });
    // The collector closed every admitted round: landing finds no round in flight.
    for (const { admission } of inFlight(readLedger(root, issue, 1))) recordResult(root, issue, 1, admission, { status: 'done' });
    assert.deepEqual(inFlight(readLedger(root, issue, 1)), []);
    assert.equal(readLedger(root, issue, 1).length, 2, 'two admitted rounds: the first and the ship fix');
    const shipped = ship(2, fixRequest, true);
    assert.equal(shipped.status, 0, shipped.stdout + shipped.stderr);
    assert.match(shipped.stdout, /gate ship: pass: current-head evidence complete and quiet period passed; Бот: ответил/);

    // Same task attempt, no task change, the earlier gate state kept.
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'workers.json'), 'utf8'))[issue].attempt, 1);
    assert.equal(fs.existsSync(path.join(path.dirname(pinsFile), 'task-changes.json')), false);
    assert.deepEqual(fs.readFileSync(path.join(scratch, 'ship-1.json')), attempt1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(scratch, 'ship-2.json'), 'utf8')).head, fixed);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
