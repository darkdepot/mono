import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyRecords as verifyTextRecords, dumpPrompt, collectRecordDump, verifyScenarioRecords as verifyTextScenarioRecords } from './skills-records.mjs';
import { verifyScenarioRecords as verifyWindowScenarioRecords, verifyRecords as verifyWindowRecords } from './test-fixtures/legacy-window-records.mjs';
const verifyScenarioRecords=(input,...rest)=>input.runRequest.scenario?.expectedReplies?verifyTextScenarioRecords(input,...rest):verifyWindowScenarioRecords(input,...rest);
const verifyRecords=request=>request.expectedReplies?verifyTextRecords(request):verifyWindowRecords(request);
import { nativeRecords } from './skills-record-data.mjs';
import { ideaFingerprint } from './idea-gate.mjs';

const projectId='00000000-0000-4000-8000-000000000001',date='2026-10-31T00:00:00Z';
// These constructed sessions have their own deterministic clock. Native live
// excerpts below retain the original host timestamps instead.
const timed=(rows,base)=>rows.map((row,index)=>({...row,timestamp:new Date(Date.parse(base)+index*10).toISOString()}));
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
  fs.writeFileSync(trace,timed([...events,terminal],'2026-11-02T04:00:00Z').map(e=>JSON.stringify(e)).join('\n')+'\n');
  if(request.dumpTrace!==dumpTrace)return;
  const reads=[];
  const walk=(directory)=>{for(const name of fs.readdirSync(directory)){const file=path.join(directory,name);if(fs.statSync(file).isDirectory()){walk(file);continue;}
   if(!name.endsWith('.json')||name.endsWith('.request.json'))continue;
   const relative=path.relative(dumpDir,file),value=JSON.parse(fs.readFileSync(file)),kind=relative.startsWith('statuses/')?'list_issue_statuses':/^comments-/.test(name)?'list_comments':/^documents-/.test(name)?'list_documents':/^issues-/.test(name)?'list_issues':/^projects-/.test(name)?'list_projects':/^teams-/.test(name)?'list_teams':relative==='project.json'?'get_project':name==='issue.json'?'get_issue':'get_document';
   const page=kind.startsWith('list_'),scope=relative.startsWith('issues/')?relative.split('/')[1]:projectId;
   const input=kind==='list_issue_statuses'?{team:path.basename(name,'.json')}:kind==='list_teams'?JSON.parse(fs.readFileSync(file.replace(/\.json$/,'.request.json'))):page?{...(kind==='list_projects'?{query:request.projectName}:{[kind==='list_issues'?'project':scope===projectId?'projectId':'issueId']:scope}),...(['list_issues','list_projects'].includes(kind)?{includeArchived:true}:{}),...(fs.existsSync(file.replace(/\.json$/,'.request.json'))?JSON.parse(fs.readFileSync(file.replace(/\.json$/,'.request.json'))):{})}:{id:value.uuid??value.id};
   const id=String(reads.length);
   if(request.host==='claude')reads.push({type:'assistant',message:{content:[{type:'tool_use',id,name:`mcp__monotest__${kind}`,input}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(value)}]}});
   else reads.push({type:'response_item',payload:{type:'function_call',name:`mcp__monotest__${kind}`,call_id:id,arguments:JSON.stringify(input)}},{type:'response_item',payload:{type:'function_call_output',call_id:id,output:JSON.stringify(value)}});
  }};
  walk(dumpDir);fs.writeFileSync(dumpTrace,timed([...reads,terminal],'2026-11-02T04:01:00Z').map(e=>JSON.stringify(e)).join('\n')+'\n');
 };flush();
 const check=()=>{flush();return verifyRecords(request);};
 return {dir,dumpDir,project,record,events,save,page,flush,check,request};
}

test('records compare successful native write bodies to a fresh complete monotest dump',t=>{
 const f=fixture(t);assert.equal(f.check().status,'passed');
 f.page('comments','comments',[{...f.record,body:'mono-test: report changed after write'}]);assert.equal(f.check().status,'failed');
});

const live6=JSON.parse(fs.readFileSync(new URL('./test-fixtures/skills-records-live6.json',import.meta.url)));
const live7=JSON.parse(fs.readFileSync(new URL('./test-fixtures/skills-records-live7.json',import.meta.url)));
test('live8 shell exec MCP mentions are not records; actual unbound monotest calls remain unverified',t=>{
 const f=fixture(t),sample=JSON.parse(fs.readFileSync(new URL('./test-fixtures/skills-records-live8.json',import.meta.url)));f.request.host='codex';
 const write={type:'response_item',payload:{type:'function_call',call_id:'write',name:'mcp__monotest__create_comment',arguments:JSON.stringify({projectId,body:f.record.body})}},result={type:'response_item',payload:{type:'function_call_output',call_id:'write',output:JSON.stringify(f.record)}};
 f.events.splice(0,f.events.length,sample.exec,sample.command,sample.output,write,result);
 assert.equal(f.check().status,'passed');
 const input=`text(await tools.mcp__monotest__save_comment(${JSON.stringify({projectId,body:f.record.body})}));`;
 sample.exec.payload.input=input;sample.output.payload.output=JSON.stringify(f.record);
 assert.equal(f.check().status,'unverified');assert.match(f.check().reason,/unbound exec payload/);
 sample.exec.payload.input=`text(await tools.exec_command({"cmd":"echo test"}));\n${input}`;
 assert.equal(f.check().status,'unverified');
});
for(const identity of ['id','name'])test(`live7 project status uses the written ${identity} identity`,t=>{
 const f=fixture(t),status=live7.projectStatus;f.project.status=status;f.save('project.json',f.project);
 f.events.push({type:'assistant',message:{content:[{type:'tool_use',id:'status',name:'mcp__monotest__save_project',input:{id:projectId,state:status[identity]}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'status',content:JSON.stringify(f.project)}]}});
 assert.equal(f.check().status,'passed');
 f.project.status={...status,[identity==='id'?'name':'id']:'other'};f.save('project.json',f.project);assert.equal(f.check().status,'passed');
 f.project.status={...status,[identity]:'other'};f.save('project.json',f.project);assert.equal(f.check().status,'failed');
});
for(const host of ['claude','codex'])test(`live7 ${host}: seed forms need success/state, scenario writes remain strict`,t=>{
 const f=fixture(t),issue={id:'seed-task',projectId,title:'Research',description:'Seed',...live7.seedState.result};
 f.page('issues','issues',[{id:issue.id}]);f.save('issues/seed-task/issue.json',issue);f.page('issues/seed-task/comments','comments',[]);
 const input={id:issue.id,...live7.seedState.input};
 if(host==='claude')f.events.unshift({type:'assistant',message:{content:[{type:'tool_use',id:'seed',name:'mcp__monotest__save_issue',input}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'seed',content:JSON.stringify(issue)}]}},{type:'result',subtype:'success'});
 else{
  f.request.host='codex';
  f.events.splice(0,f.events.length,{type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'seed',input:`text(await tools.mcp__monotest__save_issue(${JSON.stringify(input)}));`}},{type:'response_item',payload:{type:'custom_tool_call_output',call_id:'seed',output:JSON.stringify(issue)}},{type:'event_msg',payload:{type:'task_complete'}},{type:'response_item',payload:{type:'function_call',name:'mcp__monotest__create_comment',call_id:'write',arguments:JSON.stringify({projectId,body:f.record.body})}},{type:'response_item',payload:{type:'function_call_output',call_id:'write',output:JSON.stringify(f.record)}});
 }
 Object.assign(f.request,{seedExpected:true,seedEndLine:3,seedProjectId:projectId});
 assert.equal(f.check().status,'passed');
 f.page('comments','comments',[{...f.record,body:'actual scenario mismatch'}]);assert.equal(f.check().status,'failed');
});
test('live7 dump ignores a failed incidental read, never substitutes a shell item for fresh MCP proof',t=>{
 const f=fixture(t);f.request.host='codex';f.events.splice(0,f.events.length);f.request.expectedRecords=[{type:'project'}];f.check();
 const original=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse),dump=path.join(f.dir,'retried-dump.jsonl');f.request.dumpTrace=dump;
 const save=rows=>fs.writeFileSync(dump,timed(rows,'2026-11-02T04:01:00Z').map(JSON.stringify).join('\n')+'\n');
 save([...live7.failedRead,live7.shellItem,...original]);assert.equal(f.check().status,'passed');
 save([...live7.failedRead,live7.shellItem,...original.filter(r=>!((r.payload?.name==='mcp__monotest__get_project')||r.payload?.call_id===original.find(x=>x.payload?.name==='mcp__monotest__get_project').payload.call_id))]);
 assert.equal(f.check().status,'unverified');
});
test('live7 CommandExecution is host information, not a native MCP record',t=>{
 const f=fixture(t),trace=path.join(f.dir,'shell.jsonl');fs.writeFileSync(trace,JSON.stringify(live7.shellItem)+'\n');
 assert.deepEqual(nativeRecords('codex',trace).calls,[]);
});
test('live7 unavailable fixed dump read retries once and remains unverified without fresh files',async t=>{
 const f=fixture(t),authFile=path.join(f.dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const result=await collectRecordDump({host:'codex',cwd:f.dir,packRoot:process.cwd(),outputDir:path.join(f.dir,'read-unavailable'),authFile,timeoutMs:10000,idleMs:10,binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-fixed-dump-host.mjs'),'read-unavailable']},project:{id:projectId,name:'fixed-run'},mcpServers:{monotest:{url:'test'}}});
 assert.equal(result.status,'unverified');assert.equal(result.hostFailure,true);assert.equal(result.attempts.length,2);assert(result.attempts.every(a=>a.hostFailure));
 assert.equal(fs.existsSync(path.join(result.dumpDir,'project.json')),false);
});
for(const kind of ['mono-design','mono-research'])test(`live6 ${kind}: task prose is not a second record; a real duplicate fails`,t=>{
 const f=fixture(t),sample=live6[kind];f.request.expectedRecords=[{type:kind,count:1}];
 const record=kind==='mono-research'?{id:'doc',projectId,title:'Research',content:sample.record}:{...f.record,body:sample.record};
 if(kind==='mono-research'){
  f.events[2].message.content[0]={type:'tool_use',id:'write',name:'mcp__monotest__save_document',input:{projectId,title:record.title,content:record.content}};
  f.page('comments','comments',[]);f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',record);
 }else{
  f.events[2].message.content[0].input.body=record.body;f.page('comments','comments',[record]);
 }
 f.events[3].message.content[0].content=JSON.stringify(record);
 const issue={id:'task',projectId,title:'Stage log',description:'Log',status:'Todo',labels:[]};
 f.page('issues','issues',[{id:'task'}]);f.save('issues/task/issue.json',issue);
 f.page('issues/task/comments','comments',[{...f.record,id:'log',body:sample.taskMention}]);
 const result=f.check();assert.equal(result.status,kind==='mono-research'?'passed':'unverified',result.reason);
 // Even a structurally real record in a task log is outside the stage's record location.
 f.page('issues/task/comments','comments',[{...f.record,id:'log',body:sample.record}]);
 assert.equal(f.check().status,result.status);
 if(kind==='mono-research'){
  f.page('documents','documents',[{id:'doc'},{id:'duplicate'}]);f.save('documents/duplicate.json',{...record,id:'duplicate'});
 }else f.page('comments','comments',[record,{...record,id:'duplicate'}]);
 const duplicate=f.check();assert.equal(duplicate.status,'failed');assert.match(duplicate.reason,/expected .*: 1, observed 2/);
 // Two native record blocks in one stored body are two records too.
 if(kind==='mono-research'){
  f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',{...record,content:sample.record+'\n\n'+sample.record});
  f.events[2].message.content[0].input.content=sample.record+'\n\n'+sample.record;
  f.events[3].message.content[0].content=JSON.stringify({...record,content:sample.record+'\n\n'+sample.record});
 }else{
  f.record.body=sample.record+'\n\n'+sample.record;f.page('comments','comments',[f.record]);
  f.events[2].message.content[0].input.body=f.record.body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 }
 assert.match(f.check().reason,/expected .*: 1, observed 2/);
});

for(const marker of ['mono-idea: approved','mono-prd: approved','mono-design: approved','mono-tech: approved','mono-package: start'])test(`record header boundary and project scope: ${marker}`,t=>{
 const f=fixture(t),mention=`Запись ${marker} прочитана обратно.`,body=live6['mono-design'].record.replace('mono-design: approved',marker);
 f.events[2].message.content[0].input.body=body;f.record.body=body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 f.page('comments','comments',[f.record,{...f.record,id:'mention',body:mention+'\n'+marker.split(':')[0]}]);f.request.expectedRecords=[{type:marker.split(':')[0],count:1}];
 assert.equal(f.check().status,'unverified');
 f.request.expectedRecords=[{type:marker,count:1}];assert.equal(f.check().status,'unverified');
 f.request.expectedRecords=[{type:marker.split(':')[0]+'-extra',count:1}];
 const unmatched=f.check();assert.equal(unmatched.status,'failed');assert.match(unmatched.reason,/observed 0/);
 f.request.expectedRecords=[{forbidden:marker}];f.events.splice(0);f.page('comments','comments',[{...f.record,id:'mention',body:mention}]);
 assert.equal(f.check().status,'passed');
 f.page('comments','comments',[f.record]);assert.equal(f.check().status,'failed');
});

for(const name of ['Skill','Agent','Task'])for(const target of ['main','child','dump','dump-child'])test(`amend1 forbidden ${name} applies to ${target} trace`,t=>{
 const f=fixture(t);f.request.nextSkill='mono:research';f.request.nextAgent='mono-mono-research';f.request.expectedRecords.push({forbidden:'start-next-stage'});
 const call={type:'assistant',message:{content:[{type:'tool_use',id:'next',name,input:name==='Skill'?{skill:f.request.nextSkill}:{subagent_type:f.request.nextAgent}}]}};
 f.check();
 if(target==='main')f.events.push(call);
 else if(target==='dump')fs.appendFileSync(f.request.dumpTrace,JSON.stringify(call)+'\n');
 else {const trace=path.join(f.dir,'child.jsonl');fs.writeFileSync(trace,JSON.stringify(call)+'\n'+JSON.stringify({type:'result',subtype:'success'})+'\n');f.request[target==='child'?'additionalTraces':'dumpAdditionalTraces']=[{host:'claude',trace}];}
 const result=target==='main'?f.check():verifyRecords(f.request);
 assert.equal(result.status,'failed',result.reason);assert.match(result.reason,/forbidden start-next-stage/);
});
for(const stage of ['scenario','dump'])test(`amend1 suite wrapper preserves forbidden transitions in ${stage} children`,async t=>{
 const f=fixture(t);f.check();const child=path.join(f.dir,'child.jsonl');
 fs.writeFileSync(child,JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'next',name:'Skill',input:{skill:'mono:research'}}]}})+'\n');
 let collections=0;
 const result=await verifyScenarioRecords({run:{trace:f.request.trace,auditedTraces:stage==='scenario'?[f.request.trace,child]:[f.request.trace]},runRequest:{host:'claude',context:{skillPrefix:'mono'},mcpServers:{monotest:{url:'test'}}},scenario:{next:'research',expectedRecords:[{forbidden:'start-next-stage'}]},outputDir:path.join(f.dir,'unused')},async()=>{collections++;return {status:'passed',trace:f.request.dumpTrace,dumpDir:f.dumpDir,auditedTraces:[f.request.dumpTrace,child]};});
 assert.equal(result.status,'failed');assert.match(result.reason,/forbidden start-next-stage/);assert.equal(collections,stage==='scenario'?0:1);
});
for(const mode of ['incomplete','failed','post-terminal-write','dump-write'])test(`amend1 child ${mode} is checked like the main trace`,t=>{
 const f=fixture(t);f.check();const trace=path.join(f.dir,'child.jsonl');
 let rows=mode==='incomplete'?[{type:'assistant',message:{content:[{type:'text',text:'Still running'}]}}]:[{type:'result',subtype:mode==='failed'?'error_during_execution':'success'}];
 const extra={host:'claude',trace};
 if(['post-terminal-write','dump-write'].includes(mode)){extra.endLine=1;rows.push(...f.events.slice(2));}
 fs.writeFileSync(trace,timed(rows,'2026-11-02T04:00:01Z').map(e=>JSON.stringify(e)).join('\n')+'\n');
 f.request[mode==='dump-write'?'dumpAdditionalTraces':'additionalTraces']=[extra];
 const result=verifyRecords(f.request);assert.notEqual(result.status,'passed');
 assert.match(result.reason,/incomplete|terminal|dump.*write/);
});
for(const mode of ['before','overlap','equal','missing-write-time','missing-read-time','invalid-time','completed-only'])test(`amend1 dump freshness ${mode} cannot pass`,t=>{
 const f=fixture(t);f.check();
 const edit=(file,fn)=>{const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);fn(rows);fs.writeFileSync(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');};
 if(['before','overlap','equal','invalid-time','missing-read-time'].includes(mode))edit(f.request.dumpTrace,rows=>{for(const row of rows){
  if(mode==='missing-read-time')delete row.timestamp;
  else row.timestamp=mode==='invalid-time'?'2026-02-30T00:00:00Z':mode==='before'?'2026-11-02T03:00:00Z':mode==='equal'?'2026-11-02T04:00:00.030Z':row.type==='assistant'?'2026-11-02T04:00:00Z':'2026-11-02T04:01:00Z';
 }});
 if(mode==='missing-write-time')edit(f.request.trace,rows=>rows.forEach(row=>delete row.timestamp));
 if(mode==='completed-only'){
  f.request.host='codex';f.events.splice(0,f.events.length);f.check();
  edit(f.request.dumpTrace,rows=>{const result=[];for(let i=0;i<rows.length-1;i+=2){const call=rows[i].payload,out=rows[i+1].payload;result.push({timestamp:'2026-11-02T04:01:00Z',type:'event_msg',payload:{type:'item_completed',item:{type:'McpToolCall',id:call.call_id,server:'monotest',tool:call.name.replace('mcp__monotest__',''),arguments:JSON.parse(call.arguments),status:'completed',result:JSON.parse(out.output)}}});}result.push(rows.at(-1));rows.splice(0,rows.length,...result);});
 }
 const result=verifyRecords(f.request);assert.equal(result.status,'unverified',result.reason);assert.match(result.reason,/order|fresh|time/);
});
test('amend1 old dump with truncated final save result is not fresh read-back',t=>{
 const f=fixture(t),content='Persisted content';f.page('comments','comments',[]);f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content});
 f.events.splice(0,f.events.length,{type:'assistant',message:{content:[{type:'tool_use',id:'save',name:'mcp__monotest__save_document',input:{id:'doc',content}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'save',content:JSON.stringify({id:'doc',content:'… (truncated, use `get_document` for full description)'})}]}});
 f.request.expectedRecords=[{type:'project'}];assert.equal(f.check().status,'passed');
 const rows=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(line=>({...JSON.parse(line),timestamp:'2026-11-02T03:00:00Z'}));fs.writeFileSync(f.request.dumpTrace,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
 const result=verifyRecords(f.request);assert.equal(result.status,'unverified');assert.match(result.reason,/order|fresh/);
});
test('amend1 a late child write prevents an older dump from passing',t=>{
 const f=fixture(t);f.check();const trace=path.join(f.dir,'child.jsonl');
 fs.writeFileSync(trace,timed([...f.events.slice(2),{type:'result',subtype:'success'}],'2026-11-02T04:02:00Z').map(e=>JSON.stringify(e)).join('\n')+'\n');
 f.events.splice(2);f.check();f.request.additionalTraces=[{host:'claude',trace}];
 const result=verifyRecords(f.request);assert.equal(result.status,'unverified');assert.match(result.reason,/order|fresh/);
});
test('amend1 mixed native hosts retain the child payload/result and terminal checks',t=>{
 const f=fixture(t);f.events.splice(2);f.check();const trace=path.join(f.dir,'codex-child.jsonl');
 const rows=[{type:'response_item',payload:{type:'function_call',name:'mcp__monotest__create_comment',call_id:'child-write',arguments:JSON.stringify({projectId,body:f.record.body})}},
  {type:'response_item',payload:{type:'function_call_output',call_id:'child-write',output:JSON.stringify(f.record)}},{type:'event_msg',payload:{type:'task_complete'}}];
 fs.writeFileSync(trace,timed(rows,'2026-11-02T04:00:01Z').map(e=>JSON.stringify(e)).join('\n')+'\n');f.request.additionalTraces=[{host:'codex',trace}];
 assert.equal(verifyRecords(f.request).status,'passed');rows.pop();fs.writeFileSync(trace,timed(rows,'2026-11-02T04:00:01Z').map(e=>JSON.stringify(e)).join('\n')+'\n');assert.equal(verifyRecords(f.request).status,'unverified');
});
test('amend1 versions on separate traces require proved non-overlapping writes',t=>{
 const f=fixture(t),trace=path.join(f.dir,'later-write.jsonl'),body=f.record.body+' corrected';f.check();
 const rows=structuredClone(f.events.slice(2));rows[0].message.content[0].input.body=body;rows[1].message.content[0].content=JSON.stringify({...f.record,body});rows.push({type:'result',subtype:'success'});
 f.page('comments','comments',[{...f.record,body}]);f.check();f.request.additionalTraces=[{host:'claude',trace}];
 fs.writeFileSync(trace,timed(rows,'2026-11-02T04:00:01Z').map(e=>JSON.stringify(e)).join('\n')+'\n');assert.equal(verifyRecords(f.request).status,'passed');
 fs.writeFileSync(trace,timed(rows,'2026-11-02T04:00:00.025Z').map(e=>JSON.stringify(e)).join('\n')+'\n');const overlap=verifyRecords(f.request);assert.equal(overlap.status,'unverified');assert.match(overlap.reason,/write ordering/);
});
test('amend1 request times and filesystem mtimes cannot supply missing native order',t=>{
 const f=fixture(t);f.check();
 const rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(line=>{const value=JSON.parse(line);delete value.timestamp;return value;});fs.writeFileSync(f.request.trace,rows.map(e=>JSON.stringify(e)).join('\n')+'\n');
 f.request.startedAt='2026-11-02T03:00:00Z';f.request.finishedAt='2026-11-02T03:01:00Z';fs.utimesSync(f.request.trace,0,0);
 const result=verifyRecords(f.request);assert.equal(result.status,'unverified');assert.match(result.reason,/order/);
});
test('amend1 a later matching native read proves freshness despite an older identical read',t=>{
 const f=fixture(t);f.check();const fresh=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse),old=structuredClone(fresh);
 for(const row of old){row.timestamp='2026-11-02T03:00:00Z';for(const block of row.message?.content??[]){if(block.id)block.id='old-'+block.id;if(block.tool_use_id)block.tool_use_id='old-'+block.tool_use_id;}}
 fs.writeFileSync(f.request.dumpTrace,[...old,...fresh].map(row=>JSON.stringify(row)).join('\n')+'\n');
 const result=verifyRecords(f.request);assert.equal(result.status,'passed',result.reason);
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
for(const host of ['claude','codex'])for(const state of ['read','write','error','missing'])test(`${host}: foreign ${state} stays a stop; removal requires a successful mutation`,t=>{
 const f=fixture(t),url='https://linear.app/working/issue/existing',name=`mcp__linear__${state==='read'?'get_issue':'save_issue'}`;
 const value={id:'existing',url},callId='foreign';f.request.host=host;
 const call=host==='claude'?{type:'assistant',message:{content:[{type:'tool_use',id:callId,name,input:{id:'existing'}}]}}:{type:'response_item',payload:{type:'function_call',name,call_id:callId,arguments:'{"id":"existing"}'}};
 const output=host==='claude'?{type:'user',message:{content:[{type:'tool_result',tool_use_id:callId,...(state==='error'?{is_error:true}:{}),content:JSON.stringify(value)}]}}:{type:'response_item',payload:{type:'function_call_output',call_id:callId,output:JSON.stringify(state==='error'?{isError:true,content:[{type:'text',text:JSON.stringify(value)}]}:value)}};
 f.events.splice(0,f.events.length,call,...(state==='missing'?[]:[output]));
 const result=f.check();assert.equal(result.status,'failed');assert.equal(result.stop,true);assert.deepEqual(result.manualRemoval,state==='write'?[url]:[]);
});
test('foreign reads with a hyphenated MCP server stay stopped without removal links',t=>{
 const f=fixture(t);f.events[2].message.content[0].name='mcp__working-linear__get_issue';f.record.url='https://linear.app/working/issue/existing';f.events[3].message.content[0].content=JSON.stringify(f.record);
 const result=f.check();assert.equal(result.status,'failed');assert.equal(result.stop,true);assert.deepEqual(result.manualRemoval,[]);
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
 const r=await collectRecordDump({host:'claude',project:f.project,cwd:f.dir,packRoot:process.cwd(),outputDir,mcpServers:{monotest:{url:'https://example.test/mcp'}}},async request=>{seen=request;return {status:'passed',trace:f.request.dumpTrace};});
 assert.equal(r.status,'passed');assert.equal(seen.readOnlyDump,true);assert.deepEqual(Object.keys(seen.mcpServers),['monotest']);
 const prompt=dumpPrompt({project:f.project,dumpDir:f.dumpDir});for(const part of ['comments-N.request.json','documents','issues','status','labels','cursor'])assert(prompt.includes(part));
 await assert.rejects(()=>collectRecordDump({...seen,mcpServers:{monotest:{url:'x'},linear:{url:'y'}}}),/only monotest/);
});

for(const policy of ['approve','empty','refuse','discuss','changed-version','early-write','unbound-write','later-shown'])test(`shown version and native reply: ${policy}`,t=>{
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
 if(policy==='later-shown'){f.events.splice(1,0,{type:'assistant',message:{content:[{type:'text',text:'Replacement version two'}]}});f.request.approvalBindings[0].currentLine++;}
 if(policy==='early-write'){f.events.splice(2,0,f.events.splice(6,1)[0]);}
 const result=f.check();assert.equal(result.status,policy==='approve'?'passed':'failed',result.reason);
});
test('amend1 a current-version read must complete before the approval write',t=>{
 const f=fixture(t),draft='Shown',q={question:'Утвердить?',options:[{label:'Утвердить (Recommended)'},{label:'Ещё обсудить'}]};
 const call=(id,name,input)=>({type:'assistant',message:{content:[{type:'tool_use',id,name,input}]}}),result=(id,value)=>({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:typeof value==='string'?value:JSON.stringify(value)}]}});
 f.record.body='mono-test: approved\n'+draft;f.page('comments','comments',[f.record]);f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content:draft});
 f.events.splice(0,f.events.length,{type:'assistant',message:{content:[{type:'text',text:draft}]}},call('window','AskUserQuestion',{questions:[q]}),
  {type:'control_request',request_id:'permission',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[q]}}},result('window',`Your questions have been answered: "${q.question}"="Утвердить (Recommended)". You can now continue with these answers in mind.`),
  call('current','mcp__monotest__get_document',{id:'doc'}),call('write','mcp__monotest__create_comment',{projectId,body:f.record.body}),result('current',{id:'doc',content:draft}),result('write',f.record));
 f.request.sent=path.join(f.dir,'sent.jsonl');fs.writeFileSync(f.request.sent,JSON.stringify({type:'control_response',response:{request_id:'permission',response:{behavior:'allow',updatedInput:{questions:[q],answers:{[q.question]:'Утвердить (Recommended)'}}}}})+'\n');
 f.request.approvalBindings=[{recordId:'r1',windowCallId:'window',shownLine:1,currentLine:5,text:draft}];
 const resultValue=f.check();assert.equal(resultValue.status,'failed',resultValue.reason);assert.match(resultValue.reason,/read completed after approval/);
});

const claudeChildApproval=JSON.parse(fs.readFileSync(new URL('./test-fixtures/skills-claude-child-approval.json',import.meta.url)));
for(const bindChild of [false,true])test(`production historical Claude ${bindChild?'rejects a scout-only presentation':'accepts the owner summary despite a later scout message'}`,t=>{
 const f=fixture(t),saved=structuredClone(claudeChildApproval.events),draft=saved[bindChild?1:0].message.content[0].text;
 const questions=saved[2].message.content[0].input.questions,question=questions[0].question,answer='Утвердить, продолжу позже';
 const call=(id,name,input)=>({type:'assistant',message:{content:[{type:'tool_use',id,name,input}]}}),result=(id,value)=>({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:typeof value==='string'?value:JSON.stringify(value)}]}});
 f.record.body='mono-test: approved\n'+draft;f.request.testedVersion='0.42.0';
 f.events.splice(0,f.events.length,...saved,
  {type:'control_request',request_id:'permission',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions}}},
  result('window',`Your questions have been answered: "${question}"="${answer}". You can now continue with these answers in mind.`),
  call('read','mcp__monotest__get_document',{id:'doc'}),result('read',{id:'doc',content:draft}),
  call('write','mcp__monotest__create_comment',{projectId,body:f.record.body}),result('write',f.record));
 f.page('comments','comments',[f.record]);f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content:draft});
 f.request.sent=path.join(f.dir,'sent.jsonl');fs.writeFileSync(f.request.sent,JSON.stringify({type:'control_response',response:{request_id:'permission',response:{behavior:'allow',updatedInput:{questions,answers:{[question]:answer}}}}})+'\n');
 f.request.approvalBindings=[{recordId:'r1',windowCallId:'window',shownLine:bindChild?2:1,currentLine:6,text:draft}];
 f.request.expectedWindows=[{id:'approval',role:'approval',decision:'Утвержд',advice:'Совет',reason:'Research',summary:['## Что','## Зачем']}];
 f.request.windows=[{mode:'label',label:answer}];f.request.rubricDefinition='Review the visible parent summary and native window reply.';
 f.flush();let checked=verifyTextRecords(f.request);
 if(!bindChild){assert.equal(checked.status,'unverified');assert.ok(checked.rubricDigest);f.request.rubric={digest:checked.rubricDigest,reviewer:'fixture-reviewer',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',reason:'Parent presentation and reply reviewed',evidence:'native fixture'}))};checked=verifyTextRecords(f.request);}
 assert.equal(checked.status,bindChild?'unverified':'passed',JSON.stringify(checked));
 if(bindChild)assert.match(checked.reason,/shown version not found in owner-visible trace/);
 assert.equal(saved[0].parent_tool_use_id,null,'native parent messages remain eligible');
});

