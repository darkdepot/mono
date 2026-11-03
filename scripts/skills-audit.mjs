import { codexToolCalls, MissingEvidence } from './skills-boundary.mjs';
import { nativeProof } from './skills-proof.mjs';

// Tool actions are audited; informational host events remain open.
export function auditRows(host, rows, {stdout = false} = {}) {
  const calls = [], notes = [];
  const reject = (line, reason) => { throw new MissingEvidence(`line ${line}: ${reason}`); };
  if (!['claude','codex'].includes(host)) throw new MissingEvidence('unknown trace host');
  for (const {value:e,line} of rows) {
    if (!e || typeof e.type !== 'string') reject(line,'invalid native event');
    if (host === 'codex') {
      if (stdout) {
        if(e.type.startsWith('item.')&&['command_execution','mcp_tool_call','web_search'].includes(e.item?.type))reject(line,'persona tool observed');
      } else if(e.type==='event_msg'&&e.payload?.type==='item_completed'&&e.payload.item?.type==='McpToolCall'){
        const item=e.payload.item;
        if(typeof item.server==='string'&&typeof item.tool==='string')calls.push({name:`mcp__${item.server}__${item.tool}`,input:item.arguments,callId:item.id,event:e,line});
      } else if (e.type === 'response_item') {
        try {
          for (const call of codexToolCalls(e.payload)) calls.push({...call,event:e,line});
          const p=e.payload;
          if(!['message','reasoning','function_call','custom_tool_call','function_call_output','custom_tool_call_output'].includes(p?.type))notes.push(`line ${line}: host item ${p?.type}`);
          if(['custom_tool_call','function_call'].includes(p?.type)&&p.name==='exec'&&(/\bALL_TOOLS\b|tools\s*\[/.test(p.input??p.arguments)||!codexToolCalls(p).length))notes.push(`line ${line}: dynamic exec access; isolation relies on test home/MCP`);
        }
        catch (error) { reject(line,error.message); }
      }
    } else {
      if (['assistant','user'].includes(e.type)) {
        const content=e.message?.content;
        if (e.type==='user' && typeof content==='string') continue;
        if (!Array.isArray(content)) reject(line,'invalid Claude content');
        for (const block of content) {
          if(!block||typeof block.type!=='string')reject(line,'invalid Claude content block');
          if (block.type==='tool_use') {
            if (typeof block.id!=='string'||!block.id||typeof block.name!=='string'||!block.name) reject(line,'invalid Claude tool call');
            calls.push({name:block.name,input:block.input,callId:block.id,event:e,line});
          }
        }
      }
    }
  }
  const proof=request=>nativeProof({...request,host});
  // Same execution phase for every behavioral path. An explicit excerpt may
  // omit native execution evidence, but cannot turn present bad proof green.
  const windowProof=(call,line,callId,{phase='complete',responses=[]}={})=>{
    if(!['complete','card','excerpt'].includes(phase))throw new MissingEvidence('unknown window execution phase');
    const following=rows.filter(r=>r.line>line);
    let accepted,answer,resultLine;
    if(host==='claude'){
      const boundary=following.find(r=>!r.value.parent_tool_use_id&&(r.value.type==='result'||(r.value.type==='assistant'&&r.value.message?.content?.some(b=>b.type==='tool_use'&&b.name==='AskUserQuestion'))));
      const turn=following.filter(r=>!boundary||r.line<boundary.line);
      const permission=turn.find(r=>r.value.type==='control_request'&&r.value.request?.tool_name==='AskUserQuestion');
      accepted=proof({kind:'window',call,result:permission?.value,callId});
      if(accepted.status!=='confirmed')return phase==='excerpt'&&!permission?{status:'omitted'}:accepted;
      const receipt=turn.find(r=>r.line>permission.line&&r.value.type==='user'&&Array.isArray(r.value.message?.content)&&r.value.message.content.some(b=>b.type==='tool_result'&&b.tool_use_id===callId));
      const reply=responses.find(e=>e.type==='control_response'&&e.response?.request_id===permission.value.request_id);
      answer=()=>proof({kind:'answer',call,result:receipt?.value,callId,reply});
    }else{
      const boundary=following.find(r=>(r.value.type==='response_item'&&r.value.payload?.type==='message'&&r.value.payload.role==='user')||(r.value.type==='event_msg'&&['task_complete','task_started','turn_aborted'].includes(r.value.payload?.type)));
      const outputs=following.filter(r=>(!boundary||r.line<boundary.line)&&['function_call_output','custom_tool_call_output'].includes(r.value.payload?.type)&&r.value.payload.call_id===callId);
      accepted=proof({kind:'window',call,result:outputs.length===1?outputs[0].value:undefined});
      if(accepted.status!=='confirmed')return accepted;
      resultLine=outputs[0].line;
      const receipt=following.find(r=>r.line>outputs[0].line&&r.value.type==='response_item'&&r.value.payload?.type==='message'&&r.value.payload.role==='user');
      answer=()=>proof({kind:'answer',call,result:receipt?.value,callId});
    }
    if(phase==='complete'&&answer().status!=='confirmed')return {status:'unverified'};
    return {...accepted,resultLine};
  };
  return {calls,notes,proof,windowProof};
}

// Only completed parent turns can offer a text question. A tool call or result
// invalidates earlier prose; tool-result user envelopes are never owner replies.
export function parentTurns(host, rows) {
  const audit=auditRows(host,rows),turns=[];
  let candidate=null,pending=null,turnId;
  for (const {value:e,line} of rows) {
    if (e.parent_tool_use_id) continue;
    const p=e.payload;
    if(host==='codex'&&e.type==='event_msg'&&p?.type==='task_started')turnId=p.turn_id;
    const message=audit.proof({kind:'text-message',result:e});
    if (message.status==='confirmed'&&message.role==='user') {
      if (pending) {pending.reply=message.value;pending.replyLine=line;pending=null;}
      candidate=null;
    } else if (message.status==='confirmed'&&message.role==='assistant') {
      pending=null;
      const text=host==='claude'&&candidate?.messageId&&candidate.messageId===message.messageId?candidate.text+'\n'+message.value:message.value;
      candidate={line,text,messageId:message.messageId,phase:message.phase};
    } else if (audit.calls.some(c=>c.line===line) || (host==='claude'&&['user','assistant'].includes(e.type)) ||
        (host==='codex'&&e.type==='response_item'&&['reasoning','message','function_call_output','custom_tool_call_output'].includes(p?.type))) {candidate=null;pending=null;}
    if (audit.proof({kind:'terminal',result:e}).status==='confirmed'&&(host==='claude'||p?.turn_id===turnId)) {
      if (candidate && (host==='claude'||candidate.phase==='final_answer')) {
        pending={...candidate,question:candidate.text.trim().split('\n').at(-1),terminalLine:line};turns.push(pending);
      }else pending=null;
      candidate=null;
    }
    if ((host==='claude'&&e.type==='system'&&e.subtype==='init') ||
        (host==='codex'&&e.type==='event_msg'&&['task_started','turn_aborted','error'].includes(p?.type))) candidate=null;
  }
  return turns;
}
