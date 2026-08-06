/**
 * Auth.js re-issues the rolling session cookie on *every* request the edge
 * middleware sees, including Next.js prefetches. A prefetch (or any in-flight
 * request) that still carries the pre-sign-out cookie can land just after a
 * sign-out, and its refreshed `Set-Cookie` then overwrites the sign-out's
 * clear — silently resurrecting the session. src/proxy.ts is a read-only
 * authorization layer, so it must never *write* the session cookie: the real
 * sign-in / sign-out flows in the node runtime own it.
 *
 * A cookie a browser can't decrypt (wrong/rotated `AUTH_SECRET`, corrupted
 * value) is the one exception. `@auth/core`'s session action responds to a
 * decode failure with its own clearing `Set-Cookie` — empty value, `Max-Age:
 * 0` — and blanket-stripping that too left the broken cookie on the browser
 * forever: every later request re-sent it, re-failed to decode it, and
 * re-logged the same `JWTSessionError`, unbounded, until the cookie's own
 * expiry. A clearing cookie can never resurrect a session (there is nothing
 * left to resurrect), so only a *refresh* (non-empty value) is stripped.
 *
 * Letting the clear through has one narrow converse: a stale in-flight
 * request that still carries an undecryptable cookie can deliver its clear
 * after a concurrent, legitimate sign-in on the same browser, logging that
 * sign-in back out. That requires an already-undecryptable cookie racing a
 * real sign-in on the same client — rare enough, and cheap enough to just
 * sign in again, to prefer over every visitor with a stale cookie being
 * stuck re-triggering this on every request until it expires.
 */
const SESSION_COOKIE = /^(?:__Secure-|__Host-)?authjs\.session-token(?:\.\d+)?=/;

function isClearingCookie(cookie: string): boolean {
  const nameValue = cookie.split(";", 1)[0];
  const value = nameValue.slice(nameValue.indexOf("=") + 1);
  return value === "";
}

/**
 * Drops session-token *refresh* cookies from a list of `Set-Cookie` header
 * values, leaving the rest — including session-token *clears* — untouched.
 */
export function stripSessionSetCookies(setCookies: readonly string[]): string[] {
  return setCookies.filter((cookie) => !SESSION_COOKIE.test(cookie) || isClearingCookie(cookie));
}