// Saved owner/scout/window excerpts plus constructed read-back and native replies.
function historicalRecords(t,host='claude',answer='Утвердить, продолжу позже') {
 const f=fixture(t),saved=structuredClone(claudeChildApproval.events),draft=saved[0].message.content[0].text;
 const questions=saved[2].message.content[0].input.questions;
 const call=(id,name,input)=>host==='claude'?{type:'assistant',message:{content:[{type:'tool_use',id,name,input}]}}:{type:'response_item',payload:{type:'function_call',call_id:id,name,arguments:JSON.stringify(input)}};
 const result=(id,value)=>host==='claude'?{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:typeof value==='string'?value:JSON.stringify(value)}]}}:{type:'response_item',payload:{type:'function_call_output',call_id:id,output:typeof value==='string'?value:JSON.stringify(value)}};
 f.request.host=host;f.request.testedVersion='0.42.0';f.record.body='mono-test: approved\n'+draft;
 f.request.expectedWindows=[{id:'approval',role:'approval',decision:'Утвержд',advice:'Совет',reason:'Research',summary:['## Что','## Зачем','Дальше:']}];
 f.request.windows=[{mode:'label',label:'Утвердить, продолжу позже'}];
 f.request.rubricDefinition='Summary must be visible; judge question, owner response and any correction against the fixed policy.';
 if(host==='claude') {
  const question=questions[0].question,updatedInput={questions,answers:{[question]:answer}};
  const receipt=answer===''?'The user did not answer the questions.':questions[0].options.some(o=>o.label===answer)?`Your questions have been answered: "${question}"="${answer}". You can now continue with these answers in mind.`:`The user answered: "${question}"="${answer}". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`;
  const reply=result('window',receipt);reply.tool_use_result=updatedInput;
  f.events.splice(0,f.events.length,...saved,{type:'control_request',request_id:'permission',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions}}},reply);
  f.request.sent=path.join(f.dir,'sent.jsonl');fs.writeFileSync(f.request.sent,JSON.stringify({type:'control_response',response:{request_id:'permission',response:{behavior:'allow',updatedInput}}})+'\n');
 } else {
  const qs=questions.map(q=>({title:q.question+'\n'+q.options.map(o=>o.label+': '+o.description).join('\n'),options:q.options.map(o=>o.label)}));
  const reply=`<send_user_message_question_reply>\n${JSON.stringify(qs.map((q,i)=>({questionItemId:JSON.stringify(['request_user_input_async','window',i]),question:q.title,answer})))}\n</send_user_message_question_reply>\n`;
  f.events.splice(0,f.events.length,call('window','request_user_input_async',{questions:qs}),result('window',{accepted:true}),{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:draft}]}},{type:'event_msg',payload:{type:'task_complete'}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:reply}]}});
 }
 f.events.push(call('read','mcp__monotest__get_document',{id:'doc'}),result('read',{id:'doc',content:draft}),call('write','mcp__monotest__create_comment',{projectId,body:f.record.body}),result('write',f.record));
 f.page('comments','comments',[f.record]);f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content:draft});
 f.request.approvalBindings=[{recordId:'r1',windowCallId:'window',shownLine:host==='claude'?1:3,currentLine:6,text:draft}];
 f.check=()=>{f.flush();return verifyTextRecords(f.request);};
 f.attest=()=>{delete f.request.rubric;const initial=f.check();assert.equal(initial.status,'unverified',JSON.stringify(initial));assert.ok(initial.rubricDigest,'historical rubric was built');f.request.rubric={digest:initial.rubricDigest,reviewer:'fixture-reviewer',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',evidence:'fixture native exchange reviewed',reason:'Matches fixed scenario'}))};return initial;};
 return f;
}
function historicalSource(t,host,mode='valid') {
 const f=historicalRecords(t,host),rows=f.events.slice(0,5);
 const response=host==='claude'?{type:'assistant',message:{content:[{type:'text',text:'Утверждение не записываю; передаю результат.'}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Утверждение не записываю; передаю результат.'}]}};
 const terminal=host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 if(mode==='missing-answer')rows.splice(4,1);
 rows.push(response,terminal);
 const serialized=timed(rows,'2026-11-02T04:00:00Z').map(JSON.stringify).join('\n')+'\n';
 fs.writeFileSync(f.request.trace,mode==='malformed-card'?serialized.replaceAll('Совет','Вывод'):serialized);
 if(mode==='malformed-card'&&f.request.sent)fs.writeFileSync(f.request.sent,fs.readFileSync(f.request.sent,'utf8').replaceAll('Совет','Вывод'));
 return {host,trace:f.request.trace,sent:f.request.sent,expectedWindows:f.request.expectedWindows,windows:f.request.windows,rubricDefinition:f.request.rubricDefinition};
}
for(const primaryHost of ['claude','codex'])for(const extraHost of ['claude','codex']) {
 for(const mode of ['malformed-card','missing-answer','missing-policy'])test(`historical all sources: ${primaryHost} plus ${extraHost} ${mode} cannot pass`,t=>{
  const f=historicalRecords(t,primaryHost);f.attest();const extra=historicalSource(t,extraHost,mode);if(mode==='missing-policy')delete extra.expectedWindows;
  f.request.additionalTraces=[extra];const result=f.check();assert.equal(result.status,mode==='malformed-card'?'failed':'unverified',JSON.stringify(result));
 });
 test(`historical all sources: ${primaryHost} plus ${extraHost} both bind native exchanges and rubric`,t=>{
  const f=historicalRecords(t,primaryHost);f.request.additionalTraces=[historicalSource(t,extraHost)];const initial=f.attest();
  assert.equal(initial.rubricInput.sources.length,2,'each source belongs to the combined rubric');
  assert.deepEqual(initial.rubricInput.sources.map(s=>s.host),[primaryHost,extraHost]);
  assert(initial.rubricInput.sources.every(s=>s.exchanges[0].answers[0]==='Утвердить, продолжу позже'));
  assert.equal(f.check().status,'passed');
  const extra=f.request.additionalTraces[0];fs.appendFileSync(extra.trace,JSON.stringify(extraHost==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}})+'\n');
  const changed=f.check();assert.equal(changed.status,'unverified','additional trace changes stale the combined judgment');assert.notEqual(changed.rubricDigest,initial.rubricDigest);
 });
}
for(const host of ['claude','codex'])test(`historical all sources: ${host} cannot borrow an answer beyond its endLine`,t=>{
 const f=historicalRecords(t);f.attest();f.request.additionalTraces=[{...historicalSource(t,host),endLine:4}];
 const result=f.check();assert.equal(result.status,'unverified',JSON.stringify(result));
});
for(const uncertain of ['missing-answer','missing-file','missing-policy'])for(const reverse of [false,true])test(`historical all sources: failed dominates ${uncertain}, reversed=${reverse}`,t=>{
 const f=historicalRecords(t,'codex');f.attest();const weak=historicalSource(t,'codex',uncertain),broken=historicalSource(t,'claude','malformed-card');
 if(uncertain==='missing-file')weak.trace=path.join(path.dirname(weak.trace),'absent.jsonl');
 if(uncertain==='missing-policy')delete weak.windows;
 f.request.additionalTraces=reverse?[broken,weak]:[weak,broken];const result=f.check();assert.equal(result.status,'failed',JSON.stringify(result));
});
test('historical all sources: an uncertain primary cannot hide a failed additional window',t=>{
 const f=historicalRecords(t,'codex');f.attest();f.events.splice(4,1);f.request.additionalTraces=[historicalSource(t,'claude','malformed-card')];
 assert.equal(f.check().status,'failed');
});
test('historical all sources: an uncertain additional window cannot hide a failed record',t=>{
 const f=historicalRecords(t);f.attest();f.request.additionalTraces=[historicalSource(t,'codex','missing-answer')];f.page('comments','comments',[{...f.record,body:'Changed after write'}]);
 const result=f.check();assert.equal(result.status,'failed',JSON.stringify(result));assert.match(result.reason,/mismatch/);
});
test('historical all sources: an unreadable additional trace cannot hide a failed record',t=>{
 const f=historicalRecords(t);f.attest();f.request.additionalTraces=[{host:'codex',trace:path.join(f.dir,'absent.jsonl')}];f.page('comments','comments',[{...f.record,body:'Changed after write'}]);
 const result=f.check();assert.equal(result.status,'failed',JSON.stringify(result));assert.match(result.reason,/mismatch/);
});
for(const host of ['claude','codex'])test(`historical all sources: ${host} approval uses that source's native policy`,t=>{
 const primary=historicalRecords(t,host==='claude'?'codex':'claude'),extra=historicalRecords(t,host,'Исправь указанную строку и утверди');
 extra.request.windows=[{mode:'correction',text:'Исправь указанную строку и утверди'}];extra.request.expectedWindows[0].id='secondary-approval';
 extra.record.id='r2';extra.record.body=extra.record.body.replace('mono-test:','mono-other:');extra.request.approvalBindings[0].recordId='r2';
 const rewrite=value=>{
  if(typeof value==='string')return value.replaceAll('mono-test: approved','mono-other: approved').replaceAll('"id":"r1"','"id":"r2"');
  if(Array.isArray(value))return value.map(rewrite);
  return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='id'&&v==='r1'?'r2':rewrite(v)])):value;
 };
 extra.events.splice(0,extra.events.length,...rewrite(extra.events));extra.flush();
 primary.request.additionalTraces=[{host,trace:extra.request.trace,sent:extra.request.sent,expectedWindows:extra.request.expectedWindows,windows:extra.request.windows}];
 primary.request.expectedRecords.push({type:'mono-other',count:1});primary.request.approvalBindings.push(extra.request.approvalBindings[0]);primary.page('comments','comments',[primary.record,extra.record]);
 primary.attest();const result=primary.check();assert.equal(result.status,'passed',JSON.stringify(result));
 assert.equal(result.rubricInput.sources[1].exchanges[0].policy.mode,'correction');assert.equal(result.rubricInput.sources[1].exchanges[0].id,'secondary-approval');
 primary.events.splice(4,1);extra.request.windows[0].text='Иная поправка';
 const rejected=primary.check();assert.equal(rejected.status,'failed',JSON.stringify(rejected));assert(rejected.requiredChecks.some(c=>c.id.startsWith('approval:')&&c.status==='failed'),'unknown primary proof cannot hide an unauthorized secondary approval');
});
for(const host of ['claude','codex']) {
 for(const answer of ['Утвердить нельзя, нужно ещё обсудить','Утвердить неизвестный вариант','Ещё обсудить',''])test(`historical ${host} does not authorize approval from ${JSON.stringify(answer)}`,t=>{
  const f=historicalRecords(t,host,answer),checked=f.check();assert.equal(checked.status,'failed',JSON.stringify(checked));assert.match(checked.reason,/non-approval/);
 });
 test(`historical ${host} requires a native window rubric and includes actual exchange evidence`,t=>{
  const f=historicalRecords(t,host),initial=f.attest(),exchange=initial.rubricInput.sources[0].exchanges[0];
  assert.match(exchange.text,/## Что/);assert.equal(exchange.answers[0],'Утвердить, продолжу позже');assert.ok(exchange.questions[0]);assert.ok(exchange.replyLine>exchange.line);
  assert.equal(f.check().status,'passed',JSON.stringify(f.check()));
  f.request.rubric.checks[0].status='failed';assert.equal(f.check().status,'failed');
 });
 test(`historical ${host} allows only the explicit correction policy text`,t=>{
  const f=historicalRecords(t,host,'Исправь указанную строку и утверди');f.request.windows=[{mode:'correction',text:'Исправь указанную строку и утверди'}];
  f.attest();assert.equal(f.check().status,'passed');
  f.request.windows[0].text='Иной текст';assert.equal(f.check().status,'failed');
 });
 for(const absent of ['expectedWindows','windows','rubricDefinition','rubric','summary','question','response','correction','approvalBindings','dumpTrace','nativeAnswer','staleRubric','unverifiedRubric'])test(`historical ${host} cannot pass a skipped required check: ${absent}`,t=>{
  const f=historicalRecords(t,host);f.attest();
  if(absent==='nativeAnswer')f.events.splice(4,1);
  else if(absent==='staleRubric')f.request.rubric.digest='0'.repeat(64);
  else if(absent==='unverifiedRubric')f.request.rubric.checks[0].status='unverified';
  else if(['summary','question','response','correction'].includes(absent))f.request.rubric.checks=f.request.rubric.checks.filter(c=>c.id!==absent);else delete f.request[absent];
  const checked=f.check();assert.equal(checked.status,'unverified',JSON.stringify(checked));
 });
}
for(const host of ['claude','codex'])test(`historical ${host} records cannot use card-only checking to skip a required window`,t=>{
 const f=historicalRecords(t,host);f.request.expectedWindows.push({...f.request.expectedWindows[0],id:'second-approval'});f.request.windows.push({...f.request.windows[0]});f.request.phase='card';
 const initial=f.check();
 if(initial.status==='unverified'&&initial.rubricDigest){f.attest();}
 const checked=f.check();assert.equal(checked.status,'failed',JSON.stringify(checked));
});
test('historical Claude native denial cannot authorize a record write',t=>{
 const f=historicalRecords(t),message='Не утверждаю';
 f.events[4].message.content[0]={type:'tool_result',tool_use_id:'window',is_error:true,content:message};delete f.events[4].tool_use_result;
 fs.writeFileSync(f.request.sent,JSON.stringify({type:'control_response',response:{request_id:'permission',response:{behavior:'deny',message}}})+'\n');
 const checked=f.check();assert.equal(checked.status,'failed',JSON.stringify(checked));assert.match(checked.reason,/non-approval/);
});
test('historical record collection preserves scenario policy and a reviewable native exchange on resume',async t=>{
 const f=historicalRecords(t);f.flush();fs.writeFileSync(path.join(f.dir,'VERSION'),'0.42.0\n');const bindingsFile=path.join(f.dir,'bindings.json');fs.writeFileSync(bindingsFile,JSON.stringify({approvalBindings:f.request.approvalBindings}));
 const input={run:{trace:f.request.trace,sent:f.request.sent,testedVersion:'0.42.0'},runRequest:{host:'claude',cwd:f.dir,packRoot:f.dir,mcpServers:{monotest:{url:'test'}},context:{projectName:f.project.name,skillPrefix:'mono'},scenario:{expectedWindows:f.request.expectedWindows,windows:f.request.windows,rubricDefinition:f.request.rubricDefinition}},scenario:{expectedRecords:f.request.expectedRecords},project:f.project,outputDir:path.join(f.dir,'records'),bindingsFile};
 const initial=await verifyTextScenarioRecords(input,async()=>({status:'passed',trace:f.request.dumpTrace,dumpDir:f.dumpDir}));assert.equal(initial.status,'unverified',JSON.stringify(initial));assert.ok(initial.rubricDigest,JSON.stringify(initial));
 fs.writeFileSync(bindingsFile,JSON.stringify({approvalBindings:f.request.approvalBindings,rubric:{digest:initial.rubricDigest,reviewer:'fixture-reviewer',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',evidence:'native exchange',reason:'Matches fixed policy'}))}}));
 const resumed=await verifyTextScenarioRecords({...input,resumeEvidence:initial.reviewEvidence},()=>{throw Error('must reuse evidence');});assert.equal(resumed.status,'passed',JSON.stringify(resumed));
});
test('historical Claude uses only already verified native receipt answers offline',t=>{
 const f=historicalRecords(t);delete f.request.sent;f.attest();assert.equal(f.check().status,'passed');
 f.events[4].tool_use_result.answers[Object.keys(f.events[4].tool_use_result.answers)[0]]='Утвердить нельзя';
 assert.equal(f.check().status,'unverified','mismatched receipt cannot authorize approval');
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
 const entries=[['get_project',{id:projectId},'project.json'],['list_comments',{projectId},'comments-1.json'],['list_documents',{projectId},'documents-1.json'],['list_issues',{project:projectId,includeArchived:true},'issues-1.json']];
 for(const [tool,input,file]of entries){const id=String(events.length);events.push({type:'assistant',message:{content:[{type:'tool_use',id,name:`mcp__monotest__${tool}`,input}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:fs.readFileSync(path.join(f.dumpDir,file),'utf8')}]}});}
 const flush=()=>fs.writeFileSync(dumpTrace,timed([...events,{type:'result',subtype:'success'}],'2026-11-02T04:01:00Z').map(e=>JSON.stringify(e)).join('\n')+'\n');flush();f.request.dumpTrace=dumpTrace;
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
for(const tamper of [false,true])test(`continue7 historical ordinary Idea binds full presentation to canonical body (${tamper})`,t=>{
 const f=liveFixture(t,'idea-approve');fs.writeFileSync(path.join(f.dir,'VERSION'),'0.42.0\n');fs.symlinkSync(path.resolve('scripts'),path.join(f.dir,'scripts'),'dir');
 Object.assign(f.request,{packRoot:f.dir,testedVersion:'0.42.0',expectedWindows:[{id:'approval',role:'approval',decision:'Утверждаем',advice:'Совет',reason:'Research',summary:['## Что','## Зачем','## Неизвестные']}],windows:[{mode:'label',label:'Утвердить, продолжу позже'}],rubricDefinition:'Full shown Idea, native consent and canonical project body.'});
 f.request.approvalBindings[0].text=f.request.approvalBindings[1].text;
 if(tamper){
  const change=(value,key)=>{
   if(typeof value==='string'){if(key==='description'&&value.includes('## Что'))return value+'\nUnapproved project change.';try{return JSON.stringify(change(JSON.parse(value)));}catch{return value;}}
   if(Array.isArray(value))return value.map(v=>change(v));
   return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,change(v,k)])):value;
  };
  for(const file of [f.request.trace,f.request.dumpTrace])fs.writeFileSync(file,fs.readFileSync(file,'utf8').trim().split('\n').map(line=>JSON.stringify(change(JSON.parse(line)))).join('\n')+'\n');
  f.edit('dump/project.json',v=>Object.assign(v,change(v)));
 }
 const first=verifyTextRecords(f.request);if(first.rubricDigest)f.request.rubric={digest:first.rubricDigest,reviewer:'native-control oracle',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',reason:'Saved complete native approval',evidence:'native Idea control'}))};
 const checked=verifyTextRecords(f.request);assert.equal(checked.status,tamper?'failed':'passed',JSON.stringify(checked));
 if(!tamper)assert.equal(checked.gateResults[0].result.ok,true);else assert.match(checked.reason,/mismatch|differs/);
});

for(const host of ['claude','codex'])for(const mode of ['native-no-team','native-no-team-project','native-no-team-many'])test(`continue7 fixed native issue team resolution ${host} ${mode}`,async t=>{
 const f=fixture(t),native=JSON.parse(JSON.parse(fs.readFileSync(new URL('./test-fixtures/skills-records-live/discovery-approve/dump/issues/MON-130/issue.json',import.meta.url))).content[0].text),authFile=path.join(f.dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const result=await collectRecordDump({host,cwd:f.dir,packRoot:process.cwd(),outputDir:path.join(f.dir,'fixed'),authFile,timeoutMs:10000,idleMs:10,binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-fixed-dump-host.mjs'),mode]},project:{id:native.projectId,name:'fixed-run'},mcpServers:{monotest:{url:'test'}}});
 assert.equal(result.status,'passed',JSON.stringify(result));
 const file=path.join(result.dumpDir,`issues/${native.uuid}/issue.json`);assert.ok(fs.existsSync(file),'whole native issue dump retained');
 const resolved=mode!=='native-no-team-many';assert.equal(fs.existsSync(path.join(result.dumpDir,'statuses/test-team.json')),resolved);
 if(resolved)assert.deepEqual(JSON.parse(JSON.parse(fs.readFileSync(path.join(result.dumpDir,'statuses/test-team.json'))).content[0].text),native.stateHistory.map(r=>r.state));
 else assert.ok(result.dumpStatusGaps?.length,'ambiguous team is a status evidence gap, not a thrown whole-dump failure');
});
for(const name of ['idea-approve','idea-empty','discovery-approve'])test(`trimmed real Codex/monotest evidence: ${name}`,t=>{
 const f=liveFixture(t,name),before=fs.readFileSync(path.join(f.dir,name==='idea-empty'?'dump/projects-1.json':'dump/comments-1.json'),'utf8');
 const r=f.check();if(name==='discovery-approve')assertInvocationGap(r);else assert.equal(r.status,'passed',r.reason);assert.equal(r.monotestTasks,name==='discovery-approve'?2:0);
 if(name!=='idea-empty')assert.equal(r.gateResults[0].result.ok,true);
 assert.equal(fs.readFileSync(path.join(f.dir,name==='idea-empty'?'dump/projects-1.json':'dump/comments-1.json'),'utf8'),before,'gate must not overwrite raw evidence');
 if(name!=='idea-empty'){
  delete f.request.approvalBindings;assert.match(f.check().reason,/shown-version binding missing/);
 }
});
function assertInvocationGap(result){
 assert.equal(result.status,'unverified',JSON.stringify(result));assert.equal(result.bindingOnly,true);assert.equal(result.reason,'approval write invocation not proved by native trace');
}
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
 const stage=path.join(f.dir,'empty-stage.jsonl');fs.writeFileSync(stage,JSON.stringify({...(host==='codex'?{type:'event_msg',payload:{type:'task_complete'}}:{type:'result',subtype:'success'}),timestamp:new Date(Date.now()-1).toISOString()})+'\n');
 const collected=await collectRecordDump({host,cwd:f.dir,packRoot:process.cwd(),outputDir:path.join(f.dir,'fixed'),authFile,timeoutMs:10000,idleMs:10,
  binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-fixed-dump-host.mjs'),mode]},
  project:{id:projectId,name:'fixed-run'},projectName:'fixed-run',mcpServers:{monotest:{url:'https://example.test/mcp'}}});
 assert.equal(collected.status,mode==='complete'?'passed':'failed',JSON.stringify(collected));
 if(mode==='shell')assert.match(collected.reason,/host commands/);
 if(mode==='foreign'){
  assert.match(collected.reason,/outside monotest/);
  const trace=path.join(f.dir,'empty-stage.jsonl');fs.writeFileSync(trace,JSON.stringify(host==='codex'?{type:'event_msg',payload:{type:'task_complete'}}:{type:'result',subtype:'success'})+'\n');
  const violation=await verifyScenarioRecords({run:{trace},runRequest:{host,context:{projectName:'fixed-run'},mcpServers:{monotest:{url:'x'}}},scenario:{expectedRecords:[]},outputDir:path.join(f.dir,'unused')},async()=>collected);
  assert.equal(violation.stop,true);assert.deepEqual(violation.manualRemoval,['https://linear.app/working/issue/x']);
 }
 if(mode==='complete'){
  assert.equal(collected.dumpComplete,true);assert.equal(collected.dumpFiles.length,9);
  const p=JSON.parse(fs.readFileSync(path.join(collected.dumpDir,'project.json')));assert.equal(p.content[0].type,'text');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(collected.dumpDir,'comments-2.request.json'))),{cursor:'c1'});
  const request={host,trace:stage,dumpDir:collected.dumpDir,dumpTrace:collected.trace,project:{id:projectId,name:'fixed-run'},expectedRecords:[{type:'project'}]};
  const result=verifyRecords(request);assert.equal(result.status,'passed',result.reason);
  if(host==='claude'){
   const receipt=JSON.parse(fs.readFileSync(path.join(f.dir,'fixed','result.json')));assert.match(receipt.process.traceTiming.sha256,/^[a-f0-9]{64}$/);
   fs.appendFileSync(collected.trace,'\n');const tampered=verifyRecords(request);assert.equal(tampered.status,'unverified');assert.match(tampered.reason,/order/);
  }
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
 const f=live2Fixture(t,name);if(name==='discovery-approve')assertInvocationGap(f.check());else assert.equal(f.check().status,'passed',f.check().reason);delete f.request.approvalBindings;const pending=f.check();assert.equal(pending.status,'unverified');assert.equal(pending.bindingOnly,true);assert(pending.gateResults.every(g=>g.result.ok));
 editLiveTrace(f,rows=>{const item=rows.slice(f.request.seedEndLine??0).map(e=>e.payload?.item).find(i=>i?.tool===(name==='discovery-approve'?'save_document':'save_project'));item.arguments[name==='discovery-approve'?'content':'description']+='\nwrong substantive text';});assert.equal(f.check().status,'failed');
});
test('live2 failed Research has an existing seed; missing full dump is not forbidden project creation',t=>{
 const f=live2Fixture(t,'research-discuss'),result=f.check();assert.equal(result.status,'unverified');assert.match(result.reason,/incomplete dump: missing project.json/);assert.notEqual(result.bindingOnly,true);
});
test('live2 Research second window retains its transition role and remains unverified without answer',async t=>{
 const {checkTrace}=await import('./test-fixtures/legacy-window-trace.mjs'),f=live2Fixture(t,'research-discuss'),r=JSON.parse(fs.readFileSync(path.join(f.dir,'trace-check.json')));r.trace=f.request.trace;
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
 const {checkTrace,codexWindows}=await import('./test-fixtures/legacy-window-trace.mjs'),{traceRows}=await import('./skills-probe.mjs'),{windowPolicy,windowRole}=await import('./test-fixtures/legacy-window-owner.mjs');
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
 const f=liveFixture(t,'discovery-approve'),binding=f.request.approvalBindings[0],other='11111111-1111-4111-8111-111111111111',approvedId=binding.documentId;assertInvocationGap(f.check());
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
   const later=structuredClone(window);later.payload.call_id='later-approval';later.timestamp=rows[index].timestamp;
   rows.splice(index,0,later,{timestamp:later.timestamp,type:'response_item',payload:{type:'function_call_output',call_id:'later-approval',output:'{"accepted":true}'}});f.request.endLine+=2;
  }
 });
 const result=f.check();assert.equal(result.status,'failed',result.reason);assert.match(result.reason,/latest decision window/);
});
test('review2: full inline document text still needs its native shown-version read',t=>{
 const f=liveFixture(t,'discovery-approve'),binding=f.request.approvalBindings[0];
 editLiveTrace(f,rows=>{rows[binding.shownLine-1].payload.content[0].text+='\n'+binding.text;});delete binding.documentId;
 assertInvocationGap(f.check()); // Content binds; this old excerpt omits the write invocation.
 delete binding.shownReadLine;const result=f.check();assert.equal(result.status,'unverified');assert.match(result.reason,/shown document version read required/);
});

