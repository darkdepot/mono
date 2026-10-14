import { createHash } from 'node:crypto';
import { canonical } from './runtime.mjs';
export const sha = value => createHash('sha256').update(canonical(value)).digest('hex');
export const seal = entry => ({...entry,recordDigest:sha(entry)});
export function declineFixture({basis='refutation',priority='P2',dangerous=false}={}) {
  const head='a'.repeat(40),base='b'.repeat(40),route={engine:'codex',model:'policy-model',effort:'high'};
  const finding={title:'Same title',body:'This path allegedly violates the invariant.',priority,confidence:0.9,category:'bug',code_location:{file_path:'scripts/example.mjs',line:7},source_attribution:null};
  const receipt={head,base,route,runId:'run-1',collectionId:`preflight-collect:${head}:1`,recordedAt:'2026-10-14T01:00:00Z',reviewDataset:{version:1,digest:'c'.repeat(64)},verification:{exitCode:0},review:{exitCode:1,status:{schema_version:1,status:'findings',engine:'codex',exit_code:1,report_produced:true,timed_out:false},json:{findings:[finding],overall_correctness:'patch is incorrect',overall_explanation:'Finding remains visible.',overall_confidence:0.9,review_status:'findings'},output:'autoreview target: branch\nengine: codex\nmodel: policy-model\nthinking: high\nautoreview findings: 1\noverall: patch is incorrect (0.9)\n'},loop:{iterations:1,disposition:'failed',residualFindings:[finding]}};
  const digest=sha(receipt),findingDigest=sha(finding);
  const boundary={type:'decision',id:'d-001',findingKey:'boundary',problem:'scope',trigger:'approved outcome',evidence:'owner approval',impact:'remaining behavior checked',origin:'scope-decision',decision:'limit',validity:{head,base,contracts:['remaining invariant'],assumptions:[]},verification:'remaining contract passes',supersedes:null,proposedBy:'orchestrator',recordedAt:'2026-10-14T00:00:00Z',approval:{by:'orchestrator',at:'2026-10-14T00:00:00Z'},boundary:{scope:'Excluded optional behavior',remainingContract:'Required behavior remains verified'}};
  const evidence={command:'node reproduction.mjs',output:'The alleged path is unreachable.'};
  const entry=seal({type:'decline',id:'decline-1',recordedAt:'2026-10-14T01:01:00Z',receipt:{collectionId:receipt.collectionId,runId:receipt.runId,digest},head,datasetVersion:1,finding:{id:`${digest}:0:${findingDigest}`,index:0,digest:findingDigest},basis:basis==='refutation'?{type:basis,evidence,digest:sha(evidence)}:{type:basis,decisionId:boundary.id,digest:sha(boundary),scope:boundary.boundary.scope},dangerous,approvedBy:'orchestrator',approvedAt:'2026-10-14T01:01:00Z'});
  return {receipt,entry,boundary,journal:{issue:'MONO-999',entries:basis==='boundary'?[boundary,entry]:[entry]}};
}
