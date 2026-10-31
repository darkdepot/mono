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
  let config='[mcp_servers.linear]\nurl = "https://mcp.linear.app/mcp"\nenabled = false\n';
  for(const [name,value] of Object.entries(servers)){
    if(Object.keys(value).some(k=>!['url','command','args'].includes(k)) ||
      (typeof value.url!=='string' && typeof value.command!=='string'))throw new Error('MCP connection must use url or command/args');
    config+=`\n[mcp_servers.${name}]\ndefault_tools_approval_mode = "approve"\n`;
    for(const [k,v] of Object.entries(value)){
      if((k==='args'&&(!Array.isArray(v)||v.some(a=>typeof a!=='string'))) || (k!=='args'&&typeof v!=='string')) throw new Error('invalid MCP connection');
      config+=`${k} = ${JSON.stringify(v)}\n`;
    }
  }
  fs.writeFileSync(path.join(home,'config.toml'),config);
}
export class MissingEvidence extends Error {}

// The driver prescribes this closed form for the probe's tools/exec route.
// Merely mentioning a tool in other JavaScript cannot establish a read.
export function workspaceReadCode(proof) {
  return `const r = await tools.${proof.tool}(${JSON.stringify(proof.input ?? {})}); text(r);`;
}
export function workspaceReadCall(item, proof) {
  if (item.name === proof.tool && item.type === 'function_call') {
    parseInput(item);
    return true;
  }
  return item.name === 'exec' && nativeCallSource(item).trim() === workspaceReadCode(proof);
}
// Before confirmation MCP actions must be recognizable reads. After it, all
// monotest tools are available; this does not classify command contents.
export const isWrite = name => name.startsWith('mcp__') ? !/^mcp__(?:monotest|paper)__(get|list|search|read|fetch)_/.test(name) : ['Write','Edit'].includes(name);
export function toolViolation(name, input, scenario, confirmed) {
  if(typeof name!=='string')return 'missing tool name';
  if(name.startsWith('mcp__')&&!name.startsWith('mcp__monotest__')&&!name.startsWith('mcp__paper__'))return `MCP outside test servers: ${name}`;
  if(isWrite(name)&&!confirmed)return 'write before workspace confirmation';
  const allowed=scenario.allowedTools??'*';
  if(!allowed.includes('*')&&!name.startsWith('mcp__monotest__')&&!allowed.includes(name))return `tool not on scenario list: ${name}`;
  if(['Agent','Task'].includes(name)&&/^mono-mono-/.test(input?.subagent_type??''))return 'installed stage agent outside tested copy';
  return null;
}

// Codex has no pre-execution prompt. This conservative name audit does not
// establish execution; workspaceReadCall separately requires the probe form.
export function codexToolCalls(item) {
  if(!['function_call','custom_tool_call'].includes(item?.type))return [];
  if (typeof item.name !== 'string' || typeof item.call_id !== 'string' || !item.call_id.trim())
    throw new MissingEvidence('tool name and native call id required');
  if(item.name!=='exec'){let input={};try{input=JSON.parse(nativeCallSource(item));}catch{}return [{name:item.name,input,callId:item.call_id}];}
  const code=nativeCallSource(item);
  const names=new Set([...code.matchAll(/\btools\.(\w+)\s*\(/g)].map(m=>m[1]));
  // Names are evidence, not a JavaScript parser or a command security policy.
  for(const match of code.matchAll(/\bmcp__\w+/g))if(!match[0].startsWith('mcp__monotest__')&&!match[0].startsWith('mcp__paper__'))names.add(match[0]);
  return [...names].map(name=>({name,input:{},callId:item.call_id}));
}
function nativeCallSource(item) {
  const field = item.type === 'custom_tool_call' ? 'input' : 'arguments';
  const alias = field === 'input' ? 'arguments' : 'input';
  if (Object.hasOwn(item, alias) || typeof item[field] !== 'string')
    throw new MissingEvidence('missing or conflicting native tool input field');
  return item[field];
}
function parseInput(item) {
  try { return JSON.parse(nativeCallSource(item)); }
  catch (error) {
    if (error instanceof MissingEvidence) throw error;
    throw new MissingEvidence('native tool arguments are not JSON');
  }
}
