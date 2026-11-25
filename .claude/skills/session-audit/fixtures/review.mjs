// Invented sources of the mandatory layer for the weekly analysis tests:
// orchestrator ledger lines with signals, phase reports, a review receipt,
// one session whose version is known only by its install path, a
// CHANGELOG with fragments for fixed_in, and a fake Linear that answers like
// the MCP calls of the session. Nothing here comes from real sessions.

import fs from "node:fs";
import path from "node:path";

import { loadBody } from "./pack.mjs";
import { BOUNDARY, IDS, NOW, at, claude, jsonl } from "./sessions.mjs";

export const REVIEW_IDS = {
  byPath: "99999999-1111-4111-8111-111111111111",
};

export const PROJECT = "00000000-0000-4000-8000-00000000f00d";
export const TEAM = "Fixture team";

// Adds signal sources to a world from buildWorld; returns their paths.
export function addSignalSources(world) {
  const { orch, home } = world;
  const ledger = path.join(orch, "ledger.md");
  fs.appendFileSync(ledger, [
    `- ${at(BOUNDARY, 404)} ALPHA-12 worker ${IDS.worker} parked: needs-human`,
    `- ${at(BOUNDARY, 406)} ALPHA-14 dispatch attempt 2`,
    `- ${at(BOUNDARY, 407)} owner stopped ALPHA-15 and asked for a smaller scope`,
    ...["ALPHA-20", "ALPHA-21", "ALPHA-22", "ALPHA-23"].map((key) => `- ${at(BOUNDARY, 500)} ${key} DISPATCHED`),
    "",
  ].join("\n"));
  const reports = path.join(orch, "reports");
  // Phase reports as the workflow publishes them: no start or finish field,
  // only publishedAt; a phase lasts from the dispatch or the previous report.
  const phase = (name, minutes, extra = {}) => {
    fs.writeFileSync(path.join(reports, name), JSON.stringify({ issue: name.split("-code")[0], stage: "mono-deliver", phase: "code", attempt: 1, sequence: 1, kind: "phase", phase_result: "implemented-needs-preflight", publishedAt: at(BOUNDARY, 500 + minutes), ...extra }));
  };
  phase("ALPHA-20-code.json", 10);
  phase("ALPHA-21-code.json", 12);
  phase("ALPHA-22-code.json", 60, { session: IDS.codexOwner });
  phase("ALPHA-23-code.json", 11, { attempt: 2, phase_result: "blocked" });
  // Tester reports keep the verdict inside the `mono-qa certificate` string.
  const qa = path.join(orch, "qa");
  fs.mkdirSync(qa, { recursive: true });
  const certificate = (issue, verdict) => `mono-qa certificate\n${JSON.stringify({ scope: "task", issue, verdict, mode: "ship", recordedAt: at(BOUNDARY, 530) })}`;
  fs.writeFileSync(path.join(qa, "ALPHA-24-failed.json"), JSON.stringify({ issue: "ALPHA-24", certificate: certificate("ALPHA-24", "failed") }));
  fs.writeFileSync(path.join(qa, "ALPHA-25-passed.json"), JSON.stringify({ issue: "ALPHA-25", certificate: certificate("ALPHA-25", "passed") }));
  const history = path.join(home, ".mono-agent-workflow", "evidence", "alpha", "history");
  fs.mkdirSync(history, { recursive: true });
  const receipt = path.join(history, "r-0001.json");
  fs.writeFileSync(receipt, JSON.stringify({ receipt: { recordedAt: at(BOUNDARY, 520), review: { outcome: "not-converged", round: 2 } } }));
  return { ledger, receipt, longReport: path.join(reports, "ALPHA-22-code.json"), blockedReport: path.join(reports, "ALPHA-23-code.json") };
}

// A Claude session that loaded implement from a pack cache path of 0.2.0
// whose text matches no tag: its version is «не подтверждена» with a hint.
export function addPathHintSession(world) {
  const dir = path.join(world.home, ".claude", "plugins", "cache", "mono-marketplace", "mono", "0.2.0", "skills", "implement");
  const c = claude(REVIEW_IDS.byPath, world.alpha);
  const file = path.join(world.projectDir, `${REVIEW_IDS.byPath}.jsonl`);
  jsonl(file, [
    c.user(at(BOUNDARY, 600), "Implement the invented change."),
    c.load(at(BOUNDARY, 601), dir, `${loadBody("v0.2.0", "implement")}\nA line edited locally.\n`),
    c.say(at(BOUNDARY, 602), "The invented change is done."),
  ]);
  fs.utimesSync(file, new Date(NOW), new Date(NOW));
  return file;
}

export function writeChangelog(repo, fragments) {
  const lines = ["# Changelog", "", "## [Unreleased]", ""];
  for (const [version, keys] of Object.entries(fragments)) {
    lines.push(`## [${version}] - 2026-11-20`, "");
    for (const key of keys) lines.push(`<!-- fragment: ${key} sha256:${"0".repeat(64)} -->`, "Invented change.", "");
  }
  fs.writeFileSync(path.join(repo, "CHANGELOG.md"), lines.join("\n"));
}

// Event key (record uuid) of the first record of a JSONL session file whose
// text contains the needle.
export function eventKey(file, needle) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.includes(needle)) return JSON.parse(line).uuid;
  }
  throw new Error(`no record with ${needle} in ${file}`);
}

// A fake Linear workspace answering like the MCP tools the session uses.
// `lose` makes the next create succeed in Linear while the answer is lost.
export function fakeLinear() {
  let next = 1;
  const documents = [];
  const issues = [];
  const comments = [];
  const rewrite = (text) => String(text).replace(/^(\s*)- /gm, "$1* ");
  const api = {
    documents, issues, comments,
    seedIssue(fields) { issues.push({ createdAt: "2026-10-01T00:00:00.000Z", ...fields }); return fields; },
    seedComment(issueId, body, createdAt = "2026-10-02T00:00:00.000Z") { comments.push({ id: `c-${next++}`, issueId, body, createdAt }); },
    save_document({ project, team, title, content, id }, now) {
      if (id) {
        const doc = documents.find((candidate) => candidate.id === id);
        doc.content = rewrite(content);
        doc.title = title;
        doc.updatedAt = now;
        return { ...doc };
      }
      const doc = { id: `doc-${next++}`, title, content: rewrite(content), url: `https://linear.app/fixture/document/doc-${next}`, ...(team ? { team: { id: `team-${team.length}`, name: team } } : { project: { id: project } }), createdAt: now, updatedAt: now };
      documents.push(doc);
      return { ...doc };
    },
    save_issue({ id, team, state, title, description }, now) {
      if (id) {
        const issue = issues.find((candidate) => candidate.id === id || candidate.identifier === id);
        issue.status = state;
        issue.statusType = state.toLowerCase();
        return { ...issue };
      }
      const number = 1000 + next++;
      const issue = { id: `MONO-${number}`, identifier: `MONO-${number}`, title, description: rewrite(description), status: state, statusType: state.toLowerCase(), team, url: `https://linear.app/fixture/issue/MONO-${number}`, createdAt: now };
      issues.push(issue);
      return { ...issue };
    },
    save_comment({ issueId, body }, now) {
      const comment = { id: `c-${next++}`, issueId, body, createdAt: now };
      comments.push(comment);
      return { ...comment };
    },
    call(call, now) { return api[call.tool](call.args, now); },
    commentsOf(issueId) { return comments.filter((comment) => comment.issueId === issueId); },
  };
  return api;
}
