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
import { completedTrace } from './skills-trace.mjs';
import { auditRows } from './skills-audit.mjs';
import { isWrite, MissingEvidence } from './skills-boundary.mjs';
import { unwrap } from './skills-proof.mjs';
import { runScenario } from './skills-run.mjs';
import { nativeRecords, resultFor } from './skills-record-data.mjs';
import { windowRole } from './skills-owner.mjs';
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
  if(!literal&&heading&&line===''){heading=false;continue;}
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
 if(!fence&&result.at(-1)==='')result.pop();
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
  return {project:null,comments:[],documents:[],issues:[],all:[],files};
 }
 const raw=rawRead(path.join(root,'project.json')),files=[{file:'project.json',value:raw,kind:'get_project',id:project.id??project.uuid}];
 if(!text(raw?.uuid)||raw.uuid!==(project.id??project.uuid)||raw.name!==project.name||!ownUrl(raw.url)||(typeof raw.description!=='string'||elided(raw.description)))missing('project read-back identity incomplete');
 const comments=pages(root,'comments','comments',files),documents=[],issues=[];
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
 return {project:raw,comments,documents,issues,all,files};
}

function productionWrites(traces){
 const manualRemoval=new Set(),evidence=[];
 for(const {host,trace,endLine} of traces){
  let data;
  try{data=nativeRecords(host,trace);}catch{
    const rows=readJsonLines(trace,{errorLines:true}).events,calls=[];
    for(const row of rows)try{calls.push(...auditRows(host,[row]).calls.filter(c=>c.name.startsWith('mcp__')));}catch{}
    data={rows,calls};
  }
  for(const call of data.calls){
   if(!isWrite(call.name)||call.name.startsWith('mcp__paper__'))continue;
   let record;try{record=resultFor(host,call,data.rows,false);}catch{}
   const links=[record?.value?.url,...['comment','issue','project','document'].map(key=>record?.value?.[key]?.url)].filter(url=>typeof url==='string'&&url.startsWith('https://linear.app/'));
   const outside=links.filter(url=>!ownUrl(url));
   if(!call.name.startsWith('mcp__monotest__')||outside.length){
    outside.forEach(url=>manualRemoval.add(url));evidence.push(`${trace}:${call.line}: write outside monotest: ${call.name}`);
   }
  }
 }
 return evidence.length?{status:'failed',stop:true,manualRemoval:[...manualRemoval],evidence,reason:'MCP write outside monotest: stopped; manual removal only for linked successful record URLs; no deletion attempted'}:null;
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
 if(!createProject&&!/mono-[\w-]+:\s*(?:approved|start)\b/.test(writeBody(write)))return;
 const packageStart=/mono-package:\s*start\b/.test(writeBody(write));
 const binding=request.approvalBindings?.find(b=>b.recordId===idOf(write.value));
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
 const shown=data.rows.find(r=>r.line===binding.shownLine),current=data.rows.find(r=>r.line===binding.currentLine);
 const shownText=request.host==='claude'?shown?.value.message?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')
  :shown?.value.payload?.role==='assistant'?shown.value.payload.content?.filter(b=>b.type==='output_text').map(b=>b.text).join('\n'):null;
 if(!text(binding.text)||!shownText||binding.shownLine>=reply.line||(request.host==='claude'&&binding.shownLine>=window.line))missing('shown version not found in owner-visible trace');
 if(request.host==='codex'){
  const terminal=data.rows.find(r=>r.line>window.line&&r.line<reply.line&&data.audit.proof({kind:'terminal',result:r.value}).status==='confirmed');
  if(!terminal||binding.shownLine<=window.line||binding.shownLine>=terminal.line)missing('shown version outside approved Codex window turn');
 }
 let shownVersion;
 if(!shownText.includes(binding.text)||binding.shownReadLine!==undefined){
  const before=data.audit.calls.find(c=>c.line===binding.shownReadLine&&!isWrite(c.name));
  if(!before||before.line>=window.line)missing('shown version not found in owner-visible trace');
  const read=resultFor(request.host,before,data.rows);
  if(read.resultLine>=window.line||read.resultLine>=binding.shownLine||(binding.documentId&&idOf(read.value)!==binding.documentId)||!text(idOf(read.value))||
   (!shownText.includes(binding.text)&&(!text(read.value.url)||!shownText.includes(read.value.url)))||bodyOf(read.value)!==binding.text)missing('shown document link/version not bound to native read');
  shownVersion=read.value;
 }
 if(binding.currentLine===write.line&&/mono-(?:idea|tech):\s*approved/.test(writeBody(write))){
  const info=writeBody(write).includes('mono-idea: approved')?'mono-idea-snapshot':'mono-tech-page';
  if(!bindsSnapshot(writeBody(write),info,binding.text))throw new Error('outgoing approved version differs from shown content');
  return; // idea-gate below independently checks the snapshot against persisted current data.
 }
 if(createProject){
  if(markdown(write.input.description??write.value.description)!==markdown(binding.text))throw new Error('created project differs from shown version');
  return;
 }
 const currentCall=data.audit.calls.find(c=>c.line===binding.currentLine&&!isWrite(c.name));
 if(!current||!currentCall||binding.currentLine<=reply.line||binding.currentLine>=write.line)missing('fresh version read after reply missing');
 const value=resultFor(request.host,currentCall,data.rows).value;
 const fresh=binding.currentRecordId?(value.comments??value.documents??value.issues??[]).find(row=>idOf(row)===binding.currentRecordId):value;
 if(!fresh)missing('current version record absent from native read');
 const versioned=/mono-(?:prd|design|tech):\s*approved/.test(writeBody(write));
 const documentId=binding.documentId??(versioned?idOf(fresh):null);
 if(versioned&&!shownVersion)missing('shown document version read required');
 if(text(documentId)){
  const {kind,fields}=versionApproval(write);
  const bound=kind==='mono-prd: approved'?fields.document===documentId&&fields.updatedAt===fresh.updatedAt
   :['mono-design: approved','mono-tech: approved'].includes(kind)&&fields.prd===documentId&&fields['prd-updatedAt']===fresh.updatedAt
    ||kind==='mono-tech: approved'&&fields.spec===documentId&&fields['spec-sha256']===sha256(binding.text);
  if(!bound)throw new Error('written approval does not bind the shown content/version');
 }else if(packageStart){
  const {fields}=versionApproval(write);
  if(!text(idOf(fresh))||fields.record!==idOf(fresh)||fields.sha256!==sha256(binding.text))throw new Error('written approval does not bind the shown content/version');
 }else if(!writeBody(write).includes(binding.text))throw new Error('written approval does not bind the shown content/version');
 if(shownVersion&&shownVersion.updatedAt!==fresh.updatedAt)throw new Error('version changed after shown approval');
 if(shownVersion&&idOf(shownVersion)!==idOf(fresh))throw new Error('approved document changed');
 if(bodyOf(fresh)!==binding.text)throw new Error('version changed after shown approval');
 if(binding.documentId&&idOf(fresh)!==binding.documentId)throw new Error('approved document changed');
 const persisted=dump.all.find(row=>idOf(row)===idOf(fresh));
 if(!persisted||bodyOf(persisted)!==binding.text||persisted.updatedAt!==fresh.updatedAt)throw new Error('approved version changed before final read-back');
 if(binding.documentId&&!Number.isFinite(date(fresh.updatedAt)))missing('approved document version timestamp missing');
}

