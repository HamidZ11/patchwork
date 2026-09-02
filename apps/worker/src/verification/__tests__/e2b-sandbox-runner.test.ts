import { ALL_TRAFFIC } from 'e2b';
import { describe, expect, it } from 'vitest';
import { toNetworkOpts } from '../e2b-sandbox-runner.js';

/**
 * Regression test for a real live-E2B discrepancy found 2026-09: creating
 * a sandbox with only `network.allowOut` set (no `denyOut`) is rejected
 * by E2B's real API with "you must include 'ALL_TRAFFIC' in deny out to
 * block all other traffic" -- `allowOut` alone no longer implies
 * "deny everything else." Confirmed against a real sandbox creation call
 * before this fix, and again after.
 */
describe('toNetworkOpts', () => {
  it('deny-all sets allowInternetAccess: false', () => {
    expect(toNetworkOpts({ mode: 'deny-all' })).toEqual({ allowInternetAccess: false });
  });

  it('allowlist includes denyOut: [ALL_TRAFFIC] alongside allowOut -- required by the live provider', () => {
    const result = toNetworkOpts({ mode: 'allowlist', allowedHosts: ['registry.npmjs.org'] });
    expect(result).toEqual({
      network: { allowOut: ['registry.npmjs.org'], denyOut: [ALL_TRAFFIC] },
    });
  });

  it('allow-all (test-only variant, never used by real orchestration) returns no network override', () => {
    expect(toNetworkOpts({ mode: 'allow-all' })).toEqual({});
  });
});