// Accepted amend3 cases use the same native call/message shapes as live1..4.
for(const tool of ['list_documents','list_issues','list_comments'])test(`amend3 fixed dump rejects ${tool} filters`,t=>{
 const f=liveFixture(t,'idea-approve');
 const rows=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse);
 const call=rows.find(r=>r.payload?.item?.tool===tool);assert(call);call.payload.item.arguments.query='selected-only';
 fs.writeFileSync(f.request.dumpTrace,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const result=f.check();assert.equal(result.status,'unverified',JSON.stringify(result));assert.match(result.reason,/fresh native read does not bind/);
});
test('amend3 page arguments remain fixed across a real comments cursor chain',t=>{
 const f=fixture(t);f.check();f.request.dumpTrace=path.join(f.dir,'chain.jsonl');
 const raw=fs.readFileSync(path.join(f.dir,'dump-trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const i=raw.findIndex(r=>r.message?.content?.[0]?.name==='mcp__monotest__list_comments');
 const first={comments:[f.record],hasNextPage:true,cursor:f.record.id},second={comments:[],hasNextPage:false};
 f.save('comments-1.json',first);f.save('comments-2.request.json',{cursor:f.record.id});f.save('comments-2.json',second);
 raw[i+1].message.content[0].content=JSON.stringify(first);
 const next=structuredClone(raw.slice(i,i+2));next[0].message.content[0].id='page2';next[0].message.content[0].input={projectId, cursor:f.record.id,orderBy:'createdAt'};next[1].message.content[0].tool_use_id='page2';next[1].message.content[0].content=JSON.stringify(second);
 raw.splice(i+2,0,...next);fs.writeFileSync(f.request.dumpTrace,timed(raw,'2026-11-02T04:01:00Z').map(r=>JSON.stringify(r)).join('\n')+'\n');
 const result=f.check();assert.equal(result.status,'unverified',JSON.stringify(result));assert.match(result.reason,/fresh native read does not bind|page arguments changed/);
});
function codexApproval(t,{mode='sequential',laterText=false}={}){
 const f=fixture(t),draft='Shown version one';f.request.host='codex';
 const source=JSON.parse(fs.readFileSync('scripts/test-fixtures/skills-records-live/idea-approve/request.json'));
 const native=fs.readFileSync('scripts/test-fixtures/skills-records-live/idea-approve/trace.jsonl','utf8').trim().split('\n').map(JSON.parse);
 const window=native.find(r=>r.payload?.call_id===source.approvalBindings[0].windowCallId&&r.payload?.name==='request_user_input_async');
 const index=native.indexOf(window),decision=structuredClone(native.slice(index,index+5));
 decision[2].payload.content[0].text=draft;if(laterText)decision.splice(3,0,{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Shown replacement version two'}]}});
 f.record.body='mono-test: approved\n'+draft;f.page('comments','comments',[f.record]);f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content:draft});
 const input={projectId,body:f.record.body},readInput={id:'doc'},current={type:'response_item',payload:{type:'function_call',call_id:'current',name:'mcp__monotest__get_document',arguments:JSON.stringify(readInput)}},readResult={type:'response_item',payload:{type:'function_call_output',call_id:'current',output:JSON.stringify({id:'doc',content:draft})}};
 const write={type:'event_msg',payload:{type:'item_completed',item:{type:'McpToolCall',id:'exec-write',server:'monotest',tool:'save_comment',arguments:input,status:'completed',result:f.record}}};
 const outer={type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'outer-write',input:`const r = await tools.mcp__monotest__save_comment(${JSON.stringify(input)}); text(r);`}},output={type:'response_item',payload:{type:'custom_tool_call_output',call_id:'outer-write',output:JSON.stringify(f.record)}};
 const events=[...decision,current,readResult];let currentLine=decision.length+1;
 if(mode==='completion-only')events.push(write);
 else if(mode==='parallel'){
  // A real exec may start both MCP operations before either result arrives.
  outer.payload.input=`const r = await Promise.all([tools.mcp__monotest__get_document(${JSON.stringify(readInput)}), tools.mcp__monotest__save_comment(${JSON.stringify(input)})]); text(r);`;
  const read={type:'event_msg',payload:{type:'item_completed',item:{type:'McpToolCall',id:'exec-read',server:'monotest',tool:'get_document',arguments:readInput,status:'completed',result:{id:'doc',content:draft}}}};
  events.splice(decision.length,2,outer,read,write,output);currentLine=decision.length+2;
 }else events.push(outer,write,output);
 f.events.splice(0,f.events.length,...events);f.request.approvalBindings=[{recordId:f.record.id,windowCallId:window.payload.call_id,shownLine:3,currentLine,text:draft}];
 return f;
}
test('amend3 Codex approval accepts its final text and sequential literal write invocation',t=>{
 const f=codexApproval(t);const result=f.check();assert.equal(result.status,'passed',JSON.stringify(result));
});
test('amend3 Codex approval cannot bind an earlier text replaced before the window is shown',t=>{
 const f=codexApproval(t,{laterText:true}),result=f.check();assert.notEqual(result.status,'passed');assert.match(result.reason,/last owner-visible text/);
});
for(const mode of ['completion-only','parallel'])test(`amend3 native approval order stays unverified (${mode})`,t=>{
 const f=codexApproval(t,{mode}),result=f.check();assert.equal(result.status,'unverified',JSON.stringify(result));assert.match(result.reason,/write invocation/);
});
test('amend3 independently complete document pages cannot change base arguments',t=>{
 const f=fixture(t);f.check();f.request.dumpTrace=path.join(f.dir,'chain.jsonl');
 const raw=fs.readFileSync(path.join(f.dir,'dump-trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const i=raw.findIndex(r=>r.message?.content?.[0]?.name==='mcp__monotest__list_documents');
 const first={documents:[],hasNextPage:true,cursor:'doc1'},second={documents:[],hasNextPage:false};
 // The real pagination shape requires a nonempty first page and its full body.
 first.documents.push({id:'doc1'});f.save('documents/doc1.json',{id:'doc1',projectId,title:'Draft',content:'Text'});
 f.save('documents-1.json',first);f.save('documents-2.request.json',{cursor:'doc1'});f.save('documents-2.json',second);
 raw[i+1].message.content[0].content=JSON.stringify(first);
 const next=structuredClone(raw.slice(i,i+2));next[0].message.content[0].id='page2';next[0].message.content[0].input={projectId,cursor:'doc1',includeArchived:true};next[1].message.content[0].tool_use_id='page2';next[1].message.content[0].content=JSON.stringify(second);
 // A driver-shaped exact get_document read binds the saved document too.
 const doc=JSON.parse(fs.readFileSync(path.join(f.dumpDir,'documents/doc1.json')));
 next.push({type:'assistant',message:{content:[{type:'tool_use',id:'doc',name:'mcp__monotest__get_document',input:{id:'doc1'}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'doc',content:JSON.stringify(doc)}]}});
 raw.splice(i+2,0,...next);fs.writeFileSync(f.request.dumpTrace,timed(raw,'2026-11-02T04:01:00Z').map(r=>JSON.stringify(r)).join('\n')+'\n');
 const result=f.check();assert.equal(result.status,'unverified',JSON.stringify(result));assert.match(result.reason,/page arguments changed/);
});

const live5=()=>JSON.parse(fs.readFileSync(path.resolve('scripts/test-fixtures/skills-records-live5.json')));
test('live5 heading gaps and trailing blank lines are renderer-only, actual description text is not',t=>{
 const f=fixture(t),sample=live5().description;f.request.expectedRecords=[];f.page('comments','comments',[]);
 f.project.description=sample.stored;f.save('project.json',f.project);
 f.events.splice(0,f.events.length,{type:'assistant',message:{content:[{type:'tool_use',id:'description',name:'mcp__monotest__save_project',input:{id:projectId,description:sample.written}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'description',content:JSON.stringify(f.project)}]}});
 assert.equal(f.check().status,'passed',JSON.stringify(f.check()));
 f.project.description=sample.stored.replace('Источник','Другой текст');f.save('project.json',f.project);f.events[1].message.content[0].content=JSON.stringify(f.project);
 assert.equal(f.check().status,'failed');
});
test('live5 real Codex capacity stdout is an unverified dump host failure and retries once',async t=>{
 const f=fixture(t),authFile=path.join(f.dir,'auth.json');fs.writeFileSync(authFile,'{}');
 const collected=await collectRecordDump({host:'codex',cwd:f.dir,packRoot:process.cwd(),outputDir:path.join(f.dir,'capacity'),authFile,timeoutMs:10000,idleMs:10,binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-dump-host.mjs'),'capacity']},project:f.project,mcpServers:{monotest:{url:'https://example.test/mcp'}}});
 assert.equal(collected.status,'unverified',JSON.stringify(collected));assert.equal(collected.hostFailure,true);assert.equal(collected.attempts.length,2);
 for(const attempt of collected.attempts){assert.equal(attempt.process.code,1);assert(fs.readFileSync(attempt.trace,'utf8').includes('Selected model is at capacity'));}
});
for(const final of ['passed','unverified'])test(`dump retries host failure once and retains both attempts: ${final}`,async t=>{
 const f=fixture(t);let calls=0;const seen=[];
 const result=await collectRecordDump({host:'claude',outputDir:path.join(f.dir,'retry'),project:f.project,mcpServers:{monotest:{url:'test'}}},async request=>{seen.push(request.outputDir);calls++;return calls===1||final==='unverified'?{status:'unverified',hostFailure:true,reason:'host unavailable'}:{status:'passed'};});
 assert.equal(calls,2);assert.equal(result.status,final);assert.notEqual(seen[0],seen[1]);assert.equal(result.attempts.length,2);
});
test('a real dump violation is failed and is never retried as host failure',async t=>{
 const f=fixture(t);let calls=0;
 const result=await collectRecordDump({host:'claude',outputDir:path.join(f.dir,'no-retry'),project:f.project,mcpServers:{monotest:{url:'test'}}},async()=>{calls++;return {status:'failed',reason:'record dump permits monotest reads only'};});
 assert.equal(calls,1);assert.equal(result.status,'failed');
});
test('retry cannot hide a write observed in a failed dump attempt',async t=>{
 const f=fixture(t);f.check();let calls=0;
 const result=await collectRecordDump({host:'claude',outputDir:path.join(f.dir,'bad-attempt'),project:f.project,mcpServers:{monotest:{url:'test'}}},async()=>{calls++;return {status:'unverified',hostFailure:true,trace:f.request.trace,reason:'host process failed'};});
 assert.equal(calls,1);assert.equal(result.status,'failed');assert.match(result.reason,/monotest reads only/);assert.equal(result.attempts.length,1);
});

function textFixture(t,host='claude',intent='agree') {
 const f=fixture(t),draft='Что: колонка Источник.',question='Утверждаем и начинаем Research?';
 f.request.host=host;
 const expected={id:'decision',stage:'idea',role:'approval',asksStart:true,summary:['Что:'],question,reply:intent==='correction'?'да, только добавь вопрос про Codex':intent==='defer'?'да, но позже':'принимаю',intent,outcome:{approval:true,startNext:intent!=='defer'}};
 expected.response=[intent==='correction'?'Добавлен вопрос про Codex.':'Утверждение записал.'];
 if(intent==='correction')expected.correction={description:'Добавлен вопрос про Codex.',before:'Источник.',after:'Источник. Вопрос про Codex.'};
 expected.response??=['Утверждение записал.'];f.request.expectedReplies=[expected];
 const approved=intent==='correction'?'Что: колонка Источник. Вопрос про Codex.':draft;
 f.record.body=`mono-test: approved\n${approved}\n\nВладелец: ответил «${expected.reply}»${expected.correction?'\nПоправка: '+expected.correction.description:''}`;
 f.page('comments','comments',[f.record]);f.page('documents','documents',[{id:'doc'}]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content:approved});
 const assistant=text=>host==='claude'?{type:'assistant',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}};
 const user=text=>host==='claude'?{type:'user',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}};
 const call=(id,name,input)=>host==='claude'?{type:'assistant',message:{content:[{type:'tool_use',id,name,input}]}}:{type:'response_item',payload:{type:'function_call',name,call_id:id,arguments:JSON.stringify(input)}};
 const result=(id,value)=>host==='claude'?{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(value)}]}}:{type:'response_item',payload:{type:'function_call_output',call_id:id,output:JSON.stringify(value)}};
 const terminal=host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 f.events.splice(0,f.events.length,assistant(draft+'\n'+question),terminal,user(expected.reply),call('read','mcp__monotest__get_document',{id:'doc'}),result('read',{id:'doc',content:approved}),call('write','mcp__monotest__create_comment',{projectId,body:f.record.body}),result('write',f.record),assistant(expected.correction?.description??'Утверждение записал.'));
 f.request.approvalBindings=[{recordId:'r1',replyId:'decision',shownLine:1,currentLine:4,text:draft}];
 f.request.expectedRecords=[{type:'mono-test',count:1}];
 f.request.nextSkill='mono:research';
 if(expected.outcome.startNext)f.events.splice(7,0,call('next','Skill',{skill:'mono:research'}));
 return {...f,expected,draft,approved,assistant,user,call,result,terminal};
}
for(const name of ['Skill','Agent','Task'])for(const route of ['absent','direct','literal'])test(`r8 diagnosis: Codex ${name} deferred start ${route}`,t=>{
 const f=textFixture(t,'codex','defer');f.request.nextAgent='mono-mono-research';
 const input=name==='Skill'?{skill:'mono:research'}:{subagent_type:'mono-mono-research'};
 if(route!=='absent')f.events.splice(7,0,f.call('next',name,input),f.result('next',{}));
 if(route==='literal'){
  f.events[7]={type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'next',input:`const r = await tools.${name}(${JSON.stringify(input)}); text(r);`}};
  f.events[8]={type:'response_item',payload:{type:'custom_tool_call_output',call_id:'next',output:'{}'}};
 }
 const r=f.check();assert.equal(r.status,route==='absent'?'passed':'failed',JSON.stringify(r));
});
for(const host of ['claude','codex'])for(const written of [true,false])test(`r8 diagnosis: ${host} declared approval requires actual bound write (${written})`,t=>{
 const f=textFixture(t,host,'defer');
 Object.assign(f.expected,{question:'Утверждаем эту версию?',asksStart:false,reply:'принимаю',intent:'agree',outcome:{approval:true,startNext:false}});
 f.record.body=`mono-test: approved\n${f.draft}\n\nВладелец: ответил «принимаю»`;f.page('comments','comments',[f.record]);
 f.events[0]=f.assistant(f.draft+'\n'+f.expected.question);f.events[2]=f.user(f.expected.reply);
 f.events[5]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[6]=f.result('write',f.record);
 if(!written){
  f.request.expectedRecords=[{type:'project'}];f.request.approvalBindings=[];f.page('comments','comments',[]);f.page('documents','documents',[]);
  f.events.splice(0,f.events.length,f.assistant(f.draft+'\n'+f.expected.question),f.terminal,f.user(f.expected.reply),f.assistant(f.expected.response[0]));
 }
 const r=f.check();assert.equal(r.status,written?'passed':'failed',JSON.stringify(r));
});
for(const name of ['Skill','Agent','Task'])for(const type of ['function_call','custom_tool_call'])test(`r8 literal arguments: Codex ${name} ${type} uses the same start authority and forbidden policy`,t=>{
 const f=textFixture(t,'codex');f.request.nextSkill='mono:discovery';f.request.nextAgent='mono-mono-discovery';
 Object.assign(f.expected,{stage:'research',role:'transition',question:'Начнём Discovery?',outcome:{approval:false,startNext:true},response:['Начинаю Discovery.']});
 f.request.expectedRecords=[{type:'project'}];f.request.approvalBindings=[];f.page('comments','comments',[]);f.page('documents','documents',[]);
 const input=name==='Skill'?{skill:'mono:discovery'}:{subagent_type:'mono-mono-discovery'};
 f.events.splice(0,f.events.length,f.assistant(f.draft+'\n'+f.expected.question),f.terminal,f.user(f.expected.reply),
  {type:'response_item',payload:{type,name:'exec',call_id:'next',[type==='function_call'?'arguments':'input']:`const r = await tools.${name}(${JSON.stringify(input)}); text(r);`}},
  {type:'response_item',payload:{type:type==='function_call'?'function_call_output':'custom_tool_call_output',call_id:'next',output:'{}'}},f.assistant(f.expected.response[0]));
 assert.equal(f.check().status,'passed','authorized literal start');
 Object.assign(f.expected,{intent:'defer',reply:'да, но позже',outcome:{approval:false,startNext:false}});f.events[2]=f.user(f.expected.reply);
 const deferred=f.check();assert.equal(deferred.status,'failed',JSON.stringify(deferred));assert.match(deferred.reason,/start-next-stage without scenario authority/);
 f.request.expectedRecords.push({forbidden:'start-next-stage'});
 const forbidden=f.check();assert.equal(forbidden.status,'failed',JSON.stringify(forbidden));assert.match(forbidden.reason,/forbidden start-next-stage/);
});
test('r8 literal arguments: unsupported stage payload cannot mask a foreign write',t=>{
 const f=textFixture(t,'codex','defer');f.request.expectedRecords.push({forbidden:'start-next-stage'});
 f.events.splice(7,0,{type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'next',input:'await tools.Skill(input);'}},
  {type:'response_item',payload:{type:'custom_tool_call_output',call_id:'next',output:'{}'}});
 assert.equal(f.check().status,'unverified','unsupported input remains unknown');
 f.events.splice(9,0,f.call('foreign','mcp__linear__save_project',{id:'foreign',status:'Discovery'}),f.result('foreign',{}));
 const r=f.check();assert.equal(r.status,'failed',JSON.stringify(r));assert.equal(r.stop,true);assert.match(r.reason,/outside monotest/);
});
for(const host of ['claude','codex'])for(const mode of ['full','fragment-record','fragment-binding-and-record','explicit-framing'])test(`r9 default framing: ${host} substring question anchor ${mode}`,t=>{
 const f=textFixture(t,host,'defer'),question=f.expected.question;
 f.expected.question='Research?';
 if(mode==='explicit-framing')f.expected.framing={before:'',after:'\n'+question};
 if(mode.startsWith('fragment')){
  const content='колонка';
  if(mode==='fragment-binding-and-record')f.request.approvalBindings[0].text=content;
  f.record.body=`mono-test: approved\n${content}\n\nВладелец: ответил «${f.expected.reply}»`;
  f.page('comments','comments',[f.record]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content});
  f.events[4]=f.result('read',{id:'doc',content});f.events[5]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[6]=f.result('write',f.record);
 }
 const r=f.check();assert.equal(r.status,mode.startsWith('fragment')?'failed':'passed',JSON.stringify(r));
});
for(const host of ['claude','codex'])for(const [part,content] of [['fragment','колонка'],['prefix','Что: колонка'],['suffix','Источник.']])for(const mode of ['binding-and-record','record-only'])test(`${host}: text approval rejects incomplete displayed artifact ${part} in ${mode}`,t=>{
 const f=textFixture(t,host);assert.equal(f.check().status,'passed');
 if(mode==='binding-and-record')f.request.approvalBindings[0].text=content;
 f.record.body=`mono-test: approved\n${content}\n\nВладелец: ответил «${f.expected.reply}»`;
 f.page('comments','comments',[f.record]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content});
 f.events[4]=f.result('read',{id:'doc',content});f.events[5]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[6]=f.result('write',f.record);
 const r=f.check();assert.equal(r.status,'failed',JSON.stringify(r));
});
for(const host of ['claude','codex'])test(`${host}: text approval excludes only preregistered literal framing`,t=>{
 const f=textFixture(t,host),before='Показанный итог:\n',after='\nСовет: проверить источник.\n'+f.expected.question;
 f.events[0]=f.assistant(before+f.draft+after);
 assert.equal(f.check().status,'failed','unlisted framing cannot hide extra shown content');
 f.expected.framing={before,after};assert.equal(f.check().status,'passed');
 f.events[0]=f.assistant(before+f.draft+' Дополнение.'+after);assert.equal(f.check().status,'failed');
});
for(const host of ['claude','codex'])for(const position of ['before-response','after-response','final-only','preparation'])test(`${host}: text records count completed tool-only parent turn ${position}`,t=>{
 const f=textFixture(t,host);assert.equal(f.check().status,'passed',f.check().reason);
 if(position==='before-response')f.events.splice(f.events.length-1,0,f.terminal);
 if(position==='after-response')f.events.push(f.terminal,f.call('extra','mcp__monotest__get_document',{id:'doc'}),f.result('extra',{id:'doc',content:f.approved}));
 if(position==='final-only')f.events.pop();
 if(position==='preparation'){
  f.events.unshift(f.call('prep','mcp__monotest__get_document',{id:'doc'}),f.result('prep',{id:'doc',content:f.approved}),f.terminal);
  f.request.stageStartLine=3;f.request.approvalBindings[0].shownLine+=3;f.request.approvalBindings[0].currentLine+=3;
 }
 const result=f.check();assert.equal(result.status,position==='preparation'?'passed':'failed',result.reason??JSON.stringify(result));
});
for(const host of ['claude','codex'])for(const after of ['$&','$$','$`',"$'"])test(`${host}: text records preserve literal replacement token ${after}`,t=>{
 const f=textFixture(t,host,'correction'),before='Источник.';
 Object.assign(f.expected.correction,{before,after,description:'Заменил фрагмент буквально.'});
 f.expected.reply='да, замени '+before+' на '+after;f.expected.response=[f.expected.correction.description];
 f.events[2]=f.user(f.expected.reply);f.events[f.events.length-1]=f.assistant(f.expected.correction.description);
 const persist=content=>{
  f.record.body=`mono-test: approved\n${content}\n\nВладелец: ответил «${f.expected.reply}»\nПоправка: ${f.expected.correction.description}`;
  f.page('comments','comments',[f.record]);f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content});
  f.events[4]=f.result('read',{id:'doc',content});f.events[5]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[6]=f.result('write',f.record);
 };
 persist('Что: колонка '+after);assert.equal(f.check().status,'passed',f.check().reason);
 persist(f.draft.replace(before,after));assert.equal(f.check().status,'failed');
});
for(const host of ['claude','codex'])for(const intent of ['agree','correction','defer'])test(`${host}: real text reply and shown plus only named correction pass (${intent})`,t=>{
 const f=textFixture(t,host,intent),r=f.check();assert.equal(r.status,'passed',r.reason);
});
for(const host of ['claude','codex'])for(const mode of ['forged-quote','wrong-question','no-reply','early-record','extra-change','deferred-start','clarification'])test(`${host}: text record rejects ${mode}`,t=>{
 const f=textFixture(t,host,mode==='extra-change'?'correction':mode==='deferred-start'?'defer':'agree');
 if(mode==='wrong-question')f.events[0]=f.assistant(f.draft+'\nДругой вопрос?');
 if(mode==='no-reply')f.events[2]=f.user('');
 if(mode==='early-record'){const write=f.events.splice(5,2);f.events.splice(2,0,...write);}
 if(mode==='clarification')Object.assign(f.expected,{role:'clarification',asksStart:false,outcome:{approval:false,startNext:false}});
 if(['forged-quote','extra-change'].includes(mode)){
  f.record.body=f.record.body.replace(mode==='forged-quote'?'«принимаю»':f.approved,mode==='forged-quote'?'«утверждаю»':f.approved+' Постороннее.');
  f.events[5]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[6]=f.result('write',f.record);f.page('comments','comments',[f.record]);
 }
 if(mode==='extra-change'){f.events[4]=f.result('read',{id:'doc',content:f.approved+' Постороннее.'});f.save('documents/doc.json',{id:'doc',projectId,title:'Draft',content:f.approved+' Постороннее.'});}
 if(mode==='deferred-start')f.events.push(f.call('next','Skill',{skill:'mono:research'}));
 f.request.nextSkill='mono:research';
 const r=f.check();assert.equal(r.status,'failed',r.reason);
});

for(const host of ['claude','codex'])for(const intent of ['question','continuation','unclear','refuse'])test(`${host}: ${intent} continues without approval; an approval is rejected`,t=>{
 const f=textFixture(t,host),reply={question:'а почему без Design?',continuation:'И ещё о колонке',unclear:'ну не знаю',refuse:'нет'}[intent];
 Object.assign(f.expected,{intent,reply,outcome:{approval:false,startNext:false},response:[intent==='unclear'?'Что смущает?':'Обсудим колонку.']});
 f.events.splice(2,f.events.length-2,f.user(reply),f.assistant(intent==='unclear'?'Что смущает?':'Обсудим колонку.'));
 f.page('comments','comments',[]);f.request.expectedRecords=[{type:'project'},{forbidden:'mono-test: approved'}];
 assert.equal(f.check().status,'passed',f.check().reason);
 f.events.splice(3,0,f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body}),f.result('write',f.record));f.page('comments','comments',[f.record]);
 assert.equal(f.check().status,'failed');
});

// Native persisted Idea content comes from the live window fixture; the text
// exchange and owner prose below are explicitly synthetic, not a new live run.
function textIdeaFixture(t,delegated=false) {
 const f=liveFixture(t,'idea-approve'),question='Утверждаем описание?',reply=delegated?'Принимаю: владелец ответил «принимаю». Причина: потребность проверяема.':'принимаю';
 const expected={id:'idea',stage:'idea',role:'approval',asksStart:false,summary:['## Что','## Неизвестные'],question,reply,intent:'agree',outcome:{approval:true,startNext:false},...(delegated?{by:'orchestrator',reason:'потребность проверяема.'}:{})};
 const fullVersion=f.request.approvalBindings[1].text,message=fullVersion+'\n'+question;
 const rewrite=value=>{
  if(typeof value==='string'){
   try{return JSON.stringify(rewrite(JSON.parse(value)));}catch{}
   if(value.includes('mono-idea: approved')){
    value=value.replace('by=owner','by='+(delegated?'orchestrator':'owner'));
    value+='\n\nВладелец: ответил «принимаю»'+(delegated?'\nby=orchestrator\nПричина: потребность проверяема.':'');
   }
   return value;
  }
  if(Array.isArray(value))return value.map(rewrite);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)]));
  return value;
 };
 let rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);
 rows[2]={type:'event_msg',payload:{type:'token_count'}};rows[3]={type:'event_msg',payload:{type:'token_count'}};
 rows[4].payload.content[0].text=message;rows[6].payload.content[0].text=reply;
 rows[7]={type:'event_msg',payload:{type:'token_count'}};rows[9]={type:'event_msg',payload:{type:'token_count'}};
 rows=rows.flatMap(row=>{const item=row.payload?.item;if(item?.type!=='McpToolCall')return [row];return [{type:'response_item',payload:{type:'function_call',name:`mcp__${item.server}__${item.tool}`,call_id:item.id,arguments:JSON.stringify(item.arguments)}},{type:'response_item',payload:{type:'function_call_output',call_id:item.id,output:JSON.stringify(item.result)}}];});
 rows.splice(rows.length-1,0,{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Утверждение записал.'}]}});
 const saveRows=(file,data,base)=>fs.writeFileSync(file,timed(data,base).map(JSON.stringify).join('\n')+'\n');
 saveRows(f.request.trace,rewrite(rows),'2026-11-02T04:00:01Z');
 const walk=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else if(file.endsWith('.json'))fs.writeFileSync(file,JSON.stringify(rewrite(JSON.parse(fs.readFileSync(file)))));}};
 walk(f.request.dumpDir);
 saveRows(f.request.dumpTrace,rewrite(fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse)),'2026-11-02T04:01:00Z');
 // The two native preparation terminals precede this synthetic stage exchange.
 f.request.stageStartLine=2;
 delete f.request.endLine;expected.response??=['Утверждение записал.'];f.request.expectedReplies=[expected];
 f.request.approvalBindings.forEach(b=>{delete b.windowCallId;b.replyId='idea';b.text=fullVersion;b.currentLine=rows.findIndex(row=>row.payload?.name===(b.recordId===f.request.project.id?'mcp__monotest__save_project':'mcp__monotest__save_comment'))+1;});
 if(delegated){
  const ownerTrace=path.join(f.dir,'owner.jsonl'),ownerExpected={...expected,by:'owner',reason:undefined,reply:'принимаю',response:['Передаю согласие этапу.']};
  const ownerRows=[{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:message}]}},{type:'event_msg',payload:{type:'task_complete'}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'принимаю'}]}},{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Передаю согласие этапу.'}]}},{type:'event_msg',payload:{type:'task_complete'}}];
  saveRows(ownerTrace,ownerRows,'2026-11-02T04:00:00Z');
  f.request.additionalTraces=[{host:'codex',trace:ownerTrace,expectedReplies:[ownerExpected]}];
  f.request.approvalBindings.forEach(b=>b.ownerEvidence={host:'codex',trace:ownerTrace,shownLine:1,replyLine:3,text:message,question,reply:'принимаю'});
 }
 return f;
}
for(const delegated of [false,true])test(`text Idea retains real machine gate and persisted version; orchestrator=${delegated}`,t=>{
 const f=textIdeaFixture(t,delegated),r=f.check();assert.equal(r.status,'passed',r.reason);assert.equal(r.gateResults[0].command,'verify');assert.equal(r.gateResults[0].result.ok,true);
 if(delegated){delete f.request.approvalBindings[1].ownerEvidence;assert.equal(f.check().status,'failed');}
});
for(const index of [0,1])test(`text Idea requires the complete four-section binding for record ${index}`,t=>{
 const f=textIdeaFixture(t),binding=f.request.approvalBindings[index];assert.equal(f.check().status,'passed');
 binding.text=binding.text.slice(0,binding.text.indexOf('\n\n## Неизвестные'));
 const result=f.check();assert.equal(result.status,'failed',result.reason);
});

