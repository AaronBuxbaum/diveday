/**
 * Auth.js re-issues the rolling session cookie on *every* request the edge
 * middleware sees, including Next.js prefetches. A prefetch (or any in-flight
 * request) that still carries the pre-sign-out cookie can land just after a
 * sign-out, and its refreshed `Set-Cookie` then overwrites the sign-out's
 * clear — silently resurrecting the session. src/proxy.ts is a read-only
 * authorization layer, so it must never *write* the session cookie: the real
 * sign-in / sign-out flows in the node runtime own it.
 */
const SESSION_COOKIE = /^(?:__Secure-|__Host-)?authjs\.session-token(?:\.\d+)?=/;

/** Drops session-token cookies from a list of `Set-Cookie` header values, leaving the rest untouched. */
export function stripSessionSetCookies(setCookies: readonly string[]): string[] {
  return setCookies.filter((cookie) => !SESSION_COOKIE.test(cookie));
}
