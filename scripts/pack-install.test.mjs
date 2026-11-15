import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { atomicJson } from './runtime.mjs';
import { installPack } from './pack-install.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function fixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-pack-install-'));
  t.after(() => {
    const pulse = path.join(tmp, 'products/mono/watcher.json');
    if (fs.existsSync(pulse)) {
      const pid = read(pulse).pid;
      if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ } }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const home = path.join(tmp, 'home'), repo = path.join(tmp, 'repo'), root = path.join(tmp, 'products/mono'), bin = path.join(tmp, 'bin');
  for (const dir of [home, repo, root, bin]) fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', CODEX_HOME: path.join(home, '.codex'), PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    PACK_FIXTURE: tmp, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'skills/ship'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'scripts/watch-workers.mjs'), `import fs from 'node:fs'; import path from 'node:path'; import {execFileSync} from 'node:child_process';
const root=process.argv[process.argv.indexOf('--root')+1],startedAt=new Date().toISOString(),version=fs.readFileSync(new URL('../VERSION',import.meta.url),'utf8').trim();
const pulse=()=>fs.writeFileSync(path.join(root,'watcher.json'),JSON.stringify({pid:process.pid,procStart:execFileSync('ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim(),packVersion:version,startedAt,beatAt:new Date().toISOString(),intervalSec:1}));pulse();setInterval(pulse,1000);
`);
  fs.writeFileSync(path.join(repo, 'skills/ship/SKILL.md'), '# Ship\n');
  fs.writeFileSync(path.join(repo, 'executable'), '#!/bin/sh\n'); fs.chmodSync(path.join(repo, 'executable'), 0o755);
  fs.symlinkSync('VERSION', path.join(repo, 'version-link'));
  const releases = {};
  for (const version of ['1.0.0', '1.1.0']) {
    fs.writeFileSync(path.join(repo, 'VERSION'), `${version}\n`);
    git('add', '.'); git('commit', '-qm', version); git('tag', `v${version}`);
    const folder = path.join(tmp, version); fs.mkdirSync(folder);
    execFileSync('tar', ['-xf', '-','-C', folder], { input: execFileSync('git', ['archive', `v${version}`], { cwd: repo, env }) });
    releases[`v${version}`] = { folder, version, sha: git('rev-parse', 'HEAD') };
  }
  atomicJson(path.join(tmp, 'releases.json'), releases);
  atomicJson(path.join(tmp, 'fault.json'), {});
  atomicJson(path.join(root, 'control.json'), { state: 'idle', custom: 'preserve' });
  atomicJson(path.join(root, 'workers.json'), {});
  const config = path.join(tmp, 'product.json'); atomicJson(config, {});
  const fake = `#!${process.execPath}
const fs=require('fs'),path=require('path');
const tmp=process.env.PACK_FIXTURE,args=process.argv.slice(2),tool=path.basename(process.argv[1]);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true,verbatimSymlinks:true});fs.writeFileSync(p,JSON.stringify(v))};
const profile=tool==='claude'?process.env.CLAUDE_CONFIG_DIR:process.env.CODEX_HOME;
const releases=read(path.join(tmp,'releases.json')),fault=read(path.join(tmp,'fault.json'));
fs.appendFileSync(path.join(tmp,'calls.jsonl'),JSON.stringify({tool,args,profile})+'\\n');
const installed=()=>{if(tool==='claude')return read(path.join(profile,'plugins/installed_plugins.json')).plugins['mono@mono-marketplace'][0].installPath; const v=/ref = "([^"]+)"/.exec(fs.readFileSync(path.join(profile,'config.toml'),'utf8'))[1];return path.join(profile,'plugins/cache/mono-marketplace/mono',releases[v].version)};
if(args[0]==='-p'||args[0]==='exec') {
 const text=JSON.stringify({skill:'mono:ship',path:fault.skill&&installed().endsWith('1.1.0')?'wrong':path.join(installed(),'skills/ship/SKILL.md')});
 console.log(tool==='claude'?JSON.stringify({result:text}):JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));process.exit(0);
}
if(args[0]!=='plugin')process.exit(11);
if(tool==='claude') {
 if(args[1]==='marketplace'&&args[2]==='add') {
  write(path.join(profile,'settings.json'),{extraKnownMarketplaces:{'mono-marketplace':{source:{source:'github',repo:'darkdepot/mono'}}}});
  write(path.join(profile,'plugins/known_marketplaces.json'),{'mono-marketplace':{source:{source:'github',repo:'darkdepot/mono'}}});process.exit(0);
 }
 const settings=read(path.join(profile,'settings.json')),known=read(path.join(profile,'plugins/known_marketplaces.json'));
 const a=settings.extraKnownMarketplaces['mono-marketplace'].source.ref,b=known['mono-marketplace'].source.ref;
 if(a!==b||fault.catalog&&a==='v1.1.0'){console.error("source doesn't match its extraKnownMarketplaces entry");process.exit(1)}
 if(args[1]==='list'){console.log('{}');process.exit(0)}
 if(args[1]==='marketplace'){process.exit(0)}
 if(!['update','install'].includes(args[1]))process.exit(12);
 const priorPlugins=fs.existsSync(path.join(profile,'plugins/installed_plugins.json'))?read(path.join(profile,'plugins/installed_plugins.json')).plugins:{};
 if(args[1]==='update'&&!(priorPlugins['mono@mono-marketplace']||[]).some(row=>!row.projectPath))process.exit(18);
 const r=releases[a],dest=path.join(profile,'plugins/cache/mono-marketplace/mono',r.version);
 if(args[1]==='update'&&(priorPlugins['mono@mono-marketplace']||[]).some(row=>!row.projectPath&&row.version===r.version)){console.log('Already at version '+r.version);process.exit(0)}
 fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(path.dirname(dest),{recursive:true,verbatimSymlinks:true});fs.cpSync(r.folder,dest,{recursive:true,verbatimSymlinks:true});
 if(fault.tree&&a==='v1.1.0'&&profile.endsWith('.claude-second'))fs.writeFileSync(path.join(dest,'VERSION'),'broken');
 const old=fs.existsSync(path.join(profile,'plugins/installed_plugins.json'))?read(path.join(profile,'plugins/installed_plugins.json')).plugins:{};
 write(path.join(profile,'plugins/installed_plugins.json'),{version:2,plugins:{...old,'mono@mono-marketplace':[{scope:'user',installPath:dest,version:r.version,gitCommitSha:fault.commit&&a==='v1.1.0'?'0'.repeat(40):r.sha},...(old['mono@mono-marketplace']||[]).filter(row=>row.projectPath)],...(fault.local?{'mono@mono-dev':[{installPath:'/local/mono',projectPath:'/product'}]}:{})}});
 if(fault.crash){write(path.join(tmp,'fault.json'),{});process.kill(process.ppid,'SIGKILL')}
 if(fault.replace&&a==='v1.1.0')process.exit(17);
} else {
 if(args[1]==='marketplace'){
  const ref=args[args.indexOf('--ref')+1];fs.mkdirSync(profile,{recursive:true,verbatimSymlinks:true});fs.writeFileSync(path.join(profile,'config.toml'),'[marketplaces.mono-marketplace]\\nsource_type = "git"\\nsource = "https://github.com/darkdepot/mono.git"\\nref = "'+ref+'"\\n');process.exit(0);
 }
 if(args[1]==='list'){
  let list=[];if(fs.existsSync(path.join(profile,'config.toml'))){const folder=installed();if(fs.existsSync(folder))list=[{pluginId:'mono@mono-marketplace',enabled:true,version:fs.readFileSync(path.join(folder,'VERSION'),'utf8').trim(),source:{source:'local',path:folder}}]}
  if(fault.codexLocal)list.push({pluginId:'mono@mono-dev',version:'0.0.0',source:{source:'local',path:'/local/codex-mono'}});
  console.log(JSON.stringify({installed:list}));process.exit(0);
 }
 if(args[1]!=='add')process.exit(13);
 const folder=installed(),v=path.basename(folder),r=releases['v'+v];
 fs.rmSync(path.join(profile,'plugins/cache/mono-marketplace/mono'),{recursive:true,force:true});fs.mkdirSync(path.dirname(folder),{recursive:true,verbatimSymlinks:true});fs.cpSync(r.folder,folder,{recursive:true,verbatimSymlinks:true});
 write(path.join(folder,'.codex-marketplace-install.json'),{revision:fault.codexRevision&&v==='1.1.0'?'0'.repeat(40):r.sha,ref_name:'v'+v});
 console.log(JSON.stringify({plugin:{installPath:folder}}));
}
`;
  for (const tool of ['claude', 'codex']) { fs.writeFileSync(path.join(bin, tool), fake); fs.chmodSync(path.join(bin, tool), 0o755); }
  const profiles = ['.claude', '.claude-second'].map(name => path.join(home, name));
  for (const profile of profiles) {
    atomicJson(path.join(profile, 'settings.json'), { custom: 'keep', extraKnownMarketplaces: { 'mono-marketplace': { autoUpdate: false, source: { source: 'github', repo: 'darkdepot/mono', ref: 'v1.0.0' } } } });
    atomicJson(path.join(profile, 'plugins/known_marketplaces.json'), { 'mono-marketplace': { source: { source: 'github', repo: 'darkdepot/mono', ref: 'v1.0.0' } } });
    const dest = path.join(profile, 'plugins/cache/mono-marketplace/mono/1.0.0');
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.cpSync(releases['v1.0.0'].folder, dest, { recursive: true, verbatimSymlinks: true });
    atomicJson(path.join(profile, 'plugins/installed_plugins.json'), { version: 2, plugins: { 'mono@mono-marketplace': [{ scope: 'user', installPath: dest, version: '1.0.0', gitCommitSha: releases['v1.0.0'].sha }] } });
  }
  const codex = env.CODEX_HOME, dest = path.join(codex, 'plugins/cache/mono-marketplace/mono/1.0.0');
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.cpSync(releases['v1.0.0'].folder, dest, { recursive: true, verbatimSymlinks: true });
  fs.writeFileSync(path.join(codex, 'config.toml'), '[marketplaces.mono-marketplace]\nref = "v1.0.0"\n');
  atomicJson(path.join(dest, '.codex-marketplace-install.json'), { revision: releases['v1.0.0'].sha });
  const options = { root, repo, tag: 'v1.1.0', config, home, env, profiles: [], removePlaces: [] };
  const events = [];
  const host = { processes: () => [], restartWatcher: async folder => { events.push(folder); assert.equal(read(path.join(root, 'control.json')).halt, true); } };
  const ps = `#!${process.execPath}
