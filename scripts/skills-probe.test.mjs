import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { probeClaude as readProbe } from './skills-probe.mjs';

// These legacy probe fixtures deliberately check only current-turn text.
// Complete execution and delivery are covered by the shared equality table.
const probeClaude=file=>readProbe(file,{phase:'excerpt'});
const samples = 'evals/scenarios/probe/samples';
const fixture = (host, name) => `${samples}/${host}/${name}.json`;
const read = (host, name) => JSON.parse(fs.readFileSync(fixture(host, name), 'utf8'));
const defect = () => read('claude', 'trace-defect-v0.38.1-approval');
const control = () => read('claude', 'trace-control-v0.41.0-approval');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-skills-probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };
}
const cli = file => spawnSync(process.execPath, ['scripts/skills-probe.mjs', file, '--excerpt'], { encoding: 'utf8' });

test('recorded v0.38.1 defect fails at the original window line; fixed control passes', () => {
  const bad = probeClaude(fixture('claude', 'trace-defect-v0.38.1-approval'));
  assert.equal(bad.status, 'failed');
  assert.equal(bad.windows.length, 1);
  assert.deepEqual(bad.windows[0].textLines, []);
  assert.deepEqual(bad.windows[0].thinkingLines, [227]);
  assert.equal(bad.windows[0].toolResult, 187);
  assert.match(bad.windows[0].evidence, /:228$/);
  const good = probeClaude(fixture('claude', 'trace-control-v0.41.0-approval'));
  assert.equal(good.status, 'passed');
  assert.deepEqual(good.windows[0].textLines, [138]);
  assert.match(good.windows[0].evidence, /:139$/);
  assert.equal(cli(fixture('claude', 'trace-defect-v0.38.1-approval')).status, 1);
  assert.equal(cli(fixture('claude', 'trace-control-v0.41.0-approval')).status, 0);
});

test('each new user turn discards earlier text for strings, blocks and tool results', t => {
  const write = scratch(t);
  const window = structuredClone(control().events.find(r => r.line === 139).event);
  const summary = { type: 'assistant', message: { content: [{ type: 'text', text: 'Visible position' }] } };
  for (const content of ['Continue', [{ type: 'text', text: 'Continue' }], [],
    [{ type: 'tool_result', tool_use_id: 'tool', content: 'ok' }]]) {
    const user = { type: 'user', message: { content } };
    const stream = [summary, window, user, { ...window,
      message: { content: [{ ...window.message.content[0], id: 'next-window' }] } }];
    const file = write('two-turns.jsonl', stream.map(event => JSON.stringify(event)).join('\n'));
    const report = probeClaude(file);
    assert.equal(report.status, 'failed', JSON.stringify(content));
    assert.deepEqual(report.windows.map(w => w.status), ['passed', 'failed']);
    assert.deepEqual(report.windows[1].textLines, []);
    assert.equal(cli(file).status, 1);
    stream.splice(3, 0, summary);
    assert.equal(probeClaude(write('current-turn.jsonl', stream.map(event => JSON.stringify(event)).join('\n'))).status, 'passed');
  }
});

test('result and system init delimit turns without an intervening user event', t => {
  const write = scratch(t);
  const window = structuredClone(control().events.find(r => r.line === 139).event);
  const summary = { type: 'assistant', message: { content: [{ type: 'text', text: 'Earlier turn' }] } };
  const thinking = { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'New turn' }] } };
  const result = { type: 'result', subtype: 'success' }, init = { type: 'system', subtype: 'init' };
  for (const boundary of [[result], [init], [result, init]]) {
    const events = [summary, ...boundary, thinking, window];
    const file = write('no-user.jsonl', events.map(e => JSON.stringify(e)).join('\n'));
    const report = probeClaude(file);
    assert.equal(report.status, 'failed', JSON.stringify(boundary));
    assert.deepEqual(report.windows[0].textLines, []);
    assert.deepEqual(report.windows[0].thinkingLines, [events.length - 1]);
    assert.equal(report.windows[0].toolResult, null);
    assert.equal(cli(file).status, 1);
    events.splice(events.length - 1, 0, summary);
    assert.equal(probeClaude(write('current-turn.jsonl', events.map(e => JSON.stringify(e)).join('\n'))).status, 'passed');
  }
  const sameTurn = [summary, { type: 'system', subtype: 'thinking_tokens' }, window];
  assert.equal(probeClaude(write('same-turn.jsonl', sameTurn.map(e => JSON.stringify(e)).join('\n'))).status, 'passed');
});

