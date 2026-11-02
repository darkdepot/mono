import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyRecords, dumpPrompt, collectRecordDump, verifyScenarioRecords } from './skills-records.mjs';

const projectId='00000000-0000-4000-8000-000000000001',date='2026-10-31T00:00:00Z';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-records-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const dumpDir=path.join(dir,'dump');fs.mkdirSync(dumpDir);
 const save=(name,value)=>{const file=path.join(dumpDir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
 const record={id:'r1',body:'mono-test: report sha256='+'a'.repeat(64),createdAt:date,updatedAt:date,url:'https://linear.app/monotest/project/test#comment-r1'};
 const project={uuid:projectId,name:'monotest-run',url:'https://linear.app/monotest/project/test',description:'Test project'};
 save('project.json',project);
 const page=(prefix,key,items)=>{save(prefix+'-1.request.json',{});save(prefix+'-1.json',{[key]:items,hasNextPage:false});};
 page('comments','comments',[record]);page('documents','documents',[]);page('issues','issues',[]);
 const events=[{type:'assistant',message:{content:[{type:'text',text:record.body}]}},
  {type:'user',message:{content:[{type:'text',text:'approved native response'}]}},
  {type:'assistant',message:{content:[{type:'tool_use',id:'write',name:'mcp__monotest__create_comment',input:{projectId,body:record.body}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'write',content:JSON.stringify(record)}]}}];
 const trace=path.join(dir,'trace.jsonl'),dumpTrace=path.join(dir,'dump-trace.jsonl');
 const request={host:'claude',trace,dumpDir,dumpTrace,project,expectedRecords:[{type:'mono-test',count:1}],approvalBindings:[]};
 const flush=()=>{
  const terminal=request.host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
  fs.writeFileSync(trace,[...events,terminal].map(e=>JSON.stringify(e)).join('\n')+'\n');
  if(request.dumpTrace!==dumpTrace)return;
  const reads=[];
  const walk=(directory)=>{for(const name of fs.readdirSync(directory)){const file=path.join(directory,name);if(fs.statSync(file).isDirectory()){walk(file);continue;}
   if(!name.endsWith('.json')||name.endsWith('.request.json'))continue;
   const relative=path.relative(dumpDir,file),value=JSON.parse(fs.readFileSync(file)),kind=/^comments-/.test(name)?'list_comments':/^documents-/.test(name)?'list_documents':/^issues-/.test(name)?'list_issues':/^projects-/.test(name)?'list_projects':relative==='project.json'?'get_project':name==='issue.json'?'get_issue':'get_document';
   const page=kind.startsWith('list_'),scope=relative.startsWith('issues/')?relative.split('/')[1]:projectId;
   const input=page?{...(kind==='list_projects'?{query:request.projectName}:{[scope===projectId?'projectId':'issueId']:scope}),...(['list_issues','list_projects'].includes(kind)?{includeArchived:true}:{}),...(fs.existsSync(file.replace(/\.json$/,'.request.json'))?JSON.parse(fs.readFileSync(file.replace(/\.json$/,'.request.json'))):{})}:{id:value.uuid??value.id};
   const id=String(reads.length);
   if(request.host==='claude')reads.push({type:'assistant',message:{content:[{type:'tool_use',id,name:`mcp__monotest__${kind}`,input}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(value)}]}});
   else reads.push({type:'response_item',payload:{type:'function_call',name:`mcp__monotest__${kind}`,call_id:id,arguments:JSON.stringify(input)}},{type:'response_item',payload:{type:'function_call_output',call_id:id,output:JSON.stringify(value)}});
  }};
  walk(dumpDir);fs.writeFileSync(dumpTrace,[...reads,terminal].map(e=>JSON.stringify(e)).join('\n')+'\n');
 };flush();
 const check=()=>{flush();return verifyRecords(request);};
 return {dir,dumpDir,project,record,events,save,page,check,request};
}

