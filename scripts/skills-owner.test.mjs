import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { windowReply } from './test-fixtures/legacy-window-owner.mjs';
import { correctedVersion } from './skills-owner.mjs';
import { windowReply as currentWindowReply } from './skills-owner.mjs';
import { nativeProof as textProof } from './skills-proof.mjs';
import { nativeProof as windowProof } from './test-fixtures/legacy-window-proof.mjs';
const nativeProof=request=>['window','answer'].includes(request.kind)?windowProof(request):textProof(request);
function claudeReplyDelivered(block,reply){
 const callId='window',call={type:'assistant',message:{content:[{type:'tool_use',id:callId,name:'AskUserQuestion'}]}},result={type:'user',message:{content:[{...block,tool_use_id:callId}]}};
 return nativeProof({host:'claude',kind:'answer',call,result,callId,reply}).status==='confirmed';
}
const read = (host, name) => JSON.parse(fs.readFileSync(`evals/scenarios/probe/samples/${host}/${name}.json`));
const policies = { recommended: {mode:'recommended'}, label:{mode:'label',label:'Зелёный'}, correction:{mode:'correction',text:'Синий, но светлее'}, empty:{mode:'empty'}, refuse:{mode:'refuse',text:'Не буду отвечать на этот вопрос.'}, discuss:{mode:'discuss'} };
test('historical Codex refusal uses the native call and every question identity',()=>{
 const input={questions:[{title:'Первый вопрос?',options:['Да','Нет']},{title:'Второй вопрос?',options:['Да','Нет']}]},callId='refusal-window',policy={mode:'refuse',text:'Не утверждаю'};
 const prompt=currentWindowReply('codex',input,policy,callId),call={type:'response_item',payload:{type:'function_call',name:'request_user_input_async',call_id:callId,arguments:JSON.stringify(input)}},result={type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:prompt}]}};
 assert.equal(textProof({host:'codex',kind:'answer',call,result,callId,prompt}).status,'confirmed');
 const replies=JSON.parse(prompt.replace(/^<send_user_message_question_reply>\n/,'').replace(/\n<\/send_user_message_question_reply>\n$/,''));
 assert.deepEqual(replies,input.questions.map((q,i)=>({questionItemId:JSON.stringify(['request_user_input_async',callId,i]),question:q.title,answer:policy.text})));
 assert.equal(textProof({host:'codex',kind:'answer',call,result,callId:'different-window',prompt}).status,'unverified');
});
for(const after of ['$&','$$','$`',"$'"])test(`named correction preserves literal replacement token ${after}`,()=>{
 assert.equal(correctedVersion('left old right',{correction:{before:'old',after}}),'left '+after+' right');
});
for (const host of ['claude','codex']) for (const [name, policy] of Object.entries(policies)) test(`${host} ${name} reply matches captured transport`, () => {
  const sample=read(host,name);
  const input=host==='claude'?sample.request.request.input:sample.call.arguments;
  const result=windowReply(host,input,name==='refuse'&&host==='claude'?{mode:'refuse',text:'The user declined to answer.'}:policy,host==='claude'?'<uuid>':'<call-id>');
  const expected=host==='claude'?sample.response:sample.answerAsUserMessage[0].text;
  assert.deepEqual(result,expected);
});
test('unknown label and missing deterministic answer are refused instead of guessed',()=>{
  const input=read('codex','label').call.arguments;
  for(const policy of [{mode:'label',label:'absent'},{mode:'correction'},{mode:'other'}]) assert.throws(()=>windowReply('codex',input,policy,'call'));
});

for(const name of Object.keys(policies))test(`Claude ${name} delivery requires its exact captured receipt`,()=>{
 const sample=read('claude',name);
 assert.equal(claudeReplyDelivered(sample.toolResult,sample.response),true);
 assert.equal(claudeReplyDelivered({...sample.toolResult,content:'unrelated answer'},sample.response),false);
 assert.equal(claudeReplyDelivered({...sample.toolResult,is_error:name==='refuse'?false:true},sample.response),false);
});

test('text owner sends the scenario reply verbatim and never infers its outcome',async()=>{
 const {textReply,validateReplies}=await import('./skills-owner.mjs');
 const expected=[{id:'idea',stage:'idea',role:'approval',summary:['Что'],question:'Утверждаем и начинаем Research?',reply:'принимаю',intent:'agree',asksStart:true,outcome:{approval:true,startNext:true},response:['Утверждение записал.']}];
 validateReplies(expected);
 assert.equal(textReply({expectedReplies:expected},'Что: версия.\nУтверждаем и начинаем Research?',0),'принимаю');
 assert.throws(()=>textReply({expectedReplies:expected},'Другой вопрос?',0),/question|summary/);
 assert.throws(()=>validateReplies([{...expected[0],outcome:undefined}]),/outcome/);
});

