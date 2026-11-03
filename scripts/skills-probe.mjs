#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auditRows, parentTurns } from './skills-audit.mjs';
import { MissingEvidence } from './skills-boundary.mjs';
import { readJsonLines } from './transports/journal.mjs';

import { validateReplies, textReply, isOwnerWindow } from './skills-owner.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const visibleText = text => typeof text === 'string' && text.replace(/[\s\p{Cf}\p{Variation_Selector}]/gu, '').length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validQuestion(question) {
  return question && nonempty(question.question) && nonempty(question.header) &&
    (question.multiSelect === undefined || typeof question.multiSelect === 'boolean') &&
    Array.isArray(question.options) && question.options.length >= 2 &&
    question.options.every(option => option && nonempty(option.label) && nonempty(option.description));
}

// The host probe's narrow Claude check: visible text in the current parent turn.
// Thinking content is supplementary evidence and never the detection rule.
export function claudeWindows(rows, source, options) {
  const audit=auditRows('claude',rows);
  const windows = [], seen = new Set();
  let text = [], thinking = [], toolResult = null;
  for (const { value: event, line } of rows) {
    if (!object(event) || !nonempty(event.type)) throw new Error(`line ${line}: invalid trace event`);
    if (event.parent_tool_use_id != null && !nonempty(event.parent_tool_use_id))
      throw new Error(`line ${line}: invalid parent_tool_use_id`);
    if (!event.parent_tool_use_id && (event.type === 'result' || (event.type === 'system' && event.subtype === 'init'))) {
      text = []; thinking = []; toolResult = null;
      continue;
    }
    if (!['user', 'assistant'].includes(event.type)) continue;
    if (!object(event.message)) throw new Error(`line ${line}: invalid message`);
    const blocks = event.message.content;
    const userString = event.type === 'user' && typeof blocks === 'string';
    if (!userString && (!Array.isArray(blocks) || blocks.some(block => !object(block) || !nonempty(block.type))))
      throw new Error(`line ${line}: invalid message content`);
    if (event.type === 'user' && !userString && blocks.some(block => block.type === 'tool_result' && !nonempty(block.tool_use_id)))
      throw new Error(`line ${line}: invalid tool_result id`);
    if (event.type === 'user') {
      if (event.parent_tool_use_id) continue;
      text = []; thinking = [];
      toolResult = !userString && blocks.some(b => b.type === 'tool_result') ? line : null;
      continue;
    }
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text !== 'string')
        throw new Error(`line ${line}: invalid text block`);
      if (block.type === 'tool_use' && (!nonempty(block.id) || !nonempty(block.name)))
        throw new Error(`line ${line}: invalid tool_use`);
      if (block.type === 'tool_use' && block.name === 'AskUserQuestion' &&
          (!Array.isArray(block.input?.questions) || !block.input.questions.length || !block.input.questions.every(validQuestion)))
        throw new Error(`line ${line}: malformed AskUserQuestion`);
      if (event.parent_tool_use_id) continue;
      if (block.type === 'text' && visibleText(block.text)) text.push(line);
      if (block.type === 'thinking') thinking.push(line);
      if (block.type !== 'tool_use' || block.name !== 'AskUserQuestion') continue;
      if (seen.has(block.id)) continue;
      seen.add(block.id);
      const proof=audit.windowProof(event,line,block.id,options);
      windows.push({
        evidence: `${source}:${line}`, line, callId: block.id, toolResult,
        textLines: [...new Set(text)], thinkingLines: [...new Set(thinking)],
        questions: block.input.questions,
        executionConfirmed:proof.status==='confirmed',
        status: proof.status==='unverified'?'unverified':text.length ? 'passed' : 'failed',
        reason: proof.status==='unverified'?'successful native permission or delivered answer missing for this phase':text.length ? 'visible text before window' : 'no visible text before window; thinking is not owner text',
      });
    }
  }
  return windows;
}

export function traceRows(filename, host = 'claude', options) {
  const data = fs.readFileSync(filename, 'utf8');
  let sample;
  try { sample = JSON.parse(data); } catch { /* Stream JSONL is not a JSON document. */ }
  let rows;
  if (sample?.events) {
    if (!Array.isArray(sample.events) || sample.events.some((row, i) =>
    !object(row) || !Number.isInteger(row.line) || row.line < 1 ||
    (i > 0 && row.line <= sample.events[i - 1].line))) throw new Error('invalid trace excerpt');
    rows = sample.events.map(row => ({ value: row.event, line: row.line }));
  } else {
    const parsed = readJsonLines(filename,{errorLines:true});
    const errors=parsed.errors.filter((_,i)=>!options?.endLine||parsed.invalidLines[i]<=options.endLine);
    if(errors.length)throw new Error(errors.join('; '));
    rows = parsed.events.filter(r=>!options?.endLine||r.line<=options.endLine);
  }
  auditRows(host,rows,options);
  return { rows, excerpt: Boolean(sample?.events) };
}

