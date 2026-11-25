// What a pass publishes and how (U9, U10): the text guard, the write plan
// runs/<uuid>/plan.json, its operations with markers, reconciliation after a
// lost answer, the commit that moves the boundary, and the summary.
// Scripts never call Linear: the session performs each operation through
// Linear MCP, saves the answer under the pass folder and reports it here.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  AuditError, compareTags, isFile, isoNow, readJson, readQueue, readState, TagIndex,
} from "./lib.mjs";
import { cost, setup } from "./commands.mjs";
import { METRICS, normalizeSpace, passInput, readRegistry, runFile, withPass } from "./review.mjs";

const OP_TYPES = ["create-document", "update-document", "create-issue", "update-issue", "create-comment"];
const RECREATE_SAFE = new Set(["update-document", "update-issue"]);

export function marker(passUuid, key) {
  return `session-audit op=${passUuid}/${key}`;
}

// ---------------------------------------------------------------- guard

export function words(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function grams(list, size) {
  const result = [];
  for (let i = 0; i + size <= list.length; i += 1) result.push(list.slice(i, i + size).join(" "));
  return result;
}

function walk(dir, visit) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(child, visit);
    else if (entry.isFile()) visit(child);
  }
}

// Eight-word sequences of the digests of the given passes, and the quotes
// of their findings: the additional check of U9.
export function privateTexts(dataRoot, passes, size) {
  const sequences = new Set();
  const quotes = new Set();
  for (const pass of new Set(passes)) {
    walk(path.join(dataRoot, "runs", pass, "extract"), (file) => {
      if (!file.endsWith(".md")) return;
      for (const gram of grams(words(fs.readFileSync(file, "utf8")), size)) sequences.add(gram);
    });
    walk(path.join(dataRoot, "runs", pass, "checked"), (file) => {
      if (!file.endsWith(".json")) return;
      try { const quote = readJson(file).quote; if (quote) quotes.add(quote); } catch { /* skip */ }
    });
  }
  return { sequences, quotes: [...quotes] };
}

