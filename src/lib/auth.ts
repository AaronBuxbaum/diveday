import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { headers as nextHeaders } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { getAccountSecurity, verifyAccountSecondFactor } from "@/db/account-security";
import { type AppDb, getDb } from "@/db/client";
import {
  accountSessions,
  authProviderAccounts,
  authVerifications,
  userAccounts,
} from "@/db/schema";
import { trackEvent } from "@/lib/analytics";
import { authSecret } from "@/lib/auth-secret";
import type { Role } from "@/lib/authz";
import { nowMs } from "@/lib/clock";
import { verifyCredentials } from "@/lib/credentials";
import { log } from "@/lib/log";
import { APP_ORIGIN, publicAppUrl } from "@/lib/notifications/app-url";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { readSessionCookieCache } from "@/lib/session-cookie-cache";

/**
 * Our own credentials chokepoint as a better-auth plugin, rather than
 * better-auth's built-in `/sign-in/email` — that endpoint's `password.verify`
 * hook only ever sees `{hash, password}`, with no way to reach the shop row
 * `demoBypassAccepted` needs, and reusing it would mean re-deriving the
 * rate-limiting and account-enumeration defenses from scratch. This is the
 * old NextAuth Credentials provider's `authorize()` body, unchanged, wired to
 * better-auth's own session-creation primitive
 * (`internalAdapter.createSession` + `setSessionCookie`) instead of a JWT.
 *
 * Reachable at `POST /sign-in/diveday-credentials` only if a route ever
 * mounts the better-auth handler — today nothing does (every call site here
 * invokes `auth.api.signInDiveDayCredentials()` in-process from a Server
 * Action), so this endpoint has no HTTP surface at all yet. `verifyCredentials`
 * and its rate limiting remain the authoritative gate regardless of caller
 * (CR-013): the old code's "can't be bypassed" property was about
 * `/api/auth/callback/credentials` being directly POSTable, and a bare
 * credentials attempt still needs the right password either way.
 *
 * Logging mirrors what `src/lib/auth-logger.ts` used to do for next-auth
 * (issue #517): a refused sign-in — wrong password or rate-limited alike — is
 * a `warn` with a counter behind it (`auth.sign_in_refused`,
 * `SignInRefusals` in infra/lib/observability.ts), never an `error`, because
 * one person mistyping a password is noise on the query that finds real
 * problems. A burst is credential stuffing and the alarm is on rate, not
 * presence.
 */
