#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function dialogueMode(version) {
 const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(version?.trim()??'');
 if(!match)throw new Error('tested pack VERSION must be an exact release version');
 const [,major,minor]=match.map(Number);
 return major===0&&minor<43?'windows':'text';
}
export function testedVersion(request, fallbackRoot) {
 const version=fs.readFileSync(path.join(request.packRoot??fallbackRoot,'VERSION'),'utf8').trim();
 if(request.testedVersion!==undefined&&request.packRoot&&request.testedVersion!==version)throw new Error('testedVersion differs from tested pack VERSION');
 return request.packRoot?version:request.testedVersion??version;
}

export const stageDriverTool='mcp__stage_driver__start_stage';
export const permittedStages=reply=>reply.driverStart===null?[]:Array.isArray(reply.driverStart)?reply.driverStart:[reply.driverStart];
export function startReceipt(input, allowed) {
 if(!allowed.includes(input?.stage)||typeof input?.projectId!=='string'||!input.projectId.trim())throw new Error('stage start has no scenario permission');
 return {driverIntercepted:true,stage:input.stage,projectId:input.projectId};
}
// No stage runs inside this tool. The suite owns the later invocation, after
// native reply ordering, records and the mandatory rubric have passed.
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const allowed=JSON.parse(process.argv[2]);
 const lines=readline.createInterface({input:process.stdin});
 lines.on('line',line=>{
  let request;try{request=JSON.parse(line);if(request.id===undefined)return;
   let result;
   if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'mono-stage-driver',version:'1'}};
   else if(request.method==='ping')result={};
   else if(request.method==='tools/list')result={tools:[{name:'start_stage',description:'Intercept a next-stage invocation for the scenario driver. Call only after the owner reply authorizes it. Does not run the next stage.',inputSchema:{type:'object',properties:{stage:{type:'string',enum:allowed},projectId:{type:'string'}},required:['stage','projectId'],additionalProperties:false}}]};
   else if(request.method==='tools/call'&&request.params.name==='start_stage')result={content:[{type:'text',text:JSON.stringify(startReceipt(request.params.arguments,allowed))}]};
   else throw new Error('unsupported stage-driver request');
   process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
  }catch(error){if(request?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32602,message:error.message}})+'\n');}
 });
}
