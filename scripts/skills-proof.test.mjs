import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { auditRows } from './skills-audit.mjs';
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

// The gate's positive corpus: every repository probe file is classified here.
// Cut payloads keep their recorded data. Missing call/envelope IDs are restored
// as synthetic test metadata, never claimed as observed execution evidence.
test('all recorded real trace and sample forms preserve native success through the gate',async t=>{
 const directory='evals/scenarios/probe/samples',files=fs.readdirSync(directory,{recursive:true}).filter(f=>f.endsWith('.json')).sort();
 assert.equal(files.length,18,'classify new corpus files explicitly');
 const windowCall=(id,input)=>({type:'assistant',message:{content:[{type:'tool_use',id,name:'AskUserQuestion',input}]}});
 const wrapResult=block=>({type:'user',message:{content:[block]}});
 for(const file of files)await t.test(file,()=>{
  const sample=JSON.parse(fs.readFileSync(`${directory}/${file}`)),host=file.split('/')[0];let checked=0;
  const check=(request,expected='confirmed')=>{
   // Restore omitted native call metadata only for cut payload adapters.
   const c=request.call&&structuredClone(request.call);
   if(host==='codex'&&c?.name==='exec'&&c.input===undefined)c.input='text(await tools.mcp__monotest__get_workspace({}));';
   if(host==='codex'&&c?.name==='request_user_input_async'&&c.arguments===undefined)c.arguments='{}';
   const events=[c,request.result].filter(Boolean).map(value=>host==='codex'&&value.type!=='event_msg'?{type:'response_item',payload:value}:value);
   const audit=auditRows(host,events.map((value,i)=>({value,line:i+1})));
   assert.equal(audit.proof({...request,call:c}).status,expected,`${file}: ${request.kind}`);checked++;
  };
  if(host==='claude'&&sample.events){
   const calls=new Map();
   for(const {line,event:e} of sample.events){
    for(const block of e.message?.content??[])if(block.type==='tool_use')calls.set(block.id,{event:e,block});
    if(e.type==='control_request'&&e.request.tool_name==='AskUserQuestion'){
     const id=e.request.tool_use_id??[...calls.keys()].at(-1);
     check({kind:'window',call:calls.get(id)?.event,result:e,callId:id});
    }
    for(const block of e.message?.content??[])if(block.type==='tool_result'){
     const id=block.tool_use_id,call=calls.get(id);
     if(call?.block.name==='AskUserQuestion'){
      // The cut records the answered input; reconstruct only its sent envelope.
      assert.ok(e.tool_use_result?.answers,`line ${line}: captured answers required`);
      check({kind:'answer',call:call.event,result:e,callId:id,reply:{response:{response:{behavior:'allow',updatedInput:e.tool_use_result}}}});
     }else{
      // line137 starts after the Bash call; its stdout receipt is retained.
      const nativeCall=call?.event??{type:'assistant',message:{content:[{type:'tool_use',id,name:'Bash'}]}};
      check({kind:'command',call:nativeCall,result:e,callId:id});
     }
    }
    if(e.type==='result')check({kind:'terminal',result:e});
   }
   if(file.includes('trace-turn-boundary')){
    // Explicitly synthetic graft, no permission result in this cut.
    const call=sample.events.find(r=>r.line===294).event,id=call.message.content[0].id;
    check({kind:'window',call,callId:id},'unverified');
   }
  }else if(host==='claude'&&sample.request){
   const id=sample.toolResult.tool_use_id,input=sample.request.request.input;
   const call=windowCall(id,input),request={...sample.request,request_id:'synthetic-cut-request'};
   check({kind:'window',call,result:request,callId:id});
   check({kind:'answer',call,result:wrapResult(sample.toolResult),callId:id,reply:sample.response});
  }else if(host==='codex'&&sample.call){
   const id='<call-id>',call={type:'function_call',name:sample.call.name,arguments:JSON.stringify(sample.call.arguments),call_id:id};
   check({kind:'window',call,result:{type:'function_call_output',call_id:id,output:sample.callOutput}});
   check({kind:'answer',call,result:{type:'message',role:'user',content:sample.answerAsUserMessage},callId:id,prompt:sample.answerAsUserMessage[0].text});
  }else if(host==='codex'&&sample.items){
   const [c,r]=sample.items,id='synthetic-cut-call';
   check({kind:'window',call:{...c,call_id:id},result:{...r,call_id:id}});
  }else if(host==='codex'&&sample.output){
   const id='synthetic-cut-read';
   check({kind:'workspace',call:{type:'custom_tool_call',name:'exec',call_id:id},result:{type:'custom_tool_call_output',call_id:id,output:sample.output},proof:{path:['result','value','content',0,'text'],equals:JSON.stringify({id:'workspace-test',name:'Test Space',url:'https://example.test/workspace'})}});
  }else if(host==='codex'&&sample.form){
   const id='<call-id>';
   check({kind:'answer',call:{type:'function_call',name:'request_user_input_async',call_id:id},result:{type:'message',role:'user',content:[{type:'input_text',text:sample.form}]},callId:id,prompt:sample.form});
  }else assert.fail(`unclassified recorded corpus file: ${file}`);
  assert.ok(checked>0,`${file}: no gate checks`);
 });
});
test('successful native Bash stdout stays data, including JSON and error-looking JSON',()=>{
 const request=control('claude','command');
 for(const stdout of ['{"ok":true}','[1,2]','true','null','0','"text"','{"isError":true}','{"is_error":true}','']){
  const r=structuredClone(request);r.result.message.content[0].content=stdout;
  assert.equal(nativeProof(r).status,'confirmed',stdout);
 }
});
test('Claude window input equality ignores object key order but preserves array order',()=>{
 const request=control('claude','window');
 const q=request.call.message.content[0].input.questions[0];
 request.result.request.input={questions:[{multiSelect:q.multiSelect,options:q.options,header:q.header,question:q.question}]};
 assert.equal(nativeProof(request).status,'confirmed');
 request.result.request.input.questions[0].options=[...q.options].reverse();
 assert.equal(nativeProof(request).status,'unverified');
});

test('Claude denial receipt is delivered only for matching sent deny and native linkage',()=>{
 const sample=read('claude','refuse'),id='deny',call={type:'assistant',message:{content:[{type:'tool_use',id,name:'AskUserQuestion'}]}},result={type:'user',message:{content:[{...sample.toolResult,tool_use_id:id}]}};
 const request={host:'claude',kind:'answer',call,result,callId:id,reply:sample.response};
 assert.equal(nativeProof(request).status,'confirmed');
 for(const change of [r=>r.reply.response.response.message='different',r=>r.reply.response.response.behavior='allow',r=>r.result.message.content[0].is_error=false,r=>r.result.message.content[0].isError=true,r=>r.result.message.content[0].tool_use_id='unlinked',r=>r.result.is_error=true]){
  const bad=structuredClone(request);change(bad);assert.equal(nativeProof(bad).status,'unverified');
 }
 assert.equal(nativeProof({...request,kind:'workspace',proof:{tool:'AskUserQuestion',path:[],equals:'x'}}).status,'unverified');
});
