import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { recordDecision, readJournal, renderDecisions, versionDataset, materializeDataset } from './decisions.mjs';

const decision = (id, extra = {}) => ({type:'decision',id,findingKey:'invariant-1',problem:'problem',trigger:'trigger',evidence:'reproduction',impact:'impact',origin:'original',decision:'refuted',validity:{head:'a'.repeat(40),base:'b'.repeat(40),contracts:['contract'],assumptions:[]},verification:'test command and result',supersedes:null,proposedBy:'worker',recordedAt:'2026-09-16T00:00:00Z',...extra});
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(),'mono-decisions-'));

test('journal appends typed entries, preserves history and rejects overwrites and broken references', async () => {
  const evidenceRoot=scratch(), issue='MONO-999';
  const add = entry => recordDecision({evidenceRoot,issue,entry});
  try {
    await add(decision('d1'));
    const before=fs.readFileSync(path.join(evidenceRoot,'decisions',issue+'.json'),'utf8');
    await assert.rejects(add(decision('d1',{decision:'confirmed'})),/duplicate/);
    assert.equal(fs.readFileSync(path.join(evidenceRoot,'decisions',issue+'.json'),'utf8'),before);
    await assert.rejects(add(decision('d2',{supersedes:'missing'})),/supersedes/);
    await add(decision('d2',{supersedes:'d1',decision:'confirmed'}));
    await assert.rejects(add(decision('d3',{supersedes:'d1'})),/current/);
    await assert.rejects(add(decision('d3',{supersedes:'d2',findingKey:'other'})),/findingKey/);
    await add({type:'matrix',id:'m1',invariant:'invariant-1',states:[{state:'missing',expected:'refused'}],verification:'v1',recordedAt:'2026-09-16T00:01:00Z'});
    await add({type:'verification',id:'v1',forId:'m1',method:'unit test',result:'pass',recordedAt:'2026-09-16T00:02:00Z'});
    await assert.rejects(add({type:'verification',id:'v2',forId:'missing',method:'test',result:'pass',recordedAt:'2026-09-16T00:02:00Z'}),/forId/);
    await assert.rejects(add({type:'unknown',id:'x'}),/type/);
    const journal=readJournal({evidenceRoot,issue});
    assert.equal(journal.entries.length,4);
    assert.deepEqual(journal.entries[0],decision('d1'));
    const output=renderDecisions(journal);
    assert.ok(!output.includes('"id":"d1"'));
    assert.ok(output.includes('"id":"d2"') && output.includes('"id":"m1"') && output.includes('"id":"v1"'));
    assert.equal(renderDecisions(journal),output);
    assert.equal(renderDecisions(JSON.parse(JSON.stringify(journal))),output);
  } finally {fs.rmSync(evidenceRoot,{recursive:true,force:true});}
});

test('dataset versions change only with bytes; materialization is digest-checked, plain, ignored and removable', async () => {
  const evidenceRoot=scratch(), issue='MONO-999', worktree=path.join(evidenceRoot,'repo'),source=path.join(evidenceRoot,'source.md');
  const options={evidenceRoot,issue,source};
  const git=(...args)=>execFileSync('git',['-C',worktree,...args],{encoding:'utf8'}).trim();
  try {
    fs.mkdirSync(worktree);git('init','-q');
    fs.writeFileSync(source,'# Scope\n\nFrozen contract.\n');
    await recordDecision({...options,entry:decision('d1')});
    const v1=await versionDataset(options),first=fs.readFileSync(v1.archive);
    assert.equal(v1.version,1);assert.equal(v1.created,true);
    assert.deepEqual(await versionDataset(options),{...v1,created:false});
    assert.deepEqual(await versionDataset({...options,source:v1.archive}),{...v1,created:false});
    await recordDecision({...options,entry:decision('d2',{supersedes:'d1',decision:'confirmed'})});
    const v2=await versionDataset(options);
    assert.equal(v2.version,2);assert.notEqual(v2.digest,v1.digest);
    assert.deepEqual(fs.readFileSync(v1.archive),first);
    assert.throws(()=>materializeDataset({...options,version:2,worktree}),/Command failed|ignored/);
    fs.appendFileSync(path.join(worktree,'.git/info/exclude'),'\n.orchestrator/\n');
    assert.throws(()=>materializeDataset({...options,version:2,worktree,digest:'0'.repeat(64)}),/pinned/);
    const m=materializeDataset({...options,version:2,worktree,digest:v2.digest});
    assert.equal(m.relative,`.orchestrator/review-dataset-${v2.digest.slice(0,8)}.md`);
    assert.deepEqual(fs.readFileSync(m.path),fs.readFileSync(v2.archive));
    assert.ok(fs.lstatSync(m.path).isFile());assert.equal(git('status','--porcelain','--untracked-files=all'),'');
    assert.deepEqual(materializeDataset({...options,version:2,worktree}),m);
    fs.writeFileSync(m.path,'tampered');
    assert.throws(()=>materializeDataset({...options,version:2,worktree}),/digest mismatch/);
    fs.unlinkSync(m.path);fs.symlinkSync(v2.archive,m.path);
    assert.throws(()=>materializeDataset({...options,version:2,worktree}),/plain file/);
    fs.unlinkSync(m.path);materializeDataset({...options,version:2,worktree});
    git('add','-f',m.relative);
    assert.throws(()=>materializeDataset({...options,version:2,worktree}),/Git index/);
    git('rm','--cached','-f',m.relative);
    materializeDataset({...options,version:2,worktree,remove:true});assert.equal(fs.existsSync(m.path),false);
    fs.writeFileSync(v2.archive+'.sha256','0'.repeat(64)+'\n');
    assert.throws(()=>materializeDataset({...options,version:2,worktree}),/digest mismatch/);
    await assert.rejects(versionDataset(options),/digest mismatch/);
    assert.deepEqual(fs.readFileSync(v1.archive),first);
  }finally{fs.rmSync(evidenceRoot,{recursive:true,force:true});}
});

