#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { atomicJson, readJson, isMain, deliveryConfig, RISK_KEYS, withLock, baseModelConfig, validateLanding, packLayout, runtimePackRoot } from "../runtime.mjs";
import { commandFlags, allowedFlags, sha256File } from "./command-state.mjs";
import { extractSnapshot, section } from "./snapshot.mjs";
import { preapplyManifest, preapplyMandate, applyPreapply } from "./preapply.mjs";
import { workerTransport } from "../worker-transport.mjs";
import { spawnWorker } from "./launch.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const q = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const git = (cwd, ...args) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const run = (script, args, options = {}) => {
  try { return execFileSync(process.execPath, [path.join(directory, script), ...args], { encoding: "utf8", ...options }); }
  catch (error) { throw new Error([error.stdout, error.stderr, error.message].filter(Boolean).join("\n")); }
};
const read = (dir, name) => fs.readFileSync(path.join(dir, name), "utf8");

export function renderDispatch(template, values, pilot = false) {
  let source = template.replace(/<!-- generator:start -->[\s\S]*?<!-- generator:end -->\s*/u, "");
  if (values.landing_paths === undefined) source = source.replace(/<!-- landing:start -->[\s\S]*?<!-- landing:end -->\s*/u, "");
  if (!pilot) source = source.replace(/<!-- review-pilot:start -->[\s\S]*?<!-- review-pilot:end -->\s*/u, "");
  if (values.transport !== "claude-cli") source = source.replace(/<!-- claude-delivery:start -->[\s\S]*?<!-- claude-delivery:end -->\s*/u, "");
  const rendered = source.replace(/\{\{([^{}]+)\}\}/gu, (_, key) => {
    if (!Object.hasOwn(values, key) || values[key] === undefined || values[key] === null || String(values[key]).trim() === "")
      throw new Error(`unfilled dispatch placeholder: ${key}`);
    return String(values[key]);
  });
  if (/\{\{[^{}]*\}\}/u.test(rendered)) throw new Error("unfilled dispatch placeholders remain");
  return rendered;
}

export async function dispatch(args) {
  if (!path.isAbsolute(args.root ?? "")) throw new Error("absolute --root required");
  return withLock(path.join(args.root, "dispatch.lock"), () => prepareDispatch(args));
}

