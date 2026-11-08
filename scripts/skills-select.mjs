#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateQaConfig } from './qa-recipe.mjs';
import { loadCatalog } from './skills-catalog.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8'});
const matches = (file, rule) => rule.endsWith('/') ? file.startsWith(rule) : file === rule;

export function selectScenarios({indexFile, worktree, base, head = 'HEAD', hosts = ['claude','codex'], full = false, purpose = 'change'}) {
  if(!['change','release','acceptance'].includes(purpose))throw new Error('invalid selection purpose');
  worktree = fs.realpathSync(worktree);
  const catalog = loadCatalog(indexFile);
  if (!hosts.length || new Set(hosts).size !== hosts.length || hosts.some(h => !['claude','codex'].includes(h))) throw new Error('invalid hosts');
  head = git(worktree,'rev-parse','--verify',`${head}^{commit}`).trim();
  base = git(worktree,'merge-base',base,head).trim();
  const changed = git(worktree,'diff','--name-only','--no-renames','-z',`${base}...${head}`).split('\0').filter(Boolean);
  const relativeIndex = path.relative(worktree,catalog.indexFile).split(path.sep).join('/');
  const inRepo = !relativeIndex.startsWith('../');
  if (inRepo) {
    for (const [file, bytes] of catalog.files) {
      const relative = path.relative(worktree,file).split(path.sep).join('/');
      if (!Buffer.from(git(worktree,'show',`${head}:${relative}`)).equals(bytes)) throw new Error(`catalog differs from committed head: ${relative}`);
    }
    const exists = git(worktree,'ls-tree','--name-only',base,'--',relativeIndex).trim();
    const previous = exists ? JSON.parse(git(worktree,'show',`${base}:${relativeIndex}`)) : {stages:[]};
    const current = new Set(catalog.index.stages.flatMap(s => s.scenarios));
    for (const stage of previous.stages ?? []) for (const scenario of stage.scenarios ?? []) {
      if (!current.has(scenario)) throw new Error(`removed scenario: ${scenario}; restore or explicitly repair the catalog contract`);
    }
  }
  const catalogPaths = new Set([...catalog.files.keys()].map(f => path.relative(worktree,f).split(path.sep).join('/')));
  const all = purpose==='release' || purpose==='acceptance' || full || changed.some(f => catalog.index.sharedFiles.includes(f) || (catalogPaths.has(f) && ![...catalog.scenarios.values()].some(s =>
    f === path.relative(worktree,s.file).split(path.sep).join('/') || f === path.relative(worktree,path.join(path.dirname(s.file),'rubric.md')).split(path.sep).join('/'))));
  const affected = catalog.index.stages.filter(s => all || changed.some(f => s.files.some(rule => matches(f,rule)) ||
    s.scenarios.some(relative => matches(f,path.relative(worktree,path.join(catalog.root,path.dirname(relative))).split(path.sep).join('/')+'/')))).map(s => s.id);
  const uncovered=affected.length?[]:changed.filter(file=>['skills/','references/','templates/'].some(prefix=>file.startsWith(prefix)));
  const wanted = new Map();
  for (const id of affected) {
    const stage = catalog.stages.get(id);
    for (const scenario of catalog.scenarios.values()) if (scenario.stage === id) wanted.set(`${id}/${scenario.id}`,'changed');
    for (const neighbor of stage.neighbors) wanted.set(`${neighbor}/${catalog.stages.get(neighbor).main}`, wanted.get(`${neighbor}/${catalog.stages.get(neighbor).main}`) ?? 'neighbor');
  }
  const units = [], covered = new Set();
  for (const id of affected) {
    const stage = catalog.stages.get(id);
    for (const scenario of catalog.scenarios.values()) if (scenario.stage === id) {
      const chain = scenario.id === stage.main ? stage.chain.map(s => `${s}/${catalog.stages.get(s).main}`) : [`${id}/${scenario.id}`];
      units.push({id:`${id}-${scenario.id}`,target:`${id}/${scenario.id}`,scenarios:chain,
        ...(scenario.id === stage.main && stage.chainSeed ? {seed:stage.chainSeed} : {})});
      chain.forEach(key => covered.add(key));
    }
  }
  for (const key of wanted.keys()) if (!covered.has(key)) units.push({id:key.replace('/','-'),target:key,scenarios:[key]});
  if(purpose==='release'&&catalog.index.release){
    const chain=catalog.index.release.stages.map(id=>`${id}/${catalog.stages.get(id).main}`);
    units.splice(0,units.length,{id:'release',target:chain[0],scenarios:chain});
  }
  const expectedItems = units.flatMap(unit => hosts.flatMap(host => unit.scenarios.map(key => ({
    ...scenarioExpectation(unit.id,key,host)
  }))));
  return {schemaVersion:1,purpose,status:uncovered.length?'uncovered':units.length?'selected':'not-required',uncovered,indexFile:catalog.indexFile,catalogDigest:catalog.digest,base,head,changed,affected,
    selected:purpose==='release'&&catalog.index.release?units[0].scenarios.map(scenario=>({scenario,reason:'release'})):[...wanted].map(([scenario,reason])=>({scenario,reason})),hosts,units,expectedItems};
}

