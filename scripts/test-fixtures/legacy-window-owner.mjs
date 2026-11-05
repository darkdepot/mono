// Historical window transport fixture from 0.42.0; active scenarios use text only.
export const roleWindows = expected => expected?.some(w => w.role !== undefined) ?? false;
export function windowRole(questions) {
  const labels=(questions ?? []).flatMap(q=>(q.options ?? []).map(o=>typeof o==='string'?o:o?.label)).filter(l=>typeof l==='string');
  if(labels.some(l=>l.includes('Утвердить')))return 'approval';
  if(labels.some(l=>l.includes('Начать')||l.includes('Передать оркестратору')))return 'transition';
  return null;
}
export const targetReplyCount = replies => replies.filter(r=>r.target!==false).length;
export function windowPolicy(scenario, questions, replies) {
  const roles=roleWindows(scenario.expectedWindows),role=roles?windowRole(questions):null;
  if(roles&&!role){
    const free=questions.filter(q=>!q.options?.length);
    return {target:false,role:free.length===questions.length?'free':'choice',policy:{mode:'default'},free,
      policyName:free.length===questions.length?'persona':free.length?'default':'recommended'};
  }
  const index=targetReplyCount(replies),expected=scenario.expectedWindows[index],policy=scenario.windows[index];
  if(!policy||!expected||(roles&&expected.role!==role))throw new Error('unexpected target window or scenario policy missing');
  return {target:true,role:role??'target',policy,policyName:policy.mode,expectedIndex:index};
}

// Decisive choices come only from the scenario; free defaults use persona text.
export function windowReply(host, input, policy, id) {
  if (!['claude', 'codex'].includes(host) || !id || !input?.questions?.length) throw new Error('invalid window');
  const modes = ['recommended', 'label', 'correction', 'empty', 'refuse', 'discuss', 'default'];
  if (!modes.includes(policy?.mode)) throw new Error('scenario window policy required');
  if (['correction', 'refuse'].includes(policy.mode) && typeof policy.text !== 'string')
    throw new Error('scenario reply text required');
  const choose = q => {
    const labels = (q.options ?? []).map(o => typeof o === 'string' ? o : o.label);
    if(policy.mode==='default'&&!labels.length){
      if(typeof policy.text!=='string')throw new Error('persona answer required for free window');
      return policy.text;
    }
    if (policy.mode === 'empty') return '';
    if (policy.mode === 'correction') return policy.text;
    const target = policy.mode === 'discuss' ? 'Ещё обсудить' : policy.label;
    const answer = ['recommended','default'].includes(policy.mode)
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

// Text scenarios are an oracle, not an intent classifier. The fixture author
// fixes both the words and their expected meaning before the stage runs.
export function validateReplies(expected) {
  if (!Array.isArray(expected) || !expected.length) throw new Error('scenario expectedReplies required');
  const ids=new Set();
  for (const r of expected) {
    if (!r || typeof r.id!=='string' || !r.id.trim() || ids.has(r.id) ||
        !['idea','research','discovery','design','tech-evaluation','handoff'].includes(r.stage) ||
        !['approval','transition','clarification'].includes(r.role) ||
        !['agree','correction','question','continuation','unclear','refuse','defer','start'].includes(r.intent) ||
        !Array.isArray(r.summary) || !r.summary.length || r.summary.some(s=>typeof s!=='string'||!s.trim()) ||
        typeof r.question!=='string' || !r.question.trim() || typeof r.reply!=='string' || !r.reply.trim() ||
        typeof r.asksStart!=='boolean') throw new Error('invalid expectedReplies question, summary or policy');
    ids.add(r.id);
    if (typeof r.outcome?.approval!=='boolean' || typeof r.outcome?.startNext!=='boolean') throw new Error('predetermined reply outcome required');
    const accepts=['agree','correction','defer','start'].includes(r.intent);
    if (r.outcome.approval !== (accepts && r.role==='approval') ||
        r.outcome.startNext !== (accepts && r.intent!=='defer' && r.role!=='clarification' && (r.asksStart||r.intent==='start')) ||
        (r.stage==='research'&&r.role==='approval') || (r.stage==='handoff'&&r.role==='approval')) throw new Error('reply outcome contradicts scenario role or start authority');
    if (r.intent==='correction' && (!r.correction || ['description','before','after'].some(k=>typeof r.correction[k]!=='string'||!r.correction[k].trim()) || r.correction.before===r.correction.after)) throw new Error('literal named correction required');
    if (r.intent!=='correction'&&r.correction!==undefined) throw new Error('correction without correction intent');
    if (r.by!==undefined && !['owner','orchestrator'].includes(r.by)) throw new Error('invalid reply authority');
    if (r.by==='orchestrator' && (typeof r.reason!=='string'||!r.reason.trim()||!r.reply.includes(r.reason))) throw new Error('delegated reply reason required verbatim');
    if (r.framing!==undefined && (!r.framing || Array.isArray(r.framing) || typeof r.framing.before!=='string' || typeof r.framing.after!=='string')) throw new Error('literal scenario framing required');
  }
  if (expected.at(-1).response===undefined) throw new Error('last expected reply requires a declared stage response');
  for (const r of expected) if(r.response!==undefined && (!Array.isArray(r.response)||!r.response.length||r.response.some(text=>typeof text!=='string'||!text.trim()))) throw new Error('invalid declared stage response');
  return expected;
}
export function textReply(scenario, lastMessage, index) {
  const expected=validateReplies(scenario.expectedReplies)[index];
  if (!expected) throw new Error('unexpected text question without scenario policy');
  if (typeof lastMessage!=='string' || !lastMessage.trimEnd().endsWith('?') || !lastMessage.trimEnd().split('\n').at(-1).includes(expected.question) || !expected.summary.every(s=>lastMessage.includes(s))) throw new Error('last stage question or summary differs from scenario');
  return expected.reply;
}
export function correctedVersion(shown, expected) {
  if (!expected.correction) return shown;
  const {before,after}=expected.correction;
  if (!shown.includes(before) || shown.indexOf(before)!==shown.lastIndexOf(before)) throw new Error('named correction must identify one exact shown passage');
  return shown.replace(before,()=>after);
}

export const isOwnerWindow = name => ['AskUserQuestion','request_user_input','request_user_input_async'].includes(name);

export function checkStageResponse(expected, text) {
  if (!expected.response?.includes(text)) throw new Error('stage response differs from declared scenario policy');
}
