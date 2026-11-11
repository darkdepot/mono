import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('Ship invocation graders require mono:ship and reject the foreign ship skill', () => {
  const cases = fs.readdirSync('evals/ship', { withFileTypes: true }).filter(entry => entry.isDirectory());
  assert.equal(cases.length, 5);
  for (const entry of cases) {
    const dir = path.join('evals/ship', entry.name);
    const prompt = fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8');
    assert.ok(prompt.length > 60);
    assert.match(prompt, /^---\n(?:(?!---)[^\n]*\n)*allowed_tools: \[Read, Glob, Grep, Skill\]\n/, `${entry.name}: routing eval must be able to invoke Skill`);
    const grader = fs.readFileSync(path.join(dir, 'graders/ship-invocation.md'), 'utf8');
    assert.match(grader, /type: tool_used\ntool: Skill/);
    const pattern = new RegExp(/^input_match: '(.*)'$/m.exec(grader)[1]);
    assert.ok(pattern.test(JSON.stringify({ skill: 'mono:ship' })));
    for (const skill of ['ship', 'gstack:ship', 'mono:deploy']) assert.equal(pattern.test(JSON.stringify({ skill })), false);
    if (['merge', 'implement'].includes(entry.name)) assert.match(grader, /min: 0\nmax: 0/);
    else {
      const foreign = fs.readFileSync(path.join(dir, 'graders/no-foreign-ship.md'), 'utf8');
      assert.match(foreign, /min: 0\nmax: 0/);
      const reject = new RegExp(/^input_match: '(.*)'$/m.exec(foreign)[1]);
      assert.ok(reject.test('{"skill":"ship"}')); assert.equal(reject.test('{"skill":"mono:ship"}'), false);
    }
  }
});