test('records compare successful native write bodies to a fresh complete monotest dump',t=>{
 const f=fixture(t);assert.equal(f.check().status,'passed');
 f.page('comments','comments',[{...f.record,body:'mono-test: report changed after write'}]);assert.equal(f.check().status,'failed');
});
test('duplicate records, read mismatches and forbidden approvals are failed',t=>{
 const f=fixture(t);f.page('comments','comments',[f.record,{...f.record,id:'r2'}]);assert.equal(f.check().status,'failed');
 f.page('comments','comments',[f.record]);f.request.expectedRecords=[{forbidden:'mono-test: report'}];assert.equal(f.check().status,'failed');
});
for(const mode of ['missing-request','missing-page','next-page','cursor-gap','duplicate-id','order'])test(`incomplete dump ${mode} stays unverified`,t=>{
 const f=fixture(t);
 if(mode==='missing-request')fs.unlinkSync(path.join(f.dumpDir,'comments-1.request.json'));
 if(mode==='missing-page')fs.renameSync(path.join(f.dumpDir,'comments-1.json'),path.join(f.dumpDir,'comments-2.json'));
 if(mode==='next-page')f.save('comments-1.json',{comments:[f.record],hasNextPage:true,cursor:'r1'});
 if(['cursor-gap','duplicate-id','order'].includes(mode)){
  f.save('comments-1.json',{comments:[f.record],hasNextPage:true,cursor:'r1'});f.save('comments-2.request.json',{cursor:mode==='cursor-gap'?'other':'r1'});
  f.save('comments-2.json',{comments:[{...f.record,id:mode==='duplicate-id'?'r1':'r2',updatedAt:mode==='order'?'2026-11-01T00:00:00Z':date}],hasNextPage:false});
 }
 assert.equal(f.check().status,'unverified');
});
test('working Linear writes are failed and stop the suite with a manual removal URL',t=>{
 const f=fixture(t);f.events[2].message.content[0].name='mcp__linear__create_comment';f.record.url='https://linear.app/example/project/live#comment-r1';f.events[3].message.content[0].content=JSON.stringify(f.record);
 const r=f.check();assert.equal(r.status,'failed');assert.equal(r.stop,true);assert.deepEqual(r.manualRemoval,[f.record.url]);
});
test('fixed dump includes documents, issues with status/labels and all issue comments',t=>{
 const f=fixture(t);f.page('documents','documents',[{id:'doc'}]);f.page('issues','issues',[{id:'issue'}]);
 assert.equal(f.check().status,'unverified');
 f.save('documents/doc.json',{id:'doc',projectId,title:'PRD',content:'text',url:'https://linear.app/monotest/document/doc'});
 f.save('issues/issue/issue.json',{id:'issue',projectId,title:'Task',description:'body',status:{name:'Todo'},labels:[],url:'https://linear.app/monotest/issue/MON-1/task'});
 f.page('issues/issue/comments','comments',[]);assert.equal(f.check().status,'passed');
 delete f.project.uuid;f.save('project.json',f.project);assert.equal(f.check().status,'unverified');
});
test('dump collector uses only monotest and a fixed checklist, never a model chosen list',async t=>{
 const f=fixture(t),outputDir=path.join(f.dir,'collector');let seen;
 const r=await collectRecordDump({host:'claude',project:f.project,cwd:f.dir,packRoot:process.cwd(),outputDir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{seen=request;return {status:'passed',trace:'collector-trace'};});
 assert.equal(r.status,'passed');assert.equal(seen.readOnlyDump,true);assert.deepEqual(Object.keys(seen.mcpServers),['monotest']);
 const prompt=dumpPrompt({project:f.project,dumpDir:f.dumpDir});for(const part of ['comments-N.request.json','documents','issues','status','labels','cursor'])assert(prompt.includes(part));
 await assert.rejects(()=>collectRecordDump({...seen,mcpServers:{monotest:{url:'x'},linear:{url:'y'}}}),/only monotest/);
});

for(const policy of ['approve','empty','refuse','discuss','changed-version','early-write','unbound-write'])test(`shown version and native reply: ${policy}`,t=>{
 const f=fixture(t),draft='Shown version one';
 const q={question:'Утвердить версию?',header:'Версия',options:[{label:'Утвердить (Recommended)',description:'Запись / готово'},{label:'Ещё обсудить',description:'Нет записи / ждём'}]};
 const answer=policy==='empty'?'':policy==='discuss'?'Ещё обсудить':'Утвердить (Recommended)';
 const control={type:'control_response',response:{request_id:'permission',response:policy==='refuse'?{behavior:'deny',message:'Нет'}:{behavior:'allow',updatedInput:{questions:[q],answers:{[q.question]:answer}}}}};
 const receipt=policy==='refuse'?'Нет':policy==='empty'?'The user did not answer the questions.':`Your questions have been answered: "${q.question}"="${answer}". You can now continue with these answers in mind.`;
 f.record.body=`mono-test: approved\n${policy==='unbound-write'?'Other text':draft}`;
 const write={type:'assistant',message:{content:[{type:'tool_use',id:'write',name:'mcp__monotest__create_comment',input:{projectId,body:f.record.body}}]}};
 f.events.splice(0,f.events.length,
  {type:'assistant',message:{content:[{type:'text',text:draft}]}},
  {type:'assistant',message:{content:[{type:'tool_use',id:'window',name:'AskUserQuestion',input:{questions:[q]}}]}},
  {type:'control_request',request_id:'permission',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[q]}}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'window',content:receipt,...(policy==='refuse'?{is_error:true}:{})}]}},
  {type:'assistant',message:{content:[{type:'tool_use',id:'read',name:'mcp__monotest__get_document',input:{id:'doc'}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'read',content:JSON.stringify({id:'doc',content:policy==='changed-version'?'New version':draft})}]}},
  write,{type:'user',message:{content:[{type:'tool_result',tool_use_id:'write',content:JSON.stringify(f.record)}]}});
 f.page('comments','comments',[f.record]);f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content:draft});
 const sent=path.join(f.dir,'sent.jsonl');fs.writeFileSync(sent,JSON.stringify(control)+'\n');f.request.sent=sent;
 f.request.approvalBindings=[{recordId:'r1',windowCallId:'window',shownLine:1,currentLine:5,text:draft}];
 if(policy==='early-write'){f.events.splice(2,0,f.events.splice(6,1)[0]);}
 const result=f.check();assert.equal(result.status,policy==='approve'?'passed':'failed',result.reason);
});

test('missing native write result remains unverified and output errors never become a receipt',t=>{
 const f=fixture(t);f.events.pop();assert.equal(f.check().status,'unverified');
 f.events.push({type:'user',message:{content:[{type:'tool_result',tool_use_id:'write',is_error:true,content:JSON.stringify(f.record)}]}});
 assert.equal(f.check().status,'unverified');
});