test('real-stream boundary cut rejects line 286 text for the QA window at line 294', t => {
  const write = scratch(t);
  const file = fixture('claude', 'trace-turn-boundary-v0.41.0');
  const report = probeClaude(file);
  assert.equal(report.status, 'failed');
  assert.equal(report.windows.length, 1);
  assert.match(report.windows[0].evidence, /:294$/);
  assert.deepEqual(report.windows[0].textLines, []);
  assert.deepEqual(report.windows[0].thinkingLines, [293]);
  assert.equal(report.windows[0].toolResult, null);
  assert.equal(cli(file).status, 1);
  const sample = read('claude', 'trace-turn-boundary-v0.41.0');
  assert.equal(sample.events.some(r => r.event.type === 'user'), false);
  sample.events = sample.events.filter(r => ![288, 290].includes(r.line));
  assert.equal(probeClaude(write('no-boundary.json', sample)).status, 'passed');
});

test('damaged child envelopes invalidate the passing control before children are skipped', t => {
  const write = scratch(t);
  for (const event of [{ type: 'assistant' }, { type: 'user' },
    { type: 'assistant', message: { content: null } },
    { type: 'assistant', message: { content: [{}] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: null }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result' }] } }]) {
    const sample = control();
    sample.events.push({ line: 200, event: { ...event, parent_tool_use_id: 'child' } });
    for (const input of [JSON.stringify(sample), sample.events.map(row => JSON.stringify(row.event)).join('\n')]) {
      const file = write('damaged-child.jsonl', input);
      assert.equal(probeClaude(file).status, 'unverified', JSON.stringify(event));
      assert.equal(cli(file).status, 2);
    }
  }
  const sample = control();
  sample.events.push({ line: 200, event: { ...structuredClone(sample.events.find(r => r.line === 139).event), parent_tool_use_id: 'child' } });
  const report = probeClaude(write('valid-child.json', sample));
  assert.equal(report.status, 'passed');
  assert.equal(report.windows.length, 1);
});

test('whitespace and zero-width characters alone are not visible text', t => {
  const write = scratch(t);
  const invisible = ['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF', ' \t\n\u200B\u200C\u200D\u2060\uFEFF'];
  for (const text of invisible) {
    const sample = control();
    const block = sample.events.find(r => r.line === 138).event.message.content[0];
    block.text = text;
    const file = write('invisible.json', sample);
    assert.equal(probeClaude(file).status, 'failed', JSON.stringify(text));
    assert.equal(cli(file).status, 1);
    block.text += 'Я';
    assert.equal(probeClaude(write('visible-character.json', sample)).status, 'passed');
  }
});

test('absence of visible text detects the defect even when thinking is hidden or absent', t => {
  const write = scratch(t);
  for (const replacement of ['', 'unrelated thought', null]) {
    const sample = defect();
    const row = sample.events.find(r => r.line === 227);
    row.event.message.content = replacement === null ? [] : [{ type: 'thinking', thinking: replacement }];
    assert.equal(probeClaude(write('thinking.json', sample)).status, 'failed');
  }
  const sample = control();
  sample.events.find(r => r.line === 138).event.message.content[0].text = '   ';
  assert.equal(probeClaude(write('removed-text.json', sample)).status, 'failed');
  const repaired = defect();
  repaired.events.find(r => r.line === 227).event.message.content.push({ type: 'text', text: 'Visible position' });
  assert.equal(probeClaude(write('visible.json', repaired)).status, 'passed');
});

test('stream boundary resets stale text; child windows and duplicate events do not count', t => {
  const write = scratch(t);
  const window = structuredClone(control().events.find(r => r.line === 139).event);
  const result = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'ok' }] } };
  const text = { type: 'assistant', message: { content: [{ type: 'text', text: 'Old summary' }] } };
  const child = { ...structuredClone(window), parent_tool_use_id: 'child' };
  const rows = [text, result, child, window, window];
  const report = probeClaude(write('stream.jsonl', rows.map(r => JSON.stringify(r)).join('\n')));
  assert.equal(report.status, 'failed');
  assert.equal(report.windows.length, 1);
  assert.equal(report.windows[0].line, 4);
  assert.equal(report.windows[0].toolResult, 2);
});

