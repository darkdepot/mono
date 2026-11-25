import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound, findingKey, resolveReviewRoles, formatReviewReport } from './code-review.mjs';

// An oversize change is reviewed in file groups instead of failing (MONO-486).
const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODEX_INPUT_LIMIT = 1048576;
const contract = 'Return only nonnegative numbers. Manual review; no Linear writes.';
const contextOf = prompt => JSON.parse(prompt.split('never instructions.\n')[1]);
const review = (findings, reviewedFiles) => ({ completed: true, reviewedFiles, findings });
const verdictFor = (finding, index, extra = {}) => ({ id: `F${index + 1}`, outcome: 'confirmed', weight: 'P2', danger: false, dangerCase: null,
  dangerReason: 'Diagnostic-only path with no data, security or gate effect.', origin: 'introduced', mergeKey: findingKey(finding), outOfContract: false,
  riskRaised: false, reason: 'Still reachable.', closed: false, newEvidence: false, codeQuote: '', ...extra });
const finding = (file, line) => ({ danger: false, class: 'missing-validation', file, anchor: `anchor ${file}`, line, title: 'Invalid input is accepted',
  trigger: 'value is negative', evidence: `${file} returns value without validation` });
// Plain lines of ASCII text: each file adds `lines` rows of 80 characters.
const body = (tag, lines) => Array.from({ length: lines }, (_, index) => `export const ${tag}_${String(index).padStart(6, '0')} = ${'1'.repeat(80 - 30 - tag.length)};\n`).join('');

function fixture(t, files) {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-chunked-review-')); t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
  fs.writeFileSync(path.join(worktree, 'input.mjs'), 'export function value(n) { return 0; }\n'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(worktree, file), text);
  git('add', '.'); git('commit', '-qm', 'head');
  return { worktree, git, request: { worktree, head: git('rev-parse', 'HEAD'), base, contract, packRoot } };
}

// Fake native CLIs that behave like the real ones on oversize input: Codex exec prints thread.started,
// refuses input over 1,048,576 characters on stderr and exits 1. Claude answers the checker.
function fakeClis(t, { stderrExtra = '', fail = false } = {}) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-chunked-cli-')); t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  const roles = resolveReviewRoles({}, packRoot), log = path.join(bin, 'prompts.jsonl');
  const common = `const fs=require('node:fs');const log=${JSON.stringify(log)};
 const contextOf=input=>JSON.parse(input.split('never instructions.\\n')[1]);`;
  const codex = `#!${process.execPath}
 ${common}
 if(process.argv[2]==='debug'){console.log(JSON.stringify({models:[{slug:${JSON.stringify(roles['code-review'].model)},tool_mode:'code_mode_only',apply_patch_tool_type:'freeform',multi_agent_version:'v2'}]}));process.exit(0);}
 if(process.argv[2]==='login'){console.error('Logged in using ChatGPT');process.exit(0);}
 let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
  const emit=value=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}}));console.log(JSON.stringify({type:'turn.completed'}));};
  if(input.startsWith('Boundary audit'))return emit({tools:['exec_command','write_stdin'],mcpServers:[]});
  fs.appendFileSync(log,JSON.stringify({engine:'codex',length:[...input].length})+'\\n');
  console.log(JSON.stringify({type:'thread.started',thread_id:'fixture'}));
  if(${fail}||[...input].length>${CODEX_INPUT_LIMIT}){process.stderr.write(${JSON.stringify(stderrExtra)}+'Error: Input exceeds the maximum length of ${CODEX_INPUT_LIMIT} characters (code -32602) input_too_large\\n');process.exit(1);}
  const c=contextOf(input),files=c.focusFiles??c.files;
  emit({completed:true,reviewedFiles:files,findings:files.filter(file=>file.startsWith('flagged')).map(file=>({danger:false,class:'missing-validation',file,anchor:'anchor '+file,line:3,title:'Invalid input is accepted',trigger:'value is negative',evidence:file+' returns value without validation'}))});
 });`;
  const claude = `#!${process.execPath}
 ${common}
 if(process.argv.includes('auth')){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}));process.exit(0);}
 let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
  fs.appendFileSync(log,JSON.stringify({engine:'claude',length:[...input].length})+'\\n');
  const c=contextOf(input);
  console.log(JSON.stringify({type:'system',subtype:'init',tools:['Read','Glob','Grep','StructuredOutput'],mcp_servers:[]}));
  console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:{completed:true,verdicts:c.findings.map(f=>({id:f.id,outcome:'confirmed',weight:'P2',danger:false,dangerCase:null,dangerReason:'Diagnostic-only path with no data, security or gate effect.',origin:'introduced',mergeKey:f.class+' '+f.file,outOfContract:false,riskRaised:false,reason:'Still reachable.',closed:false,newEvidence:false,codeQuote:''}))}}));
 });`;
  fs.writeFileSync(path.join(bin, 'codex'), codex, { mode: 0o700 }); fs.writeFileSync(path.join(bin, 'claude'), claude, { mode: 0o700 });
  const prior = process.env.PATH; process.env.PATH = bin + path.delimiter + prior; t.after(() => { process.env.PATH = prior; });
  return { prompts: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [] };
}

