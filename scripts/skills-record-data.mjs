import { traceRows } from './skills-probe.mjs';
import { auditRows } from './skills-audit.mjs';
import { MissingEvidence } from './skills-boundary.mjs';
import { nativeProof } from './skills-proof.mjs';
const text=value=>typeof value==='string'&&value.trim().length>0;
const missing=reason=>{throw new MissingEvidence(reason);};

// Only native direct input or the driver's literal JSON exec route binds payloads.
// Arbitrary JavaScript is deliberately not parsed; an unknown route is unverified.
function callInput(host,call){
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
export function nativeRecords(host,trace,endLine){return {...nativeData(host,traceRows(trace,host,{endLine}).rows.filter(r=>endLine===undefined||r.line<=endLine)),host,trace};}
export function nativeData(host,rows){
 const audit=auditRows(host,rows);
 const calls=audit.calls.filter(c=>c.name.startsWith('mcp__'));
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
 }
 return {rows,audit:{...audit,calls:audit.calls.filter(c=>!calls.includes(c)||bound.includes(c))},calls:bound};
}
