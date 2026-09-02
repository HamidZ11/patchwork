import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubClient } from '@patchwork/github';
import { resetBotIdentityCacheForTests, resolveBotIdentity } from '../bot-identity.js';

/**
 * Regression test for a real bug found live (2026-09): resolveBotIdentity
 * originally fetched an App JWT (via githubAppAuth.getAppToken()) and
 * passed it to getBotUserId, but `GET /users/{username}` is a public REST
 * endpoint that rejects App JWTs outright with 401 "Bad credentials" --
 * App JWTs are only valid for the small set of `/app/*` management
 * endpoints. Confirmed live both that the endpoint works unauthenticated
 * and that passing an App token fails. Fixed by calling getBotUserId with
 * no token at all.
 */
describe('resolveBotIdentity', () => {
  beforeEach(() => {
    resetBotIdentityCacheForTests();
  });

  function fakeClient(getBotUserId: GitHubClient['getBotUserId']): GitHubClient {
    return { getBotUserId } as unknown as GitHubClient;
  }

  it('calls getBotUserId with only the app slug -- no token argument', async () => {
    const getBotUserId = vi.fn(async () => 999999);
    const client = fakeClient(getBotUserId);

    await resolveBotIdentity(client, 'patchwork-dev');

    expect(getBotUserId).toHaveBeenCalledWith('patchwork-dev');
    expect(getBotUserId).toHaveBeenCalledTimes(1);
  });

  it('builds the expected bot name and noreply email', async () => {
    const client = fakeClient(async () => 12345);

    const author = await resolveBotIdentity(client, 'patchwork-dev');

    expect(author).toEqual({
      name: 'patchwork-dev[bot]',
      email: '12345+patchwork-dev[bot]@users.noreply.github.com',
    });
  });

  it('caches the result -- does not call getBotUserId again for the same app slug', async () => {
    const getBotUserId = vi.fn(async () => 42);
    const client = fakeClient(getBotUserId);

    await resolveBotIdentity(client, 'patchwork-dev');
    await resolveBotIdentity(client, 'patchwork-dev');
    await resolveBotIdentity(client, 'patchwork-dev');

    expect(getBotUserId).toHaveBeenCalledTimes(1);
  });

  it('concurrent first-callers share one in-flight resolution', async () => {
    const getBotUserId = vi.fn(async () => 7);
    const client = fakeClient(getBotUserId);

    const [a, b, c] = await Promise.all([
      resolveBotIdentity(client, 'patchwork-dev'),
      resolveBotIdentity(client, 'patchwork-dev'),
      resolveBotIdentity(client, 'patchwork-dev'),
    ]);

    expect(getBotUserId).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});
