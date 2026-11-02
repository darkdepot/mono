import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { nativeData, resultFor } from './skills-record-data.mjs';
import { MissingEvidence, isWrite } from './skills-boundary.mjs';

const idOf=row=>row?.uuid??row?.id;
const missing=reason=>{throw new MissingEvidence(reason);};
const safeId=id=>{if(typeof id!=='string'||!/^[A-Za-z0-9-]+$/.test(id))missing('invalid dump record id');return id;};
// The script owns both the closed read list and every saved filename. The host
// only transports one exact MCP request per turn, never writes or chooses files.
export class RecordDump {
 constructor({dumpDir,project,projectName}){
  this.root=dumpDir;this.project=project;this.files=[];this.queue=[];this.cursors=new Map();fs.mkdirSync(dumpDir);
  if(project)this.queue.push({tool:'get_project',input:{query:project.id??project.uuid,includeResources:true},file:'project.json'});
  else {if(!projectName)missing('run name required for dump');this.page('projects','projects','list_projects',{query:projectName,includeArchived:true});}
 }
 page(prefix,key,tool,input,n=1,cursor){
  const request=n===1?{}:{cursor};
  this.queue.push({tool,input:{...input,...request},file:`${prefix}-${n}.json`,request,prefix,key,n,scope:input});
 }
 get done(){return this.queue.length===0;}
 prompt(){const job=this.queue[0];return `Только чтение monotest. Выполни ровно один MCP ${job.tool} с аргументами ${JSON.stringify(job.input)}. Через exec строго: const r = await tools.mcp__monotest__${job.tool}(${JSON.stringify(job.input)}); text(r); Никаких других вызовов, команд, записи файлов или этапов. Сырой ответ сохранит драйвер из нативного следа. Заверши ход после результата.`;}
 consume(host,rows){
  const job=this.queue[0],data=nativeData(host,rows);
  if(data.calls.some(c=>isWrite(c.name)||!c.name.startsWith('mcp__monotest__')))throw new Error('record dump permits monotest reads only');
  if(data.calls.length!==1)missing('dump needs exactly one native MCP read for its fixed request');
  let record;
  try{record=resultFor(host,data.calls[0],rows);}
  catch(error){if(error instanceof MissingEvidence)error.hostFailure=true;throw error;}
  if(record.name!==`mcp__monotest__${job.tool}`||!isDeepStrictEqual(record.input,job.input))throw new Error('dump read differs from fixed request');
  const value=record.value;
  if(job.key){
   if(!Array.isArray(value[job.key])||typeof value.hasNextPage!=='boolean'||(value.hasNextPage?typeof value.cursor!=='string'||!value.cursor||!value[job.key].length:Object.hasOwn(value,'cursor')))missing(`incomplete ${job.prefix} native page`);
   if(value.hasNextPage){
    const seen=this.cursors.get(job.prefix)??new Set();if(seen.has(value.cursor))missing('dump cursor loop');seen.add(value.cursor);this.cursors.set(job.prefix,seen);
   }
  }
  if(record.raw===undefined)missing('raw native MCP response missing');
  const target=path.join(this.root,job.file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(record.raw)+'\n',{flag:'wx'});
  if(job.request)fs.writeFileSync(target.replace(/\.json$/,'.request.json'),JSON.stringify(job.request)+'\n',{flag:'wx'});
  this.files.push(job.file);this.queue.shift();
  if(job.tool==='get_project'){
   const id=this.project.id??this.project.uuid;
   if(value.uuid!==id||value.name!==this.project.name||!value.url?.startsWith('https://linear.app/monotest/'))throw new Error('dump project identity mismatch');
   this.page('comments','comments','list_comments',{projectId:id});this.page('documents','documents','list_documents',{projectId:id,includeArchived:true});this.page('issues','issues','list_issues',{project:id,includeArchived:true});
  }
  if(job.key==='documents')for(const ref of value.documents){const id=safeId(idOf(ref));this.queue.push({tool:'get_document',input:{id},file:`documents/${id}.json`});}
  if(job.key==='issues')for(const ref of value.issues){const id=safeId(idOf(ref));this.queue.push({tool:'get_issue',input:{id},file:`issues/${id}/issue.json`});this.page(`issues/${id}/comments`,'comments','list_comments',{issueId:id});}
  if(job.key&&value.hasNextPage){
   this.page(job.prefix,job.key,job.tool,job.scope,job.n+1,value.cursor);this.queue.unshift(this.queue.pop());
  }
 }
}
