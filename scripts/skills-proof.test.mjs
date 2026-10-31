import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { nativeProof } from './skills-proof.mjs';
const read=(host,name)=>JSON.parse(fs.readFileSync(`evals/scenarios/probe/samples/${host}/${name}.json`));
// Recorded payloads, synthetic linkage/envelopes and command contents. Every
// negative below is a synthetic perturbation, not an observed host refusal.
function control(host,kind,shape='function'){
 const id='test-call',proof={tool:'mcp__monotest__get_workspace',path:['name'],equals:'Test Space'};
 if(host==='codex'){
  const window=read(host,'trace-control-v0.41.0-async-order').items;
  const call={type:'response_item',payload:kind==='answer'||kind==='window'?{...window[0],call_id:id}:{type:`${shape}_call`.replace('custom_call','custom_tool_call'),name:kind==='command'?'exec_command':proof.tool,call_id:id,[shape==='function'?'arguments':'input']:'{}'}};
  const output=kind==='window'?window[1].output:JSON.stringify(kind==='workspace'?{name:'Test Space'}:{exit_code:0,output:'/scratch'});
  const result={type:'response_item',payload:kind==='answer'?{type:'message',role:'user',content:[{type:'input_text',text:'exact sent answer'}]}:{type:shape==='function'?'function_call_output':'custom_tool_call_output',call_id:id,output}};
  return {host,kind,call,result,proof,prompt:'exact sent answer',callId:id};
 }
 const sample=read('claude','recommended'),input=sample.request.request.input;
 const call={type:'assistant',message:{content:[{type:'tool_use',id,name:kind==='workspace'?proof.tool:kind==='command'?'Bash':'AskUserQuestion',input}]}};
 const result=kind==='window'?{...sample.request,request_id:'permission'}:{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:kind==='workspace'?'{"name":"Test Space"}':kind==='command'?'/scratch':sample.toolResult.content}]}};
 return {host,kind,call,result,proof,reply:sample.response,callId:id};
}
function layerPaths(r){
 if(r.host==='codex')return [[],['payload'],...(r.kind==='answer'?[['payload','content'],['payload','content',0]]:[])];
 return [[],...(r.kind==='window'?[['request']]:[['message'],['message','content'],['message','content',0]])];
}
test('every native proof consumer uses the same closed negative table beside its positive control',()=>{
 for(const host of ['claude','codex'])for(const kind of ['workspace','command','answer','window'])for(const shape of host==='codex'&&['workspace','command'].includes(kind)?['function','custom']:['function']){
  const original=control(host,kind,shape),label=`${host}/${kind}/${shape}`;
  assert.equal(nativeProof(original).status,'confirmed',label);
  assert.equal(nativeProof({...original,result:null}).status,'unverified',`${label}: missing`);
  const unknown=structuredClone(original);unknown.result.type='unknown';assert.equal(nativeProof(unknown).status,'unverified',`${label}: unknown`);
  const unlinked=structuredClone(original);
  if(host==='codex')unlinked.call.payload.call_id='another-call';
  else unlinked.call.message.content[0].id='another-call';
  assert.equal(nativeProof(unlinked).status,'unverified',`${label}: unlinked`);
  for(const flag of ['isError','is_error'])for(const path of layerPaths(original)){
   const negative=structuredClone(original);let layer=negative.result;for(const key of path)layer=layer[key];layer[flag]=true;
   assert.equal(nativeProof(negative).status,'unverified',`${label}: synthetic ${flag} at ${path}`);
  }
  if(host==='codex'&&kind!=='answer')for(const flag of ['isError','is_error'])for(const wrap of [v=>v,v=>({structuredContent:v}),v=>({content:[{type:'input_text',text:JSON.stringify(v)}]})]){
   const negative=structuredClone(original),body=JSON.parse(negative.result.payload.output);body[flag]=true;negative.result.payload.output=JSON.stringify(wrap(body));
   assert.equal(nativeProof(negative).status,'unverified',`${label}: synthetic nested ${flag}`);
  }
 }
});
