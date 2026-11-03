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
import { completedTrace, textExchanges, checkEndings } from './skills-trace.mjs';
import { auditRows } from './skills-audit.mjs';
import { isWrite, MissingEvidence } from './skills-boundary.mjs';
import { unwrap } from './skills-proof.mjs';
import { runScenario } from './skills-run.mjs';
import { nativeRecords, resultFor } from './skills-record-data.mjs';
import { windowRole, correctedVersion, isOwnerWindow } from './skills-owner.mjs';
import { latestApproval, approvalBlocks } from './idea-gate.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const rawRead=file=>{try{return unwrap(read(file));}catch(error){missing(error.code==='ENOENT'?`incomplete dump: missing ${path.basename(file)}`:`error MCP dump: ${file}`);}};
const text=value=>typeof value==='string'&&value.trim().length>0;
const ownUrl=url=>typeof url==='string'&&url.startsWith('https://linear.app/monotest/');
const idOf=row=>row?.uuid??row?.id;
const bodyOf=row=>row?.body??row?.content??row?.description;
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
// Linear's observed block spacing, link wrappers and list markers. Preserve
// paragraph boundaries, code and all substantive bytes.
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
  // Inline code is opaque too; unrecognized formatting stays unequal.
  const list=literal?line:line.replace(/^([ ]{0,3})- /,'$1* ');
  result.push(literal||line.includes('`')?list:list.replace(/\[([^\]\n]+)\]\(<(https?:\/\/[^>\s]+)>\)/g,'[$1]($2)').replace(/\[(https?:\/\/[^\]\s]+)\]\(\1\)/g,'$1'));
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
   const identities=identityValues(value),index=observed.findIndex(row=>identityValues(row).some(v=>identities.includes(v)));
   if(index<0){if(identities.some(v=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v))&&observed.some(row=>typeof row==='string'))unresolved=true;return false;}
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
 const projectComments=pages(root,'comments','comments',files),comments=[...projectComments],documents=[],issues=[];
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
  issues.push(issue);files.push({file,value:issue,kind:'get_issue',id,alias});
  const start=files.length;comments.push(...pages(root,`issues/${directory}/comments`,'comments',files));
  for(const file of files.slice(start)){file.scopeId=id;file.scopeAlias=alias;}
 }
 const all=[raw,...comments,...documents,...issues];
 for(const row of all)if(row.url!==undefined&&!ownUrl(row.url))throw new Error(`record outside monotest: ${row.url}`);
 return {project:raw,projectComments,comments,documents,issues,all,files};
}

function recordLines(body){
 // Stage gates read whole marker lines, excluding embedded snapshot/page text.
 return approvalBlocks(body).filter(block=>!['mono-idea-snapshot','mono-tech-page'].includes(block.info))
  .flatMap(block=>(block.fenced?block.content:block.text).split(/\r?\n/));
}
function recordCount(body,type){
 if(type==='mono-research')return approvalBlocks(body).filter(block=>block.info==='mono-research').length;
 const markers=['mono-idea: approved','mono-prd: approved','mono-design: approved','mono-tech: approved','mono-package: start'];
 type=markers.find(marker=>marker.split(':')[0]===type)??type;
 return recordLines(body)
  .filter(line=>{line=type.startsWith('mono-idea')?line:line.trim();return (type.includes(':')&&line===type)||line.startsWith(type+(type.includes(':')?' ':': '));}).length;
}
function expectedRecords(dump,type,body=row=>bodyOf(row)){
 const rows=type==='mono-research'?dump.documents:dump.projectComments;
 return rows.flatMap(row=>Array.from({length:recordCount(body(row),type)},()=>row));
}

function recordWrite(write,type,dump){
 return expectedRecords(dump,type,row=>idOf(row)===idOf(write.value)?writeBody(write):'').length>0;
}

