#!/usr/bin/env node
// Probe-derived stdio relay. The caller supplies the test file; no active-file fallback.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const forbidden = new Set(['create_file','create_folder','archive_resources','unarchive_resources','move_resources','rename_resource']);
export function scopedTool(tool) {
  return tool.name === 'get_guide' || (!forbidden.has(tool.name) && Object.hasOwn(tool.inputSchema?.properties ?? {}, 'fileId'));
}
export function paperCallAllowed(fileId, tools, name, args) {
  return typeof fileId === 'string' && fileId.trim() && tools.has(name) && !forbidden.has(name) && args?.fileId === fileId;
}

function moveExports(result, request) {
  const exportDir=fs.realpathSync(request.exportDir ?? path.join(os.homedir(),'Downloads'));
  if (!path.isAbsolute(request.exportRunDir ?? '')) throw new Error('exportRunDir required');
  const runDir=fs.realpathSync(request.exportRunDir);
  if (!fs.statSync(runDir).isDirectory() || runDir===exportDir || runDir.startsWith(exportDir+path.sep) || exportDir.startsWith(runDir+path.sep)) throw new Error('separate export run directory required');
  const sources=new Map(), destinations=new Map();
  const source=value=>{
    const file=value.startsWith('file://')?fileURLToPath(value):value;
    const real=fs.realpathSync(file);
    if (!real.startsWith(exportDir+path.sep) || !fs.lstatSync(file).isFile()) throw new Error('unexpected export path outside regular owner exports');
    sources.set(value,real);return value;
  };
  // Paper may repeat a path in structuredContent and JSON text. Validate the
  // complete response before moving anything, then rewrite both representations.
  const walk=(value, replace, key='')=>{
    if (Array.isArray(value)) return value.map(v=>walk(v,replace,key));
    if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v,replace,k)]));
    if (typeof value!=='string') return value;
    if (key==='text') {
      let parsed;try { parsed=JSON.parse(value); } catch {}
      if (parsed!==undefined) return JSON.stringify(walk(parsed,replace));
      return value.replace(/(?:file:\/\/)?\/[^\n`"<>]+/g,replace);
    }
    if (path.isAbsolute(value) || value.startsWith('file://')) return replace(value);
    if (['path','filePath','file_path','localPath','uri','files'].includes(key)) throw new Error('unexpected non-absolute export path');
    return value;
  };
  walk(result,source);
  if (!sources.size) throw new Error('Paper export did not name local files');
  const callDir=fs.mkdtempSync(path.join(request.exportRunDir,'export-'));
  const moved=new Map();
  for (const [value,file] of sources) {
    let destination=moved.get(file);
    if (!destination) {
      destination=path.join(callDir,path.relative(exportDir,file));
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.copyFileSync(file,destination,fs.constants.COPYFILE_EXCL);fs.unlinkSync(file);
      moved.set(file,destination);
    }
    destinations.set(value,value.startsWith('file://')?pathToFileURL(destination).href:destination);
  }
  return walk(result,value=>destinations.get(value));
}

export function relayPaper(request) {
  if (typeof request.fileId !== 'string' || !request.fileId.trim() || typeof request.command !== 'string' || !request.command.trim() ||
      !Array.isArray(request.args) || request.args.some(v => typeof v !== 'string') || typeof request.log !== 'string') throw new Error('explicit fileId, command, args and log required');
  const child = spawn(request.command,request.args,{stdio:['pipe','pipe','inherit']});
  const tools = new Map(), pending = new Map();
  const log = value => fs.appendFileSync(request.log,JSON.stringify(value)+'\n');
  const send = value => process.stdout.write(JSON.stringify(value)+'\n');
  const blocked = (id, reason) => send({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:`Blocked by test file guard: ${reason}`}]}});
  const client = msg => {
    if (msg.method === 'tools/call') {
      const {name,arguments:args} = msg.params ?? {};
      if (!paperCallAllowed(request.fileId,tools,name,args)) {
        log({kind:'blocked',tool:name,fileId:args?.fileId ?? null}); blocked(msg.id,'known scoped tool and exact request fileId required'); return;
      }
      log({kind:'forwarded',tool:name,fileId:args.fileId});
      if (name === 'get_guide') {
        // Documentation has no file access; the extra id belongs to this relay.
        const guide={...args};delete guide.fileId;
        msg={...msg,params:{...msg.params,arguments:guide}};
      }
    } else if (!['initialize','ping','tools/list','notifications/initialized','notifications/cancelled'].includes(msg.method)) {
      if (msg.id !== undefined) blocked(msg.id,'method outside test tool surface'); return;
    }
    if (msg.id !== undefined) pending.set(msg.id,{method:msg.method,tool:msg.params?.name});
    child.stdin.write(JSON.stringify(msg)+'\n');
  };
  const paper = msg => {
    const call=pending.get(msg.id);
    if (call?.method === 'tools/list' && msg.result) {
      if (!Array.isArray(msg.result.tools)) throw new Error('invalid Paper tools/list');
      msg.result.tools = msg.result.tools.filter(scopedTool).map(tool => {
        tools.set(tool.name,tool);
        return {...tool,inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,fileId:tool.inputSchema.properties?.fileId ?? {type:'string'}},required:[...new Set([...(tool.inputSchema.required ?? []),'fileId'])]}};
      });
    }
    if (call?.tool==='export' && msg.result && !msg.result.isError) {
      try { msg={...msg,result:moveExports(msg.result,request)}; }
      catch(error) { pending.delete(msg.id);log({kind:'blocked-export',reason:error.message});blocked(msg.id,error.message);return; }
    }
    pending.delete(msg.id); send(msg);
  };
  const lines = (stream, consume) => {
    let buffer=''; stream.setEncoding('utf8');
    stream.on('data',chunk => {
      buffer+=chunk;
      let end;
      while ((end=buffer.indexOf('\n')) >= 0) {
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        if (line.trim()) { try { consume(JSON.parse(line)); } catch(error) { die(error.message); } }
      }
    });
    stream.on('end',() => { if (buffer.trim()) die('cut MCP JSON line'); });
  };
  let stopping=false;
  const die = reason => { if(stopping)return;stopping=true;log({kind:'error',reason});child.kill('SIGTERM');process.exitCode=1;process.stdin.destroy(); };
  lines(process.stdin,client);lines(child.stdout,paper);
  child.on('error',error=>die(error.message));
  child.stdin.on('error',error=>die(error.message));
  child.on('exit',code=>{process.exitCode=process.exitCode || code || 0;process.stdin.destroy();});
  process.stdin.on('end',()=>{child.stdin.end();const timer=setTimeout(()=>child.kill('SIGTERM'),500);timer.unref();});
  process.on('SIGTERM',()=>child.kill('SIGTERM'));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { relayPaper(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
