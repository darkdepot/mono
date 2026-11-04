import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { windowReply } from './test-fixtures/legacy-window-owner.mjs';
import { correctedVersion } from './skills-owner.mjs';
import { nativeProof } from './skills-proof.mjs';
function claudeReplyDelivered(block,reply){
 const callId='window',call={type:'assistant',message:{content:[{type:'tool_use',id:callId,name:'AskUserQuestion'}]}},result={type:'user',message:{content:[{...block,tool_use_id:callId}]}};
 return nativeProof({host:'claude',kind:'answer',call,result,callId,reply}).status==='confirmed';
}
const read = (host, name) => JSON.parse(fs.readFileSync(`evals/scenarios/probe/samples/${host}/${name}.json`));
const policies = { recommended: {mode:'recommended'}, label:{mode:'label',label:'Зелёный'}, correction:{mode:'correction',text:'Синий, но светлее'}, empty:{mode:'empty'}, refuse:{mode:'refuse',text:'Не буду отвечать на этот вопрос.'}, discuss:{mode:'discuss'} };
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
