import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { QA_MARKER, validateQaCertificate } from './qa-certificate.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-qa-certificate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proof = path.join(root, 'session.cast'); fs.writeFileSync(proof, 'recorded session');
  const recipeFile = path.join(root, 'recipe.md');
  fs.writeFileSync(recipeFile, '# Example recipe\nMode: terminal; detached copy; local fixtures; no external writes.\n');
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const cert = { scope: 'task', issue: 'EXAMPLE-1', head, base, verdict: 'passed', mode: 'ship',
    recipeSource: 'registry', gateEligible: true, kind: 'behavior',
    items: [{ id: 'C1', source: 'task', expectation: 'Reject invalid input', outcome: 'passed', evidence: [proof] }] };
  const expected = { scope: 'task', issue: 'EXAMPLE-1', head, base, kind: 'behavior', mode: 'ship', recipeSource: 'registry',
    evidenceRoot: root, expectedItems: [{ id: 'C1', source: 'task', expectation: 'Reject invalid input' }], taskCriteria: ['C1'], recipeFile,
    shipCertificate: `mono-ship green certificate\nShip: green\nIssue(s): EXAMPLE-1\nHead SHA: ${head}\nPR: #1` };
  const check = (c = cert, e = expected) => validateQaCertificate({ certificate: QA_MARKER + '\n' + JSON.stringify(c) }, e);
  return { cert, expected, check, root, proof };
}

test('accepts task and project certificates; project composition is independently bound', t => {
  const { cert, expected, check } = fixture(t);
  assert.equal(check().gateEligible, true);
  cert.scope = expected.scope = 'project'; cert.project = expected.project = 'example-project';
  cert.build = [{ issue: 'EXAMPLE-1', head: cert.head }, { issue: 'EXAMPLE-2', head: 'c'.repeat(40) }];
  expected.build = structuredClone(cert.build).reverse();
  assert.equal(check().scope, 'project');
  cert.build[0].head = 'd'.repeat(40); assert.throws(() => check(), /build changed/);
  cert.build = []; assert.throws(() => check(), /nonempty/);
});

test('rejects missing fields, foreign identity, duplicate/empty and incomplete items', t => {
  const { cert, expected, check } = fixture(t);
  for (const key of ['scope', 'issue', 'head', 'base', 'verdict', 'mode', 'recipeSource', 'gateEligible', 'kind', 'items']) {
    const bad = structuredClone(cert); delete bad[key]; assert.throws(() => check(bad), undefined, key);
  }
  for (const [key, value] of [['issue', 'EXAMPLE-9'], ['head', 'c'.repeat(40)], ['base', 'c'.repeat(40)]]) {
    assert.throws(() => check({ ...cert, [key]: value }), /mismatch/);
  }
  assert.throws(() => check({ ...cert, items: [] }), /nonempty/);
  assert.throws(() => check({ ...cert, items: [cert.items[0], cert.items[0]] }), /unique/);
  assert.throws(() => check(cert, { ...expected, expectedItems: [expected.expectedItems[0], {...expected.expectedItems[0], id:'C2'}] }), /incomplete/);
  assert.throws(() => check(cert, { ...expected, expectedItems: [expected.expectedItems[0], expected.expectedItems[0]] }), /unique expectation/);
  assert.throws(() => check(cert, { ...expected, taskCriteria: undefined }), /taskCriteria/);
  assert.throws(() => check(cert, { ...expected, shipCertificate: undefined }), /ship certificate/);
});

test('green rejects failed/unverified and evidence that is absent, unreadable, empty or outside root', t => {
  const { cert, check, root, proof } = fixture(t);
  for (const outcome of ['failed', 'unverified']) {
    const bad = structuredClone(cert); Object.assign(bad.items[0], { outcome, reason: 'Observed failure' });
    assert.throws(() => check(bad), /green verdict/);
    bad.verdict = outcome; assert.equal(check(bad).verdict, outcome);
  }
  const bad = structuredClone(cert); bad.items[0].evidence = [];
  assert.throws(() => check(bad), /without evidence/);
  bad.items[0].outcome = bad.verdict = 'failed'; bad.items[0].reason = 'No recording was captured';
  assert.equal(check(bad).verdict, 'failed');
  for (const file of [path.join(root, 'absent.webm'), root]) {
    cert.items[0].evidence = [file]; assert.throws(() => check());
  }
  const empty = path.join(root, 'empty.webm'); fs.writeFileSync(empty, '');
  cert.items[0].evidence = [empty]; assert.throws(() => check(), /nonempty/);
  cert.items[0].evidence = [proof]; fs.chmodSync(proof, 0o000);
  assert.throws(() => check(), /readable/); fs.chmodSync(proof, 0o600);
  cert.items[0].evidence = [path.resolve('README.md')]; assert.throws(() => check(), /escapes/);
  const link = path.join(root, 'escape'); fs.symlinkSync(path.resolve('README.md'), link);
  cert.items[0].evidence = [link]; assert.throws(() => check(), /escapes/);
});

