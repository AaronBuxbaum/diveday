# 20260824-migrate-staff-auth-to-better-auth — Migrate staff auth from next-auth v5 to better-auth

- **Status:** Accepted
- **Date:** 2026-08-24
- **Supersedes:** 0006-auth

## Context

next-auth (Auth.js) has been in maintenance mode since September 2025 — the Better Auth team
maintains it for security fixes only, no new features, and its own docs point new projects at
Better Auth. Vercel acquired Better Auth in July 2026. We are pinned to `next-auth@beta`
(`5.0.0-beta.32`, last published 2026-07-20). DiveDay is pre-pilot with zero real users (H-49),
which makes this the cheapest point in the project's life to move — every month past the first
pilot shop turns this from a schema decision into a credential migration with a rollback plan.

ADR-0006's binding constraint stands unchanged: agents must be able to develop and e2e-test auth
with zero external services — no vendor dashboards, no network callbacks into sandboxes. AWS
Cognito was considered and rejected on exactly this ground (see Alternatives) — it would put a
live network dependency on every dev boot and e2e run, which is the same failure mode Clerk was
rejected for in 2026-07.

## Decision

**Better Auth** (`better-auth@1.7.1`), self-hosted, DB-backed sessions in the same
Postgres/PGlite this app already runs. No new infrastructure.

