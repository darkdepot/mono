import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export function resolvedLocation(file) {
  if (!path.isAbsolute(file ?? "")) throw new Error("absolute evidence/root/worktree paths required");
  if (fs.existsSync(file)) return fs.realpathSync(file);
  return path.join(resolvedLocation(path.dirname(file)), path.basename(file));
}
export function validateEvidenceGrants(evidencePath, roots, label = "evidenceRoot") {
  const evidenceRoot = resolvedLocation(evidencePath);
  const prefix = value => value.endsWith(path.sep) ? value : value + path.sep;
  if (roots.map(resolvedLocation).some(root => evidenceRoot === root || evidenceRoot.startsWith(prefix(root)) || root.startsWith(prefix(evidenceRoot))))
    throw new Error(`${label} must be outside worktree, orchestrator root and worker-writable roots (no overlapping grants)`);
  return evidenceRoot;
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");
export function durableDirectory(dir) {
  if (fs.existsSync(dir)) return;
  const parent = path.dirname(dir);
  durableDirectory(parent);
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  syncDir(parent);
}
export function syncDir(dir) {
  const fd = fs.openSync(dir, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function atomicJson(file, value) {
  durableDirectory(path.dirname(file));
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file); syncDir(path.dirname(file));
}
export async function withLock(file, action) {
  durableDirectory(path.dirname(file));
  let fd;
  try { fd = fs.openSync(file, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let holder, live = false;
    try {
      holder = readJson(file).pid;
      if (Number.isInteger(holder) && holder > 0) {
        try { process.kill(holder, 0); live = true; } catch (cause) { live = cause.code === "EPERM"; }
      }
    } catch {}
    const locked = new Error(`operation locked: ${file}; ${live ? `live holder ${holder}, retry after completion; do not remove its lock` : "holder not confirmed live; establish process state and reconcile before any lock removal"}`);
    locked.code = "ELOCKED"; throw locked;
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); fs.fsyncSync(fd);
  try { return await action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); syncDir(path.dirname(file)); }
}
export function flags(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!key.startsWith("--") || Object.hasOwn(result, key.slice(2))) throw new Error(`invalid argument ${key}`);
    if (key === "--help") { result.help = true; continue; }
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`missing value ${key}`);
    result[key.slice(2)] = args[++i];
  }
  return result;
}
export function identity(value) {
  return typeof value?.packVersion === "string" && value.packVersion.length > 0 && /^[a-f0-9]{40}$/.test(value.sourceCommit) && Number.isInteger(value.surfaceRevision) && value.surfaceRevision > 0;
}
export const isMain = (url) => process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url));
export function positive(value, fallback, name) {
  value = value ?? fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid ${name}`);
  return value;
}
export function deliveryConfig(file) {
  const config = file ? readJson(file)?.orchestration?.delivery ?? {} : {};
  return {
    confirmationTimeoutSec: positive(config.confirmationTimeoutSec, 900, "confirmationTimeoutSec"),
    quietSec: positive(config.quietSec, 120, "quietSec"),
    evidenceLimitSec: positive(config.evidenceLimitSec, 2400, "evidenceLimitSec"),
    pollSec: positive(config.pollSec, 10, "pollSec"),
    attemptCap: positive(config.attemptCap, 3, "attemptCap"),
  };
}