function correctedIdeaFixture(t,passage='unknowns') {
 const f=textIdeaFixture(t),expected=f.request.expectedReplies[0],full=f.request.approvalBindings[1].text;
 const before=passage==='unknowns'?full.slice(full.indexOf('Какие значения источника')):'Источник читается сразу рядом с именем.';
 const after=before+' Проверить отображение в Codex.';
 Object.assign(expected,{question:{anchors:['описание']},presentation:'inline',driverStart:null,intent:'correction',reply:'да, только добавь проверку Codex',correction:{before,anchors:['Codex'],descriptionAnchors:['Codex']},response:{anchors:['запис','Codex'],question:false}});
 for(const binding of f.request.approvalBindings)binding.artifactEnd=full.length;
 f.request.rubricDefinition='Full Idea plus only the named Codex check; project body derived independently; same owner exchange and fixed approval outcome.';
 const rewrite=(value,key)=>{
  if(typeof value==='string'){
   try{return JSON.stringify(rewrite(JSON.parse(value)));}catch{}
   if(value.includes('mono-idea: approved'))return value.replace(full,full.replace(before,after)).replace(ideaFingerprint(full),ideaFingerprint(full.replace(before,after))).replace('Владелец: ответил «принимаю»',`Владелец: ответил «${expected.reply}»\nПоправка: добавлена проверка Codex.`);
   return key==='description'?value.replace(before,after):value;
  }
  if(Array.isArray(value))return value.map(v=>rewrite(v));
  return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,k)])):value;
 };
 const transform=(fn)=>{
  for(const file of [f.request.trace,f.request.dumpTrace]){
   const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse).map(row=>fn(row));
   fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');
  }
  const walk=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else if(file.endsWith('.json'))fs.writeFileSync(file,JSON.stringify(fn(JSON.parse(fs.readFileSync(file)))));}};
  walk(f.request.dumpDir);
 };
 transform(rewrite);
 const rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);
 rows.find(row=>row.payload?.type==='message'&&row.payload.role==='user').payload.content[0].text=expected.reply;
 rows.findLast(row=>row.payload?.type==='message'&&row.payload.role==='assistant').payload.content[0].text='Добавил проверку Codex. Утверждение записал.';
 fs.writeFileSync(f.request.trace,rows.map(JSON.stringify).join('\n')+'\n');
 const attest=()=>{
  delete f.request.rubric;
  const result=f.check();
  if(result.status==='unverified'&&result.rubricDigest)f.request.rubric={digest:result.rubricDigest,reviewer:'curated corrected Idea regression',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',evidence:'native record fixture plus named Codex check',reason:'Shown four sections plus only the declared addition; canonical project body and verbatim consent.'}))};
  return f.check();
 };
 return {...f,transform,attest,full,before,after};
}
function historicalCorrectedIdeaFixture(t,passage='unknowns') {
 const f=correctedIdeaFixture(t,passage),expected=f.request.expectedReplies[0];
 const native=fs.readFileSync('scripts/test-fixtures/skills-records-live/idea-approve/trace.jsonl','utf8').trim().split('\n').map(JSON.parse);
 const rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse),window=native[2].payload,questions=JSON.parse(window.arguments).questions;
 rows[2]=native[2];rows[3]=native[3];
 rows[6].payload.content[0].text='<send_user_message_question_reply>\n'+JSON.stringify(questions.map((q,i)=>({questionItemId:JSON.stringify(['request_user_input_async',window.call_id,i]),question:q.title,answer:expected.reply})))+'\n</send_user_message_question_reply>\n';
 fs.writeFileSync(f.request.trace,timed(rows,'2026-11-02T04:00:01Z').map(JSON.stringify).join('\n')+'\n');
 fs.writeFileSync(path.join(f.dir,'VERSION'),'0.42.0\n');fs.symlinkSync(path.resolve('scripts'),path.join(f.dir,'scripts'),'dir');
 f.request.packRoot=f.dir;f.request.testedVersion='0.42.0';delete f.request.expectedReplies;
 f.request.expectedWindows=[{...expected,decision:'Утверждаем',advice:'Совет',reason:'Research'}];
 f.request.windows=[{mode:'correction',text:expected.reply}];
 f.request.approvalBindings.forEach(b=>{delete b.replyId;b.windowCallId=window.call_id;});
 f.check=()=>verifyTextRecords(f.request);
 f.attest=()=>{
  delete f.request.rubric;const initial=f.check();
  if(initial.rubricDigest)f.request.rubric={digest:initial.rubricDigest,reviewer:'curated historical corrected Idea',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',evidence:'native window, fixed correction and revised Idea snapshot',reason:'Only the named Codex addition is authorized.'}))};
  return f.check();
 };
 return f;
}
for(const host of ['claude','codex'])test(`historical version rejects text-record metadata before authorization (${host})`,t=>{
 const f=u7DocumentFixture(t,host);f.attest();assert.equal(f.check().status,'passed');
 f.request.testedVersion='0.42.0';const result=verifyTextRecords({...f.request});
 assert.equal(result.status,'failed',JSON.stringify(result));assert.match(result.reason,/legacy acceptance requires real windows, not text replies/);
});
for(const passage of ['unknowns','result'])test(`historical corrected Idea validates the revised native approval snapshot (${passage})`,t=>{
 const f=historicalCorrectedIdeaFixture(t,passage),result=f.attest();
 assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.gateResults[0].result.ok,true);
 assert.deepEqual(result.requiredChecks.map(c=>[c.id,c.status]),[['records','passed'],['windows','passed'],['rubric','passed']]);
});
test('historical corrected Idea rejects a snapshot changed beyond the authorized correction',t=>{
 const f=historicalCorrectedIdeaFixture(t),approved=f.full.replace(f.before,f.after),changed=approved.replace('## Что\n','## Что\nПостороннее изменение.\n');
 const rewrite=value=>{
  if(typeof value==='string'){
   try{return JSON.stringify(rewrite(JSON.parse(value)));}catch{}
   return value.includes('mono-idea: approved')?value.replace(approved,changed).replace(ideaFingerprint(approved),ideaFingerprint(changed)):value;
  }
  if(Array.isArray(value))return value.map(rewrite);
  return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)])):value;
 };
 f.transform(rewrite);const result=f.attest();assert.equal(result.status,'failed',JSON.stringify(result));assert.match(result.reason,/change outside named passage/);
});
for(const passage of ['unknowns','result'])test(`continue5 corrected Idea uses its approval snapshot, not creation/currentLine (${passage})`,t=>{
 const f=correctedIdeaFixture(t,passage),result=f.attest();
 assert.equal(result.status,'passed',JSON.stringify(result));
 assert.equal(result.gateResults[0].result.ok,true);
});
for(const mode of ['forged-quote','extra-change','wrong-question','early-project','early-approval','approval-before-project','other-exchange','project-change','project-misses-correction','missing-snapshot'])test(`continue5 corrected Idea still rejects ${mode}`,t=>{
 const f=correctedIdeaFixture(t,mode==='project-misses-correction'?'result':'unknowns');
 if(['forged-quote','extra-change','project-change','project-misses-correction','missing-snapshot'].includes(mode)){
  const rewrite=(value,key)=>{
   if(typeof value==='string'){
    try{return JSON.stringify(rewrite(JSON.parse(value)));}catch{}
    if(mode==='project-change')return key==='description'?value+' Постороннее.':value;
    if(mode==='project-misses-correction')return key==='description'?value.replace(f.after,f.before):value;
    if(!value.includes('mono-idea: approved'))return value;
    if(mode==='forged-quote')return value.replace('«да, только добавь проверку Codex»','«принимаю»');
    if(mode==='missing-snapshot')return value.replace(/```mono-idea-snapshot[\s\S]*?```/,'');
    const approved=f.full.replace(f.before,f.after),changed=approved.replace('## Что\n','## Что\nПостороннее изменение.\n');
    return value.replace(approved,changed).replace(ideaFingerprint(approved),ideaFingerprint(changed));
   }
   if(Array.isArray(value))return value.map(v=>rewrite(v));
   return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,k)])):value;
  };
  f.transform(rewrite);
 }
 if(mode==='other-exchange')f.request.approvalBindings[1].replyId='another-exchange';
 if(['wrong-question','early-project','early-approval','approval-before-project'].includes(mode)){
  const rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);
  if(mode==='wrong-question')rows.find(row=>row.payload?.content?.[0]?.text?.startsWith(f.full)).payload.content[0].text=f.full+'\nКакой источник проверяем?';
  else if(mode==='approval-before-project') {
   const at=rows.findIndex(row=>row.payload?.name==='mcp__monotest__save_comment'),pair=rows.splice(at,2),project=rows.findIndex(row=>row.payload?.name==='mcp__monotest__save_project');
   rows.splice(project,0,...pair);
   f.request.approvalBindings.forEach(b=>b.currentLine=rows.findIndex(row=>row.payload?.name===(b.recordId===f.request.project.id?'mcp__monotest__save_project':'mcp__monotest__save_comment'))+1);
  }else {
   const name=mode==='early-project'?'mcp__monotest__save_project':'mcp__monotest__save_comment',at=rows.findIndex(row=>row.payload?.name===name),pair=rows.splice(at,2),reply=rows.findIndex(row=>row.payload?.role==='user');
   rows.splice(reply,0,...pair);
  }
  fs.writeFileSync(f.request.trace,timed(rows,'2026-11-02T04:00:01Z').map(JSON.stringify).join('\n')+'\n');
 }
 const result=f.attest();assert.equal(result.status,'failed',JSON.stringify(result));
 const reasons={'forged-quote':/verbatim owner reply/,'extra-change':/change outside named passage/,'wrong-question':/question lacks scenario anchors/,'early-project':/actual owner reply missing/,'early-approval':/actual owner reply missing/,'approval-before-project':/snapshot must follow consent/,'other-exchange':/same exchange required/,'project-change':/created project differs/,'project-misses-correction':/created project differs/,'missing-snapshot':/change outside named passage/};
 assert.match(result.reason,reasons[mode]);
});

function textPrdFixture(t,delegated=false) {
 const f=liveFixture(t,'discovery-approve'),team='fixture-team',binding=f.request.approvalBindings[0],question='Принимаем показанный PRD?',reply=delegated?'Принимаю PRD: причина — требования проверяемы.':'принимаю';
 const expected={id:'prd',stage:'discovery',role:'approval',asksStart:false,summary:['## Кратко','## Требования'],question,reply,intent:'agree',outcome:{approval:true,startNext:false},...(delegated?{by:'orchestrator',reason:'требования проверяемы.'}:{})};
 const transform=value=>{
  if(typeof value==='string'){
   try{return JSON.stringify(transform(JSON.parse(value)));}catch{}
   if(value.includes('mono-prd: approved'))return value.replace('by=owner','by='+(delegated?'orchestrator':'owner'))+'\n\nВладелец: ответил «'+reply+'»'+(delegated?'\nПричина: требования проверяемы.':'');
   return value;
  }
  if(Array.isArray(value))return value.map(transform);
  return value&&typeof value==='object'?{...Object.fromEntries(Object.entries(value).map(([k,v])=>[k,transform(v)])),...(value.uuid===f.request.project.id?{teams:[{id:team,name:'Fixture team'}]}:{})}:value;
 };
 const original=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse),rows=[],lineMap=new Map();
 for(const [i,row] of original.entries()){
  lineMap.set(i+1,rows.length+1);
  if(i+1===binding.shownLine)row.payload.content[0].text=binding.text+'\n'+question;
  if(i+1===32)row.payload.content[0].text=reply;
  if([28,29].includes(i+1)){rows.push({type:'event_msg',payload:{type:'token_count'}});continue;}
  const item=row.payload?.item;
  if(item?.type==='McpToolCall')rows.push({type:'response_item',payload:{type:'function_call',name:`mcp__${item.server}__${item.tool}`,call_id:item.id,arguments:JSON.stringify(item.arguments)}},{type:'response_item',payload:{type:'function_call_output',call_id:item.id,output:JSON.stringify(item.result)}});
  else rows.push(row);
 }
 rows.splice(rows.length-1,0,{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'PRD утверждён, старт отложен.'}]}});
 for(const key of ['shownLine','shownReadLine','currentLine'])binding[key]=lineMap.get(binding[key]);
 binding.replyId='prd';delete binding.windowCallId;
 f.request.stageStartLine=lineMap.get(18); // Successful preparation turn before the stage prompt.
 f.request.seedEndLine=lineMap.get(f.request.seedEndLine);delete f.request.endLine;expected.response=['PRD утверждён, старт отложен.'];f.request.expectedReplies=[expected];
 fs.writeFileSync(f.request.trace,timed(transform(rows),'2026-11-02T04:00:00Z').map(JSON.stringify).join('\n')+'\n');
 const walk=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else if(file.endsWith('.json'))fs.writeFileSync(file,JSON.stringify(transform(JSON.parse(fs.readFileSync(file)))));}};walk(f.request.dumpDir);
 const states=new Map();for(const entry of fs.readdirSync(path.join(f.request.dumpDir,'issues'))){const value=JSON.parse(JSON.parse(fs.readFileSync(path.join(f.request.dumpDir,'issues',entry,'issue.json'))).content[0].text);for(const row of value.stateHistory??[])states.set(row.state.id,row.state);}
 const statuses=[...states.values()];fs.mkdirSync(path.join(f.request.dumpDir,'statuses'),{recursive:true});fs.writeFileSync(path.join(f.request.dumpDir,'statuses',team+'.json'),JSON.stringify(statuses));
 const dumpRows=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse);dumpRows.splice(-1,0,{type:'response_item',payload:{type:'function_call',name:'mcp__monotest__list_issue_statuses',call_id:'fixed-statuses',arguments:JSON.stringify({team})}},{type:'response_item',payload:{type:'function_call_output',call_id:'fixed-statuses',output:JSON.stringify(statuses)}});fs.writeFileSync(f.request.dumpTrace,timed(transform(dumpRows),'2026-11-02T04:01:00Z').map(JSON.stringify).join('\n')+'\n');
 return f;
}
for(const delegated of [false,true])test(`text PRD binds updatedAt and native reads through real route gate; delegated=${delegated}`,t=>{
 const f=textPrdFixture(t,delegated),r=f.check();assert.equal(r.status,'passed',r.reason);assert.equal(r.gateResults[0].result.ok,true);
 if(delegated){f.request.expectedReplies[0].by='owner';assert.equal(f.check().status,'failed');}
});

for(const fields of ['paper=https://example.test/design','canvas=https://example.test/design tool=paper','canvas=https://example.test/design tool=wonder','canvas=https://example.test/design tool=figma','paper=https://example.test/old canvas=https://example.test/design tool=paper'])test(`design version binding shares the approval reader: ${fields}`,t=>{
 const f=textPrdFixture(t),valid=!fields.includes('figma')&&!fields.includes('/old');
 const transform=value=>{
  if(typeof value==='string'){
   try{return JSON.stringify(transform(JSON.parse(value)));}catch{}
   return value.replace(/mono-prd: approved project=(\S+) document=(\S+) updatedAt=(\S+) [^\n]+/g,(_,project,prd,stamp)=>`mono-design: approved project=${project} prd=${prd} prd-updatedAt=${stamp} ${fields} images=${'a'.repeat(64)} next=handoff by=owner`);
  }
  if(Array.isArray(value))return value.map(transform);
  return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,transform(v)])):value;
 };
 for(const file of [f.request.trace,f.request.dumpTrace])fs.writeFileSync(file,fs.readFileSync(file,'utf8').trim().split('\n').map(row=>JSON.stringify(transform(JSON.parse(row)))).join('\n')+'\n');
 const walk=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(fs.statSync(file).isDirectory())walk(file);else if(file.endsWith('.json'))fs.writeFileSync(file,JSON.stringify(transform(JSON.parse(fs.readFileSync(file)))));}};walk(f.request.dumpDir);
 f.request.expectedRecords=[{type:'mono-design: approved',count:1}];f.request.gates=[];f.request.expectedReplies[0].stage='design';
 const result=f.check();
 // This fixture intentionally lacks the PRD approval/PNG archive. A valid
 // version binding reaches the real design gate, which still refuses closure.
 assert.equal(result.status,'failed',JSON.stringify(result));
 assert.equal(result.gateResults.length,valid?1:0,JSON.stringify(result));
 if(valid){assert.equal(result.gateResults[0].command,'design');assert.equal(result.gateResults[0].result.ok,false);}
});

for(const host of ['claude','codex'])test(`${host}: Research authorizes only Discovery start, never an approval`,t=>{
 const f=textFixture(t,host),question='Начнём Discovery?';
 Object.assign(f.expected,{stage:'research',role:'transition',question,outcome:{approval:false,startNext:true},response:['Начинаю Discovery.']});
 f.project.status='Discovery';f.save('project.json',f.project);f.page('comments','comments',[]);f.request.expectedRecords=[{type:'project'},{forbidden:'mono-test: approved'}];
 f.events.splice(0,f.events.length,f.assistant(f.draft+'\n'+question),f.terminal,f.user('принимаю'),f.call('start','mcp__monotest__save_project',{id:projectId,status:'Discovery'}),f.result('start',f.project),f.assistant('Начинаю Discovery.'));
 assert.equal(f.check().status,'passed',f.check().reason);
 Object.assign(f.expected,{intent:'defer',reply:'да, но позже',outcome:{approval:false,startNext:false}});f.events[2]=f.user(f.expected.reply);assert.equal(f.check().status,'failed');
 f.events.splice(3,2);assert.equal(f.check().status,'passed',f.check().reason);
});

for(const host of ['claude','codex'])for(const route of ['project','Skill','Agent','Task'])for(const mode of ['forbidden-chain','single-stage','deferred-chain','authorized-chain','before-reply','wrong-source-stage','current-stage'])test(`${host}: per-exchange transition stage ${route} ${mode}`,t=>{
 const f=textFixture(t,host),research={id:'research',stage:'research',role:'transition',asksStart:true,summary:['Исследование:'],question:'Начнём Discovery?',reply:'принимаю',intent:'agree',outcome:{approval:false,startNext:true}},discovery={id:'discovery',stage:'discovery',role:'transition',asksStart:true,summary:['PRD:'],question:'Начнём Handoff?',reply:'да, но позже',intent:'defer',outcome:{approval:false,startNext:false},response:['Старт отложен.']};
 if(mode==='authorized-chain')Object.assign(discovery,{reply:'начинай',intent:'start',outcome:{approval:false,startNext:true},response:['Начинаю Handoff.']});
 f.request.expectedReplies=[research,discovery];f.request.expectedRecords=[{type:'project'}];f.request.approvalBindings=[];f.request.nextSkill='mono:discovery';f.request.nextAgent='mono-mono-discovery';
 f.page('comments','comments',[]);f.page('documents','documents',[]);f.project.status=mode==='deferred-chain'?'Discovery':'Handoff';f.save('project.json',f.project);
 const rows=[f.assistant('Исследование: источники изучены.\n'+research.question),f.terminal,f.user(research.reply),f.call('discovery','mcp__monotest__save_project',{id:projectId,status:'Discovery'}),f.result('discovery',{...f.project,status:'Discovery'}),f.assistant('PRD: колонка Источник.\n'+discovery.question),f.terminal,f.user(discovery.reply),f.call('handoff','mcp__monotest__save_project',{id:projectId,status:'Handoff'}),f.result('handoff',f.project),f.assistant(discovery.response[0])];
 if(route!=='project')for(const [index,stage] of [[3,'discovery'],[8,'handoff']])rows[index]=f.call(stage,route,route==='Skill'?{skill:`mono:${stage}`}:{subagent_type:`mono-mono-${stage}`});
 if(mode==='single-stage'){f.request.expectedReplies=[discovery];rows.splice(0,5);}
 if(mode==='deferred-chain')rows.splice(8,2);
 if(mode==='before-reply'){const start=rows.splice(8,2);rows.splice(7,0,...start);}
 if(mode==='wrong-source-stage'){
  research.response=['Начинаю Discovery.'];f.request.expectedReplies=[research];rows.splice(5,3);rows[rows.length-1]=f.assistant(research.response[0]);
 }
 if(mode==='current-stage'){
  Object.assign(research,{reply:'да, но позже',intent:'defer',outcome:{approval:false,startNext:false},response:['Остаюсь в Research.']});f.request.expectedReplies=[research];f.project.status='Research';f.save('project.json',f.project);
  rows.splice(0,rows.length,f.assistant('Исследование: источники изучены.\n'+research.question),f.terminal,f.user(research.reply),f.call('current',route==='project'?'mcp__monotest__save_project':route,route==='project'?{id:projectId,status:'Research'}:route==='Skill'?{skill:'mono:research'}:{subagent_type:'mono-mono-research'}),f.result('current',f.project),f.assistant(research.response[0]));
 }
 f.events.splice(0,f.events.length,...rows);const result=f.check();
 assert.equal(result.status,['deferred-chain','authorized-chain','current-stage'].includes(mode)?'passed':'failed',result.reason);
 if(['forbidden-chain','single-stage'].includes(mode))assert.match(result.reason,/start-next-stage without scenario authority/);
});

for(const type of ['function_call','custom_tool_call'])for(const field of ['status','state'])test(`text Codex literal exec ${type} ${field} preserves Discovery start authority`,t=>{
 const f=textFixture(t,'codex'),question='Начнём Discovery?',input={id:projectId,[field]:field==='state'?{name:'Discovery'}:'Discovery'};
 Object.assign(f.expected,{stage:'research',role:'transition',question,outcome:{approval:false,startNext:true},response:['Начинаю Discovery.']});
 f.project.status='Discovery';f.save('project.json',f.project);f.page('comments','comments',[]);f.request.expectedRecords=[{type:'project'},{forbidden:'mono-test: approved'}];
 f.events.splice(0,f.events.length,f.assistant(f.draft+'\n'+question),f.terminal,f.user('принимаю'),f.call('start','mcp__monotest__save_project',input),f.result('start',f.project),f.assistant('Начинаю Discovery.'));
 assert.equal(f.check().status,'passed','direct start control');
 const literal=`const r = await tools.mcp__monotest__save_project(${JSON.stringify(input)}); text(r);`;
 f.events[3]={type:'response_item',payload:{type,name:'exec',call_id:'start',[type==='function_call'?'arguments':'input']:literal}};
 f.events[4]={type:'response_item',payload:{type:type==='function_call'?'function_call_output':'custom_tool_call_output',call_id:'start',output:JSON.stringify(f.project)}};
 assert.equal(f.check().status,'passed','same start through supported literal route');
 Object.assign(f.expected,{intent:'defer',reply:'да, но позже',outcome:{approval:false,startNext:false}});f.events[2]=f.user(f.expected.reply);
 const rejected=f.check();assert.equal(rejected.status,'failed');assert.match(rejected.reason,/start-next-stage without scenario authority/);
 f.events[3]=f.call('start','mcp__monotest__save_project',input);f.events[4]=f.result('start',f.project);
 assert.equal(f.check().status,'failed','deferred direct start control');
});

for(const host of ['claude','codex'])test(`${host}: text child scout stays audited without inheriting the owner conversation`,async t=>{
 const f=textFixture(t,host),trace=path.join(f.dir,'scout.jsonl');assert.equal(f.check().status,'passed');
 const write=rows=>fs.writeFileSync(trace,timed(rows,'2026-11-02T04:00:00Z').map(JSON.stringify).join('\n')+'\n');
 write([f.call('scout-read','mcp__monotest__get_document',{id:'doc'}),f.result('scout-read',{id:'doc',content:f.approved}),f.assistant('Scout findings: the source column is missing.'),f.terminal]);
 f.request.additionalTraces=[{host,trace}];assert.equal(f.check().status,'passed','read-only scout is not an owner conversation');
 const bindingsFile=path.join(f.dir,'bindings.json');fs.writeFileSync(bindingsFile,JSON.stringify({approvalBindings:f.request.approvalBindings}));
 const wrapped=await verifyScenarioRecords({run:{trace:f.request.trace,auditedTraces:[f.request.trace,trace]},runRequest:{host,cwd:f.dir,context:{skillPrefix:'mono',projectName:f.project.name},scenario:{expectedReplies:f.request.expectedReplies},mcpServers:{monotest:{url:'test'}}},scenario:{next:'research',expectedRecords:f.request.expectedRecords},project:f.project,outputDir:path.join(f.dir,'unused'),bindingsFile},async()=>({status:'passed',trace:f.request.dumpTrace,dumpDir:f.dumpDir,auditedTraces:[f.request.dumpTrace]}));
 assert.equal(wrapped.status,'passed',wrapped.reason);
 f.request.additionalTraces[0].expectedReplies=f.request.expectedReplies;
 assert.equal(f.check().status,'failed','source-local expectations still govern that source');delete f.request.additionalTraces[0].expectedReplies;
 write([f.call('next','Skill',{skill:f.request.nextSkill}),f.terminal]);
 assert.equal(f.check().status,'failed','a scout without its own expectations cannot authorize a stage start');
 write([f.call('transition','mcp__monotest__save_project',{id:projectId,status:'Research'}),f.result('transition',{...f.project,status:'Research'}),f.terminal]);
 const transition=f.check();assert.equal(transition.status,'failed');assert.match(transition.reason,/start-next-stage without scenario authority/);
 write([f.assistant('Incomplete scout')]);assert.notEqual(f.check().status,'passed','child terminal still required');
 write([f.call('foreign','mcp__linear__save_project',{id:'foreign',status:'Discovery'}),f.result('foreign',{}),f.terminal]);
 assert.equal(f.check().status,'failed','child foreign writes still forbidden');
 const window=host==='claude'?'AskUserQuestion':'request_user_input';write([f.call('window',window,{}),f.result('window',{}),f.terminal]);
 assert.equal(f.check().status,'failed','child window still forbidden in text scenario');
});

for(const mode of ['wrong-triple','wrong-question','missing-owner','wrong-owner-words','owner-after-delegation'])test(`text Idea refuses broken relay: ${mode}`,t=>{
 const f=textIdeaFixture(t,true),binding=f.request.approvalBindings[1];
 if(mode==='wrong-triple')binding.ownerEvidence.text+=' invented';
 if(mode==='wrong-question')binding.ownerEvidence.question='Другой вопрос?';
 if(mode==='missing-owner')delete binding.ownerEvidence;
 if(mode==='wrong-owner-words')binding.ownerEvidence.reply='согласен';
 if(mode==='owner-after-delegation'){
  const file=binding.ownerEvidence.trace,rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);fs.writeFileSync(file,timed(rows,'2026-11-02T04:00:02Z').map(JSON.stringify).join('\n')+'\n');
 }
 assert.equal(f.check().status,'failed');
});

test('Handoff text start binds the shown package hash; defer cannot write that start',async t=>{
 const {createHash}=await import('node:crypto'),{unwrap}=await import('./skills-proof.mjs'),f=textPrdFixture(t),id=f.request.project.id;
 const body='Пакет: одна задача для показа источника прогона.',question='Начинаем работу по этому пакету?',reply='принимаю';
 const packet={id:'00000000-0000-4000-8000-000000000091',body,createdAt:'2026-11-02T03:59:00Z',updatedAt:'2026-11-02T03:59:00Z'};
 const start={id:'00000000-0000-4000-8000-000000000092',createdAt:'2026-11-02T03:59:01Z',updatedAt:'2026-11-02T03:59:01Z',body:`\`\`\`text\nmono-package: start project=${id} record=${packet.id} sha256=${createHash('sha256').update(body).digest('hex')} issues=T1:MON-1 by=owner\napproval_status=approved\n\`\`\`\n\nВладелец: ответил «${reply}»`};
 const commentsFile=path.join(f.request.dumpDir,'comments-1.json'),comments=unwrap(JSON.parse(fs.readFileSync(commentsFile)));comments.comments.unshift(start,packet);fs.writeFileSync(commentsFile,JSON.stringify(comments));
 const dumpRows=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse);
 for(const row of dumpRows){const item=row.payload?.item;if(item?.tool==='list_comments'&&item.arguments.projectId===id)item.result=comments;}
 fs.writeFileSync(f.request.dumpTrace,timed(dumpRows,'2026-11-02T04:01:00Z').map(JSON.stringify).join('\n')+'\n');
 const assistant=text=>({type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}}),terminal={type:'event_msg',payload:{type:'task_complete'}};
 const rows=[assistant(body+'\n'+question),terminal,{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:reply}]}},
  {type:'response_item',payload:{type:'function_call',name:'mcp__monotest__list_comments',call_id:'packet-read',arguments:JSON.stringify({projectId:id})}},
  {type:'response_item',payload:{type:'function_call_output',call_id:'packet-read',output:JSON.stringify({comments:[packet],hasNextPage:false})}},
  {type:'response_item',payload:{type:'function_call',name:'mcp__monotest__save_comment',call_id:'start',arguments:JSON.stringify({projectId:id,body:start.body})}},
  {type:'response_item',payload:{type:'function_call_output',call_id:'start',output:JSON.stringify(start)}},assistant('Старт работы записан.'),terminal];
 const expected={id:'handoff',stage:'handoff',role:'transition',asksStart:true,summary:['Пакет:'],question,reply,intent:'agree',outcome:{approval:false,startNext:true}};
 expected.response=['Старт работы записан.'];f.request.expectedReplies=[expected];f.request.expectedRecords=[{type:'mono-package: start',count:1}];f.request.approvalBindings=[{recordId:start.id,replyId:'handoff',shownLine:1,text:body,currentLine:4,currentRecordId:packet.id}];delete f.request.seedExpected;delete f.request.seedEndLine;delete f.request.seedProjectId;
 delete f.request.stageStartLine; // This replacement trace starts directly with Handoff.
 const flush=()=>fs.writeFileSync(f.request.trace,timed(rows,'2026-11-02T04:00:00Z').map(JSON.stringify).join('\n')+'\n');flush();
 const r=f.check();assert.equal(r.status,'passed',r.reason);
 const approvedStart=start.body;
 const persistStart=body=>{
  start.body=body;rows[5].payload.arguments=JSON.stringify({projectId:id,body});rows[6].payload.output=JSON.stringify(start);
  fs.writeFileSync(commentsFile,JSON.stringify(comments));
  fs.writeFileSync(f.request.dumpTrace,timed(dumpRows,'2026-11-02T04:01:00Z').map(JSON.stringify).join('\n')+'\n');flush();
 };
 persistStart(approvedStart.replace(createHash('sha256').update(body).digest('hex'),'0'.repeat(64)));
 const stalePackage=f.check();assert.equal(stalePackage.status,'failed');assert.match(stalePackage.reason,/shown content\/version/);
 persistStart(approvedStart);assert.equal(f.check().status,'passed');
 Object.assign(expected,{intent:'defer',reply:'да, но позже',outcome:{approval:false,startNext:false}});rows[2].payload.content[0].text=expected.reply;flush();const rejected=f.check();assert.equal(rejected.status,'failed');assert.match(rejected.reason,/start-next-stage without scenario authority/);
});

