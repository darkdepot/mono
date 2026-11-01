import fs from 'node:fs';
import { spawn } from 'node:child_process';
const cleanupGraceMs=500;

// Both adapters use this pipe boundary: raw stdout is durable before dispatch.
export function hostProcess({ binary, args, cwd, env, trace, stderr, sent, timeoutMs, input, onEvent, onIdle, idleMs = 0 }) {
  return new Promise(resolve => {
    let failure = null, buffer = '', closed = false, leaderExited = false, exitedCode, exitedSignal, completed = false, lineNumber=0, idle, killTimer, exitTimer, completionTimer;
    const cleanupErrors=[];
    const child = spawn(binary.command, [...(binary.args ?? []), ...args], {cwd,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    const signalGroup = signal => {
      if(closed || !child.pid)return;
      try { if(process.platform!=='win32')process.kill(-child.pid,signal);else child.kill(signal); }
      catch(error){
        if(error.code==='ESRCH' || (error.code==='EPERM' && (leaderExited || closed || child.exitCode!==null || child.signalCode!==null)))return;
        cleanupErrors.push(error.message);
      }
    };
    const settle = (code=child.exitCode,signal=child.signalCode) => {
      if(closed)return;
      closed=true;clearTimeout(timer);clearTimeout(idle);clearTimeout(killTimer);clearTimeout(exitTimer);clearTimeout(completionTimer);
      code ??= exitedCode ?? null;signal ??= exitedSignal ?? null;
      if(!completed&&buffer.trim())failure = failure ?? 'cut JSONL event (missing newline)';
      resolve({code:completed&&!failure&&(code===0||signal==='SIGTERM'||signal==='SIGKILL')?0:code,signal,failure,...(cleanupErrors.length?{cleanupErrors}:{}),...(completed?{completed:true}:{})});
    };
    const forceClose = () => {
      signalGroup('SIGKILL');
      child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();
      settle(child.exitCode ?? (completed&&!failure&&child.signalCode===null?0:null));
    };
    const stop = reason => {
      if (closed || (failure && reason!=='host timeout')) return;
      failure = reason==='host timeout' && failure && !failure.startsWith('host timeout') ? `host timeout; ${failure}` : failure ?? reason;
      clearTimeout(idle);clearTimeout(completionTimer);clearTimeout(killTimer);
      signalGroup('SIGTERM');
      killTimer = setTimeout(forceClose,cleanupGraceMs);
    };
    const send = value => {
      if (closed || child.stdin.destroyed) throw new Error('host stdin closed before reply');
      const data = typeof value === 'string' ? value : JSON.stringify(value)+'\n';
      fs.appendFileSync(sent,data);
      child.stdin.write(data);
    };
    const controls = { send, stop, complete:()=>{
      if(closed || completed)return;
      completed=true;clearTimeout(idle);child.stdin.end();
      // Let an already completed CLI exit before terminating any following stage.
      completionTimer=setTimeout(()=>{
        signalGroup('SIGTERM');
        killTimer=setTimeout(forceClose,cleanupGraceMs);
      },25);
    }, end:()=>child.stdin.end(), idle:()=>{
      clearTimeout(idle);if(idleMs)idle=setTimeout(()=>Promise.resolve(onIdle?.(controls)).catch(e=>stop(e.message)),idleMs);
    }};
    const timer = setTimeout(()=>stop('host timeout'),timeoutMs);
    child.on('error',e=>stop(e.message));
    child.stdin.on('error',e=>stop(`stdin: ${e.message}`));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      if(closed)return;
      clearTimeout(idle);
      fs.appendFileSync(trace,chunk);buffer += chunk.toString('utf8');
      let nl;while((nl=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,nl);buffer=buffer.slice(nl+1);lineNumber++;if(!line.trim()||failure||completed)continue;
        try {const event=JSON.parse(line);onEvent?.(event,controls,lineNumber);} catch(e){stop(`invalid host event: ${e.message}`);}
      }
    });
    child.stderr.on('data',chunk=>{if(!closed)fs.appendFileSync(stderr,chunk);});
    child.on('exit',(code,signal)=>{
      leaderExited=true;exitedCode=code;exitedSignal=signal;
      if(closed)return;
      clearTimeout(completionTimer);
      signalGroup('SIGTERM');
      exitTimer=setTimeout(forceClose,cleanupGraceMs);
    });
    child.on('close',settle);
    child.on('spawn',()=>{try{if(input!==undefined)send(input);else child.stdin.end();}catch(e){stop(e.message);}});
  });
}
