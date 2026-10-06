import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateShip, validatePreflight, advanceEvidence, botRemarkDigest } from "./gate.mjs";

const head = "a".repeat(40);
const sample = () => ({ head, state: "OPEN", mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", viewer: "worker",
  checks: [ { __typename: "CheckRun", name: "validate", status: "COMPLETED", conclusion: "SUCCESS", head },
    { __typename: "StatusContext", context: "Devin Review", state: "SUCCESS", head },
    { __typename: "CheckRun", name: "Greptile Review", status: "COMPLETED", conclusion: "SUCCESS", head } ],
  reviews: [], threads: [], botComments: [] });
const judgment = () => ({ head, preShipReview: "выполнено", readinessCheck: "пройдена", documentation: "без изменений", closures: [], botRemarks: [] });
test("outstanding requested changes block without inline threads or branch protection", () => {
  const s = sample();
  s.reviews = [{ id: 1, state: "CHANGES_REQUESTED", user: { login: "reviewer" }, commit_id: "old-head" }];
  assert.throws(() => evaluateShip(s, judgment()), /outstanding changes requested/);
  s.reviews.push({ id: 2, state: "COMMENTED", user: { login: "reviewer" } });
  assert.throws(() => evaluateShip(s, judgment()), /outstanding changes requested/);
  s.reviews.push({ id: 3, state: "APPROVED", user: { login: "other" } });
  assert.throws(() => evaluateShip(s, judgment()), /outstanding changes requested/);
  s.reviews.unshift({ id: 4, state: "APPROVED", user: { login: "reviewer" } });
  assert.doesNotThrow(() => evaluateShip(s, judgment()));
  s.reviews = [{ id: 1, state: "DISMISSED", user: { login: "reviewer" } }];
  assert.doesNotThrow(() => evaluateShip(s, judgment()));
  s.reviews = [
    { id: 1, state: "CHANGES_REQUESTED", user: { login: "reviewer" }, submitted_at: "2026-09-15T01:00:00Z" },
    { id: 2, state: "APPROVED", user: { login: "reviewer" }, submitted_at: "2026-09-15T00:00:00Z" },
  ];
  assert.throws(() => evaluateShip(s, judgment()), /outstanding changes requested/, "a draft created earlier can be submitted later");
});
test("ship requires every existing green condition and per-field judgment", () => {
  assert.equal(evaluateShip(sample(), judgment()), "all ship conditions satisfied");
  const failures = [
    ["empty checks", s => s.checks = []], ["red CI", s => s.checks[0].conclusion = "FAILURE"],
    ["old bot", s => s.checks[2].head = "b".repeat(40)], ["unresolved thread", s => s.threads = [{ id: "T", isResolved: false }]],
    ["unpublished reply", s => s.threads = [{ id: "T", isResolved: true, comments: [] }]],
    ["outside remark", s => s.botComments = [{ id: "C", body: "fix this" }]],
    ["pending own review", s => s.reviews = [{ state: "PENDING", user: { login: "worker" } }]],
    ["unknown merge", s => s.mergeStateStatus = "UNKNOWN"], ["closed PR", s => s.state = "CLOSED"],
    ["bot pending", s => s.checks[2].status = "IN_PROGRESS"],
    ["required check not created", s => s.requiredChecks = ["delayed-required-check"]],
  ];
  for (const [name, mutate] of failures) { const s = sample(); mutate(s); assert.throws(() => evaluateShip(s, judgment()), undefined, name); }
  for (const field of ["preShipReview", "readinessCheck", "documentation"]) {
    for (const value of [undefined, "not configured", "skipped"]) { const j = judgment(); j[field] = value; assert.throws(() => evaluateShip(sample(), j), undefined, field); }
  }
  const s = sample(), j = judgment();
  s.threads = [{ id: "T", isResolved: true, comments: [{ id: "R", author: { login: "worker" }, body: "Fixed in commit", publishedAt: "2026-09-14T00:00:00Z", pullRequestReview: { state: "COMMENTED" } }] }];
  j.closures = [{ threadId: "T", replyId: "R" }];
  const reply = s.threads[0].comments[0];
  s.threads[0].comments.unshift({ ...reply, id: "F", body: "original finding", author: { login: "reviewer" } });
  assert.throws(() => evaluateShip(s, { ...j, closures: [{ threadId: "T", replyId: "F" }] }), /closure reply .* not published/);
  s.botComments = [{ id: "C", body: "fix this" }]; j.botRemarks = [{ id: "C", commentDigest: botRemarkDigest(s.botComments[0]), outcome: "fixed", evidence: "commit" }];
  assert.doesNotThrow(() => evaluateShip(s, j));
  s.botComments[0].body = "new uninspected remarks";
  assert.throws(() => evaluateShip(s, j), /changed since disposition/);
  j.botRemarks[0].commentDigest = botRemarkDigest(s.botComments[0]);
  assert.doesNotThrow(() => evaluateShip(s, j));
  reply.author.login = "human-reviewer";
  assert.doesNotThrow(() => evaluateShip(s, j));
  reply.pullRequestReview.state = "PENDING";
  assert.throws(() => evaluateShip(s, j), /closure reply .* not published/);
  reply.pullRequestReview.state = "COMMENTED";
  for (const conclusion of ["SKIPPED", "NEUTRAL"]) {
    const ci = sample(); ci.checks[0].conclusion = conclusion; ci.requiredChecks = ["validate"];
    assert.doesNotThrow(() => evaluateShip(ci, judgment()));
    ci.checks[2].conclusion = conclusion;
    assert.throws(() => evaluateShip(ci, judgment()), /bot .* not completed/);
  }
  const unstable = sample(); unstable.mergeStateStatus = "UNSTABLE";
  assert.throws(() => evaluateShip(unstable, judgment()), /merge state is not clean/);
  const required = sample(); required.requiredChecks = ["validate"]; required.checks[0].conclusion = "FAILURE";
  assert.throws(() => evaluateShip(required, judgment(), { nonBlockingChecks: [{ name: "validate", reason: "not allowed to override GitHub requirements" }] }), /required check/);
});
test("UNSTABLE permits only accepted terminal failures and waits for pending checks", () => {
  const policy = { nonBlockingChecks: [{ name: "optional", reason: "repository policy accepts this check as advisory" }] };
  for (const red of [
    { __typename: "CheckRun", name: "optional", status: "COMPLETED", conclusion: "FAILURE", head },
    { __typename: "StatusContext", context: "optional", state: "ERROR", head },
  ]) {
    const s = sample(); s.mergeStateStatus = "UNSTABLE"; s.checks.push(red);
    assert.equal(evaluateShip(s, judgment(), policy), "all ship conditions satisfied");
    assert.throws(() => evaluateShip(s, judgment()), /check optional not green or accepted non-blocking/);
    assert.throws(() => evaluateShip(s, judgment(), { nonBlockingChecks: [{ name: "optional", reason: " " }] }), /check optional not green/);
    s.requiredChecks = ["optional"];
    assert.throws(() => evaluateShip(s, judgment(), policy), /required check optional not successful/);
    delete s.requiredChecks;
    for (const state of ["BLOCKED", "DIRTY", "BEHIND", "DRAFT", "HAS_HOOKS"]) {
      s.mergeStateStatus = state;
      assert.throws(() => evaluateShip(s, judgment(), policy), error => error.constructor.name !== "ShipPending" && /merge state is not clean/.test(error.message));
    }
    s.mergeStateStatus = "UNSTABLE"; s.checks[0].status = "IN_PROGRESS"; s.checks[0].conclusion = null;
    assert.throws(() => evaluateShip(s, judgment(), policy), error => error.constructor.name === "ShipPending");
    s.mergeable = "UNKNOWN";
    assert.throws(() => evaluateShip(s, judgment(), policy), error => error.constructor.name === "ShipPending");
  }
});
test("pending checks defer transient merge states but never terminal failures", () => {
  const isPending = error => error.constructor.name === "ShipPending";
  const isTerminal = error => !isPending(error);
  for (const state of ["BLOCKED", "UNKNOWN"]) {
    for (const status of ["QUEUED", "IN_PROGRESS", "missing", "empty"]) {
      const s = sample(); s.requiredChecks = ["validate"]; s.mergeStateStatus = state;
      s.mergeable = state === "UNKNOWN" ? "UNKNOWN" : "MERGEABLE";
      if (status === "empty") s.checks = [];
      else if (status === "missing") s.checks.shift();
      else { s.checks[0].status = status; s.checks[0].conclusion = null; }
      assert.throws(() => evaluateShip(s, judgment()), isPending);
    }
    const complete = sample(); complete.mergeStateStatus = state;
    assert.throws(() => evaluateShip(complete, judgment()), state === "UNKNOWN" ? isPending : isTerminal);
  }
  for (const unknown of [{ mergeable: "UNKNOWN" }, { mergeStateStatus: "UNKNOWN" }, { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }]) {
    const s = { ...sample(), ...unknown };
    assert.throws(() => evaluateShip(s, judgment()), error => isPending(error) && /mergeability pending/.test(error.message));
    s.checks[0].conclusion = "FAILURE";
    assert.throws(() => evaluateShip(s, judgment()), isTerminal);
  }
  for (const state of ["DIRTY", "BEHIND", "DRAFT", "HAS_HOOKS"]) {
    const s = sample(); s.mergeStateStatus = state; s.mergeable = "UNKNOWN"; s.checks[0].status = "IN_PROGRESS";
    assert.throws(() => evaluateShip(s, judgment()), isTerminal);
  }
  const red = sample(); red.mergeStateStatus = "BLOCKED"; red.checks[0].conclusion = "FAILURE"; red.checks[2].status = "IN_PROGRESS";
  assert.throws(() => evaluateShip(red, judgment()), error => isTerminal(error) && /check validate not green/.test(error.message));
  red.state = "CLOSED";
  assert.throws(() => evaluateShip(red, judgment()), error => isTerminal(error) && /PR is not open/.test(error.message));
});
test("head changes reset evidence; new events reset quiet time; deadline survives", () => {
  const s = sample();
  let state = advanceEvidence(null, s, 1000);
  assert.equal(advanceEvidence(state, s, 2000).lastEventAt, 1000);
  s.head = "b".repeat(40); state = advanceEvidence(state, s, 3000);
  assert.equal(state.lastEventAt, 3000); assert.equal(state.startedAt, 1000);
  s.reviews.push({ id: 1 }); assert.equal(advanceEvidence(state, s, 4000).lastEventAt, 4000);
});
test("preflight rejects absent, failed, incomplete, stale and wrong-route evidence", () => {
  const route = { model: "policy-model", effort: "high" };
  const receipt = { head, base: "b".repeat(40), route, verification: { exitCode: 0 },
    review: { exitCode: 0, output: "autoreview target: branch | engine: claude | model: policy-model | thinking: high\nautoreview clean: no accepted/actionable findings reported\noverall: patch is correct (0.9)\n" },
    loop: { iterations: 1, residualFindings: [], disposition: "clean" } };
  assert.doesNotThrow(() => validatePreflight(receipt, head, receipt.base, route));
  const advisory = structuredClone(receipt);
  advisory.review.json = { overall_correctness: "patch is correct", findings: [], priority_filtered_findings: [{ priority: "P3", title: "advisory" }] };
  assert.doesNotThrow(() => validatePreflight(advisory, head, receipt.base, route));
  advisory.review.json.priority_filtered_findings[0].priority = "P2";
  assert.throws(() => validatePreflight(advisory, head, receipt.base, route), /structured result/);
  assert.throws(() => validatePreflight(null, head, receipt.base, route));
  for (const mutate of [r => r.head = "c".repeat(40), r => r.review.exitCode = 1, r => r.review.output = "clean", r => r.route.effort = "medium", r => r.loop.residualFindings = ["finding"], r => delete r.loop]) {
    const r = structuredClone(receipt); mutate(r); assert.throws(() => validatePreflight(r, head, receipt.base, route));
  }
});

