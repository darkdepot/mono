import { isDeepStrictEqual } from 'node:util';
import { nativeToolName } from './skills-boundary.mjs';

// Native evidence is trusted only here. Callers retain the full host envelope.
// Unknown forms stay unverified; this is no parser or hostile-source boundary.
const absent = () => { throw new Error('missing native proof'); };
function guarded(value) {
  if (value?.isError || value?.is_error) absent();
  return value;
}
function at(value, keys) {
  for (const key of keys) {
    guarded(value);
    if (value == null || !Object.hasOwn(Object(value), key)) absent();
    value = value[key];
  }
  if (value === undefined) absent();
  return guarded(value);
}
export function unwrap(value) {
  guarded(value);
  if (typeof value === 'string') {
    try { return unwrap(JSON.parse(value)); } catch (error) {
      if (error instanceof SyntaxError) return value;
      throw error;
    }
  }
  if (value && typeof value==='object' && (typeof value.id==='string'||typeof value.uuid==='string')) return value;
  if (typeof value?.content === 'string') return unwrap(at(value, ['content']));
  if (value?.structuredContent) return unwrap(at(value, ['structuredContent']));
  if (Array.isArray(value?.content) && value.content.length === 1) return unwrap(at(value, ['content']));
  if (Array.isArray(value) && value.length === 1 && ['text','input_text'].includes(value[0]?.type)) return unwrap(at(value, [0]));
  if (['text','input_text'].includes(value?.type) && typeof value.text === 'string') return unwrap(at(value, ['text']));
  return value;
}
function native(value) {
  guarded(value);
  return value?.type === 'response_item' ? at(value, ['payload']) : value;
}
function claudeBlock(event, type, id, answer = false) {
  if (!['assistant','user'].includes(event?.type) || event.parent_tool_use_id) absent();
  const blocks = at(event, ['message','content']);
  if (!Array.isArray(blocks)) absent();
  const matches = blocks.filter(b => b.type === type && (type === 'tool_use' ? b.id : b.tool_use_id) === id);
  if (matches.length !== 1) absent();
  return answer ? matches[0] : guarded(matches[0]);
}
export function nativeProof({host, kind, call, result, proof, reply, prompt, callId}) {
  try {
    let value,raw;
    if (!['claude','codex'].includes(host)) absent();
    guarded(call); guarded(result);
    if (kind === 'text-message') {
      const r=native(result);
      if (host==='claude' && (result?.parent_tool_use_id || !['assistant','user'].includes(result?.type))) absent();
      if (host==='codex' && (r?.type!=='message' || !['assistant','user'].includes(r.role))) absent();
      const role=host==='claude'?result.type:r.role;
      const content=host==='claude'?at(result,['message','content']):at(r,['content']);
      if (typeof content==='string' && host==='claude' && role==='user') return {status:'confirmed',value:content,role};
      const type=host==='claude'?'text':role==='user'?'input_text':'output_text';
      if (!Array.isArray(content) || !content.length) absent();
      const blocks=content.map((_,i)=>at(content,[i]));
      if(blocks.some(b=>b.type!==type&&!(host==='claude'&&role==='assistant'&&['thinking','redacted_thinking'].includes(b.type))))absent();
      const texts=blocks.filter(b=>b.type===type).map(b=>at(b,['text']));
      if(!texts.length||texts.some(text=>typeof text!=='string'))absent();
      return {status:'confirmed',value:texts.join('\n'),role,phase:r.phase,messageId:result.message?.id};
    }
    if (kind === 'persona') {
      if(host==='codex'){
        if(result?.type!=='item.completed'||at(result,['item']).type!=='agent_message'||typeof at(result,['item','text'])!=='string') absent();
        return {status:'confirmed',value:at(result,['item','text'])};
      }
      if(result?.type!=='assistant'||result.parent_tool_use_id) absent();
      const blocks=at(result,['message','content']);
      if(!Array.isArray(blocks)) absent();
      const texts=blocks.map((block,i)=>at(blocks,[i])).filter(b=>b.type==='text').map(b=>at(b,['text']));
      if(texts.some(t=>typeof t!=='string')||!texts.length) absent();
      return {status:'confirmed',value:texts.join('\n')};
    }
    if (kind === 'terminal') {
      if (host === 'claude') {
        if (result?.type !== 'result' || result.subtype !== 'success' || result.parent_tool_use_id) absent();
      } else if (result?.type === 'event_msg') {
        if (at(result, ['payload']).type !== 'task_complete') absent();
      } else if (result?.type !== 'turn.completed') absent();
      return {status:'confirmed'};
    }
    if (host === 'codex' && kind === 'record' && call?.type === 'event_msg') {
      const item=at(call,['payload','item']);
      if(call.payload.type!=='item_completed'||item.type!=='McpToolCall'||item.status!=='completed'||typeof item.id!=='string'||item.id!==callId||typeof item.server!=='string'||typeof item.tool!=='string'||!item.arguments||typeof item.arguments!=='object'||Array.isArray(item.arguments)||result!==call)absent();
      value=unwrap(at(item,['result']));
      if(!value||typeof value!=='object')absent();
      return {status:'confirmed',value,raw:item.result};
    }
    if (host === 'codex') {
      const c = native(call), r = native(result);
      const name=nativeToolName(c);
      const outputType = c?.type === 'function_call' ? 'function_call_output' : c?.type === 'custom_tool_call' ? 'custom_tool_call_output' : null;
      if (!outputType || typeof c.call_id !== 'string' || !c.call_id || r?.type !== outputType || r.call_id !== c.call_id) absent();
      const output = at(r, ['output']);
      if(['workspace','record'].includes(kind)&&Array.isArray(output)&&output.length>1){
        guarded(output);
        const parsed=[];
        for(let i=0;i<output.length;i++){
          const block=at(output,[i]);
          if(!['text','input_text'].includes(block?.type)||typeof block.text!=='string')absent();
          try{const raw=JSON.parse(at(block,['text']));parsed.push({raw,value:unwrap(raw)});}catch(error){if(!(error instanceof SyntaxError))throw error;}
        }
        if(parsed.length!==1)absent();({value,raw}=parsed[0]);
      }else{value = unwrap(output);if(kind==='record')raw=typeof output==='string'?JSON.parse(output):output;}
      if (kind === 'command') {
        if (!['exec_command','exec'].includes(name)) absent();
        if (value?.exit_code !== 0 || value.failure || value.signal) absent();
        return {status:'confirmed'};
      }
      if (kind === 'workspace' && ![proof?.tool,'exec'].includes(name)) absent();
    } else if (host === 'claude') {
      const id = callId;
      if (typeof id !== 'string' || !id) absent();
      const c = claudeBlock(call,'tool_use',id);
      const r = claudeBlock(result,'tool_result',id);
      if (kind === 'command') {
        if (c.name !== 'Bash' || typeof at(r,['content']) !== 'string') absent();
        return {status:'confirmed'};
      }
      const content=at(r,['content']);value = unwrap(content);if(kind==='record')raw=typeof content==='string'?JSON.parse(content):content;
    } else absent();
    if (kind === 'record') {
      if (!value || typeof value !== 'object') absent();
      return {status:'confirmed',value,raw};
    }
    if (kind !== 'workspace' || !Array.isArray(proof?.path)) absent();
    const leaf = at(value,proof.path);
    return {status:leaf === proof.equals ? 'confirmed':'mismatch'};
  } catch { return {status:'unverified'}; }
}