function diveDayCredentialsPlugin() {
  return {
    id: "diveday-credentials",
    endpoints: {
      signInDiveDayCredentials: createAuthEndpoint(
        "/sign-in/diveday-credentials",
        {
          method: "POST",
          body: z.object({
            email: z.email(),
            password: z.string().min(1),
            totpCode: z.string().trim().min(6).max(32).optional(),
          }),
        },
        async (ctx) => {
          const ip = await clientIp(ctx.headers ?? null);
          const [byIp, byEmail] = await Promise.all([
            checkRateLimit(rateLimitKey("sign-in-ip", ip), RATE_LIMITS.signInByIp),
            checkRateLimit(
              rateLimitKey("sign-in-email", ctx.body.email.toLowerCase()),
              RATE_LIMITS.signInByEmail,
            ),
          ]);
          if (!byIp.allowed || !byEmail.allowed) {
            // Fire-and-forget: telemetry must never add latency to the
            // sign-in chokepoint, and trackEvent already swallows its own
            // errors.
            void trackEvent({ name: "sign_in_attempted", outcome: "rate_limited" });
            log("auth.sign_in_refused", "warn", { code: "rate_limited" });
            throw new APIError("UNAUTHORIZED", { message: "rate_limited" });
          }

          const db = await getDb();
          const verified = await verifyCredentials(db, ctx.body.email, ctx.body.password);
          void trackEvent({
            name: "sign_in_attempted",
            outcome: verified ? "success" : "invalid_credentials",
          });
          if (!verified) {
            // No address, no IP, no password — AGENTS.md forbids PII in logs,
            // and this line is written on a path anyone on the internet can
            // reach.
            log("auth.sign_in_refused", "warn", { code: "invalid_credentials" });
            throw new APIError("UNAUTHORIZED", { message: "invalid_credentials" });
          }

          const security = await getAccountSecurity(db, verified.id);
          if (security?.totpEnabledAt) {
            const secondFactor = ctx.body.totpCode;
            if (!secondFactor) {
              throw new APIError("UNAUTHORIZED", { message: "two_factor_required" });
            }
            const accepted = await verifyAccountSecondFactor(db, verified.id, secondFactor);
            if (!accepted) {
              throw new APIError("UNAUTHORIZED", { message: "invalid_two_factor" });
            }
          }

          // Snapshotted once, at sign-in — exactly what next-auth's `jwt()`
          // callback used to do (ADR-0006). A role change takes effect on
          // next sign-in, not instantly; every privileged mutation re-reads
          // live roles via `loadActiveStaffRoles` (src/db/authz.ts) and never
          // trusts this snapshot.
          const session = await ctx.context.internalAdapter.createSession(verified.id, false, {
            personId: verified.personId,
            shopId: verified.shopId,
            shopSlug: verified.shopSlug,
            roles: verified.roles,
            name: verified.name,
          });
          if (!session) {
            log("auth.error", "error", {
              type: "session_create_failed",
              message: null,
              cause: null,
            });
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "session_create_failed" });
          }

          const user = await ctx.context.internalAdapter.findUserById(verified.id);
          if (!user) {
            log("auth.error", "error", {
              type: "session_user_missing",
              message: null,
              cause: null,
            });
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "session_user_missing" });
          }

          await setSessionCookie(ctx, { session, user });
          // Never spread the adapter's row into the response. `findUserById`
          // selects the whole `user_accounts` row and the adapter rebuilds it
          // from better-auth's own `user` model, which drops columns that
          // model has never heard of — `hashed_password` among them — but that
          // is the adapter's behaviour, not a promise this endpoint can make.
          // Nothing reads this response body today (no route mounts the
          // better-auth handler, and no call site inspects the return value of
          // signInDiveDayCredentials()), but the day one does — the standard
          // better-auth quickstart, a client SDK, OAuth — an explicit three
          // fields is what keeps a staff member's bcrypt hash out of a login
          // response (security review finding).
          return ctx.json({ user: { id: user.id, email: user.email, name: verified.name } });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

/**
 * The whole better-auth instance for one database handle. Exported so the
 * schema test can build the real thing over a test database: since 1.7.3 the
 * adapter compares this configuration against the Drizzle tables on the first
 * request and refuses to serve *any* request while the two disagree (issue
 * #1588), so a guard that re-declares the options would guard nothing.
 */
export function createAuth(db: AppDb) {
  return betterAuth({
    secret: authSecret,
    // Keep callbacks and redirects on DiveDay's server-owned origin. The
    // fallback is the compiled-in production origin; APP_HOST still lets
    // local, preview, and self-hosted deployments opt into their own host.
    baseURL: publicAppUrl() ?? APP_ORIGIN,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: userAccounts,
        session: accountSessions,
        account: authProviderAccounts,
        verification: authVerifications,
      },
    }),
    user: {
      additionalFields: {
        personId: { type: "string", required: true, input: false },
        status: { type: "string", required: true, input: false },
        orientationDismissedAt: { type: "date", required: false, input: false },
      },
    },
    session: {
      fields: { userId: "userAccountId" },
      additionalFields: {
        personId: { type: "string", required: true, input: false },
        shopId: { type: "string", required: true, input: false },
        shopSlug: { type: "string", required: true, input: false },
        roles: { type: "string[]", required: true, input: false },
        name: { type: "string", required: true, input: false },
      },
      cookieCache: {
        enabled: true,
        // Matches next-auth's old JWT decode cost profile at the edge —
        // the whole point of the cache is letting src/proxy.ts read
        // personId/shopId/shopSlug/roles without a DB round trip. 5
        // minutes (the default) is already tighter than the "next sign-in"
        // staleness window ADR-0006 accepted for JWTs, so this is a strict
        // improvement, not a regression.
        strategy: "jwe",
      },
    },
    // account/verification are required adapter scaffolding, functionally
    // unused: no OAuth provider is configured, and email verification /
    // password reset / staff invites all run through the pre-existing,
    // unrelated src/db/account-tokens.ts system instead of better-auth's
    // own. "Unused" does not mean "free", though — since 1.7.3 the adapter
    // compares both tables against these models before serving anything, so
    // `auth_provider_accounts` carries every column the account model writes
    // and this mapping has to match the one session uses above. Get either
    // wrong and every request throws, sign-in included (issue #1588).
    account: { fields: { userId: "userAccountId" } },
    // Every other table in this schema uses a native uuid primary key
    // (defaultRandom()); better-auth's own default id generator produces a
    // non-UUID base62 string, which Postgres refuses to store in a uuid
    // column. Keeps this schema's house style instead of special-casing
    // three tables to text ids.
    advanced: {
      database: { generateId: "uuid" },
      // The browser suite runs production builds over loopback HTTP. A
      // Secure cookie is valid for the browser's page requests on this
      // host, but Playwright's APIRequestContext deliberately omits it,
      // which makes direct authenticated API assertions look signed out.
      // Keep real deployments secure while giving the HTTP test fleet the
      // same cookie visibility as the browser.
      useSecureCookies: process.env.DIVEDAY_E2E !== "1",
    },
    emailAndPassword: { enabled: false },
    plugins: [diveDayCredentialsPlugin(), nextCookies()],
  });
}

type DiveDayAuth = ReturnType<typeof createAuth>;

// Lazy and memoized, like `getDb()` itself: constructing the adapter needs a
// resolved database handle, and this must never run as an import-time side
// effect (build-time static analysis, or an edge/serverless cold start with
// no DB reachable yet) — only the first real call pays for it.
let authInstancePromise: Promise<DiveDayAuth> | undefined;

export function getAuth(): Promise<DiveDayAuth> {
  authInstancePromise ??= getDb().then(createAuth);
  return authInstancePromise;
}