test('missing window and corrupt input are harness gaps, never passed or reproduced defects', t => {
  const write = scratch(t);
  for (const input of ['', '{bad json', '{}\n{bad json', 'null', '{"events":{}}', '{"events":[{"line":0,"event":{}}]}',
    '{"type":"assistant","message":{"content":"invalid"}}']) {
    const file = write('invalid.jsonl', input);
    const result = cli(file);
    assert.equal(result.status, 2, input);
    assert.equal(JSON.parse(result.stdout).status, 'unverified', input);
  }
  const sample = defect();
  sample.events = sample.events.filter(row => ![228, 229, 230].includes(row.line));
  assert.equal(probeClaude(write('no-window.json', sample)).status, 'unverified');
  const validStream = control().events.map(row => JSON.stringify(row.event)).join('\n');
  for (const input of [`{bad json\n${validStream}`, `${validStream}\n{bad json`]) {
    assert.equal(probeClaude(write('corrupt-with-window.jsonl', input)).status, 'unverified');
  }
  const broken = control();
  const question = broken.events.find(row => row.line === 139).event.message.content[0].input.questions[0];
  for (const questions of [[], [null], [{}], ['question'], [{ ...question, question: ' ' }],
    [{ ...question, header: null }], [{ ...question, multiSelect: 'false' }],
    [{ ...question, options: null }], [{ ...question, options: [question.options[0]] }],
    [{ ...question, options: [null, null] }],
    [{ ...question, options: [{ label: 'Choice', description: 0 }, question.options[1]] }]]) {
    broken.events.find(row => row.line === 139).event.message.content[0].input.questions = questions;
    const file = write('bad-window.json', broken);
    assert.equal(probeClaude(file).status, 'unverified');
    assert.equal(cli(file).status, 2);
  }
  assert.equal(probeClaude('/nonexistent/trace.jsonl').status, 'unverified');
});

