#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest, isMain, resolveRole } from './runtime.mjs';

export const IDEA_GATE_DEFAULT_SINCE = '2026-10-18';
export const RESEARCH_GATE_DEFAULT_SINCE = '2026-10-19';
const DEFAULT_HEADINGS = {
  ru: { what: 'Что', why: 'Зачем', outcome: 'Образ результата', unknowns: 'Неизвестные' },
  en: { what: 'What', why: 'Why', outcome: 'Target outcome', unknowns: 'Unknowns' },
};
const KEYS = ['what', 'why', 'outcome', 'unknowns'];
const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code) { throw Object.assign(new Error(code), { code }); }

function date(value, cutoff = false) {
  if (typeof value !== 'string' || !(cutoff ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/).test(value)) return NaN;
  const day = value.slice(0, 10), time = Date.parse(day);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day) return NaN;
  if (!cutoff && (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59)) return NaN;
  return Date.parse(value);
}

function headingDictionary(headings = 'ru') {
  const language = { Russian: 'ru', English: 'en' }[headings] ?? headings;
  const dictionary = typeof language === 'string' ? DEFAULT_HEADINGS[language] : language;
  if (!object(dictionary) || Object.keys(dictionary).length !== 4 ||
      KEYS.some(key => typeof dictionary[key] !== 'string' || !dictionary[key] || dictionary[key] !== dictionary[key].trim() || /[\r\n]/.test(dictionary[key])) ||
      new Set(Object.values(dictionary)).size !== 4) fail('read-failed');
  return dictionary;
}

export function validateIdeaGate(config) {
  if (config === undefined) return;
  if (!object(config) || Object.keys(config).some(key => !['since', 'headings'].includes(key))) throw new Error('ideaGate must contain only since and headings');
  if ('since' in config && !Number.isFinite(date(config.since, true))) throw Object.assign(new Error('ideaGate.since must be a valid YYYY-MM-DD date'), { code: 'bad-since' });
  if ('headings' in config) {
    try {
      if (!object(config.headings)) fail('read-failed');
      headingDictionary(config.headings);
    } catch { throw new Error('ideaGate.headings must define four distinct headings: what, why, outcome, unknowns'); }
  }
}

export function validateResearchGate(config) {
  if (config === undefined) return;
  if (!object(config) || Object.keys(config).some(key => key !== 'since')) throw new Error('researchGate must contain only since');
  if ('since' in config && !Number.isFinite(date(config.since, true)))
    throw Object.assign(new Error('researchGate.since must be a valid YYYY-MM-DD date'), { code: 'bad-since' });
}