test('native Codex literal JSON exec route compares writes without parsing arbitrary JavaScript',t=>{
 const f=fixture(t);f.request.host='codex';
 const call={type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'write',input:`const r = await tools.mcp__monotest__create_comment(${JSON.stringify({projectId,body:f.record.body})}); text(r);`}};
 const result={type:'response_item',payload:{type:'custom_tool_call_output',call_id:'write',output:JSON.stringify(f.record)}};
 f.events.splice(0,f.events.length,call,result);assert.equal(f.check().status,'passed');
 call.payload.input='const data = {}; await tools.mcp__monotest__create_comment(data);';assert.equal(f.check().status,'unverified');
});
test('fresh dump files must match actual native reads and scoped page requests',t=>{
 const f=fixture(t),dumpTrace=path.join(f.dir,'dump.jsonl'),events=[];
 const entries=[['get_project',{id:projectId},'project.json'],['list_comments',{projectId},'comments-1.json'],['list_documents',{projectId},'documents-1.json'],['list_issues',{projectId,includeArchived:true},'issues-1.json']];
 for(const [tool,input,file]of entries){const id=String(events.length);events.push({type:'assistant',message:{content:[{type:'tool_use',id,name:`mcp__monotest__${tool}`,input}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:fs.readFileSync(path.join(f.dumpDir,file),'utf8')}]}});}
 const flush=()=>fs.writeFileSync(dumpTrace,[...events,{type:'result',subtype:'success'}].map(e=>JSON.stringify(e)).join('\n')+'\n');flush();f.request.dumpTrace=dumpTrace;
 assert.equal(f.check().status,'passed');
 events[2].message.content[0].input.projectId='another-project';flush();assert.equal(f.check().status,'unverified');
 events[2].message.content[0].input.projectId=projectId;flush();f.page('comments','comments',[]);assert.equal(f.check().status,'unverified');
});
test('empty Idea proves absence with a complete fresh run-name lookup, not a missing pointer',t=>{
 const f=fixture(t);f.request.project=null;f.request.projectName='monotest-run';f.request.expectedRecords=[{forbidden:'project:create'}];f.events.splice(0,f.events.length);
 f.page('projects','projects',[]);assert.equal(f.check().status,'passed');
 f.page('projects','projects',[{id:projectId,name:'monotest-run'}]);assert.equal(f.check().status,'failed');
});

for(const host of ['claude','codex'])for(const mode of ['read','write'])test(`${host} isolated dump driver ${mode}: no windows and no MCP writes`,async t=>{
 const f=fixture(t),authFile=path.join(f.dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const {runScenario}=await import('./skills-run.mjs');
 const result=await runScenario({host,cwd:f.dir,packRoot:process.cwd(),outputDir:path.join(f.dir,'read-only'),authFile,timeoutMs:3000,idleMs:10,
  binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-dump-host.mjs'),mode]},mcpServers:{monotest:{url:'https://example.test/mcp'}},
  workspaceProof:{tool:'mcp__monotest__get_workspace',input:{},path:['name'],equals:'Mono Test'},readOnlyDump:true,scenario:{prompt:'Read all fixed dump pages',windows:[],expectedWindows:[]}});
 assert.equal(result.status,mode==='read'?'passed':'failed',JSON.stringify(result));
 if(mode==='write')assert.match(result.reason,/reads only/);
});

test('actual idea-gate route result is required, never a claimed gate outcome',t=>{
 const f=fixture(t);f.request.packRoot=process.cwd();f.request.configFile=path.join(f.dir,'config.json');fs.writeFileSync(f.request.configFile,'{}');
 f.request.gates=[{command:'route'}];assert.equal(f.check().status,'passed');
 f.page('comments','comments',[f.record,{...f.record,id:'broken',body:'```text\nmono-prd: approved project=bad\n```'}]);
 const failed=f.check();assert.equal(failed.status,'failed');assert.match(failed.reason,/idea-gate route/);
});
for(const mode of ['no-source','no-terminal','no-archive'])test(`freshness requires native source, terminal and archived scope: ${mode}`,t=>{
 const f=fixture(t);assert.equal(f.check().status,'passed');
 if(mode==='no-source')delete f.request.dumpTrace;
 if(mode==='no-terminal'){
  const events=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').slice(0,-1);fs.writeFileSync(f.request.dumpTrace,events.join('\n')+'\n');
 }
 if(mode==='no-archive'){
  const events=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse);for(const e of events)for(const b of e.message?.content??[])if(b.type==='tool_use'&&b.name.endsWith('__list_issues'))b.input.includeArchived=false;
  fs.writeFileSync(f.request.dumpTrace,events.map(e=>JSON.stringify(e)).join('\n')+'\n');
 }
 assert.equal(verifyRecords(f.request).status,'unverified');
});
test('known production write survives a truncated unrelated tail and incomplete dump',t=>{
 const f=fixture(t);f.events[2].message.content[0].name='mcp__linear__create_comment';f.check();
 fs.appendFileSync(f.request.trace,'{incomplete');fs.unlinkSync(path.join(f.dumpDir,'issues-1.json'));
 const result=verifyRecords(f.request);assert.equal(result.status,'failed');assert.equal(result.stop,true);
});

test('Paper edits are checked by their guard and are not working Linear writes',t=>{
 const f=fixture(t);f.events.push({type:'assistant',message:{content:[{type:'tool_use',id:'paper',name:'mcp__paper__write_html',input:{fileId:'test'}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'paper',content:'{"id":"node"}'}]}});
 assert.equal(f.check().status,'passed');
});
test('a denied foreign call cannot manufacture a manual-removal URL from unrelated text',t=>{
 const f=fixture(t);f.events[2].message.content[0].name='mcp__linear__create_comment';f.events[3]={type:'user',message:{content:[{type:'tool_result',tool_use_id:'write',is_error:true,content:'denied'}]}};
 f.events.push({type:'assistant',message:{content:[{type:'text',text:'Reference https://linear.app/example/issue/KEEP-1'}]}});
 const result=f.check();assert.equal(result.status,'failed');assert.equal(result.stop,true);assert.deepEqual(result.manualRemoval,[]);
});