test('damaged event envelopes and used fields invalidate both passing and failing traces', t => {
  const write = scratch(t);
  const invalid = [null, [], {}, { type: null }, { type: '' }, { type: ' ' }, { type: 3 }, { type: [] },
    { type: 'system', parent_tool_use_id: {} }, { type: 'system', parent_tool_use_id: false },
    { type: 'assistant' }, { type: 'assistant', message: [] },
    { type: 'assistant', message: { content: null } },
    { type: 'assistant', message: { content: [null] } },
    { type: 'assistant', message: { content: [[]] } },
    { type: 'assistant', message: { content: [{}] } },
    { type: 'assistant', message: { content: [{ type: 4 }] } },
    { type: 'assistant', message: { content: [{ type: 'text' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: null }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 3 }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
    { type: 'user' }, { type: 'user', message: { content: null } },
    { type: 'user', message: { content: [[]] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
  ];
  for (const sample of [control(), defect()]) {
    for (const event of invalid) {
      const events = [...sample.events, { line: sample.events.at(-1).line + 1, event }];
      for (const input of [JSON.stringify({ events }), events.map(row => JSON.stringify(row.event)).join('\n')]) {
        const file = write('damaged-trace.jsonl', input);
        const result = cli(file);
        assert.equal(result.status, 2, `must reject ${JSON.stringify(event)}`);
        const report = JSON.parse(result.stdout);
        assert.equal(report.status, 'unverified');
        assert.deepEqual(report.windows, [], 'damaged evidence cannot retain a pass or defect');
      }
    }
  }
  const events = [...control().events,
    { line: 200, event: { type: 'future_event' } },
    { line: 201, event: { type: 'user', message: { content: 'An ordinary user message' } } }];
  assert.equal(probeClaude(write('unknown-extra-events.json', { events })).status, 'passed');
  assert.equal(probeClaude(write('valid-extra-events.json', {events:events.filter(r=>r.event.type!=='future_event')})).status, 'passed');
});

const expectedAnswers = {
  recommended: 'Синий (Recommended)', label: 'Зелёный', correction: 'Синий, но светлее', empty: '', discuss: 'Ещё обсудить',
};
function appReply(text) {
  const match = /^<send_user_message_question_reply>\n([\s\S]+)\n<\/send_user_message_question_reply>\n$/.exec(text);
  assert.ok(match, 'selected-option reply must preserve the observed app wrapper');
  return JSON.parse(match[1]);
}

test('all six recorded policies retain Claude control responses and Codex resume payloads', () => {
  for (const policy of [...Object.keys(expectedAnswers), 'refuse']) {
    const claude = read('claude', policy), codex = read('codex', policy);
    assert.equal(claude.policy, policy);
    assert.equal(codex.policy, policy);
    assert.equal(claude.request.request.subtype, 'can_use_tool');
    assert.equal(claude.request.request.tool_name, 'AskUserQuestion');
    assert.equal(codex.call.name, 'request_user_input_async');
    assert.equal(JSON.parse(codex.callOutput).accepted, true);
    const response = claude.response.response.response;
    if (policy === 'refuse') {
      assert.equal(response.behavior, 'deny');
      assert.equal(claude.toolResult.is_error, true);
      assert.equal(codex.answerAsUserMessage[0].text, 'Не буду отвечать на этот вопрос.');
      assert.match(codex.note, /no separate refusal form/);
    } else {
      assert.equal(response.behavior, 'allow');
      assert.equal(response.updatedInput.answers['Какой цвет берём?'], expectedAnswers[policy]);
      const [reply] = appReply(codex.answerAsUserMessage[0].text);
      assert.deepEqual(Object.keys(reply).sort(), ['answer', 'question', 'questionItemId']);
      assert.deepEqual(JSON.parse(reply.questionItemId), ['request_user_input_async', '<call-id>', 0]);
      assert.equal(reply.question, codex.call.arguments.questions[0].title);
      assert.equal(reply.answer, expectedAnswers[policy]);
    }
    assert.ok(claude.modelNext.length);
    assert.ok(codex.modelNext[0].text.length);
  }
  assert.equal(read('claude', 'empty').toolResult.content, 'The user did not answer the questions.');
  assert.match(read('codex', 'empty').note, /assumed: no app sample exists/);
});

test('Codex selected-option resume and app use the same structure; async summary follows window', () => {
  const [app] = appReply(read('codex', 'app-reply-form').form);
  const [resume] = appReply(read('codex', 'label').answerAsUserMessage[0].text);
  assert.deepEqual(Object.keys(resume), Object.keys(app));
  assert.equal(resume.questionItemId, app.questionItemId);
  const { items } = read('codex', 'trace-control-v0.41.0-async-order');
  assert.equal(items[0].name, 'request_user_input_async');
  assert.equal(items.at(-1).type, 'message');
  assert.equal(items.at(-1).phase, 'final_answer');
  assert.ok(items.at(-1).content[0].text.length > 100);
});

test('public samples contain no private paths, accounts, workspace identifiers or tokens', () => {
  for (const host of ['claude', 'codex']) {
    for (const file of fs.readdirSync(`${samples}/${host}`)) {
      const text = fs.readFileSync(`${samples}/${host}/${file}`, 'utf8');
      assert.doesNotMatch(text, /\/Users\/|\/private\/|\/home\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/linear\.app\/|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\b(?:req_|sk-|lin_api_)[A-Za-z0-9_-]+/iu, file);
    }
  }
});

test('child user/result/init preserve parent text; toolResult does not cross a parent boundary', t => {
  const write = scratch(t);
  const summary = control().events.find(r => r.line === 138).event;
  const window = control().events.find(r => r.line === 139).event;
  for(const child of [{type:'result'}, {type:'system',subtype:'init'}, {type:'user',message:{content:'Child reply'}}]){
    const events=[summary,{...child,parent_tool_use_id:'child'},window];
    const r=probeClaude(write('child-boundary.jsonl',events.map(e=>JSON.stringify(e)).join('\n')));
    assert.equal(r.status,'passed');assert.deepEqual(r.windows[0].textLines,[1]);
  }
  const user={type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool',content:'ok'}]}};
  for(const boundary of [{type:'result'}, {type:'system',subtype:'init'}]){
    const events=[user,boundary,summary,window];
    const r=probeClaude(write('tool-result-boundary.jsonl',events.map(e=>JSON.stringify(e)).join('\n')));
    assert.equal(r.status,'passed');assert.equal(r.windows[0].toolResult,null);
  }
});
test('format and variation characters alone are not a visible position',t=>{
  const write=scratch(t);
  for(const text of ['\u00AD','\u200E','\u200F','\u2061','\uFE0F']){
    const sample=control();sample.events.find(r=>r.line===138).event.message.content[0].text=text;
    assert.equal(probeClaude(write('format-only.json',sample)).status,'failed');
  }
});

for(const host of ['claude','codex'])test(`${host}: text probe CLI checks ordinary replies and prohibits windows`,t=>{
 const save=scratch(t),assistant=text=>host==='claude'?{type:'assistant',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}};
 const user=text=>host==='claude'?{type:'user',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}};
 const terminal=host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 const rows=[assistant('Версия.\nПринимаем?'),terminal,user('согласен'),assistant('Записал.'),terminal],trace=save('text.jsonl',rows.map(JSON.stringify).join('\n')+'\n');
 const expectedReplies=[{id:'idea',stage:'idea',role:'approval',asksStart:false,summary:['Версия.'],question:'Принимаем?',reply:'согласен',intent:'agree',outcome:{approval:true,startNext:false},response:['Записал.']}];
 const request=save('request.json',{host,trace,expectedReplies}),run=()=>spawnSync(process.execPath,['scripts/skills-probe.mjs','--text',request],{encoding:'utf8'});
 assert.equal(run().status,0,run().stdout);
 const call=host==='claude'?{type:'assistant',message:{content:[{type:'tool_use',id:'window',name:'AskUserQuestion',input:{questions:[]}}]}}:{type:'response_item',payload:{type:'function_call',name:'request_user_input_async',call_id:'window',arguments:'{"questions":[]}'}};
 rows.unshift(call);save('text.jsonl',rows.map(JSON.stringify).join('\n')+'\n');assert.equal(run().status,1);assert.match(run().stdout,/stage called a window/);
});

for(const mode of ['unexpected','unfinished'])test(`Codex text probe rejects ${mode} native continuation`,t=>{
 const save=scratch(t),a=text=>({type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}}),u=text=>({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}}),end={type:'event_msg',payload:{type:'task_complete'}};
 const expectedReplies=[{id:'one',stage:'idea',role:'approval',asksStart:false,summary:['Версия'],question:'Принимаем?',reply:'принимаю',intent:'agree',outcome:{approval:true,startNext:false}},{id:'two',stage:'discovery',role:'approval',asksStart:false,summary:['PRD'],question:'Утверждаем?',reply:'да',intent:'agree',outcome:{approval:true,startNext:false},response:['Записал.']}];
 const rows=[a('Версия\nПринимаем?'),end,u('принимаю'),a('PRD\nУтверждаем?'),end,u('да'),a('Записал.'),end];
 if(mode==='unexpected')rows.splice(3,0,a('Чужой вопрос?'),end,u('другой ответ'));
 else rows.push(a('Работа без завершения.'));
 const trace=save('trace.jsonl',rows.map(JSON.stringify).join('\n')+'\n'),request=save('request.json',{host:'codex',trace,expectedReplies});
 const result=spawnSync(process.execPath,['scripts/skills-probe.mjs','--text',request],{encoding:'utf8'});
 assert.equal(result.status,mode==='unexpected'?1:2,result.stdout);
});

for(const host of ['claude','codex'])for(const sample of JSON.parse(fs.readFileSync('scripts/test-fixtures/skills-text-responses.json')))test(`${host}: declared final stage response ${sample.id}`,async t=>{
 const {probeText}=await import('./skills-probe.mjs'),{checkTrace}=await import('./skills-trace.mjs'),save=scratch(t);
 const a=text=>host==='claude'?{type:'assistant',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}};
 const u=text=>host==='claude'?{type:'user',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}};
 const end=host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 const trace=save('response.jsonl',[a('Версия\nУтверждаем?'),end,u(sample.reply),a(sample.actual),end].map(JSON.stringify).join('\n')+'\n');
 const expectedReplies=[{id:'last',stage:'idea',role:'approval',summary:['Версия'],question:'Утверждаем?',reply:sample.reply,intent:sample.intent,asksStart:false,outcome:{approval:sample.intent==='agree',startNext:false},response:sample.response}];
 for(const check of [probeText,checkTrace])assert.equal(check({host,trace,expectedReplies}).status,sample.status,`${sample.id}: ${check.name}`);
});

