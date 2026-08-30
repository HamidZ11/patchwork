import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { clearCookie, getCookie, setCookie, type CookiePolicy } from './cookies.js';

const STATE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

export function generateAndSetState(
  reply: FastifyReply,
  cookieName: string,
  policy: CookiePolicy,
): string {
  const state = randomBytes(32).toString('base64url');
  setCookie(reply, cookieName, state, { maxAgeSeconds: STATE_MAX_AGE_SECONDS, ...policy });
  return state;
}

/**
 * Validates a returned `state` against the cookie set when the flow was
 * initiated, then clears the cookie regardless of outcome (single-use, not
 * just time-boxed — a state value is only ever good for one callback).
 */
export function validateAndConsumeState(
  request: FastifyRequest,
  reply: FastifyReply,
  cookieName: string,
  providedState: string | undefined,
  policy: CookiePolicy,
): boolean {
  const expected = getCookie(request, cookieName);
  clearCookie(reply, cookieName, policy);

  if (!expected || !providedState) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(providedState);
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
