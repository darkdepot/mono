// Detached journal owner. The GitHub credential stays in memory/environment;
// both streams are redacted before any bytes reach an orchestrator journal.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { processStart } from "../runtime.mjs";

const [log, diagnostic, command, ...args] = process.argv.slice(2);
const secret = process.env.GH_TOKEN;
const forms = secret ? [...new Set([secret, Buffer.from(secret).toString("base64"), encodeURIComponent(secret)])] : [];
function sink(file) {
  const fd = fs.openSync(file, "a", 0o600), decoder = new StringDecoder("utf8");
  let pending = "";
  const flush = final => {
    for (const value of forms) pending = pending.split(value).join("[REDACTED]");
    let reserve = 0;
    for (const value of forms) {
      for (let length = Math.min(value.length - 1, pending.length); length > reserve; length--) {
        if (pending.endsWith(value.slice(0, length))) { reserve = length; break; }
      }
    }
    if (final && reserve) { pending = pending.slice(0, -reserve) + "[REDACTED]"; reserve = 0; }
    const count = pending.length - reserve;
    if (count) { fs.writeSync(fd, pending.slice(0, count)); pending = pending.slice(count); }
  };
  return {
    write(chunk) { pending += decoder.write(chunk); flush(false); },
    end() { pending += decoder.end(); flush(true); fs.fsyncSync(fd); fs.closeSync(fd); },
  };
}
const out = sink(log), err = sink(diagnostic);
if (process.env.MONO_WORKER_JOURNAL_IDENTITY) {
  const identity = JSON.parse(process.env.MONO_WORKER_JOURNAL_IDENTITY);
  // A killed prior writer may have left a partial line. The new instance marker
  // must start its own line rather than disappear into that historical fragment.
  out.write(Buffer.from("\n" + JSON.stringify({ type: "mono.worker-instance", ...identity,
    pid: process.pid, procStart: processStart(process.pid) }) + "\n"));
}
const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
child.stdout.on("data", chunk => out.write(chunk));
child.stderr.on("data", chunk => err.write(chunk));
child.on("error", () => err.write(Buffer.from("Claude CLI launch failed; inspect installation\n")));
child.on("close", code => { out.end(); err.end(); process.exitCode = code ?? 1; });
process.stdin.pipe(child.stdin);
child.stdin.on("error", error => { if (error.code !== "EPIPE") child.kill("SIGTERM"); });
process.on("SIGTERM", () => child.kill("SIGTERM"));
