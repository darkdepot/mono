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
      : labels.find(l => l === target) ?? labels.find(l => l.replace(/ \(Recommended\)$/, '') === target);
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
