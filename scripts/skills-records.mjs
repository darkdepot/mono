#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonLines } from './transports/journal.mjs';
import { traceRows } from './skills-probe.mjs';
import { completedTrace } from './skills-trace.mjs';
import { auditRows } from './skills-audit.mjs';
import { isWrite, MissingEvidence } from './skills-boundary.mjs';
import { nativeProof } from './skills-proof.mjs';
import { runScenario } from './skills-run.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const text=value=>typeof value==='string'&&value.trim().length>0;
const ownUrl=url=>typeof url==='string'&&url.startsWith('https://linear.app/monotest/');
const idOf=row=>row?.uuid??row?.id;
const bodyOf=row=>row?.body??row?.content??row?.description;
const writeBody=write=>bodyOf(write.input)??bodyOf(write.value)??'';
const missing=reason=>{throw new MissingEvidence(reason);};
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
 const day=value.slice(0,10),stamp=Date.parse(day);
 if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==day||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)return NaN;
 return Date.parse(value);
}

// Same cursor/ordering contract as idea-gate readDump, extended to documents/issues.
function pages(root,prefix,key,files){
 const directory=path.dirname(prefix),stem=path.basename(prefix);
 const names=fs.readdirSync(path.join(root,directory)).filter(name=>name.startsWith(stem+'-')&&name.endsWith('.json'));
 const count=names.filter(name=>new RegExp(`^${stem}-[1-9]\\d*\\.json$`).test(name)).length;
 if(!count||names.length!==count*2)missing(`incomplete ${prefix} pages`);
 const records=[],ids=new Set();let cursor,updated=Infinity;
 for(let n=1;n<=count;n++){
  const requestFile=`${prefix}-${n}.request.json`,file=`${prefix}-${n}.json`,request=read(path.join(root,requestFile)),page=read(path.join(root,file));
  if(!request||Array.isArray(request)||typeof request!=='object'||(n===1?Object.keys(request).length!==0:Object.keys(request).length!==1||request.cursor!==cursor))missing(`broken ${prefix} cursor request`);
  if(!Array.isArray(page?.[key])||typeof page.hasNextPage!=='boolean'||page.hasNextPage!==(n<count)||
    (page.hasNextPage?(!page[key].length||(key==='comments'?page.cursor!==page[key].at(-1)?.id:!text(page.cursor))):Object.hasOwn(page,'cursor')))missing(`unfinished ${prefix} page`);
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
 const raw=read(path.join(root,'project.json')),files=[{file:'project.json',value:raw,kind:'get_project',id:project.id??project.uuid}];
 if(!text(raw?.uuid)||raw.uuid!==(project.id??project.uuid)||raw.name!==project.name||!ownUrl(raw.url)||typeof raw.description!=='string')missing('project read-back identity incomplete');
 const comments=pages(root,'comments','comments',files),documents=[],issues=[];
 const refs=pages(root,'documents','documents',files);
 for(const ref of refs){
  const id=idOf(ref);if(!/^[A-Za-z0-9-]+$/.test(id))missing('invalid document id');
  const file=`documents/${id}.json`,doc=read(path.join(root,file));
  if(idOf(doc)!==id||typeof doc.content!=='string'||!text(doc.title))missing('document body incomplete');
  if((doc.projectId??doc.project?.id)!==raw.uuid)missing('document project incomplete');
  documents.push(doc);files.push({file,value:doc,kind:'get_document',id});
 }
 for(const ref of pages(root,'issues','issues',files)){
  const id=idOf(ref);if(!/^[A-Za-z0-9-]+$/.test(id))missing('invalid issue id');
  const file=`issues/${id}/issue.json`,issue=read(path.join(root,file));
  if(idOf(issue)!==id||!text(issue.title)||typeof issue.description!=='string'||!issue.status||
    !text(typeof issue.status==='string'?issue.status:issue.status.name)||!Array.isArray(issue.labels)||issue.labels.some(label=>!text(typeof label==='string'?label:label?.name)))missing('issue status/labels/body incomplete');
  if((issue.projectId??issue.project?.id)!==raw.uuid)missing('issue project incomplete');
  issues.push(issue);files.push({file,value:issue,kind:'get_issue',id});
  comments.push(...pages(root,`issues/${id}/comments`,'comments',files));
 }
 const all=[raw,...comments,...documents,...issues];
 for(const row of all)if(row.url!==undefined&&!ownUrl(row.url))throw new Error(`record outside monotest: ${row.url}`);
 return {project:raw,comments,documents,issues,all,files};
}

// Only native direct input or the driver's literal JSON exec route binds payloads.
// Arbitrary JavaScript is deliberately not parsed; an unknown route is unverified.
function callInput(host,call){
 if(host!=='codex'||call.event.payload?.name!=='exec')return call.input;
 const p=call.event.payload,source=p.type==='custom_tool_call'?p.input:p.arguments;
 const prefix=`const r = await tools.${call.name}(`,suffix='); text(r);';
 if(typeof source!=='string'||!source.trim().startsWith(prefix)||!source.trim().endsWith(suffix))missing(`unbound exec payload at line ${call.line}`);
 try{return JSON.parse(source.trim().slice(prefix.length,-suffix.length));}catch{missing(`non-JSON exec payload at line ${call.line}`);}
}
function resultFor(host,call,rows,bindInput=true){
 const outputs=rows.filter(r=>r.line>call.line&&(host==='claude'
  ? r.value.type==='user'&&Array.isArray(r.value.message?.content)&&r.value.message.content.some(b=>b.type==='tool_result'&&b.tool_use_id===call.callId)
  : r.value.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(r.value.payload?.type)&&r.value.payload.call_id===call.callId));
 if(outputs.length!==1)missing(`unique linked result missing at line ${call.line}`);
 const result=outputs[0],proof=nativeProof({host,kind:'record',call:call.event,result:result.value,callId:call.callId});
 if(proof.status!=='confirmed')missing(`successful record result missing at line ${result.line}`);
 return {...call,input:bindInput?callInput(host,call):call.input,value:proof.value,resultLine:result.line};
}
function nativeRecords(host,trace,endLine){
 const {rows}=traceRows(trace,host,{endLine}),audit=auditRows(host,rows);
 const calls=audit.calls.filter(c=>c.name.startsWith('mcp__'));
 return {rows,audit,calls:calls.filter(call=>call.event.type!=='event_msg'||!calls.some(other=>other!==call&&other.callId&&other.callId===call.event.payload?.item?.id&&other.name===call.name))};
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

function approvalCheck(request,write,data,dump){
 const createProject=write.name.endsWith('__create_project')||(write.name.endsWith('__save_project')&&!write.input.id);
 if(!createProject&&!/mono-[\w-]+:\s*(?:approved|start)\b/.test(writeBody(write)))return;
 const binding=request.approvalBindings?.find(b=>b.recordId===idOf(write.value));
 if(!binding)missing(`shown-version binding missing for ${idOf(write.value)}`);
 const window=data.audit.calls.find(c=>c.callId===binding.windowCallId&&['AskUserQuestion','request_user_input_async'].includes(c.name));
 if(!window)missing('approval window missing');
 const responses=request.sent?traceRows(request.sent,'claude').rows.map(r=>r.value):[];
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
 if(!answers.length||answers.some(answer=>!/^Утвердить(?:[ ,]|$)/.test(answer)))throw new Error('approval write after empty/refuse/discuss/non-approval reply');
 if(write.line<=reply.line)throw new Error('approval write before window answer');
 const shown=data.rows.find(r=>r.line===binding.shownLine),current=data.rows.find(r=>r.line===binding.currentLine);
 const shownText=request.host==='claude'?shown?.value.message?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')
  :shown?.value.payload?.role==='assistant'?shown.value.payload.content?.filter(b=>b.type==='output_text').map(b=>b.text).join('\n'):null;
 if(!text(binding.text)||!shownText?.includes(binding.text)||binding.shownLine>=window.line)missing('shown version not found in owner-visible trace');
 if(binding.currentLine===write.line&&/mono-(?:idea|tech):\s*approved/.test(writeBody(write))){
  if(!writeBody(write).includes(binding.text))throw new Error('outgoing approved version differs from shown content');
  return; // idea-gate below independently checks the snapshot against persisted current data.
 }
 if(createProject){
  if((write.input.description??write.value.description)!==binding.text)throw new Error('created project differs from shown version');
  return;
 }
 const currentCall=data.audit.calls.find(c=>c.line===binding.currentLine&&!isWrite(c.name));
 if(!current||!currentCall||binding.currentLine<=reply.line||binding.currentLine>=write.line)missing('fresh version read after reply missing');
 const value=resultFor(request.host,currentCall,data.rows).value;
 const fresh=binding.currentRecordId?(value.comments??value.documents??value.issues??[]).find(row=>idOf(row)===binding.currentRecordId):value;
 if(!fresh)missing('current version record absent from native read');
 if(!(writeBody(write)).includes(binding.text) && !(text(binding.documentId) && (writeBody(write)).includes(`document=${binding.documentId}`) && (writeBody(write)).includes(`updatedAt=${fresh.updatedAt}`)))throw new Error('written approval does not bind the shown content/version');
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
     if(file.id)return Object.values(c.input).includes(file.id);
     const scope=file.kind==='list_projects'?request.projectName:file.scope==='.'?(request.project.id??request.project.uuid):path.basename(file.scope);
     const value=file.kind==='list_projects'?c.input.query:file.scope==='.'?(c.input.projectId??c.input.project):(c.input.issueId??c.input.issue);
     return value===scope&&file.request.cursor===c.input.cursor&&Object.keys(c.input).every(key=>['projectId','project','issueId','issue','query','cursor','limit','includeArchived','orderBy'].includes(key))&&
       (c.input.limit===undefined||(Number.isInteger(c.input.limit)&&c.input.limit>0));
    };
    const match=reads.find(c=>c.name===`mcp__monotest__${file.kind}`&&(!['list_issues','list_projects'].includes(file.kind)||c.input.includeArchived===true)&&isDeepStrictEqual(c.value,file.value)&&
     scoped(c));
    if(!match)missing(`fresh native read does not bind ${file.file}`);
   }
  }
  for(const write of writes){
   const value=write.value,id=idOf(value),input=write.input;
   if(!text(id))missing('write result lacks record id');
   const observed=dump.all.find(row=>idOf(row)===id);if(!observed)throw new Error(`written record missing from fresh dump: ${id}`);
   for(const field of ['body','content','description','title','name','status','labels']){
    if(Object.hasOwn(input,field)&&!isDeepStrictEqual(input[field],observed[field]))throw new Error(`read-back mismatch for ${id}.${field}`);
    if(Object.hasOwn(value,field)&&!isDeepStrictEqual(value[field],observed[field]))throw new Error(`write result/read-back mismatch for ${id}.${field}`);
   }

  }
  for(const rule of request.expectedRecords){
   if(rule.forbidden==='project:create'){
    if(writes.some(w=>w.name.endsWith('__save_project')&&!w.input.id||w.name.endsWith('__create_project')))throw new Error('forbidden project:create');
   }else if(rule.forbidden==='start-next-stage'){
    if(data.audit.calls.some(c=>(c.name==='Skill'&&request.nextSkill&&c.input?.skill===request.nextSkill)||(['Agent','Task'].includes(c.name)&&request.nextAgent&&c.input?.subagent_type===request.nextAgent)))throw new Error('forbidden start-next-stage');
   }else if(rule.forbidden){
    if(writes.some(w=>(writeBody(w)).includes(rule.forbidden)))throw new Error(`forbidden record: ${rule.forbidden}`);
   }else if(rule.type==='project'){
    if(!dump.project)missing('project required');
   }else{
    const found=dump.all.filter(row=>(bodyOf(row)??'').includes(rule.type));
    if(found.length!==(rule.count??1))throw new Error(`expected ${rule.type}: ${rule.count??1}, observed ${found.length}`);
    if(!writes.some(w=>idOf(w.value)===idOf(found[0])))missing(`expected ${rule.type} write absent from trace`);
   }
  }
  for(const write of writes)approvalCheck(request,write,write.data,dump);
  for(const write of writes){
   const body=writeBody(write);
   const command=body.includes('mono-idea: approved')?'verify':body.includes('mono-tech: approved')?'tech':/mono-(?:prd|design): approved|mono-package: start/.test(body)?'route':null;
   if(command&&!request.gates?.some(g=>g.command===command&&(command!=='verify'||g.recordId===idOf(write.value))))missing(`idea-gate ${command} proof required`);
  }
  for(const gate of request.gates??[]){
   if(!['route','tech','verify'].includes(gate.command))missing('unknown idea-gate command');
   if(gate.command==='tech'){
    const approval=writes.find(w=>(writeBody(w)).includes('mono-tech: approved'));
    for(const [token,file] of [['prd','prd.json'],['spec','tech-spec.json']]){
     const id=(bodyOf(approval?.value)??'').match(new RegExp(`(?:^|\\s)${token}=([^\\s]+)`))?.[1];
     const doc=dump.documents.find(d=>idOf(d)===id);if(!doc)missing(`tech ${token} document absent`);
     fs.writeFileSync(path.join(request.dumpDir,file),JSON.stringify(doc));
    }
   }
   const args=[path.join(request.packRoot,'scripts/idea-gate.mjs'),gate.command,'--dump',request.dumpDir,'--config',request.configFile];
   if(gate.command==='verify'){
    const record=dump.comments.find(row=>row.id===gate.recordId);if(!record)missing('idea approval record missing');
    const expect=path.join(request.dumpDir,'expected-idea.md');if(fs.existsSync(expect)){if(fs.readFileSync(expect,'utf8')!==record.body)missing('saved idea expectation changed');}else fs.writeFileSync(expect,record.body,{flag:'wx'});
    args.push('--project',dump.project.uuid,'--expect',expect);
   }else args.push('--mode','fresh');
   const run=spawnSync(process.execPath,args,{encoding:'utf8'});let result;try{result=JSON.parse(run.stdout.trim().split('\n').at(-1));}catch{missing('idea-gate result unreadable');}
   gateResults.push({command:gate.command,exitCode:run.status,result});if(run.status!==0||!result.ok)throw new Error(`idea-gate ${gate.command}: ${result.code}`);
  }
  return {status:'passed',stop:false,manualRemoval:[],monotestTasks:dump.issues.length,taskIds:dump.issues.map(idOf),writes:writes.length,gateResults,evidence:[request.trace,request.dumpDir]};
 }catch(error){return {status:error instanceof MissingEvidence||error instanceof SyntaxError||['ENOENT','ENOTDIR'].includes(error.code)?'unverified':'failed',stop:false,manualRemoval:[],reason:error.message,gateResults,evidence:[request.trace,request.dumpDir]};}
}

