import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const project = '11111111-1111-1111-1111-111111111111';
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-design-gate-'));
  const dump = path.join(root, 'dump'), home = path.join(root, 'design'), repo = path.join(root, 'product');
  fs.cpSync(new URL('./fixtures/design-gate/valid/', import.meta.url), dump, { recursive: true });
  const product = path.join(home, 'demo-product');
  fs.mkdirSync(product, { recursive: true });
  fs.writeFileSync(path.join(product, 'memory.md'), `Репозиторий: ${repo}\n`);
  fs.cpSync(path.join(dump, 'approved'), path.join(product, 'approved', project), { recursive: true });
  fs.mkdirSync(path.join(repo, '.agents'), { recursive: true });
  const config = path.join(repo, '.agents', 'mono-workflow.config.json');
  fs.writeFileSync(config, JSON.stringify({ projectName:'Demo Product' }));
  // Isolate the home directory while exercising the shipped route switch.
  const script = path.join(root, 'idea-gate.mjs');
  fs.writeFileSync(script, fs.readFileSync(new URL('./idea-gate.mjs', import.meta.url), 'utf8')
    .replace("const DESIGN_HOME = path.join(os.homedir(), '.mono-agent-workflow', 'design');", `const DESIGN_HOME = ${JSON.stringify(home)};`));
  fs.copyFileSync(new URL('./runtime.mjs', import.meta.url), path.join(root, 'runtime.mjs'));
  const change = (name, mutate) => {
    const file = path.join(dump, name), value = JSON.parse(fs.readFileSync(file));
    mutate(value); fs.writeFileSync(file, JSON.stringify(value));
  };
  const check = (command, code) => {
    const r = spawnSync(process.execPath, [script, command, '--mode','fresh','--dump',dump,'--config',config], { encoding:'utf8' });
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 2, r.stdout + r.stderr);
    assert.equal(r.status, code === 'pass' ? 0 : 1, r.stdout + r.stderr);
    const result = JSON.parse(lines[1]);
    assert.equal(result.code, code, r.stdout);
    assert.match(lines[0], code === 'pass' ? /^Готово$/ : /^Стоп: /);
    return result;
  };
  try { run({ root, dump, home, repo, product, change, check }); }
  finally { fs.rmSync(root, { recursive:true, force:true }); }
}

test('enabled design binds PRD approval and immutable PNG version using shell digest', () => fixture(({ product, check }) => {
  const version = fs.readdirSync(path.join(product, 'approved', project))[0];
  const shell = spawnSync('/bin/sh', ['-c', 'LC_ALL=C ls *.png | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256'],
    { cwd:path.join(product, 'approved', project, version), encoding:'utf8' });
  assert.equal(shell.status, 0, shell.stderr);
  assert.equal(shell.stdout.trim().split(' ')[0].slice(0,12), version);
  assert.equal(check('design','pass').recordId, '44444444-4444-4444-4444-444444444444');
  assert.deepEqual(check('route','pass').requiredRecords, ['design','tech']);
  check('tech','pass');
}));

test('enabled design reports absent record and changed PRD independently', () => fixture(({ change, check }) => {
  change('prd.json', d => { d.updatedAt='2026-10-22T01:00:00.000Z'; });
  check('design','stale-prd');
  change('comments-1.json', p => { p.comments.splice(1,1); });
  check('design','no-record');
}));

test('latest PRD approval invalidates old design even with unchanged document read', () => fixture(({ change, check }) => {
  change('comments-1.json', p => { p.comments[2].body=p.comments[2].body.replace('01:00:00','04:00:00'); });
  check('design','stale-prd');
}));

for (const action of ['change', 'remove', 'extra']) test(`design detects ${action} PNGs`, () => fixture(({ product, check }) => {
  const base=path.join(product,'approved',project), dir=path.join(base,fs.readdirSync(base)[0]);
  if(action==='change') fs.appendFileSync(path.join(dir,'01-screen.png'),'changed');
  if(action==='remove') fs.rmSync(dir,{recursive:true});
  if(action==='extra') fs.copyFileSync(path.join(dir,'01-screen.png'),path.join(dir,'02-other.png'));
  check('design','stale-images');
}));

