import { createHash } from 'node:crypto';

// Tester judgments are evidence, never an intent recognizer. Expected outcomes
// remain in the immutable scenario; the digest binds judgments to what happened.
export const rubricChecks=['summary','question','response','correction'];
export const rubricDigest=input=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
export function checkRubric(input, review) {
 const digest=rubricDigest(input),base={rubricInput:input,rubricDigest:digest};
 if (!review || review.digest!==digest || typeof review.reviewer!=='string' || !review.reviewer.trim() || !Array.isArray(review.checks) || review.checks.length!==rubricChecks.length || rubricChecks.some((id,i)=>review.checks[i]?.id!==id) || review.checks.some(c=>!['passed','failed','unverified'].includes(c.status)||!c.evidence?.trim()||!c.reason?.trim()))
  return {...base,status:'unverified',reason:'mandatory scenario rubric missing, stale or incomplete'};
 const status=review.checks.some(c=>c.status==='failed')?'failed':review.checks.some(c=>c.status!=='passed')?'unverified':'passed';
 return {...base,status,...(status==='passed'?{}:{reason:'scenario rubric '+status}),review};
}
