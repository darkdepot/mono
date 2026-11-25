#!/usr/bin/env node
import { readJson, isMain } from "../runtime.mjs";
import { commandFlags, allowedFlags, attemptCapState, raiseAttemptCap, ATTEMPT_CAP_CEILING } from "./command-state.mjs";

// MONO-490: the only way to give one task more attempts than orchestration.delivery.attemptCap.
const usage = "Usage: attempt-cap.mjs raise --root DIR --config FILE --issue KEY --reason TEXT [--owner-words TEXT] | show --root DIR --config FILE --issue KEY\n" +
  "raise records one more attempt for one Issue in attempt-cap-raises.json beside attempts.json (host-only, outside every worker grant)," +
  ` only while its cap is exhausted and with a non-empty reason; a cap above ${ATTEMPT_CAP_CEILING} also needs the owner's verbatim words in --owner-words.` +
  " Anything else is refused and nothing is written. The ceiling is not configurable; attemptCap in the config stays the base for every task." +
  " Pass the same --config as dispatch. show prints used attempts, base cap, recorded raises and the effective cap.";

if (isMain(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2), args = commandFlags(argv);
    if (command === "--help" || args.help) console.log(usage);
    else if (command === "raise" || command === "show") {
      allowedFlags(args, command === "raise" ? ["root", "config", "issue", "reason", "owner-words"] : ["root", "config", "issue"]);
      for (const key of ["root", "config", "issue"]) if (!args[key]) throw new Error(`${usage}\nmissing --${key}`);
      const config = readJson(args.config);
      console.log(JSON.stringify(command === "raise"
        ? raiseAttemptCap(args.root, args.issue, config, { reason: args.reason, ownerWords: args["owner-words"] })
        : attemptCapState(args.root, args.issue, config)));
    } else throw new Error(usage);
  } catch (error) { console.error(`attempt-cap: ${error.message}`); process.exitCode = 1; }
}
