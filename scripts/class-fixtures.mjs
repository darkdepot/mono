import { declineFixture, sha } from './decline-fixtures.mjs';
import { findingIdentity, decisionDigest } from './decisions.mjs';
export const classSeal=entry=>({...entry,recordDigest:decisionDigest(entry)});
export function classFixture({sameKey=false}={}) {
  const {receipt:original,boundary}=declineFixture();
  const receipts=[1,2].map(n=>({...original,issue:'MONO-999',runId:`run-${n}`,collectionId:`preflight-collect:${original.head}:${n}`,
    recordedAt:`2026-10-14T01:0${n}:00Z`,review:{...original.review,json:{...original.review.json,
      findings:[{...original.review.json.findings[0],body:`Variation ${n}`}]}}}));
  const ids=receipts.map(r=>findingIdentity(r,0).id);
  const entry=classSeal({type:'class',id:'c-001',rule:'Required state is checked',mechanism:'Missing admission check',findingIds:ids,
    supersedes:null,approvedBy:'orchestrator',approvedAt:'2026-10-14T01:03:00Z',recordedAt:'2026-10-14T01:03:00Z'});
  const decision=(outcome='fix-class',extra={})=>classSeal({type:'class-decision',id:'cd-001',receipt:{collectionId:receipts[1].collectionId,
    runId:receipts[1].runId,digest:sha(receipts[1])},classIds:sameKey?[]:[entry.id],findingKeys:sameKey?['same-key']:[],outcome,
    nextStep:'Correct all admissions in the approved unit',checkpoint:'Admission fixtures pass',supersedes:null,
    approvedBy:'orchestrator',approvedAt:'2026-10-14T01:04:00Z',recordedAt:'2026-10-14T01:04:00Z',
    ...(outcome==='limit'?{boundary:{decisionId:boundary.id,digest:sha(boundary)},behaviorChange:'Remove optional unsafe behavior',
      remainingVerification:{command:'node remaining.mjs',output:'Required contract passes'},successor:'https://linear.app/darkdepot/issue/MONO-1000/remaining'}:{}),...extra});
  const keyDecision={...boundary,id:'d-002',findingKey:'same-key',decision:'fix',boundary:undefined,approval:undefined};
  const records=receipts.map(r=>({eventId:`1:helper-invocation:${r.collectionId}`,links:sameKey?[keyDecision.id]:[],progress:'fixed'}));
  const journal={issue:'MONO-999',entries:sameKey?[keyDecision]:[entry]};
  return {receipts,entry,decision,boundary,records,journal};
}
