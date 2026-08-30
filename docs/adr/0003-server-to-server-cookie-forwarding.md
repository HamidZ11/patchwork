# ADR-003: apps/web reaches apps/api via server-to-server requests, not browser CORS

## Status

Accepted

## Context

`apps/web` (Next.js) and `apps/api` (Fastify) are separate processes/origins
(ADR-001). The GitHub connection flow needs `apps/web` to know the current
user's session (to render signed-out / onboarding / connected states) and to
list their connected repositories, both of which live behind `apps/api`'s
session-authenticated routes.

The browser also needs to navigate to `apps/api` directly for the GitHub
OAuth and installation redirects (`/auth/github/login`,
`/github/install`, etc.) — GitHub's redirect mechanics require real
top-level navigations to and from these URLs, so those cannot be proxied
through `apps/web`.

`docs/security.md` already establishes "avoid permissive CORS unless
specifically needed" as a standing principle from the engineering
foundation.

## Decision

`apps/web`'s Server Components read the incoming request's session cookie
(via Next's `cookies()`) and forward it manually as a `Cookie` header on
their own server-to-server `fetch` calls to `apps/api` (see
`apps/web/src/lib/api.ts`). Because this is a server-to-server request
(Node fetching Node), it is never subject to browser CORS restrictions.

`apps/api` therefore exposes **no CORS policy at all** — it isn't needed.
Browser JavaScript never calls `apps/api` directly for data; it only
performs full-page navigations there for the OAuth/install redirects
(unaffected by CORS, since CORS only restricts `fetch`/`XHR`, not top-level
navigation).

The session cookie has no `Domain` attribute set in development — cookie
scoping ignores port, so a cookie set by `apps/api` on `localhost:3001` is
also sent to `apps/web` on `localhost:3000` by the browser during those
top-level navigations, and `apps/web`'s server code can then read it via
`cookies()` on any subsequent request to `apps/web` itself. In production,
sharing the cookie across different subdomains (e.g. `app.patchwork.dev` /
`api.patchwork.dev`) needs the optional `SESSION_COOKIE_DOMAIN` env var set
to the shared parent domain — deferred as a production deployment detail,
not solved by this ADR.

## Alternatives considered

- **CORS with credentials, browser calls `apps/api` directly.** Standard,
  well-understood pattern, but requires an exact-origin
  `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`
  policy on `apps/api`, and depends on the browser sending the session
  cookie cross-origin (`SameSite=None; Secure` in production if `apps/web`
  and `apps/api` are ever on genuinely different top-level domains).
  Rejected: it reintroduces exactly the CORS surface `docs/security.md`
  says to avoid unless specifically needed, and server-to-server forwarding
  achieves the same UX without it.
- **Reverse-proxy `apps/api` behind `apps/web`** (e.g. Next.js `rewrites()`
  so the browser only ever sees one origin). Also avoids CORS, but adds a
  proxying layer to `apps/web`'s request path for routes that don't need it
  (`/health`, `/ready`, and the GitHub redirect endpoints are hit directly
  by the browser or infra, not through `apps/web`). Rejected as unnecessary
  complexity for what server-side cookie forwarding already solves.

## Consequences

- No CORS configuration exists on `apps/api`, and none should be added
  without a concrete new requirement (e.g. a future first-party mobile
  client calling `apps/api` directly from the browser).
- Every future page in `apps/web` that needs data from `apps/api` follows
  the same pattern: fetch server-side via `apps/web/src/lib/api.ts`'s
  `apiFetch`, not client-side `fetch`/`XHR` against `apps/api`.
- If a genuine need for browser-to-API calls emerges later (e.g. real-time
  updates, a public API for third parties), that will need its own design
  and a scoped CORS policy at that time — this ADR does not rule it out,
  it just establishes that today's connection flow doesn't need it.
