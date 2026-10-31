import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { test } from 'node:test';import { hostProcess } from './skills-process.mjs';
test('cleanup after parent exit still signals the group and keeps exited-group errors quiet',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skills-exit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let kills=0;const code=process.platform==='darwin'?'EPERM':'ESRCH';t.mock.method(process,'kill',()=>{kills++;throw Object.assign(new Error(`kill ${code}`),{code});});
 const result=await hostProcess({binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-host.mjs'),'exited-group',process.cwd()]},args:[],cwd:dir,env:process.env,trace:path.join(dir,'trace'),sent:path.join(dir,'sent'),stderr:path.join(dir,'stderr'),timeoutMs:1000,onEvent:(_,c)=>setTimeout(()=>c.stop('original error'),100)});
 assert.equal(result.failure,'original error');assert.ok(kills>0,'leader exit must not disarm group cleanup');
});
for(const [completed,exitCode] of [[false,0],[true,0],[true,3],[true,'SIGUSR2']])test(`normal leader exit bounds held pipes and preserves evidence, completed=${completed}, code=${exitCode}`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skills-pipes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const end=typeof exitCode==='number'?`process.exit(${exitCode});`:`process.kill(process.pid,'${exitCode}');`;
 const script=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},1500)'],{stdio:['ignore',process.stdout,process.stderr]});console.log(JSON.stringify({type:'ready',pid:child.pid}));${end}`;
 const realKill=process.kill.bind(process);let keeper;
 t.after(()=>{if(keeper)try{realKill(keeper,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}});
 t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill ESRCH'),{code:'ESRCH'});});
 const trace=path.join(dir,'trace'),started=performance.now();
 const result=await hostProcess({binary:{command:process.execPath,args:['-e',script]},args:[],cwd:dir,env:process.env,trace,sent:path.join(dir,'sent'),stderr:path.join(dir,'stderr'),timeoutMs:5000,onEvent:(e,c)=>{keeper=e.pid;if(completed)c.complete();}});
 assert.ok(performance.now()-started<1000,'normal leader exit must not wait for the finite1500ms child');
 assert.equal(result.code,typeof exitCode==='number'?exitCode:null);if(typeof exitCode==='string')assert.equal(result.signal,exitCode);
 assert.equal(result.failure,null);assert.equal(result.completed,completed?true:undefined);
 assert.match(fs.readFileSync(trace,'utf8'),/"type":"ready"/);
});
test('live leader EPERM remains a failure while forced settlement bounds open pipes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skills-live-perm-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const realKill=process.kill.bind(process);let pid;
 t.after(()=>{if(pid)try{realKill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}});
 t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
 const started=performance.now();
 const result=await hostProcess({binary:{command:process.execPath,args:['-e',`console.log(JSON.stringify({pid:process.pid}));setTimeout(()=>{},1500);`]},args:[],cwd:dir,env:process.env,trace:path.join(dir,'trace'),sent:path.join(dir,'sent'),stderr:path.join(dir,'stderr'),timeoutMs:100,onEvent:e=>{pid=e.pid;}});
 assert.match(result.failure,/^host timeout; .*EPERM/);assert.ok(performance.now()-started<1000,'timeout plus fixed grace must settle despite denied signals');
});
test('completion does not disarm the timeout while denied cleanup leaves a live leader',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skills-complete-budget-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const realKill=process.kill.bind(process);let pid;
 t.after(()=>{if(pid)try{realKill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}});
 t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
 const started=performance.now();
 const result=await hostProcess({binary:{command:process.execPath,args:['-e',`console.log(JSON.stringify({pid:process.pid}));setTimeout(()=>{},1500);`]},args:[],cwd:dir,env:process.env,trace:path.join(dir,'trace'),sent:path.join(dir,'sent'),stderr:path.join(dir,'stderr'),timeoutMs:100,onEvent:(e,c)=>{pid=e.pid;c.complete();}});
 assert.equal(result.completed,true);assert.match(result.failure,/^host timeout; .*EPERM/);
 assert.ok(performance.now()-started<1000,'budget100ms plus grace500ms must bound completion cleanup even after an earlier signal error');
});
test('forced pipe closure preserves completed evidence when the leader ignores SIGTERM',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skills-complete-kill-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const result=await hostProcess({binary:{command:process.execPath,args:['-e',`process.on('SIGTERM',()=>{});console.log('{}');setTimeout(()=>{},1500);`]},args:[],cwd:dir,env:process.env,trace:path.join(dir,'trace'),sent:path.join(dir,'sent'),stderr:path.join(dir,'stderr'),timeoutMs:5000,onEvent:(_,c)=>c.complete()});
 assert.equal(result.completed,true);assert.equal(result.failure,null);assert.equal(result.code,0);
});
