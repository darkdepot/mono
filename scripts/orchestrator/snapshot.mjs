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

function scan(text) {
  let fence = null;
  return text.split("\n").map((line, index) => {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.character && delimiter[1].length >= fence.length && /^\s*$/.test(delimiter[2])) fence = null;
      return { index, line };
    }
    if (delimiter && (delimiter[1][0] === "~" || !delimiter[2].includes("`"))) {
      fence = { character: delimiter[1][0], length: delimiter[1].length };
      return { index, line };
    }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
    const headingText = heading ? (heading[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim() : null;
    const bullet = /^(\s*)[-*]\s+(.+)$/.exec(line);
    const content = heading && [2, 3].includes(heading[1].length) ? headingText : bullet?.[2];
    const def = content && new RegExp(`^(${BOUNDARY_ID})(?=[.(\\s]|$)`, "u").exec(content);
    const indent = bullet ? [...bullet[1]].reduce((column, character) =>
      column + (character === "\t" ? 4 - column % 4 : 1), 0) : undefined;
    return { index, line, heading: headingText, level: heading?.[1].length,
      indent, boundaryId: def?.[1], id: def && !def[1].startsWith("I") ? def[1] : undefined };
  });
}

export function section(text, title, required = false) {
  const rows = scan(text), matches = rows.filter(row => row.heading === title);
  if (matches.length !== 1) {
    if (required || matches.length > 1) throw new Error(`missing or duplicate section: ${title}`);
    return "";
  }
  const start = matches[0];
  const end = rows.find(row => row.index > start.index && row.level !== undefined && row.level <= start.level)?.index ?? rows.length;
  return rows.slice(start.index, end).map(row => row.line).join("\n").trim();
}

function definitions(text, document) {
  const rows = scan(text);
  return rows.filter(row => row.id).map(start => {
    // The snapshot contract ends a definition at the next heading, without a
    // level qualifier; headings beneath a definition are separate sections.
    const end = rows.find(row => row.index > start.index && (row.level !== undefined ||
      (start.indent !== undefined && row.boundaryId && row.indent <= start.indent)))?.index ?? rows.length;
    return { ...start, document, text: rows.slice(start.index, end).map(row => row.line).join("\n").trim() };
  });
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
  const entries = [...definitions(prd, "prd"), ...definitions(spec, "spec")];
  const index = new Map();
  for (const entry of entries) index.set(entry.id, [...(index.get(entry.id) ?? []), entry]);
  const pending = references(section(issue, "Покрытие PRD/Spec", true));
  if (!pending.length) throw new Error("coverage has no identifiers; supply a full snapshot explicitly");
  const selected = new Set();
  while (pending.length) {
    const id = pending.shift();
    if (selected.has(id)) continue;
    const matches = index.get(id);
    if (!matches) throw new Error(`unknown snapshot identifier: ${id}`);
    selected.add(id);
    for (const match of matches) pending.push(...coverage(match.text));
  }
  const duplicates = [...index].filter(([, values]) => values.length > 1).map(([id]) => id);
  if (duplicates.length) return { full: true, note: `Duplicate definitions (${duplicates.join(", ")}); full snapshot retained.`, prd, spec, ids: [...selected] };
  const result = { full: false, note: null, ids: [...selected] };
  for (const [document, source] of [["prd", prd], ["spec", spec]]) {
    // Merge source intervals so definitions inside an always-included section
    // appear once, while preserving both original context and source order.
    const chunks = COMMON[document].map(title => section(source, title)).filter(Boolean);
    for (const entry of entries.filter(item => item.document === document && selected.has(item.id))) {
      if (!chunks.some(chunk => chunk.includes(entry.text))) chunks.push(entry.text);
    }
    result[document] = chunks.sort((a, b) => source.indexOf(a) - source.indexOf(b)).join("\n\n") + "\n";
  }
  return result;
}
