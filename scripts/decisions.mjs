#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { atomicJson, canonical, withLock, flags, isMain, syncDir } from './runtime.mjs';

export const DECISION_SECTION = '## Ранее принятые решения — не повторять без нового факта';
const issuePattern = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
function regular(file) {
  const stat=fs.lstatSync(file);
  requireThat(stat.isFile() && stat.nlink===1, `plain file required: ${file}`);
}
function directory(root, name, create = false) {
  requireThat(path.isAbsolute(root ?? ''), 'absolute evidenceRoot required');
  if(create)fs.mkdirSync(root,{recursive:true});
  const base=fs.realpathSync(root), dir=path.join(base,name);
  if(create)fs.mkdirSync(dir,{recursive:true});
  if(fs.existsSync(dir))requireThat(fs.realpathSync(dir)===dir,'directory must not be a symlink');
  return dir;
}
function journalFile({evidenceRoot,issue}, create = false) {
  requireThat(issuePattern.test(issue ?? ''),'invalid issue');
  return path.join(directory(evidenceRoot,'decisions',create),`${issue}.json`);
}
export function validateEntry(entry) {
  requireThat(object(entry) && ['decision','matrix','verification'].includes(entry.type),'invalid entry type');
  requireThat(idPattern.test(entry.id ?? '') && text(entry.recordedAt) && Number.isFinite(Date.parse(entry.recordedAt)),'entry id and recordedAt required');
  if(entry.supersedes!==undefined && entry.supersedes!==null)requireThat(idPattern.test(entry.supersedes),'invalid supersedes');
  if(entry.type==='decision') {
    requireThat(['findingKey','problem','trigger','evidence','impact','origin','decision','verification','proposedBy'].every(k=>text(entry[k])),'decision fields required');
    const v=entry.validity;
    requireThat(object(v) && ['head','base'].every(k=>/^[a-f0-9]{40}$/.test(v[k] ?? '')) &&
      ['contracts','assumptions'].every(k=>Array.isArray(v[k]) && v[k].every(text)),'invalid decision validity');
    requireThat(Object.hasOwn(entry,'supersedes'),'decision supersedes required (null for first entry)');
  } else if(entry.type==='matrix') {
    requireThat(text(entry.invariant) && text(entry.verification) && Array.isArray(entry.states) && entry.states.length>0 &&
      entry.states.every(s=>object(s)&&text(s.state)&&text(s.expected)),'matrix invariant, states and verification required');
    requireThat(new Set(entry.states.map(s=>s.state)).size===entry.states.length,'duplicate matrix state');
  } else requireThat(idPattern.test(entry.forId ?? '') && text(entry.method) && text(entry.result),'verification forId, method and result required');
  return entry;
}
export function validateJournal(journal) {
  requireThat(object(journal) && issuePattern.test(journal.issue ?? '') && Array.isArray(journal.entries),'invalid journal');
  const seen=new Map(), replaced=new Set();
  for(const entry of journal.entries) {
    validateEntry(entry);
    requireThat(!seen.has(entry.id),'duplicate entry id; journal entries cannot be overwritten');
    if(entry.supersedes) {
      const prior=seen.get(entry.supersedes);
      requireThat(prior && prior.type===entry.type,'supersedes must reference an earlier entry of the same type');
      requireThat(!replaced.has(prior.id),'supersedes must reference a current entry');
      const key=entry.type==='decision'?'findingKey':entry.type==='matrix'?'invariant':'forId';
      requireThat(prior[key]===entry[key],`supersedes must preserve ${key}`);
      replaced.add(prior.id);
    }
    if(entry.type==='verification')requireThat(seen.has(entry.forId) && seen.get(entry.forId).type!=='verification','verification forId must reference an earlier decision or matrix');
    seen.set(entry.id,entry);
  }
  return journal;
}
export function readJournal(options) {
  const file=journalFile(options);
  if(!fs.existsSync(file))return {issue:options.issue,entries:[]};
  regular(file);
  const journal=validateJournal(JSON.parse(fs.readFileSync(file,'utf8')));
  requireThat(journal.issue===options.issue,'journal issue mismatch');
  return journal;
}
export async function recordDecision(options) {
  const file=journalFile(options,true);
  return withLock(file+'.lock',()=>{
    const journal=readJournal(options);
    const next=validateJournal({...journal,entries:[...journal.entries,options.entry]});
    atomicJson(file,next);
    return file;
  });
}
export function currentEntries(journal) {
  validateJournal(journal);
  const replaced=new Set(journal.entries.map(e=>e.supersedes).filter(Boolean));
  return journal.entries.filter(e=>!replaced.has(e.id) && (e.type!=='verification'||!replaced.has(e.forId)));
}
export function renderDecisions(journal) {
  const entries=currentEntries(journal).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  // Canonical JSON keeps evidence verbatim without interpreting it as Markdown structure.
  return `${DECISION_SECTION}\n\n\`\`\`json\n${canonical(entries)}\n\`\`\`\n`;
}
function datasetBytes(source, section) {
  const matches=[...source.matchAll(new RegExp('^'+DECISION_SECTION+'\\r?$','gm'))];
  requireThat(matches.length<=1,'multiple managed decision sections');
  if(!matches.length)return source.replace(/\s*$/,'')+'\n\n'+section;
  const start=matches[0].index, rest=source.slice(start+matches[0][0].length);
  const next=/\n##? /.exec(rest);
  const end=next ? start+matches[0][0].length+next.index+1 : source.length;
  return source.slice(0,start)+section+(end<source.length?'\n'+source.slice(end):'');
}
function immutable(file, bytes) {
  const stage=fs.mkdtempSync(path.join(path.dirname(file),'.decisions-stage-'));
  try {
    const temp=path.join(stage,'content'),fd=fs.openSync(temp,'wx',0o600);
    try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.linkSync(temp,file);
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
  syncDir(path.dirname(file));
}
function versionAt(dir, issue, version) {
  requireThat(Number.isSafeInteger(version)&&version>0,'positive version required');
  const archive=path.join(dir,`${issue}-review-scope.v${version}.md`);
  regular(archive);regular(archive+'.sha256');
  const bytes=fs.readFileSync(archive),digest=hash(bytes);
  requireThat(fs.readFileSync(archive+'.sha256','utf8')===digest+'\n','immutable dataset digest mismatch');
  return {version,digest,archive,bytes};
}
export async function versionDataset(options) {
  const {issue,source}=options;
  journalFile(options);
  regular(source);
  const dir=directory(options.evidenceRoot,'datasets',true);
  // Share the archive lock with MONO-79's collector.
  return withLock(path.join(dir,`${issue}-review-scope.archive.lock`),()=>{
    const bytes=Buffer.from(datasetBytes(fs.readFileSync(source,'utf8'),renderDecisions(readJournal(options))));
    const digest=hash(bytes);
    let highest=0, existing=null;
    for(const name of fs.readdirSync(dir).sort()) {
      const match=new RegExp(`^${issue}-review-scope\\.v([1-9][0-9]*)\\.md$`).exec(name);
      if(!match)continue;
      const archive=path.join(dir,name);regular(archive);
      if(!fs.existsSync(archive+'.sha256')) {
        requireThat(fs.readFileSync(archive).equals(bytes),'orphan dataset archive differs from source; digest recovery refused');
        immutable(archive+'.sha256',digest+'\n');
      }
      const v=versionAt(dir,issue,Number(match[1]));highest=Math.max(highest,v.version);
      if(v.bytes.equals(bytes))existing=v;
    }
    if(existing)return {version:existing.version,digest,archive:existing.archive,created:false};
    const version=highest+1,archive=path.join(dir,`${issue}-review-scope.v${version}.md`);
    requireThat(!fs.existsSync(archive+'.sha256'),'refusing to overwrite orphan dataset digest');
    immutable(archive,bytes);immutable(archive+'.sha256',digest+'\n');
    return {version,digest,archive,created:true};
  });
}
function git(worktree, args) {
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
  return execFileSync('git',['-c','core.fsmonitor=false','-C',worktree,...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
}
export function materializeDataset(options) {
  journalFile(options);
  const version=versionAt(directory(options.evidenceRoot,'datasets'),options.issue,Number(options.version));
  if(options.digest!==undefined)requireThat(options.digest===version.digest,'pinned dataset digest mismatch');
  requireThat(path.isAbsolute(options.worktree ?? ''),'absolute worktree required');
  const worktree=fs.realpathSync(options.worktree),dir=path.join(worktree,'.orchestrator');
  requireThat(fs.realpathSync(git(worktree,['rev-parse','--show-toplevel']).trim())===worktree,'worktree must be repository root');
  if(fs.existsSync(dir))requireThat(fs.lstatSync(dir).isDirectory() && fs.realpathSync(dir)===dir,'materialization directory must be plain');
  const relative=`.orchestrator/review-dataset-${version.digest.slice(0,8)}.md`,file=path.join(worktree,relative);
  requireThat(!git(worktree,['ls-files','--',relative]).trim(),'materialized path is in Git index');
  requireThat(git(worktree,['check-ignore','--',relative]).trim()===relative,'materialized path must be ignored by Git');
  if(fs.existsSync(file)) {regular(file);requireThat(hash(fs.readFileSync(file))===version.digest,'existing materialized digest mismatch');}
  if(options.remove===true) {if(fs.existsSync(file))fs.unlinkSync(file);return {path:file,relative,digest:version.digest,removed:true};}
  fs.mkdirSync(dir,{recursive:true});
  if(!fs.existsSync(file))immutable(file,version.bytes);
  regular(file);requireThat(hash(fs.readFileSync(file))===version.digest,'materialized digest mismatch');
  requireThat(!git(worktree,['status','--porcelain','--untracked-files=all','--',relative]).trim(),'materialized file is Git-visible');
  return {path:file,relative,digest:version.digest,version:version.version};
}
async function main() {
  const [command,...rest]=process.argv.slice(2),args=flags(rest);
  if(command==='--help'||args.help){console.log('Usage: decisions.mjs record|render|version|materialize|list --issue KEY --evidence-root DIR [--record JSON_FILE] [--source DATASET] [--version N --worktree DIR --digest SHA256] [--remove true]\nrecord accepts typed decision, matrix or verification entries. version replaces the managed section in --source and publishes immutable bytes. materialize requires an ignored, untracked path; --remove true cleans that exact digest-checked file.');return;}
  const allowed=['issue','evidence-root',...({record:['record'],render:[],list:[],version:['source'],materialize:['version','worktree','digest','remove']}[command]??[])];
  requireThat(Object.keys(args).every(k=>allowed.includes(k)),'unknown option');
  const options={...args,evidenceRoot:args['evidence-root']};
  let result;
  if(command==='record') {regular(args.record);result=await recordDecision({...options,entry:JSON.parse(fs.readFileSync(args.record,'utf8'))});}
  else if(command==='render') {process.stdout.write(renderDecisions(readJournal(options)));return;}
  else if(command==='list')result=readJournal(options);
  else if(command==='version')result=await versionDataset(options);
  else if(command==='materialize') {requireThat(args.remove===undefined||args.remove==='true','--remove must be true');result=materializeDataset({...options,remove:args.remove==='true'});}
  else throw new Error('expected record, render, version, materialize or list');
  console.log(JSON.stringify(result,null,2));
}
if(isMain(import.meta.url))main().catch(error=>{console.error(`decisions: ${error.message}`);process.exitCode=1;});
