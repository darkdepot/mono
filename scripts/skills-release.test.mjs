import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkTrace} from './skills-trace.mjs';
import {runScenario} from './skills-run.mjs';
const root=process.cwd(),samples='evals/scenarios/probe/samples';
const expected={id:'approval',decision:'описание',advice:'Research',reason:'риск',summary:['Дальше:','Что']};
test('production window checker catches 0.38.1 thinking-only and preserves the fixed control',()=>{
 for(const [name,status] of [['trace-defect-v0.38.1-approval','failed'],['trace-control-v0.41.0-approval','passed']]){
  const result=checkTrace({host:'claude',trace:`${samples}/claude/${name}.json`,testedVersion:name.includes('defect')?'0.38.1':'0.41.0',expectedWindows:[expected],excerpt:true});
  assert.equal(result.status,status,JSON.stringify(result));
  if(status==='failed')assert(result.windows.some(w=>w.issues.some(issue=>/visible|thinking/.test(issue))),JSON.stringify(result));
 }
});
test('production legacy mode rejects missing window rather than accepting a textual substitute',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-window-missing-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const trace=path.join(dir,'trace.jsonl');fs.writeFileSync(trace,JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Что\nДальше: Research\nУтверждаем?'}]}})+'\n'+JSON.stringify({type:'result',subtype:'success'})+'\n');
 const result=checkTrace({host:'claude',trace,testedVersion:'0.38.1',expectedWindows:[expected]});
 assert.equal(result.status,'failed');assert(result.checks.some(c=>c.id==='expected-windows'&&c.status==='failed'),JSON.stringify(result));
});
for(const version of ['0.43.0','0.45.0'])test(`production ${version} keeps the window ban even with a legacy scenario`,()=>{
 const result=checkTrace({host:'claude',trace:`${samples}/claude/trace-control-v0.41.0-approval.json`,testedVersion:version,expectedWindows:[expected],excerpt:true});
 assert.equal(result.status,'failed');assert.match(result.reason,/window|окн/);
});
for(const host of ['claude','codex'])test(`production ${host} legacy adapter delivers a real native window answer`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-window-driver-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const packRoot=path.join(dir,'pack');fs.mkdirSync(packRoot);fs.writeFileSync(path.join(packRoot,'VERSION'),'0.42.0\n');
 for(const name of ['references','scripts'])fs.symlinkSync(path.join(root,name),path.join(packRoot,name));
 const authFile=path.join(dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const r=await runScenario({host,cwd:dir,packRoot,authFile,outputDir:path.join(dir,'out'),timeoutMs:10000,idleMs:10,maxTurns:64,binary:{command:process.execPath,args:[path.join(root,'scripts/test-fixtures/skills-host.mjs'),'ok',root]},mcpServers:{monotest:{url:'https://example.test/mcp'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},scenario:{prompt:'Run stage',brief:'Владелец предпочитает синий.',allowedTools:['*'],windows:[{mode:'recommended'}],expectedWindows:[{...expected,reason:host==='codex'?'чтобы проверить':'риск'}]}});
 assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.replies[0].received,true);assert.equal(r.testedVersion,'0.42.0');
 assert.match(fs.readFileSync(r.sent,'utf8'),host==='claude'?/updatedInput/:/send_user_message_question_reply/);
});

test('MONO-291 a two-question non-target legacy window receives both recommended answers',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-two-questions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const packRoot=path.join(dir,'pack');fs.mkdirSync(packRoot);fs.writeFileSync(path.join(packRoot,'VERSION'),'0.42.0\n');
 for(const name of ['references','scripts'])fs.symlinkSync(path.join(root,name),path.join(packRoot,name));
 const r=await runScenario({host:'claude',cwd:dir,packRoot,outputDir:path.join(dir,'out'),timeoutMs:10000,idleMs:10,maxTurns:64,binary:{command:process.execPath,args:[path.join(root,'scripts/test-fixtures/skills-role-host.mjs'),'roles-twoquestions',root]},mcpServers:{monotest:{url:'test'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},scenario:{prompt:'Run roles',brief:'Источник из source.',allowedTools:['*'],windows:[{mode:'label',label:'Утвердить, продолжу позже'}],expectedWindows:[{id:'approve',role:'approval',decision:'Утвержд',advice:'Совет',reason:'Research',summary:['Что']}]}});
 assert.equal(r.status,'passed',JSON.stringify(r));
 const reply=fs.readFileSync(r.sent,'utf8').trim().split('\n').map(JSON.parse).find(r=>r.response?.response?.updatedInput?.questions?.length===2);
 assert.equal(Object.keys(reply.response.response.updatedInput.answers).length,2);
 assert(Object.values(reply.response.response.updatedInput.answers).every(answer=>answer.endsWith(' (Recommended)')));
});

test('production Codex legacy driver answers a defective async window and keeps failed',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-defective-window-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const packRoot=path.join(dir,'pack');fs.mkdirSync(packRoot);fs.writeFileSync(path.join(packRoot,'VERSION'),'0.38.1\n');
 for(const name of ['references','scripts'])fs.symlinkSync(path.join(root,name),path.join(packRoot,name));
 const authFile=path.join(dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const r=await runScenario({host:'codex',cwd:dir,packRoot,authFile,outputDir:path.join(dir,'out'),timeoutMs:10000,idleMs:10,maxTurns:64,binary:{command:process.execPath,args:[path.join(root,'scripts/test-fixtures/skills-role-host.mjs'),'roles-thinking',root]},mcpServers:{monotest:{url:'test'}},workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'},scenario:{prompt:'Run roles',brief:'Источник из source.',allowedTools:['*'],windows:[{mode:'label',label:'Утвердить, продолжу позже'}],expectedWindows:[{id:'approve',role:'approval',decision:'Утвержд',advice:'Совет',reason:'Research',summary:[]}]}});
 assert.equal(r.status,'failed',JSON.stringify(r));assert(r.replies.some(reply=>reply.target&&reply.received),'defect still requires a real owner answer');
 assert(r.check.windows.some(w=>w.status==='failed'&&w.issues.some(issue=>/async summary/.test(issue))));
});
