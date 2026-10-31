import fs from 'node:fs';
import path from 'node:path';

export function mcpConfig(servers) {
  if (!servers?.monotest || Object.keys(servers).some(k=>!['monotest','paper'].includes(k))) throw new Error('only monotest and optional Paper servers allowed');
  return {mcpServers:servers};
}
export function privateCodexHome(home, authFile, servers) {
  mcpConfig(servers);
  fs.mkdirSync(home); // Never reuse a user home or silently trust existing config.
  if (!path.isAbsolute(authFile) || !fs.statSync(authFile).isFile()) throw new Error('explicit Codex auth file required');
  fs.symlinkSync(authFile,path.join(home,'auth.json'));
  let config='[mcp_servers.linear]\nenabled = false\n';
  for(const [name,value] of Object.entries(servers)){
    if(Object.keys(value).some(k=>!['url','command','args'].includes(k)) ||
      (typeof value.url!=='string' && typeof value.command!=='string'))throw new Error('MCP connection must use url or command/args');
    config+=`\n[mcp_servers.${name}]\n`;
    for(const [k,v] of Object.entries(value)){
      if((k==='args'&&(!Array.isArray(v)||v.some(a=>typeof a!=='string'))) || (k!=='args'&&typeof v!=='string')) throw new Error('invalid MCP connection');
      config+=`${k} = ${JSON.stringify(v)}\n`;
    }
  }
  fs.writeFileSync(path.join(home,'config.toml'),config);
}
export function decodeResult(value) {
  if(typeof value==='string'){try{return decodeResult(JSON.parse(value));}catch{return value;}}
  if(typeof value?.content==='string')return decodeResult(value.content);
  if(value?.structuredContent)return value.structuredContent;
  if(Array.isArray(value?.content)&&value.content.length===1&&value.content[0].type==='text')return decodeResult(value.content[0].text);
  if(Array.isArray(value)&&value.length===1&&value[0].type==='text')return decodeResult(value[0].text);
  return value;
}
export function workspaceMatches(result,proof){
  if(result?.is_error || result?.isError)return false;
  let v=decodeResult(result);if(v?.is_error||v?.isError)return false;for(const key of proof.path){v=v?.[key];}
  return v===proof.equals;
}
export const isWrite = name => /^mcp__monotest__(save|create|update|delete|mark|merge|share|unshare|submit|resolve|retire|restore|prepare)/.test(name);
export function toolViolation(name, input, scenario, confirmed) {
  if(typeof name!=='string')return 'missing tool name';
  if(name.startsWith('mcp__')&&!name.startsWith('mcp__monotest__')&&!name.startsWith('mcp__paper__'))return `MCP outside test servers: ${name}`;
  if(isWrite(name)&&!confirmed)return 'write before workspace confirmation';
  if(!scenario.allowedTools.includes(name))return `tool not on scenario list: ${name}`;
  if(['Agent','Task'].includes(name)&&/^mono-mono-/.test(input?.subagent_type??''))return 'installed stage agent outside tested copy';
  if(name==='Bash' || name==='exec_command'){
    // Commands are authorized literally by the scenario, never by URL substrings.
    const command=input?.command??input?.cmd;
    if(!scenario.allowedCommands?.includes(command))return 'command not on scenario list';
  }
  return null;
}

// Codex has no pre-execution prompt. Audit only observed direct calls; reject
// dynamic dispatch instead of claiming to understand arbitrary JavaScript.
export function codexToolCalls(item) {
  if(!['function_call','custom_tool_call'].includes(item?.type))return [];
  if(item.name!=='exec')return [{name:item.name,input:parseInput(item),callId:item.call_id}];
  const code=item.input??item.arguments;
  if(typeof code!=='string')throw new Error('missing exec source');
  if(/\btools\b(?!\.\w+\s*\()|\b(?:globalThis|Reflect|Proxy|this)\b|\\u[0-9a-fA-F]{4}|\beval\s*\(|\bFunction\s*\(|\bimport\s*\(/.test(code))throw new Error('unsupported indirect exec tools');
  const calls=[...code.matchAll(/\btools\.(\w+)\s*\(/g)];
  if(!calls.length)throw new Error('exec without auditable direct tool calls');
  return calls.map((match,i)=>{
    const name=match[1],segment=code.slice(match.index,calls[i+1]?.index??code.length);
    let input={};
    if(name==='exec_command'){
      const argument = segment.slice(segment.indexOf('(') + 1).trim();
      const literal = /^(\{[\s\S]*\})\s*\)/.exec(argument);
      if (!literal) throw new Error('exec_command audit requires a complete JSON argument object');
      input = JSON.parse(literal[1]);
      if (!input || Array.isArray(input) || typeof input.cmd !== 'string')
        throw new Error('exec_command audit requires a literal JSON command');
    }
    return {name,input,callId:item.call_id};
  });
}
function parseInput(item){const raw=item.arguments??item.input;return typeof raw==='string'?JSON.parse(raw):raw??{};}
