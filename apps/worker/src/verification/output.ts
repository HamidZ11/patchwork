import { OUTPUT_CAPS } from './policy.js';

export interface CappedOutput {
  text: string;
  truncated: boolean;
}

/**
 * Byte-based, not character-based (UTF-8 multi-byte sequences would
 * otherwise let a stream slip past the intended cap). Cuts on a UTF-8
 * character boundary so the result is always valid text, never a
 * corrupted trailing byte sequence.
 */
export function capOutputBytes(raw: string, maxBytes: number): CappedOutput {
  const buffer = Buffer.from(raw, 'utf-8');
  if (buffer.byteLength <= maxBytes) return { text: raw, truncated: false };

  let end = maxBytes;
  // Back off until `end` doesn't split a multi-byte UTF-8 sequence: a
  // continuation byte has its top two bits as 10.
  while (end > 0 && (buffer[end]! & 0b1100_0000) === 0b1000_0000) end -= 1;

  return { text: buffer.subarray(0, end).toString('utf-8'), truncated: true };
}

/**
 * Applies the per-stream cap independently to stdout/stderr, then the
 * total-per-run budget across whatever has already been captured for
 * this run -- never relies on the sandbox provider to bound output
 * itself (see docs/security.md).
 */
export function capStepOutput(
  stdout: string,
  stderr: string,
  bytesUsedSoFar: number,
): { stdout: CappedOutput; stderr: CappedOutput; bytesUsed: number } {
  const cappedStdout = capOutputBytes(stdout, OUTPUT_CAPS.perStreamBytes);
  const cappedStderr = capOutputBytes(stderr, OUTPUT_CAPS.perStreamBytes);

  const remaining = Math.max(0, OUTPUT_CAPS.perRunTotalBytes - bytesUsedSoFar);
  const stdoutBytes = Buffer.byteLength(cappedStdout.text, 'utf-8');
  const stdoutFinal = capOutputBytes(cappedStdout.text, Math.min(stdoutBytes, remaining));
  const remainingAfterStdout = Math.max(
    0,
    remaining - Buffer.byteLength(stdoutFinal.text, 'utf-8'),
  );
  const stderrBytes = Buffer.byteLength(cappedStderr.text, 'utf-8');
  const stderrFinal = capOutputBytes(
    cappedStderr.text,
    Math.min(stderrBytes, remainingAfterStdout),
  );

  const bytesUsed =
    bytesUsedSoFar +
    Buffer.byteLength(stdoutFinal.text, 'utf-8') +
    Buffer.byteLength(stderrFinal.text, 'utf-8');

  return {
    stdout: { text: stdoutFinal.text, truncated: cappedStdout.truncated || stdoutFinal.truncated },
    stderr: { text: stderrFinal.text, truncated: cappedStderr.truncated || stderrFinal.truncated },
    bytesUsed,
  };
}