export function scenarioExpectation(unit, scenario, host) {
  return {id:`${unit}:${scenario}:${host}`,source:'scenario',expectation:`${scenario} / ${host} / ${unit}: conversation, word replies and fresh monotest records`,unit,scenario,host};
}

// The host saves these inputs before any scenario runs; the certificate never selects.
export function selectQaScenarios({config, worktree, base, head='HEAD', purpose='change', expected, taskExpectedFile, output}) {
  if (!['change','release','acceptance'].includes(purpose)) throw new Error('invalid selection purpose');
  if (config.qa !== undefined) validateQaConfig(config.qa,config);
  const skills=config.qa?.skills;
  let selection;
  if (!skills || (purpose==='change' && !skills.perChange)) {
    const revision=git(worktree,'rev-parse','--verify',`${head}^{commit}`).trim();
    const catalog=skills?loadCatalog(path.resolve(worktree,skills.indexFile)):null;
    selection={...(catalog?{indexFile:catalog.indexFile,catalogDigest:catalog.digest}:{}),schemaVersion:1,status:'not-required',base:git(worktree,'merge-base',base,revision).trim(),head:revision,hosts:skills?.hosts??[],units:[],expectedItems:[],uncovered:[]};
  } else selection=selectScenarios({indexFile:path.resolve(worktree,skills.indexFile),worktree,base,head,hosts:skills.hosts,full:purpose!=='change',purpose});
  if (taskExpectedFile) {
    if (!expected || !Array.isArray(expected.expectedItems) || expected.expectedItems.some(item=>!item?.id || !item.expectation || !item.source)) throw new Error('independent expectedItems required');
    if ((expected.head && expected.head!==selection.head) || (expected.base && expected.base!==selection.base)) throw new Error('task expectations head/base mismatch');
    const expectedItems=[...expected.expectedItems,...selection.expectedItems];
    if (new Set(expectedItems.map(item=>item.id)).size!==expectedItems.length) throw new Error('duplicate expected item');
    if(selection.uncovered.length) throw new Error('uncovered scenario selection cannot save task expectations');
    fs.writeFileSync(taskExpectedFile,JSON.stringify({...expected,head:selection.head,base:selection.base,expectedItems},null,2)+'\n',{flag:'wx'});
  }
  if (output) saveSelection(output,selection);
  return selection;
}

export function saveSelection(file, selection) {
  fs.writeFileSync(file,JSON.stringify(selection,null,2)+'\n',{flag:'wx'});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const request = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const selection = request.configFile
      ? selectQaScenarios({...request,config:JSON.parse(fs.readFileSync(request.configFile,'utf8')),expected:request.expectedFile?JSON.parse(fs.readFileSync(request.expectedFile,'utf8')):request.expected})
      : selectScenarios(request);
    if (!request.configFile) saveSelection(request.output,selection);
    console.log(JSON.stringify(selection,null,2));
    if(selection.status==='uncovered')process.exitCode=2;
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
