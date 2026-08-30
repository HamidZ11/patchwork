import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  clearCookie,
  getCookie,
  parseCookies,
  resolveCookiePolicy,
  setCookie,
} from '../cookies.js';

function fakeReply(): FastifyReply & { getSetCookieHeaders: () => string[] } {
  const headers = new Map<string, unknown>();
  return {
    raw: {
      getHeader: (name: string) => headers.get(name),
      setHeader: (name: string, value: unknown) => {
        headers.set(name, value);
      },
    },
    getSetCookieHeaders: () => (headers.get('set-cookie') as string[] | undefined) ?? [],
  } as unknown as FastifyReply & { getSetCookieHeaders: () => string[] };
}

function fakeRequest(cookieHeader: string | undefined): FastifyRequest {
  return { headers: { cookie: cookieHeader } } as unknown as FastifyRequest;
}

describe('resolveCookiePolicy', () => {
  // Regression coverage for the bug found during real GitHub OAuth testing:
  // Secure was hardcoded `true`, which browsers refuse to store over plain
  // http://localhost, silently breaking OAuth state validation in dev.
  it('does NOT enable Secure in development', () => {
    expect(resolveCookiePolicy('development', undefined)).toEqual({
      domain: undefined,
      secure: false,
    });
  });

  it('does NOT enable Secure in test', () => {
    expect(resolveCookiePolicy('test', undefined)).toEqual({ domain: undefined, secure: false });
  });

  it('DOES enable Secure in production', () => {
    expect(resolveCookiePolicy('production', undefined)).toEqual({
      domain: undefined,
      secure: true,
    });
  });

  it('passes the domain through unchanged, independent of secure', () => {
    expect(resolveCookiePolicy('production', '.patchwork.dev')).toEqual({
      domain: '.patchwork.dev',
      secure: true,
    });
    expect(resolveCookiePolicy('development', '.patchwork.dev')).toEqual({
      domain: '.patchwork.dev',
      secure: false,
    });
  });
});

describe('setCookie', () => {
  it('omits Secure when the policy says secure: false (the dev/localhost case)', () => {
    const reply = fakeReply();

    setCookie(reply, 'test_cookie', 'value', {
      maxAgeSeconds: 60,
      domain: undefined,
      secure: false,
    });

    const [cookie] = reply.getSetCookieHeaders();
    expect(cookie).not.toContain('Secure');
  });

  it('includes Secure when the policy says secure: true (the production case)', () => {
    const reply = fakeReply();

    setCookie(reply, 'test_cookie', 'value', {
      maxAgeSeconds: 60,
      domain: undefined,
      secure: true,
    });

    const [cookie] = reply.getSetCookieHeaders();
    expect(cookie).toContain('Secure');
  });

  it('always includes HttpOnly and SameSite=Lax regardless of secure', () => {
    for (const secure of [true, false]) {
      const reply = fakeReply();
      setCookie(reply, 'test_cookie', 'value', { maxAgeSeconds: 60, domain: undefined, secure });

      const [cookie] = reply.getSetCookieHeaders();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    }
  });

  it('sets Max-Age from maxAgeSeconds', () => {
    const reply = fakeReply();

    setCookie(reply, 'test_cookie', 'value', {
      maxAgeSeconds: 600,
      domain: undefined,
      secure: false,
    });

    const [cookie] = reply.getSetCookieHeaders();
    expect(cookie).toContain('Max-Age=600');
  });

  it('includes Domain only when the policy provides one', () => {
    const withDomain = fakeReply();
    setCookie(withDomain, 'test_cookie', 'value', {
      maxAgeSeconds: 60,
      domain: '.patchwork.dev',
      secure: false,
    });
    expect(withDomain.getSetCookieHeaders()[0]).toContain('Domain=.patchwork.dev');

    const withoutDomain = fakeReply();
    setCookie(withoutDomain, 'test_cookie', 'value', {
      maxAgeSeconds: 60,
      domain: undefined,
      secure: false,
    });
    expect(withoutDomain.getSetCookieHeaders()[0]).not.toContain('Domain=');
  });

  it('accumulates multiple Set-Cookie entries instead of overwriting', () => {
    const reply = fakeReply();

    setCookie(reply, 'first', 'a', { maxAgeSeconds: 60, domain: undefined, secure: false });
    setCookie(reply, 'second', 'b', { maxAgeSeconds: 60, domain: undefined, secure: false });

    const cookies = reply.getSetCookieHeaders();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('first=a');
    expect(cookies[1]).toContain('second=b');
  });
});

describe('clearCookie', () => {
  it('sets Max-Age=0 and follows the given policy for secure/domain', () => {
    const reply = fakeReply();

    clearCookie(reply, 'test_cookie', { domain: '.patchwork.dev', secure: true });

    const [cookie] = reply.getSetCookieHeaders();
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Domain=.patchwork.dev');
  });

  it('omits Secure when the policy says secure: false', () => {
    const reply = fakeReply();

    clearCookie(reply, 'test_cookie', { domain: undefined, secure: false });

    const [cookie] = reply.getSetCookieHeaders();
    expect(cookie).not.toContain('Secure');
  });
});

describe('parseCookies / getCookie', () => {
  it('returns an empty object for an undefined header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it('parses a single cookie', () => {
    expect(parseCookies('patchwork_session=abc123')).toEqual({ patchwork_session: 'abc123' });
  });

  it('parses multiple cookies separated by "; "', () => {
    expect(parseCookies('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('decodes URI-encoded values', () => {
    expect(parseCookies('name=hello%20world')).toEqual({ name: 'hello world' });
  });

  it('getCookie reads the named cookie from the request headers', () => {
    const request = fakeRequest('patchwork_session=xyz; gh_oauth_state=abc');
    expect(getCookie(request, 'gh_oauth_state')).toBe('abc');
    expect(getCookie(request, 'missing')).toBeUndefined();
  });
});