test("stream retention preserves validation lines and usage beyond the diagnostic tail", async () => {
  const gate = await import('./gate.mjs');
  assert.equal(typeof gate.captureOutput, 'function');
  const capture = gate.captureOutput({ tailBytes: 64 });
  const header = 'autoreview target: branch\nengine: claude\nmodel: policy-model\nthinking: high\n';
  for (const part of [header.slice(0, 15), header.slice(15), 'noise\n'.repeat(10000),
    'claude usage: input_tokens=10 cache_read_input_tokens=20 cache_creation_input_tokens=30 output_tokens=4 cost_usd=0.100000\n',
    'autoreview scoped-clean: no accepted/actionable findings in the selected Git scope and priority\noverall: patch is correct (0.9)\n']) capture.write(part);
  const result = capture.finish();
  assert.ok(result.output.includes(header));
  assert.ok(result.output.length < 2000);
  assert.deepEqual(gate.parseReviewUsage(result.output, 'claude').usage, {engine:'claude',raw:{input_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:30,output_tokens:4,cost_usd:0.1},normalized:{input:10,cacheRead:20,cacheWrite:30,output:4}});
  assert.deepEqual(gate.parseReviewUsage('codex usage: input_tokens=100 cached_input_tokens=40 output_tokens=5 reasoning_output_tokens=2\n','codex').usage.normalized,{input:100,cacheRead:40,cacheWrite:null,output:5});
  assert.equal(gate.parseReviewUsage('', 'claude').usage, null);
  assert.ok(gate.parseReviewUsage('', 'claude').usageReason);
});

