import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCatalog } from './skills-catalog.mjs';
import { selectScenarios, saveSelection } from './skills-select.mjs';
import { runSuite as actualSuite, scenarioPrompt } from './skills-suite.mjs';
import { checkTrace as textTrace } from './skills-trace.mjs';
import { checkTrace as windowTrace } from './test-fixtures/legacy-window-trace.mjs';
const checkTrace=request=>request.expectedReplies?textTrace(request):windowTrace(request);

// These fixtures isolate suite orchestration. Native response/record verification
// has separate real-consumer fixtures. Only mocked hosts get constructed exchanges.
const runSuiteWithRecords=(request,execute,verify)=>actualSuite(request,async r=>{
 const result=await execute(r);
 if(result.status==='passed'&&!result.check)result.check={exchanges:r.scenario.expectedReplies.map(expected=>({expected,text:expected.summary.join('\n')+'\nПозиция.\n'+expected.stage+' '+expected.id+'?'}))};
 return result;
},verify);
const runSuite=(request,execute)=>runSuiteWithRecords(request,execute,async input=>({status:'passed',monotestTasks:0,starts:input.runRequest.scenario.expectedReplies.flatMap(r=>(r.driverStart===null||r.driverStart===undefined)?[]:(Array.isArray(r.driverStart)?r.driverStart:[r.driverStart]).map(stage=>({stage,replyId:r.id})))}));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'evals/scenarios');
const neighbors={idea:['research'],research:['idea','discovery'],discovery:['research','design','tech-evaluation','handoff'],
  design:['discovery','tech-evaluation','handoff'],'tech-evaluation':['discovery','design','handoff'],handoff:['discovery','design','tech-evaluation']};
const write=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const runProject=request=>request.context.project??{id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'};
const passedStage=request=>({status:'passed',...(request.seed?{seedRoute:{project:runProject(request)}}:{})});
function suiteRequest(f,selection,extra={}) {
 const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,selection);
 return {selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'revision',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}},...extra};
}
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-catalog-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const catalogDir=path.join(dir,'custom-catalog');fs.cpSync(source,catalogDir,{recursive:true});
  // Preserve every T1 orchestration input/outcome. Current U7 catalog and native
  // transition/rubric consumers have separate tests below and in dialogue/records.
  for(const [relative,value] of Object.entries(json(path.join(root,'scripts/test-fixtures/skills-t1-catalog.json'))))write(path.join(catalogDir,relative),JSON.stringify(value,null,2)+'\n');
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