test('render is independent of object key order; replaced parents hide their verification; non-managed source survives',async()=>{
  const evidenceRoot=scratch(),issue='MONO-999',source=path.join(evidenceRoot,'scope.md');
  try {
    const opts={evidenceRoot,issue};
    await recordDecision({...opts,entry:decision('d1')});
    await recordDecision({...opts,entry:{type:'verification',id:'v1',forId:'d1',method:'test',result:'pass',recordedAt:'2026-09-16T00:02:00Z'}});
    await recordDecision({...opts,entry:decision('d2',{supersedes:'d1'})});
    const j=readJournal(opts),rendered=renderDecisions(j);
    assert.equal(rendered.includes('"id":"v1"'),false);
    assert.equal(rendered,renderDecisions({...j,entries:j.entries.map(e=>Object.fromEntries(Object.entries(e).reverse()))}));
    fs.writeFileSync(source,'# Header\n\n'+rendered+'\n## Later\nRetained.\n');
    const version=await versionDataset({...opts,source});
    assert.ok(fs.readFileSync(version.archive,'utf8').endsWith('## Later\nRetained.\n'));
    assert.equal((await versionDataset({...opts,source:version.archive})).created,false);
    fs.appendFileSync(source,'\n'+rendered);
    await assert.rejects(versionDataset({...opts,source}),/multiple managed/);
  }finally{fs.rmSync(evidenceRoot,{recursive:true,force:true});}
});

test('interrupted archive publication recovers only an identical retry under the shared archive lock',async()=>{
  const evidenceRoot=scratch(),issue='MONO-999',source=path.join(evidenceRoot,'scope.md'),options={evidenceRoot,issue,source};
  try {
    fs.writeFileSync(source,'# Scope\n\nStable input.\n');
    const version=await versionDataset(options),bytes=fs.readFileSync(version.archive),mtime=fs.statSync(version.archive).mtimeMs;
    fs.unlinkSync(version.archive+'.sha256'); // Crash after publishing the archive, before publishing its digest.
    const recovered=await versionDataset(options);
    assert.deepEqual(recovered,{...version,created:false});
    assert.deepEqual(fs.readFileSync(version.archive),bytes);assert.equal(fs.statSync(version.archive).mtimeMs,mtime);
    assert.equal(fs.readFileSync(version.archive+'.sha256','utf8'),version.digest+'\n');
    fs.unlinkSync(version.archive+'.sha256');fs.writeFileSync(source,'# Scope\n\nDifferent input.\n');
    await assert.rejects(versionDataset(options),/orphan dataset archive differs/);
    assert.equal(fs.existsSync(version.archive+'.sha256'),false);
    assert.deepEqual(fs.readFileSync(version.archive),bytes);
    fs.writeFileSync(source,'# Scope\n\nStable input.\n');
    assert.equal((await versionDataset(options)).created,false);
    fs.writeFileSync(source,'# Scope\n\nDifferent input.\n');
    assert.equal((await versionDataset(options)).version,2);
  }finally{fs.rmSync(evidenceRoot,{recursive:true,force:true});}
});
