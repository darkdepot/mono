#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MissingEvidence } from './skills-boundary.mjs';
import { auditRows, completedTrace, codexTerminals } from './skills-audit.mjs';
import { traceRows, visibleText, textExchanges, checkEndings } from './skills-probe.mjs';
import { validateReplies, isOwnerWindow } from './skills-owner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Full rule source, including final-message order. A rule edit requires checker/rubric review.
export const OWNER_DIALOG_SHA256 = 'f2c3870c84841dbbdeeab2e257025bb0daefd459f7f4f11aafe11a9308c90499';
export const visible = visibleText;
export { completedTrace, codexTerminals } from './skills-audit.mjs';
export { textExchanges, checkEndings } from './skills-probe.mjs';
const textOf = p => (p.content ?? []).filter(b => ['text', 'output_text'].includes(b.type)).map(b => b.text).join('\n');
export function codexItems(rows) {
  auditRows('codex',rows);
  return rows.filter(r => r.value?.type === 'response_item').map(r => ({ ...r, item: r.value.payload }));
}
// Shared with the probe and record verifier; expected words/outcomes stay in the
// scenario. No approval is inferred from a Russian phrase or a model's verdict.
export function checkTrace({host,trace,expectedReplies,expectedWindows,phase='complete',stageStartLine,rulesRoot=root}) {
  const checks=[],exchanges=[];
  let rows;
  try{({rows}=traceRows(trace,host));}catch(error){return {host,trace,status:'unverified',windows:[],checks,reason:error.message};}
  try {
    const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(rulesRoot,'references/owner-dialog.md'))).digest('hex');
    if(digest!==OWNER_DIALOG_SHA256)throw new Error('owner-dialog changed: update checker and conversation rubric together');
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
