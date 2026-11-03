import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyRecords, dumpPrompt, collectRecordDump, verifyScenarioRecords } from './skills-records.mjs';
import { nativeRecords } from './skills-record-data.mjs';

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
   const relative=path.relative(dumpDir,file),value=JSON.parse(fs.readFileSync(file)),kind=/^comments-/.test(name)?'list_comments':/^documents-/.test(name)?'list_documents':/^issues-/.test(name)?'list_issues':/^projects-/.test(name)?'list_projects':relative==='project.json'?'get_project':name==='issue.json'?'get_issue':'get_document';
   const page=kind.startsWith('list_'),scope=relative.startsWith('issues/')?relative.split('/')[1]:projectId;
   const input=page?{...(kind==='list_projects'?{query:request.projectName}:{[kind==='list_issues'?'project':scope===projectId?'projectId':'issueId']:scope}),...(['list_issues','list_projects'].includes(kind)?{includeArchived:true}:{}),...(fs.existsSync(file.replace(/\.json$/,'.request.json'))?JSON.parse(fs.readFileSync(file.replace(/\.json$/,'.request.json'))):{})}:{id:value.uuid??value.id};
   const id=String(reads.length);
   if(request.host==='claude')reads.push({type:'assistant',message:{content:[{type:'tool_use',id,name:`mcp__monotest__${kind}`,input}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(value)}]}});
   else reads.push({type:'response_item',payload:{type:'function_call',name:`mcp__monotest__${kind}`,call_id:id,arguments:JSON.stringify(input)}},{type:'response_item',payload:{type:'function_call_output',call_id:id,output:JSON.stringify(value)}});
  }};
  walk(dumpDir);fs.writeFileSync(dumpTrace,timed([...reads,terminal],'2026-11-02T04:01:00Z').map(e=>JSON.stringify(e)).join('\n')+'\n');
 };flush();
 const check=()=>{flush();return verifyRecords(request);};
 return {dir,dumpDir,project,record,events,save,page,check,request};
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
  assert.equal(collected.dumpComplete,true);assert.equal(collected.dumpFiles.length,8);
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

function textPrdFixture(t,delegated=false) {
 const f=liveFixture(t,'discovery-approve'),binding=f.request.approvalBindings[0],question='Принимаем показанный PRD?',reply=delegated?'Принимаю PRD: причина — требования проверяемы.':'принимаю';
 const expected={id:'prd',stage:'discovery',role:'approval',asksStart:false,summary:['## Кратко','## Требования'],question,reply,intent:'agree',outcome:{approval:true,startNext:false},...(delegated?{by:'orchestrator',reason:'требования проверяемы.'}:{})};
 const transform=value=>{
  if(typeof value==='string'){
   try{return JSON.stringify(transform(JSON.parse(value)));}catch{}
   if(value.includes('mono-prd: approved'))return value.replace('by=owner','by='+(delegated?'orchestrator':'owner'))+'\n\nВладелец: ответил «'+reply+'»'+(delegated?'\nПричина: требования проверяемы.':'');
   return value;
  }
  if(Array.isArray(value))return value.map(transform);
  return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,transform(v)])):value;
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
 const dumpRows=fs.readFileSync(f.request.dumpTrace,'utf8').trim().split('\n').map(JSON.parse);fs.writeFileSync(f.request.dumpTrace,timed(transform(dumpRows),'2026-11-02T04:01:00Z').map(JSON.stringify).join('\n')+'\n');
 return f;
}
for(const delegated of [false,true])test(`text PRD binds updatedAt and native reads through real route gate; delegated=${delegated}`,t=>{
 const f=textPrdFixture(t,delegated),r=f.check();assert.equal(r.status,'passed',r.reason);assert.equal(r.gateResults[0].result.ok,true);
 if(delegated){f.request.expectedReplies[0].by='owner';assert.equal(f.check().status,'failed');}
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
