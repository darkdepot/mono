// Synthetic native events for variable stage windows and seed-entry guards.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const [mode,repo,...args]=process.argv.slice(2),home=process.env.CODEX_HOME;
fs.appendFileSync(path.join(process.cwd(),'role-invocations.jsonl'),JSON.stringify(args)+'\n');
const out=e=>process.stdout.write(JSON.stringify(e)+'\n');
if(args[0]==='plugin')process.exit(0);
const persona=args.includes('--ignore-user-config')||(args.includes('--tools')&&args[args.indexOf('--tools')+1]==='');
if(persona){
 if(args[0]==='exec'){out({type:'item.completed',item:{type:'agent_message',text:'Используем поле source и прочерк.'}});out({type:'turn.completed'});}
 else{out({type:'assistant',message:{content:[{type:'text',text:'Используем поле source и прочерк.'}]}});out({type:'result',subtype:'success'});}
 process.exit(0);
}
const choices=mode==='roles-many'?12:1;
const sequence=[...Array.from({length:choices},()=> 'choice'),...(mode==='roles-mixed-free'?['free','free']:['free']),'approval',...(['roles-correction','roles-extra-target'].includes(mode)?['choice','approval']:[]),...(['roles-tail','roles-plain-tail'].includes(mode)?['free']:[])];
if(['roles-missing','roles-replaced'].includes(mode))sequence.splice(sequence.indexOf('approval'),1);
const card=step=>{
 const role=sequence[step],target=role==='approval';
 const labels=target?[mode==='roles-transition'?'Начать Discovery (Recommended)':mode==='roles-handoff'?'Передать оркестратору (Recommended)':'Утвердить, продолжу позже (Recommended)','Ещё обсудить']:['Отдельная колонка (Recommended)','Отложить'];
 if(mode==='roles-default-bad'&&!target)labels.reverse();
 const gist=target?mode==='roles-transition'?'Начинаем Discovery? Советую перейти: потребность ясна.':mode==='roles-handoff'?'Начинаем работу? Советую передать оркестратору: пакет готов.':'Утверждаем колонку? Советую начать Research: нужно проверить потребность.':'Как показывать источник прогона? Советую отдельную колонку: её видно сразу.';
 return {role,target,labels,gist,summary:target?(mode==='roles-plain-summary'?'Полный итог этого окна без четырёх разделов.':'Что: колонка. Зачем: источник виден. Дальше: Research.'):'Выбрали форму источника.',consequences:['Источник виден / таблица шире','Отложим выбор / источник скрыт']};
};
function seed(prompt){
 if(mode==='seed-incomplete')return; // successful turn, honest stop without a first write
 const input=JSON.parse(prompt.slice('Seed route '.length));fs.mkdirSync(input.dumpDir);
 const id='00000000-0000-4000-8000-000000000001',stamp='2026-11-01T00:00:00.000Z';
 fs.writeFileSync(input.projectFile,JSON.stringify({id,name:input.projectName,url:'https://linear.app/monotest/project/fixture'}));
 fs.writeFileSync(path.join(input.dumpDir,'project.json'),JSON.stringify({uuid:id,description:'Fixture',createdAt:stamp,status:{name:'Planned'}}));
 fs.writeFileSync(path.join(input.dumpDir,'comments-1.request.json'),'{}');
 fs.writeFileSync(path.join(input.dumpDir,'comments-1.json'),JSON.stringify({hasNextPage:false,comments:[{id:'approval',createdAt:stamp,updatedAt:stamp,body:'```text\nmono-prd: approved project='+id+' document=00000000-0000-4000-8000-000000000002 updatedAt='+stamp+' design=not-needed next='+(mode==='seed-mismatch'?'handoff':'tech-evaluation')+' by=owner\n```'}]}));
}
if(args[0]==='exec'){
 const file=path.join(home,'sessions','rollout-role-thread.jsonl');fs.mkdirSync(path.dirname(file),{recursive:true});
 const rows=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse):[],fresh=[];
 const item=payload=>fresh.push({type:'response_item',payload}),prompt=args.at(-1);
 if(!rows.length){item({type:'function_call',name:'mcp__monotest__get_workspace',arguments:'{}',call_id:'workspace'});item({type:'function_call_output',call_id:'workspace',output:'{"name":"Test Space"}'});}
 else if(prompt.startsWith('Seed route ')){seed(prompt);item({type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Посев готов.'}]});}
 else{
  const answered=rows.filter(r=>r.payload?.role==='user').length;
  if(prompt.startsWith('<send_user_message_question_reply>')||!prompt.startsWith('Run roles'))item({type:'message',role:'user',content:[{type:'input_text',text:prompt}]});
  const step=answered+(prompt.startsWith('Run roles')?0:1);
  if(step<sequence.length){
   const c=card(step),title=c.role==='free'?'Откуда брать источник?':c.gist+'\n'+c.labels.map((label,i)=>label+': '+c.consequences[i]).join('\n');
   if(!(mode==='roles-mixed-free'&&step===2)&&!(mode==='roles-plain-tail'&&step>sequence.indexOf('approval'))){
    item({type:'function_call',name:'request_user_input_async',call_id:'role-'+step,arguments:JSON.stringify({questions:[{title,...(c.role==='free'?{}:{options:c.labels})}]})});
    item({type:'function_call_output',call_id:'role-'+step,output:mode==='roles-unconfirmed'&&c.target?'{"accepted":false}':'{"accepted":true}'});
   }
   item({type:'message',role:'assistant',phase:(mode==='roles-thinking'&&c.target)||(mode==='roles-default-thinking'&&!c.target)?'commentary':'final_answer',content:[{type:'output_text',text:c.role==='free'?title:c.summary}]});
  }else item({type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:mode==='roles-replaced'?'Утверждаем колонку? Ответь текстом.':'Принято.'}]});
 }
 fresh.push({type:'event_msg',payload:{type:'task_complete'}});fs.writeFileSync(file,[...rows,...fresh].map(JSON.stringify).join('\n')+'\n');
 out({type:'thread.started',thread_id:'role-thread'});out({type:'turn.completed'});process.exit(0);
}
let started=false,step=0,current,freeWaiting=false;
function emit(){
 if(step>=sequence.length){out({type:'assistant',message:{content:[{type:'text',text:mode==='roles-replaced'?'Утверждаем колонку? Ответь текстом.':'Принято.'}]}});out({type:'result',subtype:'success'});return;}
 const c=card(step),q={header:'Решение',question:c.role==='free'?'Откуда брать источник?':c.gist,...(c.role==='free'?{}:{options:c.labels.map((label,i)=>({label,description:c.consequences[i]}))})};
 if(c.role==='free'){freeWaiting=true;out({type:'assistant',message:{content:[{type:'text',text:q.question}]}});out({type:'result',subtype:'success'});return;}
 current={questions:mode==='roles-twoquestions'&&step===0?[q,{...q,question:'Как подписать источник? Советую коротко: таблица компактна.'}]:[q]};
 const hidden=(mode==='roles-thinking'&&c.target)||(mode==='roles-default-thinking'&&!c.target);
 out({type:'assistant',message:{id:'role-'+step,content:[{type:hidden?'thinking':'text',...(hidden?{thinking:c.summary}:{text:c.summary})},{type:'tool_use',id:'role-'+step,name:'AskUserQuestion',input:current}]}});
 out({type:'control_request',request_id:'request-'+step,request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',tool_use_id:'role-'+step,input:current}});
}
const input=readline.createInterface({input:process.stdin});input.on('line',line=>{
 const m=JSON.parse(line);
 if(m.type==='user'&&!started){started=true;out({type:'assistant',message:{content:[{type:'tool_use',id:'workspace',name:'mcp__monotest__get_workspace',input:{}}]}});out({type:'user',message:{content:[{type:'tool_result',tool_use_id:'workspace',content:'{"name":"Test Space"}'}]}});out({type:'result',subtype:'success'});}
 else if(m.type==='user'){
  const text=m.message.content[0].text;
  if(text.startsWith('Seed route ')){seed(text);out({type:'result',subtype:'success'});}else{if(freeWaiting){freeWaiting=false;step++;}emit();}
 }else if(m.type==='control_response'){
  const response=m.response.response,entries=Object.entries(response.updatedInput?.answers??{}).filter(([,a])=>a!==''),pairs=entries.map(([q,a])=>`"${q}"="${a}"`).join(', ');
  const known=entries.every(([q,a])=>current.questions.find(item=>item.question===q).options?.some(o=>o.label===a));
  const content=response.behavior==='deny'?response.message:!entries.length?'The user did not answer the questions.':known?`Your questions have been answered: ${pairs}. You can now continue with these answers in mind.`:`The user answered: ${pairs}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`;
  out({type:'user',message:{content:[{type:'tool_result',tool_use_id:'role-'+step,content,...(response.behavior==='deny'?{is_error:true}:{})}]},...(response.behavior==='allow'?{tool_use_result:response.updatedInput}:{})});step++;emit();
 }
});input.on('close',()=>process.exit(0));
