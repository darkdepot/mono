// Test subprocess. Transport shapes are from MONO-287; run content is synthetic.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const [mode,repo,...args]=process.argv.slice(2);
const home=process.env.CODEX_HOME;
fs.appendFileSync(path.join(process.cwd(),'invocations.jsonl'),JSON.stringify({args,home})+'\n');
const out=e=>process.stdout.write(JSON.stringify(e)+'\n');
const sample=JSON.parse(fs.readFileSync(path.join(repo,'evals/scenarios/probe/samples/claude/trace-control-v0.41.0-approval.json')));
const summary=sample.events.find(r=>r.line===138).event;
const window=sample.events.find(r=>r.line===139).event;
const questions=window.message.content[0].input.questions;
const proof={name:'Test Space'};
if(args[0]==='plugin'){process.exit(0);}
if(mode==='crash'){process.exit(3);}
if(mode==='timeout'){setInterval(()=>{},1000);}
else if(args[0]==='exec'){
 const persona=args.includes('--ignore-user-config');
 if(persona){out({type:'item.completed',item:{type:mode==='persona-tool'?'command_execution':'agent_message',text:'Предпочитаю синий.'}});out({type:'turn.completed'});process.exit(0);}
 const file=path.join(home,'sessions','rollout-synthetic-thread.jsonl');fs.mkdirSync(path.dirname(file),{recursive:true});
 const rows=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l)):[];
 const prompt=args.at(-1),fresh=[];
 const item=payload=>fresh.push({type:'response_item',payload});
 if(!rows.length){
  item({type:'function_call',name:'exec',call_id:'read',arguments: 'const r = await tools.mcp__monotest__get_workspace({}); text(r);'});
  item({type:'function_call_output',call_id:'read',output:JSON.stringify(mode==='wrong-space'?{name:'Other Space'}:proof)});
  if(mode==='write-before-proof')item({type:'function_call',name:'mcp__monotest__save_project',call_id:'early',arguments:'{}'});
 }else if(mode==='free'&&rows.length<5){item({type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Какой цвет предпочитаешь?'}]});
 }else if(!prompt.startsWith('<send_user_message_question_reply>')&&!prompt.startsWith('Не буду')){
  if(mode==='linear')item({type:'custom_tool_call',name:'exec',call_id:'bad',input:'await tools.mcp__linear__save_project({});'});
  const async=JSON.parse(fs.readFileSync(path.join(repo,'evals/scenarios/probe/samples/codex/trace-control-v0.41.0-async-order.json'))).items;
  if(mode!=='missing')item({...async[0],call_id:'window-1'});
  item(async[1]);item(async[2]);
  if(mode==='late-tool')item({type:'function_call',name:'mcp__monotest__get_workspace',call_id:'late',arguments:'{}'});
 }else{if(mode!=='unanswered')item({type:'message',role:'user',content:[{type:'input_text',text:prompt}]});item({type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Принято.'}]});}
 fresh.push({type:'event_msg',payload:{type:mode==='cut'?'task_started':'task_complete'}});
 fs.writeFileSync(file,[...rows,...fresh].map(e=>JSON.stringify(e)).join('\n')+'\n');
 out({type:'thread.started',thread_id:'synthetic-thread'});out({type:'turn.completed'});process.exit(0);
}else if(args.includes('--tools')&&args[args.indexOf('--tools')+1]===''){
 out({type:'assistant',message:{content:[mode==='persona-tool'?{type:'tool_use',name:'Read'}:{type:'text',text:'Предпочитаю синий.'}]}});out({type:'result',subtype:'success'});process.exit(0);
}else{
 let stage=false,free=false;
 const read=readline.createInterface({input:process.stdin});
 read.on('line',line=>{
  const m=JSON.parse(line);
  if(m.type==='user'&&!stage){
   stage=true;
   out({type:'assistant',message:{content:[{type:'tool_use',id:'read',name:'mcp__monotest__get_workspace',input:{}}]}});
   out({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read',content:JSON.stringify(mode==='wrong-space'?{name:'Other Space'}:proof)}]}});
   out({type:'result',subtype:'success'});
  }else if(m.type==='user'){
   if(mode==='free'&&!free){free=true;
    out({type:'assistant',message:{content:[{type:'text',text:'Какой цвет предпочитаешь?'}]}});out({type:'result',subtype:'success'});return;
   }
   if(mode==='linear'){
    out({type:'control_request',request_id:'blocked',request:{subtype:'can_use_tool',tool_name:'mcp__linear__save_project',input:{}}});return;
   }
   if(mode==='cut'){process.stdout.write('{"type":');process.exit(0);}
   if(mode==='child')out({type:'result',subtype:'error_during_execution',is_error:true,parent_tool_use_id:'child'});
   out(summary);
   if(mode==='missing'){out({type:'result',subtype:'success'});return;}
   out(window);
   out({type:'control_request',request_id:'request-window',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions}}});
  }else if(m.type==='control_response'){
   if(m.response.request_id==='blocked'){
    if(m.response.response.behavior!=='deny')fs.writeFileSync(path.join(path.dirname(process.argv[1]),'forbidden-write'),'executed');
    process.exit(0);
   }
   if(mode!=='unanswered')out({type:'user',message:{content:[{type:'tool_result',tool_use_id:'<tool-use-id>',content:'answered'}]}});
   out({type:'assistant',message:{content:[{type:'text',text:'Принято.'}]}});out({type:'result',subtype:'success'});
  }
 });
 read.on('close',()=>process.exit(0));
}
