import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './skills-catalog.mjs';
import { selectScenarios, saveSelection } from './skills-select.mjs';
import { runSuite } from './skills-suite.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'evals/scenarios');
const neighbors={idea:['research'],research:['idea','discovery'],discovery:['research','design','tech-evaluation','handoff'],
  design:['discovery','tech-evaluation','handoff'],'tech-evaluation':['discovery','design','handoff'],handoff:['discovery','design','tech-evaluation']};
const write=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-catalog-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const catalogDir=path.join(dir,'custom-catalog');fs.cpSync(source,catalogDir,{recursive:true});
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Mono Fixture');git('config','user.email','fixture@example.test');
  for (const stage of Object.keys(neighbors)) write(path.join(dir,`skills/${stage}/SKILL.md`),'baseline\n');
  for (const file of json(path.join(catalogDir,'index.json')).sharedFiles) write(path.join(dir,file),'baseline\n');
  write(path.join(dir,'templates/qa-output.md'),'baseline\n');
  const commit=()=>{git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD');};
  const base=commit();
  const select=()=>selectScenarios({indexFile:path.join(catalogDir,'index.json'),worktree:dir,base,head:git('rev-parse','HEAD')});
  return {dir,catalogDir,git,base,commit,select};
}

test('Mono catalog has exactly six stage contracts, all host windows and no stored run identities',()=>{
  const catalog=loadCatalog(path.join(source,'index.json'));
  assert.deepEqual([...catalog.stages.keys()],Object.keys(neighbors));assert.equal(catalog.scenarios.size,17);
  for(const [id,stage] of catalog.stages){
    assert.deepEqual(stage.neighbors,neighbors[id]);assert.equal(stage.scenarios.length,id==='research'?2:3);
    assert.deepEqual(stage.scenarios.map(p=>catalog.scenarios.get(`${id}/${p.split('/')[1]}`).kind),id==='research'?['main','discuss']:['main','correction','empty']);
    assert(!stage.files.includes('templates/qa-output.md'));
    for(const common of ['references/owner-dialog.md','scripts/russian-stages.mjs','scripts/idea-gate.mjs']) assert(stage.files.includes(common));
  }
  for(const scenario of catalog.scenarios.values()){
    assert(scenario.brief.includes('Mono'));assert(scenario.expectedRecords.length);
    if(scenario.stage==='idea')assert.equal(scenario.seed,null);
    for(const host of ['claude','codex'])assert.equal(scenario.hosts[host].windows.length,scenario.hosts[host].expectedWindows.length);
  }
  for(const [file,bytes] of catalog.files){
    if(!file.endsWith('.json'))continue;
    const text=bytes.toString();assert(!/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i.test(text),'no live UUIDs');
    assert(!/\/Users\/|https:\/\/linear\.app\/(?!monotest\/)/.test(text),'no private paths/workspace links');
    if(file.includes(`${path.sep}seeds${path.sep}`))for(const document of JSON.parse(text).documents ?? []){
      if(document.type==='research'){
        const block=document.content.split('```mono-research\n')[1]?.split('\n```')[0];
        assert(block,'research seed must carry its machine block');
        const record=JSON.parse(block);assert.equal(record.outcome,'not-required');assert.equal(typeof record.interface,'boolean');
      }
    }
  }
});

test('stage-only diff selects all own scenarios and only main paths of every declared neighbor',t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/discovery/SKILL.md'),'changed\n');f.commit();
  const selected=f.select();assert.deepEqual(selected.affected,['discovery']);
  assert.deepEqual(selected.selected.map(s=>s.scenario).sort(),['discovery/approve','discovery/correction','discovery/empty','research/approve','design/approve','tech-evaluation/approve','handoff/approve'].sort());
  assert.deepEqual(selected.units[0].scenarios,['research/approve','discovery/approve','design/approve']);
  assert(selected.expectedItems.every(i=>i.source==='scenario'));
});

test('shared owner-dialog change selects all scenarios of all six stages (AE4)',t=>{
  const f=fixture(t);write(path.join(f.dir,'references/owner-dialog.md'),'changed\n');f.commit();
  const selected=f.select();assert.deepEqual(selected.affected,Object.keys(neighbors));assert.equal(selected.selected.length,17);
});

