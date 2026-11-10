import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound } from './code-review.mjs';
// Offline: real pack commits, stub roles. An ordinary real change must reach the
// reviewer whole and come back clean; no live model is called.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'evals/code-review/real-changes.json'),'utf8'));
let temp,repo,env;
before(()=>{
 temp=fs.mkdtempSync(path.join(os.tmpdir(),'mono-real-changes-'));repo=path.join(temp,'repo');
 env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 execFileSync('git',['-c','core.hooksPath=/dev/null','clone','--shared','--no-checkout','--quiet',root,repo],{env});
 assert.equal(manifest.changes.length,20);
});
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
for(const c of manifest.changes)test('real pack change '+c.head.slice(0,8)+' is reviewed whole',async t=>{
  execFileSync('git',['-c','core.hooksPath=/dev/null','checkout','--quiet','--detach',c.head],{cwd:repo,env});
  const names=args=>execFileSync('git',args,{cwd:repo,env,encoding:'utf8'}).split('\0').filter(Boolean);
  const changed=names(['diff','--name-only','--no-renames','-z',c.base,c.head,'--']),tracked=names(['ls-tree','-r','--name-only','-z',c.head]);
  if(c.head.startsWith('28f5de40'))assert.equal(changed.length,112);
  let calls=0;const result=await runReviewRound({worktree:repo,head:c.head,base:c.base,contract:'Review this pack change.',risk:'standard',config:{},packRoot:root},{runRole:async request=>{
   calls++;const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);
   assert.deepEqual(context.unreviewedFiles,[]);
   for(const file of context.files)assert.ok(context.diff.includes(JSON.stringify('b/'+file)),'changed text file missing from diff: '+file);
   // File tools see the pinned bytes of every changed file that still exists.
   for(const file of context.files.filter(file=>tracked.includes(file)))assert.deepEqual(fs.readFileSync(path.join(request.worktree,file)),execFileSync('git',['cat-file','blob',c.head+':'+file],{cwd:repo,env,maxBuffer:64*1024*1024}));
   return {response:{completed:true,reviewedFiles:context.files,findings:[]}};
  }});
  assert.deepEqual(result.failures,[]);assert.equal(result.outcome,'clean');assert.ok(calls===1||calls===2,'one pass, plus the ordinary pass for a change of 1000+ lines');
  assert.deepEqual(result.unreviewedFiles,[]);assert.deepEqual([...result.round.reviewedFiles,...result.binaryFiles].sort(),[...changed].sort());
  t.diagnostic(JSON.stringify({head:c.head,changedFiles:changed.length,binaryFiles:result.binaryFiles.length,roleCalls:calls,outcome:result.outcome}));
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:repo,env,encoding:'utf8'}),'');
});
