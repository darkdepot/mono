import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./window-guard.mjs', import.meta.url));
const choices = [['Первый', 'Второй']];
const summary = 'Предлагаю выбрать первый вариант, потому что он сохраняет понятный порядок действий и позволяет владельцу сначала прочитать полный результат работы, проверить доводы и затем принять решение.';
const ending = (options = choices, text = summary) => `${text}\n${options.map(labels => labels.map(label => `«${label}»`).join(' / ')).join('\n')}`;
const command = (options = choices) => `node '${script}' check --options '${JSON.stringify(options)}'`;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-window-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: dir };
  function run(input, args = []) {
    const result = spawnSync(process.execPath, [script, ...args], { input: JSON.stringify(input), env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return result.stdout ? JSON.parse(result.stdout) : null;
  }
  const hook = (event, fields = {}) => run({ hook_event_name: event, session_id: 'session-1', ...fields });
  const check = (options = choices, fields = {}) => hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: command(options) }, ...fields });
  const stop = (message = ending(), fields = {}) => hook('Stop', { last_assistant_message: message, ...fields });
  const window = (options = choices, fields = {}) => hook('PreToolUse', { tool_name: 'request_user_input', tool_input: { questions: (options ?? []).map((labels, i) => ({ id: `mono_${i}`, options: labels.map(label => ({ label })) })) }, ...fields });
  return { dir, env, run, hook, check, stop, window };
}
const decision = value => value?.hookSpecificOutput?.permissionDecision;

test('unhooked check reports disabled and never writes state', t => {
  const { dir, env } = fixture(t);
  const result = spawnSync(process.execPath, [script, 'check', '--options', JSON.stringify(choices)], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'защита выключена\n');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('check replacement enables this session; summary grants exactly one window', t => {
  const f = fixture(t);
  const replacement = f.check();
  assert.equal(decision(replacement), 'allow');
  const alive = spawnSync('/bin/sh', ['-c', replacement.hookSpecificOutput.updatedInput.command], { encoding: 'utf8' });
  assert.equal(alive.status, 0, alive.stderr);
  assert.equal(alive.stdout, 'защита включена\nsession_id=session-1\n');
  assert.equal(fs.readdirSync(f.dir).length, 1);
  assert.equal(decision(f.window()), 'deny');
  assert.equal(f.stop().decision, 'block');
  assert.equal(f.window(), null);
  assert.equal(f.stop(ending(), { stop_hook_active: true }), null);
  assert.equal(decision(f.window()), 'deny');
});

test('wrong ending repairs once, corrected ending grants on stop_hook_active', t => {
  const f = fixture(t);
  f.check();
  const repair = f.stop(ending([['Другой', 'Второй']]));
  assert.equal(repair.reason, 'закончи ход итогом не короче 20 слов и вариантами последними строками');
  assert.equal(decision(f.window()), 'deny');
  assert.equal(f.stop(ending(), { stop_hook_active: true }).decision, 'block');
  assert.equal(f.stop(), null, 'at most two continuations');
  assert.equal(f.window(), null);
});

test('short summary and repeated mismatch never grant or loop', t => {
  const f = fixture(t);
  f.check();
  assert.equal(f.stop(ending(choices, 'Готово')).decision, 'block');
  assert.equal(f.stop('Снова неверно', { stop_hook_active: true }), null);
  assert.equal(f.stop('Снова неверно'), null);
  assert.equal(decision(f.window()), 'deny');
  f.check();
  assert.equal(f.stop('Неверно', { stop_hook_active: true }), null);
  assert.equal(decision(f.window()), 'deny');
});

test('multiple questions, blank trailing lines and exact twenty-word boundary', t => {
  const f = fixture(t), options = [['А', 'Б'], ['В', 'Г']];
  const twenty = Array.from({ length: 20 }, (_, i) => `слово${i}`).join(' ');
  f.check(options);
  assert.equal(f.stop(ending(options, twenty) + '\n\n').decision, 'block');
  assert.equal(f.window(options), null);
  f.check(options);
  assert.equal(f.stop(ending(options, twenty.split(' ').slice(1).join(' '))).reason,
    'закончи ход итогом не короче 20 слов и вариантами последними строками');
  assert.equal(decision(f.window(options)), 'deny');
});

test('new check replaces expected options and resets permit and continuations', t => {
  const f = fixture(t), other = [['Третий', 'Четвёртый']];
  f.check(); f.stop();
  f.check(other);
  assert.equal(decision(f.window()), 'deny');
  assert.equal(f.stop(ending(other)).decision, 'block');
  assert.equal(f.window(other), null);
});

test('owner prompt burns expected window, permit and continuation count', t => {
  const f = fixture(t);
  f.check(); f.stop();
  assert.equal(f.hook('UserPromptSubmit'), null);
  assert.equal(f.stop(), null);
  assert.equal(decision(f.window()), 'deny');
  f.check();
  assert.equal(f.stop('Неверно').decision, 'block');
});

test('foreign window leaves permit untouched, including one overlapping label', t => {
  const f = fixture(t);
  f.check(); f.stop();
  const foreign = labels => f.window([labels], { tool_input: { questions: [{ options: labels.map(label => ({ label })) }] } });
  assert.equal(foreign(['Любой', 'Другой']), null);
  assert.equal(foreign(['Утвердить', 'Отказаться']), null);
  assert.equal(f.window(), null);
});

test('every complete approval set is denied without check, irrespective of label order', t => {
  const f = fixture(t);
  for (const labels of [
    ['Утвердить и начать Research', 'Утвердить, продолжу позже', 'Ещё обсудить'],
    ['Начать Design', 'Ещё обсудить'], ['Утвердить', 'Ещё обсудить'],
    ['Начать работу', 'Передать оркестратору', 'Ещё обсудить'],
  ]) {
    const input = { questions: [{ options: [...labels].reverse() }] };
    assert.equal(decision(f.window([labels], { tool_name: 'request_user_input_async', tool_input: input })), 'deny');
    assert.equal(f.window([labels], { tool_input: { questions: [{ options: [...labels, 'Другой'] }] } }), null);
  }
});

test('Claude marker wins over unparseable options; unmarked unknown shapes are foreign', t => {
  const f = fixture(t);
  for (const tool_input of [{ metadata: { source: 'mono' } }, { questions: [{ metadata: { source: 'mono' }, options: [{}] }] }]) {
    assert.equal(decision(f.window(null, { tool_name: 'AskUserQuestion', tool_input })), 'deny');
  }
  assert.equal(decision(f.window(null, { tool_input: { questions: [{ id: 'mono_broken' }] } })), 'deny');
  for (const tool_input of [{}, { questions: [{}] }, { questions: 'unknown' }, { questions: [{ options: [{}] }] }]) {
    assert.equal(f.window(null, { tool_name: 'AskUserQuestion', tool_input }), null);
  }
});

test('Codex async strings and Claude labels match the same expected window without markers', t => {
  const f = fixture(t);
  for (const tool_name of ['request_user_input', 'request_user_input_async', 'AskUserQuestion']) {
    f.check(); f.stop();
    const options = tool_name === 'request_user_input_async' ? choices[0] : choices[0].map(label => ({ label }));
    assert.equal(f.window(null, { tool_name, tool_input: { questions: [{ options }] } }), null);
    assert.equal(f.stop(ending(), { stop_hook_active: true }), null, 'empty window answer cannot reopen');
  }
});

test('session isolation, stale cleanup and fallback temp directory', t => {
  const f = fixture(t);
  f.check();
  const state = path.join(f.dir, fs.readdirSync(f.dir)[0]);
  const old = path.join(f.dir, 'window-' + 'a'.repeat(64) + '.json');
  fs.writeFileSync(old, '{}');
  fs.utimesSync(old, new Date(0), new Date(0));
  fs.writeFileSync(path.join(f.dir, 'unrelated.json'), '{}');
  assert.equal(f.stop(ending(), { session_id: 'other' }), null);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(path.join(f.dir, 'unrelated.json')), true);
  assert.equal(f.stop().decision, 'block');
  fs.utimesSync(state, new Date(0), new Date(0));
  assert.equal(f.stop(), null);
  const env = { ...f.env, CLAUDE_PLUGIN_DATA: '', TMPDIR: f.dir, TMP: f.dir, TEMP: f.dir };
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', input: JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 'fallback', tool_input: { command: command() },
  }) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(decision(JSON.parse(result.stdout)), 'allow');
  assert.equal(fs.readdirSync(path.join(f.dir, 'mono-window-guard')).length, 1);
});

