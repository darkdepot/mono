import fs from 'node:fs';
import { spawn } from 'node:child_process';

// Both adapters use this pipe boundary: raw stdout is durable before dispatch.
export function hostProcess({ binary, args, cwd, env, trace, stderr, sent, timeoutMs, input, onEvent, onIdle, idleMs = 0 }) {
  return new Promise(resolve => {
    let failure = null, buffer = '', closed = false, completed = false, lineNumber=0, idle, killTimer;
    const child = spawn(binary.command, [...(binary.args ?? []), ...args], {cwd,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    const stop = reason => {
      if (failure) return;
      failure = reason;clearTimeout(idle);
      try { if(process.platform!=='win32')process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM'); } catch (error) { if(error.code!=='ESRCH') failure += `; ${error.message}`; }
      killTimer = setTimeout(()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch(error){if(error.code!=='ESRCH')failure += `; ${error.message}`;}},500);
    };
    const send = value => {
      if (closed || child.stdin.destroyed) throw new Error('host stdin closed before reply');
      const data = typeof value === 'string' ? value : JSON.stringify(value)+'\n';
      fs.appendFileSync(sent,data);
      child.stdin.write(data);
    };
    const controls = { send, stop, complete:()=>{
      completed=true;clearTimeout(timer);clearTimeout(idle);child.stdin.end();
      // Let an already completed CLI exit before terminating any following stage.
      killTimer=setTimeout(()=>{
        if(closed)return;
        try{if(process.platform!=='win32')process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}
        catch(error){if(error.code!=='ESRCH')failure=error.message;}
        killTimer=setTimeout(()=>{if(closed)return;try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch(error){if(error.code!=='ESRCH')failure=error.message;}},500);
      },25);
    }, end:()=>child.stdin.end(), idle:()=>{
      clearTimeout(idle);if(idleMs)idle=setTimeout(()=>Promise.resolve(onIdle?.(controls)).catch(e=>stop(e.message)),idleMs);
    }};
    const timer = setTimeout(()=>stop('host timeout'),timeoutMs);
    child.on('error',e=>{failure=e.message;});
    child.stdin.on('error',e=>{if(!closed)failure = failure ?? `stdin: ${e.message}`;});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      clearTimeout(idle);
      fs.appendFileSync(trace,chunk);buffer += chunk.toString('utf8');
      let nl;while((nl=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,nl);buffer=buffer.slice(nl+1);lineNumber++;if(!line.trim()||failure||completed)continue;
        try {const event=JSON.parse(line);onEvent?.(event,controls,lineNumber);} catch(e){stop(`invalid host event: ${e.message}`);}
      }
    });
    child.stderr.on('data',chunk=>fs.appendFileSync(stderr,chunk));
    child.on('close',(code,signal)=>{
      closed=true;clearTimeout(timer);clearTimeout(idle);clearTimeout(killTimer);
      if(!completed&&buffer.trim())failure = failure ?? 'cut JSONL event (missing newline)';
      resolve({code:completed&&!failure&&(code===0||signal==='SIGTERM'||signal==='SIGKILL')?0:code,signal,failure,...(completed?{completed:true}:{})});
    });
    child.on('spawn',()=>{try{if(input!==undefined)send(input);else child.stdin.end();}catch(e){stop(e.message);}});
  });
}