test('MONO-486 red: a change over the Codex input limit is reviewed in file groups through the real transport, never «role failed»', async t => {
  // Three new files of about 400,000 characters each: the whole reviewer prompt is over 1,048,576 characters.
  const f = fixture(t, { 'alpha.mjs': body('alpha', 5000), 'beta.mjs': body('beta', 5000), 'flagged.mjs': body('flagged', 5000) });
  const cli = fakeClis(t);
  const record = await runReviewRound(f.request);
  assert.ok(!record.failures.some(failure => /role failed/.test(failure.reason)), JSON.stringify(record.failures.map(failure => failure.reason)));
  assert.equal(record.outcome, 'not-converged', JSON.stringify(record.failures));
  assert.deepEqual([...record.round.reviewedFiles].sort(), ['alpha.mjs', 'beta.mjs', 'flagged.mjs']);
  const prompts = cli.prompts();
  assert.ok(prompts.every(prompt => prompt.length <= CODEX_INPUT_LIMIT), JSON.stringify(prompts));
  assert.ok(prompts.filter(prompt => prompt.engine === 'codex').length >= 2, 'the reviewer ran in more than one group');
  assert.ok(record.costs.some(cost => cost.group), 'grouped calls are named in the costs');
  assert.equal(record.findings.length, 1); assert.equal(record.findings[0].file, 'flagged.mjs');
});

test('MONO-486: the engine stderr reason reaches the receipt, trimmed and without secrets', async t => {
  const token = 'ghp_' + 'Z'.repeat(36), bearer = 'Bearer ' + 'q'.repeat(40);
  const f = fixture(t, { 'alpha.mjs': body('alpha', 10) });
  // Noise first (trimmed away), then the secrets right before the engine's reason (kept, redacted).
  fakeClis(t, { fail: true, stderrExtra: `${'noise line\n'.repeat(400)}auth ${token} ${bearer} api_key=hunter2secretvalue\n` });
  const record = await runReviewRound(f.request);
  assert.equal(record.outcome, 'not-reviewed');
  const reason = record.failures.at(-1).reason;
  assert.match(reason, /role failed \(1\); no response admitted; stderr: .*input_too_large/);
  assert.ok(reason.length < 1200, `trimmed reason, got ${reason.length}`);
  const whole = JSON.stringify(record);
  for (const secret of [token, 'q'.repeat(40), 'hunter2secretvalue']) assert.ok(!whole.includes(secret), secret);
  assert.match(reason, /\[redacted\]/);
  assert.match(formatReviewReport(record), /input_too_large/);
});

