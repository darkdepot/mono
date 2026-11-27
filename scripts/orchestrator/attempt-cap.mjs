#!/usr/bin/env node
import { isMain } from "../runtime.mjs";
import { commandFlags, allowedFlags, attemptCapState, ATTEMPT_LIMIT } from "./command-state.mjs";

// MONO-505: a task has at most ATTEMPT_LIMIT counted attempts and there is no raise; show is for visibility.
const usage = "Usage: attempt-cap.mjs show --root DIR --issue KEY\n" +
  `show prints used, counted and uncounted attempts and the fixed limit of ${ATTEMPT_LIMIT} counted attempts per task.`;

if (isMain(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2), args = commandFlags(argv);
    if (command === "--help" || args.help) console.log(usage);
    else if (command === "show") {
      allowedFlags(args, ["root", "issue"]);
      for (const key of ["root", "issue"]) if (!args[key]) throw new Error(`${usage}\nmissing --${key}`);
      console.log(JSON.stringify(attemptCapState(args.root, args.issue)));
    } else throw new Error(usage);
  } catch (error) { console.error(`attempt-cap: ${error.message}`); process.exitCode = 1; }
}
