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
  return {calls,proof:request=>nativeProof({...request,host})};
}