test('seed replay is reconciled but cannot impersonate scenario approval or satisfy its expected writes',t=>{
 const f=fixture(t),original=[...f.events],seed={id:'seed-comment',body:'mono-idea: approved\nmono-test: seeded',createdAt:date,updatedAt:date,url:'https://linear.app/monotest/project/test#comment-seed'};
 const call=(id,name,input)=>({type:'assistant',message:{content:[{type:'tool_use',id,name,input}]}}),result=(id,value)=>({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(value)}]}});
 f.events.splice(0,f.events.length,call('seed-project','mcp__monotest__save_project',{name:f.project.name,description:f.project.description}),result('seed-project',f.project),
  call('seed-comment','mcp__monotest__save_comment',{projectId,body:seed.body}),result('seed-comment',seed),{type:'result',subtype:'success'},...original);
 f.page('comments','comments',[f.record,seed]);f.request.seedExpected=true;f.request.seedEndLine=5;f.request.seedProjectId=projectId;
 assert.equal(f.check().status,'passed');
 // There is no active scenario write; a seed record is not a replacement for it.
 f.events.splice(5);f.page('comments','comments',[seed]);assert.equal(f.check().status,'failed');
});
test('seed bypass requires a native successful boundary and the same project; production writes still stop',t=>{
 const f=fixture(t);f.request.seedExpected=true;f.request.seedEndLine=2;f.request.seedProjectId=projectId;
 assert.equal(f.check().status,'unverified');
 f.events[2].message.content[0].name='mcp__linear__create_comment';const result=f.check();assert.equal(result.status,'failed');assert.equal(result.stop,true);
});
test('superseded document versions validate each write result and compare the latest fields with the final read',t=>{
 const f=fixture(t),doc={id:'doc',projectId,title:'Draft',content:'corrected version'};
 const call=(id,input)=>({type:'assistant',message:{content:[{type:'tool_use',id,name:'mcp__monotest__save_document',input}]}}),result=(id,value)=>({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(value)}]}});
 f.events.push(call('draft',{title:'Draft',content:'first version'}),result('draft',{...doc,content:'first version'}),call('correct',{id:'doc',content:'corrected version'}),result('correct',{id:'doc',content:'corrected version'}));
 f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',doc);
 assert.equal(f.check().status,'passed');
 // An incorrect first write is not laundered by a later successful correction.
 f.events[5].message.content[0].content=JSON.stringify({...doc,content:'wrong first write'});assert.equal(f.check().status,'failed');
});

test('issue labels compare as sets and state input is bound to canonical status',t=>{
 const f=fixture(t),issue={id:'issue',projectId,title:'Task',description:'Body',status:{id:'state-id',name:'Todo'},labels:[{id:'a',name:'A'},{id:'b',name:'B'}],url:'https://linear.app/monotest/issue/MON-1/task'};
 f.events.push({type:'assistant',message:{content:[{type:'tool_use',id:'issue-write',name:'mcp__monotest__save_issue',input:{title:'Task',description:'Body',state:'Todo',labels:['B','A']}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'issue-write',content:JSON.stringify(issue)}]}});
 f.page('issues','issues',[{id:'issue'}]);f.save('issues/issue/issue.json',issue);f.page('issues/issue/comments','comments',[]);
 assert.equal(f.check().status,'passed');
 issue.status={id:'wrong',name:'Doing'};f.events.at(-1).message.content[0].content=JSON.stringify(issue);f.save('issues/issue/issue.json',issue);
 assert.equal(f.check().status,'failed');
});

