export function parseReviewUsage(output, engine) {
  const lines = output.split("\n").filter(line => /^(claude|codex) usage:/.test(line));
  const missing = reason => ({ usage: null, usageReason: reason });
  if (!lines.length) return missing("helper output does not report token usage");
  const fields = engine === "claude" ? ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"] : ["input_tokens", "cached_input_tokens", "output_tokens"];
  if (!["claude", "codex"].includes(engine)) return missing("unsupported usage engine");
  const samples = [];
  for (const line of lines) {
    if (!line.startsWith(`${engine} usage: `)) return missing("ambiguous usage engine");
    const raw = {};
    for (const token of line.slice(`${engine} usage: `.length).split(/\s+/)) {
      const match = /^([a-z_]+)=([0-9]+(?:\.[0-9]+)?)$/.exec(token);
      if (!match || Object.hasOwn(raw, match[1])) return missing("invalid or ambiguous usage counters");
      raw[match[1]] = Number(match[2]);
    }
    if (fields.some(key => !Number.isSafeInteger(raw[key]) || raw[key] < 0) || (engine === "codex" && raw.cached_input_tokens > raw.input_tokens)) return missing("missing or invalid usage counters");
    samples.push(raw);
  }
  const sum = key => samples.reduce((total, raw) => total + raw[key], 0);
  const normalized = { input: sum("input_tokens"), cacheRead: sum(fields[1]), cacheWrite: engine === "claude" ? sum(fields[2]) : null, output: sum("output_tokens") };
  if (Object.values(normalized).some(value => value !== null && !Number.isSafeInteger(value))) return missing("usage counter overflow");
  return { usage: { engine, raw: samples.length === 1 ? samples[0] : { samples }, normalized }, usageReason: null };
}
