import { getCookieCache } from "better-auth/cookies";
import { authSecret } from "@/lib/auth-secret";

/**
 * The session snapshot in better-auth's short-lived cookie cache
 * (`better-auth.session_data`), or `null` when it is absent, unreadable or
 * past its own `maxAge`.
 *
 * One reader for both of its consumers, so they cannot disagree about whether
 * the cache is warm: the edge proxy, which reads it for its convenience
 * redirects (`src/proxy.ts`), and the server-side session read, which rewrites
 * it only when this says it is cold or stale (`src/lib/auth.ts`, issue #2263).
 * Never a security decision: the session row is.
 *
 * `isSecure` follows `buildAuth().advanced.useSecureCookies`: the e2e fleet
 * uses unprefixed cookies over loopback HTTP, and better-auth otherwise
 * defaults this reader to the production `__Secure-` name.
 */
export function readSessionCookieCache(source: Request | Headers) {
  return getCookieCache(source, {
    secret: authSecret,
    strategy: "jwe",
    isSecure: process.env.DIVEDAY_E2E !== "1",
  }).catch(() => null);
}
