import { describe, expect, it } from 'vitest';
import { buildPatchApplyCommand, buildPatchCheckCommand, PATCH_FILE_PATH } from '../patch-apply.js';

describe('patch-apply commands', () => {
  it('check uses -p0 --forward --dry-run, referencing the fixed diff path by argv, never embedding diff content', () => {
    const cmd = buildPatchCheckCommand('/home/user/repo', 5000);
    expect(cmd.executable).toBe('patch');
    expect(cmd.args).toEqual(['-p0', '--forward', '--dry-run', '-i', PATCH_FILE_PATH]);
    expect(cmd.cwd).toBe('/home/user/repo');
    expect(cmd.timeoutMs).toBe(5000);
  });

  it('apply uses -p0 --forward, no --dry-run', () => {
    const cmd = buildPatchApplyCommand('/home/user/repo', 5000);
    expect(cmd.args).toEqual(['-p0', '--forward', '-i', PATCH_FILE_PATH]);
  });

  it('the diff path is a fixed constant, never derived from any per-run input', () => {
    expect(PATCH_FILE_PATH).toBe('/tmp/patchwork.diff');
  });
});
