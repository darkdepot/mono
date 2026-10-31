import { codexToolCalls, MissingEvidence } from './skills-boundary.mjs';
import { nativeProof } from './skills-proof.mjs';

// One closed coverage policy for stream readers, rollout readers and helpers.
// The transport may store unknown events; no behavioral reader may trust them.
export function auditRows(host, rows, {stdout = false} = {}) {
  const calls = [];
  const reject = (line, reason) => { throw new MissingEvidence(`line ${line}: ${reason}`); };
  if (!['claude','codex'].includes(host)) throw new MissingEvidence('unknown trace host');
  for (const {value:e,line} of rows) {
    if (!e || typeof e.type !== 'string') reject(line,'invalid native event');
    if (host === 'codex') {
      if (stdout) {
        if (!['thread.started','turn.started','turn.completed','turn.failed','error','item.started','item.completed'].includes(e.type)) reject(line,'unknown Codex stdout event');
        if (e.type.startsWith('item.') && !['agent_message','reasoning'].includes(e.item?.type)) reject(line,'persona tool or unknown stdout item');
      } else if (e.type === 'response_item') {
        try {
          for (const call of codexToolCalls(e.payload)) calls.push({...call,event:e,line});
          if(e.payload?.type==='message'&&(!Array.isArray(e.payload.content)||e.payload.content.some(b=>!['input_text','output_text'].includes(b?.type)||typeof b.text!=='string'))) reject(line,'unknown Codex message content');
        }
        catch (error) { reject(line,error.message); }
      } else if (!['event_msg','session_meta','turn_context'].includes(e.type)) reject(line,'unknown Codex rollout event');
      else if(e.type==='event_msg'&&!['task_started','task_complete','turn_aborted','error','token_count','user_message','agent_message','agent_reasoning'].includes(e.payload?.type)) reject(line,'unknown Codex event message');
    } else {
      if (!['assistant','user','system','result','control_request','control_response'].includes(e.type)) reject(line,'unknown Claude event');
      if(e.type==='system'&&e.subtype!==undefined&&!['init','task_summary','thinking_tokens','post_turn_summary'].includes(e.subtype)) reject(line,'unknown Claude system subtype');
      if (e.type === 'control_request' && e.request?.subtype !== 'can_use_tool') reject(line,'unknown Claude control request');
      if (['assistant','user'].includes(e.type)) {
        const content=e.message?.content;
        if (e.type==='user' && typeof content==='string') continue;
        if (!Array.isArray(content)) reject(line,'invalid Claude content');
        for (const block of content) {
          if (!block || !['text','thinking','tool_use','tool_result'].includes(block.type)) reject(line,'unknown Claude content block');
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
  const windowProof=(call,line,callId,{phase='complete'}={})=>{
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
      answer=()=>proof({kind:'answer',call,result:receipt?.value,callId});
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
  return {calls,proof,windowProof};
}
