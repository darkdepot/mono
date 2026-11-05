import { permittedStages } from './skills-stage-driver.mjs';
export const targetReplyCount = replies => replies.filter(r=>r.target!==false).length;
export const anchored = r => typeof r.question==='object' && r.question!==null;
const strings = values => Array.isArray(values) && values.every(s=>typeof s==='string'&&s.trim());
function anchorPolicy(policy) {
  return policy && Array.isArray(policy.anchors) && policy.anchors.length && policy.anchors.every(s=>typeof s==='string'?s.trim():strings(s)&&s.length) && strings(policy.forbidden??[]) && strings(policy.forbiddenExact??[]);
}
export function checkAnchors(policy, value, label) {
  if (!policy.anchors.every(group=>(Array.isArray(group)?group:[group]).some(s=>value.toLocaleLowerCase().includes(s.toLocaleLowerCase())))) throw new Error(`${label} lacks scenario anchors`);
  if ((policy.forbidden??[]).some(s=>value.toLocaleLowerCase().includes(s.toLocaleLowerCase()))) throw new Error(`${label} has forbidden scenario anchor`);
  const lines=value.split('\n').map(line=>line.trim().toLocaleLowerCase());
  if ((policy.forbiddenExact??[]).some(s=>lines.includes(s.trim().toLocaleLowerCase()))) throw new Error(`${label} has forbidden exact scenario line`);
}
export function validateReplies(expected) {
  if (!Array.isArray(expected) || !expected.length) throw new Error('scenario expectedReplies required');
  const ids=new Set();
  for (const r of expected) {
    if (!r || typeof r.id!=='string' || !r.id.trim() || ids.has(r.id) ||
        !['idea','research','discovery','design','tech-evaluation','handoff'].includes(r.stage) ||
        !['approval','transition','clarification'].includes(r.role) ||
        !['agree','correction','question','continuation','unclear','refuse','defer','start'].includes(r.intent) ||
        !Array.isArray(r.summary) || !r.summary.length || r.summary.some(s=>typeof s!=='string'||!s.trim()) ||
        !(anchored(r)?anchorPolicy(r.question):typeof r.question==='string'&&r.question.trim()&&r.question.trim()!=='?') || typeof r.reply!=='string' || !r.reply.trim() ||
        typeof r.asksStart!=='boolean') throw new Error('invalid expectedReplies question, summary or policy');
    ids.add(r.id);
    if (typeof r.outcome?.approval!=='boolean' || typeof r.outcome?.startNext!=='boolean') throw new Error('predetermined reply outcome required');
    const accepts=['agree','correction','defer','start'].includes(r.intent);
    const delegated=r.by==='orchestrator'&&r.stage!=='handoff';
    if (r.outcome.approval !== (accepts && r.role==='approval') ||
        r.outcome.startNext !== (accepts && r.intent!=='defer' && r.role!=='clarification' && !delegated && (r.asksStart||r.intent==='start')) ||
        (r.stage==='research'&&r.role==='approval') || (r.stage==='handoff'&&r.role==='approval')) throw new Error('reply outcome contradicts scenario role or start authority');
    if (r.intent==='correction' && (!r.correction || (anchored(r)
      ? !r.correction.before?.trim() || !anchorPolicy(r.correction) || !strings(r.correction.descriptionAnchors) || !r.correction.descriptionAnchors.length
      : ['description','before','after'].some(k=>typeof r.correction[k]!=='string'||!r.correction[k].trim()) || r.correction.before===r.correction.after))) throw new Error('named correction required');
    if (r.intent!=='correction'&&r.correction!==undefined) throw new Error('correction without correction intent');
    if (r.by!==undefined && !['owner','orchestrator'].includes(r.by)) throw new Error('invalid reply authority');
    if (r.by==='orchestrator' && (typeof r.reason!=='string'||!r.reason.trim()||!r.reply.includes(r.reason))) throw new Error('delegated reply reason required verbatim');
    if (r.framing!==undefined && (!r.framing || Array.isArray(r.framing) || typeof r.framing.before!=='string' || typeof r.framing.after!=='string')) throw new Error('literal scenario framing required');
    if (anchored(r)) {
      const presentations=Array.isArray(r.presentation)?r.presentation:[r.presentation];
      if (!presentations.length||presentations.some(p=>!['inline','document'].includes(p))||r.stage==='idea'&&(presentations.length!==1||presentations[0]!=='inline')) throw new Error('scenario presentation required; Idea is inline');
      if (r.driverStart!==null && (!permittedStages(r).length||permittedStages(r).some(stage=>!['idea','research','discovery','design','tech-evaluation','handoff','delivery'].includes(stage))||delegated)) throw new Error('invalid driver start authority for delegated stage');
      if (r.response!==undefined&&(!anchorPolicy(r.response) || typeof r.response.question!=='boolean')) throw new Error('stage response anchors and question policy required');
    }
  }
  if (expected.at(-1).response===undefined) throw new Error('last expected reply requires a declared stage response');
  for (const r of expected) if(!anchored(r)&&r.response!==undefined && (!Array.isArray(r.response)||!r.response.length||r.response.some(text=>typeof text!=='string'||!text.trim()))) throw new Error('invalid declared stage response');
  return expected;
}
export function textReply(scenario, lastMessage, index) {
  const expected=validateReplies(scenario.expectedReplies)[index];
  if (!expected) throw new Error('unexpected text question without scenario policy');
  if (typeof lastMessage!=='string' || !lastMessage.trimEnd().endsWith('?') || !expected.summary.every(s=>lastMessage.includes(s))) throw new Error('last stage question or summary differs from scenario');
  const question=lastMessage.trimEnd().split('\n').at(-1);
  if (anchored(expected)) {
    if ((question.match(/\?/g)??[]).length!==1) throw new Error('one stage question required');
    checkAnchors(expected.question,question,'question');
  } else if (!question.includes(expected.question)) throw new Error('last stage question differs from scenario');
  return expected.reply;
}
export function correctedVersion(shown, expected, actual) {
  if (!expected.correction) return shown;
  const {before,after}=expected.correction;
  if (!shown.includes(before) || shown.indexOf(before)!==shown.lastIndexOf(before)) throw new Error('named correction must identify one exact shown passage');
  if (anchored(expected)) {
    const at=shown.indexOf(before),prefix=shown.slice(0,at),suffix=shown.slice(at+before.length);
    if (typeof actual!=='string'||!actual.startsWith(prefix)||!actual.endsWith(suffix)||actual.length<prefix.length+suffix.length) throw new Error('change outside named passage');
    const replacement=actual.slice(prefix.length,suffix.length?-suffix.length:undefined);
    if (!replacement.trim()||replacement===before) throw new Error('named correction not applied');
    checkAnchors(expected.correction,replacement,'correction');
    return actual;
  }
  return shown.replace(before,()=>after);
}

export const isOwnerWindow = name => ['AskUserQuestion','request_user_input','request_user_input_async'].includes(name);

export function checkStageResponse(expected, text) {
  if (anchored(expected)) {
    checkAnchors(expected.response,text,'stage response');
    if(expected.correction)checkAnchors({anchors:expected.correction.descriptionAnchors},text,'stage correction response');
    const questions=(text.match(/\?/g)??[]).length;
    if (expected.response.question ? questions!==1||!text.trimEnd().endsWith('?') : questions!==0) throw new Error('stage response question differs from scenario policy');
    return;
  }
  if (!expected.response?.includes(text)) throw new Error('stage response differs from declared scenario policy');
}
