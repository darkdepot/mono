import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { test } from 'node:test';import { hostProcess } from './skills-process.mjs';
import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture(t,prefix){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix)),kill=process.kill.bind(process),pids=new Set();
 // Child startup and pipe delivery use real I/O; only the driver's timers move
 // when the test advances them after observing readiness or actual leader exit.
 t.mock.timers.enable({apis:['setTimeout']});
 t.after(()=>{for(const pid of pids)try{kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}fs.rmSync(dir,{recursive:true,force:true});});
 return {track:pid=>pids.add(pid),request:{args:[],cwd:dir,env:process.env,trace:path.join(dir,'trace'),sent:path.join(dir,'sent'),stderr:path.join(dir,'stderr')}};
}
function observeExit(t,decorate=()=>{}){
 const exited=deferred(),spawn=childProcess.spawn;
 t.mock.method(childProcess,'spawn',(...args)=>{const child=spawn(...args);decorate(child);child.once('exit',exited.resolve);return child;});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});return exited.promise;
}
async function bounded(t,run,milliseconds){
 let settled=false;run.then(()=>{settled=true;});
 t.mock.timers.tick(milliseconds);await Promise.resolve();
 assert.equal(settled,true,'driver must settle within the advanced cleanup budget');return run;
}
const liveLeader='console.log(JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);';
const heldPipes="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});console.log(JSON.stringify({type:'ready',pid:child.pid}));";

test('an exit event makes EPERM quiet even before exit fields reflect it',async t=>{
 const f=fixture(t,'skills-exit-event-');
 observeExit(t,child=>child.prependListener('exit',()=>{child.exitCode=null;child.signalCode=null;}));
 t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
 const result=await hostProcess({...f.request,binary:{command:process.execPath,args:['-e','console.log("{}");']},timeoutMs:1000,onEvent:()=>{}});
 assert.equal(result.code,0);assert.equal(result.failure,null);assert.equal(result.cleanupErrors,undefined);
});
test('cleanup signal errors cannot replace the original verdict',async t=>{
 const f=fixture(t,'skills-cleanup-verdict-'),ready=deferred();
 t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill EIO'),{code:'EIO'});});
 const run=hostProcess({...f.request,binary:{command:process.execPath,args:['-e',liveLeader]},timeoutMs:2000,onEvent:(e,c)=>{f.track(e.pid);c.stop('original verdict');ready.resolve();}});
 await ready.promise;const result=await bounded(t,run,500);
 assert.equal(result.failure,'original verdict');assert(result.cleanupErrors?.some(e=>e.includes('EIO')));
});
test('cleanup after parent exit still signals the group and keeps exited-group errors quiet',async t=>{
 const f=fixture(t,'skills-exit-'),ready=deferred(),exited=observeExit(t);
 let kills=0;const code=process.platform==='darwin'?'EPERM':'ESRCH';t.mock.method(process,'kill',()=>{kills++;throw Object.assign(new Error('kill '+code),{code});});
 const run=hostProcess({...f.request,binary:{command:process.execPath,args:['-e',heldPipes+'process.exit(0);']},timeoutMs:1000,onEvent:(e,c)=>{f.track(e.pid);setTimeout(()=>c.stop('original error'),100);ready.resolve();}});
 await Promise.all([ready.promise,exited]);const result=await bounded(t,run,500);
 assert.equal(result.failure,'original error');assert.ok(kills>0,'leader exit must not disarm group cleanup');assert.equal(result.cleanupErrors,undefined);
});
for(const [completed,exitCode] of [[false,0],[true,0],[true,3],[true,'SIGUSR2']])test('normal leader exit bounds held pipes and preserves evidence, completed='+completed+', code='+exitCode,async t=>{
 const f=fixture(t,'skills-pipes-'),ready=deferred(),exited=observeExit(t);
 const end=typeof exitCode==='number'?'process.exit('+exitCode+');':"process.kill(process.pid,'"+exitCode+"');";
 t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill ESRCH'),{code:'ESRCH'});});
 const run=hostProcess({...f.request,binary:{command:process.execPath,args:['-e',heldPipes+end]},timeoutMs:5000,onEvent:(e,c)=>{f.track(e.pid);if(completed)c.complete();ready.resolve();}});
 await Promise.all([ready.promise,exited]);const result=await bounded(t,run,500);
 assert.equal(result.code,typeof exitCode==='number'?exitCode:null);if(typeof exitCode==='string')assert.equal(result.signal,exitCode);
 assert.equal(result.failure,null);assert.equal(result.completed,completed?true:undefined);
 assert.match(fs.readFileSync(f.request.trace,'utf8'),/"type":"ready"/);
});
test('live leader EPERM remains a failure while forced settlement bounds open pipes',async t=>{
 const f=fixture(t,'skills-live-perm-'),ready=deferred();
 t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
 const run=hostProcess({...f.request,binary:{command:process.execPath,args:['-e',liveLeader]},timeoutMs:100,onEvent:e=>{f.track(e.pid);ready.resolve();}});
 await ready.promise;t.mock.timers.tick(100);const result=await bounded(t,run,500);
 assert.equal(result.failure,'host timeout');assert(result.cleanupErrors.some(e=>e.includes('EPERM')));
});
test('completion does not disarm the timeout while denied cleanup leaves a live leader',async t=>{
 const f=fixture(t,'skills-complete-budget-'),ready=deferred();
 t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
 const run=hostProcess({...f.request,binary:{command:process.execPath,args:['-e',liveLeader]},timeoutMs:100,onEvent:(e,c)=>{f.track(e.pid);c.complete();ready.resolve();}});
 await ready.promise;t.mock.timers.tick(100);const result=await bounded(t,run,500);
 assert.equal(result.completed,true);assert.equal(result.failure,'host timeout');assert(result.cleanupErrors.some(e=>e.includes('EPERM')));
});
test('forced pipe closure preserves completed evidence when the leader ignores SIGTERM',async t=>{
 const f=fixture(t,'skills-complete-kill-'),ready=deferred();
 const run=hostProcess({...f.request,binary:{command:process.execPath,args:['-e',"process.on('SIGTERM',()=>{});"+liveLeader]},timeoutMs:5000,onEvent:(e,c)=>{f.track(e.pid);c.complete();ready.resolve();}});
 await ready.promise;t.mock.timers.tick(25);const result=await bounded(t,run,500);
 assert.equal(result.completed,true);assert.equal(result.failure,null);assert.equal(result.code,0);
});

