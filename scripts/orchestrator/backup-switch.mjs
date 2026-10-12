import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicJson, readJson, baseModelConfig, canonical, digest, processTable, readProcessAttemptMarker, readProcessArguments, resolveRole, resolvedLocation, syncDir, withLock, flags, isMain } from "../runtime.mjs";
import { effectivePins } from "./command-state.mjs";

const transports = ["codex-cli", "claude-cli"];
const reasons = ["subscription-exhausted", "provider-refusal-after-recovery"];
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const recordFile = (root, issue, attempt) => path.join(root, "attempt-records", `${issue}-a${attempt}.json`);
const switchFile = (root, issue) => path.join(root, "backup-switches", `${issue}.json`);

export const backupProcessBaseline = () => processTable().filter(row => !row.state.startsWith("Z"))
  .map(({ pid, procStart }) => ({ pid, procStart }));

function sameCapturedIdentity(row, old) {
  if (row.pid !== old.pid) return false;
  if (Number.isFinite(row.procStartEpoch) && Number.isFinite(old.procStartEpoch))
    return row.procStartEpoch === old.procStartEpoch;
  if (Number.isFinite(row.procStartEpoch) && Number.isFinite(old.observedByEpoch) && row.procStartEpoch > old.observedByEpoch)
    return false;
  // Without independent UTC observations, different locale/time-zone strings
  // cannot prove PID reuse. Keep the retained identity until reconciliation.
  return true;
}

function groupReused(group, captured, live) {
  const oldLeader = captured.find(row => row.pid === group && row.processGroup === group);
  const leader = live.find(row => row.pid === group);
  if (!oldLeader || !leader) return false;
  return !sameCapturedIdentity(leader, oldLeader);
}

function processObservations(previous) {
  const bound = (rows, time) => (rows ?? []).map(row => ({ ...row,
    observedByEpoch: Object.hasOwn(row, "observedByEpoch") ? row.observedByEpoch : Date.parse(time) }));
  return {
    writers: bound(previous.processes, previous.entry?.last_activity_at),
    captured: bound(previous.retirement?.processes, previous.retirement?.capturedAt)
  };
}

function capturedLive(row, captured, live) {
  return captured.some(old => sameCapturedIdentity(row, old) ||
    (row.group === old.processGroup && !groupReused(old.processGroup, captured, live)));
}

function substitutionEnd(source, start, backtick) {
  let quote = null;
  const contexts = [null];
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === "\\" && quote !== "'") { i++; continue; }
    if (backtick) { if (char === "`") return i; continue; }
    if (quote === "'") { if (char === quote) quote = null; continue; }
    if (char === '"') { quote = quote === '"' ? null : '"'; continue; }
    if (source.slice(i, i + 2) === "$(") { contexts.push(quote); quote = null; i++; continue; }
    if (quote) continue;
    if (char === "'") quote = char;
    else if (char === "(") contexts.push(null);
    else if (char === ")") { quote = contexts.pop(); if (!contexts.length) return i; }
    else if (char === "#" && (i === start || /[\s;|&()<>]/.test(source[i - 1]))) {
      while (i < source.length && source[i] !== "\n") i++;
    }
  }
  return null;
}