test('Mono catalog has exactly six stage contracts, all host text replies and no stored run identities',()=>{
  const catalog=loadCatalog(path.join(source,'index.json'));
  assert.deepEqual([...catalog.stages.keys()],Object.keys(neighbors));assert.equal(catalog.scenarios.size,18);
  for(const [id,stage] of catalog.stages){
    assert.deepEqual(stage.neighbors,neighbors[id]);assert.equal(stage.scenarios.length,id==='research'?2:id==='idea'?4:3);
    assert.deepEqual(stage.scenarios.map(p=>catalog.scenarios.get(`${id}/${p.split('/')[1]}`).kind),id==='research'?['main','question']:id==='idea'?['main','correction','unclear','defer']:['main','correction','unclear']);
    assert(!stage.files.includes('templates/qa-output.md'));
    for(const common of ['references/owner-dialog.md','scripts/russian-stages.mjs','scripts/idea-gate.mjs']) assert(stage.files.includes(common));
  }
  for(const scenario of catalog.scenarios.values()){
    assert(scenario.brief.includes('Mono'));assert(scenario.expectedRecords.length);
    assert(scenario.brief.includes('cli/runs.mjs') && scenario.brief.includes('source'),'brief describes the existing neutral test product');
    if(scenario.stage==='idea')assert.equal(scenario.seed,null);
    for(const host of ['claude','codex']){
      assert(scenario.hosts[host].expectedReplies.length);
      assert(scenario.hosts[host].expectedReplies.every(r=>['approval','transition','clarification'].includes(r.role)),'roles are predetermined');
    }
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

for(const mode of ['another-head','dirty-execution','unversioned'])test(`suite rejects ${mode} pack before a host`,async t=>{
 const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();const selection=f.select();
 let packRoot=f.dir;
 if(mode==='another-head')packRoot=root;
 if(mode==='dirty-execution')write(path.join(f.dir,'skills/idea/SKILL.md'),'uncommitted execution\n');
 if(mode==='unversioned'){packRoot=path.join(f.dir,'scratch');fs.mkdirSync(packRoot);}
 let calls=0;await assert.rejects(()=>runSuite(suiteRequest(f,selection,{packRoot}),async()=>{calls++;return {status:'unverified'};}),/pack (revision|execution|checkout)/);
 assert.equal(calls,0);
});

for(const [file,stage] of [['references/contracts/project.md','idea'],['references/contracts/prd.md','discovery'],['references/contracts/issue.md','handoff'],['references/contracts/tech-spec.md','tech-evaluation'],['references/model-policy.md','research'],['references/repair-machine.md','handoff']])test(`consumed ${file} selects ${stage}`,t=>{
 const f=fixture(t);write(path.join(f.dir,file),'changed contract\n');f.commit();assert(f.select().affected.includes(stage));
});

for(const file of ['references/unmapped.md','templates/qa-output.md','skills/qa/SKILL.md'])test(`unmapped ${file} is uncovered, never a zero-item pass`,async t=>{
 const f=fixture(t);write(path.join(f.dir,file),'changed\n');f.commit();const selection=f.select();
 assert.equal(selection.status,'uncovered');assert.deepEqual(selection.uncovered,[file]);
 const result=await runSuite(suiteRequest(f,selection),()=>{throw new Error('uncovered must not start a host');});
 assert.equal(result.status,'unverified');assert.equal(result.reason,'uncovered selection');assert.deepEqual(result.uncovered,[file]);
 assert.equal(json(path.join(f.dir,'run/suite-result.json')).status,'unverified');
});

test('Design memory seed passes real design gate with repository prefix and archived PNG',async t=>{
 const f=fixture(t);write(path.join(f.dir,'skills/design/SKILL.md'),'changed\n');f.commit();
 const home=path.join(f.dir,'design-product'),memory=path.join(home,'demo-product/memory.md'),archive=path.join(path.dirname(memory),'approved');let design=0,other=0;
 const checker=fs.mkdtempSync(path.join(os.tmpdir(),'mono-suite-design-check-'));t.after(()=>fs.rmSync(checker,{recursive:true,force:true}));
 const dump=path.join(checker,'dump'),script=path.join(checker,'idea-gate.mjs');
 fs.cpSync(path.join(root,'scripts/fixtures/design-gate/valid'),dump,{recursive:true});
 write(script,fs.readFileSync(path.join(root,'scripts/idea-gate.mjs'),'utf8').replace("const DESIGN_HOME = path.join(os.homedir(), '.mono-agent-workflow', 'design');",`const DESIGN_HOME = ${JSON.stringify(home)};`));
 fs.copyFileSync(path.join(root,'scripts/runtime.mjs'),path.join(checker,'runtime.mjs'));
 // approvalMain resolves the repository from the config's parent .agents directory.
 const repoConfig=path.join(f.dir,'.agents/mono-workflow.config.json');write(repoConfig,JSON.stringify({projectName:'Demo Product'}));
 const checkMemory=(firstLine,expected)=>{
  write(memory,firstLine+'\n');
  const checked=spawnSync(process.execPath,[script,'design','--mode','fresh','--dump',dump,'--config',repoConfig],{encoding:'utf8'});
  assert.equal(JSON.parse(checked.stdout.trim().split('\n')[1]).code,expected,checked.stdout+checked.stderr);
  assert.equal(checked.status,expected==='pass'?0:1,checked.stdout+checked.stderr);
 };
 const result=await runSuite(suiteRequest(f,f.select(),{paper:{fileIds:['fixture','second-fixture'],command:'paper',args:['mcp']},designMemoryFile:memory}),async request=>{
  if(request.context.entryStage==='design'){
   design++;const guard=json(request.mcpServers.paper.args[1]);assert.deepEqual(guard.fileIds,['fixture','second-fixture']);assert(request.scenario.prompt.includes('["fixture","second-fixture"]'));assert.deepEqual(request.writableRoots,[path.dirname(memory),archive,guard.exportRunDir]);assert(fs.statSync(guard.exportRunDir).isDirectory());assert(!request.scenario.prompt.includes('собирает оркестратор'));assert(!request.scenario.prompt.includes('не переноси'));assert(request.scenario.prompt.includes('обычный шаг архивации'));
   assert(request.scenario.expectedReplies.every(r=>r.stage==='design'&&!r.asksStart));
   fs.cpSync(path.join(dump,'approved'),path.join(archive,'11111111-1111-1111-1111-111111111111'),{recursive:true});
   checkMemory(request.cwd,'stale-images');
   const seeded=JSON.parse(request.scenario.prompt.match(/Посей память: (.+?)\. Не меняй owner-taste/)[1]);
   assert.equal(seeded.fileId,'fixture');checkMemory(seeded.firstLine,'pass');
   checkMemory(json(path.join(f.catalogDir,'seeds/prd-design.json')).designMemory.firstLine.replace('<absolute-test-product-cwd>',request.cwd),'pass');
  }else{other++;assert(!request.writableRoots?.length);}
  write(request.context.projectFile,JSON.stringify(runProject(request)));return passedStage(request);
 });
 assert.equal(result.status,'passed',JSON.stringify(result));assert(design&&other);
});
test('pack revision is checked again after a host and before later stages',async t=>{
 const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();let calls=0;
 const result=await runSuite(suiteRequest(f,f.select()),async request=>{
  calls++;write(request.context.projectFile,JSON.stringify(runProject(request)));f.git('commit','--allow-empty','-qm','another revision');return passedStage(request);
 });
 assert.equal(calls,1);assert.equal(result.status,'failed');assert(result.results.every(r=>r.result.reason.includes('pack revision')));
});

test('seed route is isolated from the following stage before any real stage runs',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/tech-evaluation/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());let checked=0;
  await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'seed-route',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir,
    mcpServers:{monotest:{url:'https://example.test/mcp'}},paper:{fileIds:['fixture'],command:'paper',args:['mcp']},designMemoryFile:path.join(f.dir,'memory.md')},async request=>{
      assert(!request.scenario.prompt.includes('Маршрут этого касания: next='),'following stage is not this touch route');
      assert(request.scenario.brief.includes('cli/runs.mjs'));assert(request.scenario.brief.includes('source'));
      if(request.seed){
        assert(!request.seed.prompt.includes('followingStage'),'seed does not see the outgoing stage');
        if(request.seed.expectedStage){
          checked++;assert(request.seed.prompt.includes(`next=${request.seed.expectedStage} by=owner`),'seed record preserved verbatim');
          assert.equal(request.seed.expectedStage,request.context.entryStage);
          assert(request.seed.dumpDir.startsWith(request.cwd+path.sep));
        }
      }
      write(request.context.projectFile,JSON.stringify(request.context.project??{id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'}));return passedStage(request);
    });
  assert(checked>0);
});

test('catalog reply anchors accept the full final message and preserve the exact owner reply',async()=>{
 const {textReply}=await import('./skills-owner.mjs');
 const catalog=loadCatalog(path.join(source,'index.json'));
 for(const scenario of catalog.scenarios.values())for(const host of ['claude','codex']){
  const expected=scenario.hosts[host].expectedReplies;
  for(const [i,r] of expected.entries()){
   const question=typeof r.question==='string'?r.question:r.question.anchors.map(a=>Array.isArray(a)?a[0]:a).join(' ')+'?';
   const shown=r.summary.join('\n')+'\nМоя позиция по '+scenario.stage+'.\nКак поступим: '+question;
   assert.equal(textReply({expectedReplies:expected},shown,i),r.reply);
   assert.throws(()=>textReply({expectedReplies:expected},'Другой итог без вопроса',i),/question|summary/);
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
  const selected=f.select();assert.deepEqual(selected.affected,Object.keys(neighbors));assert.equal(selected.selected.length,18);
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

test('missing reply, missing seed and escaped paths cannot produce a valid catalog',t=>{
  const f=fixture(t), file=path.join(f.catalogDir,'design/approve/scenario.json'), original=fs.readFileSync(file);
  let scenario=json(file);scenario.hosts.codex.expectedReplies=[];fs.writeFileSync(file,JSON.stringify(scenario));
  assert.throws(()=>loadCatalog(path.join(f.catalogDir,'index.json')),/expectedReplies/);
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
  const f=fixture(t);write(path.join(f.dir,'skills/discovery/SKILL.md'),'changed\n');
  write(path.join(f.dir,'skills/tech-evaluation/SKILL.md'),'changed\n');f.commit();
  const selection=f.select(), selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,selection);
  const outputDir=path.join(f.dir,'run'), cwd=path.join(f.dir,'workspace'), calls=[];fs.mkdirSync(cwd);
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'fixture',outputDir,cwd,packRoot:f.dir,
    mcpServers:{monotest:{url:'https://example.test/mcp'}},paper:{fileIds:['test-file'],command:'paper',args:['mcp']},designMemoryFile:path.join(f.dir,'test-memory.md')},async request=>{
    assert.deepEqual(json(path.join(outputDir,'expected-items.json')),selection.expectedItems);
    assert.equal(request.idleMs,20000);assert.equal(request.timeoutMs,1800000);assert(request.maxTurns>request.scenario.expectedReplies.length);
    assert.equal(request.workspaceProof.equals,'Mono Test');assert(request.scenario.prompt.includes('имитированным владельцем'));
    assert.equal(request.scenario.expectedWindows,undefined);
    assert(request.scenario.expectedReplies.every(r=>r.stage===request.context.entryStage));
    const relative=path.relative(cwd,request.context.projectFile);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'model manifest must be writable under cwd, independent of outputDir');
    assert(!fs.existsSync(request.context.projectFile),'each stage must write its own manifest');
    if(request.context.project)assert.equal(request.context.project.name,request.context.projectName);
    write(request.context.projectFile,JSON.stringify(request.context.project ?? {id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'}));
    if(request.mcpServers.paper){
      const guard=json(request.mcpServers.paper.args[1]);assert.deepEqual(guard.fileIds,['test-file']);
      assert(request.scenario.prompt.includes('test-file'));assert(request.scenario.prompt.includes('как на проде'));
    }
    calls.push(request);return passedStage(request);
  });
  assert.equal(result.status,'passed');assert.equal(calls.length,selection.expectedItems.length);
  for(const call of calls)assert.deepEqual(json(call.outputDir+'-project.json'),json(call.context.projectFile),'copy the model-written manifest into results');
  for(const host of ['claude','codex']){
    const chain=calls.filter(c=>c.host===host&&c.context.projectName.endsWith('discovery-approve'));
    assert.equal(chain.length,3);assert.equal(chain[0].context.project,null);assert.equal(chain[1].context.project.id,chain[2].context.project.id);
  }
});

for(const field of ['id','name','url','missing-proof'])test(`the first seeded stage rejects a changed ${field} before its chain continues`,async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/tech-evaluation/SKILL.md'),'changed\n');f.commit();
  const selection=f.select();selection.units=selection.units.filter(u=>u.id==='tech-evaluation-approve');selection.expectedItems=selection.expectedItems.filter(i=>i.unit==='tech-evaluation-approve');
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,selection);let calls=0;
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'identity-'+field,outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
    calls++;const project=runProject(request),observed={...project};
    if(request.seed&&field!=='missing-proof')observed[field]={id:'00000000-0000-4000-8000-000000000002',name:'another-project',url:'https://linear.app/monotest/project/another'}[field];
    write(request.context.projectFile,JSON.stringify(observed));return field==='missing-proof'?{status:'passed'}:passedStage(request);
  });
  assert.equal(result.status,'failed',field);assert.equal(calls,2,'only first stage in each host runs');
  assert(result.results.every(r=>r.status==='failed'));
  assert(result.items.filter(i=>i.scenario!=='discovery/approve').every(i=>i.status==='unverified'));
});

test('seed and every chain stage accept identical identity fields in any JSON key order',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/tech-evaluation/SKILL.md'),'changed\n');f.commit();
  const selection=f.select();selection.units=selection.units.filter(u=>u.id==='tech-evaluation-approve');selection.expectedItems=selection.expectedItems.filter(i=>i.unit==='tech-evaluation-approve');
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,selection);let calls=0;
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'key-order',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
    calls++;const p=runProject(request),observed=request.seed?{url:p.url,name:p.name,id:p.id}:{name:p.name,id:p.id,url:p.url};
    write(request.context.projectFile,JSON.stringify(observed));return passedStage(request);
  });
  assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(calls,6);
});