- **Schema — extend `user_accounts`, don't replace it.** `user_accounts` is read directly by
  8+ non-auth modules (export/import, reporting, GDPR anonymize/erasure, calendar-sync's feed
  store, staff-accounts admin CRUD, seed scripts). Better Auth's `user` model is mapped onto
  this existing table via the Drizzle adapter's schema-mapping option, with `additionalFields`
  for `personId`/`status`/`orientationDismissedAt`. Additive-only schema changes: `email_verified`
  (boolean, synced from the existing `email_verified_at`), `name`/`image`/`updated_at` (required
  by Better Auth's core `user` model, otherwise unused — the real display name is
  `people.full_name`). New tables: `account_sessions` (Better Auth's `session` model, with
  `personId`/`shopId`/`shopSlug`/`roles`/`name` snapshotted once at sign-in — exactly what
  next-auth's `jwt()` callback used to do) and minimal, functionally-unused
  `auth_provider_accounts`/`auth_verifications` (required adapter scaffolding; no OAuth, and
  email verification/password reset/invites all still run through the pre-existing, untouched
  `src/db/account-tokens.ts`).
- **Credential verification stays ours.** A custom Better Auth plugin
  (`diveDayCredentialsPlugin`, `src/lib/auth.ts`) ports the old Credentials provider's
  `authorize()` body unchanged — rate limiting, the account-enumeration timing defense
  (`src/lib/credentials.ts`'s decoy-hash compare), and the demo-bypass containment
  (`src/lib/demo-bypass.ts`) all untouched — and calls Better Auth's own
  `internalAdapter.createSession` + `setSessionCookie` primitives on success, the same ones its
  built-in `/sign-in/email` endpoint uses internally. Not the built-in endpoint itself: its
  `password.verify` hook only ever sees `{hash, password}`, with no way to reach the shop row
  the demo bypass needs.
- **Edge layer gets simpler and more honest about what it can prove.** `src/proxy.ts` no longer
  constructs a server instance — `getSessionCookie`/`getCookieCache` (`better-auth/cookies`) are
  standalone, DB-free functions. `getSessionCookie` (cookie presence only) is the reliable "signed
  in at all" signal; `getCookieCache` additionally decrypts the session snapshot for nice-to-have
  redirects (bare `/shop` → `/shop/<slug>`, bounce a signed-in staffer off `/sign-in`) but is
  allowed to be stale — a signed-in staffer whose cache aged out is let through unmodified rather
  than bounced, and `requireStaffSession()` server-side (unchanged) makes the real call. This
  matches Better Auth's own documented position on cookie-only checks ("not secure, for redirect
  convenience") and DiveDay's existing two-layer model (proxy = outer wall, server-side re-check
  = the actual gate) more literally than the JWT-decoding edge check it replaces.
- **`src/lib/session-cookies.ts` is deleted, not renamed.** Its job was stripping a stale
  session-refresh `Set-Cookie` next-auth's edge middleware could reissue on every pass-through
  request (including stale prefetches after sign-out). `getSessionCookie`/`getCookieCache` are
  pure reads — nothing at the edge issues a *session* `Set-Cookie` any more, so that bug class is
  structurally eliminated rather than patched. (Amended 2026-09-02: the edge does issue exactly one
  cookie, the partner referral of issue #1285. It is not a credential, is not derived from the
  session, is path-scoped to `/s/` so it never travels with a staff request, and is minted only on a
  document navigation — none of which is what the deleted module guarded against.)
- **Everything downstream of `auth()` is unchanged.** `src/lib/auth.ts` keeps exporting an
  `auth()` async function of the same shape; `src/lib/session.ts`'s `requireStaffSession()` and
  the H-14 live-role gates in `src/db/authz.ts` (which already re-read roles from the database
  rather than trusting the session) needed no changes at all.

## Alternatives considered

- **Stay on next-auth v5** — the only other zero-vendor, self-hosted, agent-friendly option
  (MIT, no MAU cap), but frozen at security-fixes-only while the same team's new work goes into
  Better Auth. Doesn't get worse today, only relatively more so every month.
- **AWS Cognito** — DiveDay already runs on AWS (SES, SNS, CloudWatch), but a User Pool requires
  live network reachability for every sign-in call, with no offline/local mode analogous to
  PGlite. Every dev sandbox and all 38 e2e specs would gain a hard external dependency — the
  exact failure mode ADR-0006 rejected Clerk for.
- **Clerk / Auth0** — paid vendor, network-dependent dev, lock-in agents can't self-serve around.
  Already rejected in ADR-0006; nothing changed.
- **Supabase Auth / Keycloak / SuperTokens** — each assumes adopting a platform or running
  extra infrastructure (a JVM service, a separate core service) for one credentials provider
  with no OAuth. Disproportionate.
- **Lucia** — the other self-hosted, TypeScript-native option, but deprecated in March 2025; its
  maintainer turned it into an architecture guide rather than a maintained library. Not a live
  candidate.

## Consequences

- **DB-backed sessions replace JWTs.** Sign-out now actually revokes (deletes/expires a row)
  rather than waiting out a token's lifetime — a strict improvement over ADR-0006's accepted
  "role changes take effect on next sign-in" limitation, not a regression. The tradeoff is a DB
  read on session refresh where a JWT needed none; Better Auth's `cookieCache` (5-minute default,
  `jwe`-encrypted) keeps the common case cookie-only.
- **The edge proxy is now explicitly advisory**, matching what it always should have been
  (ADR-0006: "the proxy is the outer wall, never the only one"). A cold cookie cache means a
  signed-in staffer's very next hop skips the edge's nice-to-have redirects and falls through to
  the authoritative server-side check instead of being denied — never the reverse.
- **New dependency surface**: `better-auth` (MIT) replaces `next-auth`. `bcryptjs`, `zod`, and
  the account-tokens/credentials modules are unchanged.
- **Security-sensitive** per the hard rules (auth/authz change) — a `security-reviewer` pass is
  required before merge, specifically on the credentials plugin and the edge cookie-cache gating
  logic.
- **Escape hatch.** If Better Auth's own maintenance trajectory sours (a fork, a license change,
  Vercel-specific lock-in emerging post-acquisition), the credentials plugin and schema-mapping
  pattern here are the template for swapping to another self-hosted session library — the
  domain-side credential verification (`verifyCredentials`, `account-tokens.ts`) is already
  framework-independent and would not need to change again.