export function verifyRecords(request){
 const gateResults=[];
 const traces=[{host:request.host,trace:request.trace,endLine:request.endLine},...(request.additionalTraces??[]),...(request.dumpTrace?[{host:request.host,trace:request.dumpTrace}]:[])];
 try{
  const production=productionWrites(traces);if(production)return production;
  const data=nativeRecords(request.host,request.trace,request.endLine),writes=[];
  if(!completedTrace(request.host,data.rows))missing('scenario trace incomplete');
  if(request.endLine&&nativeRecords(request.host,request.trace).calls.some(c=>c.line>request.endLine&&isWrite(c.name)))throw new Error('write after scenario terminal');
  for(const call of data.calls.filter(c=>isWrite(c.name)&&!c.name.startsWith('mcp__paper__'))){
   if(!call.name.startsWith('mcp__monotest__'))throw new Error('write outside monotest');
   writes.push({...resultFor(request.host,call,data.rows),data});
  }
  for(const extra of request.additionalTraces??[]){
   const child=nativeRecords(extra.host,extra.trace,extra.endLine);
   for(const call of child.calls.filter(c=>isWrite(c.name)&&!c.name.startsWith('mcp__paper__')))writes.push({...resultFor(extra.host,call,child.rows),data:child});
  }
  const dump=readRecordDump(request.dumpDir,request.project,request.projectName);
  if(!request.dumpTrace)missing('fresh native dump trace required');
  if(request.dumpTrace){
   const fresh=nativeRecords(request.host,request.dumpTrace);
   if(!completedTrace(request.host,fresh.rows))missing('dump trace incomplete');
   if(fresh.calls.some(c=>isWrite(c.name)))throw new Error('dump attempted an external write');
   const reads=fresh.calls.filter(c=>!isWrite(c.name)).map(c=>resultFor(request.host,c,fresh.rows));
   for(const file of dump.files){
    const scoped=c=>{
     if(file.id)return Object.values(c.input).some(value=>value===file.id||value===file.alias);
     const scope=file.kind==='list_projects'?request.projectName:file.scope==='.'?(request.project.id??request.project.uuid):(file.scopeId??path.basename(file.scope));
     const value=file.kind==='list_projects'?c.input.query:file.scope==='.'?(c.input.projectId??c.input.project):(c.input.issueId??c.input.issue);
     return (value===scope||(file.scopeAlias!==undefined&&value===file.scopeAlias))&&file.request.cursor===c.input.cursor&&Object.keys(c.input).every(key=>['projectId','project','issueId','issue','query','cursor','limit','includeArchived','orderBy'].includes(key))&&
       (c.input.limit===undefined||(Number.isInteger(c.input.limit)&&c.input.limit>0));
    };
    const match=reads.find(c=>c.name===`mcp__monotest__${file.kind}`&&(!['list_issues','list_projects'].includes(file.kind)||c.input.includeArchived===true)&&isDeepStrictEqual(c.value,file.value)&&
     scoped(c));
    if(!match)missing(`fresh native read does not bind ${file.file}`);
   }
  }
  let seedEndLine=0;
  if(request.seedExpected||request.seedEndLine!==undefined){
   const boundary=data.rows.find(r=>r.line===request.seedEndLine);
   if(!Number.isInteger(request.seedEndLine)||!boundary||data.audit.proof({kind:'terminal',result:boundary.value}).status!=='confirmed')missing('native successful seed boundary missing');
   if(!request.seedProjectId)missing('validated seed project missing');
   if(request.seedProjectId!==(request.project?.id??request.project?.uuid))throw new Error('seed belongs to another project');
   if(writes.some(w=>w.data===data&&w.line<=request.seedEndLine&&w.resultLine>request.seedEndLine))missing('write crosses seed boundary');
   seedEndLine=request.seedEndLine;
  }
  const activeWrites=writes.filter(w=>w.data!==data||w.line>seedEndLine),seedIds=new Set(writes.filter(w=>w.data===data&&w.line<=seedEndLine).map(w=>idOf(w.value)));
  // Resolve UUID/name aliases only from native reads on the same team.
  const resolveInput=(write,field,value)=>{
   if(!['status','labels'].includes(field))return value;
   const tool=field==='status'?'list_issue_statuses':'list_issue_labels',aliases=[];
   for(const call of write.data.calls.filter(c=>c.name===`mcp__monotest__${tool}`&&c.line<write.line)){
    if(!write.input.team||call.input.team!==write.input.team)continue;
    const read=resultFor(request.host,call,write.data.rows);
    if(read.resultLine>=write.line)continue;
    const rows=Array.isArray(read.value)?read.value:read.value.labels;
    if(Array.isArray(rows))aliases.push(...rows);
   }
   // Updates without a team can use this record's native state history.
   for(const call of write.data.calls.filter(c=>field==='status'&&c.name==='mcp__monotest__get_issue')){
    const read=resultFor(request.host,call,write.data.rows);
    if(idOf(read.value)===idOf(write.value))aliases.push(...(read.value.stateHistory??[]).map(row=>row.state));
   }
   const resolve=v=>typeof v==='string'?aliases.find(row=>row.id===v)??v:v;
   return field==='labels'&&Array.isArray(value)?value.map(resolve):resolve(value);
  };
  const fields=['body','content','description','title','name','status','labels'];
  const groups=new Map();
  for(const write of writes){
   const id=idOf(write.value);if(!text(id))missing('write result lacks record id');
   if(!groups.has(id))groups.set(id,[]);groups.get(id).push(write);
  }
  for(const [id,versions] of groups){
   if(new Set(versions.map(w=>w.data)).size>1)missing('write ordering across traces is not established');
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
         const observed=resultFor(request.host,read,write.data.rows);
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
     if(Object.hasOwn(value,field)&&!elided(value[field]))finalFields[field]=value[field];
    }
   }
   const observed=dump.all.find(row=>idOf(row)===id);if(!observed)throw new Error(`written record missing from fresh dump: ${id}`);
   for(const [field,value]of Object.entries(finalFields))compareField(field,value,observed[field],id);
  }
  for(const rule of request.expectedRecords){
   if(rule.forbidden==='project:create'){
    if(activeWrites.some(w=>w.name.endsWith('__save_project')&&!w.input.id||w.name.endsWith('__create_project')))throw new Error('forbidden project:create');
   }else if(rule.forbidden==='start-next-stage'){
    if(data.audit.calls.some(c=>(c.name==='Skill'&&request.nextSkill&&c.input?.skill===request.nextSkill)||(['Agent','Task'].includes(c.name)&&request.nextAgent&&c.input?.subagent_type===request.nextAgent)))throw new Error('forbidden start-next-stage');
   }else if(rule.forbidden){
    if(activeWrites.some(w=>writeBody(w).includes(rule.forbidden))||dump.all.some(row=>(bodyOf(row)??'').includes(rule.forbidden)))throw new Error(`forbidden record: ${rule.forbidden}`);
   }else if(rule.type==='project'){
    if(!dump.project)missing('project required');
   }else{
    const found=dump.all.filter(row=>(bodyOf(row)??'').includes(rule.type)&&(!seedIds.has(idOf(row))||activeWrites.some(w=>idOf(w.value)===idOf(row))));
    if(found.length!==(rule.count??1))throw new Error(`expected ${rule.type}: ${rule.count??1}, observed ${found.length}`);
    if(!activeWrites.some(w=>idOf(w.value)===idOf(found[0])))missing(`expected ${rule.type} write absent from trace`);
   }
  }
  const bindingGaps=[];
  for(const write of activeWrites)try{approvalCheck(request,write,write.data,dump);}catch(error){if(!error.bindingOnly)throw error;bindingGaps.push(error.message);}
  const gates=[...(request.gates??[])];
  for(const write of activeWrites){
   const body=writeBody(write);
   const command=body.includes('mono-idea: approved')?'verify':body.includes('mono-tech: approved')?'tech':body.includes('mono-design: approved')?'design':/mono-prd: approved|mono-package: start/.test(body)?'route':null;
   if(command&&!gates.some(g=>g.command===command&&(command!=='verify'||g.recordId===idOf(write.value))))gates.push({command,...(command==='verify'?{recordId:idOf(write.value)}:{})});
  }
  const gateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mono-record-gates-'));
  try{
  for(const file of dump.files){const target=path.join(gateRoot,file.file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(file.value));if(file.request)fs.writeFileSync(target.replace(/\.json$/,'.request.json'),JSON.stringify(file.request));}
  for(const gate of gates){
   if(!['route','design','tech','verify'].includes(gate.command))missing('unknown idea-gate command');
   if(gate.command==='design'){
    const approval=activeWrites.find(w=>writeBody(w).includes('mono-design: approved'));
    if(!approval)missing('mono-design approval write absent from trace');
    const id=writeBody(approval).match(/(?:^|\s)prd=([^\s]+)/)?.[1],doc=dump.documents.find(d=>idOf(d)===id);
    if(!doc)missing('design PRD document absent');fs.writeFileSync(path.join(gateRoot,'prd.json'),JSON.stringify(doc));
   }
   if(gate.command==='tech'){
    const approval=activeWrites.find(w=>(writeBody(w)).includes('mono-tech: approved'));
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
 const dumpDir=path.join(request.outputDir,'dump');
 const result=await execute({...request,seed:undefined,writableRoots:[request.outputDir],readOnlyDump:true,recordDump:{dumpDir,project:request.project,projectName:request.projectName},workspaceProof:{tool:'mcp__monotest__get_workspace',input:{},path:['name'],equals:'Mono Test'},
  scenario:{prompt:dumpPrompt({project:request.project,projectName:request.projectName,dumpDir}),brief:'Fixed read-only monotest dump',windows:[],expectedWindows:[]}});
 return {...result,dumpDir};
}
export async function verifyScenarioRecords({run,runRequest,scenario,project,outputDir,bindingsFile},collect=collectRecordDump){
 const start=Date.now();
 const traces=(run.auditedTraces??[]).filter(trace=>trace!==run.trace).map(trace=>({host:runRequest.host,trace}));
 const violation=productionWrites([{host:runRequest.host,trace:run.trace,endLine:run.endLine},...traces]);if(violation)return {...violation,durationMs:Date.now()-start};
 const dump=await collect({...runRequest,project,projectName:runRequest.context.projectName,outputDir,mcpServers:{monotest:runRequest.mcpServers.monotest}});
 if(dump.trace){
  const violation=productionWrites([{host:runRequest.host,trace:dump.trace},...(dump.auditedTraces??[]).filter(trace=>trace!==dump.trace).map(trace=>({host:runRequest.host,trace}))]);
  if(violation)return {...violation,durationMs:Date.now()-start};
 }
 if(dump.status!=='passed')return {...dump,status:dump.status==='failed'?'failed':'unverified',durationMs:Date.now()-start};
 const bindings=bindingsFile&&fs.existsSync(bindingsFile)?read(bindingsFile):{};
 const result=verifyRecords({host:runRequest.host,trace:run.trace,endLine:run.endLine,sent:run.sent,seedExpected:Boolean(runRequest.seed),seedEndLine:run.seedEndLine,seedProjectId:run.seedRoute?.project?.id,dumpDir:dump.dumpDir,dumpTrace:dump.trace,additionalTraces:traces,
  approvalBindings:bindings.approvalBindings,gates:bindings.gates,project,projectName:runRequest.context.projectName,expectedRecords:scenario.expectedRecords,nextStage:scenario.next,nextSkill:scenario.next?`${runRequest.context.skillPrefix}:${scenario.next}`:null,nextAgent:scenario.next?`${runRequest.context.skillPrefix}-${runRequest.context.skillPrefix}-${scenario.next}`:null,packRoot:runRequest.packRoot,configFile:path.join(runRequest.cwd,'.agents/mono-workflow.config.json')});
 return {...result,durationMs:Date.now()-start};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const result=verifyRecords(read(process.argv[2]));console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:result.status==='failed'?1:2;}
 catch(error){console.error(error.message);process.exitCode=2;}
}
