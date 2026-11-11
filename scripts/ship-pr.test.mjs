import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SHIP_MARKER, scanBlob, unpushedSecrets, checkSecrets, draftBody, collectRemarks, readyBlockers, mentionNeeded, requestRemark, u6File } from './ship-pr.mjs';
import { prRemarkFindings, remarkDigest } from './code-review.mjs';

const head = 'a'.repeat(40), older = 'b'.repeat(40);
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-pr-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git'), work = path.join(root, 'work');
  git(root, 'init', '-q', '--bare', remote); git(root, 'init', '-q', '-b', 'main', work);
  const commit = (file, text) => { fs.writeFileSync(path.join(work, file), text); git(work, 'add', file); git(work, '-c', 'user.name=t', '-c', 'user.email=t@e.invalid', 'commit', '-qm', file); };
  commit('a.txt', 'one\n'); git(work, 'remote', 'add', 'origin', remote); git(work, 'push', '-q', 'origin', 'main');
  return { work, commit };
}
// Built at runtime so the source itself carries no secret-shaped literal.
const awsKey = ['AKIA', 'Z'.repeat(16)].join(''), privateKey = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');

test('secrets: only commits not on the remote are scanned, with file and line', t => {
  const { work, commit } = repo(t);
  assert.deepEqual(unpushedSecrets(work, 'origin'), []);
  commit('config.js', `const a = 1;\nconst key = "${awsKey}";\n`);
  assert.deepEqual(unpushedSecrets(work, 'origin').map(({ commit: _, ...item }) => item), [{ file: 'config.js', line: 2, kind: 'AWS access key' }]);
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main'); git(work, 'fetch', '-q', 'origin');
  assert.deepEqual(unpushedSecrets(work, 'origin'), [], 'already pushed commits are not scanned again');
  commit('key.pem', `${privateKey}\n`);
  assert.throws(() => checkSecrets({ worktree: work, repo: 'o/r', remote: 'origin', protection: 'disabled' }), /secret before push: private key in key\.pem:1/);
  assert.throws(() => checkSecrets({ worktree: work, repo: 'o/r', remote: 'origin', protection: 'unknown' }), /secret before push/, 'unreadable protection status scans too');
  assert.deepEqual(checkSecrets({ worktree: work, repo: 'o/r', remote: 'origin', protection: 'enabled' }), { scanned: false, protection: 'enabled', found: [] }, 'GitHub push protection is the check');
});
test('secrets: whole files are read, binary-looking ones and diff attributes included; ordinary text passes', t => {
  assert.deepEqual(scanBlob('x.js', 'const ok = "sk-short";\n'), []);
  const { work, commit } = repo(t);
  commit('.gitattributes', 'creds.txt -diff\n'); commit('creds.txt', `token=${awsKey}\n`); commit('blob.bin', `\0\0binary${privateKey}\n`);
  assert.deepEqual(unpushedSecrets(work, 'origin').map(item => [item.file, item.kind]).sort(), [['blob.bin', 'private key'], ['creds.txt', 'AWS access key']]);
});

test('draft body carries the marker, the result title and the task link', () => {
  const body = draftBody({ issue: 'MONO-1', issueUrl: 'https://linear.app/x/issue/MONO-1', title: 'Задачи запускаются без ошибок' });
  assert.ok(body.startsWith(SHIP_MARKER)); assert.match(body, /\[MONO-1\]\(https:\/\/linear\.app\/x\/issue\/MONO-1\)/);
});