const a=process.argv.slice(2),stamp='Mon Jan  1 00:00:00 2024';
const group=process.env.PACK_REAL_GROUPS?require('child_process').execFileSync('/usr/bin/python3',['-I','-S','-c','import os,sys; print(os.getpgid(int(sys.argv[1])))',String(process.ppid)],{encoding:'utf8'}).trim():process.ppid;
if(a.includes('-p')) {try{process.kill(Number(a[a.indexOf('-p')+1]),0);console.log(stamp)}catch{process.exit(1)}}
else if(a.join(' ').includes('ppid='))console.log(process.ppid+' 1 '+group+' S '+stamp);
else if(a.join(' ').includes('lstart='))console.log(process.ppid+' '+stamp);
else console.log(process.ppid+' node');
`;
  fs.writeFileSync(path.join(bin, 'ps'), ps); fs.chmodSync(path.join(bin, 'ps'), 0o755);
  const runner = path.join(tmp, 'runner.mjs');
  fs.writeFileSync(runner, `import {installPack} from ${JSON.stringify(path.resolve('scripts/pack-install.mjs'))};
const options=${JSON.stringify({ root, repo, config, home, tag: 'v1.1.0', profiles: [], removePlaces: [] })};
const result=await installPack({...options,env:process.env},{processes:()=>[],...(process.env.PACK_REAL_WATCHER?{}:{restartWatcher:async()=>{}})});
console.log(JSON.stringify(result));process.exitCode=result.code;`);
  return { tmp, home, repo, root, bin, env, profiles, releases, options, host, events, runner,
    run: extra => installPack({ ...options, ...extra }, host),
    fault: value => atomicJson(path.join(tmp, 'fault.json'), value),
    calls: () => fs.existsSync(path.join(tmp, 'calls.jsonl')) ? fs.readFileSync(path.join(tmp, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [] };
}

function addClaudeProfile(f, place) {
  const prior = f.releases['v1.0.0'], folder = path.join(place, 'plugins/cache/mono-marketplace/mono/1.0.0');
  fs.mkdirSync(path.dirname(folder), { recursive: true }); fs.cpSync(prior.folder, folder, { recursive: true, verbatimSymlinks: true });
  const entry = { source: { source: 'github', repo: 'darkdepot/mono', ref: prior.tag ?? 'v1.0.0' } };
  atomicJson(path.join(place, 'settings.json'), { extraKnownMarketplaces: { 'mono-marketplace': { ...entry, autoUpdate: false } } });
  atomicJson(path.join(place, 'plugins/known_marketplaces.json'), { 'mono-marketplace': entry });
  atomicJson(path.join(place, 'plugins/installed_plugins.json'), { plugins: { 'mono@mono-marketplace': [{ scope: 'user', installPath: folder, version: prior.version, gitCommitSha: prior.sha }] } });
}

test('installs the released version in every auto-discovered profile and Codex; verifies fresh sessions before unhalt', async t => {
  const f = fixture(t), result = await f.run();
  assert.equal(result.outcome, 'installed', JSON.stringify(result));
  assert.equal(result.code, 0);
  assert.equal(result.places.length, 3);
  assert.ok(result.places.every(p => p.expected === '1.1.0' && p.actual === '1.1.0' && p.verified));
  for (const profile of f.profiles) {
    assert.equal(read(path.join(profile, 'settings.json')).extraKnownMarketplaces['mono-marketplace'].source.ref, 'v1.1.0');
    assert.equal(read(path.join(profile, 'plugins/known_marketplaces.json'))['mono-marketplace'].source.ref, 'v1.1.0');
  }
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
  assert.equal(f.events.length, 1);
  assert.equal(f.calls().filter(c => c.args[0] === '-p' || c.args[0] === 'exec').length, 3);
});

test('a persistent tree mismatch retries once then rolls EVERY place back to the immutable previous tags', async t => {
  const f = fixture(t); f.fault({ tree: true });
  const result = await f.run();
  assert.equal(result.outcome, 'rolled-back', JSON.stringify(result));
  assert.equal(result.code, 1);
  assert.ok(result.places.every(place => place.expected === '1.0.0' && place.actual === '1.0.0' && place.verified));
  assert.equal(f.calls().filter(c => c.profile === f.profiles[1] && c.args[1] === 'update').length, 3, 'two installation attempts and a downgrade');
  assert.ok(!f.calls().some(c => ['uninstall', 'remove', 'install'].includes(c.args[1])), 'downgrade uses update, never a destructive reinstall');
  const record = read(path.join(f.root, 'landing/install/v1.1.0.json'));
  assert.ok(record.places.every(place => place.previous.tag === 'v1.0.0'));
});

test('resume from partial install uses the original baseline and only delivers missing places', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const baseline = path.join(f.root, 'landing/install/v1.1.0.json'), snapshot = path.join(f.root, 'control.json.pre-update-1.1.0');
  const bytes = [fs.readFileSync(baseline), fs.readFileSync(snapshot)];
  // Model a process killed after one install and halt, retaining its first record.
  const prior = f.releases['v1.0.0'], dest = path.join(f.profiles[1], 'plugins/cache/mono-marketplace/mono/1.0.0');
  atomicJson(path.join(f.profiles[1], 'plugins/installed_plugins.json'), { plugins: { 'mono@mono-marketplace': [{ scope: 'user', version: prior.version, gitCommitSha: prior.sha, installPath: dest }] } });
  atomicJson(path.join(f.root, 'control.json'), { state: 'idle', custom: 'preserve', halt: true });
  const progressFile = path.join(f.root, 'landing/install/v1.1.0.progress.json'), progress = read(progressFile);
  progress.pauseActive = true; progress.pauseControl = read(snapshot); delete progress.outcome; atomicJson(progressFile, progress);
  const offset = f.calls().length, result = await f.run();
  assert.equal(result.outcome, 'installed', JSON.stringify(result));
  const installs = f.calls().slice(offset).filter(c => c.args[0] === 'plugin' && ['update', 'add'].includes(c.args[1]));
  assert.equal(installs.length, 1); assert.equal(installs[0].profile, f.profiles[1]);
  assert.deepEqual(fs.readFileSync(baseline), bytes[0]); assert.deepEqual(fs.readFileSync(snapshot), bytes[1]);
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('live or paused holders wait without installing; dead entries are named and left intact', async t => {
  for (const state of ['live', 'unknown', 'dead']) await t.test(state, async t => {
    const f = fixture(t), registry = path.join(f.root, 'workers.json');
    atomicJson(registry, { 'MONO-900': { issue: 'MONO-900', attempt: 1, packRoot: path.join(f.env.CODEX_HOME, 'plugins/cache/mono-marketplace/mono/1.0.0'), pid: state === 'unknown' ? null : 12345 } });
    const bytes = fs.readFileSync(registry);
    f.host.processes = () => state === 'live' ? [{ pid: 12345, command: 'worker', state: 'S' }] : [];
    const result = await installPack(f.options, f.host);
    assert.equal(result.outcome, state === 'dead' ? 'installed' : 'waiting', JSON.stringify(result));
    assert.equal(result.code, state === 'dead' ? 0 : 2);
    assert.deepEqual(result.holders.map(h => [h.product, h.issue, h.state]), [['mono', 'MONO-900', state]]);
    assert.deepEqual(fs.readFileSync(registry), bytes);
    if (state !== 'dead') assert.ok(!f.calls().some(c => ['update', 'add'].includes(c.args[1])));
  });
});

test('breaking installation requires every product idle with an empty registry', async t => {
  const f = fixture(t), other = path.join(f.tmp, 'products/other');
  atomicJson(path.join(other, 'control.json'), { state: 'active' }); atomicJson(path.join(other, 'workers.json'), {});
  const result = await f.run({ breaking: true, watcherConfigs: { [other]: f.options.config } });
  assert.equal(result.outcome, 'stopped'); assert.match(result.reason, /not quiescent/);
  assert.ok(!f.calls().some(c => ['update', 'add'].includes(c.args[1])));
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('a disappeared remembered place stops until explicitly removed, retaining the first record', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const baseline = path.join(f.root, 'landing/install/v1.1.0.json'), bytes = fs.readFileSync(baseline);
  fs.rmSync(f.profiles[1], { recursive: true, force: true });
  const stopped = await f.run(); assert.equal(stopped.outcome, 'stopped'); assert.match(stopped.reason, /remembered place disappeared/);
  const result = await f.run({ removePlaces: [f.profiles[1]] });
  assert.equal(result.outcome, 'installed', JSON.stringify(result)); assert.equal(result.places.length, 2);
  assert.deepEqual(fs.readFileSync(baseline), bytes);
  assert.equal((await f.run()).outcome, 'installed', 'explicit retirement persists for the next run');
});

test('catalog refusal restores BOTH previous profile records and the original control', async t => {
  const f = fixture(t), files = ['settings.json', 'plugins/known_marketplaces.json'].map(file => path.join(f.profiles[0], file)), values = files.map(read);
  f.fault({ catalog: true }); const result = await f.run();
  assert.equal(result.outcome, 'rolled-back', JSON.stringify(result));
  files.forEach((file, i) => assert.deepEqual(read(file), values[i]));
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('fresh session missing mono:ship triggers rollback even when all installed bytes match', async t => {
  const f = fixture(t); f.fault({ skill: true }); const result = await f.run();
  assert.equal(result.outcome, 'rolled-back', JSON.stringify(result));
  assert.match(result.reason, /fresh session/);
  assert.ok(result.places.every(place => place.actual === '1.0.0' && place.verified));
});

test('failure during replacement and watcher startup never leaves the installer halt behind', async t => {
  for (const fault of ['replace', 'watcher']) await t.test(fault, async t => {
    const f = fixture(t);
    if (fault === 'replace') f.fault({ replace: true });
    else f.host.restartWatcher = async () => { throw new Error('watcher startup failed'); };
    const result = await installPack(f.options, f.host);
    assert.equal(result.outcome, fault === 'replace' ? 'rolled-back' : 'stopped', JSON.stringify(result));
    assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
  });
});

test('tree verification catches modes, links, missing and extra files independently of version strings', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const folder = path.join(f.profiles[0], 'plugins/cache/mono-marketplace/mono/1.1.0');
  fs.chmodSync(path.join(folder, 'executable'), 0o644);
  fs.unlinkSync(path.join(folder, 'version-link')); fs.symlinkSync('wrong', path.join(folder, 'version-link'));
  fs.writeFileSync(path.join(folder, 'extra'), 'unexpected'); fs.rmSync(path.join(folder, 'skills/ship/SKILL.md'));
  const offset = f.calls().length;
  const result = await f.run();
  assert.equal(result.outcome, 'rolled-back', JSON.stringify(result));
  assert.ok(result.places.every(place => place.actual === '1.0.0' && place.verified));
  assert.equal(f.calls().slice(offset).filter(c => c.profile === f.profiles[0] && c.args[1] === 'update').length, 3, 'two no-op repair attempts then downgrade');
  assert.equal(fs.statSync(path.join(folder, 'executable')).mode & 0o111, 0);
  assert.equal(fs.readlinkSync(path.join(folder, 'version-link')), 'wrong');
  assert.equal(fs.existsSync(path.join(folder, 'extra')), true);
});

test('a killed installer resumes after halt and first place replacement without losing rollback targets or original control', t => {
  const f = fixture(t); f.fault({ crash: true });
  const first = spawnSync(process.execPath, [f.runner], { env: f.env, encoding: 'utf8' });
  assert.equal(first.signal, 'SIGKILL', first.stdout + first.stderr);
  assert.equal(read(path.join(f.root, 'control.json')).halt, true);
  const baseline = path.join(f.root, 'landing/install/v1.1.0.json'), snapshot = path.join(f.root, 'control.json.pre-update-1.1.0');
  const bytes = [fs.readFileSync(baseline), fs.readFileSync(snapshot)], offset = f.calls().length;
  const second = spawnSync(process.execPath, [f.runner], { env: f.env, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(second.stdout.trim().split('\n').length, 1, 'single JSON machine result');
  assert.equal(JSON.parse(second.stdout).outcome, 'installed');
  assert.equal(f.calls().slice(offset).filter(c => c.profile === f.profiles[0] && c.args[1] === 'update').length, 0, 'already matching place is not reinstalled');
  assert.deepEqual(fs.readFileSync(baseline), bytes[0]); assert.deepEqual(fs.readFileSync(snapshot), bytes[1]);
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('a clean HOME installs default profiles plus explicitly named new profiles', async t => {
  const f = fixture(t); fs.rmSync(f.home, { recursive: true, force: true }); fs.mkdirSync(f.home);
  const extra = path.join(f.home, '.claude-extra'), result = await f.run({ profiles: [extra] });
  assert.equal(result.outcome, 'installed', JSON.stringify(result)); assert.equal(result.places.length, 3);
  assert.ok(result.places.every(place => place.verified));
});

test('wrong installed commit or Codex revision cannot pass on a matching version string', async t => {
  for (const fault of ['commit', 'codexRevision']) await t.test(fault, async t => {
    const f = fixture(t); f.fault({ [fault]: true }); const result = await f.run();
    assert.equal(result.outcome, 'rolled-back', JSON.stringify(result));
    assert.ok(result.places.every(place => place.actual === '1.0.0' && place.verified));
  });
});

test('wave verify precedes installation, watcher precedes close, and failed verification never installs or closes', async t => {
  for (const allowed of [true, false]) await t.test(String(allowed), async t => {
    const f = fixture(t), cycle = [];
    f.host.verifyDrain = async (args, held) => {
      assert.deepEqual(held, { underInstallLocks: true });
      assert.equal(fs.existsSync(path.join(f.root, 'dispatch.lock')), true);
      assert.equal(fs.existsSync(path.join(f.root, 'launch.lock')), true);
      assert.equal(read(path.join(f.root, 'control.json')).halt, true);
      assert.equal(args['install-sha'], f.releases['v1.1.0'].sha); cycle.push('verify');
      return { code: allowed ? 0 : 1 };
    };
    f.host.restartWatcher = async () => { cycle.push('watcher'); };
    f.host.closeDrain = async args => { assert.ok(JSON.parse(args.evidence).every(place => place.verified)); cycle.push('close'); return { code: 0 }; };
    const result = await installPack({ ...f.options, wave: true }, f.host);
    assert.equal(result.outcome, allowed ? 'installed' : 'stopped', JSON.stringify(result));
    assert.deepEqual(cycle, allowed ? ['verify', 'watcher', 'close'] : ['verify', 'watcher']);
    if (!allowed) assert.ok(!f.calls().some(c => ['update', 'add'].includes(c.args[1])));
    assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
  });
});

test('the default watcher adapter starts the verified installed script and observes its live pulse before unhalt', t => {
  const f = fixture(t);
  const installed = spawnSync(process.execPath, [f.runner], { env: { ...f.env, PACK_REAL_WATCHER: '1' }, encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const result = JSON.parse(installed.stdout); assert.equal(result.outcome, 'installed');
  const pulse = read(path.join(f.root, 'watcher.json')); assert.equal(pulse.packVersion, '1.1.0'); process.kill(pulse.pid, 0);
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('live Codex from an outgoing folder waits and names its product directory for restart', async t => {
  const f = fixture(t), folder = path.join(f.env.CODEX_HOME, 'plugins/cache/mono-marketplace/mono/1.0.0');
  f.host.processes = () => [{ pid: 2468, command: '/tool/bin/codex exec', procStartEpoch: 100, state: 'S' }];
  f.host.cwdOf = () => path.join(f.env.CODEX_HOME, 'plugins/cache/mono-marketplace/mono/1.0.0');
  let result = await installPack(f.options, f.host);
  assert.equal(result.outcome, 'waiting'); assert.equal(result.holders[0].pid, 2468);
  assert.deepEqual(result.restart, [{ pid: 2468, command: 'codex', cwd: folder, startedAt: 100 }]);
  f.host.cwdOf = () => { throw new Error('unavailable'); };
  result = await installPack(f.options, f.host); assert.equal(result.outcome, 'waiting');
  assert.equal(result.holders[0].state, 'unknown');
});

test('a corrected release can be retried after completed rollback without recapturing previous versions', async t => {
  const f = fixture(t); f.fault({ tree: true }); assert.equal((await f.run()).outcome, 'rolled-back');
  const baseline = path.join(f.root, 'landing/install/v1.1.0.json'), bytes = fs.readFileSync(baseline);
  f.fault({}); assert.equal((await f.run()).outcome, 'installed');
  assert.deepEqual(fs.readFileSync(baseline), bytes);
});

test('local development and foreign project copies are reported and never updated by the pack installer', async t => {
  const f = fixture(t), file = path.join(f.profiles[0], 'plugins/installed_plugins.json'), registry = read(file);
  const local = { scope: 'project', installPath: '/local/mono', projectPath: '/product', version: '0.0.0' };
  registry.plugins['mono@mono-dev'] = [local];
  registry.plugins['mono@mono-marketplace'].push(local); atomicJson(file, registry);
  const result = await f.run(); assert.equal(result.outcome, 'installed', JSON.stringify(result));
  assert.equal(result.localCopies.length, 2);
  assert.ok(result.localCopies.every(row => row.projectPath === '/product' && row.version === '0.0.0'));
  assert.ok(f.calls().every(row => !row.args.includes('--scope')), 'no project update commands');
  assert.deepEqual(read(file).plugins['mono@mono-dev'], [local]);
  assert.deepEqual(read(file).plugins['mono@mono-marketplace'].filter(row => row.projectPath), [local]);
});

test('interruption between the two profile replacements restores the original pair when the resumed catalog refuses the pin', async t => {
  const f = fixture(t), settings = path.join(f.profiles[0], 'settings.json'), known = path.join(f.profiles[0], 'plugins/known_marketplaces.json');
  const original = [read(settings), read(known)], runner = fs.readFileSync(f.runner, 'utf8');
  const interrupted = path.join(f.tmp, 'pin-crash.mjs');
  fs.writeFileSync(interrupted, `import fs from 'node:fs'; const rename=fs.renameSync;
