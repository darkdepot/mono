import { codexCli } from "./transports/codex-cli.mjs";
import { claudeCli } from "./transports/claude-cli.mjs";

// Consumers use capabilities; journal events and CLI options belong to implementations.
export const workerTransports = Object.freeze({ "codex-cli": codexCli, "claude-cli": claudeCli });

export function workerTransport(transport) {
  return Object.hasOwn(workerTransports, transport) ? workerTransports[transport] : null;
}