test('design resolves slug collisions by repository identity', () => fixture(({ product, repo, check }) => {
  fs.renameSync(product,product+'-2');
  fs.mkdirSync(product);
  fs.writeFileSync(path.join(product,'memory.md'),'Репозиторий: /another/repo\n');
  check('design','pass');
  fs.writeFileSync(path.join(product+'-2','memory.md'),`Репозиторий: ${repo}/other\n`);
  check('design','stale-images');
}));

test('tech requires the latest design record id, including omitted field as none', () => fixture(({ change, check }) => {
  check('tech','pass');
  change('comments-1.json', p => { p.comments[0].body=p.comments[0].body.replace('design=44444444-4444-4444-4444-444444444444','design=none'); });
  check('tech','stale-design');
  change('comments-1.json', p => { p.comments[0].body=p.comments[0].body.replace(' design=none',''); });
  check('tech','stale-design');
  change('comments-1.json', p => { p.comments.splice(1,1); p.comments[1].body=p.comments[1].body.replace('design=needed next=design','design=not-needed next=tech-evaluation'); });
  check('tech','pass');
  change('comments-1.json', p => { p.comments[0].body=p.comments[0].body.replace('by=owner','by=owner design=none'); });
  check('tech','pass');
}));

test('newer image approval invalidates tech without changing PRD or image bytes', () => fixture(({ change, check }) => {
  change('comments-1.json', p => { p.comments[1].id='55555555-5555-5555-5555-555555555555'; });
  check('tech','stale-design');
}));

for (const needsDesign of [true, false]) test(`new direct Handoff route excludes historical tech, design=${needsDesign}`, () => fixture(({ change, check }) => {
  change('prd.json', d => { d.updatedAt='2026-10-22T01:00:00.000Z'; });
  change('comments-1.json', p => {
    p.comments[2].body=p.comments[2].body.replace('2026-10-21T01:00:00.000Z','2026-10-22T01:00:00.000Z');
    p.comments[1].body=p.comments[1].body.replace('2026-10-21T01:00:00.000Z','2026-10-22T01:00:00.000Z').replace('next=tech-evaluation','next=handoff');
    if (!needsDesign) p.comments[2].body=p.comments[2].body.replace('design=needed next=design','design=not-needed next=handoff');
  });
  check('tech','stale-prd');
  if (needsDesign) check('design','pass');
  const route=check('route','pass');
  assert.deepEqual(route.requiredRecords, needsDesign ? ['design'] : []);
  assert.equal(route.next,'handoff');
  assert.equal(route.records.tech,null);
}));

for (const replacement of ['design=needed next=handoff','design=not-needed next=design','design=unknown next=design','next=design'])
  test(`enabled route rejects incompatible PRD fields: ${replacement}`, () => fixture(({ change, check }) => {
    change('comments-1.json', p => { p.comments[2].body=p.comments[2].body.replace('design=needed next=design',replacement); });
    check('route','bad-record');
  }));

test('first PRD approvals choose design before the size route', () => fixture(({ change, check }) => {
  change('comments-1.json', p => { p.comments = [p.comments[2]]; });
  assert.deepEqual(check('route', 'pass').requiredRecords, ['design']);
  check('design', 'no-record');
  check('tech', 'no-record');
  for (const next of ['handoff', 'tech-evaluation']) {
    change('comments-1.json', p => { p.comments[0].body = p.comments[0].body.replace(/design=\S+ next=\S+/, `design=not-needed next=${next}`); });
    assert.deepEqual(check('route', 'pass').requiredRecords, next === 'handoff' ? [] : ['tech']);
  }
}));