export function dumpPrompt({project,projectName,dumpDir}){
 if(!project)return `Только monotest, без этапов и внешних записей. Проверь отсутствие проекта с точным именем ${JSON.stringify(projectName)}: все страницы list_projects с query этим именем, включая архив. Сохрани сырые ответы в ${dumpDir}/projects-N.json и projects-N.request.json ({} первой, затем {cursor} предыдущего ответа) до hasNextPage:false без cursor. Не придумывай поля. Локальные файлы разрешены. Codex: один MCP на exec, точная форма const r = await tools.<имя>(<JSON>); text(r);. Заверши после полного списка.`;
 return `Только свежее чтение monotest, без вызова этапов и без любых внешних записей. Пространство Mono Test подтвердит драйвер. Проект ${JSON.stringify(project)}. Список фиксирован скриптом, не выбирай что читать:\n`+
 `1. get_project (includeResources: true), сырой ответ project.json.\n2. Все list_comments проекта: comments-N.json и comments-N.request.json ({} первой, затем {cursor} предыдущего ответа).\n`+
 `3. Все страницы list_documents проекта: documents-N.json и documents-N.request.json; каждый get_document в documents/<id>.json.\n`+
 `4. Все страницы list_issues проекта, включая архив: issues-N.json и issues-N.request.json; каждый get_issue со status и labels в issues/<id>/issue.json; все list_comments задачи в issues/<id>/comments-N.json и comments-N.request.json.\n`+
 `Во всех списках дойди до hasNextPage:false без cursor. Не переписывай ответы, не сочиняй отсутствующие поля и полноту; неизвестная форма останется unverified. Сохраняй именно сырой JSON ответа в ${dumpDir}; только локальные файлы. Для Codex каждый MCP через точную форму const r = await tools.<имя>(<JSON>); text(r); — один вызов на exec, аргументы буквальным JSON. Заверши после всего перечня.`;
}
export async function collectRecordDump(request,execute=runScenario){
 if(!request.mcpServers?.monotest||Object.keys(request.mcpServers).some(k=>k!=='monotest'))throw new Error('record dump uses only monotest');
 const dumpDir=path.join(request.outputDir,'dump');
 const result=await execute({...request,seed:undefined,writableRoots:[request.outputDir],readOnlyDump:true,workspaceProof:{tool:'mcp__monotest__get_workspace',input:{},path:['name'],equals:'Mono Test'},
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
 const result=verifyRecords({host:runRequest.host,trace:run.trace,endLine:run.endLine,sent:run.sent,dumpDir:dump.dumpDir,dumpTrace:dump.trace,additionalTraces:traces,
  approvalBindings:bindings.approvalBindings,gates:bindings.gates,project,projectName:runRequest.context.projectName,expectedRecords:scenario.expectedRecords,nextStage:scenario.next,nextSkill:scenario.next?`${runRequest.context.skillPrefix}:${scenario.next}`:null,nextAgent:scenario.next?`${runRequest.context.skillPrefix}-${runRequest.context.skillPrefix}-${scenario.next}`:null,packRoot:runRequest.packRoot,configFile:path.join(runRequest.cwd,'.agents/mono-workflow.config.json')});
 return {...result,durationMs:Date.now()-start};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const result=verifyRecords(read(process.argv[2]));console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:result.status==='failed'?1:2;}
 catch(error){console.error(error.message);process.exitCode=2;}
}
