import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest, readJson } from './runtime.mjs';

const normalize = text => text.replace(/\s+/gu, ' ').trim();
const fail = detail => { throw new Error(`approved criteria: ${detail}`); };
function stateFile(root, issue, attempt) {
  if (typeof root !== 'string' || !root.trim() || root.includes('\0')) fail('delivery root must name a directory');
  root = path.resolve(root);
  if (fs.existsSync(root) && !fs.statSync(root).isDirectory()) fail('delivery root must be a directory');
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(issue ?? '')) fail('invalid issue key');
  if (!Number.isInteger(attempt) || attempt < 1) fail('attempt number must be a positive integer');
  return path.join(root, 'reports', `${issue}-criteria-a${attempt}.json`);
}

const acceptanceLabels = new Map([
  ['Критерии приемки', 'Готово, когда:'],
  ['Acceptance criteria', 'Done when:'],
]);

// Literal canonical Issue section; ambiguous/missing input stops capture rather
// than guessing a shorter acceptance list.
export function acceptanceCriteria(body) {
  const invalid = detail => fail(`${detail}; blocked; expected "# Критерии приемки" / "Готово, когда:" or "# Acceptance criteria" / "Done when:"`);
  let section = false, depth = 0, marker = false, fence = null, sections = 0, listIndent = null, expectedMarker;
  const criteria = [];
  for (const line of body.split(/\r?\n/u)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      if (section) invalid('fenced acceptance content is ambiguous');
      continue;
    }
    if (fence) continue;
    const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/u.exec(line);
    if (heading) {
      if (section && heading[1].length <= depth) section = false;
      if (acceptanceLabels.has(heading[2])) {
        if (++sections > 1) invalid('duplicate acceptance section');
        section = true; depth = heading[1].length; expectedMarker = acceptanceLabels.get(heading[2]);
      } else if (section) invalid('nested acceptance heading is ambiguous');
      continue;
    }
    if (!section || !line.trim()) continue;
    if (line.trim() === expectedMarker) {
      if (marker || criteria.length) invalid('duplicate acceptance marker');
      marker = true; continue;
    }
    if (!marker) invalid('canonical list marker required before acceptance bullets');
    const bullet = /^( {0,3})(?:[-*+]|\d+[.)])\s+(.+)$/u.exec(line);
    if (bullet && (listIndent === null || bullet[1].length === listIndent)) {
      listIndent = bullet[1].length;
      criteria.push(normalize(bullet[2]));
    } else if (bullet && bullet[1].length < listIndent) invalid('inconsistent acceptance list indentation');
    else if (/^\s+\S/u.test(line) && criteria.length) criteria[criteria.length - 1] += ' ' + normalize(line);
    else invalid('acceptance bullet list required');
  }
  if (sections !== 1 || !marker || !criteria.length || new Set(criteria).size !== criteria.length)
    invalid('nonempty unambiguous acceptance list required');
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

// The only exits that have no approved list are refusals before capture.
// A capture refusal is checked against its source, never a report-supplied list.
export function preCaptureStop(report) {
  const stop = report.pre_capture_stop;
  if (!stop || !Array.isArray(report.criteria) || report.criteria.length ||
      !['blocked', 'needs-human'].includes(report.phase_result) ||
      !['capture-refused', 'start-refused'].includes(stop.kind) ||
      !Number.isInteger(stop.exit) || stop.exit < 0 ||
      ![stop.command, stop.reason].every(value => typeof value === 'string' && value.trim())) return null;
  const expected_format = ['# Критерии приемки', 'Готово, когда:'];
  if (stop.kind === 'start-refused') return typeof stop.verdict === 'string' && stop.verdict.trim() &&
    (stop.exit !== 0 || stop.verdict !== 'pass') ? { reason: stop.reason, expected_format, missing_labels: [] } : null;
  if (report.phase_result !== 'blocked' || stop.exit === 0 || !path.isAbsolute(stop.issue_file ?? '')) return null;
  const body = fs.readFileSync(stop.issue_file, 'utf8');
  try { acceptanceCriteria(body); } catch (error) {
    return { reason: `${stop.reason}; ${error.message}`, expected_format,
      missing_labels: expected_format.filter(label => !body.split(/\r?\n/u).some(line => line.trim() === label)) };
  }
  return null;
}

export function requireApprovedCriteria(report, root) {
  const file = stateFile(root, report.issue, report.attempt);
  if (!fs.existsSync(file)) {
    if (preCaptureStop(report)) return;
    fail('missing immutable delivery-start capture');
  }
  if (report.pre_capture_stop) fail('pre-capture stop cannot replace an existing approved list');
  const state = readJson(file);
  if (state.issue !== report.issue || state.attempt !== report.attempt || !path.isAbsolute(state.source ?? '') ||
      !/^[a-f0-9]{64}$/u.test(state.source_digest ?? '') || !Number.isFinite(Date.parse(state.captured_at)) ||
      !Array.isArray(state.criteria) || !state.criteria.length || state.criteria.some(c => typeof c !== 'string' || !c || normalize(c) !== c))
    fail('invalid delivery-start capture');
  const reported = report.criteria.map(item => normalize(item.criterion));
  if (reported.length !== state.criteria.length || reported.some((criterion, index) => criterion !== state.criteria[index]))
    fail('report must contain the full ordered approved criteria list');
}