function commandWords(source, program) {
  const words = [];
  words.substitutions = [];
  words.commands = [];
  const shell = ["sh", "bash", "zsh", "dash", "ksh", "fish"].includes(program);
  const literalArguments = program === "env-args";
  let word = "", quote = null, started = false, commandStart = 0;
  const finish = () => { if (started) words.push(word); word = ""; started = false; };
  const finishCommand = () => {
    finish();
    if (words.length > commandStart) words.commands.push(words.slice(commandStart));
    commandStart = words.length;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (shell && quote !== "'" && (source.slice(i, i + 2) === "$(" || char === "`")) {
      const start = i + (char === "`" ? 1 : 2), end = substitutionEnd(source, start, char === "`");
      if (end !== null) {
        words.substitutions.push(source.slice(start, end));
        word += source.slice(i, end + 1); started = true; i = end; continue;
      }
    }
    if (quote) {
      if (char === quote) {
        quote = null;
        if (!shell && !literalArguments) {
          if (/^\s*(?:cd|pushd)\s/.test(word)) words.substitutions.push(word);
          finish();
        }
      }
      else if (char === "\\" && (!shell || quote === '"') && i + 1 < source.length) word += source[++i];
      else word += char;
    } else if (char === "#" && (!started || (!shell && !literalArguments))) {
      while (i < source.length && source[i] !== "\n") i++;
      if (shell) finishCommand(); else finish();
    } else if (["node", "nodejs", "php"].includes(program) && source.slice(i, i + 2) === "//") {
      while (i < source.length && source[i] !== "\n") i++;
      finish();
    } else if (["node", "nodejs", "php"].includes(program) && source.slice(i, i + 2) === "/*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
    } else if (char === "'" || char === '"' || (!shell && char === "`")) {
      if (!shell && !literalArguments) finish();
      quote = char; started = true;
    }
    else if (char === "\\" && i + 1 < source.length) { word += source[++i]; started = true; }
    else if (shell && /[;|&\n()]/.test(char)) finishCommand();
    else if ((literalArguments ? /\s/ : /[\s;|&()<>`]/).test(char)) finish();
    else { word += char; started = true; }
  }
  if (!quote) finish();
  if (shell) finishCommand();
  return words;
}

function evaluatesArgument(program, option) {
  if (["sh", "bash", "zsh", "dash", "ksh", "fish"].includes(program))
    return /^-[A-Za-z]*c[A-Za-z]*$/.test(option) || option === "--command";
  if (["node", "nodejs"].includes(program)) return ["-e", "--eval", "-p", "--print", "-pe"].includes(option);
  if (/^python(?:\d+(?:\.\d+)*)?$/.test(program)) return option === "-c";
  if (program === "perl") return ["-e", "-E"].includes(option);
  if (program === "ruby" || program === "lua") return option === "-e";
  return program === "php" && option === "-r";
}

function executionCommand(words, shellBody) {
  if (shellBody) {
    let start = 0;
    while (["if", "elif", "then", "else", "while", "until", "do", "!", "{"].includes(words[start]) ||
      /^[A-Za-z_][\w]*=/.test(words[start] ?? "")) start++;
    words = words.slice(start);
  }
  const wrappers = ["exec", "env", "command", "nohup", "nice", "time"];
  while (wrappers.includes(path.basename(words[0] ?? ""))) {
    const program = path.basename(words[0]), values = {
      exec: ["-a"], env: ["-u", "--unset", "-C", "--chdir", "-P", "-a", "--argv0"],
      nice: ["-n", "--adjustment"], time: ["-f", "--format", "-o", "--output"]
    }[program] ?? [];
    let start = 1;
    while (start < words.length && words[start].startsWith("-") && words[start] !== "-") {
      const option = words[start++];
      if (option === "--") break;
      const equals = option.indexOf("="), flag = equals < 0 ? option : option.slice(0, equals);
      if (program === "env" && ["-S", "--split-string"].includes(flag)) {
        const source = equals < 0 ? words[start++] : option.slice(equals + 1);
        if (source === undefined) return [];
        words = ["env", ...commandWords(source, "env-args"), ...words.slice(start)];
        start = 1; continue;
      }
      if (values.includes(flag)) { if (equals < 0) start++; continue; }
      if (program === "exec" && /^-[cl]*a/.test(option)) {
        if (/^-[cl]*a$/.test(option)) start++;
        continue;
      }
      if (program === "env" && /^-[uCPa].+/.test(option)) continue;
      if (program === "nice" && /^-(?:n[+-]?|[+-]?)\d+$/.test(option)) continue;
      const flags = {
        exec: /^-[cl]+$/, env: /^(?:-i|--ignore-environment|-)$/, command: /^-p$/,
        nohup: /^(?!)$/, nice: /^(?!)$/, time: /^-[pva]+$/
      }[program];
      if (!flags.test(option)) return [];
    }
    if (program === "env") while (/^[A-Za-z_][\w]*=/.test(words[start] ?? "")) start++;
    words = words.slice(start);
  }
  return words;
}

function evaluatedBodies(words) {
  const program = path.basename(words[0] ?? ""), bodies = [];
  const valueOptions = {
    node: ["-r", "--require", "--import", "--loader", "--experimental-loader", "--input-type", "--conditions", "-C"],
    python: ["-W", "-X"], lua: ["-l"], php: ["-c", "-d", "-z", "-f"], shell: ["-o", "-O"]
  };
  const options = ["node", "nodejs"].includes(program) ? valueOptions.node :
    /^python(?:\d+(?:\.\d+)*)?$/.test(program) ? valueOptions.python : valueOptions[program] ?? valueOptions.shell;
  for (let i = 1; i < words.length; i++) {
    const option = words[i];
    if (option === "--" || !option.startsWith("-") || option === "-") break;
    if (program === "ruby" && !option.startsWith("--")) {
      for (let n = 1; n < option.length; n++) {
        const flag = option[n];
        if (flag === "e") {
          const body = option.slice(n + 1) || words[++i];
          if (body) bodies.push({ body, program });
          break;
        }
        if ("IrEF".includes(flag)) { if (n + 1 === option.length) i++; break; }
        if (flag === "i" || (flag === "W" && option[n + 1] === ":")) break;
        if (flag === "W") { if (/\d/.test(option[n + 1] ?? "")) n++; }
        else if (flag === "0") { while (/[0-7]/.test(option[n + 1] ?? "")) n++; }
        else if (flag === "K") { if (n + 1 < option.length) n++; }
        else if (!"acdlnpsSvwy".includes(flag)) break;
      }
      continue;
    }
    if ((program === "lua" && option.startsWith("-e") || program === "php" && option.startsWith("-r")) && option.length > 2) {
      bodies.push({ body: option.slice(2), program }); continue;
    }
    if (program === "perl" && !option.startsWith("--")) {
      for (let n = 1; n < option.length; n++) {
        const flag = option[n];
        if (flag === "e" || flag === "E") {
          const body = option.slice(n + 1) || words[++i];
          if (body) bodies.push({ body, program });
          break;
        }
        if ("IFmMD".includes(flag)) { if (n + 1 === option.length) i++; break; }
        if (flag === "C") {
          if (n + 1 === option.length && /^(?:\d+|[IOEioeASDL]+)$/.test(words[i + 1] ?? "")) i++;
          break;
        }
        if ("ixV".includes(flag) || (flag === "d" && option[n + 1] === ":")) break;
        if (flag === "0" || flag === "l") {
          while (/\d/.test(option[n + 1] ?? "")) n++;
        } else if (!"acdfghnpSsTtuUvWwX".includes(flag)) break;
      }
      continue;
    }
    if (/^python(?:\d+(?:\.\d+)*)?$/.test(program) && !option.startsWith("--")) {
      let consumesNext = false, command = false;
      for (let n = 1; n < option.length; n++) {
        const flag = option[n];
        if (flag === "c" || flag === "m") {
          if (flag === "c") {
            const body = option.slice(n + 1) || words[++i];
            if (body) bodies.push({ body, program });
          }
          command = true; break;
        }
        if (flag === "W" || flag === "X") { consumesNext = n + 1 === option.length; break; }
        if (!"bBdEhiIOPqRsSuvVx?".includes(flag)) break;
      }
      if (command) break;
      if (consumesNext) i++;
      continue;
    }
    const equals = option.indexOf("="), flag = equals < 0 ? option : option.slice(0, equals);
    if (evaluatesArgument(program, flag)) {
      const body = equals < 0 ? words[++i] : option.slice(equals + 1);
      if (body) bodies.push({ body, program });
      // The shell/Python command ends interpreter options; remaining values
      // become command arguments, even if they resemble another code option.
      if (["sh", "bash", "zsh", "dash", "ksh", "fish"].includes(program) || /^python/.test(program)) break;
    } else if (option === "-m" && /^python/.test(program)) break;
    else if (equals < 0 && options.includes(option)) i++;
  }
  return bodies;
}

function exactAttemptReference(args, references) {
  const refs = references.filter(Boolean), pending = [args], seen = new Set();
  const matches = value => refs.some(reference => value === reference || value.startsWith(reference + "/"));
  while (pending.length) {
    const words = pending.pop();
    for (const body of words.substitutions ?? []) if (!seen.has(body)) {
      seen.add(body); pending.push(commandWords(body, "sh"));
    }
    for (const word of words) {
      const assignment = /^(?:--?[\w.-]+|[A-Za-z_][\w.]*)=([\s\S]*)$/.exec(word);
      if (matches(assignment ? assignment[1] : word)) return true;
    }
    for (const command of words.commands?.length ? words.commands : [words]) {
      const args = executionCommand(command, Boolean(words.commands?.length));
      if (args.some(word => matches(word))) return true;
      for (const { body, program } of evaluatedBodies(args)) if (!seen.has(body)) {
        seen.add(body); pending.push(commandWords(body, program));
      }
    }
  }
  return false;
}

function requireProcessOwnership(root, previous, live) {
  const baseline = previous.entry.processBaseline;
  if (!Array.isArray(baseline) || !baseline.length || baseline.some(row => !Number.isSafeInteger(row.pid) || row.pid <= 0 || !row.procStart))
    throw new Error("previous launch process baseline missing; reconcile process ownership before switching");
  const observer = live.find(row => row.pid === process.pid);
  if (!observer) throw new Error("process observer identity unavailable; reconcile before switching");
  const controls = new Set();
  let ancestor = observer;
  while (ancestor && !controls.has(ancestor.pid)) {
    controls.add(ancestor.pid);
    ancestor = live.find(row => row.pid === ancestor.ppid);
  }
  // Only descendants of this verified invocation, not siblings of its ancestors.
  const callerTree = new Set([observer.pid]);
  let added;
  do {
    added = false;
    for (const row of live) if (!callerTree.has(row.pid) && callerTree.has(row.ppid)) {
      callerTree.add(row.pid); controls.add(row.pid); added = true;
    }
  } while (added);
  const observations = processObservations(previous);
  const captured = [...observations.writers, ...observations.captured];
  // A collector is not part of the writer tree. Check this attempt's holder,
  // gate and their groups separately; never select another task by product root.
  const collectorFile = path.join(root, "reports", `${previous.entry.issue}-collector-a${previous.entry.attempt}.lock`);
  const collector = fs.existsSync(collectorFile) ? readJson(collectorFile) : null;
  const collectorObservedBy = collector ? fs.statSync(collectorFile).mtimeMs : null;
  const collectors = [collector, collector?.gate, ...(collector?.descendants ?? [])].filter(Boolean)
    .map(row => ({ ...row, observedByEpoch: collectorObservedBy }));
  const sameIdentity = sameCapturedIdentity;
  const reachesCapture = (row, targets = [...captured, ...collectors]) => {
    const seen = new Set();
    while (row && !seen.has(row.pid)) {
      seen.add(row.pid);
      if (targets.some(old => sameIdentity(row, old))) return true;
      row = live.find(parent => parent.pid === row.ppid);
    }
    return false;
  };
  const dispatchDirectory = previous.entry.pins?.file ? path.dirname(previous.entry.pins.file) : null;
  const references = [previous.entry.worktree, previous.entry.log, previous.entry.log?.replace(/\.jsonl$/, ".stderr.log"),
    previous.entry.settingsFile, previous.entry.dispatchFile,
    dispatchDirectory && path.basename(dispatchDirectory) === `${previous.entry.issue}-a${previous.entry.attempt}` ? dispatchDirectory : null,
    previous.entry.pins?.file, recordFile(root, previous.entry.issue, previous.entry.attempt),
    collectorFile, path.join(root, "reports", `${previous.entry.issue}-collector-a${previous.entry.attempt}-request.json`)];
  const remnants = [];
  let unavailableMarkerCount = 0, unavailableArgumentsCount = 0;
  for (const row of live) {
    const collectorSignal = capturedLive(row, collectors, live) || reachesCapture(row, collectors);
    if (controls.has(row.pid) && !collectorSignal) continue;
    let otherSignal = collectorSignal || capturedLive(row, captured, live) || reachesCapture(row);
    if (!otherSignal) {
      const args = readProcessArguments(row);
      if (args === null) unavailableArgumentsCount++;
      else otherSignal = exactAttemptReference(args, references);
    }
    const marker = previous.entry.attemptMarker ? readProcessAttemptMarker(row, previous.entry.attemptMarker) : "absent";
    if (otherSignal || marker === "matched") remnants.push(row.pid);
    else if (marker === "unavailable") unavailableMarkerCount++;
  }
  if (remnants.length) throw new Error(`unattributed processes after previous launch: ${remnants.join(", ")}; reconcile ownership before switching`);
  return { unavailableMarkerCount, unavailableArgumentsCount };
}

export function recordBackupSwitch(root, record) {
  atomicJson(switchFile(root, record.issue), record);
  const fd = fs.openSync(path.join(root, "ledger.md"), "a", 0o600);
  try { fs.writeSync(fd, `- ${new Date().toISOString()} BACKUP_SWITCH ${record.issue} a${record.previousAttempt} -> a${record.attempt}: ${JSON.stringify(record)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDir(root);
}

export function configuredBackup(config) {
  const settings = config.orchestration ?? {};
  if (!Object.hasOwn(settings, "backupTransport")) return null;
  if (!transports.includes(settings.backupTransport)) throw new Error("orchestration.backupTransport must be codex-cli or claude-cli");
  const primary = settings.transport ?? "codex-cli";
  if (!transports.includes(primary)) throw new Error("orchestration.backupTransport requires a managed CLI primary transport");
  if (primary === settings.backupTransport) throw new Error("orchestration.backupTransport must differ from the primary transport");
  return settings.backupTransport;
}

// Keep stopped-attempt identity after ordinary registry retirement. Process
// groups also retain visibility of commands orphaned by a stopped wrapper.
export function recordAttempt(root, entry) {
  const file = recordFile(root, entry.issue, entry.attempt);
  if (!entry.attemptMarker && !fs.existsSync(file) && (!entry.modelRoutes?.base || !configuredBackup(baseModelConfig(entry.worktree, entry.modelRoutes.base)))) return;
  const previous = fs.existsSync(file) ? readJson(file) : {};
  if (previous.entry?.attemptMarker && previous.entry.attemptMarker !== entry.attemptMarker)
    throw new Error("attempt marker changed; reconcile the protected attempt before launch or resume");
  // Freeze legacy observations before replacing the entry with a later resume.
  // An unavailable original bound stays unavailable instead of advancing.
  const observations = processObservations(previous), processes = observations.writers;
  if (entry.pid && !processes.some(row => row.pid === entry.pid &&
    (Number.isFinite(row.procStartEpoch) || Number.isFinite(entry.procStartEpoch)
      ? row.procStartEpoch === entry.procStartEpoch : row.procStart === entry.procStart)))
    processes.push({ pid: entry.pid, procStart: entry.procStart, procStartEpoch: entry.procStartEpoch,
      observedByEpoch: Date.parse(entry.last_activity_at), processGroup: entry.processGroup ?? entry.pid });
  const retained = previous.retirement ? { retirement: { ...previous.retirement, processes: observations.captured } } : {};
  atomicJson(file, { ...previous, ...retained, entry, processes });
}

// Freeze process creation before retaining the tree used by ordinary forced
// termination. Keep its identities outside worker grants across resumes.
export async function stopBackupProcessTree(root, issue) {
  if (!path.isAbsolute(root ?? "") || !/^[A-Z][A-Z0-9]*-\d+$/.test(issue)) throw new Error("absolute root and issue required");
  return withLock(path.join(root, "launch.lock"), async () => {
    const entry = readJson(path.join(root, "workers.json"))[issue];
    if (!entry?.pid || !entry.procStart) throw new Error("capture the primary process tree before stopping or retiring it");
    recordAttempt(root, entry);
    const file = recordFile(root, issue, entry.attempt), previous = readJson(file);
    if (previous.retirement?.pending === true) throw new Error("incomplete prior stop; reconcile the retained process observations before retrying");
    const table = () => processTable().filter(row => !row.state.startsWith("Z"));
    let live = table();
    const retained = previous.retirement ?? { capturedWriters: [], processes: [] };
    if (!live.some(row => row.pid === entry.pid && row.procStart === entry.procStart && row.group === entry.pid)) {
      const observations = processObservations(previous);
      const processes = [...observations.writers, ...observations.captured];
      const survivors = live.filter(row => capturedLive(row, processes, live));
      if (survivors.length)
        throw new Error(`previous worker or descendants still live; reconcile before recording a stopped tree: ${survivors.map(row => row.pid).join(", ")}`);
      for (const group of new Set(processes.map(row => row.processGroup))) {
        if (groupReused(group, processes, live)) continue;
        try { process.kill(-group, 0); }
        catch (error) { if (error.code === "ESRCH") continue; throw error; }
        throw new Error(`previous worker process group still live; reconcile before recording a stopped tree: ${group}`);
      }
      const processOwnership = requireProcessOwnership(root, previous, live);
      const retirement = { capturedAt: new Date().toISOString(), capturedWriters: previous.processes, processes,
        quiesced: true, stopRequested: true, pending: false, proof: "already-stopped", processOwnership };
      atomicJson(file, { ...previous, retirement });
      return { file, retirement };
    }
    const observer = live.find(row => row.pid === process.pid);
    if (!observer) throw new Error("process observer identity unavailable; reconcile before stopping");
    const writers = [];
    for (const writer of previous.processes) {
      const row = live.find(row => row.pid === writer.pid && row.procStart === writer.procStart);
      if (row && row.group === writer.processGroup) writers.push(row);
      else if (!retained.quiesced || !retained.stopRequested || !retained.capturedWriters.some(old => old.pid === writer.pid && old.procStart === writer.procStart))
        throw new Error("previous process incarnation has no retained tree capture; reconcile before switching");
    }
    const groups = new Set(), seen = new Map();
    const select = rows => {
      const selected = new Set(writers.map(row => row.pid));
      for (const old of retained.processes) if (rows.some(row => row.pid === old.pid && row.procStart === old.procStart)) selected.add(old.pid);
      let added;
      do {
        added = false;
        for (const row of rows) if (!selected.has(row.pid) && (selected.has(row.ppid) || groups.has(row.group))) {
          selected.add(row.pid); added = true;
        }
      } while (added);
      return rows.filter(row => selected.has(row.pid));
    };
    const freeze = rows => {
      let added = false;
      for (const row of rows) {
        if (row.group === observer.group || row.pid === process.pid) throw new Error("stop must run outside the worker process tree");
        if (groups.has(row.group)) continue;
        if (!rows.some(leader => leader.pid === row.group) && !retained.processes.some(old => old.processGroup === row.group && rows.some(current => current.pid === old.pid && current.procStart === old.procStart)))
          throw new Error("descendant process group ownership unknown; reconcile before stopping");
        process.kill(-row.group, "SIGSTOP"); groups.add(row.group); added = true;
      }
      return added;
    };
    for (const row of select(live)) seen.set(row.pid, row);
    atomicJson(file, { ...previous, retirement: { ...retained, quiesced: false, stopRequested: false, pending: true,
      observed: [...seen.values()], startedAt: new Date().toISOString() } });
    freeze(writers);
    const deadline = Date.now() + 5000;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 25));
      live = table();
      if ([...seen.values()].some(old => !live.some(row => row.pid === old.pid && row.procStart === old.procStart)))
        throw new Error("process disappeared before tree quiescence; reconcile missing descendants");
      const selected = select(live);
      for (const row of selected) seen.set(row.pid, row);
      const added = freeze(selected);
      if (!added && [...seen.values()].every(row => row.state.startsWith("T"))) break;
      if (Date.now() >= deadline) throw new Error("process tree quiescence unverified; reconcile the retained stopped processes");
    }
    const captured = [...seen.values()].map(row => ({ pid: row.pid, ppid: row.ppid, procStart: row.procStart, procStartEpoch: row.procStartEpoch, processGroup: row.group }));
    const processes = [...retained.processes];
    for (const row of captured) if (!processes.some(old => old.pid === row.pid && old.procStart === row.procStart)) processes.push(row);
    const retirement = { capturedAt: new Date().toISOString(), capturedWriters: previous.processes, processes, quiesced: true, stopRequested: false, pending: true };
    atomicJson(file, { ...previous, retirement });
    const depth = row => {
      if (writers.some(writer => writer.pid === row.pid)) return 0;
      let count = 1, parent = seen.get(row.ppid);
      const visited = new Set([row.pid]);
      while (parent && !visited.has(parent.pid)) { visited.add(parent.pid); count++; parent = seen.get(parent.ppid); }
      return count;
    };
    const kill = pid => { try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } };
    for (const row of [...seen.values()].sort((a, b) => depth(b) - depth(a))) kill(row.pid);
    retirement.stopRequested = true;
    retirement.pending = false;
    atomicJson(file, { ...previous, retirement });
    return { file, retirement };
  });
}

function previousAttempt(request, input) {
  if (input.issue !== request.issue || !Number.isSafeInteger(input.previousAttempt) || input.previousAttempt < 1)
    throw new Error("backup switch requires matching issue and previousAttempt");
  const file = recordFile(request.root, request.issue, input.previousAttempt);
  if (!fs.existsSync(file)) throw new Error("previous attempt record missing; reconcile the retained attempt before switching");
  const previous = readJson(file), entry = previous.entry;
  if (entry?.issue !== request.issue || entry.attempt !== input.previousAttempt || entry.stage !== "mono-deliver" ||
      entry.worktree !== request.worktree || entry.branch !== request.branch || !entry.pins)
    throw new Error("previous attempt identity/worktree/pins mismatch");
  const pins = effectivePins(entry), config = baseModelConfig(entry.worktree, pins.base);
  if (entry.modelRoutes?.base !== pins.base || entry.modelRoutes.configDigest !== digest(config) ||
      canonical(entry.modelRoutes) !== canonical(pins.modelRoutes)) throw new Error("previous attempt model pins mismatch");
  if (entry.transport !== (config.orchestration?.transport ?? "codex-cli"))
    throw new Error("previous attempt must use its BASE primary transport");
  return { ...previous, pins, config };
}

const routeIdentity = ({ fingerprint, ...route }) => route;
export function resolveBackupSwitch(request) {
  if (request.backupSwitch === undefined) return null;
  const input = request.backupSwitch;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("backup switch record must be an object");
  if (!reasons.includes(input.reason)) throw new Error("backup switch reason must be subscription-exhausted or provider-refusal-after-recovery");
  if (input.training !== undefined && typeof input.training !== "boolean") throw new Error("backup switch training must be boolean");
  const previous = previousAttempt(request, input);
  const backup = configuredBackup(previous.config);
  if (!backup) throw new Error("backup transport not configured on previous BASE");
  if (input.backupTransport !== backup) throw new Error("backup switch transport differs from previous BASE mandate");
  const nextConfig = baseModelConfig(request.worktree, request.base);
  if (configuredBackup(nextConfig) !== backup || (nextConfig.orchestration?.transport ?? "codex-cli") !== previous.entry.transport)
    throw new Error("backup transport/primary changed on new BASE");
  const oldReviewer = resolveRole("autoreview", previous.config, { packRoot: previous.entry.packRoot });
  const newReviewer = resolveRole("autoreview", nextConfig, { packRoot: request.packRoot });
  if (canonical(oldReviewer) !== canonical(previous.entry.modelRoutes.roles.autoreview) ||
      canonical(routeIdentity(oldReviewer)) !== canonical(routeIdentity(newReviewer))) throw new Error("reviewer route changed between attempt bases");
  if (!path.isAbsolute(input.evidenceFile ?? "") || !fs.existsSync(input.evidenceFile)) throw new Error("backup switch requires an evidence file");
  const evidence = fs.readFileSync(input.evidenceFile), excerpt = evidence.toString("utf8").trim();
  const journal = path.join(request.root, "logs", `${request.issue}-mono-deliver-a${input.previousAttempt}.jsonl`);
  const journalBytes = previous.entry.log === journal && excerpt ? fs.readFileSync(journal) : null;
  if (!journalBytes?.toString("utf8").includes(excerpt))
    throw new Error("backup switch evidence must be a nonempty excerpt of the previous attempt journal");
  if (input.reason === "provider-refusal-after-recovery") {
    const recovery = previous.entry.last_resume;
    if (!recovery || recovery.thread_id !== previous.entry.thread_id || !Number.isSafeInteger(recovery.logOffset) ||
        !journalBytes.subarray(recovery.logOffset).toString("utf8").includes(excerpt))
      throw new Error("provider refusal requires recorded recovery and evidence after recovery on the same worker");
  }
  const record = { issue: request.issue, previousAttempt: input.previousAttempt, attempt: input.previousAttempt + 1,
    previousTransport: previous.entry.transport, backupTransport: backup, previousBase: previous.pins.base, base: request.base,
    reason: input.reason, evidenceFile: resolvedLocation(input.evidenceFile), evidenceDigest: sha256(evidence), journal,
    training: input.training ?? false };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(record, key) || canonical(key === "evidenceFile" ? resolvedLocation(value) : value) !== canonical(record[key]))
      throw new Error(`backup switch record mismatch: ${key}`);
  }
  return record;
}

