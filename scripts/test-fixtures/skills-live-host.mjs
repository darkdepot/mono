// Full real event ordering, depersonalized payloads; fixture turn completion is explicit.
import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';
const [mode,repo,...args]=process.argv.slice(2),host=mode.startsWith('claude')?'claude':'codex';
const sample=JSON.parse(fs.readFileSync(path.join(repo,`evals/scenarios/probe/live/${host}-full-shape.json`)));
const rows=structuredClone(sample.events),out=e=>process.stdout.write(JSON.stringify(e)+'\n');
if(host==='claude'){
 if(mode==='claude-fixed'){const event=rows[196];const block=event.message.content.find(b=>b.type==='thinking');block.type='text';block.text='Что: тестовый результат. Дальше: Research.';delete block.thinking;}
 let cursor=0;
 const pump=end=>{while(cursor<end){const e=rows[cursor++];out(e);if(e.type==='control_request')break;}};
 const read=readline.createInterface({input:process.stdin});
 read.on('line',line=>{const m=JSON.parse(line);if(m.type==='user'&&cursor===0)pump(sample.confirmationEnd);else if(m.type==='user'||m.type==='control_response')pump(rows.length);});
 read.on('close',()=>process.exit(0));
}else{
 if(args[0]==='plugin')process.exit(0);
 // The depersonalizer replaced MCP server/tool values with "sample". Restore
 // this fixture's test server and initial read identity; later tools stay masked.
 for(const [i,e] of rows.entries())if(e.payload?.item?.type==='McpToolCall'&&e.payload.item.server==='sample'){
  e.payload.item.server='monotest';if(i<sample.confirmationEnd)e.payload.item.tool='get_workspace';
 }
 const file=path.join(process.env.CODEX_HOME,'sessions','rollout-synthetic-thread.jsonl');fs.mkdirSync(path.dirname(file),{recursive:true});
 const existing=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse):[];
 let next=existing.length===0?rows.slice(0,sample.confirmationEnd):existing.length===sample.confirmationEnd?rows.slice(sample.confirmationEnd,sample.windowTurnEnd):rows.slice(sample.windowTurnEnd);
 if(existing.length===sample.windowTurnEnd){
  const answer=next.find(e=>e.type==='response_item'&&e.payload?.type==='message'&&e.payload.role==='user');answer.payload.content=[{type:'input_text',text:args.at(-1)}];
  // Source was cut in the following stage. This is the fixture's successful boundary,
  // copied from its recorded native terminal form, never an observed live success.
  const terminal=structuredClone(rows[sample.windowTurnEnd-1]);
  terminal.payload.turn_id=next.findLast(e=>e.payload?.type==='task_started')?.payload.turn_id;
  next.push(terminal);
 }
 fs.writeFileSync(file,[...existing,...next].map(e=>JSON.stringify(e)).join('\n')+'\n');out({type:'thread.started',thread_id:'synthetic-thread'});out({type:'turn.completed'});
}