test('internal storage errors deny stage windows and pass unrelated tools and windows silently', t => {
  const f = fixture(t);
  fs.rmdirSync(f.dir); fs.writeFileSync(f.dir, 'storage unavailable');
  assert.equal(decision(f.window()), 'deny');
  assert.equal(decision(f.window(null, { tool_input: { questions: [{ options: ['Утвердить', 'Ещё обсудить'] }] } })), 'deny');
  assert.equal(f.window(null, { tool_input: { questions: [{ options: ['Да', 'Нет'] }] } }), null);
  assert.equal(f.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'echo ordinary' } }), null);
  assert.equal(f.check(), null);
});

test('unrelated commands and SubagentStop do nothing; only literal check can arm state', t => {
  const f = fixture(t);
  for (const cmd of ['echo ordinary', command() + '; echo extra', 'echo ' + command(), command().replace(script, '/other/scripts/window-guard.mjs'), command().replace('[[' , '[broken[')]) {
    assert.equal(f.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: cmd } }), null);
  }
  assert.equal(f.hook('SubagentStop', { last_assistant_message: ending() }), null);
  assert.deepEqual(fs.readdirSync(f.dir), []);
  f.check();
  assert.equal(f.hook('SubagentStop', { last_assistant_message: ending() }), null);
  assert.equal(decision(f.window()), 'deny');
});

test('mismatch on a later Stop revokes the old permit even when no continuation is allowed', t => {
  const f = fixture(t);
  f.check(); f.stop();
  assert.equal(f.stop('Новый неверный итог', { stop_hook_active: true }), null);
  assert.equal(decision(f.window()), 'deny');
});

test('a URL with many path segments is one word, not a summary', t => {
  const f = fixture(t);
  f.check();
  const url = 'https://example.invalid/' + Array(30).fill('segment').join('/');
  assert.equal(f.stop(ending(choices, url)).reason, 'закончи ход итогом не короче 20 слов и вариантами последними строками');
  assert.equal(decision(f.window()), 'deny');
});

test('literal Unicode escapes carry apostrophes without shell interpolation', t => {
  const f = fixture(t), labels = [["Owner's choice", 'Другой']];
  const cmd = command(labels).replace("Owner's", 'Owner\\u0027s');
  const session = "session-'$literal";
  const result = f.hook('PreToolUse', { session_id: session, tool_name: 'Bash', tool_input: { command: cmd, timeout: 1000 } });
  assert.equal(decision(result), 'allow');
  assert.equal(result.hookSpecificOutput.updatedInput.timeout, 1000);
  const alive = spawnSync('/bin/sh', ['-c', result.hookSpecificOutput.updatedInput.command], { encoding: 'utf8' });
  assert.equal(alive.status, 0, alive.stderr);
  assert.equal(alive.stdout, `защита включена\nsession_id=${session}\n`);
  assert.equal(f.stop(ending(labels), { session_id: session }).decision, 'block');
});
