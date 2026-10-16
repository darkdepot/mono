#!/usr/bin/env node

// Deterministic issue-only lane context resolver.
//
// Reads {issue body, marker, config} and prints the normative 5-field context
// contract as JSON to stdout. It is the seam that every issue-only-lane consumer
// reads FIRST. See references/issue-only-lane.md for the contract.
//
// It is NOT a spine-resolver: it emits no assurance vector, no route-record, and
// no required_artifacts. The marker it reads is a lightweight approval receipt,
// not a route-record ("маркер ≠ route-record").
//
// Fail-closed invariant: no usable marker ⇒ package_kind=project-first. A marker
// that is present but integrity-invalid (broken structure or a stale scope
// fingerprint) ⇒ process.exit(1); it is never silently resolved as issue-only.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MARKER_LINE = "mono-issue-only marker";
// A real marker line stands alone with 0-3 spaces of indentation. A 4+-space (or
// tab) indent makes it a Markdown indented code block — a documentation example,
// never an authoritative marker.
// The previous brand marker remains readable so a rename cannot invalidate an
// already-approved durable Linear comment. New writes always use MARKER_LINE.
const MARKER_LINE_RE = /^ {0,3}(?:mono|linear)-issue-only marker[ \t]*$/;
const MARKER_VERSION = 1;
const ISSUE_ONLY_LABEL = "issue-only";
const RISK_CLASSES = ["tiny", "standard", "deep", "risky"];
// Phase-1 eligibility envelope for the issue-only lane. deep/risky stays
// project-first until the Phase-3 safety modules land (see plan 015 README).
const LANE_ELIGIBLE_RISK = ["tiny", "standard"];
const REQUIRED_MARKER_FIELDS = [
  "Marker version",
  "Scope fingerprint",
  "Acceptance IDs",
  "Risk class",
  "Approval",
];
// The marker is not a route-record. These fields belong to the spine, not here.
const FORBIDDEN_MARKER_KEYS = ["route revision", "assurance vector", "required artifacts"];

// Normative-section heading matchers — EXACT (anchored, optional trailing colon)
// so a heading like "Acceptance history", "Verify exclusions", or "Review gate
// considerations" is never mistaken for the canonical section, and the positive
// scope/objective matchers never pick up the negative "Non-goals" / "Out of
// scope". Anchoring uses `$` (not `\b`, which mishandles Cyrillic). One source of
// truth for the oracle, completeness, and risk read — the fingerprint is
// whole-body and needs no section matching.
const SECTION_RE = {
  objective: /^(?:цель pr|objective|goals?)\s*:?\s*$/i,
  scope: /^(?:что сделать|scope|what to do)\s*:?\s*$/i,
  desired: /^(?:желаемое поведение|desired behaviou?rs?)\s*:?\s*$/i,
  acceptance: /^(?:критерии приёмки|критерии приемки|acceptance criteria|acceptance)\s*:?\s*$/i,
  verify: /^(?:как проверить|how to verify|verification|verify)\s*:?\s*$/i,
  nonGoals: /^(?:что не входит|non-goals|out of scope)\s*:?\s*$/i,
  reviewGate: /^(?:ревью-гейт|ревью гейт|review gate)\s*:?\s*$/i,
};

// The positive-behavior headings (for the self-contained completeness gate) and
// the authoritative review-gate heading (for the risk cross-check) — subsets of
// the exact matchers above.
const BEHAVIOR_HEADING_RES = [SECTION_RE.objective, SECTION_RE.scope, SECTION_RE.desired];
const REVIEW_GATE_HEADING_RE = SECTION_RE.reviewGate;