test('excluded needs reason and successor and cannot exclude task acceptance under another source', t => {
  const { cert, expected, check } = fixture(t);
  Object.assign(cert.items[0], { source: 'heuristic', outcome: 'excluded', reason: 'Also unstable on unchanged main',
    successor: 'https://linear.app/example/issue/EXAMPLE-2/flaky' });
  expected.expectedItems[0].source='heuristic';
  assert.throws(() => check(), /cannot be excluded/);
  expected.taskCriteria = []; assert.equal(check().verdict, 'passed');
  const noProof = structuredClone(cert); noProof.items[0].evidence = [];
  assert.throws(() => check(noProof), /evidence of instability/);
  for (const key of ['reason', 'successor']) {
    const bad = structuredClone(cert); delete bad.items[0][key]; assert.throws(() => check(bad), /reason and successor/);
  }
  cert.items[0].source = expected.expectedItems[0].source = 'task'; assert.throws(() => check(), /cannot be excluded/);
});

test('short no-behavior certificate accepts reason and cannot bypass expected behavior or project coverage', t => {
  const { cert, expected, check } = fixture(t);
  cert.kind = 'no-behavior'; cert.reason = 'Only punctuation changes'; delete cert.items;
  assert.throws(() => check(), /kind mismatch/);
  expected.kind = 'no-behavior'; assert.equal(check().reason, cert.reason);
  delete cert.reason; assert.throws(() => check(), /reason/);
  cert.reason = 'Only punctuation'; cert.scope = expected.scope = 'project';
  cert.project = expected.project = 'example'; cert.build = expected.build = [{ issue: 'EXAMPLE-1', head: cert.head }];
  assert.throws(() => check(), /requires task/);
});

test('given-version accepts assignment recipe file without ship and can never open gates', t => {
  const { cert, expected, check, root } = fixture(t);
  cert.mode = expected.mode = 'given-version'; cert.recipeSource = expected.recipeSource = 'file';
  cert.gateEligible = false; delete expected.shipCertificate;
  assert.equal(check().gateEligible, false);
  assert.throws(() => check({ ...cert, gateEligible: true }), /gateEligible/);
  assert.throws(() => check(cert, { ...expected, recipeFile: path.join(root, 'missing.md') }));
  for (const recipeSource of ['config', 'registry']) {
    cert.recipeSource = expected.recipeSource = recipeSource; assert.equal(check().gateEligible, false);
  }
  cert.mode = expected.mode = 'ship'; cert.recipeSource = expected.recipeSource = 'file';
  expected.shipCertificate = `mono-ship green certificate\nShip: green\nIssue(s): EXAMPLE-1\nHead SHA: ${cert.head}\nPR: #1`;
  assert.equal(check().gateEligible, false);
});

