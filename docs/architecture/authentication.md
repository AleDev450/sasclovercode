# Authentication

How CloverCode establishes **who** is making a request, and what that identity
grants. Introduced in Phase 02.

Authorization — what a member is allowed to DO — is Phase 03 and is not covered
here.

---

## 1. The two halves

```text
Supabase Auth            CloverCode
─────────────            ──────────
auth.users               profiles          business identity
  credentials              email, name, avatar
  email confirmation     tenant_members    which businesses, which role
  tokens, sessions         tenant_id, user_id, role, status
```

A password never leaves Supabase Auth. There is no credential column anywhere in
the `public` schema, and a compile-time assertion in
`src/tests/database/schema-contract.test.ts` fails if one is added.

---

## 2. The chain

```text
Request
  ↓
src/proxy.ts                refresh the session, decide if the path is public
  ↓
supabase.auth.getUser()     revalidate the token with Supabase Auth
  ↓
profiles                    business identity of that user
  ↓
get_my_memberships()        which tenants, which role
```

---

## 3. Verified, not asserted

Server code calls `getUser()`, never `getSession()`.

`getSession()` decodes the session cookie and returns what it says without
contacting the auth server. The cookie comes from the client, so its contents
are client-supplied. `getUser()` revalidates with Supabase Auth on every call.

The same reasoning rules out `user_metadata`: a signed-in user can write their
own, so nothing read from it may influence a decision or a displayed value. The
application reads `profiles`, which only the database trigger writes.

---

## 4. Where the session is refreshed

Access tokens are short-lived. A Server Component cannot write a cookie, so a
token refreshed during a render cannot be persisted.

`src/proxy.ts` is the one place that can read the request cookies and write
cookies onto the response, so refresh happens there and nowhere else.

Next.js 16 renamed the `middleware.ts` convention to `proxy.ts` with an exported
`proxy` function, running on the Node.js runtime. A leftover `middleware.ts`
would be the dangerous case in a later version — auth logic that silently stops
running — which is why the convention is stated explicitly here and in ADR-008.

---

## 5. Route access is closed by default

`src/lib/auth/route-access.ts` lists the public prefixes. Everything else needs
a session.

```text
public      /  /login  /forgot-password  /reset-password  /auth/*  /api/health
private     everything else, including routes no phase has written yet
```

Pure functions over a pathname: no request, no database, no framework. A route
added by a later phase is protected from the moment it exists.

The proxy is **defence in depth, not the only check**. It matches page paths;
Server Actions and Route Handlers are reachable without matching one, so each
verifies the session itself.

---

## 6. Reading tenant identity

`public.tenants` is deny-by-default (Phase 01) and stays that way. Authenticated
users reach their own tenants through `public.get_my_memberships()`, a
`SECURITY DEFINER` function that joins memberships to tenant identity.

It takes **no user parameter**. The identity comes from `auth.uid()` inside the
body, so a caller cannot ask about anybody else. A test asserts the empty
argument list, so adding one fails the build.

---

## 7. RLS posture after Phase 02

| Table            | RLS | Policies                               |
| ---------------- | --- | -------------------------------------- |
| `tenants`        | ON  | none — read only via guarded functions |
| `tenant_domains` | ON  | none — read only via guarded functions |
| `profiles`       | ON  | select own, update own                 |
| `tenant_members` | ON  | select own                             |

No table is readable without a policy, and no policy uses `using (true)`.
A test asserts RLS is enabled on **every** table in `public`, so a table added
by any later phase without it fails the build.

Membership does not imply a roster: a member cannot list the other members of
their tenant. That reads other people's rows and belongs to an explicit
permission in Phase 03.

---

## 8. What the forms do not reveal

Every response is identical whether or not an account exists:

- sign-in failure is one message for a wrong password, an unknown address and an
  unconfirmed account alike;
- a password-reset request always reports success, **including** when Supabase
  reported a failure.

Anything else turns these forms into a tool for discovering which addresses have
accounts on the platform.

---

## 9. Public registration is off

CloverCode has no sign-up route, and `enable_signup = false` in
`supabase/config.toml`.

Both are needed. The publishable key ships to the browser by design, so anyone
can POST to `/auth/v1/signup` directly — the absence of a form protects nothing
on its own. Accounts are created by the platform operator in Phase 04.

The same switch must be set in the Supabase dashboard for every deployed
project; `config.toml` configures the local stack only.
