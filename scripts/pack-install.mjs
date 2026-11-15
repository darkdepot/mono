#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { atomicJson, canonical, readJson, withLock, processTable, processStart, isMain, resolvedLocation } from './runtime.mjs';
import { updateBlockers, verifyQuiescence } from './verify-pack-state.mjs';
import { verify as verifyDrain, close as closeDrain } from './orchestrator/landing-drain.mjs';
import { attemptState } from './orchestrator/command-state.mjs';

const plugin = 'mono@mono-marketplace', marketplace = 'mono-marketplace';
const optional = (file, fallback) => fs.existsSync(file) ? readJson(file) : fallback;
const registryFile = place => path.join(place.place, 'plugins/installed_plugins.json');
const claudeEntries = place => optional(registryFile(place), { plugins: {} }).plugins?.[plugin] ?? [];
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', timeout: 120_000,
  maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options });
const inside = (file, dir) => file === dir || file?.startsWith(dir + path.sep);

function release(repo, tag, env) {
  const git = (...args) => run('git', ['-C', repo, ...args], { env }).trim();
  if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag ?? '')) throw new Error('release tag v<VERSION> required');
  const sha = git('rev-parse', `${tag}^{commit}`), version = git('show', `${sha}:VERSION`);
  if (tag !== `v${version}`) throw new Error(`tag and VERSION differ: ${tag}`);
  const tree = new Map();
  for (const row of run('git', ['-C', repo, 'ls-tree', '-rz', sha], { env }).split('\0').filter(Boolean)) {
    const separator = row.indexOf('\t'), header = row.slice(0, separator), file = row.slice(separator + 1), [mode, type, hash] = header.split(' ');
    if (type !== 'blob') throw new Error(`unsupported release object: ${file}`);
    tree.set(file, { mode, hash });
    for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent)) tree.set(parent, { mode: '040000' });
  }
  return { tag, sha, version, tree, algorithm: git('rev-parse', '--show-object-format') };
}

export function verifyTree(folder, expected, kind) {
  const seen = new Set(), errors = [];
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir)) {
      const file = prefix + name, absolute = path.join(dir, name), stat = fs.lstatSync(absolute), wanted = expected.tree.get(file);
      if (!wanted && !prefix && ((kind === 'codex' && name === '.git' || kind === 'claude' && name === '.in_use') && stat.isDirectory() ||
          kind === 'codex' && name === '.codex-marketplace-install.json' && stat.isFile())) continue;
      seen.add(file);
      const mode = stat.isSymbolicLink() ? '120000' : stat.isDirectory() ? '040000' : stat.isFile() ? stat.mode & 0o100 ? '100755' : '100644' : 'unsupported';
      if (!wanted || mode !== wanted.mode) errors.push(`${file}: type/mode or extra object`);
      if (mode === '040000') walk(absolute, file + '/');
      else if (wanted && ['100644', '100755', '120000'].includes(mode)) {
        const bytes = mode === '120000' ? Buffer.from(fs.readlinkSync(absolute)) : fs.readFileSync(absolute);
        const hash = crypto.createHash(expected.algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (hash !== wanted.hash) errors.push(`${file}: content differs`);
      }
    }
  }
  walk(folder);
  for (const file of expected.tree.keys()) if (!seen.has(file)) errors.push(`${file}: missing`);
  if (errors.length) throw new Error(`tree differs at ${folder}: ${errors.join('; ')}`);
}

