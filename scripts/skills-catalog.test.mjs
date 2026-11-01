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
import { checkTrace } from './skills-trace.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'evals/scenarios');
const neighbors={idea:['research'],research:['idea','discovery'],discovery:['research','design','tech-evaluation','handoff'],
  design:['discovery','tech-evaluation','handoff'],'tech-evaluation':['discovery','design','handoff'],handoff:['discovery','design','tech-evaluation']};
const write=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const runProject=request=>request.context.project??{id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'};
const passedStage=request=>({status:'passed',...(request.seed?{seedRoute:{project:runProject(request)}}:{})});
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
    assert(scenario.brief.includes('cli/runs.mjs') && scenario.brief.includes('source'),'brief describes the existing neutral test product');
    if(scenario.stage==='idea')assert.equal(scenario.seed,null);
    for(const host of ['claude','codex']){
      assert.equal(scenario.hosts[host].windows.length,scenario.hosts[host].expectedWindows.length);
      assert(scenario.hosts[host].expectedWindows.every(w=>['approval','transition'].includes(w.role)),'only target roles are expected');
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

test('seed route is isolated from the following stage before any real stage runs',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/tech-evaluation/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());let checked=0;
  await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'seed-route',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,
    mcpServers:{monotest:{url:'https://example.test/mcp'}},paper:{fileId:'fixture',command:'paper',args:['mcp']},designMemoryFile:path.join(f.dir,'memory.md')},async request=>{
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

test('catalog window anchors accept live wording in both hosts without requiring topic prose',t=>{
  const catalog=loadCatalog(path.join(source,'index.json'));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-window-wording-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const titles={
    idea:[
      'Утверждаем самостоятельную идею с колонкой источника? Советую перейти в Research: нужно проверить потребность.',
      'Утверждаем колонку источника? Советую утвердить и начать Research: описание полное, а открыт только вопрос спроса.',
      'Утверждаем учёт расходников по мастерам без остатков и закупок? Советую утвердить и начать Research: нужно выяснить потребность.'
    ],
    research:['Начинаем Discovery для колонки источника? Советую перейти: нужно выбрать проверку результата.', 'Продолжаем разбор колонки? Советую перейти: рамка уже ясна.'],
    discovery:['Утверждаем колонку без настройки? Советую начать Design: нужно показать её в списке.'],
    design:['Утверждаем макет колонки? Советую утвердить и передать в Handoff: рамка уже согласована.'],
    'tech-evaluation':['Утверждаем страницу решения? Советую начать Handoff: способ проверен.'],
    handoff:['Начинаем пакет? Советую передать оркестратору: зависимости проверены.', 'Добавляем «Источник» после имени прогона, с прочерком для пустых значений? Советую начать работу: одна задача готова и проверена.']
  };
  for(const scenario of catalog.scenarios.values())for(const host of ['claude','codex'])for(const expected of scenario.hosts[host].expectedWindows){
    if(expected.id.endsWith('-followup'))continue; // native optionless question, not an approval card
    for(const title of titles[scenario.stage]){
      const labels=[expected.role==='approval'?'Утвердить, продолжу позже (Recommended)':'Начать следующий этап (Recommended)','Ещё обсудить'];
      const consequences=['Запишем выбор / рамку уже не меняем','Уточним рамку / переход ждёт'];
      const summary=expected.summary.length?expected.summary.join('\n'):'Полный видимый итог текущего решения.';
      const rows=host==='claude'
        ? [{type:'assistant',message:{id:'wording',content:[{type:'text',text:summary},{type:'tool_use',id:'window',name:'AskUserQuestion',input:{questions:[{header:'Решение',question:title,options:labels.map((label,i)=>({label,description:consequences[i]}))}]}}]}}]
        : [{type:'response_item',payload:{type:'function_call',call_id:'window',name:'request_user_input_async',arguments:JSON.stringify({questions:[{title:title+'\n'+labels.map((label,i)=>`${label}: ${consequences[i]}`).join('\n'),options:labels}]})}},
          {type:'response_item',payload:{type:'function_call_output',call_id:'window',output:'{"accepted":true}'}},
          {type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:summary}]}}];
      const trace=path.join(dir,'trace.jsonl');fs.writeFileSync(trace,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
      const result=checkTrace({host,trace,expectedWindows:[expected],excerpt:true});
      assert.equal(result.status,'passed',`${scenario.stage}/${scenario.id}/${host}/${expected.id}: ${JSON.stringify(result)}`);
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
  const f=fixture(t);write(path.join(f.dir,'skills/discovery/SKILL.md'),'changed\n');
  write(path.join(f.dir,'skills/tech-evaluation/SKILL.md'),'changed\n');f.commit();
  const selection=f.select(), selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,selection);
  const outputDir=path.join(f.dir,'run'), cwd=path.join(f.dir,'workspace'), calls=[];fs.mkdirSync(cwd);
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'fixture',outputDir,cwd,packRoot:root,
    mcpServers:{monotest:{url:'https://example.test/mcp'}},paper:{fileId:'test-file',command:'paper',args:['mcp']},designMemoryFile:path.join(f.dir,'test-memory.md')},async request=>{
    assert.deepEqual(json(path.join(outputDir,'expected-items.json')),selection.expectedItems);
    assert.equal(request.idleMs,20000);assert.equal(request.timeoutMs,1800000);assert(request.maxTurns>request.scenario.windows.length);
    assert.equal(request.workspaceProof.equals,'Mono Test');assert(request.scenario.prompt.includes('не исполнитель-воркер'));
    const next=request.context.followingStage;
    const names={research:'Research',discovery:'Discovery',design:'Design','tech-evaluation':'Tech Evaluation',handoff:'Handoff'};
    for(const window of request.scenario.expectedWindows){
      if(window.role==='transition')for(const field of ['decision','advice','reason'])assert.equal(window[field],'Совет','transition role comes from labels, not title wording');
      else if(names[next])assert.equal(window.reason,names[next],'approval anchor follows the actual chain route');
    }
    const relative=path.relative(cwd,request.context.projectFile);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'model manifest must be writable under cwd, independent of outputDir');
    assert(!fs.existsSync(request.context.projectFile),'each stage must write its own manifest');
    if(request.context.project)assert.equal(request.context.project.name,request.context.projectName);
    write(request.context.projectFile,JSON.stringify(request.context.project ?? {id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'}));
    if(request.mcpServers.paper){
      const guard=json(request.mcpServers.paper.args[1]);assert.equal(guard.fileId,'test-file');
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
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'identity-'+field,outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
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
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'key-order',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
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
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'missing-manifest',outputDir,cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
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
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'failed',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async()=>({status:'failed'}));
  assert.equal(result.status,'failed');assert(result.items.some(i=>i.scenario==='research/approve'&&i.status==='unverified'));
});

test('standalone unseeded Idea may pass without creating a project, while its chain still needs a manifest',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/idea/SKILL.md'),'changed\n');f.commit();
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,f.select());
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'no-project',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
    assert(!request.seed,'Idea starts without seed');return {status:'passed',replies:[{policy:'empty',received:true}]};
  });
  for(const host of ['claude','codex']){
    assert.equal(result.items.find(i=>i.unit==='idea-empty'&&i.host===host).status,'passed','empty Idea correctly creates no project');
    assert.equal(result.items.find(i=>i.unit==='idea-approve'&&i.scenario==='idea/approve'&&i.host===host).status,'failed','chain must stop without a project pointer');
    assert.equal(result.items.find(i=>i.unit==='idea-approve'&&i.scenario==='research/approve'&&i.host===host).status,'unverified');
  }
});

