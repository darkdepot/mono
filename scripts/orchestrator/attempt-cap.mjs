#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readJson, isMain } from "../runtime.mjs";
import { commandFlags, allowedFlags, attemptCapBase, attemptCapState, raiseAttemptCap, ATTEMPT_CAP_CEILING } from "./command-state.mjs";

// MONO-490: the only way to give one task more attempts than the committed orchestration.delivery.attemptCap.
const usage = "Usage: attempt-cap.mjs raise --root DIR --config FILE --issue KEY --reason TEXT [--owner-words TEXT] | show --root DIR --config FILE --issue KEY\n" +
  "raise records one more attempt for one Issue in attempt-cap-raises.json beside attempts.json (host-only, outside every worker grant)," +
  ` only while its cap is exhausted and with a non-empty reason; a cap above ${ATTEMPT_CAP_CEILING} also needs the owner's verbatim words in --owner-words.` +
  " Anything else is refused and nothing is written. The base cap is attemptCap in the product config committed at BASE" +
  " (origin/main of the repo that holds --config, as dispatch last fetched it; pack default 3), at most the ceiling of " + ATTEMPT_CAP_CEILING +
  "; a different attemptCap in the --config file is ignored with a warning. Pass the same --config as dispatch." +
  " show prints used attempts, base cap, recorded raises and the effective cap.";

// Same product repo and BASE as dispatch: the repo holds .agents/<config>; BASE is its origin/main.
function capSource(config) {
  const worktree = path.dirname(path.dirname(path.resolve(config)));
  const base = execFileSync("git", ["rev-parse", "--verify", "origin/main^{commit}"], { cwd: worktree, encoding: "utf8" }).trim();
  return { worktree, base, config: readJson(config) };
}

if (isMain(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2), args = commandFlags(argv);
    if (command === "--help" || args.help) console.log(usage);
    else if (command === "raise" || command === "show") {
      allowedFlags(args, command === "raise" ? ["root", "config", "issue", "reason", "owner-words"] : ["root", "config", "issue"]);
      for (const key of ["root", "config", "issue"]) if (!args[key]) throw new Error(`${usage}\nmissing --${key}`);
      const source = capSource(args.config);
      for (const warning of attemptCapBase(source).warnings) console.error(`attempt-cap: ${warning}`);
      console.log(JSON.stringify(command === "raise"
        ? raiseAttemptCap(args.root, args.issue, source, { reason: args.reason, ownerWords: args["owner-words"] })
        : attemptCapState(args.root, args.issue, source)));
    } else throw new Error(usage);
  } catch (error) { console.error(`attempt-cap: ${error.message}`); process.exitCode = 1; }
}
