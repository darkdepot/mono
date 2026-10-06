import { codexCli } from "./transports/codex-cli.mjs";
import { claudeCli } from "./transports/claude-cli.mjs";
import { readJsonLines } from "./transports/journal.mjs";

// Consumers use capabilities; journal events and CLI options belong to implementations.
export const workerTransports = Object.freeze({ "codex-cli": codexCli, "claude-cli": claudeCli });

export function workerTransport(transport) {
  return Object.hasOwn(workerTransports, transport) ? workerTransports[transport] : null;
}

export function workerLog(filename) {
  const parsed = readJsonLines(filename);
  const launch = parsed.events.find(({ value }) => value.type === "mono.launch")?.value;
  const name = launch?.model_launch?.case ?? "codex-cli";
  const transport = workerTransport(name);
  if (!transport) throw new Error(`unsupported worker journal transport: ${name}`);
  return { ...parsed, transport };
}
