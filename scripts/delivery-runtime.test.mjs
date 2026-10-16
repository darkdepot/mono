import { packLayout, canonical } from './runtime.mjs';
import { copyPluginFixture, writeWatcherFixture } from './plugin-fixture.mjs';
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
// Each collection experiment has its own registered Issue and a real admission.
// Logical IDs in these older sandbox/route fixtures follow their current receipt;
// recollection gets a new ID, while an unknown ID still exercises missing proof.
let fixtureIssueSequence = 0;
function installedAdmissionFixture(runtime, file, cwd, env) {
  let sequence = 0;
  const logicalIds = new Map();
  return () => {
    const request = json(file);
    const logicalId = [...logicalIds].find(([, ids]) => ids.has(request.collectionId))?.[0] ?? request.collectionId;
    if (request.collect === true) {
      sequence = ++fixtureIssueSequence;
      const history = path.join(request.evidenceRoot, 'history');
      const used = fs.existsSync(history) && fs.readdirSync(history).filter(n => n.endsWith('.json'))
        .some(n => json(path.join(history, n)).receipt?.collectionId === logicalId);
      if (used) request.collectionId = `preflight-collect:${request.head}:${1000 + sequence}`;
      request.issue = `FIXTURE-${sequence}`;
      const known = logicalIds.get(logicalId) ?? new Set(); known.add(request.collectionId); logicalIds.set(logicalId, known);
      write(file, request);
      const admissionScript = path.join(path.dirname(file), 'fixture-admission.mjs');
      write(admissionScript, `import fs from 'node:fs';import path from 'node:path';
import {atomicJson,packLayout} from ${JSON.stringify(pathToFileURL(path.join(runtime, 'runtime.mjs')).href)};
import {admitCollection,sha256File} from ${JSON.stringify(pathToFileURL(path.join(runtime, 'orchestrator/command-state.mjs')).href)};
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),root=request.root;delete request.pins;request.reviewDatasetVersion??=0;
fs.mkdirSync(request.evidenceRoot,{recursive:true});
const identity=packLayout(request.skillsRoot).identity(),pinsFile=path.join(root,'dispatch',request.issue+'-a1','pins.json');
atomicJson(pinsFile,{...request,base:request.head});
const entry={issue:request.issue,attempt:1,stage:'mono-deliver',worktree:request.worktree,...identity,pins:{file:pinsFile,digest:sha256File(pinsFile)},pinsVersion:0};
atomicJson(path.join(root,'workers.json'),{[entry.issue]:entry});
request.pins=entry.pins;atomicJson(process.argv[2],request);
const queue=[{id:request.collectionId,operation:'preflight-collect',target:request.head,payload:{request:{...request,collect:false}}}];
await admitCollection(root,{...entry,phase:'preflight',sequence:1,kind:'confirmation-request',head:request.head,linear_mutations_pending:queue,
 capsule:{phase:'preflight',head:request.head,decisions:[],open_queue:queue,writable_roots:request.workerWritableRoots}});
`);
      pass(run(process.execPath, [admissionScript, file], cwd, env));
    } else {
      const receiptFile = path.join(request.evidenceRoot, `${request.head}.json`);
      const receipt = fs.existsSync(receiptFile) ? json(receiptFile).receipt : null;
      if (receipt?.issue) request.issue = receipt.issue;
      if (logicalIds.get(logicalId)?.has(receipt?.collectionId)) request.collectionId = receipt.collectionId;
      write(file, request);
    }
    const result=run(process.execPath, [path.join(runtime, 'gate.mjs'), 'preflight', '--request', file], cwd, env);
    // Archive a legacy mutable fixture for old route/sandbox readback cases.
    // Keep the native pinned immutable history untouched for admission/counting.
    if(request.collect===true) {
      const receiptFile=path.join(request.evidenceRoot,request.head+'.json');
      if(fs.existsSync(receiptFile)) {
        const envelope=json(receiptFile);delete envelope.receipt.pins;
        envelope.signature=crypto.createHmac('sha256',fs.readFileSync(path.join(request.evidenceRoot,'receipt.key'))).update(canonical(envelope.receipt)).digest('hex');write(receiptFile,envelope);
      }
    }
    return result;
  };
}
test("backup switch named launch contracts", async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mono-backup-"));
  const savedPath = process.env.PATH;
  const realRead = fs.readFileSync;
  const pack = path.join(scratch, "pack"), bin = path.join(scratch, "bin"), repo = path.join(scratch, "repo");
  const pids = new Set();
  const stop = async pid => {
    try { process.kill(pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    for (let n = 0; n < 200; n++) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") { pids.delete(pid); return; } throw error; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("fixture process failed to stop");
  };
  try {
    copyPluginFixture(pack);
    for (const dir of [bin, repo]) fs.mkdirSync(dir);
    const tool = (name, source) => { write(path.join(bin, name), `#!${process.execPath}\n${source}`); fs.chmodSync(path.join(bin, name), 0o700); };
    const fixtureStart = "Mon Jan 1 00:00:00 2024";
    const markersFile = path.join(bin, "marker-outputs");
    const markerOutputs = {};
    write(markersFile, markerOutputs);
    const python = execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
    tool("python3", `const fs=require('fs'),request=JSON.parse(fs.readFileSync(0,'utf8')),
      outputs=JSON.parse(fs.readFileSync(${JSON.stringify(markersFile)},'utf8')),
      tree=fs.readFileSync(${JSON.stringify(path.join(bin, "tree"))},'utf8').trim().split('\\n').filter(Boolean);
      const rawByPid={},unavailable=[];
      for(const pid of request.pids??[request.pid]) {
        const output=outputs[pid],line=tree.find(row=>row.trim().startsWith(pid+' ')),command=line?.trim().split(/\\s+/).slice(5)??['fixture-control'];
        const argv=typeof output==='object'?(output.argv??command):command,env=output?.nativeEnvOmitted?'':typeof output==='string'?output:(output?.environ??'');
        const argc=Buffer.alloc(4);argc.writeInt32LE(output?.claimedArgc??argv.length);
        const executable=Buffer.from('/usr/bin/node\\0'),padding=Buffer.alloc((8-executable.length%8)%8);
        rawByPid[pid]=Buffer.concat([argc,executable,padding,Buffer.from(argv.join('\\0')+'\\0'+env+'\\0')]).toString('hex');
        if(output?.nativeUnavailable)unavailable.push(pid);
      }
      const prefix="import ctypes\\nraw_by_pid="+JSON.stringify(rawByPid)+"\\nunavailable="+JSON.stringify(unavailable)+"\\nclass FixtureLibc:\\n def sysctl(self,mib,n,buf,size,new,length):\\n  if n==2:\\n   buf._obj.value=262144\\n   size._obj.value=4\\n   return 0\\n  if size._obj.value-4>262144 or mib[2] in unavailable: return -1\\n  raw=bytes.fromhex(raw_by_pid[str(mib[2])])\\n  ctypes.memmove(buf,raw,len(raw))\\n  size._obj.value=len(raw)\\n  return 0\\nctypes.CDLL=lambda *a,**k: FixtureLibc()\\n";
      const result=require('child_process').spawnSync(${JSON.stringify(python)},[...process.argv.filter(a=>a==='-I'||a==='-S'),'-c',prefix+process.argv[process.argv.indexOf('-c')+1]],{input:JSON.stringify(request),encoding:'utf8'});
      process.stdout.write(result.stdout||'');process.exit(result.status??1);`);
    // No /proc or ps of the host is inspected, on either supported platform.
    fs.readFileSync = function(file, ...args) {
      const command = /^\/proc\/(\d+)\/cmdline$/.exec(String(file));
      if (command) {
        const rows = realRead.call(fs, path.join(bin, "tree"), "utf8").split("\n");
        const row = rows.find(line => line.trim().startsWith(command[1] + " "));
        if (!row) throw new Error("unavailable command fixture");
        return row.trim().split(/\s+/).slice(5).join(" ") + "\0";
      }
      const match = /^\/proc\/(\d+)\/environ$/.exec(String(file));
      if (!match) return realRead.call(fs, file, ...args);
      const output = markerOutputs[match[1]];
      if (output === undefined || output === null) throw new Error("unavailable marker fixture");
      return output;
    };
    tool("ps", `const fs=require('fs'),a=process.argv;
      const date=fs.existsSync(${JSON.stringify(path.join(bin, 'locale-mode'))})&&process.env.LC_ALL!=='C'&&process.env.LC_TIME!=='C'?'Mo. 01 Jan. 2024 00:00:00':${JSON.stringify(fixtureStart)};
      if(a.includes('eww')) {const pid=a[a.indexOf('-p')+1],outputs=JSON.parse(fs.readFileSync(${JSON.stringify(markersFile)},'utf8'));
        if(outputs[pid]===undefined||outputs[pid]===null)process.exit(1);
        const output=outputs[pid],uid=typeof output==='object'&&a.includes('ruid=,command=')?(output.ruid??process.getuid()):process.getuid();
        console.log(uid+' '+(typeof output==='object'?(output.fallback??output.text):'node '+output.split('\\0').join(' ')));}
      else if(a.includes('-p')) console.log(date);
      else {const commandOnly=a.includes('pid=,command='),utcOnly=a.includes('pid=,lstart='),text=fs.readFileSync(${JSON.stringify(path.join(bin, "tree"))},'utf8');
      const modeFile=${JSON.stringify(path.join(bin, "ps-mode"))},countFile=${JSON.stringify(path.join(bin, "ps-calls"))};
      const mode=fs.existsSync(modeFile)?fs.readFileSync(modeFile,'utf8'):'';
      const count=fs.existsSync(countFile)?Number(fs.readFileSync(countFile,'utf8'))+1:1;fs.writeFileSync(countFile,String(count));
      const state=mode==='running'||(mode==='running-then-stopped'&&count<3)?'S':'T';
      for(const line of text.trim().split('\\n').filter(Boolean)) {const fields=line.trim().split(/\\s+/),raw=fields.slice(5).join(' '),encoding=process.env.LC_ALL||process.env.LC_CTYPE||process.env.LANG||'C',cmd=/UTF-?8/i.test(encoding)?raw:raw.replace(/[^\\x00-\\x7f]/g,'?');
        console.log(commandOnly?fields[0]+' '+(fs.existsSync(${JSON.stringify(path.join(bin, 'locale-mode'))})&&!a.includes('-ww')?cmd.slice(0,24):cmd):utcOnly?fields[0]+' '+(fields[4]==='fixture-reused'?'Tue Jan 1 00:00:00 2025':${JSON.stringify(fixtureStart)}):fields.slice(0,3).join(' ')+' '+state+' '+(fields[4]==='fixture-reused'?'Tue Jan 1 00:00:00 2025':date));}
      const file=${JSON.stringify(path.join(bin, "claude-pids"))};if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').trim().split('\\n')){
        const row=JSON.parse(line);if(text.split('\\n').some(line=>line.trim().startsWith(row.ppid+' ')))console.log(commandOnly?row.pid+' claude':utcOnly?row.pid+' '+${JSON.stringify(fixtureStart)}:row.pid+' '+row.ppid+' '+row.ppid+' T '+date);}
      console.log(commandOnly?process.ppid+' fixture-control':utcOnly?process.ppid+' '+${JSON.stringify(fixtureStart)}:process.ppid+' 1 '+process.ppid+' T '+date);}`);
    write(path.join(bin, "tree"), "");
    const observations = path.join(bin, "launch-markers");
    const markerObservation = `const roots=require('fs').readdirSync(${JSON.stringify(scratch)}).filter(n=>n.startsWith('control-'));
      const persisted=roots.some(n=>{const f=require('path').join(${JSON.stringify(scratch)},n,'attempt-records/MONO-999-a1.json');
        return require('fs').existsSync(f)&&JSON.parse(require('fs').readFileSync(f,'utf8')).entry.attemptMarker===process.env.MONO_ATTEMPT;});
      require('fs').appendFileSync(${JSON.stringify(observations)},JSON.stringify({transport:process.argv[1].split('/').at(-1),marker:process.env.MONO_ATTEMPT,
        childMarker:require('child_process').execFileSync(process.execPath,['-e','process.stdout.write(process.env.MONO_ATTEMPT||"")'],{encoding:'utf8'}),persisted})+'\\n');`;
    tool("codex", `const fs=require('fs');${markerObservation}if(fs.existsSync(${JSON.stringify(path.join(bin, "detach"))})){
      const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();
      fs.writeFileSync(${JSON.stringify(path.join(bin, "detached-pid"))},String(child.pid));}
      if(fs.existsSync(${JSON.stringify(path.join(bin, "double-fork"))})){
        const code="const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();require('fs').writeFileSync("+JSON.stringify(${JSON.stringify(path.join(bin, "orphan-pid"))})+",String(child.pid));";
        const parent=require('child_process').spawn(process.execPath,['-e',code],{detached:true,stdio:'ignore'});parent.unref();}
      if(!fs.existsSync(${JSON.stringify(path.join(bin, "no-thread"))}))console.log(JSON.stringify({type:'thread.started',thread_id:'backup-fixture-'+process.pid}));
      setInterval(()=>{if(fs.existsSync(${JSON.stringify(path.join(bin, "late-detach"))})){
        fs.unlinkSync(${JSON.stringify(path.join(bin, "late-detach"))});
        const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();
        fs.writeFileSync(${JSON.stringify(path.join(bin, "late-pid"))},String(child.pid));}},10);`);
    tool("gh", "process.stdout.write('fixture-auth');");
    tool("claude", `const a=process.argv; if(a.includes('auth')) {console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}));process.exit(0);}
      ${markerObservation}
      let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const val=k=>a[a.indexOf(k)+1],id=val(a.includes('--resume')?'--resume':'--session-id');
      require('fs').appendFileSync(${JSON.stringify(path.join(bin, "claude-pids"))},JSON.stringify({pid:process.pid,ppid:process.ppid})+'\\n');
      console.log(JSON.stringify({type:'system',subtype:'init',session_id:id,model:val('--model'),permissionMode:'dontAsk',apiKeySource:'none',mcp_servers:[],tools:['Bash','Read','Edit','Write','NotebookEdit','Glob','Grep']}));
      console.log(JSON.stringify({type:'assistant',session_id:id,message:{model:val('--model'),content:[{type:'text',text:'fixture response'}]}}));setInterval(()=>{},1000);});`);
    // Only the fixture relaxes the socket path bound; the production checks
    // remain covered by the Claude transport's own named tests.
    const adapter = path.join(pack, "scripts/transports/claude-cli.mjs");
    write(adapter, fs.readFileSync(adapter, "utf8").replace("const maximumTemporaryPathBytes = 44;", "const maximumTemporaryPathBytes = Number.MAX_SAFE_INTEGER;"));
    process.env.PATH = `${bin}:${savedPath}`;
    const runtime = await import(pathToFileURL(path.join(pack, "scripts/orchestrator/launch.mjs")));
    const routes = await import(pathToFileURL(path.join(pack, "scripts/runtime.mjs")));
    const switchRuntime = await import(pathToFileURL(path.join(pack, "scripts/orchestrator/backup-switch.mjs")));
    const macRuntimeFile = path.join(pack, "scripts/runtime-mac-fixture.mjs");
    write(macRuntimeFile, fs.readFileSync(path.join(pack, "scripts/runtime.mjs"), "utf8")
      .replaceAll('process.platform === "linux"', 'false').replaceAll('process.platform === "darwin"', 'true'));
    const macRuntime = await import(pathToFileURL(macRuntimeFile));
    const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-b", "fixture"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    const configFile = path.join(repo, ".agents/mono-workflow.config.json");
    const config = { orchestration: { transport: "codex-cli", backupTransport: "claude-cli" } };
    write(configFile, config); git("add", "."); git("commit", "-m", "backup mandate");
    const base = git("rev-parse", "HEAD"), identity = routes.packLayout(pack).identity();
    let serial = 0;
    const setup = async (primary = "codex-cli", { deferStartup = false } = {}) => {
      const backupTransport = primary === "codex-cli" ? "claude-cli" : "codex-cli";
      let setupBase = base;
      if (primary !== "codex-cli") {
        write(configFile, { orchestration: { transport: primary, backupTransport } });
        git("add", "."); git("commit", "--allow-empty", "-m", "reverse backup mandate"); setupBase = git("rev-parse", "HEAD");
      }
      const root = path.join(scratch, "control-" + ++serial), temp = path.join(scratch, "temp-" + serial);
      fs.mkdirSync(temp); write(path.join(root, "workers.json"), {}); write(path.join(root, "control.json"), { state: "active" }); writeWatcherFixture(root);
      const roots = [repo, path.join(repo, ".git"), path.join(root, "reports"), temp].sort();
      const request = { root, issue: "MONO-999", worktree: repo, branch: "fixture", base: setupBase, packRoot: pack, skillsRoot: pack, ...identity,
        role: primary === "codex-cli" ? "worker-default" : "worker-claude", transport: primary, dispatchFile: path.join(root, "task.md"), evidenceRoot: path.join(root, "evidence"),
        writable_roots: [temp], workerWritableRoots: roots, gates: [], lifecycle_moves: [], config: configFile, handshake: "resume", profile: "full" };
      write(request.dispatchFile, "fixture");
      const pin = (req, attempt = 1) => {
        const pinsFile = path.join(root, "dispatch", `MONO-999-a${attempt}`, "pins.json");
        const modelRoutes = runtime.resolveWorkerPins(req);
        write(pinsFile, { base: req.base, modelRoutes, workerWritableRoots: roots, ...(req.backupSwitch ? { backupSwitch: req.backupSwitch } : {}) });
        return { ...req, modelRoutes, pins: { file: pinsFile, digest: crypto.createHash("sha256").update(fs.readFileSync(pinsFile)).digest("hex") } };
      };
      const starting = runtime.spawnWorker(pin(request));
      const startResult = starting.then(value => ({ value }), error => ({ error }));
      let first;
      if (deferStartup) {
        for (let n = 0; n < 200; n++) {
          const pid = json(path.join(root, "workers.json"))[request.issue]?.pid;
          if (pid && !fs.existsSync(path.join(root, "launch.lock"))) { first = { pid }; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(first?.pid, "startup registered its writer");
      } else first = await starting;
      pids.add(first.pid);
      write(path.join(bin, "tree"), `${first.pid} 1 ${first.pid} S fixture-start-${first.pid}\n`);
      const old = json(path.join(root, "workers.json"))[request.issue];
      assert.equal(old.confirmationTimeoutSec, 1800);
      assert.equal(old.collectionTimeoutSec, 1500);
      assert.equal(old.collectionRetries, 1);
      const logLine = JSON.stringify({ type: "error", message: "fixture refusal (training data)" });
      fs.appendFileSync(old.log, logLine + "\n");
      const evidenceFile = path.join(root, "evidence.txt"); write(evidenceFile, logLine + "\n");
      const raw = { issue: request.issue, previousAttempt: 1, reason: "subscription-exhausted", backupTransport, evidenceFile, training: true };
      const backup = () => {
        const req = { ...request, role: backupTransport === "codex-cli" ? "worker-default" : "worker-claude", transport: backupTransport, backupSwitch: raw };
        return pin({ ...req, backupSwitch: switchRuntime.resolveBackupSwitch(req) }, 2);
      };
      const retire = async () => {
        await switchRuntime.stopBackupProcessTree(root, request.issue);
        await stop(first.pid); write(path.join(root, "workers.json"), {}); write(path.join(bin, "tree"), "");
      };
      return { root, request, first, old, raw, backup, retire, pin, startResult, record: path.join(root, "attempt-records/MONO-999-a1.json") };
    };
    const f = await setup();
    await t.test("backup-previous-registry-not-retired", async () => {
      await assert.rejects(runtime.spawnWorker(f.backup()), /already registered/);
      assert.equal(json(path.join(f.root, "attempts.json"))[f.request.issue], 1);
    });
    write(path.join(f.root, "workers.json"), {});
    await t.test("backup-previous-worker-live", async () => {
      write(path.join(bin, "tree"), `${f.first.pid} 1 ${f.first.pid} S fixture-start-${f.first.pid}\n`);
      await assert.rejects(runtime.spawnWorker(f.backup()), /previous worker.*live/);
    });
    write(path.join(f.root, "workers.json"), { [f.request.issue]: f.old });
    await f.retire();
    await t.test("backup-process-telemetry-localized-caller-keeps-incarnation-and-private-unicode-reference", () => {
      const file = path.join(bin, "locale-mode"), command = "node " + "x".repeat(100) + " " + f.old.worktree + "/Тест-目录/check.mjs";
      const oldLocale = process.env.LC_ALL;
      write(file, "simulate localized ps and narrow default columns"); process.env.LC_ALL = "de_DE.UTF-8";
      write(path.join(bin, "tree"), `900030 1 900030 S fixture-start ${command}\n`);
      try {
        const row = routes.processTable().find(row => row.pid === 900030);
        assert.equal(row.procStart, "Mo. 01 Jan. 2024 00:00:00", "legacy caller-locale identity is preserved");
        assert.equal(routes.processStart(row.pid), row.procStart);
        if (process.platform === "darwin") assert.equal(path.basename(row.command), "node");
        else assert.equal(row.command, command);
        assert.equal(routes.readProcessAttemptReference(row, [f.old.worktree + "/Тест-目录/check.mjs"]), "matched");
      } finally {
        if (oldLocale === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = oldLocale;
        fs.unlinkSync(file); write(path.join(bin, "tree"), "");
      }
    });
    await t.test("backup-unrelated-new-host-process-allows-stop-and-launch", async () => {
      const before = fs.readFileSync(f.record, "utf8");
      write(path.join(bin, "tree"), "900009 1 900009 S fixture-unrelated\n");
      write(path.join(f.root, "workers.json"), { [f.request.issue]: f.old });
      try {
        const stopped = await switchRuntime.stopBackupProcessTree(f.root, f.request.issue);
        assert.equal(stopped.retirement.proof, "already-stopped");
        write(path.join(f.root, "workers.json"), {});
        assert.ok(switchRuntime.validateBackupLaunch(f.backup(), 1, f.old.workerWritableRoots));
        assert.deepEqual(json(f.record).entry.processBaseline, JSON.parse(before).entry.processBaseline);
      } finally { write(f.record, before); write(path.join(f.root, "workers.json"), {}); write(path.join(bin, "tree"), ""); }
    });
    const ownershipCase = async (rows, { marker = f.old.attemptMarker, outputs = {}, capture = [], collector = null,
      baseline = f.old.processBaseline, legacyStarts = false, observedAt = null, resumeEntry = null, extraEntry = {} } = {}, refused = true) => {
      const before = fs.readFileSync(f.record, "utf8"), old = structuredClone(f.old);
      const entry = { ...old, processBaseline: baseline, ...extraEntry };
      if (marker) entry.attemptMarker = marker; else delete entry.attemptMarker;
      const record = JSON.parse(before); record.entry = entry;
      record.retirement.processes.push(...capture);
      if (legacyStarts) {
        delete entry.procStartEpoch;
        for (const row of [...record.processes, ...record.retirement.processes]) {
          delete row.procStartEpoch; delete row.observedByEpoch;
        }
      }
      if (observedAt) {
        record.retirement.capturedAt = observedAt;
        entry.last_activity_at = observedAt;
      }
      const collectorFile = path.join(f.root, "reports", "MONO-999-collector-a1.lock");
      Object.assign(markerOutputs, outputs); write(markersFile, markerOutputs);
      write(f.record, record); write(path.join(bin, "tree"), rows);
      write(path.join(f.root, "workers.json"), { [f.request.issue]: entry });
      if (resumeEntry) {
        const resumed = { ...entry, ...resumeEntry };
        switchRuntime.recordAttempt(f.root, resumed);
        write(path.join(f.root, "workers.json"), { [f.request.issue]: resumed });
      }
      if (collector) write(collectorFile, collector);
      try {
        if (refused) {
          await assert.rejects(switchRuntime.stopBackupProcessTree(f.root, f.request.issue), /(?:descendants still live|unattributed processes|process baseline missing).*?(?:switching|stopped tree)/);
          write(path.join(f.root, "workers.json"), {});
          assert.throws(() => switchRuntime.validateBackupLaunch(f.backup(), 1, old.workerWritableRoots), /(?:descendants still live|unattributed processes|process baseline missing).*?(?:refused|switching)/);
        } else {
          const stopped = await switchRuntime.stopBackupProcessTree(f.root, f.request.issue);
          write(path.join(f.root, "workers.json"), {});
          const proof = switchRuntime.validateBackupLaunch(f.backup(), 1, old.workerWritableRoots);
          return { stopped, proof, record: json(f.record) };
        }
      } finally {
        write(f.record, before); write(path.join(f.root, "workers.json"), {}); write(path.join(bin, "tree"), "");
        for (const pid of Object.keys(outputs)) delete markerOutputs[pid]; write(markersFile, markerOutputs);
        if (collector) fs.unlinkSync(collectorFile);
      }
    };
    for (const legacy of [false, true]) {
      const label = legacy ? "legacy" : "marked", marker = legacy ? null : f.old.attemptMarker;
      await t.test(`backup-${label}-captured-group-blocks-both-entries-marker-unavailable`, () =>
        ownershipCase(`900010 1 ${f.first.pid} S fixture-start-900010 node\n`, { marker }));
      await t.test(`backup-${label}-parent-chain-blocks-both-entries-marker-unavailable`, () =>
        ownershipCase("900011 1 900111 S fixture-parent node\n900012 900011 900112 S fixture-child node\n", {
          marker, capture: [{ pid: 900011, procStart: fixtureStart, processGroup: 900211 }],
        }));
      for (const reference of [f.old.worktree + "/scripts/check.mjs", f.old.log, f.old.pins.file])
        await t.test(`backup-${label}-exact-reference-${path.basename(reference)}-blocks-both-entries-marker-unavailable`, () =>
          ownershipCase(`900013 1 900013 S fixture-path node ${reference}\n`, { marker }));
    }
    await t.test("backup-missing-and-invalid-baseline-refuse-both-entries", async () => {
      await ownershipCase("", { baseline: null });
      await ownershipCase("", { baseline: [{ pid: 0, procStart: fixtureStart }] });
    });
    await t.test("backup-legacy-localized-captured-group-is-not-pid-reuse-on-both-entries", async () => {
      const file = path.join(bin, "locale-mode"), oldLocale = process.env.LC_ALL;
      write(file, "localized legacy identities"); process.env.LC_ALL = "de_DE.UTF-8";
      try {
        await ownershipCase("900040 1 900040 S fixture-old node\n", { marker: null,
          capture: [{ pid: 900040, procStart: "Mo. 01 Jan. 2024 00:00:00", processGroup: 900040 }] });
      } finally {
        if (oldLocale === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = oldLocale;
        fs.unlinkSync(file);
      }
    });
    await t.test("backup-exact-attempt-path-shell-separators-and-redirections-block-both-entries", async () => {
      for (const command of [`cd ${f.old.worktree};sleep 600`, `(cd ${f.old.worktree})`,
        `cat<${f.old.log}>/dev/null`, `cd ${f.old.worktree}&&sleep 600`])
        await ownershipCase(`900041 1 900041 S fixture-shell sh -c ${command}\n`, { marker: null });
    });
    await t.test("backup-legacy-incomparable-start-format-retains-captured-group-on-both-entries", () =>
      ownershipCase("900044 1 900044 S fixture-old node\n", { marker: null,
        capture: [{ pid: 900044, procStart: "Mo. 01 Jan. 2024 00:00:00", processGroup: 900044 }] }));
    await t.test("backup-start-time-zone-change-does-not-prove-pid-reuse-on-both-entries", () =>
      ownershipCase("900047 1 900047 S fixture-old node\n", { marker: null,
        capture: [{ pid: 900047, procStart: "Mon Jan 1 09:00:00 2024", procStartEpoch: Date.UTC(2024, 0, 1), processGroup: 900047 }] }));
    await t.test("backup-independent-utc-start-proves-reuse-even-with-equal-formatted-times", () =>
      ownershipCase("900048 1 900048 S fixture-old node\n", { marker: null,
        capture: [{ pid: 900048, procStart: fixtureStart, procStartEpoch: Date.UTC(2023, 0, 1), processGroup: 900048 }] }, false));
    await t.test("backup-utc-start-observation-preserves-baseline-shape", () => {
      assert.equal(f.old.procStartEpoch, Date.UTC(2024, 0, 1));
      for (const row of f.old.processBaseline) assert.deepEqual(Object.keys(row).sort(), ["pid", "procStart"]);
    });
    await t.test("backup-successful-ps-fallback-is-unavailable-and-counted-on-both-entries", async () => {
      const outputs = { 900043: { fallback: "(node)" } };
      Object.assign(markerOutputs, outputs); write(markersFile, markerOutputs);
      assert.equal(macRuntime.readProcessAttemptMarker({ pid: 900043, procStart: fixtureStart }, f.old.attemptMarker), "unavailable");
      delete markerOutputs[900043]; write(markersFile, markerOutputs);
      const result = await ownershipCase("900043 1 900043 S fixture-fallback node\n", { outputs }, false);
      assert.equal(result.proof.ownership.unavailableMarkerCount, 1);
      assert.equal(result.stopped.retirement.processOwnership.unavailableMarkerCount, 1);
    });
    await t.test("backup-mac-marker-reader-checks-real-user-environment-visibility", () => {
      markerOutputs[900045] = { ruid: process.getuid() + 1, text: "node readable-arguments-without-environment" };
      write(markersFile, markerOutputs);
      try { assert.equal(macRuntime.readProcessAttemptMarker({ pid: 900045, procStart: fixtureStart }, f.old.attemptMarker), "unavailable"); }
      finally { delete markerOutputs[900045]; write(markersFile, markerOutputs); }
    });
    await t.test("backup-mac-marker-reader-preserves-argv-and-environment-value-boundaries", () => {
      const marker = f.old.attemptMarker, row = { pid: 900046, procStart: fixtureStart };
      const cases = [
        [{ text: `node MONO_ATTEMPT=${marker} HOME=/tmp`, argv: ["node", `MONO_ATTEMPT=${marker}`], environ: "HOME=/tmp\0" }, "unavailable"],
        [{ text: `node NOTE=contains MONO_ATTEMPT=${marker}`, environ: `NOTE=contains MONO_ATTEMPT=${marker}\0` }, "unavailable"],
        [{ text: `node NOTE=contains MONO_ATTEMPT=${marker} MONO_ATTEMPT=${marker}`, environ: `NOTE=contains MONO_ATTEMPT=${marker}\0MONO_ATTEMPT=${marker}\0` }, "matched"],
        [{ text: `node MONO_ATTEMPT=${marker}`, nativeUnavailable: true }, "unavailable"],
        [{ text: "node ordinary-arguments", nativeEnvOmitted: true }, "unavailable"],
        [{ text: `MONO_ATTEMPT=${marker}`, argv: [""], environ: `MONO_ATTEMPT=${marker}\0` }, "matched"]
      ];
      try { for (const [output, expected] of cases) {
        markerOutputs[row.pid] = output; write(markersFile, markerOutputs);
        assert.equal(macRuntime.readProcessAttemptMarker(row, marker), expected);
      } } finally { delete markerOutputs[row.pid]; write(markersFile, markerOutputs); }
    });
    await t.test("backup-mac-marker-probe-does-not-load-workspace-python-startup-code", () => {
      const cwd = process.cwd(), trap = path.join(scratch, "python-trap"), loaded = path.join(trap, "site-loaded");
      write(path.join(trap, "sitecustomize.py"), `open(${JSON.stringify(loaded)}, "w").write("unexpected import")\n`);
      markerOutputs[900050] = `MONO_ATTEMPT=${f.old.attemptMarker}\0`; write(markersFile, markerOutputs);
      try {
        process.chdir(trap);
        assert.equal(macRuntime.readProcessAttemptMarker({ pid: 900050, procStart: fixtureStart }, f.old.attemptMarker), "matched");
        assert.equal(fs.existsSync(loaded), false);
      } finally { process.chdir(cwd); delete markerOutputs[900050]; write(markersFile, markerOutputs); }
    });
    await t.test("backup-mac-command-table-empty-argv-does-not-expose-environment", async () => {
      const secret = "EMPTY_ARGV_ENV_SECRET_DECOY_146", pid = 900085;
      markerOutputs[pid] = { argv: ["", "", "node"], text: `node SECRET=${secret}`, environ: `SECRET=${secret}\0` };
      write(markersFile, markerOutputs);
      write(path.join(bin, "tree"), `${pid} 1 ${pid} S fixture-empty node SECRET=${secret}\n`);
      try {
        const table = macRuntime.processTable();
        assert.equal(path.basename(table.find(row => row.pid === pid).command), "node");
        assert.ok(!JSON.stringify(table).includes(secret));
      } finally { delete markerOutputs[pid]; write(markersFile, markerOutputs); write(path.join(bin, "tree"), ""); }
    });
    await t.test("backup-mac-rewritten-title-keeps-arguments-private-without-environment-export", async () => {
      const secret = "REWRITTEN_TITLE_ENV_SECRET_DECOY_146", pid = 900086;
      const output = { argv: ["x".repeat(128)], claimedArgc: 4, text: "rewritten-title",
        environ: `SECRET=${secret}\0MONO_ATTEMPT=${f.old.attemptMarker}\0HOME=/tmp\0PATH=/usr/bin\0` };
      markerOutputs[pid] = output; write(markersFile, markerOutputs);
      write(path.join(bin, "tree"), `${pid} 1 ${pid} S fixture-title node\n`);
      try {
        const table = macRuntime.processTable();
        assert.equal(path.basename(table.find(row => row.pid === pid).command), "node");
        assert.ok(!JSON.stringify(table).includes(secret));
        assert.equal(macRuntime.readProcessAttemptMarker({ pid, procStart: fixtureStart }, f.old.attemptMarker), "unavailable");
      } finally { delete markerOutputs[pid]; write(markersFile, markerOutputs); write(path.join(bin, "tree"), ""); }
      const result = await ownershipCase(`${pid} 1 ${pid} S fixture-title node\n`, { outputs: { [pid]: output } }, false);
      assert.equal(result.proof.ownership.unavailableMarkerCount, 1);
      assert.equal(result.stopped.retirement.processOwnership.unavailableMarkerCount, 1);
    });
    await t.test("backup-mac-inline-arrow-and-option-equals-retain-command-path", () => {
      const pid = 900087, body = `setInterval(()=>require("fs").appendFileSync("${f.old.worktree}/out","x"),1000)`;
      const output = { argv: ["node", "--stack-trace-limit=20", "-e", body], text: "node",
        environ: "HOME=/tmp\0" };
      return ownershipCase(`${pid} 1 ${pid} S fixture-arrow node --stack-trace-limit=20 -e ${body}\n`,
        { marker: null, outputs: { [pid]: output } });
    });
    await t.test("backup-mac-unicode-environment-name-does-not-escape-rewritten-title", () => {
      const secret = "UNICODE_ENV_NAME_SECRET_DECOY_146", pid = 900088;
      markerOutputs[pid] = { argv: ["x".repeat(128)], claimedArgc: 2, text: "rewritten-title",
        environ: `ЗАМЕТКА=${secret}\0MONO_ATTEMPT=${f.old.attemptMarker}\0HOME=/tmp\0` };
      write(markersFile, markerOutputs); write(path.join(bin, "tree"), `${pid} 1 ${pid} S fixture-title node\n`);
      try {
        const table = macRuntime.processTable();
        assert.equal(path.basename(table.find(row => row.pid === pid).command), "node");
        assert.ok(!JSON.stringify(table).includes(secret));
      } finally { delete markerOutputs[pid]; write(markersFile, markerOutputs); write(path.join(bin, "tree"), ""); }
    });
    await t.test("backup-mac-assignment-shaped-argument-preserves-marker-and-literal-traces", async () => {
      const pid = 900089, body = `x=1; setInterval(()=>require("fs").appendFileSync("${f.old.worktree}/out","x"),1000)`;
      const output = { argv: ["node", "-e", body], text: `node MONO_ATTEMPT=${f.old.attemptMarker}`,
        environ: `HOME=/tmp\0MONO_ATTEMPT=${f.old.attemptMarker}\0` };
      markerOutputs[pid] = output; write(markersFile, markerOutputs);
      try { assert.equal(macRuntime.readProcessAttemptMarker({ pid, procStart: fixtureStart }, f.old.attemptMarker), "matched"); }
      finally { delete markerOutputs[pid]; write(markersFile, markerOutputs); }
      for (const marker of [f.old.attemptMarker, null]) {
        await ownershipCase(`${pid} 1 ${pid} S fixture-assignment node -e ${body}\n`, { marker, outputs: { [pid]: output } });
      }
    });
    await t.test("backup-mac-nonidentifier-environment-name-never-escapes-title", () => {
      const secret = "NONIDENTIFIER_ENV_SECRET_DECOY_146", pid = 900090;
      markerOutputs[pid] = { argv: ["x".repeat(128)], claimedArgc: 2, text: "rewritten-title",
        environ: `SECRET/KEY=${secret}\0HOME=/tmp\0` };
      write(markersFile, markerOutputs); write(path.join(bin, "tree"), `${pid} 1 ${pid} S fixture-title node\n`);
      try { assert.ok(!JSON.stringify(macRuntime.processTable()).includes(secret)); }
      finally { delete markerOutputs[pid]; write(markersFile, markerOutputs); write(path.join(bin, "tree"), ""); }
    });
    await t.test("backup-matched-attempt-marker-blocks-both-entries", () => ownershipCase(
      "900014 1 900014 S fixture-marker node\n", { outputs: { 900014: `SECRET_DECOY=must-not-escape\0MONO_ATTEMPT=${f.old.attemptMarker}\0` } }));
    await t.test("backup-unavailable-marker-without-other-signals-allows-and-records-count", async () => {
      const result = await ownershipCase("900015 1 900015 S fixture-unknown node\n", {}, false);
      assert.equal(result.proof.ownership.unavailableMarkerCount, 1);
      assert.equal(result.stopped.retirement.processOwnership.unavailableMarkerCount, 1);
    });
    await t.test("backup-control-caller-other-task-collector-prefix-and-unrelated-process-allow-both-entries", async () => {
      const rows = `${process.pid} 1 ${process.pid} S fixture-control node '${f.old.worktree}' ${f.old.thread_id}\n` +
        `900016 1 900016 S fixture-collector node '${pack}/scripts/orchestrator/collector.mjs' --root '${f.root}' --issue MONO-998 --attempt 1\n` +
        `900017 1 900017 S fixture-prefix node '${f.old.worktree}-other/check'\n` +
        "900018 1 900018 S fixture-host browser\n";
      const result = await ownershipCase(rows, {}, false);
      assert.equal(result.proof.ownership.unavailableMarkerCount, 3);
    });
    await t.test("backup-reused-pid-with-different-start-time-allows-both-entries", () =>
      ownershipCase(`${f.first.pid} 1 ${f.first.pid} S fixture-reused node\n`, {}, false));
    await t.test("backup-legacy-reused-pid-born-after-protected-observation-allows-both-entries", () =>
      ownershipCase(`${f.first.pid} 1 ${f.first.pid} S fixture-reused node\n`, {
        marker: null, legacyStarts: true, observedAt: "2024-06-01T00:00:00.000Z"
      }, false));
    await t.test("backup-legacy-resume-preserves-each-writers-original-observation-bound", async () => {
      const observedAt = "2024-06-01T00:00:00.000Z";
      const result = await ownershipCase(`${f.first.pid} 1 ${f.first.pid} S fixture-reused node\n`, {
        marker: null, legacyStarts: true, observedAt,
        resumeEntry: { pid: 900049, processGroup: 900049, procStart: "Thu Jan 1 00:00:00 2026",
          procStartEpoch: Date.UTC(2026, 0, 1), last_activity_at: "2026-01-02T00:00:00.000Z" }
      }, false);
      assert.equal(result.record.processes.find(row => row.pid === f.first.pid).observedByEpoch, Date.parse(observedAt));
      assert.equal(result.record.processes.find(row => row.pid === 900049).observedByEpoch, Date.parse("2026-01-02T00:00:00.000Z"));
    });
    await t.test("backup-previous-attempt-collector-and-active-gate-descendants-block-both-entries", async () => {
      const collector = { pid: 900019, procStart: fixtureStart, processGroup: 900019,
        gate: { pid: 900020, procStart: fixtureStart, processGroup: 900020 } };
      await ownershipCase("900019 1 900019 S fixture-collector node\n", { collector });
      await ownershipCase("900021 1 900020 S fixture-check node\n", { collector });
      const retained = { ...collector, descendants: [{ pid: 900025, procStart: fixtureStart, processGroup: 900025 }] };
      await ownershipCase("900025 1 900125 S fixture-retained-check node\n", { collector: retained });
      await ownershipCase("900026 1 900025 S fixture-retained-group node\n", { collector: retained });
    });
    await t.test("backup-previous-collector-under-control-caller-still-blocks-both-entries", () => {
      const collector = { pid: 900052, procStart: fixtureStart, processGroup: 900052,
        gate: { pid: 900053, procStart: fixtureStart, processGroup: 900053 },
        descendants: [{ pid: 900054, procStart: fixtureStart, processGroup: 900054 }] };
      return ownershipCase(`900052 ${process.pid} 900052 S fixture-collector node\n900053 900052 900053 S fixture-gate node\n900054 900053 900054 S fixture-check node\n`, { collector });
    });
    await t.test("backup-path-bounded-literal-reference-blocks-both-entries", async () => {
      for (const suffix of ["", "/check.js", "'", '"', ";", ")", " ", ",", "$", "\\", "é"]) {
        await ownershipCase(`900055 1 900055 S fixture-literal node prefix${f.old.worktree}${suffix}\n`, { marker: null });
      }
    });
    await t.test("backup-longer-sibling-path-and-product-root-do-not-match-both-entries", async () => {
      for (const reference of [f.root, ...["-2", "_other", ".bak", "2", "A"].map(suffix => f.old.worktree + suffix)]) {
        await ownershipCase(`900056 1 900056 S fixture-prefix node '${reference}'\n`, {}, false);
      }
    });
    await t.test("backup-node-value-option-before-inline-literal-blocks-both-entries", () =>
      ownershipCase(`900077 1 900077 S fixture-node node --v8-pool-size 4 -e 'process.chdir("${f.old.worktree}")'\n`, { marker: null }));
    await t.test("backup-node-private-field-before-inline-literal-blocks-both-entries", () =>
      ownershipCase(`900078 1 900078 S fixture-node node -e 'class C { #x = 1; } process.chdir("${f.old.worktree}")'\n`, { marker: null }));
    await t.test("backup-quoted-path-literal-blocks-both-entries", () =>
      ownershipCase(`900079 1 900079 S fixture-quoted node '${f.old.worktree}'\n`, { marker: null }));
    await t.test("backup-inline-comments-patterns-and-template-literals-conservatively-block-both-entries", async () => {
      for (const command of [`node -e '// ${f.old.worktree}'`, `grep -e 'prefix ${f.old.worktree} suffix' /unrelated/log`,
        'node -e \'process.chdir(`' + f.old.worktree + '${"-other"}`)\'']) {
        await ownershipCase(`900080 1 900080 S fixture-literal ${command}\n`, { marker: null });
      }
    });
    await t.test("backup-marker-reader-tristate-and-secret-decoy-never-escapes", async () => {
      const linuxRuntime = path.join(pack, "scripts/runtime-linux-fixture.mjs");
      write(linuxRuntime, fs.readFileSync(path.join(pack, "scripts/runtime.mjs"), "utf8").replaceAll('process.platform === "linux"', 'true'));
      const linux = await import(pathToFileURL(linuxRuntime));
      const row = { pid: 900022, procStart: fixtureStart }, secret = "UNRELATED_SECRET_DECOY_146";
      for (const [output, verdict] of [[`SECRET=${secret}\0MONO_ATTEMPT=${f.old.attemptMarker}\0`, "matched"],
        [`SECRET=${secret}\0MONO_ATTEMPT=other-attempt\0`, "absent"], [null, "unavailable"]]) {
        markerOutputs[row.pid] = output; write(markersFile, markerOutputs);
        assert.equal(routes.readProcessAttemptMarker(row, f.old.attemptMarker), verdict);
        assert.equal(linux.readProcessAttemptMarker(row, f.old.attemptMarker), verdict);
      }
      assert.equal(routes.readProcessAttemptMarker({ ...row, procStart: "different incarnation" }, f.old.attemptMarker), "unavailable");
      markerOutputs[row.pid] = `SECRET=${secret}\0MONO_ATTEMPT=${f.old.attemptMarker}\0`; write(markersFile, markerOutputs);
      write(path.join(bin, "tree"), `${row.pid} 1 ${row.pid} S fixture-env node\n`);
      const table = routes.processTable();
      assert.equal(path.basename(table.find(r => r.pid === row.pid).command), "node");
      assert.ok(!JSON.stringify(table).includes(secret));
      let failure;
      try { switchRuntime.validateBackupLaunch(f.backup(), 1, f.old.workerWritableRoots); } catch (error) { failure = error; }
      assert.match(failure.message, /900022/); assert.ok(!String(failure.stack).includes(secret));
      const inspect = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) inspect(file); else assert.ok(!fs.readFileSync(file, "utf8").includes(secret), file);
      } };
      inspect(f.root);
      delete markerOutputs[row.pid]; write(markersFile, markerOutputs); write(path.join(bin, "tree"), "");
    });
    for (const primary of ["codex-cli", "claude-cli"]) await t.test(`backup-${primary}-attempt-marker-persisted-before-launch-and-inherited-on-resume`, async () => {
      const fixture = await setup(primary);
      const marker = json(fixture.record).entry.attemptMarker;
      assert.match(marker, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      assert.notEqual(marker, f.old.attemptMarker);
      await fixture.retire(); write(path.join(fixture.root, "workers.json"), { [fixture.request.issue]: fixture.old });
      const resumeFile = path.join(fixture.root, "resume.md"); write(resumeFile, "resume fixture");
      const resumed = await runtime.resumeWorker({ root: fixture.root, issue: fixture.request.issue, resumeFile }); pids.add(resumed.pid);
      // Codex resume returns on spawn; wait for the stub's observation.
      for (let n = 0; n < 200 && fs.readFileSync(observations, "utf8").split("\n").filter(line => line.includes(marker)).length < 2; n++)
        await new Promise(resolve => setTimeout(resolve, 10));
      const seen = fs.readFileSync(observations, "utf8").trim().split("\n").map(JSON.parse).filter(o => o.marker === marker);
      assert.equal(seen.length, 2); assert.ok(seen.every(o => o.persisted && o.childMarker === marker));
      assert.equal(json(fixture.record).entry.attemptMarker, marker);
      if (primary === "claude-cli") {
        const effective = json(json(fixture.record).entry.settingsFile);
        assert.equal(effective.disableAllHooks, true);
        assert.equal(effective.sandbox.allowUnsandboxedCommands, false);
        assert.equal(effective.permissions.defaultMode, "dontAsk");
        assert.equal(effective.env?.MONO_ATTEMPT, undefined, "managed settings do not replace the inherited marker");
      }
      await stop(resumed.pid); write(path.join(bin, "tree"), "");
      git("reset", "--hard", base);
    });
    await t.test("backup-failed-startup-retains-stoppable-registry-identity", async () => {
      write(path.join(bin, "no-thread"), "withhold startup identity");
      const starting = await setup("codex-cli", { deferStartup: true });
      try {
        assert.equal(starting.old.thread_id, null);
        assert.equal(starting.old.procStart, fixtureStart);
        await switchRuntime.stopBackupProcessTree(starting.root, starting.request.issue);
        await stop(starting.first.pid);
        assert.match((await starting.startResult).error.message, /exited before thread.started/);
        assert.equal(json(starting.record).retirement.stopRequested, true);
      } finally {
        fs.unlinkSync(path.join(bin, "no-thread")); await stop(starting.first.pid); await starting.startResult;
        write(path.join(bin, "tree"), "");
      }
    });
    await t.test("backup-stop-waits-for-stopped-process-states", async () => {
      const delayed = await setup();
      write(path.join(bin, "ps-mode"), "running-then-stopped"); write(path.join(bin, "ps-calls"), "0");
      try {
        const proof = await switchRuntime.stopBackupProcessTree(delayed.root, delayed.request.issue);
        assert.ok(Number(fs.readFileSync(path.join(bin, "ps-calls"), "utf8")) >= 3);
        assert.equal(proof.retirement.quiesced, true); assert.equal(proof.retirement.pending, false);
      } finally { fs.unlinkSync(path.join(bin, "ps-mode")); await stop(delayed.first.pid); write(path.join(bin, "tree"), ""); }
    });
    await t.test("backup-stop-running-process-states-time-out-pending", async () => {
      const running = await setup();
      write(path.join(bin, "ps-mode"), "running"); write(path.join(bin, "ps-calls"), "0");
      try {
        await assert.rejects(switchRuntime.stopBackupProcessTree(running.root, running.request.issue), /quiescence unverified/);
        const proof = json(running.record).retirement;
        assert.equal(proof.pending, true); assert.equal(proof.quiesced, false); assert.equal(proof.stopRequested, false);
        assert.equal(json(path.join(running.root, "workers.json"))[running.request.issue].pid, running.first.pid);
        assert.equal(json(path.join(running.root, "attempts.json"))[running.request.issue], 1);
        await assert.rejects(switchRuntime.stopBackupProcessTree(running.root, running.request.issue), /incomplete prior stop/);
      } finally {
        fs.unlinkSync(path.join(bin, "ps-mode")); process.kill(running.first.pid, "SIGKILL"); await stop(running.first.pid);
        write(path.join(bin, "tree"), "");
      }
    });
    await t.test("backup-detached-descendant-live", async () => {
      write(path.join(bin, "detach"), "spawn detached child");
      const detached = await setup(); fs.unlinkSync(path.join(bin, "detach"));
      const childPid = Number(fs.readFileSync(path.join(bin, "detached-pid"), "utf8")); pids.add(childPid);
      write(path.join(bin, "tree"), `${detached.first.pid} 1 ${detached.first.pid} S fixture-start-${detached.first.pid}\n${childPid} ${detached.first.pid} ${childPid} S fixture-start-${childPid}\n`);
      const capture = pass(run(process.execPath, [path.join(pack, "scripts/orchestrator/backup-switch.mjs"), "stop", "--root", detached.root, "--issue", "MONO-999"], repo, process.env));
      assert.ok(JSON.parse(capture.stdout).retirement.processes.some(row => row.pid === childPid && row.processGroup === childPid));
      await stop(detached.first.pid); write(path.join(detached.root, "workers.json"), {});
      await stop(childPid);
      write(path.join(bin, "tree"), `${childPid} 1 ${childPid} S fixture-start-${childPid}\n`);
      try {
        await assert.rejects(async () => {
          const unexpected = await runtime.spawnWorker(detached.backup()); pids.add(unexpected.pid);
        }, /descendants still live/);
        assert.equal(json(path.join(detached.root, "attempts.json"))["MONO-999"], 1);
      } finally { await stop(childPid); write(path.join(bin, "tree"), ""); }
    });
    await t.test("backup-capture-prevents-late-process-creation", async () => {
      const late = await setup();
      await switchRuntime.stopBackupProcessTree(late.root, late.request.issue);
      write(path.join(bin, "late-detach"), "try to create a child after capture");
      await new Promise(resolve => setTimeout(resolve, 150));
      const latePidFile = path.join(bin, "late-pid");
      try {
        if (fs.existsSync(latePidFile)) pids.add(Number(fs.readFileSync(latePidFile, "utf8")));
        assert.equal(fs.existsSync(latePidFile), false, "a writer must not create a detached child after retirement capture");
      } finally {
        if (fs.existsSync(latePidFile)) { await stop(Number(fs.readFileSync(latePidFile, "utf8"))); fs.unlinkSync(latePidFile); }
        if (fs.existsSync(path.join(bin, "late-detach"))) fs.unlinkSync(path.join(bin, "late-detach"));
        await stop(late.first.pid); write(path.join(late.root, "workers.json"), {}); write(path.join(bin, "tree"), "");
      }
    });
    await t.test("backup-double-fork-before-stop-refused", async () => {
      write(path.join(bin, "double-fork"), "spawn and orphan before stop");
      const orphaned = await setup(); fs.unlinkSync(path.join(bin, "double-fork"));
      const pidFile = path.join(bin, "orphan-pid");
      for (let n = 0; !fs.existsSync(pidFile) && n < 200; n++) await new Promise(resolve => setTimeout(resolve, 10));
      const childPid = Number(fs.readFileSync(pidFile, "utf8")); pids.add(childPid);
      markerOutputs[childPid] = `MONO_ATTEMPT=${orphaned.old.attemptMarker}\0`; write(markersFile, markerOutputs);
      write(path.join(bin, "tree"), `${orphaned.first.pid} 1 ${orphaned.first.pid} S fixture-start-${orphaned.first.pid}\n${childPid} 1 ${childPid} S fixture-start-${childPid}\n`);
      try {
        await switchRuntime.stopBackupProcessTree(orphaned.root, orphaned.request.issue);
        await stop(orphaned.first.pid);
        write(path.join(bin, "tree"), `${childPid} 1 ${childPid} S fixture-start-${childPid}\n`);
        process.kill(childPid, 0);
        await assert.rejects(switchRuntime.stopBackupProcessTree(orphaned.root, orphaned.request.issue), /unattributed processes.*reconcile ownership/);
        write(path.join(orphaned.root, "workers.json"), {});
        await assert.rejects(runtime.spawnWorker(orphaned.backup()), /unattributed processes.*reconcile ownership/);
        assert.equal(json(path.join(orphaned.root, "attempts.json"))[orphaned.request.issue], 1);
        assert.deepEqual(json(path.join(orphaned.root, "workers.json")), {});
      } finally { await stop(childPid); delete markerOutputs[childPid]; write(markersFile, markerOutputs); write(path.join(bin, "tree"), ""); }
    });
    await t.test("backup-primary-already-exited-success", async () => {
      const exited = await setup();
      await stop(exited.first.pid); write(path.join(bin, "tree"), "");
      const captured = await switchRuntime.stopBackupProcessTree(exited.root, exited.request.issue);
      assert.equal(captured.retirement.proof, "already-stopped");
      write(path.join(exited.root, "workers.json"), {});
      const switched = await runtime.spawnWorker(exited.backup()); pids.add(switched.pid);
      assert.equal(switched.attempt, 2);
      assert.equal(json(path.join(exited.root, "workers.json"))[exited.request.issue].transport, "claude-cli");
      await stop(switched.pid);
    });
    const refusal = async (change, pattern) => {
      const record = fs.readFileSync(f.record, "utf8"), pins = fs.readFileSync(f.old.pins.file, "utf8"), raw = structuredClone(f.raw);
      try { await change(); await assert.rejects(async () => runtime.spawnWorker(f.backup()), pattern);
        assert.equal(json(path.join(f.root, "attempts.json"))[f.request.issue], 1); assert.deepEqual(json(path.join(f.root, "workers.json")), {});
      } finally { write(f.record, record); write(f.old.pins.file, pins); Object.assign(f.raw, raw); git("reset", "--hard", base); }
    };
    const oldConfig = cfg => {
      write(configFile, cfg); git("add", "."); git("commit", "-m", "old config variant");
      const oldBase = git("rev-parse", "HEAD"), record = json(f.record), pins = json(f.old.pins.file);
      record.entry.modelRoutes = routes.resolveModelRoutes(repo, oldBase, "worker-default", { packRoot: pack });
      record.entry.transport = cfg.orchestration.transport; pins.base = oldBase; pins.modelRoutes = record.entry.modelRoutes;
      write(f.old.pins.file, pins); record.entry.pins.digest = crypto.createHash("sha256").update(fs.readFileSync(f.old.pins.file)).digest("hex"); write(f.record, record);
    };
    await t.test("backup-process-tree-capture-missing", () => refusal(() => {
      const record = json(f.record); delete record.retirement; write(f.record, record);
    }, /tree capture missing/));
    await t.test("backup-process-tree-capture-incomplete", () => refusal(() => {
      const record = json(f.record); record.retirement.capturedWriters = []; write(f.record, record);
    }, /tree capture missing/));
    await t.test("backup-process-tree-not-quiesced", () => refusal(() => {
      const record = json(f.record); record.retirement.quiesced = false; write(f.record, record);
    }, /tree capture missing/));
    await t.test("backup-process-tree-stop-incomplete", () => refusal(() => {
      const record = json(f.record); record.retirement.stopRequested = false; write(f.record, record);
    }, /tree capture missing/));
    await t.test("backup-process-tree-stop-pending", () => refusal(() => {
      const record = json(f.record); record.retirement.pending = true; write(f.record, record);
    }, /tree capture missing/));
    await t.test("backup-process-tree-capture-after-retirement-refused", async () => {
      await assert.rejects(switchRuntime.stopBackupProcessTree(f.root, f.request.issue), /before stopping or retiring/);
    });
    await t.test("backup-launch-process-baseline-missing", () => refusal(() => {
      const record = json(f.record); delete record.entry.processBaseline; write(f.record, record);
    }, /launch process baseline missing/));
    await t.test("backup-launch-process-baseline-invalid", () => refusal(() => {
      const record = json(f.record); record.entry.processBaseline = [{ pid: 0, procStart: "invalid" }]; write(f.record, record);
    }, /launch process baseline missing/));
    for (const [name, cfg, pattern] of [
      ["backup-not-configured", { orchestration: { transport: "codex-cli" } }, /not configured/],
      ["backup-equals-primary", { orchestration: { transport: "codex-cli", backupTransport: "codex-cli" } }, /differ/],
      ["backup-legacy-primary", { orchestration: { transport: "fallback", backupTransport: "claude-cli" } }, /managed CLI primary/],
    ]) await t.test(name, () => refusal(() => oldConfig(cfg), pattern));
    await t.test("backup-reason-outside-dictionary", () => refusal(() => { f.raw.reason = "task-failed"; }, /reason must/));
    await t.test("backup-no-evidence", () => refusal(() => { f.raw.evidenceFile = path.join(f.root, "missing"); }, /evidence file/));
    await t.test("backup-foreign-evidence", () => refusal(() => { write(f.raw.evidenceFile, "not in journal"); }, /excerpt/));
    write(f.raw.evidenceFile, JSON.stringify({ type: "error", message: "fixture refusal (training data)" }) + "\n");
    await t.test("backup-new-base-backup-changed", () => refusal(() => {
      write(configFile, { orchestration: { transport: "codex-cli" } }); git("add", "."); git("commit", "-m", "new backup missing");
      f.request.base = git("rev-parse", "HEAD");
    }, /changed on new BASE/)); f.request.base = base;
    await t.test("backup-new-base-reviewer-changed", () => refusal(() => {
      const cfg = { ...config, models: { roles: { autoreview: { model: "fixture-reviewer" } } } };
      cfg.models.pairingAccepted = routes.requiredPairings(cfg, { packRoot: pack }).map(pair => ({ ...pair, linearDecision: "https://linear.app/example/issue/EX-1#comment-owner", by: "owner", date: "2026-10-01" }));
      write(configFile, cfg); git("add", "."); git("commit", "-m", "reviewer changed"); f.request.base = git("rev-parse", "HEAD");
    }, /reviewer route changed/)); f.request.base = base;
    await t.test("backup-orphan-descendant-live", () => refusal(() => {
      write(path.join(bin, "tree"), `900001 1 ${f.first.pid} S fixture-orphan\n`);
    }, /descendants still live/)); write(path.join(bin, "tree"), "");
    await t.test("backup-dirty-unresolved-worktree", async () => {
      const dirty = path.join(repo, "unfinished.txt"); write(dirty, "preserve me");
      try { await assert.rejects(runtime.spawnWorker(f.backup()), /working tree is dirty/); assert.equal(fs.readFileSync(dirty, "utf8"), "preserve me"); }
      finally { fs.unlinkSync(dirty); }
    });
    await t.test("backup-attempt-cap-exhausted", async () => {
      write(path.join(f.root, "attempts.json"), { "MONO-999": 3 });
      try { await assert.rejects(runtime.spawnWorker(f.backup()), /attempt cap/); assert.equal(json(path.join(f.root, "attempts.json"))["MONO-999"], 3); }
      finally { write(path.join(f.root, "attempts.json"), { "MONO-999": 1 }); }
    });
    await t.test("backup-provider-refusal-without-recovery", () => refusal(() => { f.raw.reason = "provider-refusal-after-recovery"; }, /recorded recovery/));
    await t.test("backup-expanded-grants-refused", async () => {
      const extra = path.join(scratch, "extra"); fs.mkdirSync(extra);
      const req = f.backup(); req.writable_roots = [...req.writable_roots, extra]; req.workerWritableRoots = [...req.workerWritableRoots, extra];
      const pins = json(req.pins.file); pins.workerWritableRoots = req.workerWritableRoots; write(req.pins.file, pins);
      req.pins.digest = crypto.createHash("sha256").update(fs.readFileSync(req.pins.file)).digest("hex");
      await assert.rejects(runtime.spawnWorker(req), /must not expand/);
    });
    await t.test("backup-missing-switch-pin-refused", async () => {
      const req = f.backup(); const pins = json(req.pins.file); delete pins.backupSwitch; write(req.pins.file, pins);
      req.pins.digest = crypto.createHash("sha256").update(fs.readFileSync(req.pins.file)).digest("hex");
      await assert.rejects(runtime.spawnWorker(req), /new attempt pins/);
    });
    await t.test("backup-subscription-exhausted-success", async () => {
      write(path.join(bin, "tree"), "900023 1 900023 S fixture-host browser\n");
      markerOutputs[900023] = { fallback: "(browser)" }; write(markersFile, markerOutputs);
      const request = f.backup(); const launched = await runtime.spawnWorker(request); pids.add(launched.pid);
      const entry = json(path.join(f.root, "workers.json"))["MONO-999"];
      assert.equal(entry.attempt, 2); assert.equal(entry.transport, "claude-cli"); assert.equal(entry.model_policy.role, "worker-claude");
      assert.deepEqual(entry.backupSwitch, json(request.pins.file).backupSwitch);
      assert.equal(entry.processOwnership.unavailableMarkerCount, 1);
      assert.notEqual(entry.attemptMarker, f.old.attemptMarker);
      assert.deepEqual(json(f.record).entry.processBaseline, f.old.processBaseline);
      delete markerOutputs[900023]; write(markersFile, markerOutputs);
      write(path.join(bin, "tree"), "");
      assert.deepEqual(entry.workerWritableRoots, f.old.workerWritableRoots);
      assert.ok(fs.readFileSync(entry.log, "utf8").includes(request.backupSwitch.evidenceDigest));
      assert.ok(fs.readFileSync(path.join(f.root, "ledger.md"), "utf8").includes("subscription-exhausted"));
      await stop(launched.pid); write(path.join(f.root, "workers.json"), {});
    });
    await t.test("backup-issue-already-switched", async () => {
      await assert.rejects(runtime.spawnWorker(f.backup()), /already switched/);
      await assert.rejects(runtime.spawnWorker(f.pin(f.request)), /already switched/);
      assert.equal(json(path.join(f.root, "attempts.json"))["MONO-999"], 2);
    });
    const recovery = await setup();
    const resumeFile = path.join(recovery.root, "resume.md"); write(resumeFile, "fixture recovery");
    await switchRuntime.stopBackupProcessTree(recovery.root, "MONO-999");
    await stop(recovery.first.pid);
    const resumed = await runtime.resumeWorker({ root: recovery.root, issue: "MONO-999", resumeFile }); pids.add(resumed.pid);
    write(path.join(bin, "tree"), `${resumed.pid} 1 ${resumed.pid} S fixture-start-${resumed.pid}\n`);
    await switchRuntime.stopBackupProcessTree(recovery.root, "MONO-999");
    await stop(resumed.pid); write(path.join(recovery.root, "workers.json"), {});
    write(path.join(bin, "tree"), "");
    recovery.raw.reason = "provider-refusal-after-recovery";
    await t.test("backup-evidence-before-recovery-refused", async () => {
      await assert.rejects(async () => runtime.spawnWorker(recovery.backup()), /evidence after recovery/);
    });
    const afterRecovery = JSON.stringify({ type: "error", message: "fixture persistent refusal after recovery (training data)" });
    fs.appendFileSync(recovery.old.log, afterRecovery + "\n"); write(recovery.raw.evidenceFile, afterRecovery + "\n");
    write(configFile, { ...config, projectName: "Unrelated base change" }); git("add", "."); git("commit", "-m", "new base unchanged reviewer");
    recovery.request.base = git("rev-parse", "HEAD");
    await t.test("backup-provider-refusal-after-recovery-success", async () => {
      const request = recovery.backup(); const launched = await runtime.spawnWorker(request); pids.add(launched.pid);
      const entry = json(path.join(recovery.root, "workers.json"))["MONO-999"];
      assert.equal(entry.attempt, 2); assert.equal(entry.backupSwitch.reason, "provider-refusal-after-recovery");
      assert.notEqual(entry.modelRoutes.configDigest, recovery.old.modelRoutes.configDigest);
      assert.equal(json(recovery.record).processes.length, 2);
      await stop(launched.pid);
    });
    const complexFixture = await setup("claude-cli"); await complexFixture.retire();
    await t.test("backup-codex-complex-role-recorded-success", async () => {
      const req = complexFixture.pin({ ...complexFixture.backup(), role: "worker-complex", modelRoutes: undefined, modelReason: "Deep state-machine changes" }, 2);
      const launched = await runtime.spawnWorker(req); pids.add(launched.pid);
      const entry = json(path.join(complexFixture.root, "workers.json"))["MONO-999"];
      assert.equal(entry.model_policy.role, "worker-complex"); assert.equal(entry.modelReason, "Deep state-machine changes");
      assert.ok(fs.readFileSync(entry.log, "utf8").includes(entry.modelReason)); await stop(launched.pid);
    });
    const reverse = await setup("claude-cli"); await reverse.retire();
    await t.test("backup-codex-role-default-and-complex-reason", async () => {
      const req = reverse.backup();
      await assert.rejects(runtime.spawnWorker({ ...req, role: "worker-claude" }), /role\/transport/);
      const complex = { ...req, role: "worker-complex", modelRoutes: undefined };
      await assert.rejects(runtime.spawnWorker(complex), /recorded reason/);
      assert.equal(json(path.join(reverse.root, "attempts.json"))["MONO-999"], 1);
      const launched = await runtime.spawnWorker(req); pids.add(launched.pid);
      assert.equal(json(path.join(reverse.root, "workers.json"))["MONO-999"].model_policy.role, "worker-default");
      await stop(launched.pid);
    });
    await t.test("backup-installed-dispatch-pins-and-default-role", async () => {
      const dispatchRepo = path.join(scratch, "dispatch-repo"), origin = path.join(scratch, "origin.git"), root = path.join(scratch, "dispatch-control");
      const temp = path.join(scratch, "dispatch-temp"); fs.mkdirSync(temp);
      const cfg = { orchestration: { transport: "claude-cli", backupTransport: "codex-cli", dispatch: {
        product: "fixture", evidenceRoot: path.join(scratch, "dispatch-evidence"), openDecisions: 0,
        lifecycle_moves: [], verification: { command: "node", args: ["scripts/verify.mjs"] },
      } } };
      write(configFile, cfg); write(path.join(repo, ".gitignore"), ".worktrees/\n"); git("add", "."); git("commit", "-m", "dispatch defaults"); git("branch", "-M", "main");
      execFileSync("git", ["clone", "--bare", repo, origin], { stdio: "pipe" });
      execFileSync("git", ["clone", origin, dispatchRepo], { stdio: "pipe" });
      const snapshot = path.join(scratch, "snapshot"), writable = path.join(scratch, "writable.json"); write(writable, [temp]);
      write(path.join(snapshot, "issue-MONO-998.md"), "# Backup fixture\n# Что сделать\nSwitch worker.\n# Готовность агента\nAFK\n# Ключевые контракты\nRetain gates.\n# Как проверить\nNamed fixtures.\nРиск: risky\n");
      for (const [name, text] of [["approval.md", "Approved package/start; Project Delivery."], ["project-brief.md", "Fixture"], ["prd.md", "## Кратко\nFixture"], ["tech-spec.md", "## Кратко\nFixture"]]) write(path.join(snapshot, name), text);
      write(path.join(root, "workers.json"), {}); write(path.join(root, "control.json"), { state: "active" }); writeWatcherFixture(root);
      const { dispatch } = await import(pathToFileURL(path.join(pack, "scripts/orchestrator/dispatch.mjs")));
      const args = { root, issue: "MONO-998", config: path.join(dispatchRepo, ".agents/mono-workflow.config.json"), snapshot,
        profile: "full", handshake: "resume", "worker-writable-roots": writable };
      const primary = await dispatch(args); pids.add(primary.pid);
      const old = json(path.join(root, "workers.json"))[args.issue];
      write(path.join(bin, "tree"), `${primary.pid} 1 ${primary.pid} S fixture-start-${primary.pid}\n`);
      await switchRuntime.stopBackupProcessTree(root, args.issue); await stop(primary.pid);
      write(path.join(root, "workers.json"), {});
      write(path.join(bin, "tree"), "");
      const excerpt = JSON.stringify({ type: "error", message: "marked fixture subscription exhaustion" });
      fs.appendFileSync(old.log, excerpt + "\n"); const evidenceFile = path.join(root, "switch-input/evidence.txt"); write(evidenceFile, excerpt + "\n");
      const decision = path.join(root, "switch-input/decision.json"); write(decision, {
        issue: args.issue, previousAttempt: 1, reason: "subscription-exhausted", backupTransport: "codex-cli", evidenceFile, training: true,
      });
      const switched = await dispatch({ ...args, "backup-switch": decision }); pids.add(switched.pid);
      const entry = json(path.join(root, "workers.json"))[args.issue], pins = json(switched.pins.file);
      assert.equal(switched.attempt, 2); assert.equal(entry.transport, "codex-cli"); assert.equal(entry.model_policy.role, "worker-default");
      assert.deepEqual(pins.backupSwitch, switched.backupSwitch); assert.equal(pins.backupSwitch.training, true);
      assert.deepEqual(entry.workerWritableRoots, old.workerWritableRoots);
      assert.ok(fs.readFileSync(switched.dispatchFile, "utf8").includes(pins.backupSwitch.evidenceDigest));
      await stop(switched.pid);
    });
  } finally {
    for (const pid of pids) await stop(pid);
    process.env.PATH = savedPath; fs.readFileSync = realRead; fs.rmSync(scratch, { recursive: true, force: true });
  }
});
function controlledDarwinTemp(bin, root) {
  const temp = path.join(root, "darwin-temp"); fs.mkdirSync(temp);
  const getconf = path.join(bin, "getconf");
  write(getconf, `#!${process.execPath}\nconsole.log(${JSON.stringify(temp)});\n`);
  fs.chmodSync(getconf, 0o700);
}

test("delivery config defaults confirmation to 1800 seconds and keeps it below the evidence limit", async () => {
  const { deliveryConfig } = await import("./runtime.mjs");
  assert.equal(deliveryConfig().confirmationTimeoutSec, 1800);
  assert.doesNotThrow(() => deliveryConfig({ orchestration: { delivery: { confirmationTimeoutSec: 2399, evidenceLimitSec: 2400 } } }));
  assert.throws(
    () => deliveryConfig({ orchestration: { delivery: { confirmationTimeoutSec: 2400, evidenceLimitSec: 2400 } } }),
    /confirmationTimeoutSec.*2400.*evidenceLimitSec.*2400/
  );
});

test("clean installed runtime: tool evidence, spawn/resume, halt, attempts and durable ack", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mono-delivery-installed-"));
  const skills = path.join(root, "skills"), state = path.join(root, "orchestrator"), repo = path.join(root, "repo"), bin = path.join(root, "bin");
  const mailbox = path.join(state, "reports");
  const env = { ...process.env, HOME: path.join(root, "home"), PATH: `${bin}:${process.env.PATH}` };
  let livePid;
  const oldPath = process.env.PATH;
  try {
    copyPluginFixture(skills);
    controlledDarwinTemp(bin, root);
    const runtime = path.join(skills, "scripts");
    for (const script of ["gate.mjs", "delivery-state.mjs", "orchestrator/spawn.mjs", "orchestrator/resume.mjs", "orchestrator/consume-gate-ack.mjs"]) {
      pass(run(process.execPath, [path.join(runtime, script), "--help"], root, env));
    }
    assert.ok(fs.existsSync(path.join(skills, "skills/deliver/SKILL.md")));
    const budget = jsonFromRun(pass(run(process.execPath, [path.join(runtime, "read-budget.mjs"), "--json"], root, env)));
    assert.ok(budget.within_ceiling && budget.ceiling_bytes === 99_882);
    assert.ok(budget.files.some(file => file.path === "skills/deliver/SKILL.md"));
    assert.ok(budget.files.some(file => file.path === "references/worker-contract.md"));
    fs.mkdirSync(repo); pass(run("git", ["init", "-b", "delivery"], repo, env));
    write(path.join(repo, "tracked.txt"), "tracked\n"); pass(run("git", ["add", "tracked.txt"], repo, env));
    pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"], repo, env));
    const head = pass(run("git", ["rev-parse", "HEAD"], repo, env)).stdout.trim();
    const pins = packLayout(skills).identity();
    const baseRequest = { root: state, issue: "MONO-999", worktree: repo, branch: "delivery", base: head, packRoot: skills, skillsRoot: skills,
      packVersion: pins.packVersion, ...(pins.sourceCommit ? { sourceCommit: pins.sourceCommit } : {}), surfaceRevision: pins.surfaceRevision };
    const fsmonitor = path.join(root, "fsmonitor"), monitorMarker = path.join(root, "fsmonitor-ran");
    write(fsmonitor, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(monitorMarker)},'unsafe git invocation');`);
    fs.chmodSync(fsmonitor, 0o700);
    pass(run("git", ["config", "core.fsmonitor", fsmonitor], repo, env));
    const gateRequest = path.join(root, "gate.json"); write(gateRequest, baseRequest);
    pass(run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", gateRequest], root, env));
    write(path.join(skills, "VERSION"), "99.0.0\n");
    pass(run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", gateRequest], root, env));
    write(gateRequest, { ...baseRequest, surfaceRevision: pins.surfaceRevision + 1 });
    const incompatibleStart = run(process.execPath, [path.join(runtime, "gate.mjs"), "start", "--request", gateRequest], root, env);
    assert.equal(incompatibleStart.status, 1);
    assert.match(incompatibleStart.stdout + incompatibleStart.stderr, /surfaceRevision.*new attempt/);
    write(gateRequest, baseRequest);
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
    const preflightCall = installedAdmissionFixture(runtime, gateRequest, root, env);
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
        const immutableReceipt = path.join(preflight.evidenceRoot, "history", `${sealed.receipt.runId}.json`);
        collectionRuns++; collectionEvidence.set(write.id, { receipt: immutableReceipt, receiptDigest: receiptDigest(json(immutableReceipt)), gate: answer });
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
    assert.equal(preflightCall().stdout.trim(), "gate preflight: fail: invalid nonempty findings report required");
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
    for (const [phase, command] of Object.entries({ verification: narrow.verification, review: narrow.review })) {
      const profile = command.sandbox.args.find(arg => arg.startsWith("permissions.mono-collector="));
      const grants = [...profile.matchAll(/("[^"]+")="write"/g)].map(match => JSON.parse(match[1]));
      assert.deepEqual(grants.sort(), [fs.realpathSync(repo), command.sandbox.tempRoot,
        ...(process.platform === "darwin" && phase === "verification" ? [path.join(root, "darwin-temp")] : [])].map(p => fs.realpathSync(path.dirname(p)) + path.sep + path.basename(p)).sort());
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
    assert.equal(findingResult.stdout.trim(), "gate preflight: fail: invalid nonempty findings report required");
    const failedReview = json(receiptFile).receipt;
    assert.equal(failedReview.review.exitCode, 1);
    assert.equal(failedReview.review.sandbox.probed, true);
    assert.equal(failedReview.loop.residualFindings[0].priority, "P2");
    delete env.MONO_FIXTURE_REVIEW_FINDINGS;
    write(gateRequest, preflight);
    assert.equal(preflightCall().stdout.trim(), "gate preflight: fail: invalid nonempty findings report required");
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
    write(config, { orchestration: { delivery: { confirmationTimeoutSec: 20, collectionTimeoutSec: 10, quietSec: 0.01, pollSec: 0.01, evidenceLimitSec: 30 } } });
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
    // U13 absence must fail ship before judgment without a publishRequest.
    const registryFile = path.join(state, "workers.json"), registryBefore = fs.existsSync(registryFile) ? fs.readFileSync(registryFile) : null;
    const launchPins = path.join(state, "dispatch/MONO-998-a1/pins.json");
    const boundPins = { ...preflight, reviewDataset: null, reviewDatasetVersion: 0, reviewDatasetDigest: null };
    write(launchPins, boundPins);
    const pinsBinding = { file: launchPins, digest: crypto.createHash("sha256").update(fs.readFileSync(launchPins)).digest("hex") };
    write(registryFile, { "MONO-998": { ...pins, issue: "MONO-998", attempt: 1, stage: "mono-deliver", worktree: repo, pins: pinsBinding, pinsVersion: 0 } });
    const history = path.join(preflight.evidenceRoot, "history"), savedHistory = history + ".saved";
    fs.renameSync(history, savedHistory);
    try {
      write(gateRequest, { ...proofRequest, preflight: { ...preflight, pins: pinsBinding, reviewDatasetVersion: 0 } });
      const missing = shipCall(); assert.equal(missing.status, 1); assert.match(missing.stdout, /missing or stale autoreview artifact/u);
      assert.ok(!missing.stdout.includes("publishRequest") && !missing.stdout.includes("pending"));
    } finally {
      fs.renameSync(savedHistory, history);
      if (registryBefore) fs.writeFileSync(registryFile, registryBefore); else fs.unlinkSync(registryFile);
    }
    write(gateRequest, proofRequest);
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
      [r => { r.review.exitCode = 1; }, /incomplete or contradictory findings result/],
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
    // Preserve the first HTTP failure until expiry, rather than race another
    // process startup in the final millisecond of this deliberately short window.
    write(errorConfig, { orchestration: { delivery: { confirmationTimeoutSec: 0.5, collectionTimeoutSec: 0.1, quietSec: 0.01, pollSec: 1, evidenceLimitSec: 1 } } });
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
    const credentialedCall = installedAdmissionFixture(runtime, gateRequest, root, fetchEnv);
    const credentialedPreflight = collect => {
      write(gateRequest, { ...remotePreflight, collect });
      return credentialedCall();
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
    // A full paginated snapshot must finish before the pending-state assertion;
    // the watched cases below still prove expiry at this configured deadline.
    write(config, { orchestration: { delivery: { confirmationTimeoutSec: 0.5, collectionTimeoutSec: 0.1, quietSec: 0.01, pollSec: 0.01, evidenceLimitSec: 5 } } });
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

    write(path.join(state, "control.json"), { state: "active", halt: false }); writeWatcherFixture(state, env); write(path.join(state, "workers.json"), {});
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
    const policyFile = path.join(skills, "references/model-policy.md");
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
    write(path.join(state, "control.json"), { state: "active", halt: false }); writeWatcherFixture(state, env);
    write(path.join(state, "reports/MONO-999-gate-ack-a1.json"), { issue: request.issue, phase: "gate", status: "gates-passed",
      gates: request.gates.map(gate => ({ gate, status: "pass", evidence: "fixture" })) });
    const { consumeAck } = await import(pathToFileURL(path.join(runtime, "orchestrator/consume-gate-ack.mjs")));
    await assert.rejects(consumeAck({ root: state, issue: request.issue, attempt: 1, outcome: "applied", readback: [] }), /resumed writer registration for this ack/);
    process.kill(livePid, "SIGTERM"); livePid = null;
    await new Promise(resolve => setTimeout(resolve, 100));
    await assert.rejects(consumeAck({ root: state, issue: request.issue, attempt: 1, outcome: "applied", readback: [] }), /resumed writer registration for this ack/);
    const ackPath = path.join(state, "reports/MONO-999-gate-ack-a1.json"), ackBytes = fs.readFileSync(ackPath);
    fs.unlinkSync(ackPath);
    writeWatcherFixture(state);
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
    const codeReportPath = path.join(state, "reports/MONO-999-phase-code.json");
    for (const [field, value] of [["packVersion", "99.0.0"], ["sourceCommit", "b".repeat(40)], ["surfaceRevision", pins.surfaceRevision + 1]]) {
      write(codeReportPath, { ...report, [field]: value });
      const rejectedPhase = pass(run(process.execPath, [path.join(runtime, "watch-workers.mjs"), "--root", state, "--once"], root, env));
      assert.match(rejectedPhase.stdout, /EVENT:phase-rejected MONO-999/);
      assert.match(rejectedPhase.stdout, /attempt 1: identity mismatch/);
      assert.ok(rejectedPhase.stdout.includes(field), rejectedPhase.stdout);
      assert.doesNotMatch(rejectedPhase.stdout, /EVENT:phase MONO-999/);
    }
    write(codeReportPath, report);
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
    writeWatcherFixture(state);
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
  const env = { ...process.env, };
  const oldEnv = { ...process.env };
  try {
    copyPluginFixture(skills);
    fs.mkdirSync(main); pass(run("git", ["init", "-b", "delivery"], main, env));
    pass(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "base"], main, env));
    const head = pass(run("git", ["rev-parse", "HEAD"], main, env)).stdout.trim();
    pass(run("git", ["worktree", "add", "-b", "linked", worktree], main, env));
    const pins = packLayout(skills).identity();
    const dispatchFile = path.join(root, "prompt.md"), capture = path.join(root, "starts.jsonl");
    write(dispatchFile, "fixture"); write(path.join(state, "control.json"), { state: "active", halt: false }); writeWatcherFixture(state, env);
    write(path.join(state, "workers.json"), {}); fs.mkdirSync(mailbox);
    write(path.join(bin, "codex"), `#!/usr/bin/env node
const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),gitDir:process.env.GIT_DIR,gitSentinel:process.env.GIT_MONO_SENTINEL,credentialDigests:Object.fromEntries(['GITHUB_TOKEN','PRODUCT_API_KEY','OPENAI_API_KEY'].map(k=>[k,require('node:crypto').createHash('sha256').update(process.env[k]??'').digest('hex')]))})+'\\n');
console.log(JSON.stringify({type:'thread.started',thread_id:'grants-fixture'}));
`); fs.chmodSync(path.join(bin, "codex"), 0o700);
    process.env.PATH = `${bin}:${process.env.PATH}`;
    writeWatcherFixture(state);
    const { spawnWorker, resumeWorker } = await import(pathToFileURL(path.join(skills, "scripts/orchestrator/launch.mjs")));
    const expected = [worktree, mailbox, common, metadata].sort();
    const request = { root: state, issue: "MONO-997", worktree, branch: "linked", base: head, packRoot: skills, skillsRoot: skills,
      packVersion: pins.packVersion, ...(pins.sourceCommit ? { sourceCommit: pins.sourceCommit } : {}), surfaceRevision: pins.surfaceRevision,
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
    const incompatible = json(path.join(state, "workers.json")); incompatible[request.issue].surfaceRevision += 1; write(path.join(state, "workers.json"), incompatible);
    await assert.rejects(resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile, extraWritable: [root] }), /surfaceRevision.*new attempt/);
    assert.equal(starts().length, 1);
    write(path.join(skills, "VERSION"), "99.0.0\n");
    const beforeResume = json(path.join(state, "workers.json"));
    beforeResume[request.issue].surfaceRevision = pins.surfaceRevision;
    beforeResume[request.issue].writable_roots = [];
    write(path.join(state, "workers.json"), beforeResume);
    await resumeWorker({ root: state, issue: request.issue, resumeFile: dispatchFile });
    for (let i = 0; i < 100 && starts().length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(starts().length, 2);
    assert.deepEqual(argsRoots(starts().at(-1).args), canonicalExpected);
    assert.deepEqual(starts().at(-1).credentialDigests, credentialDigests);
    const resumed = json(path.join(state, "workers.json"))[request.issue];
    assert.equal(resumed.packVersion, pins.packVersion);
    assert.equal(resumed.sourceCommit, pins.sourceCommit);
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

test('decide separates a current matrix waiver and restores the matrix after its decision is superseded',async()=>{
  const {decideReview}=await import('./review-ledger.mjs');
  const entry={type:'decision',id:'d1',findingKey:'same-invariant',problem:'p',trigger:'t',evidence:'e',impact:'i',origin:'original',decision:'confirmed',validity:{head:'a'.repeat(40),base:'b'.repeat(40),contracts:[],assumptions:[]},verification:'test',supersedes:null,proposedBy:'worker',recordedAt:'2026-09-16T00:00:00Z'};
  const waiver={type:'verification',id:'v1',forId:'d1',method:'owner decision',result:'waived',waiver:{findingKey:'same-invariant',reason:'documentation-only invariant'},recordedAt:'2026-09-16T00:01:00Z'};
  const events=[1,2].map(n=>({id:`1:helper-invocation:${n}`,kind:'helper-invocation',parent:null,status:'findings',findings:1}));
  const ledger={issue:'MONO-999',attempts:[{attempt:1,events,unresolvedCoverage:[]}]};
  const records=events.map(event=>({eventId:event.id,origin:'original',evidence:'fixture',links:['d1'],progress:'fixed',recordedBy:'orchestrator'}));
  let hint=decideReview({ledger,records,journal:{issue:ledger.issue,entries:[entry,waiver]},attempt:1});
  assert.deepEqual(hint.matrixFindingKeys,[]);
  assert.deepEqual(hint.waivedFindingKeys,[{findingKey:'same-invariant',reason:'documentation-only invariant',forId:'d1'}]);
  const replacement={...entry,id:'d2',supersedes:'d1',recordedAt:'2026-09-16T00:02:00Z'};
  hint=decideReview({ledger,records,journal:{issue:ledger.issue,entries:[entry,waiver,replacement]},attempt:1});
  assert.deepEqual(hint.matrixFindingKeys,['same-invariant']);
  assert.deepEqual(hint.waivedFindingKeys,[]);
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
  const env={...process.env,HOME:path.join(root,'home'),MONO_WORKFLOW_STATE_ROOT:path.join(root,'state-root'),
    PATH:bin+path.delimiter+process.env.PATH,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  try {
    copyPluginFixture(skills);
    controlledDarwinTemp(bin, root);
    const runtime=path.join(skills,'scripts');
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
      const call=installedAdmissionFixture(runtime,file,repo,callEnv);
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

test('wait-mode consumption verifies the live writer incarnation and outstanding command', async () => {
  const { consumeAck } = await import('./orchestrator/consume-gate-ack.mjs');
  const { digest } = await import('./runtime.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-live-wait-'));
  const issue = 'MONO-993', log = path.join(root, 'logs', `${issue}-mono-deliver-a1.jsonl`);
  // Process inspection is denied inside the worker sandbox; model the outside
  // orchestrator's ps boundary without making a provider/process-inspection call.
  const procStart = 'Mon Jan  1 00:00:00 2024', oldPath = process.env.PATH;
  const bin = path.join(root, 'bin');
  write(path.join(bin, 'ps'), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(procStart)});\n`);
  fs.chmodSync(path.join(bin, 'ps'), 0o700); process.env.PATH = bin + path.delimiter + oldPath;
  const ack = { issue, phase: 'gate', status: 'gates-passed', gates: [{ gate: 'identity', status: 'pass', evidence: 'fixture' }] };
  const entry = { issue, stage: 'mono-deliver', attempt: 1, handshake: 'wait', pid: process.pid, procStart, thread_id: 'fixture-thread', log,
    worktree: path.join(root, 'repo'), gates: ['identity'], lifecycle_moves: [{ entity: 'issue', key: issue, from: 'Backlog', to: 'In Progress' }] };
  const started = { type: 'item.started', item: { id: 'item_18', type: 'command_execution', command: `/bin/zsh -lc 'node /fixture/skills/scripts/delivery-state.mjs wait-ack --root /fixture/state --issue ${issue} --attempt 1 --ack /fixture/ack.json --moves /fixture/moves.json'`, aggregated_output: '', exit_code: null, status: 'in_progress' } };
  const events = [{ type: 'thread.started', thread_id: entry.thread_id }, started, { type: 'item.completed', item: { id: 'item_19', type: 'agent_message', text: 'Waiting for gate-ack consumption.' } }];
  const setLog = list => write(log, list.map(e => JSON.stringify(e)).join('\n') + '\n');
  const request = { root, issue, attempt: 1, outcome: 'applied', readback: [{ moveDigest: digest(entry.lifecycle_moves[0]), evidence: { state: 'In Progress' } }] };
  try {
    setLog(events); write(path.join(root, 'reports', `${issue}-gate-ack-a1.json`), ack);
    for (const change of [{ pid: 2147483647 }, { procStart: procStart + ' foreign' }, { thread_id: 'other' }]) {
      write(path.join(root, 'workers.json'), { [issue]: { ...entry, ...change } });
      await assert.rejects(consumeAck(request), /waiting writer not verified/);
    }
    write(path.join(root, 'workers.json'), { [issue]: entry });
    for (const list of [events.slice(0, 1), [...events, { type: 'item.completed', item: { ...started.item, status: 'completed', exit_code: 0 } }],
      [started, events[0]], [...events, { type: 'thread.started', thread_id: 'other' }],
      [events[0], { ...started, item: { ...started.item, command: started.item.command.replace('--attempt 1', '--attempt 2') } }]]) {
      setLog(list); await assert.rejects(consumeAck(request), /waiting writer not verified/);
    }
    setLog(events);
    await consumeAck(request);
    const registered = json(path.join(root, 'workers.json'))[issue];
    assert.equal(registered.last_wait.pid, entry.pid);
    assert.equal(registered.last_wait.procStart, procStart);
    assert.equal(registered.last_wait.thread_id, entry.thread_id);
    assert.equal(registered.last_wait.gateAckDigest, digest(ack));
    assert.ok(Number.isFinite(Date.parse(registered.last_wait.consumedAt)));
    const consumedAt = registered.last_wait.consumedAt;
    // Recover the earlier crash window too: registry persisted, private record absent.
    fs.unlinkSync(path.join(root, 'consumed', `${issue}-gate-ack-a1.json`));
    fs.renameSync(path.join(root, 'reports', `${issue}-gate-ack-a1.applied.json`), path.join(root, 'reports', `${issue}-gate-ack-a1.json`));
    write(path.join(root, 'workers.json'), { [issue]: { ...registered, gates: entry.gates } });
    await consumeAck(request);
    assert.equal(json(path.join(root, 'workers.json'))[issue].last_wait.consumedAt, consumedAt);
    // Recover after private-record publication with no live writer: prior identical intent wins.
    write(path.join(root, 'workers.json'), { [issue]: { ...registered, pid: 2147483647, gates: entry.gates } });
    await consumeAck(request);
    assert.equal(json(path.join(root, 'workers.json'))[issue].last_wait.consumedAt, consumedAt);
    assert.equal(json(path.join(root, 'workers.json'))[issue].gates, undefined);
  } finally { process.env.PATH = oldPath; fs.rmSync(root, { recursive: true, force: true }); }
});