export function checkResearch({ ideaVerdict, issueContext, project, document, approval, approvalBody,
  since = RESEARCH_GATE_DEFAULT_SINCE } = {}) {
  const result = code => ({ ok: ['pass', 'not-required', 'issue-only', 'legacy-before-cutoff'].includes(code),
    code, documentId: document?.id ?? null });
  if (!ideaVerdict?.ok) return result('read-failed');
  if (ideaVerdict.code === 'issue-only')
    return result(!project && !issueContext?.projectId ? 'issue-only' : 'research-other-project');
  if (!Number.isFinite(date(since, true))) return result('bad-since');
  if (!uuid(project?.id) || issueContext?.projectId !== project.id || !Number.isFinite(date(approval?.createdAt)))
    return result('read-failed');
  if (date(approval.createdAt) < date(since, true)) return result('legacy-before-cutoff');
  if (!document) return result('research-missing');
  if (!object(document) || typeof document.id !== 'string' || !document.id ||
      typeof document.url !== 'string' || !document.url || typeof document.body !== 'string' ||
      typeof approvalBody !== 'string') return result('read-failed');
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idReference = new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(document.id)}(?![\\p{L}\\p{N}_-])`, 'u');
  const urlReference = new RegExp(`(^|[\\s<>"'=(\\[])${escape(document.url)}(?=$|[\\s<>"')\\],;]|\\.(?:\\s|$))`, 'u');
  if (!idReference.test(approvalBody) && !urlReference.test(approvalBody)) return result('research-not-referenced');
  if (document.projectId !== project.id) return result('research-other-project');
  try {
    const fences = blocks(document.body).filter(block => block.info === 'mono-research');
    if (fences.length !== 1) return result('research-bad-record');
    const record = JSON.parse(fences[0].content);
    if (!object(record) || !uuid(record.project) || !['ready', 'hold', 'not-required'].includes(record.outcome) ||
        (['hold', 'not-required'].includes(record.outcome) && (typeof record.reason !== 'string' || !record.reason.trim())))
      return result('research-bad-record');
    if (record.project !== project.id) return result('research-other-project');
    return result(record.outcome === 'not-required' ? 'not-required' : 'pass');
  } catch { return result('research-bad-record'); }
}

// The exemptions are decided before touching research/. Dispatch supplies its
// already checked Idea verdict; the CLI obtains the same verdict from the snapshot.
export function checkResearchSnapshot(snapshot, config = {}, ideaVerdict) {
  let projectId = null;
  try {
    const project = optionalJson(path.join(snapshot, 'idea/project.json'));
    const issueContext = optionalJson(path.join(snapshot, 'issue-context.json'));
    projectId = project?.id ?? issueContext?.projectId ?? null;
    validateResearchGate(config.researchGate);
    const approval = optionalJson(path.join(snapshot, 'approval.json'));
    let approvalBody;
    if (!ideaVerdict) {
      const lane = optionalJson(path.join(snapshot, 'issue-only.json'));
      approvalBody = approval ? fs.readFileSync(path.join(snapshot, 'approval.md'), 'utf8') : undefined;
      ideaVerdict = checkIdea({ mode: 'approved', project, issueContext, issueOnlySeam: lane?.seam,
        approval: approval ? { ...approval, body: approvalBody } : undefined,
        records: project ? readJson(path.join(snapshot, 'idea/idea-records.json')) : undefined,
        since: config.ideaGate?.since, headings: config.ideaGate?.headings });
    }
    const input = { ideaVerdict, project, issueContext, approval,
      since: config.researchGate?.since === undefined ? RESEARCH_GATE_DEFAULT_SINCE : config.researchGate.since };
    const exempt = checkResearch(input);
    if (exempt.code !== 'research-missing') return { ...exempt, projectId };
    const metadata = optionalJson(path.join(snapshot, 'research/document.json'));
    const document = metadata === undefined ? undefined : { ...metadata, body: fs.readFileSync(path.join(snapshot, 'research/document.md'), 'utf8') };
    const result = checkResearch({ ...input, document,
      approvalBody: approvalBody ?? fs.readFileSync(path.join(snapshot, 'approval.md'), 'utf8') });
    return { ...result, projectId };
  } catch (error) {
    return { ok: false, code: error.code === 'bad-since' ? 'bad-since' : 'read-failed', documentId: null, projectId };
  }
}

// Fences are opaque, including their whitespace. Only top-level ordinary lines
// can declare sections; the same scanner extracts the comment's snapshot fence.
function blocks(markdown) {
  if (typeof markdown !== 'string') fail('read-failed');
  const lines = markdown.split('\n'), result = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^ {0,3}(`{3,}|~{3,})([^\r]*)\r?$/);
    if (!open || (open[1][0] === '`' && open[2].includes('`'))) {
      result.push({ text: lines[i], fenced: false }); continue;
    }
    const fence = open[1], start = i, content = [];
    for (i++; i < lines.length; i++) {
      const close = lines[i].match(/^ {0,3}(`+|~+)[ \t]*\r?$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break;
      content.push(lines[i]);
    }
    if (i === lines.length) fail('unsupported-format');
    result.push({ text: lines.slice(start, i + 1).join('\n'), fenced: true, info: open[2].trim(), content: content.join('\n') });
  }
  return result;
}