for(const host of ['claude','codex'])for(const sample of JSON.parse(fs.readFileSync('scripts/test-fixtures/skills-text-responses.json')))test(`${host}: record check enforces declared response ${sample.id}`,t=>{
 const f=textFixture(t,host);Object.assign(f.expected,{intent:sample.intent,reply:sample.reply,asksStart:false,outcome:{approval:sample.intent==='agree',startNext:false},response:sample.response});
 f.events.splice(7,f.events.length-7,f.assistant(sample.actual));f.events[2]=f.user(sample.reply);
 if(sample.intent!=='agree'){
  f.events.splice(3,4);f.page('comments','comments',[]);f.request.expectedRecords=[{type:'project'},{forbidden:'mono-test: approved'}];
 }
 const result=f.check();assert.equal(result.status,sample.status,result.reason);
});

for(const host of ['claude','codex'])test(`${host}: record checker reads extra completed response beyond endLine`,t=>{
 const f=textFixture(t,host);assert.equal(f.check().status,'passed',f.check().reason);
 f.expected.response.push('Start Research?');f.request.endLine=f.events.length+1;
 f.events.push(f.terminal,f.assistant('Start Research?'));
 const result=f.check();assert.equal(result.status,'failed',result.reason);assert.match(result.reason,/trailing/);
});

for(const host of ['claude','codex'])test(`${host}: record checker rejects undeclared extra native owner reply`,t=>{
 const f=textFixture(t,host);f.events.splice(3,0,f.user('Начинай Research'));const result=f.check();assert.equal(result.status,'failed');assert.match(result.reason,/unexpected owner reply/);
});

// Expected outcomes are declared before evaluating a host. Native completeness
// does not depend on whether this source owns a conversational reply policy.
const completenessMatrix = [
 ['completed',true,'passed','passed'],
 ['unfinished',false,'unverified','unverified'],
 ['tool-only',true,'failed','passed'],
 ['completed-then-assistant',false,'unverified','unverified'],
 ['completed-then-user',false,'unverified','unverified'],
 ['completed-then-tool',false,'unverified','unverified'],
 ['completed-then-tool-result',false,'unverified','unverified'],
 ['completed-then-thinking',false,'unverified','unverified'],
 ['completed-then-init',false,'unverified','unverified'],
 ['failed-terminal',false,'unverified','unverified'],
 ['informational-footer',true,'passed','passed'],
 ['nested-child-footer',true,'passed','passed'],
 ['codex-wrong-turn-terminal',false,'unverified','unverified'],
 ['codex-native-tool-tail',false,'unverified','unverified'],
 ['completed-then-failed-terminal',false,'unverified','unverified'],
 ['tool-only-unfinished',false,'unverified','unverified'],
 ['empty-final-text',true,'failed','passed'],
 ['nested-terminal-footer',true,'passed','passed'],
 ['claude-permission-tail',false,'unverified','unverified'],
 ['codex-stale-closed-turn',false,'unverified','unverified'],
 ['codex-message-event-tail',false,'unverified','unverified'],
];
for(const host of ['claude','codex'])for(const scope of ['main','scout'])for(const [shape,complete,mainStatus,scoutStatus] of completenessMatrix){
 if(shape.startsWith('codex-')&&host!=='codex'||shape.startsWith('claude-')&&host!=='claude')continue;
 test(`completeness matrix: ${host} ${scope} ${shape}`,async t=>{
  const {completedTrace,parentTurns}=await import('./skills-audit.mjs');
  const {probeText}=await import('./skills-probe.mjs'),{checkTrace}=await import('./test-fixtures/legacy-window-trace.mjs');
  const f=textFixture(t,host);assert.equal(f.check().status,'passed');
  const read=[f.call('matrix-read','mcp__monotest__get_document',{id:'doc'}),f.result('matrix-read',{id:'doc',content:f.approved})];
  const rows=structuredClone(scope==='main'?[...f.events,f.terminal]:[...read,f.assistant('Scout findings.'),f.terminal]);
  if(shape==='unfinished')rows.pop();
  if(shape==='tool-only')rows.splice(rows.length-2,1,f.call('matrix-final-read','mcp__monotest__get_document',{id:'doc'}),f.result('matrix-final-read',{id:'doc',content:f.approved}));
  if(shape==='completed-then-assistant')rows.push(f.assistant('Unfinished continuation.'));
  if(shape==='completed-then-user')rows.push(f.user('Continue'));
  if(shape==='completed-then-tool')rows.push(read[0]);
  if(shape==='completed-then-tool-result')rows.push(read[1]);
  if(shape==='completed-then-thinking')rows.push(host==='claude'?{type:'assistant',message:{content:[{type:'thinking',thinking:'Continuing'}]}}:{type:'response_item',payload:{type:'reasoning',summary:[]}});
  if(shape==='completed-then-init')rows.push(host==='claude'?{type:'system',subtype:'init'}:{type:'event_msg',payload:{type:'task_started',turn_id:'new'}});
  if(shape==='failed-terminal')rows[rows.length-1]=host==='claude'?{type:'result',subtype:'error_during_execution'}:{type:'event_msg',payload:{type:'turn_aborted'}};
  if(shape==='informational-footer')rows.push(host==='claude'?{type:'system',subtype:'thinking_tokens'}:{type:'event_msg',payload:{type:'task_summary'}});
  if(shape==='nested-child-footer')rows.push({...f.assistant('Nested activity belongs to its own trace.'),parent_tool_use_id:'nested'});
  if(shape==='codex-wrong-turn-terminal')rows.splice(rows.length-1,1,{type:'event_msg',payload:{type:'task_started',turn_id:'current'}},{type:'event_msg',payload:{type:'task_complete',turn_id:'stale'}});
  if(shape==='codex-native-tool-tail')rows.push({type:'event_msg',payload:{type:'item_completed',item:{type:'McpToolCall',id:'late',server:'monotest',tool:'get_document',arguments:{id:'doc'},status:'completed',result:{id:'doc',content:f.approved}}}});
  if(shape==='completed-then-failed-terminal')rows.push(host==='claude'?{type:'result',subtype:'error_during_execution'}:{type:'event_msg',payload:{type:'error'}});
  if(shape==='tool-only-unfinished')rows.splice(rows.length-2,2,...read);
  if(shape==='empty-final-text')rows[rows.length-2]=f.assistant('');
  if(shape==='nested-terminal-footer')rows.push({...f.terminal,parent_tool_use_id:'nested'});
  if(shape==='claude-permission-tail')rows.push({type:'control_request',request_id:'pending',request:{subtype:'can_use_tool',tool_name:'Read',input:{file_path:'doc'}}});
  if(shape==='codex-stale-closed-turn'){
   // A known ID is consumed by its terminal; it cannot close another turn.
   rows.push({type:'event_msg',payload:{type:'task_started',turn_id:'closed'}},f.assistant('Completed turn.'),{type:'event_msg',payload:{type:'task_complete',turn_id:'closed'}},f.assistant('Unfinished continuation.'),{type:'event_msg',payload:{type:'task_complete',turn_id:'closed'}});
  }
  if(shape==='codex-message-event-tail')rows.push({type:'event_msg',payload:{type:'agent_message',message:'Unfinished continuation.'}});
  const nativeRows=rows.map((value,i)=>({value,line:i+1}));
  assert.equal(completedTrace(host,nativeRows),complete,'shared session completeness');
  if(shape==='tool-only')assert.equal(parentTurns(host,nativeRows).at(-1).text,'','native tool-only turn retained');
  const trace=scope==='main'?f.request.trace:path.join(f.dir,'matrix-scout.jsonl');
  fs.writeFileSync(trace,timed(rows,'2026-11-02T04:00:00Z').map(JSON.stringify).join('\n')+'\n');
  if(scope==='scout')f.request.additionalTraces=[{host,trace}];
  const expected=scope==='main'?mainStatus:scoutStatus;
  const result=verifyRecords(f.request);assert.equal(result.status,expected,result.reason);
  if(scope==='main')for(const check of [probeText,checkTrace]){
   const result=check(f.request);assert.equal(result.status,expected,result.reason);
  }
 });
}

for(const order of ['start-before-user','user-before-start'])for(const mode of ['correct','forged-quote','wrong-question','no-reply','early-record'])test(`native Codex approval order: ${order} ${mode}`,async t=>{
 const {completedTrace,parentTurns}=await import('./skills-audit.mjs');
 const {probeText,textExchanges}=await import('./skills-probe.mjs'),{checkTrace}=await import('./test-fixtures/legacy-window-trace.mjs');
 const f=textFixture(t,'codex');
 if(mode==='wrong-question')f.events[0]=f.assistant(f.draft+'\nДругой вопрос?');
 if(mode==='no-reply')f.events.splice(2,1);
 if(mode==='early-record'){const write=f.events.splice(5,2);f.events.splice(2,0,...write);}
 if(mode==='forged-quote'){
  f.record.body=f.record.body.replace('«принимаю»','«утверждаю»');f.page('comments','comments',[f.record]);
  f.events[5]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[6]=f.result('write',f.record);
 }
 f.check(); // Populate the genuine fresh dump; evaluate our native trace below.
 const rows=[...f.events,f.terminal].map(e=>structuredClone(e));
 rows[1].payload.turn_id='offer';rows.at(-1).payload.turn_id='response';
 const start=id=>({type:'event_msg',payload:{type:'task_started',turn_id:id}});
 rows.unshift(start('offer'));
 const user=rows.findIndex(e=>e.payload?.type==='message'&&e.payload.role==='user');
 const continuation=user<0?3:user+(order==='user-before-start'?1:0);
 rows.splice(continuation,0,start('response'));
 f.request.approvalBindings[0].shownLine=rows.findIndex(e=>e.payload?.role==='assistant')+1;
 f.request.approvalBindings[0].currentLine=rows.findIndex(e=>e.payload?.call_id==='read'&&e.payload.type==='function_call')+1;
 fs.writeFileSync(f.request.trace,timed(rows,'2026-11-02T04:00:00Z').map(JSON.stringify).join('\n')+'\n');
 const native=rows.map((value,i)=>({value,line:i+1}));assert.equal(completedTrace('codex',native),true);
 const result=verifyRecords(f.request);assert.equal(result.status,mode==='correct'?'passed':'failed',JSON.stringify(result));
 // Only records owns quote/write chronology. Conversation readers still require
 // the exact actual answer on the shown question, in either native ordering.
 const conversationStatus=['correct','forged-quote'].includes(mode)?'passed':'failed';
 for(const check of [probeText,checkTrace])assert.equal(check(f.request).status,conversationStatus,check.name);
 if(mode==='correct'){
  const turns=parentTurns('codex',native);assert.equal(turns[0].reply,f.expected.reply);
  const exchanges=textExchanges('codex',native,f.request.expectedReplies);assert.equal(exchanges[0].reply,f.expected.reply);
 }
});

for(const scope of ['main','scout'])for(const mode of ['complete','unbound-terminal','raw-reasoning-tail'])test(`native completeness modes: ${scope} ${mode}`,async t=>{
 const {completedTrace}=await import('./skills-audit.mjs');
 const f=textFixture(t,'codex');assert.equal(f.check().status,'passed');
 const start=id=>({type:'event_msg',payload:{type:'task_started',turn_id:id}}),end=id=>({type:'event_msg',payload:{type:'task_complete',turn_id:id}});
 let rows;
 if(scope==='main'){
  rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);rows[1].payload.turn_id='offer';rows.unshift(start('offer'));
  f.request.approvalBindings[0].shownLine=2;f.request.approvalBindings[0].currentLine=5;
  if(mode!=='unbound-terminal'){rows.splice(3,0,start('response'));rows.at(-1).payload.turn_id='response';f.request.approvalBindings[0].currentLine++;}
 }else{
  rows=[start('scout'),f.assistant('Complete scout findings.'),end('scout')];
  if(mode==='unbound-terminal')rows.push(f.assistant('Unfinished scout continuation.'),{type:'event_msg',payload:{type:'task_complete'}});
 }
 if(mode==='raw-reasoning-tail')rows.push({type:'event_msg',payload:{type:'agent_reasoning_raw_content',text:'Unfinished native reasoning'}});
 const trace=scope==='main'?f.request.trace:path.join(f.dir,'native-scout.jsonl');fs.writeFileSync(trace,timed(rows,'2026-11-02T04:00:00Z').map(JSON.stringify).join('\n')+'\n');
 if(scope==='scout')f.request.additionalTraces=[{host:'codex',trace}];
 const result=verifyRecords(f.request),expected=mode==='complete'?'passed':'unverified';
 const native=rows.map((value,i)=>({value,line:i+1}));
 assert.equal(completedTrace('codex',native),mode==='complete');
 if(scope==='main'){
  const {probeText}=await import('./skills-probe.mjs'),{checkTrace}=await import('./test-fixtures/legacy-window-trace.mjs');
  for(const check of [probeText,checkTrace])assert.equal(check(f.request).status,expected,check.name);
 }
 assert.equal(result.status,expected,JSON.stringify(result));
});

function u7DocumentFixture(t,host='claude',intent='agree') {
 const f=textFixture(t,host,intent),url='https://linear.app/monotest/document/prd',shown='Что: колонка Источник.\nФильтр не входит.',approved=intent==='correction'?'Что: колонка Источник.\nФильтр и экспорт не входят.':shown;
 f.request.rubricDefinition='U7 fixed summary/question/response/correction rubric; expected outcome is immutable.';
 Object.assign(f.expected,{stage:'discovery',asksStart:false,question:{anchors:[['PRD','результат']],forbidden:['Design']},summary:['Источник'],presentation:'document',driverStart:null,response:{anchors:[['запис','утверд']],forbidden:['Design'],question:false},outcome:{approval:true,startNext:false}});
 if(intent==='correction')f.expected.correction={before:'Фильтр не входит.',anchors:['экспорт','не входят'],descriptionAnchors:['экспорт']};
 const old={id:'doc',projectId,title:'PRD',url,content:shown,updatedAt:date},fresh={...old,content:approved,updatedAt:'2026-11-01T00:00:00Z'};
 f.record.body=`mono-test: approved\n${approved}\n\nВладелец: ответил «${f.expected.reply}»${intent==='correction'?'\nПоправка: экспорт исключён.':''}`;
 f.page('comments','comments',[f.record]);f.save('documents/doc.json',fresh);
 f.events.splice(0,f.events.length,f.call('shown','mcp__monotest__get_document',{id:'doc'}),f.result('shown',old),f.assistant(`Источник после имени; советую одну колонку. [PRD](${url})\nПринимаем этот PRD?`),f.terminal,f.user(f.expected.reply),f.call('read','mcp__monotest__get_document',{id:'doc'}),f.result('read',fresh),f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body}),f.result('write',f.record),f.assistant(intent==='correction'?'Экспорт исключён. Утверждение записал.':'Утверждение PRD записал.'));
 f.request.approvalBindings=[{recordId:'r1',replyId:'decision',shownLine:3,shownReadLine:1,currentLine:6,text:shown}];
 const attest=(checks={})=>{
  delete f.request.rubric;const result=f.check();assert.equal(result.status,'unverified',JSON.stringify(result));assert.ok(result.rubricDigest,JSON.stringify(result));
  f.request.rubric={digest:result.rubricDigest,reviewer:'curated U7 fixture oracle',checks:['summary','question','response','correction'].map(id=>({id,status:checks[id]??'passed',evidence:`native fixture ${id}`,reason:'Compared the actual document, question role, fixed outcome and named correction.'}))};
 };
 return {...f,old,fresh,shown,approved,attest};
}
for(const host of ['claude','codex'])for(const intent of ['agree','correction'])test(`U7 ${host}: short native PRD summary, alternate wording and body-hash binding (${intent})`,t=>{
 const f=u7DocumentFixture(t,host,intent);f.attest();assert.equal(f.check().status,'passed',f.check().reason);
});
for(const host of ['claude','codex'])for(const mode of ['body-change','id-change','forged-quote','wrong-question','extra-turn','early-record','extra-change','stale-rubric','missing-rubric','summary-meaning','response-meaning','correction-meaning','unnamed-transition'])test(`U7 ${host}: rejects ${mode} while retaining valid anchors`,t=>{
 const f=u7DocumentFixture(t,host,mode.includes('correction')||mode==='extra-change'?'correction':'agree');
 if(mode==='body-change'){f.fresh.content+=' Mutation';f.events[6]=f.result('read',f.fresh);f.save('documents/doc.json',f.fresh);}
 if(mode==='id-change'){f.fresh.id='other';f.events[6]=f.result('read',f.fresh);}
 if(mode==='forged-quote'){f.record.body=f.record.body.replace('«принимаю»','«да»');f.events[7]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[8]=f.result('write',f.record);f.page('comments','comments',[f.record]);}
 if(mode==='wrong-question')f.events[2]=f.assistant(`Источник [PRD](${f.old.url})\nКак назовём PRD?`);
 if(mode==='extra-turn')f.events.push(f.terminal,f.assistant('Ещё ход.'));
 if(mode==='early-record'){const write=f.events.splice(7,2);f.events.splice(4,0,...write);}
 if(mode==='extra-change'){f.fresh.content='Лишнее. '+f.fresh.content;f.events[6]=f.result('read',f.fresh);f.save('documents/doc.json',f.fresh);}
 if(mode==='summary-meaning')f.events[2]=f.assistant(`Источник скрываем; советую это. [PRD](${f.old.url})\nПринимаем PRD?`);
 if(mode==='response-meaning')f.events[9]=f.assistant('Утверждение не записал.');
 if(mode==='correction-meaning')f.events[9]=f.assistant('Экспорт оставил, поправку не внёс, утверждение записал.');
 if(mode==='unnamed-transition')f.events[9]=f.assistant('Утверждение записал, приступаю к следующему этапу.');
 if(['summary-meaning','response-meaning','correction-meaning','unnamed-transition','wrong-question'].includes(mode))f.attest({[mode==='summary-meaning'?'summary':mode==='wrong-question'?'question':mode==='correction-meaning'?'correction':'response']:'failed'});
 if(mode==='stale-rubric'){f.attest();f.events[9]=f.assistant('PRD успешно записал.');}
 const result=f.check();assert.equal(result.status,['missing-rubric','stale-rubric'].includes(mode)?'unverified':'failed',JSON.stringify(result));
});

for(const host of ['claude','codex'])for(const mode of ['allowed','no-permission','no-signal','early','defer','clarification','delegated','wrong-project','prose-only'])test(`U7 ${host}: driver start requires permission and a post-reply native action (${mode})`,t=>{
 const f=u7DocumentFixture(t,host);
 Object.assign(f.expected,{stage:'research',role:'transition',question:{anchors:['Discovery']},asksStart:true,driverStart:['discovery'],outcome:{approval:false,startNext:true},response:{anchors:['Discovery'],forbidden:[],question:false}});
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[]);f.request.presentationBindings=f.request.approvalBindings;f.request.approvalBindings=[];f.request.nextSkill='mono:discovery';
 f.events[2]=f.assistant(`Источник [Исследование](${f.old.url})\nНачинаем Discovery?`);
 const input={stage:'discovery',projectId:mode==='wrong-project'?'foreign':projectId};
 const signal=[f.call('driver','mcp__stage_driver__start_stage',input),f.result('driver',{driverIntercepted:true,...input})];
 f.events.splice(7,2,...(['no-signal','prose-only','defer','clarification'].includes(mode)?[]:signal));
 f.events[f.events.length-1]=f.assistant('Перехватил старт Discovery для драйвера.');
 if(mode==='no-permission')f.expected.driverStart=null;
 if(mode==='early'){f.events.splice(7,2);f.events.splice(4,0,...signal);}
 if(['defer','clarification','delegated'].includes(mode)){
  f.expected.outcome.startNext=false;f.expected.driverStart=null;
  if(mode==='defer'){f.expected.intent='defer';f.expected.reply='да, но позже';}
  if(mode==='clarification'){f.expected.role='clarification';f.expected.asksStart=false;}
  if(mode==='delegated'){f.expected.by='orchestrator';f.expected.reason='фактов достаточно';f.expected.reply='принимаю: фактов достаточно';}
  f.events[4]=f.user(f.expected.reply);
  f.events[f.events.length-1]=f.assistant('Discovery оставил на потом.');
 }
 if(['allowed','defer','clarification'].includes(mode)){f.attest();const result=f.check();assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.starts.length,mode==='allowed'?1:0);}
 else assert.equal(f.check().status,'failed',JSON.stringify(f.check()));
});

for(const host of ['claude','codex'])test(`U7 ${host}: explicit forbidden-start rule includes the driver control tool`,t=>{
 const f=u7DocumentFixture(t,host);
 f.request.expectedRecords.push({forbidden:'start-next-stage'});
 f.events.splice(7,0,f.call('driver','mcp__stage_driver__start_stage',{stage:'design',projectId}),f.result('driver',{driverIntercepted:true,stage:'design',projectId}));
 const r=f.check();assert.equal(r.status,'failed',JSON.stringify(r));assert.match(r.reason,/forbidden start-next-stage/);
});

for(const mode of ['complete','fragment'])test(`U7 inline Idea binds the full artifact before varying advice (${mode})`,t=>{
 const f=textIdeaFixture(t),expected=f.request.expectedReplies[0],full=f.request.approvalBindings[1].text;
 Object.assign(expected,{question:{anchors:['описание']},presentation:'inline',driverStart:null,response:{anchors:['запис'],question:false}});
 f.request.rubricDefinition='Full four-section Idea, role, fixed outcome and no hidden correction.';
 const rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);
 const shown=rows.find(row=>row.payload?.type==='message'&&row.payload.role==='assistant'&&row.payload.content?.[0]?.text.startsWith(full));
 shown.payload.content[0].text=full+'\nСоветую исследовать ограничения.\nУтверждаем описание?';
 for(const b of f.request.approvalBindings){b.artifactEnd=full.length;if(mode==='fragment'){b.text=full.slice(0,full.indexOf('## Неизвестные'));b.artifactEnd=b.text.length;}}
 fs.writeFileSync(f.request.trace,rows.map(JSON.stringify).join('\n')+'\n');
 let result=f.check();
 if(mode==='fragment'){assert.equal(result.status,'failed',JSON.stringify(result));return;}
 assert.equal(result.status,'unverified',JSON.stringify(result));assert.ok(result.rubricDigest);
 f.request.rubric={digest:result.rubricDigest,reviewer:'curated full Idea control',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',evidence:'native Idea fixture and canonical gate',reason:'Full artifact is identical; only unapproved advice varies outside it.'}))};
 result=f.check();assert.equal(result.status,'passed',JSON.stringify(result));
});

for(const host of ['claude','codex'])test(`U7 ${host}: correction with valid anchors but opposite document meaning fails rubric`,t=>{
 const f=u7DocumentFixture(t,host,'correction');
 const changed='Что: колонка Источник.\nФильтр и экспорт не входят в исключения: они включены в результат.';
 f.fresh.content=changed;f.save('documents/doc.json',f.fresh);f.events[6]=f.result('read',f.fresh);
 f.record.body=`mono-test: approved\n${changed}\n\nВладелец: ответил «${f.expected.reply}»\nПоправка: экспорт включён.`;
 f.page('comments','comments',[f.record]);f.events[7]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[8]=f.result('write',f.record);
 f.attest({correction:'failed'});const result=f.check();assert.equal(result.status,'failed',JSON.stringify(result));assert.equal(result.reason,'scenario rubric failed');
});

for(const host of ['claude','codex'])for(const lookup of ['doc','prd-source-slug'])test(`continue1 ${host}: native document identity comes from response (${lookup})`,t=>{
 const f=u7DocumentFixture(t,host);
 f.events[0]=f.call('shown','mcp__monotest__get_document',{id:lookup});
 f.events[5]=f.call('read','mcp__monotest__get_document',{id:lookup});
 f.attest();assert.equal(f.check().status,'passed',f.check().reason);
 f.fresh.id='different-document';f.events[6]=f.result('read',f.fresh);
 const changed=f.check();assert.equal(changed.status,'failed');assert.match(changed.reason,/document changed/);
});

for(const host of ['claude','codex'])for(const mode of ['passed','unverified','failed','trace-change','dump-change','digest-change','bindings-change','extra-dump-file'])test(`continue3 ${host}: saved native review ${mode}`,async t=>{
 const f=u7DocumentFixture(t,host);f.attest();const rubric=f.request.rubric;delete f.request.rubric;
 const bindingsFile=path.join(f.dir,'review.json');
 fs.writeFileSync(bindingsFile,JSON.stringify({approvalBindings:f.request.approvalBindings}));
 let collections=0;
 const input={run:{trace:f.request.trace},runRequest:{host,cwd:f.dir,packRoot:process.cwd(),context:{skillPrefix:'mono',projectName:f.project.name},scenario:{expectedReplies:f.request.expectedReplies,rubricDefinition:f.request.rubricDefinition},mcpServers:{monotest:{url:'test'}}},scenario:{next:'handoff',expectedRecords:f.request.expectedRecords},project:f.project,outputDir:path.join(f.dir,'review-capture'),bindingsFile};
 const collect=async()=>{collections++;return {status:'passed',trace:f.request.dumpTrace,dumpDir:f.dumpDir};};
 const initial=await verifyTextScenarioRecords(input,collect);
 assert.equal(initial.status,'unverified',JSON.stringify(initial));assert.equal(initial.rubricDigest,rubric.digest);
 assert.ok(fs.existsSync(initial.reviewEvidence));
 const review={...rubric,checks:rubric.checks.map(c=>({...c,status:['failed','unverified'].includes(mode)?mode:'passed'}))};
 const bindings={approvalBindings:f.request.approvalBindings,rubric:review};
 if(mode==='trace-change')fs.appendFileSync(f.request.trace,'\n');
 if(mode==='dump-change')f.save('project.json',{...f.project,description:'changed'});
 if(mode==='extra-dump-file')f.save('extra.json',{unexpected:'data'});
 if(mode==='digest-change'){
  const saved=JSON.parse(fs.readFileSync(initial.reviewEvidence));saved.rubricDigest='b'.repeat(64);fs.writeFileSync(initial.reviewEvidence,JSON.stringify(saved));
 }
 if(mode==='bindings-change')bindings.approvalBindings=[{...f.request.approvalBindings[0],text:'different document'}];
 fs.writeFileSync(bindingsFile,JSON.stringify(bindings));
 const resume=()=>verifyTextScenarioRecords({...input,resumeEvidence:initial.reviewEvidence},()=>{throw Error('resume must not collect another dump');});
 if(mode.includes('change')||mode==='extra-dump-file')await assert.rejects(resume,/saved (evidence|bindings|rubric digest) changed/);
 else {
  const resumed=await resume();assert.equal(resumed.status,mode,JSON.stringify(resumed));assert.equal(resumed.rubricDigest,initial.rubricDigest);
  assert.deepEqual(resumed.rubricInput,initial.rubricInput,'same native evidence, records and dump are reviewed');
 }
 assert.equal(collections,1);
});