test('scratch short launch pins profile, handshake, pins digest, version and process start', async () => {
  const { spawnWorker } = await import('./orchestrator/launch.mjs');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mono-short-launch-')));
  const skills = path.join(root, 'skills'), state = path.join(root, 'state'), repo = path.join(root, 'repo'), bin = path.join(root, 'bin');
  const env = { ...process.env, };
  const oldPath = process.env.PATH; let pid;
  try {
    copyPluginFixture(skills);
    fs.mkdirSync(repo); pass(run('git', ['init', '-b', 'delivery'], repo, env));
    pass(run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'base'], repo, env));
    const base = pass(run('git', ['rev-parse', 'HEAD'], repo, env)).stdout.trim();
    const identity = packLayout(skills).identity();
    const dispatchFile = path.join(root, 'dispatch.md'), pinsFile = path.join(root, 'pins.json');
    write(dispatchFile, 'fixture'); write(pinsFile, { profile: 'short', handshake: 'wait' });
    const pins = { file: pinsFile, digest: crypto.createHash('sha256').update(fs.readFileSync(pinsFile)).digest('hex') };
    write(path.join(state, 'control.json'), { state: 'active', halt: false }); write(path.join(state, 'workers.json'), {});
    fs.mkdirSync(path.join(state, 'reports'));
    write(path.join(bin, 'codex'), '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"short-fixture"}));setTimeout(()=>process.exit(0),10000);\n');
    write(path.join(bin, 'ps'), '#!/usr/bin/env node\nconsole.log("Mon Jan  1 00:00:00 2024");\n');
    for (const tool of ['codex', 'ps']) fs.chmodSync(path.join(bin, tool), 0o700);
    process.env.PATH = bin + path.delimiter + oldPath;
    writeWatcherFixture(state);
    const request = { root: state, issue: 'MONO-993', worktree: repo, branch: 'delivery', base, packRoot: skills, skillsRoot: skills, ...identity,
      role: 'worker-default', dispatchFile, evidenceRoot: path.join(root, 'evidence'), writable_roots: [],
      workerWritableRoots: [repo, path.join(repo, '.git'), path.join(state, 'reports')], lifecycle_moves: [],
      handshake: 'wait', profile: 'short', risk: 'standard', critical: null, afk: true, openDecisions: 0, pins };
    for (const change of [{ risk: 'deep' }, { risk: 'risky' }, { critical: 'release blocker' }, { critical: undefined }, { afk: false },
      { afk: undefined }, { openDecisions: 1 }, { openDecisions: undefined }, { handshake: 'unknown' }, { profile: 'unknown' },
      { pins: { ...pins, digest: '0'.repeat(64) } }, { pinsVersion: 1 }]) {
      await assert.rejects(spawnWorker({ ...request, ...change }), /short|handshake|profile|pins/);
      assert.deepEqual(json(path.join(state, 'workers.json')), {}, 'refusal never registers an attempt');
    }
    ({ pid } = await spawnWorker(request));
    const entry = json(path.join(state, 'workers.json'))[request.issue];
    assert.equal(entry.profile, 'short'); assert.equal(entry.handshake, 'wait');
    assert.deepEqual(entry.pins, pins); assert.equal(entry.pinsVersion, 0);
    assert.equal(entry.procStart, 'Mon Jan  1 00:00:00 2024');
  } finally { process.env.PATH = oldPath; if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} } fs.rmSync(root, { recursive: true, force: true }); }
});

