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
  // Keep a failed envelope intact before unwrapping any of its payloads.
  if(value?.isError || value?.is_error)return value;
  if(typeof value?.content==='string')return decodeResult(value.content);
  if(value?.structuredContent)return decodeResult(value.structuredContent);
  if(Array.isArray(value?.content)&&value.content.length===1)return decodeResult(value.content);
  if(Array.isArray(value)&&value.length===1&&['text','input_text'].includes(value[0]?.type))return decodeResult(value[0]);
  if(['text','input_text'].includes(value?.type)&&typeof value.text==='string')return decodeResult(value.text);
  return value;
}
export class MissingEvidence extends Error {}

export function workspaceEvidence(result, proof) {
  if (result?.is_error || result?.isError) return 'missing';
  let value = decodeResult(result);
  if (value?.is_error || value?.isError) return 'missing';
  for (const key of proof.path) {
    if (value?.is_error || value?.isError || value == null || !Object.hasOwn(Object(value), key)) return 'missing';
    value = value[key];
  }
  if (value?.is_error || value?.isError || value === undefined) return 'missing';
  return value === proof.equals ? 'confirmed' : 'mismatch';
}
export function workspaceMatches(result, proof) {
  return workspaceEvidence(result, proof) === 'confirmed';
}

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
export const isWrite = name => /^mcp__monotest__(save|create|update|delete|mark|merge|share|unshare|submit|resolve|retire|restore|prepare)/.test(name);
export function toolViolation(name, input, scenario, confirmed) {
  if(typeof name!=='string')return 'missing tool name';
  if(name.startsWith('mcp__')&&!name.startsWith('mcp__monotest__')&&!name.startsWith('mcp__paper__'))return `MCP outside test servers: ${name}`;
  if(isWrite(name)&&!confirmed)return 'write before workspace confirmation';
  if(!scenario.allowedTools.includes(name))return `tool not on scenario list: ${name}`;
  if(['Agent','Task'].includes(name)&&/^mono-mono-/.test(input?.subagent_type??''))return 'installed stage agent outside tested copy';
  if(name==='Bash' || name==='exec_command'){
    // Commands are authorized literally by the scenario, never by URL substrings.
    const field = name === 'Bash' ? 'command' : 'cmd';
    const alias = name === 'Bash' ? 'cmd' : 'command';
    if (input && Object.hasOwn(input, alias)) return 'conflicting command field';
    const command = input?.[field];
    if (typeof command !== 'string') return 'missing native command field';
    if(!scenario.allowedCommands?.includes(command))return 'command not on scenario list';
  }
  return null;
}

// Codex has no pre-execution prompt. This conservative name audit does not
// establish execution; workspaceReadCall separately requires the probe form.
export function codexToolCalls(item) {
  if(['message','reasoning','function_call_output','custom_tool_call_output'].includes(item?.type))return [];
  if(!['function_call','custom_tool_call'].includes(item?.type))throw new MissingEvidence(`unsupported native item type: ${item?.type}`);
  if (typeof item.name !== 'string' || typeof item.call_id !== 'string' || !item.call_id.trim())
    throw new MissingEvidence('tool name and native call id required');
  if(item.name!=='exec')return [{name:item.name,input:parseInput(item),callId:item.call_id}];
  const code=nativeCallSource(item);
  if(typeof code!=='string')throw new MissingEvidence('missing exec source');
  if(/\\|\btools\b(?!\.\w+\s*\()|\b(?:globalThis|Reflect|Proxy|this)\b|\beval\s*\(|\bFunction\s*\(|\bimport\s*\(/.test(code))throw new MissingEvidence('unsupported escaped or indirect exec source');
  const calls=[...code.matchAll(/\btools\.(\w+)\s*\(/g)];
  if(!calls.length)throw new MissingEvidence('exec without auditable direct tool calls');
  return calls.map((match,i)=>{
    const name=match[1],segment=code.slice(match.index,calls[i+1]?.index??code.length);
    let input={};
    if(name==='exec_command'){
      const argument = segment.slice(segment.indexOf('(') + 1).trim();
      const literal = /^(\{[\s\S]*\})\s*\)/.exec(argument);
      if (!literal) throw new MissingEvidence('exec_command audit requires a complete JSON argument object');
      try { input = JSON.parse(literal[1]); }
      catch { throw new MissingEvidence('exec_command arguments are not a complete JSON object'); }
      if (!input || Array.isArray(input) || typeof input.cmd !== 'string')
        throw new MissingEvidence('exec_command audit requires a literal JSON command');
    }
    return {name,input,callId:item.call_id};
  });
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