test('an incomplete seed stays unverified and leaves its remaining chain unverified',async t=>{
  const f=fixture(t);write(path.join(f.dir,'skills/tech-evaluation/SKILL.md'),'changed\n');f.commit();
  const selection=f.select();selection.units=selection.units.filter(u=>u.id==='tech-evaluation-approve');selection.expectedItems=selection.expectedItems.filter(i=>i.unit==='tech-evaluation-approve');
  const selectionFile=path.join(f.dir,'selection.json');saveSelection(selectionFile,selection);
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'seed-incomplete',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>request.seed?{status:'unverified',reason:'seed not completed'}:{status:'passed'});
  assert.equal(result.status,'unverified');
  assert(result.results.some(r=>r.result.reason==='seed not completed'));
  assert(result.items.every(i=>i.status==='unverified'),'no incomplete chain item becomes green or a violation');
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
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'project',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
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
    const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:mode,outputDir,cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{
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
  const result=await runSuite({selectionFile,indexFile:path.join(f.catalogDir,'index.json'),runId:'seed-data',outputDir:path.join(f.dir,'run'),cwd:f.dir,packRoot:root,mcpServers:{monotest:{url:'https://example.test/mcp'}},paper:{fileId:'fixture',command:'paper',args:['mcp']},designMemoryFile:path.join(f.dir,'memory.md')},async request=>{
    calls.push(request);write(request.context.projectFile,JSON.stringify(request.context.project??{id:'00000000-0000-4000-8000-000000000001',name:request.context.projectName,url:'https://linear.app/monotest/project/fixture'}));return passedStage(request);
  });
  assert.equal(result.status,'passed');
  await t.test('manifest UUID',()=>{
    for(const call of calls){
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
  assert.deepEqual(listed.result.tools.map(t=>t.name),['get_basic_info','get_guide']);assert(listed.result.tools.every(t=>t.inputSchema.required.includes('fileId')));assert(listed.result.tools[1].inputSchema.properties.fileId);
  for(const args of [{},{fileId:'foreign-file'}])assert((await call('tools/call',{name:'get_basic_info',arguments:args})).result.isError);
  assert((await call('tools/call',{name:'archive_resources',arguments:{fileId:'test-file'}})).result.isError);
  assert((await call('resources/read',{uri:'foreign'})).result.isError);
  assert(!(await call('tools/call',{name:'get_basic_info',arguments:{fileId:'test-file'}})).result.isError);
  assert((await call('tools/call',{name:'get_guide',arguments:{topic:'paper-mcp-instructions'}})).result.isError);
  assert(!(await call('tools/call',{name:'get_guide',arguments:{fileId:'test-file',topic:'paper-mcp-instructions'}})).result.isError);
  child.stdin.end();await new Promise((resolve,reject)=>{child.on('close',code=>code===0?resolve():reject(new Error(`guard exit ${code}`)));child.on('error',reject);});
  const forwarded=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(forwarded.length,2);assert.equal(forwarded[0].params.arguments.fileId,'test-file');assert.deepEqual(forwarded[1].params.arguments,{topic:'paper-mcp-instructions'});
});