const snapshot = (extra = {}) => ({ head, viewer: 'owner', checks: [], threads: [], botComments: [], reviews: [], ...extra });
test('remarks: bot threads, bot comments, failed CI on the head and owner instructions; Ship\'s own and resolved ones are not', () => {
  const threads = [
    { id: 'T1', isResolved: false, comments: [{ id: 'C1', body: '<img src="badges/p1.svg"> **Gate lets stale work through**', author: { login: 'greptile-apps[bot]' }, publishedAt: '2026-11-11T10:00:00Z' },
      { id: 'C2', body: `${SHIP_MARKER}\nFixed in abc`, author: { login: 'owner' } }] },
    { id: 'T2', isResolved: true, comments: [{ id: 'C3', body: 'Old remark', author: { login: 'greptile-apps[bot]' } }] },
    { id: 'T3', isResolved: false, comments: [{ id: 'C4', body: 'Please rename this', author: { login: 'owner' }, publishedAt: '2026-11-11T11:00:00Z' }] },
    { id: 'T4', isResolved: false, comments: [{ id: 'C5', body: 'Note before Ship started', author: { login: 'owner' }, publishedAt: '2026-11-11T08:00:00Z' }] },
  ];
  const checks = [{ __typename: 'CheckRun', name: 'validate', status: 'COMPLETED', conclusion: 'FAILURE', head },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', head: older },
    { __typename: 'CheckRun', name: 'CodeQL', status: 'COMPLETED', conclusion: 'NEUTRAL', head },
    { __typename: 'StatusContext', context: 'deploy', state: 'ERROR', head }];
  const reviewComments = [{ node_id: 'C1', path: 'scripts/gate.mjs', line: 150, commit_id: older }];
  const issueComments = [{ node_id: 'I1', body: `${SHIP_MARKER}\nDraft`, user: { login: 'owner' }, created_at: '2026-11-11T09:00:00Z' },
    { node_id: 'I2', body: 'Also update the handbook', user: { login: 'owner' }, created_at: '2026-11-11T12:00:00Z', updated_at: '2026-11-11T12:00:00Z' },
    { node_id: 'I3', body: 'Third party note', user: { login: 'someone' }, created_at: '2026-11-11T12:00:00Z' }];
  const remarks = collectRemarks({ snapshot: snapshot({ threads, checks, botComments: [{ id: 'B1', body: 'Greptile Summary', updatedAt: 'u' }] }), reviewComments, issueComments });
  assert.deepEqual(remarks.map(remark => [remark.source, remark.id, remark.file, remark.line, remark.urgent, remark.head === older]), [
    ['bot', 'T1', 'scripts/gate.mjs', 150, true, true],
    ['bot', 'T2', '(pr)', 1, false, false],
    ['owner', 'T3', '(pr)', 1, false, false],
    ['bot', 'B1', '(pr)', 1, false, false],
    ['owner', 'I2', '(pr)', 1, false, false],
    ['ci', 'ci:validate', '(pr)', 1, false, false],
    ['ci', 'ci:deploy', '(pr)', 1, false, false],
  ]);
  assert.doesNotMatch(remarks[0].body, /Fixed in abc/, 'Ship\'s own reply is not part of the remark');
  assert.equal(remarks[0].title, '**Gate lets stale work through**');
  assert.doesNotThrow(() => prRemarkFindings(remarks.map(requestRemark)), 'every remark is a valid collection request remark');
  assert.deepEqual(collectRemarks({ snapshot: snapshot({ threads: threads.slice(2) }), issueComments: issueComments.slice(1) }), [],
    'without a marked Ship publication the owner\'s comments are not instructions');
  assert.deepEqual(collectRemarks({ snapshot: snapshot(), issueComments: issueComments.slice(1), pr: { body: `${SHIP_MARKER}\nDraft`, created_at: '2026-11-11T09:00:00Z' } }).map(remark => remark.id), ['I2'],
    'the marked draft description starts the owner\'s instructions');
});
test('Ship\'s own reply in a thread does not change the remark digest', () => {
  const thread = extra => ({ id: 'T1', isResolved: false, comments: [{ id: 'C1', body: 'Bug', author: { login: 'greptile-apps[bot]' } }, ...extra] });
  const read = extra => collectRemarks({ snapshot: snapshot({ threads: [thread(extra)] }) })[0].digest;
  assert.equal(read([]), read([{ id: 'C2', body: `${SHIP_MARKER}\nFixed`, author: { login: 'owner' } }]));
  assert.notEqual(read([]), read([{ id: 'C3', body: 'Still broken', author: { login: 'greptile-apps[bot]' } }]));
});
test('remark digest changes when the remark text changes', () => {
  const read = body => collectRemarks({ snapshot: snapshot({ botComments: [{ id: 'B1', body, updatedAt: 'u' }] }) })[0].digest;
  assert.notEqual(read('one'), read('two'));
});

