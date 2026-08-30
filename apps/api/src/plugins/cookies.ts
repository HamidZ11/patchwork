import type { FastifyReply, FastifyRequest } from 'fastify';

/** Domain + secure are always decided together from the request environment
 * (SESSION_COOKIE_DOMAIN, NODE_ENV) -- bundled so no call site can forget
 * one while setting the other, the way `secure` was previously forgotten
 * (it was hardcoded `true`, which silently breaks cookies over plain
 * http://localhost in development). */
export interface CookiePolicy {
  domain: string | undefined;
  secure: boolean;
}

/**
 * The single place `secure` is decided: only `NODE_ENV=production` gets
 * Secure cookies, since local development runs over plain
 * http://localhost, which browsers refuse to store Secure cookies over.
 */
export function resolveCookiePolicy(nodeEnv: string, domain: string | undefined): CookiePolicy {
  return { domain, secure: nodeEnv === 'production' };
}

export interface CookieOptions {
  maxAgeSeconds: number;
  domain?: string | undefined;
  secure: boolean;
  path?: string;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

const DEFAULT_OPTIONS: Required<Pick<CookieOptions, 'path' | 'httpOnly' | 'sameSite'>> = {
  path: '/',
  httpOnly: true,
  sameSite: 'Lax',
};

/**
 * Minimal cookie parse/set helpers. Hand-rolled instead of pulling in
 * @fastify/cookie: every cookie value this app ever sets is a
 * self-generated, fixed-charset token (hex/base64url), so there's no
 * arbitrary-value escaping to get right — the risk a general-purpose cookie
 * library mitigates doesn't apply here.
 */
export function parseCookies(cookieHeader: string | string[] | undefined): Record<string, string> {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  if (!header) return {};

  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function getCookie(request: FastifyRequest, name: string): string | undefined {
  return parseCookies(request.headers.cookie)[name];
}

export function setCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  options: CookieOptions,
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    `Path=${opts.path}`,
  ];
  if (opts.domain) attributes.push(`Domain=${opts.domain}`);
  if (opts.httpOnly) attributes.push('HttpOnly');
  if (opts.secure) attributes.push('Secure');
  attributes.push(`SameSite=${opts.sameSite}`);

  appendSetCookieHeader(reply, attributes.join('; '));
}

export function clearCookie(reply: FastifyReply, name: string, policy: CookiePolicy): void {
  setCookie(reply, name, '', { maxAgeSeconds: 0, ...policy });
}

function appendSetCookieHeader(reply: FastifyReply, cookieString: string): void {
  const existing = reply.raw.getHeader('set-cookie');
  const updated =
    existing === undefined ? [cookieString] : [...[existing].flat().map(String), cookieString];
  reply.raw.setHeader('set-cookie', updated);
}