function usage(exitCode = 2) {
  console.error(
    "Usage: node scripts/resolve-issue-context.mjs --issue <path> [--marker <path>] [--config <path>] [--label <names>] [--approval-verified <fp>] [--emit-fingerprint]"
  );
  console.error("");
  console.error("Options:");
  console.error("  --issue <path>          Issue body markdown (required)");
  console.error("  --marker <path>         Marker source; defaults to the issue body when omitted");
  console.error("  --config <path>         Project config JSON; validated when provided");
  console.error("  --label <names>         Trusted, caller-verified Linear labels on the Issue (comma-separated; names may contain spaces)");
  console.error("  --approval-verified <fp>  Caller-verified owner-approval fingerprint from the authenticated Linear comment");
  console.error("  --emit-fingerprint      Print the computed scope fingerprint for --issue and exit");
  console.error("  --help, -h              Show this help and exit");
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { issue: "", marker: "", config: "", label: "", approvalVerified: "", emitFingerprint: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--issue") {
      args.issue = argv[++index] || "";
    } else if (arg === "--marker") {
      args.marker = argv[++index] || "";
    } else if (arg === "--config") {
      args.config = argv[++index] || "";
    } else if (arg === "--label") {
      args.label = argv[++index] || "";
    } else if (arg === "--approval-verified") {
      args.approvalVerified = argv[++index] || "";
    } else if (arg === "--emit-fingerprint") {
      args.emitFingerprint = true;
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }
  if (!args.issue) usage();
  args.issue = path.resolve(args.issue);
  if (args.marker) args.marker = path.resolve(args.marker);
  if (args.config) args.config = path.resolve(args.config);
  return args;
}

// Single-line, stable violation message → stderr, then hard-fail. Downstream
// fixtures and consumers pin on "issue-only-lane: broken marker" and
// "issue-only-lane: stale marker".
function violation(message) {
  console.error(`issue-only-lane: ${message}`);
  process.exit(1);
}

function readFileOrFail(filePath, label) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    violation(`cannot read ${label}: ${filePath} (${error.code || error.message})`);
    return ""; // unreachable
  }
}

// CommonMark-ish fenced-block tracking. A fence opens with >=3 backticks or
// tildes; it closes ONLY on a bare line of the SAME character at >= the opening
// length. A mismatched or shorter fence inside the block (e.g. ~~~ inside ```) is
// content, not a close — so it can't prematurely re-expose headings.
function fenceTransition(line, open) {
  // A fence may be indented 0-3 spaces; 4+ spaces (or a leading tab) is an indented
  // code block, not a fence, so it never opens/closes one.
  const match = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/.exec(line);
  if (!match) return open;
  const char = match[1][0];
  const len = match[1].length;
  if (open === null) return { char, len };
  if (char === open.char && len >= open.len && match[2].trim() === "") return null;
  return open;
}

// Column count of a line's leading indentation, expanding tabs to the next 4-column
// stop (Markdown's rule). 4+ columns is an indented code block.
function indentColumns(line) {
  let col = 0;
  for (const ch of line) {
    if (ch === "\t") col += 4 - (col % 4);
    else if (ch === " ") col += 1;
    else break;
  }
  return col;
}

// Tokenize into visible lines. HTML comments are stripped ONLY outside fenced code
// blocks — a `<!--` inside a fence is literal code, so it neither opens a comment
// nor swallows the content after the fence. Fence and comment state are mutually
// exclusive. `inFence` marks a fence-delimiter or fenced-content line (never a
// heading); for a fully-commented line `text` is "". One tokenizer shared by every
// section/marker scan so their fence+comment handling can't drift.
function* contentTokens(text) {
  const lines = text.split(/\r?\n/);
  let fence = null;
  let inComment = false;
  // Scan the original line once; joined visible fragments must never open a
  // comment that was absent from the input (for example <!<!-- x -->--).
  const stripLineComments = (raw) => {
    let visible = "", cursor = 0;
    while (true) {
      const open = raw.indexOf("<!--", cursor);
      if (open < 0) return visible + raw.slice(cursor);
      visible += raw.slice(cursor, open);
      const close = raw.indexOf("-->", open + 4);
      if (close < 0) {
        inComment = true;
        return visible;
      }
      cursor = close + 3;
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (inComment) {
      const close = rawLine.indexOf("-->");
      if (close < 0) {
        yield { text: "", inFence: false, index };
        continue;
      }
      let line = rawLine.slice(close + 3);
      inComment = false;
      line = stripLineComments(line);
      yield { text: line, inFence: false, index };
      continue;
    }
    const nextFence = fenceTransition(rawLine, fence);
    if (nextFence !== fence) {
      fence = nextFence;
      yield { text: rawLine, inFence: true, index };
      continue;
    }
    if (fence) {
      yield { text: rawLine, inFence: true, index };
      continue;
    }
    const line = stripLineComments(rawLine);
    yield { text: line, inFence: false, index };
  }
}

// Extract the content lines of EVERY section whose heading matches, including
// nested subsections, across the whole document. Three structures are honored so
// nothing normative silently escapes the fingerprint:
//   - Fenced code blocks (type/length-aware): a `# comment` inside a fence is not
//     a heading, so a snippet never truncates the section.
//   - Heading depth: a sibling or shallower heading ends the current section, but
//     a DEEPER (nested) heading and its content stay in.
//   - Duplicates: a second matching heading re-opens capture, so both sections'
//     content is included — a duplicate normative section is never dropped.
function extractSection(text, headingRe) {
  const out = [];
  let capturing = false;
  let capturedDepth = 0;
  for (const { text: line, inFence } of contentTokens(text)) {
    if (inFence) {
      if (capturing) out.push(line); // fenced content, never a heading
      continue;
    }
    // 0-3 spaces of indentation before a heading (4+ is code) and an optional
    // closing "#" sequence ("## X ##"), which is stripped from the text.
    const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      const depth = heading[1].length;
      if (capturing) {
        if (depth > capturedDepth) {
          out.push(line); // nested heading stays in the section
          continue;
        }
        capturing = false; // sibling/shallower heading ends the current section
      }
      if (headingRe.test(heading[2])) {
        capturing = true; // (re-)open on any matching heading, so duplicates count
        capturedDepth = depth;
      }
      continue;
    }
    if (capturing) out.push(line);
  }
  return out;
}

