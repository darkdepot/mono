import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound, runRemarkCheck } from './code-review.mjs';

// Expired Claude login during review roles. The login check and refresh are injected;
// the real keychain and CLI are never touched (defaults are off under node --test).
const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const transcripts = JSON.parse(fs.readFileSync(path.join(packRoot, 'evals/code-review/recorded-responses.json'), 'utf8'));
const review = () => ({ ...transcripts.clean, findings: [], reviewedFiles: ['input.mjs'] });
function fixture(t) {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-login-review-')); t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
  fs.writeFileSync(path.join(worktree, 'input.mjs'), 'export function value(n) { return 0; }\n'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(worktree, 'input.mjs'), 'export function value(n) { return n; }\n'); git('add', '.'); git('commit', '-qm', 'head'); const head = git('rev-parse', 'HEAD');
  return { worktree, request: { worktree, head, base, contract: 'Return only nonnegative numbers. Manual review; no Linear writes.', packRoot } };
}
const loginError = () => Object.assign(new Error('вход Claude истёк или не найден: role failed (1); no response admitted'), { loginFailure: true });

test('login failure in a round: one login refresh, one relaunch; a passing relaunch keeps the round out of not-reviewed', async t => {
  const f = fixture(t), refreshes = [];
  let launches = 0;
  const record = await runReviewRound(f.request, {
    runRole: async () => { if (++launches === 1) throw loginError(); return { response: review(), elapsedMs: 1, usage: null }; },
    ensureLogin: async options => { refreshes.push(options); return { status: 'refreshed' }; } });
  assert.equal(record.outcome, 'clean', 'the not-reviewed streak only counts not-reviewed outcomes, so this round does not add to it');
  assert.equal(launches, 2); assert.deepEqual(refreshes, [{ force: true }]);
  assert.match(record.failures[0].reason, /^вход Claude истёк или не найден: role failed \(1\).*login refresh: refreshed/);

  const failing = []; let calls = 0;
  const down = await runReviewRound(f.request, { runRole: async () => { calls++; throw loginError(); },
    ensureLogin: async options => { failing.push(options); return { status: 'failed', reason: 'refresh run exit 1; login still expired' }; } });
  assert.equal(down.outcome, 'not-reviewed'); assert.equal(calls, 2, 'no third launch'); assert.equal(failing.length, 1, 'one refresh only');
  assert.match(down.failures.at(-1).reason, /^вход Claude истёк или не найден/);
  assert.match(down.failures[0].reason, /login refresh: failed \(refresh run exit 1; login still expired\)/);

  const other = [];
  await runReviewRound(f.request, { runRole: async () => { throw new Error('role failed (1); no response admitted'); },
    ensureLogin: async options => { other.push(options); return { status: 'fresh' }; } });
  assert.equal(other.length, 0, 'other failures start no login refresh');
});

test('remark check run by a Claude role: a login failure is named, refreshed once and relaunched once', async t => {
  const f = fixture(t), bin = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-login-role-')); t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  const remarks = [{ id: 'B1', source: 'bot', title: 'Summary', body: 'Greptile summary', urgent: false, head: f.request.head, decision: 'informational', evidence: 'No change requested.' }];
  const counter = path.join(bin, 'launches'), mode = path.join(bin, 'mode');
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const fs=require('node:fs');
if(process.argv.includes('auth')){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}));process.exit(0);}
let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
 const n=(fs.existsSync(${JSON.stringify(counter)})?Number(fs.readFileSync(${JSON.stringify(counter)},'utf8')):0)+1;fs.writeFileSync(${JSON.stringify(counter)},String(n));
 const emit=o=>console.log(JSON.stringify(o));emit({type:'system',subtype:'init',tools:['Read','Glob','Grep','StructuredOutput'],mcp_servers:[]});
 const how=fs.readFileSync(${JSON.stringify(mode)},'utf8');
 if(how==='answer-mentions-401'){emit({type:'assistant',message:{content:[{type:'text',text:'This code returns 401 when the OAuth token has expired.'}]}});process.exit(1);}
 if(how==='always-expired'||n===1){emit({type:'assistant',error:'authentication_failed',message:{content:[{type:'text',text:'Failed to authenticate. API Error: 401 OAuth token has expired'}]}});emit({type:'result',subtype:'success',is_error:true,result:'Failed to authenticate. API Error: 401'});process.exit(1);}
 emit({type:'result',subtype:'success',is_error:false,structured_output:{completed:true,verdicts:[{id:'B1',verdict:'confirmed',reason:'summary only'}]}});
});
`, { mode: 0o700 });
  const prior = process.env.PATH; process.env.PATH = bin + path.delimiter + prior;
  const input = { worktree: f.worktree, head: f.request.head, base: f.request.base, remarks, packRoot };
  try {
    fs.writeFileSync(mode, 'expired-once'); const refreshes = [];
    const result = await runRemarkCheck(input, { ensureLogin: async options => { refreshes.push(options); return { status: 'refreshed' }; } });
    assert.equal(result.verdicts[0].verdict, 'confirmed'); assert.equal(fs.readFileSync(counter, 'utf8'), '2'); assert.deepEqual(refreshes, [{ force: true }]);

    fs.writeFileSync(mode, 'always-expired'); fs.rmSync(counter);
    await assert.rejects(runRemarkCheck(input, { ensureLogin: async () => ({ status: 'failed', reason: 'refresh run exit 1; login still expired' }) }), error => {
      assert.match(error.message, /^вход Claude истёк или не найден: role failed \(1\)/); assert.match(error.message, /login refresh: failed/);
      assert.equal(fs.readFileSync(counter, 'utf8'), '2'); return true; });

    fs.writeFileSync(mode, 'answer-mentions-401'); fs.rmSync(counter); let asked = 0;
    await assert.rejects(runRemarkCheck(input, { ensureLogin: async () => { asked++; return { status: 'fresh' }; } }), error => {
      assert.match(error.message, /^role failed \(1\)/); return true; });
    assert.equal(asked, 0, 'an answer that talks about 401 is not a login failure'); assert.equal(fs.readFileSync(counter, 'utf8'), '1');
  } finally { process.env.PATH = prior; }
});