function liveFixture(t,name){
 const source=path.resolve('scripts/test-fixtures/skills-records-live',name),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-live-records-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.cpSync(source,dir,{recursive:true});
 const request=JSON.parse(fs.readFileSync(path.join(dir,'request.json')));
 for(const key of ['trace','dumpTrace','dumpDir','configFile'])request[key]=path.join(dir,request[key]);request.packRoot=process.cwd();
 const edit=(file,mutate)=>{const p=path.join(dir,file),v=JSON.parse(fs.readFileSync(p));mutate(v);fs.writeFileSync(p,JSON.stringify(v));};
 return {dir,request,edit,check:()=>verifyRecords(request)};
}
for(const name of ['idea-approve','idea-empty','discovery-approve'])test(`trimmed real Codex/monotest evidence: ${name}`,t=>{
 const f=liveFixture(t,name),before=fs.readFileSync(path.join(f.dir,name==='idea-empty'?'dump/projects-1.json':'dump/comments-1.json'),'utf8');
 const r=f.check();assert.equal(r.status,'passed',r.reason);assert.equal(r.monotestTasks,name==='discovery-approve'?2:0);
 if(name!=='idea-empty')assert.equal(r.gateResults[0].result.ok,true);
 assert.equal(fs.readFileSync(path.join(f.dir,name==='idea-empty'?'dump/projects-1.json':'dump/comments-1.json'),'utf8'),before,'gate must not overwrite raw evidence');
 if(name!=='idea-empty'){
  delete f.request.approvalBindings;assert.match(f.check().reason,/shown-version binding missing/);
 }
});
function editLiveTrace(f,mutate){
 const rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);mutate(rows);
 fs.writeFileSync(f.request.trace,rows.map(e=>JSON.stringify(e)).join('\n')+'\n');
}
for(const name of ['idea-approve','discovery-approve'])test(`tampered real ${name} write is failed, not a missing-result escape`,t=>{
 const f=liveFixture(t,name);editLiveTrace(f,rows=>{
  const item=rows.map(e=>e.payload?.item).find(i=>i?.tool===(name==='idea-approve'?'save_project':'save_document')&&(name==='idea-approve'||i.arguments.title.startsWith('PRD:')));
  item.arguments[name==='idea-approve'?'description':'content']+='\nTampered substantive text';
 });
 const result=f.check();assert.equal(result.status,'failed',result.reason);assert.match(result.reason,/mismatch/);
});
for(const field of ['arguments','result','status'])test(`real native completed MCP requires ${field}`,t=>{
 const f=liveFixture(t,'idea-approve');editLiveTrace(f,rows=>{delete rows.find(e=>e.payload?.item?.tool==='save_project').payload.item[field];});
 assert.equal(f.check().status,'unverified');
});
test('native MCP duplicate ids are not another successfully linked action',t=>{
 const f=liveFixture(t,'idea-approve');editLiveTrace(f,rows=>{
  const items=rows.filter(e=>e.payload?.item?.type==='McpToolCall');items[1].payload.item.id=items[0].payload.item.id;
 });assert.equal(f.check().status,'unverified');
});
test('real empty Idea envelope must contain a full last list_projects page',t=>{
 const f=liveFixture(t,'idea-empty');f.edit('dump/projects-1.json',v=>{const p=JSON.parse(v.content[0].text);p.hasNextPage=true;v.content[0].text=JSON.stringify(p);});
 assert.match(f.check().reason,/unfinished projects page/);
});
test('a Discovery predecessor cannot be certified as closed Design through route alone',t=>{
 const f=liveFixture(t,'discovery-approve');f.request.gates.push({command:'design'});
 const result=f.check();assert.equal(result.status,'unverified');assert.match(result.reason,/mono-design approval write absent/);
 assert.equal(result.gateResults[0].result.records.design,null);
 // Even an alleged design record must pass the dedicated design gate.
 editLiveTrace(f,rows=>{
  const item=rows.map(e=>e.payload?.item).find(i=>i?.tool==='save_comment'&&i.arguments.body.includes('mono-prd: approved'));
  item.arguments.body=item.arguments.body.replace('mono-prd: approved','mono-design: approved');
  const value=JSON.parse(item.result.content[0].text);value.body=item.arguments.body;item.result.content[0].text=JSON.stringify(value);
 });
 assert.notEqual(f.check().status,'passed');
});
test('linked owner-visible PRD cannot approve an updated version with unchanged text',t=>{
 const f=liveFixture(t,'discovery-approve'),binding=f.request.approvalBindings[0];
 editLiveTrace(f,rows=>{const item=rows[binding.shownReadLine-1].payload.item,value=JSON.parse(item.result.content[0].text);value.updatedAt='2026-11-01T20:57:21.000Z';item.result.content[0].text=JSON.stringify(value);});
 const result=f.check();assert.equal(result.status,'failed');assert.match(result.reason,/version changed/);
});
test('a mono-design write requires the dedicated passing design gate',t=>{
 const f=liveFixture(t,'discovery-approve');
 // Change the marker coherently in a scratch copy, retaining native provenance
 // and matching reads. This is deliberately not a valid Design approval.
 const visit=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())visit(file);else if(/\.jsonl?$/.test(name))fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('mono-prd: approved','mono-design: approved prd=425e1596-b9a6-4be2-ae02-3d2cd7701f63'));}};
 visit(f.dir);f.request.expectedRecords=[{type:'mono-design: approved',count:1}];
 // Exercise the mandatory gate independently of the now-earlier rejection of
 // an invalid document/version binding on this deliberately malformed record.
 delete f.request.approvalBindings;
 const noGate=f.check();assert.equal(noGate.status,'failed');assert.equal(noGate.gateResults[0].command,'route');assert.equal(noGate.gateResults[0].result.ok,false);
 f.request.gates=[{command:'design'}];
 const invalid=f.check();assert.equal(invalid.status,'failed',invalid.reason);assert.equal(invalid.gateResults[0].command,'design');assert.equal(invalid.gateResults[0].result.ok,false);
});

