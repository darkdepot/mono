import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomicJson, readJson } from '../runtime.mjs';
import { section } from './snapshot.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function copyDesignSnapshot(source, target, issue, body, config) {
  const readFirst = section(body, 'Прочитать сначала');
  const manifest = path.join(source, 'design.json');
  if (!fs.existsSync(manifest)) {
    if (readFirst.includes('Дизайн: запись mono-design ')) throw new Error('UI task design snapshot is missing');
    return null;
  }
  const input = readJson(manifest);
  if (input.issue !== issue || typeof input.recordId !== 'string' || !input.recordId ||
      !/^[a-f0-9]{64}$/.test(input.images ?? '') || typeof input.dump !== 'string' || !input.dump ||
      !readFirst.includes(`Дизайн: запись mono-design ${input.recordId},`) || !readFirst.includes(input.images))
    throw new Error('UI task does not bind the supplied design snapshot');
  const dump = path.resolve(source, input.dump);
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../idea-gate.mjs', import.meta.url)),
    'design', '--mode', 'fresh', '--dump', dump, '--config', config], { encoding: 'utf8' });
  const checked = JSON.parse(output.trim().split('\n').at(-1));
  if (!checked.ok || checked.code !== 'pass' || checked.recordId !== input.recordId)
    throw new Error('UI task design record is not the current approved record');
  const names = fs.readdirSync(checked.directory).filter(name => name.endsWith('.png'))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const prepared = fs.mkdtempSync(path.join(target, 'design-'));
  try {
    for (const name of names) fs.copyFileSync(path.join(checked.directory, name), path.join(prepared, name));
    const images = hash(names.map(name => `${hash(fs.readFileSync(path.join(prepared, name)))}  ${name}\n`).join(''));
    if (images !== input.images) throw new Error('UI task approved images changed or do not match its version');
    const result = { issue, recordId: checked.recordId, projectId: checked.projectId, images,
      dump: 'design-input', directory: 'design', files: names };
    const savedDump = path.join(target, result.dump);
    fs.mkdirSync(savedDump);
    for (const name of ['project.json', 'prd.json', ...fs.readdirSync(dump)
      .filter(name => /^comments-[1-9][0-9]*(?:\.request)?\.json$/.test(name))])
      fs.copyFileSync(path.join(dump, name), path.join(savedDump, name));
    fs.renameSync(prepared, path.join(target, 'design'));
    atomicJson(path.join(target, 'design.json'), result);
    return result;
  } finally { fs.rmSync(prepared, { recursive: true, force: true }); }
}
