import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { test } from "node:test";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value)); };
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const run = (command, args, cwd, env) => spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const pass = result => { assert.equal(result.status, 0, result.stderr + result.stdout); return result; };

test("clean installed runtime: tool evidence, spawn/resume, halt, attempts and durable ack", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-delivery-installed-"));
  const skills = path.join(root, "skills"), state = path.join(root, "orchestrator"), repo = path.join(root, "repo"), bin = path.join(root, "bin");
  const mailbox = path.join(state, "reports");
  const env = { ...process.env, MONO_WORKFLOW_STATE_ROOT: path.join(root, "install-state"), MONO_WORKFLOW_KNOWN_ROOTS: skills, PATH: `${bin}:${process.env.PATH}` };
  let livePid;
  const oldPath = process.env.PATH;
  try {
    pass(run(process.execPath, ["scripts/install-local.mjs", "--skills-root", skills], checkout, env));
    pass(run(process.execPath, ["scripts/install-local.mjs", "--skills-root", skills, "--check"], checkout, env));
    const runtime = path.join(skills, ".mono-agent-workflow/scripts");
    for (const script of ["gate.mjs", "delivery-state.mjs", "orchestrator/spawn.mjs", "orchestrator/resume.mjs", "orchestrator/consume-gate-ack.mjs"]) {
      pass(run(process.execPath, [path.join(runtime, script), "--help"], root, env));
    }
    assert.ok(fs.existsSync(path.join(skills, "mono-deliver/SKILL.md")));
    const budget = jsonFromRun(pass(run(process.execPath, [path.join(runtime, "read-budget.mjs"), "--json"], root, env)));
    assert.ok(budget.within_ceiling && budget.ceiling_bytes === 99_882);
    assert.ok(budget.files.some(file => file.path === "skills/mono-deliver/SKILL.md"));
    assert.ok(budget.files.some(file => file.path === "references/worker-contract.md"));
    fs.mkdirSync(repo); pass(run("git", ["init", "-b", "delivery"], repo, env));
    write(path.join(repo, "tracked.txt"), "tracked\n"); pass(run("git", ["add", "tracked.txt"], repo, env));
    pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"], repo, env));
    const head = pass(run("git", ["rev-parse", "HEAD"], repo, env)).stdout.trim();
    const lock = path.join(skills, ".mono-agent-workflow.lock.json"), pins = json(lock);
    const baseRequest = { root: state, issue: "MONO-999", worktree: repo, branch: "delivery", base: head, lock,
      packVersion: pins.packVersion, sourceCommit: pins.sourceCommit, surfaceRevision: pins.surfaceRevision };
    const fsmonitor = path.join(root, "fsmonitor"), monitorMarker = path.join(root, "fsmonitor-ran");
    write(fsmonitor, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(monitorMarker)},'unsafe git invocation');`);
    fs.chmodSync(fsmonitor, 0o700);
    pass(run("git", ["config", "core.fsmonitor", fsmonitor], repo, env));
    const gateRequest = path.join(root, "gate.json"); write(gateRequest, baseRequest);
    pass(run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", gateRequest], root, env));
    const globalConfig = path.join(root, "global-gitconfig"), globalIgnore = path.join(root, "global-ignore");
    write(globalIgnore, "global-only.tmp\n");
    write(globalConfig, `[core]\nexcludesFile = ${JSON.stringify(globalIgnore)}\nfsmonitor = ${JSON.stringify(fsmonitor)}\n`);
    const globalEnv = { ...env, GIT_CONFIG_GLOBAL: globalConfig };
    write(path.join(repo, "global-only.tmp"), "ignored only by global config");
    const installedStart = () => run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", gateRequest], root, globalEnv);
    pass(installedStart());
    const localIgnore = path.join(root, "local-ignore"); write(localIgnore, "local-only.tmp\n");
    pass(run("git", ["config", "core.excludesFile", localIgnore], repo, env));
    assert.match(installedStart().stdout, /working tree is dirty/, "local excludes overrides global excludes");
    fs.unlinkSync(path.join(repo, "global-only.tmp")); write(path.join(repo, "local-only.tmp"), "local override");
    pass(installedStart()); fs.unlinkSync(path.join(repo, "local-only.tmp"));
    pass(run("git", ["config", "--unset", "core.excludesFile"], repo, env));
    assert.equal(fs.existsSync(monitorMarker), false, "global fsmonitor was never imported");
    write(path.join(repo, "dirty"), "dirty");
    const dirtyResult = run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", gateRequest], root, env);
    assert.match(dirtyResult.stdout, /fail: working tree is dirty/, JSON.stringify(dirtyResult));
    fs.unlinkSync(path.join(repo, "dirty"));

    assert.equal(fs.existsSync(monitorMarker), false);

    const helper = path.join(skills, "autoreview/scripts/autoreview");
    write(helper, `#!/usr/bin/env node
const fs=require('node:fs'); const a=process.argv.slice(2); const val=k=>a[a.indexOf(k)+1];
if(a.includes('--dataset')&&require('node:path').isAbsolute(val('--dataset'))){console.error('--dataset must be a repo-relative path');process.exit(2);}
const failed=process.env.MONO_FIXTURE_REVIEW_FINDINGS==='1';
const report={findings:failed?[{priority:'P2',title:'fixture finding'}]:[],overall_correctness:failed?'patch is incorrect':'patch is correct'};
report.fixture={dataset:a.includes('--dataset')?{path:val('--dataset'),content:fs.readFileSync(val('--dataset'),'utf8')}:null,
  gitEnv:Object.fromEntries(['GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM','GIT_NO_REPLACE_OBJECTS','GIT_GRAFT_FILE','GIT_MONO_FIXTURE'].map(k=>[k,process.env[k]??null])),
  home:process.env.HOME,path:process.env.PATH};
fs.writeFileSync(val('--json-output'),JSON.stringify(report));
fs.writeFileSync(val('--status-output'),JSON.stringify({schema_version:1,status:failed?'findings':'scoped-clean',engine:'claude',exit_code:failed?1:0,report_produced:true,timed_out:false}));
console.log('autoreview target: branch | engine: claude | model: '+val('--model')+' | thinking: '+val('--thinking'));
console.log(failed?'autoreview findings: accepted/actionable findings reported':'autoreview clean: no accepted/actionable findings reported');
console.log('overall: '+report.overall_correctness+' (0.9)');
if(a.includes('--stream-engine-output'))console.log('claude usage: input_tokens=10 cache_read_input_tokens=20 cache_creation_input_tokens=30 output_tokens=4');
if(process.env.MONO_FIXTURE_ALTER_DATASET==='1')fs.appendFileSync(val('--dataset'),'changed after review');
process.exit(failed?1:0);
`); fs.chmodSync(helper, 0o700);
    // Model the outside orchestrator's sandbox launcher. Nested OS sandboxes
    // cannot be launched from this test worker; permission bits model the denial.
    // The real outside collector must pass its write-denial probe at deployment.
    write(path.join(bin, "codex"), `#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const a=process.argv.slice(2);if(a[0]!=='sandbox'||!a.includes('mono-collector'))process.exit(71);
const command=a.slice(a.indexOf('--')+1),p=JSON.parse(command.at(-1));
const profile=a.find(v=>v.startsWith('permissions.mono-collector='));
const grants=[...profile.matchAll(/("[^"]+")="write"/g)].map(m=>JSON.parse(m[1]));
const protectedRoot=path.dirname(p.probe);if(grants.some(g=>protectedRoot===g||protectedRoot.startsWith(g+path.sep)))process.exit(72);
const open=process.env.MONO_FIXTURE_OPEN_SANDBOX==='1';if(!open)fs.chmodSync(protectedRoot,0o500);let r;
try{r=cp.spawnSync(command[0],command.slice(1),{stdio:'inherit'});}finally{if(!open)fs.chmodSync(protectedRoot,0o700);}
process.exit(r.status===null?1:r.status);
`); fs.chmodSync(path.join(bin, "codex"), 0o700);
    fs.mkdirSync(mailbox, { recursive: true });
    const preflight = { product: "fixture", collectionId: `preflight-collect:${head}:1`, root: state, worktree: repo, head, skillsRoot: skills, risk: "risky", critical: null, baseRef: "HEAD", evidenceRoot: path.join(root, "evidence"), workerWritableRoots: [repo, mailbox], collect: false,
      verification: { command: process.execPath, args: ["-e", "const fs=require('node:fs'),os=require('node:os');fs.writeFileSync(fs.mkdtempSync(os.tmpdir()+'/fixture-')+'/temp','ok')"] } };
    write(gateRequest, preflight);
    const preflightCall = () => run(process.execPath, [path.join(runtime, "gate.mjs"), "preflight", "--request", gateRequest], root, env);
    assert.equal(preflightCall().status, 1, "missing artifact must refuse");
    const submoduleReason = "submodules unsupported by the collector (executable-filter inspection covers the superproject only)";
    const refusesSubmodules = () => {
      write(gateRequest, baseRequest);
      const start = run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", gateRequest], root, env);
      assert.equal(start.status, 1); assert.equal(start.stdout.trim(), `gate start: fail: ${submoduleReason}`);
      write(gateRequest, { ...preflight, collect: true });
      const collect = preflightCall();
      assert.equal(collect.status, 1); assert.equal(collect.stdout.trim(), `gate preflight: fail: ${submoduleReason}`);
    };
    write(path.join(repo, ".gitmodules"), ""); refusesSubmodules(); fs.unlinkSync(path.join(repo, ".gitmodules"));
    // A missing .gitmodules must not hide an indexed gitlink.
    pass(run("git", ["-c", "core.fsmonitor=false", "update-index", "--add", "--cacheinfo", `160000,${head},nested`], repo, env));
    refusesSubmodules();
    pass(run("git", ["-c", "core.fsmonitor=false", "update-index", "--force-remove", "nested"], repo, env));
    // The fixture controller models the orchestrator. Its evidence root is
    // outside both modeled worker grants; the worker only invokes collect:false.
    const { publishPhase: publishCollection, confirmQueue: confirmCollection, validateConfirmation: validateCollectionConfirmation } = await import(pathToFileURL(path.join(runtime, "delivery-state.mjs")));
    const { digest: receiptDigest, canonical, resolveModelRoutes } = await import(pathToFileURL(path.join(runtime, "runtime.mjs")));
    write(gateRequest, { ...preflight, workerWritableRoots: [path.parse(root).root] });
    assert.match(preflightCall().stdout, /evidenceRoot must be outside/);
    const collectionRequest = { ...preflight, collect: true };
    fs.mkdirSync(preflight.evidenceRoot, { recursive: true });
    const collectionLock = path.join(preflight.evidenceRoot, `${head}.collect.lock`);
    write(collectionLock, { pid: process.pid });
    write(gateRequest, collectionRequest);
    assert.match(preflightCall().stdout, /fail: operation locked: .*live holder .*do not remove/);
    fs.unlinkSync(collectionLock);

    const collectWrite = { id: `preflight-collect:${head}:1`, operation: "preflight-collect", target: head, payload: { request: collectionRequest } };
    collectionRequest.collectionId = collectWrite.id; preflight.collectionId = collectWrite.id;
    const codeReport = publishCollection({ ...baseRequest, issue: "MONO-998", stage: "mono-deliver", attempt: 1,
      phase: "code", sequence: 1, kind: "phase", head, linear_mutations_pending: [],
      capsule: { phase: "code", head, decisions: [], writable_roots: [repo, mailbox], open_queue: [] } }, path.join(state, "reports/MONO-998-phase-code.json"));
    await confirmCollection(codeReport, state, () => { throw new Error("empty code queue"); });
    const collectionReport = publishCollection({ ...baseRequest, issue: "MONO-998", stage: "mono-deliver", attempt: 1,
      phase: "preflight", sequence: 1, kind: "confirmation-request", head, linear_mutations_pending: [collectWrite],
      capsule: { phase: "preflight", head, decisions: [], writable_roots: [repo, mailbox], open_queue: [collectWrite] } }, path.join(state, "reports/MONO-998-phase-preflight.json"));
    const collectionEvidence = new Map(); let collectionRuns = 0;
    const collectionAdapter = async (action, write) => {
      assert.equal(write.operation, "preflight-collect"); assert.equal(write.target, head);
      if (action === "apply") {
        writeFileRequest(write.payload.request);
        const answer = pass(preflightCall()).stdout.trim();
        const sealed = json(path.join(preflight.evidenceRoot, `${head}.json`));
        collectionRuns++; collectionEvidence.set(write.id, { receipt: path.join(preflight.evidenceRoot, "history", `${sealed.receipt.runId}.json`), receiptDigest: receiptDigest(sealed), gate: answer });
      }
      return collectionEvidence.has(write.id) ? { state: "present", evidence: collectionEvidence.get(write.id) } : { state: "missing" };
    };
    const firstConfirmation = await confirmCollection(collectionReport, state, collectionAdapter);
    const mutableConfirmation = structuredClone(firstConfirmation);
    mutableConfirmation.results[0].evidence.receipt = path.join(preflight.evidenceRoot, `${head}.json`);
    assert.throws(() => validateCollectionConfirmation(collectionReport, mutableConfirmation), /immutable receipt/);
    const wrongDigest = structuredClone(firstConfirmation); wrongDigest.results[0].evidence.receiptDigest = "0".repeat(64);
    assert.throws(() => validateCollectionConfirmation(collectionReport, wrongDigest), /immutable receipt/);
    function writeFileRequest(request) { write(gateRequest, request); }
    write(gateRequest, preflight); pass(preflightCall());
    const receiptFile = path.join(preflight.evidenceRoot, `${head}.json`), envelope = json(receiptFile);
    assert.equal(envelope.receipt.review.sandbox.probed, true);
    assert.deepEqual(envelope.receipt.review.usage.normalized, { input: 10, cacheRead: 20, cacheWrite: 30, output: 4 });
    assert.equal(envelope.receipt.review.usageReason, null);
    const usageTampered = structuredClone(envelope); usageTampered.receipt.review.usage.normalized.input = 11;
    write(receiptFile, usageTampered); write(gateRequest, preflight);
    assert.match(preflightCall().stdout, /hand-made or modified/, "usage is sealed before signing");
    write(receiptFile, envelope); pass(preflightCall());
    assert.equal(envelope.receipt.route.engine, 'claude');
    assert.equal(envelope.receipt.route.provider.id, 'anthropic');
    assert.match(envelope.receipt.route.fingerprint, /^[a-f0-9]{64}$/);
    const legacy = structuredClone(envelope.receipt);
    legacy.route = { model: legacy.route.model, effort: legacy.route.effort };
    legacy.invocation = legacy.invocation.filter(arg => arg !== "--stream-engine-output");
    delete legacy.review.usage; delete legacy.review.usageReason;
    write(receiptFile, { receipt: legacy, signature: crypto.createHmac("sha256", fs.readFileSync(path.join(preflight.evidenceRoot, "receipt.key"))).update(canonical(legacy)).digest("hex") });
    pass(preflightCall());
    const defaultModelRoutes = resolveModelRoutes(repo, head, 'worker-default');
    write(gateRequest, { ...preflight, modelRoutes: defaultModelRoutes });
    pass(preflightCall());
    const wrongDefaultPins = structuredClone(defaultModelRoutes);
    wrongDefaultPins.roles.autoreview.fingerprint = '0'.repeat(64);
    write(gateRequest, { ...preflight, modelRoutes: wrongDefaultPins });
    assert.match(preflightCall().stdout, /model route fingerprint mismatch/);
    legacy.modelRoutes = defaultModelRoutes;
    write(receiptFile, { receipt: legacy, signature: crypto.createHmac("sha256", fs.readFileSync(path.join(preflight.evidenceRoot, "receipt.key"))).update(canonical(legacy)).digest("hex") });
    write(gateRequest, { ...preflight, modelRoutes: defaultModelRoutes }); pass(preflightCall());
    delete legacy.modelRoutes;
    write(gateRequest, { ...preflight, collect: true }); pass(preflightCall());
    const recollected = json(receiptFile).receipt;
    assert.equal(recollected.route.engine, 'claude');
    assert.equal(recollected.route.provider.id, 'anthropic');
    assert.match(recollected.route.fingerprint, /^[a-f0-9]{64}$/);
    write(gateRequest, preflight); pass(preflightCall());
    legacy.invocation.push("--unsupported");
    write(receiptFile, { receipt: legacy, signature: crypto.createHmac("sha256", fs.readFileSync(path.join(preflight.evidenceRoot, "receipt.key"))).update(canonical(legacy)).digest("hex") });
    assert.match(preflightCall().stdout, /provenance\/command mismatch/);
    write(receiptFile, envelope);

    assert.equal(fs.existsSync(envelope.receipt.verification.sandbox.tempRoot), false);
    assert.equal(fs.existsSync(envelope.receipt.review.sandbox.tempRoot), false);
    assert.equal(envelope.receipt.invocation[envelope.receipt.invocation.indexOf("--base") + 1], head);
    const datasetFile = path.join(preflight.evidenceRoot, "datasets", "MONO-998-review-scope.md");
    const datasetText = "Orchestrator-owned fixture scope decisions.\n";
    write(path.join(repo, ".git/info/exclude"), ".orchestrator/\n");
    write(datasetFile, datasetText);
    const datasetRequest = { ...preflight, reviewDataset: datasetFile };
    env.GIT_MONO_FIXTURE = "must not reach helper";
    write(gateRequest, { ...datasetRequest, collect: true }); pass(preflightCall());
    delete env.GIT_MONO_FIXTURE;
    const datasetEnvelope = json(receiptFile), datasetReceipt = datasetEnvelope.receipt;
    assert.equal(validateCollectionConfirmation(collectionReport, firstConfirmation), true, "later collection does not change earlier confirmation identity");
    const datasetDigest = crypto.createHash("sha256").update(datasetText).digest("hex");
    const datasetCopy = `.orchestrator/review-dataset-${datasetDigest.slice(0, 8)}.md`;
    assert.deepEqual(datasetReceipt.reviewDataset, { source: datasetFile, digest: datasetDigest, copy: datasetCopy, version: 1, archive: path.join(fs.realpathSync(preflight.evidenceRoot), "datasets", "MONO-998-review-scope.v1.md") });
    assert.deepEqual(datasetReceipt.invocation.slice(-3), ["--dataset", datasetCopy, "--stream-engine-output"]);
    assert.deepEqual(datasetReceipt.review.json.fixture.dataset, { path: datasetCopy, content: datasetText });
    assert.equal(fs.existsSync(path.join(repo, datasetCopy)), false, "collector removes the helper copy");
    assert.equal(fs.readFileSync(datasetFile, "utf8"), datasetText, "orchestrator source is unchanged");
    assert.deepEqual(datasetReceipt.review.json.fixture.gitEnv, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1", GIT_GRAFT_FILE: "/dev/null", GIT_MONO_FIXTURE: null });
    assert.equal(datasetReceipt.review.json.fixture.home, env.HOME);
    assert.equal(datasetReceipt.review.json.fixture.path, env.PATH);
    assert.equal(datasetReceipt.evidenceRoot, fs.realpathSync(preflight.evidenceRoot));
    write(gateRequest, datasetRequest); pass(preflightCall());
    const datasetEvidenceAlias = path.join(root, "dataset-evidence-alias");
    fs.symlinkSync(preflight.evidenceRoot, datasetEvidenceAlias, "dir");
    write(gateRequest, { ...datasetRequest, evidenceRoot: datasetEvidenceAlias }); pass(preflightCall());
    write(gateRequest, { ...datasetRequest, evidenceRoot: fs.realpathSync(preflight.evidenceRoot) }); pass(preflightCall());

    write(gateRequest, preflight); assert.match(preflightCall().stdout, /receipt reviewDataset differs/);
    const otherDataset = path.join(preflight.evidenceRoot, "datasets", "other.md"); write(otherDataset, datasetText);
    write(gateRequest, { ...datasetRequest, reviewDataset: otherDataset });
    assert.match(preflightCall().stdout, /receipt reviewDataset differs/);
    write(datasetFile, datasetText + "Changed decision.\n"); write(gateRequest, datasetRequest);
    assert.match(preflightCall().stdout, /receipt reviewDataset differs/);
    write(datasetFile, datasetText); pass(preflightCall());
    env.MONO_FIXTURE_ALTER_DATASET = "1";
    write(gateRequest, { ...datasetRequest, collect: true });
    assert.match(preflightCall().stdout, /collection consistency failed/);
    assert.equal(json(receiptFile).receipt.consistency.error, "review dataset copy digest differs from source");
    assert.equal(fs.existsSync(path.join(repo, datasetCopy)), false, "failed copy verification still cleans up");
    delete env.MONO_FIXTURE_ALTER_DATASET;
    env.MONO_FIXTURE_REVIEW_FINDINGS = "1";
    assert.equal(preflightCall().stdout.trim(), "gate preflight: fail: autoreview failed or incomplete");
    assert.equal(fs.existsSync(path.join(repo, datasetCopy)), false, "review findings still clean up the copy");
    delete env.MONO_FIXTURE_REVIEW_FINDINGS;
    write(receiptFile, datasetEnvelope); write(gateRequest, datasetRequest); pass(preflightCall());
    const outsideDataset = path.join(root, "outside.md"); write(outsideDataset, datasetText);
    const aliasDataset = path.join(preflight.evidenceRoot, "datasets", "alias.md"); fs.symlinkSync(outsideDataset, aliasDataset);
    for (const collect of [true, false]) {
      for (const reviewDataset of ["relative.md", outsideDataset, aliasDataset]) {
        write(gateRequest, { ...datasetRequest, reviewDataset, collect });
        assert.match(preflightCall().stdout, /reviewDataset must be (an absolute path under|under) evidenceRoot/);
      }
    }
    write(receiptFile, envelope); write(gateRequest, preflight); pass(preflightCall());
    // Request pins describe the worker boundary; they never become collector grants.
    const broadRequest = { ...preflight, collect: true, workerWritableRoots: [repo, state, path.join(state, "confirmations")] };
    write(gateRequest, broadRequest); pass(preflightCall());
    const narrow = json(receiptFile).receipt;
    for (const command of [narrow.verification, narrow.review]) {
      const profile = command.sandbox.args.find(arg => arg.startsWith("permissions.mono-collector="));
      const grants = [...profile.matchAll(/("[^"]+")="write"/g)].map(match => JSON.parse(match[1]));
      assert.deepEqual(grants.sort(), [fs.realpathSync(repo), command.sandbox.tempRoot].map(p => fs.realpathSync(path.dirname(p)) + path.sep + path.basename(p)).sort());
      assert.ok(!grants.some(grant => grant === state || grant.startsWith(state + path.sep)));
    }
    for (const flag of ["--json-output", "--status-output"]) {
      assert.equal(path.dirname(narrow.review.args[narrow.review.args.indexOf(flag) + 1]), narrow.review.sandbox.tempRoot);
    }
    write(gateRequest, { ...broadRequest, collect: false }); pass(preflightCall());
    env.MONO_FIXTURE_REVIEW_FINDINGS = "1";
    write(gateRequest, { ...preflight, collect: true });
    const findingResult = preflightCall();
    assert.equal(findingResult.status, 1);
    assert.equal(findingResult.stdout.trim(), "gate preflight: fail: autoreview failed or incomplete");
    const failedReview = json(receiptFile).receipt;
    assert.equal(failedReview.review.exitCode, 1);
    assert.equal(failedReview.review.sandbox.probed, true);
    assert.equal(failedReview.loop.residualFindings[0].priority, "P2");
    delete env.MONO_FIXTURE_REVIEW_FINDINGS;
    write(gateRequest, preflight);
    assert.equal(preflightCall().stdout.trim(), "gate preflight: fail: autoreview failed or incomplete");
    write(receiptFile, envelope);
    const tree = pass(run("git", ["rev-parse", "HEAD^{tree}"], repo, env)).stdout.trim();
    const alternate = pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit-tree", tree, "-m", "alternate"], repo, env)).stdout.trim();
    const baseRef = "refs/heads/review-base";
    pass(run("git", ["update-ref", baseRef, head], repo, env));
    const changedBase = { ...preflight, baseRef, collectionId: `preflight-collect:${head}:3`, verification: {
      command: "git", args: ["update-ref", baseRef, alternate] } };
    write(gateRequest, { ...changedBase, collect: true });
    assert.match(preflightCall().stdout, /collection consistency failed/);
    assert.equal(json(receiptFile).receipt.consistency.passed, false);
    assert.equal(json(receiptFile).receipt.review.json, null);
    pass(run("git", ["update-ref", baseRef, head], repo, env));
    write(gateRequest, changedBase);
    assert.match(preflightCall().stdout, /collection consistency failed/);
    write(receiptFile, envelope); write(gateRequest, preflight);
    write(receiptFile, { receipt: envelope.receipt, signature: "hand-made" });
    assert.match(preflightCall().stdout, /hand-made or modified/); write(receiptFile, envelope);
    env.MONO_FIXTURE_OPEN_SANDBOX = "1";
    write(gateRequest, { ...preflight, collect: true });
    assert.match(preflightCall().stdout, /fail: local verification failed/);
    assert.match(json(receiptFile).receipt.verification.output, /sandbox permits evidence writes/);
    assert.equal(json(receiptFile).receipt.verification.sandbox.probed, false);
    assert.equal(json(receiptFile).receipt.review.json, null);
    delete env.MONO_FIXTURE_OPEN_SANDBOX;
    const retry = { ...preflight, collectionId: `preflight-collect:${head}:2` };
    write(gateRequest, retry);
    assert.match(preflightCall().stdout, /receipt collectionId differs/);
    const retryWrite = { ...collectWrite, id: retry.collectionId, payload: { request: { ...retry, collect: true } } };
    const retryReport = publishCollection({ ...collectionReport, sequence: 2, linear_mutations_pending: [retryWrite],
      capsule: { ...collectionReport.capsule, open_queue: [retryWrite] } }, path.join(state, "reports/MONO-998-phase-preflight.json"));
    await confirmCollection(retryReport, state, collectionAdapter);
    await confirmCollection(retryReport, state, collectionAdapter);
    assert.equal(collectionRuns, 2);
    assert.equal(validateCollectionConfirmation(collectionReport, firstConfirmation), true);
    const wrongRun = structuredClone(firstConfirmation); wrongRun.results[0].evidence = collectionEvidence.get(retry.collectionId);
    assert.throws(() => validateCollectionConfirmation(collectionReport, wrongRun), /immutable receipt/);
    write(gateRequest, retry); pass(preflightCall());
    assert.equal(json(receiptFile).receipt.head, head);
    write(receiptFile, envelope);
    for (const nested of ["receipt.key", "history", `${head}.json`]) {
      for (const collect of [true, false]) {
        write(gateRequest, { ...preflight, collect, workerWritableRoots: [...preflight.workerWritableRoots, path.join(preflight.evidenceRoot, nested)] });
        assert.match(preflightCall().stdout, /evidenceRoot must be outside/);
      }
    }
    const linkedDir = path.join(repo, ".git", "linked-helper"), linkedHelper = path.join(linkedDir, "autoreview");
    write(linkedHelper, fs.readFileSync(helper, "utf8")); fs.chmodSync(linkedHelper, 0o700);
    fs.unlinkSync(helper); fs.symlinkSync(linkedHelper, helper);
    write(gateRequest, { ...preflight, collect: true, workerWritableRoots: [...preflight.workerWritableRoots, linkedDir] });
    assert.match(preflightCall().stdout, /autoreview helper real path must be outside/);
    fs.unlinkSync(helper); fs.copyFileSync(linkedHelper, helper); fs.chmodSync(helper, 0o700);
    const filter = path.join(root, "clean-filter"), filterMarker = path.join(root, "filter-ran");
    write(filter, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(filterMarker)},'unsafe');process.stdout.write(fs.readFileSync(0));`);
    fs.chmodSync(filter, 0o700);
    pass(run("git", ["config", "filter.unsafe.clean", filter], repo, env));
    write(path.join(repo, ".git/info/attributes"), "tracked.txt filter=unsafe\n");
    fs.utimesSync(path.join(repo, "tracked.txt"), new Date(), new Date(Date.now() + 10_000));
    write(gateRequest, baseRequest);
    assert.match(run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", gateRequest], root, env).stdout, /repository Git filters require/);
    write(gateRequest, { ...preflight, collect: true });
    assert.match(preflightCall().stdout, /repository Git filters require/);
    assert.equal(fs.existsSync(filterMarker), false);
    pass(run("git", ["config", "--unset", "filter.unsafe.clean"], repo, env));
    fs.unlinkSync(path.join(repo, ".git/info/attributes"));
    const attack = path.join(preflight.evidenceRoot, "untrusted-proof");
    write(gateRequest, { ...preflight, collect: true, verification: { command: process.execPath,
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(attack)},'forged')`] } });
    assert.match(preflightCall().stdout, /fail: local verification failed/);
    assert.equal(fs.existsSync(attack), false);
    assert.equal(json(receiptFile).receipt.verification.sandbox.probed, true);
    write(receiptFile, envelope); write(gateRequest, preflight); pass(preflightCall());
    const sealed = structuredClone(envelope); sealed.receipt.route.effort = "low"; write(receiptFile, sealed);
    assert.equal(preflightCall().status, 1, "tampered route refused"); write(receiptFile, envelope);
    for (const collect of [true, false]) {
      for (const extra of [{ probe: "/not-the-evidence-root" }, { exitCode: 0 }, { args: [42] }]) {
        write(gateRequest, { ...preflight, collect, verification: { ...preflight.verification, ...extra } });
        assert.match(preflightCall().stdout, /fail: verification must contain only command and string-array args/);
      }
    }
    assert.equal(fs.existsSync(monitorMarker), false);
    pass(run("git", ["config", "--unset", "core.fsmonitor"], repo, env));
    for (const [field, value] of [["skillsRoot", path.join(root, "other-skills")], ["risk", "standard"], ["critical", "different escalation"], ["verification", { command: process.execPath, args: ["-e", "process.exit(1)"] }]]) {
      write(gateRequest, { ...preflight, [field]: value });
      assert.match(preflightCall().stdout, new RegExp(`fail: receipt ${field} differs`));
    }
    for (const parent of [repo, mailbox]) {
      const planted = path.join(parent, "planted-proof"); fs.mkdirSync(planted);
      fs.copyFileSync(receiptFile, path.join(planted, `${head}.json`));
      fs.copyFileSync(path.join(preflight.evidenceRoot, "receipt.key"), path.join(planted, "receipt.key"));
      for (const collect of [false, true]) {
        write(gateRequest, { ...preflight, evidenceRoot: planted, collect });
        assert.match(preflightCall().stdout, /fail: evidenceRoot must be outside/);
      }
      fs.rmSync(planted, { recursive: true });
    }
    const writable = path.join(root, "worker-extra"); fs.mkdirSync(writable);
    write(gateRequest, { ...preflight, evidenceRoot: writable, workerWritableRoots: [repo, mailbox, writable] });
    assert.match(preflightCall().stdout, /fail: evidenceRoot must be outside/);
    const alias = path.join(root, "evidence-alias"); fs.symlinkSync(state, alias);
    write(gateRequest, { ...preflight, evidenceRoot: alias });
    assert.match(preflightCall().stdout, /fail: evidenceRoot must be outside/);
    write(gateRequest, preflight); pass(preflightCall());


    const github = { headRefOid: head, state: "OPEN", mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", baseRefName: "main", baseRefOid: head, baseRef: { branchProtectionRule: null } };
    const checks = [
      { __typename: "CheckRun", name: "validate", status: "COMPLETED", conclusion: "SUCCESS", checkSuite: { commit: { oid: head } } },
      { __typename: "StatusContext", context: "Devin Review", state: "SUCCESS", createdAt: "2026-09-14T20:17:00Z" },
      { __typename: "CheckRun", name: "Greptile Review", status: "COMPLETED", conclusion: "SUCCESS", checkSuite: { commit: { oid: head } } },
    ];
    const githubFile = path.join(root, "github.json"); write(githubFile, { github, checks });
    write(path.join(bin, "gh"), `#!/usr/bin/env node
const fs=require('node:fs');const a=process.argv.slice(2);const data=JSON.parse(fs.readFileSync(${JSON.stringify(githubFile)},'utf8'));
const connection=nodes=>({nodes,pageInfo:{hasNextPage:false,endCursor:null}});const q=a.find(v=>v.startsWith('query='))||'';let result;
if(a.includes('user'))result={login:'worker'};
else if(a.includes('--slurp'))result=[[]];
else if(a.some(v=>v.includes('/rules/branches/'))){
if(a.some(v=>v.includes('%2F'))){console.error('branch slash must remain a path separator');process.exit(1);}
if(data.rulesStatus){
const status=data.rulesStatus;
if(data.rulesFailuresLeft>0){data.rulesFailuresLeft--;if(!data.rulesFailuresLeft)delete data.rulesStatus;fs.writeFileSync(${JSON.stringify(githubFile)},JSON.stringify(data));}
console.log(JSON.stringify({status:String(status),message:'fixture rules unavailable'}));console.error('gh: fixture rules unavailable (HTTP '+status+')');process.exit(1);
}
result=[];
}
else if(q.includes('statusCheckRollup')){
let checks=data.checks;
if(data.pendingReads>0){
checks=data.pendingMode==='unknown-green'?checks:['empty','unknown'].includes(data.pendingMode)?[]:checks.map(c=>c.name==='validate'?{...c,status:'IN_PROGRESS',conclusion:null}:c);
data.pendingReads--;data.pendingMerge=data.pendingMode==='blocked'?'BLOCKED':data.pendingMode==='unstable'?'UNSTABLE':['unknown','unknown-green'].includes(data.pendingMode)?'UNKNOWN':null;fs.writeFileSync(${JSON.stringify(githubFile)},JSON.stringify(data));
}
result={data:{repository:{object:{statusCheckRollup:{contexts:connection(checks)}}}}};
}
else if(q.includes('reviewThreads'))result={data:{repository:{pullRequest:{reviewThreads:connection([])}}}};
else {
let pr=data.pendingMerge?{...data.github,mergeStateStatus:data.pendingMerge,mergeable:data.pendingMerge==='UNKNOWN'?'UNKNOWN':data.github.mergeable}:data.github;
if(data.pendingReads===0&&data.pendingMerge){delete data.pendingMerge;fs.writeFileSync(${JSON.stringify(githubFile)},JSON.stringify(data));}
result={data:{repository:{pullRequest:pr}}};
}
console.log(JSON.stringify(result));
`); fs.chmodSync(path.join(bin, "gh"), 0o700);
    const judgmentFile = path.join(root, "judgment.json"), config = path.join(root, "config.json");
    write(judgmentFile, { head, preShipReview: "выполнено", readinessCheck: "пройдена", documentation: "без изменений", closures: [], botRemarks: [] });
    write(config, { orchestration: { delivery: { quietSec: 0.01, pollSec: 0.01, evidenceLimitSec: 30 } } });
    const shipRequest = { preflight, repo: "fixture/repo", number: 87, attempt: 1, stateFile: path.join(root, "ship-state.json"), judgmentFile, config, watch: true };
    write(gateRequest, shipRequest);
    const shipCall = () => run(process.execPath, [path.join(runtime, "gate.mjs"), "ship", "--request", gateRequest], root, env);
    // Exercise proof failures before even opening the worker judgment file.
    const proofRequest = { ...shipRequest, judgmentFile: path.join(root, "absent-judgment.json") };
    write(gateRequest, { ...proofRequest, preflight: undefined });
    assert.match(shipCall().stdout, /fail: ship requires preflight collect:false/);
    write(gateRequest, { ...proofRequest, preflight: { ...preflight, collect: true } });
    assert.match(shipCall().stdout, /fail: ship requires preflight collect:false/);
    write(gateRequest, proofRequest);
    fs.unlinkSync(receiptFile);
    assert.match(shipCall().stdout, /fail: .*ENOENT.*\.json/);
    write(receiptFile, envelope);
    write(githubFile, { github: { ...github, headRefOid: alternate }, checks });
    assert.match(shipCall().stdout, /fail: preflight request does not match live PR head/);
    write(githubFile, { github: { ...github, baseRefOid: alternate }, checks });
    assert.equal(shipCall().status, 1, "unrelated base history refuses");
    write(githubFile, { github, checks });
    // The fixture collector owns its key; seal invalid outputs to test semantic validation too.
    const saveFixtureReceipt = receipt => write(receiptFile, { receipt,
      signature: crypto.createHmac("sha256", fs.readFileSync(path.join(preflight.evidenceRoot, "receipt.key"))).update(canonical(receipt)).digest("hex") });
    for (const [change, reason] of [
      [r => { r.head = alternate; }, /missing or stale autoreview artifact\/head\/base/],
      [r => { r.base = alternate; }, /missing or stale autoreview artifact\/head\/base/],
      [r => { r.route.effort = "low"; }, /wrong policy route/],
      [r => { r.review.exitCode = 1; }, /autoreview failed or incomplete/],
    ]) {
      const invalid = structuredClone(envelope.receipt); change(invalid); saveFixtureReceipt(invalid);
      assert.match(shipCall().stdout, reason);
    }
    write(receiptFile, { receipt: envelope.receipt, signature: "worker-asserted" });
    assert.match(shipCall().stdout, /hand-made or modified autoreview artifact/);
    write(receiptFile, envelope);
    write(gateRequest, shipRequest);
    const greenShip = pass(shipCall());
    assert.match(greenShip.stdout, /^gate ship: pass:/);
    assert.ok(greenShip.stdout.includes(`preflight receipt: ${fs.realpathSync(receiptFile)}`));
    assert.equal(json(shipRequest.stateFile).preflightReceipt.path, fs.realpathSync(receiptFile));
    assert.equal(json(shipRequest.stateFile).preflightReceipt.runId, envelope.receipt.runId);

    for (const status of [403, 404]) {
      const unavailable = { ...shipRequest, stateFile: path.join(root, `rules-${status}.json`) };
      write(gateRequest, unavailable);
      write(githubFile, { github: { ...github, baseRefName: "release/stable" }, checks, rulesStatus: status });
      assert.match(pass(shipCall()).stdout, /^gate ship: pass:/);
      assert.deepEqual(json(unavailable.stateFile).rules, { available: false, reason: `rules unavailable on this plan/visibility (HTTP ${status})` });
      write(gateRequest, { ...unavailable, watch: false, policy: { requiredChecks: ["required-missing"] } });
      assert.match(shipCall().stdout, /required check required-missing absent or pending/);
    }
    for (const status of [401, 500]) {
      const unavailable = { ...shipRequest, stateFile: path.join(root, `rules-refuse-${status}.json`), watch: false };
      write(gateRequest, unavailable); write(githubFile, { github, checks, rulesStatus: status });
      assert.ok(shipCall().stdout.includes(`gate ship: fail: GitHub read unavailable (HTTP ${status})`));
      write(gateRequest, { ...unavailable, stateFile: path.join(root, `rules-recover-${status}.json`), watch: true });
      write(githubFile, { github, checks, rulesStatus: status, rulesFailuresLeft: 1 });
      assert.match(pass(shipCall()).stdout, /^gate ship: pass:/);
    }
    const errorConfig = path.join(root, "rules-timeout-config.json");
    write(errorConfig, { orchestration: { delivery: { quietSec: 0.01, pollSec: 0.01, evidenceLimitSec: 1 } } });
    const errorState = path.join(root, "rules-timeout.json");
    write(gateRequest, { ...shipRequest, config: errorConfig, stateFile: errorState });
    write(githubFile, { github, checks, rulesStatus: 500 });
    assert.match(shipCall().stdout, /gate ship: fail: evidence-limit/);
    assert.match(json(errorState).pendingReason, /HTTP 500/);
    write(githubFile, { github, checks });
    // A remote base can advance without changing the reviewed diff or PR head.
    const remoteRepo = path.join(root, "base-remote.git");
    pass(run("git", ["init", "--bare", remoteRepo], root, env));
    pass(run("git", ["remote", "add", "origin", remoteRepo], repo, env));
    pass(run("git", ["push", "origin", `${head}:refs/heads/main`], repo, env));
    const remotePreflight = { ...preflight, baseRef: "origin/main" };
    // Fetch needs the trusted global rewrite; reads must keep executable config disabled.
    const rewriteConfig = path.join(root, "fetch-global-config"), rewriteURL = "mono-fixture://base";
    write(rewriteConfig, `[url "${remoteRepo}"]\n  insteadOf = ${rewriteURL}\n[core]\n  fsmonitor = ${JSON.stringify(fsmonitor)}\n`);
    pass(run("git", ["remote", "set-url", "origin", rewriteURL], repo, env));
    const fetchEnv = { ...env, GIT_CONFIG_GLOBAL: rewriteConfig };
    pass(run("git", ["-c", "core.fsmonitor=false", "config", "core.fsmonitor", fsmonitor], repo, env));
    write(gateRequest, remotePreflight);
    const credentialedPreflight = collect => {
      write(gateRequest, { ...remotePreflight, collect });
      return run(process.execPath, [path.join(runtime, "gate.mjs"), "preflight", "--request", gateRequest], root, fetchEnv);
    };
    pass(credentialedPreflight(false));
    pass(credentialedPreflight(true));
    assert.equal(json(receiptFile).receipt.review.json.fixture.gitEnv.GIT_CONFIG_GLOBAL, "/dev/null");
    assert.equal(fs.existsSync(monitorMarker), false, "global and local fsmonitor remain disabled for reads/fetch");
    pass(run("git", ["-c", "core.fsmonitor=false", "config", "--unset", "core.fsmonitor"], repo, env));
    write(receiptFile, envelope);
    write(gateRequest, remotePreflight);
    assert.match(preflightCall().stdout, /gate preflight: fail: base fetch failed/);
    const failedFetch = { ...shipRequest, preflight: remotePreflight, stateFile: path.join(root, "fetch-refusal.json"), watch: false };
    write(gateRequest, failedFetch);
    assert.match(shipCall().stdout, /gate ship: fail: base fetch failed/);
    const fetchWait = { ...failedFetch, config: errorConfig, stateFile: path.join(root, "fetch-pending.json"), watch: true };
    write(gateRequest, fetchWait);
    assert.match(shipCall().stdout, /gate ship: fail: evidence-limit/);
    assert.match(json(fetchWait.stateFile).pendingReason, /base fetch failed/);
    pass(run("git", ["remote", "set-url", "origin", remoteRepo], repo, env));

    const advanced = pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
      "commit-tree", tree, "-p", head, "-m", "base advanced"], repo, env)).stdout.trim();
    pass(run("git", ["push", "origin", `${advanced}:refs/heads/main`], repo, env));
    assert.equal(pass(run("git", ["rev-parse", "origin/main"], repo, env)).stdout.trim(), advanced);
    pass(run("git", ["update-ref", "refs/remotes/origin/main", head], repo, env)); // Simulate a stale tracking ref.
    write(gateRequest, remotePreflight); pass(preflightCall());
    assert.equal(pass(run("git", ["rev-parse", "origin/main"], repo, env)).stdout.trim(), advanced, "collect:false refreshes the remote base");
    write(githubFile, { github: { ...github, baseRefOid: advanced }, checks });
    write(gateRequest, { ...shipRequest, preflight: remotePreflight, stateFile: path.join(root, "advanced-base.json") });
    assert.match(pass(shipCall()).stdout, /^gate ship: pass:/);
    // A captured base may no longer be reachable from the ref fetched after a force-push.
    const captured = pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
      "commit-tree", tree, "-p", advanced, "-m", "captured before force-push"], remoteRepo, env)).stdout.trim();
    assert.notEqual(run("git", ["cat-file", "-e", captured], repo, env).status, 0);
    write(githubFile, { github: { ...github, baseRefOid: captured }, checks });
    write(gateRequest, { ...shipRequest, preflight: remotePreflight, stateFile: path.join(root, "captured-base.json") });
    assert.match(pass(shipCall()).stdout, /^gate ship: pass:/);
    pass(run("git", ["cat-file", "-e", captured], repo, env));
    write(githubFile, { github: { ...github, baseRefOid: advanced }, checks });
    write(gateRequest, { ...remotePreflight, collect: true }); pass(preflightCall());
    assert.equal(json(receiptFile).receipt.base, head, "collector records merge-base, not advanced tip");
    assert.equal(json(receiptFile).receipt.invocation[3], head, "helper reviews the same immutable diff base");
    write(receiptFile, envelope);
    const rebased = pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
      "commit-tree", tree, "-p", advanced, "-m", "rebased head"], repo, env)).stdout.trim();
    pass(run("git", ["update-ref", "refs/heads/delivery", rebased], repo, env));
    write(githubFile, { github: { ...github, headRefOid: rebased, baseRefOid: advanced }, checks });
    write(gateRequest, { ...shipRequest, preflight: { ...remotePreflight, head: rebased, collectionId: `preflight-collect:${rebased}:1` },
      stateFile: path.join(root, "rebased-head.json") });
    assert.match(shipCall().stdout, /fail: .*ENOENT.*\.json/, "new head has no receipt");
    pass(run("git", ["update-ref", "refs/heads/delivery", head], repo, env));
    write(githubFile, { github, checks });
    const oneShotState = path.join(root, "one-shot-checks.json");
    write(gateRequest, { ...shipRequest, watch: false, stateFile: oneShotState });
    write(githubFile, { github, checks: [] });
    assert.match(shipCall().stdout, /fail: checks not created/);
    write(githubFile, { github: { ...github, mergeStateStatus: "UNKNOWN" }, checks });
    assert.match(shipCall().stdout, /fail: mergeability pending/);
    write(githubFile, { github, checks });
    const clock = json(oneShotState); clock.startedAt = Date.now() - 31_000; write(oneShotState, clock);
    assert.match(shipCall().stdout, /fail: evidence-limit:/);

    const nonBlocking = { ...shipRequest, stateFile: path.join(root, "accepted-red.json"),
      policy: { nonBlockingChecks: [{ name: "validate", reason: "repository accepts this optional check" }] } };
    write(githubFile, { github: { ...github, mergeStateStatus: "UNSTABLE" }, checks: checks.map(c => c.name === "validate" ? { ...c, conclusion: "FAILURE" } : c) });
    write(gateRequest, nonBlocking);
    assert.match(pass(shipCall()).stdout, /^gate ship: pass:/);
    write(gateRequest, { ...shipRequest, stateFile: path.join(root, "unaccepted-red.json") });
    assert.match(shipCall().stdout, /gate ship: fail: check validate not green/);
    write(gateRequest, { ...shipRequest, stateFile: path.join(root, "blocked-green.json") });
    write(githubFile, { github: { ...github, mergeStateStatus: "BLOCKED" }, checks });
    assert.match(shipCall().stdout, /gate ship: fail: merge state is not clean/);
    for (const pendingMode of ["empty", "check", "unstable", "unknown", "unknown-green", "blocked"]) {
      write(gateRequest, { ...shipRequest, stateFile: path.join(root, `wait-${pendingMode}.json`) });
      write(githubFile, { github, checks, pendingMode, pendingReads: 1 });
      assert.match(pass(shipCall()).stdout, /^gate ship: pass:/);
      assert.equal(json(githubFile).pendingReads, 0);
    }
    write(config, { orchestration: { delivery: { quietSec: 0.01, pollSec: 0.01, evidenceLimitSec: 1 } } });
    for (const state of ["BLOCKED", "UNKNOWN"]) {
      const pendingChecks = state === "UNKNOWN" ? [] : checks.map(c => c.name === "validate" ? { ...c, status: "IN_PROGRESS", conclusion: null } : c);
      write(githubFile, { github: { ...github, mergeStateStatus: state, mergeable: state === "UNKNOWN" ? "UNKNOWN" : "MERGEABLE" }, checks: pendingChecks });
      const waiting = { ...shipRequest, policy: { requiredChecks: ["validate"] }, stateFile: path.join(root, `one-shot-${state}.json`), watch: false };
      write(gateRequest, waiting);
      const oneShot = shipCall(); assert.equal(oneShot.status, 1);
      assert.match(oneShot.stdout, /gate ship: fail: (check validate pending on head|checks not created on head)/);
      write(gateRequest, { ...waiting, stateFile: path.join(root, `wait-deadline-${state}.json`), watch: true });
      assert.match(shipCall().stdout, /fail: evidence-limit:/);
    }
    for (const unknown of [{ mergeable: "UNKNOWN" }, { mergeStateStatus: "UNKNOWN" }]) {
      const waiting = { ...shipRequest, stateFile: path.join(root, `complete-${Object.keys(unknown)[0]}.json`), watch: false };
      write(githubFile, { github: { ...github, ...unknown }, checks });
      write(gateRequest, waiting);
      assert.match(shipCall().stdout, /gate ship: fail: mergeability pending/);
      write(gateRequest, { ...waiting, watch: true });
      assert.match(shipCall().stdout, /gate ship: fail: evidence-limit/);
    }
    write(gateRequest, { ...shipRequest, stateFile: path.join(root, "wait-red.json") });
    write(githubFile, { github, checks: checks.map(c => c.name === "validate" ? { ...c, conclusion: "FAILURE" } : c) });
    assert.match(shipCall().stdout, /fail: check validate not green/);

    write(path.join(state, "control.json"), { state: "active", halt: false }); write(path.join(state, "workers.json"), {});
    const capture = path.join(root, "codex-args.json"), threadReady = path.join(root, "thread-ready");
    write(path.join(bin, "codex"), `#!/usr/bin/env node
const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));
fs.writeSync(1,JSON.stringify({type:'startup-noise',text:'x'.repeat(2*1024*1024)})+'\\n');
const wait=setInterval(()=>{if(fs.existsSync(${JSON.stringify(threadReady)})){clearInterval(wait);console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-thread'}));}},10);setInterval(()=>{},1000);
`); fs.chmodSync(path.join(bin, "codex"), 0o700);
    const dispatchFile = path.join(root, "dispatch.md"); write(dispatchFile, "fixture prompt with literal $(do-not-execute) and `backticks`");
    const request = { ...baseRequest, evidenceRoot: preflight.evidenceRoot, workerWritableRoots: [repo, mailbox, path.join(repo, ".git")], role: "worker-default", dispatchFile, writable_roots: [repo], gates: ["identity", "context"], lifecycle_moves: [] };
    process.env.PATH = env.PATH;
    const { spawnWorker, resumeWorker } = await import(pathToFileURL(path.join(runtime, "orchestrator/launch.mjs")));
    const policyFile = path.join(skills, "mono-implement/references/model-policy.md");
    const originalPolicy = fs.readFileSync(policyFile, "utf8");
    write(policyFile, originalPolicy.replace(/(\| `worker-default` \| )`[^`]+` \| `[^`]+`/, '$1`fixture-model` | `medium`'));
    await assert.rejects(spawnWorker({ ...request, writable_roots: [root], workerWritableRoots: [root, repo, mailbox] }), /evidenceRoot must be outside/);
    await assert.rejects(spawnWorker({ ...request, workerWritableRoots: [repo] }), /effective write grants differ/);
    await assert.rejects(spawnWorker({ ...request, writable_roots: [state], workerWritableRoots: [repo, mailbox, state] }), /only reports may be worker-writable/);
    const starting = spawnWorker(request);
    for (let i = 0; i < 100; i++) {
      livePid = json(path.join(state, "workers.json"))[request.issue]?.pid;
      if (livePid && !fs.existsSync(path.join(state, "launch.lock"))) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(livePid); assert.equal(fs.existsSync(path.join(state, "launch.lock")), false);
    const { withLock: shortControlLock } = await import(pathToFileURL(path.join(runtime, "runtime.mjs")));
    await shortControlLock(path.join(state, "launch.lock"), () => write(threadReady, "allow thread.started"));
    const launched = await starting; livePid = launched.pid;
    const entry = json(path.join(state, "workers.json"))[request.issue];
    assert.deepEqual(entry.capsule.writable_roots, entry.workerWritableRoots);
    assert.equal(entry.capsule.head, head);
    assert.equal(entry.modelRoutes.roles['worker-default'].model, entry.model);
    assert.match(entry.modelRoutes.roles.autoreview.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(entry.stage, "mono-deliver"); assert.equal(entry.attempt, 1);
    assert.equal(entry.model, "fixture-model"); assert.equal(entry.effort, "medium");
    const argv = json(capture); assert.ok(argv.includes(`model=${JSON.stringify(entry.model)}`));
    assert.ok(argv.includes(`model_reasoning_effort=${JSON.stringify(entry.effort)}`));
    assert.ok(argv.includes('sandbox_workspace_write.network_access=true'));
    assert.equal(argv[argv.indexOf('--add-dir') + 1], mailbox);
    assert.ok(!entry.workerWritableRoots.includes(state));
    assert.equal(argv.at(-1), fs.readFileSync(dispatchFile, "utf8"));
    assert.equal(JSON.parse(fs.readFileSync(entry.log, "utf8").split("\n")[0]).model, entry.model);
    await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile }), /still live/);
    write(path.join(state, "control.json"), { state: "active", halt: true });
    await assert.rejects(spawnWorker(request), /halt/);
    await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile }), /halt/);
    process.kill(livePid, 0);
    const watch = pass(run(process.execPath, [path.join(runtime, "watch-workers.mjs"), "--root", state, "--once"], root, env));
    assert.match(watch.stdout, /EVENT:halt/);
    write(path.join(state, "control.json"), { state: "active", halt: false });
    write(path.join(state, "reports/MONO-999-gate-ack-a1.json"), { issue: request.issue, phase: "gate", status: "gates-passed",
      gates: request.gates.map(gate => ({ gate, status: "pass", evidence: "fixture" })) });
    const { consumeAck } = await import(pathToFileURL(path.join(runtime, "orchestrator/consume-gate-ack.mjs")));
    await assert.rejects(consumeAck({ root: state, issue: request.issue, attempt: 1, outcome: "applied", readback: [] }), /resumed writer registration for this ack/);
    process.kill(livePid, "SIGTERM"); livePid = null;
    await new Promise(resolve => setTimeout(resolve, 100));
    await assert.rejects(consumeAck({ root: state, issue: request.issue, attempt: 1, outcome: "applied", readback: [] }), /resumed writer registration for this ack/);
    const ackPath = path.join(state, "reports/MONO-999-gate-ack-a1.json"), ackBytes = fs.readFileSync(ackPath);
    fs.unlinkSync(ackPath);
    const gateRecovery = await resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile }); livePid = gateRecovery.pid;
    assert.equal(json(path.join(state, "workers.json"))[request.issue].last_resume.gateAckDigest, null);
    fs.writeFileSync(ackPath, ackBytes);
    await assert.rejects(consumeAck({ root: state, issue: request.issue, attempt: 1, outcome: "applied", readback: [] }), /resumed writer registration for this ack/);
    process.kill(livePid, "SIGTERM"); livePid = null;
    await new Promise(resolve => setTimeout(resolve, 100));
    const postGate = await resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile }); livePid = postGate.pid;
    assert.equal(json(path.join(state, "workers.json"))[request.issue].last_resume.pid, livePid);
    await consumeAck({ root: state, issue: request.issue, attempt: 1, outcome: "applied", readback: [] });
    await consumeAck({ root: state, issue: request.issue, attempt: 1, outcome: "applied", readback: [] });
    assert.equal(json(path.join(state, "workers.json"))[request.issue].gates, undefined);
    assert.equal(json(path.join(state, "consumed/MONO-999-gate-ack-a1.json")).outcome, "applied");
    const { publishPhase, confirmQueue } = await import(pathToFileURL(path.join(runtime, "delivery-state.mjs")));
    const report = publishPhase({ ...baseRequest, stage: "mono-deliver", attempt: 1, phase: "code", head,
      sequence: 1, kind: "phase", linear_mutations_pending: [], capsule: { phase: "code", head, decisions: [], writable_roots: [repo, mailbox], open_queue: [] } }, path.join(state, "reports/MONO-999-phase-code.json"));
    const phaseWatch = pass(run(process.execPath, [path.join(runtime, "watch-workers.mjs"), "--root", state, "--once"], root, env));
    assert.match(phaseWatch.stdout, /EVENT:phase.*MONO-999/);
    assert.doesNotMatch(phaseWatch.stdout, /EVENT:(dead|stall)/);
    await confirmQueue(report, state, () => { throw new Error("empty queue must not invoke adapter"); });
    const preflightReport = publishPhase({ ...report, phase: "preflight", capsule: { ...report.capsule, phase: "preflight" } }, path.join(state, "reports/MONO-999-phase-preflight.json"));
    const laterPhaseWatch = pass(run(process.execPath, [path.join(runtime, "watch-workers.mjs"), "--root", state, "--once"], root, env));
    assert.match(laterPhaseWatch.stdout, /EVENT:phase.*phase preflight sequence 1/);
    assert.doesNotMatch(laterPhaseWatch.stdout, /EVENT:(dead|stall)/);
    await confirmQueue(preflightReport, state, () => { throw new Error("empty queue"); });
    publishPhase({ ...report, phase: "ship", capsule: { ...report.capsule, phase: "ship" } }, path.join(state, "reports/MONO-999-phase-ship.json"));
    const shipPhaseWatch = pass(run(process.execPath, [path.join(runtime, "watch-workers.mjs"), "--root", state, "--once"], root, env));
    assert.match(shipPhaseWatch.stdout, /EVENT:phase.*phase ship sequence 1/);
    write(policyFile, originalPolicy);
    process.kill(livePid, "SIGTERM"); livePid = null;
    await new Promise(resolve => setTimeout(resolve, 100));
    write(path.join(repo, "recovery-dirty.txt"), "preserve recovery work");
    const extra = path.join(root, "extra"); fs.mkdirSync(extra);
    await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile, extraWritable: [root], workerWritableRoots: [repo, mailbox, root] }), /evidenceRoot must be outside/);
    await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile, extraWritable: [extra] }), /effective write grants differ/);
    await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile, extraWritable: [state], workerWritableRoots: [repo, mailbox, state] }), /only reports may be worker-writable/);
    const resumed = await resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile, extraWritable: [extra], workerWritableRoots: [repo, mailbox, path.join(repo, ".git"), extra], network_access: false }); livePid = resumed.pid;
    const resumedEntry = json(path.join(state, "workers.json"))[request.issue];
    assert.deepEqual(resumedEntry.workerWritableRoots, [repo, mailbox, path.join(repo, ".git"), extra].map(p => fs.realpathSync(p)).sort());
    assert.deepEqual(resumedEntry.writable_roots, resumedEntry.workerWritableRoots);
    assert.deepEqual(resumedEntry.capsule.writable_roots, resumedEntry.workerWritableRoots);
    assert.equal(resumedEntry.network_access, false);
    await new Promise(resolve => setTimeout(resolve, 100));
    const resumedArgs = json(capture);
    assert.deepEqual(resumedArgs.slice(0, 3), ["exec", "resume", "fixture-thread"]);
    assert.ok(resumedArgs.includes(`model=${JSON.stringify(entry.model)}`));
    assert.ok(resumedArgs.includes('sandbox_workspace_write.network_access=false'));
    assert.ok(resumedArgs.includes(`model_reasoning_effort=${JSON.stringify(entry.effort)}`));
    assert.ok(!resumedArgs.includes("--sandbox") && !resumedArgs.includes("--cd") && !resumedArgs.includes("--add-dir"));
    process.kill(livePid, "SIGTERM"); livePid = null;
    assert.equal(fs.readFileSync(path.join(repo, "recovery-dirty.txt"), "utf8"), "preserve recovery work");
    write(path.join(state, "workers.json"), {});
    await assert.rejects(spawnWorker(request), /working tree is dirty/);
    assert.equal(json(path.join(state, "attempts.json"))[request.issue], 1);
    fs.unlinkSync(path.join(repo, "recovery-dirty.txt"));
    write(path.join(state, "attempts.json"), { "MONO-999": 3 });
    await assert.rejects(spawnWorker(request), /attempt cap/);
    const price = pass(run(process.execPath, [path.join(runtime, "wave-cost.mjs"), request.issue, "--root", state], root, env));
    assert.equal(JSON.parse(price.stdout.split("\nЦена волны")[0]).model.model, entry.model);
  } finally {
    process.env.PATH = oldPath;
    if (livePid) { try { process.kill(livePid, "SIGTERM"); } catch { /* already exited */ } }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function jsonFromRun(result) { return JSON.parse(result.stdout); }

test("launch and resume derive exact Git grants from the requested worktree", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mono-git-grants-")));
  const skills = path.join(root, "skills"), state = path.join(root, "state"), main = path.join(root, "main");
  const worktree = path.join(root, "linked"), mailbox = path.join(state, "reports"), bin = path.join(root, "bin");
  const common = path.join(main, ".git"), metadata = path.join(common, "worktrees/linked");
  const env = { ...process.env, MONO_WORKFLOW_STATE_ROOT: path.join(root, "install-state"), MONO_WORKFLOW_KNOWN_ROOTS: skills };
  const oldEnv = { ...process.env };
  try {
    pass(run(process.execPath, ["scripts/install-local.mjs", "--skills-root", skills], checkout, env));
    fs.mkdirSync(main); pass(run("git", ["init", "-b", "delivery"], main, env));
    pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "base"], main, env));
    const head = pass(run("git", ["rev-parse", "HEAD"], main, env)).stdout.trim();
    pass(run("git", ["worktree", "add", "-b", "linked", worktree], main, env));
    const lock = path.join(skills, ".mono-agent-workflow.lock.json"), pins = json(lock);
    const dispatchFile = path.join(root, "prompt.md"), capture = path.join(root, "starts.jsonl");
    write(dispatchFile, "fixture"); write(path.join(state, "control.json"), { state: "active", halt: false });
    write(path.join(state, "workers.json"), {}); fs.mkdirSync(mailbox);
    write(path.join(bin, "codex"), `#!/usr/bin/env node
const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),gitDir:process.env.GIT_DIR,gitSentinel:process.env.GIT_MONO_SENTINEL,credentialDigests:Object.fromEntries(['GITHUB_TOKEN','PRODUCT_API_KEY','OPENAI_API_KEY'].map(k=>[k,require('node:crypto').createHash('sha256').update(process.env[k]??'').digest('hex')]))})+'\\n');
console.log(JSON.stringify({type:'thread.started',thread_id:'grants-fixture'}));
`); fs.chmodSync(path.join(bin, "codex"), 0o700);
    process.env.PATH = `${bin}:${process.env.PATH}`;
    const { spawnWorker, resumeWorker } = await import(pathToFileURL(path.join(skills, ".mono-agent-workflow/scripts/orchestrator/launch.mjs")));
    const expected = [worktree, mailbox, common, metadata].sort();
    const request = { root: state, issue: "MONO-997", worktree, branch: "linked", base: head, lock,
      packVersion: pins.packVersion, sourceCommit: pins.sourceCommit, surfaceRevision: pins.surfaceRevision,
      evidenceRoot: path.join(root, "evidence"), workerWritableRoots: expected, writable_roots: [],
      role: "worker-default", dispatchFile, lifecycle_moves: [] };
    const starts = () => fs.existsSync(capture) ? fs.readFileSync(capture, "utf8").trim().split("\n").map(JSON.parse) : [];
    const extra = path.join(root, "extra"); fs.mkdirSync(extra);
    for (const badPin of [expected.filter(p => p !== metadata), expected.filter(p => p !== common), [...expected, extra]]) {
      await assert.rejects(spawnWorker({ ...request, workerWritableRoots: badPin }), /effective write grants differ/);
      assert.equal(starts().length, 0, "a mismatched pin must refuse before codex starts");
    }
    const second = path.join(root, "second"); fs.mkdirSync(second);
    pass(run("git", ["init", "-b", "other"], second, env));
    pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "other repo"], second, env));
    assert.notEqual(pass(run("git", ["rev-parse", "HEAD"], second, env)).stdout.trim(), head);
    process.env.GIT_DIR = path.join(second, ".git");
    process.env.GIT_MONO_SENTINEL = "preserve worker env";
    const credentialDigests = {};
    for (const name of ['GITHUB_TOKEN', 'PRODUCT_API_KEY', 'OPENAI_API_KEY']) {
      process.env[name] = crypto.randomBytes(24).toString('hex');
      credentialDigests[name] = crypto.createHash('sha256').update(process.env[name]).digest('hex');
    }
    const alias = path.join(root, "linked-alias"); fs.symlinkSync(worktree, alias);
    const commonReal = path.join(root, "common-real"); fs.renameSync(common, commonReal); fs.symlinkSync(commonReal, common);
    const canonicalExpected = [worktree, mailbox, commonReal, path.join(commonReal, "worktrees/linked")].sort();
    await spawnWorker({ ...request, worktree: alias });
    const entry = json(path.join(state, "workers.json"))[request.issue];
    for (const actual of [entry.writable_roots, entry.workerWritableRoots, entry.capsule.writable_roots]) assert.deepEqual(actual, canonicalExpected);
    const argsRoots = args => JSON.parse(args.find(a => a.startsWith("sandbox_workspace_write.writable_roots=")).split("=").slice(1).join("="));
    assert.deepEqual(argsRoots(starts().at(-1).args), canonicalExpected);
    assert.equal(entry.capsule.head, head);
    assert.equal(starts().at(-1).gitDir, path.join(second, ".git"));
    assert.equal(starts().at(-1).gitSentinel, "preserve worker env");
    assert.deepEqual(starts().at(-1).credentialDigests, credentialDigests);
    // The fixture child exits immediately after its observable launch event.
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const badPin of [canonicalExpected.filter(p => p !== path.join(commonReal, "worktrees/linked")), canonicalExpected.filter(p => p !== commonReal), [...canonicalExpected, extra]]) {
      await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile, workerWritableRoots: badPin }), /effective write grants differ/);
      assert.equal(starts().length, 1);
    }
    write(lock, { ...pins, surfaceRevision: pins.surfaceRevision + 1 });
    await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile, extraWritable: [root] }), /pack identity changed/);
    assert.equal(starts().length, 1);
    write(lock, pins);
    const beforeResume = json(path.join(state, "workers.json"));
    beforeResume[request.issue].writable_roots = [];
    write(path.join(state, "workers.json"), beforeResume);
    await resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile });
    for (let i = 0; i < 100 && starts().length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(starts().length, 2);
    assert.deepEqual(argsRoots(starts().at(-1).args), canonicalExpected);
    assert.deepEqual(starts().at(-1).credentialDigests, credentialDigests);
    const resumed = json(path.join(state, "workers.json"))[request.issue];
    for (const actual of [resumed.writable_roots, resumed.workerWritableRoots, resumed.capsule.writable_roots]) assert.deepEqual(actual, canonicalExpected);
    assert.equal(starts().at(-1).gitDir, path.join(second, ".git"));
    assert.equal(process.env.GIT_DIR, path.join(second, ".git"));
    delete process.env.GIT_DIR;
    await new Promise(resolve => setTimeout(resolve, 100));
    const regularExpected = [second, mailbox, path.join(second, ".git")].sort();
    const regularHead = pass(run("git", ["rev-parse", "HEAD"], second, env)).stdout.trim();
    await spawnWorker({ ...request, issue: "MONO-996", worktree: second, branch: "other", base: regularHead, workerWritableRoots: regularExpected });
    const regular = json(path.join(state, "workers.json"))["MONO-996"];
    for (const actual of [regular.writable_roots, regular.workerWritableRoots, regular.capsule.writable_roots, argsRoots(starts().at(-1).args)]) assert.deepEqual(actual, regularExpected);

    const helperTarget = path.join(root, "helper-git");
    const helper = path.join(skills, "autoreview/scripts/autoreview");
    fs.mkdirSync(path.dirname(helper), { recursive: true }); fs.symlinkSync(helperTarget, helper);
    const guarded = [
      [path.join(root, "evidence/git"), /evidenceRoot must be outside/],
      [path.join(skills, "git"), /installed skillsRoot must be outside/],
      [helperTarget, /autoreview helper real path must be outside/],
      [path.join(state, "git"), /only reports may be worker-writable/],
    ];
    for (const [index, [gitDir, reason]] of guarded.entries()) {
      const guardedTree = path.join(root, `guarded-${index}`); fs.mkdirSync(guardedTree);
      fs.mkdirSync(path.dirname(gitDir), { recursive: true });
      pass(run("git", ["init", "-b", "guarded", "--separate-git-dir", gitDir], guardedTree, env));
      pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "guarded"], guardedTree, env));
      const guardedHead = pass(run("git", ["rev-parse", "HEAD"], guardedTree, env)).stdout.trim();
      const count = starts().length;
      const grantPin = [guardedTree, mailbox, gitDir];
      await assert.rejects(spawnWorker({ ...request, issue: `MONO-${990-index}`, worktree: guardedTree, branch: "guarded", base: guardedHead, workerWritableRoots: grantPin }), reason);
      const registry = json(path.join(state, "workers.json"));
      registry[request.issue] = { ...entry, pid: null, worktree: guardedTree, writable_roots: [], workerWritableRoots: grantPin };
      write(path.join(state, "workers.json"), registry);
      await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile }), reason);
      assert.equal(starts().length, count, "guarded derived directories must refuse before codex starts");
    }
    const registry = json(path.join(state, "workers.json"));
    registry[request.issue] = { ...entry, pid: null, writable_roots: [] };
    write(path.join(state, "workers.json"), registry);
    const realGit = pass(run("which", ["git"], root, env)).stdout.trim();
    write(path.join(bin, "git"), `#!/usr/bin/env node
const cp=require('node:child_process'),a=process.argv.slice(2);
if(a[0]==='rev-parse'&&a.includes('--absolute-git-dir')){console.log('relative/git');process.exit(0);}
const r=cp.spawnSync(${JSON.stringify(realGit)},a,{stdio:'inherit'});process.exit(r.status??1);
`); fs.chmodSync(path.join(bin, "git"), 0o700);
    const count = starts().length;
    await assert.rejects(spawnWorker({ ...request, issue: "MONO-980" }), /Git directory must be absolute/);
    await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile }), /Git directory must be absolute/);
    fs.unlinkSync(path.join(bin, "git"));
    const empty = path.join(root, "not-a-repo"); fs.mkdirSync(empty);
    registry[request.issue].worktree = empty; write(path.join(state, "workers.json"), registry);
    await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile }), /Cannot read worktree Git/);
    assert.equal(starts().length, count);

  } finally {
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wave cost independently selects delivery, legacy and ledger metrics", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-cost-sources-"));
  const issue = "MONO-995", reportDir = path.join(root, "reports");
  const dispatch = "- 2026-09-15T10:00:00Z MONO-995 DISPATCHED\n";
  const green = "2026-09-15T10:10:00Z", merge = "2026-09-15T10:20:00Z";
  const deliverFile = path.join(reportDir, `${issue}-mono-deliver.json`), shipFile = path.join(reportDir, `${issue}-mono-ship.json`);
  const marker = "- 2026-09-15T10:30:00Z MONO-995 SHIP GREEN\n- 2026-09-15T10:40:00Z MONO-995 MERGED\n";
  const measure = ({ deliver, ship, ledger = dispatch }) => {
    fs.rmSync(reportDir, { recursive: true, force: true }); fs.mkdirSync(reportDir);
    if (deliver) write(deliverFile, { issue, stage: "mono-deliver", ...deliver });
    if (ship) write(shipFile, { issue, stage: "mono-ship", ...ship });
    write(path.join(root, "ledger.md"), ledger);
    const output = pass(run(process.execPath, [path.join(checkout, "scripts/wave-cost.mjs"), issue, "--root", root], checkout, process.env)).stdout;
    const [data, line] = output.split("\nЦена волны");
    return { data: JSON.parse(data), line };
  };
  try {
    write(path.join(root, "logs", `${issue}-mono-deliver-a1.jsonl`), JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }) + "\n");
    fs.mkdirSync(reportDir);
    let result = measure({ deliver: { green_at: green, review_rounds: 0 } });
    assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 600);
    assert.equal(result.data.intervals.sources.green_pr, deliverFile);
    assert.equal(result.data.review_rounds, 0);
    assert.equal(result.data.review_rounds_source, deliverFile);
    assert.match(result.line, /круги ревью 0/);
    assert.match(result.line, /до слияния н\/д \([^)]+\)/);
    for (const field of ["merged_at", "merge_at"]) {
      result = measure({ deliver: { green_at: green, [field]: merge } });
      assert.equal(result.data.intervals.dispatch_to_merge.seconds, 1200);
      assert.equal(result.data.intervals.sources.merge, deliverFile);
    }
    result = measure({ deliver: { green_at: green, completed_at: merge }, ledger: dispatch + marker });
    assert.equal(result.data.intervals.dispatch_to_merge.seconds, 2400);
    assert.match(result.data.intervals.sources.merge, /^ledger.md:/);
    result = measure({ deliver: { completed_at: green } });
    assert.match(result.line, /до зелёного PR н\/д \([^)]+\), до слияния н\/д \([^)]+\)/);
    result = measure({ deliver: { green_at: green, merged_at: merge }, ledger: "" });
    assert.match(result.line, /до зелёного PR н\/д \([^)]+\), до слияния н\/д \([^)]+\)/);
    for (const topLevel of [{}, { green_at: "bad", merged_at: "bad", merge_at: "bad" }]) {
      const deliver = { ...topLevel, capsule: { green_at: "2026-09-15T10:01:00Z", merged_at: "2026-09-15T10:02:00Z" }, tests: { merge_at: "2026-09-15T10:03:00Z" } };
      result = measure({ deliver, ship: { green_at: green, merged_at: merge } });
      assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 600);
      assert.equal(result.data.intervals.dispatch_to_merge.seconds, 1200);
      assert.equal(result.data.intervals.sources.green_pr, shipFile);
      assert.equal(result.data.intervals.sources.merge, shipFile);
      result = measure({ deliver, ledger: dispatch + marker });
      assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 1800);
      assert.equal(result.data.intervals.dispatch_to_merge.seconds, 2400);
      result = measure({ deliver });
      assert.match(result.line, /до зелёного PR н\/д \([^)]+\), до слияния н\/д \([^)]+\)/);
    }
    result = measure({ ship: { legacy: { green_at: green, merge_at: merge } } });
    assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 600);
    assert.equal(result.data.intervals.dispatch_to_merge.seconds, 1200);
    const legacyForms = [
      { review_rounds: 2 }, { review_rounds: { novel_resolver_rounds: 2 } },
      { notes: "review rounds: 2" }, { tests: { result: "novel_resolver_rounds=2" } },
    ];
    for (const timestamp of ["green_at", "completed_at", "reported_at"]) {
      for (const rounds of legacyForms) {
        result = measure({ ship: { [timestamp]: green, merge_at: merge, ...rounds } });
        assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 600);
        assert.equal(result.data.intervals.dispatch_to_merge.seconds, 1200);
        assert.equal(result.data.review_rounds, 2);
        assert.equal(result.data.review_rounds_source, shipFile);
        assert.equal(result.data.intervals.sources.green_pr, shipFile);
      }
    }
    result = measure({ deliver: { green_at: green, merged_at: merge, review_rounds: 0 }, ship: { green_at: merge, merged_at: "2026-09-15T10:25:00Z", review_rounds: 3 }, ledger: dispatch + marker });
    assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 600);
    assert.equal(result.data.intervals.dispatch_to_merge.seconds, 1200);
    assert.equal(result.data.review_rounds, 0);
    for (const invalid of [undefined, "bad date", 123, null]) {
      result = measure({ deliver: { green_at: invalid, merged_at: merge }, ship: { green_at: green, review_rounds: 2 } });
      assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 600);
      assert.equal(result.data.intervals.sources.green_pr, shipFile);
      assert.equal(result.data.intervals.dispatch_to_merge.seconds, 1200);
      assert.equal(result.data.intervals.sources.merge, deliverFile);
      assert.equal(result.data.review_rounds, 2);
    }
    for (const invalid of [-1, 1.5, "3", { novel_resolver_rounds: 9 }, null]) {
      result = measure({ deliver: { review_rounds: invalid }, ship: { notes: "review rounds: 2" } });
      assert.equal(result.data.review_rounds, 2);
      assert.equal(result.data.review_rounds_source, shipFile);
    }
    result = measure({ deliver: { green_at: "bad", merged_at: "bad", review_rounds: -1 }, ship: { green_at: "bad", merged_at: "bad" }, ledger: dispatch + marker });
    assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 1800);
    assert.equal(result.data.intervals.dispatch_to_merge.seconds, 2400);
    assert.match(result.line, /круги ревью н\/д \([^)]+\)/);
    result = measure({ ship: { reported_at: merge, completed_at: merge, green_at: green } });
    assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 600);
    result = measure({ ship: { green_at: "bad", completed_at: green, merged_at: "bad", merge_at: merge, review_rounds: -1, notes: "review rounds: 2" } });
    assert.equal(result.data.intervals.dispatch_to_green_pr.seconds, 600);
    assert.equal(result.data.intervals.dispatch_to_merge.seconds, 1200);
    assert.equal(result.data.review_rounds, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('wave cost prefers review ledger counters and ignores newer retired registry reports', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-review-cost-')),issue='MONO-995';
  try {
    write(path.join(root,'logs',`${issue}-mono-deliver-a1.jsonl`),JSON.stringify({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}})+'\n');
    write(path.join(root,'consumed',`${issue}-mono-deliver.json`),{issue,stage:'mono-deliver',review_rounds:2});
    write(path.join(root,'reports',`${issue}-registry-retired.json`),{issue,stage:'mono-deliver',retired_at:'2026-09-15T15:34:24Z',review_rounds:999});
    const ledger=path.join(root,'evidence/reviews',`${issue}.json`);
    const base={sources:[],status:'unknown',launchCause:'unknown',announcedPasses:null,confirmedPasses:null,usage:null};
    write(ledger,{issue,attempts:[{attempt:1,unresolvedCoverage:[],events:[{...base,id:'c1',kind:'collection-request'},{...base,id:'c2',kind:'collection-request',status:'withheld'},{...base,id:'h1',kind:'helper-invocation'}]}]});
    const result=run(process.execPath,[path.join(checkout,'scripts/wave-cost.mjs'),issue,'--root',root,'--evidence-root',path.join(root,'evidence')],checkout,process.env);
    pass(result);const output=JSON.parse(result.stdout.split('\nЦена волны')[0]);
    assert.equal(output.review_rounds,2);assert.equal(output.autoreview.ledger.collections,2);assert.equal(output.autoreview.ledger.invocations,1);
    assert.match(result.stdout,/авто-ревью: сборов 2 \(отклонено 1\), вызовов 1/);assert.match(result.stdout,/измерено 0 из 1/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('pilot phase proposals validate shape and references while legacy reports and confirmations remain valid',async()=>{
  const {validatePhase,confirmQueue,validateConfirmation}=await import('./delivery-state.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-pilot-report-'));
  const report={issue:'MONO-999',stage:'mono-deliver',attempt:1,packVersion:'test',sourceCommit:'a'.repeat(40),surfaceRevision:4,phase:'code',sequence:1,kind:'phase',head:'b'.repeat(40),linear_mutations_pending:[],capsule:{phase:'code',head:'b'.repeat(40),decisions:[],open_queue:[],writable_roots:[path.join(root,'reports')]}};
  const proposal={type:'decision',id:'d1',eventId:'1:helper-invocation:local1',findingKey:'invariant',problem:'problem',trigger:'trigger',evidence:'repro',impact:'impact',origin:'original',decision:'refuted',validity:{head:report.head,base:'a'.repeat(40),contracts:[],assumptions:[]},verification:'test passes',supersedes:null,proposedBy:'worker',recordedAt:'2026-09-16T00:00:00Z'};
  const matrix={type:'matrix',id:'m1',invariant:'invariant',states:[{state:'absent',expected:'refusal'}],verification:'targeted test passes',recordedAt:'2026-09-16T00:00:00Z',decisionIds:['d1']};
  try {
    assert.equal(validatePhase(report),report);
    const pilot={...report,review_dispositions:[proposal],behaviour_matrices:[matrix],checkpoint:{confirmedDefects:'one',evidence:'repro',failedFixes:'previous attempt',nextExperiment:'targeted test',stopCondition:'reproduction passes'},progress_claim:{progress:'none',evidence:'test still fails',eventIds:[proposal.eventId]}};
    validatePhase(pilot);
    for(const fields of [{review_dispositions:{}},{review_dispositions:[{...proposal,findingKey:''}]},{review_dispositions:[proposal,proposal]},{behaviour_matrices:[{...matrix,decisionIds:['missing']}]},{checkpoint:{confirmedDefects:'one'}},{progress_claim:{progress:'done',evidence:'claimed',eventIds:[]}},{review_dispositions:[{...proposal,supersedes:'invalid reference space'}]}])assert.throws(()=>validatePhase({...pilot,...fields}));
    const ack=await confirmQueue(pilot,root,async()=>{throw new Error('empty queue must not call adapter');});
    assert.equal(validateConfirmation(pilot,ack),true);
    assert.throws(()=>validateConfirmation({...pilot,checkpoint:{...pilot.checkpoint,nextExperiment:'changed'}},ack),/does not cover/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('decide uses adjudicated links and progress, with no prose inference or cross-attempt accumulation',async()=>{
  const {decideReview}=await import('./review-ledger.mjs');
  const entry={type:'decision',id:'d1',findingKey:'same-invariant',problem:'p',trigger:'t',evidence:'e',impact:'i',origin:'original',decision:'confirmed',validity:{head:'a'.repeat(40),base:'b'.repeat(40),contracts:[],assumptions:[]},verification:'test',supersedes:null,proposedBy:'worker',recordedAt:'2026-09-16T00:00:00Z'};
  const journal={issue:'MONO-999',entries:[entry]};
  const events=[1,2,3].map(n=>({id:`1:helper-invocation:${n}`,kind:'helper-invocation',parent:null,status:'findings',findings:1}));
  const ledger={issue:journal.issue,attempts:[{attempt:1,events,unresolvedCoverage:[]}]};
  const records=events.map(e=>({eventId:e.id,origin:'original',evidence:'same text does not identify a finding',links:['d1'],progress:'none',recordedBy:'orchestrator'}));
  assert.deepEqual(decideReview({ledger,records:[],journal,attempt:1}).matrixFindingKeys,[]);
  let hint=decideReview({ledger,records:records.slice(0,2),journal,attempt:1});
  assert.deepEqual(hint.matrixFindingKeys,['same-invariant']);assert.equal(hint.checkpointRequired,true);
  hint=decideReview({ledger,records:[records[0],records[0]],journal,attempt:1});
  assert.deepEqual(hint.matrixFindingKeys,[]);assert.equal(hint.checkpointRequired,false);
  hint=decideReview({ledger,records:records.map(r=>({...r,links:[],progress:'fixed'})),journal,attempt:1});
  assert.deepEqual(hint.matrixFindingKeys,[]);assert.equal(hint.checkpointRequired,false);
  hint=decideReview({ledger,records:[...records.slice(0,2),{...records[2],progress:'evidence'}],journal,attempt:1});
  assert.equal(hint.checkpointRequired,false);
  hint=decideReview({ledger,records:[...records.slice(0,2),{...records[2],progress:null}],journal,attempt:1});
  assert.equal(hint.checkpointRequired,false);
  const other={...ledger,attempts:[...ledger.attempts,{attempt:2,events:[{...events[0],id:'2:helper-invocation:1'}]}]};
  hint=decideReview({ledger:other,records:[records[0],{...records[1],eventId:'2:helper-invocation:1'}],journal,attempt:1});
  assert.deepEqual(hint.matrixFindingKeys,[]);assert.equal(hint.checkpointRequired,false);
  assert.throws(()=>decideReview({ledger,records,journal:{...journal,issue:'MONO-1'},attempt:1}),/issue/);
});

test('withheld request requires a reason, survives ledger rebuild and creates zero invocations',async()=>{
  const {withholdCollection,buildReviewLedger,summarizeLedger}=await import('./review-ledger.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-withheld-'));
  try {
    const args={evidenceRoot:root,issue:'MONO-999',record:{attempt:1,collectionId:'pilot-request-1',reason:'matrix missing',recordedBy:'orchestrator'}};
    await assert.rejects(withholdCollection({...args,record:{...args.record,reason:''}}),/reason/);
    const injected={...args.record,usage:{normalized:{input:99}},findings:2,parent:'other',head:'a'.repeat(40),datasetVersion:9,certificationRole:'certified',launchCause:'fix',causeEvidence:'invented'};
    const file=await withholdCollection({...args,record:injected});
    await withholdCollection(args);
    await assert.rejects(withholdCollection({...args,record:{...args.record,reason:'changed'}}),/changed/);
    const records=json(file);assert.equal(records.length,1);
    assert.deepEqual(records[0],{...args.record,kind:'collection-request',status:'withheld'});
    const ledger=buildReviewLedger({issue:args.issue,sources:records.map(data=>({type:'ledger',attempt:data.attempt,ref:file,data}))});
    const event=ledger.attempts[0].events[0];
    assert.equal(event.reason,'matrix missing');assert.equal(event.certificationRole,'none');
    assert.equal(event.usage,null);assert.equal(event.parent,null);assert.equal(event.findings,null);
    const summary=summarizeLedger(ledger);assert.equal(summary.collections,1);assert.equal(summary.withheld,1);assert.equal(summary.invocations,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('worker provider overrides preserve product credentials and replace only Codex routing', async () => {
  const { workerEnvironment } = await import('./orchestrator/launch.mjs');
  const source = Object.fromEntries(['GITHUB_TOKEN', 'PRODUCT_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'MODEL_CREDENTIAL'].map(name => [name, crypto.randomBytes(24).toString('hex')]));
  source.OPENAI_BASE_URL = 'https://old.example.invalid/v1';
  const route = { engine: 'codex', provider: { id: 'example', endpoint: 'https://route.example.invalid/v1' }, credentialEnv: 'MODEL_CREDENTIAL' };
  const env = workerEnvironment(route, source);
  assert.equal(env.GITHUB_TOKEN, source.GITHUB_TOKEN);
  assert.equal(env.PRODUCT_API_KEY, source.PRODUCT_API_KEY);
  assert.equal(env.OPENAI_API_KEY, source.MODEL_CREDENTIAL);
  assert.equal(env.OPENAI_BASE_URL, route.provider.endpoint);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.deepEqual(workerEnvironment({ engine: 'codex', provider: { id: 'openai', endpoint: null }, credentialEnv: null }, source), source);
  assert.deepEqual(workerEnvironment(undefined, source), source);
});

test('launch pins resolve BASE config and refuse unsupported transport before launch', async () => {
  const { resolveWorkerPins } = await import('./orchestrator/launch.mjs');
  const { requiredPairings, resolveModelRoutes } = await import('./runtime.mjs');
  const { pinnedReviewRoute } = await import('./gate.mjs');
  assert.equal(typeof resolveWorkerPins, 'function');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-base-models-'));
  const env = {...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  try {
    pass(run('git',['init','-b','main'],root,env));
    const config={orchestration:{transport:'codex-cli'},models:{roles:{'worker-default':{engine:'codex',model:'example-worker',effort:'medium'}}}};
    config.models.pairingAccepted=requiredPairings(config).map(pair=>({...pair,linearDecision:'https://linear.app/example/issue/TEST-1#comment',by:'owner',date:'2026-09-16'}));
    write(path.join(root,'.agents/mono-workflow.config.json'),config);
    pass(run('git',['add','.'],root,env));pass(run('git',['commit','-m','base config'],root,env));
    const base=pass(run('git',['rev-parse','HEAD'],root,env)).stdout.trim();
    const request={worktree:root,base,role:'worker-default',transport:'codex-cli'};
    const pins=resolveWorkerPins(request);
    assert.equal(pins.roles['worker-default'].model,'example-worker');assert.equal(pins.roles['worker-default'].effort,'medium');
    assert.match(pins.roles.autoreview.fingerprint,/^[a-f0-9]{64}$/);
    for(const transport of ['kimi','fallback','claude-code-desktop']) assert.throws(()=>resolveWorkerPins({...request,transport}),/transport/);
    assert.throws(()=>resolveWorkerPins({...request,role:'worker-claude'}),/role|transport/);
    write(path.join(root,'.agents/mono-workflow.config.json'),{models:{roles:{autoreview:{engine:'invalid'}}}});
    pass(run('git',['add','.'],root,env));pass(run('git',['commit','-m','diff changes config'],root,env));
    assert.deepEqual(resolveWorkerPins(request),pins);
    const review=pinnedReviewRoute({worktree:root,modelRoutes:pins,risk:'risky',critical:null},base);
    assert.equal(review.fingerprint,pins.roles.autoreview.fingerprint);
    assert.throws(()=>pinnedReviewRoute({worktree:root,modelRoutes:{...pins,configDigest:'changed'},risk:'risky',critical:null},base),/fingerprint/);
    const voice=resolveModelRoutes(root,base,'second-voice');assert.equal(voice.roles['second-voice'].engine,'codex');
    for (const transport of ['fallback', 'claude-code-desktop']) {
      write(path.join(root,'.agents/mono-workflow.config.json'),{...config,orchestration:{transport}});
      pass(run('git',['add','.'],root,env));pass(run('git',['commit','-m',`base transport ${transport}`],root,env));
      const transportBase=pass(run('git',['rev-parse','HEAD'],root,env)).stdout.trim();
      assert.throws(()=>resolveWorkerPins({...request,base:transportBase}),/transport/,`request codex-cli must not override BASE ${transport}`);
      assert.throws(()=>resolveWorkerPins({...request,base:transportBase,transport}),/transport/);
      assert.throws(()=>resolveWorkerPins({...request,base:transportBase,transport:undefined}),/transport/);
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('installed collectors seal configured engines and consume the same BASE route after config changes', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mono-engines-'));
  const skills=path.join(root,'skills'),repo=path.join(root,'repo'),state=path.join(root,'state'),bin=path.join(root,'bin');
  const env={...process.env,MONO_WORKFLOW_STATE_ROOT:path.join(root,'install-state'),MONO_WORKFLOW_KNOWN_ROOTS:skills,
    PATH:bin+path.delimiter+process.env.PATH,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  try {
    pass(run(process.execPath,['scripts/install-local.mjs','--skills-root',skills],checkout,env));
    const runtime=path.join(skills,'.mono-agent-workflow/scripts');
    const {requiredPairings,resolveModelRoutes,canonical}=await import(pathToFileURL(path.join(runtime,'runtime.mjs')));
    write(path.join(bin,'codex'),`#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),a=process.argv.slice(2);
if(a[0]!=='sandbox')process.exit(71);
const command=a.slice(a.indexOf('--')+1),p=JSON.parse(command.at(-1)),root=path.dirname(p.probe);
fs.chmodSync(root,0o500);let r;try{r=cp.spawnSync(command[0],command.slice(1),{stdio:'inherit'});}finally{fs.chmodSync(root,0o700);}process.exit(r.status??1);
`);fs.chmodSync(path.join(bin,'codex'),0o700);
    const helper=path.join(skills,'autoreview/scripts/autoreview');
    write(helper,`#!/usr/bin/env node
const fs=require('node:fs'),crypto=require('node:crypto'),a=process.argv.slice(2),val=k=>a[a.indexOf(k)+1],engine=val('--engine');
const keys=['ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY','OPENAI_API_KEY','XAI_API_KEY','KIMI_API_KEY','KIMI_BASE_URL','OPENAI_BASE_URL','ANTHROPIC_BASE_URL','ANTHROPIC_DEFAULT_OPUS_MODEL','REVIEW_CREDENTIAL'];
const environment=Object.fromEntries(keys.filter(k=>process.env[k]!==undefined).map(k=>[k,crypto.createHash('sha256').update(process.env[k]).digest('hex')]));
fs.writeFileSync(val('--json-output'),JSON.stringify({findings:[],overall_correctness:'patch is correct',environment}));
fs.writeFileSync(val('--status-output'),JSON.stringify({schema_version:1,status:'scoped-clean',engine,exit_code:0,report_produced:true,timed_out:false}));
console.log('autoreview target: branch | engine: '+engine+' | model: '+val('--model')+' | thinking: '+val('--thinking'));
console.log('autoreview scoped-clean: no accepted/actionable findings in the selected Git scope and priority');console.log('overall: patch is correct (0.9)');
`);fs.chmodSync(helper,0o700);
    fs.mkdirSync(repo);fs.mkdirSync(state);pass(run('git',['init','-b','fixture'],repo,env));
    pass(run('git',['commit','--allow-empty','-m','ancestor without models'],repo,env));
    const ancestor = pass(run('git',['rev-parse','HEAD'],repo,env)).stdout.trim();
    const ancestorPins = resolveModelRoutes(repo, ancestor, 'worker-default');
    for(const engine of ['claude','kimi','pi','codex']) {
      const config={models:{roles:{autoreview:{engine,model:'example-reviewer',effortByRisk:Object.fromEntries(['tiny','standard','deep','risky','riskyCritical'].map(r=>[r,engine==='kimi'?'on':'high'])),
        provider:{id:engine==='claude'?'external':engine==='kimi'?'moonshot':'openai',endpoint:'https://fixture.invalid/v1',credentialEnv:'REVIEW_CREDENTIAL'}}}}};
      config.models.pairingAccepted=requiredPairings(config).map(pair=>({...pair,linearDecision:'https://linear.app/example/issue/TEST-1#decision',by:'owner',date:'2026-09-16'}));
      write(path.join(repo,'.agents/mono-workflow.config.json'),config);pass(run('git',['add','.'],repo,env));pass(run('git',['commit','-m','base '+engine],repo,env));
      const base=pass(run('git',['rev-parse','HEAD'],repo,env)).stdout.trim(),modelRoutes=resolveModelRoutes(repo,base,'worker-default');
      write(path.join(repo,'.agents/mono-workflow.config.json'),{models:{roles:{autoreview:{engine:'invalid-in-diff'}}}});
      pass(run('git',['add','.'],repo,env));pass(run('git',['commit','-m','head config differs'],repo,env));
      const head=pass(run('git',['rev-parse','HEAD'],repo,env)).stdout.trim();
      const request={product:'fixture',collectionId:`preflight-collect:${head}:1`,root:state,worktree:repo,head,skillsRoot:skills,risk:'risky',critical:null,baseRef:base,evidenceRoot:path.join(root,'evidence'),workerWritableRoots:[repo,state],collect:true,modelRoutes,verification:{command:process.execPath,args:['-e','process.exit(0)']}};
      const file=path.join(root,'request.json');write(file,request);
      const secret=crypto.randomBytes(24).toString('hex'),callEnv={...env,REVIEW_CREDENTIAL:secret,ANTHROPIC_DEFAULT_OPUS_MODEL:'external',ANTHROPIC_AUTH_TOKEN:'external',XAI_API_KEY:'external',KIMI_BASE_URL:'https://external.invalid',OPENAI_API_KEY:'external'};
      const call=()=>run(process.execPath,[path.join(runtime,'gate.mjs'),'preflight','--request',file],repo,callEnv);
      pass(call());
      const receiptPath=path.join(request.evidenceRoot,head+'.json'),envelope=json(receiptPath),receipt=envelope.receipt;
      assert.equal(receipt.route.engine,engine);assert.equal(receipt.route.fingerprint,modelRoutes.roles.autoreview.fingerprint);
      assert.equal(receipt.review.status.engine,engine);
      const target=engine==='claude'?'ANTHROPIC_AUTH_TOKEN':engine==='kimi'?'KIMI_API_KEY':'OPENAI_API_KEY';
      const endpoint=engine==='claude'?'ANTHROPIC_BASE_URL':engine==='kimi'?'KIMI_BASE_URL':'OPENAI_BASE_URL';
      assert.deepEqual(Object.keys(receipt.review.json.environment).sort(),[target,endpoint].sort());
      assert.equal(receipt.review.json.environment[target],crypto.createHash('sha256').update(secret).digest('hex'));
      assert.equal(fs.readFileSync(receiptPath,'utf8').includes(secret),false);
      write(file,{...request,collect:false});pass(call());
      write(file,{...request,collect:false,modelRoutes:ancestorPins});
      const changedBinding = call(); assert.equal(changedBinding.status, 1);
      assert.match(changedBinding.stdout, /receipt modelRoutes differs from dispatch request/, 'modern receipts retain their sealed pin binding');
      write(file,{...request,collect:false});
      if (engine === 'claude') {
        const legacy = structuredClone(receipt);
        legacy.route = { model: legacy.route.model, effort: legacy.route.effort };
        for (const includePins of [false, true]) {
          if (includePins) legacy.modelRoutes = modelRoutes;
          else delete legacy.modelRoutes;
          write(receiptPath, { receipt: legacy, signature: crypto.createHmac('sha256', fs.readFileSync(path.join(request.evidenceRoot, 'receipt.key'))).update(canonical(legacy)).digest('hex') });
          const refusal = call(); assert.equal(refusal.status, 1);
          assert.match(refusal.stdout, /legacy receipt cannot certify model override pins/);
        }
        const ancestorRequest = { ...request, collectionId: `preflight-collect:${head}:2`, modelRoutes: ancestorPins };
        write(file, ancestorRequest); pass(call());
        const ancestorLegacy = json(receiptPath).receipt;
        ancestorLegacy.route = { model: ancestorLegacy.route.model, effort: ancestorLegacy.route.effort };
        delete ancestorLegacy.modelRoutes;
        write(receiptPath, { receipt: ancestorLegacy, signature: crypto.createHmac('sha256', fs.readFileSync(path.join(request.evidenceRoot, 'receipt.key'))).update(canonical(ancestorLegacy)).digest('hex') });
        write(file, { ...ancestorRequest, collect: false });
        const ancestorRefusal = call();
        assert.equal(ancestorRefusal.status, 1, 'ancestor pins without models cannot bypass models at the review base: ' + ancestorRefusal.stdout);
        assert.match(ancestorRefusal.stdout, /legacy receipt cannot certify model override pins/);
        write(receiptPath, envelope);
        write(file, { ...request, collect: false });
      }
      const tampered=structuredClone(modelRoutes);tampered.roles.autoreview.fingerprint='0'.repeat(64);
      write(file,{...request,collect:false,modelRoutes:tampered});assert.equal(call().status,1);
      write(file,{...request,collect:true,modelRoutes:tampered});assert.match(call().stdout,/fingerprint mismatch/);
      write(file,{...request,collect:true,modelRoutes:undefined});assert.match(call().stdout,/launch pins required/);
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