for(const host of ['claude','codex'])for(const mode of ['complete','shell','foreign'])test(`${host}: fixed dump saves native raw results without model filesystem work (${mode})`,async t=>{
 const f=fixture(t),authFile=path.join(f.dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const collected=await collectRecordDump({host,cwd:f.dir,packRoot:process.cwd(),outputDir:path.join(f.dir,'fixed'),authFile,timeoutMs:10000,idleMs:10,
  binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-fixed-dump-host.mjs'),mode]},
  project:{id:projectId,name:'fixed-run'},projectName:'fixed-run',mcpServers:{monotest:{url:'https://example.test/mcp'}}});
 assert.equal(collected.status,mode==='complete'?'passed':'failed',JSON.stringify(collected));
 if(mode==='shell')assert.match(collected.reason,/host commands/);
 if(mode==='foreign'){
  assert.match(collected.reason,/outside test servers/);
  const trace=path.join(f.dir,'empty-stage.jsonl');fs.writeFileSync(trace,JSON.stringify(host==='codex'?{type:'event_msg',payload:{type:'task_complete'}}:{type:'result',subtype:'success'})+'\n');
  const violation=await verifyScenarioRecords({run:{trace},runRequest:{host,context:{projectName:'fixed-run'},mcpServers:{monotest:{url:'x'}}},scenario:{expectedRecords:[]},outputDir:path.join(f.dir,'unused')},async()=>collected);
  assert.equal(violation.stop,true);assert.deepEqual(violation.manualRemoval,['https://linear.app/working/issue/x']);
 }
 if(mode==='complete'){
  assert.equal(collected.dumpComplete,true);assert.equal(collected.dumpFiles.length,8);
  const p=JSON.parse(fs.readFileSync(path.join(collected.dumpDir,'project.json')));assert.equal(p.content[0].type,'text');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(collected.dumpDir,'comments-2.request.json'))),{cursor:'c1'});
  const trace=path.join(f.dir,'empty-stage.jsonl');fs.writeFileSync(trace,JSON.stringify(host==='codex'?{type:'event_msg',payload:{type:'task_complete'}}:{type:'result',subtype:'success'})+'\n');
  const result=verifyRecords({host,trace,dumpDir:collected.dumpDir,dumpTrace:collected.trace,project:{id:projectId,name:'fixed-run'},expectedRecords:[{type:'project'}]});assert.equal(result.status,'passed',result.reason);
 }
});
test('binding-only metadata cannot hide a later failed gate',t=>{
 const f=liveFixture(t,'idea-approve');delete f.request.approvalBindings;
 const clean=f.check();assert.equal(clean.status,'unverified');assert.equal(clean.bindingOnly,true);assert.equal(clean.gateResults[0].result.ok,true);
 f.request.gates.push({command:'design'});const failed=f.check();assert.notEqual(failed.status,'passed');assert.notEqual(failed.bindingOnly,true);
});
function live2Fixture(t,name){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-live2-records-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.cpSync(path.resolve('scripts/test-fixtures/skills-records-live2',name),dir,{recursive:true});
 const request=JSON.parse(fs.readFileSync(path.join(dir,'request.json')));for(const k of ['trace','dumpTrace','dumpDir','configFile'])request[k]=path.join(dir,request[k]);request.packRoot=process.cwd();return {dir,request,check:()=>verifyRecords(request)};
}
for(const name of ['idea-correction','discovery-approve'])test(`live2 ${name}: native write, stored normalisation and real gate agree`,t=>{
 const f=live2Fixture(t,name);assert.equal(f.check().status,'passed',f.check().reason);delete f.request.approvalBindings;const pending=f.check();assert.equal(pending.status,'unverified');assert.equal(pending.bindingOnly,true);assert(pending.gateResults.every(g=>g.result.ok));
 editLiveTrace(f,rows=>{const item=rows.map(e=>e.payload?.item).find(i=>i?.tool==='save_project');item.arguments.description+='\nwrong substantive text';});assert.equal(f.check().status,'failed');
});
test('live2 failed Research has an existing seed; missing full dump is not forbidden project creation',t=>{
 const f=live2Fixture(t,'research-discuss'),result=f.check();assert.equal(result.status,'unverified');assert.match(result.reason,/incomplete dump: missing project.json/);assert.notEqual(result.bindingOnly,true);
});
test('live2 Research second window retains its transition role and remains unverified without answer',async t=>{
 const {checkTrace}=await import('./skills-trace.mjs'),f=live2Fixture(t,'research-discuss'),r=JSON.parse(fs.readFileSync(path.join(f.dir,'trace-check.json')));r.trace=f.request.trace;
 const full=checkTrace(r);assert.equal(full.status,'unverified');const second=full.windows[1];assert.equal(second.questions.length,1);assert.equal(second.role,'transition');assert.equal(second.executionConfirmed,false);
 const stopped=checkTrace({...r,endLine:r.intendedEndLine});assert.equal(stopped.status,'passed');
});
for(const [sent,stored,status] of [
 ['- one\n- two','* one\n* two','passed'],
 ['- `literal`','* `literal`','passed'],
 ['```text\n- one\n```','```text\n* one\n```','failed'],
 ['    - literal','    * literal','failed'],
 ['    [Name](https://example.test/a)','    [Name](<https://example.test/a>)','failed'],
 ['- one\n- two','* one\n* changed','failed'],
 ['[Name](https://example.test/a)','[Name](<https://example.test/a>)','passed'],
 ['[Name](https://example.test/a)','[Other](<https://example.test/a>)','failed']
])test(`stored Markdown preserves content: ${JSON.stringify(sent)} -> ${status}`,t=>{
 const f=fixture(t);f.events[2].message.content[0].input.body=sent;f.record.body=stored;f.events[3].message.content[0].content=JSON.stringify(f.record);f.page('comments','comments',[f.record]);f.request.expectedRecords=[];
 assert.equal(f.check().status,status);
 f.request.expectedRecords=[{type:stored,count:1}];f.page('comments','comments',[f.record,{...f.record,id:'duplicate'}]);assert.equal(f.check().status,'failed');
});
test('a missing binding cannot excuse an approval after a real empty answer',t=>{
 const f=liveFixture(t,'idea-approve');delete f.request.approvalBindings;
 editLiveTrace(f,rows=>{const receipt=rows.find(r=>r.payload?.role==='user'),content=receipt.payload.content[0];const answers=JSON.parse(content.text.split('\n').slice(1,-2).join('\n'));answers[0].answer='';content.text='<send_user_message_question_reply>\n'+JSON.stringify(answers)+'\n</send_user_message_question_reply>\n';});
 const result=f.check();assert.equal(result.status,'failed');assert.match(result.reason,/empty\/refuse/);assert.notEqual(result.bindingOnly,true);
});

