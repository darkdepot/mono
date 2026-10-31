#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { claudeWindows, traceRows, visibleText } from './skills-probe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Full rule source, including host order. A rule edit requires checker/rubric review.
export const OWNER_DIALOG_SHA256 = 'd9e88bf7f17960e3dd1bec2cebd4589d45a256eae704fec858aba0349d6c2d67';
export const visible = visibleText;
const textOf = p => (p.content ?? []).filter(b => ['text', 'output_text'].includes(b.type)).map(b => b.text).join('\n');
export function codexItems(rows) {
  return rows.filter(r => r.value?.type === 'response_item').map(r => ({ ...r, item: r.value.payload }));
}
export function codexWindows(rows, source) {
  const items = codexItems(rows), windows = [], seen = new Set();
  for (const row of items) {
    const p = row.item;
    if (!p || typeof p.type !== 'string') throw new Error(`line ${row.line}: invalid response item`);
    if (!['function_call', 'custom_tool_call'].includes(p.type) || p.name !== 'request_user_input_async') continue;
    if (typeof p.call_id !== 'string' || !p.call_id) throw new Error(`line ${row.line}: missing call id`);
    if (seen.has(p.call_id)) continue;
    seen.add(p.call_id);
    // A user message or an actual task boundary ends the turn; tool output does not.
    const following = rows.filter(r => r.line > row.line);
    const end = following.find(r => (r.value.type === 'response_item' && r.value.payload?.type === 'message' && r.value.payload.role === 'user') ||
      (r.value.type === 'event_msg' && ['task_complete', 'task_started', 'turn_aborted'].includes(r.value.payload?.type)));
    const turn = items.filter(r => r.line > row.line && (!end || r.line < end.line));
    const outputs = turn.filter(r => ['function_call_output','custom_tool_call_output'].includes(r.item.type) && r.item.call_id === p.call_id);
    const output = outputs.length === 1 ? outputs[0] : null;
    let args, accepted;
    try { args = JSON.parse(p.arguments); } catch { args = null; }
    try { accepted = typeof output?.item.output === 'string' ? JSON.parse(output.item.output) : null; } catch { accepted = null; }
    // Only the recorded native success body establishes that a window appeared.
    const executionConfirmed = p.type === 'function_call' && output?.item.type === 'function_call_output' &&
      !output.item.isError && !output.item.is_error && accepted?.accepted === true && Object.keys(accepted).length === 1 &&
      Array.isArray(args?.questions) && args.questions.length > 0;
    const last = turn.at(-1);
    const summary = last?.item.type === 'message' && last.item.role === 'assistant' && last.item.phase === 'final_answer' ? textOf(last.item) : '';
    windows.push({ line: row.line, evidence: `${source}:${row.line}`, callId: p.call_id, questions: args?.questions ?? [],
      executionConfirmed, resultEvidence: output ? `${source}:${output.line}` : null,
      summary, summaryLine: last?.line, status: !executionConfirmed ? 'unverified' : visible(summary) ? 'passed' : 'failed',
      reason: !executionConfirmed ? 'linked native accepted:true window result missing or unknown' : visible(summary) ? 'async summary is the last message' : 'async summary must be final and last; no calls after it' });
  }
  return windows;
}


export function completedTrace(host, rows) {
  if (host === 'claude') {
    const last = rows.filter(r => !r.value.parent_tool_use_id).at(-1)?.value;
    return !last?.parent_tool_use_id && last?.type === 'result' && last.subtype === 'success' && last.is_error !== true;
  }
  const last = rows.filter(r => r.value.type === 'response_item' ||
    (r.value.type === 'event_msg' && ['task_complete','task_started','turn_aborted','error'].includes(r.value.payload?.type))).at(-1)?.value;
  return last?.type === 'event_msg' && last.payload?.type === 'task_complete';
}

