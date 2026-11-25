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
// A reply without driverStart, or with driverStart null, permits no stage.
export const permittedStages=reply=>reply.driverStart===undefined||reply.driverStart===null?[]:Array.isArray(reply.driverStart)?reply.driverStart:[reply.driverStart];
export function startReceipt(input, allowed) {
 if(!allowed.includes(input?.stage)||typeof input?.projectId!=='string'||!input.projectId.trim())throw new Error(`stage start has no scenario permission; this run permits: ${allowed.join(', ')||'none'}`);
 return {driverIntercepted:true,stage:input.stage,projectId:input.projectId};
}
// The permitted list comes only from this run's launch argument: every host
// invocation, a resumed one included, starts the driver from its own run's MCP
// config, and nothing the stage can write changes a running driver.
// The schema lists only the fixed stage vocabulary, the same in every run: a
// resumed session can keep the schema it loaded in an earlier stage, and a
// per-run list there would be stale.
export const driverStageNames=['idea','research','discovery','design','tech-evaluation','handoff','delivery'];
export function launchPermitted(arg) {
 const value=JSON.parse(arg);
 if(!Array.isArray(value)||value.some(stage=>!driverStageNames.includes(stage)))throw new Error('stage-driver launch permission is not a list of stages');
 return value;
}
export const startStageTool={name:'start_stage',description:'Intercept a next-stage invocation for the scenario driver. Call only after the owner reply authorizes it. The driver checks the stage against the current run permission. Does not run the next stage.',
 inputSchema:{type:'object',properties:{stage:{type:'string',enum:driverStageNames},projectId:{type:'string'}},required:['stage','projectId'],additionalProperties:false}};
// No stage runs inside this tool. The suite owns the later invocation, after
// native reply ordering, records and the mandatory rubric have passed.
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const allowed=launchPermitted(process.argv[2]);
 const lines=readline.createInterface({input:process.stdin});
 lines.on('line',line=>{
  let request;try{request=JSON.parse(line);if(request.id===undefined)return;
   let result;
   if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'mono-stage-driver',version:'1'}};
   else if(request.method==='ping')result={};
   else if(request.method==='tools/list')result={tools:[startStageTool]};
   else if(request.method==='tools/call'&&request.params.name==='start_stage')result={content:[{type:'text',text:JSON.stringify(startReceipt(request.params.arguments,allowed))}]};
   else throw new Error('unsupported stage-driver request');
   process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
  }catch(error){if(request?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32602,message:error.message}})+'\n');}
 });
}
