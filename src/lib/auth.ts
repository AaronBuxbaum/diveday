import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { headers as nextHeaders } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  accountSessions,
  authProviderAccounts,
  authVerifications,
  userAccounts,
} from "@/db/schema";
import { trackEvent } from "@/lib/analytics";
import { authSecret } from "@/lib/auth-secret";
import type { Role } from "@/lib/authz";
import { verifyCredentials } from "@/lib/credentials";
import { log } from "@/lib/log";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

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
          // Never spread the adapter's raw row into the response — it's a
          // bare SELECT * over user_accounts (findUserById), so `user` here
          // carries `hashedPassword` verbatim. Nothing reads this response
          // body today (no route mounts the better-auth handler, and no
          // call site inspects the return value of
          // signInDiveDayCredentials()), but the day one does — the
          // standard better-auth quickstart, a client SDK, OAuth — this
          // would otherwise ship every signed-in staff member's bcrypt hash
          // in a login response body (security review finding).
          return ctx.json({ user: { id: user.id, email: user.email, name: verified.name } });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

function buildAuth() {
  return getDb().then((db) =>
    betterAuth({
      secret: authSecret,
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
      // own.
      // Unused (no OAuth provider is configured), but still needs the same
      // userId -> userAccountId field mapping session has above, or an
      // internal better-auth code path that touches this model (e.g.
      // building a provider logout URL) logs a schema-mismatch warning.
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
    }),
  );
}

type DiveDayAuth = Awaited<ReturnType<typeof buildAuth>>;

// Lazy and memoized, like `getDb()` itself: constructing the adapter needs a
// resolved database handle, and this must never run as an import-time side
// effect (build-time static analysis, or an edge/serverless cold start with
// no DB reachable yet) — only the first real call pays for it.
let authInstancePromise: Promise<DiveDayAuth> | undefined;

export function getAuth(): Promise<DiveDayAuth> {
  authInstancePromise ??= buildAuth();
  return authInstancePromise;
}

export type DiveDaySession = {
  user: {
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

/**
 * Kept the same name and shape as the old next-auth `auth()` export so
 * `src/lib/session.ts`'s `requireStaffSession()` and every test that mocks
 * `@/lib/auth` need no changes — only where the fields come from changed
 * (a better-auth session row, not a JWT).
 */
export async function auth(): Promise<DiveDaySession | null> {
  const instance = await getAuth();
  const result = await instance.api.getSession({ headers: await nextHeaders() });
  if (!result) return null;
  const session = result.session as unknown as {
    personId: string;
    shopId: string;
    shopSlug: string;
    roles: Role[];
    name: string;
  };
  return {
    user: {
      personId: session.personId,
      shopId: session.shopId,
      shopSlug: session.shopSlug,
      roles: session.roles,
      name: session.name,
      email: result.user.email,
    },
  };
}