test('unrelated QA template does not select stage behavior',t=>{
  const f=fixture(t);write(path.join(f.dir,'templates/qa-output.md'),'changed\n');f.commit();
  assert.deepEqual(f.select().expectedItems,[]);
});

test('deleted scenario is refused even if index replaces it with another well-shaped scenario',t=>{
  const f=fixture(t), indexFile=path.join(f.catalogDir,'index.json'), index=json(indexFile);
  fs.renameSync(path.join(f.catalogDir,'idea/empty'),path.join(f.catalogDir,'idea/refuse'));
  const file=path.join(f.catalogDir,'idea/refuse/scenario.json'), scenario=json(file);scenario.id='refuse';fs.writeFileSync(file,JSON.stringify(scenario));
  index.stages[0].scenarios[2]='idea/refuse/scenario.json';fs.writeFileSync(indexFile,JSON.stringify(index));f.commit();
  assert.throws(f.select,/removed scenario: idea\/empty/);
});

test('missing window, missing seed and escaped paths cannot produce a valid catalog',t=>{
  const f=fixture(t), file=path.join(f.catalogDir,'design/approve/scenario.json'), original=fs.readFileSync(file);
  let scenario=json(file);scenario.hosts.codex.expectedWindows=[];fs.writeFileSync(file,JSON.stringify(scenario));
  assert.throws(()=>loadCatalog(path.join(f.catalogDir,'index.json')),/windows/);
  fs.writeFileSync(file,original);scenario=json(file);scenario.seed='../outside.json';fs.writeFileSync(file,JSON.stringify(scenario));
  assert.throws(()=>loadCatalog(path.join(f.catalogDir,'index.json')),/invalid path/);
  fs.writeFileSync(file,original);fs.rmSync(path.join(f.catalogDir,'seeds/prd-design.json'));
  assert.throws(()=>loadCatalog(path.join(f.catalogDir,'index.json')),/ENOENT/);
});

test('CLI writes an exclusive expected list and accepts an alternate catalog location',t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const request=path.join(f.dir,'request.json'), output=path.join(f.dir,'selection.json');
  fs.writeFileSync(request,JSON.stringify({indexFile:path.join(f.catalogDir,'index.json'),worktree:f.dir,base:f.base,head:'HEAD',output}));
  execFileSync(process.execPath,[path.join(root,'scripts/skills-select.mjs'),request],{stdio:'pipe'});
  assert(json(output).expectedItems.length);assert.throws(()=>saveSelection(output,f.select()),/EEXIST/);
  assert.throws(()=>execFileSync(process.execPath,[path.join(root,'scripts/skills-select.mjs'),request],{stdio:'pipe'}));
});

test('suite persists expectations before calls and shares one read-back project through a short chain in both hosts',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/discovery/SKILL.md'),'changed\n');f.commit();
  const selection=f.select(), selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,selection);
  const outputDir=path.join(f.dir,'run'), calls=[];
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'fixture',outputDir,cwd:f.dir,packRoot:root,
    mcpServers:{monotest:{url:'https://example.test/mcp'}},paper:{fileId:'test-file',command:'paper',args:['mcp']},designMemoryFile:path.join(f.dir,'test-memory.md')},async request=>{
    assert.deepEqual(json(path.join(outputDir,'expected-items.json')),selection.expectedItems);
    assert.equal(request.idleMs,20000);assert.equal(request.timeoutMs,1800000);assert(request.maxTurns>request.scenario.windows.length);
    assert.equal(request.workspaceProof.equals,'Mono Test');assert(request.scenario.prompt.includes('не исполнитель-воркер'));
    if(request.context.project)assert.equal(request.context.project.name,request.context.projectName);
    else write(request.context.projectFile,JSON.stringify({id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'}));
    if(request.mcpServers.paper){
      const guard=json(request.mcpServers.paper.args[1]);assert.equal(guard.fileId,'test-file');
      assert(request.scenario.prompt.includes('test-file'));assert(request.scenario.prompt.includes('как на проде'));
    }
    calls.push(request);return {status:'passed'};
  });
  assert.equal(result.status,'passed');assert.equal(calls.length,selection.expectedItems.length);
  for(const host of ['claude','codex']){
    const chain=calls.filter(c=>c.host===host&&c.context.projectName.endsWith('discovery-approve'));
    assert.equal(chain.length,3);assert.equal(chain[0].context.project,null);assert.equal(chain[1].context.project.id,chain[2].context.project.id);
  }
});