test('a stage that omits its manifest cannot reuse the previous stage read-back',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());
  let calls=0;
  const outputDir=path.join(f.dir,'run');
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'missing-manifest',outputDir,cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
    calls++;
    if(calls!==2)write(request.context.projectFile,JSON.stringify(request.context.project??{id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'}));
    return passedStage(request);
  });
  assert.equal(result.status,'failed');
  const failed=result.results.find(r=>r.status==='failed');assert.equal(failed.scenario,'research/approve');assert.match(failed.result.reason,/ENOENT/);
  assert.equal(calls,f.select().expectedItems.length,'other hosts and units continue');
  assert.deepEqual(json(path.join(outputDir,'suite-result.json')),result);
});

test('a failed chain stage leaves all later expected items unverified, not dropped',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'failed',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async()=>({status:'failed'}));
  assert.equal(result.status,'failed');assert(result.items.some(i=>i.scenario==='research/approve'&&i.status==='unverified'));
});

test('empty Idea needs no project, approved correction and the Idea chain require a manifest',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'no-project',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
    assert(!request.seed,'Idea starts without seed');return {status:'passed',replies:[{policy:'empty',received:true}]};
  });
  for(const host of ['claude','codex']){
    assert.equal(result.items.find(i=>i.unit==='idea-empty'&&i.host===host).status,'passed','empty Idea correctly creates no project');
    assert.equal(result.items.find(i=>i.unit==='idea-correction'&&i.host===host).status,'failed','approved standalone correction requires its expected project');
    assert.equal(result.items.find(i=>i.unit==='idea-approve'&&i.scenario==='idea/approve'&&i.host===host).status,'failed','chain must stop without a project pointer');
    assert.equal(result.items.find(i=>i.unit==='idea-approve'&&i.scenario==='research/approve'&&i.host===host).status,'unverified');
  }
});

for(const kind of ['approve','correction'])for(const manifest of [false,true])test(`standalone Idea ${kind} requires its expected project: manifest ${manifest}`,async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const selection=f.select();selection.units=selection.units.filter(u=>u.id===`idea-${kind}`);
  for(const unit of selection.units)unit.scenarios=[`idea/${kind}`];
  selection.expectedItems=selection.expectedItems.filter(i=>i.unit===`idea-${kind}`&&i.scenario===`idea/${kind}`);
  const result=await runSuite(suiteRequest(f,selection),async request=>{
    assert(!request.seed);assert(!request.context.project);
    if(manifest)write(request.context.projectFile,JSON.stringify(runProject(request)));
    return passedStage(request);
  });
  assert.equal(result.items.length,2);
  for(const item of result.items)assert.equal(item.status,manifest?'passed':'failed',`${item.host}: expected project requires a read-back manifest`);
  if(!manifest)assert(result.results.every(r=>/ENOENT/.test(r.result.reason)));
});

test('an incomplete seed stays unverified and leaves its remaining chain unverified',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/tech-evaluation/SKILL.md'),'changed\n');f.commit();
  const selection=f.select();selection.units=selection.units.filter(u=>u.id==='tech-evaluation-approve');selection.expectedItems=selection.expectedItems.filter(i=>i.unit==='tech-evaluation-approve');
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,selection);
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'seed-incomplete',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>request.seed?{status:'unverified',reason:'seed not completed'}:{status:'passed'});
  assert.equal(result.status,'unverified');
  assert(result.results.some(r=>r.result.reason==='seed not completed'));
  assert(result.items.every(i=>i.status==='unverified'),'no incomplete chain item becomes green or a violation');
});

test('suite rejects changed catalog and missing Paper file list before the first host',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/discovery/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());
  const request={selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'reject',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir};
  const missing=await runSuite(request,async r=>{assert.notEqual(r.context.entryStage,'design');write(r.context.projectFile,JSON.stringify(runProject(r)));return passedStage(r);});
  assert.equal(missing.status,'failed');assert(missing.results.some(r=>/fileId/.test(r.result.reason??'')));assert.deepEqual(json(path.join(request.outputDir,'suite-result.json')),missing);
  await assert.rejects(()=>runSuite({...request,workspaceProof:{tool:'mcp__monotest__get_workspace',path:['name'],equals:'Wrong Space'}},()=>{throw new Error('must not run');}),/workspace proof/);
  fs.appendFileSync(path.join(f.catalogDir,'design/approve/rubric.md'),'changed\n');
  await assert.rejects(()=>runSuite(request),/catalog changed/);
});

test('a replaced project manifest cannot send the next stage to another project',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'project',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
    write(request.context.projectFile,JSON.stringify({id:'00000000-0000-4000-8000-000000000001',name:'foreign-project',url:'https://linear.app/monotest/project/foreign'}));return passedStage(request);
  });
  assert.equal(result.status,'failed');assert(result.results.every(r=>r.result.reason.includes('invalid run project read-back manifest')));
  assert(result.items.filter(i=>i.unit==='idea-approve'&&i.scenario==='research/approve').every(i=>i.status==='unverified'),'never enter next stage on a foreign project');
});

test('bad manifests and host errors fail only their chain and always persist the suite result',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const selection=f.select(),selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,selection);
  const failures=[['short-id','P-MON-40'],['malformed',null],['replaced-id','00000000-0000-4000-8000-000000000002'],['host-error',null]];
  for(const [mode,id] of failures){
    const outputDir=path.join(f.dir,mode),calls=[];
    const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:mode,outputDir,cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
      calls.push(request);
      const project=request.context.project??{id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'};
      const bad=request.host==='claude'&&request.context.projectName.endsWith('idea-approve')&&(mode!=='replaced-id'||request.context.project);
      if(bad&&mode==='host-error')throw new Error('fixture host crashed');
      write(request.context.projectFile,bad&&mode==='malformed'?'{':JSON.stringify(bad?{...project,id}:project));return passedStage(request);
    });
    assert.equal(result.status,'failed',mode);assert.deepEqual(json(path.join(outputDir,'suite-result.json')),result);
    const failed=result.results.filter(r=>r.status==='failed');assert.equal(failed.length,1,mode);
    assert.match(failed[0].result.reason,mode==='short-id'?/invalid run project read-back manifest/:mode==='replaced-id'?/chain changed its run project/:mode==='host-error'?/fixture host crashed/:/JSON|property/,mode);
    if(mode!=='replaced-id')assert(result.items.some(i=>i.unit==='idea-approve'&&i.host==='claude'&&i.scenario==='research/approve'&&i.status==='unverified'),mode);
    assert(result.items.filter(i=>i.host==='codex'||i.unit!=='idea-approve').every(i=>i.status==='passed'),mode);
    assert.equal(calls.length,selection.expectedItems.length-(mode==='replaced-id'?0:1),mode);
  }
});

