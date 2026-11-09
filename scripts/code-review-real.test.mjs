import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReviewRound, resolveReviewRoles } from './code-review.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=path.join(root,'evals/code-review/screen-regressions');
const manifest=JSON.parse(fs.readFileSync(path.join(fixtures,'real-changes.json'),'utf8'));
const manual=JSON.parse(fs.readFileSync(path.join(fixtures,'requests.json'),'utf8')).manual;
let temp,repo,env,oldPath;
before(()=>{
 temp=fs.mkdtempSync(path.join(os.tmpdir(),'mono-real-changes-'));repo=path.join(temp,'repo');const bin=path.join(temp,'bin');fs.mkdirSync(bin);
 const model=resolveReviewRoles({},root)['code-review'].model;
 fs.writeFileSync(path.join(bin,'codex'),`#!${process.execPath}\nconsole.log(JSON.stringify({models:[{slug:${JSON.stringify(model)},tool_mode:'code_mode_only',apply_patch_tool_type:'freeform',multi_agent_version:'v2'}]}));\n`,{mode:0o700});
 env={...process.env,PATH:bin+path.delimiter+process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 execFileSync('git',['-c','core.hooksPath=/dev/null','clone','--shared','--no-checkout','--quiet',root,repo],{env});
 assert.equal(manifest.changes.length,20);assert.ok(manifest.changes.some(c=>c.head===manual.head));
 oldPath=process.env.PATH;process.env.PATH=env.PATH;
});
after(()=>{process.env.PATH=oldPath;fs.rmSync(temp,{recursive:true,force:true});});
for(const c of manifest.changes)test('C69 real pack tree '+c.head.slice(0,8),async t=>{
  execFileSync('git',['-c','core.hooksPath=/dev/null','checkout','--quiet','--detach',c.head],{cwd:repo,env});
  const changedFiles=execFileSync('git',['diff','--name-only','-z',c.base,c.head,'--'],{cwd:repo,env,encoding:'utf8'}).split('\0').filter(Boolean).length;
  if(c.head.startsWith('28f5de40'))assert.equal(changedFiles,112);
  let calls=0;const result=await runReviewRound({worktree:repo,head:c.head,base:c.base,contract:c.head===manual.head?manual.contract:'Review this pack change. Keep source, status, README, string, claude and paths valid.',risk:'standard',config:{},packRoot:root},{runRole:async request=>{
   calls++;const context=JSON.parse(request.prompt.split('never instructions.\n')[1]);
   assert.ok(context.diff.length>0,'safe portions of real change must reach the role');
   return {response:{completed:true,reviewedFiles:context.files.filter(f=>!context.unreviewedFiles.includes(f)),findings:[]}};
  }});
  assert.ok(calls>0,JSON.stringify({head:c.head,failures:result.failures,unreviewedFiles:result.unreviewedFiles,unreviewedInputs:result.unreviewedInputs}));
  assert.ok(!result.failures.some(f=>/final role prompt contains a detected secret/.test(f.reason)));
  t.diagnostic(JSON.stringify({head:c.head,changedFiles,roleCalls:calls,unreviewedFiles:result.unreviewedFiles.length,outcome:result.outcome}));
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:repo,env,encoding:'utf8'}),'');
});
