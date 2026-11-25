#!/usr/bin/env node
// Entry of the session-audit project skill:
//   node .claude/skills/session-audit/scripts/session-audit.mjs <command> [options]
// Session files and the pack are only read; data goes only to the data root.

import process from "node:process";

import { AuditError } from "./lib.mjs";
import { collect, cost, extract } from "./commands.mjs";
import { commit, lastSummary, opCommand, plan, summary } from "./publish.mjs";
import { candidates, check, confirm, opened, register, select, signals } from "./review.mjs";

const USAGE = `Usage:
  session-audit.mjs collect --session <calling session id> [--take-over] [--now <ISO time>]
  session-audit.mjs extract <session id> --session <calling session id> [--from <event|ISO>] [--to <event|ISO>]
  session-audit.mjs cost (--pass <pass uuid> | <session id>...)
  session-audit.mjs signals --session <id> [--extra <file>]
  session-audit.mjs opened [<signal id | sample session id>...] --session <id>
  session-audit.mjs check <file> --session <id>
  session-audit.mjs confirm <finding> (--yes | --no) --session <id>
  session-audit.mjs candidates --session <id> [--stage <s>] [--kind <k>] [--rule <text>]
  session-audit.mjs register --session <id> [--linear <file>]
  session-audit.mjs select --session <id>
  session-audit.mjs plan --session <id>
  session-audit.mjs op next --session <id>
  session-audit.mjs op (sent | lost) <key> --session <id>
  session-audit.mjs op confirm <key> --response <file> --session <id>
  session-audit.mjs op reconcile <key> --listing <file> --session <id>
  session-audit.mjs op resume <key> --owner-said --session <id>
  session-audit.mjs commit --session <id>
  session-audit.mjs summary [--session <id>]
Every command of a pass also takes --now <ISO time>. Files given to a pass
command lie inside runs/<pass uuid>/ of the data root.

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
    else if (arg === "--extra") args.extra = value();
    else if (arg === "--linear") args.linear = value();
    else if (arg === "--response") args.response = value();
    else if (arg === "--listing") args.listing = value();
    else if (arg === "--stage") args.stage = value();
    else if (arg === "--kind") args.kind = value();
    else if (arg === "--rule") args.rule = value();
    else if (arg === "--yes") args.answer = "yes";
    else if (arg === "--no") args.answer = "no";
    else if (arg === "--owner-said") args.ownerSaid = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new AuditError(`unknown option ${arg}`);
    else args.positional.push(arg);
  }
  return args;
}

const PASS_COMMANDS = {
  signals: ({ sessionId, now, args }) => signals({ sessionId, now, extra: args.extra }),
  opened: ({ sessionId, now, args }) => opened({ sessionId, now, ids: args.positional }),
  check: ({ sessionId, now, args }) => check({ sessionId, now, file: args.positional[0] }),
  confirm: ({ sessionId, now, args }) => confirm({ sessionId, now, target: args.positional[0], answer: args.answer }),
  candidates: ({ sessionId, now, args }) => candidates({ sessionId, now, stage: args.stage, kind: args.kind, rule: args.rule }),
  register: ({ sessionId, now, args }) => register({ sessionId, now, linear: args.linear }),
  select: ({ sessionId, now }) => select({ sessionId, now }),
  plan: ({ sessionId, now }) => plan({ sessionId, now }),
  op: ({ sessionId, now, args }) => opCommand({ sessionId, now, action: args.positional[0], key: args.positional[1], response: args.response, listing: args.listing, ownerSaid: args.ownerSaid }),
  commit: ({ sessionId, now }) => commit({ sessionId, now }),
  summary: ({ sessionId, now }) => summary({ sessionId, now }),
};

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
  } else if (PASS_COMMANDS[command]) {
    const sessionId = args.session || process.env.CLAUDE_SESSION_ID;
    if (command === "summary" && !args.session) result = lastSummary({});
    else result = PASS_COMMANDS[command]({ sessionId, now: args.now, args });
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
