// Synthetic subprocess fixture for the real isolated, read-only dump driver.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const [mode,...args]=process.argv.slice(2),emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const name=mode==='write'?'mcp__monotest__save_project':'mcp__monotest__list_documents';
if(args[0]==='plugin')process.exit(0);
if(args[0]==='exec'){
 const home=process.env.CODEX_HOME,dir=path.join(home,'sessions');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'rollout-dump-thread.jsonl'),first=!fs.existsSync(file),id=first?'workspace':'dump',turn=first?'confirm':'read';
 const tool=first?'exec':name,input=first?'const r = await tools.mcp__monotest__get_workspace({}); text(r);':'{}';
 const events=[{type:'event_msg',payload:{type:'task_started',turn_id:turn}},
  {type:'response_item',payload:{type:'function_call',name:tool,call_id:id,arguments:input}},
  {type:'response_item',payload:{type:'function_call_output',call_id:id,output:JSON.stringify(first?{name:'Mono Test'}:{documents:[],hasNextPage:false})}},
  {type:'event_msg',payload:{type:'task_complete',turn_id:turn}}];
 fs.appendFileSync(file,events.map(e=>JSON.stringify(e)).join('\n')+'\n');emit({type:'thread.started',thread_id:'dump-thread'});emit({type:'turn.completed'});
}else{
 let phase=0;
 readline.createInterface({input:process.stdin}).on('line',line=>{
  const message=JSON.parse(line);if(message.type!=='user')return;
  const tool=phase++===0?'mcp__monotest__get_workspace':name,id=String(phase);
  emit({type:'assistant',message:{content:[{type:'tool_use',id,name:tool,input:{}}]}});
  emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(phase===1?{name:'Mono Test'}:{documents:[],hasNextPage:false})}]}});
  emit({type:'result',subtype:'success'});
 });
}
