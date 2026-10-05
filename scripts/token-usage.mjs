export function zeroUsage() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

export function addUsage(target, usage) {
  for (const field of Object.keys(target)) target[field] += usage[field];
}

export function finalizeUsage(usage) {
  return {
    ...usage,
    uncached_input_tokens: usage.input_tokens - usage.cached_input_tokens,
    non_overlapping_total_tokens: usage.input_tokens + usage.output_tokens,
  };
}