test('stage and seed prompts request get_project.uuid and seed only its available recipe',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/tech-evaluation/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());const calls=[];
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'seed-data',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'https://example.test/mcp'}},paper:{fileIds:['fixture'],command:'paper',args:['mcp']},designMemoryFile:path.join(f.dir,'memory.md')},async request=>{
    calls.push(request);write(request.context.projectFile,JSON.stringify(request.context.project??{id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'}));return passedStage(request);
  });
  assert.equal(result.status,'passed');
  await t.test('manifest UUID',()=>{
    for(const call of calls){
      assert(!/\bundefined\b/.test(call.scenario.prompt));if(call.seed)assert(!/\bundefined\b/.test(call.seed.prompt));
      assert.match(call.scenario.prompt,/get_project\.uuid/,'manifest id comes from the UUID field');
      if(call.seed)assert.match(call.seed.prompt,/get_project\.uuid/,'seed manifest uses the UUID too');
    }
  });
  await t.test('seed without PRD',()=>{
    for(const call of calls)if(call.seed&&!call.seed.expectedStage)assert(!/prdApprovalTemplate|PRD|prd\.json/.test(call.seed.prompt),'a seed without PRD does not request one');
  });
  assert(calls.some(c=>c.context.projectName.endsWith('tech-evaluation-approve')&&c.context.entryStage==='discovery'&&c.seed&&!c.seed.expectedStage),'exercise research-only seed before Discovery in Tech Evaluation chain');
  assert(calls.some(c=>c.seed?.expectedStage&&c.seed.prompt.includes('prdApprovalTemplate')),'PRD seeds retain verbatim route instructions');
});

test('Paper guard rejects missing/foreign file ids and forbidden actions before MCP forwarding',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-paper-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const log=path.join(dir,'forwarded.jsonl'), fake=path.join(dir,'fake.mjs');
  write(fake,`import fs from 'node:fs';import readline from 'node:readline';
    const rl=readline.createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);let result={};
    if(m.method==='tools/list')result={tools:[{name:'get_basic_info',inputSchema:{properties:{fileId:{type:'string'}},required:[]}},{name:'archive_resources',inputSchema:{properties:{fileId:{type:'string'}}}},{name:'list_resources',inputSchema:{properties:{}}},{name:'get_guide',inputSchema:{properties:{topic:{type:'string'}},required:['topic'],additionalProperties:false}}]};
    if(m.method==='tools/call'){fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');result={content:[{type:'text',text:'ok'}]};if(m.params.name==='get_guide'&&Object.hasOwn(m.params.arguments,'fileId'))result.isError=true;}
    if(m.id!==undefined)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`);
  const request=path.join(dir,'request.json');write(request,JSON.stringify({fileIds:['test-file','second-test-file'],command:process.execPath,args:[fake],log:path.join(dir,'guard.log')}));
  const child=spawn(process.execPath,[path.join(source,'paper-guard.mjs'),request],{stdio:['pipe','pipe','pipe']});
  t.after(()=>child.kill('SIGTERM'));
  const lines=readline.createInterface({input:child.stdout})[Symbol.asyncIterator]();
  let id=0;
  const call=async(method,params)=>{
    const callId=++id;child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:callId,method,params})+'\n');
    const next=await lines.next();assert(!next.done);const value=JSON.parse(next.value);assert.equal(value.id,callId);return value;
  };
  await call('initialize',{});const listed=await call('tools/list',{});
  assert.deepEqual(listed.result.tools.map(t=>t.name),['get_basic_info','get_guide']);assert(listed.result.tools.every(t=>t.inputSchema.required.includes('fileId')));assert(listed.result.tools[1].inputSchema.properties.fileId);
  for(const args of [{},{fileId:'foreign-file'},{fileId:['test-file']},{fileId:'test-file '}])assert((await call('tools/call',{name:'get_basic_info',arguments:args})).result.isError);
  assert((await call('tools/call',{name:'archive_resources',arguments:{fileId:'test-file'}})).result.isError);
  assert((await call('tools/call',{name:'unknown_tool',arguments:{fileId:'test-file'}})).result.isError);
  assert((await call('resources/read',{uri:'foreign'})).result.isError);
  assert(!(await call('tools/call',{name:'get_basic_info',arguments:{fileId:'test-file'}})).result.isError);
  assert(!(await call('tools/call',{name:'get_basic_info',arguments:{fileId:'second-test-file'}})).result.isError);
  assert((await call('tools/call',{name:'get_guide',arguments:{topic:'paper-mcp-instructions'}})).result.isError);
  assert(!(await call('tools/call',{name:'get_guide',arguments:{fileId:'test-file',topic:'paper-mcp-instructions'}})).result.isError);
  child.stdin.end();await new Promise((resolve,reject)=>{child.on('close',code=>code===0?resolve():reject(new Error(`guard exit ${code}`)));child.on('error',reject);});
  const forwarded=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(forwarded.length,3);assert.equal(forwarded[0].params.arguments.fileId,'test-file');assert.equal(forwarded[1].params.arguments.fileId,'second-test-file');assert.deepEqual(forwarded[2].params.arguments,{topic:'paper-mcp-instructions'});
});