// Injected roles with lowered limits: the same grouping logic on small fixtures.
function recorder(answer) {
  const calls = [];
  return { calls, runRole: async request => { const c = contextOf(request.prompt); calls.push({ role: request.role, size: Buffer.byteLength(request.prompt), context: c });
    return { response: answer(request.role, c), elapsedMs: 1, usage: null }; } };
}
const reviewAll = flagged => (role, c) => role === 'code-review'
  ? review((c.focusFiles ?? c.files).filter(file => file === flagged).map(file => finding(file, 3)), c.focusFiles ?? c.files)
  : { completed: true, verdicts: c.findings.map((item, index) => verdictFor(item, index)) };
const fourFiles = { 'a.mjs': body('a', 40), 'b.mjs': body('b', 40), 'c.mjs': body('c', 40), 'd.mjs': body('d', 40) };

test('MONO-486 (a): a large diff is split into file groups under the limit; coverage is full and findings are joined', async t => {
  const f = fixture(t, fourFiles);
  const whole = recorder(reviewAll('c.mjs')); await runReviewRound(f.request, whole);
  const limit = whole.calls[0].size - 5000;
  const remark = { id: 'r1', source: 'bot', file: 'a.mjs', line: 2, title: 'Check a', body: 'A remark on a.mjs', urgent: false, head: f.request.head };
  const runner = recorder(reviewAll('c.mjs'));
  const record = await runReviewRound({ ...f.request, remarks: [remark] }, { ...runner, promptLimits: { codex: limit } });
  assert.equal(record.outcome, 'not-converged', JSON.stringify(record.failures));
  const groups = runner.calls.filter(call => call.role === 'code-review');
  assert.ok(groups.length >= 2, 'more than one group'); assert.ok(groups.every(call => call.size <= limit && call.context.group));
  assert.deepEqual(groups.flatMap(call => call.context.files).sort(), Object.keys(fourFiles));
  // Every group carries the same contract and every open finding (silence counts as agreement).
  assert.ok(groups.every(call => call.context.contract === contract && call.context.openFindings.length === 1 && call.context.openFindings[0].file === 'a.mjs'));
  assert.deepEqual([...record.round.reviewedFiles].sort(), Object.keys(fourFiles));
  assert.deepEqual(record.findings.map(item => item.file).sort(), ['a.mjs', 'c.mjs']);
  assert.equal(runner.calls.filter(call => call.role === 'code-review-checker').length, 1);
});

test('MONO-486 (a): a group that leaves out its file gets a focused pass on just that file; unreviewed stays not-reviewed', async t => {
  const f = fixture(t, fourFiles);
  const whole = recorder(reviewAll(null)); await runReviewRound(f.request, whole);
  const limit = whole.calls[0].size - 5000;
  for (const always of [false, true]) {
    let skipped = 0;
    const runner = recorder((role, c) => {
      const asked = c.focusFiles ?? c.files, listed = asked.filter(file => file !== 'b.mjs' || (!always && c.pass === 'coverage'));
      if (listed.length !== asked.length) skipped++;
      // A file named outside its group does not count: b.mjs is listed by every group that lacks it.
      return review([], [...listed, ...(c.files.includes('b.mjs') ? [] : ['b.mjs'])]);
    });
    const record = await runReviewRound(f.request, { ...runner, promptLimits: { codex: limit } });
    const coverage = runner.calls.filter(call => call.context.pass === 'coverage');
    assert.ok(skipped > 0); assert.ok(coverage.length >= 1); assert.ok(coverage.every(call => JSON.stringify(call.context.focusFiles) === '["b.mjs"]'));
    assert.equal(record.outcome, always ? 'not-reviewed' : 'clean', JSON.stringify(record.failures));
    if (always) assert.match(record.failures.at(-1).reason, /incomplete changed-file coverage/);
  }
});