export type DiveDaySession = {
  user: {
    /** Better Auth account id, used to scope security settings. */
    userAccountId?: string;
    /** Better Auth session id, used for session-bound step-up grants. */
    sessionId?: string;
    personId: string;
    shopId: string;
    shopSlug: string;
    roles: Role[];
    /** `people.full_name` at sign-in — greetings and invite emails read this. */
    name: string;
    /** `user_accounts.email` — the login email, read straight off the `user` row rather than snapshotted onto the session (it's already the account's own live column). */
    email: string;
  };
};

type SessionSnapshot = {
  id: string;
  shopId: string;
  shopSlug: string;
  roles: readonly string[];
};

/**
 * Whether a session read has to write a cookie back (issue #2263). Two
 * reasons, and nothing else:
 *
 * - **the sliding refresh is due**, better-auth's own rule
 *   (`expiresAt - expiresIn + updateAge <= now`): the read that refreshes
 *   pushes the row's expiry out and re-sets the session cookie, so a staffer
 *   who keeps working stays signed in;
 * - **the cookie cache is cold or says something else** than the live row (a
 *   different token, shop or roles): the edge proxy reads that cache for its
 *   convenience redirects (`src/proxy.ts`), so a read warms it back up rather
 *   than leaving it cold for good.
 *
 * `now` is the app clock. In production that is the wall clock better-auth
 * reads; under the e2e harness's frozen instant (in the past) no refresh is
 * ever due, which a run lasting minutes against a seven-day session never
 * needs.
 *
 * Every other read writes nothing. A cookie written from a server action is a
 * mutation to Next: the response says `x-action-revalidated`, and the client
 * router drops its cache, refreshes the route and re-prefetches every visible
 * link, after a read that changed nothing.
 */
export function sessionCookieWriteDue(input: {
  now: number;
  expiresAt: Date;
  expiresInSec: number;
  updateAgeSec: number;
  live: SessionSnapshot;
  cached: SessionSnapshot | null;
}): boolean {
  const refreshDue =
    input.expiresAt.getTime() - input.expiresInSec * 1000 + input.updateAgeSec * 1000 <= input.now;
  if (refreshDue) return true;
  const { live, cached } = input;
  if (!cached) return true;
  return (
    cached.id !== live.id ||
    cached.shopId !== live.shopId ||
    cached.shopSlug !== live.shopSlug ||
    cached.roles.length !== live.roles.length ||
    cached.roles.some((role, index) => role !== live.roles[index])
  );
}

type RawSession = SessionSnapshot & {
  expiresAt: Date;
  personId: string;
  roles: Role[];
  name: string;
};

/**
 * The session read itself, over one better-auth instance and one request's
 * headers. Exported for its test; everything else calls {@link auth}.
 *
 * The server-side security decision consults the session row every time
 * (`disableCookieCache`), so "sign out everywhere" and per-device revocation
 * take effect immediately; the cookie cache only ever decides whether to
 * *write*. The first read asks better-auth to write nothing
 * (`disableRefresh`, which returns before any cookie is set); a second read,
 * better-auth's ordinary one, runs only when {@link sessionCookieWriteDue}
 * says a write is owed, and its answer is the one returned.
 */
export async function readSessionFrom(
  instance: DiveDayAuth,
  headers: Headers,
  now: number = nowMs(),
): Promise<DiveDaySession | null> {
  const quiet = await instance.api.getSession({
    headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!quiet) return null;
  const { sessionConfig } = await instance.$context;
  const cache = await readSessionCookieCache(headers);
  const cached = cache?.session as unknown as SessionSnapshot | undefined;
  const live = quiet.session as unknown as RawSession;
  const result = sessionCookieWriteDue({
    now,
    expiresAt: new Date(live.expiresAt),
    expiresInSec: sessionConfig.expiresIn,
    updateAgeSec: sessionConfig.updateAge,
    live,
    cached: cached ?? null,
  })
    ? await instance.api.getSession({ headers, query: { disableCookieCache: true } })
    : quiet;
  if (!result) return null;
  const session = result.session as unknown as RawSession;
  return {
    user: {
      personId: session.personId,
      userAccountId: result.user.id,
      sessionId: session.id,
      shopId: session.shopId,
      shopSlug: session.shopSlug,
      roles: session.roles,
      name: session.name,
      email: result.user.email,
    },
  };
}

/**
 * Kept the same name and shape as the old next-auth `auth()` export so
 * `src/lib/session.ts`'s `requireStaffSession()` and every test that mocks
 * `@/lib/auth` need no changes — only where the fields come from changed
 * (a better-auth session row, not a JWT).
 */
async function readSession(): Promise<DiveDaySession | null> {
  return readSessionFrom(await getAuth(), new Headers(await nextHeaders()));
}

/**
 * One session read per render (app audit 2026-10-07, item 2). The staff shell
 * and the page gate beside it both ask, and each ask was a session-row read;
 * the row cannot change inside one render, and "sign out everywhere" still
 * lands on the very next request because `cache()` is request-scoped. Outside
 * a render it calls straight through.
 */
export const auth = cache(readSession);
