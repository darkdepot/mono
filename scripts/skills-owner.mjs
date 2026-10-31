// Decisive choices come only from the scenario. Persona calls never enter here.
export function windowReply(host, input, policy, id) {
  if (!['claude', 'codex'].includes(host) || !id || !input?.questions?.length) throw new Error('invalid window');
  const modes = ['recommended', 'label', 'correction', 'empty', 'refuse', 'discuss'];
  if (!modes.includes(policy?.mode)) throw new Error('scenario window policy required');
  if (['correction', 'refuse'].includes(policy.mode) && typeof policy.text !== 'string')
    throw new Error('scenario reply text required');
  const choose = q => {
    const labels = (q.options ?? []).map(o => typeof o === 'string' ? o : o.label);
    if (policy.mode === 'empty') return '';
    if (policy.mode === 'correction') return policy.text;
    const target = policy.mode === 'discuss' ? 'Ещё обсудить' : policy.label;
    const answer = policy.mode === 'recommended'
      ? labels.find(l => l.endsWith(' (Recommended)'))
      : labels.find(l => l.replace(/ \(Recommended\)$/, '') === target);
    if (!answer) throw new Error(`scenario choice unavailable: ${policy.mode}`);
    return answer;
  };
  if (host === 'claude') {
    const response = policy.mode === 'refuse' ? { behavior: 'deny', message: policy.text }
      : { behavior: 'allow', updatedInput: { ...input, answers: Object.fromEntries(input.questions.map(q => [q.question, choose(q)])) } };
    return { type: 'control_response', response: { subtype: 'success', request_id: id, response } };
  }
  if (policy.mode === 'refuse') return policy.text;
  const items = input.questions.map((q, i) => ({ questionItemId: JSON.stringify(['request_user_input_async', id, i]),
    question: q.title, answer: choose(q) }));
  return `<send_user_message_question_reply>\n${JSON.stringify(items)}\n</send_user_message_question_reply>\n`;
}

export function personaPrompt(brief, lastMessage) {
  if (typeof brief !== 'string' || !brief.trim() || !lastMessage?.trim()) throw new Error('persona brief and stage message required');
  return `Ответь как владелец на последний свободный вопрос этапа. Не выбирай варианты окон и не утверждай документы. Используй только сведения брифа; неизвестное назови неизвестным. Ответь кратко обычным текстом.\n\nБриф:\n${brief}\n\nПоследнее сообщение этапа:\n${lastMessage}`;
}

// Receipt forms are from the six captured Claude replies. Unknown forms are
// missing evidence, not successful delivery inferred from a matching tool id.
export function claudeReplyDelivered(block, reply) {
  const sent = reply?.response?.response;
  if (block.type !== 'tool_result' || typeof block.content !== 'string') return false;
  if (sent?.behavior === 'deny') {
    return block.is_error === true && Boolean(sent.message?.trim()) && block.content === sent.message;
  }
  if (sent?.behavior !== 'allow' || (block.is_error !== undefined && block.is_error !== false)) return false;
  const answers = Object.entries(sent.updatedInput?.answers ?? {});
  if (answers.length !== 1) return false;
  const [question, answer] = answers[0];
  if (typeof answer !== 'string') return false;
  if (answer === '') return block.content === 'The user did not answer the questions.';
  const options = sent.updatedInput.questions.find(q => q.question === question)?.options;
  if (!Array.isArray(options)) return false;
  const pair = `"${question}"="${answer}"`;
  const expected = options.some(o => o.label === answer)
    ? `Your questions have been answered: ${pair}. You can now continue with these answers in mind.`
    : `The user answered: ${pair}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`;
  return block.content === expected;
}