function live3Fixture(t,name){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mono-live3-records-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.cpSync(path.resolve('scripts/test-fixtures/skills-records-live3'),dir,{recursive:true});
 const base=path.join(dir,name),request=JSON.parse(fs.readFileSync(path.join(base,'request.json')));
 for(const key of ['trace','dumpTrace','dumpDir','configFile','sent'])request[key]=path.resolve(base,request[key]);
 request.additionalTraces=request.additionalTraces.map(r=>({...r,trace:path.join(base,r.trace)}));request.packRoot=process.cwd();
 return {base,request,check:()=>verifyRecords(request)};
}
for(const name of ['discovery-approve','idea-correction'])test(`live3 ${name}: actual Codex sent journal and scripted native dump reach binding-only with passing gates`,t=>{
 const f=live3Fixture(t,name),result=f.check();assert.equal(result.status,'unverified',result.reason);assert.equal(result.bindingOnly,true,result.reason);
 assert(result.gateResults.length>0);assert(result.gateResults.every(g=>g.exitCode===0&&g.result.ok));
 // A Codex journal is not proof of delivery: removing the actual native answer
 // must still refuse the approval, even when sent.jsonl remains present.
 const data=JSON.parse(fs.readFileSync(f.request.trace));const reply=data.events.filter(r=>r.event.payload?.role==='user'&&r.event.payload.content?.some(c=>c.text?.includes('Утвердить, продолжу позже'))).at(-1);
 assert(reply);reply.event.payload.content=[{type:'input_text',text:'No native structured answer'}];fs.writeFileSync(f.request.trace,JSON.stringify(data));
 const bad=f.check();assert.notEqual(bad.bindingOnly,true);assert.notEqual(bad.status,'passed');
});
test('live3 Research: records pass but a second target transition remains unanswered',async t=>{
 const {checkTrace,codexWindows}=await import('./skills-trace.mjs'),{traceRows}=await import('./skills-probe.mjs'),{windowPolicy,windowRole}=await import('./skills-owner.mjs');
 const f=live3Fixture(t,'research-discuss');assert.equal(f.check().status,'passed',f.check().reason);
 const scenario=JSON.parse(fs.readFileSync(path.join(f.base,'windows.json'))),windows=codexWindows(traceRows(f.request.trace,'codex').rows,f.request.trace);
 assert.deepEqual(windows.map(w=>windowRole(w.questions)),['transition',null,'transition']);
 assert.equal(windows[1].executionConfirmed,true,'free window was answered natively');assert.equal(windows[2].executionConfirmed,false);
 assert.throws(()=>windowPolicy({...scenario,windows:[{mode:'discuss'}]},windows[2].questions,scenario.replies),/unexpected target/);
 const checked=checkTrace({host:'codex',trace:f.request.trace,expectedWindows:scenario.expectedWindows});assert.notEqual(checked.status,'passed');
});

const live4=()=>JSON.parse(fs.readFileSync(path.resolve('scripts/test-fixtures/skills-records-live4/handoff.json')));
test('live4 Handoff: exact stored links, list markers and block spacing preserve text',t=>{
 const f=fixture(t),excerpt=live4().markdown;f.events[2].message.content[0].input.body=excerpt.input;f.record.body=excerpt.stored;f.events[3].message.content[0].content=JSON.stringify(f.record);f.page('comments','comments',[f.record]);f.request.expectedRecords=[];
 assert.equal(f.check().status,'passed');
 f.record.body=f.record.body.replace('колонка с точным заголовком','колонка с изменённым заголовком');f.events[3].message.content[0].content=JSON.stringify(f.record);f.page('comments','comments',[f.record]);assert.equal(f.check().status,'failed');
});
for(const [input,stored] of [
 ['one\n\ntwo','one\ntwo'],['```\na\n\nb\n```','```\na\nb\n```'],
 ['    # heading\n\n    code','    # heading\n    code'],['* list\n\nparagraph','* list\nparagraph'],
 ['https://example.test/a','[https://example.test/a](<https://example.test/b>)'],
 ['[Label](https://example.test/a)','[Other](<https://example.test/a>)'],
 ['`https://example.test/a`','`[https://example.test/a](<https://example.test/a>)`']
])test(`stored formatting never erases a content boundary: ${JSON.stringify(input)}`,t=>{
 const f=fixture(t);f.events[2].message.content[0].input.body=input;f.record.body=stored;f.events[3].message.content[0].content=JSON.stringify(f.record);f.page('comments','comments',[f.record]);f.request.expectedRecords=[];assert.equal(f.check().status,'failed');
});
for(const answer of ['Передать оркестратору','Начать работу (Recommended)','Ещё обсудить','Начать Discovery','Утвердить',''])test(`live4 Handoff start checks its own native transition button: ${JSON.stringify(answer)}`,t=>{
 const f=fixture(t),sample=live4().authorization;f.request.host='codex';f.request.expectedRecords=[];
 const event=sample.events.find(r=>r.event.payload?.role==='user'&&r.event.payload.content?.some(c=>c.text?.startsWith('<send_user_message_question_reply>')));
 const content=event.event.payload.content[0],parts=content.text.split('\n'),answers=JSON.parse(parts[1]);answers[0].answer=answer;parts[1]=JSON.stringify(answers);content.text=parts.join('\n');
 const trace=path.join(f.dir,'native-start.json');fs.writeFileSync(trace,JSON.stringify({events:sample.events}));f.request.trace=trace;
 Object.assign(f.record,sample.record);f.page('comments','comments',[f.record]);f.request.packRoot=process.cwd();f.request.configFile=path.resolve('.agents/mono-workflow.config.json');
 const result=f.check();
 if(['Передать оркестратору','Начать работу (Recommended)'].includes(answer))assert.equal(result.gateResults[0]?.command,'route',result.reason);
 else{assert.equal(result.status,'failed',result.reason);assert.match(result.reason,/empty\/refuse\/discuss\/non-approval/);assert.equal(result.gateResults.length,0);}
});