for(const fileIds of [undefined,[],[''],['test-file',null],'test-file'])test(`Paper guard refuses invalid file list before starting MCP: ${JSON.stringify(fileIds)}`,t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-paper-list-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sentinel=path.join(dir,'spawned'),fake=path.join(dir,'fake.mjs');
 write(fake,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(sentinel)},'spawned');`);
 const request=path.join(dir,'request.json');write(request,JSON.stringify({fileIds,command:process.execPath,args:[fake],log:path.join(dir,'guard.log')}));
 const result=spawnSync(process.execPath,[path.join(source,'paper-guard.mjs'),request],{encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/nonempty fileIds/);assert(!fs.existsSync(sentinel));
});



test('continue5 missing manifest paths never become an instruction to write undefined',()=>{
 const common={scenario:{stage:'idea',brief:'Mono',prompt:'Начни.'},projectName:'monotest-fixture',packRoot:root,productName:'Mono',skillPrefix:'mono'};
 assert.throws(()=>scenarioPrompt(common),/projectFile/);
 assert.throws(()=>scenarioPrompt({...common,projectFile:'/tmp/project.json',seed:{steps:['seed']}}),/seedProjectFile/);
});

test('continue5 zero selection is not-required in saved suite and CLI, with exit zero',async t=>{
 const f=fixture(t);write(path.join(f.dir,'unrelated.txt'),'outside stages');f.commit();
 const selection=f.select();assert.equal(selection.status,'not-required');assert.equal(selection.expectedItems.length,0);
 const request=suiteRequest(f,selection);let calls=0;
 const result=await runSuite(request,()=>{calls++;throw Error('no host');});
 assert.equal(calls,0);assert.equal(result.status,'not-required');assert.deepEqual(json(path.join(request.outputDir,'suite-result.json')),result);
 const requestFile=path.join(f.dir,'cli-request.json');write(requestFile,JSON.stringify({...request,outputDir:path.join(f.dir,'cli-output')}));
 const stdout=execFileSync(process.execPath,[path.join(root,'scripts/skills-suite.mjs'),requestFile],{encoding:'utf8'});
 assert.equal(JSON.parse(stdout).status,'not-required');
});

for(const [file,stages] of [['agents/linear-scout.md',['idea','research','discovery','tech-evaluation']],['agents/code-scout.md',['idea','research','discovery','tech-evaluation','handoff']],['agents/web-scout.md',['idea','research','discovery','tech-evaluation']]])test(`continue5 ${file} selects its launching stages`,t=>{
 const f=fixture(t);write(path.join(f.dir,file),'changed scout');f.commit();
 assert.deepEqual(f.select().affected,stages);
});

test('continue5 Design preparation failures keep completed items and continue other units',async t=>{
 const f=fixture(t);write(path.join(f.dir,'skills/design/SKILL.md'),'changed');f.commit();
 const blocker=path.join(f.dir,'memory-blocker');write(blocker,'not a directory');
 const request=suiteRequest(f,f.select(),{paper:{fileIds:['fixture'],command:'paper',args:[]},designMemoryFile:path.join(blocker,'memory.md')});
 const calls=[];const result=await runSuite(request,async r=>{calls.push(r);write(r.context.projectFile,JSON.stringify(runProject(r)));return passedStage(r);});
 assert.equal(result.status,'failed');assert.deepEqual(json(path.join(request.outputDir,'suite-result.json')),result);
 assert(result.items.some(i=>i.scenario==='discovery/approve'&&i.status==='passed'));
 assert(result.items.some(i=>i.scenario==='design/approve'&&i.status==='failed'));
 assert(result.items.some(i=>i.unit==='design-approve'&&i.scenario==='handoff/approve'&&i.status==='unverified'));
 assert(calls.some(r=>r.context.entryStage==='tech-evaluation'),'other independent units still run');
});

for(const mode of ['inside','inside-text','inside-lines','inside-uri','outside','symlink','mixed','delete-EPERM','delete-EACCES','delete-EIO','copy-EACCES','copy-size','copy-digest'])test(`continue5 Paper export ${mode} through fake MCP`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-export-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const exportDir=path.join(dir,'Downloads'),exportRunDir=path.join(dir,'run');fs.mkdirSync(exportDir);fs.mkdirSync(exportRunDir);
 const good=path.join(exportDir,'art #board.png'),foreign=path.join(dir,'foreign.png'),sentinel=path.join(exportDir,'untouched.png');
 write(good,'PNG');write(foreign,'FOREIGN');write(sentinel,'KEEP');
 const link=path.join(exportDir,'link.png');fs.symlinkSync(foreign,link);
 const files=mode.startsWith('inside')||mode.startsWith('delete-')||mode.startsWith('copy-')?[mode==='inside-uri'?pathToFileURL(good).href:good]:mode==='outside'?[foreign]:mode==='symlink'?[link]:[good,foreign];
 const fake=path.join(dir,'fake.mjs');write(fake,`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);const result=m.method==='tools/list'?{tools:[{name:'export',inputSchema:{properties:{fileId:{type:'string'}}}}]}:{structuredContent:{files:${JSON.stringify(files)}},content:[{type:'text',text:${JSON.stringify(mode==='inside-text'?'Exported: `'+good+'`':mode==='inside-lines'?good+'\n'+good:JSON.stringify({files}))}}]};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`);
 const config=path.join(dir,'guard.json');write(config,JSON.stringify({fileIds:['test'],command:process.execPath,args:[fake],log:path.join(dir,'guard.log'),exportDir,exportRunDir}));
 const preload=path.join(dir,'faults.mjs');
 write(preload,`import fs from 'node:fs';const unlink=fs.unlinkSync,copy=fs.copyFileSync;const source=fs.realpathSync(${JSON.stringify(good)}),mode=${JSON.stringify(mode)};
 fs.unlinkSync=function(file){if(file===source&&mode.startsWith('delete-'))throw Object.assign(new Error('simulated '+mode),{code:mode.slice(7)});return unlink.apply(this,arguments);};
 fs.copyFileSync=function(file,destination){if(file===source&&mode==='copy-EACCES')throw Object.assign(new Error('simulated copy EACCES'),{code:'EACCES'});const result=copy.apply(this,arguments);if(file===source&&mode==='copy-size')fs.appendFileSync(destination,'extra');if(file===source&&mode==='copy-digest')fs.writeFileSync(destination,'BAD');return result;};`);
 const child=spawn(process.execPath,['--import',preload,path.join(source,'paper-guard.mjs'),config],{stdio:['pipe','pipe','pipe']});t.after(()=>child.kill('SIGTERM'));
 const closed=new Promise(resolve=>child.on('close',resolve));const lines=readline.createInterface({input:child.stdout})[Symbol.asyncIterator]();
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');await lines.next();
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'export',arguments:{fileId:'test'}}})+'\n');
 const line=await lines.next();assert(!line.done,'guard must return an export result or explicit error');const result=JSON.parse(line.value).result;
 if(mode.startsWith('inside')||['delete-EPERM','delete-EACCES'].includes(mode)){
  assert(!result.isError,JSON.stringify(result));const moved=result.structuredContent.files[0],file=mode==='inside-uri'?fileURLToPath(moved):moved;assert(file.startsWith(exportRunDir+path.sep));assert.equal(fs.readFileSync(file,'utf8'),'PNG');assert.equal(fs.existsSync(good),mode.startsWith('delete-'));if(mode==='inside-text')assert.equal(result.content[0].text,'Exported: `'+moved+'`');else if(mode==='inside-lines')assert.equal(result.content[0].text,moved+'\n'+moved);else assert.equal(JSON.parse(result.content[0].text).files[0],moved);
 }else if(mode.startsWith('delete-')||mode.startsWith('copy-')){assert(result.isError,'other copy/delete failures must be errors');assert(fs.existsSync(good),'failed verification must preserve the original');}
 else{assert(result.isError,'unexpected export path must be refused');assert(fs.existsSync(good),'validate the whole result before any move');assert.deepEqual(fs.readdirSync(exportRunDir),[]);}
 assert.equal(fs.readFileSync(foreign,'utf8'),'FOREIGN');assert.equal(fs.readFileSync(sentinel,'utf8'),'KEEP');
 child.stdin.end();await closed;
 const leftovers=fs.readFileSync(path.join(dir,'guard.log'),'utf8').trim().split('\n').map(JSON.parse).filter(event=>event.kind==='export-leftover');
 assert.deepEqual(leftovers,['delete-EPERM','delete-EACCES'].includes(mode)?[{kind:'export-leftover',path:fs.realpathSync(good),reason:mode.slice(7)}]:[]);
});

for(const outcome of ['passed','throw'])test(`continue6 suite reports guard export leftovers after Design ${outcome}`,async t=>{
 const f=fixture(t);write(path.join(f.dir,'skills/design/SKILL.md'),'changed');f.commit();
 const leftover=path.join(f.dir,'Downloads/retained.png');let calls=0;
 const request=suiteRequest(f,f.select(),{paper:{fileIds:['fixture'],command:'paper',args:[]},designMemoryFile:path.join(f.dir,'design/memory.md')});
 const result=await runSuite(request,async run=>{
  if(run.context.entryStage==='design'){
   calls++;const guard=json(run.mcpServers.paper.args[1]);
   write(guard.log,[{kind:'forwarded',tool:'export'},{kind:'export-leftover',path:leftover,reason:'EPERM'},{kind:'export-leftover',path:leftover,reason:'EACCES'}].map(JSON.stringify).join('\n')+'\n');
   if(outcome==='throw')throw Error('host stopped after export');
  }
  write(run.context.projectFile,JSON.stringify(runProject(run)));return passedStage(run);
 });
 assert(calls>0);assert.equal(result.status,outcome==='passed'?'passed':'failed');
 assert.deepEqual(result.exportLeftovers,[leftover]);assert.deepEqual(json(path.join(request.outputDir,'suite-result.json')).exportLeftovers,[leftover]);
});

test('qa.skills config connects another product and binds task expectations before its pass',async t=>{
 const {selectQaScenarios}=await import('./skills-select.mjs');
 const {validateQaConfig}=await import('./qa-recipe.mjs');
 const f=fixture(t),indexFile=path.join(f.catalogDir,'index.json');
 const index=json(indexFile);index.productName='Example Skills';index.skillPrefix='example';write(indexFile,JSON.stringify(index));
 write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
 const config={qa:{mode:'terminal',install:[],start:'node --version',ready:{command:'pwd',identity:'copy'},data:{source:'synthetic',description:'test'},forbiddenActions:['production'],skills:{indexFile:'custom-catalog/index.json',hosts:['codex'],perChange:true}}};
 validateQaConfig(config.qa);
 for(const skills of [{...config.qa.skills,perChange:'false'},{...config.qa.skills,hosts:[]},{...config.qa.skills,hosts:['codex','codex']},{...config.qa.skills,indexFile:''},{...config.qa.skills,unknown:true}])assert.throws(()=>validateQaConfig({...config.qa,skills}),/skills/);
 const args={config,worktree:f.dir,base:f.base,head:f.git('rev-parse','HEAD'),expected:{kind:'behavior',expectedItems:[{id:'C1',source:'task',expectation:'Column visible'}],taskCriteria:['C1']}};
 const taskExpectedFile=path.join(f.dir,'task-expected.json'),output=path.join(f.dir,'selected.json');
 const selection=selectQaScenarios({...args,taskExpectedFile,output});
 assert(selection.expectedItems.length);assert(selection.expectedItems.every(i=>i.source==='scenario'&&i.expectation.includes('codex')));
 const expected=json(taskExpectedFile);assert.deepEqual(expected.expectedItems,[args.expected.expectedItems[0],...selection.expectedItems]);assert.equal(expected.head,selection.head);assert.equal(expected.base,selection.base);
 assert.throws(()=>selectQaScenarios({...args,taskExpectedFile,output}),/EEXIST/);
 config.qa.skills.perChange=false;
 assert.equal(selectQaScenarios(args).expectedItems.length,0);
 assert(selectQaScenarios({...args,purpose:'release'}).expectedItems.length);
 assert(selectQaScenarios({...args,purpose:'acceptance'}).expectedItems.length);
 delete config.qa.skills;assert.equal(selectQaScenarios(args).expectedItems.length,0);
});

test('another product config flows from selected scenarios through suite and unchanged certificate gate',async t=>{
 const {selectQaScenarios}=await import('./skills-select.mjs');
 const {qaDeliveryState}=await import('./qa-gate.mjs');
 const f=fixture(t),qaRoot=path.join(f.dir,'host-qa'),indexFile=path.join(f.catalogDir,'index.json');
 const index=json(indexFile);index.productName='Example Skills';index.skillPrefix='example';write(indexFile,JSON.stringify(index));const base=f.commit();
 write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');const head=f.commit();
 const config={projectName:'Example Skills',qa:{mode:'terminal',install:[],start:'node --version',ready:{command:'pwd',identity:'copy'},data:{source:'synthetic',description:'scratch'},forbiddenActions:['production'],skills:{indexFile:'custom-catalog/index.json',hosts:['codex'],perChange:true}}};
 const args={config,worktree:f.dir,base,head,expected:{kind:'behavior',expectedItems:[],taskCriteria:[]}};
 const selection=selectQaScenarios({...args,taskExpectedFile:path.join(f.dir,'task-expected.json')});
 const request=suiteRequest(f,selection);let checked=0;
 const result=await runSuiteWithRecords(request,async r=>{
  const project=runProject(r);write(r.context.projectFile,JSON.stringify(project));return passedStage(r);
 },async()=>{checked++;return {status:'passed',monotestTasks:2,taskIds:['task-1','task-2']};});
 assert.equal(result.status,'passed');assert.equal(checked,selection.expectedItems.length);assert.equal(result.monotestTasks,2);assert(result.durationMs>=0);
 assert(result.results.every(r=>r.host==='codex'&&r.durationMs>=0&&r.monotestTasks===2));
 const issue='EXAMPLE-1',dir=path.join(qaRoot,'qa',issue,head),proof=path.join(dir,'suite-result.json');
 write(proof,JSON.stringify(result));
 const shipCertificate=`mono-ship green certificate\nShip: green\nIssue(s): ${issue}\nHead SHA: ${head}\nPR: #1`;
 const expected={...json(path.join(f.dir,'task-expected.json')),scope:'task',issue,mode:'ship',recipeSource:'config',evidenceRoot:dir,shipCertificate};
 const cert={scope:'task',issue,head,base:selection.base,kind:'behavior',mode:'ship',recipeSource:'config',gateEligible:true,verdict:'passed',items:expected.expectedItems.map(item=>({...item,outcome:'passed',evidence:[proof]}))};
 const flush=()=>{write(path.join(dir,'task-expected.json'),JSON.stringify(expected));write(path.join(dir,'task-report.json'),JSON.stringify({certificate:'mono-qa certificate\n'+JSON.stringify(cert)}));};
 write(path.join(qaRoot,'qa/state.json'),JSON.stringify({tasks:{[issue]:{head,project:null}},projects:{}}));flush();
 const input={root:qaRoot,config,issue,head,shipCertificate};assert.equal(qaDeliveryState(input).state,'passed');
 // Real trace checker: no native response and no live fallback keeps the scenario unverified.
 const native=path.join(f.dir,'incomplete.jsonl');write(native,JSON.stringify({type:'response_item',payload:{type:'function_call',name:'request_user_input_async',call_id:'w',arguments:JSON.stringify({questions:[{title:'Совет',options:['Утвердить (Recommended)','Ещё обсудить']}]})}})+'\n');
 const scenario=loadCatalog(indexFile).scenarios.get('idea/approve');
 const check=checkTrace({host:'codex',trace:native,expectedWindows:scenario.hosts.codex.expectedWindows});assert.equal(check.status,'unverified');
 cert.items[0].outcome=check.status;cert.items[0].reason='No background answer or live screenshot';cert.verdict=check.status;flush();
 assert.equal(qaDeliveryState(input).state,'failed');
 cert.kind=expected.kind='no-behavior';delete cert.items;cert.reason='Skill prose';flush();assert.match(qaDeliveryState(input).reason,/scenario.*no-behavior/);
 config.qa.skills.perChange=false;
 assert.deepEqual(selectQaScenarios(args).expectedItems,[]);
});