test("validation refuses duplicate or lost consumed lines while accepting legacy headers", () => {
  const route = {model:'policy-model',effort:'high'};
  const output = 'autoreview target: branch | engine: claude | model: policy-model | thinking: high\nautoreview clean: no accepted/actionable findings reported\noverall: patch is correct (0.9)\n';
  const receipt = {head,base:'base',route,verification:{exitCode:0},review:{exitCode:0,output},loop:{iterations:1,residualFindings:[],disposition:'clean'}};
  assert.doesNotThrow(()=>validatePreflight(receipt,head,'base',route));
  for (const bad of [output+'engine: other\n', output+'overall: patch is incorrect (0.8)\n', output.replace('model: policy-model','missing model'),output+output]) {
    assert.throws(()=>validatePreflight({...receipt,review:{exitCode:0,output:bad}},head,'base',route));
  }
});

test("only legacy and streaming fixed invocations are valid", async () => {
  const { validReviewInvocation } = await import('./gate.mjs');
  assert.equal(typeof validReviewInvocation,'function');
  const fixed=['--mode','branch','--base','base','--engine','claude','--model','model','--thinking','high','--max-priority','P2'];
  assert.equal(validReviewInvocation(fixed,fixed),true);
  assert.equal(validReviewInvocation([...fixed,'--stream-engine-output'],fixed),true);
  for(const extra of [['--stream-engine-output','--stream-engine-output'],['--foo'],['--max-priority','P3']]) assert.equal(validReviewInvocation([...fixed,...extra],fixed),false);
});