for(const host of ['claude','codex'])test(`continue3 ${host}: annotate saved native bindings before rubric review without rerun`,async t=>{
 const f=u7DocumentFixture(t,host);f.check();const bindingsFile=path.join(f.dir,'annotations.json');
 const input={run:{trace:f.request.trace},runRequest:{host,cwd:f.dir,packRoot:process.cwd(),context:{skillPrefix:'mono',projectName:f.project.name},scenario:{expectedReplies:f.request.expectedReplies,rubricDefinition:f.request.rubricDefinition},mcpServers:{monotest:{url:'test'}}},scenario:{next:'handoff',expectedRecords:f.request.expectedRecords},project:f.project,outputDir:path.join(f.dir,'unannotated')};
 const initial=await verifyTextScenarioRecords(input,async()=>({status:'passed',trace:f.request.dumpTrace,dumpDir:f.dumpDir}));
 assert.equal(initial.status,'failed',JSON.stringify(initial));assert.match(initial.reason,/expected approval missing actual record bound to shown version/);assert.equal(initial.rubricDigest,undefined);
 fs.writeFileSync(bindingsFile,JSON.stringify({approvalBindings:f.request.approvalBindings}));
 const noCollect=()=>{throw Error('review preparation/resume must reuse the saved dump');};
 const prepared=await verifyTextScenarioRecords({...input,resumeEvidence:initial.reviewEvidence,bindingsFile,prepareReview:true},noCollect);
 assert.equal(prepared.status,'unverified');assert.ok(prepared.rubricDigest);
 const rubric={digest:prepared.rubricDigest,reviewer:'native saved-evidence fixture',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',evidence:'same saved native document and trace',reason:'Compared the fixed scenario, artifact, question, reply and write.'}))};
 fs.writeFileSync(bindingsFile,JSON.stringify({approvalBindings:f.request.approvalBindings,rubric}));
 const resumed=await verifyTextScenarioRecords({...input,resumeEvidence:prepared.reviewEvidence,bindingsFile},noCollect);
 assert.equal(resumed.status,'passed',JSON.stringify(resumed));assert.equal(resumed.rubricDigest,prepared.rubricDigest);
});

for(const host of ['claude','codex'])test(`MONO-357 ${host}: relative link wrappers preserve targets and opaque code`,t=>{
 const f=textFixture(t,host,'defer'),content='[README](README.md) and [code](cli/runs.mjs#source)\n\n```text\n[raw](<README.md>)\n```';
 const doc={id:'brief',projectId,title:'Brief',content};
 f.events.splice(7,0,f.call('brief','mcp__monotest__save_document',{projectId,title:doc.title,content}),f.result('brief',doc));
 f.page('documents','documents',[{id:'doc'},{id:'brief'}]);
 const stored=content.replace('[README](README.md)','[README](<README.md>)').replace('[code](cli/runs.mjs#source)','[code](<cli/runs.mjs#source>)');
 f.save('documents/brief.json',{...doc,content:stored});
 assert.equal(f.check().status,'passed',f.check().reason);
 f.save('documents/brief.json',{...doc,content:stored.replace('<cli/runs.mjs#source>','<cli/other.mjs#source>')});
 assert.equal(f.check().status,'failed');
 f.save('documents/brief.json',{...doc,content:stored.replace('[raw](<README.md>)','[raw](README.md)')});
 assert.equal(f.check().status,'failed');
});

for(const host of ['claude','codex'])test(`MONO-357 ${host}: content write followed by patch uses the full native intermediate read`,t=>{
 const f=textFixture(t,host,'defer'),content='[README](README.md)\nСсылка согласия ожидается.\nДругая ссылка ожидается.';
 const stored=content.replace('(README.md)','(<README.md>)'),doc={id:'brief',projectId,title:'Brief'},truncated={...doc,content:'Brief… (truncated, use `get_document` for full description)'};
 const patch=[{op:'replace',old_string:'[README](<README.md>)\nСсылка согласия ожидается.',new_string:'[README](README.md)\n[Согласие](https://linear.app/monotest/project/test#comment-r1)'},{op:'replace',old_string:'Другая ссылка ожидается.',new_string:'Literal $& replacement.'}];
 const final='[README](<README.md>)\n[Согласие](<https://linear.app/monotest/project/test#comment-r1>)\nLiteral $& replacement.';
 f.events.splice(7,0,f.call('brief','mcp__monotest__save_document',{projectId,title:doc.title,content}),f.result('brief',truncated),f.call('brief-read','mcp__monotest__get_document',{id:'brief'}),f.result('brief-read',{...doc,content:stored}),f.call('patch','mcp__monotest__save_document',{id:'brief',patch}),f.result('patch',truncated));
 f.page('documents','documents',[{id:'doc'},{id:'brief'}]);f.save('documents/brief.json',{...doc,content:final});
 assert.equal(f.check().status,'passed',f.check().reason);
 f.save('documents/brief.json',{...doc,content:stored});assert.equal(f.check().status,'failed');
 f.save('documents/brief.json',{...doc,content:final});f.events[12]=f.result('patch',{...doc,content:'incorrect patch result'});assert.equal(f.check().status,'failed');
});

for(const host of ['claude','codex'])for(const state of ['missing','ambiguous'])test(`MONO-357 ${host}: patch ${state} old_string fails closed`,t=>{
 const f=textFixture(t,host,'defer'),content=state==='missing'?'No placeholder.':'Expected link. Expected link.',doc={id:'brief',projectId,title:'Brief',content};
 const final={...doc,content:'Claims success.'};
 f.events.splice(7,0,f.call('brief','mcp__monotest__save_document',{projectId,title:doc.title,content}),f.result('brief',doc),f.call('patch','mcp__monotest__save_document',{id:'brief',patch:[{op:'replace',old_string:'Expected link.',new_string:final.content}]}),f.result('patch',final));
 f.page('documents','documents',[{id:'doc'},{id:'brief'}]);f.save('documents/brief.json',final);
 const result=f.check();assert.notEqual(result.status,'passed');assert.match(result.reason,/patch.*(?:missing|ambiguous|exactly once)/);
});

for(const host of ['claude','codex'])test(`MONO-357 ${host}: wrapper normalization keeps link titles and unsafe destinations distinct`,t=>{
 const f=textFixture(t,host,'defer'),doc={id:'brief',projectId,title:'Brief'};
 f.page('documents','documents',[{id:'doc'},{id:'brief'}]);
 const check=(content,stored)=>{
  f.events.splice(7,f.events.length-8,f.call('brief','mcp__monotest__save_document',{projectId,title:doc.title,content}),f.result('brief',{...doc,content}));
  f.save('documents/brief.json',{...doc,content:stored});return f.check();
 };
 for(const target of ['README.md','cli/runs.mjs#source','mailto:owner@example.com','custom:relative','https://example.com/a']){
  const result=check(`[source](${target})`,`[source](<${target}>)`);assert.equal(result.status,'passed',result.reason);
 }
 for(const target of ['README.md "v1"','README file.md','README.md\t"v1"','file(name','file)name']){
  const result=check(`[source](${target})`,`[source](<${target}>)`);assert.equal(result.status,'failed',`unsafe destination ${JSON.stringify(target)} was treated as equivalent`);assert.match(result.reason,/mismatch/);
 }
});

function patchFirstFixture(t,host){
 const f=textFixture(t,host,'defer'),doc={id:'brief',projectId,title:'Brief',content:'Expected link.\nKeep this paragraph.'},final={id:'brief',projectId,title:'Brief',content:'Approval link.\nKeep this paragraph.'};
 const patch={id:'brief',patch:[{op:'replace',old_string:'Expected link.',new_string:'Approval link.'}]};
 const truncated={...doc,content:'Brief… (truncated, use `get_document` for full description)'};
 f.events.splice(7,0,f.call('patch','mcp__monotest__save_document',patch),f.result('patch',truncated));
 f.page('documents','documents',[{id:'doc'},{id:'brief'}]);f.save('documents/brief.json',final);
 return {...f,doc,final};
}
function nativeMcpEvents(id,tool,input,value,bound=true){
 return [
  {type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'outer-'+id,input:bound?`const r = await tools.mcp__monotest__${tool}(${JSON.stringify(input)}); text(r);`:`text(await tools.mcp__monotest__${tool}(${JSON.stringify(input)}));`}},
  {type:'event_msg',payload:{type:'item_completed',item:{type:'McpToolCall',id,server:'monotest',tool,arguments:input,status:'completed',result:value}}},
  {type:'response_item',payload:{type:'custom_tool_call_output',call_id:'outer-'+id,output:JSON.stringify(value)}}
 ];
}

// Trace-derived Codex Idea defer: one patch fills four approval references.
function nativeReplaceAllBriefFixture(t,missing=false){
 const f=textFixture(t,'codex','defer'),link='https://linear.app/monotest/project/test#comment-r1';
 const content=[
  '## Суть сейчас','Сохраняем вводные проекта.','',
  '## Как это видит владелец','05.11.2026, Idea: мысль владельца; причина: сохранить смысл; ожидается ссылка','',
  '## Решения и повороты','05.11.2026, Idea: описание утверждено; причина: согласие владельца; ожидается ссылка','',
  '## Что знаем','05.11.2026, Idea: вводные собраны; причина: разговор; ожидается ссылка','',
  '## Отброшено','05.11.2026, Idea: прежняя формулировка; причина: новое согласие; ожидается ссылка','',
  '```mono-brief',JSON.stringify({project:projectId}),'```'
 ].join('\n');
 const expected=[
  '## Суть сейчас','Сохраняем вводные проекта.','',
  '## Как это видит владелец','05.11.2026, Idea: мысль владельца; причина: сохранить смысл; '+link,'',
  '## Решения и повороты','05.11.2026, Idea: описание утверждено; причина: согласие владельца; '+link,'',
  '## Что знаем','05.11.2026, Idea: вводные собраны; причина: разговор; '+link,'',
  '## Отброшено','05.11.2026, Idea: прежняя формулировка; причина: новое согласие; '+link,'',
  '```mono-brief',JSON.stringify({project:projectId}),'```'
 ].join('\n');
 const doc={id:'brief',projectId,title:'Brief',content};
 const truncated={...doc,content:'Brief… (truncated, use `get_document` for full description)'};
 const patch={id:'brief',patch:[{op:'replace',old_string:missing?'нет такой отметки':'ожидается ссылка',new_string:link,replace_all:true}]};
 f.request.expectedRecords.push({type:'mono-brief',count:1});
 f.events.splice(7,0,
  ...nativeMcpEvents('brief-create','save_document',{projectId,title:doc.title,content},truncated),
  ...nativeMcpEvents('brief-read','get_document',{id:'brief'},doc),
  ...nativeMcpEvents('brief-patch','save_document',patch,truncated));
 f.events.unshift({type:'session_meta',payload:{id:'native-replace-all-session'}});
 for(const binding of f.request.approvalBindings){binding.shownLine++;binding.currentLine++;}
 f.page('documents','documents',[{id:'doc'},{id:'brief'}]);
 f.save('documents/brief.json',{...doc,content:missing?content:expected});
 return f;
}
test('MONO-357 codex Idea defer replace_all resolves every approval marker and verifies the brief',t=>{
 const f=nativeReplaceAllBriefFixture(t),result=f.check();
 assert.equal(result.status,'passed',result.reason);
});
test('MONO-357 codex Idea defer replace_all with zero matches fails closed',t=>{
 const result=nativeReplaceAllBriefFixture(t,true).check();
 assert.equal(result.status,'failed',result.reason);
 assert.match(result.reason,/document patch old_string must match at least once/);
});

function nativePatchFirstFixture(t,state='sequential'){
 const f=patchFirstFixture(t,'codex'),patch={id:'brief',patch:[{op:'replace',old_string:'Expected link.',new_string:'Approval link.'}]};
 const prior=(id='prior',value=f.doc,bound=true)=>nativeMcpEvents(id,'get_document',{id:value.id},value,bound);
 let reads=prior();
 if(state==='latest')reads=[...prior('older',{...f.doc,content:'Stale content.'}),...reads];
 if(state==='missing')reads=[];
 if(state==='foreign')reads=prior('prior',{...f.doc,id:'other-document'});
 if(state==='elided')reads=prior('prior',{...f.doc,content:'Brief… (truncated, use `get_document` for full description)'});
 if(state==='unbound-read')reads=[...prior('older'),...prior('prior',f.doc,false)];
 if(state==='overlapping'){
  const a=prior('first'),b=prior('second');reads=[a[0],b[0],a[1],b[1],a[2],b[2]];
 }
 if(['missing-anchor','ambiguous-anchor'].includes(state))reads=prior('prior',{...f.doc,content:state==='missing-anchor'?'No placeholder.':'Expected link. Expected link.'});
 const write=nativeMcpEvents('patch','save_document',patch,{...f.doc,content:'Brief… (truncated, use `get_document` for full description)'},state!=='unbound-patch');
 const rows=state==='late'?[write[0],...reads,write[1],write[2]]:[...reads,...write];
 f.events.splice(7,2,...rows);f.events.unshift({type:'session_meta',payload:{id:'native-patch-session'}});
 for(const binding of f.request.approvalBindings){binding.shownLine++;binding.currentLine++;}
 return f;
}
for(const state of ['sequential','latest'])test(`MONO-357 native MCP completion patch-first accepts ${state} read order`,t=>{
 const f=nativePatchFirstFixture(t,state),result=f.check();assert.equal(result.status,'passed',result.reason);
 f.save('documents/brief.json',{...f.final,content:'Approval link.\nChanged paragraph.'});assert.equal(f.check().status,'failed');
});
for(const state of ['missing','foreign','elided','late','overlapping','unbound-read','unbound-patch'])test(`MONO-357 native MCP completion patch-first rejects ${state} read order`,t=>{
 const result=nativePatchFirstFixture(t,state).check();assert.equal(result.status,'unverified');assert.match(result.reason,/patch.*(?:prior content|read ordering)/);
});
for(const state of ['missing-anchor','ambiguous-anchor'])test(`MONO-357 native MCP completion patch-first refuses ${state}`,t=>{
 const result=nativePatchFirstFixture(t,state).check();assert.notEqual(result.status,'passed');assert.match(result.reason,/patch.*exactly once/);
});
for(const state of ['open-unbound','missing-output','closed-unbound'])test(`MONO-357 mixed native patch ownership: ${state}`,t=>{
 const f=nativePatchFirstFixture(t),patch={id:'brief',patch:[{op:'replace',old_string:'Expected link.',new_string:'Approval link.'}]};
 const competing=nativeMcpEvents('competing','save_document',state==='closed-unbound'?{id:'brief',content:f.doc.content}:patch,state==='closed-unbound'?f.doc:{...f.doc,content:'Brief… (truncated, use `get_document` for full description)'},false);
 if(state==='closed-unbound')f.events.splice(8,0,...competing);
 else f.events.splice(8,0,competing[0]);
 if(state==='open-unbound')f.events.splice(f.events.length-1,0,competing[2]);
 const result=f.check(),write=nativeRecords('codex',f.request.trace).calls.find(c=>c.callId==='patch');
 const ambiguous=['open-unbound','missing-output'].includes(state);
 assert.equal(result.status,ambiguous?'unverified':'passed',result.reason);
 assert.equal(Number.isInteger(write.approvalInvocationLine),!ambiguous,'unknown open owner cannot supply a proved invocation');
});
test('MONO-357 mixed native latest-read ownership stays unverified',t=>{
 const f=nativePatchFirstFixture(t,'latest'),competing=nativeMcpEvents('competing','get_document',{id:'brief'},f.doc,false);
 // Insert after the older read completed, before the later literal read starts.
 f.events.splice(11,0,competing[0]);f.events.splice(f.events.length-1,0,competing[2]);
 const result=f.check(),read=nativeRecords('codex',f.request.trace).calls.find(c=>c.callId==='prior');
 assert.equal(result.status,'unverified');assert.equal(read.approvalInvocationLine,undefined);
});
test('MONO-357 patch-first rejects an overlapping native consumer hidden behind an alias',t=>{
 const f=nativePatchFirstFixture(t),patch={id:'brief',patch:[{op:'replace',old_string:'Expected link.',new_string:'Approval link.'}]};
 const competing=nativeMcpEvents('alias','save_document',patch,{...f.doc,content:'Brief… (truncated, use `get_document` for full description)'},false);
 competing[0].payload.input=`const save = tools.mcp__monotest__save_document; const r = await save(${JSON.stringify(patch)}); text(r);`;
 f.events.splice(8,0,competing[0]);f.events.splice(f.events.length-1,0,competing[2]);
 const result=f.check();assert.equal(result.status,'unverified');assert.match(result.reason,/patch.*prior content/);
});
test('MONO-357 patch-first requires a uniquely bound native prior read even without another read',t=>{
 const f=nativePatchFirstFixture(t);
 f.events.find(e=>e.payload?.call_id==='outer-prior').payload.input='text(await tools.mcp__monotest__get_document({id:"brief"}));';
 const result=f.check();assert.equal(result.status,'unverified');assert.match(result.reason,/patch.*prior content/);
});
test('MONO-357 conservative patch-first leaves a historical unbound native read unverified',t=>{
 const f=nativePatchFirstFixture(t,'latest');
 // The class stop accepts false unverified; do not add another promotion path.
 f.events.find(e=>e.payload?.call_id==='outer-older').payload.input='text(await tools.mcp__monotest__get_document({id:"brief"}));';
 const result=f.check();assert.equal(result.status,'unverified');assert.match(result.reason,/patch.*uniquely bound prior content/);
});
for(const host of ['claude','codex'])test(`MONO-357 ${host}: first patch uses latest full successful native document read`,t=>{
 const f=patchFirstFixture(t,host);
 f.events.splice(7,0,f.call('older','mcp__monotest__get_document',{id:'brief'}),f.result('older',{...f.doc,content:'Old content.'}),f.call('prior','mcp__monotest__get_document',{id:'brief'}),f.result('prior',f.doc));
 assert.equal(f.check().status,'passed',f.check().reason);
 f.save('documents/brief.json',{...f.final,content:'Approval link.\nChanged paragraph.'});assert.equal(f.check().status,'failed');
});
for(const host of ['claude','codex'])test(`MONO-357 ${host}: patch ignores native reads preceding the latest content write`,t=>{
 const f=patchFirstFixture(t,host);
 f.events.splice(7,0,f.call('stale','mcp__monotest__get_document',{id:'brief'}),f.result('stale',{...f.doc,content:'Stale content.'}),f.call('full','mcp__monotest__save_document',{id:'brief',content:f.doc.content}),f.result('full',f.doc));
 assert.equal(f.check().status,'passed',f.check().reason);
});
for(const host of ['claude','codex'])test(`MONO-357 ${host}: unsuccessful read does not replace earlier full native content`,t=>{
 const f=patchFirstFixture(t,host);
 f.events.splice(7,0,f.call('prior','mcp__monotest__get_document',{id:'brief'}),f.result('prior',f.doc),f.call('failed','mcp__monotest__get_document',{id:'brief'}),f.result('failed',{isError:true,content:[{type:'text',text:'read failed'}]}));
 assert.equal(f.check().status,'passed',f.check().reason);
});
for(const host of ['claude','codex'])for(const state of ['missing','foreign','elided','failed','late-result'])test(`MONO-357 ${host}: first patch rejects ${state} native read`,t=>{
 const f=patchFirstFixture(t,host);
 if(state!=='missing'){
  const value=state==='foreign'?{...f.doc,id:'other-document'}:state==='elided'?{...f.doc,content:'Brief… (truncated, use `get_document` for full description)'}:state==='failed'?{isError:true,content:[{type:'text',text:'read failed'}]}:f.doc;
  f.events.splice(7,0,f.call('prior','mcp__monotest__get_document',{id:state==='foreign'?'other-document':'brief'}));
  f.events.splice(state==='late-result'?9:8,0,f.result('prior',value));
 }
 const result=f.check();assert.notEqual(result.status,'passed');assert.match(result.reason,/patch.*prior content/);
});
for(const host of ['claude','codex'])for(const state of ['ordered','no-time','overlap'])test(`MONO-357 ${host}: first patch requires trace order for ${state} native reads`,t=>{
 const f=patchFirstFixture(t,host),trace=path.join(f.dir,'prior-read.jsonl');
 const rows=[f.call('prior','mcp__monotest__get_document',{id:'brief'}),f.result('prior',f.doc),f.terminal];
 fs.writeFileSync(trace,(state==='no-time'?rows:timed(rows,'2026-11-02T03:59:59Z')).map(JSON.stringify).join('\n')+'\n');
 f.request.additionalTraces=[{host,trace}];
 if(state==='overlap'){
  const other=path.join(f.dir,'overlapping-read.jsonl');fs.writeFileSync(other,timed([f.call('overlap','mcp__monotest__get_document',{id:'brief'}),f.result('overlap',f.doc),f.terminal],'2026-11-02T03:59:59.005Z').map(JSON.stringify).join('\n')+'\n');f.request.additionalTraces.push({host,trace:other});
 }
 const result=f.check();assert.equal(result.status,state==='ordered'?'passed':'unverified',result.reason??'unexpected pass');
});

function briefInsertPatchFixture(t,host,op,state='bound'){
 const f=textFixture(t,host,'defer');
 const anchor=op==='insert_before'?'```mono-brief':'## Решения и повороты';
 const insertion=op==='insert_before'?'## Что знаем\n08.11.2026, Research: находка; причина: проверено; https://linear.app/monotest/document/research\n\n':'\n08.11.2026, Handoff: решение; причина: согласие; https://linear.app/monotest/project/test#comment-r1\n';
 let content='## Суть сейчас\nСохраняем контекст.\n\n## Решения и повороты\n\n```mono-brief\n'+JSON.stringify({project:projectId})+'\n```';
 if(state==='missing-anchor')content=content.replace(anchor,'No matching anchor.');
 if(state==='ambiguous-anchor')content=anchor+'\n'+content;
 const doc={id:'brief',projectId,title:'Brief',content};
 const index=content.indexOf(anchor),offset=index+(op==='insert_after'?anchor.length:0);
 const final={...doc,content:index<0?content:content.slice(0,offset)+insertion+content.slice(offset)};
 const patch={id:'brief',patch:[{op,anchor,text:insertion}]},truncated={...doc,content:'Brief… (truncated, use `get_document` for full description)'};
 const events=host==='codex'?[
  ...nativeMcpEvents('insert-prior','get_document',{id:'brief'},doc,!['unbound-read','write-unbound-read'].includes(state)),
  ...nativeMcpEvents('insert-patch','save_document',patch,truncated),
  ...nativeMcpEvents('insert-read-back','get_document',{id:'brief'},final)
 ]:[f.call('insert-prior','mcp__monotest__get_document',{id:'brief'}),f.result('insert-prior',doc),f.call('insert-patch','mcp__monotest__save_document',patch),f.result('insert-patch',truncated),f.call('insert-read-back','mcp__monotest__get_document',{id:'brief'}),f.result('insert-read-back',final)];
 if(['missing-read','write-without-read','write-unbound-read','write-read'].includes(state)){
  if(!['write-unbound-read','write-read'].includes(state))events.splice(0,host==='codex'?3:2);
  if(state!=='missing-read')events.unshift(...(host==='codex'?nativeMcpEvents('insert-create','save_document',{projectId,title:doc.title,content},doc):[f.call('insert-create','mcp__monotest__save_document',{projectId,title:doc.title,content}),f.result('insert-create',doc)]));
 }
 if(host==='codex'&&state==='latest-bound')events.unshift(...nativeMcpEvents('insert-stale','get_document',{id:'brief'},{...doc,content:'Stale bound content.'}));
 if(host==='codex'&&state==='unbound-after')events.splice(3,0,...nativeMcpEvents('insert-unbound-late','get_document',{id:'brief'},{...doc,content:'Unbound later content.'},false));
 f.events.splice(7,0,...events);
 if(host==='codex'&&['grouped-seed','latest-bound'].includes(state)){
  const seed=nativeMcpEvents('insert-seed','get_document',{id:'brief'},{...doc,content:'Unbound seed content.'},false);
  seed[0].payload.input='const results = await Promise.allSettled([tools.mcp__monotest__get_document({id:"brief"}),tools.mcp__monotest__list_documents({projectId:"'+projectId+'"})]); results.forEach(text);';
  seed.splice(2,0,{type:'event_msg',payload:{type:'item_completed',item:{type:'McpToolCall',id:'seed-list',server:'monotest',tool:'list_documents',arguments:{projectId},status:'completed',result:{documents:[doc]}}}});
  seed.push(f.terminal);f.events.unshift(...seed);f.request.stageStartLine=seed.length+1;
  for(const binding of f.request.approvalBindings){binding.shownLine+=seed.length;binding.currentLine+=seed.length;}
 }
 if(host==='codex'){
  f.events.unshift({type:'session_meta',payload:{id:'native-insert-patch-session'}});
  for(const binding of f.request.approvalBindings){binding.shownLine++;binding.currentLine++;}
 }
 f.page('documents','documents',[{id:'doc'},{id:'brief'}]);f.save('documents/brief.json',final);
 return {...f,doc,final};
}
for(const host of ['claude','codex'])for(const op of ['insert_before','insert_after'])for(const state of ['bound','write-read'])test(`MONO-358 ${host}: Brief ${op} replays ${state} native content and checks read-back`,t=>{
 const f=briefInsertPatchFixture(t,host,op,state),result=f.check();assert.equal(result.status,'passed',result.reason);
 f.save('documents/brief.json',{...f.final,content:f.final.content+'Unexpected change.'});
 const changed=f.check();assert.equal(changed.status,'failed');assert.match(changed.reason,/mismatch.*brief\.content/);
});
for(const op of ['insert_before','insert_after'])for(const state of ['grouped-seed','latest-bound','unbound-after'])test(`MONO-358 codex: Brief ${op} uses latest bound read with ${state}`,t=>{
 const f=briefInsertPatchFixture(t,'codex',op,state),result=f.check();assert.equal(result.status,'passed',result.reason);
 f.save('documents/brief.json',{...f.final,content:f.final.content+'Unexpected change.'});assert.equal(f.check().status,'failed');
});
for(const host of ['claude','codex'])for(const op of ['insert_before','insert_after'])for(const state of ['missing-anchor','ambiguous-anchor'])test(`MONO-358 ${host}: Brief ${op} refuses ${state}`,t=>{
 const result=briefInsertPatchFixture(t,host,op,state).check();assert.equal(result.status,'failed');assert.match(result.reason,/document patch anchor.*exactly once.*(?:missing|ambiguous)/);
});
for(const op of ['insert_before','insert_after'])test(`MONO-358 codex: Brief ${op} refuses unbound prior native read`,t=>{
 const result=briefInsertPatchFixture(t,'codex',op,'unbound-read').check();assert.equal(result.status,'unverified');assert.match(result.reason,/document insert patch lacks bound native prior content/);
});

for(const host of ['claude','codex'])for(const op of ['insert_before','insert_after'])for(const state of ['missing-read','write-without-read'])test(`MONO-358 ${host}: Brief ${op} requires native read for ${state}`,t=>{
 const result=briefInsertPatchFixture(t,host,op,state).check();assert.equal(result.status,'unverified');assert.match(result.reason,/patch.*prior content/);
});
for(const op of ['insert_before','insert_after'])test(`MONO-358 codex: Brief ${op} refuses unbound read after content write`,t=>{
 const result=briefInsertPatchFixture(t,'codex',op,'write-unbound-read').check();assert.equal(result.status,'unverified');assert.match(result.reason,/patch.*prior content/);
});

for(const state of ['unknown prior content','unsupported operation'])test(`MONO-357 patch ${state} stays unverified`,t=>{
 const f=textFixture(t,'codex','defer'),doc={id:'brief',projectId,title:'Brief',content:'Expected link.'};
 if(state==='unsupported operation')f.events.splice(7,0,f.call('brief','mcp__monotest__save_document',{projectId,title:doc.title,content:doc.content}),f.result('brief',doc));
 const patch=state==='unsupported operation'?[{op:'append',text:'New link.'}]:[{op:'replace',old_string:doc.content,new_string:'New link.'}];
 f.events.splice(f.events.length-1,0,f.call('patch','mcp__monotest__save_document',{id:'brief',patch}),f.result('patch',{...doc,content:'New link.'}));
 f.page('documents','documents',[{id:'doc'},{id:'brief'}]);f.save('documents/brief.json',{...doc,content:'New link.'});
 const result=f.check();assert.equal(result.status,'unverified');assert.match(result.reason,/patch.*(?:prior content|unsupported)|unsupported.*patch/);
});

function briefBindingFixture(t,host){
 const f=textFixture(t,host,'defer');f.request.expectedRecords.push({type:'mono-brief',count:1});
 const marker='```mono-brief\n'+JSON.stringify({project:projectId})+'\n```';
 const content='## Суть сейчас\n[source](README.md)\n\n## Отброшено\n\n`````text\n```mono-brief\n{"project":"old-project"}\n```\n`````\n\n'+marker;
 const doc={id:'brief',projectId,title:'Any title',content};
 f.events.splice(7,0,{},{});
 const set=(value,stored=value)=>{
  f.events[7]=f.call('brief-write','mcp__monotest__save_document',{projectId,title:doc.title,content:value});
  f.events[8]=f.result('brief-write',{...doc,content:value});
  f.page('documents','documents',[{id:'doc'},{id:'brief'}]);f.save('documents/brief.json',{...doc,content:stored});
 };
 return {...f,content,marker,set};
}
for(const host of ['claude','codex'])test(`MONO-357 ${host}: terminal Brief binding survives Linear round-trip and old-text quotes`,t=>{
 const f=briefBindingFixture(t,host);f.set(f.content);assert.equal(f.check().status,'passed');
 const crlf=f.content.replaceAll('\n','\r\n')+'\r\n \t\r\n';
 f.set(crlf,crlf.replace('[source](README.md)','[source](<README.md>)'));
 assert.equal(f.check().status,'passed',f.check().reason);
});
for(const host of ['claude','codex'])for(const state of ['trailing-text','foreign-final','duplicate-own'])test(`MONO-357 ${host}: Brief binding rejects ${state}`,t=>{
 const f=briefBindingFixture(t,host);
 const tail=state==='trailing-text'?'Text after the marker.':state==='duplicate-own'?f.marker:'```mono-brief\n{"project":"other-project"}\n```';
 f.set(f.content+'\n\n'+tail);
 const result=f.check();assert.equal(result.status,'failed');assert.match(result.reason,/observed (?:0|2)/);
});
for(const host of ['claude','codex'])test(`MONO-357 ${host}: terminal Brief accepts one pretty JSON project member`,t=>{
 const f=briefBindingFixture(t,host);
 f.set(f.content.replace(f.marker,'```mono-brief\n'+JSON.stringify({project:projectId},null,2)+'\n```'));
 assert.equal(f.check().status,'passed',f.check().reason);
});
for(const host of ['claude','codex'])for(const state of ['conflicting-members','repeated-own-member','spaced-key'])test(`MONO-357 ${host}: conservative Brief binding rejects ${state}`,t=>{
 const f=briefBindingFixture(t,host),own=JSON.stringify(projectId);
 const json=state==='conflicting-members'?`{"project":"other-project","project":${own}}`:state==='repeated-own-member'?`{"project":${own},"project":${own}}`:`{"pro ject":${own}}`;
 f.set(f.content.replace(f.marker,'```mono-brief\n'+json+'\n```'));
 const result=f.check();assert.equal(result.status,'failed');assert.match(result.reason,/observed 0/);
});

