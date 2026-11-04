#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MissingEvidence } from './skills-boundary.mjs';
import { auditRows, completedTrace, codexTerminals } from './skills-audit.mjs';
import { claudeWindows, traceRows, visibleText, textExchanges, checkEndings } from './skills-probe.mjs';
import { roleWindows, windowRole, validateReplies, isOwnerWindow } from './skills-owner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Full rule source, including final-message order. A rule edit requires checker/rubric review.
export const OWNER_DIALOG_SHA256 = '9b07cb3b2cdede5df62cc26f125676f5d533a5588ac849f49a4887d3755c5be3';
export const visible = visibleText;
export { completedTrace, codexTerminals } from './skills-audit.mjs';
export { textExchanges, checkEndings } from './skills-probe.mjs';
const textOf = p => (p.content ?? []).filter(b => ['text', 'output_text'].includes(b.type)).map(b => b.text).join('\n');
export function codexItems(rows) {
  auditRows('codex',rows);
  return rows.filter(r => r.value?.type === 'response_item').map(r => ({ ...r, item: r.value.payload }));
}
export function codexWindows(rows, source, options) {
  const audit=auditRows('codex',rows);
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
    const proof = audit.windowProof(row.value,row.line,p.call_id,options);
    let args;try{args=JSON.parse(p.arguments);}catch{args=null;}
    const executionConfirmed = proof.status === 'confirmed';
    const last = turn.filter(r=>['message','function_call','custom_tool_call','function_call_output','custom_tool_call_output'].includes(r.item.type)).at(-1);
    const summary = last?.item.type === 'message' && last.item.role === 'assistant' && last.item.phase === 'final_answer' ? textOf(last.item) : '';
    windows.push({ line: row.line, evidence: `${source}:${row.line}`, callId: p.call_id, questions: args?.questions ?? [],
      executionConfirmed, resultEvidence: proof.resultLine ? `${source}:${proof.resultLine}` : null,
      summary, summaryLine: last?.line, status: !executionConfirmed ? 'unverified' : visible(summary) ? 'passed' : 'failed',
      reason: !executionConfirmed ? 'linked native accepted:true window or delivered answer missing for this phase' : visible(summary) ? 'async summary is the last message' : 'async summary must be final and last; no calls after it' });
  }
  return windows;
}


