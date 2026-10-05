import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A plugin is the repository tree. Copy only pack files into an isolated fixture.
export function copyPluginFixture(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const name of ['scripts', 'skills', 'references', 'templates', 'AGENTS.md', 'README.md', 'VERSION'])
    fs.cpSync(path.join(source, name), path.join(root, name), { recursive: true });
}
