// Markdown extraction is deliberately exact: unknown keys refuse dispatch;
// ambiguous definitions retain the complete documents rather than guessing.
const ID = "(?:AE|A|F|R|U)\\d+(?:[′'а-я])?";
const BOUNDARY_ID = "(?:AE|A|F|R|U|I)\\d+(?:[′'а-я])?";
const ids = () => new RegExp(`(?<![\\p{L}\\p{N}_])(${ID})(?![\\p{L}\\p{N}_′'])`, "gu");

export function references(text) {
  const expanded = text.replace(new RegExp(`(${ID})\\s*[–-]\\s*(${ID})`, "gu"), (range, a, b) => {
    const left = /^(AE|A|F|R|U)(\d+)$/.exec(a), right = /^(AE|A|F|R|U)(\d+)$/.exec(b);
    if (!left || !right || left[1] !== right[1] || +right[2] < +left[2] || +right[2] - +left[2] > 1000)
      throw new Error(`unsupported coverage range: ${range}`);
    return Array.from({ length: +right[2] - +left[2] + 1 }, (_, n) => `${left[1]}${+left[2] + n}`).join(", ");
  });
  return [...new Set([...expanded.matchAll(ids())].map(match => match[1]))];
}

// Pass one builds source-backed sections and nested list definitions. Selection
// never reinterprets raw Markdown, including the contents of opaque blocks.
function parseDocument(text) {
  const lines = text.split("\n");
  const root = { type: "document", start: 0, end: lines.length, children: [] };
  const headings = [], lists = [];
  let fence = null;
  const parent = () => lists.at(-1) ?? headings.at(-1) ?? root;
  const closeLists = end => { while (lists.length) lists.pop().end = end; };
  for (let start = 0; start < lines.length; start++) {
    const line = lines[start];
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      fence.end = start + 1;
      if (delimiter && delimiter[1][0] === fence.character && delimiter[1].length >= fence.length && /^[ \t]*$/.test(delimiter[2])) {
        fence.closed = true;
        fence = null;
      }
      continue;
    }
    if (delimiter && (delimiter[1][0] === "~" || !delimiter[2].includes("`"))) {
      fence = { type: "fence", start, end: start + 1, character: delimiter[1][0], length: delimiter[1].length, closed: false };
      parent().children.push(fence);
      continue;
    }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
    if (heading) {
      closeLists(start);
      if (headings.length && headings.at(-1).contentEnd === undefined) headings.at(-1).contentEnd = start;
      const level = heading[1].length;
      while (headings.length && headings.at(-1).level >= level) headings.pop().end = start;
      const title = (heading[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
      const boundary = [2, 3].includes(level) && definitionId(title);
      const node = { type: "heading", start, end: lines.length, level, title,
        id: selectable(boundary), children: [] };
      parent().children.push(node);
      headings.push(node);
      continue;
    }
    const bullet = /^([ \t]*)[-*][ \t]+(.+)$/.exec(line);
    const boundary = bullet && definitionId(bullet[2]);
    const column = bullet ? [...bullet[1]].reduce((column, character) => column + (character === "\t" ? 4 - column % 4 : 1), 0) : undefined;
    if (boundary) {
      while (lists.length && lists.at(-1).column >= column) lists.pop().end = start;
      const node = { type: "list", start, end: lines.length, column, id: selectable(boundary), children: [] };
      parent().children.push(node);
      lists.push(node);
    } else {
      // U12 leaves other markup opaque; it cannot satisfy coverage or define IDs.
      const opaque = /^[ \t]*(?:>|\||<|\[\^[^\]]+\]:)/u.test(line);
      parent().children.push({ type: opaque ? "opaque" : bullet ? "item" : "text", column, start, end: start + 1 });
    }
  }
  closeLists(lines.length);
  for (const node of headings) { node.end = lines.length; node.contentEnd ??= lines.length; }
  return { root, lines, unclosedFence: fence !== null };
}

