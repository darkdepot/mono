import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyRecords, dumpPrompt, collectRecordDump } from './skills-records.mjs';

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