test('suite stops every remaining host/unit on working Linear write, reports the unfinished scenarios',async t=>{
 const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();const selection=f.select();let calls=0;
 const result=await runSuiteWithRecords(suiteRequest(f,selection),async r=>{calls++;write(r.context.projectFile,JSON.stringify(runProject(r)));return passedStage(r);},async()=>({status:'failed',stop:true,manualRemoval:['https://linear.app/example/issue/EX-1'],monotestTasks:0}));
 assert.equal(calls,1);assert.equal(result.status,'failed');assert(result.items.slice(1).every(item=>item.status==='unverified'));assert(result.results[0].result.records.manualRemoval.length);
});
for(const condition of ['binding-only','binding-everywhere','failed','other-unverified','dump-capacity','failed-stage','unverified-stage'])test(`design chain continues every unverified and stops real failure: ${condition}`,async t=>{
 const f=fixture(t);write(path.join(f.dir,'skills/design/SKILL.md'),'changed\n');f.commit();
 const selection=f.select(),unit=selection.units.find(u=>u.id==='design-approve');assert(unit.scenarios.includes('design/approve'));assert(unit.scenarios.includes('handoff/approve'));
 selection.units=[unit];selection.hosts=['codex'];selection.expectedItems=selection.expectedItems.filter(i=>i.unit===unit.id&&i.host==='codex');
 const request=suiteRequest(f,selection,{paper:{fileIds:['fixture'],command:'paper',args:['mcp']},designMemoryFile:path.join(f.dir,'memory.md')}),calls=[];
 const result=await runSuiteWithRecords(request,async r=>{
  calls.push(r.context.entryStage);write(r.context.projectFile,JSON.stringify(runProject(r)));
  return condition==='failed-stage'?{...passedStage(r),status:'failed',reason:'real stage failed'}:condition==='unverified-stage'?{...passedStage(r),status:'unverified',reason:'host proof unavailable'}:passedStage(r);
 },async({scenario})=>(scenario.stage==='discovery'||condition==='binding-everywhere'&&scenario.stage==='design')?condition==='failed'?{status:'failed',reason:'mismatch'}:condition==='other-unverified'?{status:'unverified',reason:'missing page'}:condition==='dump-capacity'?{status:'unverified',hostFailure:true,reason:'Selected model is at capacity',attempts:[{status:'unverified'},{status:'unverified'}]}:{status:'unverified',bindingOnly:true,reason:'shown-version binding missing',gateResults:[{result:{ok:true}}]}:{status:'passed',monotestTasks:0});
 assert.deepEqual(calls,['failed','failed-stage'].includes(condition)?['discovery']:['discovery','design','handoff']);
 assert.equal(result.status,['failed','failed-stage'].includes(condition)?'failed':'unverified');
 assert.equal(result.items[0].status,condition==='failed-stage'?'failed':result.results[0].status);
});
for(const mode of ['unverified','passed','invalid-id','invalid-name','invalid-url'])test(`seed identity survives an unverified stage without its manifest: ${mode}`,async t=>{
 const f=fixture(t);write(path.join(f.dir,'skills/design/SKILL.md'),'changed\n');f.commit();
 const selection=f.select(),unit=selection.units.find(u=>u.id==='design-approve');selection.units=[unit];selection.hosts=['codex'];selection.expectedItems=selection.expectedItems.filter(i=>i.unit===unit.id&&i.host==='codex');
 const calls=[],reads=[];let seedProject;
 const result=await runSuiteWithRecords(suiteRequest(f,selection,{paper:{fileIds:['fixture'],command:'never-spawn',args:[]},designMemoryFile:path.join(f.dir,'memory.md')}),async r=>{
  calls.push(r);
  if(calls.length===1){
   seedProject=runProject(r);
   if(mode.startsWith('invalid-'))seedProject[mode.slice(8)]={id:'short-id',name:'another-project',url:'https://linear.app/working/project/other'}[mode.slice(8)];
   return {status:mode==='passed'?'passed':'unverified',reason:'stage has no own manifest',seedRoute:{project:seedProject}};
  }
  write(r.context.projectFile,JSON.stringify(runProject(r)));return passedStage(r);
 },async({project})=>{reads.push(project);return {status:'passed',monotestTasks:0};});
 if(mode==='unverified'){
  assert.deepEqual(calls.map(r=>r.context.entryStage),['discovery','design','handoff']);
  assert(calls[0].seed);assert(calls.slice(1).every(r=>!r.seed),'never seed a second project');
  for(const r of calls.slice(1)){assert.deepEqual(r.context.project,seedProject);assert(r.scenario.prompt.includes(JSON.stringify(seedProject)));}
  assert.deepEqual(reads,[seedProject,seedProject,seedProject],'every fresh record read targets project A');
  assert.equal(result.status,'unverified');assert.equal(result.items[0].status,'unverified');
 }else{
  assert.equal(calls.length,1);assert.equal(result.status,'failed');assert(result.items.slice(1).every(i=>i.status==='unverified'));
  if(mode==='passed')assert.match(result.results[0].result.reason,/ENOENT/);
  else{assert.match(result.results[0].result.reason,/invalid run project read-back manifest/);assert(reads.every(p=>p===undefined),'invalid seed is never a record-read target');}
 }
});

