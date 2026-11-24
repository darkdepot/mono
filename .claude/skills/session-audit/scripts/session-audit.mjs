#!/usr/bin/env node
// Entry of the session-audit project skill:
//   node .claude/skills/session-audit/scripts/session-audit.mjs <command> [options]
// Session files and the pack are only read; data goes only to the data root.

import process from "node:process";

import { AuditError } from "./lib.mjs";
import { collect, cost, extract } from "./commands.mjs";

const USAGE = `Usage:
  session-audit.mjs collect --session <calling session id> [--take-over] [--now <ISO time>]
  session-audit.mjs extract <session id> --session <calling session id> [--from <event|ISO>] [--to <event|ISO>]
  session-audit.mjs cost (--pass <pass uuid> | <session id>...)

Data root: SESSION_AUDIT_HOME, else <MONO_WORKFLOW_STATE_ROOT or ~/.mono-agent-workflow>/orchestrator/mono-agent-workflow/session-audit.
--take-over only after the owner said «забери проход».`;

function parse(argv) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new AuditError(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === "--session") args.session = value();
    else if (arg === "--now") args.now = value();
    else if (arg === "--from") args.from = value();
    else if (arg === "--to") args.to = value();
    else if (arg === "--pass") args.pass = value();
    else if (arg === "--take-over") args.takeOver = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new AuditError(`unknown option ${arg}`);
    else args.positional.push(arg);
  }
  return args;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parse(rest);
  if (!command || args.help || command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  let result;
  if (command === "collect") {
    result = collect({ sessionId: args.session || process.env.CLAUDE_SESSION_ID, now: args.now, takeOver: args.takeOver });
  } else if (command === "extract") {
    result = extract({ sessionId: args.session || process.env.CLAUDE_SESSION_ID, target: args.positional[0], from: args.from, to: args.to });
  } else if (command === "cost") {
    result = cost({ passUuid: args.pass, ids: args.positional });
  } else {
    throw new AuditError(`unknown command ${command}\n${USAGE}`);
  }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof AuditError) {
    console.error(JSON.stringify({ error: error.message, ...error.details }, null, 2));
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