function definitionId(content) {
  return new RegExp(`^(${BOUNDARY_ID})(?=[.(\\s]|$)`, "u").exec(content)?.[1];
}
const selectable = id => id && !id.startsWith("I") ? id : undefined;
function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}
const sourceText = (document, start, end) => document.lines.slice(start, end).join("\n").trim();

function findSection(document, title, required = false) {
  const matches = [...walk(document.root)].filter(node => node.type === "heading" && node.title === title);
  if (matches.length !== 1) {
    if (required || matches.length > 1) throw new Error(`missing or duplicate section: ${title}`);
    return null;
  }
  return matches[0];
}

export function section(text, title, required = false) {
  const document = parseDocument(text), node = findSection(document, title, required);
  return node ? sourceText(document, node.start, node.end) : "";
}

function definitions(document, name) {
  return [...walk(document.root)].filter(node => node.id).map(node => ({
    node, id: node.id, document: name, start: node.start, end: node.type === "heading" ? node.contentEnd : node.end,
  }));
}

function visibleText(document, node, end = node.end) {
  // A definition-heading ends before any nested heading; a common section does
  // include its nested sections. Fence and other opaque nodes contribute nothing.
  return [...walk(node)].filter(block => block.start < end && !["fence", "opaque", "document"].includes(block.type))
    .map(block => document.lines[block.start]).join("\n");
}

function coverage(text) {
  const fragments = [...text.matchAll(/Покрывает\s+([^\n.]+)/gu)].map(match => match[1]);
  for (const match of text.matchAll(/\(([^()\n]*;[^()\n]*)\)/gu)) fragments.push(match[1].split(";").slice(1).join(";"));
  return references(fragments.join("\n"));
}

const COMMON = {
  prd: ["Кратко", "Что не входит в MVP", "Допущения"],
  spec: ["Кратко", "Архитектура", "Контракты и границы", "Риски и защита", "Что может сломаться и как защищаемся", "Валидация", "Релиз и откат"],
};

export function extractSnapshot(issue, prd, spec) {
  const documents = { issue: parseDocument(issue), prd: parseDocument(prd), spec: parseDocument(spec) };
  const entries = [...definitions(documents.prd, "prd"), ...definitions(documents.spec, "spec")];
  const index = new Map();
  for (const entry of entries) index.set(entry.id, [...(index.get(entry.id) ?? []), entry]);
  const issueCoverage = findSection(documents.issue, "Покрытие PRD/Spec", true);
  const pending = references(visibleText(documents.issue, issueCoverage));
  if (!pending.length) throw new Error("coverage has no identifiers; supply a full snapshot explicitly");
  const selected = new Set();
  while (pending.length) {
    const id = pending.shift();
    if (selected.has(id)) continue;
    const matches = index.get(id);
    if (!matches) throw new Error(`unknown snapshot identifier: ${id}`);
    selected.add(id);
    for (const match of matches) pending.push(...coverage(visibleText(documents[match.document], match.node, match.end)));
  }
  // Unknown IDs in every reachable definition have already refused above,
  // including all alternatives of duplicates. Refusal takes priority over fallback.
  const duplicates = [...index].filter(([, values]) => values.length > 1).map(([id]) => id);
  const notes = [];
  if (duplicates.length) notes.push(`Duplicate definitions (${duplicates.join(", ")})`);
  if (Object.values(documents).some(document => document.unclosedFence)) notes.push("Unclosed fence");
  if (notes.length) return { full: true, note: `${notes.join("; ")}; full snapshot retained.`, prd, spec, ids: [...selected] };
  const result = { full: false, note: null, ids: [...selected] };
  for (const name of ["prd", "spec"]) {
    const document = documents[name];
    const intervals = COMMON[name].map(title => findSection(document, title)).filter(Boolean)
      .map(node => ({ start: node.start, end: node.end }));
    intervals.push(...entries.filter(entry => entry.document === name && selected.has(entry.id)));
    intervals.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      if (previous && interval.start < previous.end) previous.end = Math.max(previous.end, interval.end);
      else merged.push({ start: interval.start, end: interval.end });
    }
    result[name] = merged.map(interval => sourceText(document, interval.start, interval.end)).join("\n\n") + "\n";
  }
  return result;
}
