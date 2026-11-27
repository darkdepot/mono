#!/usr/bin/env node
// Fixture stand-in for `codex` in the MONO-509 Linear path probe (MONO_CODEX_PROBE_BIN). MONO_FAKE_CODEX_LINEAR is JSON:
// {mcp: "ok"|"absent"|"not_logged_in"|"disabled", apps: true|false}; the default is a logged-in linear MCP server.
const spec = { mcp: "ok", apps: true, ...JSON.parse(process.env.MONO_FAKE_CODEX_LINEAR || "{}") };
const [command, sub] = process.argv.slice(2);
if (command === "mcp" && sub === "list") {
  const servers = spec.mcp === "absent" ? [] : [{ name: "linear", enabled: spec.mcp !== "disabled", disabled_reason: null,
    transport: { type: "streamable_http", url: "https://mcp.linear.app/mcp" }, auth_status: spec.mcp === "not_logged_in" ? "not_logged_in" : "o_auth" }];
  console.log(JSON.stringify(servers));
} else if (command === "features" && sub === "list") {
  console.log(`apps                                     stable             ${spec.apps}`);
} else { console.error(`fake codex: unexpected ${process.argv.slice(2).join(" ")}`); process.exit(2); }
