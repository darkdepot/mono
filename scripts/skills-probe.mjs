#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auditRows, parentTurns, completedTrace } from './skills-audit.mjs';
import { MissingEvidence } from './skills-boundary.mjs';
import { readJsonLines } from './transports/journal.mjs';

import { validateReplies, textReply, isOwnerWindow, checkStageResponse } from './skills-owner.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const visibleText = text => typeof text === 'string' && text.replace(/[\s\p{Cf}\p{Variation_Selector}]/gu, '').length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
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

export function textExchanges(host, rows, expectedReplies, {startLine=0}={}) {
  validateReplies(expectedReplies);
  const audit=auditRows(host,rows);
  if(!completedTrace(host,rows))throw new MissingEvidence('successful final parent terminal missing');
  if(!Number.isInteger(startLine)||startLine<0||(startLine>0&&audit.proof({kind:'terminal',result:rows.find(r=>r.line===startLine)?.value}).status!=='confirmed'))throw new MissingEvidence('native stage start boundary missing');
  const turns=parentTurns(host,rows).filter(t=>t.line>startLine),exchanges=[];
  if(turns.some(turn=>!visibleText(turn.text)))throw new Error('completed parent stage turn has no final text');
  let cursor=-1;
  for (const [index,expected] of expectedReplies.entries()) {
    const turn=turns.find(t=>t.line>cursor);
    if (!turn) throw new Error(`last stage message missing for ${expected.id}`);
    textReply({expectedReplies},turn.text,index);
    if (turn.reply===undefined) throw new Error(`actual owner reply missing for ${expected.id}`);
    if (turn.reply!==expected.reply) throw new Error(`actual owner reply differs from scenario for ${expected.id}`);
    const response=turns.find(t=>t.line>turn.replyLine);
    if (!response) throw new Error(`stage did not continue after ${expected.id}`);
    if (expected.response!==undefined) checkStageResponse(expected,response.text);
    if (expected.intent==='unclear'&&!response.text.trimEnd().endsWith('?')) throw new Error(`stage did not clarify ${expected.id}`);
    if (expected.intent==='correction'&&expected.correction.description&&!response.text.includes(expected.correction.description)) throw new Error(`stage did not name correction for ${expected.id}`);
    exchanges.push({...turn,expected,response});cursor=turn.replyLine;
  }
  const replyLines=new Set(exchanges.map(e=>e.replyLine));
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
export function probeText({host,trace,expectedReplies,stageStartLine}) {
  let rows;
  try{({rows}=traceRows(trace,host));validateReplies(expectedReplies);}catch(error){return {check:'text-turns',status:'unverified',reason:error.message};}
  try {
    const audit=auditRows(host,rows);
    const windows=audit.calls.filter(c=>isOwnerWindow(c.name));
    if(windows.length)return {check:'text-turns',status:'failed',reason:'stage called a window',windows};
    const exchanges=textExchanges(host,rows,expectedReplies,{startLine:stageStartLine});checkEndings(exchanges);
    return {check:'text-turns',status:'passed',exchanges,boundary:'completed parent questions and exact native replies only; full trace and record checks remain required'};
  } catch(error) {return {check:'text-turns',status:error instanceof MissingEvidence?'unverified':'failed',reason:error.message};}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
 try {
  const file=process.argv[2]==='--text'?process.argv[3]:process.argv[2];
  const r=probeText(JSON.parse(fs.readFileSync(file,'utf8'))); console.log(JSON.stringify(r,null,2)); process.exitCode=r.status==='passed'?0:r.status==='failed'?1:2;
 } catch(error) {console.log(JSON.stringify({status:'unverified',reason:error.message}));process.exitCode=2;}
}