test('reapproval requires downstream renewal even when PRD bytes and version are unchanged', () => fixture(({ change, check }) => {
  change('comments-1.json', p => {
    const renewed = structuredClone(p.comments[2]);
    renewed.id = 'renewed-prd';
    renewed.createdAt = renewed.updatedAt = '2026-10-22T01:00:00.000Z';
    p.comments.unshift(renewed);
  });
  check('design', 'stale-prd');
  check('tech', 'stale-prd');
  change('comments-1.json', p => {
    p.comments[2].createdAt = '2026-10-22T02:00:00.000Z';
    p.comments[2].id = 'renewed-design';
  });
  check('design', 'pass');
  check('tech', 'stale-prd');
}));

test('reapproval adding a screen invalidates an old matching design and tech record', () => fixture(({ change, check }) => {
  change('comments-1.json', p => {
    const previous = structuredClone(p.comments[2]);
    previous.id = 'previous-prd';
    previous.createdAt = '2026-10-20T01:00:00.000Z';
    previous.body = previous.body.replace('design=needed next=design', 'design=not-needed next=handoff');
    p.comments[2].createdAt = '2026-10-22T01:00:00.000Z';
    p.comments.push(previous);
  });
  assert.deepEqual(check('route', 'pass').requiredRecords, ['design', 'tech']);
  check('design', 'stale-prd');
  check('tech', 'stale-prd');
}));

test('size growth on reapproval routes a former tiny project to the tech lead', () => fixture(({ change, check }) => {
  change('comments-1.json', p => {
    const previous = structuredClone(p.comments[2]);
    previous.id = 'previous-tiny-prd';
    previous.body = previous.body.replace('design=needed next=design', 'design=not-needed next=handoff');
    p.comments[2].body = p.comments[2].body.replace('design=needed next=design', 'design=not-needed next=tech-evaluation');
    p.comments[2].createdAt = '2026-10-22T01:00:00.000Z';
    p.comments.push(previous);
    p.comments.splice(1, 1);
  });
  assert.deepEqual(check('route', 'pass').requiredRecords, ['tech']);
  check('tech', 'stale-prd');
}));

for (const [field, replacement] of [['next=tech-evaluation', 'next=unknown'], ['by=owner', 'by=unknown'],
  ['images=0e66fc587d5356f31cdfea5131276c0d91a3fb207004689e65920d7c964e5b73', 'images=broken']])
  test(`every gate rejects an invalid design record field: ${replacement}`, () => fixture(({ change, check }) => {
    change('comments-1.json', p => { p.comments[1].body = p.comments[1].body.replace(field, replacement); });
    for (const command of ['route', 'design', 'tech']) assert.equal(check(command, 'bad-record').stage, 'mono:design');
  }));

test('orchestrator approvals use the same active record chain', () => fixture(({ change, check }) => {
  change('comments-1.json', p => { for (const c of p.comments) c.body = c.body.replace('by=owner', 'by=orchestrator'); });
  check('route', 'pass'); check('design', 'pass'); check('tech', 'pass');
}));

for (const [previousNext, code] of [[undefined,'bad-record'],['tech-evaluation','bad-record'],[null,'pass']])
  test(`enabled PRD without next requires a predecessor without next: ${previousNext}`, () => fixture(({ change, check }) => {
    change('comments-1.json', p => {
      const current=p.comments[2];
      current.body=current.body.replace('design=needed next=design','design=not-needed');
      p.comments=[current];
      if (previousNext !== undefined) {
        const previous=structuredClone(current);
        previous.id='previous-prd-record';
        previous.createdAt='2026-10-20T01:01:00.000Z';
        previous.updatedAt=previous.createdAt;
        previous.body=previous.body.replace(' design=not-needed', previousNext === null ? '' : ` next=${previousNext}`);
        p.comments.push(previous);
      }
    });
    const route=check('route',code);
    if (code === 'pass') {
      assert.deepEqual(route.requiredRecords,[]);
      assert.equal(route.next,'handoff');
      check('tech','no-record');
    } else {
      assert.equal(route.stage,'mono:discovery');
      assert.equal(check('tech','bad-record').stage,'mono:discovery');
    }
  }));