// Allowed links: Linear issue, document and project pages and the mono
// repository on GitHub, without query or fragment (config regexes).
function linkAllowed(url, patterns) {
  if (/[?#]/.test(url)) return false;
  return patterns.some((pattern) => new RegExp(pattern).test(url));
}

// Shapes of personal data and credentials that never go to Linear.
const SECRET_SHAPES = [
  ["e-mail address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/],
  ["credential assignment", /["']?\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|authorization)\b["']?\s*[:=]\s*["']?[^\s"']+/i],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i],
  ["provider key", /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/],
  ["GitHub token", /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/],
  ["Slack token", /\bxox[abpors]-[A-Za-z0-9-]{10,}/],
  ["AWS key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Linear key", /\blin_(?:api|oauth)_[A-Za-z0-9]{20,}/],
  ["JSON web token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

function secretProblems(text, passUuid) {
  const problems = [];
  for (const [name, shape] of SECRET_SHAPES) if (shape.test(text)) problems.push(`looks like a ${name}`);
  // Long hex or base64 runs, after the pass's own uuid-based ids are removed.
  const rest = text
    .replace(/https?:\/\/[^\s)>\]»"']+/g, " ")
    .replace(/\bF-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, " ")
    .replace(new RegExp(`op=${passUuid}/[A-Za-z0-9._-]+`, "g"), " ");
  if (/\b[0-9a-fA-F]{32,}\b/.test(rest)) problems.push("long hex string (possible secret)");
  for (const run of rest.match(/[A-Za-z0-9+/_-]{32,}={0,2}/g) || []) {
    if (/[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run)) { problems.push("long base64 string (possible secret)"); break; }
  }
  return problems;
}

function containsWords(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

// Problems of a text bound for Linear; an empty list means it may be sent.
export function guardText(text, { passUuid, pointers = [], config, privateSet }) {
  const rules = config.publish;
  const problems = [];
  const fence = /```session-audit\n[\s\S]*?\n```/g;
  const outside = text.replace(fence, "");
  if (/```/.test(outside)) problems.push("code fence other than the session-audit fence");
  if (/^\s*>/m.test(text)) problems.push("quoted block");
  for (const url of text.match(/https?:\/\/[^\s)>\]»"']+/g) || []) {
    if (!linkAllowed(url, rules.allowedLinks)) problems.push(`link outside Linear and mono: ${url}`);
  }
  const noLinks = text.replace(/https?:\/\/[^\s)>\]»"']+/g, " ");
  const allowedPaths = new Set(pointers);
  for (const token of noLinks.match(/[^\s«»"'(),;]*\/[^\s«»"'(),;]*/g) || []) {
    const clean = token.replace(/[.:]+$/, "");
    if (allowedPaths.has(clean)) continue;
    if (new RegExp(`^op=${passUuid}/[A-Za-z0-9._-]+$`).test(clean)) continue;
    problems.push(`path other than the pointer: ${clean}`);
  }
  if (/(^|[\s(«"'])~[\\/]/.test(noLinks) || /[A-Za-z]:\\/.test(noLinks)) problems.push("home or drive path");
  for (const key of text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || []) {
    if (!key.startsWith(`${rules.ownKeyPrefix}-`)) problems.push(`issue key of another team: ${key}`);
  }
  problems.push(...secretProblems(text, passUuid));
  // Every published word counts, the fence included.
  const all = words(text);
  for (const [i, gram] of grams(all, rules.overlapWords).entries()) {
    if (privateSet.sequences.has(gram)) { problems.push(`${rules.overlapWords} words in a row match a session digest (word ${i + 1})`); break; }
  }
  // A stored quote of any length, as a run of whole words.
  for (const quote of privateSet.quotes) {
    if (containsWords(all, words(quote))) { problems.push("contains a stored finding quote"); break; }
  }
  return [...new Set(problems)];
}


// Opened sessions (signal sessions and the sample) by product, kind and version.
export function openedBreakdown(map, signals, opened) {
  const ids = new Set(opened?.sessions || []);
  for (const signal of signals?.signals || []) {
    if ((opened?.signals || []).includes(signal.id) && signal.session) ids.add(signal.session);
  }
  const byProduct = {}, byKind = {}, byVersion = {};
  const add = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
  for (const id of ids) {
    const session = map.sessions.find((candidate) => candidate.id === id)
      || (signals?.signals || []).find((signal) => signal.session === id)?.sessionRef;
    if (!session) continue;
    add(byProduct, session.product || "unknown");
    add(byKind, session.kind || "unknown");
    for (const key of new Set((session.loads || []).map((load) => (load.version?.status === "confirmed" ? load.version.range : "unconfirmed")))) add(byVersion, key);
  }
  return { sessions: ids.size, byProduct, byKind, byVersion };
}

// ---------------------------------------------------------------- render

const KIND_RU = { broken: "сломалось или нарушено правило", intervention: "вмешательство", guess: "догадка", "time-loss": "потеря времени", simplify: "можно упростить" };
const METRIC_RU = { stops: "остановки", interventions: "вмешательства", extraRounds: "лишние круги ревью", minutes: "минуты" };
const MARK_RU = { measured: "измерено", estimate: "оценка", unknown: "неизвестно" };
const OUTCOME_RU = {
  new: "новая", "repeat-report": "повтор находки из отчёта", "queued-again": "повтор находки из очереди",
  "repeat-open": "повтор открытой задачи", rejected: "отклонено раньше", "repeat-fix-unknown": "повтор, версия исправления неизвестна",
  returned: "вернулось", "repeat-before-fix": "повтор на версии до исправления", "repeat-version-ambiguous": "повтор, версия неоднозначна",
};
const ROW_RU = {
  "already-changed": "Уже изменено", product: "О продукте", host: "О хосте", "needs-owner": "Нужно подтверждение владельца",
  "owner-declined": "Владелец не подтвердил", "report-only": "Только в отчёте", rejected: "Отклонённые раньше",
  "repeat-open": "Повторы открытых задач", "repeat-fix-unknown": "Повторы, версия исправления неизвестна",
  "repeat-before-fix": "Повторы до исправления", "repeat-version-ambiguous": "Повторы, версия неоднозначна",
};

export function ruDate(iso) {
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

function costText(costs) {
  return METRICS.map((metric) => {
    const entry = costs?.[metric] || { value: null, mark: "unknown" };
    return entry.mark === "unknown" || entry.value === null ? `${METRIC_RU[metric]} неизвестно` : `${METRIC_RU[metric]} ${entry.value} (${MARK_RU[entry.mark]})`;
  }).join(", ");
}

function counts(map) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, value]) => `${key} ${value}`).join(", ") || "нет";
}

// One finding line built only from allowed fields; mechanism and proposal
// only for pack findings, product and host findings only kind and stage.
// The stage is published only as a skill name of the pack.
export function stageText(stage, stages) {
  return stages && stages.has(stage) ? stage : "другой";
}

export function findingLine(finding, { passUuid, issueRef = null, stages = null }) {
  const parts = [finding.id, `этап ${stageText(finding.stage, stages)}`, `вид ${KIND_RU[finding.kind] || "другой"}`];
  if (finding.scope !== "pack") return parts.join(" · ");
  parts.push(`версии ${finding.versions?.range || "неизвестны"}${finding.versions?.byPath ? " (по пути)" : ""}`);
  parts.push(`сессий ${finding.sessionsTotal ?? finding.sessions?.length ?? 0}`);
  parts.push(`цена: ${costText(finding.cost)}`);
  if (finding.outcome && OUTCOME_RU[finding.outcome]) parts.push(`исход ${OUTCOME_RU[finding.outcome]}`);
  if (issueRef) parts.push(`задача ${issueRef}`);
  if (finding.mechanism) parts.push(`механизм: ${finding.mechanism}`);
  if (finding.proposal) parts.push(`предложение: ${finding.proposal}`);
  parts.push(`указатель ${finding.pointer || `runs/${passUuid}/${finding.id}`}`);
  return parts.join(" · ");
}

function fenceBlock(lines) {
  return `\`\`\`session-audit\n${lines.join("\n")}\n\`\`\``;
}

function issueRef(finding) {
  const linear = finding.linear;
  if (!linear && !finding.issue) return null;
  const id = linear?.issue || finding.issue;
  return linear?.url ? `${id} ${linear.url}` : id;
}

export function renderReport({ passUuid, map, findings, selection, signals, opened, checks, stages = null, key = "report", revision = 0 }) {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const lines = [];
  lines.push(`Проход ${passUuid}${revision ? `, правка ${revision}` : ""}. Окно ${map.window.start} — ${map.window.end}.`);
  const openedCount = (opened?.signals?.length || 0) + (opened?.sessions?.length || 0);
  lines.push(`Сессии: учтено ${map.counters.sessions}, открыто ${openedCount} (по сигналам ${opened?.signals?.length || 0}, выборка ${opened?.sessions?.length || 0}); сигналов ${signals?.order?.length || 0}, неоткрытых ${(signals?.order || []).filter((id) => !(opened?.signals || []).includes(id)).length}.`);
  lines.push(`По продуктам: ${counts(map.counters.byProduct)}.`);
  lines.push(`По видам: ${counts(map.counters.byKind)}.`);
  lines.push(`По версиям: ${counts(map.counters.byVersion)}.`);
  const openedBy = openedBreakdown(map, signals, opened);
  lines.push(`Открыто сессий ${openedBy.sessions}: по продуктам ${counts(openedBy.byProduct)}; по видам ${counts(openedBy.byKind)}; по версиям ${counts(openedBy.byVersion)}.`);
  lines.push("");
  const section = (title, entries) => {
    if (!entries.length) return;
    lines.push(title);
    for (const entry of entries) lines.push(entry);
    lines.push("");
  };
  const carried = (id) => byId.get(id) || readRegistryEntry(selection.carried, id);
  section("В Triage", selection.triage.map((entry) => findingLine(carried(entry.id), { passUuid, stages, issueRef: entry.action === "reopen" ? issueRef(carried(entry.id)) : null })));
  section("В очередь", selection.queued.map((entry) => findingLine(carried(entry.id), { passUuid, stages })));
  const rowGroups = new Map();
  for (const row of selection.rows) {
    if (!rowGroups.has(row.row)) rowGroups.set(row.row, []);
    rowGroups.get(row.row).push(row);
  }
  for (const [row, entries] of rowGroups) {
    section(ROW_RU[row] || row, entries.map((entry) => {
      const finding = carried(entry.id);
      const ref = issueRef(finding);
      const decision = row === "rejected" && finding.linear ? ` · прежнее решение: ${finding.linear.status}${finding.linear.mechanismRemoved ? ", снято вместе с механизмом" : ""}` : "";
      return `${findingLine(finding, { passUuid, stages, issueRef: ref })}${decision}`;
    }));
  }
  const reasons = {};
  for (const entry of checks?.dropped || []) reasons[entry.reason] = (reasons[entry.reason] || 0) + 1;
  lines.push(`Снято при проверке: ${checks?.dropped?.length || 0}${checks?.dropped?.length ? ` (${counts(reasons)})` : ""}.`);
  lines.push("");
  const outcomes = [
    ...findings.map((finding) => `${finding.id} ${finding.outcome}`),
    ...selection.triage.filter((entry) => entry.carried).map((entry) => `${entry.id} queued-again`),
  ];
  lines.push(fenceBlock([`pass ${passUuid}`, marker(passUuid, key), ...outcomes]));
  return lines.join("\n");
}

function readRegistryEntry(list, id) {
  const entry = (list || []).find((candidate) => candidate.id === id);
  if (!entry) throw new AuditError(`finding ${id} is in the selection but neither in this pass nor in the registry`);
  return entry;
}

function issueTitle(finding) {
  const mechanism = normalizeSpace(finding.mechanism);
  const short = mechanism.length > 90 ? `${mechanism.slice(0, 89)}…` : mechanism;
  return `Разбор сессий: ${short}`;
}

function issueBody(finding, passUuid, key, stages, reopen = false) {
  return [
    `${reopen ? "Вернулось" : "Находка"} ${finding.id}, проход ${passUuid}.`,
    findingLine(finding, { passUuid, stages }),
    "",
    fenceBlock([marker(passUuid, key), `finding ${finding.id} ${finding.outcome || "new"}`]),
  ].join("\n");
}

function commentBody(finding, passUuid, key, stages) {
  return [
    `Проход ${passUuid}: ${OUTCOME_RU[finding.outcome] || finding.outcome}.`,
    findingLine(finding, { passUuid, stages }),
    "",
    fenceBlock([marker(passUuid, key)]),
  ].join("\n");
}

// ---------------------------------------------------------------- plan

function passInputs(dataRoot, passUuid) {
  const findings = runFile(dataRoot, passUuid, "findings.json", null);
  const selection = runFile(dataRoot, passUuid, "selection.json", null);
  if (!findings || !selection) throw new AuditError("run register and select before plan");
  const registry = readRegistry(dataRoot);
  const carriedIds = new Map(selection.triage.concat(selection.queued, selection.rows).filter((chosen) => chosen.carried).map((chosen) => [chosen.id, chosen]));
  selection.carried = registry.findings.filter((entry) => carriedIds.has(entry.id)).map((entry) => ({ ...entry, latest: carriedIds.get(entry.id).latest || entry.latest, linear: carriedIds.get(entry.id).linear || entry.linear }));
  // Findings dropped after their operation was sent: from their stored file.
  const stored = selection.triage.filter((chosen) => chosen.stored).map((chosen) => {
    const { members: _members, ...finding } = runFile(dataRoot, passUuid, path.join(chosen.id, "finding.json"), null) || {};
    return finding;
  });
  selection.carried.push(...stored);
  return {
    findings: findings.findings,
    stored,
    selection,
    signals: runFile(dataRoot, passUuid, "signals.json", null),
    opened: runFile(dataRoot, passUuid, "opened.json", { signals: [], sessions: [] }),
    checks: runFile(dataRoot, passUuid, "checks.json", { kept: [], dropped: [] }),
  };
}

function passesForGuard(passUuid, findings, selection) {
  const passes = [passUuid];
  for (const entry of selection.carried || []) for (const encounter of entry.encounters || []) passes.push(encounter.pass);
  for (const finding of findings) for (const encounter of finding.encounters || []) passes.push(encounter.pass);
  return passes;
}

function desiredOps({ passUuid, config, map, inputs, stages }) {
  const { findings, selection } = inputs;
  const byId = new Map([...findings, ...(selection.carried || [])].map((finding) => [finding.id, finding]));
  const ops = [];
  ops.push({
    key: "report",
    type: "create-document",
    title: `Разбор сессий: ${ruDate(map.window.end)}`,
    project: config.projectId,
    body: renderReport({ passUuid, map, ...inputs, stages }),
  });
  for (const entry of selection.triage) {
    const finding = byId.get(entry.id);
    if (entry.action === "reopen") {
      ops.push({ key: `${finding.id}.triage`, type: "update-issue", finding: finding.id, target: finding.linear?.issue || finding.issue, state: "Triage" });
      ops.push({ key: `${finding.id}.comment`, type: "create-comment", finding: finding.id, target: finding.linear?.issue || finding.issue, body: commentBody(finding, passUuid, `${finding.id}.comment`, stages) });
    } else if (entry.action === "create") {
      ops.push({ key: finding.id, type: "create-issue", finding: finding.id, team: config.triageTeam, state: "Triage", title: issueTitle(finding), body: issueBody(finding, passUuid, finding.id, stages, false) });
    }
  }
  for (const row of selection.rows.filter((entry) => entry.comment)) {
    const finding = byId.get(row.id);
    ops.push({ key: `${finding.id}.comment`, type: "create-comment", finding: finding.id, target: finding.linear?.issue || finding.issue, body: commentBody(finding, passUuid, `${finding.id}.comment`, stages) });
  }
  return ops;
}

function guardOp(op, { passUuid, config, privateSet, pointers }) {
  const problems = [];
  for (const field of ["title", "body"]) {
    if (op[field] === undefined) continue;
    const text = field === "title" ? op.title : op.body;
    for (const problem of guardText(text, { passUuid, pointers, config, privateSet })) problems.push(`${field}: ${problem}`);
  }
  if (op.body !== undefined && !op.body.includes(marker(passUuid, op.key))) problems.push("body: marker missing");
  return problems;
}

function guardContext(dataRoot, passUuid, config, inputs) {
  const pointers = [...inputs.findings, ...(inputs.selection.carried || [])].map((finding) => finding.pointer || `runs/${passUuid}/${finding.id}`);
  const privateSet = privateTexts(dataRoot, passesForGuard(passUuid, inputs.findings, inputs.selection), config.publish.overlapWords);
  return { passUuid, config, privateSet, pointers };
}

function refuseUnsafe(ops, context) {
  const refused = ops.map((op) => ({ key: op.key, problems: guardOp(op, context) })).filter((entry) => entry.problems.length);
  if (refused.length) throw new AuditError("text for Linear did not pass the publish check; rewrite the named fields and run plan again", { refused }, 2);
}

// The plan is bound to the inputs it was built from: commit refuses a plan
// built before the last register or select.
export function inputsDigest(dataRoot, passUuid) {
  const findings = runFile(dataRoot, passUuid, "findings.json", null);
  const selection = runFile(dataRoot, passUuid, "selection.json", null);
  return crypto.createHash("sha256").update(JSON.stringify({ findings: findings?.findings ?? null, selection })).digest("hex");
}

const REACHED = (op) => op.status !== "planned";

// Builds runs/<uuid>/plan.json, or continues it. Operations that may have
// reached Linear (sent, unknown, confirmed, stopped) stay as they are;
// operations still only planned are refreshed from the current inputs or
// removed when no longer wanted; new ones are appended. A report already
// sent gets an update operation only when its content changed.
export function plan(options = {}) {
  return withPass(options, ({ dataRoot, repo, config, passUuid, map, at, write, log }) => {
    if (!config.projectId || !config.triageTeam) {
      throw new AuditError("projectId and triageTeam are needed in the personal config.json of the data root before anything is written to Linear", { projectId: Boolean(config.projectId), triageTeam: Boolean(config.triageTeam) });
    }
    const inputs = passInputs(dataRoot, passUuid);
    const stages = new Set(new TagIndex(repo).skillNames());
    const desired = desiredOps({ passUuid, config, map, inputs, stages });
    const context = guardContext(dataRoot, passUuid, config, inputs);
    refuseUnsafe(desired, context);
    const fresh = (op) => ({ ...op, marker: marker(passUuid, op.key), status: "planned", checks: 0 });
    const existing = runFile(dataRoot, passUuid, "plan.json", null);
    const newReport = desired.find((op) => op.key === "report");
    let current;
    if (!existing) {
      current = { passUuid, createdAt: at, project: config.projectId, team: config.triageTeam, ops: desired.map(fresh) };
      current.ops[0].content = newReport.body;
    } else {
      current = existing;
      const wanted = new Map(desired.map((op) => [op.key, op]));
      const reportOps = current.ops.filter((op) => op.key === "report" || op.type === "update-document");
      // Planned non-report ops: refresh or drop.
      current.ops = current.ops.filter((op) => REACHED(op) || op.key === "report" || op.type === "update-document" || wanted.has(op.key))
        .map((op) => (REACHED(op) || op.key === "report" || op.type === "update-document" ? op : { ...fresh(wanted.get(op.key)) }));
      const report = current.ops.find((op) => op.key === "report");
      const last = reportOps.at(-1);
      const lastContent = last.content ?? last.body;
      if (!REACHED(report)) {
        Object.assign(report, { title: newReport.title, project: newReport.project, body: newReport.body, content: newReport.body });
      } else if (normalizeSpace(lastContent) !== normalizeSpace(newReport.body)) {
        if (last.type === "update-document" && !REACHED(last)) {
          const revision = Number(last.key.split(".")[1]);
          Object.assign(last, { title: newReport.title, body: renderReport({ passUuid, map, ...inputs, stages, key: last.key, revision }), content: newReport.body });
          refuseUnsafe([last], context);
        } else {
          const revision = current.ops.filter((op) => op.type === "update-document").length + 1;
          const key = `report.${revision}`;
          const body = renderReport({ passUuid, map, ...inputs, stages, key, revision });
          const update = { key, type: "update-document", title: newReport.title, target: null, body, content: newReport.body, marker: marker(passUuid, key), status: "planned", checks: 0 };
          refuseUnsafe([update], context);
          current.ops.push(update);
        }
      }
      const keys = new Set(current.ops.map((op) => op.key));
      for (const op of desired) if (!keys.has(op.key)) current.ops.push(fresh(op));
    }
    current.inputsDigest = inputsDigest(dataRoot, passUuid);
    write(["runs", passUuid, "plan.json"], current);
    log(`plan ${current.ops.length} ops`);
    return { passUuid, plan: path.join(dataRoot, "runs", passUuid, "plan.json"), ops: current.ops.map(summaryOp) };
  });
}

function summaryOp(op) {
  return { key: op.key, type: op.type, status: op.status, marker: op.marker, result: op.result || null };
}

// ---------------------------------------------------------------- operations

function readPlan(dataRoot, passUuid) {
  const current = runFile(dataRoot, passUuid, "plan.json", null);
  if (!current) throw new AuditError("no plan: run plan first");
  return current;
}

function findOp(current, key) {
  const op = current.ops.find((candidate) => candidate.key === key);
  if (!op) throw new AuditError(`no operation ${key} in the plan`);
  return op;
}

// The Linear MCP call for an operation, with the text to send verbatim.
function callFor(op, current) {
  const report = current.ops.find((candidate) => candidate.key === "report");
  if (op.type === "create-document") return { tool: "save_document", args: { project: op.project, title: op.title, content: op.body } };
  if (op.type === "update-document") return { tool: "save_document", args: { id: report.result?.id, title: op.title, content: op.body } };
  if (op.type === "create-issue") return { tool: "save_issue", args: { team: op.team, state: op.state, title: op.title, description: op.body } };
  if (op.type === "update-issue") return { tool: "save_issue", args: { id: op.target, state: op.state } };
  return { tool: "save_comment", args: { issueId: op.target, body: op.body } };
}

function lineMarkers(text) {
  return String(text ?? "").replace(/^(\s*)\* /gm, "$1- ");
}

function bodyOf(item) {
  return item?.content ?? item?.description ?? item?.body ?? "";
}

function hasMarker(item, op) {
  return lineMarkers(bodyOf(item)).includes(op.marker);
}

function resultOf(item) {
  return { id: item.id ?? null, identifier: item.identifier ?? null, url: item.url ?? null };
}

function linksOf(text) {
  return [...new Set(String(text ?? "").match(/https?:\/\/[^\s)>\]»"'*`]+/g) || [])].sort();
}

function sameText(planned, saved) {
  return words(planned).join(" ") === words(saved).join(" ") && JSON.stringify(linksOf(planned)) === JSON.stringify(linksOf(saved));
}

function itemIds(item) {
  return [item.id, item.identifier, item.uuid].filter(Boolean);
}

// The object read back is the one this operation wrote: its target, its
// marker, and the same words and link addresses (formatting may change).
function checkReadBack(op, item, current) {
  const problems = [];
  if (!item || typeof item !== "object") return ["the answer is not an object"];
  if (op.type === "update-issue") {
    if (!itemIds(item).includes(op.target)) problems.push(`the answer is ${itemIds(item).join("/") || "unnamed"}, not ${op.target}`);
    if (item.statusType !== "triage") problems.push(`status is ${item.statusType ?? "unknown"}, not triage`);
    return problems;
  }
  if (op.type === "update-document") {
    const report = current.ops.find((candidate) => candidate.key === "report");
    if (!itemIds(item).includes(op.target || report?.result?.id)) problems.push("the answer is not the report document");
  }
  if (op.type === "create-comment" && item.issueId && item.issueId !== op.target && item.issue?.identifier !== op.target) {
    problems.push(`the comment is on ${item.issueId}, not ${op.target}`);
  }
  if (!hasMarker(item, op)) problems.push("the marker is not in the body read back");
  else if (!sameText(op.body, bodyOf(item))) problems.push("the saved text differs from the planned text");
  if (op.title !== undefined && item.title !== undefined && words(item.title).join(" ") !== words(op.title).join(" ")) problems.push("the saved title differs");
  if (op.type === "create-issue" && item.statusType !== "triage") problems.push(`status is ${item.statusType ?? "unknown"}, not triage`);
  // A created object must come back with its server id (and team key for an
  // issue), or a later pass could not find it and might create it again.
  if (op.type.startsWith("create-") && !item.id) problems.push("the answer has no id");
  if (op.type === "create-issue" && ![item.identifier, item.id].some((value) => /^[A-Z][A-Z0-9]*-\d+$/.test(String(value || "")))) problems.push("the answer has no issue key");
  return problems;
}

export function opCommand(options = {}) {
  return withPass(options, ({ dataRoot, config, passUuid, state, at, write, log }) => {
    const current = readPlan(dataRoot, passUuid);
    const save = () => write(["runs", passUuid, "plan.json"], current);
    const action = options.action;
    if (action === "next") {
      const op = current.ops.find((candidate) => candidate.status !== "confirmed");
      if (!op) return { passUuid, done: true, ops: current.ops.map(summaryOp) };
      if (op.status === "stuck") throw new AuditError("an operation stayed unconfirmed after three checks; tell the owner and do not create it again without their words", { key: op.key, marker: op.marker }, 2);
      if (op.status === "sent") {
        // Sent but never confirmed: the answer was lost (a crash or restart).
        op.status = "unknown";
        save();
        log(`op ${op.key} sent earlier without confirmation: unknown`);
      }
      if (op.status === "unknown" && !RECREATE_SAFE.has(op.type)) {
        return { passUuid, key: op.key, status: "unknown", next: "reconcile", marker: op.marker, list: reconcileHint(op) };
      }
      return { passUuid, key: op.key, status: op.status, next: "send", marker: op.marker, call: callFor(op, current) };
    }
    const op = findOp(current, options.key);
    if (action === "sent") {
      if (op.status === "confirmed") throw new AuditError(`operation ${op.key} is already confirmed`, { result: op.result });
      if ((op.status === "sent" || op.status === "unknown") && !RECREATE_SAFE.has(op.type)) {
        throw new AuditError(`operation ${op.key} may already exist in Linear: reconcile by its marker before any new create`, { key: op.key, marker: op.marker }, 2);
      }
      if (op.status === "stuck") throw new AuditError(`operation ${op.key} is stopped; the owner decides`, { marker: op.marker }, 2);
      if (op.type === "update-document") {
        const report = findOp(current, "report");
        if (report.status !== "confirmed") throw new AuditError("the report must be confirmed before it is updated");
        op.target = report.result.id;
      }
      if ((op.type === "update-issue" || op.type === "create-comment") && !op.target) throw new AuditError(`operation ${op.key} has no target issue`);
      const inputs = passInputs(dataRoot, passUuid);
      const problems = guardOp(op, guardContext(dataRoot, passUuid, config, inputs));
      if (problems.length) throw new AuditError(`operation ${op.key} did not pass the publish check`, { problems }, 2);
      op.status = "sent";
      op.sentAt = at;
      save();
      log(`op ${op.key} sent`);
      return { passUuid, key: op.key, status: "sent", marker: op.marker, call: callFor(op, current) };
    }
    if (action === "confirm") {
      if (op.status === "confirmed") return { passUuid, key: op.key, status: "confirmed", result: op.result };
      if (op.status === "planned") throw new AuditError(`operation ${op.key} was not marked sent`);
      const item = passInput(dataRoot, passUuid, options.response, "--response");
      const problems = checkReadBack(op, item, current);
      if (problems.length) throw new AuditError(`the read-back of ${op.key} does not confirm it`, { problems }, 2);
      op.status = "confirmed";
      op.result = resultOf(item);
      op.confirmedAt = at;
      save();
      log(`op ${op.key} confirmed ${op.result.identifier || op.result.id}`);
      return { passUuid, key: op.key, status: "confirmed", result: op.result };
    }
    if (action === "lost") {
      if (op.status !== "sent" && op.status !== "unknown") throw new AuditError(`operation ${op.key} is ${op.status}, not sent`);
      op.status = "unknown";
      save();
      log(`op ${op.key} answer lost: unknown`);
      return { passUuid, key: op.key, status: "unknown", next: "reconcile", marker: op.marker, list: reconcileHint(op) };
    }
    if (action === "reconcile") {
      if (op.status !== "sent" && op.status !== "unknown") throw new AuditError(`operation ${op.key} is ${op.status}; nothing to reconcile`);
      const interval = config.reconcile.intervalSeconds * 1000;
      if (op.lastCheckAt && Date.parse(at) - Date.parse(op.lastCheckAt) < interval) {
        throw new AuditError(`check ${op.key} again after a minute`, { retryAfterSeconds: Math.ceil((interval - (Date.parse(at) - Date.parse(op.lastCheckAt))) / 1000) }, 2);
      }
      const listing = passInput(dataRoot, passUuid, options.listing, "--listing");
      const items = Array.isArray(listing) ? listing : listing.documents || listing.issues || listing.comments || listing.nodes || [];
      if (op.type !== "update-issue" && items.some((item) => typeof bodyOf(item) !== "string" || !("content" in item || "description" in item || "body" in item))) {
        throw new AuditError("the listing has items without their text; save the full objects (content, description or body) and reconcile again", { key: op.key }, 2);
      }
      const since = Date.parse(state.pending.startedAt);
      const scoped = op.type === "create-comment" || op.type === "update-issue" || op.type === "update-document"
        ? items
        : items.filter((item) => !item.createdAt || Date.parse(item.createdAt) >= since);
      // The same checks as a direct read-back: target, state, marker, text, id.
      const found = scoped.filter((item) => checkReadBack(op, item, current).length === 0);
      op.checks = (op.checks || 0) + 1;
      op.lastCheckAt = at;
      if (found.length) {
        op.status = "confirmed";
        op.result = resultOf(found[0]);
        op.confirmedAt = at;
        if (found.length > 1) op.duplicates = found.slice(1).map(resultOf);
        save();
        log(`op ${op.key} confirmed by marker ${op.result.identifier || op.result.id}${found.length > 1 ? ` (${found.length - 1} duplicates)` : ""}`);
        return { passUuid, key: op.key, status: "confirmed", result: op.result, duplicates: op.duplicates || [] };
      }
      if (op.checks >= config.reconcile.attempts) {
        op.status = "stuck";
        save();
        log(`op ${op.key} stuck after ${op.checks} checks`);
        throw new AuditError("the marker was not found after three checks: stop and tell the owner; do not create again without their words", { key: op.key, marker: op.marker, checks: op.checks }, 2);
      }
      save();
      log(`op ${op.key} not found (check ${op.checks})`);
      return { passUuid, key: op.key, status: op.status, found: false, checks: op.checks, retryAfterSeconds: config.reconcile.intervalSeconds, list: reconcileHint(op) };
    }
    if (action === "resume") {
      // Only on the owner's words after a stop: the object is not in Linear.
      if (op.status !== "stuck") throw new AuditError(`operation ${op.key} is ${op.status}, not stopped`);
      if (!options.ownerSaid) throw new AuditError("resume a stopped operation only after the owner's words (--owner-said)");
      op.status = "planned";
      op.checks = 0;
      op.lastCheckAt = null;
      save();
      log(`op ${op.key} back to planned on the owner's words`);
      return { passUuid, key: op.key, status: "planned" };
    }
    throw new AuditError(`unknown op action ${action}`);
  });
}

function reconcileHint(op) {
  if (op.type === "create-document") return "list_documents of the project created since the pass start; pass the saved answer with --listing";
  if (op.type === "create-issue") return "list_issues of the team created since the pass start; pass the saved answer with --listing";
  if (op.type === "create-comment") return `list_comments of ${op.target}, all of them; pass the saved answer with --listing`;
  return "get the target back and pass it with --listing";
}

// ---------------------------------------------------------------- commit

function registryOutcome(finding, selection) {
  if (selection.triage.some((entry) => entry.id === finding.id)) return finding.outcome === "returned" ? "returned" : "triage";
  if (selection.queued.some((entry) => entry.id === finding.id)) return "queued";
  const row = selection.rows.find((entry) => entry.id === finding.id);
  return row?.row === "report-only" ? "report" : row?.row || finding.outcome;
}

// Sessions of the stage on versions at or after fixed_in that were actually
// opened in this pass without the finding confirm the fix after three of
// them (U7 fix_confirmed). Sessions only counted in the map do not.
function cleanSessions(entry, map, reviewed) {
  if (!entry.fixedIn || !entry.features?.stage) return [];
  return map.sessions.filter((session) => reviewed.has(session.id) && session.loads.some((load) => load.skill === entry.features.stage && load.version.status === "confirmed"
    && load.version.tags.every((tag) => compareTags(tag, entry.fixedIn) >= 0))).map((session) => session.id);
}

export function commit(options = {}) {
  return withPass(options, ({ env, dataRoot, passUuid, state, map, at, write, log }) => {
    const current = readPlan(dataRoot, passUuid);
    if (current.inputsDigest !== inputsDigest(dataRoot, passUuid)) {
      throw new AuditError("register or select changed after the plan was built; run plan again and apply the new operations", {}, 2);
    }
    const open = current.ops.filter((op) => op.status !== "confirmed");
    if (open.length) {
      throw new AuditError("not every write is confirmed; the boundary stays", { open: open.map(summaryOp) }, 2);
    }
    const inputs = passInputs(dataRoot, passUuid);
    const registry = readRegistry(dataRoot);
    const byId = new Map(registry.findings.map((entry) => [entry.id, entry]));
    const created = new Map(current.ops.filter((op) => op.type === "create-issue").map((op) => [op.finding, op.result]));
    const reopened = new Set(current.ops.filter((op) => op.type === "update-issue").map((op) => op.finding));
    const signalsFile = runFile(dataRoot, passUuid, "signals.json", { signals: [] });
    const reviewed = new Set([...(inputs.opened.sessions || []), ...(signalsFile.signals || []).filter((signal) => (inputs.opened.signals || []).includes(signal.id)).map((signal) => signal.session).filter(Boolean)]);
    const seen = new Set();
    for (const finding of [...inputs.findings, ...inputs.stored]) {
      seen.add(finding.id);
      const entry = byId.get(finding.id) || { id: finding.id, encounters: [], issue: null, fixedIn: null, cleanSessions: [], fixConfirmed: false };
      const issue = created.get(finding.id);
      Object.assign(entry, {
        mechanism: finding.mechanism, proposal: finding.proposal, kind: finding.kind, scope: finding.scope, stage: finding.stage,
        features: finding.features, cost: finding.cost, versions: finding.versions, latest: finding.latest,
        sessionsTotal: finding.sessionsTotal, pointer: finding.pointer,
        // A Duplicate is kept as its resolved main issue.
        issue: issue ? (issue.identifier || issue.id) : (finding.linear?.issue || entry.issue),
        outcome: registryOutcome(finding, inputs.selection),
        queuedAction: inputs.selection.queued.find((entry) => entry.id === finding.id)?.action || null,
        places: finding.places || entry.places || null,
        fixedIn: finding.fixedIn ?? entry.fixedIn ?? null,
        status: finding.status,
      });
      entry.encounters = [...(entry.encounters || []).filter((encounter) => encounter.pass !== passUuid),
        ...finding.sessions.map((session) => ({ pass: passUuid, session, versions: finding.versions.tags, at, confirmed: finding.status === "confirmed" })),
        ...(finding.sessions.length ? [] : [{ pass: passUuid, session: null, versions: finding.versions.tags, at, confirmed: finding.status === "confirmed" }])];
      byId.set(entry.id, entry);
    }
    for (const chosen of [...inputs.selection.triage, ...inputs.selection.queued, ...inputs.selection.rows]) {
      if (!chosen.carried || seen.has(chosen.id)) continue;
      const entry = byId.get(chosen.id);
      const issue = created.get(chosen.id);
      if (chosen.row) entry.outcome = chosen.row === "report-only" ? "report" : chosen.row;
      else if (issue || reopened.has(chosen.id)) entry.outcome = reopened.has(chosen.id) ? "returned" : "triage";
      else entry.outcome = "queued";
      if (chosen.latest) entry.latest = chosen.latest;
      if (issue) entry.issue = issue.identifier || issue.id;
    }
    for (const entry of byId.values()) {
      if (seen.has(entry.id) || !entry.fixedIn) continue;
      entry.cleanSessions = [...new Set([...(entry.cleanSessions || []), ...cleanSessions(entry, map, reviewed)])];
      entry.fixConfirmed = entry.fixConfirmed || entry.cleanSessions.length >= 3;
    }
    write(["findings.json"], { findings: [...byId.values()] });
    const openedSignals = new Set(inputs.opened.signals || []);
    const queue = readQueue(dataRoot).filter((signal) => !openedSignals.has(signal.id));
    write(["queue.json"], { signals: queue });
    log(`commit boundary ${state.pending.windowEnd} queue ${queue.length}`);
    const summary = buildSummary({ env, dataRoot, passUuid, map, at, plan: current, queueLength: queue.length, startedAt: state.pending.startedAt });
    write(["runs", passUuid, "summary.json"], summary);
    // Last: the boundary moves, deferred tails carry over, the pass is done.
    const latest = readState(dataRoot);
    write(["state.json"], { ...latest, boundary: state.pending.windowEnd, deferredTails: state.pending.deferredTails || [], pending: null, lastPass: passUuid });
    return { passUuid, committed: true, boundary: state.pending.windowEnd, summary };
  });
}

// ---------------------------------------------------------------- summary

export function buildSummary({ env, dataRoot, passUuid, map, at, plan: current, queueLength, startedAt }) {
  const findings = runFile(dataRoot, passUuid, "findings.json", { findings: [] }).findings;
  const selection = runFile(dataRoot, passUuid, "selection.json", { triage: [], queued: [], rows: [] });
  const signals = runFile(dataRoot, passUuid, "signals.json", { order: [], signals: [] });
  const opened = runFile(dataRoot, passUuid, "opened.json", { signals: [], sessions: [] });
  const checks = runFile(dataRoot, passUuid, "checks.json", { kept: [], dropped: [] });
  const spent = cost({ env, passUuid });
  const ops = current?.ops || [];
  const report = ops.filter((op) => op.key === "report" || op.type === "update-document").find((op) => op.key === "report")?.result || null;
  const triage = selection.triage.map((entry) => {
    const op = ops.find((candidate) => candidate.finding === entry.id && (candidate.type === "create-issue" || candidate.type === "update-issue"));
    return { id: entry.id, action: entry.action, issue: op?.result?.identifier || op?.result?.id || op?.target || null, url: op?.result?.url || null, status: op?.status || "not planned" };
  });
  const by = (outcomes) => findings.filter((finding) => outcomes.includes(finding.outcome)).map((finding) => finding.id);
  const confirmList = findings.filter((finding) => finding.status === "needs-owner").map((finding) => ({ id: finding.id, stage: finding.stage, kind: finding.kind }));
  const unopened = (signals.signals || []).filter((signal) => !(opened.signals || []).includes(signal.id)).map((signal) => ({ id: signal.id, reasons: signal.reasons, session: signal.session, product: signal.product }));
  const minutes = Math.max(0, Math.round((Date.parse(at) - Date.parse(startedAt)) / 60000));
  const summary = {
    passUuid,
    window: map.window,
    sessions: {
      counted: map.counters.sessions, byProduct: map.counters.byProduct, byKind: map.counters.byKind, byVersion: map.counters.byVersion,
      byHost: map.counters.byHost, runMarked: map.sessions.filter((session) => session.run?.marked).length,
      opened: (opened.signals || []).length + (opened.sessions || []).length,
      openedBy: openedBreakdown(map, signals, opened),
    },
    signals: { total: (signals.order || []).length, opened: (opened.signals || []).length, unopened },
    findings: {
      new: by(["new"]), repeats: by(["repeat-open", "repeat-report", "queued-again", "repeat-fix-unknown", "repeat-before-fix", "repeat-version-ambiguous"]),
      returned: by(["returned"]), rejected: by(["rejected"]),
      queued: selection.queued.map((entry) => entry.id),
      reportOnly: selection.rows.map((entry) => ({ id: entry.id, row: entry.row })),
    },
    triage,
    confirm: confirmList,
    dropped: { count: (checks.dropped || []).length, reasons: (checks.dropped || []).map((entry) => entry.reason) },
    time: { minutes },
    tokens: { tokens: spent.tokens, cacheReadTokens: spent.cacheReadTokens },
    queueLength,
    report,
  };
  summary.text = summaryText(summary);
  return summary;
}

function summaryText(s) {
  const versions = Object.keys(s.sessions.byVersion || {}).filter((key) => key !== "unconfirmed");
  const lines = [];
  lines.push(`Учёл ${s.sessions.counted} сессий${versions.length ? ` на ${versions.join(", ")}` : ""}${s.sessions.byVersion?.unconfirmed ? ` (без подтверждённой версии ${s.sessions.byVersion.unconfirmed})` : ""} в продуктах: ${counts(s.sessions.byProduct)}; открыл ${s.sessions.opened}.`);
  lines.push(`Новое: ${s.findings.new.length}. Повторы: ${s.findings.repeats.length}. Вернулось: ${s.findings.returned.length}. Отклонённые раньше: ${s.findings.rejected.length}.`);
  lines.push(`В Triage: ${s.triage.length}${s.triage.length ? ` (${s.triage.map((entry) => entry.issue || entry.id).join(", ")})` : ""}. В очередь: ${s.findings.queued.length}. Только в отчёте: ${s.findings.reportOnly.length}. Снято без доказательства или правила: ${s.dropped.count}.`);
  lines.push(s.confirm.length ? `От тебя: подтвердить ${s.confirm.length} ${s.confirm.length === 1 ? "находку" : "находки"} про экран (${s.confirm.map((entry) => `${entry.id}, этап ${entry.stage}`).join("; ")}).` : "От тебя: ничего.");
  lines.push(`Неоткрытых сигналов: ${s.signals.unopened.length}; очередь: ${s.queueLength}.`);
  lines.push(`Проход: ${s.time.minutes} мин, ${s.tokens.tokens} токенов (чтение из кэша ${s.tokens.cacheReadTokens} отдельно).`);
  lines.push(`Отчёт: ${s.report?.url || s.report?.id || "ещё не записан"}.`);
  return lines.join("\n");
}

export function summary(options = {}) {
  const { env = process.env } = options;
  return withPass(options, ({ dataRoot, passUuid, map, at, state }) => {
    const current = runFile(dataRoot, passUuid, "plan.json", null);
    return buildSummary({ env, dataRoot, passUuid, map, at, plan: current, queueLength: readQueue(dataRoot).length, startedAt: state.pending.startedAt });
  });
}

export function lastSummary({ env = process.env } = {}) {
  const { dataRoot } = setup(env);
  const state = readState(dataRoot);
  const passUuid = state.pending?.uuid || state.lastPass;
  if (!passUuid) throw new AuditError("no pass yet");
  const file = path.join(dataRoot, "runs", passUuid, "summary.json");
  if (!isFile(file)) throw new AuditError(`pass ${passUuid} is not committed yet; run summary --session <id>`);
  return readJson(file);
}

export { OP_TYPES, isoNow };
