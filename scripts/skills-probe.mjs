#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJsonLines } from './transports/journal.mjs';

// The host probe's narrow Claude check: visible text since the last tool result.
// Thinking content is supplementary evidence and never the detection rule.
export function claudeWindows(rows, source) {
  const windows = [], seen = new Set();
  let text = [], thinking = [], toolResult = null;
  for (const { value: event, line } of rows) {
    if (event.parent_tool_use_id) continue;
    const blocks = event.message?.content;
    if (event.type === 'user' && Array.isArray(blocks) && blocks.some(b => b.type === 'tool_result')) {
      text = []; thinking = []; toolResult = line;
    }
    if (event.type !== 'assistant') continue;
    if (!Array.isArray(blocks)) throw new Error(`line ${line}: assistant content must be an array`);
    for (const block of blocks) {
      if (block.type === 'text' && block.text?.trim()) text.push(line);
      if (block.type === 'thinking') thinking.push(line);
      if (block.type !== 'tool_use' || block.name !== 'AskUserQuestion') continue;
      if (!block.id || !Array.isArray(block.input?.questions) || !block.input.questions.length)
        throw new Error(`line ${line}: malformed AskUserQuestion`);
      if (seen.has(block.id)) continue;
      seen.add(block.id);
      windows.push({
        evidence: `${source}:${line}`, line, toolResult,
        textLines: [...new Set(text)], thinkingLines: [...new Set(thinking)],
        questions: block.input.questions,
        status: text.length ? 'passed' : 'failed',
        reason: text.length ? 'visible text before window' : 'no visible text before window; thinking is not owner text',
      });
    }
  }
  return windows;
}

export function probeClaude(filename) {
  try {
    const data = fs.readFileSync(filename, 'utf8');
    let sample;
    try { sample = JSON.parse(data); } catch { /* Stream JSONL is not a JSON document. */ }
    let rows;
    if (sample?.events) {
      if (!Array.isArray(sample.events) || sample.events.some((row, i) =>
        !Number.isInteger(row.line) || row.line < 1 || !row.event || typeof row.event !== 'object' ||
        (i > 0 && row.line <= sample.events[i - 1].line))) throw new Error('invalid trace excerpt');
      rows = sample.events.map(row => ({ value: row.event, line: row.line }));
    } else {
      const parsed = readJsonLines(filename);
      if (parsed.errors.length) throw new Error(parsed.errors.join('; '));
      rows = parsed.events;
    }
    if (rows.some(row => !row.value || typeof row.value !== 'object')) throw new Error('invalid trace event');
    const windows = claudeWindows(rows, filename);
    const status = !windows.length ? 'unverified' : windows.some(w => w.status === 'failed') ? 'failed' : 'passed';
    return { check: 'claude-text-before-window', status, windows,
      boundary: sample?.events ? 'sanitized excerpt; original line numbers' : 'supplied stream-json trace only',
      ...(windows.length ? {} : { reason: 'no top-level AskUserQuestion reached; harness evidence required' }) };
  } catch (error) {
    return { check: 'claude-text-before-window', status: 'unverified', windows: [], reason: error.message };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || ['--help', '-h'].includes(process.argv[2])) {
    console.error('Usage: node scripts/skills-probe.mjs <claude-stream.jsonl|trace-excerpt.json>');
    process.exit(['--help', '-h'].includes(process.argv[2]) ? 0 : 2);
  }
  const result = probeClaude(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'passed' ? 0 : result.status === 'failed' ? 1 : 2);
}
