import fs from "node:fs";

export function readJsonLines(filename, { errorLines = false } = {}) {
  const events = [], errors = [], invalidLines = [];
  for (const [index, line] of fs.readFileSync(filename, "utf8").split("\n").entries()) {
    if (!line.trim()) continue;
    try { events.push({ value: JSON.parse(line), line: index + 1 }); }
    catch (error) { errors.push(`line ${index + 1}: ${error.message}`); invalidLines.push(index + 1); }
  }
  return { events, errors, ...(errorLines ? { invalidLines } : {}) };
}
