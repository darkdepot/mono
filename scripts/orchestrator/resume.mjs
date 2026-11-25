#!/usr/bin/env node
import { resumeWorker } from "./launch.mjs";
import { flags, readJson } from "../runtime.mjs";
try {
  const args = flags(process.argv.slice(2));
  if (args.help) console.log("Usage: resume.mjs --request <json>\nRequest: {root,issue,resumeFile,taskChange?|reviewRetry?} with absolute paths. Resumes the same session with the launch model, effort and grants. A task change: write the «Изменение задачи» comment on the Issue, put its words and its link in the resume file and pass the link as taskChange; the review round reads that text with the Issue (reviewers cannot open Linear). A review retry: when the gate parked on «not-reviewed twice in a row on this head (environment: ...)», restore the environment (host awake, load down, network, CLI login) and pass reviewRetry: true without taskChange; it is recorded beside the launch pins, lets the next collection on the same head run a round, and changes neither the contract nor the round count; a «(review)» streak still needs a task change. A risk, critical or grant change is a new attempt on the same branch. Resume also starts a stopped collector. A live pid, halt or incompatible surfaceRevision refuses without launching; incompatible surfaces require a new attempt.");
  else console.log(JSON.stringify(await resumeWorker(readJson(args.request))));
} catch (error) { console.error(`resume: ${error.message}`); process.exitCode = 1; }
