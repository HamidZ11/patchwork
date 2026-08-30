import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const SESSION_COOKIE_NAME = 'patchwork_session';

export { API_URL };

/**
 * Calls apps/api from a Server Component/Route Handler, forwarding the
 * browser's session cookie manually. This is a server-to-server request
 * (not made by browser JS), so it is never subject to CORS -- apps/api
 * exposes no CORS policy at all, by design (see docs/architecture.md).
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  const headers = new Headers(init.headers);
  if (sessionCookie) headers.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionCookie.value}`);

  return fetch(new URL(path, API_URL), { ...init, headers, cache: 'no-store' });
}
