#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { atomicJson, readJson, digest, canonical, withLock, isMain } from "../runtime.mjs";
import { registryEntry, commandFlags, allowedFlags } from "./command-state.mjs";
import { consumeAck } from "./consume-gate-ack.mjs";

function validatedAck(root, issue, attempt, outcome) {
  const entry = registryEntry(root, issue, attempt);
  if (path.basename(entry.log) !== `${issue}-mono-deliver-a${attempt}.jsonl`) throw new Error("ack log not registry-correlated");
  const file = path.join(root, "consumed", `${issue}-gate-ack-a${attempt}.json`);
  const prior = fs.existsSync(file) ? readJson(file) : null;
  const candidates = [path.join(root, "reports", `${issue}-gate-ack-a${attempt}.json`), path.join(entry.worktree, ".orchestrator", `${issue}-gate-ack-a${attempt}.json`)].filter(name => fs.existsSync(name));
  if (candidates.length > 1 || (!prior && candidates.length !== 1)) throw new Error("ack absent or in both locations");
  if (candidates.some(name => fs.statSync(name).mtimeMs > Date.now())) throw new Error("future-dated ack");
  const ack = candidates.length ? readJson(candidates[0]) : prior.ack;
  const gates = prior?.gates ?? entry.gates;
  if (ack.issue !== issue || ack.phase !== "gate") throw new Error("ack identity mismatch");
  if (outcome !== "rejected" && (!Array.isArray(gates) || !gates.length || new Set(gates).size !== gates.length ||
      !Array.isArray(ack.gates) || !ack.gates.length || new Set(ack.gates.map(gate => gate.gate)).size !== ack.gates.length ||
      ack.gates.some(gate => !gates.includes(gate.gate) || !["pass", "blocked"].includes(gate.status) || !gate.evidence?.trim()))) throw new Error("invalid ack identity/gate coverage");
  const passed = ack.status === "gates-passed" && ack.gates?.length === gates?.length && ack.gates?.every(gate => gate.status === "pass");
  const blocked = ack.status === "blocked" && ack.gates?.some(gate => gate.status === "blocked");
  outcome ??= passed ? "applied" : "blocked";
  if (!["applied", "blocked", "rejected"].includes(outcome) || (outcome !== "rejected" && ((!passed && !blocked) || (outcome === "applied" && !passed) || (outcome === "blocked" && !blocked)))) throw new Error("ack outcome mismatch");
  if (!Array.isArray(entry.lifecycle_moves)) throw new Error("registry lifecycle moves missing");
  if (prior && (prior.issue !== issue || prior.attempt !== attempt || prior.outcome !== outcome || prior.ackDigest !== digest(ack) ||
      canonical(prior.ack) !== canonical(ack) || (outcome === "applied" && (!Array.isArray(prior.readback) || prior.readback.length !== entry.lifecycle_moves.length ||
      prior.readback.some((readback, i) => readback.moveDigest !== digest(entry.lifecycle_moves[i]) || !readback.evidence))))) throw new Error("contradictory ack consumption");
  return { entry, ack, prior, outcome };
}

export async function acceptAck(args, print = value => console.log(JSON.stringify(value))) {
  allowedFlags(args, ["issue", "attempt", "root", "readback", "outcome"]);
  const { root, issue } = args, attempt = Number(args.attempt);
  const action = await withLock(path.join(root, "launch.lock"), () => {
    // No plan is exposed before the ack and prior consumption are validated.
    const context = validatedAck(root, issue, attempt, args.outcome);
    if (context.prior) return { outcome: context.outcome, readback: context.prior.readback };
    if (context.outcome !== "applied") return { outcome: context.outcome, readback: [] };
    const planFile = path.join(root, "consumed", `${issue}-a${attempt}`, "ack-plan.json");
    if (!args.readback) {
      const fields = { issue, attempt, ackDigest: digest(context.ack), plannedAt: new Date().toISOString(),
        moves: context.entry.lifecycle_moves.map(move => ({ moveDigest: digest(move), ...move })) };
      const plan = { ...fields, planDigest: digest(fields) };
      atomicJson(planFile, plan); print(plan); return null;
    }
    if (!fs.existsSync(planFile)) throw new Error("readback requires a printed plan");
    const plan = readJson(planFile), { planDigest, ...fields } = plan, observation = readJson(args.readback);
    if (digest(fields) !== planDigest || observation.planDigest !== planDigest || plan.ackDigest !== digest(context.ack) || plan.issue !== issue || plan.attempt !== attempt ||
        canonical(plan.moves) !== canonical(context.entry.lifecycle_moves.map(move => ({ moveDigest: digest(move), ...move })))) throw new Error("readback planDigest/ack/moves mismatch");
    const time = Date.parse(plan.plannedAt);
    if (!Number.isFinite(time) || time > Date.now() || !Array.isArray(observation.readback) || observation.readback.length !== plan.moves.length ||
      observation.readback.some((readback, i) => readback.moveDigest !== plan.moves[i].moveDigest || !readback.evidence ||
        !Number.isFinite(Date.parse(readback.observedAt)) || Date.parse(readback.observedAt) < time || Date.parse(readback.observedAt) > Date.now())) throw new Error("readback incomplete or older than printed plan");
    return { outcome: context.outcome, readback: observation.readback };
  });
  if (!action) return { planned: true };
  const result = await consumeAck({ root, issue, attempt, ...action }); print(result); return result;
}

if (isMain(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2), args = commandFlags(argv);
    if (command === "--help" || args.help) console.log("Usage: accept.mjs ack --root DIR --issue KEY --attempt N [--outcome applied|blocked|rejected] [--readback FILE]\nConsumes the start handshake ack; launch.lock serializes it with collector admissions. No script writes to Linear: the delivery worker writes its own comments and statuses through Linear MCP. A task change is an «Изменение задачи» comment on the Issue plus resume.mjs with taskChange set to its link; a risk or grant change is a new attempt on the same branch. Launch pins never change within an attempt.");
    else if (command === "ack") await acceptAck(args);
    else throw new Error("expected ack");
  } catch (error) {
    console.error(`accept: ${error.message}`); process.exitCode = 1;
  }
}