function runViolations(traces,request={}){
 const manualRemoval=new Set(),evidence=[],transitions=[],dumpWrites=[];
 for(const {host,trace,endLine} of traces){
  let data;
  try{data=nativeRecords(host,trace);}catch{
    const rows=readJsonLines(trace,{errorLines:true}).events,calls=[];
    for(const row of rows)try{calls.push(...auditRows(host,[row]).calls.filter(c=>c.name.startsWith('mcp__')));}catch{}
    data={rows,calls,audit:{calls:rows.flatMap(row=>{try{return auditRows(host,[row]).calls;}catch{return [];}})}};
  }
  if(request.expectedRecords?.some(rule=>rule.forbidden==='start-next-stage'))for(const call of data.audit.calls)
   if((call.name==='Skill'&&request.nextSkill&&call.input?.skill===request.nextSkill)||(['Agent','Task'].includes(call.name)&&request.nextAgent&&call.input?.subagent_type===request.nextAgent))transitions.push(`${trace}:${call.line}: forbidden start-next-stage`);
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
 return evidence.length?{status:'failed',stop:true,manualRemoval:[...manualRemoval],evidence,reason:'MCP write outside monotest: stopped; manual removal only for linked successful record URLs; no deletion attempted'}:transitions.length?{status:'failed',stop:false,manualRemoval:[],evidence:transitions,reason:'forbidden start-next-stage'}:dumpWrites.length?{status:'failed',stop:false,manualRemoval:[],evidence:dumpWrites,reason:'record dump permits monotest reads only'}:null;
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
function before(left,line,right,call){
 const startLine=call.event.type==='event_msg'?call.invocationLine:call.line;
 if(fs.realpathSync(left.trace)===fs.realpathSync(right.trace)&&Number.isInteger(startLine))return line<startLine;
 const end=traceTime(left,line),start=traceTime(right,startLine,true);
 return Number.isFinite(end)&&Number.isFinite(start)&&end<start;
}

const sha256=value=>createHash('sha256').update(value).digest('hex');
function versionApproval(write){
 const body=writeBody(write),schemas=[
  ['mono-prd: approved',['project','document','updatedAt','by'],['next','design']],
  ['mono-design: approved',['project','prd','prd-updatedAt','paper','images','next','by'],[]],
  ['mono-tech: approved',['project','prd','prd-updatedAt','spec','spec-sha256','page-sha256','by'],['design']],
  ['mono-package: start',['project','record','sha256','issues','by'],['research']]
 ];
 const records=schemas.flatMap(([kind,required,optional])=>{
  const record=latestApproval([{...write.value,body}],kind,required,optional);return record?[{kind,...record}]:[];
 });
 if(records.length!==1)throw new Error('written approval does not bind the shown content/version');
 return records[0];
}
function bindsSnapshot(body,info,text){
 const snapshots=approvalBlocks(body).filter(block=>block.info===info);
 return snapshots.length===1&&snapshots[0].content.replace(/[\r\n]+$/,'')===text.replace(/[\r\n]+$/,'');
}
function approvalCheck(request,write,data,dump){
 const createProject=write.name.endsWith('__create_project')||(write.name.endsWith('__save_project')&&!write.input.id);
 const markers=recordLines(writeBody(write)).map(line=>line.trim().match(/^(mono-[\w-]+: (?:approved|start))(?: |$)/)?.[1]).filter(Boolean);
 if(!createProject&&!markers.some(type=>recordWrite(write,type,dump)))return;
 const packageStart=recordWrite(write,'mono-package: start',dump);
 const binding=request.approvalBindings?.find(b=>b.recordId===idOf(write.value));
 if(data.expectedReplies) return textApprovalCheck(request,write,data,dump,{createProject,packageStart,binding});
 const candidates=data.audit.calls.filter(c=>['AskUserQuestion','request_user_input_async'].includes(c.name)&&c.line<write.line);
 const decisions=candidates.filter(c=>windowRole(c.input?.questions)===(packageStart?'transition':'approval'));
 const window=binding?candidates.find(c=>c.callId===binding.windowCallId):decisions.at(-1);
 if(!window)missing('approval window missing');
 if(window!==decisions.at(-1))throw new Error('approval binding does not name the latest decision window');
 // Codex sent.jsonl is the driver's {thread,prompt} journal, not a native
 // event stream. Its delivered answer is proved from the resumed rollout.
 const responses=request.host==='claude'&&request.sent?traceRows(request.sent,'claude').rows.map(r=>r.value):[];
 const accepted=data.audit.windowProof(window.event,window.line,window.callId,{responses});
 if(accepted.status!=='confirmed')missing('native approval reply missing');
 const after=data.rows.filter(r=>r.line>window.line);
 const reply=request.host==='claude'?after.find(r=>r.value.type==='user'&&r.value.message?.content?.some?.(b=>b.type==='tool_result'&&b.tool_use_id===window.callId))
  :after.find(r=>r.value.type==='response_item'&&r.value.payload?.type==='message'&&r.value.payload.role==='user');
 if(!reply)missing('approval reply line missing');
 let answers;
 if(request.host==='claude'){
  const permission=after.find(r=>r.value.type==='control_request'&&r.value.request?.tool_name==='AskUserQuestion');
  const sent=responses.find(r=>r.response?.request_id===permission?.value.request_id)?.response?.response;
  answers=sent?.behavior==='allow'?Object.values(sent.updatedInput?.answers??{}):[];
 }else{
  const content=reply.value.payload.content?.[0]?.text??'';
  try{answers=JSON.parse(content.replace(/^<send_user_message_question_reply>\n/,'').replace(/\n<\/send_user_message_question_reply>\n?$/,'')).map(a=>a.answer);}catch{answers=[];}
 }
 const authorizes=answer=>packageStart?/^(?:Начать работу|Передать оркестратору)(?: \(Recommended\))?$/.test(answer):/^Утвердить(?:[ ,]|$)/.test(answer);
 if(!answers.length||answers.some(answer=>!authorizes(answer)))throw new Error('approval write after empty/refuse/discuss/non-approval reply');
 if(write.line<=reply.line)throw new Error('approval write before window answer');
 if(!binding)bindingMissing(`shown-version binding missing for ${idOf(write.value)}`);
 const ownerText=row=>request.host==='claude'?row.value.type==='assistant'&&row.value.message?.content?.some(b=>b.type==='text'&&text(b.text))
  :row.value.payload?.type==='message'&&row.value.payload.role==='assistant'&&row.value.payload.content?.some(b=>b.type==='output_text'&&text(b.text));
 const shown=data.rows.find(r=>r.line===binding.shownLine),current=data.rows.find(r=>r.line===binding.currentLine);
 const shownText=request.host==='claude'?shown?.value.message?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')
  :shown?.value.payload?.role==='assistant'?shown.value.payload.content?.filter(b=>b.type==='output_text').map(b=>b.text).join('\n'):null;
 if(!text(binding.text)||!shownText||binding.shownLine>=reply.line||(request.host==='claude'&&binding.shownLine>=window.line))missing('shown version not found in owner-visible trace');
 if(request.host==='codex'){
  const terminal=data.rows.find(r=>r.line>window.line&&r.line<reply.line&&data.audit.proof({kind:'terminal',result:r.value}).status==='confirmed');
  if(!terminal||binding.shownLine<=window.line||binding.shownLine>=terminal.line)missing('shown version outside approved Codex window turn');
  if(data.rows.findLast(r=>r.line<terminal.line&&ownerText(r))?.line!==binding.shownLine)throw new Error('approval does not bind the last owner-visible text');
 }else if(data.rows.findLast(r=>r.line<window.line&&ownerText(r))?.line!==binding.shownLine)throw new Error('approval does not bind the last owner-visible text');
 return checkApprovedVersion({request,write,data,dump,createProject,packageStart,binding,shownText,reply,shownLimit:window.line});
}
function checkApprovedVersion({request,write,data,dump,createProject,packageStart,binding,shownText,reply,shownLimit,approvedText=binding.text,corrected=false}) {
 let shownVersion;
 if(!shownText.includes(binding.text)||binding.shownReadLine!==undefined){
  const before=data.audit.calls.find(c=>c.line===binding.shownReadLine&&!isWrite(c.name));
  if(!before||before.line>=shownLimit)missing('shown version not found in owner-visible trace');
  const read=resultFor(request.host,before,data.rows);
  if(read.resultLine>=shownLimit||read.resultLine>=binding.shownLine||(binding.documentId&&idOf(read.value)!==binding.documentId)||!text(idOf(read.value))||
   (!shownText.includes(binding.text)&&(!text(read.value.url)||!shownText.includes(read.value.url)))||bodyOf(read.value)!==binding.text)missing('shown document link/version not bound to native read');
  shownVersion=read.value;
 }
 if(binding.currentLine===write.line&&/mono-(?:idea|tech):\s*approved/.test(writeBody(write))){
  const info=writeBody(write).includes('mono-idea: approved')?'mono-idea-snapshot':'mono-tech-page';
  if(!bindsSnapshot(writeBody(write),info,approvedText))throw new Error('outgoing approved version differs from shown content');
  return; // idea-gate below independently checks the snapshot against persisted current data.
 }
 if(createProject){
  if(markdown(write.input.description??write.value.description)!==markdown(approvedText))throw new Error('created project differs from shown version');
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
 if(shownVersion&&!corrected&&shownVersion.updatedAt!==fresh.updatedAt)throw new Error('version changed after shown approval');
 if(shownVersion&&idOf(shownVersion)!==idOf(fresh))throw new Error('approved document changed');
 if(bodyOf(fresh)!==approvedText)throw new Error('version changed after shown approval');
 if(binding.documentId&&idOf(fresh)!==binding.documentId)throw new Error('approved document changed');
 const persisted=dump.all.find(row=>idOf(row)===idOf(fresh));
 if(!persisted||bodyOf(persisted)!==approvedText||persisted.updatedAt!==fresh.updatedAt)throw new Error('approved version changed before final read-back');
 if(binding.documentId&&!Number.isFinite(date(fresh.updatedAt)))missing('approved document version timestamp missing');
 if(!Number.isInteger(invocation))bindingMissing('approval write invocation not proved by native trace');
}

function textApprovalCheck(request,write,data,dump,{createProject,packageStart,binding}) {
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
 const approvedText=correctedVersion(binding.text,expected),body=writeBody(write);
 const prose=approvalBlocks(body).filter(b=>!b.fenced).map(b=>b.text).join('\n').split(/\r?\n/);
 if(!createProject) {
  const quotedReply=expected.by==='orchestrator'&&expected.stage==='idea'?binding.ownerEvidence?.reply:expected.reply;
  const ownerProse='\n'+prose.join('\n')+'\n';
  if(ownerProse.split('Владелец: ответил ').length!==2||!ownerProse.includes(`\nВладелец: ответил «${quotedReply}»\n`))throw new Error('verbatim owner reply missing or substituted outside fences');
  const corrections=prose.filter(line=>line.startsWith('Поправка:'));
  if(expected.correction?corrections.length!==1||corrections[0]!==`Поправка: ${expected.correction.description}`:corrections.length)throw new Error('record correction differs from named correction');
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
 }
 return checkApprovedVersion({request,write,data,dump,createProject,packageStart,binding,shownText:exchange.text,reply:{line:exchange.replyLine},shownLimit:exchange.line,approvedText,corrected:Boolean(expected.correction)});
}

export function verifyRecords(request){
 const gateResults=[];
 const scenarioTraces=[{host:request.host,trace:request.trace,endLine:request.endLine,stageStartLine:request.stageStartLine,sent:request.sent},...(request.additionalTraces??[])];
 const dumpTraces=[...(request.dumpTrace?[{host:request.host,trace:request.dumpTrace}]:[]),...(request.dumpAdditionalTraces??[])];
 const traces=[...scenarioTraces,...dumpTraces];
 try{
  const violation=runViolations(traces,request);if(violation)return violation;
  const load=(source,dump)=>{
   const full=nativeRecords(source.host,source.trace),data=nativeRecords(source.host,source.trace,!dump&&(source.expectedReplies??request.expectedReplies)?undefined:source.endLine);
   data.sent=source.sent;
   if(dump&&full.calls.some(c=>isWrite(c.name)))throw new Error('dump attempted an external write');
   if(source.endLine!==undefined&&full.calls.some(c=>c.line>source.endLine&&isWrite(c.name)))throw new Error('write after scenario terminal');
   if(!completedTrace(source.host,data.rows))missing(`${dump?'dump':'scenario'} trace incomplete: ${source.trace}`);
   data.terminal=data.rows.findLast(r=>!r.value.parent_tool_use_id&&data.audit.proof({kind:'terminal',result:r.value}).status==='confirmed');
   if(data.calls.some(c=>c.line>data.terminal.line&&isWrite(c.name)))throw new Error('write after scenario terminal');
   if(data.calls.some(c=>c.line>data.terminal.line))missing('call after successful trace terminal');
   let previous=-Infinity;for(const row of data.rows)if(row.value.timestamp!==undefined){const stamp=date(row.value.timestamp);if(!Number.isFinite(stamp)||stamp<previous)missing('invalid or reversed native trace time order');previous=stamp;}
   data.expectedReplies=dump?undefined:source.expectedReplies??request.expectedReplies;
   if(data.expectedReplies) {
    if(data.audit.calls.some(c=>isOwnerWindow(c.name)))throw new Error('stage called a window in text scenario');
    data.exchanges=textExchanges(source.host,data.rows,data.expectedReplies,{startLine:source.stageStartLine});
   }
   return data;
  };
  const scenarios=scenarioTraces.map(source=>load(source,false)),dumps=dumpTraces.map(source=>load(source,true)),data=scenarios[0],writes=[];
  request={...request,scenarioData:scenarios};
  checkEndings(scenarios.flatMap(d=>d.exchanges??[]));
  const stageStarts={idea:['Research'],research:['Discovery'],discovery:['Design','Tech Evaluation','Handoff'],design:['Tech Evaluation','Handoff'],'tech-evaluation':['Handoff'],handoff:['Delivery']};
  for(const source of scenarios)if(source.expectedReplies) {
   const starts=[];
   for(const call of source.audit.calls) {
    const status=call.input?.state??call.input?.status;
    const next=(call.name==='Skill'&&request.nextSkill&&call.input?.skill===request.nextSkill)||(['Agent','Task'].includes(call.name)&&request.nextAgent&&call.input?.subagent_type===request.nextAgent);
    const stage=source.expectedReplies[0].stage;
    const transition=/__(?:save|create)_project$/.test(call.name)&&stageStarts[stage].includes(typeof status==='string'?status:status?.name);
    const workStart=recordLines(bodyOf(call.input)??'').some(line=>line.trim().startsWith('mono-package: start '));
    if(!next&&!transition&&!workStart)continue;
    const invocation=call.event.type==='event_msg'?call.approvalInvocationLine:call.line;
    if(!Number.isInteger(invocation))missing('start invocation not proved by native trace');
    const e=source.exchanges.filter(e=>e.replyLine<invocation).at(-1);
    if(!e?.expected.outcome.startNext)throw new Error('start-next-stage without scenario authority');
    starts.push({invocation,exchange:e});
   }
   for(const e of source.exchanges)if(e.expected.outcome.startNext&&!starts.some(s=>s.exchange===e))throw new Error('expected start-next-stage missing after actual reply');
  }
  let seedEndLine=0;
  if(request.seedExpected||request.seedEndLine!==undefined){
   const boundary=data.rows.find(r=>r.line===request.seedEndLine);
   if(!Number.isInteger(request.seedEndLine)||!boundary||data.audit.proof({kind:'terminal',result:boundary.value}).status!=='confirmed')missing('native successful seed boundary missing');
   if(!request.seedProjectId)missing('validated seed project missing');
   if(request.seedProjectId!==(request.project?.id??request.project?.uuid))throw new Error('seed belongs to another project');
   seedEndLine=request.seedEndLine;
  }
  for(const source of scenarios)for(const call of source.calls.filter(c=>isWrite(c.name)&&!c.name.startsWith('mcp__paper__'))){
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
      finalFields[field]=input[field];
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
    const found=expectedRecords(dump,rule.type).filter(row=>!seedIds.has(idOf(row))||activeWrites.some(w=>idOf(w.value)===idOf(row)));
    if(found.length!==(rule.count??1))throw new Error(`expected ${rule.type}: ${rule.count??1}, observed ${found.length}`);
    if(!activeWrites.some(w=>idOf(w.value)===idOf(found[0])))missing(`expected ${rule.type} write absent from trace`);
   }
  }
  const bindingGaps=[];
  for(const write of activeWrites)try{approvalCheck({...request,host:write.data.host,sent:write.data.sent},write,write.data,dump);}catch(error){if(!error.bindingOnly)throw error;bindingGaps.push(error.message);}
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
  return {status:bindingGaps.length?'unverified':'passed',...(bindingGaps.length?{bindingOnly:true,reason:bindingGaps.join('; ')}:{}),stop:false,manualRemoval:[],monotestTasks:dump.issues.length,taskIds:dump.issues.map(idOf),writes:writes.length,gateResults,evidence:[request.trace,request.dumpDir]};
 }catch(error){return {status:error instanceof MissingEvidence||error instanceof SyntaxError||['ENOENT','ENOTDIR'].includes(error.code)?'unverified':'failed',stop:false,manualRemoval:[],reason:error.message,...(error.bindingOnly?{bindingOnly:true}:{}),gateResults,evidence:[request.trace,request.dumpDir]};}
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
export async function verifyScenarioRecords({run,runRequest,scenario,project,outputDir,bindingsFile},collect=collectRecordDump){
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
 const result=verifyRecords({host:runRequest.host,trace:run.trace,endLine:run.endLine,stageStartLine:run.stageStartLine,sent:run.sent,seedExpected:Boolean(runRequest.seed),seedEndLine:run.seedEndLine,seedProjectId:run.seedRoute?.project?.id,dumpDir:dump.dumpDir,dumpTrace:dump.trace,additionalTraces:traces,dumpAdditionalTraces:(dump.auditedTraces??[]).filter(trace=>trace!==dump.trace).map(trace=>({host:runRequest.host,trace})),
  expectedReplies:runRequest.scenario?.expectedReplies,approvalBindings:bindings.approvalBindings,gates:bindings.gates,project,projectName:runRequest.context.projectName,expectedRecords:scenario.expectedRecords,nextStage:next,nextSkill:rules.nextSkill,nextAgent:rules.nextAgent,packRoot:runRequest.packRoot,configFile:path.join(runRequest.cwd,'.agents/mono-workflow.config.json')});
 return {...result,durationMs:Date.now()-start};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const result=verifyRecords(read(process.argv[2]));console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:result.status==='failed'?1:2;}
 catch(error){console.error(error.message);process.exitCode=2;}
}
