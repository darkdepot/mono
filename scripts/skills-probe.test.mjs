import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { probeClaude } from './skills-probe.mjs';

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
const cli = file => spawnSync(process.execPath, ['scripts/skills-probe.mjs', file], { encoding: 'utf8' });

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
  const result = { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } };
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
  broken.events.find(row => row.line === 139).event.message.content[0].input.questions = [];
  assert.equal(probeClaude(write('bad-window.json', broken)).status, 'unverified');
  assert.equal(probeClaude('/nonexistent/trace.jsonl').status, 'unverified');
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