// Accept the literal table emitted by the CLI; refuse ambiguous/unsupported TOML
// rather than interpreting another profile's setting or editing config ourselves.
function codexRef(place) {
  const file = path.join(place.place, 'config.toml');
  if (!fs.existsSync(file)) return null;
  const sections = [...fs.readFileSync(file, 'utf8').matchAll(/(?:^|\n)\[marketplaces\.(?:mono-marketplace|"mono-marketplace")\]\s*\n([\s\S]*?)(?=\n\[|$)/g)];
  if (!sections.length) return null;
  if (sections.length !== 1) throw new Error('ambiguous Codex marketplace table');
  const refs = [...sections[0][1].matchAll(/^ref\s*=\s*("[^"\n]+")\s*$/gm)];
  if (refs.length !== 1) throw new Error('Codex marketplace requires a literal ref');
  for (const [key, wanted] of [['source_type', 'git'], ['source', 'https://github.com/darkdepot/mono.git']]) {
    const values = [...sections[0][1].matchAll(new RegExp('^' + key + '\\s*=\\s*("[^"\\n]+")\\s*$', 'gm'))];
    if (values.length !== 1 || JSON.parse(values[0][1]) !== wanted) throw new Error('Codex marketplace source differs');
  }
  return JSON.parse(refs[0][1]);
}
function codexEntries(place, env) {
  const entries = JSON.parse(run('codex', ['plugin', 'list', '--json'], { env: { ...env, CODEX_HOME: place.place } })).installed;
  if (!Array.isArray(entries)) throw new Error('Codex installed list unavailable');
  return entries;
}
function installed(place, env) {
  if (place.kind === 'claude') return claudeEntries(place).filter(row => !row.projectPath);
  return codexEntries(place, env).filter(row => row.pluginId === plugin).map(row => {
    let metadata;
    try { metadata = readJson(path.join(row.source.path, '.codex-marketplace-install.json')); }
    catch { /* A partial write is a failed proof, not a missing installation. */ }
    return { version: row.version, installPath: row.source?.path, gitCommitSha: metadata?.revision ?? null };
  });
}
function inspect(place, expected, env, pins = true) {
  try {
    const entries = installed(place, env);
    if (!entries.length) throw new Error('plugin not installed');
    if (pins && place.kind === 'codex' && codexRef(place) !== expected.tag) throw new Error('Codex config ref differs');
    if (pins && place.kind === 'claude') {
      const settings = readJson(path.join(place.place, 'settings.json')), known = readJson(path.join(place.place, 'plugins/known_marketplaces.json'));
      if (settings.extraKnownMarketplaces?.[marketplace]?.source?.ref !== expected.tag || known[marketplace]?.source?.ref !== expected.tag) throw new Error('Claude profile refs differ');
      for (const source of [settings.extraKnownMarketplaces[marketplace].source, known[marketplace].source])
        if (source.source !== 'github' || source.repo !== 'darkdepot/mono') throw new Error('Claude marketplace source differs');
      if (settings.extraKnownMarketplaces[marketplace].autoUpdate === true) throw new Error('Claude automatic updates are enabled');
    }
    for (const row of entries) {
      if (row.version !== expected.version || row.gitCommitSha !== expected.sha) throw new Error('installed version/commit differs');
      if (!path.isAbsolute(row.installPath ?? '')) throw new Error('installed folder unavailable');
      verifyTree(row.installPath, expected, place.kind);
    }
    return { ...place, expected: expected.version, actual: [...new Set(entries.map(row => row.version))].join(','), folders: entries.map(row => row.installPath), verified: true };
  } catch (error) {
    let entries = [];
    try { entries = installed(place, env); } catch { /* reported as unverifiable */ }
    return { ...place, expected: expected.version, actual: entries.map(row => row.version).join(',') || null,
      folders: entries.map(row => row.installPath).filter(folder => path.isAbsolute(folder ?? '')), verified: false, error: error.message };
  }
}
function profilePins(place) {
  return ['settings.json', 'plugins/known_marketplaces.json'].map(name => {
    const file = path.join(place.place, name), document = optional(file, {}), settings = name === 'settings.json';
    const container = settings ? document.extraKnownMarketplaces ?? {} : document;
    return { file, exists: fs.existsSync(file), settings, hadContainer: settings && Object.hasOwn(document, 'extraKnownMarketplaces'),
      hadEntry: Object.hasOwn(container, marketplace), entry: container[marketplace] ?? null };
  });
}
function restorePins(records) {
  for (const prior of records) {
    const document = optional(prior.file, {});
    const container = prior.settings ? document.extraKnownMarketplaces ??= {} : document;
    if (prior.hadEntry) container[marketplace] = prior.entry; else delete container[marketplace];
    if (prior.settings && !prior.hadContainer && !Object.keys(container).length) delete document.extraKnownMarketplaces;
    if (!prior.exists && !Object.keys(document).length) fs.rmSync(prior.file, { force: true });
    else atomicJson(prior.file, document);
  }
}
function pinClaude(place, tag, env, original) {
  const settingsFile = path.join(place.place, 'settings.json'), knownFile = path.join(place.place, 'plugins/known_marketplaces.json');
  const settings = optional(settingsFile, {}), known = optional(knownFile, {});
  const old = original ?? profilePins(place);
  settings.extraKnownMarketplaces ??= {};
  settings.extraKnownMarketplaces[marketplace] ??= { source: { source: 'github', repo: 'darkdepot/mono' } };
  known[marketplace] ??= { source: { source: 'github', repo: 'darkdepot/mono' } };
  for (const entry of [settings.extraKnownMarketplaces[marketplace], known[marketplace]]) {
    if (entry.source?.source !== 'github' || entry.source.repo !== 'darkdepot/mono') throw new Error(`unexpected Claude marketplace source at ${place.place}`);
    entry.source.ref = tag;
  }
  settings.extraKnownMarketplaces[marketplace].autoUpdate = false;
  try {
    atomicJson(settingsFile, settings); atomicJson(knownFile, known);
    for (const [file, value] of [[settingsFile, settings], [knownFile, known]]) if (canonical(readJson(file)) !== canonical(value)) throw new Error('profile pin read-back differs');
    const output = run('claude', ['plugin', 'list', '--json'], { env });
    JSON.parse(output);
    if (/failed to load|source doesn't match|"errors"\s*:\s*\[[^\]]*\S[^\]]*\]/i.test(output)) throw new Error('Claude catalog cannot be read');
  } catch (error) {
    restorePins(old);
    throw new Error(`Claude pin/catalog refused at ${place.place}: ${error.message}`);
  }
}
function put(place, expected, env, original) {
  if (place.kind === 'claude') {
    env = { ...env, CLAUDE_CONFIG_DIR: place.place };
    // Register clean profiles before the dual-file pin; registration never installs.
    if (!fs.existsSync(path.join(place.place, 'plugins/known_marketplaces.json'))) run('claude', ['plugin', 'marketplace', 'add', 'darkdepot/mono'], { env });
    pinClaude(place, expected.tag, env, original);
    run('claude', ['plugin', 'marketplace', 'update', marketplace], { env });
    run('claude', ['plugin', installed(place, env).length ? 'update' : 'install', plugin], { env });
  } else {
    env = { ...env, CODEX_HOME: place.place };
    run('codex', ['plugin', 'marketplace', 'add', 'darkdepot/mono', '--ref', expected.tag], { env });
    run('codex', ['plugin', 'add', plugin, '--json'], { env });
  }
}
function fresh(place, verified, env, cwd) {
  const prompt = 'Find the installed mono:ship skill in this fresh session. Do not invoke it or change files. Return only JSON {"skill":"mono:ship","path":"absolute path to its SKILL.md"}. If unavailable return {"skill":null,"path":null}.';
  let message;
  if (place.kind === 'claude') message = JSON.parse(run('claude', ['-p', prompt, '--output-format', 'json', '--tools', 'Read,Glob', '--permission-mode', 'dontAsk'], { cwd, env: { ...env, CLAUDE_CONFIG_DIR: place.place } })).result;
  else {
    const rows = run('codex', ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', cwd, prompt], { cwd, env: { ...env, CODEX_HOME: place.place } })
      .trim().split('\n').map(line => JSON.parse(line));
    message = rows.filter(row => row.type === 'item.completed' && row.item?.type === 'agent_message').at(-1)?.item.text;
  }
  const result = JSON.parse(message);
  if (result.skill !== 'mono:ship' || !verified.folders.some(folder => result.path === path.join(folder, 'skills/ship/SKILL.md'))) throw new Error(`fresh session cannot find mono:ship at ${place.place}`);
}
function cwdOf(pid) {
  if (process.platform === 'linux') return fs.readlinkSync(`/proc/${pid}/cwd`);
  const value = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find(line => line.startsWith('n'));
  if (!value) throw new Error(`process cwd unavailable: ${pid}`);
  return value.slice(1);
}
function processPlaces(host) {
  return host.processes().flatMap(row => {
    const command = /(?:^|[\s/])(claude|codex)(?:\.(?:js|mjs))?(?:\s|$)/.exec(row.command)?.[1];
    if (!command || row.state?.startsWith('Z')) return [];
    let cwd = null;
    try {
      cwd = host.cwdOf(row.pid);
      if (!path.isAbsolute(cwd ?? '')) throw new Error('absolute process cwd unavailable');
    } catch (error) { throw Object.assign(new Error(`process cwd unavailable: ${row.pid}: ${error.message}`), { waiting: true, pid: row.pid }); }
    return [{ pid: row.pid, command, cwd, startedAt: row.procStartEpoch, argv: row.command }];
  });
}
async function restartWatcher(folder, options, expected) {
  const pulseFile = path.join(options.root, 'watcher.json'), old = optional(pulseFile, null);
  if (old && (!Number.isSafeInteger(old.pid) || old.pid <= 0 || typeof old.procStart !== 'string' || !old.procStart.trim())) throw new Error('invalid watcher process identity');
  if (old && processStart(old.pid) === old.procStart) {
    process.kill(old.pid, 'SIGTERM');
    const until = Date.now() + 10_000;
    while (processStart(old.pid) === old.procStart && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
    if (processStart(old.pid) === old.procStart) throw new Error('previous watcher did not stop');
  }
  const log = fs.openSync(path.join(options.root, 'watcher-install.log'), 'a', 0o600), started = Date.now();
  const child = spawn(process.execPath, [path.join(folder, 'scripts/watch-workers.mjs'), '--root', options.root, '--config', options.config],
    { detached: true, env: options.env, stdio: ['ignore', log, log] });
  child.on('error', () => {}); child.unref(); fs.closeSync(log);
  for (const deadline = Date.now() + 15_000; Date.now() < deadline;) {
    const pulse = optional(pulseFile, null);
    if (pulse?.pid === child.pid && pulse.packVersion === expected.version && Date.parse(pulse.startedAt) >= started - 1000 &&
        Date.parse(pulse.beatAt) >= started - 1000 && Date.parse(pulse.beatAt) <= Date.now() + 1000 && pulse.intervalSec > 0 &&
        Date.now() - Date.parse(pulse.beatAt) <= pulse.intervalSec * 3000 && pulse.procStart && processStart(pulse.pid) === pulse.procStart) return;
    if (child.exitCode !== null || child.signalCode) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (child.pid && processStart(child.pid)) process.kill(child.pid, 'SIGTERM');
  throw new Error('fresh new-version watcher pulse unavailable');
}
async function locks(files, action, index = 0) {
  return index === files.length ? action() : withLock(files[index], () => locks(files, action, index + 1), { reclaim: true });
}

export function verifyInstallQuiescence(root, roots, config, wave = false) {
  for (const dir of roots) {
    const workers = readJson(path.join(dir, 'workers.json'));
    // This wave must retain its landed/stopped provenance until close. These
    // records are history, not active attempts; an unproven/paused one still blocks.
    const active = dir === root && wave ? Object.fromEntries(Object.entries(workers).filter(([, entry]) => attemptState(dir, entry, readJson(config)).state !== 'landed')) : workers;
    verifyQuiescence(readJson(path.join(dir, 'control.json')), active);
  }
}

export async function recoverInstallWave(root, sha) {
  for (const file of [path.join(root, 'landing/pending-install.json.lock'), path.join(root, 'landing/guard', `${sha}.json.lock`)]) {
    await withLock(file, () => {}, { reclaim: true });
  }
}

export async function replayClosedWave(args, places, close = closeDrain) {
  const file = path.join(args.root, 'landing/installed', `${args['install-sha']}.json`);
  if (!fs.existsSync(file)) return false;
  if (places.some(place => !place.verified)) throw new Error('closed wave differs from installed places; use standalone repair');
  const archive = readJson(file);
  const result = await close({ ...args, evidence: archive.evidence ?? JSON.stringify(places) }, { underInstallLocks: true });
  if (result.code !== 0) throw new Error('landing-drain close replay refused installation');
  return true;
}

// The first release record and control snapshot never change. Later completed
// runs may append first-seen recovery records for additional places.
function installRecord(file) {
  const record = readJson(file), directory = file.replace(/\.json$/, '.places');
  const places = [...record.places];
  if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory).sort()) {
    if (!/^\d{6}\.json$/.test(name)) throw new Error(`unexpected place recovery record: ${name}`);
    const extension = readJson(path.join(directory, name));
    if (extension.tag !== record.tag || extension.sha !== record.sha || !Array.isArray(extension.places)) throw new Error('place recovery record differs from release');
    for (const place of extension.places) {
      if (places.some(prior => prior.place === place.place)) throw new Error('duplicate place recovery record');
      places.push(place);
    }
  }
  return { ...record, places };
}

export async function installPack(input, overrides = {}) {
  const options = { home: os.homedir(), env: process.env, profiles: [], removePlaces: [], watcherConfigs: {}, ...input };
  const host = { processes: processTable, cwdOf, restartWatcher, verifyDrain, closeDrain, ...overrides };
  const processes = host.processes;
  host.processes = () => {
    try {
      const rows = processes();
      if (!Array.isArray(rows) || rows.some(row => !row.state?.startsWith('Z') && !row.command?.trim())) throw new Error('process commands unavailable');
      return rows;
    } catch (error) { throw Object.assign(error, { waiting: true }); }
  };
  const result = { code: 1, outcome: 'stopped', places: [], holders: [], restart: [], localCopies: [] };
  let saved, snapshot, baseline, places = [], expected, paused = false, root, progressFile, progress;
  const releases = new Map();
  const target = tag => { if (!releases.has(tag)) releases.set(tag, release(options.repo, tag, options.env)); return releases.get(tag); };
  try {
    for (const field of ['root', 'repo', 'config']) {
      if (!path.isAbsolute(options[field] ?? '')) throw new Error(`absolute --${field} required`);
      options[field] = path.resolve(options[field]);
    }
    root = options.root;
    const products = path.resolve(options.productsRoot ?? path.dirname(root));
    expected = target(options.tag);
    if (path.dirname(root) !== products) throw new Error('--root must be a product under --products-root');
    const control = path.join(root, 'control.json');
    const roots = [...new Set([root, ...(fs.existsSync(products) ? fs.readdirSync(products, { withFileTypes: true }) : [])
      .filter(row => row.isDirectory() && ['workers.json', 'control.json'].some(file => fs.existsSync(path.join(products, row.name, file))))
      .map(row => path.join(products, row.name))])].sort();
    // Dispatch always precedes launch, matching orchestrator publication order.
    const lockFiles = ['dispatch.lock', 'launch.lock'].flatMap(name => roots.map(dir => path.join(dir, name)));
    return await withLock(path.join(products, 'pack-install.lock'), () => locks(lockFiles, async () => {
      // Only the installing product may bootstrap. Other products remain strict.
      for (const [file, empty] of [[control, { state: 'idle' }], [path.join(root, 'workers.json'), {}]]) {
        if (!fs.existsSync(file)) {
          atomicJson(file, empty);
          if (canonical(readJson(file)) !== canonical(empty)) throw new Error('bootstrap read-back differs');
        }
      }
      const installDir = path.join(root, 'landing/install'), baselineFile = path.join(installDir, `${expected.tag}.json`);
      for (const file of fs.existsSync(installDir) ? fs.readdirSync(installDir).filter(name => name.endsWith('.progress.json') && name !== `${expected.tag}.progress.json`).sort() : []) {
        const unfinishedFile = path.join(installDir, file), unfinished = readJson(unfinishedFile), tag = file.slice(0, -'.progress.json'.length);
        if (['installed', 'rolled-back'].includes(unfinished.outcome)) continue;
        const recordFile = path.join(installDir, `${tag}.json`);
        if (!fs.existsSync(recordFile)) continue;
        const record = readJson(recordFile);
        if (unfinished.pauseActive) {
          saved = unfinished.pauseControl ?? readJson(record.snapshot);
          atomicJson(control, saved);
          unfinished.pauseActive = false;
          atomicJson(unfinishedFile, unfinished);
          if (canonical(readJson(unfinishedFile)) !== canonical(unfinished)) throw new Error('pause recovery read-back differs');
        }
        places = installRecord(recordFile).places.filter(place => !unfinished.removedPlaces?.includes(place.place))
          .map(({ kind, place }) => ({ kind, place }));
        result.places = places.map(place => ({ ...inspect(place, expected, options.env), expected: record.version,
          verified: false, error: `unfinished installation ${tag}` }));
        throw new Error(`unfinished installation ${tag}; resume that tag before installing ${expected.tag}`);
      }
      progressFile = path.join(installDir, `${expected.tag}.progress.json`);
      baseline = fs.existsSync(baselineFile) ? installRecord(baselineFile) : null;
      progress = optional(progressFile, { phase: 'install', intents: [] });
      const persist = () => { atomicJson(progressFile, progress); if (canonical(readJson(progressFile)) !== canonical(progress)) throw new Error('intent read-back differs'); };
      if (baseline) {
        snapshot = baseline.snapshot;
        if (progress.pauseActive) {
          saved = progress.pauseControl ?? readJson(snapshot);
          atomicJson(control, saved); progress.pauseActive = false; persist();
        }
        readJson(snapshot);
      }
      saved = readJson(control);
      if (baseline && baseline.sha !== expected.sha) throw new Error('installation tag changed since the immutable record');
      if (options.wave) await recoverInstallWave(root, expected.sha);
      for (const dir of roots) {
        const workers = readJson(path.join(dir, 'workers.json'));
        if (!workers || typeof workers !== 'object' || Array.isArray(workers)) throw new Error(`invalid product registry: ${dir}`);
        const value = readJson(path.join(dir, 'control.json'));
        if (!value || typeof value !== 'object' || Array.isArray(value) || !['active', 'draining', 'idle'].includes(value.state) ||
            value.halt !== undefined && typeof value.halt !== 'boolean') throw new Error(`invalid product control: ${dir}`);
      }
      const history = fs.existsSync(installDir) ? fs.readdirSync(installDir).filter(file => /^v.*\.json$/.test(file) && !file.endsWith('.progress.json')).map(file => installRecord(path.join(installDir, file))).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
      const profiles = fs.readdirSync(options.home).filter(name => name.startsWith('.claude')).map(name => path.join(options.home, name)).filter(dir => fs.existsSync(path.join(dir, 'plugins/installed_plugins.json')));
      const discovered = [path.join(options.home, '.claude'), ...profiles.filter(dir => claudeEntries({ place: dir }).length), ...options.profiles];
      places = [...new Map(discovered.map(place => [resolvedLocation(path.resolve(place)), { kind: 'claude', place: path.resolve(place) }])).values()];
      places.push({ kind: 'codex', place: path.resolve(options.env.CODEX_HOME || path.join(options.home, '.codex')) });
      if (places.some(place => resolvedLocation(place.place) === resolvedLocation(places.at(-1).place) && place.kind !== places.at(-1).kind)) throw new Error('Claude and Codex places must be separate directories');
      const remembered = [...history.flatMap(record => record.places), ...(baseline?.places ?? [])];
      for (const prior of remembered) {
        const current = places.find(place => resolvedLocation(place.place) === resolvedLocation(prior.place));
        if (current && current.kind !== prior.kind) throw new Error('Claude and Codex places must be separate directories');
        if (current) current.place = prior.place;
        if (!current) places.push({ kind: prior.kind, place: prior.place });
      }
      const retired = history.flatMap(record => optional(path.join(installDir, `${record.tag}.progress.json`), {}).removedPlaces ?? []);
      const removed = [...new Set([...retired, ...(progress.removedPlaces ?? []), ...options.removePlaces.map(value => path.resolve(value))])];
      result.removedPlaces = removed;
      places = places.filter(place => !removed.includes(place.place));
      const additions = baseline ? places.filter(place => !baseline.places.some(prior => prior.place === place.place)) : [];
      if (additions.length && (!['installed', 'rolled-back'].includes(progress.outcome) ||
          baseline.places.some(prior => !removed.includes(prior.place) && !progress.places?.some(place => place.place === prior.place))))
        throw new Error('finish the incomplete installation before adding places');
      for (const place of places) if (!fs.existsSync(place.place) && remembered.some(prior => prior.place === place.place)) {
        const pendingCreate = baseline?.places.some(prior => prior.place === place.place && prior.existed === false) &&
          !progress.places?.some(prior => prior.place === place.place) &&
          !progress.intents.some(intent => intent.place === place.place && intent.result) && !history.some(record => record.tag !== expected.tag && record.places.some(prior => prior.place === place.place));
        if (!pendingCreate) throw new Error(`remembered place disappeared: ${place.place}; requires --remove-place`);
      }
      function localCopies() {
        const copies = [];
        for (const dir of [...new Set([...profiles, ...places.filter(place => place.kind === 'claude').map(place => place.place)])]) {
          const entries = optional(registryFile({ place: dir }), { plugins: {} }).plugins ?? {};
          for (const [id, rows] of Object.entries(entries)) for (const row of rows) if (id === 'mono@mono-dev' || id === plugin && row.projectPath) copies.push({ place: dir, plugin: id, ...row });
        }
        for (const place of places.filter(place => place.kind === 'codex')) for (const row of codexEntries(place, options.env)) if (row.pluginId === 'mono@mono-dev' || row.pluginId === plugin && row.projectPath) copies.push({ place: place.place, plugin: row.pluginId, ...row });
        return copies;
      }
      result.localCopies = localCopies();
      const before = places.map(place => ({ ...place, entries: installed(place, options.env) }));
      // Protect the rollback targets too, including after a partial installation
      // has already moved the current registry to the new version.
      const folders = [...new Set(before.flatMap(place => {
        const prior = baseline?.places.find(row => row.place === place.place)?.previous;
        const cache = path.join(place.place, 'plugins/cache/mono-marketplace/mono');
        return [...place.entries.map(row => row.installPath), ...(prior?.folders ?? []), ...(prior ? [path.join(cache, prior.version)] : []),
          place.kind === 'codex' ? cache : path.join(cache, expected.version)];
      }).filter(Boolean))];
      function refreshHolders() {
        result.holders = [];
        for (const folder of folders) {
          const found = updateBlockers(folder, products);
          for (const blocker of found.blockers) {
            const workers = readJson(path.join(products, blocker.product, 'workers.json'));
            const entry = Object.values(workers).find(row => row.issue === blocker.issue && row.attempt === blocker.attempt);
            const pid = entry?.pid;
            const live = Number.isSafeInteger(pid) && pid > 0 ? host.processes().some(row => !row.state?.startsWith('Z') && (row.pid === pid && (!entry.procStart || row.procStart === entry.procStart) || row.ppid === pid || entry.processGroup && row.group === entry.processGroup && row.pid !== pid)) : null;
            result.holders.push({ ...blocker, state: live === true ? 'live' : live === false ? 'dead' : 'unknown' });
          }
          result.holders.push(...found.unknown.map(row => ({ ...row, issue: row.key, state: 'unknown' })));
        }
        const sessions = processPlaces(host), codexFolders = before.filter(place => place.kind === 'codex').flatMap(place => place.entries.map(row => row.installPath));
        result.holders.push(...sessions.filter(row => codexFolders.some(folder => inside(row.cwd, folder) || row.argv.includes(folder))).map(row => ({ product: row.cwd, issue: null, pid: row.pid, state: 'live' })));
        if (before.some(place => place.kind === 'codex')) result.holders.push(...sessions.filter(row => row.command === 'codex' && !codexFolders.some(folder => inside(row.cwd, folder) || row.argv.includes(folder))).map(row => ({ product: row.cwd, issue: null, pid: row.pid, state: 'unknown', reason: 'live Codex session may use the installed cache' })));
        result.restart = sessions.map(({ argv, ...row }) => row);
        result.holders = [...new Map(result.holders.map(row => [canonical(row), row])).values()];
      }
      refreshHolders();
      result.places = places.map(place => inspect(place, expected, options.env));
      if (result.holders.some(row => row.state !== 'dead')) return { ...result, code: 2, outcome: 'waiting' };
      const drainArgs = { root, config: options.config, 'install-sha': expected.sha, worktree: options.repo };
      // close writes its archive before removing pending records. Finish that
      // committed cleanup before quiescence counts the same landing twice.
      // An archived wave covers its original places. Additional profiles are
      // reconciled below without asking an already closed wave to verify again.
      const wavePlaces = baseline ? result.places.filter(place => readJson(baselineFile).places.some(prior => prior.place === place.place)) : result.places;
      const closedWave = progress.phase !== 'rollback' && options.wave && await replayClosedWave(drainArgs, wavePlaces, host.closeDrain);
      const quiescence = () => verifyInstallQuiescence(root, roots, options.config, options.wave);
      if (options.breaking) quiescence();
      const watcherConfigs = roots.map(dir => {
        const configured = dir === root ? options.config : options.watcherConfigs[dir];
        const recorded = [...new Set(Object.values(readJson(path.join(dir, 'workers.json'))).map(row => row.config).filter(value => path.isAbsolute(value ?? '')))];
        const config = configured ?? (recorded.length === 1 ? recorded[0] : null);
        if (!path.isAbsolute(config ?? '') || !fs.existsSync(config)) throw new Error(`watcher config unavailable: ${dir}; requires --watcher-config ROOT=FILE`);
        return { root: dir, config };
      });
      async function watchers(folder, desired, recovery = false) {
        const errors = []; result.watchers = [];
        for (const watcher of watcherConfigs) {
          try {
            await host.restartWatcher(folder, { ...options, ...watcher }, desired);
            result.watchers.push({ ...watcher, version: desired.version, verified: true });
          } catch (error) {
            if (!recovery) throw error;
            errors.push(`${watcher.root}: ${error.message}`);
          }
        }
        if (errors.length) throw new Error(errors.join('; '));
      }
      const previousState = place => {
        const tags = [...new Set(place.entries.map(row => `v${row.version}`))];
        if (tags.length > 1) throw new Error(`multiple previous versions at ${place.place}`);
        const prior = tags.length ? target(tags[0]) : null;
        if (prior && place.entries.some(row => row.gitCommitSha !== prior.sha)) throw new Error(`previous commit differs from release tag: ${place.place}`);
        const profileRecords = place.kind === 'claude' ? profilePins(place) : undefined;
        return { kind: place.kind, place: place.place, existed: fs.existsSync(place.place), previous: prior ? { tag: prior.tag, version: prior.version, sha: prior.sha, folders: place.entries.map(row => row.installPath) } : null, ...(profileRecords ? { profileRecords } : {}) };
      };
      if (!baseline) {
        snapshot = path.join(root, `control.json.pre-update-${expected.version}`);
        const existed = fs.existsSync(snapshot);
        if (!existed) atomicJson(snapshot, saved);
        const snapshotControl = readJson(snapshot);
        if (!existed && canonical(snapshotControl) !== canonical(saved)) throw new Error('control snapshot read-back differs');
        const previous = before.map(previousState);
        baseline = { tag: expected.tag, sha: expected.sha, version: expected.version, createdAt: new Date().toISOString(), snapshot, places: previous };
        atomicJson(baselineFile, baseline);
        if (canonical(readJson(baselineFile)) !== canonical(baseline)) throw new Error('installation record read-back differs');
      }
      if (additions.length) {
        const directory = baselineFile.replace(/\.json$/, '.places');
        const number = fs.existsSync(directory) ? fs.readdirSync(directory).length + 1 : 1;
        const file = path.join(directory, `${String(number).padStart(6, '0')}.json`);
        const extension = { tag: expected.tag, sha: expected.sha, createdAt: new Date().toISOString(), places: before.filter(place => additions.some(row => row.place === place.place)).map(previousState) };
        if (fs.existsSync(file)) throw new Error('place recovery record already exists');
        atomicJson(file, extension);
        if (canonical(readJson(file)) !== canonical(extension)) throw new Error('place recovery read-back differs');
        baseline = installRecord(baselineFile);
      }
      const rollbackRelease = place => {
        const prior = baseline.places.find(row => row.place === place.place).previous;
        if (!prior) return null;
        const desired = target(prior.tag);
        if (desired.sha !== prior.sha) throw new Error(`previous release commit changed: ${place.place}`);
        return desired;
      };
      progress.removedPlaces = removed;
      if (progress.outcome === 'rolled-back') { progress.phase = 'install'; delete progress.reason; }
      delete progress.outcome;
      progress.pauseControl = saved; progress.pauseActive = true; persist();
      atomicJson(control, { ...saved, halt: true }); paused = true;
      const apply = (place, desired) => {
        const pinOnly = inspect(place, desired, options.env, false).verified;
        const intent = { place: place.place, action: pinOnly ? 'pin' : progress.phase, tag: desired.tag, at: new Date().toISOString() };
        progress.intents.push(intent); persist();
        try {
          const original = baseline.places.find(row => row.place === place.place).profileRecords;
          if (!pinOnly) {
            refreshHolders();
            if (result.holders.some(row => row.state !== 'dead')) throw Object.assign(new Error('holders appeared before replacement'), { waiting: true });
            if (progress.phase === 'rollback' && options.breaking) quiescence();
            put(place, desired, options.env, original);
          }
          else if (place.kind === 'claude') {
            const env = { ...options.env, CLAUDE_CONFIG_DIR: place.place };
            pinClaude(place, desired.tag, env, original);
            run('claude', ['plugin', 'marketplace', 'update', marketplace], { env });
          } else run('codex', ['plugin', 'marketplace', 'add', 'darkdepot/mono', '--ref', desired.tag], { env: { ...options.env, CODEX_HOME: place.place } });
        }
        catch (error) { intent.error = error.message; persist(); throw error; }
        return intent;
      };
      async function reconcile(rollback) {
        // U8: machine-wide quiescence applies to breaking rollback. Every
        // compatible replacement still rechecks its live/unknown holders.
        if (rollback && options.breaking) quiescence();
        const plan = places.map(place => {
          const desired = rollback ? rollbackRelease(place) : expected;
          return { place, desired, inspected: desired ? inspect(place, desired, options.env) : { ...inspect(place, expected, options.env), expected: null, verified: false, error: 'no previous release to restore' } };
        });
        const errors = [];
        for (const item of plan) {
          const { place, desired } = item;
          try {
            if (!desired) throw new Error(`no previous release to restore at ${place.place}`);
            for (let attempt = 0; !item.inspected.verified && attempt < 2; attempt++) {
              const intent = apply(place, desired);
              item.inspected = inspect(place, desired, options.env);
              intent.result = item.inspected; persist();
            }
            if (!item.inspected.verified) throw new Error(item.inspected.error);
          } catch (error) { if (!rollback || error.waiting) throw error; errors.push(`${place.place}: ${error.message}`); }
        }
        result.places = plan.map(({ place, desired, inspected }) => desired ? inspect(place, desired, options.env) : inspected);
        if (errors.length) throw new Error(errors.join('; '));
        if (result.places.some(place => !place.verified)) throw new Error('final all-place verification differs');
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-fresh-'));
        try { for (const place of result.places) fresh(place, place, options.env, cwd); }
        finally { fs.rmSync(cwd, { recursive: true, force: true }); }
      }
      async function installedWatchers(rollback) {
        const place = result.places.find(place => place.kind === 'codex') ?? result.places[0];
        const desired = rollback ? rollbackRelease(place) : expected;
        await watchers(place.folders[0], desired);
      }
      let completed = false;
      try {
        if (progress.phase !== 'rollback' && options.wave && !closedWave && (await host.verifyDrain(drainArgs, { underInstallLocks: true })).code !== 0) throw new Error('landing-drain verify refused installation');
        if (progress.phase !== 'rollback') {
          try { await reconcile(false); await installedWatchers(false); }
          catch (error) { if (error.waiting) throw error; progress.phase = 'rollback'; progress.reason = error.message; persist(); }
        }
        if (progress.phase === 'rollback') { await reconcile(true); await installedWatchers(true); }
        if (options.wave && !closedWave && progress.phase !== 'rollback' && (await host.closeDrain({ ...drainArgs, evidence: JSON.stringify(result.places) }, { underInstallLocks: true })).code !== 0) throw new Error('landing-drain close refused installation');
        result.restart = processPlaces(host).map(({ argv, ...row }) => row);
        result.localCopies = localCopies();
        Object.assign(result, { code: progress.phase === 'rollback' ? 1 : 0, outcome: progress.phase === 'rollback' ? 'rolled-back' : 'installed', ...(progress.reason ? { reason: progress.reason } : {}) });
        progress.outcome = result.outcome; progress.places = result.places; persist();
        completed = true;
        return result;
      } finally {
        if (!completed) {
          const candidates = before.filter(place => place.entries.length).sort((a, b) => Number(b.kind === 'codex') - Number(a.kind === 'codex'));
          for (const place of candidates) {
            const prior = baseline.places.find(row => row.place === place.place).previous;
            if (!prior) continue;
            let desired;
            try { desired = rollbackRelease(place); } catch { desired = expected; }
            let check = inspect(place, desired, options.env);
            if (!check.verified) { desired = expected; check = inspect(place, desired, options.env); }
            if (!check.verified) continue;
            try { await watchers(check.folders[0], desired, true); }
            catch (error) { result.watcherError = error.message; }
            break;
          }
        }
        atomicJson(control, saved); paused = false; progress.pauseActive = false; persist();
      }
    }), { reclaim: true });
  } catch (error) {
    let restoreError;
    if (paused && saved) {
      try { atomicJson(path.join(root, 'control.json'), saved); paused = false; }
      catch (cause) { restoreError = cause.message; }
    }
    if (expected) result.places = places.map(place => {
      const observed = inspect(place, expected, options.env), previous = result.places.find(row => row.place === place.place);
      return previous ? { ...previous, actual: observed.actual, folders: observed.folders,
        verified: previous.verified && previous.expected === observed.actual } : observed;
    });
    if (error.waiting) result.holders.push({ product: null, issue: null, ...(error.pid ? { pid: error.pid } : {}), state: 'unknown', reason: error.message });
    return { ...result, code: error.waiting ? 2 : 1, outcome: error.waiting ? 'waiting' : 'stopped', reason: error.message, ...(restoreError ? { restoreError } : {}) };
  }
}

// Lock recovery must not mistake the still-running caller's process group for
// installer descendants. The public CLI always waits on its own isolated group.
async function isolated(argv) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.resolve(process.argv[1]), ...argv], {
      detached: true, env: { ...process.env, MONO_PACK_INSTALL_PARENT: String(process.pid) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    const forward = signal => { if (Number.isSafeInteger(child.pid) && child.pid > 0) { try { process.kill(-child.pid, signal); } catch { /* child already stopped */ } } };
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.on('error', error => resolve({ code: 1, outcome: 'stopped', reason: error.message, places: [], holders: [], restart: [], localCopies: [] }));
    child.on('close', (code, signal) => {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
      try {
        const result = JSON.parse(output);
        if (signal || code !== result.code) throw new Error('incomplete installer result');
        resolve(result);
      } catch { resolve({ code: 1, outcome: 'stopped', reason: `installer interrupted (${signal ?? code}); rerun to recover its recorded pause`, places: [], holders: [], restart: [], localCopies: [] }); }
    });
  });
}

if (isMain(import.meta.url) && !process.argv.includes('--help') && Number(process.env.MONO_PACK_INSTALL_PARENT) !== process.ppid) {
  const result = await isolated(process.argv.slice(2)); console.log(JSON.stringify(result)); process.exitCode = result.code;
} else if (isMain(import.meta.url)) {
  const args = process.argv.slice(2), options = { profiles: [], removePlaces: [], watcherConfigs: {} };
  try {
    if (args.includes('--help')) console.log('pack-install.mjs --root STATE --repo CHECKOUT --tag v<VERSION> --config FILE [--profile DIR] [--remove-place DIR] [--products-root DIR] [--watcher-config ROOT=FILE] [--breaking] [--wave]');
    else {
      for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        if (flag === '--breaking' || flag === '--wave') { options[flag.slice(2)] = true; continue; }
        if (!['--root', '--repo', '--tag', '--config', '--profile', '--remove-place', '--products-root', '--watcher-config'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`invalid argument ${flag}`);
        const value = args[++i];
        if (flag === '--profile') options.profiles.push(value);
        else if (flag === '--remove-place') options.removePlaces.push(value);
        else if (flag === '--watcher-config') {
          const separator = value.indexOf('='), root = value.slice(0, separator), config = value.slice(separator + 1);
          if (separator < 0 || !path.isAbsolute(root) || !path.isAbsolute(config)) throw new Error('--watcher-config requires absolute ROOT=FILE');
          options.watcherConfigs[path.resolve(root)] = config;
        }
        else options[flag === '--products-root' ? 'productsRoot' : flag.slice(2)] = value;
      }
      const result = await installPack(options); console.log(JSON.stringify(result)); process.exitCode = result.code;
    }
  } catch (error) { console.log(JSON.stringify({ code: 1, outcome: 'stopped', reason: error.message, places: [], holders: [], restart: [], localCopies: [] })); process.exitCode = 1; }
}
