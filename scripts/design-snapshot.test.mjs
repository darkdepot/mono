import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { copyDesignSnapshot } from './orchestrator/design-snapshot.mjs';

const project = '11111111-1111-1111-1111-111111111111';
const recordId = '44444444-4444-4444-4444-444444444444';
const images = '0e66fc587d5356f31cdfea5131276c0d91a3fb207004689e65920d7c964e5b73';
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-design-snapshot-'));
  const previousHome = process.env.HOME;
  process.env.HOME = root;
  const source = path.join(root, 'source'), target = path.join(root, 'snapshot');
  const repo = path.join(root, 'product'), dump = path.join(source, 'design-input');
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(new URL('./fixtures/design-gate/valid/', import.meta.url), dump, { recursive: true });
  const directory = path.join(root, '.mono-agent-workflow/design/demo-product');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'memory.md'), `Репозиторий: ${repo}\n`);
  fs.cpSync(path.join(dump, 'approved'), path.join(directory, 'approved', project), { recursive: true });
  fs.mkdirSync(path.join(repo, '.agents'), { recursive: true });
  const config = path.join(repo, '.agents/mono-workflow.config.json');
  fs.writeFileSync(config, JSON.stringify({ projectName: 'Demo Product' }));
  const manifest = { issue: 'MONO-999', recordId, images, dump: 'design-input' };
  fs.writeFileSync(path.join(source, 'design.json'), JSON.stringify(manifest));
  const body = `# Прочитать сначала\nДизайн: запись mono-design ${recordId}, images ${images}\n\n# Снимок контекста\nПравило: иконки одного набора.\n`;
  const copy = (from = source, to = target, expectedProject = project) =>
    copyDesignSnapshot(from, to, 'MONO-999', body, config, expectedProject);
  try { run({ source, target, config, body, manifest, copy }); }
  finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('dispatch copies the exact approved U2 version into the task snapshot', () => fixture(f => {
  const result = f.copy();
  assert.equal(result.recordId, recordId);
  assert.equal(result.images, images);
  assert.equal(result.directory, 'design');
  assert.deepEqual(fs.readdirSync(path.join(f.target, 'design')), ['01-screen.png']);
  assert.deepEqual(fs.readFileSync(path.join(f.target, 'design/01-screen.png')),
    fs.readFileSync(path.join(f.source, 'design-input/approved', images.slice(0, 12), '01-screen.png')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.target, 'design.json'))), result);
  const retry = path.join(f.target, '..', 'retry'); fs.mkdirSync(retry);
  assert.deepEqual(f.copy(f.target, retry), result);
}));

test('a task without a design record receives no PNGs or manifest', () => fixture(f => {
  fs.rmSync(path.join(f.source, 'design.json'));
  assert.equal(copyDesignSnapshot(f.source, f.target, 'MONO-999', '# Прочитать сначала\nДизайн: нет\n', f.config, project), null);
  assert.deepEqual(fs.readdirSync(f.target), []);
}));

for (const fault of ['foreign-task', 'wrong-record', 'wrong-images', 'stale-prd', 'missing-manifest'])
  test(`dispatch refuses an unbound design snapshot: ${fault}`, () => fixture(f => {
    if (fault === 'foreign-task') f.manifest.issue = 'MONO-998';
    if (fault === 'wrong-record') f.manifest.recordId = '55555555-5555-5555-5555-555555555555';
    if (fault === 'wrong-images') f.manifest.images = 'a'.repeat(64);
    fs.writeFileSync(path.join(f.source, 'design.json'), JSON.stringify(f.manifest));
    if (fault === 'missing-manifest') fs.rmSync(path.join(f.source, 'design.json'));
    if (fault === 'stale-prd') {
      const file = path.join(f.source, 'design-input/prd.json');
      const doc = JSON.parse(fs.readFileSync(file)); doc.updatedAt = '2026-10-22T00:00:00.000Z';
      fs.writeFileSync(file, JSON.stringify(doc));
    }
    assert.throws(() => f.copy());
    assert.deepEqual(fs.readdirSync(f.target), []);
  }));

for (const expectedProject of ['66666666-6666-6666-6666-666666666666', null])
  test(`a valid design from another Project cannot supply task screens: ${expectedProject}`, () => fixture(f => {
    assert.throws(() => f.copy(f.source, f.target, expectedProject), /Project/);
    assert.deepEqual(fs.readdirSync(f.target), []);
  }));