export function textExchanges(host, rows, expectedReplies) {
  validateReplies(expectedReplies);
  const turns=parentTurns(host,rows),exchanges=[];
  if(host==='claude') {
    const last=rows.findLast(r=>!r.value.parent_tool_use_id&&(['assistant','user','result'].includes(r.value.type)||r.value.type==='system'&&r.value.subtype==='init'));
    if(auditRows(host,rows).proof({kind:'terminal',result:last?.value}).status!=='confirmed')throw new MissingEvidence('successful final parent terminal missing');
  }
  let cursor=-1;
  for (const [index,expected] of expectedReplies.entries()) {
    const turn=turns.find(t=>t.line>cursor && t.question.endsWith('?')&&t.question.includes(expected.question));
    if (!turn) throw new Error(`last stage message missing for ${expected.id}`);
    textReply({expectedReplies},turn.text,index);
    if (turn.reply===undefined) throw new Error(`actual owner reply missing for ${expected.id}`);
    if (turn.reply!==expected.reply) throw new Error(`actual owner reply differs from scenario for ${expected.id}`);
    const response=turns.find(t=>t.line>turn.replyLine);
    if (!response) throw new Error(`stage did not continue after ${expected.id}`);
    if (expected.intent==='unclear'&&!response.text.includes('?')) throw new Error(`stage did not clarify ${expected.id}`);
    if (expected.intent==='correction'&&!response.text.includes(expected.correction.description)) throw new Error(`stage did not name correction for ${expected.id}`);
    exchanges.push({...turn,expected,response});cursor=turn.replyLine;
  }
  return exchanges;
}
export function checkEndings(exchanges) {
  const endings=new Map();
  for (const exchange of exchanges) {
    const ending=exchange.text.trim().split('\n').at(-1).trim(),stage=exchange.expected.stage;
    if (endings.has(ending)&&endings.get(ending)!==stage) throw new Error('identical endings across stages');
    endings.set(ending,stage);
  }
}
export function probeText({host,trace,expectedReplies}) {
  let rows;
  try{({rows}=traceRows(trace,host));validateReplies(expectedReplies);}catch(error){return {check:'text-turns',status:'unverified',reason:error.message};}
  try {
    const audit=auditRows(host,rows);
    const windows=audit.calls.filter(c=>isOwnerWindow(c.name));
    if(windows.length)return {check:'text-turns',status:'failed',reason:'stage called a window',windows};
    const exchanges=textExchanges(host,rows,expectedReplies);checkEndings(exchanges);
    return {check:'text-turns',status:'passed',exchanges,boundary:'completed parent questions and exact native replies only; full trace and record checks remain required'};
  } catch(error) {return {check:'text-turns',status:error instanceof MissingEvidence?'unverified':'failed',reason:error.message};}
}

export function probeClaude(filename, options = {}) {
  if(options.expectedReplies)return probeText({host:'claude',trace:filename,expectedReplies:options.expectedReplies});
  try {
    const { rows, excerpt } = traceRows(filename,'claude');
    const phase=options.phase??(excerpt?'excerpt':'complete');
    const windows = claudeWindows(rows, filename, {phase});
    const status = !windows.length ? 'unverified' : windows.some(w => w.status === 'unverified') ? 'unverified' : windows.some(w => w.status === 'failed') ? 'failed' : 'passed';
    return { check: 'claude-text-before-window', phase, status, windows,
      boundary: excerpt ? 'sanitized excerpt; original line numbers' : phase==='excerpt'?'explicit narrow excerpt probe':phase==='card'?'pre-answer card check':'supplied finished stream-json trace only',
      ...(windows.length ? {} : { reason: 'no top-level AskUserQuestion reached; harness evidence required' }) };
  } catch (error) {
    return { check: 'claude-text-before-window', status: 'unverified', windows: [], reason: error.message };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--text') {
    let result;try{result=probeText(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));}catch(error){result={status:'unverified',reason:error.message};}
    console.log(JSON.stringify(result,null,2));process.exit(result.status==='passed'?0:result.status==='failed'?1:2);
  }
  if (![3,4].includes(process.argv.length) || (process.argv.length===4&&process.argv[3]!=='--excerpt') || ['--help', '-h'].includes(process.argv[2])) {
    console.error('Usage: node scripts/skills-probe.mjs <claude-stream.jsonl|trace-excerpt.json> [--excerpt]');
    process.exit(['--help', '-h'].includes(process.argv[2]) ? 0 : 2);
  }
  const result = probeClaude(process.argv[2],process.argv[3]==='--excerpt'?{phase:'excerpt'}:{});
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'passed' ? 0 : result.status === 'failed' ? 1 : 2);
}
