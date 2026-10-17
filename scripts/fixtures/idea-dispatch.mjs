import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dispatchIdea, ideaBinding } from '../orchestrator/command-state.mjs';

const source = fileURLToPath(new URL('./idea-gate/project/', import.meta.url));
export const ideaProjectId = '59c079b6-fc26-40a6-ba19-9467674fa637';
export const hash = value => createHash('sha256').update(value).digest('hex');
export function ideaDispatchFixture(directory, issueKey = 'MONO-999', change = () => {}) {
  const json = name => JSON.parse(fs.readFileSync(path.join(source, name), 'utf8'));
  const input = { project: json('idea/project.json'), records: json('idea/idea-records.json'),
    approval: json('approval.json'), context: { ...json('issue-context.json'), issueKey },
    body: 'approval_status=approved\nApproved package and start; current project Delivery.' };
  change(input);
  input.approval.bodySha256 = hash(input.body);
  const comment = input.records.comments.find(value => value.id === input.approval.commentId);
  if (comment) Object.assign(comment, { createdAt: input.approval.createdAt, body: input.body });
  fs.mkdirSync(path.join(directory, 'idea'), { recursive: true });
  for (const [name, value] of Object.entries({ 'idea/project.json': input.project, 'idea/idea-records.json': input.records,
    'approval.json': input.approval, 'issue-context.json': input.context }))
    fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'approval.md'), input.body);
  return input;
}

export function ideaAttemptFixture(directory, issueKey = 'MONO-999') {
  const input = ideaDispatchFixture(directory, issueKey);
  const config = JSON.parse(fs.readFileSync(path.join(source, 'config.json'), 'utf8'));
  const result = dispatchIdea(directory, config, issueKey);
  fs.writeFileSync(path.join(directory, 'idea/gate-config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(directory, 'idea/selected-record.json'),
    JSON.stringify(input.records.comments.find(comment => comment.id === result.recordId) ?? null));
  return ideaBinding(directory, result);
}
