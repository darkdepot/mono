import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { windowReply } from './skills-owner.mjs';
const read = (host, name) => JSON.parse(fs.readFileSync(`evals/scenarios/probe/samples/${host}/${name}.json`));
const policies = { recommended: {mode:'recommended'}, label:{mode:'label',label:'Зелёный'}, correction:{mode:'correction',text:'Синий, но светлее'}, empty:{mode:'empty'}, refuse:{mode:'refuse',text:'Не буду отвечать на этот вопрос.'}, discuss:{mode:'discuss'} };
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
