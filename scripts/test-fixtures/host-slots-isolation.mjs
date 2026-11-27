// MONO-507: tests never take the host's real slots (~/.mono-agent-workflow/host-slots), so they never queue behind
// live reviews. Imported first by suites that run review roles or host verification; spawned children inherit it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.MONO_HOST_SLOTS_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-host-slots-'));
  process.env.MONO_HOST_SLOTS_DIR = dir;
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
}
process.env.MONO_HOST_SLOTS ??= '64';