function cardIssues(host, questions, expected) {
  const issues = [];
  if (questions.length !== 1) issues.push('one question at a time');
  for (const q of questions) {
    const title = host === 'claude' ? q.question : q.title;
    const options = q.options;
    if (typeof title !== 'string' || !Array.isArray(options) || options.length < 2 || options.length > 3) { issues.push('invalid question or option count'); continue; }
    const labels = options.map(o => typeof o === 'string' ? o : o?.label);
    if (labels.some(l => typeof l !== 'string' || !visible(l))) { issues.push('invalid option label'); continue; }
    if (!labels[0].endsWith(' (Recommended)') || labels.slice(1).some(l => l.endsWith(' (Recommended)'))) issues.push('recommended option must be first and unique');
    const gist = title.split('\n')[0];
    for (const key of ['decision', 'advice', 'reason']) if (!gist.includes(expected[key])) issues.push(`question lacks scenario ${key}`);
    if ((gist.match(/[.!?]+(?:\s|$)/g)??[]).length > 2) issues.push('question gist exceeds two sentences');
    if (/https?:\/\/|\[[^\]]+\]\(|[`*#]/.test(gist)) issues.push('question gist has links or markup');
    const consequences = host === 'claude' ? options.map(o => o.description)
      : labels.map(label => title.split('\n').find(l => l.startsWith(`${label}:`))?.slice(label.length + 1));
    if (consequences.some(s => typeof s !== 'string' || s.includes('\n') || !s.split('/').every(visible) || !s.includes('/'))) issues.push('each option needs one consequence / tradeoff line');
    if (host === 'claude' && (typeof q.header !== 'string' || [...q.header].length > 12 || !visible(q.header) || labels.some(l => {const n=l.replace(/ \(Recommended\)$/, '').trim().split(/\s+/).length;return n<1||n>5;}))) issues.push('Claude header or label length');
  }
  return issues;
}

export function checkTrace({ host, trace, expectedWindows, rulesRoot = root, excerpt = false }) {
  const windows = [], checks = [];
  try {
    const ruleSource = path.join(rulesRoot, 'references/owner-dialog.md');
    const rulesDigest = crypto.createHash('sha256').update(fs.readFileSync(ruleSource)).digest('hex');
    if (rulesDigest !== OWNER_DIALOG_SHA256) throw new Error('owner-dialog changed: update checker and conversation rubric together');
    if (!['claude', 'codex'].includes(host) || !Array.isArray(expectedWindows) || !expectedWindows.length || expectedWindows.some(w =>
      !w?.id || ['decision','advice','reason'].some(k => !visible(w[k])) || !Array.isArray(w.summary) || !w.summary.length || w.summary.some(s => !visible(s)))) throw new Error('scenario expectedWindows needs id, decision, advice, reason and summary anchors');
    const { rows } = traceRows(trace);
    if (rows.some(r => !r.value || typeof r.value.type !== 'string')) throw new Error('invalid trace envelope');
    const found = host === 'claude' ? claudeWindows(rows, trace) : codexWindows(rows, trace);
    let expectedIndex = 0;
    for (const [i, w] of found.entries()) {
      const expected = expectedWindows[expectedIndex];
      if (w.status === 'unverified') {
        windows.push({ ...w, id: expected?.id ?? `unexpected-${i}`, issues: [w.reason] });
        continue;
      }
      expectedIndex++;
      const issues = w.status === 'failed' ? [w.reason] : [];
      let summary = w.summary ?? '';
      if (host === 'claude') {
        const windowRow = rows.find(r => r.line === w.line);
        const messageId = windowRow.value.message.id;
        const firstLine = w.textLines[0] ?? w.line;
        const parts = [];
        for (const r of rows.filter(r => r.line >= firstLine && r.line <= w.line)) {
          if (r.value.parent_tool_use_id || r.value.type !== 'assistant') continue;
          for (const block of r.value.message.content) {
            if (block.type === 'tool_use') {
              if (block.id === w.callId) break;
              parts.length = 0; // Service work invalidates all earlier summary fragments.
            }
            if (block.type === 'text' &&
                (r.line === w.line || (messageId && r.value.message.id === messageId))) parts.push(block.text);
          }
        }
        summary = parts.join('\n');
      }
      if (!visible(summary)) issues.push('no visible owner summary');
      if (expected) {
        issues.push(...cardIssues(host, w.questions, expected));
        if (!expected.summary.every(s => summary.includes(s))) issues.push('summary lacks scenario content');
      } else issues.push('unexpected window without scenario policy');
      windows.push({ ...w, id: expected?.id ?? `unexpected-${i}`, issues, status: issues.length ? 'failed' : 'passed' });
    }
    const uncertain = found.find(w => w.status === 'unverified');
    if (expectedIndex > expectedWindows.length || (!uncertain && expectedIndex !== expectedWindows.length)) checks.push({ id:'expected-windows',status:'failed',evidence:`${trace}:${rows.at(-1)?.line ?? 1}`,reason:`expected ${expectedWindows.length} real windows, found ${expectedIndex}; text is not a window` });
    if (uncertain) checks.push({ id:'expected-windows',status:'unverified',evidence:`${trace}:${uncertain.line}`,reason:`expected ${expectedWindows.length} real windows, confirmed ${expectedIndex}; successful native execution is not confirmed for every call` });
    if (!excerpt) {
      const complete = completedTrace(host, rows);
      if (!complete) checks.push({ id:'complete-trace',status:'unverified',evidence:`${trace}:${rows.at(-1)?.line ?? 1}`,reason:'successful terminal event missing; cut trace is not proof' });
    }
    const status = [...windows,...checks].some(c => c.status === 'failed') ? 'failed' : [...windows,...checks].some(c => c.status === 'unverified') ? 'unverified' : 'passed';
    return { host, status, trace, windows, checks, rules: { source:ruleSource, sha256:rulesDigest }, boundary:'mechanical checks only; conversation rubric still requires tester judgment' };
  } catch (error) { return {host,status:'unverified',trace,windows:[],checks,reason:error.message}; }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const r = checkTrace(request); console.log(JSON.stringify(r,null,2)); process.exitCode = r.status === 'passed' ? 0 : r.status === 'failed' ? 1 : 2; }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
