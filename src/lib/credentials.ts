import { randomBytes } from "node:crypto";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import { isStaff, type Role } from "@/lib/authz";
import { demoBypassAccepted } from "@/lib/demo-bypass";
import { hashPassword } from "@/lib/password-hashing";

/**
 * The demo sign-in password, re-exported for the surfaces that *display* it
 * (the demo banners) and for `enterDemoAction`/`switchDemoRoleAction`, which
 * submit it on the visitor's behalf. The bypass *decision* deliberately no
 * longer lives in this module — see `src/lib/demo-bypass.ts` for the three
 * conditions it now requires and why. New importers should take it from there
 * directly.
 */
export { DEMO_BYPASS_PASSWORD } from "@/lib/demo-bypass";

export type VerifiedUser = {
  id: string;
  personId: string;
  shopId: string;
  shopSlug: string;
  name: string;
  email: string;
  roles: Role[];
};

/**
 * A bcrypt hash of 32 random bytes that are discarded the moment they are
 * hashed, generated once per process and never written anywhere. It exists so
 * an attempt with **no matching account row** still runs exactly one bcrypt
 * compare, at the same cost as a real one, instead of returning immediately
 * (which made "no such account" measurably faster than "wrong password" — an
 * account-enumeration oracle).
 *
 * The plaintext is never held, so no submitted password can match it: this can
 * only ever produce `false`, and it cannot be mistaken for — or promoted
 * into — a real credential.
 *
 * Generated lazily and memoized rather than at module load, so importing this
 * module (every server render does, transitively) does not pay ~100 ms of
 * key expansion at cold start. `verifyCredentials` kicks the generation off on
 * *every* attempt without awaiting it, so the first attempt in a process warms
 * it whichever branch that attempt takes, and a failure is never memoized.
 */
let decoyHash: Promise<string> | undefined;

function decoyPasswordHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString("hex"));
  const pending = decoyHash;
  pending.catch(() => {
    // Never memoize a failure — and attaching this handler is also what keeps
    // the un-awaited warm-up call from surfacing as an unhandled rejection.
    if (decoyHash === pending) decoyHash = undefined;
  });
  return pending;
}

/**
 * The whole credentials decision in one testable function: active account,
 * matching password, and at least one staff role — anything less is null,
 * with no hint which check failed (ADR-0006).
 *
 * "No hint" includes *how long it took*. Every path through this function runs
 * exactly one bcrypt compare, against the account's stored hash when there is
 * one and against {@link decoyPasswordHash} when there is not, so a request
 * for an address that has no account cannot be told apart from a wrong
 * password for a real one. The remaining asymmetry is the two extra row reads
 * a found account triggers; those are microseconds against bcrypt's tens of
 * milliseconds, and the sign-in chokepoint is rate-limited by IP and by email
 * on top (`src/lib/auth.ts`).
 */
export async function verifyCredentials(
  db: AppDb,
  email: string,
  password: string,
): Promise<VerifiedUser | null> {
  // Started, not awaited: warms the memoized decoy on the first attempt in
  // this process regardless of which branch that attempt takes.
  const decoy = decoyPasswordHash();

  const [found] = await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.email, email.toLowerCase()))
    .limit(1);
  const account = found?.status === "active" ? found : undefined;

  const [person] = account
    ? await db.select().from(people).where(eq(people.id, account.personId)).limit(1)
    : [];
  const [shop] = person
    ? await db.select().from(shops).where(eq(shops.id, person.shopId)).limit(1)
    : [];

  // Unconditional: the decoy branch is load-bearing, not defensive padding.
  const passwordMatches = await compare(password, account?.hashedPassword ?? (await decoy));

  const admitted =
    passwordMatches ||
    demoBypassAccepted({
      shopIsDemo: shop?.isDemo === true,
      accountEmail: account?.email ?? "",
      password,
    });

  if (!account || !person || !shop || !admitted) return null;

  const roleRows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(eq(personRoles.personId, person.id));
  const roles = roleRows.map((r) => r.role as Role);

  // Staff-only surface for now; customer sign-in arrives with the milestone
  // that needs it (ADR-0006).
  if (!isStaff(roles)) return null;

  return {
    id: account.id,
    personId: person.id,
    shopId: person.shopId,
    shopSlug: shop.slug,
    name: person.fullName,
    email: account.email,
    roles,
  };
}
