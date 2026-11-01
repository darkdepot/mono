#!/usr/bin/env node
// Probe-derived stdio relay. The caller supplies the test file; no active-file fallback.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const forbidden = new Set(['create_file','create_folder','archive_resources','unarchive_resources','move_resources','rename_resource']);
export function scopedTool(tool) {
  return !forbidden.has(tool.name) && Object.hasOwn(tool.inputSchema?.properties ?? {}, 'fileId');
}
export function paperCallAllowed(fileId, tools, name, args) {
  return typeof fileId === 'string' && fileId.trim() && tools.has(name) && !forbidden.has(name) && args?.fileId === fileId;
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
    } else if (!['initialize','ping','tools/list','notifications/initialized','notifications/cancelled'].includes(msg.method)) {
      if (msg.id !== undefined) blocked(msg.id,'method outside test tool surface'); return;
    }
    if (msg.id !== undefined) pending.set(msg.id,msg.method);
    child.stdin.write(JSON.stringify(msg)+'\n');
  };
  const paper = msg => {
    if (pending.get(msg.id) === 'tools/list' && msg.result) {
      if (!Array.isArray(msg.result.tools)) throw new Error('invalid Paper tools/list');
      msg.result.tools = msg.result.tools.filter(scopedTool).map(tool => {
        tools.set(tool.name,tool);
        return {...tool,inputSchema:{...tool.inputSchema,required:[...new Set([...(tool.inputSchema.required ?? []),'fileId'])]}};
      });
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