for(const host of ['claude','codex'])for(const placement of ['before-offer','between-replies','after-response'])test(`${host}: no completed turn is skipped ${placement}`,async t=>{
 const {probeText}=await import('./skills-probe.mjs'),{checkTrace}=await import('./skills-trace.mjs'),save=scratch(t);
 const a=text=>host==='claude'?{type:'assistant',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}};
 const u=text=>host==='claude'?{type:'user',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}};
 const end=host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 const expected={id:'one',stage:'idea',role:'approval',summary:['Версия'],question:'Утверждаем?',reply:'принимаю',intent:'agree',asksStart:false,outcome:{approval:true,startNext:false}};
 const expectedReplies=[expected,{...expected,id:'two',response:['Записал.','Start Research?']}];
 const rows=[a('Версия\nУтверждаем?'),end,u('принимаю'),a('Версия\nУтверждаем?'),end,u('принимаю'),a('Записал.'),end];
 const cut=rows.length;rows.splice(placement==='before-offer'?0:placement==='between-replies'?3:rows.length,0,a('Start Research?'),end);
 const trace=save('extra-turn.jsonl',rows.map(JSON.stringify).join('\n')+'\n');
 for(const check of [probeText,checkTrace])assert.equal(check({host,trace,expectedReplies,endLine:cut}).status,'failed',check.name);
});

for(const host of ['claude','codex'])test(`${host}: text checks reject undeclared extra native owner reply`,async t=>{
 const {probeText}=await import('./skills-probe.mjs'),{checkTrace}=await import('./skills-trace.mjs'),save=scratch(t);
 const a=text=>host==='claude'?{type:'assistant',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}};
 const u=text=>host==='claude'?{type:'user',message:{content:[{type:'text',text}]}}:{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}};
 const end=host==='claude'?{type:'result',subtype:'success'}:{type:'event_msg',payload:{type:'task_complete'}};
 const expectedReplies=[{id:'one',stage:'idea',role:'approval',summary:['Версия'],question:'Принимаем?',reply:'принимаю',intent:'agree',asksStart:false,outcome:{approval:true,startNext:false},response:['Записал.']}];
 const trace=save('extra-owner.jsonl',[a('Версия\nПринимаем?'),end,u('принимаю'),u('Начинай Research'),a('Записал.'),end].map(JSON.stringify).join('\n')+'\n');
 for(const check of [probeText,checkTrace]){const result=check({host,trace,expectedReplies});assert.equal(result.status,'failed');assert.match(result.reason,/unexpected owner reply/);}
});
