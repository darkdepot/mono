import { isDeepStrictEqual } from 'node:util';

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
function unwrap(value) {
  guarded(value);
  if (typeof value === 'string') {
    try { return unwrap(JSON.parse(value)); } catch (error) {
      if (error instanceof SyntaxError) return value;
      throw error;
    }
  }
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
function claudeBlock(event, type, id) {
  if (!['assistant','user'].includes(event?.type) || event.parent_tool_use_id) absent();
  const blocks = at(event, ['message','content']);
  if (!Array.isArray(blocks)) absent();
  const matches = blocks.filter(b => b.type === type && (type === 'tool_use' ? b.id : b.tool_use_id) === id);
  if (matches.length !== 1) absent();
  return guarded(matches[0]);
}
function claudeAnswer(sent) {
  // A captured deny has is_error:true; it cannot establish success.
  if (sent?.behavior !== 'allow') absent();
  const answers = Object.entries(sent.updatedInput?.answers ?? {});
  if (answers.length !== 1) absent();
  const [question, answer] = answers[0];
  if (typeof answer !== 'string') absent();
  if (answer === '') return 'The user did not answer the questions.';
  const options = sent.updatedInput.questions.find(q => q.question === question)?.options;
  if (!Array.isArray(options)) absent();
  const pair = `"${question}"="${answer}"`;
  return options.some(o => o.label === answer)
    ? `Your questions have been answered: ${pair}. You can now continue with these answers in mind.`
    : `The user answered: ${pair}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`;
}

export function nativeProof({host, kind, call, result, proof, reply, prompt, callId}) {
  try {
    let value;
    if (!['claude','codex'].includes(host)) absent();
    guarded(call); guarded(result);
    if (kind === 'terminal') {
      if (host === 'claude') {
        if (result?.type !== 'result' || result.subtype !== 'success' || result.parent_tool_use_id) absent();
      } else if (result?.type === 'event_msg') {
        if (at(result, ['payload']).type !== 'task_complete') absent();
      } else if (result?.type !== 'turn.completed') absent();
      return {status:'confirmed'};
    }
    if (host === 'codex') {
      const c = native(call), r = native(result);
      if (kind === 'answer') {
        // The driver binds the newly resumed user message to its exact sent prompt.
        if (!callId || typeof prompt !== 'string' || c?.type !== 'function_call' || c.name !== 'request_user_input_async' || c.call_id !== callId || r?.type !== 'message' || r.role !== 'user') absent();
        const content = at(r, ['content']);
        if (!Array.isArray(content) || content.length !== 1 || at(content,[0]).type !== 'input_text' || at(content,[0,'text']) !== prompt) absent();
        return {status:'confirmed'};
      }
      const outputType = c?.type === 'function_call' ? 'function_call_output' : c?.type === 'custom_tool_call' ? 'custom_tool_call_output' : null;
      if (!outputType || typeof c.call_id !== 'string' || !c.call_id || r?.type !== outputType || r.call_id !== c.call_id) absent();
      const output = at(r, ['output']);
      if (kind === 'window') {
        if (c.type !== 'function_call' || c.name !== 'request_user_input_async') absent();
        if (typeof output !== 'string') absent();
        value = guarded(JSON.parse(output));
        const args = JSON.parse(at(c,['arguments']));
        if (!Array.isArray(args?.questions) || !args.questions.length || !value || value.accepted !== true || Object.keys(value).length !== 1) absent();
        return {status:'confirmed',value:args};
      }
      value = unwrap(output);
      if (kind === 'command') {
        if (!['exec_command','exec'].includes(c.name)) absent();
        if (value?.exit_code !== 0 || value.failure || value.signal) absent();
        return {status:'confirmed'};
      }
      if (kind === 'workspace' && ![proof?.tool,'exec'].includes(c.name)) absent();
    } else if (host === 'claude') {
      const id = callId;
      if (typeof id !== 'string' || !id) absent();
      const c = claudeBlock(call,'tool_use',id);
      if (kind === 'window') {
        const r = at(result,['request']);
        if ((r.tool_use_id !== undefined && r.tool_use_id !== id) || c.name !== 'AskUserQuestion' || result.type !== 'control_request' || !result.request_id || r.subtype !== 'can_use_tool' || r.tool_name !== c.name || !isDeepStrictEqual(r.input,c.input)) absent();
        return {status:'confirmed'};
      }
      const r = claudeBlock(result,'tool_result',id);
      if (kind === 'workspace' && c.name !== proof?.tool) absent();
      if (kind === 'answer') {
        if (c.name !== 'AskUserQuestion' || at(r,['content']) !== claudeAnswer(reply?.response?.response)) absent();
        return {status:'confirmed'};
      }
      if (kind === 'command') {
        if (c.name !== 'Bash' || typeof at(r,['content']) !== 'string') absent();
        return {status:'confirmed'};
      }
      value = unwrap(at(r,['content']));
    } else absent();
    if (kind !== 'workspace' || !Array.isArray(proof?.path)) absent();
    const leaf = at(value,proof.path);
    return {status:leaf === proof.equals ? 'confirmed':'mismatch'};
  } catch { return {status:'unverified'}; }
}