for(const code of [137,143])test(`MONO-291 driver stop accepts trapped Claude exit ${code} only after successful completion`,async t=>{
 const f=fixture(t,'skills-trapped-stop-'),ready=deferred(),exited=observeExit(t);
 const run=hostProcess({...f.request,binary:{command:process.execPath,args:['-e',`process.on('SIGTERM',()=>process.exit(${code}));`+liveLeader]},timeoutMs:5000,onEvent:(e,c)=>{f.track(e.pid);c.complete();ready.resolve();}});
 await ready.promise;t.mock.timers.tick(25);await exited;const result=await bounded(t,run,500);
 assert.equal(result.code,0);assert.equal(result.failure,null);assert.equal(result.completed,true);
});
for(const completed of [false,true])test(`MONO-291 unsolicited shell-style exit 143 stays failed, completed=${completed}`,async t=>{
 const f=fixture(t,'skills-unsolicited-exit-');
 const run=hostProcess({...f.request,binary:{command:process.execPath,args:['-e','console.log("{}");process.exit(143);']},timeoutMs:5000,onEvent:(e,c)=>{if(completed)c.complete();}});
 const result=await run;assert.equal(result.code,143);
});

test('MONO-291 descendant cleanup cannot excuse an unsolicited leader exit 143',async t=>{
 const f=fixture(t,'skills-exited-leader-'),ready=deferred(),exited=observeExit(t);
 const run=hostProcess({...f.request,binary:{command:process.execPath,args:['-e',heldPipes+'process.exit(143);']},timeoutMs:5000,onEvent:(e,c)=>{f.track(e.pid);c.complete();ready.resolve();}});
 await Promise.all([ready.promise,exited]);const result=await bounded(t,run,500);assert.equal(result.code,143);
});