test('mono-brief record counting uses a project-bound code block, not title or quoted old text', t => {
 const f=textFixture(t,'claude','defer');f.request.expectedRecords.push({type:'mono-brief',count:1});
 f.events.splice(7,0,{},{});
 const marker='```mono-brief\n'+JSON.stringify({project:projectId})+'\n```';
 const old='```mono-brief\n{"project":"old-project"}\n```\n````';
 const content='## Суть сейчас\nКолонка источника.\n\n## Отброшено\n07.11.2026, Idea: заменили описание, уточнили результат, https://linear.app/monotest/project/test\n\n`````text\n'+old+'\n`````\n\n'+marker;
 const doc={id:'brief',projectId,title:'Changed title is allowed',content};
 const set=(value,stored=value)=>{
  f.events[7]=f.call('brief-write','mcp__monotest__save_document',{projectId,title:doc.title,content:value});
  f.events[8]=f.result('brief-write',{...doc,content:value});
  f.page('documents','documents',[{id:'doc'},{id:doc.id}]);f.save('documents/brief.json',{...doc,content:stored});
 };
 set(content);assert.equal(f.check().status,'passed',f.check().reason);
 const wrapped=content.replace('https://linear.app/monotest/project/test','[https://linear.app/monotest/project/test](<https://linear.app/monotest/project/test>)');
 set(content,wrapped);assert.equal(f.check().status,'passed',f.check().reason);
 set(content);f.page('documents','documents',[{id:'doc'},{id:'brief'},{id:'second'}]);f.save('documents/second.json',{...doc,id:'second'});
 assert.equal(f.check().status,'failed');assert.match(f.check().reason,/observed 2/);
 for(const invalid of ['## Бриф\nNo code marker',content.replace(JSON.stringify({project:projectId}),'not json'),content.replace(JSON.stringify({project:projectId}),JSON.stringify({project:'other'}))]){
  set(invalid);assert.equal(f.check().status,'failed');assert.match(f.check().reason,/observed 0/);
 }
});

for(const host of ['claude','codex'])test(`project Brief presence accepts a fresh native read without a stage write: ${host}`,t=>{
 const f=fixture(t),doc={id:'brief',projectId,title:'Бриф',content:'## Суть сейчас\nИсточник после имени.\n\n```mono-brief\n'+JSON.stringify({project:projectId})+'\n```'};
 f.request.host=host;f.events.splice(0);f.request.expectedRecords=[{type:'mono-brief',scope:'project',count:1}];
 f.page('comments','comments',[]);f.page('documents','documents',[{id:doc.id}]);f.save('documents/brief.json',doc);
 const check=()=>{f.check();return verifyTextRecords(f.request);};
 const result=check();assert.equal(result.status,'passed',result.reason);
 if(host==='claude')f.events.push({type:'assistant',message:{content:[{type:'tool_use',id:'seed',name:'mcp__monotest__save_document',input:{projectId,title:doc.title,content:doc.content}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'seed',content:JSON.stringify(doc)}]}},{type:'result',subtype:'success'});
 else f.events.push({type:'response_item',payload:{type:'function_call',call_id:'seed',name:'mcp__monotest__save_document',arguments:JSON.stringify({projectId,title:doc.title,content:doc.content})}},{type:'response_item',payload:{type:'function_call_output',call_id:'seed',output:JSON.stringify(doc)}},{type:'event_msg',payload:{type:'task_complete'}});
 Object.assign(f.request,{seedExpected:true,seedEndLine:3,seedProjectId:projectId});assert.equal(check().status,'passed','a seed write is not a required stage write');
 for(const content of ['no marker',doc.content.replace(projectId,'00000000-0000-4000-8000-000000000002')]){
  f.save('documents/brief.json',{...doc,content});f.check();const bad=verifyTextRecords(f.request);assert.equal(bad.status,'failed');assert.match(bad.reason,/expected mono-brief: 1, observed 0/);
 }
 f.save('documents/brief.json',doc);f.request.expectedRecords=[{type:'mono-brief',count:1}];f.check();assert.notEqual(verifyTextRecords(f.request).status,'passed','write-required expectations remain strict');
});

test('MONO-291 synthetic Claude skill body cannot reverse native capture time',t=>{
 const f=fixture(t);f.events.splice(2,0,{type:'user',isSynthetic:true,message:{content:[{type:'text',text:'Synthetic skill body'}]}});f.check();
 const rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);rows[2].timestamp='2020-01-01T00:00:00Z';
 fs.writeFileSync(f.request.trace,rows.map(JSON.stringify).join('\n')+'\n');assert.equal(verifyTextRecords(f.request).status,'passed');
 delete rows[2].isSynthetic;fs.writeFileSync(f.request.trace,rows.map(JSON.stringify).join('\n')+'\n');assert.equal(verifyTextRecords(f.request).status,'unverified');
});
for(const mode of ['chip','mixed-code'])test(`MONO-291 Linear prose normalization ${mode} preserves code and detects substantive changes`,t=>{
 const f=fixture(t),url='https://linear.app/monotest/issue/MON-99/task';f.request.expectedRecords=[{type:'project'}];
 const wanted=mode==='chip'?`Task: <issue id="uuid" href="${url}">MON-99</issue>`:`Keep \`x\`, see [${url}](<${url}>)`;
 const actual=mode==='chip'?'Task: MON-99':`Keep \`x\`, see ${url}`;
 f.events[2].message.content[0].input.body=wanted;f.events[3].message.content[0].content=JSON.stringify({...f.record,body:actual});f.page('comments','comments',[{...f.record,body:actual}]);f.check();
 assert.equal(verifyTextRecords(f.request).status,'passed',JSON.stringify(verifyTextRecords(f.request)));
 f.events[2].message.content[0].input.body=mode==='chip'?wanted.replace('MON-99</issue>','MON-98</issue>'):wanted.replace('`x`','`y`');f.check();assert.equal(verifyTextRecords(f.request).status,'failed');
});

for(const host of ['claude','codex'])for(const teamSource of ['issue','project','teams','ambiguous'])test(`MONO-291 ${host} resolves a written status UUID from the fixed dump of its team (${teamSource})`,t=>{
 const f=fixture(t);f.request.host=host;
 const team='00000000-0000-4000-8000-000000000002',status='00000000-0000-4000-8000-000000000003';
 const statuses=[{id:status,name:'Done',type:'completed'},{id:'00000000-0000-4000-8000-000000000004',name:'Released',type:'completed'}];
 const issue={id:'MON-1',uuid:'task',projectId,teamId:team,title:'Stage',description:'Body',status:'Done',labels:[]};
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[]);f.page('issues','issues',[{id:'task'}]);f.save('issues/task/issue.json',issue);f.page('issues/task/comments','comments',[]);f.save(`statuses/${team}.json`,statuses);
 if(teamSource!=='issue')delete issue.teamId;
 if(teamSource==='project'){f.project.teams=[{id:team,name:'Native team'}];f.save('project.json',f.project);}
 if(['teams','ambiguous'].includes(teamSource))f.page('teams','teams',[{id:team,name:'Native team'},...(teamSource==='ambiguous'?[{id:'other-team',name:'Other'}]:[])]);
 f.save('issues/task/issue.json',issue);
 const input={id:'task',state:status};
 f.events.splice(0,f.events.length,...(host==='claude'?[
  {type:'assistant',message:{content:[{type:'tool_use',id:'status',name:'mcp__monotest__save_issue',input}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'status',content:JSON.stringify(issue)}]}}
 ]:[{type:'response_item',payload:{type:'function_call',call_id:'status',name:'mcp__monotest__save_issue',arguments:JSON.stringify(input)}},
 {type:'response_item',payload:{type:'function_call_output',call_id:'status',output:JSON.stringify(issue)}}]));
 const check=()=>{f.check();return verifyTextRecords(f.request);};
 if(teamSource==='ambiguous'){assert.equal(check().status,'unverified',JSON.stringify(check()));return;}
 assert.equal(check().status,'passed',JSON.stringify(check()));
 f.save('issues/task/issue.json',{...issue,status:'Released'});assert.equal(check().status,'failed','same status type cannot replace the exact status');
 f.save('issues/task/issue.json',{...issue,status:{id:statuses[1].id,name:'Done',type:'completed'}});assert.equal(check().status,'failed','a returned name cannot hide a different explicit UUID');
 f.save('issues/task/issue.json',issue);f.save(`statuses/${team}.json`,statuses.filter(row=>row.id!==status));assert.equal(check().status,'unverified','missing exact UUID cannot be inferred from type');
});

test('MONO-291 Claude fixed dump permits monotest ToolSearch, reads team statuses, rejects foreign search',async t=>{
 for(const mode of ['tool-search','tool-search-foreign']){
  const f=fixture(t);
  const r=await collectRecordDump({host:'claude',cwd:f.dir,packRoot:process.cwd(),outputDir:path.join(f.dir,'fixed'),timeoutMs:10000,idleMs:10,binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-fixed-dump-host.mjs'),mode]},project:{id:projectId,name:'fixed-run'},mcpServers:{monotest:{url:'test'}}});
  assert.equal(r.status,mode==='tool-search'?'passed':'failed',JSON.stringify(r));
  if(mode==='tool-search')assert(fs.existsSync(path.join(r.dumpDir,'statuses/test-team.json')));
 }
});

test('MONO-291 production historical records require scenario context and reject an empty answer',t=>{
 const f=liveFixture(t,'idea-approve');fs.symlinkSync(path.resolve('scripts'),path.join(f.dir,'scripts'),'dir');f.request.packRoot=f.dir;
 const version=value=>{f.request.testedVersion=value;fs.writeFileSync(path.join(f.dir,'VERSION'),value+'\n');};version('0.41.0');
 const incomplete=verifyTextRecords(f.request);assert.equal(incomplete.status,'unverified',JSON.stringify(incomplete));assert.match(incomplete.reason,/scenario policies missing/);assert.equal(incomplete.gateResults[0].result.ok,true,'record gate still runs before the missing conversation check');
 version('0.43.0');assert.match(verifyTextRecords(f.request).reason,/stage called a window/);version('0.41.0');
 editLiveTrace(f,rows=>{const reply=rows.find(r=>r.payload?.role==='user'&&r.payload.content?.[0]?.text?.includes('send_user_message_question_reply'));const content=reply.payload.content[0].text;const answers=JSON.parse(content.replace(/^<send_user_message_question_reply>\n/,'').replace(/\n<\/send_user_message_question_reply>\n?$/,''));answers.forEach(a=>a.answer='');reply.payload.content[0].text='<send_user_message_question_reply>\n'+JSON.stringify(answers)+'\n</send_user_message_question_reply>\n';});
 const empty=verifyTextRecords(f.request);assert.equal(empty.status,'failed',JSON.stringify(empty));assert.match(empty.reason,/empty\/refuse/);
});

// D2 uses the saved Codex presentation shape (project name, then four sections),
// with the already anonymized native approval fixture for independent gate proof.
for(const corrected of [false,true])test(`D2 named shown Idea binds the same canonical four-section approval (${corrected?'correction':'agree'})`,t=>{
 const f=corrected?correctedIdeaFixture(t):textIdeaFixture(t);
 const name=f.request.project.name,full=f.request.approvalBindings[1].text;
 const rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);
 const shown=rows[f.request.approvalBindings[1].shownLine-1].payload.content[0];
 shown.text=name+'\n\n'+shown.text;
 f.request.approvalBindings.forEach(b=>{b.text=name+'\n\n'+full;if(b.artifactEnd!==undefined)b.artifactEnd+=name.length+2;});
 fs.writeFileSync(f.request.trace,rows.map(JSON.stringify).join('\n')+'\n');
 const result=corrected?f.attest():f.check();assert.equal(result.status,'passed',JSON.stringify(result));
 if(!corrected){f.request.approvalBindings.forEach(b=>b.text=full);assert.equal(f.check().status,'passed','four-section binding also accepts the known title outside the artifact');f.request.approvalBindings.forEach(b=>b.text=name+'\n\n'+full);}
 f.request.approvalBindings[0].text=f.request.approvalBindings[0].text.replace(name,'Different project');
 assert.equal(f.check().status,'failed','a different leading title cannot be silently discarded');
});
test('D3 actual approvals with missing shown bindings are unverified, while missing records remain failed',t=>{
 const f=textIdeaFixture(t);assert.equal(f.check().status,'passed');
 f.request.approvalBindings=[];
 const result=f.check();assert.equal(result.status,'unverified',JSON.stringify(result));assert.equal(result.bindingOnly,true);
 assert.match(result.reason,/shown-version binding missing/);
});
test('D2 Codex native completed MCP approval binds its uniquely proved exec invocation line',t=>{
 const f=textIdeaFixture(t),rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);
 const i=rows.findIndex(r=>r.payload?.name==='mcp__monotest__save_comment'),call=rows[i].payload,result=JSON.parse(rows[i+1].payload.output);
 const id='approval-exec',item={type:'McpToolCall',status:'completed',id:'approval-native',server:'monotest',tool:'save_comment',arguments:JSON.parse(call.arguments),result};
 rows.splice(i,2,{type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:id,input:`const r = await tools.mcp__monotest__save_comment(${call.arguments}); text(r);`}},{type:'event_msg',payload:{type:'item_completed',item}},{type:'response_item',payload:{type:'custom_tool_call_output',call_id:id,output:'stored'}});
 fs.writeFileSync(f.request.trace,timed(rows,'2026-11-02T04:00:01Z').map(JSON.stringify).join('\n')+'\n');
 f.request.approvalBindings[1].currentLine=i+1;
 assert.equal(f.check().status,'passed',JSON.stringify(f.check()));
 f.request.approvalBindings[1].currentLine=i;assert.notEqual(f.check().status,'passed','a neighbouring exec is not this approval');
});

const contextNative=JSON.parse(fs.readFileSync(new URL('./test-fixtures/skills-host-context-regressions.json',import.meta.url)));
test('continue8 saved non-null rubric digest permits explicit binding re-preparation only',async t=>{
 assert.equal(contextNative.bindingCapture.hadRubricDigest,true,'saved live capture reached this state');
 const f=textIdeaFixture(t),expected=f.request.expectedReplies[0],full=f.request.approvalBindings[1].text;
 Object.assign(expected,{question:{anchors:['описание']},presentation:'inline',driverStart:null,response:{anchors:['запис'],question:false}});
 for(const b of f.request.approvalBindings)b.artifactEnd=full.length;
 f.request.rubricDefinition='Full shown four-section Idea, native owner consent and canonical persisted version.';
 fs.mkdirSync(path.join(f.dir,'.agents'));fs.copyFileSync(f.request.configFile,path.join(f.dir,'.agents/mono-workflow.config.json'));
 const bindingsFile=path.join(f.dir,'annotations.json'),input={run:{trace:f.request.trace,stageStartLine:f.request.stageStartLine},runRequest:{host:'codex',cwd:f.dir,packRoot:process.cwd(),context:{skillPrefix:'mono',projectName:f.request.project.name},scenario:{expectedReplies:f.request.expectedReplies,rubricDefinition:f.request.rubricDefinition},mcpServers:{monotest:{url:'test'}}},scenario:{expectedRecords:f.request.expectedRecords},project:f.request.project,outputDir:path.join(f.dir,'saved-unbound')};
 const first=await verifyTextScenarioRecords(input,async()=>({status:'passed',trace:f.request.dumpTrace,dumpDir:f.request.dumpDir}));
 assert.equal(first.status,'unverified',JSON.stringify(first));assert.ok(first.rubricDigest,'bindingOnly live captures already have a rubric digest');
 const stale={digest:first.rubricDigest,reviewer:'old review',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',evidence:'native captured fixture',reason:'reviewed old unbound input'}))};
 fs.writeFileSync(bindingsFile,JSON.stringify({approvalBindings:f.request.approvalBindings,rubric:stale}));
 const reuse=()=>{throw Error('binding preparation must not collect or rerun a stage');};
 await assert.rejects(()=>verifyTextScenarioRecords({...input,resumeEvidence:first.reviewEvidence,bindingsFile},reuse),/saved bindings changed/);
 const prepared=await verifyTextScenarioRecords({...input,resumeEvidence:first.reviewEvidence,bindingsFile,prepareReview:true},reuse);
 assert.equal(prepared.status,'unverified',JSON.stringify(prepared));assert.ok(prepared.rubricDigest);assert.notEqual(prepared.rubricDigest,first.rubricDigest);
 const saved=JSON.parse(fs.readFileSync(prepared.reviewEvidence));assert.equal(saved.request.rubric,undefined,'preparation discards old judgments');
 assert.equal((await verifyTextScenarioRecords({...input,resumeEvidence:prepared.reviewEvidence,bindingsFile},reuse)).status,'unverified','old digest never certifies new bindings');
 fs.writeFileSync(bindingsFile,JSON.stringify({approvalBindings:f.request.approvalBindings,rubric:{...stale,digest:prepared.rubricDigest}}));
 assert.equal((await verifyTextScenarioRecords({...input,resumeEvidence:prepared.reviewEvidence,bindingsFile},reuse)).status,'passed');
});
for(const mode of ['empty','owner-text','window','write','cut','explicit-policy'])test(`continue8 historical Codex helper source ${mode} cannot bypass owner checks`,t=>{
 const f=historicalRecords(t,'codex'),trace=path.join(f.dir,'native-helper.jsonl');
 const rows=[{type:'event_msg',payload:{type:'task_started',turn_id:'helper'}},{type:'response_item',payload:{type:'function_call',name:'mcp__monotest__get_workspace',call_id:'helper-read',arguments:'{}'}},{type:'response_item',payload:{type:'function_call_output',call_id:'helper-read',output:'{"name":"Mono Test"}'}}];
 if(mode==='owner-text')rows.push({type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Owner-visible scout summary.'}]}});
 if(mode==='window')rows.push({type:'response_item',payload:{type:'function_call',name:'request_user_input_async',call_id:'helper-window',arguments:'{"questions":[{"title":"Approve?"}]}'}});
 if(mode==='write')rows.push({type:'response_item',payload:{type:'function_call',name:'mcp__monotest__save_project',call_id:'helper-write',arguments:'{"name":"No authority"}'}});
 if(mode!=='cut')rows.push({type:'event_msg',payload:{type:'task_complete',turn_id:'helper'}});
 fs.writeFileSync(trace,timed(rows,'2026-11-02T04:00:00Z').map(JSON.stringify).join('\n')+'\n');
 f.request.additionalTraces=[{host:'codex',trace,...(mode==='explicit-policy'?{expectedWindows:f.request.expectedWindows,windows:f.request.windows}:{})}];
 if(mode==='empty'){
  const first=f.attest();assert.equal(first.rubricInput.sources.length,1,'tool-only helper is not an owner-rubric source');
  const result=f.check();assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.windowChecks[1].kind,'helper');assert.equal(result.windowChecks[1].status,'passed');
 }else assert.notEqual(f.check().status,'passed',JSON.stringify(f.check()));
});

const resumeLive=JSON.parse(fs.readFileSync(new URL('./test-fixtures/skills-resume-live-regressions.json',import.meta.url)));
for(const kind of ['notification','owner','write','read'])test(`continue9 native enqueue time exemption is only for host notification (${kind})`,t=>{
 const f=fixture(t);f.flush();
 const rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse);
 if(kind==='notification')rows.splice(2,0,{...resumeLive.notification,timestamp:resumeLive.notification.timestamp});
 else {const at={owner:1,write:2,read:3}[kind];rows[at].timestamp=resumeLive.notification.timestamp;rows[at-1].timestamp=resumeLive.previousTimestamp;}
 if(kind==='notification')rows[1].timestamp=resumeLive.previousTimestamp;
 // Keep all ordinary events later than the observed enqueue/preceding pair.
 if(kind==='notification')for(let i=3;i<rows.length;i++)rows[i].timestamp='2026-11-09T21:46:00Z';
 if(kind==='notification'){
  const dump=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse);dump.forEach(r=>r.timestamp='2026-11-09T21:47:00Z');fs.writeFileSync(f.request.dumpTrace,dump.map(JSON.stringify).join('\n')+'\n');
 }
 fs.writeFileSync(f.request.trace,rows.map(JSON.stringify).join('\n')+'\n');
 const r=verifyTextRecords(f.request);assert.equal(r.status,kind==='notification'?'passed':'unverified',JSON.stringify(r));
});
test('continue9 saved Codex tool-name listing is not an unbound write or stage start',t=>{
 const f=textFixture(t,'codex','defer'),sample=structuredClone(resumeLive.toolNameListing);
 f.events.splice(7,0,sample,{type:'response_item',payload:{type:'custom_tool_call_output',call_id:sample.payload.call_id,output:'tool descriptions'}});
 assert.equal(f.check().status,'passed',JSON.stringify(f.check()));
 sample.payload.input+='text(await tools.mcp__monotest__save_comment({}));';
 assert.equal(f.check().status,'unverified');
});
test('continue9 indexed tools access keeps a Codex tool-name mention as an action',t=>{
 const f=textFixture(t,'codex','defer'),sample=structuredClone(resumeLive.toolNameListing);
 sample.payload.input+='text(await tools["mcp__monotest__save_comment"]({}));';
 f.events.splice(7,0,sample,{type:'response_item',payload:{type:'custom_tool_call_output',call_id:sample.payload.call_id,output:'tool descriptions'}});
 assert.equal(f.check().status,'unverified',JSON.stringify(f.check()));
});
for(const mode of ['valid','wrong-destination','code'])test(`continue9 percent-encoded link destination normalization ${mode}`,t=>{
 const f=fixture(t),original='See [запись](ССЫЛКА-СОГЛАСИЯ).',stored=d=>`See [запись](${encodeURI(d)}).`;
 f.record.body=mode==='code'?'`'+original+'`':original;f.events[2].message.content[0].input.body=f.record.body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[{...f.record,body:mode==='code'?'`'+stored('ССЫЛКА-СОГЛАСИЯ')+'`':stored(mode==='wrong-destination'?'ССЫЛКА-ОТКАЗА':'ССЫЛКА-СОГЛАСИЯ')}]);
 f.flush();const result=verifyTextRecords(f.request);assert.equal(result.status,mode==='valid'?'passed':'failed',JSON.stringify(result));
});
for(const mode of ['valid','wrong-key','code'])test(`continue9 saved self-closing issue chip normalization ${mode}`,t=>{
 const f=fixture(t),original='See MON-625.',chip=resumeLive.selfClosingMention;
 f.record.body=mode==='code'?'`'+original+'`':original;f.events[2].message.content[0].input.body=f.record.body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[{...f.record,body:mode==='code'?'`See '+chip+'.`':'See '+(mode==='wrong-key'?chip.replace('label="MON-625"','label="MON-626"'):chip)+'.'}]);
 f.flush();const result=verifyTextRecords(f.request);assert.equal(result.status,mode==='valid'?'passed':'failed',JSON.stringify(result));
});
// Linear's save-time rewrites of plain prose observed on a live Research document:
// a bare file-like token becomes a link to itself, square brackets get a backslash.
for(const mode of ['valid','wrong-destination','wrong-label','wrong-token','code'])test(`live Research bare-token autolink normalization ${mode}`,t=>{
 const f=fixture(t),original='See GUIDE.md:3, then run.',stored=(label,dest)=>`See [${label}](<http://${dest}>), then run.`;
 f.record.body=mode==='code'?'`'+original+'`':original;f.events[2].message.content[0].input.body=f.record.body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 const label=['wrong-label','wrong-token'].includes(mode)?'GUIDE.md:4':'GUIDE.md:3',dest=['wrong-destination','wrong-token'].includes(mode)?'GUIDE.md:4':'GUIDE.md:3';
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[{...f.record,body:mode==='code'?'`'+stored(label,dest)+'`':stored(label,dest)}]);
 f.flush();const result=verifyTextRecords(f.request);assert.equal(result.status,mode==='valid'?'passed':'failed',JSON.stringify(result));
});
for(const mode of ['valid','wrong-text','code','fence'])test(`live Research escaped square bracket normalization ${mode}`,t=>{
 const f=fixture(t),sample="Width is rows.map(row => row[i].length) over [['name', 'Name']], then cb[i](a, b) and this[method]().",escaped=value=>value.replace(/[\\\[\]]/g,'\\$&');
 const wrap={code:value=>'`'+value+'`',fence:value=>'Sample:\n\n```\n'+value+'\n```'}[mode]??(value=>value);
 f.record.body=wrap(sample);f.events[2].message.content[0].input.body=f.record.body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[{...f.record,body:wrap(escaped(mode==='wrong-text'?sample.replace('row[i]','row[j]'):sample))}]);
 f.flush();const result=verifyTextRecords(f.request);assert.equal(result.status,mode==='valid'?'passed':'failed',JSON.stringify(result));
});
// A real link and the same text with escaped brackets are different records, whatever the link shape.
const linkShapes={simple:'[note](target)',title:'[Guide](https://example.test "Title")',parentheses:'[Guide](https://example.test/a_(b))',angle:'[Guide](<https://example.test/a b>)',nested:'[run[key]](https://example.test)'};
for(const [shape,link] of Object.entries(linkShapes))for(const side of ['written','stored'])test(`live Research escaped brackets never equal a real link (${shape}, link ${side})`,t=>{
 const f=fixture(t),literal=link.replace(/[\\\[\]]/g,'\\$&'),bodies=side==='written'?[link,literal]:[literal,link];
 f.record.body=`See ${bodies[0]}.`;f.events[2].message.content[0].input.body=f.record.body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[{...f.record,body:`See ${bodies[1]}.`}]);
 f.flush();const result=verifyTextRecords(f.request);assert.equal(result.status,'failed',JSON.stringify(result));
});
test('live Research link label keeps its link when only the inner brackets are escaped',t=>{
 const f=fixture(t);
 f.record.body='See [run[key]](https://example.test).';f.events[2].message.content[0].input.body=f.record.body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[{...f.record,body:'See [run\\[key\\]](https://example.test).'}]);
 f.flush();const result=verifyTextRecords(f.request);assert.equal(result.status,'passed',JSON.stringify(result));
});
for(const mode of ['valid','wrong-start','fragment','missing-end'])test(`continue9 absolute Idea artifact bounds preserve full four-section snapshot (${mode})`,t=>{
 const f=textIdeaFixture(t),rows=fs.readFileSync(f.request.trace,'utf8').trim().split('\n').map(JSON.parse),binding=f.request.approvalBindings[1],full=binding.text;
 const expected=f.request.expectedReplies[0],question=expected.question;
 Object.assign(expected,{question:{anchors:['описание']},presentation:'inline',driverStart:null,response:{anchors:['запис'],question:false}});
 f.request.rubricDefinition='Full four-section Idea, native consent and bound snapshot; surrounding prose reviewed separately.';
 const prefix=resumeLive.ideaPresentation.slice(0,resumeLive.ideaPresentation.indexOf('## Что'));
 rows[4].payload.content[0].text=prefix+full+'\nДальше: обсудить Research.\n'+question;
 for(const b of f.request.approvalBindings){b.artifactStart=prefix.length;b.artifactEnd=prefix.length+full.length;if(mode==='wrong-start')b.artifactStart--;if(mode==='fragment'){b.text=full.slice(0,full.indexOf('## Неизвестные'));b.artifactEnd=prefix.length+b.text.length;}if(mode==='missing-end')delete b.artifactEnd;}
 fs.writeFileSync(f.request.trace,rows.map(JSON.stringify).join('\n')+'\n');
 const r=verifyTextRecords(f.request);assert.equal(r.status,mode==='valid'?'unverified':'failed',JSON.stringify(r));
 if(mode==='valid'){
  assert.ok(r.rubricDigest);f.request.rubric={digest:r.rubricDigest,reviewer:'saved native presentation control',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',evidence:'full native message and explicit artifact bounds',reason:'All four sections and snapshot bound; presentation prose separately judged.'}))};
  assert.equal(verifyTextRecords(f.request).status,'passed',JSON.stringify(verifyTextRecords(f.request)));
 }
});
for(const mode of ['recovered','no-explicit-error','no-retry','wrong-target','no-fresh-read','other-text'])test(`continue9 explicit nothing-saved native error requires same-target successful retry and fresh read (${mode})`,t=>{
 const f=textFixture(t,'claude','defer'),doc={id:'brief',projectId,title:'Brief',content:'Expected link.'},final={...doc,content:'Approval link.'};
 const bad=f.call('bad-patch','mcp__monotest__save_document',{id:'brief',patch:[{op:'replace',old_string:'MISSING',new_string:mode==='other-text'?'Another record.':'Approval link.'}]});
 const error={type:'user',message:{content:[{...resumeLive.writeError,tool_use_id:'bad-patch'}]}};
 if(mode==='no-explicit-error')error.message.content[0].content='Error: network interrupted; save outcome unknown.';
 const retry=f.call('patch','mcp__monotest__save_document',{id:mode==='wrong-target'?'other':'brief',patch:[{op:'replace',old_string:'Expected link.',new_string:'Approval link.'}]});
 const events=[f.call('prior','mcp__monotest__get_document',{id:'brief'}),f.result('prior',doc),bad,error];
 if(mode!=='no-retry')events.push(retry,f.result('patch',final));
 if(mode!=='no-fresh-read')events.push(f.call('fresh','mcp__monotest__get_document',{id:'brief'}),f.result('fresh',final));
 f.events.splice(7,0,...events);f.page('documents','documents',[{id:'doc'},{id:'brief'}]);f.save('documents/brief.json',final);
 const r=f.check();assert.equal(r.status,mode==='recovered'?'passed':'unverified',JSON.stringify(r));
});
test('continue9 missing saved rubric digest retains actual missing-binding reason on resume',async t=>{
 const f=u7DocumentFixture(t,'codex');f.check();
 const input={run:{trace:f.request.trace},runRequest:{host:'codex',cwd:f.dir,packRoot:process.cwd(),context:{skillPrefix:'mono',projectName:f.project.name},scenario:{expectedReplies:f.request.expectedReplies,rubricDefinition:f.request.rubricDefinition},mcpServers:{monotest:{url:'test'}}},scenario:{next:'handoff',expectedRecords:f.request.expectedRecords},project:f.project,outputDir:path.join(f.dir,'missing-binding')};
 const first=await verifyTextScenarioRecords(input,async()=>({status:'passed',trace:f.request.dumpTrace,dumpDir:f.dumpDir}));
 const prepared=await verifyTextScenarioRecords({...input,resumeEvidence:first.reviewEvidence,prepareReview:true},()=>{throw Error('no new collection');});
 assert.equal(JSON.parse(fs.readFileSync(prepared.reviewEvidence)).rubricDigest,null);
 const resumed=await verifyTextScenarioRecords({...input,resumeEvidence:prepared.reviewEvidence},()=>{throw Error('no new collection');});
 assert.equal(resumed.reason,prepared.reason);assert.equal(resumed.status,prepared.status);
});

for(const host of ['claude','codex'])test(`continue9 ${host} records consumer accepts the saved clarification with same-message trailing prose`,t=>{
 const f=textFixture(t,host,'defer');
 Object.assign(f.expected,{question:{anchors:['Утверждаем']},presentation:'inline',driverStart:null,asksStart:false,intent:'unclear',reply:'ну не знаю',outcome:{approval:false,startNext:false},response:{anchors:['смущ'],question:true}});
 f.request.rubricDefinition='Saved clarification asks exactly one question in its final message; no consent or write.';
 f.request.approvalBindings=[];f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[]);f.page('documents','documents',[]);
 f.events.splice(0,f.events.length,f.assistant(f.draft+'\nУтверждаем описание?'),f.terminal,f.user(f.expected.reply),f.assistant(resumeLive.clarification));
 const initial=f.check();assert.equal(initial.status,'unverified',JSON.stringify(initial));assert.ok(initial.rubricDigest);
 f.request.rubric={digest:initial.rubricDigest,reviewer:'saved native clarification control',checks:['summary','question','response','correction'].map(id=>({id,status:'passed',evidence:'saved single-question response',reason:'No approval or start; one clarification question and a trailing imperative sentence.'}))};
 assert.equal(f.check().status,'passed',JSON.stringify(f.check()));
});

