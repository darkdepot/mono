#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonLines } from './transports/journal.mjs';
import { traceRows } from './skills-probe.mjs';
import { completedTrace, textExchanges, checkEndings, checkTraceSources, worstStatus } from './skills-trace.mjs';
import { auditRows } from './skills-audit.mjs';
import { isWrite, MissingEvidence } from './skills-boundary.mjs';
import { unwrap } from './skills-proof.mjs';
import { issueTeam } from './skills-dump.mjs';
import { runScenario } from './skills-run.mjs';
import { nativeRecords, resultFor, callInput, unsavedResult } from './skills-record-data.mjs';
import { windowRole, windowPolicy, correctedVersion, isOwnerWindow, anchored, checkAnchors } from './skills-owner.mjs';
import { checkRubric, rubricDigest } from './skills-rubric.mjs';
import { stageDriverTool, permittedStages, dialogueMode, testedVersion } from './skills-stage-driver.mjs';
import { latestApproval, latestDesignApproval, approvalBlocks } from './idea-gate.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const rawRead=file=>{try{return unwrap(read(file));}catch(error){missing(error.code==='ENOENT'?`incomplete dump: missing ${path.basename(file)}`:`error MCP dump: ${file}`);}};
const text=value=>typeof value==='string'&&value.trim().length>0;
const ownUrl=url=>typeof url==='string'&&url.startsWith('https://linear.app/monotest/');
const idOf=row=>row?.uuid??row?.id;
const bodyOf=row=>row?.body??row?.content??row?.description;
function recoveredUnsavedWrite(data,call){
 const error=unsavedResult(data.host,call,data.rows);
 if(!error||call.name!=='mcp__monotest__save_document')return false;
 const input=callInput(data.host,call);
 if(!text(input?.id)||!Array.isArray(input.patch))return false;
 const wanted=input.patch.map(p=>p?.new_string);
 for(const retry of data.calls.filter(c=>c.line>error.line&&c.name===call.name)){
  const again=callInput(data.host,retry);
  if(again?.id!==input.id||!Array.isArray(again.patch)||!isDeepStrictEqual(again.patch.map(p=>p?.new_string),wanted))continue;
  let saved;try{saved=resultFor(data.host,retry,data.rows);}catch{continue;}
  if(idOf(saved.value)!==input.id)continue;
  for(const read of data.calls.filter(c=>c.line>saved.resultLine&&c.name==='mcp__monotest__get_document')){
   if(callInput(data.host,read)?.id!==input.id)continue;
   try{if(idOf(resultFor(data.host,read,data.rows).value)===input.id)return true;}catch{}
  }
 }
 return false;
}
const writeBody=write=>bodyOf(write.input)??bodyOf(write.value)??'';
const missing=reason=>{throw new MissingEvidence(reason);};
const bindingMissing=reason=>{const error=new MissingEvidence(reason);error.bindingOnly=true;throw error;};
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
 const day=value.slice(0,10),stamp=Date.parse(day);
 if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==day||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)return NaN;
 return Date.parse(value);
}

const identityValues=value=>typeof value==='string'?[value]:[value?.id,value?.name].filter(text);
// Linear's observed block spacing, link wrappers, list markers, self-links on
// bare file-like tokens and backslashes before prose square brackets. Preserve
// paragraph boundaries, code and all substantive bytes.
function prose(value) {
 return value.replace(/<issue\b[^<>]*\/\s*>/g,all=>{
   const label=all.match(/\blabel="([^"]+)"/)?.[1],key=all.match(/\bhref="https:\/\/linear\.app\/[^"\s]+\/issue\/([^/"#?]+)[^"]*"/)?.[1];
   return key&&label===key?key:all;
  }).replace(/<issue\b[^>]*\bhref="https:\/\/linear\.app\/[^"\s]+\/issue\/([^/"#?]+)[^"]*"[^>]*>([^<>]*)<\/issue>/g,(all,key,label)=>label.trim()===key?key:all)
  .replace(/\[([^\]\n]+)\]\(<([^<>\s()]+)>\)/g,'[$1]($2)').replace(/\]\(([^()\s<>]+)\)/g,(all,dest)=>{try{return `](${decodeURI(dest)})`;}catch{return all;}}).replace(/\[(https?:\/\/[^\]\s]+)\]\(\1\)/g,'$1')
  // README.md:7 is stored as [README.md:7](<http://README.md:7>); only a label equal to its own target collapses.
  .replace(/\[([^\[\]\s]+)\]\(http:\/\/\1\)/g,'$1')
  // row[i] is stored as row\[i\]. Escaped is the common form; only the label brackets of a whole simple
  // link stay bare, so escaped literal text never equals a link and call syntax like cb[i](a, b) still matches.
  .replace(/(\[[^\[\]\n]*\]\([^()\s<>]+\))|(\\*)([\[\]])/g,(all,link,slashes,bracket)=>link??(slashes.length%2?all:`${slashes}\\${bracket}`));
}
function inlineProse(line,opened) {
 let result='',start=0,delimiter=opened;
 for(const match of line.matchAll(/`+/g)) {
  const part=line.slice(start,match.index);result+=delimiter===null?prose(part):part;
  result+=match[0];start=match.index+match[0].length;
  if(delimiter===null)delimiter=match[0].length;else if(delimiter===match[0].length)delimiter=null;
 }
 const tail=line.slice(start);return result+(delimiter===null?prose(tail):tail);
}
function markdown(value){
 if(typeof value!=='string')return value;
 let fence=null,inline=null,heading=false;const result=[];
 for(const line of value.split('\n')){
  const marker=inline===null?line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/):null;
  const block=Boolean(fence||marker||(inline===null&&/^(?: {4}|\t)/.test(line))),literal=block||inline!==null;
  if(marker){
   if(!fence)fence=marker[1];
   else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;
  }
  if(!literal&&heading&&line==='')continue;
  if(!literal&&/^(?:#{1,6} | {0,3}[-*] )/.test(line)){
   // Optional separation before a heading/list is renderer formatting.
   while(result.at(-1)==='')result.pop();
  }else if(!literal&&line!==''&&result.at(-1)===''&&result.at(-2)===''&&/^ {0,3}[-*] /.test(result.findLast(v=>v!=='')??'')){
   // Keep the paragraph break after a list; only extra empty lines collapse.
   while(result.at(-1)===''&&result.at(-2)==='')result.pop();
  }
  // Inline code is opaque too; destinations with whitespace or parenthesis
  // syntax stay literal rather than risk changing the link's parse.
  const list=literal?line:line.replace(/^([ ]{0,3})- /,'$1* ');
  result.push(block?list:inlineProse(list,inline));
  heading=!literal&&/^#{1,6} /.test(line);
  if(!block)for(const tick of line.matchAll(/`+/g)){
   if(inline===null)inline=tick[0].length;
   else if(inline===tick[0].length)inline=null;
  }
 }
 while(!fence&&inline===null&&result.at(-1)==='')result.pop();
 return result.join('\n');
}
const elided=value=>typeof value==='string'&&/… \(truncated, use `get_(?:document|issue|project)` for full description\)$/.test(value);
function compareField(field,wanted,actual,id){
 let same;
 if(field==='status'||field==='labels'){
  const desired=field==='labels'?wanted:[wanted],observed=field==='labels'?actual:[actual];
  if(!Array.isArray(desired)||!Array.isArray(observed))missing(`unreadable ${id}.${field}`);
  const matched=new Set();let unresolved=false;
  same=desired.every(value=>{
   const identities=identityValues(value),index=observed.findIndex(row=>field==='status'&&value?.id&&row?.id?value.id===row.id:identityValues(row).some(v=>identities.includes(v)));
   if(index<0){if(!text(value?.name)&&identities.some(v=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v))&&observed.some(row=>typeof row==='string'))unresolved=true;return false;}
   matched.add(index);return true;
  })&&matched.size===observed.length;
  if(!same&&unresolved)missing(`id/name resolution unavailable for ${id}.${field}`);
 }else same=isDeepStrictEqual(wanted,actual)||(['description','content','body'].includes(field)&&markdown(wanted)===markdown(actual));
 if(!same)throw new Error(`read-back/write result mismatch for ${id}.${field}`);
}

// Same cursor/ordering contract as idea-gate readDump, extended to documents/issues.
function pages(root,prefix,key,files){
 const directory=path.dirname(prefix),stem=path.basename(prefix);
 const names=fs.readdirSync(path.join(root,directory)).filter(name=>name.startsWith(stem+'-')&&name.endsWith('.json'));
 const count=names.filter(name=>new RegExp(`^${stem}-[1-9]\\d*\\.json$`).test(name)).length;
 if(!count||names.length!==count*2)missing(`incomplete ${prefix} pages`);
 const records=[],ids=new Set(),cursors=new Set();let cursor,updated=Infinity;
 for(let n=1;n<=count;n++){
  const requestFile=`${prefix}-${n}.request.json`,file=`${prefix}-${n}.json`,request=read(path.join(root,requestFile)),page=rawRead(path.join(root,file));
  if(!request||Array.isArray(request)||typeof request!=='object'||(n===1?Object.keys(request).length!==0:Object.keys(request).length!==1||request.cursor!==cursor))missing(`broken ${prefix} cursor request`);
  if(!Array.isArray(page?.[key])||typeof page.hasNextPage!=='boolean'||page.hasNextPage!==(n<count)||
    (page.hasNextPage?(!page[key].length||(key==='comments'?page.cursor!==page[key].at(-1)?.id:!text(page.cursor))):Object.hasOwn(page,'cursor')))missing(`unfinished ${prefix} page`);
  if(page.hasNextPage){if(cursors.has(page.cursor))missing(`repeated ${prefix} cursor`);cursors.add(page.cursor);}
  cursor=page.cursor;files.push({file,value:page,request,kind:`list_${key}`,scope:directory});
  for(const record of page[key]){
   const id=key==='comments'?record.id:idOf(record);if(!text(id)||ids.has(id))missing(`duplicate/missing ${prefix} id`);ids.add(id);
   if(key==='comments'){
    if(typeof record.body!=='string'||!Number.isFinite(date(record.createdAt))||!Number.isFinite(date(record.updatedAt))||date(record.updatedAt)>updated)missing('invalid comment ordering/body');
    updated=date(record.updatedAt);
   }
   records.push(record);
  }
 }
 return records;
}