function cardIssues(host, questions, expected) {
  const issues = [];
  if (questions.length !== 1) issues.push('one question at a time');
  for (const q of questions) {
    const title = host === 'claude' ? q.question : q.title;
    const options = q.options;
    if (host === 'codex' && options == null && typeof title === 'string' && visible(title)) continue;
    if (typeof title !== 'string' || !Array.isArray(options) || options.length < 2 || options.length > 3) { issues.push('invalid question or option count'); continue; }
    const labels = options.map(o => typeof o === 'string' ? o : o?.label);
    if (labels.some(l => typeof l !== 'string' || !visible(l))) { issues.push('invalid option label'); continue; }
    if (!labels[0].endsWith(' (Recommended)') || labels.slice(1).some(l => l.endsWith(' (Recommended)'))) issues.push('recommended option must be first and unique');
    const gist = title.split('\n')[0];
    if(expected){
      for (const key of ['decision', 'advice', 'reason']) if (!gist.includes(expected[key])) issues.push(`question lacks scenario ${key}`);
    }else if(!gist.includes('Совет'))issues.push('question lacks advice');
    if ((gist.match(/[.!?]+(?:\s|$)/g)??[]).length > 2) issues.push('question gist exceeds two sentences');
    if (/https?:\/\/|\[[^\]]+\]\(|[`*#]/.test(gist)) issues.push('question gist has links or markup');
    const consequences = host === 'claude' ? options.map(o => o.description)
      : labels.map(label => title.split('\n').find(l => l.startsWith(`${label}:`))?.slice(label.length + 1));
    if (consequences.some(s => typeof s !== 'string' || s.includes('\n') || !s.split('/').every(visible) || !s.includes('/'))) issues.push('each option needs one consequence / tradeoff line');
    if (host === 'claude' && (typeof q.header !== 'string' || [...q.header].length > 12 || !visible(q.header) || labels.some(l => {const n=l.replace(/ \(Recommended\)$/, '').trim().split(/\s+/).length;return n<1||n>5;}))) issues.push('Claude header or label length');
  }
  return issues;
}

export function checkTrace({ host, trace, expectedWindows, expectedReplies, rulesRoot = root, excerpt = false, phase = excerpt ? 'excerpt' : 'complete', endLine, stageStartLine, sent }) {
  const windows = [], checks = [];
  try {
    const ruleSource = path.join(rulesRoot, 'references/owner-dialog.md');
    const rulesDigest = crypto.createHash('sha256').update(fs.readFileSync(ruleSource)).digest('hex');
    if (rulesDigest !== OWNER_DIALOG_SHA256) throw new Error('owner-dialog changed: update checker and conversation rubric together');
    if (expectedReplies!==undefined) return checkTextTrace({host,trace,expectedReplies,expectedWindows,rulesRoot,phase,endLine,stageStartLine});
    const roles=roleWindows(expectedWindows);
    if (!['claude', 'codex'].includes(host) || !Array.isArray(expectedWindows) || !expectedWindows.length || expectedWindows.some(w =>
      !w?.id || (roles&&!['approval','transition'].includes(w.role)) || ['decision','advice','reason'].some(k => !visible(w[k])) || !Array.isArray(w.summary) || (!roles&&!w.summary.length) || w.summary.some(s => !visible(s)))) throw new Error('scenario expectedWindows needs id, role, decision, advice, reason and summary anchors');
    const { rows } = traceRows(trace,host,{endLine});
    if (rows.some(r => !r.value || typeof r.value.type !== 'string')) throw new Error('invalid trace envelope');
    const responses=host==='claude'&&sent?traceRows(sent,'claude').rows.map(r=>r.value):[];
    const found = host === 'claude' ? claudeWindows(rows, trace, {phase,responses}) : codexWindows(rows, trace, {phase});
    let expectedIndex = 0;
    for (const [i, w] of found.entries()) {
      const role=roles?windowRole(w.questions):null,target=!roles||role!==null;
      const expected = target?expectedWindows[expectedIndex]:null;
      const identity={target,role:role??(roles?'generic':'target'),id:expected?.id??`generic-${i}`};
      if (w.status === 'unverified') {
        windows.push({ ...w,...identity,issues: [w.reason] });
        continue;
      }
      if(target)expectedIndex++;
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
        if(roles&&expected.role!==role)issues.push('unexpected target role');
        issues.push(...cardIssues(host, w.questions, expected));
        if (visible(summary)&&!expected.summary.every(s => summary.includes(s))) issues.push('summary lacks scenario content');
      } else if(roles&&!target)issues.push(...cardIssues(host,w.questions,null));
      else issues.push('unexpected window without scenario policy');
      windows.push({ ...w,...identity,issues,status: issues.length ? 'failed' : 'passed' });
    }
    const uncertain = found.find(w => w.status === 'unverified');
    if (expectedIndex > expectedWindows.length || (!uncertain && expectedIndex !== expectedWindows.length&&!(roles&&phase==='card'))) checks.push({ id:'expected-windows',status:'failed',evidence:`${trace}:${rows.at(-1)?.line ?? 1}`,reason:`expected ${expectedWindows.length} real target windows, found ${expectedIndex}; text is not a window` });
    if (uncertain) checks.push({ id:'expected-windows',status:'unverified',evidence:`${trace}:${uncertain.line}`,reason:`expected ${expectedWindows.length} real windows, confirmed ${expectedIndex}; successful native execution is not confirmed for every call` });
    if (phase !== 'excerpt') {
      const complete = completedTrace(host, rows);
      if (!complete) checks.push({ id:'complete-trace',status:'unverified',evidence:`${trace}:${rows.at(-1)?.line ?? 1}`,reason:'successful terminal event missing; cut trace is not proof' });
    }
    const status = [...windows,...checks].some(c => c.status === 'failed') ? 'failed' : [...windows,...checks].some(c => c.status === 'unverified') ? 'unverified' : 'passed';
    return { host, status, phase, trace, windows, checks, rules: { source:ruleSource, sha256:rulesDigest }, boundary:'mechanical checks only; conversation rubric still requires tester judgment' };
  } catch (error) { return {host,status:'unverified',trace,windows:[],checks,reason:error.message}; }
}
// Shared with the probe and record verifier; expected words/outcomes stay in the
// scenario. No approval is inferred from a Russian phrase or a model's verdict.
function checkTextTrace({host,trace,expectedReplies,expectedWindows,phase,stageStartLine}) {
  const checks=[],exchanges=[];
  let rows;
  try{({rows}=traceRows(trace,host));}catch(error){return {host,trace,status:'unverified',windows:[],checks,reason:error.message};}
  try {
    validateReplies(expectedReplies);
    if (expectedWindows?.length) throw new Error('scenario must choose text replies or windows');
    const audit=auditRows(host,rows);
    const windows=audit.calls.filter(c=>isOwnerWindow(c.name));
    if (windows.length) throw new Error(`stage called a window: ${windows[0].name} at ${trace}:${windows[0].line}`);
    exchanges.push(...textExchanges(host,rows,expectedReplies,{startLine:stageStartLine}));
    checkEndings(exchanges);
    if (phase!=='excerpt'&&!completedTrace(host,rows)) return {host,trace,status:'unverified',windows:[],exchanges,checks,reason:'successful terminal event missing'};
    return {host,trace,status:'passed',windows:[],exchanges,checks,boundary:'mechanical checks; predetermined outcomes and exact native replies, conversation quality still requires rubric'};
  } catch(error) {return {host,trace,status:error instanceof MissingEvidence?'unverified':'failed',windows:[],exchanges,checks,reason:error.message};}
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const r = checkTrace(request); console.log(JSON.stringify(r,null,2)); process.exitCode = r.status === 'passed' ? 0 : r.status === 'failed' ? 1 : 2; }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