// MONO-371: refusals of a correct stage found by the live Design and Handoff runs.
function rangePatchFixture(t,state='valid'){
 const f=textFixture(t,'claude','defer'),from='Открыто:',to='## Как это видит владелец';
 let content=`## Суть сейчас\nСохраняем контекст.\n\n${from} выбрать ширину.\n\n${to}\nТаблица.\n`;
 if(state==='missing-from')content=content.replace(from,'Закрыто:');
 if(state==='ambiguous-from')content=`${from} ещё.\n${content}`;
 if(state==='missing-to')content=content.replace(to,'## Иначе');
 if(state==='ambiguous-to')content+=to+'\n';
 const doc={id:'brief',projectId,title:'Brief',content},start=content.indexOf(from),end=content.indexOf(to,start);
 const final={...doc,content:start<0||end<0?content:content.slice(0,start)+content.slice(end)};
 const patch={id:'brief',patch:[{op:'replace_range',from,to,new_string:''}]},truncated={...doc,content:'Brief… (truncated, use `get_document` for full description)'};
 f.events.splice(7,0,f.call('range-prior','mcp__monotest__get_document',{id:'brief'}),f.result('range-prior',doc),f.call('range-patch','mcp__monotest__save_document',patch),f.result('range-patch',truncated),f.call('range-read-back','mcp__monotest__get_document',{id:'brief'}),f.result('range-read-back',final));
 f.page('documents','documents',[{id:'doc'},{id:'brief'}]);f.save('documents/brief.json',final);
 return {...f,final,to};
}
test('MONO-371 document range patch replays native content and keeps the range end in place',t=>{
 const f=rangePatchFixture(t),result=f.check();assert.equal(result.status,'passed',result.reason);
 f.save('documents/brief.json',{...f.final,content:f.final.content.replace(f.to+'\n','')});
 const consumed=f.check();assert.equal(consumed.status,'failed');assert.match(consumed.reason,/mismatch.*brief\.content/);
});
for(const state of ['missing-from','ambiguous-from','missing-to','ambiguous-to'])test(`MONO-371 document range patch refuses ${state}`,t=>{
 const result=rangePatchFixture(t,state).check();assert.equal(result.status,'failed');assert.match(result.reason,/document patch range must match exactly once/);
});

for(const mode of ['record-canvas','other-canvas','longer-canvas','no-link','other-prd','prd-stage'])test(`MONO-371 Design summary binds through the canvas of its approval record (${mode})`,t=>{
 const f=u7DocumentFixture(t),prd='00000000-0000-4000-8000-0000000000d1',canvas='https://canvas.example.test/file/F1/p-1-0',design=mode!=='prd-stage';
 f.old.id=f.fresh.id=prd;f.events[1]=f.result('shown',f.old);f.events[6]=f.result('read',f.fresh);
 f.page('documents','documents',[{id:prd}]);f.save(`documents/${prd}.json`,f.fresh);
 const approval='```text\nmono-design: approved project='+projectId+' prd='+(mode==='other-prd'?'00000000-0000-4000-8000-0000000000d2':prd)+' prd-updatedAt='+f.fresh.updatedAt+' canvas='+canvas+' tool=paper images='+'a'.repeat(64)+' next=handoff by=owner\n```';
 if(design){
  Object.assign(f.expected,{stage:'design',question:{anchors:[['макет']],forbidden:[]}});
  f.record.body=approval+'\n\nВладелец: ответил «'+f.expected.reply+'»';f.events[7]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[8]=f.result('write',f.record);
  f.page('comments','comments',[f.record]);f.request.expectedRecords=[{type:'mono-design: approved',count:1}];
 }else f.page('comments','comments',[f.record,{id:'earlier-design',body:approval,createdAt:date,updatedAt:date}]);
 const link={'other-canvas':'https://canvas.example.test/file/F1/p-2-0','longer-canvas':canvas+'1','no-link':'на странице задачи'}[mode]??canvas;
 f.events[2]=f.assistant(`Источник после имени; советую одну колонку. Макет: ${link}.\n${design?'Утверждаешь этот макет?':'Принимаем этот PRD?'}`);
 f.request.packRoot=process.cwd();const result=f.check();
 // The curated fixture has no PNG archive, so a bound Design summary still stops later, at the real design gate.
 if(mode==='record-canvas'){assert.equal(result.gateResults.length,1,JSON.stringify(result));assert.equal(result.gateResults[0].command,'design');}
 else{assert.equal(result.status,'failed',JSON.stringify(result));assert.match(result.reason,/summary link does not bind native document/);}
});

for(const mode of ['lower-case-name','type','name-and-type','other-status','ambiguous-type','no-catalog'])test(`MONO-371 a status written as a name in another case or as a type resolves through the team catalog (${mode})`,t=>{
 const f=fixture(t),team='00000000-0000-4000-8000-000000000002';
 const statuses=['Backlog:backlog','Todo:unstarted','Done:completed','Released:completed'].map((row,index)=>({id:`00000000-0000-4000-8000-00000000001${index}`,name:row.split(':')[0],type:row.split(':')[1]}));
 const [state,stored]={'lower-case-name':['todo','Todo'],type:['unstarted','Todo'],'name-and-type':['backlog','Backlog'],'other-status':['backlog','Todo'],'ambiguous-type':['completed','Done'],'no-catalog':['backlog','Backlog']}[mode];
 const issue={id:'MON-1',uuid:'task',projectId,teamId:team,title:'Stage',description:'Body',status:stored,labels:[]};
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[]);f.page('issues','issues',[{id:'task'}]);f.save('issues/task/issue.json',issue);f.page('issues/task/comments','comments',[]);
 if(mode!=='no-catalog')f.save(`statuses/${team}.json`,statuses);
 f.events.splice(0,f.events.length,{type:'assistant',message:{content:[{type:'tool_use',id:'status',name:'mcp__monotest__save_issue',input:{id:'task',state}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'status',content:JSON.stringify(issue)}]}});
 f.check();const result=verifyTextRecords(f.request);
 assert.equal(result.status,['lower-case-name','type','name-and-type'].includes(mode)?'passed':'failed',JSON.stringify(result));
 if(result.status==='failed')assert.match(result.reason,/mismatch for task\.status/);
});

for(const mode of ['fragment','other-comment','longer-comment','row-address-differs'])test(`MONO-371 a record read from a comment list binds the summary by its comment fragment (${mode})`,t=>{
 const f=u7DocumentFixture(t),shownId='00000000-0000-4000-8000-0000000000c1',parent='https://linear.app/monotest/project/test';
 const shown={id:shownId,body:f.shown,createdAt:date,updatedAt:date,...(mode==='row-address-differs'?{url:`https://linear.app/monotest/issue/MON-1#comment-${shownId}`}:{})},list={comments:[shown],hasNextPage:false};
 f.events[0]=f.call('shown','mcp__monotest__list_comments',{projectId});f.events[1]=f.result('shown',list);f.events[5]=f.call('read','mcp__monotest__list_comments',{projectId});f.events[6]=f.result('read',list);
 f.events[2]=f.assistant(`Источник после имени; советую одну колонку. [PRD](${parent}#comment-${mode==='other-comment'?'00000000-0000-4000-8000-0000000000c2':mode==='longer-comment'?shownId+'0':shownId})\nПринимаем этот PRD?`);
 f.page('comments','comments',[f.record,shown]);f.request.approvalBindings[0].currentRecordId=shownId;
 if(mode==='fragment'){f.attest();assert.equal(f.check().status,'passed',f.check().reason);return;}
 const result=f.check();assert.equal(result.status,'failed',JSON.stringify(result));assert.match(result.reason,/summary link does not bind native document/);
});

async function packageStartFixture(t,mode){
 const {createHash}=await import('node:crypto'),{unwrap}=await import('./skills-proof.mjs'),f=textPrdFixture(t),id=f.request.project.id,sha=value=>createHash('sha256').update(value).digest('hex');
 const content='## Кратко\nПакет: одна задача для показа источника прогона.\n\n```js\nconst columns = 4;\n```',fenceHash=sha(content+'\n');
 const lf='```text\nmono-package: recorded project='+id+' version=1 previous=none class=new sha256='+(mode==='header-differs'?'0'.repeat(64):fenceHash)+'\n```\n\n`````mono-package\n'+content+'\n`````\n\nРевью: проверяющий согласен.';
 const body=mode==='crlf'?lf.replace(/\n/g,'\r\n'):lf; // the hash covers the fence lines with LF either way
 const question='Начинаем работу по этому пакету?',reply='принимаю';
 const packet={id:'00000000-0000-4000-8000-000000000091',body,createdAt:'2026-11-02T03:59:00Z',updatedAt:'2026-11-02T03:59:00Z'};
 const start={id:'00000000-0000-4000-8000-000000000092',createdAt:'2026-11-02T03:59:01Z',updatedAt:'2026-11-02T03:59:01Z',body:`\`\`\`text\nmono-package: start project=${id} record=${packet.id} sha256=${mode==='whole-body'?sha(body):fenceHash} issues=T1:MON-1 by=owner\napproval_status=approved\n\`\`\`\n\nВладелец: ответил «${reply}»`};
 const commentsFile=path.join(f.request.dumpDir,'comments-1.json'),comments=unwrap(JSON.parse(fs.readFileSync(commentsFile)));comments.comments.unshift(start,packet);fs.writeFileSync(commentsFile,JSON.stringify(comments));
 const dumpRows=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse);
 for(const row of dumpRows){const item=row.payload?.item;if(item?.tool==='list_comments'&&item.arguments.projectId===id)item.result=comments;}
 fs.writeFileSync(f.request.dumpTrace,timed(dumpRows,'2026-11-02T04:01:00Z').map(JSON.stringify).join('\n')+'\n');
 const assistant=text=>({type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}}),terminal={type:'event_msg',payload:{type:'task_complete'}};
 const rows=[assistant(body+'\n'+question),terminal,{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:reply}]}},
  {type:'response_item',payload:{type:'function_call',name:'mcp__monotest__list_comments',call_id:'packet-read',arguments:JSON.stringify({projectId:id})}},
  {type:'response_item',payload:{type:'function_call_output',call_id:'packet-read',output:JSON.stringify({comments:[packet],hasNextPage:false})}},
  {type:'response_item',payload:{type:'function_call',name:'mcp__monotest__save_comment',call_id:'start',arguments:JSON.stringify({projectId:id,body:start.body})}},
  {type:'response_item',payload:{type:'function_call_output',call_id:'start',output:JSON.stringify(start)}},assistant('Старт работы записан.'),terminal];
 const expected={id:'handoff',stage:'handoff',role:'transition',asksStart:true,summary:['Пакет:'],question,reply,intent:'agree',outcome:{approval:false,startNext:true},response:['Старт работы записан.']};
 f.request.expectedReplies=[expected];f.request.expectedRecords=[{type:'mono-package: start',count:1}];
 f.request.approvalBindings=mode==='unbound'?[]:[{recordId:start.id,replyId:'handoff',shownLine:1,text:body,currentLine:4,currentRecordId:packet.id}];
 for(const key of ['seedExpected','seedEndLine','seedProjectId','stageStartLine'])delete f.request[key]; // This replacement trace starts directly with Handoff.
 fs.writeFileSync(f.request.trace,timed(rows,'2026-11-02T04:00:00Z').map(JSON.stringify).join('\n')+'\n');
 return f;
}
for(const mode of ['fence','crlf','whole-body','header-differs'])test(`MONO-371 a package start binds the hash of the mono-package fence content (${mode})`,async t=>{
 const result=(await packageStartFixture(t,mode)).check(),valid=['fence','crlf'].includes(mode);
 assert.equal(result.status,valid?'passed':'failed',JSON.stringify(result));
 if(!valid)assert.match(result.reason,/written approval does not bind the shown content\/version/);
});
test('MONO-371 a package start without bindings waits for them instead of failing',async t=>{
 const result=(await packageStartFixture(t,'unbound')).check();
 assert.equal(result.status,'unverified',JSON.stringify(result));assert.match(result.reason,/shown-version binding missing/);assert.equal(result.bindingOnly,true);
});

// MONO-372: refusals of a correct stage found by the live Codex chain.
for(const mode of ['valid','wrong-text','plain-line','code'])test(`MONO-372 an empty line Linear puts before a numbered item is renderer formatting (${mode})`,t=>{
 const f=fixture(t),steps='1. Данные: источник читается из поля.\n2. Текст: колонка после имени.',lead=mode==='plain-line'?'Затем сверить вывод.':steps;
 const wrap=mode==='code'?(value=>'```\n'+value+'\n```'):(value=>value),written=wrap('Запустить проверки по порядку.\n'+lead);
 f.record.body=written;f.events[2].message.content[0].input.body=f.record.body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 const stored=wrap('Запустить проверки по порядку.\n\n'+(mode==='wrong-text'?lead.replace('после имени','перед именем'):lead));
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[{...f.record,body:stored}]);
 f.flush();const result=verifyTextRecords(f.request);assert.equal(result.status,mode==='valid'?'passed':'failed',JSON.stringify(result));
});

function techPageFixture(t,mode){
 const f=textFixture(t,'claude','defer'),prd='00000000-0000-4000-8000-0000000000e1',spec='00000000-0000-4000-8000-0000000000e2';
 const page='Добавляем «Источник» одной колонкой после имени.\nТекст и графика читают один список колонок.\nДальше: задачи.',lead='Опирался на бриф: место после имени, прочерк для пустого.\n\n',question='Утверждаешь это решение?';
 Object.assign(f.expected,{stage:mode==='other-stage'?'discovery':'tech-evaluation',asksStart:false,reply:'утверждаю',intent:'agree',outcome:{approval:true,startNext:false},question:{anchors:[['решение']],forbidden:[]},summary:['Источник'],presentation:'inline',driverStart:null,response:{anchors:[['запис']],forbidden:[],question:false}});
 f.record.body='```text\nmono-tech: approved project='+projectId+' prd='+prd+' prd-updatedAt='+date+' spec='+spec+' spec-sha256='+'b'.repeat(64)+' page-sha256='+'c'.repeat(64)+' by=owner\n```\n\n```mono-tech-page\n'+page+'\n```\n\nВладелец: ответил «утверждаю»';
 f.page('comments','comments',[f.record]);f.request.expectedRecords=[{type:'mono-tech: approved',count:1}];f.request.packRoot=process.cwd();
 f.events.splice(0,f.events.length,f.assistant(lead+page+'\n\nСоветую брать этот вариант.\n'+question),f.terminal,f.user('утверждаю'),f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body}),f.result('write',f.record),f.assistant('Утверждение записал.'));
 const binding={recordId:'r1',replyId:'decision',shownLine:1,currentLine:4,text:page,artifactStart:lead.length,artifactEnd:lead.length+page.length};
 if(mode==='wrong-start')binding.artifactStart--;
 if(mode==='fragment'){binding.text=page.slice(0,page.indexOf('\nДальше'));binding.artifactEnd=lead.length+binding.text.length;}
 if(mode==='missing-end')delete binding.artifactEnd;
 f.request.approvalBindings=[binding];
 return f;
}
for(const mode of ['valid','wrong-start','fragment','missing-end','other-stage'])test(`MONO-372 a Tech Evaluation page may start after a brief line when bound by absolute artifact bounds (${mode})`,t=>{
 const result=techPageFixture(t,mode).check();
 // The curated fixture has no PRD or Tech Spec documents, so a bound page still stops later, at the real tech gate.
 if(mode==='valid'){assert.equal(result.status,'unverified',JSON.stringify(result));assert.match(result.reason,/tech prd document absent/);return;}
 assert.equal(result.status,'failed',JSON.stringify(result));
 assert.match(result.reason,mode==='fragment'?/outgoing approved version differs from shown content/:/approval does not bind the complete displayed artifact/);
});

test('MONO-372 the owner line ends at the closing quote; a full stop after it is refused',t=>{
 const f=textFixture(t,'claude','defer');assert.equal(f.check().status,'passed',f.check().reason);
 f.record.body=f.record.body.replace(`«${f.expected.reply}»`,`«${f.expected.reply}».`);f.events[5]=f.call('write','mcp__monotest__create_comment',{projectId,body:f.record.body});f.events[6]=f.result('write',f.record);f.page('comments','comments',[f.record]);
 const result=f.check();assert.equal(result.status,'failed',JSON.stringify(result));assert.match(result.reason,/verbatim owner reply missing or substituted outside fences/);
});

// MONO-379: refusals of a correct stage found by the second live Claude chain.
const linearForms={
 'list continuation':{written:'- Пустой источник показан прочерком.\nПравило действует только на источник.\n\nДальше проверки.',stored:'* Пустой источник показан прочерком.\n  Правило действует только на источник.\n\nДальше проверки.'},
 'list continuation, other text':{written:'- Пустой источник показан прочерком.\nПравило действует только на источник.',stored:'* Пустой источник показан прочерком.\n  Правило действует на все колонки.',red:true},
 'indent after an empty line':{written:'- Пустой источник показан прочерком.\n\nПравило действует только на источник.',stored:'* Пустой источник показан прочерком.\n\n  Правило действует только на источник.',red:true},
 'indent without a list':{written:'Источник показан прочерком.\nПравило действует только на источник.',stored:'Источник показан прочерком.\n  Правило действует только на источник.',red:true},
 'table delimiter':{written:'| Имя | Источник |\n| --- | :---: |\n| a | b |',stored:'| Имя | Источник |\n| -- | :-: |\n| a | b |'},
 'table delimiter, other alignment':{written:'| Имя | Источник |\n| --- | --- |\n| a | b |',stored:'| Имя | Источник |\n| -- | :-- |\n| a | b |',red:true},
 'table cell text':{written:'| Имя | Источник |\n| --- | --- |\n| a | b |',stored:'| Имя | Источник |\n| -- | -- |\n| a | c |',red:true},
 'dash cells are not a delimiter':{written:'| Имя | Источник |\n| --- | --- |\n| - | - |',stored:'| Имя | Источник |\n| -- | -- |\n| -- | -- |',red:true},
 'code span edge spaces':{written:'Значение `  rc-02 ` с пробелами.',stored:'Значение ` rc-02` с пробелами.'},
 'code span, other text':{written:'Значение `  rc-02 ` с пробелами.',stored:'Значение ` rc-03` с пробелами.',red:true},
 'code span, one edge space':{written:'Значение ` rc-02` с пробелом.',stored:'Значение `rc-02` с пробелом.',red:true}
};
for(const [name,{written,stored,red}] of Object.entries(linearForms))test(`MONO-379 Linear issue description forms: ${name}`,t=>{
 const f=fixture(t);
 f.record.body=written;f.events[2].message.content[0].input.body=f.record.body;f.events[3].message.content[0].content=JSON.stringify(f.record);
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[{...f.record,body:stored}]);
 f.flush();const result=verifyTextRecords(f.request);assert.equal(result.status,red?'failed':'passed',JSON.stringify(result));
});

function issuePatchFixture(t,mode){
 const f=fixture(t),written='Проверить колонку.\n\n| Имя | Источник |\n| --- | --- |\n| check | `  rc-02 ` |',stored='Проверить колонку.\n\n| Имя | Источник |\n| -- | -- |\n| check | ` rc-02` |';
 const edit=mode==='unsupported'?{op:'append',text:'Ещё строка.'}:{op:'replace',old_string:mode==='missing-anchor'?'нет такой строки':mode==='ambiguous-anchor'?'|':'` rc-02`',new_string:'`"  rc-02 "`'};
 const patched=stored.replace('` rc-02`','`"  rc-02 "`'),issue={id:'MON-1',uuid:'task',projectId,title:'Stage',description:stored,status:'Todo',labels:[]},final={...issue,description:mode==='other-result'?patched.replace('check','other'):patched};
 const call=(id,input)=>({type:'assistant',message:{content:[{type:'tool_use',id,name:'mcp__monotest__save_issue',input}]}}),result=(id,value)=>({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(value)}]}});
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[]);f.page('issues','issues',[{id:'task'}]);f.save('issues/task/issue.json',final);f.page('issues/task/comments','comments',[]);
 f.events.splice(0,f.events.length,...(mode==='no-prior-write'?[]:[call('create',{title:'Stage',project:projectId,description:written}),result('create',issue)]),call('patch',{id:'MON-1',patch:[edit]}),result('patch',final));
 f.check();return verifyTextRecords(f.request);
}
test('MONO-379 an issue description patch is applied to the description the previous write returned',t=>{
 const result=issuePatchFixture(t,'valid');assert.equal(result.status,'passed',JSON.stringify(result));
});
for(const [mode,status,reason] of [['other-result','failed',/mismatch for task\.description/],['missing-anchor','failed',/issue patch old_string must match exactly once/],['ambiguous-anchor','failed',/issue patch old_string must match exactly once/],['no-prior-write','unverified',/issue patch lacks full prior description/],['unsupported','unverified',/unsupported issue patch/]])test(`MONO-379 an issue description patch stays strict (${mode})`,t=>{
 const result=issuePatchFixture(t,mode);assert.equal(result.status,status,JSON.stringify(result));assert.match(result.reason,reason);
});

for(const mode of ['child-read','other-status'])test(`MONO-379 a child agent's issue read does not break status resolution (${mode})`,t=>{
 const f=fixture(t),team='00000000-0000-4000-8000-000000000002',statuses=[{id:'00000000-0000-4000-8000-000000000010',name:'Backlog',type:'backlog'},{id:'00000000-0000-4000-8000-000000000011',name:'Todo',type:'unstarted'}];
 const issue={id:'MON-1',uuid:'task',projectId,teamId:team,title:'Stage',description:'Body',status:mode==='other-status'?'Todo':'Backlog',labels:[]};
 f.request.expectedRecords=[{type:'project'}];f.page('comments','comments',[]);f.page('issues','issues',[{id:'task'}]);f.save('issues/task/issue.json',issue);f.page('issues/task/comments','comments',[]);f.save(`statuses/${team}.json`,statuses);
 f.events.splice(0,f.events.length,
  {type:'assistant',message:{content:[{type:'tool_use',id:'status',name:'mcp__monotest__save_issue',input:{id:'task',state:'backlog'}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'status',content:JSON.stringify(issue)}]}},
  {type:'assistant',message:{content:[{type:'tool_use',id:'check-agent',name:'Agent',input:{description:'Проверка задачи',prompt:'Прочитай задачу.'}}]}},
  {type:'assistant',parent_tool_use_id:'check-agent',message:{content:[{type:'tool_use',id:'child-read',name:'mcp__monotest__get_issue',input:{id:'MON-1'}}]}},
  {type:'user',parent_tool_use_id:'check-agent',message:{content:[{type:'tool_result',tool_use_id:'child-read',content:JSON.stringify(issue)}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'check-agent',content:'Задача прочитана.'}]}});
 f.check();const result=verifyTextRecords(f.request);
 assert.equal(result.status,mode==='child-read'?'passed':'failed',JSON.stringify(result));
 if(mode==='other-status')assert.match(result.reason,/mismatch for task\.status/);
});

// Question anchors name a meaning, not one word: the live questions of both hosts must fit, a question that
// drops the object or the next stage must not.
const liveQuestions={
 'idea/approve':{fits:['Утверждаешь это описание и начинаем исследование сразу?','Утверждаете это описание и начинаем Research?'],lacks:['Утверждаешь это описание?','Начинаем исследование сразу?']},
 'tech-evaluation/approve':{fits:['Утверждаешь страницу с обоими отступлениями, и начинаем Handoff сразу после записи?','Утверждаешь решение в таком виде и начинаем Handoff?'],lacks:['Утверждаешь страницу с обоими отступлениями?','Начинаем Handoff сразу после записи?']},
 'discovery/approve':{fits:['Утверждаешь этот PRD и начинаем Design?','Утверждаешь эти требования и начинаем дизайн?'],lacks:['Утверждаешь этот PRD?']},
 'design/approve':{fits:['Утверждаешь показанный макет?','Утверждаешь эти экраны?'],lacks:['Утверждаешь?']},
 'handoff/approve':{fits:['Начинаем работу по этой записи?','Даёшь старт?'],lacks:['Согласен?']}
};
for(const [key,{fits,lacks}] of Object.entries(liveQuestions))test(`MONO-379 question anchors of ${key} fit the live wording and still need every part`,async()=>{
 const {checkAnchors}=await import('./skills-owner.mjs'),scenario=JSON.parse(fs.readFileSync(`evals/scenarios/${key}/scenario.json`,'utf8'));
 for(const host of ['claude','codex']){
  const policy=scenario.hosts[host].expectedReplies.at(-1).question;
  for(const question of fits)assert.doesNotThrow(()=>checkAnchors(policy,question,'question'),`${host}: ${question}`);
  for(const question of lacks)assert.throws(()=>checkAnchors(policy,question,'question'),/question lacks scenario anchors/,`${host}: ${question}`);
 }
});