fs.renameSync=(from,to)=>{rename(from,to);if(to===${JSON.stringify(settings)}&&JSON.parse(fs.readFileSync(to)).extraKnownMarketplaces['mono-marketplace'].source.ref==='v1.1.0')process.kill(process.pid,'SIGKILL')};\n` + runner);
  const first = spawnSync(process.execPath, [interrupted], { env: f.env, encoding: 'utf8' });
  assert.equal(first.signal, 'SIGKILL', first.stdout + first.stderr);
  assert.equal(read(settings).extraKnownMarketplaces['mono-marketplace'].source.ref, 'v1.1.0');
  assert.equal(read(known)['mono-marketplace'].source.ref, 'v1.0.0');
  f.fault({ catalog: true });
  const resumed = spawnSync(process.execPath, [f.runner], { env: f.env, encoding: 'utf8' });
  assert.equal(JSON.parse(resumed.stdout).outcome, 'rolled-back', resumed.stdout + resumed.stderr);
  assert.deepEqual([read(settings), read(known)], original);
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('every product watcher is restarted before pause release; missing config stops before replacing any place', async t => {
  const f = fixture(t), other = path.join(f.tmp, 'products/other');
  atomicJson(path.join(other, 'workers.json'), {}); atomicJson(path.join(other, 'control.json'), { state: 'idle' });
  const first = await f.run(); assert.equal(first.outcome, 'stopped'); assert.match(first.reason, /watcher config unavailable/);
  assert.ok(!f.calls().some(row => ['update', 'add'].includes(row.args[1])));
  const observed = [];
  f.host.restartWatcher = async (folder, options, expected) => {
    assert.equal(read(path.join(f.root, 'control.json')).halt, true);
    assert.ok(folder.endsWith('/1.1.0')); assert.equal(expected.version, '1.1.0');
    observed.push(options.root);
  };
  const result = await installPack({ ...f.options, watcherConfigs: { [other]: f.options.config } }, f.host);
  assert.equal(result.outcome, 'installed', JSON.stringify(result));
  assert.deepEqual(observed, [f.root, other]); assert.equal(result.watchers.length, 2);
  assert.deepEqual(read(path.join(other, 'control.json')), { state: 'idle' });
  assert.deepEqual(read(path.join(other, 'workers.json')), {});
});

test('a completed installation never restores historical control over later owner changes, including while waiting', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const current = { state: 'draining', halt: true, owner: 'new decision' }, control = path.join(f.root, 'control.json');
  atomicJson(control, current);
  assert.equal((await f.run()).outcome, 'installed'); assert.deepEqual(read(control), current);
  f.host.processes = () => [{ pid: 3456, command: 'codex --cd /product', state: 'S' }]; f.host.cwdOf = () => '/product';
  assert.equal((await installPack(f.options, f.host)).outcome, 'waiting'); assert.deepEqual(read(control), current);
});

test('interactive Codex in a product directory protects the shared cache even without a registry or cache argument', async t => {
  const f = fixture(t); f.host.processes = () => [{ pid: 3456, command: '/tool/bin/codex --cd /product', state: 'S' }]; f.host.cwdOf = () => '/product';
  const result = await installPack(f.options, f.host);
  assert.equal(result.outcome, 'waiting'); assert.equal(result.holders[0].pid, 3456);
  assert.ok(!f.calls().some(row => ['update', 'add'].includes(row.args[1])));
});

test('an interrupted Codex metadata write is repaired from the immutable baseline', async t => {
  for (const damaged of ['missing', 'truncated']) await t.test(damaged, async t => {
    const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
    const baseline = path.join(f.root, 'landing/install/v1.1.0.json'), bytes = fs.readFileSync(baseline);
    const file = path.join(f.env.CODEX_HOME, 'plugins/cache/mono-marketplace/mono/1.1.0/.codex-marketplace-install.json');
    if (damaged === 'missing') fs.rmSync(file); else fs.writeFileSync(file, '{');
    const offset = f.calls().length, result = await f.run();
    assert.equal(result.outcome, 'installed', JSON.stringify(result)); assert.equal(read(file).revision, f.releases['v1.1.0'].sha);
    assert.equal(f.calls().slice(offset).filter(row => row.tool === 'codex' && row.args[1] === 'add').length, 1);
    assert.deepEqual(fs.readFileSync(baseline), bytes);
  });
});

test('an already matching Claude place disables auto-update without reinstalling its verified plugin', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const file = path.join(f.profiles[0], 'settings.json'), settings = read(file); settings.extraKnownMarketplaces['mono-marketplace'].autoUpdate = true; atomicJson(file, settings);
  const offset = f.calls().length, result = await f.run();
  assert.equal(result.outcome, 'installed', JSON.stringify(result)); assert.equal(read(file).extraKnownMarketplaces['mono-marketplace'].autoUpdate, false);
  assert.ok(!f.calls().slice(offset).some(row => ['update', 'add', 'install'].includes(row.args[1])));
});

test('root paths from shell completion accept a trailing separator', async t => {
  const f = fixture(t), result = await f.run({ root: f.root + path.sep });
  assert.equal(result.outcome, 'installed', JSON.stringify(result));
});

test('a release executable must be executable by its owner, not only by other users', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const file = path.join(f.profiles[0], 'plugins/cache/mono-marketplace/mono/1.1.0/executable'); fs.chmodSync(file, 0o641);
  const offset = f.calls().length, result = await f.run();
  assert.equal(result.outcome, 'rolled-back', JSON.stringify(result));
  assert.ok(result.places.every(place => place.actual === '1.0.0' && place.verified));
  assert.equal(f.calls().slice(offset).filter(row => row.profile === f.profiles[0] && row.args[1] === 'update').length, 3);
  assert.equal(fs.statSync(file).mode & 0o100, 0, 'same-version update does not replace the corrupt executable');
  assert.ok(fs.statSync(path.join(result.places[0].folders[0], 'executable')).mode & 0o100);
});

test('local-only Claude profiles and Codex local copies are listed without being installed or changed', async t => {
  const f = fixture(t), profile = path.join(f.home, '.claude-dev'), local = { installPath: '/local/mono', projectPath: '/product', version: '0.0.0' };
  const file = path.join(profile, 'plugins/installed_plugins.json'); atomicJson(file, { plugins: { 'mono@mono-dev': [local] } });
  const bytes = fs.readFileSync(file); f.fault({ codexLocal: true });
  const result = await f.run(); assert.equal(result.outcome, 'installed', JSON.stringify(result));
  assert.equal(result.localCopies.length, 2); assert.ok(result.localCopies.some(row => row.place === profile));
  assert.ok(result.localCopies.some(row => row.pluginId === 'mono@mono-dev' && row.source.path === '/local/codex-mono'));
  assert.deepEqual(fs.readFileSync(file), bytes); assert.ok(!f.calls().some(row => row.profile === profile));
});

test('a Claude profile with only a foreign project copy installs the user scope and preserves the local copy', async t => {
  const f = fixture(t), file = path.join(f.profiles[1], 'plugins/installed_plugins.json'), local = { scope: 'project', projectPath: '/product', installPath: '/local/mono', version: '0.0.0' };
  atomicJson(file, { plugins: { 'mono@mono-marketplace': [local] } });
  const result = await f.run(); assert.equal(result.outcome, 'installed', JSON.stringify(result));
  assert.ok(f.calls().some(row => row.profile === f.profiles[1] && row.args[1] === 'install'));
  assert.deepEqual(read(file).plugins['mono@mono-marketplace'].filter(row => row.projectPath), [local]);
});

test('watcher failure returns every place to the previous release and starts the previous watcher before unhalt', async t => {
  const f = fixture(t), versions = [];
  f.host.restartWatcher = async (folder, options, expected) => {
    assert.equal(read(path.join(f.root, 'control.json')).halt, true); versions.push(expected.version);
    if (expected.version === '1.1.0') throw new Error('new watcher died');
  };
  const result = await installPack(f.options, f.host);
  assert.equal(result.outcome, 'rolled-back', JSON.stringify(result)); assert.deepEqual(versions, ['1.1.0', '1.0.0']);
  assert.ok(result.places.every(place => place.verified && place.actual === '1.0.0'));
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('recovery after close observes the archived wave and replays close without re-verifying empty pending records', async t => {
  const f = fixture(t), archive = path.join(f.root, `landing/installed/${f.releases['v1.1.0'].sha}.json`);
  let verifies = 0, closes = 0;
  f.host.verifyDrain = async () => { verifies++; return { code: 0 }; };
  f.host.closeDrain = async () => { closes++; atomicJson(archive, { closed: true }); if (closes === 1) throw new Error('interrupted after close'); return { code: 0 }; };
  const first = await installPack({ ...f.options, wave: true }, f.host); assert.equal(first.outcome, 'stopped');
  const offset = f.calls().length, second = await installPack({ ...f.options, wave: true }, f.host);
  assert.equal(second.outcome, 'installed', JSON.stringify(second)); assert.equal(verifies, 1); assert.equal(closes, 2);
  assert.ok(!f.calls().slice(offset).some(row => ['add', 'update', 'install'].includes(row.args[1])));
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('the CLI isolates its lock group from a live caller and recovers after the installer child is killed', t => {
  const f = fixture(t), args = [path.resolve('scripts/pack-install.mjs'), '--root', f.root, '--repo', f.repo, '--tag', 'v1.1.0', '--config', f.options.config];
  f.fault({ crash: true });
  const first = spawnSync(process.execPath, args, { env: { ...f.env, PACK_REAL_GROUPS: '1' }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(first.status, 1, first.stdout + first.stderr); assert.equal(JSON.parse(first.stdout).outcome, 'stopped');
  const holder = read(path.join(f.tmp, 'products/pack-install.lock')); assert.equal(holder.processGroup, holder.pid, 'actual kernel process group is isolated from this still-live test caller');
  assert.equal(read(path.join(f.root, 'control.json')).halt, true);
  const second = spawnSync(process.execPath, args, { env: { ...f.env, PACK_REAL_GROUPS: '1' }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(second.status, 0, second.stdout + second.stderr); assert.equal(JSON.parse(second.stdout).outcome, 'installed');
  assert.equal(second.stdout.trim().split('\n').length, 1);
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('invalid watcher PID never reaches process-group signalling', t => {
  const f = fixture(t); atomicJson(path.join(f.root, 'watcher.json'), { pid: 0, procStart: null });
  const result = spawnSync(process.execPath, [f.runner], { env: { ...f.env, PACK_REAL_WATCHER: '1' }, encoding: 'utf8', detached: true, timeout: 30_000 });
  assert.equal(result.signal, null, result.stdout + result.stderr); assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).reason, /invalid watcher process identity/);
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('the final restart inventory includes a session opened while the watcher was restarting', async t => {
  const f = fixture(t); let sessions = [];
  f.host.processes = () => sessions; f.host.cwdOf = () => '/product';
  f.host.restartWatcher = async () => { sessions = [{ pid: 5432, command: 'claude --continue', state: 'S', procStartEpoch: Date.now() }]; };
  const result = await installPack(f.options, f.host);
  assert.equal(result.outcome, 'installed'); assert.equal(result.restart[0].pid, 5432); assert.equal(result.restart[0].cwd, '/product');
});

test('same-version no-op update cannot repair missing files, extra directories or changed symlinks; rollback is verified', async t => {
  for (const change of ['missing', 'extra', 'symlink']) await t.test(change, async t => {
    const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
    const folder = path.join(f.profiles[0], 'plugins/cache/mono-marketplace/mono/1.1.0');
    if (change === 'missing') fs.rmSync(path.join(folder, 'executable'));
    if (change === 'extra') fs.mkdirSync(path.join(folder, 'unexpected'));
    if (change === 'symlink') { fs.unlinkSync(path.join(folder, 'version-link')); fs.symlinkSync('elsewhere', path.join(folder, 'version-link')); }
    const offset = f.calls().length, result = await f.run();
    assert.equal(result.outcome, 'rolled-back', JSON.stringify(result));
    assert.ok(result.places.every(place => place.actual === '1.0.0' && place.verified));
    assert.equal(f.calls().slice(offset).filter(row => row.profile === f.profiles[0] && row.args[1] === 'update').length, 3);
    assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
  });
});

test('a resumed installation protects its recorded rollback folder even after the current profile points to the new version', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const old = path.join(f.profiles[0], 'plugins/cache/mono-marketplace/mono/1.0.0');
  atomicJson(path.join(f.root, 'workers.json'), { 'MONO-901': { issue: 'MONO-901', attempt: 1, pid: 4567, packRoot: old } });
  f.host.processes = () => [{ pid: 4567, command: 'worker', state: 'S' }];
  const offset = f.calls().length, result = await installPack(f.options, f.host);
  assert.equal(result.outcome, 'waiting', JSON.stringify(result)); assert.equal(result.holders[0].issue, 'MONO-901');
  assert.ok(!f.calls().slice(offset).some(row => ['update', 'add', 'install'].includes(row.args[1])));
});

test('an unrelated products root cannot exclude the installing product from holder checks and locks', async t => {
  const f = fixture(t), productsRoot = path.join(f.tmp, 'unrelated-products'); fs.mkdirSync(productsRoot);
  const result = await f.run({ productsRoot });
  assert.equal(result.outcome, 'stopped'); assert.match(result.reason, /--root must be a product/);
  assert.equal(f.calls().length, 0); assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});


test('the public CLI bootstraps absent own state, including a missing products directory', t => {
  for (const missing of ['control', 'workers', 'products']) {
    const f = fixture(t);
    if (missing === 'products') fs.rmSync(path.dirname(f.root), { recursive: true });
    else fs.rmSync(path.join(f.root, missing + '.json'));
    const result = spawnSync(process.execPath, [path.resolve('scripts/pack-install.mjs'), '--root', f.root, '--repo', f.repo, '--tag', 'v1.1.0', '--config', f.options.config, '--breaking'], { env: f.env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).outcome, 'installed');
    assert.deepEqual(read(path.join(f.root, 'workers.json')), {});
    assert.deepEqual(read(path.join(f.root, 'control.json')), missing === 'workers' ? { state: 'idle', custom: 'preserve' } : { state: 'idle' });
  }
});

test('bootstrap never repairs missing or corrupt state in another product', async t => {
  for (const missing of ['control', 'workers', 'corrupt']) await t.test(missing, async t => {
    const f = fixture(t), other = path.join(f.tmp, 'products/other');
    atomicJson(path.join(other, 'control.json'), { state: 'idle' }); atomicJson(path.join(other, 'workers.json'), {});
    if (missing === 'corrupt') fs.writeFileSync(path.join(other, 'workers.json'), '{');
    else fs.rmSync(path.join(other, missing + '.json'));
    const result = await f.run();
    assert.equal(result.outcome, 'stopped');
    if (missing === 'corrupt') assert.equal(fs.readFileSync(path.join(other, 'workers.json'), 'utf8'), '{');
    else assert.equal(fs.existsSync(path.join(other, missing + '.json')), false);
    assert.equal(f.calls().length, 0);
  });
});

test('completed same-tag installation extends explicit, discovered and Codex places without overwriting recovery', async t => {
  for (const kind of ['explicit', 'discovered', 'codex']) await t.test(kind, async t => {
    const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
    const baseline = path.join(f.root, 'landing/install/v1.1.0.json'), snapshot = path.join(f.root, 'control.json.pre-update-1.1.0');
    const bytes = [fs.readFileSync(baseline), fs.readFileSync(snapshot)];
    const place = path.join(f.home, kind === 'codex' ? '.codex-other' : '.claude-extra');
    if (kind === 'discovered') addClaudeProfile(f, place);
    const extra = kind === 'codex' ? { env: { ...f.env, CODEX_HOME: place } } : kind === 'explicit' ? { profiles: [place] } : {};
    const offset = f.calls().length, result = await f.run(extra);
    assert.equal(result.outcome, 'installed', JSON.stringify(result));
    assert.equal(result.places.length, 4); assert.ok(result.places.every(row => row.verified));
    assert.deepEqual(fs.readFileSync(baseline), bytes[0]); assert.deepEqual(fs.readFileSync(snapshot), bytes[1]);
    assert.ok(!f.calls().slice(offset).some(row => row.profile !== place && ['add', 'update', 'install'].includes(row.args[1])), 'matching existing places are not replaced');
    const retry = await f.run(); assert.equal(retry.outcome, 'installed', JSON.stringify(retry));
    assert.ok(retry.places.some(row => row.place === place), 'added place is remembered without flag or env');
  });
});

test('same-version no-op corruption without a preceding release stops and restores control', async t => {
  const f = fixture(t); fs.rmSync(f.home, { recursive: true }); fs.mkdirSync(f.home);
  assert.equal((await f.run()).outcome, 'installed');
  fs.writeFileSync(path.join(f.profiles[0], 'plugins/cache/mono-marketplace/mono/1.1.0/executable'), 'corrupt');
  const result = await f.run();
  assert.equal(result.outcome, 'stopped', JSON.stringify(result)); assert.match(result.reason, /no previous release/);
  assert.ok(result.places.some(row => row.place === f.profiles[0] && !row.verified));
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});


test('added-place recovery survives an interrupted extension and rolls every place back using its first record', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const baseline = path.join(f.root, 'landing/install/v1.1.0.json'), snapshot = path.join(f.root, 'control.json.pre-update-1.1.0');
  const bytes = [fs.readFileSync(baseline), fs.readFileSync(snapshot)];
  const place = path.join(f.home, '.claude-extra'); addClaudeProfile(f, place);
  f.fault({ crash: true });
  const first = spawnSync(process.execPath, [f.runner], { env: f.env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(first.signal, 'SIGKILL', first.stdout + first.stderr);
  const extensionFile = path.join(f.root, 'landing/install/v1.1.0.places/000001.json'), extension = fs.readFileSync(extensionFile);
  assert.equal(read(extensionFile).places[0].previous.tag, 'v1.0.0');
  assert.equal(read(path.join(f.root, 'control.json')).halt, true);
  const another = path.join(f.home, '.claude-another'); addClaudeProfile(f, another);
  const rejection = spawnSync(process.execPath, [f.runner], { env: f.env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(rejection.status, 1, rejection.stdout + rejection.stderr);
  const rejected = JSON.parse(rejection.stdout); assert.equal(rejected.outcome, 'stopped'); assert.match(rejected.reason, /incomplete installation/);
  fs.rmSync(another, { recursive: true });
  f.fault({ skill: true });
  const resumed = await f.run(); assert.equal(resumed.outcome, 'rolled-back', JSON.stringify(resumed));
  assert.equal(resumed.places.length, 4); assert.ok(resumed.places.every(row => row.actual === '1.0.0' && row.verified));
  assert.deepEqual(fs.readFileSync(baseline), bytes[0]); assert.deepEqual(fs.readFileSync(snapshot), bytes[1]); assert.deepEqual(fs.readFileSync(extensionFile), extension);
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
  f.fault({}); assert.equal((await f.run()).outcome, 'installed'); assert.deepEqual(fs.readFileSync(extensionFile), extension);
  fs.rmSync(place, { recursive: true }); assert.match((await f.run()).reason, /remembered place disappeared/);
  assert.equal((await f.run({ removePlaces: [place] })).outcome, 'installed');
});

test('completed wave permits a new profile without re-verifying an already archived wave', async t => {
  const f = fixture(t); let verifies = 0, closes = 0;
  const archive = path.join(f.root, 'landing/installed', `${f.releases['v1.1.0'].sha}.json`);
  f.host.verifyDrain = () => { verifies++; return { code: 0 }; };
  f.host.closeDrain = () => { closes++; atomicJson(archive, { closed: true }); return { code: 0 }; };
  assert.equal((await f.run({ wave: true })).outcome, 'installed');
  const place = path.join(f.home, '.claude-extra'); addClaudeProfile(f, place);
  const result = await f.run({ wave: true });
  assert.equal(result.outcome, 'installed', JSON.stringify(result)); assert.equal(result.places.length, 4);
  assert.equal(verifies, 1); assert.equal(closes, 2);
});

test('review regression: Codex remains a holder when its arguments contain claude', async t => {
  const f = fixture(t); f.host.processes = () => [{ pid: 9211, command: 'codex --cd /work/claude-demo', state: 'S' }];
  f.host.cwdOf = () => '/work/claude-demo';
  const result = await f.run(); assert.equal(result.outcome, 'waiting', JSON.stringify(result));
  assert.equal(result.restart[0].command, 'codex'); assert.equal(result.holders[0].pid, 9211);
  assert.ok(!f.calls().some(row => ['add', 'update', 'install'].includes(row.args[1])));
});

test('review regression: zombie workers are dead holders and their records survive', async t => {
  const f = fixture(t), file = path.join(f.root, 'workers.json');
  atomicJson(file, { 'MONO-902': { issue: 'MONO-902', attempt: 1, pid: 9212, packRoot: path.join(f.env.CODEX_HOME, 'plugins/cache/mono-marketplace/mono/1.0.0') } });
  const bytes = fs.readFileSync(file); f.host.processes = () => [{ pid: 9212, command: 'worker', state: 'Z' }];
  const result = await f.run(); assert.equal(result.outcome, 'installed', JSON.stringify(result));
  assert.equal(result.holders[0].state, 'dead'); assert.deepEqual(fs.readFileSync(file), bytes);
});

test('review regression: compatible installs reject structurally invalid own and foreign controls', async t => {
  for (const own of [true, false]) for (const value of [null, [], {}, { state: 'broken' }, { state: 'idle', halt: 'yes' }]) {
    const f = fixture(t), dir = own ? f.root : path.join(f.tmp, 'products/other');
    atomicJson(path.join(dir, 'workers.json'), {}); atomicJson(path.join(dir, 'control.json'), value);
    const bytes = fs.readFileSync(path.join(dir, 'control.json')), result = await f.run();
    assert.equal(result.outcome, 'stopped', JSON.stringify({ value, result }));
    assert.deepEqual(fs.readFileSync(path.join(dir, 'control.json')), bytes);
    assert.equal(f.calls().length, 0);
  }
});

test('review regression: canonical profile aliases create one immutable added-place record', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const place = path.join(f.home, '.claude-extra'); addClaudeProfile(f, place);
  const result = await f.run({ profiles: [place + '/', place + '/.'] });
  assert.equal(result.outcome, 'installed', JSON.stringify(result)); assert.equal(result.places.length, 4);
  const extension = read(path.join(f.root, 'landing/install/v1.1.0.places/000001.json'));
  assert.equal(extension.places.length, 1); assert.equal((await f.run()).outcome, 'installed');
});

test('review regression: clean added place resumes before its directory exists but completed disappearance stops', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  const place = path.join(f.tmp, 'external-profile'); assert.equal((await f.run({ profiles: [place] })).outcome, 'installed');
  const extensionFile = path.join(f.root, 'landing/install/v1.1.0.places/000001.json'), bytes = fs.readFileSync(extensionFile);
  fs.rmSync(place, { recursive: true });
  const file = path.join(f.root, 'landing/install/v1.1.0.progress.json'), progress = read(file);
  delete progress.outcome; progress.places = progress.places.filter(row => row.place !== place);
  progress.intents = progress.intents.filter(row => row.place !== place); // interrupted before the first create
  progress.pauseActive = true; atomicJson(file, progress);
  atomicJson(path.join(f.root, 'control.json'), { ...progress.pauseControl, halt: true });
  const result = await f.run(); assert.equal(result.outcome, 'installed', JSON.stringify(result));
  assert.equal(result.places.length, 4); assert.deepEqual(fs.readFileSync(extensionFile), bytes);
  fs.rmSync(place, { recursive: true }); assert.match((await f.run()).reason, /remembered place disappeared/);
});

function addRelease(f, version) {
  const git = (...args) => execFileSync('git', ['-C', f.repo, ...args], { env: f.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  fs.writeFileSync(path.join(f.repo, 'VERSION'), version + '\n'); git('add', '.'); git('commit', '-qm', version); git('tag', '-f', 'v' + version);
  const folder = path.join(f.tmp, version + '-extra'); fs.mkdirSync(folder);
  execFileSync('tar', ['-xf', '-', '-C', folder], { input: execFileSync('git', ['-C', f.repo, 'archive', 'v' + version], { env: f.env }) });
  f.releases['v' + version] = { version, folder, sha: git('rev-parse', 'HEAD') }; atomicJson(path.join(f.tmp, 'releases.json'), f.releases);
}

test('review regression: older-tag extensions survive newer records and absent historical places stop', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  addRelease(f, '1.2.0'); assert.equal((await f.run({ tag: 'v1.2.0' })).outcome, 'installed');
  const place = path.join(f.tmp, 'external-profile'); assert.equal((await f.run({ profiles: [place] })).outcome, 'installed');
  addRelease(f, '1.3.0'); const result = await f.run({ tag: 'v1.3.0' });
  assert.equal(result.outcome, 'installed', JSON.stringify(result)); assert.ok(result.places.some(row => row.place === place && row.actual === '1.3.0'));
  fs.rmSync(place, { recursive: true });
  const missing = await f.run(); assert.equal(missing.outcome, 'stopped'); assert.match(missing.reason, /remembered place disappeared/);
  assert.equal((await f.run({ removePlaces: [place] })).outcome, 'installed');
  assert.equal((await f.run({ tag: 'v1.3.0' })).outcome, 'installed', 'retirement survives changing tags');
});

test('review regression: a moved previous tag is refused before rollback installs different recorded bytes', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
  addRelease(f, '1.0.0'); f.fault({ skill: true });
  const offset = f.calls().length, result = await f.run();
  assert.equal(result.outcome, 'stopped', JSON.stringify(result)); assert.match(result.reason, /previous.*commit|rollback.*commit/);
  assert.ok(!f.calls().slice(offset).some(row => row.args[1] === 'update'), 'no rollback from the moved tag');
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('review regression: matching bytes cannot prove an installation from a fork marketplace', async t => {
  for (const tool of ['claude', 'codex']) await t.test(tool, async t => {
    const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
    if (tool === 'claude') {
      for (const name of ['settings.json', 'plugins/known_marketplaces.json']) {
        const file = path.join(f.profiles[0], name), doc = read(file), entries = name === 'settings.json' ? doc.extraKnownMarketplaces : doc;
        entries['mono-marketplace'].source.repo = 'elsewhere/mono'; atomicJson(file, doc);
      }
    } else {
      const file = path.join(f.env.CODEX_HOME, 'config.toml'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('darkdepot/mono', 'elsewhere/mono'));
    }
    const offset = f.calls().length, result = await f.run();
    assert.ok(result.outcome !== 'installed' || f.calls().slice(offset).some(row => row.tool === 'codex' && row.args[1] === 'marketplace'), JSON.stringify(result));
    if (tool === 'claude') assert.equal(result.outcome, 'stopped');
    else assert.match(fs.readFileSync(path.join(f.env.CODEX_HOME, 'config.toml'), 'utf8'), /darkdepot\/mono/);
  });
});

test('review regression: late Codex holders stop destructive installation and rollback, leaving a resumable pause', async t => {
  for (const rollback of [false, true]) await t.test(String(rollback), async t => {
    const f = fixture(t); if (rollback) f.fault({ skill: true });
    f.host.cwdOf = () => '/work/claude-demo';
    f.host.processes = () => {
      const rows = f.calls(), appeared = rollback ? rows.some(row => row.args[0] === '-p') : rows.some(row => row.tool === 'claude' && row.args[1] === 'update');
      return appeared ? [{ pid: 9213, command: 'codex --cd /work/claude-demo', state: 'S' }] : [];
    };
    const result = await f.run(); assert.equal(result.outcome, 'waiting', JSON.stringify(result));
    const puts = f.calls().filter(row => row.args[1] === 'add' && row.tool === 'codex'); assert.equal(puts.length, rollback ? 1 : 0);
    assert.equal(result.holders[0].pid, 9213);
    assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
    f.host.processes = () => []; f.fault({}); const resumed = await f.run();
    assert.equal(resumed.outcome, rollback ? 'rolled-back' : 'installed', JSON.stringify(resumed));
  });
});

test('U8 quiescence applies to breaking rollback; compatible rollback still protects replaced folders', async t => {
  for (const breaking of [false, true]) await t.test(String(breaking), async t => {
    const f = fixture(t), other = path.join(f.tmp, 'products/other');
    atomicJson(path.join(other, 'control.json'), { state: breaking ? 'idle' : 'active' }); atomicJson(path.join(other, 'workers.json'), {});
    f.fault({ skill: true });
    if (breaking) f.host.processes = () => {
      if (f.calls().some(row => row.args[0] === '-p')) atomicJson(path.join(other, 'control.json'), { state: 'active' });
      return [];
    };
    const result = await f.run({ breaking, watcherConfigs: { [other]: f.options.config } });
    assert.equal(result.outcome, breaking ? 'stopped' : 'rolled-back', JSON.stringify(result));
    if (breaking) assert.match(result.reason, /not quiescent/);
    assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
  });
});


test('S8: historical places cannot change between Claude and Codex', async t => {
  for (const direction of ['claude-to-codex', 'codex-to-claude']) await t.test(direction, async t => {
    const f = fixture(t), place = direction === 'claude-to-codex' ? path.join(f.tmp, 'external-profile') : f.env.CODEX_HOME;
    if (direction === 'claude-to-codex') addClaudeProfile(f, place);
    assert.equal((await f.run({ profiles: direction === 'claude-to-codex' ? [place] : [] })).outcome, 'installed');
    const registry = path.join(place, 'plugins/installed_plugins.json');
    const bytes = fs.existsSync(registry) ? fs.readFileSync(registry) : null;
    const cache = path.join(place, 'plugins/cache/mono-marketplace/mono/1.1.0/VERSION'), cached = fs.readFileSync(cache);
    addRelease(f, '1.2.0');
    if (direction === 'claude-to-codex') f.env.CODEX_HOME = place;
    else f.env.CODEX_HOME = path.join(f.tmp, 'new-codex');
    const offset = f.calls().length;
    const result = await f.run({ tag: 'v1.2.0', profiles: direction === 'codex-to-claude' ? [place] : [] });
    assert.equal(result.outcome, 'stopped', JSON.stringify(result)); assert.match(result.reason, /separate directories/);
    assert.ok(f.calls().slice(offset).every(row => row.tool === 'codex' && row.args[1] === 'list'));
    assert.deepEqual(fs.readFileSync(cache), cached);
    if (bytes) assert.deepEqual(fs.readFileSync(registry), bytes);
    assert.ok(!fs.existsSync(path.join(f.root, 'landing/install/v1.2.0.json')));
    assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
  });
});

test('S8: created partial place disappearance requires explicit removal even after failed inspection', async t => {
  for (const verified of [true, false]) await t.test(String(verified), async t => {
    const f = fixture(t); assert.equal((await f.run()).outcome, 'installed');
    const place = path.join(f.tmp, 'external-profile'); assert.equal((await f.run({ profiles: [place] })).outcome, 'installed');
    const extension = path.join(f.root, 'landing/install/v1.1.0.places/000001.json'), bytes = fs.readFileSync(extension);
    const file = path.join(f.root, 'landing/install/v1.1.0.progress.json'), progress = read(file);
    const intent = progress.intents.find(row => row.place === place && row.result?.verified);
    assert.ok(intent);
    if (!verified) intent.result = { place, expected: '1.1.0', actual: '1.1.0', verified: false, error: 'tree differs' };
    delete progress.outcome; progress.places = progress.places.filter(row => row.place !== place);
    atomicJson(file, progress); fs.rmSync(place, { recursive: true });
    const offset = f.calls().length, result = await f.run();
    assert.equal(result.outcome, 'stopped', JSON.stringify(result)); assert.match(result.reason, /remembered place disappeared/);
    assert.ok(f.calls().slice(offset).every(row => row.tool === 'codex' && row.args[1] === 'list'));
    assert.ok(!fs.existsSync(place));
    assert.deepEqual(fs.readFileSync(extension), bytes);
    const removed = await f.run({ removePlaces: [place] });
    assert.equal(removed.outcome, 'installed', JSON.stringify(removed)); assert.equal(removed.places.length, 3);
    assert.deepEqual(fs.readFileSync(extension), bytes); assert.ok(!fs.existsSync(place));
  });
});


test('compatible rollback waits for a live process in the replaced folder without replacing any place', async t => {
  const f = fixture(t); f.fault({ skill: true });
  const folder = path.join(f.env.CODEX_HOME, 'plugins/cache/mono-marketplace/mono/1.1.0');
  f.host.cwdOf = () => path.join(f.env.CODEX_HOME, 'plugins/cache/mono-marketplace/mono/1.0.0');
  f.host.processes = () => f.calls().some(row => row.args[0] === '-p')
    ? [{ pid: 9214, command: 'codex', state: 'S' }] : [];
  const result = await f.run();
  assert.equal(result.outcome, 'waiting', JSON.stringify(result));
  assert.equal(result.code, 2); assert.equal(result.holders[0].pid, 9214); assert.equal(result.holders[0].state, 'live');
  const calls = f.calls(), fresh = calls.findIndex(row => row.args[0] === '-p');
  assert.ok(fresh >= 0);
  assert.ok(!calls.slice(fresh).some(row => ['update', 'install', 'add'].includes(row.args[1])), 'no replacements after the process appears');
  for (const profile of f.profiles) assert.equal(read(path.join(profile, 'plugins/installed_plugins.json')).plugins['mono@mono-marketplace'][0].version, '1.1.0');
  assert.equal(fs.readFileSync(path.join(folder, 'VERSION'), 'utf8').trim(), '1.1.0');
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
  f.host.processes = () => []; f.fault({});
  assert.equal((await f.run()).outcome, 'rolled-back');
});

test('pins v1: unavailable process inventory or session cwd waits without replacing profiles', async t => {
  for (const fault of ['table', 'command', 'claude-cwd', 'codex-cwd']) await t.test(fault, async t => {
    const f = fixture(t);
    f.host.processes = () => {
      if (fault === 'table') throw new Error('process list unavailable');
      return [{ pid: 9321, command: fault === 'command' ? '' : fault.startsWith('claude') ? 'claude' : 'codex', state: 'S' }];
    };
    f.host.cwdOf = () => { throw new Error('session cwd unavailable'); };
    const result = await f.run();
    assert.equal(result.outcome, 'waiting', JSON.stringify(result)); assert.equal(result.code, 2);
    assert.ok(result.holders.some(row => row.state === 'unknown'));
    assert.ok(!f.calls().some(row => ['update', 'install', 'add'].includes(row.args[1])));
    assert.ok(f.profiles.every(profile => read(path.join(profile, 'plugins/installed_plugins.json')).plugins['mono@mono-marketplace'][0].version === '1.0.0'));
    assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
  });
});

test('pins v1: physical aliases cannot mix current or historical Claude and Codex places', async t => {
  for (const historical of [false, true]) for (const kind of ['claude', 'codex']) await t.test(`${historical}-${kind}`, async t => {
    const f = fixture(t), original = kind === 'claude' ? f.profiles[0] : f.env.CODEX_HOME;
    if (historical) { assert.equal((await f.run()).outcome, 'installed'); addRelease(f, '1.2.0'); }
    const alias = path.join(f.tmp, 'profile-alias'); fs.symlinkSync(original, alias);
    const cache = path.join(original, 'plugins/cache/mono-marketplace/mono', historical ? '1.1.0' : '1.0.0', 'VERSION'), bytes = fs.readFileSync(cache);
    const args = { tag: historical ? 'v1.2.0' : 'v1.1.0' };
    if (kind === 'claude') f.env.CODEX_HOME = alias;
    else { args.profiles = [alias]; if (historical) f.env.CODEX_HOME = path.join(f.tmp, 'new-codex'); }
    const offset = f.calls().length, result = await f.run(args);
    assert.equal(result.outcome, 'stopped', JSON.stringify(result)); assert.match(result.reason, /separate directories/);
    assert.ok(!f.calls().slice(offset).some(row => ['update', 'install', 'add'].includes(row.args[1])));
    assert.deepEqual(fs.readFileSync(cache), bytes);
    assert.ok(!fs.existsSync(path.join(f.root, 'landing/install', `${args.tag}.json`)));
  });
});

test('pins v1: resumed wave rollback skips outgoing verification and still waits for holders', async t => {
  const f = fixture(t); let verifies = 0;
  f.host.verifyDrain = async () => { verifies++; return { code: 0 }; };
  f.fault({ skill: true });
  f.host.processes = () => f.calls().some(row => row.args[0] === '-p') ? [{ pid: 9322, command: 'codex', state: 'S' }] : [];
  f.host.cwdOf = () => '/product';
  assert.equal((await f.run({ wave: true })).outcome, 'waiting');
  assert.equal(read(path.join(f.root, 'landing/install/v1.1.0.progress.json')).phase, 'rollback');
  f.host.processes = () => []; f.fault({});
  f.host.verifyDrain = async () => { verifies++; return { code: 1 }; };
  const result = await f.run({ wave: true });
  assert.equal(result.outcome, 'rolled-back', JSON.stringify(result)); assert.equal(verifies, 1);
  assert.ok(result.places.every(row => row.actual === '1.0.0' && row.verified));
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('pins v1: another tag stops and releases a recorded interrupted installation pause', async t => {
  const f = fixture(t); assert.equal((await f.run()).outcome, 'installed'); addRelease(f, '1.2.0');
  const file = path.join(f.root, 'landing/install/v1.1.0.progress.json'), progress = read(file);
  delete progress.outcome; progress.pauseActive = true; progress.pauseControl = { state: 'idle', custom: 'preserve' }; atomicJson(file, progress);
  atomicJson(path.join(f.root, 'control.json'), { ...progress.pauseControl, halt: true });
  const baseline = path.join(f.root, 'landing/install/v1.1.0.json'), snapshot = path.join(f.root, 'control.json.pre-update-1.1.0');
  const bytes = [fs.readFileSync(baseline), fs.readFileSync(snapshot)], offset = f.calls().length;
  for (let n = 0; n < 2; n++) {
    const result = await f.run({ tag: 'v1.2.0' });
    assert.equal(result.outcome, 'stopped', JSON.stringify(result)); assert.match(result.reason, /unfinished installation.*v1\.1\.0/);
    assert.deepEqual(read(path.join(f.root, 'control.json')), progress.pauseControl);
    assert.ok(!fs.existsSync(path.join(f.root, 'landing/install/v1.2.0.json')));
    assert.ok(!f.calls().slice(offset).some(row => ['update', 'install', 'add'].includes(row.args[1])));
  }
  assert.deepEqual(fs.readFileSync(baseline), bytes[0]); assert.deepEqual(fs.readFileSync(snapshot), bytes[1]);
  assert.equal((await f.run()).outcome, 'installed');
});

test('pins v1: failed clean installation reports actual versions without rollback targets', async t => {
  const f = fixture(t); fs.rmSync(f.home, { recursive: true }); fs.mkdirSync(f.home); f.fault({ skill: true });
  const result = await f.run();
  assert.equal(result.outcome, 'stopped', JSON.stringify(result)); assert.match(result.reason, /no previous release/);
  assert.equal(result.places.length, 2);
  assert.ok(result.places.every(row => row.actual === '1.1.0' && row.folders.length === 1 && !row.verified), JSON.stringify(result.places));
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});

test('pins v1: late inventory failure stops further replacements and reports partial actual versions', async t => {
  const f = fixture(t);
  f.host.processes = () => {
    if (f.calls().some(row => row.tool === 'claude' && row.args[1] === 'update')) throw new Error('process list became unavailable');
    return [];
  };
  const result = await f.run();
  assert.equal(result.outcome, 'waiting', JSON.stringify(result));
  assert.ok(result.holders.some(row => row.state === 'unknown'));
  assert.equal(f.calls().filter(row => row.tool === 'claude' && row.args[1] === 'update').length, 1);
  assert.ok(!f.calls().some(row => row.tool === 'codex' && row.args[1] === 'add'));
  assert.deepEqual(result.places.map(row => row.actual), ['1.1.0', '1.0.0', '1.0.0']);
  assert.deepEqual(read(path.join(f.root, 'control.json')), { state: 'idle', custom: 'preserve' });
});
