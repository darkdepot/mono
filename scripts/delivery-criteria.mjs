import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest, readJson } from './runtime.mjs';

const normalize = text => text.replace(/\s+/gu, ' ').trim();
const fail = detail => { throw new Error(`approved criteria: ${detail}`); };
function stateFile(root, issue, attempt) {
  if (!path.isAbsolute(root ?? '') || !/^[A-Z][A-Z0-9]*-\d+$/.test(issue) || !Number.isInteger(attempt) || attempt < 1)
    fail('delivery identity required');
  return path.join(root, 'reports', `${issue}-criteria-a${attempt}.json`);
}

// Literal canonical Issue section; ambiguous/missing input stops capture rather
// than guessing a shorter acceptance list.
export function acceptanceCriteria(body) {
  let section = false, depth = 0, marker = false, fence = null, sections = 0;
  const criteria = [];
  for (const line of body.split(/\r?\n/u)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      if (section) fail('fenced acceptance content is ambiguous');
      continue;
    }
    if (fence) continue;
    const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/u.exec(line);
    if (heading) {
      if (section && heading[1].length <= depth) section = false;
      if (/^Критерии при[её]мки\s*:?$/iu.test(heading[2])) {
        if (++sections > 1) fail('duplicate acceptance section');
        section = true; depth = heading[1].length;
      } else if (section) fail('nested acceptance heading is ambiguous');
      continue;
    }
    if (!section || !line.trim()) continue;
    if (/^Готово, когда:\s*$/u.test(line.trim())) {
      if (marker || criteria.length) fail('duplicate acceptance marker');
      marker = true; continue;
    }
    if (!marker) fail('Готово, когда: required before acceptance bullets');
    const bullet = /^[-*+]\s+(.+)$/u.exec(line);
    if (bullet) criteria.push(normalize(bullet[1]));
    else if (/^\s+\S/u.test(line) && criteria.length) criteria[criteria.length - 1] += ' ' + normalize(line);
    else fail('acceptance bullet list required');
  }
  if (sections !== 1 || !marker || !criteria.length || new Set(criteria).size !== criteria.length)
    fail('nonempty unambiguous acceptance list required');
  return criteria;
}

export function captureCriteria({ root, issue, attempt, issueFile }) {
  const file = stateFile(root, issue, attempt);
  const source = fs.realpathSync(issueFile), body = fs.readFileSync(source, 'utf8');
  const captured = { issue, attempt, source, source_digest: crypto.createHash('sha256').update(body).digest('hex'), criteria: acceptanceCriteria(body) };
  const existing = () => {
    const prior = readJson(file), { captured_at, ...content } = prior;
    if (digest(content) !== digest(captured)) fail('immutable start capture cannot be replaced');
    return prior;
  };
  if (fs.existsSync(file)) return existing();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o444);
    try { fs.writeFileSync(fd, JSON.stringify({ ...captured, captured_at: new Date().toISOString() }, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, file); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    return existing();
  } finally { fs.unlinkSync(temp); }
}

export function requireApprovedCriteria(report, root) {
  const file = stateFile(root, report.issue, report.attempt);
  if (!fs.existsSync(file)) fail('missing immutable delivery-start capture');
  const state = readJson(file);
  if (state.issue !== report.issue || state.attempt !== report.attempt || !path.isAbsolute(state.source ?? '') ||
      !/^[a-f0-9]{64}$/u.test(state.source_digest ?? '') || !Number.isFinite(Date.parse(state.captured_at)) ||
      !Array.isArray(state.criteria) || !state.criteria.length || state.criteria.some(c => typeof c !== 'string' || !c || normalize(c) !== c))
    fail('invalid delivery-start capture');
  const reported = report.criteria.map(item => normalize(item.criterion));
  if (reported.length !== state.criteria.length || reported.some((criterion, index) => criterion !== state.criteria[index]))
    fail('report must contain the full ordered approved criteria list');
}