test("dataset archives reuse identical bytes and refuse an explicit version overwrite", async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { archiveReviewDataset } = await import('./gate.mjs');
  assert.equal(typeof archiveReviewDataset,'function');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-dataset-'));
  try {
    const source=path.join(root,'datasets/MONO-998-review-scope.md'); fs.mkdirSync(path.dirname(source)); fs.writeFileSync(source,'first');
    const a=await archiveReviewDataset(source,root); assert.equal(a.version,1);
    assert.equal(fs.readFileSync(a.archive,'utf8'),'first'); assert.equal(fs.readFileSync(a.archive+'.sha256','utf8').trim(),a.digest);
    assert.deepEqual(await archiveReviewDataset(source,root),a);
    fs.writeFileSync(source,'second'); const b=await archiveReviewDataset(source,root); assert.equal(b.version,2);
    fs.writeFileSync(b.archive,'tampered'); await assert.rejects(archiveReviewDataset(source,root),/immutable|digest/);
    assert.equal(fs.readFileSync(a.archive,'utf8'),'first');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('oversized diagnostic lines do not invalidate complete review evidence', async () => {
  const {captureOutput}=await import('./gate.mjs');
  const capture=captureOutput({tailBytes:64});
  capture.write('diagnostic: '+ 'x'.repeat(2*1024*1024));capture.write('\n');
  capture.write('autoreview target: branch\nengine: claude\nmodel: policy-model\nthinking: high\nautoreview clean: no accepted/actionable findings reported\noverall: patch is correct (0.9)\n');
  const result=capture.finish();assert.equal(result.retentionError,null);assert.ok(result.diagnosticTail.length<=64);
  const route={model:'policy-model',effort:'high'};
  assert.doesNotThrow(()=>validatePreflight({head,base:'base',route,verification:{exitCode:0},review:{exitCode:0,...result},loop:{iterations:1,residualFindings:[],disposition:'clean'}},head,'base',route));
  const consumed=captureOutput();consumed.write('model: '+'x'.repeat(2*1024*1024)+'\n');assert.ok(consumed.finish().retentionError);
});

test('the collection lock remains held until its asynchronous action settles', async () => {
  const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
  const {withLock}=await import('./runtime.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-async-lock-')),file=path.join(root,'collection.lock');
  let release;const barrier=new Promise(resolve=>{release=resolve;});
  try {
    const running=withLock(file,async()=>{await barrier;return 'done';});
    assert.equal(fs.existsSync(file),true);
    await assert.rejects(withLock(file,()=>{throw new Error('second action must not run');}),error=>error.code==='ELOCKED');
    release();assert.equal(await running,'done');assert.equal(fs.existsSync(file),false);
  }finally{release();fs.rmSync(root,{recursive:true,force:true});}
});

test('streamed commands receive EOF on stdin instead of hanging the collection', async () => {
  const {runCaptured}=await import('./gate.mjs');
  const result=await runCaptured(process.execPath,['-e',"const timer=setTimeout(()=>process.exit(9),500);process.stdin.resume();process.stdin.on('end',()=>{clearTimeout(timer);process.exit(0)});"],process.cwd());
  assert.equal(result.exitCode,0);
});

test('retention preserves duplicate legacy helper headers outside the diagnostic tail', async () => {
  const {captureOutput}=await import('./gate.mjs');
  const capture=captureOutput({tailBytes:64});
  capture.write('autoreview target: branch | engine: claude | model: policy-model | thinking: high\n');
  capture.write('autoreview target: branch | engine: conflicting | model: policy-model | thinking: high\n'+'noise\n'.repeat(100));
  capture.write('autoreview clean: no accepted/actionable findings reported\noverall: patch is correct (0.9)\n');
  const route={model:'policy-model',effort:'high'};
  assert.throws(()=>validatePreflight({head,base:'base',route,verification:{exitCode:0},review:{exitCode:0,...capture.finish()},loop:{iterations:1,residualFindings:[],disposition:'clean'}},head,'base',route));
});

test('streamed JSON quoting helper syntax does not become helper evidence', async () => {
  const {captureOutput}=await import('./gate.mjs');
  const capture=captureOutput({tailBytes:64});
  const header='autoreview target: branch | engine: claude | model: policy-model | thinking: high';
  capture.write(header+'\n');
  capture.write(JSON.stringify({tool_result:header+'; review passes: 999'})+'\n');
  capture.write(JSON.stringify({tool_result:'x'.repeat(2*1024*1024)+' | engine: quoted'})+'\n');
  capture.write('bundle: 42 bytes; review passes: 1\nautoreview clean: no accepted/actionable findings reported\noverall: patch is correct (0.9)\n');
  const result=capture.finish(),route={model:'policy-model',effort:'high'};
  assert.equal(result.retentionError,null);
  assert.equal((result.output.match(/review passes:/g)||[]).length,1);
  assert.doesNotThrow(()=>validatePreflight({head,base:'base',route,verification:{exitCode:0},review:{exitCode:0,...result},loop:{iterations:1,residualFindings:[],disposition:'clean'}},head,'base',route));
});

test("dataset archive recovers a missing digest only for identical source bytes", async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { archiveReviewDataset } = await import('./gate.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-dataset-recovery-'));
  try {
    const source = path.join(root, 'MONO-998-review-scope.md');
    const archive = path.join(root, 'datasets', 'MONO-998-review-scope.v1.md');
    fs.mkdirSync(path.dirname(archive)); fs.writeFileSync(source, 'complete dataset'); fs.writeFileSync(archive, 'complete dataset');
    const result = await archiveReviewDataset(source, root);
    assert.equal(result.version, 1); assert.equal(fs.readFileSync(archive + '.sha256', 'utf8').trim(), result.digest);
    assert.equal(fs.readFileSync(archive, 'utf8'), 'complete dataset');
    fs.unlinkSync(archive + '.sha256'); fs.writeFileSync(source, 'different dataset');
    await assert.rejects(archiveReviewDataset(source, root), /orphan|digest/);
    assert.equal(fs.existsSync(archive + '.sha256'), false);
    assert.equal(fs.readFileSync(archive, 'utf8'), 'complete dataset');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('review environment is built from the route and engines retain two invocation forms', async () => {
  const { reviewEnvironment, reviewInvocation } = await import('./gate.mjs');
  assert.equal(typeof reviewEnvironment, 'function');
  const secret = String(Math.random());
  const ambient = { PATH: '/bin', HOME: '/fixture', REVIEW_CREDENTIAL: secret,
    ANTHROPIC_AUTH_TOKEN: 'external', ANTHROPIC_BASE_URL: 'https://external.invalid',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'external', OPENAI_API_KEY: 'external', XAI_API_KEY: 'external',
    KIMI_BASE_URL: 'https://external.invalid', AWS_PROFILE: 'external', GOOGLE_APPLICATION_CREDENTIALS: '/external',
    AUTOREVIEW_FALLBACK_MODEL: 'external', CLAUDE_CODE_USE_BEDROCK: '1' };
  for (const [engine, id, target, endpointKey, effort] of [
    ['claude', 'example', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'high'],
    ['kimi', 'moonshot', 'KIMI_API_KEY', 'KIMI_BASE_URL', 'on'],
    ['pi', 'openai', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'high'],
    ['codex', 'openai', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'high'],
  ]) {
    const route = {engine,model:'example',effort,provider:{id,endpoint:'https://route.invalid/v1'},credentialEnv:'REVIEW_CREDENTIAL',fingerprint:'f'.repeat(64)};
    const env = reviewEnvironment(route, ambient);
    assert.equal(env[target], secret); assert.equal(env[endpointKey], route.provider.endpoint);
    assert.equal(env.REVIEW_CREDENTIAL, undefined);
    for (const key of Object.keys(ambient).filter(key=>!['PATH','HOME',target,endpointKey].includes(key))) assert.equal(env[key],undefined,key);
    const invocation = reviewInvocation(route, 'base');
    assert.equal(invocation[invocation.indexOf('--engine')+1],engine);
    const {validReviewInvocation}=await import('./gate.mjs');
    assert.ok(validReviewInvocation(invocation, invocation)); assert.ok(validReviewInvocation([...invocation,'--stream-engine-output'],invocation));
    assert.equal(validReviewInvocation([...invocation,'--fallback-model','other'],invocation),false);
    assert.throws(()=>reviewEnvironment(route,{}),/credential.*REVIEW_CREDENTIAL/i);
  }
});

test('receipt route fingerprints bind the resolved route; legacy remains claude/unknown', async () => {
  const { normalizeReceiptRoute } = await import('./gate.mjs');
  assert.equal(typeof normalizeReceiptRoute,'function');
  const legacy = {model:'policy-model',effort:'high'};
  assert.deepEqual(normalizeReceiptRoute(legacy),{...legacy,engine:'claude',provider:'unknown'});
  const route={...legacy,engine:'kimi',effort:'on',provider:{id:'moonshot',endpoint:null},credentialEnv:null,fingerprint:'a'.repeat(64)};
  const receipt={head,base:'base',route,verification:{exitCode:0},review:{exitCode:0,output:'autoreview target: branch | engine: kimi | model: policy-model | thinking: on\nautoreview scoped-clean: no accepted/actionable findings in the selected Git scope and priority\noverall: patch is correct (0.9)\n'},loop:{iterations:1,residualFindings:[],disposition:'clean'}};
  assert.doesNotThrow(()=>validatePreflight(receipt,head,'base',route));
  assert.throws(()=>validatePreflight(receipt,head,'base',{...route,fingerprint:'b'.repeat(64)}),/route|fingerprint/);
});

test('declared provider credentials are redacted from reviewer evidence without rewriting numeric usage', async () => {
  const { redactReviewCredentials } = await import('./gate.mjs');
  assert.equal(typeof redactReviewCredentials, 'function');
  const secret=String(Math.random());
  const review={output:'diagnostic '+secret,diagnosticTail:Buffer.from(secret).toString('base64'),json:{usage:42,nested:[secret]}};
  const clean=redactReviewCredentials(review,{credentialEnv:'REVIEW_CREDENTIAL'},{REVIEW_CREDENTIAL:secret});
  assert.equal(clean.output,'diagnostic [REDACTED]');assert.equal(clean.diagnosticTail,'[REDACTED]');
  assert.equal(clean.json.usage,42);assert.deepEqual(clean.json.nested,['[REDACTED]']);
});

test("named collection fixtures through the gate CLI", async t => {
  const fs = await import("node:fs"), path = await import("node:path"), os = await import("node:os"), crypto = await import("node:crypto");
  const { spawnSync } = await import("node:child_process");
  const { atomicJson, canonical, digest, resolvedLocation } = await import("./runtime.mjs");
  const { sha256File } = await import("./orchestrator/command-state.mjs");
  const files = fs.readdirSync("scripts/fixtures").filter(name => /^(collection-u13|collector-temp)-.*\.json$/u.test(name));
  for (const name of files) await t.test(name, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join("scripts/fixtures", name), "utf8"));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-u13-cli-"));
    try {
      const repo = path.join(scratch, "repo"), root = path.join(scratch, "orchestrator"), evidence = path.join(scratch, "evidence"), skills = path.join(scratch, "skills"), bin = path.join(scratch, "bin"), darwinTemp = path.join(scratch, "darwin-temp");
      for (const dir of [repo, root, evidence, skills, bin, darwinTemp]) fs.mkdirSync(dir);
      const sandboxLog = path.join(scratch, "sandbox.log"), getconfLog = path.join(scratch, "getconf.log");
      const env = { ...process.env, HOME: path.join(scratch, "home"), PATH: `${bin}:${process.env.PATH}`, MONO_FIXTURE_DARWIN_TEMP: darwinTemp,
        MONO_FIXTURE_SANDBOX_LOG: sandboxLog, MONO_FIXTURE_GETCONF_LOG: getconfLog };
      const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
      // All portable collectors, including U13, use a disjoint controlled root.
      const getconf = path.join(bin, "getconf");
      write(getconf, `#!/usr/bin/env node
if(process.argv[2]!=='DARWIN_USER_TEMP_DIR')process.exit(72);
require('node:fs').appendFileSync(process.env.MONO_FIXTURE_GETCONF_LOG,'getconf\\n');
if(${JSON.stringify(fixture.unavailable)}==='command-failed')process.exit(1);
console.log(process.env.MONO_FIXTURE_DARWIN_TEMP);
`); fs.chmodSync(getconf, 0o700);
      const preload = path.join(scratch, "platform.cjs");
      if (fixture.platform) write(preload, `Object.defineProperty(process,'platform',{value:${JSON.stringify(fixture.platform)}});`);
      const git = (...args) => { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
      write(path.join(repo, ".gitignore"), ".orchestrator/\n");
      git("init", "-b", "delivery"); git("add", ".gitignore"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
      const head = git("rev-parse", "HEAD"), dataset = path.join(evidence, "datasets/fixture.md");
      write(dataset, "Approved U13 decisions.\n");
      for (const policy of ["model-policy.md", "autoreview-routing.md"]) write(path.join(skills, "references", policy), fs.readFileSync(path.join("references", policy), "utf8"));
      const helper = path.join(skills, "autoreview/scripts/autoreview");
      write(helper, `#!/usr/bin/env node
const fs=require('node:fs'), a=process.argv.slice(2), val=k=>a[a.indexOf(k)+1];
fs.writeFileSync(val('--json-output'),JSON.stringify({findings:[],overall_correctness:'patch is correct'}));
fs.writeFileSync(val('--status-output'),JSON.stringify({schema_version:1,status:'scoped-clean',engine:'claude',exit_code:0,report_produced:true,timed_out:false}));
console.log('autoreview target: branch | engine: claude | model: '+val('--model')+' | thinking: '+val('--thinking'));
console.log('autoreview clean: no accepted/actionable findings reported');console.log('overall: patch is correct (0.9)');
`); fs.chmodSync(helper, 0o700);
      const descendant = path.resolve("scripts/fixtures/collector-review-descendant.cjs");
      if (fixture.mode === "temp-descendant") write(helper, `#!${process.execPath}\nprocess.argv.splice(2,0,'review');require(${JSON.stringify(descendant)});\n`);
      if (fixture.helperSymlink) {
        const target = path.join(scratch, "helper-target", "autoreview");
        write(target, fs.readFileSync(helper)); fs.chmodSync(target, 0o700);
        fs.unlinkSync(helper); fs.symlinkSync(target, helper);
      }
      let pack = null;
      if (fixture.protected === "packRoot" || fixture.reviewOverlap === "packRoot") {
        pack = path.join(scratch, "pack"); fs.mkdirSync(pack);
        fs.cpSync(path.join(skills, "references"), path.join(pack, "references"), { recursive: true });
      }
      const protectedPaths = { evidenceRoot: evidence, "orchestrator root": root, skillsRoot: skills,
        packRoot: pack ?? skills, "autoreview helper real path": fs.realpathSync(helper) };
      const workerRoot = path.join(scratch, "worker"); fs.mkdirSync(workerRoot);
      if (fixture.reviewOverlap && fixture.reviewOverlap !== "verification temp") {
        const target = fixture.reviewOverlap === "worktree" ? repo : fixture.reviewOverlap === "Darwin root" ? darwinTemp
          : fixture.reviewOverlap === "worker root" ? workerRoot : protectedPaths[fixture.reviewOverlap];
        const parent = path.join(env.HOME, ".mono-agent-workflow"); fs.mkdirSync(parent, { recursive: true });
        fs.symlinkSync(target, path.join(parent, "review-tmp"));
      }
      if (fixture.protected) {
        const target = protectedPaths[fixture.protected];
        env.MONO_FIXTURE_DARWIN_TEMP = fixture.relationship === "contains" ? path.dirname(target)
          : fixture.relationship === "inside" ? path.join(target, "darwin-temp") : target;
        if (fixture.relationship === "inside") fs.mkdirSync(env.MONO_FIXTURE_DARWIN_TEMP);
      }
      if (fixture.darwinSymlink) {
        const link = path.join(scratch, "darwin-link"); fs.symlinkSync(darwinTemp, link);
        env.MONO_FIXTURE_DARWIN_TEMP = link;
      }
      if (fixture.unavailable === "empty") env.MONO_FIXTURE_DARWIN_TEMP = "";
      if (fixture.unavailable === "missing-path") env.MONO_FIXTURE_DARWIN_TEMP = path.join(scratch, "absent");
      if (fixture.unavailable === "relative") env.MONO_FIXTURE_DARWIN_TEMP = "relative-temp";
      if (fixture.privateInsideDarwin) Object.assign(env, { TMPDIR: darwinTemp, TMP: darwinTemp, TEMP: darwinTemp });
      const boundary = path.join(scratch, "boundary.cjs");
      write(boundary, `
const fs=require('node:fs'),path=require('node:path'),write=fs.writeFileSync;
const grants=JSON.parse(process.env.MONO_FIXTURE_GRANTS);
fs.writeFileSync=function(file,...args){
  const target=path.join(fs.realpathSync(path.dirname(path.resolve(file))),path.basename(file));
  if(!grants.some(root=>target===root||target.startsWith(root+path.sep))){const e=new Error('fixture write grant denial');e.code='EPERM';throw e;}
  return write.call(this,file,...args);
};
const kill=process.kill;
process.kill=function(pid,signal){
  const result=kill.call(this,pid,signal),active=path.join(process.cwd(),'.orchestrator/review-active.json');
  if(signal===0&&process.env.MONO_FIXTURE_PHASE==='verification'&&fs.existsSync(active)&&JSON.parse(fs.readFileSync(active)).pid===pid){
    fs.writeFileSync(path.join(process.cwd(),'.orchestrator/reviewer-signal-denied'),'EPERM');
    const e=new Error('fixture cross-sandbox signal denial');e.code='EPERM';throw e;
  }
  return result;
};
`);
      // Model the outside collector launcher; the actual gate still runs both
      // write-denial probes, verification, helper, signing and history writes.
      const launcher = path.join(bin, "codex");
      write(launcher, `#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),a=process.argv.slice(2);
if(a[0]!=='sandbox')process.exit(71);const command=a.slice(a.indexOf('--')+1),p=JSON.parse(command.at(-1));
fs.appendFileSync(process.env.MONO_FIXTURE_SANDBOX_LOG,'sandbox\\n');
const protectedRoot=path.dirname(p.probe);fs.chmodSync(protectedRoot,0o500);let r;
const profile=a[a.indexOf('-c')+1],grants=[...profile.matchAll(/("(?:\\\\.|[^"\\\\])*")="write"/g)].map(m=>JSON.parse(m[1]));
const env={...process.env,MONO_FIXTURE_GRANTS:JSON.stringify(grants),MONO_FIXTURE_PHASE:p.args.includes('--json-output')?'review':'verification',NODE_OPTIONS:'--require '+JSON.stringify(${JSON.stringify(boundary)})};
if(${JSON.stringify(fixture.reviewOverlap)}==='verification temp'&&!p.args.includes('--json-output')){
  const parent=path.join(process.env.HOME,'.mono-agent-workflow');fs.mkdirSync(parent,{recursive:true});fs.symlinkSync(process.env.TMPDIR,path.join(parent,'review-tmp'));
}
try{r=cp.spawnSync(command[0],command.slice(1),{stdio:'inherit',env});}finally{fs.chmodSync(protectedRoot,0o700);}
process.exit(r.status===null?1:r.status);
`); fs.chmodSync(launcher, 0o700);
      const pinsFile = path.join(root, "dispatch/MONO-999-a1/pins.json");
      const pins = { product: "fixture", root, worktree: repo, skillsRoot: skills, baseRef: "HEAD", evidenceRoot: evidence,
        risk: "standard", critical: null, verification: { command: process.execPath, args: ["-e", "process.exit(0)"] }, workerWritableRoots: [repo, ...(fixture.reviewOverlap === "worker root" ? [workerRoot] : [])],
        reviewDataset: dataset, reviewDatasetVersion: 1, reviewDatasetDigest: sha256File(dataset) };
      if (pack) pins.packRoot = pack;
      if (fixture.mode.startsWith("temp-")) pins.verification.args = ["-e", `
const assert=require('node:assert/strict'),path=require('node:path');
assert.equal(process.env.TMPDIR,process.env.TMP);assert.equal(process.env.TMPDIR,process.env.TEMP);
assert.ok(path.basename(process.env.TMPDIR).startsWith('mono-sandbox-temp-'));
`];
      if (fixture.mode === "temp-descendant") pins.verification.args = [descendant, "verification"];
      atomicJson(pinsFile, pins);
      const binding = { file: pinsFile, digest: sha256File(pinsFile) };
      const entry = { issue: "MONO-999", attempt: 1, stage: "mono-deliver", worktree: repo,
        packVersion: "fixture", sourceCommit: "b".repeat(40), surfaceRevision: 4, pins: binding, pinsVersion: 0 };
      const registryFile = path.join(root, "workers.json");
      const register = () => atomicJson(registryFile, { "MONO-999": entry }); register();
      let request = { ...pins, head, collect: false, collectionId: `preflight-collect:${head}:1`, pins: binding }; delete request.reviewDatasetDigest;
      const file = path.join(scratch, "request.json"), receiptFile = path.join(evidence, `${head}.json`);
      const call = value => { atomicJson(file, value); return spawnSync(process.execPath, [...(fixture.platform ? ["--require", preload] : []), "scripts/gate.mjs", "preflight", "--request", file], { env, encoding: "utf8" }); };
      const collect = value => { const r = call({ ...value, collect: true }); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(fs.readFileSync(receiptFile, "utf8")); };
      const seal = envelope => { envelope.signature = crypto.createHmac("sha256", fs.readFileSync(path.join(evidence, "receipt.key"))).update(canonical(envelope.receipt)).digest("hex"); atomicJson(receiptFile, envelope); };
      let expectedField = null, expectedValue = null, expectedStatus = 2;
      if (fixture.mode === "mismatch") { expectedField = fixture.field; expectedValue = pins[fixture.field]; if (fixture.omit) delete request[fixture.field]; else request[fixture.field] = fixture.value; }
      if (fixture.mode === "pins-digest") { request.pins = { ...binding, digest: "0".repeat(64) }; expectedField = "pins.digest"; expectedValue = binding.digest; }
      if (fixture.mode === "dataset-tamper") { write(dataset, "Changed decisions.\n"); expectedField = "reviewDatasetDigest"; expectedValue = pins.reviewDatasetDigest; }
      if (fixture.mode === "no-pins") { delete request.pins; expectedField = "pins"; expectedValue = binding; }
      if (["amended", "admitted"].includes(fixture.mode)) {
        if (fixture.mode === "admitted") { collect(request); expectedStatus = 0; }
        if (fixture.mode === "admitted") atomicJson(path.join(root, "consumed/MONO-999-a1/admissions", `${request.collectionId}.json`),
          { collectionId: request.collectionId, reportDigest: "f".repeat(64), pinsVersion: 0, manifestDigest: digest({ ...pins, pinsVersion: 0 }) });
        const amendment = path.join(path.dirname(pinsFile), "pins.v1.json"); atomicJson(amendment, { pinsVersion: 1, reviewDatasetVersion: 2, reviewDatasetDigest: pins.reviewDatasetDigest });
        entry.pinsVersion = 1; register();
        if (fixture.mode === "amended") { expectedField = "pins.file"; expectedValue = amendment; }
      }
      if (fixture.mode === "no-dataset") {
        pins.reviewDataset = null; pins.reviewDatasetVersion = 0; pins.reviewDatasetDigest = null; atomicJson(pinsFile, pins);
        binding.digest = sha256File(pinsFile); register(); request = { ...request, reviewDatasetVersion: 0, pins: binding }; delete request.reviewDataset;
        if (fixture.omitVersion) { delete request.reviewDatasetVersion; expectedField = "reviewDatasetVersion"; expectedValue = 0; }
      }
      if (fixture.mode === "other-head") {
        const envelope = collect(request); envelope.receipt.collectionId = `preflight-collect:${head}:2`; seal(envelope);
        request.collectionId = `preflight-collect:${head}:3`;
      }
      if (fixture.mode === "collect") { expectedStatus = 0; request.collect = true; }
      if (fixture.mode.startsWith("temp-")) { expectedStatus = fixture.protected || fixture.reviewOverlap || fixture.mode === "temp-descendant" ? 1 : 0; request.collect = true; }
      if (fixture.mode === "legacy") {
        delete pins.reviewDatasetDigest; atomicJson(pinsFile, pins); binding.digest = sha256File(pinsFile); register(); delete request.pins;
        const envelope = collect(request); assert.equal(Object.hasOwn(envelope.receipt, "pins"), false); expectedStatus = 0;
      }
      if (fixture.mode === "receipt-pins") {
        const envelope = collect(request); envelope.receipt.pins.digest = "0".repeat(64); seal(envelope); expectedStatus = 1;
      }
      if (fixture.mode === "history") {
        const envelope = collect(request); envelope.receipt.collectionId = `preflight-collect:${head}:2`; seal(envelope); expectedStatus = 0;
      }
      if (fixture.mode === "unregistered-receipt") {
        collect(request); fs.unlinkSync(registryFile); delete request.pins; expectedField = "pins"; expectedValue = binding;
      }
      if (fixture.mode === "unmatched-no-pins") {
        entry.worktree = path.join(scratch, "another-worktree"); register(); delete request.pins;
        expectedField = "registry"; expectedValue = "one registered attempt for worktree";
      }
      if (fixture.unregistered) fs.unlinkSync(registryFile);
      const registryBefore = fs.existsSync(registryFile) ? fs.readFileSync(registryFile) : null, receiptBefore = fs.existsSync(receiptFile) ? fs.readFileSync(receiptFile) : null;
      const result = call(request);
      if (expectedField) { expectedStatus = 1; assert.equal(result.stdout.trim(), `gate preflight: fail: collection request mismatch: ${expectedField}; expected ${canonical(expectedValue)}`); }
      assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
      assert.deepEqual(fs.existsSync(registryFile) ? fs.readFileSync(registryFile) : null, registryBefore, "gate never writes the registry");
      assert.equal(fs.existsSync(path.join(root, "reports/MONO-999-phase-preflight.json")), false);
      if (expectedStatus === 2) {
        assert.deepEqual(result.stdout.trim().split("\n"), [`gate preflight: pending: ${request.collectionId}`, JSON.stringify({ publishRequest: request })]);
        if (receiptBefore) assert.deepEqual(fs.readFileSync(receiptFile), receiptBefore);
        else assert.equal(fs.existsSync(receiptFile), false);
      }
      if (fixture.mode === "receipt-pins") assert.match(result.stdout, /receipt pins differs from dispatch request/u);
      if (fixture.mode === "collect") {
        const envelope = JSON.parse(fs.readFileSync(receiptFile, "utf8")); assert.deepEqual(envelope.receipt.pins, binding);
        assert.equal(fs.existsSync(path.join(evidence, "history", `${envelope.receipt.runId}.json`)), true);
        const verified = call({ ...request, collect: false }); assert.equal(verified.status, 0, verified.stdout);
      }
      if (fixture.protected) {
        assert.ok(result.stdout.includes(`collection Darwin temporary write grant (${fixture.protected})`), result.stdout);
        assert.match(result.stdout, /no overlapping grants/u);
        assert.equal(fs.existsSync(sandboxLog), false, "overlap refuses before any sandbox invocation");
        assert.equal(fs.existsSync(receiptFile), false);
      }
      if (fixture.reviewOverlap) {
        assert.match(result.stdout, fixture.reviewOverlap === "verification temp"
          ? /collection private review directory canonical resolution failed: ENOENT/u
          : /collection private review directory.*no overlapping grants/u);
        assert.equal(fs.readFileSync(sandboxLog, "utf8").split("sandbox").length - 1, 1, "only verification launches; review refuses its overlapping directory");
        const { receipt } = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
        assert.equal(receipt.verification.sandbox.probed, true);
        assert.equal(receipt.review.exitCode, null);
      }
      if (fixture.mode.startsWith("temp-") && !fixture.protected && !fixture.reviewOverlap) {
        const { receipt } = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
        const grantsDarwin = fixture.platform === "darwin" && !fixture.unavailable;
        assert.equal(fs.existsSync(getconfLog), fixture.platform === "darwin", "other platforms never query Darwin temp");
        for (const phase of ["verification", "review"]) {
          const { sandbox } = receipt[phase], profile = sandbox.args[sandbox.args.indexOf("-c") + 1];
          const actual = [...profile.matchAll(/("(?:\\.|[^"\\])*")="write"/gu)].map(match => JSON.parse(match[1]));
          const expected = [...new Set([fs.realpathSync(repo), resolvedLocation(sandbox.tempRoot), ...(grantsDarwin && phase === "verification" ? [fs.realpathSync(darwinTemp)] : [])])];
          assert.deepEqual(actual.sort(), expected.sort(), phase + " records exactly the granted roots");
          assert.ok(profile.includes('\":root\"="read"'));
          assert.ok(profile.includes("network={enabled=true}"));
          assert.equal(sandbox.probed, true);
          assert.equal(fs.existsSync(sandbox.tempRoot), false);
          if (fixture.privateInsideDarwin) assert.equal(resolvedLocation(sandbox.tempRoot).startsWith(fs.realpathSync(darwinTemp) + path.sep), phase === "verification");
          if (fixture.platform === "darwin" && phase === "review") assert.ok(sandbox.tempRoot.startsWith(fs.realpathSync(env.HOME) + path.sep + ".mono-agent-workflow/review-tmp/"));
        }
        assert.equal(fs.readdirSync(evidence).some(name => name.startsWith(".write-boundary-")), false);
        const verified = call({ ...request, collect: false }); assert.equal(verified.status, fixture.mode === "temp-descendant" ? 1 : 0, verified.stdout);
        if (fixture.mode === "temp-descendant") {
          const proof = JSON.parse(fs.readFileSync(path.join(repo, ".orchestrator/descendant-attempts.json")));
          assert.equal(proof.parentAlive, false); assert.equal(proof.reviewAlive, true);
          assert.equal(fs.readFileSync(path.join(repo, ".orchestrator/reviewer-signal-denied"), "utf8"), "EPERM", "portable proof models a denied signal probe of the live reviewer");
          assert.deepEqual(proof.attempts.map(attempt => attempt.target), ["--json-output", "--status-output"].map(flag => receipt.review.args[receipt.review.args.indexOf(flag) + 1]));
          assert.deepEqual(proof.attempts.map(attempt => attempt.result), ["EPERM", "EPERM"]);
          assert.equal(receipt.review.json.overall_correctness, "patch is incorrect");
          assert.equal(receipt.review.json.findings[0].priority, 1);
          assert.equal(receipt.review.status.status, "findings"); assert.equal(receipt.review.exitCode, 1);
        }
      }
      if (fixture.mode === "history") assert.deepEqual(fs.readFileSync(receiptFile), receiptBefore, "history verification does not reconcile the mutable head");
    } finally {
      const ready = path.join(scratch, "repo/.orchestrator/descendant-ready.json");
      if (fs.existsSync(ready)) { try { process.kill(JSON.parse(fs.readFileSync(ready)).pid, "SIGTERM"); } catch {} }
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});
