// Synthetic host transport around the real MCP envelope shape. No network.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const [mode,...args]=process.argv.slice(2),emit=e=>process.stdout.write(JSON.stringify(e)+'\n');
if(args[0]==='plugin')process.exit(0);
const id='00000000-0000-4000-8000-000000000001',stamp='2026-11-01T00:00:00Z';
function result(tool,input){
 if(tool==='save_project')return {id:'foreign',url:'https://linear.app/working/issue/x'};
 if(tool==='get_workspace')return {name:'Mono Test'};
 if(tool==='get_project')return {uuid:id,name:'fixed-run',description:'Exact project',url:'https://linear.app/monotest/project/fixed'};
 if(tool==='list_comments')return {comments:input.issueId?[]:[{id:input.cursor?'c2':'c1',body:'comment',createdAt:stamp,updatedAt:stamp}],hasNextPage:!input.issueId&&!input.cursor,...(!input.issueId&&!input.cursor?{cursor:'c1'}:{})};
 if(tool==='list_documents')return {documents:[{id:'doc'}],hasNextPage:false};
 if(tool==='get_document')return {id:'doc',projectId:id,title:'Document',content:'Full text'};
 if(tool==='list_issues')return {issues:[{id:'MON-1',uuid:'issue'}],hasNextPage:false};
 if(tool==='get_issue')return {id:'MON-1',uuid:'issue',projectId:id,title:'Task',description:'Full task',status:'Done',labels:[]};
 throw new Error('unexpected fixed tool');
}
function plan(prompt,first){
 if(first)return {tool:'get_workspace',input:{}};
 const m=prompt.match(/const r = await tools\.mcp__monotest__(\w+)\((\{.*\})\); text\(r\);/);if(!m)throw new Error('scripted request missing');
 return {tool:mode==='foreign'?'save_project':m[1],input:JSON.parse(m[2])};
}
if(args[0]==='exec'){
 const dir=path.join(process.env.CODEX_HOME,'sessions');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'rollout-fixed-dump.jsonl'),first=!fs.existsSync(file),job=plan(args.at(-1),first),call='call-'+(first?0:fs.readFileSync(file,'utf8').split('\n').length),server=!first&&mode==='foreign'?'linear':'monotest';
 const raw={content:[{type:'text',text:JSON.stringify(result(job.tool,job.input))}]},tool=`mcp__${server}__${job.tool}`;
 let rows=[{type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:call,input:`const r = await tools.${tool}(${JSON.stringify(job.input)}); text(r);`}},
  {type:'event_msg',payload:{type:'item_completed',item:{id:'native-'+call,type:'McpToolCall',server,tool:job.tool,arguments:job.input,status:'completed',result:raw}}},
  {type:'response_item',payload:{type:'custom_tool_call_output',call_id:call,output:[{type:'text',text:'Script completed'},{type:'text',text:JSON.stringify(raw)}]}},
 ...(!first&&mode==='shell'?[{type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:call+'-shell',arguments:'{"cmd":"rg x session"}'}}]:[]),{type:'event_msg',payload:{type:'task_complete'}}];
 if(!first&&mode==='read-unavailable'){
  const sample=JSON.parse(fs.readFileSync(new URL('./skills-records-live7.json',import.meta.url)));
  rows=[rows[0],{...sample.failedRead[1],payload:{...sample.failedRead[1].payload,call_id:call}},rows.at(-1)];
 }
 if(first)rows.unshift({type:'session_meta'});
 fs.appendFileSync(file,rows.map(e=>JSON.stringify({...e,timestamp:new Date().toISOString()})).join('\n')+'\n');emit({type:'thread.started',thread_id:'fixed-dump'});emit({type:'turn.completed'});
}else{
 let n=0;readline.createInterface({input:process.stdin}).on('line',l=>{
  const e=JSON.parse(l);if(e.type!=='user')return;const first=n++===0,job=plan(e.message.content[0].text,first),call='call-'+n,server=!first&&mode==='foreign'?'linear':'monotest';
  if(!first&&mode==='shell')emit({type:'assistant',message:{content:[{type:'tool_use',id:call+'-shell',name:'Bash',input:{command:'rg x session'}}]}});
  emit({type:'assistant',message:{content:[{type:'tool_use',id:call,name:`mcp__${server}__${job.tool}`,input:job.input}]}});
  emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:call,content:JSON.stringify({content:[{type:'text',text:JSON.stringify(result(job.tool,job.input))}]})}]}});emit({type:'result',subtype:'success'});
 });
}
