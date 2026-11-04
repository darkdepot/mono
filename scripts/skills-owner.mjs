// Legacy roles are read-only decoders for archived window traces.
// Active scenarios and drivers accept only expectedReplies.
export const roleWindows = expected => expected?.some(w => w.role !== undefined) ?? false;
export function windowRole(questions) {
  const labels=(questions ?? []).flatMap(q=>(q.options ?? []).map(o=>typeof o==='string'?o:o?.label)).filter(l=>typeof l==='string');
  if(labels.some(l=>l.includes('Утвердить')))return 'approval';
  if(labels.some(l=>l.includes('Начать')||l.includes('Передать оркестратору')))return 'transition';
  return null;
}
export const targetReplyCount = replies => replies.filter(r=>r.target!==false).length;
export function validateReplies(expected) {
  if (!Array.isArray(expected) || !expected.length) throw new Error('scenario expectedReplies required');
  const ids=new Set();
  for (const r of expected) {
    if (!r || typeof r.id!=='string' || !r.id.trim() || ids.has(r.id) ||
        !['idea','research','discovery','design','tech-evaluation','handoff'].includes(r.stage) ||
        !['approval','transition','clarification'].includes(r.role) ||
        !['agree','correction','question','continuation','unclear','refuse','defer','start'].includes(r.intent) ||
        !Array.isArray(r.summary) || !r.summary.length || r.summary.some(s=>typeof s!=='string'||!s.trim()) ||
        typeof r.question!=='string' || !r.question.trim() || r.question.trim()==='?' || typeof r.reply!=='string' || !r.reply.trim() ||
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