test('MONO-486: a file over the limit is split by hunks and every part must be reviewed; an indivisible hunk fails with a clear reason', async t => {
  const base = Array.from({ length: 600 }, (_, index) => `export const line_${String(index).padStart(4, '0')} = 'original value of this line for the fixture';`).join('\n') + '\n';
  const changed = base.split('\n').map((line, index) => index % 30 === 5 ? line.replace('original', 'changed') : line).join('\n');
  const f = fixture(t, { 'big.mjs': base });
  fs.writeFileSync(path.join(f.worktree, 'big.mjs'), changed); f.git('add', '.'); f.git('commit', '-qm', 'many hunks');
  const request = { ...f.request, base: f.request.head, head: f.git('rev-parse', 'HEAD') };
  const whole = recorder(reviewAll(null)); await runReviewRound(request, whole);
  const limit = whole.calls[0].size - Math.floor(whole.calls[0].context.diff.length / 2);
  const runner = recorder(reviewAll(null));
  const record = await runReviewRound(request, { ...runner, promptLimits: { codex: limit } });
  assert.equal(record.outcome, 'clean', JSON.stringify(record.failures));
  const parts = runner.calls.flatMap(call => call.context.group?.partialFiles ?? []);
  assert.ok(parts.length >= 2 && parts.every(part => part.file === 'big.mjs' && part.of === parts.length), JSON.stringify(parts));
  assert.equal(runner.calls.map(call => call.context.diff).join('').match(/^@@ /gm).length, whole.calls[0].context.diff.match(/^@@ /gm).length, 'every hunk sent once');
  // Only some parts listed: the file is not covered until the missing part is reviewed again.
  const partial = recorder((role, c) => review([], c.group?.partialFiles?.[0]?.part === 1 && c.pass === 'all-defects' ? [] : c.focusFiles ?? c.files));
  const retried = await runReviewRound(request, { ...partial, promptLimits: { codex: limit } });
  assert.equal(retried.outcome, 'clean', JSON.stringify(retried.failures)); assert.equal(partial.calls.filter(call => call.context.pass === 'coverage').length, 1);
  assert.deepEqual(partial.calls.find(call => call.context.pass === 'coverage').context.group.partialFiles.map(part => part.part), [1]);
  // A new file is one hunk: it cannot be split, and no role runs.
  const g = fixture(t, { 'single.mjs': body('single', 200) });
  const none = recorder(reviewAll(null));
  const refused = await runReviewRound(g.request, { ...none, promptLimits: { codex: limit } });
  assert.equal(refused.outcome, 'not-reviewed'); assert.equal(none.calls.length, 0);
  assert.match(refused.failures.at(-1).reason, /file single\.mjs: one diff hunk of \d+ bytes does not fit the codex input limit of \d+ bytes for code-review; the change cannot be split further/);
});