export function validateBackupLaunch(request, used, roots) {
  if (fs.existsSync(switchFile(request.root, request.issue))) throw new Error("issue already switched; automatic return or a second switch is forbidden");
  const record = resolveBackupSwitch(request);
  if (!record) return null;
  if (used !== record.previousAttempt) throw new Error("backup switch must follow the latest counted attempt");
  const previous = previousAttempt(request, record);
  const processes = previous.processes;
  if (!Array.isArray(processes) || !processes.length || processes.some(row => !Number.isSafeInteger(row.pid) || row.pid <= 0 ||
      !row.procStart || row.processGroup !== row.pid)) throw new Error("previous worker process identity incomplete; reconcile before switching");
  const live = processTable().filter(row => !row.state.startsWith("Z"));
  const observations = processObservations(previous);
  const survivors = live.filter(row => capturedLive(row, observations.writers, live));
  if (survivors.length)
    throw new Error(`previous worker or descendants still live; backup switch refused: ${survivors.map(row => row.pid).join(", ")}`);
  const capture = previous.retirement;
  if (!capture?.capturedAt || capture.quiesced !== true || capture.stopRequested !== true || capture.pending !== false || !Array.isArray(capture.processes) || !Array.isArray(capture.capturedWriters) ||
      processes.some(writer => !capture.capturedWriters.some(old => old.pid === writer.pid && old.procStart === writer.procStart)) ||
      capture.processes.some(row => !Number.isSafeInteger(row.pid) || row.pid <= 0 || !row.procStart || !Number.isSafeInteger(row.processGroup) || row.processGroup <= 0) ||
      processes.some(writer => !capture.processes.some(old => old.pid === writer.pid && old.procStart === writer.procStart)))
    throw new Error("previous process tree capture missing or incomplete; reconcile before switching");
  const descendants = live.filter(row => capturedLive(row, observations.captured, live));
  if (descendants.length)
    throw new Error(`previous worker or descendants still live; backup switch refused: ${descendants.map(row => row.pid).join(", ")}`);
  for (const group of new Set([...observations.writers, ...observations.captured].map(row => row.processGroup))) {
    if (groupReused(group, [...observations.writers, ...observations.captured], live)) continue;
    try { process.kill(-group, 0); }
    catch (error) { if (error.code === "ESRCH") continue; throw error; }
    throw new Error(`previous worker process group still live; backup switch refused: ${group}`);
  }
  const ownership = requireProcessOwnership(request.root, previous, live);
  if (roots.some(root => !previous.entry.workerWritableRoots?.some(old => root === resolvedLocation(old) || root.startsWith(resolvedLocation(old) + path.sep))))
    throw new Error("backup switch must not expand previous worker write grants");
  if (!request.pins || canonical(effectivePins({ ...request, pinsVersion: 0 }).backupSwitch) !== canonical(record))
    throw new Error("backup switch record missing or changed in new attempt pins");
  if (roots.some(root => record.evidenceFile === root || record.evidenceFile.startsWith(root + path.sep)))
    throw new Error("backup switch evidence must remain outside worker write grants");
  return { record, ownership };
}

if (isMain(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2), args = flags(rest);
    if (command !== "stop") throw new Error("Usage: backup-switch.mjs stop --root DIR --issue KEY (quiesce, capture and force-stop before registry retirement)");
    console.log(JSON.stringify(await stopBackupProcessTree(args.root, args.issue)));
  } catch (error) { console.error(`backup-switch: ${error.message}`); process.exitCode = 1; }
}