test('failed seeded stage still verifies its existing seed project rather than Idea absence',async t=>{
 const f=fixture(t);write(path.join(f.dir,'skills/research/SKILL.md'),'changed\n');f.commit();
 const selection=f.select(),unit=selection.units.find(u=>u.id==='research-discuss');selection.units=[unit];selection.hosts=['codex'];selection.expectedItems=selection.expectedItems.filter(i=>i.unit===unit.id&&i.host==='codex');let observed;
 await runSuiteWithRecords(suiteRequest(f,selection),async r=>({status:'failed',reason:'later window',seedRoute:{project:runProject(r)},seedEndLine:82}),async({project})=>{observed=project;return {status:'unverified',reason:'incomplete fresh dump'};});
 assert.equal(observed.id,'00000000-0000-4000-8000-000000000001');
});

for(const mode of ['binding-only','bad-write','missing-page'])test(`live3 actual Discovery records control the suite's next Design invocation: ${mode}`,async t=>{
 const {verifyRecords}=await import('./test-fixtures/legacy-window-records.mjs');
 const f=fixture(t);write(path.join(f.dir,'skills/design/SKILL.md'),'changed\n');f.commit();
 const selection=f.select(),unit=selection.units.find(u=>u.id==='design-approve');selection.units=[unit];selection.hosts=['codex'];selection.expectedItems=selection.expectedItems.filter(i=>i.unit===unit.id&&i.host==='codex');
 const live=path.join(f.dir,'receipts');fs.cpSync(path.join(root,'scripts/test-fixtures/skills-records-live3'),live,{recursive:true});
 const base=path.join(live,'discovery-approve'),recordRequest=json(path.join(base,'request.json'));
 for(const key of ['trace','dumpTrace','dumpDir','configFile','sent'])recordRequest[key]=path.resolve(base,recordRequest[key]);recordRequest.packRoot=root;
 if(mode==='bad-write'){
  const trace=json(recordRequest.trace),item=trace.events.filter(r=>r.line>recordRequest.seedEndLine).map(r=>r.event.payload?.item).find(i=>i?.tool==='save_document');assert(item);item.arguments.content+='\nsubstantive tampering';write(recordRequest.trace,JSON.stringify(trace));
 }
 if(mode==='missing-page')fs.unlinkSync(path.join(recordRequest.dumpDir,'comments-1.json'));
 const calls=[];let checked;
 const result=await runSuiteWithRecords(suiteRequest(f,selection,{runId:'m290c-a',paper:{fileIds:['offline-boundary'],command:'never-spawn',args:[]},designMemoryFile:path.join(f.dir,'memory.md')}),async r=>{
  calls.push(r.context.entryStage);
  if(r.context.entryStage==='design')return {status:'unverified',reason:'Offline boundary: real Design evidence does not exist yet'};
  assert.equal(r.context.projectName,recordRequest.project.name);write(r.context.projectFile,JSON.stringify(recordRequest.project));
  const check=checkTrace({host:'codex',trace:recordRequest.trace,endLine:recordRequest.endLine,expectedWindows:[{id:'discovery-approval',role:'approval',decision:'Утвержд',advice:'Совет',reason:'Design',summary:[]}]});assert.equal(check.status,'passed',JSON.stringify(check));
  return {status:'passed',seedRoute:{project:recordRequest.project},seedEndLine:recordRequest.seedEndLine,trace:recordRequest.trace,sent:recordRequest.sent};
 },async({scenario})=>{
  if(scenario.stage==='design')return {status:'unverified',reason:'No Design records supplied'};
  checked=verifyRecords(recordRequest);return checked;
 });
 assert.deepEqual(calls,mode==='bad-write'?['discovery']:['discovery','design','handoff']);
 if(mode==='binding-only'){assert.equal(checked.bindingOnly,true);assert.equal(checked.gateResults[0].result.next,'design');assert.equal(result.results[0].status,'unverified');}
 else{assert.notEqual(checked.bindingOnly,true);assert.equal(checked.status,mode==='bad-write'?'failed':'unverified');}
});

for(const repeated of [false,true])test(`text catalog and suite preserve predetermined replies; repeated endings=${repeated}`,async t=>{
 const f=fixture(t),index=json(path.join(f.catalogDir,'index.json'));
 for(const stage of index.stages){
  const file=path.join(f.catalogDir,stage.scenarios.find(p=>p.includes('/'+stage.main+'/'))),scenario=json(file);
  for(const host of ['claude','codex'])scenario.hosts[host]={expectedReplies:[{id:stage.id,stage:stage.id,role:stage.id==='research'||stage.id==='handoff'?'transition':'approval',asksStart:false,summary:['Версия'],question:repeated?'Продолжим?':stage.id+'?',reply:stage.id==='research'||stage.id==='handoff'?'нет':'принимаю',intent:stage.id==='research'||stage.id==='handoff'?'refuse':'agree',outcome:{approval:stage.id!=='research'&&stage.id!=='handoff',startNext:false},response:['Записал.']}]};
  fs.writeFileSync(file,JSON.stringify(scenario));
 }
 write(path.join(f.dir,'skills/idea/SKILL.md'),'text behavior\n');f.commit();
 const selection=f.select(),unit=selection.units.find(u=>u.target.startsWith('idea/'));selection.units=[unit];selection.expectedItems=selection.expectedItems.filter(i=>i.unit===unit.id);
 const result=await runSuite(suiteRequest(f,selection),async request=>{
  assert(request.scenario.expectedReplies);assert.equal(request.scenario.expectedWindows,undefined);
  assert(request.scenario.prompt.includes('обычным текстом'));assert(!request.scenario.prompt.includes('Не подменяй окно текстом'));
  write(request.context.projectFile,JSON.stringify(runProject(request)));
  const expected=request.scenario.expectedReplies[0];
  return {...passedStage(request),check:{exchanges:[{text:'Версия\n'+expected.question,expected}]}};
 });
 assert.equal(result.status,repeated?'failed':'passed',JSON.stringify(result));
 if(repeated)assert(result.results.some(r=>r.result.reason==='identical endings across stages'));
});

