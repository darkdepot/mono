#!/usr/bin/env node
// Fixture stand-in for `codex` in the MONO-509 Linear path probe (MONO_CODEX_PROBE_BIN). MONO_FAKE_CODEX_LINEAR is JSON:
// {mcp: "ok"|"absent"|"disabled"|<auth_status>, apps: true|false, cwdFile?}; the default is a logged-in linear server.
// "ok" reports auth o_auth; any other mcp value is reported as the server's auth_status. cwdFile records each probe's cwd.
import fs from "node:fs";
const spec = { mcp: "ok", apps: true, ...JSON.parse(process.env.MONO_FAKE_CODEX_LINEAR || "{}") };
if (spec.cwdFile) fs.appendFileSync(spec.cwdFile, process.cwd() + "\n");
const [command, sub] = process.argv.slice(2);
if (command === "mcp" && sub === "list") {
  const servers = spec.mcp === "absent" ? [] : [{ name: "linear", enabled: spec.mcp !== "disabled", disabled_reason: null,
    transport: { type: "streamable_http", url: "https://mcp.linear.app/mcp" }, auth_status: ["ok", "disabled"].includes(spec.mcp) ? "o_auth" : spec.mcp }];
  console.log(JSON.stringify(servers));
} else if (command === "features" && sub === "list") {
  console.log(`apps                                     stable             ${spec.apps}`);
} else { console.error(`fake codex: unexpected ${process.argv.slice(2).join(" ")}`); process.exit(2); }
