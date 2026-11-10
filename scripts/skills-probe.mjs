#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auditRows, parentTurns, completedTrace } from './skills-audit.mjs';
import { MissingEvidence } from './skills-boundary.mjs';
import { readJsonLines } from './transports/journal.mjs';

import { validateReplies, textReply, isOwnerWindow, checkStageResponse, stageQuestion, progressOnly } from './skills-owner.mjs';

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
      if (event.parent_tool_use_id || event.isSynthetic===true || event.origin?.kind==='task-notification') continue;
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

// Progress is not an offer. The single neutral scenario continuation has its
// own native reply line and cannot authorize a write or advance a reply policy.
export function textStageTurns(host,rows,expectedReplies,{startLine=0,idleContinuation}={}) {
 const turns=[],nudges=[];let index=0;
 for(const turn of parentTurns(host,rows).filter(t=>t.line>startLine)){
  if(host==='claude'&&expectedReplies[index]&&progressOnly(expectedReplies[index],turn.text)){
   if(turn.reply===undefined)continue;
   if(idleContinuation==='Продолжай.'&&turn.reply===idleContinuation&&nudges.length===0){nudges.push({kind:'non-consent',text:turn.reply,line:turn.line,terminalLine:turn.terminalLine,replyLine:turn.replyLine});continue;}
  }
  turns.push(turn);if(turn.reply!==undefined)index++;
 }
 return {turns,nudges};
}
export function textExchanges(host, rows, expectedReplies, {startLine=0,idleContinuation}={}) {
  validateReplies(expectedReplies);
  const audit=auditRows(host,rows);
  if(!completedTrace(host,rows))throw new MissingEvidence('successful final parent terminal missing');
  if(!Number.isInteger(startLine)||startLine<0||(startLine>0&&audit.proof({kind:'terminal',result:rows.find(r=>r.line===startLine)?.value}).status!=='confirmed'))throw new MissingEvidence('native stage start boundary missing');
  const {turns,nudges}=textStageTurns(host,rows,expectedReplies,{startLine,idleContinuation}),exchanges=[];
  if(turns.some(turn=>!visibleText(turn.text)))throw new Error('completed parent stage turn has no final text');
  let cursor=-1;
  for (const [index,expected] of expectedReplies.entries()) {
    const turn=turns.find(t=>t.line>cursor);
    if (!turn) throw new Error(`last stage message missing for ${expected.id}`);
    textReply({expectedReplies},turn.text,index);
    turn.question=stageQuestion(expected,turn.text);
    if (turn.reply===undefined) throw new Error(`actual owner reply missing for ${expected.id}`);
    if (turn.reply!==expected.reply) throw new Error(`actual owner reply differs from scenario for ${expected.id}`);
    const response=turns.find(t=>t.line>turn.replyLine);
    if (!response) throw new Error(`stage did not continue after ${expected.id}`);
    if (expected.response!==undefined) checkStageResponse(expected,response.text);
    if (expected.intent==='unclear'&&(response.text.match(/\?/g)??[]).length!==1) throw new Error(`stage did not clarify ${expected.id}`);
    if (expected.intent==='correction'&&expected.correction.description&&!response.text.includes(expected.correction.description)) throw new Error(`stage did not name correction for ${expected.id}`);
    exchanges.push({...turn,expected,response,...(!index&&nudges.length?{nudges}:{})});cursor=turn.replyLine;
  }
  const replyLines=new Set([...exchanges.map(e=>e.replyLine),...nudges.map(n=>n.replyLine)]);
  for(const row of rows.filter(r=>r.line>exchanges[0].line)){
    const message=audit.proof({kind:'text-message',result:row.value});
    if(message.status==='confirmed'&&message.role==='user'&&!replyLines.has(row.line))throw new Error('unexpected owner reply without scenario policy');
  }
  const trailing=turns.filter(t=>t.line>cursor);
  if(trailing.length!==1||trailing[0].reply!==undefined)throw new Error('unexpected trailing stage turn or owner exchange without scenario policy');
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
export function probeText({host,trace,expectedReplies,stageStartLine,idleContinuation}) {
  let rows;
  try{({rows}=traceRows(trace,host));validateReplies(expectedReplies);}catch(error){return {check:'text-turns',status:'unverified',reason:error.message};}
  try {
    const audit=auditRows(host,rows);
    const windows=audit.calls.filter(c=>isOwnerWindow(c.name));
    if(windows.length)return {check:'text-turns',status:'failed',reason:'stage called a window',windows};
    const exchanges=textExchanges(host,rows,expectedReplies,{startLine:stageStartLine,idleContinuation});checkEndings(exchanges);
    return {check:'text-turns',status:'passed',exchanges,boundary:'completed parent questions and exact native replies only; full trace and record checks remain required'};
  } catch(error) {return {check:'text-turns',status:error instanceof MissingEvidence?'unverified':'failed',reason:error.message};}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
 try {
  const file=process.argv[2]==='--text'?process.argv[3]:process.argv[2];
  const r=probeText(JSON.parse(fs.readFileSync(file,'utf8'))); console.log(JSON.stringify(r,null,2)); process.exitCode=r.status==='passed'?0:r.status==='failed'?1:2;
 } catch(error) {console.log(JSON.stringify({status:'unverified',reason:error.message}));process.exitCode=2;}
}
