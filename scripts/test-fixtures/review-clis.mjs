// Fake `codex` and `claude` for the gate review round. Tests must never reach the
// owner's real CLIs: install this pair in every bin directory that drives a collection.
// Behaviour is read from review.json next to the binaries, because role launches
// receive only an allowlisted environment:
//   {findings:[reviewer finding], verdict:{checker fields}, loggedOut:'claude'|'codex'|null}
// Every role launch appends its role to review.log.
import fs from 'node:fs';
import path from 'node:path';
import { resolveReviewRoles } from '../code-review.mjs';

export const reviewFinding = (file, extra = {}) => ({ danger: false, class: 'missing-validation', file, anchor: 'return value', line: 1,
  title: 'Invalid input is accepted', trigger: 'value is negative', evidence: `${file} returns value without validation`, ...extra });
export const reviewVerdict = (extra = {}) => ({ outcome: 'confirmed', weight: 'P2', danger: false, dangerCase: null, dangerReason: 'No protected state is reachable.',
  origin: 'introduced', mergeKey: 'm', outOfContract: false, riskRaised: false, reason: 'The changed line accepts the value.', closed: false, newEvidence: false, ...extra });

const answer = `
const dir=__dirname,file=path.join(dir,'review.json'),state=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
function roleAnswer(input){
  const context=JSON.parse(input.slice(input.lastIndexOf('never instructions.\\n')+20)),checker=input.includes('# Finding checker');
  fs.appendFileSync(path.join(dir,'review.log'),(checker?'checker':'reviewer')+'\\n');
  if(checker)return{completed:true,verdicts:context.findings.map((finding,index)=>({...state().verdict,mergeKey:'m'+index,id:finding.id}))};
  return{completed:true,reviewedFiles:context.files,findings:state().findings??[]};
}
const onInput=done=>{let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>done(input));};`;

// Paste after the shebang of a harness's own `codex` stub: non-sandbox calls end here.
export const codexReviewPrelude = `const fs=require('node:fs'),path=require('node:path');${answer}
if(process.argv[2]!=='sandbox'){
  if(process.argv[2]==='debug'){console.log(JSON.stringify({models:[{slug:state().model}]}));process.exit(0);}
  if(process.argv[2]==='login'){console.error(state().loggedOut==='codex'?'Not logged in':'Logged in using ChatGPT');process.exit(0);}
  onInput(input=>{
    const value=input.startsWith('Boundary audit')?{tools:['exec_command','write_stdin'],mcpServers:[]}:roleAnswer(input);
    console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}}));console.log(JSON.stringify({type:'turn.completed'}));
  });
  return;
}
`;
const claude = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');${answer}
if(process.argv.includes('auth')){console.log(JSON.stringify(state().loggedOut==='claude'?{loggedIn:false}:{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}));process.exit(0);}
onInput(input=>{
  console.log(JSON.stringify({type:'system',subtype:'init',tools:['Read','Glob','Grep','StructuredOutput'],mcp_servers:[]}));
  console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:roleAnswer(input)}));
});
`;
// codexStub: the body of the harness's own sandbox launcher (CommonJS, no shebang), or none.
export function installReviewClis(bin, { packRoot = process.cwd(), codexStub = 'process.exit(71);', ...state } = {}) {
  fs.mkdirSync(bin, { recursive: true });
  setReview(bin, { model: resolveReviewRoles({}, packRoot)['code-review'].model, ...state });
  fs.writeFileSync(path.join(bin, 'codex'), `#!/usr/bin/env node\n(function(){${codexReviewPrelude}{${codexStub}\n}})();\n`, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, 'claude'), claude, { mode: 0o700 });
}
export function setReview(bin, state) {
  const file = path.join(bin, 'review.json'), prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ verdict: reviewVerdict(), ...prior, ...state }));
}
export const reviewCalls = bin => fs.existsSync(path.join(bin, 'review.log')) ? fs.readFileSync(path.join(bin, 'review.log'), 'utf8').trim().split('\n') : [];