export function readRecordDump(root,project,projectName){
 if(!project){
  const files=[],projects=pages(root,'projects','projects',files);
  if(!text(projectName))missing('run project name required for absence proof');
  if(projects.some(p=>p.name===projectName))throw new Error('forbidden project:create: run project exists after refusal');
  return {project:null,projectComments:[],comments:[],documents:[],issues:[],all:[],files};
 }
 const raw=rawRead(path.join(root,'project.json')),files=[{file:'project.json',value:raw,kind:'get_project',id:project.id??project.uuid}];
 if(!text(raw?.uuid)||raw.uuid!==(project.id??project.uuid)||raw.name!==project.name||!ownUrl(raw.url)||(typeof raw.description!=='string'||elided(raw.description)))missing('project read-back identity incomplete');
 const projectComments=pages(root,'comments','comments',files),comments=[...projectComments],documents=[],issues=[],statuses=new Map(),issueTeams=new Map();
 const teams=fs.existsSync(path.join(root,'teams-1.json'))?pages(root,'teams','teams',files):[];
 const refs=pages(root,'documents','documents',files);
 for(const ref of refs){
  const id=idOf(ref);if(!/^[A-Za-z0-9-]+$/.test(id))missing('invalid document id');
  const file=`documents/${id}.json`,doc=rawRead(path.join(root,file));
  if(idOf(doc)!==id||typeof doc.content!=='string'||elided(doc.content)||!text(doc.title))missing('document body incomplete');
  if((doc.projectId??doc.project?.id)!==raw.uuid)missing('document project incomplete');
  documents.push(doc);files.push({file,value:doc,kind:'get_document',id});
 }
 for(const ref of pages(root,'issues','issues',files)){
  const id=idOf(ref);if(!/^[A-Za-z0-9-]+$/.test(id))missing('invalid issue id');
  const alias=ref.id;
  const directory=fs.existsSync(path.join(root,`issues/${id}`))?id:alias;
  if(!/^[A-Za-z0-9-]+$/.test(directory))missing('invalid issue directory');
  const file=`issues/${directory}/issue.json`,issue=rawRead(path.join(root,file));
  if(idOf(issue)!==id||!text(issue.title)||typeof issue.description!=='string'||elided(issue.description)||!issue.status||
    !text(typeof issue.status==='string'?issue.status:issue.status.name)||!Array.isArray(issue.labels)||issue.labels.some(label=>!text(typeof label==='string'?label:label?.name)))missing('issue status/labels/body incomplete');
  if((issue.projectId??issue.project?.id)!==raw.uuid)missing('issue project incomplete');
  const team=issueTeam(issue,raw,teams);if(team)issueTeams.set(id,team);
  if(team&&!/^[A-Za-z0-9-]+$/.test(team))missing('invalid status team id');
  if(team&&!statuses.has(team)&&fs.existsSync(path.join(root,`statuses/${team}.json`))){
   const file=`statuses/${team}.json`,rows=rawRead(path.join(root,file));
   if(!Array.isArray(rows)||!rows.length||rows.some(row=>!text(row.id)||!text(row.name))||new Set(rows.map(row=>row.id)).size!==rows.length)missing('incomplete fixed team statuses');
   statuses.set(team,rows);files.push({file,value:rows,kind:'list_issue_statuses',id:team,alias:typeof issue.team==='string'?issue.team:issue.team?.name});
  }
  issues.push(issue);files.push({file,value:issue,kind:'get_issue',id,alias});
  const start=files.length;comments.push(...pages(root,`issues/${directory}/comments`,'comments',files));
  for(const file of files.slice(start)){file.scopeId=id;file.scopeAlias=alias;}
 }
 const all=[raw,...comments,...documents,...issues];
 for(const row of all)if(row.url!==undefined&&!ownUrl(row.url))throw new Error(`record outside monotest: ${row.url}`);
 return {project:raw,projectComments,comments,documents,issues,statuses,issueTeams,all,files};
}

function recordLines(body){
 // Stage gates read whole marker lines, excluding embedded snapshot/page text.
 return approvalBlocks(body).filter(block=>!['mono-idea-snapshot','mono-tech-page'].includes(block.info))
  .flatMap(block=>(block.fenced?block.content:block.text).split(/\r?\n/));
}
function recordCount(body,type,project){
 if(type==='mono-brief'){
  const blocks=approvalBlocks(body).filter(block=>block.fenced||block.text.trim());
  const markers=blocks.filter(block=>block.info==='mono-brief');
  if(markers.length!==1||blocks.at(-1)!==markers[0])return 0;
  // JSON.parse loses duplicate members; accept only the literal single binding.
  const content=markers[0].content;
  try{return JSON.parse(content).project===project&&content.replace(/[ \t\r\n]/g,'')===JSON.stringify({project})?1:0;}catch{return 0;}
 }
 if(type==='mono-research')return approvalBlocks(body).filter(block=>block.info==='mono-research').length;
 const markers=['mono-idea: approved','mono-prd: approved','mono-design: approved','mono-tech: approved','mono-package: start'];
 type=markers.find(marker=>marker.split(':')[0]===type)??type;
 return recordLines(body)
  .filter(line=>{line=type.startsWith('mono-idea')?line:line.trim();return (type.includes(':')&&line===type)||line.startsWith(type+(type.includes(':')?' ':': '));}).length;
}
function expectedRecords(dump,type,body=row=>bodyOf(row)){
 const rows=['mono-research','mono-brief'].includes(type)?dump.documents:dump.projectComments;
 return rows.flatMap(row=>Array.from({length:recordCount(body(row),type,dump.project?.uuid)},()=>row));
}

function recordWrite(write,type,dump){
 return expectedRecords(dump,type,row=>idOf(row)===idOf(write.value)?writeBody(write):'').length>0;
}

function runViolations(traces,request={}){
 const manualRemoval=new Set(),evidence=[],transitions=[],dumpWrites=[],inputErrors=[];
 for(const {host,trace,endLine} of traces){
  let data;
  try{data=nativeRecords(host,trace);}catch{
    const rows=readJsonLines(trace,{errorLines:true}).events,calls=[];
    for(const row of rows)try{calls.push(...auditRows(host,[row]).calls.filter(c=>c.name.startsWith('mcp__')));}catch{}
    data={rows,calls,audit:{calls:rows.flatMap(row=>{try{return auditRows(host,[row]).calls;}catch{return [];}})}};
  }
  if(request.expectedRecords?.some(rule=>rule.forbidden==='start-next-stage'))for(const call of data.audit.calls){
   if(call.name===stageDriverTool){transitions.push(`${trace}:${call.line}: forbidden start-next-stage`);continue;}
   if(!['Skill','Agent','Task'].includes(call.name))continue;
   let input;try{input=callInput(host,call);}catch(error){inputErrors.push(`${trace}:${call.line}: ${error.message}`);continue;}
   if((call.name==='Skill'&&request.nextSkill&&input?.skill===request.nextSkill)||(['Agent','Task'].includes(call.name)&&request.nextAgent&&input?.subagent_type===request.nextAgent))transitions.push(`${trace}:${call.line}: forbidden start-next-stage`);
  }
  for(const call of data.calls){
   if(request.readOnlyDump&&isWrite(call.name))dumpWrites.push(`${trace}:${call.line}: record dump permits monotest reads only`);
   if(!isWrite(call.name)||call.name.startsWith('mcp__paper__'))continue;
   let record;try{record=resultFor(host,call,data.rows,false);}catch{}
   const links=[record?.value?.url,...['comment','issue','project','document'].map(key=>record?.value?.[key]?.url)].filter(url=>typeof url==='string'&&url.startsWith('https://linear.app/'));
   const outside=links.filter(url=>!ownUrl(url));
   if(!call.name.startsWith('mcp__monotest__')||outside.length){
    // Foreign reads still stop the run, but their existing records are not
    // mutations. Never suggest deleting a record returned by a read.
    if(!/^mcp__.+__(?:get|list|search|read|fetch)_/.test(call.name))outside.forEach(url=>manualRemoval.add(url));evidence.push(`${trace}:${call.line}: write outside monotest: ${call.name}`);
   }
  }
 }
 return evidence.length?{status:'failed',stop:true,manualRemoval:[...manualRemoval],evidence,reason:'MCP write outside monotest: stopped; manual removal only for linked successful record URLs; no deletion attempted'}:transitions.length?{status:'failed',stop:false,manualRemoval:[],evidence:transitions,reason:'forbidden start-next-stage'}:dumpWrites.length?{status:'failed',stop:false,manualRemoval:[],evidence:dumpWrites,reason:'record dump permits monotest reads only'}:inputErrors.length?{status:'unverified',stop:false,manualRemoval:[],evidence:inputErrors,reason:inputErrors.join('; ')}:null;
}

// Cross-session order comes from native invocation/result timestamps. Claude's
// timestamp-less stream can use the existing driver's hash-bound process result;
// neither file mtime nor times supplied in a verification request prove order.
function captureInterval(data){
 if(data.interval!==undefined)return data.interval;
 data.interval=null;
 if(data.host!=='claude')return null;
 const file=path.join(path.dirname(data.trace),'result.json');
 if(!fs.existsSync(file))return null;
 const timing=read(file).process?.traceTiming;
 if(!timing||timing.file!==path.basename(data.trace)||timing.sha256!==sha256(fs.readFileSync(data.trace)))return null;
 const start=date(timing.startedAt),end=date(timing.finishedAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)missing('invalid driver trace time interval');
 return data.interval={start,end};
}
function traceTime(data,line,start=false){
 const row=data.rows.find(r=>r.line===line);
 if(!row)return start?captureInterval(data)?.start:captureInterval(data)?.end;
 // started_at has second precision and is a conservative lower bound.
 if(start&&row.value.type==='event_msg'&&row.value.payload?.type==='task_started'&&Number.isSafeInteger(row.value.payload.started_at)){
  const native=date(row.value.timestamp),seconds=row.value.payload.started_at*1000;
  return Number.isFinite(native)?Math.min(native,seconds):seconds;
 }
 if(row.value.timestamp!==undefined){const stamp=date(row.value.timestamp);if(!Number.isFinite(stamp))missing('invalid native trace time');return stamp;}
 return start?captureInterval(data)?.start:captureInterval(data)?.end;
}
function uniquelyBoundNativeStart(data,call){
 if(call.event.type!=='event_msg')return true;
 if(!Number.isInteger(call.approvalInvocationLine))return false;
 // Opaque or aliased outer calls can own a completion too. Only restrict the
 // already-proved start; never infer ownership by parsing another JS spelling.
 const open=data.rows.filter(row=>{
  const p=row.value.payload;
  if(row.line>=call.line||row.value.type!=='response_item'||!['function_call','custom_tool_call'].includes(p?.type))return false;
  const outputs=text(p.call_id)?data.rows.filter(result=>result.line>row.line&&result.value.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(result.value.payload?.type)&&result.value.payload.call_id===p.call_id):[];
  return outputs.length!==1||outputs[0].line>call.line;
 });
 if(open.length!==1||open[0].line!==call.approvalInvocationLine)return false;
 const id=open[0].value.payload.call_id;
 return text(id)&&data.rows.filter(row=>row.line>open[0].line&&row.value.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(row.value.payload?.type)&&row.value.payload.call_id===id).length===1;
}
function before(left,line,right,call){
 const startLine=call.event.type==='event_msg'?(uniquelyBoundNativeStart(right,call)?call.approvalInvocationLine:call.invocationLine):call.line;
 if(fs.realpathSync(left.trace)===fs.realpathSync(right.trace)&&Number.isInteger(startLine))return line<startLine;
 const end=traceTime(left,line),start=traceTime(right,startLine,true);
 return Number.isFinite(end)&&Number.isFinite(start)&&end<start;
}