function ordinary(text) {
  const sourceLines = text.split('\n');
  // Block structure uses source lines, before inline spans can hide markers or
  // introduce synthetic whitespace. Fences and headings were handled by blocks/sections.
  for (const raw of sourceLines) {
    if (/^(?: {2,}|[ \t]*\t[ \t]*)(?:[*+-]|\d+[.)])[ \t]+/.test(raw)) fail('unsupported-format');
    if (raw.includes('|')) {
      const cells = raw.trim().replace(/^\||\|$/g, '').split('|');
      if (cells.every(cell => /^\s*:?-+:?\s*$/.test(cell))) fail('unsupported-format');
    }
  }
  const lines = [{ parts: [], literal: false }];
  function append(value, literal = false) {
    const pieces = value.split('\n');
    for (const [index, piece] of pieces.entries()) {
      if (index) lines.push({ parts: [], literal });
      const line = lines.at(-1);
      line.parts.push({ text: piece, literal });
      line.literal ||= literal;
    }
  }
  for (let i = 0; i < text.length;) {
    if (text[i] === '`') {
      const run = text.slice(i).match(/^`+/)[0];
      let end = i + run.length;
      while ((end = text.indexOf(run, end)) !== -1) {
        if (text[end - 1] !== '`' && text[end + run.length] !== '`') break;
        end += run.length;
      }
      if (end !== -1) {
        const span = text.slice(i, end + run.length);
        if (span.includes('\n')) fail('unsupported-format');
        append(span, true); i = end + run.length; continue;
      }
      append(run); i += run.length;
    } else if (text[i] === '\\' && text[i + 1] && /[\\`*\[\]_#>]/.test(text[i + 1])) {
      const next = text[i + 1];
      append(/[*\[\]_#>]/.test(next) ? next : text.slice(i, i + 2)); i += 2;
    } else { append(text[i++]); }
  }
  let inList = false;
  return lines.map((line, index) => {
    const raw = sourceLines[index];
    while (line.parts.length && !line.parts.at(-1).literal) {
      const last = line.parts.at(-1);
      last.text = last.text.replace(/[ \t\r]+$/, '');
      if (last.text) break;
      line.parts.pop();
    }
    let value = line.parts.map(part => part.text).join('');
    const list = /^(?:[*+-]|\d+[.)])[ \t]+/.test(raw) ||
      (inList && /^(?: {2,}|\t)\S/.test(raw) && !line.parts[0]?.literal);
    if (value) inList = list;
    if (/^[*+-][ \t]+/.test(raw)) value = value.replace(/^[*+-][ \t]+/, '* ');
    return { text: value, list, literal: line.literal };
  });
}

function sections(markdown, headings, requireUnknowns = true, rejectOutside = false) {
  const dictionary = headingDictionary(headings), found = {}, required = requireUnknowns ? KEYS : KEYS.slice(0, 3);
  let current = null;
  for (const block of blocks(markdown)) {
    const heading = !block.fenced && block.text.match(/^##[ \t]+(.+?)[ \t]*\r?$/);
    if (rejectOutside && !block.fenced && !heading && /^ {0,3}##(?:[ \t]|\r?$)/.test(block.text)) fail('unsupported-format');
    if (heading) {
      current = KEYS.find(key => dictionary[key] === heading[1]) ?? null;
      if (rejectOutside && !current) fail('unsupported-format');
      if (current) {
        if (found[current]) fail('duplicate-heading');
        found[current] = [];
      }
    } else if (current) found[current].push(block);
    else if (rejectOutside && block.text.trim()) fail('unsupported-format');
  }
  if (required.some(key => !found[key])) fail('missing-heading');
  return found;
}

function normalized(section) {
  const lines = [];
  let prose = [];
  const flush = () => { if (prose.length) lines.push(...ordinary(prose.join('\n'))); prose = []; };
  for (const block of section) {
    if (block.fenced) { flush(); lines.push({ text: block.text, list: false, literal: true }); }
    else prose.push(block.text);
  }
  flush();
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text !== '' || lines[i].literal) { result.push(lines[i]); continue; }
    let next = i + 1;
    while (next < lines.length && lines[next].text === '' && !lines[next].literal) next++;
    if (result.length && next < lines.length && !(result.at(-1).list && lines[next].list)) result.push({ text: '', list: false });
    i = next - 1;
  }
  return result.map(line => line.text).join('\n');
}

function fingerprintSections(found, headings) {
  const dictionary = headingDictionary(headings);
  return sha256(KEYS.map(key => `## ${dictionary[key]}\n\n${normalized(found[key])}`).join('\n\n'));
}

export function ideaFingerprint(markdown, headings = 'ru') {
  return fingerprintSections(sections(markdown, headings), headings);
}

function verdict(code, projectId = null, recordId = null, fingerprint = null) {
  return { ok: ['pass', 'legacy-before-cutoff', 'legacy-migrate', 'issue-only'].includes(code), code,
    projectId, recordId, fingerprint, digest: digest({ projectId, recordId, fingerprint, code }) };
}

function approvedRecord(comment, projectId, headings) {
  const parsed = blocks(comment.body);
  const markerText = parsed.filter(block => block.info !== 'mono-idea-snapshot').map(block => block.fenced ? block.content : block.text).join('\n');
  const markers = markerText.split(/\r?\n/).filter(line => line.startsWith('mono-idea:'));
  const snapshots = parsed.filter(block => block.info === 'mono-idea-snapshot');
  if (!markers.length && !snapshots.length) return null;
  if (markers.length !== 1 || snapshots.length !== 1) fail('bad-record');
  const match = markers[0].match(/^mono-idea: approved project=([a-f0-9-]+) sha256=([a-f0-9]{64})$/);
  if (!match || !uuid(match[1])) fail('bad-record');
  if (match[1] !== projectId) fail('other-project');
  const found = sections(snapshots[0].content, headings);
  const fingerprint = fingerprintSections(found, headings);
  if (fingerprint !== match[2]) fail('bad-record');
  return { recordId: comment.id, fingerprint, found };
}

export function checkIdea({ mode, project, records, approval, since = IDEA_GATE_DEFAULT_SINCE, headings, issueOnlySeam, issueContext } = {}) {
  const projectId = typeof project?.id === 'string' ? project.id : null;
  if (!Number.isFinite(date(since, true))) return verdict('bad-since', projectId);
  try {
    if (!['fresh', 'approved'].includes(mode)) fail('read-failed');
    if (issueOnlySeam !== undefined) {
      if (project || (issueContext && issueContext.projectId !== null)) fail('other-project');
      return verdict(issueOnlySeam?.package_kind === 'issue-only' && issueOnlySeam?.lifecycle_state_entity === 'issue' &&
        issueOnlySeam?.approval_status === 'approved-fresh' ? 'issue-only' : 'no-record');
    }
    if (!object(project) || !uuid(project.id) || !Number.isFinite(date(project.createdAt)) ||
        typeof project.body !== 'string' || typeof project.status !== 'string' || typeof project.language !== 'string' ||
        !object(records) || records.complete !== true || !Array.isArray(records.comments)) fail('read-failed');
    headings = headingDictionary(headings ?? project.language);
    if (issueContext && issueContext.projectId !== project.id) fail('other-project');
    const ids = new Set();
    for (const comment of records.comments) {
      if (!object(comment) || typeof comment.id !== 'string' || !comment.id || ids.has(comment.id) ||
          !Number.isFinite(date(comment.createdAt)) || typeof comment.body !== 'string') fail('read-failed');
      ids.add(comment.id);
    }
    if (approval !== undefined) {
      if (!object(approval) || typeof approval.commentId !== 'string' || !Number.isFinite(date(approval.createdAt)) ||
          typeof approval.body !== 'string' || !/^[a-f0-9]{64}$/.test(approval.bodySha256 ?? '')) fail('read-failed');
      const comment = records.comments.find(comment => comment.id === approval.commentId);
      if (!comment || comment.createdAt !== approval.createdAt) fail('other-project');
      if (sha256(approval.body) !== approval.bodySha256 || sha256(comment.body) !== approval.bodySha256) fail('read-failed');
    }
    if (mode === 'approved' && date(project.createdAt) < date(since, true) && approval && date(approval.createdAt) < date(since, true))
      return verdict('legacy-before-cutoff', projectId);
    let selected = null, error = null;
    const comments = [...records.comments].sort((a, b) => date(b.createdAt) - date(a.createdAt));
    for (const comment of comments) {
      if (!comment.body.includes('mono-idea:') && !comment.body.includes('mono-idea-snapshot')) continue;
      try {
        selected = approvedRecord(comment, projectId, headings);
        if (selected) break;
      } catch (failure) { error ??= failure.code; }
    }
    if (!selected) return verdict(error ?? (mode === 'fresh' && date(project.createdAt) < date(since, true) ? 'legacy-migrate' : 'no-record'), projectId);
    if (mode === 'fresh') {
      const live = sections(project.body, headings, false);
      live.unknowns = selected.found.unknowns;
      if (fingerprintSections(live, headings) !== selected.fingerprint) return verdict('stale', projectId, selected.recordId, selected.fingerprint);
    }
    return verdict('pass', projectId, selected.recordId, selected.fingerprint);
  } catch (error) {
    return verdict(['other-project', 'missing-heading', 'duplicate-heading', 'unsupported-format', 'read-failed'].includes(error.code) ? error.code : 'read-failed', projectId);
  }
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function optionalJson(file) { return fs.existsSync(file) ? readJson(file) : undefined; }

function configuredHeadings(config) {
  return headingDictionary(config.ideaGate?.headings ?? config.languages?.linear ?? 'ru');
}

function recordIdea(options, config) {
  if (!options['--draft'] || !options['--out'] || !options['--config'] ||
      (options['--notes'] && !options['--project'])) fail('read-failed');
  const draft = fs.readFileSync(options['--draft'], 'utf8'), headings = configuredHeadings(config);
  const found = sections(draft, headings, true, true), fingerprint = ideaFingerprint(draft, headings);
  const body = KEYS.slice(0, 3).map(key => {
    const content = [...found[key]];
    while (content.length && !content.at(-1).fenced && /^\r?$/.test(content.at(-1).text)) content.pop();
    return `## ${headings[key]}\n${content.map(block => block.text).join('\n')}`;
  }).join('\n\n') + '\n';
  let comment;
  if (options['--project']) {
    if (!uuid(options['--project'])) fail('read-failed');
    const notes = options['--notes'] ? fs.readFileSync(options['--notes'], 'utf8') : '';
    const runs = [...draft.matchAll(/`+/g)].map(match => match[0].length);
    const fence = '`'.repeat(Math.max(3, ...runs.map(length => length + 1)));
    comment = `\`\`\`text\nmono-idea: approved project=${options['--project']} sha256=${fingerprint}\n\`\`\`\n\n` +
      `${fence}mono-idea-snapshot\n${draft}\n${fence}\n\n## Заметки для Research и Handoff\n\n${notes}`;
    // Notes are outside the fingerprint, but cannot introduce another record.
    approvedRecord({ id: 'record', body: comment }, options['--project'], headings);
  }
  fs.mkdirSync(options['--out'], { recursive: true });
  fs.writeFileSync(path.join(options['--out'], 'body.md'), body);
  if (comment !== undefined) fs.writeFileSync(path.join(options['--out'], 'comment.md'), comment);
  console.log(JSON.stringify({ body: path.join(options['--out'], 'body.md'),
    ...(comment !== undefined ? { comment: path.join(options['--out'], 'comment.md') } : {}), fingerprint }));
}

function readDump(root, raw, config) {
  if (!object(raw) || !uuid(raw.uuid)) fail('read-failed');
  const headings = configuredHeadings(config);
  const project = { id: raw.uuid, createdAt: raw.createdAt, status: raw.status?.name,
    body: raw.description, language: 'custom' };
  const files = fs.readdirSync(root).filter(name => /^comments-.*\.json$/.test(name));
  const pages = files.filter(name => /^comments-[1-9]\d*\.json$/.test(name));
  if (!pages.length || files.length !== pages.length * 2 ||
      files.some(name => !/^comments-[1-9]\d*(?:\.request)?\.json$/.test(name))) fail('read-failed');
  const comments = [], ids = new Set();
  let previousUpdatedAt = Infinity, previousCursor;
  for (let n = 1; n <= pages.length; n++) {
    const request = readJson(path.join(root, `comments-${n}.request.json`));
    if (!object(request) || (n === 1 ? Object.keys(request).length !== 0 :
      Object.keys(request).length !== 1 || !Object.hasOwn(request, 'cursor') || request.cursor !== previousCursor)) fail('read-failed');
    const page = readJson(path.join(root, `comments-${n}.json`));
    if (!object(page) || !Array.isArray(page.comments) || typeof page.hasNextPage !== 'boolean' ||
        page.hasNextPage !== (n < pages.length) ||
        (page.hasNextPage ? !page.comments.length || page.cursor !== page.comments.at(-1)?.id : Object.hasOwn(page, 'cursor'))) fail('read-failed');
    previousCursor = page.cursor;
    for (const item of page.comments) {
      if (!object(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
          typeof item.body !== 'string' || !Number.isFinite(date(item.createdAt)) ||
          !Number.isFinite(date(item.updatedAt)) || date(item.updatedAt) > previousUpdatedAt) fail('read-failed');
      previousUpdatedAt = date(item.updatedAt);
      ids.add(item.id);
      comments.push({ id: item.id, createdAt: item.createdAt, body: item.body });
    }
  }
  return { project, records: { complete: true, comments }, headings };
}

function verifyDump(options, config) {
  const projectId = options['--project'];
  if (!uuid(projectId) || !options['--dump'] || !options['--expect'] || !options['--config']) fail('read-failed');
  const raw = readJson(path.join(options['--dump'], 'project.json'));
  if (!object(raw) || !uuid(raw.uuid)) fail('read-failed');
  if (raw.uuid !== projectId) return verdict('other-project', projectId);
  const { project, records, headings } = readDump(options['--dump'], raw, config);
  const comments = records.comments;
  const expected = fs.readFileSync(options['--expect'], 'utf8');
  const matches = comments.filter(comment => comment.body === expected);
  if (!matches.length) return verdict('no-record', projectId);
  if (matches.length !== 1) fail('read-failed');
  // Select the byte-identical comment explicitly: fresh must not pick another
  // approval or accept the legacy migration exception for a missing new write.
  return checkIdea({ mode: 'fresh', project, records: { complete: true, comments: matches },
    headings, since: config.ideaGate?.since ?? IDEA_GATE_DEFAULT_SINCE });
}

const VERIFY_REASONS = {
  'no-record': 'комментарий из --expect не найден; прочитайте запись и все страницы комментариев заново',
  'other-project': 'проект или запись относятся к другому проекту; проверьте UUID и ответы Linear',
  'bad-record': 'запись повреждена; подготовьте и опубликуйте комментарий заново через record',
  'missing-heading': 'нет нужного заголовка второго уровня; проверьте язык и одобренную версию',
  'duplicate-heading': 'заголовок повторён; устраните повтор и проверьте одобренную версию',
  'unsupported-format': 'формат текста не поддерживается; оставьте четыре раздела без текста вне них, таблиц и вложенных списков',
  'bad-since': 'в пакете не задана корректная дата начала проверки; исправьте установку или настройку',
  'read-failed': 'ответы Linear, страницы или настройки неполны либо повреждены; сохраните проект и все страницы заново',
};
function authoringMain(argv) {
  const command = argv.shift(), options = {};
  let result;
  try {
    const allowed = { record: ['--project', '--draft', '--notes', '--config', '--out'],
      verify: ['--project', '--dump', '--expect', '--config'], helper: ['--host', '--config'] }[command];
    while (argv.length) {
      const key = argv.shift();
      if (!allowed.includes(key) || key in options || !argv.length || argv[0].startsWith('--')) fail('read-failed');
      options[key] = argv.shift();
    }
    const config = options['--config'] ? readJson(options['--config']) : {};
    validateIdeaGate(config.ideaGate);
    if (command === 'record') return recordIdea(options, config);
    if (command === 'helper') {
      if (!['claude-code', 'codex'].includes(options['--host'])) fail('read-failed');
      console.log(JSON.stringify(resolveRole('scout', config, { host: options['--host'], packRoot: path.resolve(import.meta.dirname, '..') })));
      return;
    }
    result = verifyDump(options, config);
  } catch (error) {
    result = verdict(['bad-since', 'other-project', 'bad-record', 'missing-heading', 'duplicate-heading', 'unsupported-format'].includes(error.code)
      ? error.code : 'read-failed', options['--project'] ?? null);
  }
  const pass = result.code === 'pass';
  if (['record', 'verify'].includes(command)) {
    console.log(pass ? 'Готово' : result.code === 'stale' ? 'Нужно новое «да»: тело проекта изменилось; покажите владельцу текущую версию'
      : `Стоп: ${VERIFY_REASONS[result.code] ?? VERIFY_REASONS['read-failed']}`);
    console.log(JSON.stringify(result));
  } else console.log(`idea-gate: fail: ${result.code} project=${result.projectId}`);
  process.exitCode = pass ? 0 : 1;
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(`Usage: idea-gate.mjs record --draft APPROVED --config CONFIG --out DIR [--project UUID] [--notes NOTES]
       idea-gate.mjs verify --project UUID --dump DIR --expect COMMENT --config CONFIG
       idea-gate.mjs helper --host claude-code|codex [--config CONFIG]
       idea-gate.mjs check --mode fresh --dump DIR --config CONFIG
       idea-gate.mjs check --mode fresh|approved --snapshot DIR [--config CONFIG]
       idea-gate.mjs research --snapshot DIR [--config CONFIG]
       idea-gate.mjs fingerprint --snapshot FILE [--config CONFIG]
Dump: project.json and comments-N.json are raw Linear responses (N=1,2,...).
Each response needs comments-N.request.json: {} for page 1, {"cursor":"previous response cursor"} thereafter.
Save the actual request cursor; the final response has hasNextPage=false and no cursor.
record refuses unrecognized sections or text outside the four sections before writing files.`);
    return;
  }
  if (['record', 'verify', 'helper'].includes(argv[0])) return authoringMain(argv);
  const research = argv[0] === 'research';
  let projectId = null, result;
  try {
    const command = argv.shift(), options = {};
    while (argv.length) {
      const key = argv.shift();
      if (!['--mode', '--snapshot', '--dump', '--config'].includes(key) || key in options || !argv.length) fail('read-failed');
      options[key] = argv.shift();
    }
    if (research) {
      if (!options['--snapshot'] || options['--dump'] || options['--mode']) fail('read-failed');
      result = checkResearchSnapshot(options['--snapshot'], options['--config'] ? readJson(options['--config']) : {});
      console.log(`research-gate: ${result.ok ? 'pass' : 'fail'}: ${result.code} project=${result.projectId}`);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    if (Boolean(options['--snapshot']) === Boolean(options['--dump'])) fail('read-failed');
    const snapshot = options['--snapshot'];
    const raw = options['--dump'] ? readJson(path.join(options['--dump'], 'project.json')) : undefined;
    const project = command === 'check' && snapshot ? optionalJson(path.join(snapshot, 'idea/project.json')) : undefined;
    projectId = raw?.uuid ?? project?.id ?? null;
    if (options['--dump'] && (command !== 'check' || options['--mode'] !== 'fresh' || !options['--config'])) fail('read-failed');
    const config = options['--config'] ? readJson(options['--config']) : {};
    try { validateIdeaGate(config.ideaGate); } catch (error) {
      fail(error.code === 'bad-since' ? 'bad-since' : 'read-failed');
    }
    if (command === 'fingerprint') {
      const language = { Russian: 'ru', English: 'en' }[config.languages?.linear] ?? 'ru';
      result = verdict('pass', null, null, ideaFingerprint(fs.readFileSync(snapshot, 'utf8'), config.ideaGate?.headings ?? language));
    } else if (command === 'check') {
      const since = config.ideaGate?.since ?? IDEA_GATE_DEFAULT_SINCE;
      // Before release a configured cutoff is required even on the projectless lane.
      if (!Number.isFinite(date(since, true))) fail('bad-since');
      if (options['--dump']) {
        const input = readDump(options['--dump'], raw, config);
        result = checkIdea({ ...input, mode: 'fresh', since });
      } else {
        const lane = optionalJson(path.join(snapshot, 'issue-only.json'));
        const approval = optionalJson(path.join(snapshot, 'approval.json'));
        if (approval !== undefined) approval.body = fs.readFileSync(path.join(snapshot, 'approval.md'), 'utf8');
        result = checkIdea({ mode: options['--mode'], project, since,
          records: project ? readJson(path.join(snapshot, 'idea/idea-records.json')) : undefined,
          approval, headings: config.ideaGate?.headings ?? (config.languages?.linear ? configuredHeadings(config) : undefined), issueOnlySeam: lane?.seam,
          issueContext: optionalJson(path.join(snapshot, 'issue-context.json')) });
      }
    } else fail('read-failed');
  } catch (error) {
    result = verdict(['bad-since', 'missing-heading', 'duplicate-heading', 'unsupported-format'].includes(error.code) ? error.code : 'read-failed', projectId);
  }
  console.log(`${research ? 'research-gate' : 'idea-gate'}: ${result.ok ? 'pass' : 'fail'}: ${result.code} project=${result.projectId}`);
  if (result.ok) console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
