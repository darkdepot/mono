import { isDeepStrictEqual } from 'node:util';
import { traceRows } from './skills-probe.mjs';
import { auditRows } from './skills-audit.mjs';
import { MissingEvidence } from './skills-boundary.mjs';
import { nativeProof } from './skills-proof.mjs';
const text=value=>typeof value==='string'&&value.trim().length>0;
const missing=reason=>{throw new MissingEvidence(reason);};

// Only native direct input or the driver's literal JSON exec route binds payloads.
// Arbitrary JavaScript is deliberately not parsed; an unknown route is unverified.
export function callInput(host,call){
 if(host!=='codex'||call.event.payload?.name!=='exec')return call.input;
 const p=call.event.payload,source=p.type==='custom_tool_call'?p.input:p.arguments;
 const prefix=`const r = await tools.${call.name}(`,suffix='); text(r);';
 if(typeof source!=='string'||!source.trim().startsWith(prefix)||!source.trim().endsWith(suffix))missing(`unbound exec payload at line ${call.line}`);
 try{return JSON.parse(source.trim().slice(prefix.length,-suffix.length));}catch{missing(`non-JSON exec payload at line ${call.line}`);}
}
export function resultFor(host,call,rows,bindInput=true){
 if(host==='codex'&&call.event.type==='event_msg'){
  const proof=nativeProof({host,kind:'record',call:call.event,result:call.event,callId:call.callId});
  if(proof.status!=='confirmed')missing(`successful native MCP result missing at line ${call.line}`);
  return {...call,value:proof.value,raw:proof.raw,resultLine:call.line};
 }
 const outputs=rows.filter(r=>r.line>call.line&&(host==='claude'
  ? r.value.type==='user'&&Array.isArray(r.value.message?.content)&&r.value.message.content.some(b=>b.type==='tool_result'&&b.tool_use_id===call.callId)
  : r.value.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(r.value.payload?.type)&&r.value.payload.call_id===call.callId));
 if(outputs.length!==1)missing(`unique linked result missing at line ${call.line}`);
 const result=outputs[0],proof=nativeProof({host,kind:'record',call:call.event,result:result.value,callId:call.callId});
 if(proof.status!=='confirmed')missing(`successful record result missing at line ${result.line}`);
 return {...call,input:bindInput?callInput(host,call):call.input,value:proof.value,raw:proof.raw,resultLine:result.line};
}
// This native error asserts no mutation, unlike a timeout or an unknown result.
// Recovery still requires a later successful same-target write and fresh read.
export function unsavedResult(host,call,rows){
 if(host!=='claude')return null;
 const receipts=rows.filter(r=>r.line>call.line&&r.value.type==='user'&&Array.isArray(r.value.message?.content)&&r.value.message.content.some(b=>b.type==='tool_result'&&b.tool_use_id===call.callId));
 if(receipts.length!==1)return null;
 const blocks=receipts[0].value.message.content.filter(b=>b.type==='tool_result'&&b.tool_use_id===call.callId);
 const block=blocks.length===1?blocks[0]:null;
 return block?.is_error===true&&typeof block.content==='string'&&/\bPatch failed, nothing was saved\./.test(block.content)?receipts[0]:null;
}
export function nativeRecords(host,trace,endLine){return {...nativeData(host,traceRows(trace,host,{endLine}).rows.filter(r=>endLine===undefined||r.line<=endLine)),host,trace};}
function recordExecCall(call,rows){
 const item=call.event.payload;
 if(item?.name!=='exec'||!call.name.startsWith('mcp__'))return true;
 let source=item.type==='custom_tool_call'?item.input:item.arguments;
 const output=rows.find(r=>r.line>call.line&&['custom_tool_call_output','function_call_output'].includes(r.value.payload?.type)&&r.value.payload.call_id===call.callId);
 // Native shell metadata proves these exact string literals are command data,
 // even with unquoted JS object keys. Do not parse or execute arbitrary JS.
 for(const row of rows.filter(r=>r.line>call.line&&output&&r.line<output.line)){
  const command=row.value.payload?.item;
  if(command?.type==='CommandExecution'&&Array.isArray(command.command)&&typeof command.command.at(-1)==='string')source=source.replaceAll(JSON.stringify(command.command.at(-1)),'null');
 }
 return new RegExp(`\\btools\\.${call.name}\\s*\\(`).test(source);
}
export function nativeData(host,rows){
 const audit=auditRows(host,rows);
 const actions=audit.calls.filter(c=>recordExecCall(c,rows));
 const calls=actions.filter(c=>c.name.startsWith('mcp__'));
 // An exec name mention is not another action when native metadata supplies
 // its arguments/result inside that exact outer call/output interval.
 const actual=calls.filter(call=>call.event.type==='event_msg');
 if(actual.some((c,i)=>!text(c.callId)||actual.slice(0,i).some(prior=>prior.callId===c.callId)))missing('duplicate/missing native MCP item id');
 const bound=calls.filter(call=>{
  if(call.event.payload?.name!=='exec')return true;
  const output=rows.find(r=>r.line>call.line&&r.value.type==='response_item'&&['custom_tool_call_output','function_call_output'].includes(r.value.payload?.type)&&r.value.payload.call_id===call.callId);
  return !output||!actual.some(c=>c.name===call.name&&c.line>call.line&&c.line<output.line);
 });
 for(const call of actual){
  // A completion timestamp is not a request timestamp. The native session's
  // beginning is a conservative lower bound, including concurrent MCP calls;
  // do not guess which similarly named exec invocation owned this completion.
  call.invocationLine=rows.find(r=>r.line<call.line&&(r.value.type==='session_meta'||r.value.type==='event_msg'&&r.value.payload?.type==='task_started'))?.line;
  // Approval ordering needs an actual invocation, not that session lower bound.
  let unknownOwner=false;
  const invocations=calls.filter(outer=>{
   if(outer.event.payload?.name!=='exec'||outer.name!==call.name||outer.line>=call.line)return false;
   const output=rows.find(r=>r.line>outer.line&&r.value.type==='response_item'&&['custom_tool_call_output','function_call_output'].includes(r.value.payload?.type)&&r.value.payload.call_id===outer.callId);
   if(output&&output.line<=call.line)return false;
   try{if(!isDeepStrictEqual(callInput(host,outer),call.input))return false;}
   catch{unknownOwner=true;return false;}
   if(!output){unknownOwner=true;return false;}
   return true;
  });
  if(!unknownOwner&&invocations.length===1)call.approvalInvocationLine=invocations[0].line;
 }
 return {rows,audit:{...audit,calls:actions.filter(c=>!calls.includes(c)||bound.includes(c))},calls:bound};
}
