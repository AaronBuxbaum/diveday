/**
 * The one shared secret behind every signed thing in this app: better-auth's
 * session cookies (`src/lib/auth.ts`), the `?gate=` HMAC
 * (`src/lib/trip-admission-gate.ts`), and recap links (`src/lib/recap-links.ts`)
 * — each derives its own purpose-separated key from this via HKDF rather than
 * using it directly, so a token from one system is never interchangeable with
 * another's.
 *
 * Deliberately its own file with no other imports: `trip-admission-gate.ts`
 * and `recap-links.ts` need only this string, not the database-backed weight
 * of the rest of `src/lib/auth.ts`, and `src/proxy.ts` needs it at the edge
 * for `getCookieCache`'s decryption — none of those call sites should have to
 * pull in `better-auth`'s server instance just to read a constant.
 *
 * Fixed dev fallback keeps `pnpm dev` / `pnpm e2e` zero-setup; production
 * must set `AUTH_SECRET` (better-auth fails loudly without it there).
 */
export const authSecret =
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "production" ? undefined : "diveday-dev-secret-not-for-production");