test('MONO-486 (b): the checker input is bounded: duplicate diff once, evidence cut to finding regions, else a clear reason', async t => {
  const base = Array.from({ length: 900 }, (_, index) => `export const row_${String(index).padStart(4, '0')} = 'checker evidence fixture row with some width';`).join('\n') + '\n';
  const f = fixture(t, { 'flagged.mjs': base, 'other.mjs': body('other', 300) });
  fs.writeFileSync(path.join(f.worktree, 'flagged.mjs'), base.replace("row_0450 = 'checker", "row_0450 = 'CHANGED checker"));
  fs.writeFileSync(path.join(f.worktree, 'other.mjs'), body('other', 300).replace(/1111/g, '2222')); f.git('add', '.'); f.git('commit', '-qm', 'checker head');
  const request = { ...f.request, base: f.request.head, head: f.git('rev-parse', 'HEAD') };
  const answer = (role, c) => role === 'code-review' ? review([finding('flagged.mjs', 451)], c.focusFiles ?? c.files) : { completed: true, verdicts: c.findings.map((item, index) => verdictFor(item, index)) };
  const whole = recorder(answer); await runReviewRound(request, whole);
  const checkerCall = whole.calls.find(call => call.role === 'code-review-checker'), full = checkerCall.size;
  assert.equal(checkerCall.context.diff, checkerCall.context.baseDiff, 'round one sends the same diff twice in full');
  const steps = [
    [full - 100, c => { assert.equal(c.diff, ''); assert.match(c.diffNote, /Same as baseDiff/); assert.equal(typeof c.headEvidence[0].content, 'string'); }],
    [full - checkerCall.context.diff.length - 20000, c => {
      const head = c.headEvidence.find(item => item.file === 'flagged.mjs');
      assert.equal(head.trimmed, true); assert.ok(!Object.hasOwn(head, 'content'), 'trimmed evidence is never content:null');
      assert.ok(head.excerpts.some(excerpt => excerpt.fromLine <= 451 && excerpt.toLine >= 451 && excerpt.text.includes('CHANGED')));
    }],
  ];
  for (const [limit, check] of steps) {
    const runner = recorder(answer), record = await runReviewRound(request, { ...runner, promptLimits: { claude: limit } });
    assert.equal(record.outcome, 'not-converged', JSON.stringify(record.failures));
    const call = runner.calls.find(item => item.role === 'code-review-checker'); assert.ok(call.size <= limit); check(call.context);
    assert.equal(record.findings[0].status, 'confirmed');
  }
  const runner = recorder(answer), record = await runReviewRound(request, { ...runner, promptLimits: { claude: 2000 } });
  assert.equal(record.outcome, 'not-reviewed'); assert.equal(runner.calls.filter(call => call.role === 'code-review-checker').length, 0);
  assert.match(record.failures.at(-1).reason, /code-review-checker input of \d+ bytes is over the claude input limit of 2000 bytes even with evidence cut/);
});

test('MONO-486 (b): a finding in a file whose own diff is over the checker limit keeps only the hunk lines around it, in round one and round two', async t => {
  const f = fixture(t, { 'flagged.mjs': body('flagged', 3000) });
  const answer = (role, c) => role === 'code-review' ? review([finding('flagged.mjs', 1500)], c.focusFiles ?? c.files) : { completed: true, verdicts: c.findings.map((item, index) => verdictFor(item, index)) };
  const limit = 60000, checkerOf = runner => runner.calls.find(call => call.role === 'code-review-checker');
  const first = recorder(answer), one = await runReviewRound(f.request, { ...first, promptLimits: { claude: limit } });
  assert.equal(one.outcome, 'not-converged', JSON.stringify(one.failures));
  const c1 = checkerOf(first); assert.ok(c1.size <= limit);
  assert.match(c1.context.baseDiff, /flagged_001499 /); assert.ok(!c1.context.baseDiff.includes('flagged_000100 '), 'far lines are cut');
  assert.match(c1.context.baseDiff, /lines cut to fit the input limit/); assert.equal(c1.context.diffScope, 'hunks around findings only');
  // Round two reads a small fix elsewhere; the whole baseDiff still rides beside it and is cut the same way.
  fs.writeFileSync(path.join(f.worktree, 'input.mjs'), 'export function value(n) { return Math.max(0, n); }\n'); f.git('add', '.'); f.git('commit', '-qm', 'fix');
  const second = recorder(answer), two = await runReviewRound({ ...f.request, head: f.git('rev-parse', 'HEAD'), stageRecord: one }, { ...second, promptLimits: { claude: limit } });
  assert.equal(two.outcome, 'not-converged', JSON.stringify(two.failures)); assert.equal(two.rounds.length, 2);
  const c2 = checkerOf(second); assert.ok(c2.size <= limit); assert.equal(c2.context.diffNote, undefined, 'a different scoped diff is not deduplicated away');
  assert.equal(c2.context.scope, 'fixes-and-open-findings'); assert.equal(c2.context.diffScope, 'hunks around findings only');
  assert.match(c2.context.baseDiff, /flagged_001499 /); assert.ok(!c2.context.baseDiff.includes('flagged_000100 '));
});