test('CLI validates the same certificate and fails on foreign head', t => {
  const { cert, expected, root } = fixture(t);
  const reportFile = path.join(root, 'report.json'), expectedFile = path.join(root, 'expected.json');
  fs.writeFileSync(reportFile, JSON.stringify({ certificate: QA_MARKER + '\n' + JSON.stringify(cert) }));
  fs.writeFileSync(expectedFile, JSON.stringify(expected));
  const run = () => spawnSync(process.execPath, ['scripts/qa-certificate.mjs', reportFile, expectedFile], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  expected.head = 'f'.repeat(40); fs.writeFileSync(expectedFile, JSON.stringify(expected));
  assert.equal(run().status, 1);
});


test('certificate expectations may mention the certificate marker without becoming a second header', t => {
  const { cert, expected, check } = fixture(t);
  cert.items[0].expectation = expected.expectedItems[0].expectation = 'Emits a mono-qa certificate for the tested task';
  assert.equal(check().verdict, 'passed');
});

test('MONO-279 binds expectation text and source independently of certificate', t => {
  const { cert, expected, check } = fixture(t);
  expected.expectedItems = [{ id: 'C1', source: 'task', expectation: 'Reject invalid input' }];
  assert.equal(check().verdict, 'passed');
  for (const [field,value] of [['expectation','Silently accept invalid input'],['source','heuristic']]) {
    const bad=structuredClone(cert);bad.items[0][field]=value;
    assert.throws(()=>check(bad),/expectation.*(changed|mismatch)/);
  }
});

test('scenario items cannot be excluded or bypassed with no-behavior', t => {
  const { cert, expected, check, proof } = fixture(t);
  expected.expectedItems=[{id:'C1',source:'scenario',expectation:'Idea / approve / codex'}];expected.taskCriteria=[];
  Object.assign(cert.items[0],expected.expectedItems[0]);
  assert.equal(check().verdict,'passed');
  Object.assign(cert.items[0],{outcome:'excluded',evidence:[proof],reason:'unstable',successor:'https://linear.app/example/issue/EXAMPLE-2'});
  assert.throws(()=>check(),/scenario.*excluded/);
  cert.kind=expected.kind='no-behavior';cert.reason='Only skill text';delete cert.items;
  assert.throws(()=>check(),/scenario.*no-behavior/);
});

// MONO-484: after a ship-fix only failed and touched items are checked live; the rest
// carry over from the head where they were observed, with that head's evidence.
function recheckFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-qa-recheck-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const issue = 'EXAMPLE-1', base = 'b'.repeat(40);
  const heads = { A: 'a'.repeat(40), B: 'c'.repeat(40), C: 'd'.repeat(40) };
  const ship = head => `mono-ship green certificate\nShip: green\nIssue(s): ${issue}\nHead SHA: ${head}\nPR: #1`;
  const items = [
    { id: 'C1', source: 'task', expectation: 'Reject invalid input' },
    { id: 'C2', source: 'heuristic', expectation: 'Empty list shows a hint' },
    { id: 'C3', source: 'task', expectation: 'Save keeps the draft' }];
  const dir = head => path.join(root, 'qa', issue, head);
  const proof = (head, name) => { fs.mkdirSync(dir(head), { recursive: true });
    const file = path.join(dir(head), name); fs.writeFileSync(file, `recording ${name}`); return file; };
  const expectedFor = (head, extra = {}) => ({ scope: 'task', issue, head, base, kind: 'behavior', mode: 'ship',
    recipeSource: 'config', evidenceRoot: dir(head), expectedItems: structuredClone(items), taskCriteria: ['C1', 'C3'],
    shipCertificate: ship(head), ...extra });
  const report = cert => ({ certificate: QA_MARKER + '\n' + JSON.stringify(cert) });
  const save = (head, cert, expected) => {
    fs.mkdirSync(dir(head), { recursive: true });
    const { shipCertificate, ...stored } = expected;
    fs.writeFileSync(path.join(dir(head), 'task-expected.json'), JSON.stringify(stored));
    fs.writeFileSync(path.join(dir(head), 'task-report.json'), JSON.stringify(report(cert)));
  };
  // Head A: a full pass that found one bug.
  const expectedA = expectedFor(heads.A, { purpose: 'change' });
  const certA = { scope: 'task', issue, head: heads.A, base, verdict: 'failed', mode: 'ship', recipeSource: 'config',
    gateEligible: true, kind: 'behavior', items: [
      { ...items[0], outcome: 'passed', evidence: [proof(heads.A, 'c1.cast')] },
      { ...items[1], outcome: 'passed', evidence: [proof(heads.A, 'c2.cast')] },
      { ...items[2], outcome: 'failed', reason: 'Draft is lost after save', evidence: [proof(heads.A, 'c3.cast')] }] };
  save(heads.A, certA, expectedA);
  const recheck = (previous, live = []) => ({ previousHead: previous,
    previousReport: path.join(dir(previous), 'task-report.json'),
    previousExpected: path.join(dir(previous), 'task-expected.json'), live });
  // Head B: only C3 (failed on A) is checked live; C1 and C2 carry over from A.
  const expectedB = expectedFor(heads.B, { purpose: 'change', recheck: recheck(heads.A) });
  const certB = { ...certA, head: heads.B, verdict: 'passed', items: [
    { ...certA.items[0], carriedFrom: heads.A },
    { ...certA.items[1], carriedFrom: heads.A },
    { ...items[2], outcome: 'passed', evidence: [proof(heads.B, 'c3.cast')] }] };
  const check = (cert = certB, expected = expectedB) => validateQaCertificate(report(cert), expected);
  return { root, issue, heads, items, dir, proof, ship, expectedFor, recheck, save, report,
    certA, expectedA, certB, expectedB, check };
}

test('MONO-484 red: a failed full pass is valid and a scoped recheck carries its green items', t => {
  const f = recheckFixture(t);
  assert.equal(validateQaCertificate(f.report(f.certA), f.expectedA).verdict, 'failed');
  // Before MONO-484 this threw «evidence escapes evidenceRoot»: carried items had no lawful form.
  assert.equal(f.check().verdict, 'passed');
});