test('last text reply must declare its allowed complete stage response before a run',async()=>{
 const {validateReplies}=await import('./skills-owner.mjs');
 const reply={id:'last',stage:'idea',role:'approval',summary:['Версия'],question:'Утверждаем?',reply:'принимаю',intent:'agree',asksStart:false,outcome:{approval:true,startNext:false}};
 assert.throws(()=>validateReplies([reply]),/response/);
 for(const response of [[],[''],['   '],'Записал.'])assert.throws(()=>validateReplies([{...reply,response}]),/response/);
 validateReplies([{...reply,response:['Утверждение записал.']}]);
});
test('text record framing must be literal strings declared by the scenario',async()=>{
 const {validateReplies}=await import('./skills-owner.mjs');
 const reply={id:'last',stage:'idea',role:'approval',summary:['Версия'],question:'Утверждаем?',reply:'принимаю',intent:'agree',asksStart:false,outcome:{approval:true,startNext:false},response:['Записал.']};
 for(const framing of [null,[],{},'prefix',{before:'',after:1}])assert.throws(()=>validateReplies([{...reply,framing}]),/framing/);
 validateReplies([{...reply,framing:{before:'Итог:\n',after:'\nМой совет.\nУтверждаем?'}}]);
});

test('U7 anchor policy accepts alternate wording but retains structural reply and correction checks',async()=>{
 const {validateReplies,textReply,checkStageResponse,correctedVersion}=await import('./skills-owner.mjs');
 const r={id:'prd',stage:'discovery',role:'approval',summary:['Источник'],question:{anchors:['PRD'],forbidden:['Design']},reply:'принимаю',intent:'correction',asksStart:false,outcome:{approval:true,startNext:false},response:{anchors:['запис','экспорт'],forbidden:['Design'],question:false},correction:{before:'Без фильтра.',anchors:['экспорт','не входит'],descriptionAnchors:['экспорт']},presentation:'document',driverStart:null};
 validateReplies([r]);
 assert.equal(textReply({expectedReplies:[r]},'Колонка Источник; советую это PRD.\nПринимаем PRD в таком виде?',0),'принимаю');
 checkStageResponse(r,'Экспорт: экспорт не входит. Утверждение записал.');
 assert.equal(correctedVersion('А. Без фильтра. Б.',r,'А. Фильтр и экспорт не входит. Б.'),'А. Фильтр и экспорт не входит. Б.');
 assert.throws(()=>correctedVersion('А. Без фильтра. Б.',r,'Лишнее. Фильтр и экспорт не входит. Б.'),/outside|passage/);
 assert.throws(()=>checkStageResponse(r,'Записал; экспорт исключён. Начинаем Design?'),/forbidden|question/);
 assert.throws(()=>textReply({expectedReplies:[r]},'Источник\nНачинаем Design?',0),/question/);
 assert.throws(()=>validateReplies([{...r,by:'orchestrator',reason:'так',reply:'принимаю, так',driverStart:'design',outcome:{approval:true,startNext:true}}]),/authority|delegated/);
});

for(const stage of ['idea','discovery','tech-evaluation'])test(`continue1 ${stage}: harmless deferred mention passes; literal start offers remain forbidden`,async()=>{
 const {checkStageResponse}=await import('./skills-owner.mjs');
 const file=new URL(`../evals/scenarios/${stage}/correction/scenario.json`,import.meta.url),expected=JSON.parse(fs.readFileSync(file)).hosts.codex.expectedReplies[0];
 const next={idea:'Research',discovery:'Design','tech-evaluation':'Handoff'}[stage];
 for(const mention of [`${next} пока не начинаю.`,`Не начинаю ${next}.`,`${next} начнём позже.`])checkStageResponse(expected,`Экспорт исключён. Утверждение записал. ${mention}`);
 for(const offer of [`Начинаю ${next}.`,`Начнём ${next}?`])assert.throws(()=>checkStageResponse(expected,`Экспорт исключён. Утверждение записал.\n${offer}`),/forbidden|question/);
});

test('continue9 saved clarification question need not be the final character',async()=>{
 const {checkStageResponse}=await import('./skills-owner.mjs');
 const expected=JSON.parse(fs.readFileSync('evals/scenarios/idea/empty/scenario.json')).hosts.claude.expectedReplies[0];
 const {clarification}=JSON.parse(fs.readFileSync(new URL('./test-fixtures/skills-resume-live-regressions.json',import.meta.url)));
 assert.doesNotThrow(()=>checkStageResponse(expected,clarification));
 assert.throws(()=>checkStageResponse(expected,clarification+' Что ещё?'),/question/);
 assert.throws(()=>checkStageResponse(expected,clarification.replace('?','.')),/question/);
 assert.throws(()=>checkStageResponse(expected,clarification.replace('?','.')+' https://linear.app/monotest/project/x?tab=overview'),/question/,'a link query is not a question');
});
