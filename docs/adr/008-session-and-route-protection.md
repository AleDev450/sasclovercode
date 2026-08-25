# ADR-008 — SSR sessions: verified identity and a closed-by-default proxy

```text
Status: ACCEPTED
Date:   2026-08-25
Phase:  02 — Authentication
```

## Context

`CLOVERCODE_MASTER.md` section 33 (Fase 2) requires a "sesión SSR segura" and
protected private routes. Section 9 forbids trusting anything the frontend
sends, and forbids trusting `user_metadata` for authorization decisions.

Three problems have to be solved at once:

1. **Trust.** A session arrives as a cookie, and a cookie is client-supplied.
   Something has to establish that it is genuine.
2. **Refresh.** Supabase access tokens are short-lived. A Server Component
   cannot write a cookie, so a token refreshed during a page render cannot be
   persisted. Without a place that can, users are signed out mid-session.
3. **Coverage.** Deciding "is this route private?" in each page means the
   decision is missing from every page somebody forgets.

## Decision

### 1. `getUser()` everywhere on the server, never `getSession()`

`getSession()` decodes the cookie and returns what it says, without contacting
the auth server. `getUser()` revalidates the token with Supabase Auth on every
call. Server code uses `getUser()` exclusively, and this is asserted in
`src/tests/integration/auth-session.test.ts`.

The cost is a round trip per request. That is the price of the identity being
verified rather than asserted, and it is not negotiable in a system whose entire
isolation model rests on knowing who is calling.

### 2. Displayed and authorizing values come from `profiles`, not `user_metadata`

A signed-in user can write their own `user_metadata`. Anything read from it is
therefore attacker-controlled. The application reads the profile row instead,
which only the database trigger writes.

### 3. Session refresh lives in `src/proxy.ts`

Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`, with the
exported function named `proxy`. Verified empirically against the installed
Next.js 16.3.2: a `src/proxy.ts` exporting `proxy` produces
`ƒ Proxy (Middleware)` in the build output.

The proxy is the only place in the request lifecycle that can both read the
incoming cookies and write cookies onto the response, so it is the only place a
refreshed token can be persisted.

Two mechanics are easy to get wrong and are commented at the call site:

- The response handed back must be the same object the cookie writer mutated.
  Building a fresh `NextResponse` afterwards discards the refreshed
  `Set-Cookie` headers, producing random logouts.
- `@supabase/ssr` 0.12 passes a second argument to `setAll`: the `no-store`
  headers that must accompany a response setting auth cookies. Without them a
  CDN can cache a response containing one user's session and serve it to
  somebody else.

### 4. Route access is closed by default, and the rules are pure

`src/lib/auth/route-access.ts` holds an allow-list of public prefixes. Anything
absent from it requires a session. A route added by a later phase is therefore
protected from the moment it exists, rather than from the moment somebody
remembers to protect it.

The rules are pure functions over a pathname, with no request, database or
framework involved, so they are asserted directly.

### 5. The proxy is defence in depth, not the only check

The proxy matches page paths. Server Actions and Route Handlers are reachable
without matching one, so each verifies the session itself through `requireUser()`
or, for actions, by checking the session before acting. Route protection in two
independent places is deliberate: neither is sufficient alone.

## Alternatives considered

**Check the session in a shared layout instead of the proxy.** A layout cannot
write cookies, so it solves protection but not refresh. It also does not cover
Route Handlers.

**`getSession()` with `getUser()` only on sensitive pages.** Faster, and wrong:
"sensitive" is a judgement made per page, and the first page where the judgement
is wrong accepts a forged cookie.

**Deny-list of private routes instead of an allow-list of public ones.** Fails
open. Every new route is public until somebody notices.

**Keep `middleware.ts`.** Still functional in 16.3.2, but deprecated. Adopting
the new convention now avoids a migration later, and the codemod
(`npx @next/codemod middleware-to-proxy`) exists precisely because the rename is
mechanical.

## Consequences

- Every authenticated request costs one `getUser()` round trip to Supabase Auth.
  Accepted: verified identity is the foundation of tenant isolation.
- `src/proxy.ts` runs on the Node.js runtime, which is not configurable. The
  edge runtime is unavailable for this file.
- A new public route must be added to `PUBLIC_PREFIXES` explicitly, and will 404
  behind a sign-in redirect until it is. This is the intended friction.
- `createSupabaseServerClient()` awaits `cookies()` before reading the
  environment, so a build without credentials marks authenticated routes dynamic
  instead of failing. Phase 00 EC-02 depends on this ordering.
