// Constructed native forms; no real host, MCP service or owner is invoked.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const [mode,...rawArgs]=process.argv.slice(2),home=process.env.CODEX_HOME;
const userBeforeStart=rawArgs.includes('--user-before-start'),args=rawArgs.filter((a,i)=>a!=='--user-before-start'&&a!=='--plan'&&rawArgs[i-1]!=='--plan');
const planIndex=rawArgs.indexOf('--plan');
const plan=planIndex<0?null:JSON.parse(fs.readFileSync(rawArgs[planIndex+1],'utf8'));
let planTurn=0;
const out=e=>process.stdout.write(JSON.stringify(e)+'\n');
const samples=JSON.parse(fs.readFileSync(new URL('./skills-text-responses.json',import.meta.url)));
const response=()=>samples.find(sample=>sample.id===mode)?.actual??(mode==='unclear'?'Что смущает?':mode==='correction'?'Добавлен вопрос про Codex.':'Утверждение записал.');
const message='Что: колонка Источник.\nУтверждаем и начинаем Research?';
if(args[0]==='plugin')process.exit(0);
if(args[0]==='exec') {
 const file=path.join(home,'sessions','rollout-text-thread.jsonl');fs.mkdirSync(path.dirname(file),{recursive:true});
 const rows=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse):[],fresh=[];
 const item=payload=>fresh.push({type:'response_item',payload}),prompt=args.at(-1);
 const turnId='text-turn-'+rows.length,start=()=>fresh.push({type:'event_msg',payload:{type:'task_started',turn_id:turnId}});
 if(!userBeforeStart||!rows.length)start();
 if(!rows.length){item({type:'function_call',name:'mcp__monotest__get_workspace',call_id:'workspace',arguments:'{}'});item({type:'function_call_output',call_id:'workspace',output:'{"name":"Test Space"}'});}
 else {
  if(mode!=='drop-reply'||prompt==='Run text')item({type:'message',role:'user',content:[{type:'input_text',text:prompt}]});
  if(userBeforeStart)start();
  if(mode==='extra-owner'&&prompt!=='Run text')item({type:'message',role:'user',content:[{type:'input_text',text:'Начинай Research'}]});
  const text=plan?plan.messages[rows.filter(r=>r.type==='response_item'&&r.payload?.type==='message'&&r.payload.role==='user').length]:prompt==='Run text'?message:response();
  if(mode==='window')item({type:'function_call',name:'request_user_input_async',call_id:'bad',arguments:'{"questions":[{"title":"Выбор?"}]}'});
  item({type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]});
 }
 fresh.push({type:'event_msg',payload:{type:'task_complete',turn_id:turnId}});
 if(mode==='extra-response'&&prompt!=='Run text'&&rows.length){fresh.push({type:'event_msg',payload:{type:'task_started',turn_id:turnId+'-extra'}});item({type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Start Research?'}]});fresh.push({type:'event_msg',payload:{type:'task_complete',turn_id:turnId+'-extra'}});}
 fs.writeFileSync(file,[...rows,...fresh].map(JSON.stringify).join('\n')+'\n');
 out({type:'thread.started',thread_id:'text-thread'});out({type:'turn.completed'});process.exit(0);
}
let started=false;
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{
 const e=JSON.parse(line);if(e.type!=='user')return;
 if(!started){started=true;out({type:'assistant',message:{content:[{type:'tool_use',id:'workspace',name:'mcp__monotest__get_workspace',input:{}}]}});out({type:'user',message:{content:[{type:'tool_result',tool_use_id:'workspace',content:'{"name":"Test Space"}'}]}});}
 else {
  if(args.includes('--replay-user-messages')&&mode!=='drop-reply')out(e);
  if(mode==='extra-owner'&&e.message.content[0].text!=='Run text')out({...e,message:{role:'user',content:[{type:'text',text:'Начинай Research'}]}});
  const prompt=e.message.content[0].text,text=plan?plan.messages[planTurn++]:prompt==='Run text'?message:response();
  if(plan?.background&&planTurn===1){
   for(const event of plan.background)out(event);
   if(!plan.omitContinuation)setTimeout(()=>{
    out({type:'system',subtype:'task_notification',task_id:'scout-0',status:'completed'});
    out({type:'system',subtype:'background_tasks_changed',tasks:[]});
    out({type:'assistant',message:{content:[{type:'text',text}]}});out({type:'result',subtype:'success'});
   },30);
   return;
  }
  if(mode==='window')out({type:'assistant',message:{content:[{type:'tool_use',id:'bad',name:'AskUserQuestion',input:{questions:[]}}]}});
  out({type:'assistant',message:{content:[{type:'text',text}]}});
 }
 out({type:'result',subtype:'success'});
 if(mode==='extra-response'&&e.message.content[0].text!=='Run text'&&e.message.content[0].text==='принимаю'){out({type:'assistant',message:{content:[{type:'text',text:'Start Research?'}]}});out({type:'result',subtype:'success'});}
});input.on('close',()=>process.exit(0));
