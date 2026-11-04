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

// A turn closes at its native successful parent terminal (Codex: the active
// turn_id). A session is complete only when its last parent activity is such a
// terminal. Text policy is separate: a completed tool-only scout is legitimate.
function turnState(host, rows, options) {
  const audit=auditRows(host,rows,options),terminals=[],activityLines=new Set();
  const calls=new Set(audit.calls.map(c=>c.line));
  let turnId,lastActivity;
  for(const row of rows) {
    const e=row.value,p=e.payload;
    if(e.parent_tool_use_id)continue;
    if(host==='codex'&&e.type==='event_msg'&&p?.type==='task_started')turnId=p.turn_id;
    const terminal=audit.proof({kind:'terminal',result:e}).status==='confirmed' &&
      (host==='claude'||p?.turn_id===turnId);
    if(terminal){terminals.push(row);if(host==='codex')turnId=undefined;}
    const activity=host==='claude'
      ? ['assistant','user','result','control_request'].includes(e.type)||(e.type==='system'&&e.subtype==='init')
      : (e.type==='response_item'&&['message','reasoning','function_call','custom_tool_call','function_call_output','custom_tool_call_output'].includes(p?.type)) ||
        (e.type==='event_msg'&&['task_complete','task_started','turn_aborted','error','item_started','item_completed','user_message','agent_message','agent_reasoning'].includes(p?.type));
    if(activity||calls.has(row.line)){lastActivity=row;activityLines.add(row.line);}
  }
  return {audit,terminals,activityLines,complete:terminals.length>0&&lastActivity===terminals.at(-1)};
}

// Keep every completed parent turn, including those with no final text. A tool
// call or result invalidates earlier prose; its user envelope is not an owner reply.
export function parentTurns(host, rows) {
  const {audit,terminals,activityLines}=turnState(host,rows),turns=[];
  const terminalLines=new Set(terminals.map(r=>r.line));
  let candidate=null,pending=null;
  for (const {value:e,line} of rows) {
    if (e.parent_tool_use_id) continue;
    const turnStart=host==='codex'?e.type==='event_msg'&&e.payload?.type==='task_started':e.type==='system'&&e.subtype==='init';
    const message=audit.proof({kind:'text-message',result:e});
    if (message.status==='confirmed'&&message.role==='user') {
      if (pending) {pending.reply=message.value;pending.replyLine=line;pending=null;}
      candidate=null;
    } else if (message.status==='confirmed'&&message.role==='assistant') {
      pending=null;
      const text=host==='claude'&&candidate?.messageId&&candidate.messageId===message.messageId?candidate.text+'\n'+message.value:message.value;
      candidate={line,text,messageId:message.messageId,phase:message.phase};
    } else if (activityLines.has(line)&&!terminalLines.has(line)) {
      candidate=null;
      // A new native turn can precede replay of the answer to the completed
      // offer. Session activity is not a replacement for that shown question.
      if(!turnStart)pending=null;
    }
    if (terminalLines.has(line)) {
      if (candidate && (host==='claude'||candidate.phase==='final_answer')) {
        pending={...candidate,question:candidate.text.trim().split('\n').at(-1),terminalLine:line};
      }else pending={line,text:'',question:'',terminalLine:line};
      turns.push(pending);
      candidate=null;
    }
  }
  return turns;
}

// Existing native turn boundaries also bind the terminal used for early stop.
export function codexTerminals(rows) {
  return turnState('codex',rows).terminals;
}

export function completedTrace(host, rows, options) {
  if(options?.stdout){
    const audit=auditRows(host,rows,options);
    return audit.proof({kind:'terminal',result:rows.at(-1)?.value}).status==='confirmed';
  }
  return turnState(host,rows,options).complete;
}
