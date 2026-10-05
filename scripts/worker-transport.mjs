import { codexCli } from "./transports/codex-cli.mjs";

// Consumers use capabilities; journal events and CLI options belong to implementations.
export const workerTransports = Object.freeze({ "codex-cli": codexCli });

export function workerTransport(transport) {
  return Object.hasOwn(workerTransports, transport) ? workerTransports[transport] : null;
}
