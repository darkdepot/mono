import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('QA invocation graders require mono:qa and explicitly reject foreign qa', () => {
  const cases = fs.readdirSync('evals/qa', { withFileTypes: true }).filter(entry => entry.isDirectory());
  assert.equal(cases.length, 7);
  for (const entry of cases) {
    const dir = path.join('evals/qa', entry.name);
    assert.ok(fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8').length > 60);
    const grader = fs.readFileSync(path.join(dir, 'graders/qa-invocation.md'), 'utf8');
    assert.match(grader, /type: tool_used\ntool: Skill/);
    const pattern = new RegExp(/^input_match: '(.*)'$/m.exec(grader)[1]);
    assert.ok(pattern.test(JSON.stringify({ skill: 'mono:qa' })));
    for (const skill of ['qa', 'other:qa', 'mono:ship']) assert.equal(pattern.test(JSON.stringify({ skill })), false);
    if (['implement', 'code-review'].includes(entry.name)) assert.match(grader, /min: 0\nmax: 0/);
    else {
      const foreign = fs.readFileSync(path.join(dir, 'graders/no-foreign-qa.md'), 'utf8');
      assert.match(foreign, /min: 0\nmax: 0/);
      const reject = new RegExp(/^input_match: '(.*)'$/m.exec(foreign)[1]);
      assert.ok(reject.test('{"skill":"qa"}')); assert.equal(reject.test('{"skill":"mono:qa"}'), false);
    }
  }
});
