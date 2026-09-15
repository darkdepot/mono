#!/usr/bin/env node
import { spawnWorker } from "./launch.mjs";
import { flags, readJson } from "../runtime.mjs";
try {
  const args = flags(process.argv.slice(2));
  if (args.help) console.log("Usage: spawn.mjs --request <json>\nRequest: {root,issue,worktree,branch,base,lock,packVersion,sourceCommit,surfaceRevision,role,modelReason,dispatchFile,evidenceRoot,workerWritableRoots:[],writable_roots:[],gates:[],lifecycle_moves:[],config,product_name}\nUse absolute paths; effective grants must match the complete dispatch workerWritableRoots and exclude evidenceRoot. role is worker-default or worker-complex; complex requires modelReason. lifecycle_moves lists the exact startup moves; nonempty requires gates. config supplies orchestration.delivery.attemptCap (3 default). One delivery launches with network; phase rules still restrict its use. Runtime performs start gate and pre-registration before spawning. Retain attempts.json after retirement.");
  else console.log(JSON.stringify(await spawnWorker(readJson(args.request))));
} catch (error) { console.error(`spawn: ${error.message}`); process.exitCode = 1; }
