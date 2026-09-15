#!/usr/bin/env node
import { resumeWorker } from "./launch.mjs";
import { flags, readJson } from "../runtime.mjs";
try {
  const args = flags(process.argv.slice(2));
  if (args.help) console.log("Usage: resume.mjs --request <json>\nRequest: {root,issue,resumeFile,extraWritable:[],workerWritableRoots:[],network_access} with absolute paths. Preserve launch model/effort; extraWritable adds authorized sandbox roots and optional boolean network_access overrides the launch grant. Adding grants requires the amended complete workerWritableRoots pin; evidenceRoot overlap is refused, effective grants are persisted. Resume file carries post-move read-back or capsule recovery input. A live pid, halt or changed identity refuses without launching.");
  else console.log(JSON.stringify(await resumeWorker(readJson(args.request))));
} catch (error) { console.error(`resume: ${error.message}`); process.exitCode = 1; }
