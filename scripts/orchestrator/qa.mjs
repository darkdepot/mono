#!/usr/bin/env node
import { readJson, isMain } from '../runtime.mjs';
import { commandFlags, allowedFlags } from './command-state.mjs';
import { qaRecipeSource, qaDeliveryState, requireQaPassed } from '../qa-gate.mjs';
import { validateShipCertificate } from '../ship-certificate.mjs';

// Read-only deploy preparation; the caller supplies the freshly read PR head.
export function prepareQa({ root, config, issue, head, shipReport }) {
  if (!qaRecipeSource(config)) return qaDeliveryState({ config });
  const report = readJson(shipReport);
  if (report.issue !== issue || report.head !== head) throw new Error('QA: current issue/PR head differs from ship');
  validateShipCertificate(report);
  return requireQaPassed({ root, config, issue, head, shipCertificate: report.certificate });
}

if (isMain(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2), args = commandFlags(argv);
    if (command !== 'prepare') throw new Error('expected prepare');
    allowedFlags(args, ['root', 'config', 'issue', 'head', 'ship-report']);
    const qa = prepareQa({ ...args, config: readJson(args.config), shipReport: args['ship-report'] });
    console.log(JSON.stringify(qa));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
