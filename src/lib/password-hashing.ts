import { hash } from "bcryptjs";

/**
 * The one bcrypt cost factor every *newly created* password hash in the app is
 * written at (onboarding, staff invite, password reset). It used to be the
 * bare literal `10` at each of those call sites, which is how a cost silently
 * drifts apart between flows.
 *
 * **Why 10.** bcryptjs is a pure-JavaScript implementation, so it is several
 * times slower per round than a native binding. Cost 10 (2^10 = 1,024
 * key-expansion rounds) lands around 50–100 ms on the serverless class of CPU
 * we deploy to — inside the latency budget for an interactive sign-in and for
 * the invite/reset flows that hash *before* opening their transaction, while
 * still costing an offline attacker ~10^3 more work per guess than a bare
 * digest. It is also the OWASP-documented floor for bcrypt.
 *
 * **When to revisit.** Raise it if either changes: (a) we move off `bcryptjs`
 * to a native binding or to argon2id — the same wall-clock budget then buys a
 * much higher cost; (b) a verify of a cost-10 hash drops meaningfully below
 * ~50 ms on production hardware. Raising this constant alone does **not**
 * re-hash anything: bcrypt hashes carry their own cost in the string and
 * `compare` reads it from there, so every account created before the change
 * keeps verifying at the old cost until a rehash-on-successful-sign-in path
 * exists. Add that path in the same change that raises the number.
 *
 * **Not for verification.** There is deliberately no "expected cost" check on
 * the verify path — `compare()` must keep reading the cost out of the stored
 * hash, or every pre-existing account stops being able to sign in the moment
 * this number moves.
 */
export const PASSWORD_HASH_COST = 10;

/**
 * Hash a password for storage in `user_accounts.hashed_password`. The only
 * supported way to create a password hash: it pins {@link PASSWORD_HASH_COST}
 * so no call site can quietly pick its own.
 *
 * Deliberately slow — call it *outside* any open transaction so a hash never
 * holds row locks (see the invite/reset actions).
 */
export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, PASSWORD_HASH_COST);
}
