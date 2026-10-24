#!/usr/bin/env node
/**
 * Stage command (one labels array per question, in display order):
 * node '<pack-root>/scripts/window-guard.mjs' check --options '[["A","B"]]'
 * Use single quotes around the absolute script path and JSON; encode a literal
 * apostrophe in a label as \u0027. No shell prefixes, suffixes or substitutions.
 * Final nonempty lines: «A» / «B» (one line per question), with >=20 words above.
 * Only hook mode writes session state; check alone always reports disabled.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withLock } from './runtime.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(import.meta.url);
const denyReason = 'запусти проверку и закончи ход итогом с вариантами последними строками';
const repairReason = 'закончи ход итогом не короче 20 слов и вариантами последними строками';
const day = 24 * 60 * 60 * 1000;
const windowTool = name => name === 'AskUserQuestion' || /^request_user_input(?:_async)?$/.test(name ?? '');
const same = (a, b) => a != null && b != null && JSON.stringify(a) === JSON.stringify(b);
const validOptions = options => Array.isArray(options) && options.length > 0 && options.every(labels =>
  Array.isArray(labels) && labels.length > 0 && labels.every(label =>
    typeof label === 'string' && label.trim() === label && label.length > 0 && !/[\r\n]/.test(label)));
const deny = () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: denyReason } });

function windowOptions(input) {
  const options = input?.questions?.map?.(question => question?.options?.map?.(option => typeof option === 'string' ? option : option?.label));
  return validOptions(options) ? options : null;
}
function marked(input) {
  return input?.metadata?.source === 'mono' || (Array.isArray(input?.questions) && input.questions.some(question =>
    question?.metadata?.source === 'mono' || (typeof question?.id === 'string' && question.id.startsWith('mono_'))));
}
function approval(options) {
  return options?.some(labels => {
    const set = [...labels].sort();
    const equals = expected => same(set, [...expected].sort());
    return equals(['Утвердить', 'Ещё обсудить']) ||
      equals(['Начать работу', 'Передать оркестратору', 'Ещё обсудить']) ||
      (labels.length === 2 && labels.some(label => /^Начать .+/.test(label)) && labels.includes('Ещё обсудить')) ||
      (labels.length === 3 && labels.some(label => /^Утвердить и начать .+/.test(label)) &&
        labels.includes('Утвердить, продолжу позже') && labels.includes('Ещё обсудить'));
  }) ?? false;
}
function checkOptions(command) {
  // This intentionally accepts only the documented literal command, not shell code.
  const match = /^node '([^'\r\n]+)' check --options '([^'\r\n]+)'\s*$/.exec(command ?? '');
  if (!match || match[1] !== script) return null;
  const options = JSON.parse(match[2]);
  return validOptions(options) ? options : null;
}
function stateFile(session) {
  if (typeof session !== 'string' || !session) throw new Error('missing session');
  const directory = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'mono-window-guard');
  return path.join(directory, `window-${createHash('sha256').update(session).digest('hex')}.json`);
}
function readState(file) {
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > day) { fs.unlinkSync(file); return {}; }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
function cleanup(directory) {
  let entries;
  try { entries = fs.readdirSync(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries.filter(name => /^window-[a-f0-9]{64}\.json(?:\.lock)?$/.test(name))) {
    const file = path.join(directory, entry);
    try { if (Date.now() - fs.statSync(file).mtimeMs > day) fs.unlinkSync(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
function clearState(file) { fs.rmSync(file, { force: true }); }
function matchesSummary(message, options) {
  if (typeof message !== 'string') return false;
  const lines = message.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const endings = options.map(labels => labels.map(label => `«${label}»`).join(' / '));
  if (!same(lines.slice(-endings.length), endings)) return false;
  const words = lines.slice(0, -endings.length).join(' ').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word));
  return words.length >= 20;
}
async function handle(event) {
  const isWindow = event.hook_event_name === 'PreToolUse' && windowTool(event.tool_name);
  let stageWindow = isWindow && (marked(event.tool_input) || approval(windowOptions(event.tool_input)));
  try {
    let expected;
    if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'Bash') {
      expected = checkOptions(event.tool_input?.command);
      if (!expected) return;
    } else if (!isWindow && !['Stop', 'UserPromptSubmit'].includes(event.hook_event_name)) return;
    const file = stateFile(event.session_id);
    const options = isWindow ? windowOptions(event.tool_input) : null;
    const snapshot = readState(file);
    stageWindow ||= isWindow && same(options, snapshot.expected);
    cleanup(path.dirname(file));
    if (isWindow && !stageWindow) return;
    if (!isWindow && !expected && !snapshot.expected && !snapshot.permit) return;
    const deadline = Date.now() + 1000;
    for (;;) {
      try {
        return await withLock(`${file}.lock`, () => {
          const state = readState(file);
          if (expected) {
            saveState(file, { expected, continuations: 0 });
            const output = `защита включена\nsession_id=${event.session_id}\n`;
            // Single-quote shell escaping also covers an arbitrary host session_id.
            const quoted = `'${output.replaceAll("'", "'\\''")}'`;
            return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...event.tool_input, command: `printf '%s' ${quoted}` } } };
          }
          if (event.hook_event_name === 'UserPromptSubmit') { clearState(file); return; }
          if (isWindow) {
            if (!stageWindow) return;
            if (options && same(options, state.permit) && same(options, state.expected)) { clearState(file); return; }
            return deny();
          }
          if (!validOptions(state.expected)) return;
          const continuations = state.continuations ?? 0;
          const matches = matchesSummary(event.last_assistant_message, state.expected);
          if (!matches && state.permit) saveState(file, { expected: state.expected, continuations });
          if (continuations >= 2) return;
          if (!matches && (event.stop_hook_active || continuations > 0)) return;
          saveState(file, { expected: state.expected, continuations: continuations + 1, ...(matches ? { permit: state.expected } : {}) });
          return { decision: 'block', reason: matches ? 'открой окно с этими вариантами без нового текста' : repairReason };
        });
      } catch (error) {
        if (error.code !== 'ELOCKED' || Date.now() >= deadline) throw error;
        await delay(20);
      }
    }
  } catch {
    // Never break ordinary work, even if session storage is unavailable.
    if (stageWindow) return deny();
  }
}

const args = process.argv.slice(2);
if (args[0] === '--help' || args[0] === '-h') {
  console.log(`Stage command (one labels array per question, in display order):
node '<pack-root>/scripts/window-guard.mjs' check --options '[["A","B"]]'
Use single quotes around the absolute script path and JSON; encode a literal
apostrophe in a label as \\u0027. No shell prefixes, suffixes or substitutions.
Final nonempty lines: «A» / «B» (one line per question), with >=20 words above.
Without hooks: защита выключена. With hooks: защита включена and session_id=<id>.
Hook mode: node scripts/window-guard.mjs < event.json
Events: PreToolUse (Bash, AskUserQuestion, request_user_input, request_user_input_async), Stop, UserPromptSubmit.
Only hook mode writes session state; check alone always reports disabled.`);
} else if (args[0] === 'check') {
  console.log('защита выключена');
} else if (!args.length) {
  try {
    const result = await handle(JSON.parse(fs.readFileSync(0, 'utf8')));
    if (result) console.log(JSON.stringify(result));
  } catch { /* Malformed host input cannot identify a stage window. */ }
}