const sha256=value=>createHash('sha256').update(value).digest('hex');
function versionApproval(write){
 const body=writeBody(write),schemas=[
  ['mono-prd: approved',['project','document','updatedAt','by'],['next','design']],
  ['mono-design: approved'],
  ['mono-tech: approved',['project','prd','prd-updatedAt','spec','spec-sha256','page-sha256','by'],['design']],
  ['mono-package: start',['project','record','sha256','issues','by'],['research']]
 ];
 const records=schemas.flatMap(([kind,required,optional])=>{
  const comments=[{...write.value,body}];
  const record=kind==='mono-design: approved'?latestDesignApproval(comments):latestApproval(comments,kind,required,optional);return record?[{kind,...record}]:[];
 });
 if(records.length!==1)throw new Error('written approval does not bind the shown content/version');
 return records[0];
}
function bindsSnapshot(body,info,text){
 const snapshots=approvalBlocks(body).filter(block=>block.info===info);
 return snapshots.length===1&&snapshots[0].content.replace(/[\r\n]+$/,'')===text.replace(/[\r\n]+$/,'');
}
function presentationRead(data,line,recordId) {
 const call=data.audit.calls.find(c=>c.line===line&&['mcp__monotest__get_document','mcp__monotest__get_project','mcp__monotest__list_comments'].includes(c.name));
 if(!call)missing('native document read missing');
 const read=resultFor(data.host,call,data.rows);
 if(recordId&&Array.isArray(read.value.comments))read.value=read.value.comments.find(row=>idOf(row)===recordId);
 if(!text(idOf(read.value))||typeof bodyOf(read.value)!=='string')missing('native document identity/body missing');
 return read;
}
function presentationKind(expected,binding) {
 if(!Array.isArray(expected.presentation))return expected.presentation;
 if(!binding||!expected.presentation.includes(binding.presentation))bindingMissing('presentation kind binding missing');
 return binding.presentation;
}
function documentPresentation(data,exchange,binding,dump) {
 if(!binding)bindingMissing('native presentation binding missing');
 if(binding.shownLine!==exchange.line)throw new Error('presentation does not bind last stage message');
 const shown=presentationRead(data,binding.shownReadLine,binding.currentRecordId);
 if(shown.resultLine>=exchange.line)throw new Error('document read outside shown boundary');
 if(!text(shown.value.url)||!exchange.text.includes(shown.value.url))throw new Error('summary link does not bind native document');
 if(binding.text!==bodyOf(shown.value))throw new Error('presentation body differs from native document');
 if(!exchange.expected.outcome.approval&&!exchange.expected.outcome.startNext)return {documentId:idOf(shown.value),shownBody:bodyOf(shown.value),shownHash:sha256(bodyOf(shown.value)),shownReadLine:shown.line};
 const fresh=presentationRead(data,binding.currentLine,binding.currentRecordId);
 if(shown.resultLine>=exchange.line||fresh.line<=exchange.replyLine||fresh.resultLine>=exchange.response.line)throw new Error('document read outside shown/reply version boundary');
 if(idOf(shown.value)!==idOf(fresh.value)||(binding.documentId!==undefined&&binding.documentId!==idOf(shown.value)))throw new Error('approved document changed');
 if(!text(shown.value.url)||!exchange.text.includes(shown.value.url))throw new Error('summary link does not bind native document');
 const shownBody=bodyOf(shown.value),freshBody=bodyOf(fresh.value);
 if(binding.text!==shownBody)throw new Error('presentation body differs from native document');
 const approved=correctedVersion(shownBody,exchange.expected,freshBody);
 if(approved!==freshBody)throw new Error('version changed after shown approval');
 const persisted=dump.all.find(row=>idOf(row)===idOf(fresh.value));
 if(!persisted||bodyOf(persisted)!==approved)throw new Error('approved version changed before final read-back');
 return {documentId:idOf(shown.value),shownBody,shownHash:sha256(shownBody),approvedBody:approved,approvedHash:sha256(approved),shownReadLine:shown.line,currentLine:fresh.line};
}
function nativeWindowAnswer(request,data,window){
 // Codex sent.jsonl is the driver's {thread,prompt} journal, not a native
 // event stream. Its delivered answer is proved from the resumed rollout.
 const responses=request.host==='claude'&&request.sent?traceRows(request.sent,'claude').rows.map(r=>r.value):[];
 const accepted=data.audit.windowProof(window.event,window.line,window.callId,{responses});
 if(accepted.status!=='confirmed')missing('native window reply missing');
 const after=data.rows.filter(r=>r.line>window.line);
 const reply=request.host==='claude'?after.find(r=>r.value.type==='user'&&r.value.message?.content?.some?.(b=>b.type==='tool_result'&&b.tool_use_id===window.callId))
  :after.find(r=>r.value.type==='response_item'&&r.value.payload?.type==='message'&&r.value.payload.role==='user');
 if(!reply)missing('approval reply line missing');
 let answers;
 if(request.host==='claude'){
  const permission=after.find(r=>r.value.type==='control_request'&&r.value.request?.tool_name==='AskUserQuestion');
  const sent=responses.find(r=>r.response?.request_id===permission?.value.request_id)?.response?.response;
  if(sent?.behavior==='deny')return {reply,answers:[],refused:true,replyText:sent.message};
  const updated=sent?.behavior==='allow'?sent.updatedInput:!sent?reply.value.tool_use_result:null;
  answers=window.input.questions.map(q=>updated?.answers?.[q.question]);
 }else{
  const content=(reply.value.payload.content?.[0]?.text??'').trim();
  try{answers=JSON.parse(content.slice('<send_user_message_question_reply>'.length,-'</send_user_message_question_reply>'.length)).map(a=>a.answer);}catch{answers=[];}
 }
 if(!answers.length||answers.some(a=>typeof a!=='string'))missing('native window answers unavailable');
 return {reply,answers};
}
function windowPlans(request,data){
 if(!Array.isArray(request.expectedWindows)||!request.expectedWindows.length||!Array.isArray(request.windows))missing('historical window scenario policies missing');
 const replies=[],plans=new Map();
 for(const call of data.audit.calls.filter(c=>!c.event.parent_tool_use_id&&isOwnerWindow(c.name))){
  const plan=windowPolicy(request,call.input?.questions??[],replies);plans.set(call.callId,plan);replies.push(plan);
 }
 return plans;
}
const evidenceStatus=error=>error instanceof MissingEvidence||error instanceof SyntaxError||['ENOENT','ENOTDIR'].includes(error.code)?'unverified':'failed';
function windowRequest(request,source){
 return {...request,host:source.host,trace:source.trace,endLine:source.endLine,stageStartLine:source.stageStartLine,sent:source.sent,
  expectedReplies:source.expectedReplies,expectedWindows:source.expectedWindows,windows:source.windows,rubricDefinition:source.rubricDefinition??request.rubricDefinition};
}
function historicalSource(request,checked){
 const source={host:request.host,trace:request.trace,definition:request.rubricDefinition,traceHash:null,...checked,exchanges:null};
 if(checked.kind==='helper')return {...source,traceHash:sha256(fs.readFileSync(request.trace)),definition:null,exchanges:[]};
 try{
  source.traceHash=sha256(fs.readFileSync(request.trace));
  const data=nativeRecords(request.host,request.trace,request.endLine),plans=windowPlans(request,data);
  source.exchanges=checked.windows.map(window=>{
   const call=data.audit.calls.find(c=>c.callId===window.callId),plan=plans.get(window.callId);
   if(!call||!plan)missing('historical window exchange unavailable');
   const {reply,...answer}=nativeWindowAnswer(request,data,call);
   const next=data.audit.calls.find(c=>c.line>reply.line&&isOwnerWindow(c.name)&&!c.event.parent_tool_use_id);
   const response=data.rows.filter(r=>r.line>reply.line&&(!next||r.line<next.line)&&!r.value.parent_tool_use_id).map(r=>request.host==='claude'?r.value.message?.role!=='user'&&r.value.type==='assistant'?r.value.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'):null:r.value.payload?.role==='assistant'?r.value.payload.content?.filter(b=>b.type==='output_text').map(b=>b.text).join('\n'):null).filter(text).join('\n');
   return {id:window.id,line:window.line,callId:call.callId,text:window.summary,summaryLine:window.summaryLine,questions:window.questions,...answer,replyLine:reply.line,response,expected:plan.target?request.expectedWindows[plan.expectedIndex]:null,policy:plan.policy,target:plan.target};
  });
  if(!source.exchanges.length||!text(source.definition))missing('historical window rubric input or definition missing');
 }catch(error){source.status=worstStatus(source.status,'unverified');source.reason=error.message;source.exchanges=null;}
 if(source.status!=='passed'&&!source.reason)source.reason=[...(source.windows??[]).flatMap(w=>w.issues??[]),...(source.checks??[]).map(c=>c.reason)].filter(Boolean).join('; ');
 return source;
}
function approvalCheck(request,write,data,dump,writes){
 const createProject=write.name.endsWith('__create_project')||(write.name.endsWith('__save_project')&&!write.input.id);
 const markers=recordLines(writeBody(write)).map(line=>line.trim().match(/^(mono-[\w-]+: (?:approved|start))(?: |$)/)?.[1]).filter(Boolean);
 if(!createProject&&!markers.some(type=>recordWrite(write,type,dump)))return;
 const packageStart=recordWrite(write,'mono-package: start',dump);
 const binding=request.approvalBindings?.find(b=>b.recordId===idOf(write.value));
 if(data.expectedReplies) return textApprovalCheck(request,write,data,dump,{createProject,packageStart,binding,writes});
 if(dialogueMode(request.testedVersion??testedVersion(request,path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')))!=='windows')throw new Error('text approval requires scenario expectedReplies');
 const candidates=data.audit.calls.filter(c=>!c.event.parent_tool_use_id&&['AskUserQuestion','request_user_input_async'].includes(c.name)&&c.line<write.line);
 const decisions=candidates.filter(c=>windowRole(c.input?.questions)===(packageStart?'transition':'approval'));
 const window=binding?candidates.find(c=>c.callId===binding.windowCallId):decisions.at(-1);
 if(!window)missing('approval window missing');
 if(window!==decisions.at(-1))throw new Error('approval binding does not name the latest decision window');
 const {reply,answers}=nativeWindowAnswer(request,data,window);
 const plan=Array.isArray(request.expectedWindows)&&Array.isArray(request.windows)?windowPlans(request,data).get(window.callId):null,policy=plan?.policy;
 // Only actual approving choices grant authority. A prefix in arbitrary prose
 // (including a refusal) is never a choice; correction text is scenario-owned.
 const authorizes=(answer,index)=>{
  const labels=(window.input.questions[index]?.options??[]).map(o=>typeof o==='string'?o:o.label);
  const approving=packageStart?/^(?:Начать работу|Передать оркестратору)(?: \(Recommended\))?$/:/^Утвердить(?:, продолжу позже| и начать [A-Za-z ]+)?(?: \(Recommended\))?$/;
  return labels.includes(answer)&&approving.test(answer)||policy?.mode==='correction'&&text(policy.text)&&answer===policy.text;
 };
 if(!answers.length||answers.some((answer,index)=>!authorizes(answer,index)))throw new Error('approval write after empty/refuse/discuss/non-approval reply');
 if(write.line<=reply.line)throw new Error('approval write before window answer');
 if(!binding)bindingMissing(`shown-version binding missing for ${idOf(write.value)}`);
 const ownerText=row=>!row.value.parent_tool_use_id&&(request.host==='claude'?row.value.type==='assistant'&&row.value.message?.content?.some(b=>b.type==='text'&&text(b.text))
  :row.value.payload?.type==='message'&&row.value.payload.role==='assistant'&&row.value.payload.content?.some(b=>b.type==='output_text'&&text(b.text)));
 const shown=data.rows.find(r=>r.line===binding.shownLine&&!r.value.parent_tool_use_id),current=data.rows.find(r=>r.line===binding.currentLine);
 const shownText=request.host==='claude'?shown?.value.message?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')
  :shown?.value.payload?.role==='assistant'?shown.value.payload.content?.filter(b=>b.type==='output_text').map(b=>b.text).join('\n'):null;
 if(!text(binding.text)||!shownText||binding.shownLine>=reply.line||(request.host==='claude'&&binding.shownLine>=window.line))missing('shown version not found in owner-visible trace');
 if(request.host==='codex'){
  const terminal=data.rows.find(r=>r.line>window.line&&r.line<reply.line&&data.audit.proof({kind:'terminal',result:r.value}).status==='confirmed');
  if(!terminal||binding.shownLine<=window.line||binding.shownLine>=terminal.line)missing('shown version outside approved Codex window turn');
  if(data.rows.findLast(r=>r.line<terminal.line&&ownerText(r))?.line!==binding.shownLine)throw new Error('approval does not bind the last owner-visible text');
 }else if(data.rows.findLast(r=>r.line<window.line&&ownerText(r))?.line!==binding.shownLine)throw new Error('approval does not bind the last owner-visible text');
 const expected=plan?.target?request.expectedWindows[plan.expectedIndex]:null;
 const corrected=policy?.mode==='correction'&&Boolean(expected?.correction);
 const approvedText=corrected?correctedArtifact({request,write,data,dump,createProject,binding,writes,shown:binding.text,expected,replyLine:reply.line,
  sameExchange:(candidate,b)=>b.windowCallId===window.callId&&data.audit.calls.filter(c=>!c.event.parent_tool_use_id&&isOwnerWindow(c.name)&&c.line<candidate.line).at(-1)===window}):binding.text;
 // Older bindings name only the project's three sections. Its complete shown
 // presentation is still bound by the Idea snapshot for this same window.
 const presentation=createProject&&!corrected?(request.approvalBindings??[]).find(b=>b.windowCallId===window.callId&&b.shownLine===binding.shownLine&&
  typeof b.text==='string'&&b.text.startsWith(binding.text)&&shownText.includes(b.text)&&
  writes.some(w=>w.data===data&&idOf(w.value)===b.recordId&&recordWrite(w,'mono-idea: approved',dump)))?.text??approvedText:approvedText;
 const approvedProjectText=createProject?ideaProjectBody(request,presentation):approvedText;
 return checkApprovedVersion({request,write,data,dump,createProject,packageStart,binding,shownText,reply,shownLimit:window.line,approvedText,approvedProjectText,corrected});
}

function correctedArtifact({request,write,data,dump,createProject,binding,writes,shown,expected,replyLine,sameExchange}) {
 let snapshotBody=writeBody(write);
 if(createProject) {
  const approvals=writes.filter(candidate=>candidate.data===data&&recordWrite(candidate,'mono-idea: approved',dump)&&
   request.approvalBindings?.some(b=>b.recordId===idOf(candidate.value)&&b.shownLine===binding.shownLine&&b.text===binding.text&&sameExchange(candidate,b)));
  if(approvals.length!==1)throw new Error('unique Idea approval snapshot for the same exchange required');
  const approval=approvals[0],invocation=approval.event.type==='event_msg'?approval.approvalInvocationLine:approval.line;
  if(!Number.isInteger(invocation)||invocation<=replyLine||invocation<=write.resultLine)throw new Error('Idea approval snapshot must follow consent and project creation');
  snapshotBody=writeBody(approval);
 }
 const snapshot=approvalBlocks(snapshotBody).find(b=>b.info==='mono-idea-snapshot'||b.info==='mono-tech-page')?.content.replace(/[\r\n]+$/,'');
 const call=!createProject&&data.audit.calls.find(c=>c.line===binding.currentLine&&!isWrite(c.name));
 const actual=snapshot??(call?bodyOf(resultFor(data.host,call,data.rows).value):undefined);
 return correctedVersion(shown,expected,actual);
}
function ideaProjectBody(request,approvedText) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mono-shown-idea-'));
 try{
  const draft=path.join(directory,'approved.md');fs.writeFileSync(draft,approvedText);
  const run=spawnSync(process.execPath,[path.join(request.packRoot,'scripts/idea-gate.mjs'),'record','--draft',draft,'--out',directory,'--config',request.configFile],{encoding:'utf8'});
  if(run.status!==0)throw new Error('complete shown Idea cannot generate the project body');
  return fs.readFileSync(path.join(directory,'body.md'),'utf8');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}

function checkApprovedVersion({request,write,data,dump,createProject,packageStart,binding,shownText,reply,shownLimit,approvedText=binding.text,approvedProjectText=approvedText,corrected=false}) {
 let shownVersion;
 if(!shownText.includes(binding.text)||binding.shownReadLine!==undefined){
  const before=data.audit.calls.find(c=>c.line===binding.shownReadLine&&!isWrite(c.name));
  if(!before||before.line>=shownLimit)missing('shown version not found in owner-visible trace');
  const read=resultFor(request.host,before,data.rows);
  if(binding.currentRecordId&&Array.isArray(read.value.comments))read.value=read.value.comments.find(row=>idOf(row)===binding.currentRecordId);
  if(read.resultLine>=shownLimit||read.resultLine>=binding.shownLine||(binding.documentId&&idOf(read.value)!==binding.documentId)||!text(idOf(read.value))||
   (!shownText.includes(binding.text)&&(!text(read.value.url)||!shownText.includes(read.value.url)))||bodyOf(read.value)!==binding.text)missing('shown document link/version not bound to native read');
  shownVersion=read.value;
 }
 if((binding.currentLine===write.line||write.event.type==='event_msg'&&Number.isInteger(write.approvalInvocationLine)&&binding.currentLine===write.approvalInvocationLine)&&/mono-(?:idea|tech):\s*approved/.test(writeBody(write))){
  const info=writeBody(write).includes('mono-idea: approved')?'mono-idea-snapshot':'mono-tech-page';
  if(!bindsSnapshot(writeBody(write),info,approvedText))throw new Error('outgoing approved version differs from shown content');
  return; // idea-gate below independently checks the snapshot against persisted current data.
 }
 if(createProject){
  if(markdown(write.input.description??write.value.description)!==markdown(approvedProjectText))throw new Error('created project differs from shown version');
  return;
 }
 const currentCall=data.audit.calls.find(c=>c.line===binding.currentLine&&!isWrite(c.name));
 if(!data.rows.some(r=>r.line===binding.currentLine)||!currentCall||binding.currentLine<=reply.line||binding.currentLine>=write.line)missing('fresh version read after reply missing');
 const observed=resultFor(data.host,currentCall,data.rows);
 const invocation=write.event.type==='event_msg'?write.approvalInvocationLine:write.line;
 if(Number.isInteger(invocation)&&observed.resultLine>=invocation)throw new Error('fresh version read completed after approval write invocation');
 const value=observed.value;
 const fresh=binding.currentRecordId?(value.comments??value.documents??value.issues??[]).find(row=>idOf(row)===binding.currentRecordId):value;
 if(!fresh)missing('current version record absent from native read');
 const versioned=/mono-(?:prd|design|tech):\s*approved/.test(writeBody(write));
 const documentId=binding.documentId??(versioned?idOf(fresh):null);
 if(versioned&&!shownVersion)missing('shown document version read required');
 if(text(documentId)){
  const {kind,fields}=versionApproval(write);
  const bound=kind==='mono-prd: approved'?fields.document===documentId&&fields.updatedAt===fresh.updatedAt
   :['mono-design: approved','mono-tech: approved'].includes(kind)&&fields.prd===documentId&&fields['prd-updatedAt']===fresh.updatedAt
    ||kind==='mono-tech: approved'&&fields.spec===documentId&&fields['spec-sha256']===sha256(approvedText);
  if(!bound)throw new Error('written approval does not bind the shown content/version');
 }else if(packageStart){
  const {fields}=versionApproval(write);
  if(!text(idOf(fresh))||fields.record!==idOf(fresh)||fields.sha256!==sha256(approvedText))throw new Error('written approval does not bind the shown content/version');
 }else if(!writeBody(write).includes(approvedText))throw new Error('written approval does not bind the shown content/version');
 if(shownVersion&&!corrected&&!data.expectedReplies?.some(anchored)&&shownVersion.updatedAt!==fresh.updatedAt)throw new Error('version changed after shown approval');
 if(shownVersion&&idOf(shownVersion)!==idOf(fresh))throw new Error('approved document changed');
 if(bodyOf(fresh)!==approvedText)throw new Error('version changed after shown approval');
 if(binding.documentId&&idOf(fresh)!==binding.documentId)throw new Error('approved document changed');
 const persisted=dump.all.find(row=>idOf(row)===idOf(fresh));
 if(!persisted||bodyOf(persisted)!==approvedText||(!data.expectedReplies?.some(anchored)&&persisted.updatedAt!==fresh.updatedAt))throw new Error('approved version changed before final read-back');
 if(binding.documentId&&!Number.isFinite(date(fresh.updatedAt)))missing('approved document version timestamp missing');
 if(!Number.isInteger(invocation))bindingMissing('approval write invocation not proved by native trace');
}

function textApprovalCheck(request,write,data,dump,{createProject,packageStart,binding,writes}) {
 if(!binding)bindingMissing(`shown-version binding missing for ${idOf(write.value)}`);
 const exchange=data.exchanges.find(e=>e.expected.id===binding.replyId);
 if(!exchange)throw new Error('text approval has no scenario reply binding');
 const expected=exchange.expected;
 const preceding=data.exchanges.filter(e=>e.replyLine<write.line).at(-1);
 if(exchange!==preceding)throw new Error('approval does not bind the latest actual owner reply');
 const invocation=write.event.type==='event_msg'?write.approvalInvocationLine:write.line;
 if(!Number.isInteger(invocation))bindingMissing('approval invocation missing');
 if(invocation<=exchange.replyLine)throw new Error('approval write before actual owner reply');
 const latestUser=data.rows.filter(r=>r.line<invocation).findLast(r=>{
  const proof=data.audit.proof({kind:'text-message',result:r.value});return proof.status==='confirmed'&&proof.role==='user';
 });
 if(latestUser?.line!==exchange.replyLine)throw new Error('approval does not bind the latest actual owner reply');
 if(createProject&&expected.stage!=='idea')throw new Error('only Idea may create the approved project');
 if(packageStart?!expected.outcome.startNext:!expected.outcome.approval)throw new Error('scenario reply does not authorize this record');
 if(binding.shownLine!==exchange.line || !text(binding.text))throw new Error('approval does not bind the last owner-visible text');
 const framing=expected.framing??{before:'',after:'\n'+exchange.question};
 const displayed=text=>expected.stage==='idea'&&exchange.text.startsWith(dump.project.name+'\n\n')&&!text.startsWith(dump.project.name+'\n\n')?dump.project.name+'\n\n'+text:text;
 const presentation=anchored(expected)?presentationKind(expected,binding):'inline';
 if(presentation==='inline') {
  if(anchored(expected)&&(binding.artifactEnd!==undefined||binding.artifactStart!==undefined)) {
   const start=binding.artifactStart??0,end=binding.artifactEnd;
   if(binding.artifactStart!==undefined&&expected.stage!=='idea')throw new Error('approval does not bind the complete displayed artifact');
   if(!Number.isInteger(start)||start<0||!Number.isInteger(end)||end<=start||end>exchange.text.length||exchange.text.slice(start,end)!==(binding.artifactStart===undefined?displayed(binding.text):binding.text)||!exchange.text.slice(end).split('\n').some(line=>line.trim()===exchange.question))throw new Error('approval does not bind the complete displayed artifact');
  }else if(exchange.text!==displayed(framing.before+binding.text+framing.after))throw new Error('approval does not bind the complete displayed artifact');
 }
 const body=writeBody(write);
 let ideaText=binding.text;
 if(expected.stage==='idea'){
  const first=ideaText.indexOf('## '),prefix=first>0?ideaText.slice(0,first).trim():'';
  if(prefix){
   if(prefix!==dump.project.name)throw new Error('shown Idea project name differs from approved project');
   ideaText=ideaText.slice(first);
  }
 }
 let approvedText;
 if(anchored(expected)&&presentation==='document') {
  approvedText=documentPresentation(data,exchange,binding,dump).approvedBody;
 } else if(anchored(expected)&&expected.correction) {
  approvedText=correctedArtifact({request,write,data,dump,createProject,binding,writes,shown:ideaText,expected,replyLine:exchange.replyLine,
   sameExchange:(candidate,b)=>b.replyId===binding.replyId&&data.exchanges.filter(e=>e.replyLine<candidate.line).at(-1)===exchange});
 } else approvedText=correctedVersion(ideaText,expected);
 const approvedProjectText=createProject?ideaProjectBody(request,approvedText):undefined;
 const prose=approvalBlocks(body).filter(b=>!b.fenced).map(b=>b.text).join('\n').split(/\r?\n/);
 if(!createProject) {
  const quotedReply=expected.by==='orchestrator'&&expected.stage==='idea'?binding.ownerEvidence?.reply:expected.reply;
  const ownerProse='\n'+prose.join('\n')+'\n';
  if(ownerProse.split('Владелец: ответил ').length!==2||!ownerProse.includes(`\nВладелец: ответил «${quotedReply}»\n`))throw new Error('verbatim owner reply missing or substituted outside fences');
  const corrections=prose.filter(line=>line.startsWith('Поправка:'));
  if(expected.correction?corrections.length!==1:corrections.length)throw new Error('record correction differs from named correction');
  if(expected.correction) {
   if(anchored(expected))checkAnchors({anchors:expected.correction.descriptionAnchors},corrections[0].slice('Поправка:'.length),'named correction');
   else if(corrections[0]!==`Поправка: ${expected.correction.description}`)throw new Error('record correction differs from named correction');
  }
  if(recordLines(body).some(line=>/^mono-(?:idea|prd|design|tech): approved(?: |$)|^mono-package: start(?: |$)/.test(line.trim()))) {
   if(recordWrite(write,'mono-idea: approved',dump)) {
    if(expected.stage!=='idea')throw new Error('record kind differs from scenario stage');
    if((expected.by==='orchestrator')!==prose.includes('by=orchestrator'))throw new Error('Idea record authority differs from scenario');
   }else {
   const {fields,kind}=versionApproval(write);
   const stageMarker={idea:'mono-idea: approved',discovery:'mono-prd: approved',design:'mono-design: approved','tech-evaluation':'mono-tech: approved',handoff:'mono-package: start'};
   if(kind!==stageMarker[expected.stage])throw new Error('record kind differs from scenario stage');
   if(fields.by!==(expected.by??'owner'))throw new Error('record approval authority differs from scenario');
   }
  }
  if(expected.by==='orchestrator'&&!prose.includes(`Причина: ${expected.reason}`))throw new Error('orchestrator reason missing');
 }
 let ownerExchange;
 if(expected.by==='orchestrator'&&expected.stage==='idea') {
  const owner=binding.ownerEvidence;
  if(!owner)throw new Error('Idea requires verbatim owner message, question and actual reply');
  const source=request.scenarioData.find(d=>d.host===owner.host&&path.resolve(d.trace)===path.resolve(owner.trace));
  const actual=source?.exchanges?.find(e=>e.line===owner.shownLine&&e.replyLine===owner.replyLine);
  if(!actual || actual.expected.by==='orchestrator' || !actual.expected.outcome.approval ||
      actual.text!==owner.text || actual.question!==owner.question || actual.reply!==owner.reply ||
      actual.text!==exchange.text || actual.question!==exchange.question ||
      actual.expected.stage!==expected.stage || !isDeepStrictEqual(actual.expected.outcome,expected.outcome) ||
      !isDeepStrictEqual(actual.expected.correction,expected.correction) || !exchange.reply.includes(owner.reply))throw new Error('Idea relayed owner triple differs from actual conversation');
  const replyCall={line:exchange.replyLine,event:data.rows.find(r=>r.line===exchange.replyLine)?.value};
  if(!before(source,actual.replyLine,data,replyCall))throw new Error('Idea owner reply must precede delegated consent');
  ownerExchange=actual;
 }
 checkApprovedVersion({request,write,data,dump,createProject,packageStart,binding,shownText:exchange.text,reply:{line:exchange.replyLine},shownLimit:exchange.line,approvedText,approvedProjectText,corrected:Boolean(expected.correction)});
 // Creating the Idea project is preparatory; only its bound approval record
 // also satisfies the relayed owner's declared outcome.
 return !createProject&&!packageStart?[exchange,...(ownerExchange?[ownerExchange]:[])]:[];
}

export function verifyRecords(request){
 const gateResults=[],observedStarts=[],requiredChecks=[],windowChecks=[];
 const scenarioTraces=[{host:request.host,trace:request.trace,endLine:request.endLine,stageStartLine:request.stageStartLine,sent:request.sent,idleContinuation:request.idleContinuation,expectedReplies:request.expectedReplies,expectedWindows:request.expectedWindows,windows:request.windows,rubricDefinition:request.rubricDefinition},...(request.additionalTraces??[])];
 const dumpTraces=[...(request.dumpTrace?[{host:request.host,trace:request.dumpTrace}]:[]),...(request.dumpAdditionalTraces??[])];
 const traces=[...scenarioTraces,...dumpTraces];
 try{
  const auditErrors=[];
  for(const source of traces)try{const violation=runViolations([source],request);if(violation)return violation;}catch(error){auditErrors.push({source,error});}
  const historical=dialogueMode(testedVersion(request,path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')))==='windows';
  if(historical&&scenarioTraces.some(source=>source.expectedReplies!==undefined))throw new Error('legacy acceptance requires real windows, not text replies');
  if(historical){
   const sourceRequests=scenarioTraces.map(source=>({...windowRequest(request,source),phase:'complete',excerpt:false,expectedReplies:undefined}));
   const checkedSources=checkTraceSources(sourceRequests);
   for(const [index,source]of scenarioTraces.entries()){
    const checked=historicalSource(sourceRequests[index],checkedSources.sources[index]);windowChecks.push(checked);
    requiredChecks.push({id:index?`windows:${index}`:'windows',host:source.host,trace:source.trace,status:checked.status,reason:checked.reason});
   }
   for(const [index,{source,error}]of auditErrors.entries())requiredChecks.push({id:`source-audit:${index}`,host:source.host,trace:source.trace,status:evidenceStatus(error),reason:error.message});
  }else if(auditErrors.length)throw auditErrors[0].error;
  const load=(source,dump)=>{
   const full=nativeRecords(source.host,source.trace),data=nativeRecords(source.host,source.trace,!dump&&source.expectedReplies?undefined:source.endLine);
   data.sent=source.sent;data.scenario=source;
   if(dump&&full.calls.some(c=>isWrite(c.name)))throw new Error('dump attempted an external write');
   if(source.endLine!==undefined&&full.calls.some(c=>c.line>source.endLine&&isWrite(c.name)))throw new Error('write after scenario terminal');
   if(!completedTrace(source.host,data.rows))missing(`${dump?'dump':'scenario'} trace incomplete: ${source.trace}`);
   data.terminal=data.rows.findLast(r=>!r.value.parent_tool_use_id&&data.audit.proof({kind:'terminal',result:r.value}).status==='confirmed');
   if(data.calls.some(c=>c.line>data.terminal.line&&isWrite(c.name)))throw new Error('write after scenario terminal');
   if(data.calls.some(c=>c.line>data.terminal.line))missing('call after successful trace terminal');
   const notification=e=>e.type==='user'&&e.origin?.kind==='task-notification'&&typeof e.message?.content==='string'||e.type==='system'&&e.subtype==='task_notification';
   let previous=-Infinity;for(const row of data.rows)if(!(source.host==='claude'&&(row.value.isSynthetic===true||notification(row.value)))&&row.value.timestamp!==undefined){const stamp=date(row.value.timestamp);if(!Number.isFinite(stamp)||stamp<previous)missing('invalid or reversed native trace time order');previous=stamp;}
   data.expectedReplies=dump?undefined:source.expectedReplies;
   if(!dump&&data.audit.calls.some(c=>isOwnerWindow(c.name))&&dialogueMode(request.testedVersion??testedVersion(request,path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')))!=='windows')throw new Error('stage called a window in text scenario');
   if(!dump&&(request.expectedReplies||source.expectedReplies)&&data.audit.calls.some(c=>isOwnerWindow(c.name)))throw new Error('stage called a window in text scenario');
   if(data.expectedReplies) {
    data.exchanges=textExchanges(source.host,data.rows,data.expectedReplies,{startLine:source.stageStartLine,idleContinuation:source.idleContinuation});
   }
   return data;
  };
  const loaded=scenarioTraces.map((source,index)=>{
   try{return load(source,false);}catch(error){if(!historical)throw error;requiredChecks.push({id:`source-records:${index}`,host:source.host,trace:source.trace,status:evidenceStatus(error),reason:error.message});return null;}
  });
  const scenarios=loaded.filter(Boolean),dumps=dumpTraces.map(source=>load(source,true)),data=loaded[0],writes=[];
  request={...request,scenarioData:scenarios};
  checkEndings(scenarios.flatMap(d=>d.exchanges??[]));
  const stageStarts={idea:['Research'],research:['Discovery'],discovery:['Design','Tech Evaluation','Handoff'],design:['Tech Evaluation','Handoff'],'tech-evaluation':['Handoff'],handoff:['Delivery']};
  const stageNames={idea:'Idea',research:'Research',discovery:'Discovery',design:'Design','tech-evaluation':'Tech Evaluation',handoff:'Handoff'};
  const skillPrefix=request.nextSkill?.slice(0,request.nextSkill.lastIndexOf(':')+1);
  const agentStage=Object.keys(stageNames).find(stage=>request.nextAgent?.endsWith('-'+stage));
  const agentPrefix=agentStage?request.nextAgent.slice(0,-agentStage.length):null;
  for(const source of scenarios)if(source.expectedReplies||request.expectedReplies) {
   const policies=source.expectedReplies??request.expectedReplies;
   const starts=[];
   for(const call of source.audit.calls) {
    const input=source.calls.includes(call)||['Skill','Agent','Task'].includes(call.name)?callInput(source.host,call):call.input;
    const status=input?.state??input?.status;
    const invocation=call.event.type==='event_msg'?call.approvalInvocationLine:call.line;
    const e=source.exchanges?.filter(e=>e.replyLine<(invocation??call.line)).at(-1);
    // Before any owner reply, the scenario identifies only the current stage;
    // it cannot authorize a transition. Re-saving that stage is not a start.
    const currentStage=stageNames[e?.expected.stage??policies[0].stage];
    const routeTarget=Object.entries(stageNames).find(([stage])=>
     ((call.name==='Skill'&&skillPrefix&&input?.skill===skillPrefix+stage)||(['Agent','Task'].includes(call.name)&&agentPrefix&&input?.subagent_type===agentPrefix+stage)))?.[1];
    const intercepted=call.name===stageDriverTool;
    const next=intercepted|| (routeTarget?routeTarget!==currentStage:(call.name==='Skill'&&request.nextSkill&&input?.skill===request.nextSkill)||(['Agent','Task'].includes(call.name)&&request.nextAgent&&input?.subagent_type===request.nextAgent));
    const target=typeof status==='string'?status:status?.name;
    const currentLifecycle=policies.some(anchored)&&(e?.expected.stage??policies[0].stage)==='research'?'Discovery':currentStage;
    const transition=/__(?:save|create)_project$/.test(call.name)&&Object.values(stageStarts).some(stages=>stages.includes(target))&&target!==currentLifecycle;
    const workStart=recordLines(bodyOf(input)??'').some(line=>line.trim().startsWith('mono-package: start '));
    if(!next&&!transition&&!workStart)continue;
    if(!Number.isInteger(invocation))missing('start invocation not proved by native trace');
    if(!e?.expected.outcome.startNext||((transition||routeTarget)&&!stageStarts[e.expected.stage].includes(transition?target:routeTarget)))throw new Error('start-next-stage without scenario authority');
    if(anchored(e.expected)) {
     if(e.expected.by==='orchestrator'&&!(workStart&&e.expected.stage==='handoff'))throw new Error('delegated stage cannot start next stage');
     if(workStart&&e.expected.stage!=='handoff')throw new Error('only Handoff owns package start');
     const destination=intercepted?input.stage:transition?Object.keys(stageNames).find(k=>stageNames[k]===target):routeTarget?Object.keys(stageNames).find(k=>stageNames[k]===routeTarget):null;
     if(!workStart&&(!destination||!permittedStages(e.expected).includes(destination)||!stageStarts[e.expected.stage].includes(stageNames[destination])))throw new Error('start-next-stage without scenario permission');
     if(!workStart&&!transition&&!intercepted)throw new Error('next-stage invocation was not intercepted by the driver');
     if(transition) {
      const prior=source.calls.filter(c=>c.name==='mcp__monotest__get_project'&&c.line<invocation).map(c=>resultFor(source.host,c,source.rows)).filter(r=>r.resultLine<invocation).at(-1);
      if(!prior)missing('native prior project state required for transition signal');
      if(idOf(prior.value)!==(request.project?.id??request.project?.uuid))throw new Error('transition project identity changed');
      const state=prior.value.status??prior.value.state;
      if((typeof state==='string'?state:state?.name)===target)throw new Error('saving unchanged project state is not a stage start');
     }
     if(intercepted) {
      const receipt=resultFor(source.host,call,source.rows);
      if(receipt.value.driverIntercepted!==true||receipt.value.stage!==destination||receipt.value.projectId!==input.projectId||input.projectId!==(request.project?.id??request.project?.uuid))throw new Error('stage-driver receipt identity mismatch');
      if(receipt.resultLine>=e.response.line)throw new Error('stage signal after final response');
     }
     observedStarts.push({replyId:e.expected.id,stage:destination??'delivery',line:invocation,kind:intercepted?'intercepted':workStart?'package-start':'project-transition'});
    }
    starts.push({invocation,exchange:e});
   }
   for(const e of source.exchanges??[])if(e.expected.outcome.startNext&&!starts.some(s=>s.exchange===e))throw new Error('expected start-next-stage missing after actual reply');
  }
  let seedEndLine=0;
  if(data&&(request.seedExpected||request.seedEndLine!==undefined)){
   const boundary=data.rows.find(r=>r.line===request.seedEndLine);
   if(!Number.isInteger(request.seedEndLine)||!boundary||data.audit.proof({kind:'terminal',result:boundary.value}).status!=='confirmed')missing('native successful seed boundary missing');
   if(!request.seedProjectId)missing('validated seed project missing');
   if(request.seedProjectId!==(request.project?.id??request.project?.uuid))throw new Error('seed belongs to another project');
   seedEndLine=request.seedEndLine;
  }
  for(const source of scenarios)for(const call of source.calls.filter(c=>isWrite(c.name)&&!c.name.startsWith('mcp__paper__'))){
   if(recoveredUnsavedWrite(source,call))continue;
   const seed=source===data&&call.line<=seedEndLine,write={...resultFor(source.host,call,source.rows,!seed),data:source,seed};
   if(seed&&write.resultLine>seedEndLine)missing('write crosses seed boundary');
   writes.push(write);
  }
  const dump=readRecordDump(request.dumpDir,request.project,request.projectName);
  if(!request.dumpTrace)missing('fresh native dump trace required');
  if(request.dumpTrace){
   const reads=dumps.flatMap(fresh=>fresh.calls.filter(c=>!isWrite(c.name)).flatMap(c=>{
    try{return [{...resultFor(fresh.host,c,fresh.rows),data:fresh}];}
    catch(error){if(error instanceof MissingEvidence)return [];throw error;}
   }));
   const boundaries=writes.length?writes.map(w=>({data:w.data,line:w.resultLine})):scenarios.map(source=>({data:source,line:source.terminal.line}));
   const pageArguments=new Map();
   for(const file of dump.files){
    const scoped=c=>{
     if(file.kind==='list_teams')return isDeepStrictEqual(c.input,{...file.request});
     if(file.id)return Object.values(c.input).some(value=>value===file.id||value===file.alias);
     const scope=file.kind==='list_projects'?request.projectName:file.scope==='.'?(request.project.id??request.project.uuid):(file.scopeId??path.basename(file.scope));
     const key=file.kind==='list_projects'?'query':file.kind==='list_issues'?'project':file.scope==='.'?'projectId':'issueId';
     const value=c.input[key],expected={[key]:value,...file.request};
     if(['list_issues','list_projects'].includes(file.kind))expected.includeArchived=true;
     // Old real dumps omit list_documents' optional archive flag. Both complete
     // forms are accepted, but a cursor chain must retain the same arguments.
     if(file.kind==='list_documents'&&c.input.includeArchived===true)expected.includeArchived=true;
     return (value===scope||(file.scopeAlias!==undefined&&value===file.scopeAlias))&&isDeepStrictEqual(c.input,expected);
    };
    const matches=reads.filter(c=>c.name===`mcp__monotest__${file.kind}`&&(!['list_issues','list_projects'].includes(file.kind)||c.input.includeArchived===true)&&isDeepStrictEqual(c.value,file.value)&&
     scoped(c));
    if(!matches.length)missing(`fresh native read does not bind ${file.file}`);
    const match=matches.find(match=>boundaries.every(boundary=>before(boundary.data,boundary.line,match.data,match)));
    if(!match)missing(`fresh dump read order not proved after scenario writes: ${file.file}`);
    if(file.request){
     const key=`${file.scope}:${file.kind}`,{cursor,...args}=match.input;
     if(pageArguments.has(key)&&!isDeepStrictEqual(pageArguments.get(key),args))missing(`dump page arguments changed: ${file.file}`);
     pageArguments.set(key,args);
    }
   }
  }
  const activeWrites=writes.filter(w=>!w.seed),seedIds=new Set(writes.filter(w=>w.seed).map(w=>idOf(w.value)));
  // Resolve UUID/name aliases only from native reads on the same team.
  const resolveInput=(write,field,value)=>{
   if(!['status','labels'].includes(field))return value;
   if(field==='status'&&/__(?:save|create)_project$/.test(write.name))return value;
   const tool=field==='status'?'list_issue_statuses':'list_issue_labels',aliases=[];
   if(field==='status'){
    const team=dump.issueTeams?.get(idOf(write.value));
    if(!team&&typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))missing('issue team unresolved for exact status UUID');
    if(team){
     const states=dump.statuses?.get(team);
     if(typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)&&!states?.some(state=>state.id===value))missing('exact status UUID unavailable in fresh team dump');
     aliases.push(...(states??[]));
    }
   }
   for(const call of write.data.calls.filter(c=>c.name===`mcp__monotest__${tool}`&&c.line<write.line)){
    if(!write.input.team||call.input.team!==write.input.team)continue;
    const read=resultFor(write.data.host,call,write.data.rows);
    if(read.resultLine>=write.line)continue;
    const rows=Array.isArray(read.value)?read.value:read.value.labels;
    if(Array.isArray(rows))aliases.push(...rows);
   }
   // Updates without a team can use this record's native state history.
   for(const call of write.data.calls.filter(c=>field==='status'&&c.name==='mcp__monotest__get_issue')){
    const read=resultFor(write.data.host,call,write.data.rows);
    if(idOf(read.value)===idOf(write.value))aliases.push(...(read.value.stateHistory??[]).map(row=>row.state));
   }
   const resolve=v=>typeof v==='string'?aliases.find(row=>row.id===v)??v:v;
   return field==='labels'&&Array.isArray(value)?value.map(resolve):resolve(value);
  };
  const fields=['body','content','description','title','name','status','labels'];
  const groups=new Map();
  for(const write of activeWrites){
   const id=idOf(write.value);if(!text(id))missing('write result lacks record id');
   if(!groups.has(id))groups.set(id,[]);groups.get(id).push(write);
  }
  for(const [id,versions] of groups){
   versions.sort((a,b)=>{if(a.data===b.data)return a.line-b.line;if(before(a.data,a.resultLine,b.data,b))return -1;if(before(b.data,b.resultLine,a.data,a))return 1;missing('write ordering across traces is not established');});
   const finalFields={};
   for(const [index,write] of versions.entries()){
    const value=write.value,input={...write.input},next=versions[index+1];
    if(write.name==='mcp__monotest__save_document'&&Object.hasOwn(input,'patch')){
     if(Object.hasOwn(input,'content')||!Array.isArray(input.patch)||!input.patch.length)missing(`invalid document patch for ${id}`);
     let content=finalFields.content;
     const insertionPatch=input.patch.some(edit=>edit?.op==='insert_before'||edit?.op==='insert_after');
     const priorReads=[],previous=versions[index-1];
     for(const source of scenarios)for(const call of source.calls.filter(c=>c.name==='mcp__monotest__get_document')){
      let read;
      try{read={...resultFor(source.host,call,source.rows),data:source};}
      catch(error){if(error instanceof MissingEvidence)continue;throw error;}
      if(idOf(read.value)!==id||typeof read.value.content!=='string'||elided(read.value.content)||!before(source,read.resultLine,write.data,write))continue;
      if(previous&&!before(previous.data,previous.resultLine,source,read))continue;
      if((index===0||insertionPatch)&&!uniquelyBoundNativeStart(source,read)){
       if(insertionPatch)continue;
       missing(`document patch lacks uniquely bound prior content for ${id}`);
      }
      priorReads.push(read);
     }
     if(insertionPatch&&!priorReads.length)missing(`document insert patch lacks bound native prior content for ${id}`);
     if(priorReads.length){
      const latest=priorReads.find(read=>priorReads.every(other=>other===read||before(other.data,other.resultLine,read.data,read)));
      if(!latest)missing(`document patch prior read ordering across traces is not established for ${id}`);
      if(typeof content==='string')compareField('content',content,latest.value.content,id);
      content=latest.value.content;
     }
     if(typeof content!=='string'||elided(content))missing(`document patch lacks full prior content for ${id}`);
     for(const edit of input.patch){
      if(edit?.op==='insert_before'||edit?.op==='insert_after'){
       if(typeof edit.anchor!=='string'||!edit.anchor||typeof edit.text!=='string')missing(`unsupported document patch for ${id}`);
       const start=content.indexOf(edit.anchor);
       if(start<0||content.indexOf(edit.anchor,start+1)>=0)throw new Error(`document patch anchor must match exactly once for ${id}: ${start<0?'missing':'ambiguous'}`);
       const offset=start+(edit.op==='insert_after'?edit.anchor.length:0);
       content=content.slice(0,offset)+edit.text+content.slice(offset);
       continue;
      }
      if(edit?.op!=='replace'||typeof edit.old_string!=='string'||!edit.old_string||typeof edit.new_string!=='string')missing(`unsupported document patch for ${id}`);
      const start=content.indexOf(edit.old_string);
      if(start<0||edit.replace_all!==true&&content.indexOf(edit.old_string,start+1)>=0)throw new Error(`document patch old_string must match ${edit.replace_all===true?'at least':'exactly'} once for ${id}`);
      content=edit.replace_all===true?content.split(edit.old_string).join(edit.new_string):content.slice(0,start)+edit.new_string+content.slice(start+edit.old_string.length);
     }
     input.content=content;
    }
    if(Object.hasOwn(input,'state')){if(Object.hasOwn(input,'status'))compareField('status',input.state,input.status,id);input.status=input.state;}
    for(const field of fields){
     if(Object.hasOwn(input,field)){
      input[field]=resolveInput(write,field,input[field]);
      let confirmation=value;
      if((!Object.hasOwn(confirmation,field)||elided(confirmation[field]))&&next){
       confirmation=null;
       for(const read of write.data.calls.filter(c=>!isWrite(c.name)&&c.line>write.resultLine&&c.line<next.line)){
        try{
         const observed=resultFor(write.data.host,read,write.data.rows);
         if(observed.resultLine>=next.line)continue;
         const candidate=idOf(observed.value)===id?observed.value:(observed.value.comments??observed.value.documents??observed.value.issues??[]).find(row=>idOf(row)===id);
         if(candidate&&Object.hasOwn(candidate,field)&&!elided(candidate[field])){confirmation=candidate;break;}
        }catch{}
       }
       if(!confirmation)missing(`intermediate ${id}.${field} has no linked value or read before the next write`);
      }
      if(confirmation&&Object.hasOwn(confirmation,field)&&!elided(confirmation[field]))compareField(field,input[field],confirmation[field],id);
      finalFields[field]=field==='status'?input[field]:confirmation&&Object.hasOwn(confirmation,field)&&!elided(confirmation[field])?confirmation[field]:input[field];
     }
     if(Object.hasOwn(value,field)&&!elided(value[field])&&!(field==='status'&&Object.hasOwn(input,field)))finalFields[field]=value[field];
    }
   }
   const observed=dump.all.find(row=>idOf(row)===id);if(!observed)throw new Error(`written record missing from fresh dump: ${id}`);
   for(const [field,value]of Object.entries(finalFields))compareField(field,value,observed[field],id);
  }
  for(const rule of request.expectedRecords){
   if(rule.forbidden==='project:create'){
    if(activeWrites.some(w=>w.name.endsWith('__save_project')&&!w.input.id||w.name.endsWith('__create_project')))throw new Error('forbidden project:create');
   }else if(rule.forbidden==='start-next-stage'){
    // Checked across every trace, before missing/partial evidence can hide it.
   }else if(rule.forbidden){
    if(expectedRecords(dump,rule.forbidden).length||activeWrites.some(write=>recordWrite(write,rule.forbidden,dump)))throw new Error(`forbidden record: ${rule.forbidden}`);
   }else if(rule.type==='project'){
    if(!dump.project)missing('project required');
   }else{
    const existingBrief=rule.type==='mono-brief'&&rule.scope==='project';
    const found=expectedRecords(dump,rule.type).filter(row=>existingBrief||!seedIds.has(idOf(row))||activeWrites.some(w=>idOf(w.value)===idOf(row)));
    if(found.length!==(rule.count??1))throw new Error(`expected ${rule.type}: ${rule.count??1}, observed ${found.length}`);
    if(!existingBrief&&!activeWrites.some(w=>idOf(w.value)===idOf(found[0])))missing(`expected ${rule.type} write absent from trace`);
   }
  }
  const bindingGaps=[],approvedExchanges=new Set();
  for(const [index,write]of activeWrites.entries())try{
   const sourceRequest=historical?windowRequest(request,write.data.scenario):{...request,host:write.data.host,sent:write.data.sent};
   for(const exchange of approvalCheck(sourceRequest,write,write.data,dump,activeWrites)??[])approvedExchanges.add(exchange);
  }catch(error){
   if(error.bindingOnly)bindingGaps.push({message:error.message,write});
   else if(historical)requiredChecks.push({id:`approval:${index}`,host:write.data.host,trace:write.data.trace,status:evidenceStatus(error),reason:error.message});
   else throw error;
  }
  const gates=[...(request.gates??[])];
  for(const write of activeWrites){
   const has=type=>recordWrite(write,type,dump);
   const command=has('mono-idea: approved')?'verify':has('mono-tech: approved')?'tech':has('mono-design: approved')?'design':has('mono-prd: approved')||has('mono-package: start')?'route':null;
   if(command&&!gates.some(g=>g.command===command&&(command!=='verify'||g.recordId===idOf(write.value))))gates.push({command,...(command==='verify'?{recordId:idOf(write.value)}:{})});
  }
  const gateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mono-record-gates-'));
  try{
  for(const file of dump.files){const target=path.join(gateRoot,file.file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(file.value));if(file.request)fs.writeFileSync(target.replace(/\.json$/,'.request.json'),JSON.stringify(file.request));}
  for(const gate of gates){
   if(!['route','design','tech','verify'].includes(gate.command))missing('unknown idea-gate command');
   if(gate.command==='design'){
    const approval=activeWrites.find(w=>recordWrite(w,'mono-design: approved',dump));
    if(!approval)missing('mono-design approval write absent from trace');
    const id=writeBody(approval).match(/(?:^|\s)prd=([^\s]+)/)?.[1],doc=dump.documents.find(d=>idOf(d)===id);
    if(!doc)missing('design PRD document absent');fs.writeFileSync(path.join(gateRoot,'prd.json'),JSON.stringify(doc));
   }
   if(gate.command==='tech'){
    const approval=activeWrites.find(w=>recordWrite(w,'mono-tech: approved',dump));
    for(const [token,file] of [['prd','prd.json'],['spec','tech-spec.json']]){
     const id=(bodyOf(approval?.value)??'').match(new RegExp(`(?:^|\\s)${token}=([^\\s]+)`))?.[1];
     const doc=dump.documents.find(d=>idOf(d)===id);if(!doc)missing(`tech ${token} document absent`);
     fs.writeFileSync(path.join(gateRoot,file),JSON.stringify(doc));
    }
   }
   const args=[path.join(request.packRoot,'scripts/idea-gate.mjs'),gate.command,'--dump',gateRoot,'--config',request.configFile];
   if(gate.command==='verify'){
    const record=dump.comments.find(row=>row.id===gate.recordId);if(!record)missing('idea approval record missing');
    const expect=path.join(gateRoot,'expected-idea.md');if(fs.existsSync(expect)){if(fs.readFileSync(expect,'utf8')!==record.body)missing('saved idea expectation changed');}else fs.writeFileSync(expect,record.body,{flag:'wx'});
    args.push('--project',dump.project.uuid,'--expect',expect);
   }else args.push('--mode','fresh');
   const run=spawnSync(process.execPath,args,{encoding:'utf8'});let result;try{result=JSON.parse(run.stdout.trim().split('\n').at(-1));}catch{missing('idea-gate result unreadable');}
   gateResults.push({command:gate.command,exitCode:run.status,result});if(run.status!==0||!result.ok)throw new Error(`idea-gate ${gate.command}: ${result.code}`);
  }
  }finally{fs.rmSync(gateRoot,{recursive:true,force:true});}
  for(const source of scenarios)for(const exchange of source.exchanges??[]) {
   const marker={'idea':'mono-idea: approved','discovery':'mono-prd: approved','design':'mono-design: approved','tech-evaluation':'mono-tech: approved'}[exchange.expected.stage];
   const awaitingBinding=bindingGaps.some(({write})=>write.data===source&&
    source.exchanges.filter(e=>e.replyLine<write.line).at(-1)===exchange&&recordWrite(write,marker,dump));
   if(exchange.expected.outcome.approval&&!approvedExchanges.has(exchange)&&!awaitingBinding)throw new Error('expected approval missing actual record bound to shown version');
  }
  requiredChecks.unshift({id:'records',status:bindingGaps.length?'unverified':'passed',...(bindingGaps.length?{reason:bindingGaps.map(gap=>gap.message).join('; ')}:{})});
  let rubric;
  const rubricRequired=historical||scenarios.some(s=>s.exchanges?.some(e=>anchored(e.expected)));
  if(rubricRequired) {
   const input=historical?windowChecks.filter(source=>source.kind!=='helper').map(source=>({host:source.host,trace:source.trace,traceHash:source.traceHash,definition:source.definition??null,status:source.status,exchanges:source.exchanges??[]})):scenarios.map(source=>({host:source.host,traceHash:sha256(fs.readFileSync(source.trace)),exchanges:(source.exchanges??[]).map(exchange=>({
    ...exchange,presentation:anchored(exchange.expected)&&presentationKind(exchange.expected,(request.presentationBindings??request.approvalBindings??[]).find(b=>b.replyId===exchange.expected.id))==='document'?documentPresentation(source,exchange,(request.presentationBindings??request.approvalBindings??[]).find(b=>b.replyId===exchange.expected.id),dump):null
   }))}));
   const reviewable=!historical||windowChecks.every(source=>source.kind==='helper'||source.exchanges?.length&&text(source.definition));
   rubric=checkRubric({definition:request.rubricDefinition??null,sources:input,bindings:{approvals:request.approvalBindings??[],presentations:request.presentationBindings??[]},records:writes.map(w=>({name:w.name,input:w.input,value:w.value})),dump:dump.all},text(request.rubricDefinition)&&reviewable?request.rubric:undefined);
   requiredChecks.push({id:'rubric',status:rubric.status});
  }
  const status=worstStatus(...requiredChecks.map(c=>c.status));
  const reason=requiredChecks.find(c=>c.status===status&&c.reason)?.reason;
  return {...(rubric??{}),status,requiredChecks,...(windowChecks.length?{windowChecks}:{}),...(bindingGaps.length?{bindingOnly:true}:{}),...(reason?{reason}:{}),starts:observedStarts,stop:false,manualRemoval:[],monotestTasks:dump.issues.length,taskIds:dump.issues.map(idOf),writes:writes.length,gateResults,evidence:[request.trace,request.dumpDir]};
 }catch(error){
  const status=worstStatus(evidenceStatus(error),...requiredChecks.map(c=>c.status)),reasons=[...new Set([...requiredChecks.filter(c=>c.status===status&&c.reason).map(c=>c.reason),error.message])];
  return {status,requiredChecks,...(windowChecks.length?{windowChecks}:{}),starts:observedStarts,stop:false,manualRemoval:[],reason:reasons[0],reasons,...(error.bindingOnly?{bindingOnly:true}:{}),gateResults,evidence:[request.trace,request.dumpDir]};
 }
}

export function dumpPrompt({project,projectName,dumpDir}){
 return `Фиксированный дамп monotest в ${dumpDir}. Скрипт задаёт каждый вызов и сам сохраняет сырой результат: ${project?'project; comments-N.json; documents/<id>.json; issues/<id>/issue.json со status и labels; все comments задач':'полный list_projects с точным именем '+JSON.stringify(projectName)}. Для страниц comments-N.request.json: {} первой, затем cursor. Не выбирай чтения и не записывай файлы: драйвер пришлёт точный запрос каждого хода.`;
}
export async function collectRecordDump(request,execute=runScenario){
 if(!request.mcpServers?.monotest||Object.keys(request.mcpServers).some(k=>k!=='monotest'))throw new Error('record dump uses only monotest');
 const attempts=[];
 for(let attempt=0;attempt<2;attempt++){
  const outputDir=attempt?request.outputDir+'-retry-1':request.outputDir,dumpDir=path.join(outputDir,'dump');
  const result=await execute({...request,outputDir,seed:undefined,writableRoots:[outputDir],readOnlyDump:true,recordDump:{dumpDir,project:request.project,projectName:request.projectName},workspaceProof:{tool:'mcp__monotest__get_workspace',input:{},path:['name'],equals:'Mono Test'},
   scenario:{prompt:dumpPrompt({project:request.project,projectName:request.projectName,dumpDir}),brief:'Fixed read-only monotest dump',windows:[],expectedWindows:[]}});
  attempts.push({...result,outputDir,dumpDir});
  const violation=runViolations([result.trace,...(result.auditedTraces??[]).filter(trace=>trace!==result.trace)].filter(Boolean).map(trace=>({host:request.host,trace})),{...request.recordRules,readOnlyDump:true});
  if(violation)return {...result,...violation,dumpDir,attempts};
  if(result.status!=='unverified'||!result.hostFailure||attempt===1)return {...result,dumpDir,attempts};
 }

}
// Save the native inputs, not a fresh run recipe. Review may add only a rubric;
// every file used by the verifier stays bound to the original capture.
function evidenceFiles(request) {
 const files=new Map();
 const capture=file=>{
  if(!file)return;
  if(!fs.existsSync(file)){files.set(file,null);return;}
  const stat=fs.lstatSync(file);
  if(stat.isDirectory()) {
   files.set(file,fs.readdirSync(file).sort());
   for(const name of fs.readdirSync(file).sort())capture(path.join(file,name));
  } else if(stat.isFile())files.set(file,sha256(fs.readFileSync(file)));
  else throw new Error('saved evidence must contain regular files and directories');
 };
 capture(request.dumpDir);capture(request.configFile);
 for(const file of [request.trace,request.sent,request.dumpTrace,...(request.additionalTraces??[]).flatMap(t=>[t.trace,t.sent]),...(request.dumpAdditionalTraces??[]).map(t=>t.trace),...(request.approvalBindings??[]).map(b=>b.ownerEvidence?.trace)].filter(Boolean)) {
  capture(file);capture(path.join(path.dirname(file),'result.json'));
 }
 return [...files];
}
export function resumeScenarioRecords({resumeEvidence,bindingsFile,prepareReview=false}) {
 const saved=read(resumeEvidence),{digest,...payload}=saved;
 if(digest!==rubricDigest(payload)||JSON.stringify(evidenceFiles(saved.request))!==JSON.stringify(saved.files))throw new Error('saved evidence changed; resume refused');
 const bindings=bindingsFile?read(bindingsFile):{};
 // Explicit preparation always invalidates the old judgment when annotations
 // are added or changed. It never accepts a rubric or starts another stage.
 if(prepareReview) {
  const request={...saved.request,...Object.fromEntries(['approvalBindings','presentationBindings','gates'].filter(key=>bindings[key]!==undefined).map(key=>[key,bindings[key]]))};
  delete request.rubric;
  const result=verifyRecords(request),reviewEvidence=resumeEvidence+'.prepared.json';
  const prepared={request,files:evidenceFiles(request),rubricDigest:result.rubricDigest??null,rubricInput:result.rubricInput??null};
  fs.writeFileSync(reviewEvidence,JSON.stringify({...prepared,digest:rubricDigest(prepared)},null,2)+'\n',{flag:'wx'});
  return {...result,reviewEvidence};
 }
 for(const key of ['approvalBindings','presentationBindings','gates'])if(bindings[key]!==undefined&&!isDeepStrictEqual(bindings[key],saved.request[key]))throw new Error('saved bindings changed; resume refused');
 const result=verifyRecords({...saved.request,rubric:bindings.rubric??saved.request.rubric});
 if((result.rubricDigest??null)!==(saved.rubricDigest??null))throw new Error(saved.rubricDigest?'saved rubric digest changed; resume refused':'review preparation required: no saved rubric digest');
 return {...result,reviewEvidence:resumeEvidence};
}
export async function verifyScenarioRecords({run,runRequest,scenario,project,outputDir,bindingsFile,resumeEvidence,prepareReview=false},collect=collectRecordDump){
 if(resumeEvidence)return resumeScenarioRecords({resumeEvidence,bindingsFile,prepareReview});
 const start=Date.now();
 const traces=(run.auditedTraces??[]).filter(trace=>trace!==run.trace).map(trace=>({host:runRequest.host,trace}));
 const next=runRequest.context.followingStage??scenario.next;
 const rules={expectedRecords:scenario.expectedRecords,nextSkill:next?`${runRequest.context.skillPrefix}:${next}`:null,nextAgent:next?`${runRequest.context.skillPrefix}-${runRequest.context.skillPrefix}-${next}`:null};
 const violation=runViolations([{host:runRequest.host,trace:run.trace,endLine:run.endLine},...traces],rules);if(violation)return {...violation,durationMs:Date.now()-start};
 const dump=await collect({...runRequest,project,projectName:runRequest.context.projectName,outputDir,recordRules:rules,mcpServers:{monotest:runRequest.mcpServers.monotest}});
 for(const attempt of dump.attempts??[dump])if(attempt.trace){
  const violation=runViolations([{host:runRequest.host,trace:attempt.trace},...(attempt.auditedTraces??[]).filter(trace=>trace!==attempt.trace).map(trace=>({host:runRequest.host,trace}))],{...rules,readOnlyDump:true});
  if(violation)return {...violation,attempts:dump.attempts,durationMs:Date.now()-start};
 }
 if(dump.status!=='passed')return {...dump,status:dump.status==='failed'?'failed':'unverified',durationMs:Date.now()-start};
 const bindings=bindingsFile&&fs.existsSync(bindingsFile)?read(bindingsFile):{};
 const verification={host:runRequest.host,testedVersion:run.testedVersion??runRequest.testedVersion,trace:run.trace,endLine:run.endLine,stageStartLine:run.stageStartLine,sent:run.sent,seedExpected:Boolean(runRequest.seed),seedEndLine:run.seedEndLine,seedProjectId:run.seedRoute?.project?.id,dumpDir:dump.dumpDir,dumpTrace:dump.trace,additionalTraces:traces,dumpAdditionalTraces:(dump.auditedTraces??[]).filter(trace=>trace!==dump.trace).map(trace=>({host:runRequest.host,trace})),
  idleContinuation:runRequest.scenario?.idleContinuation,expectedReplies:runRequest.scenario?.expectedReplies,expectedWindows:runRequest.scenario?.expectedWindows,windows:runRequest.scenario?.windows,rubricDefinition:runRequest.scenario?.rubricDefinition,approvalBindings:bindings.approvalBindings,presentationBindings:bindings.presentationBindings,rubric:bindings.rubric,gates:bindings.gates,project,projectName:runRequest.context.projectName,expectedRecords:scenario.expectedRecords,nextStage:next,nextSkill:rules.nextSkill,nextAgent:rules.nextAgent,packRoot:runRequest.packRoot,configFile:path.join(runRequest.cwd,'.agents/mono-workflow.config.json')};
 const result=verifyRecords(verification),reviewEvidence=outputDir+'-evidence.json';
 const payload={request:verification,files:evidenceFiles(verification),rubricDigest:result.rubricDigest??null,rubricInput:result.rubricInput??null};
 fs.writeFileSync(reviewEvidence,JSON.stringify({...payload,digest:rubricDigest(payload)},null,2)+'\n',{flag:'wx'});
 return {...result,reviewEvidence,durationMs:Date.now()-start};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const result=verifyRecords(read(process.argv[2]));console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:result.status==='failed'?1:2;}
 catch(error){console.error(error.message);process.exitCode=2;}
}
