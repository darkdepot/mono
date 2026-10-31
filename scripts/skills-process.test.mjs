import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { test } from 'node:test';import { hostProcess } from './skills-process.mjs';
test('cleanup after parent exit preserves the primary failure without kill EPERM',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skills-exit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let kills=0;t.mock.method(process,'kill',()=>{kills++;throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
 const result=await hostProcess({binary:{command:process.execPath,args:[path.resolve('scripts/test-fixtures/skills-host.mjs'),'exited-group',process.cwd()]},args:[],cwd:dir,env:process.env,trace:path.join(dir,'trace'),sent:path.join(dir,'sent'),stderr:path.join(dir,'stderr'),timeoutMs:1000,onEvent:(_,c)=>setTimeout(()=>c.stop('original error'),100)});
 assert.equal(result.failure,'original error');assert.equal(kills,0);
});