function watcherProcessFixture(root) {
  const bin = path.join(root, 'bin');
  write(path.join(bin, 'ps'), '#!/usr/bin/env node\nconsole.log("fixture-start");\n');
  fs.chmodSync(path.join(bin, 'ps'), 0o700);
  return { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
}

test('watcher shares configured clocks and bounds wait continuation after consumption', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-wait-watch-'));
  const env = watcherProcessFixture(root);
  const issue = 'MONO-993', log = path.join(root, 'logs', `${issue}-mono-deliver-a1.jsonl`);
  const config = path.join(root, 'config.json'), ackFile = path.join(root, 'reports', `${issue}-gate-ack-a1.json`);
  const applied = ackFile.replace('.json', '.applied.json');
  const events = json(path.join(checkout, 'scripts/fixtures/blocked-command-events.json'));
  const ack = { issue, phase: 'gate', status: 'gates-passed', gates: [{ gate: 'identity', status: 'pass', evidence: 'fixture' }] };
  const entry = { issue, stage: 'mono-deliver', transport: 'codex-cli', attempt: 1, packVersion: 'test', sourceCommit: 'a'.repeat(40), surfaceRevision: 4,
    pid: process.pid, procStart: 'fixture-start', thread_id: 'fixture-thread', handshake: 'wait', worktree: path.join(root, 'repo'), log, gates: ['identity'] };
  const registry = change => write(path.join(root, 'workers.json'), { [issue]: { ...entry, ...change } });
  const watch = (extra = []) => run(process.execPath, ['scripts/watch-workers.mjs', '--root', root, '--config', config, '--once', ...extra], checkout, env);
  const silence = seconds => { const past = new Date(Date.now() - seconds * 1000); fs.utimesSync(log, past, past); };
  try {
    const defaultClock = run(process.execPath, ['scripts/watch-workers.mjs', '--root', root, '--stall-sec', '90', '--once'], checkout);
    assert.notEqual(defaultClock.status, 0); assert.match(defaultClock.stderr, /ackWaitSec.*effective.*stall/i);
    write(config, { orchestration: { delivery: { stallSec: 150, ackWaitSec: 500, pollSec: 10 } } });
    write(log, events.slice(0, 3).map(e => JSON.stringify(e)).join('\n') + '\n'); registry();
    write(path.join(root, 'control.json'), { state: 'active' }); write(ackFile, ack);
    silence(400);
    const pending = pass(watch()); assert.match(pending.stderr, /stall-sec=150/); assert.doesNotMatch(pending.stdout, /EVENT:(stall|dead)/);
    const incompatible = watch(['--stall-sec', '120']); assert.notEqual(incompatible.status, 0); assert.match(incompatible.stderr, /ackWaitSec.*effective.*stall/i);
    write(config, { orchestration: { delivery: { stallSec: 120, ackWaitSec: 420, pollSec: 10 } } });
    silence(481); assert.match(pass(watch()).stdout, /EVENT:stall/);
    fs.renameSync(ackFile, applied);
    for (const age of [0, 100, 119]) {
      registry({ gates: undefined, last_wait: { pid: entry.pid, procStart: entry.procStart, thread_id: entry.thread_id, gateAckDigest: crypto.createHash('sha256').update('fixture').digest('hex'), consumedAt: new Date(Date.now() - age * 1000).toISOString() } });
      assert.doesNotMatch(pass(watch()).stdout, /EVENT:(stall|dead)/, `bounded continuation at age ${age}`);
    }
    for (const change of [{ pid: 2147483647 }, { procStart: 'reused-pid-start' }]) {
      const writer = { ...entry, ...change };
      registry({ ...change, gates: undefined, last_wait: { pid: writer.pid, procStart: writer.procStart, thread_id: writer.thread_id, consumedAt: new Date().toISOString() } });
      assert.match(pass(watch()).stdout, /EVENT:(stall|dead)/, 'continuation must not hide a dead or reused writer');
    }
    for (const stamp of [new Date(Date.now() - 120_500).toISOString(), new Date(Date.now() + 30_000).toISOString(), 'invalid']) {
      registry({ gates: undefined, last_wait: { consumedAt: stamp } }); assert.match(pass(watch()).stdout, /EVENT:stall/);
    }
    registry({ gates: undefined, handshake: 'resume', last_wait: { consumedAt: new Date().toISOString() } }); assert.match(pass(watch()).stdout, /EVENT:stall/);
    registry({ gates: undefined, last_wait: { consumedAt: new Date().toISOString() } });
    fs.unlinkSync(applied); assert.match(pass(watch()).stdout, /EVENT:stall/, 'no tombstone, no continuation');
    write(applied, ack);
    fs.appendFileSync(log, JSON.stringify(events[3]) + '\n');
    assert.doesNotMatch(pass(watch()).stdout, /EVENT:(stall|dead)/, 'completed command makes the log live');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('watcher consumption between scans suppresses only one fixed continuation window', async () => {
  const { spawn } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-wait-scans-'));
  const env = watcherProcessFixture(root);
  const issue = 'MONO-993', log = path.join(root, 'logs', `${issue}-mono-deliver-a1.jsonl`);
  const config = path.join(root, 'config.json'), ack = path.join(root, 'reports', `${issue}-gate-ack-a1.json`);
  const entry = { issue, stage: 'mono-deliver', transport: 'codex-cli', attempt: 1, packVersion: 'test', sourceCommit: 'a'.repeat(40), surfaceRevision: 4,
    handshake: 'wait', pid: process.pid, procStart: 'fixture-start', thread_id: 'fixture-thread', log, worktree: path.join(root, 'repo'), gates: ['identity'] };
  let watcher; let output = ''; let errors = ''; let launchError;
  const waitFor = async (predicate, description) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      assert.ok(!launchError && watcher.exitCode === null && watcher.signalCode === null && Date.now() < deadline,
        `Timed out or watcher stopped waiting for ${description}\n${launchError ?? ''}\nstdout:\n${output}\nstderr:\n${errors}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  try {
    const events = json(path.join(checkout, 'scripts/fixtures/blocked-command-events.json'));
    write(log, events.slice(0, 3).map(e=>JSON.stringify(e)).join('\n')+'\n');
    const quiet = new Date(Date.now()-400_000); fs.utimesSync(log, quiet, quiet);
    write(config, { orchestration: { delivery: { stallSec: 120, ackWaitSec: 420, pollSec: 10 } } });
    write(path.join(root, 'workers.json'), { [issue]: entry }); write(path.join(root, 'control.json'), { state: 'active' });
    write(ack, { issue, phase: 'gate', status: 'gates-passed', gates: [{ gate: 'identity', status: 'pass', evidence: 'fixture' }] });
    // The pulse is written at scan START. A callback in the watcher's event loop
    // sees it only after that synchronous scan returns; its stdout marker also
    // orders delivery of every event emitted by that scan before our assertion.
    const runner = path.join(root, 'watcher-runner.mjs');
    write(runner, `import fs from 'node:fs';
await import(${JSON.stringify(pathToFileURL(path.join(checkout, 'scripts/watch-workers.mjs')).href)});
let previousBeat;
setInterval(() => {
  const { beatAt } = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root, 'watcher.json'))}, 'utf8'));
  if (beatAt !== previousBeat) { previousBeat = beatAt; console.log('fixture:scan-complete ' + beatAt); }
}, 25);
`);
    watcher = spawn(process.execPath, [runner, '--root', root, '--config', config, '--interval-sec', '1'], { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'] });
    watcher.stdout.on('data', chunk => { output += chunk.toString(); });
    watcher.stderr.on('data', chunk => { errors += chunk.toString(); });
    watcher.on('error', error => { launchError = error; });
    await waitFor(() => /EVENT:gate-ack/.test(output), 'EVENT:gate-ack');
    assert.doesNotMatch(output, /EVENT:(stall|dead)/);
    // The consumer publishes last_wait before renaming, between watcher scans.
    const consumedAt = new Date().toISOString();
    const continued = { ...entry, gates: undefined, last_wait: { pid: entry.pid, procStart: entry.procStart,
      thread_id: entry.thread_id, gateAckDigest: crypto.createHash('sha256').update(fs.readFileSync(ack)).digest('hex'), consumedAt } };
    write(path.join(root, 'workers.json'), { [issue]: continued });
    fs.renameSync(ack, ack.replace('.json', '.applied.json'));
    const publishedAt = Date.now();
    await waitFor(() => {
      assert.doesNotMatch(output, /EVENT:(stall|dead)/);
      return [...output.matchAll(/^fixture:scan-complete (.+)\n/gm)].some(([, beat]) => Date.parse(beat) > publishedAt);
    }, 'completed scan of consumed state and its stdout');
    assert.doesNotMatch(output, /EVENT:(stall|dead)/);
    assert.equal(json(path.join(root, 'workers.json'))[issue].last_wait.consumedAt, consumedAt);
    write(path.join(root, 'workers.json'), { [issue]: { ...continued,
      last_wait: { ...continued.last_wait, consumedAt: new Date(Date.now()-121_000).toISOString() } } });
    await waitFor(() => /EVENT:stall/.test(output), 'EVENT:stall after continuation expiry');
  } finally {
    if (watcher && watcher.exitCode === null) { watcher.kill('SIGTERM'); await new Promise(resolve=>watcher.once('exit',resolve)); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
