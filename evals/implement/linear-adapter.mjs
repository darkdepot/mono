#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This adapter is copied into each teaching repo; it never calls a service.
const repo = path.dirname(fileURLToPath(import.meta.url));
const context = JSON.parse(fs.readFileSync(path.join(repo, 'fixture-context.json')));
const file = path.join(repo, '.orchestrator/linear-state.json');
let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { issue: context.issue, starts: 0 };
const [command, key = 'TRAIN-1'] = process.argv.slice(2);
if (!['read', 'start'].includes(command) || key !== state.issue.key) throw new Error('Use read|start TRAIN-1 only');
if (command === 'start' && state.issue.status !== 'In Progress') {
  state = { issue: { ...state.issue, status: 'In Progress' }, starts: state.starts + 1 };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}
console.log(JSON.stringify({ ...state, fixture: true, live: false }));
