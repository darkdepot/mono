#!/usr/bin/env node
// Operational copy lives in <orchestrator-root>/hooks/; names are exact argv values.
import fs from 'node:fs';

function deny(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}
const allowed = process.argv.slice(2);
if (!allowed.length || allowed.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) {
  deny('stage helper allowlist is missing or invalid');
}
let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); }
catch { deny('stage helper input is not valid JSON'); }
const type = input?.tool_input?.subagent_type;
if (typeof type !== 'string' || !allowed.includes(type)) {
  deny(`helper type '${typeof type === 'string' ? type : 'missing'}' is not allowed for this stage`);
}