for(const prose of ['tokens','shown-text','inline-shown'])test(`review2: approval binding ignores spoofed ${prose} outside its record`,t=>{
 const f=liveFixture(t,'discovery-approve'),binding=f.request.approvalBindings[0],other='11111111-1111-4111-8111-111111111111',approvedId=binding.documentId;assert.equal(f.check().status,'passed');
 const text=json=>{
  if(typeof json==='string'){
   try{const value=JSON.parse(json);if(typeof value==='object'&&value!==null)return JSON.stringify(text(value));}catch{}
   if(json.includes('mono-prd: approved '))return json.replace(`document=${approvedId} `,`document=${other} `)+'\n'+(prose==='tokens'?`document=${binding.documentId} updatedAt=2026-11-01T20:57:20.590Z`:binding.text);
   return json;
  }
  if(Array.isArray(json))return json.map(text);
  if(json&&typeof json==='object')return Object.fromEntries(Object.entries(json).map(([k,v])=>[k,text(v)]));return json;
 };
 const walk=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else if(/\.jsonl?$/.test(name)){
  const source=fs.readFileSync(file,'utf8');let changed;try{changed=JSON.stringify(text(JSON.parse(source)));}catch{changed=source.trim().split('\n').map(s=>JSON.stringify(text(JSON.parse(s)))).join('\n')+'\n';}fs.writeFileSync(file,changed);
 }}};walk(f.dir);
 if(prose==='inline-shown'){delete binding.documentId;editLiveTrace(f,rows=>{rows[binding.shownLine-1].payload.content[0].text+='\n'+binding.text;});}
 const result=f.check();assert.equal(result.status,'failed',JSON.stringify(result));assert.match(result.reason,/shown content\/version/);
});
test('review2: multiline inline code is literal during stored Markdown comparison',t=>{
 const f=fixture(t);f.events[2].message.content[0].input.body='`alpha\n- beta\nomega`';f.record.body='`alpha\n* beta\nomega`';f.events[3].message.content[0].content=JSON.stringify(f.record);f.page('comments','comments',[f.record]);f.request.expectedRecords=[];assert.equal(f.check().status,'failed');
});
for(const kind of ['projects','documents','issues'])test(`review2: repeated ${kind} response cursor cannot prove a complete dump`,t=>{
 const f=fixture(t);f.events.splice(0);f.request.expectedRecords=[];
 if(kind==='projects'){f.request.project=null;f.request.projectName='absent-run';}
 for(let n=1;n<=3;n++){
  f.save(`${kind}-${n}.request.json`,n===1?{}:{cursor:'cycle'});f.save(`${kind}-${n}.json`,{[kind]:[{id:`row${n}`,name:`other${n}`}],hasNextPage:n<3,...(n<3?{cursor:'cycle'}:{})});
  if(kind==='documents')f.save(`documents/row${n}.json`,{id:`row${n}`,projectId,title:`Doc${n}`,content:'Body'});
  if(kind==='issues'){f.save(`issues/row${n}/issue.json`,{id:`row${n}`,projectId,title:`Task${n}`,description:'Body',status:'Todo',labels:[]});f.page(`issues/row${n}/comments`,'comments',[]);}
 }
 const result=f.check();assert.equal(result.status,'unverified',JSON.stringify(result));assert.match(result.reason,/cursor/);
});
test('review2: an Idea snapshot cannot borrow shown text from prose outside its fence',async t=>{
 const {ideaFingerprint}=await import('./idea-gate.mjs'),{unwrap}=await import('./skills-proof.mjs'),f=liveFixture(t,'idea-approve');
 const binding=f.request.approvalBindings.find(b=>b.recordId!==f.request.project.id),page=unwrap(JSON.parse(fs.readFileSync(path.join(f.request.dumpDir,'comments-1.json')))),record=page.comments.find(c=>c.id===binding.recordId);
 const before=record.body,changed=binding.text+'\nUnapproved unknown.',after=before.replace(binding.text,changed).replace(/sha256=[a-f0-9]{64}/,'sha256='+ideaFingerprint(changed))+'\n'+binding.text;
 const rewrite=v=>{
  if(typeof v==='string'){try{const parsed=JSON.parse(v);if(parsed&&typeof parsed==='object')return JSON.stringify(rewrite(parsed));}catch{}return v.replace(before,after).replace(JSON.stringify(before),JSON.stringify(after));}
  if(Array.isArray(v))return v.map(rewrite);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rewrite(x)]));return v;
 };
 const walk=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else if(/\.jsonl?$/.test(name)){
  const s=fs.readFileSync(file,'utf8');let data;try{data=JSON.stringify(rewrite(JSON.parse(s)));}catch{data=s.trim().split('\n').map(x=>JSON.stringify(rewrite(JSON.parse(x)))).join('\n')+'\n';}fs.writeFileSync(file,data);
 }}};walk(f.dir);
 const rejected=f.check();assert.equal(rejected.status,'failed',rejected.reason);assert.match(rejected.reason,/outgoing approved version/);
 delete f.request.approvalBindings;const unbound=f.check();assert.equal(unbound.bindingOnly,true,unbound.reason);assert.equal(unbound.gateResults[0].result.ok,true,'tampering is a valid but unapproved snapshot, not just a broken digest');
});
for(const mode of ['free-window','older-window'])test(`review2: manual bindings cannot override the native decision source (${mode})`,t=>{
 const f=liveFixture(t,'discovery-approve'),binding=f.request.approvalBindings[0];
 editLiveTrace(f,rows=>{
  const window=rows.find(r=>r.payload?.call_id===binding.windowCallId&&r.payload?.name==='request_user_input_async');assert(window);
  if(mode==='free-window'){
   const input=JSON.parse(window.payload.arguments);delete input.questions[0].options;window.payload.arguments=JSON.stringify(input);
  }else{
   const index=rows.findIndex(r=>r.payload?.item?.tool==='save_comment'&&JSON.stringify(r.payload.item.result).includes(binding.recordId));assert(index>=binding.currentLine);
   const later=structuredClone(window);later.payload.call_id='later-approval';
   rows.splice(index,0,later,{type:'response_item',payload:{type:'function_call_output',call_id:'later-approval',output:'{"accepted":true}'}});f.request.endLine+=2;
  }
 });
 const result=f.check();assert.equal(result.status,'failed',result.reason);assert.match(result.reason,/latest decision window/);
});
test('review2: full inline document text still needs its native shown-version read',t=>{
 const f=liveFixture(t,'discovery-approve'),binding=f.request.approvalBindings[0];
 editLiveTrace(f,rows=>{rows[binding.shownLine-1].payload.content[0].text+='\n'+binding.text;});delete binding.documentId;
 assert.equal(f.check().status,'passed','a native before-read also binds a full inline summary');
 delete binding.shownReadLine;const result=f.check();assert.equal(result.status,'unverified');assert.match(result.reason,/shown document version read required/);
});