async function prepareDispatch(args) {
  allowedFlags(args, ["issue", "root", "config", "snapshot", "risk", "critical", "profile", "handshake", "role", "reason", "full-snapshot", "preapply",
    "skills-root", "moves", "gates", "open-decisions", "verification", "review-dataset", "review-dataset-version", "review-pilot", "worker-writable-roots", "release"]);
  if (args.release !== undefined && !["true", "false"].includes(args.release)) throw new Error("--release must be true or false");
  const release = args.release === "true";
  const issue = args.issue;
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(issue)) throw new Error("valid --issue required");
  for (const key of ["root", "config", "snapshot"]) if (!path.isAbsolute(args[key] ?? "")) throw new Error(`absolute --${key} required`);
  const config = readJson(args.config), settings = config.orchestration?.dispatch ?? {};
  const repo = path.dirname(path.dirname(args.config));
  const layout = packLayout(runtimePackRoot()), packRoot = layout.root;
  const skillsRoot = args["skills-root"] ?? path.join(os.homedir(), '.codex/skills');
  const installed = layout.identity();
  let body = read(args.snapshot, `issue-${issue}.md`), approval = read(args.snapshot, "approval.md");
  const issueOnly = fs.existsSync(path.join(args.snapshot, "issue-only.json"));
  const lane = issueOnly ? readJson(path.join(args.snapshot, "issue-only.json")) : null;
  const brief = issueOnly ? "n/a (issue-only)" : read(args.snapshot, "project-brief.md");
  const prd = issueOnly ? "n/a (issue-only)" : read(args.snapshot, "prd.md");
  const spec = issueOnly ? "n/a (issue-only)" : read(args.snapshot, "tech-spec.md");
  const manifest = preapplyManifest(body, prd, spec, issueOnly), mandate = preapplyMandate(config);
  if (manifest && !mandate) throw new Error("preapply section requires orchestration.preapply.mandate");
  if (manifest && !args.preapply) throw new Error("preapply section requires --preapply before spawn");
  if (args.preapply && !manifest) throw new Error("--preapply requires a preapply manifest");
  if (manifest && !issueOnly && !manifest.alreadyMaterialized) body = body.replace(/\n*$/u, "\n\n") + manifest.materialized;
  const risk = args.risk ?? settings.risk ?? /(?:Риск|risk_class)\s*[:=]\s*(tiny|standard|deep|risky)/u.exec(body)?.[1];
  const critical = args.critical ?? settings.critical ?? null;
  if (!RISK_KEYS.slice(0, 4).includes(risk) || (critical !== null && (risk !== "risky" || !critical.trim()))) throw new Error("approved risk/critical required");
  const afk = /\bAFK\b/u.test(section(body, "Готовность агента", true));
  const openDecisions = Number(args["open-decisions"] ?? settings.openDecisions);
  if (!Number.isInteger(openDecisions) || openDecisions < 0) throw new Error("--open-decisions must explicitly count unresolved decisions");
  let profile = args.profile ?? (args["full-snapshot"] || !["tiny", "standard"].includes(risk) || critical || !afk || openDecisions ? "full" : "short");
  const handshake = args.handshake ?? "resume";
  if (!["wait", "resume"].includes(handshake) || !["short", "full"].includes(profile)) throw new Error("invalid handshake/profile");
  if (profile === "short" && (!["tiny", "standard"].includes(risk) || critical !== null || !afk || openDecisions !== 0)) throw new Error("short requires tiny/standard, critical null, afk true, openDecisions 0");
  const extracts = !issueOnly && profile === "short" && !args["full-snapshot"] ? extractSnapshot(body, prd, spec) : { full: profile === "full", prd, spec, note: issueOnly ? "Issue-only snapshot: Issue, approval, marker and label." : "Full snapshot requested." };
  if (args["full-snapshot"] || extracts.full) profile = "full";
  const moves = args.moves ? readJson(args.moves) : settings.lifecycle_moves;
  if (!Array.isArray(moves)) throw new Error("--moves or orchestration.dispatch.lifecycle_moves required (empty array for no moves)");
  const defaultGates = ["pack identity gate", "snapshot package context", "approval plus mono:review handoff findings", "5-field context seam"];
  const gates = args.gates ? readJson(args.gates) : moves.length ? [...defaultGates, ...(issueOnly ? ["delivery check"] : [])] : [];
  if (!Array.isArray(gates) || new Set(gates).size !== gates.length || gates.some(gate => typeof gate !== "string" || !gate.trim())) throw new Error("invalid gates");
  const verification = args.verification ? readJson(args.verification) : settings.verification;
  if (typeof verification?.command !== "string" || !verification.command.trim() || !Array.isArray(verification.args) || verification.args.some(arg => typeof arg !== "string")) throw new Error("explicit verification command/args required");
  if (!approval.trim()) throw new Error("nonempty approval record required");
  const seam = lane?.seam ?? { package_kind: "project-first", lifecycle_state_entity: "project", behavioral_oracle: null, risk_class: risk,
    approval_status: /approval_status\s*=\s*(approved|pending|rejected)/u.exec(body + "\n" + approval)?.[1] ?? "approved" };
  if (issueOnly && (seam.package_kind !== "issue-only" || seam.approval_status !== "approved-fresh" || !lane.marker || !lane.label || !lane.ownerApproval || !lane.config ||
      typeof lane.fingerprint !== "string" || !lane.fingerprint.trim())) throw new Error("complete issue-only snapshot with nonempty fingerprint required");
  const attemptsFile = path.join(args.root, "attempts.json"), attempt = (fs.existsSync(attemptsFile) ? readJson(attemptsFile)[issue] ?? 0 : 0) + 1;
  const worktree = path.join(repo, ".worktrees", issue), branch = `mono/${issue.toLowerCase()}`;
  git(repo, "fetch", "origin", "main");
  const base = git(repo, "rev-parse", "origin/main");
  const baseConfig = baseModelConfig(repo, base);
  const landing = validateLanding(baseConfig);
  const transport = workerTransport(baseConfig.orchestration?.transport ?? "codex-cli");
  const role = args.role ?? transport?.workerRoles[0], reason = args.reason ?? null;
  if (!transport?.workerRoles.includes(role)) throw new Error("unsupported managed worker role/transport on BASE");
  if (role === transport.complexRole && !reason?.trim()) throw new Error("complex worker requires --reason");
  if (!transport.handshakeModes.includes(handshake)) throw new Error(transport.transport + " requires handshake " + transport.handshakeModes.join(" or "));
  if (!fs.existsSync(worktree)) git(repo, "worktree", "add", "-b", branch, worktree, base);
  const actualBranch = git(worktree, "branch", "--show-current");
  if (actualBranch !== branch) throw new Error("existing dispatch worktree has another branch");
  const product = settings.product ?? config.projectName?.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(product ?? "")) throw new Error("product slug required");
  const evidenceRoot = settings.evidenceRoot ?? path.join(os.homedir(), ".mono-agent-workflow/evidence", product);
  const extras = args["worker-writable-roots"] ? readJson(args["worker-writable-roots"]) : [fs.realpathSync(os.tmpdir())];
  if (!Array.isArray(extras) || extras.some(root => !path.isAbsolute(root))) throw new Error("absolute worker writable roots required");
  fs.mkdirSync(path.join(args.root, "reports"), { recursive: true });
  const roots = [...new Set([path.join(args.root, "reports"), worktree, git(worktree, "rev-parse", "--absolute-git-dir"), git(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"), ...extras].map(value => fs.realpathSync(value)))].sort();
  const output = path.join(args.root, "dispatch", `${issue}-a${attempt}`);
  fs.mkdirSync(output, { recursive: true });
  const gateFile = path.join(output, "start-gate.json"), spawnFile = path.join(output, "spawn.json"), pinsFile = path.join(output, "pins.json"), dispatchFile = path.join(output, "dispatch.md"), movesFile = path.join(output, "moves.json");
  const gate = { worktree, branch, base, packRoot, skillsRoot, packVersion: installed.packVersion, sourceCommit: installed.sourceCommit, surfaceRevision: installed.surfaceRevision };
  const modelFile = path.join(output, "model-request.json"); atomicJson(modelFile, { ...gate, role });
  const modelRoutes = JSON.parse(run("spawn.mjs", ["--pins", modelFile]));
  const pins = { ...gate, release, modelRoutes, product, root: args.root, skillsRoot, evidenceRoot, verification, baseRef: "origin/main", handshake, profile,
    risk, critical, afk, openDecisions, workerWritableRoots: roots, packageKind: seam.package_kind,
    reviewDataset: args["review-dataset"] ?? settings.reviewDataset ?? null, reviewDatasetVersion: Number(args["review-dataset-version"] ?? settings.reviewDatasetVersion ?? 0) };
  pins.reviewDatasetDigest = pins.reviewDataset ? sha256File(pins.reviewDataset) : null;
  if (!pins.reviewDataset) pins.reviewDatasetVersion = 0;
  atomicJson(pinsFile, pins); const pinsDigest = sha256File(pinsFile);
  fs.writeFileSync(path.join(output, "pins.sha256"), `${pinsDigest}\n`);
  atomicJson(gateFile, gate); atomicJson(movesFile, moves);
  const snapshot = path.join(output, "snapshot"), preparedSnapshot = fs.mkdtempSync(path.join(output, "snapshot-"));
  try {
    for (const name of [`issue-${issue}.md`, "approval.md", ...(issueOnly ? ["issue-only.json"] : ["project-brief.md", ...(profile === "full" ? ["prd.md", "tech-spec.md"] : [])])]) fs.copyFileSync(path.join(args.snapshot, name), path.join(preparedSnapshot, name));
    fs.writeFileSync(path.join(preparedSnapshot, `issue-${issue}.md`), body);
    if (!issueOnly && profile === "short") { fs.writeFileSync(path.join(preparedSnapshot, "prd-extract.md"), extracts.prd); fs.writeFileSync(path.join(preparedSnapshot, "spec-extract.md"), extracts.spec); }
    // A refused attempt reuses its directory. Replace its complete composition
    // only after capturing inputs, which may themselves be the prior snapshot.
    fs.rmSync(snapshot, { recursive: true, force: true }); fs.renameSync(preparedSnapshot, snapshot);
  } finally { fs.rmSync(preparedSnapshot, { recursive: true, force: true }); }
  const request = { ...gate, root: args.root, issue, role, modelRoutes, modelReason: reason, transport: transport.transport, dispatchFile, evidenceRoot,
    writable_roots: extras, workerWritableRoots: roots, gates, lifecycle_moves: moves, config: args.config, product_name: product, handshake, profile,
    pins: { file: pinsFile, digest: pinsDigest }, pinsVersion: 0, risk, critical, afk, openDecisions };
  atomicJson(spawnFile, request);
  const identityCommand = `node ${q(path.join(directory, "../verify-pack-state.mjs"))} identity --pack-root ${q(packRoot)} --pack-version ${q(installed.packVersion)}${installed.sourceCommit ? ` --source-commit ${q(installed.sourceCommit)}` : ""} --surface-revision ${q(installed.surfaceRevision)}`;
  const ack = path.join(args.root, "reports", `${issue}-gate-ack-a${attempt}.json`);
  const fallbackAck = path.join(worktree, ".orchestrator", `${issue}-gate-ack-a${attempt}.json`);
  const waitCommand = location => `node ${q(path.join(directory, "../delivery-state.mjs"))} wait-ack --root ${q(args.root)} --issue ${q(issue)} --attempt ${q(attempt)} --ack ${q(location)} --moves ${q(movesFile)} --config ${q(args.config)}`;
  const collectionRequest = { product, root: pins.root, worktree, head: "HEAD", collectionId: "preflight-collect:HEAD:1", packRoot, skillsRoot,
    baseRef: pins.baseRef, evidenceRoot, modelRoutes: pins.modelRoutes, verification: pins.verification, risk: pins.risk, critical: pins.critical,
    workerWritableRoots: pins.workerWritableRoots, ...(pins.reviewDataset ? { reviewDataset: pins.reviewDataset } : {}),
    reviewDatasetVersion: pins.reviewDatasetVersion, pins: { file: pinsFile, digest: pinsDigest }, collect: false };
  const values = { issue, title: body.split("\n")[0].replace(/^#+\s*/u, ""), attempt, handshake, profile, pins_file: pinsFile, pins_digest: pinsDigest,
    collection_request: JSON.stringify(collectionRequest, null, 2),
    gate_request: gateFile, runtime_scripts: path.resolve(directory, ".."), product, evidence_root: evidenceRoot, model_routes: JSON.stringify(modelRoutes),
    preflight_pins: JSON.stringify(pins), writable_roots: JSON.stringify(roots), confirmation_timeout: deliveryConfig(config).confirmationTimeoutSec,
    worktree, branch, pack_version: installed.packVersion, source_commit: installed.sourceCommit ?? "not provided (plugin)", pack_root: packRoot, surface_revision: installed.surfaceRevision,
    outcome: section(body, "Что сделать", true), verification_items: section(body, "Как проверить", true), constraints: section(body, "Ключевые контракты") || section(body, "Что не входит", true),
    budget: settings.budget ?? "~4 hours", transport: transport.transport, delivery_skill: layout.skill("deliver"), identity_command: identityCommand,
    mailbox: path.join(args.root, "reports"), fallback: path.join(worktree, ".orchestrator"),
    project_brief: brief, prd: extracts.prd, spec: extracts.spec, issue_body: body, approval, marker: lane?.marker ?? "n/a (project-first)", label: lane?.label ?? "n/a (project-first)",
    fingerprint: issueOnly ? lane.fingerprint : "n/a (project-first)", issue_only_config: lane?.config ?? "n/a (project-first)", owner_approval: lane?.ownerApproval ?? "n/a (project-first)",
    context_seam: JSON.stringify(seam), decisions: approval, moves: JSON.stringify(moves), gates: JSON.stringify(gates), gate_ack: ack,
    wait_or_resume: moves.length ? handshake === "wait" ? `After writing ack run exactly one matching blocking shell command. If you wrote the mailbox ack: ${waitCommand(ack)}. If mailbox writing was denied and you wrote the fallback ack: ${waitCommand(fallbackAck)}. Use the actual file you wrote; never create both. Do no other work while it runs. Deadline ack mtime + ackWaitSec; expiry parks write-unconfirmed and exits. Valid own consumption read-backs amend state: post-move delivery check, no identity rerun. Blocked ack precedes terminal report.` : "Stop/exit after ack; resume amendment must contain every applied move/read-back; rerun identity/check. Blocked ack precedes terminal report." : "Gate phase: not applicable — this dispatch carries no lifecycle move.",
    snapshot_note: extracts.note ?? "Referenced definitions with transitive coverage and always-included common sections", spawn_request: spawnFile, base };
  if (landing) Object.assign(values, { landing_paths: landing.serialPaths?.length ? landing.serialPaths.map(p => `\`${p}\``).join(", ") : "не заданы",
    landing_fragments: landing.changelog?.fragmentDir ?? "не задан", landing_release: String(release) });
  const pilot = args["review-pilot"] ? readJson(args["review-pilot"]) : null;
  if (pilot) Object.assign(values, { review_project: pilot.project, dataset_version: pilot.version, dataset_path: pilot.path, dataset_digest: pilot.digest });
  const template = fs.readFileSync(layout.template("orchestrator-dispatch.md"), "utf8");
  fs.writeFileSync(dispatchFile, renderDispatch(template, values, Boolean(pilot)));
  let originalHead, preapplied = null, preapplyLine = null;
  const ledgerFile = path.join(args.root, "ledger.md");
  const beforeStart = () => {
    originalHead = git(worktree, "rev-parse", "HEAD");
    preapplied = manifest ? applyPreapply(worktree, issue, manifest) : null;
    preapplyLine = preapplied ? `PREAPPLY ${issue} ${preapplied.commit} per mandate ${mandate}` : null;
    if (preapplied && (!fs.existsSync(ledgerFile) || !fs.readFileSync(ledgerFile, "utf8").split("\n").some(line => line.endsWith(` ${preapplyLine}`)))) {
      const stamp = execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim();
      const fd = fs.openSync(path.join(args.root, "ledger.md"), "a");
      try { fs.writeSync(fd, `- ${stamp} ${preapplyLine}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    if (preapplied) fs.appendFileSync(dispatchFile, `\n## Предприменённые изменения\n\nКоммит: ${preapplied.commit}\n\n| path | sha256 |\n| --- | --- |\n${preapplied.files.map(file => `| ${file.path} | ${file.sha256} |`).join("\n")}\n`);
    const gateOutput = run("../gate.mjs", ["start", "--request", gateFile]);
    if (!gateOutput.includes("gate start: pass")) throw new Error(gateOutput.trim());
  };
  const onRefusal = () => {
    if (!preapplied?.created) return;
    const used = fs.existsSync(attemptsFile) ? readJson(attemptsFile)[issue] ?? 0 : 0;
    if (used < attempt && git(worktree, "rev-parse", "HEAD") === preapplied.commit && !git(worktree, "status", "--porcelain", "--untracked-files=all")) {
      git(worktree, "reset", "--hard", originalHead);
      preapplied.restoreFiles();
      if (fs.existsSync(ledgerFile)) fs.writeFileSync(ledgerFile, fs.readFileSync(ledgerFile, "utf8").split("\n").filter(line => !line.endsWith(` ${preapplyLine}`)).join("\n"));
    }
  };
  const launched = await spawnWorker(request, { beforeStart, onRefusal });
  const stamp = execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim();
  const fd = fs.openSync(path.join(args.root, "ledger.md"), "a");
  try { fs.writeSync(fd, `- ${stamp} DISPATCHED ${issue} a${launched.attempt}: ${dispatchFile}; pins ${pinsDigest}; profile ${profile}; snapshot ${extracts.note ?? "extracts"}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { ...launched, pins: request.pins, gateFile, dispatchFile, spawnFile, snapshot };
}

if (isMain(import.meta.url)) {
  try {
    const args = commandFlags(process.argv.slice(2), ["preapply", "full-snapshot"]);
    if (args.help) console.log("Usage: dispatch.mjs --issue KEY --root DIR --config FILE --snapshot DIR [--risk tiny|standard|deep|risky] [--critical TEXT] [--profile short|full] [--handshake wait|resume] [--role worker-default|worker-complex|worker-claude --reason TEXT] [--preapply] [--full-snapshot] [--release true|false]\nExplicit facts: --moves JSON --open-decisions N --verification JSON [--gates JSON] [--skills-root DIR] [--worker-writable-roots JSON] [--review-dataset FILE --review-dataset-version N] [--review-pilot JSON]. Facts may use orchestration.dispatch config defaults. --preapply applies approved .agents/ bytes under a configured mandate before start gates. Project repo derives from the config path; worktree .worktrees/KEY and branch mono/key start at origin/main. Issue-only uses issue-only.json with marker/label/fingerprint/config/ownerApproval/seam; no Project docs. Every pre-spawn refusal leaves attempts unregistered.");
    else console.log(JSON.stringify(await dispatch(args)));
  } catch (error) { console.error(`dispatch: ${error.message}`); process.exitCode = 1; }
}
