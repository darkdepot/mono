import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {runScenario} from './skills-run.mjs';
const repo=process.cwd();
function setup(t,host,mode){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'mono-roles-'));t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
 const authFile=path.join(cwd,'auth.json');fs.writeFileSync(authFile,'{}');
 return {host,cwd,packRoot:repo,authFile,outputDir:path.join(cwd,'out'),timeoutMs:10000,idleMs:10,maxTurns:64,binary:{command:process.execPath,args:[path.join(repo,'scripts/test-fixtures/skills-role-host.mjs'),mode,repo]},mcpServers:{monotest:{url:'https://example.test/mcp'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},scenario:{prompt:'Run roles',brief:'Колонка Источник из source; пусто — прочерк.',allowedTools:['*'],windows:[{mode:'label',label:'Утвердить, продолжу позже'}],expectedWindows:[{id:'approve',role:'approval',decision:'Утвержд',advice:'Совет',reason:'Research',summary:['Что']}]}};
}
for(const host of ['claude','codex']){
 for(const mode of ['roles','roles-many','roles-tail'])test(`${host}: ${mode} defaults precede/follow the target without consuming its policy`,async t=>{
  const r=await runScenario(setup(t,host,mode));assert.equal(r.status,'passed',JSON.stringify(r));
  const targets=r.replies.filter(w=>w.target);assert.equal(targets.length,1);assert.equal(targets[0].policy,'label');
  assert(host==='claude'?r.freeReplies.length>0:r.replies.some(w=>w.policy==='persona'));assert(r.replies.some(w=>w.policy==='recommended'));
  assert.equal(r.check.windows.length,r.replies.length);assert(r.check.windows.filter(w=>!w.target).every(w=>w.status==='passed'));
 });
 test(`${host}: correction/reapproval targets survive intervening ordinary choices`,async t=>{
  const request=setup(t,host,'roles-correction');request.scenario.windows.unshift({mode:'correction',text:'Сохрани прочерк при пустом source.'});request.scenario.expectedWindows.push({...request.scenario.expectedWindows[0],id:'reapprove'});
  const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.deepEqual(r.replies.filter(w=>w.target).map(w=>w.policy),['correction','label']);
 });
 for(const policy of [{mode:'recommended'},{mode:'empty'},{mode:'refuse',text:'Ничего не утверждаю.'},{mode:'discuss'}])test(`${host}: ${policy.mode} is applied to the target only`,async t=>{
  const request=setup(t,host,'roles');request.scenario.windows=[policy];const r=await runScenario(request);
  assert.equal(r.status,'passed',JSON.stringify(r));assert.deepEqual(r.replies.filter(w=>w.target).map(w=>w.policy),[policy.mode]);
 });
 for(const mode of ['roles-transition','roles-handoff'])test(`${host}: transition role recognizes ${mode} labels`,async t=>{
  const request=setup(t,host,mode);request.scenario.windows=[{mode:'recommended'}];Object.assign(request.scenario.expectedWindows[0],{role:'transition',decision:'Начин',reason:mode==='roles-transition'?'Discovery':'Совет'});
  const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies.filter(w=>w.target).length,1);
 });
 test(`${host}: a visible non-four-section summary needs no invented headings`,async t=>{
  const request=setup(t,host,'roles-plain-summary');request.scenario.expectedWindows[0].summary=[];
  const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));
 });
 test(`${host}: no summary anchors never permits thinking instead of visible summary`,async t=>{
  const request=setup(t,host,'roles-thinking');request.scenario.expectedWindows[0].summary=[];
  const r=await runScenario(request);assert.equal(r.status,'failed',JSON.stringify(r));assert((r.cardCheck??r.check).windows.some(w=>w.issues.some(i=>/visible|async summary/.test(i))));
 });
 for(const mode of ['roles-missing','roles-replaced','roles-thinking','roles-extra-target','roles-default-bad','roles-default-thinking',...(host==='codex'?['roles-unconfirmed']:[])])test(`${host}: ${mode} never receives green`,async t=>{
  const r=await runScenario(setup(t,host,mode));assert.notEqual(r.status,'passed',JSON.stringify(r));
  if(mode!=='roles-unconfirmed')assert.equal(r.status,'failed',JSON.stringify(r));
 });
 test(`${host}: fresh seed route mismatch stops before the stage`,async t=>{
  const request=setup(t,host,'seed-mismatch'),dumpDir=path.join(request.cwd,'seed-dump'),projectFile=path.join(request.cwd,'seed-project.json'),projectName='monotest-route';
  const configFile=path.join(request.cwd,'config.json');fs.writeFileSync(configFile,'{}');
  request.seed={prompt:'Seed route '+JSON.stringify({dumpDir,projectFile,projectName}),dumpDir,projectFile,projectName,expectedStage:'tech-evaluation',configFile};
  const r=await runScenario(request);assert.equal(r.status,'failed',JSON.stringify(r));assert.match(r.reason,/seed route/);
  if(host==='codex'){const calls=fs.readFileSync(path.join(request.cwd,'role-invocations.jsonl'),'utf8');assert(!calls.includes('Run roles'));}
  else assert(!fs.readFileSync(r.sent,'utf8').includes('Run roles'));
 });
 test(`${host}: matching fresh route permits the stage`,async t=>{
  const request=setup(t,host,'seed-matches'),dumpDir=path.join(request.cwd,'seed-dump'),projectFile=path.join(request.cwd,'seed-project.json'),projectName='monotest-route';
  const configFile=path.join(request.cwd,'config.json');fs.writeFileSync(configFile,'{}');
  request.seed={prompt:'Seed route '+JSON.stringify({dumpDir,projectFile,projectName}),dumpDir,projectFile,projectName,expectedStage:'tech-evaluation',configFile};
  const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.seedRoute.route.next,'tech-evaluation');
 });
}
test('Claude two generic questions still fails the one-question rule',async t=>{
 const r=await runScenario(setup(t,'claude','roles-twoquestions'));assert.equal(r.status,'failed');assert(r.check.windows.some(w=>w.issues.includes('one question at a time')));
});
test('Codex native and plain free questions need no positional freeQuestions hints',async t=>{
 const request=setup(t,'codex','roles-mixed-free');request.scenario.freeQuestions=[];
 const r=await runScenario(request);assert.equal(r.status,'passed',JSON.stringify(r));
 assert.equal(r.replies.filter(w=>w.policy==='persona').length,1);assert.equal(r.freeReplies.length,1);
});
