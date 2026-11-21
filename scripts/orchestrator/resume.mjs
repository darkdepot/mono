#!/usr/bin/env node
import { resumeWorker } from "./launch.mjs";
import { flags, readJson } from "../runtime.mjs";
try {
  const args = flags(process.argv.slice(2));
  if (args.help) console.log("Usage: resume.mjs --request <json>\nRequest: {root,issue,resumeFile,taskChange?} with absolute paths. Resumes the same session with the launch model, effort and grants. A task change: write the «Изменение задачи» comment on the Issue, quote its link in the resume file and pass it as taskChange; the review round then reads the change with the Issue. A risk, critical or grant change is a new attempt on the same branch. Resume also starts a stopped collector. A live pid, halt or incompatible surfaceRevision refuses without launching; incompatible surfaces require a new attempt.");
  else console.log(JSON.stringify(await resumeWorker(readJson(args.request))));
} catch (error) { console.error(`resume: ${error.message}`); process.exitCode = 1; }