for(const mode of ['authorized','missing-signal','no-permission','rubric-failed','rubric-unverified'])test(`U7 suite driver owns the next invocation: ${mode}`,async t=>{
 const f=fixture(t);
 // Unlike the preserved T1 regressions, these inputs are the shipped U7 policies.
 for(const key of ['research/approve','discovery/approve']){
  const scenario=json(path.join(source,key,'scenario.json'));
  if(mode==='no-permission'&&key==='research/approve')for(const host of ['claude','codex'])scenario.hosts[host].expectedReplies[0].driverStart=null;
  write(path.join(f.catalogDir,key,'scenario.json'),JSON.stringify(scenario));
 }
 f.commit();const selection=f.select(),unit={id:'driver-proof',target:'research/approve',scenarios:['research/approve','discovery/approve']};
 selection.units=[unit];selection.hosts=['codex'];selection.expectedItems=unit.scenarios.map(scenario=>({id:`${unit.id}:${scenario}:codex`,source:'scenario',expectation:`${scenario} / codex / ${unit.id}: conversation, word replies and fresh monotest records`,unit:unit.id,scenario,host:'codex'}));
 const calls=[];
 const result=await runSuiteWithRecords(suiteRequest(f,selection),async request=>{
  calls.push(request.context.entryStage);write(request.context.projectFile,JSON.stringify(runProject(request)));return passedStage(request);
 },async()=>({status:mode==='rubric-failed'?'failed':mode==='rubric-unverified'?'unverified':'passed',starts:mode==='missing-signal'?[]:[{stage:'discovery',replyId:'research-approve',kind:'intercepted',line:12}],monotestTasks:0}));
 assert.deepEqual(calls,mode==='authorized'?['research','discovery']:mode==='no-permission'?[]:['research']);
 assert.equal(result.status,mode==='authorized'?'passed':mode==='rubric-unverified'?'unverified':'failed');
});

test('continue1 Handoff correction revises package verification while preserving requirements',()=>{
 const scenario=loadCatalog(path.join(source,'index.json')).scenarios.get('handoff/correction');
 assert.match(scenario.brief,/после имени прогона/);
 for(const host of ['claude','codex']){
  const [revise,start]=scenario.hosts[host].expectedReplies;
  assert.match(revise.reply,/проверке задачи/);assert.match(revise.reply,/без поля source/);
  assert.doesNotMatch(revise.reply,/перед именем/);
  assert.equal(revise.intent,'continuation');assert.deepEqual(revise.outcome,{approval:false,startNext:false});
  assert.equal(start.role,'transition');assert.equal(start.outcome.startNext,true);
 }
});

for(const reviewStatus of ['passed','unverified','failed'])test(`continue3 suite resumes saved research only for ${reviewStatus} rubric`,async t=>{
 const f=fixture(t);
 for(const key of ['research/approve','discovery/approve'])write(path.join(f.catalogDir,key,'scenario.json'),fs.readFileSync(path.join(source,key,'scenario.json')));
 f.commit();const selection=f.select(),unit={id:'resume-proof',target:'research/approve',scenarios:['research/approve','discovery/approve']};
 selection.units=[unit];selection.hosts=['codex'];selection.expectedItems=unit.scenarios.map(scenario=>({id:`${unit.id}:${scenario}:codex`,source:'scenario',expectation:`${scenario} / codex / ${unit.id}: conversation, word replies and fresh monotest records`,unit:unit.id,scenario,host:'codex'}));
 const request=suiteRequest(f,selection),calls=[],verifications=[];
 const execute=async r=>{calls.push(r.context.entryStage);write(r.context.projectFile,JSON.stringify(runProject(r)));return passedStage(r);};
 const verify=async input=>{
  verifications.push({stage:input.runRequest.context.entryStage,resume:Boolean(input.resumeEvidence)});
  const file=input.outputDir+'-evidence.json';if(!input.resumeEvidence)write(file,'saved native trace, writes and fresh dump');
  return {status:input.resumeEvidence?reviewStatus:'unverified',reviewEvidence:file,rubricDigest:'a'.repeat(64),starts:[{stage:'discovery',replyId:'research-approve'}],monotestTasks:0};
 };
 const initial=await runSuiteWithRecords(request,execute,verify);assert.equal(initial.status,'unverified');assert.deepEqual(calls,['research']);
 const resumed=await runSuiteWithRecords({...request,resume:true},execute,verify);
 assert.deepEqual(calls,reviewStatus==='passed'?['research','discovery']:['research'],'research execution is never repeated');
 assert.deepEqual(verifications.slice(0,2),[{stage:'research',resume:false},{stage:'research',resume:true}]);
 assert.equal(resumed.results[0].status,reviewStatus);
 if(reviewStatus==='passed') {
  assert.equal(resumed.results[1].scenario,'discovery/approve');
  const completed=await runSuiteWithRecords({...request,resume:true},execute,verify);
  assert.equal(completed.status,'passed');assert.deepEqual(calls,['research','discovery'],'each completed stage is reused on subsequent resume');
  assert.ok(fs.existsSync(path.join(request.outputDir,'suite-result.json')));assert.ok(fs.existsSync(path.join(request.outputDir,'suite-result-2.json')));
 }
});

test('continue3 Design correction changes picture only within the approved requirement',()=>{
 const scenario=loadCatalog(path.join(source,'index.json')).scenarios.get('design/correction');
 for(const host of ['claude','codex']){
  const [revise,approval]=scenario.hosts[host].expectedReplies;
  assert.match(revise.reply,/после имени прогона/);
  assert.match(revise.reply,/макет|картинк/);assert.doesNotMatch(revise.reply,/перед именем/);
  assert.deepEqual(revise.outcome,{approval:false,startNext:false});assert.deepEqual(approval.outcome,{approval:true,startNext:false});
 }
});

for(const changed of ['saved-state','saved-evidence','saved-request','selection'])test(`continue3 suite refuses changed ${changed} before any host`,async t=>{
 const f=fixture(t);write(path.join(f.catalogDir,'research/approve/scenario.json'),fs.readFileSync(path.join(source,'research/approve/scenario.json')));f.commit();
 const selection=f.select(),unit={id:'changed-proof',target:'research/approve',scenarios:['research/approve']};
 selection.units=[unit];selection.hosts=['codex'];selection.expectedItems=[{id:`${unit.id}:research/approve:codex`,source:'scenario',expectation:`research/approve / codex / ${unit.id}: conversation, word replies and fresh monotest records`,unit:unit.id,scenario:'research/approve',host:'codex'}];
 const request=suiteRequest(f,selection);let calls=0,reads=0;
 const execute=async r=>{calls++;write(r.context.projectFile,JSON.stringify(runProject(r)));return passedStage(r);};
 const verify=async input=>{reads++;const file=input.outputDir+'-evidence.json';write(file,'saved trace, writes and dump');return {status:'unverified',reviewEvidence:file};};
 await runSuiteWithRecords(request,execute,verify);
 const item=json(path.join(request.outputDir,'suite-state.json')).results[0];
 if(changed==='saved-state'){
  const file=path.join(request.outputDir,'suite-state.json'),state=json(file);state.results[0].run.status='passed';state.requestDigest='wrong';write(file,JSON.stringify(state));
 }else if(changed==='selection'){
  const saved=json(request.selectionFile);saved.reason='modified selection';write(request.selectionFile,JSON.stringify(saved));
 }else fs.appendFileSync(changed==='saved-evidence'?item.reviewEvidence:path.join(request.outputDir,'changed-proof-codex-0-request.json'),' ');
 await assert.rejects(()=>runSuiteWithRecords({...request,resume:true},execute,verify),/saved suite evidence|request changed/);
 assert.equal(calls,1);assert.equal(reads,1,'changed evidence refused before verification or a new execution');
});
