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

test('MONO-484 carry-over is refused for a failed, changed, listed or relabelled item', t => {
  const f = recheckFixture(t);
  // C3 failed on A: it cannot be carried even with A's evidence.
  let bad = structuredClone(f.certB); bad.items[2] = { ...f.certA.items[2], outcome: 'passed', carriedFrom: f.heads.A }; delete bad.items[2].reason;
  assert.throws(() => f.check(bad), /C3 must be checked live/);
  // Changed expectation text on B forces a live check.
  const changed = structuredClone(f.expectedB); changed.expectedItems[0].expectation = 'Reject invalid input with a message';
  bad = structuredClone(f.certB); bad.items[0].expectation = changed.expectedItems[0].expectation;
  assert.throws(() => f.check(bad, changed), /C1 must be checked live/);
  // The host listed C2 as touched by the fix.
  const listed = structuredClone(f.expectedB); listed.recheck.live = [{ id: 'C2', reason: 'Fix touched the empty state' }];
  assert.throws(() => f.check(f.certB, listed), /C2 must be checked live/);
  assert.throws(() => f.check(f.certB, { ...listed, recheck: { ...listed.recheck, live: [{ id: 'C9', reason: 'x' }] } }), /live entries/);
  assert.throws(() => f.check(f.certB, { ...listed, recheck: { ...listed.recheck, live: [{ id: 'C2' }] } }), /live entries/);
  // Evidence must be the item's own prior evidence, and the origin head must be named.
  bad = structuredClone(f.certB); bad.items[0].evidence = f.certA.items[1].evidence;
  assert.throws(() => f.check(bad), /C1 must keep its evidence/);
  bad = structuredClone(f.certB); bad.items[0].carriedFrom = f.heads.B;
  assert.throws(() => f.check(bad), /C1 must name the head/);
  // The tester may widen the live list: checking C1 live is fine, citing A's files unmarked is not.
  bad = structuredClone(f.certB); delete bad.items[0].carriedFrom;
  assert.throws(() => f.check(bad), /escapes/);
  const widened = structuredClone(f.certB);
  widened.items[0] = { ...f.items[0], outcome: 'passed', evidence: [f.proof(f.heads.B, 'c1.cast')] };
  assert.equal(f.check(widened).verdict, 'passed');
});

test('MONO-484 previous report must be this task, ship mode, non-file recipe, with evidence present', t => {
  const f = recheckFixture(t);
  // Outside qa/<KEY>/.
  const foreign = path.join(f.root, 'qa', 'EXAMPLE-9', f.heads.A); fs.mkdirSync(foreign, { recursive: true });
  for (const name of ['task-report.json', 'task-expected.json']) fs.copyFileSync(path.join(f.dir(f.heads.A), name), path.join(foreign, name));
  const outside = structuredClone(f.expectedB);
  outside.recheck.previousReport = path.join(foreign, 'task-report.json');
  outside.recheck.previousExpected = path.join(foreign, 'task-expected.json');
  assert.throws(() => f.check(f.certB, outside), /qa\/<KEY>\//);
  // The gate's trusted task folder must match the block.
  assert.throws(() => validateQaCertificate(f.report(f.certB), f.expectedB, { taskDir: path.dirname(foreign) }), /outside qa/);
  assert.equal(validateQaCertificate(f.report(f.certB), f.expectedB, { taskDir: path.join(f.root, 'qa', f.issue) }).verdict, 'passed');
  // A given-version pass or a recipe file on the previous head cannot be carried.
  for (const [mode, recipeSource] of [['given-version', 'config'], ['ship', 'file']]) {
    f.save(f.heads.A, { ...f.certA, mode, recipeSource, gateEligible: false }, { ...f.expectedA, mode, recipeSource });
    assert.throws(() => f.check(), /previous QA report invalid/);
  }
  f.save(f.heads.A, f.certA, f.expectedA); assert.equal(f.check().verdict, 'passed');
  // Missing evidence or a missing report fails loudly, never as ENOENT «waiting».
  fs.rmSync(f.certA.items[0].evidence[0]);
  assert.throws(() => f.check(), error => /previous QA report invalid|carried evidence/.test(error.message) && error.code === undefined);
  fs.rmSync(path.join(f.dir(f.heads.A), 'task-report.json'));
  assert.throws(() => f.check(), error => /previous QA report missing/.test(error.message) && error.code === undefined);
});

test('MONO-484 carry-over is refused outside a task ship pass with purpose change; full passes stay valid', t => {
  const f = recheckFixture(t);
  for (const purpose of ['release', 'acceptance', undefined]) {
    const expected = { ...f.expectedB, purpose };
    assert.throws(() => f.check(f.certB, expected), /purpose change/);
    const { recheck, ...noBlock } = expected;
    assert.throws(() => f.check(f.certB, noBlock), /carried items require a recheck/);
  }
  assert.throws(() => f.check(f.certB, { ...f.expectedB, purpose: 'other' }), /purpose must be/);
  // A full pass with purpose release is accepted as before.
  const full = structuredClone(f.certB);
  full.items = f.items.map(item => ({ ...item, outcome: 'passed', evidence: [f.proof(f.heads.B, `${item.id}.cast`)] }));
  const { recheck, ...release } = { ...f.expectedB, purpose: 'release' };
  assert.equal(f.check(full, release).verdict, 'passed');
  // given-version, project and no-behavior refuse the recheck block.
  assert.throws(() => f.check({ ...f.certB, mode: 'given-version', gateEligible: false }, { ...f.expectedB, mode: 'given-version' }), /recheck only/);
  const build = [{ issue: f.issue, head: f.heads.B }];
  assert.throws(() => f.check({ ...f.certB, scope: 'project', project: 'p', build },
    { ...f.expectedB, scope: 'project', project: 'p', build }), /recheck only/);
  const short = { ...f.certB, kind: 'no-behavior', reason: 'Only text' }; delete short.items;
  assert.throws(() => f.check(short, { ...f.expectedB, kind: 'no-behavior' }), /recheck only/);
});

test('MONO-484 a chain of two rechecks keeps the head where each item was observed', t => {
  const f = recheckFixture(t);
  // B: C3 live but still failing, so B is a failed recheck.
  const certB = structuredClone(f.certB); certB.verdict = 'failed';
  Object.assign(certB.items[2], { outcome: 'failed', reason: 'Still loses the draft' });
  f.save(f.heads.B, certB, f.expectedB);
  // C: C1 and C2 still come from A, C3 checked live on C.
  const expectedC = f.expectedFor(f.heads.C, { purpose: 'change', recheck: f.recheck(f.heads.B) });
  const certC = { ...f.certB, head: f.heads.C, items: [certB.items[0], certB.items[1],
    { ...f.items[2], outcome: 'passed', evidence: [f.proof(f.heads.C, 'c3.cast')] }] };
  assert.equal(certC.items[0].carriedFrom, f.heads.A);
  assert.equal(validateQaCertificate(f.report(certC), expectedC).verdict, 'passed');
  const lost = structuredClone(certC); lost.items[0].carriedFrom = f.heads.B;
  assert.throws(() => validateQaCertificate(f.report(lost), expectedC), /C1 must name the head/);
  // A chain that loops back to the head being checked is refused.
  const storedB = { ...f.expectedB, recheck: f.recheck(f.heads.C) }; delete storedB.shipCertificate;
  fs.writeFileSync(path.join(f.dir(f.heads.B), 'task-expected.json'), JSON.stringify(storedB));
  f.save(f.heads.C, certC, expectedC);
  assert.throws(() => validateQaCertificate(f.report(certC), expectedC), /repeats a head/);
});
