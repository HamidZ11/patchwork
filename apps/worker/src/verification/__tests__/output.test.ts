import { describe, expect, it } from 'vitest';
import { capOutputBytes, capStepOutput } from '../output.js';
import { OUTPUT_CAPS } from '../policy.js';

describe('capOutputBytes', () => {
  it('leaves short output untouched', () => {
    const result = capOutputBytes('hello', 100);
    expect(result).toEqual({ text: 'hello', truncated: false });
  });

  it('caps by bytes, not characters', () => {
    // Each '€' is 3 bytes in UTF-8 -- 10 of them is 30 bytes, well under
    // a naive character-count cap of e.g. 20, but over a byte cap of 20.
    const raw = '€'.repeat(10);
    const result = capOutputBytes(raw, 20);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf-8')).toBeLessThanOrEqual(20);
  });

  it('never splits a multi-byte UTF-8 character, producing valid text', () => {
    const raw = '€'.repeat(10); // 30 bytes total, 3 bytes each
    const result = capOutputBytes(raw, 10); // cap lands mid-character
    // Re-encoding what we got back must round-trip cleanly (no U+FFFD
    // replacement character, which would indicate a split sequence).
    expect(result.text).not.toContain('�');
    expect(Buffer.byteLength(result.text, 'utf-8')).toBeLessThanOrEqual(10);
  });
});

describe('capStepOutput', () => {
  it('applies the per-stream cap independently to stdout and stderr', () => {
    const big = 'x'.repeat(OUTPUT_CAPS.perStreamBytes + 100);
    const result = capStepOutput(big, big, 0);
    expect(result.stdout.truncated).toBe(true);
    expect(result.stderr.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout.text, 'utf-8')).toBeLessThanOrEqual(
      OUTPUT_CAPS.perStreamBytes,
    );
    expect(Buffer.byteLength(result.stderr.text, 'utf-8')).toBeLessThanOrEqual(
      OUTPUT_CAPS.perStreamBytes,
    );
  });

  it('enforces the total-per-run budget across steps, not just per-stream', () => {
    // Each step is exactly at the per-stream cap (never truncated on its
    // own), but enough of them together exceed the smaller total-per-run
    // budget -- the budget must be enforced cumulatively, not reset per step.
    const chunk = 'x'.repeat(OUTPUT_CAPS.perStreamBytes);
    let bytesUsed = 0;
    let lastResult = capStepOutput(chunk, '', bytesUsed);
    for (
      let i = 0;
      i < Math.ceil(OUTPUT_CAPS.perRunTotalBytes / OUTPUT_CAPS.perStreamBytes) + 1;
      i += 1
    ) {
      lastResult = capStepOutput(chunk, '', bytesUsed);
      bytesUsed = lastResult.bytesUsed;
    }
    expect(bytesUsed).toBeLessThanOrEqual(OUTPUT_CAPS.perRunTotalBytes);
    expect(lastResult.stdout.truncated).toBe(true);
  });

  it('records truncated: false when output fits comfortably', () => {
    const result = capStepOutput('ok', '', 0);
    expect(result.stdout).toEqual({ text: 'ok', truncated: false });
    expect(result.stderr).toEqual({ text: '', truncated: false });
  });
});