test('a failed chain stage leaves all later expected items unverified, not dropped',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'failed',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async()=>({status:'failed'}));
  assert.equal(result.status,'failed');assert(result.items.some(i=>i.scenario==='research/approve'&&i.status==='unverified'));
});

test('suite rejects changed catalog and missing Paper id before the first host',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/discovery/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());
  const request={selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'reject',outputDir:path.join(f.dir,'run'),cwd:f.dir};
  await assert.rejects(()=>runSuite(request,()=>{throw new Error('must not run');}),/fileId/);
  await assert.rejects(()=>runSuite({...request,workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Wrong Space'}},()=>{throw new Error('must not run');}),/workspace proof/);
  fs.appendFileSync(path.join(f.catalogDir,'design/approve/rubric.md'),'changed\n');
  await assert.rejects(()=>runSuite(request),/catalog changed/);
});

test('a replaced project manifest cannot send the next stage to another project',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());
  let called=0;
  await assert.rejects(()=>runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'project',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
    called++;write(request.context.projectFile,JSON.stringify({id:'00000000-0000-4000-8000-000000000001',name:'foreign-project',url:'https://linear.app/monotest/project/foreign'}));return {status:'passed'};
  }),/project read-back manifest/);
  assert.equal(called,1);
});

test('Paper guard rejects missing/foreign file ids and forbidden actions before MCP forwarding',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-paper-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const log=path.join(dir,'forwarded.jsonl'), fake=path.join(dir,'fake.mjs');
  write(fake,`import fs from 'node:fs';import readline from 'node:readline';
    const rl=readline.createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);let result={};
    if(m.method==='tools/list')result={tools:[{name:'get_basic_info',inputSchema:{properties:{fileId:{type:'string'}},required:[]}},{name:'archive_resources',inputSchema:{properties:{fileId:{type:'string'}}}},{name:'list_resources',inputSchema:{properties:{}}}]};
    if(m.method==='tools/call'){fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');result={content:[{type:'text',text:'ok'}]};}
    if(m.id!==undefined)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`);
  const request=path.join(dir,'request.json');write(request,JSON.stringify({fileId:'test-file',command:process.execPath,args:[fake],log:path.join(dir,'guard.log')}));
  const child=spawn(process.execPath,[path.join(source,'paper-guard.mjs'),request],{stdio:['pipe','pipe','pipe']});
  t.after(()=>child.kill('SIGTERM'));
  const lines=readline.createInterface({input:child.stdout})[Symbol.asyncIterator]();
  let id=0;
  const call=async(method,params)=>{
    const callId=++id;child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:callId,method,params})+'\n');
    const next=await lines.next();assert(!next.done);const value=JSON.parse(next.value);assert.equal(value.id,callId);return value;
  };
  await call('initialize',{});const listed=await call('tools/list',{});
  assert.deepEqual(listed.result.tools.map(t=>t.name),['get_basic_info']);assert(listed.result.tools[0].inputSchema.required.includes('fileId'));
  for(const args of [{},{fileId:'foreign-file'}])assert((await call('tools/call',{name:'get_basic_info',arguments:args})).result.isError);
  assert((await call('tools/call',{name:'archive_resources',arguments:{fileId:'test-file'}})).result.isError);
  assert((await call('resources/read',{uri:'foreign'})).result.isError);
  assert(!(await call('tools/call',{name:'get_basic_info',arguments:{fileId:'test-file'}})).result.isError);
  child.stdin.end();await new Promise((resolve,reject)=>{child.on('close',code=>code===0?resolve():reject(new Error(`guard exit ${code}`)));child.on('error',reject);});
  const forwarded=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(forwarded.length,1);assert.equal(forwarded[0].params.arguments.fileId,'test-file');
});
