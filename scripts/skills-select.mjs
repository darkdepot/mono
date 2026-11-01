#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './skills-catalog.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8'});
const matches = (file, rule) => rule.endsWith('/') ? file.startsWith(rule) : file === rule;

export function selectScenarios({indexFile, worktree, base, head = 'HEAD', hosts = ['claude','codex']}) {
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
  const all = changed.some(f => catalog.index.sharedFiles.includes(f) || (catalogPaths.has(f) && ![...catalog.scenarios.values()].some(s =>
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
  const expectedItems = units.flatMap(unit => hosts.flatMap(host => unit.scenarios.map(key => ({
    id:`${unit.id}:${key}:${host}`,source:'scenario',unit:unit.id,scenario:key,host
  }))));
  return {schemaVersion:1,status:uncovered.length?'uncovered':units.length?'selected':'not-required',uncovered,indexFile:catalog.indexFile,catalogDigest:catalog.digest,base,head,changed,affected,
    selected:[...wanted].map(([scenario,reason])=>({scenario,reason})),hosts,units,expectedItems};
}

export function saveSelection(file, selection) {
  fs.writeFileSync(file,JSON.stringify(selection,null,2)+'\n',{flag:'wx'});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const request = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const selection = selectScenarios(request); saveSelection(request.output,selection);
    console.log(JSON.stringify(selection,null,2));
    if(selection.status==='uncovered')process.exitCode=2;
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