test('ready: no failed CI, every remark carried in the clean collection or confirmed by the read-only pass for exactly its text', () => {
  const build = (id, source = 'bot', extra = {}) => { const remark = { id, source, file: '(pr)', line: 1, title: id, body: `${id} body`, urgent: false, head, ...extra }; return { ...remark, digest: remarkDigest(remark) }; };
  const [b1, b2, t1, owner, ci] = [build('B1'), build('B2'), build('T1'), build('I2', 'owner'), build('ci:validate', 'ci')];
  const check = { head, remarks: [b1, b2].map(remark => ({ id: remark.id, digest: remark.digest, decision: 'informational' })),
    verdicts: [{ id: 'B1', verdict: 'confirmed', reason: 'r' }, { id: 'B2', verdict: 'needs-fix', reason: 'r' }] };
  assert.deepEqual(readyBlockers({ head, remarks: [t1, b1], sent: [requestRemark(t1)], check }), []);
  assert.match(readyBlockers({ head, remarks: [b2], check })[0], /not settled/, 'needs-fix keeps the draft');
  assert.match(readyBlockers({ head, remarks: [build('B1', 'bot', { body: 'changed text' })], check })[0], /not settled/, 'the pass covered other text');
  assert.match(readyBlockers({ head: older, remarks: [b1], check })[0], /not settled/, 'a pass on another head does not count');
  assert.match(readyBlockers({ head, remarks: [build('T1', 'bot', { body: 'new reply' })], sent: [requestRemark(t1)] })[0], /not settled/, 'a remark that changed after the round');
  assert.match(readyBlockers({ head, remarks: [ci] })[0], /failed CI/);
  assert.match(readyBlockers({ head, remarks: [owner], check: { head, remarks: [{ id: 'I2', digest: owner.digest }], verdicts: [{ id: 'I2', verdict: 'confirmed', reason: 'r' }] } })[0],
    /owner instruction not done/, 'the read-only pass cannot decline an owner instruction');
  assert.deepEqual(readyBlockers({ head, remarks: [owner], sent: [requestRemark(owner)] }), [], 'an owner instruction done in a clean round');
});
test('mention: once per head and only while the bot has not reported on it', () => {
  assert.equal(mentionNeeded({ snapshot: snapshot() }), true);
  assert.equal(mentionNeeded({ snapshot: snapshot(), issueComments: [{ body: `${SHIP_MARKER}\n@greptileai review ${head}` }] }), false);
  assert.equal(mentionNeeded({ snapshot: snapshot(), issueComments: [{ body: `${SHIP_MARKER}\n@greptileai review ${older}` }] }), true, 'an older head\'s mention does not count');
  assert.equal(mentionNeeded({ snapshot: snapshot({ checks: [{ name: 'Greptile Review', head }] }) }), false);
  assert.equal(mentionNeeded({ snapshot: snapshot({ reviews: [{ user: { login: 'greptile-apps[bot]' }, commit_id: head }] }) }), false);
  assert.equal(mentionNeeded({ snapshot: snapshot({ reviews: [{ user: { login: 'greptile-apps[bot]' }, commit_id: older }] }) }), true);
});
test('the read-only pass result sits next to the attempt state file, per head', () => {
  assert.equal(u6File('/s/ship.json', head), `/s/ship.json.u6-${head}.json`);
});
