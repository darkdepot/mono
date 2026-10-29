#!/usr/bin/env node
import { readJson, isMain } from '../runtime.mjs';
import { commandFlags, allowedFlags, registryEntry, confirmedShip, effectivePins } from './command-state.mjs';
import { requireQaPassed } from '../qa-gate.mjs';

// Read-only deploy preparation; the caller supplies the freshly read PR head.
export function prepareQa({ root, config, issue, attempt, head }) {
  const entry = registryEntry(root, issue, Number(attempt));
  effectivePins(entry);
  const { report } = confirmedShip(root, entry);
  if (report.head !== head) throw new Error('QA: current PR head differs from ship');
  return requireQaPassed({ root, config, issue, head, shipCertificate: report.certificate });
}

if (isMain(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2), args = commandFlags(argv);
    if (command !== 'prepare') throw new Error('expected prepare');
    allowedFlags(args, ['root', 'config', 'issue', 'attempt', 'head']);
    const qa = prepareQa({ ...args, config: readJson(args.config) });
    console.log(JSON.stringify(qa));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