function normalizeLines(lines) {
  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

// Fingerprint-grade normalization: preserve SEMANTIC indentation (nested lists,
// fenced Python/YAML). Only strip trailing whitespace, collapse runs of blank
// lines to one, and drop leading/trailing blanks — so a meaning-changing
// re-indentation changes the fingerprint, closing a scope-drift bypass that a
// whitespace-collapsing normalizer would leave open.
function normalizeForFingerprint(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/g, "");
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// Real content = at least one letter or digit after HTML comments are removed;
// list punctuation, headings, fence markers, and comment placeholders don't count.
function isSubstantiveText(s) {
  return /[\p{L}\p{N}]/u.test(s.replace(/<!--[^]*?-->/g, ""));
}

// Collect only DECLARED acceptance IDs — an id that leads its own line/item with a
// non-empty criterion after it ("- AC1: preserve X"). A cross-reference in prose
// ("described by AC99"), an id inside a fenced example, and an empty declaration
// ("- AC1:" or "- AC1: <!-- TODO -->") are NOT usable acceptance criteria.
function parseAcceptanceIds(lines) {
  const ids = [];
  const seen = new Set();
  let duplicate = false;
  let fence = null;
  for (const raw of lines) {
    const nextFence = fenceTransition(raw, fence);
    if (nextFence !== fence) {
      fence = nextFence;
      continue;
    }
    if (fence) continue; // a fenced example is not a declaration
    const m = /^ {0,3}(?:[-*]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?(AC\d+)\b\s*:?\s*(.*)$/.exec(raw);
    if (m && isSubstantiveText(m[2])) {
      // A duplicate declaration is ambiguous — the id can no longer uniquely
      // reference one criterion — so it is a hard violation, like a duplicate id
      // in the marker.
      if (seen.has(m[1])) duplicate = true;
      else {
        seen.add(m[1]);
        ids.push(m[1]);
      }
    }
  }
  return { ids, duplicate };
}

// Parse verify steps WITHOUT losing multi-line content and WITHOUT mis-splitting:
// only a TOP-LEVEL list item starts a new step; nested (indented) items, fenced
// command blocks, and plain continuations attach to the current step, and a bare
// command block with no list becomes a single step. Classification is on the raw
// line (indentation preserved) with fence state tracked, so a "1." inside a code
// block is content, not a step boundary.
function parseVerifySteps(lines) {
  const steps = [];
  let current = null;
  let baseIndent = 0; // indentation of the current step's list marker
  let fence = null;
  const flush = () => {
    if (current !== null) {
      const text = current.replace(/\s+/g, " ").trim();
      // A step must carry a real instruction — a placeholder like "1. <!-- TODO -->"
      // or bare list punctuation is not a verification step.
      if (isSubstantiveText(text)) steps.push(text);
    }
    current = null;
  };
  for (const raw of lines) {
    const nextFence = fenceTransition(raw, fence);
    if (nextFence !== fence) {
      fence = nextFence; // fence marker line: skip, stay in the current step
      continue;
    }
    if (fence) {
      const inner = raw.trim();
      if (inner !== "") current = current === null ? inner : `${current} ${inner}`;
      continue;
    }
    if (/^ {0,3}#{1,6}\s/.test(raw)) continue; // a subsection heading is not a step
    const item = /^(\s*)(?:[-*]|\d+[.)])\s+(.*)$/.exec(raw);
    if (item) {
      const indent = item[1].length;
      // A new step starts only at the top level — an item indented DEEPER than the
      // current step's marker is a nested sub-item (a continuation). Indentation is
      // relative, so "  1. a" / "  2. b" are siblings while "1. a" / "   - b" nests.
      if (current === null || indent <= baseIndent) {
        flush();
        current = item[2];
        baseIndent = indent;
      } else {
        current = `${current} ${item[2]}`;
      }
      continue;
    }
    const rest = raw.trim();
    if (rest === "") continue;
    current = current === null ? rest : `${current} ${rest}`;
  }
  flush();
  return steps;
}

// True when a section matched by `targetRes` has substantive content of ITS OWN.
// Content nested under a subheading that belongs to ANOTHER normative section does
// NOT count — so a section that only nests other normative sections (e.g. a
// "## Что сделать" whose body is just "### Критерии приёмки", "### Как проверить",
// ...) is treated as empty. A nested subsection that is arbitrary (### Details) or
// a duplicate of the target still counts. Fence/indent/depth handled inline so it
// stays consistent with extractSection.
function hasOwnSectionContent(text, targetRes) {
  const allSectionRes = [
    SECTION_RE.objective,
    SECTION_RE.scope,
    SECTION_RE.desired,
    SECTION_RE.acceptance,
    SECTION_RE.verify,
    SECTION_RE.nonGoals,
    SECTION_RE.reviewGate,
  ];
  let depth = -1; // depth of the current target heading, or -1 when outside one
  let foreignDepth = 0; // >0 while inside a nested foreign-normative subsection
  for (const { text: line, inFence } of contentTokens(text)) {
    if (inFence) {
      if (depth >= 0 && !foreignDepth && isSubstantiveText(line)) return true;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      const hd = heading[1].length;
      if (depth >= 0 && hd > depth) {
        if (foreignDepth && hd > foreignDepth) continue; // still inside a foreign block
        const isForeign =
          allSectionRes.some((re) => re.test(heading[2])) && !targetRes.some((re) => re.test(heading[2]));
        foreignDepth = isForeign ? hd : 0;
        continue;
      }
      foreignDepth = 0;
      depth = targetRes.some((re) => re.test(heading[2])) ? hd : -1;
      continue;
    }
    if (depth >= 0 && !foreignDepth && isSubstantiveText(line)) return true;
  }
  return false;
}

function hasDescribedBehavior(text) {
  return hasOwnSectionContent(text, BEHAVIOR_HEADING_RES);
}

function computeScope(issueText) {
  // Strip the marker block first: when the marker is inline (--marker defaults to
  // the issue body), hashing the body verbatim would fold the marker's own
  // fingerprint field into a section, so the fingerprint emitted before the marker
  // is written would never match afterwards. A separate-comment marker leaves the
  // body unchanged.
  const body = stripMarkerBlock(issueText);
  const acceptanceLines = extractSection(body, SECTION_RE.acceptance);
  const verifyLines = extractSection(body, SECTION_RE.verify);
  const { ids: acceptanceIds, duplicate: acceptanceDuplicate } = parseAcceptanceIds(acceptanceLines);
  const verifySteps = parseVerifySteps(verifyLines);
  // Fingerprint = the FULL sha256 over the WHOLE marker-stripped Issue body,
  // minimally normalized (trailing whitespace + blank-line runs collapsed, leading
  // indentation preserved), NOT section-parsed. Any change anywhere in the body —
  // objective, scope, acceptance, verify, non-goals, review-gate, a heading rename,
  // or a re-indentation — changes the hash and invalidates the approval. This is
  // the maximally fail-closed drift boundary: it has no free-text-Markdown
  // section-parsing surface for drift to slip past (the section parsing below is
  // only for the oracle output, the risk cross-check, and completeness, where an
  // imperfect parse can never bypass the whole-body drift hash).
  const fingerprint = crypto
    .createHash("sha256")
    .update(normalizeForFingerprint(body.split(/\r?\n/)))
    .digest("hex");
  // A self-contained issue-only package must describe its behavior (objective /
  // scope / desired behavior) and its non-goals — not just acceptance + verify,
  // and a bare heading with no body under it does not satisfy either.
  return {
    acceptanceIds,
    acceptanceDuplicate,
    verifySteps,
    fingerprint,
    hasBehavior: hasDescribedBehavior(body),
    hasNonGoals: hasOwnSectionContent(body, [SECTION_RE.nonGoals]),
  };
}

// Read (never re-derive) the authoritative risk class recorded in the Issue's
// review-gate section. When the gate names more than one class (a "standard→deep"
// re-tier), the HIGHEST wins — ambiguity moves upward, never downward. Returns
// null when the section names no known class. The marker's Risk class field is
// then required to match this, so the marker cannot silently downgrade the Issue.
function extractReviewGateClass(issueText) {
  const body = stripMarkerBlock(issueText);
  // Count EXACT authoritative review-gate headings (fenced and HTML-commented ones
  // don't count). Zero → nothing to verify against; two or more → an ambiguous
  // duplicate. Either way return null so the resolver fails closed.
  let count = 0;
  for (const { text: line, inFence } of contentTokens(body)) {
    if (inFence) continue;
    const h = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (h && REVIEW_GATE_HEADING_RE.test(h[1].trim())) count += 1;
  }
  if (count !== 1) return null;
  const text = normalizeLines(extractSection(body, REVIEW_GATE_HEADING_RE)).toLowerCase();
  const classAt = (cls) => RISK_CLASSES.indexOf(cls);
  // The review-gate is free text with no structured class field, so the only
  // fail-closed reading is the HIGHEST class mentioned anywhere in the section —
  // ambiguity moves upward, never downward. Reading the first word (or only
  // re-tier targets) could be tricked into a downgrade by "standard was proposed;
  // Risk class: risky" or "risky; history: tiny→standard"; over-reading only ever
  // routes to the safe project-first lane.
  const classes = [...text.matchAll(/\b(tiny|standard|deep|risky)\b/g)].map((m) => m[1]);
  if (classes.length === 0) return null;
  return classes.reduce((hi, cls) => (classAt(cls) > classAt(hi) ? cls : hi));
}

// Indices of every REAL standalone marker line: 0-3 space indent, and outside any
// fenced code block AND any HTML comment. A prose mention, a fenced example, an
// indented-code example, or a commented-out example is never a marker — one
// discovery rule shared by findMarkerBlock and stripMarkerBlock so they can't drift.
function markerLineIndices(text) {
  const indices = [];
  for (const { text: line, inFence, index } of contentTokens(text)) {
    if (!inFence && MARKER_LINE_RE.test(line)) indices.push(index);
  }
  return indices;
}

// Locate the most-recent marker block (most-recent-wins) and parse its contiguous
// "Key: value" fields. Returns null when no real standalone marker line is present
// (a prose mention or a fenced/indented/commented example still resolves to
// project-first).
function findMarkerBlock(markerText) {
  const lines = markerText.split(/\r?\n/);
  const indices = markerLineIndices(markerText);
  if (indices.length === 0) return null;
  const markerIdx = indices[indices.length - 1]; // most-recent-wins
  const fields = {};
  const seen = new Set();
  let started = false;
  for (let i = markerIdx + 1; i < lines.length; i += 1) {
    // A field line indented 4+ columns (spaces, tabs, or a mix) is a Markdown
    // indented code block, not a real field — end the block. A marker whose fields
    // are all indented then collects no fields and fails the required-field check
    // (fail-closed), exactly like the fenced-fields case.
    if (lines[i].trim() !== "" && indentColumns(lines[i]) >= 4) break;
    const line = lines[i].trim();
    // A fence ALWAYS ends the block: a real marker's fields are plain text right
    // after the marker line, so a fence means the field-shaped lines inside it are
    // a documentation example, never authoritative fields. (A marker line whose
    // fields are all fenced then collects no fields and fails the required-field
    // check — fail-closed, never a silent issue-only.)
    if (/^(?:```|~~~)/.test(line)) break;
    if (line === "") {
      if (started) break;
      continue;
    }
    // Parse ANY field-shaped line — the key may hold letters, digits, spaces,
    // underscores, or hyphens — so a sixth field can never hide by using a
    // character the parser would otherwise skip past as end-of-block.
    const kv = /^([A-Za-z][A-Za-z0-9 _-]*?):\s*(.*)$/.exec(line);
    if (!kv) {
      // A nonblank line inside the machine block that is not a field is a
      // malformed marker — whether it appears BEFORE the first field (hiding a
      // punctuation-keyed field ahead of "Marker version") or after (a trailing
      // sixth field). Never an implicit terminator or a silently-skipped line.
      violation(`broken marker: unparseable line "${line}"`);
    }
    started = true;
    const key = kv[1].trim();
    const norm = normalizeKey(key);
    // A repeated field is ambiguous — a second value can mask the first (a
    // second "Risk class: standard" hiding a first "Risk class: deep"); reject.
    if (seen.has(norm)) violation(`broken marker: duplicate field "${key}"`);
    seen.add(norm);
    fields[key] = kv[2].trim();
  }
  return fields;
}

// Remove EVERY standalone, unfenced marker block from issue text so the scope
// fingerprint never hashes a marker. most-recent-wins parses only the newest as
// authoritative, but ALL blocks — including superseded ones left behind by an
// inline renewal — must leave the hashed scope, or an old block would bind stale
// marker metadata (its fingerprint / risk) into the fingerprint and review-gate.
function stripMarkerBlock(text) {
  const recognized = new Set(REQUIRED_MARKER_FIELDS.map(normalizeKey));
  const lines = text.split(/\r?\n/);
  for (;;) {
    const indices = markerLineIndices(lines.join("\n"));
    if (indices.length === 0) break;
    const markerIdx = indices[0]; // remove blocks one at a time, front to back
    // Drop the marker line and ONLY its contiguous recognized marker fields. A
    // non-marker line (blank, fence, or arbitrary Issue text like
    // "Endpoint: /admin/delete") ends the block and is never stripped, so
    // normative content after a superseded marker still binds the fingerprint.
    let end = markerIdx + 1;
    let started = false;
    for (; end < lines.length; end += 1) {
      const trimmed = lines[end].trim();
      if (trimmed === "") {
        if (started) break; // a blank after the fields ends the block
        continue; // leading blank before the first field — same as findMarkerBlock
      }
      // A 4+-column-indented line is Markdown code, not a marker field — end the
      // block (same terminator as findMarkerBlock), so indented content is never
      // stripped out of the whole-body fingerprint.
      if (indentColumns(lines[end]) >= 4) break;
      const kv = /^([A-Za-z][A-Za-z0-9 _-]*?):\s*/.exec(trimmed);
      if (kv && recognized.has(normalizeKey(kv[1]))) {
        started = true;
        continue;
      }
      break; // any other line ends the block and is never stripped
    }
    lines.splice(markerIdx, end - markerIdx);
  }
  return lines.join("\n");
}

function normalizeKey(key) {
  return key.toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

function parseIdList(value) {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Labels are split ONLY on commas so a full label name is compared as a whole — a
// label like "not issue-only" or "issue-only candidate" must NOT satisfy the exact
// "issue-only" opt-in by matching a bare word.
function parseLabels(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Compare two id lists as SETS (dedup both sides), so a repeated id can never
// pad the length to mask a missing required id.
function sameIdSet(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const entry of sa) {
    if (!sb.has(entry)) return false;
  }
  return true;
}

function readConfig(configPath) {
  const raw = readFileOrFail(configPath, "config");
  try {
    return JSON.parse(raw);
  } catch (error) {
    violation(`invalid config JSON: ${configPath} (${error.message})`);
    return null; // unreachable
  }
}

function projectFirstResult() {
  return {
    package_kind: "project-first",
    lifecycle_state_entity: "project",
    behavioral_oracle: null,
    risk_class: null,
    approval_status: "absent",
  };
}

function resolve(args) {
  const issueText = readFileOrFail(args.issue, "issue body");

  // Config opt-in gate. The issue-only lane is OFF by default: it activates only
  // when --config names it enabled AND designates a stable owner principal.
  // Structural corruption of `issueOnlyLane` (not an object, or a non-boolean
  // `enabled`) is a hard violation; every other shape — no --config, no
  // `issueOnlyLane`, `enabled !== true`, or a missing/empty `ownerPrincipal` —
  // simply leaves the lane un-opted-in (`laneOptedIn = false`), which fails
  // closed to project-first at the opt-in gate AFTER marker integrity is checked
  // below. Deferring the fail-closed decision keeps a corrupt marker hard-failing
  // even when no config is supplied. The resolver stays a pure structural /
  // eligibility gate: it requires the opt-in to be present and to name an owner,
  // but it does NOT authenticate the Linear comment author — that remains the
  // create-then-approve intake transaction's job.
  let laneOptedIn = false;
  if (args.config) {
    const config = readConfig(args.config);
    if (config && Object.prototype.hasOwnProperty.call(config, "issueOnlyLane")) {
      const lane = config.issueOnlyLane;
      // Fail closed on a structurally malformed lane: a stringly-typed `"false"`
      // (or a non-object lane) must never be mistaken for a valid opt-in.
      if (typeof lane !== "object" || lane === null || typeof lane.enabled !== "boolean") {
        violation("invalid config: issueOnlyLane must be an object with a boolean `enabled`");
      }
      // The opt-in must both enable the lane AND name a non-empty owner
      // principal (a stable Linear user ID). A missing/empty `ownerPrincipal`
      // leaves the lane un-opted-in rather than raising a violation — the
      // resolver fails closed, the project-config check is what flags it as a
      // misconfiguration.
      laneOptedIn =
        lane.enabled === true &&
        typeof lane.ownerPrincipal === "string" &&
        lane.ownerPrincipal.trim().length > 0;
    }
  }

  const markerText = args.marker ? readFileOrFail(args.marker, "marker") : issueText;
  const marker = findMarkerBlock(markerText);

  // No usable marker ⇒ project-first (fail-closed). Never silently issue-only.
  if (marker === null) return projectFirstResult();

  const normalizedKeys = new Map();
  for (const key of Object.keys(marker)) normalizedKeys.set(normalizeKey(key), marker[key]);

  // The marker is not a route-record.
  for (const forbidden of FORBIDDEN_MARKER_KEYS) {
    if (normalizedKeys.has(forbidden)) {
      violation(`broken marker: forbidden route-record field "${forbidden}" (маркер ≠ route-record)`);
    }
  }

  // EXACTLY these five, no more (references/issue-only-lane.md). Any other parsed
  // field is a hard violation, so the marker can never quietly grow a sixth field
  // beyond the 5-field contract and stay silently issue-only.
  const allowedKeys = new Set(REQUIRED_MARKER_FIELDS.map(normalizeKey));
  for (const key of normalizedKeys.keys()) {
    if (!allowedKeys.has(key)) {
      violation(`broken marker: unknown field "${key}" (marker carries exactly the five contract fields)`);
    }
  }

  for (const field of REQUIRED_MARKER_FIELDS) {
    if (!normalizedKeys.has(normalizeKey(field)) || normalizedKeys.get(normalizeKey(field)) === "") {
      violation(`broken marker: missing field "${field}"`);
    }
  }

  const versionRaw = normalizedKeys.get("marker version");
  if (String(Number(versionRaw)) !== String(versionRaw) || Number(versionRaw) !== MARKER_VERSION) {
    violation(`broken marker: unsupported marker version "${versionRaw}" (expected ${MARKER_VERSION})`);
  }

  const riskClass = normalizedKeys.get("risk class");
  if (!RISK_CLASSES.includes(riskClass)) {
    violation(`broken marker: invalid risk class "${riskClass}" (expected one of ${RISK_CLASSES.join(", ")})`);
  }

  // The marker's Risk class must MATCH the Issue's authoritative review-gate
  // class — the marker records the existing class, it never re-derives or
  // downgrades it. A marker claiming a lower class than the Issue's review-gate
  // (e.g. "standard" on a deep Issue) is rejected, closing the risk-downgrade
  // bypass of the Phase-1 envelope.
  const reviewGateClass = extractReviewGateClass(issueText);
  if (reviewGateClass === null) {
    violation("broken marker: issue body has no review-gate risk class to verify the marker against");
  }
  if (riskClass !== reviewGateClass) {
    violation(`broken marker: marker Risk class "${riskClass}" does not match the Issue review-gate class "${reviewGateClass}"`);
  }

  const scope = computeScope(issueText);
  // The behavioral oracle must be non-vacuous: an issue-only package proves
  // itself by its own acceptance criteria and verify steps, so the Issue must
  // carry at least one stable acceptance ID and at least one verify step. This
  // also rejects a marker whose "Acceptance IDs: ," parses to an empty list.
  if (scope.acceptanceIds.length === 0 || scope.verifySteps.length === 0) {
    violation("broken marker: issue-only requires at least one acceptance ID and one verify step");
  }
  if (scope.acceptanceDuplicate) {
    violation("broken marker: duplicate Acceptance ID declared in issue body");
  }
  // A self-contained Issue must also describe its behavior and its non-goals —
  // otherwise the lane would bypass Project/PRD/Spec with an undescribed contract.
  if (!scope.hasBehavior || !scope.hasNonGoals) {
    violation("broken marker: issue-only requires a described scope/behavior and explicit non-goals (self-contained Issue)");
  }

  const markerAcceptanceIds = parseIdList(normalizedKeys.get("acceptance ids"));
  if (new Set(markerAcceptanceIds).size !== markerAcceptanceIds.length) {
    violation("broken marker: duplicate Acceptance IDs in marker");
  }
  if (!sameIdSet(markerAcceptanceIds, scope.acceptanceIds)) {
    violation("broken marker: acceptance IDs do not match issue body");
  }

  const markerFingerprint = normalizedKeys.get("scope fingerprint");
  if (markerFingerprint !== scope.fingerprint) {
    violation(`stale marker: scope fingerprint mismatch (marker ${markerFingerprint} vs body ${scope.fingerprint})`);
  }

  // Config opt-in gate (fail-closed). Even a fully valid, integrity-checked
  // marker resolves to project-first unless the project opted the lane in via
  // --config (issueOnlyLane.enabled === true with a non-empty ownerPrincipal).
  // This runs AFTER every marker-integrity violation above, so a corrupt marker
  // still hard-fails regardless of whether the lane is opted in — integrity is
  // never conditional on the opt-in.
  if (!laneOptedIn) {
    return projectFirstResult();
  }

  // Phase-1 eligibility envelope — checked only AFTER every integrity gate above,
  // so a corrupt deep/risky marker (stale fingerprint, mismatched acceptance IDs)
  // still hard-fails rather than silently falling back. A structurally valid
  // marker recording deep/risky is not corrupt — it is out of the envelope, so it
  // resolves to the safe project-first lane. deep/risky keeps full ceremony until
  // the Phase-3 safety modules land.
  if (!LANE_ELIGIBLE_RISK.includes(riskClass)) {
    return projectFirstResult();
  }

  // Second, human-visible opt-in factor: the verified `issue-only` Linear label.
  // The marker is machine-authoritative; the label is the filterable owner-facing
  // signal. `--label` is trusted input the caller supplies after reading Linear;
  // when the label is absent or unverified, the lane fails closed to
  // project-first. Atomically writing marker+label is the create-then-approve
  // intake transaction's job (a later slice).
  const verifiedLabels = new Set(parseLabels(args.label));
  if (!verifiedLabels.has(ISSUE_ONLY_LABEL)) {
    return projectFirstResult();
  }

  // Owner start-approval must be present AND fresh AND caller-verified. The
  // marker's Approval token is self-attested text; on its own it proves nothing.
  // `--approval-verified` is the fingerprint the caller confirmed against the
  // authenticated owner comment in Linear (the create-then-approve receipt). The
  // lane activates only when the marker's recorded approval, the live scope
  // fingerprint, and the caller-verified fingerprint all agree; anything else
  // (absent, stale/superseded, or unverified) fails closed to project-first. The
  // resolver enforces freshness and provenance-agreement; owner authenticity is
  // established upstream by the create-then-approve intake transaction.
  const markerApproval = (normalizedKeys.get("approval") || "").trim().split(/\s+/)[0] || "";
  const approvalFresh =
    markerApproval === scope.fingerprint && args.approvalVerified === scope.fingerprint;
  if (!approvalFresh) {
    return projectFirstResult();
  }

  return {
    package_kind: "issue-only",
    lifecycle_state_entity: "issue",
    behavioral_oracle: {
      kind: "issue-verification",
      acceptance_ids: scope.acceptanceIds,
      verify_steps: scope.verifySteps,
    },
    risk_class: riskClass,
    approval_status: "approved-fresh",
  };
}

const args = parseArgs(process.argv.slice(2));

if (args.emitFingerprint) {
  const issueText = readFileOrFail(args.issue, "issue body");
  process.stdout.write(`${computeScope(issueText).fingerprint}\n`);
  process.exit(0);
}

const result = resolve(args);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(0);
