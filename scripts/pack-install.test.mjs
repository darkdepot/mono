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
    if (fs.existsSync(pulse)) { try { process.kill(read(pulse).pid, 'SIGTERM'); } catch { /* already exited */ } }
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
 const r=releases[a],dest=path.join(profile,'plugins/cache/mono-marketplace/mono',r.version);
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
    atomicJson(path.join(profile, 'settings.json'), { custom: 'keep', extraKnownMarketplaces: { 'mono-marketplace': { source: { source: 'github', repo: 'darkdepot/mono', ref: 'v1.0.0' } } } });
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
if(a.includes('-p')) {try{process.kill(Number(a[a.indexOf('-p')+1]),0);console.log(stamp)}catch{process.exit(1)}}
else if(a.join(' ').includes('ppid='))console.log(process.ppid+' 1 '+process.ppid+' S '+stamp);
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
  const result = await f.run({ breaking: true });
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
  assert.equal((await f.run()).outcome, 'installed');
  assert.equal(f.calls().slice(offset).filter(c => c.args[1] === 'update').length, 1);
  assert.equal(fs.statSync(path.join(folder, 'executable')).mode & 0o111, 0o111);
  assert.equal(fs.readlinkSync(path.join(folder, 'version-link')), 'VERSION');
  assert.equal(fs.existsSync(path.join(folder, 'extra')), false);
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
  f.host.cwdOf = () => folder;
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
